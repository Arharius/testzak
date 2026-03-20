import type { SpecItem } from './spec-processor';

export type EquivVendor = {
  name: string;
  model: string;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
};

export type DoubleEquivResult = {
  status: 'ok' | 'warn' | 'widened';
  vendors: EquivVendor[];
  widened: string[];
  message: string;
  score: number;
};

type Provider = 'openrouter' | 'groq' | 'deepseek';

const API_ENDPOINTS: Record<Provider, string> = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
};

function buildSpecSummary(specs: SpecItem[]): string {
  return specs
    .slice(0, 30)
    .map((s) => `${s.group ? s.group + ' / ' : ''}${s.name}: ${s.value}${s.unit && s.unit !== '—' ? ' ' + s.unit : ''}`)
    .join('\n');
}

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { /* */ }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* */ }
  }
  return null;
}

export async function runDoubleEquivalentCheck(
  modelQuery: string,
  specs: SpecItem[],
  provider: Provider,
  apiKey: string,
  aiModel: string,
): Promise<DoubleEquivResult> {
  const endpoint = API_ENDPOINTS[provider];
  if (!apiKey) {
    return { status: 'warn', vendors: [], widened: [], message: 'API-ключ не задан', score: 0 };
  }
  if (!specs || specs.length === 0) {
    return { status: 'warn', vendors: [], widened: [], message: 'Нет характеристик для проверки', score: 0 };
  }

  const specSummary = buildSpecSummary(specs);

  const systemPrompt = `Ты эксперт по государственным закупкам (44-ФЗ, 223-ФЗ) и ИТ-оборудованию. Твоя задача — обеспечить принцип "Двойного эквивалента": техническое задание должно допускать как минимум ДВУХ разных производителей.

ПРАВИЛА:
1. Проанализируй характеристики
2. Найди минимум 2 разных производителя (не одного бренда), чьи продукты удовлетворяют этим характеристикам
3. Если характеристики слишком специфичны и допускают только 1 производителя — предложи расширить диапазоны
4. Отвечай ТОЛЬКО валидным JSON без пояснений`;

  const userPrompt = `Запрос заказчика: "${modelQuery}"

Технические характеристики:
${specSummary}

Определи, сколько производителей удовлетворяют этим характеристикам. Найди минимум 2 конкурирующих производителя.
Если только 1 производитель подходит — укажи, какие параметры нужно расширить (сделать "не менее X" вместо фиксированного значения).

Верни JSON строго в формате:
{
  "vendors": [
    {"name": "Производитель 1", "model": "Конкретная модель", "confidence": "high|medium|low", "notes": "пояснение"},
    {"name": "Производитель 2", "model": "Конкретная модель", "confidence": "high|medium|low", "notes": "пояснение"}
  ],
  "widened": ["Параметр 1: изменить с X на не менее X", "..."],
  "status": "ok|warn|widened",
  "message": "Краткое описание результата"
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
        temperature: 0.1,
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const parsed = extractJson(raw) as {
      vendors?: EquivVendor[];
      widened?: string[];
      status?: string;
      message?: string;
    } | null;

    if (!parsed) {
      return { status: 'warn', vendors: [], widened: [], message: 'Не удалось разобрать ответ ИИ', score: 0 };
    }

    const vendors: EquivVendor[] = Array.isArray(parsed.vendors) ? parsed.vendors.slice(0, 8) : [];
    const widened: string[] = Array.isArray(parsed.widened) ? parsed.widened : [];
    const rawStatus = String(parsed.status || '');
    const status: DoubleEquivResult['status'] =
      rawStatus === 'ok' ? 'ok' : rawStatus === 'widened' ? 'widened' : 'warn';
    const message = String(parsed.message || '');
    const highCount = vendors.filter((v) => v.confidence === 'high').length;
    const score = vendors.length >= 2 ? (highCount >= 2 ? 100 : 75) : vendors.length === 1 ? 40 : 0;

    return { status, vendors, widened, message, score };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'warn', vendors: [], widened: [], message: `Ошибка проверки: ${msg}`, score: 0 };
  }
}

export function widenSpecsForDoubleEquiv(specs: SpecItem[], widenedHints: string[]): SpecItem[] {
  if (!widenedHints || widenedHints.length === 0) return specs;
  return specs.map((spec) => {
    const nameLower = String(spec.name || '').toLowerCase();
    const val = String(spec.value || '');
    const hint = widenedHints.find((h) => {
      const hLower = h.toLowerCase();
      return nameLower && hLower.includes(nameLower.substring(0, Math.min(nameLower.length, 12)));
    });
    if (!hint) return spec;
    if (/не менее|не более/.test(val)) return spec;
    const numMatch = val.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (numMatch) {
      return { ...spec, value: `не менее ${numMatch[1]}${numMatch[2] ? ' ' + numMatch[2] : ''}`, _fixed: true };
    }
    return spec;
  });
}
