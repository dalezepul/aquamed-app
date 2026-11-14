export enum Priority {
  Low = 'Low',
  Medium = 'Medium',
  High = 'High',
}

export enum MedicationStatus {
  Taken = 'Taken',
  Missed = 'Missed',
  Skipped = 'Skipped',
}

/** Which days a medication is due. Cycle/interval counting starts at `Medication.startDate`. */
export type MedSchedule =
  | { type: 'daily' }
  | { type: 'weekly'; daysOfWeek: number[] }        // 0 = Sunday … 6 = Saturday
  | { type: 'interval'; everyDays: number }          // every N days
  | { type: 'cyclic'; activeDays: number; offDays: number };

export type FoodTiming = 'any' | 'empty' | 'before' | 'with' | 'after';

export interface MedicationStock {
  remaining: number;
  total: number;
  perDose: number; // units consumed per taken dose
  boxSize?: number; // units in one box ("+1 kutu"); asked on first use, then remembered
}

export interface Medication {
  id: string;
  name: string;
  dosage?: string;          // e.g. "500 mg", "1 tablet" — display text; built from the fields below when they are set
  doseAmount?: number;      // e.g. 1, 0.5
  doseUnit?: string;        // DoseUnit from utils/dose ("tablet", "ml", "other"…)
  strength?: string;        // strength on the box, e.g. "500 mg"
  notes?: string;           // free text: instructions, side effects…
  times: string[];          // HH:mm, sorted, unique — one dose per entry per due day
  startDate: string;        // YYYY-MM-DD (local)
  endDate: string | null;   // YYYY-MM-DD inclusive, null = ongoing
  schedule: MedSchedule;
  foodTiming: FoodTiming;
  photoUri?: string;
  priority: Priority;
  isPaused: boolean;
  stock?: MedicationStock;  // undefined = stock not tracked
  createdAt: string;        // ISO
}

export enum BeverageType {
  Water = 'Water',
  Tea = 'Tea',
  Coffee = 'Coffee',
  Soda = 'Soda',
}

export interface WaterLog {
  id: string;
  amountMl: number;
  hydrationAmountMl: number;
  beverageType: BeverageType;
  timestamp: string; // ISO
}

/** One log per scheduled dose (medicationId + scheduledDate + scheduledTime). */
export interface MedicationLog {
  id: string;
  medicationId: string;
  medicationName?: string; // kept so history survives deletion
  dosage?: string;
  status: MedicationStatus;
  timestamp: string;       // ISO — when the user acted
  scheduledDate: string;   // YYYY-MM-DD the dose belongs to
  scheduledTime: string;   // HH:mm
}

export const doseKey = (medicationId: string, date: string, time: string) => `${medicationId}|${date}|${time}`;
export const logKey = (log: MedicationLog) => doseKey(log.medicationId, log.scheduledDate, log.scheduledTime);

/** A dose of a medication due on a given day, with its log if the user acted on it. */
export interface Dose {
  medication: Medication;
  date: string;
  time: string;
  key: string;
  log?: MedicationLog;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  nameKey: string;
  descKey: string;
  icon: string;
  earned: boolean;
}

// --- Measurements (blood pressure / glucose / weight) --------------------------------

export type MeasurementType = 'bp' | 'glucose' | 'weight';
export type GlucoseContext = 'fasting' | 'postMeal' | 'random';

/** One reading. `value` = systolic mmHg (bp) · mg/dL (glucose) · kg (weight). Not shared with caregivers. */
export interface Measurement {
  id: string;
  type: MeasurementType;
  timestamp: string; // ISO
  value: number;
  diastolic?: number; // bp
  pulse?: number;     // bp, optional
  context?: GlucoseContext; // glucose
  note?: string;
}
