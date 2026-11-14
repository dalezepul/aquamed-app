import React, { useState } from 'react';
import { View, StyleSheet, Image, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAppContext } from '../state/AppContext';
import { useTheme, SPACING } from '../constants/theme';
import { Button } from '../components/common/Button';
import { Typography } from '../components/common/Typography';
import { ScreenWrapper } from '../components/common/ScreenWrapper';
import { Input } from '../components/common/Input';
import { BottomSheetTimePicker } from '../components/common/BottomSheetTimePicker';
import { Switch } from '../components/common/Switch';
import { notificationService } from '../services/notificationService';
import { canScheduleExactAlarms, openExactAlarmSettings } from '../../modules/exact-alarm';
import { useAppState } from '../hooks/useAppState';
import { t } from '../localization/i18n';
import { followerSettings, DEFAULT_APP_SETTINGS } from '../services/storageService';
import { CONTACT_ALERT_ENABLED } from '../utils/contactAlert';

const MIN_GOAL = 1500;
const MAX_GOAL = 4000;

/** ~35 ml per kg, kept in a sensible band. Exported for tests. */
export const suggestedGoal = (weightKg: number) =>
  Math.min(MAX_GOAL, Math.max(MIN_GOAL, Math.round((weightKg * 35) / 50) * 50));

const num = (s: string) => parseFloat(s.replace(',', '.'));

/** Groups a Turkish mobile number as the user types: 0532 123 45 67. */
const formatPhone = (text: string) => {
  const d = text.replace(/\D/g, '').slice(0, text.trim().startsWith('0') ? 11 : 10);
  const parts = d.startsWith('0') ? [4, 3, 2, 2] : [3, 3, 2, 2];
  const out: string[] = [];
  let i = 0;
  for (const len of parts) {
    if (i >= d.length) break;
    out.push(d.slice(i, i + len));
    i += len;
  }
  return out.join(' ');
};

/** Route to open once the main stack mounts (AppNavigator flushes it). */
export const afterOnboarding: { route?: { name: string; params?: object } } = {};

