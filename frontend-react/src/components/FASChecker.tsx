import { useState } from 'react';
import { buildApiUrl, getStoredToken } from '../lib/backendApi';

interface FASPosition {
  name: string;
  okpd2?: string;
  characteristics?: Array<{ name: string; value: string }>;
}

interface FASDecision {
  case_number: string;
  date: string;
  violation: string;
  url: string;
  risk_type: string;
}

interface FASRisk {
  type: string;
  description: string;
  label: string;
  color: string;
  advice: string;
}

interface FASResult {
  ok: boolean;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  fas_decisions: FASDecision[];
  local_risks: FASRisk[];
  total_decisions_found: number;
}

interface FASCheckerProps {
  positions: FASPosition[];
}

const RISK_COLORS = {
  LOW:    { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-800',  label: '✅ Низкий риск ФАС' },
  MEDIUM: { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-800',  label: '⚠️ Средний риск ФАС' },
  HIGH:   { bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-800',    label: '🚨 Высокий риск ФАС' },
};

export function FASChecker({ positions }: FASCheckerProps) {
  const [results, setResults] = useState<Record<number, FASResult>>({});
  const [loading, setLoading] = useState<Record<number, boolean>>({});

  const check = async (pos: FASPosition, index: number) => {
    setLoading(prev => ({ ...prev, [index]: true }));
    try {
      const token = getStoredToken();
      const resp = await fetch(buildApiUrl('/api/fas/check'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          position_name:   pos.name,
          okpd2:           pos.okpd2 || '',
          characteristics: pos.characteristics || [],
        }),
      });
      const data: FASResult = await resp.json();
      setResults(prev => ({ ...prev, [index]: data }));
    } catch {
      setResults(prev => ({
        ...prev,
        [index]: { ok: false, risk_level: 'LOW', fas_decisions: [], local_risks: [], total_decisions_found: 0 },
      }));
    } finally {
      setLoading(prev => ({ ...prev, [index]: false }));
    }
  };

  if (!positions.length) return null;

  return (
    <div className="border border-purple-200 rounded-lg bg-purple-50 p-4 mt-4">
      <h3 className="font-semibold text-purple-800 mb-3 text-sm flex items-center gap-2">
        <span>⚖️</span>
        <span>Проверка на жалобы ФАС</span>
      </h3>

      <div className="space-y-3">
        {positions.map((pos, i) => {
          const res = results[i];
          const colors = res ? RISK_COLORS[res.risk_level] : null;

          return (
            <div key={i} className="bg-white rounded border border-purple-100 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm text-gray-800">{pos.name}</span>
                <button
                  onClick={() => check(pos, i)}
                  disabled={loading[i]}
                  className="text-xs bg-purple-600 text-white px-3 py-1 rounded hover:bg-purple-700 disabled:opacity-50"
                >
                  {loading[i] ? 'Проверяем...' : 'Проверить'}
                </button>
              </div>

              {res && colors && (
                <div className="text-xs space-y-2">
                  <div className={`${colors.bg} ${colors.border} border rounded px-2 py-1.5 ${colors.text} font-medium`}>
                    {colors.label}
                    {res.total_decisions_found > 0 && (
                      <span className="ml-2 font-normal">
                        (найдено {res.total_decisions_found} реш. ФАС)
                      </span>
                    )}
                  </div>

                  {res.local_risks.length > 0 && (
                    <div className="space-y-1">
                      {res.local_risks.map((risk, j) => (
                        <div key={j} className="flex items-start gap-1 text-amber-700">
                          <span className="shrink-0">⚠️</span>
                          <div>
                            <div className="font-medium">{risk.label}</div>
                            <div className="text-gray-600">{risk.description}</div>
                            <div className="text-gray-500 italic">{risk.advice}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {res.fas_decisions.length > 0 && (
                    <div className="space-y-1 border-t pt-2">
                      <div className="text-gray-500 font-medium">Решения ФАС по аналогичным закупкам:</div>
                      {res.fas_decisions.slice(0, 3).map((d, j) => (
                        <div key={j} className="text-gray-600 flex items-start gap-1">
                          <span className="text-red-400 shrink-0">•</span>
                          <div>
                            <span className="font-mono">{d.case_number}</span>
                            {d.date && <span className="text-gray-400 ml-1">{d.date}</span>}
                            {d.url && (
                              <a href={d.url} target="_blank" rel="noopener noreferrer"
                                 className="ml-1 text-blue-600 hover:underline">→ ФАС</a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {res.local_risks.length === 0 && res.fas_decisions.length === 0 && (
                    <div className="text-gray-500">Явных рисков не обнаружено</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
