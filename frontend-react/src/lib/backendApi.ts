import { GOODS_CATALOG } from '../data/goods-catalog';

/**
 * Backend API client for TZ Generator.
 * Supports:
 * - explicit backend URL (VITE_BACKEND_URL)
 * - same-origin API on Netlify via /api/* proxy redirects
 */

const CURRENT_BACKEND_URL = 'https://backend-production-f736.up.railway.app';
const DEPRECATED_BACKEND_URLS = new Set([
  'https://backend-production-3b942.up.railway.app',
]);

function normalizeBackendUrl(value: string): string {
  const normalized = String(value || '').trim().replace(/\/$/, '');
  if (!normalized) return '';
  if (DEPRECATED_BACKEND_URLS.has(normalized)) return CURRENT_BACKEND_URL;
  return normalized;
}

// If VITE_BACKEND_URL is empty, requests go to same-origin (/api/...) which
// allows Netlify to proxy API calls to the backend service.
// NOTE: Vite only replaces `import.meta.env.VITE_*` statically — dynamic access won't work.
export const BACKEND_URL = normalizeBackendUrl(String(import.meta.env.VITE_BACKEND_URL || ''));
const NON_LATIN1_RE = /[^\x00-\xff]/;

function shouldUseSameOriginApi(): boolean {
  if (typeof window === 'undefined') return false;
  const host = String(window.location.hostname || '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (host.endsWith('.replit.dev') || host.endsWith('.repl.co') || host.endsWith('.janeway.replit.dev')) return true;
  return false;
}

function buildApiUrl(path: string): string {
  const normalizedPath = String(path || '').startsWith('/') ? String(path) : `/${String(path || '')}`;
  if (!BACKEND_URL || shouldUseSameOriginApi()) {
    return normalizedPath;
  }
  return `${BACKEND_URL}${normalizedPath}`;
}

function normalizeBearerToken(value: string): string {
  const cleaned = String(value || '').trim().replace(/[\r\n]+/g, ' ');
  if (!cleaned) return '';
  if (NON_LATIN1_RE.test(cleaned)) {
    throw new Error('Токен авторизации содержит недопустимые символы. Выйдите и войдите заново.');
  }
  return cleaned.replace(/^bearer\s+/i, '').trim();
}

export function isBackendApiAvailable(): boolean {
  if (BACKEND_URL) return true;
  if (typeof window === 'undefined') return false;
  const host = String(window.location.hostname || '').toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.replit.dev') ||
    host.endsWith('.repl.co') ||
    host.endsWith('.janeway.replit.dev')
  );
}

const AUTH_TOKEN_KEY = 'tz_backend_jwt';
const USER_KEY = 'tz_backend_user';

// ── Auth helpers ────────────────────────────────────────────────────────────

