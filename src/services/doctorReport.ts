import { Medication, MedicationLog, MedicationStatus, WaterLog, logKey, MedSchedule } from '../types/models';
import { getDosesForDate, doseDateTime, getReadableSchedule, daysBetween } from '../utils/ScheduleUtils';
import { addDays, getLocalDayString } from '../utils/DateUtils';
import { goalOnDate, UserMetrics } from './storageService';
import { t, getLocale } from '../localization/i18n';
import { Measurement, MeasurementType } from '../types/models';
import { classifyMeasurement, RANGES } from '../constants/measurementRanges';
import { MEASUREMENT_TYPES, UNITS, formatMeasurementValue } from '../utils/measurements';
import { formatLocalTime } from '../utils/DateUtils';

export interface DoctorReportInput {
  meds: Medication[];
  medLogs: MedicationLog[];
  waterLogs: WaterLog[];
  waterGoal: number;
  goalHistory: Record<string, number>;
  fluidLimitMl: number | null;
}

export interface MedSummary {
  id: string;
  name: string;
  dosage?: string;
  schedule?: MedSchedule; // undefined → medication was deleted
  times: string[];
  paused: boolean;
  planned: number;
  taken: number;
  skipped: number;
  missed: number;
  adherence: number | null; // % taken of planned
}

export interface DayRow {
  date: string;
  medTaken: number;
  medPlanned: number;
  fluidMl: number;   // raw volume (fluid limit is about volume)
  goalMet: boolean;  // hydration vs the goal in effect that day
  overLimit: boolean;
}

export interface DoctorReport {
  from: string;
  to: string;
  meds: MedSummary[];
  days: DayRow[];
  totals: { planned: number; taken: number; adherence: number | null };
  water: { loggedDays: number; avgMl: number; goalMetDays: number; limitMl: number | null; overLimitDays: number };
}

const pct = (taken: number, planned: number) => (planned > 0 ? Math.round((taken / planned) * 100) : null);

/**
 * Adherence + fluid summary for [from, to] (YYYY-MM-DD, inclusive). Pure: everything comes in as data.
 * Planned = scheduled doses whose time has passed (via getDosesForDate, so paused meds get none)
 * plus any logged dose the schedule no longer explains (paused/deleted med, changed times).
 * Missed = planned dose with no log, or logged as missed.
 */
export const buildDoctorReport = (data: DoctorReportInput, from: string, to: string, now: Date = new Date()): DoctorReport => {
  const summaries = new Map<string, MedSummary>();
  const summary = (id: string, med?: Medication, log?: MedicationLog): MedSummary => {
    let s = summaries.get(id);
    if (!s) {
      s = {
        id,
        name: med?.name ?? log?.medicationName ?? t('history.unknown_medication'),
        dosage: med?.dosage ?? log?.dosage,
        schedule: med?.schedule,
        times: med?.times ?? [],
        paused: !!med?.isPaused,
        planned: 0, taken: 0, skipped: 0, missed: 0, adherence: null,
      };
      summaries.set(id, s);
    }
    return s;
  };
  const count = (s: MedSummary, row: DayRow, status?: MedicationStatus) => {
    s.planned++;
    row.medPlanned++;
    if (status === MedicationStatus.Taken) { s.taken++; row.medTaken++; }
    else if (status === MedicationStatus.Skipped) s.skipped++;
    else s.missed++;
  };

  const medById = new Map(data.meds.map(m => [m.id, m]));
  // Every med scheduled at some point in the range gets a row, even with zero doses so far.
  data.meds.forEach(m => { if (m.startDate <= to && (!m.endDate || m.endDate >= from)) summary(m.id, m); });

  const fluid = new Map<string, number>();
  const hydration = new Map<string, number>();
  data.waterLogs.forEach(l => {
    const d = getLocalDayString(new Date(l.timestamp));
    if (d < from || d > to) return;
    fluid.set(d, (fluid.get(d) || 0) + l.amountMl);
    hydration.set(d, (hydration.get(d) || 0) + (l.hydrationAmountMl ?? l.amountMl));
  });

  const logsByDay = new Map<string, MedicationLog[]>();
  data.medLogs.forEach(l => {
    if (l.scheduledDate < from || l.scheduledDate > to) return;
    logsByDay.set(l.scheduledDate, [...(logsByDay.get(l.scheduledDate) || []), l]);
  });

  const limit = data.fluidLimitMl;
  const days: DayRow[] = [];
  for (let i = 0, n = daysBetween(from, to); i <= n; i++) {
    const date = addDays(from, i);
    const logs = logsByDay.get(date) || [];
    const ml = fluid.get(date) || 0;
    const row: DayRow = {
      date, medTaken: 0, medPlanned: 0, fluidMl: ml,
      goalMet: (hydration.get(date) || 0) >= goalOnDate(data.goalHistory, data.waterGoal, date),
      overLimit: limit != null && ml > limit,
    };
    const seen = new Set<string>();
    for (const dose of getDosesForDate(data.meds, logs, date)) {
      if (!dose.log && doseDateTime(date, dose.time) > now) continue; // not due yet
      seen.add(dose.key);
      count(summary(dose.medication.id, dose.medication), row, dose.log?.status);
    }
    for (const log of logs) {
      if (!seen.has(logKey(log))) count(summary(log.medicationId, medById.get(log.medicationId), log), row, log.status);
    }
    days.push(row);
  }

  const meds = [...summaries.values()].map(s => ({ ...s, adherence: pct(s.taken, s.planned) }));
  const planned = meds.reduce((a, m) => a + m.planned, 0);
  const taken = meds.reduce((a, m) => a + m.taken, 0);
  const logged = days.filter(d => fluid.has(d.date));
  return {
    from, to, meds, days,
    totals: { planned, taken, adherence: pct(taken, planned) },
    water: {
      loggedDays: logged.length,
      avgMl: logged.length ? Math.round(logged.reduce((a, d) => a + d.fluidMl, 0) / logged.length) : 0,
      goalMetDays: days.filter(d => d.goalMet).length,
      limitMl: limit,
      overLimitDays: days.filter(d => d.overLimit).length,
    },
  };
};

