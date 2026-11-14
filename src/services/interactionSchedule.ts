/**
 * Suggest dose times that keep interacting medicines apart (pure, no RN imports).
 *
 * Each medicine keeps its number of doses and the gaps between them; the whole program is
 * shifted in 30-minute steps (smallest shift first) until every spaced pair is far enough apart
 * and all doses fall inside the user's waking hours. Placed first (= kept where they are):
 *   1. anchored medicines — taken on an empty stomach (foodTiming 'empty' or e.g. levothyroxine) or high priority;
 *   2. medicines already in use;
 *   3. the new one being added, which is the one that moves.
 * Within a group more doses go first (hardest to move); on a tie the earlier one in the input stays put.
 */
import { checkInteractions, spacingFor, resolveIngredients, InteractionSeverity } from './drugInteractionService';

export interface ScheduleMed {
  id: string;
  name: string;
  times: string[]; // HH:mm
  foodTiming?: string;
  priority?: string;
  /** The medication being added/edited right now: moved before any existing one. */
  isNew?: boolean;
}

/** Taken on an empty stomach at a fixed morning time; other medicines are moved around them. */
const EMPTY_STOMACH = ['levothyroxine', 'alendronate', 'risedronate', 'ibandronate'];
export const isAnchored = (m: Pick<ScheduleMed, 'name' | 'foodTiming' | 'priority'>): boolean =>
  m.foodTiming === 'empty' || m.priority === 'High' || !!resolveIngredients(m.name)?.some(i => EMPTY_STOMACH.includes(i));
const rank = (m: ScheduleMed) => (isAnchored(m) ? 0 : m.isNew ? 2 : 1);

export interface SpacedPair { a: string; b: string; hours: number }
export interface BlockedPair { a: string; b: string; severity: InteractionSeverity }

export interface ScheduleSuggestion {
  /** id -> suggested times (sorted; equal to the current ones when nothing needs to move), null = no fit in waking hours. */
  suggested: Record<string, string[] | null>;
  /** Pairs that timing can fix, with the hours to keep between them. */
  spaced: SpacedPair[];
  /** Pairs where spacing does not help (contraindicated / systemic major): see a doctor. */
  blocked: BlockedPair[];
}

const STEP = 30;
const DAY = 1440;

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toHHMM = (m: number) => {
  const x = ((m % DAY) + DAY) % DAY;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};
/** Distance on the 24 h clock (22:00 and 06:00 are 8 h apart). */
const gap = (x: number, y: number) => { const d = Math.abs(x - y) % DAY; return Math.min(d, DAY - d); };

/**
 * @param wake  wake-up time (HH:mm) — sleepSettings.end
 * @param sleep bedtime (HH:mm) — sleepSettings.start
 */
export function suggestSpacedTimes(meds: ScheduleMed[], wake: string, sleep: string): ScheduleSuggestion {
  const spaced: SpacedPair[] = [];
  const blocked: BlockedPair[] = [];
  for (let i = 0; i < meds.length; i++) for (let j = i + 1; j < meds.length; j++) {
    const hit = checkInteractions(meds[i].name, [meds[j].name]).interactions[0];
    if (!hit) continue;
    const hours = spacingFor(hit);
    if (hours) spaced.push({ a: meds[i].id, b: meds[j].id, hours });
    else blocked.push({ a: meds[i].id, b: meds[j].id, severity: hit.severity });
  }

  const w = toMin(wake);
  const awakeLen = (toMin(sleep) - w + DAY) % DAY || DAY;
  const awake = (m: number) => (m - w + DAY * 2) % DAY <= awakeLen;

  const placed = new Map<string, number[]>();
  const suggested: Record<string, string[] | null> = {};
  const order = meds.map((m, i) => ({ m, i }))
    .sort((p, q) => rank(p.m) - rank(q.m) || q.m.times.length - p.m.times.length || p.i - q.i);

  for (const { m } of order) {
    const cur = m.times.map(toMin);
    const rules = spaced
      .filter(p => p.a === m.id || p.b === m.id)
      .map(p => ({ other: placed.get(p.a === m.id ? p.b : p.a), min: p.hours * 60 }))
      .filter((r): r is { other: number[]; min: number } => !!r.other);
    const fits = (ts: number[]) => rules.every(r => ts.every(x => r.other.every(y => gap(x, y) >= r.min)));

    let best: number[] | null = fits(cur) ? cur : null;
    for (let d = STEP; !best && d < DAY; d += STEP) {
      for (const off of [d, -d]) {
        const ts = cur.map(x => x + off);
        if (ts.every(awake) && fits(ts)) { best = ts; break; }
      }
    }
    suggested[m.id] = best ? best.map(toHHMM).sort() : null;
    placed.set(m.id, best ?? cur); // no fit: the others must still keep clear of where it really is
  }
  return { suggested, spaced, blocked };
}
