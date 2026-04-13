import { useState } from 'react';
import type { FullValidationResult, FullTestResult, FullValidateIssue } from '../lib/backendApi';

type Props = {
  result: FullValidationResult;
  onClose: () => void;
  onProceed: () => void;
  onAutoFix: () => void;
  isFixing?: boolean;
};

function statusIcon(status: FullTestResult['status']): string {
  switch (status) {
    case 'pass': return '✅';
    case 'fail': return '❌';
    case 'warn': return '⚠️';
    case 'skip': return '⏭️';
  }
}

function statusLabel(status: FullTestResult['status']): string {
  switch (status) {
    case 'pass': return 'ПРОЙДЕН';
    case 'fail': return 'ОШИБКА';
    case 'warn': return 'ПРЕДУПРЕЖДЕНИЕ';
    case 'skip': return 'ПРОПУЩЕН';
  }
}

function statusColor(status: FullTestResult['status']): string {
  switch (status) {
    case 'pass': return '#16a34a';
    case 'fail': return '#dc2626';
    case 'warn': return '#d97706';
    case 'skip': return '#94a3b8';
  }
}

function IssueRow({ issue, level }: { issue: FullValidateIssue; level: 'error' | 'warn' }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = !!(issue.detail || issue.field);
  return (
    <div
      style={{
        fontSize: 12,
        color: level === 'error' ? '#b91c1c' : '#92400e',
        marginTop: 4,
        lineHeight: 1.4,
        paddingLeft: 12,
        borderLeft: `2px solid ${level === 'error' ? '#f87171' : '#fbbf24'}`,
      }}
    >
      <span style={{ cursor: hasDetail ? 'pointer' : 'default' }} onClick={() => hasDetail && setExpanded(x => !x)}>
        {hasDetail ? (expanded ? '▾ ' : '▸ ') : '└ '}{issue.message}
      </span>
      {expanded && (
        <div style={{ marginTop: 3, opacity: 0.8 }}>
          {issue.field && <div>Поле: <em>{issue.field}</em></div>}
          {issue.detail && (
            <code style={{
              display: 'block', marginTop: 2,
              background: level === 'error' ? '#fee2e2' : '#fef3c7',
              borderRadius: 4, padding: '2px 6px',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              fontSize: 11,
            }}>
              …{issue.detail}…
            </code>
          )}
        </div>
      )}
    </div>
  );
}

function TestRow({ test }: { test: FullTestResult }) {
  const [open, setOpen] = useState(test.status === 'fail');
  const hasIssues = test.errors.length > 0 || test.warnings.length > 0;

  return (
    <div
      style={{
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '26px 1fr auto auto',
          alignItems: 'center',
          gap: 8,
          padding: '7px 16px',
          cursor: hasIssues ? 'pointer' : 'default',
          background: test.status === 'fail' ? 'rgba(239,68,68,0.05)' : 'transparent',
        }}
        onClick={() => hasIssues && setOpen(x => !x)}
      >
        <span style={{ fontSize: 14, textAlign: 'center', lineHeight: 1 }}>{statusIcon(test.status)}</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#e2e8f0' }}>{test.name}</span>
        {hasIssues && (
          <span style={{ fontSize: 10, color: '#94a3b8' }}>
            {test.errors.length > 0 && `${test.errors.length} ош.`}
            {test.errors.length > 0 && test.warnings.length > 0 && ', '}
            {test.warnings.length > 0 && `${test.warnings.length} пред.`}
          </span>
        )}
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: statusColor(test.status),
            minWidth: 80,
            textAlign: 'right',
          }}
        >
          {statusLabel(test.status)}
          {hasIssues && <span style={{ marginLeft: 4, color: '#64748b' }}>{open ? '▲' : '▼'}</span>}
        </span>
      </div>

      {open && hasIssues && (
        <div style={{ padding: '4px 16px 10px 52px' }}>
          {test.errors.map((e, i) => <IssueRow key={i} issue={e} level="error" />)}
          {test.warnings.map((w, i) => <IssueRow key={i} issue={w} level="warn" />)}
        </div>
      )}
    </div>
  );
}

