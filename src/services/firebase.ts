import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

/** Shared Firebase setup (pairing.ts, account.ts, cloudBackup.ts). Config: app.json `extra.firebase`. */
interface FirebaseExtra { apiKey?: string; authDomain?: string; projectId?: string; appId?: string; messagingSenderId?: string; storageBucket?: string; emulatorHost?: string; googleWebClientId?: string }
export const firebaseConfig = ((Constants.expoConfig?.extra as any)?.firebase ?? {}) as FirebaseExtra;

/** False until app.json `extra.firebase` is filled in; the UI then shows "not set up yet". */
export const isFirebaseConfigured = () => !!(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

export type FS = typeof import('firebase/firestore');
export type AU = typeof import('firebase/auth');
let fb: { auth: Auth; db: Firestore; fs: FS; au: AU; signIn: (a: Auth) => Promise<unknown>; deleteUser: AU['deleteUser'] } | null = null;

// Required lazily so the SDK never loads (or runs) for users who don't use pairing or an account.
export function firebase() {
  if (fb) return fb;
  if (!isFirebaseConfigured()) throw new Error('not_configured');
  const { initializeApp } = require('firebase/app') as typeof import('firebase/app');
  const au = require('firebase/auth') as AU & { getReactNativePersistence?: (s: unknown) => any };
  const fs = require('firebase/firestore') as FS;
  const { emulatorHost, googleWebClientId: _g, ...options } = firebaseConfig;
  const app = initializeApp(options);
  // On native, Metro resolves @firebase/auth's react-native build, which exports getReactNativePersistence: keeps the uid across launches.
  const auth = Platform.OS !== 'web' && au.getReactNativePersistence
    ? au.initializeAuth(app, { persistence: au.getReactNativePersistence(AsyncStorage) })
    : au.getAuth(app);
  const db = fs.getFirestore(app);
  if (emulatorHost) {
    au.connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
    fs.connectFirestoreEmulator(db, emulatorHost, 8080);
  }
  fb = { auth, db, fs, au, signIn: au.signInAnonymously, deleteUser: au.deleteUser };
  return fb;
}

/** Local mirror of the signed-in e-mail/Google account ({ kind, email }); absent = anonymous. Not '@aquamed…': survives restores, never backed up. */
export const ACCOUNT_KEY = 'aquamed.account';
