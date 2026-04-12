import type { SpecItem } from './spec-processor';
import { getDetectionRules, applyComplianceFixes, validateDocumentText, getAllRulesSummary, type ComplianceFixResult } from './legal-rules';

export { validateDocumentText, getAllRulesSummary, applyComplianceFixes };
export type { ComplianceFixResult };

export type ComplianceSeverity = 'critical' | 'major' | 'minor';

export type ComplianceIssue = {
  rowId: number;
  rowType: string;
  specName: string;
  specValue: string;
  severity: ComplianceSeverity;
  reason: string;
  recommendation: string;
};

export type ComplianceReport = {
  generatedAt: string;
  score: number;
  minScore: number;
  critical: number;
  major: number;
  minor: number;
  blocked: boolean;
  issues: ComplianceIssue[];
};

type RowForCompliance = {
  id: number;
  type: string;
  status: string;
  model?: string;
  licenseType?: string;
  term?: string;
  strictMinSpecs?: number;
  specs?: SpecItem[];
};

const BRAND_RE = /\b(Intel|AMD|Nvidia|Samsung|Micron|Kingston|WD|Western\s+Digital|Seagate|Toshiba|Qualcomm|Broadcom|Realtek|Marvell|Mellanox|Hynix|SK\s*Hynix|Lenovo|Huawei|Cisco|Dell|Acer|Asus|Apple|MSI|Gigabyte|Supermicro|HP|HPE|TP-?Link|D-?Link|Juniper|Aruba|ZTE|Hikvision|Dahua|Canon|Epson|Ricoh|Kyocera|Brother|Xerox|Pantum|LG|BenQ|ViewSonic|AOC|iiyama|Logitech|Jabra|Plantronics|Poly|Synology|QNAP|NetApp|MikroTik|Ubiquiti|Zyxel|Eltex|APC|Eaton|Vertiv|Noctua|Corsair|be\s*quiet|Chieftec|Thermaltake|Cooler\s*Master|DeepCool|Интел|Самсунг|Леново|Хуавей|Делл|Кэнон|Эпсон)\b/i;
const ARTICLE_RE = /\b(артикул|арт\.?|part\s*(?:number|no\.?)|p\/n|pn|sku|product\s*code|код\s+товара)\b/i;
const MODEL_WORD_RE = /\b(модель|model|mkt\s*name|mkt\s*spec|serial(?:\s*number)?|серийн(?:ый|ого)\s+номер)\b/i;
const ARTICLE_CODE_RE = /\b[A-ZА-Я]{1,6}-\d{2,8}[A-ZА-Я0-9-]*\b/;
const IDENTITY_SPEC_NAME_RE = /^(модель|model|mkt\s*name|mkt\s*spec|артикул|арт\.?|part\s*(?:number|no\.?)|p\/?n|pn|sku|s\/?n|sn|serial(?:\s*number)?|серийн(?:ый|ого)\s+номер|product\s*code|код\s+товара|бренд|brand|производитель|manufacturer|торговая\s+марка)$/i;
const OPERATOR_RE = /(>=|<=|>|<)/;
const STRICT_WEAK_VALUE_RE = /(по типу( товара| программного обеспечения)?|по назначению|в соответствии с технической документацией производителя( и требованиями заказчика)?|по условиям поставки и требованиям заказчика|актуальная поддерживаемая версия по документации производителя|в соответствии с требованиями заказчика|в соответствии с требованиями производителя|в соответствии с документацией производителя|по типу устройства|по типу изделия|в зависимости от класса устройства|при необходимости|по описанию|по согласованию с заказчиком|типовая конфигурация|конкретное значение|согласно документации|согласно требованиям|или иное по требованию|или иное — по требованию|уточнить при необходимости)/i;
const GENERIC_NAME_RE = /^(функциональные возможности|технические характеристики|характеристики|параметры|описание|назначение|тип товара)$/i;
const MEASURABLE_NAME_RE = /(колич|объем|объ[её]м|емкост|[её]мкост|размер|ширин|высот|глубин|толщин|мощност|скорост|пропускн|частот|диагонал|разрешен|памят|ядер|поток|срок|верси|уров|класс|ресурс|масса|вес|длин|время реакции|время решения|порт|сокет|tbw|mtbf|iops)/i;
const BOOLEAN_ALLOWED_NAME_RE = /(наличие|поддержка|совместим|интеграц|журналир|аудит|веб-интерфейс|api|экспорт|импорт|консоль|кластеризац|резервн|ролевая модель|двухфактор|авторизац|аутентификац|шлюз|мониторинг|оповещени|доставка|доступ|управление|миграц|политик|сервис|средств|защит|шифрован|контроль|блокиров|регистрац|монтаж|развертыван|разв[её]ртыван|интерфейс|подключение|протокол|клиент|агент|диспетчер|маркировк|очистк|запуск|инструмент|графическ(ое|ие) средст)/i;
const QUALITATIVE_CONCRETE_VALUE_RE = /^(наличие|да|нет|монолитное|гибридное|электронная поставка|бессрочная|бессрочно|подписка|серверная|клиентская|конкурентная сессия|именованный пользователь|64-бит|x86_64)$/i;
const QUALITATIVE_ALLOWED_NAME_RE = /(тип ядра|тип лицензии|редакц|исполнени|уровень доверия|класс защиты|тип операционной системы|разрядность|носитель поставки|вариант поставки|верси[яю]?|прошивк|форм.?фактор|форм\s+фактор|типоразмер|профил[ьи]|степен.*защит|класс.*энергопотребл|класс.*пылевлаг|цвет|тип корпуса|исполнение корпуса|тип процессора|тип дисплея|тип матриц|тип накопител|тип интерфейс)/i;
const SOFTWARE_TYPE_KEYS = new Set([
  'os', 'office', 'virt', 'vdi', 'dbms', 'erp', 'cad', 'license', 'antivirus', 'edr', 'firewall_sw', 'dlp',
  'siem', 'crypto', 'waf', 'pam', 'iam', 'pki', 'email', 'vks', 'ecm', 'portal', 'project_sw', 'bpm',
  'backup_sw', 'itsm', 'monitoring', 'mdm', 'hr', 'gis', 'ldap', 'osSupport', 'supportCert', 'remoteAccessSw',
]);

