// Session state and counters behind one small interface. Production would
// have a workshop system and a database here; the demo keeps each visitor's
// bookings in KV for a day and forgets them. Tests use the in-memory version.

import type { Booking, ContactRequest } from '../booking/types.ts';

/** One line in the staff log: what the agent did and how it went. */
export interface AgentEvent {
  at: string;
  kind: 'lookup' | 'booking' | 'request' | 'blocked' | 'error' | 'feedback';
  text: string;
}

/** One completed turn of the conversation, text only. Assistant turns carry their message id. */
export interface HistoryItem {
  role: 'user' | 'assistant';
  text: string;
  mid?: string;
}

export type AdditionStatus = 'pending' | 'approved' | 'hidden';

/** A fact the staff wrote for the bot. Only approved ones reach the prompt. */
export interface Addition {
  id: string;
  text: string;
  status: AdditionStatus;
  createdAt: string;
}

export interface SessionState {
  bookings: Booking[];
  requests: ContactRequest[];
  events: AgentEvent[];
  /** The last turns, appended in user/assistant pairs by the agent. */
  transcript: HistoryItem[];
  additions: Addition[];
  /** Thumbs by message id. */
  feedback: Record<string, 'up' | 'down'>;
}

export function emptySession(): SessionState {
  return { bookings: [], requests: [], events: [], transcript: [], additions: [], feedback: {} };
}

export const SESSION_TTL_SEC = 24 * 60 * 60;
export const MAX_EVENTS = 40;
export const MAX_TRANSCRIPT = 12;
export const MAX_TRANSCRIPT_CHARS = 1500;

/** Keeps the state bounded: the newest MAX_EVENTS log lines and MAX_TRANSCRIPT turns. */
export function trimSession(state: SessionState): void {
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
  if (state.transcript.length > MAX_TRANSCRIPT) state.transcript.splice(0, state.transcript.length - MAX_TRANSCRIPT);
}

export interface SessionStore {
  get(sessionId: string): Promise<SessionState>;
  put(sessionId: string, state: SessionState): Promise<void>;
  /**
   * Serializes read-modify-write updates within one isolate. KV cannot make
   * this atomic across Cloudflare isolates, but every handler should still use
   * this instead of open-coded get/put so same-isolate requests do not lose data.
   */
  update(sessionId: string, mutate: (state: SessionState) => boolean | Promise<boolean>): Promise<SessionState>;
}

export interface Counter {
  /** Increments a counter that expires after ttlSec and returns the new value. */
  incr(key: string, ttlSec: number): Promise<number>;
}

type SessionMutator = (state: SessionState) => boolean | Promise<boolean>;

function enqueueSessionUpdate(
  chains: Map<string, Promise<SessionState>>,
  sessionId: string,
  run: () => Promise<SessionState>,
): Promise<SessionState> {
  const previous = chains.get(sessionId) ?? Promise.resolve(emptySession());
  const next = previous.catch(() => emptySession()).then(run);
  chains.set(sessionId, next);
  return next.finally(() => {
    if (chains.get(sessionId) === next) chains.delete(sessionId);
  });
}

export class MemoryStore implements SessionStore, Counter {
  private sessions = new Map<string, SessionState>();
  private counters = new Map<string, { n: number; expires: number }>();
  private sessionChains = new Map<string, Promise<SessionState>>();
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

  update(sessionId: string, mutate: SessionMutator): Promise<SessionState> {
    return enqueueSessionUpdate(this.sessionChains, sessionId, async () => {
      const state = await this.get(sessionId);
      const save = await mutate(state);
      trimSession(state);
      if (save) await this.put(sessionId, state);
      return structuredClone(state);
    });
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

function arrayOf<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * KV is eventually consistent and has no atomic increment. For a demo the
 * counters may be off by a request or two under concurrent load; the
 * conversation state is written by one visitor at a time, so it is fine.
 */
export class KvStore implements SessionStore, Counter {
  private readonly kv: KvLike;
  private readonly sessionChains = new Map<string, Promise<SessionState>>();

  constructor(kv: KvLike) {
    this.kv = kv;
  }

  async get(sessionId: string): Promise<SessionState> {
    const raw = await this.kv.get(`session:${sessionId}`, 'text');
    if (!raw) return emptySession();
    try {
      const parsed = JSON.parse(raw) as Partial<SessionState>;
      return {
        // A booking written by an older build lacks the minute fields; drop it rather than crash the board.
        bookings: arrayOf<Booking>(parsed.bookings).filter((b) => typeof b.startMin === 'number'),
        requests: arrayOf(parsed.requests),
        events: arrayOf(parsed.events),
        transcript: arrayOf(parsed.transcript),
        additions: arrayOf(parsed.additions),
        feedback: parsed.feedback && typeof parsed.feedback === 'object' ? parsed.feedback : {},
      };
    } catch {
      return emptySession();
    }
  }

  async put(sessionId: string, state: SessionState): Promise<void> {
    await this.kv.put(`session:${sessionId}`, JSON.stringify(state), { expirationTtl: SESSION_TTL_SEC });
  }

  update(sessionId: string, mutate: SessionMutator): Promise<SessionState> {
    return enqueueSessionUpdate(this.sessionChains, sessionId, async () => {
      const state = await this.get(sessionId);
      const save = await mutate(state);
      trimSession(state);
      if (save) await this.put(sessionId, state);
      return structuredClone(state);
    });
  }

  async incr(key: string, ttlSec: number): Promise<number> {
    const raw = await this.kv.get(`counter:${key}`, 'text');
    const n = (raw ? Number(raw) || 0 : 0) + 1;
    await this.kv.put(`counter:${key}`, String(n), { expirationTtl: Math.max(60, ttlSec) });
    return n;
  }
}
