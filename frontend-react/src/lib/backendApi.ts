/**
 * Backend API client for TZ Generator.
 * Supports:
 * - explicit backend URL (VITE_BACKEND_URL)
 * - same-origin API on Netlify via /api/* proxy redirects
 */

// If VITE_BACKEND_URL is empty, requests go to same-origin (/api/...) which
// allows Netlify to proxy API calls to the backend service.
const VITE_ENV = ((import.meta as any)?.env ?? {}) as Record<string, unknown>;
export const BACKEND_URL = (String(VITE_ENV.VITE_BACKEND_URL || '')).replace(/\/$/, '');

function buildApiUrl(path: string): string {
  return `${BACKEND_URL}${path}`;
}

export function isBackendApiAvailable(): boolean {
  if (BACKEND_URL) return true;
  if (typeof window === 'undefined') return false;
  const host = String(window.location.hostname || '').toLowerCase();
  // Netlify production or localhost with Vite proxy
  return /\.netlify\.app$/.test(host) || host === 'localhost' || host === '127.0.0.1';
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

export function getStoredUser(): { email: string; role: string; tz_count: number; tz_limit: number } | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function isLoggedIn(): boolean {
  return !!getStoredToken();
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function apiPost<T>(path: string, body: object, auth: boolean | 'optional' = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getStoredToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else if (auth !== 'optional') {
      throw new Error('Требуется авторизация');
    }
  }
  const resp = await fetch(buildApiUrl(path), { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.detail || `HTTP ${resp.status}`);
  return data as T;
}

async function apiGet<T>(path: string, auth = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (auth) {
    const token = getStoredToken();
    if (!token) throw new Error('Требуется авторизация');
    headers['Authorization'] = `Bearer ${token}`;
  }
  const resp = await fetch(buildApiUrl(path), { headers });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.detail || `HTTP ${resp.status}`);
  return data as T;
}

// ── Auth ────────────────────────────────────────────────────────────────────

export async function sendMagicLink(email: string): Promise<{ ok: boolean; message: string }> {
  return apiPost('/api/auth/send-link', { email });
}

export async function verifyMagicToken(token: string): Promise<{
  ok: boolean;
  token: string;
  user: { email: string; role: string; tz_count: number; tz_limit: number };
}> {
  return apiGet(`/api/auth/verify?token=${encodeURIComponent(token)}`);
}

export async function getMe(): Promise<{
  email: string; role: string; tz_count: number; tz_limit: number; subscription_until: string | null;
}> {
  return apiGet('/api/auth/me', true);
}

// ── AI proxy ────────────────────────────────────────────────────────────────

export async function generateWithBackend(
  provider: string,
  model: string,
  messages: { role: string; content: string }[],
  temperature = 0.1,
  maxTokens = 2048,
): Promise<string> {
  const result = await apiPost<{ ok: boolean; data: { choices?: { message?: { content?: string } }[] } }>(
    '/api/ai/generate',
    { provider, model, messages, temperature, max_tokens: maxTokens },
    'optional',
  );
  return result.data?.choices?.[0]?.message?.content || '';
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
