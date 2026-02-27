import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
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
import { generateWithBackend, searchInternetSpecs, searchEisSpecs, isBackendApiAvailable } from '../lib/backendApi';
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

type SpecsCandidate = {
  specs: SpecItem[];
  meta: Record<string, string>;
  source: 'internet' | 'eis' | 'ai';
};

type GenerateOptions = {
  forceAutopilot?: boolean;
  trigger?: 'manual' | 'autopilot_button';
};

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

// ── Извлечь текст из HTML ЕИС/КТРУ (DOMParser) ────────────────────────────────
function extractEisText(html: string): string {
  if (!html) return '';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, nav, footer, header, .search-bar, .page-header').forEach((el) => el.remove());
    // Пробуем вытащить таблицу характеристик КТРУ
    const tables = Array.from(doc.querySelectorAll('table'));
    const tableParts: string[] = [];
    for (const tbl of tables) {
      const rows = Array.from(tbl.querySelectorAll('tr'));
      for (const tr of rows) {
        const cells = Array.from(tr.querySelectorAll('td, th')).map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim());
        if (cells.length >= 2 && cells.some((c) => c.length > 2)) {
          tableParts.push(cells.join(' | '));
        }
      }
      if (tableParts.length > 30) break;
    }
    if (tableParts.length > 0) return tableParts.join('\n').slice(0, 2500);
    // Фолбэк — весь текст страницы
    const body = doc.querySelector('main') ?? doc.querySelector('.search-results') ?? doc.body;
    return (body?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  } catch {
    return '';
  }
}

// ── Получить контекст из zakupki.gov.ru через наш nginx-proxy ──────────────────
async function fetchEisContext(g: GoodsItem, searchQuery: string, signal: AbortSignal): Promise<string> {
  const parts: string[] = [];
  // 1. Поиск по КТРУ-каталогу zakupki.gov.ru
  const ktruQ = encodeURIComponent(`${searchQuery} ${g.name}`);
  const ktruPath = `/proxy/zakupki/epz/ktru/ws/search/common/?searchString=${ktruQ}&morphology=on&pageNumber=1&recordsPerPage=5`;
  try {
    const r = await fetch(ktruPath, { signal });
    if (r.ok) {
      const html = await r.text();
      const extracted = extractEisText(html);
      if (extracted.length > 50) parts.push('=== КТРУ-каталог ===\n' + extracted);
    }
  } catch { /* proxy недоступен — продолжаем */ }

  // 2. Поиск закупок по 44-ФЗ с данным товаром
  const eiQ = encodeURIComponent(`${searchQuery} ${g.name}`);
  const eisPath = `/proxy/zakupki/epz/order/extendedsearch/results.html?searchString=${eiQ}&morphology=on&fz44=on&sortBy=UPDATE_DATE&pageNumber=1&recordsPerPage=_5&showLotsInfoHidden=false`;
  try {
    const r2 = await fetch(eisPath, { signal });
    if (r2.ok) {
      const html2 = await r2.text();
      const extracted2 = extractEisText(html2);
      if (extracted2.length > 50) parts.push('=== Результаты поиска ЕИС ===\n' + extracted2);
    }
  } catch { /* продолжаем без контекста ЕИС */ }

  return parts.join('\n\n').slice(0, 3000);
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

// ── Вспомогательные функции для 3-колоночной таблицы характеристик ────────────
function specGroupRow3(text: string): TableRow {
  return new TableRow({
    children: [new TableCell({
      columnSpan: 3,
      children: [new Paragraph({
        children: [new TextRun({ text, bold: true, font: FONT, size: FONT_SIZE })],
        alignment: AlignmentType.CENTER,
      })],
      shading: cellShade('DBEAFE'),
      borders: allBorders(),
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
    })],
  });
}

function spec3DataRow(name: string, value: string, unit: string, warning?: string): TableRow {
  const valText = value + (warning ? ' ⚠️ ' + warning : '');
  return new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: name, font: FONT, size: FONT_SIZE })] })],
        width: { size: 50, type: WidthType.PERCENTAGE },
        borders: allBorders(),
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: valText, font: FONT, size: FONT_SIZE })] })],
        borders: allBorders(),
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: unit, font: FONT, size: FONT_SIZE })] })],
        width: { size: 12, type: WidthType.PERCENTAGE },
        borders: allBorders(),
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
      }),
    ],
  });
}

