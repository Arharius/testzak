#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.REACT_E2E_BASE_URL || 'http://127.0.0.1:4173';
const ARTIFACTS_DIR = path.resolve(__dirname, 'react_e2e_artifacts');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function aiClassifyResponse() {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify([
            { type: 'laptop', model: 'Asus VivoBook 15 X1504', reason: 'Точное совпадение модели ноутбука' },
            { type: 'pc', model: 'Asus VivoBook 15 X1504', reason: 'Резервный вариант на случай ошибки бренда' }
          ])
        }
      }
    ]
  };
}

function aiSpecsResponse() {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            meta: {
              okpd2_code: '26.20.11.110',
              okpd2_name: 'Компьютеры портативные',
              ktru_code: '26.20.11.110-00000001',
              law175_status: 'exempt',
              law175_basis: 'ПП РФ № 1875'
            },
            specs: [
              { group: 'Процессор', name: 'Модель CPU', value: 'Intel Core i5-1235U', unit: '' },
              { group: 'ОЗУ', name: 'Объем', value: '16', unit: 'ГБ' },
              { group: 'Экран', name: 'Диагональ', value: '15.6', unit: 'дюйм' }
            ]
          })
        }
      }
    ]
  };
}

async function run() {
  ensureDir(ARTIFACTS_DIR);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  await page.route('https://api.duckduckgo.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        Heading: 'Asus VivoBook 15 X1504',
        AbstractText: 'Laptop 15.6 FHD, 16GB RAM, SSD 512GB'
      })
    });
  });

  await page.route('https://api.deepseek.com/chat/completions', async (route) => {
    const body = route.request().postData() || '';
    if (body.includes('Ты классификатор ИТ-товаров для госзакупок')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(aiClassifyResponse()) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(aiSpecsResponse()) });
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('table.rows-table');

  const title = await page.title();
  assert.ok(title.includes('Генератор ТЗ'), `Unexpected title: ${title}`);

  const themeButtons = await page.locator('.theme-switch button').count();
  assert.strictEqual(themeButtons, 3, 'Theme switch must have 3 buttons');

  await page.locator('.fold-head:has-text("ЕИС и торговые площадки")').click();
  await page.waitForSelector('text=Endpoint коннектора');
  await page.locator('.fold-head:has-text("ЕИС и торговые площадки")').click();

  await page.fill('input[placeholder="sk-..."]', 'sk-react-e2e');
  await page.fill('input[placeholder="Модель / описание"]', 'Asus VivoBook 15 X1504');

  await page.click('button:has-text("🌐 Подтянуть из интернета")');
  await page.waitForSelector('text=Найдено несколько вариантов — выберите', { timeout: 20000 });
  await page.click('.row-suggest-item:has-text("Ноутбук")');
  await page.waitForSelector('text=✅ Интернет', { timeout: 10000 });

  await page.click('button:has-text("Сгенерировать ТЗ")');
  await page.waitForTimeout(1200);

  const text = await page.locator('textarea[readonly]').inputValue();
  assert.ok(text.includes('ТЕХНИЧЕСКОЕ ЗАДАНИЕ'), 'TZ header missing');
  assert.ok(text.includes('26.20.11.110'), 'OKPD2 code missing');

  const [packDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('button:has-text("Экспорт пакета")')
  ]);
  const packPath = path.join(ARTIFACTS_DIR, 'react_procurement_pack.json');
  await packDownload.saveAs(packPath);
  assert.ok(fs.existsSync(packPath), 'Pack file not downloaded');

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'react_e2e_final.png'), fullPage: true });
  await browser.close();

  console.log('React E2E check passed.');
  console.log(`Artifacts: ${ARTIFACTS_DIR}`);
}

run().catch((err) => {
  console.error('React E2E check failed:');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
