import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAppContext } from '../../state/AppContext';
import { useTheme, SPACING } from '../../constants/theme';
import { t } from '../../localization/i18n';
import { ScreenWrapper } from '../../components/common/ScreenWrapper';
import { ScreenHeader } from '../../components/common/ScreenHeader';
import { Typography } from '../../components/common/Typography';
import { Input } from '../../components/common/Input';
import { Switch } from '../../components/common/Switch';
import { Segmented } from '../../components/common/Segmented';
import { SettingsSection, SettingsRow } from '../../components/common/SettingsList';
import { AppSettings } from '../../services/storageService';
import { notificationService } from '../../services/notificationService';
import { useToast } from '../../hooks/useToast';
import { canScheduleExactAlarms, openExactAlarmSettings } from '../../../modules/exact-alarm';

const INTERVAL_CHOICES = [60, 90, 120, 180, 240];
const RANDOM_CHOICES = [2, 3, 4, 5, 6, 8];
const DRINK_CHOICES = [200, 250, 330, 500];

const RemindersSettingsScreen: React.FC<any> = ({ navigation }) => {
  const { COLORS } = useTheme();
  const { sleepSettings, appSettings, dispatch } = useAppContext();
  const { showToast } = useToast();
  const [drinkDraft, setDrinkDraft] = useState(String(appSettings.waterReminder.drinkAmountMl));
  const [messageDraft, setMessageDraft] = useState(appSettings.waterReminder.message);

  const setSettings = (patch: Partial<AppSettings>) =>
    dispatch({ type: 'SET_VALUE', key: 'appSettings', payload: { ...appSettings, ...patch } });

  const setReminderMode = async (mode: AppSettings['waterReminder']['mode']) => {
    if (mode !== 'off' && !(await notificationService.ensurePermissions())) {
      showToast({ message: t('settings.notifications_denied'), type: 'warning' });
    }
    setSettings({ waterReminder: { ...appSettings.waterReminder, mode } });
  };

  const saveDrinkAmount = (raw: string) => {
    const ml = parseInt(raw, 10);
    if (isNaN(ml) || ml < 50 || ml > 1000) {
      setDrinkDraft(String(appSettings.waterReminder.drinkAmountMl));
      showToast({ message: t('settings.drink_amount_invalid'), type: 'error' });
      return;
    }
    setDrinkDraft(String(ml));
    if (ml !== appSettings.waterReminder.drinkAmountMl) setSettings({ waterReminder: { ...appSettings.waterReminder, drinkAmountMl: ml } });
  };

  const saveMessage = () => {
    const message = messageDraft.trim();
    setMessageDraft(message);
    if (message !== appSettings.waterReminder.message) setSettings({ waterReminder: { ...appSettings.waterReminder, message } });
  };

  const wr = appSettings.waterReminder;
  // Re-read on every render: returning from system settings refreshes the context, which re-renders us.
  const exactOk = canScheduleExactAlarms();

  return (
    <ScreenWrapper>
      <ScreenHeader title={t('settings.reminders')} onBackPress={() => navigation.goBack()} />
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <SettingsSection title={t('settings.section_reminder_mode')}>
            <View style={styles.block}>
              <Typography variant="caption" color={COLORS.textSecondary} style={styles.desc}>{t('settings.water_reminders_desc_short')}</Typography>
              <Segmented
                label={t('settings.water_reminders')}
                value={wr.mode}
                onChange={setReminderMode}
                options={[
                  { value: 'interval', label: t('settings.reminder_interval') },
                  { value: 'random', label: t('settings.reminder_random') },
                  { value: 'off', label: t('settings.reminder_off') },
                ]}
              />
              {wr.mode === 'interval' && (
                <>
                  <Typography variant="caption" color={COLORS.textSecondary} style={styles.label}>{t('settings.reminder_every')}</Typography>
                  <Segmented
                    label={t('settings.reminder_every')}
                    value={wr.intervalMinutes}
                    onChange={v => setSettings({ waterReminder: { ...wr, intervalMinutes: v } })}
                    options={INTERVAL_CHOICES.map(m => ({ value: m, label: m % 60 ? t('settings.hours_minutes', { h: Math.floor(m / 60), m: m % 60 }) : t('settings.hours', { h: m / 60 }) }))}
                  />
                </>
              )}
              {wr.mode === 'random' && (
                <>
                  <Typography variant="caption" color={COLORS.textSecondary} style={styles.label}>{t('settings.reminder_random_count')}</Typography>
                  <Segmented
                    label={t('settings.reminder_random_count')}
                    value={wr.randomCount}
                    onChange={v => setSettings({ waterReminder: { ...wr, randomCount: v } })}
                    options={RANDOM_CHOICES.map(n => ({ value: n, label: String(n) }))}
                  />
                </>
              )}
              {wr.mode !== 'off' && (
                <Typography variant="caption" color={COLORS.textSecondary} style={styles.label}>
                  {sleepSettings.enabled ? t('settings.reminder_awake_hours', { start: sleepSettings.end, end: sleepSettings.start }) : t('settings.reminder_default_hours')}
                </Typography>
              )}
            </View>
            <SettingsRow
              icon="flame-outline" tint={COLORS.accent}
              title={t('settings.evening_nudge')}
              subtitle={t('settings.evening_nudge_desc', { time: appSettings.eveningNudge.time })}
              right={<Switch value={appSettings.eveningNudge.enabled} accessibilityLabel={t('settings.evening_nudge')} onValueChange={enabled => setSettings({ eveningNudge: { ...appSettings.eveningNudge, enabled } })} />}
            />
          </SettingsSection>

          <SettingsSection title={t('settings.notif_custom')}>
            <View style={styles.block}>
              <Typography variant="caption" color={COLORS.textSecondary} style={styles.desc}>{t('settings.drink_amount_desc')}</Typography>
              <Input
                label={t('settings.drink_amount')}
                keyboardType="numeric"
                maxLength={4}
                value={drinkDraft}
                onChangeText={setDrinkDraft}
                onEndEditing={e => saveDrinkAmount(e.nativeEvent.text)}
              />
              <Segmented
                label={t('settings.drink_amount')}
                value={wr.drinkAmountMl}
                onChange={ml => saveDrinkAmount(String(ml))}
                options={DRINK_CHOICES.map(ml => ({ value: ml, label: String(ml) }))}
              />
              <Input
                label={t('settings.notif_message')}
                placeholder={t('notifications.water_body_generic')}
                maxLength={80}
                value={messageDraft}
                onChangeText={setMessageDraft}
                onEndEditing={saveMessage}
                returnKeyType="done"
                containerStyle={{ marginTop: SPACING.md }}
              />
            </View>
          </SettingsSection>

          {Platform.OS === 'android' && !exactOk && (
            // Without "Alarms & reminders" access Android delivers reminders up to an hour late.
            <SettingsSection title={t('settings.section_permission')}>
              <SettingsRow
                icon="alarm-outline" tint={COLORS.warning}
                title={t('settings.exact_alarm_late')}
                subtitle={t('settings.exact_alarm_late_desc')}
                right={<Ionicons name="open-outline" size={18} color={COLORS.textSecondary} />}
                onPress={() => openExactAlarmSettings() || Linking.openSettings()}
              />
            </SettingsSection>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  content: { padding: SPACING.md, paddingBottom: 60 },
  block: { paddingVertical: 8 },
  desc: { marginBottom: 12 },
  label: { marginTop: 12, marginBottom: 6 },
  flex1: { flex: 1 },
});

export default RemindersSettingsScreen;
