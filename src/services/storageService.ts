import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { Medication, WaterLog, MedicationLog, MedicationStatus, Priority, BeverageType, doseKey, logKey, Measurement } from '../types/models';
import { recordError } from './crash';
import { getLocalDayString, addDays, formatLocalTime } from '../utils/DateUtils';
import { isScheduledOn, isDoseBeforeStart, minutesApart, addStockBox } from '../utils/ScheduleUtils';
import { computeStreak, StreakResult } from '../utils/streak';
import { migrateV1toV2 } from './migrations';
import { t } from '../localization/i18n';

/** Deletes a medication photo the app copied into its documents folder; anything else is left alone. */
export const deleteMedPhoto = (uri?: string): void => {
  if (!uri || Platform.OS === 'web') return;
  try { if (uri.startsWith(Paths.document.uri)) new File(uri).delete(); } catch { /* already gone */ }
};

export const STORAGE_KEYS = {
  MEDICATIONS: '@aquamed_medications',
  WATER_LOGS: '@aquamed_water_logs',
  MEDICATION_LOGS: '@aquamed_medication_logs',
  SLEEP_MODE: '@aquamed_sleep_mode',
  BADGES: '@aquamed_badges',
  DEV_MODE: '@aquamed_dev_mode',
  LANGUAGE: '@aquamed_language',
  THEME_MODE: '@aquamed_theme_mode',
  EMERGENCY_CONTACT: '@aquamed_emergency_contact',
  ONBOARDED: '@aquamed_onboarded',
  WATER_GOAL: '@aquamed_water_goal',
  USER_METRICS: '@aquamed_user_metrics',
  USER_NAME: '@aquamed_user_name',
  DYNAMIC_GOAL_BUTTONS: '@aquamed_dynamic_goal_buttons',
  WATER_GOAL_HISTORY: '@aquamed_water_goal_history',
  APP_SETTINGS: '@aquamed_app_settings',
  DATA_VERSION: '@aquamed_data_version',
  FREEZE_GRANTS: '@aquamed_freeze_grants',
  REWARDED_ADS: '@aquamed_rewarded_ads',
  MEASUREMENTS: '@aquamed_measurements',
};

/** Rewarded ads needed for one streak freeze. */
export const ADS_PER_FREEZE = 3;

export interface FreezeGrant {
  date: string; // YYYY-MM-DD
  source: 'ad' | 'plus';
}

export const DATA_VERSION = 2;

export interface UserMetrics {
  height?: number;
  weight?: number;
}

export interface SleepModeSettings {
  enabled: boolean;
  start: string; // HH:mm
  end: string;   // HH:mm
}

export interface EmergencyContact {
  name: string;
  phone: string;
}

export interface WaterReminderSettings {
  mode: 'interval' | 'random' | 'off';
  intervalMinutes: number; // interval mode, ≥ 60 so reminders don't nag
  randomCount: number;     // random mode: reminders per day
  drinkAmountMl: number;   // "I drank" button on water reminders
  message: string;         // custom reminder text; empty → default text
}

export interface AppSettings {
  waterReminder: WaterReminderSettings;
  /** Daily fluid ceiling from the user's doctor (ml). null → generic warning at DEFAULT_FLUID_WARNING_ML. */
  fluidLimitMl: number | null;
  /** Remind the user to alert their emergency contact when a high-priority dose is this late. */
  escalation: { enabled: boolean; delayMinutes: number };
  /** One evening reminder when today's water goal isn't met yet ("keep your streak"). */
  eveningNudge: { enabled: boolean; time: string };
  /** Larger text and buttons, simpler home screen. */
  elderlyMode: boolean;
  /** Which simple view when elderlyMode is on: 'simple' keeps normal text size, 'large' (default, old saves) enlarges it. */
  displayMode?: 'simple' | 'large';
  /** Button vibration on/off (kept for old saves; false = off). */
  haptics: boolean;
  /** Vibration strength when on; missing (never chosen) → 'off'. See utils/haptics resolveHapticLevel. */
  hapticLevel?: 'off' | 'subtle' | 'light' | 'custom';
  /** Method id played when hapticLevel is 'custom' (utils/haptics HAPTIC_METHODS). */
  hapticCustom?: string;
  /** Colour palette id (constants/theme.ts PALETTES). */
  palette: 'night' | 'softSea' | 'sandSea' | 'classic';
  /** 'caregiver': only follows others (no own tracking tabs or reminders). Missing in old saves → 'self'. */
  appMode?: 'self' | 'caregiver';
}

