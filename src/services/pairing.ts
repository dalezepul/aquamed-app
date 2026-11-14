import { Platform } from 'react-native';
import { firebase, isFirebaseConfigured } from './firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Medication, MedicationLog, MedicationStatus, Dose, BeverageType } from '../types/models';
import { getLocalDayString, addDays } from '../utils/DateUtils';
import { getDosesForDate, doseDateTime } from '../utils/ScheduleUtils';
import { t } from '../localization/i18n';
import { storageService, newId } from './storageService';
import { notificationService } from './notificationService';
import { getPushToken, sendPush, PushMessage } from './push';
import { dynamicGoalService } from './dynamicGoalService';
import { CARE_WIDGET_KEY, CareSnapshot } from '../widgets/care';
import { refreshWidgets } from '../widgets';
import * as Notifications from 'expo-notifications';
import { CareCommand, DoseCommand, WaterCommand, commandsToApply } from './careMode';
import { isPlusNow, refreshEntitlement } from './entitlement';

/**
 * Caregiver pairing: an adult child (caregiver) follows a parent's (patient's) doses.
 * Firestore model (see app/firestore.rules):
 *   pairInvites/{code}          { patientUid, patientName, expiresAt, used, patientPlus, usedBy? }
 *   pairs/{patientUid_caregiverUid} { patientUid, caregiverUid, patientName, caregiverName, shareWater, createdAt, inviteCode, pushTokens: { caregiver, headless? },
 *                                     plusBy, patientPlus, caregiverPlus }  (either side's Plus keeps the pair running)
 *   pairs/{id}/schedule/current { doses: SharedDose[], water: { date, ml, goal } | null, updatedAt }
 *   pairs/{id}/events/{type_doseRef} { type, medId, medName, dose, date, time, scheduledAt, at }
 *   pairs/{id}/commands/{auto}  caregiver -> patient: { type: 'dose', medId, date, time, status } | { type: 'water', ml }, + by, at (careMode.ts)
 * The top half of this file is pure logic (tested); the rest are thin Firebase wrappers.
 */

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CAREGIVERS = 3;
/** Patient side reports a dose as 'late' this long after it; also the caregiver's default alarm delay. */
export const LATE_MINUTES = 30;
/** Caregiver's choices for their local "not taken yet" alarm delay (getLateMinutes). */
export const LATE_CHOICES = [15, 30, 60] as const;
/** Caregiver-side local alarms kept pending (patient planner gets the rest of the 60). */
export const CARE_ALARM_MAX = 20;
export const SCHEDULE_DAYS = 8; // today + 7
const DAY_MS = 24 * 60 * 60 * 1000;

export type PairEventType = 'taken' | 'skipped' | 'late';

export interface Pair {
  id: string;
  patientUid: string;
  caregiverUid: string;
  patientName: string;
  caregiverName: string;
  shareWater: boolean;
  createdAt: number;
  /** headless: the caregiver's app handles data-only pushes in the background (Android); see careTask.ts. */
  pushTokens?: { caregiver?: string | null; headless?: boolean };
  /** Patient's token: a caregiver's command wakes the patient's background task (applyPendingCommands). */
  patientPush?: { token?: string | null; headless?: boolean };
  /** Whose Plus opened the pair; each side keeps its own flag current (syncPlusFlag). Missing on pre-Plus-gate pairs. */
  plusBy?: PlusBy;
  patientPlus?: boolean;
  caregiverPlus?: boolean;
}

export type PlusBy = 'patient' | 'caregiver';

export interface SharedDose { medId: string; name: string; dose: string; date: string; time: string; at: number }
export interface SharedSchedule { doses: SharedDose[]; water: { date: string; ml: number; goal: number } | null; updatedAt: number }
export interface PairEvent { id?: string; type: PairEventType; medId: string; medName: string; dose: string; date: string; time: string; scheduledAt: number; at: number }

// --- Pure logic ---------------------------------------------------------------

// 8 digits: 10^8 codes in a 10-minute window can't be brute-forced (the rules have no rate limit on the Spark plan).
export const CODE_DIGITS = 8;
export const generateCode = (rand: () => number = Math.random) =>
  String(Math.floor(rand() * 1e8) % 1e8).padStart(CODE_DIGITS, '0');
export const isValidCode = (code: string) => /^\d{8}$/.test(code);
/** "1234 5678": easier to read out over the phone. */
export const formatCode = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;
export const inviteUsable = (inv: { used: boolean; expiresAt: number }, now: number) => !inv.used && inv.expiresAt > now;
/** A pair works while either side has Plus; null = neither, no pairing. The patient's Plus wins (caregiver's stays free). */
export const pairPlusBy = (patientPlus: boolean, caregiverPlus: boolean): PlusBy | null =>
  patientPlus ? 'patient' : caregiverPlus ? 'caregiver' : null;
/**
 * Paused (kept, but no pushes/alarms/commands) once neither side has Plus. Old pairs lack the flags:
 * their patient needed Plus to make the code, so a missing patientPlus counts as true until the patient's app writes it.
 */
