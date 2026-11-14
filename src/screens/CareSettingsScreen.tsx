import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, Platform, Linking, TouchableOpacity, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAppContext } from '../state/AppContext';
import { useTheme, SPACING, touchSize } from '../constants/theme';
import { t } from '../localization/i18n';
import { ScreenWrapper } from '../components/common/ScreenWrapper';
import { ScreenHeader } from '../components/common/ScreenHeader';
import { Typography } from '../components/common/Typography';
import { SelectionModal } from '../components/common/SelectionModal';
import { SettingsSection, SettingsRow } from '../components/common/SettingsList';
import { Segmented } from '../components/common/Segmented';
import { Input } from '../components/common/Input';
import { Button } from '../components/common/Button';
import { JoinCodeCard, PairPausedNote, pairingErrorText } from '../components/care/JoinCodeCard';
import { confirm, notify } from '../utils/confirm';
import { displayModeOf, displayModePatch, DisplayMode } from '../services/storageService';
import { notificationService } from '../services/notificationService';
import {
  Pair, getLateMinutes, setLateMinutes, LATE_CHOICES, LATE_MINUTES, isPairingConfigured, watchPairs, removePair,
  displayName, getNicknames, setNickname,
} from '../services/pairing';
import { canScheduleExactAlarms, openExactAlarmSettings } from '../../modules/exact-alarm';
import { useAppState } from '../hooks/useAppState';

/** One followed person: name, rename (nickname, this phone only), unpair. */
const PersonRow: React.FC<{ pair: Pair; name: string; nickname: string; onSaved: () => void }> = ({ pair, name, nickname, onSaved }) => {
  const { COLORS, isSimple } = useTheme();
  const hit = { minWidth: touchSize(isSimple), minHeight: touchSize(isSimple) };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nickname);
  const save = () => {
    setEditing(false);
    setNickname(pair.id, draft).then(onSaved).catch(e => console.warn('[care] nickname', e));
  };
  const remove = async () => {
    if (!(await confirm(t('pairing.remove_title'), t('pairing.remove_confirm', { name }), t('pairing.remove'), true))) return;
    removePair(pair).catch(e => notify(t('pairing.title'), pairingErrorText(e)));
  };
  return (
    <View style={styles.person}>
      <View style={styles.row}>
        <Ionicons name="person-circle-outline" size={28} color={COLORS.secondary} />
        <Typography style={[styles.flex1, styles.bold]}>{name}</Typography>
        <TouchableOpacity onPress={() => { setDraft(nickname); setEditing(e => !e); }} style={[styles.iconBtn, hit]} accessibilityRole="button" accessibilityLabel={`${t('pairing.nickname_edit')}: ${name}`}>
          <Ionicons name="pencil-outline" size={22} color={COLORS.primary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={remove} style={[styles.iconBtn, hit]} accessibilityRole="button" accessibilityLabel={`${t('pairing.remove')}: ${name}`}>
          <Ionicons name="trash-outline" size={22} color={COLORS.error} />
        </TouchableOpacity>
      </View>
      <PairPausedNote pair={pair} />
      {editing && (
        <View style={styles.gapTop}>
          <Input
            label={t('pairing.nickname_label')}
            placeholder={pair.patientName || t('pairing.nickname_placeholder')}
            value={draft}
            maxLength={40}
            autoFocus
            onChangeText={setDraft}
            onSubmitEditing={save}
            returnKeyType="done"
          />
          <Button title={t('pairing.nickname_save')} variant="secondary" onPress={save} />
        </View>
      )}
    </View>
  );
};

