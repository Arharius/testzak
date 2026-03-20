import type { SpecItem } from '../utils/spec-processor';
import type { ImportedRowImportInfo } from '../utils/row-import';
import { buildRowTrustPassport } from '../utils/row-trust';

type GoodsRowLike = {
  id: number;
  type: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
  specs?: SpecItem[];
  meta?: Record<string, string>;
  benchmark?: {
    sourceSpecs: SpecItem[];
    sourceCompareLabel: string;
    sourceContextText?: string;
  };
  importInfo?: ImportedRowImportInfo;
};

type RowActionStateLike = {
  rowId: number;
  source: 'internet' | 'eis' | 'classify';
} | null;

type DraftSourceComparisonLike = {
  matched: unknown[];
  changed: unknown[];
  onlySource: unknown[];
  onlyDraft: unknown[];
};

type WorkspaceRowDetailPanelProps = {
  row: GoodsRowLike;
  editingRowId: number | null;
  rowActionState: RowActionStateLike;
  publicationAutopilotRunning: boolean;
  canUseAiAssist: boolean;
  benchmarkingEnabled: boolean;
  getResolvedOkpd2Code: (row: GoodsRowLike) => string;
  getResolvedOkpd2Name: (row: GoodsRowLike) => string;
  getResolvedKtruCode: (row: GoodsRowLike) => string;
  getResolvedLaw175Meta: (rowType: string, meta?: Record<string, string>) => {
    regime: string;
    basisDisplay: string;
  };
  getUnifiedNacRegime: (key: string) => string;
  getLaw175MeasureLabel: (status: string, regime: string) => string;
  getClassificationSourceLabel: (meta?: Record<string, string>, rowType?: string) => string;
  requiresManualClassificationReview: (row: GoodsRowLike) => boolean;
  getLaw175EvidenceText: (row: GoodsRowLike) => string;
  isServiceCatalogType: (key: string) => boolean;
  buildDraftSourceComparison: (sourceSpecs: SpecItem[], draftSpecs: SpecItem[], rowType: string) => DraftSourceComparisonLike;
  getBenchmarkRiskLevel: (comparison: DraftSourceComparisonLike) => 'ok' | 'warn' | 'block';
  onToggleRowEditing: (rowId: number) => void;
  onRefreshRowFromSource: (rowId: number, source: 'internet' | 'eis') => void;
  onRefreshRowClassification: (rowId: number) => void;
};

