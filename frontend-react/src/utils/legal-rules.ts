import type { ComplianceSeverity } from './compliance';

export type LegalBlock =
  | 'fas'
  | 'pp1875'
  | '44fz'
  | '223fz';

export type RuleAction = 'replace' | 'assert' | 'require';

export interface ComplianceRule {
  id: string;
  block: LegalBlock;
  name: string;
  article?: string;
  severity: ComplianceSeverity;
  action: RuleAction;
  pattern: RegExp;
  replacement?: string;
  replaceFn?: (match: string, full: string) => string;
  reason: string;
  recommendation: string;
  logMessage: string;
}

export interface MandatoryClauseRule {
  id: string;
  block: LegalBlock;
  name: string;
  article?: string;
  severity: ComplianceSeverity;
  testFn: (fullText: string, context: { lawMode: string; hasSoftware: boolean; hasHardware: boolean }) => boolean;
  reason: string;
  recommendation: string;
  logMessage: string;
}

const FAS_RULES: ComplianceRule[] = [
  {
    id: 'fas-registry-extract',
    block: 'fas',
    name: 'Выписка из реестра',
    article: 'Практика ФАС — защита конкуренции',
    severity: 'critical',
    action: 'replace',
    pattern: /выписку?\s+(из\s+)?реестра\s+Минцифры(\s+России)?\s*(с\s+актуальным\s+регистрационным\s+номером\s+ПО)?/i,
    replacement: 'номер реестровой записи в Едином реестре российских программ',
    reason: 'ФАС запрещает требовать документы, которые есть в открытых реестрах. Требование «выписки из реестра Минцифры» ограничивает конкуренцию.',
    recommendation: 'Замените на «номер реестровой записи в Едином реестре российских программ».',
    logMessage: '[ФАС Compliance] Устранено ограничение конкуренции (выписка из реестра Минцифры)',
  },
  {
    id: 'fas-gisp-extract',
    block: 'fas',
    name: 'Выписка из ГИСП',
    article: 'Практика ФАС — защита конкуренции',
    severity: 'critical',
    action: 'replace',
    pattern: /выписку?\s+(из\s+)?ГИСП(\s+или\s+реестров(?:ая|ую)\s+запис[ьи])?/i,
    replacement: 'номера реестровых записей из реестра российской промышленной продукции или евразийского реестра промышленной продукции',
    reason: 'Требование «выписки из ГИСП» ограничивает нацрежим для оборудования: участник не обязан предоставлять выписку.',
    recommendation: 'Замените на «номера реестровых записей из реестра российской промышленной продукции или евразийского реестра промышленной продукции».',
    logMessage: '[ФАС Compliance] Устранено ограничение конкуренции (выписка из ГИСП)',
  },
  {
    id: 'fas-copy-registry',
    block: 'fas',
    name: 'Копия реестровой записи',
    article: 'Практика ФАС — защита конкуренции',
    severity: 'critical',
    action: 'replace',
    pattern: /копи[юя]\s+реестровой\s+записи/i,
    replacement: 'номер реестровой записи',
    reason: 'ФАС запрещает требовать копии документов, доступных в открытых реестрах.',
    recommendation: 'Замените на «номер реестровой записи».',
    logMessage: '[ФАС Compliance] Устранено ограничение конкуренции (копия реестровой записи)',
  },
  {
    id: 'fas-original-guarantee',
    block: 'fas',
    name: 'Оригинал гарантии',
    article: 'Практика ФАС — избыточные требования',
    severity: 'major',
    action: 'replace',
    pattern: /оригинал\s+документа[,.]?\s*подтверждающ(?:его|ий)\s+(?:предоставление\s+)?гаранти[юи]/i,
    replacement: 'документ (гарантийный талон, сертификат или иной документ), подтверждающий гарантийные обязательства',
    reason: 'ФАС признает избыточным требование оригинала от производителя.',
    recommendation: 'Замените на «документ, подтверждающий гарантийные обязательства».',
    logMessage: '[ФАС Compliance] Устранено избыточное требование (оригинал документа гарантии)',
  },
  {
    id: 'fas-original-document-generic',
    block: 'fas',
    name: 'Оригинал документа (общий)',
    article: 'Практика ФАС — избыточные требования',
    severity: 'major',
    action: 'replace',
    pattern: /оригинал\s+документа/i,
    replacement: 'документ (гарантийный талон, сертификат или иной документ), подтверждающий гарантийные обязательства',
    reason: 'Требование «оригинала документа» — избыточное формальное ограничение, сужающее конкуренцию.',
    recommendation: 'Замените на нейтральную формулировку без требования оригинала.',
    logMessage: '[ФАС Compliance] Устранено избыточное требование (оригинал документа)',
  },
  {
    id: 'fas-software-freshness',
    block: 'fas',
    name: 'Свежесть ПО',
    article: 'Практика ФАС — ограничение конкуренции по датам',
    severity: 'major',
    action: 'replace',
    pattern: /выпущен[аоы]?\s+не\s+ранее\s+чем\s+за\s+12\s*\([^)]*\)\s*месяцев?\s+до\s+даты\s+(?:поставки|подачи\s+заявки)/i,
    replacement: 'актуальная стабильная версия, официально поддерживаемая производителем на момент поставки',
    reason: 'Искусственное ограничение конкуренции по датам релизов ПО.',
    recommendation: 'Замените на «актуальная стабильная версия, официально поддерживаемая производителем».',
    logMessage: '[ФАС Compliance] Устранено ограничение конкуренции (свежесть ПО)',
  },
  {
    id: 'fas-freshness-short',
    block: 'fas',
    name: 'Свежесть ПО (краткая)',
    article: 'Практика ФАС — ограничение конкуренции по датам',
    severity: 'major',
    action: 'replace',
    pattern: /не\s+ранее\s+чем\s+за\s+12\s+месяцев/i,
    replacement: 'актуальная стабильная версия, официально поддерживаемая производителем',
    reason: 'Ограничение по дате релиза может ограничивать конкуренцию (Приложение № 7).',
    recommendation: 'Замените на «актуальная стабильная версия, официально поддерживаемая производителем на момент поставки».',
    logMessage: '[ФАС Compliance] Устранено ограничение конкуренции (не ранее 12 мес.)',
  },
  {
    id: 'fas-ndv',
    block: 'fas',
    name: 'Контроль НДВ',
    article: 'ФСТЭК — устаревшая терминология',
    severity: 'critical',
    action: 'replace',
    pattern: /(?:по\s+)?контрол[юя]\s+отсутствия\s+(?:недекларированных\s+возможностей\s*\(НДВ\)|НДВ)/i,
    replacement: 'по требованиям к уровню доверия не ниже 4-го уровня',
    reason: 'Устаревшая терминология ФСТЭК: «контроль отсутствия НДВ» отменён с 2020 года.',
    recommendation: 'Замените на «требования к уровню доверия не ниже 4-го уровня».',
    logMessage: '[ФАС Compliance] Устранена устаревшая терминология ФСТЭК (НДВ)',
  },
  {
    id: 'fas-placeholder',
    block: '44fz',
    name: 'Плейсхолдер [!]',
    article: '44-ФЗ ст. 33 — объективность описания',
    severity: 'critical',
    action: 'assert',
    pattern: /\[!\]/,
    reason: 'Системный маркер-плейсхолдер «[!]» остался в финальном документе.',
    recommendation: 'Удалите маркер «[!]» и весь комментарий, оставив только содержательный текст характеристики.',
    logMessage: '[44-ФЗ Compliance] Обнаружен плейсхолдер [!] в финальном тексте',
  },
  {
    id: 'fas-brand-without-equiv',
    block: 'fas',
    name: 'Торговые марки без «или эквивалент»',
    article: '44-ФЗ ст. 33 ч. 3',
    severity: 'critical',
    action: 'replace',
    pattern: /\b(Astra\s+Linux|Termidesk|ALD\s+Pro|CommuniGate|Р7-Офис|МойОфис|Kaspersky|Лаборатори[ия]\s+Касперского|Dr\.?\s*Web|Vipnet|ViPNet|КриптоПро|InfoWatch|Континент|Secret\s+Net|Dallas\s+Lock|Код\s+Безопасности)\b/i,
    replaceFn: (_match, full) => {
      if (/или\s+эквивалент/i.test(full)) return full;
      return full + ' или эквивалент';
    },
    reason: 'Указание торговой марки без «или эквивалент» ограничивает конкуренцию.',
    recommendation: 'Добавьте «или эквивалент» после указания торговой марки или замените на функциональные характеристики.',
    logMessage: '[ФАС Compliance] Добавлено «или эквивалент» к торговой марке',
  },
];

