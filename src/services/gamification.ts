import { storageService, STORAGE_KEYS, fluidCeiling } from './storageService';
import { Medication, MedicationLog, MedicationStatus, WaterLog } from '../types/models';
import { getLocalDayString, addDays } from '../utils/DateUtils';
import { getDosesForDate, doseDateTime } from '../utils/ScheduleUtils';
import { StreakResult } from '../utils/streak';
import { t, getLocale } from '../localization/i18n';

export interface GameData {
  waterLogs: WaterLog[];
  medLogs: MedicationLog[];
  medications: Medication[];
  waterGoal: number;
  /** YYYY-MM-DD → goal set that day (goal in effect = latest on or before the day). */
  goalHistory?: Record<string, number>;
  fluidCeilingMl: number;
}

const ON_TIME_MS = 30 * 60 * 1000;

/** Per-day water totals and the "balanced day" rule shared by every calculation below. */
const indexDays = (d: GameData) => {
  const goalDates = Object.keys(d.goalHistory ?? {}).sort();
  const goalFor = (day: string) => {
    for (let i = goalDates.length - 1; i >= 0; i--) if (goalDates[i] <= day) return d.goalHistory![goalDates[i]];
    return d.waterGoal;
  };
  const hydration = new Map<string, number>();
  const fluid = new Map<string, number>(); // raw volume, compared with the ceiling
  for (const l of d.waterLogs) {
    const day = getLocalDayString(new Date(l.timestamp));
    hydration.set(day, (hydration.get(day) ?? 0) + (l.hydrationAmountMl ?? l.amountMl));
    fluid.set(day, (fluid.get(day) ?? 0) + l.amountMl);
  }
  /** 90–130 % of the day's goal and not over the fluid ceiling (same band as the balanced_day badge). */
  const isBalanced = (day: string) => {
    const total = hydration.get(day) ?? 0;
    const goal = goalFor(day);
    return total >= goal * 0.9 && total <= goal * 1.3 && (fluid.get(day) ?? 0) <= d.fluidCeilingMl;
  };
  return { hydration, isBalanced };
};

/** Monday of the week containing `day` (local calendar). */
export const weekStart = (day: string): string => {
  const dow = new Date(day + 'T12:00:00').getDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
};

// ---------- 1. Weekly goal ----------

export type WeekDayState = 'done' | 'missed' | 'today' | 'future';

export interface WeeklyGoal {
  weekStart: string;
  target: number;
  done: number;
  achieved: boolean;
  days: { date: string; state: WeekDayState }[];
}

export const FIRST_WEEK_TARGET = 4;

/** "N balanced days this week": last week's count + 1, kept within 3–7; 4 when there's no earlier history. */
export const computeWeeklyGoal = (d: GameData, now: Date = new Date()): WeeklyGoal => {
  const { hydration, isBalanced } = indexDays(d);
  const today = getLocalDayString(now);
  const start = weekStart(today);
  const prevStart = addDays(start, -7);

  const hasHistory = [...hydration.keys()].some(day => day < start);
  const lastWeek = Array.from({ length: 7 }, (_, i) => addDays(prevStart, i)).filter(isBalanced).length;
  const target = hasHistory ? Math.min(7, Math.max(3, lastWeek + 1)) : FIRST_WEEK_TARGET;

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    const state: WeekDayState =
      date > today ? 'future' : isBalanced(date) ? 'done' : date === today ? 'today' : 'missed';
    return { date, state };
  });
  const done = days.filter(x => x.state === 'done').length;
  return { weekStart: start, target, done, achieved: done >= target, days };
};

// ---------- 3. Drop points & levels ----------

export const POINTS = { balancedDay: 10, onTimeDose: 2, lateDose: 1 } as const;

/**
 * Whole-history points: balanced day +10, dose taken within ±30 min of its time +2, other taken dose +1.
 * Drinking more never earns more: a day over 130 % or over the ceiling simply scores 0.
 */
export const computePoints = (d: GameData, now: Date = new Date()): number => {
  const { hydration, isBalanced } = indexDays(d);
  const today = getLocalDayString(now);
  let points = 0;
  for (const day of hydration.keys()) if (day <= today && isBalanced(day)) points += POINTS.balancedDay;
  for (const l of d.medLogs) {
    if (l.status !== MedicationStatus.Taken || l.scheduledDate > today) continue;
    const late = Math.abs(new Date(l.timestamp).getTime() - doseDateTime(l.scheduledDate, l.scheduledTime).getTime());
    points += late <= ON_TIME_MS ? POINTS.onTimeDose : POINTS.lateDose;
  }
  return points;
};

