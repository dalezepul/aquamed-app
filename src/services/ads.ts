import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocalDayString } from '../utils/DateUtils';
import { isPlusNow } from './entitlement';
import { loadAdsLib } from './adsLib';

// --- Interstitial frequency rules (pure, tested) -------------------------------------

export const INTERSTITIAL_RULES = {
  minGapMs: 5 * 60_000,
  maxPerDay: 4,
  startupGraceMs: 2 * 60_000,
  afterActionMs: 60_000,
};

export interface InterstitialState {
  isPlus: boolean;
  appStartAt: number;
  lastShownAt: number | null;
  /** Last dose "Aldım/Atla" or water entry. */
  lastActionAt: number | null;
  shownToday: number;
}

export const canShowInterstitial = (s: InterstitialState, now: number, r = INTERSTITIAL_RULES) =>
  !s.isPlus &&
  now - s.appStartAt >= r.startupGraceMs &&
  (s.lastShownAt == null || now - s.lastShownAt >= r.minGapMs) &&
  (s.lastActionAt == null || now - s.lastActionAt >= r.afterActionMs) &&
  s.shownToday < r.maxPerDay;

/** The only places a full-screen ad may appear (never med form, notification action, onboarding, paywall). */
export type InterstitialTrigger = 'progress_tab' | 'data_privacy_close' | 'log_history_close';

// --- Runtime -------------------------------------------------------------------------

const DAILY_KEY = '@aquamed_ads_daily';
const appStartAt = Date.now();
const counters = { lastShownAt: null as number | null, lastActionAt: null as number | null, day: '', shownToday: 0 };

const extra = (Constants.expoConfig?.extra ?? {}) as { admob?: Record<string, string> };
const isTestBuild = __DEV__ || (Constants.expoConfig?.name ?? '').includes('AquaMed Test');

let lib: ReturnType<typeof loadAdsLib> = null;
export const adsLib = () => (lib ??= loadAdsLib());

export const adUnitId = (kind: 'banner' | 'interstitial' | 'rewarded') => {
  const L = adsLib()!;
  const real = Platform.OS === 'android'
    ? extra.admob?.[{ banner: 'androidBannerId', interstitial: 'androidInterstitialId', rewarded: 'androidRewardedId' }[kind]]
    : undefined;
  if (isTestBuild || !real) return { banner: L.TestIds.ADAPTIVE_BANNER, interstitial: L.TestIds.INTERSTITIAL, rewarded: L.TestIds.REWARDED }[kind];
  return real;
};

let ready = false;
let nonPersonalized = true;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
/** True once consent allows ad requests and the SDK is initialised. */
export const useAdsReady = () => useSyncExternalStore(subscribe, () => ready);
export const requestOptions = () => ({ requestNonPersonalizedAdsOnly: nonPersonalized });

let privacyOptionsRequired = false;
/** UMP says this user (EU/UK etc.) must be offered a way to change consent: Settings → Data & privacy row. */
export const usePrivacyOptionsRequired = () => useSyncExternalStore(subscribe, () => privacyOptionsRequired);

const readChoices = async () => {
  const choices = await adsLib()?.AdsConsent.getUserChoices().catch(() => null);
  nonPersonalized = !choices?.selectPersonalisedAds;
};

/** Re-opens the UMP consent form; new choices apply to the next ad request. */
export async function showPrivacyOptions(): Promise<void> {
  const L = adsLib();
  if (!L) return;
  try {
    const info = await L.AdsConsent.showPrivacyOptionsForm();
    await readChoices();
    if (info.canRequestAds && !ready) { initPromise = null; await initAds(); } // consent newly given
  } catch (e) {
    console.warn('[ads] privacy options', e);
  }
}

let initPromise: Promise<boolean> | null = null;

/** UMP consent → SDK init. Idempotent; no consent or any error means no ads. */
export function initAds(): Promise<boolean> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const L = adsLib();
    if (!L) return false;
    try {
      await L.AdsConsent.requestInfoUpdate();
      const info = await L.AdsConsent.loadAndShowConsentFormIfRequired();
      privacyOptionsRequired = info.privacyOptionsRequirementStatus === L.AdsConsentPrivacyOptionsRequirementStatus.REQUIRED;
      listeners.forEach(l => l()); // set even when ads are refused: that user must be able to change the choice
      if (!info.canRequestAds) return false;
      await readChoices();
      await L.default().initialize();
      ready = true;
      listeners.forEach(l => l());
      loadInterstitial();
      return true;
    } catch (e) {
      console.warn('[ads] init failed', e);
      initPromise = null; // try again next launch path
      return false;
    }
  })();
  return initPromise;
}