const MANDATORY_CLAUSE_RULES: MandatoryClauseRule[] = [
  {
    id: 'pp1875-software-registry',
    block: 'pp1875',
    name: 'ПП РФ № 1875 — Реестр российского ПО',
    article: 'ПП РФ от 16.11.2015 № 1236',
    severity: 'major',
    testFn: (fullText, ctx) => {
      if (!ctx.hasSoftware) return true;
      return /[Ее]диный\s+реестр\s+росси[йи]ских\s+программ/i.test(fullText);
    },
    reason: 'Для закупки ПО обязательно наличие фразы о включении в Единый реестр российских программ (ПП РФ № 1875).',
    recommendation: 'Добавьте требование: «Программное обеспечение должно быть включено в Единый реестр российских программ для ЭВМ и баз данных».',
    logMessage: '[ПП1875 Compliance] Проверка наличия требования Единого реестра российского ПО',
  },
  {
    id: 'pp1875-hardware-registry',
    block: 'pp1875',
    name: 'ПП РФ № 1875 — Реестр промышленной продукции',
    article: 'ПП РФ от 17.07.2015 № 719',
    severity: 'major',
    testFn: (fullText, ctx) => {
      if (!ctx.hasHardware) return true;
      return /реестр[аеу]?\s+росси[йи]ской\s+промышленной\s+продукции|евразийского\s+реестра/i.test(fullText);
    },
    reason: 'Для закупки оборудования (радиоэлектроника) обязательно упоминание реестра российской промышленной продукции или евразийского реестра (ПП РФ № 1875).',
    recommendation: 'Добавьте требование: «из реестра российской промышленной продукции или евразийского реестра промышленной продукции».',
    logMessage: '[ПП1875 Compliance] Проверка наличия требования реестра промышленной продукции',
  },
  {
    id: '44fz-fixed-price',
    block: '44fz',
    name: '44-ФЗ — Твёрдая цена',
    article: '44-ФЗ ст. 34',
    severity: 'minor',
    testFn: (fullText, ctx) => {
      if (ctx.lawMode !== '44') return true;
      return /[Цц]ена\s+[Дд]оговора\s+является\s+тв[её]рдой/i.test(fullText);
    },
    reason: 'По 44-ФЗ контракт должен содержать условие о твёрдой цене.',
    recommendation: 'Добавьте фразу: «Цена Договора является твёрдой и определяется на весь срок исполнения Договора».',
    logMessage: '[44-ФЗ Compliance] Проверка наличия условия о твёрдой цене',
  },
];