export const pairPlusActive = (p: Pick<Pair, 'patientPlus' | 'caregiverPlus'>) => p.patientPlus !== false || p.caregiverPlus === true;

/** Web page that opens the app (aquamed://pair?code=…) or the Play Store; the WhatsApp share carries it. */
export const INVITE_URL = 'https://dalezepul.github.io/aquamed-gizlilik/davet/';
export const inviteLink = (code: string) => `${INVITE_URL}?kod=${code}`;
export const inviteMessage = (code: string) => t('pairing.share_message', { link: inviteLink(code), code: formatCode(code) });
/**
 * Code from an invite link: aquamed[-test]://pair?code=12345678 (also the bare "pair?code=…" path and the
 * web page's …/davet/?kod=…). Null for anything else, so other deep links pass through.
 */
export const parsePairLink = (url: string | null | undefined): string | null => {
  if (!url || !/(^|[/:])(pair|davet)\/?(\?|$)/.test(url)) return null;
  const m = /[?&](?:code|kod)=([^&#]*)/.exec(url);
  const code = (m?.[1] ?? '').replace(/%20|\+|\s/g, '');
  return isValidCode(code) ? code : null;
};

/** Stable id of one dose (safe as a Firestore doc id / notification id part). */
export const doseRef = (medId: string, date: string, time: string) => `${medId}_${date}_${time.replace(':', '')}`;

/** Every scheduled dose from today for `days` days, as shared with caregivers. */
export const buildSharedDoses = (meds: Medication[], now: Date, days = SCHEDULE_DAYS): SharedDose[] => {
  const today = getLocalDayString(now);
  const out: SharedDose[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    for (const d of getDosesForDate(meds, [], date)) {
      out.push({ medId: d.medication.id, name: d.medication.name, dose: d.medication.dosage ?? '', date, time: d.time, at: doseDateTime(date, d.time).getTime() });
    }
  }
  return out;
};

/**
 * Taken/skipped logs of the last 24 hours as events. Re-sent (only-new) on every publish, so a report
 * lost offline (Firestore's queue lives in memory on RN) still reaches the caregiver and cancels the alarm.
 */
export const recentReports = (logs: MedicationLog[], now: Date): Omit<PairEvent, 'id' | 'at'>[] =>
  logs
    .filter(l => l.status === MedicationStatus.Taken || l.status === MedicationStatus.Skipped)
    .map(l => ({ l, at: doseDateTime(l.scheduledDate, l.scheduledTime).getTime() }))
    .filter(({ at }) => Math.abs(now.getTime() - at) <= DAY_MS)
    .map(({ l, at }) => ({
      type: l.status === MedicationStatus.Taken ? 'taken' as const : 'skipped' as const,
      medId: l.medicationId, medName: l.medicationName ?? '', dose: l.dosage ?? '',
      date: l.scheduledDate, time: l.scheduledTime, scheduledAt: at,
    }));

/** Unlogged doses that are at least `lateMin` overdue, from the last 24 hours. */
export const lateDoses = (meds: Medication[], logs: MedicationLog[], now: Date, lateMin = LATE_MINUTES): Dose[] => {
  const today = getLocalDayString(now);
  const n = now.getTime();
  return [addDays(today, -1), today]
    .flatMap(date => getDosesForDate(meds, logs, date))
    .filter(d => {
      const at = doseDateTime(d.date, d.time).getTime();
      return !d.log && at <= n - lateMin * 60000 && at > n - DAY_MS;
    });
};

/** Notification text for an event, in this device's language. */
export const eventMessage = (ev: Pick<PairEvent, 'type' | 'medName' | 'dose' | 'time'>, patientName: string, lateMin = LATE_MINUTES) => {
  const name = patientName || t('pairing.unnamed_patient');
  const body = t('pairing.push_dose_body', { med: ev.medName, dose: ev.dose || t('notifications.med_default_dose') });
  switch (ev.type) {
    case 'taken': return { title: t('pairing.push_taken_title', { name, time: ev.time }), body };
    case 'skipped': return { title: t('pairing.push_skipped_title', { name, time: ev.time }), body };
    case 'late': return { title: t('pairing.push_late_title', { name, time: ev.time, min: lateMin }), body };
  }
};

/** Caregiver's own local alarm id for one dose (cancelled when the patient reports it). */
export const careAlarmId = (pairId: string, medId: string, date: string, time: string) => `care_${pairId}_${doseRef(medId, date, time)}`;

/** Local nickname ("Annem") the caregiver gave a followed patient, else their own name. */
export const displayName = (pair: Pick<Pair, 'id' | 'patientName'>, nicknames: Record<string, string>) =>
  nicknames[pair.id]?.trim() || pair.patientName || t('pairing.unnamed_patient');

/** Data of a data-only "care_event" push (patient -> caregiver). */
export interface CareEventData { type: 'care_event'; pairId: string; status: PairEventType; medId: string; medName: string; dose: string; date: string; time: string; patientName: string }

/**
 * Pulls a CareEventData out of a background-task payload. Android (expo-notifications 57) hands the
 * Expo push `data` as JSON in `data.dataString`; other shapes carry it as an object. Tolerant on purpose.
 */
export const parseCareEvent = (payload: unknown): CareEventData | null => {
  const walk = (v: unknown, depth: number): CareEventData | null => {
    if (depth > 5 || v == null) return null;
    if (typeof v === 'string') {
      if (!v.includes('care_event')) return null;
      try { return walk(JSON.parse(v), depth + 1); } catch { return null; }
    }
    if (typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (o.type === 'care_event' && typeof o.pairId === 'string' && typeof o.medId === 'string'
      && typeof o.date === 'string' && typeof o.time === 'string' && ['taken', 'skipped', 'late'].includes(o.status as string)) {
      return { medName: '', dose: '', patientName: '', ...o } as unknown as CareEventData;
    }
    for (const k of ['data', 'dataString', 'body', 'notification', 'request', 'content']) {
      const r = walk(o[k], depth + 1);
      if (r) return r;
    }
    return null;
  };
  return walk(payload, 0);
};

export interface CareAlarm { id: string; at: Date; title: string; body: string; data: { type: 'care_late'; pairId: string } }

/**
 * Caregiver side: one local alarm per upcoming dose, `lateMin` after it, unless the
 * patient already took/skipped it. Nearest `max` only.
 */
export const planCaregiverAlarms = (
  pairs: { pair: Pair; doses: SharedDose[]; handled: Set<string> }[],
  now: number,
  max = CARE_ALARM_MAX,
  lateMin: number = LATE_MINUTES,
): CareAlarm[] => {
  const out: CareAlarm[] = [];
  for (const { pair, doses, handled } of pairs) {
    for (const d of doses) {
      const at = d.at + lateMin * 60000;
      const ref = doseRef(d.medId, d.date, d.time);
      if (at <= now || handled.has(ref)) continue;
      out.push({ id: careAlarmId(pair.id, d.medId, d.date, d.time), at: new Date(at), ...eventMessage({ type: 'late', medName: d.name, dose: d.dose, time: d.time }, pair.patientName, lateMin), data: { type: 'care_late', pairId: pair.id } });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, max);
};

// --- Firebase ----------------------------------------------------------------

/** False until app.json `extra.firebase` is filled in; the UI then shows "not set up yet". */
export const isPairingConfigured = isFirebaseConfigured;

async function myUid(): Promise<string> {
  const { auth, signIn } = firebase();
  await auth.authStateReady();
  if (!auth.currentUser) {
    await signIn(auth);
    // A server-side account now exists (even just from opening the screen): "delete my data" must remove it.
    await markActive();
  }
  return auth.currentUser!.uid;
}

// Set once the user creates an invite or joins; until then nothing talks to Firebase in the background.
const ACTIVE_KEY = '@aquamed_pairing_active';
let active: boolean | null = null;
const isActive = async () => {
  if (!isFirebaseConfigured()) return false;
  if (active === null) active = (await AsyncStorage.getItem(ACTIVE_KEY).catch(() => null)) === '1';
  return active;
};
export const isPairingActive = () => isActive();
const markActive = async () => { active = true; await AsyncStorage.setItem(ACTIVE_KEY, '1'); };

// Caregiver-only nicknames, never uploaded: { [pairId]: "Annem" }.
const NICK_KEY = '@aquamed_pair_nicknames';
export async function getNicknames(): Promise<Record<string, string>> {
  try { return JSON.parse((await AsyncStorage.getItem(NICK_KEY)) || '{}') ?? {}; } catch { return {}; }
}
export async function setNickname(pairId: string, name: string): Promise<void> {
  const all = await getNicknames();
  const v = name.trim().slice(0, 40);
  if (v) all[pairId] = v; else delete all[pairId];
  await AsyncStorage.setItem(NICK_KEY, JSON.stringify(all));
  requestAlarmSync();
}

// Caregiver-only: minutes after a dose until the local "not taken" alarm (LATE_CHOICES), one for all followed patients.
const LATE_KEY = '@aquamed_pair_late_minutes';
export async function getLateMinutes(): Promise<number> {
  const v = Number(await AsyncStorage.getItem(LATE_KEY).catch(() => null));
  return (LATE_CHOICES as readonly number[]).includes(v) ? v : LATE_MINUTES;
}
export async function setLateMinutes(min: number): Promise<void> {
  await AsyncStorage.setItem(LATE_KEY, String(min));
  requestAlarmSync();
}

/** The patient's last invite code: deleted before a new one is made, so only one code is live at a time. */
const INVITE_KEY = '@aquamed_pair_last_invite';

/** Whether this device runs the background push task (careTask.ts). iOS needs headless-notification setup first. */
const HEADLESS = Platform.OS === 'android';

const toPair = (d: { id: string; data: () => any }): Pair => ({ id: d.id, ...d.data() });

/** This user's Plus, confirmed with the store when it reads false (isPlusNow() is false until refreshEntitlement ran: launch, background task). Null = unknown. */
const ownPlus = async (): Promise<boolean | null> => isPlusNow() || await refreshEntitlement().catch(() => null);

/**
 * Writes this side's Plus flag on its pairs when it changed; returns the pairs as they now are.
 * ponytail: client-reported, no server check (Spark plan, no functions); a tampered client can keep a pair running. Verify receipts server-side if that matters.
 */
async function syncPlusFlag(pairs: Pair[], field: 'patientPlus' | 'caregiverPlus'): Promise<Pair[]> {
  if (!pairs.some(p => p[field] !== isPlusNow())) return pairs;
  const plus = await ownPlus();
  if (plus === null) return pairs; // store unreachable: keep the last known state rather than pause
  const { db, fs } = firebase();
  return Promise.all(pairs.map(async p => {
    if (p[field] === plus) return p;
    await fs.updateDoc(fs.doc(db, 'pairs', p.id), { [field]: plus }).catch(e => console.warn('[pairing] plus flag', e));
    return { ...p, [field]: plus };
  }));
}

async function pairsAs(role: 'patient' | 'caregiver'): Promise<Pair[]> {
  const uid = await myUid();
  const { db, fs } = firebase();
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'pairs'), fs.where(role === 'patient' ? 'patientUid' : 'caregiverUid', '==', uid)));
  return snap.docs.map(toPair);
}

/**
 * Deletes this user's invite docs: every one of them (expired/used too) via the "list own invites"
 * rule, and in any case the last code we stored (covers the rule not being published yet).
 * permission-denied = already gone (rules can't read a missing doc's owner) or rule not live: fine.
 */
async function deleteMyInvites(uid: string): Promise<void> {
  const { db, fs } = firebase();
  const gone = (e: any) => { if (e?.code !== 'permission-denied') throw e; };
  const prev = await AsyncStorage.getItem(INVITE_KEY).catch(() => null);
  if (prev) await fs.deleteDoc(fs.doc(db, 'pairInvites', prev)).catch(gone);
  const mine = await fs.getDocs(fs.query(fs.collection(db, 'pairInvites'), fs.where('patientUid', '==', uid))).catch(e => { gone(e); return null; });
  await Promise.all((mine?.docs ?? []).map(d => fs.deleteDoc(d.ref)));
  await AsyncStorage.removeItem(INVITE_KEY);
}

/** Patient: new one-time code. Throws 'limit' at MAX_CAREGIVERS. */
export async function createInvite(): Promise<{ code: string; expiresAt: number }> {
  const uid = await myUid();
  // (current + 1) > MAX -> no code. ponytail: client-side cap; with one live code at a time a 4th needs a
  // failed delete or a tampered client. Counter doc + rule if it matters.
  if ((await pairsAs('patient')).length + 1 > MAX_CAREGIVERS) throw new Error('limit');
  const { db, fs } = firebase();
  await deleteMyInvites(uid); // one live code at a time; a failure (offline…) throws rather than leave two
  const patientName = (await storageService.getUserName()).trim().slice(0, 60);
  const patientPlus = (await ownPlus()) === true; // anyone may invite; without Plus the caregiver's Plus has to carry the pair
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const expiresAt = Date.now() + CODE_TTL_MS;
    try {
      // An existing code makes this an update, which the rules refuse → try another.
      await fs.setDoc(fs.doc(db, 'pairInvites', code), { patientUid: uid, patientName, expiresAt, used: false, patientPlus });
      await AsyncStorage.setItem(INVITE_KEY, code);
      await markActive();
      return { code, expiresAt };
    } catch (e: any) {
      if (e?.code !== 'permission-denied') throw e;
    }
  }
  throw new Error('failed');
}

