import { Medication, MedicationLog, MedSchedule, Priority } from '../types/models';
import { getLocalDayString, formatLocalTime } from '../utils/DateUtils';

/** Shape of a v1 medication: one record per dose time, grouped by `groupId`. */
export interface MedicationV1 {
  id: string;
  name: string;
  dosage?: string; // v1 form labelled this "Description / Risks"
  time: string;
  startDate: string;
  endDate: string | null;
  priority: Priority;
  isActive: boolean;
  remainingPills: number;
  totalPills: number;
  groupId?: string;
  stockTracking?: boolean;
  recurrence?: { type: 'Daily' | 'Weekly' | 'Monthly'; interval?: number; daysOfWeek?: number[] };
  isPaused?: boolean;
  advancedSchedule?: {
    type: 'interval' | 'cyclic';
    intervalDays?: number;
    cycleDaysActive?: number;
    cycleDaysOff?: number;
    cycleStartDate?: string;
  };
}

export interface MedicationLogV1 {
  id: string;
  medicationId: string;
  medicationName?: string;
  dosage?: string;
  status: MedicationLog['status'];
  timestamp: string;
}

const dayOf = (isoOrDay: string) => (isoOrDay.length === 10 ? isoOrDay : getLocalDayString(new Date(isoOrDay)));

const scheduleOf = (m: MedicationV1): { schedule: MedSchedule; startDate: string } => {
  const start = dayOf(m.startDate);
  const a = m.advancedSchedule;
  if (a?.type === 'interval') return { schedule: { type: 'interval', everyDays: Math.max(1, a.intervalDays || 1) }, startDate: start };
  if (a?.type === 'cyclic') {
    return {
      schedule: { type: 'cyclic', activeDays: a.cycleDaysActive || 21, offDays: a.cycleDaysOff || 7 },
      startDate: a.cycleStartDate ? dayOf(a.cycleStartDate) : start, // keep the cycle phase
    };
  }
  if (m.recurrence?.type === 'Weekly' && m.recurrence.daysOfWeek?.length) {
    return { schedule: { type: 'weekly', daysOfWeek: [...m.recurrence.daysOfWeek].sort() }, startDate: start };
  }
  return { schedule: { type: 'daily' }, startDate: start };
};

/**
 * v1 → v2: merge per-time records of a group into one medication with `times[]`,
 * and give every log the dose it belongs to (scheduledDate/Time).
 * Pure; the caller persists the result.
 */
export const migrateV1toV2 = (
  oldMeds: MedicationV1[],
  oldLogs: MedicationLogV1[],
  now: Date = new Date()
): { medications: Medication[]; logs: MedicationLog[] } => {
  const groups = new Map<string, MedicationV1[]>();
  for (const m of oldMeds) {
    if (m.isActive === false) continue;
    const g = m.groupId || m.id;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(m);
  }

  const medications: Medication[] = [];
  const idMap = new Map<string, { id: string; time: string }>(); // old per-time id → new id + its time
  for (const members of groups.values()) {
    const base = members[0];
    const { schedule, startDate } = scheduleOf(base);
    const times = [...new Set(members.map(m => m.time))].sort();
    const tracked = members.some(m => m.stockTracking) && base.totalPills > 0;
    medications.push({
      id: base.id,
      name: base.name,
      notes: base.dosage || undefined,
      times,
      startDate,
      endDate: base.endDate ? dayOf(base.endDate) : null,
      schedule,
      foodTiming: 'any',
      priority: base.priority || Priority.Medium,
      isPaused: !!base.isPaused,
      stock: tracked ? { remaining: Math.max(0, base.remainingPills), total: base.totalPills, perDose: 1 } : undefined,
      // v1 tracked the med since its start day: its unlogged doses from then on are real misses.
      createdAt: new Date(`${startDate}T00:00:00`).toISOString(),
    });
    members.forEach(m => idMap.set(m.id, { id: base.id, time: m.time }));
  }

  const seen = new Set<string>();
  const logs: MedicationLog[] = [];
  // Newest first so that, if v1 logged a dose twice, the latest action wins.
  for (const l of [...oldLogs].sort((a, b) => b.timestamp.localeCompare(a.timestamp))) {
    const mapped = idMap.get(l.medicationId);
    const scheduledDate = getLocalDayString(new Date(l.timestamp));
    const scheduledTime = mapped?.time ?? formatLocalTime(new Date(l.timestamp));
    const medicationId = mapped?.id ?? l.medicationId;
    const key = `${medicationId}|${scheduledDate}|${scheduledTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    logs.push({ ...l, medicationId, scheduledDate, scheduledTime });
  }
  logs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { medications, logs };
};
