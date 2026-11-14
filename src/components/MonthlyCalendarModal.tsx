import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Modal, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, SPACING, SHADOWS } from '../constants/theme';
import { Typography } from './common/Typography';
import { storageService, STORAGE_KEYS } from '../services/storageService';
import { useAppContext } from '../state/AppContext';
import { getLocalDayString } from '../utils/DateUtils';
import { getDosesForDate, doseDateTime } from '../utils/ScheduleUtils';
import { MedicationStatus } from '../types/models';
import { t, getLocale } from '../localization/i18n';

interface MonthlyCalendarModalProps {
  isVisible: boolean;
  onClose: () => void;
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
}

type WaterState = 'met' | 'partial' | 'none';
type DoseState = 'all' | 'some' | 'none' | 'planned' | 'empty';
interface DayInfo { water: WaterState; doses: DoseState }

const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const DOSE_ICON: Record<Exclude<DoseState, 'empty'>, { icon: keyof typeof Ionicons.glyphMap; color: 'success' | 'warning' | 'error' | 'textSecondary' }> = {
  all: { icon: 'checkmark-circle', color: 'success' },
  some: { icon: 'contrast', color: 'warning' },
  none: { icon: 'close-circle', color: 'error' },
  planned: { icon: 'ellipse-outline', color: 'textSecondary' },
};

/** Water and dose status for every day of the month. Today only counts doses whose time has come. */
const loadMonth = async (year: number, month: number, now: Date): Promise<Map<string, DayInfo>> => {
  const [waterLogs, medLogs, meds, currentGoal, rawGoals] = await Promise.all([
    storageService.getAllWaterLogs(),
    storageService.getAllMedicationLogs(),
    storageService.getMedications(),
    storageService.getWaterGoal(),
    storageService.getRawData(STORAGE_KEYS.WATER_GOAL_HISTORY),
  ]);
  let goals: Record<string, number> = {};
  try { goals = JSON.parse(rawGoals || '{}'); } catch { /* current goal only */ }
  const goalDates = Object.keys(goals).sort();
  const goalFor = (day: string) => {
    for (let i = goalDates.length - 1; i >= 0; i--) if (goalDates[i] <= day) return goals[goalDates[i]];
    return currentGoal;
  };

  const water = new Map<string, number>();
  waterLogs.forEach(l => {
    const d = getLocalDayString(new Date(l.timestamp));
    water.set(d, (water.get(d) || 0) + (l.hydrationAmountMl ?? l.amountMl));
  });

  const today = getLocalDayString(now);
  const result = new Map<string, DayInfo>();
  const days = new Date(year, month + 1, 0).getDate();
  for (let i = 1; i <= days; i++) {
    const day = getLocalDayString(new Date(year, month, i));
    const ml = water.get(day) || 0;
    const waterState: WaterState = ml >= goalFor(day) ? 'met' : ml > 0 ? 'partial' : 'none';

    const doses = getDosesForDate(meds, medLogs, day);
    let doseState: DoseState = 'empty';
    if (doses.length) {
      const due = day > today ? [] : doses.filter(d => day < today || d.log || doseDateTime(day, d.time) <= now);
      const taken = due.filter(d => d.log?.status === MedicationStatus.Taken).length;
      doseState = !due.length ? 'planned' : taken === due.length ? 'all' : taken > 0 ? 'some' : 'none';
    }
    result.set(day, { water: waterState, doses: doseState });
  }
  return result;
};

