import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { storageService, DATA_VERSION } from './storageService';
import { buildDoctorReport, renderDoctorReportHtml, escapeHTML, summarizeMeasurements } from './doctorReport';
import { notify } from '../utils/confirm';
import { MedicationStatus, WaterLog, MedicationLog } from '../types/models';
import { getLocalDayString, formatLocalTime, addDays } from '../utils/DateUtils';
import { t } from '../localization/i18n';

interface LogEntry {
  timestamp: string;
  category: string;
  item: string;
  value: string;
}

const statusLabel = (status?: MedicationStatus) =>
  status ? t(`common.${status.toLowerCase()}`) : t('common.unknown');

/** Last 7 calendar days including today, oldest first. */
const collectLast7Days = async (now: Date): Promise<LogEntry[]> => {
  const start = new Date(now);
  start.setDate(now.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  const { waterLogs, medLogs } = await storageService.getHistory(start.toISOString());
  return [
    ...waterLogs.map((log: WaterLog) => ({
      timestamp: log.timestamp,
      category: t('export.category_water'),
      item: log.beverageType ? t(`beverages.${log.beverageType}`) : t('export.category_water'),
      value: `${log.hydrationAmountMl ?? log.amountMl ?? 0}ml`,
    })),
    ...medLogs.map((log: MedicationLog) => ({
      timestamp: log.timestamp,
      category: t('export.category_medication'),
      item: log.medicationName || t('history.unknown_medication'),
      value: statusLabel(log.status),
    })),
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
};

/** Quote a CSV cell; a leading = + - @ is neutralised so spreadsheets don't run user text as a formula. */
export const escapeCsvValue = (val: string | number | undefined | null) => {
  let str = String(val ?? '');
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
  return `"${str.replace(/"/g, '""')}"`;
};

/** Writes text to a fresh file in the cache directory and returns its uri. */
export const writeCacheFile = (fileName: string, content: string): string => {
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  return file.uri;
};

export const shareFile = async (uri: string, mimeType: string, dialogTitle: string, UTI: string) => {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType, dialogTitle, UTI });
  } else {
    notify(t('export.share_unavailable_title'), t('export.share_unavailable_desc'));
  }
};

class ExportService {
  /** Last 7 days as CSV, then the share sheet. */
  async exportLast7Days(): Promise<void> {
    try {
      const now = new Date();
      const rows = await collectLast7Days(now);
      const header = [t('export.col_date'), t('export.col_time'), t('export.col_category'), t('export.col_item'), t('export.col_value')];
      const lines = [header.map(escapeCsvValue).join(',')];
      rows.forEach(log => {
        const d = new Date(log.timestamp);
        lines.push([getLocalDayString(d), formatLocalTime(d), log.category, log.item, log.value].map(escapeCsvValue).join(','));
      });
      // BOM so Excel detects UTF-8 (Turkish characters)
      const uri = writeCacheFile(`AquaMed_Report_${getLocalDayString(now)}.csv`, '﻿' + lines.join('\r\n') + '\r\n');
      await shareFile(uri, 'text/csv', t('export.share_title'), 'public.comma-separated-values-text');
    } catch (error) {
      console.error('Error exporting CSV data:', error);
      notify(t('export.export_failed_title'), t('export.export_failed_csv'));
    }
  }