/**
 * Caregiver: redeem a code. Throws 'invalid' | 'expired' | 'self' | 'already' | 'plus_required'
 * (neither side has Plus: the error carries `patientName`; the code stays unused, so it works again after buying Plus).
 */
export async function joinWithCode(code: string): Promise<Pair> {
  if (!isValidCode(code)) throw new Error('invalid');
  const uid = await myUid();
  const { db, fs } = firebase();
  const inviteRef = fs.doc(db, 'pairInvites', code);
  const inv = await fs.getDoc(inviteRef);
  if (!inv.exists()) throw new Error('invalid');
  const data = inv.data() as { patientUid: string; patientName: string; expiresAt: number; used: boolean; patientPlus?: boolean };
  if (!inviteUsable(data, Date.now())) throw new Error('expired');
  if (data.patientUid === uid) throw new Error('self');
  const pairRef = fs.doc(db, 'pairs', `${data.patientUid}_${uid}`);
  if ((await fs.getDoc(pairRef).catch(() => null))?.exists()) throw new Error('already');
  const patientPlus = data.patientPlus !== false; // missing: an older app, which only let Plus users invite
  const caregiverPlus = (await ownPlus()) === true;
  const plusBy = pairPlusBy(patientPlus, caregiverPlus);
  if (!plusBy) throw Object.assign(new Error('plus_required'), { patientName: data.patientName });

  const pair: Omit<Pair, 'id'> & { inviteCode: string } = {
    plusBy, patientPlus, caregiverPlus,
    patientUid: data.patientUid,
    caregiverUid: uid,
    patientName: data.patientName,
    caregiverName: (await storageService.getUserName()).trim().slice(0, 60),
    shareWater: false,
    createdAt: Date.now(),
    inviteCode: code,
    pushTokens: { caregiver: await getPushToken(), headless: HEADLESS },
  };
  const batch = fs.writeBatch(db);
  batch.set(pairRef, pair);
  batch.update(inviteRef, { used: true, usedBy: uid });
  await batch.commit();
  await markActive();
  requestAlarmSync();
  return { id: pairRef.id, ...pair };
}

