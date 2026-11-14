import React, { useCallback, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { useAppContext } from '../../state/AppContext';
import { useTheme, SPACING } from '../../constants/theme';
import { t, getLocale } from '../../localization/i18n';
import { Card } from '../common/Card';
import { Typography } from '../common/Typography';
import { Button } from '../common/Button';
import { MeasurementChart, FlagChip } from './MeasurementChart';
import { storageService } from '../../services/storageService';
import { Measurement } from '../../types/models';
import { classifyMeasurement } from '../../constants/measurementRanges';
import { MEASUREMENT_TYPES, UNITS, dailySeries, formatMeasurementValue } from '../../utils/measurements';
import { addDays, getLocalDayString } from '../../utils/DateUtils';

/** Progress tab: latest reading of each type + a 30-day trend of the most recently measured type. */
export const MeasurementsCard: React.FC<{ style?: object }> = ({ style }) => {
  const { COLORS: c } = useTheme();
  const { dataVersion } = useAppContext();
  const navigation = useNavigation<any>();
  const [list, setList] = useState<Measurement[]>([]);

  useFocusEffect(useCallback(() => {
    let active = true;
    storageService.getMeasurements().then(l => { if (active) setList(l); }).catch(console.error);
    return () => { active = false; };
  }, [dataVersion]));

  const locale = getLocale() === 'tr' ? 'tr-TR' : 'en-US';
  const latest = MEASUREMENT_TYPES.map(type => list.find(m => m.type === type)).filter(Boolean) as Measurement[];
  const trendType = list[0]?.type;
  const series = trendType ? dailySeries(list, trendType, addDays(getLocalDayString(), -29)) : [];

  return (
    <Card style={style}>
      <Pressable
        onPress={() => navigation.navigate('Measurements', trendType ? { type: trendType } : undefined)}
        accessibilityRole="button"
        accessibilityLabel={`${t('measurements.title')}, ${t('measurements.see_all')}`}
        style={styles.head}
      >
        <Typography variant="subheader" style={styles.flex}>{t('measurements.title')}</Typography>
        <Typography variant="caption" color={c.primary}>{t('measurements.see_all')}</Typography>
        <Ionicons name="chevron-forward" size={18} color={c.primary} />
      </Pressable>

      {latest.length === 0 ? (
        <Typography color={c.textSecondary} style={styles.desc}>{t('measurements.empty_desc')}</Typography>
      ) : (
        latest.map(m => {
          const flag = classifyMeasurement(m);
          return (
            <Pressable key={m.type} onPress={() => navigation.navigate('Measurements', { type: m.type })} accessibilityRole="button" style={[styles.row, { borderTopColor: c.border }]}>
              <View style={styles.rowTop}>
                <Typography style={styles.flex}>{t(`measurements.type_${m.type}`)}</Typography>
                <Typography style={styles.value}>{formatMeasurementValue(m, locale)} <Typography variant="caption" color={c.textSecondary}>{UNITS[m.type]}</Typography></Typography>
              </View>
              <Typography variant="caption" color={c.textSecondary}>
                {new Date(m.timestamp).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                {m.context ? ` · ${t(`measurements.ctx_${m.context}`)}` : ''}
              </Typography>
              {flag && <FlagChip flag={flag} withHint />}
            </Pressable>
          );
        })
      )}

      {series.length > 1 && trendType && (
        <View style={styles.trend}>
          <Typography variant="caption" color={c.textSecondary}>{t(`measurements.type_${trendType}`)} · {t('measurements.period_days', { days: 30 })}</Typography>
          <MeasurementChart
            points={series}
            height={60}
            a11y={p => `${p.date}: ${formatMeasurementValue({ type: trendType, value: p.value, diastolic: p.low }, locale)} ${UNITS[trendType]}`}
          />
        </View>
      )}

      <Button variant="secondary" title={t('measurements.add')} onPress={() => navigation.navigate('AddMeasurement', trendType ? { type: trendType } : undefined)} style={styles.add} />
    </Card>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  desc: { marginTop: SPACING.xs },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: SPACING.sm, marginTop: SPACING.xs },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: SPACING.sm },
  value: { fontWeight: '700' },
  trend: { marginTop: SPACING.sm },
  add: { marginTop: SPACING.md },
});
