import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps as StackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, SPACING, SHADOWS } from '../constants/theme';
import { Typography } from '../components/common/Typography';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { ScreenWrapper } from '../components/common/ScreenWrapper';
import { storageService, fluidCeiling } from '../services/storageService';
import { notificationService, NotificationData, WATER_ACTION_ML } from '../services/notificationService';
import { PlannedData } from '../services/notificationPlan';
import { Medication, MedicationLog, MedicationStatus, Priority, logKey, doseKey } from '../types/models';
import { isStockLow, isStockOut } from '../utils/ScheduleUtils';
import { useAppContext } from '../state/AppContext';
import { useToast } from '../hooks/useToast';
import { t } from '../localization/i18n';
import { getLocalDayString } from '../utils/DateUtils';
import { confirm } from '../utils/confirm';
import { alertContactViaSms, alertContactViaWhatsApp, lateDoseMessage, CONTACT_ALERT_ENABLED } from '../utils/contactAlert';
import { useStockBox } from '../hooks/useStockBox';
import { noteUserAction } from '../services/ads';

type Params = { data?: NotificationData; actionId?: string };
type DoseData = Extract<PlannedData, { medicationId: string }>;

const NotificationActionScreen: React.FC<StackScreenProps<any>> = ({ navigation, route }) => {
  const { data: raw, actionId } = (route.params ?? {}) as Params;
  const target: PlannedData | undefined = raw?.type === 'snooze' ? raw.of : raw;
  const doseData: DoseData | undefined = target && 'medicationId' in target ? target : undefined;

  const { COLORS: c, isDark } = useTheme();
  const { refreshAppData, waterGoal, todayDynamicAdjustment, appSettings, emergencyContact, userName } = useAppContext();
  const drinkMl = appSettings.waterReminder.drinkAmountMl || WATER_ACTION_ML;
  const { showToast } = useToast();
  const stockBox = useStockBox();

  // undefined = still loading, null = medication was deleted
  const [medication, setMedication] = useState<Medication | null | undefined>(undefined);
  const [log, setLog] = useState<MedicationLog | undefined>();
  const [water, setWater] = useState<{ hydration: number; fluid: number } | null>(null);
  const [autoTaken, setAutoTaken] = useState(false);
  const [busy, setBusy] = useState(false);
  const autoHandled = useRef(false);

  const close = () => navigation.goBack();
  const finish = () => {
    notificationService.rescheduleAll().catch(console.error);
    refreshAppData();
    close();
  };

  /** Records the dose. `moved`: the user chose "Stok gir" and this screen was replaced by the edit form. */
  const takeDose = async (med: Medication, d: DoseData): Promise<{ updated: Medication; moved: boolean }> => {
    const wasOut = isStockOut(med.stock);
    const updated = await storageService.setDoseStatus(med, d.date, d.time, MedicationStatus.Taken);
    noteUserAction();
    notificationService.rescheduleAll().catch(console.error);
    refreshAppData();
    if (wasOut) {
      // Dose is saved (stock stays at 0); offer a refill.
      let moved = false;
      await stockBox.promptStockOut(updated, () => { moved = true; navigation.replace('AddEditMedication', { medicationId: med.id }); });
      refreshAppData();
      return { updated: (await storageService.getMedication(med.id)) ?? updated, moved };
    }
    const stock = updated.stock;
    if (stock && isStockLow(updated)) {
      showToast({ message: t('notification_action.stock_low', { name: med.name, count: stock.remaining }), type: 'warning' });
    }
    return { updated, moved: false };
  };

  useEffect(() => {
    let ignore = false;
    (async () => {
      if (doseData) {
        const [med, logs] = await Promise.all([
          storageService.getMedication(doseData.medicationId),
          storageService.getLogsForDate(doseData.date),
        ]);
        if (ignore) return;
        const existing = logs.find(l => logKey(l) === doseKey(doseData.medicationId, doseData.date, doseData.time));
        setLog(existing);
        setMedication(med);
        // "Aldım" pressed on the notification itself → record it straight away.
        if (med && actionId === 'TAKE' && !autoHandled.current) {
          autoHandled.current = true;
          const { updated } = await takeDose(med, doseData);
          if (!ignore) { setMedication(updated); setAutoTaken(true); } // header shows the stock after this dose
        }
      } else if (target?.type === 'water') {
        const logs = await storageService.getWaterLogsByDate(getLocalDayString());
        if (ignore) return;
        setWater({
          hydration: logs.reduce((s, l) => s + (l.hydrationAmountMl ?? l.amountMl), 0),
          fluid: logs.reduce((s, l) => s + l.amountMl, 0),
        });
      }
    })().catch(e => {
      console.error(e);
      if (!ignore) setMedication(null);
    });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      showToast({ message: t('common.operation_failed'), type: 'error' });
      setBusy(false);
    }
  };

  const onTake = () => run(async () => {
    if (!medication || !doseData) return;
    if ((await takeDose(medication, doseData)).moved) return;
    showToast({ message: t('notification_action.med_taken', { name: medication.name }), type: 'success' });
    close();
  });

  const onSkip = () => run(async () => {
    if (!medication || !doseData) return;
    if (medication.priority === Priority.High) {
      const ok = await confirm(t('notification_action.warning_title'), t('notification_action.warning_desc'), t('notification_action.warning_skip'), true);
      if (!ok) { setBusy(false); return; }
    }
    await storageService.setDoseStatus(medication, doseData.date, doseData.time, MedicationStatus.Skipped);
    noteUserAction();
    showToast({ message: t('notification_action.med_skipped', { name: medication.name }), type: 'info' });
    finish();
  });

  const onSnooze = (minutes: number) => run(async () => {
    if (!target) return;
    await notificationService.snooze(target, minutes);
    showToast({ message: t('notification_action.snooze_info', { minutes }), type: 'info' });
    finish();
  });

  const onDrink = () => run(async () => {
    if (!water) return;
    const ceiling = fluidCeiling(appSettings);
    if (water.fluid + drinkMl > ceiling) {
      const ok = await confirm(
        t('home.fluid_warning_title'),
        appSettings.fluidLimitMl != null
          ? t('home.fluid_warning_doctor', { limit: ceiling, total: water.fluid + drinkMl })
          : t('home.fluid_warning_generic', { total: water.fluid + drinkMl }),
        t('home.fluid_warning_confirm'),
        true,
      );
      if (!ok) { setBusy(false); return; }
    }
    await notificationService.logWaterFromNotification(); // saves + reschedules
    showToast({ message: t('notif_screen.water_logged', { amount: drinkMl }), type: 'success' });
    refreshAppData();
    close();
  });

  const contactPhone = emergencyContact?.phone?.trim();
  const contactMessage = medication && doseData ? lateDoseMessage(userName, medication.name, doseData.time) : '';
  const openFailed = () => showToast({ message: t('home.contact_open_failed'), type: 'error' });

  const iconCircle = (name: keyof typeof Ionicons.glyphMap, color: string) => (
    <View style={[styles.iconCircle, { backgroundColor: color + '22' }]}>
      <Ionicons name={name} size={44} color={color} />
    </View>
  );

  const closeButton = <Button title={t('notif_screen.close')} variant="secondary" onPress={close} style={styles.fullBtn} />;

  const renderMedicationBody = (med: Medication, d: DoseData) => {
    const header = (
      <>
        <Typography variant="header" style={styles.title}>{med.name}</Typography>
        <Typography variant="body" color={c.textSecondary} style={styles.center}>
          {[med.dosage, t('notif_screen.scheduled_at', { time: d.time })].filter(Boolean).join(' · ')}
        </Typography>
        {med.stock && (
          <Typography variant="body" color={isStockLow(med) ? c.error : c.textSecondary} style={styles.stock}>
            {t('notification_action.remaining_stock', { count: med.stock.remaining })}
          </Typography>
        )}
      </>
    );

    if (autoTaken) {
      return (
        <>
          {iconCircle('checkmark-circle', c.success)}
          {header}
          <Typography variant="subheader" color={c.success} style={[styles.center, styles.gapTop]}>
            {t('notif_screen.auto_taken')}
          </Typography>
          {closeButton}
        </>
      );
    }

    if (d.type === 'dose_presleep') {
      return (
        <>
          {iconCircle('moon', c.primary)}
          {header}
          <Typography variant="body" style={[styles.center, styles.gapTop]}>
            {t('notifications.med_sleep_info_body', { time: d.time, name: med.name })}
          </Typography>
          {closeButton}
        </>
      );
    }

    const alreadyMarked = log && (
      <Typography variant="body" color={c.textSecondary} style={[styles.center, styles.gapTop]}>
        {t('notif_screen.already_marked', {
          status: log.status === MedicationStatus.Taken ? t('common.taken') : log.status === MedicationStatus.Skipped ? t('common.skipped') : t('common.missed'),
        })}
      </Typography>
    );

    if (d.type === 'escalation') {
      return (
        <>
          {iconCircle('warning', c.error)}
          <Typography variant="header" style={styles.title}>{t('notif_screen.escalation_title', { name: med.name, time: d.time })}</Typography>
          {alreadyMarked}
          <Button title={t('notif_screen.took_now')} onPress={onTake} loading={busy} style={styles.fullBtn} />
          {CONTACT_ALERT_ENABLED && (contactPhone ? (
            <View style={styles.row}>
              <Button
                title={t('home.sms')}
                variant="secondary"
                onPress={() => { alertContactViaSms(contactPhone, contactMessage).catch(openFailed); }}
                style={styles.flex1}
              />
              <Button
                title="WhatsApp"
                variant="secondary"
                onPress={() => { alertContactViaWhatsApp(contactPhone, contactMessage).catch(openFailed); }}
                style={styles.flex1}
              />
            </View>
          ) : (
            <Typography variant="caption" color={c.textSecondary} style={[styles.center, styles.gapTop]}>{t('emergency.no_contact')}</Typography>
          ))}
          {closeButton}
        </>
      );
    }

    // 'dose' (or a snoozed dose)
    return (
      <>
        {iconCircle('medical', med.priority === Priority.High ? c.error : c.primary)}
        {header}
        {alreadyMarked}
        <View style={styles.row}>
          <Button title={t('notification_action.take_med')} onPress={onTake} loading={busy} style={styles.flex2} />
          <Button title={t('notification_action.skip_med')} variant="destructive" onPress={onSkip} disabled={busy} style={styles.flex1} />
        </View>
        <TouchableOpacity
          onPress={() => onSnooze(15)}
          disabled={busy}
          accessibilityRole="button"
          style={styles.snoozeBtn}
        >
          <Ionicons name="alarm-outline" size={22} color={c.primary} />
          <Typography variant="body" color={c.primary} style={styles.snoozeText}>{t('notification_action.snooze_med')}</Typography>
        </TouchableOpacity>
      </>
    );
  };

  const renderBody = () => {
    if (doseData) {
      if (medication === undefined) return <ActivityIndicator size="large" color={c.primary} style={styles.spinner} />;
      if (medication === null) {
        return (
          <>
            {iconCircle('help-circle', c.textSecondary)}
            <Typography variant="subheader" style={styles.center}>{t('notif_screen.med_gone')}</Typography>
            {closeButton}
          </>
        );
      }
      return renderMedicationBody(medication, doseData);
    }

    if (target?.type === 'water') {
      if (!water) return <ActivityIndicator size="large" color={c.primary} style={styles.spinner} />;
      const goal = (Number.isFinite(waterGoal) && waterGoal > 0 ? waterGoal : 0) + (todayDynamicAdjustment || 0);
      const pct = goal > 0 ? Math.min(100, (water.hydration / goal) * 100) : 0;
      return (
        <>
          {iconCircle('water', c.water)}
          <Typography variant="header" style={styles.title}>{t('notification_action.water_time')}</Typography>
          <View style={styles.progressContainer}>
            <View
              style={[styles.progressBar, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : c.lightGray }]}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
            >
              <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: c.water }]} />
            </View>
            <Typography variant="body" style={styles.gapTop} color={c.textSecondary}>
              {t('notification_action.water_today', { current: water.hydration, goal })}
            </Typography>
          </View>
          <View style={styles.row}>
            <Button title={t('notif_screen.drank', { amount: drinkMl })} onPress={onDrink} loading={busy} style={styles.flex1} />
            <Button title={t('notification_action.snooze_water')} variant="secondary" onPress={() => onSnooze(30)} disabled={busy} style={styles.flex1} />
          </View>
        </>
      );
    }

    // Unknown / legacy payload
    return (
      <>
        <Typography variant="subheader" style={styles.center}>{t('notif_screen.unknown')}</Typography>
        {closeButton}
      </>
    );
  };

  return (
    <ScreenWrapper edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={t('notif_screen.close')}
          style={[styles.closeBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}
        >
          <Ionicons name="close" size={26} color={c.text} />
        </TouchableOpacity>
      </View>
      <View style={styles.content}>
        <Card style={[styles.actionCard, !isDark && SHADOWS.lg]}>{renderBody()}</Card>
      </View>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  header: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, alignItems: 'flex-end' },
  closeBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: SPACING.lg, paddingBottom: 60 },
  actionCard: { padding: SPACING.xl, alignItems: 'center', borderRadius: 24 },
  iconCircle: { width: 90, height: 90, borderRadius: 45, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  title: { marginBottom: 4, textAlign: 'center' },
  center: { textAlign: 'center' },
  stock: { marginTop: 6, fontWeight: '600' },
  gapTop: { marginTop: SPACING.md },
  spinner: { marginVertical: SPACING.xxl },
  progressContainer: { width: '100%', marginTop: SPACING.lg, alignItems: 'center' },
  progressBar: { width: '100%', height: 14, borderRadius: 7, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 7 },
  row: { flexDirection: 'row', gap: 12, marginTop: SPACING.lg, width: '100%' },
  flex1: { flex: 1, minHeight: 52 },
  flex2: { flex: 2, minHeight: 52 },
  fullBtn: { width: '100%', minHeight: 52, marginTop: SPACING.lg },
  snoozeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: SPACING.md, minHeight: 48, paddingHorizontal: SPACING.md },
  snoozeText: { fontWeight: '700', marginLeft: 6 },
});

export default NotificationActionScreen;
