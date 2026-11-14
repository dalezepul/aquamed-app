import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

// Missing in Expo Go / web: then we can't tell, so assume allowed and don't nag.
const native = Platform.OS === 'android' ? requireOptionalNativeModule<{
  canScheduleExactAlarms(): boolean;
  openSettings(): boolean;
}>('ExactAlarm') : null;

/** True when reminders will fire on the minute (always true off Android 12+ or without the native module). */
export const canScheduleExactAlarms = (): boolean => native?.canScheduleExactAlarms() ?? true;

/** Opens the system "Alarms & reminders" page for this app. Returns false if unavailable. */
export const openExactAlarmSettings = (): boolean => native?.openSettings() ?? false;

export const exactAlarmSupported = native != null;
