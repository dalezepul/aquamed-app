import { parseDosage, formatDosage, doseFromMedication, stepAmount, parseAmount, isCountable } from '../dose';

describe('dose', () => {
  it('parses TR and EN legacy dosage text', () => {
    expect(parseDosage('1 tablet')).toEqual({ amount: 1, unit: 'tablet' });
    expect(parseDosage('1 Tablet')).toEqual({ amount: 1, unit: 'tablet' });
    expect(parseDosage('2 puf')).toEqual({ amount: 2, unit: 'puff' });
    expect(parseDosage('2 puffs')).toEqual({ amount: 2, unit: 'puff' });
    expect(parseDosage('10 ml')).toEqual({ amount: 10, unit: 'ml' });
    expect(parseDosage('500 mg')).toEqual({ amount: 500, unit: 'mg' });
    expect(parseDosage('3 damla')).toEqual({ amount: 3, unit: 'drop' });
    expect(parseDosage('1 kapsül')).toEqual({ amount: 1, unit: 'capsule' });
    expect(parseDosage('2 capsules')).toEqual({ amount: 2, unit: 'capsule' });
    expect(parseDosage('10 ünite')).toEqual({ amount: 10, unit: 'unit' });
    expect(parseDosage('1 ölçek')).toEqual({ amount: 1, unit: 'scoop' });
  });

  it('reads a decimal comma, halves and a strength', () => {
    expect(parseDosage('0,5 tablet')).toEqual({ amount: 0.5, unit: 'tablet' });
    expect(parseDosage('yarım tablet')).toEqual({ amount: 0.5, unit: 'tablet' });
    expect(parseDosage('1 tablet · 500 mg')).toEqual({ amount: 1, unit: 'tablet', strength: '500 mg' });
    expect(parseDosage('1 tablet 500 mg')).toEqual({ amount: 1, unit: 'tablet', strength: '500 mg' });
    expect(parseAmount('0,25')).toBe(0.25);
  });

  it('returns null for text it cannot read (shown as "other")', () => {
    expect(parseDosage('Tok karnına')).toBeNull();
    expect(parseDosage('1 tablet, tok karnına')).toBeNull();
    expect(parseDosage('')).toBeNull();
    expect(doseFromMedication({ dosage: 'Tok karnına' })).toEqual({ amount: 1, unit: 'other', text: 'Tok karnına' });
  });

  it('formats the dosage string used by notifications', () => {
    expect(formatDosage({ amount: 1, unit: 'tablet', strength: '500 mg' }, 'tr')).toBe('1 tablet · 500 mg');
    expect(formatDosage({ amount: 0.5, unit: 'tablet' }, 'tr')).toBe('0,5 tablet');
    expect(formatDosage({ amount: 2, unit: 'tablet' }, 'en')).toBe('2 tablets');
    expect(formatDosage({ amount: 1, unit: 'puff' }, 'en')).toBe('1 puff');
    expect(formatDosage({ amount: 1, unit: 'other', text: 'Bir avuç' }, 'tr')).toBe('Bir avuç');
    expect(formatDosage({ amount: 1, unit: 'other', text: '' }, 'tr')).toBeUndefined();
  });

  it('round-trips saved structured fields, including "other"', () => {
    expect(doseFromMedication({ dosage: '2 tablet', doseAmount: 2, doseUnit: 'tablet' })).toEqual({ amount: 2, unit: 'tablet', strength: undefined, text: undefined });
    expect(doseFromMedication({ dosage: 'Bir avuç · 5 mg', doseUnit: 'other', strength: '5 mg' }).text).toBe('Bir avuç');
  });

  it('steps tablets by 0.25 / 0.5 and counted units by 1', () => {
    expect(stepAmount(1, 'tablet', -1)).toBe(0.5);
    expect(stepAmount(0.5, 'tablet', -1)).toBe(0.25);
    expect(stepAmount(0.25, 'tablet', 1)).toBe(0.5);
    expect(stepAmount(1, 'tablet', 1)).toBe(1.5);
    expect(stepAmount(1, 'capsule', -1)).toBe(1);
    expect(stepAmount(2, 'puff', 1)).toBe(3);
    expect(isCountable('tablet')).toBe(true);
    expect(isCountable('ml')).toBe(false);
  });
});
