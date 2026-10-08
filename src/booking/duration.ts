// Work time and calendar block. "Duration" means two things and they live
// here on purpose: WORK TIME is the mechanic's hands-on minutes, chosen from
// the issue type and clamped to a sane range; the CALENDAR BLOCK is what the
// booking takes from the day: work time plus handling time plus any break it
// runs across.

import type { IssueType } from './types.ts';

export const HANDLING_MIN = 15; // moving the car, paperwork
export const WORK_MIN = 30; // one booking step; a brake pad change is a valid 30 min repair
export const WORK_MAX = 240; // ceiling for suggestions, several jobs in one visit
export const WORK_STEP = 30;

export const DAY_START = 8 * 60;
export const DAY_END = 16 * 60;
export const STEP = 30;

/** Lunch break: no job starts inside it and a block running across it grows by it. */
export const BREAKS: ReadonlyArray<{ start: number; end: number }> = [{ start: 11 * 60, end: 11 * 60 + 45 }];

export const DEFAULT_WORK: Readonly<Record<IssueType, number>> = {
  service: 120,
  repair: 120,
  ev_hybrid: 120,
  inspection: 90,
  ac: 90,
  diagnostics: 60,
  tyres: 30,
  other: 60,
};

/**
 * Work minutes for an issue. The model's suggestion is accepted when it is
 * a number in WORK_MIN ... WORK_MAX, rounded to the step; anything else
 * means the default.
 */
export function workMinutes(issue: IssueType, suggested: unknown = 0): number {
  const fallback = DEFAULT_WORK[issue];
  if (typeof suggested !== 'number' || !Number.isFinite(suggested) || suggested <= 0) return fallback;
  const stepped = Math.round(suggested / WORK_STEP) * WORK_STEP;
  return Math.max(WORK_MIN, Math.min(WORK_MAX, stepped));
}

export function inBreak(minute: number): boolean {
  return BREAKS.some((b) => minute >= b.start && minute < b.end);
}

/** End of the calendar block for a job starting at `start` (minutes of day). */
export function blockEnd(start: number, workMin: number): number {
  let end = start + workMin + HANDLING_MIN;
  for (const b of BREAKS) {
    if (b.start < end && b.end > start) end += b.end - b.start;
  }
  return end;
}