// ── Функция генерации DOCX (структура по шаблону) ────────────────────────────
async function buildDocx(rows: GoodsRow[], lawMode: LawMode): Promise<Blob> {
  const doneRows = rows.filter((r) => r.status === 'done' && r.specs);
  if (doneRows.length === 0) throw new Error('Нет готовых позиций для экспорта');

  const children: (Paragraph | Table)[] = [];
  const currentYear = new Date().getFullYear();
  const contractWord = lawMode === '44' ? 'контракта' : 'договора';

  // Вспомогательные параграфы
  const boldPara = (text: string, spacingBefore = 160) => new Paragraph({
    children: [new TextRun({ text, bold: true, font: FONT, size: FONT_SIZE, color: '1F2937' })],
    spacing: { before: spacingBefore, after: 80 },
  });
  const regPara = (text: string) => new Paragraph({
    children: [new TextRun({ text, font: FONT, size: FONT_SIZE })],
    spacing: { after: 80 },
  });

  for (let i = 0; i < doneRows.length; i++) {
    const row = doneRows[i];
    const g = GOODS_CATALOG[row.type] ?? GOODS_CATALOG['pc'];
    const meta = row.meta ?? {};
    const isSW = !!g.isSoftware;
    const okpd2Code = meta.okpd2_code || g.okpd2;
    const okpd2Name = meta.okpd2_name || g.okpd2name;
    const ktru = meta.ktru_code || g.ktruFixed || '';
    const nacRegime = meta.nac_regime || (isSW ? 'pp1236' : 'pp878');
    const specs = row.specs ?? [];

    if (i > 0) children.push(new Paragraph({ pageBreakBefore: true, children: [] }));

    // ── ЗАГОЛОВОК ──
    children.push(
      new Paragraph({
        children: [new TextRun({ text: 'Приложение к документации о закупке', font: FONT, size: 18, color: '6B7280' })],
        alignment: AlignmentType.CENTER, spacing: { after: 40 },
      }),
      new Paragraph({ children: [], spacing: { after: 60 } }),
      new Paragraph({
        children: [new TextRun({ text: 'ТЕХНИЧЕСКОЕ ЗАДАНИЕ', bold: true, font: FONT, size: 28, color: '1F2937' })],
        alignment: AlignmentType.CENTER, spacing: { after: 40 },
      }),
      new Paragraph({
        children: [new TextRun({ text: `на поставку товара: ${g.name}`, font: FONT, size: 20, color: '6B7280' })],
        alignment: AlignmentType.CENTER, spacing: { after: 200 },
      }),
    );

    // ── СВОДНАЯ ТАБЛИЦА (Наименование / Заказчик / Исполнитель) ──
    const summaryRows: TableRow[] = [
      new TableRow({
        children: [new TableCell({
          columnSpan: 2,
          children: [new Paragraph({
            children: [new TextRun({ text: 'Наименование, Заказчик, Исполнитель, сроки и адрес поставки', bold: true, font: FONT, size: FONT_SIZE, color: 'FFFFFF' })],
            alignment: AlignmentType.CENTER,
          })],
          shading: cellShade('1F5C8B'),
          borders: allBorders(),
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
        })],
      }),
      new TableRow({ children: [s1LabelCell('Наименование объекта поставки:'), valueCell(g.name + (row.model ? '\n' + row.model : ''))] }),
      new TableRow({ children: [s1LabelCell('Заказчик:'), valueCell('')] }),
      new TableRow({ children: [s1LabelCell('Исполнитель:'), valueCell('Определяется по результатам закупочных процедур')] }),
      new TableRow({ children: [s1LabelCell('Код ОКПД2:'), valueCell(`${okpd2Code}${okpd2Name ? ' — ' + okpd2Name : ''}`)] }),
      ...(ktru ? [new TableRow({ children: [s1LabelCell('Код КТРУ:'), valueCell(ktru)] })] : []),
      new TableRow({ children: [s1LabelCell('Срок поставки:'), valueCell(`Не более 60 (шестидесяти) календарных дней с даты заключения ${contractWord}`)] }),
      new TableRow({ children: [s1LabelCell('Адрес поставки:'), valueCell('')] }),
    ];
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: summaryRows }));
    children.push(new Paragraph({ children: [], spacing: { after: 120 } }));

    // ── 1. ТРЕБОВАНИЯ К ПОСТАВКЕ ТОВАРА ──
    children.push(boldPara('Требования к поставке Товара'));
    children.push(regPara(isSW
      ? `1.1. Требования к количеству поставляемого Товара: ${row.qty} (${numText(row.qty)}) лицензий.`
      : `1.1. Требования к количеству поставляемого Товара: ${row.qty} (${numText(row.qty)}) штук.`));
    children.push(new Paragraph({
      children: [new TextRun({ text: '1.2. Требования к качеству поставляемого Товара:', bold: true, font: FONT, size: FONT_SIZE })],
      spacing: { after: 80 },
    }));
    children.push(new Paragraph({
      children: [new TextRun({ text: g.name, bold: true, font: FONT, size: FONT_SIZE })],
      alignment: AlignmentType.CENTER, spacing: { after: 80 },
    }));

    // ── ТАБЛИЦА ХАРАКТЕРИСТИК (3 колонки: Наименование | Значение | Единица) ──
    if (specs.length > 0) {
      let curGroup = '';
      const specTableRows: TableRow[] = [
        new TableRow({
          tableHeader: true,
          height: { value: 400, rule: HeightRule.ATLEAST },
          children: [
            hCell('Наименование характеристики', { w: 4500 }),
            hCell('Значение характеристики', { w: 3500 }),
            hCell('Единица измерения', { w: 1400 }),
          ],
        }),
      ];
      for (const spec of specs) {
        if (spec.group && spec.group !== curGroup) {
          curGroup = spec.group;
          specTableRows.push(specGroupRow3(curGroup));
        }
        const warn = spec._warning ? String(spec._warning) : undefined;
        specTableRows.push(spec3DataRow(String(spec.name ?? ''), String(spec.value ?? ''), String(spec.unit ?? ''), warn));
      }
      // Поле ТОРП для аппаратных товаров с нацрежимом
      if (!isSW && (nacRegime === 'pp878' || nacRegime === 'pp616')) {
        specTableRows.push(spec3DataRow('ТОРП', 'Да', ''));
      }
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: specTableRows }));
    }
    children.push(new Paragraph({ children: [], spacing: { after: 100 } }));

    // ── ТЕКСТОВЫЕ ТРЕБОВАНИЯ К КАЧЕСТВУ ──
    if (isSW) {
      for (const t of [
        'Поставляемое программное обеспечение должно быть лицензионно чистым. Поставщик гарантирует правомерность использования ПО и несёт ответственность за нарушение авторских и смежных прав.',
        'Программное обеспечение должно быть полнофункциональным, не лимитированным по сроку использования (за исключением лицензий с явно ограниченным сроком действия) и не быть демонстрационным.',
        'Поставщик обязан передать Заказчику комплект документации на русском языке: руководство пользователя, руководство администратора.',
        'Право использования ПО передаётся Заказчику на основании лицензионного договора (сублицензионного соглашения) в соответствии с частью IV Гражданского кодекса РФ.',
      ]) children.push(regPara(t));
    } else {
      for (const t of [
        'Все поставляемые технические средства должны быть полнофункциональными и не лимитированными по сроку использования (не быть демонстрационными).',
        'Поставленный Товар не должен иметь дефектов, связанных с конструкцией, материалами или функционированием, при его штатном использовании в соответствии с технической документацией.',
        'Товар должен отвечать требованиям качества, безопасности и другим требованиям, предъявленным законодательством Российской Федерации и настоящим Контрактом.',
        'Поставляемый Товар должен быть заводской сборки, серийным, новым (не бывшим в эксплуатации, не восстановленным и не собранным из восстановленных компонентов).',
        'Товар не должен находиться в залоге, под арестом или под иным обременением.',
        'На поставляемом Товаре не должно быть следов механических повреждений, изменений вида комплектующих, а также других несоответствующих официальному техническому описанию.',
        'Поставляемый Товар должен быть обеспечен необходимыми кабельными соединениями для осуществления эксплуатации.',
        'В момент получения Заказчик имеет право в присутствии представителя Поставщика осуществить проверку качества поставляемого Товара. Замена забракованного Товара осуществляется Поставщиком в течение 3 (трёх) рабочих дней с момента проверки.',
        'Товар должен сопровождаться комплектом документации на русском языке, поставляемой производителем.',
      ]) children.push(regPara(t));
    }

    // ── ТРЕБОВАНИЯ СООТВЕТСТВИЯ (нацрежим) ──
    children.push(boldPara('Требования соответствия.', 100));
    if (isSW && nacRegime === 'pp1236') {
      children.push(regPara('Программное обеспечение должно быть включено в Единый реестр российских программ для электронных вычислительных машин и баз данных (реестр Минцифры России) в соответствии с Постановлением Правительства РФ от 16.11.2015 № 1236.'));
      children.push(regPara('Поставщик обязан представить реестровую запись (выписку) из реестра Минцифры России с актуальным регистрационным номером поставляемого программного обеспечения.'));
    } else if (nacRegime === 'pp878') {
      children.push(regPara('Товар должен быть включён в единый реестр российской радиоэлектронной продукции либо евразийский реестр промышленных товаров. Поставщик обязан представить документы и (или) реестровые записи, предусмотренные Постановлением Правительства РФ от 23.12.2024 № 1875 для подтверждения происхождения товара.'));
    } else if (nacRegime === 'pp616') {
      children.push(regPara('Товар должен иметь подтверждение производства промышленной продукции на территории государств — членов ЕАЭС. Поставщик обязан представить документы, предусмотренные Постановлением Правительства РФ от 23.12.2024 № 1875.'));
    } else {
      children.push(regPara('Ограничения по стране происхождения для данного вида товара не установлены. Страна происхождения указывается в товаросопроводительных документах.'));
    }
    // Совместимость с отечественными ОС для ПК/ноутбуков/серверов
    if (['pc','laptop','monoblock','server','tablet','thinClient'].includes(row.type)) {
      children.push(regPara('Товар должен быть совместим с отечественными операционными системами, включёнными в Единый реестр российских программ для ЭВМ и баз данных Министерства цифрового развития, связи и массовых коммуникаций РФ, в том числе: Astra Linux Special Edition, ALT Linux, РЕД ОС или эквивалентными (ч. 3 ст. 33 Федерального закона от 05.04.2013 № 44-ФЗ).'));
    }

    // ── ПУСКОНАЛАДОЧНЫЕ РАБОТЫ ──
    children.push(boldPara('Требования к пуско-наладочным работам.', 100));
    children.push(regPara(isSW
      ? 'Пуско-наладочные работы включают установку программного обеспечения и первоначальную настройку на рабочих местах Заказчика.'
      : 'Пуско-наладочные работы не требуются.'));

    // ── 2. ГАРАНТИЯ (основная часть) ──
    children.push(boldPara('Требования к сроку предоставления гарантии качества'));
    if (isSW) {
      children.push(regPara('Поставщик обязан обеспечить техническую поддержку программного обеспечения в течение не менее 12 (двенадцати) месяцев с даты передачи лицензии. Режим поддержки: 5×8 (рабочие дни, 09:00–18:00 МСК).'));
      children.push(regPara(`Дата версии поставляемого программного обеспечения должна быть не ранее ${currentYear} года (актуальная версия на дату поставки).`));
    } else {
      children.push(regPara('Поставщик обязан предоставить Заказчику оригинал документа, подтверждающего предоставление гарантии производителя Товара на срок не менее 12 (двенадцати) месяцев.'));
      children.push(regPara('При обнаружении дефектов Товара в течение гарантийного срока, возникших по независящим от Заказчика причинам, Поставщик обязан обеспечить прибытие своего уполномоченного представителя по адресу поставки Товара не позднее 7 дней с момента получения соответствующего уведомления от Заказчика и устранить недостатки Товара. При невозможности проведения ремонта Товара в указанный срок Поставщик обязан за свой счёт заменить Товар ненадлежащего качества новым или аналогичным в течение 30 дней с момента получения письменного уведомления от Заказчика. Возврат Товара и его замена производятся силами и за счёт средств Поставщика.'));
      children.push(regPara('В случае замены неисправного носителя информации любого вида в целях обеспечения защиты информации у Заказчика не возникает обязанность по возврату Поставщику неисправного носителя информации.'));
      children.push(regPara(`Дата выпуска поставляемого Товара должна быть не ранее 1 января ${currentYear} г.`));
    }

    // ── 3. ТАРА И УПАКОВКА ──
    if (!isSW) {
      children.push(boldPara('Требования к таре и упаковке товара'));
      for (const t of [
        'Поставщик обязан поставить Товар в таре и упаковке, обеспечивающей его сохранность, товарный вид и предохраняющей от повреждений при транспортировке.',
        'Товар должен быть упакован и маркирован в соответствии с технической (эксплуатационной) документацией производителя. Вся маркировка должна быть нанесена способом, обеспечивающим чёткость и сохранность маркировки в течение всего срока эксплуатации.',
        'Упаковка должна обеспечивать защиту от воздействия механических и климатических факторов во время транспортирования и хранения поставляемого Товара, а также наиболее полное использование грузоподъёмности транспортных средств и удобство выполнения погрузочно-разгрузочных работ.',
        'Эксплуатационная документация должна быть вложена в потребительскую тару или транспортную тару вместе с Товаром.',
      ]) children.push(regPara(t));
    }

    // ── 4. ТРЕБОВАНИЯ К ГАРАНТИИ (детализация) ──
    children.push(boldPara('Требования к гарантии'));
    children.push(regPara('Требования к нормативно-техническому обеспечению.'));
    if (isSW) {
      children.push(regPara('Поставщик обязан предоставить Заказчику оригиналы или заверенные копии следующих документов при поставке: лицензионный договор (сублицензионное соглашение); выписка из реестра Минцифры России с актуальным регистрационным номером ПО.'));
    } else {
      children.push(regPara(`Поставщик обязан предоставить Заказчику оригиналы документов при поставке ${g.name.toLowerCase()}:`));
      children.push(regPara('— документ, подтверждающий предоставление гарантии производителя средств вычислительной техники на срок не менее 12 мес.;'));
      children.push(regPara('— документ, подтверждающий страну происхождения средств вычислительной техники.'));
    }
    for (const t of [
      'В течение срока гарантии качества Поставщик гарантирует надлежащее качество Товара.',
      'В случае обнаружения недостатков, дефектов в поставленных Товарах, Поставщик, в сроки, установленные Заказчиком, своими силами и за свой счёт устраняет обнаруженные дефекты и недостатки.',
      'Если Поставщик не устраняет недостатки в сроки, определяемые актом, Заказчик имеет право заменить Товар и устранить недостатки, дефекты и недоделки силами третьих лиц за счёт Поставщика.',
      'Все сопутствующие гарантийному обслуживанию мероприятия (доставка, погрузка, разгрузка) осуществляются силами и за счёт Поставщика.',
    ]) children.push(regPara(t));

    // ── 5. МЕСТО, СРОКИ И УСЛОВИЯ ПОСТАВКИ ──
    children.push(boldPara('Место, сроки и условия поставки товара.'));
    children.push(regPara('Место доставки товара: _______________________________________________'));
    children.push(regPara(`Срок поставки Товара: не более 60 (шестидесяти) календарных дней с даты заключения ${contractWord}.`));
    children.push(regPara('Поставщик обязан согласовать с Заказчиком (представителем Заказчика) дату и время поставки товара не позднее, чем за 2 (два) рабочих дня до даты поставки. Поставка осуществляется в рабочее время Заказчика (понедельник – пятница с 9.00 до 13.00 и с 14.00 до 17.00, исключение – выходные и праздничные дни). Поставщик за счёт собственных средств осуществляет поставку, выгрузку и доставку товара согласно спецификации, непосредственно в помещение, указанное Заказчиком.'));
  }

  // ── Подпись ──
  children.push(new Paragraph({ children: [], spacing: { before: 480 } }));
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: [
      dataCell('Заказчик:  _________________________ / _________________________', { w: 6000 }),
      dataCell(`«____» _______________ ${currentYear} г.`, { w: 3000 }),
    ]})],
  }));

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: FONT_SIZE } } } },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1800, right: 850 } } },
      children,
    }],
  });

  return Packer.toBlob(doc);
}

