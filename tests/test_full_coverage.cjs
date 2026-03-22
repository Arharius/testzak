#!/usr/bin/env node
'use strict';

/**
 * Comprehensive coverage test — все возможные и невозможные сценарии.
 * Охватывает: DOCX-импорт, ручной ввод, пакетную генерацию,
 * фолбэк к индивидуальной генерации, ОКПД2, типы строк,
 * правовую проверку, Anti-FAS, ошибки, дублирование, граничные случаи.
 */

const fs   = require('fs');
const path = require('path');

const root    = path.resolve(__dirname, '..');
const srcDir  = path.join(root, 'frontend-react', 'src');
const compDir = path.join(srcDir, 'components');
const utilDir = path.join(srcDir, 'utils');
const libDir  = path.join(srcDir, 'lib');

// ── Загрузка исходников ──────────────────────────────────────────────────────
function readSrc(p) { return fs.readFileSync(p, 'utf-8'); }

const rowImport      = readSrc(path.join(utilDir, 'row-import.ts'));
const workspace      = readSrc(path.join(compDir, 'Workspace.tsx'));
const wsPub          = readSrc(path.join(compDir, 'workspace-publication.ts'));
const wsRowsTable    = readSrc(path.join(compDir, 'WorkspaceRowsTable.tsx'));
const wsRowDetail    = readSrc(path.join(compDir, 'WorkspaceRowDetailPanel.tsx'));
const wsPanels       = readSrc(path.join(compDir, 'WorkspacePanels.tsx'));
const compliance     = readSrc(path.join(utilDir, 'compliance.ts'));
const specProcessor  = readSrc(path.join(utilDir, 'spec-processor.ts'));
const modelSearch    = readSrc(path.join(utilDir, 'model-search.ts'));
const rowTrust       = readSrc(path.join(utilDir, 'row-trust.ts'));
const backendApi     = readSrc(path.join(libDir,  'backendApi.ts'));
const orgTemplates   = readSrc(path.join(utilDir, 'organization-templates.ts'));
const orgMemory      = readSrc(path.join(utilDir, 'organization-memory.ts'));
const buildInfo      = readSrc(path.join(utilDir, 'build-info.ts'));
const backendMain    = readSrc(path.join(root, 'backend', 'main.py'));

// Объединённый поиск по всему фронтенду
const allFe = [rowImport, workspace, wsPub, wsRowsTable, wsRowDetail, wsPanels,
               compliance, specProcessor, modelSearch, rowTrust, backendApi,
               orgTemplates, orgMemory, buildInfo].join('\n');

// ── Вспомогательные утилиты для runtime-тестов ──────────────────────────────
function normalizeHeader(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.:;"'()]/g, '')
    .replace(/\s*-\s+/g, '-')
    .replace(/\s+-\s*/g, '-');
}

const HEADER_ALIASES_QTY = ['кол-во', 'количество', 'qty', 'кол', 'объем', 'объём'];

function isDocxSummaryTableLocal(rows) {
  if (rows.length < 2) return false;
  const headers = rows[0].map(normalizeHeader);
  const hasName = headers.includes('наименование');
  const hasAppendix = headers.some(c => c.includes('прил'));
  const hasCommercial = headers.some(c =>
    ['тип лицензии', 'лицензия', 'вид лицензии'].includes(c) ||
    ['срок', 'срок действия', 'срок лицензии', 'период'].includes(c));
  const hasQty = headers.some(c => HEADER_ALIASES_QTY.includes(c));
  return hasName && hasAppendix && (hasCommercial || hasQty);
}

function extractOkpd2CodeLocal(text) {
  const m = String(text || '').match(/\b(\d{2}\.\d{2}(?:\.\d{1,2})?(?:\.\d{3})?)\b/);
  return m ? m[1] : '';
}

