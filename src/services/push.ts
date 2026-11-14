import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { notificationService } from './notificationService';

const PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushMessage {
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  channelId?: string;
  /** iOS headless flag of the Expo push API; ignored on Android. */
  _contentAvailable?: boolean;
}

/** This device's Expo push token, or null (web, no permission, no FCM/APNs setup). */
export async function getPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    if (!(await notificationService.ensurePermissions())) return null;
    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId;
    return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  } catch (e) {
    console.warn('[push] token unavailable', e);
    return null;
  }
}

/** Fire-and-forget send straight from the device; failures are logged, never thrown. */
export async function sendPush(messages: PushMessage[]): Promise<void> {
  if (!messages.length) return;
  try {
    const res = await fetch(PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      // Data-only messages (no title) get no sound: anything presentational makes them a normal notification.
      body: JSON.stringify(messages.map(m => ({ ...(m.title ? { sound: 'default' } : {}), priority: 'high', ...m }))),
    });
    if (!res.ok) console.warn('[push] send failed', res.status);
  } catch (e) {
    console.warn('[push] send failed', e);
  }
}
