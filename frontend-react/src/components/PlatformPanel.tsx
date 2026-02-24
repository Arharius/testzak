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
};

export function PlatformPanel({ value, onSave, onSendDraft, onExportPack }: Props) {
  const form = useForm<PlatformIntegrationSettings>({
    resolver: zodResolver(platformIntegrationSchema),
    defaultValues: value,
    values: value
  });

  return (
    <section className="panel">
      <h2>ЕИС и торговые площадки</h2>
      <div className="grid two">
        <label>
          Профиль
          <select {...form.register('profile')}>
            <option value="eis">EIS 44-FZ</option>
            <option value="eis_223">EIS 223-FZ</option>
            <option value="sber_ast">Sber AST</option>
            <option value="rts_tender">RTS Tender</option>
            <option value="roseltorg">Roseltorg</option>
            <option value="etp_gpb">ETP GPB</option>
            <option value="tek_torg">TEK Torg</option>
            <option value="fabrikant">Fabrikant</option>
            <option value="b2b_center">B2B-Center</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          Endpoint коннектора
          <input {...form.register('endpoint')} placeholder="https://connector.example/api/eis/drafts" />
        </label>
        <label>
          API-токен
          <input type="password" autoComplete="new-password" {...form.register('apiToken')} placeholder="Bearer token (не хранится в браузере)" />
        </label>
        <label>
          INN
          <input {...form.register('customerInn')} placeholder="7700000000" />
        </label>
      </div>
      <label>
        Организация
        <input {...form.register('orgName')} placeholder="Наименование заказчика" />
      </label>
      <div className="checks">
        <label><input type="checkbox" {...form.register('autoExport')} /> Автоэкспорт пакета после генерации</label>
        <label><input type="checkbox" {...form.register('autoSendDraft')} /> Автоотправка черновика в коннектор</label>
      </div>
      <div className="actions">
        <button onClick={form.handleSubmit(onSave)} type="button">Сохранить профиль площадки</button>
        <button onClick={onExportPack} type="button">Экспорт пакета</button>
        <button onClick={() => void onSendDraft()} type="button">Отправить черновик</button>
      </div>
    </section>
  );
}
