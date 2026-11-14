import React, { useCallback, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Image, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useAppContext } from '../state/AppContext';
import { useTheme, SPACING } from '../constants/theme';
import { t, getLocale } from '../localization/i18n';
import { useWide, centered, FORM_MAX_WIDTH } from '../hooks/useWide';
import { Typography } from '../components/common/Typography';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { storageService } from '../services/storageService';
import { notificationService } from '../services/notificationService';
import { getReadableSchedule, getUpcomingDates, getDosesForDate, doseDateTime, isStockLow } from '../utils/ScheduleUtils';
import { getLocalDayString, addDays } from '../utils/DateUtils';
import { confirm, notify } from '../utils/confirm';
import { Medication, MedicationLog, MedicationStatus, Priority } from '../types/models';
import { useStockBox } from '../hooks/useStockBox';

const HISTORY_DAYS = 30;

/** 'YYYY-MM-DD' → local date text (noon avoids the UTC-midnight off-by-one). */
const formatDay = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(day + 'T12:00:00').toLocaleDateString(getLocale() === 'tr' ? 'tr-TR' : 'en-US', opts);

const STATUS_ICON: Record<MedicationStatus, { icon: keyof typeof Ionicons.glyphMap; key: string; color: 'success' | 'warning' | 'error' }> = {
  [MedicationStatus.Taken]: { icon: 'checkmark-circle', key: 'common.taken', color: 'success' },
  [MedicationStatus.Skipped]: { icon: 'remove-circle', key: 'common.skipped', color: 'warning' },
  [MedicationStatus.Missed]: { icon: 'close-circle', key: 'common.missed', color: 'error' },
};

interface Adherence { taken: number; planned: number }

/** Taken ÷ planned doses over the last 30 days; today's doses count once due (or once logged). */
const computeAdherence = (med: Medication, logs: MedicationLog[], now: Date): Adherence => {
  const today = getLocalDayString(now);
  let day = med.startDate > addDays(today, -(HISTORY_DAYS - 1)) ? med.startDate : addDays(today, -(HISTORY_DAYS - 1));
  // Pause history isn't recorded, so count the schedule as if it was never paused.
  const active = { ...med, isPaused: false };
  let taken = 0, planned = 0;
  for (; day <= today; day = addDays(day, 1)) {
    for (const dose of getDosesForDate([active], logs, day)) {
      if (day === today && !dose.log && doseDateTime(day, dose.time) > now) continue;
      planned++;
      if (dose.log?.status === MedicationStatus.Taken) taken++;
    }
  }
  return { taken, planned };
};

