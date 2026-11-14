import { suggestSpacedTimes, isAnchored } from '../interactionSchedule';
import { checkInteractions, spacingFor } from '../drugInteractionService';

const within = (t: string, wake: string, sleep: string) => t >= wake && t <= sleep; // same-day window in these tests
const hoursApart = (a: string, b: string) => {
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const d = Math.abs(m(a) - m(b)) % 1440;
  return Math.min(d, 1440 - d) / 60;
};

describe('interactionSchedule', () => {
  it('levothyroxine + calcium -> doses 4 h apart, levothyroxine stays', () => {
    const res = suggestSpacedTimes([
      { id: 'levo', name: 'Levotiron', times: ['08:00'] },
      { id: 'ca', name: 'Kalsiyum', times: ['08:00'] },
    ], '07:00', '23:00');
    expect(res.spaced).toEqual([{ a: 'levo', b: 'ca', hours: 4 }]);
    expect(res.suggested.levo).toEqual(['08:00']);
    expect(res.suggested.ca).toEqual(['12:00']);
  });

  it('keeps the number of doses and their gaps when shifting', () => {
    const res = suggestSpacedTimes([
      { id: 'levo', name: 'Euthyrox', times: ['08:00'] },
      { id: 'ca', name: 'Calcimax', times: ['08:00', '14:00'] },
    ], '07:00', '22:00');
    // Euthyrox (empty stomach, morning) stays even though Calcimax has more doses; both calcium doses shift by 4 h.
    expect(res.suggested.levo).toEqual(['08:00']);
    expect(res.suggested.ca).toEqual(['12:00', '18:00']);
  });

  it('the NEW medicine moves; empty-stomach / high-priority existing ones stay (review: Levotiron was moved to 11:30)', () => {
    const res = suggestSpacedTimes([
      { id: 'ca', name: 'Kalsiyum', times: ['08:00'], isNew: true },
      { id: 'levo', name: 'Levotiron', times: ['08:00'] },
    ], '07:00', '23:00');
    expect(res.suggested.levo).toEqual(['08:00']);
    expect(res.suggested.ca).toEqual(['12:00']);

    const plain = suggestSpacedTimes([
      { id: 'cipro', name: 'Cipro', times: ['08:00'], isNew: true },
      { id: 'fe', name: 'Demir', times: ['08:00'] },
    ], '07:00', '23:00');
    expect(plain.suggested.fe).toEqual(['08:00']);
    expect(plain.suggested.cipro).toEqual(['14:00']);

    // Existing high priority / foodTiming 'empty' beat an existing ordinary one too.
    expect(isAnchored({ name: 'X', priority: 'High' })).toBe(true);
    expect(isAnchored({ name: 'X', foodTiming: 'empty' })).toBe(true);
    expect(isAnchored({ name: 'Euthyrox' })).toBe(true);
    expect(isAnchored({ name: 'Kalsiyum' })).toBe(false);
  });

  it('never suggests a time outside waking hours', () => {
    const res = suggestSpacedTimes([
      { id: 'levo', name: 'Levotiron', times: ['20:00'] },
      { id: 'ca', name: 'Kalsiyum', times: ['21:00'] },
    ], '08:00', '22:00');
    // +3 h (00:00) would be asleep; -5 h lands at 16:00.
    expect(res.suggested.ca).toEqual(['16:00']);
    expect(hoursApart(res.suggested.ca![0], '20:00')).toBeGreaterThanOrEqual(4);

    const tight = suggestSpacedTimes([
      { id: 'ca', name: 'Kalsiyum', times: ['08:00', '14:00', '20:00'] },
      { id: 'levo', name: 'Levotiron', times: ['09:00'] },
    ], '07:00', '22:00');
    // Levotiron stays at 09:00; no shift of the three calcium doses clears it inside waking hours.
    expect(tight.suggested.levo).toEqual(['09:00']);
    expect(tight.suggested.ca).toBeNull();
    expect(within(tight.suggested.levo![0], '07:00', '22:00')).toBe(true);
  });

  it('contraindicated and systemic major interactions get no time suggestion', () => {
    const contra = suggestSpacedTimes([
      { id: 'v', name: 'Viagra', times: ['08:00'] },
      { id: 'n', name: 'Isordil', times: ['08:00'] },
    ], '07:00', '23:00');
    expect(contra.spaced).toEqual([]);
    expect(contra.blocked).toEqual([{ a: 'v', b: 'n', severity: 'contraindicated' }]);
    expect(contra.suggested).toEqual({ v: ['08:00'], n: ['08:00'] });

    const bleed = suggestSpacedTimes([
      { id: 'w', name: 'Coumadin', times: ['08:00'] },
      { id: 'a', name: 'Aspirin', times: ['08:00'] },
    ], '07:00', '23:00');
    expect(bleed.blocked).toEqual([{ a: 'w', b: 'a', severity: 'major' }]);
  });

  it('quinolone + iron and tetracycline + calcium carry their own spacing; unknown moderate defaults to 2 h', () => {
    expect(checkInteractions('Cipro', ['Demir']).interactions[0].spacingHours).toBe(6);
    expect(checkInteractions('Doksisiklin', ['Kalsiyum']).interactions[0].spacingHours).toBe(3);
    expect(spacingFor({ severity: 'moderate' })).toBe(2);
    expect(spacingFor({ severity: 'moderate', spacingHours: 0 })).toBeNull();
    expect(spacingFor({ severity: 'contraindicated', spacingHours: 4 })).toBeNull();
  });
});
