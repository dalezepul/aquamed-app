import { Medication, MedicationLog, Dose, doseKey, logKey } from '../types/models';
import { getLocalDayString } from './DateUtils';
import { t } from '../localization/i18n';

const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `from` to `to` (both YYYY-MM-DD). Noon anchoring keeps DST out of it. */
export const daysBetween = (from: string, to: string): number =>
    Math.round((new Date(to + 'T12:00:00').getTime() - new Date(from + 'T12:00:00').getTime()) / DAY_MS);

/**
 * Is the medication due on this local day? Ignores `isPaused` — callers decide
 * (paused meds still appear in history, but get no doses/notifications going forward).
 */
export const isScheduledOn = (med: Medication, date: string): boolean => {
    if (date < med.startDate) return false;
    if (med.endDate && date > med.endDate) return false;
    const s = med.schedule;
    switch (s.type) {
        case 'daily':
            return true;
        case 'weekly':
            return s.daysOfWeek.includes(new Date(date + 'T12:00:00').getDay());
        case 'interval':
            return daysBetween(med.startDate, date) % Math.max(1, s.everyDays) === 0;
        case 'cyclic': {
            const cycle = s.activeDays + s.offDays;
            if (cycle <= 0) return true;
            return daysBetween(med.startDate, date) % cycle < s.activeDays;
        }
    }
};

/**
 * Was this dose's moment before the medication existed in the app? Such doses are not planned:
 * never "missed", never in adherence, streaks, reports or notifications. Without `createdAt`
 * (old records) the start day's midnight counts as the start.
 */
export const isDoseBeforeStart = (med: Pick<Medication, 'startDate' | 'createdAt'>, date: string, time: string): boolean => {
    const created = med.createdAt ? Date.parse(med.createdAt) : NaN;
    const start = Number.isNaN(created) ? new Date(`${med.startDate}T00:00:00`).getTime() : created;
    return doseDateTime(date, time).getTime() < start;
};

/**
 * Doses due on `date` (paused meds excluded), sorted by time, each paired with its log.
 * Doses before the medication was added are left out unless they were logged anyway.
 */
export const getDosesForDate = (meds: Medication[], logs: MedicationLog[], date: string): Dose[] => {
    const byKey = new Map(logs.filter(l => l.scheduledDate === date).map(l => [logKey(l), l]));
    const doses: Dose[] = [];
    for (const med of meds) {
        if (med.isPaused || !isScheduledOn(med, date)) continue;
        for (const time of med.times) {
            const key = doseKey(med.id, date, time);
            const log = byKey.get(key);
            if (!log && isDoseBeforeStart(med, date, time)) continue;
            doses.push({ medication: med, date, time, key, log });
        }
    }
    return doses.sort((a, b) => a.time.localeCompare(b.time) || a.medication.name.localeCompare(b.medication.name));
};

/** Local Date for a dose's scheduled moment. */
export const doseDateTime = (date: string, time: string): Date => new Date(`${date}T${time}:00`);

export const getReadableSchedule = (med: Pick<Medication, 'schedule'>): string => {
    const s = med.schedule;
    switch (s.type) {
        case 'daily':
            return t('schedule_readable.every_day');
        case 'weekly': {
            if (s.daysOfWeek.length === 7) return t('schedule_readable.every_day');
            // Monday-first order reads naturally in both locales
            const order = [1, 2, 3, 4, 5, 6, 0].filter(d => s.daysOfWeek.includes(d));
            return t('schedule_readable.every_week_on', { days: order.map(d => t(`full_days.${DAYS_FULL[d]}`)).join(', ') });
        }
        case 'interval':
            return s.everyDays <= 1 ? t('schedule_readable.every_day') : t('schedule_readable.every_n_days', { count: s.everyDays });
        case 'cyclic':
            return t('schedule_readable.cyclic', { active: s.activeDays, off: s.offDays });
    }
};

/** Next `count` due dates from today (paused meds still get dates — used for display). */
export const getUpcomingDates = (med: Medication, count = 3, from: Date = new Date()): string[] => {
    const upcoming: string[] = [];
    const d = new Date(from);
    for (let i = 0; i < 730 && upcoming.length < count; i++) {
        const ds = getLocalDayString(d);
        if (isScheduledOn(med, ds)) upcoming.push(ds);
        d.setDate(d.getDate() + 1);
    }
    return upcoming;
};

/** Minutes between two HH:mm on a 24h circle. */
export const minutesApart = (a: string, b: string): number => {
    const toMin = (x: string) => { const [h, m] = x.split(':').map(Number); return h * 60 + m; };
    const diff = Math.abs(toMin(a) - toMin(b));
    return Math.min(diff, 1440 - diff);
};

/**
 * Evenly distributed dose times between waking (+offset) and sleep (−offset).
 */
export const calculateMedicationTimes = (
    dosesPerDay: number,
    sleepStart: string,
    sleepEnd: string,
    wakeOffsetMins: number = 30,
    sleepOffsetMins: number = 60
): string[] => {
    if (dosesPerDay <= 0) return [];

    const timeToMins = (t: string) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
    };
    const minsToTime = (m: number) => {
        const normalized = ((m % 1440) + 1440) % 1440;
        const h = Math.floor(normalized / 60).toString().padStart(2, '0');
        const min = Math.floor(normalized % 60).toString().padStart(2, '0');
        return `${h}:${min}`;
    };

    const wakeMins = timeToMins(sleepEnd);
    let sleepMins = timeToMins(sleepStart);
    if (sleepMins < wakeMins) sleepMins += 1440; // sleep after midnight

    const firstDoseMins = wakeMins + wakeOffsetMins;
    const lastDoseMins = Math.max(firstDoseMins, sleepMins - sleepOffsetMins);

    if (dosesPerDay === 1) return [minsToTime(firstDoseMins)];
    const interval = (lastDoseMins - firstDoseMins) / (dosesPerDay - 1);
    return Array.from({ length: dosesPerDay }, (_, i) => minsToTime(Math.round(firstDoseMins + i * interval)));
};

/**
 * Low stock = at most 3 days of doses left, or at most 3 units (whichever is larger).
 * 3 days is roughly how long a refill/prescription takes; the unit floor catches meds whose
 * daily use is tiny or unknown. Daily-use approximation (weekly meds get warned early).
 */
export const LOW_STOCK_DAYS = 3;
export const LOW_STOCK_UNITS = 3;
export const isStockLow = (med: Pick<Medication, 'stock' | 'times'>): boolean => {
  if (!med.stock) return false;
  const perDay = med.stock.perDose * med.times.length;
  return med.stock.remaining <= Math.max(LOW_STOCK_UNITS, perDay * LOW_STOCK_DAYS);
};

/** Stock can't cover one more dose (shown as "stock ran out" when a dose is marked taken). */
export const isStockOut = (stock: Medication['stock']): boolean => !!stock && stock.remaining < stock.perDose;

/** Stock after adding one box of `boxSize` units; the size is remembered, total grows if exceeded. */
export const addStockBox = (stock: NonNullable<Medication['stock']>, boxSize: number): NonNullable<Medication['stock']> => {
  const remaining = stock.remaining + boxSize;
  return { ...stock, boxSize, remaining, total: Math.max(stock.total, remaining) };
};
