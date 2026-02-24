import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { generateItemSpecs, postPlatformDraft, sendEventThroughBestChannel } from '../lib/api';
import { appendAutomationLog } from '../lib/storage';
import type { AutomationSettings, PlatformIntegrationSettings } from '../types/schemas';

type Provider = 'openrouter' | 'groq' | 'deepseek';

type GoodsType = 'pc' | 'laptop' | 'monitor' | 'printer' | 'mfu' | 'server' | 'switch' | 'router' | 'cable' | 'dvd' | 'software';

type Row = {
  id: number;
  type: GoodsType;
  model: string;
  qty: number;
  status: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
  result?: string;
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

const TYPE_HINTS: Array<{ token: string; type: GoodsType }> = [
  { token: 'vivobook', type: 'laptop' },
  { token: 'macbook', type: 'laptop' },
  { token: 'notebook', type: 'laptop' },
  { token: 'ноут', type: 'laptop' },
  { token: 'monitor', type: 'monitor' },
  { token: 'монитор', type: 'monitor' },
  { token: 'switch', type: 'switch' },
  { token: 'коммут', type: 'switch' },
  { token: 'router', type: 'router' },
  { token: 'маршрутиз', type: 'router' },
  { token: 'utp', type: 'cable' },
  { token: 'витая пара', type: 'cable' },
  { token: 'cat6', type: 'cable' },
  { token: 'dvd', type: 'dvd' },
  { token: 'printer', type: 'printer' },
  { token: 'принтер', type: 'printer' },
  { token: 'мфу', type: 'mfu' },
  { token: 'server', type: 'server' },
  { token: 'depo', type: 'server' },
  { token: 'гравитон', type: 'pc' },
  { token: 'astra linux', type: 'software' }
];

function detectType(model: string, fallback: GoodsType): GoodsType {
  const text = model.toLowerCase();
  const found = TYPE_HINTS.find((x) => text.includes(x.token));
  return found?.type || fallback;
}

function buildPrompt(row: Row): string {
  const goodsName = GOODS_LABELS[row.type];
  const law = '44-ФЗ';
  return `Ты эксперт по госзакупкам РФ (${law}).\n` +
    `Сформируй технические характеристики для товара.\n` +
    `Тип: ${goodsName}\n` +
    `Модель/описание: ${row.model}\n` +
    `Количество: ${row.qty}\n\n` +
    `Ответ строго JSON:\n` +
    `{\n` +
    `  "meta": {\n` +
    `    "okpd2_code": "...",\n` +
    `    "okpd2_name": "...",\n` +
    `    "ktru_code": "...",\n` +
    `    "law175_status": "forbidden|exempt|allowed",\n` +
    `    "law175_basis": "..."\n` +
    `  },\n` +
    `  "specs": [\n` +
    `    {"group":"...","name":"...","value":"...","unit":"..."}\n` +
    `  ]\n` +
    `}`;
}

function parseMaybeJson(text: string): { pretty: string; okpd2: string; ktru: string } {
  try {
    const obj = JSON.parse(text);
    const pretty = JSON.stringify(obj, null, 2);
    return {
      pretty,
      okpd2: obj?.meta?.okpd2_code || '',
      ktru: obj?.meta?.ktru_code || ''
    };
  } catch {
    return { pretty: text, okpd2: '', ktru: '' };
  }
}

type Props = {
  automationSettings: AutomationSettings;
  platformSettings: PlatformIntegrationSettings;
};

export function Workspace({ automationSettings, platformSettings }: Props) {
  const [provider, setProvider] = useState<Provider>('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('deepseek-chat');
  const [rows, setRows] = useState<Row[]>([{ id: 1, type: 'pc', model: '', qty: 1, status: 'idle' }]);
  const [tzText, setTzText] = useState('');

  const canGenerate = useMemo(
    () => apiKey.trim().length > 6 && rows.every((r) => r.model.trim().length > 0),
    [apiKey, rows]
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const next = [...rows];
      const pieces: string[] = [];
      for (let i = 0; i < next.length; i += 1) {
        next[i] = { ...next[i], status: 'loading', error: '' };
        setRows([...next]);
        const prompt = buildPrompt(next[i]);
        try {
          const raw = await generateItemSpecs(provider, apiKey, model, prompt);
          const parsed = parseMaybeJson(raw);
          next[i] = { ...next[i], status: 'done', result: parsed.pretty };
          pieces.push(`### ${GOODS_LABELS[next[i].type]} / ${next[i].model}\n\n\
${parsed.pretty}`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'generation_error';
          next[i] = { ...next[i], status: 'error', error: msg };
          pieces.push(`### ${GOODS_LABELS[next[i].type]} / ${next[i].model}\n\nОшибка: ${msg}`);
        }
        setRows([...next]);
      }

      const full = pieces.join('\n\n');
      setTzText(full);

      const payload = {
        law: platformSettings.profile === 'eis_223' ? '223-FZ' : '44-FZ',
        profile: platformSettings.profile,
        organization: platformSettings.orgName,
        customerInn: platformSettings.customerInn,
        items: next.map((r) => ({ type: r.type, model: r.model, qty: r.qty, status: r.status }))
      };

      if (automationSettings.autoSend) {
        await sendEventThroughBestChannel(automationSettings, 'tz.generated.react', payload);
      }
      if (platformSettings.autoSendDraft) {
        await postPlatformDraft(platformSettings.endpoint, platformSettings.apiToken, payload);
      }

      appendAutomationLog({ at: new Date().toISOString(), event: 'react.generate', ok: true, note: `rows=${next.length}` });
      return full;
    }
  });

  const addRow = () => {
    setRows((prev) => [...prev, { id: Date.now(), type: 'pc', model: '', qty: 1, status: 'idle' }]);
  };

  return (
    <section className="panel">
      <h2>React Workspace (core flow)</h2>
      <div className="grid two">
        <label>
          Provider
          <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            <option value="deepseek">DeepSeek</option>
            <option value="openrouter">OpenRouter</option>
            <option value="groq">Groq</option>
          </select>
        </label>
        <label>
          Model
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
        </label>
        <label>
          API Key
          <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
        </label>
      </div>

      <div className="rows-grid">
        {rows.map((row, idx) => (
          <div className="row-card" key={row.id}>
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 12, color: '#64748b' }}>#{idx + 1}</div>
              <select
                value={row.type}
                onChange={(e) => {
                  const val = e.target.value as GoodsType;
                  setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, type: val } : x)));
                }}
              >
                {Object.entries(GOODS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <input
                value={row.model}
                placeholder="Модель / описание"
                onChange={(e) => {
                  const value = e.target.value;
                  setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, model: value, type: detectType(value, x.type) } : x)));
                }}
              />
              <input
                type="number"
                min={1}
                value={row.qty}
                onChange={(e) => {
                  const qty = Number(e.target.value || 1);
                  setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, qty } : x)));
                }}
              />
              <div className={row.status === 'done' ? 'ok' : row.status === 'error' ? 'warn' : 'muted'}>
                {row.status === 'idle' && 'idle'}
                {row.status === 'loading' && 'generating...'}
                {row.status === 'done' && 'done'}
                {row.status === 'error' && `error: ${row.error || ''}`}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="actions">
        <button type="button" onClick={addRow}>add row</button>
        <button type="button" disabled={!canGenerate || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'generating...' : 'generate TZ'}
        </button>
        <button
          type="button"
          onClick={() => {
            const payload = {
              exportedAt: new Date().toISOString(),
              law: platformSettings.profile === 'eis_223' ? '223-FZ' : '44-FZ',
              profile: platformSettings.profile,
              items: rows.map((r) => ({ type: r.type, model: r.model, qty: r.qty }))
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `procurement_pack_react_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          export package
        </button>
      </div>

      <textarea value={tzText} readOnly rows={14} style={{ width: '100%', fontFamily: 'monospace' }} />
    </section>
  );
}
