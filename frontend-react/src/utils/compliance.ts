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
  specs?: SpecItem[];
};

const BRAND_RE = /\b(Intel|AMD|Nvidia|Samsung|Micron|Kingston|WD|Western\s+Digital|Seagate|Toshiba|Qualcomm|Broadcom|Realtek|Marvell|Mellanox|Hynix|SK\s*Hynix|Lenovo|Huawei|Cisco|Dell|Acer|Asus|Apple|MSI|Gigabyte|Supermicro|HP|HPE|TP-?Link|D-?Link|Juniper|Aruba|ZTE|Hikvision|Dahua|Canon|Epson|Ricoh|Kyocera|Brother|Xerox|Pantum|LG|BenQ|ViewSonic|AOC|iiyama|Logitech|Jabra|Plantronics|Poly|Synology|QNAP|NetApp|MikroTik|Ubiquiti|Zyxel|Eltex|APC|Eaton|Vertiv|Noctua|Corsair|be\s*quiet|Chieftec|Thermaltake|Cooler\s*Master|DeepCool|Интел|Самсунг|Леново|Хуавей|Делл|Кэнон|Эпсон)\b/i;
const ARTICLE_RE = /\b(артикул|арт\.?|part\s*number|p\/n|pn)\b/i;
const MODEL_WORD_RE = /\b(модель|model)\b/i;
const ARTICLE_CODE_RE = /\b[A-ZА-Я]{1,6}-\d{2,8}[A-ZА-Я0-9-]*\b/;
const OPERATOR_RE = /(>=|<=|>|<)/;

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

export function buildAntiFasReport(rows: RowForCompliance[], minScore = 85): ComplianceReport {
  const issues: ComplianceIssue[] = [];
  for (const row of rows) {
    if (row.status !== 'done' || !Array.isArray(row.specs)) continue;
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
