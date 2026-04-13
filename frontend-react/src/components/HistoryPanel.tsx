import { useState, useEffect } from 'react';
import { buildApiUrl, getStoredToken } from '../lib/backendApi';

interface TZHistoryItem {
  id: number;
  title: string;
  category: string;
  positions_count: number;
  created_at: string;
  is_favorite: boolean;
  result_json?: unknown;
}

interface HistoryPanelProps {
  onRepeat?: (data: unknown) => void;
}

export function HistoryPanel({ onRepeat }: HistoryPanelProps) {
  const [items, setItems] = useState<TZHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getStoredToken();
    fetch(buildApiUrl('/api/tz-history'), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then(d => { setItems(d.items || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleDelete = async (id: number) => {
    if (!confirm('Удалить ТЗ из истории?')) return;
    const token = getStoredToken();
    await fetch(buildApiUrl(`/api/tz-history/${id}`), {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    setItems(prev => prev.filter(i => i.id !== id));
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
    if (onRepeat && data.result_json) {
      onRepeat(data.result_json);
    }
  };

  if (loading) {
    return <div className="text-gray-500 text-sm py-4 text-center">Загрузка...</div>;
  }

  if (!items.length) {
    return (
      <div className="text-center text-gray-400 py-8 text-sm">
        История пуста. Сгенерируйте первое ТЗ.
      </div>
    );
  }

  const favorites = items.filter(i => i.is_favorite);
  const others = items.filter(i => !i.is_favorite);
  const sorted = [...favorites, ...others];

  return (
    <div className="space-y-2">
      {sorted.map(item => (
        <div
          key={item.id}
          className="bg-white border border-gray-200 rounded-lg p-3 flex items-center justify-between hover:border-blue-300 transition-colors"
        >
          <div className="min-w-0 flex-1">
            <div className="font-medium text-gray-800 text-sm truncate">{item.title}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {item.category} · {item.positions_count} поз. ·{' '}
              {new Date(item.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          </div>
          <div className="flex items-center gap-1.5 ml-3 shrink-0">
            <button
              onClick={() => handleFavorite(item.id)}
              className="text-base leading-none hover:scale-110 transition-transform"
              title="В избранное"
            >
              {item.is_favorite ? '⭐' : '☆'}
            </button>
            {onRepeat && (
              <button
                onClick={() => handleRepeat(item.id)}
                className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
              >
                Повторить
              </button>
            )}
            <button
              onClick={() => handleDelete(item.id)}
              className="text-xs text-red-400 hover:text-red-600"
              title="Удалить"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
