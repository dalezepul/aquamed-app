import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, Linking, AccessibilityInfo, DimensionValue } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  FadeInDown, ZoomIn, SharedValue, useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay, cancelAnimation, Easing,
} from 'react-native-reanimated';

import { useTheme, SPACING } from '../constants/theme';
import { t, getLocale } from '../localization/i18n';
import { ScreenWrapper } from '../components/common/ScreenWrapper';
import { ScreenHeader } from '../components/common/ScreenHeader';
import { Typography } from '../components/common/Typography';
import { Button } from '../components/common/Button';
import { notify } from '../utils/confirm';
import { useToast } from '../hooks/useToast';
import { useAppContext } from '../state/AppContext';
import { getPackages, isStoreConfigured, purchase, restore, usePlus, PlusPackages, PurchaseResult } from '../services/entitlement';
import { FALLBACK, Plan, savings } from '../services/plusBilling';

const PRIVACY_URL = 'https://dalezepul.github.io/aquamed-gizlilik/';
const PLAY_SUBSCRIPTIONS_URL = 'https://play.google.com/store/account/subscriptions';

// Each feature its own vivid colour (white icon on top: all >= 3:1).
const FEATURES: { icon: keyof typeof Ionicons.glyphMap; key: string; colors: [string, string]; desc?: string }[] = [
  { icon: 'ban-outline', key: 'no_ads', colors: ['#6366F1', '#8B5CF6'] },
  { icon: 'people-outline', key: 'pairing', colors: ['#EC4899', '#E11D48'], desc: 'paywall.feature_pairing_desc_either' }, // Plus on either side unlocks the pair
  { icon: 'document-text-outline', key: 'doctor_report', colors: ['#059669', '#0D9488'] }, // the 7-day PDF/CSV stay free
  { icon: 'snow-outline', key: 'monthly_freeze', colors: ['#0284C7', '#2563EB'] },
];

// ---- Motion (decorative; stops when the screen is hidden or the system asks for reduced motion) ----

const useReduceMotion = () => {
  const [reduce, setReduce] = useState(true); // assume reduced until the system answers: no flash of motion
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => setReduce(false));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
};

/** 0 -> 1 over `ms`, forever (after `pause` each round) while `on`; parked at 0 otherwise. */
const useLoop = (ms: number, on: boolean, pause = 0) => {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = 0;
    if (on) v.value = withRepeat(withDelay(pause, withTiming(1, { duration: ms, easing: Easing.linear })), -1, false);
    return () => cancelAnimation(v);
  }, [on]);
  return v;
};

const TAU = Math.PI * 2;
const BAND_W = 70;

