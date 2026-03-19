from pathlib import Path
from search import (
    _build_internet_queries,
    _build_procurement_queries,
    _build_exact_model_ai_aliases,
    _build_asus_official_queries,
    _clean_specs_for_compliance,
    _enrich_with_baseline,
    _extract_asus_model_code,
    _extract_asus_support_code,
    _extract_msi_model_family,
    _extract_msi_search_family_query,
    _extract_msi_search_spec_url,
    _get_astra_fast_specs,
    _get_baseline_specs,
    _has_sufficient_exact_model_quality,
    _looks_like_specific_model_query,
    _parse_asus_techspec_markdown,
    _parse_msi_family_spec_markdown,
    _parse_msi_spec_markdown,
    _resolve_asus_exact_model_specs,
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
    assert _looks_like_specific_model_query("asus 1503") is False
    assert _looks_like_specific_model_query("Asus Vivobook X1503") is True
    assert _looks_like_specific_model_query("ASUS X1503ZA") is True
    assert _looks_like_specific_model_query("HP 250") is True
    assert _looks_like_specific_model_query("Монитор серии 07 RDW") is False
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


def test_cable_tester_phone_generator_baseline_keeps_tone_generator_context():
    specs = _get_baseline_specs("cableTester", "тестер кабельный телефонный с генератором")
    by_name = {item["name"]: item["value"] for item in specs}
    assert "Телефонный" in by_name["Тестируемые типы кабелей"]
    assert "генерац" in by_name["Функции тестирования"].lower()
    assert "щуп" in by_name["Удаленный модуль"].lower() or "щуп" in by_name["Комплектность"].lower()


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


def test_extract_asus_model_code_parses_vivobook_series():
    assert _extract_asus_model_code("Asus Vivobook X1503") == "X1503"
    assert _extract_asus_model_code("ASUS X1503ZA") == "X1503ZA"


def test_extract_asus_support_code_reads_supportonly_link():
    markdown = """
Support

[X1503ZA](https://www.asus.com/supportonly/X1503ZA/HelpDesk/)
"""
    assert _extract_asus_support_code(markdown) == "X1503ZA"


def test_build_exact_model_ai_aliases_enriches_asus_support_code():
    original_fetch = __import__("search")._fetch_asus_support_code
    __import__("search")._fetch_asus_support_code = lambda product: "X1503ZA"
    try:
        aliases = _build_exact_model_ai_aliases("Asus vivobook x1503", "laptop")
    finally:
        __import__("search")._fetch_asus_support_code = original_fetch
    assert "ASUS X1503ZA" in aliases
    assert "ASUS Vivobook X1503ZA" in aliases


def test_build_asus_official_queries_include_support_code_and_techspec_terms():
    queries = _build_asus_official_queries("Asus Vivobook X1503", support_code="X1503ZA", search_key="X1503")
    assert 'site:asus.com "X1503ZA" techspec' in queries
    assert 'site:asus.com "X1503" "vivobook"' in queries


def test_parse_asus_techspec_markdown_extracts_concrete_specs():
    markdown = """
# ASUS Vivobook 15X OLED (X1503, 12a Gen Intel)

X1503ZA

Modelo

X1503ZA

Sistema Operativo

Windows 11 Home - ASUS recomienda Windows 11 Pro para empresas

Procesador

Intel® Core™ i5-12500H 2.5 GHz (18M Caché, hasta 4.5 GHz, 4P+8E núcleos)

Gráficos

Gráficos Intel®

Pantalla

15,6", FHD (1920 x 1080) OLED 16:9, tasa de refresco 60Hz, 600nits

Memoria

8GB DDR4 on board
8GB DDR4 SO-DIMM

Almacenamiento

512 GB SSD M.2 NVMe™ PCIe® 3.0

Ranuras de expansión

- 1x M.2 2280 PCIe 4.0x4
Ranura 1x DDR4 SO-DIMM

Puertos E/S

2x USB 3.2 Gen 1 Tipo-A
1x USB 3.2 Gen 1 Tipo C
1x USB 2.0 Tipo-A, 1x DC-in
1x 3.5mm Conector de audio combinado

Teclado y touchpad

Teclado tipo chiclet, Precision Touchpad

Cámara

Cámara HD 720p, Con persiana de privacidad

Audio

Built-in array microphone
Built-in speaker
SonicMaster

Redes y comunicación

Wi-Fi 6(802.11ax)+Bluetooth 5.0 (Dual band) 2*2

Batería

70WHrs, 3S1P, 3-cell Li-ion

Alimentación

adaptador 90 W CA; Salida: 19 V CC, 4,74 A, 90 W

Peso

1.70 kg (3.75 lbs)

Dimensiones

35.68 x 22.76 x 1.99 cm (14.05" x 8.96" x 0.78")

Need Help?
"""
    specs = _parse_asus_techspec_markdown(markdown)
    by_name = {item["name"]: item["value"] for item in specs}
    assert by_name["Процессор"].startswith("Intel® Core™ i5-12500H")
    assert by_name["Оперативная память"] == "8GB DDR4 on board; 8GB DDR4 SO-DIMM"
    assert by_name["Накопитель"] == "512 GB SSD M.2 NVMe™ PCIe® 3.0"
    assert "USB 3.2 Gen 1 Tipo-A" in by_name["Порты"]
    assert by_name["Масса"] == "1.70 kg"
    assert by_name["Габариты"] == "35.68 x 22.76 x 1.99 cm"
    assert _has_sufficient_exact_model_quality(specs) is True


def test_resolve_asus_exact_model_specs_uses_official_techspec_before_ai():
    search_module = __import__("search")
    original_bing = search_module._bing_rss_search
    original_fetch = search_module._fetch_readable_page
    original_support = search_module._fetch_asus_support_code
    original_ai = search_module._ai_generate_model_specs
    try:
        search_module._fetch_asus_support_code = lambda product: "X1503ZA"
        search_module._bing_rss_search = lambda query, num=4, timeout=6: [
            {
                "title": "ASUS Vivobook 15X OLED | Especificaciones",
                "link": "https://www.asus.com/co/laptops/for-home/vivobook/vivobook-15x-oled-x1503-12th-gen-intel/techspec/",
                "snippet": "X1503ZA techspec",
            }
        ]
        search_module._fetch_readable_page = lambda url, timeout=10: """
Procesador
Intel® Core™ i5-12500H 2.5 GHz (18M Caché, hasta 4.5 GHz, 4P+8E núcleos)
Pantalla
15,6\", FHD (1920 x 1080) OLED 16:9, 60Hz, 600nits
Memoria
8GB DDR4 on board
8GB DDR4 SO-DIMM
Almacenamiento
512 GB SSD M.2 NVMe™ PCIe® 3.0
Puertos E/S
2x USB 3.2 Gen 1 Tipo-A
1x USB 3.2 Gen 1 Tipo C
1x USB 2.0 Tipo-A, 1x DC-in
Redes y comunicación
Wi-Fi 6(802.11ax)+Bluetooth 5.0 (Dual band) 2*2
Batería
70WHrs, 3S1P, 3-cell Li-ion
Alimentación
adaptador 90 W CA; Salida: 19 V CC, 4,74 A, 90 W
Peso
1.70 kg (3.75 lbs)
Dimensiones
35.68 x 22.76 x 1.99 cm (14.05\" x 8.96\" x 0.78\")
Need Help?
"""
        search_module._ai_generate_model_specs = lambda product, goods_type="": []
        specs = _resolve_asus_exact_model_specs("Asus Vivobook X1503", "laptop")
    finally:
        search_module._bing_rss_search = original_bing
        search_module._fetch_readable_page = original_fetch
        search_module._fetch_asus_support_code = original_support
        search_module._ai_generate_model_specs = original_ai
    by_name = {item["name"]: item["value"] for item in specs}
    assert by_name["Процессор"].startswith("Intel® Core™ i5-12500H")
    assert "Wi-Fi 6" in by_name["Сетевые интерфейсы"]


def test_extract_msi_search_family_query_supports_family_only_input():
    assert _extract_msi_search_family_query("Мини ПК MSI PRO DP21") == "PRO DP21"
    assert _extract_msi_search_family_query("MSI PRO DP21 14M-1069XRU") == "PRO DP21 14M"


def test_extract_msi_search_spec_url_prefers_matching_category():
    markdown = """
Search Results for PRO DP21
[Specifications](http://www.msi.com/Monitor/PRO-MP275Q/Specification)
[Specifications](http://www.msi.com/Business-Productivity-PC/PRO-DP21-14MX/Specification)
"""
    assert _extract_msi_search_spec_url(markdown, "pc") == "https://www.msi.com/Business-Productivity-PC/PRO-DP21-14MX/Specification"


def test_parse_msi_spec_markdown_extracts_exact_column():
    markdown = """
MKT Spec MKT Spec PRO DP21 14M-1055XRU MKT Spec PRO DP21 14M-1069XRU MKT Spec PRO DP21 14M-1071XRU
Part No Part No 9S6-B0A431-1055 Part No 9S6-B0A431-1069 Part No 9S6-B0A431-1071
Color Color ID1/Black-Black-Black Color ID1/Black-Black-Black Color ID1/Black-Black-Black
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
Inside Carton Dimension (WxDxH) (inch)Inside Carton Dimension (WxDxH) (inch) 0.32 x 0.32 x 0.09 Inside Carton Dimension (WxDxH) (inch) 0.32 x 0.32 x 0.09 Inside Carton Dimension (WxDxH) (inch) 0.32 x 0.32 x 0.09
"""
    specs = _parse_msi_spec_markdown(markdown, "PRO DP21 14M-1069XRU")
    by_name = {item["name"]: item["value"] for item in specs}
    assert by_name["Процессор"] == "Intel Core i7 Processor 14700"
    assert by_name["Объем оперативной памяти"] == "16GB(8GB*2)"
    assert by_name["Количество ядер процессора"] == "20"
    assert by_name["Количество потоков процессора"] == "28"
    assert by_name["Беспроводные интерфейсы"] == "Wi-Fi 6E+BT"
    assert _has_sufficient_exact_model_quality(specs) is True
    assert "Part No" not in by_name
    assert "Color" not in by_name
    assert "Inside Carton Dimension (WxDxH) (inch)" not in by_name


def test_parse_msi_family_spec_markdown_extracts_search_page_family_specs():
    markdown = """
### PRO DP21 14M

*    Operating System
*    CPU
*    Chipset
*    Graphics
*    Storage
*    System Memory
*    I/O (Front)
*    I/O (Rear)
*    Wireless LAN
*    Bluetooth
*    AUDIO
*    LAN
*    Cooling System
*    KEYBOARD / MOUSE
*    AC Adapter / PSU
*    Dimension (WxDxH)
*    WEIGHT (N.W./ G.W.)
*    VESA Mount
*    Volume
*    Accessories
*    Certificates

Windows 11 Home
Windows 11 Pro - MSI recommends Windows 11 Pro for business
Intel® Core™ i7 processor 14700
Intel® Core™ i5 processor 14400
Intel® Core™ i3 processor 14100
Intel® Pentium® Gold G7400
Intel® H610
Intel® UHD Graphics 770
1x M.2 SSD (NVMe PCIe/SATA auto switch)
2x 2.5” HDD / SSD
2x DDR5 up to 5600MHz SO-DIMMs, up to 64GB
1x USB 5Gbps Type-C
1x USB 5Gbps Type-A
2x USB 2.0 Type-A
1x Mic-in
1x Headphone-out
1x USB 10Gbps Type-C
1x USB 10Gbps Type-A
2x USB 2.0
1x RJ45
1x HDMI™ out (supports 4K @60Hz as specified in HDMI™ 2.1)
1x DisplayPort (1.4)
1x COM port
1x Mic-in
1x Line-out
1x Kensington Lock
Intel Wireless AX211 (WiFi 6E)
Realtek Wireless AW-CB515NF (WiFi 5)
5.3 (for AX211) / 4.1 (for AW-CB515NF)
Realtek® ALC897
Intel® I219V
Fan Cooler
Optional
120W
204 x 208 x 54.8 mm (8.03 x 8.19 x 2.16 inch)
1.52 kg (3.35 lbs) / 3.05 kg (6.72 lbs)
Support 100 x 100 mm
2.3 Liter / 4.86pt
1x Quick Guide
1x Warranty Card
1x Power Cord
VESA Mount Screws
FCC, CB/CE, UL & CUL, VCCI, RCM, ENERGY STAR
"""
    specs = _parse_msi_family_spec_markdown(markdown)
    by_name = {item["name"]: item["value"] for item in specs}
    assert by_name["Процессор"].startswith("Intel® Core™ i7 processor 14700")
    assert by_name["Чипсет"] == "Intel® H610"
    assert "M.2 SSD" in by_name["Конфигурация накопителей"]
    assert "DDR5" in by_name["Оперативная память"]
    assert "WiFi 6E" in by_name["Беспроводные интерфейсы"]
    assert by_name["Размеры корпуса"].startswith("204 x 208 x 54.8")
    assert "KEYBOARD / MOUSE" not in by_name
    assert "Accessories" not in by_name
    assert "Certificates" not in by_name
    assert _has_sufficient_exact_model_quality(specs) is True


def test_parse_msi_family_spec_markdown_extracts_real_repeated_layout():
    markdown = """
### PRO DP21 14MQ

CPU CPU  Intel® Core™ i7 processor 14700 (33M Cache, 2.10 GHz up to 5.40 GHz)

 Intel® Core™ i5 processor 14500 (24M Cache, 2.60 GHz up to 5.00 GHz)CPU  Intel® Core™ i7 processor 14700 (33M Cache, 2.10 GHz up to 5.40 GHz)

 Intel® Core™ i5 processor 14500 (24M Cache, 2.60 GHz up to 5.00 GHz)
Chipset Chipset  Intel® Q670 Chipset  Intel® Q670
Memory Memory  DDR5 5600 MHz Max 64GB SO-DIMM 2 Slots Memory  DDR5 5600 MHz Max 64GB SO-DIMM 2 Slots
Storage Storage  1x M.2 SSD combo (NVMe PCIe Gen3 x4 / SATA)

 2x 2.5" Drive Bays Storage  1x M.2 SSD combo (NVMe PCIe Gen3 x4 / SATA)

 2x 2.5" Drive Bays
I/O Ports (Rear)I/O Ports (Rear)  1x (v2.1) HDMI out

 1x (v1.4) DP out

 1x COM Port

 1x USB 3.2 Gen 2 (10G) Type C 

 3x USB 3.2 Gen 2 (10G) Type A I/O Ports (Rear)  1x (v2.1) HDMI out

 1x (v1.4) DP out

 1x COM Port

 1x USB 3.2 Gen 2 (10G) Type C 

 3x USB 3.2 Gen 2 (10G) Type A
Communication Communication  Intel Wireless AX211 + Bluetooth v5.3

 Intel Wi-Fi 7 BE200 + Bluetooth 5.4 Communication  Intel Wireless AX211 + Bluetooth v5.3

 Intel Wi-Fi 7 BE200 + Bluetooth 5.4
Power Supply Power Supply  120W Power Supply  120W
Product Dimension (WxDxH)Product Dimension (WxDxH)  204 x 208 x 54.8 (mm)Product Dimension (WxDxH)  204 x 208 x 54.8 (mm)
W/O KB Weight (Net kg)W/O KB Weight (Net kg)  1.27 W/O KB Weight (Net kg)  1.27
Part No Part No 9S6-B0A431-1069 Part No 9S6-B0A431-1069
MKT Name MKT Name PRO DP21 14M MKT Name PRO DP21 14M
"""
    specs = _parse_msi_family_spec_markdown(markdown)
    by_name = {item["name"]: item["value"] for item in specs}
    assert by_name["Процессор"].startswith("Intel® Core™ i7 processor 14700")
    assert by_name["Чипсет"] == "Intel® Q670"
    assert "DDR5 5600 MHz" in by_name["Оперативная память"]
    assert "M.2 SSD combo" in by_name["Конфигурация накопителей"]
    assert "HDMI out" in by_name["Порты на задней панели"]
    assert "AX211" in by_name["Беспроводные интерфейсы"]
    assert by_name["Блок питания"] == "120"
    assert by_name["Размеры корпуса"].startswith("204 x 208 x 54.8")
    assert by_name["Масса нетто"] == "1.27"
    assert "Part No" not in by_name
    assert "MKT Name" not in by_name


def test_clean_specs_for_compliance_removes_model_identity_fields():
    specs = _clean_specs_for_compliance([
        {"name": "Part No", "value": "9S6-B0A431-1069", "unit": ""},
        {"name": "MKT Name", "value": "PRO DP21 14M", "unit": ""},
        {"name": "MKT Spec", "value": "PRO DP21 14M-1069XRU", "unit": ""},
        {"name": "Процессор", "value": "Intel Core i7 Processor 14700", "unit": ""},
    ])
    assert specs == [{"name": "Процессор", "value": "Intel Core i7 Processor 14700", "unit": ""}]


def test_monitor_baseline_is_monitor_specific_not_generic_peripheral():
    specs = _get_baseline_specs("monitor", "Монитор серии 07 RDW")
    by_name = {item["name"]: item["value"] for item in specs}
    assert by_name["Тип устройства"] == "Монитор для подключения к персональному компьютеру"
    assert "Диагональ экрана" in by_name
    assert by_name["Разрешение экрана"].startswith("не менее")
    assert "Видеоинтерфейсы" in by_name
