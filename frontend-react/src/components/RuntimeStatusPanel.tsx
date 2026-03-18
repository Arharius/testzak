import type { BackendHealth, BackendReadiness } from '../lib/backendApi';

type Props = {
  backendAvailable: boolean;
  health?: BackendHealth;
  readiness?: BackendReadiness;
  isLoading: boolean;
  error?: string;
};

type RuntimeTone = 'ok' | 'degraded' | 'error' | 'neutral';

function getTone(status?: string): RuntimeTone {
  if (status === 'ready' || status === 'ok') return 'ok';
  if (status === 'not_ready' || status === 'error') return 'error';
  if (status === 'degraded') return 'degraded';
  return 'neutral';
}

function runtimeTitle(backendAvailable: boolean, readiness?: BackendReadiness, error?: string): string {
  if (!backendAvailable) return 'Работа без backend';
  if (error) return 'Backend недоступен';
  if (!readiness) return 'Проверка runtime';
  if (readiness.status === 'ready') return 'Все основные подсистемы готовы';
  if (readiness.status === 'degraded') return 'Основные функции доступны';
  return 'Контур не готов';
}

function runtimeDescription(backendAvailable: boolean, readiness?: BackendReadiness, error?: string): string {
  if (!backendAvailable) {
    return 'Приложение запущено локально. Генерация и экспорт ТЗ работают, а серверные функции и интеграции сейчас не используются.';
  }
  if (error) {
    return `Не удалось получить runtime-диагностику: ${error}`;
  }
  if (!readiness) {
    return 'Проверяю базу данных, очередь интеграций, AI-провайдеров, платежи и enterprise-контур.';
  }
  if (readiness.status === 'ready') {
    return 'Критичные подсистемы доступны. Генерация, импорт, проверка и выгрузка работают без ограничений.';
  }
  if (readiness.status === 'degraded') {
    return 'Основной сценарий работает: можно генерировать, проверять и выгружать ТЗ. Не настроены только дополнительные серверные функции, например интеграции, почта, платежи или расширенная диагностика.';
  }
  return 'Найден критичный сбой. Использование production-контура рискованно до устранения причины.';
}

function checkLabel(key: string): string {
  switch (key) {
    case 'database':
      return 'База данных';
    case 'integration_store':
      return 'Очередь интеграций';
    case 'security':
      return 'Security';
    case 'email':
      return 'Email';
    case 'ai':
      return 'AI backend';
    case 'search':
      return 'Search';
    case 'payments':
      return 'Payments';
    case 'enterprise':
      return 'Enterprise';
    default:
      return key;
  }
}

export function RuntimeStatusPanel({ backendAvailable, health, readiness, isLoading, error }: Props) {
  const tone = getTone(readiness?.status);
  const enabledAi = Object.entries(health?.ai_providers || {}).filter(([, enabled]) => enabled).map(([name]) => name);
  const orderedChecks = readiness
    ? Object.entries(readiness.checks)
    : [];

  return (
    <section className="runtime-panel section-fade section-delay-1">
      <div className="runtime-panel-copy">
        <div className="micro-label">Runtime</div>
        <h2>{runtimeTitle(backendAvailable, readiness, error)}</h2>
        <p>{runtimeDescription(backendAvailable, readiness, error)}</p>
        <div className="runtime-summary-line">
          <span className={`runtime-state runtime-state--${tone}`}>{backendAvailable ? (readiness?.status || 'checking') : 'local'}</span>
          <span>version {health?.version || readiness?.version || 'n/a'}</span>
          <span>{isLoading ? 'refreshing…' : `checked ${readiness?.checked_at || health?.checked_at || 'n/a'}`}</span>
        </div>
      </div>

      <div className="runtime-grid">
        <article className="runtime-card">
          <div className="runtime-card-head">
            <span className="runtime-card-title">Ядро</span>
            <span className={`runtime-chip runtime-chip--${getTone(readiness?.checks?.database?.status)}`}>{readiness?.checks?.database?.status || 'n/a'}</span>
          </div>
          <strong>{readiness?.checks?.database?.detail || 'database probe pending'}</strong>
          <small>Queue {readiness?.queue_total ?? health?.integration_queue ?? 0} · History {readiness?.history_total ?? health?.integration_history ?? 0}</small>
        </article>

        <article className="runtime-card">
          <div className="runtime-card-head">
            <span className="runtime-card-title">Поиск и ИИ</span>
            <span className={`runtime-chip runtime-chip--${getTone(readiness?.checks?.ai?.status || readiness?.checks?.search?.status)}`}>{enabledAi.length ? enabledAi.join(', ') : 'no-ai'}</span>
          </div>
          <strong>{readiness?.checks?.search?.detail || health?.search_module || 'search pending'}</strong>
          <small>{enabledAi.length ? `Server AI: ${enabledAi.join(', ')}` : 'Server AI providers are not configured'}</small>
        </article>

        <article className="runtime-card">
          <div className="runtime-card-head">
            <span className="runtime-card-title">Подписка</span>
            <span className={`runtime-chip runtime-chip--${getTone(readiness?.checks?.payments?.status)}`}>{health?.yookassa ? 'billing on' : 'billing off'}</span>
          </div>
          <strong>{readiness?.checks?.payments?.detail || 'payments pending'}</strong>
          <small>Post-trial limit {health?.free_tz_limit ?? readiness?.free_tz_limit ?? 0} ТЗ · Email {readiness?.checks?.email?.status || 'n/a'}</small>
        </article>

        <article className="runtime-card">
          <div className="runtime-card-head">
            <span className="runtime-card-title">Enterprise</span>
            <span className={`runtime-chip runtime-chip--${getTone(readiness?.checks?.enterprise?.status)}`}>{readiness?.enterprise_status_total ?? health?.integration_enterprise_status ?? 0} logs</span>
          </div>
          <strong>{readiness?.checks?.enterprise?.detail || 'enterprise pending'}</strong>
          <small>{health?.integration_target_webhook_configured ? 'Live target configured' : 'Live target not configured'}</small>
        </article>
      </div>

      {orderedChecks.length > 0 && (
        <div className="runtime-checks" aria-label="Подсистемы runtime">
          {orderedChecks.map(([key, value]) => (
            <span key={key} className={`runtime-check runtime-check--${getTone(value.status)}`}>
              <strong>{checkLabel(key)}</strong>
              <em>{value.detail}</em>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
