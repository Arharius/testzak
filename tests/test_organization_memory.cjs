#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require(path.join(__dirname, '..', 'frontend-react', 'node_modules', 'typescript'));

const sourcePath = path.join(__dirname, '..', 'frontend-react', 'src', 'utils', 'organization-memory.ts');
const tsSource = fs.readFileSync(sourcePath, 'utf-8');
const transpiled = ts.transpileModule(tsSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const mod = { exports: {} };
const fn = new Function('exports', 'module', transpiled);
fn(mod.exports, mod);

const {
  ORGANIZATION_PRESET_OPTIONS,
  getOrganizationPresetMeta,
  buildOrganizationMemoryPromptBlock,
} = mod.exports;

const cases = [
  {
    name: 'general preset stays neutral but explicit',
    actual: buildOrganizationMemoryPromptBlock({
      industryPreset: 'general',
      orgName: 'Тестовый заказчик',
      organizationInstructions: '',
      defaultWarrantyMonths: 0,
    }),
    expect: ['Универсальный заказчик', 'Тестовый заказчик', 'не отменяют требования 44-ФЗ/223-ФЗ'],
    reject: ['24 мес'],
  },
  {
    name: 'education preset carries sector priorities and warranty baseline',
    actual: buildOrganizationMemoryPromptBlock({
      industryPreset: 'education',
      orgName: 'Школа №1',
      organizationInstructions: 'русская документация; упор на учебные классы',
      defaultWarrantyMonths: 24,
    }),
    expect: ['Образование', 'учебные кабинеты', 'не менее 24 мес', 'русская документация', 'упор на учебные классы'],
    reject: [],
  },
  {
    name: 'service mode does not inject warranty hint',
    actual: buildOrganizationMemoryPromptBlock({
      industryPreset: 'healthcare',
      organizationInstructions: 'важна непрерывность работы',
      defaultWarrantyMonths: 36,
    }, true),
    expect: ['Здравоохранение', 'надежность, непрерывность работы', 'важна непрерывность работы'],
    reject: ['36 мес'],
  },
];

let failed = 0;

if (!Array.isArray(ORGANIZATION_PRESET_OPTIONS) || ORGANIZATION_PRESET_OPTIONS.length < 5) {
  console.error('FAIL preset options export');
  failed += 1;
}

if (getOrganizationPresetMeta('municipal').label !== 'Администрация / муниципалитет') {
  console.error('FAIL municipal preset meta');
  failed += 1;
}

for (const testCase of cases) {
  const ok = testCase.expect.every((part) => testCase.actual.includes(part))
    && testCase.reject.every((part) => !testCase.actual.includes(part));
  if (ok) {
    console.log(`PASS ${testCase.name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${testCase.name}`);
    console.error(testCase.actual);
  }
}

if (failed > 0) process.exit(1);