/** Diagonal light band sweeping left -> right inside a rounded clip (button, annual plan). */
const Shimmer = ({ on, radius, pause }: { on: boolean; radius: number; pause: number }) => {
  const [w, setW] = useState(0);
  const p = useLoop(1100, on && w > 0, pause);
  const band = useAnimatedStyle(() => ({ transform: [{ translateX: -BAND_W * 1.5 + p.value * (w + BAND_W * 2) }, { rotate: '20deg' }] }));
  if (!on) return null;
  return (
    <View pointerEvents="none" onLayout={e => setW(e.nativeEvent.layout.width)} style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
      <Animated.View style={[styles.band, band]}>
        <LinearGradient colors={['#FFFFFF00', '#FFFFFF59', '#FFFFFF00']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
};

type Spark = { left: DimensionValue; top: DimensionValue; size: number; phase: number };
const SPARKS: Spark[] = [
  { left: '9%', top: '16%', size: 14, phase: 0 },
  { left: '84%', top: '12%', size: 18, phase: 0.3 },
  { left: '80%', top: '60%', size: 12, phase: 0.55 },
  { left: '12%', top: '66%', size: 16, phase: 0.75 },
  { left: '48%', top: '5%', size: 10, phase: 0.15 },
  { left: '91%', top: '38%', size: 10, phase: 0.9 },
];

/** Twinkling star: fades in and out while drifting up, phase-shifted on the hero's clock. */
const Sparkle = ({ t, left, top, size, phase, color }: Spark & { t: SharedValue<number>; color: string }) => {
  const style = useAnimatedStyle(() => {
    const x = (t.value * 4 + phase) % 1;
    const s = Math.sin(Math.PI * x);
    return { opacity: 0.15 + 0.85 * s, transform: [{ translateY: -10 * x }, { scale: 0.6 + 0.6 * s }, { rotate: `${x * 90}deg` }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.spark, { left, top }, style]}>
      <Ionicons name="sparkles" size={size} color={color} />
    </Animated.View>
  );
};

const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat(getLocale() === 'en' ? 'en-US' : 'tr-TR', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};

const PaywallScreen: React.FC<any> = ({ navigation }) => {
  const { COLORS: c, isElderly } = useTheme();
  const { showToast } = useToast();
  const { refreshAppData } = useAppContext();
  const plus = usePlus();
  const [packages, setPackages] = useState<PlusPackages>({});
  const [plan, setPlan] = useState<Plan>('annual');
  const [busy, setBusy] = useState(false);

  useEffect(() => { getPackages().then(setPackages); }, []);

  // Prices and the trial come from Play's offer details; FALLBACK only while Play returned nothing (test build, offline).
  const loaded = !!(packages.annual || packages.monthly);
  const currency = packages.annual?.currency ?? packages.monthly?.currency ?? FALLBACK.currency;
  const amount = (p: Plan) => packages[p]?.price ?? FALLBACK[p];
  const price = (p: Plan) => t(`paywall.price_per_${p}`, { price: packages[p]?.priceString ?? money(FALLBACK[p], FALLBACK.currency) });
  /** Trial days only if Play offers this user a trial (it drops the offer once used); fallback: annual has 7. */
  const trialDays = (p: Plan) => (loaded ? packages[p]?.trialDays ?? null : p === 'annual' ? FALLBACK.trialDays : null);
  const save = savings(amount('monthly'), amount('annual'));
  const savePct = save.pct;
  const perMonth = money(save.perMonth, currency);
  const heroTrial = trialDays('annual');
  const planTrial = trialDays(plan);

  const storeMissing = () => notify(t('paywall.title'), t('paywall.store_not_ready'));

  const report = (r: PurchaseResult, okKey: string) => {
    if (r === 'ok') showToast({ message: t(okKey), type: 'success' });
    else if (r === 'unavailable') storeMissing();
    else if (r === 'failed') notify(t('paywall.title'), t(okKey === 'paywall.restored' ? 'paywall.restore_none' : 'paywall.purchase_failed'));
  };

  const run = async (fn: () => Promise<PurchaseResult>, okKey: string) => {
    if (!isStoreConfigured()) return storeMissing();
    setBusy(true);
    try {
      const r = await fn();
      if (r === 'ok') refreshAppData(); // bonus freeze was just granted → streak card/notifications re-read it
      report(r, okKey);
    } finally { setBusy(false); }
  };

  const enter = (i: number) => FadeInDown.delay(80 + i * 70).duration(380);

  const focused = useIsFocused();
  const reduceMotion = useReduceMotion();
  const motion = focused && !reduceMotion;
  const clock = useLoop(12000, motion); // one slow clock drives the hero layers, beam, halo and sparkles
  const layerA = useAnimatedStyle(() => {
    const a = Math.sin(clock.value * TAU);
    return { opacity: 0.55 + 0.25 * a, transform: [{ translateX: -40 + 50 * a }, { translateY: 20 * Math.cos(clock.value * TAU) }] };
  });
  const layerB = useAnimatedStyle(() => {
    const a = Math.sin(clock.value * TAU + 2);
    return { opacity: 0.45 + 0.25 * a, transform: [{ translateX: 40 * a }, { translateY: -20 * a }] };
  });
  const layerC = useAnimatedStyle(() => {
    const a = Math.sin(clock.value * TAU * 2 + 4);
    return { opacity: 0.25 + 0.2 * a, transform: [{ translateX: 60 * a }] };
  });
  const beam = useAnimatedStyle(() => ({ transform: [{ rotate: `${clock.value * 720}deg` }] }));
  const halo = useAnimatedStyle(() => {
    const p = (Math.sin(clock.value * TAU * 6) + 1) / 2;
    return { opacity: 0.35 + 0.55 * p, transform: [{ scale: 1.02 + 0.1 * p }] };
  });

  const hero = (
    <Animated.View entering={enter(0)}>
      <LinearGradient
        colors={[c.primary, c.secondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        {/* Drifting colour layers (violet / pink / indigo, dark enough for white text), decorative only */}
        <Animated.View pointerEvents="none" style={[styles.layer, layerA]}>
          <LinearGradient colors={['#7C3AED', '#7C3AED00']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0.7 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.layer, layerB]}>
          <LinearGradient colors={['#BE185D00', '#BE185D']} start={{ x: 0.2, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.layer, layerC]}>
          <LinearGradient colors={['#4338CA00', '#4338CA', '#4338CA00']} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
        {SPARKS.map((sp, i) => <Sparkle key={i} {...sp} t={clock} color={i % 2 ? '#FDE68A' : c.onPrimary} />)}

        <View style={styles.iconWrap}>
          <Animated.View pointerEvents="none" style={[styles.beam, beam]}>
            <LinearGradient colors={['#FFFFFF00', '#FFFFFF55', '#FFFFFF00']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.halo, { borderColor: c.onPrimary, boxShadow: `0 0 18px 4px ${c.onPrimary}99` }, halo]} />
          <Animated.View entering={ZoomIn.delay(200).duration(420)} style={[styles.iconRing, { backgroundColor: c.onPrimary + '29' }]}>
            <View style={[styles.iconCore, { backgroundColor: c.onPrimary }]}>
              <Ionicons name={plus ? 'checkmark-circle' : 'sparkles'} size={40} color={plus ? c.success : c.primary} />
            </View>
          </Animated.View>
        </View>

        <Typography variant="header" color={c.onPrimary} style={[styles.center, styles.heroText]}>
          {plus ? t('paywall.active_title') : t('paywall.title')}
        </Typography>
        <Typography color={c.onPrimary} style={[styles.center, styles.heroSub, styles.heroText]}>
          {plus ? t('paywall.active_body') : t('paywall.subtitle')}
        </Typography>
        {(plus || !!heroTrial) && (
          <View style={[styles.chip, { backgroundColor: c.onPrimary }]}>
            <Ionicons name={plus ? 'star' : 'gift-outline'} size={16} color={c.primary} />
            <Typography variant="caption" color={c.primary} style={styles.bold}>
              {plus ? t('paywall.active_chip') : t('paywall.trial_chip_days', { days: heroTrial })}
            </Typography>
          </View>
        )}
      </LinearGradient>
    </Animated.View>
  );

  const features = (
    <View style={styles.grid}>
      {FEATURES.map((f, i) => {
        return (
          <Animated.View
            key={f.key}
            entering={enter(i + 1)}
            style={[styles.feature, isElderly ? styles.full : styles.half, { backgroundColor: c.card, borderColor: c.lightGray }]}
          >
            <View style={styles.featureTop}>
              <LinearGradient colors={f.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.featureIcon, { boxShadow: `0 4px 12px ${f.colors[1]}55` }]}>
                <Ionicons name={f.icon} size={24} color="#FFFFFF" />
              </LinearGradient>
              {plus && <Ionicons name="checkmark-circle" size={22} color={c.success} accessibilityLabel={t('paywall.included')} />}
            </View>
            <Typography style={styles.bold}>{t(`paywall.feature_${f.key}_title`)}</Typography>
            <Typography variant="caption" color={c.textSecondary}>{t(f.desc ?? `paywall.feature_${f.key}_desc`)}</Typography>
          </Animated.View>
        );
      })}
    </View>
  );

  const PlanCard = ({ p }: { p: Plan }) => {
    const selected = plan === p;
    const isAnnual = p === 'annual';
    return (
      <TouchableOpacity
        onPress={() => setPlan(p)}
        activeOpacity={0.85}
        accessibilityRole="radio"
        accessibilityState={{ selected, checked: selected }}
        accessibilityLabel={[t(`paywall.plan_${p}`), price(p), isAnnual ? t('paywall.save_pct', { pct: savePct }) : null].filter(Boolean).join(', ')}
        style={[
          styles.plan,
          isAnnual && styles.planAnnual,
          { borderColor: selected ? c.primary : c.border, backgroundColor: selected ? c.waterLight : c.card },
          selected && { boxShadow: `0 0 16px 2px ${c.primary}80` }, // glowing edge
        ]}
      >
        {isAnnual && <Shimmer on={motion} radius={18} pause={3200} />}
        {isAnnual && (
          <View style={[styles.ribbon, { backgroundColor: c.secondary }]}>
            <Ionicons name="flame" size={13} color={c.onPrimary} />
            <Typography variant="caption" color={c.onPrimary} style={styles.bold}>{t('paywall.most_popular')}</Typography>
          </View>
        )}
        <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={28} color={selected ? c.primary : c.textSecondary} />
        <View style={styles.flex1}>
          <Typography style={styles.bold}>{t(`paywall.plan_${p}`)}</Typography>
          <Typography variant="caption" color={c.textSecondary}>
            {isAnnual ? t('paywall.per_month_equiv', { price: perMonth }) : t('paywall.monthly_note')}
          </Typography>
        </View>
        <View style={styles.planRight}>
          {isAnnual && (
            <View style={[styles.badge, { backgroundColor: c.success }]}>
              <Typography variant="caption" color={c.onPrimary} style={styles.bold}>{t('paywall.save_pct', { pct: savePct })}</Typography>
            </View>
          )}
          <Typography style={styles.price}>{price(p)}</Typography>
        </View>
      </TouchableOpacity>
    );
  };

  const TextLink = ({ label, onPress, role = 'link' }: { label: string; onPress: () => void; role?: 'link' | 'button' }) => (
    <TouchableOpacity onPress={onPress} disabled={busy} accessibilityRole={role} style={styles.link}>
      <Typography variant="caption" color={c.primary} style={[styles.bold, styles.underline]}>{label}</Typography>
    </TouchableOpacity>
  );

  return (
    <ScreenWrapper>
      <ScreenHeader
        title="AquaMed Plus"
        rightButtonIcon="close"
        onRightButtonPress={() => navigation.goBack()}
        rightButtonAccessibilityLabel={t('common.close')}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {hero}

        <Typography variant="subheader" style={styles.sectionTitle}>
          {plus ? t('paywall.features_active_title') : t('paywall.features_title')}
        </Typography>
        {features}

        <View style={[styles.safety, { backgroundColor: c.waterLight }]}>
          <Ionicons name="shield-checkmark" size={22} color={c.success} />
          <Typography variant="caption" color={c.text} style={styles.flex1}>{t('paywall.safety_free')}</Typography>
        </View>

        {plus ? (
          <Animated.View entering={enter(5)} style={styles.actions}>
            <Button variant="secondary" title={t('paywall.manage')} onPress={() => Linking.openURL(PLAY_SUBSCRIPTIONS_URL).catch(() => {})} />
            <Button title={t('common.close')} onPress={() => navigation.goBack()} />
          </Animated.View>
        ) : (
          <Animated.View entering={enter(5)}>
            <Typography variant="subheader" style={styles.sectionTitle}>{t('paywall.choose_plan')}</Typography>
            <View accessibilityRole="radiogroup">
              <PlanCard p="annual" />
              <PlanCard p="monthly" />
            </View>
            <View style={[styles.cta, { borderRadius: 16, boxShadow: `0 6px 20px ${c.primary}66` }]}>
              <Button
                title={planTrial ? t('paywall.start_trial_days', { days: planTrial }) : t('paywall.subscribe')}
                loading={busy}
                disabled={busy}
                onPress={() => run(() => purchase(packages[plan]), 'paywall.purchased')}
                style={{ minHeight: isElderly ? 64 : 56, borderRadius: 16 }}
                textStyle={isElderly ? undefined : styles.ctaText}
              />
              <Shimmer on={motion && !busy} radius={16} pause={2200} />
            </View>
            <Typography variant="caption" color={c.textSecondary} style={[styles.center, styles.after]}>
              {planTrial ? t('paywall.trial_then', { price: price(plan) }) : t('paywall.renews_at', { price: price(plan) })}
            </Typography>
            <View style={styles.trust}>
              <Ionicons name="lock-closed" size={14} color={c.textSecondary} />
              <Typography variant="caption" color={c.textSecondary} style={[styles.bold, styles.shrink]}>{t('paywall.trust_line')}</Typography>
            </View>
          </Animated.View>
        )}

        <View style={styles.links}>
          {!plus && <TextLink role="button" label={t('paywall.restore')} onPress={() => run(restore, 'paywall.restored')} />}
          <TextLink label={t('paywall.privacy_link')} onPress={() => Linking.openURL(PRIVACY_URL).catch(() => {})} />
        </View>
        <Typography variant="caption" color={c.textSecondary} style={styles.legal}>{t('paywall.legal_play')}</Typography>
      </ScrollView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  content: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  hero: { borderRadius: 28, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.xl, alignItems: 'center', gap: SPACING.sm, overflow: 'hidden' },
  layer: { position: 'absolute', top: -40, bottom: -40, left: -80, right: -80 },
  spark: { position: 'absolute' },
  iconWrap: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.xs },
  beam: { position: 'absolute', width: 420, height: 34, left: (96 - 420) / 2, top: (96 - 34) / 2 },
  halo: { position: 'absolute', width: 96, height: 96, borderRadius: 48, borderWidth: 2 },
  heroText: { textShadowColor: '#00000040', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  band: { position: 'absolute', top: -60, bottom: -60, width: BAND_W },
  iconRing: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  iconCore: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  heroSub: { opacity: 0.95 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, marginTop: SPACING.xs },
  center: { textAlign: 'center' },
  sectionTitle: { marginTop: SPACING.lg, marginBottom: SPACING.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  feature: { borderRadius: 20, borderWidth: 1, padding: SPACING.md, gap: 4 },
  half: { flexBasis: '47%', flexGrow: 1 },
  full: { flexBasis: '100%' },
  featureTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  featureIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  safety: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, borderRadius: 16, padding: SPACING.md, marginTop: SPACING.md },
  plan: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 72, padding: SPACING.md, borderWidth: 2, borderRadius: 20, marginBottom: SPACING.sm },
  planAnnual: { marginTop: SPACING.sm, paddingTop: SPACING.lg },
  ribbon: { position: 'absolute', top: -12, left: SPACING.md, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  planRight: { alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  price: { fontWeight: '800' },
  flex1: { flex: 1 },
  shrink: { flexShrink: 1, textAlign: 'center' },
  bold: { fontWeight: '700' },
  actions: { gap: SPACING.sm, marginTop: SPACING.lg },
  cta: { marginTop: SPACING.md },
  ctaText: { fontSize: 18 },
  after: { marginTop: SPACING.sm },
  trust: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: SPACING.xs },
  links: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', columnGap: SPACING.lg, marginTop: SPACING.md },
  link: { minHeight: 48, justifyContent: 'center', paddingHorizontal: SPACING.xs },
  legal: { marginTop: SPACING.sm, textAlign: 'center' },
  underline: { textDecorationLine: 'underline' },
});

export default PaywallScreen;
