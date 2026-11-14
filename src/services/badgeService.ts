import { storageService, STORAGE_KEYS, fluidCeiling } from './storageService';
import { Badge, BeverageType, Medication, MedicationLog, MedicationStatus, Priority, WaterLog } from '../types/models';
import { BADGE_DEFINITIONS } from '../constants/badges';
import { getLocalDayString, addDays } from '../utils/DateUtils';
import { getDosesForDate, doseDateTime } from '../utils/ScheduleUtils';

export interface BadgeData {
  waterLogs: WaterLog[];
  medLogs: MedicationLog[];
  medications: Medication[];
  waterGoal: number;
  /** YYYY-MM-DD → goal set that day (goal in effect = latest on or before the day). */
  goalHistory?: Record<string, number>;
  /** Daily fluid ceiling; a day above it never counts for any badge. */
  fluidCeilingMl: number;
  /** HH:mm the user wakes up (sleep mode end). */
  wakeTime: string;
}

const ON_TIME_MS = 30 * 60 * 1000;
const STREAKS: [number, string][] = [[3, 'b2'], [7, 'b10'], [14, 'b27'], [30, 'b4'], [50, 'b28'], [100, 'b29']];
const KNOWN = new Set(BADGE_DEFINITIONS.map(b => b.id));

const ml = (l: WaterLog) => l.hydrationAmountMl ?? l.amountMl;
const isOnTime = (l: MedicationLog) =>
  Math.abs(new Date(l.timestamp).getTime() - doseDateTime(l.scheduledDate, l.scheduledTime).getTime()) <= ON_TIME_MS;

/** Every badge the history qualifies for (pure; event-only badges are not included). */
export const computeEarnedBadges = (d: BadgeData, now: Date = new Date()): string[] => {
  const earned = new Set<string>();
  const today = getLocalDayString(now);
  const goalDates = Object.keys(d.goalHistory ?? {}).sort();
  const goalFor = (day: string) => {
    for (let i = goalDates.length - 1; i >= 0; i--) if (goalDates[i] <= day) return d.goalHistory![goalDates[i]];
    return d.waterGoal;
  };

  const waterByDay = new Map<string, WaterLog[]>();
  for (const l of d.waterLogs) {
    const day = getLocalDayString(new Date(l.timestamp));
    if (day <= today) waterByDay.set(day, [...(waterByDay.get(day) ?? []), l]);
  }
  const totalOn = (day: string) => (waterByDay.get(day) ?? []).reduce((s, l) => s + ml(l), 0);
  // The ceiling is about raw volume (what the body takes in), same as the streak.
  const fluidOn = (day: string) => (waterByDay.get(day) ?? []).reduce((s, l) => s + l.amountMl, 0);
  const goalMet = (day: string) => {
    const total = totalOn(day);
    return total >= goalFor(day) && fluidOn(day) <= d.fluidCeilingMl;
  };

  // --- Firsts & counts
  if (waterByDay.size) earned.add('b1');
  if (d.medications.length || d.medLogs.length) earned.add('first_med');
  if (d.waterLogs.filter(l => l.beverageType === BeverageType.Tea).length >= 5) earned.add('b11');

  // --- Per-day drinking habits
  const [wh, wm] = d.wakeTime.split(':').map(Number);
  const wakeMin = wh * 60 + wm;
  let mornings = 0;
  for (const [day, logs] of waterByDay) {
    const total = totalOn(day);
    if (fluidOn(day) > d.fluidCeilingMl) continue;
    const goal = goalFor(day);
    const types = new Set(logs.map(l => l.beverageType ?? BeverageType.Water));
    if (total >= goal * 0.9 && total <= goal * 1.3) earned.add('balanced_day');
    if (types.has(BeverageType.Water) && types.has(BeverageType.Tea) && types.has(BeverageType.Coffee)) earned.add('b16');
    if (total >= goal) {
      if (new Set(logs.map(l => Math.floor(new Date(l.timestamp).getHours() / 2))).size >= 4) earned.add('steady_sipper');
      if (types.size === 1 && types.has(BeverageType.Water)) earned.add('b13');
      const dow = new Date(day + 'T12:00:00').getDay();
      if (dow === 0 || dow === 6) earned.add('b23');
    }
    const drankAfterWaking = logs.some(l => {
      const t = new Date(l.timestamp);
      const m = t.getHours() * 60 + t.getMinutes() - wakeMin;
      return m >= 0 && m < 60;
    });
    if (drankAfterWaking) mornings++;
  }
  if (mornings >= 7) earned.add('morning_water');

  // --- Medication
  const taken = d.medLogs.filter(l => l.status === MedicationStatus.Taken);
  const medById = new Map(d.medications.map(m => [m.id, m]));
  if (taken.length >= 10) earned.add('b3');
  if (taken.length >= 50) earned.add('b17');
  if (taken.some(l => medById.get(l.medicationId)?.priority === Priority.High)) earned.add('b21');
  if (taken.some(isOnTime)) earned.add('b22');
  if (d.medications.length >= 5) earned.add('b19');
  if (d.medications.some(m => m.stock)) earned.add('b20');
  if (d.medications.some(m => m.schedule.type !== 'daily')) earned.add('b24');

  // --- Runs over the calendar (an unfinished today never breaks a run)
  const logsByDay = new Map<string, MedicationLog[]>();
  for (const l of d.medLogs) logsByDay.set(l.scheduledDate, [...(logsByDay.get(l.scheduledDate) ?? []), l]);
  const firstDays = [...waterByDay.keys(), ...logsByDay.keys(), ...d.medications.map(m => m.startDate)];
  if (!firstDays.length) return [...earned];
  let day = firstDays.reduce((a, b) => (a < b ? a : b));
  const floor = addDays(today, -3650);
  if (day < floor) day = floor;

  let streak = 0, doseRun = 0, onTimeRun = 0, maxStreak = 0, maxDoseRun = 0, maxOnTimeRun = 0;
  for (; day <= today; day = addDays(day, 1)) {
    const isToday = day === today;
    const doses = getDosesForDate(d.medications, logsByDay.get(day) ?? [], day);
    const allTaken = doses.every(x => x.log?.status === MedicationStatus.Taken);

    if (goalMet(day) && allTaken) {
      maxStreak = Math.max(maxStreak, ++streak);
      if (streak >= 7 && new Date(day + 'T12:00:00').getDay() === 0) earned.add('full_week');
    } else if (!isToday) streak = 0;

    if (doses.length) {
      if (allTaken) {
        maxDoseRun = Math.max(maxDoseRun, ++doseRun);
        if (doses.every(x => isOnTime(x.log!))) maxOnTimeRun = Math.max(maxOnTimeRun, ++onTimeRun);
        else onTimeRun = 0;
      } else if (!isToday) doseRun = onTimeRun = 0;
    }
  }
  STREAKS.forEach(([n, id]) => { if (maxStreak >= n) earned.add(id); });
  if (maxDoseRun >= 30) earned.add('b18');
  if (maxOnTimeRun >= 7) earned.add('med_on_time_week');

  return [...earned];
};

