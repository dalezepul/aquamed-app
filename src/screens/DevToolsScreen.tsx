import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Switch, TextInput, Platform, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAppContext } from '../state/AppContext';
import { useTheme, SPACING } from '../constants/theme';
import { Typography } from '../components/common/Typography';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { ScreenHeader } from '../components/common/ScreenHeader';
import { ScreenWrapper } from '../components/common/ScreenWrapper';
import { useToast } from '../hooks/useToast';
import { storageService, STORAGE_KEYS } from '../services/storageService';
import { notificationService, CARE_TEST_PREFIX } from '../services/notificationService';
import { eventMessage } from '../services/pairing';
import { MAX_PENDING, PlannedData, PlannedNotification } from '../services/notificationPlan';
import { badgeService } from '../services/badgeService';
import { backupService } from '../services/exportService';
import { Badge, Medication } from '../types/models';
import { t } from '../localization/i18n';
import { confirm } from '../utils/confirm';
import { getLocalDayString, formatLocalTime } from '../utils/DateUtils';
import { setDevPlus, usePlus, isStoreConfigured, DEV_PLUS_ALLOWED } from '../services/entitlement';
import { HAPTIC_LEVEL_METHOD, HAPTIC_METHODS, resolveHapticLevel, runHapticMethod } from '../utils/haptics';
import { adsStatus, devShowInterstitial, resetAdCounters, showRewardedAd, initAds } from '../services/ads';

const isWeb = Platform.OS === 'web';
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const TABS = ['general', 'data', 'storage', 'notifications', 'badges', 'diag'] as const;
type Tab = typeof TABS[number];

type Colors = ReturnType<typeof useTheme>['COLORS'];
/** Runs a DevTools action: optional confirm, snapshot for undo, refresh + reschedule, toast. */
type Act = (label: string, fn: () => Promise<unknown>, opts?: { ask?: string; destructive?: boolean; undoable?: boolean }) => Promise<void>;
interface TabProps { C: Colors; act: Act; busy: boolean; dataVersion: number }

const fmt = (d: Date) => `${getLocalDayString(d)} ${formatLocalTime(d)}`;
/** Fire time of a pending request (Android date trigger: `value`; iOS: `date`), NaN if unknown. */
const firesAt = (r: { trigger: unknown }) => { const tr: any = r.trigger; return Number(new Date(tr?.value ?? tr?.date ?? NaN)); };
/** DevTools label key of a notification's data.type; every caregiver alarm (care_late, care) is "Yakın". */
const ntype = (type: unknown) => `devtools.ntype_${String(type ?? 'other').startsWith('care') ? 'care' : String(type ?? 'other')}`;

const Row = ({ C, label, value }: { C: Colors; label: string; value: string }) => (
  <View style={[styles.row, { borderBottomColor: C.lightGray }]}>
    <Typography variant="caption" color={C.textSecondary} style={styles.flex1}>{label}</Typography>
    <Typography variant="caption" color={C.text} style={styles.bold}>{value}</Typography>
  </View>
);

const Section = ({ C, title, children }: { C: Colors; title: string; children: React.ReactNode }) => (
  <Card style={styles.card}>
    <Typography variant="subheader" color={C.text} style={styles.sectionTitle}>{title}</Typography>
    {children}
  </Card>
);

// --- 1. Genel ---------------------------------------------------------------

const GeneralTab = ({ C, dataVersion, onDisableDev }: TabProps & { onDisableDev: () => void }) => {
  const [info, setInfo] = useState<{ schema: string; meds: number; logs: number; water: number; perm: boolean } | null>(null);
  useEffect(() => {
    Promise.all([
      storageService.getRawData(STORAGE_KEYS.DATA_VERSION),
      storageService.getMedications(),
      storageService.getAllMedicationLogs(),
      storageService.getAllWaterLogs(),
      notificationService.hasPermission().catch(() => false),
    ]).then(([schema, meds, logs, water, perm]) =>
      setInfo({ schema: schema ?? '—', meds: meds.length, logs: logs.length, water: water.length, perm }));
  }, [dataVersion]);

  return (
    <>
      <Section C={C} title={t('devtools.tab_general')}>
        <Row C={C} label={t('devtools.app_version')} value={Constants.expoConfig?.version ?? '—'} />
        <Row C={C} label={t('devtools.schema_version')} value={info?.schema ?? '…'} />
        <Row C={C} label={t('devtools.count_meds')} value={String(info?.meds ?? '…')} />
        <Row C={C} label={t('devtools.count_logs')} value={String(info?.logs ?? '…')} />
        <Row C={C} label={t('devtools.count_water')} value={String(info?.water ?? '…')} />
        <Row C={C} label={t('devtools.notif_permission')}
          value={isWeb ? t('devtools.web_unsupported') : info ? t(info.perm ? 'devtools.granted' : 'devtools.denied') : '…'} />
        <Row C={C} label={t('devtools.platform')} value={`${Platform.OS} ${Platform.Version ?? ''}`} />
      </Section>
      <MonetizationSection C={C} />
      <HapticsTestSection C={C} />
      <Button title={t('devtools.disable_dev')} variant="destructive" onPress={onDisableDev} />
    </>
  );
};

