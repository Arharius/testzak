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

type Provider = 'openrouter' | 'groq' | 'deepseek' | 'gigachat';

const API_ENDPOINTS: Record<Provider, string> = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  gigachat: 'gigachat-sdk',
};

function buildSpecSummary(specs: SpecItem[]): string {
  return specs
    .slice(0, 40)
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

const DE_SYSTEM_PROMPT = `Ты — старший юрист-эксперт по государственным закупкам РФ (44-ФЗ, 223-ФЗ) и эксперт по ИТ-рынку.
Твоя специализация — проверка соответствия технических заданий принципу "Двойного эквивалента" ФАС РФ.

ЗАДАЧА: Для каждого ТЗ выявить минимум ДВУХ конкурирующих производителей, чьи реально существующие продукты соответствуют заданным характеристикам.

АЛГОРИТМ:
1. Прочитай характеристики внимательно
2. Определи класс товара (ноутбук, сервер, коммутатор, МФУ, ПО и т.д.)
3. Найди ≥2 конкретных модели от разных производителей, которые соответствуют ВСЕМ числовым требованиям
4. Если нашёл только 1 производителя — укажи, какие параметры слишком специфичны и предложи расширение
5. Оцени каждого производителя: high (точное соответствие), medium (соответствие с небольшим запасом), low (условное соответствие)

ПРАВИЛО УВЕРЕННОСТИ:
- high: продукт этого вендора точно соответствует всем параметрам
- medium: соответствует большинству параметров, небольшие отклонения в пределах ±10%
- low: соответствует ключевым параметрам, но есть расхождения

Отвечай ТОЛЬКО валидным JSON строго по шаблону.`;

export async function runDoubleEquivalentCheck(
  modelQuery: string,
  specs: SpecItem[],
  provider: Provider,
  apiKey: string,
  aiModel: string,
  backendGenerator?: (provider: string, model: string, messages: { role: string; content: string }[]) => Promise<string>,
): Promise<DoubleEquivResult> {
  if (!specs || specs.length === 0) {
    return { status: 'warn', vendors: [], widened: [], message: 'Нет характеристик для проверки', score: 0 };
  }

  const specSummary = buildSpecSummary(specs);

  const userPrompt = `Запрос заказчика: "${modelQuery}"

Технические характеристики из ТЗ (${specs.length} параметров):
${specSummary}

Проверь по принципу "Двойного эквивалента":
1. Найди ≥2 конкурирующих производителя с реальными моделями, удовлетворяющими этим характеристикам
2. Если характеристики допускают только 1 производителя — укажи конкретные параметры для расширения
3. Рассчитай итоговый статус: "ok" (≥2 производителя, все high/medium), "widened" (нужно расширение), "warn" (критические проблемы)

Ответ СТРОГО в JSON (без markdown, без комментариев):
{
  "vendors": [
    {"name": "Производитель 1", "model": "Конкретная модель", "confidence": "high", "notes": "краткое пояснение"},
    {"name": "Производитель 2", "model": "Конкретная модель", "confidence": "medium", "notes": "краткое пояснение"}
  ],
  "widened": ["Параметр X: заменить 'ровно N' на 'не менее N' — тогда подойдут 3+ производителя"],
  "status": "ok",
  "message": "ТЗ соответствует принципу двойного эквивалента. Выявлены: Производитель1 Модель1 и Производитель2 Модель2."
}`;

  const messages = [
    { role: 'system', content: DE_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  let raw = '';
  try {
    if (backendGenerator) {
      raw = await backendGenerator(provider, aiModel, messages);
    } else if (apiKey) {
      const endpoint = API_ENDPOINTS[provider];
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };
      if (provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://openrouter.ai';
        headers['X-Title'] = 'TZ Generator React';
      }
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: aiModel, messages, temperature: 0.1, max_tokens: 1200 }),
        signal: AbortSignal.timeout(35000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      raw = data?.choices?.[0]?.message?.content || '';
    } else {
      return { status: 'warn', vendors: [], widened: [], message: 'Требуется подключение к backend для проверки эквивалентов', score: 0 };
    }

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
    const medCount = vendors.filter((v) => v.confidence === 'medium').length;
    const qualifiedCount = highCount + medCount;
    const score = vendors.length >= 2
      ? (qualifiedCount >= 2 ? (highCount >= 2 ? 100 : 85) : 65)
      : vendors.length === 1 ? 35 : 0;

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
