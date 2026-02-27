import axios from 'axios';
import { appendAutomationLog } from './storage';
import type { AutomationSettings } from '../types/schemas';

const NON_LATIN1_RE = /[^\x00-\xff]/;
const AUTOMATION_QUEUE_KEY = 'tz_automation_queue_v1';
const PLATFORM_QUEUE_KEY = 'tz_platform_queue_v1';
const MAX_QUEUE_ITEMS = 500;

type Provider = 'openrouter' | 'groq' | 'deepseek';

type QueuedAutomationEvent = {
  at: string;
  eventName: string;
  payload: unknown;
  idempotencyKey: string;
};

type QueuedPlatformDraft = {
  at: string;
  endpoint: string;
  token: string;
  profile: string;
  payload: unknown;
};

type PlatformDraftOptions = {
  profile?: string;
  queueOnFail?: boolean;
  idempotencyKey?: string;
  silent?: boolean;
};

const API_ENDPOINTS: Record<Provider, string> = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions'
};

function normalizeHeaderValue(name: string, value: string): string {
  const cleaned = String(value || '').trim().replace(/[\r\n]+/g, ' ');
  if (!cleaned) return '';
  if (NON_LATIN1_RE.test(cleaned)) {
    throw new Error(`Недопустимые символы в ${name}. Используйте только латиницу/цифры.`);
  }
  return cleaned;
}

function normalizeBearerToken(name: string, value: string): string {
  const cleaned = normalizeHeaderValue(name, value);
  return cleaned.replace(/^bearer\s+/i, '').trim();
}

function readJwtFromStorage(): string {
  if (typeof window === 'undefined') return '';
  try {
    return String(window.localStorage.getItem('tz_backend_jwt') || '');
  } catch {
    return '';
  }
}

function makeIdempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readQueue<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue<T>(key: string, items: T[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(items.slice(-MAX_QUEUE_ITEMS)));
  } catch {
    // ignore storage errors
  }
}

function enqueueAutomationEvent(item: QueuedAutomationEvent): void {
  const queue = readQueue<QueuedAutomationEvent>(AUTOMATION_QUEUE_KEY);
  queue.push(item);
  writeQueue(AUTOMATION_QUEUE_KEY, queue);
  appendAutomationLog({
    at: new Date().toISOString(),
    event: 'automation.queue.enqueued',
    ok: true,
    note: `size=${queue.length}`
  });
}

function enqueuePlatformDraft(item: QueuedPlatformDraft): void {
  const queue = readQueue<QueuedPlatformDraft>(PLATFORM_QUEUE_KEY);
  queue.push(item);
  writeQueue(PLATFORM_QUEUE_KEY, queue);
  appendAutomationLog({
    at: new Date().toISOString(),
    event: 'platform.queue.enqueued',
    ok: true,
    note: `size=${queue.length}`
  });
}

function withDraftIdempotency(payload: unknown, idempotencyKey: string): unknown {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const body = payload as Record<string, unknown>;
    if (typeof body.idempotency_key === 'string' && body.idempotency_key.trim()) return payload;
    return { ...body, idempotency_key: idempotencyKey };
  }
  return { payload, idempotency_key: idempotencyKey };
}

function buildBackendIntegrationEndpoint(base: string): string {
  const trimmed = String(base || '').trim().replace(/\/+$/, '');
  return trimmed ? `${trimmed}/api/v1/integration/event` : '/api/v1/integration/event';
}

async function sendEventToBackend(
  settings: AutomationSettings,
  eventName: string,
  payload: unknown,
  idempotencyKey: string
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const explicitToken = normalizeBearerToken('backendApiToken', settings.backendApiToken || '');
  const jwtToken = normalizeBearerToken('backend JWT', readJwtFromStorage());
  const authToken = explicitToken || jwtToken;
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const endpoint = buildBackendIntegrationEndpoint(settings.backendApiBase);
  await axios.post(
    endpoint,
    {
      kind: eventName,
      source: 'react',
      idempotency_key: idempotencyKey,
      payload
    },
    { headers, timeout: 15000 }
  );
}

