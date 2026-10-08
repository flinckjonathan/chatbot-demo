// Request limits. The API key sits behind a public page, so the limits are
// the cost ceiling: a visitor gets a handful of messages per ten minutes and
// the whole demo has a daily cap. Windows are fixed buckets keyed by time,
// which is simple and good enough for a demo.

import type { Counter } from '../store/store.ts';

export interface RateLimits {
  perVisitor: { max: number; windowSec: number };
  global: { max: number; windowSec: number };
}

export const DEFAULT_LIMITS: RateLimits = {
  perVisitor: { max: 12, windowSec: 10 * 60 },
  global: { max: 400, windowSec: 24 * 60 * 60 },
};

export type RateVerdict = { ok: true } | { ok: false; scope: 'visitor' | 'global' };

export async function checkRate(
  counter: Counter,
  visitor: string,
  now: Date,
  limits: RateLimits = DEFAULT_LIMITS,
): Promise<RateVerdict> {
  const t = Math.floor(now.getTime() / 1000);
  // Visitor first: a request the visitor limit rejects must not eat the
  // daily budget, or one client could take the whole demo offline.
  const visitorBucket = Math.floor(t / limits.perVisitor.windowSec);
  const visitorCount = await counter.incr(`visitor:${visitor}:${visitorBucket}`, limits.perVisitor.windowSec);
  if (visitorCount > limits.perVisitor.max) return { ok: false, scope: 'visitor' };

  const globalBucket = Math.floor(t / limits.global.windowSec);
  const globalCount = await counter.incr(`global:${globalBucket}`, limits.global.windowSec);
  if (globalCount > limits.global.max) return { ok: false, scope: 'global' };

  return { ok: true };
}

/** Visitors are counted by a salted hash of the IP; the IP itself is never stored. */
export async function visitorKey(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}|${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}
