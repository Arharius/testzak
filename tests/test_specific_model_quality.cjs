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
  { name: 'Удалённое администрирование / мониторинг состояния', value: 'наличие штатных средств диагностики, мониторинга и контроля аппаратного состояния', unit: 'наличие' },
  { name: 'Поддержка модернизации и замены компонентов', value: 'наличие доступа к обслуживаемым компонентам и возможности штатной модернизации в рамках платформы', unit: 'наличие' },
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

const batteryGenericSpecs = [
  { name: 'Тип элемента питания', value: 'по типу товара', unit: '' },
  { name: 'Типоразмер', value: 'по требованиям Заказчика', unit: '' },
  { name: 'Напряжение', value: 'не менее 1.5 В', unit: 'В' },
  { name: 'Количество в упаковке', value: 'в количестве, достаточном для эксплуатации', unit: 'шт' },
  { name: 'Состояние товара', value: 'новый, не бывший в эксплуатации', unit: '' },
  { name: 'Упаковка', value: 'заводская упаковка', unit: '' },
  { name: 'Маркировка и идентификация', value: 'наличие заводской маркировки', unit: '' },
];

const batteryExactSpecs = [
  { name: 'Тип элемента питания', value: 'щелочная батарейка', unit: '' },
  { name: 'Типоразмер', value: 'AA / LR6', unit: '' },
  { name: 'Напряжение', value: '1.5 В', unit: 'В' },
  { name: 'Ёмкость', value: 'не менее 2850 мАч', unit: 'мАч' },
  { name: 'Количество в упаковке', value: '4 шт.', unit: 'шт' },
  { name: 'Срок хранения', value: 'до 10 лет', unit: 'лет' },
  { name: 'Химическая система', value: 'алкалиновая', unit: '' },
];

const paperExactSpecs = [
  { name: 'Количество слоев', value: '3 слоя', unit: '' },
  { name: 'Количество рулонов в упаковке', value: '8 рулонов', unit: 'рулон' },
  { name: 'Длина намотки рулона', value: 'не менее 18 м', unit: 'м' },
  { name: 'Количество листов в рулоне', value: 'не менее 150 листов', unit: 'лист' },
  { name: 'Состав', value: '100% первичная целлюлоза', unit: '' },
  { name: 'Цвет', value: 'белый', unit: '' },
  { name: 'Тиснение', value: 'тиснение и перфорация', unit: '' },
];

const msiVendorSpecs = [
  { name: 'Чипсет', value: 'H610', unit: '' },
  { name: 'Объем оперативной памяти', value: '16GB(8GB*2)', unit: '' },
  { name: 'Тип оперативной памяти', value: 'DDR5 SDRAM', unit: '' },
  { name: 'Процессор', value: 'Intel Core i7 Processor 14700', unit: '' },
  { name: 'Количество ядер процессора', value: '20', unit: '' },
  { name: 'Количество потоков процессора', value: '28', unit: '' },
  { name: 'Объем SSD', value: '512GB', unit: '' },
  { name: 'Беспроводные интерфейсы', value: 'Wi-Fi 6E+BT', unit: '' },
  { name: 'Порт Ethernet RJ-45', value: '1', unit: '' },
  { name: 'Порт HDMI', value: '1x (v2.1)', unit: '' },
  { name: 'Порт DisplayPort', value: '1x (v1.4)', unit: '' },
  { name: 'Масса нетто', value: '1.27', unit: '' },
  { name: 'Размеры корпуса', value: '204 x 208 x 54.8', unit: '' },
];

const keyboardMouseSetExactSpecs = [
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

const cableTesterExactSpecs = [
  { name: 'Тип устройства', value: 'Многофункциональный кабельный тестер', unit: '' },
  { name: 'Тестируемые типы кабелей', value: 'Витая пара (UTP, FTP, STP), телефонный кабель', unit: '' },
  { name: 'Категории кабелей', value: 'Cat.5, Cat.5e, Cat.6', unit: '' },
  { name: 'Тестируемые разъемы', value: 'RJ-45, RJ-11, RJ-12', unit: '' },
  { name: 'Функции тестирования', value: 'Обрыв, короткое замыкание, неверная пара, перепутанные пары, экранирование', unit: '' },
  { name: 'Дальность тестирования', value: 'не менее 300', unit: 'м' },
  { name: 'Тип индикации', value: 'Светодиодная (LED) и/или ЖК-дисплей', unit: '' },
  { name: 'Удаленный модуль', value: 'В комплекте', unit: '' },
  { name: 'Питание', value: 'Батарейки типа AAA или эквивалент', unit: '' },
  { name: 'Комплектность', value: 'Тестер, удаленный модуль, элементы питания, документация', unit: '' },
];

let failed = 0;

if (!mod.isWeakExactModelSpec(genericSpecs[0])) {
  failed += 1;
  console.error('FAIL generic processor spec should be weak');
} else {
  console.log('PASS generic processor spec is weak');
}

if (!mod.isWeakExactModelSpec(genericSpecs[6]) || !mod.isWeakExactModelSpec(genericSpecs[7])) {
  failed += 1;
  console.error('FAIL generic operational specs should be weak');
} else {
  console.log('PASS generic operational specs are weak');
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

if (mod.hasSufficientExactModelCoverage(batteryGenericSpecs)) {
  failed += 1;
  console.error('FAIL generic battery spec pack should be rejected');
} else {
  console.log('PASS generic battery spec pack is rejected');
}

if (!mod.hasSufficientExactModelCoverage(batteryExactSpecs)) {
  failed += 1;
  console.error('FAIL exact battery spec pack should be accepted');
} else {
  console.log('PASS exact battery spec pack is accepted');
}

if (!mod.hasSufficientExactModelCoverage(paperExactSpecs)) {
  failed += 1;
  console.error('FAIL exact household paper spec pack should be accepted');
} else {
  console.log('PASS exact household paper spec pack is accepted');
}

if (!mod.hasSufficientExactModelCoverage(msiVendorSpecs)) {
  failed += 1;
  console.error('FAIL MSI vendor spec pack should be accepted');
} else {
  console.log('PASS MSI vendor spec pack is accepted');
}

if (!mod.hasSufficientExactModelCoverage(keyboardMouseSetExactSpecs)) {
  failed += 1;
  console.error('FAIL keyboard/mouse set exact spec pack should be accepted');
} else {
  console.log('PASS keyboard/mouse set exact spec pack is accepted');
}

if (!mod.hasSufficientExactModelCoverage(cableTesterExactSpecs)) {
  failed += 1;
  console.error('FAIL cable tester exact spec pack should be accepted');
} else {
  console.log('PASS cable tester exact spec pack is accepted');
}

if (failed > 0) process.exit(1);
