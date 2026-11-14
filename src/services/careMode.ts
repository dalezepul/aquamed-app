import type { Medication, MedicationLog } from '../types/models';
import { doseKey, logKey } from '../types/models';
import type { PairEvent, SharedDose } from './pairing';

/**
 * Caregiver mode ("Bir yakınımı takip edeceğim"): pure logic, no Firebase here.
 * Commands: the caregiver writes pairs/{id}/commands/{cmdId}; the patient's phone applies
 * them to its local store (pairing.applyPendingCommands) and deletes them.
 */

export type AppMode = 'self' | 'caregiver';

/** Bottom tabs of 'self' mode. 'caregiver' has no tabs: one CareHome screen (+ CareSettings). */
export const SELF_TABS = ['Home', 'Medications', 'Progress', 'Settings'] as const;

/** The followed person to show: the chosen one if still paired, else the first. */
export const pickPair = <P extends { id: string }>(pairs: P[] | null | undefined, id?: string): P | undefined =>
  pairs?.find(p => p.id === id) ?? pairs?.[0];

export type DoseCommand = { type: 'dose'; medId: string; date: string; time: string; status: 'taken' | 'skipped' };
export type WaterCommand = { type: 'water'; ml: number };
export type CareCommand = (DoseCommand | WaterCommand) & { id: string; by: string; at: number };

/** One glass, for the caregiver's "Su ekle" button. */
export const GLASS_ML = 250;
export const MAX_COMMAND_ML = 1000;

export type DoseState = 'taken' | 'skipped' | 'late' | 'waiting';
export interface DoseRow {
  dose: SharedDose;
  state: DoseState;
  /** Set when the state comes from this caregiver's command the patient's phone hasn't applied yet. */
  pending?: CareCommand;
}

const refOf = (medId: string, date: string, time: string) => doseKey(medId, date, time);

/**
 * Today's doses of a followed person, with what happened to each: the patient's latest
 * taken/skipped event wins, then an unapplied caregiver command, then late (event or overdue), else waiting.
 */
export const todayDoseRows = (
  doses: SharedDose[], events: PairEvent[], commands: CareCommand[], today: string, now: number, lateMin: number,
): DoseRow[] => {
  const done = new Map<string, PairEvent>();
  const late = new Set<string>();
  for (const e of events) {
    const k = refOf(e.medId, e.date, e.time);
    if (e.type === 'late') late.add(k);
    else if (!done.has(k) || done.get(k)!.at < e.at) done.set(k, e);
  }
  const cmd = new Map<string, CareCommand>();
  for (const c of commands) {
    if (c.type !== 'dose') continue;
    const k = refOf(c.medId, c.date, c.time);
    if (!cmd.has(k) || cmd.get(k)!.at < c.at) cmd.set(k, c);
  }
  return doses
    .filter(d => d.date === today)
    .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
    .map(dose => {
      const k = refOf(dose.medId, dose.date, dose.time);
      const ev = done.get(k);
      if (ev) return { dose, state: ev.type as 'taken' | 'skipped' };
      const c = cmd.get(k);
      if (c && c.type === 'dose') return { dose, state: c.status, pending: c };
      return { dose, state: late.has(k) || now >= dose.at + lateMin * 60000 ? 'late' : 'waiting' };
    });
};

export interface CareSummary {
  /** Confirmed by the patient's phone (the caregiver's own unapplied marks don't count yet). */
  taken: number;
  total: number;
  late: DoseRow[];
  next: DoseRow | null;
  last: PairEvent | null;
}

/** The big status card: "2/3 alındı · sıradaki 20:00 Parol", late doses, latest event. Rows come time-sorted. */
export const careSummary = (rows: DoseRow[], events: PairEvent[]): CareSummary => ({
  taken: rows.filter(r => r.state === 'taken' && !r.pending).length,
  total: rows.length,
  late: rows.filter(r => r.state === 'late'),
  next: rows.find(r => r.state === 'waiting') ?? null,
  last: events.reduce<PairEvent | null>((a, e) => (!a || e.at > a.at ? e : a), null),
});

/** ml of water commands not applied yet. */
export const pendingWaterMl = (commands: CareCommand[]) =>
  commands.reduce((s, c) => s + (c.type === 'water' ? c.ml : 0), 0);

export type CommandAction =
  | { kind: 'dose'; med: Medication; date: string; time: string; status: 'taken' | 'skipped'; cmd: CareCommand }
  | { kind: 'water'; ml: number; cmd: CareCommand };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * Patient side: what to do with a batch of commands. Idempotent: a dose the patient already
 * logged is left alone; several commands for one dose → only the latest. Unknown meds, bad
 * shapes and silly water amounts are dropped (every command is deleted either way).
 */
export const commandsToApply = (cmds: CareCommand[], meds: Medication[], logs: MedicationLog[]): CommandAction[] => {
  const logged = new Set(logs.map(logKey));
  const latestDose = new Map<string, CareCommand & DoseCommand>();
  const out: CommandAction[] = [];
  for (const c of [...cmds].sort((a, b) => a.at - b.at)) {
    if (c.type === 'water') {
      if (Number.isInteger(c.ml) && c.ml > 0 && c.ml <= MAX_COMMAND_ML) out.push({ kind: 'water', ml: c.ml, cmd: c });
    } else if (c.type === 'dose' && DAY_RE.test(c.date) && TIME_RE.test(c.time) && (c.status === 'taken' || c.status === 'skipped')) {
      latestDose.set(refOf(c.medId, c.date, c.time), c);
    }
  }
  for (const [k, c] of latestDose) {
    const med = meds.find(m => m.id === c.medId);
    if (!med || logged.has(k)) continue;
    out.push({ kind: 'dose', med, date: c.date, time: c.time, status: c.status, cmd: c });
  }
  return out;
};
