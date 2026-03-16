#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.E2E_REACT_BASE_URL || 'http://127.0.0.1:4173';
const ARTIFACTS_DIR = path.resolve(__dirname, 'e2e_artifacts', 'react');

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
              law175_basis: 'ПП РФ № 1875',
              nac_regime: 'pp878',
            },
            specs: [
              { group: 'Процессор', name: 'Количество ядер', value: 'не менее 8', unit: 'шт.' },
              { group: 'Оперативная память', name: 'Объем ОЗУ', value: 'не менее 16', unit: 'ГБ' },
              { group: 'Накопитель', name: 'Тип накопителя', value: 'SSD', unit: '' },
            ],
          }),
        },
      },
    ],
  };
}

function keyboardMouseSetEisSpecs() {
  return [
    { name: 'Состав комплекта', value: 'Клавиатура и компьютерная мышь', unit: '' },
    { name: 'Тип подключения', value: 'Беспроводное (USB-радиоканал 2,4 ГГц) или эквивалент', unit: '' },
    { name: 'Интерфейс подключения комплекта', value: 'USB-радиоканал 2,4 ГГц через USB-приёмник или эквивалент', unit: '' },
    { name: 'Раскладка клавиатуры', value: 'Русская и латинская (двуязычная) с заводской маркировкой', unit: '' },
    { name: 'Количество клавиш клавиатуры', value: 'не менее 104', unit: 'шт.' },
    { name: 'Тип клавишного механизма', value: 'Мембранный/ножничный или эквивалент', unit: '' },
    { name: 'Тип сенсора мыши', value: 'Оптический или эквивалент', unit: '' },
    { name: 'Разрешение сенсора мыши', value: 'не менее 1000', unit: 'dpi' },
    { name: 'Количество кнопок мыши', value: 'не менее 3', unit: 'шт.' },
    { name: 'Беспроводной приёмник', value: 'USB-приёмник для подключения комплекта по радиоканалу 2,4 ГГц', unit: '' },
    { name: 'Совместимость с ОС', value: 'Windows/Linux/macOS или эквивалент', unit: '' },
  ];
}

function keyboardMouseSetInternetSpecs() {
  return [
    { name: 'Тип подключения', value: 'Беспроводное (USB-радиоканал 2,4 ГГц) или эквивалент', unit: '' },
    { name: 'Интерфейс подключения комплекта', value: 'USB-радиоканал 2,4 ГГц через USB-приёмник или эквивалент', unit: '' },
    { name: 'Количество клавиш клавиатуры', value: 'не менее 104', unit: 'шт.' },
    { name: 'Разрешение сенсора мыши', value: 'не менее 1000', unit: 'dpi' },
    { name: 'Количество кнопок мыши', value: 'не менее 3', unit: 'шт.' },
    { name: 'Беспроводной приёмник', value: 'USB-приёмник для подключения комплекта по радиоканалу 2,4 ГГц', unit: '' },
  ];
}

function cableTesterInternetSpecs() {
  return [
    { name: 'Тип устройства', value: 'Многофункциональный кабельный тестер', unit: '' },
    { name: 'Тестируемые типы кабелей', value: 'Витая пара (UTP, FTP, STP), телефонный кабель', unit: '' },
    { name: 'Категории кабелей', value: 'Cat.5, Cat.5e, Cat.6', unit: '' },
    { name: 'Тестируемые разъемы', value: 'RJ-45, RJ-11, RJ-12', unit: '' },
    { name: 'Функции тестирования', value: 'Обрыв, короткое замыкание, неверная пара, перепутанные пары, экранирование', unit: '' },
    { name: 'Дальность тестирования', value: 'не менее 300', unit: 'м' },
    { name: 'Тип индикации', value: 'Светодиодная (LED) и/или ЖК-дисплей по спецификации производителя', unit: '' },
    { name: 'Удаленный модуль', value: 'В комплекте', unit: '' },
    { name: 'Питание', value: 'Батарейки типа AAA или эквивалент', unit: '' },
    { name: 'Комплектность', value: 'Тестер, удаленный модуль, элементы питания, документация производителя', unit: '' },
  ];
}

