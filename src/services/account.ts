import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthCredential, User } from 'firebase/auth';
import { firebase, firebaseConfig, isFirebaseConfigured, ACCOUNT_KEY } from './firebase';
import { deleteCloudBackup, forgetLastBackup } from './cloudBackup';
import { wipePairingData } from './pairing';

/**
 * Optional account on top of the anonymous Firebase user (pairing.ts). Signing in links a credential
 * to the anonymous user, so the uid (and every pairing) stays. If the credential already belongs to
 * another account (made on another phone), we switch to that account instead: `switched: true`.
 */
export type AccountKind = 'none' | 'google' | 'email';
export interface AccountState { kind: AccountKind; email: string | null }
export interface SignInResult { switched: boolean }

const NONE: AccountState = { kind: 'none', email: null };

/** Pure: what kind of account a Firebase user is. */
export const accountStateOf = (u: Pick<User, 'isAnonymous' | 'email' | 'providerData'> | null): AccountState => {
  if (!u || u.isAnonymous) return NONE;
  const kind = u.providerData.some(p => p.providerId === 'google.com') ? 'google' : 'email';
  return { kind, email: u.email ?? u.providerData.find(p => p.email)?.email ?? null };
};

/** Pure: Firebase error → i18n key under `account.err_*`. */
export const accountErrorKey = (e: unknown): string => {
  const code = String((e as any)?.code ?? (e as any)?.message ?? '');
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code)) return 'account.err_credentials';
  if (/invalid-email/.test(code)) return 'account.err_email';
  if (/weak-password/.test(code)) return 'account.err_weak_password';
  if (/network/.test(code)) return 'account.err_network';
  if (/too-many-requests/.test(code)) return 'account.err_too_many';
  if (/requires-recent-login/.test(code)) return 'account.err_recent_login';
  if (/operation-not-allowed|not_configured|DEVELOPER_ERROR/.test(code)) return 'account.err_not_configured';
  return 'account.err_generic';
};

export const isAccountConfigured = isFirebaseConfigured;
/** Google needs the web client id in app.json (`extra.firebase.googleWebClientId`) and a native build. */
export const isGoogleAvailable = () => Platform.OS !== 'web' && isFirebaseConfigured() && !!firebaseConfig.googleWebClientId;

/** Local, no Firebase: cheap enough for every render / the auto-backup check. */
export async function getAccount(): Promise<AccountState> {
  try { return { ...NONE, ...JSON.parse((await AsyncStorage.getItem(ACCOUNT_KEY)) || '{}') }; } catch { return NONE; }
}

async function saveState(u: User | null): Promise<AccountState> {
  const s = accountStateOf(u);
  if (s.kind === 'none') await AsyncStorage.removeItem(ACCOUNT_KEY);
  else await AsyncStorage.setItem(ACCOUNT_KEY, JSON.stringify(s));
  return s;
}

async function currentUser(): Promise<User> {
  const { auth, signIn } = firebase();
  await auth.authStateReady();
  if (!auth.currentUser) await signIn(auth);
  return auth.currentUser!;
}

const inUse = (e: unknown) => /credential-already-in-use|email-already-in-use|provider-already-linked/.test(String((e as any)?.code));

/** Link to the anonymous user; if the credential is someone's existing account, sign in to it. */
async function attach(cred: AuthCredential, fromError?: (e: unknown) => AuthCredential | null): Promise<SignInResult> {
  const { auth, au } = firebase();
  const user = await currentUser();
  try {
    if (!user.isAnonymous) throw Object.assign(new Error('already_signed_in'), { code: 'already_signed_in' });
    await au.linkWithCredential(user, cred);
    await user.reload();
    await saveState(auth.currentUser);
    return { switched: false };
  } catch (e) {
    if (!inUse(e)) throw e;
    await au.signInWithCredential(auth, fromError?.(e) ?? cred);
    await forgetLastBackup();
    await saveState(auth.currentUser);
    return { switched: true };
  }
}

// --- Google -----------------------------------------------------------------------------

let googleReady = false;
function google() {
  const mod = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
  if (!googleReady) {
    mod.GoogleSignin.configure({ webClientId: firebaseConfig.googleWebClientId });
    googleReady = true;
  }
  return mod.GoogleSignin;
}

/** Google account picker → idToken. null = user cancelled. */
async function googleIdToken(silent = false): Promise<string | null> {
  const g = google();
  await g.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = silent ? await g.signInSilently() : await g.signIn();
  if (res.type !== 'success') return silent ? googleIdToken(false) : null;
  if (!res.data.idToken) throw Object.assign(new Error('no_id_token'), { code: 'not_configured' });
  return res.data.idToken;
}

/** null when the user closed the Google picker. */
export async function signInWithGoogle(): Promise<SignInResult | null> {
  if (!isGoogleAvailable()) throw Object.assign(new Error('not_configured'), { code: 'not_configured' });
  const { au } = firebase();
  const token = await googleIdToken();
  if (!token) return null;
  return attach(au.GoogleAuthProvider.credential(token), e => au.GoogleAuthProvider.credentialFromError(e as any));
}

// --- E-mail -------------------------------------------------------------------------------

const clean = (email: string) => email.trim().toLowerCase();

/** New account (links to this phone's anonymous user). Existing e-mail + right password → signs in to it. */
export async function signUpWithEmail(email: string, password: string): Promise<SignInResult> {
  const { au } = firebase();
  return attach(au.EmailAuthProvider.credential(clean(email), password));
}

/**
 * Existing account. Not linked, on purpose: a mistyped address would otherwise silently create a new
 * account. Signing in to an existing account always means a different uid anyway.
 */
export async function signInWithEmail(email: string, password: string): Promise<SignInResult> {
  const { auth, au } = firebase();
  const before = (await currentUser()).uid;
  await au.signInWithEmailAndPassword(auth, clean(email), password);
  const switched = auth.currentUser?.uid !== before;
  if (switched) await forgetLastBackup();
  await saveState(auth.currentUser);
  return { switched };
}

export async function resetPassword(email: string): Promise<void> {
  const { auth, au } = firebase();
  await au.sendPasswordResetEmail(auth, clean(email));
}

// --- Sign out / delete ------------------------------------------------------------------------

/** Local data stays on the phone; a fresh anonymous user takes over (pairings stay with the account). */
export async function signOut(): Promise<void> {
  const { auth, au, signIn } = firebase();
  const kind = (await getAccount()).kind;
  await au.signOut(auth);
  if (kind === 'google') await google().signOut().catch(() => {});
  await saveState(null);
  await forgetLastBackup();
  await signIn(auth);
}

/**
 * Firebase only deletes a user who signed in within the last few minutes, so this re-authenticates
 * first (Google: silently when possible; e-mail: needs the password), then deletes the cloud backup,
 * the pairings and the user. Local data stays unless the caller wipes it.
 */
export async function deleteAccount(password?: string): Promise<void> {
  const { auth, au } = firebase();
  const user = await currentUser();
  const { kind, email } = accountStateOf(user);
  if (kind === 'google') {
    const token = await googleIdToken(true);
    if (!token) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    await au.reauthenticateWithCredential(user, au.GoogleAuthProvider.credential(token));
  } else if (kind === 'email') {
    await au.reauthenticateWithCredential(user, au.EmailAuthProvider.credential(email ?? '', password ?? ''));
  }
  if (kind !== 'none') await deleteCloudBackup();
  await wipePairingData(); // deletes the user too when pairing was used
  if (auth.currentUser) await au.deleteUser(auth.currentUser);
  if (kind === 'google') await google().signOut().catch(() => {});
  await saveState(null);
  await forgetLastBackup();
}
