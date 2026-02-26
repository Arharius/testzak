import { useMemo, useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import { generateItemSpecs, postPlatformDraft, sendEventThroughBestChannel } from '../lib/api';
import { appendAutomationLog } from '../lib/storage';
import type { AutomationSettings, PlatformIntegrationSettings } from '../types/schemas';
import { GOODS_CATALOG, GOODS_GROUPS, detectGoodsType, type GoodsItem, type HardSpec } from '../data/goods-catalog';
import { postProcessSpecs, parseAiResponse, type SpecItem } from '../utils/spec-processor';
import { buildSection2Rows, buildSection4Rows, buildSection5Rows, type LawMode } from '../utils/npa-blocks';

type Provider = 'openrouter' | 'groq' | 'deepseek';

interface GoodsRow {
  id: number;
  type: string;
  model: string;
  qty: number;
  status: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
  specs?: SpecItem[];
  meta?: Record<string, string>;
  // Яндекс-подсказки и ссылки ЕИС (хранятся в отдельном state, не здесь)
}

// ── Промпты по типу товара ────────────────────────────────────────────────────
function buildPrompt(row: GoodsRow, lawMode: LawMode): string {
  const g = GOODS_CATALOG[row.type] ?? GOODS_CATALOG['pc'];
  const goodsName = g.name;
  const okpd2 = g.okpd2;
  const ktru = g.ktruFixed ?? '';
  const law = lawMode === '223' ? '223-ФЗ' : '44-ФЗ';
  const isSW = !!g.isSoftware;

  const specHints: Record<string, string> = {
    pc:         '- Корпус (тип, цвет)\n- Процессор (тип, кол-во ядер, частота, кэш)\n- Оперативная память (тип, объём, частота)\n- Накопитель (тип SSD/HDD, объём)\n- Видеокарта (тип, видеопамять)\n- Интерфейсы (USB, HDMI, Ethernet, аудио)\n- Сетевые интерфейсы (Ethernet, Wi-Fi, Bluetooth)\n- Блок питания (мощность)',
    laptop:     '- Экран (диагональ, разрешение, тип матрицы)\n- Процессор (модель, кол-во ядер, частота)\n- Оперативная память (тип, объём)\n- Накопитель (тип SSD, объём)\n- Видеокарта (тип)\n- Аккумулятор (ёмкость, время работы)\n- Интерфейсы (USB, HDMI, Wi-Fi, Bluetooth)\n- Вес, габариты',
    server:     '- Форм-фактор (Tower/1U/2U)\n- Процессор (кол-во сокетов, модель)\n- Оперативная память (тип, объём, слоты)\n- Накопители (тип, объём, кол-во)\n- RAID-контроллер\n- Сетевые интерфейсы (кол-во, скорость)\n- Блок питания (мощность, резервирование)\n- Управление (IPMI/Redfish)',
    monitor:    '- Диагональ (дюймы)\n- Разрешение\n- Тип матрицы\n- Яркость (кд/м²)\n- Контрастность\n- Время отклика (мс)\n- Угол обзора\n- Интерфейсы (HDMI, DisplayPort, VGA)\n- Потребляемая мощность',
    printer:    '- Тип печати (лазерный/струйный)\n- Цветность\n- Формат бумаги\n- Скорость печати (стр/мин)\n- Разрешение печати (dpi)\n- Ресурс картриджа\n- Интерфейсы (USB, Ethernet, Wi-Fi)\n- Память (МБ)',
    mfu:        '- Функции (печать, копирование, сканирование, факс)\n- Формат бумаги\n- Скорость печати (стр/мин)\n- Разрешение печати (dpi)\n- Разрешение сканирования (dpi)\n- Интерфейсы (USB, Ethernet, Wi-Fi)\n- Объём памяти (МБ)',
    switch:     '- Кол-во портов Ethernet (скорость)\n- Кол-во uplink-портов SFP\n- Управляемость (managed/unmanaged)\n- Поддержка PoE (мощность)\n- Пропускная способность\n- Таблица MAC-адресов\n- Протоколы (VLAN, STP, SNMP)\n- Монтаж (rack/desktop)',
    router:     '- Кол-во WAN-портов\n- Кол-во LAN-портов\n- Пропускная способность\n- Поддерживаемые протоколы маршрутизации\n- NAT, VPN (IPsec, PPTP, L2TP)\n- QoS\n- Процессор, память',
    firewall:   '- Пропускная способность межсетевого экрана (Гбит/с)\n- Кол-во портов Ethernet\n- Функциональность NGFW (IPS, DPI, URL-фильтрация)\n- VPN-туннели\n- Производительность IPS\n- Возможности управления\n- Сертификат ФСТЭК',
    os:         '- Тип ОС (десктоп/серверная)\n- Версия / релиз\n- Поддерживаемые платформы (x86_64, ARM)\n- Тип ядра\n- Наличие в реестре Минцифры\n- Тип лицензии\n- Срок поддержки\n- Поставка (количество лицензий / серверов)',
    office:     '- Состав пакета (текстовый редактор, таблицы, презентации, почта)\n- Форматы файлов (OOXML, ODF)\n- Наличие в реестре Минцифры\n- Тип лицензии (perpetual/подписка)\n- Кол-во рабочих мест\n- Платформы (Windows, Linux)',
    antivirus:  '- Тип защиты (файловый антивирус, проактивная защита, EDR)\n- Количество защищаемых устройств\n- ОС (Windows, Linux, macOS)\n- Тип управления (централизованное/локальное)\n- Наличие в реестре Минцифры\n- Наличие сертификата ФСТЭК\n- Срок лицензии',
    dbms:       '- Тип СУБД (реляционная, NoSQL)\n- Поддерживаемые ОС\n- Тип лицензии\n- Кол-во ядер / серверов\n- Поддержка PostgreSQL-синтаксиса\n- Наличие в реестре Минцифры\n- Функции резервного копирования\n- SLA поддержки',
    crypto:     '- Класс СКЗИ (КС1/КС2/КС3)\n- Поддерживаемые алгоритмы (ГОСТ Р 34.10-2012, ГОСТ Р 34.11-2012)\n- Тип поставки (ПО / аппаратный токен)\n- Количество лицензий\n- Поддерживаемые ОС\n- Наличие сертификата ФСБ России\n- Наличие в реестре Минцифры',
    vdi:        '- Количество виртуальных рабочих мест (лицензий)\n- Поддерживаемые гипервизоры\n- Поддерживаемые гостевые ОС\n- Протоколы доступа (RDP, PCoIP, Blast)\n- Функции управления профилями пользователей\n- Наличие в реестре Минцифры\n- Наличие сертификата ФСТЭК\n- Тип лицензии',
  };

  const hint = specHints[row.type]
    ?? (isSW ? '- Тип и версия ПО\n- Количество лицензий\n- Поддерживаемые ОС\n- Тип лицензии\n- Наличие в реестре Минцифры\n- Срок технической поддержки'
             : '- Основные технические характеристики (5–10 параметров)\n- Интерфейсы и совместимость\n- Потребляемая мощность и массогабаритные параметры');

  return `Ты — эксперт по госзакупкам РФ (${law}, ст. 33 44-ФЗ).
Сформируй технические характеристики для товара по ${law}.

Тип товара: ${goodsName}
Модель/описание: ${row.model}
Количество: ${row.qty} шт.
ОКПД2: ${okpd2}${ktru ? '\nКТРУ: ' + ktru : ''}

Требования к ответу:
- Все технические марки (Intel, AMD, Samsung и т.д.) сопровождать «или эквивалент»
- Числовые значения с операторами: писать «не менее X» (а не ">= X")
- Тип матрицы: «IPS или эквивалент (угол обзора не менее 178°)»
- Разрешение: «не менее 1920x1080» (не точное значение)
- Единицы измерения: ГГц, МГц, ГБ, МБ, ТБ (не GHz/GB/MB)
- Сокеты процессора НЕ УКАЗЫВАТЬ (нарушает ст. 33 44-ФЗ)
- Для ОП: «DDR4 или выше» (не просто DDR4)
${isSW ? '- ПО должно быть в реестре Минцифры России (ПП РФ № 1236)\n- Указать класс ФСТЭК/ФСБ где применимо' : ''}

Характеристики для включения:
${hint}

Ответ СТРОГО в JSON (без пояснений, без markdown):
{
  "meta": {
    "okpd2_code": "${okpd2}",
    "okpd2_name": "${g.okpd2name}",
    "ktru_code": "${ktru}",
    "nac_regime": "${(['os','office','antivirus','crypto','dbms','erp','virt','vdi','backup_sw','dlp','siem','firewall_sw','edr','waf','pam','iam','pki','email','vks','ecm','portal','project_sw','bpm','itsm','monitoring','mdm','hr','gis','ldap','vpn','reporting','cad','license']).includes(row.type) ? 'pp1236' : 'pp878'}",
    "law175_status": "exempt",
    "law175_basis": ""
  },
  "specs": [
    {"group":"Название группы","name":"Наименование характеристики","value":"Значение","unit":"Ед.изм."}
  ]
}`;
}

// ── Список типов ПО для определения нацрежима ────────────────────────────────
const SW_PROMPT_TYPES = ['os','office','antivirus','crypto','dbms','erp','virt','vdi','backup_sw',
  'dlp','siem','firewall_sw','edr','waf','pam','iam','pki','email','vks','ecm','portal',
  'project_sw','bpm','itsm','monitoring','mdm','hr','gis','ldap','vpn','reporting','cad','license'];

// ── Промпт: поиск реальных характеристик конкретной модели через ИИ ───────────
function buildSpecSearchPrompt(row: GoodsRow, g: GoodsItem): string {
  const nac = SW_PROMPT_TYPES.includes(row.type) ? 'pp1236' : 'pp878';
  return `Ты — эксперт по ИТ-оборудованию и ПО. Найди точные технические характеристики конкретного товара.

Товар (точное название / модель): "${row.model}"
Тип: ${g.name}
ОКПД2: ${g.okpd2}

Задача: укажи реальные характеристики именно этой модели, как указаны у производителя (или ближайшего аналога по классу).

Правила формулировок (44-ФЗ, ст. 33):
- Торговые марки (Intel, AMD, Samsung...) → добавлять «или эквивалент»
- Числа: «не менее X» (не «>= X»)
- Единицы: ГГц, МГц, ГБ, МБ, ТБ (не GHz/GB/MB)
- Тип матрицы: «IPS или эквивалент (угол обзора не менее 178°)»
- Разрешение: «не менее 1920x1080»
- Сокеты процессора — НЕ УКАЗЫВАТЬ
- Для ОП: «DDR4 или выше»${g.isSoftware ? '\n- ПО: наличие в реестре Минцифры России (ПП РФ № 1236)' : ''}

Ответ СТРОГО в JSON без пояснений и без markdown:
{"meta":{"okpd2_code":"${g.okpd2}","okpd2_name":"${g.okpd2name}","ktru_code":"${g.ktruFixed ?? ''}","nac_regime":"${nac}","law175_status":"exempt","law175_basis":""},"specs":[{"group":"Группа","name":"Характеристика","value":"Значение","unit":""}]}`;
}

// ── Извлечь текст из HTML ЕИС (через DOMParser) ───────────────────────────────
function extractEisText(html: string): string {
  if (!html) return '';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, nav, footer, header').forEach((el) => el.remove());
    const body = doc.querySelector('main') ?? doc.body;
    const text = (body?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return text.slice(0, 1500);
  } catch {
    return '';
  }
}

// ── Промпт: генерация ТЗ в стиле реальных закупок ЕИС ────────────────────────
function buildEisStylePrompt(row: GoodsRow, g: GoodsItem, eisContext: string): string {
  const nac = SW_PROMPT_TYPES.includes(row.type) ? 'pp1236' : 'pp878';
  const ctx = eisContext
    ? `\nКонтекст из ЕИС (zakupki.gov.ru) — используй как образец реальных требований:\n---\n${eisContext}\n---`
    : '\n(Контекст ЕИС недоступен — используй знания о типичных ТЗ из реестра ЕИС для данного класса товаров)';
  return `Ты — эксперт по госзакупкам РФ. Составь ТЗ для закупки по 44-ФЗ в стиле реальных документов ЕИС (zakupki.gov.ru).

Запрос пользователя: "${row.model}"
Тип товара: ${g.name}
ОКПД2: ${g.okpd2}
${ctx}

Требования к ТЗ:
- Реалистичные характеристики для российского рынка поставщиков
- Торговые марки → «или эквивалент»
- Числа: «не менее X»
- Единицы: ГГц, МГц, ГБ, МБ, ТБ
- Сокеты процессора НЕ УКАЗЫВАТЬ${g.isSoftware ? '\n- ПО: реестр Минцифры (ПП РФ № 1236), сертификаты ФСТЭК/ФСБ где применимо' : ''}
- 10–20 параметров для оборудования, 8–15 для ПО

Ответ СТРОГО в JSON без пояснений и markdown:
{"meta":{"okpd2_code":"${g.okpd2}","okpd2_name":"${g.okpd2name}","ktru_code":"${g.ktruFixed ?? ''}","nac_regime":"${nac}","law175_status":"exempt","law175_basis":""},"specs":[{"group":"Группа","name":"Характеристика","value":"Значение","unit":""}]}`;
}

// ── Вспомогательные функции DOCX ─────────────────────────────────────────────
const FONT = 'Times New Roman';
const FONT_SIZE = 22; // half-points → 11pt

function cellShade(fill: string) {
  return { fill, type: ShadingType.CLEAR, color: 'auto' };
}

function hCell(text: string, opts: { span?: number; w?: number } = {}) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, font: FONT, size: FONT_SIZE, color: 'FFFFFF' })],
      alignment: AlignmentType.CENTER,
    })],
    columnSpan: opts.span,
    width: opts.w ? { size: opts.w, type: WidthType.DXA } : undefined,
    shading: cellShade('1F5C8B'),
    verticalAlign: VerticalAlign.CENTER,
    borders: allBorders(),
  });
}

