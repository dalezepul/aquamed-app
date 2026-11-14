// Which translation keys does the code use? Shared by scripts/i18n-prune.js and the i18n test.
// A key counts as used when it appears as a quoted literal anywhere in src (t('a.b'), nameKey: 'a.b', …)
// or matches the static prefix of a template literal (`beverages.${type}` keeps every "beverages.*").
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

const sourceFiles = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });

const flatKeys = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

const collectUsage = () => {
  const literals = new Set();
  const prefixes = new Set();
  for (const file of sourceFiles(SRC)) {
    const code = fs.readFileSync(file, 'utf8');
    for (const m of code.matchAll(/['"]([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)['"]/g)) literals.add(m[1]);
    for (const m of code.matchAll(/`([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]*)\$\{/g)) prefixes.add(m[1]);
  }
  return { literals, prefixes };
};

const unusedKeys = (dict, usage = collectUsage()) =>
  flatKeys(dict).filter(k => !usage.literals.has(k) && ![...usage.prefixes].some(p => k.startsWith(p)));

module.exports = { flatKeys, collectUsage, unusedKeys, sourceFiles, SRC };
