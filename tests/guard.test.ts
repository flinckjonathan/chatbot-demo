import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChatRequest } from '../src/guard/input.ts';
import { checkRate, visitorKey } from '../src/guard/rateLimit.ts';
import { MemoryStore } from '../src/store/store.ts';

const SESSION = '123E4567-E89B-12D3-A456-426614174000';

test('parseChatRequest cleans and normalises a request', () => {
  const r = parseChatRequest({
    session: SESSION,
    lang: 'xx',
    message: '  hello\u0007 there  ',
    history: [
      { role: 'assistant', text: 'Hi, how can I help?' },
      { role: 'user', text: 'first' },
      { role: 'user', text: 'second' },
      { role: 'assistant', text: 'answer' },
      { role: 'user', text: 'dangling' },
      { role: 'robot', text: 'ignored' },
    ],
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.request.sessionId, SESSION.toLowerCase());
  assert.equal(r.request.lang, 'en');
  assert.equal(r.request.message, 'hello there');
  assert.deepEqual(r.request.history, [
    { role: 'user', text: 'first\nsecond' },
    { role: 'assistant', text: 'answer' },
  ]);
});

test('parseChatRequest rejects what it cannot use', () => {
  assert.equal(parseChatRequest(null).ok, false);
  assert.equal(parseChatRequest({ session: 'abc', message: 'hi' }).ok, false);
  assert.equal(parseChatRequest({ session: SESSION, message: '   ' }).ok, false);
  const long = parseChatRequest({ session: SESSION, message: 'x'.repeat(5000) });
  assert.equal(long.ok && long.request.message.length, 1000);
});

test('rate limits count per visitor and globally', async () => {
  let t = 1_000_000_000_000;
  const store = new MemoryStore(() => t);
  const now = () => new Date(t);
  const limits = { perVisitor: { max: 2, windowSec: 600 }, global: { max: 3, windowSec: 86400 } };
  assert.deepEqual(await checkRate(store, 'a', now(), limits), { ok: true });
  assert.deepEqual(await checkRate(store, 'a', now(), limits), { ok: true });
  assert.deepEqual(await checkRate(store, 'a', now(), limits), { ok: false, scope: 'visitor' });
  assert.deepEqual(await checkRate(store, 'b', now(), limits), { ok: false, scope: 'global' });
  t += 86400 * 1000;
  assert.deepEqual(await checkRate(store, 'b', now(), limits), { ok: true });
});

test('visitor keys are stable, salted and do not contain the IP', async () => {
  const a = await visitorKey('203.0.113.7', 'salt');
  assert.equal(a, await visitorKey('203.0.113.7', 'salt'));
  assert.notEqual(a, await visitorKey('203.0.113.7', 'other salt'));
  assert.doesNotMatch(a, /203/);
  assert.equal(a.length, 24);
});
