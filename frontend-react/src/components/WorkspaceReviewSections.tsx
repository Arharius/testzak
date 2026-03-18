import type { ReactNode, RefObject } from 'react';
import type { ComplianceReport } from '../utils/compliance';
import { WorkspaceEvidencePanels } from './WorkspaceEvidencePanels';
import { WorkspacePreviewPanel } from './WorkspacePreviewPanel';
import { WorkspaceReadinessSection } from './WorkspaceReadinessSection';
import type {
  BenchmarkBulkMode,
  BenchmarkRowLike,
  ClassificationBulkMode,
  LegalSummaryRowLike,
  PublicationStatusTone,
  ReadinessGateSummaryLike,
  ReadinessIssueLike,
  ServiceBulkMode,
} from './workspace-panels.types';

export type WorkspaceReviewSectionsProps = {
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
  evidenceRows: LegalSummaryRowLike[];
  evidenceSummaryText: string;
  showBenchmarking: boolean;
  benchmarkSummary: { ok: number; warn: number; block: number };
  benchmarkRows: BenchmarkRowLike[];
  onApplyBenchmarkPatch: (rowId: number, mode: BenchmarkBulkMode) => void;
  readyRowsCount: number;
  previewRef: RefObject<HTMLDivElement | null>;
  previewContent: ReactNode;
};

export function WorkspaceReviewSections(props: WorkspaceReviewSectionsProps) {
  const {
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
    evidenceRows,
    evidenceSummaryText,
    showBenchmarking,
    benchmarkSummary,
    benchmarkRows,
    onApplyBenchmarkPatch,
    readyRowsCount,
    previewRef,
    previewContent,
  } = props;

  return (
    <>
      <WorkspaceReadinessSection
        showPublicationControl={showPublicationControl}
        publicationStatusTone={publicationStatusTone}
        publicationStatusLabel={publicationStatusLabel}
        readinessGate={readinessGate}
        publicationAutopilotActions={publicationAutopilotActions}
        publicationAutopilotRunning={publicationAutopilotRunning}
        rowActionBusy={rowActionBusy}
        readinessAutofixActions={readinessAutofixActions}
        legalBulkActions={legalBulkActions}
        classificationBulkActions={classificationBulkActions}
        benchmarkBulkActions={benchmarkBulkActions}
        serviceBulkActions={serviceBulkActions}
        canUseAiAssist={canUseAiAssist}
        onRunPublicationAutopilot={onRunPublicationAutopilot}
        onApplyReadinessSafeAutofix={onApplyReadinessSafeAutofix}
        onApplyLegalReadinessPatchBulk={onApplyLegalReadinessPatchBulk}
        onRefreshClassificationBulk={onRefreshClassificationBulk}
        onApplyBenchmarkPatchBulk={onApplyBenchmarkPatchBulk}
        onApplyServiceReadinessPatchBulk={onApplyServiceReadinessPatchBulk}
        onHandleReadinessIssueAction={onHandleReadinessIssueAction}
        complianceReport={complianceReport}
        readyRowsCount={readyRowsCount}
      />
      <WorkspaceEvidencePanels
        evidenceRows={evidenceRows}
        evidenceSummaryText={evidenceSummaryText}
        showBenchmarking={showBenchmarking}
        benchmarkSummary={benchmarkSummary}
        benchmarkRows={benchmarkRows}
        onApplyBenchmarkPatch={onApplyBenchmarkPatch}
      />
      <WorkspacePreviewPanel
        readyRowsCount={readyRowsCount}
        readinessStatus={readinessGate.status}
        previewRef={previewRef}
        previewContent={previewContent}
      />
    </>
  );
}
