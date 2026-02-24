import { useMemo, useState } from 'react';
import { fetchTenantKpi, type TenantKpi } from '../lib/api';
import { getAutomationLog } from '../lib/storage';
import type { AutomationSettings } from '../types/schemas';

type Props = {
  automationSettings: AutomationSettings;
};

function money(cents: number, currency: string): string {
  return `${(Math.max(0, cents) / 100).toFixed(2)} ${currency || 'RUB'}`;
}

export function CommercialKpiPanel({ automationSettings }: Props) {
  const [remoteKpi, setRemoteKpi] = useState<TenantKpi | null>(null);
  const [loading, setLoading] = useState(false);

  const local = useMemo(() => {
    const events = getAutomationLog();
    const generated = events.filter((x) => x.event === 'react.generate' && x.ok).length;
    const usage = events.filter((x) => x.event.startsWith('billing.usage') && x.ok).length;
    const billDocs = Math.max(generated, usage);
    const revenue = billDocs * (automationSettings.billingPricePerDocCents || 0);
    return { generated, usage, billDocs, revenue };
  }, [automationSettings.billingPricePerDocCents]);

  const refreshRemote = async () => {
    setLoading(true);
    try {
      const data = await fetchTenantKpi(automationSettings);
      setRemoteKpi(data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel">
      <h2>Коммерческий KPI</h2>
      <p className="muted">Unit-экономика и метрики tenant по документам.</p>
      <div className="rows-table-wrap">
        <table className="rows-table">
          <tbody>
            <tr><th>Tenant ID</th><td>{automationSettings.tenantId || 'default'}</td></tr>
            <tr><th>Локально: генераций ТЗ</th><td>{local.generated}</td></tr>
            <tr><th>Локально: billing events</th><td>{local.usage}</td></tr>
            <tr><th>Локально: документов к биллингу</th><td>{local.billDocs}</td></tr>
            <tr><th>Локально: выручка</th><td>{money(local.revenue, automationSettings.billingCurrency)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button type="button" onClick={() => void refreshRemote()} disabled={loading}>
          {loading ? 'Обновляю...' : 'Загрузить KPI с backend'}
        </button>
      </div>
      {remoteKpi && (
        <div className="rows-table-wrap">
          <table className="rows-table">
            <tbody>
              <tr><th>Backend tenant</th><td>{remoteKpi.tenant_id}</td></tr>
              <tr><th>Пользователей</th><td>{remoteKpi.users_total}</td></tr>
              <tr><th>Документов всего</th><td>{remoteKpi.docs_total}</td></tr>
              <tr><th>Документов 30д</th><td>{remoteKpi.docs_last_30d}</td></tr>
              <tr><th>Оценка выручки 30д</th><td>{money(remoteKpi.estimated_revenue_cents, automationSettings.billingCurrency)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

