import { Measurement, MeasurementType } from '../types/models';
import { classifyMeasurement, RangeFlag } from '../constants/measurementRanges';
import { getLocalDayString } from './DateUtils';

export const MEASUREMENT_TYPES: MeasurementType[] = ['bp', 'glucose', 'weight'];
export const UNITS: Record<MeasurementType, string> = { bp: 'mmHg', glucose: 'mg/dL', weight: 'kg' };

const num = (n: number, locale: string) => n.toLocaleString(locale, { maximumFractionDigits: 1 });

/** "132/84" · "105" · "72,5" (unit not included). */
export const formatMeasurementValue = (m: Pick<Measurement, 'type' | 'value' | 'diastolic'>, locale: string) =>
  m.type === 'bp' ? `${Math.round(m.value)}/${Math.round(m.diastolic ?? 0)}` : num(m.value, locale);

/** "72,5" / "72.5" → 72.5; empty or junk → NaN. */
export const parseNumber = (s: string) => (s.trim() ? Number(s.trim().replace(',', '.')) : NaN);

export interface DayPoint { date: string; value: number; low?: number; flag: RangeFlag }

/**
 * One point per day that has readings of `type` on/after `fromDay` (oldest first): averages,
 * flagged if any reading that day was out of range. `low` = average diastolic for bp.
 */
export const dailySeries = (list: Measurement[], type: MeasurementType, fromDay: string): DayPoint[] => {
  const days = new Map<string, Measurement[]>();
  list.forEach(m => {
    if (m.type !== type) return;
    const d = getLocalDayString(new Date(m.timestamp));
    if (d >= fromDay) days.set(d, [...(days.get(d) ?? []), m]);
  });
  const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, xs]) => {
    const flags = xs.map(classifyMeasurement);
    return {
      date,
      value: avg(xs.map(m => m.value)),
      ...(type === 'bp' ? { low: avg(xs.map(m => m.diastolic ?? 0)) } : {}),
      flag: flags.includes('high') ? 'high' : flags.includes('low') ? 'low' : null,
    };
  });
};