export function FullValidationPanel({ result, onClose, onProceed, onAutoFix, isFixing }: Props) {
  const hasErrors = result.error_count > 0;
  const totalTests = result.tests.filter(t => t.status !== 'skip').length;
  const passed = result.tests.filter(t => t.status === 'pass').length;
  const skipped = result.tests.filter(t => t.status === 'skip').length;

  const headerBg = hasErrors
    ? 'linear-gradient(135deg, rgba(127,29,29,0.9), rgba(153,27,27,0.85))'
    : result.warning_count > 0
      ? 'linear-gradient(135deg, rgba(120,53,15,0.9), rgba(146,64,14,0.85))'
      : 'linear-gradient(135deg, rgba(5,46,22,0.9), rgba(20,83,45,0.85))';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'rgba(15,23,42,0.98)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 14,
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          maxWidth: 660,
          width: '100%',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ── */}
        <div style={{ background: headerBg, padding: '18px 20px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>
                {hasErrors ? '🚫 ТЗ содержит ошибки — публикация в ЕИС заблокирована' :
                  result.warning_count > 0 ? '⚠️ ТЗ готово с предупреждениями' :
                    '✅ ТЗ готово к публикации в ЕИС'}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(241,245,249,0.7)' }}>
                ПРОВЕРКА ТЗ ПЕРЕД ПУБЛИКАЦИЕЙ · 44-ФЗ / 223-ФЗ / ПП №1875
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.1)', border: 'none',
                borderRadius: 6, color: '#94a3b8', fontSize: 16,
                cursor: 'pointer', lineHeight: 1, padding: '4px 8px',
                flexShrink: 0,
              }}
            >×</button>
          </div>

          {/* Summary bar */}
          <div style={{ display: 'flex', gap: 20, marginTop: 14 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9' }}>{passed}/{totalTests}</div>
              <div style={{ fontSize: 10, color: 'rgba(241,245,249,0.6)', letterSpacing: '0.05em' }}>ПРОЙДЕНО</div>
            </div>
            {result.error_count > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#f87171' }}>{result.error_count}</div>
                <div style={{ fontSize: 10, color: 'rgba(248,113,113,0.7)', letterSpacing: '0.05em' }}>ОШИБОК</div>
              </div>
            )}
            {result.warning_count > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#fbbf24' }}>{result.warning_count}</div>
                <div style={{ fontSize: 10, color: 'rgba(251,191,36,0.7)', letterSpacing: '0.05em' }}>ПРЕДУПРЕЖДЕНИЙ</div>
              </div>
            )}
            {skipped > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#64748b' }}>{skipped}</div>
                <div style={{ fontSize: 10, color: 'rgba(100,116,139,0.7)', letterSpacing: '0.05em' }}>ПРОПУЩЕНО</div>
              </div>
            )}
          </div>
        </div>

        {/* ── Tests list ── */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {result.tests.map(test => <TestRow key={test.id} test={test} />)}
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            display: 'flex', gap: 10, flexWrap: 'wrap',
            background: 'rgba(255,255,255,0.02)',
            flexShrink: 0,
          }}
        >
          {hasErrors && (
            <button
              onClick={onAutoFix}
              disabled={isFixing}
              style={{
                flex: 1, minWidth: 160, padding: '9px 16px',
                borderRadius: 8, border: 'none',
                background: isFixing ? 'rgba(59,130,246,0.3)' : '#3b82f6',
                color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: isFixing ? 'not-allowed' : 'pointer',
              }}
            >
              {isFixing ? '⏳ Исправляется...' : '🔧 Исправить автоматически'}
            </button>
          )}
          {!hasErrors && (
            <button
              onClick={() => { onClose(); onProceed(); }}
              style={{
                flex: 1, minWidth: 160, padding: '9px 16px',
                borderRadius: 8, border: 'none',
                background: '#16a34a', color: '#fff',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              📥 Скачать DOCX
            </button>
          )}
          {hasErrors && (
            <button
              onClick={() => { onClose(); onProceed(); }}
              style={{
                padding: '9px 16px', borderRadius: 8,
                border: '1px solid rgba(239,68,68,0.3)',
                background: 'rgba(239,68,68,0.08)',
                color: '#f87171', fontSize: 12, cursor: 'pointer',
              }}
            >
              ⚠️ Скачать всё равно
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '9px 16px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'transparent',
              color: '#94a3b8', fontSize: 12, cursor: 'pointer',
            }}
          >
            Закрыть
          </button>
        </div>

        {/* Warning banner for force-download */}
        {hasErrors && (
          <div style={{
            padding: '8px 20px', background: 'rgba(239,68,68,0.1)',
            borderTop: '1px solid rgba(239,68,68,0.2)',
            fontSize: 11, color: '#fca5a5', textAlign: 'center',
          }}>
            ⚠️ ВНИМАНИЕ: Найдены ошибки. ТЗ может быть отклонено ФАС или ЕИС при публикации.
          </div>
        )}
      </div>
    </div>
  );
}
