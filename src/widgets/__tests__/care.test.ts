import fs from 'fs';
import path from 'path';
import { computeCareWidget, CareSnapshot } from '../care';
import type { SharedDose, PairEvent } from '../../services/pairing';

const DAY = '2026-09-29';
const at = (time: string, date = DAY) => new Date(`${date}T${time}:00`).getTime();
const dose = (medId: string, time: string, date = DAY): SharedDose => ({ medId, name: medId, dose: '1', date, time, at: at(time, date) });
const ev = (type: PairEvent['type'], medId: string, time: string, atTime: string, date = DAY): PairEvent =>
  ({ type, medId, medName: medId, dose: '1', date, time, scheduledAt: at(time, date), at: at(atTime, date) });
const snap = (p: Partial<CareSnapshot['patients'][0]> = {}, more = 0): CareSnapshot => ({
  lateMin: 30,
  patients: [{ name: 'Annem', doses: [], events: [], water: null, ...p }, ...Array(more).fill({ name: 'X', doses: [], events: [], water: null })],
});
const now = (time: string) => new Date(`${DAY}T${time}:00`);

test('nobody followed → null (widget shows the "enter a code" hint)', () => {
  expect(computeCareWidget(null, now('12:00'))).toBeNull();
  expect(computeCareWidget({ lateMin: 30, patients: [] }, now('12:00'))).toBeNull();
});

test('counts, next dose and last event for today only', () => {
  const s = computeCareWidget(snap({
    doses: [dose('Parol', '09:00'), dose('B12', '13:00'), dose('Coraspin', '20:00'), dose('Parol', '09:00', '2026-09-30')],
    events: [ev('taken', 'Parol', '09:00', '09:05'), ev('taken', 'Old', '09:00', '09:00', '2026-09-28')],
  }), now('12:00'))!;
  expect(s).toMatchObject({ name: 'Annem', others: 0, taken: 1, planned: 3 });
  expect(s.next).toEqual({ name: 'B12', time: '13:00' });
  expect(s.last).toEqual({ type: 'taken', name: 'Parol', time: '09:00' });
});

test('an unreported dose past the late window becomes the last event, then a later report wins', () => {
  const doses = [dose('Parol', '09:00'), dose('B12', '10:00')];
  const late = computeCareWidget(snap({ doses, events: [ev('taken', 'Parol', '09:00', '09:05')] }), now('10:45'))!;
  expect(late.last).toEqual({ type: 'late', name: 'B12', time: '10:00' });
  expect(late.next).toBeNull();
  // a dose within the late window is still "next", not late
  expect(computeCareWidget(snap({ doses }), now('10:20'))!.next).toEqual({ name: 'B12', time: '10:00' });
  const skipped = computeCareWidget(snap({ doses, events: [ev('late', 'B12', '10:00', '10:30'), ev('skipped', 'B12', '10:00', '10:50')] }), now('11:00'))!;
  expect(skipped.last).toEqual({ type: 'skipped', name: 'B12', time: '10:00' });
});

test('water only when shared for today; other followed patients counted', () => {
  expect(computeCareWidget(snap({ water: { date: DAY, ml: 1500, goal: 2000 } }), now('12:00'))!.water).toEqual({ ml: 1500, goal: 2000, percent: 75 });
  expect(computeCareWidget(snap({ water: { date: '2026-09-28', ml: 1500, goal: 2000 } }), now('12:00'))!.water).toBeNull();
  expect(computeCareWidget(snap({}, 2), now('12:00'))!.others).toBe(2);
});

// Metro tries index.android.ts, index.ts, then index.android.tsx: a platform file must not be
// shadowed by a base file with an earlier extension (that shipped no-op widgets to Android).
test('platform-specific widget entry is not shadowed by an index.ts', () => {
  const dir = path.join(__dirname, '..');
  const files = fs.readdirSync(dir);
  for (const f of files.filter(n => /\.android\.tsx$/.test(n))) {
    expect(files).not.toContain(f.replace('.android.tsx', '.ts'));
  }
});

test('widget trees build (no fragments / RN views) for every state', () => {
  const React = require('react');
  const { buildWidgetTree } = require('react-native-android-widget/src/api/build-widget-tree');
  const { CareWidget, FallbackWidget, WIDGET_COLORS } = require('../AquaWidgets');
  const c = WIDGET_COLORS.dark;
  const full = computeCareWidget(snap({ doses: [dose('Parol', '09:00'), dose('B12', '13:00')], events: [ev('taken', 'Parol', '09:00', '09:05')], water: { date: DAY, ml: 500, goal: 2000 } }), now('12:00'));
  for (const el of [React.createElement(CareWidget, { s: null, c }), React.createElement(CareWidget, { s: full, c }), React.createElement(FallbackWidget)]) {
    const tree = buildWidgetTree(el);
    expect(tree.type).toBe('LinearLayoutWidget'); // FlexWidget's native type
    expect(JSON.stringify(tree)).not.toContain('undefined');
  }
  const tree = JSON.stringify(buildWidgetTree(React.createElement(CareWidget, { s: full, c })));
  expect(tree).toContain('Annem');
  expect(tree).toContain('caregivers'); // tap opens Yakınlar
});
