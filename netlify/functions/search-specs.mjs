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

export async function handler(event) {
  const preflight = handleOptions(event);
  if (preflight) return preflight;
  if ((event?.httpMethod || 'GET').toUpperCase() !== 'POST') return err(405, 'method_not_allowed');

  const body = parseJsonBody(event);
  if (!body) return err(400, 'invalid_json');
  const product = String(body.product || '').trim();
  const goodsType = String(body.goods_type || '').trim();
  if (!product) return err(400, 'product_required');

  try {
    const query = `${product} технические характеристики`;
    const results = await serperSearch(query, 6);
    if (!results.length) return ok({ ok: true, specs: [], source: 'internet', note: 'no_serper_results' });

    const contextParts = [summarizeSearchResults(results, query)];
    const topUrls = results
      .map((r) => String(r?.link || '').trim())
      .filter(Boolean)
      .slice(0, 2);

    for (const url of topUrls) {
      try {
        const text = await fetchPageText(url, 10000);
        if (text) contextParts.push(`[PAGE ${url}]\n${text}`);
      } catch {
        // best-effort
      }
    }

    const provider = String(body.provider || process.env.DEFAULT_AI_PROVIDER || 'deepseek').trim().toLowerCase();
    const specs = await aiExtractSpecs({
      product: goodsType ? `${product} (${goodsType})` : product,
      contextText: contextParts.join('\n\n'),
      sourceLabel: 'internet+serper',
      provider,
    });
    return ok({ ok: true, specs, source: 'internet' });
  } catch (e) {
    const msg = String(e?.message || e);
    const status = msg.includes('SERPER_API_KEY_NOT_SET') ? 500 : 502;
    return err(status, msg);
  }
}

