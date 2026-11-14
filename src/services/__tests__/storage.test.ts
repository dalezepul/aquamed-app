import AsyncStorage from '@react-native-async-storage/async-storage';
import { storageService, STORAGE_KEYS, followerSettings, DEFAULT_APP_SETTINGS } from '../storageService';
import { migrateV1toV2 } from '../migrations';
import { Medication, MedicationStatus, Priority, BeverageType } from '../../types/models';

const med = (over: Partial<Medication> = {}): Medication => ({
  id: 'm1', name: 'Metformin', dosage: '500 mg', times: ['08:00', '20:00'], startDate: '2026-09-01', endDate: null,
  schedule: { type: 'daily' }, foodTiming: 'with', priority: Priority.Medium, isPaused: false,
  createdAt: '2026-09-01T00:00:00Z', stock: { remaining: 10, total: 30, perDose: 1 }, ...over,
});

const remaining = async () => (await storageService.getMedication('m1'))!.stock!.remaining;

beforeEach(async () => { await AsyncStorage.clear(); });

describe('setDoseStatus', () => {
  it('taking the same dose twice logs once and moves stock once', async () => {
    const m = med();
    await storageService.saveMedication(m);
    await storageService.setDoseStatus(m, '2026-09-24', '08:00', MedicationStatus.Taken);
    await storageService.setDoseStatus(m, '2026-09-24', '08:00', MedicationStatus.Taken);
    expect(await storageService.getLogsForDate('2026-09-24')).toHaveLength(1);
    expect(await remaining()).toBe(9);
  });
  it('taken → skipped gives the pill back; undo clears the log', async () => {
    const m = med();
    await storageService.saveMedication(m);
    await storageService.setDoseStatus(m, '2026-09-24', '08:00', MedicationStatus.Taken);
    await storageService.setDoseStatus(m, '2026-09-24', '08:00', MedicationStatus.Skipped);
    expect(await remaining()).toBe(10);
    await storageService.setDoseStatus(m, '2026-09-24', '08:00', null);
    expect(await storageService.getLogsForDate('2026-09-24')).toHaveLength(0);
  });
  it('the two daily doses are independent', async () => {
    const m = med();
    await storageService.saveMedication(m);
    await storageService.setDoseStatus(m, '2026-09-24', '08:00', MedicationStatus.Taken);
    await storageService.setDoseStatus(m, '2026-09-24', '20:00', MedicationStatus.Taken);
    expect(await remaining()).toBe(8);
  });
  it('deleting a taken log restores stock', async () => {
    const m = med();
    await storageService.saveMedication(m);
    await storageService.setDoseStatus(m, '2026-09-24', '08:00', MedicationStatus.Taken);
    const [log] = await storageService.getLogsForDate('2026-09-24');
    await storageService.deleteMedicationLog(log.id);
    expect(await remaining()).toBe(10);
  });
  it('stock never goes negative', async () => {
    const m = med({ stock: { remaining: 0, total: 30, perDose: 1 } });
    await storageService.saveMedication(m);
    await storageService.setDoseStatus(m, '2026-09-24', '08:00', MedicationStatus.Taken);
    expect(await remaining()).toBe(0);
  });
});

describe('editing keeps identity and history', () => {
  it('saveMedication with same id updates in place', async () => {
    const m = med();
    await storageService.saveMedication(m);
    await storageService.setDoseStatus(m, '2026-09-24', '08:00', MedicationStatus.Taken);
    await storageService.saveMedication({ ...m, times: ['09:00', '08:00', '09:00'] });
    const saved = await storageService.getMedications();
    expect(saved).toHaveLength(1);
    expect(saved[0].times).toEqual(['08:00', '09:00']);
    expect(await storageService.getLogsForDate('2026-09-24')).toHaveLength(1);
  });
});

describe('clash check', () => {
  it('finds other meds within 30 minutes, ignores itself and paused', async () => {
    await storageService.saveMedication(med());
    await storageService.saveMedication(med({ id: 'p', name: 'Paused', times: ['08:10'], isPaused: true }));
    expect(await storageService.findTimeClashes(['08:25'])).toEqual(['Metformin']);
    expect(await storageService.findTimeClashes(['08:25'], 'm1')).toEqual([]);
    expect(await storageService.findTimeClashes(['10:00'])).toEqual([]);
  });
});

describe('streak', () => {
  it('counts days where water goal met and every dose taken', async () => {
    const now = new Date('2026-09-24T10:00:00');
    const m = med({ stock: undefined, times: ['08:00'], startDate: '2026-09-20' });
    await storageService.saveMedication(m);
    await storageService.saveWaterGoal(1000);
    for (const day of ['2026-09-22', '2026-09-23']) {
      await storageService.saveWaterLog({
        id: day, amountMl: 1000, hydrationAmountMl: 1000, beverageType: BeverageType.Water,
        timestamp: new Date(`${day}T12:00:00`).toISOString(),
      });
      await storageService.setDoseStatus(m, day, '08:00', MedicationStatus.Taken);
    }
    expect(await storageService.calculateCurrentStreak(now)).toBe(2);
  });
});

