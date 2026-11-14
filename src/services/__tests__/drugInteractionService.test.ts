import {
  checkInteractions,
  drugInteractionService,
  INGREDIENT_CLASSES,
  INTERACTION_DISCLAIMER,
  normalizeDrugName,
  resolveIngredients,
  RULES,
} from '../drugInteractionService';
import { MEDICATION_DATABASE } from '../../constants/medications';

const sev = (a: string, b: string) => checkInteractions(a, [b]).interactions[0]?.severity;

/** Names in medications.ts whose active ingredient was NOT verified; they must surface as unrecognized. */
const UNVERIFIED = [
  'Bratellix', 'Allerset', 'Apikobal', 'Aprol', 'Avmigran', 'Cedrina', 'Cholestor', 'Citoles', 'Creval',
  'Croxilex', 'Daclin', 'Dextrocin', 'Diazem', 'Emedur', 'Fito', 'Gastrex', 'Geralgine', 'Gyrex', 'Infex',
  'Kwellada', 'Lexan', 'Misol', 'Redepra', 'Rexapin', 'Secita', 'Selectra', 'Thermoflex', 'Tranko-Buskas',
];

describe('drugInteractionService', () => {
  it('finds all pairs that the old unsorted keys never matched', () => {
    const legacy: [string, string][] = [
      ['warfarin', 'acetaminophen'],
      ['metformin', 'alcohol'],
      ['simvastatin', 'amiodarone'],
      ['methotrexate', 'ibuprofen'],
      ['parol', 'aspirin'],
      ['majezik', 'aspirin'],
      ['majezik', 'ibuprofen'],
      ['parol', 'majezik'],
    ];
    for (const [a, b] of legacy) {
      expect(sev(a, b)).toBeDefined();
      expect(sev(b, a)).toBeDefined();
    }
  });

  it('Coumadin + Aspirin -> major bleeding warning', () => {
    const res = checkInteractions('Coumadin', ['Aspirin']);
    expect(res.interactions).toHaveLength(1);
    expect(res.interactions[0]).toMatchObject({ with: 'Aspirin', severity: 'major' });
    expect(res.disclaimerKey).toBe('interactions.disclaimer');
  });

  it('handles doses, forms, case and Turkish characters', () => {
    expect(sev('Aspirin 100 mg', 'coumadin')).toBe('major');
    expect(sev('Coraspin 300mg tablet', 'VARFARİN')).toBe('major');
    expect(sev('İBUPROFEN 400 MG', 'Coumadin 5mg')).toBe('major');
    expect(sev('CORASPIN', 'ORFARIN')).toBe('major');
    expect(sev('coraspın', 'orfarın')).toBe('major');
    expect(normalizeDrugName('PAROL 500 MG')).toBe('parol');
    expect(normalizeDrugName('Potasyum Klorür')).toBe('potasyum klorur');
  });

  it('sildenafil + nitroglycerin is contraindicated', () => {
    expect(sev('Sildenafil', 'Nitroglycerin')).toBe('contraindicated');
    expect(sev('Cialis', 'Isosorbide')).toBe('contraindicated');
  });

  it('flags the same active ingredient entered twice', () => {
    const res = checkInteractions('Parol', ['Minoset']);
    expect(res.interactions[0].severity).toBe('major');
    expect(res.interactions[0].messageEn).toContain('paracetamol');
    expect(sev('Excedrin', 'Panadol')).toBe('major'); // combination product
  });

  it('flags two NSAIDs', () => {
    expect(sev('Nurofen', 'Apranax')).toBe('major');
    expect(sev('Arveles', 'Dolorex')).toBe('major');
  });

  it('reports unknown names instead of silently saying "no interaction"', () => {
    const res = checkInteractions('Xyzzyqux', ['Coumadin', 'Blorbex 10 mg']);
    expect(res.interactions).toEqual([]);
    expect(res.unrecognized).toEqual(['Xyzzyqux', 'Blorbex 10 mg']);
  });

  it('returns empty for a pair without a known interaction', () => {
    expect(checkInteractions('Amoxicillin', ['Parol'])).toEqual({
      interactions: [], unrecognized: [], disclaimerKey: 'interactions.disclaimer',
    });
  });

  it('sorts results by severity', () => {
    const res = checkInteractions('Viagra', ['Parol', 'Coumadin', 'Nitroglycerin']);
    expect(res.interactions.map(i => i.severity)).toEqual(['contraindicated']);
    const res2 = checkInteractions('Aspirin', ['Parol', 'Coumadin']);
    expect(res2.interactions.map(i => i.severity)).toEqual(['major', 'moderate']);
  });

  it('covers the required rule set', () => {
    expect(sev('Coumadin', 'Flagyl')).toBe('major');
    expect(sev('Coumadin', 'Flucan')).toBe('major');
    expect(sev('Coumadin', 'Cordarone')).toBe('major');
    expect(sev('Coumadin', 'Klacid')).toBe('moderate');
    expect(sev('Xarelto', 'Nurofen')).toBe('major');
    expect(sev('Eliquis', 'Plavix')).toBe('major');
    expect(sev('Xanax', 'Tramadol')).toBe('major');
    expect(sev('Lustral', 'Aurorix')).toBe('contraindicated');
    expect(sev('Prozac', 'Tramadol')).toBe('major');
    expect(sev('Lityum', 'Majezik')).toBe('major');
    expect(sev('Lityum', 'Delix')).toBe('major');
    expect(sev('Lityum', 'Lasix')).toBe('major');
    expect(sev('Spironolactone', 'Zestril')).toBe('major');
    expect(sev('Aldactone', 'Diovan')).toBe('major');
    expect(sev('Spironolakton', 'Potassium Chloride')).toBe('major');
    expect(sev('Zocor', 'Klamer')).toBe('major');
    expect(sev('Lipitor', 'Sporanox')).toBe('major');
    expect(sev('Glifor', 'Alkol')).toBe('major');
    expect(sev('Metotreksat', 'Voltaren')).toBe('major');
    expect(sev('Plavix', 'Losec')).toBe('moderate');
  });

  it('every rule is symmetric: (A,B) == (B,A)', () => {
    const examples = (m: string | string[]): string[] => (Array.isArray(m) ? m : [m]).flatMap(x =>
      x.startsWith('@')
        ? Object.keys(INGREDIENT_CLASSES).filter(i => INGREDIENT_CLASSES[i].includes(x.slice(1)))
        : [x]);
    for (const rule of RULES) {
      const as = examples(rule.a);
      const bs = examples(rule.b);
      expect(as.length).toBeGreaterThan(0);
      expect(bs.length).toBeGreaterThan(0);
      for (const a of as) for (const b of bs) {
        const ab = checkInteractions(a, [b]).interactions[0];
        const ba = checkInteractions(b, [a]).interactions[0];
        expect(ab).toBeDefined();
        expect(ab.severity).toBe(ba.severity);
        expect(ab.messageEn).toBe(ba.messageEn);
      }
    }
  });

  it('maps every autocomplete name in medications.ts (except the unverified list)', () => {
    const missing = MEDICATION_DATABASE.filter(n => !resolveIngredients(n) && !UNVERIFIED.includes(n));
    expect(missing).toEqual([]);
  });

  it('exports the disclaimer text', () => {
    expect(INTERACTION_DISCLAIMER.key).toBe('interactions.disclaimer');
    expect(INTERACTION_DISCLAIMER.tr.length).toBeGreaterThan(0);
    expect(INTERACTION_DISCLAIMER.en.length).toBeGreaterThan(0);
  });

  it('legacy checkInteractionsByName still works', async () => {
    const res = await drugInteractionService.checkInteractionsByName(['Aspirin', 'Coumadin']);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ drug1Name: 'Aspirin', drug2Name: 'Coumadin', severity: 'major' });
  });
});
