import { Measurement } from '../types/models';

/**
 * Out-of-range thresholds for the "talk to your doctor" hint. Information, not medical advice or a diagnosis.
 * Generally accepted values:
 * - Blood pressure: high ≥140/90 mmHg (WHO hypertension definition; ESC/ESH 2018/2023 guidelines);
 *   low ≤90/60 mmHg (common hypotension threshold, e.g. NHS / American Heart Association).
 * - Glucose: fasting ≥126 mg/dL (7.0 mmol/L) is the diabetes cut-off (WHO; ADA Standards of Care);
 *   any reading ≥200 mg/dL (11.1 mmol/L) after a meal / at random is the ADA random-glucose cut-off;
 *   <70 mg/dL (3.9 mmol/L) is hypoglycaemia level 1 (ADA) at any time.
 * - Weight: no range (depends on the person).
 */
export const RANGES = {
  bp: { highSys: 140, highDia: 90, lowSys: 90, lowDia: 60 },
  glucose: { fastingHigh: 126, otherHigh: 200, low: 70 },
} as const;

export type RangeFlag = 'high' | 'low' | null;

export const classifyMeasurement = (m: Pick<Measurement, 'type' | 'value' | 'diastolic' | 'context'>): RangeFlag => {
  if (m.type === 'bp') {
    const b = RANGES.bp, dia = m.diastolic ?? NaN;
    if (m.value >= b.highSys || dia >= b.highDia) return 'high';
    if (m.value <= b.lowSys || dia <= b.lowDia) return 'low';
    return null;
  }
  if (m.type === 'glucose') {
    const g = RANGES.glucose;
    if (m.value < g.low) return 'low';
    if (m.value >= (m.context === 'fasting' ? g.fastingHigh : g.otherHigh)) return 'high';
    return null;
  }
  return null;
};

/** Plausible input limits (typos, not medicine). */
export const INPUT_LIMITS = {
  systolic: [50, 300], diastolic: [30, 200], pulse: [20, 250], glucose: [20, 700], weight: [2, 400],
} as const;