// Whitelist: технические стандарты и интерфейсы, которые НЕ являются торговыми марками
const TECH_STANDARD_WHITELIST = /\b(RJ-?45|RJ-?11|RJ-?12|USB|HDMI|VGA|DVI|DP|DisplayPort|SFP|SFP\+|QSFP|QSFP\+|QSFP28|LC|SC|FC|ST|MTP|MPO|Cat\.?\s*[5-8][eaEA]?|UTP|FTP|STP|S\/FTP|PoE|PoE\+|DDR[2-5]|PCIe|PCI-?E|SATA|SAS|NVMe|M\.2|mSATA|SO-?DIMM|DIMM|ECC|LAN|WAN|IEEE\s*802\.\d+|Wi-?Fi\s*\d*[a-z]?|Bluetooth|BLE|Ethernet|GbE|10GbE|40GbE|100GbE|IPv[46]|TCP|UDP|HTTP[S]?|FTP|SNMP|SSH|SSL|TLS|AES|RSA|SHA|IPS|IDS|RAID|SSD|HDD|NAND|TLC|QLC|MLC|SLC|OLED|IPS|VA|TN|LED|LCD|ГГц|МГц|ГБ|МБ|ТБ|Вт|дБ|лк|кд|Гбит|Мбит|PKCS|FIPS|ISO|IEC|IEEE|ITU|RFC|UVC|AVC|HEVC|RS-232|RS-485|CAN-bus|SNMP|LDAP|SAML|OAuth|OpenID|TOTP|HOTP|GOST|ГОСТ)\b/i;

// Whitelist для ARTICLE_CODE_RE: разрешённые паттерны типа "RJ-45", "Cat-6", "USB-C", "PKCS-11"
const ARTICLE_CODE_WHITELIST = /^(RJ-?\d+|Cat-?\d+[eaEA]?|USB-?[A-C0-9]?|SFP-?\d*|DP-?\d*|Type-?[A-C]|PKCS-?\d+|FIPS-?\d+|ISO-?\d+|IEC-?\d+|IEEE-?\d+|ITU-?\d+|RFC-?\d+|UVC-?\d*|AVC-?\d*|HEVC-?\d*|RS-?\d+|TIA-?\d+|EIA-?\d+|CAN-?\d*|SHA-?\d+|AES-?\d+|RSA-?\d+|MD-?\d+|Wi-Fi\s*\d*[a-z]?|Wi-Fi|G-\d+|H-\d+|MPEG-?\d+|VP-?\d+|YUV-?\d+|EAL-?\d+|LTE-?\d*|5G-?\d*|PoE-?\d*|DDR-?\d+|DDR[2-5]L?|PCIe-?\d+|USB-?\d+[\.\d]*[A-Za-z]?|TLS-?\d+[\.\d]*|ГОСТ-?Р?-?\d+|SP-?\d+|NIST-?\d+|CC-?\d+|ANSI-?\d+)$/i;
const FORBIDDEN_PHRASES: Array<{ re: RegExp; severity: ComplianceSeverity; reason: string; recommendation: string }> = getDetectionRules();
const SERVICE_TYPE_KEYS = new Set(['otherService']);
const PRODUCT_ONLY_SPEC_NAME_RE = /^(состояние товара|комплект поставки|документация на русском языке|маркировка и идентификация|гарантия производителя|упаковка)$/i;
const EXPORT_NOISE_SPEC_NAME_RE = /^(удал[её]нное администрирование(?:\s*\/\s*мониторинг состояния)?|поддержка модернизации и замены компонентов|торп|состояние товара|комплект поставки|документация на русском языке|маркировка и идентификация|гарантия производителя|упаковка)$/i;
const INTERNAL_WORKFLOW_RE = /(основание сформировано автоматически|требуется юридическая проверка|требуется ручная верификация|перед публикацией закупки|anti-?фас|benchmark|паспорт публикации|сводка готовности)/i;
const URL_RE = /https?:\/\/|www\./i;
const FOREIGN_MARKETING_RE = /(learn more about|windows 11 home is available only|recomienda windows|certificaci[oó]n|tecnolog[ií]a|pantalla|teclado|c[aá]mara|lector de tarjeta|todos los derechos reservados|all rights reserved|array microphone|smart amp|compatible con stylus)/i;
const LOW_SIGNAL_EXPORT_VALUE_RE = /(в соответствии с требованиями производителя|в соответствии с документацией производителя|по требованиям заказчика|по типу устройства|по типу изделия|в зависимости от класса устройства|достаточн(?:ых|ого) для штатной эксплуатации)/i;

function addIssue(
  issues: ComplianceIssue[],
  row: RowForCompliance,
  spec: SpecItem,
  severity: ComplianceSeverity,
  reason: string,
  recommendation: string
): void {
  issues.push({
    rowId: row.id,
    rowType: row.type,
    specName: String(spec.name || ''),
    specValue: String(spec.value || ''),
    severity,
    reason,
    recommendation,
  });
}

function normalizeSpecKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function isWeakStrictValue(value: string): boolean {
  const normalized = normalizeSpecKey(value);
  if (!normalized) return true;
  if (STRICT_WEAK_VALUE_RE.test(normalized)) return true;
  return false;
}

function isConcreteValue(value: string): boolean {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  if (QUALITATIVE_CONCRETE_VALUE_RE.test(normalized)) return true;
  if (/\d/.test(normalized)) return true;
  if (/не менее|не более|до |от |tls|ssl|rbac|ldap|kerberos|smtp|imap|pop3|https|ssh|ceph|lvm|kvm|qemu|rest api|cli|html5|totp|saml|openid|patroni|postgresql|gost|гост|фстэк/i.test(normalized)) {
    return true;
  }
  if (/[;,/]/.test(normalized)) return true;
  if (normalized.split(/\s+/).length >= 5 && !isWeakStrictValue(normalized)) return true;
  // Стандартные разрешения и широко признанные технические квалификаторы — конкретные значения
  if (/\b(full[\s-]?hd|fhd|4k|uhd|qhd|wqhd|2k|8k|hd[\s-]?ready|720p|1080[pi]|1440p|2160p|wuxga|uxga|sxga|wxga|xga|svga|vga|ntsc|pal|secam)\b/i.test(normalized)) return true;
  // Конкретные стандарты подключения, сжатия, аудио/видео без цифры в имени
  if (/\b(usb[\s-]?[abc2-3.]+|hdmi|displayport|thunderbolt|vga|dvi|rs[\s-]?232|rs[\s-]?485|rj[\s-]?\d+|cat[\s-]?\d+|sfp|qsfp|poe|bluetooth|wi[\s-]?fi|nfc|lte|5g|h\.26[45]|h26[45]|avc|hevc|vp[89]|aac|mp3|flac|opus|g\.71[12]|mjpeg|mpeg[\s-]?\d)\b/i.test(normalized)) return true;
  // Технические аббревиатуры режимов работы оптических носителей
  if (/\bcav\b|\bclv\b|\bcav.*constant\b|\bclv.*constant\b/i.test(normalized)) return true;
  // «или эквивалент» — любое значение с этим суффиксом является конкретным (44-ФЗ ст. 33 ч. 3)
  if (/или\s+эквивалент/i.test(normalized)) return true;
  // BIOS/UEFI, TPM, Secure Boot и прочие аппаратные стандарты без цифр
  if (/\b(uefi|secure[\s-]?boot|efi|bios|tpm|amd[\s-]?vi|intel[\s-]?vt|smm|acpi|pxe|wake[\s-]?on[\s-]?lan|wol)\b/i.test(normalized)) return true;
  // Форм-факторы корпусов, плат, накопителей
  if (/\b(mini[\s-]?itx|micro[\s-]?atx|e[\s-]?atx|flex[\s-]?atx|atx|itx|matx|eatx|sff|uatx|dtx|nuc|tower|desktop|slim|ultra[\s-]?slim|rack[\s-]?mount|1u|2u|4u|rackmount)\b/i.test(normalized)) return true;
  // Классы энергоэффективности — 80+ Plus и российская/EU шкала A/A+/A++/A+++
  if (/\b(80[\s+]+plus|gold|silver|bronze|platinum|titanium|energy[\s-]?star|erp)\b/i.test(normalized)) return true;
  if (/^не\s+ниже\s+[Aa][+]*$/.test(normalized.trim())) return true;
  if (/^(класс\s+)?[Aa][+]*$/.test(normalized.trim())) return true;
  return false;
}

