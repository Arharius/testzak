import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AutomationPanel } from './components/AutomationPanel';
import { EnterprisePanel } from './components/EnterprisePanel';
import { PlatformPanel } from './components/PlatformPanel';
import { EventLog } from './components/EventLog';
import { Workspace } from './components/Workspace';
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
  verifyMagicToken,
  getStoredUser,
  setStoredToken,
  clearStoredAuth,
  isBackendApiAvailable,
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

  // ── Handle magic link from URL on load ──────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const magicToken = params.get('magic');
    if (magicToken) {
      // Remove token from URL
      params.delete('magic');
      const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.replaceState({}, '', newUrl);
      // Verify token
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
    }
  }, []);

  useEffect(() => {
    const onLogUpdated = () => setRefreshTick((x) => x + 1);
    window.addEventListener('tz:automation-log-updated', onLogUpdated as EventListener);
    return () => window.removeEventListener('tz:automation-log-updated', onLogUpdated as EventListener);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem('tz_ui_theme', theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const handleSendLink = async () => {
    if (!loginEmail.trim()) return;
    setLoginLoading(true);
    setLoginError('');
    try {
      await sendMagicLink(loginEmail.trim());
      setLoginSent(true);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Ошибка отправки');
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
        : `Free (${backendUser.tz_count}/${backendUser.tz_limit})`)
    : '';

  const themeNote = theme === 'contrast'
    ? {
      label: 'Amber Pulse',
      title: 'Контрастный режим для интенсивной работы',
      description: 'Тот же функционал проекта с акцентом на янтарно-киановую палитру, более яркие маркеры состояния и повышенную читаемость рабочих блоков.',
    }
    : {
      label: 'Sapphire Sovereign',
      title: 'Тихий интерфейс для тяжёлых закупочных задач',
      description: 'Оставили текущую бизнес-логику проекта и компоненты, но перевели оболочку в более “классический” premium-стиль с акцентом на рабочую область.',
    };

  return (
    <main className="layout sovereign-layout">
      {/* Auth message toast */}
      {authMsg && (
        <div className={`auth-toast ${authMsg.startsWith('✅') ? 'ok' : 'err'}`}>
          {authMsg}
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
              <span className={`auth-badge ${backendUser.role === 'admin' ? 'admin' : backendUser.role === 'pro' ? 'pro' : 'free'}`}>
                {backendTierLabel}
              </span>
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
        >
          Классика
        </button>
        <button
          type="button"
          className={`theme-btn ${theme === 'contrast' ? 'is-active' : ''}`}
          onClick={() => setTheme('contrast')}
          aria-pressed={theme === 'contrast'}
        >
          Янтарь
        </button>
      </div>

      {/* Login panel */}
      {showLogin && !backendUser && backendAvailable && (
        <div className="auth-popover">
          <div className="auth-popover-head">
            <div>
              <div className="micro-label">Авторизация</div>
              <h3>Вход по ссылке в email</h3>
            </div>
            <span className="auth-popover-mark">DeepSeek</span>
          </div>
          {loginSent ? (
            <div className="auth-success">
              ✅ Письмо отправлено на <strong>{loginEmail}</strong>.<br />
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
                {loginLoading ? '⏳ Отправка...' : 'Отправить ссылку для входа'}
              </button>
              <p className="auth-hint">
                Ссылка действует 30 минут. Пароль не требуется.
              </p>
            </>
          )}
          <div className="auth-pro-box">
            <div className="micro-label">Pro доступ</div>
            <strong>Pro план — 1500 ₽/мес</strong><br />
            • Безлимитные ТЗ<br />
            • Поиск в интернете (реальные характеристики)<br />
            • Поиск в ЕИС (готовые ТЗ из zakupki.gov.ru)<br />
            • Не нужен собственный API-ключ
          </div>
        </div>
      )}

      <div className="bg-layer" aria-hidden="true">
        <span className="noise"></span>
        <span className="orb orb-1"></span>
        <span className="orb orb-2"></span>
        <span className="orb orb-3"></span>
        <span className="orb orb-4"></span>
      </div>

      <header className="hero sovereign-hero section-fade section-delay-0">
        <div className="hero-spine" aria-hidden="true"></div>
        <span className="hero-chip">44/223-ФЗ • Sovereign Workflow</span>
        <h1>Генератор ТЗ</h1>
        <p>Премиальная рабочая среда закупок: спецификации, КТРУ/ОКПД2, поиск по интернету и ЕИС, комплаенс-контроль.</p>
        <div className="hero-metrics">
          <div className="hero-metric">
            <span className="hero-metric-label">режим</span>
            <strong>{backendAvailable ? 'Hybrid' : 'Local'}</strong>
          </div>
          <div className="hero-metric">
            <span className="hero-metric-label">auth</span>
            <strong>{backendUser ? 'Signed In' : 'Guest'}</strong>
          </div>
          <div className="hero-metric">
            <span className="hero-metric-label">pipeline</span>
            <strong>Specs / EIS / Export</strong>
          </div>
        </div>
      </header>

      <section className="sov-note section-fade section-delay-1">
        <div>
          <div className="micro-label">{themeNote.label}</div>
          <h2>{themeNote.title}</h2>
          <p>{themeNote.description}</p>
        </div>
        <div className="sov-note-tags" aria-label="Возможности">
          <span>DeepSeek / OpenRouter / Groq</span>
          <span>ЕИС / 44-ФЗ / 223-ФЗ</span>
          <span>DOCX / PDF / JSON</span>
        </div>
      </section>

      <div className="section-fade section-delay-2">
        <Workspace
          automationSettings={automationSettings}
          platformSettings={platformSettings}
          enterpriseSettings={enterpriseSettings}
          backendUser={backendUser}
        />
      </div>

      <section className="sov-block section-fade section-delay-3">
        <div className="sov-block-head">
          <div>
            <div className="micro-label">Control Layer</div>
            <h2>Интеграции и автоматизация</h2>
          </div>
        </div>
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

      <section className="sov-block section-fade section-delay-4">
        <div className="sov-block-head">
          <div>
            <div className="micro-label">Telemetry</div>
            <h2>Журнал автоматизации</h2>
          </div>
        </div>
        <EventLog
          events={events}
          onClear={() => {
            clearAutomationLog();
            setRefreshTick((x) => x + 1);
          }}
        />
      </section>
    </main>
  );
}
