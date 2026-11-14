import { planNotifications, waterMinutesForDay, inSleepWindow, MAX_PENDING, REOPEN_AFTER_MIN, PlanInput } from '../notificationPlan';
import { DEFAULT_APP_SETTINGS } from '../storageService';
import { Medication, MedicationStatus, Priority } from '../../types/models';

const med = (over: Partial<Medication> = {}): Medication => ({
  id: 'm', name: 'X', times: ['08:00'], startDate: '2026-09-01', endDate: null, schedule: { type: 'daily' },
  foodTiming: 'any', priority: Priority.Medium, isPaused: false, createdAt: '', ...over,
});
const sleep = { enabled: true, start: '23:00', end: '07:00' };
const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  meds: [], logs: [], settings: { ...DEFAULT_APP_SETTINGS, waterReminder: { mode: 'off', intervalMinutes: 120, randomCount: 3, drinkAmountMl: 250, message: '' }, eveningNudge: { enabled: false, time: '19:30' } },
  sleep, hasEmergencyContact: true, waterToday: 0, waterGoal: 2000, now: new Date('2026-09-24T10:00:00'), ...over,
});
const doseDays = (plan: ReturnType<typeof planNotifications>) =>
  plan.filter(p => p.data.type === 'dose').map(p => (p.data as any).date);

describe('dose notifications follow the schedule (old bug: daily trigger for everything)', () => {
  it('weekly med only on its days', () => {
    const plan = planNotifications(base({ meds: [med({ schedule: { type: 'weekly', daysOfWeek: [1] }, times: ['09:00'] })] }));
    expect(doseDays(plan)).toEqual(['2026-09-28']); // next Monday only
  });
  it('ended med stops; paused med gets nothing', () => {
    expect(doseDays(planNotifications(base({ meds: [med({ times: ['12:00'], endDate: '2026-09-25' })] })))).toEqual(['2026-09-24', '2026-09-25']);
    expect(planNotifications(base({ meds: [med({ isPaused: true })] }))).toHaveLength(0);
  });
  it('past times today and already-logged doses are skipped', () => {
    const m = med({ times: ['08:00', '12:00'] });
    const logs = [{ id: 'l', medicationId: 'm', status: MedicationStatus.Taken, timestamp: '', scheduledDate: '2026-09-24', scheduledTime: '12:00' }];
    const plan = planNotifications(base({ meds: [m], logs }));
    expect(plan.some(p => (p.data as any).date === '2026-09-24')).toBe(false);
  });
});

describe('escalation', () => {
  it('only for high priority with a contact, delayed', () => {
    const hi = med({ id: 'h', priority: Priority.High, times: ['12:00'], endDate: '2026-09-24' });
    const plan = planNotifications(base({ meds: [hi] }));
    const esc = plan.find(p => p.data.type === 'escalation')!;
    expect(esc.at.getTime() - new Date('2026-09-24T12:00:00').getTime()).toBe(30 * 60000);
    expect(planNotifications(base({ meds: [hi], hasEmergencyContact: false })).some(p => p.data.type === 'escalation')).toBe(false);
    expect(planNotifications(base({ meds: [{ ...hi, priority: Priority.Low }] })).some(p => p.data.type === 'escalation')).toBe(false);
  });
  it('survives a re-plan after the dose time has passed (unlogged dose)', () => {
    const hi = med({ id: 'h', priority: Priority.High, times: ['09:50'], endDate: '2026-09-24' });
    const plan = planNotifications(base({ meds: [hi] })); // now = 10:00, escalation due 10:20
    expect(plan.map(p => p.data.type)).toEqual(['escalation', 'reopen']); // reopen: nothing planned after it
  });
});