export const COMPLIANCE_RULES: ComplianceRule[] = [...FAS_RULES];

export const MANDATORY_CLAUSES: MandatoryClauseRule[] = [...MANDATORY_CLAUSE_RULES];

export function getDetectionRules(): Array<{ re: RegExp; severity: ComplianceSeverity; reason: string; recommendation: string }> {
  return COMPLIANCE_RULES
    .filter((r) => r.action === 'replace' || r.action === 'assert')
    .filter((r) => r.id !== 'fas-brand-without-equiv' && r.id !== 'fas-original-document-generic' && r.id !== 'fas-freshness-short' && r.id !== 'fas-copy-registry')
    .map((r) => ({
      re: r.pattern,
      severity: r.severity,
      reason: r.reason,
      recommendation: r.recommendation,
    }));
}

export type ComplianceFixResult = {
  ruleId: string;
  ruleName: string;
  block: LegalBlock;
  field: 'name' | 'value';
  oldText: string;
  newText: string;
  logMessage: string;
};

export function applyComplianceFixes(text: string): { text: string; fixes: ComplianceFixResult[] } {
  const fixes: ComplianceFixResult[] = [];
  let result = text;

  for (const rule of COMPLIANCE_RULES) {
    if (rule.action !== 'replace') continue;
    if (!rule.pattern.test(result)) continue;

    const oldText = result;
    if (rule.replaceFn) {
      result = rule.replaceFn(result.match(rule.pattern)?.[0] || '', result);
    } else if (rule.replacement) {
      result = result.replace(rule.pattern, rule.replacement);
    }

    if (result !== oldText) {
      fixes.push({
        ruleId: rule.id,
        ruleName: rule.name,
        block: rule.block,
        field: 'value',
        oldText,
        newText: result,
        logMessage: rule.logMessage,
      });
    }
  }

  return { text: result, fixes };
}

