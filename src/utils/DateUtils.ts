/**
 * Date utility for AquaMed Tracker.
 * Handles local date string generation and checks to avoid UTC issues.
 */

/**
 * Returns a string in YYYY-MM-DD format based on local time.
 * @param date - The Date object to format. Defaults to current date if not provided.
 */
export const getLocalDayString = (date: Date = new Date()): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Formats a Date object to HH:mm (local time).
 * @param date - The Date object to format.
 */
export const formatLocalTime = (date: Date): string => {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
};



/** Adds `days` (may be negative) to a YYYY-MM-DD string, in local time. */
export const addDays = (dayStr: string, days: number): string => {
    const d = new Date(dayStr + 'T12:00:00');
    d.setDate(d.getDate() + days);
    return getLocalDayString(d);
};

/**
 * ISO timestamp for a log recorded "on" a given local day.
 * Today → now. Past day → that day at the current clock time. Future → null (not allowed).
 */
export const timestampForDay = (dayStr: string, now: Date = new Date()): string | null => {
    const today = getLocalDayString(now);
    if (dayStr === today) return now.toISOString();
    if (dayStr > today) return null;
    const d = new Date(dayStr + 'T00:00:00');
    d.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0);
    return d.toISOString();
};
