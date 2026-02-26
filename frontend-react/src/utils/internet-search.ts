/**
 * Утилиты интернет-поиска:
 * - Яндекс Suggest (JSONP, без VPN, без CORS-проблем)
 * - Ссылки для поиска готовых ТЗ на zakupki.gov.ru через Яндекс и прямой ЕИС
 */

// ── JSONP-запрос ──────────────────────────────────────────────────────────────

export function jsonpRequest(
  url: string,
  callbackParam = 'callback',
  timeoutMs = 5000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cbName =
      '__tzJsonp_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const sep = url.includes('?') ? '&' : '?';
    const script = document.createElement('script');
    let done = false;
    const win = window as unknown as Record<string, unknown>;

    const cleanup = () => {
      try {
        delete win[cbName];
      } catch (_) {
        win[cbName] = undefined;
      }
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error('jsonp_timeout'));
    }, timeoutMs);

    win[cbName] = (...args: unknown[]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      resolve(args.length === 1 ? args[0] : args);
    };

    script.async = true;
    script.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error('jsonp_error'));
    };
    script.src = `${url}${sep}${callbackParam}=${encodeURIComponent(cbName)}`;
    (document.head || document.body).appendChild(script);
  });
}

// ── Яндекс Suggest ───────────────────────────────────────────────────────────

function flattenStrings(val: unknown, out: string[] = []): string[] {
  if (typeof val === 'string') {
    const s = val.trim();
    if (s && s.length > 2) out.push(s);
  } else if (Array.isArray(val)) {
    for (const item of val) flattenStrings(item, out);
  } else if (val && typeof val === 'object') {
    for (const v of Object.values(val as Record<string, unknown>))
      flattenStrings(v, out);
  }
  return out;
}

function extractSuggestItems(payload: unknown, query: string): string[] {
  const all = flattenStrings(payload);
  const qLower = query.toLowerCase().trim();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of all) {
    const clean = text.replace(/\s+/g, ' ').trim();
    const key = clean.toLowerCase();
    if (key === qLower || seen.has(key)) continue;
    if (key.length < 4) continue;
    // Отбрасываем технический мусор (длинные URL, callback-имена и т.д.)
    if (/^https?:\/\//i.test(clean)) continue;
    if (/^__tzJsonp/i.test(clean)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Получает подсказки из Яндекс Suggest через JSONP (без VPN/прокси).
 * Возвращает массив строк (пустой если сеть недоступна).
 */
export async function fetchYandexSuggest(query: string): Promise<string[]> {
  const q = query.trim();
  if (!q) return [];

  const endpoints = [
    'https://suggest.yandex.ru/suggest-ya.cgi?part=' +
      encodeURIComponent(q) +
      '&v=4&uil=ru',
    'https://yandex.ru/suggest/suggest-ya.cgi?part=' +
      encodeURIComponent(q) +
      '&v=4&uil=ru',
  ];

  for (const url of endpoints) {
    try {
      const payload = await jsonpRequest(url, 'callback', 4500);
      const items = extractSuggestItems(payload, q);
      if (items.length > 0) return items;
    } catch (_) {
      // следующий endpoint
    }
  }
  return [];
}

// ── Ссылки на поиск готовых ТЗ ───────────────────────────────────────────────

export interface SearchLink {
  title: string;
  url: string;
}

/**
 * Строит ссылки для поиска готовых ТЗ на zakupki.gov.ru через Яндекс (без VPN).
 * Открывать нужно в новой вкладке (target="_blank").
 */
export function buildZakupkiSearchLinks(query: string): SearchLink[] {
  const q = query.trim();
  if (!q) return [];

  return [
    {
      title: '🔎 Яндекс: ТЗ на zakupki.gov.ru',
      url:
        'https://yandex.ru/search/?text=' +
        encodeURIComponent(`site:zakupki.gov.ru ${q} "техническое задание"`),
    },
    {
      title: '📋 Яндекс: описание объекта закупки',
      url:
        'https://yandex.ru/search/?text=' +
        encodeURIComponent(
          `site:zakupki.gov.ru ${q} "описание объекта закупки"`
        ),
    },
    {
      title: '🏛️ Прямой поиск в ЕИС (zakupki.gov.ru)',
      url:
        'https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString=' +
        encodeURIComponent(`${q} техническое задание`),
    },
  ];
}

// ── Кэш ──────────────────────────────────────────────────────────────────────

const suggestCache = new Map<string, string[]>();

export async function getCachedSuggest(query: string): Promise<string[]> {
  const key = query.trim().toLowerCase();
  if (!key) return [];
  if (suggestCache.has(key)) return suggestCache.get(key)!;
  const result = await fetchYandexSuggest(query);
  suggestCache.set(key, result);
  return result;
}
