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
AI_TIMEOUT = float(os.getenv("AI_TIMEOUT", "100"))

# Rotating user-agents to reduce fingerprinting
import random
_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
]


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
        "User-Agent": random.choice(_USER_AGENTS),
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


# ── Clean user input: strip cities, delivery terms and other noise ──────
_NOISE_WORDS_RE = re.compile(
    r"\b("
    # Russian cities (common in procurement queries)
    r"москва|санкт[\s-]?петербург|спб|новосибирск|екатеринбург|казань|самара|"
    r"челябинск|омск|ростов|уфа|красноярск|пермь|воронеж|волгоград|краснодар|"
    r"саратов|тюмень|тольятти|ижевск|барнаул|иркутск|хабаровск|ярославль|"
    r"владивосток|махачкала|томск|оренбург|кемерово|новокузнецк|рязань|"
    r"набережные\s+челны|астрахань|пенза|липецк|тула|киров|чебоксары|калининград|"
    r"брянск|курск|иваново|магнитогорск|улан[\s-]?удэ|тверь|ставрополь|нижний\s+новгород|"
    # Delivery / procurement noise words
    r"доставка|поставка|закупка|закупк[иу]|тендер|контракт|госзаказ|"
    r"бюджет|контракт|техзадание|техническое\s+задание|"
    r"цена|стоимость|бесплатн|срочн|дешев|недорог|"
    # Quantity noise
    r"\d+\s*шт\.?|\d+\s*штук|\d+\s*комплект|\d+\s*лицензи[йя]"
    r")\b",
    re.IGNORECASE,
)


def _clean_search_query(query: str) -> str:
    """Strip non-product words (cities, delivery terms) from user query."""
    cleaned = _NOISE_WORDS_RE.sub(" ", query)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    # Don't return empty query
    return cleaned if len(cleaned) >= 3 else query.strip()


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
    "keyboard": "клавиатура компьютерная",
    "mouse": "мышь компьютерная",
    "keyboardMouseSet": "комплект клавиатура мышь",
    "webcam": "веб-камера",
    "speakers": "колонки акустическая система",
    "opticalDrive": "внешний оптический привод dvd rw",
    "cableTester": "кабельный тестер rj45 rj11",
    "rj45Connector": "коннектор rj45 8p8c",
    "toolSet": "набор инструментов для монтажа скс",
    "patchCord": "патч корд rj45 витая пара",
}

_TYPE_KEYWORDS: dict[str, list[str]] = {
    "keyboard": ["keyboard", "клавиатур", "keys", "keypad"],
    "mouse": ["mouse", "мыш", "dpi", "sensor"],
    "keyboardMouseSet": ["keyboard", "mouse", "combo", "комплект", "клавиатур", "мыш"],
    "webcam": ["webcam", "camera", "веб", "камера", "uvc", "autofocus"],
    "speakers": ["speakers", "speaker", "колонк", "акустик", "rms", "audio"],
    "opticalDrive": ["dvd", "cd", "bd", "blu-ray", "bluray", "оптическ", "привод", "drive"],
    "cableTester": ["tester", "тестер", "lan tester", "кабельный", "rj45", "rj11", "телефонный", "витая пара", "wiremap", "poe"],
    "rj45Connector": ["rj45", "8p8c", "connector", "коннектор", "разъем", "разъём", "штекер", "cat5e", "cat6", "utp", "ftp"],
    "toolSet": ["tool kit", "набор", "инструмент", "кримпер", "обжим", "стриппер", "tester", "rj45", "rj11"],
    "patchCord": ["patch cord", "патч", "патчкорд", "rj45", "cat5e", "cat6", "utp", "ftp", "lan cable"],
}

_COMPUTE_TYPES = {
    "pc", "laptop", "monoblock", "server", "serverRack", "serverBlade", "tablet", "thinClient",
}
_NETWORK_TYPES = {
    "switch", "router", "firewall", "accessPoint", "wifiController", "nas", "san",
    "mediaConverter", "patchPanel", "fiberPatchPanel", "rackCabinet", "wallCabinet",
    "rackShelf", "cableManagerRack", "blankPanel", "cageNutSet", "serverRailKit",
    "sfpModule", "sfpDac", "poeInjector", "poeSplitter", "consoleServer", "lteModem",
    "ipPhone", "voipGateway", "networkAdapter", "raidController", "hbaAdapter",
}
_PRINT_TYPES = {
    "printer", "mfu", "scanner", "labelPrinter", "receiptPrinter", "barcodeScanner",
    "laminator", "shredder",
}
_STORAGE_TYPES = {
    "ssd", "hdd", "extSsd", "extHdd", "ram", "flashDrive", "memoryCard", "cardReader",
    "dvd", "opticalDrive", "tapeLib", "ltoTape", "ltoCleaningCartridge",
}
_COMPONENT_TYPES = {
    "cpu", "gpu", "motherboard", "psu", "cooling", "pcCase", "caseFan", "tpmModule",
    "soundCard", "captureCard", "parts", "upsBattery",
}
_PERIPHERAL_TYPES = {
    "monitor", "touchMonitor", "projector", "interactive", "projectorScreen", "webcam",
    "conferenceCamera", "documentCamera", "headset", "speakerphone", "speakers",
    "microphone", "keyboard", "mouse", "keyboardMouseSet", "mousePad", "kvm",
    "ups", "smartCardReader", "graphicsTablet", "signaturePad", "monitorArm",
    "laptopStand", "charger", "usbToken", "privacyFilter", "laptopLock", "dockingStation",
    "usbHub", "tvPanel",
}
_SOFTWARE_TYPES = {
    "os", "osSupport", "office", "virt", "vdi", "dbms", "erp", "cad", "license",
    "supportCert", "remoteAccessSw", "crm", "bi", "rpa", "miscSoftware", "email",
    "vks", "ecm", "portal", "project_sw", "bpm", "reporting", "backup_sw", "itsm",
    "monitoring", "mdm", "hr", "gis", "ldap", "antivirus", "edr", "firewall_sw",
    "vpn", "dlp", "siem", "crypto", "waf", "pam", "iam", "pki",
}
_CABLE_TYPES = {
    "patchCord", "fiberCable", "fiberPatchCord", "fiberPigtail", "hdmiCable", "audioCable",
    "serialCable", "consoleCable", "usbCable", "powerCable", "extensionCord",
    "surgeProtector", "usbExtender", "kvmExtender", "usbAdapter", "videoAdapter",
    "plugAdapter", "hdmiSplitter", "hdmiSwitcher",
}
_CONNECTOR_TYPES = {
    "rj45Connector", "rj45Coupler", "keystoneJack", "networkSocket", "faceplate",
    "cableTie", "cableChannel",
}
_TOOL_TYPES = {
    "toolSet", "cableTester", "crimper", "soldering", "multimeter", "precisionScrewdriver",
}

_PROCUREMENT_DOMAINS = ("zakupki.gov.ru", "rostender.info", "zakupki.mos.ru", "minpromtorg.gov.ru", "gisp.gov.ru")
_PREFERRED_SOURCE_WEIGHTS = {
    "zakupki.gov.ru": 45,
    "rostender.info": 32,
    "zakupki.mos.ru": 28,
    "gisp.gov.ru": 26,
    "minpromtorg.gov.ru": 22,
    "msi.com": 18,
    "dell.com": 18,
    "hp.com": 18,
    "lenovo.com": 18,
    "asus.com": 18,
    "acer.com": 18,
    "hpe.com": 18,
    "cisco.com": 18,
    "mikrotik.com": 18,
    "tp-link.com": 18,
    "samsung.com": 18,
}
_BLOCKED_RESULT_HOSTS = (
    "stackoverflow.com", "facebook.com", "support.google.com", "youtube.com", "vk.com",
    "instagram.com", "tiktok.com", "reddit.com", "zhihu.com", "bilibili.com", "pinterest.com",
)
_NOISY_RESULT_PATTERNS = (
    re.compile(r"wiki", re.I),
    re.compile(r"wikipedia", re.I),
    re.compile(r"review", re.I),
    re.compile(r"guide", re.I),
    re.compile(r"blog", re.I),
    re.compile(r"forum", re.I),
    re.compile(r"what is", re.I),
    re.compile(r"что такое", re.I),
)

_MSI_CATEGORY_PATHS_BY_TYPE: dict[str, list[str]] = {
    "pc": ["Business-Productivity-PC"],
    "monoblock": ["Business-Productivity-PC"],
    "thinClient": ["Business-Productivity-PC"],
    "laptop": ["Business-Productivity-Laptop", "Laptops"],
    "monitor": ["Monitor"],
    "motherboard": ["Motherboard"],
    "gpu": ["Graphics-Card"],
}