function dataCell(text: string, opts: { bold?: boolean; shade?: string; span?: number; w?: number } = {}) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: opts.bold, font: FONT, size: FONT_SIZE })],
    })],
    columnSpan: opts.span,
    width: opts.w ? { size: opts.w, type: WidthType.DXA } : undefined,
    shading: opts.shade ? cellShade(opts.shade) : undefined,
    borders: allBorders(),
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
  });
}

function labelCell(text: string, isLaw = false) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, font: FONT, size: FONT_SIZE, color: isLaw ? 'B45309' : '1F2937' })],
    })],
    width: { size: 35, type: WidthType.PERCENTAGE },
    shading: isLaw ? cellShade('FFFBEB') : undefined,
    borders: allBorders(),
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
  });
}

// Ячейка левой колонки раздела 1 (синяя заливка EEF2FF, как в образце)
function s1LabelCell(text: string) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, font: FONT, size: FONT_SIZE, color: '1F2937' })],
    })],
    width: { size: 35, type: WidthType.PERCENTAGE },
    shading: cellShade('EEF2FF'),
    borders: allBorders(),
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
  });
}

function valueCell(text: string, isLaw = false) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, font: FONT, size: FONT_SIZE })],
    })],
    shading: isLaw ? cellShade('FFFBEB') : undefined,
    borders: allBorders(),
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
  });
}

