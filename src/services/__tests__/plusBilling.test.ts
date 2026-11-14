import { planOffer, savings, hasActivePlus, needsAck, cachedPlus, periodDays, SubOffer, CACHE_TRUST_MS, FALLBACK } from '../plusBilling';

const phase = (micros: number, period: string, formatted = '') => ({
  billingPeriod: period, formattedPrice: formatted, priceAmountMicros: String(micros), priceCurrencyCode: 'TRY',
});
const yearlyBase: SubOffer = { basePlanIdAndroid: 'yearly', offerTokenAndroid: 'tok-year', pricingPhasesAndroid: { pricingPhaseList: [phase(349_990_000, 'P1Y', '₺349,99')] } };
const yearlyTrial: SubOffer = {
  basePlanIdAndroid: 'yearly', offerTokenAndroid: 'tok-trial',
  pricingPhasesAndroid: { pricingPhaseList: [phase(0, 'P7D', 'Ücretsiz'), phase(349_990_000, 'P1Y', '₺349,99')] },
};
const monthlyBase: SubOffer = { basePlanIdAndroid: 'monthly', offerTokenAndroid: 'tok-month', pricingPhasesAndroid: { pricingPhaseList: [phase(49_990_000, 'P1M', '₺49,99')] } };

describe('planOffer (offer details → price + trial)', () => {
  it('buys with the trial offer and shows 7 days when Play lists one', () => {
    expect(planOffer([yearlyBase, yearlyTrial, monthlyBase], 'annual')).toEqual({
      plan: 'annual', offerToken: 'tok-trial', price: 349.99, priceString: '₺349,99', currency: 'TRY', trialDays: 7,
    });
  });

  it('shows no trial once the user is no longer eligible (Play omits the offer)', () => {
    const o = planOffer([yearlyBase, monthlyBase], 'annual')!;
    expect(o.trialDays).toBeNull();
    expect(o.offerToken).toBe('tok-year');
  });

  it('keeps plans apart and returns undefined for a missing plan', () => {
    expect(planOffer([yearlyTrial, monthlyBase], 'monthly')).toMatchObject({ offerToken: 'tok-month', price: 49.99, trialDays: null });
    expect(planOffer([yearlyTrial], 'monthly')).toBeUndefined();
  });

  it('parses ISO periods', () => {
    expect(periodDays('P7D')).toBe(7);
    expect(periodDays('P1W')).toBe(7);
    expect(periodDays('bogus')).toBe(0);
  });
});

describe('savings', () => {
  it('fallback prices: %42 off, ₺29,17 a month', () => {
    expect(savings(FALLBACK.monthly, FALLBACK.annual)).toEqual({ pct: 42, perMonth: 29.17 });
  });

  it('never negative, safe with a zero monthly price', () => {
    expect(savings(10, 200).pct).toBe(0);
    expect(savings(0, 100).pct).toBe(0);
  });
});

describe('hasActivePlus', () => {
  const p = (over = {}) => ({ productId: 'aquamed_plus', purchaseState: 'purchased', isSuspendedAndroid: false, isAcknowledgedAndroid: true, ...over });

  it('an owned aquamed_plus → Plus', () => expect(hasActivePlus([p()])).toBe(true));
  it('nothing owned (expired/refunded) → no Plus', () => expect(hasActivePlus([])).toBe(false));
  it('pending, suspended or another product → no Plus', () => {
    expect(hasActivePlus([p({ purchaseState: 'pending' })])).toBe(false);
    expect(hasActivePlus([p({ isSuspendedAndroid: true })])).toBe(false);
    expect(hasActivePlus([p({ productId: 'other' })])).toBe(false);
  });
  it('only unacknowledged, purchased Plus needs an ack', () => {
    expect(needsAck(p({ isAcknowledgedAndroid: false }))).toBe(true);
    expect(needsAck(p())).toBe(false);
    expect(needsAck(p({ isAcknowledgedAndroid: false, purchaseState: 'pending' }))).toBe(false);
  });
});

describe('cachedPlus (offline trust)', () => {
  const now = 1_000_000_000_000;
  it('trusts a fresh Plus for up to 7 days', () => {
    expect(cachedPlus({ plus: true, at: now - CACHE_TRUST_MS }, now)).toBe(true);
    expect(cachedPlus({ plus: true, at: now - CACHE_TRUST_MS - 1 }, now)).toBe(false);
  });
  it('no cache, a cached "no", or a future stamp (clock moved back) → no Plus', () => {
    expect(cachedPlus(null, now)).toBe(false);
    expect(cachedPlus({ plus: false, at: now }, now)).toBe(false);
    expect(cachedPlus({ plus: true, at: now + 60_000 }, now)).toBe(false);
  });
});
