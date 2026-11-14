import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { CompositeScreenProps, useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps as StackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { useAppContext } from '../state/AppContext';
import { useTheme, SPACING, touchSize } from '../constants/theme';
import { t } from '../localization/i18n';
import { ScreenWrapper } from '../components/common/ScreenWrapper';
import { useWide, TWO_COLUMN_MAX_WIDTH } from '../hooks/useWide';
import { Typography } from '../components/common/Typography';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { storageService, fluidCeiling, goalAboveLimit, MAX_SINGLE_ENTRY_ML, newId } from '../services/storageService';
import { notificationService } from '../services/notificationService';
import { badgeService } from '../services/badgeService';
import { dynamicGoalService, GoalAdjustmentType } from '../services/dynamicGoalService';
import { BeverageType, Dose, MedicationStatus, Priority } from '../types/models';
import { useToast } from '../hooks/useToast';
import { useAppState } from '../hooks/useAppState';
import { getLocalDayString, timestampForDay, formatLocalTime } from '../utils/DateUtils';
import { getDosesForDate, doseDateTime, isStockLow, isStockOut } from '../utils/ScheduleUtils';
import { confirm } from '../utils/confirm';
import { alertContactViaSms, alertContactViaWhatsApp, lateDoseMessage, CONTACT_ALERT_ENABLED } from '../utils/contactAlert';
import { useStockBox } from '../hooks/useStockBox';

import { WaterVisualizer } from '../components/WaterVisualizer';
import { CalendarStrip } from '../components/CalendarStrip';
import { MedicationCard, doseState } from '../components/MedicationCard';
import { AdBanner } from '../components/AdBanner';
import { noteUserAction } from '../services/ads';
import { QuickAddButton } from '../components/QuickAddButton';
import { EmptyState } from '../components/EmptyState';
import { CareProfileSwitch } from '../components/care/CareProfileSwitch';

const COEFFICIENTS: Record<BeverageType, number> = {
  [BeverageType.Water]: 1.0,
  [BeverageType.Tea]: 0.9,
  [BeverageType.Coffee]: 0.8,
  [BeverageType.Soda]: 0.6,
};

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

type Props = CompositeScreenProps<BottomTabScreenProps<any, 'Home'>, StackScreenProps<any>>;

const HomeScreen: React.FC<Props> = ({ navigation }) => {
  const { COLORS: c, isDark, isElderly } = useTheme();
  const wide = useWide();
  const {
    userName, waterGoal, sleepSettings, refreshAppData, todayDynamicAdjustment, refreshDynamicGoal,
    emergencyContact, appSettings, dataVersion, showDynamicGoalButtons, locale,
  } = useAppContext();
  const { showToast } = useToast();
  const stockBox = useStockBox();

  // null = follow today, so an app left open (or resumed from background) overnight doesn't keep
  // showing — and logging water into — yesterday.
  const [pickedDay, setDay] = useState<string | null>(null);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [hasMeds, setHasMeds] = useState(true); // false → the empty state offers "Add medication"
  const [hydration, setHydration] = useState(0); // coefficient-weighted, drives the goal ring
  const [fluid, setFluid] = useState(0);         // raw volume, checked against the fluid ceiling
  const [refreshing, setRefreshing] = useState(false);
  const [customWaterAmount, setCustomWaterAmount] = useState('');
  const [selectedBeverage, setSelectedBeverage] = useState<BeverageType>(BeverageType.Water);
  const [now, setNow] = useState(() => new Date());
  const [activeAdj, setActiveAdj] = useState<GoalAdjustmentType[]>([]);

  const today = getLocalDayString(now);
  // Elderly mode has no day strip: always today (also rolls over at midnight).
  const day = isElderly || !pickedDay ? today : pickedDay;
  const beverage = isElderly ? BeverageType.Water : selectedBeverage;
  const isToday = day === today;
  const isFuture = day > today;

  // Late/overdue states depend on the clock.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);
  const appState = useAppState();
  useEffect(() => { if (appState === 'active') setNow(new Date()); }, [appState]);

  // Only the latest request may write state, so a fast day switch can't be overwritten by a slow older one.
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    const [meds, logs, waterLogs] = await Promise.all([
      storageService.getMedications(),
      storageService.getLogsForDate(day),
      storageService.getWaterLogsByDate(day),
    ]);
    if (id !== requestId.current) return;
    setDoses(getDosesForDate(meds, logs, day));
    setHasMeds(meds.length > 0);
    setHydration(waterLogs.reduce((s, l) => s + (l.hydrationAmountMl ?? l.amountMl), 0));
    setFluid(waterLogs.reduce((s, l) => s + l.amountMl, 0));
    setNow(new Date());
  }, [day]);

  useEffect(() => { load().catch(console.error); }, [load, dataVersion]);
  // Which extra-goal chips are on today (they toggle).
  useEffect(() => {
    dynamicGoalService.getTodayAdjustments().then(a => setActiveAdj(a.map(x => x.type))).catch(console.error);
  }, [todayDynamicAdjustment, dataVersion, today]);
  useFocusEffect(useCallback(() => { load().catch(console.error); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  };

  const baseGoal = Number.isFinite(waterGoal) && waterGoal > 0 ? waterGoal : 0;
  const goal = baseGoal + (isToday ? todayDynamicAdjustment || 0 : 0);
  const percentage = goal > 0 ? (hydration / goal) * 100 : 0;
  const overLimit = isToday ? goalAboveLimit(goal, appSettings) : null;

  const afterChange = () => {
    notificationService.rescheduleAll().catch(console.error);
    refreshAppData(); // bumps dataVersion → load()
  };

  // --- Doses ---------------------------------------------------------------

  const markDose = async (dose: Dose, status: MedicationStatus | null) => {
    const when = timestampForDay(day);
    if (!when) return; // future day — buttons are disabled anyway
    const name = dose.medication.name;
    const wasOut = status === MedicationStatus.Taken && isStockOut(dose.medication.stock);
    try {
      const med = await storageService.setDoseStatus(dose.medication, dose.date, dose.time, status, new Date(when));
      noteUserAction();
      afterChange();

      if (status === null) {
        showToast({ message: t('home.dose_undone', { name, time: dose.time }), type: 'info' });
        return;
      }
      if (status === MedicationStatus.Skipped) {
        showToast({ message: t('notification_action.med_skipped', { name }), type: 'info' });
        return;
      }
      if (wasOut) {
        // Dose is saved (stock stays at 0); offer a refill.
        showToast({ message: t('notification_action.med_taken', { name }), type: 'success' });
        await stockBox.promptStockOut(med, () => navigation.navigate('AddEditMedication', { medicationId: med.id }));
        refreshAppData();
        return;
      }
      const stock = med.stock;
      if (stock && isStockLow(med)) {
        showToast({ message: t('notification_action.stock_low', { name, count: stock.remaining }), type: 'warning' });
        return;
      }
      const unlocked = await badgeService.checkMedicationBadges(med.id).catch(() => []);
      showToast({ message: unlocked.length ? t('common.new_badge') : t('notification_action.med_taken', { name }), type: 'success' });
    } catch (e) {
      console.error(e);
      showToast({ message: t('common.save_error'), type: 'error' });
    }
  };

  // --- Water ---------------------------------------------------------------

  const handleAddWater = async (amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast({ message: t('home.error_invalid_amount'), type: 'warning' });
      return;
    }
    if (amount > MAX_SINGLE_ENTRY_ML) {
      showToast({ message: t('home.max_single_entry', { max: MAX_SINGLE_ENTRY_ML }), type: 'warning' });
      return;
    }
    const timestamp = timestampForDay(day);
    if (!timestamp) {
      showToast({ message: t('home.future_day_blocked'), type: 'warning' });
      return;
    }

    const ceiling = fluidCeiling(appSettings);
    if (fluid + amount > ceiling) {
      const doctorLimit = appSettings.fluidLimitMl != null;
      const ok = await confirm(
        t('home.fluid_warning_title'),
        doctorLimit
          ? t('home.fluid_warning_doctor', { limit: ceiling, total: fluid + amount })
          : t('home.fluid_warning_generic', { total: fluid + amount }),
        t('home.fluid_warning_confirm'),
        true,
      );
      if (!ok) return;
    }

    const hydrationAmount = Math.round(amount * COEFFICIENTS[beverage]);
    try {
      await storageService.saveWaterLog({
        id: newId(),
        amountMl: amount,
        hydrationAmountMl: hydrationAmount,
        beverageType: beverage,
        timestamp,
      });
      setHydration(h => h + hydrationAmount);
      setFluid(f => f + amount);
      noteUserAction();
      afterChange(); // reaching the goal stops today's water reminders

      let badge = false;
      if (isToday) {
        const unlocked = await badgeService.checkWaterBadges(amount, beverage, hydration + hydrationAmount, goal).catch(() => []);
        badge = unlocked.length > 0;
      }
      showToast({
        message: badge
          ? t('common.new_badge')
          : t('home.water_added_detail', { amount, beverage: t(`beverages.${beverage}`), hydration: hydrationAmount }),
        type: 'success',
      });
    } catch (e) {
      console.error(e);
      showToast({ message: t('home.error_save_water'), type: 'error' });
    }
  };

  const submitCustomAmount = () => {
    const amount = parseInt(customWaterAmount, 10);
    setCustomWaterAmount('');
    handleAddWater(amount);
  };

  // --- Emergency strip -----------------------------------------------------

  const lateHighPriority = isToday && appSettings.escalation.enabled
    ? doses.filter(d =>
        d.medication.priority === Priority.High && !d.log &&
        now.getTime() > doseDateTime(d.date, d.time).getTime() + appSettings.escalation.delayMinutes * 60000)
    : [];
  const contactPhone = emergencyContact?.phone?.trim();
  const lateMessage = lateHighPriority.length
    ? lateDoseMessage(userName, [...new Set(lateHighPriority.map(d => d.medication.name))].join(', '), lateHighPriority[0].time)
    : '';
  const openFailed = () => showToast({ message: t('home.contact_open_failed'), type: 'error' });

  // --- Header --------------------------------------------------------------

  const getGreeting = (): string => {
    const cur = now.getHours() * 60 + now.getMinutes();
    const wake = toMin(sleepSettings?.end || '07:00');
    const sleep = toMin(sleepSettings?.start || '22:00');
    const asleep = sleep > wake ? cur >= sleep || cur < wake : cur >= sleep && cur < wake;
    if (asleep) return t('home.night');
    const morningEnd = wake < 720 ? 720 : wake + 120;
    if (cur >= wake && cur < morningEnd) return t('home.morning');
    if (cur >= 1020) return t('home.evening');
    return t('home.good_day');
  };

  const beverageStyle = (type: BeverageType) => ({
    [BeverageType.Water]: { icon: 'water', color: c.primary },
    [BeverageType.Tea]: { icon: 'leaf', color: c.success },
    [BeverageType.Coffee]: { icon: 'cafe', color: c.warning },
    [BeverageType.Soda]: { icon: 'beer', color: c.error },
  }[type]);

  const adjustmentStyle: Record<GoalAdjustmentType, { icon: string; color: string }> = {
    hot_weather: { icon: 'sunny', color: c.warning },
    exercise: { icon: 'fitness', color: c.success },
    caffeine: { icon: 'cafe', color: c.secondary },
  };

  const chipBg = isDark ? 'rgba(255,255,255,0.06)' : c.lightGray;

  const noMedsEmpty = (
    <EmptyState
      title={t('medications.empty_title')}
      description={t('medications.empty_desc')}
      iconName="medkit-outline"
      action={{ title: t('add_medication.title'), onPress: () => navigation.navigate('AddEditMedication', {}) }}
    />
  );

  const alertStrip = CONTACT_ALERT_ENABLED && lateHighPriority.length > 0 && (
    contactPhone ? (
      <View style={[styles.alertStrip, { backgroundColor: c.error + '1A', borderColor: c.error }]}>
        <View style={styles.alertTitleRow}>
          <Ionicons name="warning" size={isElderly ? 30 : 22} color={c.error} />
          <Typography variant="body" color={c.error} style={styles.alertTitle}>
            {t('home.late_dose_alert', { meds: [...new Set(lateHighPriority.map(d => d.medication.name))].join(', ') })}
          </Typography>
        </View>
        <Typography variant="caption" color={c.text}>
          {t('home.notify_contact', { name: emergencyContact.name || t('emergency.contact') })}
        </Typography>
        <View style={styles.alertButtons}>
          <TouchableOpacity
            style={[styles.alertBtn, { backgroundColor: c.error, minHeight: touchSize(isElderly) }]}
            accessibilityRole="button"
            accessibilityLabel={t('home.notify_sms_a11y')}
            onPress={() => alertContactViaSms(contactPhone, lateMessage).catch(openFailed)}
          >
            <Ionicons name="chatbubble" size={isElderly ? 26 : 18} color={c.onPrimary} />
            <Typography variant="body" color={c.onPrimary} style={styles.bold}>{t('home.sms')}</Typography>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.alertBtn, { backgroundColor: c.success, minHeight: touchSize(isElderly) }]}
            accessibilityRole="button"
            accessibilityLabel={t('home.notify_whatsapp_a11y')}
            onPress={() => alertContactViaWhatsApp(contactPhone, lateMessage).catch(openFailed)}
          >
            <Ionicons name="logo-whatsapp" size={isElderly ? 26 : 18} color={c.onPrimary} />
            <Typography variant="body" color={c.onPrimary} style={styles.bold}>WhatsApp</Typography>
          </TouchableOpacity>
        </View>
      </View>
    ) : (
      <TouchableOpacity
        style={[styles.noContactNote, { borderColor: c.error, minHeight: touchSize(isElderly) }]}
        onPress={() => navigation.navigate('EmergencySettings')}
        accessibilityRole="button"
      >
        <Typography variant="caption" color={c.error}>{t('home.late_no_contact')}</Typography>
      </TouchableOpacity>
    )
  );

  // Doctor's fluid limit below today's goal: small note under the ring, opens the goal settings.
  const overLimitNote = overLimit !== null && (
    <TouchableOpacity
      onPress={() => navigation.navigate('WaterGoalSettings')}
      accessibilityRole="button"
      style={[styles.limitNote, { borderColor: c.warning, minHeight: touchSize(isElderly) }]}
    >
      <Ionicons name="alert-circle" size={isElderly ? 24 : 18} color={c.warning} />
      <Typography variant="caption" color={c.text} style={styles.flex1}>{t('water_limit.home_note', { goal, limit: overLimit })}</Typography>
    </TouchableOpacity>
  );

  const toggleAdjustment = async (type: GoalAdjustmentType) => {
    const label = t(`dynamic_goal.${type}`);
    try {
      const on = await dynamicGoalService.toggleAdjustment(type);
      await refreshDynamicGoal();
      showToast(on
        ? {
            message: t(`dynamic_goal.${type}_added`),
            type: 'success',
            action: {
              label: t('dose_card.undo'),
              onPress: () => { dynamicGoalService.removeTodayAdjustment(type).then(refreshDynamicGoal).catch(console.error); },
            },
          }
        : { message: t('dynamic_goal.removed', { name: label }), type: 'info' });
    } catch (err) {
      console.error(err);
      showToast({ message: t('common.save_error'), type: 'error' });
    }
  };

  if (isElderly) {
    // "Büyük ve sade görünüm": today only — water ring + two glass buttons, then doses that need action now.
    const soon = now.getTime() + 60 * 60000;
    const dueNow = doses.filter(d => !d.log && doseDateTime(d.date, d.time).getTime() <= soon);
    const later = doses.filter(d => !d.log && doseDateTime(d.date, d.time).getTime() > soon);
    const marked = doses.filter(d => d.log);
    const dateLabel = now.toLocaleDateString(locale === 'en' ? 'en-GB' : 'tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
    const doseStateText = (d: Dose) => {
      const st = doseState(d, now);
      return st === 'taken' ? t('dose_card.state_taken', { time: formatLocalTime(new Date(d.log!.timestamp)) }) : t(`dose_card.state_${st}`);
    };

    return (
      <ScreenWrapper maxWidth={TWO_COLUMN_MAX_WIDTH}>
        <View style={[styles.header, { backgroundColor: c.headerBg }]}>
          <View style={{ flex: 1 }}>
            <Typography variant="header" color={c.onHeader} numberOfLines={2}>
              {`${getGreeting()}${userName ? `, ${userName}` : ''}`}
            </Typography>
            <Typography variant="body" color={c.onHeader} style={styles.bold}>{dateLabel}</Typography>
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('Settings')}
            accessibilityRole="button"
            accessibilityLabel={t('tabs.settings')}
            style={[styles.iconBtn, styles.iconBtnLarge]}
          >
            <Ionicons name="settings-outline" size={34} color={c.onHeader} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.contentContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
        >
          <CareProfileSwitch />
          {alertStrip}

          <View style={wide && styles.columns}>
          <View style={wide && styles.column}>
          <View style={styles.sectionLarge}>
            <Card style={styles.visualizerCard}>
              <WaterVisualizer percentage={percentage} currentAmount={hydration} goalAmount={goal} />
            </Card>
            {overLimitNote}
            <View style={styles.bigButtons}>
              <Button title={t('home.elderly_glass')} onPress={() => handleAddWater(250)} style={styles.bigBtn} textStyle={styles.bigBtnText} />
              <Button title={t('home.elderly_big_glass')} onPress={() => handleAddWater(500)} style={styles.bigBtn} textStyle={styles.bigBtnText} />
            </View>
          </View>
          </View>

          <View style={wide && styles.column}>
          <View style={styles.sectionLarge}>
            <Typography variant="header" style={styles.sectionTitle}>{t('home.elderly_due_now')}</Typography>
            {dueNow.length > 0 ? (
              dueNow.map(dose => (
                <MedicationCard
                  key={dose.key}
                  dose={dose}
                  onPress={d => navigation.navigate('MedicationDetailModal', { medicationId: d.medication.id })}
                  onTake={d => markDose(d, MedicationStatus.Taken)}
                  onSkip={d => markDose(d, MedicationStatus.Skipped)}
                  onUndo={d => markDose(d, null)}
                />
              ))
            ) : (
              <Card style={[styles.emptyCard, { borderColor: c.border }]}>
                {doses.length || hasMeds
                  ? <EmptyState title={doses.length ? t('home.elderly_none_due') : t('home.no_medications')} iconName="checkmark-circle-outline" />
                  : noMedsEmpty}
              </Card>
            )}
          </View>

          {later.length > 0 && (
            <View style={styles.sectionLarge}>
              <Typography variant="subheader" style={styles.sectionTitle}>{t('home.elderly_later')}</Typography>
              {later.map(d => (
                <View key={d.key} style={[styles.simpleRow, { borderColor: c.border }]}>
                  <Typography variant="subheader" style={styles.simpleTime}>{d.time}</Typography>
                  <Typography style={styles.flex1} numberOfLines={2}>{d.medication.name}</Typography>
                </View>
              ))}
            </View>
          )}

          {marked.length > 0 && (
            <View style={styles.sectionLarge}>
              <Typography variant="subheader" style={styles.sectionTitle}>{t('home.elderly_done')}</Typography>
              {marked.map(d => (
                <View key={d.key} style={[styles.simpleRow, { borderColor: c.border }]}>
                  <Ionicons
                    name={d.log!.status === MedicationStatus.Taken ? 'checkmark-circle' : 'remove-circle'}
                    size={30}
                    color={d.log!.status === MedicationStatus.Taken ? c.success : c.textSecondary}
                  />
                  <View style={styles.flex1}>
                    <Typography numberOfLines={2}>{`${d.time}  ${d.medication.name}`}</Typography>
                    <Typography variant="caption" color={c.textSecondary}>{doseStateText(d)}</Typography>
                  </View>
                  <TouchableOpacity
                    onPress={() => markDose(d, null)}
                    accessibilityRole="button"
                    accessibilityLabel={t('dose_card.a11y_undo', { name: d.medication.name, time: d.time })}
                    style={[styles.undoLarge, { borderColor: c.border }]}
                  >
                    <Typography color={c.textSecondary} style={styles.bold}>{t('dose_card.undo')}</Typography>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
          </View>
          </View>
          <AdBanner />
        </ScrollView>
        {stockBox.sheet}
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper maxWidth={TWO_COLUMN_MAX_WIDTH}>
      <View style={[styles.header, { backgroundColor: c.headerBg }]}>
        <View style={{ flex: 1 }}>
          <Typography variant="subheader" color={c.onHeader} style={styles.greeting}>
            {`${getGreeting()}${userName ? `, ${userName}` : ''}`}
          </Typography>
          <Typography variant="caption" color={c.onHeader} style={styles.headerSub}>
            {t('tabs.tracker')}
          </Typography>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('Settings')}
          accessibilityRole="button"
          accessibilityLabel={t('tabs.settings')}
          style={styles.iconBtn}
        >
          <Ionicons name="settings-outline" size={26} color={c.onHeader} />
        </TouchableOpacity>
      </View>

      <CalendarStrip selectedDate={new Date(day + 'T12:00:00')} onDateSelect={d => { const picked = getLocalDayString(d); setDay(picked === getLocalDayString() ? null : picked); }} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
        >
          <CareProfileSwitch />
          {alertStrip}

          <View style={wide && styles.columns}>
          <View style={wide && styles.column}>
          <View style={styles.section}>
            <Card style={styles.visualizerCard}>
              <WaterVisualizer percentage={percentage} currentAmount={hydration} goalAmount={goal} />
            </Card>
            {overLimitNote}

            {showDynamicGoalButtons && isToday && (
              <View style={styles.adjustRow}>
                {(Object.keys(adjustmentStyle) as GoalAdjustmentType[]).map(type => {
                  const on = activeAdj.includes(type);
                  const { icon, color } = adjustmentStyle[type];
                  return (
                    <TouchableOpacity
                      key={type}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: on }}
                      accessibilityHint={t('dynamic_goal.toggle_hint')}
                      style={[styles.adjustBtn, { backgroundColor: on ? color + '1A' : chipBg, borderColor: on ? color : 'transparent' }]}
                      onPress={() => toggleAdjustment(type)}
                    >
                      <Ionicons name={(on ? 'checkmark-circle' : icon) as any} size={18} color={color} />
                      <Typography variant="caption" color={on ? c.text : c.textSecondary} style={styles.adjustText} numberOfLines={2}>
                        {t(`dynamic_goal.${type}`)}
                      </Typography>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Typography variant="subheader" style={styles.sectionTitle}>{t('common.water')}</Typography>

            <View style={styles.beverageSelector}>
              {Object.values(BeverageType).map(type => {
                const selected = selectedBeverage === type;
                const { icon, color } = beverageStyle(type);
                return (
                  <TouchableOpacity
                    key={type}
                    onPress={() => setSelectedBeverage(type)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[styles.beverageCard, { borderColor: selected ? color : 'transparent', backgroundColor: selected ? color + '1A' : chipBg }]}
                  >
                    <Ionicons name={icon as any} size={22} color={color} />
                    <Typography variant="caption" color={selected ? color : c.textSecondary} style={styles.beverageText}>
                      {t(`beverages.${type}`)}
                    </Typography>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.quickAddRow}>
              {[250, 500, 1000].map(amount => (
                <QuickAddButton key={amount} amount={amount} onAdd={handleAddWater} disabled={isFuture} />
              ))}
            </View>

            <View style={styles.customRow}>
              <Input
                placeholder="330"
                label={t('home.custom_amount_ml')}
                keyboardType="numeric"
                value={customWaterAmount}
                onChangeText={setCustomWaterAmount}
                onSubmitEditing={submitCustomAmount}
                returnKeyType="done"
                editable={!isFuture}
                containerStyle={{ flex: 1 }}
              />
              <Button
                title={t('common.add')}
                onPress={submitCustomAmount}
                disabled={isFuture || !customWaterAmount}
                style={styles.customBtn}
              />
            </View>
          </View>

          </View>

          <View style={wide && styles.column}>
          <View style={styles.section}>
            <Typography variant="subheader" style={styles.sectionTitle}>{t('home.todays_schedule')}</Typography>
            {isFuture && doses.length > 0 && (
              <Typography variant="caption" color={c.textSecondary} style={styles.futureNote}>{t('home.future_day_note')}</Typography>
            )}
            {doses.length > 0 ? (
              doses.map(dose => (
                <MedicationCard
                  key={dose.key}
                  dose={dose}
                  disabled={isFuture}
                  onPress={d => navigation.navigate('MedicationDetailModal', { medicationId: d.medication.id })}
                  onTake={d => markDose(d, MedicationStatus.Taken)}
                  onSkip={d => markDose(d, MedicationStatus.Skipped)}
                  onUndo={d => markDose(d, null)}
                />
              ))
            ) : (
              <Card style={[styles.emptyCard, { borderColor: c.border }]}>
                {hasMeds ? <EmptyState title={t('home.no_medications')} iconName="medkit-outline" /> : noMedsEmpty}
              </Card>
            )}
          </View>
          </View>
          </View>
          <AdBanner />
        </ScrollView>
      </KeyboardAvoidingView>
      {stockBox.sheet}
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  // ScreenWrapper's SafeAreaView already pads the status bar — no extra top padding here.
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: SPACING.md, paddingBottom: SPACING.md, paddingHorizontal: SPACING.lg },
  greeting: { fontWeight: '900' },
  headerSub: { marginTop: 2, fontWeight: '600', opacity: 0.85 },
  iconBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginRight: -SPACING.sm },
  alertStrip: { marginHorizontal: SPACING.md, marginTop: SPACING.md, padding: SPACING.md, borderRadius: 16, borderWidth: 1.5, gap: SPACING.xs },
  alertTitleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  alertTitle: { flex: 1, fontWeight: '800' },
  alertButtons: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xs },
  alertBtn: { flex: 1, minHeight: 48, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  noContactNote: { marginHorizontal: SPACING.md, marginTop: SPACING.md, padding: SPACING.sm, minHeight: 44, justifyContent: 'center', borderRadius: 12, borderWidth: 1 },
  bold: { fontWeight: '700' },
  scrollView: { flex: 1 },
  contentContainer: { paddingBottom: 100 },
  section: { marginTop: SPACING.lg, paddingHorizontal: SPACING.md },
  sectionTitle: { marginBottom: 12, marginLeft: 4 },
  visualizerCard: { padding: 32, alignItems: 'center', justifyContent: 'center' },
  adjustRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  adjustBtn: { flex: 1, minHeight: 48, padding: 8, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  limitNote: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: 12, borderWidth: 1 },
  adjustText: { marginLeft: 4, fontWeight: '600', flexShrink: 1 },
  beverageSelector: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  beverageCard: { flex: 1, minHeight: 64, paddingVertical: 10, borderRadius: 16, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  beverageText: { fontWeight: '700', marginTop: 4 },
  quickAddRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  customRow: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACING.sm },
  customBtn: { minHeight: 48, paddingHorizontal: SPACING.lg, marginBottom: SPACING.md },
  futureNote: { marginBottom: SPACING.sm, marginLeft: 4 },
  iconBtnLarge: { width: 56, height: 56 },
  sectionLarge: { marginTop: SPACING.xl, paddingHorizontal: SPACING.md },
  bigButtons: { gap: SPACING.md, marginTop: SPACING.lg },
  bigBtn: { minHeight: 64, paddingHorizontal: SPACING.md },
  bigBtnText: { fontSize: 22, lineHeight: 30 },
  simpleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, minHeight: 64, paddingVertical: SPACING.sm, borderBottomWidth: 1 },
  simpleTime: { minWidth: 76 },
  undoLarge: { minHeight: 56, minWidth: 56, paddingHorizontal: SPACING.md, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  flex1: { flex: 1 },
  // Wide screens only (tablet/foldable/landscape): water on the left, medications on the right.
  columns: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { flex: 1, minWidth: 0 },
  emptyCard: { padding: 40, borderStyle: 'dashed', borderWidth: 2, alignItems: 'center' },
});

export default HomeScreen;
