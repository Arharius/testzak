const DEFAULT_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization',
};

export function json(statusCode, body) {
  return {
    statusCode,
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(body),
  };
}

export function ok(body) {
  return json(200, body);
}

export function err(statusCode, detail, extra = {}) {
  return json(statusCode, { detail, ...extra });
}

export function handleOptions(event) {
  if ((event?.httpMethod || '').toUpperCase() === 'OPTIONS') {
    return json(200, { ok: true });
  }
  return null;
}

export function parseJsonBody(event) {
  try {
    return event?.body ? JSON.parse(event.body) : {};
  } catch {
    return null;
  }
}

export function envAny(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

export async function fetchText(url, options = {}, timeoutMs = 15000) {
  const { signal, done } = timeoutSignal(timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal });
    const text = await resp.text();
    return { ok: resp.ok, status: resp.status, text, headers: resp.headers };
  } finally {
    done();
  }
}

export function stripHtmlToText(html, maxChars = 8000) {
  if (!html) return '';
  let text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
  text = text.replace(/\s+/g, ' ').trim();
  return text.slice(0, maxChars);
}

export async function serperSearch(query, num = 5) {
  const apiKey = envAny('SERPER_API_KEY');
  if (!apiKey) {
    throw new Error('SERPER_API_KEY_NOT_SET');
  }
  const res = await fetchText('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num, gl: 'ru', hl: 'ru' }),
  }, 15000);
  if (!res.ok) {
    throw new Error(`SERPER_HTTP_${res.status}`);
  }
  const parsed = JSON.parse(res.text || '{}');
  return Array.isArray(parsed.organic) ? parsed.organic : [];
}

export async function fetchPageText(url, timeoutMs = 10000) {
  const skipDomains = ['youtube.com', 'facebook.com', 'vk.com', 'instagram.com', 'twitter.com', 't.me'];
  if (!url || skipDomains.some((d) => url.includes(d))) return '';
  const res = await fetchText(url, {
    method: 'GET',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8',
    },
  }, timeoutMs);
  if (!res.ok) return '';
  return stripHtmlToText(res.text, 5000);
}

function aiProviderConfig(providerRaw = 'deepseek') {
  const provider = String(providerRaw || 'deepseek').toLowerCase();
  if (provider === 'deepseek') {
    return {
      provider,
      url: 'https://api.deepseek.com/chat/completions',
      apiKey: envAny('DEEPSEEK_API_KEY', 'AI_PROXY_DEEPSEEK_API_KEY'),
      defaultModel: 'deepseek-chat',
    };
  }
  if (provider === 'groq') {
    return {
      provider,
      url: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: envAny('GROQ_API_KEY', 'AI_PROXY_GROQ_API_KEY'),
      defaultModel: 'llama-3.3-70b-versatile',
    };
  }
  if (provider === 'openrouter') {
    return {
      provider,
      url: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: envAny('OPENROUTER_API_KEY', 'AI_PROXY_OPENROUTER_API_KEY'),
      defaultModel: 'openai/gpt-4o-mini',
    };
  }
  throw new Error(`UNSUPPORTED_PROVIDER_${provider}`);
}

export async function aiChatCompletion({ provider = 'deepseek', model, messages, temperature = 0.1, max_tokens = 2048 }) {
  const cfg = aiProviderConfig(provider);
  if (!cfg.apiKey) throw new Error(`AI_KEY_NOT_SET_${cfg.provider.toUpperCase()}`);
  const payload = {
    model: model || cfg.defaultModel,
    messages,
    temperature,
    max_tokens,
    stream: false,
  };
  const headers = {
    Authorization: `Bearer ${cfg.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (cfg.provider === 'openrouter') {
    headers['HTTP-Referer'] = process.env.OPENROUTER_REFERER || 'https://tz-generator-44fz-app.netlify.app';
    headers['X-Title'] = process.env.OPENROUTER_TITLE || 'TZ Generator';
  }
  const res = await fetchText(cfg.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  }, Number(process.env.AI_TIMEOUT || 45000));
  let data = {};
  try { data = JSON.parse(res.text || '{}'); } catch { data = { raw_text: String(res.text || '').slice(0, 2000) }; }
  if (!res.ok) {
    const e = new Error(`AI_HTTP_${res.status}`);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

export async function aiExtractSpecs({ product, contextText, sourceLabel = 'источники', provider = 'deepseek' }) {
  const systemPrompt = [
    'Ты эксперт по техническим характеристикам IT-оборудования и ПО для госзакупок.',
    'Извлеки характеристики из текста и верни ТОЛЬКО JSON-массив объектов.',
    'Формат: [{"name":"Характеристика","value":"значение","unit":"ед."}]',
    'Если данных мало или нет — верни []',
    "Не добавляй комментарии, markdown и пояснения.",
  ].join(' ');
  const userPrompt = [
    `Товар: ${product}`,
    `Источник: ${sourceLabel}`,
    'Извлеки технические характеристики для вставки в ТЗ.',
    '',
    String(contextText || '').slice(0, 12000),
  ].join('\n');
  const upstream = await aiChatCompletion({
    provider,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.1,
    max_tokens: 2048,
  });
  let content = upstream?.choices?.[0]?.message?.content || '';
  content = String(content).trim();
  if (content.startsWith('```')) {
    content = content
      .split('\n')
      .filter((line) => !line.startsWith('```'))
      .join('\n')
      .trim();
  }
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({
      name: String(x.name || x.param || '').trim(),
      value: String(x.value || '').trim(),
      unit: String(x.unit || '').trim(),
    }))
    .filter((x) => x.name && x.value)
    .slice(0, 80);
}

export function summarizeSearchResults(results, queryLabel) {
  const parts = [];
  for (const r of results.slice(0, 6)) {
    const title = String(r?.title || '').trim();
    const snippet = String(r?.snippet || '').trim();
    const link = String(r?.link || '').trim();
    if (title || snippet) {
      parts.push(`${title}${snippet ? `: ${snippet}` : ''}${link ? ` [${link}]` : ''}`);
    }
  }
  return [`Запрос: ${queryLabel}`, ...parts].join('\n');
}
