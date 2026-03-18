import type { ComplianceReport } from '../utils/compliance';
import { WorkspaceReviewActionCard, WorkspaceReviewIssueList } from './WorkspaceReviewShared';
import type {
  BenchmarkBulkMode,
  ClassificationBulkMode,
  PublicationStatusTone,
  ReadinessGateSummaryLike,
  ReadinessIssueLike,
  ServiceBulkMode,
} from './workspace-panels.types';

type WorkspaceReadinessSectionProps = {
  showPublicationControl: boolean;
  publicationStatusTone: PublicationStatusTone;
  publicationStatusLabel: string;
  readinessGate: ReadinessGateSummaryLike;
  publicationAutopilotActions: { totalRows: number };
  publicationAutopilotRunning: boolean;
  rowActionBusy: boolean;
  readinessAutofixActions: { totalRows: number };
  legalBulkActions: { safeFixRows: number };
  classificationBulkActions: { allRows: number; missingOkpd2Rows: number; reviewRows: number };
  benchmarkBulkActions: { missingRows: number; changedRows: number; allRows: number };
  serviceBulkActions: { coreRows: number; allRows: number };
  canUseAiAssist: boolean;
  onRunPublicationAutopilot: () => void;
  onApplyReadinessSafeAutofix: () => void;
  onApplyLegalReadinessPatchBulk: () => void;
  onRefreshClassificationBulk: (mode: ClassificationBulkMode) => void;
  onApplyBenchmarkPatchBulk: (mode: BenchmarkBulkMode) => void;
  onApplyServiceReadinessPatchBulk: (mode: ServiceBulkMode) => void;
  onHandleReadinessIssueAction: (issue: ReadinessIssueLike) => void;
  complianceReport: ComplianceReport | null;
  readyRowsCount: number;
};

