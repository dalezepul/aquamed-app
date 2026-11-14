import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme, SPACING } from '../../constants/theme';
import { Typography } from '../common/Typography';
import { DayPoint } from '../../utils/measurements';
import { t } from '../../localization/i18n';

interface Props {
  points: DayPoint[];
  height?: number;
  /** Short label under each bar (only shown when there are few bars). */
  label?: (p: DayPoint) => string;
  a11y: (p: DayPoint) => string;
}

/**
 * Plain-View bars, the same technique as the Progress tab's water chart (no chart library).
 * Blood pressure: each bar spans diastolic → systolic. The axis starts near the lowest value, not 0,
 * so small weight/sugar changes stay visible; min/max are printed at the left.
 */
export const MeasurementChart: React.FC<Props> = ({ points, height = 120, label, a11y }) => {
  const { COLORS: c } = useTheme();
  if (!points.length) return null;
  const lows = points.map(p => p.low ?? p.value);
  const hi = Math.max(...points.map(p => p.value));
  const lo = Math.min(...lows);
  const pad = Math.max((hi - lo) * 0.15, hi * 0.03, 1);
  const top = hi + pad, bottom = Math.max(0, lo - pad);
  const y = (v: number) => ((v - bottom) / (top - bottom)) * height;
  const showLabels = !!label && points.length <= 10;

  return (
    <View style={styles.row}>
      <View style={[styles.axis, { height }]}>
        <Typography variant="caption" color={c.textSecondary}>{Math.round(hi)}</Typography>
        <Typography variant="caption" color={c.textSecondary}>{Math.round(lo)}</Typography>
      </View>
      <View style={styles.flex}>
        <View style={[styles.bars, { height, borderColor: c.border }]}>
          {points.map(p => {
            const from = p.low != null ? y(p.low) : 0;
            const h = Math.max(4, y(p.value) - from);
            return (
              <View key={p.date} style={styles.col} accessible accessibilityLabel={a11y(p)}>
                <View style={[styles.bar, { height: h, marginBottom: from, backgroundColor: p.flag ? c.warning : c.primary, maxWidth: points.length > 30 ? 6 : 18 }]} />
              </View>
            );
          })}
        </View>
        {showLabels && (
          <View style={styles.labels}>
            {points.map(p => (
              <Typography key={p.date} variant="caption" color={c.textSecondary} style={styles.col} numberOfLines={1}>{label!(p)}</Typography>
            ))}
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginTop: SPACING.sm },
  flex: { flex: 1 },
  axis: { justifyContent: 'space-between', marginRight: SPACING.xs, minWidth: 28 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1 },
  col: { flex: 1, alignItems: 'center', textAlign: 'center' },
  bar: { width: '70%', borderRadius: 4 },
  labels: { flexDirection: 'row', marginTop: 2 },
});

/** "Yüksek · Doktorunuza danışın" chip for an out-of-range reading (information, not advice). */
export const FlagChip: React.FC<{ flag: 'high' | 'low'; withHint?: boolean }> = ({ flag, withHint }) => {
  const { COLORS: c } = useTheme();
  const color = flag === 'high' ? c.error : c.warning;
  return (
    <View style={chip.wrap}>
      <View style={[chip.pill, { borderColor: color, backgroundColor: color + '1F' }]}>
        <Typography variant="caption" color={color} style={chip.text}>
          {flag === 'high' ? '▲ ' : '▼ '}{t(`measurements.flag_${flag}`)}
        </Typography>
      </View>
      {withHint && <Typography variant="caption" color={c.textSecondary}>{t('measurements.consult')}</Typography>}
    </View>
  );
};

const chip = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SPACING.xs, marginTop: 4 },
  pill: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  text: { fontWeight: '700' },
});
