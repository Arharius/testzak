import { handleOptions, parseJsonBody, ok, err, aiChatCompletion } from './_shared.mjs';

export async function handler(event) {
  const preflight = handleOptions(event);
  if (preflight) return preflight;
  if ((event?.httpMethod || 'GET').toUpperCase() !== 'POST') return err(405, 'method_not_allowed');

  const body = parseJsonBody(event);
  if (!body) return err(400, 'invalid_json');

  const provider = String(body.provider || 'deepseek').trim().toLowerCase();
  const model = String(body.model || '').trim();
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return err(400, 'messages_required');

  try {
    const data = await aiChatCompletion({
      provider,
      model,
      messages,
      temperature: body.temperature ?? 0.1,
      max_tokens: body.max_tokens ?? 2048,
    });
    return ok({ ok: true, data });
  } catch (e) {
    const detail = String(e?.message || e);
    return err(502, detail, e?.data ? { upstream: e.data } : {});
  }
}

