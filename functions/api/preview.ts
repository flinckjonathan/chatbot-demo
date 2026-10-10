// GET /api/preview?session=...&lang=en. The prompt the bot would get right
// now for this session, section by section, plus the tool list.

import { buildPreview } from '../../src/agent/preview.ts';
import { json, storeFor, type Env } from '../../src/app.ts';
import { parseLang, parseSessionId } from '../../src/guard/input.ts';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const session = parseSessionId(url.searchParams.get('session'));
  if (!session) return json({ code: 'invalid', error: 'session must be a UUID' }, 400);
  const state = await storeFor(env).get(session);
  return json(buildPreview(new Date(), state, parseLang(url.searchParams.get('lang'))));
};
