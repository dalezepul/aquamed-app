import React, { useCallback, useEffect, useState } from 'react';
import {
  View, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, StatusBar, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme, SPACING, touchSize } from '../constants/theme';
import { t, upper } from '../localization/i18n';
import { useAppContext } from '../state/AppContext';
import { ScreenWrapper } from '../components/common/ScreenWrapper';
import { Typography } from '../components/common/Typography';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { JoinCodeCard, PairPausedNote } from '../components/care/JoinCodeCard';
import { notify } from '../utils/confirm';
import { getLocalDayString } from '../utils/DateUtils';
import {
  Pair, PairEvent, SharedSchedule, isPairingConfigured, watchPairs, watchEvents, watchSchedule, watchCommands,
  sendCommand, cancelCommand, requestAlarmSync, displayName, getNicknames, getLateMinutes, LATE_MINUTES,
} from '../services/pairing';
import { CareCommand, DoseRow, DoseState, GLASS_ML, careSummary, pendingWaterMl, pickPair, todayDoseRows } from '../services/careMode';
import { EVENT_ICON, eventLine } from './CaregiversScreen';

const STATE_ICON: Record<DoseState, keyof typeof Ionicons.glyphMap> = { taken: 'checkmark-circle', skipped: 'remove-circle', late: 'alert-circle', waiting: 'time-outline' };

const failed = (e?: any) => notify(t('pairing.title'), t(e?.message === 'paused' ? 'pairing.paused' : 'care.send_failed'));

const Bar: React.FC<{ value: number; color: string; track: string; label: string }> = ({ value, color, track, label }) => (
  <View
    style={[styles.bar, { backgroundColor: track }]}
    accessibilityRole="progressbar"
    accessibilityLabel={label}
    accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
  >
    <View style={[styles.barFill, { width: `${Math.min(100, Math.max(0, value * 100))}%`, backgroundColor: color }]} />
  </View>
);

