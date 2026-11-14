import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Purchase } from 'expo-iap';
import { storageService } from './storageService';
import { PLUS_PRODUCT_ID, PlanOffer, planOffer, hasActivePlus, needsAck, cachedPlus, PlusCache, SubOffer } from './plusBilling';

// ponytail: client-side check only (no server): Play's own purchase list is trusted as-is. A rooted device
// can fake it; add Play Developer API verification (purchases.subscriptionsv2.get) on a backend if that matters.

/** AquaMed Plus: an active Google Play subscription `aquamed_plus`, or the DevTools simulation. */
export const DEV_PLUS_KEY = '@aquamed_dev_plus';
const CACHE_KEY = '@aquamed_plus_cache';
/** The DevTools Plus switch only works in dev/test builds: DevTools is reachable in release too (7 taps). */
// Test builds, dev, and the local web copy (127.0.0.1/localhost) may simulate Plus; store builds never.
export const DEV_PLUS_ALLOWED = __DEV__ || (Constants.expoConfig?.name ?? '').includes('AquaMed Test')
  || (Platform.OS === 'web' && typeof location !== 'undefined' && ['127.0.0.1', 'localhost'].includes(location.hostname));

let storePlus = false;
let devPlus = false;
let plus = false;
const listeners = new Set<() => void>();

const update = (next: { storePlus?: boolean; devPlus?: boolean }) => {
  storePlus = next.storePlus ?? storePlus;
  devPlus = next.devPlus ?? devPlus;
  const now = storePlus || devPlus;
  if (now === plus) return;
  plus = now;
  listeners.forEach(l => l());
};

const saveCache = (p: boolean) => AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ plus: p, at: Date.now() } satisfies PlusCache)).catch(() => {});
const readCache = async () => cachedPlus(await AsyncStorage.getItem(CACHE_KEY).then(v => (v ? JSON.parse(v) : null)).catch(() => null), Date.now());

// --- Play Billing (expo-iap), Android only ---------------------------------------------

type Iap = typeof import('expo-iap');
// Loaded lazily: the native module throws on import where it doesn't exist (web, jest, Expo Go).
let iap: Iap | null | undefined;
const lib = (): Iap | null => {
  if (iap !== undefined) return iap;
  iap = null;
  if (Platform.OS !== 'android') return null;
  try { iap = require('expo-iap') as Iap; } catch (e) { console.warn('[entitlement] expo-iap unavailable', e); }
  return iap;
};

/** The one purchase flow in progress; results arrive via the listeners, not requestPurchase's return. */
let pending: ((r: PurchaseResult) => void) | null = null;
const settle = (r: PurchaseResult) => { pending?.(r); pending = null; };

/** Acknowledge within 3 days or Play refunds the purchase. Safe to repeat. */
const ack = async (L: Iap, p: Purchase) => {
  if (!needsAck(p)) return;
  await L.finishTransaction({ purchase: p, isConsumable: false }).catch(e => console.warn('[entitlement] acknowledge', e));
};

let connecting: Promise<Iap | null> | null = null;
const connect = () => (connecting ??= (async () => {
  const L = lib();
  if (!L) return null;
  try {
    await L.initConnection();
  } catch (e) {
    console.warn('[entitlement] billing connection', e);
    connecting = null; // retry on the next call (e.g. no Play Store signed in)
    return null;
  }
  L.purchaseUpdatedListener(async p => {
    if (p.productId !== PLUS_PRODUCT_ID) return;
    if (p.purchaseState !== 'purchased') return settle('failed'); // pending payment: Plus opens once Play confirms it
    await ack(L, p);
    update({ storePlus: true });
    saveCache(true);
    await storageService.grantMonthlyPlusFreeze().catch(() => false);
    settle('ok');
  });
  L.purchaseErrorListener(e => {
    if (e.code === L.ErrorCode.UserCancelled) return settle('cancelled');
    if (e.code === L.ErrorCode.AlreadyOwned) return void queryStore().then(ok => settle(ok ? 'ok' : 'failed'));
    settle('failed');
  });
  // Coming back from Play (cancel, renewal, payment fix) or from the background: re-check.
  AppState.addEventListener('change', s => { if (s === 'active') refreshEntitlement(); });
  return L;
})());