async function run() {
  ensureDir(ARTIFACTS_DIR);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const searchHits = { internet: 0, eis: 0 };
  const consoleErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
      console.error('[react-browser-console-error]', msg.text());
    }
  });

  for (const url of [
    'https://api.deepseek.com/chat/completions',
    'https://api.groq.com/openai/v1/chat/completions',
    'https://openrouter.ai/api/v1/chat/completions',
  ]) {
    await page.route(url, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockedAiPayload()),
      });
    });
  }

  await page.route('**/api/ai/key', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        key: 'e2e-direct-stream-key',
        url: 'https://api.deepseek.com/chat/completions',
      }),
    });
  });

  await page.route('**/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        version: '3.0.0',
        checked_at: new Date().toISOString(),
        readiness: 'ready',
        free_tz_limit: 3,
        integration_queue: 0,
        integration_history: 2,
        integration_enterprise_status: 4,
        integration_auth_configured: true,
        integration_allow_anon: false,
        integration_target_webhook_configured: true,
        ai_providers: {
          deepseek: true,
          groq: false,
          openrouter: false,
        },
        search_module: 'package',
        yookassa: true,
      }),
    });
  });

  await page.route('**/api/v1/readiness', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        ready: true,
        status: 'ready',
        version: '3.0.0',
        checked_at: new Date().toISOString(),
        summary: 'all_systems_go',
        checks: {
          database: { status: 'ok', detail: 'query_ok', critical: true },
          integration_store: { status: 'ok', detail: 'queue=0; history=2; enterprise=4', critical: true },
          security: { status: 'ok', detail: 'jwt_configured_and_anon_disabled', critical: false },
          email: { status: 'ok', detail: 'smtp_configured', critical: false },
          ai: { status: 'ok', detail: 'providers=deepseek', critical: false },
          search: { status: 'ok', detail: 'package', critical: false },
          payments: { status: 'ok', detail: 'yookassa_configured', critical: false },
          enterprise: { status: 'ok', detail: 'live_target_configured', critical: false },
        },
        free_tz_limit: 3,
        integration_auth_configured: true,
        integration_allow_anon: false,
        integration_target_webhook_configured: true,
        ai_providers: {
          deepseek: true,
          groq: false,
          openrouter: false,
        },
        search_module: 'package',
        yookassa: true,
        queue_total: 0,
        history_total: 2,
        enterprise_status_total: 4,
      }),
    });
  });

  await page.route('**/api/search/specs', async (route) => {
    searchHits.internet += 1;
    const body = route.request().postDataJSON();
    const product = String(body?.product || '').toLowerCase();
    const goodsType = String(body?.goods_type || '');
    let specs = [];
    if (goodsType === 'keyboardMouseSet' || product.includes('mk240')) {
      specs = keyboardMouseSetInternetSpecs();
    } else if (goodsType === 'cableTester' || product.includes('телефонного кабеля')) {
      specs = cableTesterInternetSpecs();
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, specs }),
    });
  });

  await page.route('**/api/search/eis', async (route) => {
    searchHits.eis += 1;
    const body = route.request().postDataJSON();
    const query = String(body?.query || '').toLowerCase();
    const goodsType = String(body?.goods_type || '');
    let specs = [];
    if (goodsType === 'keyboardMouseSet' || query.includes('mk240')) {
      specs = keyboardMouseSetEisSpecs();
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, specs }),
    });
  });

  await page.route('**/api/v1/integration/event', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, record_id: 'evt-1', status: 'queued' }),
    });
  });

  await page.route('**/api/v1/integration/draft', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, record_id: 'drf-1', status: 'queued' }),
    });
  });

  await page.route('**/api/v1/enterprise/autopilot', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        access: 'optional',
        result: {
          ok: true,
          stages_total: 3,
          stages_success: 3,
          stages_failed: 0,
          stages_skipped: 0,
          queued_retry_records: [],
          stages: [],
        },
        immutable_audit: null,
      }),
    });
  });

  await page.route('**/proxy/zakupki/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<html><body><table><tr><td>технические характеристики комплекта клавиатуры и мыши</td></tr></table></body></html>',
    });
  });

  for (const assetUrl of ['**/favicon.ico', '**/apple-touch-icon.png']) {
    await page.route(assetUrl, async (route) => {
      await route.fulfill({
        status: 204,
        contentType: 'image/x-icon',
        body: '',
      });
    });
  }

  await page.addInitScript((user) => {
    window.localStorage.setItem('tz_backend_jwt', 'e2e-jwt-token');
    window.localStorage.setItem('tz_backend_user', JSON.stringify(user));
  }, {
    email: 'e2e@local.test',
    role: 'free',
    tz_count: 0,
    tz_limit: 3,
    trial_active: true,
    trial_days_left: 7,
  });

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Генератор ТЗ', { timeout: 30000 });
  await page.waitForSelector('text=Production ready', { timeout: 30000 });

  await page.getByRole('button', { name: /Arctic|Контраст/ }).evaluate((button) => button.click());
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'contrast', { timeout: 10000 });
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  assert.strictEqual(theme, 'contrast', 'Theme should switch to contrast');
  const runtimeBlockText = await page.locator('.runtime-panel').innerText();
  assert.match(runtimeBlockText, /Production ready/i, 'Runtime panel should show readiness summary');
  assert.match(runtimeBlockText, /deepseek/i, 'Runtime panel should show active AI provider');

  const authToggle = page.locator('.workspace-auth-toggle');
  const expandedBefore = await authToggle.getAttribute('aria-expanded');
  await authToggle.click();
  await page.waitForTimeout(120);
  const expandedAfter = await authToggle.getAttribute('aria-expanded');
  assert.notStrictEqual(expandedAfter, expandedBefore, 'Auth block should toggle open/closed');
  if (expandedAfter !== 'true') {
    await authToggle.click();
    await page.waitForTimeout(120);
    const expandedFinal = await authToggle.getAttribute('aria-expanded');
    assert.strictEqual(expandedFinal, 'true', 'Auth block should be expanded for API key input');
  }
  const authPanelText = await page.locator('.workspace-auth-collapse-inner').innerText();
  assert.match(authPanelText, /e2e@local\.test/i, 'Stored backend user should be shown in auth panel');
  assert.match(authPanelText, /Trial|безлимит/i, 'Trial access state should be shown in auth panel');

  const firstRow = page.locator('.rows-table tbody tr').first();
  await firstRow.locator('td').nth(1).locator('select').selectOption('keyboardMouseSet');
  await firstRow.locator('td').nth(2).locator('input').fill('mk240 nano');

  await page.click('button:has-text("+ Добавить строку")');
  const secondRow = page.locator('.rows-table tbody tr').nth(1);
  await secondRow.locator('td').nth(1).locator('select').selectOption('cableTester');
  await secondRow.locator('td').nth(2).locator('input').fill('тестер телефонного кабеля rj45 rj11');

  await page.click('button:has-text("Сгенерировать ТЗ")');
  await page.waitForFunction(() => {
    const rows = Array.from(document.querySelectorAll('.rows-table tbody tr')).slice(0, 2);
    return rows.length === 2 && rows.every((row) => row.textContent && row.textContent.includes('Готово'));
  }, { timeout: 60000 });

  try {
    await page.waitForFunction(() => (
      Array.from(document.querySelectorAll('.tz-preview input'))
        .some((node) => node instanceof HTMLInputElement && String(node.value || '').includes('USB-приёмник'))
    ), { timeout: 15000 });
    await page.waitForFunction(() => (
      Array.from(document.querySelectorAll('.tz-preview input'))
        .some((node) => node instanceof HTMLInputElement && String(node.value || '').includes('RJ-45, RJ-11, RJ-12'))
    ), { timeout: 15000 });
  } catch (error) {
    const previewText = await page.locator('.tz-preview').innerText().catch(() => '');
    const previewInputs = await page.evaluate(() => (
      Array.from(document.querySelectorAll('.tz-preview input'))
        .map((node) => node instanceof HTMLInputElement ? String(node.value || '') : '')
        .filter(Boolean)
        .slice(0, 80)
    )).catch(() => []);
    console.error('[react-e2e-searchHits]', JSON.stringify(searchHits));
    console.error('[react-e2e-preview-snippet]', previewText.slice(0, 2500));
    console.error('[react-e2e-preview-inputs]', JSON.stringify(previewInputs));
    throw error;
  }

  const docxBtn = page.locator('button:has-text("Скачать DOCX")');
  await page.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const target = buttons.find((btn) => String(btn.textContent || '').includes('Скачать DOCX'));
    return !!target && !target.disabled;
  }, { timeout: 60000 });
  assert.strictEqual(await docxBtn.isDisabled(), false, 'DOCX export button must be enabled after generation');

  assert.ok(searchHits.internet >= 2, 'Internet specs endpoint should be called for both rows');
  assert.ok(searchHits.eis >= 2, 'EIS specs endpoint should be called for both rows');
  const relevantConsoleErrors = consoleErrors.filter((message) => !/Failed to load resource: the server responded with a status of 404/i.test(message));
  assert.deepStrictEqual(relevantConsoleErrors, [], `Unexpected browser console errors: ${relevantConsoleErrors.join(' | ')}`);

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'react_workspace.png'), fullPage: true });
  await browser.close();
  console.log('React E2E check passed.');
}

run().catch((error) => {
  console.error('React E2E check failed:');
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