/** One followed person's day: status card, today's doses (mark taken/skipped for them), water, recent events. Live. */
const PersonDay: React.FC<{ pair: Pair; name: string; lateMin: number }> = ({ pair, name, lateMin }) => {
  const { COLORS, isSimple } = useTheme();
  const [events, setEvents] = useState<PairEvent[]>([]);
  const [schedule, setSchedule] = useState<SharedSchedule | null | undefined>(undefined);
  const [commands, setCommands] = useState<CareCommand[]>([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => watchEvents(pair.id, ev => { setEvents(ev); requestAlarmSync(); }, 60), [pair.id]);
  useEffect(() => watchSchedule(pair.id, setSchedule), [pair.id]);
  useEffect(() => watchCommands(pair.id, setCommands), [pair.id]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(id); }, []);

  const today = getLocalDayString(new Date(now));
  const rows = todayDoseRows(schedule?.doses ?? [], events, commands, today, now, lateMin);
  const sum = careSummary(rows, events);
  const water = schedule?.water;
  const waterMl = water?.date === today ? water.ml : 0;
  const waterPending = pendingWaterMl(commands);
  const color: Record<DoseState, string> = { taken: COLORS.success, skipped: COLORS.warning, late: COLORS.error, waiting: COLORS.textSecondary };
  const iconSize = isSimple ? 30 : 24;

  const mark = (r: DoseRow, status: 'taken' | 'skipped') =>
    sendCommand(pair, { type: 'dose', medId: r.dose.medId, date: r.dose.date, time: r.dose.time, status }).catch(failed);

  const stateText = (r: DoseRow) =>
    r.pending ? t(r.state === 'taken' ? 'care.pending_taken' : 'care.pending_skipped') : t(`care.state_${r.state}`);

  const noDoses = schedule === null || (schedule && rows.length === 0);

  return (
    <>
      <PairPausedNote pair={pair} />
      {/* Status card */}
      <Card style={styles.card}>
        {schedule === undefined ? (
          <ActivityIndicator color={COLORS.primary} />
        ) : noDoses ? (
          <Typography color={COLORS.textSecondary}>{t(schedule === null ? 'care.no_schedule' : 'care.no_doses_today')}</Typography>
        ) : (
          <>
            <Typography variant="subheader">{t('care.summary_taken', { taken: sum.taken, total: sum.total })}</Typography>
            <Bar value={sum.total ? sum.taken / sum.total : 0} color={COLORS.success} track={COLORS.lightGray}
              label={t('care.summary_taken', { taken: sum.taken, total: sum.total })} />
            <Typography style={styles.gap}>
              {sum.next ? t('care.summary_next', { time: sum.next.dose.time, med: sum.next.dose.name }) : t('care.summary_done')}
            </Typography>
          </>
        )}
        {sum.last ? (
          <Typography variant="caption" color={COLORS.textSecondary} style={styles.gap}>{t('care.summary_last', { text: eventLine(sum.last) })}</Typography>
        ) : null}
        {sum.late.length > 0 && (
          <View style={[styles.lateStrip, { backgroundColor: COLORS.warning + '1A', borderColor: COLORS.warning }]} accessible accessibilityRole="alert">
            <Ionicons name="alert-circle-outline" size={iconSize} color={COLORS.warning} />
            <Typography style={[styles.flex1, styles.bold]} color={COLORS.text}>
              {sum.late.length === 1
                ? t('care.late_one', { time: sum.late[0].dose.time, med: sum.late[0].dose.name })
                : t('care.late_many', { count: sum.late.length })}
            </Typography>
          </View>
        )}
      </Card>

      {/* Doses */}
      {!noDoses && rows.length > 0 && <Typography variant="subheader" style={styles.section}>{t('care.today_doses')}</Typography>}
      {rows.map(r => (
        <Card key={`${r.dose.medId}_${r.dose.time}`} style={[styles.card, r.state === 'late' && !r.pending && { borderColor: COLORS.warning, borderWidth: 1.5 }]}>
          <View style={styles.row} accessible accessibilityLabel={`${r.dose.time} ${r.dose.name} ${r.dose.dose}: ${stateText(r)}`}>
            <Typography variant="subheader" style={styles.time}>{r.dose.time}</Typography>
            <View style={styles.flex1}>
              <Typography style={styles.bold}>{r.dose.name}</Typography>
              {r.dose.dose ? <Typography variant="caption" color={COLORS.textSecondary}>{r.dose.dose}</Typography> : null}
            </View>
          </View>
          <View style={[styles.badge, { backgroundColor: color[r.state] + '1F' }]} importantForAccessibility="no-hide-descendants">
            <Ionicons name={r.pending ? 'hourglass-outline' : STATE_ICON[r.state]} size={18} color={color[r.state]} />
            <Typography variant="caption" color={color[r.state]} style={styles.bold}>{stateText(r)}</Typography>
          </View>
          {r.pending ? (
            <View style={[styles.row, styles.gap]}>
              <Typography variant="caption" color={COLORS.textSecondary} style={styles.flex1}>{t('care.pending_note', { name })}</Typography>
              <TouchableOpacity
                onPress={() => { cancelCommand(pair.id, r.pending!.id).catch(failed); }}
                style={[styles.undo, { minHeight: touchSize(isSimple), borderColor: COLORS.primary }]}
                accessibilityRole="button"
                accessibilityLabel={`${t('care.undo')}: ${r.dose.time} ${r.dose.name}`}
              >
                <Typography color={COLORS.primary} style={styles.bold}>{t('care.undo')}</Typography>
              </TouchableOpacity>
            </View>
          ) : (r.state === 'waiting' || r.state === 'late') && r.dose.at <= now ? ( // a dose still ahead can't be marked yet
            <View style={[styles.row, styles.gap]}>
              <Button title={t('care.mark_taken')} style={styles.flex1} onPress={() => mark(r, 'taken')}
                accessibilityLabel={t('care.mark_taken_a11y', { time: r.dose.time, med: r.dose.name })} />
              <Button title={t('care.mark_skipped')} variant="secondary" style={styles.flex1} onPress={() => mark(r, 'skipped')}
                accessibilityLabel={t('care.mark_skipped_a11y', { time: r.dose.time, med: r.dose.name })} />
            </View>
          ) : null}
        </Card>
      ))}

      {/* Water */}
      <Card style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="water" size={iconSize} color={COLORS.water} />
          <Typography variant="subheader" style={styles.flex1}>{t('care.water_title')}</Typography>
        </View>
        {water ? (
          <>
            <Typography style={styles.gap}>{t('pairing.water_summary', { ml: waterMl, goal: water.goal })}</Typography>
            <Bar value={water.goal ? waterMl / water.goal : 0} color={COLORS.water} track={COLORS.waterLight}
              label={t('pairing.water_summary', { ml: waterMl, goal: water.goal })} />
            {waterPending > 0 && <Typography variant="caption" color={COLORS.textSecondary} style={styles.gap}>{t('care.water_pending', { ml: waterPending, name })}</Typography>}
            <Button title={t('care.water_add', { ml: GLASS_ML })} variant="secondary" style={styles.gap}
              onPress={() => { sendCommand(pair, { type: 'water', ml: GLASS_ML }).catch(failed); }} />
          </>
        ) : (
          <Typography variant="caption" color={COLORS.textSecondary} style={styles.gap}>{t('care.water_off', { name })}</Typography>
        )}
      </Card>

      {/* Recent events */}
      <Typography variant="subheader" style={styles.section}>{t('care.recent')}</Typography>
      <Card style={styles.card}>
        {events.length === 0 ? (
          <Typography variant="caption" color={COLORS.textSecondary}>{t('pairing.feed_empty')}</Typography>
        ) : events.slice(0, 10).map(e => (
          <View key={e.id} style={[styles.row, styles.feedRow]} accessible>
            <Ionicons name={EVENT_ICON[e.type]} size={18} color={color[e.type]} />
            <Typography style={styles.flex1}>{eventLine(e)}</Typography>
            <Typography variant="caption" color={COLORS.textSecondary}>{e.date.slice(8, 10)}.{e.date.slice(5, 7)}</Typography>
          </View>
        ))}
      </Card>
    </>
  );
};

