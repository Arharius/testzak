#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const tsSource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend-react', 'src', 'utils', 'model-quality.ts'),
  'utf-8'
);

let js = tsSource.replace(/^import .*$/gm, '');
js = js.replace(/^export /gm, '');
js = js.replace(/: Pick<SpecItem, 'name' \| 'value'>/g, '');
js = js.replace(/: SpecItem\[]/g, '');
js = js.replace(/: number/g, '');
js = js.replace(/: boolean/g, '');
js = js.replace(/: string/g, '');
js = js.replace(/\((spec)\) =>/g, '($1) =>');

const mod = eval(`(function(){ ${js}; return { isWeakExactModelSpec, hasSufficientExactModelCoverage }; })()`);

const genericSpecs = [
  { name: 'Процессор', value: 'Количество вычислительных ядер не менее 4; архитектура и частотные параметры по требованиям Заказчика', unit: '' },
  { name: 'Оперативная память', value: 'не менее 8 ГБ', unit: 'ГБ' },
  { name: 'Тип и объем накопителя', value: 'SSD и/или HDD; суммарный объем не менее 256 ГБ', unit: '' },
  { name: 'Графическая подсистема', value: 'Интегрированный и/или дискретный графический адаптер по типу товара', unit: '' },
  { name: 'Сетевые интерфейсы', value: 'Ethernet 1 Гбит/с и/или беспроводные интерфейсы по требованиям Заказчика', unit: '' },
  { name: 'Порты подключения', value: 'USB, видеоинтерфейсы и аудиоразъёмы в количестве, достаточном для эксплуатации', unit: '' },
  { name: 'Состояние товара', value: 'новый, не бывший в эксплуатации', unit: '' },
  { name: 'Упаковка', value: 'заводская упаковка', unit: '' },
  { name: 'Маркировка и идентификация', value: 'наличие заводской маркировки', unit: '' },
  { name: 'Документация на русском языке', value: 'наличие паспорта и руководства пользователя', unit: '' },
];

const exactSpecs = [
  { name: 'Процессор', value: 'не менее 10 ядер / 16 потоков, максимальная частота не менее 4.7 ГГц', unit: '' },
  { name: 'Оперативная память', value: 'не менее 16 ГБ DDR4-3200', unit: 'ГБ' },
  { name: 'Накопитель', value: 'SSD NVMe не менее 512 ГБ', unit: 'ГБ' },
  { name: 'Графическая подсистема', value: 'интегрированная графика Intel UHD', unit: '' },
  { name: 'Сетевой интерфейс', value: 'Ethernet RJ-45 1 Гбит/с', unit: '' },
  { name: 'Беспроводные интерфейсы', value: 'Wi‑Fi 6, Bluetooth 5.2', unit: '' },
  { name: 'Порты USB', value: 'не менее 6 портов USB, из них не менее 2 USB 3.2', unit: 'порт' },
  { name: 'Видеовыходы', value: 'HDMI и DisplayPort', unit: '' },
  { name: 'Размеры корпуса', value: 'не более 204 x 208 x 54.8 мм', unit: 'мм' },
  { name: 'Масса', value: 'не более 1.27 кг', unit: 'кг' },
];

let failed = 0;

if (!mod.isWeakExactModelSpec(genericSpecs[0])) {
  failed += 1;
  console.error('FAIL generic processor spec should be weak');
} else {
  console.log('PASS generic processor spec is weak');
}

if (mod.hasSufficientExactModelCoverage(genericSpecs)) {
  failed += 1;
  console.error('FAIL generic spec pack should be rejected');
} else {
  console.log('PASS generic spec pack is rejected');
}

if (!mod.hasSufficientExactModelCoverage(exactSpecs)) {
  failed += 1;
  console.error('FAIL exact spec pack should be accepted');
} else {
  console.log('PASS exact spec pack is accepted');
}

if (failed > 0) process.exit(1);
