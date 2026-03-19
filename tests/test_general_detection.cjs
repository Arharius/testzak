const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'frontend-react', 'src', 'data', 'general-catalog.ts'),
  'utf-8'
);

const checks = [
  {
    name: 'General catalog contains explicit shredder oil type',
    ok: source.includes('shredderOil: {')
      && source.includes("name: 'Масло / смазка для шредера'")
      && source.includes("placeholder: 'Например: масло для уничтожителей документов, шредеров, флакон 350 мл...'"),
  },
  {
    name: 'Shredder oil has procurement-oriented spec hint',
    ok: source.includes('Назначение (для уничтожителей документов / шредеров)')
      && source.includes('объём фасовки (мл)')
      && source.includes('антикоррозионные и противоизносные свойства'),
  },
  {
    name: 'Shredder oil is available in manual general catalog groups',
    ok: source.includes("'calculator', 'envelope', 'shredderOil'"),
  },
  {
    name: 'Shredder oil is treated as no-regime office consumable',
    ok: source.includes("'waterDrinking', 'foodCatering', 'detergent', 'cleaningSet', 'toiletPaper', 'shredderOil'"),
  },
];

let failed = 0;

for (const check of checks) {
  const marker = check.ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${marker} ${check.name}`);
  if (!check.ok) failed += 1;
}

if (failed > 0) {
  process.exit(1);
}
