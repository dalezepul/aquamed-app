import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAppContext } from '../state/AppContext';
import { useTheme, SPACING, touchSize } from '../constants/theme';
import { t, getLocale } from '../localization/i18n';
import { ScreenWrapper } from '../components/common/ScreenWrapper';
import { ScreenHeader } from '../components/common/ScreenHeader';
import { Typography } from '../components/common/Typography';
import { Input } from '../components/common/Input';
import { Button } from '../components/common/Button';
import { Segmented } from '../components/common/Segmented';
import { BottomSheetTimePicker } from '../components/common/BottomSheetTimePicker';
import { FlagChip } from '../components/measurements/MeasurementChart';
import { storageService, newId } from '../services/storageService';
import { GlucoseContext, Measurement, MeasurementType } from '../types/models';
import { classifyMeasurement, INPUT_LIMITS } from '../constants/measurementRanges';
import { MEASUREMENT_TYPES, parseNumber } from '../utils/measurements';
import { formatLocalTime } from '../utils/DateUtils';
import { useToast } from '../hooks/useToast';
import { confirm } from '../utils/confirm';

const CONTEXTS: GlucoseContext[] = ['fasting', 'postMeal', 'random'];
const BIG = { fontSize: 28, fontWeight: '700' as const, textAlign: 'center' as const };

