// POST /api/chat. A thin HTTP shell: parse, rate limit, run the turn, answer.
// Everything that matters lives in src/, which runs the same in tests.

import { buildBoard } from '../../src/agent/board.ts';
import { ApiUnavailable, runTurn } from '../../src/agent/run.ts';
import { invalidRequestText, rateLimitedText, serverErrorText, switchedOffText, unavailableText } from '../../src/agent/texts.ts';
import { calendar, json, modelFor, storeFor, type Env } from '../../src/app.ts';
import type { Lang } from '../../src/booking/types.ts';
import { parseChatBody } from '../../src/guard/input.ts';
import { checkRate, visitorKey } from '../../src/guard/rateLimit.ts';
import { emptySession } from '../../src/store/store.ts';

/** A message is 1000 characters; anything near this size is not a chat message. */
export const MAX_BODY_BYTES = 16 * 1024;

function errorResponse(err: unknown, lang: Lang): Response {
  if (err instanceof ApiUnavailable && err.kind === 'transient') {
    console.error('model API unavailable', err.cause);
    return json({ code: 'api', text: unavailableText(lang) }, 502);
  }
  console.error('chat failed', err instanceof ApiUnavailable ? err.cause : err);
  return json({ code: 'error', text: serverErrorText(lang) }, 500);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const model = modelFor(env);
  if (!model) return json({ code: 'off', text: switchedOffText('en') }, 503);

  // Reject oversized bodies on the header alone, before any parsing work.
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return json({ code: 'invalid', text: invalidRequestText('en') }, 413);
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ code: 'invalid', text: invalidRequestText('en') }, 400);
  }
  const parsed = parseChatBody(raw);
  if (!parsed.ok) return json({ code: 'invalid', text: invalidRequestText('en'), error: parsed.error }, 400);
  const { body } = parsed;

  const now = new Date();
  const store = storeFor(env);
  // The session read does not depend on the rate verdict, so it runs alongside it.
  const pendingState = store.get(body.sessionId).catch(() => emptySession());
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const verdict = await checkRate(store, await visitorKey(ip, env.RATE_SALT ?? 'demo'), now);
  if (!verdict.ok) return json({ code: 'rate', scope: verdict.scope, text: rateLimitedText(body.lang, verdict.scope) }, 429);

  // Note: KV has no compare-and-set. Two tabs sharing one session id (a
  // duplicated tab) can race this read-modify-write; the demo accepts that.
  const state = await pendingState;
  const eventsBefore = state.events.length;
  let turn;
  try {
    turn = await runTurn(body, state, now, { client: model, calendar });
  } catch (err) {
    // Lookups and refusals recorded before the failure still belong on the board.
    if (state.events.length > eventsBefore) await store.put(body.sessionId, state);
    return errorResponse(err, body.lang);
  }
  await store.put(body.sessionId, state);
  return json({ reply: turn.reply, ref: turn.ref ?? null, board: buildBoard(now, state, body.lang, calendar) });
};
