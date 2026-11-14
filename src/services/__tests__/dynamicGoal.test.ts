import AsyncStorage from '@react-native-async-storage/async-storage';
import { dynamicGoalService } from '../dynamicGoalService';
import { storageService } from '../storageService';

beforeEach(async () => { await AsyncStorage.clear(); });

describe("today's effective goal (Home, reminders, nudge and widget share it)", () => {
  it('is the base goal plus only today\'s adjustments', async () => {
    await storageService.saveWaterGoal(2000);
    await dynamicGoalService.addAdjustment('hot_weather'); // +500 today
    await AsyncStorage.setItem('@aquamed_goal_adjustments', JSON.stringify([
      ...(await dynamicGoalService.getAllAdjustments()),
      { id: 'old', type: 'exercise', amountMl: 300, timestamp: '2020-01-01T12:00:00Z', label: '' },
    ]));
    expect(await dynamicGoalService.getTodayEffectiveGoal()).toBe(2500);
  });
  it('without adjustments equals the base goal', async () => {
    await storageService.saveWaterGoal(1800);
    expect(await dynamicGoalService.getTodayEffectiveGoal()).toBe(1800);
  });
});
