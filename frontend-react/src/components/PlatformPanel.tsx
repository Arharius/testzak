import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  platformIntegrationSchema,
  type PlatformIntegrationSettings
} from '../types/schemas';
import { ORGANIZATION_PRESET_OPTIONS } from '../utils/organization-memory';

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
      <h2>Реквизиты заказчика</h2>
      <div className="muted" style={{ marginBottom: 8 }}>
        Заполните один раз — все ТЗ будут генерироваться с полными реквизитами без прочерков.
      </div>

      <label>
        Полное наименование организации
        <input {...form.register('orgName')} placeholder="Муниципальное казённое учреждение «...»" />
      </label>
      <label>
        Краткое наименование
        <input {...form.register('orgNameShort')} placeholder="МКУ «...»" />
      </label>
      <div className="grid two">
        <label>
          ИНН
          <input {...form.register('customerInn')} placeholder="7700000000" maxLength={12} />
        </label>
        <label>
          КПП
          <input {...form.register('customerKpp')} placeholder="770001001" maxLength={9} />
        </label>
      </div>
      <label>
        Юридический / почтовый адрес
        <input {...form.register('customerAddress')} placeholder="125009, г. Москва, ул. Пушкина, д. 1" />
      </label>
      <label>
        Адрес поставки (если отличается от юридического)
        <input {...form.register('deliveryAddress')} placeholder="125009, г. Москва, ул. Пушкина, д. 1, каб. 101" />
      </label>
      <label>
        Срок поставки, календарных дней
        <input
          type="number"
          min={1}
          max={365}
          step={1}
          {...form.register('deliveryDays', {
            setValueAs: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 ? n : 60; }
          })}
          placeholder="60"
        />
      </label>

      <h3 style={{ marginTop: 16, marginBottom: 4, fontSize: 13 }}>Контактное лицо заказчика</h3>
      <div className="muted" style={{ marginBottom: 8 }}>Будет указано в разделе 1 ТЗ</div>
      <div className="grid two">
        <label>
          ФИО
          <input {...form.register('contactPersonName')} placeholder="Иванов Иван Иванович" />
        </label>
        <label>
          Должность
          <input {...form.register('contactPersonTitle')} placeholder="Начальник отдела ИТ" />
        </label>
        <label>
          Телефон
          <input {...form.register('contactPersonPhone')} placeholder="+7 (495) 000-00-00" />
        </label>
        <label>
          Email
          <input {...form.register('contactPersonEmail')} placeholder="ivanov@example.gov.ru" />
        </label>
      </div>

      <h3 style={{ marginTop: 16, marginBottom: 4, fontSize: 13 }}>Гриф «УТВЕРЖДАЮ»</h3>
      <div className="muted" style={{ marginBottom: 8 }}>Подпись на первой странице ТЗ (DOCX)</div>
      <div className="grid two">
        <label>
          ФИО подписанта
          <input {...form.register('approvalPersonName')} placeholder="Петров П.П." />
        </label>
        <label>
          Должность подписанта
          <input {...form.register('approvalPersonTitle')} placeholder="Директор" />
        </label>
      </div>

      <h2 style={{ marginTop: 20 }}>ЕИС и электронные площадки</h2>
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
          Endpoint коннектора
          <input {...form.register('endpoint')} placeholder="(пусто = /api/v1/integration/draft)" />
        </label>
        <label>
          API токен
          <input {...form.register('apiToken')} placeholder="token (можно с Bearer)" />
        </label>
      </div>
      <div className="grid two">
        <label>
          Профиль организации
          <select {...form.register('industryPreset')}>
            {ORGANIZATION_PRESET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Гарантия по умолчанию, мес
          <input
            type="number"
            min={0}
            max={120}
            step={1}
            {...form.register('defaultWarrantyMonths', {
              setValueAs: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; }
            })}
            placeholder="0 = не подмешивать"
          />
        </label>
      </div>
      <label>
        Внутренние правила заказчика
        <textarea
          {...form.register('organizationInstructions')}
          rows={3}
          placeholder="Например: русская документация обязательна; гарантия не менее 24 мес."
        />
      </label>
      <div className="muted">Этот профиль автоматически подмешивается в генерацию и экспортный пакет.</div>
      <div className="checks">
        <label><input type="checkbox" {...form.register('autoExport')} /> Автоэкспорт пакета после генерации</label>
        <label><input type="checkbox" {...form.register('autoSendDraft')} /> Автоотправка черновика в коннектор</label>
        <label><input type="checkbox" {...form.register('autoFlushQueue')} /> Автоповтор очереди коннектора</label>
      </div>
      <div className="muted">Очередь коннектора: {queueSize}</div>
      <div className="actions">
        <button onClick={form.handleSubmit(onSave)} type="button">Сохранить реквизиты</button>
        <button onClick={onExportPack} type="button">Экспорт пакета</button>
        <button onClick={() => void onSendDraft()} type="button">Отправить черновик</button>
        <button onClick={() => void onFlushQueue()} type="button" disabled={flushPending}>
          {flushPending ? 'Повтор...' : 'Повторить очередь'}
        </button>
      </div>
    </section>
  );
}