/** Caregiver mode's settings (opened from CareHome's gear): only what matters for following someone. */
const CareSettingsScreen: React.FC<any> = ({ navigation }) => {
  const { COLORS } = useTheme();
  const { locale, themeMode, appSettings, dispatch } = useAppContext();
  const [modal, setModal] = useState<'language' | 'theme' | 'display' | null>(null);
  const [lateMin, setLateMin] = useState<number>(LATE_MINUTES);
  const [notifOk, setNotifOk] = useState(true);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [nicks, setNicks] = useState<Record<string, string>>({});
  const configured = isPairingConfigured();
  const appState = useAppState(); // back from system settings: re-check
  const loadNicks = () => { getNicknames().then(setNicks); };
  useEffect(() => { getLateMinutes().then(setLateMin); loadNicks(); }, []);
  useEffect(() => { notificationService.hasPermission().then(setNotifOk); }, [appState]);
  useEffect(() => (configured ? watchPairs(p => setPairs(p.asCaregiver), e => console.warn('[care] settings pairs', e)) : undefined), [configured]);
  const exactOk = canScheduleExactAlarms();
  // The account screen belongs to the account feature; the row only shows in builds that register it.
  const hasAccount = !!navigation.getState?.()?.routeNames?.includes('Account');

  const changeLateMin = (m: number) => {
    setLateMin(m);
    setLateMinutes(m).catch(e => console.warn('[care] late minutes', e));
  };

  return (
    <ScreenWrapper>
      <ScreenHeader title={t('tabs.settings')} onBackPress={() => navigation.goBack()} />
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {configured && (
            <SettingsSection title={t('pairing.section_following')}>
              {pairs.map(p => (
                <PersonRow key={p.id} pair={p} name={displayName(p, nicks)} nickname={nicks[p.id] ?? ''} onSaved={loadNicks} />
              ))}
              <View>
                <Typography variant="caption" color={COLORS.textSecondary} style={styles.gapTop}>{t('care.add_person')}</Typography>
                <JoinCodeCard />
              </View>
            </SettingsSection>
          )}

          <SettingsSection title={t('pairing.late_delay_title')}>
            <View style={styles.block}>
              <Typography color={COLORS.textSecondary} style={styles.gap}>{t('pairing.late_delay_desc')}</Typography>
              <Segmented
                options={LATE_CHOICES.map(m => ({ value: m as number, label: t('settings.minutes_late', { m }) }))}
                value={lateMin}
                onChange={changeLateMin}
                label={t('pairing.late_delay_title')}
              />
            </View>
          </SettingsSection>

          <SettingsSection title={t('care.settings_notifications')}>
            <SettingsRow
              icon="notifications-outline" tint={notifOk ? COLORS.accent : COLORS.warning}
              title={t('care.settings_notifications')}
              subtitle={t(notifOk ? 'care.notif_on' : 'care.notif_off')}
              onPress={async () => { if (notifOk || !(await notificationService.ensurePermissions())) Linking.openSettings(); else setNotifOk(true); }}
            />
            {Platform.OS === 'android' && !exactOk && (
              <SettingsRow
                icon="alarm-outline" tint={COLORS.warning}
                title={t('settings.exact_alarm_late')}
                subtitle={t('settings.exact_alarm_late_desc')}
                onPress={() => openExactAlarmSettings() || Linking.openSettings()}
              />
            )}
          </SettingsSection>

          <SettingsSection title={t('settings.section_general')}>
            <SettingsRow icon="language" title={t('settings.language')} value={locale === 'en' ? 'English' : 'Türkçe'} onPress={() => setModal('language')} />
            <SettingsRow icon="contrast-outline" tint={COLORS.secondary} title={t('settings.theme')} value={t(`settings.theme_${themeMode}`)} onPress={() => setModal('theme')} />
            <SettingsRow
              icon="text" tint={COLORS.secondary}
              title={t('settings.display_mode')}
              subtitle={t(`settings.display_${displayModeOf(appSettings)}_desc`)}
              value={t(`settings.display_${displayModeOf(appSettings)}`)}
              onPress={() => setModal('display')}
            />
          </SettingsSection>

          {hasAccount && (
            <SettingsSection title={t('care.section_account')}>
              <SettingsRow icon="cloud-upload-outline" title={t('care.account')} subtitle={t('care.account_desc')} onPress={() => navigation.navigate('Account')} />
            </SettingsSection>
          )}

          <SettingsSection title={t('care.section_self')}>
            <SettingsRow icon="person-add-outline" title={t('care.self_title')} subtitle={t('care.self_desc')} onPress={() => navigation.navigate('SelfSetup')} />
          </SettingsSection>

          <SettingsSection title={t('settings.section_data')}>
            <SettingsRow icon="shield-checkmark-outline" title={t('settings.data_privacy')} onPress={() => navigation.navigate('DataPrivacy')} />
          </SettingsSection>
        </ScrollView>
      </KeyboardAvoidingView>

      <SelectionModal
        isVisible={modal === 'language'}
        onClose={() => setModal(null)}
        title={t('settings.language')}
        selectedValue={locale}
        onSelect={val => dispatch({ type: 'SET_VALUE', key: 'locale', payload: val })}
        options={[{ label: 'Türkçe', value: 'tr', icon: 'flag' }, { label: 'English', value: 'en', icon: 'flag' }]}
      />
      <SelectionModal
        isVisible={modal === 'theme'}
        onClose={() => setModal(null)}
        title={t('settings.theme')}
        selectedValue={themeMode}
        onSelect={val => dispatch({ type: 'SET_VALUE', key: 'themeMode', payload: val })}
        options={[{ label: t('settings.theme_light'), value: 'light', icon: 'sunny' }, { label: t('settings.theme_dark'), value: 'dark', icon: 'moon' }, { label: t('settings.theme_system'), value: 'system', icon: 'settings' }]}
      />
      <SelectionModal
        isVisible={modal === 'display'}
        onClose={() => setModal(null)}
        title={t('settings.display_mode')}
        selectedValue={displayModeOf(appSettings)}
        onSelect={val => dispatch({ type: 'SET_VALUE', key: 'appSettings', payload: { ...appSettings, ...displayModePatch(val as DisplayMode) } })}
        options={(['normal', 'simple', 'large'] as const).map(m => ({ label: t(`settings.display_${m}`), value: m, icon: m === 'normal' ? 'phone-portrait-outline' as const : m === 'simple' ? 'grid-outline' as const : 'text' as const }))}
      />
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  content: { padding: SPACING.md, paddingBottom: 60 },
  block: { paddingVertical: 8 },
  gap: { marginBottom: 8 },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bold: { fontWeight: '700' },
  iconBtn: { alignItems: 'center', justifyContent: 'center' },
  person: { paddingVertical: 6 },
  gapTop: { marginTop: 8 },
});

export default CareSettingsScreen;
