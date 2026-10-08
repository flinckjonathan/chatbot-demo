// Workshop wall-clock helpers for Europe/Helsinki. The booking domain
// thinks in local dates and minutes-of-day; ISO strings always carry the
// UTC offset so they stay unambiguous when they travel to the model and back.
// Every human label of a date or time is built here and nowhere else, so
// the model, the board and the log never disagree about the format.

import type { Lang, Moment } from './types.ts';

export const TIME_ZONE = 'Europe/Helsinki';

export interface LocalTime {
  /** YYYY-MM-DD */
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
}

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function parts(d: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of partsFormat.formatToParts(d)) out[p.type] = p.value;
  return out;
}

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toLocal(d: Date): LocalTime {
  const p = parts(d);
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Offset of the zone at instant d, in minutes east of UTC (120 or 180). */
export function offsetMinutes(d: Date): number {
  const p = parts(d);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUtc - d.getTime()) / 60000);
}

function splitDate(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y ?? 0, m ?? 1, d ?? 1];
}

/** The instant at which the workshop clock shows `date` and `minutes`. */
export function fromLocal(date: string, minutes: number): Date {
  const [y, m, d] = splitDate(date);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let t = guess - offsetMinutes(new Date(guess)) * 60000;
  // Second pass settles the DST transition days.
  t = guess - offsetMinutes(new Date(t)) * 60000;
  return new Date(t);
}

/** Offset on a date. DST switches at night, so one value serves the whole working day. */
export function offsetForDate(date: string): number {
  return offsetMinutes(fromLocal(date, 12 * 60));
}

/** ISO 8601 with offset, e.g. 2026-10-13T09:00:00+03:00. Pass the day's offset when building many. */
export function localIso(date: string, minutes: number, offset = offsetForDate(date)): string {
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = splitDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 1 = Monday ... 7 = Sunday, from a YYYY-MM-DD string. */
export function weekdayOf(date: string): number {
  const [y, m, d] = splitDate(date);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** A real calendar date: Date.UTC would roll 2026-02-31 over to March, the round trip catches that. */
export function isDateString(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;
}

/** Parses an ISO timestamp that carries an offset or Z (Date.toISOString() output included). Null when invalid. */
export function parseIso(s: unknown): Date | null {
  if (typeof s !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?([+-]\d{2}:\d{2}|Z)$/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DAY_NAMES: Record<Lang, readonly string[]> = {
  fi: ['ma', 'ti', 'ke', 'to', 'pe', 'la', 'su'],
  sv: ['mån', 'tis', 'ons', 'tors', 'fre', 'lör', 'sön'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};

const AT: Record<Lang, string> = { fi: 'klo', sv: 'kl.', en: 'at' };

/** "ma 13.10." */
export function dayLabel(date: string, lang: Lang): string {
  const [, m, d] = splitDate(date);
  return `${DAY_NAMES[lang][weekdayOf(date) - 1] ?? ''} ${d}.${m}.`;
}

/** "9.00", the clock format used on the booking page, in emails and by the model. */
export function clockLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)}.${pad(minutes % 60)}`;
}

/** "ma 13.10. klo 9.00" for a slot or a booking. */
export function whenLabel(at: Moment, lang: Lang): string {
  return `${dayLabel(at.date, lang)} ${AT[lang]} ${clockLabel(at.startMin)}`;
}

/** The same label for an instant. */
export function timeLabel(d: Date, lang: Lang): string {
  const local = toLocal(d);
  return whenLabel({ date: local.date, startMin: local.minutes }, lang);
}
