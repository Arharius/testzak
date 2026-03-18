import { createPortal } from 'react-dom';

type TypeSuggestionItem = {
  type: string;
  name: string;
  okpd2: string;
};

type TypeSuggestionsState = {
  rowId: number;
  items: TypeSuggestionItem[];
  loading?: boolean;
  rect?: {
    top: number;
    left: number;
    width: number;
  };
} | null;

type RowLike = {
  id: number;
  type: string;
};

type WorkspaceTypeSuggestionsProps = {
  typeSuggestions: TypeSuggestionsState;
  rows: RowLike[];
  getUnifiedNacRegime: (type: string) => string;
  getPortalContainer: () => HTMLElement;
  onSelectSuggestion: (rowId: number, type: string) => void;
};

export function WorkspaceTypeSuggestions({
  typeSuggestions,
  rows,
  getUnifiedNacRegime,
  getPortalContainer,
  onSelectSuggestion,
}: WorkspaceTypeSuggestionsProps) {
  if (!typeSuggestions || (!typeSuggestions.loading && typeSuggestions.items.length <= 1) || !typeSuggestions.rect) {
    return null;
  }

  const regLabels: Record<string, string> = {
    pp878: 'РЭПР',
    pp1236: 'Реестр ПО',
    pp616: 'Промтовар',
    none: '—',
  };
  const regColors: Record<string, string> = {
    pp878: '#2563EB',
    pp1236: '#16A34A',
    pp616: '#D97706',
    none: '#6B7280',
  };

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: typeSuggestions.rect.top,
        left: typeSuggestions.rect.left,
        width: Math.max(typeSuggestions.rect.width, 460),
        zIndex: 99999,
        background: '#1A1F2E',
        border: '1px solid #3B4255',
        borderRadius: 8,
        boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
        maxHeight: 340,
        overflowY: 'auto',
        fontSize: 12,
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto auto',
          gap: 8,
          padding: '7px 12px',
          color: '#7B8494',
          fontSize: 10,
          fontWeight: 600,
          borderBottom: '1px solid #2A3040',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          position: 'sticky',
          top: 0,
          background: '#1A1F2E',
          zIndex: 1,
        }}
      >
        <span>Тип товара</span>
        <span>ОКПД2</span>
        <span>Нацрежим</span>
      </div>
      {typeSuggestions.items.map((item, index) => {
        const regime = getUnifiedNacRegime(item.type);
        const currentRow = rows.find((row) => row.id === typeSuggestions.rowId);
        const isActive = currentRow ? item.type === currentRow.type : false;

        return (
          <div
            key={item.type}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto',
              gap: 8,
              padding: '7px 12px',
              cursor: 'pointer',
              alignItems: 'center',
              borderBottom: index < typeSuggestions.items.length - 1 ? '1px solid #232838' : 'none',
              background: isActive ? '#1E3A5F' : 'transparent',
              transition: 'background 0.1s',
            }}
            onMouseEnter={(event) => {
              if (!isActive) (event.currentTarget as HTMLElement).style.background = '#242B3D';
            }}
            onMouseLeave={(event) => {
              if (!isActive) (event.currentTarget as HTMLElement).style.background = 'transparent';
            }}
            onMouseDown={() => onSelectSuggestion(typeSuggestions.rowId, item.type)}
          >
            <span style={{ color: isActive ? '#93C5FD' : '#E2E8F0', fontWeight: isActive ? 600 : 400 }}>
              {isActive && '✓ '}{item.name}
            </span>
            <span style={{ color: '#8892A4', fontSize: 10, fontFamily: 'monospace' }}>{item.okpd2}</span>
            <span
              style={{
                fontSize: 9,
                padding: '1px 6px',
                borderRadius: 4,
                fontWeight: 600,
                color: '#fff',
                background: regColors[regime] ?? '#6B7280',
              }}
            >
              {regLabels[regime] ?? '—'}
            </span>
          </div>
        );
      })}
      {typeSuggestions.loading && (
        <div style={{ padding: '8px 12px', color: '#FBBF24', fontSize: 11, textAlign: 'center' }}>
          🔍 Поиск через ИИ...
        </div>
      )}
      <div style={{ padding: '5px 12px', color: '#5A6478', fontSize: 10, borderTop: '1px solid #2A3040', textAlign: 'center' }}>
        {typeSuggestions.items.length > 0 ? `Найдено: ${typeSuggestions.items.length}` : 'Ожидание ИИ...'} · Кликните для выбора
      </div>
    </div>,
    getPortalContainer(),
  );
}