_MSI_FIELD_NAME_MAP: dict[str, str] = {
    "Operating Systems": "Поддерживаемая операционная система",
    "Chipsets": "Чипсет",
    "Memory Size": "Объем оперативной памяти",
    "Memory Type": "Тип оперативной памяти",
    "Memory Speed": "Частота оперативной памяти",
    "Memory Slot(Total)": "Количество слотов памяти",
    "Memory Slot(Free)": "Свободные слоты памяти",
    "Max Capacity": "Максимальный объем оперативной памяти",
    "CPU Number": "Процессор",
    "CPU Clock": "Базовая частота процессора",
    "CPU Cores": "Количество ядер процессора",
    "Threads": "Количество потоков процессора",
    "TDP": "Теплопакет процессора",
    "Max Turbo Frequency": "Максимальная частота процессора",
    "Cache": "Кэш-память процессора",
    "Audio Chipset": "Аудиочип",
    "Audio Type": "Аудиосистема",
    "SSD Interface": "Интерфейс SSD",
    "SSD Form Factor": "Форм-фактор SSD",
    "SSD Config": "Конфигурация SSD",
    "SSD Size": "Объем SSD",
    "M.2 slots(Total)": "Количество слотов M.2",
    "M.2 slots(Free)": "Свободные слоты M.2",
    "2.5\" Drive Bays(Total)": "Отсеки 2.5 дюйма",
    "2.5\" Drive Bays (Free)": "Свободные отсеки 2.5 дюйма",
    "3.5\" Drive Bays(Free)": "Свободные отсеки 3.5 дюйма",
    "WLAN Version": "Беспроводные интерфейсы",
    "USB 3.2 Gen 1 (5G) Type A": "USB 3.2 Gen 1 Type-A",
    "USB 2.0 Type A (R)": "USB 2.0 Type-A",
    "RJ45": "Порт Ethernet RJ-45",
    "HDMI out": "Порт HDMI",
    "DP out": "Порт DisplayPort",
    "COM Port": "COM-порт",
    "Lock type": "Тип замка безопасности",
    "USB 3.2 Gen 2 (10G) Type C (R)": "USB Type-C",
    "USB 3.2 Gen 2 (10G) Type A (R)": "USB 3.2 Gen 2 Type-A",
    "Warranty": "Гарантия производителя",
    "Weight (Net kg)": "Масса нетто",
    "Weight (Gross kg)": "Масса брутто",
    "Product Dimension (WxDxH) (mm)": "Размеры корпуса",
    "Keyboard Interface": "Интерфейс клавиатуры",
    "Mouse": "Мышь в комплекте",
    "Mouse Interface": "Интерфейс мыши",
    "Audio Mic-in": "Микрофонный вход",
    "Audio Headphone-out": "Выход на наушники",
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


# ── Bing search (fallback when DDG is rate-limited) ────────────
def _bing_search(query: str, num: int = 5) -> list[dict]:
    """
    Keyless search via Bing HTML page. Used as fallback when DuckDuckGo is rate-limited.
    """
    url = f"https://www.bing.com/search?q={quote_plus(query)}&setlang=ru&count={num}"
    headers = {
        "User-Agent": random.choice(_USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    }
    req = URLRequest(url, headers=headers, method="GET")
    try:
        with urlopen(req, timeout=15, context=_ssl_ctx) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        logger.warning(f"Bing search failed: {e}")
        return []

    results: list[dict] = []
    # Bing results are in <li class="b_algo" ...> (may have extra attrs)
    blocks = re.findall(r'<li[^>]*class="b_algo"[^>]*>(.*?)</li>', html, flags=re.S)
    logger.info(f"Bing: found {len(blocks)} result blocks for query: {query[:80]}")

    for block in blocks:
        if len(results) >= num:
            break
        # Extract link+title from <h2><a href="...">title</a></h2>
        link_match = re.search(r'<h2[^>]*><a\s[^>]*href="([^"]+)"[^>]*>(.*?)</a>', block, flags=re.S)
        if not link_match:
            link_match = re.search(r'<a\s[^>]*href="(https?://[^"]+)"[^>]*>(.*?)</a>', block, flags=re.S)
        if not link_match:
            continue
        raw_href = unescape(link_match.group(1))
        title = _strip_tags(unescape(link_match.group(2)))
        # Bing tracking redirects (bing.com/ck/a?...&u=...) — extract real URL
        href = raw_href
        if "bing.com/ck/a" in raw_href:
            try:
                params = parse_qs(urlparse(raw_href.replace("&amp;", "&")).query)
                u_param = params.get("u", [""])[0]
                if u_param and u_param.startswith("a1"):
                    import base64 as _b64
                    decoded = _b64.urlsafe_b64decode(u_param[2:] + "==").decode("utf-8", errors="replace")
                    if decoded.startswith("http"):
                        href = decoded
            except Exception:
                pass
        if not href.startswith("http"):
            continue
        # Extract snippet
        snippet_match = re.search(r'<p class="b_lineclamp[^"]*"[^>]*>(.*?)</p>', block, flags=re.S)
        if not snippet_match:
            snippet_match = re.search(r'<div class="b_caption"[^>]*>.*?<p[^>]*>(.*?)</p>', block, flags=re.S)
        if not snippet_match:
            snippet_match = re.search(r'<p[^>]*>(.*?)</p>', block, flags=re.S)
        snippet = _strip_tags(unescape(snippet_match.group(1))) if snippet_match else ""
        results.append({
            "title": title[:180],
            "link": href[:500],
            "snippet": snippet[:500],
        })

    logger.info(f"Bing: parsed {len(results)} results")
    return results


def _search_web(query: str, num: int = 5) -> list[dict]:
    """
    Search the web using DDG first, then Bing as fallback.
    """
    results = _duckduckgo_search(query, num)
    if results:
        return results
    logger.info(f"DDG returned 0 results, trying Bing fallback for: {query[:80]}")
    return _bing_search(query, num)


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
            "- ЗАПРЕЩЕНО: name 'Модель', 'Бренд', 'Производитель', 'Артикул', 'SKU'\n"
            "- ЗАПРЕЩЕНО: value 'не указан', 'не указано', 'н/д', 'неизвестно', '—'\n"
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
            "- ЗАПРЕЩЕНО: name 'Модель', 'Бренд', 'Производитель', 'Артикул', 'SKU'\n"
            "- ЗАПРЕЩЕНО: value 'не указан', 'не указано', 'н/д', 'неизвестно', '—'\n"
            "- Если данных нет — вернуть пустой массив []"
        )


_SW_TYPES = {
    "os", "office", "virt", "vdi", "dbms", "erp", "cad", "license",
    "antivirus", "edr", "firewall_sw", "dlp", "siem", "crypto", "waf",
    "pam", "iam", "pki", "email", "vks", "ecm", "portal", "project_sw",
    "bpm", "backup_sw", "itsm", "monitoring", "mdm", "hr", "gis",
}


def _normalize_text(value: str) -> str:
    text = str(value or "").lower().replace("ё", "е")
    text = re.sub(r"[-_/.,+()]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _detect_unit(value: str) -> str:
    match = re.search(r"\b(ГБ|МБ|ТБ|Вт·ч|Вт|ГГц|МГц|кГц|Гц|мм|см|м|дюйм|шт\.?|dpi|кадр\/с|fps|°|млн нажатий|x)\b", str(value or ""), flags=re.I)
    if not match:
        return ""
    unit = str(match.group(1) or "")
    return "шт." if re.fullmatch(r"шт", unit, flags=re.I) else unit


def _infer_unit(name: str, value: str, explicit: str = "") -> str:
    if explicit:
        return explicit
    name_text = str(name or "").strip()
    value_text = str(value or "").strip()
    if not name_text or not value_text:
        return ""
    if not re.search(r"^(?:не\s+(?:менее|более|уже|шире|выше|ниже|длиннее)\s+)?\d", value_text, flags=re.I):
        return ""
    if not re.search(r"(колич|длин|разреш|частот|угол|мощност|дальность|радиус|скорост|объем|объ[eе]м|емкост|[её]мкост|масса|вес|напряж|ток|диагон|ресурс|время|размер|ширин|высот|глубин|температур|потребля)", name_text, flags=re.I):
        return ""
    return _detect_unit(value_text)


def _get_type_hint(goods_type: str = "") -> str:
    key = str(goods_type or "").strip()
    if key in _TYPE_SEARCH_HINTS:
        return _TYPE_SEARCH_HINTS[key]
    if key in _COMPUTE_TYPES:
        return "компьютерная техника"
    if key in _NETWORK_TYPES:
        return "сетевое оборудование"
    if key in _PRINT_TYPES:
        return "печатающее и сканирующее устройство"
    if key in _STORAGE_TYPES:
        return "накопитель и устройство хранения данных"
    if key in _COMPONENT_TYPES:
        return "комплектующее для компьютерной техники"
    if key in _PERIPHERAL_TYPES:
        return "компьютерная периферия"
    if key in _SOFTWARE_TYPES:
        return "программное обеспечение"
    if key in _CABLE_TYPES:
        return "компьютерный кабель"
    if key in _CONNECTOR_TYPES:
        return "сетевой разъем и коммутационный аксессуар"
    if key in _TOOL_TYPES:
        return "инструмент для монтажа скс"
    return ""


def _get_goods_type_keywords(goods_type: str = "") -> list[str]:
    key = str(goods_type or "").strip()
    if key in _TYPE_KEYWORDS:
        return _TYPE_KEYWORDS[key]
    if key in _COMPUTE_TYPES:
        return ["computer", "pc", "desktop", "laptop", "server", "процессор", "оперативная", "ssd", "usb"]
    if key in _NETWORK_TYPES:
        return ["network", "ethernet", "switch", "router", "vlan", "poe", "sfp", "wifi", "порт"]
    if key in _PRINT_TYPES:
        return ["printer", "scanner", "mfu", "печать", "сканирование", "картридж", "лоток"]
    if key in _STORAGE_TYPES:
        return ["storage", "ssd", "hdd", "nvme", "memory", "емкость", "объем", "интерфейс"]
    if key in _COMPONENT_TYPES:
        return ["component", "motherboard", "cpu", "gpu", "socket", "slot", "интерфейс"]
    if key in _PERIPHERAL_TYPES:
        return ["peripheral", "monitor", "keyboard", "mouse", "camera", "audio", "usb", "display"]
    if key in _SOFTWARE_TYPES:
        return ["software", "license", "licensing", "версия", "редакция", "поддержка", "операционная система"]
    if key in _CABLE_TYPES:
        return ["cable", "кабель", "length", "длина", "connector", "cat", "usb", "hdmi", "rj45"]
    if key in _CONNECTOR_TYPES:
        return ["connector", "adapter", "разъем", "разъём", "rj45", "cat", "контакт", "обжим"]
    if key in _TOOL_TYPES:
        return ["tool", "tester", "crimper", "стриппер", "кримпер", "тестер", "rj45", "rj11"]
    return []


def _build_type_aware_query(query: str, goods_type: str = "") -> str:
    raw = str(query or "").strip()
    type_hint = _get_type_hint(goods_type)
    if not raw:
        return type_hint
    if not type_hint:
        return raw
    raw_norm = _normalize_text(raw)
    hint_norm = _normalize_text(type_hint)
    if raw_norm == hint_norm or hint_norm in raw_norm:
        return raw
    if any(token and token in raw_norm for token in hint_norm.split(" ") if len(token) >= 4):
        return raw
    return f"{type_hint} {raw}".strip()


_GENERIC_MODEL_TOKENS = {
    "системный", "блок", "ноутбук", "монитор", "сервер", "моноблок", "компьютер", "рабочая", "станция",
    "клавиатура", "мышь", "гарнитура", "принтер", "мфу", "сканер", "коммутатор", "маршрутизатор",
    "точка", "доступа", "накопитель", "кабель", "адаптер", "патч", "корд", "лицензия", "подписка",
    "поддержка", "техподдержка", "программное", "обеспечение", "операционная", "система", "комплект",
    "оборудование", "товар", "изделие", "устройство", "цвет", "черный", "черная", "черныйи",
    "размер", "длина", "ширина", "высота", "вес", "масса", "поставка", "поставляемого", "для",
    "на", "по", "и", "или", "с", "без", "pro", "mini",
    "system", "unit", "desktop", "pc", "computer", "server", "monitor", "printer", "scanner",
    "switch", "router", "access", "point", "storage", "ssd", "hdd", "software", "license",
    "support", "subscription", "with", "without", "black", "white",
}
_BRAND_HINTS = (
    "msi", "asus", "acer", "dell", "hp", "hewlett", "lenovo", "huawei", "xiaomi", "apple",
    "graviton", "гравитон", "aquarius", "аквариус", "iru", "айру", "yadro", "ядро",
    "gigabyte", "asrock", "supermicro", "hpe", "hpе", "ibm", "cisco", "juniper", "mikrotik",
    "tp link", "tp-link", "zyxel", "keenetic", "samsung", "kingston", "apc", "epson",
    "xerox", "kyocera", "pantum", "ricoh", "canon", "brother", "intel", "amd", "nvidia",
    "astra", "рупост", "rupost", "termidesk", "ald", "brest",
)
_OFFICIAL_VENDOR_DOMAINS: dict[str, tuple[str, ...]] = {
    "msi": ("msi.com",),
    "dell": ("dell.com",),
    "hp": ("hp.com", "hpe.com"),
    "hewlett": ("hp.com", "hpe.com"),
    "lenovo": ("lenovo.com",),
    "asus": ("asus.com",),
    "acer": ("acer.com",),
    "huawei": ("huawei.com",),
    "apple": ("apple.com",),
    "mikrotik": ("mikrotik.com",),
    "cisco": ("cisco.com",),
    "juniper": ("juniper.net",),
    "tp link": ("tp-link.com",),
    "tp-link": ("tp-link.com",),
    "zyxel": ("zyxel.com",),
    "keenetic": ("keenetic.com",),
    "samsung": ("samsung.com",),
    "epson": ("epson.com",),
    "xerox": ("xerox.com",),
    "kyocera": ("kyoceradocumentsolutions.com", "kyocera.com"),
    "canon": ("canon.com",),
    "brother": ("brother.com",),
}


def _normalize_model_search_text(value: str) -> str:
    text = str(value or "").lower().replace("ё", "е")
    text = re.sub(r"[^a-zа-я0-9+./_-]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _has_alpha_digit_mix(token: str) -> bool:
    return bool(re.search(r"[a-zа-я]", token, flags=re.I) and re.search(r"\d", token))


def _has_structured_code_token(token: str) -> bool:
    return bool(re.search(r"[a-zа-я0-9]+[-_/+.][a-zа-я0-9]+", token, flags=re.I))


def _looks_like_specific_model_query(value: str) -> bool:
    raw = str(value or "").strip()
    if not raw or len(raw) > 180:
        return False
    normalized = _normalize_model_search_text(raw)
    if not normalized:
        return False
    if re.search(r"(?:техподдерж|поддержк|support|сопровождени|оказани[ея]|услуг)", normalized, flags=re.I):
        return False
    tokens = [token for token in normalized.split(" ") if token]
    if len(tokens) < 2:
        return False
    informative_tokens = [token for token in tokens if token not in _GENERIC_MODEL_TOKENS]
    if len(informative_tokens) < 2:
        return False
    has_brand_hint = any(brand in normalized for brand in _BRAND_HINTS)
    has_code_token = any(_has_alpha_digit_mix(token) or _has_structured_code_token(token) for token in informative_tokens)
    long_latin_tokens = sum(1 for token in informative_tokens if re.search(r"[a-z]", token, flags=re.I) and len(token) >= 3)
    has_upper_series = bool(re.search(r"(?:^|[\s(])([A-Z]{2,}[A-Z0-9/+._-]{1,}|[A-Z]?\d+[A-Z0-9._/-]+)(?:$|[\s)])", raw))
    measured_cues = re.findall(r"\d+\s*(?:гб|gb|tb|тб|mhz|мгц|ггц|вт|мм|см|кг|г|шт|mah|мач|дюйм|hz)", raw, flags=re.I)
    looks_like_spec_sentence = bool(re.search(r"[:,;]", raw) or (len(measured_cues) >= 2 and len(informative_tokens) >= 4))

    if looks_like_spec_sentence and not has_code_token:
        return False
    if has_code_token:
        return True
    if has_brand_hint and (long_latin_tokens >= 2 or has_upper_series):
        return True
    if has_upper_series and len(informative_tokens) >= 3:
        return True
    return False


def _infer_official_domains(query: str) -> list[str]:
    normalized = _normalize_model_search_text(query)
    if not normalized:
        return []
    domains: list[str] = []
    for brand, brand_domains in _OFFICIAL_VENDOR_DOMAINS.items():
        if brand in normalized:
            for domain in brand_domains:
                if domain not in domains:
                    domains.append(domain)
    return domains


def _dedupe_query_list(queries: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in queries:
        query = re.sub(r"\s+", " ", str(item or "")).strip()
        if not query:
            continue
        key = query.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(query)
    return result


def _build_internet_queries(product: str, goods_type: str = "") -> list[str]:
    product = _clean_search_query(product)
    search_query = _build_type_aware_query(product, goods_type)
    exact_model = _looks_like_specific_model_query(product)
    if not exact_model:
        return [
            f"{search_query} характеристики",
            f"{search_query} технические характеристики",
            f"{search_query} specification",
            f"{search_query} datasheet",
        ]

    quoted_product = f"\"{product}\""
    type_hint = _get_type_hint(goods_type)
    queries = [
        f"{quoted_product} технические характеристики",
        f"{quoted_product} specification",
        f"{quoted_product} datasheet",
    ]
    for domain in _infer_official_domains(product):
        queries.extend([
            f"site:{domain} {quoted_product}",
            f"site:{domain} {product} specification",
        ])
    if type_hint:
        queries.extend([
            f"{product} {type_hint} характеристики",
        ])
    return _dedupe_query_list(queries)


def _build_procurement_queries(query: str, goods_type: str = "") -> list[str]:
    base = _clean_search_query(query)
    search_query = _build_type_aware_query(base, goods_type)
    type_hint = _get_type_hint(goods_type) or search_query
    exact_model = _looks_like_specific_model_query(base)
    if not exact_model:
        return [
            f"site:zakupki.gov.ru {type_hint} КТРУ характеристики",
            f"site:zakupki.gov.ru {search_query} техническое задание",
            f"site:zakupki.gov.ru {search_query} описание объекта закупки",
            f"site:zakupki.gov.ru {type_hint} описание объекта закупки",
            f"site:rostender.info {search_query} техническое задание",
            f"site:rostender.info {type_hint} описание объекта закупки",
            f"site:zakupki.mos.ru {search_query} техническое задание",
            f"site:zakupki.mos.ru {search_query} описание объекта закупки",
            f"site:zakupki.mos.ru {type_hint} описание объекта закупки",
            f"site:gisp.gov.ru {type_hint} характеристики",
            f"site:gisp.gov.ru {search_query} характеристики",
            f"site:gisp.gov.ru {type_hint} реестр российской промышленной продукции",
            f"site:minpromtorg.gov.ru {type_hint} характеристики",
            f"site:minpromtorg.gov.ru {search_query} технические характеристики",
            f"site:minpromtorg.gov.ru {search_query} реестр российской промышленной продукции",
        ]

    quoted = f"\"{base}\""
    queries = [
        f"site:zakupki.gov.ru {quoted} техническое задание",
        f"site:zakupki.gov.ru {quoted} описание объекта закупки",
        f"site:rostender.info {quoted} техническое задание",
        f"site:gisp.gov.ru {quoted} характеристики",
        f"site:minpromtorg.gov.ru {quoted} технические характеристики",
        f"site:zakupki.gov.ru {type_hint} КТРУ характеристики",
    ]
    return _dedupe_query_list(queries)


def _build_entity_tokens(query: str, goods_type: str = "") -> list[str]:
    type_words = set(_normalize_text(_get_type_hint(goods_type)).split())
    type_words.update(_normalize_text(item) for item in _get_goods_type_keywords(goods_type))
    out: list[str] = []
    for token in _normalize_text(query).split():
        if len(token) >= 3 and token not in type_words:
            out.append(token)
    return out


def _score_search_result(item: dict[str, Any], query: str, goods_type: str = "") -> int:
    joined = " ".join(str(item.get(part, "")) for part in ("title", "snippet", "link"))
    text = _normalize_text(joined)
    if not text:
        return -100
    if any(host in text for host in _BLOCKED_RESULT_HOSTS):
        return -100
    if any(pattern.search(joined) for pattern in _NOISY_RESULT_PATTERNS):
        return -80
    score = 0
    exact_model = _looks_like_specific_model_query(query)
    normalized_query = _normalize_text(query)
    if exact_model and normalized_query and normalized_query in text:
        score += 60
    for token in _get_goods_type_keywords(goods_type):
        token_norm = _normalize_text(token)
        if token_norm and token_norm in text:
            score += 12
    for token in _normalize_text(query).split():
        if len(token) >= 3 and token in text:
            score += 4
    for token in _build_entity_tokens(query, goods_type):
        if token in text:
            score += 12 if exact_model else 10
    if re.search(r"spec|характерист|technical|техническ|datasheet|product", joined, flags=re.I):
        score += 14 if exact_model else 10
    for domain, weight in _PREFERRED_SOURCE_WEIGHTS.items():
        if domain in text:
            score += weight
    for domain in _infer_official_domains(query):
        if domain in text:
            score += 20
    if re.search(r"logitech\.com|microsoft\.com|hp\.com|lenovo\.com|dell\.com|asus\.com|acer\.com|a4tech|defender\.ru|sven", joined, flags=re.I):
        score += 6
    return score


def _is_relevant_search_result(item: dict[str, Any], query: str, goods_type: str = "", procurement_only: bool = False) -> bool:
    score = _score_search_result(item, query, goods_type)
    if score < 8:
        return False
    text = _normalize_text(" ".join(str(item.get(part, "")) for part in ("title", "snippet", "link")))
    entity_tokens = _build_entity_tokens(query, goods_type)
    entity_match_count = sum(1 for token in entity_tokens if token in text)
    exact_model = _looks_like_specific_model_query(query)
    if entity_tokens and not any(token in text for token in entity_tokens):
        return False
    if procurement_only and not any(domain in text for domain in _PROCUREMENT_DOMAINS):
        return False
    keywords = _get_goods_type_keywords(goods_type)
    if exact_model:
        if len(entity_tokens) >= 3 and entity_match_count < 2:
            return False
        if keywords and any(_normalize_text(token) in text for token in keywords):
            return True
        if any(domain in text for domain in _infer_official_domains(query)):
            return True
        return entity_match_count >= min(3, len(entity_tokens) or 1)
    if not keywords:
        return True
    return any(_normalize_text(token) in text for token in keywords)


def _dedupe_specs(specs: list[dict]) -> list[dict]:
    seen: dict[str, dict] = {}
    for item in specs or []:
        name = _normalize_text(str(item.get("name", "")))
        value = str(item.get("value", "")).strip()
        if not name or not value:
            continue
        if name not in seen:
            seen[name] = {
                "name": str(item.get("name", "")).strip(),
                "value": value,
                "unit": _infer_unit(str(item.get("name", "")).strip(), value, str(item.get("unit", "")).strip()),
            }
            continue
        current = seen[name]
        current_value = str(current.get("value", ""))
        if len(value) > len(current_value) and "или эквивалент" not in value.lower():
            current["value"] = value
            current["unit"] = str(item.get("unit", "")).strip() or _detect_unit(value)
    return list(seen.values())


def _merge_specs(primary: list[dict], fallback: list[dict]) -> list[dict]:
    merged: list[dict] = []
    index: dict[str, int] = {}
    for bucket in (primary or [], fallback or []):
        for item in bucket:
            name = str(item.get("name", "")).strip()
            value = str(item.get("value", "")).strip()
            if not name or not value:
                continue
            key = _normalize_text(name)
            if key in index:
                current = merged[index[key]]
                if len(value) > len(str(current.get("value", ""))) and "или эквивалент" not in value.lower():
                    merged[index[key]] = {
                        "name": name,
                        "value": value,
                        "unit": _infer_unit(name, value, str(item.get("unit", "")).strip()),
                    }
                continue
            index[key] = len(merged)
            merged.append({
                "name": name,
                "value": value,
                "unit": _infer_unit(name, value, str(item.get("unit", "")).strip()),
            })
    return merged


def _extract_spec_pairs(text: str, max_items: int = 25) -> list[dict]:
    rows: list[dict] = []
    for raw_line in str(text or "").splitlines():
        line = re.sub(r"^[\s\-•*]+", "", raw_line).strip()
        if not line:
            continue
        match = re.match(r"([^:]{2,120}):\s*(.+)", line)
        if not match:
            continue
        name = match.group(1).strip()
        value = match.group(2).strip().rstrip(".")
        if not name or not value:
            continue
        rows.append({"name": name, "value": value, "unit": _infer_unit(name, value)})
        if len(rows) >= max_items:
            break
    return _dedupe_specs(rows)


def _extract_table_like_pairs(text: str, max_items: int = 25) -> list[dict]:
    rows: list[dict] = []
    for raw_line in str(text or "").splitlines():
        line = re.sub(r"^\|+|\|+$", "", str(raw_line or "")).strip()
        if not line or "|" not in line:
            continue
        cells = [re.sub(r"\s+", " ", cell).strip() for cell in line.split("|")]
        cells = [cell for cell in cells if cell]
        if len(cells) < 2:
            continue
        name = cells[0]
        value = cells[1]
        if not name or not value:
            continue
        rows.append({"name": name, "value": value, "unit": _infer_unit(name, value)})
        if len(rows) >= max_items:
            break
    return _dedupe_specs(rows)


_GENERIC_EXACT_MODEL_VALUE_RE = re.compile(
    r"(по типу( товара| программного обеспечения)?|по назначению|по требованиям заказчика|"
    r"в соответствии с (типом товара|требованиями заказчика)|в количестве, достаточном|"
    r"типовая конфигурация|согласно требованиям|согласно документации|заводская упаковка|"
    r"новый, не бывший|эксплуатационной документации|заводской маркировки)",
    re.I,
)
_FORMAL_EXACT_MODEL_NAME_RE = re.compile(
    r"^(состояние(?:\s+товара)?|комплект\s+поставки|документац.*|маркировк.*|гаранти.*|"
    r"упаковка(?:\s+и\s+маркировка)?|страна\s+происхождения|условия\s+поставки)$",
    re.I,
)
_CORE_EXACT_MODEL_NAME_RE = re.compile(
    r"(процессор|оперативн|памят|накопител|ssd|hdd|nvme|графическ|видеокарт|сетев|ethernet|wi-?fi|bluetooth|"
    r"порт|usb|hdmi|displayport|vga|dvi|размер|габарит|длина|ширина|высота|глубина|диаметр|толщин|"
    r"вес|масса|питан|блок питания|мощност|диагонал|разрешен|матриц|камера|аккумулятор|батаре|чипсет|"
    r"сокет|слот|интерфейс|форм[ -]?фактор|корпус|монтаж|vesa|tpm|операционная система|ос|типоразмер|"
    r"тип(?!\s+товара)|материал|состав|объем|объ[её]м|емкост|[её]мкост|плотност|цвет|класс|сорт|формат|"
    r"фасовк|колич|сло|лист|рулон|намотк|покрыти|твердост|нагрузк|производительност|давлени|расход|"
    r"температур|напряжен|ток|ресурс|срок годности|срок хранения|совместимост|стандарт|гост|ip|snr|выпуск|смыв|"
    r"сидень|арматур|белизн|непрозрачност|химическ|бит|жало|насадк)",
    re.I,
)
_QUALITATIVE_DETAIL_VALUE_RE = re.compile(
    r"^(щелочн|алкалин|литиев|первичн(ая|ой)? целлюлоз|вторичн(ое|ой) сыр[ьеё]|cr-v|s2|нержаве(ющая|ющая сталь)?|"
    r"латун|керамик|полипропилен|полиэтилен|микрофибр|сенсорн|механическ|компакт|подвесн|горизонтальн|"
    r"косой|двойн(?:ой|ое)|кругов(?:ой|ое)|аккумуляторн|сетев(?:ой|ое)|ударн|бесщеточн|бел(?:ый|ая)|"
    r"сер(?:ый|ая)|черн(?:ый|ая)|матов(?:ый|ая)|глянцев(?:ый|ая)|перфорированн|тиснен(?:ие|ый)|"
    r"однослойн|двухслойн|трехслойн|трёхслойн)",
    re.I,
)
_TECH_DETAIL_VALUE_RE = re.compile(
    r"(\d+\s*(гб|мб|тб|ггц|мгц|вт|дюйм|мм|см|м|кг|г|мл|л|м²|м2|м³|м3|мкм|бар|об/мин|л/мин|м/с|"
    r"лист(?:ов)?|рулон(?:ов)?|сло(?:й|я|ев)|шт\.?|пар|mah|мач|ah|ач|в|а|°c|°с|дб|db|лм|lm|cie|dpi|"
    r"ppi|snr|ip\d{2}|pei|гбит/с|мбит/с|fps))|aa|aaa|lr6|lr03|cr2032|cr2025|cr2016|cr-v|torx|ph\d|"
    r"pz\d|sl\d|tx\d|e27|e14|gu10|ral\s*\d+|no frost|ffp\d|pn\d|m\d{1,2}|a4|a3|fsc|гост|ту|щелочн|"
    r"алкалин|литиев|целлюлоз|макулатур|нержаве|латун|керамик|полипропилен|полиэтилен|микрофибр|"
    r"двойной слив|круговой смыв|горизонтальный выпуск|косой выпуск|компакт|подвесной|сенсорный|"
    r"механический|аккумуляторный|сетевой|ударный|бесщеточный|phillips|pozidriv",
    re.I,
)
_THIN_THRESHOLD_ONLY_RE = re.compile(
    r"^не\s+(?:менее|более)\s+\d+(?:[.,]\d+)?\s*(гб|мб|тб|ггц|мгц|вт|дюйм|мм|см|м|кг|г|мл|л|лист(?:ов)?|"
    r"рулон(?:ов)?|сло(?:й|я|ев)|шт\.?|пар|mah|мач|ah|ач|в|а|порт(?:а|ов)?|ядер?|поток(?:ов)?|мес)?$",
    re.I,
)
_ALLOW_THRESHOLD_ONLY_EXACT_MODEL_NAME_RE = re.compile(
    r"(размер|габарит|длина|ширина|высота|глубина|диаметр|толщин|вес|масса|объем|объ[её]м|"
    r"емкост|[её]мкост|мощност|диагонал|напряжен|ток|колич|лист|рулон|сло|намотк|ресурс|"
    r"срок годности|срок хранения)",
    re.I,
)


def _is_weak_exact_model_spec(item: dict[str, Any]) -> bool:
    name = re.sub(r"\s+", " ", str(item.get("name", ""))).strip().lower().replace("ё", "е")
    value = re.sub(r"\s+", " ", str(item.get("value", ""))).strip()
    normalized_value = value.lower().replace("ё", "е")
    if not name or not value:
        return True
    if _GENERIC_EXACT_MODEL_VALUE_RE.search(normalized_value):
        return True
    if "и/или" in normalized_value and not _TECH_DETAIL_VALUE_RE.search(value):
        return True
    if (
        _CORE_EXACT_MODEL_NAME_RE.search(name)
        and _THIN_THRESHOLD_ONLY_RE.match(normalized_value)
        and not _ALLOW_THRESHOLD_ONLY_EXACT_MODEL_NAME_RE.search(name)
    ):
        return True
    if _FORMAL_EXACT_MODEL_NAME_RE.search(name):
        return True
    if _CORE_EXACT_MODEL_NAME_RE.search(name) and _QUALITATIVE_DETAIL_VALUE_RE.search(normalized_value):
        return False
    if _CORE_EXACT_MODEL_NAME_RE.search(name) and not _TECH_DETAIL_VALUE_RE.search(value) and len(normalized_value.split()) <= 6:
        return True
    return False


def _count_concrete_exact_model_specs(specs: list[dict]) -> int:
    total = 0
    for item in specs or []:
        name = re.sub(r"\s+", " ", str(item.get("name", ""))).strip()
        value = re.sub(r"\s+", " ", str(item.get("value", ""))).strip()
        if not name or not value:
            continue
        if _FORMAL_EXACT_MODEL_NAME_RE.search(name):
            continue
        if not _CORE_EXACT_MODEL_NAME_RE.search(name):
            continue
        if _is_weak_exact_model_spec(item):
            continue
        if _TECH_DETAIL_VALUE_RE.search(value) or _QUALITATIVE_DETAIL_VALUE_RE.search(value.lower()) or re.search(r"\d", value):
            total += 1
    return total


def _has_sufficient_exact_model_quality(specs: list[dict]) -> bool:
    if len(specs or []) < 7:
        return False
    weak = sum(1 for item in specs if _is_weak_exact_model_spec(item))
    concrete = _count_concrete_exact_model_specs(specs)
    return concrete >= 5 and weak <= max(4, int(len(specs) * 0.35))


def _detect_peripheral_connection_profile(source: str) -> dict[str, Any]:
    raw = str(source or "")
    tokens = _normalize_text(raw).split()
    has_bluetooth = bool(re.search(r"bluetooth|\bbt\b", raw, flags=re.I))
    has_receiver_wireless = bool(re.search(r"wireless|беспровод|радио|радиоканал|receiver|ресивер|приемник|приёмник|dongle|nano|unifying|2[\s,.]?4|rf", raw, flags=re.I))
    has_wireless = has_bluetooth or has_receiver_wireless or bool(re.search(r"wifi|wi fi", raw, flags=re.I)) or any(token.startswith("беспровод") for token in tokens)
    has_wired = any(token in {"wired", "cable"} or token.startswith("провод") or "кабел" in token for token in tokens)
    if has_wireless and not has_wired:
        if has_receiver_wireless and not has_bluetooth:
            connection = "Беспроводное (USB-радиоканал 2,4 ГГц) или эквивалент"
            interface = "USB-радиоканал 2,4 ГГц через USB-приёмник или эквивалент"
        elif has_bluetooth and not has_receiver_wireless:
            connection = "Беспроводное (Bluetooth) или эквивалент"
            interface = "Bluetooth по спецификации производителя"
        else:
            connection = "Беспроводное (USB-радиоканал 2,4 ГГц и/или Bluetooth) или эквивалент"
            interface = "Bluetooth и/или USB-радиоканал 2,4 ГГц по спецификации производителя"
        return {"wireless": True, "receiver_based": has_receiver_wireless, "connection": connection, "interface": interface}
    if has_wired and not has_wireless:
        return {
            "wireless": False,
            "receiver_based": False,
            "connection": "Проводное USB или эквивалент",
            "interface": "USB 2.0/3.0 или эквивалент",
        }
    if has_wireless and has_wired:
        return {
            "wireless": True,
            "receiver_based": has_receiver_wireless,
            "connection": "Проводное USB и/или беспроводное (Bluetooth/2.4 ГГц) по требованиям Заказчика",
            "interface": "USB 2.0/3.0 и/или USB-радиоканал 2,4 ГГц/Bluetooth по спецификации производителя",
        }
    return {
        "wireless": False,
        "receiver_based": False,
        "connection": "Проводное USB или эквивалент",
        "interface": "USB 2.0/3.0 или эквивалент",
    }


def _build_baseline_spec_text(goods_type: str = "", query: str = "") -> str:
    key = str(goods_type or "").strip()
    raw = str(query or "").strip()
    normalized = _normalize_text(raw)

    if key == "cableTester":
        has_coax = bool(re.search(r"coax|коакс|bnc", normalized))
        has_poe = bool(re.search(r"\bpoe\b", normalized))
        return f"""
Тип устройства: Многофункциональный кабельный тестер
Тестируемые типы кабелей: {"Витая пара (UTP, FTP, STP), телефонный и/или коаксиальный кабель" if has_coax else "Витая пара (UTP, FTP, STP), телефонный кабель"}
Категории кабелей: Cat.5, Cat.5e, Cat.6{" , Cat.6a, Cat.7" if re.search(r'cat\\s*7', normalized) else (" , Cat.6a" if re.search(r'cat\\s*6a', normalized) else "")}
Тестируемые разъемы: {"RJ-45, RJ-11, RJ-12, BNC" if has_coax else "RJ-45, RJ-11, RJ-12"}
Функции тестирования: Обрыв, короткое замыкание, неверная пара, перепутанные пары, экранирование{", PoE" if has_poe else ""}
Дальность тестирования: не менее 300 м
Тип индикации: Светодиодная (LED) и/или ЖК-дисплей по спецификации производителя
Удаленный модуль: В комплекте
Питание: Батарейки типа AAA или эквивалент
Комплектность: Тестер, удаленный модуль, элементы питания (при наличии), чехол/сумка, документация производителя
"""

    if key == "rj45Connector":
        category = re.search(r"\bcat\s*(5e|6a|6|7|8)\b", normalized)
        shielding = re.search(r"\b(s/?ftp|sf/utp|ftp|stp|f/utp|u/utp|utp)\b", normalized, flags=re.I)
        solid = bool(re.search(r"solid|одножил", normalized))
        stranded = bool(re.search(r"stranded|многожил", normalized))
        return f"""
Тип разъема: RJ-45 (8P8C)
Категория СКС: не ниже {"Cat" + category.group(1).upper() if category else "Cat5e"}
Экранирование: {shielding.group(1).upper() if shielding else "U/UTP и/или экранированное исполнение по требованиям Заказчика"}
Совместимый тип проводника: {"Одножильный" if solid and not stranded else ("Многожильный" if stranded and not solid else "Одножильный и/или многожильный по спецификации производителя")}
Тип монтажа / обжима: Обжимной
Материал контактов: Сплав с защитным покрытием по спецификации производителя
Совместимый диаметр кабеля: В соответствии со спецификацией производителя
Упаковка / количество: В соответствии с требованиями Заказчика и упаковкой производителя
"""

    if key == "keyboardMouseSet":
        profile = _detect_peripheral_connection_profile(raw)
        cable_or_radius = "Радиус действия беспроводного комплекта: не менее 5 м" if profile["wireless"] else "Кабель подключения: длина кабеля клавиатуры и/или мыши не менее 1.5 м"
        power_line = "Тип питания устройств: Сменные элементы питания и/или встроенный аккумулятор по документации производителя" if profile["wireless"] else ""
        receiver_line = "Беспроводной приёмник: USB-приёмник для подключения комплекта по радиоканалу 2,4 ГГц" if profile["receiver_based"] else ""
        return f"""
Состав комплекта: Клавиатура и компьютерная мышь
Тип подключения: {profile["connection"]}
Интерфейс подключения комплекта: {profile["interface"]}
Раскладка клавиатуры: Русская и латинская (двуязычная) с заводской маркировкой
Количество клавиш клавиатуры: не менее 104 шт.
Наличие цифрового блока клавиатуры: Наличие
Тип клавишного механизма: Мембранный/ножничный или эквивалент
Тип сенсора мыши: Оптический или эквивалент
Разрешение сенсора мыши: не менее 1000 dpi
Количество кнопок мыши: не менее 3 шт.
Колесо прокрутки мыши: Наличие колеса вертикальной прокрутки
Ресурс клавиш клавиатуры: не менее 5 млн нажатий
{cable_or_radius}
{power_line}
{receiver_line}
Совместимость с ОС: Windows/Linux/macOS или эквивалент
Комплектность: {"Клавиатура, мышь, USB-приёмник и/или элементы питания (при необходимости), документация производителя" if profile["wireless"] else "Клавиатура, мышь, кабель подключения (при наличии), документация производителя"}
"""

    if key == "opticalDrive":
        has_bluray = bool(re.search(r"blu ray|bluray|\bbd\b", normalized))
        has_writer = bool(re.search(r"\brw\b|writer|burn|запис", raw, flags=re.I))
        interface_value = "USB 3.0 или эквивалент" if re.search(r"usb\s*3", raw, flags=re.I) else "USB 2.0/3.0 или эквивалент"
        return f"""
Тип устройства: Внешний оптический привод
Поддерживаемые форматы носителей: {"CD-ROM/CD-R/CD-RW/DVD-ROM/DVD±R/DVD±RW/BD-ROM/BD-R/BD-RE" if has_bluray and has_writer else ("CD-ROM/CD-R/CD-RW/DVD-ROM/DVD±R/DVD±RW/BD-ROM" if has_bluray else "CD-ROM/CD-R/CD-RW/DVD-ROM/DVD±R/DVD±RW")}
Скорость чтения CD: не менее 24 x
Скорость чтения DVD: не менее 8 x
{"Скорость чтения Blu-ray: не менее 4 x" if has_bluray else ""}
{"Скорость записи CD: не менее 8 x" if has_writer else "Функция записи: Чтение и/или запись по спецификации производителя"}
{"Скорость записи DVD: не менее 8 x" if has_writer else ""}
{"Скорость записи Blu-ray: не менее 2 x" if has_bluray and has_writer else ""}
Тип загрузки диска: Выдвижной лоток и/или slot-in по спецификации производителя
Интерфейс подключения: {interface_value}
Питание устройства: От интерфейса USB без внешнего блока питания и/или от внешнего адаптера по документации производителя
Совместимость с ОС: Windows/Linux/macOS или эквивалент
Комплектность: Привод, кабель подключения, эксплуатационная документация производителя
"""

    if key == "speakers":
        has_bt = bool(re.search(r"bluetooth|\bbt\b", raw, flags=re.I))
        has_usb = bool(re.search(r"usb", raw, flags=re.I))
        has_subwoofer = bool(re.search(r"\b2\.1\b|subwoofer|сабвуфер", raw, flags=re.I))
        power_match = re.search(r"(\d{1,3})\s*(?:вт|w)", raw, flags=re.I)
        min_power = f"не менее {power_match.group(1)} Вт" if power_match else "не менее 6 Вт"
        channels = "2.1" if has_subwoofer else "2.0"
        interfaces = "Bluetooth и/или проводной аудиовход (AUX/USB)" if has_bt else ("USB и/или AUX 3.5 мм" if has_usb else "AUX 3.5 мм и/или USB")
        return f"""
Тип акустической системы: {"Активная акустическая система " + channels + " с поддержкой проводного и/или беспроводного подключения" if has_bt else "Активная акустическая система " + channels + " или эквивалент"}
Конфигурация акустических каналов: {channels}
Выходная мощность (RMS): {min_power}
Диапазон воспроизводимых частот: не уже 100 Гц - 20 кГц
Регулировка громкости: Наличие аппаратной регулировки громкости и/или тембра
Интерфейсы подключения: {interfaces}
{"Поддержка Bluetooth: Наличие беспроводного интерфейса Bluetooth" if has_bt else ""}
Тип питания: {"От USB 5В и/или от сети 220В" if has_usb else "От сети 220В и/или от USB 5В"}
Совместимость с источниками сигнала: Персональный компьютер, ноутбук и иные устройства с совместимым аудиовыходом
Комплектность: Акустическая система, кабели подключения/питания, документация производителя
"""

    if key == "webcam":
        return """
Тип устройства: Веб-камера для подключения к персональному компьютеру/ноутбуку
Разрешение видео: не менее 1920x1080
Частота кадров: не менее 30 кадр/с
Тип матрицы: CMOS или эквивалент
Фокусировка: Автоматическая и/или фиксированная по требованиям Заказчика
Угол обзора: не менее 70 °
Интерфейс подключения: USB 2.0/3.0 или эквивалент
Поддержка UVC / Plug-and-Play: Наличие поддержки UVC и Plug-and-Play
Встроенный микрофон: Наличие встроенного микрофона
Совместимость с ОС и ПО видеоконференций: Windows/Linux/macOS и распространённые ВКС-клиенты
Способ крепления: Крепление на монитор/дисплей и/или установка на горизонтальную поверхность
Длина встроенного кабеля: не менее 1.5 м
"""

    if key == "keyboard":
        return """
Тип устройства: Клавиатура компьютерная
Тип подключения: Проводное USB или эквивалент
Форм-фактор: Полноразмерный или эквивалент
Раскладка: Русская и латинская (двуязычная) с заводской маркировкой
Количество клавиш: не менее 104 шт.
Тип клавишного механизма: Мембранный/ножничный или эквивалент
Блок цифровых клавиш: Наличие отдельного цифрового блока
Ресурс клавиш: не менее 5 млн нажатий
Индикаторы режимов: Наличие индикации Num Lock / Caps Lock / Scroll Lock
Совместимость с ОС: Windows/Linux/macOS или эквивалент
Комплектность: Клавиатура, кабель/приёмник (при наличии), документация производителя
"""

    if key == "mouse":
        return """
Тип устройства: Компьютерная мышь
Тип сенсора: Оптический или эквивалент
Тип подключения: Проводное USB или эквивалент
Разрешение сенсора: не менее 1000 dpi
Количество кнопок: не менее 3 шт.
Колесо прокрутки: Наличие колеса вертикальной прокрутки
Эргономика: Для работы правой и/или левой рукой
Совместимость с ОС: Windows/Linux/macOS или эквивалент
Длина кабеля: не менее 1.5 м
Комплектность: Мышь, кабель/приёмник (при наличии), документация производителя
"""

    if key == "toolSet":
        return """
Назначение: Для монтажа и обслуживания структурированной кабельной системы
Состав набора: Кримпер, стриппер, тестер, нож и/или иные инструменты по спецификации производителя
Поддерживаемые разъемы: RJ-45, RJ-11, RJ-12 и/или коаксиальные разъемы по спецификации производителя
Материал рабочих частей: Инструментальная сталь или эквивалент
Материал рукояток: Ударопрочный пластик и/или прорезиненное покрытие
Чехол / кейс: Наличие кейса или сумки для хранения и переноски
Рабочая температура: В соответствии с документацией производителя
Комплектность: Набор инструментов, кейс/сумка, документация производителя
"""

    if key == "patchCord":
        length_match = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:м|метр(?:а|ов)?|m)(?![a-z])", raw, flags=re.I)
        category_match = re.search(r"\bcat\s*(5e|6a|6|7|8)\b", normalized)
        shield_match = re.search(r"\b(s/?ftp|sf/utp|ftp|stp|f/utp|u/utp|utp)\b", normalized, flags=re.I)
        return f"""
Тип кабельного изделия: Патч-корд для структурированной кабельной системы
Тип разъемов: RJ-45 ↔ RJ-45 и/или иной тип разъемов по спецификации производителя
Категория СКС: {"не ниже Cat" + category_match.group(1).upper() if category_match else "не ниже Cat5e"}
Конструкция кабеля: {shield_match.group(1).upper() if shield_match else "U/UTP, F/UTP, FTP, S/FTP и/или иное исполнение по требованиям Заказчика"}
Материал проводника: Медный проводник и/или иное исполнение по спецификации производителя
Длина кабеля: не менее {str(length_match.group(1)).replace(",", ".") if length_match else "1"} м
Цвет оболочки: По требованиям Заказчика
Комплектность: Кабель в заводском исполнении/упаковке производителя
"""

    if key in _COMPUTE_TYPES:
        return """
Тип устройства: Вычислительное устройство для эксплуатации в деятельности Заказчика
Процессор: Количество вычислительных ядер не менее 4; архитектура и частотные параметры по требованиям Заказчика
Оперативная память: не менее 8 ГБ
Тип и объем накопителя: SSD и/или HDD; суммарный объем не менее 256 ГБ
Графическая подсистема: Интегрированный и/или дискретный графический адаптер по типу товара
Сетевые интерфейсы: Ethernet 1 Гбит/с и/или беспроводные интерфейсы по требованиям Заказчика
Порты подключения: USB, видеоинтерфейсы и аудиоразъемы в количестве, достаточном для эксплуатации
Форм-фактор / исполнение: В соответствии с типом товара и требованиями Заказчика
Питание: От сети 220В и/или от аккумулятора по типу устройства
Комплектность: Устройство, блок питания/адаптер, необходимые кабели/аксессуары, документация производителя
"""

    if key in _NETWORK_TYPES:
        return """
Тип сетевого устройства: Устройство для эксплуатации в сетевой инфраструктуре Заказчика
Количество интерфейсов / портов: не менее 4 шт.
Скорость интерфейсов: не менее 1 Гбит/с
Типы интерфейсов: RJ-45, SFP/SFP+, консольный и/или иные интерфейсы по типу устройства
Поддерживаемые функции: Коммутация, маршрутизация, безопасность, PoE, беспроводной доступ и/или иные по типу устройства
Поддерживаемые стандарты и протоколы: IEEE 802.3/802.11, VLAN, QoS, SNMP и иные профильные протоколы
Средства управления: Web-интерфейс и/или CLI, журналирование, резервное копирование конфигурации
Электропитание: От сети 220В, PoE и/или внешнего адаптера по типу устройства
Исполнение / способ установки: Настольное, настенное, стоечное и/или иное по требованиям Заказчика
Комплектность: Устройство, блок питания/крепеж/антенны (при наличии), документация производителя
"""

    if key in _PRINT_TYPES:
        return """
Тип устройства: Устройство печати/сканирования по типу товара
Технология печати / сканирования: По типу товара и спецификации производителя
Формат носителя: Не менее A4 и/или иной требуемый формат по типу устройства
Разрешение печати / сканирования: В соответствии с технической документацией производителя
Скорость печати / сканирования: Не ниже параметров, установленных требованиями Заказчика
Поддержка двусторонней печати / АПД / копирования: При применимости по типу товара
Тип расходных материалов: Картридж, лента, термобумага, чернила и/или иной расходный материал по типу устройства
Интерфейсы подключения: USB и/или Ethernet, при необходимости Wi-Fi/Bluetooth
Совместимость с ОС и ПО: Windows, Linux, macOS и/или иные системы по требованиям Заказчика
Комплектность: Устройство, расходные материалы (при наличии), кабели/блок питания, документация производителя
"""

    if key in _STORAGE_TYPES:
        return """
Тип устройства: Накопитель/носитель/модуль памяти для ИТ-инфраструктуры Заказчика
Емкость / объем: не менее 256 ГБ
Интерфейс подключения: SATA/SAS/NVMe/USB/SD и/или иной интерфейс по типу устройства
Форм-фактор: 2.5\", 3.5\", M.2, DIMM/SODIMM, SD/microSD и/или иной по типу товара
Скорость чтения / записи: Не ниже параметров, необходимых для штатной эксплуатации оборудования Заказчика
Показатели надежности: Ресурс, TBW, MTBF и иные параметры по документации производителя
Совместимость: Совместимость с оборудованием Заказчика должна подтверждаться спецификацией производителя
Питание: В соответствии с типом интерфейса и документацией производителя
Комплектность: Изделие в упаковке производителя, адаптеры/крепеж (при наличии), документация
"""

    if key in _COMPONENT_TYPES:
        return """
Тип комплектующего: Комплектующее для модернизации/ремонта компьютерной техники Заказчика
Ключевые технические параметры: Измеряемые параметры в соответствии с типом комплектующего и требованиями совместимого оборудования
Форм-фактор / исполнение: В соответствии с типом товара
Совместимые интерфейсы / разъемы: По документации производителя и требованиям Заказчика
Эксплуатационные параметры: Частоты, пропускная способность, количество линий/портов, TDP и иные по типу комплектующего
Требования к питанию и охлаждению: В соответствии с документацией производителя и конфигурацией целевого оборудования
Совместимость: Должна подтверждаться паспортом/даташитом производителя
Комплектность: Изделие, крепеж/кабели/переходники (при наличии), документация производителя
"""

    if key in _PERIPHERAL_TYPES:
        return """
Тип устройства: Компьютерная периферия для использования по назначению в деятельности Заказчика
Ключевые эксплуатационные параметры: Измеряемые параметры, подтверждаемые технической документацией производителя
Основной режим работы / назначение: Работа с персональным компьютером, ноутбуком, ВКС или мультимедийной инфраструктурой Заказчика
Интерфейсы подключения: USB, HDMI, DisplayPort, AUX, Bluetooth и иные по применимости
Встроенные функции: Микрофон, камера, динамики, сенсорное управление и иные функции при применимости
Способ установки / крепления: Настольное, настенное, на монитор, на штатив и/или иное по типу устройства
Питание: От USB, сети 220В, аккумулятора или комбинированно по типу устройства
Совместимость: Совместимость с оборудованием и ПО Заказчика должна подтверждаться по интерфейсам и драйверам
Комплектность: Устройство, необходимые кабели/адаптеры/крепеж (при наличии), документация производителя
"""

    if key in _SOFTWARE_TYPES:
        return """
Тип программного обеспечения: По типу товара и назначению лицензии
Тип лицензии / права использования: Бессрочная лицензия и/или подписка по требованиям Заказчика
Количество лицензий / пользователей / узлов: не менее 1 шт.
Версия / релиз: Актуальная поддерживаемая версия по документации производителя
Поддерживаемые операционные системы: В соответствии с технической документацией производителя и требованиями Заказчика
Функциональные возможности: По типу программного обеспечения и технической документации производителя
Техническая поддержка / обновления: По условиям поставки и требованиям Заказчика
Состав поставки / включённые компоненты: Лицензии, ключи активации, дистрибутив, документация, доступ к обновлениям
"""

    if key in _CABLE_TYPES:
        length_match = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:м|метр(?:а|ов)?|m)(?![a-z])", raw, flags=re.I)
        category_match = re.search(r"\bcat\s*(5e|6a|6|7|8)\b", normalized)
        shield_match = re.search(r"\b(s/?ftp|sf/utp|ftp|stp|f/utp|u/utp|utp)\b", normalized, flags=re.I)
        return f"""
Тип кабельного изделия: Кабель/шнур для ИТ-инфраструктуры Заказчика
Тип разъемов / интерфейсов: По типу товара и спецификации производителя
Длина кабеля: не менее {str(length_match.group(1)).replace(",", ".") if length_match else "1"} м
Категория / стандарт: {"не ниже Cat" + category_match.group(1).upper() if category_match else "По требованиям Заказчика и спецификации производителя"}
Конструкция кабеля / экранирование: {shield_match.group(1).upper() if shield_match else "Неэкранированное и/или экранированное исполнение по типу товара"}
Материал проводника: Медь и/или иной материал по спецификации производителя
Материал оболочки: ПВХ, LSZH и/или иной материал по спецификации производителя
Совместимость: Совместимость с оборудованием, интерфейсами и кабельной системой Заказчика
Комплектность: Кабельное изделие в заводском исполнении/упаковке производителя
"""

    if key in _CONNECTOR_TYPES:
        return """
Тип изделия: Разъем/модуль/соединитель для коммутационной инфраструктуры
Исполнение разъема: По типу товара и спецификации производителя
Категория / стандарт: Не ниже требуемой категории/стандарта по типу кабельной системы Заказчика
Тип монтажа / подключения: Обжимной, модульный, безынструментальный и/или иной по типу товара
Материал контактов: Сплав с защитным покрытием по спецификации производителя
Совместимый тип проводника / кабеля: В соответствии с технической документацией производителя
Совместимость: Совместимость с портами, панелями, кабелем и иными элементами инфраструктуры Заказчика
Комплектность / упаковка: По спецификации производителя и требованиям Заказчика
"""

    if key in _TOOL_TYPES:
        return """
Назначение: Для монтажа, диагностики и обслуживания ИТ-инфраструктуры Заказчика
Тип изделия: Инструмент и/или комплект инструментов по типу товара
Состав / функциональность: По типу товара и технической документации производителя
Поддерживаемые разъемы / интерфейсы: RJ-45, RJ-11, RJ-12, коаксиальные и/или иные по типу инструмента
Материал рабочих частей: Инструментальная сталь или эквивалент
Эргономика / исполнение рукояток: Противоскользящее покрытие и/или эргономичное исполнение
Комплектность: Изделие/набор, кейс/чехол (при наличии), расходные принадлежности (при наличии), документация производителя
Условия эксплуатации: В соответствии с документацией производителя
"""

    return ""


def _get_baseline_specs(goods_type: str = "", query: str = "") -> list[dict]:
    baseline_text = _build_baseline_spec_text(goods_type, query)
    if not baseline_text.strip():
        return []
    return _extract_spec_pairs(baseline_text, max_items=25)


def _get_astra_fast_spec_text(goods_type: str = "", query: str = "") -> str:
    key = str(goods_type or "").strip()
    normalized = _normalize_text(query)

    if key == "ldap" and re.search(r"(ald|алд|astra linux directory|red adm|служба каталогов|ldap)", normalized):
        is_client = bool(re.search(r"(client|cal|клиент|пользоват|устройств)", normalized))
        if is_client:
            return """
Тип программного обеспечения: Клиентская лицензия службы каталогов / доменной инфраструктуры
Редакция / семейство продукта: ALD Pro Client / CAL или эквивалент
Тип лицензии: Клиентская часть (CAL)
Метрика лицензирования: CAL на устройство и/или CAL на пользователя
Лицензируемый объект: 1 устройство и/или 1 пользователь
Назначение лицензии: Управление рабочей станцией или сервером в домене
Поддерживаемые объекты: Рабочие станции и серверы, включенные в домен
Применение групповых политик: Наличие
Поддержка конфигураций SaltStack: Наличие
Управление конфигурацией хоста: Наличие
Централизованное применение настроек: Наличие
Совместимость с серверной частью: ALD Pro Server / контроллер домена или эквивалент
Совместимость с доменной иерархией OU: Наличие
Совместимость с LDAP / Kerberos: Наличие
Поддержка доменной аутентификации: Наличие
Поддержка массового применения политик: Наличие
Поддерживаемые клиентские ОС: Astra Linux, ALT Linux, РЕД ОС или эквивалентные ОС
Установка и активация: Электронная поставка, ключи активации и документация
Наличие в реестре Минцифры России: Да
Документация на русском языке: Да
Техническая поддержка: По сроку поставки и условиям договора
Обновления и исправления: Наличие в период действия поддержки
Аудит и журналирование действий: Наличие
Веб-интерфейс и/или административная консоль: Наличие
Интеграция со службой каталогов: Наличие
API / средства автоматизации: Наличие
Резервное копирование конфигурации: Наличие
Разграничение прав доступа: Наличие
Журналирование событий безопасности: Наличие
Масштабирование и эксплуатация в домене: Наличие
Способ поставки: Электронная
Количество лицензий: По количеству управляемых устройств и/или пользователей
"""
        return """
Тип программного обеспечения: Серверная часть службы каталогов / контроллер домена
Редакция / семейство продукта: ALD Pro Server или эквивалент
Тип лицензии: Серверная часть
Метрика лицензирования: На экземпляр контроллера домена
Лицензионный состав: Серверная лицензия и клиентские лицензии CAL на управляемые объекты
Лицензируемый объект: 1 контроллер домена
Иерархия подразделений (OU): Наличие
Управление сайтами каталога: Наличие
Топология репликации: Наличие
Multi-master репликация каталога: Наличие
Поддержка межсайтовой синхронизации: Наличие
Групповые политики: Наличие
Поддержка конфигураций SaltStack: Наличие
Автоматизированная установка ОС по сети: PXE / netboot
Миграция из Microsoft Active Directory: Наличие с сохранением структуры домена
Интеграция с DHCP: Наличие
Интеграция с DNS: Наличие
Поддержка прямых и обратных DNS-зон: Наличие
Поддержка LDAP / Kerberos: Наличие
Поддержка доменной аутентификации: Наличие
Средства централизованного администрирования: Наличие
Веб-интерфейс и/или административная консоль: Наличие
Резервное копирование и восстановление конфигурации: Наличие
Журналирование системных и административных событий: Наличие
Разграничение прав доступа: Наличие
Отказоустойчивая схема развёртывания: Поддержка
Поддерживаемые серверные ОС: Astra Linux Special Edition, ALT Linux, РЕД ОС или эквивалентные серверные ОС
Наличие в реестре Минцифры России: Да
Документация на русском языке: Да
Обновления и исправления: Наличие в период поддержки
Способ поставки: Электронная
Количество лицензий: Не менее 1
"""

    if key == "os" and re.search(r"(astra linux|астра|smolensk|voronezh|special edition)", normalized):
        return """
Тип операционной системы: Защищённая многопользовательская операционная система общего назначения
Редакция / вариант поставки: Special Edition для серверов и рабочих станций
Версия / номер релиза: Не ниже 1.8
Исполнение / уровень защищённости: С усиленными встроенными средствами защиты информации
Поддерживаемые аппаратные платформы: x86_64
Разрядность: 64-бит
Версия ядра Linux: Не ниже 6.1
Тип ядра: Монолитное
Поддерживаемые файловые системы: ext4, XFS, Btrfs или эквивалентные
Поддержка сетевых файловых систем: NFS, CIFS/SMB или эквивалентные
Поддержка LVM: Наличие
Поддержка шифрования разделов: Наличие
Графическая оболочка: Наличие
Файловый менеджер: Наличие
Поддержка нескольких мониторов: Наличие
Поддержка HiDPI: Наличие
Мандатное управление доступом (MAC): Наличие
Дискреционный контроль доступа (DAC): Наличие
Замкнутая программная среда: Наличие
Контроль целостности загрузки и файлов: Наличие
Маркировка объектов по уровням конфиденциальности: Наличие
Изоляция процессов и пользователей: Наличие
Очистка оперативной памяти и временных данных: Наличие
Журналирование событий безопасности: Наличие
Встроенный межсетевой экран: Наличие
Поддержка IPv4 / IPv6: Наличие
Поддержка VPN: IPsec, OpenVPN, WireGuard или эквивалентные
Доменная аутентификация: LDAP, Kerberos, ALD Pro или эквивалент
Удалённое администрирование: SSH
Система управления пакетами: apt/dpkg или эквивалент
Средства централизованного обновления: Наличие
Средства централизованного администрирования: Наличие
Поддержка виртуализации: KVM, QEMU или эквивалент
Поддержка контейнеризации: LXC, Docker или эквивалент
Совместимость с отечественными СКЗИ: Наличие
Совместимость с офисными пакетами из реестра Минцифры: Наличие
Совместимость с экосистемой Astra: ALD Pro, Брест, Termidesk, RuPost, RuBackup
Поддержка печати: CUPS или эквивалент
Поддержка сканирования: SANE или эквивалент
Поддержка веб-браузеров: Наличие
Наличие в реестре Минцифры России: Да
Сертификат ФСТЭК России: Наличие
Документация на русском языке: Да
Способ поставки: Электронная
"""

    if key == "email" and re.search(r"(rupost|рупост|почтов)", normalized):
        return """
Тип программного обеспечения: Корпоративный почтовый сервер
Редакция / семейство продукта: RuPost или эквивалент
Тип лицензии: На почтовый ящик / пользователя
Метрика лицензирования: По количеству пользователей / почтовых ящиков
Лицензируемый объект: Почтовый ящик пользователя
Поддержка почтовых протоколов: SMTP, IMAP, POP3
Поддержка веб-интерфейса: Наличие
Поддержка календарей и адресных книг: Наличие
Поддержка ActiveSync или эквивалентной мобильной синхронизации: Наличие
Поддержка антиспам-защиты: Наличие
Поддержка антивирусной проверки: Наличие
Полнотекстовый поиск по почтовым сообщениям: Наличие
Интеграция со службой каталогов: ALD Pro, LDAP, Active Directory или эквивалент
Поддержка ролевой модели доступа: Наличие
Аудит действий администраторов: Наличие
Журналирование событий системы: Наличие
Кластеризация и высокая доступность: Наличие
Отказоустойчивая схема развёртывания: Поддержка
Резервное копирование конфигурации и данных: Наличие
Импорт / миграция из Microsoft Exchange: Наличие с сохранением писем, календарей и адресных книг
Поддержка вложений и лимитов хранения: Наличие
Поддержка транспортных правил и маршрутизации почты: Наличие
Поддержка TLS для почтового трафика: Наличие
Веб-консоль администратора: Наличие
Средства мониторинга и оповещений: Наличие
API / средства интеграции: Наличие
Наличие в реестре Минцифры России: Да
Документация на русском языке: Да
Обновления и исправления безопасности: Наличие
Способ поставки: Электронная
Количество лицензий: По количеству почтовых ящиков
"""

    if key == "backup_sw" and re.search(r"(rubackup|рубэкап|рубак|backup|бэкап)", normalized):
        return """
Тип программного обеспечения: Система резервного копирования
Редакция / семейство продукта: RuBackup или эквивалент
Тип лицензии: По объему данных и/или серверная часть + агенты
Метрика лицензирования: По объему данных (ТБ), клиентам и/или экземплярам серверной части
Состав поставки: Серверная часть, консоль управления, агенты для ОС, БД и приложений
Поддержка полных резервных копий: Наличие
Поддержка инкрементных резервных копий: Наличие
Поддержка дифференциальных резервных копий: Наличие
Безагентное резервное копирование виртуальных машин: Наличие
Поддержка ПК Брест без установки агентов: Наличие
Глобальная дедупликация на стороне клиента и сервера: Наличие
Сжатие резервных копий: Наличие
Шифрование резервных копий по ГОСТ: Наличие
Ролевая модель доступа (RBAC): Наличие
Политики хранения и ротации: Наличие
Планировщик заданий резервного копирования: Наличие
Поддержка ленточных библиотек: Наличие
Поддержка дисковых хранилищ: Наличие
Поддержка сетевых хранилищ: Наличие
Каталог резервных копий и поиск по ним: Наличие
Проверка целостности резервных копий: Наличие
Средства быстрого восстановления: Наличие
Восстановление файлов, ВМ, БД и приложений: Наличие
Централизованная консоль администрирования: Наличие
Мониторинг и уведомления: Наличие
API / средства автоматизации: Наличие
Журналирование событий и аудит действий: Наличие
Интеграция с виртуализацией и инфраструктурой Astra: Наличие
Отказоустойчивая схема развёртывания: Поддержка
Наличие в реестре Минцифры России: Да
Документация на русском языке: Да
Обновления и исправления безопасности: Наличие
Способ поставки: Электронная
"""

    if key == "virt" and re.search(r"(брест|brest|виртуализ)", normalized):
        return """
Тип программного обеспечения: Платформа виртуализации и управления виртуальной инфраструктурой
Редакция / семейство продукта: ПК Брест или эквивалент
Тип лицензии: Бессрочная и/или на физический процессор
Метрика лицензирования: По количеству физических процессоров (socket)
Лицензируемый объект: Физический процессор сервера виртуализации
Управление виртуальными машинами: Наличие
Создание кластеров высокой доступности: Наличие
Отказоустойчивость кластера: Наличие
Живая миграция виртуальных машин: Наличие
Управление виртуальными сетями: Наличие
Управление виртуальными хранилищами: Наличие
Поддержка программно-определяемых хранилищ Ceph: Наличие
Поддержка LVM-хранилищ: Наличие
Поддержка шаблонов виртуальных машин: Наличие
Поддержка снимков и клонирования ВМ: Наличие
Централизованная консоль управления: Наличие
Ролевая модель доступа: Наличие
Журналирование событий и аудит действий: Наличие
Мониторинг ресурсов кластера: Наличие
Распределение ресурсов между ВМ: Наличие
Интеграция со службой каталогов: Наличие
Мандатное управление доступом к виртуальным машинам: Наличие
Совместимость с Astra Linux: Наличие
Совместимость с Termidesk: Наличие
Совместимость с RuBackup: Наличие
Резервное копирование и экспорт конфигурации: Наличие
API / средства автоматизации: Наличие
Отказоустойчивая схема развёртывания: Поддержка
Наличие в реестре Минцифры России: Да
Документация на русском языке: Да
Способ поставки: Электронная
Количество лицензий: По количеству сокетов
"""

    if key == "vdi" and re.search(r"(termidesk|термидеск|vdi)", normalized):
        return """
Тип программного обеспечения: Платформа виртуальных рабочих мест
Редакция / семейство продукта: Termidesk или эквивалент
Тип лицензии: Подписка / конкурентные пользователи / именованные пользователи
Метрика лицензирования: По конкурентным пользователям (CCU) и/или именованным пользователям
Лицензируемый объект: Пользователь / конкурентная сессия
Доставка виртуальных рабочих столов: Наличие
Доставка отдельных приложений: Наличие
Доступ через HTML5-браузер: Наличие
Доступ через тонкий клиент: Наличие
Поддержка шлюза подключений без обязательного VPN: Наличие
Мультиарендность: Наличие
Управление пулами рабочих столов: Наличие
Поддержка терминального режима: Наличие
Поддержка VDI-режима: Наличие
Централизованная консоль управления: Наличие
Поддержка политик безопасности сессий: Наличие
Ролевая модель доступа: Наличие
Журналирование пользовательских и административных действий: Наличие
Мониторинг подключений и сессий: Наличие
Поддержка балансировки нагрузки: Наличие
Интеграция со службой каталогов: Наличие
Интеграция с гипервизорами: Наличие
Совместимость с ПК Брест: Наличие
Средства публикации приложений: Наличие
Поддержка USB, буфера обмена и печати в сессии: Наличие
API / средства автоматизации: Наличие
Отказоустойчивая схема развёртывания: Поддержка
Наличие в реестре Минцифры России: Да
Документация на русском языке: Да
Обновления и исправления безопасности: Наличие
Способ поставки: Электронная
Количество лицензий: По количеству пользователей / сессий
"""

    return ""


def _get_astra_fast_specs(goods_type: str = "", query: str = "") -> list[dict]:
    text = _get_astra_fast_spec_text(goods_type, query)
    if not text.strip():
        return []
    return _extract_spec_pairs(text, max_items=60)


def _should_prefer_query_baseline(goods_type: str = "") -> bool:
    return goods_type in _CABLE_TYPES or goods_type in _CONNECTOR_TYPES or goods_type in _TOOL_TYPES


def _enrich_with_baseline(specs: list[dict], goods_type: str = "", query: str = "") -> list[dict]:
    baseline = _get_baseline_specs(goods_type, query)
    if not baseline:
        return _dedupe_specs(specs)
    if not specs:
        return baseline
    if _looks_like_specific_model_query(query):
        return _dedupe_specs(specs)
    if _should_prefer_query_baseline(goods_type):
        return _merge_specs(baseline, specs)
    if len(specs) < 8:
        return _merge_specs(specs, baseline)
    return _dedupe_specs(specs)


def _build_readable_proxy_candidates(url: str) -> list[str]:
    value = str(url or "").strip()
    if not re.match(r"^https?://", value, flags=re.I):
        return []
    without_scheme = re.sub(r"^https?://", "", value, flags=re.I)
    return [
        f"https://r.jina.ai/http://{without_scheme}",
        f"https://r.jina.ai/https://{without_scheme}",
    ]


def _fetch_readable_page(url: str, timeout: int = 10) -> str:
    for proxy_url in _build_readable_proxy_candidates(url):
        proxied = _fetch_url(proxy_url, timeout=timeout)
        if proxied and len(proxied) >= 160:
            return proxied[:22000]
    direct = _fetch_url(url, timeout=timeout)
    return _extract_text_from_html(direct, max_chars=18000) if direct else ""


def _extract_msi_model_family(query: str) -> tuple[str, str] | None:
    cleaned = re.sub(r"\bmsi\b", " ", str(query or ""), flags=re.I)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -_/")
    match = re.search(r"([A-Za-z0-9+./ ]+?)-([A-Za-z0-9]{3,})\b", cleaned)
    if not match:
        return None
    family = re.sub(r"\s+", " ", match.group(1)).strip(" -_/")
    suffix = match.group(2).strip()
    if len(family.split()) < 2:
        return None
    return family, suffix


def _split_repeated_label_values(line: str) -> tuple[str, list[str]] | None:
    normalized = re.sub(r"\s+", " ", str(line or "")).strip()
    if not normalized:
        return None
    repeated = re.match(r"^([A-Za-z0-9 .()\"/+:-]+?)\s*\1\s+", normalized)
    if not repeated:
        return None
    label = repeated.group(1).strip()
    parts = re.split(rf"{re.escape(label)}\s+", normalized)
    values = [part.strip(" :") for part in parts if part and part.strip(" :")]
    if not values:
        return None
    return label, values


def _parse_msi_spec_markdown(markdown: str, exact_model: str) -> list[dict]:
    lines = [re.sub(r"\s+", " ", line).strip() for line in str(markdown or "").splitlines()]
    rows: dict[str, list[str]] = {}
    for line in lines:
        parsed = _split_repeated_label_values(line)
        if not parsed:
            continue
        label, values = parsed
        if len(values) >= 2:
            rows[label] = values

    model_values = rows.get("MKT Spec", [])
    if not model_values:
        return []

    target = re.sub(r"\s+", " ", str(exact_model or "")).strip().upper()
    try:
        target_index = next(i for i, value in enumerate(model_values) if value.strip().upper() == target)
    except StopIteration:
        return []

    specs: list[dict] = []
    seen_names: set[str] = set()
    for label, values in rows.items():
        if label == "MKT Spec" or target_index >= len(values):
            continue
        value = re.sub(r"\s+", " ", values[target_index]).strip(" :")
        if not value or value == "-":
            continue
        friendly_name = _MSI_FIELD_NAME_MAP.get(label, label)
        if friendly_name in seen_names:
            continue
        specs.append({"name": friendly_name, "value": value, "unit": ""})
        seen_names.add(friendly_name)
    return _clean_specs_for_compliance(_dedupe_specs(specs))


def _resolve_msi_exact_model_specs(product: str, goods_type: str = "") -> list[dict]:
    if "msi" not in str(product or "").lower():
        return []

    family_info = _extract_msi_model_family(product)
    if not family_info:
        return []

    family, suffix = family_info
    exact_model = f"{family}-{suffix}"
    slug = re.sub(r"[^A-Za-z0-9]+", "-", family).strip("-")
    if not slug:
        return []

    categories = _MSI_CATEGORY_PATHS_BY_TYPE.get(goods_type, ["Business-Productivity-PC", "Business-Productivity-Laptop", "Monitor"])
    candidate_urls: list[str] = []
    for host in ("ru.msi.com", "www.msi.com"):
        for category in categories:
            candidate_urls.append(f"https://{host}/{category}/{slug}/Specification")

    for candidate_url in candidate_urls:
        readable = _fetch_readable_page(candidate_url, timeout=10)
        if not readable or exact_model.upper() not in readable.upper():
            continue
        specs = _parse_msi_spec_markdown(readable, exact_model)
        if _has_sufficient_exact_model_quality(specs):
            logger.info(f"[vendor] MSI exact model hit: {product!r} -> {candidate_url}")
            return specs
    return []


def _bing_rss_search(query: str, num: int = 5, timeout: int = 12) -> list[dict]:
    xml = _fetch_url(f"https://www.bing.com/search?format=rss&q={quote_plus(query)}", timeout=timeout)
    if not xml or "<rss" not in xml.lower():
        return []
    results: list[dict] = []
    for item in re.findall(r"<item>([\s\S]*?)</item>", xml, flags=re.I):
        if len(results) >= max(1, num):
            break
        title_match = re.search(r"<title>([\s\S]*?)</title>", item, flags=re.I)
        link_match = re.search(r"<link>([\s\S]*?)</link>", item, flags=re.I)
        desc_match = re.search(r"<description>([\s\S]*?)</description>", item, flags=re.I)
        link = _strip_tags(unescape(link_match.group(1))) if link_match else ""
        if not re.match(r"^https?://", link, flags=re.I):
            continue
        title = _strip_tags(unescape(title_match.group(1)))[:180] if title_match else ""
        snippet = _strip_tags(unescape(desc_match.group(1)))[:400] if desc_match else ""
        results.append({"title": title, "link": link[:500], "snippet": snippet})
    return results


def _resolve_ai_client() -> tuple[str, str, str] | tuple[None, None, None]:
    key = DEEPSEEK_API_KEY or GROQ_API_KEY
    if not key:
        logger.warning("No AI API key configured (DEEPSEEK_API_KEY / GROQ_API_KEY)")
        return None, None, None
    if DEEPSEEK_API_KEY:
        return "https://api.deepseek.com/chat/completions", "deepseek-chat", DEEPSEEK_API_KEY
    return "https://api.groq.com/openai/v1/chat/completions", "llama-3.3-70b-versatile", GROQ_API_KEY


def _ai_extract_specs(context_text: str, product: str, goods_type: str = "") -> list[dict]:
    """
    Ask AI to extract technical specs from text.
    Returns list of {name, value, unit} dicts.
    """
    url, model, api_key = _resolve_ai_client()
    if not url or not model or not api_key:
        return []

    is_software = goods_type in _SW_TYPES
    system_prompt = _build_extraction_prompt(product, goods_type, is_software)

    type_hint = _TYPE_SEARCH_HINTS.get(goods_type, "")
    exact_model = _looks_like_specific_model_query(product)
    type_context = f" (тип: {type_hint})" if type_hint else ""
    exact_model_block = (
        "\n\nВАЖНО: это запрос по конкретной модели. Извлекай только явно подтверждённые в тексте характеристики именно этой модели."
        "\nНе подставляй типовые параметры класса товара и не додумывай отсутствующие значения."
        "\nЕсли значение в тексте не подтверждено, просто не включай такую характеристику."
        if exact_model else ""
    )

    user_prompt = (
        f"Товар: {product}{type_context}\n\n"
        f"Текст для анализа (из реальных ТЗ и спецификаций):\n{context_text[:8000]}\n\n"
        f"Извлеки ВСЕ технические характеристики. Верни ТОЛЬКО JSON-массив.{exact_model_block}"
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


def _ai_generate_model_specs(product: str, goods_type: str = "") -> list[dict]:
    url, model, api_key = _resolve_ai_client()
    if not url or not model or not api_key:
        return []

    type_hint = _get_type_hint(goods_type)
    is_software = goods_type in _SW_TYPES
    minimum = 18 if is_software else 14
    system_prompt = (
        "Ты формируешь технические характеристики для конкретной модели товара в закупочном стиле."
        " Верни только JSON-массив объектов {name, value, unit} без markdown и без пояснений."
        " Указывай только характеристики самой модели или стандартной конфигурации производителя."
        " Не используй общие фразы вида 'по требованиям заказчика', 'по типу товара', 'и/или',"
        " 'в количестве, достаточном для эксплуатации'."
        " Не включай характеристики упаковки, маркировки, состояния товара, гарантийных условий,"
        " документов поставки и иных формальных закупочных требований."
    )
    user_prompt = (
        f"Модель: {product}\n"
        f"Тип товара: {type_hint or goods_type or 'товар'}\n\n"
        f"Нужно вернуть не менее {minimum} технических характеристик именно этой модели."
        "\nДля оборудования обязательно включи процессор/платформу, память, накопители, графику,"
        " интерфейсы, сеть, конструктив, питание, размеры и массу, если применимо."
        "\nДля ПО включи редакцию, архитектуры, модули, интеграции, безопасность, управление,"
        " лицензирование и совместимость."
        "\nНе указывай модель, бренд, артикул или производителя отдельными характеристиками."
        "\nЕсли точная характеристика модели неизвестна, не выдумывай её и просто пропусти."
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.0,
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
        with urlopen(req, timeout=min(AI_TIMEOUT, 18), context=_ssl_ctx) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        content = content.strip()
        if content.startswith("```"):
            lines = [line for line in content.split("\n") if not line.startswith("```")]
            content = "\n".join(lines).strip()
        specs = _parse_json_with_repair(content)
        if not isinstance(specs, list):
            return []
        final_specs = _clean_specs_for_compliance(_dedupe_specs(specs))
        return final_specs if _has_sufficient_exact_model_quality(final_specs) else []
    except Exception as e:
        logger.error(f"AI model-spec generation error: {e}")
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


# ── Post-processing: clean specs for 44-ФЗ compliance ────────────
_PROHIBITED_SPEC_NAMES_RE = re.compile(
    r"^(модель|model|артикул|арт\b|part\s*number|p/n|pn|sku|бренд|brand|производитель|manufacturer|торговая\s+марка)$",
    re.IGNORECASE,
)
_PLACEHOLDER_VALUE_RE = re.compile(
    r"^(не\s*указан[аоы]?|н/?[аду]|—|-|отсутствует|нет\s*данных|неизвестн[аоы]?|n/?a|unknown|-)$",
    re.IGNORECASE,
)


def _clean_specs_for_compliance(specs: list[dict]) -> list[dict]:
    """Remove specs that would trigger Anti-FAS compliance violations."""
    cleaned = []
    for s in specs:
        name = str(s.get("name", "")).strip()
        value = str(s.get("value", "")).strip()
        # Skip empty
        if not name or not value:
            continue
        # Skip placeholder values
        if _PLACEHOLDER_VALUE_RE.match(value):
            continue
        # Skip prohibited spec names (model, brand, article etc.)
        if _PROHIBITED_SPEC_NAMES_RE.match(name):
            continue
        cleaned.append(s)
    return cleaned


# ── Unified search — single DDG query per function ──────────────
# DuckDuckGo rate-limits after ~5 requests. Use ONE comprehensive query.

async def search_internet_specs(product: str, goods_type: str = "") -> list[dict]:
    """
    Search internet for product specs using Bing RSS results + readable pages + AI extraction.
    Falls back to deterministic type-aware baselines when search/AI is unavailable.
    Returns list of {name, value, unit} dicts.
    """
    product = _clean_search_query(product)
    cache_key = f"internet:{goods_type}:{product}"
    cached = _cache_get(cache_key)
    if cached is not None:
        logger.info(f"[internet] Cache hit: {product!r} ({len(cached)} specs)")
        return cached

    exact_model = _looks_like_specific_model_query(product)
    if exact_model:
        direct_vendor_specs = _resolve_msi_exact_model_specs(product, goods_type)
        if direct_vendor_specs:
            _cache_set(cache_key, direct_vendor_specs)
            return direct_vendor_specs

    fast_specs = _get_astra_fast_specs(goods_type, product)
    if fast_specs:
        logger.info(f"[internet] Fast catalog hit: {product!r} type={goods_type!r} ({len(fast_specs)} specs)")
        _cache_set(cache_key, fast_specs)
        return fast_specs

    baseline_specs = _get_baseline_specs(goods_type, product)
    search_query = _build_type_aware_query(product, goods_type)
    queries = _build_internet_queries(product, goods_type)

    logger.info(f"[internet] Search: {search_query!r}")
    loop = asyncio.get_event_loop()
    results_nested = await asyncio.gather(*[
        loop.run_in_executor(None, lambda q=q: _bing_rss_search(q, num=4 if exact_model else 6, timeout=6 if exact_model else 12))
        for q in queries
    ])
    raw_results = [item for bucket in results_nested for item in bucket]
    deduped_results: list[dict] = []
    seen_links: set[str] = set()
    for item in sorted(raw_results, key=lambda entry: _score_search_result(entry, search_query, goods_type), reverse=True):
        link = str(item.get("link", "")).strip()
        if not link or link in seen_links:
            continue
        if not _is_relevant_search_result(item, search_query, goods_type):
            continue
        seen_links.add(link)
        deduped_results.append(item)
        if len(deduped_results) >= (5 if exact_model else 8):
            break

    if not deduped_results:
        logger.warning(f"[internet] No relevant search results for: {search_query}")
        if exact_model:
            return []
        return baseline_specs

    logger.info(f"[internet] Search returned {len(deduped_results)} relevant results")

    # Collect context from snippets + top pages
    context_parts: list[str] = []
    for r in deduped_results[:8]:
        snippet = r.get("snippet", "")
        title = r.get("title", "")
        if snippet:
            context_parts.append(f"{title}: {snippet}")

    urls = [
        r["link"]
        for r in deduped_results[:3 if exact_model else 5]
        if r.get("link") and not any(domain in r["link"] for domain in _BLOCKED_RESULT_HOSTS)
    ][:2 if exact_model else 3]

    if urls:
        fetch_tasks = [loop.run_in_executor(None, lambda u=url: _fetch_readable_page(u, timeout=6 if exact_model else 10)) for url in urls]
        fetch_results = await asyncio.gather(*fetch_tasks, return_exceptions=True)
        for url, page_text in zip(urls, fetch_results):
            if isinstance(page_text, Exception) or not page_text:
                continue
            text = str(page_text)[:5000]
            if text and len(text) > 150:
                context_parts.append(f"[{url}]:\n{text}")

    if not context_parts:
        if exact_model:
            return []
        return baseline_specs

    full_context = "\n\n".join(context_parts)
    heuristic_specs = _merge_specs(
        _extract_table_like_pairs(full_context, max_items=40),
        _extract_spec_pairs(full_context, max_items=40),
    )
    if exact_model:
        final_specs = _clean_specs_for_compliance(_dedupe_specs(heuristic_specs))
        if not _has_sufficient_exact_model_quality(final_specs):
            logger.warning(f"[internet] Exact model result stayed generic for {product!r}")
            return []
    else:
        specs = await loop.run_in_executor(None, lambda: _ai_extract_specs(full_context, product, goods_type))
        merged_specs = _merge_specs(specs, heuristic_specs)
        final_specs = _clean_specs_for_compliance(_enrich_with_baseline(merged_specs, goods_type, product))
    logger.info(f"[internet] Final {len(final_specs)} specs for {product!r}")
    if final_specs:
        _cache_set(cache_key, final_specs)
    return final_specs


async def search_eis_specs(query: str, goods_type: str = "") -> list[dict]:
    """
    Search for ready-made procurement specs on EIS / Rostender / zakupki.mos
    plus registry/industry context from Minpromtorg / GISP via Bing RSS site queries.
    Falls back to general internet search if procurement-specific search fails.
    Returns list of {name, value, unit} dicts.
    """
    query = _clean_search_query(query)
    cache_key = f"eis:{goods_type}:{query}"
    cached = _cache_get(cache_key)
    if cached is not None:
        logger.info(f"[eis] Cache hit: {query!r} ({len(cached)} specs)")
        return cached

    fast_specs = _get_astra_fast_specs(goods_type, query)
    if fast_specs:
        logger.info(f"[eis] Fast catalog hit: {query!r} type={goods_type!r} ({len(fast_specs)} specs)")
        _cache_set(cache_key, fast_specs)
        return fast_specs

    base = str(query or "").strip()
    search_query = _build_type_aware_query(base, goods_type)
    exact_model = _looks_like_specific_model_query(base)
    site_queries = _build_procurement_queries(base, goods_type)

    logger.info(f"[eis] Search: {search_query!r}")
    loop = asyncio.get_event_loop()
    search_sets = await asyncio.gather(*[
        loop.run_in_executor(None, lambda q=q: _bing_rss_search(q, num=4 if exact_model else 5, timeout=6 if exact_model else 12))
        for q in site_queries
    ])
    raw_results = [item for bucket in search_sets for item in bucket]
    procurement_results: list[dict] = []
    seen_links: set[str] = set()
    for item in sorted(raw_results, key=lambda entry: _score_search_result(entry, search_query, goods_type), reverse=True):
        link = str(item.get("link", "")).strip()
        if not link or link in seen_links:
            continue
        if not _is_relevant_search_result(item, search_query, goods_type, procurement_only=True):
            continue
        seen_links.add(link)
        procurement_results.append(item)
        if len(procurement_results) >= (5 if exact_model else 8):
            break

    logger.info(f"[eis] Procurement search returned {len(procurement_results)} relevant results for {base!r}")

    context_parts: list[str] = []
    for r in procurement_results[:8]:
        snippet = r.get("snippet", "")
        title = r.get("title", "")
        if snippet:
            context_parts.append(f"{title}: {snippet}")

    urls = [
        r["link"]
        for r in procurement_results[:3 if exact_model else 5]
        if r.get("link") and not any(host in r["link"] for host in _BLOCKED_RESULT_HOSTS)
    ][:2 if exact_model else 3]
    if urls:
        fetch_tasks = [loop.run_in_executor(None, lambda u=url: _fetch_readable_page(u, timeout=6 if exact_model else 10)) for url in urls]
        fetch_results = await asyncio.gather(*fetch_tasks, return_exceptions=True)
        for url, page_text in zip(urls, fetch_results):
            if isinstance(page_text, Exception) or not page_text:
                continue
            text = str(page_text)[:5000]
            if text and len(text) > 150:
                context_parts.append(f"[{url}]:\n{text}")

    # Fallback to general internet search
    if not context_parts:
        logger.info(f"[eis] No procurement results, falling back to internet search")
        specs = await search_internet_specs(query, goods_type)
        if specs:
            _cache_set(cache_key, specs)
        return specs

    full_context = "\n".join(context_parts)
    heuristic_specs = _merge_specs(
        _extract_table_like_pairs(full_context, max_items=40),
        _extract_spec_pairs(full_context, max_items=40),
    )
    if exact_model:
        final_specs = _clean_specs_for_compliance(_dedupe_specs(heuristic_specs))
        if not _has_sufficient_exact_model_quality(final_specs):
            final_specs = await search_internet_specs(query, goods_type)
        if not _has_sufficient_exact_model_quality(final_specs):
            logger.warning(f"[eis] Exact model result stayed generic for {query!r}")
            return []
    else:
        specs = await loop.run_in_executor(None, lambda: _ai_extract_specs(full_context, query, goods_type))
        merged_specs = _merge_specs(specs, heuristic_specs)
        final_specs = _clean_specs_for_compliance(_enrich_with_baseline(merged_specs, goods_type, query))
    logger.info(f"[eis] Final {len(final_specs)} specs for {query!r}")

    if final_specs:
        _cache_set(cache_key, final_specs)
    return final_specs