export function getStoredToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setStoredToken(token: string, user: object): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredAuth(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export type BackendUser = {
  email: string;
  role: string;
  tz_count: number;
  tz_limit: number;
  trial_active?: boolean;
  trial_days_left?: number;
  trial_ends_at?: string | null;
  payment_required?: boolean;
  access_tier?: 'admin' | 'pro' | 'trial' | 'payment_required';
};

export function getStoredUser(): BackendUser | null {
  if (!getStoredToken()) return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function isLoggedIn(): boolean {
  return !!getStoredToken();
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 180_000; // 180s for AI calls (DeepSeek can take 40-90s, with retry)
const SHORT_TIMEOUT_MS = 15_000;   // 15s for auth/CRUD
const SEARCH_TIMEOUT_MS = 75_000;  // vendor exact-model pages can take 20-60s; avoid falling back to generic specs too early

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const existingSignal = init.signal;
  // Merge external signal if provided
  if (existingSignal) {
    existingSignal.addEventListener('abort', () => controller.abort(existingSignal.reason));
  }
  const timer = setTimeout(() => controller.abort(new Error('Превышено время ожидания сервера')), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function _addAuth(headers: Record<string, string>, auth: boolean | 'optional'): void {
  if (!auth) return;
  const token = getStoredToken();
  if (token) {
    const safeToken = normalizeBearerToken(token);
    if (safeToken) headers['Authorization'] = `Bearer ${safeToken}`;
  } else if (auth !== 'optional') {
    throw new Error('Требуется авторизация');
  }
}

async function _handleResponse<T>(resp: Response): Promise<T> {
  let data: Record<string, unknown>;
  try {
    data = await resp.json();
  } catch {
    throw new Error(`HTTP ${resp.status}: ответ сервера не является JSON`);
  }
  if (!resp.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : `HTTP ${resp.status}`;
    throw new Error(detail);
  }
  return data as T;
}

async function apiPost<T>(path: string, body: object, auth: boolean | 'optional' = false, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  _addAuth(headers, auth);
  const resp = await fetchWithTimeout(buildApiUrl(path), { method: 'POST', headers, body: JSON.stringify(body) }, timeoutMs);
  return _handleResponse<T>(resp);
}

async function apiGet<T>(path: string, auth = false, timeoutMs = SHORT_TIMEOUT_MS): Promise<T> {
  const headers: Record<string, string> = {};
  _addAuth(headers, auth);
  const resp = await fetchWithTimeout(buildApiUrl(path), { headers }, timeoutMs);
  return _handleResponse<T>(resp);
}

async function apiPut<T>(path: string, body: object, auth = true, timeoutMs = SHORT_TIMEOUT_MS): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  _addAuth(headers, auth);
  const resp = await fetchWithTimeout(buildApiUrl(path), { method: 'PUT', headers, body: JSON.stringify(body) }, timeoutMs);
  return _handleResponse<T>(resp);
}

async function apiDelete<T>(path: string, auth = true, timeoutMs = SHORT_TIMEOUT_MS): Promise<T> {
  const headers: Record<string, string> = {};
  _addAuth(headers, auth);
  const resp = await fetchWithTimeout(buildApiUrl(path), { method: 'DELETE', headers }, timeoutMs);
  return _handleResponse<T>(resp);
}

function extractAiContentFromBody(bodyText: string): string {
  const raw = String(bodyText || '');
  if (!raw.trim()) return '';

  let streamedContent = '';
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    const jsonStr = trimmed.slice(6).trim();
    if (!jsonStr || jsonStr === '[DONE]') continue;
    try {
      const chunk = JSON.parse(jsonStr);
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) streamedContent += delta;
    } catch {
      // Skip malformed stream chunks and fall back to plain JSON parsing below.
    }
  }
  if (streamedContent.trim()) return streamedContent;

  try {
    const parsed = JSON.parse(raw);
    const content =
      parsed?.choices?.[0]?.message?.content
      ?? parsed?.choices?.[0]?.delta?.content
      ?? parsed?.choices?.[0]?.text
      ?? parsed?.message?.content
      ?? parsed?.content;
    return typeof content === 'string' ? content : '';
  } catch {
    return '';
  }
}

// ── Auth ────────────────────────────────────────────────────────────────────

export async function sendMagicLink(email: string): Promise<{
  ok: boolean;
  message: string;
  magic_link?: string;
  smtp_configured?: boolean;
}> {
  return apiPost('/api/auth/send-link', { email });
}

export async function loginWithPassword(username: string, password: string): Promise<{
  ok: boolean;
  token: string;
  user: BackendUser;
}> {
  return apiPost('/api/auth/login', { username, password }, false, SHORT_TIMEOUT_MS);
}

export async function verifyMagicToken(token: string): Promise<{
  ok: boolean;
  token: string;
  user: BackendUser;
}> {
  return apiGet(`/api/auth/verify?token=${encodeURIComponent(token)}`);
}

export async function getMe(overrideToken?: string): Promise<BackendUser & { subscription_until: string | null }> {
  if (overrideToken) {
    const headers: Record<string, string> = { Authorization: `Bearer ${overrideToken}` };
    const resp = await fetchWithTimeout(buildApiUrl('/api/auth/me'), { headers }, SHORT_TIMEOUT_MS);
    return _handleResponse(resp);
  }
  return apiGet('/api/auth/me', true);
}

// ── AI proxy ────────────────────────────────────────────────────────────────

export async function generateWithBackend(
  provider: string,
  model: string,
  messages: { role: string; content: string }[],
  temperature = 0.1,
  maxTokens = 4096,
): Promise<string> {
  // Strategy: get API key from backend (auth + usage counting), then stream directly from browser
  // This avoids Railway's 60s HTTP timeout
  try {
    return await _generateWithDirectStream(provider, model, messages, temperature, maxTokens);
  } catch (streamErr) {
    console.warn('[AI] Direct stream failed, falling back to proxy:', streamErr);
    // Fallback to non-streaming proxy (may timeout for long prompts)
    const result = await apiPost<{ ok: boolean; data: { choices?: { message?: { content?: string } }[] } }>(
      '/api/ai/generate',
      { provider, model, messages, temperature, max_tokens: maxTokens, timeout_sec: 100 },
      'optional',
    );
    return result.data?.choices?.[0]?.message?.content || '';
  }
}

/**
 * Get server-side API key, then stream AI response directly from browser to AI provider.
 * Avoids Railway 60s timeout completely.
 */
async function _generateWithDirectStream(
  provider: string,
  model: string,
  messages: { role: string; content: string }[],
  temperature: number,
  maxTokens: number,
): Promise<string> {
  // Step 1: Get API key from backend (also checks auth + counts usage)
  const keyResp = await apiPost<{ ok: boolean; key: string; url: string }>(
    '/api/ai/key',
    { provider },
    'optional',
    SHORT_TIMEOUT_MS,
  );
  if (!keyResp.key || !keyResp.url) {
    throw new Error('Не удалось получить API-ключ от сервера');
  }

  // Step 2: Stream directly from browser to AI provider
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Превышено время ожидания сервера')), DEFAULT_TIMEOUT_MS);

  const aiHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${keyResp.key}`,
  };
  if (provider.toLowerCase() === 'openrouter') {
    aiHeaders['HTTP-Referer'] = 'https://tz-generator.onrender.com';
    aiHeaders['X-Title'] = 'TZ Generator';
  }

  try {
    const resp = await fetch(keyResp.url, {
      method: 'POST',
      headers: aiHeaders,
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`AI HTTP ${resp.status}: ${text.slice(0, 300)}`);
    }
    const bodyText = await resp.text();
    const content = extractAiContentFromBody(bodyText);
    if (!content.trim()) {
      throw new Error('Пустой ответ AI-провайдера');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * AI autodetect: определяет типы товаров через бэкенд-прокси (когда нет клиентского API-ключа).
 */
export async function detectBrandTypesViaBackend(
  provider: string,
  aiModel: string,
  brandQuery: string,
  catalogKeys: string[],
  catalogLabels: Record<string, string>,
): Promise<string[]> {
  const typeList = catalogKeys.map(k => `${k}: ${catalogLabels[k] || k}`).join('\n');
  const prompt = `Ты эксперт по ИТ-оборудованию и ПО. Пользователь вводит "${brandQuery}".
Определи, какие ТИПЫ товаров выпускает этот бренд/производитель (или к какому типу относится данный продукт).

Доступные типы:
${typeList}

Ответь ТОЛЬКО JSON-массивом ключей (без пояснений):
["key1","key2","key3"]

Если бренд неизвестен или не относится ни к одному типу — верни пустой массив [].
Верни от 1 до 10 наиболее релевантных типов.`;

  try {
    const raw = await generateWithBackend(
      provider, aiModel,
      [{ role: 'user', content: prompt }],
      0.0, 256,
    );
    const match = raw.match(/\[[\s\S]*?\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    const validKeys = new Set(catalogKeys);
    return parsed.filter((k: unknown) => typeof k === 'string' && validKeys.has(k));
  } catch {
    return [];
  }
}

// ── Internet search → specs ──────────────────────────────────────────────────

export interface SpecFromSearch {
  name: string;
  value: string;
  unit: string;
}

export async function searchInternetSpecs(product: string, goodsType: string): Promise<SpecFromSearch[]> {
  const result = await apiPost<{ ok: boolean; specs: SpecFromSearch[] }>(
    '/api/search/specs',
    { product, goods_type: goodsType },
    'optional',
    SEARCH_TIMEOUT_MS,
  );
  return result.specs || [];
}

// ── EIS search → specs ───────────────────────────────────────────────────────

export async function searchEisSpecs(query: string, goodsType: string): Promise<SpecFromSearch[]> {
  const result = await apiPost<{ ok: boolean; specs: SpecFromSearch[] }>(
    '/api/search/eis',
    { query, goods_type: goodsType },
    'optional',
    SEARCH_TIMEOUT_MS,
  );
  return result.specs || [];
}

// ── Runtime health / readiness ─────────────────────────────────────────────

export type BackendHealth = {
  status: string;
  version: string;
  checked_at: string;
  readiness: 'ready' | 'degraded' | 'not_ready';
  free_tz_limit: number;
  integration_queue: number;
  integration_history: number;
  integration_enterprise_status: number;
  integration_auth_configured: boolean;
  integration_allow_anon: boolean;
  integration_target_webhook_configured: boolean;
  ai_providers: {
    deepseek: boolean;
    groq: boolean;
    openrouter: boolean;
  };
  search_module: string;
  yookassa: boolean;
};

export type BackendReadinessCheck = {
  status: 'ok' | 'degraded' | 'error';
  detail: string;
  critical: boolean;
  queue_total?: number;
  history_total?: number;
  enterprise_status_total?: number;
  providers?: Record<string, boolean>;
  simulation_mode_default?: boolean;
  target_webhook_configured?: boolean;
};

export type BackendReadiness = {
  ok: boolean;
  ready: boolean;
  status: 'ready' | 'degraded' | 'not_ready';
  version: string;
  checked_at: string;
  summary: string;
  checks: Record<string, BackendReadinessCheck>;
  free_tz_limit: number;
  integration_auth_configured: boolean;
  integration_allow_anon: boolean;
  integration_target_webhook_configured: boolean;
  ai_providers: {
    deepseek: boolean;
    groq: boolean;
    openrouter: boolean;
  };
  search_module: string;
  yookassa: boolean;
  queue_total: number;
  history_total: number;
  enterprise_status_total: number;
};

export async function getBackendHealth(): Promise<BackendHealth> {
  return apiGet('/health', false, SHORT_TIMEOUT_MS);
}

export async function getBackendReadiness(): Promise<BackendReadiness> {
  return apiGet('/api/v1/readiness', false, SHORT_TIMEOUT_MS);
}

// ── Payment ──────────────────────────────────────────────────────────────────

export async function createPayment(plan: 'pro' | 'annual'): Promise<{
  ok: boolean;
  payment_id: string;
  confirmation_url: string;
  status: string;
}> {
  return apiPost('/api/payment/create', { plan }, true);
}

// ── Enterprise automation hub ──────────────────────────────────────────────

export type EnterpriseAutopilotStage = {
  name: string;
  ok: boolean;
  detail: string;
  data?: Record<string, unknown>;
};

export type EnterpriseAutopilotResult = {
  ok: boolean;
  stages_total: number;
  stages_success: number;
  stages_failed: number;
  stages_skipped: number;
  queued_retry_records: string[];
  stages: EnterpriseAutopilotStage[];
};

export async function getEnterpriseHealth(): Promise<{
  ok: boolean;
  access: string;
  queue_total: number;
  history_total: number;
  enterprise_status_total: number;
}> {
  return apiGet('/api/v1/enterprise/health', false);
}

export async function runEnterpriseAutopilot(
  payload: Record<string, unknown>,
  settings: Record<string, unknown>,
  procedureId = '',
): Promise<{
  ok: boolean;
  access: string;
  result: EnterpriseAutopilotResult;
  immutable_audit?: { at: string; action: string; prev_hash: string; hash: string } | null;
}> {
  return apiPost(
    '/api/v1/enterprise/autopilot',
    {
      payload,
      settings,
      procedure_id: procedureId,
      idempotency_key: `enterprise-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    },
    'optional',
  );
}

