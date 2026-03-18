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

function mockedServiceAiPayload() {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            meta: {
              okpd2_code: '43.21.10.290',
              okpd2_name: 'Работы электромонтажные прочие, не включенные в другие группировки',
              ktru_code: '',
              law175_status: 'none',
              law175_basis: 'По текущей классификации позиция относится к услугам; специальные защитные меры ПП РФ № 1875 по данной услуге не применяются, требуется финальная проверка предмета закупки на дату публикации.',
              nac_regime: 'none',
            },
            specs: [
              { group: 'Общие требования', name: 'Состав услуг', value: 'Обследование трасс, монтаж кабельных линий, установка и подключение оборудования, маркировка, исполнительная документация', unit: '—' },
              { group: 'Сроки и этапы', name: 'Этапность оказания услуг', value: 'Подготовка, монтаж, пусконаладка и сдача результата по согласованному графику', unit: '—' },
              { group: 'Сроки и SLA', name: 'Срок оказания услуг', value: 'не более 20', unit: 'рабочих дней' },
              { group: 'Приемка', name: 'Подтверждение результата', value: 'Акт сдачи-приемки, исполнительная схема, фотоотчет и комплект отчетных материалов', unit: '—' },
              { group: 'Организация работ', name: 'Место и режим оказания услуг', value: 'На территории Заказчика в согласованные окна работ', unit: '—' },
              { group: 'Требования к исполнителю', name: 'Квалификация специалистов', value: 'Наличие обученного персонала с необходимыми допусками и ответственным руководителем работ', unit: '—' },
            ],
          }),
        },
      },
    ],
  };
}

function mockedUniversalDraftAiPayload() {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            meta: {
              okpd2_code: '',
              okpd2_name: '',
              ktru_code: '',
              law175_status: 'none',
              law175_basis: 'нужно уточнение',
              nac_regime: 'none',
            },
            specs: [
              { group: 'Общие сведения', name: 'Тип изделия', value: 'Тепловизор инфракрасный', unit: 'тип' },
              { group: 'Основные характеристики', name: 'Диапазон измерения', value: 'не менее -20 ... +550', unit: '°C' },
              { group: 'Основные характеристики', name: 'Разрешение ИК-матрицы', value: 'не менее 256 x 192', unit: 'пикс.' },
            ],
          }),
        },
      },
    ],
  };
}

