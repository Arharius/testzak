import type { PlatformIntegrationSettings } from '../types/schemas';

type DraftPayload = Record<string, unknown>;

type AdapterContext = {
  settings: PlatformIntegrationSettings;
  payload: DraftPayload;
};

type AdapterResult = {
  endpoint: string;
  headers: Record<string, string>;
  body: DraftPayload;
};

function sanitizeEndpoint(url: string): string {
  return String(url || '').trim().replace(/\/+$/, '');
}

function baseHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function assertRequiredForProfile(settings: PlatformIntegrationSettings): string[] {
  const errors: string[] = [];
  if (!settings.endpoint.trim()) errors.push('Не задан endpoint коннектора.');
  if ((settings.profile === 'eis' || settings.profile === 'eis_223') && !settings.customerInn.trim()) {
    errors.push('Для ЕИС профиля требуется ИНН заказчика.');
  }
  return errors;
}

function isHttpsOrLocalhost(url: string): boolean {
  try {
    const parsed = new URL(String(url || '').trim());
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

export function validatePlatformSettings(
  settings: PlatformIntegrationSettings,
  options?: { requireHttps?: boolean }
): { ok: boolean; errors: string[] } {
  const errors = assertRequiredForProfile(settings);
  if ((options?.requireHttps ?? true) && settings.endpoint && !isHttpsOrLocalhost(settings.endpoint)) {
    errors.push('Endpoint должен использовать HTTPS (исключение: localhost).');
  }
  return { ok: errors.length === 0, errors };
}

export function buildPlatformDraftRequest(ctx: AdapterContext): AdapterResult {
  const endpoint = sanitizeEndpoint(ctx.settings.endpoint);
  const headers = baseHeaders(ctx.settings.apiToken);
  headers['X-Integration-Profile'] = ctx.settings.profile;

  const body: DraftPayload = {
    ...ctx.payload,
    profile: ctx.settings.profile,
    customerInn: ctx.settings.customerInn,
    organization: ctx.settings.orgName,
    sentAt: new Date().toISOString()
  };

  switch (ctx.settings.profile) {
    case 'eis':
      body.law = '44-FZ';
      body.connectorMode = 'EIS44_DRAFT';
      break;
    case 'eis_223':
      body.law = '223-FZ';
      body.connectorMode = 'EIS223_DRAFT';
      break;
    case 'sber_ast':
    case 'rts_tender':
    case 'roseltorg':
    case 'etp_gpb':
    case 'tek_torg':
    case 'fabrikant':
    case 'b2b_center':
      body.connectorMode = 'ETP_DRAFT';
      break;
    case 'custom':
    default:
      body.connectorMode = 'CUSTOM_DRAFT';
      break;
  }

  return { endpoint, headers, body };
}
