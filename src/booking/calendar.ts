// Calendar seam. The agent and the booking core only know this interface;
// the demo ships one implementation, a deterministic mock. A live adapter
// for a workshop management system would implement the same two methods.

import { DAY_END, DAY_START, STEP, blockEnd, inBreak } from './duration.ts';
import { addDays, localIso, parseIso, toLocal, weekdayOf } from './clock.ts';
import type { Booking, Slot } from './types.ts';

export interface Calendar {
  /** Bookable start times for one mechanic between two dates (inclusive). */
  freeSlots(mechanicId: string, workMin: number, fromDate: string, toDate: string): Slot[];
  /** Whether a start time the model hands back is still bookable. */
  isFree(mechanicId: string, startIso: string, workMin: number): boolean;
}

/** Customers cannot book inside the next hour. */
export const LEAD_MINUTES = 60;
/** How far ahead the shop takes bookings. */
export const WINDOW_DAYS = 14;

export function bookingWindow(now: Date): { from: string; to: string } {
  const today = toLocal(now).date;
  return { from: today, to: addDays(today, WINDOW_DAYS) };
}

/** FNV-1a, so the same slot is free on every page load without a database. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Some mechanics have no free time for the first days. This makes the
 * "earliest time differs per mechanic" path visible in every demo session.
 */
const BOOKED_OUT_DAYS: Readonly<Record<string, number>> = { aino: 3 };

export class MockCalendar implements Calendar {
  private readonly now: Date;
  private readonly bookings: readonly Booking[];
  private readonly freeShare: number;

  constructor(now: Date, bookings: readonly Booking[] = [], freeShare = 40) {
    this.now = now;
    this.bookings = bookings;
    this.freeShare = freeShare;
  }

  freeSlots(mechanicId: string, workMin: number, fromDate: string, toDate: string): Slot[] {
    const out: Slot[] = [];
    const nowLocal = toLocal(this.now);
    const earliestToday = nowLocal.minutes + LEAD_MINUTES;
    const bookedOutUntil = addDays(nowLocal.date, BOOKED_OUT_DAYS[mechanicId] ?? 0);

    for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
      if (date < nowLocal.date || date < bookedOutUntil || weekdayOf(date) > 5) continue;
      for (let start = DAY_START; start < DAY_END; start += STEP) {
        if (date === nowLocal.date && start < earliestToday) continue;
        if (inBreak(start)) continue;
        const end = blockEnd(start, workMin);
        if (end > DAY_END) continue;
        if (hash32(`${mechanicId}|${date}|${start}`) % 100 >= this.freeShare) continue;
        if (this.overlapsBooking(mechanicId, date, start, end)) continue;
        out.push({ mechanicId, start: localIso(date, start), end: localIso(date, end) });
      }
    }
    return out;
  }

  isFree(mechanicId: string, startIso: string, workMin: number): boolean {
    const wanted = parseIso(startIso);
    if (!wanted) return false;
    const date = toLocal(wanted).date;
    return this.freeSlots(mechanicId, workMin, date, date).some(
      (s) => parseIso(s.start)?.getTime() === wanted.getTime(),
    );
  }

  private overlapsBooking(mechanicId: string, date: string, start: number, end: number): boolean {
    return this.bookings.some((b) => {
      if (b.mechanicId !== mechanicId) return false;
      const bs = parseIso(b.start);
      const be = parseIso(b.end);
      if (!bs || !be) return false;
      const ls = toLocal(bs);
      if (ls.date !== date) return false;
      const le = toLocal(be);
      return start < le.minutes && end > ls.minutes;
    });
  }
}
