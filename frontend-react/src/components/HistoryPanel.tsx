import { useState, useEffect, useCallback } from 'react';
import { buildApiUrl, getStoredToken } from '../lib/backendApi';

const PAGE_SIZE = 20;

interface TZHistoryItem {
  id: number;
  title: string;
  category: string;
  positions_count: number;
  created_at: string;
  is_favorite: boolean;
}

interface HistoryPanelProps {
  onRepeat?: (data: unknown) => void;
}

export function HistoryPanel({ onRepeat }: HistoryPanelProps) {
  const [items, setItems] = useState<TZHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchPage = useCallback(async (off: number) => {
    setLoading(true);
    const token = getStoredToken();
    try {
      const resp = await fetch(buildApiUrl(`/api/tz-history?limit=${PAGE_SIZE}&offset=${off}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await resp.json();
      setItems(d.items || []);
      setTotal(d.total ?? 0);
      setOffset(off);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPage(0); }, [fetchPage]);

  const handleDelete = async (id: number) => {
    if (!confirm('Удалить ТЗ из истории?')) return;
    const token = getStoredToken();
    await fetch(buildApiUrl(`/api/tz-history/${id}`), {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    await fetchPage(offset);
  };

  const handleFavorite = async (id: number) => {
    const token = getStoredToken();
    await fetch(buildApiUrl(`/api/tz-history/${id}/favorite`), {
      method: 'PATCH',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    setItems(prev => prev.map(i => i.id === id ? { ...i, is_favorite: !i.is_favorite } : i));
  };

  const handleRepeat = async (id: number) => {
    const token = getStoredToken();
    const resp = await fetch(buildApiUrl(`/api/tz-history/${id}`), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await resp.json();
    if (onRepeat && data.result_json) onRepeat(data.result_json);
  };

  if (loading) {
    return <div style={{ color: '#94a3b8', fontSize: 13, padding: '16px 0', textAlign: 'center' }}>Загрузка...</div>;
  }

  if (!items.length && offset === 0) {
    return (
      <div style={{ textAlign: 'center', color: '#94a3b8', padding: '32px 0', fontSize: 13 }}>
        История пуста. Сгенерируйте первое ТЗ.
      </div>
    );
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const favorites = items.filter(i => i.is_favorite);
  const others = items.filter(i => !i.is_favorite);
  const sorted = [...favorites, ...others];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sorted.map(item => (
        <div
          key={item.id}
          style={{
            background: '#fff',
            border: '1.5px solid #e2e8f0',
            borderRadius: 8,
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.title}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
              {item.category} · {item.positions_count} поз. ·{' '}
              {new Date(item.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12, flexShrink: 0 }}>
            <button
              onClick={() => handleFavorite(item.id)}
              style={{ fontSize: 16, lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
              title="В избранное"
            >
              {item.is_favorite ? '⭐' : '☆'}
            </button>
            {onRepeat && (
              <button
                onClick={() => handleRepeat(item.id)}
                style={{ fontSize: 11, background: '#2563eb', color: '#fff', padding: '4px 10px', borderRadius: 4, border: 'none', cursor: 'pointer' }}
              >
                Повторить
              </button>
            )}
            <button
              onClick={() => handleDelete(item.id)}
              style={{ fontSize: 11, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
              title="Удалить"
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 8, fontSize: 13 }}>
          <button
            onClick={() => fetchPage(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            style={{
              padding: '4px 14px', borderRadius: 4, border: '1px solid #e2e8f0',
              background: offset === 0 ? '#f1f5f9' : '#fff',
              color: offset === 0 ? '#94a3b8' : '#1e293b',
              cursor: offset === 0 ? 'default' : 'pointer', fontSize: 12,
            }}
          >
            ← Назад
          </button>
          <span style={{ color: '#64748b' }}>
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => fetchPage(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
            style={{
              padding: '4px 14px', borderRadius: 4, border: '1px solid #e2e8f0',
              background: offset + PAGE_SIZE >= total ? '#f1f5f9' : '#fff',
              color: offset + PAGE_SIZE >= total ? '#94a3b8' : '#1e293b',
              cursor: offset + PAGE_SIZE >= total ? 'default' : 'pointer', fontSize: 12,
            }}
          >
            Вперёд →
          </button>
        </div>
      )}

      <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 11, marginTop: 4 }}>
        Всего ТЗ: {total}
      </div>
    </div>
  );
}
