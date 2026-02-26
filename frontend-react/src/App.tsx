import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AutomationPanel } from './components/AutomationPanel';
import { PlatformPanel } from './components/PlatformPanel';
import { EventLog } from './components/EventLog';
import { Workspace } from './components/Workspace';
import { postPlatformDraft, postWebhook } from './lib/api';
import {
  sendMagicLink,
  verifyMagicToken,
  getStoredUser,
  setStoredToken,
  clearStoredAuth,
  BACKEND_URL,
} from './lib/backendApi';
import {
  appendAutomationLog,
  clearAutomationLog,
  exportLearningMap,
  getAutomationLog,
  getAutomationSettings,
  getPlatformSettings,
  importLearningMap,
  setAutomationSettings,
  setPlatformSettings
} from './lib/storage';
import type { AutomationSettings, PlatformIntegrationSettings } from './types/schemas';

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
  const [automationSettings, setAutomationState] = useState<AutomationSettings>(getAutomationSettings());
  const [platformSettings, setPlatformState] = useState<PlatformIntegrationSettings>(getPlatformSettings());
  const [refreshTick, setRefreshTick] = useState(0);

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
        law: '44-FZ',
        profile: platformSettings.profile,
        organization: platformSettings.orgName,
        customerInn: platformSettings.customerInn,
        items: []
      };
      return postPlatformDraft(platformSettings.endpoint, platformSettings.apiToken, payload);
    },
    onSuccess: () => setRefreshTick((x) => x + 1)
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

  // ── Auth bar styles ──────────────────────────────────────────────────────
  const authBarStyle: React.CSSProperties = {
    position: 'fixed', top: 0, right: 0, zIndex: 1000,
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 16px',
    background: 'rgba(15, 23, 42, 0.9)',
    borderBottomLeftRadius: 8,
    fontSize: 13, color: '#CBD5E1',
  };

  const loginPanelStyle: React.CSSProperties = {
    position: 'fixed', top: 40, right: 0, zIndex: 999,
    background: '#1E293B', border: '1px solid #334155',
    borderRadius: '0 0 0 8px', padding: 20, width: 280,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  };

  return (
    <main className="layout">
      {/* Auth message toast */}
      {authMsg && (
        <div style={{
          position: 'fixed', top: 48, right: 16, zIndex: 9999,
          background: authMsg.startsWith('✅') ? '#065F46' : '#7F1D1D',
          color: '#fff', padding: '10px 18px', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)', fontSize: 14,
        }}>
          {authMsg}
        </div>
      )}

      {/* Auth bar — top right */}
      {BACKEND_URL && (
        <div style={authBarStyle}>
          {backendUser ? (
            <>
              <span style={{ color: '#94A3B8', fontSize: 12 }}>
                👤 {backendUser.email}
              </span>
              <span style={{
                fontSize: 11, padding: '2px 6px', borderRadius: 4,
                background: backendUser.role === 'admin' ? '#7C3AED' : backendUser.role === 'pro' ? '#059669' : '#374151',
                color: '#fff',
              }}>
                {backendUser.role === 'admin' ? 'Admin' : backendUser.role === 'pro' ? 'Pro' : `Free (${backendUser.tz_count}/${backendUser.tz_limit})`}
              </span>
              <button
                onClick={handleLogout}
                style={{ background: 'transparent', border: '1px solid #475569', color: '#94A3B8', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
              >
                Выйти
              </button>
            </>
          ) : (
            <>
              <span style={{ color: '#94A3B8', fontSize: 12 }}>🔒 Войдите для Pro-функций</span>
              <button
                onClick={() => setShowLogin((x) => !x)}
                style={{ background: '#1F5C8B', border: 'none', color: '#fff', padding: '3px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
              >
                Войти
              </button>
            </>
          )}
        </div>
      )}

      {/* Login panel */}
      {showLogin && !backendUser && BACKEND_URL && (
        <div style={loginPanelStyle}>
          <h3 style={{ margin: '0 0 12px', color: '#E2E8F0', fontSize: 15 }}>Вход по ссылке в email</h3>
          {loginSent ? (
            <div style={{ color: '#86EFAC', fontSize: 13 }}>
              ✅ Письмо отправлено на <strong>{loginEmail}</strong>.<br />
              <span style={{ color: '#94A3B8' }}>Нажмите ссылку в письме для входа.</span>
              <br /><br />
              <button
                onClick={() => { setLoginSent(false); setLoginEmail(''); }}
                style={{ background: 'transparent', border: '1px solid #475569', color: '#94A3B8', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
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
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 6, border: '1px solid #475569', background: '#0F172A', color: '#E2E8F0', fontSize: 13, marginBottom: 8 }}
              />
              {loginError && <div style={{ color: '#FCA5A5', fontSize: 12, marginBottom: 6 }}>{loginError}</div>}
              <button
                onClick={handleSendLink}
                disabled={loginLoading || !loginEmail.trim()}
                style={{ width: '100%', background: '#1F5C8B', border: 'none', color: '#fff', padding: '8px 0', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
              >
                {loginLoading ? '⏳ Отправка...' : 'Отправить ссылку для входа'}
              </button>
              <p style={{ color: '#64748B', fontSize: 11, marginTop: 8, marginBottom: 0 }}>
                Ссылка действует 30 минут. Пароль не требуется.
              </p>
            </>
          )}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #334155', color: '#64748B', fontSize: 11 }}>
            💎 <strong style={{ color: '#94A3B8' }}>Pro план — 1500 ₽/мес:</strong><br />
            • Безлимитные ТЗ<br />
            • Поиск в интернете (реальные характеристики)<br />
            • Поиск в ЕИС (готовые ТЗ из zakupki.gov.ru)<br />
            • Не нужен собственный API-ключ
          </div>
        </div>
      )}

      <div className="bg-layer" aria-hidden="true">
        <span className="orb orb-1"></span>
        <span className="orb orb-2"></span>
        <span className="orb orb-3"></span>
      </div>

      <header className="hero">
        <span className="hero-chip">44/223-ФЗ</span>
        <h1>Генератор ТЗ</h1>
        <p>Премиальная рабочая среда закупок: спецификации, КТРУ/ОКПД2 и контроль комплаенса.</p>
      </header>

      <AutomationPanel
        value={automationSettings}
        onSave={handleSaveAutomation}
        onSendTest={async () => {
          await webhookMutation.mutateAsync();
        }}
        onAutopilot={async () => {
          appendAutomationLog({ at: new Date().toISOString(), event: 'autopilot.requested', ok: true });
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
            law: platformSettings.profile === 'eis_223' ? '223-FZ' : '44-FZ',
            organization: platformSettings.orgName,
            customerInn: platformSettings.customerInn,
            items: []
          };
          download(`procurement_pack_${Date.now()}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
          appendAutomationLog({ at: new Date().toISOString(), event: 'platform.export', ok: true });
          setRefreshTick((x) => x + 1);
        }}
      />

      <Workspace
        automationSettings={automationSettings}
        platformSettings={platformSettings}
        backendUser={backendUser}
      />

      <EventLog
        events={events}
        onClear={() => {
          clearAutomationLog();
          setRefreshTick((x) => x + 1);
        }}
      />
    </main>
  );
}
