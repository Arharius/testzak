"""
Search module for TZ Generator backend.
- search_internet_specs: DuckDuckGo (free, keyless) → AI extracts specs
- search_eis_specs: zakupki.gov.ru KTRU catalog + EIS procurement notices → AI extracts specs
"""
import os
import json
import logging
import asyncio
import re
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


def _extract_text_from_html(html: str, max_chars: int = 8000) -> str:
    parser = _TextExtractor()
    try:
        parser.feed(html)
        return parser.get_text()[:max_chars]
    except Exception:
        return html[:max_chars]


def _fetch_url(url: str, timeout: int = 12) -> str:
    """Fetch URL, return text content."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    }
    req = URLRequest(url, headers=headers, method="GET")
    try:
        with urlopen(req, timeout=timeout, context=_ssl_ctx) as resp:
            raw = resp.read()
            encoding = resp.headers.get_content_charset("utf-8") or "utf-8"
            return raw.decode(encoding, errors="replace")
    except Exception as e:
        logger.warning(f"fetch_url failed {url}: {e}")
        return ""


def _strip_tags(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text or "").replace("\n", " ").strip()


# ── DuckDuckGo (primary, free, no API key) ─────────────────────
def _duckduckgo_search(query: str, num: int = 5) -> list[dict]:
    """
    Fallback keyless search via DuckDuckGo HTML page.
    """
    url = f"https://duckduckgo.com/html/?q={quote_plus(query)}"
    html = _fetch_url(url, timeout=15)
    if not html:
        return []

    results: list[dict] = []
    blocks = re.findall(r"<div class=\"result.*?</div>\s*</div>", html, flags=re.S)
    for block in blocks:
        if len(results) >= max(1, num):
            break
        link_match = re.search(r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', block, flags=re.S)
        snippet_match = re.search(r'class="result__snippet"[^>]*>(.*?)</a>', block, flags=re.S)
        if not link_match:
            continue
        raw_href = unescape(link_match.group(1))
        href = raw_href
        if "/l/?" in raw_href and "uddg=" in raw_href:
            query_params = parse_qs(urlparse(raw_href).query)
            href = unquote(query_params.get("uddg", [""])[0]) or raw_href
        title = _strip_tags(unescape(link_match.group(2)))
        snippet = _strip_tags(unescape(snippet_match.group(1) if snippet_match else ""))
        if not href.startswith("http"):
            continue
        results.append({
            "title": title[:180],
            "link": href[:500],
            "snippet": snippet[:500],
        })
    return results


def _ai_extract_specs(context_text: str, product: str) -> list[dict]:
    """
    Ask AI to extract technical specs from text.
    Returns list of {name, value, unit} dicts.
    """
    key = DEEPSEEK_API_KEY or GROQ_API_KEY
    if not key:
        return []

    if DEEPSEEK_API_KEY:
        url = "https://api.deepseek.com/chat/completions"
        model = "deepseek-chat"
        api_key = DEEPSEEK_API_KEY
    else:
        url = "https://api.groq.com/openai/v1/chat/completions"
        model = "llama-3.3-70b-versatile"
        api_key = GROQ_API_KEY

    system_prompt = (
        "Ты эксперт по техническим характеристикам IT-оборудования и ПО для государственных закупок (44-ФЗ). "
        "Твоя задача: извлечь технические характеристики из текста и вернуть их в JSON-формате.\n"
        "Формат ответа — ТОЛЬКО JSON-массив, без лишнего текста:\n"
        '[{"name": "Процессор", "value": "не менее Intel Core i5-12400 или эквивалент", "unit": ""},'
        ' {"name": "Оперативная память", "value": "не менее 8", "unit": "ГБ"}, ...]\n'
        "Правила:\n"
        "- Используй формулировку 'не менее X' для числовых характеристик\n"
        "- Для брендов добавляй 'или эквивалент'\n"
        "- unit — единица измерения (ГБ, ГГц, дюйм, Вт и т.д.) или пустая строка\n"
        "- Если данных нет — вернуть пустой массив []"
    )

    user_prompt = (
        f"Товар: {product}\n\n"
        f"Текст для анализа:\n{context_text[:6000]}\n\n"
        "Извлеки все технические характеристики. Верни ТОЛЬКО JSON-массив."
    )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "max_tokens": 4096,
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
        specs = json.loads(content)
        if isinstance(specs, list):
            return specs
        return []
    except json.JSONDecodeError as e:
        logger.warning(f"AI returned non-JSON: {e}")
        return []
    except Exception as e:
        logger.error(f"AI extract error: {e}")
        return []


# ── Internet search ─────────────────────────────────────────────
async def search_internet_specs(product: str, goods_type: str = "") -> list[dict]:
    """
    Search internet for product specs using DuckDuckGo (free, keyless) + AI extraction.
    Returns list of {name, value, unit} dicts.
    """
    query = f"{product} технические характеристики"

    loop = asyncio.get_event_loop()

    # Step 1: Get search results via DuckDuckGo (free, keyless)
    results = await loop.run_in_executor(None, lambda: _duckduckgo_search(query, num=5))
    if not results:
        logger.warning(f"No search results for: {query}")
        return []

    # Collect context from search snippets + top pages
    context_parts = []

    # Add snippets from search results (fast, no fetch needed)
    for r in results[:5]:
        title = r.get("title", "")
        snippet = r.get("snippet", "")
        if snippet:
            context_parts.append(f"{title}: {snippet}")

    # Fetch top 2 pages for more detailed specs
    urls_to_fetch = [r.get("link", "") for r in results[:3] if r.get("link", "")]
    for url in urls_to_fetch[:2]:
        if not url:
            continue
        # Skip social media, forums, etc.
        skip_domains = ["youtube.com", "facebook.com", "vk.com", "instagram.com", "twitter.com"]
        if any(d in url for d in skip_domains):
            continue
        html = await loop.run_in_executor(None, lambda u=url: _fetch_url(u, timeout=10))
        if html:
            page_text = _extract_text_from_html(html, max_chars=4000)
            context_parts.append(f"[Страница {url}]:\n{page_text}")

    if not context_parts:
        return []

    full_context = "\n\n".join(context_parts)

    # Step 2: Extract specs via AI
    specs = await loop.run_in_executor(None, lambda: _ai_extract_specs(full_context, product))
    logger.info(f"Internet search for {product!r}: found {len(specs)} specs")
    return specs


# ── EIS / zakupki.gov.ru search ─────────────────────────────────
def _search_ktru(query: str) -> list[dict]:
    """
    Search KTRU catalog on zakupki.gov.ru.
    Returns list of KTRU items with their characteristics.
    """
    q = quote_plus(str(query or ""))
    url = (
        "https://zakupki.gov.ru/epz/ktru/ws/search/common/ktru/getKtruList.html"
        f"?searchString={q}&morphology=on&pageNumber=1&sortDirection=false&recordsPerPage=_10"
    )
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "ru-RU,ru;q=0.9",
        "Referer": "https://zakupki.gov.ru/",
        "X-Requested-With": "XMLHttpRequest",
    }
    req = URLRequest(url, headers=headers, method="GET")
    try:
        with urlopen(req, timeout=15, context=_ssl_ctx) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else []
    except Exception as e:
        logger.warning(f"KTRU search error: {e}")
        return []


def _search_eis_purchases(query: str) -> str:
    """
    Search EIS for procurement notices. Returns HTML text.
    """
    q = quote_plus(str(query or ""))
    url = (
        "https://zakupki.gov.ru/epz/order/extendedsearch/results.html"
        f"?searchString={q}&morphology=on&search-filter=%D0%94%D0%B0%D1%82%D0%B5+%D1%80%D0%B0%D0%B7%D0%BC%D0%B5%D1%89%D0%B5%D0%BD%D0%B8%D1%8F"
        "&pageNumber=1&sortDirection=false&recordsPerPage=_10&showLotsInfoHidden=false"
        "&fz44=on&pc=on"
    )
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9",
        "Referer": "https://zakupki.gov.ru/",
    }
    req = URLRequest(url, headers=headers, method="GET")
    try:
        with urlopen(req, timeout=20, context=_ssl_ctx) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        logger.warning(f"EIS search error: {e}")
        return ""


def _extract_eis_context(html: str, query: str) -> str:
    """Extract relevant text from EIS search results page."""
    text = _extract_text_from_html(html, max_chars=6000)
    # Filter lines that mention the query keywords
    keywords = query.lower().split()
    lines = text.split(".")
    relevant = []
    for line in lines:
        if any(kw in line.lower() for kw in keywords):
            relevant.append(line.strip())
    if relevant:
        return ". ".join(relevant[:100])
    return text[:4000]


async def search_eis_specs(query: str, goods_type: str = "") -> list[dict]:
    """
    Search EIS (zakupki.gov.ru) for existing TZ documents and extract specs.
    Returns list of {name, value, unit} dicts.
    """
    loop = asyncio.get_event_loop()

    context_parts = []

    # Step 1: Try KTRU catalog search
    ktru_data = await loop.run_in_executor(None, lambda: _search_ktru(query))
    if ktru_data and isinstance(ktru_data, dict):
        items = ktru_data.get("items", []) or ktru_data.get("data", []) or []
        for item in items[:3]:
            if isinstance(item, dict):
                name = item.get("name", "") or item.get("ktruName", "")
                code = item.get("code", "") or item.get("ktruCode", "")
                chars = item.get("characteristics", []) or []
                if name or code:
                    context_parts.append(f"КТРУ: {code} {name}")
                for char in chars[:20]:
                    if isinstance(char, dict):
                        cname = char.get("name", "")
                        cval = char.get("value", "")
                        if cname:
                            context_parts.append(f"  {cname}: {cval}")

    # Step 2: Search EIS procurement notices
    eis_html = await loop.run_in_executor(None, lambda: _search_eis_purchases(query))
    if eis_html:
        eis_text = _extract_eis_context(eis_html, query)
        if eis_text:
            context_parts.append(f"Закупки ЕИС по запросу '{query}':\n{eis_text}")

    if not context_parts:
        logger.warning(f"No EIS data found for: {query}")
        return []

    full_context = "\n".join(context_parts)

    # Step 3: Extract specs via AI
    specs = await loop.run_in_executor(None, lambda: _ai_extract_specs(full_context, query))
    logger.info(f"EIS search for {query!r}: found {len(specs)} specs")
    return specs