/** Live lists of both roles; returns unsubscribe. */
export function watchPairs(cb: (p: { asPatient: Pair[]; asCaregiver: Pair[] }) => void, onError: (e: unknown) => void): () => void {
  let unsubs: (() => void)[] = [];
  let stopped = false;
  const state = { asPatient: [] as Pair[], asCaregiver: [] as Pair[] };
  myUid().then(uid => {
    if (stopped) return;
    const { db, fs } = firebase();
    // Skip snapshots with unconfirmed local writes: right after joinWithCode the pair exists only
    // locally, and the events/schedule listeners opened for it would be refused (rules read the
    // server's pair doc) and die for good. The confirmed snapshot follows (metadata change).
    const listen = (field: string, key: keyof typeof state) =>
      fs.onSnapshot(fs.query(fs.collection(db, 'pairs'), fs.where(field, '==', uid)), { includeMetadataChanges: true }, s => {
        if (s.metadata.hasPendingWrites) return;
        state[key] = s.docs.map(toPair);
        // The active flag lives in an @aquamed key that "wipe all" / backup restore remove, while the
        // Firebase user (and so these pairs) survives: every background sync/publish then no-ops. Heal it.
        if (s.docs.length && active !== true) {
          markActive().then(() => (key === 'asCaregiver' ? requestAlarmSync(0) : schedulePublish(0))).catch(() => {});
        }
        cb({ ...state });
      }, onError);
    unsubs = [listen('patientUid', 'asPatient'), listen('caregiverUid', 'asCaregiver')];
  }).catch(onError);
  return () => { stopped = true; unsubs.forEach(u => u()); };
}

