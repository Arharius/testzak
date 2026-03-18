import type { SpecItem } from '../utils/spec-processor';
import type { ImportedRowImportInfo } from '../utils/row-import';

type GoodsRowLike = {
  id: number;
  type: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  specs?: SpecItem[];
  meta?: Record<string, string>;
  benchmark?: {
    sourceSpecs: SpecItem[];
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

  return (
    <div className="row-detail-panel">
      <div className="row-detail-grid">
        <div>
          <div className="row-detail-title">Классификация и правовой контур</div>
          <div className="row-detail-copy">
            <strong>ОКПД2:</strong> {getResolvedOkpd2Code(row) || 'не определён'}{getResolvedOkpd2Name(row) ? ` — ${getResolvedOkpd2Name(row)}` : ''}
          </div>
          <div className="row-detail-copy">
            <strong>КТРУ:</strong> {getResolvedKtruCode(row) || 'не указан / не применяется'}
          </div>
          <div className="row-detail-copy">
            <strong>ПП1875:</strong> {getLaw175MeasureLabel(row.meta?.law175_status || '', row.meta?.nac_regime || getUnifiedNacRegime(row.type))}
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
              title={!canUseAiAssist ? 'Требуется доступ к backend/AI для уточнения классификации' : 'Переобогатить ОКПД2, КТРУ и статус ПП1875 для этой строки'}
            >
              {rowActionState?.rowId === row.id && rowActionState.source === 'classify' ? '⏳ Класс.' : '🧭 Класс.'}
            </button>
          </div>
          <div className="workspace-chip-row workspace-chip-row--detail">
            {(() => {
              if (row.benchmark && row.specs?.length) {
                const riskLevel = getBenchmarkRiskLevel(buildDraftSourceComparison(row.benchmark.sourceSpecs, row.specs, row.type));
                return (
                  <span className={`workspace-status-badge workspace-status-badge--${riskLevel === 'block' ? 'block' : riskLevel === 'warn' ? 'warn' : 'ready'}`}>
                    Benchmark: {riskLevel}
                  </span>
                );
              }
              if (benchmarkingEnabled && !isServiceCatalogType(row.type)) {
                return <span className="workspace-mini-chip">Benchmark: нет</span>;
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
