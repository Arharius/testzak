import { z } from 'zod';

export const automationSettingsSchema = z.object({
  webhookUrl: z.string().url().or(z.literal('')),
  webhookSecret: z.string().max(300),
  backendApiBase: z.string().url().or(z.literal('')),
  backendApiToken: z.string().max(2000),
  useBackendQueueApi: z.boolean(),
  autoSend: z.boolean(),
  autopilot: z.boolean(),
  autoPickTopCandidate: z.boolean()
});

export const platformIntegrationSchema = z.object({
  profile: z.enum([
    'eis',
    'eis_223',
    'sber_ast',
    'rts_tender',
    'roseltorg',
    'etp_gpb',
    'tek_torg',
    'fabrikant',
    'b2b_center',
    'custom'
  ]),
  procurementMethod: z.enum([
    'auction',
    'tender',
    'quotation',
    'proposal_request',
    'single_supplier',
  ]).default('auction'),
  endpoint: z.string().url().or(z.literal('')),
  apiToken: z.string().max(2000),
  customerInn: z.string().max(12),
  orgName: z.string().max(300),
  autoExport: z.boolean(),
  autoSendDraft: z.boolean(),
  autoFlushQueue: z.boolean().default(true),
});

export const enterpriseSettingsSchema = z.object({
  simulationMode: z.boolean().default(true),
  etpBidirectionalStatus: z.boolean().default(true),
  etpEndpoint: z.string().url().or(z.literal('')),
  etpToken: z.string().max(2000),
  ecmSystem: z.enum(['directum', 'docsvision', '1c_doc', 'custom']).default('directum'),
  ecmEndpoint: z.string().url().or(z.literal('')),
  ecmToken: z.string().max(2000),
  ecmApprovalRoute: z.string().max(300),
  erpSystem: z.enum(['1c_erp', 'sap', 'galaktika', 'custom']).default('1c_erp'),
  erpEndpoint: z.string().url().or(z.literal('')),
  erpToken: z.string().max(2000),
  erpSyncNsi: z.boolean().default(true),
  erpSyncBudget: z.boolean().default(true),
  erpSyncContracts: z.boolean().default(true),
  erpSyncLimits: z.boolean().default(true),
  cryptoProvider: z.enum(['cryptopro', 'vipnet', 'signalcom', 'custom']).default('cryptopro'),
  cryptoEndpoint: z.string().url().or(z.literal('')),
  cryptoToken: z.string().max(2000),
  antiFasStrictMode: z.boolean().default(true),
  antiFasMinScore: z.number().min(0).max(100).default(85),
  blockExportsOnFail: z.boolean().default(true),
  blockIntegrationsOnFail: z.boolean().default(true),
  rbacApprovals: z.boolean().default(true),
  slaControl: z.boolean().default(true),
  immutableAudit: z.boolean().default(true),
  benchmarking: z.boolean().default(true),
  multiOrg: z.boolean().default(true),
  multiContour: z.boolean().default(true),
  deploymentMode: z.enum(['cloud', 'private_cloud', 'on_prem']).default('private_cloud'),
});

export const automationEventSchema = z.object({
  at: z.string(),
  event: z.string(),
  ok: z.boolean(),
  note: z.string().optional()
});

export type AutomationSettings = z.infer<typeof automationSettingsSchema>;
export type PlatformIntegrationSettings = z.infer<typeof platformIntegrationSchema>;
export type EnterpriseSettings = z.infer<typeof enterpriseSettingsSchema>;
export type AutomationEvent = z.infer<typeof automationEventSchema>;

export const defaultAutomationSettings: AutomationSettings = {
  webhookUrl: '',
  webhookSecret: '',
  backendApiBase: '',
  backendApiToken: '',
  useBackendQueueApi: true,
  autoSend: true,
  autopilot: true,
  autoPickTopCandidate: true
};

export const defaultPlatformSettings: PlatformIntegrationSettings = {
  profile: 'eis',
  procurementMethod: 'auction',
  endpoint: '',
  apiToken: '',
  customerInn: '',
  orgName: '',
  autoExport: false,
  autoSendDraft: true,
  autoFlushQueue: true,
};

export const defaultEnterpriseSettings: EnterpriseSettings = {
  simulationMode: true,
  etpBidirectionalStatus: true,
  etpEndpoint: '',
  etpToken: '',
  ecmSystem: 'directum',
  ecmEndpoint: '',
  ecmToken: '',
  ecmApprovalRoute: 'Юрист -> ИБ -> Финконтроль -> Руководитель',
  erpSystem: '1c_erp',
  erpEndpoint: '',
  erpToken: '',
  erpSyncNsi: true,
  erpSyncBudget: true,
  erpSyncContracts: true,
  erpSyncLimits: true,
  cryptoProvider: 'cryptopro',
  cryptoEndpoint: '',
  cryptoToken: '',
  antiFasStrictMode: true,
  antiFasMinScore: 85,
  blockExportsOnFail: true,
  blockIntegrationsOnFail: true,
  rbacApprovals: true,
  slaControl: true,
  immutableAudit: true,
  benchmarking: true,
  multiOrg: true,
  multiContour: true,
  deploymentMode: 'private_cloud',
};
