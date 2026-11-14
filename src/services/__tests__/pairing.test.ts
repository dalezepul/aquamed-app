import {
  generateCode, isValidCode, recentReports, inviteUsable, doseRef, buildSharedDoses, lateDoses, eventMessage,
  planCaregiverAlarms, CODE_TTL_MS, LATE_MINUTES, Pair, parseCareEvent, displayName, careAlarmId,
} from '../pairing';
import { Medication, MedicationStatus, Priority } from '../../types/models';

const med = (over: Partial<Medication> = {}): Medication => ({
  id: 'm1', name: 'Metformin', dosage: '500 mg', times: ['09:00', '21:00'], startDate: '2026-01-01', endDate: null,
  schedule: { type: 'daily' }, foodTiming: 'any', priority: Priority.Medium, isPaused: false, createdAt: '2026-01-01T00:00:00Z', ...over,
});
const pair: Pair = { id: 'p_c', patientUid: 'p', caregiverUid: 'c', patientName: 'Annem', caregiverName: 'Ali', shareWater: false, createdAt: 0 };

describe('invite code', () => {
  it('is always 8 digits, zero-padded', () => {
    expect(generateCode(() => 0)).toBe('00000000');
    expect(generateCode(() => 0.0421)).toBe('04210000');
    expect(generateCode(() => 0.999999999)).toBe('99999999');
    for (let i = 0; i < 200; i++) expect(isValidCode(generateCode())).toBe(true);
    expect(isValidCode('1234567')).toBe(false);
    expect(isValidCode('12a45678')).toBe(false);
  });

  it('is usable once, for 10 minutes', () => {
    const now = 1_000_000;
    expect(inviteUsable({ used: false, expiresAt: now + CODE_TTL_MS }, now)).toBe(true);
    expect(inviteUsable({ used: false, expiresAt: now + CODE_TTL_MS }, now + CODE_TTL_MS)).toBe(false);
    expect(inviteUsable({ used: true, expiresAt: now + CODE_TTL_MS }, now)).toBe(false);
  });
});

describe('shared plan', () => {
  const now = new Date('2026-09-29T10:00:00');

  it('lists today + 7 days of doses, skipping paused meds', () => {
    const doses = buildSharedDoses([med(), med({ id: 'm2', isPaused: true })], now);
    expect(doses).toHaveLength(16);
    expect(doses[0]).toEqual({ medId: 'm1', name: 'Metformin', dose: '500 mg', date: '2026-09-29', time: '09:00', at: new Date('2026-09-29T09:00:00').getTime() });
  });

  it('late doses: unlogged, ≥30 min overdue, within 24h', () => {
    const late = lateDoses([med()], [], now);
    expect(late.map(d => `${d.date} ${d.time}`)).toEqual(['2026-09-28 21:00', '2026-09-29 09:00']); // yesterday 09:00 is >24h ago
    // today 09:00 is only 20 min late at 09:20
    expect(lateDoses([med()], [], new Date('2026-09-29T09:20:00')).map(d => d.time)).toEqual(['21:00']);
    const log = { id: 'l', medicationId: 'm1', status: MedicationStatus.Taken, timestamp: '', scheduledDate: '2026-09-29', scheduledTime: '09:00' };
    expect(lateDoses([med()], [log], now).filter(d => d.date === '2026-09-29')).toEqual([]);
  });
});

describe('caregiver alarms', () => {
  const now = new Date('2026-09-29T10:00:00').getTime();
  const doses = buildSharedDoses([med()], new Date(now));

  it('one alarm 30 min after each upcoming dose, minus handled ones, nearest first', () => {
    const handled = new Set([doseRef('m1', '2026-09-29', '21:00')]);
    const alarms = planCaregiverAlarms([{ pair, doses, handled }], now, 3);
    expect(alarms.map(a => a.at.getTime())).toEqual([
      new Date('2026-09-30T09:00:00').getTime() + LATE_MINUTES * 60000,
      new Date('2026-09-30T21:00:00').getTime() + LATE_MINUTES * 60000,
      new Date('2026-10-01T09:00:00').getTime() + LATE_MINUTES * 60000,
    ]);
    expect(alarms[0].id).toBe('care_p_c_m1_2026-09-30_0900');
    expect(alarms[0].data).toEqual({ type: 'care_late', pairId: 'p_c' });
  });

  it.each([15, 60])('caregiver-chosen delay: alarms %i min after each dose', min => {
    const alarms = planCaregiverAlarms([{ pair, doses, handled: new Set() }], now, 2, min);
    expect(alarms.map(a => a.at.getTime())).toEqual([
      new Date('2026-09-29T21:00:00').getTime() + min * 60000,
      new Date('2026-09-30T09:00:00').getTime() + min * 60000,
    ]);
    // At 09:10 today's 09:00 dose is still ahead of its alarm for both delays
    expect(planCaregiverAlarms([{ pair, doses, handled: new Set() }], new Date('2026-09-29T09:10:00').getTime(), 1, min)[0].at.getTime())
      .toBe(new Date('2026-09-29T09:00:00').getTime() + min * 60000);
  });

  it('a dose 09:40 still gets its 10:10 alarm at 10:00', () => {
    const d = [{ medId: 'x', name: 'X', dose: '', date: '2026-09-29', time: '09:40', at: new Date('2026-09-29T09:40:00').getTime() }];
    expect(planCaregiverAlarms([{ pair, doses: d, handled: new Set() }], now)).toHaveLength(1);
  });
});