export const escapeHTML = (str: string | number | undefined | null) =>
  String(str ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] || c));

export interface DoctorReportHeader {
  userName: string;
  metrics: UserMetrics;
  generatedAt: Date;
}

/** Printable A4 HTML (expo-print). Black on white, no colour needed to read it. */
export const renderDoctorReportHtml = (r: DoctorReport, h: DoctorReportHeader, measurements?: MeasurementSummary): string => {
  const loc = getLocale() === 'tr' ? 'tr-TR' : 'en-GB';
  const fmt = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(d + 'T12:00:00').toLocaleDateString(loc, opts);
  const long = (d: string) => fmt(d, { day: 'numeric', month: 'long', year: 'numeric' });
  const num = (n: number) => n.toLocaleString(loc);
  const percent = (v: number | null) => (v == null ? '—' : t('common.percent', { value: v }));
  const e = escapeHTML;

  const metrics = [
    h.metrics.height ? t('doctor_report.height', { value: h.metrics.height }) : '',
    h.metrics.weight ? t('doctor_report.weight', { value: h.metrics.weight }) : '',
  ].filter(Boolean).join(' · ');

  const medRows = r.meds.map(m => {
    const program = m.schedule ? `${e(getReadableSchedule({ schedule: m.schedule }))}<br>${e(m.times.join(', '))}` : '—';
    const note = !m.schedule ? t('doctor_report.removed_note') : m.paused ? t('doctor_report.paused_note') : '';
    return `<tr>
      <td><b>${e(m.name)}</b>${note ? `<div class="note">${e(note)}</div>` : ''}</td>
      <td class="nw">${e(m.dosage || "—")}</td>
      <td>${program}</td>
      <td class="n">${m.planned}</td><td class="n">${m.taken}</td><td class="n">${m.skipped}</td><td class="n">${m.missed}</td>
      <td class="n"><b>${percent(m.adherence)}</b></td>
    </tr>`;
  }).join('');

  const w = r.water;
  const waterItems = [
    [t('doctor_report.water_avg'), `${num(w.avgMl)} ml`],
    [t('doctor_report.water_logged_days'), `${w.loggedDays} / ${r.days.length}`],
    [t('doctor_report.water_goal_days'), `${w.goalMetDays} / ${r.days.length}`],
    ...(w.limitMl != null ? [[t('doctor_report.water_limit_days', { limit: num(w.limitMl) }), `${w.overLimitDays} / ${r.days.length}`]] : []),
  ].map(([k, v]) => `<div class="stat"><div class="k">${e(k)}</div><div class="v">${e(v)}</div></div>`).join('');

  const dayRows = r.days.map(d => `<tr>
      <td>${e(fmt(d.date, { day: '2-digit', month: '2-digit', year: 'numeric', weekday: 'short' }))}</td>
      <td class="n">${d.medPlanned ? `${d.medTaken} / ${d.medPlanned}` : '—'}</td>
      <td class="n">${d.fluidMl ? num(d.fluidMl) : '—'}${d.overLimit ? ' ▲' : ''}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="${getLocale()}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #000; font-size: 10.5pt; line-height: 1.35; margin: 0; }
  h1 { font-size: 18pt; margin: 0 0 2mm; }
  h2 { font-size: 12.5pt; margin: 7mm 0 2mm; padding-bottom: 1mm; border-bottom: 1.5px solid #000; page-break-after: avoid; }
  .meta { display: flex; flex-wrap: wrap; gap: 1mm 8mm; font-size: 10pt; }
  .meta b { font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th, td { border: 1px solid #555; padding: 1.5mm 2mm; text-align: left; vertical-align: top; }
  th { background: #e6e6e6; font-size: 9.5pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  td.nw { white-space: nowrap; }
  .note { font-size: 8.5pt; font-style: italic; margin-top: 0.5mm; }
  .hint { font-size: 8.5pt; margin: 1.5mm 0 0; }
  .total { font-size: 11pt; margin: 0 0 2mm; }
  .stats { display: flex; flex-wrap: wrap; gap: 3mm; }
  .stat { border: 1px solid #555; padding: 2mm 3mm; min-width: 38mm; flex: 1; page-break-inside: avoid; }
  .stat .k { font-size: 9pt; }
  .stat .v { font-size: 14pt; font-weight: 700; }
  table.days { font-size: 9.5pt; }
  table.days td, table.days th { padding: 0.8mm 2mm; }
  footer { margin-top: 8mm; padding-top: 2mm; border-top: 1px solid #000; font-size: 8.5pt; page-break-inside: avoid; }
</style></head>
<body>
  <h1>${e(t('doctor_report.title'))}</h1>
  <div class="meta">
    ${h.userName ? `<span><b>${e(t('common.name'))}:</b> ${e(h.userName)}</span>` : ''}
    <span><b>${e(t('doctor_report.range_label'))}:</b> ${e(long(r.from))} – ${e(long(r.to))} (${e(t('doctor_report.days', { count: r.days.length }))})</span>
    <span>${e(t('export.generated_on', { date: `${h.generatedAt.toLocaleDateString(loc)} ${h.generatedAt.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })}` }))}</span>
    ${metrics ? `<span>${e(metrics)}</span>` : ''}
  </div>

  <h2>${e(t('doctor_report.section_meds'))}</h2>
  ${r.meds.length === 0 ? `<p>${e(t('doctor_report.no_meds'))}</p>` : `
  <p class="total"><b>${e(t('doctor_report.overall'))}:</b> ${percent(r.totals.adherence)} (${r.totals.taken} / ${r.totals.planned})</p>
  <table>
    <thead><tr>
      <th>${e(t('doctor_report.col_med'))}</th><th>${e(t('doctor_report.col_dose'))}</th><th>${e(t('doctor_report.col_schedule'))}</th>
      <th class="n">${e(t('doctor_report.col_planned'))}</th><th class="n">${e(t('doctor_report.col_taken'))}</th>
      <th class="n">${e(t('doctor_report.col_skipped'))}</th><th class="n">${e(t('doctor_report.col_missed'))}</th>
      <th class="n">${e(t('doctor_report.col_adherence'))}</th>
    </tr></thead>
    <tbody>${medRows}</tbody>
  </table>
  <p class="hint">${e(t('doctor_report.missed_hint'))}</p>`}

  <h2>${e(t('doctor_report.section_water'))}</h2>
  <div class="stats">${waterItems}</div>
  <p class="hint">${e(t('doctor_report.water_hint'))}</p>

  ${measurements ? renderMeasurementsHtml(measurements) : ''}

  <h2>${e(t('doctor_report.section_daily'))}</h2>
  <table class="days">
    <thead><tr><th>${e(t('export.col_date'))}</th><th class="n">${e(t('doctor_report.col_day_meds'))}</th><th class="n">${e(t('doctor_report.col_fluid'))}</th></tr></thead>
    <tbody>${dayRows}</tbody>
  </table>
  ${w.limitMl != null ? `<p class="hint">${e(t('doctor_report.over_limit_legend'))}</p>` : ''}

  <footer>${e(t('doctor_report.source_note'))} ${e(t('settings.medical_disclaimer'))}</footer>
</body></html>`;
};

