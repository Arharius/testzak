#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const projectRoot = path.resolve(__dirname, '..');
const htmlPath = path.join(projectRoot, 'legacy', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

function extractBetween(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`Start marker not found: ${startMarker}`);
  }
  const end = src.indexOf(endMarker, start);
  if (end === -1) {
    throw new Error(`End marker not found: ${endMarker}`);
  }
  return src.slice(start, end);
}

function runAutoDetectChecks() {
  const block = extractBetween(
    html,
    '// Автоопределение типа товара по введённому названию продукта',
    '// HTML дропдауна для строки'
  );

  const nodes = Object.create(null);
  const context = {
    GOODS_CATALOG: {
      pc: { name: 'Системный блок' },
      laptop: { name: 'Ноутбук' },
      dvd: { name: 'Оптический диск (CD/DVD/BD)' },
      patchCord: { name: 'Патч-корд (кабель витая пара)' },
      backup_sw: { name: 'ПО резервного копирования' },
      vdi: { name: 'VDI / платформа виртуальных рабочих мест' },
      erp: { name: 'ERP / бухгалтерское ПО' },
      dbms: { name: 'СУБД' },
    },
    document: {
      getElementById(id) {
        return nodes[id] || null;
      },
    },
    setTimeout: () => {},
  };

  vm.createContext(context);
  vm.runInContext(block, context);

  function detect(input, initialType = 'pc') {
    nodes['goods-type-1'] = { value: initialType };
    nodes['goods-search-1'] = { value: '', style: {}, title: '' };
    context.autoDetectGoodsType(1, input);
    return nodes['goods-type-1'].value;
  }

  const deterministicCases = [
    ['Asus Vivobook 15 X1504', 'laptop'],
    ['DVD-R Verbatim 4.7GB', 'dvd'],
    ['UTP 305 метров cat5e', 'patchCord'],
    ['Витая пара DEXP TP5C51UUTP305G', 'patchCord'],
    ['RuBackup 2.0', 'backup_sw'],
    ['Termidesk 5.0', 'vdi'],
    ['1С:Предприятие 8', 'erp'],
    ['Гравитон', 'pc'],
    ['Graviton N15', 'laptop'],
  ];

  for (const [input, expected] of deterministicCases) {
    const got = detect(input);
    assert.strictEqual(
      got,
      expected,
      `autoDetectGoodsType("${input}") -> "${got}", expected "${expected}"`
    );
  }

  // Регрессия: префиксный ввод "гр" не должен уводить в СУБД.
  const progressive = 'гравитон';
  nodes['goods-type-1'] = { value: 'pc' };
  nodes['goods-search-1'] = { value: '', style: {}, title: '' };
  for (let i = 1; i <= progressive.length; i += 1) {
    const partial = progressive.slice(0, i);
    context.autoDetectGoodsType(1, partial);
    const got = nodes['goods-type-1'].value;
    assert.notStrictEqual(
      got,
      'dbms',
      `prefix "${partial}" incorrectly detected as dbms`
    );
  }
}

