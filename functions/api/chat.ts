// POST /api/chat. A thin HTTP shell: parse, rate limit, run the turn, answer.
// Everything that matters lives in src/, which runs the same in tests.

import Anthropic from '@anthropic-ai/sdk';
import { buildBoard } from '../../src/agent/board.ts';
import { FakeModel } from '../../src/agent/fake.ts';
import { ApiUnavailable, runTurn, type ModelClient } from '../../src/agent/run.ts';
import { unavailableText } from '../../src/agent/texts.ts';
import { mockCalendarFactory } from '../../src/booking/calendar.ts';
import { parseChatBody } from '../../src/guard/input.ts';
import { checkRate, visitorKey } from '../../src/guard/rateLimit.ts';
import { KvStore, MemoryStore, type Counter, type SessionStore } from '../../src/store/store.ts';

export interface Env {
  ANTHROPIC_API_KEY?: string;
  DEMO_KV?: KVNamespace;
  RATE_SALT?: string;
  CHAT_FAKE?: string;
}

/** The one calendar both sides of the counter use. Swap it for a live adapter here. */
export const calendar = mockCalendarFactory;

/** Local development without a KV binding keeps state in this isolate. */
const memory = new MemoryStore();

export function storeFor(env: Env): SessionStore & Counter {
  return env.DEMO_KV ? new KvStore(env.DEMO_KV) : memory;
}

export function modelFor(env: Env): ModelClient | null {
  if (env.CHAT_FAKE === '1') return new FakeModel();
  if (!env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 90_000 });
  return { create: (params) => client.beta.messages.create(params) };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const model = modelFor(env);
  if (!model) return json({ code: 'off', error: 'The advisor is switched off: no API key configured.' }, 503);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ code: 'invalid', error: 'Body must be JSON.' }, 400);
  }
  const parsed = parseChatBody(raw);
  if (!parsed.ok) return json({ code: 'invalid', error: parsed.error }, 400);
  const { body } = parsed;

  const now = new Date();
  const store = storeFor(env);
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const verdict = await checkRate(store, await visitorKey(ip, env.RATE_SALT ?? 'demo'), now);
  if (!verdict.ok) return json({ code: 'rate', scope: verdict.scope }, 429);

  // Note: KV has no compare-and-set. Two tabs sharing one session id (a
  // duplicated tab) can race this read-modify-write; the demo accepts that.
  const state = await store.get(body.sessionId);
  try {
    const turn = await runTurn({ request: { ...body, history: state.transcript }, state, now }, model, { calendar });
    await store.put(body.sessionId, turn.state);
    return json({
      reply: turn.reply,
      ref: turn.ref ?? null,
      events: turn.events,
      board: buildBoard(now, turn.state, body.lang, calendar),
    });
  } catch (err) {
    // Lookups and refusals recorded before the failure still belong on the board.
    await store.put(body.sessionId, state);
    if (err instanceof ApiUnavailable && err.kind === 'transient') {
      console.error('model API unavailable', err.cause);
      return json({ code: 'api', text: unavailableText(body.lang) }, 502);
    }
    console.error('chat failed', err instanceof ApiUnavailable ? err.cause : err);
    return json({ code: 'error' }, 500);
  }
};