describe('event text', () => {
  it('picks the right message per type', () => {
    // Keys aren't merged into the locale files yet, so t() returns the key itself.
    const ev = { medName: 'Metformin', dose: '500 mg', time: '09:00' };
    expect(eventMessage({ ...ev, type: 'taken' }, 'Annem').title).toMatch(/taken|aldı/);
    expect(eventMessage({ ...ev, type: 'skipped' }, 'Annem').title).toMatch(/skipped|atladı/);
    expect(eventMessage({ ...ev, type: 'late' }, 'Annem').title).toMatch(/late|almadı|30/);
  });
});

describe('background care event', () => {
  const ev = { type: 'care_event', pairId: 'p_c', status: 'taken', medId: 'm1', medName: 'Metformin', dose: '500 mg', date: '2026-09-29', time: '09:00', patientName: 'Ayşe' };

  it('parses the Android task payload (data JSON in data.dataString) and plain objects', () => {
    expect(parseCareEvent({ notification: null, data: { dataString: JSON.stringify(ev) } })).toEqual(ev);
    expect(parseCareEvent({ data: { body: JSON.stringify(ev) } })).toEqual(ev);
    expect(parseCareEvent({ request: { content: { data: ev } } })).toEqual(ev);
    expect(parseCareEvent({ data: { dataString: JSON.stringify({ type: 'care' }) } })).toBeNull();
    expect(parseCareEvent({ data: { dataString: '{broken' } })).toBeNull();
    expect(parseCareEvent({ data: { dataString: JSON.stringify({ ...ev, status: 'deleted' }) } })).toBeNull();
    expect(parseCareEvent(null)).toBeNull();
  });

  it('targets the same local alarm the planner scheduled', () => {
    const doses = buildSharedDoses([med()], new Date('2026-09-29T08:00:00'));
    const alarms = planCaregiverAlarms([{ pair, doses, handled: new Set() }], new Date('2026-09-29T08:00:00').getTime(), 1);
    expect(alarms[0].id).toBe(careAlarmId(ev.pairId, ev.medId, ev.date, ev.time));
  });

  it('nickname wins over the patient name', () => {
    expect(displayName(pair, { p_c: ' Annem ' })).toBe('Annem');
    expect(displayName(pair, { p_c: '  ' })).toBe('Annem'); // pair.patientName
    expect(displayName({ ...pair, patientName: '' }, {})).not.toBe('');
  });
});

describe('recentReports', () => {
  it('turns taken/skipped logs of the last 24h into events, ignores older and missed', () => {
    const now = new Date('2026-09-29T12:00:00');
    const log = (id: string, status: MedicationStatus, date: string, time: string) =>
      ({ id, medicationId: 'm1', medicationName: 'Parol', dosage: '500 mg', status, timestamp: now.toISOString(), scheduledDate: date, scheduledTime: time });
    const out = recentReports([
      log('a', MedicationStatus.Taken, '2026-09-29', '09:00'),
      log('b', MedicationStatus.Skipped, '2026-09-28', '20:00'),
      log('c', MedicationStatus.Taken, '2026-09-27', '09:00'),
      log('d', MedicationStatus.Missed, '2026-09-29', '08:00'),
    ], now);
    expect(out.map(e => [e.type, e.date, e.time])).toEqual([['taken', '2026-09-29', '09:00'], ['skipped', '2026-09-28', '20:00']]);
    expect(out[0]).toMatchObject({ medId: 'm1', medName: 'Parol', dose: '500 mg' });
  });
});
