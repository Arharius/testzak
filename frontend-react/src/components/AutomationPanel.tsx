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
      <h2>Автоматизация и обучение</h2>
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
          База Backend API
          <input {...form.register('backendApiBase')} placeholder="https://api.example.com" />
        </label>
        <label>
          Токен Backend API
          <input {...form.register('backendApiToken')} placeholder="Bearer token" />
        </label>
        <label>
          Ретраи доставки
          <input type="number" min={0} max={8} {...form.register('deliveryRetries', { valueAsNumber: true })} />
        </label>
        <label>
          Базовая пауза (мс)
          <input type="number" min={200} max={10000} step={100} {...form.register('deliveryBackoffMs', { valueAsNumber: true })} />
        </label>
        <label>
          Tenant ID
          <input {...form.register('tenantId')} placeholder="tenant-acme-001" />
        </label>
        <label>
          Валюта биллинга
          <input {...form.register('billingCurrency')} placeholder="RUB" />
        </label>
        <label>
          Цена за документ (копейки)
          <input type="number" min={0} max={500000} {...form.register('billingPricePerDocCents', { valueAsNumber: true })} />
        </label>
      </div>
      <div className="checks">
        <label><input type="checkbox" {...form.register('autoSend')} /> Автоотправка webhook после генерации</label>
        <label><input type="checkbox" {...form.register('autopilot')} /> Режим автопилота</label>
        <label><input type="checkbox" {...form.register('autoPickTopCandidate')} /> Автовыбор лучшего кандидата</label>
        <label><input type="checkbox" {...form.register('useBackendQueueApi')} /> Отправка событий через очередь Backend API</label>
        <label><input type="checkbox" {...form.register('requireHttpsForIntegrations')} /> Требовать HTTPS для внешних интеграций (кроме localhost)</label>
        <label><input type="checkbox" {...form.register('billingEnabled')} /> Включить billing telemetry (usage события)</label>
      </div>
      <div className="actions">
        <button onClick={form.handleSubmit(onSave)} type="button">Сохранить настройки</button>
        <button onClick={() => void onSendTest()} type="button">Тест webhook</button>
        <button onClick={() => void onAutopilot()} type="button">Запустить автопилот</button>
        <button onClick={onExportLearning} type="button">Экспорт обучения</button>
        <button onClick={onImportLearning} type="button">Импорт обучения</button>
      </div>
    </section>
  );
}
