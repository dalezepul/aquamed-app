import { splitUtf8, joinParts, utf8Length, PART_BYTES, autoBackupAllowed } from '../cloudBackup';
import { accountStateOf, accountErrorKey } from '../account';
import { parseBackup } from '../exportService';

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

describe('cloud backup parts', () => {
  it('utf8Length matches Buffer for Turkish letters and emoji', () => {
    const s = 'İlaç şurup ğüöçı ÇĞİÖŞÜ 💧 water';
    expect(utf8Length(s)).toBe(bytes(s));
  });

  it('empty data: no parts, joins back to empty', () => {
    expect(splitUtf8('')).toEqual([]);
    expect(joinParts(splitUtf8(''))).toBe('');
  });

  it('small backup stays one part and round-trips through parseBackup', () => {
    const text = JSON.stringify({ app: 'AquaMed', dataVersion: 1, exportedAt: '2026-01-01T00:00:00Z', data: {} });
    const parts = splitUtf8(text);
    expect(parts).toHaveLength(1);
    expect(parseBackup(joinParts(parts)).data).toEqual({});
  });

  it('never exceeds the byte limit and never cuts a character (Turkish, emoji)', () => {
    const text = 'aşİ💧ğ'.repeat(50);
    for (const max of [4, 5, 7, 10]) {
      const parts = splitUtf8(text, max);
      expect(joinParts(parts)).toBe(text);
      parts.forEach(p => {
        expect(bytes(p)).toBeLessThanOrEqual(max);
        expect(p).toBe(Buffer.from(p, 'utf8').toString('utf8')); // no lone surrogates
      });
    }
  });

  it('multi-part real-size backup: every part under PART_BYTES, round-trips', () => {
    const data: Record<string, string> = {};
    for (let i = 0; i < 3000; i++) data[`@aquamed_k${i}`] = JSON.stringify({ note: 'Günde iki kez, yemekten sonra — İÇ 💊'.repeat(20) });
    const text = JSON.stringify({ app: 'AquaMed', dataVersion: 2, exportedAt: 'x', data });
    const parts = splitUtf8(text);
    expect(parts.length).toBeGreaterThan(2);
    parts.forEach(p => expect(bytes(p)).toBeLessThanOrEqual(PART_BYTES));
    expect(parts.slice(0, -1).every(p => bytes(p) > PART_BYTES - 4)).toBe(true); // parts are filled
    expect(parseBackup(joinParts(parts)).data).toEqual(data);
  });
});

describe('account state', () => {
  const user = (isAnonymous: boolean, providers: string[], email: string | null = null) =>
    ({ isAnonymous, email, providerData: providers.map(providerId => ({ providerId, email })) } as any);

  it('anonymous / missing user is no account', () => {
    expect(accountStateOf(null)).toEqual({ kind: 'none', email: null });
    expect(accountStateOf(user(true, []))).toEqual({ kind: 'none', email: null });
  });
  it('google and e-mail users', () => {
    expect(accountStateOf(user(false, ['google.com'], 'a@b.com'))).toEqual({ kind: 'google', email: 'a@b.com' });
    expect(accountStateOf(user(false, ['password'], 'c@d.com'))).toEqual({ kind: 'email', email: 'c@d.com' });
  });
  it('maps Firebase error codes', () => {
    expect(accountErrorKey({ code: 'auth/invalid-credential' })).toBe('account.err_credentials');
    expect(accountErrorKey({ code: 'auth/weak-password' })).toBe('account.err_weak_password');
    expect(accountErrorKey({ code: 'auth/network-request-failed' })).toBe('account.err_network');
    expect(accountErrorKey({ code: 'auth/requires-recent-login' })).toBe('account.err_recent_login');
    expect(accountErrorKey(new Error('boom'))).toBe('account.err_generic');
  });
});

describe('autoBackupAllowed (a declined restore must not let empty data overwrite the cloud)', () => {
  const cloud = { updatedAt: 1000, bytes: 50_000 };
  it('no cloud backup yet → back up', () => expect(autoBackupAllowed(null, null, 10)).toBe(true));
  it('new phone that never synced (declined / dismissed the restore) → wait', () =>
    expect(autoBackupAllowed(cloud, null, 200)).toBe(false));
  it('another device wrote since this phone last synced → wait', () =>
    expect(autoBackupAllowed(cloud, 900, 60_000)).toBe(false));
  it('cloud holds what this phone wrote → back up, unless local data shrank to under half', () => {
    expect(autoBackupAllowed(cloud, 1000, 48_000)).toBe(true);
    expect(autoBackupAllowed(cloud, 1000, 20_000)).toBe(false);
  });
});
