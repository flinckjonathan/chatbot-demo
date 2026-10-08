// Shape and limits of what the browser may send. Everything is cut to size
// before it reaches the model; the history is text only and short, so one
// conversation cannot grow into a large bill.

import { LANGS, type Lang } from '../booking/types.ts';
import { cleanText } from '../booking/rules.ts';

export const MAX_MESSAGE_CHARS = 1000;
export const MAX_HISTORY = 12;
export const MAX_HISTORY_CHARS = 1500;

export interface HistoryItem {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatRequest {
  sessionId: string;
  lang: Lang;
  message: string;
  history: HistoryItem[];
}

const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export type ParseResult = { ok: true; request: ChatRequest } | { ok: false; error: string };

export function parseChatRequest(body: unknown): ParseResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be a JSON object' };
  const b = body as Record<string, unknown>;

  const sessionId = typeof b.session === 'string' && SESSION_ID.test(b.session) ? b.session.toLowerCase() : '';
  if (!sessionId) return { ok: false, error: 'session must be a UUID' };

  const lang = (LANGS as readonly string[]).includes(String(b.lang)) ? (b.lang as Lang) : 'en';

  const message = cleanText(b.message, MAX_MESSAGE_CHARS);
  if (!message) return { ok: false, error: 'message is empty' };

  const history: HistoryItem[] = [];
  if (Array.isArray(b.history)) {
    for (const item of b.history.slice(-MAX_HISTORY)) {
      if (!item || typeof item !== 'object') continue;
      const { role, text } = item as Record<string, unknown>;
      if (role !== 'user' && role !== 'assistant') continue;
      const clean = cleanText(text, MAX_HISTORY_CHARS);
      if (clean) history.push({ role, text: clean });
    }
  }
  // The API wants alternating turns that start with the user: drop a leading
  // assistant greeting, merge accidental doubles, and never end on a user
  // turn (the new message is the user turn).
  while (history.length && history[0]?.role === 'assistant') history.shift();
  const alternating: HistoryItem[] = [];
  for (const h of history) {
    const last = alternating[alternating.length - 1];
    if (last && last.role === h.role) last.text = `${last.text}\n${h.text}`;
    else alternating.push({ ...h });
  }
  if (alternating.length && alternating[alternating.length - 1]?.role === 'user') alternating.pop();

  return { ok: true, request: { sessionId, lang, message, history: alternating } };
}
