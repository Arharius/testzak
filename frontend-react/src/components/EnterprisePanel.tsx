import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  enterpriseSettingsSchema,
  type EnterpriseSettings,
} from '../types/schemas';

type Props = {
  value: EnterpriseSettings;
  onSave: (next: EnterpriseSettings) => void;
};

export function EnterprisePanel({ value, onSave }: Props) {
  const form = useForm<EnterpriseSettings>({
    resolver: zodResolver(enterpriseSettingsSchema),
    defaultValues: value,
    values: value,
  });

  return (
    <section className="panel">
      <h2>Enterprise контур</h2>
      <div className="grid two">
        <label>
          ETP endpoint (РТС/Сбер-АСТ/Росэлторг/ГПБ)
          <input {...form.register('etpEndpoint')} placeholder="https://.../etp/v1" />
        </label>
        <label>
          ETP token
          <input {...form.register('etpToken')} placeholder="token (можно с Bearer)" />
        </label>
        <label>
          СЭД/ECM
          <select {...form.register('ecmSystem')}>
            <option value="directum">Directum</option>
            <option value="docsvision">Docsvision</option>
            <option value="1c_doc">1С Документооборот</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          ECM endpoint
          <input {...form.register('ecmEndpoint')} placeholder="https://.../ecm/api" />
        </label>
        <label>
          ERP
          <select {...form.register('erpSystem')}>
            <option value="1c_erp">1С:ERP</option>
            <option value="sap">SAP</option>
            <option value="galaktika">Галактика</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          ERP endpoint
          <input {...form.register('erpEndpoint')} placeholder="https://.../erp/api" />
        </label>
      </div>

      <label>
        Маршрут согласования (СЭД)
        <input {...form.register('ecmApprovalRoute')} placeholder="Юрист -> ИБ -> Финконтроль -> Руководитель" />
      </label>

      <div className="grid two">
        <label>
          КЭП/ГОСТ провайдер
          <select {...form.register('cryptoProvider')}>
            <option value="cryptopro">КриптоПро</option>
            <option value="vipnet">ViPNet</option>
            <option value="signalcom">Signal-COM</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          Crypto endpoint
          <input {...form.register('cryptoEndpoint')} placeholder="https://.../crypto/sign" />
        </label>
      </div>

      <div className="checks">
        <label><input type="checkbox" {...form.register('simulationMode')} /> Песочница интеграций (без боевых контуров)</label>
        <label><input type="checkbox" {...form.register('etpBidirectionalStatus')} /> Двусторонний статус процедур ЕИС/ЭТП</label>
        <label><input type="checkbox" {...form.register('erpSyncNsi')} /> Синхронизация НСИ</label>
        <label><input type="checkbox" {...form.register('erpSyncBudget')} /> Синхронизация бюджета</label>
        <label><input type="checkbox" {...form.register('erpSyncContracts')} /> Синхронизация договоров</label>
        <label><input type="checkbox" {...form.register('erpSyncLimits')} /> Синхронизация лимитов</label>
        <label><input type="checkbox" {...form.register('antiFasStrictMode')} /> Anti-ФАС strict mode</label>
        <label><input type="checkbox" {...form.register('blockExportsOnFail')} /> Блокировать экспорт при комплаенс-ошибках</label>
        <label><input type="checkbox" {...form.register('blockIntegrationsOnFail')} /> Блокировать отправку в интеграции при комплаенс-ошибках</label>
        <label><input type="checkbox" {...form.register('rbacApprovals')} /> Ролевые согласования</label>
        <label><input type="checkbox" {...form.register('slaControl')} /> SLA-контроль</label>
        <label><input type="checkbox" {...form.register('immutableAudit')} /> Immutable audit trail</label>
        <label><input type="checkbox" {...form.register('benchmarking')} /> Бенчмаркинг закупок</label>
        <label><input type="checkbox" {...form.register('multiOrg')} /> Multi-organization</label>
        <label><input type="checkbox" {...form.register('multiContour')} /> Multi-contour</label>
      </div>

      <div className="grid two">
        <label>
          Порог Anti-ФАС score
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            {...form.register('antiFasMinScore', { valueAsNumber: true })}
          />
        </label>
        <label>
          Deployment mode
          <select {...form.register('deploymentMode')}>
            <option value="cloud">Cloud</option>
            <option value="private_cloud">Private cloud</option>
            <option value="on_prem">On-prem</option>
          </select>
        </label>
      </div>

      <div className="actions">
        <button onClick={form.handleSubmit(onSave)} type="button">Сохранить enterprise-настройки</button>
      </div>
      <div className="muted">
        Монетизация: Pro (per-user), Enterprise (годовой контракт + onboarding), отдельные модули: интеграции, комплаенс, внедрение.
      </div>
    </section>
  );
}
