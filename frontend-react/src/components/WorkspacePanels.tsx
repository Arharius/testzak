import { useState, useCallback } from 'react';
import type { TZDocumentSummary } from '../lib/backendApi';
import type { PublicationStatusTone, ReadinessGateSummaryLike } from './workspace-panels.types';
import { QaAuditBlock } from './QaAuditBlock';
import { EISCard } from './EISCard';
import { NMCKCalculator } from './NMCKCalculator';
import { FASChecker } from './FASChecker';

export interface ToolPosition {
  name: string;
  unit: string;
  quantity: number;
  okpd2?: string;
  characteristics?: Array<{ name: string; value: string }>;
}

type WorkspaceSidePanelsProps = {
  publicationStatusTone: PublicationStatusTone;
  publicationStatusLabel: string;
  publicationLeadText: string;
  readinessGate: ReadinessGateSummaryLike;
  readyRowsCount: number;
  loggedIn: boolean;
  historyOpen: boolean;
  historyLoading: boolean;
  historyItems: TZDocumentSummary[];
  currentDocId: string | null;
  docxReady: boolean;
  exportReadinessTitle: string;
  exportsBlockedByReadiness: boolean;
  buildTzText: () => string;
  qaAutoRunKey?: number;
  toolPositions?: ToolPosition[];
  onExportPackage: () => void;
  onExportDocx: () => void;
  onExportPdf: () => void;
  onSaveTZ: () => void;
  onToggleHistory: () => void;
  onCloseHistory: () => void;
  onLoadHistoryItem: (docId: string) => void;
  onDeleteHistoryItem: (docId: string) => void;
};

export function WorkspaceSidePanels({
  publicationStatusTone: _publicationStatusTone,
  publicationStatusLabel: _publicationStatusLabel,
  publicationLeadText: _publicationLeadText,
  readinessGate,
  readyRowsCount,
  loggedIn,
  historyOpen,
  historyLoading,
  historyItems,
  currentDocId,
  docxReady,
  exportReadinessTitle,
  exportsBlockedByReadiness,
  buildTzText,
  qaAutoRunKey,
  toolPositions = [],
  onExportPackage: _onExportPackage,
  onExportDocx,
  onExportPdf,
  onSaveTZ,
  onToggleHistory,
  onCloseHistory,
  onLoadHistoryItem,
  onDeleteHistoryItem,
}: WorkspaceSidePanelsProps) {
  const [totalNmck, setTotalNmck] = useState<number>(0);
  const handleNmckTotal = useCallback((total: number) => setTotalNmck(total), []);

  return (
    <>
      <div className="workspace-side-card">
        <div className="workspace-side-head">
          <div>
            <div className="micro-label">Step 3</div>
            <strong>Экспорт и история</strong>
          </div>
          <span className="workspace-side-meta">{readyRowsCount > 0 ? `${readyRowsCount} готово` : 'нет готовых позиций'}</span>
        </div>
        {docxReady && (
          <QaAuditBlock buildText={buildTzText} autoRunKey={qaAutoRunKey} />
        )}
        <div className="workspace-action-grid workspace-action-grid--compact" style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={onExportDocx}
            disabled={!docxReady}
            title={exportReadinessTitle}
            className={docxReady ? 'workspace-action-button is-docx' : 'workspace-action-button'}
          >
            📄 Скачать DOCX
          </button>
          <button
            type="button"
            onClick={onExportPdf}
            disabled={!docxReady}
            title={exportReadinessTitle}
          >
            🖨️ Скачать PDF
          </button>
          {loggedIn && (
            <>
              <button
                type="button"
                onClick={onSaveTZ}
                disabled={!docxReady}
                className={docxReady ? 'workspace-action-button is-save' : 'workspace-action-button'}
              >
                💾 Сохранить ТЗ
              </button>
              <button
                type="button"
                onClick={onToggleHistory}
                className={`workspace-action-button ${historyOpen ? 'is-history-open' : 'is-history-closed'}`}
              >
                📋 Мои ТЗ{historyItems.length > 0 ? ` (${historyItems.length})` : ''}
              </button>
            </>
          )}
        </div>
        <div className={`workspace-export-note ${exportsBlockedByReadiness ? 'is-block' : readinessGate.status === 'warn' ? 'is-warn' : 'is-ready'}`}>
          {exportReadinessTitle}
        </div>
        {loggedIn && historyOpen && (
          <div className="workspace-history-panel">
            <div className="workspace-side-head workspace-side-head--history">
              <div>
                <div className="micro-label">History</div>
                <strong>Сохранённые ТЗ</strong>
              </div>
              <button type="button" onClick={onCloseHistory} className="row-detail-toggle">Скрыть</button>
            </div>
            {historyLoading ? (
              <div className="workspace-side-note workspace-side-note--flush">⏳ Загрузка...</div>
            ) : historyItems.length === 0 ? (
              <div className="workspace-side-note workspace-side-note--flush">Нет сохранённых ТЗ</div>
            ) : (
              <div className="workspace-history-scroll">
                {historyItems.map((item) => (
                  <div
                    key={item.id}
                    className={`workspace-history-item ${currentDocId === item.id ? 'is-active' : ''}`}
                  >
                    <div className="workspace-history-copy">
                      <div className="workspace-history-title">
                        {item.title || 'Без названия'}
                      </div>
                      <div className="workspace-history-meta">
                        {item.rows_count} поз. · {item.law_mode}-ФЗ · Score: {item.compliance_score ?? '—'}
                        {typeof item.readiness_blockers === 'number' ? ` · Blockers: ${item.readiness_blockers}` : ''}
                        {item.created_at && ` · ${new Date(item.created_at).toLocaleDateString('ru-RU')}`}
                      </div>
                    </div>
                    <div className="workspace-history-actions">
                      <button type="button" onClick={() => onLoadHistoryItem(item.id)} className="workspace-history-btn is-load">Загрузить</button>
                      <button type="button" onClick={() => onDeleteHistoryItem(item.id)} className="workspace-history-btn is-delete">Удалить</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {docxReady && toolPositions.length > 0 && (
          <EISCard positions={toolPositions} nmck={totalNmck > 0 ? totalNmck : null} />
        )}
      </div>

      {docxReady && toolPositions.length > 0 && (
        <>
          <div className="workspace-side-card">
            <div className="workspace-side-head">
              <div>
                <div className="micro-label">НМЦК</div>
                <strong>Калькулятор начальной цены</strong>
              </div>
            </div>
            <NMCKCalculator positions={toolPositions} onNmckTotal={handleNmckTotal} />
          </div>

          <div className="workspace-side-card">
            <div className="workspace-side-head">
              <div>
                <div className="micro-label">ФАС</div>
                <strong>Проверка рисков</strong>
              </div>
            </div>
            <FASChecker positions={toolPositions} />
          </div>
        </>
      )}
    </>
  );
}

export { WorkspaceReviewSections } from './WorkspaceReviewSections';
