// Request limits. The API key sits behind a public page, so the limits are
// the cost ceiling: a visitor gets a few messages a day (enough for one
// booking and a question or two) and the whole demo has a daily cap. Both
// numbers can be set as environment variables. Windows are fixed buckets
// keyed by time, which is simple and good enough for a demo.

import type { Counter } from '../store/store.ts';

export interface RateLimits {
  perVisitor: { max: number; windowSec: number };
  global: { max: number; windowSec: number };
}

const DAY = 24 * 60 * 60;
export const MAX_CONFIGURED_PER_VISITOR = 50;
export const MAX_CONFIGURED_PER_DAY = 1000;

export const DEFAULT_LIMITS: RateLimits = {
  perVisitor: { max: 6, windowSec: DAY },
  global: { max: 50, windowSec: DAY },
};

/** The defaults, overridden by RATE_PER_VISITOR and RATE_PER_DAY when they are whole numbers. */
export function limitsFrom(env: { RATE_PER_VISITOR?: string; RATE_PER_DAY?: string }): RateLimits {
  const read = (value: string | undefined, fallback: number, cap: number): number =>
    value !== undefined && /^\d+$/.test(value) ? Math.min(Number(value), cap) : fallback;
  return {
    perVisitor: { max: read(env.RATE_PER_VISITOR, DEFAULT_LIMITS.perVisitor.max, MAX_CONFIGURED_PER_VISITOR), windowSec: DAY },
    global: { max: read(env.RATE_PER_DAY, DEFAULT_LIMITS.global.max, MAX_CONFIGURED_PER_DAY), windowSec: DAY },
  };
}

export type RateVerdict = { ok: true } | { ok: false; scope: 'visitor' | 'global'; max: number };

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
  if (visitorCount > limits.perVisitor.max) return { ok: false, scope: 'visitor', max: limits.perVisitor.max };

  const globalBucket = Math.floor(t / limits.global.windowSec);
  const globalCount = await counter.incr(`global:${globalBucket}`, limits.global.windowSec);
  if (globalCount > limits.global.max) return { ok: false, scope: 'global', max: limits.global.max };

  return { ok: true };
}

/** Visitors are counted by a salted hash of the IP; the IP itself is never stored. */
export async function visitorKey(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}|${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}
