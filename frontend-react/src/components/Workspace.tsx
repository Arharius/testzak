import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import {
  fetchOpenRouterModels,
  fetchOpenRouterModelsViaBackend,
  fetchPublicBillingReadiness,
  generateItemSpecs,
  postPlatformDraft,
  sendEventThroughBestChannel,
  type BillingReadiness
} from '../lib/api';
import { appendAutomationLog } from '../lib/storage';
import type { AutomationSettings, PlatformIntegrationSettings } from '../types/schemas';
import { buildTypeCandidates, detectTypeDetailed, type GoodsType } from '../lib/autodetect';

type Provider = 'openrouter' | 'groq' | 'deepseek';
type LawMode = '44' | '223';
const DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-reasoner'] as const;
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'] as const;

type Row = {
  id: number;
  type: GoodsType;
  typeLocked?: boolean;
  model: string;
  qty: number;
  status: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
  result?: string;
  okpd2?: string;
  ktru?: string;
  candidates?: Array<{ type: GoodsType; score: number; reason: string }>;
  lookupState?: 'idle' | 'loading' | 'done' | 'error' | 'choose';
  lookupNote?: string;
  internetHints?: string;
};

type ParsedSpec = { group: string; name: string; value: string; unit?: string };
type ParsedResult = {
  meta?: { okpd2_code?: string; ktru_code?: string; law175_status?: string; law175_basis?: string };
  specs?: ParsedSpec[];
};

const GOODS_LABELS: Record<GoodsType, string> = {
  pc: 'Системный блок',
  laptop: 'Ноутбук',
  monitor: 'Монитор',
  printer: 'Принтер',
  mfu: 'МФУ',
  server: 'Сервер',
  switch: 'Коммутатор',
  router: 'Маршрутизатор',
  cable: 'Кабель/витая пара',
  dvd: 'Оптический диск',
  software: 'Программное обеспечение'
};

function normalizeText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\s\n\r\t]+/g, ' ')
    .trim();
}

function cutText(text: string, maxLen: number): string {
  const s = String(text || '').trim();
  return s.length <= maxLen ? s : `${s.slice(0, maxLen)}...`;
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\/\S+/i.test(String(value || '').trim());
}

function isInsecureExternalHttp(url: string): boolean {
  try {
    const parsed = new URL(String(url || '').trim());
    if (parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return !(host === 'localhost' || host === '127.0.0.1' || host === '::1');
  } catch {
    return false;
  }
}

function parseJsonArrayFromText(text: string): Array<{ type: GoodsType; model?: string; reason?: string }> {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x === 'object' && typeof x.type === 'string' && x.type in GOODS_LABELS)
      .map((x) => ({
        type: x.type as GoodsType,
        model: typeof x.model === 'string' ? x.model : '',
        reason: typeof x.reason === 'string' ? x.reason : ''
      }));
  } catch {
    return [];
  }
}

function extractJsonObject(text: string): unknown | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // continue
  }
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // continue
    }
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function modelTokensForExactMatch(query: string): string[] {
  const parts = normalizeText(query)
    .split(' ')
    .map((x) => x.trim())
    .filter(Boolean);
  const strong = parts.filter((t) => t.length >= 3 && /[a-zа-я]/i.test(t));
  strong.sort((a, b) => {
    const aScore = (/\d/.test(a) ? 2 : 0) + a.length / 10;
    const bScore = (/\d/.test(b) ? 2 : 0) + b.length / 10;
    return bScore - aScore;
  });
  return strong.slice(0, 6);
}

function extractExactModelHints(query: string, rawText: string): string {
  const text = normalizeText(rawText);
  if (!text) return '';
  const tokens = modelTokensForExactMatch(query);
  if (!tokens.length) return cutText(text, 2500);

  const chunks = text
    .split(/[\n.;:!?]+/g)
    .map((x) => x.trim())
    .filter((x) => x.length >= 24);

  const scored = chunks.map((chunk) => {
    const matched = tokens.filter((t) => chunk.includes(t)).length;
    return { chunk, matched };
  });

  const strong = scored
    .filter((x) => x.matched >= Math.min(2, Math.max(1, Math.floor(tokens.length / 2))))
    .sort((a, b) => b.matched - a.matched)
    .slice(0, 14)
    .map((x) => x.chunk);

  if (strong.length) return cutText(strong.join(' ; '), 2500);
  return cutText(text, 2500);
}

