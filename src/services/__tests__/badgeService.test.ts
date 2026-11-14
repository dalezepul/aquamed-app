import AsyncStorage from '@react-native-async-storage/async-storage';
import { computeEarnedBadges, badgeService, BadgeData } from '../badgeService';
import { storageService } from '../storageService';
import { BeverageType, Medication, MedicationLog, MedicationStatus, Priority, WaterLog } from '../../types/models';
import { addDays } from '../../utils/DateUtils';

// 2026-09-24 is a Thursday.
const NOW = new Date('2026-09-24T21:00:00');
const TODAY = '2026-09-24';

let n = 0;
const water = (day: string, hour: number, amount: number, beverageType = BeverageType.Water): WaterLog => ({
  id: `w${n++}`, amountMl: amount, hydrationAmountMl: amount, beverageType,
  timestamp: new Date(`${day}T${String(hour).padStart(2, '0')}:30:00`).toISOString(),
});
/** `total` ml spread over 08:30, 11:30, 14:30, 17:30 (four 2-hour slots). */
const spreadDay = (day: string, total: number) => [8, 11, 14, 17].map(h => water(day, h, total / 4));
/** `count` consecutive days ending on `end`. */
const lastDays = (count: number, end = TODAY) => Array.from({ length: count }, (_, i) => addDays(end, i - count + 1));

const med = (over: Partial<Medication> = {}): Medication => ({
  id: 'm1', name: 'Metformin', times: ['08:00'], startDate: '2026-01-01', endDate: null, schedule: { type: 'daily' },
  foodTiming: 'any', priority: Priority.Medium, isPaused: false, createdAt: '2026-01-01T00:00:00Z', ...over,
});
const taken = (day: string, time = '08:00', lateMin = 0, medicationId = 'm1'): MedicationLog => ({
  id: `l${n++}`, medicationId, status: MedicationStatus.Taken, scheduledDate: day, scheduledTime: time,
  timestamp: new Date(new Date(`${day}T${time}:00`).getTime() + lateMin * 60000).toISOString(),
});

const data = (over: Partial<BadgeData> = {}): BadgeData => ({
  waterLogs: [], medLogs: [], medications: [], waterGoal: 2000, fluidCeilingMl: 4000, wakeTime: '07:00', ...over,
});
const earned = (over: Partial<BadgeData>) => computeEarnedBadges(data(over), NOW);