// ── TZ Document History ───────────────────────────────────────────────────

export type TZDocumentSummary = {
  id: string;
  title: string;
  goods_type: string;
  model: string;
  law_mode: string;
  compliance_score: number | null;
  readiness_status?: string | null;
  readiness_blockers?: number | null;
  rows_count: number;
  created_at: string | null;
  updated_at: string | null;
};

export type TZDocumentFull = {
  id: string;
  title: string;
  goods_type: string;
  model: string;
  law_mode: string;
  compliance_score: number | null;
  readiness?: {
    status?: string;
    blockers?: string[];
    warnings?: string[];
    antiFas?: Record<string, unknown>;
    benchmark?: Record<string, unknown>;
    legal?: Record<string, unknown>;
  } | null;
  publication_dossier?: {
    status?: string;
    readyItems?: number;
    reviewItems?: number;
    blockedItems?: number;
    trustedClassification?: number;
    benchmarkReady?: number;
    serviceReady?: number;
    rows?: Array<{
      index: string;
      item: string;
      status: string;
      classifier: string;
      quality: string;
      action: string;
    }>;
  } | null;
  rows: Array<{
    type: string;
    model: string;
    licenseType?: string;
    term?: string;
    qty: number;
    status?: 'idle' | 'loading' | 'done' | 'error';
    error?: string;
    specs: unknown[];
    meta: Record<string, string>;
    benchmark?: unknown | null;
    import_info?: unknown | null;
    split_group?: string | null;
  }>;
  created_at: string | null;
  updated_at: string | null;
};

