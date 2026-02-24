import axios from 'axios';
import { appendAutomationLog } from './storage';
import type { AutomationSettings } from '../types/schemas';
import { buildPlatformDraftRequest, validatePlatformSettings } from './platformAdapters';
import type { PlatformIntegrationSettings } from '../types/schemas';

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

export async function postWebhook(
  url: string,
  secret: string,
  payload: unknown,
  policy?: Partial<DeliveryPolicy>
): Promise<boolean> {
  if (!url) return false;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['X-TZ-Secret'] = secret;
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
    const result = await postJsonWithRetry(req.endpoint, req.body, req.headers, policy);
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

export async function generateItemSpecs(
  provider: Provider,
  apiKey: string,
  model: string,
  prompt: string
): Promise<string> {
  const endpoint = API_ENDPOINTS[provider];
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://openrouter.ai';
    headers['X-Title'] = 'TZ Generator React';
  }
  const response = await axios.post(
    endpoint,
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 1800
    },
    { headers, timeout: 60000 }
  );
  return response.data?.choices?.[0]?.message?.content || '';
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
      if (settings.backendApiToken) headers.Authorization = `Bearer ${settings.backendApiToken}`;
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