describe('computeEarnedBadges', () => {
  it('no data → no badges', () => {
    expect(earned({})).toEqual([]);
  });

  it('first water / first medication', () => {
    expect(earned({ waterLogs: [water(TODAY, 10, 200)] })).toContain('b1');
    expect(earned({ medications: [med({ startDate: TODAY })] })).toContain('first_med');
    expect(earned({ waterLogs: [water(TODAY, 10, 200)] })).not.toContain('first_med');
  });

  describe('drinking a lot never earns a badge', () => {
    it('3× the goal over the ceiling gives only "first drop"', () => {
      expect(earned({ waterLogs: spreadDay(TODAY, 6000) })).toEqual(['b1']);
    });
    it('a 7-day run above the ceiling is not a streak', () => {
      const r = earned({ waterLogs: lastDays(7).flatMap(d => spreadDay(d, 4400)) });
      expect(r).not.toContain('b2');
      expect(r).not.toContain('b10');
      expect(r).not.toContain('steady_sipper');
    });
    it('one litre in a single go earns nothing extra', () => {
      expect(earned({ waterLogs: [water(TODAY, 10, 1000)] })).toEqual(['b1']);
    });
    it('200% of the goal (under a raised ceiling) is not a balanced day', () => {
      expect(earned({ waterLogs: spreadDay(TODAY, 4000), fluidCeilingMl: 5000 })).not.toContain('balanced_day');
    });
    it('an over-ceiling day breaks the streak', () => {
      const logs = lastDays(7).flatMap((d, i) => spreadDay(d, i === 3 ? 4400 : 2000));
      const r = earned({ waterLogs: logs });
      expect(r).toContain('b2');
      expect(r).not.toContain('b10');
    });
  });

  it('balanced day = 90–130% of that day\'s goal', () => {
    expect(earned({ waterLogs: spreadDay(TODAY, 2000) })).toContain('balanced_day');
    expect(earned({ waterLogs: spreadDay(TODAY, 2600) })).toContain('balanced_day');
    expect(earned({ waterLogs: spreadDay(TODAY, 1700) })).not.toContain('balanced_day');
    expect(earned({ waterLogs: spreadDay(TODAY, 2800) })).not.toContain('balanced_day');
  });

  it('uses the goal that was in effect on the day', () => {
    const r = earned({ waterLogs: spreadDay('2026-09-10', 1600), waterGoal: 3000, goalHistory: { '2026-09-01': 1500, '2026-09-20': 3000 } });
    expect(r).toContain('balanced_day');
  });

  it('steady sipper needs the goal spread over ≥4 two-hour slots', () => {
    expect(earned({ waterLogs: spreadDay(TODAY, 2000) })).toContain('steady_sipper');
    const bunched = [8, 8, 9, 9].map(h => water(TODAY, h, 500));
    expect(earned({ waterLogs: bunched })).not.toContain('steady_sipper');
    expect(earned({ waterLogs: spreadDay(TODAY, 1200) })).not.toContain('steady_sipper');
  });

  it('morning water: within an hour of waking on 7 days', () => {
    expect(earned({ waterLogs: lastDays(7).map(d => water(d, 7, 200)) })).toContain('morning_water');
    expect(earned({ waterLogs: lastDays(6).map(d => water(d, 7, 200)) })).not.toContain('morning_water');
    expect(earned({ waterLogs: lastDays(7).map(d => water(d, 9, 200)) })).not.toContain('morning_water');
  });

  it('pure water / variety / tea', () => {
    expect(earned({ waterLogs: spreadDay(TODAY, 2000) })).toContain('b13');
    const mixed = [...spreadDay(TODAY, 2000), water(TODAY, 10, 200, BeverageType.Tea), water(TODAY, 12, 200, BeverageType.Coffee)];
    const r = earned({ waterLogs: mixed });
    expect(r).not.toContain('b13');
    expect(r).toContain('b16');
    expect(r).not.toContain('b11');
    expect(earned({ waterLogs: lastDays(5).map(d => water(d, 10, 200, BeverageType.Tea)) })).toContain('b11');
  });

  it('weekend goal', () => {
    expect(earned({ waterLogs: spreadDay('2026-09-19', 2000) })).toContain('b23'); // Saturday
    expect(earned({ waterLogs: spreadDay('2026-09-23', 2000) })).not.toContain('b23'); // Wednesday
  });

  it('dose counts, priority, on time', () => {
    const days = lastDays(10);
    const r = earned({ medications: [med()], medLogs: days.map(d => taken(d, '08:00', 120)) });
    expect(r).toContain('b3');
    expect(r).not.toContain('b17');
    expect(r).not.toContain('b21');
    expect(r).not.toContain('b22'); // 2 h late every time
    const r2 = earned({ medications: [med({ priority: Priority.High })], medLogs: [taken(TODAY, '08:00', 20)] });
    expect(r2).toContain('b21');
    expect(r2).toContain('b22');
    expect(earned({ medications: [med()], medLogs: lastDays(50).map(d => taken(d)) })).toContain('b17');
  });

  it('on-time week: 7 dose-days, every dose within ±30 min', () => {
    const m = med({ times: ['08:00', '20:00'] });
    const logs = lastDays(8, '2026-09-23').flatMap(d => [taken(d, '08:00', 10), taken(d, '20:00', -25)]);
    expect(earned({ medications: [m], medLogs: logs })).toContain('med_on_time_week');
    const oneLate = logs.map((l, i) => (i === 5 ? taken(l.scheduledDate, '20:00', 45) : l));
    expect(earned({ medications: [m], medLogs: oneLate })).not.toContain('med_on_time_week');
  });

  it('perfect month = 30 dose-days in a row, not 100 doses', () => {
    const m = med({ startDate: addDays(TODAY, -40) });
    expect(earned({ medications: [m], medLogs: lastDays(30).map(d => taken(d)) })).toContain('b18');
    expect(earned({ medications: [m], medLogs: lastDays(29, '2026-09-23').map(d => taken(d)) })).not.toContain('b18');
    // 4 doses a day for 25 days = 100 doses, still not a month
    const four = med({ times: ['08:00', '12:00', '16:00', '20:00'], startDate: addDays(TODAY, -24) });
    const logs = lastDays(25).flatMap(d => four.times.map(t => taken(d, t)));
    expect(earned({ medications: [four], medLogs: logs })).not.toContain('b18');
  });

  it('days without a due dose do not break medication runs', () => {
    const m = med({ schedule: { type: 'interval', everyDays: 2 }, startDate: addDays(TODAY, -70) });
    const due = lastDays(70).filter((_, i) => i % 2 === 1); // startDate + 2k
    expect(earned({ medications: [m], medLogs: due.map(d => taken(d)) })).toContain('b18');
  });

  it('medication setup badges', () => {
    const five = [1, 2, 3, 4, 5].map(i => med({ id: `m${i}` }));
    expect(earned({ medications: five })).toContain('b19');
    expect(earned({ medications: five.slice(0, 4) })).not.toContain('b19');
    expect(earned({ medications: [med({ stock: { remaining: 5, total: 30, perDose: 1 } })] })).toContain('b20');
    expect(earned({ medications: [med()] })).not.toContain('b20');
    expect(earned({ medications: [med({ schedule: { type: 'weekly', daysOfWeek: [1] } })] })).toContain('b24');
    expect(earned({ medications: [med()] })).not.toContain('b24');
  });

  it('streaks need water goal and every dose', () => {
    const w = lastDays(7).flatMap(d => spreadDay(d, 2000));
    expect(earned({ waterLogs: w })).toEqual(expect.arrayContaining(['b2', 'b10']));
    expect(earned({ waterLogs: w })).not.toContain('b27');
    expect(earned({ waterLogs: lastDays(3).flatMap(d => spreadDay(d, 2000)) })).not.toContain('b10');
    // A missed dose breaks it
    const m = med({ startDate: addDays(TODAY, -10) });
    const logs = lastDays(7).filter(d => d !== addDays(TODAY, -3)).map(d => taken(d));
    expect(earned({ waterLogs: w, medications: [m], medLogs: logs })).not.toContain('b10');
    const w30 = lastDays(30).flatMap(d => spreadDay(d, 2000));
    expect(earned({ waterLogs: w30 })).toEqual(expect.arrayContaining(['b27', 'b4']));
  });

  it('an unfinished today does not break the streak', () => {
    const w = lastDays(7, '2026-09-23').flatMap(d => spreadDay(d, 2000));
    expect(earned({ waterLogs: [...w, water(TODAY, 8, 200)] })).toContain('b10');
  });

  it('full week = a complete Monday–Sunday', () => {
    const monToSun = lastDays(7, '2026-09-20').flatMap(d => spreadDay(d, 2000));
    expect(earned({ waterLogs: monToSun })).toContain('full_week');
    const friToThu = lastDays(7).flatMap(d => spreadDay(d, 2000));
    expect(earned({ waterLogs: friToThu })).not.toContain('full_week');
  });
});

describe('badgeService', () => {
  beforeEach(async () => { await AsyncStorage.clear(); });

  it('evaluate returns only new badges and never takes one back', async () => {
    const log = water(TODAY, 10, 200);
    await storageService.saveWaterLog(log);
    expect(await badgeService.evaluate(NOW)).toEqual(['b1']);
    expect(await badgeService.evaluate(NOW)).toEqual([]);
    await storageService.deleteWaterLog(log.id);
    expect(await badgeService.evaluate(NOW)).toEqual([]);
    const badges = await badgeService.getBadges();
    expect(badges.find(b => b.id === 'b1')!.earned).toBe(true);
  });

  it('event badges and legacy wrappers', async () => {
    expect(await badgeService.triggerAction('lifesaver')).toEqual(['b25']);
    expect(await badgeService.triggerAction('lifesaver')).toEqual([]);
    await storageService.saveWaterLog(water(TODAY, 10, 200));
    expect(await badgeService.checkWaterBadges(200, BeverageType.Water, 200, 2000)).toEqual(['b1']);
  });
});
