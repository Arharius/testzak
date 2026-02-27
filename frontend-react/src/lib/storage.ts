import {
  automationEventSchema,
  automationSettingsSchema,
  defaultAutomationSettings,
  defaultPlatformSettings,
  platformIntegrationSchema,
  type AutomationEvent,
  type AutomationSettings,
  type PlatformIntegrationSettings
} from '../types/schemas';

const KEYS = {
  automationSettings: 'tz_automation_settings_v1',
  platformSettings: 'tz_platform_integration_settings_v1',
  automationLog: 'tz_automation_log_v1',
  learnedTypeMap: 'tz_learned_type_map_v1'
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
  return parsed.success ? parsed.data : defaultAutomationSettings;
}

export function setAutomationSettings(value: AutomationSettings): void {
  writeJson(KEYS.automationSettings, value);
}

export function getPlatformSettings(): PlatformIntegrationSettings {
  const parsed = platformIntegrationSchema.safeParse(
    readJson(KEYS.platformSettings, defaultPlatformSettings)
  );
  return parsed.success ? parsed.data : defaultPlatformSettings;
}

export function setPlatformSettings(value: PlatformIntegrationSettings): void {
  writeJson(KEYS.platformSettings, value);
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
