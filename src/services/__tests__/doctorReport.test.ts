import { buildDoctorReport, DoctorReportInput } from '../doctorReport';
import { Medication, MedicationLog, MedicationStatus, Priority, WaterLog, BeverageType } from '../../types/models';
import { addDays } from '../../utils/DateUtils';

const med = (id: string, over: Partial<Medication> = {}): Medication => ({
  id, name: id, dosage: '500 mg', times: ['08:00'], startDate: '2026-08-01', endDate: null,
  schedule: { type: 'daily' }, foodTiming: 'any', priority: Priority.Medium, isPaused: false, createdAt: '', ...over,
});
const log = (medicationId: string, date: string, time: string, status = MedicationStatus.Taken): MedicationLog => ({
  id: `${medicationId}${date}${time}`, medicationId, status, timestamp: `${date}T${time}:00`, scheduledDate: date, scheduledTime: time,
});
const water = (date: string, ml: number): WaterLog => ({
  id: date + ml, amountMl: ml, hydrationAmountMl: ml, beverageType: BeverageType.Water, timestamp: new Date(`${date}T10:00:00`).toISOString(),
});

const FROM = '2026-09-01';
const TO = '2026-09-10';
const NOW = new Date('2026-09-10T12:00:00'); // today's 20:00 dose is not due yet

const input = (over: Partial<DoctorReportInput> = {}): DoctorReportInput => ({
  meds: [], medLogs: [], waterLogs: [], waterGoal: 1500, goalHistory: {}, fluidLimitMl: null, ...over,
});

describe('buildDoctorReport', () => {
  // Twice daily; everything taken except day 3 evening (skipped), day 5 (no logs) and today's morning (no log).
  const a = med('A', { times: ['08:00', '20:00'] });
  const aLogs: MedicationLog[] = [];
  for (let i = 0; i < 9; i++) {
    const d = addDays(FROM, i);
    if (d === '2026-09-05') continue;
    aLogs.push(log('A', d, '08:00'));
    aLogs.push(log('A', d, '20:00', d === '2026-09-03' ? MedicationStatus.Skipped : MedicationStatus.Taken));
  }

  it('counts planned, taken, skipped, missed and adherence', () => {
    const r = buildDoctorReport(input({ meds: [a], medLogs: aLogs }), FROM, TO, NOW);
    expect(r.meds).toHaveLength(1);
    expect(r.meds[0]).toMatchObject({ planned: 19, taken: 15, skipped: 1, missed: 3, adherence: 79 });
    expect(r.days).toHaveLength(10);
    expect(r.days[4]).toMatchObject({ date: '2026-09-05', medTaken: 0, medPlanned: 2 });
    expect(r.days[9]).toMatchObject({ medTaken: 0, medPlanned: 1 });
  });

  it('counts unlogged past doses as missed from the start date, and ignores meds ended before the range', () => {
    const late = med('C', { times: ['10:00'], startDate: '2026-09-08' });
    const ended = med('D', { endDate: '2026-08-20' });
    const r = buildDoctorReport(input({ meds: [late, ended] }), FROM, TO, NOW);
    expect(r.meds.map(m => m.id)).toEqual(['C']);
    expect(r.meds[0]).toMatchObject({ planned: 3, taken: 0, missed: 3, adherence: 0 });
  });

  it('paused meds: no missed doses invented, only their logs count', () => {
    const paused = med('B', { times: ['09:00'], isPaused: true });
    const r = buildDoctorReport(input({ meds: [paused], medLogs: [log('B', '2026-09-02', '09:00')] }), FROM, TO, NOW);
    expect(r.meds[0]).toMatchObject({ paused: true, planned: 1, taken: 1, missed: 0, adherence: 100 });
  });

  it('keeps logs of a deleted medication under its logged name', () => {
    const l = { ...log('gone', '2026-09-04', '08:00'), medicationName: 'Eski ilaç' };
    const r = buildDoctorReport(input({ medLogs: [l] }), FROM, TO, NOW);
    expect(r.meds[0]).toMatchObject({ name: 'Eski ilaç', schedule: undefined, planned: 1, taken: 1 });
  });

  it('water: average over logged days, goal days, days over the doctor limit (raw volume)', () => {
    const tea: WaterLog = { ...water('2026-09-03', 1000), beverageType: BeverageType.Tea, hydrationAmountMl: 800 };
    const logs = [water('2026-09-01', 2000), water('2026-09-02', 1000), water('2026-09-02', 700), tea, water('2026-08-31', 5000)];
    const r = buildDoctorReport(input({ waterLogs: logs, fluidLimitMl: 1600 }), FROM, TO, NOW);
    expect(r.water).toEqual({ loggedDays: 3, avgMl: Math.round((2000 + 1700 + 1000) / 3), goalMetDays: 2, limitMl: 1600, overLimitDays: 2 });
    expect(r.days.filter(d => d.overLimit).map(d => d.date)).toEqual(['2026-09-01', '2026-09-02']);
  });

  it('no limit set → nothing is over the limit; goal follows goal history', () => {
    const logs = [water('2026-09-01', 2000), water('2026-09-05', 2000)];
    const r = buildDoctorReport(input({ waterLogs: logs, goalHistory: { '2026-09-04': 2500 } }), FROM, TO, NOW);
    expect(r.water.overLimitDays).toBe(0);
    expect(r.water.limitMl).toBeNull();
    expect(r.water.goalMetDays).toBe(1); // 09-05 is under the raised goal
  });
});
