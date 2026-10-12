// POST /api/feedback { session, mid, vote }. A thumbs vote on one reply.
// Production writes it to the anonymised log; the demo keeps it in the
// session and shows it on the staff page.

import { json, storeFor, type Env } from '../../src/app.ts';
import { parseSessionId, readJsonLimited } from '../../src/guard/input.ts';
import { visitorKey } from '../../src/guard/rateLimit.ts';

const MID = /^[a-f0-9]{8}$/;
/** Votes per visitor per ten minutes. */
const FEEDBACK_LIMIT = { max: 20, windowSec: 600 };
const MAX_BODY_BYTES = 2048;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const raw = await readJsonLimited(request, MAX_BODY_BYTES);
  if (!raw.ok) return json({ code: 'invalid' }, raw.reason === 'too_large' ? 413 : 400);
  const b = raw.value && typeof raw.value === 'object' ? (raw.value as Record<string, unknown>) : {};
  const session = parseSessionId(b.session);
  const mid = typeof b.mid === 'string' && MID.test(b.mid) ? b.mid : '';
  const vote = b.vote === 'up' || b.vote === 'down' ? b.vote : null;
  if (!session || !mid || !vote) return json({ code: 'invalid' }, 400);

  const store = storeFor(env);
  const now = new Date();
  const visitor = await visitorKey(request.headers.get('cf-connecting-ip') ?? 'local', env.RATE_SALT ?? 'demo');
  const bucket = Math.floor(now.getTime() / 1000 / FEEDBACK_LIMIT.windowSec);
  if ((await store.incr(`feedback:${visitor}:${bucket}`, FEEDBACK_LIMIT.windowSec)) > FEEDBACK_LIMIT.max) {
    return json({ code: 'rate' }, 429);
  }

  let invalid = false;
  await store.update(session, (state) => {
    // A vote only counts for a reply this session actually got.
    if (!state.transcript.some((h) => h.mid === mid)) {
      invalid = true;
      return false;
    }
    state.feedback[mid] = vote;
    state.events.push({
      at: now.toISOString(),
      kind: 'feedback',
      text: vote === 'up' ? 'Customer marked a reply as helpful.' : 'Customer marked a reply as not helpful.',
    });
    return true;
  });
  if (invalid) return json({ code: 'invalid' }, 400);
  return json({ ok: true });
};
