import {
  computeWeeklyGoal, computePoints, computeWeekSummary, formatWeekSummary, levelFor, weekStart, GameData,
} from '../gamification';
import { BeverageType, Medication, MedicationLog, MedicationStatus, Priority, WaterLog } from '../../types/models';

// Echo keys + params so the test sees exactly which numbers reach the text.
jest.mock('../../localization/i18n', () => ({
  t: (key: string, p?: Record<string, unknown>) => (p ? `${key} ${JSON.stringify(p)}` : key),
  getLocale: () => 'en',
}));

// 2026-09-24 is a Thursday; its week starts Monday 2026-09-21.
const NOW = new Date('2026-09-24T21:00:00');

let n = 0;
const water = (day: string, amount: number, hour = 10): WaterLog => ({
  id: `w${n++}`, amountMl: amount, hydrationAmountMl: amount, beverageType: BeverageType.Water,
  timestamp: new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).toISOString(),
});
const med = (over: Partial<Medication> = {}): Medication => ({
  id: 'm1', name: 'Metformin', times: ['08:00'], startDate: '2026-01-01', endDate: null, schedule: { type: 'daily' },
  foodTiming: 'any', priority: Priority.Medium, isPaused: false, createdAt: '2026-01-01T00:00:00Z', ...over,
});
const taken = (day: string, lateMin = 0, time = '08:00'): MedicationLog => ({
  id: `l${n++}`, medicationId: 'm1', status: MedicationStatus.Taken, scheduledDate: day, scheduledTime: time,
  timestamp: new Date(new Date(`${day}T${time}:00`).getTime() + lateMin * 60000).toISOString(),
});
const data = (over: Partial<GameData> = {}): GameData => ({
  waterLogs: [], medLogs: [], medications: [], waterGoal: 2000, fluidCeilingMl: 4000, ...over,
});
const balanced = (...days: string[]) => days.map(d => water(d, 2000));

describe('weekStart', () => {
  it('Monday-based, local dates', () => {
    expect(weekStart('2026-09-24')).toBe('2026-09-21');
    expect(weekStart('2026-09-21')).toBe('2026-09-21'); // Monday itself
    expect(weekStart('2026-09-27')).toBe('2026-09-21'); // Sunday belongs to the week before
    expect(weekStart('2026-10-01')).toBe('2026-09-28'); // across a month boundary
  });
});

describe('computeWeeklyGoal', () => {
  it('first week (no history before Monday) → 4', () => {
    const g = computeWeeklyGoal(data({ waterLogs: balanced('2026-09-22') }), NOW);
    expect(g.target).toBe(4);
    expect(g.done).toBe(1);
  });

  it('last week 2 balanced → 3; 0 → 3 (floor)', () => {
    expect(computeWeeklyGoal(data({ waterLogs: balanced('2026-09-15', '2026-09-17') }), NOW).target).toBe(3);
    expect(computeWeeklyGoal(data({ waterLogs: [water('2026-09-15', 300)] }), NOW).target).toBe(3);
  });

  it('last week 4 → 5, 6 → 7, 7 → 7 (cap)', () => {
    const week = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
    expect(computeWeeklyGoal(data({ waterLogs: balanced(...week.slice(0, 4)) }), NOW).target).toBe(5);
    expect(computeWeeklyGoal(data({ waterLogs: balanced(...week.slice(0, 6)) }), NOW).target).toBe(7);
    expect(computeWeeklyGoal(data({ waterLogs: balanced(...week) }), NOW).target).toBe(7);
  });

  it('Monday boundary: Sunday counts for last week, Monday for this one', () => {
    const logs = balanced('2026-09-20', '2026-09-21');
    const g = computeWeeklyGoal(data({ waterLogs: logs }), new Date('2026-09-21T09:00:00'));
    expect(g.weekStart).toBe('2026-09-21');
    expect(g.target).toBe(3); // last week: 1 → 2 → clamped to 3
    expect(g.done).toBe(1);
    // A week later the same Sunday no longer feeds the target
    const next = computeWeeklyGoal(data({ waterLogs: logs }), new Date('2026-09-28T09:00:00'));
    expect(next.target).toBe(3); // last week (21–27): 1 balanced → 2 → 3
    expect(next.done).toBe(0);
  });

  it('uses local day of late-evening logs', () => {
    const g = computeWeeklyGoal(data({ waterLogs: [water('2026-09-20', 2000, 23)] }), new Date('2026-09-21T08:00:00'));
    expect(g.days[0].state).toBe('today');
    expect(g.target).toBe(3);
  });

  it('day states, balance band and ceiling', () => {
    const g = computeWeeklyGoal(data({
      waterLogs: [
        ...balanced('2026-09-21'),
        water('2026-09-22', 1000),          // under 90 %
        water('2026-09-23', 2700),          // over 130 %
        ...balanced('2026-09-24'),
      ],
    }), NOW);
    expect(g.days.map(d => d.state)).toEqual(['done', 'missed', 'missed', 'done', 'future', 'future', 'future']);
    expect(g.done).toBe(2);
    expect(g.achieved).toBe(false);
    const ceiling = computeWeeklyGoal(data({ waterLogs: balanced('2026-09-24'), fluidCeilingMl: 1500 }), NOW);
    expect(ceiling.days[3].state).toBe('today');
  });

  it('achieved when done ≥ target', () => {
    const g = computeWeeklyGoal(data({ waterLogs: balanced('2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24') }), NOW);
    expect(g.target).toBe(4);
    expect(g.achieved).toBe(true);
  });
});

