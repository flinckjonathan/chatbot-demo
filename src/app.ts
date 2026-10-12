// Composition root: the one place that decides which calendar, store and
// model the HTTP handlers use. Swap the mock calendar for a live adapter
// here and both sides of the counter follow.

import Anthropic from '@anthropic-ai/sdk';
import { FakeModel } from './agent/fake.ts';
import type { ModelClient } from './agent/run.ts';
import { mockCalendarFactory } from './booking/calendar.ts';
import { KvStore, MemoryStore, type Counter, type KvLike, type SessionStore } from './store/store.ts';

export interface Env {
  ANTHROPIC_API_KEY?: string;
  DEMO_KV?: KvLike;
  RATE_SALT?: string;
  CHAT_FAKE?: string;
  /** Optional caps as whole numbers; see guard/rateLimit.ts for the defaults. */
  RATE_PER_VISITOR?: string;
  RATE_PER_DAY?: string;
}

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
