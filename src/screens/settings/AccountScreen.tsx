import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native';

import { useAppContext } from '../../state/AppContext';
import { useTheme, SPACING, touchSize } from '../../constants/theme';
import { t } from '../../localization/i18n';
import { ScreenWrapper } from '../../components/common/ScreenWrapper';
import { ScreenHeader } from '../../components/common/ScreenHeader';
import { Typography } from '../../components/common/Typography';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { SettingsSection, SettingsRow } from '../../components/common/SettingsList';
import { useToast } from '../../hooks/useToast';
import { confirm, choose, notify } from '../../utils/confirm';
import { storageService } from '../../services/storageService';
import { notificationService } from '../../services/notificationService';
import { isPairingActive } from '../../services/pairing';
import {
  AccountState, SignInResult, getAccount, accountErrorKey, isAccountConfigured, isGoogleAvailable,
  signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, signOut, deleteAccount,
} from '../../services/account';
import { backupNow, restoreFromCloud, getCloudMeta, lastBackupAt, pendingCloudChoice, CloudMeta } from '../../services/cloudBackup';

type EmailMode = 'signin' | 'signup';

/** Settings → "Account & backup". Optional e-mail / Google account with automatic cloud backup. */
const AccountScreen: React.FC<any> = ({ navigation }) => {
  const { COLORS, isElderly } = useTheme();
  const { locale, refreshAppData } = useAppContext();
  const { showToast } = useToast();
  const [account, setAccount] = useState<AccountState>({ kind: 'none', email: null });
  const [last, setLast] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailMode, setEmailMode] = useState<EmailMode | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [deletePw, setDeletePw] = useState<string | null>(null); // e-mail accounts confirm deletion with their password
  /** Cloud backup waiting for "restore or keep this phone's data" — automatic backup is on hold until then. */
  const [pending, setPending] = useState<CloudMeta | null>(null);

  const reload = useCallback(async () => {
    const acc = await getAccount();
    setAccount(acc);
    setLast(await lastBackupAt());
    setPending(acc.kind === 'none' ? null : await pendingCloudChoice().catch(() => null));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const fmt = (ms: number) => new Date(ms).toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const fail = (e: unknown) => notify(t('account.error_title'), t(accountErrorKey(e)));

  /** Runs one action with the spinner on; errors become a themed message. */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { console.warn('[account]', e); fail(e); } finally { setBusy(false); reload(); }
  };

  const applyRestore = async () => {
    await restoreFromCloud();
    await refreshAppData(); // language, theme, settings, goal from the restored data
    await notificationService.setupCategories();
    await notificationService.rescheduleAll();
    showToast({ message: t('backup.restored'), type: 'success' });
  };

  /** Cloud backup vs. this phone's data, right after signing in. */
  const afterSignIn = async (r: SignInResult) => {
    if (r.switched && (await isPairingActive())) notify(t('account.switched_pairs_title'), t('account.switched_pairs_body'));
    // A read error is not "no backup": throw (shown as an error) rather than overwrite it.
    // Declining / dismissing below writes nothing; the choice card stays until the user decides.
    const meta: CloudMeta | null = await getCloudMeta();
    if (!meta) { await backupNow(); return; }
    const meds = await storageService.getMedications();
    const { waterLogs, medLogs } = await storageService.getHistory();
    const localEmpty = meds.length === 0 && waterLogs.length + medLogs.length < 10;
    const info = t('account.cloud_info', { date: fmt(meta.updatedAt), device: meta.device });
    if (localEmpty) {
      if (await confirm(t('account.restore_q_title'), info, t('account.restore'))) await applyRestore();
      return;
    }
    const pick = await choose(t('account.which_title'), `${info}\n\n${t('account.which_body')}`, [t('account.use_cloud'), t('account.use_phone')]);
    if (pick === 0) await applyRestore();
    else if (pick === 1) await backupNow();
  };

  const handleGoogle = () => run(async () => {
    const r = await signInWithGoogle();
    if (r) await afterSignIn(r);
  });

  const handleEmail = () => run(async () => {
    const r = emailMode === 'signup' ? await signUpWithEmail(email, password) : await signInWithEmail(email, password);
    setPassword('');
    setEmailMode(null);
    await afterSignIn(r);
  });

  const handleReset = () => {
    if (!email.trim()) return notify(t('account.forgot'), t('account.forgot_need_email'));
    run(async () => {
      await resetPassword(email);
      notify(t('account.forgot'), t('account.forgot_sent', { email: email.trim() }));
    });
  };

  const handleKeepPhone = async () => {
    if (!(await confirm(t('account.use_phone'), t('account.keep_phone_body'), t('account.use_phone'), true))) return;
    run(async () => {
      await backupNow();
      showToast({ message: t('account.backed_up'), type: 'success' });
    });
  };

  const handleBackup = () => run(async () => {
    await backupNow();
    showToast({ message: t('account.backed_up'), type: 'success' });
  });

  const handleRestore = async () => {
    if (!(await confirm(t('backup.confirm_title'), t('account.restore_body'), t('backup.confirm_yes'), true))) return;
    run(async () => {
      const meta = await getCloudMeta();
      if (!meta) return notify(t('account.restore'), t('account.no_backup'));
      await applyRestore();
    });
  };

  const handleSignOut = async () => {
    if (!(await confirm(t('account.sign_out'), t('account.sign_out_body'), t('account.sign_out')))) return;
    run(async () => {
      await signOut();
      showToast({ message: t('account.signed_out'), type: 'info' });
    });
  };

  const handleDelete = async () => {
    if (account.kind === 'email' && !deletePw) return notify(t('account.delete'), t('account.delete_need_password'));
    if (!(await confirm(t('account.delete'), t('account.delete_body'), t('settings.delete_all_continue'), true))) return;
    if (!(await confirm(t('account.delete_final_title'), t('account.delete_final_body'), t('account.delete_confirm'), true))) return;
    run(async () => {
      await deleteAccount(deletePw ?? undefined);
      setDeletePw(null);
      showToast({ message: t('account.deleted'), type: 'success' });
    });
  };

  const link = (label: string, onPress: () => void) => (
    <TouchableOpacity onPress={onPress} disabled={busy} style={[styles.link, { minHeight: touchSize(isElderly) }]} accessibilityRole="button">
      <Typography color={COLORS.primary} style={styles.bold}>{label}</Typography>
    </TouchableOpacity>
  );

  const signedOut = (
    <>
      <SettingsSection title={t('account.section_account')}>
        <View style={styles.block}>
          <Typography>{t('account.intro')}</Typography>
          <Typography variant="caption" color={COLORS.textSecondary}>{t('account.photos_note')}</Typography>
          {!isAccountConfigured() ? (
            <Typography variant="caption" color={COLORS.warning}>{t('account.not_configured')}</Typography>
          ) : emailMode ? (
            <>
              <Typography variant="subheader" accessibilityRole="header">{t(emailMode === 'signup' ? 'account.create' : 'account.sign_in')}</Typography>
              <Input label={t('account.email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
              <Input label={t('account.password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete={emailMode === 'signup' ? 'new-password' : 'current-password'} textContentType={emailMode === 'signup' ? 'newPassword' : 'password'} />
              {emailMode === 'signup' && <Typography variant="caption" color={COLORS.textSecondary}>{t('account.password_hint')}</Typography>}
              <Button title={t(emailMode === 'signup' ? 'account.create' : 'account.sign_in')} onPress={handleEmail} loading={busy} disabled={!email.trim() || password.length < 6} />
              {link(t(emailMode === 'signup' ? 'account.have_account' : 'account.no_account'), () => setEmailMode(emailMode === 'signup' ? 'signin' : 'signup'))}
              {emailMode === 'signin' && link(t('account.forgot'), handleReset)}
              {link(t('common.back'), () => setEmailMode(null))}
            </>
          ) : (
            <>
              {isGoogleAvailable() && <Button title={t('account.google')} onPress={handleGoogle} loading={busy} />}
              <Button title={t('account.email_continue')} variant="secondary" onPress={() => setEmailMode('signin')} disabled={busy} />
            </>
          )}
        </View>
      </SettingsSection>
    </>
  );

  const signedIn = (
    <>
      <SettingsSection title={t('account.section_account')}>
        <SettingsRow icon={account.kind === 'google' ? 'logo-google' : 'mail-outline'} title={account.email ?? '—'} subtitle={t(account.kind === 'google' ? 'account.kind_google' : 'account.kind_email')} />
        <SettingsRow icon="log-out-outline" tint={COLORS.textSecondary} title={t('account.sign_out')} subtitle={t('account.sign_out_desc')} onPress={handleSignOut} disabled={busy} />
      </SettingsSection>

      {pending && (
        <SettingsSection title={t('account.choice_title')}>
          <View style={styles.block}>
            <Typography>{t('account.choice_body', { date: fmt(pending.updatedAt), device: pending.device })}</Typography>
            <Button title={t('account.use_cloud')} onPress={() => run(applyRestore)} loading={busy} />
            <Button title={t('account.use_phone')} variant="secondary" onPress={handleKeepPhone} disabled={busy} />
          </View>
        </SettingsSection>
      )}

      <SettingsSection title={t('account.section_backup')}>
        <SettingsRow icon="time-outline" tint={COLORS.success} title={last ? t('account.last_backup', { date: fmt(last) }) : t('account.no_backup_yet')} subtitle={t('account.auto_desc')} />
        <SettingsRow icon="cloud-upload-outline" title={t('account.backup_now')} onPress={handleBackup} disabled={busy} />
        <SettingsRow icon="cloud-download-outline" title={t('account.restore')} subtitle={t('account.restore_desc')} onPress={handleRestore} disabled={busy} />
      </SettingsSection>
      <Typography variant="caption" color={COLORS.textSecondary} style={styles.note}>{t('account.photos_note')}</Typography>

      <SettingsSection title={t('privacy.section_danger')} danger>
        <SettingsRow icon="trash-outline" danger title={t('account.delete')} subtitle={t('account.delete_desc')} onPress={account.kind === 'email' && deletePw === null ? () => setDeletePw('') : handleDelete} disabled={busy} />
        {account.kind === 'email' && deletePw !== null && (
          <View style={styles.block}>
            <Input label={t('account.password')} value={deletePw} onChangeText={setDeletePw} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
            <Button title={t('account.delete')} variant="destructive" onPress={handleDelete} loading={busy} disabled={!deletePw} />
          </View>
        )}
      </SettingsSection>
    </>
  );

  return (
    <ScreenWrapper>
      <ScreenHeader title={t('account.title')} onBackPress={() => navigation.goBack()} />
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {account.kind === 'none' ? signedOut : signedIn}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: SPACING.md, paddingBottom: 60 },
  block: { gap: SPACING.sm, paddingVertical: SPACING.sm },
  link: { justifyContent: 'center', alignItems: 'center' },
  bold: { fontWeight: '700' },
  note: { marginHorizontal: 4, marginTop: -SPACING.sm, marginBottom: SPACING.md },
});

export default AccountScreen;