describe('sleep window', () => {
  it('crosses midnight', () => {
    expect(inSleepWindow('02:00', sleep)).toBe(true);
    expect(inSleepWindow('07:00', sleep)).toBe(false);
    expect(inSleepWindow('23:30', sleep)).toBe(true);
  });
  it('a low-priority night dose gets a heads-up at bedtime the evening before', () => {
    const plan = planNotifications(base({ meds: [med({ times: ['02:00'], endDate: '2026-09-25' })] }));
    const heads = plan.filter(p => p.data.type === 'dose_presleep').map(p => p.at.toString());
    expect(heads[0]).toBe(new Date('2026-09-24T23:00:00').toString());
  });
});

describe('water reminders', () => {
  it('interval never below 60 minutes and inside awake hours', () => {
    const mins = waterMinutesForDay('2026-09-24', { mode: 'interval', intervalMinutes: 30, randomCount: 0, drinkAmountMl: 250, message: '' }, sleep);
    expect(mins[0]).toBe(7 * 60 + 60);
    expect(mins.every((m, i) => i === 0 || m - mins[i - 1] >= 60)).toBe(true);
    expect(Math.max(...mins)).toBeLessThanOrEqual(23 * 60 - 30);
  });
  it('random is stable per day and spaced ≥ 60 min', () => {
    const s = { mode: 'random' as const, intervalMinutes: 0, randomCount: 5, drinkAmountMl: 250, message: '' };
    const a = waterMinutesForDay('2026-09-24', s, sleep);
    expect(a).toEqual(waterMinutesForDay('2026-09-24', s, sleep));
    expect(a).toHaveLength(5);
    expect(a.every((m, i) => i === 0 || m - a[i - 1] >= 60)).toBe(true);
  });
  it('stops for today once the goal is met', () => {
    const settings = { ...DEFAULT_APP_SETTINGS, waterReminder: { mode: 'interval' as const, intervalMinutes: 120, randomCount: 0, drinkAmountMl: 250, message: '' } };
    const plan = planNotifications(base({ settings, waterToday: 2000 }));
    expect(plan.some(p => p.data.type === 'water' && p.data.date === '2026-09-24')).toBe(false);
    expect(plan.some(p => p.data.type === 'water' && p.data.date === '2026-09-25')).toBe(true);
  });
});

describe('budget', () => {
  it('never exceeds the pending limit and keeps the next 24h complete', () => {
    const meds = Array.from({ length: 6 }, (_, i) => med({ id: `m${i}`, times: ['11:00', '15:00', '19:00'] }));
    const settings = { ...DEFAULT_APP_SETTINGS, waterReminder: { mode: 'interval' as const, intervalMinutes: 60, randomCount: 0, drinkAmountMl: 250, message: '' } };
    const plan = planNotifications(base({ meds, settings }));
    expect(plan.length).toBe(MAX_PENDING);
    const todayWater = plan.filter(p => p.data.type === 'water' && p.data.date === '2026-09-24');
    expect(todayWater.length).toBeGreaterThan(0);
  });
});

describe('evening nudge', () => {
  const settings = { ...DEFAULT_APP_SETTINGS, waterReminder: { mode: 'off' as const, intervalMinutes: 120, randomCount: 0, drinkAmountMl: 250, message: '' } };
  const nudges = (over: Partial<PlanInput>) => planNotifications(base({ settings, ...over })).filter(p => p.data.type === 'nudge');

  it('one nudge today at 19:30 when the goal is not met', () => {
    const n = nudges({ waterToday: 1200, streak: 4 });
    expect(n).toHaveLength(1);
    expect(n[0].at.toString()).toBe(new Date('2026-09-24T19:30:00').toString());
    expect(n[0].data).toMatchObject({ remainingMl: 800, streak: 4 });
  });
  it('none when the goal is met or it is already past 19:30', () => {
    expect(nudges({ waterToday: 2000 })).toHaveLength(0);
    expect(nudges({ now: new Date('2026-09-24T20:00:00') })).toHaveLength(0);
  });
  it('never suggests drinking past the fluid ceiling', () => {
    const n = nudges({ waterToday: 1000, waterGoal: 2000, fluidToday: 1400, fluidCeilingMl: 1500 });
    expect((n[0].data as any).remainingMl).toBe(100);
    expect(nudges({ waterToday: 1000, fluidToday: 1500, fluidCeilingMl: 1500 })).toHaveLength(0);
  });
  it('can be turned off', () => {
    expect(nudges({ settings: { ...settings, eveningNudge: { enabled: false, time: '19:30' } } })).toHaveLength(0);
  });
});