const MonetizationSection = ({ C }: { C: Colors }) => {
  const { showToast } = useToast();
  const plus = usePlus();
  const [status, setStatus] = useState(adsStatus());
  const done = (ok: boolean) => {
    setStatus(adsStatus());
    showToast({ message: t(ok ? 'devtools.ads_shown' : 'devtools.ads_unavailable'), type: ok ? 'success' : 'warning' });
  };
  const rewarded = async () => {
    if (!(await initAds())) return done(false);
    const earned = await showRewardedAd();
    if (earned) await storageService.recordRewardedAd();
    done(earned);
  };
  return (
    <Section C={C} title={t('devtools.section_plus_ads')}>
      {DEV_PLUS_ALLOWED && (
        <View style={[styles.row, styles.touchRow, { borderBottomColor: C.lightGray }]}>
          <Typography style={styles.flex1}>{t('devtools.plus_sim')}</Typography>
          <Switch value={plus} accessibilityLabel={t('devtools.plus_sim')} onValueChange={on => { setDevPlus(on); }} />
        </View>
      )}
      <Row C={C} label={t('devtools.store_configured_play')} value={t(isStoreConfigured() ? 'devtools.granted' : 'devtools.denied')} />
      <Row C={C} label={t('devtools.ads_status')} value={isWeb ? t('devtools.web_unsupported') : `${status.ready ? 'ready' : 'off'} · ${status.isTestBuild ? 'TestIds' : 'live'} · npa=${status.nonPersonalized} · ${status.shownToday}/4`} />
      <Button style={styles.btn} variant="secondary" title={t('devtools.test_interstitial')} onPress={() => devShowInterstitial().then(done)} />
      <Button style={styles.btn} variant="secondary" title={t('devtools.test_rewarded')} onPress={rewarded} />
      <Button style={styles.btn} variant="secondary" title={t('devtools.reset_ad_counters')}
        onPress={() => resetAdCounters().then(() => { setStatus(adsStatus()); showToast({ message: t('devtools.done', { action: t('devtools.reset_ad_counters') }), type: 'success' }); })} />
    </Section>
  );
};

/** Every vibration method side by side (same list as Settings → Vibration), labelled by its technical id. */
const HapticsTestSection = ({ C }: { C: Colors }) => {
  const { showToast } = useToast();
  const { appSettings } = useAppContext();
  const run = async (id: string) => {
    try { await runHapticMethod(id); } catch (e: any) { showToast({ message: `${id}: ${e?.message ?? 'unsupported'}`, type: 'error' }); }
  };
  return (
    <Section C={C} title={t('devtools.haptics_test')}>
      <Typography variant="caption" color={C.textSecondary}>{t('devtools.haptics_test_hint')}</Typography>
      <Row C={C} label={t('settings.haptic_subtle')} value={HAPTIC_LEVEL_METHOD.subtle.label} />
      <Row C={C} label={t('settings.haptic_light')} value={HAPTIC_LEVEL_METHOD.light.label} />
      <Row C={C} label={t('devtools.haptics_current')} value={t(`settings.haptic_${resolveHapticLevel(appSettings)}`)} />
      <View style={styles.inline}>
        {HAPTIC_METHODS.map(id => (
          // hapticType none: the button's own press feedback would mask the effect under test.
          <Button key={id} style={styles.hapticBtn} textStyle={styles.hapticText} variant="secondary" hapticType="none" title={id} onPress={() => run(id)} />
        ))}
      </View>
    </Section>
  );
};

// --- 2. Veri ----------------------------------------------------------------

