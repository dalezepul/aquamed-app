import React, { useCallback, useState } from 'react';
import { View, FlatList, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { useAppContext } from '../state/AppContext';
import { useTheme, SPACING } from '../constants/theme';
import { t, getLocale } from '../localization/i18n';
import { ScreenWrapper } from '../components/common/ScreenWrapper';
import { ScreenHeader } from '../components/common/ScreenHeader';
import { Typography } from '../components/common/Typography';
import { Card } from '../components/common/Card';
import { Segmented } from '../components/common/Segmented';
import { EmptyState } from '../components/EmptyState';
import { MeasurementChart, FlagChip } from '../components/measurements/MeasurementChart';
import { storageService } from '../services/storageService';
import { Measurement, MeasurementType } from '../types/models';
import { classifyMeasurement } from '../constants/measurementRanges';
import { MEASUREMENT_TYPES, UNITS, dailySeries, formatMeasurementValue } from '../utils/measurements';
import { addDays, getLocalDayString, formatLocalTime } from '../utils/DateUtils';

const PERIODS = [7, 30, 90] as const;

/** Readings of one type: 7/30/90-day chart (daily averages) and the list. Tap a row to edit it. */
const MeasurementsScreen: React.FC<any> = ({ navigation, route }) => {
  const { COLORS: c } = useTheme();
  const { dataVersion } = useAppContext();
  const [type, setType] = useState<MeasurementType>(route.params?.type ?? 'bp');
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [list, setList] = useState<Measurement[]>([]);

  useFocusEffect(useCallback(() => {
    let active = true;
    storageService.getMeasurements().then(l => { if (active) setList(l); }).catch(console.error);
    return () => { active = false; };
  }, [dataVersion]));

  const locale = getLocale() === 'tr' ? 'tr-TR' : 'en-US';
  const fromDay = addDays(getLocalDayString(), -(days - 1));
  const rows = list.filter(m => m.type === type && getLocalDayString(new Date(m.timestamp)) >= fromDay);
  const series = dailySeries(list, type, fromDay);
  const unit = UNITS[type];
  const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(d + 'T12:00:00').toLocaleDateString(locale, opts);

  const header = (
    <View style={styles.top}>
      <Segmented label={t('measurements.type_filter')} value={type} onChange={setType}
        options={MEASUREMENT_TYPES.map(v => ({ value: v, label: t(`measurements.type_${v}`) }))} />
      <View style={styles.gap} />
      <Segmented label={t('measurements.period_label')} value={days} onChange={setDays}
        options={PERIODS.map(v => ({ value: v, label: t('measurements.period_days', { days: v }) }))} />
      {series.length > 0 && (
        <Card style={styles.chartCard}>
          <Typography variant="caption" color={c.textSecondary}>{t('measurements.chart_hint')} · {unit}</Typography>
          <MeasurementChart
            points={series}
            label={p => dayLabel(p.date, { day: 'numeric', month: 'numeric' })}
            a11y={p => `${dayLabel(p.date, { day: 'numeric', month: 'long' })}: ${formatMeasurementValue({ type, value: p.value, diastolic: p.low }, locale)} ${unit}`}
          />
        </Card>
      )}
    </View>
  );

  return (
    <ScreenWrapper edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={t('measurements.title')}
        onBackPress={() => navigation.goBack()}
        rightButtonIcon="add"
        onRightButtonPress={() => navigation.navigate('AddMeasurement', { type })}
        rightButtonAccessibilityLabel={t('measurements.add')}
      />
      <FlatList
        data={rows}
        keyExtractor={m => m.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState iconName="pulse-outline" title={t('measurements.empty_title')}
            description={t('measurements.no_data_period', { type: t(`measurements.type_${type}`) })} />
        }
        ListFooterComponent={<Typography variant="caption" color={c.textSecondary} style={styles.footer}>{t('measurements.disclaimer')}</Typography>}
        renderItem={({ item: m }) => {
          const flag = classifyMeasurement(m);
          const d = new Date(m.timestamp);
          const extra = [
            m.context ? t(`measurements.ctx_${m.context}`) : '',
            m.pulse ? t('measurements.pulse_value', { value: m.pulse }) : '',
          ].filter(Boolean).join(' · ');
          return (
            <Pressable
              onPress={() => navigation.navigate('AddMeasurement', { id: m.id })}
              accessibilityRole="button"
              accessibilityHint={t('measurements.edit')}
              style={[styles.row, { borderColor: c.border, backgroundColor: c.card }]}
            >
              <View style={styles.rowTop}>
                <Typography variant="subheader">{formatMeasurementValue(m, locale)} <Typography variant="caption" color={c.textSecondary}>{unit}</Typography></Typography>
                <Typography variant="caption" color={c.textSecondary}>
                  {d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} {formatLocalTime(d)}
                </Typography>
              </View>
              {extra ? <Typography variant="caption" color={c.textSecondary}>{extra}</Typography> : null}
              {m.note ? <Typography variant="caption">{m.note}</Typography> : null}
              {flag && <FlagChip flag={flag} withHint />}
            </Pressable>
          );
        }}
      />
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  content: { padding: SPACING.md, paddingBottom: 60, gap: SPACING.sm },
  top: { marginBottom: SPACING.xs },
  gap: { height: SPACING.sm },
  chartCard: { marginTop: SPACING.md },
  row: { borderWidth: 1, borderRadius: 16, padding: SPACING.md },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: SPACING.sm, flexWrap: 'wrap' },
  footer: { marginTop: SPACING.md, textAlign: 'center' },
});

export default MeasurementsScreen;
