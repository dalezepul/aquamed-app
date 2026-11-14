import React, { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Image, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import { NativeStackScreenProps as StackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { File, Directory, Paths } from 'expo-file-system';

import { useAppContext } from '../state/AppContext';
import { useTheme, SPACING } from '../constants/theme';
import { t } from '../localization/i18n';
import { ScreenWrapper } from '../components/common/ScreenWrapper';
import { ScreenHeader } from '../components/common/ScreenHeader';
import { Typography } from '../components/common/Typography';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { SwitchRow } from '../components/common/Switch';
import { Segmented } from '../components/common/Segmented';
import { BottomSheetTimePicker } from '../components/common/BottomSheetTimePicker';
import { BottomSheetNumberPicker } from '../components/common/BottomSheetNumberPicker';
import { storageService, newId, deleteMedPhoto } from '../services/storageService';
import { notificationService } from '../services/notificationService';
import { badgeService } from '../services/badgeService';
import { checkInteractions, spacingFor, INTERACTION_DISCLAIMER, InteractionSeverity } from '../services/drugInteractionService';
import { getLocalDayString, addDays } from '../utils/DateUtils';
import { calculateMedicationTimes, daysBetween, addStockBox } from '../utils/ScheduleUtils';
import { FoodTiming, Medication, MedSchedule, Priority } from '../types/models';
import { MEDICATION_DATABASE } from '../constants/medications';
import { useToast } from '../hooks/useToast';
import { confirm } from '../utils/confirm';
import { DOSE_UNITS, DoseUnit, doseFromMedication, formatDosage, formatAmount, isCountable, parseAmount, stepAmount, unitLabel, unitWord } from '../utils/dose';

type ScheduleKind = MedSchedule['type'];
const SCHEDULE_KINDS: ScheduleKind[] = ['daily', 'weekly', 'interval', 'cyclic'];
const FOOD_TIMINGS: FoodTiming[] = ['any', 'empty', 'before', 'with', 'after'];
const PRIORITIES: Priority[] = [Priority.Low, Priority.Medium, Priority.High];
const SHORT_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

type NumberField = 'interval' | 'active' | 'off' | 'duration' | 'box';

const parseNum = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));

// Folds İ/I/ı and accents so 'Ibu' (EN keyboard) and 'ibu' (TR keyboard) find the same names.
const normalize = (s: string) => s.replace(/[İIı]/g, 'i').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const NORMALIZED = MEDICATION_DATABASE.map(m => [m, normalize(m)] as const);

// ---- small form controls (≥48 px targets) ----
const Label = ({ children }: { children: React.ReactNode }) => {
  const { COLORS } = useTheme();
  return <Typography variant="caption" color={COLORS.textSecondary} style={styles.label}>{children}</Typography>;
};

const IconBtn = ({ icon, onPress, label, disabled }: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; label: string; disabled?: boolean }) => {
  const { COLORS } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[styles.iconBtn, { borderColor: COLORS.border, backgroundColor: COLORS.card, opacity: disabled ? 0.4 : 1 }]}
    >
      <Ionicons name={icon} size={22} color={COLORS.text} />
    </Pressable>
  );
};

const Stepper = ({ value, onChange, min, max, suffix, onValuePress, label }: {
  value: number; onChange: (n: number) => void; min: number; max: number; suffix?: string; onValuePress?: () => void; label: string;
}) => {
  const { COLORS } = useTheme();
  return (
    <View style={styles.row}>
      <IconBtn icon="remove" label={t('add_medication.decrease', { label })} disabled={value <= min} onPress={() => onChange(value - 1)} />
      <Pressable
        onPress={onValuePress}
        disabled={!onValuePress}
        accessibilityRole={onValuePress ? 'button' : 'text'}
        accessibilityLabel={`${label}: ${value}`}
        style={[styles.stepperValue, { borderColor: COLORS.border }]}
      >
        <Typography style={styles.bold} color={COLORS.primary}>{value}{suffix ? ` ${suffix}` : ''}</Typography>
      </Pressable>
      <IconBtn icon="add" label={t('add_medication.increase', { label })} disabled={value >= max} onPress={() => onChange(value + 1)} />
    </View>
  );
};

const DateStepper = ({ value, onChange, min, label }: { value: string; onChange: (d: string) => void; min?: string; label: string }) => {
  const { COLORS } = useTheme();
  const { locale } = useAppContext();
  const text = new Date(`${value}T00:00:00`).toLocaleDateString(locale === 'tr' ? 'tr-TR' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <View style={styles.row}>
      <IconBtn icon="chevron-back" label={t('add_medication.prev_day')} disabled={!!min && value <= min} onPress={() => onChange(addDays(value, -1))} />
      <View style={[styles.dateBox, { borderColor: COLORS.border }]} accessible accessibilityLabel={`${label}: ${text}`}>
        <Typography style={styles.bold}>{text}</Typography>
      </View>
      <IconBtn icon="chevron-forward" label={t('add_medication.next_day')} onPress={() => onChange(addDays(value, 1))} />
    </View>
  );
};

