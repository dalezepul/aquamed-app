/**
 * Structured dose (amount + unit + optional strength) <-> the legacy free-text `Medication.dosage`.
 * Pure: no React Native / i18n imports, so it runs in jest and in the save path alike.
 */

export type DoseUnit =
  | 'tablet' | 'capsule' | 'ml' | 'drop' | 'puff' | 'scoop' | 'unit'
  | 'injection' | 'patch' | 'suppository' | 'mg' | 'other';

type Lang = 'tr' | 'en';

/** tr label, en singular, en plural, extra spellings accepted by parseDosage. */
const UNITS: Record<DoseUnit, { tr: string; en: string; enPl: string; alias: string[] }> = {
  tablet: { tr: 'tablet', en: 'tablet', enPl: 'tablets', alias: ['tb', 'tab', 'tabs', 'tablets', 'tabletler', 'film tablet', 'draje', 'hap', 'pill', 'pills'] },
  capsule: { tr: 'kapsül', en: 'capsule', enPl: 'capsules', alias: ['kapsul', 'kaps', 'cap', 'caps', 'capsules'] },
  ml: { tr: 'ml', en: 'ml', enPl: 'ml', alias: ['mililitre', 'milliliter', 'millilitre', 'cc'] },
  drop: { tr: 'damla', en: 'drop', enPl: 'drops', alias: ['drops', 'gtt'] },
  puff: { tr: 'puf', en: 'puff', enPl: 'puffs', alias: ['puffs', 'püf', 'fıs', 'fis', 'fıs fıs', 'inhalasyon', 'inhalation'] },
  scoop: { tr: 'ölçek', en: 'scoop', enPl: 'scoops', alias: ['olcek', 'kaşık', 'kasik', 'scoops', 'spoon', 'spoons', 'teaspoon', 'tatlı kaşığı', 'çay kaşığı'] },
  unit: { tr: 'ünite', en: 'unit', enPl: 'units', alias: ['unite', 'units', 'iu', 'ü', 'u'] },
  injection: { tr: 'iğne', en: 'injection', enPl: 'injections', alias: ['igne', 'enjeksiyon', 'injections', 'ampul', 'shot', 'shots'] },
  patch: { tr: 'yama', en: 'patch', enPl: 'patches', alias: ['patches'] },
  suppository: { tr: 'fitil', en: 'suppository', enPl: 'suppositories', alias: ['suppositories', 'supozituvar'] },
  mg: { tr: 'mg', en: 'mg', enPl: 'mg', alias: ['miligram', 'milligram', 'milligrams'] },
  other: { tr: 'diğer', en: 'other', enPl: 'other', alias: [] },
};

export const DOSE_UNITS = Object.keys(UNITS) as DoseUnit[];

/** Units you can count out of a box: stock is kept in these, and per-dose use equals the dose amount. */
export const COUNTABLE_UNITS: DoseUnit[] = ['tablet', 'capsule', 'suppository', 'patch', 'puff', 'drop', 'scoop', 'unit'];
export const isCountable = (u: DoseUnit) => COUNTABLE_UNITS.includes(u);

/** Halves make sense for these (split tablet, half a scoop); the rest step by 1. */
const FRACTIONAL: DoseUnit[] = ['tablet', 'scoop', 'ml'];

const lower = (s: string) => s.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();

/** Button label for the unit grid ("Tablet", "ml"). */
export function unitLabel(u: DoseUnit, lang: Lang): string {
  const s = lang === 'tr' ? UNITS[u].tr : UNITS[u].en;
  return s === 'ml' || s === 'mg' ? s : s.charAt(0).toLocaleUpperCase(lang) + s.slice(1);
}

/** Unit as it reads after a number: "tablet", "tablets", "kapsül". */
export function unitWord(u: DoseUnit, amount: number, lang: Lang): string {
  if (lang === 'tr') return UNITS[u].tr;
  return amount === 1 || amount < 1 ? UNITS[u].en : UNITS[u].enPl;
}

export function formatAmount(n: number, lang: Lang): string {
  const s = String(Math.round(n * 100) / 100);
  return lang === 'tr' ? s.replace('.', ',') : s;
}

/** "0,5" / "0.5" / "½" / "yarım" -> 0.5; NaN if not a number. */
export function parseAmount(s: string): number {
  const t = lower(s);
  if (t === '½' || t === 'yarım' || t === 'yarim' || t === 'half' || t === '1/2') return 0.5;
  if (t === '¼' || t === '1/4' || t === 'çeyrek' || t === 'quarter') return 0.25;
  if (!/^\d+(?:[.,]\d+)?$/.test(t)) return NaN;
  return Number(t.replace(',', '.'));
}

