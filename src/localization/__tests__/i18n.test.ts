import fs from 'fs';
import path from 'path';
import tr from '../tr.json';
import en from '../en.json';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { flatKeys, sourceFiles, unusedKeys, SRC } = require('../../../scripts/i18n-usage');

describe('translations', () => {
  const trKeys = new Set<string>(flatKeys(tr));
  const enKeys = new Set<string>(flatKeys(en));

  it('tr and en have the same keys', () => {
    expect([...trKeys].filter(k => !enKeys.has(k))).toEqual([]);
    expect([...enKeys].filter(k => !trKeys.has(k))).toEqual([]);
  });

  it('every literal t("…") key used in code exists', () => {
    const missing: string[] = [];
    for (const file of sourceFiles(SRC) as string[]) {
      const code = fs.readFileSync(file, 'utf8');
      for (const m of code.matchAll(/\bt\(\s*['"]([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)['"]/g)) {
        if (!trKeys.has(m[1])) missing.push(`${path.relative(SRC, file)}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('no unused keys (run `node scripts/i18n-prune.js` to remove them)', () => {
    expect(unusedKeys(tr)).toEqual([]);
  });

  it('placeholders match between languages', () => {
    const ph = (s: string) => (s.match(/{{\w+}}/g) || []).sort().join(',');
    const get = (o: any, k: string) => k.split('.').reduce((a, p) => a?.[p], o);
    const bad = [...trKeys].filter(k => enKeys.has(k) && ph(get(tr, k)) !== ph(get(en, k)));
    expect(bad).toEqual([]);
  });

  it('interpolated values are literal (no $& / $1 replacement patterns)', () => {
    const { t, setLocale } = require('../i18n');
    setLocale('tr');
    expect(t('notification_action.med_taken', { name: 'A$&B' })).toBe('A$&B alındı!');
  });
});
