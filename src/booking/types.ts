// Vocabulary of the booking domain. Everything that crosses a module
// boundary is one of these shapes.

export const ISSUE_TYPES = [
  'service',
  'repair',
  'ev_hybrid',
  'inspection',
  'ac',
  'diagnostics',
  'tyres',
  'other',
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export function isIssueType(v: unknown): v is IssueType {
  return typeof v === 'string' && (ISSUE_TYPES as readonly string[]).includes(v);
}

export const POWERTRAINS = ['', 'petrol', 'diesel', 'hybrid', 'ev'] as const;
export type Powertrain = (typeof POWERTRAINS)[number];

export function isPowertrain(v: unknown): v is Powertrain {
  return typeof v === 'string' && (POWERTRAINS as readonly string[]).includes(v);
}

export const LANGS = ['fi', 'sv', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}

export interface Mechanic {
  id: string;
  name: string;
  title: string;
  skills: readonly IssueType[];
}

/** A moment in the workshop day: calendar date plus minutes since midnight. */
export interface Moment {
  date: string;
  startMin: number;
}

/**
 * A bookable start time for one mechanic. The minutes are what the calendar
 * computes with; the ISO strings (with offset) are what travels to the model
 * and comes back in create_booking.
 */
export interface Slot extends Moment {
  mechanicId: string;
  endMin: number;
  start: string;
  end: string;
}

export interface Booking extends Moment {
  ref: string;
  mechanicId: string;
  endMin: number;
  start: string;
  end: string;
  workMin: number;
  issueType: IssueType;
  name: string;
  phone: string;
  email: string;
  vehicle: string;
  description: string;
  createdAt: string;
}

export interface ContactRequest {
  ref: string;
  name: string;
  phone: string;
  email: string;
  vehicle: string;
  issueType: IssueType;
  description: string;
  timing: string;
  createdAt: string;
}

export type RejectedField =
  | 'consent'
  | 'contact'
  | 'vehicle'
  | 'issue'
  | 'description'
  | 'mechanic'
  | 'slot';

/**
 * Outcome of a booking attempt. Callers switch on `state` instead of
 * interpreting flags; the message is written for the model, which turns it
 * into a sentence for the customer.
 */
export type BookingResult =
  | { state: 'booked'; booking: Booking }
  | { state: 'rejected'; field: RejectedField; message: string }
  | { state: 'unavailable'; reason: 'past' | 'outside_window' | 'gone'; message: string };

export type ContactResult =
  | { state: 'sent'; request: ContactRequest }
  | { state: 'rejected'; field: RejectedField; message: string };
