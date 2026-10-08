// Shape and limits of what the browser may send: a session id, a language
// and one message. The conversation history is not accepted from the
// client; it lives in the session store, so a visitor cannot forge earlier
// assistant turns.

import { cleanText } from '../booking/rules.ts';
import { isLang, type Lang } from '../booking/types.ts';

export const MAX_MESSAGE_CHARS = 1000;

export interface ChatBody {
  sessionId: string;
  lang: Lang;
  message: string;
}

export const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function parseLang(v: unknown): Lang {
  return isLang(v) ? v : 'en';
}

export function parseSessionId(v: unknown): string {
  return typeof v === 'string' && SESSION_ID.test(v) ? v.toLowerCase() : '';
}

export type ParseResult = { ok: true; body: ChatBody } | { ok: false; error: string };

export function parseChatBody(body: unknown): ParseResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be a JSON object' };
  const b = body as Record<string, unknown>;

  const sessionId = parseSessionId(b.session);
  if (!sessionId) return { ok: false, error: 'session must be a UUID' };

  const message = cleanText(b.message, MAX_MESSAGE_CHARS);
  if (!message) return { ok: false, error: 'message is empty' };

  return { ok: true, body: { sessionId, lang: parseLang(b.lang), message } };
}
