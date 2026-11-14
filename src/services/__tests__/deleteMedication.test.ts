import AsyncStorage from '@react-native-async-storage/async-storage';
import { Medication, Priority } from '../../types/models';

const mockDeleted: string[] = [];
jest.mock('expo-file-system', () => ({
  Paths: { document: { uri: 'file:///docs/' } },
  File: class { u: string; constructor(u: string) { this.u = u; } delete() { mockDeleted.push(this.u); } },
}));
// eslint-disable-next-line import/first
import { storageService } from '../storageService';

const med = (photoUri?: string): Medication => ({
  id: 'm1', name: 'X', times: ['08:00'], startDate: '2026-09-01', endDate: null, schedule: { type: 'daily' },
  foodTiming: 'any', priority: Priority.Medium, isPaused: false, createdAt: '', photoUri,
});

beforeEach(async () => { await AsyncStorage.clear(); mockDeleted.length = 0; });

describe('deleteMedication (detail modal and edit screen share it)', () => {
  it("removes the med and the app's copy of its photo", async () => {
    await storageService.saveMedication(med('file:///docs/med-photos/a.jpg'));
    await storageService.deleteMedication('m1');
    expect(await storageService.getMedication('m1')).toBeFalsy();
    expect(mockDeleted).toEqual(['file:///docs/med-photos/a.jpg']);
  });
  it('never deletes a file outside the app folder', async () => {
    await storageService.saveMedication(med('content://gallery/1'));
    await storageService.deleteMedication('m1');
    expect(mockDeleted).toEqual([]);
  });
});
