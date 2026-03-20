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

type Provider = 'openrouter' | 'groq' | 'deepseek';

const API_ENDPOINTS: Record<Provider, string> = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
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
