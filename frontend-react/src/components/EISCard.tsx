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
  { limit: 600_000,   method: "Запрос котировок (ст.72 44-ФЗ)",    color: "green" as const },
  { limit: 3_000_000, method: "Электронный аукцион (ст.59 44-ФЗ)", color: "blue" as const },
  { limit: Infinity,  method: "Конкурс или аукцион (ст.48 44-ФЗ)", color: "orange" as const },
];

export function EISCard({ positions, nmck }: EISCardProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const method = PROCUREMENT_METHODS.find(m => !nmck || nmck <= m.limit);

  if (!positions.length) return null;

  return (
    <div className="mt-4 border border-blue-200 rounded-lg bg-blue-50 p-4">
      <h3 className="font-semibold text-blue-800 mb-3 text-sm flex items-center gap-2">
        <span>📋</span>
        <span>Данные для ввода в ЕИС</span>
      </h3>

      <div className="space-y-3">
        {positions.map((pos, i) => {
          const okei = getOKEI(pos.unit);
          return (
            <div key={i} className="bg-white rounded border border-blue-100 p-3">
              <div className="font-medium text-gray-800 mb-2 text-sm">
                Позиция {i + 1}: {pos.name}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { label: "ОКПД2",    value: pos.okpd2 || "—" },
                  { label: "ОКЕИ код", value: okei.code },
                  { label: "ОКЕИ",     value: okei.name },
                  { label: "Кол-во",   value: String(pos.quantity) },
                ].map(({ label, value }) => {
                  const copyId = `${i}-${label}`;
                  return (
                    <div key={label} className="flex items-center justify-between bg-gray-50 rounded px-2 py-1">
                      <span className="text-gray-500">{label}:</span>
                      <div className="flex items-center gap-1">
                        <span className="font-mono font-medium">{value}</span>
                        {value !== "—" && (
                          <button
                            onClick={() => copy(value, copyId)}
                            className="text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-1 py-0.5 text-xs leading-none"
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
        <div className={`mt-3 p-2 rounded text-xs font-medium ${
          method.color === 'green'  ? 'bg-green-50 text-green-800 border border-green-200' :
          method.color === 'blue'   ? 'bg-blue-50 text-blue-800 border border-blue-200' :
                                      'bg-orange-50 text-orange-800 border border-orange-200'
        }`}>
          Способ закупки: {method.method}
        </div>
      )}
    </div>
  );
}
