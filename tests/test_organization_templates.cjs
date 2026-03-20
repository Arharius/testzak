#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require(path.join(__dirname, '..', 'frontend-react', 'node_modules', 'typescript'));

const sourcePath = path.join(__dirname, '..', 'frontend-react', 'src', 'utils', 'organization-templates.ts');
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
  getSuggestedOrganizationTemplatePacks,
  suggestTemplateNameForPreset,
} = mod.exports;

const checks = [
  {
    name: 'education preset exposes classroom template',
    ok: getSuggestedOrganizationTemplatePacks('education').some((item) => item.id === 'education-classroom' && item.rows.length >= 3),
  },
  {
    name: 'it preset exposes server-room template',
    ok: getSuggestedOrganizationTemplatePacks('it_department').some((item) => item.id === 'small-server-room'),
  },
  {
    name: 'municipal preset still includes common office pack',
    ok: getSuggestedOrganizationTemplatePacks('municipal').some((item) => item.id === 'office-workplace'),
  },
  {
    name: 'template name suggestion uses organization name when available',
    ok: suggestTemplateNameForPreset('healthcare', 'ГКБ №1') === 'ГКБ №1 — типовой набор',
  },
  {
    name: 'general preset fallback is non-empty',
    ok: suggestTemplateNameForPreset('general', '').length > 5,
  },
];

let failed = 0;
for (const check of checks) {
  if (check.ok) {
    console.log(`PASS ${check.name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${check.name}`);
  }
}

if (failed > 0) process.exit(1);
