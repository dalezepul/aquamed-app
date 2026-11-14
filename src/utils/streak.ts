import { getLocalDayString, addDays } from './DateUtils';

/** Streak lengths that earn a freeze: 7, 30, 90, then every 90 days (180, 270, …). */
export const FREEZE_MILESTONES = [7, 30, 90];
export const FREEZE_CAP = 3;

export const isFreezeMilestone = (streak: number): boolean =>
    FREEZE_MILESTONES.includes(streak) || (streak > 90 && streak % 90 === 0);

/** Next streak length that will earn a freeze. */
export const nextFreezeMilestone = (streak: number): number => {
    const next = FREEZE_MILESTONES.find(m => m > streak);
    return next ?? (Math.floor(streak / 90) + 1) * 90;
};

/** Streak card: days until the next freeze, shown only once the streak is past 3 days and freezes aren't full. */
export const daysToNextFreeze = (streak: number, freezesLeft: number): number | null =>
    streak > 3 && freezesLeft < FREEZE_CAP ? nextFreezeMilestone(streak) - streak : null;

export interface StreakResult {
    count: number;          // completed days in the current streak
    frozenDays: string[];   // missed days the current streak survived by spending a freeze, newest first
    freezesLeft: number;    // freezes in hand right now
    nextMilestone: number;  // streak length that earns the next freeze
}

/**
 * Replays history day by day from `firstDay` to today:
 * - a completed day extends the streak; reaching 7, 30, 90 (then every 90) days earns a freeze (max 3);
 * - a missed day spends a freeze if there is one (the streak survives but doesn't grow), otherwise the streak resets;
 * - an unfinished *today* is neither a miss nor a completion yet.
 * Everything is derived from the logs, so nothing extra has to be stored.
 */
export const computeStreak = (
    isComplete: (day: string) => boolean,
    firstDay: string | null,
    now: Date = new Date(),
    /** Extra freezes (rewarded ads, Plus): one entry per freeze, dated the day it was granted. */
    grantDays: string[] = [],
    maxDays = 800
): StreakResult => {
    const today = getLocalDayString(now);
    const starts = [firstDay, ...grantDays].filter((d): d is string => !!d && d <= today).sort();
    let day = starts[0] ?? today;
    const earliest = addDays(today, -maxDays);
    if (day < earliest) day = earliest;

    let count = 0;
    let freezes = 0;
    let frozenDays: string[] = [];
    const grantsOn = new Map<string, number>();
    grantDays.forEach(d => grantsOn.set(d, (grantsOn.get(d) ?? 0) + 1));
    for (; day <= today; day = addDays(day, 1)) {
        freezes = Math.min(FREEZE_CAP, freezes + (grantsOn.get(day) ?? 0));
        if (isComplete(day)) {
            count++;
            if (isFreezeMilestone(count)) freezes = Math.min(FREEZE_CAP, freezes + 1);
        } else if (day === today) {
            break; // still time to finish today
        } else if (count > 0 && freezes > 0) {
            freezes--;
            frozenDays.push(day);
        } else {
            count = 0;
            frozenDays = [];
        }
    }
    return { count, frozenDays: frozenDays.reverse(), freezesLeft: freezes, nextMilestone: nextFreezeMilestone(count) };
};

/** Streak length only. */
export const countStreak = (isComplete: (day: string) => boolean, firstDay: string | null, now: Date = new Date()): number =>
    computeStreak(isComplete, firstDay, now).count;