export function WorkspaceReadinessSection({
  showPublicationControl,
  publicationStatusTone,
  publicationStatusLabel,
  readinessGate,
  publicationAutopilotActions,
  publicationAutopilotRunning,
  rowActionBusy,
  readinessAutofixActions,
  legalBulkActions,
  classificationBulkActions,
  benchmarkBulkActions,
  serviceBulkActions,
  canUseAiAssist,
  onRunPublicationAutopilot,
  onApplyReadinessSafeAutofix,
  onApplyLegalReadinessPatchBulk,
  onRefreshClassificationBulk,
  onApplyBenchmarkPatchBulk,
  onApplyServiceReadinessPatchBulk,
  onHandleReadinessIssueAction,
  complianceReport,
  readyRowsCount,
}: WorkspaceReadinessSectionProps) {
  return (
    <>
      {showPublicationControl && (
        <details className="workspace-disclosure" {...(readinessGate.status !== 'ready' ? { open: true } : {})}>
          <summary className="workspace-disclosure-summary">
            <div>
              <strong>Полный контроль публикации</strong>
              <span>Readiness gate, autofix и проблемные позиции</span>
            </div>
            <span className={`workspace-status-badge workspace-status-badge--${publicationStatusTone}`}>
              {publicationStatusLabel}
            </span>
          </summary>
          <div className="workspace-disclosure-body">
            <div className="workspace-review-stack">
              <WorkspaceReviewActionCard
                title="Readiness gate перед публикацией"
                subtitle={`Проверено позиций: ${readinessGate.itemsReviewed}. Блокеров: ${readinessGate.blockers.length}. Предупреждений: ${readinessGate.warnings.length}.`}
                tone={publicationStatusTone}
              >
                <div className="workspace-chip-row">
                  <span className="workspace-mini-chip is-block">Block: {readinessGate.blockers.length}</span>
                  <span className="workspace-mini-chip is-warn">Warn: {readinessGate.warnings.length}</span>
                  <span className="workspace-mini-chip">Готово: {readyRowsCount}</span>
                  <span className="workspace-mini-chip">Anti-ФАС: {readinessGate.antiFas.score ?? '—'}/{readinessGate.antiFas.minScore ?? '—'}</span>
                  {readinessGate.service.reviewed > 0 && (
                    <span className="workspace-mini-chip">Услуги: {readinessGate.service.reviewed}</span>
                  )}
                </div>
                <div className="workspace-metric-grid">
                  <div className="workspace-metric-card">
                    <span>Без источника</span>
                    <strong>{readinessGate.benchmark.withoutSource}</strong>
                  </div>
                  <div className={`workspace-metric-card ${readinessGate.legal.manualReview > 0 ? 'is-warn' : ''}`}>
                    <span>Ручная вериф.</span>
                    <strong>{readinessGate.legal.manualReview}</strong>
                  </div>
                  <div className={`workspace-metric-card ${readinessGate.legal.missingOkpd2 > 0 ? 'is-warn' : ''}`}>
                    <span>Без ОКПД2</span>
                    <strong>{readinessGate.legal.missingOkpd2}</strong>
                  </div>
                  <div className={`workspace-metric-card ${readinessGate.legal.missingBasis > 0 ? 'is-block' : readinessGate.legal.autoDerivedBasis > 0 ? 'is-warn' : ''}`}>
                    <span>Основание ПП1875</span>
                    <strong>{readinessGate.legal.missingBasis > 0 ? readinessGate.legal.missingBasis : readinessGate.legal.autoDerivedBasis}</strong>
                  </div>
                </div>
              </WorkspaceReviewActionCard>

              {(publicationAutopilotActions.totalRows > 0 ||
                readinessAutofixActions.totalRows > 0 ||
                classificationBulkActions.allRows > 0 ||
                benchmarkBulkActions.allRows > 0 ||
                serviceBulkActions.allRows > 0) && (
                <details className="workspace-disclosure workspace-disclosure--nested">
                  <summary className="workspace-disclosure-summary">
                    <div>
                      <strong>Инструменты исправления</strong>
                      <span>Автодоводка, уточнение классификации, внешняя сверка и сервисные требования</span>
                    </div>
                    <span className="workspace-side-meta">массовые действия</span>
                  </summary>
                  <div className="workspace-disclosure-body">
                    <div className="workspace-review-stack">
                      {(publicationAutopilotActions.totalRows > 0 || readinessAutofixActions.totalRows > 0 || legalBulkActions.safeFixRows > 0) && (
                        <WorkspaceReviewActionCard
                          title="Автодоводка и безопасные исправления"
                          subtitle="Главный режим исправления перед публикацией"
                          tone={publicationAutopilotActions.totalRows > 0 ? 'ready' : 'neutral'}
                          note="Автодоводка по очереди уточняет классификацию, снимает неподтверждённые исключения, сверяет характеристики с источником и добирает сервисные требования."
                        >
                          <div className="workspace-action-grid workspace-action-grid--compact">
                            {publicationAutopilotActions.totalRows > 0 && (
                              <button
                                type="button"
                                onClick={onRunPublicationAutopilot}
                                disabled={publicationAutopilotRunning || rowActionBusy}
                                className="workspace-action-button is-autopilot"
                              >
                                {publicationAutopilotRunning ? '⏳ Автодоводка...' : `Автодовести до публикации (${publicationAutopilotActions.totalRows})`}
                              </button>
                            )}
                            {readinessAutofixActions.totalRows > 0 && (
                              <button
                                type="button"
                                onClick={onApplyReadinessSafeAutofix}
                                disabled={publicationAutopilotRunning}
                                className="workspace-action-button is-safe-fix"
                              >
                                Автоисправить всё безопасное ({readinessAutofixActions.totalRows})
                              </button>
                            )}
                            {legalBulkActions.safeFixRows > 0 && (
                              <button
                                type="button"
                                onClick={onApplyLegalReadinessPatchBulk}
                                disabled={publicationAutopilotRunning}
                                className="workspace-action-button is-legal-fix"
                              >
                                Снять неподтвержденные исключения ({legalBulkActions.safeFixRows})
                              </button>
                            )}
                          </div>
                        </WorkspaceReviewActionCard>
                      )}

                      {classificationBulkActions.allRows > 0 && (
                        <WorkspaceReviewActionCard
                          title="Классификация"
                          subtitle="Добор ОКПД2, КТРУ и снятие ручной верификации"
                          note="Система использует ЕИС, внешние источники и ИИ, чтобы уточнить правовой статус позиции перед публикацией."
                        >
                          <div className="workspace-action-grid workspace-action-grid--compact">
                            <button
                              type="button"
                              onClick={() => onRefreshClassificationBulk('all')}
                              disabled={!canUseAiAssist || rowActionBusy || publicationAutopilotRunning}
                              className="workspace-action-button is-classify"
                            >
                              Уточнить классификацию ({classificationBulkActions.allRows})
                            </button>
                            {classificationBulkActions.missingOkpd2Rows > 0 && (
                              <button
                                type="button"
                                onClick={() => onRefreshClassificationBulk('missing')}
                                disabled={!canUseAiAssist || rowActionBusy || publicationAutopilotRunning}
                                className="workspace-action-button is-okpd2"
                              >
                                Добрать ОКПД2 ({classificationBulkActions.missingOkpd2Rows})
                              </button>
                            )}
                            {classificationBulkActions.reviewRows > 0 && (
                              <button
                                type="button"
                                onClick={() => onRefreshClassificationBulk('review')}
                                disabled={!canUseAiAssist || rowActionBusy || publicationAutopilotRunning}
                                className="workspace-action-button is-review-fix"
                              >
                                Снять ручную верификацию ({classificationBulkActions.reviewRows})
                              </button>
                            )}
                          </div>
                        </WorkspaceReviewActionCard>
                      )}

                      {(benchmarkBulkActions.missingRows > 0 || benchmarkBulkActions.changedRows > 0 || benchmarkBulkActions.allRows > 0) && (
                        <WorkspaceReviewActionCard
                          title="Сверка с внешним источником"
                          subtitle="Проверка характеристик по ЕИС или документации"
                        >
                          <div className="workspace-action-grid workspace-action-grid--compact">
                            {benchmarkBulkActions.missingRows > 0 && (
                              <button
                                type="button"
                                onClick={() => onApplyBenchmarkPatchBulk('missing')}
                                className="workspace-action-button is-benchmark-add"
                              >
                                + Добрать недостающее ({benchmarkBulkActions.missingRows})
                              </button>
                            )}
                            {benchmarkBulkActions.changedRows > 0 && (
                              <button
                                type="button"
                                onClick={() => onApplyBenchmarkPatchBulk('changed')}
                                className="workspace-action-button is-benchmark-apply"
                              >
                                ⇄ Принять данные источника ({benchmarkBulkActions.changedRows})
                              </button>
                            )}
                            {benchmarkBulkActions.allRows > 0 && (
                              <button
                                type="button"
                                onClick={() => onApplyBenchmarkPatchBulk('all')}
                                className="workspace-action-button is-benchmark-sync"
                              >
                                Сверить все риск-позиции ({benchmarkBulkActions.allRows})
                              </button>
                            )}
                          </div>
                        </WorkspaceReviewActionCard>
                      )}

                      {(serviceBulkActions.coreRows > 0 || serviceBulkActions.allRows > 0) && (
                        <WorkspaceReviewActionCard
                          title="Сервисные требования"
                          subtitle="Результат, SLA, приёмка, режим оказания"
                        >
                          <div className="workspace-action-grid workspace-action-grid--compact">
                            {serviceBulkActions.coreRows > 0 && (
                              <button
                                type="button"
                                onClick={() => onApplyServiceReadinessPatchBulk('core')}
                                className="workspace-action-button is-service-core"
                              >
                                + Добрать сервисное ядро ({serviceBulkActions.coreRows})
                              </button>
                            )}
                            {serviceBulkActions.allRows > 0 && (
                              <button
                                type="button"
                                onClick={() => onApplyServiceReadinessPatchBulk('all')}
                                className="workspace-action-button is-service-full"
                              >
                                Довести сервисный контур ({serviceBulkActions.allRows})
                              </button>
                            )}
                          </div>
                        </WorkspaceReviewActionCard>
                      )}
                    </div>
                  </div>
                </details>
              )}

              <WorkspaceReviewIssueList
                title="Блокеры перед публикацией"
                subtitle="Сначала закройте эти позиции"
                tone="block"
                issues={readinessGate.blockers}
                onAction={onHandleReadinessIssueAction}
              />
              <WorkspaceReviewIssueList
                title="Что ещё проверить"
                subtitle="Эти пункты не блокируют выгрузку, но требуют внимания"
                tone="warn"
                issues={readinessGate.warnings}
                onAction={onHandleReadinessIssueAction}
              />
            </div>
          </div>
        </details>
      )}

      {complianceReport && (
        <details className="workspace-disclosure">
          <summary className="workspace-disclosure-summary">
            <div>
              <strong>Anti-ФАС</strong>
              <span>Критичные, существенные и незначительные замечания</span>
            </div>
            <span className={`workspace-status-badge workspace-status-badge--${complianceReport.critical > 0 ? 'block' : complianceReport.major > 0 || complianceReport.minor > 0 ? 'warn' : 'ready'}`}>
              {complianceReport.score}/{complianceReport.minScore}
            </span>
          </summary>
          <div className="workspace-disclosure-body">
            <div className={`compliance-box ${complianceReport.critical > 0 ? 'is-blocked' : 'is-ok'}`}>
              <div className="compliance-head">
                <strong>
                  Anti-ФАС score: {complianceReport.score}/{complianceReport.minScore}
                </strong>
                <span className={complianceReport.critical > 0 ? 'warn' : 'ok'}>
                  {complianceReport.critical > 0 ? 'Блокирующие нарушения' : complianceReport.major > 0 || complianceReport.minor > 0 ? 'Есть предупреждения' : 'Комплаенс пройден'}
                </span>
              </div>
              <div className="muted">
                Критичных: {complianceReport.critical} · Существенных: {complianceReport.major} · Незначительных: {complianceReport.minor}
              </div>
              {complianceReport.issues.length > 0 && (
                <div className="compliance-list">
                  {complianceReport.issues.slice(0, 8).map((issue, idx) => (
                    <div className="compliance-item" key={`${issue.rowId}-${idx}`}>
                      <span className={`compliance-sev ${issue.severity}`}>{issue.severity}</span>
                      <div className="compliance-copy">
                        <span>Строка #{issue.rowId}, «{issue.specName || 'характеристика'}»: {issue.reason}</span>
                        <span className="muted">Что сделать: {issue.recommendation}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </details>
      )}
    </>
  );
}