/** Add (params.type) or edit (params.id) one reading. Big number fields; works in the simple/large views. */
const AddMeasurementScreen: React.FC<any> = ({ navigation, route }) => {
  const { COLORS: c, isElderly } = useTheme();
  const { refreshAppData } = useAppContext();
  const { showToast } = useToast();
  const editId: string | undefined = route.params?.id;

  const [type, setType] = useState<MeasurementType>(route.params?.type ?? 'bp');
  const [f, setF] = useState({ value: '', diastolic: '', pulse: '', note: '' });
  const [context, setContext] = useState<GlucoseContext>('fasting');
  const [when, setWhen] = useState(() => new Date());
  const [timeOpen, setTimeOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editId) return;
    storageService.getMeasurements().then(list => {
      const m = list.find(x => x.id === editId);
      if (!m) return;
      setType(m.type);
      setF({ value: String(m.value), diastolic: m.diastolic ? String(m.diastolic) : '', pulse: m.pulse ? String(m.pulse) : '', note: m.note ?? '' });
      if (m.context) setContext(m.context);
      setWhen(new Date(m.timestamp));
    }).catch(console.error);
  }, [editId]);

  const set = (k: keyof typeof f) => (v: string) => { setF(p => ({ ...p, [k]: v })); setError(''); };
  const locale = getLocale() === 'tr' ? 'tr-TR' : 'en-US';
  const isToday = when.toDateString() === new Date().toDateString();
  const shiftDay = (n: number) => setWhen(d => { const x = new Date(d); x.setDate(x.getDate() + n); return x; });

  /** The reading, or an error message. */
  const build = (): Measurement | string => {
    const inRange = (v: number, [min, max]: readonly [number, number], field: string) =>
      Number.isFinite(v) && v >= min && v <= max ? '' : t('measurements.error_range', { field, min, max });
    const value = parseNumber(f.value);
    const base = { id: editId ?? newId(), type, timestamp: when.toISOString(), value, ...(f.note.trim() ? { note: f.note.trim() } : {}) };
    if (when.getTime() > Date.now() + 60000) return t('measurements.error_future');
    if (type === 'bp') {
      const diastolic = parseNumber(f.diastolic);
      const pulse = parseNumber(f.pulse);
      const err = inRange(value, INPUT_LIMITS.systolic, t('measurements.systolic'))
        || inRange(diastolic, INPUT_LIMITS.diastolic, t('measurements.diastolic'))
        || (f.pulse.trim() ? inRange(pulse, INPUT_LIMITS.pulse, t('measurements.pulse')) : '');
      if (err) return err;
      if (diastolic >= value) return t('measurements.error_bp_order');
      return { ...base, diastolic, ...(f.pulse.trim() ? { pulse } : {}) };
    }
    if (type === 'glucose') return inRange(value, INPUT_LIMITS.glucose, t('measurements.glucose_label')) || { ...base, context };
    return inRange(value, INPUT_LIMITS.weight, t('measurements.weight_label')) || base;
  };

  const draft = build();
  const flag = typeof draft === 'string' ? null : classifyMeasurement(draft);

  const save = async () => {
    const m = build();
    if (typeof m === 'string') { setError(m); return; }
    try {
      await storageService.saveMeasurement(m);
      await refreshAppData();
      showToast({ message: t('measurements.saved'), type: 'success' });
      navigation.goBack();
    } catch (e) {
      console.error(e);
      setError(t('common.error'));
    }
  };

  const remove = async () => {
    if (!editId || !(await confirm(t('measurements.delete'), t('measurements.delete_confirm'), t('common.delete'), true))) return;
    await storageService.deleteMeasurement(editId);
    await refreshAppData();
    navigation.goBack();
  };

  const numeric = { keyboardType: 'decimal-pad' as const, inputStyle: BIG, maxLength: 5 };
  const stepSize = touchSize(isElderly);

  return (
    <ScreenWrapper edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader title={editId ? t('measurements.edit') : t('measurements.add')} onBackPress={() => navigation.goBack()} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Segmented label={t('measurements.type_filter')} value={type} onChange={v => { setType(v); setError(''); }}
            options={MEASUREMENT_TYPES.map(v => ({ value: v, label: t(`measurements.type_${v}`) }))} />
          <View style={styles.gap} />

          {type === 'bp' && (
            <>
              <View style={styles.pair}>
                <Input {...numeric} maxLength={3} keyboardType="number-pad" containerStyle={styles.flex} label={`${t('measurements.systolic')} (mmHg)`} value={f.value} onChangeText={set('value')} placeholder="120" />
                <Typography variant="header" style={styles.slash}>/</Typography>
                <Input {...numeric} maxLength={3} keyboardType="number-pad" containerStyle={styles.flex} label={`${t('measurements.diastolic')} (mmHg)`} value={f.diastolic} onChangeText={set('diastolic')} placeholder="80" />
              </View>
              <Input {...numeric} maxLength={3} keyboardType="number-pad" label={t('measurements.pulse_optional')} value={f.pulse} onChangeText={set('pulse')} placeholder="70" />
            </>
          )}
          {type === 'glucose' && (
            <>
              <Input {...numeric} label={t('measurements.glucose_label')} value={f.value} onChangeText={set('value')} placeholder="100" />
              <Typography variant="caption" color={c.textSecondary} style={styles.label}>{t('measurements.context_label')}</Typography>
              <Segmented label={t('measurements.context_label')} value={context} onChange={setContext}
                options={CONTEXTS.map(v => ({ value: v, label: t(`measurements.ctx_${v}`) }))} />
              <View style={styles.gap} />
            </>
          )}
          {type === 'weight' && (
            <Input {...numeric} label={t('measurements.weight_label')} value={f.value} onChangeText={set('value')} placeholder="70,5" />
          )}

          {flag && <FlagChip flag={flag} withHint />}

          <Typography variant="caption" color={c.textSecondary} style={[styles.label, styles.gapTop]}>{t('measurements.date_time')}</Typography>
          <View style={[styles.when, { borderColor: c.border, backgroundColor: c.card }]}>
            <TouchableOpacity onPress={() => shiftDay(-1)} style={[styles.step, { width: stepSize, height: stepSize }]} accessibilityRole="button" accessibilityLabel={t('add_medication.prev_day')}>
              <Ionicons name="chevron-back" size={24} color={c.primary} />
            </TouchableOpacity>
            <Typography style={styles.flexText}>{when.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long' })}</Typography>
            <TouchableOpacity onPress={() => shiftDay(1)} disabled={isToday} style={[styles.step, { width: stepSize, height: stepSize, opacity: isToday ? 0.3 : 1 }]} accessibilityRole="button" accessibilityLabel={t('add_medication.next_day')} accessibilityState={{ disabled: isToday }}>
              <Ionicons name="chevron-forward" size={24} color={c.primary} />
            </TouchableOpacity>
            <Button variant="secondary" title={formatLocalTime(when)} accessibilityLabel={t('measurements.change_time')} onPress={() => setTimeOpen(true)} style={styles.timeBtn} />
          </View>

          <Input label={t('measurements.note_optional')} value={f.note} onChangeText={set('note')} multiline maxLength={200} containerStyle={styles.gapTop} />

          {error ? <Typography color={c.error} accessibilityLiveRegion="polite" style={styles.error}>{error}</Typography> : null}
          <Button title={t('common.save')} onPress={save} />
          {editId && <Button variant="destructive" title={t('measurements.delete')} onPress={remove} style={styles.gapTop} />}
          <Typography variant="caption" color={c.textSecondary} style={styles.footer}>{t('measurements.disclaimer')}</Typography>
        </ScrollView>
      </KeyboardAvoidingView>

      <BottomSheetTimePicker
        isVisible={timeOpen}
        onClose={() => setTimeOpen(false)}
        title={t('measurements.change_time')}
        initialTime={formatLocalTime(when)}
        onConfirm={time => {
          const [h, m] = time.split(':').map(Number);
          setWhen(d => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; });
          setTimeOpen(false);
        }}
      />
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexText: { flex: 1, textAlign: 'center' },
  content: { padding: SPACING.md, paddingBottom: 60 },
  gap: { height: SPACING.md },
  gapTop: { marginTop: SPACING.md },
  pair: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  slash: { marginTop: 18 },
  label: { marginBottom: 6 },
  when: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, padding: 4, gap: 4 },
  step: { alignItems: 'center', justifyContent: 'center' },
  timeBtn: { minWidth: 90 },
  error: { marginVertical: SPACING.sm },
  footer: { marginTop: SPACING.lg, textAlign: 'center' },
});

export default AddMeasurementScreen;