/** Cosmetic levels; `key` → i18n `gamification.level_<key>`. */
export const LEVELS = [
  { key: 'drop', min: 0, icon: '💧' },
  { key: 'spring', min: 100, icon: '⛲' },
  { key: 'stream', min: 300, icon: '🏞️' },
  { key: 'river', min: 700, icon: '🌊' },
  { key: 'lake', min: 1500, icon: '🏔️' },
  { key: 'ocean', min: 3000, icon: '🐋' },
] as const;

export interface LevelInfo {
  points: number;
  index: number;
  key: string;
  icon: string;
  next: { key: string; min: number } | null;
  /** 0–1 towards the next level (1 at the top level). */
  progress: number;
}

export const levelFor = (points: number): LevelInfo => {
  let index = 0;
  while (index + 1 < LEVELS.length && points >= LEVELS[index + 1].min) index++;
  const cur = LEVELS[index];
  const next = LEVELS[index + 1] ?? null;
  return {
    points, index, key: cur.key, icon: cur.icon,
    next: next && { key: next.key, min: next.min },
    progress: next ? (points - cur.min) / (next.min - cur.min) : 1,
  };
};

// ---------- 4. Weekly summary ----------

export interface WeekSummary {
  from: string;
  to: string;
  balancedDays: number;
  /** Average over days with any entry (ml). */
  averageMl: number;
  takenDoses: number;
  plannedDoses: number;
  /** Rounded %, null when nothing was planned. */
  adherence: number | null;
}

/** Last 7 days incl. today. Doses later today that aren't due yet don't count as planned. */
export const computeWeekSummary = (d: GameData, now: Date = new Date()): WeekSummary => {
  const { hydration, isBalanced } = indexDays(d);
  const to = getLocalDayString(now);
  const from = addDays(to, -6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));

  const active = days.filter(day => (hydration.get(day) ?? 0) > 0);
  const averageMl = active.length ? Math.round(active.reduce((s, day) => s + hydration.get(day)!, 0) / active.length) : 0;

  let takenDoses = 0, plannedDoses = 0;
  for (const day of days) {
    for (const dose of getDosesForDate(d.medications, d.medLogs, day)) {
      const taken = dose.log?.status === MedicationStatus.Taken;
      if (!taken && doseDateTime(day, dose.time) > now) continue;
      plannedDoses++;
      if (taken) takenDoses++;
    }
  }
  return {
    from, to,
    balancedDays: days.filter(isBalanced).length,
    averageMl, takenDoses, plannedDoses,
    adherence: plannedDoses ? Math.round((takenDoses / plannedDoses) * 100) : null,
  };
};

/** Plain-text summary for sharing — numbers only, no medical interpretation. */
export const formatWeekSummary = (s: WeekSummary, streak: number): string => {
  const locale = getLocale() === 'tr' ? 'tr-TR' : 'en-US';
  const date = (day: string) => new Date(day + 'T12:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'long' });
  const liters = (s.averageMl / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return [
    t('gamification.share_title', { from: date(s.from), to: date(s.to) }),
    t('gamification.share_balanced', { count: s.balancedDays }),
    t('gamification.share_water', { liters }),
    s.adherence === null
      ? t('gamification.share_no_doses')
      : t('gamification.share_doses', { taken: s.takenDoses, planned: s.plannedDoses, percent: s.adherence }),
    t('gamification.share_streak', { count: streak }),
    t('gamification.share_footer'),
  ].join('\n');
};

// ---------- Storage wrapper ----------

export interface GamificationState {
  streak: StreakResult;
  freezesLeft: number;
  weeklyGoal: WeeklyGoal;
  level: LevelInfo;
  week: WeekSummary;
}

export const loadGamification = async (now: Date = new Date()): Promise<GamificationState> => {
  const [waterLogs, medLogs, medications, waterGoal, rawGoals, settings, streak] = await Promise.all([
    storageService.getAllWaterLogs(),
    storageService.getAllMedicationLogs(),
    storageService.getMedications(),
    storageService.getWaterGoal(),
    storageService.getRawData(STORAGE_KEYS.WATER_GOAL_HISTORY),
    storageService.getAppSettings(),
    storageService.getStreakInfo(now),
  ]);
  let goalHistory: Record<string, number> = {};
  try { goalHistory = JSON.parse(rawGoals || '{}'); } catch { /* keep current goal */ }
  const data: GameData = { waterLogs, medLogs, medications, waterGoal, goalHistory, fluidCeilingMl: fluidCeiling(settings) };
  return {
    streak,
    freezesLeft: streak.freezesLeft,
    weeklyGoal: computeWeeklyGoal(data, now),
    level: levelFor(computePoints(data, now)),
    week: computeWeekSummary(data, now),
  };
};
