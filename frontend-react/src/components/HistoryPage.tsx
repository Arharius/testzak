import { useState, useEffect, useCallback } from 'react';
import type { GenerationItem } from '../lib/backendApi';
import { listGenerations, deleteGeneration, buildApiUrl, getStoredToken } from '../lib/backendApi';

type HistoryPageProps = {
  onBack: () => void;
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  text: 'текст',
  docx: 'docx',
  price: 'прайс',
  fix: 'правка',
};

function qaColor(score: number | null): string {
  if (score === null || score === undefined) return '#94a3b8';
  if (score >= 80) return '#16a34a';
  if (score >= 60) return '#d97706';
  return '#dc2626';
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function GenerationCard({
  item,
  onDelete,
  onDownload,
  downloading,
}: {
  item: GenerationItem;
  onDelete: (id: number) => void;
  onDownload: (id: number) => void;
  downloading: boolean;
}) {
  const score = item.qa_score;
  const color = qaColor(score);

  return (
    <div
      style={{
        background: 'var(--card-bg, #fff)',
        border: '1.5px solid var(--border, #e2e8f0)',
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--text-primary, #1e293b)',
          lineHeight: 1.4,
          wordBreak: 'break-word',
        }}
      >
        {item.title || 'Без названия'}
      </div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-muted, #64748b)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 12px',
          alignItems: 'center',
        }}
      >
        <span>{fmtDate(item.created_at)}</span>
        <span>·</span>
        <span>{SOURCE_TYPE_LABELS[item.source_type] ?? item.source_type}</span>
        <span>·</span>
        <span>{item.word_count.toLocaleString('ru-RU')} слов</span>
        {score !== null && score !== undefined && (
          <>
            <span>·</span>
            <span style={{ color, fontWeight: 700 }}>QA: {score}/100</span>
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button
          type="button"
          onClick={() => onDownload(item.id)}
          disabled={downloading}
          style={{
            fontSize: 12,
            padding: '5px 12px',
            borderRadius: 6,
            border: '1px solid var(--border, #cbd5e1)',
            background: 'var(--btn-bg, #f8fafc)',
            color: 'var(--text-primary, #1e293b)',
            cursor: downloading ? 'not-allowed' : 'pointer',
            fontWeight: 500,
          }}
        >
          {downloading ? '⏳ Скачивается...' : '📄 Скачать'}
        </button>
        <button
          type="button"
          onClick={() => onDelete(item.id)}
          style={{
            fontSize: 12,
            padding: '5px 12px',
            borderRadius: 6,
            border: '1px solid #fca5a5',
            background: '#fff1f2',
            color: '#dc2626',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Удалить
        </button>
      </div>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pages: number[] = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center', marginTop: 24 }}>
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page === 1}
        style={paginBtnStyle(false, page === 1)}
      >
        ←
      </button>
      {start > 1 && <span style={{ padding: '0 4px', color: '#94a3b8' }}>...</span>}
      {pages.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPage(p)}
          style={paginBtnStyle(p === page, false)}
        >
          {p}
        </button>
      ))}
      {end < totalPages && <span style={{ padding: '0 4px', color: '#94a3b8' }}>...</span>}
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page === totalPages}
        style={paginBtnStyle(false, page === totalPages)}
      >
        →
      </button>
    </div>
  );
}

function paginBtnStyle(active: boolean, disabled: boolean): React.CSSProperties {
  return {
    minWidth: 36,
    height: 36,
    borderRadius: 6,
    border: active ? '2px solid #2563eb' : '1px solid #e2e8f0',
    background: active ? '#2563eb' : disabled ? '#f8fafc' : '#fff',
    color: active ? '#fff' : disabled ? '#cbd5e1' : '#334155',
    fontWeight: active ? 700 : 400,
    fontSize: 13,
    cursor: disabled ? 'not-allowed' : 'pointer',
    padding: '0 8px',
  };
}

const PAGE_LIMIT = 20;

export function HistoryPage({ onBack }: HistoryPageProps) {
  const [items, setItems] = useState<GenerationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await listGenerations(p, PAGE_LIMIT);
      setItems(res.items);
      setTotal(res.total);
      setPage(res.page);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1);
  }, [load]);

  const handlePage = (p: number) => {
    if (p < 1 || p > totalPages) return;
    void load(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDownload = async (id: number) => {
    setDownloadingId(id);
    try {
      const token = getStoredToken();
      const url = buildApiUrl(`/api/generations/${id}/download`);
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const resp = await fetch(url, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const ext = resp.headers.get('Content-Disposition')?.includes('.txt') ? 'txt' : 'docx';
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `TZ_${id}.${ext}`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch (e) {
      alert(`Ошибка скачивания: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId(null), 3000);
      return;
    }
    setDeletingId(id);
    setConfirmDeleteId(null);
    try {
      await deleteGeneration(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      setTotal((t) => t - 1);
    } catch (e) {
      alert(`Ошибка удаления: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div
      style={{
        maxWidth: 800,
        margin: '0 auto',
        padding: '24px 16px',
        minHeight: '100vh',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            background: 'none',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 13,
            cursor: 'pointer',
            color: '#475569',
          }}
        >
          ← Назад
        </button>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary, #1e293b)' }}>
            История генераций
          </h1>
          {!loading && (
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              {total > 0 ? `${total} записей` : 'Записей нет'}
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: '12px 16px',
            background: '#fff1f2',
            border: '1px solid #fca5a5',
            borderRadius: 8,
            color: '#dc2626',
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8', fontSize: 14 }}>
          ⏳ Загрузка...
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && items.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 16px',
            color: '#94a3b8',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#64748b' }}>История пуста</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            После экспорта DOCX записи будут сохраняться здесь
          </div>
        </div>
      )}

      {/* Cards */}
      {!loading && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((item) => (
            <div key={item.id} style={{ position: 'relative' }}>
              {confirmDeleteId === item.id && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    background: 'rgba(220,38,38,0.95)',
                    borderRadius: 10,
                    color: '#fff',
                    fontSize: 13,
                    padding: '10px 14px',
                    zIndex: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>Удалить «{item.title.slice(0, 40)}»? Нажмите ещё раз.</span>
                </div>
              )}
              <GenerationCard
                item={item}
                onDelete={deletingId === item.id ? () => {} : handleDelete}
                onDownload={handleDownload}
                downloading={downloadingId === item.id}
              />
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      <Pagination page={page} totalPages={totalPages} onPage={handlePage} />

      {/* Storage note */}
      {!loading && total > 0 && (
        <div
          style={{
            marginTop: 24,
            fontSize: 12,
            color: '#94a3b8',
            textAlign: 'center',
          }}
        >
          При достижении лимита самые старые записи удаляются автоматически.
        </div>
      )}
    </div>
  );
}
