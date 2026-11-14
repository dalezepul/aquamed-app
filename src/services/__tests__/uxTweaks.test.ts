import AsyncStorage from '@react-native-async-storage/async-storage';
import { storageService, displayModeOf, displayModePatch, goalAboveLimit, DEFAULT_APP_SETTINGS } from '../storageService';
import { dynamicGoalService } from '../dynamicGoalService';
import { isStockOut, addStockBox } from '../../utils/ScheduleUtils';
import { daysToNextFreeze } from '../../utils/streak';
import { Medication, MedicationStatus, Priority } from '../../types/models';

beforeEach(async () => { await AsyncStorage.clear(); });

describe('display mode (Normal / Sade / Büyük ve sade)', () => {
  it('old saves: elderlyMode true → large, false → normal', () => {
    expect(displayModeOf({ elderlyMode: true })).toBe('large');
    expect(displayModeOf({ elderlyMode: false })).toBe('normal');
    expect(displayModeOf(undefined)).toBe('normal');
  });
  it('round-trips every mode; elderlyMode stays the on/off switch', () => {
    for (const m of ['normal', 'simple', 'large'] as const) {
      expect(displayModeOf({ ...DEFAULT_APP_SETTINGS, ...displayModePatch(m) })).toBe(m);
    }
    expect(displayModeOf({ elderlyMode: false, displayMode: 'simple' })).toBe('normal');
  });
});

describe('goal above doctor limit', () => {
  it('returns the limit only when a limit is set and the goal exceeds it', () => {
    expect(goalAboveLimit(2500, { fluidLimitMl: 2000 })).toBe(2000);
    expect(goalAboveLimit(2000, { fluidLimitMl: 2000 })).toBeNull();
    expect(goalAboveLimit(9000, { fluidLimitMl: null })).toBeNull();
  });
});

describe('extra goal chips toggle', () => {
  it('second tap removes today\'s extra, third adds it back; other types untouched', async () => {
    await storageService.saveWaterGoal(2000);
    await dynamicGoalService.addAdjustment('exercise');
    expect(await dynamicGoalService.toggleAdjustment('hot_weather')).toBe(true);
    expect(await dynamicGoalService.getTodayEffectiveGoal()).toBe(2800);
    expect(await dynamicGoalService.toggleAdjustment('hot_weather')).toBe(false);
    expect(await dynamicGoalService.getTodayEffectiveGoal()).toBe(2300);
    expect(await dynamicGoalService.toggleAdjustment('hot_weather')).toBe(true);
    expect(await dynamicGoalService.getTodayEffectiveGoal()).toBe(2800);
  });
  it('removing all of today keeps older days', async () => {
    await dynamicGoalService.addAdjustment('caffeine');
    await AsyncStorage.setItem('@aquamed_goal_adjustments', JSON.stringify([
      ...(await dynamicGoalService.getAllAdjustments()),
      { id: 'old', type: 'exercise', amountMl: 300, timestamp: '2020-01-01T12:00:00Z', label: '' },
    ]));
    expect(await dynamicGoalService.removeTodayAdjustment()).toBe(1);
    expect((await dynamicGoalService.getAllAdjustments()).map(a => a.id)).toEqual(['old']);
  });
});

describe('stock: out and +1 box', () => {
  const med = (stock: Medication['stock']): Medication => ({
    id: 'm1', name: 'Metformin', times: ['08:00'], startDate: '2026-09-01', endDate: null,
    schedule: { type: 'daily' }, foodTiming: 'any', priority: Priority.Medium, isPaused: false,
    createdAt: '2026-09-01T00:00:00Z', stock,
  });
  it('isStockOut when a dose can\'t be covered', () => {
    expect(isStockOut({ remaining: 0, total: 30, perDose: 1 })).toBe(true);
    expect(isStockOut({ remaining: 0.5, total: 30, perDose: 1 })).toBe(true);
    expect(isStockOut({ remaining: 1, total: 30, perDose: 1 })).toBe(false);
    expect(isStockOut(undefined)).toBe(false);
  });
  it('addStockBox adds, remembers the size and grows total when exceeded', () => {
    expect(addStockBox({ remaining: 5, total: 30, perDose: 1 }, 20)).toEqual({ remaining: 25, total: 30, perDose: 1, boxSize: 20 });
    expect(addStockBox({ remaining: 20, total: 30, perDose: 1 }, 28)).toEqual({ remaining: 48, total: 48, perDose: 1, boxSize: 28 });
  });
  it('taking with 0 stock logs the dose, stock stays 0; +1 box refills and is stored', async () => {
    const m = med({ remaining: 0, total: 28, perDose: 1 });
    await storageService.saveMedication(m);
    const after = await storageService.setDoseStatus(m, '2026-09-24', '08:00', MedicationStatus.Taken);
    expect(after.stock!.remaining).toBe(0);
    expect(await storageService.getLogsForDate('2026-09-24')).toHaveLength(1);
    const refilled = await storageService.addStockBox('m1', 28);
    expect(refilled!.stock).toEqual({ remaining: 28, total: 28, perDose: 1, boxSize: 28 });
    expect((await storageService.getMedication('m1'))!.stock!.boxSize).toBe(28);
  });
  it('+1 box does nothing for untracked stock', async () => {
    await storageService.saveMedication(med(undefined));
    expect(await storageService.addStockBox('m1', 28)).toBeNull();
  });
});

describe('streak card freeze countdown', () => {
  it('hidden up to 3 days and when freezes are full', () => {
    expect(daysToNextFreeze(3, 0)).toBeNull();
    expect(daysToNextFreeze(10, 3)).toBeNull();
  });
  it('days until the next milestone', () => {
    expect(daysToNextFreeze(4, 0)).toBe(3);   // → 7
    expect(daysToNextFreeze(7, 1)).toBe(23);  // → 30
    expect(daysToNextFreeze(95, 2)).toBe(85); // → 180
  });
});