export function watchEvents(pairId: string, cb: (events: PairEvent[]) => void, max = 20): () => void {
  const { db, fs } = firebase();
  return fs.onSnapshot(
    fs.query(fs.collection(db, 'pairs', pairId, 'events'), fs.orderBy('at', 'desc'), fs.limit(max)),
    s => cb(s.docs.map(d => ({ id: d.id, ...(d.data() as PairEvent) }))),
    e => console.warn('[pairing] events', e),
  );
}

export function watchSchedule(pairId: string, cb: (s: SharedSchedule | null) => void): () => void {
  const { db, fs } = firebase();
  return fs.onSnapshot(fs.doc(db, 'pairs', pairId, 'schedule', 'current'), s => cb(s.exists() ? (s.data() as SharedSchedule) : null), e => console.warn('[pairing] schedule', e));
}

export async function setShareWater(pairs: Pair[], on: boolean): Promise<void> {
  const { db, fs } = firebase();
  await Promise.all(pairs.map(p => fs.updateDoc(fs.doc(db, 'pairs', p.id), { shareWater: on })));
  await publishSchedule();
}

/** Either side: unpair and delete everything shared (children first — rules check the pair doc). */
export async function removePair(pair: Pair): Promise<void> {
  const { db, fs } = firebase();
  const [events, commands] = await Promise.all([
    fs.getDocs(fs.collection(db, 'pairs', pair.id, 'events')),
    fs.getDocs(fs.collection(db, 'pairs', pair.id, 'commands')).catch(() => null), // rule not published yet: nothing there
  ]);
  const batch = fs.writeBatch(db);
  [...events.docs, ...(commands?.docs ?? [])].forEach(d => batch.delete(d.ref));
  batch.delete(fs.doc(db, 'pairs', pair.id, 'schedule', 'current'));
  await batch.commit();
  await fs.deleteDoc(fs.doc(db, 'pairs', pair.id));
  if ((await getNicknames())[pair.id]) await setNickname(pair.id, '');
  requestAlarmSync();
}

// --- Patient side: publish plan, report events ----------------------------------

type NewEvent = Omit<PairEvent, 'id' | 'at'>;

