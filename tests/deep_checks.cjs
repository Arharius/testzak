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
      cableTester: { name: 'Тестер кабеля / LAN-тестер / тестер телефонного кабеля' },
      rj45Connector: { name: 'Коннектор RJ-45 / штекер 8P8C' },
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
    ['тестер телефонного кабеля', 'cableTester'],
    ['RJ45', 'rj45Connector'],
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

function runInternetAndZakupkiHelperChecks() {
  const block = extractBetween(
    html,
    'function looksLikeUrl(value) {',
    'function hideRowSuggestions(rowId) {'
  );

  const context = {
    GOODS_CATALOG: {
      mouse: { name: 'Мышь компьютерная' },
      webcam: { name: 'Веб-камера' },
      keyboard: { name: 'Клавиатура' },
    },
    normalizeDetectText(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[-_/.,+()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    },
    inferTypeByStrongKeywords(value) {
      const normalized = String(value || '').toLowerCase();
      if (/мыш|mouse/.test(normalized)) return 'mouse';
      if (/веб камера|webcam|камера/.test(normalized)) return 'webcam';
      if (/клавиатур|keyboard/.test(normalized)) return 'keyboard';
      return '';
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${block}
this.pickRelevantHintParts = pickRelevantHintParts;
this.parseZakupkiLinksFromProxyText = parseZakupkiLinksFromProxyText;
this.buildZakupkiSearchUrl = buildZakupkiSearchUrl;
this.buildZakupkiEisSearchUrl = buildZakupkiEisSearchUrl;
this.buildZakupkiYandexSearchVariants = buildZakupkiYandexSearchVariants;
this.buildContextualRowSearchQuery = buildContextualRowSearchQuery;`,
    context
  );

  const noisy = context.pickRelevantHintParts('Xerox B210', [
    'Mars rover geology mission and astronomy encyclopedia',
    'Planet science and space exploration',
  ]);
  assert.strictEqual(noisy, '', 'Noisy unrelated hints should be filtered');

  const relevant = context.pickRelevantHintParts('Xerox B210', [
    'Xerox B210 laser printer for office monochrome printing',
  ]);
  assert.ok(/xerox/i.test(relevant) && /b210/i.test(relevant), 'Relevant product hints must be preserved');

  const parsed = context.parseZakupkiLinksFromProxyText(
    [
      '[Извещение на поставку ноутбуков](https://zakupki.gov.ru/epz/order/notice/ea44/view/common-info.html?regNumber=1)',
      '[Документация закупки](https://zakupki.gov.ru/epz/order/notice/ea44/view/documents.html?regNumber=1)',
      'https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString=%D0%BD%D0%BE%D1%83%D1%82',
    ].join('\n'),
    'ноутбук'
  );
  assert.ok(Array.isArray(parsed) && parsed.length >= 2, 'Expected parsed zakupki links');
  assert.ok(
    parsed.some((x) => /\/epz\/order\/notice\//i.test(x.url)),
    'Parsed links should include notice/document pages'
  );

  const yandexUrl = context.buildZakupkiSearchUrl('ноутбук');
  assert.ok(/yandex\.ru\/search\/\?text=/i.test(yandexUrl), 'Expected Yandex search URL');
  assert.ok(decodeURIComponent(yandexUrl).includes('site:zakupki.gov.ru'), 'Yandex search must target zakupki.gov.ru');
  assert.ok(decodeURIComponent(yandexUrl).includes('техническое задание'), 'Yandex search URL should include TZ keyword');

  const eisUrl = context.buildZakupkiEisSearchUrl('ноутбук');
  assert.ok(/zakupki\.gov\.ru\/epz\/order\/extendedsearch\/results\.html/i.test(eisUrl), 'Expected direct EIS search URL');

  const variants = context.buildZakupkiYandexSearchVariants('ноутбук');
  assert.ok(Array.isArray(variants) && variants.length >= 2, 'Expected multiple Yandex search variants');
  assert.ok(variants.every((v) => /yandex\.ru\/search/i.test(v.url)), 'All variants must point to Yandex search');

  const brandOnlyMouseQuery = context.buildContextualRowSearchQuery('mouse', 'logitech');
  assert.ok(/мыш/i.test(brandOnlyMouseQuery), 'Contextual query must include selected goods type for brand-only model');
  assert.ok(/logitech/i.test(brandOnlyMouseQuery), 'Contextual query must preserve original model/brand token');

  const alreadyTypedQuery = context.buildContextualRowSearchQuery('webcam', 'веб-камера logitech brio');
  assert.strictEqual(alreadyTypedQuery, 'веб-камера logitech brio', 'Contextual query must not duplicate type words when they are already present');
}

function runTemplateTableRendererChecks() {
  const block = extractBetween(
    html,
    'function buildSpecTableHTML(specs) {',
    '// =====================\n//  ОСНОВНОЙ РЕНДЕР ВСЕХ РЕЗУЛЬТАТОВ'
  );

  const context = {
    GOODS_CATALOG: {
      pc: { name: 'Системный блок' },
      os: { name: 'ОС', isSoftware: true },
    },
    goodsItems: [],
    currentTzRenderMode: 'template',
    normalizeDetectText(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[-_/.,+()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    },
    escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },
    getSafeSpecValue(spec) {
      const value = String(spec?.value || '').trim();
      return value || 'В соответствии с технической документацией производителя и требованиями Заказчика';
    },
    document: {
      getElementById() { return null; },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${block}
this.inferSpecRequirementKind = inferSpecRequirementKind;
this.inferSpecConfirmationHint = inferSpecConfirmationHint;
this.buildSpecTemplateTableHTML = buildSpecTemplateTableHTML;`,
    context
  );

  assert.strictEqual(
    context.inferSpecRequirementKind({ name: 'Объем ОЗУ', value: 'не менее 16', unit: 'ГБ' }),
    'Минимум',
    'Expected "не менее" to map to minimum requirement kind'
  );

  const htmlOut = context.buildSpecTemplateTableHTML([
    { group: 'ОЗУ', name: 'Объем ОЗУ', value: 'не менее 16', unit: 'ГБ' },
    { group: 'Совместимость', name: 'Совместимость с Astra Linux', value: 'Наличие', unit: '' },
  ], 'pc');
  assert.ok(/Тип требования/.test(htmlOut), 'Template table must contain "Тип требования" column');
  assert.ok(/Подтверждение/.test(htmlOut), 'Template table must contain "Подтверждение" column');
  assert.ok(/data-spec-field="value"/.test(htmlOut), 'Template table must preserve editable value cells');
  assert.ok(/data-spec-field="unit"/.test(htmlOut), 'Template table must preserve editable unit cells');
}

function runHardMinorTemplateChecks() {
  const block = extractBetween(
    html,
    'const TRADEMARK_TOKENS = [',
    '// =====================\n//  РЕНДЕР ТАБЛИЦЫ'
  );

  const context = {
    GOODS_CATALOG: {
      dvd: { name: 'Оптический диск (CD/DVD/BD)' },
      patchCord: { name: 'Патч-корд (кабель витая пара)' },
      speakers: { name: 'Колонки / акустическая система' },
      opticalDrive: { name: 'Внешний оптический привод (CD/DVD/BD)' },
      keyboard: { name: 'Клавиатура' },
      mouse: { name: 'Мышь компьютерная' },
      keyboardMouseSet: { name: 'Комплект клавиатура + мышь' },
      laptop: { name: 'Ноутбук' },
      pc: { name: 'Системный блок' },
      switch: { name: 'Коммутатор' },
      printer: { name: 'Принтер' },
      extSsd: { name: 'Внешний SSD' },
      monitor: { name: 'Монитор' },
      motherboard: { name: 'Материнская плата' },
      cableTester: { name: 'Тестер кабеля / LAN-тестер' },
      toolSet: { name: 'Набор инструментов' },
      rj45Connector: { name: 'Коннектор RJ-45 / штекер 8P8C' },
      os: { name: 'Операционная система', isSoftware: true },
      email: { name: 'Почтовый сервер / корпоративная почта', isSoftware: true },
      miscHardware: { name: 'Прочий ИТ-товар / оборудование (универсальная позиция)' },
    },
    automationSettings: { hardTemplateMinorGoods: true },
    normalizeDetectText(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[-_/.,+()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    },
    scoreSpecNameSimilarity(leftName, rightName) {
      const left = String(leftName || '').toLowerCase().trim();
      const right = String(rightName || '').toLowerCase().trim();
      if (!left || !right) return 0;
      if (left === right) return 1;
      if (left.includes(right) || right.includes(left)) return 0.9;
      return 0;
    },
    areSpecValuesComparable(leftSpec, rightSpec) {
      const left = String(leftSpec?.value || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const right = String(rightSpec?.value || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (!left || !right) return false;
      if (left === right || left.includes(right) || right.includes(left)) return true;
      const leftNums = left.match(/\d+(?:[.,]\d+)?/g) || [];
      const rightNums = right.match(/\d+(?:[.,]\d+)?/g) || [];
      return leftNums.length > 0 && leftNums.join('|') === rightNums.join('|');
    },
    isAmbiguousBrandOnlyQuery(value) {
      const key = String(value || '').toLowerCase().trim();
      return ['logitech', 'asus', 'sven'].includes(key);
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${block}
this.isHardTemplateMinorType = isHardTemplateMinorType;
this.buildHardTemplateMinorSpecs = buildHardTemplateMinorSpecs;
this.buildDeterministicFallbackSpecs = buildDeterministicFallbackSpecs;
this.getRenderableSpecsForItem = getRenderableSpecsForItem;`,
    context
  );

  assert.strictEqual(context.isHardTemplateMinorType('dvd'), true, 'dvd must be hard-template minor type');
  assert.strictEqual(context.isHardTemplateMinorType('laptop'), false, 'laptop must not be hard-template minor type');

  const dvdSpecs = context.buildHardTemplateMinorSpecs('dvd', 'DVD-R Verbatim 4.7GB', 20);
  assert.ok(Array.isArray(dvdSpecs) && dvdSpecs.length >= 5, 'DVD hard template should produce multiple rows');
  assert.ok(
    dvdSpecs.some((x) => /Тип оптического носителя/i.test(x.name || '')),
    'DVD hard template must include optical disc type row'
  );
  const dvdCapacity = dvdSpecs.find((x) => /Емкость носителя/i.test(x.name || ''));
  assert.ok(dvdCapacity, 'DVD hard template must include capacity row');
  assert.ok(/4,7/.test(String(dvdCapacity.value || '')), 'DVD capacity row should infer 4.7 GB from model');

  const cableSpecs = context.buildHardTemplateMinorSpecs('patchCord', 'Патч-корд UTP Cat6 2 м', 5);
  const catRow = cableSpecs.find((x) => /Категория кабеля/i.test(x.name || ''));
  assert.ok(catRow && /Cat6/i.test(String(catRow.value || '')), 'Patch cord hard template should infer Cat6');
  const lenRow = cableSpecs.find((x) => /Длина кабеля/i.test(x.name || ''));
  assert.ok(lenRow && /2/.test(String(lenRow.value || '')), 'Patch cord hard template should infer cable length');

  const speakerSpecs = context.buildHardTemplateMinorSpecs('speakers', 'SVEN SPS-702 12 Вт', 3);
  assert.ok(Array.isArray(speakerSpecs) && speakerSpecs.length >= 8, 'Speakers fallback must produce extended professional rows');
  assert.ok(
    speakerSpecs.some((x) => /Конфигурация акустических каналов/i.test(String(x.name || ''))),
    'Speakers fallback must include channel configuration'
  );
  assert.ok(
    speakerSpecs.some((x) => /Регулировка громкости/i.test(String(x.name || ''))),
    'Speakers fallback must include volume control requirement'
  );
  assert.ok(
    !speakerSpecs.some((x) => /\bуказать\b/i.test(String(x.value || ''))),
    'Speakers deterministic specs must not contain placeholder "Указать"'
  );

  const driveSpecs = context.buildHardTemplateMinorSpecs('opticalDrive', 'ASUS DVD-RW SDRW-08U9M-U', 2);
  assert.ok(
    driveSpecs.some((x) => /Интерфейс подключения/i.test(String(x.name || '')) && /USB/i.test(String(x.value || ''))),
    'Optical drive fallback must include USB interface requirement'
  );
  assert.ok(
    driveSpecs.some((x) => /Скорость чтения CD/i.test(String(x.name || ''))),
    'Optical drive fallback must include CD read speed requirement'
  );
  assert.ok(
    driveSpecs.some((x) => /Скорость чтения DVD/i.test(String(x.name || ''))),
    'Optical drive fallback must include DVD read speed requirement'
  );
  assert.ok(
    !driveSpecs.some((x) => /\bуказать\b/i.test(String(x.value || ''))),
    'Optical drive deterministic specs must not contain placeholder "Указать"'
  );

  const keyboardSpecs = context.buildHardTemplateMinorSpecs('keyboard', 'Logitech K120', 5);
  assert.ok(
    keyboardSpecs.some((x) => /Раскладка/i.test(String(x.name || ''))),
    'Keyboard deterministic template must include layout requirement'
  );
  assert.ok(
    keyboardSpecs.some((x) => /Количество клавиш/i.test(String(x.name || '')) && /104/.test(String(x.value || ''))),
    'Keyboard deterministic template must include key count requirement'
  );
  assert.ok(
    !keyboardSpecs.some((x) => /\bуказать\b/i.test(String(x.value || ''))),
    'Keyboard deterministic template must not contain placeholder "Указать"'
  );

  const mouseSpecs = context.buildHardTemplateMinorSpecs('mouse', 'Logitech B100', 5);
  assert.ok(
    mouseSpecs.some((x) => /Разрешение сенсора/i.test(String(x.name || ''))),
    'Mouse deterministic template must include DPI requirement'
  );
  assert.ok(
    !mouseSpecs.some((x) => /\bуказать\b/i.test(String(x.value || ''))),
    'Mouse deterministic template must not contain placeholder "Указать"'
  );
  const wiredMouseSpecs = context.buildHardTemplateMinorSpecs('mouse', 'мышь проводная usb', 2);
  const wiredMouseConn = wiredMouseSpecs.find((x) => /Тип подключения/i.test(String(x.name || '')));
  assert.ok(wiredMouseConn && /Проводное USB/i.test(String(wiredMouseConn.value || '')), 'Wired mouse should require wired USB connection');

  const wirelessMouseSpecs = context.buildHardTemplateMinorSpecs('mouse', 'мышь беспроводная bluetooth 2.4', 2);
  const wirelessMouseConn = wirelessMouseSpecs.find((x) => /Тип подключения/i.test(String(x.name || '')));
  assert.ok(wirelessMouseConn && /Беспроводное/i.test(String(wirelessMouseConn.value || '')), 'Wireless mouse should require wireless connection');
  assert.ok(
    wirelessMouseConn && !/Проводное USB и\/или беспроводное/i.test(String(wirelessMouseConn.value || '')),
    'Wireless mouse should not fallback to ambiguous wired/wireless wording when wireless is explicit'
  );

  const wirelessKeyboardSpecs = context.buildHardTemplateMinorSpecs('keyboard', 'клавиатура беспроводная bluetooth', 2);
  const wirelessKeyboardConn = wirelessKeyboardSpecs.find((x) => /Тип подключения/i.test(String(x.name || '')));
  assert.ok(wirelessKeyboardConn && /Беспроводное/i.test(String(wirelessKeyboardConn.value || '')), 'Wireless keyboard should require wireless connection');
  assert.ok(
    wirelessKeyboardSpecs.some((x) => /Ресурс клавиш/i.test(String(x.name || ''))),
    'Keyboard deterministic template must include key lifetime requirement'
  );

  const wiredSetSpecs = context.buildHardTemplateMinorSpecs('keyboardMouseSet', 'комплект клавиатура мышь проводной usb', 2);
  const wiredSetConn = wiredSetSpecs.find((x) => /Тип подключения/i.test(String(x.name || '')));
  assert.ok(wiredSetConn && /Проводное USB/i.test(String(wiredSetConn.value || '')), 'Wired keyboard/mouse set should require wired USB connection');
  assert.ok(
    wiredSetSpecs.some((x) => /Разрешение сенсора мыши/i.test(String(x.name || '')) && /1000/.test(String(x.value || ''))),
    'Keyboard/mouse set fallback must include mouse DPI requirement'
  );
  assert.ok(
    wiredSetSpecs.some((x) => /Тип клавишного механизма/i.test(String(x.name || ''))),
    'Keyboard/mouse set fallback must include keyboard mechanism requirement'
  );
  const setDescriptionRow = wiredSetSpecs.find((x) => /Описание \/ модель \/ артикул/i.test(String(x.name || '')));
  assert.ok(
    setDescriptionRow && /Без указания товарного знака/i.test(String(setDescriptionRow.value || '')),
    'Keyboard/mouse set description row must not leak exact model'
  );

  const wirelessSetSpecs = context.buildHardTemplateMinorSpecs('keyboardMouseSet', 'logitech mk240 nano', 2);
  const wirelessSetConn = wirelessSetSpecs.find((x) => /Тип подключения/i.test(String(x.name || '')));
  assert.ok(
    wirelessSetConn && /Беспроводное/i.test(String(wirelessSetConn.value || '')),
    'Keyboard/mouse set with nano receiver must require wireless connection'
  );
  assert.ok(
    wirelessSetSpecs.some((x) => /Беспроводной при[её]мник/i.test(String(x.name || ''))),
    'Wireless keyboard/mouse set must mention USB receiver'
  );

  const dedupedSetSpecs = context.buildDeterministicFallbackSpecs(
    'keyboardMouseSet',
    'logitech mk120',
    2,
    'Тип подключения: Проводное USB или эквивалент\nКоличество клавиш клавиатуры: не менее 104 шт.\nРазрешение сенсора мыши: не менее 1000 dpi',
    [
      { group: 'Поставка', name: 'Тип подключения', value: 'Проводное USB или эквивалент', unit: '' },
      { group: 'Основные характеристики', name: 'Количество клавиш клавиатуры', value: 'не менее 104', unit: 'шт.' },
      { group: 'Основные характеристики', name: 'Разрешение сенсора мыши', value: 'не менее 1000', unit: 'dpi' },
    ]
  );
  assert.strictEqual(
    dedupedSetSpecs.filter((x) => /Тип подключения/i.test(String(x.name || ''))).length,
    1,
    'Deterministic fallback must dedupe repeated connection rows for keyboard/mouse set'
  );
  assert.strictEqual(
    dedupedSetSpecs.filter((x) => /Количество клавиш клавиатуры/i.test(String(x.name || ''))).length,
    1,
    'Deterministic fallback must dedupe repeated keyboard key-count rows'
  );
  assert.strictEqual(
    dedupedSetSpecs.filter((x) => /Разрешение сенсора мыши/i.test(String(x.name || ''))).length,
    1,
    'Deterministic fallback must dedupe repeated mouse DPI rows'
  );
  const mouseDesc = mouseSpecs.find((x) => /Описание \/ модель \/ артикул/i.test(String(x.name || '')));
  assert.ok(mouseDesc, 'Mouse deterministic template must include model description row');
  assert.ok(
    !/\blogitech\b/i.test(String(mouseDesc.value || '')),
    'Model description row must not contain trademark token'
  );
  assert.ok(
    String(mouseDesc.value || '').trim().length > 0,
    'Model description row must remain non-empty after trademark sanitization'
  );

  const hintSpecs = context.buildDeterministicFallbackSpecs(
    'speakers',
    'SVEN SPS-702',
    4,
    'Мощность: не менее 12 Вт; Интерфейс: Bluetooth 5.0 и AUX 3.5 мм'
  );
  assert.ok(
    hintSpecs.some((x) => /Мощност/i.test(String(x.name || '')) && /12/.test(String(x.value || ''))),
    'Deterministic fallback must reuse numeric requirements from hints'
  );

  const pcFallback = context.buildDeterministicFallbackSpecs('pc', 'Офисный системный блок', 3, '');
  assert.ok(pcFallback.length >= 8, 'PC deterministic fallback should provide detailed rows');
  assert.ok(
    pcFallback.some((x) => /Процессор/i.test(String(x.name || ''))),
    'PC deterministic fallback must include processor row'
  );

  const emailFallback = context.buildDeterministicFallbackSpecs('email', 'RuPost', 120, '');
  assert.ok(emailFallback.length >= 8, 'Software deterministic fallback should provide detailed rows');
  assert.ok(
    emailFallback.some((x) => /Количество лицензий/i.test(String(x.name || ''))),
    'Software deterministic fallback must include license quantity row'
  );

  const astraFallback = context.buildDeterministicFallbackSpecs('os', 'Astra Linux Special Edition 1.8 Воронеж', 30, '');
  assert.ok(astraFallback.length >= 10, 'Astra deterministic fallback should provide detailed rows');
  assert.ok(
    astraFallback.some((x) => /Редакция \/ исполнение/i.test(String(x.name || '')) && /Воронеж/i.test(String(x.value || ''))),
    'Astra deterministic fallback must preserve specific edition label'
  );
  assert.ok(
    astraFallback.some((x) => /Версия \/ релиз/i.test(String(x.name || '')) && /1\.8/.test(String(x.value || ''))),
    'Astra deterministic fallback must preserve version from model'
  );
  assert.ok(
    astraFallback.some((x) => /Тип лицензии/i.test(String(x.name || ''))),
    'Astra deterministic fallback must include license type row'
  );
  assert.ok(
    astraFallback.some((x) => /Состав поставки/i.test(String(x.name || ''))),
    'Astra deterministic fallback must include delivery/components row'
  );

  const miscFallback = context.buildDeterministicFallbackSpecs('miscHardware', 'Неизвестное устройство', 2, '');
  assert.ok(miscFallback.length >= 7, 'Universal hardware fallback should provide detailed rows');
  assert.ok(
    miscFallback.some((x) => /Совместимость/i.test(String(x.name || ''))),
    'Universal hardware fallback must include compatibility row'
  );

  const switchFallback = context.buildDeterministicFallbackSpecs('switch', 'Коммутатор 24x1G SFP', 2, '');
  assert.ok(switchFallback.length >= 9, 'Network deterministic fallback should provide extended rows');
  assert.ok(
    switchFallback.some((x) => /Типы интерфейсов/i.test(String(x.name || ''))),
    'Network deterministic fallback must include interface types row'
  );
  assert.ok(
    switchFallback.some((x) => /Поддерживаемые стандарты и протоколы/i.test(String(x.name || ''))),
    'Network deterministic fallback must include standards/protocols row'
  );

  const printerFallback = context.buildDeterministicFallbackSpecs('printer', 'Лазерный принтер A4', 2, '');
  assert.ok(printerFallback.length >= 8, 'Print deterministic fallback should provide extended rows');
  assert.ok(
    printerFallback.some((x) => /Технология печати/i.test(String(x.name || ''))),
    'Print deterministic fallback must include print technology row'
  );
  assert.ok(
    printerFallback.some((x) => /Тип расходных материалов/i.test(String(x.name || ''))),
    'Print deterministic fallback must include consumables row'
  );

  const storageFallback = context.buildDeterministicFallbackSpecs('extSsd', 'Portable SSD 1TB USB-C', 2, '');
  assert.ok(storageFallback.length >= 8, 'Storage deterministic fallback should provide extended rows');
  assert.ok(
    storageFallback.some((x) => /Форм-фактор/i.test(String(x.name || ''))),
    'Storage deterministic fallback must include form factor row'
  );
  assert.ok(
    storageFallback.some((x) => /Скорость чтения \/ записи|Частота \/ поколение памяти/i.test(String(x.name || ''))),
    'Storage deterministic fallback must include performance row'
  );

  const monitorFallback = context.buildDeterministicFallbackSpecs('monitor', 'Монитор 27', 2, '');
  assert.ok(monitorFallback.length >= 8, 'Peripheral deterministic fallback should provide extended rows');
  assert.ok(
    monitorFallback.some((x) => /Способ установки \/ крепления/i.test(String(x.name || ''))),
    'Peripheral deterministic fallback must include mounting row'
  );
  assert.ok(
    monitorFallback.some((x) => /Параметры питания/i.test(String(x.name || ''))),
    'Peripheral deterministic fallback must include power row'
  );

  const componentFallback = context.buildDeterministicFallbackSpecs('motherboard', 'ATX motherboard', 2, '');
  assert.ok(componentFallback.length >= 8, 'Component deterministic fallback should provide extended rows');
  assert.ok(
    componentFallback.some((x) => /Форм-фактор \/ исполнение/i.test(String(x.name || ''))),
    'Component deterministic fallback must include form factor row'
  );
  assert.ok(
    componentFallback.some((x) => /Требования к питанию и охлаждению/i.test(String(x.name || ''))),
    'Component deterministic fallback must include power/cooling row'
  );

  const webcamSpecs = context.buildHardTemplateMinorSpecs('webcam', 'Logitech', 3);
  assert.ok(
    webcamSpecs.some((x) => /Поддержка UVC/i.test(String(x.name || ''))),
    'Webcam fallback must include UVC / Plug-and-Play requirement'
  );
  assert.ok(
    webcamSpecs.some((x) => /Длина встроенного кабеля/i.test(String(x.name || ''))),
    'Webcam fallback must include cable length requirement'
  );
  assert.ok(
    webcamSpecs.some((x) => /Способ крепления/i.test(String(x.name || ''))),
    'Webcam fallback must include mounting requirement'
  );

  const cableTesterSpecs = context.buildHardTemplateMinorSpecs('cableTester', 'LAN tester RJ45 RJ11 BNC', 1);
  assert.ok(
    cableTesterSpecs.some((x) => /Тестируемые типы кабелей/i.test(String(x.name || '')) && /коаксиальн/i.test(String(x.value || ''))),
    'Cable tester deterministic template must include tested cable types'
  );
  assert.ok(
    cableTesterSpecs.some((x) => /Тестируемые разъемы/i.test(String(x.name || '')) && /BNC/i.test(String(x.value || ''))),
    'Cable tester deterministic template must include connector coverage'
  );
  assert.ok(
    cableTesterSpecs.some((x) => /Функции тестирования/i.test(String(x.name || '')) && /Обрыв/i.test(String(x.value || ''))),
    'Cable tester deterministic template must include test functions'
  );
  assert.ok(
    cableTesterSpecs.some((x) => /Удаленный модуль/i.test(String(x.name || ''))),
    'Cable tester deterministic template must include remote module requirement'
  );
  assert.ok(
    cableTesterSpecs.some((x) => /Количество батарей/i.test(String(x.name || '')) && /2/.test(String(x.value || ''))),
    'Cable tester deterministic template must include battery count requirement'
  );

  const toolSetSpecs = context.buildHardTemplateMinorSpecs('toolSet', 'Lanmaster LAN-NT-TK/COAX', 1);
  assert.ok(
    toolSetSpecs.some((x) => /Комплектность набора/i.test(String(x.name || '')) && /LAN тестер/i.test(String(x.value || ''))),
    'Tool set deterministic template must include full set composition'
  );
  assert.ok(
    toolSetSpecs.some((x) => /Регулировка глубины среза/i.test(String(x.name || ''))),
    'Tool set deterministic template must include stripper adjustment requirement'
  );
  assert.ok(
    toolSetSpecs.some((x) => /Обжимаемые разъемы/i.test(String(x.name || '')) && /8P8C/i.test(String(x.value || ''))),
    'Tool set deterministic template must include crimper connector support'
  );
  assert.ok(
    toolSetSpecs.some((x) => /Материал рабочих частей/i.test(String(x.name || '')) && /сталь/i.test(String(x.value || ''))),
    'Tool set deterministic template must include tool material requirement'
  );
  assert.ok(
    toolSetSpecs.some((x) => /Рабочая температура/i.test(String(x.name || '')) && /-10/.test(String(x.value || ''))),
    'Tool set deterministic template must include operating temperature requirement'
  );

  const rj45Specs = context.buildHardTemplateMinorSpecs('rj45Connector', 'RJ45 cat6 utp', 1000);
  assert.ok(
    rj45Specs.some((x) => /Тип разъёма/i.test(String(x.name || '')) && /8P8C/i.test(String(x.value || ''))),
    'RJ45 connector deterministic template must include connector type'
  );
  assert.ok(
    rj45Specs.some((x) => /Тип монтажа \/ обжима/i.test(String(x.name || '')) && /обжим/i.test(String(x.value || ''))),
    'RJ45 connector deterministic template must include crimping requirement'
  );
  assert.ok(
    rj45Specs.some((x) => /Категория СКС/i.test(String(x.name || '')) && /Cat6/i.test(String(x.value || ''))),
    'RJ45 connector deterministic template must infer cable category from model'
  );
  assert.ok(
    !rj45Specs.some((x) => /\bуказать\b/i.test(String(x.value || ''))),
    'RJ45 connector deterministic template must not contain placeholder "Указать"'
  );

  const item = { type: 'dvd', model: 'DVD-R Verbatim 4.7GB', qty: 10, specs: [{ group: 'AI', name: 'foo', value: 'bar', unit: '' }] };
  const templateRenderSpecs = context.getRenderableSpecsForItem(item, 'template');
  assert.ok(Array.isArray(templateRenderSpecs) && templateRenderSpecs.length > 1, 'Template mode should return hard-template specs for dvd');
  const classicRenderSpecs = context.getRenderableSpecsForItem(item, 'classic');
  assert.strictEqual(classicRenderSpecs.length, 1, 'Classic mode must keep original AI specs');
}

function runDocumentStructureChecks() {
  const renderBlock = extractBetween(
    html,
    'function renderAllResults() {',
    '// =====================\n//  DEMO ДАННЫЕ'
  );

  const htmlSections = [
    '1. Наименование, Заказчик, Исполнитель, сроки и адрес поставки',
    '2. Требования к поставке Товара',
    '3. Функциональные, технические и качественные характеристики товара',
    '4. Иные требования к товару и документации',
    '5. Требования к гарантии',
    '6. Место, сроки и условия поставки товара',
  ];

  let prev = -1;
  for (let i = 0; i < htmlSections.length; i += 1) {
    const title = htmlSections[i];
    let idx = renderBlock.indexOf(title);
    if (i === 1 && idx === -1) {
      // Для раздела 2 допустима множественная форма.
      idx = renderBlock.indexOf('2. Требования к поставке Товаров');
    }
    assert.ok(idx !== -1, `Section heading not found in legacy render: "${title}"`);
    assert.ok(idx > prev, `Section heading order is broken near "${title}"`);
    prev = idx;
  }

  // Разделы 5/6 обязаны иметь отдельные таблицы.
  assert.ok(renderBlock.includes('id="tz-guarantee-table"'), 'HTML must include #tz-guarantee-table');
  assert.ok(renderBlock.includes('id="tz-delivery-table"'), 'HTML must include #tz-delivery-table');
  assert.ok(
    html.includes("buildDocxRowsFromDOM('#tz-guarantee-table')"),
    'DOCX export must read guarantee table from #tz-guarantee-table'
  );
  assert.ok(
    html.includes("buildDocxRowsFromDOM('#tz-delivery-table')"),
    'DOCX export must read delivery table from #tz-delivery-table'
  );

  // Регрессия: для мультипозиционного ТЗ приложения должны использоваться
  // только в разделе 3 (характеристики), а разделы 2/4/5/6 должны быть едиными.
  assert.ok(
    /const sec2Body = buildReqTableHTML\(firstType, firstItem\.meta\);/.test(renderBlock),
    'Section 2 must be rendered as a unified table for multi-position TZ'
  );
  assert.ok(
    /const sec4Body = buildOtherTableHTML\(firstType\);/.test(renderBlock),
    'Section 4 must be rendered as a unified table for multi-position TZ'
  );
  assert.ok(
    /const sec5Body = buildGuaranteeTableHTML\(firstType\);/.test(renderBlock),
    'Section 5 must be rendered as a unified table for multi-position TZ'
  );
  assert.ok(
    /const sec6Body = buildSupplyTableHTML\(firstType\);/.test(renderBlock),
    'Section 6 must be rendered as a unified table for multi-position TZ'
  );

  // Внутри DOCX-таблиц у ячеек не должно быть абзацных отступов after>0.
  const cellParagraphHasZeroAfter = /par\(content,\s*\{[^}]*after:\s*0/i.test(html);
  assert.ok(cellParagraphHasZeroAfter, 'DOCX table cells must render paragraphs with after: 0');
}

function runClassicDocumentStyleChecks() {
  assert.ok(
    /\.spec-table th\s*\{[\s\S]*background:\s*#fff;[\s\S]*color:\s*#111111;/m.test(html),
    'Classic document style must use white specification table headers with dark text'
  );
  assert.ok(
    /\.group-header td\s*\{[\s\S]*background:\s*#fff !important;[\s\S]*border-top:\s*1\.5px solid #111111;/m.test(html),
    'Classic document style must render group headers without colored fills'
  );
  assert.ok(
    /@media print\s*\{[\s\S]*\.spec-table th \{ background: #fff !important; color: #111111 !important;/m.test(html),
    'Print/PDF mode must keep specification table headers monochrome'
  );

  const specBlock = extractBetween(
    html,
    'function buildSpecTableHTML(specs) {',
    'function inferSpecRequirementKind(spec) {'
  );
  const templateBlock = extractBetween(
    html,
    'function buildSpecTemplateTableHTML(specs, goodsType) {',
    'function buildTzModeBannerHTML(mode, doneItems) {'
  );
  const renderBlock = extractBetween(
    html,
    'function renderAllResults() {',
    '// =====================\n//  DEMO ДАННЫЕ'
  );
  const docxBlock = extractBetween(
    html,
    '    function txt(text, opts = {}) {',
    '    const subtitle = document.getElementById(\'tz-subtitle\')?.textContent || \'на поставку товара\';'
  );

  for (const block of [specBlock, templateBlock, renderBlock, docxBlock]) {
    assert.ok(!block.includes('background:#0f4e79'), 'Document rendering must not use blue filled header rows');
    assert.ok(!block.includes('background:#eef7ff'), 'Document rendering must not use blue-tinted appendix rows');
    assert.ok(!block.includes('color:#1a1a2e'), 'Document rendering must not use decorative dark-blue heading color');
    assert.ok(!block.includes('color:#92400e'), 'Document rendering must not use amber emphasis text inside the generated TZ');
  }

  for (const legacyFill of ["bg: '4338CA'", "bg: 'EEF2FF'", "bg: 'C7D2FE'", "bg: 'EEF6FF'"]) {
    assert.ok(!html.includes(legacyFill), `DOCX generator must not use legacy colored fill ${legacyFill}`);
  }
  assert.ok(!docxBlock.includes('const isDark = bg &&'), 'DOCX cell helper must not depend on dark fill detection for classic styling');
}

function runEisComparisonHelperChecks() {
  const block = extractBetween(
    html,
    'function guessSourceSpecGroup(name, goodsType = \'\') {',
    'function renderRowSpecDraft(rowId) {'
  );

  const context = {
    GOODS_CATALOG: {
      os: { name: 'Операционная система', isSoftware: true },
      mouse: { name: 'Мышь компьютерная' },
    },
    normalizeDetectText(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[-_/.,+()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    },
    makeHardTemplateRow(group, name, value, unit = '') {
      return { group, name, value, unit };
    },
    cutText(text, maxLen) {
      const src = String(text || '');
      if (src.length <= maxLen) return src;
      return src.slice(0, Math.max(0, maxLen - 1)) + '…';
    },
    escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${block}
this.normalizeSourceSpecCollection = normalizeSourceSpecCollection;
this.buildDraftSourceComparison = buildDraftSourceComparison;
this.renderDraftSourceComparisonHtml = renderDraftSourceComparisonHtml;`,
    context
  );

  const normalized = context.normalizeSourceSpecCollection([
    { name: 'Тип лицензии', value: 'Бессрочная лицензия', unit: '' },
    { name: 'Версия / релиз', value: '1.8', unit: '' },
  ], 'os');
  assert.ok(
    normalized.some((row) => row.group === 'Лицензирование' && /Тип лицензии/i.test(row.name)),
    'Source spec normalization must map license rows into software licensing group'
  );

  const comparison = context.buildDraftSourceComparison(
    [
      { name: 'Версия / релиз', value: '1.8', unit: '' },
      { name: 'Тип лицензии', value: 'Бессрочная лицензия', unit: '' },
      { name: 'Состав поставки', value: 'Дистрибутив и документация', unit: '' },
    ],
    [
      { group: 'Общие сведения', name: 'Версия / релиз', value: '1.8', unit: '' },
      { group: 'Лицензирование', name: 'Тип лицензии / права использования', value: 'Подписка 12 месяцев', unit: '' },
      { group: 'Поддержка', name: 'Техподдержка', value: '12 месяцев', unit: '' },
    ]
  );
  assert.strictEqual(comparison.matched.length, 1, 'Comparison must detect exact preserved spec');
  assert.strictEqual(comparison.changed.length, 1, 'Comparison must detect changed value for same source characteristic');
  assert.strictEqual(comparison.onlySource.length, 1, 'Comparison must keep source-only characteristics that were not transferred');
  assert.strictEqual(comparison.onlyDraft.length, 1, 'Comparison must detect characteristics added only to our draft');

  const comparisonHtml = context.renderDraftSourceComparisonHtml({
    type: 'os',
    specs: [
      { group: 'Общие сведения', name: 'Версия / релиз', value: '1.8', unit: '' },
      { group: 'Лицензирование', name: 'Тип лицензии / права использования', value: 'Подписка 12 месяцев', unit: '' },
    ],
    sourceSpecs: [
      { name: 'Версия / релиз', value: '1.8', unit: '' },
      { name: 'Тип лицензии', value: 'Бессрочная лицензия', unit: '' },
    ],
    sourceCompareLabel: 'ЕИС / КТРУ / площадки',
    sourceContextText: 'Источник 1: ЕИС. Документ: Astra Linux.'
  }, true);
  assert.ok(/Сравнение с ЕИС \/ КТРУ \/ площадки/.test(comparisonHtml), 'Comparison UI must mention EIS source label');
  assert.ok(/Изменено:/.test(comparisonHtml), 'Comparison UI must render changed source specs');
}

function runDeterministicHintSanitizationChecks() {
  const block = extractBetween(
    html,
    'function extractDeterministicSpecsFromHintText(hintsText, maxItems = 8) {',
    'function detectSoftwareVersionLabel(model) {'
  );

  const context = {
    normalizeDetectText(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[-_/.,+()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    },
    makeHardTemplateRow(group, name, value, unit = '') {
      return { group, name, value, unit };
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${block}
this.extractDeterministicSpecsFromHintText = extractDeterministicSpecsFromHintText;
this.buildDeterministicHintsCorpus = buildDeterministicHintsCorpus;`,
    context
  );

  const corpus = context.buildDeterministicHintsCorpus(
    'Источник 1: ЕИС. Документ: Веб-камера. Фрагменты ТЗ: Разрешение видео: не менее 1920x1080',
    [
      { title: 'Backend извлёк характеристики по запросу "logitech"', url: '', sourceLabel: 'ЕИС / КТРУ / площадки (backend)', excerpt: 'Тип подключения: USB' },
      { title: 'Техническое задание на поставку веб-камер', url: 'https://zakupki.gov.ru/example', sourceLabel: 'ЕИС', excerpt: 'Частота кадров: не менее 30 кадр/с' },
    ]
  );
  assert.ok(!/Backend извлёк характеристики/i.test(corpus), 'Deterministic hints corpus must exclude synthetic backend result cards');
  assert.ok(/Техническое задание на поставку веб-камер/i.test(corpus), 'Deterministic hints corpus must keep real procurement documents');

  const extracted = context.extractDeterministicSpecsFromHintText(
    [
      'Backend извлёк характеристики по запросу "Комплект клавиатура + мышь logitech mk120"',
      'Поисковый запрос: "Комплект клавиатура + мышь logitech mk120"',
      'Разрешение видео: не менее 1920x1080',
      'Тип подключения: Проводное USB или эквивалент',
    ].join('\n'),
    8
  );
  assert.ok(
    extracted.every((row) => !/Backend извлёк характеристики/i.test(String(row.value || ''))),
    'Deterministic hint extraction must ignore synthetic backend status lines'
  );
  assert.ok(
    extracted.every((row) => String(row.name || '') !== 'Характеристика'),
    'Deterministic hint extraction must not emit generic "Характеристика" rows from free-form service text'
  );
  assert.ok(
    extracted.some((row) => /Тип подключения/i.test(String(row.name || ''))),
    'Deterministic hint extraction must preserve real parameter/value lines'
  );
}

function runBackendSearchHelperChecks() {
  const sharedPath = path.join(projectRoot, '.deploy', 'netlify-legacy', 'api', 'search', '_shared.js');
  const sharedSrc = fs.readFileSync(sharedPath, 'utf8').replace(/\bexport\s+/g, '');
  const context = {
    console,
    fetch() {
      throw new Error('network_disabled_in_deep_checks');
    },
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(
    `${sharedSrc}
this.getTypeHint = getTypeHint;
this.getGoodsTypeKeywords = getGoodsTypeKeywords;
this.buildBaselineSpecText = buildBaselineSpecText;
this.filterUsefulSpecs = filterUsefulSpecs;
this.applyQuerySpecificOverrides = applyQuerySpecificOverrides;`,
    context
  );

  assert.strictEqual(
    context.getTypeHint('switch'),
    'сетевое оборудование',
    'Backend search helper must provide generic type hint for network equipment'
  );
  assert.ok(
    context.getGoodsTypeKeywords('monitor').some((x) => /display|monitor/i.test(String(x))),
    'Backend search helper must provide keyword set for broad peripheral types'
  );

  const switchBaseline = context.buildBaselineSpecText('switch', 'коммутатор 24 порта');
  assert.ok(
    /Тип сетевого устройства/i.test(switchBaseline) && /Средства управления/i.test(switchBaseline),
    'Broad network baseline must provide professional rows for switch'
  );

  const usbCableBaseline = context.buildBaselineSpecText('usbCable', 'кабель usb c 1.5 м');
  assert.ok(
    /Длина кабеля:\s*не менее 1\.5 м/i.test(usbCableBaseline),
    'Cable baseline must infer cable length from the query'
  );

  const testerBaseline = context.buildBaselineSpecText('cableTester', 'тестер телефонного кабеля');
  assert.ok(
    /Тестируемые типы кабелей:\s*Витая пара .* телефонный кабель/i.test(testerBaseline),
    'Cable tester baseline must keep phone-cable focus for telephone tester queries'
  );
  assert.ok(
    !/BNC/i.test(testerBaseline),
    'Telephone cable tester baseline must not add coax/BNC without an explicit hint'
  );

  const rj45Baseline = context.buildBaselineSpecText('rj45Connector', 'RJ45 cat6 utp');
  assert.ok(
    /Категория СКС:\s*не ниже Cat6/i.test(rj45Baseline),
    'RJ45 baseline must preserve requested cable category from the query'
  );
  assert.ok(
    /Экранирование:\s*UTP/i.test(rj45Baseline),
    'RJ45 baseline must preserve shielding hint from the query'
  );

  const filteredRj45 = context.filterUsefulSpecs([
    { name: 'RJ45接口是什么？有哪些类型，如何使用？ - 知乎', value: 'Псевдо-описание статьи', unit: '' },
    { name: 'Категория СКС', value: 'не ниже Cat6', unit: '' },
  ], 'rj45Connector');
  assert.strictEqual(
    filteredRj45.length,
    1,
    'Backend search helper must drop article titles/questions from RJ45 specs'
  );
  assert.ok(
    /Cat6/i.test(String(filteredRj45[0].value || '')),
    'Backend search helper must keep real RJ45 specification rows'
  );

  const overriddenRj45 = context.applyQuerySpecificOverrides([
    { name: 'Категория СКС', value: 'не ниже Cat5e', unit: '' },
    { name: 'Экранирование', value: 'U/UTP и/или экранированное исполнение по требованиям Заказчика', unit: '' },
  ], 'rj45Connector', 'RJ45 cat6 utp');
  assert.ok(
    overriddenRj45.some((row) => /Категория СКС/i.test(String(row.name || '')) && /Cat6/i.test(String(row.value || ''))),
    'Query-specific overrides must upgrade RJ45 category to the requested Cat6'
  );
  assert.ok(
    overriddenRj45.some((row) => /Экранирование/i.test(String(row.name || '')) && /^UTP$/i.test(String(row.value || ''))),
    'Query-specific overrides must lock RJ45 shielding to the requested UTP'
  );

  const wirelessSetSpecs = context.extractSpecPairs(
    context.buildBaselineSpecText('keyboardMouseSet', 'mk240 nano'),
    'keyboardMouseSet',
    25
  );
  assert.ok(
    wirelessSetSpecs.some((row) => /Тип подключения/i.test(String(row.name || '')) && String(row.unit || '') === ''),
    'Qualitative connection rows must not leak GHz into the unit column'
  );

  const speakersSpecs = context.extractSpecPairs(
    context.buildBaselineSpecText('speakers', 'колонки sven usb'),
    'speakers',
    25
  );
  assert.ok(
    speakersSpecs.some((row) => /Интерфейсы подключения/i.test(String(row.name || '')) && String(row.unit || '') === ''),
    'Interface rows must not leak connector dimensions into the unit column'
  );
}

function main() {
  runAutoDetectChecks();
  runDictionaryConsistencyChecks();
  runLaw1875PolicyChecks();
  runLegalTextChecks();
  runInternetAndZakupkiHelperChecks();
  runTemplateTableRendererChecks();
  runHardMinorTemplateChecks();
  runDocumentStructureChecks();
  runClassicDocumentStyleChecks();
  runEisComparisonHelperChecks();
  runDeterministicHintSanitizationChecks();
  runBackendSearchHelperChecks();
  console.log('Deep checks passed: autodetect, catalog consistency, legal text, document structure.');
}

main();
