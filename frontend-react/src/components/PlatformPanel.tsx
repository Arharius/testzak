import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  platformIntegrationSchema,
  type PlatformIntegrationSettings
} from '../types/schemas';

type Props = {
  value: PlatformIntegrationSettings;
  onSave: (next: PlatformIntegrationSettings) => void;
  onSendDraft: () => Promise<void>;
  onExportPack: () => void;
  queueSize: number;
  onFlushQueue: () => Promise<void>;
  flushPending?: boolean;
};

export function PlatformPanel({
  value,
  onSave,
  onSendDraft,
  onExportPack,
  queueSize,
  onFlushQueue,
  flushPending,
}: Props) {
  const form = useForm<PlatformIntegrationSettings>({
    resolver: zodResolver(platformIntegrationSchema),
    defaultValues: value,
    values: value
  });

  return (
    <section className="panel">
      <h2>ЕИС и электронные площадки</h2>
      <div className="grid two">
        <label>
          Профиль
          <select {...form.register('profile')}>
            <option value="eis">ЕИС 44-ФЗ</option>
            <option value="eis_223">ЕИС 223-ФЗ</option>
            <option value="sber_ast">Sber AST</option>
            <option value="rts_tender">РТС-Тендер</option>
            <option value="roseltorg">Roseltorg</option>
            <option value="etp_gpb">ЭТП ГПБ</option>
            <option value="tek_torg">ТЭК-Торг</option>
            <option value="fabrikant">Fabrikant</option>
            <option value="b2b_center">B2B-Center</option>
            <option value="custom">Пользовательский</option>
          </select>
        </label>
        <label>
          Endpoint коннектора
          <input {...form.register('endpoint')} placeholder="(пусто = текущий /api/v1/integration/draft)" />
        </label>
        <label>
          Способ закупки
          <select {...form.register('procurementMethod')}>
            <option value="auction">Аукцион</option>
            <option value="tender">Конкурс</option>
            <option value="quotation">Запрос котировок</option>
            <option value="proposal_request">Запрос предложений</option>
            <option value="single_supplier">Единственный поставщик</option>
          </select>
        </label>
        <label>
          API токен
          <input {...form.register('apiToken')} placeholder="token (можно с Bearer)" />
        </label>
        <label>
          ИНН
          <input {...form.register('customerInn')} placeholder="7700000000" />
        </label>
      </div>
      <div className="muted">Если endpoint пустой, черновик отправляется в `/api/v1/integration/draft` текущего домена.</div>
      <label>
        Организация
        <input {...form.register('orgName')} placeholder="Наименование заказчика" />
      </label>
      <div className="checks">
        <label><input type="checkbox" {...form.register('autoExport')} /> Автоэкспорт пакета после генерации</label>
        <label><input type="checkbox" {...form.register('autoSendDraft')} /> Автоотправка черновика в коннектор</label>
        <label><input type="checkbox" {...form.register('autoFlushQueue')} /> Автоповтор очереди коннектора</label>
      </div>
      <div className="muted">Очередь коннектора: {queueSize}</div>
      <div className="actions">
        <button onClick={form.handleSubmit(onSave)} type="button">Сохранить профиль</button>
        <button onClick={onExportPack} type="button">Экспорт пакета</button>
        <button onClick={() => void onSendDraft()} type="button">Отправить черновик</button>
        <button onClick={() => void onFlushQueue()} type="button" disabled={flushPending}>
          {flushPending ? 'Повтор...' : 'Повторить очередь'}
        </button>
      </div>
    </section>
  );
}
