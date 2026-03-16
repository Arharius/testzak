#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function transpileTsModule(source) {
  let js = source;
  js = js.replace(/^export /gm, '');
  js = js.replace(/^type \w+\s*=\s*[^;]+;\s*$/gm, '');
  js = js.replace(/^interface \w+\s*\{[\s\S]*?\n\}\s*$/gm, '');
  js = js.replace(/(const|let|var)\s+(\w+)\s*:\s*[^=]+=\s*/g, '$1 $2 = ');

  const lines = js.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fnMatch = line.match(/^(\s*function\s+\w+\s*)\(([^)]*)\)\s*:.+\{\s*$/);
    if (fnMatch) {
      const cleanParams = fnMatch[2].replace(/:\s*\w+(\[\])?/g, '');
      lines[i] = `${fnMatch[1]}(${cleanParams}) {`;
    }
    lines[i] = lines[i].replace(/\((\w+)\s*:\s*\w+\)\s*=>/g, '($1) =>');
  }
  js = lines.join('\n');
  js = js.replace(/(const|let|var)\s+(\w+)\s*:\s*Array<\{[^}]+\}>\s*=/g, '$1 $2 =');
  js = js.replace(/new\s+(Set|Map|Array|WeakMap|WeakSet|Promise)<[^>]+>/g, 'new $1');
  js = js.replace(/\s+as\s+const/g, '');
  return js;
}

function evalCatalog(filePath, exportNames) {
  const tsSource = fs.readFileSync(filePath, 'utf8');
  const js = transpileTsModule(tsSource);
  const wrapped = `
    (function() {
      ${js}
      return { ${exportNames.join(', ')} };
    })()
  `;
  return eval(wrapped); // eslint-disable-line no-eval
}

function extractSpecHintKeys(workspaceSource) {
  const match = workspaceSource.match(/const specHintsMap: Record<string, string> = \{([\s\S]*?)\n\};/);
  if (!match) {
    throw new Error('specHintsMap block not found in Workspace.tsx');
  }
  const block = match[1];
  const keys = new Set();
  const keyRegex = /^\s*([A-Za-z0-9_]+)\s*:\s*/gm;
  let item;
  while ((item = keyRegex.exec(block)) !== null) {
    keys.add(item[1]);
  }
  return keys;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const goodsPath = path.join(root, 'frontend-react', 'src', 'data', 'goods-catalog.ts');
  const generalPath = path.join(root, 'frontend-react', 'src', 'data', 'general-catalog.ts');
  const workspacePath = path.join(root, 'frontend-react', 'src', 'components', 'Workspace.tsx');

  const { GOODS_CATALOG } = evalCatalog(goodsPath, ['GOODS_CATALOG']);
  const { GENERAL_CATALOG } = evalCatalog(generalPath, ['GENERAL_CATALOG']);
  const workspaceSource = fs.readFileSync(workspacePath, 'utf8');
  const specHintKeys = extractSpecHintKeys(workspaceSource);

  const goodsKeys = Object.keys(GOODS_CATALOG);
  const generalKeys = Object.keys(GENERAL_CATALOG);

  const goodsWithHardTemplate = goodsKeys.filter((key) => Array.isArray(GOODS_CATALOG[key]?.hardTemplate) && GOODS_CATALOG[key].hardTemplate.length > 0);
  const goodsWithSpecHint = goodsKeys.filter((key) => specHintKeys.has(key));
  const goodsFallbackOnly = goodsKeys.filter((key) => !specHintKeys.has(key) && !goodsWithHardTemplate.includes(key));

  const generalWithSpecHint = generalKeys.filter((key) => String(GENERAL_CATALOG[key]?.specHint || '').trim().length > 0);
  const generalMissingSpecHint = generalKeys.filter((key) => !String(GENERAL_CATALOG[key]?.specHint || '').trim());

  console.log('Catalog coverage audit\n');
  console.log(`IT catalog total: ${goodsKeys.length}`);
  console.log(`IT with detailed specHints: ${goodsWithSpecHint.length}`);
  console.log(`IT with hardTemplate: ${goodsWithHardTemplate.length}`);
  console.log(`IT fallback-only: ${goodsFallbackOnly.length}`);
  console.log('');
  console.log(`General catalog total: ${generalKeys.length}`);
  console.log(`General with specHint: ${generalWithSpecHint.length}`);
  console.log(`General missing specHint: ${generalMissingSpecHint.length}`);

  if (goodsFallbackOnly.length > 0) {
    console.log('\nIT fallback-only types:');
    console.log(goodsFallbackOnly.join(', '));
  }

  if (generalMissingSpecHint.length > 0) {
    console.log('\nGeneral types missing specHint:');
    console.log(generalMissingSpecHint.join(', '));
    process.exitCode = 1;
  }
}

main();
