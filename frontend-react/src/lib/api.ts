import axios from 'axios';
import { appendAutomationLog } from './storage';
import type { AutomationSettings } from '../types/schemas';
import { buildPlatformDraftRequest, validatePlatformSettings } from './platformAdapters';
import type { PlatformIntegrationSettings } from '../types/schemas';

export type IntegrationMetrics = {
  status: string;
  queue_total: number;
  history_total: number;
  dead_letter_total: number;
  oldest_queued_seconds: number;
  flush_24h: { sent: number; queued: number; dead_letter: number };
  target_webhook_configured: boolean;
  integration_auth_enabled: boolean;
  integration_max_attempts: number;
};

export type TenantKpi = {
  tenant_id: string;
  users_total: number;
  docs_total: number;
  docs_last_30d: number;
  estimated_revenue_cents: number;
};

export type TenantBillingSummary = {
  tenant_id: string;
  subscription: {
    plan_code: string;
    status: string;
    monthly_price_cents: number;
    billing_cycle: string;
  };
  usage_30d_docs: number;
  estimated_metered_revenue_cents: number;
};

export type TenantAlert = {
  level: string;
  code: string;
  message: string;
};

export type TenantPlanLimits = {
  ok: boolean;
  tenant_id: string;
  plan_code: string;
  limits: {
    price_cents: number;
    users_limit: number;
    docs_month_limit: number;
  };
  usage: {
    users_total: number;
    docs_month_total: number;
  };
  unlimited: boolean;
};

export type YooKassaCheckoutResponse = {
  ok: boolean;
  plan_code: string;
  payment_id: string;
  status: string;
  confirmation_url: string;
};

export type BillingReadiness = {
  ok: boolean;
  provider: string;
  ready_for_checkout: boolean;
  return_url: string;
  webhook_path: string;
  configured: {
    shop_id: boolean;
    secret_key: boolean;
    return_url: boolean;
    webhook_secret: boolean;
  };
  next_steps: string[];
};

type DeliveryPolicy = {
  retries: number;
  baseBackoffMs: number;
  requireHttps: boolean;
};

function normalizePolicy(policy?: Partial<DeliveryPolicy>): DeliveryPolicy {
  const retries = Number.isFinite(policy?.retries) ? Number(policy?.retries) : 2;
  const baseBackoffMs = Number.isFinite(policy?.baseBackoffMs) ? Number(policy?.baseBackoffMs) : 800;
  return {
    retries: Math.max(0, Math.min(8, Math.trunc(retries))),
    baseBackoffMs: Math.max(200, Math.min(10000, Math.trunc(baseBackoffMs))),
    requireHttps: policy?.requireHttps !== false
  };
}

function isHttpsOrLocalhost(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function postJsonWithRetry(
  url: string,
  payload: unknown,
  headers: Record<string, string>,
  policyInput?: Partial<DeliveryPolicy>
): Promise<{ ok: boolean; attempts: number; note: string }> {
  const policy = normalizePolicy(policyInput);
  if (policy.requireHttps && !isHttpsOrLocalhost(url)) {
    return { ok: false, attempts: 0, note: 'endpoint must be https (or localhost)' };
  }

  let lastError = 'delivery_failed';
  const maxAttempts = policy.retries + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await axios.post(url, payload, { headers, timeout: 10000 });
      return { ok: true, attempts: attempt, note: 'ok' };
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'delivery_failed';
      if (attempt < maxAttempts) {
        const jitter = Math.floor(Math.random() * 250);
        const delayMs = policy.baseBackoffMs * Math.pow(2, attempt - 1) + jitter;
        await sleep(delayMs);
      }
    }
  }
  return { ok: false, attempts: maxAttempts, note: lastError.slice(0, 180) };
}

