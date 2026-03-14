#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:8765/legacy/index.html';
const ARTIFACTS_DIR = path.resolve(__dirname, 'e2e_artifacts');
const USE_LIVE_API = process.env.E2E_LIVE_API === '1';
const E2E_PROVIDER = process.env.E2E_PROVIDER || 'deepseek';
const E2E_MODEL = process.env.E2E_MODEL || 'deepseek-chat';
const E2E_API_KEY = process.env.E2E_API_KEY || '';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function mockedAiPayload() {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            meta: {
              okpd2_code: '26.20.11.110',
              okpd2_name: 'Ноутбуки',
              ktru_code: '26.20.11.110-00000001',
              law175_status: 'exempt',
              law175_basis: 'ПП РФ № 1875 от 23.12.2024 — для данной категории применяются меры национального режима',
              nac_regime: 'pp878',
            },
            specs: [
              { group: 'Процессор', name: 'Количество ядер', value: 'не менее 8', unit: 'шт.' },
              { group: 'Оперативная память', name: 'Объем ОЗУ', value: 'не менее 16', unit: 'ГБ' },
              { group: 'Экран', name: 'Разрешение экрана', value: '1920x1080', unit: '' },
            ],
          }),
        },
      },
    ],
  };
}

async function expectType(page, input, expectedType) {
  const modelInput = page.locator('#goods-model-1');
  await modelInput.fill('');
  await modelInput.type(input, { delay: 20 });
  await page.waitForTimeout(120);
  const type = await page.locator('#goods-type-1').evaluate(el => el.value);
  assert.strictEqual(type, expectedType, `Expected "${input}" -> "${expectedType}", got "${type}"`);
}

async function waitForAnyReadyStatus(page, rowId = 1, timeout = 120000) {
  await page.waitForFunction(
    (id) => {
      const text = String(document.querySelector('#goods-status-' + id)?.textContent || '').toLowerCase();
      return /готово|шаблон|черновик|резерв|офлайн/.test(text);
    },
    rowId,
    { timeout }
  );
}

