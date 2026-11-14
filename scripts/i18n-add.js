// Usage: node scripts/i18n-add.js '{"a.b":["TR","EN"]}'  or  node scripts/i18n-add.js @keys.json
// Adds/overwrites keys in tr.json and en.json, preserving order.
const fs = require('fs');
const path = require('path');
const arg = process.argv[2];
const entries = JSON.parse(arg.startsWith("@") ? fs.readFileSync(arg.slice(1), "utf8") : arg);
['tr', 'en'].forEach((lang, i) => {
  const f = path.join(__dirname, '..', 'src', 'localization', `${lang}.json`);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const [key, vals] of Object.entries(entries)) {
    const parts = key.split('.');
    let o = j;
    for (const p of parts.slice(0, -1)) o = o[p] = o[p] || {};
    o[parts.at(-1)] = vals[i];
  }
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
});
