from pathlib import Path
from search import _get_astra_fast_specs


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
