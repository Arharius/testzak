/**
 * Backend API client for TZ Generator.
 * Supports:
 * - explicit backend URL (VITE_BACKEND_URL)
 * - same-origin API on Netlify via /api/* proxy redirects
 */

// If VITE_BACKEND_URL is empty, requests go to same-origin (/api/...) which
// allows Netlify to proxy API calls to the backend service.
// NOTE: Vite only replaces `import.meta.env.VITE_*` statically — dynamic access won't work.
export const BACKEND_URL = (String(import.meta.env.VITE_BACKEND_URL || '')).replace(/\/$/, '');
const NON_LATIN1_RE = /[^\x00-\xff]/;

function shouldUseSameOriginApi(): boolean {
  if (typeof window === 'undefined') return false;
  const host = String(window.location.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
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
  // Local dev with Vite proxy
  return host === 'localhost' || host === '127.0.0.1';
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
};

export function getStoredUser(): BackendUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function isLoggedIn(): boolean {
  return !!getStoredToken();
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 120_000; // 120s for AI calls (DeepSeek can take 40-60s)
const SHORT_TIMEOUT_MS = 15_000;   // 15s for auth/CRUD

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

// ── Auth ────────────────────────────────────────────────────────────────────

export async function sendMagicLink(email: string): Promise<{ ok: boolean; message: string }> {
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

export async function getMe(): Promise<BackendUser & { subscription_until: string | null }> {
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
  const result = await apiPost<{ ok: boolean; data: { choices?: { message?: { content?: string } }[] } }>(
    '/api/ai/generate',
    { provider, model, messages, temperature, max_tokens: maxTokens, timeout_sec: 100 },
    'optional',
  );
  return result.data?.choices?.[0]?.message?.content || '';
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
  );
  return result.specs || [];
}

// ── EIS search → specs ───────────────────────────────────────────────────────

export async function searchEisSpecs(query: string, goodsType: string): Promise<SpecFromSearch[]> {
  const result = await apiPost<{ ok: boolean; specs: SpecFromSearch[] }>(
    '/api/search/eis',
    { query, goods_type: goodsType },
    'optional',
  );
  return result.specs || [];
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
  rows: Array<{ type: string; model: string; qty: number; specs: unknown[]; meta: Record<string, string> }>;
  created_at: string | null;
  updated_at: string | null;
};

export async function saveTZDocument(data: {
  title?: string;
  law_mode: string;
  rows: unknown[];
  compliance_score?: number | null;
}): Promise<{ ok: boolean; id: string; title: string; created_at: string }> {
  return apiPost('/api/tz/save', data, true);
}

export async function updateTZDocument(docId: string, data: {
  title?: string;
  law_mode?: string;
  rows?: unknown[];
  compliance_score?: number | null;
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
