// Removes translation keys the code no longer uses (see scripts/i18n-usage.js). Usage: node scripts/i18n-prune.js [--dry]
const fs = require('fs');
const path = require('path');
const { unusedKeys, collectUsage } = require('./i18n-usage');

const dir = path.join(__dirname, '..', 'src', 'localization');
const dry = process.argv.includes('--dry');
const usage = collectUsage();
const dropEmpty = o => { for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') { dropEmpty(o[k]); if (!Object.keys(o[k]).length) delete o[k]; } };

for (const lang of ['tr', 'en']) {
  const f = path.join(dir, `${lang}.json`);
  const dict = JSON.parse(fs.readFileSync(f, 'utf8'));
  const unused = unusedKeys(dict, usage);
  for (const key of unused) {
    const parts = key.split('.');
    const parent = parts.slice(0, -1).reduce((o, p) => o?.[p], dict);
    if (parent) delete parent[parts.at(-1)];
  }
  dropEmpty(dict);
  console.log(`${lang}: ${unused.length} unused key(s)${dry ? ' (dry run)' : ' removed'}`);
  if (!dry) fs.writeFileSync(f, JSON.stringify(dict, null, 2) + '\n');
}
