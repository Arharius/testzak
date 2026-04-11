import type { SpecItem } from './spec-processor';

export type FetchSpecsSource = 'web' | 'ai_fallback' | 'none';

export type FetchedSpecs = {
  source: FetchSpecsSource;
  specs: SpecItem[];
  conflicts: SpecConflict[];
  verified: boolean;
  note?: string;
};

export type SpecConflict = {
  name: string;
  uploaded: string;
  verified: string;
  recommendation: string;
};

type Provider = 'openrouter' | 'groq' | 'deepseek' | 'gigachat';

const API_ENDPOINTS: Record<Provider, string> = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  gigachat: 'gigachat-sdk',
};

function extractJsonSpecs(raw: string): { specs: SpecItem[]; conflicts: SpecConflict[] } {
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    return {
      specs: Array.isArray(obj.specs) ? obj.specs : [],
      conflicts: Array.isArray(obj.conflicts) ? obj.conflicts : [],
    };
  } catch { /* */ }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      return {
        specs: Array.isArray(obj.specs) ? obj.specs : [],
        conflicts: Array.isArray(obj.conflicts) ? obj.conflicts : [],
      };
    } catch { /* */ }
  }
  return { specs: [], conflicts: [] };
}

export async function fetchSpecs(
  modelName: string,
  existingSpecs: SpecItem[],
  provider: Provider,
  apiKey: string,
  aiModel: string,
): Promise<FetchedSpecs> {
  if (!apiKey) {
    return { source: 'none', specs: existingSpecs, conflicts: [], verified: false, note: 'API-ключ не задан' };
  }
  if (!modelName.trim()) {
    return { source: 'none', specs: existingSpecs, conflicts: [], verified: false, note: 'Модель не указана' };
  }

  const endpoint = API_ENDPOINTS[provider];
  const existingSummary = existingSpecs.slice(0, 20)
    .map((s) => `- ${s.name}: ${s.value}${s.unit && s.unit !== '—' ? ' ' + s.unit : ''}`)
    .join('\n');

  const systemPrompt = `Ты эксперт по техническим характеристикам ИТ-оборудования и программного обеспечения. У тебя доступ к актуальным данным с сайтов производителей и официальным техническим листам (datasheets).

Твоя задача: верифицировать технические характеристики продукта и выявить расхождения с официальными данными.

ВАЖНО: 
- Используй только официальные данные производителя
- Укажи все существенные расхождения с загруженными характеристиками
- Предлагай юридически безопасные формулировки (44-ФЗ)
- Отвечай ТОЛЬКО валидным JSON`;

  const userPrompt = `Продукт: "${modelName}"

Имеющиеся характеристики (из загруженного документа):
${existingSummary || '(характеристики не загружены)'}

Задача:
1. Определи официальные технические характеристики "${modelName}" по данным производителя
2. Сравни с имеющимися характеристиками — найди конфликты/расхождения
3. Предложи откорректированный список характеристик, соответствующий официальным данным

Верни JSON в формате:
{
  "specs": [
    {"group": "Раздел", "name": "Название параметра", "value": "Значение (не менее X)", "unit": "Единица"}
  ],
  "conflicts": [
    {"name": "Параметр", "uploaded": "Значение из документа", "verified": "Официальное значение", "recommendation": "Юридически безопасная формулировка"}
  ]
}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://openrouter.ai';
    headers['X-Title'] = 'TZ Generator React';
  }

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: aiModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.05,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const { specs, conflicts } = extractJsonSpecs(raw);

    if (specs.length === 0) {
      return {
        source: 'ai_fallback',
        specs: existingSpecs,
        conflicts,
        verified: false,
        note: 'ИИ не вернул верифицированные характеристики',
      };
    }
    return { source: 'ai_fallback', specs, conflicts, verified: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      source: 'none',
      specs: existingSpecs,
      conflicts: [],
      verified: false,
      note: `Ошибка верификации: ${msg}`,
    };
  }
}

/**
 * Backend-powered spec verification using real web search (Serper.dev) + AI conflict analysis.
 * This is the production path when useBackendAi=true — no client API key needed.
 */
export async function fetchSpecsViaBackend(
  modelName: string,
  existingSpecs: SpecItem[],
  goodsType: string,
  backendGenerator: (provider: string, model: string, messages: { role: string; content: string }[]) => Promise<string>,
  aiProvider: string,
  aiModel: string,
  searchInternetFn: (product: string, goodsType: string) => Promise<Array<{ name: string; value: string; unit: string }>>,
): Promise<FetchedSpecs> {
  if (!modelName.trim()) {
    return { source: 'none', specs: existingSpecs, conflicts: [], verified: false, note: 'Модель не указана' };
  }

  try {
    const webSpecs = await searchInternetFn(modelName, goodsType);

    if (webSpecs.length === 0) {
      return {
        source: 'none',
        specs: existingSpecs,
        conflicts: [],
        verified: false,
        note: 'Интернет-поиск не вернул данных по модели',
      };
    }

    const existingSummary = existingSpecs.slice(0, 30)
      .map((s) => `- ${s.name}: ${s.value}${s.unit && s.unit !== '—' ? ' ' + s.unit : ''}`)
      .join('\n');

    const webSummary = webSpecs.slice(0, 30)
      .map((s) => `- ${s.name}: ${s.value}${s.unit && s.unit !== '—' ? ' ' + s.unit : ''}`)
      .join('\n');

    const conflictPrompt = `Продукт: "${modelName}"

Характеристики из документа заказчика:
${existingSummary || '(не загружены)'}

Официальные характеристики (из интернет-источников):
${webSummary}

Задача:
1. Сравни два набора характеристик
2. Найди все расхождения (значение отличается более чем на 5%)
3. Для каждого расхождения предложи юридически безопасную формулировку (44-ФЗ: «не менее X», «не более X», «или эквивалент»)
4. Если расхождений нет — вернуть пустой conflicts

Ответ ТОЛЬКО в JSON (без markdown):
{
  "conflicts": [
    {
      "name": "Название параметра",
      "uploaded": "Значение из документа",
      "verified": "Официальное значение (из интернета)",
      "recommendation": "Юридически безопасная формулировка для 44-ФЗ"
    }
  ]
}`;

    const raw = await backendGenerator(
      aiProvider,
      aiModel,
      [{ role: 'user', content: conflictPrompt }],
    );

    const { conflicts } = extractJsonSpecs(raw);

    const mergedSpecs: SpecItem[] = webSpecs.map((s) => ({
      group: '',
      name: s.name,
      value: s.value,
      unit: s.unit,
    }));

    return {
      source: 'web',
      specs: mergedSpecs.length > 0 ? mergedSpecs : existingSpecs,
      conflicts,
      verified: true,
      note: `Найдено ${webSpecs.length} характеристик из интернета, выявлено ${conflicts.length} расхождений`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      source: 'none',
      specs: existingSpecs,
      conflicts: [],
      verified: false,
      note: `Ошибка верификации через бэкенд: ${msg}`,
    };
  }
}
