import type { SpecItem } from './spec-processor';
import { generateWithBackend } from '../lib/backendApi';

export type VerifySeverity = 'critical' | 'warning';

export interface VerifyIssue {
  severity: VerifySeverity;
  specName: string;
  currentValue: string;
  suggestedFix: string;
  rule: string;
  autoFixed: boolean;
}

export interface VerifyResult {
  score: number;
  issues: VerifyIssue[];
  fixedSpecs: SpecItem[];
  readyForEis: boolean;
  criticalCount: number;
  warningCount: number;
  checkedAt: string;
  mode: 'ai' | 'rule-based';
}

const VERIFY_SYSTEM = `Ты — строгий ФАС-аудитор технических заданий (44-ФЗ, 223-ФЗ). Проверь список характеристик и выяви нарушения.

ПРАВИЛА ПРОВЕРКИ (строго):
1. РАСПЛЫВЧАТЫЕ ЗНАЧЕНИЯ [critical] — ст. 33 44-ФЗ: "по спецификации производителя", "согласно документации", "по требованию заказчика", "уточняется при поставке", "не хуже аналогов", "при необходимости", "по модели поставки", "по запросу", "по усмотрению", "в соответствии с требованиями", "согласно нормативам", "определяется производителем"
2. ПЛЕЙСХОЛДЕРЫ [critical] — в значении есть [указать...], [вписать...], [уточнить...], [наименование], [ФИО], [X]
3. МЕТА-ИНСТРУКЦИИ [critical] — в значении есть "Удалить эту строку", "Убрать позицию", "уже указано выше", "дублирование устранено"
4. ТОРП-СТРОКИ [critical] — имя характеристики "ТОРП" или "Требования к товарам российского происхождения" — это не характеристика товара
5. ГАРАНТИЯ ВТ [critical] — если имя содержит "гарантий" и тип товара ПК/системный блок/монитор/ноутбук/сервер/МФУ/принтер, то значение ДОЛЖНО быть ≥ 36 месяцев; если < 36 — критично
6. КОНКРЕТНЫЙ БРЕНД без "или эквивалент" [critical] — прямое упоминание модели в значении: "Intel Core i5-12500", "Samsung 870 EVO", "Kingston DDR4 16GB" (без слов "или эквивалент", "не менее")
7. АНГЛИЙСКИЙ ОПИСАТЕЛЬНЫЙ ТЕКСТ [warning] — описательный текст (не аббревиатуры) на английском длиннее 4 слов: "Fan Cooler for desktop", "up to 5600MHz SO-DIMMs"; аббревиатуры USB/SSD/NVMe/HDMI/IPS/DDR5 — OK
8. ИМПЕРСКИЕ ЕДИНИЦЫ [warning] — inch, lbs, ft, oz в значении (только мм, кг, Вт)

Отвечай СТРОГО в JSON, без пояснений, без markdown:
{"issues":[{"severity":"critical","spec_name":"имя характеристики","current_value":"текущее значение","suggested_fix":"конкретное исправление","rule":"название правила"}]}
Если нарушений нет — {"issues":[]}`;

function buildVerifyPrompt(specs: SpecItem[], goodsType: string): string {
  const lines = specs
    .filter(s => s.name && s.value)
    .slice(0, 40)
    .map((s, i) => `${i + 1}. "${s.name}" = "${s.value}"${s.unit ? ' ' + s.unit : ''}`)
    .join('\n');
  return `Тип товара: ${goodsType}\n\nХарактеристики:\n${lines}\n\nВерни JSON с нарушениями.`;
}

function parseVerifierResponse(raw: string): Array<{
  severity: string; spec_name: string; current_value: string; suggested_fix: string; rule: string;
}> {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (Array.isArray(parsed.issues)) return parsed.issues;
    return [];
  } catch {
    return [];
  }
}

function applyAutoFixes(specs: SpecItem[], issues: VerifyIssue[]): SpecItem[] {
  const fixable = new Map<string, VerifyIssue>();
  for (const issue of issues) {
    if (
      issue.severity === 'critical' &&
      issue.suggestedFix &&
      issue.suggestedFix.trim() &&
      !issue.suggestedFix.includes('[') &&
      !issue.suggestedFix.toLowerCase().includes('удалить') &&
      issue.specName
    ) {
      fixable.set(issue.specName.toLowerCase().trim(), issue);
    }
  }
  if (fixable.size === 0) return specs;

  return specs.map(spec => {
    const key = String(spec.name || '').toLowerCase().trim();
    const issue = fixable.get(key);
    if (!issue) return spec;
    return {
      ...spec,
      value: issue.suggestedFix,
      _warning: `[ИИ-аудитор исправил] ${issue.rule}: было "${issue.currentValue}"`,
      _fixed: true,
    };
  });
}

function calcScore(criticalRemaining: number, warningRemaining: number): number {
  return Math.max(0, Math.min(100, 100 - criticalRemaining * 15 - warningRemaining * 5));
}

