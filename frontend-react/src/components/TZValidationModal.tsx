import type { TZRiskItem, TZValidateResponse } from '../lib/backendApi';

type Props = {
  result: TZValidateResponse;
  onClose: () => void;
  onProceed: () => void;
};

function RiskCard({ item, type }: { item: TZRiskItem; type: 'critical' | 'moderate' }) {
  const isCritical = type === 'critical';
  return (
    <div
      style={{
        border: `1px solid ${isCritical ? '#f87171' : '#fbbf24'}`,
        borderLeft: `4px solid ${isCritical ? '#ef4444' : '#f59e0b'}`,
        borderRadius: 8,
        padding: '12px 14px',
        background: isCritical ? '#fff5f5' : '#fffbeb',
        marginBottom: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: isCritical ? '#dc2626' : '#d97706' }}>
          {isCritical ? '🚫 Критический риск' : '⚠️ Умеренный риск'}
        </span>
        <code
          style={{
            fontSize: 12,
            background: isCritical ? '#fee2e2' : '#fef3c7',
            color: isCritical ? '#b91c1c' : '#92400e',
            padding: '1px 6px',
            borderRadius: 4,
          }}
        >
          «{item.phrase}»
        </code>
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>
        <strong>Поле:</strong> {item.field}
      </div>
      {item.context && (
        <div
          style={{
            fontSize: 12,
            color: '#374151',
            background: '#f9fafb',
            borderRadius: 4,
            padding: '4px 8px',
            marginTop: 4,
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          …{item.context}…
        </div>
      )}
      <div style={{ fontSize: 12, color: '#374151', marginTop: 6 }}>
        <strong>Проблема:</strong> {item.message}
      </div>
      {item.recommendation && (
        <div
          style={{
            fontSize: 12,
            color: '#1d4ed8',
            marginTop: 4,
            padding: '4px 8px',
            background: '#eff6ff',
            borderRadius: 4,
          }}
        >
          💡 <strong>Рекомендация:</strong> {item.recommendation}
        </div>
      )}
    </div>
  );
}

export function TZValidationModal({ result, onClose, onProceed }: Props) {
  const hasCritical = result.critical.length > 0;
  const hasModerate = result.moderate.length > 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          maxWidth: 640,
          width: '100%',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 20px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: hasCritical ? '#fef2f2' : '#fffbeb',
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: hasCritical ? '#991b1b' : '#78350f' }}>
              {hasCritical ? '🚫 Экспорт заблокирован — критический ФАС-риск' : '⚠️ Предупреждение перед экспортом'}
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              {hasCritical
                ? 'Устраните нарушения ст. 33 44-ФЗ перед экспортом'
                : 'Обнаружены неизмеримые формулировки. Экспорт разрешён.'}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 20,
              cursor: 'pointer',
              color: '#9ca3af',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '16px 20px', flex: 1 }}>
          {hasCritical && (
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#dc2626',
                  marginBottom: 8,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Критические нарушения ({result.critical.length})
              </div>
              {result.critical.map((item, i) => (
                <RiskCard key={i} item={item} type="critical" />
              ))}
            </div>
          )}

          {hasModerate && (
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#d97706',
                  marginBottom: 8,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Умеренные риски ({result.moderate.length})
              </div>
              {result.moderate.map((item, i) => (
                <RiskCard key={i} item={item} type="moderate" />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
            background: '#f9fafb',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '8px 18px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              background: '#fff',
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: 500,
              color: '#374151',
            }}
          >
            Исправить
          </button>
          {!hasCritical && (
            <button
              onClick={() => {
                onClose();
                onProceed();
              }}
              style={{
                padding: '8px 18px',
                borderRadius: 8,
                border: 'none',
                background: '#f59e0b',
                color: '#fff',
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Всё равно экспортировать
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
