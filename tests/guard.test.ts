import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText } from '../src/booking/rules.ts';
import { MAX_IMAGE_BYTES, parseChatBody, parseImages, parseLang, parseSessionId, sniffImageType } from '../src/guard/input.ts';
import { checkRate, visitorKey } from '../src/guard/rateLimit.ts';
import { MemoryStore } from '../src/store/store.ts';
import { TINY_JPEG, TINY_PNG } from './fixtures.ts';

const SESSION = '123E4567-E89B-12D3-A456-426614174000';

test('parseChatBody cleans and normalises a request', () => {
  const r = parseChatBody({ session: SESSION, lang: 'fi', message: '  hello\u0007 there  ' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.body, { sessionId: SESSION.toLowerCase(), lang: 'fi', message: 'hello there', images: [] });
});

test('parseChatBody rejects what it cannot use', () => {
  assert.equal(parseChatBody(null).ok, false);
  assert.equal(parseChatBody({ session: 'abc', message: 'hi' }).ok, false);
  assert.equal(parseChatBody({ session: SESSION, message: '   ' }).ok, false);
  const long = parseChatBody({ session: SESSION, message: 'x'.repeat(5000) });
  assert.equal(long.ok && long.body.message.length, 1500);
});

test('pictures are typed by their bytes and a picture alone is a valid message', () => {
  assert.equal(sniffImageType(TINY_JPEG), 'image/jpeg');
  assert.equal(sniffImageType(TINY_PNG), 'image/png');
  assert.equal(sniffImageType(btoa('GIF89a....')), 'image/gif');
  assert.equal(sniffImageType(btoa('RIFF....WEBPVP8 ')), 'image/webp');
  assert.equal(sniffImageType(btoa('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(sniffImageType('not base64 at all!'), null);

  const withDataUrl = parseChatBody({ session: SESSION, message: '', images: [`data:image/png;base64,${TINY_PNG}`] });
  assert.equal(withDataUrl.ok, true);
  if (withDataUrl.ok) {
    assert.equal(withDataUrl.body.message, '');
    assert.deepEqual(withDataUrl.body.images, [{ mediaType: 'image/png', data: TINY_PNG }]);
  }
  const claimsPng = parseImages([`data:image/png;base64,${TINY_JPEG}`]);
  assert.equal(claimsPng?.[0]?.mediaType, 'image/jpeg', 'the client claim is ignored');
});

test('bad pictures reject the whole request', () => {
  assert.equal(parseImages([TINY_JPEG, TINY_JPEG, TINY_JPEG]), null, 'at most two');
  assert.equal(parseImages([42]), null);
  assert.equal(parseImages(['']), null);
  assert.equal(parseImages([btoa('plain text')]), null);
  assert.equal(parseImages(['A'.repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4)]), null, 'over 3 MB');
  assert.deepEqual(parseImages(undefined), []);
  assert.equal(parseChatBody({ session: SESSION, message: 'hi', images: [btoa('plain text')] }).ok, false);
});

test('cleanText cuts before it scans and still collapses whitespace inside the slack', () => {
  const noisy = `a${' '.repeat(20)}b`;
  assert.equal(cleanText(noisy, 10), 'a b');
  assert.equal(cleanText('x'.repeat(100_000), 10).length, 10);
  assert.equal(cleanText(42, 10), '');
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
  assert.deepEqual(await checkRate(store, 'a', now(), limits), { ok: false, scope: 'visitor', max: 2 });
  assert.deepEqual(await checkRate(store, 'a', now(), limits), { ok: false, scope: 'visitor', max: 2 });
  assert.deepEqual(await checkRate(store, 'b', now(), limits), { ok: true });
  assert.deepEqual(await checkRate(store, 'c', now(), limits), { ok: false, scope: 'global', max: 3 });
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