async function loadDailyCount() {
  const today = getLocalDayString();
  if (counters.day === today) return;
  const saved = await AsyncStorage.getItem(DAILY_KEY).then(v => (v ? JSON.parse(v) : null)).catch(() => null);
  counters.day = today;
  counters.shownToday = saved?.day === today ? Number(saved.count) || 0 : 0;
}

/** Call after a dose is marked or water is logged: no full-screen ad right after a health action. */
export const noteUserAction = () => { counters.lastActionAt = Date.now(); };

let interstitial: import('react-native-google-mobile-ads').InterstitialAd | null = null;

function loadInterstitial() {
  const L = adsLib();
  if (!L || !ready || isPlusNow() || interstitial) return;
  const ad = L.InterstitialAd.createForAdRequest(adUnitId('interstitial'), requestOptions());
  ad.addAdEventListener(L.AdEventType.CLOSED, () => { interstitial = null; loadInterstitial(); });
  ad.addAdEventListener(L.AdEventType.ERROR, () => { interstitial = null; });
  ad.load();
  interstitial = ad;
}

async function showInterstitial(): Promise<boolean> {
  if (!interstitial?.loaded) { loadInterstitial(); return false; }
  try {
    await interstitial.show();
  } catch {
    interstitial = null;
    return false;
  }
  counters.lastShownAt = Date.now();
  counters.shownToday += 1;
  AsyncStorage.setItem(DAILY_KEY, JSON.stringify({ day: counters.day, count: counters.shownToday })).catch(() => {});
  return true;
}

/** Shows a preloaded interstitial if the frequency rules allow it. */
export async function maybeShowInterstitial(_trigger: InterstitialTrigger): Promise<boolean> {
  if (!ready || isPlusNow()) return false;
  await loadDailyCount();
  if (!canShowInterstitial({ isPlus: isPlusNow(), appStartAt, ...counters }, Date.now())) return false;
  // Let the closing screen/modal animate out first.
  await new Promise(r => setTimeout(r, 400));
  return showInterstitial();
}

/** Loads and shows one rewarded ad; resolves true only if the reward was earned. */
export function showRewardedAd(): Promise<boolean> {
  const L = adsLib();
  if (!L || !ready || isPlusNow()) return Promise.resolve(false);
  return new Promise(resolve => {
    let earned = false;
    const ad = L.RewardedAd.createForAdRequest(adUnitId('rewarded'), requestOptions());
    const done = (v: boolean) => { ad.removeAllListeners(); resolve(v); };
    ad.addAdEventListener(L.RewardedAdEventType.LOADED, () => { ad.show().catch(() => done(false)); });
    ad.addAdEventListener(L.RewardedAdEventType.EARNED_REWARD, () => { earned = true; });
    ad.addAdEventListener(L.AdEventType.CLOSED, () => done(earned));
    ad.addAdEventListener(L.AdEventType.ERROR, () => done(false));
    ad.load();
  });
}

// --- DevTools ------------------------------------------------------------------------

/** Ignores the frequency rules (still never for Plus). */
export async function devShowInterstitial(): Promise<boolean> {
  if (!(await initAds())) return false;
  await loadDailyCount();
  if (interstitial?.loaded) return showInterstitial();
  const L = adsLib()!;
  return new Promise(resolve => {
    loadInterstitial();
    if (!interstitial) return resolve(false);
    const off = [
      interstitial.addAdEventListener(L.AdEventType.LOADED, () => { off.forEach(f => f()); showInterstitial().then(resolve); }),
      interstitial.addAdEventListener(L.AdEventType.ERROR, () => { off.forEach(f => f()); resolve(false); }),
    ];
  });
}

export async function resetAdCounters() {
  counters.lastShownAt = null;
  counters.lastActionAt = null;
  counters.shownToday = 0;
  counters.day = '';
  await AsyncStorage.removeItem(DAILY_KEY);
}

export const adsStatus = () => ({ ready, nonPersonalized, isTestBuild, ...counters });
