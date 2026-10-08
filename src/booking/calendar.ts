// Calendar seam. The agent, the booking core and the counter board only
// know this interface; the demo ships one implementation, a deterministic
// mock. A live adapter for a workshop management system would implement
// the same two methods and be swapped in at the composition root.

import { DAY_END, DAY_START, STEP, blockEnd, inBreak } from './duration.ts';
import { addDays, isDateString, localIso, offsetForDate, parseIso, toLocal, weekdayOf, type LocalTime } from './clock.ts';
import type { Booking, Slot } from './types.ts';

export interface Calendar {
  /** Bookable start times for one mechanic between two dates (inclusive), at most `limit`. */
  freeSlots(mechanicId: string, workMin: number, fromDate: string, toDate: string, limit?: number): Slot[];
  /** The slot behind a start time the model hands back, or null when it is not bookable. */
  findSlot(mechanicId: string, startIso: string, workMin: number): Slot | null;
}

export type CalendarFactory = (now: Date, bookings: readonly Booking[]) => Calendar;

/** Customers cannot book inside the next hour. */
export const LEAD_MINUTES = 60;
/** How far ahead the shop takes bookings. */
export const WINDOW_DAYS = 14;

export interface BookingWindow {
  from: string;
  to: string;
}

/**
 * The dates the shop takes bookings for: from today, or from a later date
 * the customer asked for, up to WINDOW_DAYS ahead. A requested date outside
 * the window falls back to today.
 */
export function bookingWindow(now: Date, requestedFrom?: unknown): BookingWindow {
  const today = toLocal(now).date;
  const to = addDays(today, WINDOW_DAYS);
  const from = isDateString(requestedFrom) && requestedFrom > today && requestedFrom <= to ? requestedFrom : today;
  return { from, to };
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

interface Block {
  mechanicId: string;
  date: string;
  startMin: number;
  endMin: number;
}

export class MockCalendar implements Calendar {
  private readonly nowLocal: LocalTime;
  private readonly blocks: readonly Block[];
  private readonly freeShare: number;

  constructor(now: Date, bookings: readonly Booking[] = [], freeShare = 40) {
    this.nowLocal = toLocal(now);
    this.blocks = bookings.map((b) => ({ mechanicId: b.mechanicId, date: b.date, startMin: b.startMin, endMin: b.endMin }));
    this.freeShare = freeShare;
  }

  freeSlots(mechanicId: string, workMin: number, fromDate: string, toDate: string, limit = Infinity): Slot[] {
    const out: Slot[] = [];
    const earliestToday = this.nowLocal.minutes + LEAD_MINUTES;
    const bookedOutUntil = addDays(this.nowLocal.date, BOOKED_OUT_DAYS[mechanicId] ?? 0);

    for (let date = fromDate; date <= toDate && out.length < limit; date = addDays(date, 1)) {
      if (date < this.nowLocal.date || date < bookedOutUntil || weekdayOf(date) > 5) continue;
      const offset = offsetForDate(date);
      for (let start = DAY_START; start < DAY_END && out.length < limit; start += STEP) {
        if (date === this.nowLocal.date && start < earliestToday) continue;
        if (inBreak(start)) continue;
        const end = blockEnd(start, workMin);
        if (end > DAY_END) continue;
        if (hash32(`${mechanicId}|${date}|${start}`) % 100 >= this.freeShare) continue;
        if (this.blocks.some((b) => b.mechanicId === mechanicId && b.date === date && start < b.endMin && end > b.startMin)) continue;
        out.push({
          mechanicId,
          date,
          startMin: start,
          endMin: end,
          start: localIso(date, start, offset),
          end: localIso(date, end, offset),
        });
      }
    }
    return out;
  }

  findSlot(mechanicId: string, startIso: string, workMin: number): Slot | null {
    const wanted = parseIso(startIso);
    if (!wanted) return null;
    // Instants are compared through local minutes: the model may hand the time back in UTC.
    const local = toLocal(wanted);
    return this.freeSlots(mechanicId, workMin, local.date, local.date).find((s) => s.startMin === local.minutes) ?? null;
  }
}

export const mockCalendarFactory: CalendarFactory = (now, bookings) => new MockCalendar(now, bookings);