export function validateDocumentText(fullText: string, context: { lawMode: string; hasSoftware: boolean; hasHardware: boolean }): {
  violations: Array<{ ruleId: string; ruleName: string; block: LegalBlock; severity: ComplianceSeverity; reason: string; recommendation: string; logMessage: string }>;
  passed: Array<{ ruleId: string; ruleName: string; logMessage: string }>;
} {
  const violations: Array<{ ruleId: string; ruleName: string; block: LegalBlock; severity: ComplianceSeverity; reason: string; recommendation: string; logMessage: string }> = [];
  const passed: Array<{ ruleId: string; ruleName: string; logMessage: string }> = [];

  for (const rule of COMPLIANCE_RULES) {
    if (rule.action === 'assert' || rule.action === 'replace') {
      if (rule.pattern.test(fullText)) {
        violations.push({
          ruleId: rule.id,
          ruleName: rule.name,
          block: rule.block,
          severity: rule.severity,
          reason: rule.reason,
          recommendation: rule.recommendation,
          logMessage: rule.logMessage,
        });
        console.warn(rule.logMessage);
      }
    }
  }

  for (const clause of MANDATORY_CLAUSES) {
    const ok = clause.testFn(fullText, context);
    if (!ok) {
      violations.push({
        ruleId: clause.id,
        ruleName: clause.name,
        block: clause.block,
        severity: clause.severity,
        reason: clause.reason,
        recommendation: clause.recommendation,
        logMessage: clause.logMessage,
      });
      console.warn(`${clause.logMessage} — НЕ ПРОЙДЕНА`);
    } else {
      passed.push({
        ruleId: clause.id,
        ruleName: clause.name,
        logMessage: `${clause.logMessage} — ОК`,
      });
    }
  }

  return { violations, passed };
}

export function getRulesByBlock(block: LegalBlock): ComplianceRule[] {
  return COMPLIANCE_RULES.filter((r) => r.block === block);
}

export function getAllRulesSummary(): Array<{ id: string; block: LegalBlock; name: string; severity: ComplianceSeverity; action: RuleAction }> {
  return [
    ...COMPLIANCE_RULES.map((r) => ({ id: r.id, block: r.block, name: r.name, severity: r.severity, action: r.action })),
    ...MANDATORY_CLAUSES.map((r) => ({ id: r.id, block: r.block, name: r.name, severity: r.severity, action: 'require' as RuleAction })),
  ];
}