  /** Last 7 days as a PDF table, then the share sheet. */
  async exportPDFReport(): Promise<void> {
    try {
      const now = new Date();
      const rows = await collectLast7Days(now);
      const tableRows = rows.length === 0
        ? `<tr><td colspan="5" style="text-align: center;">${t('export.no_data')}</td></tr>`
        : rows.map(log => {
            const d = new Date(log.timestamp);
            return `<tr><td>${escapeHTML(getLocalDayString(d))}</td><td>${escapeHTML(formatLocalTime(d))}</td><td>${escapeHTML(log.category)}</td><td>${escapeHTML(log.item)}</td><td>${escapeHTML(log.value)}</td></tr>`;
          }).join('');

      const html = `
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0">
            <style>
              body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 20px; color: #333; -webkit-print-color-adjust: exact; }
              h1 { text-align: center; color: #0284c7; }
              p { text-align: center; color: #666; font-size: 14px; margin-bottom: 30px; }
              table { width: 100%; border-collapse: collapse; margin-top: 20px; }
              th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
              th { background-color: #f0f9ff; color: #0284c7; font-weight: bold; }
              tr:nth-child(even) { background-color: #f9fafb; }
            </style>
          </head>
          <body>
            <h1>${t('export.report_title')}</h1>
            <p>${t('export.generated_on', { date: getLocalDayString(now) })}</p>
            <table>
              <thead><tr>
                <th>${t('export.col_date')}</th><th>${t('export.col_time')}</th><th>${t('export.col_category')}</th><th>${t('export.col_item')}</th><th>${t('export.col_value')}</th>
              </tr></thead>
              <tbody>${tableRows}</tbody>
            </table>
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html });
      await shareFile(uri, 'application/pdf', t('export.share_pdf_title'), 'com.adobe.pdf');
    } catch (error) {
      console.error('Error generating PDF report:', error);
      notify(t('export.export_failed_title'), t('export.export_failed_pdf'));
    }
  }

  /** Plus: 30/90-day adherence + fluid report for the doctor, as a printable PDF. */
  async exportDoctorReport(days: 30 | 90): Promise<void> {
    try {
      const now = new Date();
      const to = getLocalDayString(now);
      const from = addDays(to, -(days - 1));
      const [meds, { waterLogs, medLogs }, waterGoal, goalHistory, settings, userName, metrics, measurements] = await Promise.all([
        storageService.getMedications(),
        storageService.getHistory(new Date(from + 'T00:00:00').toISOString()),
        storageService.getWaterGoal(),
        storageService.getWaterGoalHistory(),
        storageService.getAppSettings(),
        storageService.getUserName(),
        storageService.getUserMetrics(),
        storageService.getMeasurements(),
      ]);
      const report = buildDoctorReport({ meds, medLogs, waterLogs, waterGoal, goalHistory, fluidLimitMl: settings.fluidLimitMl }, from, to, now);
      const html = renderDoctorReportHtml(report, { userName, metrics, generatedAt: now }, summarizeMeasurements(measurements, from, to) ?? undefined);
      const { uri } = await Print.printToFileAsync({ html });
      await shareFile(uri, 'application/pdf', t('doctor_report.share_title'), 'com.adobe.pdf');
    } catch (error) {
      console.error('Error generating doctor report:', error);
      notify(t('export.export_failed_title'), t('export.export_failed_pdf'));
    }
  }
}

export const exportService = new ExportService();

// --- Full backup (JSON) -------------------------------------------------------

const BACKUP_APP_ID = 'AquaMed';

export interface BackupFile {
  app: typeof BACKUP_APP_ID;
  dataVersion: number;
  exportedAt: string;
  data: Record<string, string>;
}

/** Parse and sanity-check a backup file's text. Throws with a user-facing reason. */
export const parseBackup = (text: string): BackupFile => {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(t('backup.error_not_json'));
  }
  if (parsed?.app !== BACKUP_APP_ID || typeof parsed.data !== 'object' || parsed.data === null) {
    throw new Error(t('backup.error_not_aquamed'));
  }
  if (Number(parsed.dataVersion) > DATA_VERSION) throw new Error(t('backup.error_newer_version'));
  return parsed as BackupFile;
};

export const backupService = {
  /** Writes every AquaMed key to a JSON file and opens the share sheet (save to Drive, e-mail, …). */
  async exportBackup(): Promise<void> {
    const now = new Date();
    const backup: BackupFile = { app: BACKUP_APP_ID, dataVersion: DATA_VERSION, exportedAt: now.toISOString(), data: await storageService.exportAllData() };
    const uri = writeCacheFile(`AquaMed_Yedek_${getLocalDayString(now)}.json`, JSON.stringify(backup));
    await shareFile(uri, 'application/json', t('backup.share_title'), 'public.json');
  },

  /** Lets the user pick a backup file. Returns null if cancelled. Does not import yet. */
  async pickBackup(): Promise<BackupFile | null> {
    const res: any = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/plain', '*/*'] } as any);
    if (!res || res.canceled) return null;
    const file: File = res.result ?? res;
    return parseBackup(await file.text());
  },

  async restore(backup: BackupFile): Promise<void> {
    await storageService.importAllData(backup.data);
  },
};
