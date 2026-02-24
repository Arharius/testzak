import axios from 'axios';
import { appendAutomationLog } from './storage';

export async function postWebhook(url: string, secret: string, payload: unknown): Promise<boolean> {
  if (!url) return false;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers['X-TZ-Secret'] = secret;
    await axios.post(url, payload, { headers, timeout: 10000 });
    appendAutomationLog({ at: new Date().toISOString(), event: 'webhook.sent', ok: true });
    return true;
  } catch {
    appendAutomationLog({ at: new Date().toISOString(), event: 'webhook.failed', ok: false });
    return false;
  }
}

export async function postPlatformDraft(endpoint: string, token: string, payload: unknown): Promise<boolean> {
  if (!endpoint) return false;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    await axios.post(endpoint, payload, { headers, timeout: 10000 });
    appendAutomationLog({ at: new Date().toISOString(), event: 'platform.sent', ok: true });
    return true;
  } catch {
    appendAutomationLog({ at: new Date().toISOString(), event: 'platform.failed', ok: false });
    return false;
  }
}
