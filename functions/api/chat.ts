// POST /api/chat. A thin HTTP shell: parse, rate limit, run the turn, answer.
// Everything that matters lives in src/, which runs the same in tests.

import { buildBoard } from '../../src/agent/board.ts';
import { ApiUnavailable, runTurn } from '../../src/agent/run.ts';
import { invalidRequestText, rateLimitedText, serverErrorText, switchedOffText, unavailableText } from '../../src/agent/texts.ts';
import { calendar, json, modelFor, storeFor, type Env } from '../../src/app.ts';
import type { Lang } from '../../src/booking/types.ts';
import { MAX_IMAGES, MAX_IMAGE_BYTES, parseChatBody, readJsonLimited } from '../../src/guard/input.ts';
import { checkRate, limitsFrom, visitorKey } from '../../src/guard/rateLimit.ts';
import { emptySession } from '../../src/store/store.ts';

/** Two pictures as base64 plus a message; anything larger is not a chat turn. */
export const MAX_BODY_BYTES = MAX_IMAGES * Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64 * 1024;

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

  const raw = await readJsonLimited(request, MAX_BODY_BYTES);
  if (!raw.ok && raw.reason === 'too_large') return json({ code: 'invalid', text: invalidRequestText('en') }, 413);
  if (!raw.ok) {
    return json({ code: 'invalid', text: invalidRequestText('en') }, 400);
  }
  const parsed = parseChatBody(raw.value);
  if (!parsed.ok) return json({ code: 'invalid', text: invalidRequestText('en'), error: parsed.error }, 400);
  const { body } = parsed;

  const now = new Date();
  const store = storeFor(env);
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const verdict = await checkRate(store, await visitorKey(ip, env.RATE_SALT ?? 'demo'), now, limitsFrom(env));
  if (!verdict.ok) return json({ code: 'rate', scope: verdict.scope, text: rateLimitedText(body.lang, verdict.scope, verdict.max) }, 429);

  let turn: Awaited<ReturnType<typeof runTurn>> | undefined;
  let failure: unknown;
  let savedState = emptySession();
  try {
    savedState = await store.update(body.sessionId, async (state) => {
      const eventsBefore = state.events.length;
      try {
        turn = await runTurn(body, state, now, { client: model, calendar });
        return true;
      } catch (err) {
        failure = err;
        return state.events.length > eventsBefore;
      }
    });
  } catch (err) {
    return errorResponse(err, body.lang);
  }
  if (failure) return errorResponse(failure, body.lang);
  if (!turn) return errorResponse(new Error('turn did not complete'), body.lang);
  return json({ reply: turn.reply, mid: turn.mid, ref: turn.ref ?? null, chips: turn.chips, board: buildBoard(now, savedState, body.lang, calendar) });
};
