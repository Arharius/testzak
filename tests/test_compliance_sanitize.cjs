#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require(path.join(__dirname, '..', 'frontend-react', 'node_modules', 'typescript'));

const source = fs.readFileSync(
  path.join(__dirname, '..', 'frontend-react', 'src', 'utils', 'compliance.ts'),
  'utf-8'
);

const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const moduleShim = { exports: {} };
const fn = new Function('require', 'module', 'exports', `${transpiled}; return module.exports;`);
const exported = fn(require, moduleShim, moduleShim.exports);
const { sanitizeProcurementSpecs } = exported;

const sanitized = sanitizeProcurementSpecs(
  { type: 'pc', model: 'MSI PRO DP21 14M-1069XRU' },
  [
    { group: 'Общие сведения', name: 'Part No', value: '9S6-B0A431-1069', unit: '' },
    { group: 'Общие сведения', name: 'MKT Name', value: 'PRO DP21 14M', unit: '' },
    { group: 'Общие сведения', name: 'MKT Spec', value: 'PRO DP21 14M-1069XRU', unit: '' },
    { group: 'Общие сведения', name: 'Процессор', value: 'Intel Core i7 Processor 14700', unit: '' },
  ]
);

if (sanitized.length !== 1 || sanitized[0].name !== 'Процессор') {
  console.error('FAIL compliance sanitizer should drop model identity fields');
  console.error(JSON.stringify(sanitized, null, 2));
  process.exit(1);
}

console.log('PASS compliance sanitizer drops model identity fields');
