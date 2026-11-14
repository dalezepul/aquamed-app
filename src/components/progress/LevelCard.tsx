import React from 'react';
import { View, StyleSheet } from 'react-native';

import { useTheme, SPACING } from '../../constants/theme';
import { t } from '../../localization/i18n';
import { Typography } from '../common/Typography';
import { Card } from '../common/Card';
import { LevelInfo } from '../../services/gamification';

export const LevelCard: React.FC<{ level: LevelInfo }> = ({ level }) => {
  const { COLORS: c } = useTheme();
  const name = t(`gamification.level_${level.key}`);
  const pct = Math.round(level.progress * 100);

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: c.waterLight }]}>
          <Typography style={styles.emoji}>{level.icon}</Typography>
        </View>
        <View style={styles.main}>
          <Typography variant="subheader">{t('gamification.level_label', { n: level.index + 1, name })}</Typography>
          <Typography variant="caption" color={c.textSecondary}>{t('gamification.points', { points: level.points })}</Typography>
        </View>
      </View>
      <View
        style={[styles.track, { backgroundColor: c.lightGray }]}
        accessible
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: pct }}
        accessibilityLabel={name}
      >
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: c.water }]} />
      </View>
      <Typography variant="caption" color={c.textSecondary}>
        {level.next
          ? t('gamification.next_level', { name: t(`gamification.level_${level.next.key}`), left: level.next.min - level.points })
          : t('gamification.max_level')}
      </Typography>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: { marginBottom: SPACING.md },
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 30, lineHeight: 38 },
  main: { flex: 1, marginLeft: SPACING.md },
  track: { height: 12, borderRadius: 6, marginTop: SPACING.md, marginBottom: SPACING.xs, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 6 },
});