const MedicationDetailModal: React.FC<any> = ({ navigation, route }) => {
  const { COLORS: c } = useTheme();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const { refreshAppData, dataVersion } = useAppContext();
  const { medicationId } = route.params;

  const [medication, setMedication] = useState<Medication | null>(null);
  const [logs, setLogs] = useState<MedicationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const stockBox = useStockBox();

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      const [med, all] = await Promise.all([storageService.getMedication(medicationId), storageService.getAllMedicationLogs()]);
      if (!active) return;
      setMedication(med);
      setLogs(all.filter(l => l.medicationId === medicationId));
      setLoading(false);
    })().catch(e => { console.error('Failed to load medication:', e); if (active) setLoading(false); });
    return () => { active = false; };
  }, [medicationId, dataVersion]));

  const afterChange = async () => {
    await notificationService.rescheduleAll();
    await refreshAppData();
  };

  const handleTogglePause = async () => {
    if (!medication || busy) return;
    setBusy(true);
    try {
      await storageService.saveMedication({ ...medication, isPaused: !medication.isPaused });
      await afterChange();
    } catch (e) {
      console.error('Failed to toggle pause:', e);
      notify(t('common.error'), t('common.operation_failed'));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!medication || busy) return;
    const ok = await confirm(t('add_medication.delete_title'), t('add_medication.delete_confirm'), t('common.delete'), true);
    if (!ok) return;
    setBusy(true);
    try {
      await storageService.deleteMedication(medication.id);
      await afterChange();
      navigation.goBack();
    } catch (e) {
      console.error('Failed to delete medication:', e);
      notify(t('common.error'), t('add_medication.error_delete'));
      setBusy(false);
    }
  };

  const header = (
    <View style={[styles.header, { paddingTop: Platform.OS === 'ios' ? SPACING.md : insets.top + SPACING.sm }]}>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={[styles.iconButton, { backgroundColor: c.lightGray }]}
        accessibilityRole="button"
        accessibilityLabel={t('medication_detail.back')}
      >
        <Ionicons name="arrow-back" size={24} color={c.text} />
      </TouchableOpacity>
      <Typography variant="subheader">{t('medication_detail.title')}</Typography>
      <View style={styles.iconButton} />
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        {header}
        <View style={styles.centered}><Typography>{t('common.loading')}</Typography></View>
      </View>
    );
  }

  if (!medication) {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        {header}
        <View style={styles.centered}>
          <Ionicons name="search-outline" size={48} color={c.textSecondary} />
          <Typography variant="subheader" style={styles.centerText}>{t('medication_detail.not_found_title')}</Typography>
          <Typography color={c.textSecondary} style={styles.centerText}>{t('medication_detail.not_found_desc')}</Typography>
          <Button title={t('medication_detail.go_back')} onPress={() => navigation.goBack()} style={{ marginTop: SPACING.lg }} />
        </View>
      </View>
    );
  }

  const now = new Date();
  const today = getLocalDayString(now);
  const since = addDays(today, -(HISTORY_DAYS - 1));
  const recent = logs
    .filter(l => l.scheduledDate >= since && l.scheduledDate <= today)
    .sort((a, b) => (b.scheduledDate + b.scheduledTime).localeCompare(a.scheduledDate + a.scheduledTime));
  const adherence = computeAdherence(medication, logs, now);
  const adherencePct = adherence.planned ? Math.round((adherence.taken / adherence.planned) * 100) : null;
  const upcoming = medication.isPaused ? [] : getUpcomingDates(medication, 3, now);
  const stock = medication.stock;
  const perDay = stock ? stock.perDose * medication.times.length : 0;
  const daysLeft = stock && perDay > 0 ? Math.floor(stock.remaining / perDay) : null;
  const stockLow = isStockLow(medication);
  const priorityKey = { [Priority.High]: 'common.high', [Priority.Medium]: 'common.medium', [Priority.Low]: 'common.low' }[medication.priority];

  const InfoRow = ({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) => (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={22} color={c.textSecondary} style={styles.infoIcon} />
      <View style={{ flex: 1 }}>
        <Typography variant="caption" color={c.textSecondary}>{label}</Typography>
        <Typography>{value}</Typography>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      {header}
      <ScrollView contentContainerStyle={[styles.content, wide && centered(FORM_MAX_WIDTH), { paddingBottom: insets.bottom + SPACING.xl }]}>
        <Card>
          {medication.photoUri ? (
            <Image
              source={{ uri: medication.photoUri }}
              style={styles.photo}
              resizeMode="cover"
              accessibilityLabel={t('medication_detail.photo_label', { name: medication.name })}
            />
          ) : null}
          <Typography variant="header" style={{ fontSize: 26, lineHeight: 32 }}>{medication.name}</Typography>
          {medication.dosage ? <Typography variant="subheader" color={c.textSecondary}>{medication.dosage}</Typography> : null}
          {medication.isPaused && (
            <View style={[styles.pill, { backgroundColor: c.warning + '26' }]}>
              <Ionicons name="pause" size={16} color={c.text} />
              <Typography variant="caption" style={{ marginLeft: 4 }}>{t('medication_detail.paused_badge')}</Typography>
            </View>
          )}
          {medication.notes ? <Typography style={{ marginTop: SPACING.sm }}>{medication.notes}</Typography> : null}

          <View style={[styles.divider, { backgroundColor: c.border }]} />

          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={22} color={c.textSecondary} style={styles.infoIcon} />
            <View style={{ flex: 1 }}>
              <Typography variant="caption" color={c.textSecondary}>{t('medication_detail.times')}</Typography>
              <View style={styles.chips}>
                {medication.times.map(time => (
                  <View key={time} style={[styles.chip, { backgroundColor: c.primary + '1A' }]}>
                    <Typography style={{ fontWeight: '700' }}>{time}</Typography>
                  </View>
                ))}
              </View>
            </View>
          </View>
          <InfoRow icon="repeat-outline" label={t('medication_detail.schedule')} value={getReadableSchedule(medication)} />
          <InfoRow
            icon="calendar-outline"
            label={t('medication_detail.period')}
            value={medication.endDate
              ? t('medication_detail.date_range', { start: formatDay(medication.startDate, { day: 'numeric', month: 'long', year: 'numeric' }), end: formatDay(medication.endDate, { day: 'numeric', month: 'long', year: 'numeric' }) })
              : t('medication_detail.date_from', { start: formatDay(medication.startDate, { day: 'numeric', month: 'long', year: 'numeric' }) })}
          />
          <InfoRow icon="restaurant-outline" label={t('medication_detail.food_timing')} value={t(`medication_detail.food_${medication.foodTiming ?? 'any'}`)} />
          <InfoRow icon="flag-outline" label={t('common.priority')} value={t(priorityKey)} />

          {stock && (
            <View style={styles.infoRow}>
              <Ionicons name="cube-outline" size={22} color={c.textSecondary} style={styles.infoIcon} />
              <View style={{ flex: 1 }}>
                <Typography variant="caption" color={c.textSecondary}>{t('medication_detail.stock')}</Typography>
                <Typography>
                  {t('medication_detail.stock_value', { remaining: stock.remaining, total: stock.total })}
                  {daysLeft !== null ? ` · ${t('medication_detail.stock_days', { count: daysLeft })}` : ''}
                </Typography>
                <View
                  style={[styles.barBg, { backgroundColor: c.lightGray }]}
                  accessibilityRole="progressbar"
                  accessibilityValue={{ min: 0, max: stock.total, now: stock.remaining }}
                >
                  <View style={{ width: `${Math.min(100, (stock.remaining / Math.max(1, stock.total)) * 100)}%`, height: '100%', borderRadius: 6, backgroundColor: stockLow ? c.error : c.success }} />
                </View>
                {stockLow && (
                  <View style={styles.inline}>
                    <Ionicons name="warning" size={16} color={c.error} />
                    <Typography variant="caption" color={c.error} style={{ marginLeft: 4 }}>{t('medication_detail.stock_low')}</Typography>
                  </View>
                )}
                <Button
                  title={stock.boxSize ? t('stock_box.add_box_n', { count: stock.boxSize }) : t('stock_box.add_box')}
                  variant="secondary"
                  onPress={async () => {
                    const updated = await stockBox.addBox(medication);
                    if (updated) { setMedication(updated); refreshAppData(); }
                  }}
                  style={{ marginTop: SPACING.sm }}
                />
              </View>
            </View>
          )}
        </Card>

        <Typography variant="subheader" style={styles.sectionTitle}>{t('medication_detail.upcoming_schedule')}</Typography>
        <Card>
          {upcoming.length ? upcoming.map(day => (
            <View key={day} style={styles.row}>
              <Ionicons name={day === today ? 'calendar' : 'calendar-outline'} size={20} color={day === today ? c.primary : c.textSecondary} />
              <Typography style={{ marginLeft: SPACING.md, flex: 1, fontWeight: day === today ? '700' : '400' }}>
                {day === today ? t('medication_detail.today') : formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' })}
              </Typography>
            </View>
          )) : (
            <Typography color={c.textSecondary}>
              {medication.isPaused ? t('medication_detail.paused_no_upcoming') : t('medication_detail.no_upcoming')}
            </Typography>
          )}
        </Card>

        <Typography variant="subheader" style={styles.sectionTitle}>{t('medication_detail.recent_history')}</Typography>
        <Card>
          <Typography variant="caption" color={c.textSecondary}>{t('medication_detail.adherence_title')}</Typography>
          {adherencePct === null ? (
            <Typography color={c.textSecondary}>{t('medication_detail.adherence_none')}</Typography>
          ) : (
            <>
              <Typography variant="header">%{adherencePct}</Typography>
              <Typography color={c.textSecondary}>
                {t('medication_detail.adherence_detail', { taken: adherence.taken, planned: adherence.planned })}
              </Typography>
            </>
          )}
          <View style={[styles.divider, { backgroundColor: c.border }]} />
          {recent.length ? recent.map(log => {
            const s = STATUS_ICON[log.status] ?? STATUS_ICON[MedicationStatus.Missed];
            return (
              <View key={log.id} style={styles.row}>
                <Ionicons name={s.icon} size={24} color={c[s.color]} />
                <View style={{ marginLeft: SPACING.md, flex: 1 }}>
                  <Typography style={{ fontWeight: '600' }}>
                    {formatDay(log.scheduledDate, { weekday: 'short', day: 'numeric', month: 'short' })} · {log.scheduledTime}
                  </Typography>
                  <Typography variant="caption" color={c.textSecondary}>
                    {t(s.key)}
                    {log.status === MedicationStatus.Taken ? ` · ${t('medication_detail.taken_at')} ${storageService.logTime(log)}` : ''}
                  </Typography>
                </View>
              </View>
            );
          }) : (
            <Typography color={c.textSecondary}>{t('medication_detail.no_recent_logs')}</Typography>
          )}
        </Card>

        <Button
          title={t('medication_detail.edit')}
          onPress={() => navigation.navigate('AddEditMedication', { medicationId: medication.id })}
          style={{ marginTop: SPACING.lg }}
        />
        <Button
          title={medication.isPaused ? t('medication_detail.resume') : t('medication_detail.pause')}
          onPress={handleTogglePause}
          variant="secondary"
          loading={busy}
          style={{ marginTop: SPACING.sm }}
        />
        <Button
          title={t('medication_detail.delete_button')}
          onPress={handleDelete}
          variant="destructive"
          disabled={busy}
          style={{ marginTop: SPACING.sm }}
        />
      </ScrollView>
      {stockBox.sheet}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  centerText: { textAlign: 'center', marginTop: SPACING.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm },
  iconButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  content: { padding: SPACING.md },
  photo: { width: '100%', height: 220, borderRadius: 16, marginBottom: SPACING.md },
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginTop: SPACING.sm },
  divider: { height: 1, marginVertical: SPACING.md },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: SPACING.md },
  infoIcon: { marginRight: SPACING.sm, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  barBg: { height: 12, borderRadius: 6, overflow: 'hidden', marginTop: 6 },
  inline: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  sectionTitle: { marginTop: SPACING.lg, marginBottom: SPACING.sm, marginLeft: 4 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingVertical: 6 },
});

export default MedicationDetailModal;
