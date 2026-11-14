import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';

import { useAppContext } from '../../state/AppContext';
import { useTheme, SPACING, touchSize } from '../../constants/theme';
import { t } from '../../localization/i18n';
import { ScreenWrapper } from '../../components/common/ScreenWrapper';
import { ScreenHeader } from '../../components/common/ScreenHeader';
import { Typography } from '../../components/common/Typography';
import { Switch } from '../../components/common/Switch';
import { BottomSheetTimePicker } from '../../components/common/BottomSheetTimePicker';
import { SettingsSection, SettingsRow } from '../../components/common/SettingsList';
import { badgeService } from '../../services/badgeService';
import { useToast } from '../../hooks/useToast';

// No text input here, so no KeyboardAvoidingView.
const SleepSettingsScreen: React.FC<any> = ({ navigation }) => {
  const { COLORS, isElderly } = useTheme();
  const { sleepSettings, dispatch } = useAppContext();
  const { showToast } = useToast();
  const [sleepStart, setSleepStart] = useState(sleepSettings.start);
  const [sleepEnd, setSleepEnd] = useState(sleepSettings.end);
  const [sleepPicker, setSleepPicker] = useState<'start' | 'end' | null>(null);

  const setSleepEnabled = (enabled: boolean) => {
    dispatch({ type: 'SET_VALUE', key: 'sleepSettings', payload: { enabled, start: sleepStart, end: sleepEnd } });
    showToast({ message: enabled ? t('settings.sleep_mode_enabled') : t('settings.sleep_mode_disabled'), type: enabled ? 'success' : 'info' });
    if (enabled) badgeService.triggerAction('sleep_guardian');
  };

  const handleSleepTime = (which: 'start' | 'end', time: string) => {
    const next = { enabled: sleepSettings.enabled, start: which === 'start' ? time : sleepStart, end: which === 'end' ? time : sleepEnd };
    which === 'start' ? setSleepStart(time) : setSleepEnd(time);
    dispatch({ type: 'SET_VALUE', key: 'sleepSettings', payload: next });
    showToast({ message: t('settings.sleep_settings_saved'), type: 'success' });
  };

  return (
    <ScreenWrapper>
      <ScreenHeader title={t('settings.sleep_hours')} onBackPress={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsSection title={t('settings.sleep_mode')}>
          <SettingsRow
            icon="moon-outline" tint={COLORS.secondary}
            title={t('settings.sleep_mode')}
            subtitle={t('settings.sleep_mode_desc')}
            right={<Switch value={sleepSettings.enabled} accessibilityLabel={t('settings.sleep_mode')} onValueChange={setSleepEnabled} />}
          />
        </SettingsSection>

        {sleepSettings.enabled && (
          <SettingsSection title={t('settings.section_times')}>
            <View style={styles.timeRow}>
              {(['start', 'end'] as const).map(which => (
                <TouchableOpacity
                  key={which}
                  style={[styles.timeBox, { backgroundColor: COLORS.background, minHeight: Math.max(64, touchSize(isElderly)) }]}
                  onPress={() => setSleepPicker(which)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t(which === 'start' ? 'settings.start_time' : 'settings.end_time')} ${which === 'start' ? sleepStart : sleepEnd}`}
                >
                  <Typography variant="caption" color={COLORS.textSecondary}>{t(which === 'start' ? 'settings.start_time' : 'settings.end_time')}</Typography>
                  <Typography variant="subheader">{which === 'start' ? sleepStart : sleepEnd}</Typography>
                </TouchableOpacity>
              ))}
            </View>
          </SettingsSection>
        )}
      </ScrollView>

      <BottomSheetTimePicker
        isVisible={sleepPicker !== null}
        onClose={() => setSleepPicker(null)}
        title={sleepPicker === 'end' ? t('settings.sleep_end_label') : t('settings.sleep_start_label')}
        initialTime={sleepPicker === 'end' ? sleepEnd : sleepStart}
        onConfirm={time => sleepPicker && handleSleepTime(sleepPicker, time)}
      />
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  content: { padding: SPACING.md, paddingBottom: 60 },
  timeRow: { flexDirection: 'row', gap: 12, paddingVertical: 8 },
  timeBox: { flex: 1, alignItems: 'center', padding: 12, borderRadius: 16 },
});

export default SleepSettingsScreen;
