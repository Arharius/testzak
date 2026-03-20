import { WorkspaceReviewActionCard } from './WorkspaceReviewShared';
import type { BenchmarkBulkMode, BenchmarkRowLike, LegalSummaryRowLike } from './workspace-panels.types';

type WorkspaceEvidencePanelsProps = {
  evidenceRows: LegalSummaryRowLike[];
  evidenceSummaryText: string;
  showBenchmarking: boolean;
  benchmarkSummary: { ok: number; warn: number; block: number };
  benchmarkRows: BenchmarkRowLike[];
  onApplyBenchmarkPatch: (rowId: number, mode: BenchmarkBulkMode) => void;
};

export function WorkspaceEvidencePanels({
  evidenceRows,
  evidenceSummaryText,
  showBenchmarking,
  benchmarkSummary,
  benchmarkRows,
  onApplyBenchmarkPatch,
}: WorkspaceEvidencePanelsProps) {
  return (
    <>
      {evidenceRows.length > 0 && (
        <details className="workspace-disclosure">
          <summary className="workspace-disclosure-summary">
            <div>
              <strong>Юр. подтверждение</strong>
              <span>ОКПД2, КТРУ, ПП1875 и подтверждающие документы</span>
            </div>
            <span className="workspace-side-meta">{evidenceRows.length} поз.</span>
          </summary>
          <div className="workspace-disclosure-body">
            <div className="workspace-review-card">
              <div className="workspace-review-card-head">
                <div>
                  <strong>Юридическая сводка по позициям</strong>
                  <span>ПП1875, ОКПД2, КТРУ и подтверждающие документы</span>
                </div>
              </div>
              <div className="workspace-review-note workspace-review-note--flush">{evidenceSummaryText}</div>
              <div className="workspace-legal-table-wrap">
                <table className="workspace-legal-table">
                  <thead>
                    <tr className="workspace-legal-table-head">
                      <th className="workspace-legal-cell workspace-legal-cell--num">№</th>
                      <th className="workspace-legal-cell workspace-legal-cell--item">Позиция</th>
                      <th className="workspace-legal-cell workspace-legal-cell--classifier">ОКПД2 / КТРУ</th>
                      <th className="workspace-legal-cell workspace-legal-cell--measure">ПП1875</th>
                      <th className="workspace-legal-cell workspace-legal-cell--action">Что приложить / проверить</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evidenceRows.map((item, idx) => (
                      <tr key={`${item.index}-${item.item}`} className={`workspace-legal-row ${idx % 2 === 0 ? 'is-even' : 'is-odd'}`}>
                        <td className="workspace-legal-cell workspace-legal-cell--index">{item.index}</td>
                        <td className="workspace-legal-cell workspace-legal-cell--item-copy">{item.item}</td>
                        <td className="workspace-legal-cell workspace-legal-cell--classifier-copy">{item.classifier}</td>
                        <td className="workspace-legal-cell workspace-legal-cell--measure-copy">{item.measure}</td>
                        <td className="workspace-legal-cell workspace-legal-cell--action-copy">{item.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </details>
      )}

      {showBenchmarking && benchmarkRows.length > 0 && (
        <details className="workspace-disclosure">
          <summary className="workspace-disclosure-summary">
            <div>
              <strong>Внешняя сверка</strong>
              <span>ЕИС, КТРУ, площадки и документация</span>
            </div>
            <span className="workspace-side-meta">{benchmarkRows.length} поз.</span>
          </summary>
          <div className="workspace-disclosure-body">
            <div className="workspace-review-stack">
              <WorkspaceReviewActionCard
                title="Контроль внешней сверки"
                subtitle={benchmarkSummary.block > 0
                  ? 'Есть блокирующие расхождения'
                  : benchmarkSummary.warn > 0
                    ? 'Есть позиции на доработку'
                    : 'Критичных расхождений нет'}
                tone={benchmarkSummary.block > 0 ? 'block' : benchmarkSummary.warn > 0 ? 'warn' : 'ready'}
              >
                <div className="workspace-chip-row">
                  <span className="workspace-mini-chip">OK: {benchmarkSummary.ok}</span>
                  <span className="workspace-mini-chip is-warn">Warn: {benchmarkSummary.warn}</span>
                  <span className="workspace-mini-chip is-block">Block: {benchmarkSummary.block}</span>
                </div>
              </WorkspaceReviewActionCard>

              <div className="workspace-review-stack">
                {benchmarkRows.map((item) => (
                  <div key={`benchmark-${item.id}`} className={`workspace-review-card is-${item.riskLevel === 'ok' ? 'ready' : item.riskLevel}`}>
                    <div className="workspace-review-card-head">
                      <div>
                        <strong>#{item.index}. {item.goodsName}{item.model ? ` (${item.model})` : ''}</strong>
                        <span>Источник: {item.label}</span>
                      </div>
                    </div>
                    <div className="workspace-chip-row">
                      <span className="workspace-mini-chip">Совпало: {item.comparison.matched.length}</span>
                      <span className="workspace-mini-chip is-warn">Изменено: {item.comparison.changed.length}</span>
                      <span className="workspace-mini-chip is-block">Нет в нашем ТЗ: {item.comparison.onlySource.length}</span>
                      <span className="workspace-mini-chip">Добавили сами: {item.comparison.onlyDraft.length}</span>
                    </div>
                    <div className={`workspace-review-note workspace-review-note--flush ${item.riskLevel === 'block' ? 'is-block' : item.riskLevel === 'warn' ? 'is-warn' : 'is-ready'}`}>
                      {item.riskSummary}
                    </div>
                    <div className="workspace-action-grid workspace-action-grid--compact">
                      {item.comparison.onlySource.length > 0 && (
                        <button
                          type="button"
                          onClick={() => onApplyBenchmarkPatch(item.id, 'missing')}
                          className="workspace-action-button is-benchmark-add"
                        >
                          + Добавить пропущенное ({item.comparison.onlySource.length})
                        </button>
                      )}
                      {item.comparison.changed.length > 0 && (
                        <button
                          type="button"
                          onClick={() => onApplyBenchmarkPatch(item.id, 'changed')}
                          className="workspace-action-button is-benchmark-apply"
                        >
                          ⇄ Принять данные источника ({item.comparison.changed.length})
                        </button>
                      )}
                      {(item.comparison.onlySource.length > 0 || item.comparison.changed.length > 0) && (
                        <button
                          type="button"
                          onClick={() => onApplyBenchmarkPatch(item.id, 'all')}
                          className="workspace-action-button is-benchmark-sync"
                        >
                          Синхронизировать всё
                        </button>
                      )}
                    </div>
                    <div className="workspace-review-issues">
                      <div className="workspace-review-issue is-warn">Изменено: {item.changedPreview}</div>
                      <div className="workspace-review-issue is-block">Не перенесли: {item.missingPreview}</div>
                      <div className="workspace-review-issue">Добавили сами: {item.addedPreview}</div>
                      {item.contextPreview && (
                        <div className="workspace-review-issue">Контекст источника: {item.contextPreview}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </details>
      )}
    </>
  );
}
