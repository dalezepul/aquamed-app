import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerWidgetTaskHandler, requestWidgetUpdate, WidgetTaskHandlerProps } from 'react-native-android-widget';
// Not re-exported by the package; the same builder renderWidget/requestWidgetUpdate run.
import { buildWidgetTree } from 'react-native-android-widget/src/api/build-widget-tree';
import { storageService, fluidCeiling, newId } from '../services/storageService';
import { notificationService } from '../services/notificationService';
import { dynamicGoalService } from '../services/dynamicGoalService';
import { getDosesForDate } from '../utils/ScheduleUtils';
import { getLocalDayString } from '../utils/DateUtils';
import { setLocale } from '../localization/i18n';
import { BeverageType } from '../types/models';
import { computeWidgetSummary } from './summary';
import { computeCareWidget, CARE_WIDGET_KEY, CareSnapshot } from './care';
import { TodayWidget, WaterWidget, CareWidget, FallbackWidget, WIDGET_COLORS, ADD_WATER } from './AquaWidgets';

// Must match app.json → plugins → react-native-android-widget → widgets[].name
const WIDGET_NAMES = ['AquaToday', 'AquaWater', 'AquaCare'];

async function loadSummary() {
  const now = new Date(); // recomputed on every draw, so the day rolls over after midnight
  const today = getLocalDayString(now);
  const [lang, settings, waterLogs, goalMl, meds, logs] = await Promise.all([
    storageService.getLanguage(), storageService.getAppSettings(), storageService.getWaterLogsByDate(today),
    dynamicGoalService.getTodayEffectiveGoal(now), storageService.getMedications(), storageService.getLogsForDate(today),
  ]);
  setLocale(lang);
  return computeWidgetSummary({
    goalMl, now,
    waterMl: waterLogs.reduce((sum, l) => sum + (l.hydrationAmountMl ?? l.amountMl), 0),
    fluidMl: waterLogs.reduce((sum, l) => sum + l.amountMl, 0),
    ceilingMl: fluidCeiling(settings),
    glassMl: settings.waterReminder.drinkAmountMl || 250,
    doses: getDosesForDate(meds, logs, today),
  });
}

async function loadCare() {
  const [lang, raw] = await Promise.all([storageService.getLanguage(), AsyncStorage.getItem(CARE_WIDGET_KEY)]);
  setLocale(lang);
  return computeCareWidget(raw ? (JSON.parse(raw) as CareSnapshot) : null, new Date());
}

async function renderUnsafe(name: string) {
  const [mode, draw] = await Promise.all([
    storageService.getThemeMode(),
    name === 'AquaCare'
      ? loadCare().then(s => (c: typeof WIDGET_COLORS.light) => <CareWidget s={s} c={c} />)
      : loadSummary().then(s => {
        const Widget = name === 'AquaWater' ? WaterWidget : TodayWidget;
        return (c: typeof WIDGET_COLORS.light) => <Widget s={s} c={c} />;
      }),
  ]);
  if (mode !== 'system') return draw(WIDGET_COLORS[mode]);
  return { light: draw(WIDGET_COLORS.light), dark: draw(WIDGET_COLORS.dark) };
}

/**
 * Any failure (storage, bad data, a component throwing while the tree is built) still draws a
 * visible card instead of a transparent cell. The tree is built once here so component errors
 * surface inside this try, not later inside the library's draw call.
 */
async function render(name: string) {
  try {
    const w = await renderUnsafe(name);
    ('light' in w ? [w.light, w.dark] : [w]).forEach(el => buildWidgetTree(el));
    return w;
  } catch (e) {
    console.warn('[widgets] render failed', name, e);
    return <FallbackWidget />;
  }
}

async function addGlass(): Promise<boolean> {
  const s = await loadSummary();
  if (!s.canAddGlass) return false; // stale widget: the redraw turns the button into "open app"
  await storageService.saveWaterLog({
    id: newId(), amountMl: s.glassMl, hydrationAmountMl: s.glassMl,
    beverageType: BeverageType.Water, timestamp: new Date().toISOString(),
  });
  return true;
}

async function widgetTaskHandler({ widgetInfo, widgetAction, clickAction, renderWidget }: WidgetTaskHandlerProps) {
  if (widgetAction === 'WIDGET_DELETED') return;
  let added = false;
  if (widgetAction === 'WIDGET_CLICK' && clickAction === ADD_WATER) {
    try { added = await addGlass(); } catch (e) { console.warn('[widgets] add glass failed', e); }
  }
  renderWidget(await render(widgetInfo.widgetName));
  if (added) {
    await refreshWidgets(); // the other widget kind shows the same water total
    try { await notificationService.rescheduleAll(); } catch {} // goal met → water reminders stop
  }
}

export function registerWidgets() {
  registerWidgetTaskHandler(widgetTaskHandler);
}

/** Redraws every AquaMed widget on the home screen. Call after water/dose/medication/settings changes. */
export async function refreshWidgets(): Promise<void> {
  await Promise.all(WIDGET_NAMES.map(widgetName =>
    requestWidgetUpdate({ widgetName, renderWidget: () => render(widgetName) }).catch(e => console.warn('[widgets] refresh failed', widgetName, e))));
}
