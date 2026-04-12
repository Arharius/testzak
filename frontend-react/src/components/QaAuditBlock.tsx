import { useState, useCallback } from 'react';
import type { QACheckResponse, QAAutofixResponse, QAIssue } from '../lib/backendApi';
import { qaCheck, qaAutofix } from '../lib/backendApi';

type QaAuditBlockProps = {
  buildText: () => string;
  onTextFixed?: (fixedText: string) => void;
};

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 48,
        height: 48,
        borderRadius: '50%',
        border: `3px solid ${color}`,
        color,
        fontWeight: 700,
        fontSize: 14,
        flexShrink: 0,
      }}
    >
      {score}
    </span>
  );
}

function IssueRow({ issue }: { issue: QAIssue }) {
  const isError = issue.level === 'error';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '6px 0',
        borderBottom: '1px solid #f1f5f9',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span style={{ color: isError ? '#ef4444' : '#f59e0b', fontWeight: 700, flexShrink: 0 }}>
          {isError ? '✗' : '△'}
        </span>
        <span style={{ fontSize: 13, color: '#1e293b', lineHeight: 1.4 }}>{issue.message}</span>
      </div>
      <div style={{ paddingLeft: 18, fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>
        → {issue.suggestion}
      </div>
    </div>
  );
}

function AutofixResult({ result }: { result: QAAutofixResponse }) {
  return (
    <div style={{ marginTop: 10, fontSize: 12 }}>
      {result.auto_fixed.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 600, color: '#166534', marginBottom: 4 }}>Исправлено автоматически:</div>
          {result.auto_fixed.map((item, i) => (
            <div key={i} style={{ color: '#15803d', paddingLeft: 8, lineHeight: 1.5 }}>✓ {item}</div>
          ))}
        </div>
      )}
      {result.manual_required.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, color: '#991b1b', marginBottom: 4 }}>Требует ручной правки:</div>
          {result.manual_required.map((item, i) => (
            <div key={i} style={{ color: '#b91c1c', paddingLeft: 8, lineHeight: 1.5 }}>✗ {item}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export function QaAuditBlock({ buildText, onTextFixed }: QaAuditBlockProps) {
  const [loading, setLoading] = useState(false);
  const [autofixLoading, setAutofixLoading] = useState(false);
  const [result, setResult] = useState<QACheckResponse | null>(null);
  const [autofixResult, setAutofixResult] = useState<QAAutofixResponse | null>(null);
  const [autofixApplied, setAutofixApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentText, setCurrentText] = useState('');

  const runCheck = useCallback(async (text?: string) => {
    const tzText = text ?? buildText();
    if (!tzText.trim()) {
      setError('Нет данных для проверки. Сначала сгенерируйте ТЗ.');
      return;
    }
    setCurrentText(tzText);
    setLoading(true);
    setError(null);
    setAutofixResult(null);
    setAutofixApplied(false);
    try {
      const res = await qaCheck(tzText);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка проверки');
    } finally {
      setLoading(false);
    }
  }, [buildText]);

  const runAutofix = useCallback(async () => {
    if (!currentText.trim()) return;
    setAutofixLoading(true);
    setError(null);
    try {
      const res = await qaAutofix(currentText);
      setAutofixResult(res);
      setResult(res.qa);
      setCurrentText(res.fixed_text);
      setAutofixApplied(true);
      onTextFixed?.(res.fixed_text);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка автоисправления');
    } finally {
      setAutofixLoading(false);
    }
  }, [currentText, onTextFixed]);

  const passed = result?.passed ?? false;
  const score = result?.score ?? 0;
  const borderColor = result == null ? '#e2e8f0' : passed ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';
  const errors = result?.issues.filter((i) => i.level === 'error') ?? [];
  const warnings = result?.issues.filter((i) => i.level === 'warning') ?? [];
  const hasIssues = errors.length > 0 || warnings.length > 0;

  return (
    <div
      style={{
        border: `1.5px solid ${borderColor}`,
        borderRadius: 10,
        padding: '12px 14px',
        marginTop: 12,
        background: '#fff',
        transition: 'border-color 0.3s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>QA-аудит документа</span>
          {result != null && <ScoreRing score={score} />}
        </div>
        <button
          type="button"
          onClick={() => { void runCheck(); }}
          disabled={loading}
          style={{
            fontSize: 12,
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid #cbd5e1',
            background: loading ? '#f1f5f9' : '#f8fafc',
            cursor: loading ? 'not-allowed' : 'pointer',
            color: '#475569',
            fontWeight: 500,
          }}
        >
          {loading ? '⏳ Проверяю...' : result == null ? 'Запустить проверку' : '↺ Перепроверить'}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: '#b91c1c', padding: '4px 0' }}>{error}</div>
      )}

      {result != null && (
        <>
          {passed ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
              <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 16 }}>✓</span>
              <span style={{ fontSize: 13, color: '#15803d', fontWeight: 500 }}>
                Документ соответствует требованиям · Оценка: {score}/100
              </span>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#92400e', fontWeight: 500, marginBottom: 6 }}>
              ⚠ Найдено замечаний: {result.issues.length} · Оценка: {score}/100
            </div>
          )}

          {hasIssues && (
            <div style={{ marginBottom: 10 }}>
              {errors.map((issue, i) => <IssueRow key={`e${i}`} issue={issue} />)}
              {warnings.map((issue, i) => <IssueRow key={`w${i}`} issue={issue} />)}
            </div>
          )}

          {autofixResult && <AutofixResult result={autofixResult} />}

          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {hasIssues && !passed && (
              <button
                type="button"
                onClick={() => { void runAutofix(); }}
                disabled={autofixLoading || autofixApplied}
                style={{
                  fontSize: 12,
                  padding: '5px 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: autofixApplied ? '#d1fae5' : autofixLoading ? '#e2e8f0' : '#3b82f6',
                  color: autofixApplied ? '#065f46' : autofixLoading ? '#64748b' : '#fff',
                  cursor: (autofixLoading || autofixApplied) ? 'not-allowed' : 'pointer',
                  fontWeight: 500,
                }}
              >
                {autofixLoading ? '⏳ Исправляю...' : autofixApplied ? 'Исправлено ✓' : '⚡ Исправить автоматически'}
              </button>
            )}
          </div>
        </>
      )}

      {result == null && !loading && !error && (
        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
          Автоматическая проверка: бренды без «или эквивалент», точечные значения,
          emoji, заглушки, гарантия, страна происхождения.
        </div>
      )}
    </div>
  );
}
