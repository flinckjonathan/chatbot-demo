// Session state and counters behind one small interface. Production would
// have a workshop system and a database here; the demo keeps each visitor's
// bookings in KV for a day and forgets them. Tests use the in-memory version.

import type { Booking, ContactRequest } from '../booking/types.ts';

/** One line in the "behind the counter" log: what the agent did and how it went. */
export interface AgentEvent {
  at: string;
  kind: 'lookup' | 'booking' | 'request' | 'blocked' | 'error';
  text: string;
}

export interface SessionState {
  bookings: Booking[];
  requests: ContactRequest[];
  events: AgentEvent[];
}

export function emptySession(): SessionState {
  return { bookings: [], requests: [], events: [] };
}

export interface SessionStore {
  get(sessionId: string): Promise<SessionState>;
  put(sessionId: string, state: SessionState): Promise<void>;
}

export interface Counter {
  /** Increments a counter that expires after ttlSec and returns the new value. */
  incr(key: string, ttlSec: number): Promise<number>;
}

export const SESSION_TTL_SEC = 24 * 60 * 60;
export const MAX_EVENTS = 40;

export class MemoryStore implements SessionStore, Counter {
  private sessions = new Map<string, SessionState>();
  private counters = new Map<string, { n: number; expires: number }>();
  private readonly clock: () => number;

  constructor(clock: () => number = () => Date.now()) {
    this.clock = clock;
  }

  async get(sessionId: string): Promise<SessionState> {
    const s = this.sessions.get(sessionId);
    return s ? structuredClone(s) : emptySession();
  }

  async put(sessionId: string, state: SessionState): Promise<void> {
    this.sessions.set(sessionId, structuredClone(state));
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    const now = this.clock();
    const cur = this.counters.get(key);
    const live = cur !== undefined && cur.expires > now;
    const n = live ? cur.n + 1 : 1;
    this.counters.set(key, { n, expires: live ? cur.expires : now + ttlSec * 1000 });
    return n;
  }
}

/** Minimal shape of a Cloudflare KV namespace, so src/ does not depend on worker types. */
export interface KvLike {
  get(key: string, type: 'text'): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/**
 * KV is eventually consistent and has no atomic increment. For a demo the
 * counters may be off by a request or two under concurrent load; the
 * conversation state is written by one visitor at a time, so it is fine.
 */
export class KvStore implements SessionStore, Counter {
  private readonly kv: KvLike;

  constructor(kv: KvLike) {
    this.kv = kv;
  }

  async get(sessionId: string): Promise<SessionState> {
    const raw = await this.kv.get(`session:${sessionId}`, 'text');
    if (!raw) return emptySession();
    try {
      const parsed = JSON.parse(raw) as Partial<SessionState>;
      return {
        bookings: Array.isArray(parsed.bookings) ? parsed.bookings : [],
        requests: Array.isArray(parsed.requests) ? parsed.requests : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
      };
    } catch {
      return emptySession();
    }
  }

  async put(sessionId: string, state: SessionState): Promise<void> {
    await this.kv.put(`session:${sessionId}`, JSON.stringify(state), { expirationTtl: SESSION_TTL_SEC });
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    const raw = await this.kv.get(`counter:${key}`, 'text');
    const n = (raw ? Number(raw) || 0 : 0) + 1;
    await this.kv.put(`counter:${key}`, String(n), { expirationTtl: Math.max(60, ttlSec) });
    return n;
  }
}
