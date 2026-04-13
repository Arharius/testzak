import { useState } from 'react';
import { getOKEI } from '../data/okei_codes';

interface EISPosition {
  name: string;
  unit: string;
  quantity: number;
  okpd2?: string;
}

interface EISCardProps {
  positions: EISPosition[];
  nmck?: number | null;
}

const PROCUREMENT_METHODS = [
  { limit: 600_000,   method: "Запрос котировок (ст.72 44-ФЗ)",    color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
  { limit: 3_000_000, method: "Электронный аукцион (ст.59 44-ФЗ)", color: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" },
  { limit: Infinity,  method: "Конкурс или аукцион (ст.48 44-ФЗ)", color: "#c2410c", bg: "#fff7ed", border: "#fed7aa" },
];

export function EISCard({ positions, nmck }: EISCardProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const method = nmck ? PROCUREMENT_METHODS.find(m => nmck <= m.limit) : null;

  if (!positions.length) return null;

  return (
    <div style={{ marginTop: 16, border: '1px solid #bfdbfe', borderRadius: 8, background: '#eff6ff', padding: 16 }}>
      <h3 style={{ fontWeight: 600, color: '#1e40af', marginBottom: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px 0' }}>
        <span>📋</span>
        <span>Данные для ввода в ЕИС</span>
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {positions.map((pos, i) => {
          const okei = getOKEI(pos.unit);
          return (
            <div key={i} style={{ background: '#fff', borderRadius: 6, border: '1px solid #dbeafe', padding: 12 }}>
              <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: 8, fontSize: 13 }}>
                Позиция {i + 1}: {pos.name}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {[
                  { label: "ОКПД2",    value: pos.okpd2 || "—" },
                  { label: "ОКЕИ код", value: okei.code },
                  { label: "ОКЕИ",     value: okei.name },
                  { label: "Кол-во",   value: String(pos.quantity) },
                ].map(({ label, value }) => {
                  const copyId = `${i}-${label}`;
                  return (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}>
                      <span style={{ color: '#64748b' }}>{label}:</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{value}</span>
                        {value !== "—" && (
                          <button
                            onClick={() => copy(value, copyId)}
                            style={{
                              color: '#2563eb',
                              border: '1px solid #bfdbfe',
                              borderRadius: 3,
                              padding: '2px 6px',
                              fontSize: 11,
                              cursor: 'pointer',
                              background: '#fff',
                              lineHeight: 1,
                            }}
                          >
                            {copiedId === copyId ? "✓" : "копировать"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {method && nmck && (
        <div style={{
          marginTop: 12,
          padding: '8px 12px',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          background: method.bg,
          color: method.color,
          border: `1px solid ${method.border}`,
        }}>
          Способ закупки: {method.method}
        </div>
      )}
    </div>
  );
}
