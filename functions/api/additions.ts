// Staff additions for one session.
//   GET  /api/additions?session=...                      the list
//   POST /api/additions { session, action: 'add', text }
//   POST /api/additions { session, action: 'status', id, status }
//   POST /api/additions { session, action: 'delete', id }
// Every mutation answers with the full list, so the page never guesses.

import { json, storeFor, type Env } from '../../src/app.ts';
import { parseSessionId, readJsonLimited } from '../../src/guard/input.ts';
import { visitorKey } from '../../src/guard/rateLimit.ts';
import { addAddition, deleteAddition, isAdditionStatus, parseAdditionId, setAdditionStatus } from '../../src/staff/additions.ts';
import type { SessionState } from '../../src/store/store.ts';

/** Mutations per visitor per ten minutes. */
const LIMIT = { max: 40, windowSec: 600 };
const MAX_BODY_BYTES = 12 * 1024;

function list(state: SessionState): Response {
  return json({ additions: state.additions });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = parseSessionId(new URL(request.url).searchParams.get('session'));
  if (!session) return json({ code: 'invalid', error: 'session must be a UUID' }, 400);
  return list(await storeFor(env).get(session));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const raw = await readJsonLimited(request, MAX_BODY_BYTES);
  if (!raw.ok) return json({ code: 'invalid' }, raw.reason === 'too_large' ? 413 : 400);
  const b = raw.value && typeof raw.value === 'object' ? (raw.value as Record<string, unknown>) : {};
  const session = parseSessionId(b.session);
  if (!session) return json({ code: 'invalid', error: 'session must be a UUID' }, 400);

  const store = storeFor(env);
  const now = new Date();
  const visitor = await visitorKey(request.headers.get('cf-connecting-ip') ?? 'local', env.RATE_SALT ?? 'demo');
  const bucket = Math.floor(now.getTime() / 1000 / LIMIT.windowSec);
  if ((await store.incr(`additions:${visitor}:${bucket}`, LIMIT.windowSec)) > LIMIT.max) return json({ code: 'rate' }, 429);

  const id = parseAdditionId(b.id);
  let error: Response | null = null;
  const state = await store.update(session, (state) => {
    error = null;
    let changed = false;
    switch (b.action) {
      case 'add': {
        const result = addAddition(state, b.text, now);
        if (!result.ok) {
          error = json({ code: 'invalid', error: result.error }, 400);
          return false;
        }
        changed = true;
        break;
      }
      case 'status': {
        if (!id || !isAdditionStatus(b.status) || !setAdditionStatus(state, id, b.status)) {
          error = json({ code: 'invalid' }, 400);
          return false;
        }
        changed = true;
        break;
      }
      case 'delete': {
        if (!id || !deleteAddition(state, id)) {
          error = json({ code: 'invalid' }, 400);
          return false;
        }
        changed = true;
        break;
      }
      default:
        error = json({ code: 'invalid', error: 'action must be add, status or delete' }, 400);
        return false;
    }
    return changed;
  });
  if (error) return error;
  return list(state);
};
