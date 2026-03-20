import type { SpecItem } from './spec-processor';

export type RowTrustTone = 'ready' | 'warn' | 'block' | 'neutral';

export type RowTrustPassportInput = {
  status: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
  specs?: SpecItem[];
  okpd2Code?: string;
  ktruCode?: string;
  classificationSourceKey?: string;
  classificationSourceLabel?: string;
  law175Label?: string;
  law175EvidenceText?: string;
  requiresManualReview?: boolean;
  expectExternalSource?: boolean;
  benchmark?: {
    label?: string;
    riskLevel: 'ok' | 'warn' | 'block';
    matched: number;
    changed: number;
    missing: number;
    added: number;
    contextPreview?: string;
  } | null;
  importInfo?: {
    sourceFormat?: string;
    confidence?: number;
    confidenceLabel?: string;
    needsReview?: boolean;
    ignoredBlocks?: number;
    sourcePreview?: string;
  } | null;
};

export type RowTrustFact = {
  tone: RowTrustTone;
  label: string;
  detail: string;
};

export type RowTrustPassport = {
  tone: RowTrustTone;
  title: string;
  summary: string;
  facts: RowTrustFact[];
};

const TONE_PRIORITY: Record<RowTrustTone, number> = {
  neutral: 0,
  ready: 1,
  warn: 2,
  block: 3,
};

function pickTone(left: RowTrustTone, right: RowTrustTone): RowTrustTone {
  return TONE_PRIORITY[right] > TONE_PRIORITY[left] ? right : left;
}

