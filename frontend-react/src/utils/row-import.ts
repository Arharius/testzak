import JSZip from 'jszip';
import type { SpecItem } from './spec-processor';

export type ImportedRowConfidenceLabel = 'high' | 'medium' | 'low';
export type ImportedRowSourceKind = 'table' | 'appendix' | 'enumerated' | 'fallback' | 'delimited';

export type ImportedRowImportInfo = {
  sourceFormat: 'docx' | 'xlsx' | 'text';
  sourceKind: ImportedRowSourceKind;
  confidence: number;
  confidenceLabel: ImportedRowConfidenceLabel;
  needsReview: boolean;
  notes: string[];
  ignoredBlocks: number;
  sourcePreview: string;
  sourceContextText?: string;
};

export type ImportedProcurementRow = {
  rawType: string;
  description: string;
  licenseType: string;
  term: string;
  qty: number;
  meta?: Record<string, string>;
  specs?: SpecItem[];
  importInfo: ImportedRowImportInfo;
};

type HeaderMap = {
  type?: number;
  description?: number;
  licenseType?: number;
  term?: number;
  qty?: number;
  okpd2?: number;
};

type QtyParseResult = {
  qty: number;
  explicit: boolean;
};

type DocxBlock = {
  kind: 'paragraph' | 'table';
  text?: string;
  rows?: string[][];
};

type ParsedDocxContent = {
  paragraphs: string[];
  tables: string[][][];
  blocks: DocxBlock[];
  documentXmlText: string;
};

const HEADER_ALIASES: Record<keyof HeaderMap, string[]> = {
  type: ['тип', 'тип товара', 'товар', 'товар/услуга', 'позиция', 'наименование', 'предмет', 'номенклатура'],
  description: ['описание', 'модель', 'модель / описание', 'характеристика', 'наименование товара', 'описание позиции'],
  licenseType: ['тип лицензии', 'лицензия', 'вид лицензии', 'тип сертификата', 'тип права'],
  term: ['срок', 'срок действия', 'срок лицензии', 'срок действия лицензии', 'срок поддержки', 'период'],
  qty: ['кол-во', 'количество', 'qty', 'кол', 'объем', 'объём'],
  okpd2: ['окпд2', 'окпд 2', 'код окпд2', 'код окпд 2'],
};

const DOCX_QTY_UNITS =
  '(?:шт\\.?|штук(?:а|и)?|компл(?:ект(?:а|ов)?)?\\.?|комплект(?:а|ов)?|кор\\.?|короб(?:ка|ки)?|наб\\.?|набор(?:а|ов)?|лиц(?:енз(?:ия|ий))?\\.?|усл\\.?|услуг[аи]?|экз\\.?|пар(?:а|ы)?|пользовател(?:я|ей)|рабоч(?:ая|их)\\s+станц(?:ия|ии|ий)|мест(?:о|а)?|сервер(?:а|ов)?|контроллер(?:а|ов)?|устройств(?:о|а)?|медосмотр(?:а|ов)?)';
const DOCX_TRAILING_QTY_RE = new RegExp(
  `(\\d+(?:[.,]\\d+)?)\\s*(?:\\([^)]*\\)\\s*)?${DOCX_QTY_UNITS}(?=\\s*(?:[.;]|$))`,
  'giu',
);
const DOCX_IMPORT_STOP_RE = /^(код окпд2(?:\s|$|[.:])|код ктру(?:\s|$|[.:])|наименование характеристики|значение характеристики|единица измерения характеристики|спецификация(?:\s|$|[.:])|требования к|составил:|согласовано:|утверждаю(?:\s|$|[.:])|техническое задание(?:\s|$|[.:]))/i;
const DOCX_SECTION_HEADING_RE = /^(\d+(?:\.\d+)*\.?\s+|приложение(?:\s|$|[.:])|раздел(?:\s|$|[.:])|глава(?:\s|$|[.:])|составил:|согласовано:|утверждаю(?:\s|$|[.:]))/i;
const DOCX_BOILERPLATE_RE = /^(содержание|заказчик|исполнитель|поставка|сроки|действия|описание|лицензии(?:\s|$|[.:])|правовая безопасность|общие требования|серверной части|клиентской части|требования(?:\s+к.*)?|место оказания|гарантийные обязательства|обновление(?:\s+или)?\s+техническая поддержка|порядок выпуска|документом, подтверждающим право|юридическое резюме|национальный режим|основание\s*\/\s*исключение|подтверждающие документы|источник классификации|классификация позиции|паспорт публикации|сводка готовности|итоговый статус|блокирующие замечания|предупреждения и что проверить|справочная таблица|anti-фас|специалист|«[_\s]*»|_{3,})/i;
const DOCX_APPENDIX_HEADING_RE = /^приложение(?:\s|$|[.:])/i;
const DOCX_OKPD2_PREFIX_RE = /^код окпд2(?:\s|$|[.:])/i;
const DOCX_CLAUSE_PREFIXES = [
  'если',
  'в случае',
  'в течение',
  'в течении',
  'в целях',
  'в соответствии',
  'место',
  'срок',
  'сроки',
  'поставка',
  'приемка',
  'приёмка',
  'заказчик',
  'исполнитель',
  'описание',
  'лицензии',
  'действия',
  'все',
  'документ',
  'условие',
  'условия',
  'порядок',
];
const OKPD2_RE = /\b\d{2}(?:\.\d{2}){2}\.\d{3}\b/;
const NORMATIVE_TEXT_RE = /\b(постановлени|приказ|федеральн(ый|ого)|трудового кодекса|гост|фстэк|фсб|министерств|минздрава|стать[яи]|решени[ея]|реестр|minцифр|правительств)\b/i;
const REQUIREMENT_TEXT_RE = /\b(должен|должна|должны|обязан|обязана|обязаны|требования|осуществляется|обеспечивает|соответств|гаранти|сроки оказания|место проведения|приемк|приёмк|документац)\b/i;