// --- Measurements (bp / glucose / weight) --------------------------------------------

export interface Agg { avg: number; min: number; max: number }
export interface MeasurementStats {
  type: MeasurementType;
  count: number;
  value: Agg;       // systolic for bp
  diastolic?: Agg;  // bp only
  outOfRange: number;
}
export interface MeasurementSummary { stats: MeasurementStats[]; rows: Measurement[] }

const agg = (xs: number[]): Agg => ({
  avg: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10,
  min: Math.min(...xs),
  max: Math.max(...xs),
});

/** Readings on local days [from, to] (oldest first) and per-type stats. null → no readings: the report hides the section. */
export const summarizeMeasurements = (list: Measurement[], from: string, to: string): MeasurementSummary | null => {
  const rows = list
    .filter(m => { const d = getLocalDayString(new Date(m.timestamp)); return d >= from && d <= to; })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (!rows.length) return null;
  const stats = MEASUREMENT_TYPES.flatMap(type => {
    const xs = rows.filter(m => m.type === type);
    if (!xs.length) return [];
    return [{
      type,
      count: xs.length,
      value: agg(xs.map(m => m.value)),
      ...(type === 'bp' ? { diastolic: agg(xs.map(m => m.diastolic ?? 0)) } : {}),
      outOfRange: xs.filter(m => classifyMeasurement(m)).length,
    }];
  });
  return { stats, rows };
};

