import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  automationSettingsSchema,
  type AutomationSettings
} from '../types/schemas';

type Props = {
  value: AutomationSettings;
  onSave: (next: AutomationSettings) => void;
  onSendTest: () => Promise<void>;
  onAutopilot: () => Promise<void>;
  onExportLearning: () => void;
  onImportLearning: () => void;
};

export function AutomationPanel({
  value,
  onSave,
  onSendTest,
  onAutopilot,
  onExportLearning,
  onImportLearning
}: Props) {
  const form = useForm<AutomationSettings>({
    resolver: zodResolver(automationSettingsSchema),
    defaultValues: value,
    values: value
  });

  return (
    <section className="panel">
      <h2>Automation and Training</h2>
      <div className="grid two">
        <label>
          Webhook URL
          <input {...form.register('webhookUrl')} placeholder="https://hooks.example.com/flow" />
        </label>
        <label>
          Secret
          <input {...form.register('webhookSecret')} placeholder="X-TZ-Secret" />
        </label>
        <label>
          Backend API base
          <input {...form.register('backendApiBase')} placeholder="https://api.example.com" />
        </label>
        <label>
          Backend API token
          <input {...form.register('backendApiToken')} placeholder="Bearer token" />
        </label>
      </div>
      <div className="checks">
        <label><input type="checkbox" {...form.register('autoSend')} /> auto send webhook after generation</label>
        <label><input type="checkbox" {...form.register('autopilot')} /> autopilot mode</label>
        <label><input type="checkbox" {...form.register('autoPickTopCandidate')} /> auto pick top candidate</label>
        <label><input type="checkbox" {...form.register('useBackendQueueApi')} /> send events via backend queue API</label>
      </div>
      <div className="actions">
        <button onClick={form.handleSubmit(onSave)} type="button">save settings</button>
        <button onClick={() => void onSendTest()} type="button">test webhook</button>
        <button onClick={() => void onAutopilot()} type="button">run autopilot</button>
        <button onClick={onExportLearning} type="button">export learning</button>
        <button onClick={onImportLearning} type="button">import learning</button>
      </div>
    </section>
  );
}
