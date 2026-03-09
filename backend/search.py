"""
Search module for TZ Generator backend.
- search_internet_specs: DuckDuckGo (free, keyless) → AI extracts specs
- search_eis_specs: DuckDuckGo site:zakupki.gov.ru + other procurement portals → AI extracts specs

NOTE: Direct zakupki.gov.ru access is blocked (SSL timeout from cloud IPs).
All EIS data is fetched via DuckDuckGo site: filters as a proxy.
"""
import os
import json
import logging
import asyncio
import re
import time
from html import unescape
from urllib.request import Request as URLRequest, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import quote_plus, parse_qs, unquote, urlparse
from html.parser import HTMLParser
from typing import Any
import ssl

logger = logging.getLogger(__name__)

# SSL context — use certifi if available, else unverified (macOS Python issue)
def _make_ssl_ctx() -> ssl.SSLContext:
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    ctx = ssl.create_default_context()
    # Quick probe: if default certs work, use them
    import socket
    try:
        with ctx.wrap_socket(socket.socket(), server_hostname="yandex.ru") as s:
            s.settimeout(5)
            s.connect(("yandex.ru", 443))
        return ctx
    except Exception:
        pass
    # Fallback: unverified (safe for search scraping)
    return ssl._create_unverified_context()

_ssl_ctx = _make_ssl_ctx()

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
AI_TIMEOUT = float(os.getenv("AI_TIMEOUT", "45"))


# ── In-memory cache (TTL 30 min) ─────────────────────────────
_cache: dict[str, tuple[float, list[dict]]] = {}
_CACHE_TTL = 1800  # 30 minutes

def _cache_get(key: str) -> list[dict] | None:
    entry = _cache.get(key)
    if entry and (time.time() - entry[0]) < _CACHE_TTL:
        return entry[1]
    if entry:
        del _cache[key]
    return None

def _cache_set(key: str, value: list[dict]):
    # Evict old entries if cache grows too large
    if len(_cache) > 200:
        cutoff = time.time() - _CACHE_TTL
        keys_to_del = [k for k, (ts, _) in _cache.items() if ts < cutoff]
        for k in keys_to_del:
            del _cache[k]
    _cache[key] = (time.time(), value)


# ── HTML text extractor ─────────────────────────────────────────
class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self._chunks: list[str] = []
        self._skip_tags = {"script", "style", "meta", "link", "noscript", "nav", "footer", "header"}
        self._current_skip = 0

    def handle_starttag(self, tag, attrs):
        if tag.lower() in self._skip_tags:
            self._current_skip += 1

    def handle_endtag(self, tag):
        if tag.lower() in self._skip_tags:
            self._current_skip = max(0, self._current_skip - 1)

    def handle_data(self, data):
        if self._current_skip == 0:
            text = data.strip()
            if text:
                self._chunks.append(text)

    def get_text(self) -> str:
        return " ".join(self._chunks)


def _extract_text_from_html(html: str, max_chars: int = 12000) -> str:
    parser = _TextExtractor()
    try:
        parser.feed(html)
        return parser.get_text()[:max_chars]
    except Exception:
        return html[:max_chars]


_ssl_ctx_unverified = ssl._create_unverified_context()


