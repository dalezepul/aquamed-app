import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * Firebase Crashlytics (native only; crash.ts is the web no-op). Uses the native [DEFAULT] app from
 * google-services.json — separate from the Firebase JS SDK app in firebase.ts, so they don't clash.
 * Unhandled JS errors are reported by the library itself; this is for caught ones.
 * NEVER pass personal/health data: `context` is a fixed label ('storage.read'), not user input.
 */
type Lib = typeof import('@react-native-firebase/crashlytics');
let lib: Lib | null | undefined;
const load = (): Lib | null => {
  if (lib !== undefined) return lib;
  try {
    // Expo Go / jest have no native module: requiring it throws.
    lib = Constants.executionEnvironment === ExecutionEnvironment.StoreClient ? null : require('@react-native-firebase/crashlytics');
  } catch {
    lib = null;
  }
  return lib!;
};

const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e).slice(0, 200)));

export const recordError = (e: unknown, context: string): void => {
  try {
    const c = load();
    if (!c) return;
    const crashlytics = c.getCrashlytics();
    c.log(crashlytics, context);
    c.recordError(crashlytics, asError(e));
  } catch { /* reporting must never throw */ }
};

export const log = (msg: string): void => {
  try {
    const c = load();
    if (c) c.log(c.getCrashlytics(), msg);
  } catch { /* ignore */ }
};
