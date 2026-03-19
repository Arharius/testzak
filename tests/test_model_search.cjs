#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const tsSource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend-react', 'src', 'utils', 'model-search.ts'),
  'utf-8'
);

let js = tsSource.replace(/^export /gm, '');
js = js.replace(/function\s+(\w+)\(([^)]*)\):\s*[^{]+\{/g, (_, name, params) => {
  const cleanParams = params.replace(/:\s*[\w[\]<>| ]+/g, '');
  return `function ${name}(${cleanParams}) {`;
});
js = js.replace(/\((\w+)\s*:\s*[\w[\]<>| ]+\)\s*=>/g, '($1) =>');

const mod = eval(`(function(){ ${js}; return { looksLikeSpecificModelQuery }; })()`);

const cases = [
  { input: 'MSI PRO DP21 14M-1069XRU', expected: true },
  { input: 'Dell OptiPlex 7010', expected: true },
  { input: 'Гравитон Н15', expected: true },
  { input: 'asus 1503', expected: false },
  { input: 'Asus Vivobook X1503', expected: true },
  { input: 'ASUS X1503ZA', expected: true },
  { input: 'HP 250', expected: true },
  { input: 'MikroTik CRS326-24G-2S+RM', expected: true },
  { input: 'Astra Linux Special Edition 1.8', expected: true },
  { input: 'системный блок', expected: false },
  { input: 'Системный блок, 16 ГБ ОЗУ, SSD 512 ГБ', expected: false },
  { input: 'Монитор серии 07 RDW', expected: false },
  { input: 'ноутбук lenovo', expected: false },
  { input: 'коммутатор cisco', expected: false },
  { input: 'техническая поддержка ALD Pro', expected: false },
];

let passed = 0;
let failed = 0;

for (const testCase of cases) {
  const actual = mod.looksLikeSpecificModelQuery(testCase.input);
  if (actual === testCase.expected) {
    passed += 1;
    console.log(`PASS  ${JSON.stringify(testCase.input)} -> ${actual}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${JSON.stringify(testCase.input)} -> ${actual}, expected ${testCase.expected}`);
  }
}

console.log(`\n${passed}/${cases.length} checks passed`);

if (failed > 0) process.exit(1);