async function writeEvents(evs: NewEvent[], onlyNew: boolean): Promise<void> {
  const pairs = (await pairsAs('patient')).filter(pairPlusActive); // paused (no Plus on either side): no news
  if (!pairs.length || !evs.length) return;
  const { db, fs } = firebase();
  const name = await storageService.getUserName();
  const push: PushMessage[] = [];
  for (const pair of pairs) {
    for (const ev of evs) {
      const ref = fs.doc(db, 'pairs', pair.id, 'events', `${ev.type}_${doseRef(ev.medId, ev.date, ev.time)}`);
      if (onlyNew && (await fs.getDoc(ref)).exists()) continue;
      await fs.setDoc(ref, { ...ev, at: Date.now() });
      const to = pair.pushTokens?.caregiver;
      if (!to) continue;
      if (pair.pushTokens?.headless) {
        // Data-only: the caregiver's background task cancels its local late alarm and shows the
        // notification itself (its own language, its nickname). A title/body would bypass the task.
        const data: CareEventData = { type: 'care_event', pairId: pair.id, status: ev.type, medId: ev.medId, medName: ev.medName, dose: ev.dose, date: ev.date, time: ev.time, patientName: name };
        push.push({ to, data: { ...data }, _contentAvailable: true });
      } else {
        push.push({ to, ...eventMessage(ev, name), data: { type: 'care', pairId: pair.id }, channelId: ev.type === 'taken' ? 'doses_v2' : 'escalation_v2' });
      }
    }
  }
  await sendPush(push);
}

async function clearEvents(ref: string): Promise<void> {
  const pairs = await pairsAs('patient');
  const { db, fs } = firebase();
  await Promise.all(pairs.flatMap(p => (['taken', 'skipped'] as const).map(type => fs.deleteDoc(fs.doc(db, 'pairs', p.id, 'events', `${type}_${ref}`)))));
}

/** storageService hook: every dose status change. */
export async function reportDose(med: Medication, date: string, time: string, status: MedicationStatus | null): Promise<void> {
  if (status === MedicationStatus.Missed || !(await isActive())) return;
  if (!status) { // undone: withdraw the report, so the caregiver's late alarm comes back on its next sync
    await clearEvents(doseRef(med.id, date, time)).catch(e => console.warn('[pairing] undo', e));
    return;
  }
  const scheduledAt = doseDateTime(date, time).getTime();
  if (Math.abs(Date.now() - scheduledAt) > DAY_MS) return; // history edits / dev data aren't news
  await writeEvents([{
    type: status === MedicationStatus.Taken ? 'taken' : 'skipped',
    medId: med.id, medName: med.name, dose: med.dosage ?? '', date, time, scheduledAt,
  }], false).catch(e => console.warn('[pairing] report', e));
}

/** Upload the dose plan (+ water summary if shared) and report newly late doses. */
export async function publishSchedule(): Promise<void> {
  if (!(await isActive())) return;
  const all = await pairsAs('patient');
  if (!all.length) return;
  const pairs = (await syncPlusFlag(all, 'patientPlus')).filter(pairPlusActive);
  if (!pairs.length) return;
  const now = new Date();
  const today = getLocalDayString(now);
  const [meds, logs, ml, goal] = await Promise.all([
    storageService.getMedications(), storageService.getAllMedicationLogs(), storageService.getDailyWater(today), dynamicGoalService.getTodayEffectiveGoal(now),
  ]);
  const { db, fs } = firebase();
  const token = await getPushToken();
  if (token) await Promise.all(pairs.filter(p => p.patientPush?.token !== token || !!p.patientPush?.headless !== HEADLESS)
    .map(p => fs.updateDoc(fs.doc(db, 'pairs', p.id), { patientPush: { token, headless: HEADLESS } }).catch(() => {})));
  const doses = buildSharedDoses(meds, now);
  await Promise.all(pairs.map(p => fs.setDoc(fs.doc(db, 'pairs', p.id, 'schedule', 'current'), {
    doses, water: p.shareWater ? { date: today, ml, goal } : null, updatedAt: Date.now(),
  } satisfies SharedSchedule)));
  await writeEvents(lateDoses(meds, logs, now).map(d => ({
    type: 'late' as const, medId: d.medication.id, medName: d.medication.name, dose: d.medication.dosage ?? '',
    date: d.date, time: d.time, scheduledAt: doseDateTime(d.date, d.time).getTime(),
  })), true);
  const names = new Map(meds.map(m => [m.id, m]));
  await writeEvents(recentReports(logs, now).map(e => ({
    ...e, medName: e.medName || names.get(e.medId)?.name || '', dose: e.dose || names.get(e.medId)?.dosage || '',
  })), true);
}

let publishTimer: ReturnType<typeof setTimeout> | null = null;
/** Debounced publishSchedule (called on every data change). */
export function schedulePublish(delayMs = 3000) {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => { publishSchedule().catch(e => console.warn('[pairing] publish', e)); }, delayMs);
}

// --- Caregiver side: local "not taken" alarms --------------------------------

