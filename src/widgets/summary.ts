import { Dose } from '../types/models';
import { doseDateTime } from '../utils/ScheduleUtils';

// Same grace as MedicationCard's DOSE_GRACE_MINUTES (not imported: that module pulls in UI).
const GRACE_MS = 15 * 60000;

export interface WidgetSummary {
  waterMl: number;
  goalMl: number;
  percent: number;          // 0–100, clamped
  goalMet: boolean;
  glassMl: number;
  canAddGlass: boolean;     // false → one more glass would pass the fluid ceiling
  nextDose: { name: string; time: string } | null;
  overdue: { name: string; time: string; count: number } | null;
  dosesToday: number;
  allDosesDone: boolean;    // every dose today has a log (taken/skipped/missed)
}

export function computeWidgetSummary(p: {
  waterMl: number; goalMl: number; ceilingMl: number; glassMl: number; doses: Dose[]; now: Date;
  /** Raw volume logged today (the ceiling is about volume, not coefficient-weighted hydration). */
  fluidMl?: number;
}): WidgetSummary {
  const open = p.doses.filter(d => !d.log);
  const late = open.filter(d => p.now.getTime() > doseDateTime(d.date, d.time).getTime() + GRACE_MS);
  const next = open.find(d => !late.includes(d));
  return {
    waterMl: p.waterMl,
    goalMl: p.goalMl,
    percent: p.goalMl > 0 ? Math.min(100, Math.round((p.waterMl / p.goalMl) * 100)) : 0,
    goalMet: p.waterMl >= p.goalMl,
    glassMl: p.glassMl,
    canAddGlass: (p.fluidMl ?? p.waterMl) + p.glassMl <= p.ceilingMl,
    nextDose: next ? { name: next.medication.name, time: next.time } : null,
    overdue: late.length ? { name: late[0].medication.name, time: late[0].time, count: late.length } : null,
    dosesToday: p.doses.length,
    allDosesDone: p.doses.length > 0 && open.length === 0,
  };
}
