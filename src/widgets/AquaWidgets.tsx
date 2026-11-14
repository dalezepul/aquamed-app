import React from 'react';
import { FlexWidget, TextWidget, HexColor } from 'react-native-android-widget';
import { PALETTES } from '../constants/theme';
import { t } from '../localization/i18n';
import { WidgetSummary } from './summary';
import { CareWidgetSummary, CAREGIVERS_URL } from './care';

type Colors = Record<keyof typeof PALETTES.night.dark, HexColor>;
export const WIDGET_COLORS = { light: PALETTES.night.light, dark: PALETTES.night.dark } as unknown as { light: Colors; dark: Colors };

export const ADD_WATER = 'ADD_WATER';

// Over the fluid ceiling the button opens the app instead of logging silently.
function GlassButton({ s, c, height, width }: { s: WidgetSummary; c: Colors; height: number; width: number | 'match_parent' }) {
  const label = `+ ${s.glassMl} ml`;
  return (
    <FlexWidget
      clickAction={s.canAddGlass ? ADD_WATER : 'OPEN_APP'}
      accessibilityLabel={t('widget.addGlassA11y', { ml: s.glassMl })}
      style={{
        height, width, borderRadius: 16,
        backgroundColor: s.canAddGlass ? c.primary : c.lightGray,
        justifyContent: 'center', alignItems: 'center',
      }}
    >
      <TextWidget text={label} style={{ fontSize: 18, fontWeight: '700', color: s.canAddGlass ? c.onPrimary : c.textSecondary }} />
    </FlexWidget>
  );
}

function Bar({ s, c }: { s: WidgetSummary; c: Colors }) {
  const fill = s.goalMet ? c.success : c.water;
  return (
    <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', height: 10, borderRadius: 5, backgroundColor: c.waterLight }}>
      {s.percent > 0 && <FlexWidget style={{ flex: s.percent, height: 10, borderRadius: 5, backgroundColor: fill }} />}
      {s.percent < 100 && <FlexWidget style={{ flex: 100 - s.percent, height: 10 }} />}
    </FlexWidget>
  );
}

const pct = (s: WidgetSummary) => (s.goalMet ? t('widget.goalMet') : t('widget.percent', { p: s.percent }));

function doseLine(s: WidgetSummary): string {
  if (s.nextDose) return t('widget.nextDose', { name: s.nextDose.name, time: s.nextDose.time });
  if (s.allDosesDone) return t('widget.allDone');
  if (s.dosesToday === 0) return t('widget.noDoses');
  return '';
}

export function TodayWidget({ s, c }: { s: WidgetSummary; c: Colors }) {
  const doses = doseLine(s);
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{ height: 'match_parent', width: 'match_parent', padding: 12, borderRadius: 22, backgroundColor: c.card, flexDirection: 'column', justifyContent: 'space-between' }}
    >
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center' }}>
        <FlexWidget style={{ flex: 1, flexDirection: 'column', marginRight: 12 }}>
          <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', justifyContent: 'space-between', marginBottom: 6 }}>
            <TextWidget text={`${s.waterMl} / ${s.goalMl} ml`} style={{ fontSize: 18, fontWeight: '700', color: c.text }} />
            <TextWidget text={pct(s)} style={{ fontSize: 18, fontWeight: '700', color: s.goalMet ? c.success : c.water }} />
          </FlexWidget>
          <Bar s={s} c={c} />
        </FlexWidget>
        <GlassButton s={s} c={c} height={52} width={104} />
      </FlexWidget>
      {s.overdue && (
        <TextWidget
          text={s.overdue.count > 1
            ? t('widget.overdueMany', { name: s.overdue.name, time: s.overdue.time, count: s.overdue.count - 1 })
            : t('widget.overdue', { name: s.overdue.name, time: s.overdue.time })}
          maxLines={1} truncate="END"
          style={{ fontSize: 16, fontWeight: '700', color: c.error }}
        />
      )}
      {!!doses && (
        <TextWidget text={doses} maxLines={1} truncate="END"
          style={{ fontSize: 16, color: s.allDosesDone ? c.success : c.textSecondary }} />
      )}
    </FlexWidget>
  );
}

