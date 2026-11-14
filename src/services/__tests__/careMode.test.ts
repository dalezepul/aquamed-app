import { SELF_TABS, pickPair, careSummary, todayDoseRows, commandsToApply, pendingWaterMl, CareCommand } from '../careMode';
import type { PairEvent, SharedDose } from '../pairing';
import { Medication, MedicationLog, MedicationStatus, Priority } from '../../types/models';

const at = (date: string, time: string) => new Date(`${date}T${time}:00`).getTime();
const dose = (time: string, date = '2026-09-29', medId = 'm1'): SharedDose => ({ medId, name: 'Parol', dose: '500 mg', date, time, at: at(date, time) });
const ev = (type: PairEvent['type'], time: string, evAt: number, medId = 'm1'): PairEvent =>
  ({ type, medId, medName: 'Parol', dose: '', date: '2026-09-29', time, scheduledAt: at('2026-09-29', time), at: evAt });
const doseCmd = (time: string, status: 'taken' | 'skipped', cmdAt: number, medId = 'm1', id = `c${cmdAt}`): CareCommand =>
  ({ id, type: 'dose', medId, date: '2026-09-29', time, status, by: 'cg', at: cmdAt });
const med = (id = 'm1'): Medication => ({
  id, name: 'Parol', dosage: '500 mg', times: ['09:00'], startDate: '2026-01-01', endDate: null,
  schedule: { type: 'daily' }, foodTiming: 'any', priority: Priority.Medium, isPaused: false, createdAt: '2026-01-01T00:00:00Z',
});

describe('SELF_TABS / pickPair', () => {
  it('self mode keeps its four tabs (caregiver mode has none)', () => {
    expect(SELF_TABS).toEqual(['Home', 'Medications', 'Progress', 'Settings']);
  });

  it('picks the chosen person, falls back to the first when unpaired/unknown, nothing when nobody', () => {
    const pairs = [{ id: 'a' }, { id: 'b' }];
    expect(pickPair(pairs, 'b')).toBe(pairs[1]);
    expect(pickPair(pairs, 'gone')).toBe(pairs[0]);
    expect(pickPair(pairs)).toBe(pairs[0]);
    expect(pickPair([], 'a')).toBeUndefined();
    expect(pickPair(null)).toBeUndefined();
  });
});

describe('careSummary', () => {
  const now = at('2026-09-29', '12:00');
  it('counts confirmed doses, lists late ones, next waiting dose and the newest event', () => {
    const rows = todayDoseRows(
      [dose('08:00'), dose('09:00'), dose('10:00'), dose('20:00'), dose('21:00')],
      [ev('taken', '08:00', 5), ev('skipped', '09:00', 9)],
      [doseCmd('20:00', 'taken', 7)],
      '2026-09-29', now, 30,
    );
    const s = careSummary(rows, [ev('taken', '08:00', 5), ev('skipped', '09:00', 9)]);
    expect([s.taken, s.total]).toEqual([1, 5]);          // 20:00 is only the caregiver's mark
    expect(s.late.map(r => r.dose.time)).toEqual(['10:00']);
    expect(s.next?.dose.time).toBe('21:00');
    expect(s.last?.time).toBe('09:00');
  });

  it('empty day', () => {
    expect(careSummary([], [])).toEqual({ taken: 0, total: 0, late: [], next: null, last: null });
  });
});

describe('todayDoseRows', () => {
  const now = at('2026-09-29', '12:00');
  const doses = [dose('21:00'), dose('09:00'), dose('11:45'), dose('08:00'), dose('07:00'), dose('09:00', '2026-09-30')];

  it('today only, by time; events > pending command > late > waiting', () => {
    const rows = todayDoseRows(
      doses,
      [ev('taken', '09:00', 1), ev('late', '07:00', 1)],
      [doseCmd('08:00', 'skipped', 5), doseCmd('09:00', 'skipped', 9)],
      '2026-09-29', now, 30,
    );
    expect(rows.map(r => [r.dose.time, r.state, !!r.pending])).toEqual([
      ['07:00', 'late', false],     // late event
      ['08:00', 'skipped', true],   // caregiver's unapplied mark
      ['09:00', 'taken', false],    // patient's event beats the command
      ['11:45', 'waiting', false],  // 15 min < 30
      ['21:00', 'waiting', false],
    ]);
  });

  it('overdue past the delay is late; latest taken/skipped event wins', () => {
    const rows = todayDoseRows([dose('09:00'), dose('11:00')], [ev('taken', '09:00', 1), ev('skipped', '09:00', 2)], [], '2026-09-29', now, 60);
    expect(rows.map(r => r.state)).toEqual(['skipped', 'late']);
  });

  it('sums pending water', () => {
    expect(pendingWaterMl([{ id: 'w', type: 'water', ml: 250, by: 'c', at: 1 }, doseCmd('09:00', 'taken', 2), { id: 'w2', type: 'water', ml: 200, by: 'c', at: 3 }])).toBe(450);
  });
});

describe('commandsToApply', () => {
  const log = (time: string): MedicationLog => ({ id: 'l', medicationId: 'm1', status: MedicationStatus.Taken, timestamp: '', scheduledDate: '2026-09-29', scheduledTime: time });

  it('skips doses the patient already logged (idempotent)', () => {
    expect(commandsToApply([doseCmd('09:00', 'taken', 1)], [med()], [log('09:00')])).toEqual([]);
  });

  it('one action per dose: the latest command', () => {
    const out = commandsToApply([doseCmd('09:00', 'skipped', 5), doseCmd('09:00', 'taken', 1)], [med()], []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'dose', date: '2026-09-29', time: '09:00', status: 'skipped' });
  });

  it('drops unknown meds, bad shapes and silly water amounts', () => {
    const bad = [
      doseCmd('09:00', 'taken', 1, 'gone'),
      { ...doseCmd('09:00', 'taken', 2), time: '9' },
      { ...doseCmd('09:00', 'taken', 3), status: 'late' } as unknown as CareCommand,
      { id: 'w1', type: 'water', ml: 5000, by: 'c', at: 4 },
      { id: 'w2', type: 'water', ml: -1, by: 'c', at: 5 },
      { id: 'w3', type: 'water', ml: 250, by: 'c', at: 6 },
    ] as CareCommand[];
    expect(commandsToApply(bad, [med()], []).map(a => a.kind === 'water' ? a.ml : a.time)).toEqual([250]);
  });

  it('applying twice is a no-op the second time (log now exists)', () => {
    const cmds = [doseCmd('09:00', 'taken', 1)];
    expect(commandsToApply(cmds, [med()], [])).toHaveLength(1);
    expect(commandsToApply(cmds, [med()], [log('09:00')])).toHaveLength(0);
  });
});
