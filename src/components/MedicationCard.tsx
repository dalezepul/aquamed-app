import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Dose, MedicationStatus, Priority } from '../types/models';
import { useTheme, SPACING, SHADOWS } from '../constants/theme';
import { Typography } from './common/Typography';
import { t } from '../localization/i18n';
import { doseDateTime, isStockLow } from '../utils/ScheduleUtils';
import { formatLocalTime } from '../utils/DateUtils';
import { triggerHaptic } from './common/AnimatedTouchable';

export type DoseState = 'taken' | 'skipped' | 'missed' | 'pending';

/** Minutes after the scheduled time before an unmarked dose counts as late. */
export const DOSE_GRACE_MINUTES = 15;

export const doseState = (dose: Dose, now: Date = new Date()): DoseState => {
  if (dose.log) {
    if (dose.log.status === MedicationStatus.Taken) return 'taken';
    if (dose.log.status === MedicationStatus.Skipped) return 'skipped';
    return 'missed';
  }
  return now.getTime() > doseDateTime(dose.date, dose.time).getTime() + DOSE_GRACE_MINUTES * 60000 ? 'missed' : 'pending';
};

interface MedicationCardProps {
  dose: Dose;
  onTake: (dose: Dose) => void;
  onSkip: (dose: Dose) => void;
  onUndo: (dose: Dose) => void;
  onPress: (dose: Dose) => void;
  /** Future day: nothing can be marked yet. */
  disabled?: boolean;
}

export const MedicationCard: React.FC<MedicationCardProps> = ({ dose, onTake, onSkip, onUndo, onPress, disabled = false }) => {
  const { isDark, COLORS: c, isElderly } = useTheme();
  const icon = isElderly ? 28 : 22;
  const { medication: med, time, log } = dose;
  const state = doseState(dose);

  const priorityColor = med.priority === Priority.High ? c.error : med.priority === Priority.Medium ? c.warning : c.success;
  const stateColor = { taken: c.success, skipped: c.textSecondary, missed: c.error, pending: c.primary }[state];
  const stateIcon = ({ taken: 'checkmark-circle', skipped: 'remove-circle', missed: 'alert-circle', pending: 'time-outline' } as const)[state];
  const stateText = {
    taken: t('dose_card.state_taken', { time: log ? formatLocalTime(new Date(log.timestamp)) : '' }),
    skipped: t('dose_card.state_skipped'),
    missed: t('dose_card.state_missed'),
    pending: t('dose_card.state_pending'),
  }[state];

  const details = [med.dosage, med.foodTiming && med.foodTiming !== 'any' ? t(`dose_card.food_${med.foodTiming}`) : null].filter(Boolean).join(' · ');
  const lowStock = isStockLow(med);
  const a11y = { name: med.name, time };

  const skipButton = (
    <TouchableOpacity
      disabled={disabled}
      onPress={() => { triggerHaptic('warning'); onSkip(dose); }}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={t('dose_card.a11y_skip', a11y)}
      style={[styles.btn, { flex: 1, borderWidth: 1.5, borderColor: c.border, opacity: disabled ? 0.4 : 1 }, isElderly && styles.btnLarge]}
    >
      <Ionicons name="close" size={icon} color={c.textSecondary} />
      <Typography variant="body" color={c.textSecondary} style={styles.btnText}>{t('dose_card.skip')}</Typography>
    </TouchableOpacity>
  );
  const takeButton = (
    <TouchableOpacity
      disabled={disabled}
      onPress={() => { triggerHaptic('success'); onTake(dose); }}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={t('dose_card.a11y_take', a11y)}
      style={[styles.btn, { flex: 2, backgroundColor: c.primary, opacity: disabled ? 0.4 : 1 }, isElderly && styles.btnTake]}
    >
      <Ionicons name="checkmark" size={isElderly ? 34 : 22} color={c.onPrimary} />
      <Typography variant={isElderly ? 'subheader' : 'body'} color={c.onPrimary} style={styles.btnText}>{t('dose_card.take')}</Typography>
    </TouchableOpacity>
  );

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: c.card, borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' },
        !isDark && SHADOWS.md,
      ]}
    >
      <View style={[styles.priorityIndicator, { backgroundColor: priorityColor }]} />
      <View style={styles.body}>
        <TouchableOpacity
          onPress={() => onPress(dose)}
          accessibilityRole="button"
          accessibilityLabel={t('dose_card.a11y_open', a11y)}
          style={styles.info}
        >
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Typography variant="subheader" color={c.text} numberOfLines={2}>{med.name}</Typography>
              {!!details && <Typography variant="body" color={c.textSecondary}>{details}</Typography>}
            </View>
            <View style={[styles.timePill, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : c.lightGray }]}>
              <Typography variant={isElderly ? 'header' : 'subheader'} color={state === 'missed' ? c.error : c.text}>{time}</Typography>
            </View>
          </View>

          <View style={styles.statusRow}>
            <View style={[styles.badge, { backgroundColor: stateColor + '22' }]}>
              <Ionicons name={stateIcon} size={isElderly ? 24 : 18} color={stateColor} />
              <Typography variant="caption" color={stateColor} style={styles.badgeText}>{stateText}</Typography>
            </View>
            {med.stock && (
              <Typography variant="caption" color={lowStock ? c.error : c.textSecondary} style={lowStock ? styles.bold : undefined}>
                {t('dose_card.stock_left', { count: med.stock.remaining })}
              </Typography>
            )}
          </View>
        </TouchableOpacity>

        {log ? (
          <TouchableOpacity
            onPress={() => { triggerHaptic('light'); onUndo(dose); }}
            accessibilityRole="button"
            accessibilityLabel={t('dose_card.a11y_undo', a11y)}
            style={[styles.btn, styles.undoBtn, { borderColor: c.border }, isElderly && styles.btnLarge]}
          >
            <Ionicons name="arrow-undo" size={icon} color={c.textSecondary} />
            <Typography variant="body" color={c.textSecondary} style={styles.btnText}>{t('dose_card.undo')}</Typography>
          </TouchableOpacity>
        ) : (
          <View style={[styles.actions, isElderly && styles.actionsStacked]}>
            {/* Elderly: "Taken" comes first on screen and for screen readers */}
            {isElderly ? <>{takeButton}{skipButton}</> : <>{skipButton}{takeButton}</>}
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    marginVertical: SPACING.xs,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  priorityIndicator: { width: 6 },
  body: { flex: 1, padding: SPACING.md },
  info: { minHeight: 48 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm },
  timePill: { paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.sm },
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  badgeText: { marginLeft: 4, fontWeight: '700' },
  bold: { fontWeight: '700' },
  actions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
  btn: { minHeight: 48, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.md },
  undoBtn: { alignSelf: 'flex-start', borderWidth: 1, marginTop: SPACING.md },
  btnText: { marginLeft: 6, fontWeight: '700' },
  // Elderly: full-width stacked buttons, "Aldım" first and largest.
  actionsStacked: { flexDirection: 'column', gap: SPACING.md },
  btnLarge: { flex: 0, minHeight: 56, alignSelf: 'stretch' },
  btnTake: { flex: 0, minHeight: 76, alignSelf: 'stretch' },
});

export default MedicationCard;
