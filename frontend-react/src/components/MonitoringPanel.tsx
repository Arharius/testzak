import { useState } from 'react';
import { fetchBackendMetrics, type IntegrationMetrics } from '../lib/api';
import type { AutomationSettings } from '../types/schemas';

type Props = {
  automationSettings: AutomationSettings;
};

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.trunc(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}ч ${m}м ${sec}с`;
}

export function MonitoringPanel({ automationSettings }: Props) {
  const [metrics, setMetrics] = useState<IntegrationMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await fetchBackendMetrics(automationSettings);
      setMetrics(data);
      setUpdatedAt(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel">
      <h2>Мониторинг SLA и интеграций</h2>
      <p className="muted">Контроль очереди, dead-letter и доставки в реальном времени.</p>
      <div className="actions">
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Обновляю...' : 'Обновить метрики'}
        </button>
      </div>
      {!metrics ? (
        <div className="muted">Метрики не загружены. Нажмите «Обновить метрики».</div>
      ) : (
        <div className="rows-table-wrap">
          <table className="rows-table">
            <tbody>
              <tr><th>Состояние контура</th><td>{metrics.status}</td></tr>
              <tr><th>В очереди</th><td>{metrics.queue_total}</td></tr>
              <tr><th>В истории</th><td>{metrics.history_total}</td></tr>
              <tr><th>Dead-letter</th><td>{metrics.dead_letter_total}</td></tr>
              <tr><th>Старейший queued</th><td>{formatDuration(metrics.oldest_queued_seconds)}</td></tr>
              <tr><th>Flush 24ч (sent/queued/dead)</th><td>{metrics.flush_24h.sent} / {metrics.flush_24h.queued} / {metrics.flush_24h.dead_letter}</td></tr>
              <tr><th>Webhook target</th><td>{metrics.target_webhook_configured ? 'configured' : 'not configured'}</td></tr>
              <tr><th>Auth token на backend</th><td>{metrics.integration_auth_enabled ? 'enabled' : 'disabled'}</td></tr>
              <tr><th>Max attempts</th><td>{metrics.integration_max_attempts}</td></tr>
              <tr><th>Обновлено</th><td>{updatedAt || '-'}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