export const DEFAULT_FLUID_WARNING_ML = 4000;
export const MAX_SINGLE_ENTRY_ML = 2000;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  waterReminder: { mode: 'interval', intervalMinutes: 120, randomCount: 4, drinkAmountMl: 250, message: '' },
  fluidLimitMl: null,
  escalation: { enabled: true, delayMinutes: 30 },
  eveningNudge: { enabled: true, time: '19:30' },
  elderlyMode: false,
  haptics: true,
  palette: 'night',
};

/** Goal in effect on a day = latest goal set on or before it (current goal if none recorded). */
export const goalOnDate = (history: Record<string, number>, current: number, day: string): number => {
  let best: string | undefined;
  for (const d of Object.keys(history)) if (d <= day && (!best || d > best)) best = d;
  return best ? history[best] : current;
};

export type DisplayMode = 'normal' | 'simple' | 'large';
/** Görünüm: Normal / Sade / Büyük ve sade. elderlyMode stays the on/off switch (onboarding sets only it). */
export const displayModeOf = (s: Pick<AppSettings, 'elderlyMode' | 'displayMode'> | undefined): DisplayMode =>
  !s?.elderlyMode ? 'normal' : s.displayMode === 'simple' ? 'simple' : 'large';
export const displayModePatch = (m: DisplayMode): Pick<AppSettings, 'elderlyMode' | 'displayMode'> =>
  m === 'normal' ? { elderlyMode: false, displayMode: undefined } : { elderlyMode: true, displayMode: m };

/** Doctor's limit (ml) when the day's goal is above it, else null. */
export const goalAboveLimit = (goal: number, s: Pick<AppSettings, 'fluidLimitMl'>): number | null =>
  s.fluidLimitMl != null && goal > s.fluidLimitMl ? s.fluidLimitMl : null;

/** Daily fluid ceiling in effect (doctor's limit if set). */
export const fluidCeiling = (s: AppSettings) => s.fluidLimitMl ?? DEFAULT_FLUID_WARNING_ML;

/** Someone who installed the app only to follow a family member: no water nagging until they opt in. */
export const followerSettings = (s: AppSettings): AppSettings => ({
  ...s,
  waterReminder: { ...s.waterReminder, mode: 'off' },
  eveningNudge: { ...s.eveningNudge, enabled: false },
});

export const newId = () => Math.random().toString(36).slice(2, 11) + Date.now().toString(36).slice(-4);

/**
 * AsyncStorage persistence. Every read-modify-write goes through `enqueue`
 * so concurrent updates can't overwrite each other.
 */
class StorageService {
  private writeQueue: Promise<void> = Promise.resolve();
  /** Told about every saved dose status change (caregiver pairing hooks in here). */
  onDoseStatus: ((med: Medication, date: string, time: string, status: MedicationStatus | null) => void) | null = null;

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(() => operation());
    this.writeQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async getItem<T>(key: string, defaultValue: T): Promise<T> {
    try {
      const data = await AsyncStorage.getItem(key);
      if (!data) return defaultValue;
      return JSON.parse(data);
    } catch (error) {
      console.error(`Error reading ${key}:`, error);
      // Only the key and error type: a JSON parse message can quote the stored (health) data.
      recordError(new Error(`read ${key}: ${(error as Error)?.name ?? 'error'}`), 'storage.read');
      return defaultValue;
    }
  }

  private async setItem<T>(key: string, value: T): Promise<void> {
    return this.enqueue(() => AsyncStorage.setItem(key, JSON.stringify(value)));
  }

  // --- Schema migration ---------------------------------------------------