/** −/+ step. Tablets/scoops/ml: 0.25 ↔ 0.5 ↔ 1 ↔ 1.5 ↔ 2 …; other units by whole numbers. */
export function stepAmount(value: number, unit: DoseUnit, dir: 1 | -1): number {
  const v = value > 0 ? value : 1;
  if (!FRACTIONAL.includes(unit)) return Math.max(1, Math.round(v) + dir);
  if (dir > 0) return v < 0.5 ? 0.5 : v < 1 ? 1 : Math.floor(v * 2) / 2 + 0.5;
  return v <= 0.5 ? 0.25 : v <= 1 ? 0.5 : Math.ceil(v * 2) / 2 - 0.5;
}

export interface StructuredDose {
  amount: number;
  unit: DoseUnit;
  /** Strength on the box, e.g. "500 mg". */
  strength?: string;
  /** Only for unit "other". */
  text?: string;
}

/** The `dosage` string the rest of the app (notifications, widget, reports) shows: "1 tablet · 500 mg". */
export function formatDosage(d: StructuredDose, lang: Lang): string | undefined {
  const strength = d.strength?.trim();
  if (d.unit === 'other') return [d.text?.trim(), strength].filter(Boolean).join(' · ') || undefined;
  if (!(d.amount > 0)) return strength || undefined;
  return [`${formatAmount(d.amount, lang)} ${unitWord(d.unit, d.amount, lang)}`, strength].filter(Boolean).join(' · ');
}

const ALIAS = new Map<string, DoseUnit>();
for (const u of DOSE_UNITS) {
  if (u === 'other') continue;
  for (const a of [UNITS[u].tr, UNITS[u].en, UNITS[u].enPl, ...UNITS[u].alias]) ALIAS.set(lower(a), u);
}

const STRENGTH = /^\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|μg|g|gr|ml|iu|ü|%|mg\/ml|mg\/5 ?ml)$/i;

/**
 * Best-effort read of a legacy free-text dosage: "1 tablet", "2 puf", "0,5 tablet · 500 mg", "10 ml", "500 mg".
 * Returns null when it isn't clearly "<number> <unit>" (shown as "other" + the original text).
 */
export function parseDosage(text: string | undefined): StructuredDose | null {
  const s = lower(text ?? '');
  if (!s) return null;
  const [head, ...rest] = s.split(/\s*[·;|]\s*|\s+-\s+|,\s+/);
  const m = head.match(/^(\d+(?:[.,]\d+)?|½|¼|1\/2|1\/4|yarım|yarim|çeyrek|half|quarter)\s*(.+)$/);
  if (!m) return null;
  const amount = parseAmount(m[1]);
  let unitText = m[2];
  let strength = rest.join(' ').trim();
  // "1 tablet 500 mg" (no separator): peel a trailing strength off the unit.
  const tail = unitText.match(/^(.*?)\s+(\d+(?:[.,]\d+)?\s*\S+)$/);
  if (!ALIAS.has(unitText) && tail && ALIAS.has(tail[1]) && STRENGTH.test(tail[2])) {
    unitText = tail[1];
    strength = [tail[2], strength].filter(Boolean).join(' ');
  }
  const unit = ALIAS.get(unitText);
  if (!unit || !(amount > 0)) return null;
  if (strength && !STRENGTH.test(strength)) return null;
  return { amount, unit, ...(strength ? { strength } : {}) };
}

/** Form state for a medication: saved structured fields first, else parse the legacy text. */
export function doseFromMedication(med: { dosage?: string; doseAmount?: number; doseUnit?: string; strength?: string }): StructuredDose {
  if (med.doseUnit && (DOSE_UNITS as string[]).includes(med.doseUnit)) {
    const unit = med.doseUnit as DoseUnit;
    // "other": dosage = "<text> · <strength>", so drop the strength suffix to recover the text.
    const text = unit === 'other' && med.dosage
      ? (med.strength && med.dosage.endsWith(` · ${med.strength}`) ? med.dosage.slice(0, -(med.strength.length + 3)) : med.dosage)
      : undefined;
    return { amount: med.doseAmount ?? 1, unit, strength: med.strength, text };
  }
  if (!med.dosage?.trim()) return { amount: 1, unit: 'tablet' };
  return parseDosage(med.dosage) ?? { amount: 1, unit: 'other', text: med.dosage };
}
