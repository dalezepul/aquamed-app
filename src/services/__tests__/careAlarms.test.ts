/**
 * Device reports E5 (DevTools "2 s" tests never fire) and J3/J5 (caregiver late alarm never shows).
 * expo-notifications is an in-memory mockStore here, so we see exactly what reaches the native scheduler.
 */
const mockStore = new Map<string, { identifier: string; content: any; trigger: any }>();
jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' },
  AndroidImportance: { HIGH: 4, MAX: 5, DEFAULT: 3 },
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  setNotificationCategoryAsync: jest.fn(async () => null),
  getAllScheduledNotificationsAsync: jest.fn(async () => [...mockStore.values()]),
  cancelScheduledNotificationAsync: jest.fn(async (id: string) => { mockStore.delete(id); }),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => { mockStore.clear(); }),
  scheduleNotificationAsync: jest.fn(async ({ identifier, content, trigger }: any) => {
    const id = identifier ?? `auto_${mockStore.size}_${Math.random()}`;
    mockStore.set(id, { identifier: id, content, trigger });
    return id;
  }),
}));

import { Platform } from 'react-native';
import { notificationService, CARE_TEST_PREFIX } from '../notificationService';
import { planCaregiverAlarms, Pair, SharedDose } from '../pairing';

const MIN = 60000;
const pair = { id: 'p_c', patientName: 'Anne' } as Pair;

beforeAll(() => { Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true }); });
beforeEach(() => mockStore.clear());

describe('caregiver late alarm (J3/J5)', () => {
  const now = new Date('2026-09-29T12:00:00').getTime();
  const dose: SharedDose = { medId: 'm1', name: 'Aspirin', dose: '1', date: '2026-09-29', time: '11:35', at: now - 25 * MIN };

  test('dose added 25 min late -> alarm 5 min from now at lateMin 30', () => {
    const [a] = planCaregiverAlarms([{ pair, doses: [dose], handled: new Set() }], now, 20, 30);
    expect(a.at.getTime()).toBe(now + 5 * MIN);
    expect(a.id.startsWith('care_')).toBe(true);
  });

  test('setCareAlarms hands the native side a valid DATE trigger on the escalation channel, and rescheduleAll keeps it', async () => {
    const alarms = planCaregiverAlarms([{ pair, doses: [{ ...dose, at: Date.now() - 25 * MIN }], handled: new Set() }], Date.now(), 20, 30);
    await notificationService.setCareAlarms(alarms);
    const [req] = [...mockStore.values()].filter(r => r.identifier.startsWith('care_'));
    expect(req.trigger).toEqual({ type: 'date', date: alarms[0].at, channelId: 'escalation_v2' });
    expect(req.content.data.type).toBe('care_late');
    await notificationService.rescheduleAll();
    expect(mockStore.has(alarms[0].id)).toBe(true);
  });

  test('a sync never erases a pending DevTools caregiver-alarm test', async () => {
    await notificationService.setCareAlarms([{ id: `${CARE_TEST_PREFIX}1`, at: new Date(Date.now() + MIN), title: 't', body: 'b', data: { type: 'care_late' } }]);
    await notificationService.setCareAlarms([]);
    expect(mockStore.has(`${CARE_TEST_PREFIX}1`)).toBe(true);
  });
});

describe('DevTools test notification (E5)', () => {
  test('survives the rescheduleAll that DevTools runs right after it', async () => {
    await notificationService.sendTest({ type: 'water', date: '2026-09-29' }, 2);
    expect(mockStore.size).toBe(1);
    await notificationService.rescheduleAll(); // DevTools act() does this; it used to cancel the test
    const tests = [...mockStore.values()].filter(r => r.content.data?.test);
    expect(tests).toHaveLength(1);
    expect(tests[0].trigger).toMatchObject({ type: 'date', channelId: 'water_v2' });
  });
});
