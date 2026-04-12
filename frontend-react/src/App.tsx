import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AutomationPanel } from './components/AutomationPanel';
import { EnterprisePanel } from './components/EnterprisePanel';
import { PlatformPanel } from './components/PlatformPanel';
import { EventLog } from './components/EventLog';
import { RuntimeStatusPanel } from './components/RuntimeStatusPanel';
import { Workspace } from './components/Workspace';
import { PricingModal } from './components/PricingModal';
import { LLMProviderModal } from './components/LLMProviderModal';
import { TrialBanner } from './components/TrialBanner';
import { PricingPage } from './components/PricingPage';
import { HistoryPage } from './components/HistoryPage';
import { OnboardingModal } from './components/OnboardingModal';
import { PaymentSuccessPage } from './components/PaymentSuccessPage';
import { PilotFeedbackModal } from './components/PilotFeedbackModal';
import AdminUsersPage from './components/AdminUsersPage';
import { submitPilotFeedback } from './lib/backendApi';
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
  getLlmProviderSetting,
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
      return stored === 'sapphire' ? 'sapphire' : 'contrast';
    } catch {
      return 'contrast';
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
  const [currentPage, setCurrentPage] = useState<'main' | 'pricing' | 'history' | 'payment-success' | 'admin'>(() => {
    const path = window.location.pathname;
    if (path === '/pricing') return 'pricing';
    if (path === '/payment/success') return 'payment-success';
    return 'main';
  });
  const [showLLMModal, setShowLLMModal] = useState(false);
  const [preferredProvider, setPreferredProvider] = useState<string>('deepseek');
  const [preferredModel, setPreferredModel] = useState<string>('deepseek-chat');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showPilotFeedback, setShowPilotFeedback] = useState(false);

  // ── Biweekly pilot feedback prompt ───────────────────────────────────────
  useEffect(() => {
    if (!backendUser) return;
    const plan: string = (backendUser as { plan?: string }).plan ?? '';
    if (plan !== 'pilot') return;
    const STORAGE_KEY = 'pilot_feedback_last_shown';
    const last = parseInt(localStorage.getItem(STORAGE_KEY) ?? '0', 10);
    const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
    if (Date.now() - last > TWO_WEEKS_MS) {
      const timer = setTimeout(() => {
        setShowPilotFeedback(true);
        localStorage.setItem(STORAGE_KEY, String(Date.now()));
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [backendUser]);

  // ── Sync URL with currentPage ────────────────────────────────────────────
  useEffect(() => {
    let path = '/';
    if (currentPage === 'pricing') path = '/pricing';
    else if (currentPage === 'payment-success') path = '/payment/success';
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
  }, [currentPage]);

  // ── Handle browser back/forward ─────────────────────────────────────────
  useEffect(() => {
    const handler = () => {
      const path = window.location.pathname;
      if (path === '/pricing') setCurrentPage('pricing');
      else setCurrentPage('main');
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

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

  // Load user's preferred LLM provider when logged in
  useEffect(() => {
    if (!backendUser) return;
    getLlmProviderSetting()
      .then(res => {
        if (res.effective_provider) setPreferredProvider(res.effective_provider);
        if (res.effective_model) setPreferredModel(res.effective_model);
      })
      .catch(() => {});
  }, [backendUser]);

  useEffect(() => {
    if (!backendUser) return;
    try {
      const done = localStorage.getItem('tz_onboarding_done');
      if (!done) {
        const settings = getPlatformSettings();
        if (!settings.orgName && !settings.customerInn) {
          setShowOnboarding(true);
        }
      }
    } catch { /* ignore */ }
  }, [backendUser?.email]);

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
          ? `Trial (${backendUser.trial_tz_left ?? backendUser.trial_days_left} ТЗ)`
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

  if (currentPage === 'pricing') {
    return (
      <div style={{ minHeight: '100vh', background: '#fff', color: '#111' }}>
        <PricingPage
          onBack={() => setCurrentPage('main')}
          onRegister={(_plan) => {
            setCurrentPage('main');
            setTimeout(() => setShowLogin(true), 100);
          }}
        />
      </div>
    );
  }

  if (currentPage === 'payment-success') {
    return (
      <PaymentSuccessPage
        onGoHome={() => {
          setCurrentPage('main');
          window.history.pushState({}, '', '/');
        }}
      />
    );
  }

  if (currentPage === 'admin') {
    if (!backendUser || backendUser.role !== 'admin') {
      setCurrentPage('main');
      return null;
    }
    return (
      <main className="layout sovereign-layout">
        <div className="bg-layer" aria-hidden="true">
          <span className="noise"></span>
          <span className="orb orb-1"></span>
          <span className="orb orb-2"></span>
        </div>
        <nav className="top-nav" style={{ marginBottom: 0 }}>
          <div className="top-nav-inner">
            <button className="top-nav-logo" onClick={() => setCurrentPage('main')} aria-label="На главную">
              <span className="top-nav-logo-icon" aria-hidden="true">📋</span>
              <span className="top-nav-logo-text">ТЗ-генератор</span>
            </button>
            <div className="top-nav-links">
              <button className="top-nav-link" onClick={() => setCurrentPage('main')}>Создать ТЗ</button>
              <button className="top-nav-link top-nav-link--active">Администрирование</button>
            </div>
            <div className="top-nav-user" />
          </div>
        </nav>
        <AdminUsersPage />
      </main>
    );
  }

  if (currentPage === 'history') {
    return (
      <main className="layout sovereign-layout">
        <div className="bg-layer" aria-hidden="true">
          <span className="noise"></span>
          <span className="orb orb-1"></span>
          <span className="orb orb-2"></span>
        </div>
        <HistoryPage onBack={() => setCurrentPage('main')} />
      </main>
    );
  }

  return (
    <main className="layout sovereign-layout">
      {/* Auth message toast */}
      {authMsg && (
        <div className={`auth-toast ${authMsg.startsWith('✅') ? 'ok' : 'err'}`}>
          {authMsg}
        </div>
      )}

      {/* Trial banner — new v2 component */}
      {backendUser && (
        <TrialBanner
          onGoToPricing={() => setCurrentPage('pricing')}
          refreshTick={refreshTick}
        />
      )}

      <nav className="top-nav">
        <div className="top-nav-inner">
          <button
            className="top-nav-logo"
            onClick={() => setCurrentPage('main')}
            aria-label="На главную"
          >
            <span className="top-nav-logo-icon" aria-hidden="true">📋</span>
            <span className="top-nav-logo-text">ТЗ-генератор</span>
          </button>

          <div className="top-nav-links">
            {backendUser && (
              <>
                <button
                  className={`top-nav-link ${currentPage === 'main' ? 'top-nav-link--active' : ''}`}
                  onClick={() => setCurrentPage('main')}
                >
                  Создать ТЗ
                </button>
                <button
                  className={`top-nav-link ${(currentPage as string) === 'history' ? 'top-nav-link--active' : ''}`}
                  onClick={() => setCurrentPage('history')}
                >
                  Мои ТЗ
                </button>
              </>
            )}
            {(!backendUser || backendUser.role !== 'admin') && (
              <button
                className={`top-nav-link ${(currentPage as string) === 'pricing' ? 'top-nav-link--active' : ''}`}
                onClick={() => setCurrentPage('pricing')}
              >
                Тарифы
              </button>
            )}
          </div>

          <div className="top-nav-user">
            {backendUser ? (
              <details className="user-menu">
                <summary className="user-menu-summary">
                  <span className="user-menu-name">
                    {backendUser.email.includes('@') ? backendUser.email.split('@')[0] : backendUser.email}
                  </span>
                  <span className={`user-menu-badge ${backendUser.role === 'admin' ? 'admin' : backendUser.trial_active ? 'trial' : 'pro'}`}>
                    {backendTierLabel}
                  </span>
                  <span className="user-menu-arrow" aria-hidden="true">▾</span>
                </summary>
                <div className="user-menu-dropdown">
                  <div className="user-menu-item user-menu-item--info">
                    {backendUser.email}
                  </div>
                  <div className="user-menu-divider" />
                  <button
                    className="user-menu-item"
                    onClick={() => setShowLLMModal(true)}
                  >
                    AI-провайдер
                  </button>
                  <button
                    className="user-menu-item"
                    onClick={() => setCurrentPage('history')}
                  >
                    История ТЗ
                  </button>
                  {backendUser.role === 'admin' && (
                    <>
                      <div className="user-menu-divider" />
                      <button
                        className="user-menu-item"
                        style={{ color: '#7c3aed', fontWeight: 600 }}
                        onClick={() => setCurrentPage('admin')}
                      >
                        ⚙️ Администрирование
                      </button>
                    </>
                  )}
                  <div className="user-menu-divider" />
                  <button
                    className="user-menu-item user-menu-item--theme"
                    onClick={() => setTheme(theme === 'contrast' ? 'sapphire' : 'contrast')}
                  >
                    {theme === 'contrast' ? '🌙 Тёмная тема' : '☀️ Светлая тема'}
                  </button>
                  <div className="user-menu-divider" />
                  <button
                    className="user-menu-item user-menu-item--danger"
                    onClick={handleLogout}
                  >
                    Выйти
                  </button>
                </div>
              </details>
            ) : (
              <button
                className="top-nav-btn top-nav-btn--primary"
                onClick={() => setShowLogin((x) => !x)}
              >
                {showLogin ? 'Закрыть' : 'Войти'}
              </button>
            )}
          </div>
        </div>
      </nav>

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

      {/* LLM provider modal */}
      {showLLMModal && backendUser && (
        <LLMProviderModal
          onClose={() => setShowLLMModal(false)}
          onSaved={(p, m) => {
            setPreferredProvider(p);
            setPreferredModel(m);
            setShowLLMModal(false);
          }}
        />
      )}

      {/* Pricing modal */}
      {showPricing && backendUser && (
        <PricingModal
          onClose={() => setShowPricing(false)}
          currentRole={backendUser.role}
          trialActive={backendUser.trial_active}
          trialTzLeft={backendUser.trial_tz_left}
          trialTzTotal={backendUser.trial_tz_total}
          tzCount={backendUser.tz_count}
        />
      )}

      <div className="bg-layer" aria-hidden="true">
        <span className="noise"></span>
        <span className="orb orb-1"></span>
        <span className="orb orb-2"></span>
        <span className="orb orb-3"></span>
        <span className="orb orb-4"></span>
      </div>

      {!backendUser && (<>
      <header className="hero sovereign-hero section-fade section-delay-0">
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="hero-spine" aria-hidden="true"></div>
            <span className="hero-chip">44-ФЗ · 223-ФЗ · ПП №1875 · Проверка ФАС</span>
            <h1>Техническое задание за&nbsp;3&nbsp;минуты</h1>
            <p>Укажите товар или загрузите список — система сформирует готовый DOCX с характеристиками, проверит конкуренцию и устранит ФАС-риски.</p>
            <div className="hero-proof">
              <span>Импорт DOCX / XLSX</span>
              <span>Проверка конкуренции</span>
              <span>Проверка характеристик</span>
              <span>Готовый документ</span>
            </div>
            {!backendUser && (
              <div className="hero-cta-row">
                <button
                  className="hero-cta-btn"
                  onClick={() => setShowLogin((x) => !x)}
                >
                  Попробовать бесплатно →
                </button>
                <span className="hero-cta-note">3 ТЗ без оплаты · Регистрация не нужна</span>
              </div>
            )}
            {backendUser && (
              <div className="hero-cta-row">
                <button
                  className="hero-cta-btn hero-cta-btn--secondary"
                  onClick={() => setShowLLMModal(true)}
                  title="Сменить AI-провайдер"
                >
                  AI: {preferredProvider === 'gigachat' ? 'GigaChat' :
                       preferredProvider === 'openrouter' ? 'OpenRouter' :
                       preferredProvider === 'groq' ? 'Groq' : 'DeepSeek'}
                </button>
              </div>
            )}
          </div>
          <div className="hero-metrics">
            <div className="hero-metric">
              <span className="hero-metric-label">Закон</span>
              <strong>44-ФЗ / 223-ФЗ</strong>
            </div>
            <div className="hero-metric">
              <span className="hero-metric-label">Проверка конкуренции</span>
              <strong className="hero-metric-accent">Активна</strong>
            </div>
            <div className="hero-metric">
              <span className="hero-metric-label">Формат</span>
              <strong className="hero-metric-accent">DOCX / PDF</strong>
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
            <div className="feature-card-icon feature-card-icon--blue">⚖️</div>
            <div className="feature-card-body">
              <div className="feature-card-title">Проверка конкуренции</div>
              <div className="feature-card-desc">Алгоритм автоматически проверяет, что ТЗ не ограничивает конкуренцию — находит ≥2 производителей, соответствующих требованиям.</div>
            </div>
          </div>
          <div className="feature-card">
            <div className="feature-card-icon feature-card-icon--indigo">🔎</div>
            <div className="feature-card-body">
              <div className="feature-card-title">Проверка характеристик</div>
              <div className="feature-card-desc">Система сверяет технические параметры с официальными данными производителей и отмечает расхождения для устранения ФАС-рисков.</div>
            </div>
          </div>
          <div className="feature-card">
            <div className="feature-card-icon feature-card-icon--green">📄</div>
            <div className="feature-card-body">
              <div className="feature-card-title">Готовый документ</div>
              <div className="feature-card-desc">На выходе — DOCX и PDF, готовые к размещению в ЕИС. Только измеримые параметры, корректное форматирование, все разделы по закону.</div>
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
          <p className="how-it-works-sub">Четыре шага от пустого листа до готового документа</p>
        </div>
        <div className="how-steps-grid">
          <div className="how-step">
            <div className="how-step-num">01</div>
            <div className="how-step-body">
              <div className="how-step-title">Добавьте товары или загрузите список</div>
              <div className="how-step-desc">Импортируйте DOCX/XLSX с позициями закупки или выберите товары из каталога вручную.</div>
            </div>
          </div>
          <div className="how-step">
            <div className="how-step-num">02</div>
            <div className="how-step-body">
              <div className="how-step-title">ИИ подбирает технические характеристики</div>
              <div className="how-step-desc">Система заполняет измеримые параметры для каждой позиции и проверяет их по открытым источникам.</div>
            </div>
          </div>
          <div className="how-step">
            <div className="how-step-num">03</div>
            <div className="how-step-body">
              <div className="how-step-title">Проверяем соответствие 44-ФЗ и отсутствие ФАС-рисков</div>
              <div className="how-step-desc">Алгоритм проверяет конкуренцию и выявляет нарушения требований закупочного законодательства.</div>
            </div>
          </div>
          <div className="how-step">
            <div className="how-step-num">04</div>
            <div className="how-step-body">
              <div className="how-step-title">Скачайте готовый DOCX для ЕИС</div>
              <div className="how-step-desc">Финальный документ с корректным форматированием, готовый к публикации в Единой информационной системе.</div>
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
              <strong>Проверка конкуренции — автоматически</strong>
              <span>Система гарантирует, что ≥2 производителя соответствуют ТЗ, без ручной проверки.</span>
            </div>
          </div>
          <div className="why-us-item">
            <div className="why-us-check"></div>
            <div>
              <strong>Проверка характеристик по источникам</strong>
              <span>ИИ сверяет значения с официальными данными производителей и помечает расхождения.</span>
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
              <strong>Только измеримые параметры в документе</strong>
              <span>В DOCX попадают только проверяемые при приёмке значения — без размытых формулировок.</span>
            </div>
          </div>
          <div className="why-us-item">
            <div className="why-us-check"></div>
            <div>
              <strong>Полная история документов</strong>
              <span>Все созданные ТЗ сохраняются и доступны в любой момент для повторного использования.</span>
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
      </>)}

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
          preferredProvider={preferredProvider as 'deepseek' | 'openrouter' | 'groq' | 'gigachat'}
          preferredModel={preferredModel}
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

      {showOnboarding && (
        <OnboardingModal onClose={() => setShowOnboarding(false)} />
      )}

      {showPilotFeedback && backendUser && (
        <PilotFeedbackModal
          onClose={() => setShowPilotFeedback(false)}
          onSubmit={async (answers) => {
            await submitPilotFeedback(answers);
            setShowPilotFeedback(false);
          }}
        />
      )}
    </main>
  );
}
