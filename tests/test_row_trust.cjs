#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require(path.join(__dirname, '..', 'frontend-react', 'node_modules', 'typescript'));

const sourcePath = path.join(__dirname, '..', 'frontend-react', 'src', 'utils', 'row-trust.ts');
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

const { buildRowTrustPassport } = mod.exports;

const cases = [
  {
    name: 'ready row with clean external verification',
    input: {
      status: 'done',
      specs: [{ name: 'ОЗУ', value: '16', unit: 'ГБ' }],
      okpd2Code: '26.20.11.110',
      ktruCode: '26.20.11.110-00000001',
      classificationSourceKey: 'eis',
      classificationSourceLabel: 'ЕИС / КТРУ / закупочные площадки',
      law175Label: 'ограничение',
      law175EvidenceText: 'выписка из ГИСП',
      requiresManualReview: false,
      expectExternalSource: true,
      benchmark: {
        label: 'ЕИС / КТРУ / площадки',
        riskLevel: 'ok',
        matched: 8,
        changed: 1,
        missing: 0,
        added: 0,
      },
    },
    expectedTone: 'ready',
    expectedTitle: 'Строка выглядит подтверждённой',
  },
  {
    name: 'row without okpd2 is blocked',
    input: {
      status: 'done',
      specs: [{ name: 'ОЗУ', value: '16', unit: 'ГБ' }],
      classificationSourceKey: 'ai',
      classificationSourceLabel: 'ИИ-классификация по описанию',
      law175Label: 'ограничение',
      law175EvidenceText: 'выписка из ГИСП',
      requiresManualReview: true,
      expectExternalSource: true,
    },
    expectedTone: 'block',
    expectedTitle: 'Строка пока не готова к публикации',
  },
  {
    name: 'imported row with manual review is warning',
    input: {
      status: 'done',
      specs: [{ name: 'Диагональ', value: '27', unit: 'дюйм' }],
      okpd2Code: '26.40.20.110',
      classificationSourceKey: 'docx_import',
      classificationSourceLabel: 'импорт из DOCX / служебной записки',
      law175Label: 'ограничение',
      law175EvidenceText: 'подтверждение по ПП РФ № 1875',
      requiresManualReview: true,
      expectExternalSource: true,
      importInfo: {
        sourceFormat: 'docx',
        confidence: 0.74,
        confidenceLabel: 'medium',
        needsReview: true,
        ignoredBlocks: 2,
        sourcePreview: 'Монитор серии 07 RDW',
      },
    },
    expectedTone: 'warn',
    expectedTitle: 'Строка собрана, но требует точечной проверки',
  },
];

let failed = 0;

for (const testCase of cases) {
  const actual = buildRowTrustPassport(testCase.input);
  const ok = actual.tone === testCase.expectedTone && actual.title === testCase.expectedTitle && Array.isArray(actual.facts) && actual.facts.length >= 4;
  if (ok) {
    console.log(`PASS ${testCase.name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${testCase.name}`);
    console.error(actual);
  }
}

if (failed > 0) process.exit(1);
