import { useState, useEffect } from 'react';
import { buildApiUrl, getStoredToken } from '../lib/backendApi';

interface NMCKPosition {
  name: string;
  quantity: number;
  okpd2?: string;
}

interface NMCKResult {
  ok: boolean;
  fallback?: boolean;
  result?: {
    method?: string;
    nmck: number;
    nmck_with_vat?: number;
    avg_unit_price?: number;
    unit_price_median?: number;
    sources_count?: number;
    warning?: string;
    legal_basis?: string;
    nmck_range?: { min: number; max: number };
  };
  error?: string | null;
  legal_basis?: string;
  recommendation?: string;
  contracts?: Array<{
    price: number;
    supplier: string;
    date: string;
    region: string;
  }>;
}

interface NMCKCalculatorProps {
  positions: NMCKPosition[];
  onNmckTotal?: (total: number) => void;
}

const fmt = (n?: number | null) =>
  n != null
    ? new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(n)
    : '—';

export function NMCKCalculator({ positions, onNmckTotal }: NMCKCalculatorProps) {
  const [results, setResults] = useState<Record<number, NMCKResult>>({});
  const [loading, setLoading] = useState<Record<number, boolean>>({});

  const calculate = async (pos: NMCKPosition, index: number) => {
    setLoading(prev => ({ ...prev, [index]: true }));
    try {
      const token = getStoredToken();
      const resp = await fetch(buildApiUrl('/api/nmck/calculate'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          okpd2:    pos.okpd2 || '',
          keyword:  pos.name,
          quantity: pos.quantity,
        }),
      });
      const data: NMCKResult = await resp.json();
      setResults(prev => ({ ...prev, [index]: data }));
    } catch {
      setResults(prev => ({ ...prev, [index]: { ok: false, error: 'Ошибка соединения' } }));
    } finally {
      setLoading(prev => ({ ...prev, [index]: false }));
    }
  };

  const totalNMCK = Object.values(results)
    .filter(r => r?.result?.nmck)
    .reduce((sum, r) => sum + (r.result?.nmck ?? 0), 0);

  useEffect(() => {
    if (onNmckTotal) onNmckTotal(totalNMCK);
  }, [totalNMCK, onNmckTotal]);

  if (!positions.length) return null;

  return (
    <div style={{ border: '1px solid #bbf7d0', borderRadius: 8, background: '#f0fdf4', padding: 16, marginTop: 16 }}>
      <h3 style={{ fontWeight: 600, color: '#166534', marginBottom: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px 0' }}>
        <span>💰</span>
        <span>Калькулятор НМЦК (ч.1 ст.22 44-ФЗ)</span>
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {positions.map((pos, i) => {
          const res = results[i];
          return (
            <div key={i} style={{ background: '#fff', borderRadius: 6, border: '1px solid #dcfce7', padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>{pos.name} × {pos.quantity}</span>
                <button
                  onClick={() => calculate(pos, i)}
                  disabled={loading[i]}
                  style={{
                    fontSize: 12,
                    background: loading[i] ? '#86efac' : '#16a34a',
                    color: '#fff',
                    padding: '4px 12px',
                    borderRadius: 4,
                    border: 'none',
                    cursor: loading[i] ? 'default' : 'pointer',
                    opacity: loading[i] ? 0.7 : 1,
                  }}
                >
                  {loading[i] ? 'Ищем...' : 'Рассчитать'}
                </button>
              </div>

              {res && (
                <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {res.ok && res.result ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#64748b' }}>НМЦК:</span>
                        <span style={{ fontWeight: 700, color: '#15803d' }}>{fmt(res.result.nmck)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#64748b' }}>С НДС 20%:</span>
                        <span>{fmt(res.result.nmck_with_vat ?? res.result.nmck * 1.2)}</span>
                      </div>
                      {res.result.nmck_range && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                          <span>Диапазон:</span>
                          <span>{fmt(res.result.nmck_range.min)} — {fmt(res.result.nmck_range.max)}</span>
                        </div>
                      )}
                      {res.fallback && res.result.warning && (
                        <div style={{ color: '#d97706', marginTop: 4, display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                          <span>⚠️</span>
                          <span>{res.result.warning}</span>
                        </div>
                      )}
                      <div style={{ color: '#94a3b8', marginTop: 4 }}>
                        {res.result.legal_basis || res.legal_basis}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ color: '#dc2626' }}>{res.error}</div>
                      {res.recommendation && (
                        <div style={{ color: '#d97706', marginTop: 4 }}>💡 {res.recommendation}</div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {totalNMCK > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #bbf7d0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, color: '#166534', fontSize: 13 }}>Итого НМЦК:</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#15803d' }}>{fmt(totalNMCK)}</span>
        </div>
      )}
    </div>
  );
}
