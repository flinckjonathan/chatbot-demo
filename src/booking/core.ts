// Booking core: one entry point for anyone who wants to put a job in the
// calendar, and one for a contact request. Both clean and validate the raw
// input themselves through the same parsers, so a rule change is made once.
// Persisting the result is the caller's job (the agent writes it to the
// session store), which keeps this module free of I/O and easy to test.

import { bookingWindow, type Calendar } from './calendar.ts';
import { parseIso, toLocal } from './clock.ts';
import { DEFAULT_WORK, workMinutes } from './duration.ts';
import { makeRef } from './ids.ts';
import { suitableMechanics } from './mechanics.ts';
import { RULES, cleanRego, cleanText, validEmail, validPhone } from './rules.ts';
import {
  ISSUE_TYPES,
  isIssueType,
  isPowertrain,
  type Booking,
  type BookingResult,
  type ContactResult,
  type IssueType,
  type Powertrain,
  type RejectedField,
} from './types.ts';

/** Tool input as the model produced it. Every field may be missing or junk. */
export type RawInput = Record<string, unknown>;

/** Jobs the shop does not take through the agent, with the wording the model passes on. */
export const PHONE_ONLY: Readonly<Partial<Record<IssueType, string>>> = {
  tyres: 'Tyre changes and tyre storage are booked by phone only, not through the agent. Give the customer the phone number.',
};

/** "service 120, repair 120, ..." for the prompt and the tool descriptions. */
export function describeWorkTimes(): string {
  return ISSUE_TYPES.filter((issue) => !PHONE_ONLY[issue])
    .map((issue) => `${issue} ${DEFAULT_WORK[issue]}`)
    .join(', ');
}

export interface Rejection {
  field: RejectedField;
  message: string;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; rejection: Rejection };

function reject(field: RejectedField, message: string): Parsed<never> {
  return { ok: false, rejection: { field, message } };
}

interface Customer {
  name: string;
  phone: string;
  email: string;
  vehicle: string;
}

/** Name, how to reach the customer, and which car. A calendar booking needs a phone number. */
function parseCustomer(input: RawInput, phoneRequired: boolean): Parsed<Customer> {
  const name = cleanText(input.name, RULES.max.name);
  const phone = cleanText(input.phone, RULES.max.phone);
  const email = cleanText(input.email, RULES.max.email);
  if (!name) return reject('contact', 'Name is required.');
  if (phoneRequired && !phone) return reject('contact', 'A phone number is required for a calendar booking.');
  if (!phone && !email) return reject('contact', 'A phone number or an email address is required.');
  if (phone && !validPhone(phone)) return reject('contact', 'The phone number looks wrong. Check it with the customer.');
  if (email && !validEmail(email)) return reject('contact', 'The email address looks wrong. Check it with the customer or leave it empty.');
  const rego = cleanRego(input.rego);
  const makeModel = cleanText(input.make_model, RULES.max.makeModel);
  if (!rego && !makeModel) return reject('vehicle', 'Registration number or make and model is required.');
  return { ok: true, value: { name, phone, email, vehicle: [makeModel, rego].filter(Boolean).join(' ') } };
}

export interface Job {
  issue: IssueType;
  powertrain: Powertrain;
  workMin: number;
}

/** Issue type, powertrain and work time: shared by the time lookup and the booking. */
export function parseJob(input: RawInput): Parsed<Job> {
  if (!isIssueType(input.issue_type)) return reject('issue', 'issue_type is not one of the allowed values.');
  const issue = input.issue_type;
  const phoneOnly = PHONE_ONLY[issue];
  if (phoneOnly) return reject('issue', phoneOnly);
  const powertrain = isPowertrain(input.powertrain) ? input.powertrain : '';
  return { ok: true, value: { issue, powertrain, workMin: workMinutes(issue, input.duration_min) } };
}

function parseDescription(input: RawInput): Parsed<string> {
  const description = cleanText(input.description, RULES.max.description);
  if (description.length < RULES.descriptionMin) {
    return reject('description', `A short description of the job is required (at least ${RULES.descriptionMin} characters).`);
  }
  return { ok: true, value: description };
}

const NO_CONSENT = 'The customer has not confirmed yet. Show the summary and ask for an explicit yes.';

export function createBooking(input: RawInput, calendar: Calendar, now: Date): BookingResult {
  if (input.consent !== true) return { state: 'rejected', field: 'consent', message: NO_CONSENT };
  const customer = parseCustomer(input, true);
  if (!customer.ok) return { state: 'rejected', ...customer.rejection };
  const job = parseJob(input);
  if (!job.ok) return { state: 'rejected', ...job.rejection };
  const description = parseDescription(input);
  if (!description.ok) return { state: 'rejected', ...description.rejection };

  const { issue, powertrain, workMin } = job.value;
  const mechanicId = cleanText(input.mechanic_id, RULES.max.mechanicId);
  const suitable = suitableMechanics(issue, powertrain);
  if (!suitable.some((m) => m.id === mechanicId)) {
    const ids = suitable.map((m) => m.id).join(', ') || 'none';
    return { state: 'rejected', field: 'mechanic', message: `Mechanic "${mechanicId}" does not do this job. Suitable ids: ${ids}.` };
  }

  const startIso = typeof input.start === 'string' ? input.start : '';
  const start = parseIso(startIso);
  if (!start) {
    return { state: 'rejected', field: 'slot', message: 'start must be exactly one of the ISO times returned by get_available_times.' };
  }
  if (start.getTime() <= now.getTime()) {
    return { state: 'unavailable', reason: 'past', message: 'That time is already in the past.' };
  }
  const window = bookingWindow(now);
  if (toLocal(start).date > window.to) {
    return { state: 'unavailable', reason: 'outside_window', message: `The shop takes bookings up to ${window.to}. Offer an earlier time.` };
  }
  const slot = calendar.findSlot(mechanicId, startIso, workMin);
  if (!slot) {
    return { state: 'unavailable', reason: 'gone', message: 'That time is no longer free. Fetch the times again and offer another one.' };
  }

  const booking: Booking = {
    ref: makeRef('B'),
    mechanicId,
    date: slot.date,
    startMin: slot.startMin,
    endMin: slot.endMin,
    start: slot.start,
    end: slot.end,
    workMin,
    issueType: issue,
    ...customer.value,
    description: description.value,
    createdAt: now.toISOString(),
  };
  return { state: 'booked', booking };
}

/**
 * A contact request is the fallback when the customer does not want to pick
 * a time, or the matter needs staff judgement. Staff call back.
 */
export function createContactRequest(input: RawInput, now: Date): ContactResult {
  if (input.consent !== true) return { state: 'rejected', field: 'consent', message: NO_CONSENT };
  const customer = parseCustomer(input, false);
  if (!customer.ok) return { state: 'rejected', ...customer.rejection };
  const job = parseJob(input);
  if (!job.ok) return { state: 'rejected', ...job.rejection };
  const description = parseDescription(input);
  if (!description.ok) return { state: 'rejected', ...description.rejection };
  return {
    state: 'sent',
    request: {
      ref: makeRef('R'),
      ...customer.value,
      issueType: job.value.issue,
      description: description.value,
      timing: cleanText(input.preferred_timing, RULES.max.timing),
      createdAt: now.toISOString(),
    },
  };
}
