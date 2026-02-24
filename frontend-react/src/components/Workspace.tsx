import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import { generateItemSpecs, postPlatformDraft, sendEventThroughBestChannel } from '../lib/api';
import { appendAutomationLog } from '../lib/storage';
import type { AutomationSettings, PlatformIntegrationSettings } from '../types/schemas';
import { buildTypeCandidates, detectTypeDetailed, type GoodsType } from '../lib/autodetect';

type Provider = 'openrouter' | 'groq' | 'deepseek';
type LawMode = '44' | '223';

type Row = {
  id: number;
  type: GoodsType;
  model: string;
  qty: number;
  status: 'idle' | 'loading' | 'done' | 'error';
  error?: string;
  result?: string;
  okpd2?: string;
  ktru?: string;
  candidates?: Array<{ type: GoodsType; score: number; reason: string }>;
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

function buildPrompt(row: Row, lawMode: LawMode): string {
  const goodsName = GOODS_LABELS[row.type];
  const law = lawMode === '223' ? '223-ФЗ' : '44-ФЗ';
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
    `    "law175_basis": "ПП РФ № 1875 ..."\n` +
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

export function Workspace({ automationSettings, platformSettings }: Props) {
  const [lawMode, setLawMode] = useState<LawMode>('44');
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
        const prompt = buildPrompt(next[i], lawMode);
        try {
          const raw = await generateItemSpecs(provider, apiKey, model, prompt);
          const parsed = parseMaybeJson(raw);
          next[i] = { ...next[i], status: 'done', result: parsed.pretty, okpd2: parsed.okpd2, ktru: parsed.ktru };
          pieces.push(`### ${GOODS_LABELS[next[i].type]} / ${next[i].model}\n\n${parsed.pretty}`);
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
        await postPlatformDraft(platformSettings, payload);
      }

      appendAutomationLog({ at: new Date().toISOString(), event: 'react.generate', ok: true, note: `rows=${next.length}` });
      return full;
    }
  });

  const addRow = () => {
    setRows((prev) => [...prev, { id: Date.now(), type: 'pc', model: '', qty: 1, status: 'idle' }]);
  };
  const removeRow = (rowId: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((x) => x.id !== rowId)));
  };

  const applyCandidate = (rowId: number, candidateType: GoodsType) => {
    setRows((prev) =>
      prev.map((x) => (x.id === rowId ? { ...x, type: candidateType, candidates: [] } : x))
    );
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
          <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            <option value="deepseek">DeepSeek</option>
            <option value="openrouter">OpenRouter</option>
            <option value="groq">Groq</option>
          </select>
        </label>
        <label>
          Модель
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
        </label>
        <label>
          API-ключ
          <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
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
                      setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, type: val } : x)));
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
                      <div className="row-suggest-head">Найдено несколько вариантов</div>
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
                </td>
                <td>
                  <button type="button" className="danger-btn" onClick={() => removeRow(row.id)} disabled={rows.length <= 1}>
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="actions">
        <button type="button" onClick={addRow}>Добавить строку</button>
        <button type="button" disabled={!canGenerate || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Генерация...' : 'Сгенерировать ТЗ'}
        </button>
        <button type="button" onClick={exportPackage}>Экспорт пакета</button>
        <button type="button" onClick={() => void exportDocx()} disabled={!tzText.trim()}>Скачать DOCX</button>
        <button type="button" onClick={exportPdf} disabled={!tzText.trim()}>Скачать PDF</button>
      </div>

      <textarea value={tzText} readOnly rows={18} style={{ width: '100%', fontFamily: 'monospace' }} />
    </section>
  );
}