async function run() {
  ensureDir(ARTIFACTS_DIR);
  if (USE_LIVE_API && !E2E_API_KEY) {
    throw new Error('E2E_LIVE_API=1 requires E2E_API_KEY');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error('[browser-console-error]', msg.text());
    }
  });

  if (!USE_LIVE_API) {
    await page.route('https://openrouter.ai/api/v1/chat/completions', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockedAiPayload()),
      });
    });
    await page.route('https://api.groq.com/openai/v1/chat/completions', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockedAiPayload()),
      });
    });
    await page.route('https://api.deepseek.com/chat/completions', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockedAiPayload()),
      });
    });
  }

  // Deterministic internet lookup mocks for legacy HTML helpers/features (Yandex suggest JSONP).
  await page.route(/https:\/\/(suggest\.yandex\.ru|yandex\.ru)\/.*suggest-ya\.cgi.*/, async route => {
    const reqUrl = new URL(route.request().url());
    const callbackName = reqUrl.searchParams.get('callback') || '__cb';
    const query = reqUrl.searchParams.get('part') || '';
    const payload = [
      query,
      [
        `${query} printer`,
        `${query} лазерный принтер`,
        `${query} характеристики`,
      ],
    ];
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: `${callbackName}(${JSON.stringify(payload)});`,
    });
  });

  await page.route('**/api/search/eis', async route => {
    let body = {};
    try {
      body = route.request().postDataJSON() || {};
    } catch (_) {}
    const goodsType = String(body.goods_type || '').trim();
    const query = String(body.query || '').trim();
    const response = { ok: true, source: 'eis', query, ktruFound: false, specs: [], contexts: [] };

    if (goodsType === 'keyboardMouseSet' && /mk240/i.test(query)) {
      response.specs = [
        { name: 'Состав комплекта', value: 'Клавиатура и компьютерная мышь', unit: '' },
        { name: 'Тип подключения', value: 'Беспроводное (USB-радиоканал 2,4 ГГц) или эквивалент', unit: '' },
        { name: 'Интерфейс подключения комплекта', value: 'USB-радиоканал 2,4 ГГц через USB-приёмник или эквивалент', unit: '' },
        { name: 'Раскладка клавиатуры', value: 'Русская и латинская (двуязычная) с заводской маркировкой', unit: '' },
        { name: 'Количество клавиш клавиатуры', value: 'не менее 104', unit: 'шт.' },
        { name: 'Тип сенсора мыши', value: 'Оптический или эквивалент', unit: '' },
        { name: 'Количество кнопок мыши', value: 'не менее 3', unit: 'шт.' },
        { name: 'Беспроводной приёмник', value: 'USB-приёмник для подключения комплекта по радиоканалу 2,4 ГГц', unit: '' },
      ];
      response.contexts = [
        {
          title: 'Описание объекта закупки на поставку беспроводного комплекта клавиатуры и мыши',
          url: 'https://zakupki.gov.ru/mock-mk240',
          excerpt: 'Тип подключения: беспроводное 2,4 ГГц. Приемник: USB. Раскладка: RU/EN.',
        },
      ];
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  await page.route('**/api/search/specs', async route => {
    let body = {};
    try {
      body = route.request().postDataJSON() || {};
    } catch (_) {}
    const goodsType = String(body.goods_type || '').trim();
    const product = String(body.product || '').trim();
    const response = { ok: true, source: 'internet', query: product, specs: [], contexts: [] };

    if (goodsType === 'cableTester') {
      response.specs = [
        { name: 'Тип устройства', value: 'Многофункциональный кабельный тестер', unit: '' },
        { name: 'Тестируемые типы кабелей', value: 'Витая пара (UTP, FTP, STP), телефонный кабель', unit: '' },
        { name: 'Категории кабелей', value: 'Cat.5, Cat.5e, Cat.6', unit: '' },
        { name: 'Тестируемые разъемы', value: 'RJ-45, RJ-11, RJ-12', unit: '' },
        { name: 'Функции тестирования', value: 'Обрыв, короткое замыкание, неверная пара, перепутанные пары, экранирование', unit: '' },
        { name: 'Тип индикации', value: 'Светодиодная (LED) и/или ЖК-дисплей по спецификации производителя', unit: '' },
        { name: 'Удаленный модуль', value: 'В комплекте', unit: '' },
        { name: 'Питание', value: 'Батарейки типа AAA или эквивалент', unit: '' },
      ];
      response.contexts = [
        {
          title: 'Технические характеристики кабельного тестера',
          url: 'https://shop.example/cable-tester',
          excerpt: 'RJ-45, RJ-11, RJ-12. Wiremap, short/open. Remote unit included.',
        },
      ];
    }

    if (goodsType === 'rj45Connector') {
      response.specs = [
        { name: 'Тип разъема', value: 'RJ-45 (8P8C)', unit: '' },
        { name: 'Категория СКС', value: 'не ниже Cat6', unit: '' },
        { name: 'Экранирование', value: 'UTP', unit: '' },
      ];
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  await page.goto(BASE_URL, { waitUntil: 'commit', timeout: 120000 });
  await page.waitForSelector('#goods-model-1', { timeout: 120000 });

  const title = await page.title();
  assert.ok(title.includes('Генератор ТЗ'), `Unexpected page title: ${title}`);

  // Automation defaults for unattended work
  assert.strictEqual(await page.locator('#automationAutopilotTemplate').isChecked(), true, 'Autopilot template mode should be enabled by default');
  assert.strictEqual(await page.locator('#automationHardTemplateMinor').isChecked(), true, 'Hard template for minor goods should be enabled by default');

  // Auto-detect regression checks
  await expectType(page, 'Гравитон', 'pc');
  await expectType(page, 'Asus Vivobook 15 X1504', 'laptop');
  await expectType(page, 'DVD-R Verbatim 4.7GB', 'dvd');

  // Internet hint filtering: noisy unrelated hints should be ignored for product hinting.
  const filteredNoise = await page.evaluate(() =>
    pickRelevantHintParts('Xerox B210', [
      'Mars rover geology exploration and astronomy encyclopedia',
      'Space science mission on another planet',
    ])
  );
  assert.strictEqual(filteredNoise, '', 'Noisy unrelated hints must be filtered out');

  const filteredRelevant = await page.evaluate(() =>
    pickRelevantHintParts('Xerox B210', [
      'Xerox B210 laser printer monochrome office device',
    ])
  );
  assert.ok(
    filteredRelevant && /xerox/i.test(filteredRelevant) && /b210/i.test(filteredRelevant),
    'Relevant product hint should be retained'
  );
  await expectType(page, 'RJ45', 'rj45Connector');
  await expectType(page, 'тестер телефонного кабеля', 'cableTester');

  // Current generation flow must resolve characteristics automatically:
  // row 1 via EIS/backend procurement context, row 2 via internet fallback.
  await page.evaluate(() => {
    applyDetectedGoodsType(1, 'keyboardMouseSet', 'rules');
    const search = document.querySelector('#goods-search-1');
    if (search) search.value = 'Комплект клавиатура + мышь';
  });
  await page.locator('#goods-model-1').fill('mk240 nano');
  await page.locator('#goods-qty-1').fill('5');
  await page.locator('button:has-text("Добавить товар")').click();
  await page.waitForSelector('#goods-model-2', { timeout: 15000 });
  await page.evaluate(() => {
    applyDetectedGoodsType(2, 'cableTester', 'rules');
    const search = document.querySelector('#goods-search-2');
    if (search) search.value = 'Тестер кабеля';
  });
  await page.locator('#goods-model-2').fill('тестер телефонного кабеля');
  await page.locator('#goods-qty-2').fill('1');
  await page.click('#generateTemplateBtn');
  await waitForAnyReadyStatus(page, 1, 120000);
  await waitForAnyReadyStatus(page, 2, 120000);
  await page.waitForSelector('#result.active', { timeout: 120000 });
  await page.waitForFunction(
    () => {
      const text = String(document.querySelector('#result-inner')?.textContent || '');
      return text.includes('Беспроводное (USB-радиоканал 2,4 ГГц)')
        && text.includes('USB-приёмник')
        && (text.includes('Тестируемые разъемы') || text.includes('Тестируемые разъёмы'));
    },
    null,
    { timeout: 120000 }
  );
  const resultTextTemplateDvd = await page.locator('#result-inner').textContent();
  assert.ok(
    resultTextTemplateDvd && resultTextTemplateDvd.includes('Беспроводное (USB-радиоканал 2,4 ГГц)'),
    'Template generation must transfer wireless keyboard/mouse specs from procurement search'
  );
  assert.ok(
    resultTextTemplateDvd.includes('USB-приёмник'),
    'Template generation must preserve receiver-based wireless connection details for keyboard/mouse set'
  );
  assert.ok(
    resultTextTemplateDvd.includes('Тестируемые разъемы') || resultTextTemplateDvd.includes('Тестируемые разъёмы'),
    'Template generation must render cable tester parameter rows after internet fallback'
  );
  assert.ok(
    /RJ-45,\s*RJ-11,\s*RJ-12/.test(resultTextTemplateDvd),
    'Template generation must preserve phone/LAN connector coverage for cable tester'
  );

  // Export DOCX
  const [docxDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator('#docxBtn').click(),
  ]);
  const docxPath = path.join(ARTIFACTS_DIR, 'e2e_result.docx');
  await docxDownload.saveAs(docxPath);
  assert.ok(fs.existsSync(docxPath), 'DOCX file was not downloaded');

  // Export PDF
  const [pdfDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.locator('button:has-text("Скачать PDF")').click(),
  ]);
  const pdfPath = path.join(ARTIFACTS_DIR, 'e2e_result.pdf');
  await pdfDownload.saveAs(pdfPath);
  assert.ok(fs.existsSync(pdfPath), 'PDF file was not downloaded');

  // Switch to API path with mocked response
  await page.locator('button:has-text("Новый запрос")').click();
  await page.waitForSelector('#goods-model-1');

  await page.selectOption('#apiProvider', E2E_PROVIDER);
  await page.selectOption('#modelSelect', E2E_MODEL);
  await page.fill('#apiKey', USE_LIVE_API ? E2E_API_KEY : 'sk-or-e2e-mock-key');
  await page.fill('#goods-model-1', 'Asus Vivobook 15 X1504');
  await page.fill('#goods-qty-1', '5');
  await page.waitForTimeout(150);

  await page.click('#generateBtn');
  await waitForAnyReadyStatus(page, 1, 120000);
  await page.waitForSelector('#result.active', { timeout: 120000 });
  const sec2Text44 = await page.locator('#result-inner').textContent();
  assert.ok(sec2Text44, 'Expected 44-FZ result text to be non-empty');
  if (sec2Text44.includes('1.1. Контроль ОКПД2 и ПП РФ № 1875')) {
    assert.ok(
      sec2Text44.includes('ПП РФ № 1875'),
      'Expected 44-FZ result with compliance block to include PP 1875 text'
    );
  } else {
    assert.ok(
      sec2Text44.includes('2.2. Требования к качеству поставляемого Товара'),
      'Expected strict reference 44-FZ layout to include detailed section 2 requirements'
    );
  }

  // 223 mode generation
  await page.click('#btn223fz');
  await page.fill('#polojenie223', 'Положение о закупке Тест, ред. 2026');
  await page.fill('#orgName223', 'ООО Тест-Заказчик');
  await page.click('#generateBtn');
  await waitForAnyReadyStatus(page, 1, 120000);
  await page.waitForSelector('#result.active', { timeout: 120000 });
  const sec2Text223 = await page.locator('#result-inner').textContent();
  assert.ok(
    sec2Text223 && sec2Text223.includes('Закупка по 223-ФЗ'),
    'Expected 223-FZ banner in output'
  );
  assert.ok(
    sec2Text223.includes('ПП РФ № 1875'),
    'Expected 223-FZ result to include PP 1875 text'
  );

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'e2e_final.png'), fullPage: true });
  await browser.close();

  console.log(`E2E browser check passed (${USE_LIVE_API ? 'live API' : 'mock API'}).`);
  console.log(`Artifacts: ${ARTIFACTS_DIR}`);
}

run().catch(async err => {
  console.error('E2E browser check failed:');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