function inferMissingUnit(name: string, value: string, unit: string): string {
  const normalizedUnit = String(unit || '').trim();
  if (normalizedUnit && normalizedUnit !== '—') return normalizedUnit;
  const normalizedName = normalizeSpecKey(name);
  const normalizedValue = normalizeSpecKey(value);
  if (!normalizedName) return normalizedUnit || '—';
  if (normalizedName.includes('срок')) return 'мес';
  if (normalizedName.includes('уровень доверия')) return 'уровень';
  if (normalizedName.includes('класс защиты')) return 'класс';
  if (normalizedName.includes('версия') || normalizedName.includes('релиз')) return 'версия';
  if (normalizedName.includes('тип')) return 'тип';
  if (normalizedName.includes('количество')) return 'шт';
  if (/^(наличие|да|нет)$/i.test(normalizedValue)) return 'наличие';
  return normalizedUnit || '—';
}

function normalizeExistingUnit(name: string, value: string, unit: string): string {
  const normalizedUnit = String(unit || '').trim();
  if (!normalizedUnit || normalizedUnit === '—') return normalizedUnit || '—';
  if (!/^наличие$/i.test(normalizedUnit)) return normalizedUnit;

  const normalizedName = normalizeSpecKey(name);
  const normalizedValue = normalizeSpecKey(value);
  if (/^(наличие|да|нет|есть|имеется|предусмотрено)$/i.test(normalizedValue)) return 'наличие';
  if (normalizedValue.startsWith('наличие ')) return 'наличие';
  if (/^(наличие|поддержка|совместимость|интеграция|журналирование|аудит|разграничение|двухфакторная аутентификация|веб-интерфейс)/i.test(normalizedName) &&
      normalizedValue.split(/\s+/).length <= 4) {
    return 'наличие';
  }
  return '—';
}

function hasExcessiveLatinVendorCopy(value: string): boolean {
  const latinWords = String(value || '').match(/[A-Za-zÀ-ÿ]{4,}/g) || [];
  return latinWords.length >= 6 && String(value || '').length >= 70;
}

function normalizeWeakBoilerplateValue(name: string, rawValue: string): string {
  const normalizedName = normalizeSpecKey(name);
  let value = String(rawValue || '').replace(/\s+/g, ' ').trim();

  if (!value) return '';

  if (/тип матрицы/.test(normalizedName)) {
    value = value.replace(/\s+или эквивалент$/i, '').trim();
  }

  if (/интерфейс подключени/.test(normalizedName) && /^usb 2\.0\/3\.0 или эквивалент$/i.test(value)) {
    return 'USB 2.0 и/или USB 3.0';
  }

  if (/фокусировк/.test(normalizedName) && /по требованиям заказчика/i.test(value)) {
    return 'автоматическая и/или фиксированная';
  }

  if (/совместимость с экосистемой/.test(normalizedName)) {
    return 'совместимость с отечественными службами каталогов, виртуализации, VDI, почтовыми сервисами и средствами резервного копирования';
  }

  if (/поддержка веб-браузеров|веб-браузеры и репозитории российского по/.test(normalizedName)) {
    return 'совместимость с браузерами, поддерживающими современные веб-стандарты';
  }

  if (/доменная аутентификац/.test(normalizedName) && /ald pro/i.test(value)) {
    return 'поддержка LDAP, Kerberos и интеграции со службой каталогов или эквивалентным решением';
  }

  // CAV — режим записи оптического диска с постоянной угловой скоростью
  if (/^cav$/i.test(value.trim())) {
    return 'CAV (Constant Angular Velocity)';
  }

  if (/совместимость с отечественными скзи|интеграция с скзи/.test(normalizedName) && /криптопро/i.test(value)) {
    return 'поддержка отечественных средств электронной подписи и криптографической защиты или эквивалентных решений';
  }

  if (/совместимость с отечественными ос/.test(normalizedName) && /при поддержке производителем/i.test(value)) {
    return value.replace(/\s+при поддержке производителем/i, '').trim();
  }

  if (LOW_SIGNAL_EXPORT_VALUE_RE.test(value) && !/\d|ldap|kerberos|ssh|https|tls|api|гост|фстэк/i.test(normalizeSpecKey(value))) {
    return '';
  }

  return value;
}

