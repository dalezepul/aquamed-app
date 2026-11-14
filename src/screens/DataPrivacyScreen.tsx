import React, { useState } from 'react';
import { ScrollView, StyleSheet, Platform, Linking, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Directory, Paths } from 'expo-file-system';

import { useAppContext } from '../state/AppContext';
import { useTheme, SPACING } from '../constants/theme';
import { t } from '../localization/i18n';
import { ScreenWrapper } from '../components/common/ScreenWrapper';
import { ScreenHeader } from '../components/common/ScreenHeader';
import { SettingsSection, SettingsRow } from '../components/common/SettingsList';
import { storageService } from '../services/storageService';
import { exportService, backupService } from '../services/exportService';
import { notificationService } from '../services/notificationService';
import { wipePairingData } from '../services/pairing';
import { getAccount } from '../services/account';
import { useToast } from '../hooks/useToast';
import { confirm } from '../utils/confirm';
import { usePlus } from '../services/entitlement';
import { usePrivacyOptionsRequired, showPrivacyOptions } from '../services/ads';
import { Typography } from '../components/common/Typography';

const PRIVACY_URL = 'https://dalezepul.github.io/aquamed-gizlilik/';

const DataPrivacyScreen: React.FC<any> = ({ navigation }) => {
  const { COLORS } = useTheme();
  const { locale, dispatch, refreshAppData } = useAppContext();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const plus = usePlus();
  const adChoicesRequired = usePrivacyOptionsRequired();

  const handleDoctorReport = async (days: 30 | 90) => {
    if (!plus) return navigation.navigate('Paywall');
    setBusy(true);
    try {
      await exportService.exportDoctorReport(days);
    } finally {
      setBusy(false);
    }
  };

  const plusBadge = plus ? undefined : (
    <View style={[styles.plusBadge, { borderColor: COLORS.primary }]}>
      <Typography variant="caption" color={COLORS.primary} style={styles.bold}>Plus</Typography>
    </View>
  );

  const fail = (e: any) => showToast({ message: t('backup.failed', { reason: e?.message ?? '' }), type: 'error' });

  const handleBackup = async () => {
    setBusy(true);
    try {
      await backupService.exportBackup();
    } catch (e: any) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    try {
      const backup = await backupService.pickBackup();
      if (!backup) return;
      const date = new Date(backup.exportedAt).toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-GB');
      if (!(await confirm(t('backup.confirm_title'), t('backup.confirm_body', { date }), t('backup.confirm_yes'), true))) return;
      setBusy(true);
      await backupService.restore(backup);
      await refreshAppData(); // re-reads language, theme, palette, settings, goal from the restored data
      await notificationService.setupCategories(); // action-button labels follow a restored language
      await notificationService.rescheduleAll();
      showToast({ message: t('backup.restored'), type: 'success' });
    } catch (e: any) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAll = async () => {
    // Signed in: the cloud copy (and the account) must go first, or auto-backup would upload the empty app.
    if ((await getAccount()).kind !== 'none') {
      if (await confirm(t('settings.delete_all_title'), t('account.delete_all_signed_in'), t('account.title'))) navigation.navigate('Account');
      return;
    }
    if (!(await confirm(t('settings.delete_all_title'), t('settings.delete_all_body'), t('settings.delete_all_continue'), true))) return;
    if (!(await confirm(t('settings.delete_all_final_title'), t('settings.delete_all_final_body'), t('settings.delete_all_confirm'), true))) return;
    try {
      await notificationService.cancelAll();
      if (Platform.OS !== 'web') {
        const photos = new Directory(Paths.document, 'med-photos');
        if (photos.exists) photos.delete();
      }
      // Server-side pairing data first (needs the local pairing keys); offline must not block the local wipe.
      await wipePairingData().catch(e => console.warn('[privacy] pairing wipe', e));
      await storageService.clearAllAppData();
      dispatch({ type: 'RESET_STATE' }); // back to onboarding
    } catch (e: any) {
      fail(e);
    }
  };

  return (
    <ScreenWrapper>
      <ScreenHeader title={t('settings.data_privacy')} onBackPress={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsSection title={t('privacy.section_backup')}>
          <SettingsRow icon="cloud-upload-outline" title={t('backup.export')} subtitle={t('privacy.backup_export_desc')} onPress={handleBackup} disabled={busy} />
          <SettingsRow icon="cloud-download-outline" title={t('backup.import')} subtitle={t('privacy.backup_import_desc')} onPress={handleRestore} disabled={busy} />
        </SettingsSection>

        <SettingsSection title={t('privacy.section_report')}>
          <SettingsRow icon="document-text-outline" tint={COLORS.success} title={t('settings.export_pdf')} subtitle={t('privacy.pdf_desc')} onPress={() => exportService.exportPDFReport()} disabled={busy} />
          {([30, 90] as const).map(days => (
            <SettingsRow
              key={days}
              icon="medkit-outline" tint={COLORS.success}
              title={t(`privacy.doctor_${days}`)} subtitle={t('privacy.doctor_desc')}
              onPress={() => handleDoctorReport(days)} disabled={busy} right={plusBadge}
              accessibilityLabel={plus ? undefined : `${t(`privacy.doctor_${days}`)}, AquaMed Plus`}
            />
          ))}
          <SettingsRow icon="grid-outline" tint={COLORS.success} title={t('settings.export_csv')} subtitle={t('privacy.csv_desc')} onPress={() => exportService.exportLast7Days()} disabled={busy} />
        </SettingsSection>

        <SettingsSection title={t('privacy.section_privacy')}>
          <SettingsRow
            icon="shield-checkmark-outline" tint={COLORS.textSecondary}
            title={t('privacy.policy')} subtitle={t('privacy.policy_desc')} disabled={busy}
            right={<Ionicons name="open-outline" size={18} color={COLORS.textSecondary} />}
            onPress={() => Linking.openURL(locale === 'en' ? PRIVACY_URL + 'en/' : PRIVACY_URL)}
          />
          {adChoicesRequired && (
            <SettingsRow icon="options-outline" tint={COLORS.textSecondary} title={t('privacy.ad_choices')} subtitle={t('privacy.ad_choices_desc')} onPress={showPrivacyOptions} disabled={busy} />
          )}
        </SettingsSection>

        <SettingsSection title={t('privacy.section_danger')} danger>
          <SettingsRow icon="trash-outline" danger title={t('settings.delete_all')} subtitle={t('privacy.delete_desc')} onPress={handleDeleteAll} />
        </SettingsSection>
      </ScrollView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  content: { padding: SPACING.md, paddingBottom: 60 },
  plusBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  bold: { fontWeight: '700' },
});

export default DataPrivacyScreen;
