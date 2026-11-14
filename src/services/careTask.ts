import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { setLocale } from '../localization/i18n';
import { storageService } from './storageService';
import { doseDateTime } from '../utils/ScheduleUtils';
import { recordError } from './crash';
import { applyPendingCommands, careAlarmId, displayName, eventMessage, getLateMinutes, getNicknames, parseCareEvent } from './pairing';

/**
 * Runs even when the app is closed (Android). Patient side: a caregiver's "care_cmd" push applies their marks.
 * Caregiver side: the patient's data-only
 * "care_event" push cancels this phone's local late alarm for that dose and shows the
 * notification here, in this phone's language and with the caregiver's nickname.
 * Must be defined at module level, before the app renders: imported from index.ts.
 */
export const CARE_TASK = 'aquamed-care-event';

if (Platform.OS !== 'web') TaskManager.defineTask<Notifications.NotificationTaskPayload>(CARE_TASK, async ({ data, error }) => {
  if (error || !data || 'actionIdentifier' in data) return;
  // Patient side: a caregiver marked a dose / added water ("care_cmd", no details in the push): pull and apply.
  if (JSON.stringify(data).includes('care_cmd')) {
    try {
      setLocale(await storageService.getLanguage());
      await applyPendingCommands();
    } catch (e) { console.warn('[careTask] commands', e); recordError(e, 'pairing.applyCommands'); }
    return;
  }
  const ev = parseCareEvent(data);
  if (!ev) return;
  try {
    const id = careAlarmId(ev.pairId, ev.medId, ev.date, ev.time);
    await Notifications.cancelScheduledNotificationAsync(id);
    setLocale(await storageService.getLanguage());
    const name = displayName({ id: ev.pairId, patientName: ev.patientName }, await getNicknames());
    const lateMin = await getLateMinutes();
    const msg = eventMessage({ type: ev.status, medName: ev.medName, dose: ev.dose, time: ev.time }, name, lateMin);
    const channelId = ev.status === 'taken' ? 'doses_v2' : 'escalation_v2';
    // The patient reports 'late' after LATE_MINUTES; a caregiver who chose a longer delay hears it then,
    // under the local alarm's id (a later sync replaces it, a taken/skipped push cancels it).
    const lateAt = ev.status === 'late' ? doseDateTime(ev.date, ev.time).getTime() + lateMin * 60000 : 0;
    await Notifications.scheduleNotificationAsync({
      ...(lateAt > Date.now() ? { identifier: id } : {}),
      content: { ...msg, data: { type: 'care', pairId: ev.pairId } },
      trigger: lateAt > Date.now()
        ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(lateAt), ...(Platform.OS === 'android' ? { channelId } : {}) } as Notifications.DateTriggerInput
        : Platform.OS === 'android' ? { channelId } : null,
    });
  } catch (e) {
    console.warn('[careTask]', e);
    recordError(e, 'pairing.careEvent');
  }
});

export function registerCareTask() {
  if (Platform.OS === 'web') return;
  Notifications.registerTaskAsync(CARE_TASK).catch(e => console.warn('[careTask] register', e));
}
