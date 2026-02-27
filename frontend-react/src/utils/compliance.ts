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

const BRAND_RE = /\b(Intel|AMD|Nvidia|Samsung|Micron|Kingston|WD|Western\s+Digital|Seagate|Toshiba|Qualcomm|Broadcom|Realtek|Marvell|Mellanox|Hynix|SK\s*Hynix|Lenovo|Huawei|Cisco|Dell|Acer|Asus|Apple|MSI|Gigabyte|Supermicro|HP|HPE|Интел|Самсунг|Леново|Хуавей|Делл)\b/i;
const ARTICLE_RE = /\b(артикул|арт\.?|part\s*number|p\/n|pn)\b/i;
const MODEL_WORD_RE = /\b(модель|model)\b/i;
const ARTICLE_CODE_RE = /\b[A-ZА-Я]{1,6}-\d{2,8}[A-ZА-Я0-9-]*\b/;
const OPERATOR_RE = /(>=|<=|>|<)/;

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

      if (BRAND_RE.test(text)) {
        addIssue(
          issues,
          row,
          spec,
          'critical',
          'Обнаружено упоминание торговой марки/производителя.',
          'Замените на функциональные характеристики и формулировку «без указания товарного знака (эквивалент)».'
        );
      }

      if (ARTICLE_RE.test(text) || MODEL_WORD_RE.test(name) || ARTICLE_CODE_RE.test(value)) {
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
