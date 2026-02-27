import axios from 'axios';
import { appendAutomationLog } from './storage';
import type { AutomationSettings } from '../types/schemas';

const NON_LATIN1_RE = /[^\x00-\xff]/;

function normalizeHeaderValue(name: string, value: string): string {
  const cleaned = String(value || '').trim().replace(/[\r\n]+/g, ' ');
  if (!cleaned) return '';
  if (NON_LATIN1_RE.test(cleaned)) {
    throw new Error(`Недопустимые символы в ${name}. Используйте только латиницу/цифры.`);
  }
  return cleaned;
}

export async function postWebhook(url: string, secret: string, payload: unknown): Promise<boolean> {
  if (!url) return false;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const safeSecret = normalizeHeaderValue('X-TZ-Secret', secret);
    if (safeSecret) headers['X-TZ-Secret'] = safeSecret;
    await axios.post(url, payload, { headers, timeout: 10000 });
    appendAutomationLog({ at: new Date().toISOString(), event: 'webhook.sent', ok: true });
    return true;
  } catch {
    appendAutomationLog({ at: new Date().toISOString(), event: 'webhook.failed', ok: false });
    return false;
  }
}

export async function postPlatformDraft(endpoint: string, token: string, payload: unknown): Promise<boolean> {
  if (!endpoint) return false;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const safeToken = normalizeHeaderValue('Authorization token', token);
    if (safeToken) headers.Authorization = `Bearer ${safeToken}`;
    await axios.post(endpoint, payload, { headers, timeout: 10000 });
    appendAutomationLog({ at: new Date().toISOString(), event: 'platform.sent', ok: true });
    return true;
  } catch {
    appendAutomationLog({ at: new Date().toISOString(), event: 'platform.failed', ok: false });
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
  const safeApiKey = normalizeHeaderValue('API ключ', apiKey);
  if (!safeApiKey) {
    throw new Error('API-ключ пустой или некорректный');
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${safeApiKey}`,
    'Content-Type': 'application/json'
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://openrouter.ai';
    // Browser XHR rejects non ISO-8859-1 header values.
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
  if (settings.useBackendQueueApi && settings.backendApiBase) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const safeBackendToken = normalizeHeaderValue('backendApiToken', settings.backendApiToken || '');
      if (safeBackendToken) headers.Authorization = `Bearer ${safeBackendToken}`;
      const idempotencyKey = `${eventName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await axios.post(
        `${settings.backendApiBase.replace(/\/+$/, '')}/api/v1/integration/event`,
        {
          kind: eventName,
          source: 'react',
          idempotency_key: idempotencyKey,
          payload
        },
        { headers, timeout: 15000 }
      );
      appendAutomationLog({ at: new Date().toISOString(), event: `${eventName}.backend`, ok: true });
      return true;
    } catch {
      appendAutomationLog({ at: new Date().toISOString(), event: `${eventName}.backend`, ok: false });
      return false;
    }
  }
  return postWebhook(settings.webhookUrl, settings.webhookSecret, {
    app: 'tz_generator_react',
    event: eventName,
    at: new Date().toISOString(),
    payload
  });
}