/** The report's "Measurements" section (stat boxes + table). ▲/▼ mark out-of-range readings. */
export const renderMeasurementsHtml = (s: MeasurementSummary): string => {
  const loc = getLocale() === 'tr' ? 'tr-TR' : 'en-GB';
  const e = escapeHTML;
  const v = (type: MeasurementType, a: Agg, k: keyof Agg, dia?: Agg) => formatMeasurementValue({ type, value: a[k], diastolic: dia?.[k] }, loc);
  const boxes = s.stats.map(st => `<div class="stat">
      <div class="k">${e(t(`measurements.type_${st.type}`))} · ${e(t('measurements.report_count', { count: st.count }))}</div>
      <div class="v">${e(v(st.type, st.value, 'avg', st.diastolic))} ${e(UNITS[st.type])}</div>
      <div class="k">${e(t('measurements.report_min'))} ${e(v(st.type, st.value, 'min', st.diastolic))} · ${e(t('measurements.report_max'))} ${e(v(st.type, st.value, 'max', st.diastolic))}</div>
      ${st.type !== 'weight' ? `<div class="k">${e(t('measurements.report_out', { count: st.outOfRange }))}</div>` : ''}
    </div>`).join('');
  const rows = s.rows.map(m => {
    const d = new Date(m.timestamp);
    const flag = classifyMeasurement(m);
    const extra = [m.context ? t(`measurements.ctx_${m.context}`) : '', m.pulse ? t('measurements.pulse_value', { value: m.pulse }) : ''].filter(Boolean).join(', ');
    return `<tr>
      <td class="nw">${e(d.toLocaleDateString(loc, { day: '2-digit', month: '2-digit', year: 'numeric' }))} ${e(formatLocalTime(d))}</td>
      <td>${e(t(`measurements.type_${m.type}`))}${extra ? `<div class="note">${e(extra)}</div>` : ''}</td>
      <td class="n"><b>${e(formatMeasurementValue(m, loc))}</b> ${e(UNITS[m.type])}${flag === 'high' ? ' ▲' : flag === 'low' ? ' ▼' : ''}</td>
      <td>${e(m.note)}</td>
    </tr>`;
  }).join('');
  const b = RANGES.bp, g = RANGES.glucose;
  return `<h2>${e(t('measurements.title'))}</h2>
  <div class="stats">${boxes}</div>
  <table class="days" style="margin-top:3mm">
    <thead><tr><th>${e(t('export.col_date'))}</th><th>${e(t('measurements.report_col_type'))}</th><th class="n">${e(t('measurements.report_col_value'))}</th><th>${e(t('measurements.report_col_note'))}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="hint">${e(t('measurements.report_legend', { bpHigh: `${b.highSys}/${b.highDia}`, bpLow: `${b.lowSys}/${b.lowDia}`, fasting: g.fastingHigh, other: g.otherHigh, low: g.low }))}</p>`;
};
