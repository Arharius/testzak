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
const DOCX_BOILERPLATE_RE = /^(содержание|заказчик|исполнитель|поставка|сроки|действия|описание|лицензии(?:\s|$|[.:])|правовая безопасность|общие требования|серверной части|клиентской части|требования(?:\s+к.*)?|место оказания|гарантийные обязательства|обновление(?:\s+или)?\s+техническая поддержка|порядок выпуска|документом, подтверждающим право|юридическое резюме|национальный режим|основание\s*\/\s*исключение|подтверждающие документы|источник классификации|паспорт публикации|сводка готовности|итоговый статус|блокирующие замечания|предупреждения и что проверить|справочная таблица|anti-фас)/i;
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
    .replace(/[.:;"'()]/g, '');
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
  for (const child of getChildElements(body)) {
    const localName = getNodeLocalName(child);
    if (localName === 'p') {
      const text = extractDocxParagraphText(child);
      if (text) {
        paragraphs.push(text);
        blocks.push({ kind: 'paragraph', text });
      }
      continue;
    }
    if (localName === 'tbl') {
      const extractedTables: string[][][] = [];
      extractDocxTablesFromTable(child, extractedTables);
      for (const rows of extractedTables) {
        tables.push(rows);
        blocks.push({ kind: 'table', rows });
      }
    }
  }
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

function isSpecTable(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const headerIndex = rows[0].length === 1 && rows.length > 2 ? 1 : 0;
  const headers = rows[headerIndex].map((cell) => normalizeHeader(cell));
  return headers.some((cell) => cell === 'наименование характеристики')
    && headers.some((cell) => cell === 'значение характеристики');
}

function parseSpecTable(rows: string[][]): SpecItem[] {
  const specs: SpecItem[] = [];
  const headerIndex = rows[0].length === 1 && rows.length > 2 ? 1 : 0;
  let currentGroup = 'Технические характеристики';
  for (const row of rows.slice(headerIndex + 1)) {
    const name = normalizeCell(row[0] || '');
    const value = normalizeCell(row[1] || '');
    const unit = normalizeCell(row[2] || '') || '—';
    if (!name && !value) continue;
    if (name && !value && !(row[2] || '').trim()) {
      currentGroup = name;
      continue;
    }
    specs.push({
      group: currentGroup,
      name,
      value: value || 'Да',
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
  return hasName && hasOkpd2 && hasAppendix && hasCommercial;
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
    for (const row of tableRows.slice(1)) {
      const description = normalizeCell(row[1] || '');
      if (!description || shouldRejectImportText(description)) continue;
      const appendixMatch = normalizeCell(row[6] || '').match(/(\d+)/);
      const appendixIndex = appendixMatch ? Number(appendixMatch[1]) : null;
      const imported = makeImportedRow({
        rawType: description,
        description,
        licenseType: normalizeCell(row[2] || '').replace(/^—$/u, ''),
        term: normalizeCell(row[3] || '').replace(/^—$/u, ''),
        qty: parseQty(row[4] || '1'),
        qtyExplicit: /\d/.test(normalizeCell(row[4] || '')),
        meta: extractOkpd2Code(row[5] || '') ? { okpd2_code: extractOkpd2Code(row[5] || '') } : undefined,
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

function parseDocxAppendixRows(content: ParsedDocxContent): ImportedProcurementRow[] {
  const rows: ImportedProcurementRow[] = [];
  const { blocks } = content;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block.kind !== 'paragraph' || !DOCX_APPENDIX_HEADING_RE.test(block.text || '')) continue;
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
    if (itemParagraphIndex < 0) continue;

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
    if (imported) rows.push(imported);
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

function parseDocxFallbackRows(content: ParsedDocxContent): ImportedProcurementRow[] {
  const { paragraphs, blocks } = content;
  const serviceName =
    findParagraphValue(paragraphs, /наименование оказываемых услуг/i) ||
    paragraphs.find((paragraph) => /^на оказание услуг\b/i.test(normalizeCell(paragraph))) ||
    '';
  const requirementContext = collectRequirementContext(
    paragraphs.filter((paragraph) => looksLikeRequirementText(paragraph) || looksLikeNormativeText(paragraph)),
  );
  const okpd2 = paragraphs.map((paragraph) => extractOkpd2Code(paragraph)).find(Boolean) || '';
  const firstSpecTable = extractFirstSpecTable(blocks, 0, blocks.length);

  if (serviceName) {
    const description = normalizeCell(serviceName);
    const serviceSpecs = buildServiceSpecsFromParagraphs(paragraphs);
    return dedupeImportedRows([
      makeImportedRow({
        ...parseCommercialMeta(serviceName),
        rawType: description,
        description,
        qty: findDocumentQty(paragraphs) || 1,
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

  const objectName =
    findParagraphValue(paragraphs, /наименование объекта поставки/i) ||
    paragraphs.find((paragraph) => /^на (?:поставку|закупку)\b/i.test(normalizeCell(paragraph))) ||
    '';
  const row = buildImportedRowFromText(objectName, 'fallback', {
    allowWithoutQty: true,
    meta: okpd2 ? { okpd2_code: okpd2 } : undefined,
    specs: firstSpecTable.length > 0 ? firstSpecTable : undefined,
    notes: ['Позиция извлечена из заголовка или общего предмета закупки.'],
    sourceContextText: requirementContext.text,
    ignoredBlocks: requirementContext.count,
  });
  if (row) {
    return dedupeImportedRows([{ ...row, qty: findDocumentQty(paragraphs) || row.qty || 1 }]);
  }
  return [];
}

async function parseDocxRows(buffer: ArrayBuffer): Promise<ImportedProcurementRow[]> {
  const content = await parseDocxContent(buffer);
  const appendixRows = parseDocxAppendixRows(content);
  if (appendixRows.length > 0) return appendixRows;

  const appendixParagraphRows = parseDocxAppendixParagraphRows(content);
  if (appendixParagraphRows.length > 0) return appendixParagraphRows;

  const appendixXmlRows = parseDocxAppendixXmlRows(content);
  if (appendixXmlRows.length > 0) return appendixXmlRows;

  const enumeratedRows = parseDocxEnumeratedRows(content);
  if (enumeratedRows.length > 0) return enumeratedRows;

  const summaryTableRows = parseDocxSummaryTableRows(content);
  if (summaryTableRows.length > 0) return summaryTableRows;

  const tableRows = parseDocxTableRows(content.blocks);
  if (tableRows.length > 0) return tableRows;

  return parseDocxFallbackRows(content);
}

export async function parseImportedRows(file: File): Promise<ImportedProcurementRow[]> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.xlsx')) {
    const rows = await parseXlsxRows(await file.arrayBuffer());
    return dedupeImportedRows(mapRows(rows, 'xlsx'));
  }
  if (lowerName.endsWith('.docx')) {
    return parseDocxRows(await file.arrayBuffer());
  }
  const text = await file.text();
  return dedupeImportedRows(mapRows(parseDelimitedText(text), 'text'));
}
