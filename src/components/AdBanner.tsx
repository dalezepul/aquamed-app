import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme, SPACING } from '../constants/theme';
import { t } from '../localization/i18n';
import { Typography } from './common/Typography';
import { usePlus } from '../services/entitlement';
import { adsLib, adUnitId, requestOptions, useAdsReady } from '../services/ads';

/** Adaptive banner for free users; renders nothing on web, for Plus, or until ads are allowed. */
export const AdBanner: React.FC = () => {
  const { COLORS: c } = useTheme();
  const plus = usePlus();
  const ready = useAdsReady();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const L = ready && !plus && !failed ? adsLib() : null;
  if (!L) return null;

  return (
    <View style={[styles.wrap, { borderTopColor: c.border }, !loaded && styles.hidden]}>
      {loaded && <Typography variant="caption" color={c.textSecondary} style={styles.label}>{t('ads.label')}</Typography>}
      <L.BannerAd
        unitId={adUnitId('banner')}
        size={L.BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={requestOptions()}
        onAdLoaded={() => setLoaded(true)}
        onAdFailedToLoad={() => setFailed(true)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  // Kept well apart from the content above so it never reads as part of a dose card.
  wrap: { marginTop: SPACING.xl, paddingTop: SPACING.sm, borderTopWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  hidden: { height: 0, overflow: 'hidden', marginTop: 0, paddingTop: 0, borderTopWidth: 0 },
  label: { alignSelf: 'flex-start', marginLeft: SPACING.md, marginBottom: 4 },
});
