// Staff additions for one session.
//   GET  /api/additions?session=...                      the list
//   POST /api/additions { session, action: 'add', text }
//   POST /api/additions { session, action: 'status', id, status }
//   POST /api/additions { session, action: 'delete', id }
// Every mutation answers with the full list, so the page never guesses.

import { json, storeFor, type Env } from '../../src/app.ts';
import { parseSessionId } from '../../src/guard/input.ts';
import { visitorKey } from '../../src/guard/rateLimit.ts';
import { addAddition, deleteAddition, isAdditionStatus, setAdditionStatus } from '../../src/staff/additions.ts';
import type { SessionState } from '../../src/store/store.ts';

/** Mutations per visitor per ten minutes. */
const LIMIT = { max: 40, windowSec: 600 };

function list(state: SessionState): Response {
  return json({ additions: state.additions });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = parseSessionId(new URL(request.url).searchParams.get('session'));
  if (!session) return json({ code: 'invalid', error: 'session must be a UUID' }, 400);
  return list(await storeFor(env).get(session));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ code: 'invalid' }, 400);
  }
  const b = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const session = parseSessionId(b.session);
  if (!session) return json({ code: 'invalid', error: 'session must be a UUID' }, 400);

  const store = storeFor(env);
  const now = new Date();
  const visitor = await visitorKey(request.headers.get('cf-connecting-ip') ?? 'local', env.RATE_SALT ?? 'demo');
  const bucket = Math.floor(now.getTime() / 1000 / LIMIT.windowSec);
  if ((await store.incr(`additions:${visitor}:${bucket}`, LIMIT.windowSec)) > LIMIT.max) return json({ code: 'rate' }, 429);

  const state = await store.get(session);
  const id = typeof b.id === 'string' ? b.id : '';
  switch (b.action) {
    case 'add': {
      const result = addAddition(state, b.text, now);
      if (!result.ok) return json({ code: 'invalid', error: result.error }, 400);
      break;
    }
    case 'status': {
      if (!isAdditionStatus(b.status) || !setAdditionStatus(state, id, b.status)) return json({ code: 'invalid' }, 400);
      break;
    }
    case 'delete': {
      if (!deleteAddition(state, id)) return json({ code: 'invalid' }, 400);
      break;
    }
    default:
      return json({ code: 'invalid', error: 'action must be add, status or delete' }, 400);
  }
  await store.put(session, state);
  return list(state);
};
