import React, { useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, Platform, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import Constants from 'expo-constants';

import { useAppContext } from '../state/AppContext';
import { useTheme, SPACING, PALETTE_IDS } from '../constants/theme';
import { t } from '../localization/i18n';
import { ScreenWrapper } from '../components/common/ScreenWrapper';
import { Typography } from '../components/common/Typography';
import { AppSettings, fluidCeiling, displayModeOf, displayModePatch, DisplayMode } from '../services/storageService';
import { CONTACT_ALERT_ENABLED } from '../utils/contactAlert';
import { ScreenHeader } from '../components/common/ScreenHeader';
import { SelectionModal } from '../components/common/SelectionModal';
import { Switch } from '../components/common/Switch';
import { LogHistoryModal } from '../components/common/LogHistoryModal';
import { SettingsSection, SettingsRow } from '../components/common/SettingsList';
import { notify } from '../utils/confirm';
import { resolveHapticLevel } from '../utils/haptics';
import { canScheduleExactAlarms, openExactAlarmSettings } from '../../modules/exact-alarm';
import { usePlus } from '../services/entitlement';
import { maybeShowInterstitial } from '../services/ads';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

const SettingsScreen: React.FC<any> = ({ navigation }) => {
  const { COLORS } = useTheme();
  const { locale, themeMode, waterGoal, emergencyContact, sleepSettings, isDevMode, showDynamicGoalButtons, appSettings, dispatch, refreshAppData } = useAppContext();
  const plus = usePlus();

  const [activeModal, setActiveModal] = useState<'language' | 'theme' | 'palette' | 'display' | null>(null);
  const [devClickCount, setDevClickCount] = useState(0);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  const setSettings = (patch: Partial<AppSettings>) =>
    dispatch({ type: 'SET_VALUE', key: 'appSettings', payload: { ...appSettings, ...patch } });

  const handleDevClick = () => {
    if (isDevMode) return navigation.navigate('DevTools');
    const next = devClickCount + 1;
    setDevClickCount(next);
    if (next === 7) {
      dispatch({ type: 'SET_VALUE', key: 'isDevMode', payload: true });
      notify(t('settings.dev_mode_title'), t('settings.dev_mode_activated'));
    }
  };

  // Re-read on every render: returning from system settings refreshes the context, which re-renders us.
  const exactOk = canScheduleExactAlarms();

  return (
    <ScreenWrapper>
      <Animated.View style={styles.flex1} entering={FadeIn.duration(300)}>
        <ScreenHeader title={t('tabs.settings')} />
        <ScrollView contentContainerStyle={styles.content}>
          <SettingsSection title={t('account.section_account')}>
            <SettingsRow icon="person-circle-outline" title={t('account.title')} subtitle={t('account.settings_subtitle')} onPress={() => navigation.navigate('Account')} />
          </SettingsSection>

          <SettingsSection title={t('settings.section_subscription')}>
            <SettingsRow
              icon="sparkles"
              title="AquaMed Plus"
              subtitle={plus ? t('paywall.active_title') : t('paywall.settings_teaser')}
              onPress={() => navigation.navigate('Paywall')}
            />
          </SettingsSection>

          <SettingsSection title={t('settings.section_general')}>
            <SettingsRow icon="language" title={t('settings.language')} value={locale === 'en' ? 'English' : 'Türkçe'} onPress={() => setActiveModal('language')} />
            <SettingsRow icon="contrast-outline" tint={COLORS.secondary} title={t('settings.theme')} value={t(`settings.theme_${themeMode}`)} onPress={() => setActiveModal('theme')} />
            <SettingsRow icon="brush" tint={COLORS.secondary} title={t('settings.palette')} value={t(`theme_palette.${appSettings.palette}`)} onPress={() => setActiveModal('palette')} />
            <SettingsRow
              icon="text"
              title={t('settings.display_mode')}
              subtitle={t(`settings.display_${displayModeOf(appSettings)}_desc`)}
              value={t(`settings.display_${displayModeOf(appSettings)}`)}
              onPress={() => setActiveModal('display')}
            />
            <SettingsRow
              icon="phone-portrait-outline" tint={COLORS.secondary}
              title={t('settings.haptics')}
              subtitle={t('settings.haptics_desc')}
              value={t(`settings.haptic_${resolveHapticLevel(appSettings)}`)}
              onPress={() => navigation.navigate('HapticsSettings')}
            />
          </SettingsSection>

          <SettingsSection title={t('settings.section_tracking')}>
            <SettingsRow
              icon="notifications-outline" tint={COLORS.accent}
              title={t('settings.reminders')}
              subtitle={t(`settings.reminder_${appSettings.waterReminder.mode}`)}
              onPress={() => navigation.navigate('RemindersSettings')}
            />
            {Platform.OS === 'android' && !exactOk && (
              // Without "Alarms & reminders" access Android delivers reminders up to an hour late.
              <SettingsRow
                icon="alarm-outline" tint={COLORS.warning}
                title={t('settings.exact_alarm_late')}
                subtitle={t('settings.exact_alarm_late_desc')}
                right={<Ionicons name="open-outline" size={18} color={COLORS.textSecondary} />}
                onPress={() => openExactAlarmSettings() || Linking.openSettings()}
              />
            )}
            <SettingsRow
              icon="moon-outline" tint={COLORS.secondary}
              title={t('settings.sleep_hours')}
              subtitle={sleepSettings.enabled ? `${sleepSettings.start} – ${sleepSettings.end}` : t('settings.reminder_off')}
              onPress={() => navigation.navigate('SleepSettings')}
            />
            <SettingsRow
              icon="water" tint={COLORS.success}
              title={t('settings.goal_and_limit')}
              subtitle={t('settings.goal_summary', { goal: waterGoal, limit: fluidCeiling(appSettings) })}
              onPress={() => navigation.navigate('WaterGoalSettings')}
            />
            <SettingsRow
              icon="options-outline" tint={COLORS.success}
              title={t('settings.dynamic_goals')}
              subtitle={t('settings.dynamic_goals_desc_short')}
              right={<Switch value={showDynamicGoalButtons} accessibilityLabel={t('settings.dynamic_goals')} onValueChange={v => dispatch({ type: 'SET_VALUE', key: 'showDynamicGoalButtons', payload: v })} />}
            />
            <SettingsRow icon="time" tint={COLORS.accent} title={t('settings.log_history')} subtitle={t('settings.log_history_desc')} onPress={() => setShowHistoryModal(true)} />
          </SettingsSection>

          <SettingsSection title={t('settings.section_safety')}>
            {CONTACT_ALERT_ENABLED && (
              <SettingsRow
                icon="call-outline" tint={COLORS.error}
                title={t('settings.emergency_and_escalation')}
                subtitle={emergencyContact.name || t('settings.contact_none')}
                onPress={() => navigation.navigate('EmergencySettings')}
              />
            )}
            <SettingsRow
              icon="people-outline" tint={COLORS.accent}
              title={t('pairing.title')}
              subtitle={t('pairing.settings_subtitle')}
              onPress={() => navigation.navigate('Caregivers')}
            />
          </SettingsSection>

          <SettingsSection title={t('settings.section_data')}>
            <SettingsRow
              icon="shield-checkmark-outline" tint={COLORS.textSecondary}
              title={t('settings.data_privacy')}
              subtitle={t('settings.data_privacy_desc')}
              onPress={() => navigation.navigate('DataPrivacy')}
            />
          </SettingsSection>

          {isDevMode && (
            <SettingsSection title={t('settings.section_developer')}>
              <SettingsRow icon="bug" title={t('settings.dev_options')} onPress={() => navigation.navigate('DevTools')} />
            </SettingsSection>
          )}

          <Typography variant="caption" color={COLORS.textSecondary} style={styles.disclaimer}>{t('settings.medical_disclaimer')}</Typography>

          <TouchableOpacity onPress={handleDevClick} style={styles.footer} accessibilityRole="text">
            <Typography variant="caption" color={COLORS.textSecondary} style={styles.versionText}>
              AquaMed v{APP_VERSION}{devClickCount > 2 && !isDevMode ? ` (${7 - devClickCount})` : ''}
            </Typography>
          </TouchableOpacity>
        </ScrollView>
      </Animated.View>

      <SelectionModal
        isVisible={activeModal === 'language'}
        onClose={() => setActiveModal(null)}
        title={t('settings.language')}
        selectedValue={locale}
        onSelect={val => dispatch({ type: 'SET_VALUE', key: 'locale', payload: val })}
        options={[{ label: 'Türkçe', value: 'tr', icon: 'flag' }, { label: 'English', value: 'en', icon: 'flag' }]}
      />
      <SelectionModal
        isVisible={activeModal === 'theme'}
        onClose={() => setActiveModal(null)}
        title={t('settings.theme')}
        selectedValue={themeMode}
        onSelect={val => dispatch({ type: 'SET_VALUE', key: 'themeMode', payload: val })}
        options={[{ label: t('settings.theme_light'), value: 'light', icon: 'sunny' }, { label: t('settings.theme_dark'), value: 'dark', icon: 'moon' }, { label: t('settings.theme_system'), value: 'system', icon: 'settings' }]}
      />
      <SelectionModal
        isVisible={activeModal === 'palette'}
        onClose={() => setActiveModal(null)}
        title={t('settings.palette')}
        selectedValue={appSettings.palette}
        onSelect={val => setSettings({ palette: val as AppSettings['palette'] })}
        options={PALETTE_IDS.map(id => ({ label: t(`theme_palette.${id}`), value: id, icon: 'color-palette' as const }))}
      />
      <SelectionModal
        isVisible={activeModal === 'display'}
        onClose={() => setActiveModal(null)}
        title={t('settings.display_mode')}
        selectedValue={displayModeOf(appSettings)}
        onSelect={val => setSettings(displayModePatch(val as DisplayMode))}
        options={(['normal', 'simple', 'large'] as const).map(m => ({ label: t(`settings.display_${m}`), value: m, icon: m === 'normal' ? 'phone-portrait-outline' as const : m === 'simple' ? 'grid-outline' as const : 'text' as const }))}
      />
      <LogHistoryModal visible={showHistoryModal} onClose={() => { setShowHistoryModal(false); maybeShowInterstitial('log_history_close'); }} onLogDeleted={() => refreshAppData()} />
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  content: { padding: SPACING.md, paddingBottom: 60 },
  flex1: { flex: 1 },
  disclaimer: { textAlign: 'center', marginTop: SPACING.sm, marginHorizontal: SPACING.md },
  footer: { marginTop: 24, alignItems: 'center', paddingVertical: 12 },
  versionText: { letterSpacing: 1 },
});

export default SettingsScreen;