function allBorders() {
  const b = { style: BorderStyle.SINGLE, size: 4, color: 'A0AEC0' };
  return { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
}

function sectionTitle(text: string) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, font: FONT, size: 26 })],
    spacing: { before: 240, after: 120 },
  });
}

function numText(n: number): string {
  const ones = ['','один','два','три','четыре','пять','шесть','семь','восемь','девять',
                 'десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать',
                 'шестнадцать','семнадцать','восемнадцать','девятнадцать'];
  const tens = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
  if (n === 0) return 'ноль';
  if (n < 20) return ones[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return tens[t] + (o ? ' ' + ones[o] : '');
}

// ── Функция генерации DOCX ────────────────────────────────────────────────────
async function buildDocx(rows: GoodsRow[], lawMode: LawMode): Promise<Blob> {
  const doneRows = rows.filter((r) => r.status === 'done' && r.specs);
  if (doneRows.length === 0) throw new Error('Нет готовых позиций для экспорта');

  const children: (Paragraph | Table)[] = [];

  const goodsNames = doneRows.length === 1
    ? (GOODS_CATALOG[doneRows[0].type]?.name ?? doneRows[0].type)
    : doneRows.map((r) => GOODS_CATALOG[r.type]?.name ?? r.type).join(', ');

  // ── Заголовок (по образцу) ──
  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'Приложение к документации о закупке', font: FONT, size: 18, color: '6B7280' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
    }),
    new Paragraph({ children: [], spacing: { after: 80 } }),
    new Paragraph({
      children: [new TextRun({ text: 'ТЕХНИЧЕСКОЕ ЗАДАНИЕ', bold: true, font: FONT, size: 28, color: '1F2937' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `на поставку товара: ${goodsNames}`, font: FONT, size: 20, color: '6B7280' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
  );

  // ── Раздел 1 ──
  children.push(sectionTitle('1. Наименование объекта закупки'));

  const currentYear = new Date().getFullYear();

  if (doneRows.length === 1) {
    const row = doneRows[0];
    const g = GOODS_CATALOG[row.type] ?? GOODS_CATALOG['pc'];
    const meta = row.meta ?? {};
    const okpd2Code = meta.okpd2_code || g.okpd2;
    const okpd2Name = meta.okpd2_name || g.okpd2name;
    const ktru = meta.ktru_code || g.ktruFixed || '';
    const isSW = !!g.isSoftware;
    const okeiStr = isSW ? '2805 — экземпляр' : '796 — штука';
    const dateRow = isSW
      ? `Не ранее ${currentYear} года (текущая актуальная версия на дату поставки)`
      : `Не ранее 1 января ${currentYear} г.`;

    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [s1LabelCell('Наименование объекта поставки'), valueCell(g.name)] }),
        ...(row.model ? [new TableRow({ children: [s1LabelCell('Модель / описание'), valueCell(row.model)] })] : []),
        new TableRow({ children: [s1LabelCell('Код ОКПД2'), valueCell(`${okpd2Code} — ${okpd2Name}`)] }),
        new TableRow({ children: [s1LabelCell('Код КТРУ'), valueCell(ktru || 'Уточняется при размещении в ЕИС')] }),
        new TableRow({ children: [s1LabelCell('Единица измерения (ОКЕИ)'), valueCell(okeiStr)] }),
        new TableRow({ children: [s1LabelCell('Количество'), valueCell(`${row.qty} (${numText(row.qty)}) ${isSW ? 'лицензий' : 'штук'}`)] }),
        new TableRow({ children: [s1LabelCell(isSW ? 'Дата версии / поставки' : 'Дата выпуска товара'), valueCell(dateRow)] }),
      ],
    }));
  } else {
    // Сводная таблица для нескольких позиций
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [
          hCell('№', { w: 500 }),
          hCell('Наименование товара'),
          hCell('Модель / описание'),
          hCell('ОКПД2', { w: 1800 }),
          hCell('КТРУ', { w: 2400 }),
          hCell('Кол-во', { w: 800 }),
        ]}),
        ...doneRows.map((row, idx) => {
          const g = GOODS_CATALOG[row.type] ?? GOODS_CATALOG['pc'];
          const meta = row.meta ?? {};
          return new TableRow({ children: [
            dataCell(String(idx + 1), { w: 500 }),
            dataCell(g.name),
            dataCell(row.model),
            dataCell(meta.okpd2_code || g.okpd2, { w: 1800 }),
            dataCell(meta.ktru_code || g.ktruFixed || '—', { w: 2400 }),
            dataCell(String(row.qty), { w: 800 }),
          ]});
        }),
      ],
    }));
  }

  // ── Разделы 2, 3, 4, 5 — для каждой позиции ──
  for (let i = 0; i < doneRows.length; i++) {
    const row = doneRows[i];
    const g = GOODS_CATALOG[row.type] ?? GOODS_CATALOG['pc'];
    const meta = row.meta ?? {};
    const prefix = doneRows.length > 1 ? ` — позиция ${i + 1}: ${g.name}` : '';

    // ── Раздел 2 ──
    const sec2rows = buildSection2Rows(row.type, meta, lawMode);
    children.push(sectionTitle(`2. Требования к качеству, безопасности и поставке${prefix}`));
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: sec2rows.map(([k, v]) => {
        const isLaw = k.includes('⚖️');
        return new TableRow({ children: [labelCell(k, isLaw), valueCell(v, isLaw)] });
      }),
    }));

    // ── Раздел 3: характеристики ──
    children.push(sectionTitle(`3. Технические и функциональные характеристики${prefix}`));
    const okpd2Code = meta.okpd2_code || g.okpd2;
    const okpd2Name = meta.okpd2_name || g.okpd2name;
    const ktru = meta.ktru_code || g.ktruFixed || '';
    children.push(new Paragraph({
      children: [new TextRun({
        text: `ОКПД2: ${okpd2Code} — ${okpd2Name}${ktru ? '  |  КТРУ: ' + ktru : ''}`,
        font: FONT, size: 20, italics: true,
      })],
      spacing: { after: 80 },
    }));

    const specs = row.specs ?? [];
    if (specs.length > 0) {
      let rowNum = 0;
      let curGroup = '';
      const specTableRows: TableRow[] = [
        new TableRow({
          tableHeader: true,
          height: { value: 400, rule: HeightRule.ATLEAST },
          children: [
            hCell('№', { w: 400 }),
            hCell('Наименование характеристики', { w: 3200 }),
            hCell('Значение / требование', { w: 3800 }),
            hCell('Ед. изм.', { w: 1000 }),
          ],
        }),
      ];

      for (const spec of specs) {
        // Групповой заголовок
        if (spec.group && spec.group !== curGroup) {
          curGroup = spec.group;
          specTableRows.push(new TableRow({
            children: [new TableCell({
              columnSpan: 4,
              children: [new Paragraph({
                children: [new TextRun({ text: curGroup, bold: true, font: FONT, size: FONT_SIZE })],
                alignment: AlignmentType.CENTER,
              })],
              shading: cellShade('C7D2FE'),
              borders: allBorders(),
              margins: { top: 40, bottom: 40, left: 80, right: 80 },
            })],
          }));
        }
        rowNum++;
        const hasWarning = !!spec._warning;
        const valText = String(spec.value ?? '') + (hasWarning ? ' ⚠️ ' + String(spec._warning) : '');
        specTableRows.push(new TableRow({
          children: [
            dataCell(String(rowNum), { w: 400 }),
            dataCell(String(spec.name ?? ''), { w: 3200 }),
            dataCell(valText, { w: 3800 }),
            dataCell(String(spec.unit ?? ''), { w: 1000 }),
          ],
        }));
      }

      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: specTableRows,
      }));
    }

    // ── Раздел 4 ──
    const sec4rows = buildSection4Rows(row.type, lawMode);
    const sec4title = g.isSoftware
      ? `4. Требования к поставке и технической поддержке${prefix}`
      : `4. Требования к гарантийному обслуживанию и поставке${prefix}`;
    children.push(sectionTitle(sec4title));
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: sec4rows.map(([k, v]) => new TableRow({
        children: [labelCell(k), valueCell(v)],
      })),
    }));

    // ── Раздел 5 ──
    const sec5rows = buildSection5Rows(row.type, lawMode);
    children.push(sectionTitle(`5. Иные требования${prefix}`));
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: sec5rows.map(([k, v]) => new TableRow({
        children: [labelCell(k), valueCell(v)],
      })),
    }));
  }

  // ── Подписи ──
  children.push(
    new Paragraph({ children: [], spacing: { before: 480 } }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({ children: [
        dataCell('Заказчик:  _________________________ / _________________________', { w: 6000 }),
        dataCell('Дата:  «____» ________________ 20__ г.', { w: 3400 }),
      ]})],
    }),
  );

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: FONT_SIZE },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1134, bottom: 1134, left: 1800, right: 850 },
        },
      },
      children,
    }],
  });

  return Packer.toBlob(doc);
}

