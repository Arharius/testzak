import httpx
from typing import Optional

EIS_OPEN_DATA = "https://opendata.zakupki.gov.ru/api/contracts"

PRICE_BENCHMARKS: dict[str, dict] = {
    "26.20.15": {"min": 25_000,  "median": 45_000,  "max": 90_000,  "name": "Системный блок"},
    "26.20.17": {"min": 8_000,   "median": 15_000,  "max": 35_000,  "name": "Монитор"},
    "26.80.13": {"min": 1_500,   "median": 2_500,   "max": 5_000,   "name": "DVD-привод внешний"},
    "26.20.22": {"min": 40_000,  "median": 75_000,  "max": 150_000, "name": "Ноутбук"},
    "28.23.13": {"min": 15_000,  "median": 30_000,  "max": 60_000,  "name": "МФУ"},
    "27.20.26": {"min": 3_000,   "median": 6_000,   "max": 15_000,  "name": "ИБП"},
    "26.20.16": {"min": 80_000,  "median": 180_000, "max": 500_000, "name": "Сервер"},
    "26.20.40": {"min": 8_000,   "median": 20_000,  "max": 60_000,  "name": "Коммутатор"},
    "26.30.11": {"min": 2_000,   "median": 4_500,   "max": 12_000,  "name": "IP-телефон"},
    "58.29.29": {"min": 3_000,   "median": 8_000,   "max": 25_000,  "name": "Программное обеспечение"},
    "26.20.18": {"min": 800,     "median": 1_500,   "max": 4_000,   "name": "Клавиатура/мышь"},
}


async def search_similar_contracts(okpd2: str, keyword: str, quantity: int = 1) -> list[dict]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(
                EIS_OPEN_DATA,
                params={
                    "okpd2":   okpd2[:8],
                    "keyword": keyword,
                    "status":  "EC",
                    "page":    1,
                    "limit":   10,
                },
            )
            if resp.status_code != 200:
                return []
            data = resp.json()
            contracts = data.get("data", [])
            return [
                {
                    "price":      c.get("price", 0),
                    "quantity":   c.get("quantity", 1),
                    "unit_price": c.get("price", 0) / max(c.get("quantity", 1), 1),
                    "date":       c.get("signDate", ""),
                    "region":     c.get("region", ""),
                    "supplier":   c.get("supplierName", ""),
                }
                for c in contracts
                if c.get("price", 0) > 0
            ]
        except Exception:
            return []


def calculate_nmck_by_market(unit_prices: list[float], quantity: int) -> dict:
    if len(unit_prices) < 3:
        return {
            "method": "insufficient_data",
            "error": "Недостаточно данных (нужно ≥3 цены)",
            "nmck": None,
        }
    prices = sorted(unit_prices)
    median = prices[len(prices) // 2]
    filtered = [p for p in prices if 0.67 * median <= p <= 1.33 * median]
    if len(filtered) < 3:
        filtered = prices[:5]
    avg_unit = sum(filtered) / len(filtered)
    nmck = avg_unit * quantity
    return {
        "method": "market_prices",
        "unit_prices_used": filtered,
        "avg_unit_price": round(avg_unit, 2),
        "quantity": quantity,
        "nmck": round(nmck, 2),
        "nmck_with_vat": round(nmck * 1.20, 2),
        "sources_count": len(filtered),
        "legal_basis": "ч.1 ст.22 44-ФЗ — метод сопоставимых рыночных цен",
    }


def get_benchmark(okpd2: str, quantity: int) -> Optional[dict]:
    key = okpd2[:8]
    bench = PRICE_BENCHMARKS.get(key)
    if not bench:
        return None
    return {
        "method": "benchmark",
        "name": bench["name"],
        "unit_price_median": bench["median"],
        "nmck": bench["median"] * quantity,
        "nmck_with_vat": round(bench["median"] * quantity * 1.20, 2),
        "nmck_range": {
            "min": bench["min"] * quantity,
            "max": bench["max"] * quantity,
        },
        "warning": "Ориентировочные данные 2024-2025 — уточните 3 КП",
        "legal_basis": "ч.1 ст.22 44-ФЗ (требует актуализации КП)",
    }
