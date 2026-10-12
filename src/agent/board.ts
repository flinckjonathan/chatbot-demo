// The board view: the week board the service desk would look at, built
// from the same calendar the agent uses. Free times are shown for the
// smallest booking step; bookings of this conversation appear as blocks.
// Every label is formatted here, so the browser never has to know the zone.

import type { CalendarFactory } from '../booking/calendar.ts';
import { addDays, clockLabel, dayLabel, parseIso, toLocal, weekdayOf } from '../booking/clock.ts';
import { WORK_MIN } from '../booking/duration.ts';
import { MECHANICS } from '../booking/mechanics.ts';
import type { Lang } from '../booking/types.ts';
import type { AgentEvent, SessionState } from '../store/store.ts';

export const BOARD_DAYS = 5;

export interface BoardDay {
  date: string;
  /** "Mon 13.10." */
  label: string;
  /** Beyond the next working days; shown because a booking landed there. */
  later: boolean;
}

export interface BoardBlock {
  ref: string;
  start: string;
  end: string;
  label: string;
}

export interface BoardCell {
  mechanicId: string;
  date: string;
  /** Free start times as "9.00". */
  free: string[];
  booked: BoardBlock[];
}

export interface BoardEvent extends AgentEvent {
  /** "20.33" in workshop time. */
  time: string;
}

/** What the browser renders. Bookings appear as blocks in the cells; names never leave the server. */
export interface Board {
  days: BoardDay[];
  mechanics: { id: string; name: string; title: string }[];
  cells: BoardCell[];
  events: BoardEvent[];
}

/** The next working days starting today (today included when it is a weekday). */
export function workingDays(now: Date, count = BOARD_DAYS): string[] {
  const out: string[] = [];
  let date = toLocal(now).date;
  while (out.length < count) {
    if (weekdayOf(date) <= 5) out.push(date);
    date = addDays(date, 1);
  }
  return out;
}

/** The next working days, plus any later day a booking of this session landed on. */
function boardDates(now: Date, state: SessionState): { date: string; later: boolean }[] {
  const near = workingDays(now);
  const last = near[near.length - 1] ?? '';
  const later = [...new Set(state.bookings.map((b) => b.date).filter((d) => d > last))].sort();
  return [...near.map((date) => ({ date, later: false })), ...later.map((date) => ({ date, later: true }))];
}

export function buildBoard(now: Date, state: SessionState, lang: Lang, calendarFactory: CalendarFactory): Board {
  const calendar = calendarFactory(now, state.bookings);
  const days = boardDates(now, state);
  const dates = days.map((d) => d.date);
  const cells: BoardCell[] = [];
  for (const m of MECHANICS) {
    for (const date of dates) {
      cells.push({
        mechanicId: m.id,
        date,
        free: calendar.freeSlots(m.id, WORK_MIN, date, date).map((s) => clockLabel(s.startMin)),
        booked: state.bookings
          .filter((b) => b.mechanicId === m.id && b.date === date)
          .map((b) => ({
            ref: b.ref,
            start: clockLabel(b.startMin),
            end: clockLabel(b.endMin),
            label: `${b.issueType} ${b.workMin} min, ${b.vehicle}`,
          })),
      });
    }
  }
  return {
    days: days.map((d) => ({ date: d.date, label: dayLabel(d.date, lang), later: d.later })),
    mechanics: MECHANICS.map((m) => ({ id: m.id, name: m.name, title: m.title })),
    cells,
    events: state.events.map((e) => {
      const at = parseIso(e.at);
      return { ...e, time: at ? clockLabel(toLocal(at).minutes) : '' };
    }),
  };
}
