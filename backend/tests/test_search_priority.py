from pathlib import Path
from search import (
    _build_internet_queries,
    _build_procurement_queries,
    _enrich_with_baseline,
    _get_astra_fast_specs,
    _looks_like_specific_model_query,
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