function sanitizeHeaderValue(value: string): string {
  return String(value || '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

export async function postWebhook(
  url: string,
  secret: string,
  payload: unknown,
  policy?: Partial<DeliveryPolicy>
): Promise<boolean> {
  if (!url) return false;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['X-TZ-Secret'] = sanitizeHeaderValue(secret);
  const result = await postJsonWithRetry(url, payload, headers, policy);
  if (result.ok) {
    appendAutomationLog({ at: new Date().toISOString(), event: 'webhook.sent', ok: true });
    if (result.attempts > 1) {
      appendAutomationLog({
        at: new Date().toISOString(),
        event: 'webhook.retry',
        ok: true,
        note: `attempts=${result.attempts}`
      });
    }
    return true;
  }
  appendAutomationLog({
    at: new Date().toISOString(),
    event: 'webhook.failed',
    ok: false,
    note: `attempts=${result.attempts}; ${result.note}`.slice(0, 180)
  });
  return false;
}

export async function postPlatformDraft(
  settingsOrEndpoint: PlatformIntegrationSettings | string,
  tokenOrPayload: string | unknown,
  maybePayload?: unknown,
  policy?: Partial<DeliveryPolicy>
): Promise<boolean> {
  try {
    const settings: PlatformIntegrationSettings =
      typeof settingsOrEndpoint === 'string'
        ? {
            profile: 'custom',
            endpoint: settingsOrEndpoint,
            apiToken: typeof tokenOrPayload === 'string' ? tokenOrPayload : '',
            customerInn: '',
            orgName: '',
            autoExport: false,
            autoSendDraft: false
          }
        : settingsOrEndpoint;

    const payload = typeof settingsOrEndpoint === 'string' ? maybePayload : tokenOrPayload;
    const check = validatePlatformSettings(settings, { requireHttps: normalizePolicy(policy).requireHttps });
    if (!check.ok) {
      appendAutomationLog({
        at: new Date().toISOString(),
        event: 'platform.validation.failed',
        ok: false,
        note: check.errors.join(' | ').slice(0, 180)
      });
      return false;
    }

    const req = buildPlatformDraftRequest({ settings, payload: (payload || {}) as Record<string, unknown> });
    const safeHeaders = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, sanitizeHeaderValue(String(v))])
    ) as Record<string, string>;
    const result = await postJsonWithRetry(req.endpoint, req.body, safeHeaders, policy);
    if (!result.ok) {
      appendAutomationLog({
        at: new Date().toISOString(),
        event: 'platform.failed',
        ok: false,
        note: `attempts=${result.attempts}; ${result.note}`.slice(0, 180)
      });
      return false;
    }
    appendAutomationLog({ at: new Date().toISOString(), event: 'platform.sent', ok: true });
    if (result.attempts > 1) {
      appendAutomationLog({
        at: new Date().toISOString(),
        event: 'platform.retry',
        ok: true,
        note: `attempts=${result.attempts}`
      });
    }
    return true;
  } catch (error) {
    appendAutomationLog({
      at: new Date().toISOString(),
      event: 'platform.failed',
      ok: false,
      note: (error instanceof Error ? error.message : 'unknown_error').slice(0, 180)
    });
    return false;
  }
}

type Provider = 'openrouter' | 'groq' | 'deepseek';

const API_ENDPOINTS: Record<Provider, string> = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions'
};

export type OpenRouterModel = {
  id: string;
  name?: string;
  context_length?: number;
};

function normalizeModelForProvider(provider: Provider, model: string): string {
  const raw = String(model || '').trim();
  if (!raw) return raw;
  if (provider === 'openrouter') {
    if (raw === 'deepseek-chat') return 'deepseek/deepseek-chat';
    if (raw === 'deepseek-reasoner') return 'deepseek/deepseek-reasoner';
  }
  if (provider === 'deepseek' && raw.includes('/')) {
    const tail = raw.split('/').pop();
    return tail || raw;
  }
  return raw;
}

