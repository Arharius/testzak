import { z } from 'zod';

export const automationSettingsSchema = z.object({
  webhookUrl: z.string().url().or(z.literal('')),
  webhookSecret: z.string().max(300),
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
  endpoint: z.string().url().or(z.literal('')),
  apiToken: z.string().max(2000),
  customerInn: z.string().max(12),
  orgName: z.string().max(300),
  autoExport: z.boolean(),
  autoSendDraft: z.boolean()
});

export const automationEventSchema = z.object({
  at: z.string(),
  event: z.string(),
  ok: z.boolean(),
  note: z.string().optional()
});

export type AutomationSettings = z.infer<typeof automationSettingsSchema>;
export type PlatformIntegrationSettings = z.infer<typeof platformIntegrationSchema>;
export type AutomationEvent = z.infer<typeof automationEventSchema>;

export const defaultAutomationSettings: AutomationSettings = {
  webhookUrl: '',
  webhookSecret: '',
  autoSend: false,
  autopilot: false,
  autoPickTopCandidate: true
};

export const defaultPlatformSettings: PlatformIntegrationSettings = {
  profile: 'eis',
  endpoint: '',
  apiToken: '',
  customerInn: '',
  orgName: '',
  autoExport: false,
  autoSendDraft: false
};
