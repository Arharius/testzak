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
  queueSize: number;
  onFlushQueue: () => Promise<void>;
  flushPending?: boolean;
};

export function AutomationPanel({
  value,
  onSave,
  onSendTest,
  onAutopilot,
  onExportLearning,
  onImportLearning,
  queueSize,
  onFlushQueue,
  flushPending,
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
          Секрет
          <input {...form.register('webhookSecret')} placeholder="X-TZ-Secret" />
        </label>
        <label>
          Бэкенд API URL
          <input {...form.register('backendApiBase')} placeholder="(пусто = текущий /api)" />
        </label>
        <label>
          Бэкенд API токен
          <input {...form.register('backendApiToken')} placeholder="token (можно с Bearer)" />
        </label>
      </div>
      <div className="muted">По умолчанию можно оставить пусто: отправка пойдёт через `current-domain/api`.</div>
      <div className="muted">Очередь событий: {queueSize}</div>
      <div className="checks">
        <label><input type="checkbox" {...form.register('autoSend')} /> Автоотправка webhook после генерации</label>
        <label><input type="checkbox" {...form.register('autopilot')} /> Режим автопилота</label>
        <label><input type="checkbox" {...form.register('autoPickTopCandidate')} /> Автовыбор лучшего варианта</label>
        <label><input type="checkbox" {...form.register('useBackendQueueApi')} /> Отправка событий через API очереди</label>
      </div>
      <div className="actions">
        <button onClick={form.handleSubmit(onSave)} type="button">Сохранить настройки</button>
        <button onClick={() => void onSendTest()} type="button">Проверить webhook</button>
        <button onClick={() => void onAutopilot()} type="button">Запустить автопилот</button>
        <button onClick={onExportLearning} type="button">Экспорт обучения</button>
        <button onClick={onImportLearning} type="button">Импорт обучения</button>
        <button onClick={() => void onFlushQueue()} type="button" disabled={flushPending}>
          {flushPending ? 'Повтор...' : 'Повторить очередь'}
        </button>
      </div>
    </section>
  );
}
