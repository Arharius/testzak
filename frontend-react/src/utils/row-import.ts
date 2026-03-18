import JSZip from 'jszip';

export type ImportedProcurementRow = {
  rawType: string;
  description: string;
  licenseType: string;
  term: string;
  qty: number;
};

type HeaderMap = {
  type?: number;
  description?: number;
  licenseType?: number;
  term?: number;
  qty?: number;
};

const HEADER_ALIASES: Record<keyof HeaderMap, string[]> = {
  type: ['тип', 'тип товара', 'товар', 'товар/услуга', 'позиция', 'наименование', 'предмет', 'номенклатура'],
  description: ['описание', 'модель', 'модель / описание', 'характеристика', 'наименование товара', 'описание позиции'],
  licenseType: ['тип лицензии', 'лицензия', 'вид лицензии', 'тип сертификата', 'тип права'],
  term: ['срок', 'срок действия', 'срок лицензии', 'срок действия лицензии', 'срок поддержки', 'период'],
  qty: ['кол-во', 'количество', 'qty', 'кол', 'объем', 'объём'],
};

function normalizeCell(value: string): string {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHeader(value: string): string {
  return normalizeCell(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.:;"'()]/g, '');
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
  for (let i = 0; i < line.length; i++) {
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
  for (let i = 0; i < ref.length; i++) {
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
    return rows.map((row) => {
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
    }).filter((row) => row.some(Boolean));
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

function mapRows(rawRows: string[][]): ImportedProcurementRow[] {
  if (rawRows.length === 0) return [];

  const headerMap = detectHeaderMap(rawRows[0]);
  const hasHeader = Object.keys(headerMap).length > 0;
  const dataRows = hasHeader ? rawRows.slice(1) : rawRows;
  const fallbackMap: HeaderMap = hasHeader
    ? headerMap
    : { type: 0, description: 1, licenseType: 2, term: 3, qty: 4 };

  return dataRows
    .map((row) => {
      const rawType = normalizeCell(row[fallbackMap.type ?? 0] || '');
      const description = normalizeCell(row[fallbackMap.description ?? fallbackMap.type ?? 0] || rawType);
      const licenseType = normalizeCell(row[fallbackMap.licenseType ?? -1] || '');
      const term = normalizeCell(row[fallbackMap.term ?? -1] || '');
      const qty = parseQty(row[fallbackMap.qty ?? -1] || '1');
      if (!rawType && !description) return null;
      return {
        rawType,
        description,
        licenseType,
        term,
        qty,
      };
    })
    .filter((row): row is ImportedProcurementRow => !!row);
}

export async function parseImportedRows(file: File): Promise<ImportedProcurementRow[]> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.xlsx')) {
    const rows = await parseXlsxRows(await file.arrayBuffer());
    return mapRows(rows);
  }
  const text = await file.text();
  return mapRows(parseDelimitedText(text));
}
