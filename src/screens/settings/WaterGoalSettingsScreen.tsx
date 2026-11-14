import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAppContext } from '../../state/AppContext';
import { useTheme, SPACING } from '../../constants/theme';
import { t } from '../../localization/i18n';
import { ScreenWrapper } from '../../components/common/ScreenWrapper';
import { ScreenHeader } from '../../components/common/ScreenHeader';
import { Typography } from '../../components/common/Typography';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { SettingsSection } from '../../components/common/SettingsList';
import { AppSettings, DEFAULT_FLUID_WARNING_ML, fluidCeiling, goalAboveLimit } from '../../services/storageService';
import { dynamicGoalService } from '../../services/dynamicGoalService';
import { useToast } from '../../hooks/useToast';
import { confirm } from '../../utils/confirm';

const WaterGoalSettingsScreen: React.FC<any> = ({ navigation }) => {
  const { COLORS } = useTheme();
  const { waterGoal, appSettings, dispatch, todayDynamicAdjustment, refreshDynamicGoal } = useAppContext();
  const { showToast } = useToast();
  // Form drafts are initialised once; background refreshes must not wipe what the user is typing.
  const [goalDraft, setGoalDraft] = useState(String(waterGoal));
  const [limitDraft, setLimitDraft] = useState(appSettings.fluidLimitMl ? String(appSettings.fluidLimitMl) : '');

  const setSettings = (patch: Partial<AppSettings>) =>
    dispatch({ type: 'SET_VALUE', key: 'appSettings', payload: { ...appSettings, ...patch } });

  const handleSaveWaterGoal = async () => {
    const goal = parseInt(goalDraft, 10);
    if (isNaN(goal) || goal < 500 || goal > 10000) {
      showToast({ message: t('settings.goal_invalid'), type: 'error' });
      return;
    }
    if (goal > fluidCeiling(appSettings)) {
      const ok = await confirm(t('settings.goal_over_limit_title'), t('settings.goal_over_limit_body', { limit: fluidCeiling(appSettings) }), t('common.save'));
      if (!ok) return;
    }
    dispatch({ type: 'SET_VALUE', key: 'waterGoal', payload: goal });
    showToast({ message: t('settings.save_goal_success'), type: 'success' });
  };

  const handleSaveLimit = () => {
    if (!limitDraft.trim()) {
      setSettings({ fluidLimitMl: null });
      showToast({ message: t('settings.fluid_limit_cleared'), type: 'info' });
      return;
    }
    const ml = parseInt(limitDraft, 10);
    if (isNaN(ml) || ml < 500 || ml > 10000) {
      showToast({ message: t('settings.fluid_limit_invalid'), type: 'error' });
      return;
    }
    setSettings({ fluidLimitMl: ml });
    showToast({ message: t('settings.fluid_limit_saved'), type: 'success' });
    if (waterGoal > ml) showToast({ message: t('settings.goal_above_new_limit', { goal: waterGoal, limit: ml }), type: 'warning' });
  };

  // Today's goal (with hot weather / exercise / caffeine extras) vs the doctor's limit.
  const extra = todayDynamicAdjustment || 0;
  const effectiveGoal = waterGoal + extra;
  const overLimit = goalAboveLimit(effectiveGoal, appSettings);

  const matchGoalToLimit = async () => {
    if (overLimit === null) return;
    // Today's extras would push it over again, so they go too.
    if (extra > 0) { await dynamicGoalService.removeTodayAdjustment(); await refreshDynamicGoal(); }
    dispatch({ type: 'SET_VALUE', key: 'waterGoal', payload: overLimit });
    setGoalDraft(String(overLimit));
    showToast({ message: t('water_limit.matched', { limit: overLimit }), type: 'success' });
  };

  return (
    <ScreenWrapper>
      <ScreenHeader title={t('settings.goal_and_limit')} onBackPress={() => navigation.goBack()} />
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {overLimit !== null && (
            <View style={[styles.warn, { borderColor: COLORS.warning, backgroundColor: COLORS.warning + '1A' }]} accessibilityRole="alert">
              <View style={styles.warnTitle}>
                <Ionicons name="alert-circle" size={24} color={COLORS.warning} />
                <Typography style={[styles.flex1, styles.bold]}>{t('water_limit.title')}</Typography>
              </View>
              <Typography color={COLORS.text}>
                {extra > 0
                  ? t('water_limit.body_with_extra', { goal: effectiveGoal, extra, limit: overLimit })
                  : t('water_limit.body', { goal: effectiveGoal, limit: overLimit })}
              </Typography>
              <Button title={t('water_limit.match_button', { limit: overLimit })} onPress={matchGoalToLimit} style={styles.warnBtn} />
            </View>
          )}
          <SettingsSection title={t('settings.water_goal_title')}>
            <View style={styles.block}>
              <Input label={t('settings.goal_amount')} placeholder={t('settings.goal_placeholder')} keyboardType="numeric" value={goalDraft} onChangeText={setGoalDraft} />
              <Button title={t('common.save')} onPress={handleSaveWaterGoal} />
            </View>
          </SettingsSection>

          <SettingsSection title={t('settings.fluid_limit_title')}>
            <View style={styles.block}>
              <Typography variant="caption" color={COLORS.textSecondary} style={styles.desc}>
                {t('settings.fluid_limit_desc_short', { default: DEFAULT_FLUID_WARNING_ML })}
              </Typography>
              <Input label={t('settings.fluid_limit_label')} placeholder={t('settings.fluid_limit_placeholder')} keyboardType="numeric" value={limitDraft} onChangeText={setLimitDraft} />
              <Button title={t('common.save')} onPress={handleSaveLimit} variant="secondary" />
            </View>
          </SettingsSection>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  content: { padding: SPACING.md, paddingBottom: 60 },
  block: { paddingVertical: 8 },
  desc: { marginBottom: 12 },
  warn: { borderWidth: 1.5, borderRadius: 16, padding: SPACING.md, marginBottom: SPACING.md, gap: SPACING.sm },
  warnTitle: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  warnBtn: { marginTop: SPACING.xs },
  bold: { fontWeight: '800' },
  flex1: { flex: 1 },
});

export default WaterGoalSettingsScreen;
