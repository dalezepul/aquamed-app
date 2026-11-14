import { isScheduledOn, getDosesForDate, calculateMedicationTimes, minutesApart, daysBetween, isStockLow, isDoseBeforeStart } from '../ScheduleUtils';
import { Medication, MedicationLog, MedicationStatus, Priority } from '../../types/models';

const med = (over: Partial<Medication> = {}): Medication => ({
  id: 'm', name: 'X', times: ['08:00'], startDate: '2026-09-01', endDate: null, schedule: { type: 'daily' },
  foodTiming: 'any', priority: Priority.Medium, isPaused: false, createdAt: '2026-09-01T00:00:00Z', ...over,
});

describe('isScheduledOn', () => {
  it('daily from start date', () => {
    expect(isScheduledOn(med(), '2026-08-31')).toBe(false);
    expect(isScheduledOn(med(), '2026-09-01')).toBe(true);
    expect(isScheduledOn(med(), '2026-12-25')).toBe(true);
  });
  it('end date is inclusive (10-day antibiotic)', () => {
    const m = med({ endDate: '2026-09-10' });
    expect(isScheduledOn(m, '2026-09-10')).toBe(true);
    expect(isScheduledOn(m, '2026-09-11')).toBe(false);
  });
  it('weekly Mon/Thu', () => {
    const m = med({ schedule: { type: 'weekly', daysOfWeek: [1, 4] } });
    expect(['2026-09-07', '2026-09-08', '2026-09-10'].map(d => isScheduledOn(m, d))).toEqual([true, false, true]);
  });
  it('every 3 days', () => {
    const m = med({ schedule: { type: 'interval', everyDays: 3 } });
    expect(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'].map(d => isScheduledOn(m, d)))
      .toEqual([true, false, false, true]);
  });
  it('cyclic 21 on / 7 off', () => {
    const m = med({ schedule: { type: 'cyclic', activeDays: 21, offDays: 7 } });
    expect(isScheduledOn(m, '2026-09-21')).toBe(true);
    expect(isScheduledOn(m, '2026-09-22')).toBe(false);
    expect(isScheduledOn(m, '2026-09-29')).toBe(true);
  });
  it('interval across year boundary', () => {
    const m = med({ startDate: '2026-12-30', schedule: { type: 'interval', everyDays: 2 } });
    expect(isScheduledOn(m, '2027-01-01')).toBe(true);
    expect(daysBetween('2026-12-30', '2027-01-01')).toBe(2);
  });
});

describe('getDosesForDate', () => {
  const a = med({ id: 'a', name: 'A', times: ['08:00', '20:00'] });
  const b = med({ id: 'b', name: 'B', times: ['12:00'], isPaused: true });
  const c = med({ id: 'c', name: 'C', times: ['09:00'], schedule: { type: 'weekly', daysOfWeek: [0] } });
  const log: MedicationLog = {
    id: 'l', medicationId: 'a', status: MedicationStatus.Taken, timestamp: '2026-09-02T05:00:00Z',
    scheduledDate: '2026-09-02', scheduledTime: '08:00',
  };
  it('one dose per time; paused and off-days excluded; logs attached', () => {
    const doses = getDosesForDate([a, b, c], [log], '2026-09-02'); // Wednesday
    expect(doses.map(d => `${d.medication.id}@${d.time}`)).toEqual(['a@08:00', 'a@20:00']);
    expect(doses[0].log?.status).toBe(MedicationStatus.Taken);
    expect(doses[1].log).toBeUndefined();
  });
});

describe('time helpers', () => {
  it('minutesApart wraps midnight', () => {
    expect(minutesApart('23:50', '00:10')).toBe(20);
  });
  it('calculateMedicationTimes spreads doses', () => {
    expect(calculateMedicationTimes(3, '23:00', '07:00')).toEqual(['07:30', '14:45', '22:00']);
    expect(calculateMedicationTimes(1, '22:00', '06:00')).toEqual(['06:30']);
    expect(calculateMedicationTimes(2, '01:00', '09:00')).toEqual(['09:30', '00:00']);
  });
});

describe('isStockLow (one threshold everywhere: ≤ 3 days of doses or ≤ 3 units)', () => {
  const stocked = (remaining: number, times: string[], perDose = 1) => med({ times, stock: { remaining, total: 60, perDose } });
  it('uses 3 days of doses when that is larger', () => {
    expect(isStockLow(stocked(6, ['08:00', '20:00']))).toBe(true);  // 2/day → 3 days = 6
    expect(isStockLow(stocked(7, ['08:00', '20:00']))).toBe(false);
  });
  it('floors at 3 units for light use', () => {
    expect(isStockLow(stocked(3, ['08:00']))).toBe(true);
    expect(isStockLow(stocked(4, ['08:00']))).toBe(false);
    expect(isStockLow(stocked(3, []))).toBe(true);
  });
  it('untracked stock is never low', () => {
    expect(isStockLow(med())).toBe(false);
  });
});

describe('doses before the medication was added (added at 19:20 → the 07:30 dose is not "missed")', () => {
  const added = med({ times: ['07:30', '21:00'], startDate: '2026-09-29', createdAt: new Date('2026-09-29T19:20:00').toISOString() });
  it('isDoseBeforeStart compares against createdAt', () => {
    expect(isDoseBeforeStart(added, '2026-09-29', '07:30')).toBe(true);
    expect(isDoseBeforeStart(added, '2026-09-29', '21:00')).toBe(false);
    expect(isDoseBeforeStart(added, '2026-09-30', '07:30')).toBe(false);
  });
  it('old records without createdAt start at the start day midnight', () => {
    const old = med({ startDate: '2026-09-10', createdAt: undefined as unknown as string });
    expect(isDoseBeforeStart(old, '2026-09-10', '00:00')).toBe(false);
    expect(isDoseBeforeStart(old, '2026-09-09', '23:59')).toBe(true);
  });
  it('getDosesForDate leaves the earlier dose out, unless it was logged anyway', () => {
    expect(getDosesForDate([added], [], '2026-09-29').map(d => d.time)).toEqual(['21:00']);
    const log: MedicationLog = { id: 'l', medicationId: 'm', status: MedicationStatus.Taken, timestamp: '', scheduledDate: '2026-09-29', scheduledTime: '07:30' };
    expect(getDosesForDate([added], [log], '2026-09-29').map(d => d.time)).toEqual(['07:30', '21:00']);
  });
});
