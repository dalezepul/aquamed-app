import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, SPACING } from '../../constants/theme';
import { t, getLocale } from '../../localization/i18n';
import { Typography } from '../common/Typography';
import { Card } from '../common/Card';
import { notify } from '../../utils/confirm';
import { StreakResult, daysToNextFreeze } from '../../utils/streak';
import { Button } from '../common/Button';
import { usePlus } from '../../services/entitlement';
import { showRewardedAd, useAdsReady } from '../../services/ads';
import { storageService, ADS_PER_FREEZE } from '../../services/storageService';
import { useToast } from '../../hooks/useToast';
import { useAppContext } from '../../state/AppContext';

interface Props {
  streak: StreakResult;
  freezesLeft: number;
}

export const StreakCard: React.FC<Props> = ({ streak, freezesLeft }) => {
  const { COLORS: c } = useTheme();
  const plus = usePlus();
  const adsReady = useAdsReady();
  const { refreshAppData } = useAppContext();
  const { showToast } = useToast();
  const [adProgress, setAdProgress] = useState(0);
  const [watching, setWatching] = useState(false);
  const full = freezesLeft >= 3;
  const toNext = daysToNextFreeze(streak.count, freezesLeft);

  useEffect(() => { storageService.getRewardedAdProgress().then(setAdProgress).catch(() => {}); }, []);

  const watchAd = async () => {
    setWatching(true);
    try {
      if (!(await showRewardedAd())) return;
      const { progress, granted } = await storageService.recordRewardedAd();
      setAdProgress(progress);
      if (granted) {
        showToast({ message: t('ads.freeze_granted'), type: 'success' });
        refreshAppData();
      }
    } finally {
      setWatching(false);
    }
  };
  const locale = getLocale() === 'tr' ? 'tr-TR' : 'en-US';
  const frozen = streak.frozenDays
    .map(d => new Date(d + 'T12:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'long' }))
    .join(', ');

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Ionicons name="flame" size={32} color={c.accent} />
        <View style={styles.main} accessible>
          <Typography variant="header">{streak.count}</Typography>
          <Typography variant="caption" color={c.textSecondary}>{t('progress.streak_days')}</Typography>
        </View>
        <TouchableOpacity
          onPress={() => notify(t('gamification.freeze_info_title'), t('gamification.freeze_rules'))}
          style={styles.info}
          accessibilityRole="button"
          accessibilityLabel={t('gamification.freeze_info_title')}
        >
          <Ionicons name="information-circle-outline" size={28} color={c.primary} />
        </TouchableOpacity>
      </View>
      <Typography style={styles.line}>{t('gamification.freeze_left', { count: freezesLeft })}</Typography>
      {toNext !== null && (
        <Typography variant="caption" color={c.textSecondary}>{t('gamification.freeze_countdown', { count: toNext })}</Typography>
      )}
      {frozen ? (
        <Typography variant="caption" color={c.textSecondary}>{t('gamification.freeze_used', { days: frozen })}</Typography>
      ) : null}
      {plus ? (
        <View style={styles.plusRow}>
          <Ionicons name="sparkles" size={18} color={c.primary} />
          <Typography variant="caption" color={c.textSecondary}>{t('ads.plus_monthly_freeze')}</Typography>
        </View>
      ) : adsReady ? (
        <Button
          style={styles.adBtn}
          variant="secondary"
          loading={watching}
          disabled={full || watching}
          title={full ? t('ads.freezes_full') : t('ads.watch_for_freeze', { done: adProgress, total: ADS_PER_FREEZE })}
          accessibilityHint={t('ads.watch_for_freeze_hint')}
          onPress={watchAd}
        />
      ) : null}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: { marginBottom: SPACING.md },
  row: { flexDirection: 'row', alignItems: 'center' },
  main: { flex: 1, marginLeft: SPACING.md },
  info: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  line: { marginTop: SPACING.sm },
  adBtn: { marginTop: SPACING.md },
  plusRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginTop: SPACING.md },
});
