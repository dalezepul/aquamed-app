import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firebase, ACCOUNT_KEY } from './firebase';
import { storageService, DATA_VERSION } from './storageService';
import { parseBackup, BackupFile } from './exportService';
import { recordError } from './crash';

/**
 * Cloud backup for signed-in (e-mail / Google) accounts. Firestore (see app/firestore.rules):
 *   users/{uid}              { updatedAt, device, appVersion, bytes, parts }
 *   users/{uid}/backup/{i}   { data: string }   i = 0..parts-1, joined = the same JSON as a backup file
 * Medication photos are local files and are not uploaded.
 */

/** Firestore documents are capped at 1 MiB; leave room for the field name and overhead. */
export const PART_BYTES = 900 * 1024;
/** Firestore batches are capped at 10 MiB per request. */
const PARTS_PER_BATCH = 10;
const LAST_KEY = 'aquamed.cloudBackup'; // not '@aquamed…': must survive a restore and stay out of the backup
const DEBOUNCE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CloudMeta { updatedAt: number; device: string; appVersion: string; bytes: number; parts: number }

// --- Pure -----------------------------------------------------------------------------

const cpBytes = (cp: number) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

export const utf8Length = (s: string) => {
  let n = 0;
  for (const ch of s) n += cpBytes(ch.codePointAt(0)!);
  return n;
};

/** Splits text into pieces of at most `max` UTF-8 bytes, never inside a character. '' → []. */
export const splitUtf8 = (text: string, max = PART_BYTES): string[] => {
  const out: string[] = [];
  let start = 0, i = 0, bytes = 0;
  for (const ch of text) {
    const b = cpBytes(ch.codePointAt(0)!);
    if (bytes + b > max) { out.push(text.slice(start, i)); start = i; bytes = 0; }
    bytes += b;
    i += ch.length;
  }
  if (i > start) out.push(text.slice(start));
  return out;
};

export const joinParts = (parts: string[]) => parts.join('');

/**
 * May an automatic backup overwrite the cloud copy? Only when the cloud still holds what this phone
 * last wrote or restored (`lastSynced` = that meta's updatedAt) and this phone's data isn't much smaller.
 * Otherwise (new phone that declined the restore, another device wrote since, or local data shrank)
 * the user has to choose on the Account screen; an explicit "use this phone" is a manual backup.
 */
export const autoBackupAllowed = (cloud: Pick<CloudMeta, 'updatedAt' | 'bytes'> | null, lastSynced: number | null, localBytes: number): boolean =>
  !cloud || (cloud.updatedAt === lastSynced && localBytes >= cloud.bytes / 2); // ponytail: 50% shrink heuristic

// --- Firebase -------------------------------------------------------------------------

async function signedInUid(): Promise<string> {
  const { auth } = firebase();
  await auth.authStateReady();
  const u = auth.currentUser;
  if (!u || u.isAnonymous) throw new Error('not_signed_in');
  return u.uid;
}

const deviceLabel = () => {
  const model = (Platform as any).constants?.Model as string | undefined;
  return model ? `${Platform.OS} · ${model}` : Platform.OS;
};

export async function getCloudMeta(): Promise<CloudMeta | null> {
  const uid = await signedInUid();
  const { db, fs } = firebase();
  const snap = await fs.getDoc(fs.doc(db, 'users', uid));
  const m = snap.data() as CloudMeta | undefined;
  return m && m.parts > 0 ? m : null;
}

let running: Promise<CloudMeta | null> | null = null;

const backupText = async () => JSON.stringify({ app: 'AquaMed', dataVersion: DATA_VERSION, exportedAt: new Date().toISOString(), data: await storageService.exportAllData() } as BackupFile);

/**
 * Uploads all app data now. Parts first, meta last: a reader never sees a meta pointing at missing parts.
 * `auto`: skipped (null) when `autoBackupAllowed` says the cloud copy must not be overwritten silently.
 */
