import { useState, useEffect, useRef, useCallback } from 'react';

const PLAN_LABELS: Record<string, string> = {
  trial: 'Триал',
  pilot: 'Пилот',
  start: 'Старт',
  base: 'Базовый',
  team: 'Команда',
  corp: 'Корп',
  admin: 'Админ',
};

const PLAN_COLORS: Record<string, string> = {
  trial: '#9ca3af',
  pilot: '#7c3aed',
  start: '#16a34a',
  base: '#2563eb',
  team: '#ea580c',
  corp: '#ca8a04',
  admin: '#dc2626',
};

interface AdminUser {
  id: string;
  email: string;
  name: string;
  plan: string;
  role: string;
  trial_tz_used: number;
  trial_expires_at: string | null;
  subscription_expires_at: string | null;
  created_at: string | null;
  last_login: string | null;
}

interface PlanOption {
  plan: string;
  months: number;
  label: string;
  bold?: boolean;
}

const PLAN_OPTIONS: PlanOption[] = [
  { plan: 'pilot', months: 3, label: 'Пилот 90 дней', bold: true },
  { plan: 'start', months: 1, label: 'Старт (1 мес)' },
  { plan: 'base', months: 1, label: 'Базовый (1 мес)' },
  { plan: 'team', months: 1, label: 'Команда (1 мес)' },
  { plan: 'corp', months: 1, label: 'Корп (1 мес)' },
  { plan: 'trial', months: 0, label: 'Сбросить в триал' },
];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function computeExpiresAt(plan: string, months: number): string {
  const now = new Date();
  if (plan === 'trial') return '—';
  if (plan === 'pilot') {
    now.setDate(now.getDate() + 90);
  } else {
    now.setDate(now.getDate() + 30 * months);
  }
  return now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getToken(): string {
  return localStorage.getItem('auth_token') || '';
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(opts?.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

interface ConfirmState {
  user: AdminUser;
  opt: PlanOption;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [applying, setApplying] = useState(false);
  const [successId, setSuccessId] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadUsers = useCallback(async (q: string, p: string) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (q) params.set('search', q);
      if (p) params.set('plan', p);
      const data = await apiFetch(`/api/admin/users?${params}`);
      setUsers(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers('', '');
  }, [loadUsers]);

  const handleSearch = (val: string) => {
    setSearch(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadUsers(val, planFilter), 400);
  };

  const handlePlanFilter = (val: string) => {
    setPlanFilter(val);
    loadUsers(search, val);
  };

  const handleSelectPlan = (user: AdminUser, opt: PlanOption) => {
    setOpenMenuId(null);
    setConfirm({ user, opt });
  };

  const handleConfirm = async () => {
    if (!confirm) return;
    setApplying(true);
    try {
      const updated: AdminUser = await apiFetch(
        `/api/admin/users/${confirm.user.id}/plan`,
        {
          method: 'PATCH',
          body: JSON.stringify({ plan: confirm.opt.plan, months: confirm.opt.months }),
        }
      );
      setUsers(prev => prev.map(u => (u.id === updated.id ? updated : u)));
      setSuccessId(updated.id);
      setTimeout(() => setSuccessId(null), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка при изменении тарифа');
    } finally {
      setApplying(false);
      setConfirm(null);
    }
  };

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.au-plan-cell')) setOpenMenuId(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="au-page">
      <div className="au-header">
        <h1 className="au-title">Управление пользователями</h1>
        <span className="au-count">{users.length} польз.</span>
      </div>

      <div className="au-toolbar">
        <input
          className="au-search"
          type="text"
          placeholder="Поиск по email..."
          value={search}
          onChange={e => handleSearch(e.target.value)}
        />
        <select
          className="au-filter-select"
          value={planFilter}
          onChange={e => handlePlanFilter(e.target.value)}
        >
          <option value="">Все тарифы</option>
          {Object.entries(PLAN_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button
          className="au-refresh-btn"
          onClick={() => loadUsers(search, planFilter)}
          disabled={loading}
        >
          {loading ? '⏳' : '↺ Обновить'}
        </button>
      </div>

      {error && <div className="au-error">{error}</div>}

      <div className="au-table-wrap">
        <table className="au-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Тариф</th>
              <th>Активен до</th>
              <th>Зарегистрирован</th>
              <th>Последний вход</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="au-empty">
                  {search || planFilter ? 'Ничего не найдено' : 'Пользователей пока нет'}
                </td>
              </tr>
            )}
            {users.map(u => {
              const expiresAt = u.subscription_expires_at || u.trial_expires_at;
              const isSuccess = successId === u.id;
              return (
                <tr key={u.id} className={isSuccess ? 'au-row-success' : ''}>
                  <td className="au-cell-email">
                    {u.email}
                    {u.name ? <span className="au-name">({u.name})</span> : null}
                  </td>
                  <td className="au-cell-plan">
                    <span
                      className="au-plan-badge"
                      style={{ color: PLAN_COLORS[u.plan] || '#6b7280' }}
                    >
                      {PLAN_LABELS[u.plan] || u.plan}
                    </span>
                  </td>
                  <td className="au-cell-date">{formatDate(expiresAt)}</td>
                  <td className="au-cell-date">{formatDate(u.created_at)}</td>
                  <td className="au-cell-date">{formatDate(u.last_login)}</td>
                  <td className="au-plan-cell">
                    <button
                      className="au-plan-btn"
                      onClick={() => setOpenMenuId(openMenuId === u.id ? null : u.id)}
                    >
                      Тариф ▾
                    </button>
                    {openMenuId === u.id && (
                      <div className="au-plan-menu">
                        {PLAN_OPTIONS.map(opt => (
                          <button
                            key={opt.plan}
                            className={`au-plan-menu-item${opt.plan === u.plan ? ' au-plan-menu-item--current' : ''}${opt.bold ? ' au-plan-menu-item--bold' : ''}`}
                            onClick={() => handleSelectPlan(u, opt)}
                          >
                            {opt.label}
                            {opt.plan === u.plan && <span className="au-current-mark"> ✓</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {confirm && (
        <div className="au-modal-overlay" onClick={() => setConfirm(null)}>
          <div className="au-modal" onClick={e => e.stopPropagation()}>
            <div className="au-modal-title">Изменить тариф</div>
            <div className="au-modal-body">
              <p>
                Активировать тариф{' '}
                <strong style={{ color: PLAN_COLORS[confirm.opt.plan] }}>
                  {PLAN_LABELS[confirm.opt.plan] || confirm.opt.plan}
                </strong>{' '}
                для <strong>{confirm.user.email}</strong>?
              </p>
              {confirm.opt.plan !== 'trial' && (
                <p className="au-modal-expires">
                  Доступ до: {computeExpiresAt(confirm.opt.plan, confirm.opt.months)}
                </p>
              )}
              {confirm.opt.plan === 'trial' && (
                <p className="au-modal-expires" style={{ color: '#ef4444' }}>
                  Тариф будет сброшен до триала. Доступ к платным функциям закроется.
                </p>
              )}
            </div>
            <div className="au-modal-actions">
              <button className="au-modal-cancel" onClick={() => setConfirm(null)} disabled={applying}>
                Отмена
              </button>
              <button className="au-modal-confirm" onClick={handleConfirm} disabled={applying}>
                {applying ? 'Применяется...' : 'Активировать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
