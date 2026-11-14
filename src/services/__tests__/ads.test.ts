import { canShowInterstitial, InterstitialState } from '../ads';

const MIN = 60_000;
const start = 1_000_000;
const base: InterstitialState = { isPlus: false, appStartAt: start, lastShownAt: null, lastActionAt: null, shownToday: 0 };
const at = (minutes: number) => start + minutes * MIN;

describe('canShowInterstitial', () => {
  it('allows the first ad after the 2-minute launch grace', () => {
    expect(canShowInterstitial(base, at(1.9))).toBe(false);
    expect(canShowInterstitial(base, at(2))).toBe(true);
  });

  it('never shows for Plus', () => {
    expect(canShowInterstitial({ ...base, isPlus: true }, at(60))).toBe(false);
  });

  it('keeps at least 5 minutes between ads', () => {
    const s = { ...base, lastShownAt: at(10), shownToday: 1 };
    expect(canShowInterstitial(s, at(14.9))).toBe(false);
    expect(canShowInterstitial(s, at(15))).toBe(true);
  });

  it('caps at 4 per day', () => {
    expect(canShowInterstitial({ ...base, shownToday: 3 }, at(30))).toBe(true);
    expect(canShowInterstitial({ ...base, shownToday: 4 }, at(30))).toBe(false);
  });

  it('waits 60 s after a dose or water action', () => {
    const s = { ...base, lastActionAt: at(10) };
    expect(canShowInterstitial(s, at(10) + 59_000)).toBe(false);
    expect(canShowInterstitial(s, at(11))).toBe(true);
  });
});