const DataTab = ({ C, act, busy, onWipe, onReonboard }: TabProps & { onWipe: () => void; onReonboard: () => void }) => {
  const { showToast } = useToast();
  const fail = (action: string) => (e: any) => showToast({ message: t('devtools.failed', { action, reason: e?.message ?? '' }), type: 'error' });
  const restore = async () => {
    const backup = await backupService.pickBackup();
    if (backup) await act(t('devtools.restore_json'), () => backupService.restore(backup), { ask: t('devtools.ask_restore'), destructive: true, undoable: true });
  };
  return (
    <>
      <Section C={C} title={t('devtools.section_fake')}>
        <Typography variant="caption" color={C.textSecondary}>{t('devtools.undo_hint')}</Typography>
        <Button style={styles.btn} disabled={busy} title={t('devtools.demo_data')}
          onPress={() => act(t('devtools.demo_data'), () => storageService.injectDemoData(7), { ask: t('devtools.ask_demo'), destructive: true, undoable: true })} />
        <Button style={styles.btn} disabled={busy} variant="secondary" title={t('devtools.mark_today')}
          onPress={() => act(t('devtools.mark_today'), () => storageService.markAllDosesTakenToday(), { undoable: true })} />
        <View style={styles.inline}>
          {[3, 7, 30].map(n => (
            <Button key={n} style={styles.inlineBtn} disabled={busy} variant="secondary" title={t('devtools.streak_n', { n })}
              onPress={() => act(t('devtools.streak_n', { n }), () => storageService.injectStreakLogs(n), { undoable: true })} />
          ))}
        </View>
      </Section>
      <Section C={C} title={t('devtools.section_backup')}>
        <Button style={styles.btn} disabled={busy} variant="secondary" title={t('devtools.backup_json')}
          onPress={() => backupService.exportBackup().catch(fail(t('devtools.backup_json')))} />
        <Button style={styles.btn} disabled={busy} variant="secondary" title={t('devtools.restore_json')}
          onPress={() => restore().catch(fail(t('devtools.restore_json')))} />
      </Section>
      <Section C={C} title={t('devtools.section_reset')}>
        <Button style={styles.btn} disabled={busy} variant="secondary" title={t('devtools.reonboard')} onPress={onReonboard} />
        <Button style={styles.btn} disabled={busy} variant="destructive" title={t('devtools.wipe_all')} onPress={onWipe} />
      </Section>
    </>
  );
};

// --- 3. Depo gezgini --------------------------------------------------------

const StorageTab = ({ C, act, busy, dataVersion }: TabProps) => {
  const { showToast } = useToast();
  const [keys, setKeys] = useState<string[]>([]);
  const [key, setKey] = useState<string | null>(null);
  const [raw, setRaw] = useState('');
  const [draft, setDraft] = useState<string | null>(null); // non-null = editing
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { storageService.getAllStorageKeys().then(k => setKeys([...k].sort())); }, [dataVersion]);

  const open = useCallback(async (k: string) => {
    const v = (await storageService.getRawData(k)) ?? '';
    let pretty = v;
    try { pretty = JSON.stringify(JSON.parse(v), null, 2); } catch { /* not JSON: show as is */ }
    setKey(k); setRaw(pretty); setDraft(null); setError(null);
  }, []);

  useEffect(() => { if (key) open(key); }, [dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    if (!key || draft == null) return;
    try { JSON.parse(draft); } catch (e: any) { setError(t('devtools.invalid_json', { reason: e?.message ?? '' })); return; }
    act(t('devtools.save_key'), () => storageService.setRawData(key, JSON.stringify(JSON.parse(draft))), { undoable: true });
  };
  const remove = () => {
    if (!key) return;
    act(t('devtools.delete_key'), async () => { await AsyncStorage.removeItem(key); setKey(null); },
      { ask: t('devtools.ask_delete_key', { key }), destructive: true, undoable: true });
  };

  return (
    <>
      <Section C={C} title={t('devtools.keys_count', { n: keys.length })}>
        {keys.map(k => (
          <Pressable key={k} onPress={() => open(k)} accessibilityRole="button" accessibilityState={{ selected: k === key }}
            style={[styles.row, styles.touchRow, { borderBottomColor: C.lightGray }, k === key && { backgroundColor: C.waterLight }]}>
            <Typography variant="caption" color={C.text} numberOfLines={1} style={[styles.flex1, { fontFamily: MONO }]}>{k}</Typography>
            <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
          </Pressable>
        ))}
      </Section>
      {key && (
        <Section C={C} title={key}>
          {draft == null ? (
            <ScrollView style={[styles.code, { backgroundColor: C.lightGray }]} nestedScrollEnabled>
              <Typography variant="caption" color={C.text} style={{ fontFamily: MONO }}>{raw || '—'}</Typography>
            </ScrollView>
          ) : (
            <TextInput
              value={draft}
              onChangeText={v => { setDraft(v); setError(null); }}
              multiline autoCapitalize="none" autoCorrect={false} spellCheck={false}
              accessibilityLabel={t('devtools.edit_value', { key })}
              style={[styles.code, styles.editor, { backgroundColor: C.lightGray, color: C.text, borderColor: error ? C.error : C.border }]}
            />
          )}
          {error && <Typography variant="caption" color={C.error} style={styles.btn}>{error}</Typography>}
          <View style={styles.inline}>
            {draft == null ? (
              <>
                <Button style={styles.inlineBtn} disabled={busy} variant="secondary" title={t('devtools.edit')} onPress={() => setDraft(raw)} />
                <Button style={styles.inlineBtn} variant="secondary" title={t('devtools.copy')}
                  onPress={() => Clipboard.setStringAsync(raw).then(() => showToast({ message: t('devtools.copied'), type: 'success' }))} />
                <Button style={styles.inlineBtn} disabled={busy} variant="destructive" title={t('common.delete')} onPress={remove} />
              </>
            ) : (
              <>
                <Button style={styles.inlineBtn} disabled={busy} title={t('common.save')} onPress={save} />
                <Button style={styles.inlineBtn} variant="secondary" title={t('common.cancel')} onPress={() => { setDraft(null); setError(null); }} />
              </>
            )}
          </View>
        </Section>
      )}
    </>
  );
};