function normalizeCell(value: string): string {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2000-\u200d\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHeader(value: string): string {
  return normalizeCell(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.:;"'()]/g, '')
    // Схлопываем пробелы вокруг дефисов (артефакт переноса строк в ячейках DOCX)
    // "кол- во" → "кол-во", "прил №" остаётся как есть
    .replace(/\s*-\s+/g, '-')
    .replace(/\s+-\s*/g, '-');
}

function normalizeDocxLine(value: string): string {
  return normalizeCell(
    value
      .replace(/[‐‑‒–—]/g, '-')
      .replace(/^[•▪●◦]\s*/u, '')
      .replace(/^\d+\)\s*/, '')
      .replace(/^\d+\.\s+/, ''),
  );
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function trimPreviewText(value: string, maxLen = 220): string {
  const source = normalizeCell(value);
  if (source.length <= maxLen) return source;
  return `${source.slice(0, Math.max(0, maxLen - 1))}…`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function detectConfidenceLabel(value: number): ImportedRowConfidenceLabel {
  if (value >= 0.9) return 'high';
  if (value >= 0.75) return 'medium';
  return 'low';
}

function extractOkpd2Code(text: string): string {
  return normalizeCell(text).match(OKPD2_RE)?.[0] || '';
}

function looksLikeNormativeText(text: string): boolean {
  return NORMATIVE_TEXT_RE.test(text);
}

function looksLikeRequirementText(text: string): boolean {
  return REQUIREMENT_TEXT_RE.test(text);
}

function countMeaningfulWords(text: string): number {
  return normalizeCell(text)
    .split(/\s+/)
    .map((part) => part.replace(/^[^a-zA-Zа-яА-Я0-9]+|[^a-zA-Zа-яА-Я0-9]+$/g, ''))
    .filter((part) => part.length >= 2)
    .length;
}

function looksLikeCompactProductName(text: string): boolean {
  const normalized = normalizeCell(text);
  if (!normalized) return false;
  if (countMeaningfulWords(normalized) >= 2) return true;
  return normalized.length >= 6;
}

function looksLikeBoilerplateHeading(text: string): boolean {
  const normalized = normalizeCell(text);
  if (!normalized) return true;
  if (DOCX_IMPORT_STOP_RE.test(normalized) || DOCX_SECTION_HEADING_RE.test(normalized) || DOCX_BOILERPLATE_RE.test(normalized)) {
    return true;
  }
  if (countMeaningfulWords(normalized) <= 1 && !findTrailingQty(normalizeDocxLine(normalized)) && !looksLikeCompactProductName(normalized)) {
    return true;
  }
  return false;
}

function looksLikeClauseFragment(text: string): boolean {
  const normalized = normalizeCell(text).toLowerCase().replace(/ё/g, 'е');
  if (!normalized) return true;
  if (!DOCX_CLAUSE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return false;
  if (countMeaningfulWords(normalized) <= 6) return true;
  return looksLikeRequirementText(normalized) || looksLikeNormativeText(normalized);
}

function shouldRejectImportText(text: string): boolean {
  return looksLikeBoilerplateHeading(text) || looksLikeClauseFragment(text);
}

function chooseDelimiter(sample: string): string {
  const candidates = [';', '\t', ','];
  const firstLines = sample.split(/\r?\n/).slice(0, 6).join('\n');
  const scored = candidates.map((delimiter) => ({
    delimiter,
    score: (firstLines.match(new RegExp(delimiter === '\t' ? '\\t' : `\\${delimiter}`, 'g')) || []).length,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0].delimiter : ';';
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === delimiter && !quoted) {
      result.push(normalizeCell(current));
      current = '';
      continue;
    }
    current += char;
  }
  result.push(normalizeCell(current));
  return result;
}

function parseDelimitedText(text: string): string[][] {
  const delimiter = chooseDelimiter(text);
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseDelimitedLine(line, delimiter));
}

function columnRefToIndex(ref: string): number {
  let value = 0;
  for (let i = 0; i < ref.length; i += 1) {
    value = value * 26 + (ref.charCodeAt(i) - 64);
  }
  return value - 1;
}

async function resolveWorksheetPath(zip: JSZip, workbookXml: Document): Promise<string | null> {
  const workbookRelXml = zip.file('xl/_rels/workbook.xml.rels');
  if (!workbookRelXml) return null;

  const workbookRels = new DOMParser().parseFromString(await workbookRelXml.async('text'), 'application/xml');
  const relationships = Array.from(workbookRels.getElementsByTagName('Relationship'));
  const sheets = Array.from(workbookXml.getElementsByTagName('sheet'));
  const firstSheet = sheets[0];
  if (!firstSheet) return null;

  const relId = firstSheet.getAttribute('r:id');
  const relationship = relationships.find((node) => node.getAttribute('Id') === relId);
  const target = relationship?.getAttribute('Target');
  if (!target) return null;
  return target.startsWith('xl/') ? target : `xl/${target.replace(/^\/+/, '')}`;
}

function parseSharedStrings(xmlText: string): string[] {
  const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
  return Array.from(xml.getElementsByTagName('si')).map((si) =>
    normalizeCell(
      Array.from(si.getElementsByTagName('t'))
        .map((node) => node.textContent || '')
        .join(''),
    ),
  );
}

function parseXlsxRows(buffer: ArrayBuffer): Promise<string[][]> {
  return JSZip.loadAsync(buffer).then(async (zip) => {
    const workbookFile = zip.file('xl/workbook.xml');
    if (!workbookFile) throw new Error('Файл XLSX не содержит workbook.xml');

    const workbookText = await workbookFile.async('text');
    const workbookXml = new DOMParser().parseFromString(workbookText, 'application/xml');
    const sheetPath = await resolveWorksheetPath(zip, workbookXml);
    if (!sheetPath) throw new Error('Не удалось определить первый лист XLSX');

    const sharedStringsFile = zip.file('xl/sharedStrings.xml');
    const sharedStrings = sharedStringsFile ? parseSharedStrings(await sharedStringsFile.async('text')) : [];
    const worksheetFile = zip.file(sheetPath);
    if (!worksheetFile) throw new Error('Не найден первый лист XLSX');

    const worksheetXml = new DOMParser().parseFromString(await worksheetFile.async('text'), 'application/xml');
    const rows = Array.from(worksheetXml.getElementsByTagName('row'));
    return rows
      .map((row) => {
        const values: string[] = [];
        const cells = Array.from(row.getElementsByTagName('c'));
        for (const cell of cells) {
          const ref = cell.getAttribute('r') || '';
          const refLetters = (ref.match(/[A-Z]+/i)?.[0] || '').toUpperCase();
          const idx = refLetters ? columnRefToIndex(refLetters) : values.length;
          const type = cell.getAttribute('t') || '';
          let value = '';
          if (type === 'inlineStr') {
            value = normalizeCell(
              Array.from(cell.getElementsByTagName('t'))
                .map((node) => node.textContent || '')
                .join(''),
            );
          } else {
            const raw = cell.getElementsByTagName('v')[0]?.textContent || '';
            if (type === 's') {
              value = normalizeCell(sharedStrings[Number(raw)] || '');
            } else {
              value = normalizeCell(raw);
            }
          }
          values[idx] = value;
        }
        return values.map((entry) => normalizeCell(entry || ''));
      })
      .filter((row) => row.some(Boolean));
  });
}

function getNodeLocalName(node: Node): string {
  if (node.nodeType !== 1) return '';
  const element = node as Element;
  return element.localName || element.nodeName.split(':').pop() || '';
}

function getChildElements(node: ParentNode, localName?: string): Element[] {
  return Array.from(node.childNodes).filter((child): child is Element => {
    if (child.nodeType !== 1) return false;
    return !localName || getNodeLocalName(child) === localName;
  });
}

function countDescendantElements(node: ParentNode, localName: string): number {
  let count = 0;
  for (const child of getChildElements(node)) {
    if (getNodeLocalName(child) === localName) count += 1;
    count += countDescendantElements(child, localName);
  }
  return count;
}

function collectDocxInlineText(node: Node, parts: string[]): void {
  if (node.nodeType !== 1) return;
  const localName = getNodeLocalName(node);
  if (localName === 't') {
    parts.push(node.textContent || '');
    return;
  }
  if (localName === 'tab') {
    parts.push('\t');
    return;
  }
  if (localName === 'br' || localName === 'cr') {
    parts.push('\n');
    return;
  }
  Array.from(node.childNodes).forEach((child) => collectDocxInlineText(child, parts));
}

function extractDocxParagraphText(paragraph: Element): string {
  const parts: string[] = [];
  Array.from(paragraph.childNodes).forEach((child) => collectDocxInlineText(child, parts));
  return normalizeCell(parts.join('').replace(/\s*\n\s*/g, ' '));
}

function extractDocxCellText(cell: Element): string {
  return normalizeCell(
    getChildElements(cell, 'p')
      .map((paragraph) => extractDocxParagraphText(paragraph))
      .filter(Boolean)
      .join(' '),
  );
}

function parseDirectDocxTableRows(table: Element): string[][] {
  return getChildElements(table, 'tr')
    .map((row) => getChildElements(row, 'tc').map((cell) => extractDocxCellText(cell)))
    .map((row) => row.map((cell) => normalizeCell(cell)))
    .filter((row) => row.some(Boolean));
}

function extractDocxTablesFromTable(table: Element, result: string[][][]): void {
  const rows = parseDirectDocxTableRows(table);
  const nestedTableCount = countDescendantElements(table, 'tbl');
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const wrapperTable = nestedTableCount > 0 && maxCols <= 1;
  if (wrapperTable) {
    collectDocxTables(table, result);
    return;
  }
  if (rows.length > 0) {
    result.push(rows);
  }
}

function collectDocxTables(node: ParentNode, result: string[][][]): void {
  for (const child of getChildElements(node)) {
    if (getNodeLocalName(child) === 'tbl') {
      extractDocxTablesFromTable(child, result);
      continue;
    }
    collectDocxTables(child, result);
  }
}

function collectDocxBlocks(
  node: ParentNode,
  paragraphs: string[],
  tables: string[][][],
  blocks: DocxBlock[],
): void {
  for (const child of getChildElements(node)) {
    const localName = getNodeLocalName(child);
    if (localName === 'p') {
      const text = extractDocxParagraphText(child);
      if (text) {
        paragraphs.push(text);
        blocks.push({ kind: 'paragraph', text });
      }
    } else if (localName === 'tbl') {
      const extractedTables: string[][][] = [];
      extractDocxTablesFromTable(child, extractedTables);
      for (const rows of extractedTables) {
        tables.push(rows);
        blocks.push({ kind: 'table', rows });
      }
    } else if (
      localName === 'sdt' ||
      localName === 'sdtContent' ||
      localName === 'txbxContent' ||
      localName === 'smartTag'
    ) {
      collectDocxBlocks(child, paragraphs, tables, blocks);
    }
  }
}

async function parseDocxContent(buffer: ArrayBuffer): Promise<ParsedDocxContent> {
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error('Файл DOCX не содержит word/document.xml');

  const documentXmlText = await documentFile.async('text');
  const xml = new DOMParser().parseFromString(documentXmlText, 'application/xml');
  const body = Array.from(xml.getElementsByTagName('*')).find((node) => node.localName === 'body');
  if (!body) throw new Error('Не удалось прочитать содержимое DOCX');

  const paragraphs: string[] = [];
  const tables: string[][][] = [];
  const blocks: DocxBlock[] = [];
  collectDocxBlocks(body, paragraphs, tables, blocks);
  return { paragraphs, tables, blocks, documentXmlText };
}

function findTrailingQty(text: string): { qty: number; index: number } | null {
  const matches = Array.from(text.matchAll(DOCX_TRAILING_QTY_RE));
  const last = matches[matches.length - 1];
  if (!last || last.index === undefined) return null;
  return { qty: parseQty(last[1] || '1'), index: last.index };
}

function parseCommercialMeta(text: string): Pick<ImportedProcurementRow, 'licenseType' | 'term'> {
  const normalized = normalizeCell(text);
  const termMatch = normalized.match(/(\d+\s*(?:мес(?:\.|яц(?:а|ев)?)?|год(?:а|ов)?|лет))/i);
  let licenseType = '';
  if (/на срок действия исключительного права/i.test(normalized)) {
    licenseType = 'на срок действия исключительного права';
  } else if (/подписк/i.test(normalized)) {
    licenseType = 'подписка';
  } else if (/лиценз/i.test(normalized)) {
    licenseType = 'лицензия';
  }
  return {
    licenseType,
    term: termMatch ? normalizeCell(termMatch[1]) : '',
  };
}

function buildImportInfo(
  sourceFormat: ImportedRowImportInfo['sourceFormat'],
  sourceKind: ImportedRowSourceKind,
  sourceText: string,
  description: string,
  notes: string[],
  options: {
    qty?: number;
    qtyExplicit?: boolean;
    specs?: SpecItem[];
    meta?: Record<string, string>;
    ignoredBlocks?: number;
    sourceContextText?: string;
  } = {},
): ImportedRowImportInfo {
  const baseByKind: Record<ImportedRowSourceKind, number> = {
    table: 0.96,
    appendix: 0.92,
    enumerated: 0.87,
    fallback: 0.72,
    delimited: 0.9,
  };
  let confidence = baseByKind[sourceKind];
  const noteSet = new Set(notes.filter(Boolean));
  if (!options.qtyExplicit) {
    confidence -= 0.12;
    noteSet.add('Количество не выделено явно, подставлено значение по умолчанию.');
  }
  if (options.specs && options.specs.length > 0) {
    confidence += 0.04;
  }
  if (options.meta?.okpd2_code) {
    confidence += 0.03;
  }
  if (looksLikeNormativeText(description)) {
    confidence -= 0.12;
    noteSet.add('Описание содержит нормативные признаки, нужна проверка, что это именно позиция закупки.');
  }
  if (looksLikeRequirementText(description) && sourceKind === 'fallback') {
    confidence -= 0.1;
  }
  if (description.length > 240) {
    confidence -= 0.08;
    noteSet.add('Описание получилось очень длинным, лучше проверить границы позиции.');
  }
  confidence = clamp(confidence, 0.35, 0.99);
  const confidenceLabel = detectConfidenceLabel(confidence);
  const reviewRequired = confidenceLabel !== 'high' || Array.from(noteSet).some((note) => /провер|не выделено|норматив|длинным|шапки/i.test(note));
  return {
    sourceFormat,
    sourceKind,
    confidence,
    confidenceLabel,
    needsReview: reviewRequired,
    notes: Array.from(noteSet),
    ignoredBlocks: options.ignoredBlocks || 0,
    sourcePreview: trimPreviewText(sourceText || description),
    sourceContextText: options.sourceContextText ? trimPreviewText(options.sourceContextText, 4000) : undefined,
  };
}

function makeImportedRow(params: {
  rawType: string;
  description: string;
  licenseType: string;
  term: string;
  qty: number;
  qtyExplicit?: boolean;
  sourceFormat: ImportedRowImportInfo['sourceFormat'];
  sourceKind: ImportedRowSourceKind;
  sourceText: string;
  notes?: string[];
  meta?: Record<string, string>;
  specs?: SpecItem[];
  ignoredBlocks?: number;
  sourceContextText?: string;
}): ImportedProcurementRow {
  const description = normalizeCell(params.description || params.rawType);
  const notes = [...(params.notes || [])];
  if (params.specs?.length) {
    notes.push(`Из исходного файла импортировано характеристик: ${params.specs.length}.`);
  }
  if (params.meta?.okpd2_code) {
    notes.push(`Из исходного файла извлечен ОКПД2: ${params.meta.okpd2_code}.`);
  }
  return {
    rawType: normalizeCell(params.rawType || description),
    description,
    licenseType: normalizeCell(params.licenseType),
    term: normalizeCell(params.term),
    qty: params.qty > 0 ? params.qty : 1,
    meta: params.meta,
    specs: params.specs,
    importInfo: buildImportInfo(
      params.sourceFormat,
      params.sourceKind,
      params.sourceText,
      description,
      notes,
      {
        qty: params.qty,
        qtyExplicit: params.qtyExplicit,
        specs: params.specs,
        meta: params.meta,
        ignoredBlocks: params.ignoredBlocks,
        sourceContextText: params.sourceContextText,
      },
    ),
  };
}

const WEB_NAV_TERMS_RE = /^(home|consumers|utilities|transportation|about(\s+us)?|documents(\s+and\s+rules)?|news|events|help(\s+center)?|search|title|content(\s+viewer)?|contact|login|logout|register|signup|faq|sitemap|privacy|terms|navigation|menu|footer|header|breadcrumb|back|next|previous|skip|jump|sort(\s+by)?|sign(\s+(in|out|up))?|log(\s+(in|out))?|view\s+all|see\s+all|load\s+more|show\s+more|read\s+more|community|announcements?|feature\s+requests?)$/i;
const BARE_DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.(gov|com|org|net|ru|рф|edu|io|info|biz)$/i;
const URL_PATH_RE = /^\/[a-z0-9/._-]{3,}$/i;
// URL embedded anywhere in string
const EMBEDDED_URL_RE = /https?:\/\/[a-z0-9]/i;
// Markdown bold/italic
const MARKDOWN_STYLE_RE = /^\*{1,3}[^*]+\*{1,3}$/;

function isValidSpecName(name: string): boolean {
  if (!name) return false;
  if (/^#+\s/.test(name)) return false;        // # Markdown heading
  if (/^\[/.test(name)) return false;           // [Markdown link
  if (/^!\[/.test(name)) return false;          // ![Image
  if (/^https?:\/\//i.test(name)) return false; // full URL
  if (/^\/\//.test(name)) return false;         // protocol-relative URL
  if (BARE_DOMAIN_RE.test(name)) return false;  // bare domain
  if (WEB_NAV_TERMS_RE.test(name.trim())) return false; // nav terms
  // "Title: Long English text" / "Sort by: something" — web page metadata pattern
  if (/^title:\s/i.test(name)) return false;
  // Purely English name that looks like web metadata (no Cyrillic, has colon followed by content)
  if (/:\s+[A-Z]/.test(name) && !/[а-яёА-ЯЁ]/.test(name) && name.length > 20) return false;
  return true;
}

function isValidSpecValue(value: string): boolean {
  if (!value) return true;
  if (/^https?:\/\//i.test(value)) return false;    // starts with URL
  if (/^\/\/[a-z0-9]/i.test(value)) return false;   // protocol-relative URL
  if (BARE_DOMAIN_RE.test(value.trim())) return false; // bare domain
  if (URL_PATH_RE.test(value.trim())) return false;  // URL path
  if (MARKDOWN_STYLE_RE.test(value.trim())) return false; // **bold** / *italic*
  // URL embedded anywhere in the value (e.g. Spanish ASUS text with https:// link)
  if (EMBEDDED_URL_RE.test(value)) return false;
  return true;
}

// Tier-1 (specific to spec tables) header aliases
const SPEC_NAME_COL_EXACT = new Set([
  'наименование характеристики',
  'наименование параметра',
  'наименование показателя',
  'наименование требования',
  'характеристика',
  'параметр',
  'показатель',
  'требование',
]);
const SPEC_VALUE_COL_EXACT = new Set([
  'значение характеристики',
  'требуемое значение',
  'требуемое значение параметра',
  'требуемые значения',
  'значение параметра',
  'требуемые характеристики',
  'технические требования',
  'минимальные требования',
  'спецификация',
]);
// Tier-2 (looser) — accepted only when paired with a Tier-1 on the other column
const SPEC_NAME_COL_LOOSE = new Set([
  ...SPEC_NAME_COL_EXACT,
  'наименование',
  'наименование позиции',
  'наименование товара',
  'наименование изделия',
  'наименование оборудования',
  'наименование технической характеристики',
  'название',
  'name',
  'parameter',
]);
const SPEC_VALUE_COL_LOOSE = new Set([
  ...SPEC_VALUE_COL_EXACT,
  'значение',
  'требования',
  'value',
  'specification',
  'описание',
]);

function isMergedHeaderRow(row: string[]): boolean {
  if (row.length < 2) return true;
  const first = normalizeCell(row[0] || '');
  if (!first) return false;
  return row.every((cell) => normalizeCell(cell) === first);
}

function findSpecHeaderIndex(rows: string[][]): number {
  if (rows.length < 2) return 0;
  if (rows[0].length === 1 && rows.length > 2) return 1;
  if (isMergedHeaderRow(rows[0]) && rows.length > 2) return 1;
  return 0;
}

function looksLikeHeaderlessSpecTable(rows: string[][]): boolean {
  // No recognized headers — try heuristic: 2-3 col table whose first col cells
  // look like spec names (short, Russian, no URL) and second col looks like values
  if (rows.length < 4 || rows[0].length < 2 || rows[0].length > 4) return false;
  const sample = rows.slice(0, Math.min(rows.length, 10));
  const specLikeCols0 = sample.filter((row) => {
    const n = normalizeCell(row[0] || '');
    return n.length > 2 && n.length < 60 && isValidSpecName(n);
  }).length;
  const hasValues = sample.filter((row) => {
    const v = normalizeCell(row[1] || '');
    return v.length > 0 && isValidSpecValue(v);
  }).length;
  return specLikeCols0 / sample.length >= 0.7 && hasValues / sample.length >= 0.5;
}

function isSpecTable(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const headerIndex = findSpecHeaderIndex(rows);
  const headers = rows[headerIndex].map((cell) => normalizeHeader(cell));

  const nameExact = headers.some((h) => SPEC_NAME_COL_EXACT.has(h));
  const valueExact = headers.some((h) => SPEC_VALUE_COL_EXACT.has(h));
  const nameLoose = headers.some((h) => SPEC_NAME_COL_LOOSE.has(h));
  const valueLoose = headers.some((h) => SPEC_VALUE_COL_LOOSE.has(h));

  // Accept: both exact, or one exact + one loose (prevents generic "Название|Описание" false positives)
  const hasSpecHeaders = (nameExact && valueLoose) || (valueExact && nameLoose);

  // Fallback: no recognized headers → try content heuristic
  if (!hasSpecHeaders) {
    // Guard: if the header contains procurement-specific columns (qty, okpd2, licenseType, term)
    // this is a procurement table, not a spec table.
    const hmap = detectHeaderMap(rows[headerIndex] || []);
    const hasProcHeaders = hmap.qty !== undefined || hmap.okpd2 !== undefined
      || hmap.licenseType !== undefined || hmap.term !== undefined;
    if (hasProcHeaders) return false;
    return looksLikeHeaderlessSpecTable(rows.slice(headerIndex));
  }

  const { nameCol, valueCol } = detectSpecColumnOrder(rows[headerIndex] || []);
  const dataRows = rows.slice(headerIndex + 1).filter((row) => {
    const first = normalizeCell(row[0] || '');
    const name = normalizeCell(row[nameCol] || '');
    const value = normalizeCell(row[valueCol] || '');
    // Skip merged product-name rows (all cells identical)
    if (first && row.every((cell) => normalizeCell(cell) === first)) return false;
    return (name || value) && !(name && !value && !(row[nameCol + 1] || '').trim());
  });
  if (dataRows.length === 0) return true;
  const validCount = dataRows.filter((row) => {
    const name = normalizeCell(row[nameCol] || '');
    const value = normalizeCell(row[valueCol] || '');
    return isValidSpecName(name) && isValidSpecValue(value);
  }).length;
  return validCount / dataRows.length >= 0.4;
}

function detectSpecColumnOrder(headerRow: string[]): { nameCol: number; valueCol: number; unitCol: number } {
  // 4-column format: "№ п/п | Наименование позиции | Единица измерения | Требуемое значение параметра"
  // Detect by checking if col0 is a number/serial column, then shift all columns by 1
  if (headerRow.length >= 4) {
    const col0 = normalizeHeader(headerRow[0]);
    const col0IsSerial = /^(№|#|nn|n°|номер|num|no\.?)(\s*(п\/п|п\.п\.|пп))?$/.test(col0);
    if (col0IsSerial) {
      const col1 = normalizeHeader(headerRow[1]);
      const col2 = normalizeHeader(headerRow[2]);
      const col3 = headerRow.length >= 4 ? normalizeHeader(headerRow[3]) : '';
      const col1IsUnit = /единиц|ед\.?\s*(изм|измер)|unit/.test(col1);
      const col2IsUnit = /единиц|ед\.?\s*(изм|измер)|unit/.test(col2);
      const col3IsUnit = /единиц|ед\.?\s*(изм|измер)|unit/.test(col3);
      const col2IsValue = /значение|требован|value|specification/.test(col2);
      // "№ | name | unit | value"  — e.g. MES2300B-48
      if (col2IsUnit) return { nameCol: 1, valueCol: 3, unitCol: 2 };
      // "№ | name | value | unit"  — e.g. "№ | Наим. хар-ки | Значение / требование | Ед. изм."
      if (col3IsUnit || col2IsValue) return { nameCol: 1, valueCol: 2, unitCol: 3 };
      // "№ | unit | name | value" — exotic, rarely used
      if (col1IsUnit) return { nameCol: 2, valueCol: 3, unitCol: 1 };
      // fallback — assume "№ | name | value | unit"
      return { nameCol: 1, valueCol: 2, unitCol: 3 };
    }
  }
  // Default: name(0) | value(1) | unit(2)
  // Alternative: name(0) | unit(1) | value(2)  — common in Russian gov procurement docs
  if (headerRow.length >= 3) {
    const col1 = normalizeHeader(headerRow[1]);
    const col2 = normalizeHeader(headerRow[2]);
    const col1IsUnit = /единиц|ед\.?\s*(изм|измер)|unit/.test(col1);
    const col2IsValue = /значение|требован|value|specification/.test(col2);
    if (col1IsUnit && col2IsValue) return { nameCol: 0, valueCol: 2, unitCol: 1 };
  }
  return { nameCol: 0, valueCol: 1, unitCol: 2 };
}

function parseSpecTable(rows: string[][]): SpecItem[] {
  const specs: SpecItem[] = [];
  const headerIndex = findSpecHeaderIndex(rows);
  const headerRow = rows[headerIndex] || [];
  const { nameCol, valueCol, unitCol } = detectSpecColumnOrder(headerRow);
  let currentGroup = 'Технические характеристики';
  for (const row of rows.slice(headerIndex + 1)) {
    const first = normalizeCell(row[0] || '');
    const name = normalizeCell(row[nameCol] || '');
    const rawValue = normalizeCell(row[valueCol] || '');
    const unit = normalizeCell(row[unitCol] || '') || '—';
    // Пропускаем объединённые строки-заголовки товара (все ячейки одинаковые)
    if (first && row.every((cell) => normalizeCell(cell) === first)) continue;
    if (!name && !rawValue) continue;
    if (name && !rawValue && !(row[nameCol + 1] || '').trim()) {
      currentGroup = name;
      continue;
    }
    if (!isValidSpecName(name) || !isValidSpecValue(rawValue)) continue;
    specs.push({
      group: currentGroup,
      name,
      value: rawValue || 'Да',
      unit,
    });
  }
  return specs;
}

function isDocxSummaryTable(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const headers = rows[0].map((cell) => normalizeHeader(cell));
  const hasName = headers.includes('наименование');
  const hasOkpd2 = headers.includes('окпд2') || headers.includes('окпд 2');
  const hasAppendix = headers.some((cell) => cell.includes('прил'));
  const hasCommercial = headers.includes('тип лицензии') || headers.includes('срок действия');
  const hasQty = headers.some((cell) => HEADER_ALIASES.qty.includes(cell));
  // Стандартный формат с коммерческими полями, или упрощённый формат ТЗ-генератора (без тип лицензии/срок)
  return hasName && hasOkpd2 && hasAppendix && (hasCommercial || hasQty);
}

function collectRequirementContext(lines: string[]): { text: string; count: number } {
  const picked = lines
    .map((line) => normalizeCell(line))
    .filter((line) => line.length > 20)
    .filter((line) => !DOCX_IMPORT_STOP_RE.test(line))
    .filter((line) => !extractOkpd2Code(line))
    .filter((line) => looksLikeRequirementText(line) || looksLikeNormativeText(line) || /^•/.test(line))
    .slice(0, 24);
  return {
    text: picked.join('\n'),
    count: picked.length,
  };
}

function buildImportedRowFromText(text: string, sourceKind: Exclude<ImportedRowSourceKind, 'delimited'>, options?: {
  allowWithoutQty?: boolean;
  notes?: string[];
  specs?: SpecItem[];
  meta?: Record<string, string>;
  sourceContextText?: string;
  ignoredBlocks?: number;
  qtyExplicit?: boolean;
}): ImportedProcurementRow | null {
  const cleaned = normalizeDocxLine(text).replace(/[-:;,.]+$/u, '').trim();
  if (!cleaned || DOCX_IMPORT_STOP_RE.test(cleaned)) return null;

  const qtyMatch = findTrailingQty(cleaned);
  if (!qtyMatch && !options?.allowWithoutQty) return null;

  const description = normalizeDocxLine(qtyMatch ? cleaned.slice(0, qtyMatch.index) : cleaned)
    .replace(/[-:;,.]+$/u, '')
    .trim();
  if (!description || description.length < 4 || shouldRejectImportText(description)) return null;

  const meta = options?.meta ? { ...options.meta } : {};
  const inlineOkpd2 = extractOkpd2Code(cleaned);
  if (inlineOkpd2 && !meta.okpd2_code) meta.okpd2_code = inlineOkpd2;

  const commercial = parseCommercialMeta(cleaned);
  return makeImportedRow({
    rawType: description,
    description,
    licenseType: commercial.licenseType,
    term: commercial.term,
    qty: qtyMatch?.qty || 1,
    qtyExplicit: options?.qtyExplicit ?? !!qtyMatch,
    meta,
    specs: options?.specs,
    notes: options?.notes,
    sourceFormat: 'docx',
    sourceKind,
    sourceText: cleaned,
    ignoredBlocks: options?.ignoredBlocks,
    sourceContextText: options?.sourceContextText,
  });
}

function detectHeaderMap(row: string[]): HeaderMap {
  const map: HeaderMap = {};
  row.forEach((cell, idx) => {
    const header = normalizeHeader(cell);
    for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<[keyof HeaderMap, string[]]>) {
      if (aliases.includes(header)) {
        map[key] = idx;
      }
    }
  });
  return map;
}

function parseQty(value: string): number {
  const cleaned = normalizeCell(value).replace(',', '.');
  const num = Number(cleaned.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(num) || num <= 0) return 1;
  return Math.max(1, Math.round(num));
}

function parseQtyCell(value: string): QtyParseResult {
  const cleaned = normalizeCell(value);
  return {
    qty: parseQty(cleaned || '1'),
    explicit: /\d/.test(cleaned),
  };
}

function extractRowDescription(row: string[], map: HeaderMap): string {
  const primaryIndex = map.type ?? map.description ?? 0;
  const descriptionIndex = map.description ?? map.type ?? primaryIndex;
  const primary = normalizeCell(row[primaryIndex] || '');
  const description = normalizeCell(row[descriptionIndex] || primary);
  if (description && description !== primary) return description;
  return primary;
}

const CLAUSE_NUM_RE = /^(\d+\.\d+|[РПРР]\.\d+|РР?\.\d+|ПП?\.\d+)\s*$/;

function isDocxClauseTable(rows: string[][]): boolean {
  if (rows.length < 3) return false;
  const firstRow = rows[0];
  if (firstRow.length === 2) {
    const h0 = normalizeHeader(firstRow[0]);
    const h1 = normalizeHeader(firstRow[1]);
    if ((h0 === 'пункт' || h0 === '№' || h0 === 'п') && (h1 === 'содержание' || h1 === 'описание')) return true;
  }
  const dataRows = rows.slice(1, Math.min(rows.length, 8));
  const clauseCount = dataRows.filter((row) => CLAUSE_NUM_RE.test(normalizeCell(row[0] || ''))).length;
  return clauseCount >= Math.max(2, Math.floor(dataRows.length * 0.5));
}

function isLikelyProcurementTable(rawRows: string[][]): boolean {
  if (rawRows.length < 2 || isSpecTable(rawRows) || isDocxClauseTable(rawRows)) return false;

  const headerMap = detectHeaderMap(rawRows[0]);
  const hasHeader = Object.keys(headerMap).length > 0;
  if (hasHeader) {
    const hasNameColumn = headerMap.type !== undefined || headerMap.description !== undefined;
    const hasProcurementSignals =
      headerMap.qty !== undefined ||
      headerMap.okpd2 !== undefined ||
      headerMap.licenseType !== undefined ||
      headerMap.term !== undefined;
    if (!hasNameColumn || !hasProcurementSignals) return false;
  }
  const dataRows = hasHeader ? rawRows.slice(1) : rawRows;
  if (dataRows.length === 0) return false;

  const fallbackMap: HeaderMap = hasHeader
    ? headerMap
    : { type: 0, description: 1, licenseType: 2, term: 3, qty: 4, okpd2: 5 };

  let candidateRows = 0;
  for (const row of dataRows.slice(0, 12)) {
    const description = extractRowDescription(row, fallbackMap);
    if (!description || shouldRejectImportText(description)) continue;
    const qtyCell = normalizeCell(row[fallbackMap.qty ?? -1] || '');
    const explicitQty = /\d/.test(qtyCell) || !!findTrailingQty(normalizeDocxLine(description));
    const hasOkpd2 = !!extractOkpd2Code(row.join(' | '));
    if (countMeaningfulWords(description) >= 2 && (explicitQty || hasOkpd2 || description.length >= 24)) {
      candidateRows += 1;
    }
  }

  if (hasHeader) {
    return candidateRows >= Math.max(1, Math.min(2, dataRows.length));
  }
  return candidateRows >= 2;
}

function mapRows(
  rawRows: string[][],
  sourceFormat: ImportedRowImportInfo['sourceFormat'],
  sourceKind: ImportedRowSourceKind = 'delimited',
): ImportedProcurementRow[] {
  if (rawRows.length === 0) return [];

  const headerMap = detectHeaderMap(rawRows[0]);
  const hasHeader = Object.keys(headerMap).length > 0;
  const dataRows = hasHeader ? rawRows.slice(1) : rawRows;
  const fallbackMap: HeaderMap = hasHeader
    ? headerMap
    : { type: 0, description: 1, licenseType: 2, term: 3, qty: 4, okpd2: 5 };

  return dataRows
    .map((row) => {
      const primaryIndex = fallbackMap.type ?? fallbackMap.description ?? 0;
      const rawType = normalizeCell(row[primaryIndex] || '');
      const description = extractRowDescription(row, fallbackMap);
      const licenseType = normalizeCell(row[fallbackMap.licenseType ?? -1] || '');
      const term = normalizeCell(row[fallbackMap.term ?? -1] || '');
      const qtyParsed = parseQtyCell(row[fallbackMap.qty ?? -1] || '');
      const qty = qtyParsed.qty;
      const okpd2 = extractOkpd2Code(row[fallbackMap.okpd2 ?? -1] || '');
      if ((!rawType && !description) || shouldRejectImportText(description || rawType)) return null;
      return makeImportedRow({
        rawType: rawType || description,
        description,
        licenseType,
        term,
        qty,
        qtyExplicit: qtyParsed.explicit,
        sourceFormat,
        sourceKind,
        sourceText: row.join(' | '),
        meta: okpd2 ? { okpd2_code: okpd2 } : undefined,
        notes: hasHeader ? [] : ['Файл не содержал явной шапки колонок, строки распознаны по порядку столбцов.'],
      });
    })
    .filter((row): row is ImportedProcurementRow => !!row);
}

function dedupeImportedRows(rows: ImportedProcurementRow[]): ImportedProcurementRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [
      normalizeHeader(row.description),
      row.qty,
      normalizeHeader(row.licenseType),
      normalizeHeader(row.term),
    ].join('|');
    if (!row.description || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractOkpdFromBlocks(blocks: DocxBlock[], fromIndex: number, toIndex: number): string {
  for (let index = fromIndex; index < toIndex; index += 1) {
    const block = blocks[index];
    if (block.kind !== 'paragraph') continue;
    const code = extractOkpd2Code(block.text || '');
    if (code) return code;
  }
  return '';
}

function extractFirstSpecTable(blocks: DocxBlock[], fromIndex: number, toIndex: number): SpecItem[] {
  for (let index = fromIndex; index < toIndex; index += 1) {
    const block = blocks[index];
    if (block.kind === 'table' && block.rows && isSpecTable(block.rows)) {
      return parseSpecTable(block.rows);
    }
  }
  return [];
}

function findNextBlockIndex(blocks: DocxBlock[], fromIndex: number, predicate: (block: DocxBlock) => boolean): number {
  for (let index = fromIndex; index < blocks.length; index += 1) {
    if (predicate(blocks[index])) return index;
  }
  return blocks.length;
}

function parseDocxTableRows(blocks: DocxBlock[]): ImportedProcurementRow[] {
  const rows: ImportedProcurementRow[] = [];
  for (const block of blocks) {
    if (block.kind !== 'table' || !block.rows || isDocxSummaryTable(block.rows) || !isLikelyProcurementTable(block.rows)) continue;
    rows.push(...mapRows(block.rows, 'docx', 'table'));
  }
  return dedupeImportedRows(rows);
}

function buildDocxSpecTableMap(content: ParsedDocxContent): Map<number, SpecItem[]> {
  const specTables = content.tables
    .filter((rows) => isSpecTable(rows))
    .map((rows) => parseSpecTable(rows))
    .filter((specs) => specs.length > 0);
  return new Map(specTables.map((specs, index) => [index + 1, specs]));
}

function parseDocxSummaryTableRows(content: ParsedDocxContent): ImportedProcurementRow[] {
  const rows: ImportedProcurementRow[] = [];
  const specTableMap = buildDocxSpecTableMap(content);
  for (const tableRows of content.tables) {
    if (!isDocxSummaryTable(tableRows)) continue;
    const headerRow = tableRows[0];
    const hMap = detectHeaderMap(headerRow);
    // Определяем колонку "Прил.№" гибко
    const appendixColIdx = headerRow.findIndex((cell) => normalizeHeader(cell).includes('прил'));
    // Fallback на старые хардкод-индексы для совместимости со старым форматом (7 колонок)
    const isLegacyFormat = headerRow.length >= 7 && !Object.keys(hMap).includes('qty');
    for (const row of tableRows.slice(1)) {
      let description: string;
      let licenseType: string;
      let term: string;
      let qtyCell: string;
      let okpd2Cell: string;
      let appendixCell: string;
      if (isLegacyFormat) {
        description = normalizeCell(row[1] || '');
        licenseType = normalizeCell(row[2] || '').replace(/^—$/u, '');
        term = normalizeCell(row[3] || '').replace(/^—$/u, '');
        qtyCell = row[4] || '1';
        okpd2Cell = row[5] || '';
        appendixCell = row[6] || '';
      } else {
        const typeIdx = hMap.type ?? hMap.description ?? 1;
        description = normalizeCell(row[typeIdx] || '');
        licenseType = hMap.licenseType != null ? normalizeCell(row[hMap.licenseType] || '').replace(/^—$/u, '') : '';
        term = hMap.term != null ? normalizeCell(row[hMap.term] || '').replace(/^—$/u, '') : '';
        qtyCell = hMap.qty != null ? row[hMap.qty] || '1' : '1';
        okpd2Cell = hMap.okpd2 != null ? row[hMap.okpd2] || '' : '';
        appendixCell = appendixColIdx >= 0 ? row[appendixColIdx] || '' : '';
      }
      if (!description || shouldRejectImportText(description)) continue;
      const appendixMatch = normalizeCell(appendixCell).match(/(\d+)/);
      const appendixIndex = appendixMatch ? Number(appendixMatch[1]) : null;
      const okpd2 = extractOkpd2Code(okpd2Cell);
      const imported = makeImportedRow({
        rawType: description,
        description,
        licenseType,
        term,
        qty: parseQty(qtyCell),
        qtyExplicit: /\d/.test(normalizeCell(qtyCell)),
        meta: okpd2 ? { okpd2_code: okpd2 } : undefined,
        specs: appendixIndex ? specTableMap.get(appendixIndex) : undefined,
        notes: ['Позиция извлечена из сводной таблицы ТЗ.'],
        sourceFormat: 'docx',
        sourceKind: 'table',
        sourceText: row.join(' | '),
      });
      rows.push(imported);
    }
  }
  return dedupeImportedRows(rows);
}

/** Extract product name from a spec table's rows (looks for a merged product-name row). */
function extractMergedProductNameFromRows(rows: string[][]): string {
  const headerIndex = findSpecHeaderIndex(rows);
  // Helper: a merged row must be non-trivial (≥4 chars) and not look like a group heading
  const isMergedProductRow = (row: string[]): string => {
    const first = normalizeCell(row[0] || '');
    if (first.length < 4) return '';
    if (!row.every((cell) => normalizeCell(cell) === first)) return '';
    // Reject generic group headings (all lowercase Russian words like "общие", "дополнительно")
    if (/^[а-яёА-ЯЁa-zA-Z]{1,20}$/.test(first) && !/[0-9\-_\/]/.test(first) && first === first.toLowerCase()) return '';
    return first;
  };
  // Check rows BEFORE the header (most common: row 0 = merged product name, row 1 = header)
  for (let i = 0; i < headerIndex; i += 1) {
    const name = isMergedProductRow(rows[i]);
    if (name) return name;
  }
  // Check rows AFTER the header (less common)
  for (const row of rows.slice(headerIndex + 1)) {
    const name = isMergedProductRow(row);
    if (name) return name;
  }
  return '';
}

function extractProductNameFromAppendixHeading(headingText: string): string {
  const match = headingText.match(/приложени[еёeя]\s*[№#]?\s*[\d]+[.:\s—–\-]+(.+)$/iu);
  if (!match) return '';
  return normalizeCell(match[1]).replace(/[-:;,.]+$/, '').trim();
}

function stripSectionPrefix(text: string): string {
  // Remove boilerplate section prefixes like "Спецификация [на] X" → X
  // and "Требования к [X]" → ""
  return text
    .replace(/^спецификация\s+(на\s+)?/iu, '')
    .replace(/^приложение\s*[№#]?\s*\d*[.:\s]*/iu, '')
    .trim();
}

function findProductNameInAppendixSection(blocks: DocxBlock[], fromIdx: number, toIdx: number): string {
  for (let j = fromIdx; j < toIdx; j += 1) {
    const b = blocks[j];
    if (b.kind !== 'paragraph') continue;
    const text = normalizeCell(b.text || '');
    if (!text || DOCX_OKPD2_PREFIX_RE.test(text)) continue;
    if (shouldRejectImportText(text)) continue;
    if (text.length >= 4) {
      const stripped = stripSectionPrefix(text);
      return stripped.length >= 4 ? stripped : text;
    }
  }
  return '';
}

function extractMultiSpecRows(
  blocks: DocxBlock[],
  fromIdx: number,
  toIdx: number,
  content: ParsedDocxContent,
  headingProductName: string,
): ImportedProcurementRow[] | null {
  const specTableIndices: number[] = [];
  for (let j = fromIdx; j < toIdx; j += 1) {
    const b = blocks[j];
    if (b.kind === 'table' && b.rows && isSpecTable(b.rows)) specTableIndices.push(j);
  }
  if (specTableIndices.length < 2) return null;
  const allLines = extractAllDocumentLines(content);
  const sectionQty = findDocumentQty(
    blocks.slice(fromIdx, toIdx).filter((b) => b.kind === 'paragraph').map((b) => b.text || ''),
  ) || findDocumentQty(allLines);
  const result: ImportedProcurementRow[] = [];
  for (const tblIdx of specTableIndices) {
    let productName = '';
    for (let j = tblIdx - 1; j >= fromIdx; j -= 1) {
      const b = blocks[j];
      if (b.kind === 'table') break;
      if (b.kind !== 'paragraph') continue;
      const text = normalizeCell(b.text || '');
      if (!text || DOCX_OKPD2_PREFIX_RE.test(text)) continue;
      if (!shouldRejectImportText(text)) { productName = text; break; }
    }
    if (!productName && headingProductName) productName = headingProductName;
    if (!productName || productName.length < 4 || shouldRejectImportText(productName)) continue;
    const specTable = blocks[tblIdx];
    const specs = parseSpecTable(specTable.rows!);
    const okpd2 = extractOkpdFromBlocks(blocks, tblIdx + 1, Math.min(tblIdx + 12, toIdx));
    result.push(makeImportedRow({
      rawType: productName,
      description: productName,
      licenseType: '',
      term: '',
      qty: sectionQty || 1,
      qtyExplicit: !!sectionQty,
      sourceFormat: 'docx',
      sourceKind: 'appendix',
      sourceText: productName,
      meta: okpd2 ? { okpd2_code: okpd2 } : undefined,
      specs: specs.length > 0 ? specs : undefined,
    }));
  }
  return result.length > 0 ? result : null;
}

function parseDocxAppendixRows(content: ParsedDocxContent): ImportedProcurementRow[] {
  const rows: ImportedProcurementRow[] = [];
  const { blocks } = content;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block.kind !== 'paragraph' || !DOCX_APPENDIX_HEADING_RE.test(block.text || '')) continue;
    // Product name may be embedded in the appendix heading: "Приложение №1: Патч-корд (кабель)"
    const headingProductName = extractProductNameFromAppendixHeading(block.text || '');
    const nextAppendixIndex = findNextBlockIndex(blocks, i + 1, (candidate) => candidate.kind === 'paragraph' && DOCX_APPENDIX_HEADING_RE.test(candidate.text || ''));
    let itemParagraphIndex = -1;
    for (let j = i + 1; j < nextAppendixIndex; j += 1) {
      const candidate = blocks[j];
      if (candidate.kind !== 'paragraph') continue;
      const text = normalizeCell(candidate.text || '');
      if (!text) continue;
      if (DOCX_OKPD2_PREFIX_RE.test(text)) break;
      if (findTrailingQty(normalizeDocxLine(text))) {
        itemParagraphIndex = j;
        break;
      }
      if (shouldRejectImportText(text)) continue;
      if (itemParagraphIndex < 0) itemParagraphIndex = j;
    }
    if (itemParagraphIndex < 0) {
      // If there are 2+ spec tables in this section, create one row per table
      const multiSpecRows = extractMultiSpecRows(blocks, i + 1, nextAppendixIndex, content, headingProductName);
      if (multiSpecRows && multiSpecRows.length > 0) {
        rows.push(...multiSpecRows);
        continue;
      }
      const specTable = blocks.slice(i + 1, nextAppendixIndex).find(
        (b) => b.kind === 'table' && b.rows && isSpecTable(b.rows),
      );
      if (!specTable?.rows) {
        // No spec table — if we have a heading product name, still try to build a row
        if (!headingProductName || headingProductName.length < 4 || shouldRejectImportText(headingProductName)) continue;
        const okpd2 = extractOkpdFromBlocks(blocks, i + 1, nextAppendixIndex);
        const allLines = extractAllDocumentLines(content);
        const qty = findDocumentQty(
          blocks.slice(i + 1, nextAppendixIndex).filter((b) => b.kind === 'paragraph').map((b) => b.text || ''),
        ) || findDocumentQty(allLines);
        rows.push(makeImportedRow({
          rawType: headingProductName,
          description: headingProductName,
          licenseType: '',
          term: '',
          qty: qty || 1,
          qtyExplicit: !!qty,
          sourceFormat: 'docx',
          sourceKind: 'appendix',
          sourceText: headingProductName,
          meta: okpd2 ? { okpd2_code: okpd2 } : undefined,
        }));
        continue;
      }
      // Priority: heading product name > merged row > local paragraphs > doc-level "объект поставки"
      let headerCell = headingProductName && !shouldRejectImportText(headingProductName) ? headingProductName : '';
      if (!headerCell) {
        headerCell = extractMergedProductNameFromRows(specTable.rows) || '';
      }
      if (!headerCell || shouldRejectImportText(headerCell)) {
        headerCell = findProductNameInAppendixSection(blocks, i + 1, nextAppendixIndex);
      }
      if (!headerCell || shouldRejectImportText(headerCell)) {
        headerCell = normalizeCell(specTable.rows[0]?.[0] || '');
      }
      const notes: string[] = ['Название позиции извлечено из заголовка таблицы характеристик.'];
      if (!headerCell || shouldRejectImportText(headerCell)) {
        const allLines = extractAllDocumentLines(content);
        headerCell = findParagraphValue(allLines, /наименование объекта поставки/i)
          .replace(/\s*\(далее[^)]*\)/gi, '')
          .replace(/[.;,]+$/, '')
          .trim();
        if (headerCell) notes.push('Название позиции взято из раздела «Наименование объекта поставки».');
      }
      if (!headerCell || headerCell.length < 2 || shouldRejectImportText(headerCell)) continue;
      const specs = parseSpecTable(specTable.rows);
      const okpd2 = extractOkpdFromBlocks(blocks, i + 1, nextAppendixIndex);
      const allLines = extractAllDocumentLines(content);
      const qty = findDocumentQty(
        blocks.slice(i + 1, nextAppendixIndex)
          .filter((b) => b.kind === 'paragraph')
          .map((b) => b.text || ''),
      ) || findDocumentQty(allLines);
      rows.push(makeImportedRow({
        rawType: headerCell,
        description: headerCell,
        licenseType: '',
        term: '',
        qty: qty || 1,
        qtyExplicit: !!qty,
        sourceFormat: 'docx',
        sourceKind: 'appendix',
        sourceText: headerCell,
        meta: okpd2 ? { okpd2_code: okpd2 } : undefined,
        specs: specs.length > 0 ? specs : undefined,
        notes,
      }));
      continue;
    }

    const itemText = blocks[itemParagraphIndex].text || '';
    const okpd2 = extractOkpdFromBlocks(blocks, itemParagraphIndex + 1, nextAppendixIndex);
    const specs = extractFirstSpecTable(blocks, itemParagraphIndex + 1, nextAppendixIndex);
    const requirementContext = collectRequirementContext(
      blocks
        .slice(itemParagraphIndex + 1, nextAppendixIndex)
        .filter((candidate) => candidate.kind === 'paragraph')
        .map((candidate) => candidate.text || ''),
    );
    const imported = buildImportedRowFromText(itemText, 'appendix', {
      meta: okpd2 ? { okpd2_code: okpd2 } : undefined,
      specs,
      notes: requirementContext.count > 0 ? [`В приложении обнаружено текстовых требований: ${requirementContext.count}.`] : [],
      sourceContextText: requirementContext.text,
      ignoredBlocks: requirementContext.count,
    });
    if (imported) {
      rows.push(imported);
    } else {
      const specTable = blocks.slice(i + 1, nextAppendixIndex).find(
        (b) => b.kind === 'table' && b.rows && isSpecTable(b.rows),
      );
      if (specTable?.rows) {
        // Priority: heading product name > merged row > local section paragraphs > doc-level "объект поставки"
        let headerCell = headingProductName && !shouldRejectImportText(headingProductName) ? headingProductName : '';
        if (!headerCell) headerCell = extractMergedProductNameFromRows(specTable.rows) || '';
        if (!headerCell || shouldRejectImportText(headerCell)) {
          headerCell = findProductNameInAppendixSection(blocks, i + 1, nextAppendixIndex);
        }
        if (!headerCell || shouldRejectImportText(headerCell)) {
          headerCell = normalizeCell(specTable.rows[0]?.[0] || '');
        }
        const fallbackNotes: string[] = ['Название позиции извлечено из заголовка таблицы характеристик.'];
        if (!headerCell || shouldRejectImportText(headerCell)) {
          const allLines = extractAllDocumentLines(content);
          headerCell = findParagraphValue(allLines, /наименование объекта поставки/i)
            .replace(/\s*\(далее[^)]*\)/gi, '')
            .replace(/[.;,]+$/, '')
            .trim();
          if (headerCell) fallbackNotes.push('Название позиции взято из раздела «Наименование объекта поставки».');
        }
        if (headerCell && headerCell.length >= 2 && !shouldRejectImportText(headerCell)) {
          const fallbackSpecs = parseSpecTable(specTable.rows);
          const fallbackOkpd2 = okpd2 || extractOkpdFromBlocks(blocks, i + 1, nextAppendixIndex);
          const allLines = extractAllDocumentLines(content);
          const fallbackQty = findDocumentQty(
            blocks.slice(i + 1, nextAppendixIndex)
              .filter((b) => b.kind === 'paragraph')
              .map((b) => b.text || ''),
          ) || findDocumentQty(allLines);
          rows.push(makeImportedRow({
            rawType: headerCell,
            description: headerCell,
            licenseType: '',
            term: '',
            qty: fallbackQty || 1,
            qtyExplicit: !!fallbackQty,
            sourceFormat: 'docx',
            sourceKind: 'appendix',
            sourceText: headerCell,
            meta: fallbackOkpd2 ? { okpd2_code: fallbackOkpd2 } : undefined,
            specs: fallbackSpecs.length > 0 ? fallbackSpecs : undefined,
            notes: fallbackNotes,
          }));
        }
      }
    }
  }
  return dedupeImportedRows(rows);
}

function parseDocxAppendixParagraphRows(content: ParsedDocxContent): ImportedProcurementRow[] {
  const rows: ImportedProcurementRow[] = [];
  const paragraphs = content.paragraphs.map((paragraph) => normalizeCell(paragraph)).filter(Boolean);
  for (let i = 0; i < paragraphs.length; i += 1) {
    if (!DOCX_APPENDIX_HEADING_RE.test(paragraphs[i])) continue;

    let nextAppendixIndex = paragraphs.length;
    for (let j = i + 1; j < paragraphs.length; j += 1) {
      if (DOCX_APPENDIX_HEADING_RE.test(paragraphs[j])) {
        nextAppendixIndex = j;
        break;
      }
    }

    const appendixParagraphs = paragraphs.slice(i + 1, nextAppendixIndex);
    let itemText = '';
    for (const paragraph of appendixParagraphs) {
      if (DOCX_OKPD2_PREFIX_RE.test(paragraph)) break;
      if (findTrailingQty(normalizeDocxLine(paragraph))) {
        itemText = paragraph;
        break;
      }
      if (!shouldRejectImportText(paragraph) && !itemText) {
        itemText = paragraph;
      }
    }
    if (!itemText) continue;

    const okpd2 = appendixParagraphs.map((paragraph) => extractOkpd2Code(paragraph)).find(Boolean) || '';
    const requirementContext = collectRequirementContext(appendixParagraphs);
    const imported = buildImportedRowFromText(itemText, 'appendix', {
      meta: okpd2 ? { okpd2_code: okpd2 } : undefined,
      notes: requirementContext.count > 0 ? [`В приложении обнаружено текстовых требований: ${requirementContext.count}.`] : [],
      sourceContextText: requirementContext.text,
      ignoredBlocks: requirementContext.count,
    });
    if (imported) rows.push(imported);
  }
  return dedupeImportedRows(rows);
}

function extractDocxParagraphsFromXml(documentXmlText: string): string[] {
  const paragraphs = Array.from(documentXmlText.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g));
  return paragraphs
    .map((match) => {
      const paragraphXml = match[0]
        .replace(/<w:(?:tab)[^/]*\/>/g, '\t')
        .replace(/<w:(?:br|cr)[^/]*\/>/g, '\n');
      const parts = Array.from(paragraphXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)).map((textMatch) => decodeXmlEntities(textMatch[1] || ''));
      return normalizeCell(parts.join('').replace(/\s*\n\s*/g, ' '));
    })
    .filter(Boolean);
}

function parseDocxAppendixXmlRows(content: ParsedDocxContent): ImportedProcurementRow[] {
  const rows: ImportedProcurementRow[] = [];
  const paragraphs = extractDocxParagraphsFromXml(content.documentXmlText);
  for (let i = 0; i < paragraphs.length; i += 1) {
    if (!DOCX_APPENDIX_HEADING_RE.test(paragraphs[i])) continue;

    let nextAppendixIndex = paragraphs.length;
    for (let j = i + 1; j < paragraphs.length; j += 1) {
      if (DOCX_APPENDIX_HEADING_RE.test(paragraphs[j])) {
        nextAppendixIndex = j;
        break;
      }
    }

    const appendixParagraphs = paragraphs.slice(i + 1, nextAppendixIndex);
    let itemText = '';
    for (const paragraph of appendixParagraphs) {
      if (DOCX_OKPD2_PREFIX_RE.test(paragraph)) break;
      if (findTrailingQty(normalizeDocxLine(paragraph))) {
        itemText = paragraph;
        break;
      }
      if (!shouldRejectImportText(paragraph) && !itemText) {
        itemText = paragraph;
      }
    }
    if (!itemText) continue;

    const okpd2 = appendixParagraphs.map((paragraph) => extractOkpd2Code(paragraph)).find(Boolean) || '';
    const requirementContext = collectRequirementContext(appendixParagraphs);
    const imported = buildImportedRowFromText(itemText, 'appendix', {
      meta: okpd2 ? { okpd2_code: okpd2 } : undefined,
      notes: requirementContext.count > 0 ? [`В приложении обнаружено текстовых требований: ${requirementContext.count}.`] : [],
      sourceContextText: requirementContext.text,
      ignoredBlocks: requirementContext.count,
    });
    if (imported) rows.push(imported);
  }
  return dedupeImportedRows(rows);
}

function parseDocxEnumeratedRows(content: ParsedDocxContent): ImportedProcurementRow[] {
  const rows: ImportedProcurementRow[] = [];
  const { blocks } = content;
  let listStarted = false;
  let listStartIndex = 0;
  let captureStarted = false;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block.kind !== 'paragraph') continue;
    const text = normalizeCell(block.text || '');
    if (!listStarted && (/наименование объекта поставки:/i.test(text) || /закупка программного обеспечения/i.test(text))) {
      listStarted = true;
      listStartIndex = i;
    }
    if (!listStarted) continue;
    if (/^(?:2\.|3\.|4\.|5\.)\s*(заказчик|исполнитель|требования|сроки|место|гаранти|поставка)/i.test(text)) break;
    if (/^\d+\)/.test(text)) {
      captureStarted = true;
      const trailingContext = collectRequirementContext(
        blocks
          .slice(i + 1)
          .filter((candidate) => candidate.kind === 'paragraph')
          .map((candidate) => candidate.text || ''),
      );
      const imported = buildImportedRowFromText(text, 'enumerated', {
        notes: trailingContext.count > 0 ? ['После перечня позиций в документе есть дополнительные требования и нормативные блоки.'] : [],
        sourceContextText: trailingContext.text,
        ignoredBlocks: trailingContext.count,
      });
      if (imported) rows.push(imported);
      continue;
    }
    if (captureStarted) break;
  }
  if (rows.length === 0 && listStartIndex > 0) {
    const trailingContext = collectRequirementContext(
      blocks
        .slice(listStartIndex)
        .filter((candidate) => candidate.kind === 'paragraph')
        .map((candidate) => candidate.text || ''),
    );
    return dedupeImportedRows(rows.map((row) => ({
      ...row,
      importInfo: {
        ...row.importInfo,
        sourceContextText: trailingContext.text,
        ignoredBlocks: trailingContext.count,
      },
    })));
  }
  return dedupeImportedRows(rows);
}

function findParagraphValue(paragraphs: string[], labelRe: RegExp): string {
  for (let i = 0; i < paragraphs.length; i += 1) {
    const text = normalizeCell(paragraphs[i]);
    if (!labelRe.test(text)) continue;
    const inlineValue = normalizeCell(text.replace(/^.*?:\s*/u, ''));
    if (inlineValue && inlineValue !== text) return inlineValue;
    for (let j = i + 1; j < Math.min(paragraphs.length, i + 4); j += 1) {
      const next = normalizeCell(paragraphs[j]);
      if (!next || DOCX_SECTION_HEADING_RE.test(next)) break;
      if (DOCX_IMPORT_STOP_RE.test(next)) break;
      return next;
    }
  }
  return '';
}

function findDocumentQty(paragraphs: string[]): number | null {
  for (const paragraph of paragraphs) {
    if (!/количеств|объем оказания услуг|объём оказания услуг/i.test(paragraph)) continue;
    const qtyMatch = findTrailingQty(normalizeCell(paragraph));
    if (qtyMatch) return qtyMatch.qty;
  }
  return null;
}

function extractAllDocumentLines(content: ParsedDocxContent): string[] {
  const lines: string[] = [];
  for (const para of content.paragraphs) {
    const subLines = String(para || '').split(/\r?\n/);
    for (const sub of subLines) {
      const text = normalizeCell(sub);
      if (text) lines.push(text);
    }
  }
  for (const table of content.tables) {
    for (const row of table) {
      for (const cell of row) {
        const text = normalizeCell(cell || '');
        if (text) lines.push(text);
      }
    }
  }
  return lines;
}

function buildServiceSpecsFromParagraphs(paragraphs: string[]): SpecItem[] {
  const sections: Array<{ label: RegExp; group: string; name: string }> = [
    { label: /наименование оказываемых услуг/i, group: 'Общие требования', name: 'Наименование услуги' },
    { label: /необходимый объем услуг|объем оказываемых услуг/i, group: 'Объем услуг', name: 'Объем услуг' },
    { label: /сроки оказания услуг/i, group: 'Сроки и SLA', name: 'Срок оказания услуг' },
    { label: /место проведения медицинских осмотров|место оказания услуг/i, group: 'Организация работ', name: 'Место оказания услуг' },
    { label: /требования к оказанию услуг/i, group: 'Требования к исполнению', name: 'Требования к оказанию услуг' },
    { label: /гарантийные обязательства/i, group: 'Гарантийные обязательства', name: 'Гарантийные обязательства' },
  ];
  const specs = sections
    .map((section): SpecItem | null => {
      const value = findParagraphValue(paragraphs, section.label);
      if (!value) return null;
      return {
        group: section.group,
        name: section.name,
        value,
        unit: '—',
      };
    })
    .filter((item): item is SpecItem => item !== null);
  return specs;
}

function extractProductNameFromSpecTable(blocks: DocxBlock[]): { name: string; specs: SpecItem[] } | null {
  // Find the first spec table and try to extract the product name from a merged row
  // (a row where all cells have the same non-empty value, e.g. ["MES2300B-48", "MES2300B-48", "MES2300B-48"])
  // The merged row can appear BEFORE the header row (most common) or AFTER it (less common).
  for (const block of blocks) {
    if (block.kind !== 'table' || !block.rows || !isSpecTable(block.rows)) continue;
    const productName = extractMergedProductNameFromRows(block.rows);
    const specs = parseSpecTable(block.rows);
    if (productName) {
      return { name: productName, specs };
    }
    if (specs.length > 0) return { name: '', specs };
  }
  return null;
}

function parseDocxFallbackRows(content: ParsedDocxContent): ImportedProcurementRow[] {
  const { paragraphs, blocks } = content;
  const allLines = extractAllDocumentLines(content);
  const serviceName =
    findParagraphValue(allLines, /наименование оказываемых услуг/i) ||
    allLines.find((line) => /^на оказание услуг\b/i.test(normalizeCell(line))) ||
    '';
  const requirementContext = collectRequirementContext(
    allLines.filter((line) => looksLikeRequirementText(line) || looksLikeNormativeText(line)),
  );
  const okpd2 = allLines.map((line) => extractOkpd2Code(line)).find(Boolean) || '';
  const firstSpecTable = extractFirstSpecTable(blocks, 0, blocks.length);

  if (serviceName) {
    const description = normalizeCell(serviceName);
    const serviceSpecs = buildServiceSpecsFromParagraphs(paragraphs);
    return dedupeImportedRows([
      makeImportedRow({
        ...parseCommercialMeta(serviceName),
        rawType: description,
        description,
        qty: findDocumentQty(allLines) || 1,
        sourceFormat: 'docx',
        sourceKind: 'fallback',
        sourceText: serviceName,
        meta: okpd2 ? { okpd2_code: okpd2 } : undefined,
        specs: serviceSpecs.length > 0 ? serviceSpecs : undefined,
        notes: ['Позиция извлечена из сервисного ТЗ по заголовкам разделов документа.'],
        ignoredBlocks: requirementContext.count,
        sourceContextText: requirementContext.text,
      }),
    ]);
  }

  const rawObjectName =
    findParagraphValue(allLines, /наименование объекта поставки/i) ||
    allLines.find((line) => /^на (?:поставку|закупку)\b/i.test(normalizeCell(line))) ||
    '';
  const objectName = normalizeCell(rawObjectName)
    .replace(/\s*\(далее[^)]*\)/gi, '')
    .replace(/[.;,]+$/, '')
    .trim();
  const row = buildImportedRowFromText(objectName, 'fallback', {
    allowWithoutQty: true,
    meta: okpd2 ? { okpd2_code: okpd2 } : undefined,
    specs: firstSpecTable.length > 0 ? firstSpecTable : undefined,
    notes: ['Позиция извлечена из заголовка или общего предмета закупки.'],
    sourceContextText: requirementContext.text,
    ignoredBlocks: requirementContext.count,
  });
  if (row) {
    return dedupeImportedRows([{ ...row, qty: findDocumentQty(allLines) || row.qty || 1 }]);
  }

  // Документ содержит только таблицу характеристик без отдельного заголовка позиции.
  // Пробуем извлечь название товара из объединённой строки внутри таблицы.
  const specTableResult = extractProductNameFromSpecTable(blocks);
  if (specTableResult && (specTableResult.name || specTableResult.specs.length > 0)) {
    const productName = specTableResult.name || 'Товар';
    const productSpecs = specTableResult.specs;
    const qty = findDocumentQty(allLines) || 1;
    return dedupeImportedRows([makeImportedRow({
      rawType: productName,
      description: productName,
      licenseType: '',
      term: '',
      qty,
      qtyExplicit: qty > 1,
      sourceFormat: 'docx',
      sourceKind: 'fallback',
      sourceText: productName,
      meta: okpd2 ? { okpd2_code: okpd2 } : undefined,
      specs: productSpecs.length > 0 ? productSpecs : undefined,
      notes: ['Позиция и характеристики извлечены из таблицы спецификаций.'],
    })]);
  }

  const plainLineRows: ImportedProcurementRow[] = [];
  for (const line of allLines) {
    const parts = line.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const lineRow = buildImportedRowFromText(part, 'fallback', {
        allowWithoutQty: true,
        meta: okpd2 ? { okpd2_code: okpd2 } : undefined,
        notes: ['Позиция извлечена из текстового содержимого документа.'],
      });
      if (lineRow) plainLineRows.push(lineRow);
    }
  }
  if (plainLineRows.length > 0) return dedupeImportedRows(plainLineRows);

  return [];
}

async function parseDocxRows(buffer: ArrayBuffer): Promise<ImportedProcurementRow[]> {
  const content = await parseDocxContent(buffer);

  // Сводная таблица ТЗ-генератора: первый приоритет (надёжная сигнатура с ОКПД2/Прил.№)
  const summaryTableRows = parseDocxSummaryTableRows(content);
  if (summaryTableRows.length > 0) return summaryTableRows;

  const appendixRows = parseDocxAppendixRows(content);
  if (appendixRows.length > 0) return appendixRows;

  const appendixParagraphRows = parseDocxAppendixParagraphRows(content);
  if (appendixParagraphRows.length > 0) return appendixParagraphRows;

  const appendixXmlRows = parseDocxAppendixXmlRows(content);
  if (appendixXmlRows.length > 0) return appendixXmlRows;

  const enumeratedRows = parseDocxEnumeratedRows(content);
  if (enumeratedRows.length > 0) return enumeratedRows;

  const tableRows = parseDocxTableRows(content.blocks);
  if (tableRows.length > 0) return tableRows;

  return parseDocxFallbackRows(content);
}

async function tryServerDocxParse(file: File): Promise<ParsedDocxContent | null> {
  try {
    const formData = new FormData();
    formData.append('file', file);
    const resp = await fetch('/api/parse-docx', {
      method: 'POST',
      body: formData,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.ok) return null;

    const paragraphs: string[] = (data.paragraphs || []).map((p: string) => String(p || '').replace(/\u00a0/g, ' ').replace(/[\u2000-\u200d\u2028\u2029]/g, ' ').trim()).filter(Boolean);
    const tables: string[][][] = (data.tables || []).map((tbl: { rows: { cells: string[] }[] }) =>
      tbl.rows.map((row: { cells: string[] }) => row.cells.map((c: string) => normalizeCell(c))).filter((row: string[]) => row.some(Boolean)),
    );

    const blocks: DocxBlock[] = [];
    const serverBlocks: { type: string; text?: string; table?: { rows: { cells: string[] }[] } }[] = data.blocks || [];
    for (const sb of serverBlocks) {
      if (sb.type === 'paragraph' && sb.text) {
        const text = normalizeCell(sb.text);
        if (text) blocks.push({ kind: 'paragraph', text });
      } else if (sb.type === 'table' && sb.table?.rows) {
        const rows = sb.table.rows
          .map((row: { cells: string[] }) => row.cells.map((c: string) => normalizeCell(c)))
          .filter((row: string[]) => row.some(Boolean));
        if (rows.length > 0) blocks.push({ kind: 'table', rows });
      }
    }

    if (blocks.length === 0) {
      for (const p of paragraphs) {
        blocks.push({ kind: 'paragraph', text: p });
      }
      for (const rows of tables) {
        blocks.push({ kind: 'table', rows });
      }
    }

    return { paragraphs, tables, blocks, documentXmlText: '' };
  } catch {
    return null;
  }
}

export async function parseImportedRows(file: File): Promise<ImportedProcurementRow[]> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.xlsx')) {
    const rows = await parseXlsxRows(await file.arrayBuffer());
    return dedupeImportedRows(mapRows(rows, 'xlsx'));
  }
  if (lowerName.endsWith('.docx')) {
    const buffer = await file.arrayBuffer();
    const serverContent = await tryServerDocxParse(file);
    let serverFallbackRows: ImportedProcurementRow[] = [];
    if (serverContent) {
      if (serverContent.tables.length > 0) {
        // Сводная таблица: первый приоритет для файлов ТЗ-генератора
        const summaryTableRows = parseDocxSummaryTableRows(serverContent);
        if (summaryTableRows.length > 0) return summaryTableRows;
        const appendixRows = parseDocxAppendixRows(serverContent);
        if (appendixRows.length > 0) return appendixRows;
        const appendixParagraphRows = parseDocxAppendixParagraphRows(serverContent);
        if (appendixParagraphRows.length > 0) return appendixParagraphRows;
        const tableRows = parseDocxTableRows(serverContent.blocks);
        if (tableRows.length > 0) return tableRows;
      }
      const enumeratedRows = parseDocxEnumeratedRows(serverContent);
      if (enumeratedRows.length > 0) return enumeratedRows;
      // Fallback: don't return immediately — compare with client-side result below
      serverFallbackRows = parseDocxFallbackRows(serverContent);
    }
    // Client-side parsing (JSZip + DOMParser): handles more DOCX structures
    const clientRows = await parseDocxRows(buffer);
    // Prefer whichever parser found more positions; server fallback wins only on tie
    if (clientRows.length > serverFallbackRows.length) return clientRows;
    if (serverFallbackRows.length > 0) return serverFallbackRows;
    return clientRows;
  }
  const text = await file.text();
  return dedupeImportedRows(mapRows(parseDelimitedText(text), 'text'));
}