const OnboardingScreen: React.FC<any> = ({ navigation, route }) => {
  const { dispatch, appSettings } = useAppContext();
  const { COLORS } = useTheme();
  // Caregiver mode → "Kendi takibimi de kullanmak istiyorum": short own setup (weight/goal, sleep), then 'self' mode.
  const selfSetup = route?.name === 'SelfSetup';

  const [step, setStep] = useState(selfSetup ? 2 : 1);
  // "I'm here to follow a family member": name → notifications → caregiver mode, no health setup.
  const [follow, setFollow] = useState(false);
  // Step 4 (emergency contact) only while the SMS/WhatsApp feature is on: nowhere to see or change it otherwise.
  const order = selfSetup ? [2, 3, 6] : follow ? [1, 5] : CONTACT_ALERT_ENABLED ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 5, 6];
  const pos = order.indexOf(step);
  const [name, setName] = useState('');
  const [heightVal, setHeightVal] = useState('');
  const [weightVal, setWeightVal] = useState('');
  const [goal, setGoal] = useState('2500');
  const [goalEdited, setGoalEdited] = useState(false);
  const [sleepStart, setSleepStart] = useState('23:00');
  const [sleepEnd, setSleepEnd] = useState('07:00');
  const [picker, setPicker] = useState<'start' | 'end' | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [exactAsked, setExactAsked] = useState(false);
  useAppState(); // re-render when coming back from system settings
  const exactOk = canScheduleExactAlarms();

  const weight = num(weightVal);
  const height = num(heightVal);
  const weightOk = weight >= 25 && weight <= 300;
  const heightOk = !heightVal || (height >= 80 && height <= 250);
  const goalNum = parseInt(goal, 10);
  const goalOk = goalNum >= 500 && goalNum <= 10000;
  const phoneDigits = contactPhone.replace(/\D/g, '');
  const contactOk = (!contactName && !phoneDigits) || (contactName.trim().length > 0 && phoneDigits.length >= 10);

  const onWeight = (v: string) => {
    setWeightVal(v);
    const w = num(v);
    if (!goalEdited && w >= 25 && w <= 300) setGoal(String(suggestedGoal(w)));
  };

  const askPermission = async () => {
    setPermission((await notificationService.ensurePermissions()) ? 'granted' : 'denied');
  };

  const finish = () => {
    dispatch({ type: 'SET_VALUE', key: 'userName', payload: name.trim() });
    dispatch({ type: 'SET_VALUE', key: 'waterGoal', payload: goalNum });
    dispatch({ type: 'SET_VALUE', key: 'userMetrics', payload: { weight, height: heightVal ? height : undefined } });
    dispatch({ type: 'SET_VALUE', key: 'sleepSettings', payload: { enabled: true, start: sleepStart, end: sleepEnd } });
    if (CONTACT_ALERT_ENABLED && contactName.trim() && phoneDigits.length >= 10) {
      dispatch({ type: 'SET_VALUE', key: 'emergencyContact', payload: { name: contactName.trim(), phone: phoneDigits } });
    }
    dispatch({ type: 'SET_HAS_ONBOARDED', payload: true });
    notificationService.rescheduleAll();
  };

  const finishSelf = () => {
    dispatch({ type: 'SET_VALUE', key: 'waterGoal', payload: goalNum });
    dispatch({ type: 'SET_VALUE', key: 'userMetrics', payload: { weight, height: heightVal ? height : undefined } });
    dispatch({ type: 'SET_VALUE', key: 'sleepSettings', payload: { enabled: true, start: sleepStart, end: sleepEnd } });
    // Undo followerSettings: water reminders and the evening nudge come back.
    dispatch({ type: 'SET_VALUE', key: 'appSettings', payload: {
      ...appSettings, appMode: 'self',
      waterReminder: { ...appSettings.waterReminder, mode: DEFAULT_APP_SETTINGS.waterReminder.mode },
      eveningNudge: { ...appSettings.eveningNudge, enabled: true },
    } });
    navigation.goBack();
  };

  const finishFollow = () => {
    dispatch({ type: 'SET_VALUE', key: 'userName', payload: name.trim() });
    dispatch({ type: 'SET_VALUE', key: 'appSettings', payload: { ...followerSettings(appSettings), appMode: 'caregiver' } });
    afterOnboarding.route = { name: 'CareHome', params: { mode: 'join' } }; // its empty state holds the code field
    dispatch({ type: 'SET_HAS_ONBOARDED', payload: true });
  };
  const afterPermission = follow ? finishFollow : () => setStep(6);
  /** Finish and open the add-medication form right away (the home screen has little to do without one). */
  const finishAddMed = () => {
    afterOnboarding.route = { name: 'AddEditMedication' };
    finish();
  };

  const TimeBox = ({ which }: { which: 'start' | 'end' }) => (
    <TouchableOpacity
      onPress={() => setPicker(which)}
      style={[styles.timeBox, { backgroundColor: COLORS.card, borderColor: COLORS.border }]}
      accessibilityRole="button"
      accessibilityLabel={`${t(which === 'start' ? 'settings.start_time' : 'settings.end_time')} ${which === 'start' ? sleepStart : sleepEnd}`}
    >
      <Typography variant="caption" color={COLORS.textSecondary}>{t(which === 'start' ? 'settings.start_time' : 'settings.end_time')}</Typography>
      <Typography variant="subheader">{which === 'start' ? sleepStart : sleepEnd}</Typography>
    </TouchableOpacity>
  );

  // Body scrolls; actions stay pinned above the progress bar (360 px + large text pushed them off screen).
  const steps: Record<number, { body: React.ReactNode; actions: React.ReactNode }> = {
    1: {
      body: (
        <>
          <Typography variant="header" style={styles.title}>{t(follow ? 'onboarding.follow_title' : 'onboarding.title_1')}</Typography>
          {follow && <Typography color={COLORS.textSecondary} style={[styles.center, styles.desc]}>{t('onboarding.follow_name_desc')}</Typography>}
          <Input label={t('onboarding.your_name')} placeholder={t('onboarding.name_placeholder')} value={name} onChangeText={setName} autoFocus returnKeyType="next" onSubmitEditing={() => name.trim() && setStep(order[1])} />
          {/* The whole row toggles: the switch alone is a small target. */}
          <TouchableOpacity
            style={[styles.largeTextRow, { backgroundColor: COLORS.card, borderColor: COLORS.border }]}
            onPress={() => dispatch({ type: 'SET_VALUE', key: 'appSettings', payload: { ...appSettings, elderlyMode: !appSettings.elderlyMode } })}
            accessibilityRole="switch"
            accessibilityLabel={t('onboarding.large_text')}
            accessibilityHint={t('onboarding.large_text_desc')}
            accessibilityState={{ checked: appSettings.elderlyMode }}
          >
            <View style={styles.flex1}>
              <Typography style={{ fontWeight: '700' }}>{t('onboarding.large_text')}</Typography>
              <Typography variant="caption" color={COLORS.textSecondary}>{t('onboarding.large_text_desc')}</Typography>
            </View>
            <Switch
              value={appSettings.elderlyMode}
              accessibilityLabel={t('onboarding.large_text')}
              onValueChange={elderlyMode => dispatch({ type: 'SET_VALUE', key: 'appSettings', payload: { ...appSettings, elderlyMode } })}
            />
          </TouchableOpacity>
        </>
      ),
      actions: (
        <>
          <Button title={t('common.next')} onPress={() => setStep(order[1])} disabled={!name.trim()} />
          {!follow && <Button title={t('onboarding.follow_start')} variant="secondary" onPress={() => setFollow(true)} style={styles.gap} />}
        </>
      ),
    },
    2: {
      body: (
        <>
          <Typography variant="header" style={styles.title}>{t('onboarding.title_2')}</Typography>
          <View style={styles.row}>
            <Input label={t('onboarding.height_cm')} placeholder="170" value={heightVal} onChangeText={setHeightVal} containerStyle={styles.flex1} keyboardType="numeric"
              error={heightOk ? undefined : t('onboarding.height_invalid')} />
            <View style={{ width: 16 }} />
            <Input label={t('onboarding.weight_kg')} placeholder="70" value={weightVal} onChangeText={onWeight} containerStyle={styles.flex1} keyboardType="numeric"
              error={weightVal && !weightOk ? t('onboarding.weight_invalid') : undefined} />
          </View>
          <View style={[styles.goalBox, { backgroundColor: COLORS.card }]}>
            <Typography variant="caption" color={COLORS.textSecondary}>{t('onboarding.recommended_goal')}</Typography>
            <Input
              value={goal}
              onChangeText={v => { setGoal(v.replace(/\D/g, '')); setGoalEdited(true); }}
              keyboardType="numeric"
              accessibilityLabel={t('onboarding.recommended_goal')}
              inputStyle={[styles.goalInput, { color: COLORS.primary, borderColor: COLORS.border }]}
              containerStyle={styles.goalInputWrap}
              maxLength={5}
            />
            <Typography style={{ fontWeight: '700' }}>ml</Typography>
            <Typography variant="caption" color={COLORS.textSecondary} style={styles.center}>{t('onboarding.goal_desc_v2')}</Typography>
          </View>
        </>
      ),
      actions: <Button title={t('common.next')} onPress={() => setStep(3)} disabled={!weightOk || !heightOk || !goalOk} />,
    },
    3: {
      body: (
        <>
          <Typography variant="header" style={styles.title}>{t('onboarding.title_3')}</Typography>
          <Typography color={COLORS.textSecondary} style={[styles.center, styles.desc]}>{t('onboarding.sleep_desc')}</Typography>
          <View style={styles.timeRow}>
            <TimeBox which="start" />
            <Ionicons name="arrow-forward" size={24} color={COLORS.textSecondary} />
            <TimeBox which="end" />
          </View>
        </>
      ),
      actions: <Button title={t('common.next')} onPress={() => setStep(order[pos + 1])} />,
    },
    4: {
      body: (
        <>
          <Typography variant="header" style={styles.title}>{t('onboarding.title_4')}</Typography>
          <Typography color={COLORS.textSecondary} style={[styles.center, styles.desc]}>{t('onboarding.emergency_desc_v2')}</Typography>
          <Input label={t('settings.contact_name')} placeholder={t('settings.contact_name_placeholder')} value={contactName} onChangeText={setContactName} />
          <Input label={t('settings.contact_phone')} placeholder={t('settings.contact_phone_placeholder')} value={contactPhone} onChangeText={v => setContactPhone(formatPhone(v))} keyboardType="phone-pad"
            error={contactOk ? undefined : t('onboarding.contact_incomplete')} />
        </>
      ),
      actions: (
        <>
          <Button title={t('common.next')} onPress={() => setStep(5)} disabled={!contactOk} />
          <Button title={t('onboarding.skip')} variant="secondary" onPress={() => { setContactName(''); setContactPhone(''); setStep(5); }} style={styles.gap} />
        </>
      ),
    },
    5: {
      body: (
        <>
          <View style={styles.bigIcon}><Ionicons name="notifications" size={96} color={COLORS.primary} /></View>
          <Typography variant="header" style={styles.title}>{t('onboarding.title_notifications')}</Typography>
          <Typography color={COLORS.textSecondary} style={[styles.center, styles.desc]}>{t(follow ? 'onboarding.follow_notifications_desc' : 'onboarding.notifications_desc')}</Typography>
          {permission === 'denied' && (
            <Typography color={COLORS.error} style={[styles.center, styles.desc]}>{t('onboarding.notifications_denied')}</Typography>
          )}
          {permission === 'granted' && !exactOk && (
            // Android 12+: without this the OS may delay reminders by up to an hour.
            <Typography color={COLORS.textSecondary} style={[styles.center, styles.desc]}>{t('onboarding.exact_alarm_desc')}</Typography>
          )}
        </>
      ),
      actions: permission === 'granted' ? (
        <>
          {!exactOk && <Button title={t('onboarding.exact_alarm_button')} onPress={() => { openExactAlarmSettings(); setExactAsked(true); }} style={{ marginBottom: 12 }} />}
          <Button title={t('common.next')} variant={!exactOk && !exactAsked ? 'secondary' : 'primary'} onPress={afterPermission} />
        </>
      ) : (
        <>
          <Button title={t('onboarding.allow_notifications')} onPress={askPermission} />
          <Button title={t('onboarding.later')} variant="secondary" onPress={afterPermission} style={styles.gap} />
        </>
      ),
    },
    6: {
      body: (
        <>
          <View style={styles.bigIcon}><Ionicons name="checkmark-done-circle" size={120} color={COLORS.success} /></View>
          <Typography variant="header" style={styles.title}>{t('common.onboarding_complete')}</Typography>
          <Typography color={COLORS.textSecondary} style={[styles.center, styles.desc]}>{t('common.welcome_message')}</Typography>
        </>
      ),
      actions: selfSetup ? <Button title={t('common.get_started')} onPress={finishSelf} /> : (
        <>
          <Button title={t('onboarding.add_first_med')} onPress={finishAddMed} />
          <Button title={t('onboarding.start_without_med')} variant="secondary" onPress={finish} style={styles.gap} />
        </>
      ),
    },
  };

  return (
    <ScreenWrapper edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.topBar}>
          {pos > 0 || follow || selfSetup ? (
            <TouchableOpacity onPress={() => (pos > 0 ? setStep(order[pos - 1]) : selfSetup ? navigation.goBack() : setFollow(false))} style={styles.back} accessibilityRole="button" accessibilityLabel={t('common.back')}>
              <Ionicons name="chevron-back" size={26} color={COLORS.text} />
            </TouchableOpacity>
          ) : <View style={styles.back} />}
          <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" accessibilityIgnoresInvertColors />
          <View style={styles.back} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {steps[step].body}
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.actions}>{steps[step].actions}</View>
          <View style={[styles.progressBg, { backgroundColor: COLORS.border }]}>
            <View style={[styles.progressFill, { width: `${((pos + 1) / order.length) * 100}%`, backgroundColor: COLORS.primary }]} />
          </View>
          <Typography variant="caption" color={COLORS.textSecondary} style={{ marginTop: 8 }}>{pos + 1} / {order.length}</Typography>
        </View>
      </KeyboardAvoidingView>

      <BottomSheetTimePicker
        isVisible={picker !== null}
        onClose={() => setPicker(null)}
        title={picker === 'end' ? t('settings.sleep_end_label') : t('settings.sleep_start_label')}
        initialTime={picker === 'end' ? sleepEnd : sleepStart}
        onConfirm={time => (picker === 'end' ? setSleepEnd(time) : setSleepStart(time))}
      />
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingTop: SPACING.sm },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 64, height: 64, borderRadius: 16 },
  content: { flexGrow: 1, justifyContent: 'center', padding: SPACING.xl },
  title: { textAlign: 'center', marginBottom: 24 },
  center: { textAlign: 'center' },
  desc: { marginBottom: 24 },
  row: { flexDirection: 'row' },
  largeTextRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 32, padding: 16, borderRadius: 16, borderWidth: 1 },
  goalBox: { alignItems: 'center', alignSelf: 'stretch', marginVertical: 24, padding: 20, borderRadius: 24, overflow: 'hidden' },
  // Fixed width: the generic Input stretches to its parent, which pushed this past the card edges.
  goalInputWrap: { width: 180, alignSelf: 'center', marginTop: 8, marginBottom: 4 },
  goalInput: { fontSize: 40, fontWeight: '900', textAlign: 'center', paddingVertical: 6, borderRadius: 14 },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginBottom: 32, gap: 12 },
  timeBox: { alignItems: 'center', padding: 16, borderRadius: 20, minWidth: 120, minHeight: 72, borderWidth: 1 },
  bigIcon: { alignItems: 'center', marginBottom: 24 },
  footer: { paddingHorizontal: SPACING.xl, paddingTop: SPACING.sm, paddingBottom: 20, alignItems: 'center' },
  actions: { alignSelf: 'stretch', marginBottom: SPACING.md },
  gap: { marginTop: 12 },
  progressBg: { width: '100%', height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%' },
});

export default OnboardingScreen;
