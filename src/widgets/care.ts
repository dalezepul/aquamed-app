import type { SharedDose, PairEvent, SharedSchedule } from '../services/pairing';
import Constants from 'expo-constants';
import { getLocalDayString } from '../utils/DateUtils';

/** AsyncStorage key of the caregiver snapshot the "Takip" widget draws (written by pairing.syncCaregiverAlarms). */
export const CARE_WIDGET_KEY = '@aquamed_care_widget';

// app.json scheme (app.config.js gives the test variant its own), so each build opens itself.
const scheme = [Constants.expoConfig?.scheme].flat()[0] || 'aquamed';
export const APP_URL_PREFIX = `${scheme}://`;
/** Widget tap target; AppNavigator's linking opens CareHome in caregiver mode, Yakınlar (Caregivers) in self mode. */
export const CAREGIVERS_URL = `${APP_URL_PREFIX}caregivers`;

export interface CareSnapshot {
  lateMin: number;
  patients: { name: string; doses: SharedDose[]; events: PairEvent[]; water: SharedSchedule['water'] }[];
}

export interface CareWidgetSummary {
  name: string;
  others: number;            // further followed patients not shown
  taken: number;
  planned: number;
  next: { name: string; time: string } | null;
  last: { type: 'taken' | 'skipped' | 'late'; name: string; time: string } | null;
  water: { ml: number; goal: number; percent: number } | null;
}

const ref = (d: { medId: string; date: string; time: string }) => `${d.medId}_${d.date}_${d.time}`;

/**
 * Today's view of the first followed patient. Recomputed on every draw so "next" and
 * "late" move with the clock between syncs. null → nobody followed.
 */
export function computeCareWidget(snap: CareSnapshot | null, now: Date): CareWidgetSummary | null {
  const p = snap?.patients?.[0];
  if (!snap || !p) return null;
  const today = getLocalDayString(now);
  const n = now.getTime();
  const lateMs = snap.lateMin * 60000;
  const reported = p.events.filter(e => e.date === today && e.type !== 'late'); // patient's own late reports are re-derived below
  const status = new Map(reported.map(e => [ref(e), e.type]));
  const doses = p.doses.filter(d => d.date === today).sort((a, b) => a.at - b.at);
  const open = doses.filter(d => !status.has(ref(d)));
  const next = open.find(d => d.at + lateMs > n);
  const last = [
    ...reported.map(e => ({ type: e.type, name: e.medName, time: e.time, at: e.at })),
    ...open.filter(d => d.at + lateMs <= n).map(d => ({ type: 'late' as const, name: d.name, time: d.time, at: d.at + lateMs })),
  ].sort((a, b) => b.at - a.at)[0];
  const w = p.water && p.water.date === today ? p.water : null;
  return {
    name: p.name,
    others: snap.patients.length - 1,
    taken: doses.filter(d => status.get(ref(d)) === 'taken').length,
    planned: doses.length,
    next: next ? { name: next.name, time: next.time } : null,
    last: last ? { type: last.type, name: last.name, time: last.time } : null,
    water: w ? { ml: w.ml, goal: w.goal, percent: w.goal > 0 ? Math.min(100, Math.round((w.ml / w.goal) * 100)) : 0 } : null,
  };
}
