// Vocabulary of the booking domain. Everything that crosses a module
// boundary is one of these shapes.

export const ISSUE_TYPES = [
  'service',
  'repair',
  'ev_hybrid',
  'inspection',
  'ac',
  'diagnostics',
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

export type Lang = 'fi' | 'sv' | 'en';
export const LANGS: readonly Lang[] = ['fi', 'sv', 'en'];

export interface Mechanic {
  id: string;
  name: string;
  title: string;
  skills: readonly IssueType[];
}

/** A bookable start time for one mechanic. ISO strings carry the offset. */
export interface Slot {
  mechanicId: string;
  start: string;
  end: string;
}

export interface Booking {
  ref: string;
  mechanicId: string;
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