export function WorkspaceRowDetailPanel({
  row,
  editingRowId,
  rowActionState,
  publicationAutopilotRunning,
  canUseAiAssist,
  benchmarkingEnabled,
  getResolvedOkpd2Code,
  getResolvedOkpd2Name,
  getResolvedKtruCode,
  getResolvedLaw175Meta,
  getUnifiedNacRegime,
  getLaw175MeasureLabel,
  getClassificationSourceLabel,
  requiresManualClassificationReview,
  getLaw175EvidenceText,
  isServiceCatalogType,
  buildDraftSourceComparison,
  getBenchmarkRiskLevel,
  onToggleRowEditing,
  onRefreshRowFromSource,
  onRefreshRowClassification,
}: WorkspaceRowDetailPanelProps) {
  const law175Meta = getResolvedLaw175Meta(row.type, row.meta);
  const law175Label = getLaw175MeasureLabel(row.meta?.law175_status || '', row.meta?.nac_regime || getUnifiedNacRegime(row.type));
  const benchmarkComparison = row.benchmark && row.specs?.length
    ? buildDraftSourceComparison(row.benchmark.sourceSpecs, row.specs, row.type)
    : null;
  const benchmarkRiskLevel = benchmarkComparison ? getBenchmarkRiskLevel(benchmarkComparison) : null;
  const benchmarkContextPreview = String(row.benchmark?.sourceContextText || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const classificationSourceKey = String(row.meta?.classification_source || '').trim().toLowerCase()
    || (row.type === 'otherGoods' || row.type === 'otherService' ? 'ai' : 'catalog');
  const trustPassport = buildRowTrustPassport({
    status: row.status,
    error: row.error,
    specs: row.specs,
    okpd2Code: getResolvedOkpd2Code(row),
    ktruCode: getResolvedKtruCode(row),
    classificationSourceKey,
    classificationSourceLabel: getClassificationSourceLabel(row.meta, row.type),
    law175Label,
    law175EvidenceText: getLaw175EvidenceText(row),
    requiresManualReview: requiresManualClassificationReview(row),
    expectExternalSource: benchmarkingEnabled && !isServiceCatalogType(row.type),
    benchmark: row.benchmark && benchmarkComparison && benchmarkRiskLevel
      ? {
          label: row.benchmark.sourceCompareLabel,
          riskLevel: benchmarkRiskLevel,
          matched: benchmarkComparison.matched.length,
          changed: benchmarkComparison.changed.length,
          missing: benchmarkComparison.onlySource.length,
          added: benchmarkComparison.onlyDraft.length,
          contextPreview: benchmarkContextPreview,
        }
      : null,
    importInfo: row.importInfo ? {
      sourceFormat: row.importInfo.sourceFormat,
      confidence: row.importInfo.confidence,
      confidenceLabel: row.importInfo.confidenceLabel,
      needsReview: row.importInfo.needsReview,
      ignoredBlocks: row.importInfo.ignoredBlocks,
      sourcePreview: row.importInfo.sourcePreview,
    } : null,
  });

  return (
    <div className="row-detail-panel">
      <div className="row-detail-grid">
        <div className="row-detail-section row-detail-section--wide">
          <div className="row-detail-title">Паспорт доверия строки</div>
          <div className={`row-trust-summary row-trust-summary--${trustPassport.tone}`}>
            <div className="row-trust-summary-copy">
              <strong>{trustPassport.title}</strong>
              <p>{trustPassport.summary}</p>
            </div>
            <div className="workspace-chip-row workspace-chip-row--detail">
              <span className={`workspace-status-badge workspace-status-badge--${trustPassport.tone}`}>
                {trustPassport.tone === 'block'
                  ? 'Есть блокер'
                  : trustPassport.tone === 'warn'
                    ? 'Нужна проверка'
                    : trustPassport.tone === 'ready'
                      ? 'Выглядит надёжно'
                      : 'Черновик'}
              </span>
              <span className="workspace-mini-chip">Источник: {getClassificationSourceLabel(row.meta, row.type)}</span>
              {row.benchmark?.sourceCompareLabel && (
                <span className="workspace-mini-chip">Сверка: {row.benchmark.sourceCompareLabel}</span>
              )}
              {row.importInfo && (
                <span className={`workspace-mini-chip ${row.importInfo.needsReview ? 'is-warn' : ''}`}>
                  Импорт: {Math.round((row.importInfo.confidence || 0) * 100)}%
                </span>
              )}
            </div>
          </div>
          <div className="row-trust-facts">
            {trustPassport.facts.map((fact) => (
              <div key={`${fact.label}-${fact.detail}`} className={`row-trust-fact row-trust-fact--${fact.tone}`}>
                <strong>{fact.label}</strong>
                <span>{fact.detail}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="row-detail-title">Классификация и правовой контур</div>
          <div className="row-detail-copy">
            <strong>ОКПД2:</strong> {getResolvedOkpd2Code(row) || 'не определён'}{getResolvedOkpd2Name(row) ? ` — ${getResolvedOkpd2Name(row)}` : ''}
          </div>
          <div className="row-detail-copy">
            <strong>КТРУ:</strong> {getResolvedKtruCode(row) || 'не указан / не применяется'}
          </div>
          <div className="row-detail-copy">
            <strong>ПП1875:</strong> {law175Label}
          </div>
          {law175Meta.basisDisplay && (
            <div className="row-detail-copy">
              <strong>Основание / исключение:</strong> {law175Meta.basisDisplay}
            </div>
          )}
          <div className="row-detail-copy">
            <strong>Источник:</strong> {getClassificationSourceLabel(row.meta, row.type)}{requiresManualClassificationReview(row) ? ' · требуется ручная верификация' : ''}
          </div>
          <div className="row-detail-copy">
            <strong>Документы:</strong> {getLaw175EvidenceText(row)}
          </div>
        </div>
        <div>
          <div className="row-detail-title">Действия по строке</div>
          <div className="row-detail-actions">
            {row.status === 'done' && (
              <button
                type="button"
                className={`row-edit-toggle ${editingRowId === row.id ? 'is-active' : ''}`}
                onClick={() => onToggleRowEditing(row.id)}
              >
                {editingRowId === row.id ? '✓ Закрыть редактор' : '✏️ Редактировать характеристики'}
              </button>
            )}
            <button
              type="button"
              onClick={() => onRefreshRowFromSource(row.id, 'internet')}
              disabled={!canUseAiAssist || !!rowActionState || publicationAutopilotRunning}
              title={!canUseAiAssist ? 'Требуется доступ к backend/AI для точечного поиска источника' : 'Подтянуть характеристики именно для этой строки из интернета'}
            >
              {rowActionState?.rowId === row.id && rowActionState.source === 'internet' ? '⏳ Web' : '🌐 Web'}
            </button>
            <button
              type="button"
              onClick={() => onRefreshRowFromSource(row.id, 'eis')}
              disabled={!canUseAiAssist || !!rowActionState || publicationAutopilotRunning}
              title={!canUseAiAssist ? 'Требуется доступ к backend/AI для поиска в ЕИС' : 'Переискать эту строку в ЕИС и реестрах'}
            >
              {rowActionState?.rowId === row.id && rowActionState.source === 'eis' ? '⏳ ЕИС' : '🏛️ ЕИС'}
            </button>
            <button
              type="button"
              onClick={() => onRefreshRowClassification(row.id)}
              disabled={!canUseAiAssist || !!rowActionState || publicationAutopilotRunning}
              title={!canUseAiAssist ? 'Требуется доступ к backend/AI для уточнения классификации' : 'Уточнить ОКПД2, КТРУ и статус ПП1875 для этой строки'}
            >
              {rowActionState?.rowId === row.id && rowActionState.source === 'classify' ? '⏳ Уточнение...' : '🧭 Уточнить'}
            </button>
          </div>
          <div className="workspace-chip-row workspace-chip-row--detail">
            {(() => {
              if (row.benchmark && benchmarkComparison && benchmarkRiskLevel) {
                const riskLevel = benchmarkRiskLevel;
                const riskLabel = riskLevel === 'block'
                  ? 'есть расхождения'
                  : riskLevel === 'warn'
                    ? 'нужна проверка'
                    : 'совпадает';
                return (
                  <span className={`workspace-status-badge workspace-status-badge--${riskLevel === 'block' ? 'block' : riskLevel === 'warn' ? 'warn' : 'ready'}`}>
                    Сверка: {riskLabel}
                  </span>
                );
              }
              if (benchmarkingEnabled && !isServiceCatalogType(row.type)) {
                return <span className="workspace-mini-chip">Источник для сверки: нет</span>;
              }
              return null;
            })()}
            {requiresManualClassificationReview(row) && (
              <span className="workspace-mini-chip is-warn">Юр. проверка</span>
            )}
          </div>
        </div>
        {row.importInfo && (
          <div>
            <div className="row-detail-title">Импорт из исходного файла</div>
            <div className="row-detail-copy">
              <strong>Источник:</strong> {row.importInfo.sourceFormat.toUpperCase()} · {row.importInfo.sourceKind}
            </div>
            <div className="row-detail-copy">
              <strong>Уверенность импорта:</strong> {Math.round((row.importInfo.confidence || 0) * 100)}% ({row.importInfo.confidenceLabel})
            </div>
            <div className="row-detail-copy">
              <strong>Требует проверки:</strong> {row.importInfo.needsReview ? 'да' : 'нет'}
            </div>
            <div className="row-detail-copy">
              <strong>Игнорировано блоков:</strong> {row.importInfo.ignoredBlocks || 0}
            </div>
            {!!row.specs?.length && (
              <div className="row-detail-copy">
                <strong>Импортировано характеристик:</strong> {row.specs.length}
              </div>
            )}
            {row.importInfo.sourcePreview && (
              <div className="row-detail-copy">
                <strong>Фрагмент:</strong> {row.importInfo.sourcePreview}
              </div>
            )}
            {row.importInfo.notes?.slice(0, 5).map((note) => (
              <div key={note} className="row-detail-copy">
                • {note}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
