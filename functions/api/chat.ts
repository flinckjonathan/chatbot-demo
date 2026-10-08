// POST /api/chat. A thin HTTP shell: parse, rate limit, run the turn, answer.
// Everything that matters lives in src/, which runs the same in tests.

import Anthropic from '@anthropic-ai/sdk';
import { buildBoard } from '../../src/agent/board.ts';
import { FakeModel } from '../../src/agent/fake.ts';
import { ApiUnavailable, runTurn, type ModelClient } from '../../src/agent/run.ts';
import { parseChatRequest } from '../../src/guard/input.ts';
import { checkRate, visitorKey } from '../../src/guard/rateLimit.ts';
import { KvStore, MemoryStore, type Counter, type SessionStore } from '../../src/store/store.ts';

export interface Env {
  ANTHROPIC_API_KEY?: string;
  DEMO_KV?: KVNamespace;
  RATE_SALT?: string;
  CHAT_FAKE?: string;
}

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const model = modelFor(env);
  if (!model) return json({ code: 'off', error: 'The advisor is switched off: no API key configured.' }, 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ code: 'invalid', error: 'Body must be JSON.' }, 400);
  }
  const parsed = parseChatRequest(body);
  if (!parsed.ok) return json({ code: 'invalid', error: parsed.error }, 400);

  const now = new Date();
  const store = storeFor(env);
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const verdict = await checkRate(store, await visitorKey(ip, env.RATE_SALT ?? 'demo'), now);
  if (!verdict.ok) return json({ code: 'rate', scope: verdict.scope }, 429);

  const { request: chat } = parsed;
  const state = await store.get(chat.sessionId);
  try {
    const turn = await runTurn({ request: chat, state, now }, model);
    await store.put(chat.sessionId, turn.state);
    return json({
      reply: turn.reply,
      ref: turn.ref ?? null,
      events: turn.events,
      board: buildBoard(now, turn.state, chat.lang),
    });
  } catch (err) {
    if (err instanceof ApiUnavailable) {
      console.error('model API unavailable', err.cause);
      return json({ code: 'api' }, 502);
    }
    console.error('chat failed', err);
    return json({ code: 'error' }, 500);
  }
};
