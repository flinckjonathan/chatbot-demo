// Workshop wall-clock helpers for Europe/Helsinki. The booking domain
// thinks in local dates and minutes-of-day; ISO strings always carry the
// UTC offset so they stay unambiguous when they travel to the model and back.

export const TIME_ZONE = 'Europe/Helsinki';

export interface LocalTime {
  /** YYYY-MM-DD */
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
  /** 1 = Monday ... 7 = Sunday */
  weekday: number;
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
  weekday: 'short',
});

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

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
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    weekday: WEEKDAYS[p.weekday ?? ''] ?? 0,
  };
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

/** ISO 8601 with offset, e.g. 2026-10-13T09:00:00+03:00. */
export function localIso(date: string, minutes: number): string {
  const off = offsetMinutes(fromLocal(date, minutes));
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
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

export function isDateString(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

/** Parses an ISO timestamp that carries an offset or Z. Null when invalid. */
export function parseIso(s: unknown): Date | null {
  if (typeof s !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DAY_NAMES: Record<'fi' | 'sv' | 'en', readonly string[]> = {
  fi: ['ma', 'ti', 'ke', 'to', 'pe', 'la', 'su'],
  sv: ['mån', 'tis', 'ons', 'tors', 'fre', 'lör', 'sön'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};

/**
 * Human label in workshop time, same shape in every language so the model
 * and the UI never disagree about the format: "ma 13.10. klo 9.00".
 */
export function timeLabel(d: Date, lang: 'fi' | 'sv' | 'en'): string {
  const local = toLocal(d);
  const [, m, day] = splitDate(local.date);
  const name = DAY_NAMES[lang][local.weekday - 1] ?? '';
  const clock = `${Math.floor(local.minutes / 60)}.${pad(local.minutes % 60)}`;
  const at = lang === 'fi' ? 'klo' : lang === 'sv' ? 'kl.' : 'at';
  return `${name} ${day}.${m}. ${at} ${clock}`;
}