  /** Run once at startup before anything reads medications/logs. */
  async runMigrations(): Promise<void> {
    return this.enqueue(async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.DATA_VERSION);
      const version = Number(raw) || 0;
      if (version >= DATA_VERSION) return;

      const [meds, logs] = await Promise.all([
        this.getItem<any[]>(STORAGE_KEYS.MEDICATIONS, []),
        this.getItem<any[]>(STORAGE_KEYS.MEDICATION_LOGS, []),
      ]);
      // v0/v1 share the per-time layout; skip if already in v2 shape (e.g. restored backup).
      const isV1 = meds.some(m => typeof m.time === 'string' && !Array.isArray(m.times)) || logs.some(l => !l.scheduledDate);
      if (isV1) {
        const migrated = migrateV1toV2(meds, logs);
        await AsyncStorage.multiSet([
          [STORAGE_KEYS.MEDICATIONS, JSON.stringify(migrated.medications)],
          [STORAGE_KEYS.MEDICATION_LOGS, JSON.stringify(migrated.logs)],
        ]);
      }
      await AsyncStorage.setItem(STORAGE_KEYS.DATA_VERSION, String(DATA_VERSION));
    });
  }

  // --- Settings -------------------------------------------------------------

  getUserName() { return this.getItem(STORAGE_KEYS.USER_NAME, ''); }
  saveUserName(name: string) { return this.setItem(STORAGE_KEYS.USER_NAME, name); }

  async getLanguage(): Promise<'en' | 'tr'> {
    const lang = await this.getItem(STORAGE_KEYS.LANGUAGE, 'tr');
    return lang === 'en' ? 'en' : 'tr';
  }
  saveLanguage(lang: 'en' | 'tr') { return this.setItem(STORAGE_KEYS.LANGUAGE, lang); }

  async getThemeMode(): Promise<'light' | 'dark' | 'system'> {
    const mode = await this.getItem(STORAGE_KEYS.THEME_MODE, 'system');
    return mode === 'light' || mode === 'dark' ? mode : 'system';
  }
  saveThemeMode(mode: 'light' | 'dark' | 'system') { return this.setItem(STORAGE_KEYS.THEME_MODE, mode); }

  getEmergencyContact() { return this.getItem<EmergencyContact>(STORAGE_KEYS.EMERGENCY_CONTACT, { name: '', phone: '' }); }
  saveEmergencyContact(contact: EmergencyContact) { return this.setItem(STORAGE_KEYS.EMERGENCY_CONTACT, contact); }

  async getShowDynamicGoalButtons(): Promise<boolean> {
    return (await this.getItem(STORAGE_KEYS.DYNAMIC_GOAL_BUTTONS, true)) !== false;
  }
  saveShowDynamicGoalButtons(show: boolean) { return this.setItem(STORAGE_KEYS.DYNAMIC_GOAL_BUTTONS, show); }

  getSleepMode() { return this.getItem<SleepModeSettings>(STORAGE_KEYS.SLEEP_MODE, { enabled: false, start: '22:00', end: '06:00' }); }
  saveSleepMode(settings: SleepModeSettings) { return this.setItem(STORAGE_KEYS.SLEEP_MODE, settings); }

  async getAppSettings(): Promise<AppSettings> {
    const s = await this.getItem<Partial<AppSettings>>(STORAGE_KEYS.APP_SETTINGS, {});
    return {
      ...DEFAULT_APP_SETTINGS,
      ...s,
      waterReminder: { ...DEFAULT_APP_SETTINGS.waterReminder, ...s.waterReminder },
      escalation: { ...DEFAULT_APP_SETTINGS.escalation, ...s.escalation },
      eveningNudge: { ...DEFAULT_APP_SETTINGS.eveningNudge, ...s.eveningNudge },
    };
  }
  saveAppSettings(settings: AppSettings) { return this.setItem(STORAGE_KEYS.APP_SETTINGS, settings); }

  async getOnboarded(): Promise<boolean> {
    return String(await this.getItem<any>(STORAGE_KEYS.ONBOARDED, false)) === 'true';
  }
  setOnboarded(value: boolean) { return this.setItem(STORAGE_KEYS.ONBOARDED, value); }

  getWaterGoalHistory() { return this.getItem<Record<string, number>>(STORAGE_KEYS.WATER_GOAL_HISTORY, {}); }

  async getWaterGoal(): Promise<number> {
    const goal = Number(await this.getItem<any>(STORAGE_KEYS.WATER_GOAL, 2500));
    return goal > 0 ? goal : 2500;
  }

  async saveWaterGoal(goal: number): Promise<void> {
    const today = getLocalDayString();
    return this.enqueue(async () => {
      const history = await this.getItem<Record<string, number>>(STORAGE_KEYS.WATER_GOAL_HISTORY, {});
      history[today] = goal;
      await AsyncStorage.multiSet([
        [STORAGE_KEYS.WATER_GOAL, JSON.stringify(goal)],
        [STORAGE_KEYS.WATER_GOAL_HISTORY, JSON.stringify(history)],
      ]);
    });
  }

  getUserMetrics() { return this.getItem<UserMetrics>(STORAGE_KEYS.USER_METRICS, {}); }
  saveUserMetrics(metrics: UserMetrics) { return this.setItem(STORAGE_KEYS.USER_METRICS, metrics); }

  // --- Medications ------------------------------------------------------------

  getMedications() { return this.getItem<Medication[]>(STORAGE_KEYS.MEDICATIONS, []); }

  async getMedication(id: string): Promise<Medication | null> {
    return (await this.getMedications()).find(m => m.id === id) || null;
  }

  /** Insert or update by id (the id never changes, so history stays attached). */
  async saveMedication(med: Medication): Promise<void> {
    const clean: Medication = { ...med, times: [...new Set(med.times)].sort() };
    return this.enqueue(async () => {
      const meds = await this.getMedications();
      const i = meds.findIndex(m => m.id === clean.id);
      if (i >= 0) meds[i] = clean; else meds.push(clean);
      await AsyncStorage.setItem(STORAGE_KEYS.MEDICATIONS, JSON.stringify(meds));
    });
  }

  /** "+1 kutu": adds one box to a tracked stock (and remembers the box size). null if not tracked/gone. */
  async addStockBox(medId: string, boxSize: number): Promise<Medication | null> {
    return this.enqueue(async () => {
      const meds = await this.getMedications();
      const med = meds.find(m => m.id === medId);
      if (!med?.stock || !(boxSize > 0)) return null;
      const updated = { ...med, stock: addStockBox(med.stock, boxSize) };
      await AsyncStorage.setItem(STORAGE_KEYS.MEDICATIONS, JSON.stringify(meds.map(m => (m.id === medId ? updated : m))));
      return updated;
    });
  }

  /** Removes the medication; its logs stay (they carry the name) so history is kept. */
  /** Removes the medication and its photo file (every delete path goes through here). */
  async deleteMedication(id: string): Promise<void> {
    const photoUri = (await this.getMedication(id))?.photoUri;
    await this.enqueue(async () => {
      const meds = (await this.getMedications()).filter(m => m.id !== id);
      await AsyncStorage.setItem(STORAGE_KEYS.MEDICATIONS, JSON.stringify(meds));
    });
    deleteMedPhoto(photoUri);
  }

  /** Names of other (unpaused) medications with a dose within 30 minutes of any of `times`. */
  async findTimeClashes(times: string[], excludeId?: string): Promise<string[]> {
    const meds = await this.getMedications();
    return meds
      .filter(m => m.id !== excludeId && !m.isPaused)
      .filter(m => m.times.some(a => times.some(b => minutesApart(a, b) <= 30)))
      .map(m => m.name);
  }

  // --- Dose logs ----------------------------------------------------------------

  getAllMedicationLogs() { return this.getItem<MedicationLog[]>(STORAGE_KEYS.MEDICATION_LOGS, []); }

  async getLogsForDate(date: string): Promise<MedicationLog[]> {
    return (await this.getAllMedicationLogs()).filter(l => l.scheduledDate === date);
  }

  /**
   * Record what happened to one scheduled dose. One log per dose: a second tap replaces
   * the first, `null` clears it. Stock moves by the difference, so it's never counted twice.
   */
  async setDoseStatus(med: Medication, date: string, time: string, status: MedicationStatus | null, when: Date = new Date()): Promise<Medication> {
    return this.enqueue(async () => {
      const [logs, meds] = await Promise.all([this.getAllMedicationLogs(), this.getMedications()]);
      const key = doseKey(med.id, date, time);
      const prev = logs.find(l => logKey(l) === key);
      const rest = logs.filter(l => logKey(l) !== key);
      if (status) {
        rest.push({
          id: prev?.id ?? newId(),
          medicationId: med.id,
          medicationName: med.name,
          dosage: med.dosage,
          status,
          timestamp: when.toISOString(),
          scheduledDate: date,
          scheduledTime: time,
        });
      }

      const current = meds.find(m => m.id === med.id) ?? med;
      const wasTaken = prev?.status === MedicationStatus.Taken;
      const isTaken = status === MedicationStatus.Taken;
      let updated = current;
      if (current.stock && wasTaken !== isTaken) {
        const delta = (isTaken ? -1 : 1) * current.stock.perDose;
        updated = { ...current, stock: { ...current.stock, remaining: Math.max(0, current.stock.remaining + delta) } };
      }
      const updates: [string, string][] = [[STORAGE_KEYS.MEDICATION_LOGS, JSON.stringify(rest)]];
      if (updated !== current) {
        updates.push([STORAGE_KEYS.MEDICATIONS, JSON.stringify(meds.map(m => (m.id === med.id ? updated : m)))]);
      }
      await AsyncStorage.multiSet(updates);
      try { this.onDoseStatus?.(med, date, time, status); } catch (e) { console.warn('onDoseStatus failed', e); }
      return updated;
    });
  }

  /** Delete a log by id (history screen); restores stock if it was a taken dose. */
  async deleteMedicationLog(id: string): Promise<void> {
    const log = (await this.getAllMedicationLogs()).find(l => l.id === id);
    if (!log) return;
    const med = await this.getMedication(log.medicationId);
    if (med) {
      await this.setDoseStatus(med, log.scheduledDate, log.scheduledTime, null);
    } else {
      await this.enqueue(async () => {
        const logs = (await this.getAllMedicationLogs()).filter(l => l.id !== id);
        await AsyncStorage.setItem(STORAGE_KEYS.MEDICATION_LOGS, JSON.stringify(logs));
      });
    }
  }

  // --- Water ------------------------------------------------------------------------

  getAllWaterLogs() { return this.getItem<WaterLog[]>(STORAGE_KEYS.WATER_LOGS, []); }

  async saveWaterLog(log: WaterLog): Promise<void> {
    return this.enqueue(async () => {
      const logs = await this.getAllWaterLogs();
      logs.push(log);
      await AsyncStorage.setItem(STORAGE_KEYS.WATER_LOGS, JSON.stringify(logs));
    });
  }

  async getWaterLogsByDate(date: string): Promise<WaterLog[]> {
    return (await this.getAllWaterLogs()).filter(l => getLocalDayString(new Date(l.timestamp)) === date);
  }

  async getDailyWater(date: string): Promise<number> {
    return (await this.getWaterLogsByDate(date)).reduce((sum, l) => sum + (l.hydrationAmountMl ?? l.amountMl), 0);
  }

  async deleteWaterLog(id: string): Promise<void> {
    return this.enqueue(async () => {
      const logs = (await this.getAllWaterLogs()).filter(l => l.id !== id);
      await AsyncStorage.setItem(STORAGE_KEYS.WATER_LOGS, JSON.stringify(logs));
    });
  }

  // --- Measurements (bp / glucose / weight) ----------------------------------------

  /** All readings, newest first. */
  async getMeasurements(): Promise<Measurement[]> {
    const list = await this.getItem<Measurement[]>(STORAGE_KEYS.MEASUREMENTS, []);
    return list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  /** Adds, or replaces the one with the same id. */
  async saveMeasurement(m: Measurement): Promise<void> {
    return this.enqueue(async () => {
      const list = (await this.getItem<Measurement[]>(STORAGE_KEYS.MEASUREMENTS, [])).filter(x => x.id !== m.id);
      list.push(m);
      await AsyncStorage.setItem(STORAGE_KEYS.MEASUREMENTS, JSON.stringify(list));
    });
  }

  async deleteMeasurement(id: string): Promise<void> {
    return this.enqueue(async () => {
      const list = (await this.getItem<Measurement[]>(STORAGE_KEYS.MEASUREMENTS, [])).filter(x => x.id !== id);
      await AsyncStorage.setItem(STORAGE_KEYS.MEASUREMENTS, JSON.stringify(list));
    });
  }

  // --- History & analytics ---------------------------------------------------------

  /** Logs with timestamp ≥ startIso (and ≤ endIso). Med logs are filtered by the dose's own day. */
  async getHistory(startIso?: string, endIso?: string): Promise<{ waterLogs: WaterLog[]; medLogs: MedicationLog[] }> {
    const [waterLogs, medLogs] = await Promise.all([this.getAllWaterLogs(), this.getAllMedicationLogs()]);
    const startDay = startIso ? getLocalDayString(new Date(startIso)) : undefined;
    const endDay = endIso ? getLocalDayString(new Date(endIso)) : undefined;
    return {
      waterLogs: waterLogs.filter(l => (!startIso || l.timestamp >= startIso) && (!endIso || l.timestamp <= endIso)),
      medLogs: medLogs.filter(l => (!startDay || l.scheduledDate >= startDay) && (!endDay || l.scheduledDate <= endDay)),
    };
  }

  async calculateCurrentStreak(now: Date = new Date()): Promise<number> {
    return (await this.getStreakInfo(now)).count;
  }

  /**
   * Current streak with freezes. A day counts when the water goal is met without going over
   * the fluid ceiling and every scheduled dose was taken.
   */
  async getStreakInfo(now: Date = new Date()): Promise<StreakResult> {
    const [waterLogs, medLogs, medications, waterGoal, goalHistory, settings] = await Promise.all([
      this.getAllWaterLogs(),
      this.getAllMedicationLogs(),
      this.getMedications(),
      this.getWaterGoal(),
      this.getItem<Record<string, number>>(STORAGE_KEYS.WATER_GOAL_HISTORY, {}),
      this.getAppSettings(),
    ]);
    const ceiling = fluidCeiling(settings);
    const goalForDate = (day: string) => goalOnDate(goalHistory, waterGoal, day);

    const waterByDay = new Map<string, number>();
    const fluidByDay = new Map<string, number>(); // raw volume, compared with the ceiling
    waterLogs.forEach(l => {
      const d = getLocalDayString(new Date(l.timestamp));
      waterByDay.set(d, (waterByDay.get(d) || 0) + (l.hydrationAmountMl ?? l.amountMl));
      fluidByDay.set(d, (fluidByDay.get(d) || 0) + l.amountMl);
    });
    const taken = new Set(medLogs.filter(l => l.status === MedicationStatus.Taken).map(logKey));

    const isComplete = (day: string) => {
      if ((waterByDay.get(day) || 0) < goalForDate(day) || (fluidByDay.get(day) || 0) > ceiling) return false;
      return medications
        .filter(m => !m.isPaused && isScheduledOn(m, day))
        .every(m => m.times.every(time => taken.has(doseKey(m.id, day, time)) || isDoseBeforeStart(m, day, time)));
    };
    // Replay starts at the first day anything was logged.
    const days = [
      ...waterByDay.keys(),
      ...medLogs.map(l => l.scheduledDate),
    ].sort();
    const grants = await this.getFreezeGrants();
    return computeStreak(isComplete, days[0] ?? null, now, grants.map(g => g.date));
  }

  /** Hydration per day for the last 7 days, oldest first. */
  async getWeeklyStats(now: Date = new Date()): Promise<{ date: string; value: number }[]> {
    const logs = await this.getAllWaterLogs();
    const byDay = new Map<string, number>();
    logs.forEach(l => {
      const d = getLocalDayString(new Date(l.timestamp));
      byDay.set(d, (byDay.get(d) || 0) + (l.hydrationAmountMl ?? l.amountMl));
    });
    const today = getLocalDayString(now);
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(today, i - 6);
      return { date, value: byDay.get(date) || 0 };
    });
  }

  async getHealthInsights(): Promise<string> {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const recent = (await this.getAllWaterLogs()).filter(l => new Date(l.timestamp) >= since);
    if (recent.length === 0) return t('insights.start_logging');
    let total = 0, late = 0;
    recent.forEach(l => {
      const amount = l.hydrationAmountMl ?? l.amountMl;
      total += amount;
      if (new Date(l.timestamp).getHours() >= 20) late += amount;
    });
    return total > 0 && late / total > 0.3 ? t('insights.late_drinking') : t('insights.balanced');
  }

  // --- Streak freezes from rewarded ads / Plus ------------------------------------------

  getFreezeGrants() { return this.getItem<FreezeGrant[]>(STORAGE_KEYS.FREEZE_GRANTS, []); }

  /** Rewarded ads watched toward the next freeze (0 … ADS_PER_FREEZE-1). */
  async getRewardedAdProgress(): Promise<number> {
    return Number(await this.getItem<any>(STORAGE_KEYS.REWARDED_ADS, 0)) || 0;
  }

  /** Count one watched rewarded ad; every ADS_PER_FREEZE-th one grants a freeze. */
  async recordRewardedAd(now: Date = new Date()): Promise<{ progress: number; granted: boolean }> {
    return this.enqueue(async () => {
      const watched = (Number(await this.getItem<any>(STORAGE_KEYS.REWARDED_ADS, 0)) || 0) + 1;
      if (watched < ADS_PER_FREEZE) {
        await AsyncStorage.setItem(STORAGE_KEYS.REWARDED_ADS, JSON.stringify(watched));
        return { progress: watched, granted: false };
      }
      const grants = await this.getFreezeGrants();
      grants.push({ date: getLocalDayString(now), source: 'ad' });
      await AsyncStorage.multiSet([
        [STORAGE_KEYS.FREEZE_GRANTS, JSON.stringify(grants)],
        [STORAGE_KEYS.REWARDED_ADS, JSON.stringify(0)],
      ]);
      return { progress: 0, granted: true };
    });
  }

  /** Plus: one bonus freeze per calendar month; returns true if it was granted now. */
  async grantMonthlyPlusFreeze(now: Date = new Date()): Promise<boolean> {
    return this.enqueue(async () => {
      const today = getLocalDayString(now);
      const grants = await this.getFreezeGrants();
      if (grants.some(g => g.source === 'plus' && g.date.slice(0, 7) === today.slice(0, 7))) return false;
      grants.push({ date: today, source: 'plus' });
      await AsyncStorage.setItem(STORAGE_KEYS.FREEZE_GRANTS, JSON.stringify(grants));
      return true;
    });
  }

  // --- Badges -------------------------------------------------------------------------

  getEarnedBadges() { return this.getItem<string[]>(STORAGE_KEYS.BADGES, []); }
  saveEarnedBadges(ids: string[]) { return this.setItem(STORAGE_KEYS.BADGES, ids); }

  async toggleBadge(badgeId: string): Promise<void> {
    return this.enqueue(async () => {
      const ids = await this.getEarnedBadges();
      const next = ids.includes(badgeId) ? ids.filter(id => id !== badgeId) : [...ids, badgeId];
      await AsyncStorage.setItem(STORAGE_KEYS.BADGES, JSON.stringify(next));
    });
  }

  // --- Developer mode & raw data ------------------------------------------------------

  async isDevMode(): Promise<boolean> {
    return String(await this.getItem<any>(STORAGE_KEYS.DEV_MODE, false)) === 'true';
  }

  /** Only flips the flag. (It used to also overwrite real data with demo data.) */
  setDevMode(enable: boolean) { return this.setItem(STORAGE_KEYS.DEV_MODE, enable); }

  async getAllStorageKeys(): Promise<string[]> {
    return (await AsyncStorage.getAllKeys()).filter(k => k.startsWith('@aquamed'));
  }

  getRawData(key: string) { return AsyncStorage.getItem(key); }

  setRawData(key: string, value: string) { return this.enqueue(() => AsyncStorage.setItem(key, value)); }

  /** Every app key → raw JSON string. Used for backups. */
  async exportAllData(): Promise<Record<string, string>> {
    const keys = await this.getAllStorageKeys();
    const pairs = await AsyncStorage.multiGet(keys);
    return Object.fromEntries(pairs.filter(([, v]) => v != null) as [string, string][]);
  }

  /** Replace all app data with a backup, then migrate it if it came from an older version. */
  async importAllData(data: Record<string, string>): Promise<void> {
    const entries = Object.entries(data).filter(([k, v]) => k.startsWith('@aquamed') && typeof v === 'string');
    entries.forEach(([, v]) => JSON.parse(v)); // throws on a corrupt file before we touch anything
    await this.enqueue(async () => {
      await AsyncStorage.multiRemove(await this.getAllStorageKeys());
      await AsyncStorage.multiSet(entries);
    });
    await this.runMigrations();
  }

  /** Removes only AquaMed's keys (never other libraries' storage). */
  async clearAllAppData(): Promise<void> {
    return this.enqueue(async () => {
      await AsyncStorage.multiRemove(await this.getAllStorageKeys());
    });
  }

  /** DevTools: replace medications/logs with a demo set covering the past `days`. */
  async injectDemoData(days = 5, now: Date = new Date()): Promise<void> {
    const today = getLocalDayString(now);
    const start = addDays(today, -days);
    const mk = (name: string, dosage: string, times: string[], priority: Priority, stock?: number): Medication => ({
      id: newId(), name, dosage, times, startDate: start, endDate: null, schedule: { type: 'daily' },
      foodTiming: 'any', priority, isPaused: false, createdAt: new Date(`${start}T00:00:00`).toISOString(),
      stock: stock ? { remaining: stock, total: stock + 10, perDose: 1 } : undefined,
    });
    const meds = [
      mk('Aspirin', '100 mg', ['08:00'], Priority.High, 20),
      mk('Metformin', '500 mg', ['08:30', '20:30'], Priority.Medium, 40),
      mk('Vitamin D', '1000 IU', ['09:00'], Priority.Low),
    ];
    const waterLogs: WaterLog[] = [];
    const medLogs: MedicationLog[] = [];
    const goal = await this.getWaterGoal();
    for (let i = days; i >= 1; i--) {
      const day = addDays(today, -i);
      [0.3, 0.3, 0.2, 0.2].forEach((share, j) => {
        const ts = new Date(`${day}T${String(9 + j * 3).padStart(2, '0')}:00:00`).toISOString();
        const ml = Math.round((goal * share) / 10) * 10;
        waterLogs.push({ id: newId(), amountMl: ml, hydrationAmountMl: ml, beverageType: BeverageType.Water, timestamp: ts });
      });
      meds.forEach(m => m.times.forEach(time => medLogs.push({
        id: newId(), medicationId: m.id, medicationName: m.name, dosage: m.dosage, status: MedicationStatus.Taken,
        timestamp: new Date(`${day}T${time}:00`).toISOString(), scheduledDate: day, scheduledTime: time,
      })));
    }
    await this.enqueue(() => AsyncStorage.multiSet([
      [STORAGE_KEYS.MEDICATIONS, JSON.stringify(meds)],
      [STORAGE_KEYS.MEDICATION_LOGS, JSON.stringify(medLogs)],
      [STORAGE_KEYS.WATER_LOGS, JSON.stringify(waterLogs)],
    ]));
  }

  /** DevTools: mark every due dose of today as taken now. */
  async markAllDosesTakenToday(now: Date = new Date()): Promise<void> {
    const today = getLocalDayString(now);
    for (const med of await this.getMedications()) {
      if (med.isPaused || !isScheduledOn(med, today)) continue;
      for (const time of med.times) await this.setDoseStatus(med, today, time, MedicationStatus.Taken, now);
    }
  }

  /** DevTools: fill the past `days` so each day meets the water goal and every dose is taken. */
  async injectStreakLogs(days: number, now: Date = new Date()): Promise<void> {
    const today = getLocalDayString(now);
    const goal = await this.getWaterGoal();
    const meds = await this.getMedications();
    for (let i = 1; i <= days; i++) {
      const day = addDays(today, -i);
      const missing = goal - (await this.getDailyWater(day));
      if (missing > 0) {
        await this.saveWaterLog({
          id: newId(), amountMl: missing, hydrationAmountMl: missing, beverageType: BeverageType.Water,
          timestamp: new Date(`${day}T12:00:00`).toISOString(),
        });
      }
      for (const med of meds) {
        if (med.isPaused || !isScheduledOn(med, day)) continue;
        for (const time of med.times) {
          await this.setDoseStatus(med, day, time, MedicationStatus.Taken, new Date(`${day}T${time}:00`));
        }
      }
    }
  }

  /** Readable local time of a log, for lists. */
  logTime(log: { timestamp: string }) { return formatLocalTime(new Date(log.timestamp)); }
}

export const storageService = new StorageService();
