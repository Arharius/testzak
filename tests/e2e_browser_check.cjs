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

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#goods-model-1');

  const title = await page.title();
  assert.ok(title.includes('Генератор ТЗ'), `Unexpected page title: ${title}`);

  // Auto-detect regression checks
  await expectType(page, 'Гравитон', 'pc');
  await expectType(page, 'Asus Vivobook 15 X1504', 'laptop');
  await expectType(page, 'DVD-R Verbatim 4.7GB', 'dvd');

  // Add row and check count
  await page.locator('button:has-text("Добавить товар")').click();
  await page.waitForTimeout(100);
  const rowsCount = await page.locator('#goods-rows tr').count();
  assert.ok(rowsCount >= 2, `Expected at least 2 rows, got ${rowsCount}`);

  // Load demo and verify result render
  await page.locator('button:has-text("Загрузить пример")').click();
  await page.waitForSelector('#result.active');
  const demoSubtitle = await page.locator('#tz-subtitle').textContent();
  assert.ok(demoSubtitle && demoSubtitle.length > 0, 'Demo subtitle must be non-empty');

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
  await page.waitForSelector('#goods-status-1 span:has-text("Готово")', { timeout: 120000 });
  await page.waitForSelector('#result.active', { timeout: 120000 });
  const sec2Text44 = await page.locator('#result-inner').textContent();
  assert.ok(
    sec2Text44 && sec2Text44.includes('ПП РФ № 1875'),
    'Expected 44-FZ result to include PP 1875 text'
  );

  // 223 mode generation
  await page.click('#btn223fz');
  await page.fill('#polojenie223', 'Положение о закупке Тест, ред. 2026');
  await page.fill('#orgName223', 'ООО Тест-Заказчик');
  await page.click('#generateBtn');
  await page.waitForSelector('#goods-status-1 span:has-text("Готово")', { timeout: 120000 });
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
