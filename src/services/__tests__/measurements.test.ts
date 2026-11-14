import AsyncStorage from '@react-native-async-storage/async-storage';
import { storageService, STORAGE_KEYS } from '../storageService';
import { summarizeMeasurements, renderMeasurementsHtml } from '../doctorReport';
import { classifyMeasurement } from '../../constants/measurementRanges';
import { dailySeries, parseNumber } from '../../utils/measurements';
import { Measurement } from '../../types/models';

const m = (id: string, over: Partial<Measurement>): Measurement => ({
  id, type: 'bp', timestamp: new Date('2026-09-10T08:00:00').toISOString(), value: 120, diastolic: 80, ...over,
});

describe('classifyMeasurement', () => {
  it('blood pressure: ≥140/90 high, ≤90/60 low, otherwise normal', () => {
    expect(classifyMeasurement(m('a', { value: 120, diastolic: 80 }))).toBeNull();
    expect(classifyMeasurement(m('a', { value: 140, diastolic: 80 }))).toBe('high');
    expect(classifyMeasurement(m('a', { value: 130, diastolic: 90 }))).toBe('high');
    expect(classifyMeasurement(m('a', { value: 139, diastolic: 89 }))).toBeNull();
    expect(classifyMeasurement(m('a', { value: 90, diastolic: 70 }))).toBe('low');
    expect(classifyMeasurement(m('a', { value: 110, diastolic: 60 }))).toBe('low');
    expect(classifyMeasurement(m('a', { value: 91, diastolic: 61 }))).toBeNull();
  });
  it('glucose: fasting ≥126 high, <70 low at any time, other contexts high at ≥200', () => {
    const g = (value: number, context: Measurement['context']) => classifyMeasurement({ type: 'glucose', value, context });
    expect(g(125, 'fasting')).toBeNull();
    expect(g(126, 'fasting')).toBe('high');
    expect(g(69, 'fasting')).toBe('low');
    expect(g(70, 'fasting')).toBeNull();
    expect(g(180, 'postMeal')).toBeNull();
    expect(g(200, 'random')).toBe('high');
    expect(g(65, 'postMeal')).toBe('low');
  });
  it('weight is never flagged', () => {
    expect(classifyMeasurement({ type: 'weight', value: 300 })).toBeNull();
  });
});

describe('summarizeMeasurements', () => {
  const list = [
    m('1', { value: 150, diastolic: 95, timestamp: new Date('2026-09-02T08:00:00').toISOString() }),
    m('2', { value: 120, diastolic: 80, timestamp: new Date('2026-09-03T08:00:00').toISOString() }),
    m('3', { value: 130, diastolic: 85, timestamp: new Date('2026-09-20T08:00:00').toISOString() }), // outside range
    m('4', { type: 'glucose', value: 130, diastolic: undefined, context: 'fasting', timestamp: new Date('2026-09-04T07:00:00').toISOString() }),
    m('5', { type: 'weight', value: 72.5, diastolic: undefined, timestamp: new Date('2026-09-05T07:00:00').toISOString() }),
  ];
  it('stats per type for the range: avg/min/max and out-of-range count', () => {
    const s = summarizeMeasurements(list, '2026-09-01', '2026-09-10')!;
    expect(s.rows.map(r => r.id)).toEqual(['1', '2', '4', '5']);
    const bp = s.stats.find(x => x.type === 'bp')!;
    expect(bp).toMatchObject({ count: 2, outOfRange: 1, value: { avg: 135, min: 120, max: 150 }, diastolic: { avg: 87.5, min: 80, max: 95 } });
    expect(s.stats.find(x => x.type === 'glucose')).toMatchObject({ count: 1, outOfRange: 1 });
    expect(s.stats.find(x => x.type === 'weight')).toMatchObject({ count: 1, outOfRange: 0, value: { avg: 72.5 } });
  });
  it('no readings in range → null (section hidden)', () => {
    expect(summarizeMeasurements(list, '2026-10-01', '2026-10-30')).toBeNull();
  });
  it('renders escaped notes and flags', () => {
    const html = renderMeasurementsHtml(summarizeMeasurements([m('x', { value: 150, diastolic: 95, note: '<b>baş ağrısı</b>' })], '2026-09-01', '2026-09-30')!);
    expect(html).toContain('150/95');
    expect(html).toContain('▲');
    expect(html).toContain('&lt;b&gt;baş ağrısı&lt;/b&gt;');
  });
});

describe('dailySeries / parseNumber', () => {
  it('averages per day and flags a day with any out-of-range reading', () => {
    const s = dailySeries([
      m('a', { value: 150, diastolic: 95, timestamp: new Date('2026-09-10T08:00:00').toISOString() }),
      m('b', { value: 120, diastolic: 75, timestamp: new Date('2026-09-10T20:00:00').toISOString() }),
      m('c', { value: 118, diastolic: 76, timestamp: new Date('2026-09-11T08:00:00').toISOString() }),
    ], 'bp', '2026-09-01');
    expect(s).toEqual([
      { date: '2026-09-10', value: 135, low: 85, flag: 'high' },
      { date: '2026-09-11', value: 118, low: 76, flag: null },
    ]);
  });
  it('accepts a decimal comma', () => {
    expect(parseNumber('72,5')).toBe(72.5);
    expect(parseNumber(' ')).toBeNaN();
  });
});

describe('storage CRUD', () => {
  beforeEach(async () => { await AsyncStorage.clear(); });
  it('saves (upsert), lists newest first, deletes, and is part of the backup export', async () => {
    await storageService.saveMeasurement(m('1', { timestamp: '2026-09-01T08:00:00.000Z' }));
    await storageService.saveMeasurement(m('2', { timestamp: '2026-09-02T08:00:00.000Z' }));
    await storageService.saveMeasurement(m('1', { timestamp: '2026-09-01T08:00:00.000Z', value: 135 }));
    let list = await storageService.getMeasurements();
    expect(list.map(x => x.id)).toEqual(['2', '1']);
    expect(list[1].value).toBe(135);
    expect(Object.keys(await storageService.exportAllData())).toContain(STORAGE_KEYS.MEASUREMENTS);
    await storageService.deleteMeasurement('2');
    list = await storageService.getMeasurements();
    expect(list.map(x => x.id)).toEqual(['1']);
  });
  it('import restores measurements', async () => {
    await storageService.importAllData({ [STORAGE_KEYS.MEASUREMENTS]: JSON.stringify([m('9', {})]) });
    expect((await storageService.getMeasurements()).map(x => x.id)).toEqual(['9']);
  });
});