export async function fetchOpenRouterModels(apiKey: string): Promise<OpenRouterModel[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'HTTP-Referer': sanitizeHeaderValue('https://openrouter.ai'),
    'X-Title': sanitizeHeaderValue('TZ Generator React')
  };
  const cleanKey = sanitizeHeaderValue(apiKey).replace(/^Bearer\s+/i, '');
  if (cleanKey) headers.Authorization = `Bearer ${cleanKey}`;

  const resp = await axios.get('https://openrouter.ai/api/v1/models', { headers, timeout: 30000 });
  const items = Array.isArray(resp.data?.data) ? (resp.data.data as Array<Record<string, unknown>>) : [];
  return items
    .map((m) => ({
      id: String(m.id || '').trim(),
      name: typeof m.name === 'string' ? m.name : undefined,
      context_length: Number.isFinite(m.context_length as number) ? Number(m.context_length) : undefined
    }))
    .filter((m) => !!m.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchOpenRouterModelsViaBackend(
  backendApiBase: string,
  apiKey: string
): Promise<OpenRouterModel[]> {
  const base = String(backendApiBase || '').trim();
  if (!base) throw new Error('backend_api_base_not_set');
  const cleanKey = sanitizeHeaderValue(apiKey).replace(/^Bearer\s+/i, '');
  if (!cleanKey) throw new Error('api_key_invalid_after_sanitize');
  const url = `${base.replace(/\/+$/, '')}/api/public/openrouter/models`;
  const resp = await axios.post(url, { api_key: cleanKey }, { timeout: 30000 });
  const items = Array.isArray(resp.data?.items) ? (resp.data.items as Array<Record<string, unknown>>) : [];
  return items
    .map((m) => ({
      id: String(m.id || '').trim(),
      name: typeof m.name === 'string' ? m.name : undefined,
      context_length: Number.isFinite(m.context_length as number) ? Number(m.context_length) : undefined
    }))
    .filter((m) => !!m.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function generateItemSpecs(
  provider: Provider,
  apiKey: string,
  model: string,
  prompt: string
): Promise<string> {
  const endpoint = API_ENDPOINTS[provider];
  const modelName = normalizeModelForProvider(provider, model);
  const cleanKey = sanitizeHeaderValue(apiKey).replace(/^Bearer\s+/i, '');
  if (!cleanKey) {
    throw new Error('api_key_invalid_after_sanitize');
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cleanKey}`,
    'Content-Type': 'application/json'
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = sanitizeHeaderValue('https://openrouter.ai');
    headers['X-Title'] = sanitizeHeaderValue('TZ Generator React');
  }
  try {
    const response = await axios.post(
      endpoint,
      {
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 1800
      },
      { headers, timeout: 60000 }
    );
    return response.data?.choices?.[0]?.message?.content || '';
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const msg =
        (error.response?.data as { error?: { message?: string }; message?: string } | undefined)?.error?.message ||
        (error.response?.data as { message?: string } | undefined)?.message ||
        error.message;
      throw new Error(`provider ${provider} status ${status || 'n/a'}: ${String(msg).slice(0, 180)}`);
    }
    throw error;
  }
}

export async function sendEventThroughBestChannel(
  settings: AutomationSettings,
  eventName: string,
  payload: unknown
): Promise<boolean> {
  const deliveryPolicy: Partial<DeliveryPolicy> = {
    retries: settings.deliveryRetries,
    baseBackoffMs: settings.deliveryBackoffMs,
    requireHttps: settings.requireHttpsForIntegrations
  };
  if (settings.useBackendQueueApi && settings.backendApiBase) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (settings.backendApiToken) headers.Authorization = `Bearer ${sanitizeHeaderValue(settings.backendApiToken)}`;
      const idempotencyKey = `${eventName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await postJsonWithRetry(
        `${settings.backendApiBase.replace(/\/+$/, '')}/api/v1/integration/event`,
        {
          kind: eventName,
          source: 'react',
          idempotency_key: idempotencyKey,
          payload
        },
        headers,
        deliveryPolicy
      );
      if (!result.ok) {
        appendAutomationLog({
          at: new Date().toISOString(),
          event: `${eventName}.backend`,
          ok: false,
          note: `attempts=${result.attempts}; ${result.note}`.slice(0, 180)
        });
        return false;
      }
      appendAutomationLog({ at: new Date().toISOString(), event: `${eventName}.backend`, ok: true });
      if (result.attempts > 1) {
        appendAutomationLog({
          at: new Date().toISOString(),
          event: `${eventName}.backend.retry`,
          ok: true,
          note: `attempts=${result.attempts}`
        });
      }
      return true;
    } catch (error) {
      appendAutomationLog({
        at: new Date().toISOString(),
        event: `${eventName}.backend`,
        ok: false,
        note: (error instanceof Error ? error.message : 'unknown_error').slice(0, 180)
      });
      return false;
    }
  }
  return postWebhook(settings.webhookUrl, settings.webhookSecret, {
    app: 'tz_generator_react',
    event: eventName,
    at: new Date().toISOString(),
    payload
  }, deliveryPolicy);
}

export async function fetchBackendMetrics(settings: AutomationSettings): Promise<IntegrationMetrics | null> {
  if (!settings.backendApiBase) return null;
  const url = `${settings.backendApiBase.replace(/\/+$/, '')}/api/v1/integration/metrics`;
  if (settings.requireHttpsForIntegrations) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
        appendAutomationLog({
          at: new Date().toISOString(),
          event: 'metrics.blocked',
          ok: false,
          note: 'backendApiBase must be https'
        });
        return null;
      }
    } catch {
      return null;
    }
  }

  try {
    const headers: Record<string, string> = {};
    if (settings.backendApiToken) headers.Authorization = `Bearer ${settings.backendApiToken}`;
    const resp = await axios.get(url, { headers, timeout: 15000 });
    appendAutomationLog({ at: new Date().toISOString(), event: 'metrics.fetch', ok: true });
    return (resp.data?.metrics || null) as IntegrationMetrics | null;
  } catch (error) {
    appendAutomationLog({
      at: new Date().toISOString(),
      event: 'metrics.fetch',
      ok: false,
      note: (error instanceof Error ? error.message : 'unknown_error').slice(0, 140)
    });
    return null;
  }
}