const LOCAL_TZ_DOCS_KEY = 'tz_local_documents_v1';
const LOCAL_TZ_PREFIX = 'local-';

const _INVALID_SPEC_NAME_RE = /^(#+\s|\[|!\[|https?:\/\/|\/\/|home$|consumers$|utilities$|transportation$|about(\s+us)?$|documents(\s+and\s+rules)?$|news$|events$|help(\s+center)?$|search$|title$|content(\s+viewer)?$|contact$|login$|logout$|register$|faq$|sitemap$|privacy$|terms$|navigation$|menu$|footer$|header$|back$|next$|previous$|skip$|sort(\s+by)?$|sign(\s+(in|out|up))?$|log(\s+(in|out))?$|community$|announcements?$|feature\s+requests?$)/i;
const _BARE_DOMAIN_RE = /^[a-z0-9][a-z0-9.-]*\.(gov|com|org|net|ru|рф|edu|io|info|biz)$/i;
const _URL_PATH_RE = /^\/[a-z0-9/._-]{3,}$/i;
const _EMBEDDED_URL_RE = /https?:\/\/[a-z0-9]/i;
const _MARKDOWN_STYLE_RE = /^\*{1,3}[^*]+\*{1,3}$/;

function _isCleanSpec(name: string, value: string): boolean {
  const n = String(name || '').trim();
  const v = String(value || '').trim();
  if (!n) return false;
  if (_INVALID_SPEC_NAME_RE.test(n)) return false;
  if (_BARE_DOMAIN_RE.test(n)) return false;
  if (/^title:\s/i.test(n)) return false;
  if (/:\s+[A-Z]/.test(n) && !/[а-яёА-ЯЁ]/.test(n) && n.length > 20) return false;
  if (!v) return true;
  if (/^(https?:\/\/|\/\/[a-z0-9])/i.test(v)) return false;
  if (_BARE_DOMAIN_RE.test(v)) return false;
  if (_URL_PATH_RE.test(v)) return false;
  if (_MARKDOWN_STYLE_RE.test(v)) return false;
  if (_EMBEDDED_URL_RE.test(v)) return false;
  return true;
}

function _sanitizeDocSpecs(doc: TZDocumentFull): TZDocumentFull {
  if (!doc.rows || !Array.isArray(doc.rows)) return doc;
  const cleanedRows = doc.rows.map((row) => {
    if (!Array.isArray(row.specs)) return row;
    return {
      ...row,
      specs: (row.specs as Array<{ name?: string; value?: string }>).filter(
        (s) => _isCleanSpec(String(s?.name || ''), String(s?.value || '')),
      ),
    };
  });
  return { ...doc, rows: cleanedRows };
}

function readLocalTZDocs(): TZDocumentFull[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_TZ_DOCS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as TZDocumentFull[]).map(_sanitizeDocSpecs);
  } catch {
    return [];
  }
}