type BadgeAction = 'add_med' | 'stock_manager' | 'stock_refill' | 'planner' | 'lifesaver' | 'sleep_guardian' | 'analytics';

/** Badges that come from something the user did, not from logged history. */
const EVENT_BADGES: Partial<Record<BadgeAction, string>> = {
  stock_refill: 'stock_refill',
  planner: 'b24',
  lifesaver: 'b25',
  sleep_guardian: 'b26',
  analytics: 'b30',
};

/** Earned badges are permanent: once unlocked they are never taken back. */
class BadgeService {
  private queue: Promise<unknown> = Promise.resolve();

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Saves the ids not yet earned and returns them. */
  private async unlock(ids: string[]): Promise<string[]> {
    const earned = await storageService.getEarnedBadges();
    const fresh = ids.filter(id => KNOWN.has(id) && !earned.includes(id));
    if (fresh.length) await storageService.saveEarnedBadges([...earned, ...fresh]);
    return fresh;
  }

  async getBadges(): Promise<Badge[]> {
    const earnedIds = await storageService.getEarnedBadges();
    return BADGE_DEFINITIONS.map(def => ({ ...def, earned: earnedIds.includes(def.id), name: '', description: '' }));
  }

  resetBadges(): Promise<void> {
    return storageService.saveEarnedBadges([]);
  }

  /** Re-checks the whole history. Returns newly earned badge ids. Call after any data change. */
  evaluate(now: Date = new Date()): Promise<string[]> {
    return this.serial(async () => {
      try {
        const [waterLogs, medLogs, medications, waterGoal, rawGoals, settings, sleep] = await Promise.all([
          storageService.getAllWaterLogs(),
          storageService.getAllMedicationLogs(),
          storageService.getMedications(),
          storageService.getWaterGoal(),
          storageService.getRawData(STORAGE_KEYS.WATER_GOAL_HISTORY),
          storageService.getAppSettings(),
          storageService.getSleepMode(),
        ]);
        let goalHistory: Record<string, number> = {};
        try { goalHistory = JSON.parse(rawGoals || '{}'); } catch { /* keep current goal */ }
        return await this.unlock(computeEarnedBadges({
          waterLogs, medLogs, medications, waterGoal, goalHistory,
          fluidCeilingMl: fluidCeiling(settings), wakeTime: sleep.end,
        }, now));
      } catch (error) {
        console.error('Badge evaluation failed:', error);
        return [];
      }
    });
  }

  /** For badges tied to an action (settings, restock…); also re-evaluates history. */
  async triggerAction(action: BadgeAction): Promise<string[]> {
    const id = EVENT_BADGES[action];
    const fromEvent = id ? await this.serial(() => this.unlock([id])) : [];
    return [...fromEvent, ...(await this.evaluate())];
  }

  // Legacy entry points — arguments are ignored, everything is derived from history.
  checkWaterBadges(..._legacy: unknown[]) { return this.evaluate(); }
  checkMedicationBadges(..._legacy: unknown[]) { return this.evaluate(); }
  checkGeneralBadges(..._legacy: unknown[]) { return this.evaluate(); }
}

export const badgeService = new BadgeService();
