import type { ReactNode } from 'react';
import type { ReadinessIssueLike, ReviewCardTone } from './workspace-panels.types';

type WorkspaceReviewActionCardProps = {
  title: string;
  subtitle: string;
  tone?: ReviewCardTone;
  note?: string;
  children: ReactNode;
};

export function WorkspaceReviewActionCard({
  title,
  subtitle,
  tone = 'neutral',
  note,
  children,
}: WorkspaceReviewActionCardProps) {
  return (
    <div className={`workspace-review-card${tone !== 'neutral' ? ` is-${tone}` : ''}`}>
      <div className="workspace-review-card-head">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
      </div>
      {children}
      {note && <div className="workspace-review-note">{note}</div>}
    </div>
  );
}

type WorkspaceReviewIssueListProps = {
  title: string;
  subtitle: string;
  tone: 'block' | 'warn';
  issues: ReadinessIssueLike[];
  onAction: (issue: ReadinessIssueLike) => void;
};

export function WorkspaceReviewIssueList({
  title,
  subtitle,
  tone,
  issues,
  onAction,
}: WorkspaceReviewIssueListProps) {
  if (issues.length === 0) return null;

  return (
    <WorkspaceReviewActionCard title={title} subtitle={subtitle} tone={tone}>
      <div className="workspace-review-issues">
        {issues.slice(0, 5).map((issue) => (
          <div key={issue.key} className={`workspace-review-issue is-${tone}`}>
            <div className="workspace-review-issue-text">{issue.text}</div>
            {issue.action && (
              <div className="workspace-review-issue-help">
                Что сделать: {issue.action}
              </div>
            )}
            {issue.actionLabel && (
              <button
                type="button"
                onClick={() => onAction(issue)}
                className={`workspace-review-issue-button is-${tone}`}
              >
                {issue.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </WorkspaceReviewActionCard>
  );
}
