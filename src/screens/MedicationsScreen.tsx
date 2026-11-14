import React, { useState, useCallback } from 'react';
import { View, FlatList, StyleSheet, RefreshControl, Pressable, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, SPACING } from '../constants/theme';
import { t } from '../localization/i18n';
import { useAppContext } from '../state/AppContext';
import { ScreenWrapper } from '../components/common/ScreenWrapper';
import { ScreenHeader } from '../components/common/ScreenHeader';
import { Typography } from '../components/common/Typography';
import { storageService } from '../services/storageService';
import { getReadableSchedule, isStockLow } from '../utils/ScheduleUtils';
import { Medication } from '../types/models';
import { canScheduleExactAlarms, openExactAlarmSettings } from '../../modules/exact-alarm';
import { useAppState } from '../hooks/useAppState';


const MedicationsScreen: React.FC<any> = ({ navigation }) => {
  useAppState(); // re-check the exact-alarm permission when returning from system settings
  const { COLORS } = useTheme();
  const { dataVersion } = useAppContext();
  const [medications, setMedications] = useState<Medication[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const meds = await storageService.getMedications();
      setMedications([...meds].sort((a, b) => Number(a.isPaused) - Number(b.isPaused) || a.name.localeCompare(b.name)));
    } catch (e) {
      console.error('Failed to fetch medications:', e);
    }
  }, []);

  // dataVersion in deps → refetch while focused whenever data changes
  useFocusEffect(useCallback(() => { load(); }, [load, dataVersion]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const addMedication = () => navigation.navigate('AddEditMedication', {});

  const AddButton = (
    <Pressable
      onPress={addMedication}
      accessibilityRole="button"
      accessibilityLabel={t('add_medication.title')}
      style={({ pressed }) => [styles.addBtn, { backgroundColor: COLORS.primary, opacity: pressed ? 0.85 : 1 }]}
    >
      <Ionicons name="add-circle" size={28} color={COLORS.onPrimary} />
      <Typography style={styles.addBtnText} color={COLORS.onPrimary}>{t('add_medication.title')}</Typography>
    </Pressable>
  );

  const renderItem = ({ item }: { item: Medication }) => {
    const low = isStockLow(item);
    return (
      <Pressable
        onPress={() => navigation.navigate('MedicationDetailModal', { medicationId: item.id })}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}${item.dosage ? ', ' + item.dosage : ''}, ${item.times.join(', ')}`}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: COLORS.card, borderColor: COLORS.border, opacity: item.isPaused ? 0.7 : pressed ? 0.9 : 1 },
        ]}
      >
        {item.photoUri ? (
          <Image source={{ uri: item.photoUri }} style={styles.thumb} accessibilityIgnoresInvertColors />
        ) : (
          <View style={[styles.thumb, styles.thumbIcon, { backgroundColor: COLORS.primary + '1A' }]}>
            <Ionicons name="medkit" size={28} color={COLORS.primary} />
          </View>
        )}
        <View style={styles.body}>
          <Typography variant="subheader" numberOfLines={2}>{item.name}</Typography>
          {!!item.dosage && <Typography color={COLORS.textSecondary}>{item.dosage}</Typography>}
          <Typography style={styles.times} color={COLORS.primary}>{item.times.join(' · ')}</Typography>
          <Typography variant="caption" color={COLORS.textSecondary}>{getReadableSchedule(item)}</Typography>
          <View style={styles.badges}>
            {item.foodTiming !== 'any' && (
              <Badge color={COLORS.secondary} icon="restaurant-outline" text={t(`food_timing.${item.foodTiming}`)} />
            )}
            {item.isPaused && <Badge color={COLORS.textSecondary} icon="pause-circle-outline" text={t('medications.paused')} />}
            {low && item.stock && (
              <Badge color={COLORS.error} icon="alert-circle-outline" text={t('medications.stock_low', { count: item.stock.remaining })} />
            )}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={22} color={COLORS.textSecondary} />
      </Pressable>
    );
  };

  return (
    <ScreenWrapper>
      <ScreenHeader title={t('tabs.medications')} />
      <FlatList
        data={medications}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        ListHeaderComponent={medications.length > 0 && !canScheduleExactAlarms() ? (
          // Android 12+ without "Alarms & reminders": reminders can arrive up to an hour late.
          <Pressable
            onPress={() => openExactAlarmSettings()}
            style={[styles.exactWarn, { borderColor: COLORS.warning, backgroundColor: COLORS.warning + '14' }]}
            accessibilityRole="button"
          >
            <Ionicons name="alarm-outline" size={24} color={COLORS.warning} />
            <View style={{ flex: 1 }}>
              <Typography style={{ fontWeight: '700' }} color={COLORS.warning}>{t('medications.exact_warn_title')}</Typography>
              <Typography variant="caption">{t('medications.exact_warn_body')}</Typography>
            </View>
          </Pressable>
        ) : null}
        contentContainerStyle={medications.length === 0 ? styles.emptyContainer : styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="medkit-outline" size={64} color={COLORS.textSecondary} />
            <Typography variant="subheader" style={styles.center}>{t('medications.empty_title')}</Typography>
            <Typography color={COLORS.textSecondary} style={styles.center}>{t('medications.empty_desc')}</Typography>
            {AddButton}
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} tintColor={COLORS.primary} />}
      />
      {medications.length > 0 && <View style={[styles.footer, { borderTopColor: COLORS.border }]}>{AddButton}</View>}
    </ScreenWrapper>
  );
};

const Badge = ({ color, icon, text }: { color: string; icon: keyof typeof Ionicons.glyphMap; text: string }) => (
  <View style={[styles.badge, { borderColor: color, backgroundColor: color + '14' }]}>
    <Ionicons name={icon} size={14} color={color} />
    <Typography variant="caption" color={color} style={styles.badgeText}>{text}</Typography>
  </View>
);

const styles = StyleSheet.create({
  exactWarn: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: SPACING.md, borderWidth: 1.5, borderRadius: 14, minHeight: 56 },
  list: { padding: SPACING.md, gap: SPACING.md },
  emptyContainer: { flexGrow: 1, justifyContent: 'center', padding: SPACING.lg },
  empty: { alignItems: 'center', gap: SPACING.md },
  center: { textAlign: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md, borderRadius: 20, borderWidth: 1 },
  thumb: { width: 64, height: 64, borderRadius: 14 },
  thumbIcon: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  times: { fontSize: 18, fontWeight: '800', marginTop: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  badgeText: { fontWeight: '700' },
  footer: { padding: SPACING.md, borderTopWidth: StyleSheet.hairlineWidth },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, minHeight: 60, borderRadius: 16, paddingHorizontal: SPACING.lg, alignSelf: 'stretch' },
  addBtnText: { fontSize: 19, fontWeight: '800' },
});

export default MedicationsScreen;
