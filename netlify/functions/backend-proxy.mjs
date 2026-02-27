import { handleOptions, envAny } from './_shared.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization, X-API-Token',
  'cache-control': 'no-store',
};

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-nf-request-id',
]);

function response(statusCode, body, contentType = 'application/json; charset=utf-8') {
  return {
    statusCode,
    headers: {
      ...CORS_HEADERS,
      'content-type': contentType,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

const FALLBACK_STORE_FILE = '/tmp/tz_netlify_backend_proxy_store.json';

function parseJsonBody(event) {
  try {
    if (!event?.body) return {};
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : String(event.body);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function defaultStore() {
  return {
    queue: [],
    history: [],
    enterprise_status: [],
    audit: [],
    idempotency: {},
  };
}

function loadFallbackStore() {
  try {
    if (!existsSync(FALLBACK_STORE_FILE)) return defaultStore();
    const raw = JSON.parse(readFileSync(FALLBACK_STORE_FILE, 'utf8'));
    if (!raw || typeof raw !== 'object') return defaultStore();
    return {
      queue: Array.isArray(raw.queue) ? raw.queue : [],
      history: Array.isArray(raw.history) ? raw.history : [],
      enterprise_status: Array.isArray(raw.enterprise_status) ? raw.enterprise_status : [],
      audit: Array.isArray(raw.audit) ? raw.audit : [],
      idempotency: raw.idempotency && typeof raw.idempotency === 'object' ? raw.idempotency : {},
    };
  } catch {
    return defaultStore();
  }
}

function saveFallbackStore(store) {
  try {
    mkdirSync(dirname(FALLBACK_STORE_FILE), { recursive: true });
    writeFileSync(FALLBACK_STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch {
    // ignore storage errors in serverless fallback mode
  }
}

function pushAudit(store, action, status, note = '') {
  store.audit.push({
    id: randomUUID(),
    at: nowIso(),
    action,
    status,
    note: String(note || '').slice(0, 280),
  });
  if (store.audit.length > 2000) {
    store.audit = store.audit.slice(-2000);
  }
}

function parsePathOnly(pathAndQuery) {
  const idx = pathAndQuery.indexOf('?');
  return idx === -1 ? pathAndQuery : pathAndQuery.slice(0, idx);
}

function computeEnterpriseResult(payload, settings) {
  const cfg = settings && typeof settings === 'object' ? settings : {};
  const simulationMode = cfg.simulationMode !== false;
  const stages = [];
  const push = (name, ok, detail, data = {}) => {
    stages.push({ name, ok, detail, data });
  };

  if (cfg.etpBidirectionalStatus === false) {
    push('etp.status.sync', false, 'skipped_disabled');
  } else if (cfg.etpEndpoint || simulationMode) {
    push('etp.status.sync', true, cfg.etpEndpoint ? 'simulated_endpoint' : 'simulated', {
      procedure_id: payload?.procedure_id || '',
      status: 'draft',
    });
  } else {
    push('etp.status.sync', false, 'skipped_not_configured');
  }

  if (cfg.ecmEndpoint || simulationMode) {
    push('ecm.approval.submit', true, cfg.ecmEndpoint ? 'simulated_endpoint' : 'simulated', {
      route: String(cfg.ecmApprovalRoute || 'Юрист -> ИБ -> Финконтроль -> Руководитель'),
    });
  } else {
    push('ecm.approval.submit', false, 'skipped_not_configured');
  }

  if (cfg.erpEndpoint || simulationMode) {
    const modules = [];
    if (cfg.erpSyncNsi !== false) modules.push('nsi');
    if (cfg.erpSyncBudget !== false) modules.push('budget');
    if (cfg.erpSyncContracts !== false) modules.push('contracts');
    if (cfg.erpSyncLimits !== false) modules.push('limits');
    push('erp.sync', true, cfg.erpEndpoint ? 'simulated_endpoint' : 'simulated', { modules });
  } else {
    push('erp.sync', false, 'skipped_not_configured');
  }

  if (cfg.cryptoEndpoint || simulationMode) {
    push('crypto.sign', true, cfg.cryptoEndpoint ? 'simulated_endpoint' : 'simulated', {
      provider: String(cfg.cryptoProvider || 'cryptopro'),
    });
  } else {
    push('crypto.sign', false, 'skipped_not_configured');
  }

  const stages_success = stages.filter((x) => x.ok).length;
  const stages_failed = stages.filter((x) => !x.ok && !String(x.detail || '').startsWith('skipped_')).length;
  const stages_skipped = stages.filter((x) => String(x.detail || '').startsWith('skipped_')).length;
  return {
    ok: stages_failed === 0,
    stages_total: stages.length,
    stages_success,
    stages_failed,
    stages_skipped,
    queued_retry_records: [],
    stages,
  };
}

function fallbackApi(method, pathOnly, event) {
  const store = loadFallbackStore();

  // Integration queue API
  if (method === 'POST' && pathOnly === '/api/v1/integration/event') {
    const body = parseJsonBody(event);
    if (body === null) return response(400, { detail: 'invalid_json' });
    const idem = String(body.idempotency_key || '').trim();
    if (idem && store.idempotency[idem]) {
      return response(200, { ...store.idempotency[idem], duplicate: true });
    }
    const record = {
      id: randomUUID(),
      kind: String(body.kind || 'integration.event'),
      source: String(body.source || 'ui'),
      payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
      status: 'queued',
      created_at: nowIso(),
      attempts: 0,
    };
    store.queue.push(record);
    if (store.queue.length > 3000) store.queue = store.queue.slice(-3000);
    const res = { ok: true, record_id: record.id, status: record.status };
    if (idem) store.idempotency[idem] = res;
    pushAudit(store, 'integration.event', 'ok', record.kind);
    saveFallbackStore(store);
    return response(200, res);
  }

  if (method === 'POST' && pathOnly === '/api/v1/integration/draft') {
    const body = parseJsonBody(event);
    if (body === null) return response(400, { detail: 'invalid_json' });
    const idem = String(body.idempotency_key || '').trim();
    if (idem && store.idempotency[idem]) {
      return response(200, { ...store.idempotency[idem], duplicate: true });
    }
    const record = {
      id: randomUUID(),
      kind: 'procurement.draft',
      source: 'platform_connector',
      payload: body && typeof body === 'object' ? body : {},
      status: 'queued',
      created_at: nowIso(),
      attempts: 0,
    };
    store.queue.push(record);
    if (store.queue.length > 3000) store.queue = store.queue.slice(-3000);
    const res = { ok: true, record_id: record.id, status: record.status };
    if (idem) store.idempotency[idem] = res;
    pushAudit(store, 'integration.draft', 'ok', 'queued');
    saveFallbackStore(store);
    return response(200, res);
  }

  if (method === 'GET' && pathOnly === '/api/v1/integration/queue') {
    return response(200, {
      ok: true,
      access: 'fallback',
      queue_total: store.queue.length,
      history_total: store.history.length,
      enterprise_status_total: store.enterprise_status.length,
      latest_queue: store.queue.slice(-20),
      latest_history: store.history.slice(-20),
      latest_enterprise_status: store.enterprise_status.slice(-20),
      target_webhook_configured: false,
    });
  }

  if (method === 'POST' && pathOnly === '/api/v1/integration/audit') {
    const body = parseJsonBody(event) || {};
    const limit = Math.max(1, Math.min(1000, Number(body.limit || 100)));
    return response(200, {
      ok: true,
      total: Math.min(limit, store.audit.length),
      items: store.audit.slice(-limit).reverse(),
    });
  }

  if (method === 'POST' && pathOnly === '/api/v1/integration/flush') {
    const body = parseJsonBody(event) || {};
    const limit = Math.max(1, Math.min(500, Number(body.limit || 100)));
    let processed = 0;
    let success = 0;
    while (processed < limit && store.queue.length > 0) {
      const item = store.queue.shift();
      if (!item) break;
      item.status = 'sent';
      item.sent_at = nowIso();
      store.history.push(item);
      processed += 1;
      success += 1;
    }
    if (store.history.length > 10000) store.history = store.history.slice(-10000);
    pushAudit(store, 'integration.flush', 'ok', `processed=${processed}`);
    saveFallbackStore(store);
    return response(200, {
      ok: true,
      processed,
      success,
      failed: 0,
      queue_remaining: store.queue.length,
      target_configured: false,
    });
  }

  // Enterprise simulation API
  if (method === 'GET' && pathOnly === '/api/v1/enterprise/health') {
    return response(200, {
      ok: true,
      access: 'fallback',
      queue_total: store.queue.length,
      history_total: store.history.length,
      enterprise_status_total: store.enterprise_status.length,
      integration_auth_configured: false,
      integration_allow_anon: true,
      target_webhook_configured: false,
      simulation_mode_default: true,
    });
  }

  if (method === 'GET' && pathOnly === '/api/v1/enterprise/status') {
    return response(200, {
      ok: true,
      total: store.enterprise_status.length,
      items: store.enterprise_status.slice(-50),
    });
  }

  if (method === 'POST' && pathOnly === '/api/v1/enterprise/autopilot') {
    const body = parseJsonBody(event);
    if (body === null) return response(400, { detail: 'invalid_json' });
    const idem = String(body.idempotency_key || '').trim();
    if (idem && store.idempotency[idem]) {
      return response(200, { ...store.idempotency[idem], duplicate: true });
    }
    const result = computeEnterpriseResult(body.payload || {}, body.settings || {});
    const statusRecord = {
      at: nowIso(),
      procedure_id: String(body.procedure_id || ''),
      summary: {
        success: result.stages_success,
        failed: result.stages_failed,
        skipped: result.stages_skipped,
      },
      stages: result.stages,
    };
    store.enterprise_status.push(statusRecord);
    if (store.enterprise_status.length > 2000) {
      store.enterprise_status = store.enterprise_status.slice(-2000);
    }
    const res = {
      ok: true,
      access: 'fallback',
      result,
      immutable_audit: {
        at: nowIso(),
        action: 'enterprise.autopilot',
        prev_hash: 'fallback',
        hash: randomUUID().replace(/-/g, ''),
      },
    };
    if (idem) store.idempotency[idem] = res;
    pushAudit(store, 'enterprise.autopilot', result.ok ? 'ok' : 'partial', `stages=${result.stages_total}`);
    saveFallbackStore(store);
    return response(200, res);
  }

  if (method === 'GET' && pathOnly === '/api/v1/ping') {
    return response(200, { ok: true, message: 'pong' });
  }

  return response(503, { detail: 'BACKEND_API_BASE_URL_NOT_SET' });
}

function getUpstreamBase() {
  return envAny(
    'BACKEND_API_BASE_URL',
    'API_UPSTREAM_BASE_URL',
    'TZ_BACKEND_UPSTREAM_URL',
  );
}

function buildPathAndQuery(event) {
  const rawQuery = String(event?.rawQuery || '');
  const params = new URLSearchParams(rawQuery);
  let splat = String(params.get('path') || '').trim();
  params.delete('path');

  if (!splat) {
    splat = String(event?.queryStringParameters?.path || '').trim();
  }
  if (!splat) {
    const rawPath = String(event?.path || '');
    if (rawPath.startsWith('/api/')) {
      splat = rawPath.slice('/api/'.length);
    } else {
      const marker = '/.netlify/functions/backend-proxy/';
      const idx = rawPath.indexOf(marker);
      if (idx >= 0) {
        splat = rawPath.slice(idx + marker.length);
      }
    }
  }
  splat = splat.replace(/^\/+/, '');
  if (splat.startsWith('api/')) {
    splat = splat.slice(4);
  }

  const query = params.toString();
  const path = `/api/${splat}`;
  return query ? `${path}?${query}` : path;
}

function filteredHeaders(eventHeaders = {}) {
  const headers = {};
  for (const [key, value] of Object.entries(eventHeaders)) {
    if (!value) continue;
    if (HOP_BY_HOP_HEADERS.has(String(key).toLowerCase())) continue;
    headers[key] = String(value);
  }
  return headers;
}

export async function handler(event) {
  const preflight = handleOptions(event);
  if (preflight) {
    return {
      ...preflight,
      headers: {
        ...(preflight.headers || {}),
        ...CORS_HEADERS,
      },
    };
  }

  const base = getUpstreamBase();
  const method = String(event?.httpMethod || 'GET').toUpperCase();
  const pathAndQuery = buildPathAndQuery(event);
  const pathOnly = parsePathOnly(pathAndQuery);

  if (!base) {
    return fallbackApi(method, pathOnly, event);
  }

  let baseUrl;
  try {
    baseUrl = new URL(base);
  } catch {
    return response(500, { detail: 'BACKEND_API_BASE_URL_INVALID' });
  }

  const currentHost = String(event?.headers?.host || '').toLowerCase();
  if (currentHost && baseUrl.host.toLowerCase() === currentHost) {
    return response(500, { detail: 'BACKEND_API_BASE_URL_LOOP_DETECTED' });
  }

  const target = new URL(pathAndQuery, `${baseUrl.origin}/`).toString();
  const headers = filteredHeaders(event?.headers || {});
  let body;

  if (method !== 'GET' && method !== 'HEAD') {
    if (typeof event?.body === 'string') {
      body = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64')
        : event.body;
    }
  }

  try {
    const upstream = await fetch(target, { method, headers, body });
    const text = await upstream.text();
    const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
    return response(upstream.status, text, contentType);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'proxy_error';
    return response(502, { detail: `BACKEND_PROXY_FAILED: ${detail}` });
  }
}