/**
 * Caregiver mode's only main screen (no tabs): the followed person's day under its own gradient band.
 * In 'self' mode the same screen opens from Home's CareProfileSwitch, with a back arrow instead of the gear.
 */
const CareHomeScreen: React.FC<any> = ({ navigation, route }) => {
  const isRoot = useAppContext().appSettings.appMode === 'caregiver';
  const { COLORS, isDark, isSimple } = useTheme();
  const insets = useSafeAreaInsets();
  const configured = isPairingConfigured();
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [error, setError] = useState(false);
  const [nicks, setNicks] = useState<Record<string, string>>({});
  const [lateMin, setLateMin] = useState<number>(LATE_MINUTES);
  const [selected, setSelected] = useState<string | undefined>(route?.params?.pairId);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { if (route?.params?.pairId) setSelected(route.params.pairId); }, [route?.params?.pairId]);

  const loadPrefs = useCallback(() => { getNicknames().then(setNicks); getLateMinutes().then(setLateMin); }, []);
  // Nicknames / alarm delay may change in CareSettings.
  useEffect(() => navigation.addListener('focus', loadPrefs), [navigation, loadPrefs]);
  useEffect(() => {
    if (!configured) return;
    return watchPairs(p => { setPairs(p.asCaregiver); setError(false); }, e => { console.warn('[care] pairs', e); setError(true); });
  }, [configured, refreshKey]);

  // Listeners are live already; pulling re-subscribes (after a network hiccup) and re-reads local prefs.
  const onRefresh = () => {
    setRefreshing(true);
    loadPrefs();
    setRefreshKey(k => k + 1);
    requestAlarmSync();
    setTimeout(() => setRefreshing(false), 600);
  };

  const pair = pickPair(pairs, selected);
  const name = pair ? displayName(pair, nicks) : '';
  const onBand = COLORS.onPrimary;
  const hit = touchSize(isSimple);

  return (
    <ScreenWrapper edges={['left', 'right']}>
      <StatusBar barStyle={isDark ? 'dark-content' : 'light-content'} backgroundColor={COLORS.secondary} />
      <LinearGradient colors={[COLORS.secondary, COLORS.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.band, { paddingTop: insets.top + SPACING.sm }]}>
        <View style={styles.row}>
          {!isRoot && (
            <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.iconBtn, { minWidth: hit, minHeight: hit }]} accessibilityRole="button" accessibilityLabel={t('common.back')}>
              <Ionicons name="arrow-back" size={26} color={onBand} />
            </TouchableOpacity>
          )}
          <View style={styles.flex1}>
            <Typography variant="caption" color={onBand} style={styles.kicker}>{upper(t('care.following_label'))}</Typography>
            <Typography variant="header" color={onBand} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{name || t('tabs.tracker')}</Typography>
          </View>
          {isRoot && (
            <TouchableOpacity onPress={() => navigation.navigate('CareSettings')} style={[styles.iconBtn, { minWidth: hit, minHeight: hit }]} accessibilityRole="button" accessibilityLabel={t('tabs.settings')}>
              <Ionicons name="settings-outline" size={28} color={onBand} />
            </TouchableOpacity>
          )}
        </View>
        {pairs && pairs.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist" accessibilityLabel={t('care.pick_person')}>
            {pairs.map(p => {
              const on = p.id === pair?.id;
              const label = displayName(p, nicks);
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setSelected(p.id)}
                  style={[styles.chip, { minHeight: hit, borderColor: onBand + '80', backgroundColor: on ? onBand : 'transparent' }]}
                  accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t('care.open_person', { name: label })}
                >
                  <Typography style={styles.bold} color={on ? COLORS.secondary : onBand}>{label}</Typography>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </LinearGradient>

      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={configured ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} /> : undefined}
        >
          {!configured || error ? (
            <Card style={styles.card}><Typography>{!configured ? t('pairing.not_configured') : t('pairing.err_generic')}</Typography></Card>
          ) : pairs === null ? (
            <ActivityIndicator size="large" color={COLORS.primary} style={styles.loading} />
          ) : !pair ? (
            <Card style={styles.card}>
              <View style={styles.emptyIcon}>
                <Ionicons name="people-circle-outline" size={isSimple ? 88 : 72} color={COLORS.secondary} />
              </View>
              <Typography variant="subheader" style={styles.center}>{t('care.empty_title')}</Typography>
              <Typography color={COLORS.textSecondary} style={[styles.gap, styles.center]}>{t('care.empty_desc')}</Typography>
              <JoinCodeCard primary autoFocus={route?.params?.mode === 'join'} onJoined={p => setSelected(p.id)} />
              {isRoot && (
                <TouchableOpacity onPress={() => navigation.navigate('SelfSetup')} style={[styles.link, { minHeight: hit }]} accessibilityRole="link">
                  <Typography color={COLORS.primary} style={styles.bold}>{t('care.start_self')}</Typography>
                </TouchableOpacity>
              )}
            </Card>
          ) : (
            <PersonDay key={`${pair.id}_${refreshKey}`} pair={pair} name={name} lateMin={lateMin} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  band: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.md, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  kicker: { opacity: 0.9, letterSpacing: 0.8 },
  chips: { gap: 8, paddingTop: SPACING.sm },
  chip: { paddingHorizontal: 18, borderRadius: 14, borderWidth: 1, justifyContent: 'center' },
  content: { padding: SPACING.md },
  flex1: { flex: 1 },
  card: { marginBottom: SPACING.md },
  section: { marginTop: SPACING.sm, marginBottom: SPACING.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  gap: { marginTop: 8 },
  feedRow: { marginBottom: 8 },
  time: { minWidth: 64, fontVariant: ['tabular-nums'] },
  bold: { fontWeight: '700' },
  center: { textAlign: 'center' },
  undo: { justifyContent: 'center', paddingHorizontal: 16, borderRadius: 12, borderWidth: 1 },
  iconBtn: { alignItems: 'center', justifyContent: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, marginTop: 8 },
  bar: { height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 10 },
  barFill: { height: '100%', borderRadius: 5 },
  lateStrip: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 12, borderRadius: 14, borderLeftWidth: 4 },
  emptyIcon: { alignItems: 'center', marginBottom: SPACING.sm },
  link: { alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  loading: { marginTop: SPACING.xl },
});

export default CareHomeScreen;
