#!/usr/bin/env node
'use strict';

const { chromium } = require('playwright');

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const email = `enterprise-smoke+${Date.now()}@test.ru`;

  try {
    await page.goto('https://tz-generator.onrender.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
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

    console.log(JSON.stringify({
      ok: true,
      email,
      url: page.url(),
    }));
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('live_main_domain_smoke failed:');
  console.error(err);
  process.exit(1);
});
