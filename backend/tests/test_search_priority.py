from pathlib import Path
from search import (
    _build_internet_queries,
    _build_procurement_queries,
    _enrich_with_baseline,
    _extract_msi_model_family,
    _get_astra_fast_specs,
    _has_sufficient_exact_model_quality,
    _looks_like_specific_model_query,
    _parse_msi_spec_markdown,
)


SEARCH_PY = Path(__file__).resolve().parents[1] / "search.py"


def test_procurement_source_priority_domains_are_present():
    source = SEARCH_PY.read_text(encoding="utf-8")
    assert "zakupki.gov.ru" in source
    assert "rostender.info" in source
    assert "zakupki.mos.ru" in source
    assert "minpromtorg.gov.ru" in source
    assert "gisp.gov.ru" in source


def test_procurement_query_set_includes_registry_sources():
    source = SEARCH_PY.read_text(encoding="utf-8")
    assert 'site:gisp.gov.ru {type_hint} характеристики' in source
    assert 'site:minpromtorg.gov.ru {search_query} технические характеристики' in source
    assert 'site:minpromtorg.gov.ru {search_query} реестр российской промышленной продукции' in source


def test_search_scoring_prefers_procurement_and_registry_sources():
    source = SEARCH_PY.read_text(encoding="utf-8")
    assert "_PREFERRED_SOURCE_WEIGHTS" in source
    assert '"zakupki.gov.ru": 45' in source
    assert '"rostender.info": 32' in source
    assert '"gisp.gov.ru": 26' in source


def test_astra_fast_specs_cover_core_stack():
    assert len(_get_astra_fast_specs("ldap", "ald pro")) >= 20
    assert len(_get_astra_fast_specs("os", "astra linux special edition")) >= 30
    assert len(_get_astra_fast_specs("email", "rupost")) >= 25
    assert len(_get_astra_fast_specs("backup_sw", "rubackup")) >= 25
    assert len(_get_astra_fast_specs("virt", "брест")) >= 25
    assert len(_get_astra_fast_specs("vdi", "termidesk")) >= 25


def test_specific_model_detection_matches_frontend_expectations():
    assert _looks_like_specific_model_query("MSI PRO DP21 14M-1069XRU") is True
    assert _looks_like_specific_model_query("Dell OptiPlex 7010") is True
    assert _looks_like_specific_model_query("Гравитон Н15") is True
    assert _looks_like_specific_model_query("системный блок") is False
    assert _looks_like_specific_model_query("Системный блок, 16 ГБ ОЗУ, SSD 512 ГБ") is False


def test_specific_model_queries_prioritize_exact_match_and_vendor_pages():
    queries = _build_internet_queries("MSI PRO DP21 14M-1069XRU", "pc")
    assert queries[0] == '"MSI PRO DP21 14M-1069XRU" технические характеристики'
    assert any("site:msi.com" in query for query in queries)
    assert any("datasheet" in query for query in queries)


def test_specific_model_procurement_queries_start_from_exact_model():
    queries = _build_procurement_queries("MSI PRO DP21 14M-1069XRU", "pc")
    assert queries[0] == 'site:zakupki.gov.ru "MSI PRO DP21 14M-1069XRU" техническое задание'
    assert any('site:gisp.gov.ru "MSI PRO DP21 14M-1069XRU" характеристики' == query for query in queries)


def test_baseline_is_not_merged_into_exact_model_specs():
    source_specs = [{"name": "Объем оперативной памяти", "value": "16", "unit": "ГБ"}]
    result = _enrich_with_baseline(source_specs, "pc", "MSI PRO DP21 14M-1069XRU")
    assert result == source_specs


def test_exact_model_quality_rejects_generic_procurement_baseline():
    generic_specs = [
        {"name": "Процессор", "value": "Количество вычислительных ядер не менее 4; архитектура и частотные параметры по требованиям Заказчика", "unit": ""},
        {"name": "Оперативная память", "value": "не менее 8 ГБ", "unit": "ГБ"},
        {"name": "Тип и объем накопителя", "value": "SSD и/или HDD; суммарный объем не менее 256 ГБ", "unit": ""},
        {"name": "Графическая подсистема", "value": "Интегрированный и/или дискретный графический адаптер по типу товара", "unit": ""},
        {"name": "Сетевые интерфейсы", "value": "Ethernet 1 Гбит/с и/или беспроводные интерфейсы по требованиям Заказчика", "unit": ""},
        {"name": "Порты подключения", "value": "USB, видеоинтерфейсы и аудиоразъемы в количестве, достаточном для эксплуатации", "unit": ""},
        {"name": "Состояние товара", "value": "новый, не бывший в эксплуатации", "unit": ""},
        {"name": "Документация на русском языке", "value": "наличие паспорта и руководства пользователя", "unit": ""},
        {"name": "Маркировка и идентификация", "value": "наличие заводской маркировки", "unit": ""},
        {"name": "Упаковка", "value": "заводская упаковка", "unit": ""},
    ]
    assert _has_sufficient_exact_model_quality(generic_specs) is False


