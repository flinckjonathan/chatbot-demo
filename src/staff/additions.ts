// Staff additions: facts the staff writes for the bot. Production receives
// them by email and a person approves each one in the admin; the demo takes
// them from a form on the staff page. Nothing reaches the prompt without an
// approval, and an approval can be undone by hiding the item.

import { makeRef } from '../booking/ids.ts';
import { cleanText } from '../booking/rules.ts';
import type { Addition, AdditionStatus, SessionState } from '../store/store.ts';

export const MAX_ADDITIONS = 20;
export const MAX_ADDITION_CHARS = 2000;
export const MIN_ADDITION_CHARS = 10;

export const ADDITION_STATUSES: readonly AdditionStatus[] = ['pending', 'approved', 'hidden'];

export function isAdditionStatus(v: unknown): v is AdditionStatus {
  return typeof v === 'string' && (ADDITION_STATUSES as readonly string[]).includes(v);
}

export type AddResult = { ok: true; addition: Addition } | { ok: false; error: string };

export function addAddition(state: SessionState, rawText: unknown, now: Date): AddResult {
  const text = cleanText(rawText, MAX_ADDITION_CHARS);
  if (text.length < MIN_ADDITION_CHARS) return { ok: false, error: `Write at least ${MIN_ADDITION_CHARS} characters.` };
  if (state.additions.length >= MAX_ADDITIONS) return { ok: false, error: `At most ${MAX_ADDITIONS} additions per session.` };
  const addition: Addition = { id: makeRef('A'), text, status: 'pending', createdAt: now.toISOString() };
  state.additions.push(addition);
  return { ok: true, addition };
}

export function setAdditionStatus(state: SessionState, id: string, status: AdditionStatus): boolean {
  const item = state.additions.find((a) => a.id === id);
  if (!item) return false;
  item.status = status;
  return true;
}

export function deleteAddition(state: SessionState, id: string): boolean {
  const index = state.additions.findIndex((a) => a.id === id);
  if (index < 0) return false;
  state.additions.splice(index, 1);
  return true;
}

export function approvedAdditions(state: SessionState): Addition[] {
  return state.additions.filter((a) => a.status === 'approved');
}