function mockedUniversalClassifiedAiPayload() {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            meta: {
              okpd2_code: '26.70.13.190',
              okpd2_name: 'Камеры цифровые прочие',
              ktru_code: '',
              law175_status: 'none',
              law175_basis: 'По данным ЕИС и внешних источников позиция не подпадает под специальную защитную меру ПП РФ № 1875; требуется обычная финальная проверка перечней на дату публикации.',
              nac_regime: 'none',
            },
            specs: [
              { group: 'Общие сведения', name: 'Тип изделия', value: 'Тепловизор инфракрасный', unit: 'тип' },
              { group: 'Основные характеристики', name: 'Диапазон измерения', value: 'не менее -20 ... +550', unit: '°C' },
              { group: 'Основные характеристики', name: 'Разрешение ИК-матрицы', value: 'не менее 256 x 192', unit: 'пикс.' },
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

function serviceSpecs() {
  return [
    { name: 'Состав услуг', value: 'Обследование, монтаж, подключение, маркировка и сдача результата', unit: '' },
    { name: 'Срок оказания услуг', value: 'не более 20 рабочих дней', unit: '' },
    { name: 'Этапность', value: 'Подготовка, монтаж, пусконаладка, сдача результата', unit: '' },
    { name: 'Приемка', value: 'Акт, отчетные материалы, исполнительная документация', unit: '' },
    { name: 'Место оказания услуг', value: 'На территории Заказчика', unit: '' },
    { name: 'Квалификация исполнителя', value: 'Квалифицированные специалисты с необходимыми допусками', unit: '' },
  ];
}

function thermalCameraSpecs() {
  return [
    { name: 'Тип изделия', value: 'Тепловизор инфракрасный', unit: '' },
    { name: 'Диапазон измерения температуры', value: 'не менее -20 ... +550', unit: '°C' },
    { name: 'Разрешение ИК-матрицы', value: 'не менее 256 x 192', unit: 'пикс.' },
    { name: 'Интерфейсы', value: 'USB Type-C или эквивалент', unit: '' },
    { name: 'Комплектность', value: 'Тепловизор, аккумулятор, зарядное устройство, документация', unit: '' },
  ];
}

async function run() {
  ensureDir(ARTIFACTS_DIR);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const searchHits = { internet: 0, eis: 0 };
  const universalAiHits = { thermal: 0 };
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
      let body = {};
      try {
        body = route.request().postDataJSON() || {};
      } catch (_) {}
      const messageText = JSON.stringify(body).toLowerCase();
      let payload;
      if (/тепловизор|инфракрасн/.test(messageText)) {
        universalAiHits.thermal += 1;
        payload = universalAiHits.thermal >= 5
          ? mockedUniversalClassifiedAiPayload()
          : mockedUniversalDraftAiPayload();
      } else if (/otherservice|оказани[ея] услуг|монтаж лвс|услуга|состав услуг|приемк|sla/.test(messageText)) {
        payload = mockedServiceAiPayload();
      } else {
        payload = mockedAiPayload();
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
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
    } else if (goodsType === 'otherGoods' || /тепловизор|инфракрасн/.test(product)) {
      specs = thermalCameraSpecs();
    } else if (goodsType === 'otherService' || /монтаж|лвс|структурированной кабельной системы/.test(product)) {
      specs = serviceSpecs();
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
    } else if (goodsType === 'otherGoods' || /тепловизор|инфракрасн/.test(query)) {
      specs = thermalCameraSpecs();
    } else if (goodsType === 'otherService' || /монтаж|лвс|структурированной кабельной системы/.test(query)) {
      specs = serviceSpecs();
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

  async function ensurePreviewOpen() {
    const preview = page.locator('.tz-preview');
    if (await preview.count() > 0 && await preview.first().isVisible().catch(() => false)) return;
    const previewSummary = page.locator('summary').filter({ hasText: 'Предпросмотр ТЗ' }).first();
    if (await previewSummary.count() === 0) return;
    await previewSummary.click();
    await page.waitForTimeout(120);
  }

  async function clickGenerateTZ() {
    const generateButton = page.locator('button').filter({ hasText: 'Сгенерировать ТЗ' }).first();
    await generateButton.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForFunction(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const target = buttons.find((btn) => String(btn.textContent || '').includes('Сгенерировать ТЗ'));
      return !!target && !target.disabled;
    }, { timeout: 30000 });
    await generateButton.evaluate((button) => {
      button.click();
    });
  }

  const firstRow = page.locator('.rows-table tbody tr').first();
  await firstRow.locator('td').nth(1).locator('select').selectOption('keyboardMouseSet');
  await firstRow.locator('td').nth(2).locator('input').fill('комплект клавиатура мышь mk240 nano');

  await page.click('button:has-text("+ Добавить строку")');
  const secondRow = page.locator('.rows-table tbody tr').nth(1);
  await secondRow.locator('td').nth(1).locator('select').selectOption('cableTester');
  await secondRow.locator('td').nth(2).locator('input').fill('тестер кабеля rj45 rj11 телефонный');

  await page.click('button:has-text("+ Добавить строку")');
  const thirdRow = page.locator('.rows-table tbody tr').nth(2);
  await thirdRow.locator('td').nth(1).locator('select').selectOption('otherService');
  await thirdRow.locator('td').nth(2).locator('input').fill('монтаж ЛВС и структурированной кабельной системы');

  await clickGenerateTZ();
  await page.waitForFunction(() => {
    const rows = Array.from(document.querySelectorAll('.rows-table tbody tr')).slice(0, 3);
    return rows.length === 3 && rows.every((row) => row.textContent && row.textContent.includes('Готово'));
  }, { timeout: 60000 });

  await ensurePreviewOpen();
  const mixedPreviewText = await page.locator('.tz-preview').innerText().catch(() => '');
  assert.match(mixedPreviewText, /Позиция №3: .*Услуга/i, 'Mixed preview should include service row summary');

  const docxBtn = page.locator('button:has-text("Скачать DOCX")');
  await page.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const target = buttons.find((btn) => String(btn.textContent || '').includes('Скачать DOCX'));
    return !!target && !target.disabled;
  }, { timeout: 60000 });
  assert.strictEqual(await docxBtn.isDisabled(), false, 'DOCX export button must be enabled after generation');

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.rows-table tbody tr', { timeout: 30000 });

  const serviceRow = page.locator('.rows-table tbody tr').first();
  await serviceRow.locator('td').nth(1).locator('select').selectOption('otherService');
  await serviceRow.locator('td').nth(2).locator('input').fill('монтаж ЛВС и структурированной кабельной системы');

  await clickGenerateTZ();
  await page.waitForFunction(() => {
    const row = document.querySelector('.rows-table tbody tr');
    return Boolean(row && row.textContent && row.textContent.includes('Готово'));
  }, { timeout: 60000 });

  await ensurePreviewOpen();
  const servicePreviewText = await page.locator('.tz-preview').innerText();
  const readinessText = await page.evaluate(() => document.body.innerText || '');

  assert.match(servicePreviewText, /на оказание/i, 'Service-only preview should switch document wording to services');
  assert.match(servicePreviewText, /Требования к порядку оказания услуг/i, 'Service-only preview should include service execution section');
  assert.match(servicePreviewText, /Требования к порядку сдачи-?приемки и отчетности/i, 'Service-only preview should include acceptance/reporting section');
  assert.match(servicePreviewText, /Полнота ТЗ на услуги/i, 'Service-only preview should include service readiness summary');

  assert.match(readinessText, /Readiness gate перед публикацией/i, 'Page should show readiness gate after service generation');
  assert.match(readinessText, /Автодовести до публикации/i, 'Page should expose publication autopilot in readiness gate');
  assert.ok(!/service-block-/.test(readinessText), 'Service-specific issue keys should not leak into UI text');

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.rows-table tbody tr', { timeout: 30000 });

  const universalRow = page.locator('.rows-table tbody tr').first();
  await universalRow.locator('td').nth(1).locator('select').selectOption('otherGoods');
  await universalRow.locator('td').nth(2).locator('input').fill('тепловизор инфракрасный промышленный');

  await clickGenerateTZ();
  await page.waitForFunction(() => {
    const row = document.querySelector('.rows-table tbody tr');
    return Boolean(row && row.textContent && row.textContent.includes('Готово'));
  }, { timeout: 60000 });

  await page.waitForFunction(() => {
    const text = document.body.innerText || '';
    return /Инструменты исправления|Уточнить ОКПД2|Переобогатить классификацию|Класс\./.test(text);
  }, { timeout: 60000 });

  await universalRow.getByRole('button', { name: /Класс\./ }).click();
  await page.waitForFunction(() => {
    const text = document.body.innerText || '';
    return /Классификация обновлена/i.test(text);
  }, { timeout: 60000 });

  assert.ok(searchHits.internet >= 1, 'Internet specs endpoint should be used at least once');
  assert.ok(searchHits.eis >= 1, 'EIS specs endpoint should be used at least once');
  assert.ok(universalAiHits.thermal >= 5, 'Universal classification scenario should hit AI multiple times');
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