/** Re-plan local late alarms from every followed patient's plan and events. */
export async function syncCaregiverAlarms(): Promise<void> {
  if (Platform.OS === 'web' || !(await isActive())) return;
  const pairs = await syncPlusFlag(await pairsAs('caregiver'), 'caregiverPlus');
  const { db, fs } = firebase();
  const token = pairs.length ? await getPushToken() : null;
  const [nicks, lateMin] = await Promise.all([getNicknames(), getLateMinutes()]);
  const input = await Promise.all(pairs.map(async pair => {
    if (token && (pair.pushTokens?.caregiver !== token || !!pair.pushTokens?.headless !== HEADLESS)) {
      await fs.updateDoc(fs.doc(db, 'pairs', pair.id), { pushTokens: { caregiver: token, headless: HEADLESS } }).catch(() => {});
    }
    const [sched, events, cmds] = await Promise.all([
      fs.getDoc(fs.doc(db, 'pairs', pair.id, 'schedule', 'current')),
      fs.getDocs(fs.query(fs.collection(db, 'pairs', pair.id, 'events'), fs.orderBy('at', 'desc'), fs.limit(200))),
      fs.getDocs(fs.collection(db, 'pairs', pair.id, 'commands')).catch(() => null),
    ]);
    // A dose this caregiver marked (command not applied yet) needs no alarm either.
    const handled = new Set([
      ...events.docs.map(d => d.data() as PairEvent).filter(e => e.type !== 'late').map(e => doseRef(e.medId, e.date, e.time)),
      ...(cmds?.docs ?? []).map(d => d.data() as CareCommand).flatMap(c => (c.type === 'dose' ? [doseRef(c.medId, c.date, c.time)] : [])),
    ]);
    return { pair: { ...pair, patientName: displayName(pair, nicks) }, doses: sched.exists() ? (sched.data() as SharedSchedule).doses : [], handled, events: events.docs.map(d => d.data() as PairEvent), water: sched.exists() ? (sched.data() as SharedSchedule).water : null };
  }));
  await saveCareWidget(input, lateMin);
  await notificationService.setCareAlarms(planCaregiverAlarms(input.filter(i => pairPlusActive(i.pair)), Date.now(), CARE_ALARM_MAX, lateMin));
}

/** Snapshot for the caregiver ("Takip") home-screen widget; never throws. */
export async function saveCareWidget(input: { pair: Pair; doses: SharedDose[]; events: PairEvent[]; water: SharedSchedule['water'] }[], lateMin: number): Promise<void> {
  try {
    const snap: CareSnapshot = { lateMin, patients: input.map(i => ({ name: i.pair.patientName, doses: i.doses, events: i.events.slice(0, 20), water: i.water })) };
    await AsyncStorage.setItem(CARE_WIDGET_KEY, JSON.stringify(snap));
    await refreshWidgets();
  } catch (e) { console.warn('[pairing] care widget', e); }
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
export function requestAlarmSync(delayMs = 1000) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncCaregiverAlarms().catch(e => console.warn('[pairing] sync', e)); }, delayMs);
}

/**
 * "Delete my data": leave every pair (both roles), delete own invites, cancel caregiver alarms,
 * forget local pairing state and delete the anonymous Firebase user. Never throws; network
 * failures are logged and the rest continues. No-op (Firebase not even loaded) if pairing was never used.
 */
export async function wipePairingData(): Promise<void> {
  if (!(await isActive())) return;
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { console.warn(`[pairing] wipe ${label}`, e); }
  };
  let uid: string | null = null;
  await step('auth', async () => { uid = await myUid(); });
  if (uid) {
    const pairs: Pair[] = [];
    await step('list', async () => { pairs.push(...await pairsAs('patient'), ...await pairsAs('caregiver')); });
    for (const p of pairs) await step('pair', () => removePair(p));
    await step('invites', () => deleteMyInvites(uid!));
  }
  await step('alarms', () => notificationService.setCareAlarms([]));
  active = false;
  await step('local', () => AsyncStorage.multiRemove([ACTIVE_KEY, NICK_KEY, INVITE_KEY, LATE_KEY, CARE_WIDGET_KEY]));
  await step('user', async () => {
    const { auth, deleteUser } = firebase();
    if (auth.currentUser) await deleteUser(auth.currentUser);
  });
}

// --- Caregiver marks on the patient's behalf (commands) ----------------------------

/** Caregiver: "Aldı"/"Atladı"/"Su ekle". Wakes the patient's phone (data-only push) when it can handle it closed. */
export async function sendCommand(pair: Pair, cmd: DoseCommand | WaterCommand): Promise<void> {
  if (!pairPlusActive(pair)) throw new Error('paused');
  const by = await myUid();
  const { db, fs } = firebase();
  const write = fs.addDoc(fs.collection(db, 'pairs', pair.id, 'commands'), { ...cmd, by, at: Date.now() });
  requestAlarmSync(300); // the local write is already in the cache: the dose's late alarm goes now
  await write;
  const to = pair.patientPush?.token;
  if (to && pair.patientPush?.headless) await sendPush([{ to, data: { type: 'care_cmd', pairId: pair.id }, _contentAvailable: true }]);
}

/** Caregiver: take back a mark the patient's phone hasn't applied yet. */
export async function cancelCommand(pairId: string, cmdId: string): Promise<void> {
  const { db, fs } = firebase();
  await fs.deleteDoc(fs.doc(db, 'pairs', pairId, 'commands', cmdId));
  requestAlarmSync(300);
}

