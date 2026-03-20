const fs = require('fs');
const path = require('path');

const componentDir = path.join(__dirname, '..', 'frontend-react', 'src', 'components');
const utilsDir = path.join(__dirname, '..', 'frontend-react', 'src', 'utils');
const libDir = path.join(__dirname, '..', 'frontend-react', 'src', 'lib');
const typesDir = path.join(__dirname, '..', 'frontend-react', 'src', 'types');
const workspace = [
  path.join(__dirname, '..', 'frontend-react', 'src', 'App.tsx'),
  path.join(componentDir, 'Workspace.tsx'),
  path.join(componentDir, 'WorkspacePanels.tsx'),
  path.join(componentDir, 'WorkspaceReviewSections.tsx'),
  path.join(componentDir, 'WorkspaceReadinessSection.tsx'),
  path.join(componentDir, 'WorkspaceEvidencePanels.tsx'),
  path.join(componentDir, 'WorkspacePreviewPanel.tsx'),
  path.join(componentDir, 'WorkspaceReviewShared.tsx'),
  path.join(componentDir, 'WorkspacePreview.tsx'),
  path.join(componentDir, 'WorkspaceRowDetailPanel.tsx'),
  path.join(componentDir, 'WorkspaceRowsTable.tsx'),
  path.join(componentDir, 'WorkspaceSpecEditor.tsx'),
  path.join(componentDir, 'WorkspaceTypeSuggestions.tsx'),
  path.join(componentDir, 'PlatformPanel.tsx'),
  path.join(componentDir, 'workspace-panels.types.ts'),
  path.join(componentDir, 'workspace-publication.ts'),
  path.join(utilsDir, 'build-info.ts'),
  path.join(utilsDir, 'organization-memory.ts'),
  path.join(utilsDir, 'organization-templates.ts'),
  path.join(utilsDir, 'row-trust.ts'),
  path.join(utilsDir, 'row-import.ts'),
  path.join(libDir, 'backendApi.ts'),
  path.join(libDir, 'storage.ts'),
  path.join(typesDir, 'schemas.ts'),
].map((filePath) => fs.readFileSync(filePath, 'utf-8')).join('\n');