// --- 4. Bildirimler ---------------------------------------------------------

const NotificationsTab = ({ C, act, busy, dataVersion }: TabProps) => {
  const [plan, setPlan] = useState<PlannedNotification[]>([]);
  const [pending, setPending] = useState<Awaited<ReturnType<typeof notificationService.getPending>>>([]);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    notificationService.previewPlan().then(setPlan).catch(() => setPlan([]));
    notificationService.getPending().then(setPending).catch(() => setPending([]));
    storageService.getMedications().then(setMeds);
  }, [dataVersion, tick]);

  const medName = (d: PlannedData) => ('medicationId' in d ? meds.find(m => m.id === d.medicationId)?.name : undefined) ?? '';
  const test = (type: PlannedData['type']) => {
    const date = getLocalDayString();
    const data: PlannedData =
      type === 'water' ? { type, date }
      : type === 'nudge' ? { type, date, remainingMl: 750, streak: 5 }
      : type === 'reopen' ? { type }
      : { type, medicationId: meds[0]?.id ?? 'devtools-test', date, time: formatLocalTime(new Date()) };
    act(t('devtools.test_sent'), () => notificationService.sendTest(data));
  };
  // Same path as a real caregiver alarm (setCareAlarms, care_ id, escalation channel), 1 minute from now.
  const testCare = () => act(t('devtools.care_test'), async () => {
    if (!(await notificationService.ensurePermissions())) throw new Error('Notification permission denied');
    const now = new Date();
    await notificationService.setCareAlarms([{
      id: `${CARE_TEST_PREFIX}${now.getTime()}`, at: new Date(now.getTime() + 60000),
      ...eventMessage({ type: 'late', medName: meds[0]?.name ?? t('notifications.test_med'), dose: '', time: formatLocalTime(now) }, ''),
      data: { type: 'care_late', pairId: 'devtools' },
    }]);
  }).then(() => setTick(x => x + 1));
  const sortedPending = [...pending].sort((a, b) => (firesAt(a) || Infinity) - (firesAt(b) || Infinity));
  const reload = (fn: () => Promise<unknown>, label: string, ask?: string) =>
    act(label, fn, { ask, destructive: !!ask }).then(() => setTick(x => x + 1));

  return (
    <>
      {isWeb && <Typography variant="caption" color={C.warning} style={styles.card}>{t('devtools.web_no_notifications')}</Typography>}
      <Section C={C} title={t('devtools.section_actions')}>
        <View style={styles.inline}>
          <Button style={styles.inlineBtn} disabled={busy} title={t('devtools.reschedule')} onPress={() => reload(() => notificationService.rescheduleAll(), t('devtools.reschedule'))} />
          <Button style={styles.inlineBtn} disabled={busy} variant="destructive" title={t('devtools.cancel_all_short')}
            onPress={() => reload(() => notificationService.cancelAll(), t('devtools.cancel_all_short'), t('devtools.ask_cancel_all'))} />
        </View>
        <Typography variant="caption" color={C.textSecondary} style={styles.btn}>{t('devtools.test_hint')}</Typography>
        <View style={styles.inline}>
          {(['dose', 'escalation', 'water', 'dose_presleep', 'nudge', 'reopen'] as const).map(type => (
            <Button key={type} style={styles.inlineBtn} disabled={busy} variant="secondary" title={t(`devtools.ntype_${type}`)} onPress={() => test(type)} />
          ))}
        </View>
        <Button style={styles.btn} disabled={busy} variant="secondary" title={t('devtools.care_test')} onPress={testCare} />
      </Section>
      <Section C={C} title={t('devtools.pending_title', { n: pending.length, max: MAX_PENDING })}>
        {pending.length === 0 && <Typography variant="caption" color={C.textSecondary}>{t('devtools.empty')}</Typography>}
        {sortedPending.map(r => {
          const at = firesAt(r);
          return (
            <Row key={r.identifier} C={C} label={`${at ? fmt(new Date(at)) : '—'} · ${t(ntype((r.content.data as any)?.type))}`}
              value={r.content.title ?? ''} />
          );
        })}
      </Section>
      <Section C={C} title={t('devtools.plan_title', { n: plan.length })}>
        {plan.length === 0 && <Typography variant="caption" color={C.textSecondary}>{t('devtools.empty')}</Typography>}
        {plan.map((p, i) => (
          <Row key={i} C={C} label={`${fmt(p.at)}  ${t(`devtools.ntype_${p.data.type}`)}`} value={medName(p.data)} />
        ))}
      </Section>
    </>
  );
};

