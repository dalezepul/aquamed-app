import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, SPACING } from '../../constants/theme';
import { t, getLocale } from '../../localization/i18n';
import { Typography } from '../common/Typography';
import { Card } from '../common/Card';
import { WeeklyGoal } from '../../services/gamification';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const WeeklyGoalCard: React.FC<{ goal: WeeklyGoal }> = ({ goal }) => {
  const { COLORS: c } = useTheme();
  const locale = getLocale() === 'tr' ? 'tr-TR' : 'en-US';

  return (
    <Card style={[styles.card, goal.achieved && { borderColor: c.success, borderWidth: 2 }]}>
      <View style={styles.header}>
        <Typography variant="subheader" style={styles.title}>{t('gamification.weekly_title', { target: goal.target })}</Typography>
        <Typography variant="subheader" color={goal.achieved ? c.success : c.primary}>
          {t('gamification.weekly_progress', { done: goal.done, target: goal.target })}
        </Typography>
      </View>

      <View style={styles.days}>
        {goal.days.map(({ date, state }) => {
          const d = new Date(date + 'T12:00:00');
          return (
            <View
              key={date}
              style={styles.day}
              accessible
              accessibilityLabel={`${d.toLocaleDateString(locale, { weekday: 'long' })}: ${t(`gamification.day_${state}`)}`}
            >
              <View
                style={[
                  styles.dot,
                  { borderColor: c.border },
                  state === 'done' && { backgroundColor: c.success, borderColor: c.success },
                  state === 'today' && { borderColor: c.primary, borderWidth: 3 },
                  state === 'future' && styles.future,
                ]}
              >
                {state === 'done' && <Ionicons name="checkmark" size={20} color={c.onPrimary} />}
              </View>
              <Typography
                variant="caption"
                color={state === 'today' ? c.primary : c.textSecondary}
                style={state === 'today' && styles.bold}
              >
                {t(`short_days.${DAY_KEYS[d.getDay()]}`)}
              </Typography>
            </View>
          );
        })}
      </View>

      {goal.achieved ? (
        <Typography style={styles.bold} color={c.success}>{t('gamification.weekly_done')}</Typography>
      ) : null}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: { marginBottom: SPACING.md },
  header: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SPACING.sm },
  title: { flex: 1, minWidth: 160 },
  days: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: SPACING.md },
  day: { flex: 1, alignItems: 'center', gap: SPACING.xs },
  dot: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  future: { borderStyle: 'dashed', opacity: 0.5 },
  bold: { fontWeight: '700' },
});
