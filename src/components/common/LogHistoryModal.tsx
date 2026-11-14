import React, { useState, useEffect, useCallback } from 'react';
import { View, Modal, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from './Typography';
import { useTheme, SPACING, SHADOWS } from '../../constants/theme';
import { storageService } from '../../services/storageService';
import { notificationService } from '../../services/notificationService';
import { useAppContext } from '../../state/AppContext';
import { WaterLog, MedicationLog, MedicationStatus, BeverageType } from '../../types/models';
import { t, getLocale } from '../../localization/i18n';
import { getLocalDayString, addDays } from '../../utils/DateUtils';
import { confirm } from '../../utils/confirm';
import { AdBanner } from '../AdBanner';

interface LogHistoryModalProps {
  visible: boolean;
  onClose: () => void;
  onLogDeleted: () => void;
}

const STATUS_KEY: Record<MedicationStatus, string> = {
  [MedicationStatus.Taken]: 'common.taken',
  [MedicationStatus.Skipped]: 'common.skipped',
  [MedicationStatus.Missed]: 'common.missed',
};

const formatDay = (day: string) =>
  new Date(day + 'T12:00:00').toLocaleDateString(getLocale() === 'tr' ? 'tr-TR' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const LogHistoryModal: React.FC<LogHistoryModalProps> = ({ visible, onClose, onLogDeleted }) => {
  const { COLORS: c } = useTheme();
  const { refreshAppData } = useAppContext();
  const today = getLocalDayString();
  const [day, setDay] = useState(today);
  const [waterLogs, setWaterLogs] = useState<WaterLog[]>([]);
  const [medLogs, setMedLogs] = useState<MedicationLog[]>([]);
  const [reload, setReload] = useState(0);

  useEffect(() => { if (visible) setDay(getLocalDayString()); }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    Promise.all([storageService.getWaterLogsByDate(day), storageService.getLogsForDate(day)]).then(([w, m]) => {
      if (!active) return;
      setWaterLogs(w.sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
      setMedLogs(m.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime)));
    }).catch(console.error);
    return () => { active = false; };
  }, [visible, day, reload]);

  const afterDelete = useCallback(async () => {
    setReload(r => r + 1);
    await notificationService.rescheduleAll();
    await refreshAppData();
    onLogDeleted();
  }, [refreshAppData, onLogDeleted]);

  const handleDeleteWater = async (log: WaterLog) => {
    if (!(await confirm(t('common.delete'), t('settings.delete_water_confirm'), t('common.delete'), true))) return;
    await storageService.deleteWaterLog(log.id);
    await afterDelete();
  };

  const handleDeleteMedication = async (log: MedicationLog) => {
    if (!(await confirm(t('common.delete'), t('settings.delete_med_confirm'), t('common.delete'), true))) return;
    await storageService.deleteMedicationLog(log.id);
    await afterDelete();
  };

  const canGoForward = day < today;
  const totalWater = waterLogs.reduce((s, l) => s + (l.hydrationAmountMl ?? l.amountMl), 0);

  const Row = ({ icon, color, title, subtitle, onDelete, deleteLabel }: {
    icon: keyof typeof Ionicons.glyphMap; color: string; title: string; subtitle: string; onDelete: () => void; deleteLabel: string;
  }) => (
    <View style={[styles.logItem, { backgroundColor: c.lightGray }]}>
      <View style={[styles.logIcon, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <View style={styles.logDetails}>
        <Typography style={{ fontWeight: '600' }}>{title}</Typography>
        <Typography variant="caption" color={c.textSecondary}>{subtitle}</Typography>
      </View>
      <TouchableOpacity onPress={onDelete} style={styles.iconButton} accessibilityRole="button" accessibilityLabel={deleteLabel}>
        <Ionicons name="trash-outline" size={22} color={c.error} />
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: c.background }]}>
          <View style={[styles.header, { borderBottomColor: c.border }]}>
            <Typography variant="subheader">{t('settings.log_history')}</Typography>
            <TouchableOpacity onPress={onClose} style={styles.iconButton} accessibilityRole="button" accessibilityLabel={t('log_history.close')}>
              <Ionicons name="close" size={26} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={[styles.dateSelector, { borderBottomColor: c.border }]}>
            <TouchableOpacity onPress={() => setDay(addDays(day, -1))} style={styles.iconButton} accessibilityRole="button" accessibilityLabel={t('log_history.prev_day')}>
              <Ionicons name="chevron-back" size={26} color={c.primary} />
            </TouchableOpacity>
            <Typography style={styles.dateText}>
              {day === today ? `${t('medication_detail.today')}, ` : ''}{formatDay(day)}
            </Typography>
            <TouchableOpacity
              onPress={() => canGoForward && setDay(addDays(day, 1))}
              disabled={!canGoForward}
              style={[styles.iconButton, !canGoForward && { opacity: 0.3 }]}
              accessibilityRole="button"
              accessibilityLabel={t('log_history.next_day')}
              accessibilityState={{ disabled: !canGoForward }}
            >
              <Ionicons name="chevron-forward" size={26} color={c.primary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            <Typography variant="subheader" style={styles.sectionTitle}>
              {t('common.water')}{totalWater > 0 ? ` · ${totalWater} ml` : ''}
            </Typography>
            {waterLogs.length === 0 ? (
              <Typography color={c.textSecondary} style={styles.empty}>{t('log_history.no_water')}</Typography>
            ) : waterLogs.map(log => (
              <Row
                key={log.id}
                icon="water"
                color={c.water}
                title={`${log.amountMl} ml ${t(`beverages.${log.beverageType || BeverageType.Water}`)}`}
                subtitle={storageService.logTime(log)}
                onDelete={() => handleDeleteWater(log)}
                deleteLabel={t('log_history.delete_water_label', { amount: log.amountMl, time: storageService.logTime(log) })}
              />
            ))}

            <Typography variant="subheader" style={styles.sectionTitle}>{t('common.medication')}</Typography>
            {medLogs.length === 0 ? (
              <Typography color={c.textSecondary} style={styles.empty}>{t('log_history.no_meds')}</Typography>
            ) : medLogs.map(log => {
              const name = log.medicationName || t('history.unknown_medication');
              return (
                <Row
                  key={log.id}
                  icon="medkit"
                  color={c.secondary}
                  title={log.dosage ? `${name} · ${log.dosage}` : name}
                  subtitle={`${log.scheduledTime} · ${t(STATUS_KEY[log.status] ?? 'common.unknown')}`}
                  onDelete={() => handleDeleteMedication(log)}
                  deleteLabel={t('log_history.delete_med_label', { name, time: log.scheduledTime })}
                />
              );
            })}
            <AdBanner />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'flex-end' },
  container: { height: '85%', borderTopLeftRadius: 24, borderTopRightRadius: 24, ...SHADOWS.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingLeft: SPACING.lg, paddingRight: SPACING.sm, paddingVertical: SPACING.sm, borderBottomWidth: 1 },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  dateSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs, borderBottomWidth: 1 },
  dateText: { flex: 1, textAlign: 'center', fontWeight: '700' },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  sectionTitle: { marginBottom: SPACING.sm, marginTop: SPACING.sm },
  empty: { marginBottom: SPACING.md },
  logItem: { flexDirection: 'row', alignItems: 'center', paddingLeft: SPACING.md, paddingVertical: SPACING.xs, borderRadius: 12, marginBottom: SPACING.sm },
  logIcon: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: SPACING.md },
  logDetails: { flex: 1 },
});
