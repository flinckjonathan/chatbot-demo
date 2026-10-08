// GET /api/board?session=<uuid>&lang=en. The counter view for a session on
// page load; after each chat turn the board travels with the reply.

import { buildBoard } from '../../src/agent/board.ts';
import { LANGS, type Lang } from '../../src/booking/types.ts';
import { storeFor, type Env } from './chat.ts';

const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const session = (url.searchParams.get('session') ?? '').toLowerCase();
  const langParam = url.searchParams.get('lang') ?? 'en';
  const lang: Lang = (LANGS as readonly string[]).includes(langParam) ? (langParam as Lang) : 'en';
  if (!SESSION_ID.test(session)) {
    return new Response(JSON.stringify({ code: 'invalid', error: 'session must be a UUID' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  const state = await storeFor(env).get(session);
  return new Response(JSON.stringify({ board: buildBoard(new Date(), state, lang), fake: env.CHAT_FAKE === '1' }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};
