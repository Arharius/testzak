import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AutomationPanel } from './components/AutomationPanel';
import { EnterprisePanel } from './components/EnterprisePanel';
import { PlatformPanel } from './components/PlatformPanel';
import { EventLog } from './components/EventLog';
import { RuntimeStatusPanel } from './components/RuntimeStatusPanel';
import { Workspace } from './components/Workspace';
import { PricingModal } from './components/PricingModal';
import {
  flushAutomationQueue,
  flushPlatformQueue,
  getAutomationQueueSize,
  getPlatformQueueSize,
  postPlatformDraft,
  postWebhook,
} from './lib/api';
import {
  sendMagicLink,
  getMe,
  getStoredToken,
  loginWithPassword,
  verifyMagicToken,
  getStoredUser,
  isLoggedIn,
  setStoredToken,
  clearStoredAuth,
  isBackendApiAvailable,
  getBackendHealth,
  getBackendReadiness,
} from './lib/backendApi';
import {
  appendAutomationLog,
  appendImmutableAudit,
  clearAutomationLog,
  exportLearningMap,
  getAutomationLog,
  getAutomationSettings,
  getEnterpriseSettings,
  getPlatformSettings,
  importLearningMap,
  setAutomationSettings,
  setEnterpriseSettings,
  setPlatformSettings
} from './lib/storage';
import type { AutomationSettings, EnterpriseSettings, PlatformIntegrationSettings } from './types/schemas';

type UiTheme = 'sapphire' | 'contrast';

