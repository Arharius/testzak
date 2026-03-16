#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const stamp = Date.now();
  const email = `save-smoke+${stamp}@test.ru`;
  const model = `astra linux 1.8 save-smoke ${stamp}`;
  const saveNetwork = [];

  page.on('requestfailed', (request) => {
    if (!request.url().includes('/api/tz/')) return;
    saveNetwork.push({
      kind: 'requestfailed',
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || 'unknown',
    });
  });

  page.on('response', async (response) => {
    if (!response.url().includes('/api/tz/')) return;
    let body = '';
    try {
      body = await response.text();
    } catch {
      body = '<unreadable>';
    }
    saveNetwork.push({
      kind: 'response',
      url: response.url(),
      status: response.status(),
      body: body.slice(0, 1000),
    });
  });

  try {
    await page.goto('https://tz-generator.onrender.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.getByRole('heading', { name: 'Генератор ТЗ' }).waitFor({ timeout: 15000 });

    await page.getByRole('button', { name: 'Войти' }).click();
    await page.getByRole('button', { name: 'Email-ссылка' }).click();
    await page.getByPlaceholder('your@email.ru').fill(email);
    await page.getByRole('button', { name: 'Отправить ссылку для входа' }).click();

    await page.waitForFunction(
      (expectedEmail) => {
        const bodyText = document.body.innerText || '';
        return bodyText.includes(expectedEmail) && bodyText.includes('Trial');
      },
      email,
      { timeout: 30000 },
    );

    const firstRow = page.locator('.rows-table tbody tr').first();
    await firstRow.locator('td').nth(1).locator('select').selectOption('os');
    await firstRow.locator('td').nth(2).locator('input').fill(model);

    const generateBtn = page.getByRole('button', { name: /Сгенерировать ТЗ|Генерация/ });
    await generateBtn.click();

    await page.waitForFunction(() => {
      const row = document.querySelector('.rows-table tbody tr');
      return Boolean(row && row.textContent && row.textContent.includes('Готово'));
    }, { timeout: 120000 });

    const saveBtn = page.getByRole('button', { name: /Сохранить ТЗ/ });
    await saveBtn.waitFor({ timeout: 10000 });
    await page.waitForFunction(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const save = buttons.find((btn) => (btn.textContent || '').includes('Сохранить ТЗ'));
      return Boolean(save && !save.disabled);
    }, { timeout: 30000 });
    await assert.doesNotReject(async () => {
      await saveBtn.click();
    });

    await page.waitForFunction(() => {
      const bodyText = document.body.innerText || '';
      return bodyText.includes('ТЗ сохранено') || bodyText.includes('Ошибка сохранения');
    }, { timeout: 30000 });

    const pageTextAfterSave = await page.evaluate(() => document.body.innerText || '');
    if (!pageTextAfterSave.includes('ТЗ сохранено')) {
      throw new Error(
        `Save toast did not report success.\nNetwork:\n${JSON.stringify(saveNetwork, null, 2)}\nBody snippet:\n${pageTextAfterSave.slice(0, 2500)}`
      );
    }

    const historyBtn = page.getByRole('button', { name: /Мои ТЗ/ });
    await historyBtn.click();
    await page.getByText('Сохранённые ТЗ').waitFor({ timeout: 15000 });
    await page.waitForFunction(
      (expectedModel) => {
        const bodyText = document.body.innerText || '';
        return bodyText.includes(expectedModel);
      },
      model,
      { timeout: 30000 },
    );

    console.log(JSON.stringify({
      ok: true,
      email,
      model,
      url: page.url(),
    }));
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('live_save_smoke failed:');
  console.error(err);
  process.exit(1);
});