// ── Компонент ─────────────────────────────────────────────────────────────────
type Props = {
  automationSettings: AutomationSettings;
  platformSettings: PlatformIntegrationSettings;
};

export function Workspace({ automationSettings, platformSettings }: Props) {
  const [lawMode, setLawMode] = useState<LawMode>('44');
  const [provider, setProvider] = useState<Provider>('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('deepseek-chat');
  const [rows, setRows] = useState<GoodsRow[]>([{ id: 1, type: 'pc', model: '', qty: 1, status: 'idle' }]);
  const [docxReady, setDocxReady] = useState(false);

  // Общий статус поиска по ЕИС
  const [eisSearching, setEisSearching] = useState(false);
  // Общий статус подтягивания из интернета
  const [internetSearching, setInternetSearching] = useState(false);

  const canGenerate = useMemo(
    () => apiKey.trim().length > 6 && rows.every((r) => r.model.trim().length > 0),
    [apiKey, rows]
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const next = [...rows];
      setDocxReady(false);
      for (let i = 0; i < next.length; i++) {
        next[i] = { ...next[i], status: 'loading', error: '' };
        setRows([...next]);
        const g = GOODS_CATALOG[next[i].type] ?? GOODS_CATALOG['pc'];
        // Если для типа товара есть жёсткий шаблон — пропускаем AI
        if (g.hardTemplate && g.hardTemplate.length > 0) {
          const specs = (g.hardTemplate as HardSpec[]).map((s) => ({ group: s.group, name: s.name, value: s.value, unit: s.unit ?? '' }));
          const meta: Record<string, string> = {
            okpd2_code: g.okpd2,
            okpd2_name: g.okpd2name,
            ktru_code: g.ktruFixed ?? '',
            nac_regime: 'pp616',
          };
          next[i] = { ...next[i], status: 'done', specs, meta };
          setRows([...next]);
          continue;
        }
        const prompt = buildPrompt(next[i], lawMode);
        try {
          const raw = await generateItemSpecs(provider, apiKey, model, prompt);
          const { meta, specs } = parseAiResponse(raw);
          const processed = postProcessSpecs(specs);
          next[i] = { ...next[i], status: 'done', specs: processed, meta };
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'generation_error';
          next[i] = { ...next[i], status: 'error', error: msg };
        }
        setRows([...next]);
      }

      const payload = {
        law: lawMode === '223' ? '223-FZ' : '44-FZ',
        profile: platformSettings.profile,
        organization: platformSettings.orgName,
        customerInn: platformSettings.customerInn,
        items: next.map((r) => ({
          type: r.type,
          model: r.model,
          qty: r.qty,
          status: r.status,
          okpd2: r.meta?.okpd2_code || GOODS_CATALOG[r.type]?.okpd2 || '',
          ktru: r.meta?.ktru_code || GOODS_CATALOG[r.type]?.ktruFixed || '',
        })),
      };

      if (automationSettings.autoSend) {
        await sendEventThroughBestChannel(automationSettings, 'tz.generated.react', payload);
      }
      if (platformSettings.autoSendDraft) {
        await postPlatformDraft(platformSettings.endpoint, platformSettings.apiToken, payload);
      }
      appendAutomationLog({ at: new Date().toISOString(), event: 'react.generate', ok: true, note: `rows=${next.length}` });
      setDocxReady(next.some((r) => r.status === 'done'));
    },
  });

  const addRow = () => {
    setRows((prev) => [...prev, { id: Date.now(), type: 'pc', model: '', qty: 1, status: 'idle' }]);
  };

  // ── Подтянуть реальные характеристики товара через ИИ ───────────────────────
  const enrichFromInternet = useCallback(async () => {
    const filledRows = rows.filter((r) => r.model.trim().length > 0);
    if (filledRows.length === 0) {
      alert('Заполните поле «Модель / описание» хотя бы в одной строке');
      return;
    }
    if (!apiKey.trim()) {
      alert('Введите API-ключ — он нужен для поиска характеристик через ИИ');
      return;
    }
    setInternetSearching(true);
    const next = [...rows];
    for (let i = 0; i < next.length; i++) {
      if (!next[i].model.trim()) continue;
      const g = GOODS_CATALOG[next[i].type] ?? GOODS_CATALOG['pc'];
      next[i] = { ...next[i], status: 'loading', error: '' };
      setRows([...next]);
      const prompt = buildSpecSearchPrompt(next[i], g);
      try {
        const raw = await generateItemSpecs(provider, apiKey, model, prompt);
        const { meta, specs } = parseAiResponse(raw);
        const processed = postProcessSpecs(specs);
        next[i] = { ...next[i], status: 'done', specs: processed, meta };
      } catch (e) {
        next[i] = { ...next[i], status: 'error', error: e instanceof Error ? e.message : 'error' };
      }
      setRows([...next]);
    }
    setInternetSearching(false);
    setDocxReady(next.some((r) => r.status === 'done'));
  }, [rows, apiKey, provider, model]);

  // ── Найти ТЗ в ЕИС: zapros на zakupki.gov.ru через CORS-прокси, адаптация через ИИ
  const searchZakupki = useCallback(async () => {
    const filledRows = rows.filter((r) => r.model.trim().length > 0);
    if (filledRows.length === 0) {
      alert('Заполните поле «Модель / описание» хотя бы в одной строке');
      return;
    }
    if (!apiKey.trim()) {
      alert('Введите API-ключ — он нужен для анализа ТЗ через ИИ');
      return;
    }
    setEisSearching(true);
    const next = [...rows];
    for (let i = 0; i < next.length; i++) {
      if (!next[i].model.trim()) continue;
      const g = GOODS_CATALOG[next[i].type] ?? GOODS_CATALOG['pc'];
      next[i] = { ...next[i], status: 'loading', error: '' };
      setRows([...next]);

      // Пробуем получить данные с zakupki.gov.ru через CORS-прокси allorigins.win
      let eisContext = '';
      try {
        const q = encodeURIComponent(`${next[i].model.trim()} ${g.name}`);
        const eisUrl = `https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString=${q}&morphology=on&fz44=on&sortBy=UPDATE_DATE&pageNumber=1&sortDirection=false&recordsPerPage=_5&showLotsInfoHidden=false`;
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(eisUrl)}`;
        const controller = new AbortController();
        const tid = window.setTimeout(() => controller.abort(), 12000);
        try {
          const resp = await fetch(proxyUrl, { signal: controller.signal });
          clearTimeout(tid);
          if (resp.ok) {
            const data = await resp.json() as { contents?: string };
            eisContext = extractEisText(data.contents ?? '');
          }
        } finally {
          clearTimeout(tid);
        }
      } catch {
        // прокси недоступен или zakupki.gov.ru заблокирован — ИИ сгенерирует по своим знаниям ЕИС
      }

      const prompt = buildEisStylePrompt(next[i], g, eisContext);
      try {
        const raw = await generateItemSpecs(provider, apiKey, model, prompt);
        const { meta, specs } = parseAiResponse(raw);
        const processed = postProcessSpecs(specs);
        next[i] = { ...next[i], status: 'done', specs: processed, meta };
      } catch (e) {
        next[i] = { ...next[i], status: 'error', error: e instanceof Error ? e.message : 'error' };
      }
      setRows([...next]);
    }
    setEisSearching(false);
    setDocxReady(next.some((r) => r.status === 'done'));
  }, [rows, apiKey, provider, model]);

  const exportDocx = async () => {
    try {
      const blob = await buildDocx(rows, lawMode);
      const date = new Date().toISOString().slice(0, 10);
      saveAs(blob, `TZ_${date}.docx`);
      appendAutomationLog({ at: new Date().toISOString(), event: 'react.export_docx', ok: true });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка экспорта DOCX');
    }
  };

  const exportPdf = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4', putOnlyUsedFonts: true });
    const margin = 40;
    const maxWidth = doc.internal.pageSize.getWidth() - margin * 2;
    let y = margin + 14;
    doc.setFontSize(11);

    const addLine = (text: string, bold = false) => {
      if (y > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin + 14; }
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      const lines = doc.splitTextToSize(text, maxWidth) as string[];
      lines.forEach((line: string) => {
        if (y > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin + 14; }
        doc.text(line, margin, y);
        y += 14;
      });
    };

    const law = lawMode === '223' ? '223-ФЗ' : '44-ФЗ';
    addLine(`ТЕХНИЧЕСКОЕ ЗАДАНИЕ (${law})`, true);
    addLine('');

    for (const row of rows.filter((r) => r.status === 'done' && r.specs)) {
      const g = GOODS_CATALOG[row.type] ?? GOODS_CATALOG['pc'];
      addLine(`\n=== ${g.name} — ${row.model} (${row.qty} шт.) ===`, true);

      // Раздел 2
      addLine('\n2. Требования к качеству и безопасности', true);
      for (const [k, v] of buildSection2Rows(row.type, row.meta ?? {}, lawMode)) {
        addLine(`${k}: ${v}`);
      }

      // Раздел 3
      addLine('\n3. Технические характеристики', true);
      for (const spec of row.specs ?? []) {
        if (spec.group) addLine(`  [${spec.group}]`, true);
        addLine(`  ${spec.name ?? ''}: ${spec.value ?? ''} ${spec.unit ?? ''}`);
      }

      // Раздел 4
      addLine('\n4. Гарантия и поставка', true);
      for (const [k, v] of buildSection4Rows(row.type, lawMode)) {
        addLine(`${k}: ${v}`);
      }

      // Раздел 5
      addLine('\n5. Иные требования', true);
      for (const [k, v] of buildSection5Rows(row.type, lawMode)) {
        addLine(`${k}: ${v}`);
      }
    }

    const date = new Date().toISOString().slice(0, 10);
    doc.save(`TZ_${date}.pdf`);
    appendAutomationLog({ at: new Date().toISOString(), event: 'react.export_pdf', ok: true });
  };

  const exportPackage = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      law: lawMode === '223' ? '223-FZ' : '44-FZ',
      profile: platformSettings.profile,
      items: rows.map((r) => ({
        type: r.type,
        model: r.model,
        qty: r.qty,
        okpd2: r.meta?.okpd2_code || GOODS_CATALOG[r.type]?.okpd2 || '',
        ktru: r.meta?.ktru_code || GOODS_CATALOG[r.type]?.ktruFixed || '',
        specsCount: r.specs?.length ?? 0,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `procurement_pack_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Предварительный просмотр в браузере
  const renderPreview = () => {
    const done = rows.filter((r) => r.status === 'done' && r.specs);
    if (done.length === 0) return null;
    const law = lawMode === '223' ? '223-ФЗ' : '44-ФЗ';
    return (
      <div className="tz-preview" style={{ marginTop: 24, fontSize: 13, fontFamily: 'Times New Roman, serif' }}>
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
          ТЕХНИЧЕСКОЕ ЗАДАНИЕ ({law})
        </div>
        {done.map((row, idx) => {
          const g = GOODS_CATALOG[row.type] ?? GOODS_CATALOG['pc'];
          const meta = row.meta ?? {};
          const sec2 = buildSection2Rows(row.type, meta, lawMode);
          const sec4 = buildSection4Rows(row.type, lawMode);
          const sec5 = buildSection5Rows(row.type, lawMode);
          return (
            <div key={row.id} style={{ marginBottom: 24 }}>
              {done.length > 1 && (
                <div style={{ fontWeight: 700, color: '#1F5C8B', margin: '12px 0 4px' }}>
                  Позиция {idx + 1}: {g.name} — {row.model}
                </div>
              )}

              {/* Раздел 1 */}
              <div style={{ fontWeight: 700, margin: '8px 0 4px' }}>1. Наименование объекта закупки</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  {([
                    ['Наименование объекта поставки', g.name],
                    ...(row.model ? [['Модель / описание', row.model]] : []),
                    ['Код ОКПД2', `${meta.okpd2_code || g.okpd2} — ${meta.okpd2_name || g.okpd2name}`],
                    ['Код КТРУ', meta.ktru_code || g.ktruFixed || 'Уточняется при размещении в ЕИС'],
                    ['Единица измерения (ОКЕИ)', g.isSoftware ? '2805 — экземпляр' : '796 — штука'],
                    ['Количество', `${row.qty} (${numText(row.qty)}) ${g.isSoftware ? 'лицензий' : 'штук'}`],
                    [g.isSoftware ? 'Дата версии / поставки' : 'Дата выпуска товара', g.isSoftware ? `Не ранее ${new Date().getFullYear()} года` : `Не ранее 1 января ${new Date().getFullYear()} г.`],
                  ] as [string, string][]).map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ border: '1px solid #ccc', padding: '4px 8px', fontWeight: 600, width: '35%', background: '#EEF2FF', color: '#1F2937' }}>{k}</td>
                      <td style={{ border: '1px solid #ccc', padding: '4px 8px', color: '#1F2937' }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Раздел 2 */}
              <div style={{ fontWeight: 700, margin: '8px 0 4px' }}>2. Требования к качеству и безопасности</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  {sec2.map(([k, v]) => (
                    <tr key={k} style={{ background: k.includes('⚖️') ? '#FFFBEB' : undefined }}>
                      <td style={{ border: '1px solid #ccc', padding: '4px 8px', fontWeight: 600, width: '35%', color: k.includes('⚖️') ? '#B45309' : undefined }}>{k}</td>
                      <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Раздел 3 */}
              <div style={{ fontWeight: 700, margin: '8px 0 4px' }}>3. Технические характеристики</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#1F5C8B', color: '#fff' }}>
                    <th style={{ border: '1px solid #ccc', padding: '4px 8px', width: 40 }}>№</th>
                    <th style={{ border: '1px solid #ccc', padding: '4px 8px' }}>Наименование</th>
                    <th style={{ border: '1px solid #ccc', padding: '4px 8px' }}>Значение</th>
                    <th style={{ border: '1px solid #ccc', padding: '4px 8px', width: 80 }}>Ед.изм.</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    let n = 0, g2 = '';
                    return (row.specs ?? []).map((s, si) => {
                      const rows2 = [];
                      if (s.group && s.group !== g2) {
                        g2 = s.group;
                        rows2.push(
                          <tr key={`g-${si}`}>
                            <td colSpan={4} style={{ border: '1px solid #ccc', padding: '4px 8px', background: '#C7D2FE', fontWeight: 700, textAlign: 'center' }}>{g2}</td>
                          </tr>
                        );
                      }
                      n++;
                      rows2.push(
                        <tr key={si} style={{ background: s._warning ? '#FFF7ED' : undefined }}>
                          <td style={{ border: '1px solid #ccc', padding: '4px 8px', textAlign: 'center' }}>{n}</td>
                          <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>{s.name ?? ''}</td>
                          <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>
                            {s.value ?? ''}
                            {s._warning && <span style={{ color: '#D97706', fontSize: 11, display: 'block' }}>⚠️ {s._warning}</span>}
                          </td>
                          <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>{s.unit ?? ''}</td>
                        </tr>
                      );
                      return rows2;
                    });
                  })()}
                </tbody>
              </table>

              {/* Раздел 4 */}
              <div style={{ fontWeight: 700, margin: '8px 0 4px' }}>
                {g.isSoftware ? '4. Требования к поставке и технической поддержке' : '4. Требования к гарантийному обслуживанию и поставке'}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  {sec4.map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ border: '1px solid #ccc', padding: '4px 8px', fontWeight: 600, width: '35%' }}>{k}</td>
                      <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Раздел 5 */}
              <div style={{ fontWeight: 700, margin: '8px 0 4px' }}>5. Иные требования</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  {sec5.map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ border: '1px solid #ccc', padding: '4px 8px', fontWeight: 600, width: '35%' }}>{k}</td>
                      <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <section className="panel">
      <h2>Рабочая область</h2>

      {/* Режим закона */}
      <div className="checks">
        <label><input type="radio" checked={lawMode === '44'} onChange={() => setLawMode('44')} /> 44-ФЗ</label>
        <label><input type="radio" checked={lawMode === '223'} onChange={() => setLawMode('223')} /> 223-ФЗ</label>
      </div>

      {/* Провайдер и ключ */}
      <div className="grid two">
        <label>
          Провайдер
          <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            <option value="deepseek">DeepSeek</option>
            <option value="openrouter">OpenRouter</option>
            <option value="groq">Groq</option>
          </select>
        </label>
        <label>
          Модель
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
        </label>
        <label>
          API-ключ
          <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
        </label>
      </div>

      {/* Таблица позиций */}
      <div className="rows-table-wrap">
        <table className="rows-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Тип товара</th>
              <th>Модель / описание</th>
              <th>Кол-во</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id}>
                <td className="num-cell">{idx + 1}</td>
                <td>
                  <select
                    value={row.type}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, type: val } : x)));
                    }}
                    style={{ minWidth: 180 }}
                  >
                    {GOODS_GROUPS.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.items.map((key) => (
                          <option key={key} value={key}>
                            {GOODS_CATALOG[key]?.name ?? key}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    value={row.model}
                    placeholder={GOODS_CATALOG[row.type]?.placeholder ?? 'Модель / описание...'}
                    onChange={(e) => {
                      const value = e.target.value;
                      setRows((prev) =>
                        prev.map((x) =>
                          x.id === row.id
                            ? { ...x, model: value, type: detectGoodsType(value, x.type) }
                            : x
                        )
                      );
                    }}
                  />
                </td>
                <td className="qty-cell">
                  <input
                    type="number"
                    min={1}
                    value={row.qty}
                    onChange={(e) => {
                      const qty = Math.max(1, Number(e.target.value || 1));
                      setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, qty } : x)));
                    }}
                  />
                </td>
                <td>
                  <span className={row.status === 'done' ? 'ok' : row.status === 'error' ? 'warn' : 'muted'}>
                    {row.status === 'idle' && (GOODS_CATALOG[row.type]?.hardTemplate ? '📋 Шаблон готов' : 'Ожидание')}
                    {row.status === 'loading' && '⏳ Генерация...'}
                    {row.status === 'done' && `✅ Готово (${row.specs?.length ?? 0} хар-к)`}
                    {row.status === 'error' && `❌ ${row.error ?? 'Ошибка'}`}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="danger-btn"
                    disabled={rows.length <= 1}
                    onClick={() => setRows((prev) => prev.length > 1 ? prev.filter((x) => x.id !== row.id) : prev)}
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Кнопки действий */}
      <div className="actions">
        <button type="button" onClick={addRow}>+ Добавить строку</button>
        <button
          type="button"
          disabled={!canGenerate || mutation.isPending}
          onClick={() => mutation.mutate()}
          style={{ background: canGenerate && !mutation.isPending ? '#1F5C8B' : undefined, color: canGenerate && !mutation.isPending ? '#fff' : undefined }}
        >
          {mutation.isPending ? '⏳ Генерация...' : '🚀 Сгенерировать ТЗ'}
        </button>
        <button
          type="button"
          onClick={() => void enrichFromInternet()}
          disabled={internetSearching}
          title="ИИ ищет реальные технические характеристики именно этой модели (из документации производителя) и заполняет ТЗ"
        >
          {internetSearching ? '⏳ Ищу характеристики...' : '🌐 Подтянуть из интернета'}
        </button>
        <button
          type="button"
          onClick={() => void searchZakupki()}
          disabled={eisSearching}
          title="Ищет похожие закупки на zakupki.gov.ru и адаптирует найденное ТЗ под ваш запрос через ИИ"
        >
          {eisSearching ? '⏳ Ищу в ЕИС...' : '🏛️ Найти ТЗ в ЕИС'}
        </button>
        <button type="button" onClick={exportPackage}>📦 Экспорт JSON</button>
        <button
          type="button"
          onClick={() => void exportDocx()}
          disabled={!docxReady}
          style={{ background: docxReady ? '#166534' : undefined, color: docxReady ? '#fff' : undefined }}
        >
          📄 Скачать DOCX
        </button>
        <button
          type="button"
          onClick={exportPdf}
          disabled={!docxReady}
        >
          🖨️ Скачать PDF
        </button>
      </div>

      {mutation.isError && (
        <div className="warn" style={{ marginTop: 8 }}>
          Ошибка: {mutation.error instanceof Error ? mutation.error.message : 'Неизвестная ошибка'}
        </div>
      )}

      {/* Предварительный просмотр */}
      {renderPreview()}
    </section>
  );
}
