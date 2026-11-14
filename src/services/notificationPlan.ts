import { Medication, MedicationLog, Priority, doseKey, logKey } from '../types/models';
import { getLocalDayString, addDays } from '../utils/DateUtils';
import { isScheduledOn, isDoseBeforeStart, doseDateTime } from '../utils/ScheduleUtils';
import type { AppSettings, SleepModeSettings } from './storageService';

/**
 * Pure planning of every local notification for the next few days.
 * The scheduler cancels what's pending and schedules exactly this list, so
 * re-planning after any change (dose taken, med edited, settings) is always safe.
 */

export type PlannedData =
  | { type: 'dose'; medicationId: string; date: string; time: string }
  | { type: 'dose_presleep'; medicationId: string; date: string; time: string }
  | { type: 'escalation'; medicationId: string; date: string; time: string }
  | { type: 'water'; date: string }
  | { type: 'nudge'; date: string; remainingMl: number; streak: number }
  /** After the last planned reminder: nothing further is scheduled until the app (or its background task) re-plans. */
  | { type: 'reopen' };

export interface PlannedNotification {
  at: Date;
  data: PlannedData;
}

export interface PlanInput {
  meds: Medication[];
  logs: MedicationLog[];
  settings: AppSettings;
  sleep: SleepModeSettings;
  hasEmergencyContact: boolean;
  waterToday: number;
  waterGoal: number;
  /** Raw fluid volume logged today, compared with the ceiling. */
  fluidToday?: number;
  fluidCeilingMl?: number;
  streak?: number;
  now: Date;
  /** Pending slots available (default MAX_PENDING); lower when caregiver alarms share the device. */
  maxPending?: number;
}

/** iOS keeps at most 64 pending local notifications; stay under it on every platform. */
export const MAX_PENDING = 60;
export const HORIZON_DAYS = 7;
export const REOPEN_AFTER_MIN = 60;
const DEFAULT_AWAKE = { start: 8 * 60, end: 22 * 60 };

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const atMinute = (date: string, minute: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setMinutes(minute);
  return d;
};

/** Is HH:mm inside the sleep window (handles windows that cross midnight)? */
export const inSleepWindow = (time: string, sleep: SleepModeSettings): boolean => {
  if (!sleep.enabled) return false;
  const t = toMin(time), s = toMin(sleep.start), e = toMin(sleep.end);
  return s <= e ? t >= s && t < e : t >= s || t < e;
};

/** Awake window of a day in minutes from that day's midnight (end may exceed 1440). */
export const awakeWindow = (sleep: SleepModeSettings): { start: number; end: number } => {
  if (!sleep.enabled) return DEFAULT_AWAKE;
  const wake = toMin(sleep.end);
  let bed = toMin(sleep.start);
  if (bed <= wake) bed += 1440;
  return { start: wake, end: bed };
};

/** Small deterministic PRNG so "random" reminder times don't reshuffle on every re-plan. */
const seeded = (seed: string) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
};

/** Minutes (from midnight) of water reminders for one day. */
export const waterMinutesForDay = (date: string, settings: AppSettings['waterReminder'], sleep: SleepModeSettings): number[] => {
  const { start, end } = awakeWindow(sleep);
  if (settings.mode === 'off' || end - start < 60) return [];
  if (settings.mode === 'interval') {
    const step = Math.max(60, settings.intervalMinutes);
    const out: number[] = [];
    for (let m = start + step; m <= end - 30; m += step) out.push(m);
    return out;
  }
  // random: N times, ≥ 60 min apart, stable for the date
  const rand = seeded(date);
  const picked: number[] = [];
  for (let tries = 0; picked.length < settings.randomCount && tries < 500; tries++) {
    const m = start + 30 + Math.floor(rand() * Math.max(1, end - start - 60));
    if (picked.every(p => Math.abs(p - m) >= 60)) picked.push(m);
  }
  return picked.sort((a, b) => a - b);
};