function runDictionaryConsistencyChecks() {
  const catalogBlock = extractBetween(
    html,
    'const GOODS_CATALOG = {',
    '// (onGoodsTypeChange удалена — интерфейс перешёл на мульти-строчный список)'
  );
  const listsBlock = extractBetween(
    html,
    'const HW_878_TYPES =',
    '// Возвращает HTML-строки для таблицы раздела 2'
  );

  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${catalogBlock}\n${listsBlock}\nthis.GOODS_CATALOG = GOODS_CATALOG; this.HW_878_TYPES = HW_878_TYPES; this.SW_1236_TYPES = SW_1236_TYPES; this.HW_175_TYPES = HW_175_TYPES;`,
    context
  );

  const catalog = context.GOODS_CATALOG;
  const allTypes = new Set(Object.keys(catalog));
  const listedTypes = [
    ...context.HW_878_TYPES,
    ...context.SW_1236_TYPES,
    ...context.HW_175_TYPES,
  ];

  for (const type of listedTypes) {
    assert.ok(allTypes.has(type), `Type "${type}" from NPA lists is missing in GOODS_CATALOG`);
  }

  for (const type of context.SW_1236_TYPES) {
    assert.ok(
      catalog[type] && catalog[type].isSoftware === true,
      `Type "${type}" is listed in SW_1236_TYPES but isSoftware !== true`
    );
  }
}

function runLaw1875PolicyChecks() {
  const catalogBlock = extractBetween(
    html,
    'const GOODS_CATALOG = {',
    '// (onGoodsTypeChange удалена — интерфейс перешёл на мульти-строчный список)'
  );
  const detectBlock = extractBetween(
    html,
    '// Автоопределение типа товара по введённому названию продукта',
    '// HTML дропдауна для строки'
  );
  const listsBlock = extractBetween(
    html,
    'const HW_878_TYPES =',
    '// Возвращает HTML-строки для таблицы раздела 2'
  );

  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${catalogBlock}
${detectBlock}
${listsBlock}
this.applyLaw175MetaPolicy = applyLaw175MetaPolicy;
this.normalizeLaw175Status = normalizeLaw175Status;
this.normalizeNacRegime = normalizeNacRegime;`,
    context
  );

  const policy = context.applyLaw175MetaPolicy;
  assert.ok(typeof policy === 'function', 'applyLaw175MetaPolicy must exist');

  const foreignSw = policy({}, 'office', 'Microsoft Office LTSC');
  assert.strictEqual(foreignSw.nac_regime, 'pp1236', 'Foreign SW must resolve to pp1236');
  assert.strictEqual(foreignSw.law175_status, 'forbidden', 'Foreign SW should be forbidden by policy');

  const russianSw = policy({}, 'office', 'МойОфис Стандартный');
  assert.strictEqual(russianSw.nac_regime, 'pp1236', 'Russian SW must resolve to pp1236');
  assert.strictEqual(russianSw.law175_status, 'exempt', 'Russian SW should be exempt (national-regime control)');

  const exceptionCase = policy({}, 'laptop', 'Ноутбук для аварийных работ (исключение ПП 1875)');
  assert.strictEqual(exceptionCase.law175_status, 'allowed', 'Exception hint must force allowed');
  assert.ok(
    /исключени|неприменени/i.test(exceptionCase.law175_basis),
    'Exception basis should mention exception/non-application'
  );

  const invalidMeta = policy({ nac_regime: 'abc', law175_status: 'zzz' }, 'patchCord', 'UTP cat6');
  assert.strictEqual(invalidMeta.nac_regime, 'none', 'Unknown goods type must resolve to none regime');
  assert.strictEqual(invalidMeta.law175_status, 'allowed', 'Unknown goods type must be allowed');
}

function runLegalTextChecks() {
  const requiredSnippets = [
    'Федеральным законом от 05.04.2013 № 44-ФЗ (ст. 14)',
    'Постановлением Правительства РФ от 23.12.2024 № 1875',
    'актуальную редакцию ПП РФ № 1875',
    'ПП РФ от 16.11.2015 № 1236',
    'Решения Совета ЕЭК от 23.11.2020 № 105',
    'ПП РФ от 17.07.2015 № 719',
    'универсальный передаточный документ (УПД) или товарная накладная (ТОРГ-12)',
    'или эквивалентными',
    'не ниже класса КС1',
  ];

  for (const snippet of requiredSnippets) {
    assert.ok(html.includes(snippet), `Required legal snippet not found: "${snippet}"`);
  }

  const forbiddenSnippets = [
    'заключения Минпромторга',
    'КС1 и/или КС2',
  ];

  for (const snippet of forbiddenSnippets) {
    assert.ok(!html.includes(snippet), `Forbidden legal wording found: "${snippet}"`);
  }

  const pp616Start = html.indexOf('для промышленных товаров применяются защитные меры национального режима');
  assert.ok(pp616Start !== -1, 'Industrial goods 44-ФЗ section not found');
  const pp616Window = html.slice(pp616Start, pp616Start + 500);
  assert.ok(
    /ПП РФ № 1875/i.test(pp616Window),
    'Industrial goods section must reference PP 1875'
  );

  const pp878Start = html.indexOf('2.5. Национальный режим (ст. 14 44-ФЗ, ПП РФ № 1875)');
  assert.ok(pp878Start !== -1, 'PP878 44-ФЗ section not found');
  const pp878Window = html.slice(pp878Start, pp878Start + 1200);
  assert.ok(
    /(защитных мер|меры национального режима)/i.test(pp878Window),
    '44-ФЗ radioelectronics section must contain national-regime measure wording'
  );
}

function main() {
  runAutoDetectChecks();
  runDictionaryConsistencyChecks();
  runLaw1875PolicyChecks();
  runLegalTextChecks();
  console.log('Deep checks passed: autodetect, catalog consistency, legal text.');
}

main();
