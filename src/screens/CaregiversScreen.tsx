import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, SPACING, touchSize } from '../constants/theme';
import { t } from '../localization/i18n';
import { ScreenWrapper } from '../components/common/ScreenWrapper';
import { ScreenHeader } from '../components/common/ScreenHeader';
import { Typography } from '../components/common/Typography';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Card } from '../components/common/Card';
import { Switch } from '../components/common/Switch';
import { SettingsSection, SettingsRow } from '../components/common/SettingsList';
import { Segmented } from '../components/common/Segmented';
import { confirm, notify } from '../utils/confirm';
import { useAppContext } from '../state/AppContext';
import { JoinCodeCard, PairPausedNote, pairingErrorText } from '../components/care/JoinCodeCard';
import {
  Pair, PairEvent, SharedSchedule, MAX_CAREGIVERS, pairPlusActive, isPairingConfigured, formatCode,
  watchPairs, watchEvents, watchSchedule, createInvite, removePair, setShareWater, requestAlarmSync,
  displayName, getNicknames, setNickname, getLateMinutes, setLateMinutes, LATE_CHOICES, LATE_MINUTES, inviteMessage,
} from '../services/pairing';

const WHATSAPP_GREEN = '#25D366';

export const EVENT_ICON: Record<PairEvent['type'], keyof typeof Ionicons.glyphMap> = { taken: 'checkmark-circle', skipped: 'remove-circle', late: 'alert-circle' };


export const eventLine = (e: PairEvent) => {
  const p = { time: e.time, med: e.medName };
  return e.type === 'taken' ? t('pairing.feed_taken', p) : e.type === 'skipped' ? t('pairing.feed_skipped', p) : t('pairing.feed_late', p);
};

/** Caregiver view of one followed patient: water summary + live event feed. */
const PatientCard: React.FC<{ pair: Pair; name: string; nickname: string; onNickname: (v: string) => void; onRemove: () => void }> = ({ pair, name, nickname, onNickname, onRemove }) => {
  const { COLORS, isElderly } = useTheme();
  const hit = { minWidth: touchSize(isElderly), minHeight: touchSize(isElderly) };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nickname);
  const [events, setEvents] = useState<PairEvent[]>([]);
  const [schedule, setSchedule] = useState<SharedSchedule | null>(null);
  useEffect(() => watchEvents(pair.id, ev => { setEvents(ev); requestAlarmSync(); }), [pair.id]);
  useEffect(() => watchSchedule(pair.id, setSchedule), [pair.id]);
  const color = { taken: COLORS.success, skipped: COLORS.warning, late: COLORS.error };
  const water = schedule?.water;

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Ionicons name="person-circle-outline" size={28} color={COLORS.primary} />
        <Typography variant="subheader" style={styles.flex1}>{name}</Typography>
        <TouchableOpacity onPress={() => { setDraft(nickname); setEditing(e => !e); }} accessibilityRole="button" accessibilityLabel={`${t('pairing.nickname_edit')}: ${name}`} style={[styles.iconBtn, hit]}>
          <Ionicons name="pencil-outline" size={20} color={COLORS.primary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onRemove} accessibilityRole="button" accessibilityLabel={`${t('pairing.remove')}: ${name}`} style={[styles.iconBtn, hit]}>
          <Ionicons name="trash-outline" size={22} color={COLORS.error} />
        </TouchableOpacity>
      </View>
      <PairPausedNote pair={pair} />
      {editing ? (
        <View style={styles.gap}>
          <Input
            label={t('pairing.nickname_label')}
            placeholder={pair.patientName || t('pairing.nickname_placeholder')}
            value={draft}
            maxLength={40}
            autoFocus
            onChangeText={setDraft}
            onSubmitEditing={() => { onNickname(draft); setEditing(false); }}
            returnKeyType="done"
          />
          <Button title={t('pairing.nickname_save')} variant="secondary" onPress={() => { onNickname(draft); setEditing(false); }} />
        </View>
      ) : null}
      {water ? (
        <Typography variant="caption" color={COLORS.textSecondary} style={styles.gap}>{t('pairing.water_summary', { ml: water.ml, goal: water.goal })}</Typography>
      ) : null}
      {events.length === 0 ? (
        <Typography variant="caption" color={COLORS.textSecondary} style={styles.gap}>{t('pairing.feed_empty')}</Typography>
      ) : events.map(e => (
        <View key={e.id} style={[styles.row, styles.gap]} accessible>
          <Ionicons name={EVENT_ICON[e.type]} size={18} color={color[e.type]} />
          <Typography style={styles.flex1}>{eventLine(e)}</Typography>
          <Typography variant="caption" color={COLORS.textSecondary}>{e.date.slice(8, 10)}.{e.date.slice(5, 7)}</Typography>
        </View>
      ))}
    </Card>
  );
};

