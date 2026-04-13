import httpx
import re
from typing import Optional

FAS_API = "https://br.fas.gov.ru/api/decisions"

RISK_DESCRIPTIONS: dict[str, dict] = {
    "brand_restriction": {
        "label": "Ограничение конкуренции (бренд)",
        "color": "red",
        "advice": "Проверьте все упоминания брендов — добавьте 'или эквивалент'",
    },
    "excessive_requirements": {
        "label": "Избыточные требования",
        "color": "orange",
        "advice": "Проверьте что характеристики не ограничивают круг поставщиков",
    },
    "nmck_justification": {
        "label": "Обоснование цены",
        "color": "yellow",
        "advice": "Убедитесь что НМЦК обоснована 3+ коммерческими предложениями",
    },
    "other": {
        "label": "Иное нарушение",
        "color": "gray",
        "advice": "Изучите решение подробнее",
    },
}

KNOWN_BRANDS = [
    "intel", "amd", "samsung", "hp", "dell", "lenovo", "apple", "cisco",
    "microsoft", "asus", "acer", "msi", "gigabyte", "corsair", "kingston",
    "seagate", "western digital", "wd", "toshiba", "fujitsu", "huawei",
]


async def search_fas_decisions(keywords: list[str], okpd2: Optional[str] = None) -> list[dict]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        query = " ".join(keywords[:3])
        try:
            resp = await client.get(
                FAS_API,
                params={
                    "query":    query,
                    "type":     "COMPLAINT",
                    "result":   "UPHELD",
                    "dateFrom": "2023-01-01",
                    "limit":    5,
                },
            )
            if resp.status_code != 200:
                return []
            data = resp.json()
            decisions = data.get("items", data.get("data", []))
            return [
                {
                    "case_number": d.get("caseNumber", ""),
                    "date":        d.get("date", ""),
                    "violation":   d.get("violation", d.get("subject", "")),
                    "url":         f"https://br.fas.gov.ru/cases/{d.get('id', '')}",
                    "risk_type":   classify_risk(d),
                }
                for d in decisions[:5]
            ]
        except Exception:
            return []


def classify_risk(decision: dict) -> str:
    text = (decision.get("violation", "") + decision.get("subject", "")).lower()
    if any(w in text for w in ["бренд", "товарный знак", "конкретн", "единственн"]):
        return "brand_restriction"
    if any(w in text for w in ["характеристик", "избыточн", "завышен"]):
        return "excessive_requirements"
    if any(w in text for w in ["нмцк", "цена", "обоснован"]):
        return "nmck_justification"
    return "other"


def analyze_local_risks(characteristics: list, name: str) -> list:
    risks = []
    char_text = " ".join(
        f"{c.get('name', '')} {c.get('value', '')}"
        for c in characteristics
    ).lower()
    name_lower = name.lower()

    for brand in KNOWN_BRANDS:
        if brand in char_text or brand in name_lower:
            pattern = re.search(
                rf'\b{re.escape(brand)}\b.{{0,80}}(или эквивалент|или аналог|или выше|или более)',
                char_text,
                re.IGNORECASE,
            )
            if not pattern:
                risks.append({
                    "type": "brand_restriction",
                    "description": f"Бренд '{brand}' без 'или эквивалент'",
                    **RISK_DESCRIPTIONS["brand_restriction"],
                })

    office_keywords = ["офис", "рабочее место", "бухгалтер", "канцелярия"]
    is_office = any(kw in name_lower for kw in office_keywords)
    if is_office:
        ram_match = re.search(r'оперативн\w+.*?(\d+)\s*гб', char_text)
        if ram_match and int(ram_match.group(1)) > 32:
            risks.append({
                "type": "excessive_requirements",
                "description": f"RAM {ram_match.group(1)} ГБ для офисного ПК — риск жалобы ФАС",
                **RISK_DESCRIPTIONS["excessive_requirements"],
            })

    if any(kw in name_lower for kw in ["антивирус", "antivirus"]):
        if "реестр" not in char_text and "минцифры" not in char_text and "1236" not in char_text:
            risks.append({
                "type": "other",
                "description": "ПО не проверено на включение в реестр отечественного ПО (ПП №1236)",
                **RISK_DESCRIPTIONS["other"],
            })

    return risks


def get_risk_level(decisions: list, local_risks: list) -> str:
    if len(decisions) >= 3 or len(local_risks) >= 2:
        return "HIGH"
    if len(decisions) >= 1 or len(local_risks) >= 1:
        return "MEDIUM"
    return "LOW"
