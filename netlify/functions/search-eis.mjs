import {
  handleOptions,
  parseJsonBody,
  ok,
  err,
  serperSearch,
  fetchPageText,
  aiExtractSpecs,
  summarizeSearchResults,
} from './_shared.mjs';

function buildEisQueries(query) {
  const q = String(query || '').trim();
  return [
    `site:zakupki.gov.ru ${q} техническое задание`,
    `site:zakupki.gov.ru ${q} описание объекта закупки`,
    `site:zakupki.gov.ru ${q} документация закупки`,
  ];
}

export async function handler(event) {
  const preflight = handleOptions(event);
  if (preflight) return preflight;
  if ((event?.httpMethod || 'GET').toUpperCase() !== 'POST') return err(405, 'method_not_allowed');

  const body = parseJsonBody(event);
  if (!body) return err(400, 'invalid_json');
  const query = String(body.query || '').trim();
  const goodsType = String(body.goods_type || '').trim();
  if (!query) return err(400, 'query_required');

  try {
    const queryVariants = buildEisQueries(query);
    const all = [];
    for (const q of queryVariants) {
      try {
        const part = await serperSearch(q, 4);
        for (const r of part) {
          const link = String(r?.link || '').trim();
          if (!link) continue;
          if (!all.find((x) => String(x?.link || '').trim() === link)) all.push(r);
        }
      } catch {
        // Continue through variants to maximize chance of results.
      }
      if (all.length >= 6) break;
    }

    if (!all.length) return ok({ ok: true, specs: [], source: 'eis', note: 'no_serper_results' });

    const contextParts = [summarizeSearchResults(all, `EIS:${query}`)];
    for (const url of all.map((r) => String(r?.link || '').trim()).filter(Boolean).slice(0, 2)) {
      try {
        const text = await fetchPageText(url, 10000);
        if (text) contextParts.push(`[EIS PAGE ${url}]\n${text}`);
      } catch {
        // best-effort
      }
    }

    const eisPromptHint = [
      'Нужно извлечь характеристики из контекста готовых закупок/ЕИС и сформулировать их для вставки в ТЗ.',
      'Если встречаются требования вида "Наличие" или диапазоны — сохраняй смысл.',
      'Не придумывай характеристики, которых нет в контексте.',
    ].join(' ');

    const provider = String(body.provider || process.env.DEFAULT_AI_PROVIDER || 'deepseek').trim().toLowerCase();
    const specs = await aiExtractSpecs({
      product: goodsType ? `${query} (${goodsType})` : query,
      contextText: `${eisPromptHint}\n\n${contextParts.join('\n\n')}`,
      sourceLabel: 'eis+serper',
      provider,
    });

    return ok({
      ok: true,
      specs,
      source: 'eis',
      refs: all.slice(0, 5).map((r) => ({ title: r?.title || '', link: r?.link || '' })),
    });
  } catch (e) {
    const msg = String(e?.message || e);
    const status = msg.includes('SERPER_API_KEY_NOT_SET') ? 500 : 502;
    return err(status, msg);
  }
}