// ── Компонент ─────────────────────────────────────────────────────────────────
type Props = {
  automationSettings: AutomationSettings;
  platformSettings: PlatformIntegrationSettings;
  backendUser?: { email: string; role: string; tz_count: number; tz_limit: number } | null;
};

export function Workspace({ automationSettings, platformSettings, backendUser }: Props) {
  // Whether to use backend (logged in + backend URL configured)
  const useBackend = !!(backendUser && isBackendApiAvailable());
  const [lawMode, setLawMode] = useState<LawMode>('44');
  const [provider, setProvider] = useState<Provider>('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('deepseek-chat');
  const [authPanelOpen, setAuthPanelOpen] = useState<boolean>(() => !useBackend);
  const [showApiKey, setShowApiKey] = useState(false);
  const [rows, setRows] = useState<GoodsRow[]>([{ id: 1, type: 'pc', model: '', qty: 1, status: 'idle' }]);
  const [docxReady, setDocxReady] = useState(false);

  // Общий статус поиска по ЕИС
  const [eisSearching, setEisSearching] = useState(false);
  // Общий статус подтягивания из интернета
  const [internetSearching, setInternetSearching] = useState(false);
  // Toast-уведомление
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  // Ref для скролла к превью
  const previewRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const scrollToPreview = useCallback(() => {
    setTimeout(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  }, []);

  const hasUserApiKey = apiKey.trim().length > 6;
  const useBackendAi = useBackend && !hasUserApiKey;
  const apiKeyInputType: 'password' | 'text' = showApiKey ? 'text' : 'password';

  const canGenerate = useMemo(
    () => (useBackend || hasUserApiKey) && rows.every((r) => r.model.trim().length > 0),
    [useBackend, hasUserApiKey, rows]
  );

  const buildPayload = useCallback((sourceRows: GoodsRow[]) => ({
    law: lawMode === '223' ? '223-FZ' : '44-FZ',
    profile: platformSettings.profile,
    organization: platformSettings.orgName,
    customerInn: platformSettings.customerInn,
    items: sourceRows.map((r) => ({
      type: r.type,
      model: r.model,
      qty: r.qty,
      status: r.status,
      okpd2: r.meta?.okpd2_code || GOODS_CATALOG[r.type]?.okpd2 || '',
      ktru: r.meta?.ktru_code || GOODS_CATALOG[r.type]?.ktruFixed || '',
    })),
  }), [lawMode, platformSettings.profile, platformSettings.orgName, platformSettings.customerInn]);

  const exportPackage = useCallback((sourceRows: GoodsRow[] = rows) => {
    const payload = {
      exportedAt: new Date().toISOString(),
      law: lawMode === '223' ? '223-FZ' : '44-FZ',
      profile: platformSettings.profile,
      items: sourceRows.map((r) => ({
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
  }, [lawMode, platformSettings.profile, rows]);

  const fetchInternetCandidateForRow = useCallback(async (row: GoodsRow): Promise<SpecsCandidate | null> => {
    if (!row.model.trim()) return null;
    const g = GOODS_CATALOG[row.type] ?? GOODS_CATALOG['pc'];

    if (useBackend) {
      const backendSpecs = await searchInternetSpecs(row.model.trim(), row.type);
      if (backendSpecs.length > 0) {
        return {
          source: 'internet',
          specs: backendSpecs.map((s) => ({ name: s.name, value: s.value, unit: s.unit, group: '' })),
          meta: {
            okpd2_code: g.okpd2,
            okpd2_name: g.okpd2name,
            ktru_code: g.ktruFixed ?? '',
            nac_regime: 'pp878',
          },
        };
      }
    }

    const prompt = buildSpecSearchPrompt(row, g);
    let raw: string;
    if (useBackendAi) {
      raw = await generateWithBackend(provider, model, [{ role: 'user', content: prompt }], 0.1, 2048);
    } else {
      raw = await generateItemSpecs(provider, apiKey, model, prompt);
    }
    const { meta, specs } = parseAiResponse(raw);
    return {
      source: 'internet',
      specs: postProcessSpecs(specs),
      meta,
    };
  }, [useBackend, useBackendAi, provider, model, apiKey]);

  const fetchEisCandidateForRow = useCallback(async (row: GoodsRow): Promise<SpecsCandidate | null> => {
    if (!row.model.trim()) return null;
    const g = GOODS_CATALOG[row.type] ?? GOODS_CATALOG['pc'];

    if (useBackend) {
      const eisSpecs = await searchEisSpecs(row.model.trim(), row.type);
      if (eisSpecs.length > 0) {
        return {
          source: 'eis',
          specs: eisSpecs.map((s) => ({ name: s.name, value: s.value, unit: s.unit, group: '' })),
          meta: {
            okpd2_code: g.okpd2,
            okpd2_name: g.okpd2name,
            ktru_code: g.ktruFixed ?? '',
            nac_regime: 'pp878',
          },
        };
      }
    }

    let eisContext = '';
    try {
      const controller = new AbortController();
      const tid = window.setTimeout(() => controller.abort(), 20000);
      try {
        eisContext = await fetchEisContext(g, row.model.trim(), controller.signal);
      } finally {
        clearTimeout(tid);
      }
    } catch {
      // proxy недоступен
    }
    const prompt = buildEisStylePrompt(row, g, eisContext);
    let raw: string;
    if (useBackendAi) {
      raw = await generateWithBackend(provider, model, [{ role: 'user', content: prompt }], 0.1, 2048);
    } else {
      raw = await generateItemSpecs(provider, apiKey, model, prompt);
    }
    const { meta, specs } = parseAiResponse(raw);
    return {
      source: 'eis',
      specs: postProcessSpecs(specs),
      meta,
    };
  }, [useBackend, useBackendAi, provider, model, apiKey]);

  const pickBestCandidate = useCallback((
    internetCandidate: SpecsCandidate | null,
    eisCandidate: SpecsCandidate | null,
    autoPickTopCandidate: boolean,
  ): SpecsCandidate | null => {
    if (!internetCandidate && !eisCandidate) return null;
    if (!autoPickTopCandidate) return eisCandidate ?? internetCandidate;
    const internetCount = internetCandidate?.specs.length ?? 0;
    const eisCount = eisCandidate?.specs.length ?? 0;
    if (eisCount > internetCount) return eisCandidate;
    if (internetCount > eisCount) return internetCandidate;
    return eisCandidate ?? internetCandidate;
  }, []);

  const mutation = useMutation({
    mutationFn: async (options?: GenerateOptions) => {
      const autopilotEnabled = !!(options?.forceAutopilot || automationSettings.autopilot);
      if (!rows.every((r) => r.model.trim().length > 0)) {
        showToast('❌ Заполните поле «Модель / описание» для всех строк', false);
        return;
      }
      if (!useBackend && !hasUserApiKey) {
        showToast('❌ Нужен вход в аккаунт или API-ключ', false);
        return;
      }

      const next = [...rows];
      const sourceStats = { template: 0, internet: 0, eis: 0, ai: 0, error: 0 };

      if (autopilotEnabled) {
        setInternetSearching(true);
        setEisSearching(true);
      }
      setDocxReady(false);
      try {
        for (let i = 0; i < next.length; i++) {
          next[i] = { ...next[i], status: 'loading', error: '' };
          setRows([...next]);

          const currentRow = next[i];
          const g = GOODS_CATALOG[currentRow.type] ?? GOODS_CATALOG['pc'];

          // Если для типа товара есть жёсткий шаблон — пропускаем AI
          if (g.hardTemplate && g.hardTemplate.length > 0) {
            const specs = (g.hardTemplate as HardSpec[]).map((s) => ({ group: s.group, name: s.name, value: s.value, unit: s.unit ?? '' }));
            const meta: Record<string, string> = {
              okpd2_code: g.okpd2,
              okpd2_name: g.okpd2name,
              ktru_code: g.ktruFixed ?? '',
              nac_regime: 'pp616',
            };
            next[i] = { ...currentRow, status: 'done', specs, meta };
            sourceStats.template += 1;
            setRows([...next]);
            continue;
          }

          try {
            if (autopilotEnabled) {
              let internetCandidate: SpecsCandidate | null = null;
              let eisCandidate: SpecsCandidate | null = null;

              try {
                internetCandidate = await fetchInternetCandidateForRow(currentRow);
              } catch {
                // игнорируем и пробуем ЕИС + fallback AI ниже
              }
              try {
                eisCandidate = await fetchEisCandidateForRow(currentRow);
              } catch {
                // игнорируем и пробуем fallback AI ниже
              }

              const picked = pickBestCandidate(internetCandidate, eisCandidate, automationSettings.autoPickTopCandidate);
              if (picked) {
                next[i] = { ...currentRow, status: 'done', specs: picked.specs, meta: picked.meta };
                if (picked.source === 'internet') sourceStats.internet += 1;
                else sourceStats.eis += 1;
                setRows([...next]);
                continue;
              }
            }

            const prompt = buildPrompt(currentRow, lawMode);
            let raw: string;
            if (useBackendAi) {
              raw = await generateWithBackend(provider, model, [{ role: 'user', content: prompt }], 0.1, 2048);
            } else {
              raw = await generateItemSpecs(provider, apiKey, model, prompt);
            }
            const { meta, specs } = parseAiResponse(raw);
            const processed = postProcessSpecs(specs);
            next[i] = { ...currentRow, status: 'done', specs: processed, meta };
            sourceStats.ai += 1;
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'generation_error';
            next[i] = { ...currentRow, status: 'error', error: msg };
            sourceStats.error += 1;
          }
          setRows([...next]);
        }

        const payload = buildPayload(next);
        let integrationsOk = true;

        if (automationSettings.autoSend) {
          const ok = await sendEventThroughBestChannel(automationSettings, 'tz.generated.react', payload);
          integrationsOk = integrationsOk && ok;
        }
        if (platformSettings.autoSendDraft) {
          const ok = await postPlatformDraft(platformSettings.endpoint, platformSettings.apiToken, payload);
          integrationsOk = integrationsOk && ok;
        }
        if (platformSettings.autoExport) {
          try {
            exportPackage(next);
            appendAutomationLog({ at: new Date().toISOString(), event: 'platform.auto_export', ok: true });
          } catch {
            integrationsOk = false;
            appendAutomationLog({ at: new Date().toISOString(), event: 'platform.auto_export', ok: false });
          }
        }

        const doneRows = next.filter((r) => r.status === 'done');
        const totalSpecs = doneRows.reduce((s, r) => s + (r.specs?.length ?? 0), 0);
        const eventName = autopilotEnabled ? 'react.autopilot' : 'react.generate';
        appendAutomationLog({
          at: new Date().toISOString(),
          event: eventName,
          ok: doneRows.length > 0 && integrationsOk,
          note: `rows=${next.length}; done=${doneRows.length}; src=t${sourceStats.template}/i${sourceStats.internet}/e${sourceStats.eis}/a${sourceStats.ai}/err${sourceStats.error}`,
        });

        setDocxReady(doneRows.length > 0);
        if (doneRows.length > 0) {
          const prefix = autopilotEnabled ? 'Автопилот завершён' : 'ТЗ сформировано';
          if (integrationsOk) {
            showToast(`✅ ${prefix}: ${doneRows.length} позиц., ${totalSpecs} характеристик`);
          } else {
            showToast(`⚠️ ${prefix}, но часть интеграций не отправлена`, false);
          }
          scrollToPreview();
        } else {
          showToast('❌ Не удалось сформировать ТЗ', false);
        }
      } finally {
        if (autopilotEnabled) {
          setInternetSearching(false);
          setEisSearching(false);
        }
      }
    },
  });

  useEffect(() => {
    const runAutopilot = () => {
      if (mutation.isPending) return;
      mutation.mutate({ forceAutopilot: true, trigger: 'autopilot_button' });
    };
    window.addEventListener('tz:autopilot:run', runAutopilot as EventListener);
    return () => window.removeEventListener('tz:autopilot:run', runAutopilot as EventListener);
  }, [mutation.isPending, mutation.mutate]);

  const addRow = () => {
    setRows((prev) => [...prev, { id: Date.now(), type: 'pc', model: '', qty: 1, status: 'idle' }]);
  };

  // ── Подтянуть реальные характеристики товара ────────────────────────────────
  const enrichFromInternet = useCallback(async () => {
    const filledRows = rows.filter((r) => r.model.trim().length > 0);
    if (filledRows.length === 0) {
      alert('Заполните поле «Модель / описание» хотя бы в одной строке');
      return;
    }
    if (!useBackend && !apiKey.trim()) {
      alert('Войдите в систему для поиска через интернет, или введите API-ключ');
      return;
    }
    setInternetSearching(true);
    const next = [...rows];
    for (let i = 0; i < next.length; i++) {
      if (!next[i].model.trim()) continue;
      next[i] = { ...next[i], status: 'loading', error: '' };
      setRows([...next]);
      try {
        const candidate = await fetchInternetCandidateForRow(next[i]);
        if (!candidate || candidate.specs.length === 0) {
          throw new Error('характеристики не найдены');
        }
        next[i] = { ...next[i], status: 'done', specs: candidate.specs, meta: candidate.meta };
      } catch (e) {
        next[i] = { ...next[i], status: 'error', error: e instanceof Error ? e.message : 'error' };
      }
      setRows([...next]);
    }
    setInternetSearching(false);
    const done = next.filter((r) => r.status === 'done');
    const totalSpecs = done.reduce((s, r) => s + (r.specs?.length ?? 0), 0);
    if (done.length > 0) {
      setDocxReady(true);
      showToast(`✅ Характеристики добавлены в ТЗ: ${totalSpecs} параметров`);
      scrollToPreview();
    } else {
      const firstError = next.find((r) => r.status === 'error' && r.error)?.error || '';
      showToast(
        firstError
          ? `❌ Не удалось получить характеристики: ${firstError}`
          : '❌ Не удалось получить характеристики',
        false
      );
    }
  }, [useBackend, rows, apiKey, fetchInternetCandidateForRow, showToast, scrollToPreview]);

  // ── Найти ТЗ в ЕИС (zakupki.gov.ru) ─────────────────────────────────────────
  const searchZakupki = useCallback(async () => {
    const filledRows = rows.filter((r) => r.model.trim().length > 0);
    if (filledRows.length === 0) {
      alert('Заполните поле «Модель / описание» хотя бы в одной строке');
      return;
    }
    if (!useBackend && !apiKey.trim()) {
      alert('Войдите в систему для поиска в ЕИС, или введите API-ключ');
      return;
    }
    setEisSearching(true);
    const next = [...rows];
    for (let i = 0; i < next.length; i++) {
      if (!next[i].model.trim()) continue;
      next[i] = { ...next[i], status: 'loading', error: '' };
      setRows([...next]);

      try {
        const candidate = await fetchEisCandidateForRow(next[i]);
        if (!candidate || candidate.specs.length === 0) {
          throw new Error('данные ЕИС не найдены');
        }
        next[i] = { ...next[i], status: 'done', specs: candidate.specs, meta: candidate.meta };
      } catch (e) {
        next[i] = { ...next[i], status: 'error', error: e instanceof Error ? e.message : 'error' };
      }
      setRows([...next]);
    }
    setEisSearching(false);
    const done2 = next.filter((r) => r.status === 'done');
    const totalSpecs2 = done2.reduce((s, r) => s + (r.specs?.length ?? 0), 0);
    if (done2.length > 0) {
      setDocxReady(true);
      showToast(`✅ Данные из ЕИС добавлены в ТЗ: ${totalSpecs2} характеристик`);
      scrollToPreview();
    } else {
      const firstError = next.find((r) => r.status === 'error' && r.error)?.error || '';
      showToast(
        firstError
          ? `❌ Не удалось получить данные из ЕИС: ${firstError}`
          : '❌ Не удалось получить данные из ЕИС',
        false
      );
    }
  }, [useBackend, rows, apiKey, fetchEisCandidateForRow, showToast, scrollToPreview]);

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

  // Предварительный просмотр в браузере (структура соответствует шаблону DOCX)
  const renderPreview = () => {
    const done = rows.filter((r) => r.status === 'done' && r.specs);
    if (done.length === 0) return null;
    const contractWord = lawMode === '44' ? 'контракта' : 'договора';
    const currentYear = new Date().getFullYear();
    const tdL = { border: '1px solid #ccc', padding: '4px 8px', background: '#EEF2FF', fontWeight: 600, width: '38%', color: '#1F2937' } as const;
    const tdR = { border: '1px solid #ccc', padding: '4px 8px', color: '#1F2937' } as const;
    const pStyle = { margin: '4px 0', lineHeight: 1.5 } as const;
    const boldStyle = { fontWeight: 700, margin: '10px 0 4px' } as const;

    return (
      <div className="tz-preview" style={{ marginTop: 24, fontSize: 12, fontFamily: 'Times New Roman, serif', lineHeight: 1.5 }}>
        {done.map((row, idx) => {
          const g = GOODS_CATALOG[row.type] ?? GOODS_CATALOG['pc'];
          const meta = row.meta ?? {};
          const isSW = !!g.isSoftware;
          const okpd2Code = meta.okpd2_code || g.okpd2;
          const okpd2Name = meta.okpd2_name || g.okpd2name;
          const ktru = meta.ktru_code || g.ktruFixed || '';
          const nacRegime = meta.nac_regime || (isSW ? 'pp1236' : 'pp878');
          const specs = row.specs ?? [];

          return (
            <div key={row.id} style={{ marginBottom: 32, pageBreakAfter: 'always' }}>
              {/* Разделитель для нескольких позиций */}
              {idx > 0 && <hr style={{ borderTop: '2px dashed #93C5FD', margin: '24px 0' }} />}

              {/* Заголовок */}
              <div style={{ textAlign: 'center', color: '#6B7280', fontSize: 11, marginBottom: 4 }}>Приложение к документации о закупке</div>
              <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 16, margin: '4px 0 2px' }}>ТЕХНИЧЕСКОЕ ЗАДАНИЕ</div>
              <div style={{ textAlign: 'center', color: '#6B7280', fontSize: 12, marginBottom: 12 }}>на поставку товара: {g.name}</div>

              {/* Сводная таблица */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 12 }}>
                <thead>
                  <tr><th colSpan={2} style={{ border: '1px solid #ccc', padding: '4px 8px', background: '#1F5C8B', color: '#fff', textAlign: 'center' }}>Наименование, Заказчик, Исполнитель, сроки и адрес поставки</th></tr>
                </thead>
                <tbody>
                  <tr><td style={tdL}>Наименование объекта поставки:</td><td style={tdR}>{g.name}{row.model ? '\n' + row.model : ''}</td></tr>
                  <tr><td style={tdL}>Заказчик:</td><td style={tdR}></td></tr>
                  <tr><td style={tdL}>Исполнитель:</td><td style={tdR}>Определяется по результатам закупочных процедур</td></tr>
                  <tr><td style={tdL}>Код ОКПД2:</td><td style={tdR}>{okpd2Code}{okpd2Name ? ' — ' + okpd2Name : ''}</td></tr>
                  {ktru && <tr><td style={tdL}>Код КТРУ:</td><td style={tdR}>{ktru}</td></tr>}
                  <tr><td style={tdL}>Срок поставки:</td><td style={tdR}>Не более 60 (шестидесяти) календарных дней с даты заключения {contractWord}</td></tr>
                  <tr><td style={tdL}>Адрес поставки:</td><td style={tdR}></td></tr>
                </tbody>
              </table>

              {/* 1. Требования к поставке */}
              <div style={boldStyle}>Требования к поставке Товара</div>
              <p style={pStyle}>{isSW
                ? `1.1. Требования к количеству поставляемого Товара: ${row.qty} (${numText(row.qty)}) лицензий.`
                : `1.1. Требования к количеству поставляемого Товара: ${row.qty} (${numText(row.qty)}) штук.`}
              </p>
              <p style={{ ...pStyle, fontWeight: 600 }}>1.2. Требования к качеству поставляемого Товара:</p>
              <p style={{ ...pStyle, textAlign: 'center', fontWeight: 700 }}>{g.name}</p>

              {/* Таблица характеристик (3 колонки) */}
              {specs.length > 0 && (() => {
                let curGroup = '';
                return (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 8 }}>
                    <thead>
                      <tr style={{ background: '#1F5C8B', color: '#fff' }}>
                        <th style={{ border: '1px solid #ccc', padding: '4px 8px' }}>Наименование характеристики</th>
                        <th style={{ border: '1px solid #ccc', padding: '4px 8px' }}>Значение характеристики</th>
                        <th style={{ border: '1px solid #ccc', padding: '4px 8px', width: 90 }}>Единица измерения</th>
                      </tr>
                    </thead>
                    <tbody>
                      {specs.map((s, si) => {
                        const rows2: React.ReactNode[] = [];
                        if (s.group && s.group !== curGroup) {
                          curGroup = s.group;
                          rows2.push(
                            <tr key={`g-${si}`}>
                              <td colSpan={3} style={{ border: '1px solid #ccc', padding: '4px 8px', background: '#C7D2FE', fontWeight: 700, textAlign: 'center' }}>{curGroup}</td>
                            </tr>
                          );
                        }
                        rows2.push(
                          <tr key={si} style={{ background: s._warning ? '#FFF7ED' : undefined }}>
                            <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>{s.name ?? ''}</td>
                            <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>
                              {s.value ?? ''}
                              {s._warning && <span style={{ color: '#D97706', fontSize: 10, display: 'block' }}>⚠️ {s._warning}</span>}
                            </td>
                            <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>{s.unit ?? ''}</td>
                          </tr>
                        );
                        return rows2;
                      })}
                      {/* ТОРП для аппаратного товара */}
                      {!isSW && (nacRegime === 'pp878' || nacRegime === 'pp616') && (
                        <tr>
                          <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>ТОРП</td>
                          <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}>Да</td>
                          <td style={{ border: '1px solid #ccc', padding: '4px 8px' }}></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                );
              })()}

              {/* Текстовые требования к качеству */}
              {isSW ? (
                <>
                  <p style={pStyle}>Поставляемое программное обеспечение должно быть лицензионно чистым. Поставщик гарантирует правомерность использования ПО и несёт ответственность за нарушение авторских и смежных прав.</p>
                  <p style={pStyle}>Программное обеспечение должно быть полнофункциональным, не лимитированным по сроку использования (за исключением лицензий с явно ограниченным сроком действия) и не быть демонстрационным.</p>
                  <p style={pStyle}>Поставщик обязан передать Заказчику комплект документации на русском языке: руководство пользователя, руководство администратора.</p>
                  <p style={pStyle}>Право использования ПО передаётся Заказчику на основании лицензионного договора (сублицензионного соглашения) в соответствии с частью IV Гражданского кодекса РФ.</p>
                </>
              ) : (
                <>
                  <p style={pStyle}>Все поставляемые технические средства должны быть полнофункциональными и не лимитированными по сроку использования (не быть демонстрационными).</p>
                  <p style={pStyle}>Поставленный Товар не должен иметь дефектов, связанных с конструкцией, материалами или функционированием, при его штатном использовании в соответствии с технической документацией.</p>
                  <p style={pStyle}>Товар должен отвечать требованиям качества, безопасности и другим требованиям, предъявленным законодательством Российской Федерации и настоящим Контрактом.</p>
                  <p style={pStyle}>Поставляемый Товар должен быть заводской сборки, серийным, новым (не бывшим в эксплуатации, не восстановленным и не собранным из восстановленных компонентов).</p>
                  <p style={pStyle}>Товар не должен находиться в залоге, под арестом или под иным обременением.</p>
                  <p style={pStyle}>На поставляемом Товаре не должно быть следов механических повреждений, изменений вида комплектующих, а также других несоответствующих официальному техническому описанию.</p>
                  <p style={pStyle}>Поставляемый Товар должен быть обеспечен необходимыми кабельными соединениями для осуществления эксплуатации.</p>
                  <p style={pStyle}>В момент получения Заказчик имеет право в присутствии представителя Поставщика осуществить проверку качества поставляемого Товара. Замена забракованного Товара осуществляется Поставщиком в течение 3 (трёх) рабочих дней с момента проверки.</p>
                  <p style={pStyle}>Товар должен сопровождаться комплектом документации на русском языке, поставляемой производителем.</p>
                </>
              )}

              {/* Требования соответствия */}
              <div style={boldStyle}>Требования соответствия.</div>
              {isSW && nacRegime === 'pp1236' ? (
                <>
                  <p style={pStyle}>Программное обеспечение должно быть включено в Единый реестр российских программ для электронных вычислительных машин и баз данных (реестр Минцифры России) в соответствии с Постановлением Правительства РФ от 16.11.2015 № 1236.</p>
                  <p style={pStyle}>Поставщик обязан представить реестровую запись (выписку) из реестра Минцифры России с актуальным регистрационным номером поставляемого программного обеспечения.</p>
                </>
              ) : nacRegime === 'pp878' ? (
                <p style={pStyle}>Товар должен быть включён в единый реестр российской радиоэлектронной продукции либо евразийский реестр промышленных товаров. Поставщик обязан представить документы и (или) реестровые записи, предусмотренные Постановлением Правительства РФ от 23.12.2024 № 1875 для подтверждения происхождения товара.</p>
              ) : nacRegime === 'pp616' ? (
                <p style={pStyle}>Товар должен иметь подтверждение производства промышленной продукции на территории государств — членов ЕАЭС. Поставщик обязан представить документы, предусмотренные Постановлением Правительства РФ от 23.12.2024 № 1875.</p>
              ) : (
                <p style={pStyle}>Ограничения по стране происхождения для данного вида товара не установлены. Страна происхождения указывается в товаросопроводительных документах.</p>
              )}
              {['pc','laptop','monoblock','server','tablet','thinClient'].includes(row.type) && (
                <p style={pStyle}>Товар должен быть совместим с отечественными операционными системами, включёнными в Единый реестр российских программ для ЭВМ и баз данных Министерства цифрового развития, связи и массовых коммуникаций РФ, в том числе: Astra Linux Special Edition, ALT Linux, РЕД ОС или эквивалентными (ч. 3 ст. 33 Федерального закона от 05.04.2013 № 44-ФЗ).</p>
              )}

              {/* Пусконаладочные работы */}
              <div style={boldStyle}>Требования к пуско-наладочным работам.</div>
              <p style={pStyle}>{isSW
                ? 'Пуско-наладочные работы включают установку программного обеспечения и первоначальную настройку на рабочих местах Заказчика.'
                : 'Пуско-наладочные работы не требуются.'}
              </p>

              {/* Гарантия */}
              <div style={boldStyle}>Требования к сроку предоставления гарантии качества</div>
              {isSW ? (
                <>
                  <p style={pStyle}>Поставщик обязан обеспечить техническую поддержку программного обеспечения в течение не менее 12 (двенадцати) месяцев с даты передачи лицензии. Режим поддержки: 5×8 (рабочие дни, 09:00–18:00 МСК).</p>
                  <p style={pStyle}>Дата версии поставляемого программного обеспечения должна быть не ранее {currentYear} года (актуальная версия на дату поставки).</p>
                </>
              ) : (
                <>
                  <p style={pStyle}>Поставщик обязан предоставить Заказчику оригинал документа, подтверждающего предоставление гарантии производителя Товара на срок не менее 12 (двенадцати) месяцев.</p>
                  <p style={pStyle}>При обнаружении дефектов Товара в течение гарантийного срока, возникших по независящим от Заказчика причинам, Поставщик обязан обеспечить прибытие своего уполномоченного представителя по адресу поставки Товара не позднее 7 дней с момента получения соответствующего уведомления от Заказчика и устранить недостатки Товара. При невозможности проведения ремонта Товара в указанный срок Поставщик обязан за свой счёт заменить Товар ненадлежащего качества новым или аналогичным в течение 30 дней с момента получения письменного уведомления от Заказчика.</p>
                  <p style={pStyle}>Дата выпуска поставляемого Товара должна быть не ранее 1 января {currentYear} г.</p>
                </>
              )}

              {/* Тара и упаковка (только для оборудования) */}
              {!isSW && (
                <>
                  <div style={boldStyle}>Требования к таре и упаковке товара</div>
                  <p style={pStyle}>Поставщик обязан поставить Товар в таре и упаковке, обеспечивающей его сохранность, товарный вид и предохраняющей от повреждений при транспортировке.</p>
                  <p style={pStyle}>Товар должен быть упакован и маркирован в соответствии с технической (эксплуатационной) документацией производителя.</p>
                  <p style={pStyle}>Эксплуатационная документация должна быть вложена в потребительскую тару или транспортную тару вместе с Товаром.</p>
                </>
              )}

              {/* Детализация гарантии */}
              <div style={boldStyle}>Требования к гарантии</div>
              <p style={pStyle}>Требования к нормативно-техническому обеспечению.</p>
              {isSW ? (
                <p style={pStyle}>Поставщик обязан предоставить Заказчику оригиналы или заверенные копии следующих документов при поставке: лицензионный договор (сублицензионное соглашение); выписка из реестра Минцифры России с актуальным регистрационным номером ПО.</p>
              ) : (
                <>
                  <p style={pStyle}>Поставщик обязан предоставить Заказчику оригиналы документов при поставке {g.name.toLowerCase()}:</p>
                  <p style={pStyle}>— документ, подтверждающий предоставление гарантии производителя средств вычислительной техники на срок не менее 12 мес.;</p>
                  <p style={pStyle}>— документ, подтверждающий страну происхождения средств вычислительной техники.</p>
                </>
              )}
              <p style={pStyle}>В течение срока гарантии качества Поставщик гарантирует надлежащее качество Товара.</p>
              <p style={pStyle}>В случае обнаружения недостатков, дефектов в поставленных Товарах, Поставщик, в сроки, установленные Заказчиком, своими силами и за свой счёт устраняет обнаруженные дефекты и недостатки.</p>
              <p style={pStyle}>Все сопутствующие гарантийному обслуживанию мероприятия (доставка, погрузка, разгрузка) осуществляются силами и за счёт Поставщика.</p>

              {/* Место и сроки поставки */}
              <div style={boldStyle}>Место, сроки и условия поставки товара.</div>
              <p style={pStyle}>Место доставки товара: _______________________________________________</p>
              <p style={pStyle}>Срок поставки Товара: не более 60 (шестидесяти) календарных дней с даты заключения {contractWord}.</p>
              <p style={pStyle}>Поставщик обязан согласовать с Заказчиком дату и время поставки товара не позднее, чем за 2 (два) рабочих дня до даты поставки. Поставка осуществляется в рабочее время Заказчика (понедельник – пятница с 9.00 до 13.00 и с 14.00 до 17.00).</p>

              {/* Подпись */}
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 20, fontSize: 12 }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '4px 8px', width: '60%' }}>Заказчик: _________________________ / _________________________</td>
                    <td style={{ padding: '4px 8px' }}>«____» _______________ {currentYear} г.</td>
                  </tr>
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
      {/* Toast-уведомление */}
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 9999,
          background: toast.ok ? '#065F46' : '#7F1D1D',
          color: '#fff', padding: '12px 20px', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)', fontSize: 14, maxWidth: 360,
          animation: 'fadeIn 0.2s ease',
        }}>
          {toast.msg}
        </div>
      )}

      <h2>Рабочая область</h2>

      {/* Режим закона */}
      <div className="checks">
        <label><input type="radio" checked={lawMode === '44'} onChange={() => setLawMode('44')} /> 44-ФЗ</label>
        <label><input type="radio" checked={lawMode === '223'} onChange={() => setLawMode('223')} /> 223-ФЗ</label>
      </div>

      {/* Авторизация / доступ к AI */}
      <div className="workspace-auth-shell">
        <button
          type="button"
          className="workspace-auth-toggle"
          onClick={() => setAuthPanelOpen((v) => !v)}
          aria-expanded={authPanelOpen}
        >
          <span className="workspace-auth-toggle-title">
            <span className={`workspace-auth-dot ${useBackend ? 'is-backend' : 'is-local'}`} aria-hidden="true"></span>
            Авторизация и доступ к AI
          </span>
          <span className="workspace-auth-toggle-meta">
            {useBackend ? (hasUserApiKey ? 'Backend + ваш ключ' : 'Backend') : 'Локально по ключу'}
          </span>
          <span className={`workspace-auth-toggle-chevron ${authPanelOpen ? 'open' : ''}`} aria-hidden="true">▾</span>
        </button>

        <div className={`workspace-auth-collapse ${authPanelOpen ? 'open' : ''}`}>
          <div className="workspace-auth-collapse-inner">
            {useBackend ? (
              <>
                <div style={{ background: '#0F3B1E', border: '1px solid #166534', borderRadius: 8, padding: '10px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, fontSize: 13 }}>
                  <span style={{ color: '#86EFAC' }}>
                    ✅ Сервер подключён{hasUserApiKey ? ' — AI по вашему ключу' : ' — API-ключ не обязателен'}
                  </span>
                  <span style={{ color: '#4ADE80', fontSize: 12 }}>
                    {backendUser?.role === 'admin' ? 'Безлимит (Admin)' : backendUser?.role === 'pro' ? '∞ Pro' : `${backendUser?.tz_count ?? 0}/${backendUser?.tz_limit ?? 3} ТЗ`}
                  </span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', color: '#94A3B8', fontSize: 12 }}>
                    Провайдер:
                    <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} style={{ fontSize: 12, padding: '2px 6px', background: '#1E293B', color: '#E2E8F0', border: '1px solid #334155', borderRadius: 4 }}>
                      <option value="deepseek">DeepSeek</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="groq">Groq</option>
                    </select>
                  </label>
                </div>
                <div className="grid two">
                  <label>
                    Модель
                    <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
                  </label>
                  <label>
                    API-ключ (опционально)
                    <div className="workspace-secret-row">
                      <input
                        type={apiKeyInputType}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="sk-..."
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        className="workspace-secret-toggle"
                        onClick={() => setShowApiKey((v) => !v)}
                        aria-label={showApiKey ? 'Скрыть API-ключ' : 'Показать API-ключ'}
                        title={showApiKey ? 'Скрыть ключ' : 'Показать ключ'}
                      >
                        {showApiKey ? 'Скрыть' : 'Показать'}
                      </button>
                    </div>
                  </label>
                </div>
                <div style={{ fontSize: 12, color: '#94A3B8', padding: '6px 10px', background: '#1E293B', borderRadius: 6, marginBottom: 8 }}>
                  💡 Поле ключа скрывает ввод. Если указать ключ, AI-запросы пойдут напрямую к провайдеру (например, DeepSeek).
                </div>
              </>
            ) : (
              <>
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
                    <div className="workspace-secret-row">
                      <input
                        type={apiKeyInputType}
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="sk-..."
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        className="workspace-secret-toggle"
                        onClick={() => setShowApiKey((v) => !v)}
                        aria-label={showApiKey ? 'Скрыть API-ключ' : 'Показать API-ключ'}
                        title={showApiKey ? 'Скрыть ключ' : 'Показать ключ'}
                      >
                        {showApiKey ? 'Скрыть' : 'Показать'}
                      </button>
                    </div>
                  </label>
                </div>
                {isBackendApiAvailable() && (
                  <div style={{ fontSize: 12, color: '#94A3B8', padding: '6px 10px', background: '#1E293B', borderRadius: 6, marginBottom: 8 }}>
                    💡 <strong style={{ color: '#CBD5E1' }}>Войдите</strong> (кнопка «Войти» вверху справа) — без API-ключа, реальный поиск в интернете и ЕИС.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
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
          onClick={() => mutation.mutate({ trigger: 'manual' })}
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
        <button type="button" onClick={() => exportPackage()}>📦 Экспорт JSON</button>
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
      <div ref={previewRef}>{renderPreview()}</div>
    </section>
  );
}
