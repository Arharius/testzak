import type { ReactNode, RefObject } from 'react';

type WorkspacePreviewPanelProps = {
  readyRowsCount: number;
  readinessStatus: 'ready' | 'warn' | 'block';
  previewRef: RefObject<HTMLDivElement | null>;
  previewContent: ReactNode;
};

export function WorkspacePreviewPanel({
  readyRowsCount,
  readinessStatus,
  previewRef,
  previewContent,
}: WorkspacePreviewPanelProps) {
  if (readyRowsCount <= 0) return null;

  return (
    <details className="workspace-disclosure workspace-preview-shell" {...(readinessStatus !== 'block' ? { open: true } : {})}>
      <summary className="workspace-disclosure-summary">
        <div>
          <strong>Предпросмотр ТЗ</strong>
          <span>Полный документ перед выгрузкой и сохранением</span>
        </div>
        <span className="workspace-side-meta">{readyRowsCount} поз.</span>
      </summary>
      <div className="workspace-disclosure-body">
        <div ref={previewRef}>{previewContent}</div>
      </div>
    </details>
  );
}
