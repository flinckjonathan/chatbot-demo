// The counter view: the week board the service desk would look at, built
// from the same calendar the agent uses. Free times are shown for the
// smallest booking step; bookings of this conversation appear as blocks.

import { mockCalendarFactory, type CalendarFactory } from '../booking/calendar.ts';
import { addDays, parseIso, toLocal, weekdayOf } from '../booking/clock.ts';
import { WORK_MIN } from '../booking/duration.ts';
import { MECHANICS } from '../booking/mechanics.ts';
import type { Lang } from '../booking/types.ts';
import type { AgentEvent, SessionState } from '../store/store.ts';

export const BOARD_DAYS = 5;

export interface BoardDay {
  date: string;
  /** "Mon 13.10." */
  label: string;
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

/** What the browser renders. Bookings appear as blocks in the cells; names never leave the server. */
export interface Board {
  days: BoardDay[];
  mechanics: { id: string; name: string; title: string }[];
  cells: BoardCell[];
  events: AgentEvent[];
}

const DAY_NAMES: Record<Lang, readonly string[]> = {
  fi: ['ma', 'ti', 'ke', 'to', 'pe', 'la', 'su'],
  sv: ['mån', 'tis', 'ons', 'tors', 'fre', 'lör', 'sön'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};

function clock(minutes: number): string {
  return `${Math.floor(minutes / 60)}.${String(minutes % 60).padStart(2, '0')}`;
}

function dayLabel(date: string, lang: Lang): string {
  const [, m, d] = date.split('-');
  return `${DAY_NAMES[lang][weekdayOf(date) - 1] ?? ''} ${Number(d)}.${Number(m)}.`;
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

export function buildBoard(
  now: Date,
  state: SessionState,
  lang: Lang,
  calendarFactory: CalendarFactory = mockCalendarFactory,
): Board {
  const calendar = calendarFactory(now, state.bookings);
  const dates = workingDays(now);
  const cells: BoardCell[] = [];
  for (const m of MECHANICS) {
    for (const date of dates) {
      const free = calendar.freeSlots(m.id, WORK_MIN, date, date).map((s) => {
        const d = parseIso(s.start);
        return d ? clock(toLocal(d).minutes) : s.start;
      });
      const booked = state.bookings
        .filter((b) => b.mechanicId === m.id && toLocal(parseIso(b.start) ?? now).date === date)
        .map((b) => {
          const s = parseIso(b.start);
          const e = parseIso(b.end);
          return {
            ref: b.ref,
            start: s ? clock(toLocal(s).minutes) : '',
            end: e ? clock(toLocal(e).minutes) : '',
            label: `${b.issueType} ${b.workMin} min, ${b.vehicle}`,
          };
        });
      cells.push({ mechanicId: m.id, date, free, booked });
    }
  }
  return {
    days: dates.map((date) => ({ date, label: dayLabel(date, lang) })),
    mechanics: MECHANICS.map((m) => ({ id: m.id, name: m.name, title: m.title })),
    cells,
    events: state.events,
  };
}
