import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { setLocale } from '../localization/i18n';
import { storageService } from './storageService';
import { notificationService } from './notificationService';
import { recordError } from './crash';

/**
 * The notification plan only covers a few days (60 pending max). This task re-plans it a few times
 * a day while the app stays closed, so reminders don't silently run out. The OS decides the exact
 * timing (WorkManager / BGTaskScheduler); the plan also ends with a "open AquaMed" notice as a fallback.
 * Must be defined at module level, before the app renders: imported from index.ts.
 */
export const RESCHEDULE_TASK = 'aquamed-reschedule';

if (Platform.OS !== 'web') TaskManager.defineTask(RESCHEDULE_TASK, async () => {
  try {
    setLocale(await storageService.getLanguage());
    await notificationService.rescheduleAll();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.warn('[rescheduleTask]', e);
    recordError(e, 'notifications.backgroundReschedule');
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export function registerRescheduleTask() {
  if (Platform.OS === 'web') return;
  BackgroundTask.registerTaskAsync(RESCHEDULE_TASK, { minimumInterval: 6 * 60 }).catch(e => console.warn('[rescheduleTask] register', e));
}
