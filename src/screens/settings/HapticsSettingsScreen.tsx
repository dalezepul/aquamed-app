import React from 'react';
import { View, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAppContext } from '../../state/AppContext';
import { useTheme, SPACING, touchSize } from '../../constants/theme';
import { t } from '../../localization/i18n';
import { ScreenWrapper } from '../../components/common/ScreenWrapper';
import { ScreenHeader } from '../../components/common/ScreenHeader';
import { Typography } from '../../components/common/Typography';
import { SettingsSection, SettingsRow } from '../../components/common/SettingsList';
import { AppSettings } from '../../services/storageService';
import { useToast } from '../../hooks/useToast';
import { HAPTIC_METHODS, HapticLevel, hapticMethodKey, playHapticLevel, resolveHapticLevel, runHapticMethod } from '../../utils/haptics';

const LEVELS: HapticLevel[] = ['off', 'subtle', 'light', 'custom'];

/** Settings → Vibration: pick a level, or try every method the phone has and use the one that feels right. */
const HapticsSettingsScreen: React.FC<any> = ({ navigation }) => {
  const { COLORS, isElderly } = useTheme();
  const { appSettings, dispatch } = useAppContext();
  const { showToast } = useToast();
  const current = resolveHapticLevel(appSettings);
  const custom = appSettings.hapticCustom;

  const setSettings = (patch: Partial<AppSettings>) =>
    dispatch({ type: 'SET_VALUE', key: 'appSettings', payload: { ...appSettings, ...patch } });

  const pickLevel = (l: HapticLevel) => {
    // "Custom" without a saved method yet: point to the list below instead of saving an empty choice.
    if (l === 'custom' && !custom) { showToast({ message: t('settings.haptic_custom_pick'), type: 'info' }); return; }
    setSettings({ hapticLevel: l, haptics: l !== 'off' });
    playHapticLevel(l, custom); // preview
  };

  const tryMethod = (id: string) =>
    runHapticMethod(id).catch((e: any) => showToast({ message: `${t(hapticMethodKey(id))}: ${e?.message ?? t('settings.haptic_unsupported')}`, type: 'error' }));

  const chooseMethod = (id: string) => {
    setSettings({ hapticLevel: 'custom', hapticCustom: id, haptics: true });
    tryMethod(id);
  };

  const btn = [styles.btn, { minHeight: touchSize(isElderly) - 8, borderColor: COLORS.primary }];

  return (
    <ScreenWrapper>
      <ScreenHeader title={t('settings.haptics')} onBackPress={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsSection title={t('settings.haptic_level')}>
          {LEVELS.map(l => (
            <SettingsRow
              key={l}
              icon={l === 'off' ? 'close-circle-outline' : l === 'custom' ? 'options-outline' : 'phone-portrait-outline'}
              title={t(`settings.haptic_${l}`)}
              subtitle={l === 'custom' && custom ? t(hapticMethodKey(custom)) : undefined}
              onPress={() => pickLevel(l)}
              accessibilityLabel={t(`settings.haptic_${l}`)}
              right={current === l ? <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} /> : <View />}
            />
          ))}
        </SettingsSection>

        {Platform.OS !== 'web' && (
            <SettingsSection title={t('settings.haptic_try')}>
              <Typography variant="caption" color={COLORS.textSecondary} style={styles.hint}>{t('settings.haptic_try_hint')}</Typography>
              {HAPTIC_METHODS.map(id => {
                const name = t(hapticMethodKey(id));
                const inUse = current === 'custom' && custom === id;
                return (
                  <View key={id} style={[styles.row, isElderly && styles.rowStacked]}>
                    <Typography style={styles.flex1}>{name}</Typography>
                    <View style={styles.actions}>
                      <Pressable style={btn} onPress={() => tryMethod(id)} accessibilityRole="button" accessibilityLabel={`${t('settings.haptic_try_one')}: ${name}`}>
                        <Typography color={COLORS.primary} style={styles.bold}>{t('settings.haptic_try_one')}</Typography>
                      </Pressable>
                      <Pressable
                        style={[btn, inUse && { backgroundColor: COLORS.primary }]}
                        onPress={() => chooseMethod(id)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: inUse }}
                        accessibilityLabel={`${t('settings.haptic_use')}: ${name}`}
                      >
                        <Typography color={inUse ? COLORS.onPrimary : COLORS.primary} style={styles.bold}>
                          {inUse ? t('settings.haptic_in_use') : t('settings.haptic_use')}
                        </Typography>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </SettingsSection>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  content: { padding: SPACING.md, paddingBottom: 60 },
  hint: { paddingVertical: SPACING.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 6 },
  rowStacked: { flexDirection: 'column', alignItems: 'stretch' },
  actions: { flexDirection: 'row', gap: SPACING.xs },
  btn: { borderWidth: 1, borderRadius: 20, paddingHorizontal: SPACING.sm + 4, alignItems: 'center', justifyContent: 'center' },
  bold: { fontWeight: '700' },
  flex1: { flex: 1 },
});

export default HapticsSettingsScreen;
