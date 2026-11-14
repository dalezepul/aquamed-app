import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';

import { useAppContext } from '../../state/AppContext';
import { useTheme, SPACING } from '../../constants/theme';
import { t } from '../../localization/i18n';
import { ScreenWrapper } from '../../components/common/ScreenWrapper';
import { ScreenHeader } from '../../components/common/ScreenHeader';
import { Typography } from '../../components/common/Typography';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { Switch } from '../../components/common/Switch';
import { Segmented } from '../../components/common/Segmented';
import { SettingsSection, SettingsRow } from '../../components/common/SettingsList';
import { AppSettings, EmergencyContact } from '../../services/storageService';
import { badgeService } from '../../services/badgeService';
import { useToast } from '../../hooks/useToast';

const ESCALATION_CHOICES = [15, 30, 60];

const EmergencySettingsScreen: React.FC<any> = ({ navigation }) => {
  const { COLORS } = useTheme();
  const { emergencyContact, appSettings, dispatch } = useAppContext();
  const { showToast } = useToast();
  // Initialised once; background refreshes must not wipe what the user is typing.
  const [contactDraft, setContactDraft] = useState<EmergencyContact>(emergencyContact);

  const setSettings = (patch: Partial<AppSettings>) =>
    dispatch({ type: 'SET_VALUE', key: 'appSettings', payload: { ...appSettings, ...patch } });

  const handleSaveEmergencyContact = async () => {
    const phone = contactDraft.phone.replace(/[^\d+]/g, '');
    if (!contactDraft.name.trim() || phone.replace(/\D/g, '').length < 10) {
      showToast({ message: t('settings.contact_error_fields'), type: 'error' });
      return;
    }
    dispatch({ type: 'SET_VALUE', key: 'emergencyContact', payload: { name: contactDraft.name.trim(), phone } });
    const unlocked = await badgeService.triggerAction('lifesaver');
    showToast({ message: unlocked.length ? t('common.new_badge') : t('settings.save_contact_success'), type: 'success' });
  };

  const esc = appSettings.escalation;

  return (
    <ScreenWrapper>
      <ScreenHeader title={t('settings.emergency_and_escalation')} onBackPress={() => navigation.goBack()} />
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <SettingsSection title={t('settings.emergency_contact')}>
            <View style={styles.block}>
              <Input label={t('settings.contact_name')} placeholder={t('settings.contact_name_placeholder')} value={contactDraft.name} onChangeText={name => setContactDraft(p => ({ ...p, name }))} />
              <Input label={t('settings.contact_phone')} placeholder={t('settings.contact_phone_placeholder')} keyboardType="phone-pad" value={contactDraft.phone} onChangeText={phone => setContactDraft(p => ({ ...p, phone }))} />
              <Button title={t('common.save')} onPress={handleSaveEmergencyContact} />
            </View>
          </SettingsSection>

          <SettingsSection title={t('settings.section_escalation')}>
            <SettingsRow
              icon="notifications-outline" tint={COLORS.error}
              title={t('settings.escalation_title')}
              subtitle={t('settings.escalation_desc_short')}
              right={<Switch value={esc.enabled} accessibilityLabel={t('settings.escalation_title')} onValueChange={enabled => setSettings({ escalation: { ...esc, enabled } })} />}
            />
            {esc.enabled && (
              <View style={styles.block}>
                <Typography variant="caption" color={COLORS.textSecondary} style={styles.label}>{t('settings.escalation_delay')}</Typography>
                <Segmented
                  label={t('settings.escalation_delay')}
                  value={esc.delayMinutes}
                  onChange={delayMinutes => setSettings({ escalation: { ...esc, delayMinutes } })}
                  options={ESCALATION_CHOICES.map(m => ({ value: m, label: t('settings.minutes_late', { m }) }))}
                />
              </View>
            )}
          </SettingsSection>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  content: { padding: SPACING.md, paddingBottom: 60 },
  block: { paddingVertical: 8 },
  label: { marginBottom: 6 },
  flex1: { flex: 1 },
});

export default EmergencySettingsScreen;