export const MonthlyCalendarModal: React.FC<MonthlyCalendarModalProps> = ({ isVisible, onClose, selectedDate, onDateSelect }) => {
  const { COLORS: c } = useTheme();
  const { dataVersion } = useAppContext();
  const { width } = useWindowDimensions();
  const [month, setMonth] = useState(() => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  const [info, setInfo] = useState<Map<string, DayInfo>>(new Map());
  const requestId = useRef(0);

  const selStr = getLocalDayString(selectedDate);
  useEffect(() => {
    if (isVisible) setMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, selStr]);

  useEffect(() => {
    if (!isVisible) return;
    const id = ++requestId.current;
    setInfo(new Map());
    loadMonth(month.getFullYear(), month.getMonth(), new Date())
      .then(map => { if (id === requestId.current) setInfo(map); }) // a newer month may have been requested meanwhile
      .catch(console.error);
  }, [isVisible, month, dataVersion]);

  const locale = getLocale() === 'tr' ? 'tr-TR' : 'en-US';
  const modalWidth = Math.min(width - SPACING.md * 2, 440);
  const cellSize = Math.floor((modalWidth - SPACING.md * 2) / 7);
  const todayStr = getLocalDayString();

  const describe = (day: string, d?: DayInfo) => {
    const parts = [new Date(day + 'T12:00:00').toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })];
    if (d) {
      parts.push(t(`calendar.water_${d.water}`));
      if (d.doses !== 'empty') parts.push(t(`calendar.doses_${d.doses}`));
    }
    return parts.join(', ');
  };

  const cells: React.ReactNode[] = [];
  const offset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7; // Monday first
  for (let i = 0; i < offset; i++) cells.push(<View key={`e${i}`} style={{ width: cellSize, height: cellSize * 1.3 }} />);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  for (let i = 1; i <= daysInMonth; i++) {
    const date = new Date(month.getFullYear(), month.getMonth(), i);
    const day = getLocalDayString(date);
    const d = info.get(day);
    const isToday = day === todayStr;
    const isSel = day === selStr;
    const dose = d && d.doses !== 'empty' ? DOSE_ICON[d.doses] : null;
    cells.push(
      <TouchableOpacity
        key={day}
        style={[
          styles.cell,
          { width: cellSize, height: cellSize * 1.3 },
          isSel && { backgroundColor: c.primary + '22', borderColor: c.primary, borderWidth: 2 },
        ]}
        onPress={() => onDateSelect(date)}
        accessibilityRole="button"
        accessibilityState={{ selected: isSel }}
        accessibilityLabel={describe(day, d)}
      >
        <Typography style={{ fontWeight: isToday ? '800' : '500', color: isToday ? c.primary : c.text, textDecorationLine: isToday ? 'underline' : 'none' }}>
          {i}
        </Typography>
        <View style={styles.marks}>
          {d && d.water !== 'none' && (
            <Ionicons name={d.water === 'met' ? 'water' : 'water-outline'} size={13} color={c.water} />
          )}
          {dose && <Ionicons name={dose.icon} size={13} color={c[dose.color]} />}
        </View>
      </TouchableOpacity>
    );
  }

  const LegendItem = ({ icon, color, label }: { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }) => (
    <View style={styles.legendItem}>
      <Ionicons name={icon} size={16} color={color} />
      <Typography variant="caption" color={c.textSecondary} style={{ marginLeft: 4 }}>{label}</Typography>
    </View>
  );

  const shiftMonth = (n: number) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1));

  return (
    <Modal visible={isVisible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} accessibilityLabel={t('calendar.close')} />
        <View style={[styles.modal, { width: modalWidth, backgroundColor: c.card }]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => shiftMonth(-1)} style={styles.navBtn} accessibilityRole="button" accessibilityLabel={t('calendar.prev_month')}>
              <Ionicons name="chevron-back" size={26} color={c.text} />
            </TouchableOpacity>
            <Typography variant="subheader" style={{ textTransform: 'capitalize' }}>
              {month.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
            </Typography>
            <TouchableOpacity onPress={() => shiftMonth(1)} style={styles.navBtn} accessibilityRole="button" accessibilityLabel={t('calendar.next_month')}>
              <Ionicons name="chevron-forward" size={26} color={c.text} />
            </TouchableOpacity>
          </View>

          <View style={[styles.weekRow, { borderBottomColor: c.border }]}>
            {WEEK.map(k => (
              <Typography key={k} variant="caption" color={c.textSecondary} style={{ width: cellSize, textAlign: 'center', fontWeight: '700' }}>
                {t(`days.${k}`)}
              </Typography>
            ))}
          </View>

          <View style={styles.grid}>{cells}</View>

          <View style={[styles.legend, { borderTopColor: c.border }]}>
            <LegendItem icon="water" color={c.water} label={t('calendar.legend_water_met')} />
            <LegendItem icon="water-outline" color={c.water} label={t('calendar.legend_water_partial')} />
            <LegendItem icon="checkmark-circle" color={c.success} label={t('calendar.legend_all')} />
            <LegendItem icon="contrast" color={c.warning} label={t('calendar.legend_some')} />
            <LegendItem icon="close-circle" color={c.error} label={t('calendar.legend_none')} />
            <LegendItem icon="ellipse-outline" color={c.textSecondary} label={t('calendar.legend_planned')} />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modal: { borderRadius: 24, padding: SPACING.md, ...SHADOWS.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  navBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  weekRow: { flexDirection: 'row', borderBottomWidth: 1, paddingBottom: SPACING.sm, marginBottom: SPACING.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  marks: { flexDirection: 'row', gap: 2, height: 14, marginTop: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: SPACING.md, rowGap: SPACING.xs, marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1 },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
});
