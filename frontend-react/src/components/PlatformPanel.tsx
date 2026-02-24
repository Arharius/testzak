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
      <h2>EIS and Auction Platforms</h2>
      <div className="grid two">
        <label>
          Profile
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
          Connector endpoint
          <input {...form.register('endpoint')} placeholder="https://connector.example/api/eis/drafts" />
        </label>
        <label>
          API token
          <input {...form.register('apiToken')} placeholder="Bearer token" />
        </label>
        <label>
          INN
          <input {...form.register('customerInn')} placeholder="7700000000" />
        </label>
      </div>
      <label>
        Organization
        <input {...form.register('orgName')} placeholder="Customer organization" />
      </label>
      <div className="checks">
        <label><input type="checkbox" {...form.register('autoExport')} /> auto export package after generation</label>
        <label><input type="checkbox" {...form.register('autoSendDraft')} /> auto send draft to connector</label>
      </div>
      <div className="actions">
        <button onClick={form.handleSubmit(onSave)} type="button">save platform profile</button>
        <button onClick={onExportPack} type="button">export package</button>
        <button onClick={() => void onSendDraft()} type="button">send draft</button>
      </div>
    </section>
  );
}