/** true/false from Play; null when Play couldn't be asked (offline, no billing). */
async function queryStore(): Promise<boolean | null> {
  const L = await connect();
  if (!L) return null;
  try {
    const purchases = await L.getAvailablePurchases();
    await Promise.all(purchases.map(p => ack(L, p))); // catches purchases whose ack was cut off (app killed)
    const active = hasActivePlus(purchases);
    saveCache(active);
    return active;
  } catch (e) {
    console.warn('[entitlement] purchases', e);
    return null;
  }
}

/** False on web/iOS or where the Play Billing module is missing. */
export const isStoreConfigured = () => !!lib();
export const isPlusNow = () => plus;

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const usePlus = () => useSyncExternalStore(subscribe, isPlusNow);

/** Re-reads both sources; called at launch and on every return to the foreground. Plus users get their monthly bonus freeze here. */
export async function refreshEntitlement(): Promise<boolean> {
  const dev = DEV_PLUS_ALLOWED && (await AsyncStorage.getItem(DEV_PLUS_KEY).catch(() => null)) === '1';
  const fromStore = (await queryStore()) ?? (await readCache());
  update({ devPlus: dev, storePlus: fromStore });
  if (plus) await storageService.grantMonthlyPlusFreeze().catch(() => false);
  return plus;
}

export async function setDevPlus(on: boolean) {
  await (on ? AsyncStorage.setItem(DEV_PLUS_KEY, '1') : AsyncStorage.removeItem(DEV_PLUS_KEY));
  return refreshEntitlement();
}

export interface PlusPackages { annual?: PlanOffer; monthly?: PlanOffer }

export async function getPackages(): Promise<PlusPackages> {
  const L = await connect();
  if (!L) return {};
  try {
    const products = await L.fetchProducts({ skus: [PLUS_PRODUCT_ID], type: 'subs' });
    const sub = (products ?? []).find(p => p.id === PLUS_PRODUCT_ID);
    const offers = ((sub as { subscriptionOffers?: SubOffer[] } | undefined)?.subscriptionOffers ?? []);
    return { annual: planOffer(offers, 'annual'), monthly: planOffer(offers, 'monthly') };
  } catch (e) {
    console.warn('[entitlement] products', e);
    return {};
  }
}

export type PurchaseResult = 'ok' | 'cancelled' | 'failed' | 'unavailable';

export async function purchase(pkg: PlanOffer | undefined): Promise<PurchaseResult> {
  const L = await connect();
  if (!L || !pkg) return 'unavailable';
  settle('cancelled'); // a stale flow never resolves twice
  const result = new Promise<PurchaseResult>(resolve => { pending = resolve; });
  try {
    await L.requestPurchase({
      type: 'subs',
      request: { google: { skus: [PLUS_PRODUCT_ID], subscriptionOffers: [{ sku: PLUS_PRODUCT_ID, offerToken: pkg.offerToken }] } },
    });
  } catch (e: any) {
    settle(e?.code === L.ErrorCode.UserCancelled ? 'cancelled' : 'failed');
  }
  return result;
}

/** 'ok' when a Plus purchase was found. On Android, asking Play for owned purchases is the restore. */
export async function restore(): Promise<PurchaseResult> {
  if (!(await connect())) return 'unavailable';
  const found = await queryStore();
  if (found == null) return 'failed';
  update({ storePlus: found });
  if (plus) await storageService.grantMonthlyPlusFreeze().catch(() => false); // this month's bonus now, not next launch
  return found ? 'ok' : 'failed';
}
