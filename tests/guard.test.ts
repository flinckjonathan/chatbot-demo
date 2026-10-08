import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChatBody, parseLang, parseSessionId } from '../src/guard/input.ts';
import { checkRate, visitorKey } from '../src/guard/rateLimit.ts';
import { MemoryStore } from '../src/store/store.ts';

const SESSION = '123E4567-E89B-12D3-A456-426614174000';

test('parseChatBody cleans and normalises a request', () => {
  const r = parseChatBody({ session: SESSION, lang: 'fi', message: '  hello\u0007 there  ' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.body, { sessionId: SESSION.toLowerCase(), lang: 'fi', message: 'hello there' });
});

test('parseChatBody rejects what it cannot use', () => {
  assert.equal(parseChatBody(null).ok, false);
  assert.equal(parseChatBody({ session: 'abc', message: 'hi' }).ok, false);
  assert.equal(parseChatBody({ session: SESSION, message: '   ' }).ok, false);
  const long = parseChatBody({ session: SESSION, message: 'x'.repeat(5000) });
  assert.equal(long.ok && long.body.message.length, 1000);
});

test('lang falls back to English for anything that is not one of the three strings', () => {
  assert.equal(parseLang('sv'), 'sv');
  assert.equal(parseLang('xx'), 'en');
  assert.equal(parseLang(['fi']), 'en');
  assert.equal(parseLang({ toString: () => 'fi' }), 'en');
  assert.equal(parseLang(null), 'en');
});

test('session ids are UUIDs, lower-cased', () => {
  assert.equal(parseSessionId(SESSION), SESSION.toLowerCase());
  assert.equal(parseSessionId('not-a-uuid'), '');
  assert.equal(parseSessionId(42), '');
});

test('rate limits count per visitor first, then globally', async () => {
  let t = 1_000_000_000_000;
  const store = new MemoryStore(() => t);
  const now = () => new Date(t);
  const limits = { perVisitor: { max: 2, windowSec: 600 }, global: { max: 3, windowSec: 86400 } };
  assert.deepEqual(await checkRate(store, 'a', now(), limits), { ok: true });
  assert.deepEqual(await checkRate(store, 'a', now(), limits), { ok: true });
  // Rejected at the visitor level: must not consume the global budget.
  assert.deepEqual(await checkRate(store, 'a', now(), limits), { ok: false, scope: 'visitor' });
  assert.deepEqual(await checkRate(store, 'a', now(), limits), { ok: false, scope: 'visitor' });
  assert.deepEqual(await checkRate(store, 'b', now(), limits), { ok: true });
  assert.deepEqual(await checkRate(store, 'c', now(), limits), { ok: false, scope: 'global' });
  t += 86400 * 1000;
  assert.deepEqual(await checkRate(store, 'c', now(), limits), { ok: true });
});

test('visitor keys are stable, salted and do not contain the IP', async () => {
  const a = await visitorKey('203.0.113.7', 'salt');
  assert.equal(a, await visitorKey('203.0.113.7', 'salt'));
  assert.notEqual(a, await visitorKey('203.0.113.7', 'other salt'));
  assert.doesNotMatch(a, /203/);
  assert.equal(a.length, 24);
});