async function fetchInternetHints(query: string): Promise<string> {
  const q = String(query || '').trim();
  if (!q) return '';

  if (looksLikeUrl(q)) {
    try {
      const target = q.replace(/^https?:\/\//i, '');
      const resp = await fetch(`https://r.jina.ai/http://${target}`, { method: 'GET' });
      if (resp.ok) {
        const raw = await resp.text();
        return extractExactModelHints(q, raw);
      }
    } catch {
      // ignore and fallback
    }
  }

  try {
    const ddg = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_redirect=1&no_html=1`;
    const resp = await fetch(ddg, { method: 'GET' });
    if (!resp.ok) return '';
    const data = (await resp.json()) as {
      Heading?: string;
      AbstractText?: string;
      RelatedTopics?: Array<{ Text?: string }>;
    };
    const parts: string[] = [];
    if (data?.Heading) parts.push(data.Heading);
    if (data?.AbstractText) parts.push(data.AbstractText);
    if (Array.isArray(data?.RelatedTopics)) {
      for (const topic of data.RelatedTopics.slice(0, 4)) {
        if (topic?.Text) parts.push(topic.Text);
      }
    }
    return extractExactModelHints(q, parts.join(' ; '));
  } catch {
    return '';
  }
}

function buildPrompt(row: Row, lawMode: LawMode): string {
  const goodsName = GOODS_LABELS[row.type];
  const law = lawMode === '223' ? '223-ФЗ' : '44-ФЗ';
  const hints = cutText(row.internetHints || '', 2500);
  return `Ты эксперт по госзакупкам РФ (${law}).\n` +
    `Сформируй технические характеристики для товара.\n` +
    `Тип: ${goodsName}\n` +
    `Модель/описание: ${row.model}\n` +
    `Количество: ${row.qty}\n` +
    (hints ? `Интернет-подсказки по КОНКРЕТНОЙ модели: ${hints}\n` : '') +
    `\n` +
    `Критично: не давай обобщенные характеристики категории. Используй именно данные этой модели.` +
    ` Если точного параметра нет, не выдумывай, укажи "не указано в источнике".\n\n` +
    `Ответ строго JSON:\n` +
    `{\n` +
    `  "meta": {\n` +
    `    "okpd2_code": "...",\n` +
    `    "okpd2_name": "...",\n` +
    `    "ktru_code": "...",\n` +
    `    "law175_status": "forbidden|exempt|allowed",\n` +
    `    "law175_basis": "ПП РФ № 1875 ..."\n` +
    `  },\n` +
    `  "specs": [\n` +
    `    {"group":"...","name":"...","value":"...","unit":"..."}\n` +
    `  ]\n` +
    `}`;
}

function parseMaybeJson(text: string): { pretty: string; okpd2: string; ktru: string } {
  const obj = extractJsonObject(text) as Record<string, any> | null;
  if (obj && typeof obj === 'object') {
    const pretty = JSON.stringify(obj, null, 2);
    return {
      pretty,
      okpd2: obj?.meta?.okpd2_code || '',
      ktru: obj?.meta?.ktru_code || ''
    };
  }
  return { pretty: text, okpd2: '', ktru: '' };
}

function parseResultObject(text?: string): ParsedResult | null {
  if (!text) return null;
  try {
    const parsed = extractJsonObject(text);
    const obj = parsed as ParsedResult | null;
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

function buildReadableResultBlock(jsonText: string): string {
  try {
    const parsed = extractJsonObject(jsonText);
    if (!parsed || typeof parsed !== 'object') return jsonText;
    const obj = parsed as ParsedResult;
    const specs = Array.isArray(obj?.specs) ? obj.specs : [];
    const meta = obj?.meta || {};
    const lines: string[] = [];
    lines.push(`ОКПД2: ${meta.okpd2_code || 'не указано'}`);
    lines.push(`КТРУ: ${meta.ktru_code || 'не указано'}`);
    lines.push(`ПП 1875: ${meta.law175_status || 'не указано'}${meta.law175_basis ? ` (${meta.law175_basis})` : ''}`);
    if (specs.length) {
      lines.push('Характеристики:');
      for (const s of specs.slice(0, 40)) {
        lines.push(`- ${s.group} / ${s.name}: ${s.value}${s.unit ? ` ${s.unit}` : ''}`);
      }
    }
    return lines.join('\n');
  } catch {
    return jsonText;
  }
}

function buildNormativeBlock(lawMode: LawMode): string {
  if (lawMode === '223') {
    return [
      'Закупка по 223-ФЗ.',
      'Проверка соответствия Положению о закупке заказчика обязательна.',
      'Нацрежим: ПП РФ № 1875 (актуальная редакция на дату публикации).',
      'Для ПО: учитывать правила реестров Минцифры/ЕАЭС.'
    ].join('\n');
  }
  return [
    'Закупка по 44-ФЗ.',
    'Ст. 33 44-ФЗ: при указании ТМ использовать формулировку «или эквивалент».',
    'Нацрежим: ПП РФ № 1875 (актуальная редакция на дату публикации).',
    'КТРУ/ОКПД2 подлежат проверке перед размещением в ЕИС.'
  ].join('\n');
}

type Props = {
  automationSettings: AutomationSettings;
  platformSettings: PlatformIntegrationSettings;
};

type PreflightIssue = {
  level: 'critical' | 'warn';
  message: string;
};

export function Workspace({ automationSettings, platformSettings }: Props) {
  const [lawMode, setLawMode] = useState<LawMode>('44');
  const [provider, setProvider] = useState<Provider>('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('deepseek-chat');
  const [openRouterModels, setOpenRouterModels] = useState<Array<{ id: string; name?: string; context_length?: number }>>([]);
  const [openRouterLoadedForKey, setOpenRouterLoadedForKey] = useState('');
  const [openRouterLoading, setOpenRouterLoading] = useState(false);
  const [openRouterError, setOpenRouterError] = useState('');
  const [billingReadiness, setBillingReadiness] = useState<BillingReadiness | null>(null);
  const [billingReadinessLoading, setBillingReadinessLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([{ id: 1, type: 'pc', typeLocked: false, model: '', qty: 1, status: 'idle' }]);
  const [tzText, setTzText] = useState('');
  const [bulkLookup, setBulkLookup] = useState(false);
  const [autopilotRunning, setAutopilotRunning] = useState(false);

  const preflight = useMemo(() => {
    const issues: PreflightIssue[] = [];
    if (apiKey.trim().length <= 6) {
      issues.push({ level: 'critical', message: 'Не задан API-ключ для генерации.' });
    }
    rows.forEach((row, idx) => {
      if (!row.model.trim()) {
        issues.push({ level: 'critical', message: `Строка #${idx + 1}: не указана модель/описание.` });
      }
      if (!Number.isFinite(row.qty) || row.qty < 1) {
        issues.push({ level: 'critical', message: `Строка #${idx + 1}: количество должно быть не менее 1.` });
      }
      if (!row.internetHints && row.model.trim().length >= 4) {
        issues.push({ level: 'warn', message: `Строка #${idx + 1}: рекомендуется подтянуть данные из интернета по конкретной модели.` });
      }
    });
    if (lawMode === '223' && !platformSettings.orgName.trim()) {
      issues.push({ level: 'warn', message: '223-ФЗ: заполните организацию заказчика.' });
    }
    if (automationSettings.billingEnabled && !automationSettings.tenantId.trim()) {
      issues.push({ level: 'warn', message: 'Billing telemetry: заполните Tenant ID.' });
    }
    if (billingReadiness && !billingReadiness.ready_for_checkout) {
      issues.push({ level: 'warn', message: 'YooKassa не готова к checkout: заполните env на backend.' });
    }
    if (platformSettings.autoSendDraft && !platformSettings.endpoint.trim()) {
      issues.push({ level: 'warn', message: 'Не задан endpoint коннектора ЕИС/ЭТП.' });
    }
    if (automationSettings.requireHttpsForIntegrations && isInsecureExternalHttp(platformSettings.endpoint)) {
      issues.push({ level: 'critical', message: 'Endpoint коннектора должен быть HTTPS (кроме localhost).' });
    }
    const critical = issues.filter((x) => x.level === 'critical').length;
    const warn = issues.filter((x) => x.level === 'warn').length;
    const score = Math.max(0, 100 - critical * 25 - warn * 8);
    return { issues, critical, warn, score };
  }, [
    apiKey,
    rows,
    lawMode,
    platformSettings.orgName,
    platformSettings.endpoint,
    automationSettings.requireHttpsForIntegrations,
    automationSettings.billingEnabled,
    automationSettings.tenantId,
    billingReadiness
  ]);

  const canGenerate = preflight.critical === 0;
  const openRouterKeySig = useMemo(() => {
    const clean = String(apiKey || '').trim().replace(/^Bearer\s+/i, '');
    if (!clean) return '';
    return `${clean.length}:${clean.slice(0, 4)}:${clean.slice(-4)}`;
  }, [apiKey]);

  const loadOpenRouterModels = async (): Promise<void> => {
    if (openRouterLoading) return;
    if (provider !== 'openrouter') return;
    setOpenRouterLoading(true);
    setOpenRouterError('');
    try {
      let items = await fetchOpenRouterModels(apiKey);
      if (!items.length) {
        const backendBase = automationSettings.backendApiBase.trim() || 'https://tz-generator-backend.onrender.com';
        items = await fetchOpenRouterModelsViaBackend(backendBase, apiKey);
      }
      setOpenRouterModels(items);
      setOpenRouterLoadedForKey(openRouterKeySig);
      if (items.length > 0 && (!model.trim() || !items.some((x) => x.id === model))) {
        setModel(items[0].id);
      }
    } catch (firstErr) {
      try {
        const backendBase = automationSettings.backendApiBase.trim() || 'https://tz-generator-backend.onrender.com';
        const items = await fetchOpenRouterModelsViaBackend(backendBase, apiKey);
        setOpenRouterModels(items);
        setOpenRouterLoadedForKey(openRouterKeySig);
        if (items.length > 0 && (!model.trim() || !items.some((x) => x.id === model))) {
          setModel(items[0].id);
        }
      } catch (secondErr) {
        const msg1 = firstErr instanceof Error ? firstErr.message : 'openrouter_models_load_failed';
        const msg2 = secondErr instanceof Error ? secondErr.message : '';
        setOpenRouterError(msg2 ? `${msg1} | backend: ${msg2}` : msg1);
      }
    } finally {
      setOpenRouterLoading(false);
    }
  };

  useEffect(() => {
    if (provider !== 'openrouter') return;
    if (apiKey.trim().length < 6) return;
    if (openRouterLoadedForKey === openRouterKeySig && openRouterModels.length > 0) return;
    void loadOpenRouterModels();
  }, [provider, apiKey, openRouterModels.length, openRouterLoadedForKey, openRouterKeySig]);

  const loadBillingReadiness = async (): Promise<void> => {
    setBillingReadinessLoading(true);
    try {
      const base = automationSettings.backendApiBase.trim() || 'https://tz-generator-backend.onrender.com';
      const data = await fetchPublicBillingReadiness(base);
      setBillingReadiness(data);
    } finally {
      setBillingReadinessLoading(false);
    }
  };

  useEffect(() => {
    void loadBillingReadiness();
  }, [automationSettings.backendApiBase]);

  const mutation = useMutation({
    mutationFn: async () => {
      const next = [...rows];
      const pieces: string[] = [];
      for (let i = 0; i < next.length; i += 1) {
        next[i] = { ...next[i], status: 'loading', error: '' };
        setRows([...next]);
        if (!String(next[i].internetHints || '').trim() && String(next[i].model || '').trim().length >= 3) {
          try {
            // Before generation, pull model-specific hints so AI does not fallback to generic specs.
            const hints = await fetchInternetHints(next[i].model);
            if (hints) next[i] = { ...next[i], internetHints: hints, lookupState: 'done', lookupNote: 'Интернет-данные применены' };
          } catch {
            // keep generation flow even if web hints fail
          }
        }
        const prompt = buildPrompt(next[i], lawMode);
        try {
          const raw = await generateItemSpecs(provider, apiKey, model, prompt);
          const parsed = parseMaybeJson(raw);
          next[i] = { ...next[i], status: 'done', result: parsed.pretty, okpd2: parsed.okpd2, ktru: parsed.ktru };
          pieces.push(`### ${GOODS_LABELS[next[i].type]} / ${next[i].model}\n${buildReadableResultBlock(parsed.pretty)}`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'generation_error';
          next[i] = { ...next[i], status: 'error', error: msg };
          pieces.push(`### ${GOODS_LABELS[next[i].type]} / ${next[i].model}\n\nОшибка: ${msg}`);
        }
        setRows([...next]);
      }

      const full = [
        `ТЕХНИЧЕСКОЕ ЗАДАНИЕ (${lawMode === '223' ? '223-ФЗ' : '44-ФЗ'})`,
        '',
        buildNormativeBlock(lawMode),
        '',
        pieces.join('\n\n')
      ].join('\n');

      setTzText(full);

      const payload = {
        law: lawMode === '223' ? '223-FZ' : '44-FZ',
        profile: platformSettings.profile,
        organization: platformSettings.orgName,
        customerInn: platformSettings.customerInn,
        items: next.map((r) => ({
          type: r.type,
          model: r.model,
          qty: r.qty,
          status: r.status,
          okpd2: r.okpd2 || '',
          ktru: r.ktru || ''
        }))
      };

      if (automationSettings.autoSend) {
        await sendEventThroughBestChannel(automationSettings, 'tz.generated.react', payload);
      }
      if (platformSettings.autoSendDraft) {
        await postPlatformDraft(platformSettings, payload, undefined, {
          retries: automationSettings.deliveryRetries,
          baseBackoffMs: automationSettings.deliveryBackoffMs,
          requireHttps: automationSettings.requireHttpsForIntegrations
        });
      }
      if (automationSettings.billingEnabled) {
        const billPayload = {
          tenantId: automationSettings.tenantId || 'default',
          currency: automationSettings.billingCurrency,
          documents: 1,
          rows: next.length,
          amountCents: automationSettings.billingPricePerDocCents,
          generatedAt: new Date().toISOString()
        };
        await sendEventThroughBestChannel(automationSettings, 'billing.usage', billPayload);
      }

      appendAutomationLog({ at: new Date().toISOString(), event: 'react.generate', ok: true, note: `rows=${next.length}` });
      return full;
    }
  });

  const addRow = () => {
    setRows((prev) => [...prev, { id: Date.now(), type: 'pc', typeLocked: false, model: '', qty: 1, status: 'idle' }]);
  };
  const removeRow = (rowId: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((x) => x.id !== rowId)));
  };

  const applyCandidate = (rowId: number, candidateType: GoodsType) => {
    setRows((prev) =>
      prev.map((x) => (x.id === rowId ? { ...x, type: candidateType, typeLocked: true, candidates: [], lookupState: 'done', lookupNote: 'Тип выбран' } : x))
    );
  };

  const enrichRowFromInternet = async (rowId: number): Promise<void> => {
    const row = rows.find((x) => x.id === rowId);
    if (!row) return;
    const query = String(row.model || '').trim();
    if (!query) {
      setRows((prev) => prev.map((x) => (x.id === rowId ? { ...x, lookupState: 'error', lookupNote: 'Введите модель/описание' } : x)));
      return;
    }

    setRows((prev) =>
      prev.map((x) => (x.id === rowId ? { ...x, lookupState: 'loading', lookupNote: 'Ищу в интернете...', candidates: [] } : x))
    );

    const hints = await fetchInternetHints(query);
    const combined = normalizeText(`${query} ${hints}`.trim());

    let candidates = buildTypeCandidates(combined || query, row.type);

    if (apiKey.trim().length > 6) {
      try {
        const catalogHint = Object.entries(GOODS_LABELS)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ');
        const aiPrompt =
          `Ты классификатор ИТ-товаров для госзакупок.\n` +
          `Запрос: "${query}".\n` +
          `Подсказки из интернета: "${cutText(hints, 1300)}".\n` +
          `Каталог типов: ${catalogHint}\n` +
          `Верни только JSON-массив 1..6 элементов вида {"type":"<ключ>","model":"<модель>","reason":"<кратко>"}.`;
        const aiRaw = await generateItemSpecs(provider, apiKey, model, aiPrompt);
        const aiList = parseJsonArrayFromText(aiRaw);
        if (aiList.length) {
          const fromAi = aiList.map((x, index) => ({
            type: x.type,
            score: 100 - index,
            reason: x.reason || 'Подбор по интернет-данным'
          }));
          const merged = new Map<GoodsType, { type: GoodsType; score: number; reason: string }>();
          for (const c of [...fromAi, ...candidates]) {
            const prev = merged.get(c.type);
            if (!prev || c.score > prev.score) merged.set(c.type, c);
          }
          candidates = Array.from(merged.values()).sort((a, b) => b.score - a.score).slice(0, 8);
        }
      } catch {
        // AI fallback is optional
      }
    }

    if (!candidates.length) {
      setRows((prev) =>
        prev.map((x) => (x.id === rowId ? { ...x, lookupState: 'error', lookupNote: 'Не удалось найти подсказки' } : x))
      );
      return;
    }

    if (row.typeLocked) {
      setRows((prev) =>
        prev.map((x) =>
          x.id === rowId
            ? {
                ...x,
                internetHints: hints || x.internetHints,
                lookupState: 'done',
                lookupNote: hints ? 'Интернет-данные модели загружены (тип зафиксирован)' : 'Тип зафиксирован'
              }
            : x
        )
      );
      return;
    }

    if (candidates.length === 1) {
      const top = candidates[0];
      setRows((prev) =>
        prev.map((x) =>
          x.id === rowId
            ? {
                ...x,
                type: top.type,
                candidates: [],
                internetHints: hints || x.internetHints,
                lookupState: 'done',
                lookupNote: hints ? 'Интернет + автоподбор' : 'Автоподбор'
              }
            : x
        )
      );
      return;
    }

    setRows((prev) =>
      prev.map((x) =>
        x.id === rowId
            ? {
              ...x,
              candidates,
              internetHints: hints || x.internetHints,
              lookupState: 'choose',
              lookupNote: 'Найдено несколько вариантов'
            }
          : x
      )
    );
  };

  const enrichAllRowsFromInternet = async (): Promise<void> => {
    setBulkLookup(true);
    try {
      for (const row of rows) {
        // eslint-disable-next-line no-await-in-loop
        await enrichRowFromInternet(row.id);
      }
    } finally {
      setBulkLookup(false);
    }
  };

  const runAutopilotFlow = async (): Promise<void> => {
    if (autopilotRunning || mutation.isPending) return;
    setAutopilotRunning(true);
    try {
      await enrichAllRowsFromInternet();
      await mutation.mutateAsync();
      exportPackage();
      appendAutomationLog({
        at: new Date().toISOString(),
        event: 'react.autopilot.full',
        ok: true,
        note: `rows=${rows.length}`
      });
    } catch (e) {
      appendAutomationLog({
        at: new Date().toISOString(),
        event: 'react.autopilot.full',
        ok: false,
        note: e instanceof Error ? e.message.slice(0, 120) : 'unknown_error'
      });
    } finally {
      setAutopilotRunning(false);
    }
  };

  const exportPackage = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      law: lawMode === '223' ? '223-FZ' : '44-FZ',
      profile: platformSettings.profile,
      items: rows.map((r) => ({ type: r.type, model: r.model, qty: r.qty, okpd2: r.okpd2 || '', ktru: r.ktru || '' }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `procurement_pack_react_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportDocx = async () => {
    const lines = tzText.trim().split('\n');
    const doc = new Document({
      sections: [
        {
          children: lines.map((line) =>
            new Paragraph({
              children: [
                new TextRun({ text: line || ' ', bold: line.startsWith('###') || line.startsWith('ТЕХНИЧЕСКОЕ ЗАДАНИЕ') })
              ]
            })
          )
        }
      ]
    });
    const blob = await Packer.toBlob(doc);
    saveAs(blob, `TZ_react_${Date.now()}.docx`);
  };

  const exportPdf = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const margin = 36;
    const maxWidth = 540;
    const lines = doc.splitTextToSize(tzText || 'Пустой документ', maxWidth);
    let y = margin;
    lines.forEach((line: string) => {
      if (y > 790) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += 14;
    });
    doc.save(`TZ_react_${Date.now()}.pdf`);
  };

  return (
    <section className="panel">
      <h2>Рабочая область ТЗ</h2>
      <div className="checks">
        <label><input type="radio" checked={lawMode === '44'} onChange={() => setLawMode('44')} /> 44-ФЗ</label>
        <label><input type="radio" checked={lawMode === '223'} onChange={() => setLawMode('223')} /> 223-ФЗ</label>
      </div>
      <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>{buildNormativeBlock(lawMode)}</div>

      <div className="grid two">
        <label>
          Провайдер
          <select
            value={provider}
            onChange={(e) => {
              const next = e.target.value as Provider;
              setProvider(next);
              if (next === 'deepseek' && !DEEPSEEK_MODELS.includes(model as (typeof DEEPSEEK_MODELS)[number])) {
                setModel('deepseek-chat');
              }
              if (next === 'groq' && !GROQ_MODELS.includes(model as (typeof GROQ_MODELS)[number])) {
                setModel('llama-3.3-70b-versatile');
              }
            }}
          >
            <option value="deepseek">DeepSeek</option>
            <option value="openrouter">OpenRouter</option>
            <option value="groq">Groq</option>
          </select>
        </label>
        <label>
          Модель
          {provider === 'openrouter' && openRouterModels.length > 0 ? (
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {openRouterModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}{m.name ? ` — ${m.name}` : ''}{m.context_length ? ` (${m.context_length})` : ''}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={provider === 'openrouter' ? 'например: openai/gpt-4o-mini' : 'deepseek-chat'}
              list={
                provider === 'deepseek'
                  ? 'deepseek-models'
                  : provider === 'groq'
                    ? 'groq-models'
                    : undefined
              }
            />
          )}
          {provider === 'deepseek' && (
            <datalist id="deepseek-models">
              {DEEPSEEK_MODELS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
          {provider === 'groq' && (
            <datalist id="groq-models">
              {GROQ_MODELS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
          {provider === 'openrouter' && openRouterModels.length > 0 && (
            <div className="muted" style={{ marginTop: 6 }}>
              Загружено моделей: {openRouterModels.length}
            </div>
          )}
          {provider === 'openrouter' && (
            <div className="actions" style={{ marginTop: 8 }}>
              <button type="button" onClick={() => void loadOpenRouterModels()} disabled={openRouterLoading}>
                {openRouterLoading ? 'Загрузка моделей...' : `Загрузить модели OpenRouter (${openRouterModels.length || 0})`}
              </button>
            </div>
          )}
          {provider === 'openrouter' && openRouterError && (
            <div className="warn" style={{ marginTop: 6 }}>
              OpenRouter models: {openRouterError}
            </div>
          )}
        </label>
        <label>
          API-ключ
          <input
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(e) => {
              const next = e.target.value;
              setApiKey(next);
              if (provider === 'openrouter') {
                setOpenRouterLoadedForKey('');
                setOpenRouterModels([]);
                setOpenRouterError('');
              }
            }}
            placeholder="sk-... (не сохраняется в браузере)"
          />
        </label>
      </div>

      <div className="rows-table-wrap">
        <table className="rows-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Тип товара</th>
              <th>Модель / описание</th>
              <th>Кол-во</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.id}>
                <td>{idx + 1}</td>
                <td>
                  <select
                    value={row.type}
                    onChange={(e) => {
                      const val = e.target.value as GoodsType;
                      setRows((prev) =>
                        prev.map((x) => (x.id === row.id ? { ...x, type: val, typeLocked: true, candidates: [] } : x))
                      );
                    }}
                  >
                    {Object.entries(GOODS_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    value={row.model}
                    placeholder="Модель / описание"
                    onChange={(e) => {
                      const value = e.target.value;
                      setRows((prev) =>
                        prev.map((x) => {
                          if (x.id !== row.id) return x;
                          if (x.typeLocked) {
                            return {
                              ...x,
                              model: value,
                              candidates: []
                            };
                          }
                          const detected = detectTypeDetailed(value, x.type);
                          const candidates = buildTypeCandidates(value, detected.type);
                          return {
                            ...x,
                            model: value,
                            type: detected.type,
                            candidates: value.trim().length >= 3 ? candidates : []
                          };
                        })
                      );
                    }}
                  />
                  {Array.isArray(row.candidates) && row.candidates.length > 1 && (
                    <div className="row-suggest-box">
                      <div className="row-suggest-head">Найдено несколько вариантов — выберите</div>
                      {row.candidates.map((candidate) => (
                        <button
                          key={`${row.id}-${candidate.type}-${candidate.reason}`}
                          type="button"
                          className="row-suggest-item"
                          onClick={() => applyCandidate(row.id, candidate.type)}
                        >
                          <strong>{GOODS_LABELS[candidate.type]}</strong>
                          <span>{candidate.reason}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {row.internetHints && (
                    <div className="muted" style={{ marginTop: 6 }}>
                      🌐 Данные модели загружены ({Math.min(row.internetHints.length, 9999)} симв.)
                    </div>
                  )}
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    value={row.qty}
                    onChange={(e) => {
                      const qty = Number(e.target.value || 1);
                      setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, qty } : x)));
                    }}
                  />
                </td>
                <td>
                  <div className={row.status === 'done' ? 'ok' : row.status === 'error' ? 'warn' : 'muted'}>
                    {row.status === 'idle' && 'Ожидание'}
                    {row.status === 'loading' && 'Генерация...'}
                    {row.status === 'done' && 'Готово'}
                    {row.status === 'error' && `Ошибка: ${row.error || ''}`}
                  </div>
                  {row.lookupState && row.lookupState !== 'idle' && (
                    <div className={row.lookupState === 'error' ? 'warn' : row.lookupState === 'done' ? 'ok' : 'muted'}>
                      {row.lookupState === 'loading' && '🌐 Поиск...'}
                      {row.lookupState === 'choose' && '🔎 Выбор'}
                      {row.lookupState === 'done' && '✅ Интернет'}
                      {row.lookupState === 'error' && '⚠️ Нет данных'}
                      {row.lookupNote ? `: ${row.lookupNote}` : ''}
                    </div>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="lookup-btn"
                    disabled={row.lookupState === 'loading' || bulkLookup}
                    onClick={() => void enrichRowFromInternet(row.id)}
                  >
                    🌐 Подтянуть
                  </button>
                  <button type="button" className="danger-btn" onClick={() => removeRow(row.id)} disabled={rows.length <= 1}>
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="billing-readiness-box">
        <div className="billing-readiness-head">
          <strong>Платежная готовность (YooKassa)</strong>
          <button type="button" onClick={() => void loadBillingReadiness()} disabled={billingReadinessLoading}>
            {billingReadinessLoading ? 'Проверка...' : 'Обновить'}
          </button>
        </div>
        {billingReadiness ? (
          <>
            <div className={billingReadiness.ready_for_checkout ? 'ok' : 'warn'}>
              {billingReadiness.ready_for_checkout ? 'Checkout готов к оплатам.' : 'Checkout пока не готов.'}
            </div>
            <div className="billing-grid">
              <div>Shop ID: {billingReadiness.configured.shop_id ? '✅' : '❌'}</div>
              <div>Secret Key: {billingReadiness.configured.secret_key ? '✅' : '❌'}</div>
              <div>Return URL: {billingReadiness.configured.return_url ? '✅' : '❌'}</div>
              <div>Webhook Secret: {billingReadiness.configured.webhook_secret ? '✅' : '❌'}</div>
            </div>
            <div className="muted">
              Return URL: {billingReadiness.return_url || 'не задан'}
            </div>
            <div className="muted">
              Webhook: {(automationSettings.backendApiBase.trim() || 'https://tz-generator-backend.onrender.com').replace(/\/+$/, '')}
              {billingReadiness.webhook_path}
            </div>
            {!billingReadiness.ready_for_checkout && billingReadiness.next_steps?.length > 0 && (
              <ul className="preflight-list" style={{ marginTop: 8 }}>
                {billingReadiness.next_steps.map((step, idx) => (
                  <li key={`bill-step-${idx}`} className="warn">⚠️ {step}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="warn">
            Не удалось получить статус billing readiness. Проверьте backend API base в разделе Автоматизация.
          </div>
        )}
      </div>

      <div className="preflight-box">
        <div className="preflight-head">
          <strong>Контроль качества перед генерацией</strong>
          <span className={preflight.score >= 80 ? 'ok' : preflight.score >= 60 ? 'warn' : 'critical'}>
            Индекс готовности: {preflight.score}%
          </span>
        </div>
        {preflight.issues.length === 0 ? (
          <div className="ok">Все проверки пройдены.</div>
        ) : (
          <ul className="preflight-list">
            {preflight.issues.slice(0, 8).map((issue, idx) => (
              <li key={`${issue.level}-${idx}`} className={issue.level === 'critical' ? 'critical' : 'warn'}>
                {issue.level === 'critical' ? '⛔' : '⚠️'} {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="actions">
        <button type="button" onClick={addRow}>Добавить строку</button>
        <button type="button" onClick={() => void enrichAllRowsFromInternet()} disabled={bulkLookup || rows.length === 0}>
          {bulkLookup ? '🌐 Поиск...' : '🌐 Подтянуть из интернета'}
        </button>
        <button
          type="button"
          onClick={() => void runAutopilotFlow()}
          disabled={autopilotRunning || mutation.isPending || rows.length === 0}
        >
          {autopilotRunning ? '⚙️ Автопилот...' : '⚙️ Автопилот: интернет → ТЗ → пакет'}
        </button>
        <button type="button" disabled={!canGenerate || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Генерация...' : 'Сгенерировать ТЗ'}
        </button>
        <button type="button" onClick={exportPackage}>Экспорт пакета</button>
        <button type="button" onClick={() => void exportDocx()} disabled={!tzText.trim()}>Скачать DOCX</button>
        <button type="button" onClick={exportPdf} disabled={!tzText.trim()}>Скачать PDF</button>
      </div>

      <textarea value={tzText} readOnly rows={18} style={{ width: '100%', fontFamily: 'monospace' }} />
      {rows.some((r) => r.status === 'done' && r.result) && (
        <div className="rows-table-wrap" style={{ marginTop: 14 }}>
          <table className="rows-table">
            <thead>
              <tr>
                <th>Позиция</th>
                <th>Параметр</th>
                <th>Значение</th>
                <th>Ед.</th>
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((row) => {
                const parsed = parseResultObject(row.result);
                const specs = Array.isArray(parsed?.specs) ? parsed!.specs! : [];
                if (!specs.length) return [];
                return specs.map((spec, idx) => (
                  <tr key={`${row.id}-${idx}-${spec.group}-${spec.name}`}>
                    <td>{idx === 0 ? `${GOODS_LABELS[row.type]} / ${row.model}` : ''}</td>
                    <td>{spec.group} → {spec.name}</td>
                    <td>{spec.value}</td>
                    <td>{spec.unit || ''}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
