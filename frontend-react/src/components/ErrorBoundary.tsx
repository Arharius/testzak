import { Component, type ErrorInfo, type ReactNode } from 'react';
import { appendAutomationLog, appendImmutableAudit } from '../lib/storage';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  reportId: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, reportId: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, reportId: `crash-${Date.now().toString(36)}` };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] React crashed:', error, errorInfo);
    const report = {
      id: this.state.reportId || `crash-${Date.now().toString(36)}`,
      at: new Date().toISOString(),
      message: error.message,
      stack: error.stack || '',
      componentStack: errorInfo.componentStack || '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      path: typeof window !== 'undefined' ? window.location.pathname : '',
    };
    try {
      window.localStorage.setItem('tz_last_crash_report_v1', JSON.stringify(report));
    } catch {
      // ignore storage failures
    }
    appendAutomationLog({
      at: report.at,
      event: 'frontend.crash',
      ok: false,
      note: `${report.id}: ${report.message}`.slice(0, 220),
    });
    appendImmutableAudit('frontend.crash', {
      id: report.id,
      message: report.message,
      path: report.path,
    });
  }

  private handleCopyReport = async () => {
    try {
      const raw = window.localStorage.getItem('tz_last_crash_report_v1') || JSON.stringify({
        id: this.state.reportId,
        message: this.state.error?.message || 'unknown',
      }, null, 2);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(raw);
      }
    } catch {
      // ignore clipboard failures
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 40,
          textAlign: 'center',
          color: '#f5f0e8',
          background: '#12100e',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          fontFamily: 'Inter, -apple-system, sans-serif',
        }}>
          <div style={{ fontSize: 48 }}>:(</div>
          <h2 style={{ margin: 0, fontSize: 22, color: '#e8a948' }}>
            Произошла ошибка
          </h2>
          <p style={{ margin: 0, color: '#9a8e7d', maxWidth: 500, lineHeight: 1.5 }}>
            Что-то пошло не так. Отчёт о падении сохранён локально, его можно скопировать для диагностики.
          </p>
          <pre style={{
            margin: 0,
            padding: '12px 20px',
            background: '#1a1613',
            borderRadius: 8,
            fontSize: 12,
            color: '#e87161',
            maxWidth: 600,
            overflow: 'auto',
            textAlign: 'left',
          }}>
            [{this.state.reportId}] {this.state.error?.message}
          </pre>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={() => void this.handleCopyReport()}
              style={{
                marginTop: 12,
                padding: '10px 28px',
                background: '#1a1613',
                color: '#f5f0e8',
                border: '1px solid rgba(232, 169, 72, 0.32)',
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Скопировать отчёт
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: 12,
                padding: '10px 28px',
                background: '#e8a948',
                color: '#12100e',
                border: 'none',
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Перезагрузить
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
