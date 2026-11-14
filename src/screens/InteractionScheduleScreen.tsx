import React, { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { NativeStackScreenProps as StackScreenProps } from '@react-navigation/native-stack';
import { CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { useAppContext } from '../state/AppContext';
import { useTheme, SPACING } from '../constants/theme';
import { t } from '../localization/i18n';
import { ScreenWrapper } from '../components/common/ScreenWrapper';
import { ScreenHeader } from '../components/common/ScreenHeader';
import { Typography } from '../components/common/Typography';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { storageService } from '../services/storageService';
import { notificationService } from '../services/notificationService';
import { checkInteractions, INTERACTION_DISCLAIMER } from '../services/drugInteractionService';
import { suggestSpacedTimes } from '../services/interactionSchedule';
import { FoodTiming, Medication } from '../types/models';
import { useToast } from '../hooks/useToast';
import { confirm } from '../utils/confirm';

/** The medication being added/edited on AddEditMedication (not saved yet). */
export interface DraftMed { id: string; name: string; times: string[]; foodTiming: FoodTiming; priority?: string }

interface Row { id: string; name: string; times: string[]; foodTiming: FoodTiming; priority?: string; isNew?: boolean; saved?: Medication }

const join = (times: string[]) => times.join(' · ');

const InteractionScheduleScreen: React.FC<StackScreenProps<any>> = ({ navigation, route }) => {
  const { COLORS } = useTheme();
  const { sleepSettings, refreshAppData } = useAppContext();
  const { showToast } = useToast();
  const draft: DraftMed = route.params?.draft;
  const returnKey: string | undefined = route.params?.returnKey;
  // The draft is the one to move; existing (esp. empty-stomach / high-priority) meds stay put.
  const [rows, setRows] = useState<Row[]>([{ ...draft, isNew: true }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    storageService.getMedications().then(meds => {
      const others = meds.filter(m => m.id !== draft.id && checkInteractions(draft.name, [m.name]).interactions.length > 0);
      setRows([{ ...draft, isNew: true }, ...others.map(m => ({ id: m.id, name: m.name, times: m.times, foodTiming: m.foodTiming, priority: m.priority, saved: m }))]);
    });
  }, []);

  const result = useMemo(() => suggestSpacedTimes(rows, sleepSettings.end, sleepSettings.start), [rows, sleepSettings]);
  const spacedIds = new Set(result.spaced.flatMap(p => [p.a, p.b]));
  const nameOf = (id: string) => rows.find(r => r.id === id)?.name ?? '';
  const changed = rows.filter(r => { const s = result.suggested[r.id]; return s && join(s) !== join(r.times); });

  /** Saved meds go to storage; the draft goes back to the form (saved with it). */
  const write = async (row: Row, times: string[]) => {
    if (row.saved) await storageService.saveMedication({ ...row.saved, times });
    else if (returnKey) navigation.dispatch({ ...CommonActions.setParams({ suggestedTimes: times }), source: returnKey });
    setRows(prev => prev.map(r => (r.id === row.id ? { ...r, times, saved: r.saved && { ...r.saved, times } } : r)));
  };

  const finish = async () => {
    await notificationService.rescheduleAll().catch(e => console.warn('rescheduleAll failed', e));
    await refreshAppData();
  };

  const applyOne = async (row: Row) => {
    const times = result.suggested[row.id];
    if (!times || busy) return;
    const ok = await confirm(
      t('interaction_schedule.apply_title'),
      t('interaction_schedule.apply_confirm', { name: row.name, from: join(row.times), to: join(times) }),
      t('interaction_schedule.apply'),
    );
    if (!ok) return;
    setBusy(true);
    try {
      await write(row, times);
      if (row.saved) await finish();
      showToast({ message: t('interaction_schedule.applied', { name: row.name }), type: 'success' });
    } catch (e) {
      console.error(e);
      showToast({ message: t('common.save_error'), type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const applyAll = async () => {
    if (!changed.length || busy) return;
    const ok = await confirm(
      t('interaction_schedule.apply_title'),
      t('interaction_schedule.apply_all_confirm', { names: changed.map(r => r.name).join(', ') }),
      t('interaction_schedule.apply_all'),
    );
    if (!ok) return;
    setBusy(true);
    try {
      for (const row of changed) await write(row, result.suggested[row.id]!);
      if (changed.some(r => r.saved)) await finish();
      showToast({ message: t('interaction_schedule.applied_all'), type: 'success' });
      navigation.goBack();
    } catch (e) {
      console.error(e);
      showToast({ message: t('common.save_error'), type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenWrapper edges={['top', 'bottom', 'left', 'right']}>
      <ScreenHeader title={t('interaction_schedule.title')} onBackPress={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Typography color={COLORS.textSecondary} style={styles.intro}>{t('interaction_schedule.intro')}</Typography>

        {rows.map((row, i) => {
          const s = result.suggested[row.id];
          const moves = !!s && join(s) !== join(row.times);
          return (
            <Pressable
              key={row.id}
              onPress={() => applyOne(row)}
              disabled={!moves || busy}
              accessibilityRole="button"
              accessibilityState={{ disabled: !moves }}
              accessibilityHint={moves ? t('interaction_schedule.tap_to_apply') : undefined}
            >
              <Card style={[styles.card, moves && { borderWidth: 2, borderColor: COLORS.primary }]}>
                <Typography style={styles.bold}>
                  {i + 1}. {row.name}{row.saved ? '' : ` (${t('interaction_schedule.this_med')})`}
                </Typography>
                {row.foodTiming !== 'any' && (
                  <Typography variant="caption" color={COLORS.textSecondary}>{t(`food_timing.${row.foodTiming}`)}</Typography>
                )}
                <Typography style={styles.line}>{t('interaction_schedule.now')}: {join(row.times)}</Typography>
                {!spacedIds.has(row.id) ? null : s ? (
                  <Typography style={[styles.line, styles.bold]} color={moves ? COLORS.primary : COLORS.text}>
                    {t('interaction_schedule.suggested')}: {join(s)}{moves ? '' : `  (${t('interaction_schedule.unchanged')})`}
                  </Typography>
                ) : (
                  <Typography style={styles.line} color={COLORS.warning}>{t('interaction_schedule.no_fit')}</Typography>
                )}
                {moves && (
                  <View style={styles.tapRow}>
                    <Ionicons name="hand-left-outline" size={20} color={COLORS.primary} />
                    <Typography color={COLORS.primary} style={styles.bold}>{t('interaction_schedule.tap_to_apply')}</Typography>
                  </View>
                )}
              </Card>
            </Pressable>
          );
        })}

        {result.spaced.map(p => (
          <Typography key={`${p.a}|${p.b}`} variant="caption" color={COLORS.textSecondary} style={styles.line}>
            {t('interaction_schedule.keep_apart', { a: nameOf(p.a), b: nameOf(p.b), hours: p.hours })}
          </Typography>
        ))}

        {result.blocked.map(p => {
          const c = p.severity === 'contraindicated' ? COLORS.error : COLORS.warning;
          return (
            <View key={`${p.a}|${p.b}`} style={[styles.blocked, { borderColor: c, backgroundColor: c + '14' }]}>
              <Typography style={styles.bold} color={c}>{t(`interactions.severity_${p.severity}`)} · {nameOf(p.a)} ↔ {nameOf(p.b)}</Typography>
              <Typography>{t('interaction_schedule.not_by_timing')}</Typography>
            </View>
          );
        })}

        {changed.length > 1 && (
          <Button title={t('interaction_schedule.apply_all')} onPress={applyAll} loading={busy} disabled={busy} style={styles.bigBtn} />
        )}

        <View style={[styles.disclaimer, { backgroundColor: COLORS.lightGray }]}>
          <Ionicons name="information-circle-outline" size={18} color={COLORS.textSecondary} />
          <Typography variant="caption" color={COLORS.textSecondary} style={styles.flex1}>
            {t('interaction_schedule.disclaimer')} {t(INTERACTION_DISCLAIMER.key)}
          </Typography>
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: SPACING.md, paddingBottom: 80 },
  intro: { marginBottom: SPACING.md },
  card: { marginBottom: SPACING.md, gap: 4 },
  bold: { fontWeight: '700' },
  line: { marginTop: 2 },
  tapRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.xs },
  blocked: { borderWidth: 1, borderRadius: 12, padding: SPACING.sm + 4, marginTop: SPACING.md, gap: 4 },
  disclaimer: { flexDirection: 'row', gap: SPACING.sm, borderRadius: 12, padding: SPACING.sm + 4, marginTop: SPACING.lg },
  bigBtn: { minHeight: 56, marginTop: SPACING.md },
});

export default InteractionScheduleScreen;