function normalizeText(value: string | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildGenerationFact(input: RowTrustPassportInput): RowTrustFact {
  if (input.status === 'error') {
    return {
      tone: 'block',
      label: 'Генерация',
      detail: `Строка завершилась ошибкой: ${normalizeText(input.error) || 'причина не определена'}.`,
    };
  }
  if (input.status === 'loading') {
    return {
      tone: 'neutral',
      label: 'Генерация',
      detail: 'Сервис ещё собирает характеристики для этой строки.',
    };
  }
  const specsCount = Array.isArray(input.specs) ? input.specs.length : 0;
  if (specsCount <= 0) {
    return {
      tone: 'warn',
      label: 'Генерация',
      detail: 'Характеристики ещё не сформированы. Строка не доведена до рабочего ТЗ.',
    };
  }
  return {
    tone: 'ready',
    label: 'Генерация',
    detail: `Сформировано характеристик: ${specsCount}.`,
  };
}

function buildClassificationFact(input: RowTrustPassportInput): RowTrustFact {
  const okpd2Code = normalizeText(input.okpd2Code);
  const ktruCode = normalizeText(input.ktruCode);
  const sourceKey = normalizeText(input.classificationSourceKey).toLowerCase();
  const sourceLabel = normalizeText(input.classificationSourceLabel) || 'источник не указан';

  if (!okpd2Code) {
    return {
      tone: 'block',
      label: 'Классификация',
      detail: 'ОКПД2 ещё не подтверждён. Такую строку рано пускать в публикационный контур.',
    };
  }

  if (input.requiresManualReview) {
    return {
      tone: 'warn',
      label: 'Классификация',
      detail: `ОКПД2 ${okpd2Code}${ktruCode ? `, КТРУ ${ktruCode}` : ''}. Источник: ${sourceLabel}. Перед публикацией нужна ручная верификация.`,
    };
  }

  if (sourceKey === 'catalog' || sourceKey === 'template' || sourceKey === 'catalog_fallback') {
    return {
      tone: 'ready',
      label: 'Классификация',
      detail: `ОКПД2 ${okpd2Code}${ktruCode ? `, КТРУ ${ktruCode}` : ''}. Позиция опирается на каталог / шаблон.`,
    };
  }

  if (sourceKey === 'eis') {
    return {
      tone: 'ready',
      label: 'Классификация',
      detail: `ОКПД2 ${okpd2Code}${ktruCode ? `, КТРУ ${ktruCode}` : ''}. Классификация подтверждена через ЕИС / КТРУ / площадки.`,
    };
  }

  if (sourceKey === 'docx_import' || sourceKey === 'import') {
    return {
      tone: 'warn',
      label: 'Классификация',
      detail: `ОКПД2 ${okpd2Code}${ktruCode ? `, КТРУ ${ktruCode}` : ''}. Классификация пришла из исходного файла и требует обычной проверки закупщиком.`,
    };
  }

  return {
    tone: 'warn',
    label: 'Классификация',
    detail: `ОКПД2 ${okpd2Code}${ktruCode ? `, КТРУ ${ktruCode}` : ''}. Источник: ${sourceLabel}. Это рабочий автоподбор, его лучше подтвердить перед публикацией.`,
  };
}

function buildLawFact(input: RowTrustPassportInput): RowTrustFact {
  const law175Label = normalizeText(input.law175Label) || 'не определено';
  const evidence = normalizeText(input.law175EvidenceText);
  return {
    tone: input.requiresManualReview ? 'warn' : 'ready',
    label: 'ПП1875 и документы',
    detail: evidence
      ? `Статус по ПП1875: ${law175Label}. Что приложить или проверить: ${evidence}.`
      : `Статус по ПП1875: ${law175Label}.`,
  };
}

function buildBenchmarkFact(input: RowTrustPassportInput): RowTrustFact {
  if (!input.expectExternalSource) {
    return {
      tone: 'neutral',
      label: 'Внешняя сверка',
      detail: 'Для этой строки внешняя сверка не является обязательным сигналом качества.',
    };
  }

  if (!input.benchmark) {
    return {
      tone: 'warn',
      label: 'Внешняя сверка',
      detail: 'Внешний источник ещё не сохранён. Для продажи и публикационной уверенности лучше подтвердить строку документом, ЕИС или сайтом производителя.',
    };
  }

  const label = normalizeText(input.benchmark.label) || 'внешний источник';
  const context = normalizeText(input.benchmark.contextPreview);
  if (input.benchmark.riskLevel === 'block') {
    return {
      tone: 'block',
      label: 'Внешняя сверка',
      detail: `${label}: есть существенные расхождения. Совпало ${input.benchmark.matched}, изменено ${input.benchmark.changed}, пропущено ${input.benchmark.missing}.${context ? ` Контекст: ${context}` : ''}`,
    };
  }

  if (input.benchmark.riskLevel === 'warn') {
    return {
      tone: 'warn',
      label: 'Внешняя сверка',
      detail: `${label}: источник найден, но сверка ещё не чистая. Совпало ${input.benchmark.matched}, изменено ${input.benchmark.changed}, пропущено ${input.benchmark.missing}.${context ? ` Контекст: ${context}` : ''}`,
    };
  }

  return {
    tone: 'ready',
    label: 'Внешняя сверка',
    detail: `${label}: критичных расхождений не видно. Совпало ${input.benchmark.matched}, изменено ${input.benchmark.changed}, пропущено ${input.benchmark.missing}.${context ? ` Контекст: ${context}` : ''}`,
  };
}

function buildImportFact(input: RowTrustPassportInput): RowTrustFact | null {
  if (!input.importInfo) return null;

  const sourceFormat = normalizeText(input.importInfo.sourceFormat).toUpperCase() || 'FILE';
  const confidence = typeof input.importInfo.confidence === 'number'
    ? Math.max(0, Math.round(input.importInfo.confidence * 100))
    : null;
  const confidenceLabel = normalizeText(input.importInfo.confidenceLabel);
  const sourcePreview = normalizeText(input.importInfo.sourcePreview);
  const ignoredBlocks = typeof input.importInfo.ignoredBlocks === 'number'
    ? input.importInfo.ignoredBlocks
    : 0;

  const detailParts = [
    `${sourceFormat}${confidence !== null ? `, уверенность ${confidence}%` : ''}${confidenceLabel ? ` (${confidenceLabel})` : ''}.`,
    ignoredBlocks > 0 ? `Отфильтровано служебных или нормативных блоков: ${ignoredBlocks}.` : '',
    sourcePreview ? `Фрагмент: ${sourcePreview}.` : '',
  ].filter(Boolean);

  return {
    tone: input.importInfo.needsReview ? 'warn' : 'ready',
    label: 'Исходный файл',
    detail: detailParts.join(' '),
  };
}

export function buildRowTrustPassport(input: RowTrustPassportInput): RowTrustPassport {
  const facts: RowTrustFact[] = [];
  let tone: RowTrustTone = 'neutral';

  const generationFact = buildGenerationFact(input);
  facts.push(generationFact);
  tone = pickTone(tone, generationFact.tone);

  const classificationFact = buildClassificationFact(input);
  facts.push(classificationFact);
  tone = pickTone(tone, classificationFact.tone);

  const lawFact = buildLawFact(input);
  facts.push(lawFact);
  tone = pickTone(tone, lawFact.tone);

  const benchmarkFact = buildBenchmarkFact(input);
  facts.push(benchmarkFact);
  tone = pickTone(tone, benchmarkFact.tone);

  const importFact = buildImportFact(input);
  if (importFact) {
    facts.push(importFact);
    tone = pickTone(tone, importFact.tone);
  }

  if (tone === 'block') {
    return {
      tone,
      title: 'Строка пока не готова к публикации',
      summary: 'Есть блокирующий риск: либо ошибка генерации, либо незавершённая классификация, либо существенное расхождение с внешним источником.',
      facts,
    };
  }

  if (tone === 'warn') {
    return {
      tone,
      title: 'Строка собрана, но требует точечной проверки',
      summary: 'Рабочее ТЗ уже есть, но перед экспортом и публикацией лучше подтвердить классификацию, источник или импортный контекст.',
      facts,
    };
  }

  if (tone === 'ready') {
    return {
      tone,
      title: 'Строка выглядит подтверждённой',
      summary: 'Классификация определена, характеристики собраны, а критичных сигналов риска сейчас не видно.',
      facts,
    };
  }

  return {
    tone,
    title: 'Строка ещё не обработана',
    summary: 'Сначала нужно сформировать характеристики и зафиксировать классификацию.',
    facts,
  };
}
