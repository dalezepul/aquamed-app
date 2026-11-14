import { Platform, Vibration } from 'react-native';
import * as Haptics from 'expo-haptics';

export type HapticType = 'none' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';
export type HapticLevel = 'off' | 'subtle' | 'light' | 'custom';

/**
 * What each level plays. Android uses the system touch-feedback effects (View.performHapticFeedback):
 * they follow the phone's own "touch vibration" strength and are far weaker on Samsung than
 * impactAsync/selectionAsync, which drive the Vibrator with a fixed waveform.
 * CLOCK_TICK is the weakest one available on every API level.
 */
export const HAPTIC_LEVEL_METHOD: Record<'subtle' | 'light', { android: Haptics.AndroidHaptics; label: string }> = {
  subtle: { android: Haptics.AndroidHaptics.Clock_Tick, label: 'Android: Clock_Tick · iOS: selection' },
  light: { android: Haptics.AndroidHaptics.Keyboard_Tap, label: 'Android: Keyboard_Tap · iOS: impact Light' },
};

/**
 * Every vibration method the phone can play, for the "try them" list in Settings → Vibration.
 * Id = "<kind>:<value>"; the chosen id is saved as AppSettings.hapticCustom (level 'custom').
 * Label key: settings.haptic_m_<id with non-alphanumerics as _>.
 */
export const HAPTIC_METHODS: string[] = [
  ...(Platform.OS === 'android'
    ? Object.values(Haptics.AndroidHaptics).filter(v => v !== Haptics.AndroidHaptics.No_Haptics).map(v => `android:${v}`)
    : []),
  ...Object.values(Haptics.ImpactFeedbackStyle).map(v => `impact:${v}`),
  'selection:',
  ...Object.values(Haptics.NotificationFeedbackType).map(v => `notification:${v}`),
  ...[5, 10, 20, 40].map(ms => `vibrate:${ms}`),
];

export const hapticMethodKey = (id: string) => `settings.haptic_m_${id.replace(/[^a-z0-9]+/gi, '_').replace(/_$/, '')}`;

/** Plays one method; rejects when the device can't (the caller shows why). */
export const runHapticMethod = async (id: string): Promise<void> => {
  const [kind, v] = id.split(':');
  if (kind === 'android') return Haptics.performAndroidHapticsAsync(v as Haptics.AndroidHaptics);
  if (kind === 'impact') return Haptics.impactAsync(v as Haptics.ImpactFeedbackStyle);
  if (kind === 'selection') return Haptics.selectionAsync();
  if (kind === 'notification') return Haptics.notificationAsync(v as Haptics.NotificationFeedbackType);
  if (kind === 'vibrate') return Vibration.vibrate(Number(v));
  throw new Error(`unknown haptic ${id}`);
};

// Default off: users found even the lightest feedback too strong; it stays off until they pick one.
let level: HapticLevel = 'off';
let custom: string | undefined;
/** Follows AppSettings (set from AppContext). */
export const setHapticLevel = (l: HapticLevel, customMethod?: string) => { level = l; custom = customMethod; };

/** No choice saved (new install, or never picked) → off. Old saves with `haptics: false` → off. */
export const resolveHapticLevel = (s: { haptics?: boolean; hapticLevel?: HapticLevel; hapticCustom?: string }): HapticLevel =>
  s.haptics === false ? 'off' : s.hapticLevel === 'custom' && !s.hapticCustom ? 'off' : s.hapticLevel ?? 'off';

/** Plays one level regardless of the current setting (settings preview, dev panel). */
export const playHapticLevel = (l: HapticLevel, customMethod = custom) => {
  if (l === 'off' || Platform.OS === 'web') return;
  try {
    const p = l === 'custom'
      ? (customMethod ? runHapticMethod(customMethod) : Promise.resolve())
      : Platform.OS === 'android'
        ? Haptics.performAndroidHapticsAsync(HAPTIC_LEVEL_METHOD[l].android)
        : l === 'subtle' ? Haptics.selectionAsync() : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    p.catch(() => {});
  } catch {
    // haptics unavailable on this device
  }
};

/**
 * Every kind plays the user's chosen level: users found the default feedback too strong.
 * The kinds stay so call sites keep their intent.
 */
export const haptic = (type: HapticType = 'light') => {
  if (type !== 'none') playHapticLevel(level);
};