function normalizeVendorFieldValue(name: string, rawValue: string): string {
  const normalizedName = normalizeSpecKey(name);
  let value = String(rawValue || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value) return '';

  if (/операционн/.test(normalizedName) && /windows\s*11/i.test(value)) {
    return 'совместимость с операционной системой семейства Windows 11 или эквивалентной, при необходимости поставки с предустановленной ОС';
  }

  if (/процессор/.test(normalizedName)) {
    const cores = value.match(/(\d+)\s*cores?/i)?.[1];
    const threads = value.match(/(\d+)\s*threads?/i)?.[1];
    const baseGHz = value.match(/(?:processor\s*)?(\d+(?:[.,]\d+)?)\s*ghz/i)?.[1];
    const boostGHz = value.match(/up to\s*(\d+(?:[.,]\d+)?)\s*ghz/i)?.[1];
    const tops = value.match(/(\d+)\s*tops/i)?.[1];
    const parts = [
      cores ? `не менее ${cores} ядер` : '',
      threads ? `не менее ${threads} потоков` : '',
      baseGHz ? `базовая частота не менее ${baseGHz.replace(',', '.')} ГГц` : '',
      boostGHz ? `максимальная частота не менее ${boostGHz.replace(',', '.')} ГГц` : '',
      tops ? `наличие NPU производительностью не менее ${tops} TOPS` : '',
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
  }

  if (/оперативн.*памят|объем оперативной памяти|объем озу|тип оперативной памяти/.test(normalizedName)) {
    const capacity = value.match(/(\d+)\s*(tb|gb|mb|тб|гб|мб)\b/i);
    const memoryType = value.match(/\b(lpddr5x|lpddr5|lpddr4x|lpddr4|ddr5(?:-\d+)?|ddr4(?:-\d+)?|ddr3)\b/i)?.[1];
    const parts = [
      capacity ? `не менее ${capacity[1]} ${capacity[2].toUpperCase().replace('GB', 'ГБ').replace('TB', 'ТБ').replace('MB', 'МБ')}` : '',
      memoryType ? memoryType.toUpperCase() : '',
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
  }

  if (/накопител|ssd|hdd/.test(normalizedName)) {
    const capacity = value.match(/(\d+)\s*(tb|gb|mb|тб|гб|мб)\b/i);
    const driveType = value.match(/\b(SSD|HDD)\b/i)?.[1]?.toUpperCase();
    const iface = value.match(/\b(NVMe|M\.2|PCIe\s*\d(?:\.\d)?|SATA|SAS)\b/ig) || [];
    const ifaceText = [...new Set(iface.map((item) => item.replace(/\s+/g, ' ').trim()))].join(' ');
    const parts = [
      driveType || (/nvme|m\.2|pcie/i.test(value) ? 'SSD' : ''),
      ifaceText,
      capacity ? `не менее ${capacity[1]} ${capacity[2].toUpperCase().replace('GB', 'ГБ').replace('TB', 'ТБ').replace('MB', 'МБ')}` : '',
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
  }

  if (/диспле|экран|матриц/.test(normalizedName)) {
    const diag = value.match(/(\d+(?:[.,]\d+)?)\s*["”]/)?.[1];
    const resolution = value.match(/(\d{3,4}\s*[xх×]\s*\d{3,4})/i)?.[1]?.replace(/\s*/g, '');
    const refresh = value.match(/(\d+)\s*hz/i)?.[1];
    const brightness = value.match(/(\d+)\s*nits?/i)?.[1];
    const panel = value.match(/\b(OLED|AMOLED|IPS|VA|TN|LCD|LED)\b/i)?.[1]?.toUpperCase();
    const parts = [
      diag ? `диагональ не менее ${diag.replace(',', '.')} дюйма` : '',
      resolution ? `разрешение не менее ${resolution}` : '',
      panel ? `тип матрицы ${panel} или эквивалент` : '',
      refresh ? `частота обновления не менее ${refresh} Гц` : '',
      brightness ? `яркость не менее ${brightness} кд/м²` : '',
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
  }

  if (/сетев.*интерфейс|беспроводн|wi-?fi|bluetooth/.test(normalizedName)) {
    const wifi = value.match(/wi-?fi\s*([0-9a-z.+-]+)/i)?.[1];
    const bt = value.match(/bluetooth[®\s]*([0-9.]+)/i)?.[1];
    const hasRj45 = /rj-?45|ethernet/i.test(value);
    const parts = [
      wifi ? `Wi‑Fi ${wifi}` : '',
      bt ? `Bluetooth не ниже ${bt}` : '',
      hasRj45 ? 'Ethernet RJ‑45 не ниже 1 Гбит/с' : '',
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
  }

  if (/порт|интерфейс подключени|видеовыход/.test(normalizedName)) {
    const parts: string[] = [];
    const usbC = value.match(/(\d+)x?\s*usb\s*(?:4(?:\.0)?|type-c|c)/i)?.[1];
    const usbA = value.match(/(\d+)x?\s*usb\s*(?:3\.\d|3|2\.\d|2)\s*(?:gen\s*\d+)?\s*(?:type-a|tipo a|a)?/i)?.[1];
    const hdmi = value.match(/(\d+)x?\s*hdmi/i)?.[1];
    if (usbC) parts.push(`не менее ${usbC} портов USB Type‑C`);
    if (usbA) parts.push(`не менее ${usbA} портов USB Type‑A`);
    if (hdmi) parts.push(`не менее ${hdmi} порта HDMI`);
    if (/3\.5mm|audio/i.test(value)) parts.push('комбинированный аудиоразъём 3,5 мм');
    if (/micro\s*sd/i.test(value)) parts.push('слот для карт microSD');
    if (parts.length > 0) return parts.join(', ');
  }

  if (/аккумулятор|батаре/.test(normalizedName)) {
    const wh = value.match(/(\d+(?:[.,]\d+)?)\s*wh/i)?.[1];
    const liIon = /li-?ion/i.test(value);
    const parts = [
      wh ? `не менее ${wh.replace(',', '.')} Вт·ч` : '',
      liIon ? 'литий-ионный' : '',
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
  }

  if (/масса|вес/.test(normalizedName)) {
    const kg = value.match(/(\d+(?:[.,]\d+)?)\s*kg/i)?.[1] || value.match(/(\d+(?:[.,]\d+)?)\s*кг/i)?.[1];
    if (kg) return `не более ${kg.replace(',', '.')} кг`;
  }

  if (/габарит|размер/.test(normalizedName)) {
    const dims = value.match(/(\d+(?:[.,]\d+)?\s*x\s*\d+(?:[.,]\d+)?(?:\s*x\s*\d+(?:[.,]\d+)?)?)/i)?.[1];
    if (dims) {
      const unit = /cm|см/i.test(value) ? 'см' : 'мм';
      return `не более ${dims.replace(/\s+/g, ' ')} ${unit}`;
    }
  }

  if (/камера/.test(normalizedName)) {
    const isFhd = /\bfhd\b|full hd/i.test(value);
    const hasIr = /\bir\b|windows hello/i.test(value);
    const parts = [
      isFhd ? 'веб-камера не ниже Full HD' : '',
      hasIr ? 'поддержка ИК-камеры / биометрической аутентификации' : '',
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
  }

  if (/аудио/.test(normalizedName)) {
    if (/speaker|microphone|mic/i.test(value)) {
      return 'встроенные динамики и микрофон(ы)';
    }
  }

  if (/средства безопасности/.test(normalizedName)) {
    const parts = [
      /tpm/i.test(value) ? 'наличие TPM' : '',
      /windows hello/i.test(value) ? 'поддержка биометрической аутентификации' : '',
      /password/i.test(value) ? 'наличие защиты доступа к BIOS/загрузке' : '',
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
  }

  value = value
    .replace(/[«»"]/g, '')
    .replace(/\b(Processor|Graphics|Wireless Card|Built-in|Support)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (URL_RE.test(value) || FOREIGN_MARKETING_RE.test(value) || hasExcessiveLatinVendorCopy(value)) {
    return '';
  }

  return value;
}

function lowerFirst(text: string): string {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return normalized;
  return normalized.charAt(0).toLowerCase() + normalized.slice(1);
}

function expandGenericValue(name: string, value: string): string {
  const rawName = String(name || '').replace(/\s+/g, ' ').trim();
  const rawValue = String(value || '').replace(/\s+/g, ' ').trim();
  if (!rawName || !rawValue) return rawValue;

  const normalizedName = normalizeSpecKey(rawName);
  const normalizedValue = normalizeSpecKey(rawValue);
  if (!/^(наличие|да|поддержка|электронная)$/i.test(normalizedValue)) return rawValue;

  if (normalizedName.includes('способ поставки')) {
    return 'электронная поставка лицензий, ключей активации, дистрибутива и эксплуатационной документации';
  }
  if (normalizedName.includes('документация на русском языке')) {
    return 'эксплуатационная документация на русском языке в электронном виде';
  }
  if (normalizedName.includes('наличие в едином реестре российского по минцифры россии')) {
    return 'включено в Единый реестр российского ПО Минцифры России';
  }
  if (normalizedName.includes('соответствие требованиям постановления правительства')) {
    return 'соответствует указанным требованиям национального режима и нормативной документации';
  }
  if (normalizedName.includes('раскрытие сведений о средствах и способах реализации функций безопасности')) {
    return 'сведения раскрыты в технической и эксплуатационной документации продукта';
  }
  if (normalizedName.includes('сертификат фстэк')) {
    return 'действующий сертификат ФСТЭК России на поставляемый продукт';
  }
  if (normalizedName.includes('профиль защиты')) {
    return 'соответствие заявленному профилю защиты подтверждено документацией и сертификатами';
  }
  if (normalizedName.includes('веб-консоль') || normalizedName.includes('веб-интерфейс') || normalizedName.includes('графический веб-интерфейс')) {
    return 'web-интерфейс для настройки, мониторинга и администрирования системы';
  }
  if (normalizedName.includes('api')) {
    return 'штатный API для автоматизации, интеграции и обмена данными';
  }
  if (normalizedName.includes('ролевая модель доступа')) {
    return 'разделение ролей и полномочий пользователей, операторов, администраторов и аудиторов';
  }
  if (normalizedName.includes('журналирование')) {
    return 'регистрация, хранение, поиск и экспорт журналов событий, изменений и операций';
  }
  if (normalizedName.includes('аудит действий')) {
    return 'аудит входов, изменений конфигурации и административных операций';
  }
  if (normalizedName.includes('мониторинг')) {
    return 'мониторинг состояния компонентов, ресурсов, событий и аварийных уведомлений средствами продукта';
  }
  if (normalizedName.includes('резервное копирование конфигурации')) {
    return 'резервное копирование конфигурации с возможностью последующего восстановления';
  }
  if (normalizedName.includes('отказоустойчивая схема развёртывания') || normalizedName.includes('отказоустойчивая схема развертывания')) {
    return 'кластерная и/или резервированная схема развёртывания компонентов управления';
  }
  if (normalizedName === 'высокая доступность') {
    return 'отказоустойчивая и/или кластерная схема развёртывания компонентов решения';
  }
  if (normalizedName.includes('горизонтальное масштабирование')) {
    return `обеспечивается ${lowerFirst(rawName)}`;
  }
  if (normalizedName.includes('функционирование без ограничений в контуре периметра')) {
    return 'работа в изолированном контуре без обязательного обращения к внешним сервисам';
  }
  if (normalizedName.includes('взаимодействие пользователей с продуктом посредством графического интерфейса')) {
    return 'доступ к функциям продукта через web-интерфейс и/или графическую консоль';
  }
  if (normalizedName.includes('поддержка светлой и темной темы интерфейса')) {
    return 'светлая и тёмная тема пользовательского интерфейса';
  }
  if (normalizedName.includes('работа на архитектуре x86')) {
    return 'функционирование на аппаратной архитектуре x86_64';
  }
  if (normalizedName.includes('развертывание под управлением ос astra linux') || normalizedName.includes('развёртывание под управлением ос astra linux')) {
    return 'развёртывание серверных компонентов под управлением Astra Linux';
  }
  if (normalizedName.startsWith('наличие ')) {
    const tail = rawName.replace(/^Наличие\s+/i, '').trim();
    return tail ? `предусмотрен ${lowerFirst(tail)}` : rawValue;
  }
  if (normalizedName.startsWith('поддержка ')) {
    const tail = rawName.replace(/^Поддержка\s+/i, '').trim();
    return tail ? `поддержка ${lowerFirst(tail)} штатными средствами продукта` : rawValue;
  }
  if (
    normalizedName.startsWith('работа с ') ||
    normalizedName.startsWith('работа в ') ||
    normalizedName.startsWith('аутентификация ') ||
    normalizedName.startsWith('авторизация ') ||
    normalizedName.startsWith('идентификация ') ||
    normalizedName.startsWith('регистрация ') ||
    normalizedName.startsWith('настройка ') ||
    normalizedName.startsWith('просмотр ') ||
    normalizedName.startsWith('изменение ') ||
    normalizedName.startsWith('ввод ') ||
    normalizedName.startsWith('подключение ') ||
    normalizedName.startsWith('управление ') ||
    normalizedName.startsWith('создание ') ||
    normalizedName.startsWith('выполнение ') ||
    normalizedName.startsWith('использование ') ||
    normalizedName.startsWith('развертывание ') ||
    normalizedName.startsWith('развёртывание ') ||
    normalizedName.startsWith('возврат ') ||
    normalizedName.startsWith('ограничение ') ||
    normalizedName.startsWith('перенаправление ') ||
    normalizedName.startsWith('предоставление ') ||
    normalizedName.startsWith('доставка ') ||
    normalizedName.startsWith('доступ ') ||
    normalizedName.startsWith('консольный ') ||
    normalizedName.startsWith('автоматическое ') ||
    normalizedName.startsWith('кластеризация ') ||
    normalizedName.startsWith('мультиарендность') ||
    normalizedName.startsWith('интеграция ') ||
    normalizedName.startsWith('совместимость ') ||
    normalizedName.startsWith('квоты ') ||
    normalizedName.startsWith('тарификация ') ||
    normalizedName.startsWith('инициализация ') ||
    normalizedName.startsWith('реализация ')
  ) {
    return `обеспечивается ${lowerFirst(rawName)}`;
  }

  return rawValue;
}

function inferSpecStrength(spec: SpecItem): number {
  const name = String(spec.name || '').trim();
  const value = String(spec.value || '').trim();
  const unit = String(spec.unit || '').trim();
  let score = 0;
  if (name && !GENERIC_NAME_RE.test(name)) score += 2;
  if (!isWeakStrictValue(value)) score += 3;
  if (isConcreteValue(value)) score += 3;
  if (unit && unit !== '—') score += 1;
  if (/\d/.test(value)) score += 1;
  return score;
}

export function sanitizeProcurementSpecs(row: Pick<RowForCompliance, 'type' | 'model' | 'licenseType' | 'term'>, specs: SpecItem[]): SpecItem[] {
  const bucket = new Map<string, SpecItem>();
  const orderedKeys: string[] = [];
  for (const original of specs) {
    const name = String(original.name || '').replace(/\s+/g, ' ').trim();
    let value = expandGenericValue(name, String(original.value || '').replace(/\s+/g, ' ').trim());
    const unit = String(original.unit || '').replace(/\s+/g, ' ').trim();
    const group = String(original.group || 'Общие сведения').replace(/\s+/g, ' ').trim() || 'Общие сведения';
    value = normalizeWeakBoilerplateValue(name, value);
    if (!name || !value) continue;
    if (IDENTITY_SPEC_NAME_RE.test(name)) continue;
    if (SERVICE_TYPE_KEYS.has(row.type) && PRODUCT_ONLY_SPEC_NAME_RE.test(name)) continue;
    if (EXPORT_NOISE_SPEC_NAME_RE.test(name)) continue;
    if (INTERNAL_WORKFLOW_RE.test(name) || INTERNAL_WORKFLOW_RE.test(value)) continue;
    if (URL_RE.test(value) || FOREIGN_MARKETING_RE.test(value) || hasExcessiveLatinVendorCopy(value) || BRAND_RE.test(value) || ARTICLE_CODE_RE.test(value)) {
      value = normalizeVendorFieldValue(name, value);
      value = normalizeWeakBoilerplateValue(name, value);
      if (!value) continue;
    }
    if (GENERIC_NAME_RE.test(name) && isWeakStrictValue(value)) continue;
    const prepared: SpecItem = {
      ...original,
      group,
      name,
      value,
      unit: normalizeExistingUnit(name, value, inferMissingUnit(name, value, unit)),
    };
    if (MEASURABLE_NAME_RE.test(name) && !BOOLEAN_ALLOWED_NAME_RE.test(name) && !isConcreteValue(value)) {
      prepared._warning = 'Требуется более конкретное и проверяемое значение';
    }
    const key = `${normalizeSpecKey(group)}::${normalizeSpecKey(name)}`;
    const prev = bucket.get(key);
    if (!prev) {
      bucket.set(key, prepared);
      orderedKeys.push(key);
      continue;
    }
    if (inferSpecStrength(prepared) > inferSpecStrength(prev)) {
      bucket.set(key, prepared);
    }
  }

  const normalized = orderedKeys.map((key) => bucket.get(key)!).filter(Boolean);

  if (SOFTWARE_TYPE_KEYS.has(row.type)) {
    const names = new Set(normalized.map((spec) => normalizeSpecKey(String(spec.name || ''))));
    if (!names.has('тип лицензии') && row.licenseType) {
      normalized.unshift({
        group: 'Лицензирование',
        name: 'Тип лицензии',
        value: row.licenseType,
        unit: 'тип',
      });
    }
    if (!names.has('срок действия лицензии') && row.term) {
      normalized.unshift({
        group: 'Лицензирование',
        name: 'Срок действия лицензии',
        value: row.term,
        unit: 'срок',
      });
    }
  }

  return normalized;
}

export type AntiFasAutoFix = {
  rowId: number;
  specIdx: number;
  field: 'name' | 'value';
  oldText: string;
  newText: string;
  reason: string;
};

export function buildAntiFasAutoFixes(rows: RowForCompliance[]): AntiFasAutoFix[] {
  const fixes: AntiFasAutoFix[] = [];
  for (const row of rows) {
    if (row.status !== 'done' || !Array.isArray(row.specs)) continue;
    for (let specIdx = 0; specIdx < row.specs.length; specIdx++) {
      const spec = row.specs[specIdx];
      const name = String(spec.name || '');
      const value = String(spec.value || '');
      const text = `${name} ${value}`.trim();
      if (!text) continue;

      if (IDENTITY_SPEC_NAME_RE.test(name)) {
        fixes.push({
          rowId: row.id,
          specIdx,
          field: 'name',
          oldText: name,
          newText: '',
          reason: 'Удалена характеристика-идентификатор (модель/бренд/артикул)',
        });
        continue;
      }

      if (INTERNAL_WORKFLOW_RE.test(name) || INTERNAL_WORKFLOW_RE.test(value)) {
        fixes.push({
          rowId: row.id,
          specIdx,
          field: 'name',
          oldText: name,
          newText: '',
          reason: 'Удалена служебная/системная характеристика',
        });
        continue;
      }

      if (FOREIGN_MARKETING_RE.test(name) || FOREIGN_MARKETING_RE.test(value)) {
        fixes.push({
          rowId: row.id,
          specIdx,
          field: 'name',
          oldText: name,
          newText: '',
          reason: 'Удалена характеристика с иностранным маркетинговым текстом',
        });
        continue;
      }

      if (STRICT_WEAK_VALUE_RE.test(value)) {
        fixes.push({
          rowId: row.id,
          specIdx,
          field: 'name',
          oldText: name,
          newText: '',
          reason: 'Удалена характеристика с размытой/недопустимой формулировкой значения',
        });
        continue;
      }

      if (LOW_SIGNAL_EXPORT_VALUE_RE.test(value)) {
        fixes.push({
          rowId: row.id,
          specIdx,
          field: 'name',
          oldText: name,
          newText: '',
          reason: 'Удалена характеристика с низкоинформативным значением',
        });
        continue;
      }

      const textNoStd = text.replace(TECH_STANDARD_WHITELIST, '___').trim();
      if (BRAND_RE.test(textNoStd) && !/или\s+эквивалент/i.test(value)) {
        const cleanValue = value.replace(BRAND_RE, '').replace(/\s{2,}/g, ' ').trim();
        if (cleanValue) {
          fixes.push({
            rowId: row.id,
            specIdx,
            field: 'value',
            oldText: value,
            newText: cleanValue + ' или эквивалент',
            reason: 'Убрано упоминание бренда, добавлено «или эквивалент»',
          });
        } else {
          fixes.push({
            rowId: row.id,
            specIdx,
            field: 'value',
            oldText: value,
            newText: value + ' или эквивалент',
            reason: 'Добавлено «или эквивалент» к бренду',
          });
        }
      }

      const complianceResult = applyComplianceFixes(value);
      if (complianceResult.fixes.length > 0) {
        fixes.push({
          rowId: row.id,
          specIdx,
          field: 'value',
          oldText: value,
          newText: complianceResult.text,
          reason: complianceResult.fixes.map((f) => f.logMessage).join('; '),
        });
      }
      if (/\[!\]/.test(value) && !complianceResult.fixes.some((f) => f.ruleId === 'fas-placeholder')) {
        fixes.push({
          rowId: row.id,
          specIdx,
          field: 'value',
          oldText: value,
          newText: value.replace(/\s*\[!\]\s*[^\n]*/g, '').trim(),
          reason: 'Удалён системный маркер-плейсхолдер «[!]» из значения характеристики',
        });
      }

      if (OPERATOR_RE.test(value)) {
        const fixed = value
          .replace(/>=/g, 'не менее ')
          .replace(/<=/g, 'не более ')
          .replace(/>(?!=)/g, 'более ')
          .replace(/<(?!=)/g, 'менее ')
          .replace(/\s{2,}/g, ' ')
          .trim();
        if (fixed !== value) {
          fixes.push({
            rowId: row.id,
            specIdx,
            field: 'value',
            oldText: value,
            newText: fixed,
            reason: 'Операторы сравнения (>=, <=, >, <) заменены на «не менее»/«не более»',
          });
        }
      }

      if (/^\d{3,4}[xх×]\d{3,4}$/i.test(value.trim()) && !/не менее/i.test(value)) {
        fixes.push({
          rowId: row.id,
          specIdx,
          field: 'value',
          oldText: value,
          newText: 'не менее ' + value.trim(),
          reason: 'Точное разрешение заменено на формулировку «не менее»',
        });
      }

      const hasArticle = ARTICLE_RE.test(text);
      const hasModel = MODEL_WORD_RE.test(name);
      const allArticleCodesInValue = value.match(new RegExp(ARTICLE_CODE_RE.source, 'gi')) ?? [];
      const hasArticleCode = allArticleCodesInValue.length > 0 && allArticleCodesInValue.some((code) => !ARTICLE_CODE_WHITELIST.test(code));
      if (hasArticle || hasModel || hasArticleCode) {
        if (hasModel && !BRAND_RE.test(textNoStd)) {
          fixes.push({
            rowId: row.id,
            specIdx,
            field: 'name',
            oldText: name,
            newText: '',
            reason: 'Удалена характеристика с моделью/артикулом',
          });
        } else if (hasArticleCode) {
          let cleaned = value;
          for (const code of allArticleCodesInValue) {
            if (!ARTICLE_CODE_WHITELIST.test(code)) {
              cleaned = cleaned.replace(code, '');
            }
          }
          cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
          if (cleaned && cleaned !== value) {
            fixes.push({
              rowId: row.id,
              specIdx,
              field: 'value',
              oldText: value,
              newText: cleaned,
              reason: 'Удалён артикул/код из значения характеристики',
            });
          } else {
            fixes.push({
              rowId: row.id,
              specIdx,
              field: 'name',
              oldText: name,
              newText: '',
              reason: 'Удалена характеристика: значение является артикулом/кодом',
            });
          }
        } else if (hasArticle && /артикул|арт\./i.test(name)) {
          fixes.push({
            rowId: row.id,
            specIdx,
            field: 'name',
            oldText: name,
            newText: '',
            reason: 'Удалена характеристика-артикул по названию поля',
          });
        } else if (hasArticle && /артикул|арт\./i.test(value)) {
          const cleaned = value.replace(/\bарт\.?\s*\S*/gi, '').replace(/\s{2,}/g, ' ').trim();
          if (cleaned && cleaned !== value) {
            fixes.push({
              rowId: row.id,
              specIdx,
              field: 'value',
              oldText: value,
              newText: cleaned,
              reason: 'Удалена ссылка на артикул из значения характеристики',
            });
          }
        }
      }

      // Авто-фикс: характеристика с измеримым именем, но непроверяемым значением →
      // сначала пробуем добавить «или эквивалент» (сохраняет количество спек),
      // удаляем только если значение является явно слабым/пустым.
      if (
        MEASURABLE_NAME_RE.test(name) &&
        !BOOLEAN_ALLOWED_NAME_RE.test(name) &&
        !QUALITATIVE_ALLOWED_NAME_RE.test(name) &&
        !isConcreteValue(value) &&
        !isWeakStrictValue(value)
      ) {
        const alreadyScheduled = fixes.some(
          (f) => f.rowId === row.id && f.specIdx === specIdx
        );
        if (!alreadyScheduled) {
          // Если значение непустое и не является явно слабым — добавляем «или эквивалент»
          const trimmedValue = value.trim();
          if (trimmedValue && trimmedValue.length >= 2) {
            fixes.push({
              rowId: row.id,
              specIdx,
              field: 'value',
              oldText: value,
              newText: trimmedValue + ' или эквивалент',
              reason: 'Добавлено «или эквивалент» к непроверяемому значению измеримого параметра',
            });
          } else {
            fixes.push({
              rowId: row.id,
              specIdx,
              field: 'name',
              oldText: name,
              newText: '',
              reason: 'Удалена характеристика с пустым/непроверяемым значением',
            });
          }
        }
      }
    }

    // Авто-фикс: дублирующиеся имена → оставляем только лучшую копию
    const seenNames = new Map<string, number>();
    for (let specIdx = 0; specIdx < row.specs.length; specIdx++) {
      const spec = row.specs[specIdx];
      const key = normalizeSpecKey(String(spec.name || ''));
      if (!key) continue;
      const alreadyDeleted = fixes.some(
        (f) => f.rowId === row.id && f.specIdx === specIdx && f.field === 'name' && f.newText === ''
      );
      if (alreadyDeleted) continue;
      if (!seenNames.has(key)) {
        seenNames.set(key, specIdx);
        continue;
      }
      const bestIdx = seenNames.get(key)!;
      const bestSpec = row.specs[bestIdx];
      const thisStrength = inferSpecStrength(spec);
      const bestStrength = inferSpecStrength(bestSpec);
      const idxToRemove = thisStrength > bestStrength ? bestIdx : specIdx;
      if (thisStrength > bestStrength) seenNames.set(key, specIdx);
      const alreadyHasFix = fixes.some(
        (f) => f.rowId === row.id && f.specIdx === idxToRemove && f.field === 'name' && f.newText === ''
      );
      if (!alreadyHasFix) {
        fixes.push({
          rowId: row.id,
          specIdx: idxToRemove,
          field: 'name',
          oldText: String(row.specs[idxToRemove].name || ''),
          newText: '',
          reason: 'Удалён дублирующийся параметр (оставлена наиболее конкретная формулировка)',
        });
      }
    }
  }
  return fixes;
}

export function buildAntiFasReport(rows: RowForCompliance[], minScore = 85): ComplianceReport {
  const issues: ComplianceIssue[] = [];
  for (const row of rows) {
    if (row.status !== 'done' || !Array.isArray(row.specs)) continue;
    const duplicateNames = new Map<string, number>();
    let weakValues = 0;

    for (const spec of row.specs) {
      const specName = normalizeSpecKey(String(spec.name || ''));
      if (specName) {
        duplicateNames.set(specName, (duplicateNames.get(specName) || 0) + 1);
      }
      if (isWeakStrictValue(String(spec.value || ''))) weakValues += 1;
      if (
        MEASURABLE_NAME_RE.test(String(spec.name || '')) &&
        !BOOLEAN_ALLOWED_NAME_RE.test(String(spec.name || '')) &&
        !QUALITATIVE_ALLOWED_NAME_RE.test(String(spec.name || '')) &&
        !isConcreteValue(String(spec.value || ''))
      ) {
        addIssue(
          issues,
          row,
          spec,
          'major',
          'Непроверяемое или недостаточно конкретное значение характеристики.',
          'Замените общую формулировку на конкретный измеримый параметр или однозначное условие.'
        );
      }
      if (
        /\d/.test(String(spec.value || '')) &&
        (!String(spec.unit || '').trim() || String(spec.unit || '').trim() === '—') &&
        MEASURABLE_NAME_RE.test(String(spec.name || ''))
      ) {
        addIssue(
          issues,
          row,
          spec,
          'minor',
          'Числовое значение указано без единицы измерения.',
          'Укажите единицу измерения характеристики.'
        );
      }
      const combinedText = `${spec.name || ''} ${spec.value || ''}`;
      for (const fp of FORBIDDEN_PHRASES) {
        if (fp.re.test(combinedText)) {
          addIssue(issues, row, spec, fp.severity, fp.reason, fp.recommendation);
        }
      }
    }

    for (const [name, count] of duplicateNames) {
      if (count > 1) {
        addIssue(
          issues,
          row,
          { name, value: String(count), unit: '' },
          'major',
          'Обнаружены дублирующиеся характеристики.',
          'Оставьте одну самую точную формулировку для каждой характеристики.'
        );
      }
    }

    if (typeof row.strictMinSpecs === 'number' && row.specs.length < row.strictMinSpecs) {
      addIssue(
        issues,
        row,
        { name: 'Количество характеристик', value: String(row.specs.length), unit: 'шт' },
        'major',
        'Текущий набор характеристик короче рекомендуемого строгого шаблона.',
        `Доведите количество характеристик как минимум до ${row.strictMinSpecs}.`
      );
    }

    if (row.specs.length > 0 && weakValues / row.specs.length > 0.2) {
      addIssue(
        issues,
        row,
        { name: 'Размытые характеристики', value: `${weakValues} из ${row.specs.length}`, unit: 'шт' },
        'major',
        'Слишком много размытых или формальных характеристик.',
        'Замените общие формулировки на конкретные проверяемые параметры.'
      );
    }

    if (SOFTWARE_TYPE_KEYS.has(row.type)) {
      const names = new Set(row.specs.map((spec) => normalizeSpecKey(String(spec.name || ''))));
      if (!names.has('тип лицензии')) {
        addIssue(
          issues,
          row,
          { name: 'Тип лицензии', value: row.licenseType || '', unit: '' },
          'major',
          'Для программного обеспечения отсутствует явная характеристика типа лицензии.',
          'Добавьте характеристику «Тип лицензии» с конкретным значением.'
        );
      }
      if (![...names].some((name) => name.includes('срок действия лицензии') || name.includes('срок действия') || name.includes('срок поддержки'))) {
        addIssue(
          issues,
          row,
          { name: 'Срок действия', value: row.term || '', unit: '' },
          'major',
          'Для программного обеспечения отсутствует явная характеристика срока действия лицензии или поддержки.',
          'Добавьте характеристику срока действия лицензии или сертификата технической поддержки.'
        );
      }
    }

    for (const spec of row.specs) {
      const name = String(spec.name || '');
      const value = String(spec.value || '');
      const text = `${name} ${value}`.trim();
      if (!text) continue;

      // Strip whitelisted tech standards before brand check
      const textNoStd = text.replace(TECH_STANDARD_WHITELIST, '___').trim();
      if (BRAND_RE.test(textNoStd)) {
        // If value already contains "или эквивалент" — downgrade to minor (compliant with 44-ФЗ ст.33 ч.3)
        const hasEquiv = /или\s+эквивалент/i.test(value);
        addIssue(
          issues,
          row,
          spec,
          hasEquiv ? 'minor' : 'critical',
          hasEquiv
            ? 'Упоминание торговой марки с «или эквивалент» — допустимо по ч. 3 ст. 33 44-ФЗ.'
            : 'Обнаружено упоминание торговой марки/производителя.',
          hasEquiv
            ? 'Проверьте, что функциональные требования описаны достаточно для обеспечения конкуренции.'
            : 'Замените на функциональные характеристики и формулировку «без указания товарного знака (эквивалент)».'
        );
      }

      // Check for article/model — but skip whitelisted tech codes like RJ-45, Cat-6, H-264
      const hasArticle = ARTICLE_RE.test(text);
      const hasModel = MODEL_WORD_RE.test(name);
      const allArticleCodes = value.match(new RegExp(ARTICLE_CODE_RE.source, 'gi')) ?? [];
      const hasArticleCode = allArticleCodes.length > 0 && allArticleCodes.some((code) => !ARTICLE_CODE_WHITELIST.test(code));
      if (hasArticle || hasModel || hasArticleCode) {
        addIssue(
          issues,
          row,
          spec,
          'critical',
          'Обнаружен риск указания модели/артикула.',
          'Удалите модель/артикул. Оставьте только измеримые требования к характеристикам.'
        );
      }

      if (OPERATOR_RE.test(value)) {
        addIssue(
          issues,
          row,
          spec,
          'minor',
          'Найдены операторы сравнения в техническом значении.',
          'Рекомендуется использовать формулировки «не менее / не более» вместо знаков сравнения.'
        );
      }

      if (/^\d{3,4}[xх×]\d{3,4}$/i.test(value.trim())) {
        addIssue(
          issues,
          row,
          spec,
          'minor',
          'Точное разрешение может ограничивать конкуренцию.',
          'Используйте формулировку вида «не менее 1920x1080».'
        );
      }
    }
  }

  const critical = issues.filter((x) => x.severity === 'critical').length;
  const major = issues.filter((x) => x.severity === 'major').length;
  const minor = issues.filter((x) => x.severity === 'minor').length;

  // Считаем оценку как среднее по строкам: каждая строка оценивается отдельно,
  // итог — среднее арифметическое. Это устраняет накопительный штраф при большом числе позиций.
  const doneRowIds = rows
    .filter((r) => r.status === 'done' && Array.isArray(r.specs) && (r.specs?.length ?? 0) > 0)
    .map((r) => r.id);
  let score: number;
  if (doneRowIds.length === 0) {
    score = 100;
  } else {
    let rowScoreSum = 0;
    for (const rowId of doneRowIds) {
      const ri = issues.filter((x) => x.rowId === rowId);
      const rc = ri.filter((x) => x.severity === 'critical').length;
      const rm = ri.filter((x) => x.severity === 'major').length;
      const rn = ri.filter((x) => x.severity === 'minor').length;
      rowScoreSum += Math.max(0, 100 - rc * 22 - rm * 8 - rn * 1);
    }
    score = Math.round(rowScoreSum / doneRowIds.length);
  }

  const blocked = critical > 0 || score < minScore;

  return {
    generatedAt: new Date().toISOString(),
    score,
    minScore,
    critical,
    major,
    minor,
    blocked,
    issues,
  };
}