def _fetch_url(url: str, timeout: int = 12) -> str:
    """Fetch URL, return text content. Retries with unverified SSL on cert errors."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    }
    req = URLRequest(url, headers=headers, method="GET")
    for ctx in (_ssl_ctx, _ssl_ctx_unverified):
        try:
            with urlopen(req, timeout=timeout, context=ctx) as resp:
                raw = resp.read()
                encoding = resp.headers.get_content_charset("utf-8") or "utf-8"
                return raw.decode(encoding, errors="replace")
        except ssl.SSLError:
            continue  # retry with unverified context
        except Exception as e:
            logger.warning(f"fetch_url failed {url}: {e}")
            return ""
    logger.warning(f"fetch_url SSL failed for both contexts: {url}")
    return ""


def _strip_tags(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text or "").replace("\n", " ").strip()


# ── Goods type → search hints mapping ────────────────────────────
_TYPE_SEARCH_HINTS: dict[str, str] = {
    # Software
    "os": "операционная система",
    "office": "офисный пакет",
    "virt": "платформа виртуализации",
    "vdi": "VDI виртуальные рабочие места",
    "dbms": "СУБД система управления базами данных",
    "erp": "ERP бухгалтерское ПО 1С",
    "cad": "САПР система автоматизированного проектирования",
    "license": "лицензия на программное обеспечение",
    "antivirus": "антивирус антивирусная защита",
    "edr": "EDR защита конечных точек",
    "firewall_sw": "межсетевой экран программный",
    "dlp": "DLP защита от утечек",
    "siem": "SIEM система мониторинга безопасности",
    "crypto": "СКЗИ средства криптографической защиты",
    "waf": "WAF защита веб-приложений",
    "pam": "PAM привилегированный доступ",
    "iam": "IAM IdM управление доступом идентификация",
    "pki": "PKI удостоверяющий центр электронная подпись",
    "email": "почтовый сервер электронная почта",
    "vks": "ВКС видеоконференцсвязь",
    "ecm": "СЭД электронный документооборот",
    "portal": "корпоративный портал",
    "project_sw": "управление проектами",
    "bpm": "BPM управление бизнес-процессами",
    "backup_sw": "резервное копирование",
    "itsm": "ITSM сервис деск service desk",
    "monitoring": "мониторинг ИТ-инфраструктуры",
    "mdm": "MDM управление мобильными устройствами",
    "hr": "HRM управление персоналом кадры",
    "gis": "ГИС геоинформационная система",
    # Hardware
    "pc": "системный блок компьютер персональный",
    "laptop": "ноутбук",
    "monoblock": "моноблок",
    "server": "сервер",
    "tablet": "планшет",
    "thinClient": "тонкий клиент",
    "monitor": "монитор",
    "printer": "принтер",
    "mfu": "МФУ многофункциональное устройство",
    "scanner": "сканер",
    "switch": "коммутатор сетевой",
    "router": "маршрутизатор",
    "firewall": "межсетевой экран аппаратный",
    "accessPoint": "точка доступа Wi-Fi",
    "ups": "ИБП источник бесперебойного питания",
    "nas": "NAS сетевое хранилище",
    "ssd": "SSD твердотельный накопитель",
    "hdd": "HDD жесткий диск",
    "ram": "оперативная память модуль ОЗУ",
    "san": "СХД система хранения данных",
    "serverBlade": "блейд-сервер",
}


# ── DuckDuckGo (primary, free, no API key) ─────────────────────
def _duckduckgo_search(query: str, num: int = 5) -> list[dict]:
    """
    Keyless search via DuckDuckGo HTML page.
    """
    url = f"https://duckduckgo.com/html/?q={quote_plus(query)}"
    html = _fetch_url(url, timeout=15)
    if not html:
        logger.warning("DuckDuckGo returned empty HTML")
        return []

    results: list[dict] = []
    # Use a broader block regex — DuckDuckGo results have 3 levels of </div>
    blocks = re.findall(r"<div class=\"result\s[^\"]*\".*?</div>\s*</div>\s*</div>", html, flags=re.S)
    if not blocks:
        # Fallback: try the 2-div pattern
        blocks = re.findall(r"<div class=\"result\s[^\"]*\".*?</div>\s*</div>", html, flags=re.S)
    logger.info(f"DuckDuckGo: found {len(blocks)} result blocks for query: {query[:80]}")

    for block in blocks:
        if len(results) >= max(1, num):
            break
        link_match = re.search(r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', block, flags=re.S)
        # Try multiple snippet patterns
        snippet_match = re.search(r'class="result__snippet"[^>]*>(.*?)</a>', block, flags=re.S)
        if not snippet_match:
            snippet_match = re.search(r'class="result__snippet"[^>]*>(.*?)</(?:div|span)>', block, flags=re.S)
        if not link_match:
            continue
        raw_href = unescape(link_match.group(1))
        href = raw_href
        if "/l/?" in raw_href and "uddg=" in raw_href:
            query_params = parse_qs(urlparse(raw_href).query)
            href = unquote(query_params.get("uddg", [""])[0]) or raw_href
        if href.startswith("//"):
            href = "https:" + href
        title = _strip_tags(unescape(link_match.group(2)))
        snippet = _strip_tags(unescape(snippet_match.group(1) if snippet_match else ""))
        if not href.startswith("http"):
            continue
        results.append({
            "title": title[:180],
            "link": href[:500],
            "snippet": snippet[:500],
        })
    logger.info(f"DuckDuckGo: parsed {len(results)} results")
    return results


# ── AI extraction ──────────────────────────────────────────────

def _build_extraction_prompt(product: str, goods_type: str, is_software: bool) -> str:
    """Build a detailed AI extraction system prompt depending on product type."""

    if is_software:
        return (
            "Ты эксперт по техническим характеристикам программного обеспечения для государственных закупок (44-ФЗ РФ). "
            "Твоя задача: извлечь ВСЕ технические и функциональные характеристики из текста и вернуть их в JSON-формате.\n\n"
            "Формат ответа — ТОЛЬКО JSON-массив, без лишнего текста:\n"
            '[{"name": "Тип ПО", "value": "операционная система общего назначения", "unit": ""},\n'
            ' {"name": "Поддерживаемые архитектуры", "value": "x86_64, ARM64", "unit": ""}, ...]\n\n'
            "ОБЯЗАТЕЛЬНЫЕ ГРУППЫ характеристик для ПО:\n"
            "1. Общие сведения: тип ПО, разрядность, поддерживаемые архитектуры, формат поставки\n"
            "2. Функциональные возможности: ключевые функции, модули, компоненты\n"
            "3. Совместимость: поддерживаемые ОС, СУБД, платформы виртуализации\n"
            "4. Безопасность: сертификаты ФСТЭК/ФСБ, мандатный контроль, шифрование\n"
            "5. Управление: централизованное управление, веб-консоль, API\n"
            "6. Масштабирование: макс. пользователей, лицензирование, кластеризация\n"
            "7. Интеграция: поддерживаемые протоколы, форматы, API\n"
            "8. Документация и поддержка: русскоязычная документация, техподдержка\n\n"
            "Правила:\n"
            "- Извлекай ВСЕ характеристики из текста — минимум 20 для ПО\n"
            "- name — название параметра по-русски\n"
            "- value — значение (текст или число)\n"
            "- unit — единица измерения или пустая строка\n"
            "- Для числовых характеристик используй 'не менее X'\n"
            "- Для брендов/торговых марок добавляй 'или эквивалент'\n"
            "- Если данных нет — вернуть пустой массив []"
        )
    else:
        return (
            "Ты эксперт по техническим характеристикам IT-оборудования для государственных закупок (44-ФЗ РФ). "
            "Твоя задача: извлечь ВСЕ технические характеристики из текста и вернуть их в JSON-формате.\n\n"
            "Формат ответа — ТОЛЬКО JSON-массив, без лишнего текста:\n"
            '[{"name": "Процессор", "value": "не менее 8 ядер, частота не менее 2.5 ГГц", "unit": ""},\n'
            ' {"name": "Оперативная память", "value": "не менее 16", "unit": "ГБ"}, ...]\n\n'
            "ОБЯЗАТЕЛЬНЫЕ ГРУППЫ характеристик для оборудования:\n"
            "1. Основные параметры: процессор, память, накопитель\n"
            "2. Дисплей/экран (если применимо): диагональ, разрешение, тип матрицы\n"
            "3. Интерфейсы: порты USB, видеовыходы, сетевые разъёмы\n"
            "4. Сетевые возможности: Ethernet, Wi-Fi, Bluetooth\n"
            "5. Конструктив: размеры, вес, материал корпуса\n"
            "6. Питание: блок питания, аккумулятор\n"
            "7. Комплектация: что входит в комплект поставки\n\n"
            "Правила:\n"
            "- Извлекай ВСЕ характеристики из текста — минимум 15 для оборудования\n"
            "- Используй формулировку 'не менее X' для числовых характеристик\n"
            "- Для брендов добавляй 'или эквивалент'\n"
            "- unit — единица измерения (ГБ, ГГц, дюйм, Вт, мм, кг и т.д.) или пустая строка\n"
            "- Если данных нет — вернуть пустой массив []"
        )


_SW_TYPES = {
    "os", "office", "virt", "vdi", "dbms", "erp", "cad", "license",
    "antivirus", "edr", "firewall_sw", "dlp", "siem", "crypto", "waf",
    "pam", "iam", "pki", "email", "vks", "ecm", "portal", "project_sw",
    "bpm", "backup_sw", "itsm", "monitoring", "mdm", "hr", "gis",
}


def _ai_extract_specs(context_text: str, product: str, goods_type: str = "") -> list[dict]:
    """
    Ask AI to extract technical specs from text.
    Returns list of {name, value, unit} dicts.
    """
    key = DEEPSEEK_API_KEY or GROQ_API_KEY
    if not key:
        logger.warning("No AI API key configured (DEEPSEEK_API_KEY / GROQ_API_KEY)")
        return []

    if DEEPSEEK_API_KEY:
        url = "https://api.deepseek.com/chat/completions"
        model = "deepseek-chat"
        api_key = DEEPSEEK_API_KEY
    else:
        url = "https://api.groq.com/openai/v1/chat/completions"
        model = "llama-3.3-70b-versatile"
        api_key = GROQ_API_KEY

    is_software = goods_type in _SW_TYPES
    system_prompt = _build_extraction_prompt(product, goods_type, is_software)

    type_hint = _TYPE_SEARCH_HINTS.get(goods_type, "")
    type_context = f" (тип: {type_hint})" if type_hint else ""

    user_prompt = (
        f"Товар: {product}{type_context}\n\n"
        f"Текст для анализа (из реальных ТЗ и спецификаций):\n{context_text[:8000]}\n\n"
        "Извлеки ВСЕ технические характеристики. Верни ТОЛЬКО JSON-массив."
    )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "max_tokens": 8192,
        "stream": False,
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = URLRequest(
        url,
        data=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=AI_TIMEOUT, context=_ssl_ctx) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        # Strip markdown code blocks if present
        content = content.strip()
        if content.startswith("```"):
            lines = content.split("\n")
            lines = [l for l in lines if not l.startswith("```")]
            content = "\n".join(lines).strip()
        # Try parsing JSON, with repair for truncated responses
        specs = _parse_json_with_repair(content)
        if isinstance(specs, list):
            return specs
        return []
    except json.JSONDecodeError as e:
        logger.warning(f"AI returned non-JSON: {e}")
        return []
    except Exception as e:
        logger.error(f"AI extract error: {e}")
        return []


def _parse_json_with_repair(text: str) -> list | None:
    """Parse JSON array, with 3-stage repair for truncated responses."""
    text = text.strip()

    # Stage 1: direct parse
    try:
        result = json.loads(text)
        return result if isinstance(result, list) else None
    except json.JSONDecodeError:
        pass

    # Stage 2: find the JSON array in the text
    match = re.search(r'\[.*', text, flags=re.S)
    if match:
        arr_text = match.group(0)
        try:
            result = json.loads(arr_text)
            return result if isinstance(result, list) else None
        except json.JSONDecodeError:
            pass

        # Stage 3: repair truncated JSON
        # Close any open strings, objects, and the array
        repaired = arr_text.rstrip()
        if repaired.endswith(","):
            repaired = repaired[:-1]

        # Count open braces/brackets
        open_braces = repaired.count("{") - repaired.count("}")
        open_brackets = repaired.count("[") - repaired.count("]")

        # Check if we're inside a string (odd number of unescaped quotes)
        in_string = (repaired.count('"') - repaired.count('\\"')) % 2 == 1
        if in_string:
            repaired += '"'

        # Close open objects and array
        repaired += "}" * max(0, open_braces)
        if repaired.endswith(","):
            repaired = repaired[:-1]
        repaired += "]" * max(0, open_brackets)

        try:
            result = json.loads(repaired)
            return result if isinstance(result, list) else None
        except json.JSONDecodeError:
            pass

    return None


# ── Internet search ─────────────────────────────────────────────
async def search_internet_specs(product: str, goods_type: str = "") -> list[dict]:
    """
    Search internet for product specs using DuckDuckGo (free, keyless) + AI extraction.
    Also searches rostender.info, zakupki.gov.ru, zakupki.mos.ru for existing TZ.
    Returns list of {name, value, unit} dicts.
    """
    cache_key = f"internet:{goods_type}:{product}"
    cached = _cache_get(cache_key)
    if cached is not None:
        logger.info(f"[internet] Cache hit for: {product!r} ({len(cached)} specs)")
        return cached

    type_hint = _TYPE_SEARCH_HINTS.get(goods_type, "")
    query = f"{product} технические характеристики"
    if type_hint and type_hint.lower() not in product.lower():
        query = f"{product} {type_hint} технические характеристики"

    logger.info(f"[internet] Starting search: query={query!r}")
    loop = asyncio.get_event_loop()

    # Step 1: Get search results via DuckDuckGo (free, keyless)
    results = await loop.run_in_executor(None, lambda: _duckduckgo_search(query, num=5))
    # Also search procurement portals for existing TZ documents
    tz_query = f"{product} техническое задание site:rostender.info OR site:zakupki.gov.ru OR site:zakupki.mos.ru"
    tz_results = await loop.run_in_executor(None, lambda: _duckduckgo_search(tz_query, num=3))
    if tz_results:
        results = (results or []) + tz_results
    if not results:
        logger.warning(f"No search results for: {query}")
        # Don't cache empty results — allow retry
        return []

    # Collect context from search snippets + top pages
    context_parts = []

    # Add snippets from search results (fast, no fetch needed)
    for r in results[:8]:
        title = r.get("title", "")
        snippet = r.get("snippet", "")
        if snippet:
            context_parts.append(f"{title}: {snippet}")

    # Fetch top 3 pages for more detailed specs
    urls_to_fetch = [r.get("link", "") for r in results[:5] if r.get("link", "")]
    skip_domains = {"youtube.com", "facebook.com", "vk.com", "instagram.com", "twitter.com", "t.me"}
    fetched = 0
    for url in urls_to_fetch:
        if fetched >= 3:
            break
        if not url or any(d in url for d in skip_domains):
            continue
        html = await loop.run_in_executor(None, lambda u=url: _fetch_url(u, timeout=10))
        if html:
            page_text = _extract_text_from_html(html, max_chars=5000)
            if page_text and len(page_text) > 100:
                context_parts.append(f"[Страница {url}]:\n{page_text}")
                fetched += 1

    if not context_parts:
        # Don't cache empty results — allow retry
        return []

    full_context = "\n\n".join(context_parts)

    # Step 2: Extract specs via AI
    specs = await loop.run_in_executor(None, lambda: _ai_extract_specs(full_context, product, goods_type))
    logger.info(f"Internet search for {product!r}: found {len(specs)} specs from {len(context_parts)} context parts")
    _cache_set(cache_key, specs)
    return specs


# ── EIS / zakupki.gov.ru search ─────────────────────────────────

async def search_eis_specs(query: str, goods_type: str = "") -> list[dict]:
    """
    Search EIS (zakupki.gov.ru) for existing TZ documents and extract specs.
    Uses DuckDuckGo site: filters since direct zakupki.gov.ru access is blocked.
    Returns list of {name, value, unit} dicts.
    """
    cache_key = f"eis:{goods_type}:{query}"
    cached = _cache_get(cache_key)
    if cached is not None:
        logger.info(f"Cache hit for EIS search: {query!r}")
        return cached

    loop = asyncio.get_event_loop()
    context_parts = []
    type_hint = _TYPE_SEARCH_HINTS.get(goods_type, "")

    # Build search queries with type-specific hints
    base_query = query.strip()
    if type_hint and type_hint.lower() not in base_query.lower():
        base_query_extended = f"{query} {type_hint}"
    else:
        base_query_extended = base_query

    # ── Strategy 1: DuckDuckGo site: searches for procurement portals ──
    site_searches = [
        (f'site:zakupki.gov.ru "{base_query}" техническое задание характеристики', "ЕИС"),
        (f'site:rostender.info "{base_query}" характеристики', "РосТендер"),
        (f'site:zakupki.mos.ru "{base_query}" спецификация', "Закупки Москвы"),
    ]

    search_tasks = []
    for site_query, label in site_searches:
        search_tasks.append(
            loop.run_in_executor(None, lambda q=site_query: _duckduckgo_search(q, num=5))
        )
    site_results_all = await asyncio.gather(*search_tasks, return_exceptions=True)

    all_urls_to_fetch: list[tuple[str, str]] = []  # (url, label)

    for (_, label), results in zip(site_searches, site_results_all):
        if isinstance(results, Exception):
            logger.warning(f"DuckDuckGo search failed for {label}: {results}")
            continue
        for sr in (results or [])[:3]:
            snippet = sr.get("snippet", "")
            title = sr.get("title", "")
            link = sr.get("link", "")
            if snippet:
                context_parts.append(f"[{label}] {title}: {snippet}")
            if link:
                all_urls_to_fetch.append((link, label))

    # ── Strategy 2: General search for TZ documents with this product ──
    general_queries = [
        f'"{base_query}" техническое задание госзакупки характеристики',
        f'"{base_query}" спецификация 44-ФЗ требования',
    ]
    if type_hint:
        general_queries.append(f'{base_query_extended} характеристики требования госзакупки')

    for gq in general_queries:
        gen_results = await loop.run_in_executor(None, lambda q=gq: _duckduckgo_search(q, num=3))
        for sr in (gen_results or [])[:2]:
            snippet = sr.get("snippet", "")
            title = sr.get("title", "")
            link = sr.get("link", "")
            if snippet:
                context_parts.append(f"[Поиск] {title}: {snippet}")
            if link:
                all_urls_to_fetch.append((link, "Поиск"))

    # ── Fetch top pages in parallel ──
    skip_domains = {"youtube.com", "facebook.com", "vk.com", "instagram.com", "twitter.com", "t.me"}
    unique_urls: list[tuple[str, str]] = []
    seen_urls: set[str] = set()
    for url, label in all_urls_to_fetch:
        domain = urlparse(url).netloc
        if url not in seen_urls and not any(d in domain for d in skip_domains):
            unique_urls.append((url, label))
            seen_urls.add(url)
    unique_urls = unique_urls[:6]  # max 6 pages to fetch

    if unique_urls:
        fetch_tasks = [
            loop.run_in_executor(None, lambda u=url: _fetch_url(u, timeout=12))
            for url, _ in unique_urls
        ]
        fetch_results = await asyncio.gather(*fetch_tasks, return_exceptions=True)
        for (url, label), html_result in zip(unique_urls, fetch_results):
            if isinstance(html_result, Exception) or not html_result:
                continue
            page_text = _extract_text_from_html(html_result, max_chars=5000)
            if page_text and len(page_text) > 150:
                context_parts.append(f"[{label} — {url}]:\n{page_text}")

    # ── Fallback: if procurement-specific searches failed, try general internet search ──
    if not context_parts:
        logger.info(f"[eis] No procurement-specific results for {query!r}, falling back to internet search")
        internet_specs = await search_internet_specs(query, goods_type)
        if internet_specs:
            _cache_set(cache_key, internet_specs)
            return internet_specs
        # Don't cache empty results — allow retry
        return []

    full_context = "\n".join(context_parts)
    logger.info(f"[eis] Collected {len(context_parts)} context parts ({len(full_context)} chars) for {query!r}")

    # ── Extract specs via AI ──
    specs = await loop.run_in_executor(None, lambda: _ai_extract_specs(full_context, query, goods_type))
    logger.info(f"[eis] Extracted {len(specs)} specs for {query!r}")

    # If AI extraction returned few specs, supplement with internet search
    if len(specs) < 10:
        logger.info(f"[eis] Only {len(specs)} specs, supplementing with internet search")
        internet_specs = await search_internet_specs(query, goods_type)
        if internet_specs:
            # Merge: add internet specs that aren't already in EIS specs
            existing_names = {s.get("name", "").lower() for s in specs}
            for is_spec in internet_specs:
                if is_spec.get("name", "").lower() not in existing_names:
                    specs.append(is_spec)
                    existing_names.add(is_spec.get("name", "").lower())

    if specs:
        _cache_set(cache_key, specs)
    return specs