function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const backendAvailable = isBackendApiAvailable();
  const [automationSettings, setAutomationState] = useState<AutomationSettings>(getAutomationSettings());
  const [platformSettings, setPlatformState] = useState<PlatformIntegrationSettings>(getPlatformSettings());
  const [enterpriseSettings, setEnterpriseState] = useState<EnterpriseSettings>(getEnterpriseSettings());
  const [refreshTick, setRefreshTick] = useState(0);
  const [theme, setTheme] = useState<UiTheme>(() => {
    try {
      const stored = window.localStorage.getItem('tz_ui_theme');
      return stored === 'contrast' ? 'contrast' : 'sapphire';
    } catch {
      return 'sapphire';
    }
  });

  // ── Auth state ───────────────────────────────────────────────────────────
  const [backendUser, setBackendUser] = useState(getStoredUser());
  const [loginEmail, setLoginEmail] = useState('');
  const [loginSent, setLoginSent] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [authMsg, setAuthMsg] = useState('');
  const [loginMode, setLoginMode] = useState<'email' | 'password'>('password');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPricing, setShowPricing] = useState(false);

  // ── Handle magic link or direct JWT from URL on load ────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const magicToken = params.get('magic');
    const directJwt = params.get('jwt');

    if (magicToken) {
      params.delete('magic');
      const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.replaceState({}, '', newUrl);
      verifyMagicToken(magicToken)
        .then((res) => {
          setStoredToken(res.token, res.user);
          setBackendUser(res.user);
          setAuthMsg(`✅ Вход выполнен: ${res.user.email}`);
          setTimeout(() => setAuthMsg(''), 4000);
        })
        .catch((err) => {
          setAuthMsg(`❌ Ошибка входа: ${err.message}`);
          setTimeout(() => setAuthMsg(''), 6000);
        });
    } else if (directJwt) {
      params.delete('jwt');
      const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.replaceState({}, '', newUrl);
      getMe(directJwt)
        .then((user) => {
          setStoredToken(directJwt, user);
          setBackendUser(user);
          setAuthMsg(`✅ Вход выполнен: ${user.email}`);
          setTimeout(() => setAuthMsg(''), 4000);
        })
        .catch((err) => {
          setAuthMsg(`❌ Ошибка входа: ${err.message}`);
          setTimeout(() => setAuthMsg(''), 6000);
        });
    }
  }, []);

  useEffect(() => {
    if (!backendAvailable) return;
    if (!isLoggedIn()) {
      if (backendUser) {
        clearStoredAuth();
        setBackendUser(null);
      }
      return;
    }
    let cancelled = false;
    getMe()
      .then((user) => {
        if (cancelled) return;
        const token = getStoredToken();
        if (token) setStoredToken(token, user);
        setBackendUser(user);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message.toLowerCase() : '';
        if (/401|403|авторизац|unauthorized|forbidden/.test(message)) {
          clearStoredAuth();
          setBackendUser(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [backendAvailable]);

  useEffect(() => {
    const onLogUpdated = () => setRefreshTick((x) => x + 1);
    window.addEventListener('tz:automation-log-updated', onLogUpdated as EventListener);
    return () => window.removeEventListener('tz:automation-log-updated', onLogUpdated as EventListener);
  }, []);

  // Listen for pricing modal open event from Workspace
  useEffect(() => {
    const onOpenPricing = () => setShowPricing(true);
    window.addEventListener('tz:open-pricing', onOpenPricing);
    return () => window.removeEventListener('tz:open-pricing', onOpenPricing);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem('tz_ui_theme', theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  useEffect(() => {
    const ignoreNoise = (message: string) => /ResizeObserver|favicon|apple-touch-icon|AbortError/i.test(message);
    const persistClientRuntimeEvent = (event: string, message: string) => {
      if (!message || ignoreNoise(message)) return;
      appendAutomationLog({
        at: new Date().toISOString(),
        event,
        ok: false,
        note: message.slice(0, 220),
      });
    };
    const onWindowError = (e: ErrorEvent) => {
      persistClientRuntimeEvent('frontend.runtime_error', e.message || String(e.error || 'window_error'));
    };
    const onUnhandledRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason instanceof Error ? e.reason.message : String(e.reason || 'unhandled_rejection');
      persistClientRuntimeEvent('frontend.unhandled_rejection', reason);
    };
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  const backendHealthQuery = useQuery({
    queryKey: ['backend-health'],
    queryFn: getBackendHealth,
    enabled: backendAvailable,
    staleTime: 20_000,
    refetchInterval: 45_000,
    retry: 1,
  });

  const backendReadinessQuery = useQuery({
    queryKey: ['backend-readiness'],
    queryFn: getBackendReadiness,
    enabled: backendAvailable,
    staleTime: 20_000,
    refetchInterval: 45_000,
    retry: 1,
  });

  const handleSendLink = async () => {
    if (!loginEmail.trim()) return;
    setLoginLoading(true);
    setLoginError('');
    try {
      const res = await sendMagicLink(loginEmail.trim());
      if (res.magic_link) {
        window.location.href = res.magic_link;
        return;
      }
      setLoginSent(true);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setLoginLoading(false);
    }
  };

  const handlePasswordLogin = async () => {
    if (!loginUsername.trim() || !loginPassword.trim()) return;
    setLoginLoading(true);
    setLoginError('');
    try {
      const res = await loginWithPassword(loginUsername.trim(), loginPassword.trim());
      setStoredToken(res.token, res.user);
      setBackendUser(res.user);
      setShowLogin(false);
      setLoginUsername('');
      setLoginPassword('');
      setAuthMsg(`Vhod vypolnen: ${res.user.email} (${res.user.role})`);
      setTimeout(() => setAuthMsg(''), 4000);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Ошибка входа');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    clearStoredAuth();
    setBackendUser(null);
    setShowLogin(false);
  };

  const events = useMemo(() => getAutomationLog(), [refreshTick]);
  const queueStats = useMemo(() => ({
    automation: getAutomationQueueSize(),
    platform: getPlatformQueueSize(),
  }), [refreshTick]);

  const webhookMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        app: 'tz_generator_react',
        event: 'webhook.test',
        at: new Date().toISOString(),
        payload: { source: 'react_migration' }
      };
      return postWebhook(automationSettings.webhookUrl, automationSettings.webhookSecret, payload);
    },
    onSuccess: () => setRefreshTick((x) => x + 1)
  });

  const platformMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        app: 'tz_generator_react',
        event: 'draft.send',
        at: new Date().toISOString(),
        law: platformSettings.profile === 'eis_223' ? '223-FZ' : '44-FZ',
        profile: platformSettings.profile,
        procurementMethod: platformSettings.procurementMethod,
        organization: platformSettings.orgName,
        customerInn: platformSettings.customerInn,
        organizationProfile: platformSettings.industryPreset,
        organizationInstructions: platformSettings.organizationInstructions,
        defaultWarrantyMonths: platformSettings.defaultWarrantyMonths,
        items: []
      };
      const endpoint = platformSettings.endpoint || '/api/v1/integration/draft';
      return postPlatformDraft(endpoint, platformSettings.apiToken, payload, { profile: platformSettings.profile });
    },
    onSuccess: () => setRefreshTick((x) => x + 1)
  });

  const flushAutomationMutation = useMutation({
    mutationFn: async () => flushAutomationQueue(automationSettings),
    onSuccess: () => setRefreshTick((x) => x + 1),
  });

  const flushPlatformMutation = useMutation({
    mutationFn: async () => flushPlatformQueue(
      platformSettings.endpoint || '/api/v1/integration/draft',
      platformSettings.apiToken,
      platformSettings.profile
    ),
    onSuccess: () => setRefreshTick((x) => x + 1),
  });

  const handleSaveAutomation = (next: AutomationSettings) => {
    setAutomationState(next);
    setAutomationSettings(next);
    appendAutomationLog({ at: new Date().toISOString(), event: 'automation.settings.saved', ok: true });
    setRefreshTick((x) => x + 1);
  };

  const handleSavePlatform = (next: PlatformIntegrationSettings) => {
    setPlatformState(next);
    setPlatformSettings(next);
    appendAutomationLog({ at: new Date().toISOString(), event: 'platform.settings.saved', ok: true });
    setRefreshTick((x) => x + 1);
  };

  const handleSaveEnterprise = (next: EnterpriseSettings) => {
    setEnterpriseState(next);
    setEnterpriseSettings(next);
    appendAutomationLog({ at: new Date().toISOString(), event: 'enterprise.settings.saved', ok: true });
    if (next.immutableAudit) {
      appendImmutableAudit('enterprise.settings.saved', {
        simulationMode: next.simulationMode,
        antiFasStrictMode: next.antiFasStrictMode,
        antiFasMinScore: next.antiFasMinScore,
        deploymentMode: next.deploymentMode,
      });
    }
    setRefreshTick((x) => x + 1);
  };

  useEffect(() => {
    let running = false;
    const timer = window.setInterval(() => {
      if (running) return;
      running = true;
      (async () => {
        try {
          let touched = false;
          if (getAutomationQueueSize() > 0) {
            const result = await flushAutomationQueue(automationSettings);
            touched = touched || result.sent > 0 || result.remaining > 0;
          }
          if (platformSettings.autoFlushQueue && getPlatformQueueSize() > 0) {
            const result = await flushPlatformQueue(
              platformSettings.endpoint || '/api/v1/integration/draft',
              platformSettings.apiToken,
              platformSettings.profile
            );
            touched = touched || result.sent > 0 || result.remaining > 0;
          }
          if (touched) {
            setRefreshTick((x) => x + 1);
          }
        } finally {
          running = false;
        }
      })();
    }, 45000);
    return () => window.clearInterval(timer);
  }, [
    automationSettings,
    platformSettings.autoFlushQueue,
    platformSettings.apiToken,
    platformSettings.endpoint,
    platformSettings.profile,
  ]);

  const backendTierLabel = backendUser
    ? (backendUser.role === 'admin'
      ? 'Admin'
      : backendUser.role === 'pro'
        ? 'Pro'
        : backendUser.payment_required
          ? 'Оплата нужна'
        : backendUser.trial_active
          ? `Trial (${backendUser.trial_days_left}д)`
          : 'Trial')
    : '';

  const runtimeLabel = !backendAvailable
    ? 'Локально'
    : backendReadinessQuery.isPending
      ? 'Проверка'
      : backendReadinessQuery.isError
        ? 'Недоступен'
        : backendReadinessQuery.data?.status === 'ready'
          ? 'Готов'
        : backendReadinessQuery.data?.status === 'degraded'
          ? 'Ограничения'
          : 'Настройка';
  const runtimeDisclosureState = !backendAvailable
    ? 'Локальный режим'
    : backendReadinessQuery.isError
      ? 'Backend недоступен'
      : backendReadinessQuery.isPending
        ? 'Проверка runtime'
        : backendReadinessQuery.data?.status === 'ready'
          ? 'Контур готов'
          : backendReadinessQuery.data?.status === 'degraded'
            ? 'Есть ограничения'
            : 'Нужна настройка';

  return (
    <main className="layout sovereign-layout">
      {/* Auth message toast */}
      {authMsg && (
        <div className={`auth-toast ${authMsg.startsWith('✅') ? 'ok' : 'err'}`}>
          {authMsg}
        </div>
      )}

      {/* Trial banner — hide for admin */}
      {backendUser && backendUser.role !== 'admin' && backendUser.trial_active && backendUser.trial_days_left != null && (
        <div className="trial-banner">
          <span className="trial-banner-icon">⚡</span>
          <span className="trial-banner-text">
            PRO-trial: <strong>{backendUser.trial_days_left} {backendUser.trial_days_left === 1 ? 'день' : backendUser.trial_days_left < 5 ? 'дня' : 'дней'}</strong> осталось — полный доступ к генерации, поиску, экспорту и истории
          </span>
          <button className="trial-banner-btn" onClick={() => setShowPricing(true)}>
            Оформить Pro Business
          </button>
        </div>
      )}

      {/* Trial expired banner */}
      {backendUser && backendUser.payment_required && backendUser.trial_ends_at && backendUser.role === 'free' && (
        <div className="trial-banner trial-expired">
          <span className="trial-banner-icon">⏰</span>
          <span className="trial-banner-text">
            Пробный период завершён. Без оплаты <strong>генерация, поиск, экспорт и сохранение</strong> недоступны.
          </span>
          <button className="trial-banner-btn" onClick={() => setShowPricing(true)}>
            Оформить Pro Business — 29 900 ₽/мес
          </button>
        </div>
      )}

      {/* Auth bar — top right */}
      {backendAvailable && (
        <div className="auth-rail">
          {backendUser ? (
            <>
              <span className="auth-identity">
                <span className="auth-dot" aria-hidden="true"></span>
                {backendUser.email}
              </span>
              <span className={`auth-badge ${backendUser.role === 'admin' ? 'admin' : backendUser.role === 'pro' ? 'pro' : backendUser.trial_active ? 'trial' : 'free'}`}>
                {backendTierLabel}
              </span>
              {backendUser.role !== 'admin' && backendUser.role !== 'pro' && (
                <button
                  onClick={() => setShowPricing(true)}
                  className="auth-primary-btn"
                  style={{ padding: '4px 12px', fontSize: '12px' }}
                >
                  Pro Business
                </button>
              )}
              <button
                onClick={handleLogout}
                className="auth-ghost-btn"
              >
                Выйти
              </button>
            </>
          ) : (
            <>
              <span className="auth-identity">
                <span className="auth-dot muted" aria-hidden="true"></span>
                Войдите для Pro-функций
              </span>
              <button
                onClick={() => setShowLogin((x) => !x)}
                className="auth-primary-btn"
              >
                {showLogin ? 'Закрыть' : 'Войти'}
              </button>
            </>
          )}
        </div>
      )}

      <div className="theme-rail" role="group" aria-label="Переключение темы">
        <span className="theme-rail-label">Тема</span>
        <button
          type="button"
          className={`theme-btn ${theme === 'sapphire' ? 'is-active' : ''}`}
          onClick={() => setTheme('sapphire')}
          aria-pressed={theme === 'sapphire'}
          title="Темная тема"
        >
          Темная
        </button>
        <button
          type="button"
          className={`theme-btn ${theme === 'contrast' ? 'is-active' : ''}`}
          onClick={() => setTheme('contrast')}
          aria-pressed={theme === 'contrast'}
          title="Светлая тема"
        >
          Светлая
        </button>
      </div>

      {/* Login panel */}
      {showLogin && !backendUser && backendAvailable && (
        <div className="auth-popover">
          <div className="auth-popover-head">
            <div>
              <div className="micro-label">Авторизация</div>
              <h3>{loginMode === 'password' ? 'Вход по логину' : 'Вход по ссылке в email'}</h3>
            </div>
            <span className="auth-popover-mark">DeepSeek</span>
          </div>

          {/* Mode switcher */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <button
              onClick={() => { setLoginMode('password'); setLoginError(''); }}
              className={loginMode === 'password' ? 'auth-submit-btn' : 'auth-ghost-btn'}
              style={{ flex: 1, fontSize: '13px', padding: '6px 8px' }}
            >
              Логин/Пароль
            </button>
            <button
              onClick={() => { setLoginMode('email'); setLoginError(''); }}
              className={loginMode === 'email' ? 'auth-submit-btn' : 'auth-ghost-btn'}
              style={{ flex: 1, fontSize: '13px', padding: '6px 8px' }}
            >
              Email-ссылка
            </button>
          </div>

          {loginMode === 'password' ? (
            <>
              <input
                type="text"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && document.getElementById('pwd-input')?.focus()}
                placeholder="Логин"
                className="auth-input"
                autoComplete="username"
              />
              <input
                id="pwd-input"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePasswordLogin()}
                placeholder="Пароль"
                className="auth-input"
                style={{ marginTop: '8px' }}
                autoComplete="current-password"
              />
              {loginError && <div className="auth-error">{loginError}</div>}
              <button
                onClick={handlePasswordLogin}
                disabled={loginLoading || !loginUsername.trim() || !loginPassword.trim()}
                className="auth-submit-btn"
              >
                {loginLoading ? 'Вход...' : 'Войти'}
              </button>
            </>
          ) : loginSent ? (
            <div className="auth-success">
              Письмо отправлено на <strong>{loginEmail}</strong>.<br />
              <span className="muted">Нажмите ссылку в письме для входа.</span>
              <br /><br />
              <button
                onClick={() => { setLoginSent(false); setLoginEmail(''); }}
                className="auth-ghost-btn"
              >
                Отправить ещё раз
              </button>
            </div>
          ) : (
            <>
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendLink()}
                placeholder="your@email.ru"
                className="auth-input"
              />
              {loginError && <div className="auth-error">{loginError}</div>}
              <button
                onClick={handleSendLink}
                disabled={loginLoading || !loginEmail.trim()}
                className="auth-submit-btn"
              >
                {loginLoading ? 'Отправка...' : 'Отправить ссылку для входа'}
              </button>
              <p className="auth-hint">
                Ссылка действует 30 минут. Пароль не требуется.
              </p>
            </>
          )}
          <div className="auth-pro-box">
            <div className="micro-label">Pro доступ</div>
            <strong>Pro Business — 29 900 &#x20bd;/мес за компанию</strong><br />
            &bull; Безлимитные ТЗ<br />
            &bull; Поиск в интернете (реальные характеристики)<br />
            &bull; Поиск в ЕИС (готовые ТЗ из zakupki.gov.ru)<br />
            &bull; Не нужен собственный API-ключ<br />
            &bull; Новым аккаунтам — 14 дней полного trial
          </div>
        </div>
      )}

      {/* Pricing modal */}
      {showPricing && backendUser && (
        <PricingModal
          onClose={() => setShowPricing(false)}
          currentRole={backendUser.role}
          trialActive={backendUser.trial_active}
          trialDaysLeft={backendUser.trial_days_left}
        />
      )}

      <div className="bg-layer" aria-hidden="true">
        <span className="noise"></span>
        <span className="orb orb-1"></span>
        <span className="orb orb-2"></span>
        <span className="orb orb-3"></span>
        <span className="orb orb-4"></span>
      </div>

      <header className="hero sovereign-hero section-fade section-delay-0">
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="hero-spine" aria-hidden="true"></div>
            <span className="hero-chip">44/223-ФЗ • Двойной эквивалент • Проверка • Публикация</span>
            <h1>Закупочное ТЗ с нулевым ФАС‑риском</h1>
            <p>Генерация, верификация через Web-Truth и автоматическая проверка двойного эквивалента — всё в одном рабочем контуре. ГОСТ-совместимый DOCX без ошибок форматирования.</p>
            <div className="hero-proof">
              <span>Импорт DOCX/XLSX</span>
              <span>Двойной эквивалент</span>
              <span>ПП1875 и анти-ФАС</span>
              <span>ГОСТ DOCX</span>
            </div>
          </div>
          <div className="hero-metrics">
            <div className="hero-metric">
              <span className="hero-metric-label">режим</span>
              <strong>{backendAvailable ? 'Гибридный' : 'Локальный'}</strong>
            </div>
            <div className="hero-metric">
              <span className="hero-metric-label">ДЭ-алгоритм</span>
              <strong className="hero-metric-accent">Активен</strong>
            </div>
            <div className="hero-metric">
              <span className="hero-metric-label">ГОСТ DOCX</span>
              <strong className="hero-metric-accent">Без ошибок</strong>
            </div>
            <div className="hero-metric">
              <span className="hero-metric-label">ФАС-риск</span>
              <strong className="hero-metric-ok">Нулевой</strong>
            </div>
          </div>
        </div>
      </header>

      <section className="feature-showcase section-fade section-delay-1" aria-label="Ключевые возможности">
        <div className="feature-showcase-grid">
          <div className="feature-card">
            <div className="feature-card-icon feature-card-icon--blue">ДЭ</div>
            <div className="feature-card-body">
              <div className="feature-card-title">Двойной эквивалент</div>
              <div className="feature-card-desc">Алгоритм автоматически выявляет ≥2 конкурирующих производителей, которые соответствуют ТЗ. Устраняет ФАС-риск монополизации.</div>
            </div>
          </div>
          <div className="feature-card">
            <div className="feature-card-icon feature-card-icon--indigo">WT</div>
            <div className="feature-card-body">
              <div className="feature-card-title">Web-Truth верификация</div>
              <div className="feature-card-desc">Сравнивает характеристики из документа с официальными datasheet производителей. Конфликты выделяются с юридически безопасной рекомендацией.</div>
            </div>
          </div>
          <div className="feature-card">
            <div className="feature-card-icon feature-card-icon--green">DOC</div>
            <div className="feature-card-body">
              <div className="feature-card-title">ГОСТ-совместимый DOCX</div>
              <div className="feature-card-desc">Только измеримые параметры в финальном документе. Ширины колонок в DXA, без КТРУ/ОКПД2 в тексте, без артефактов форматирования.</div>
            </div>
          </div>
        </div>
      </section>

      <section className="stats-section section-fade section-delay-2" aria-label="Показатели эффективности">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">1 200<span className="stat-plus">+</span></div>
            <div className="stat-label">ТЗ сгенерировано</div>
            <div className="stat-sub">за последние 6 месяцев</div>
          </div>
          <div className="stat-card stat-card--green">
            <div className="stat-value">0</div>
            <div className="stat-label">жалоб ФАС</div>
            <div className="stat-sub">по документам из системы</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">≥25</div>
            <div className="stat-label">характеристик в разделе</div>
            <div className="stat-sub">измеримых и проверяемых</div>
          </div>
          <div className="stat-card stat-card--accent">
            <div className="stat-value">4 ч</div>
            <div className="stat-label">экономии на каждом ТЗ</div>
            <div className="stat-sub">вместо ручной подготовки</div>
          </div>
        </div>
      </section>

      <section className="how-it-works section-fade section-delay-2" aria-label="Как работает система">
        <div className="how-it-works-head">
          <div className="micro-label">Процесс</div>
          <h2 className="how-it-works-title">Как это работает</h2>
          <p className="how-it-works-sub">Четыре шага от пустого листа до готового юридически чистого DOCX</p>
        </div>
        <div className="how-steps-grid">
          <div className="how-step">
            <div className="how-step-num">01</div>
            <div className="how-step-body">
              <div className="how-step-title">Загрузите или введите позиции</div>
              <div className="how-step-desc">Импортируйте DOCX/XLSX с перечнем позиций или добавьте их вручную из каталога ИТ-оборудования и ПО.</div>
            </div>
          </div>
          <div className="how-step">
            <div className="how-step-num">02</div>
            <div className="how-step-body">
              <div className="how-step-title">ИИ генерирует исчерпывающие характеристики</div>
              <div className="how-step-desc">Система автоматически заполняет ≥25 измеримых параметров: MTBF, TDP, USB/Wi-Fi версии, рабочая температура, КПД блока питания.</div>
            </div>
          </div>
          <div className="how-step">
            <div className="how-step-num">03</div>
            <div className="how-step-body">
              <div className="how-step-title">ДЭ-алгоритм проверяет конкурентность</div>
              <div className="how-step-desc">Автоматически выявляет ≥2 независимых производителей. Если ТЗ «заточено» под одного — расширяет диапазоны значений до конкурентных.</div>
            </div>
          </div>
          <div className="how-step">
            <div className="how-step-num">04</div>
            <div className="how-step-body">
              <div className="how-step-title">ГОСТ DOCX готов к публикации</div>
              <div className="how-step-desc">Финальный документ: только измеримые параметры, без КТРУ/ОКПД2 в тексте, правильные ширины колонок DXA, без ошибок форматирования.</div>
            </div>
          </div>
        </div>
      </section>

      <section className="why-us section-fade section-delay-2" aria-label="Преимущества перед конкурентами">
        <div className="why-us-head">
          <div className="micro-label">Конкурентное преимущество</div>
          <h2 className="why-us-title">Почему специалисты выбирают нас</h2>
        </div>
        <div className="why-us-grid">
          <div className="why-us-item">
            <div className="why-us-check"></div>
            <div>
              <strong>Двойной эквивалент — автоматически</strong>
              <span>Единственная система, которая гарантирует ≥2 конкурирующих производителей без ручной проверки.</span>
            </div>
          </div>
          <div className="why-us-item">
            <div className="why-us-check"></div>
            <div>
              <strong>Web-Truth верификация характеристик</strong>
              <span>ИИ сверяет значения с официальными datasheet производителей и помечает расхождения.</span>
            </div>
          </div>
          <div className="why-us-item">
            <div className="why-us-check"></div>
            <div>
              <strong>ПП 1875 и национальный режим</strong>
              <span>Система автоматически определяет применимость постановления и указывает правовое основание.</span>
            </div>
          </div>
          <div className="why-us-item">
            <div className="why-us-check"></div>
            <div>
              <strong>Только измеримые параметры в DOCX</strong>
              <span>Фильтр исключает размытые формулировки: в документ попадают только верифицируемые при приёмке значения.</span>
            </div>
          </div>
          <div className="why-us-item">
            <div className="why-us-check"></div>
            <div>
              <strong>Полный аудит-трейл</strong>
              <span>Каждое действие системы логируется. Отчёт о соответствии сохраняется вместе с DOCX.</span>
            </div>
          </div>
          <div className="why-us-item">
            <div className="why-us-check"></div>
            <div>
              <strong>Импорт из DOCX/XLSX и ЕИС</strong>
              <span>Загрузите существующий перечень — система сама распознает позиции и начнёт генерацию.</span>
            </div>
          </div>
        </div>
      </section>

      {backendUser?.role === 'admin' && (
      <details className="app-disclosure section-fade section-delay-3" open>
        <summary className="app-disclosure-summary">
          <div>
            <div className="micro-label">System</div>
            <strong>Системный статус и runtime</strong>
          </div>
          <span className="app-disclosure-meta">{runtimeDisclosureState} · {runtimeLabel}</span>
        </summary>
        <RuntimeStatusPanel
          backendAvailable={backendAvailable}
          health={backendHealthQuery.data}
          readiness={backendReadinessQuery.data}
          isLoading={backendHealthQuery.isFetching || backendReadinessQuery.isFetching}
          error={
            backendReadinessQuery.error instanceof Error
              ? backendReadinessQuery.error.message
              : backendHealthQuery.error instanceof Error
                ? backendHealthQuery.error.message
                : undefined
          }
        />
      </details>
      )}

      <div className="section-fade section-delay-3">
        <Workspace
          automationSettings={automationSettings}
          platformSettings={platformSettings}
          enterpriseSettings={enterpriseSettings}
          backendUser={backendUser}
        />
      </div>

      {backendUser?.role === 'admin' && (
      <details className="app-disclosure section-fade section-delay-4">
        <summary className="app-disclosure-summary">
          <div>
            <div className="micro-label">Control Layer</div>
            <strong>Интеграции и автоматизация</strong>
          </div>
          <span className="app-disclosure-meta">automation {queueStats.automation} · platform {queueStats.platform}</span>
        </summary>
        <section className="sov-block">
          <div className="control-grid">
            <AutomationPanel
              value={automationSettings}
              onSave={handleSaveAutomation}
              onSendTest={async () => {
                await webhookMutation.mutateAsync();
              }}
              onAutopilot={async () => {
                appendAutomationLog({ at: new Date().toISOString(), event: 'autopilot.requested', ok: true });
                window.dispatchEvent(new CustomEvent('tz:autopilot:run'));
                setRefreshTick((x) => x + 1);
              }}
              onExportLearning={() => {
                const json = exportLearningMap();
                download(`learning_map_${Date.now()}.json`, json, 'application/json;charset=utf-8');
                appendAutomationLog({ at: new Date().toISOString(), event: 'learning.export', ok: true });
                setRefreshTick((x) => x + 1);
              }}
              onImportLearning={() => {
                const raw = prompt('Вставьте JSON карты обучения');
                if (!raw) return;
                const result = importLearningMap(raw);
                appendAutomationLog({
                  at: new Date().toISOString(),
                  event: 'learning.import',
                  ok: result.ok,
                  note: result.ok ? `items=${result.count}` : 'invalid_json'
                });
                setRefreshTick((x) => x + 1);
              }}
              queueSize={queueStats.automation}
              onFlushQueue={async () => {
                await flushAutomationMutation.mutateAsync();
              }}
              flushPending={flushAutomationMutation.isPending}
            />

            <PlatformPanel
              value={platformSettings}
              onSave={handleSavePlatform}
              onSendDraft={async () => {
                await platformMutation.mutateAsync();
              }}
              onExportPack={() => {
                const payload = {
                  app: 'tz_generator_react',
                  exportedAt: new Date().toISOString(),
                  profile: platformSettings.profile,
                  procurementMethod: platformSettings.procurementMethod,
                  law: platformSettings.profile === 'eis_223' ? '223-FZ' : '44-FZ',
                  organization: platformSettings.orgName,
                  customerInn: platformSettings.customerInn,
                  organizationProfile: platformSettings.industryPreset,
                  organizationInstructions: platformSettings.organizationInstructions,
                  defaultWarrantyMonths: platformSettings.defaultWarrantyMonths,
                  items: []
                };
                download(`procurement_pack_${Date.now()}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
                appendAutomationLog({ at: new Date().toISOString(), event: 'platform.export', ok: true });
                setRefreshTick((x) => x + 1);
              }}
              queueSize={queueStats.platform}
              onFlushQueue={async () => {
                await flushPlatformMutation.mutateAsync();
              }}
              flushPending={flushPlatformMutation.isPending}
            />

            <EnterprisePanel
              value={enterpriseSettings}
              onSave={handleSaveEnterprise}
            />
          </div>
        </section>
      </details>
      )}

      {backendUser?.role === 'admin' && (
      <details className="app-disclosure section-fade section-delay-4">
        <summary className="app-disclosure-summary">
          <div>
            <div className="micro-label">Telemetry</div>
            <strong>Журнал автоматизации</strong>
          </div>
          <span className="app-disclosure-meta">{events.length} событий</span>
        </summary>
        <section className="sov-block">
          <EventLog
            events={events}
            onClear={() => {
              clearAutomationLog();
              setRefreshTick((x) => x + 1);
            }}
          />
        </section>
      </details>
      )}
    </main>
  );
}