describe('migration v1 → v2', () => {
  const v1Meds = [
    { id: 'a1', name: 'Metformin', dosage: 'Tok karnına', time: '08:00', startDate: '2026-09-01T09:00:00.000Z', endDate: null, priority: Priority.High, isActive: true, remainingPills: 20, totalPills: 30, groupId: 'g', stockTracking: true },
    { id: 'a2', name: 'Metformin', dosage: 'Tok karnına', time: '20:00', startDate: '2026-09-01T09:00:00.000Z', endDate: null, priority: Priority.High, isActive: true, remainingPills: 20, totalPills: 30, groupId: 'g', stockTracking: true },
    { id: 'c1', name: 'Pill', time: '09:00', startDate: '2026-09-05', endDate: null, priority: Priority.Low, isActive: true, remainingPills: 0, totalPills: 0,
      advancedSchedule: { type: 'cyclic', cycleDaysActive: 21, cycleDaysOff: 7, cycleStartDate: '2026-08-01' } },
  ];
  const v1Logs = [
    { id: 'l1', medicationId: 'a2', status: MedicationStatus.Taken, timestamp: new Date('2026-09-10T20:05:00').toISOString() },
    { id: 'l2', medicationId: 'a2', status: MedicationStatus.Taken, timestamp: new Date('2026-09-10T20:30:00').toISOString() }, // v1 double tap
  ];

  it('merges groups, keeps cycle phase and moves the old description text to notes', () => {
    const { medications, logs } = migrateV1toV2(v1Meds as any, v1Logs as any);
    expect(medications).toHaveLength(2);
    const metf = medications.find(m => m.name === 'Metformin')!;
    expect(metf.times).toEqual(['08:00', '20:00']);
    expect(metf.notes).toBe('Tok karnına');
    expect(metf.stock).toEqual({ remaining: 20, total: 30, perDose: 1 });
    expect(medications.find(m => m.name === 'Pill')!.startDate).toBe('2026-08-01');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ medicationId: 'a1', scheduledDate: '2026-09-10', scheduledTime: '20:00' });
  });

  it('runMigrations converts stored v1 data exactly once', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.MEDICATIONS, JSON.stringify(v1Meds));
    await AsyncStorage.setItem(STORAGE_KEYS.MEDICATION_LOGS, JSON.stringify(v1Logs));
    await storageService.runMigrations();
    await storageService.runMigrations();
    const meds = await storageService.getMedications();
    expect(meds).toHaveLength(2);
    expect(meds.every(m => Array.isArray(m.times))).toBe(true);
  });
});

describe('backup round trip', () => {
  it('export → clear → import restores everything', async () => {
    await storageService.saveMedication(med());
    await storageService.saveUserName('Ayşe');
    const backup = await storageService.exportAllData();
    await storageService.clearAllAppData();
    expect(await storageService.getMedications()).toHaveLength(0);
    await storageService.importAllData(backup);
    expect(await storageService.getMedications()).toHaveLength(1);
    expect(await storageService.getUserName()).toBe('Ayşe');
  });
  it('rejects a corrupt backup without touching data', async () => {
    await storageService.saveUserName('Ayşe');
    await expect(storageService.importAllData({ '@aquamed_user_name': '{bad' })).rejects.toThrow();
    expect(await storageService.getUserName()).toBe('Ayşe');
  });
});

describe('rewarded ads → streak freeze', () => {
  it('every third ad grants one freeze and resets the counter', async () => {
    const now = new Date('2026-09-24T10:00:00');
    expect(await storageService.recordRewardedAd(now)).toEqual({ progress: 1, granted: false });
    expect(await storageService.recordRewardedAd(now)).toEqual({ progress: 2, granted: false });
    expect(await storageService.recordRewardedAd(now)).toEqual({ progress: 0, granted: true });
    expect(await storageService.getFreezeGrants()).toEqual([{ date: '2026-09-24', source: 'ad' }]);
  });
  it('Plus grants at most one freeze per month', async () => {
    expect(await storageService.grantMonthlyPlusFreeze(new Date('2026-09-24T10:00:00'))).toBe(true);
    expect(await storageService.grantMonthlyPlusFreeze(new Date('2026-09-30T10:00:00'))).toBe(false);
    expect(await storageService.grantMonthlyPlusFreeze(new Date('2026-10-01T10:00:00'))).toBe(true);
  });
});

describe('followerSettings', () => {
  it('turns water reminders and the evening nudge off, keeps the rest', () => {
    const s = followerSettings({ ...DEFAULT_APP_SETTINGS, elderlyMode: true });
    expect(s.waterReminder).toEqual({ ...DEFAULT_APP_SETTINGS.waterReminder, mode: 'off' });
    expect(s.eveningNudge.enabled).toBe(false);
    expect(s.escalation).toEqual(DEFAULT_APP_SETTINGS.escalation);
    expect(s.elderlyMode).toBe(true);
    expect(DEFAULT_APP_SETTINGS.waterReminder.mode).toBe('interval');
  });
});