/** Caregiver: this pair's unapplied commands, live (includes local, not yet uploaded writes). */
export function watchCommands(pairId: string, cb: (c: CareCommand[]) => void): () => void {
  const { db, fs } = firebase();
  return fs.onSnapshot(fs.collection(db, 'pairs', pairId, 'commands'),
    s => cb(s.docs.map(d => ({ ...(d.data() as CareCommand), id: d.id }))),
    e => { console.warn('[pairing] commands', e); cb([]); });
}

let applying: Promise<number> = Promise.resolve(0);
/**
 * Patient: apply caregivers' commands to the local store, then delete them. Serialized; returns how many
 * changed something. Deleted before applying: a crash in between loses a mark rather than doubling water.
 * Server read only, so an offline phone doesn't apply stale cache and hang on the delete.
 */
export function applyPendingCommands(): Promise<number> {
  applying = applying.catch(() => 0).then(applyOnce);
  return applying;
}

async function applyOnce(): Promise<number> {
  if (!(await isActive())) return 0;
  const pairs = await pairsAs('patient');
  const { db, fs } = firebase();
  const notes: { title: string; body: string }[] = [];
  for (const pair of pairs) {
    if (!pairPlusActive(pair)) continue; // paused: the caregiver can't send; leftovers wait for Plus to come back
    const snap = await fs.getDocsFromServer(fs.collection(db, 'pairs', pair.id, 'commands'));
    if (snap.empty) continue;
    const cmds = snap.docs.map(d => ({ ...(d.data() as CareCommand), id: d.id }));
    await Promise.all(snap.docs.map(d => fs.deleteDoc(d.ref)));
    const [meds, logs] = await Promise.all([storageService.getMedications(), storageService.getAllMedicationLogs()]);
    const name = pair.caregiverName || t('pairing.unnamed_caregiver');
    for (const a of commandsToApply(cmds, meds, logs)) {
      if (a.kind === 'dose') {
        // setDoseStatus fires reportDose: the caregiver gets the normal taken/skipped event.
        await storageService.setDoseStatus(a.med, a.date, a.time, a.status === 'taken' ? MedicationStatus.Taken : MedicationStatus.Skipped);
        notes.push({ title: t('care.cmd_notify_title'), body: t(a.status === 'taken' ? 'care.cmd_notify_taken' : 'care.cmd_notify_skipped', { name, time: a.time, med: a.med.name }) });
      } else {
        await storageService.saveWaterLog({ id: newId(), amountMl: a.ml, hydrationAmountMl: a.ml, beverageType: BeverageType.Water, timestamp: new Date().toISOString() });
        notes.push({ title: t('care.cmd_notify_title'), body: t('care.cmd_notify_water', { name, ml: a.ml }) });
      }
    }
  }
  if (!notes.length) return 0;
  await notificationService.rescheduleAll(); // drops the reminder/escalation of a now-handled dose
  await publishSchedule().catch(e => console.warn('[pairing] publish', e));
  refreshWidgets();
  if (Platform.OS !== 'web') {
    for (const n of notes) {
      // No data: tapping just opens the app.
      await Notifications.scheduleNotificationAsync({ content: n, trigger: Platform.OS === 'android' ? { channelId: 'doses_v2' } : null }).catch(() => {});
    }
  }
  return notes.length;
}

/** Patient, app open: apply commands as they arrive. No-op (no Firebase) unless pairing is in use. */
export function watchIncomingCommands(onApplied: () => void): () => void {
  let stopped = false;
  const unsubs: (() => void)[] = [];
  const inner = new Map<string, () => void>();
  const run = () => applyPendingCommands().then(n => { if (n && !stopped) onApplied(); }).catch(e => console.warn('[pairing] apply', e));
  // ponytail: starts only if pairing was already active at mount; a brand-new patient's first commands wait for the next resume/launch.
  isActive().then(async on => {
    if (!on || stopped) return;
    const uid = await myUid();
    if (stopped) return;
    const { db, fs } = firebase();
    unsubs.push(fs.onSnapshot(fs.query(fs.collection(db, 'pairs'), fs.where('patientUid', '==', uid)), s => {
      const ids = new Set(s.docs.map(d => d.id));
      for (const [id, u] of inner) if (!ids.has(id)) { u(); inner.delete(id); }
      for (const id of ids) {
        if (!inner.has(id)) inner.set(id, fs.onSnapshot(fs.collection(db, 'pairs', id, 'commands'), c => { if (!c.empty) run(); }, e => console.warn('[pairing] incoming', e)));
      }
    }, e => console.warn('[pairing] incoming pairs', e)));
  }).catch(e => console.warn('[pairing] incoming', e));
  return () => { stopped = true; unsubs.forEach(u => u()); inner.forEach(u => u()); };
}

/** Once at startup. */
export function initPairing() {
  storageService.onDoseStatus = (med, date, time, status) => { reportDose(med, date, time, status); };
  requestAlarmSync(0);
}