export async function fetchTenantKpi(settings: AutomationSettings): Promise<TenantKpi | null> {
  if (!settings.backendApiBase) return null;
  const url =
    `${settings.backendApiBase.replace(/\/+$/, '')}/api/tenant/kpi` +
    `?billing_price_per_doc_cents=${encodeURIComponent(String(settings.billingPricePerDocCents || 0))}`;
  try {
    const headers: Record<string, string> = {};
    if (settings.backendApiToken) headers.Authorization = `Bearer ${settings.backendApiToken}`;
    const resp = await axios.get(url, { headers, timeout: 15000 });
    appendAutomationLog({ at: new Date().toISOString(), event: 'tenant.kpi.fetch', ok: true });
    return resp.data as TenantKpi;
  } catch (error) {
    appendAutomationLog({
      at: new Date().toISOString(),
      event: 'tenant.kpi.fetch',
      ok: false,
      note: (error instanceof Error ? error.message : 'unknown_error').slice(0, 120)
    });
    return null;
  }
}

export async function fetchTenantBillingSummary(settings: AutomationSettings): Promise<TenantBillingSummary | null> {
  if (!settings.backendApiBase) return null;
  const url =
    `${settings.backendApiBase.replace(/\/+$/, '')}/api/tenant/billing/summary` +
    `?price_per_doc_cents=${encodeURIComponent(String(settings.billingPricePerDocCents || 0))}`;
  try {
    const headers: Record<string, string> = {};
    if (settings.backendApiToken) headers.Authorization = `Bearer ${settings.backendApiToken}`;
    const resp = await axios.get(url, { headers, timeout: 15000 });
    return resp.data as TenantBillingSummary;
  } catch {
    return null;
  }
}

export async function fetchTenantAlerts(settings: AutomationSettings): Promise<TenantAlert[]> {
  if (!settings.backendApiBase) return [];
  const url = `${settings.backendApiBase.replace(/\/+$/, '')}/api/tenant/alerts`;
  try {
    const headers: Record<string, string> = {};
    if (settings.backendApiToken) headers.Authorization = `Bearer ${settings.backendApiToken}`;
    const resp = await axios.get(url, { headers, timeout: 15000 });
    return Array.isArray(resp.data?.items) ? (resp.data.items as TenantAlert[]) : [];
  } catch {
    return [];
  }
}

export async function fetchTenantPlanLimits(settings: AutomationSettings): Promise<TenantPlanLimits | null> {
  if (!settings.backendApiBase) return null;
  const url = `${settings.backendApiBase.replace(/\/+$/, '')}/api/tenant/plan/limits`;
  try {
    const headers: Record<string, string> = {};
    if (settings.backendApiToken) headers.Authorization = settings.backendApiToken;
    const resp = await axios.get(url, { headers, timeout: 15000 });
    return resp.data as TenantPlanLimits;
  } catch {
    return null;
  }
}

export async function createYooKassaCheckout(
  settings: AutomationSettings,
  planCode: 'starter' | 'pro' | 'enterprise',
  returnUrl?: string
): Promise<YooKassaCheckoutResponse> {
  if (!settings.backendApiBase) {
    throw new Error('backend_api_base_not_set');
  }
  const url = `${settings.backendApiBase.replace(/\/+$/, '')}/api/tenant/payments/yookassa/checkout`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.backendApiToken) headers.Authorization = settings.backendApiToken;
  const payload: Record<string, string> = { plan_code: planCode };
  if (returnUrl && returnUrl.trim()) payload.return_url = returnUrl.trim();

  const resp = await axios.post(url, payload, { headers, timeout: 20000 });
  return resp.data as YooKassaCheckoutResponse;
}

export async function fetchPublicBillingReadiness(
  backendApiBase: string
): Promise<BillingReadiness | null> {
  const base = String(backendApiBase || '').trim();
  if (!base) return null;
  try {
    const url = `${base.replace(/\/+$/, '')}/api/public/billing/readiness`;
    const resp = await axios.get(url, { timeout: 10000 });
    return resp.data as BillingReadiness;
  } catch {
    return null;
  }
}