export async function verifySpecsWithAI(
  specs: SpecItem[],
  goodsType: string,
  provider: string,
  model: string,
): Promise<VerifyResult> {
  const userPrompt = buildVerifyPrompt(specs, goodsType);

  let raw = '';
  let usedAi = false;
  try {
    raw = await generateWithBackend(
      provider,
      model,
      [
        { role: 'system', content: VERIFY_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      0.0,
      800,
      true,
    );
    usedAi = true;
  } catch (err) {
    console.warn('[verify] AI verification failed, falling back to rule-based:', err);
  }

  if (usedAi && raw.trim()) {
    const rawIssues = parseVerifierResponse(raw);
    const issues: VerifyIssue[] = rawIssues.map(ri => ({
      severity: ri.severity === 'critical' ? 'critical' : 'warning',
      specName: String(ri.spec_name || ''),
      currentValue: String(ri.current_value || ''),
      suggestedFix: String(ri.suggested_fix || ''),
      rule: String(ri.rule || ''),
      autoFixed: false,
    }));

    const fixedSpecs = applyAutoFixes(specs, issues);
    const fixedNames = new Set(
      fixedSpecs
        .filter(s => s._fixed)
        .map(s => String(s.name || '').toLowerCase().trim())
    );
    const finalIssues = issues.map(issue => ({
      ...issue,
      autoFixed: fixedNames.has(issue.specName.toLowerCase().trim()),
    }));

    const criticalRemaining = finalIssues.filter(i => i.severity === 'critical' && !i.autoFixed).length;
    const warningRemaining = finalIssues.filter(i => i.severity === 'warning' && !i.autoFixed).length;
    const score = calcScore(criticalRemaining, warningRemaining);

    return {
      score,
      issues: finalIssues,
      fixedSpecs,
      readyForEis: score >= 85 && criticalRemaining === 0,
      criticalCount: criticalRemaining,
      warningCount: warningRemaining,
      checkedAt: new Date().toISOString(),
      mode: 'ai',
    };
  }

  return ruleBasedVerify(specs, goodsType);
}

function ruleBasedVerify(specs: SpecItem[], goodsType: string): VerifyResult {
  const issues: VerifyIssue[] = [];
  const isVt = /пк|персональный компьютер|системный блок|монитор|ноутбук|сервер|мфу|принтер/i.test(goodsType);

  const VAGUE = [
    /по спецификации производителя/i,
    /согласно\s+(технической\s+)?документации/i,
    /по требованию заказчика/i,
    /уточняется при поставке/i,
    /не хуже аналогов/i,
    /при необходимости/i,
    /по модели поставки/i,
    /по запросу/i,
    /по усмотрению/i,
    /определяется производителем/i,
    /в соответствии с требованиями/i,
  ];
  const PLACEHOLDER = [
    /\[указать[^\]]*\]/i,
    /\[уточнить[^\]]*\]/i,
    /\[вписать[^\]]*\]/i,
    /\[заполнить[^\]]*\]/i,
    /\[наименование\]/i,
    /\[X\]/i,
  ];
  const META = [
    /^(удалить|убрать|исключить)\s+эту\s+строку/i,
    /уже\s+указано\s+выше/i,
    /дублирование\s+устранено/i,
  ];
  const IMPERIAL = /\b(inch|lbs?|pounds?|feet|foot|oz|ounces?)\b/i;

  for (const spec of specs) {
    const name = String(spec.name || '');
    const value = String(spec.value || '');

    if (/^ТОРП$/i.test(name) || /требование.+российского происхождения/i.test(name)) {
      issues.push({ severity: 'critical', specName: name, currentValue: value, suggestedFix: 'Удалить — ТОРП не является характеристикой товара', rule: 'ТОРП не в характеристиках', autoFixed: false });
      continue;
    }
    if (META.some(p => p.test(value))) {
      issues.push({ severity: 'critical', specName: name, currentValue: value, suggestedFix: 'Убрать мета-инструкцию или заменить реальным значением', rule: 'Мета-инструкция ИИ', autoFixed: false });
      continue;
    }
    if (PLACEHOLDER.some(p => p.test(value))) {
      issues.push({ severity: 'critical', specName: name, currentValue: value, suggestedFix: 'Заменить плейсхолдер на конкретное числовое значение', rule: 'Незакрытый плейсхолдер', autoFixed: false });
      continue;
    }
    if (VAGUE.some(p => p.test(value))) {
      issues.push({ severity: 'critical', specName: name, currentValue: value, suggestedFix: 'Указать конкретное числовое значение с единицей измерения', rule: 'ст. 33 44-ФЗ: расплывчатое значение', autoFixed: false });
    }
    if (/гарантий/i.test(name) && isVt) {
      const m = value.match(/(\d+)\s*мес/i);
      if (m && parseInt(m[1]) < 36) {
        issues.push({ severity: 'critical', specName: name, currentValue: value, suggestedFix: 'не менее 36 месяцев', rule: 'Гарантия ВТ ≥ 36 мес.', autoFixed: false });
      }
    }
    if (IMPERIAL.test(value)) {
      issues.push({ severity: 'warning', specName: name, currentValue: value, suggestedFix: 'Перевести в метрические единицы (мм, кг, Вт)', rule: 'Имперские единицы', autoFixed: false });
    }
  }

  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const score = calcScore(criticalCount, warningCount);

  return {
    score,
    issues,
    fixedSpecs: specs,
    readyForEis: score >= 85 && criticalCount === 0,
    criticalCount,
    warningCount,
    checkedAt: new Date().toISOString(),
    mode: 'rule-based',
  };
}
