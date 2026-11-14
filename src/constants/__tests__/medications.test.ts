import { MEDICATION_DATABASE, MEDICATION_GROUPS, MEDICATION_INGREDIENTS } from '../medications';
import { checkInteractions, normalizeDrugName, resolveIngredients } from '../../services/drugInteractionService';

const sev = (a: string, b: string) => checkInteractions(a, [b]).interactions[0]?.severity;

describe('MEDICATION_DATABASE', () => {
  it('has no duplicates, even after case/Turkish-letter/punctuation normalization', () => {
    const keys = MEDICATION_DATABASE.map(normalizeDrugName);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
    // a name repeated across groups would be silently merged by the spread
    const groupTotal = Object.values(MEDICATION_GROUPS).reduce((s, g) => s + (Array.isArray(g) ? g.length : Object.keys(g).length), 0);
    expect(groupTotal).toBe(MEDICATION_DATABASE.length);
  });

  it('has no empty or padded names', () => {
    for (const n of MEDICATION_DATABASE) {
      expect(n).toBe(n.trim());
      expect(normalizeDrugName(n)).not.toBe('');
    }
  });

  it('contains common Turkish brands, generics and supplements', () => {
    const has = (n: string) => MEDICATION_DATABASE.some(m => m.toLocaleLowerCase('tr') === n.toLocaleLowerCase('tr'));
    for (const n of ['Arveles', 'Glifor', 'Euthyrox', 'Levotiron', 'Beloc', 'Dideral', 'Forziga', 'NovoRapid', 'Seretide',
      'Desferal', 'parasetamol', 'essitalopram', 'asetilsalisilik asit', 'İbuprofen', 'D vitamini', 'Omega-3', 'Çinko']) {
      expect(has(n)).toBe(true);
    }
    expect(MEDICATION_DATABASE.length).toBeGreaterThan(1200);
  });

  it('every mapped name resolves to its listed ingredients', () => {
    for (const [n, ings] of Object.entries(MEDICATION_INGREDIENTS)) expect([n, resolveIngredients(n)]).toEqual([n, ings]);
  });
});

describe('interaction mapping of the new names', () => {
  it('Coumadin + Arveles -> major bleeding (warfarin + NSAID)', () => {
    expect(sev('Coumadin', 'Arveles')).toBe('major');
    expect(sev('Orfarin', 'Xefo')).toBe('major');
  });

  it('new brands reach existing class rules', () => {
    expect(sev('Pingel', 'Lixiana')).toBe('major'); // antiplatelet + DOAC
    expect(sev('Ciproxin', 'Teotard')).toBe('major'); // ciprofloxacin + theophylline
  });

  it('flags the same ingredient under a brand and a Turkish generic name', () => {
    expect(sev('Janumet', 'Glifor')).toBe('major'); // both contain metformin
    expect(sev('Tefor', 'levotiroksin')).toBe('major');
  });
});