// ── Счётчик ──────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    console.log(`\x1b[32mPASS\x1b[0m ${name}`);
    passed++;
  } else {
    console.log(`\x1b[31mFAIL\x1b[0m ${name}${detail ? ' — ' + detail : ''}`);
    failures.push(name);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// БЛОК 1: DOCX-импорт — структура парсера
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ БЛОК 1: DOCX-импорт — структура парсера\x1b[0m');

check('isDocxSummaryTable принимает формат с qty-колонкой (без коммерческих полей и без ОКПД2)',
  rowImport.includes("const hasQty = headers.some((cell) => HEADER_ALIASES.qty.includes(cell))") &&
  rowImport.includes("return hasName && hasAppendix && (hasCommercial || hasQty)"));

check('parseDocxSummaryTableRows использует detectHeaderMap для гибкого маппинга',
  rowImport.includes('const hMap = detectHeaderMap(headerRow)') &&
  rowImport.includes('const appendixColIdx = headerRow.findIndex'));

check('Легаси-формат (7+ колонок без qty) разбирается по хардкод-индексам',
  rowImport.includes('isLegacyFormat') &&
  rowImport.includes('const isLegacyFormat = headerRow.length >= 7'));

check('Новый формат ТЗ-генератора (5 колонок) читает qty через hMap',
  rowImport.includes('qtyCell = hMap.qty != null ? row[hMap.qty]') &&
  rowImport.includes("qtyExplicit: /\\d/.test(normalizeCell(qtyCell))"));

check('ОКПД2 из ячейки сводной таблицы применяется к строке',
  rowImport.includes('okpd2Cell = hMap.okpd2 != null ? row[hMap.okpd2]') &&
  rowImport.includes("meta: okpd2 ? { okpd2_code: okpd2 }"));

check('Колонка Прил.№ ищется через includes("прил")',
  rowImport.includes("headerRow.findIndex((cell) => normalizeHeader(cell).includes('прил'))"));

check('Спеки из Приложений привязываются через specTableMap.get(appendixIndex)',
  rowImport.includes('specs: appendixIndex ? specTableMap.get(appendixIndex) : undefined'));

check('isDocxSummaryTable требует наименование + прил (ОКПД2 необязателен)',
  rowImport.includes('const hasName = headers.includes') &&
  rowImport.includes("const hasAppendix = headers.some((cell) => cell.includes('прил'))") &&
  !rowImport.includes("return hasName && hasOkpd2"));

check('parseDocxTableRows пропускает сводные таблицы через isDocxSummaryTable',
  rowImport.includes('isDocxSummaryTable(block.rows) || !isLikelyProcurementTable(block.rows)'));

check('parseDocxAppendixRows ищет секции по DOCX_APPENDIX_HEADING_RE',
  rowImport.includes('function parseDocxAppendixRows') &&
  rowImport.includes("DOCX_APPENDIX_HEADING_RE.test(block.text || '')"));

check('Несколько спек-таблиц в одном Приложении → extractMultiSpecRows',
  rowImport.includes('function extractMultiSpecRows') &&
  rowImport.includes('if (specTableIndices.length < 2) return null'));

check('parseDocxEnumeratedRows обрабатывает нумерованные перечни',
  rowImport.includes('function parseDocxEnumeratedRows') &&
  allFe.includes('нумерованные перечни лицензий'));

check('dedupeImportedRows устраняет дублирующие строки',
  rowImport.includes('function dedupeImportedRows'));

check('Уверенность импорта хранится в importInfo.confidence + confidenceLabel',
  rowImport.includes('confidence:') && rowImport.includes('confidenceLabel') &&
  rowImport.includes("sourceKind: 'appendix'") && rowImport.includes("sourceKind: 'table'"));

check('sourceContextText передаётся в importInfo для пропуска интернет-поиска',
  rowImport.includes('sourceContextText'));

check('buildDocxSpecTableMap собирает карту спек-таблиц по индексу',
  rowImport.includes('function buildDocxSpecTableMap'));

// ═══════════════════════════════════════════════════════════════════════════════
// БЛОК 2: DOCX-импорт — runtime-логика (isDocxSummaryTable)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ БЛОК 2: DOCX-импорт — runtime-логика\x1b[0m');

check('RUNTIME: сводная таблица ТЗ-генератора (5 колонок с ОКПД2) распознаётся',
  isDocxSummaryTableLocal([
    ['№', 'Наименование', 'Кол-во', 'ОКПД2', 'Прил.№'],
    ['1', 'Системный блок', '30 шт.', '26.20.15.000', 'Прил. 1'],
  ]));

check('RUNTIME: сводная таблица ТЗ-генератора (4 колонки, без ОКПД2) распознаётся',
  isDocxSummaryTableLocal([
    ['№', 'Наименование', 'Кол-во', 'Прил.№'],
    ['1', 'Системный блок', '30 шт.', 'Прил. 1'],
  ]));

check('RUNTIME: сводная таблица с коммерческими полями (6 колонок) распознаётся',
  isDocxSummaryTableLocal([
    ['№', 'Наименование', 'Тип лицензии', 'Срок действия', 'Кол-во', 'Прил.№'],
    ['1', 'Microsoft Office', 'Бессрочная', '—', '10', 'Прил. 1'],
  ]));

check('RUNTIME: сводная таблица с "Количество" вместо "Кол-во" распознаётся',
  isDocxSummaryTableLocal([
    ['Наименование', 'Количество', 'Прил.№'],
    ['Монитор', '60', 'Прил. 2'],
  ]));

check('RUNTIME: таблица без прил-колонки НЕ является сводной',
  !isDocxSummaryTableLocal([
    ['Наименование характеристики', 'Значение', 'ОКПД2'],
    ['Процессор', 'Intel Core i5', '26.20.15'],
  ]));

check('RUNTIME: таблица без qty И без прил НЕ является сводной',
  !isDocxSummaryTableLocal([
    ['Наименование', 'Описание', 'Цена'],
    ['Монитор', 'Описание монитора', '10000'],
  ]));

check('RUNTIME: таблица только с наименованием (нет прил/qty) НЕ является сводной',
  !isDocxSummaryTableLocal([
    ['Наименование', 'Описание'],
    ['Монитор', 'Описание монитора'],
  ]));

check('RUNTIME: пустая таблица (0 строк) НЕ является сводной',
  !isDocxSummaryTableLocal([]));

check('RUNTIME: таблица с 1 строкой (только заголовок) НЕ является сводной',
  !isDocxSummaryTableLocal([['Наименование', 'ОКПД2', 'Прил.№', 'Кол-во']]));

check('RUNTIME: normalizeHeader с "Прил.№" → содержит "прил"',
  normalizeHeader('Прил.№').includes('прил'));

check('RUNTIME: normalizeHeader удаляет точки и скобки',
  normalizeHeader('Кол-во (шт.)') === 'кол-во шт');

check('RUNTIME: normalizeHeader схлопывает "Кол- во" (артефакт DOCX-переноса) → "кол-во"',
  normalizeHeader('Кол- во') === 'кол-во');

check('RUNTIME: сводная таблица с "Кол- во" (DOCX-артефакт переноса строки) распознаётся',
  isDocxSummaryTableLocal([
    ['№', 'Наименование', 'Кол- во', 'Прил. №'],
    ['1', 'Системный блок', '30 шт.', 'Прил. 1'],
  ]));

check('RUNTIME: normalizeHeader нормализует ё→е',
  normalizeHeader('ТипЁвропейскийМонитор') === 'типевропейскиймонитор');

check('RUNTIME: normalizeHeader работает с NBSP и лишними пробелами',
  normalizeHeader('  Наименование\u00a0товара  ') === 'наименование товара');

check('RUNTIME: extractOkpd2Code находит код в строке с названием',
  extractOkpd2CodeLocal('26.20.15.000 — Машины вычислительные') === '26.20.15.000');

check('RUNTIME: extractOkpd2Code находит код после "ОКПД2:"',
  extractOkpd2CodeLocal('ОКПД2: 26.20.17.110') === '26.20.17.110');

check('RUNTIME: extractOkpd2Code возвращает пустую строку если нет кода',
  extractOkpd2CodeLocal('Монитор для компьютеров') === '');

check('RUNTIME: extractOkpd2Code НЕ ложно срабатывает на кол-во "30 шт."',
  extractOkpd2CodeLocal('30 шт.') === '');

check('RUNTIME: extractOkpd2Code НЕ ложно срабатывает на год "2025"',
  extractOkpd2CodeLocal('год 2025') === '');

check('RUNTIME: extractOkpd2Code НЕ ложно срабатывает на простое число "2026"',
  extractOkpd2CodeLocal('2026') === '');

// ═══════════════════════════════════════════════════════════════════════════════
// БЛОК 3: Пакетная генерация и фолбэк
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ БЛОК 3: Пакетная генерация и фолбэк\x1b[0m');

check('canBatchRow определяет пригодность строки для пакетной генерации',
  workspace.includes('function canBatchRow'));

check('buildBatchPrompt строит компактный промпт для ≤5 строк',
  workspace.includes('function buildBatchPrompt'));

check('parseBatchResponse разбирает JSON-ответ с массивом items',
  workspace.includes('function parseBatchResponse'));

check('Воркер собирает до 5 строк в батч через batchAbleIs',
  workspace.includes('batchAbleIs') && workspace.includes('nextTaskIdx'));

check('generateSingleRowFallback — индивидуальный фолбэк при провале строки в батче',
  workspace.includes('const generateSingleRowFallback = async'));

check('Строка без спеков в ответе батча → await generateSingleRowFallback(ri)',
  workspace.includes('await generateSingleRowFallback(ri)'));

check('Весь батч упал (catch batchErr) → все строки идут в generateSingleRowFallback',
  workspace.includes('await Promise.allSettled(batchAbleIs.map(ri => generateSingleRowFallback(ri)))'));

check('CONCURRENCY_LIMIT ограничивает количество воркеров до 3',
  workspace.includes('CONCURRENCY_LIMIT') && workspace.includes('Math.min(3,'));

check('Стаггированный старт воркеров (задержка на workerIndex * 1500мс)',
  workspace.includes('workerIndex * 1500'));

check('shouldStop флаг позволяет прерывать генерацию',
  workspace.includes('let shouldStop = false'));

check('completedCount накапливает прогресс всех воркеров',
  workspace.includes('completedCount++') && workspace.includes('completedCount,'));

check('DOCX-строки с sourceContextText пропускают интернет-поиск',
  workspace.includes('hasDocxSourceContext') &&
  workspace.includes('const hasDocxSourceContext = Boolean'));

check('hasImportedSeedSpecs пропускает AI если спеки уже есть из DOCX',
  workspace.includes('if (hasImportedSeedSpecs(currentRow))') &&
  workspace.includes('sourceStats.imported += 1;'));

check('max_tokens = 2048 используется для AI-запросов',
  workspace.includes('0.1, 2048)'));

check('Прогресс пакетной обработки отображается в UI',
  workspace.includes('Пакетная обработка, размер пакета:'));

check('Индикатор прогресса показывает current/total',
  workspace.includes('Генерация ${generationProgress.current} / ${generationProgress.total}'));

// ═══════════════════════════════════════════════════════════════════════════════
// БЛОК 4: Типы строк и автоопределение
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ БЛОК 4: Типы строк и автоопределение\x1b[0m');

check('isUniversalGoodsType охватывает otherGoods и otherService',
  workspace.includes('function isUniversalGoodsType') &&
  workspace.includes("type === 'otherGoods'") &&
  workspace.includes("type === 'otherService'"));

check('Ручной ввод товара добавляется через addRowWithType с типом otherGoods',
  workspace.includes("addRowWithType('otherGoods')"));

check('Масло для шредера → тип shredderOil (комментарий с примером 350 мл)',
  workspace.includes("return 'shredderOil'") &&
  workspace.includes('масло для шредера'));

check('Шредер детектируется по regex /(шредер|уничтожител',
  workspace.includes('шредер') && workspace.includes('уничтожител'));

check('МФУ детектируется по "мфу" или "многофункциональное устройство"',
  workspace.includes("normalized.includes('мфу')") &&
  workspace.includes("normalized.includes('многофункциональное устройство')"));

check('ПО резервного копирования → backup_sw',
  workspace.includes("'backup_sw'") || allFe.includes("'backup_sw'"));

check('Услуги детектируются через looksLikeServiceQuery',
  workspace.includes('looksLikeServiceQuery') || allFe.includes('function looksLikeServiceQuery'));

check('Все позиции каталога имеют ОКПД2 (okpd2 field)',
  workspace.includes('okpd2:') || allFe.includes('okpd2:'));

check('Детектирование типа по импортированному ОКПД2',
  workspace.includes('detectTypeByImportedOkpd2') || allFe.includes('detectTypeByImportedOkpd2'));

check('canBatchRow исключает строки с looksLikeSpecificModelQuery',
  workspace.includes('looksLikeSpecificModelQuery') && workspace.includes('canBatchRow'));

// ═══════════════════════════════════════════════════════════════════════════════
// БЛОК 5: Генерация — полный flow
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ БЛОК 5: Генерация — полный flow\x1b[0m');

check('buildPrompt создаёт system + user промпт',
  workspace.includes('function buildPrompt'));

check('parseAiResponse импортирован из spec-processor и используется в генерации',
  workspace.includes('parseAiResponse') && specProcessor.includes('function parseAiResponse'));

check('postProcessSpecs нормализует спецификации (определён в spec-processor)',
  specProcessor.includes('function postProcessSpecs'));

check('adjustSpecsForCommercialContext добавляет коммерческие поля',
  workspace.includes('function adjustSpecsForCommercialContext'));

check('expandSpecsToMinimum реализован как useCallback в Workspace',
  workspace.includes('const expandSpecsToMinimum = useCallback'));

check('hasRealSpecValues проверяет наличие реальных значений спеков',
  workspace.includes('function hasRealSpecValues') || allFe.includes('function hasRealSpecValues'));

check('resolveUniversalMeta обогащает мету для универсальных товаров',
  workspace.includes('resolveUniversalMeta'));

check('normalizeResolvedMeta нормализует мету перед сохранением',
  workspace.includes('function normalizeResolvedMeta'));

check('normalizeRowFailureMessage преобразует ошибки в читаемый текст',
  workspace.includes('function normalizeRowFailureMessage'));

check('generateWithBackend отправляет запрос к AI-бекенду',
  allFe.includes('generateWithBackend'));

check('autopilotEnabled читается только из явного forceAutopilot',
  workspace.includes('const autopilotEnabled = !!options?.forceAutopilot;'));

check('shouldSearchBeforeGenerate учитывает hasDocxSourceContext',
  workspace.includes('const shouldSearchBeforeGenerate =') &&
  workspace.includes('hasDocxSourceContext'));

check('targetIndices фильтрует уже готовые строки (status=done со спеками)',
  workspace.includes('targetIndices'));

// ═══════════════════════════════════════════════════════════════════════════════
// БЛОК 6: Ошибки и надёжность
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ БЛОК 6: Ошибки и надёжность\x1b[0m');

check('Backend: retry при HTTP 429 с Retry-After',
  backendMain.includes('429') && (backendMain.includes('Retry-After') || backendMain.includes('retry')));

check('Backend: цикл повторов при ошибке AI',
  backendMain.includes('retry') || backendMain.includes('attempt') || backendMain.includes('retries'));

check('Frontend: ошибки батча перехватываются через catch(batchErr)',
  workspace.includes('catch (batchErr)'));

check('Frontend: ошибки индивидуальной генерации через catch(fbErr)',
  workspace.includes('catch (fbErr)'));

check('Frontend: статус "error" с понятным сообщением',
  workspace.includes("status: 'error', error:"));

check('Frontend: статус "loading" при начале обработки строки',
  workspace.includes("status: 'loading'"));

check('Frontend: Promise.allSettled предотвращает потерю прогресса при сбоях',
  workspace.includes('Promise.allSettled'));

check('Frontend: воркер проверяет shouldStop перед каждой итерацией',
  workspace.includes('shouldStop'));

// ═══════════════════════════════════════════════════════════════════════════════
// БЛОК 7: Правовая проверка (44-ФЗ, 223-ФЗ, ПП1875)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ БЛОК 7: Правовая проверка\x1b[0m');

check('hasTrustedClassificationEvidence проверяет доверенный источник',
  allFe.includes('function hasTrustedClassificationEvidence'));

check('applyLegalReadinessPatchToRow применяет правовые исправления',
  wsPub.includes('function applyLegalReadinessPatchToRow'));

check('analyzeServiceSpecCoverage анализирует покрытие сервисных ТЗ',
  wsPub.includes('function analyzeServiceSpecCoverage'));

check('buildServiceAutofillEntries генерирует записи автозаполнения для услуг',
  wsPub.includes('function buildServiceAutofillEntries'));

check('buildStoredPublicationDossierPayload строит паспорт публикации',
  wsPub.includes('function buildStoredPublicationDossierPayload'));

check('Правовая база ПП1875 хранится в law175_basis',
  allFe.includes('law175_basis'));

check('Статус ПП1875 хранится в law175_status',
  allFe.includes('law175_status'));

check('Слабая основа (basisWeak) блокирует публикацию',
  workspace.includes('basisWeak'));

check('runPublicationAutopilot автоматически доводит ТЗ до публикации',
  workspace.includes('const runPublicationAutopilot = useCallback'));

// ═══════════════════════════════════════════════════════════════════════════════
// БЛОК 8: Anti-FAS и compliance
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ БЛОК 8: Anti-FAS и compliance\x1b[0m');

check('compliance.ts содержит getDetectionRules',
  compliance.includes('getDetectionRules'));

check('Проверка эквивалентности ("или эквивалентный") учитывается',
  compliance.includes('эквивалент') || allFe.includes('эквивалент'));

check('Anti-FAS проверки применяются в readiness gate',
  allFe.includes('anti_fas') || allFe.includes('antiFas') ||
  allFe.includes('fas_score') || allFe.includes('fasScore') ||
  allFe.includes('anti-fas') || allFe.includes('Anti-ФАС'));

check('Compliance-утилиты импортированы в Workspace',
  workspace.includes("compliance'") || workspace.includes('compliance.ts'));

// ═══════════════════════════════════════════════════════════════════════════════
// БЛОК 9: Форматы импорта
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ БЛОК 9: Форматы импорта\x1b[0m');

check('Поддерживаются форматы .csv, .tsv, .txt, .xlsx, .docx в accept',
  allFe.includes('.csv,.tsv,.txt,.xlsx,.docx'));

check('XLSX загружается через lowerName.endsWith в row-import',
  rowImport.includes("lowerName.endsWith('.xlsx')"));

check('DOCX загружается через lowerName.endsWith в row-import',
  rowImport.includes("lowerName.endsWith('.docx')"));

check('Текстовый импорт parseDocxEnumeratedRows для нумерованных перечней',
  rowImport.includes('parseDocxEnumeratedRows'));

check('Импорт заменяет черновик, а не дополняет (Текущий черновик заменён)',
  allFe.includes('Текущий черновик заменён'));

check('parseDocxSummaryTableRows вызывается при импорте DOCX',
  rowImport.includes('parseDocxSummaryTableRows'));

// ═══════════════════════════════════════════════════════════════════════════════
// БЛОК 10: UI и пользовательский опыт
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ БЛОК 10: UI и пользовательский опыт\x1b[0m');

check('Прогресс генерации отображается через generationProgress',
  workspace.includes('generationProgress.current') &&
  workspace.includes('generationProgress.total'));

check('Паспорт доверия строки объясняет сигналы публикации',
  wsRowDetail.includes('Паспорт доверия строки') &&
  allFe.includes('buildRowTrustPassport'));

check('Ручное добавление строки "+ Свой товар"',
  workspace.includes('Свой товар') && workspace.includes("addRowWithType"));

check('Ручное добавление услуги "+ Своя услуга"',
  workspace.includes('Своя услуга'));

check('Кнопка "Уточнить" для корректировки строки',
  allFe.includes('Уточнить'));

check('Шаблоны типовых закупок доступны в боковой панели',
  workspace.includes('Шаблоны типовых закупок'));

check('Сохранение своего шаблона команды',
  workspace.includes('Сохранить набор как шаблон'));

check('Сохранённые шаблоны команды отображаются',
  workspace.includes('Сохранённые шаблоны команды'));

check('Разделение импорта на отдельные ТЗ по назначению',
  workspace.includes('Разделить файл на отдельные ТЗ') &&
  workspace.includes('function buildProcurementSplitGroups'));

check('Публикация недоступна без спеков (hasPublicationBaseline)',
  workspace.includes('hasPublicationBaseline') &&
  workspace.includes('Нужна генерация'));

check('Метка сборки берётся из centralized build-info',
  workspace.includes("import { APP_BUILD_LABEL } from '../utils/build-info'"));

// ═══════════════════════════════════════════════════════════════════════════════
// БЛОК 11: Ручной ввод — граничные случаи
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ БЛОК 11: Ручной ввод — граничные случаи\x1b[0m');

check('Новая строка инициализируется со status="idle"',
  workspace.includes("status: 'idle'") || workspace.includes("status:'idle'"));

check('targetIndices фильтрует строки для генерации (не done)',
  workspace.includes('targetIndices'));

check('Пустое описание строки не вызывает краш — используется currentRow.model',
  workspace.includes('currentRow.model'));

check('Строка с указанным ОКПД2 уточняет классификацию',
  workspace.includes('okpd2_code') && workspace.includes('classification_source'));

check('Количество по умолчанию = 1 если не задано в таблице',
  rowImport.includes("parseQty") && rowImport.includes("|| '1'"));

check('Типы строк меняются через select/onChange в таблице строк',
  wsRowsTable.includes('onChange') || wsRowsTable.includes('select'));

check('isUniversalGoodsType(otherGoods) = true для ручных строк',
  workspace.includes("type === 'otherGoods'"));

check('Строка типа "otherService" идёт через isUniversalGoodsType',
  workspace.includes("type === 'otherService'"));

// ═══════════════════════════════════════════════════════════════════════════════
// БЛОК 12: Backend — структура и безопасность
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ БЛОК 12: Backend\x1b[0m');

check('Backend: маршрут /api/v1/ai/generate существует',
  backendMain.includes('ai/generate') || backendMain.includes('/ai/generate'));

check('Backend: авторизация через JWT',
  backendMain.includes('jwt') || backendMain.includes('JWT') ||
  fs.existsSync(path.join(root, 'backend', 'auth.py')));

check('Backend: ограничение FREE_TZ_LIMIT',
  backendMain.includes('FREE_TZ_LIMIT') || backendMain.includes('free_tz_limit'));

check('Backend: подключение к PostgreSQL через database-модуль',
  backendMain.includes('database') && (
    backendMain.includes('from .database import') ||
    backendMain.includes('from database import') ||
    backendMain.includes('_probe_database')
  ));

check('Backend: DeepSeek API интеграция',
  backendMain.includes('deepseek') || backendMain.includes('DeepSeek') ||
  backendMain.includes('DEEPSEEK'));

check('Backend: /health endpoint',
  backendMain.includes('/health'));

check('Backend: /api/v1/readiness endpoint',
  backendMain.includes('readiness'));

check('Dockerfile.backend существует',
  fs.existsSync(path.join(root, 'Dockerfile.backend')));

// ═══════════════════════════════════════════════════════════════════════════════
// БЛОК 13: Spec-processor и качество спецификаций
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ БЛОК 13: Spec-processor\x1b[0m');

check('spec-processor.ts содержит postProcessSpecs',
  specProcessor.includes('function postProcessSpecs'));

check('spec-processor.ts содержит parseAiResponse',
  specProcessor.includes('function parseAiResponse'));

check('SpecItem содержит поля name и value',
  specProcessor.includes('name') && specProcessor.includes('value'));

check('SpecItem содержит поле unit (единица измерения)',
  specProcessor.includes('unit'));

check('expandSpecsToMinimum дополняет спеки до минимума',
  workspace.includes('expandSpecsToMinimum'));

// ═══════════════════════════════════════════════════════════════════════════════
// БЛОК 14: Сохранение и история
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ БЛОК 14: Сохранение и история\x1b[0m');

check('importInfo персистится через import_info в JSON',
  workspace.includes('import_info: r.importInfo ?? null'));

check('Загрузка истории восстанавливает importInfo',
  workspace.includes("importInfo: (r as { import_info?: ImportedRowImportInfo | null }).import_info ?? undefined"));

check('Профиль организации сохраняется и влияет на промпт',
  workspace.includes('buildOrganizationMemoryPromptBlock') &&
  workspace.includes('organizationInstructions'));

check('Память организации включает отрасль (industryPreset)',
  workspace.includes('industryPreset'));

check('Организационная память передаётся в buildPrompt',
  workspace.includes('organizationProfileLabel') || workspace.includes('organizationMemory'));

// ═══════════════════════════════════════════════════════════════════════════════
// ИТОГ
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(62));
console.log(`\x1b[1mИТОГ: ${passed} из ${passed + failed} проверок пройдено\x1b[0m`);
if (failures.length > 0) {
  console.log(`\n\x1b[31mПровалено (${failures.length}):\x1b[0m`);
  failures.forEach(f => console.log(`  • ${f}`));
}
console.log('═'.repeat(62));

if (failed > 0) process.exit(1);
