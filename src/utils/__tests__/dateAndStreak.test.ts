import { addDays, timestampForDay, getLocalDayString } from '../DateUtils';
import { countStreak } from '../streak';

const at = (s: string) => new Date(s); // local time

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('timestampForDay', () => {
  const now = at('2026-09-24T14:30:00');
  it('today → now', () => {
    expect(timestampForDay('2026-09-24', now)).toBe(now.toISOString());
  });
  it('past day keeps local calendar day', () => {
    const ts = timestampForDay('2026-09-20', now)!;
    expect(getLocalDayString(new Date(ts))).toBe('2026-09-20');
  });
  it('future day is refused', () => {
    expect(timestampForDay('2026-09-25', now)).toBeNull();
  });
  it('just after midnight belongs to the new local day', () => {
    const late = at('2026-09-24T00:30:00');
    expect(getLocalDayString(new Date(timestampForDay('2026-09-24', late)!))).toBe('2026-09-24');
  });
});

describe('countStreak', () => {
  const now = at('2026-09-24T10:00:00');
  const done = (...days: string[]) => (d: string) => days.includes(d);
  const first = '2026-09-01';

  it('counts consecutive days including today', () => {
    expect(countStreak(done('2026-09-24', '2026-09-23', '2026-09-22'), first, now)).toBe(3);
  });
  it('unfinished today does not break the streak', () => {
    expect(countStreak(done('2026-09-23', '2026-09-22'), first, now)).toBe(2);
  });
  it('a skipped day without a freeze breaks it', () => {
    expect(countStreak(done('2026-09-24', '2026-09-22', '2026-09-21'), first, now)).toBe(1);
  });
  it('nothing done → 0; no history → 0', () => {
    expect(countStreak(done(), first, now)).toBe(0);
    expect(countStreak(done(), null, now)).toBe(0);
  });
});

describe('computeStreak: freezes are earned at 7 / 30 / 90 days', () => {
  const { computeStreak, nextFreezeMilestone, isFreezeMilestone } = require('../streak');
  const range = (from: string, to: string) => {
    const out: string[] = [];
    for (let d = new Date(from + 'T12:00:00'); getLocalDayString(d) <= to; d.setDate(d.getDate() + 1)) out.push(getLocalDayString(d));
    return out;
  };
  const doneSet = (days: string[]) => { const s = new Set(days); return (d: string) => s.has(d); };

  it('no freeze before day 7, so an early miss resets', () => {
    const days = [...range('2026-09-01', '2026-09-05'), ...range('2026-09-07', '2026-09-10')];
    const r = computeStreak(doneSet(days), '2026-09-01', at('2026-09-10T20:00:00'));
    expect(r).toMatchObject({ count: 4, freezesLeft: 0, frozenDays: [] });
  });
  it('7 days earn a freeze; the next miss spends it and the streak survives', () => {
    const days = [...range('2026-09-01', '2026-09-07'), ...range('2026-09-09', '2026-09-12')];
    const r = computeStreak(doneSet(days), '2026-09-01', at('2026-09-12T20:00:00'));
    expect(r).toMatchObject({ count: 11, freezesLeft: 0, frozenDays: ['2026-09-08'] });
  });
  it('with the freeze spent, a second miss resets the streak (earned freezes stay 0)', () => {
    const days = [...range('2026-09-01', '2026-09-07'), ...range('2026-09-09', '2026-09-10'), ...range('2026-09-12', '2026-09-13')];
    const r = computeStreak(doneSet(days), '2026-09-01', at('2026-09-13T20:00:00'));
    expect(r).toMatchObject({ count: 2, freezesLeft: 0, frozenDays: [] });
  });
  it('30 days → 2 freezes, capped at 3 later', () => {
    const r30 = computeStreak(doneSet(range('2026-06-01', '2026-06-30')), '2026-06-01', at('2026-06-30T20:00:00'));
    expect(r30).toMatchObject({ count: 30, freezesLeft: 2, nextMilestone: 90 });
    const r200 = computeStreak(doneSet(range('2026-01-01', '2026-07-19')), '2026-01-01', at('2026-07-19T20:00:00'));
    expect(r200.count).toBe(200);
    expect(r200.freezesLeft).toBe(3);        // 7, 30, 90, 180 → 4 earned, cap 3
  });
  it('unfinished today does not spend a freeze', () => {
    const r = computeStreak(doneSet(range('2026-09-01', '2026-09-09')), '2026-09-01', at('2026-09-10T08:00:00'));
    expect(r).toMatchObject({ count: 9, freezesLeft: 1, frozenDays: [] });
  });
  it('milestone helpers', () => {
    expect([6, 7, 30, 90, 180, 181].map(isFreezeMilestone)).toEqual([false, true, true, true, true, false]);
    expect([0, 7, 29, 30, 90, 100].map(nextFreezeMilestone)).toEqual([7, 30, 30, 90, 180, 180]);
  });
});

describe('computeStreak: granted freezes (rewarded ads / Plus)', () => {
  const { computeStreak } = require('../streak');
  const doneSet = (days: string[]) => { const s = new Set(days); return (d: string) => s.has(d); };

  it('a freeze granted before a miss saves a young streak', () => {
    const days = ['2026-09-20', '2026-09-21', '2026-09-23'];
    const r = computeStreak(doneSet(days), '2026-09-20', at('2026-09-23T20:00:00'), ['2026-09-21']);
    expect(r).toMatchObject({ count: 3, freezesLeft: 0, frozenDays: ['2026-09-22'] });
  });
  it('a freeze granted today is available now and respects the cap', () => {
    const r = computeStreak(doneSet(['2026-09-23']), '2026-09-23', at('2026-09-24T09:00:00'), ['2026-09-24', '2026-09-24', '2026-09-24', '2026-09-24']);
    expect(r.freezesLeft).toBe(3);
  });
  it('a grant after the miss does not retroactively save it', () => {
    const r = computeStreak(doneSet(['2026-09-20', '2026-09-21', '2026-09-23']), '2026-09-20', at('2026-09-23T20:00:00'), ['2026-09-23']);
    expect(r).toMatchObject({ count: 1, freezesLeft: 1 });
  });
});