// --- 5. Rozetler ------------------------------------------------------------

const BadgesTab = ({ C, act, busy, dataVersion }: TabProps) => {
  const [badges, setBadges] = useState<Badge[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => { badgeService.getBadges().then(setBadges); }, [dataVersion, tick]);
  const earned = badges.filter(b => b.earned).length;

  return (
    <Section C={C} title={t('devtools.badges_title', { n: earned, total: badges.length })}>
      <Button style={styles.btn} disabled={busy} variant="secondary" title={t('devtools.reevaluate')}
        onPress={() => act(t('devtools.reevaluate'), () => badgeService.evaluate()).then(() => setTick(x => x + 1))} />
      {badges.map(b => {
        const name = t(b.nameKey);
        return (
          <View key={b.id} style={[styles.row, styles.touchRow, { borderBottomColor: C.lightGray }]}>
            <View style={styles.flex1}>
              <Typography variant="caption" color={C.text} style={styles.bold}>{name}</Typography>
              <Typography variant="caption" color={C.textMuted} style={{ fontFamily: MONO }}>{b.id}</Typography>
            </View>
            <Switch
              value={b.earned}
              disabled={busy}
              accessibilityLabel={name}
              trackColor={{ true: C.primary, false: C.border }}
              onValueChange={async () => { await storageService.toggleBadge(b.id); setTick(x => x + 1); }}
            />
          </View>
        );
      })}
    </Section>
  );
};

// --- 6. Tanı ----------------------------------------------------------------

/** Throws during render so the app's ErrorBoundary catches it (an event-handler throw would not be caught). */
const RenderBomb = (): React.ReactElement => { throw new Error('DevTools: render-time test error'); };

const DiagTab = ({ C }: TabProps) => {
  const [boom, setBoom] = useState(false);
  return (
    <Section C={C} title={t('devtools.tab_diag')}>
      <Typography variant="caption" color={C.textSecondary}>{t('devtools.boundary_hint')}</Typography>
      <Button style={styles.btn} variant="destructive" title={t('devtools.boundary_test')}
        onPress={async () => { if (await confirm(t('devtools.boundary_test'), t('devtools.boundary_hint'), t('devtools.confirm_yes'), true)) setBoom(true); }} />
      {boom && <RenderBomb />}
    </Section>
  );
};

// --- Ekran ------------------------------------------------------------------