async function sendEventToWebhook(url: string, secret: string, eventName: string, payload: unknown): Promise<void> {
  if (!url) {
    throw new Error('Webhook URL не задан');
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const safeSecret = normalizeHeaderValue('X-TZ-Secret', secret);
  if (safeSecret) headers['X-TZ-Secret'] = safeSecret;
  await axios.post(
    url,
    {
      app: 'tz_generator_react',
      event: eventName,
      at: new Date().toISOString(),
      payload
    },
    { headers, timeout: 10000 }
  );
}

export function getAutomationQueueSize(): number {
  return readQueue<QueuedAutomationEvent>(AUTOMATION_QUEUE_KEY).length;
}

export function getPlatformQueueSize(): number {
  return readQueue<QueuedPlatformDraft>(PLATFORM_QUEUE_KEY).length;
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

export async function postPlatformDraft(
  endpoint: string,
  token: string,
  payload: unknown,
  options?: PlatformDraftOptions
): Promise<boolean> {
  const idempotencyKey = options?.idempotencyKey || makeIdempotencyKey('draft');
  const payloadWithIdempotency = withDraftIdempotency(payload, idempotencyKey);
  const profile = options?.profile || 'eis';
  const queueOnFail = options?.queueOnFail !== false;
  const silent = !!options?.silent;
  const endpointValue = String(endpoint || '').trim();
  try {
    if (!endpointValue) throw new Error('Endpoint коннектора не задан');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const explicitToken = normalizeBearerToken('Authorization token', token);
    const jwtToken = normalizeBearerToken('backend JWT', readJwtFromStorage());
    const authToken = explicitToken || jwtToken;
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    headers['X-Integration-Profile'] = profile;
    await axios.post(endpointValue, payloadWithIdempotency, { headers, timeout: 15000 });
    if (!silent) {
      appendAutomationLog({ at: new Date().toISOString(), event: 'platform.sent', ok: true });
    }
    return true;
  } catch {
    if (queueOnFail) {
      enqueuePlatformDraft({
        at: new Date().toISOString(),
        endpoint: endpointValue,
        token: String(token || ''),
        profile,
        payload: payloadWithIdempotency,
      });
    }
    if (!silent) {
      appendAutomationLog({ at: new Date().toISOString(), event: 'platform.failed', ok: false });
    }
    return false;
  }
}

export async function flushAutomationQueue(
  settings: AutomationSettings,
  limit = 50
): Promise<{ ok: boolean; sent: number; remaining: number }> {
  const queue = readQueue<QueuedAutomationEvent>(AUTOMATION_QUEUE_KEY);
  if (queue.length === 0) return { ok: true, sent: 0, remaining: 0 };
  if (!settings.useBackendQueueApi && !String(settings.webhookUrl || '').trim()) {
    appendAutomationLog({
      at: new Date().toISOString(),
      event: 'automation.queue.flush',
      ok: false,
      note: `no_transport; remaining=${queue.length}`
    });
    return { ok: false, sent: 0, remaining: queue.length };
  }
  const batch = queue.slice(0, limit);
  const remained = queue.slice(limit);
  let sent = 0;
  for (const item of batch) {
    try {
      if (settings.useBackendQueueApi) {
        await sendEventToBackend(settings, item.eventName, item.payload, item.idempotencyKey);
      } else {
        await sendEventToWebhook(settings.webhookUrl, settings.webhookSecret, item.eventName, item.payload);
      }
      sent += 1;
    } catch {
      remained.push(item);
    }
  }
  writeQueue(AUTOMATION_QUEUE_KEY, remained);
  appendAutomationLog({
    at: new Date().toISOString(),
    event: 'automation.queue.flush',
    ok: remained.length === 0,
    note: `sent=${sent}; remaining=${remained.length}`
  });
  return { ok: remained.length === 0, sent, remaining: remained.length };
}

export async function flushPlatformQueue(
  endpoint: string,
  token: string,
  profile = 'eis',
  limit = 50
): Promise<{ ok: boolean; sent: number; remaining: number }> {
  const queue = readQueue<QueuedPlatformDraft>(PLATFORM_QUEUE_KEY);
  if (queue.length === 0) return { ok: true, sent: 0, remaining: 0 };
  const batch = queue.slice(0, limit);
  const remained = queue.slice(limit);
  let sent = 0;
  for (const item of batch) {
    const resolvedEndpoint = String(item.endpoint || endpoint || '').trim();
    const resolvedToken = String(item.token || token || '');
    const resolvedProfile = String(item.profile || profile || 'eis');
    const ok = await postPlatformDraft(
      resolvedEndpoint,
      resolvedToken,
      item.payload,
      { profile: resolvedProfile, queueOnFail: false, silent: true }
    );
    if (ok) {
      sent += 1;
    } else {
      remained.push({
        ...item,
        endpoint: resolvedEndpoint,
        token: resolvedToken,
        profile: resolvedProfile,
      });
    }
  }
  writeQueue(PLATFORM_QUEUE_KEY, remained);
  appendAutomationLog({
    at: new Date().toISOString(),
    event: 'platform.queue.flush',
    ok: remained.length === 0,
    note: `sent=${sent}; remaining=${remained.length}`
  });
  return { ok: remained.length === 0, sent, remaining: remained.length };
}

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
  if (!settings.useBackendQueueApi && !String(settings.webhookUrl || '').trim()) {
    appendAutomationLog({
      at: new Date().toISOString(),
      event: `${eventName}.webhook`,
      ok: false,
      note: 'no_transport',
    });
    return false;
  }
  const idempotencyKey = makeIdempotencyKey(eventName);
  try {
    if (settings.useBackendQueueApi) {
      await sendEventToBackend(settings, eventName, payload, idempotencyKey);
      appendAutomationLog({ at: new Date().toISOString(), event: `${eventName}.backend`, ok: true });
      return true;
    }
    await sendEventToWebhook(settings.webhookUrl, settings.webhookSecret, eventName, payload);
    appendAutomationLog({ at: new Date().toISOString(), event: `${eventName}.webhook`, ok: true });
    return true;
  } catch {
    enqueueAutomationEvent({
      at: new Date().toISOString(),
      eventName,
      payload,
      idempotencyKey,
    });
    appendAutomationLog({
      at: new Date().toISOString(),
      event: `${eventName}.${settings.useBackendQueueApi ? 'backend' : 'webhook'}`,
      ok: false,
      note: 'queued',
    });
    return false;
  }
}