export const planNotifications = (input: PlanInput): PlannedNotification[] => {
  const { meds, logs, settings, sleep, now } = input;
  const today = getLocalDayString(now);
  const logged = new Set(logs.map(logKey));
  const doses: PlannedNotification[] = [];
  const extras: PlannedNotification[] = [];

  // From yesterday: a 23:50 dose's escalation can land after midnight (only escalations can
  // still be in the future for yesterday — its doses and heads-ups are all past).
  for (let i = -1; i < HORIZON_DAYS; i++) {
    const date = addDays(today, i);
    for (const med of meds) {
      if (med.isPaused || !isScheduledOn(med, date)) continue;
      for (const time of med.times) {
        const at = doseDateTime(date, time);
        if (logged.has(doseKey(med.id, date, time)) || isDoseBeforeStart(med, date, time)) continue;
        const ref = { medicationId: med.id, date, time };
        // A dose already due but not logged still needs its escalation: every re-plan cancels
        // pending notifications, so opening the app between dose and escalation mustn't drop it.
        const escAt = new Date(at.getTime() + settings.escalation.delayMinutes * 60000);
        if (med.priority === Priority.High && settings.escalation.enabled && input.hasEmergencyContact && escAt > now) {
          extras.push({ at: escAt, data: { type: 'escalation', ...ref } });
        }
        if (at <= now) continue;
        doses.push({ at, data: { type: 'dose', ...ref } });

        // Non-urgent dose falls in the sleep window → heads-up at bedtime instead of surprise at night.
        if (med.priority !== Priority.High && inSleepWindow(time, sleep)) {
          const bedDay = toMin(time) < toMin(sleep.start) ? addDays(date, -1) : date;
          const heads = atMinute(bedDay, toMin(sleep.start));
          if (heads > now) extras.push({ at: heads, data: { type: 'dose_presleep', ...ref } });
        }
      }
    }
  }

  const water: PlannedNotification[] = [];
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const date = addDays(today, i);
    if (i === 0 && input.waterToday >= input.waterGoal) continue; // goal met → stop for today
    for (const m of waterMinutesForDay(date, settings.waterReminder, sleep)) {
      const at = atMinute(date, m);
      if (at > now) water.push({ at, data: { type: 'water', date } });
    }
  }

  // Evening "keep your streak" nudge — today only (tomorrow's progress is unknown; the plan is
  // rebuilt every time the app opens). Never suggests drinking past the fluid ceiling.
  const nudge: PlannedNotification[] = [];
  const en = settings.eveningNudge;
  if (en?.enabled && input.waterToday < input.waterGoal && !inSleepWindow(en.time, sleep)) {
    const at = atMinute(today, toMin(en.time));
    const room = (input.fluidCeilingMl ?? Infinity) - (input.fluidToday ?? input.waterToday);
    const remainingMl = Math.max(0, Math.min(input.waterGoal - input.waterToday, room));
    if (at > now && remainingMl > 0) nudge.push({ at, data: { type: 'nudge', date: today, remainingMl, streak: input.streak ?? 0 } });
  }

  // Budget: everything in the next 24h first; beyond that doses, then their companions, then water.
  // The plan is rebuilt on every app open, so later days get filled in as they come closer.
  const byTime = (a: PlannedNotification, b: PlannedNotification) => a.at.getTime() - b.at.getTime();
  const soon = now.getTime() + 24 * 60 * 60 * 1000;
  const isSoon = (n: PlannedNotification) => n.at.getTime() <= soon;
  const chosen: PlannedNotification[] = [];
  const max = (input.maxPending ?? MAX_PENDING) - 1; // one slot for the "open AquaMed" notice
  const take = (list: PlannedNotification[]) => {
    for (const n of list.sort(byTime)) if (chosen.length < max) chosen.push(n);
  };
  take([...doses, ...extras, ...nudge, ...water].filter(isSoon));
  for (const group of [doses, extras, water]) take(group.filter(n => !isSoon(n)));
  chosen.sort(byTime);
  // Reminders would silently stop after the last one if the app isn't opened (and the background
  // re-plan didn't run): say so an hour later, moved to wake-up time if that falls in the sleep window.
  const last = chosen[chosen.length - 1];
  if (last && max >= 0) {
    let at = new Date(last.at.getTime() + REOPEN_AFTER_MIN * 60000);
    const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    if (inSleepWindow(hhmm, sleep)) {
      const day = getLocalDayString(at);
      at = atMinute(toMin(hhmm) < toMin(sleep.end) ? day : addDays(day, 1), toMin(sleep.end));
    }
    chosen.push({ at, data: { type: 'reopen' } });
  }
  return chosen;
};
