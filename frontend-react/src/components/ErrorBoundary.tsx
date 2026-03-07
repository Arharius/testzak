import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] React crashed:', error, errorInfo);
  }

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
            Что-то пошло не так. Попробуйте перезагрузить страницу.
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
            {this.state.error?.message}
          </pre>
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
      );
    }

    return this.props.children;
  }
}