function writeLocalTZDocs(items: TZDocumentFull[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LOCAL_TZ_DOCS_KEY, JSON.stringify(items.slice(0, 100)));
}

function sortLocalTZDocs(items: TZDocumentFull[]): TZDocumentFull[] {
  return [...items].sort((a, b) => {
    const aTime = Date.parse(a.updated_at || a.created_at || '') || 0;
    const bTime = Date.parse(b.updated_at || b.created_at || '') || 0;
    return bTime - aTime;
  });
}

function summarizeTZDoc(doc: TZDocumentFull): TZDocumentSummary {
  return {
    id: doc.id,
    title: doc.title,
    goods_type: doc.goods_type,
    model: doc.model,
    law_mode: doc.law_mode,
    compliance_score: doc.compliance_score,
    readiness_status: doc.readiness?.status ?? null,
    readiness_blockers: Array.isArray(doc.readiness?.blockers) ? doc.readiness?.blockers.length ?? 0 : 0,
    rows_count: Array.isArray(doc.rows) ? doc.rows.length : 0,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

function buildTZTitle(data: { title?: string; rows?: unknown[] }): { title: string; goodsType: string; model: string } {
  const explicitTitle = String(data.title || '').trim();
  const first = Array.isArray(data.rows) && typeof data.rows[0] === 'object' && data.rows[0] !== null
    ? data.rows[0] as Record<string, unknown>
    : {};
  const goodsType = String(first.type || '');
  const model = String(first.model || '');
  const catalogName = goodsType && GOODS_CATALOG[goodsType] ? GOODS_CATALOG[goodsType].name : '';
  const generated = catalogName || goodsType || 'Без названия';
  return {
    title: explicitTitle || generated || 'Без названия',
    goodsType,
    model,
  };
}

export function isLocalTZDocumentId(docId: string): boolean {
  return String(docId || '').startsWith(LOCAL_TZ_PREFIX);
}

export async function saveTZDocumentLocal(data: {
  title?: string;
  law_mode: string;
  rows: unknown[];
  compliance_score?: number | null;
  readiness?: TZDocumentFull['readiness'];
  publication_dossier?: TZDocumentFull['publication_dossier'];
}): Promise<{ ok: boolean; id: string; title: string; created_at: string }> {
  const now = new Date().toISOString();
  const meta = buildTZTitle(data);
  const doc: TZDocumentFull = {
    id: `${LOCAL_TZ_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: meta.title,
    goods_type: meta.goodsType,
    model: meta.model,
    law_mode: data.law_mode || '44',
    compliance_score: data.compliance_score ?? null,
    readiness: data.readiness ?? null,
    publication_dossier: data.publication_dossier ?? null,
    rows: Array.isArray(data.rows) ? data.rows as TZDocumentFull['rows'] : [],
    created_at: now,
    updated_at: now,
  };
  const docs = sortLocalTZDocs([doc, ...readLocalTZDocs()].filter((item, idx, arr) => arr.findIndex((candidate) => candidate.id === item.id) === idx));
  writeLocalTZDocs(docs);
  return { ok: true, id: doc.id, title: doc.title, created_at: now };
}

export async function listLocalTZDocuments(limit = 50, offset = 0): Promise<{ ok: boolean; total: number; items: TZDocumentSummary[] }> {
  const docs = sortLocalTZDocs(readLocalTZDocs());
  const sliced = docs.slice(offset, offset + limit).map(summarizeTZDoc);
  return { ok: true, total: docs.length, items: sliced };
}

export async function getLocalTZDocument(docId: string): Promise<{ ok: boolean; doc: TZDocumentFull }> {
  const doc = readLocalTZDocs().find((item) => item.id === docId);
  if (!doc) throw new Error('Документ не найден');
  return { ok: true, doc };
}

export async function deleteLocalTZDocument(docId: string): Promise<{ ok: boolean; deleted: string }> {
  const docs = readLocalTZDocs();
  const nextDocs = docs.filter((item) => item.id !== docId);
  writeLocalTZDocs(nextDocs);
  return { ok: true, deleted: docId };
}

export async function saveTZDocument(data: {
  title?: string;
  law_mode: string;
  rows: unknown[];
  compliance_score?: number | null;
  readiness?: TZDocumentFull['readiness'];
  publication_dossier?: TZDocumentFull['publication_dossier'];
}): Promise<{ ok: boolean; id: string; title: string; created_at: string }> {
  return apiPost('/api/tz/save', data, true);
}

export async function updateTZDocument(docId: string, data: {
  title?: string;
  law_mode?: string;
  rows?: unknown[];
  compliance_score?: number | null;
  readiness?: TZDocumentFull['readiness'];
  publication_dossier?: TZDocumentFull['publication_dossier'];
}): Promise<{ ok: boolean; id: string; updated_at: string }> {
  return apiPut(`/api/tz/${docId}`, data);
}

export async function listTZDocuments(limit = 50, offset = 0): Promise<{ ok: boolean; total: number; items: TZDocumentSummary[] }> {
  return apiGet(`/api/tz/list?limit=${limit}&offset=${offset}`, true);
}

export async function getTZDocument(docId: string): Promise<{ ok: boolean; doc: TZDocumentFull }> {
  return apiGet(`/api/tz/${docId}`, true);
}

export async function deleteTZDocument(docId: string): Promise<{ ok: boolean; deleted: string }> {
  return apiDelete(`/api/tz/${docId}`);
}

export interface TZRiskItem {
  type: string;
  phrase: string;
  field: string;
  context: string;
  message: string;
  recommendation: string;
}

export interface TZValidateResponse {
  can_export: boolean;
  critical: TZRiskItem[];
  moderate: TZRiskItem[];
}

export interface TZValidateSpec {
  name: string;
  value: string;
  group: string;
}

export interface TZValidateRowInput {
  name: string;
  field: string;
  description?: string;
  specs?: TZValidateSpec[];
}

export async function validateTzBeforeExport(
  rows: TZValidateRowInput[],
  description?: string,
): Promise<TZValidateResponse> {
  return apiPost<TZValidateResponse>('/api/tz/validate', { rows, description: description ?? '' });
}
