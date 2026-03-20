#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require(path.join(__dirname, '..', 'frontend-react', 'node_modules', 'typescript'));

const source = fs.readFileSync(
  path.join(__dirname, '..', 'frontend-react', 'src', 'utils', 'compliance.ts'),
  'utf-8'
);

const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const moduleShim = { exports: {} };
const fn = new Function('require', 'module', 'exports', `${transpiled}; return module.exports;`);
const exported = fn(require, moduleShim, moduleShim.exports);
const { sanitizeProcurementSpecs } = exported;

const sanitized = sanitizeProcurementSpecs(
  { type: 'pc', model: 'MSI PRO DP21 14M-1069XRU' },
  [
    { group: 'Общие сведения', name: 'Part No', value: '9S6-B0A431-1069', unit: '' },
    { group: 'Общие сведения', name: 'MKT Name', value: 'PRO DP21 14M', unit: '' },
    { group: 'Общие сведения', name: 'MKT Spec', value: 'PRO DP21 14M-1069XRU', unit: '' },
    { group: 'Общие сведения', name: 'Процессор', value: 'Intel Core i7 Processor 14700', unit: '' },
  ]
);

if (sanitized.length !== 1 || sanitized[0].name !== 'Процессор') {
  console.error('FAIL compliance sanitizer should drop model identity fields');
  console.error(JSON.stringify(sanitized, null, 2));
  process.exit(1);
}

const vendorSanitized = sanitizeProcurementSpecs(
  { type: 'laptop', model: 'Asus Vivobook X1503' },
  [
    { group: 'Общие сведения', name: 'Операционная система', value: 'Windows 11 Home ASUS recomienda Windows 11 Pro para empresas https://support.microsoft.com/article/example', unit: '—' },
    { group: 'Общие сведения', name: 'Процессор', value: 'AMD Ryzen AI MAX+ 395 Processor 3.0GHz (80MB Cache, up to 5.1GHz, 16 cores, 32 Threads); AMD XDNA NPU up to 50TOPS', unit: '—' },
  ]
);

if (vendorSanitized.length !== 2) {
  console.error('FAIL compliance sanitizer should keep only normalized vendor fields');
  console.error(JSON.stringify(vendorSanitized, null, 2));
  process.exit(1);
}

if (!/Windows 11/i.test(vendorSanitized[0].value) || /https?:\/\//i.test(vendorSanitized[0].value)) {
  console.error('FAIL compliance sanitizer should normalize OS vendor copy and drop URLs');
  console.error(JSON.stringify(vendorSanitized[0], null, 2));
  process.exit(1);
}

if (!/16 ядер/i.test(vendorSanitized[1].value) || !/50 TOPS/i.test(vendorSanitized[1].value) || /Ryzen|AMD/i.test(vendorSanitized[1].value)) {
  console.error('FAIL compliance sanitizer should neutralize processor vendor copy into measurable requirements');
  console.error(JSON.stringify(vendorSanitized[1], null, 2));
  process.exit(1);
}

const serviceSanitized = sanitizeProcurementSpecs(
  { type: 'otherService', model: 'Периодический медицинский осмотр работников' },
  [
    { group: 'Общие сведения', name: 'Состояние товара', value: 'новый, не бывший в эксплуатации', unit: 'состояние' },
    { group: 'Общие сведения', name: 'Комплект поставки', value: 'изделие, кабели и документация', unit: 'комплект' },
    { group: 'Организация работ', name: 'Срок оказания услуг', value: 'не более 30', unit: 'календарных дней' },
  ]
);

if (serviceSanitized.length !== 1 || serviceSanitized[0].name !== 'Срок оказания услуг') {
  console.error('FAIL compliance sanitizer should drop product-only specs from service rows');
  console.error(JSON.stringify(serviceSanitized, null, 2));
  process.exit(1);
}

const goodsBoilerplateSanitized = sanitizeProcurementSpecs(
  { type: 'laptop', model: 'Asus Vivobook X1503' },
  [
    { group: 'Общие сведения', name: 'Маркировка и идентификация', value: 'наличие заводской маркировки, серийного номера и обозначения модели', unit: 'наличие' },
    { group: 'Общие сведения', name: 'Комплект поставки', value: 'изделие, адаптер питания и документация', unit: 'комплект' },
    { group: 'Общие сведения', name: 'Оперативная память', value: 'не менее 16 ГБ', unit: 'ГБ' },
  ]
);

if (goodsBoilerplateSanitized.length !== 1 || goodsBoilerplateSanitized[0].name !== 'Оперативная память') {
  console.error('FAIL compliance sanitizer should drop procurement boilerplate from product specs');
  console.error(JSON.stringify(goodsBoilerplateSanitized, null, 2));
  process.exit(1);
}

const softwareSanitized = sanitizeProcurementSpecs(
  { type: 'os', model: 'Astra Linux Special Edition' },
  [
    { group: 'Совместимость', name: 'Совместимость с экосистемой Astra', value: 'ALD Pro, Брест, Termidesk, RuPost, RuBackup или эквивалентные решения', unit: 'совместимость' },
    { group: 'Совместимость', name: 'Поддержка веб-браузеров', value: 'совместимость с Яндекс.Браузером, Chromium или эквивалентными браузерами', unit: 'совместимость' },
    { group: 'Администрирование', name: 'Удалённое администрирование', value: 'SSH', unit: 'протокол' },
    { group: 'Сетевые возможности', name: 'Доменная аутентификация', value: 'поддержка LDAP, Kerberos и интеграции со службой каталогов ALD Pro или эквивалентной', unit: 'наличие' },
  ]
);

if (softwareSanitized.some((spec) => spec.name === 'Удалённое администрирование')) {
  console.error('FAIL compliance sanitizer should drop remote administration boilerplate from final software specs');
  console.error(JSON.stringify(softwareSanitized, null, 2));
  process.exit(1);
}

const ecosystemSpec = softwareSanitized.find((spec) => spec.name === 'Совместимость с экосистемой Astra');
if (!ecosystemSpec || /ALD Pro|Брест|Termidesk|RuPost|RuBackup/i.test(ecosystemSpec.value)) {
  console.error('FAIL compliance sanitizer should neutralize branded software ecosystem compatibility');
  console.error(JSON.stringify(softwareSanitized, null, 2));
  process.exit(1);
}

const browserSpec = softwareSanitized.find((spec) => spec.name === 'Поддержка веб-браузеров');
if (!browserSpec || /Яндекс|Chromium/i.test(browserSpec.value)) {
  console.error('FAIL compliance sanitizer should neutralize branded browser compatibility');
  console.error(JSON.stringify(softwareSanitized, null, 2));
  process.exit(1);
}

const authSpec = softwareSanitized.find((spec) => spec.name === 'Доменная аутентификация');
if (!authSpec || /ALD Pro/i.test(authSpec.value)) {
  console.error('FAIL compliance sanitizer should neutralize branded directory-service compatibility');
  console.error(JSON.stringify(softwareSanitized, null, 2));
  process.exit(1);
}

console.log('PASS compliance sanitizer drops identity, vendor-copy and service-noise fields');
