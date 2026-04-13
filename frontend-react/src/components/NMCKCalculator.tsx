import { useState } from 'react';
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
}

const fmt = (n?: number | null) =>
  n != null
    ? new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(n)
    : '—';

export function NMCKCalculator({ positions }: NMCKCalculatorProps) {
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

  if (!positions.length) return null;

  return (
    <div className="border border-green-200 rounded-lg bg-green-50 p-4 mt-4">
      <h3 className="font-semibold text-green-800 mb-3 text-sm flex items-center gap-2">
        <span>💰</span>
        <span>Калькулятор НМЦК (ч.1 ст.22 44-ФЗ)</span>
      </h3>

      <div className="space-y-3">
        {positions.map((pos, i) => {
          const res = results[i];
          return (
            <div key={i} className="bg-white rounded border border-green-100 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm text-gray-800">{pos.name} × {pos.quantity}</span>
                <button
                  onClick={() => calculate(pos, i)}
                  disabled={loading[i]}
                  className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 disabled:opacity-50"
                >
                  {loading[i] ? 'Ищем...' : 'Рассчитать'}
                </button>
              </div>

              {res && (
                <div className="text-xs space-y-1">
                  {res.ok && res.result ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-gray-500">НМЦК:</span>
                        <span className="font-bold text-green-700">{fmt(res.result.nmck)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">С НДС 20%:</span>
                        <span>{fmt(res.result.nmck_with_vat ?? res.result.nmck * 1.2)}</span>
                      </div>
                      {res.result.nmck_range && (
                        <div className="flex justify-between text-gray-400">
                          <span>Диапазон:</span>
                          <span>{fmt(res.result.nmck_range.min)} — {fmt(res.result.nmck_range.max)}</span>
                        </div>
                      )}
                      {res.fallback && res.result.warning && (
                        <div className="text-amber-600 mt-1 flex items-start gap-1">
                          <span>⚠️</span>
                          <span>{res.result.warning}</span>
                        </div>
                      )}
                      <div className="text-gray-400 mt-1">
                        {res.result.legal_basis || res.legal_basis}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-red-500">{res.error}</div>
                      {res.recommendation && (
                        <div className="text-amber-600 mt-1">💡 {res.recommendation}</div>
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
        <div className="mt-3 pt-3 border-t border-green-200 flex justify-between items-center">
          <span className="font-semibold text-green-800 text-sm">Итого НМЦК:</span>
          <span className="text-lg font-bold text-green-700">{fmt(totalNMCK)}</span>
        </div>
      )}
    </div>
  );
}