def test_exact_model_quality_accepts_precise_household_specs():
    household_specs = [
        {"name": "Количество слоев", "value": "3 слоя", "unit": ""},
        {"name": "Количество рулонов в упаковке", "value": "8 рулонов", "unit": "рулон"},
        {"name": "Длина намотки рулона", "value": "не менее 18 м", "unit": "м"},
        {"name": "Количество листов в рулоне", "value": "не менее 150 листов", "unit": "лист"},
        {"name": "Состав", "value": "100% первичная целлюлоза", "unit": ""},
        {"name": "Цвет", "value": "белый", "unit": ""},
        {"name": "Тиснение", "value": "тиснение и перфорация", "unit": ""},
    ]
    assert _has_sufficient_exact_model_quality(household_specs) is True


def test_exact_model_quality_accepts_precise_battery_specs():
    battery_specs = [
        {"name": "Тип элемента питания", "value": "щелочная батарейка", "unit": ""},
        {"name": "Типоразмер", "value": "AA / LR6", "unit": ""},
        {"name": "Напряжение", "value": "1.5 В", "unit": "В"},
        {"name": "Ёмкость", "value": "не менее 2850 мАч", "unit": "мАч"},
        {"name": "Количество в упаковке", "value": "4 шт.", "unit": "шт"},
        {"name": "Срок хранения", "value": "до 10 лет", "unit": "лет"},
        {"name": "Химическая система", "value": "алкалиновая", "unit": ""},
    ]
    assert _has_sufficient_exact_model_quality(battery_specs) is True


def test_extract_msi_model_family_parses_exact_sku():
    assert _extract_msi_model_family("MSI PRO DP21 14M-1069XRU") == ("PRO DP21 14M", "1069XRU")


def test_parse_msi_spec_markdown_extracts_exact_column():
    markdown = """
MKT Spec MKT Spec PRO DP21 14M-1055XRU MKT Spec PRO DP21 14M-1069XRU MKT Spec PRO DP21 14M-1071XRU
Chipsets Chipsets H610 Chipsets H610 Chipsets H610
Memory Size Memory Size 8GB(8GB*1) Memory Size 16GB(8GB*2) Memory Size 8GB(8GB*1)
Memory Type Memory Type DDR5 SDRAM Memory Type DDR5 SDRAM Memory Type DDR5 SDRAM
CPU Number CPU Number Intel Core i5 Processor 14400 CPU Number Intel Core i7 Processor 14700 CPU Number Intel Core i3 Processor 14100
CPU Cores CPU Cores 10 CPU Cores 20 CPU Cores 4
Threads Threads 16 Threads 28 Threads 8
SSD Size SSD Size 512GB SSD Size 512GB SSD Size 512GB
WLAN Version WLAN Version Wi-Fi 6E+BT WLAN Version Wi-Fi 6E+BT WLAN Version -
RJ45 RJ45 1 RJ45 1 RJ45 1
HDMI out HDMI out 1x (v2.1) HDMI out 1x (v2.1) HDMI out 1x (v2.1)
DP out DP out 1x (v1.4) DP out 1x (v1.4) DP out 1x (v1.4)
Weight (Net kg)Weight (Net kg) 1.27 Weight (Net kg) 1.27 Weight (Net kg) 1.27
Product Dimension (WxDxH) (mm)Product Dimension (WxDxH) (mm) 204 x 208 x 54.8 Product Dimension (WxDxH) (mm) 204 x 208 x 54.8 Product Dimension (WxDxH) (mm) 204 x 208 x 54.8
"""
    specs = _parse_msi_spec_markdown(markdown, "PRO DP21 14M-1069XRU")
    by_name = {item["name"]: item["value"] for item in specs}
    assert by_name["Процессор"] == "Intel Core i7 Processor 14700"
    assert by_name["Объем оперативной памяти"] == "16GB(8GB*2)"
    assert by_name["Количество ядер процессора"] == "20"
    assert by_name["Количество потоков процессора"] == "28"
    assert by_name["Беспроводные интерфейсы"] == "Wi-Fi 6E+BT"