export function backupNow(opts: { auto?: boolean } = {}): Promise<CloudMeta | null> {
  running ??= (async () => {
    const uid = await signedInUid();
    const { db, fs } = firebase();
    const text = await backupText();
    const metaRef = fs.doc(db, 'users', uid);
    const old = (await fs.getDoc(metaRef)).data() as CloudMeta | undefined;
    if (opts.auto && !autoBackupAllowed(old && old.parts > 0 ? old : null, await lastBackupAt(), utf8Length(text))) return null;
    const parts = splitUtf8(text);
    const oldParts = Number(old?.parts) || 0;
    const partRef = (i: number) => fs.doc(db, 'users', uid, 'backup', String(i));
    // ponytail: >10 parts (~9 MB) go in several batches, so a crash mid-way can leave mixed parts until the next backup.
    for (let from = 0; from < parts.length; from += PARTS_PER_BATCH) {
      const b = fs.writeBatch(db);
      parts.slice(from, from + PARTS_PER_BATCH).forEach((data, k) => b.set(partRef(from + k), { data }));
      await b.commit();
    }
    const meta: CloudMeta = { updatedAt: Date.now(), device: deviceLabel(), appVersion: Constants.expoConfig?.version ?? '', bytes: utf8Length(text), parts: parts.length };
    const b = fs.writeBatch(db);
    b.set(metaRef, meta);
    for (let i = parts.length; i < oldParts; i++) b.delete(partRef(i));
    await b.commit();
    await AsyncStorage.setItem(LAST_KEY, String(meta.updatedAt));
    return meta;
  })().finally(() => { running = null; });
  return running;
}

/** Downloads the cloud backup, validates it like a backup file and replaces local data. */
export async function restoreFromCloud(): Promise<void> {
  const meta = await getCloudMeta();
  if (!meta) throw new Error('no_backup');
  const uid = await signedInUid();
  const { db, fs } = firebase();
  const snaps = await Promise.all(Array.from({ length: meta.parts }, (_, i) => fs.getDoc(fs.doc(db, 'users', uid, 'backup', String(i)))));
  const text = joinParts(snaps.map(s => String(s.data()?.data ?? '')));
  if (utf8Length(text) !== meta.bytes) throw new Error('backup_incomplete');
  await storageService.importAllData(parseBackup(text).data);
  await AsyncStorage.setItem(LAST_KEY, String(meta.updatedAt));
}

/** Deletes users/{uid} and its parts (account deletion). */
export async function deleteCloudBackup(): Promise<void> {
  const uid = await signedInUid();
  const { db, fs } = firebase();
  const parts = await fs.getDocs(fs.collection(db, 'users', uid, 'backup'));
  const b = fs.writeBatch(db);
  parts.forEach(d => b.delete(d.ref));
  b.delete(fs.doc(db, 'users', uid));
  await b.commit();
  await AsyncStorage.removeItem(LAST_KEY);
}

/** Cloud backup the user still has to decide about (restore it or keep this phone's data), or null. */
export async function pendingCloudChoice(): Promise<CloudMeta | null> {
  const meta = await getCloudMeta();
  return meta && !autoBackupAllowed(meta, await lastBackupAt(), utf8Length(await backupText())) ? meta : null;
}

export async function lastBackupAt(): Promise<number | null> {
  const v = await AsyncStorage.getItem(LAST_KEY).catch(() => null);
  return v ? Number(v) : null;
}
export const forgetLastBackup = () => AsyncStorage.removeItem(LAST_KEY).catch(() => {});

// --- Automatic ------------------------------------------------------------------------

const hasAccount = async () => !!(await AsyncStorage.getItem(ACCOUNT_KEY).catch(() => null));

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

/**
 * Called on every data change (AppContext). First call (app start): back up soon if the last
 * backup is over a day old. Later calls: back up 5 minutes after the last change.
 * No-op without an e-mail/Google account (Firebase isn't even loaded). Never overwrites a cloud copy
 * the user hasn't chosen over this phone's data (see `autoBackupAllowed`).
 */
export function scheduleCloudBackup() {
  const run = async () => {
    try {
      if (!(await hasAccount())) return;
      await backupNow({ auto: true });
    } catch (e) { console.warn('[cloudBackup] auto', e); recordError(e, 'backup.auto'); }
  };
  if (!started) {
    started = true;
    (async () => {
      if (!(await hasAccount())) return;
      const last = await lastBackupAt();
      if (!last || Date.now() - last > DAY_MS) timer ??= setTimeout(() => { timer = null; run(); }, 15000);
    })();
    return;
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; run(); }, DEBOUNCE_MS);
}