const CaregiversScreen: React.FC<any> = ({ navigation, route }) => {
  // Arrived from the "follow a family member" onboarding: the code field comes first.
  const joinMode = route?.params?.mode === 'join';
  const caregiverMode = useAppContext().appSettings.appMode === 'caregiver';
  const { COLORS, isElderly } = useTheme();
  const configured = isPairingConfigured();
  const [pairs, setPairs] = useState<{ asPatient: Pair[]; asCaregiver: Pair[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [invite, setInvite] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [nicks, setNicks] = useState<Record<string, string>>({});

  const [lateMin, setLateMin] = useState<number>(LATE_MINUTES);

  useEffect(() => { getNicknames().then(setNicks); getLateMinutes().then(setLateMin); }, []);
  const changeLateMin = (m: number) => {
    setLateMin(m);
    setLateMinutes(m).catch(e => console.warn('[pairing] late minutes', e)); // re-plans the alarms
  };
  const saveNickname = async (pairId: string, v: string) => {
    await setNickname(pairId, v);
    setNicks(await getNicknames());
  };

  useEffect(() => {
    if (!configured) return;
    return watchPairs(setPairs, e => { console.warn('[pairing] pairs', e); setFailed(true); });
  }, [configured]);

  useEffect(() => {
    if (!invite) return;
    const id = setTimeout(() => setInvite(null), Math.max(0, invite.expiresAt - Date.now()));
    return () => clearTimeout(id);
  }, [invite]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); } catch (e) { notify(t('pairing.title'), pairingErrorText(e)); } finally { setBusy(false); }
  };

  // Anyone may invite; a pair needs Plus on either side, which the caregiver's joinWithCode checks.
  const addCaregiver = () => run(async () => setInvite(await createInvite()));
  const shareInvite = (code: string) => { Share.share({ message: inviteMessage(code) }).catch(e => console.warn('[pairing] share', e)); };

  const remove = async (pair: Pair, name: string) => {
    if (await confirm(t('pairing.remove_title'), t('pairing.remove_confirm', { name }), t('pairing.remove'), true)) run(() => removePair(pair));
  };

  const asPatient = pairs?.asPatient ?? [];
  const asCaregiver = pairs?.asCaregiver ?? [];
  // The code was redeemed (a new follower appeared): stop showing it.
  const followerCount = asPatient.length;
  useEffect(() => { setInvite(null); }, [followerCount]);
  const waterOn = asPatient.length > 0 && asPatient.every(p => p.shareWater);
  const following = (
    <SettingsSection title={t('pairing.section_following')}>
      <JoinCodeCard autoFocus={joinMode} primary={joinMode} />
    </SettingsSection>
  );

  return (
    <ScreenWrapper>
      <ScreenHeader title={t('pairing.title')} onBackPress={() => navigation.goBack()} />
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Typography color={COLORS.textSecondary} style={styles.intro}>{t('pairing.intro')}</Typography>

          {!configured || failed ? (
            <Card style={styles.card}>
              <Typography>{!configured ? t('pairing.not_configured') : t('pairing.err_generic')}</Typography>
            </Card>
          ) : (
            <>
              {joinMode && following}
              {(!caregiverMode || asPatient.length > 0) && <SettingsSection title={t('pairing.section_followers')}>
                {asPatient.map(p => (
                  <SettingsRow
                    key={p.id}
                    icon="person-outline"
                    title={p.caregiverName || t('pairing.unnamed_caregiver')}
                    subtitle={pairPlusActive(p) ? undefined : t('pairing.paused')}
                    right={(
                      <TouchableOpacity onPress={() => remove(p, p.caregiverName || t('pairing.unnamed_caregiver'))} accessibilityRole="button" accessibilityLabel={`${t('pairing.remove')}: ${p.caregiverName || t('pairing.unnamed_caregiver')}`} style={[styles.iconBtn, { minWidth: touchSize(isElderly), minHeight: touchSize(isElderly) }]}>
                        <Ionicons name="trash-outline" size={20} color={COLORS.error} />
                      </TouchableOpacity>
                    )}
                  />
                ))}
                {asPatient.length > 0 && (
                  <SettingsRow
                    icon="water" tint={COLORS.success}
                    title={t('pairing.share_water')}
                    subtitle={t('pairing.share_water_desc')}
                    right={<Switch value={waterOn} accessibilityLabel={t('pairing.share_water')} onValueChange={on => run(() => setShareWater(asPatient, on))} />}
                  />
                )}
                <View style={styles.block}>
                  <Typography variant="caption" color={COLORS.textSecondary} style={styles.gap}>{t('pairing.shared_info')}</Typography>
                  {invite ? (
                    <View style={styles.codeBox}>
                      <Typography variant="header" style={styles.code} selectable numberOfLines={1} adjustsFontSizeToFit accessibilityLabel={invite.code.split('').join(' ')}>{formatCode(invite.code)}</Typography>
                      <Typography variant="caption" color={COLORS.textSecondary}>{t('pairing.code_hint')}</Typography>
                      <TouchableOpacity
                        onPress={() => shareInvite(invite.code)}
                        style={[styles.share, { minHeight: touchSize(isElderly) }]}
                        accessibilityRole="button"
                        accessibilityLabel={t('pairing.share')}
                      >
                        <Ionicons name="logo-whatsapp" size={24} color="#fff" />
                        <Typography style={styles.shareText} color="#fff">{t('pairing.share')}</Typography>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                  <Button
                    title={asPatient.length >= MAX_CAREGIVERS ? t('pairing.limit_reached', { max: MAX_CAREGIVERS }) : t('pairing.add')}
                    onPress={addCaregiver}
                    loading={busy}
                    disabled={busy || !pairs || asPatient.length >= MAX_CAREGIVERS}
                  />
                </View>
              </SettingsSection>}

              {!joinMode && following}
              {asCaregiver.map(p => (
                <PatientCard
                  key={p.id}
                  pair={p}
                  name={displayName(p, nicks)}
                  nickname={nicks[p.id] ?? ''}
                  onNickname={v => { saveNickname(p.id, v).catch(e => console.warn('[pairing] nickname', e)); }}
                  onRemove={() => remove(p, displayName(p, nicks))}
                />
              ))}
              {asCaregiver.length > 0 && (
                <SettingsSection title={t('pairing.late_delay_title')}>
                  <View style={styles.block}>
                    <Typography color={COLORS.textSecondary} style={styles.intro}>{t('pairing.late_delay_desc')}</Typography>
                    <Segmented
                      options={LATE_CHOICES.map(m => ({ value: m as number, label: t('settings.minutes_late', { m }) }))}
                      value={lateMin}
                      onChange={changeLateMin}
                      label={t('pairing.late_delay_title')}
                    />
                    <Typography variant="caption" color={COLORS.textSecondary} style={styles.gap}>{t('pairing.late_alarm_info', { min: lateMin })}</Typography>
                  </View>
                </SettingsSection>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  content: { padding: SPACING.md, paddingBottom: 60 },
  flex1: { flex: 1 },
  intro: { marginBottom: SPACING.sm },
  card: { marginBottom: SPACING.md },
  block: { paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  gap: { marginTop: 8 },
  iconBtn: { alignItems: 'center', justifyContent: 'center' },
  codeBox: { alignItems: 'center', paddingVertical: SPACING.md },
  code: { fontSize: 40, letterSpacing: 4, fontVariant: ['tabular-nums'] },
  share: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, alignSelf: 'stretch', marginTop: SPACING.md, paddingHorizontal: SPACING.md, borderRadius: 14, backgroundColor: WHATSAPP_GREEN },
  shareText: { fontWeight: '700', fontSize: 17 },
});

export default CaregiversScreen;
