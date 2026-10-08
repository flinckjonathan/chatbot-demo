// GET /api/board?session=<uuid>&lang=en. The counter view for a session on
// page load; after each chat turn the board travels with the reply.

import { buildBoard } from '../../src/agent/board.ts';
import { calendar, json, storeFor, type Env } from '../../src/app.ts';
import { parseLang, parseSessionId } from '../../src/guard/input.ts';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const session = parseSessionId(url.searchParams.get('session'));
  if (!session) return json({ code: 'invalid', error: 'session must be a UUID' }, 400);
  const lang = parseLang(url.searchParams.get('lang'));
  const state = await storeFor(env).get(session);
  return json({ board: buildBoard(new Date(), state, lang, calendar), fake: env.CHAT_FAKE === '1' });
};