describe('escalation across midnight', () => {
  it("yesterday's 23:50 dose still escalates at 00:20 today", () => {
    const hi = med({ id: 'h', priority: Priority.High, times: ['23:50'] });
    const plan = planNotifications(base({ meds: [hi], now: new Date('2026-09-25T00:05:00') }));
    const esc = plan.filter(p => p.data.type === 'escalation' && p.data.date === '2026-09-24');
    expect(esc.map(p => p.at.getTime())).toEqual([new Date('2026-09-25T00:20:00').getTime()]);
    expect(plan.some(p => p.data.type === 'dose' && p.data.date === '2026-09-24')).toBe(false); // no late dose alarm
  });
  it('not when yesterday\'s dose was logged', () => {
    const hi = med({ id: 'h', priority: Priority.High, times: ['23:50'] });
    const logs = [{ id: 'l', medicationId: 'h', status: MedicationStatus.Taken, timestamp: '', scheduledDate: '2026-09-24', scheduledTime: '23:50' }];
    const plan = planNotifications(base({ meds: [hi], logs, now: new Date('2026-09-25T00:05:00') }));
    expect(plan.some(p => p.data.type === 'escalation' && p.data.date === '2026-09-24')).toBe(false);
  });
});

describe('"open AquaMed" notice after the last planned reminder', () => {
  const noWater = { ...DEFAULT_APP_SETTINGS, waterReminder: { mode: 'off' as const, intervalMinutes: 120, randomCount: 0, drinkAmountMl: 250, message: '' }, eveningNudge: { enabled: false, time: '19:30' } };
  it('comes last, an hour after the last reminder', () => {
    const plan = planNotifications(base({ settings: noWater, meds: [med({ times: ['12:00'], endDate: '2026-09-25' })] }));
    expect(plan.map(p => p.data.type)).toEqual(['dose', 'dose', 'reopen']);
    expect(plan[2].at.getTime()).toBe(new Date('2026-09-25T12:00:00').getTime() + REOPEN_AFTER_MIN * 60000);
  });
  it('moves to wake-up time instead of ringing at night', () => {
    const plan = planNotifications(base({ settings: noWater, meds: [med({ times: ['22:30'], endDate: '2026-09-24' })] }));
    expect(plan[plan.length - 1].data.type).toBe('reopen');
    expect(plan[plan.length - 1].at.toString()).toBe(new Date('2026-09-25T07:00:00').toString());
  });
  it('fits in the pending budget; nothing planned → no notice', () => {
    const meds = Array.from({ length: 6 }, (_, i) => med({ id: `m${i}`, times: ['11:00', '15:00', '19:00'] }));
    const plan = planNotifications(base({ meds, settings: noWater }));
    expect(plan.length).toBe(MAX_PENDING);
    expect(plan[plan.length - 1].data.type).toBe('reopen');
    expect(planNotifications(base({ settings: noWater }))).toHaveLength(0);
  });
});

describe('doses before the medication was added', () => {
  it('no escalation for a dose from before createdAt', () => {
    const hi = med({ id: 'h', priority: Priority.High, times: ['09:45'], startDate: '2026-09-24', createdAt: new Date('2026-09-24T09:55:00').toISOString(), endDate: '2026-09-24' });
    expect(planNotifications(base({ meds: [hi] })).some(p => p.data.type === 'escalation')).toBe(false);
  });
});