export function WaterWidget({ s, c }: { s: WidgetSummary; c: Colors }) {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{ height: 'match_parent', width: 'match_parent', padding: 10, borderRadius: 22, backgroundColor: c.card, flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between' }}
    >
      <FlexWidget style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <TextWidget text={s.goalMet ? '✓' : t('widget.percent', { p: s.percent })}
          style={{ fontSize: 32, fontWeight: '700', color: s.goalMet ? c.success : c.water }} />
      </FlexWidget>
      <GlassButton s={s} c={c} height={48} width="match_parent" />
    </FlexWidget>
  );
}

function careLastLine(l: NonNullable<CareWidgetSummary['last']>): string {
  return t(`widget.care.last_${l.type}`, { time: l.time, name: l.name });
}

/** Caregiver ("Takip") widget: the followed patient's day. Tap → Yakınlar screen. */
export function CareWidget({ s, c }: { s: CareWidgetSummary | null; c: Colors }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI" clickActionData={{ uri: CAREGIVERS_URL }}
      style={{ height: 'match_parent', width: 'match_parent', padding: 12, borderRadius: 22, backgroundColor: c.card, flexDirection: 'column', justifyContent: 'space-between' }}
    >
      {/* No fragments: the widget tree builder calls every element type as a function. */}
      {!s && <TextWidget text={t('widget.care.title')} style={{ fontSize: 16, fontWeight: '700', color: c.primary }} />}
      {!s && <TextWidget text={t('widget.care.empty')} maxLines={3} truncate="END" style={{ fontSize: 16, color: c.textSecondary }} />}
      {!!s && (
        <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', justifyContent: 'space-between' }}>
          <TextWidget text={s.others > 0 ? `${s.name} +${s.others}` : s.name} maxLines={1} truncate="END"
            style={{ fontSize: 18, fontWeight: '700', color: c.text }} />
          <TextWidget text={t('widget.care.count', { taken: s.taken, planned: s.planned })}
            style={{ fontSize: 18, fontWeight: '700', color: s.planned > 0 && s.taken === s.planned ? c.success : c.primary }} />
        </FlexWidget>
      )}
      {!!s && (
        <TextWidget
          text={s.next ? t('widget.nextDose', { name: s.next.name, time: s.next.time }) : s.planned ? t('widget.care.noneLeft') : t('widget.noDoses')}
          maxLines={1} truncate="END" style={{ fontSize: 16, color: c.textSecondary }} />
      )}
      {!!s?.last && (
        <TextWidget text={careLastLine(s.last)} maxLines={1} truncate="END"
          style={{ fontSize: 16, fontWeight: '700', color: s.last.type === 'taken' ? c.success : s.last.type === 'late' ? c.error : c.warning }} />
      )}
      {!!s?.water && (
        <TextWidget text={t('widget.care.water', { ml: s.water.ml, goal: s.water.goal, p: s.water.percent })} maxLines={1} truncate="END"
          style={{ fontSize: 16, color: c.water }} />
      )}
    </FlexWidget>
  );
}

/** Drawn when building the real widget failed: never leave the home-screen cell transparent. */
export function FallbackWidget() {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{ height: 'match_parent', width: 'match_parent', padding: 12, borderRadius: 22, backgroundColor: '#F7F9FB', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}
    >
      <TextWidget text="AquaMed" style={{ fontSize: 18, fontWeight: '700', color: '#2F6690' }} />
      <TextWidget text={t('widget.fallback', { defaultValue: 'Uygulamayı açın' })} maxLines={2} truncate="END" style={{ fontSize: 14, color: '#4A5665' }} />
    </FlexWidget>
  );
}
