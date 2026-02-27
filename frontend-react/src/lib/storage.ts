import {
  automationEventSchema,
  automationSettingsSchema,
  defaultAutomationSettings,
  defaultEnterpriseSettings,
  defaultPlatformSettings,
  enterpriseSettingsSchema,
  platformIntegrationSchema,
  type AutomationEvent,
  type AutomationSettings,
  type EnterpriseSettings,
  type PlatformIntegrationSettings
} from '../types/schemas';

const KEYS = {
  automationSettings: 'tz_automation_settings_v1',
  platformSettings: 'tz_platform_integration_settings_v1',
  enterpriseSettings: 'tz_enterprise_settings_v1',
  automationLog: 'tz_automation_log_v1',
  learnedTypeMap: 'tz_learned_type_map_v1',
  immutableAudit: 'tz_immutable_audit_v1',
};

export type ImmutableAuditRecord = {
  at: string;
  action: string;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function emitAutomationLogUpdated(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('tz:automation-log-updated'));
}

export function getAutomationSettings(): AutomationSettings {
  const parsed = automationSettingsSchema.safeParse(
    readJson(KEYS.automationSettings, defaultAutomationSettings)
  );
  const data = parsed.success ? parsed.data : defaultAutomationSettings;
  const looksUnconfigured =
    !data.webhookUrl &&
    !data.backendApiBase &&
    !data.backendApiToken &&
    !data.autoSend &&
    !data.autopilot &&
    !data.useBackendQueueApi;
  if (looksUnconfigured) {
    const upgraded: AutomationSettings = {
      ...data,
      useBackendQueueApi: true,
      autoSend: true,
      autopilot: true,
      autoPickTopCandidate: true,
    };
    writeJson(KEYS.automationSettings, upgraded);
    return upgraded;
  }
  return data;
}

export function setAutomationSettings(value: AutomationSettings): void {
  writeJson(KEYS.automationSettings, value);
}

export function getPlatformSettings(): PlatformIntegrationSettings {
  const parsed = platformIntegrationSchema.safeParse(
    readJson(KEYS.platformSettings, defaultPlatformSettings)
  );
  const data = parsed.success ? parsed.data : defaultPlatformSettings;
  const looksUnconfigured =
    !data.endpoint &&
    !data.apiToken &&
    !data.customerInn &&
    !data.orgName &&
    !data.autoSendDraft;
  if (looksUnconfigured) {
    const upgraded: PlatformIntegrationSettings = {
      ...data,
      autoSendDraft: true,
    };
    writeJson(KEYS.platformSettings, upgraded);
    return upgraded;
  }
  return data;
}

export function setPlatformSettings(value: PlatformIntegrationSettings): void {
  writeJson(KEYS.platformSettings, value);
}

export function getEnterpriseSettings(): EnterpriseSettings {
  const parsed = enterpriseSettingsSchema.safeParse(
    readJson(KEYS.enterpriseSettings, defaultEnterpriseSettings)
  );
  return parsed.success ? parsed.data : defaultEnterpriseSettings;
}

export function setEnterpriseSettings(value: EnterpriseSettings): void {
  writeJson(KEYS.enterpriseSettings, value);
}

export function getAutomationLog(): AutomationEvent[] {
  const raw = readJson<AutomationEvent[]>(KEYS.automationLog, []);
  return raw.filter((entry) => automationEventSchema.safeParse(entry).success);
}

export function appendAutomationLog(entry: AutomationEvent): void {
  const list = getAutomationLog();
  list.push(entry);
  writeJson(KEYS.automationLog, list.slice(-500));
  emitAutomationLogUpdated();
}

export function clearAutomationLog(): void {
  writeJson(KEYS.automationLog, []);
  emitAutomationLogUpdated();
}

export function exportLearningMap(): string {
  const map = readJson<Record<string, unknown>>(KEYS.learnedTypeMap, {});
  return JSON.stringify({ exportedAt: new Date().toISOString(), map }, null, 2);
}

export function importLearningMap(raw: string): { ok: boolean; count: number } {
  try {
    const parsed = JSON.parse(raw) as { map?: Record<string, unknown> } | Record<string, unknown>;
    const map = (parsed as { map?: Record<string, unknown> }).map ?? parsed;
    if (!map || typeof map !== 'object') return { ok: false, count: 0 };
    writeJson(KEYS.learnedTypeMap, map);
    return { ok: true, count: Object.keys(map).length };
  } catch {
    return { ok: false, count: 0 };
  }
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function getImmutableAuditLog(): ImmutableAuditRecord[] {
  const raw = readJson<ImmutableAuditRecord[]>(KEYS.immutableAudit, []);
  return Array.isArray(raw) ? raw : [];
}

export function appendImmutableAudit(action: string, payload: Record<string, unknown>): ImmutableAuditRecord {
  const list = getImmutableAuditLog();
  const at = new Date().toISOString();
  const prevHash = list.length ? list[list.length - 1].hash : 'genesis';
  const base = JSON.stringify({ at, action, payload, prevHash });
  const record: ImmutableAuditRecord = {
    at,
    action,
    payload,
    prevHash,
    hash: hashString(base),
  };
  list.push(record);
  writeJson(KEYS.immutableAudit, list.slice(-5000));
  return record;
}