const AddEditMedicationScreen: React.FC<StackScreenProps<any>> = ({ navigation, route }) => {
  const { COLORS } = useTheme();
  const { sleepSettings, refreshAppData, locale } = useAppContext();
  const lang = locale === 'tr' ? 'tr' : 'en';
  const { showToast } = useToast();
  const medicationId: string | undefined = route.params?.medicationId;
  const today = getLocalDayString();

  const [original, setOriginal] = useState<Medication | null>(null);
  const [allMeds, setAllMeds] = useState<Medication[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const [name, setName] = useState('');
  const [nameFocused, setNameFocused] = useState(false);
  const [checkedName, setCheckedName] = useState('');
  const [doseUnit, setDoseUnit] = useState<DoseUnit>('tablet');
  const [doseAmountText, setDoseAmountText] = useState('1');
  const [doseText, setDoseText] = useState(''); // unit "other"
  const [strength, setStrength] = useState('');
  const [perDoseTouched, setPerDoseTouched] = useState(false);
  const [notes, setNotes] = useState('');
  const [times, setTimes] = useState<string[]>(() => calculateMedicationTimes(1, sleepSettings.start, sleepSettings.end));
  const [kind, setKind] = useState<ScheduleKind>('daily');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [everyDays, setEveryDays] = useState(2);
  const [activeDays, setActiveDays] = useState(21);
  const [offDays, setOffDays] = useState(7);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [foodTiming, setFoodTiming] = useState<FoodTiming>('any');
  const [priority, setPriority] = useState<Priority>(Priority.Medium);
  const [stockOn, setStockOn] = useState(false);
  const [stockRemaining, setStockRemaining] = useState('');
  const [stockTotal, setStockTotal] = useState('');
  const [stockPerDose, setStockPerDose] = useState('1');
  const [boxSize, setBoxSize] = useState<number | undefined>(); // "+1 kutu" size, asked on first use
  const [photoUri, setPhotoUri] = useState<string | undefined>();
  const [isPaused, setIsPaused] = useState(false);

  const [timePickerIndex, setTimePickerIndex] = useState<number | null>(null); // -1 = new time
  const [numberField, setNumberField] = useState<NumberField | null>(null);

  useEffect(() => {
    (async () => {
      const meds = await storageService.getMedications();
      setAllMeds(meds);
      if (!medicationId) return;
      const med = meds.find(m => m.id === medicationId);
      if (!med) {
        showToast({ message: t('common.operation_failed'), type: 'error' });
        navigation.goBack();
        return;
      }
      setOriginal(med);
      setName(med.name);
      setCheckedName(med.name);
      const dose = doseFromMedication(med);
      setDoseUnit(dose.unit);
      setDoseAmountText(formatAmount(dose.amount, lang));
      setDoseText(dose.text ?? '');
      setStrength(dose.strength ?? '');
      setPerDoseTouched(!!med.stock && !(isCountable(dose.unit) && med.stock.perDose === dose.amount));
      setNotes(med.notes || '');
      setTimes(med.times);
      setKind(med.schedule.type);
      if (med.schedule.type === 'weekly') setDaysOfWeek(med.schedule.daysOfWeek);
      if (med.schedule.type === 'interval') setEveryDays(med.schedule.everyDays);
      if (med.schedule.type === 'cyclic') { setActiveDays(med.schedule.activeDays); setOffDays(med.schedule.offDays); }
      setStartDate(med.startDate);
      setEndDate(med.endDate);
      setFoodTiming(med.foodTiming);
      setPriority(med.priority);
      if (med.stock) {
        setStockOn(true);
        setStockRemaining(String(med.stock.remaining));
        setStockTotal(String(med.stock.total));
        setStockPerDose(String(med.stock.perDose));
        setBoxSize(med.stock.boxSize);
      }
      setPhotoUri(med.photoUri);
      setIsPaused(med.isPaused);
    })();
  }, [medicationId]);

  const doseAmount = parseAmount(doseAmountText);
  const dosage = formatDosage({ amount: doseAmount, unit: doseUnit, strength, text: doseText }, lang);
  const countable = isCountable(doseUnit);
  const setAmount = (n: number) => setDoseAmountText(formatAmount(n, lang));

  // Stock is counted in the dose unit: one dose uses `doseAmount` of them unless the user set it separately.
  useEffect(() => {
    if (countable && !perDoseTouched && doseAmount > 0) setStockPerDose(String(doseAmount));
  }, [doseAmount, countable, perDoseTouched]);

  // Times picked on InteractionScheduleScreen for this (unsaved) form.
  const suggestedTimes: string[] | undefined = route.params?.suggestedTimes;
  useEffect(() => {
    if (!suggestedTimes) return;
    setTimes(suggestedTimes);
    navigation.setParams({ suggestedTimes: undefined });
  }, [suggestedTimes]);

  const otherNames = useMemo(
    () => allMeds.filter(m => m.id !== medicationId).map(m => m.name),
    [allMeds, medicationId]
  );

  const interaction = useMemo(
    () => (checkedName.trim() ? checkInteractions(checkedName.trim(), otherNames) : null),
    [checkedName, otherNames]
  );

  // null = no list; [] = nothing matched, only the "add as typed" row.
  const suggestions = useMemo(() => {
    const q = normalize(name.trim());
    if (!nameFocused || q.length < 2) return null;
    const hits = NORMALIZED.filter(([, n]) => n.includes(q));
    if (hits.some(([, n]) => n === q)) return null;
    const rank = (n: string) => (n.startsWith(q) ? 0 : 1);
    return hits.sort((a, b) => rank(a[1]) - rank(b[1])).slice(0, 6).map(([m]) => m);
  }, [name, nameFocused]);

  const pickSuggestion = (item: string) => {
    setName(item);
    setCheckedName(item);
    setNameFocused(false);
    Keyboard.dismiss();
  };

  // ---- times ----
  const suggestTimes = (count: number) => {
    if (count < 1 || count > 12) return;
    setTimes(calculateMedicationTimes(count, sleepSettings.start, sleepSettings.end));
  };

  const confirmTime = (time: string) => {
    const idx = timePickerIndex;
    if (idx === null) return;
    if (times.some((x, i) => x === time && i !== idx)) {
      showToast({ message: t('add_medication.error_duplicate_time', { time }), type: 'error' });
      return;
    }
    const next = idx === -1 ? [...times, time] : times.map((x, i) => (i === idx ? time : x));
    setTimes(next.sort());
  };

  const removeTime = (idx: number) => setTimes(times.filter((_, i) => i !== idx));

  const toggleDay = (day: number) =>
    setDaysOfWeek(prev => (prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()));

  // ---- dates ----
  const changeStart = (day: string) => {
    // keep the course length when the start moves
    if (endDate) setEndDate(addDays(endDate, daysBetween(startDate, day)));
    setStartDate(day);
  };
  const duration = endDate ? daysBetween(startDate, endDate) + 1 : 0;

  // ---- photo ----

  const pickPhoto = async (source: 'camera' | 'library') => {
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          showToast({ message: t('add_medication.photo_permission_denied'), type: 'info' });
          return;
        }
      }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6 };
      const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets?.[0]) return;
      let uri = res.assets[0].uri;
      if (Platform.OS !== 'web') {
        const dir = new Directory(Paths.document, 'med-photos');
        if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
        const dest = new File(dir, `${newId()}.jpg`);
        await new File(uri).copy(dest);
        uri = dest.uri;
      }
      if (photoUri !== original?.photoUri) deleteMedPhoto(photoUri); // unsaved earlier pick
      setPhotoUri(uri);
    } catch (e) {
      console.warn('Photo pick failed', e);
      showToast({ message: t('add_medication.photo_error'), type: 'error' });
    }
  };

  const removePhoto = () => {
    if (photoUri !== original?.photoUri) deleteMedPhoto(photoUri);
    setPhotoUri(undefined);
  };

  // ---- save / delete ----
  const validate = (): string | null => {
    if (!name.trim()) return t('add_medication.error_name');
    if (doseUnit !== 'other' && !(doseAmount > 0)) return t('add_medication.error_dose_amount');
    if (times.length === 0) return t('add_medication.error_time');
    if (kind === 'weekly' && daysOfWeek.length === 0) return t('add_medication.error_days');
    if (kind === 'interval' && !(everyDays >= 1)) return t('add_medication.error_interval');
    if (kind === 'cyclic' && !(activeDays >= 1 && offDays >= 0)) return t('add_medication.error_cycle');
    if (endDate && endDate < startDate) return t('add_medication.error_end_date');
    if (stockOn) {
      const [rem, tot, per] = [parseNum(stockRemaining || stockTotal), parseNum(stockTotal), parseNum(stockPerDose)];
      if (!(rem >= 0) || !(tot >= 0) || !(per > 0)) return t('add_medication.error_stock');
    }
    return null;
  };

  const buildSchedule = (): MedSchedule => {
    switch (kind) {
      case 'weekly': return { type: 'weekly', daysOfWeek };
      case 'interval': return { type: 'interval', everyDays };
      case 'cyclic': return { type: 'cyclic', activeDays, offDays };
      default: return { type: 'daily' };
    }
  };

  const handleSave = async () => {
    if (isSaving) return;
    const error = validate();
    if (error) {
      showToast({ message: error, type: 'error' });
      return;
    }
    const trimmedName = name.trim();
    setIsSaving(true);
    try {
      const clashes = await storageService.findTimeClashes(times, medicationId);
      if (clashes.length > 0 && !(await confirm(
        t('add_medication.conflict_title'),
        t('add_medication.clash_desc', { names: clashes.join(', ') }),
        t('add_medication.save_anyway'),
      ))) return;

      const check = checkInteractions(trimmedName, otherNames);
      const severe = check.interactions.filter(i => i.severity === 'contraindicated');
      if (severe.length > 0 && !(await confirm(
        t('drug_interaction.found_title'),
        t('interactions.contraindicated_confirm', { names: severe.map(i => i.with).join(', ') }),
        t('add_medication.save_anyway'),
        true,
      ))) return;
      // A serious interaction that dose times can't fix gets its own confirmation too (not just the time-clash one).
      const major = check.interactions.filter(i => i.severity === 'major' && spacingFor(i) === null);
      if (severe.length === 0 && major.length > 0 && !(await confirm(
        t('drug_interaction.found_title'),
        t('interactions.major_confirm', { names: major.map(i => i.with).join(', ') }),
        t('add_medication.save_anyway'),
        true,
      ))) return;

      const stock = stockOn
        ? { remaining: parseNum(stockRemaining || stockTotal), total: parseNum(stockTotal), perDose: parseNum(stockPerDose), ...(boxSize ? { boxSize } : {}) }
        : undefined;
      const med: Medication = {
        ...(original ?? { id: newId(), createdAt: new Date().toISOString() }),
        name: trimmedName,
        dosage,
        doseAmount: doseUnit !== 'other' ? doseAmount : undefined,
        doseUnit,
        strength: strength.trim() || undefined,
        notes: notes.trim() || undefined,
        times: [...new Set(times)].sort(),
        startDate,
        endDate,
        schedule: buildSchedule(),
        foodTiming,
        photoUri,
        priority,
        isPaused: original ? isPaused : false,
        stock,
      };

      if (!original && allMeds.length === 0) await notificationService.ensurePermissions().catch(() => false);
      await storageService.saveMedication(med);
      if (original?.photoUri !== photoUri) deleteMedPhoto(original?.photoUri);
      await notificationService.rescheduleAll().catch(e => console.warn('rescheduleAll failed', e));
      try {
        if (!original) await badgeService.triggerAction('add_med');
        if (stock) await badgeService.triggerAction('stock_manager');
        if (stock && original?.stock && stock.remaining > original.stock.remaining) await badgeService.triggerAction('stock_refill');
        if (kind === 'weekly') await badgeService.triggerAction('planner');
      } catch (e) {
        console.warn('[BadgeService] check failed', e);
      }
      await refreshAppData();
      showToast({ message: t('add_medication.save_success_msg', { name: trimmedName }), type: 'success' });
      navigation.goBack();
    } catch (e) {
      console.error(e);
      showToast({ message: t('common.save_error'), type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!original) return;
    const ok = await confirm(t('add_medication.delete_title'), t('add_medication.delete_confirm'), t('common.delete'), true);
    if (!ok) return;
    try {
      await storageService.deleteMedication(original.id); // also deletes original.photoUri
      if (photoUri !== original.photoUri) deleteMedPhoto(photoUri);
      await notificationService.rescheduleAll().catch(e => console.warn('rescheduleAll failed', e));
      await refreshAppData();
      showToast({ message: t('add_medication.delete_success', { name: original.name }), type: 'success' });
      navigation.goBack();
    } catch (e) {
      console.error(e);
      showToast({ message: t('add_medication.error_delete'), type: 'error' });
    }
  };

  const severityColor = (s: InteractionSeverity) =>
    s === 'contraindicated' ? COLORS.error : s === 'major' ? COLORS.warning : COLORS.primary;

  const withUnit = (label: string) => (countable ? `${label} (${unitWord(doseUnit, 2, lang)})` : label);

  const numberPickerValue = numberField === 'interval' ? everyDays : numberField === 'active' ? activeDays : numberField === 'off' ? offDays : numberField === 'box' ? 28 : duration || 7;

  // "+1 kutu" on the form drafts; saved with the rest.
  const addBoxToDraft = (size: number) => {
    const rem = parseNum(stockRemaining || stockTotal);
    const tot = parseNum(stockTotal);
    const next = addStockBox({ remaining: rem >= 0 ? rem : 0, total: tot >= 0 ? tot : 0, perDose: 1 }, size);
    setBoxSize(size);
    setStockRemaining(String(next.remaining));
    setStockTotal(String(next.total));
  };

  return (
    <ScreenWrapper edges={['top', 'bottom', 'left', 'right']}>
      <ScreenHeader title={medicationId ? t('add_medication.edit_title') : t('add_medication.new_title')} onBackPress={() => navigation.goBack()} />
      <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Name, dosage, notes */}
          <Card style={styles.card}>
            <Input
              label={t('add_medication.name_label')}
              placeholder={t('add_medication.name_placeholder')}
              value={name}
              onChangeText={setName}
              onFocus={() => setNameFocused(true)}
              onBlur={() => {
                setCheckedName(name);
                // delay so a tap on a suggestion (web: blur fires first) still lands
                setTimeout(() => setNameFocused(false), 200);
              }}
              autoCapitalize="words"
              containerStyle={styles.noMargin}
            />
            {suggestions && (
              <View style={[styles.suggestionBox, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]} accessibilityRole="list">
                {suggestions.map((item, i) => (
                  <Pressable
                    key={item}
                    onPress={() => pickSuggestion(item)}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.suggestionItem,
                      { borderTopColor: COLORS.border, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, backgroundColor: pressed ? COLORS.primary + '14' : 'transparent' },
                    ]}
                  >
                    <Ionicons name="medkit-outline" size={18} color={COLORS.textSecondary} />
                    <Typography style={styles.suggestionText}>{item}</Typography>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => pickSuggestion(name.trim())}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.suggestionItem,
                    { borderTopColor: COLORS.border, borderTopWidth: suggestions.length ? StyleSheet.hairlineWidth : 0, backgroundColor: pressed ? COLORS.primary + '26' : COLORS.primary + '0F' },
                  ]}
                >
                  <Ionicons name="add-circle-outline" size={22} color={COLORS.primary} />
                  <Typography style={[styles.suggestionText, styles.bold]} color={COLORS.primary}>
                    {suggestions.length ? t('add_medication.add_typed_name', { name: name.trim() }) : t('add_medication.add_typed_name_none', { name: name.trim() })}
                  </Typography>
                </Pressable>
              </View>
            )}
            <Typography variant="caption" color={COLORS.textSecondary} style={styles.hint}>{t('add_medication.name_not_listed_hint')}</Typography>

            {interaction && interaction.interactions.length > 0 && (
              <View style={styles.section}>
                <Typography style={styles.bold}>{t('drug_interaction.found_title')}</Typography>
                {interaction.interactions.map(hit => {
                  const c = severityColor(hit.severity);
                  return (
                    <View key={hit.with} style={[styles.interactionCard, { borderColor: c, backgroundColor: c + '14' }]}>
                      <Typography variant="caption" color={c} style={styles.bold}>
                        {t(`interactions.severity_${hit.severity}`)} · {checkedName.trim()} ↔ {hit.with}
                      </Typography>
                      <Typography variant="caption">{locale === 'tr' ? hit.messageTr : hit.messageEn}</Typography>
                    </View>
                  );
                })}
                {/* Only when spacing the doses helps: contraindicated / major-without-spacing has nothing to suggest. */}
                {interaction.interactions.some(hit => spacingFor(hit) !== null) && <Button
                  title={t('interaction_schedule.open_button')}
                  variant="secondary"
                  onPress={() => navigation.navigate('InteractionSchedule', {
                    draft: { id: medicationId ?? 'draft', name: checkedName.trim(), times, foodTiming, priority },
                    returnKey: route.key,
                  })}
                  style={styles.section}
                />}
              </View>
            )}
            {interaction && interaction.unrecognized.length > 0 && (
              <Typography variant="caption" color={COLORS.textSecondary} style={styles.section}>
                {t('interactions.unrecognized', { names: interaction.unrecognized.join(', ') })}
              </Typography>
            )}
            <View style={[styles.disclaimer, { backgroundColor: COLORS.lightGray }]}>
              <Ionicons name="information-circle-outline" size={18} color={COLORS.textSecondary} />
              <Typography variant="caption" color={COLORS.textSecondary} style={styles.flex1}>
                {t(INTERACTION_DISCLAIMER.key)}
              </Typography>
            </View>

            <Label>{t('add_medication.dosage_label')}</Label>
            {doseUnit !== 'other' && (
              <View style={[styles.row, styles.doseRow]}>
                <IconBtn icon="remove" label={t('add_medication.decrease', { label: t('add_medication.dose_amount') })} disabled={!(doseAmount > 0.25)} onPress={() => setAmount(stepAmount(doseAmount, doseUnit, -1))} />
                <Input
                  value={doseAmountText}
                  onChangeText={setDoseAmountText}
                  keyboardType="decimal-pad"
                  accessibilityLabel={t('add_medication.dose_amount')}
                  containerStyle={[styles.flex1, styles.noMargin]}
                  inputStyle={styles.doseAmount}
                  selectTextOnFocus
                />
                <Typography style={[styles.bold, styles.doseUnitWord]} numberOfLines={1}>{unitWord(doseUnit, doseAmount, lang)}</Typography>
                <IconBtn icon="add" label={t('add_medication.increase', { label: t('add_medication.dose_amount') })} onPress={() => setAmount(stepAmount(doseAmount, doseUnit, 1))} />
              </View>
            )}
            <Segmented
              options={DOSE_UNITS.map(u => ({ value: u, label: unitLabel(u, lang) }))}
              value={doseUnit}
              onChange={setDoseUnit}
              label={t('add_medication.dose_unit')}
            />
            {doseUnit === 'other' && (
              <Input
                label={t('add_medication.dose_other_label')}
                placeholder={t('add_medication.dosage_placeholder')}
                value={doseText}
                onChangeText={setDoseText}
                containerStyle={styles.section}
              />
            )}
            <Input
              label={t('add_medication.strength_label')}
              placeholder={t('add_medication.strength_placeholder')}
              value={strength}
              onChangeText={setStrength}
              containerStyle={styles.section}
            />
            {!!dosage && (
              <Typography variant="caption" color={COLORS.textSecondary} style={styles.dosePreview}>
                {t('add_medication.dose_preview', { dosage })}
              </Typography>
            )}
            <Input
              label={t('add_medication.notes_label')}
              placeholder={t('add_medication.description_placeholder')}
              value={notes}
              onChangeText={setNotes}
              multiline
              inputStyle={styles.notes}
              containerStyle={styles.noMargin}
            />
          </Card>

          {/* Times */}
          <Card style={styles.card}>
            <Label>{t('add_medication.doses_per_day')}</Label>
            <Stepper value={times.length} min={1} max={12} onChange={suggestTimes} label={t('add_medication.doses_per_day')} />
            <Typography variant="caption" color={COLORS.textSecondary} style={styles.hint}>{t('add_medication.suggest_times_hint')}</Typography>

            <Label>{t('add_medication.reminder_times')}</Label>
            <View style={styles.wrap}>
              {times.map((time, idx) => (
                <View key={time} style={[styles.timeTag, { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '14' }]}>
                  <Pressable
                    onPress={() => setTimePickerIndex(idx)}
                    accessibilityRole="button"
                    accessibilityLabel={t('add_medication.edit_time', { time })}
                    style={styles.timeTagText}
                  >
                    <Typography style={styles.timeText} color={COLORS.primary}>{time}</Typography>
                  </Pressable>
                  <Pressable
                    onPress={() => removeTime(idx)}
                    accessibilityRole="button"
                    accessibilityLabel={t('add_medication.remove_time', { time })}
                    style={styles.timeTagRemove}
                  >
                    <Ionicons name="close-circle" size={22} color={COLORS.primary} />
                  </Pressable>
                </View>
              ))}
              <Pressable
                onPress={() => setTimePickerIndex(-1)}
                accessibilityRole="button"
                accessibilityLabel={t('add_medication.add_time')}
                style={[styles.timeTag, styles.addTime, { borderColor: COLORS.primary }]}
              >
                <Ionicons name="add" size={22} color={COLORS.primary} />
                <Typography color={COLORS.primary} style={styles.bold}>{t('add_medication.add_time')}</Typography>
              </Pressable>
            </View>
          </Card>

          {/* Schedule */}
          <Card style={styles.card}>
            <Label>{t('add_medication.frequency')}</Label>
            <Segmented
              options={SCHEDULE_KINDS.map(k => ({ value: k, label: t(`add_medication.schedule_${k}`) }))}
              value={kind}
              onChange={k => {
                setKind(k);
                // "Days of the week" starts with the start date's weekday picked, not an empty (unsaveable) set.
                if (k === 'weekly' && daysOfWeek.length === 0) setDaysOfWeek([new Date(startDate + 'T12:00:00').getDay()]);
              }}
              label={t('add_medication.frequency')}
              columns={2}
            />

            {kind === 'weekly' && (
              <View style={[styles.wrap, styles.section]}>
                {WEEK_ORDER.map(d => {
                  const on = daysOfWeek.includes(d);
                  return (
                    <Pressable
                      key={d}
                      onPress={() => toggleDay(d)}
                      accessibilityRole="button"
                      accessibilityLabel={t(`full_days.${FULL_DAYS[d]}`)}
                      accessibilityState={{ selected: on }}
                      style={[styles.dayCircle, { backgroundColor: on ? COLORS.primary : COLORS.lightGray }]}
                    >
                      <Typography style={styles.bold} color={on ? COLORS.onPrimary : COLORS.text}>{t(`short_days.${SHORT_DAYS[d]}`)}</Typography>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {kind === 'interval' && (
              <View style={styles.section}>
                <Label>{t('scheduling.interval_days')}</Label>
                <Stepper value={everyDays} min={1} max={365} onChange={setEveryDays} suffix={t('common.days')} onValuePress={() => setNumberField('interval')} label={t('scheduling.interval_days')} />
                <Typography variant="caption" color={COLORS.textSecondary} style={styles.hint}>{t('scheduling.interval_desc', { days: everyDays })}</Typography>
              </View>
            )}

            {kind === 'cyclic' && (
              <View style={styles.section}>
                <Label>{t('scheduling.cycle_active')}</Label>
                <Stepper value={activeDays} min={1} max={365} onChange={setActiveDays} suffix={t('common.days')} onValuePress={() => setNumberField('active')} label={t('scheduling.cycle_active')} />
                <Label>{t('scheduling.cycle_off')}</Label>
                <Stepper value={offDays} min={0} max={365} onChange={setOffDays} suffix={t('common.days')} onValuePress={() => setNumberField('off')} label={t('scheduling.cycle_off')} />
                <Typography variant="caption" color={COLORS.textSecondary} style={styles.hint}>{t('scheduling.cycle_desc', { active: activeDays, off: offDays })}</Typography>
              </View>
            )}

            <View style={[styles.divider, { backgroundColor: COLORS.border }]} />

            <View style={styles.rowBetween}>
              <Label>{t('add_medication.start_date')}</Label>
              {startDate !== today && (
                <Pressable onPress={() => changeStart(today)} accessibilityRole="button" style={styles.linkBtn}>
                  <Typography color={COLORS.primary} style={styles.bold}>{t('medication_detail.today')}</Typography>
                </Pressable>
              )}
            </View>
            <DateStepper value={startDate} onChange={changeStart} label={t('add_medication.start_date')} />

            <SwitchRow style={[styles.rowBetween, styles.section]} label={t('add_medication.has_end_date')} value={!!endDate} onValueChange={on => setEndDate(on ? addDays(startDate, 6) : null)}>
              <Typography style={styles.flex1}>{t('add_medication.has_end_date')}</Typography>
            </SwitchRow>
            {endDate && (
              <View style={styles.section}>
                <Label>{t('add_medication.duration')}</Label>
                <Stepper
                  value={duration}
                  min={1}
                  max={3650}
                  onChange={n => setEndDate(addDays(startDate, n - 1))}
                  suffix={t('common.days')}
                  onValuePress={() => setNumberField('duration')}
                  label={t('add_medication.duration')}
                />
                <Label>{t('add_medication.end_date')}</Label>
                <DateStepper value={endDate} onChange={setEndDate} min={startDate} label={t('add_medication.end_date')} />
              </View>
            )}
          </Card>

          {/* Food timing + priority */}
          <Card style={styles.card}>
            <Label>{t('add_medication.food_timing')}</Label>
            <Segmented
              options={FOOD_TIMINGS.map(f => ({ value: f, label: t(`food_timing.${f}`) }))}
              value={foodTiming}
              onChange={setFoodTiming}
              label={t('add_medication.food_timing')}
              columns={2}
            />

            <View style={[styles.divider, { backgroundColor: COLORS.border }]} />

            <Label>{t('common.priority')}</Label>
            <Segmented
              options={PRIORITIES.map(p => ({ value: p, label: t(`common.${p.toLowerCase()}`) }))}
              value={priority}
              onChange={setPriority}
              label={t('common.priority')}
            />
            <Typography variant="caption" color={COLORS.textSecondary} style={styles.hint}>{t('add_medication.priority_high_hint')}</Typography>
          </Card>

          {/* Stock */}
          <Card style={styles.card}>
            <SwitchRow style={styles.rowBetween} label={t('add_medication.stock_tracking')} value={stockOn} onValueChange={setStockOn}>
              <Typography style={[styles.bold, styles.flex1]}>{t('add_medication.stock_tracking')}</Typography>
            </SwitchRow>
            {stockOn && (
              <View style={styles.section}>
                <Input label={withUnit(t('add_medication.remaining_stock'))} placeholder={t('add_medication.remaining_stock_placeholder')} value={stockRemaining} onChangeText={setStockRemaining} keyboardType="decimal-pad" />
                <Input label={withUnit(t('add_medication.stock_total'))} placeholder={t('add_medication.total_stock_placeholder')} value={stockTotal} onChangeText={setStockTotal} keyboardType="decimal-pad" />
                <Input
                  label={withUnit(t('add_medication.stock_per_dose'))}
                  placeholder="1"
                  value={stockPerDose}
                  onChangeText={v => { setPerDoseTouched(true); setStockPerDose(v); }}
                  keyboardType="decimal-pad"
                  containerStyle={styles.noMargin}
                />
                <Button
                  title={boxSize ? t('stock_box.add_box_n', { count: boxSize }) : t('stock_box.add_box')}
                  variant="secondary"
                  onPress={() => (boxSize ? addBoxToDraft(boxSize) : setNumberField('box'))}
                  style={styles.section}
                />
              </View>
            )}
          </Card>

          {/* Photo */}
          <Card style={styles.card}>
            <Label>{t('add_medication.photo')}</Label>
            {photoUri ? (
              <View style={styles.row}>
                <Image source={{ uri: photoUri }} style={styles.photo} accessibilityIgnoresInvertColors />
                <View style={styles.flex1}>
                  <Button title={t('add_medication.photo_remove')} variant="secondary" onPress={removePhoto} />
                </View>
              </View>
            ) : (
              <View style={styles.row}>
                <View style={styles.flex1}><Button title={t('add_medication.photo_camera')} variant="secondary" onPress={() => pickPhoto('camera')} /></View>
                <View style={styles.flex1}><Button title={t('add_medication.photo_library')} variant="secondary" onPress={() => pickPhoto('library')} /></View>
              </View>
            )}
          </Card>

          {original && (
            <Card style={styles.card}>
              <SwitchRow style={styles.rowBetween} label={t('add_medication.paused')} value={isPaused} onValueChange={setIsPaused}>
                <View style={styles.flex1}>
                  <Typography style={styles.bold}>{t('add_medication.paused')}</Typography>
                  <Typography variant="caption" color={COLORS.textSecondary}>{t('add_medication.paused_hint')}</Typography>
                </View>
              </SwitchRow>
            </Card>
          )}

          <Button
            title={original ? t('add_medication.save_changes') : t('add_medication.save_button')}
            onPress={handleSave}
            loading={isSaving}
            disabled={isSaving}
            style={styles.bigBtn}
          />
          {original && (
            <Button title={t('medication_detail.delete_button')} variant="destructive" onPress={handleDelete} style={styles.bigBtn} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <BottomSheetTimePicker
        isVisible={timePickerIndex !== null}
        onClose={() => setTimePickerIndex(null)}
        title={t('add_medication.time_label')}
        initialTime={timePickerIndex !== null && timePickerIndex >= 0 ? times[timePickerIndex] : '12:00'}
        onConfirm={confirmTime}
      />
      <BottomSheetNumberPicker
        presetMode="set"
        isVisible={numberField !== null}
        onClose={() => setNumberField(null)}
        title={numberField === 'box' ? t('stock_box.size_question') : numberField === 'duration' ? t('add_medication.duration') : numberField === 'interval' ? t('scheduling.interval_days') : numberField === 'active' ? t('scheduling.cycle_active') : t('scheduling.cycle_off')}
        initialValue={numberPickerValue}
        min={numberField === 'off' ? 0 : 1}
        max={numberField === 'duration' ? 3650 : numberField === 'box' ? 1000 : 365}
        presets={numberField === 'duration' ? [5, 7, 10, 14, 30, 90] : numberField === 'box' ? [10, 14, 20, 28, 30, 60] : [2, 3, 7, 21, 28]}
        onConfirm={val => {
          if (numberField === 'interval') setEveryDays(val);
          else if (numberField === 'active') setActiveDays(val);
          else if (numberField === 'off') setOffDays(val);
          else if (numberField === 'duration') setEndDate(addDays(startDate, Math.max(1, val) - 1));
          else if (numberField === 'box') addBoxToDraft(val);
        }}
      />
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  content: { padding: SPACING.md, paddingBottom: 80 },
  card: { marginBottom: SPACING.md },
  label: { marginBottom: SPACING.sm, marginTop: SPACING.xs, fontWeight: '600' },
  hint: { marginTop: SPACING.xs, marginBottom: SPACING.sm },
  section: { marginTop: SPACING.md },
  noMargin: { marginBottom: 0 },
  bold: { fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  divider: { height: 1, marginVertical: SPACING.md },
  suggestionBox: { borderWidth: 1, borderRadius: 12, marginTop: SPACING.xs, marginBottom: SPACING.md, overflow: 'hidden' },
  suggestionItem: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 52, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs },
  doseRow: { marginBottom: SPACING.md },
  doseAmount: { textAlign: 'center', fontSize: 22, fontWeight: '800' },
  doseUnitWord: { minWidth: 56 },
  dosePreview: { marginTop: -SPACING.xs, marginBottom: SPACING.md },
  suggestionText: { flex: 1 },
  interactionCard: { borderWidth: 1, borderRadius: 12, padding: SPACING.sm + 4, marginTop: SPACING.sm, gap: 4 },
  disclaimer: { flexDirection: 'row', gap: SPACING.sm, borderRadius: 12, padding: SPACING.sm + 4, marginTop: SPACING.md, marginBottom: SPACING.md },
  notes: { minHeight: 80, textAlignVertical: 'top' },
  iconBtn: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { minWidth: 88, height: 48, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.sm },
  dateBox: { flex: 1, height: 48, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xs },
  linkBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: SPACING.sm },
  timeTag: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderRadius: 24, borderWidth: 1 },
  timeTagText: { minHeight: 48, justifyContent: 'center', paddingLeft: SPACING.md, paddingRight: SPACING.xs },
  timeTagRemove: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  timeText: { fontSize: 18, fontWeight: '800' },
  addTime: { borderStyle: 'dashed', paddingHorizontal: SPACING.md, gap: 4 },
  dayCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  photo: { width: 88, height: 88, borderRadius: 12 },
  bigBtn: { minHeight: 56, marginTop: SPACING.sm },
});

export default AddEditMedicationScreen;