const checks = [
  {
    name: 'Normal generation does not inherit autopilot setting',
    ok: workspace.includes('const autopilotEnabled = !!options?.forceAutopilot;'),
  },
  {
    name: 'Search-first still runs for explicit autopilot or universal goods',
    ok: workspace.includes('const shouldSearchBeforeGenerate =')
      && workspace.includes('autopilotEnabled')
      && workspace.includes('isUniversalGoodsType(currentRow.type)')
      && workspace.includes('looksLikeSpecificModelQuery(currentRow.model)'),
  },
  {
    name: 'Readiness gate tracks auto-derived ПП1875 basis separately',
    ok: workspace.includes("const legal = { manualReview: 0, missingOkpd2: 0, missingBasis: 0, autoDerivedBasis: 0, pendingGeneration: 0 };")
      && workspace.includes('legal.autoDerivedBasis += 1;'),
  },
  {
    name: 'Exception without confirmed ПП1875 basis blocks publication',
    ok: workspace.includes("if (status === 'exception' && basisWeak)")
      && workspace.includes('указано исключение по ПП1875 без подтвержденного основания'),
  },
  {
    name: 'Non-exception legal basis without confirmation blocks final publication',
    ok: workspace.includes("else if (row.status === 'done' && status !== 'none' && basisWeak)")
      && workspace.includes('мера ПП1875 определена, но основание не подтверждено юридически')
      && workspace.includes("actionKind: 'legal_safe_fix'"),
  },
  {
    name: 'Service readiness gate checks result, SLA and acceptance completeness',
    ok: workspace.includes('function analyzeServiceSpecCoverage')
      && workspace.includes('service.missingResult += 1;')
      && workspace.includes('service.missingTiming += 1;')
      && workspace.includes('service.missingAcceptance += 1;')
      && workspace.includes('в ТЗ на услугу не хватает обязательных сервисных требований'),
  },
  {
    name: 'Service readiness issues can be auto-remediated from the gate',
    ok: workspace.includes('function buildServiceAutofillEntries')
      && workspace.includes("case 'service_fill_core':")
      && workspace.includes("case 'service_fill_all':")
      && workspace.includes('Добрать сервисное ядро')
      && workspace.includes('Довести сервисный контур'),
  },
  {
    name: 'Readiness gate supports one-click safe autofix and legal fallback',
    ok: workspace.includes('function applyLegalReadinessPatchToRow')
      && workspace.includes("case 'legal_safe_fix':")
      && workspace.includes('Автоисправить всё безопасное')
      && workspace.includes('Снять неподтвержденные исключения'),
  },
  {
    name: 'Classification assist can enrich OKPD2 and reduce manual review from readiness gate',
    ok: workspace.includes('function hasTrustedClassificationEvidence')
      && workspace.includes('function buildRowClassificationContext')
      && workspace.includes("case 'classify':")
      && workspace.includes('Уточнить классификацию')
      && workspace.includes('Добрать ОКПД2'),
  },
  {
    name: 'Publication autopilot chains classification, legal, benchmark and service fixes',
    ok: workspace.includes('const [publicationAutopilotRunning, setPublicationAutopilotRunning] = useState(false);')
      && workspace.includes('const runPublicationAutopilot = useCallback(async () => {')
      && workspace.includes("event: 'compliance.publication_autopilot'")
      && workspace.includes('Автодовести до публикации')
      && workspace.includes('Автодоводка по очереди уточняет классификацию'),
  },
  {
    name: 'Publication dossier is rendered and serialized across save, export and preview',
    ok: workspace.includes('function buildStoredPublicationDossierPayload')
      && workspace.includes('buildPublicationDossierSummaryText')
      && workspace.includes('Паспорт публикации')
      && workspace.includes('publication_dossier: publicationDossier')
      && workspace.includes('publicationDossier,'),
  },
  {
    name: 'Final DOCX/PDF export no longer embeds internal readiness and publication dossier tables',
    ok: workspace.includes("children.push(sectionHead('1. Наименование, Заказчик, Исполнитель, сроки выполнения', 0));")
      && !workspace.includes("children.push(centerPara('Сводка готовности к публикации'")
      && !workspace.includes("addParagraph('Сводка готовности к публикации'")
      && !workspace.includes("children.push(centerPara('Паспорт публикации'")
      && !workspace.includes("addParagraph('Паспорт публикации'"),
  },
  {
    name: 'Import supports DOCX tables, appendices and enumerated license lists',
    ok: workspace.includes("accept=\".csv,.tsv,.txt,.xlsx,.docx\"")
      && workspace.includes("lowerName.endsWith('.docx')")
      && workspace.includes('word/document.xml')
      && workspace.includes('parseDocxAppendixRows')
      && workspace.includes('parseDocxEnumeratedRows')
      && workspace.includes('нумерованные перечни лицензий'),
  },
  {
    name: 'DOCX import carries confidence, source context and seed specs into rows',
    ok: workspace.includes('type ImportedRowImportInfo = {')
      && workspace.includes('confidenceLabel')
      && workspace.includes('sourceContextText')
      && workspace.includes('specs?: SpecItem[];')
      && workspace.includes('Импорт: ')
      && workspace.includes('Уверенность импорта:'),
  },
  {
    name: 'Generation uses imported seed specs and batch progress for large files',
    ok: workspace.includes('const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);')
      && workspace.includes('if (hasImportedSeedSpecs(currentRow)) {')
      && workspace.includes('sourceStats.imported += 1;')
      && workspace.includes('Пакетная обработка включена, размер батча')
      && workspace.includes('Генерация ${generationProgress.current}/${generationProgress.total}'),
  },
  {
    name: 'Imported diagnostics are persisted through save and load history',
    ok: workspace.includes('import_info: r.importInfo ?? null')
      && workspace.includes("importInfo: (r as { import_info?: ImportedRowImportInfo | null }).import_info ?? undefined")
      && workspace.includes('import_info?: unknown | null;'),
  },
  {
    name: 'Workspace can split one import into separate TZ drafts by purpose',
    ok: workspace.includes('type ProcurementPurposeKey =')
      && workspace.includes('function buildProcurementSplitGroups')
      && workspace.includes('const openSplitGroup = useCallback')
      && workspace.includes('const restoreSplitGroupsSource = useCallback')
      && workspace.includes('const saveSplitGroupsLocally = useCallback')
      && workspace.includes('Разделить файл на отдельные ТЗ'),
  },
  {
    name: 'DOCX import prefers real enumerated positions and rejects boilerplate tables',
    ok: workspace.includes('function isLikelyProcurementTable')
      && workspace.includes('function looksLikeBoilerplateHeading')
      && workspace.includes('const appendixRows = parseDocxAppendixRows(content);')
      && workspace.includes('const enumeratedRows = parseDocxEnumeratedRows(content);')
      && workspace.includes('const tableRows = parseDocxTableRows(content.blocks);'),
  },
  {
    name: 'DOCX appendix detection uses Cyrillic-safe boundaries instead of \\b',
    ok: workspace.includes('const DOCX_APPENDIX_HEADING_RE = /^приложение(?:\\s|$|[.:])/i;')
      && workspace.includes('const DOCX_OKPD2_PREFIX_RE = /^код окпд2(?:\\s|$|[.:])/i;')
      && !workspace.includes('/^приложение\\b/i')
      && !workspace.includes('/^код окпд2\\b/i'),
  },
  {
    name: 'Top-level DOCX tables are parsed instead of only nested wrapper tables',
    ok: workspace.includes('function extractDocxTablesFromTable(table: Element, result: string[][][]): void {')
      && workspace.includes('extractDocxTablesFromTable(child, extractedTables);')
      && workspace.includes('extractDocxTablesFromTable(child, result);'),
  },
  {
    name: 'Import replaces the current draft instead of appending stale rows',
    ok: workspace.includes('setRows(mappedRows);')
      && workspace.includes('Текущий черновик заменён.'),
  },
  {
    name: 'Publication gate stays neutral until generation or imported specs appear',
    ok: workspace.includes("const publicationStatusLabel = draftedRowsCount === 0")
      && workspace.includes("!hasPublicationBaseline\n      ? 'Нужна генерация'")
      && workspace.includes("Следующий шаг: сгенерировать ТЗ")
      && workspace.includes('showPublicationControl={hasPublicationBaseline && liveLegalSummarySourceRows.length > 0}'),
  },
  {
    name: 'Freeform office consumables can override device autodetect for shredder oil',
    ok: workspace.includes("return 'shredderOil';")
      && workspace.includes("масло для шредера 350 мл"),
  },
  {
    name: 'Cable tester prompt covers telephone testers with tone generator',
    ok: workspace.includes('телефонный тестер с генератором')
      && workspace.includes('генерация тона при применимости')
      && workspace.includes('индуктивного щупа'),
  },
  {
    name: 'Row detail shows a trust passport with explainable publication signals',
    ok: workspace.includes('Паспорт доверия строки')
      && workspace.includes('buildRowTrustPassport')
      && workspace.includes('Строка пока не готова к публикации')
      && workspace.includes('Внешняя сверка'),
  },
  {
    name: 'Frontend build label is centralized instead of hardcoded in the workspace component',
    ok: workspace.includes('FALLBACK_BUILD_LABEL')
      && workspace.includes('APP_BUILD_META')
      && workspace.includes("import { APP_BUILD_LABEL } from '../utils/build-info';"),
  },
  {
    name: 'Organization memory flows through settings, prompts and export payloads',
    ok: workspace.includes('buildOrganizationMemoryPromptBlock')
      && workspace.includes('industryPreset')
      && workspace.includes('organizationInstructions')
      && workspace.includes('defaultWarrantyMonths')
      && workspace.includes('Профиль организации')
      && workspace.includes('organizationProfileLabel'),
  },
  {
    name: 'Workspace now supports organization template packs and saved team templates',
    ok: workspace.includes('getSuggestedOrganizationTemplatePacks')
      && workspace.includes('saveWorkspaceTemplate')
      && workspace.includes('Шаблоны организации')
      && workspace.includes('Сохранить текущий набор как шаблон')
      && workspace.includes('Сохранённые шаблоны команды'),
  },
];

let failed = 0;

for (const check of checks) {
  const marker = check.ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${marker} ${check.name}`);
  if (!check.ok) failed += 1;
}

console.log(`\n${checks.length - failed}/${checks.length} checks passed`);

if (failed > 0) process.exit(1);
