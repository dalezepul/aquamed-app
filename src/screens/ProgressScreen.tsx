import React, { useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Share } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { useAppContext } from '../state/AppContext';
import { useTheme, SPACING } from '../constants/theme';
import { t, getLocale } from '../localization/i18n';
import { ScreenWrapper } from '../components/common/ScreenWrapper';
import { useWide, TWO_COLUMN_MAX_WIDTH } from '../hooks/useWide';
import { Typography } from '../components/common/Typography';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { StreakCard } from '../components/progress/StreakCard';
import { LevelCard } from '../components/progress/LevelCard';
import { WeeklyGoalCard } from '../components/progress/WeeklyGoalCard';
import { loadGamification, formatWeekSummary, GamificationState } from '../services/gamification';
import { alertContactViaSms, alertContactViaWhatsApp, CONTACT_ALERT_ENABLED } from '../utils/contactAlert';
import { notify } from '../utils/confirm';
import { storageService } from '../services/storageService';
import { badgeService } from '../services/badgeService';
import { EmptyState } from '../components/EmptyState';
import { Badge } from '../types/models';
import { AdBanner } from '../components/AdBanner';
import { MeasurementsCard } from '../components/measurements/MeasurementsCard';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const CHART_HEIGHT = 160;

const ProgressScreen: React.FC = () => {
  const { COLORS: c } = useTheme();
  const wide = useWide();
  const { waterGoal, dataVersion, emergencyContact } = useAppContext();

  const [refreshing, setRefreshing] = useState(false);
  const [weekly, setWeekly] = useState<{ date: string; value: number }[]>([]);
  const [game, setGame] = useState<GamificationState | null>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [insight, setInsight] = useState('');

  const load = useCallback(async () => {
    await badgeService.triggerAction('analytics'); // also re-evaluates, so new badges show below
    const [w, g, b, i] = await Promise.all([
      storageService.getWeeklyStats(),
      loadGamification(),
      badgeService.getBadges(),
      storageService.getHealthInsights(),
    ]);
    return { w, g, b, i };
  }, []);

  const apply = (r: Awaited<ReturnType<typeof load>>) => {
    setWeekly(r.w);
    setGame(r.g);
    setBadges(r.b);
    setInsight(r.i);
  };

  useFocusEffect(useCallback(() => {
    let active = true;
    load().then(r => { if (active) apply(r); }).catch(console.error);
    return () => { active = false; };
  }, [load, dataVersion]));

  const onRefresh = async () => {
    setRefreshing(true);
    try { apply(await load()); } catch (e) { console.error(e); }
    setRefreshing(false);
  };

  const locale = getLocale() === 'tr' ? 'tr-TR' : 'en-US';
  const liters = (ml: number) => `${(ml / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L`;
  const dayLabel = (date: string, style: 'short' | 'long') => {
    const d = new Date(date + 'T12:00:00');
    return style === 'short' ? t(`short_days.${DAY_KEYS[d.getDay()]}`) : d.toLocaleDateString(locale, { weekday: 'long' });
  };

  const activeDays = weekly.filter(d => d.value > 0);
  const average = activeDays.length ? activeDays.reduce((s, d) => s + d.value, 0) / activeDays.length : 0;
  const scale = Math.max(waterGoal, ...weekly.map(d => d.value)) * 1.1 || 1;
  const goalTop = CHART_HEIGHT - (waterGoal / scale) * CHART_HEIGHT;
  const earnedCount = badges.filter(b => b.earned).length;

  const summaryText = () => (game ? formatWeekSummary(game.week, game.streak.count) : '');

  // Share.share rejects on web browsers without navigator.share → copy to clipboard, else show the text.
  const onShare = async () => {
    const message = summaryText();
    try {
      await Share.share({ message });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return; // user closed the browser share sheet
      try {
        await navigator.clipboard.writeText(message);
        notify(t('gamification.share_copied_title'), t('gamification.share_copied'));
      } catch {
        notify(t('gamification.share_button'), message);
      }
    }
  };

  const sendToContact = async (via: 'sms' | 'whatsapp') => {
    try {
      await (via === 'sms' ? alertContactViaSms : alertContactViaWhatsApp)(emergencyContact.phone, summaryText());
    } catch {
      notify(t('gamification.share_button'), t('gamification.contact_failed'));
    }
  };

  return (
    <ScreenWrapper maxWidth={TWO_COLUMN_MAX_WIDTH}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Typography variant="header">{t('tabs.progress')}</Typography>
        <Typography variant="caption" color={c.textSecondary}>{t('analytics.based_on_7_days')}</Typography>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
      >
        <View style={wide && styles.columns}>
        <View style={wide && styles.half}>
        {game && (
          <>
            <StreakCard streak={game.streak} freezesLeft={game.freezesLeft} />
            <LevelCard level={game.level} />
            <WeeklyGoalCard goal={game.weeklyGoal} />
          </>
        )}

        {activeDays.length === 0 ? (
          <Card style={styles.block}>
            <EmptyState title={t('progress.no_data_title')} description={t('progress.no_data_desc')} iconName="analytics-outline" />
          </Card>
        ) : (
          <>
            <Card style={styles.block}>
              <Typography variant="subheader">{t('analytics.weekly_water')}</Typography>
              <View style={styles.inline}>
                <Ionicons name="water" size={20} color={c.water} style={{ marginRight: SPACING.xs }} />
                <Typography>{t('progress.daily_average')}: {liters(average)}</Typography>
              </View>
              <View style={styles.inline}>
                <View style={[styles.goalSwatch, { borderColor: c.text }]} />
                <Typography variant="caption" color={c.textSecondary}>{t('progress.goal_line', { amount: liters(waterGoal) })}</Typography>
              </View>
              <View style={styles.chart}>
                <View pointerEvents="none" style={[styles.goalLine, { top: goalTop + 18, borderColor: c.text }]} />
                {weekly.map(d => {
                  const met = d.value >= waterGoal;
                  const h = Math.max(d.value > 0 ? 4 : 0, (d.value / scale) * CHART_HEIGHT);
                  return (
                    <View
                      key={d.date}
                      style={styles.column}
                      accessible
                      accessibilityLabel={`${dayLabel(d.date, 'long')}: ${liters(d.value)}${met ? `, ${t('progress.goal_met')}` : ''}`}
                    >
                      <Typography variant="caption" style={styles.value}>
                        {d.value > 0 ? (d.value / 1000).toLocaleString(locale, { maximumFractionDigits: 1 }) : ''}
                      </Typography>
                      <View style={styles.barArea}>
                        <View style={[styles.bar, { height: h, backgroundColor: met ? c.success : c.primary }]} />
                      </View>
                      <Typography variant="caption" color={c.textSecondary} style={styles.center}>{dayLabel(d.date, 'short')}</Typography>
                      <View style={styles.checkSlot}>
                        {met && <Ionicons name="checkmark" size={14} color={c.success} />}
                      </View>
                    </View>
                  );
                })}
              </View>
            </Card>
          </>
        )}
        <MeasurementsCard style={styles.block} />
        </View>

        <View style={wide && styles.half}>
        {insight ? (
          <Card style={[styles.block, styles.inline]}>
            <Ionicons name="bulb-outline" size={24} color={c.primary} style={{ marginRight: SPACING.sm }} />
            <Typography style={{ flex: 1 }}>{insight}</Typography>
          </Card>
        ) : null}

        {game && (activeDays.length > 0 || game.week.plannedDoses > 0) ? (
          <View style={styles.share}>
            <Button title={t('gamification.share_button')} onPress={onShare} />
            {CONTACT_ALERT_ENABLED && emergencyContact.phone ? (
              <>
                <Button variant="secondary" title={t('gamification.send_contact_sms')} onPress={() => sendToContact('sms')} />
                <Button variant="secondary" title={t('gamification.send_contact_whatsapp')} onPress={() => sendToContact('whatsapp')} />
              </>
            ) : null}
          </View>
        ) : null}

        <AdBanner />

        <Typography variant="subheader" style={styles.sectionTitle}>
          {t('badges.section_title')} · {earnedCount}/{badges.length}
        </Typography>
        <View style={{ gap: SPACING.sm }}>
          {badges.map(badge => (
            <Card
              key={badge.id}
              style={[styles.badge, { borderColor: badge.earned ? c.primary : c.border, borderWidth: badge.earned ? 2 : 1 }]}
            >
              <View style={[styles.badgeIcon, { backgroundColor: c.lightGray, opacity: badge.earned ? 1 : 0.45 }]}>
                <Typography style={{ fontSize: 30, lineHeight: 38 }}>{badge.icon}</Typography>
              </View>
              <View style={{ flex: 1 }}>
                <Typography style={{ fontWeight: '700' }} color={badge.earned ? c.text : c.textSecondary}>{t(badge.nameKey)}</Typography>
                <Typography variant="caption" color={c.textSecondary}>{t(badge.descKey)}</Typography>
              </View>
              <View style={styles.badgeState}>
                <Ionicons name={badge.earned ? 'checkmark-circle' : 'lock-closed-outline'} size={24} color={badge.earned ? c.success : c.textSecondary} />
                <Typography variant="caption" color={c.textSecondary}>{badge.earned ? t('badges.unlocked') : t('badges.locked')}</Typography>
              </View>
            </Card>
          ))}
        </View>
        </View>
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  header: { paddingTop: SPACING.md, paddingBottom: SPACING.md, paddingHorizontal: SPACING.lg, borderBottomWidth: 1 },
  content: { padding: SPACING.md, paddingBottom: 100 },
  block: { marginBottom: SPACING.md },
  center: { textAlign: 'center' },
  share: { gap: SPACING.sm, marginBottom: SPACING.md },
  inline: { flexDirection: 'row', alignItems: 'center', marginTop: SPACING.xs },
  goalSwatch: { width: 20, borderTopWidth: 2, borderStyle: 'dashed', marginRight: SPACING.xs },
  chart: { flexDirection: 'row', marginTop: SPACING.sm, position: 'relative' },
  goalLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 2, borderStyle: 'dashed', opacity: 0.6 },
  column: { flex: 1, alignItems: 'center' },
  value: { height: 18, fontVariant: ['tabular-nums'] },
  barArea: { height: CHART_HEIGHT, justifyContent: 'flex-end', width: '100%', alignItems: 'center' },
  bar: { width: '60%', borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  checkSlot: { height: 16 },
  sectionTitle: { marginTop: SPACING.sm, marginBottom: SPACING.sm, marginLeft: SPACING.xs },
  badge: { flexDirection: 'row', alignItems: 'center', padding: SPACING.md, borderRadius: 20 },
  badgeIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginRight: SPACING.md },
  // Wide screens only: stats on the left, share + badges on the right.
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.md },
  half: { flex: 1, minWidth: 0 },
  badgeState: { alignItems: 'center', marginLeft: SPACING.sm, minWidth: 56 },
});

export default ProgressScreen;
