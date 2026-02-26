import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AutomationPanel } from './components/AutomationPanel';
import { PlatformPanel } from './components/PlatformPanel';
import { EventLog } from './components/EventLog';
import { Workspace } from './components/Workspace';
import { postPlatformDraft, postWebhook } from './lib/api';
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

  return (
    <main className="layout">
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

      <Workspace automationSettings={automationSettings} platformSettings={platformSettings} />

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
