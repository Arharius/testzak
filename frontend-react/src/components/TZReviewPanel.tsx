import { useState } from 'react';
import type { TZReviewIssue, TZReviewResponse } from '../lib/backendApi';
import { reviewTz } from '../lib/backendApi';

type TZReviewPanelProps = {
  tzText: string;
  lawMode: string;
  onApplyFixes: (fixes: TZReviewIssue[]) => void;
  onClose: () => void;
};

const LEVEL_CONFIG = {
  blocking: {
    label: 'Блокирующие',
    emoji: '🚫',
    className: 'tz-review-level--blocking',
    description: 'ФАС-риски, жалобы',
  },
  legal: {
    label: 'Юридические',
    emoji: '⚖️',
    className: 'tz-review-level--legal',
    description: 'Правовые неточности',
  },
  technical: {
    label: 'Технические',
    emoji: '🔧',
    className: 'tz-review-level--technical',
    description: 'Логические ошибки',
  },
} as const;

export function TZReviewPanel({ tzText, lawMode, onApplyFixes, onClose }: TZReviewPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TZReviewResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const runReview = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await reviewTz(tzText, lawMode);
      setResult(response);
      const autoSafeIds = new Set(
        response.issues.filter(i => i.autoSafe).map(i => i.id)
      );
      setSelectedIds(autoSafeIds);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка AI-рецензии');
    } finally {
      setLoading(false);
    }
  };

  const toggleIssue = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (!result) return;
    setSelectedIds(new Set(result.issues.map(i => i.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const applySelected = () => {
    if (!result) return;
    const fixes = result.issues.filter(i => selectedIds.has(i.id));
    onApplyFixes(fixes);
  };

  const groupedIssues = result ? (['blocking', 'legal', 'technical'] as const).map(level => ({
    level,
    config: LEVEL_CONFIG[level],
    issues: result.issues.filter(i => i.level === level),
  })).filter(g => g.issues.length > 0) : [];

  return (
    <div className="tz-review-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tz-review-panel">
        <div className="tz-review-header">
          <h2>Проверка и исправление ТЗ</h2>
          <span className="tz-review-law-badge">
            {lawMode === '44' ? '44-ФЗ' : '223-ФЗ'}
          </span>
          <button type="button" className="tz-review-close" onClick={onClose}>✕</button>
        </div>

        {!result && !loading && (
          <div className="tz-review-intro">
            <p>
              AI-эксперт проверит текст вашего ТЗ ({Math.round(tzText.length / 1000)}K символов) на:
            </p>
            <ul>
              <li><strong>Блокирующие</strong> — ФАС-риски: бренды, единственный поставщик, коды в описании</li>
              <li><strong>Юридические</strong> — неточности по {lawMode === '44' ? '44-ФЗ' : '223-ФЗ'}: лишние сертификаты, некорректные ссылки</li>
              <li><strong>Технические</strong> — логические ошибки: противоречия, нереальные параметры</li>
            </ul>
            <button
              type="button"
              className="tz-review-start-btn"
              onClick={() => { void runReview(); }}
            >
              Запустить проверку
            </button>
          </div>
        )}

        {loading && (
          <div className="tz-review-loading">
            <div className="tz-review-spinner" />
            <p>AI-эксперт анализирует ТЗ…</p>
            <p className="tz-review-loading-sub">Обычно занимает 15-30 секунд</p>
          </div>
        )}

        {error && (
          <div className="tz-review-error">
            <p>{error}</p>
            <button type="button" onClick={() => { void runReview(); }}>Повторить</button>
          </div>
        )}

        {result && (
          <div className="tz-review-results">
            <div className="tz-review-summary">
              <span>{result.summary}</span>
              {result.issues.length > 0 && (
                <div className="tz-review-summary-actions">
                  <button type="button" onClick={selectAll}>Выбрать все</button>
                  <button type="button" onClick={deselectAll}>Снять все</button>
                </div>
              )}
            </div>

            {result.issues.length === 0 && (
              <div className="tz-review-empty">
                ✅ Замечаний не найдено. ТЗ выглядит юридически корректным.
              </div>
            )}

            {groupedIssues.map(group => (
              <div key={group.level} className="tz-review-group">
                <div className={`tz-review-group-header ${group.config.className}`}>
                  <span>{group.config.emoji} {group.config.label}</span>
                  <span className="tz-review-group-count">{group.issues.length}</span>
                  <span className="tz-review-group-desc">{group.config.description}</span>
                </div>
                {group.issues.map(issue => (
                  <div
                    key={issue.id}
                    className={`tz-review-issue ${selectedIds.has(issue.id) ? 'is-selected' : ''}`}
                  >
                    <label className="tz-review-issue-header">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(issue.id)}
                        onChange={() => toggleIssue(issue.id)}
                      />
                      <strong>{issue.title}</strong>
                      {issue.autoSafe && <span className="tz-review-auto-badge">авто</span>}
                    </label>
                    <div className="tz-review-issue-body">
                      <div className="tz-review-diff">
                        <div className="tz-review-diff-old">
                          <span className="tz-review-diff-label">Сейчас:</span>
                          <span>{issue.originalText}</span>
                        </div>
                        <div className="tz-review-diff-arrow">→</div>
                        <div className="tz-review-diff-new">
                          <span className="tz-review-diff-label">Исправление:</span>
                          <span>{issue.suggestedText}</span>
                        </div>
                      </div>
                      <div className="tz-review-explanation">
                        {issue.problemExplanation}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}

            {result.issues.length > 0 && (
              <div className="tz-review-actions">
                <button
                  type="button"
                  className="tz-review-apply-btn"
                  disabled={selectedIds.size === 0}
                  onClick={applySelected}
                >
                  Применить выбранные ({selectedIds.size})
                </button>
                <button type="button" className="tz-review-cancel-btn" onClick={onClose}>
                  Закрыть
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
