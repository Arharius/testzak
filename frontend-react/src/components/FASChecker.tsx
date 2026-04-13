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

const RISK_STYLES = {
  LOW:    { bg: '#f0fdf4', border: '#bbf7d0', color: '#166534', label: '✅ Низкий риск ФАС' },
  MEDIUM: { bg: '#fffbeb', border: '#fde68a', color: '#92400e', label: '⚠️ Средний риск ФАС' },
  HIGH:   { bg: '#fff1f2', border: '#fecaca', color: '#991b1b', label: '🚨 Высокий риск ФАС' },
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
    <div style={{ border: '1px solid #e9d5ff', borderRadius: 8, background: '#faf5ff', padding: 16, marginTop: 16 }}>
      <h3 style={{ fontWeight: 600, color: '#6b21a8', marginBottom: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px 0' }}>
        <span>⚖️</span>
        <span>Проверка на жалобы ФАС</span>
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {positions.map((pos, i) => {
          const res = results[i];
          const st = res ? RISK_STYLES[res.risk_level] : null;

          return (
            <div key={i} style={{ background: '#fff', borderRadius: 6, border: '1px solid #f3e8ff', padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>{pos.name}</span>
                <button
                  onClick={() => check(pos, i)}
                  disabled={loading[i]}
                  style={{
                    fontSize: 12,
                    background: loading[i] ? '#c4b5fd' : '#7c3aed',
                    color: '#fff',
                    padding: '4px 12px',
                    borderRadius: 4,
                    border: 'none',
                    cursor: loading[i] ? 'default' : 'pointer',
                    opacity: loading[i] ? 0.7 : 1,
                  }}
                >
                  {loading[i] ? 'Проверяем...' : 'Проверить'}
                </button>
              </div>

              {res && st && (
                <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ background: st.bg, border: `1px solid ${st.border}`, borderRadius: 4, padding: '6px 10px', color: st.color, fontWeight: 600 }}>
                    {st.label}
                    {res.total_decisions_found > 0 && (
                      <span style={{ marginLeft: 8, fontWeight: 400 }}>
                        (найдено {res.total_decisions_found} реш. ФАС)
                      </span>
                    )}
                  </div>

                  {res.local_risks.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {res.local_risks.map((risk, j) => (
                        <div key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, color: '#92400e' }}>
                          <span style={{ flexShrink: 0 }}>⚠️</span>
                          <div>
                            <div style={{ fontWeight: 600 }}>{risk.label}</div>
                            <div style={{ color: '#475569' }}>{risk.description}</div>
                            <div style={{ color: '#64748b', fontStyle: 'italic' }}>{risk.advice}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {res.fas_decisions.length > 0 && (
                    <div style={{ borderTop: '1px solid #f3e8ff', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ color: '#64748b', fontWeight: 600 }}>Решения ФАС по аналогичным закупкам:</div>
                      {res.fas_decisions.slice(0, 3).map((d, j) => (
                        <div key={j} style={{ color: '#475569', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                          <span style={{ color: '#f87171', flexShrink: 0 }}>•</span>
                          <div>
                            <span style={{ fontFamily: 'monospace' }}>{d.case_number}</span>
                            {d.date && <span style={{ color: '#94a3b8', marginLeft: 6 }}>{d.date}</span>}
                            {d.url && (
                              <a href={d.url} target="_blank" rel="noopener noreferrer"
                                 style={{ marginLeft: 6, color: '#2563eb', textDecoration: 'none' }}>→ ФАС</a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {res.local_risks.length === 0 && res.fas_decisions.length === 0 && (
                    <div style={{ color: '#64748b' }}>✓ Явных рисков не обнаружено</div>
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
