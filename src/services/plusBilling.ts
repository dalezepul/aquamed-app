// AquaMed Plus on Google Play Billing: product ids + the pure decisions (tested in __tests__/plusBilling.test.ts).
// No react-native imports here, so jest can load it without native mocks.

/** Play Console → Monetise → Subscriptions: one subscription, two base plans. */
export const PLUS_PRODUCT_ID = 'aquamed_plus';
export type Plan = 'annual' | 'monthly';
export const BASE_PLAN_ID: Record<Plan, string> = { monthly: 'monthly', annual: 'yearly' };
/** Shown when Play returns no product (test build, offline, not yet live). */
export const FALLBACK = { monthly: 49.99, annual: 349.99, currency: 'TRY', trialDays: 7 };
/** How long a cached "Plus" is trusted when Play can't be reached. */
export const CACHE_TRUST_MS = 7 * 24 * 60 * 60 * 1000;

// Minimal shapes of the expo-iap objects we read (kept structural so tests need no library).
export interface PricingPhase { billingPeriod: string; formattedPrice: string; priceAmountMicros: string; priceCurrencyCode: string }
export interface SubOffer { basePlanIdAndroid?: string | null; offerTokenAndroid?: string | null; pricingPhasesAndroid?: { pricingPhaseList: PricingPhase[] } | null }
export interface StorePurchase { productId: string; purchaseState: string; isSuspendedAndroid?: boolean | null; isAcknowledgedAndroid?: boolean | null }

/** What the paywall needs for one plan; `offerToken` is the one to buy with (the trial offer when eligible). */
export interface PlanOffer { plan: Plan; offerToken: string; price: number; priceString: string; currency: string; trialDays: number | null }

/** ISO-8601 period → days (P7D, P1W, P1M≈30). */
export const periodDays = (iso: string) => {
  const m = /^P(\d+)([DWMY])$/.exec(iso);
  if (!m) return 0;
  return Number(m[1]) * { D: 1, W: 7, M: 30, Y: 365 }[m[2] as 'D' | 'W' | 'M' | 'Y'];
};

const isFree = (p: PricingPhase) => Number(p.priceAmountMicros) === 0;

/**
 * Picks the offer for one base plan. Play only lists offers the user is still eligible for,
 * so a free-trial offer present here means the trial may be shown; no such offer → no trial text.
 */
export function planOffer(offers: SubOffer[], plan: Plan): PlanOffer | undefined {
  const mine = offers.filter(o => o.basePlanIdAndroid === BASE_PLAN_ID[plan] && o.offerTokenAndroid && o.pricingPhasesAndroid?.pricingPhaseList.length);
  if (!mine.length) return undefined;
  const trial = mine.find(o => o.pricingPhasesAndroid!.pricingPhaseList.some(isFree));
  const chosen = trial ?? mine[0];
  const phases = chosen.pricingPhasesAndroid!.pricingPhaseList;
  const recurring = phases[phases.length - 1]; // the last phase is the regular price
  const free = phases.find(isFree);
  return {
    plan,
    offerToken: chosen.offerTokenAndroid!,
    price: Number(recurring.priceAmountMicros) / 1e6,
    priceString: recurring.formattedPrice,
    currency: recurring.priceCurrencyCode,
    trialDays: free ? periodDays(free.billingPeriod) || null : null,
  };
}

/** Annual vs 12× monthly. 49,99×12 = 599,88 → 349,99 ≈ %42; ₺29,17/ay. */
export const savings = (monthly: number, annual: number) => ({
  pct: monthly > 0 ? Math.max(0, Math.round((1 - annual / (monthly * 12)) * 100)) : 0,
  perMonth: Math.round((annual / 12) * 100) / 100,
});

/** Play only returns owned, unexpired subscriptions; suspended (payment failed) and pending ones don't count. */
export const hasActivePlus = (purchases: StorePurchase[]) =>
  purchases.some(p => p.productId === PLUS_PRODUCT_ID && p.purchaseState === 'purchased' && !p.isSuspendedAndroid);

export const needsAck = (p: StorePurchase) => p.productId === PLUS_PRODUCT_ID && p.purchaseState === 'purchased' && p.isAcknowledgedAndroid === false;

export interface PlusCache { plus: boolean; at: number }

/** Offline fallback: the last known Plus, only while fresh (and not from a clock set backwards). */
export const cachedPlus = (c: PlusCache | null, now: number, trustMs = CACHE_TRUST_MS) =>
  !!c?.plus && c.at <= now && now - c.at <= trustMs;