const DevToolsScreen: React.FC = ({ navigation }: any) => {
  const { COLORS: C } = useTheme();
  const { refreshAppData, dispatch, dataVersion } = useAppContext();
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>('general');
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<{ label: string; data: Record<string, string> } | null>(null);

  const act: Act = useCallback(async (label, fn, opts = {}) => {
    if (opts.ask && !(await confirm(label, opts.ask, t('devtools.confirm_yes'), opts.destructive))) return;
    setBusy(true);
    try {
      const snapshot = opts.undoable ? await storageService.exportAllData() : null;
      await fn();
      if (snapshot) setUndo({ label, data: snapshot });
      await refreshAppData();
      notificationService.rescheduleAll().catch(() => undefined);
      showToast({ message: t('devtools.done', { action: label }), type: 'success' });
    } catch (e: any) {
      showToast({ message: t('devtools.failed', { action: label, reason: e?.message ?? '' }), type: 'error' });
    } finally {
      setBusy(false);
    }
  }, [refreshAppData, showToast]);

  const undoLast = () => {
    if (!undo) return;
    act(t('devtools.undo_short'), async () => { await storageService.importAllData(undo.data); setUndo(null); });
  };

  const disableDev = () => {
    dispatch({ type: 'SET_VALUE', key: 'isDevMode', payload: false });
    navigation.goBack();
  };

  const wipe = async () => {
    if (!(await confirm(t('devtools.wipe_all'), t('devtools.ask_wipe'), t('common.delete'), true))) return;
    try {
      await storageService.clearAllAppData();
      await notificationService.cancelAll();
      dispatch({ type: 'RESET_STATE' });
    } catch (e: any) {
      showToast({ message: t('devtools.failed', { action: t('devtools.wipe_all'), reason: e?.message ?? '' }), type: 'error' });
    }
  };

  const reonboard = async () => {
    if (await confirm(t('devtools.reonboard'), t('devtools.ask_reonboard'), t('devtools.confirm_yes'))) {
      dispatch({ type: 'SET_HAS_ONBOARDED', payload: false });
    }
  };

  const props: TabProps = { C, act, busy, dataVersion };

  return (
    <ScreenWrapper edges={['top', 'bottom', 'left', 'right']}>
      <ScreenHeader title={t('devtools.panel_title')} onBackPress={() => navigation.goBack()} />
      <View style={[styles.banner, { backgroundColor: C.warning + '22', borderColor: C.warning }]} accessibilityRole="alert">
        <Ionicons name="warning-outline" size={16} color={C.warning} />
        <Typography variant="caption" color={C.warning} style={[styles.flex1, styles.bold]}>{t('devtools.banner')}</Typography>
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist"
          contentContainerStyle={styles.tabBar} style={{ borderBottomWidth: 1, borderBottomColor: C.lightGray }}>
          {TABS.map(k => {
            const active = k === tab;
            return (
              <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: active }}
                style={[styles.tab, active && { borderBottomColor: C.primary }]}>
                <Typography variant="caption" color={active ? C.primary : C.textSecondary} style={styles.bold}>{t(`devtools.tab_${k}`)}</Typography>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {undo && (
            <Button style={styles.card} disabled={busy} variant="secondary" title={t('devtools.undo', { action: undo.label })} onPress={undoLast} />
          )}
          {tab === 'general' && <GeneralTab {...props} onDisableDev={disableDev} />}
          {tab === 'data' && <DataTab {...props} onWipe={wipe} onReonboard={reonboard} />}
          {tab === 'storage' && <StorageTab {...props} />}
          {tab === 'notifications' && <NotificationsTab {...props} />}
          {tab === 'badges' && <BadgesTab {...props} />}
          {tab === 'diag' && <DiagTab {...props} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  bold: { fontWeight: '700' },
  content: { padding: SPACING.md, paddingBottom: SPACING.xl },
  card: { marginBottom: SPACING.md },
  sectionTitle: { marginBottom: SPACING.sm },
  btn: { marginTop: SPACING.sm },
  inline: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.sm },
  inlineBtn: { flexGrow: 1, minWidth: 96 },
  hapticBtn: { flexGrow: 1, minWidth: 140, paddingHorizontal: SPACING.sm },
  hapticText: { fontFamily: MONO, fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  touchRow: { minHeight: 48, paddingHorizontal: 4 },
  code: { maxHeight: 360, padding: SPACING.sm, borderRadius: 8 },
  editor: { minHeight: 200, borderWidth: 1, fontFamily: MONO, fontSize: 12, textAlignVertical: 'top' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: SPACING.md, marginBottom: SPACING.sm, paddingHorizontal: SPACING.sm, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  tabBar: { paddingHorizontal: SPACING.sm },
  tab: { minHeight: 44, paddingHorizontal: SPACING.md, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
});

export default DevToolsScreen;
