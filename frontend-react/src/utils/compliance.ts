import type { SpecItem } from './spec-processor';

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
const ARTICLE_RE = /\b(артикул|арт\.?|part\s*number|p\/n|pn)\b/i;
const MODEL_WORD_RE = /\b(модель|model)\b/i;
const ARTICLE_CODE_RE = /\b[A-ZА-Я]{1,6}-\d{2,8}[A-ZА-Я0-9-]*\b/;
const OPERATOR_RE = /(>=|<=|>|<)/;
const STRICT_WEAK_VALUE_RE = /(по типу( товара| программного обеспечения)?|по назначению|в соответствии с технической документацией производителя( и требованиями заказчика)?|по условиям поставки и требованиям заказчика|актуальная поддерживаемая версия по документации производителя|в соответствии с требованиями заказчика|при необходимости|по описанию|по согласованию с заказчиком|типовая конфигурация|конкретное значение|согласно документации|согласно требованиям|или иное по требованию|или иное — по требованию|уточнить при необходимости)/i;
const GENERIC_NAME_RE = /^(функциональные возможности|технические характеристики|характеристики|параметры|описание|назначение|тип товара)$/i;
const MEASURABLE_NAME_RE = /(колич|объем|объ[её]м|емкост|[её]мкост|размер|ширин|высот|глубин|толщин|мощност|скорост|пропускн|частот|диагонал|разрешен|памят|ядер|поток|срок|верси|уров|класс|ресурс|масса|вес|длин|время реакции|время решения|порт|сокет|tbw|mtbf|iops)/i;
const BOOLEAN_ALLOWED_NAME_RE = /(наличие|поддержка|совместим|интеграц|журналир|аудит|веб-интерфейс|api|экспорт|импорт|консоль|кластеризац|резервн|ролевая модель|двухфактор|авторизац|аутентификац|шлюз|мониторинг|оповещени|доставка|доступ|управление|миграц|политик|сервис|средств|защит|шифрован|контроль|блокиров|регистрац|монтаж|развертыван|разв[её]ртыван|интерфейс|подключение|протокол|клиент|агент|диспетчер|маркировк|очистк|запуск|инструмент|графическ(ое|ие) средст)/i;
const QUALITATIVE_CONCRETE_VALUE_RE = /^(наличие|да|нет|монолитное|гибридное|электронная поставка|бессрочная|бессрочно|подписка|серверная|клиентская|конкурентная сессия|именованный пользователь|64-бит|x86_64)$/i;
const QUALITATIVE_ALLOWED_NAME_RE = /(тип ядра|тип лицензии|редакц|исполнени|уровень доверия|класс защиты|тип операционной системы|разрядность|носитель поставки|вариант поставки)/i;
const SOFTWARE_TYPE_KEYS = new Set([
  'os', 'office', 'virt', 'vdi', 'dbms', 'erp', 'cad', 'license', 'antivirus', 'edr', 'firewall_sw', 'dlp',
  'siem', 'crypto', 'waf', 'pam', 'iam', 'pki', 'email', 'vks', 'ecm', 'portal', 'project_sw', 'bpm',
  'backup_sw', 'itsm', 'monitoring', 'mdm', 'hr', 'gis', 'ldap', 'osSupport', 'supportCert', 'remoteAccessSw',
]);

// Whitelist: технические стандарты и интерфейсы, которые НЕ являются торговыми марками
const TECH_STANDARD_WHITELIST = /\b(RJ-?45|RJ-?11|RJ-?12|USB|HDMI|VGA|DVI|DP|DisplayPort|SFP|SFP\+|QSFP|QSFP\+|QSFP28|LC|SC|FC|ST|MTP|MPO|Cat\.?\s*[5-8][eaEA]?|UTP|FTP|STP|S\/FTP|PoE|PoE\+|DDR[2-5]|PCIe|PCI-?E|SATA|SAS|NVMe|M\.2|mSATA|SO-?DIMM|DIMM|ECC|LAN|WAN|IEEE\s*802\.\d+|Wi-?Fi\s*\d*[a-z]?|Bluetooth|BLE|Ethernet|GbE|10GbE|40GbE|100GbE|IPv[46]|TCP|UDP|HTTP[S]?|FTP|SNMP|SSH|SSL|TLS|AES|RSA|SHA|IPS|IDS|RAID|SSD|HDD|NAND|TLC|QLC|MLC|SLC|OLED|IPS|VA|TN|LED|LCD|ГГц|МГц|ГБ|МБ|ТБ|Вт|дБ|лк|кд|Гбит|Мбит)\b/i;

// Whitelist для ARTICLE_CODE_RE: разрешённые паттерны типа "RJ-45", "Cat-6", "USB-C"
const ARTICLE_CODE_WHITELIST = /^(RJ-?\d+|Cat-?\d+[eaEA]?|USB-?[A-C]|SFP-?\d*|DP-?\d*|Type-?[A-C])$/i;

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
    const value = expandGenericValue(name, String(original.value || '').replace(/\s+/g, ' ').trim());
    const unit = String(original.unit || '').replace(/\s+/g, ' ').trim();
    const group = String(original.group || 'Общие сведения').replace(/\s+/g, ' ').trim() || 'Общие сведения';
    if (!name || !value) continue;
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
        'critical',
        'Недостаточная детализация комплекта характеристик для строгого закупочного шаблона.',
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

      // Check for article/model — but skip whitelisted tech codes like RJ-45, Cat-6
      const hasArticle = ARTICLE_RE.test(text);
      const hasModel = MODEL_WORD_RE.test(name);
      const hasArticleCode = ARTICLE_CODE_RE.test(value) && !ARTICLE_CODE_WHITELIST.test(value.match(ARTICLE_CODE_RE)?.[0] ?? '');
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
          'major',
          'Найдены операторы сравнения в техническом значении.',
          'Используйте формулировки «не менее / не более» вместо знаков сравнения.'
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
  const score = Math.max(0, 100 - critical * 22 - major * 8 - minor * 3);
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
