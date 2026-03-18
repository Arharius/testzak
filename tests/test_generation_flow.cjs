const fs = require('fs');
const path = require('path');

const componentDir = path.join(__dirname, '..', 'frontend-react', 'src', 'components');
const workspace = [
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
  path.join(componentDir, 'workspace-panels.types.ts'),
  path.join(componentDir, 'workspace-publication.ts'),
].map((filePath) => fs.readFileSync(filePath, 'utf-8')).join('\n');

const checks = [
  {
    name: 'Normal generation does not inherit autopilot setting',
    ok: workspace.includes('const autopilotEnabled = !!options?.forceAutopilot;'),
  },
  {
    name: 'Search-first still runs for explicit autopilot or universal goods',
    ok: workspace.includes('const shouldSearchBeforeGenerate = autopilotEnabled || isUniversalGoodsType(currentRow.type);'),
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
    name: 'Non-exception legal basis that stays weak is downgraded to warning',
    ok: workspace.includes("else if (row.status === 'done' && status !== 'none' && basisWeak)")
      && workspace.includes('мера ПП1875 определена, но основание пока не подтверждено юридически'),
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
      && workspace.includes('Переобогатить классификацию')
      && workspace.includes('Добрать ОКПД2'),
  },
  {
    name: 'Publication autopilot chains classification, legal, benchmark and service fixes',
    ok: workspace.includes('const [publicationAutopilotRunning, setPublicationAutopilotRunning] = useState(false);')
      && workspace.includes('const runPublicationAutopilot = useCallback(async () => {')
      && workspace.includes("event: 'compliance.publication_autopilot'")
      && workspace.includes('Автодовести до публикации')
      && workspace.includes('Publication autopilot последовательно переобогащает классификацию'),
  },
  {
    name: 'Publication dossier is rendered and serialized across save, export and preview',
    ok: workspace.includes('function buildStoredPublicationDossierPayload')
      && workspace.includes('buildPublicationDossierSummaryText')
      && workspace.includes('Паспорт публикации')
      && workspace.includes('publication_dossier: publicationDossier')
      && workspace.includes('publicationDossier,'),
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