describe('computePoints', () => {
  it('balanced day +10; over the ceiling or over 130 % → 0', () => {
    expect(computePoints(data({ waterLogs: balanced('2026-09-20') }), NOW)).toBe(10);
    expect(computePoints(data({ waterLogs: balanced('2026-09-20'), fluidCeilingMl: 1800 }), NOW)).toBe(0);
    expect(computePoints(data({ waterLogs: [water('2026-09-20', 3000)] }), NOW)).toBe(0);
  });

  it('on-time dose +2 (±30 min), late dose +1, skipped 0', () => {
    const skipped: MedicationLog = { ...taken('2026-09-22'), status: MedicationStatus.Skipped };
    const logs = [taken('2026-09-20', 30), taken('2026-09-21', -25), taken('2026-09-22', 31), taken('2026-09-23', 180), skipped];
    expect(computePoints(data({ medications: [med()], medLogs: logs }), NOW)).toBe(2 + 2 + 1 + 1);
  });

  it('whole history counts', () => {
    expect(computePoints(data({ waterLogs: balanced('2025-01-01', '2026-09-24') }), NOW)).toBe(20);
  });
});

describe('levelFor', () => {
  it('thresholds 0/100/300/700/1500/3000', () => {
    expect(levelFor(0).key).toBe('drop');
    expect(levelFor(99).key).toBe('drop');
    expect(levelFor(100).key).toBe('spring');
    expect(levelFor(300).key).toBe('stream');
    expect(levelFor(700).key).toBe('river');
    expect(levelFor(1499).key).toBe('river');
    expect(levelFor(1500).key).toBe('lake');
    expect(levelFor(3000).key).toBe('ocean');
  });

  it('progress to next level', () => {
    expect(levelFor(200)).toMatchObject({ key: 'spring', next: { key: 'stream', min: 300 }, progress: 0.5 });
    expect(levelFor(5000)).toMatchObject({ key: 'ocean', next: null, progress: 1 });
  });
});

describe('week summary', () => {
  const d = data({
    medications: [med({ times: ['08:00', '22:00'] })],
    waterLogs: [
      ...balanced('2026-09-18', '2026-09-20'),
      water('2026-09-22', 1000),
      water('2026-09-17', 2000), // 8 days ago: outside the window
    ],
    medLogs: [taken('2026-09-18'), taken('2026-09-19'), taken('2026-09-20', 60), taken('2026-09-24')],
  });

  it('numbers', () => {
    const s = computeWeekSummary(d, NOW);
    expect(s).toMatchObject({ from: '2026-09-18', to: '2026-09-24', balancedDays: 2, averageMl: 1667, takenDoses: 4 });
    // 6 full days × 2 doses + today's 08:00 (22:00 not due yet at 21:00)
    expect(s.plannedDoses).toBe(13);
    expect(s.adherence).toBe(31);
  });

  it('text carries the same numbers', () => {
    const text = formatWeekSummary(computeWeekSummary(d, NOW), 5);
    expect(text).toContain('gamification.share_balanced {"count":2}');
    expect(text).toContain('gamification.share_water {"liters":"1.7"}');
    expect(text).toContain('gamification.share_doses {"taken":4,"planned":13,"percent":31}');
    expect(text).toContain('gamification.share_streak {"count":5}');
    expect(text).toContain('September 18');
  });

  it('no doses → no percentage', () => {
    const s = computeWeekSummary(data(), NOW);
    expect(s.adherence).toBeNull();
    expect(formatWeekSummary(s, 0)).toContain('gamification.share_no_doses');
  });
});
