// Booking core: one entry point for anyone who wants to put a job in the
// calendar. It cleans and validates the raw input itself, checks the slot
// against the calendar and returns ONE result the caller switches on.
// Persisting the booking is the caller's job (the agent writes it to the
// session store), which keeps this module free of I/O and easy to test.

import { bookingWindow, type Calendar } from './calendar.ts';
import { parseIso, toLocal } from './clock.ts';
import { workMinutes } from './duration.ts';
import { makeRef } from './ids.ts';
import { mechanicById, suitableMechanics } from './mechanics.ts';
import { RULES, cleanRego, cleanText, validEmail, validPhone } from './rules.ts';
import { isIssueType, isPowertrain, type Booking, type BookingResult, type ContactRequest } from './types.ts';

/** Raw input as the model produced it. Every field may be missing or junk. */
export interface BookingInput {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  rego?: unknown;
  make_model?: unknown;
  powertrain?: unknown;
  issue_type?: unknown;
  description?: unknown;
  mechanic_id?: unknown;
  start?: unknown;
  duration_min?: unknown;
  consent?: unknown;
}

/** Jobs the shop does not take through the agent, caught by their description. */
export const NOT_BOOKABLE: ReadonlyArray<{ keyword: RegExp; message: string }> = [
  {
    keyword: /\b(tyres?|tires?|rengas|renkaat|renkaiden|däck)\b/i,
    message: 'Tyre changes are booked by phone only, not through the agent.',
  },
];

function vehicleLabel(rego: string, makeModel: string): string {
  return [makeModel, rego].filter(Boolean).join(' ');
}

export function createBooking(input: BookingInput, calendar: Calendar, now: Date): BookingResult {
  if (input.consent !== true) {
    return {
      state: 'rejected',
      field: 'consent',
      message: 'The customer has not confirmed the booking yet. Show the summary and ask for an explicit yes.',
    };
  }

  const name = cleanText(input.name, RULES.max.name);
  const phone = cleanText(input.phone, RULES.max.phone);
  const email = cleanText(input.email, RULES.max.email);
  if (!name || !phone) {
    return { state: 'rejected', field: 'contact', message: 'Name and phone number are required for a calendar booking.' };
  }
  if (!validPhone(phone)) {
    return { state: 'rejected', field: 'contact', message: 'The phone number looks wrong. Check it with the customer.' };
  }
  if (email && !validEmail(email)) {
    return {
      state: 'rejected',
      field: 'contact',
      message: 'The email address looks wrong. Check it with the customer or leave it empty.',
    };
  }

  const rego = cleanRego(input.rego);
  const makeModel = cleanText(input.make_model, RULES.max.makeModel);
  if (!rego && !makeModel) {
    return { state: 'rejected', field: 'vehicle', message: 'Registration number or make and model is required.' };
  }

  if (!isIssueType(input.issue_type)) {
    return { state: 'rejected', field: 'issue', message: 'issue_type is not one of the allowed values.' };
  }
  const issue = input.issue_type;
  const description = cleanText(input.description, RULES.max.description);
  if (description.length < RULES.descriptionMin) {
    return {
      state: 'rejected',
      field: 'description',
      message: 'A short description of the job is required (at least ten characters).',
    };
  }
  const blocked = NOT_BOOKABLE.find((rule) => rule.keyword.test(description));
  if (blocked) {
    return { state: 'rejected', field: 'issue', message: blocked.message };
  }

  const powertrain = isPowertrain(input.powertrain) ? input.powertrain : '';
  const mechanicId = cleanText(input.mechanic_id, 20);
  const mechanic = mechanicById(mechanicId);
  if (!mechanic || !suitableMechanics(issue, powertrain).some((m) => m.id === mechanicId)) {
    const ids = suitableMechanics(issue, powertrain).map((m) => m.id).join(', ') || 'none';
    return {
      state: 'rejected',
      field: 'mechanic',
      message: `Mechanic "${mechanicId}" does not do this job. Suitable mechanic ids: ${ids}.`,
    };
  }

  const startIso = typeof input.start === 'string' ? input.start : '';
  const start = parseIso(startIso);
  if (!start) {
    return {
      state: 'rejected',
      field: 'slot',
      message: 'start must be exactly one of the ISO times returned by get_available_times.',
    };
  }
  const window = bookingWindow(now);
  const startLocal = toLocal(start);
  if (start.getTime() <= now.getTime()) {
    return { state: 'unavailable', reason: 'past', message: 'That time is already in the past.' };
  }
  if (startLocal.date > window.to) {
    return {
      state: 'unavailable',
      reason: 'outside_window',
      message: `The shop takes bookings up to ${window.to}. Offer an earlier time.`,
    };
  }
  const workMin = workMinutes(issue, typeof input.duration_min === 'number' ? input.duration_min : 0);
  if (!calendar.isFree(mechanicId, startIso, workMin)) {
    return {
      state: 'unavailable',
      reason: 'gone',
      message: 'That time is no longer free. Fetch the times again and offer another one.',
    };
  }

  const slot = calendar
    .freeSlots(mechanicId, workMin, startLocal.date, startLocal.date)
    .find((s) => parseIso(s.start)?.getTime() === start.getTime());
  const booking: Booking = {
    ref: makeRef('B'),
    mechanicId,
    start: slot?.start ?? startIso,
    end: slot?.end ?? startIso,
    workMin,
    issueType: issue,
    name,
    phone,
    email,
    vehicle: vehicleLabel(rego, makeModel),
    description,
    createdAt: now.toISOString(),
  };
  return { state: 'booked', booking };
}

export interface ContactInput {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  rego?: unknown;
  make_model?: unknown;
  issue_type?: unknown;
  description?: unknown;
  preferred_timing?: unknown;
  consent?: unknown;
}

export type ContactResult = { ok: true; request: ContactRequest } | { ok: false; message: string };

/**
 * A contact request is the fallback when the customer does not want to pick
 * a time, or the job is not bookable through the calendar. Staff call back.
 */
export function createContactRequest(input: ContactInput, now: Date): ContactResult {
  if (input.consent !== true) {
    return { ok: false, message: 'The customer has not approved sending yet. Show the summary and ask for an explicit yes.' };
  }
  const name = cleanText(input.name, RULES.max.name);
  const phone = cleanText(input.phone, RULES.max.phone);
  const email = cleanText(input.email, RULES.max.email);
  if (!name) return { ok: false, message: 'Name is required.' };
  if (!phone && !email) return { ok: false, message: 'A phone number or an email address is required.' };
  if (phone && !validPhone(phone)) return { ok: false, message: 'The phone number looks wrong. Check it with the customer.' };
  if (email && !validEmail(email)) return { ok: false, message: 'The email address looks wrong. Check it with the customer.' };
  const rego = cleanRego(input.rego);
  const makeModel = cleanText(input.make_model, RULES.max.makeModel);
  if (!rego && !makeModel) return { ok: false, message: 'Registration number or make and model is required.' };
  if (!isIssueType(input.issue_type)) return { ok: false, message: 'issue_type is not one of the allowed values.' };
  const description = cleanText(input.description, RULES.max.description);
  if (description.length < RULES.descriptionMin) {
    return { ok: false, message: 'A short description of the matter is required (at least ten characters).' };
  }
  return {
    ok: true,
    request: {
      ref: makeRef('R'),
      name,
      phone,
      email,
      vehicle: vehicleLabel(rego, makeModel),
      issueType: input.issue_type,
      description,
      timing: cleanText(input.preferred_timing, RULES.max.timing),
      createdAt: now.toISOString(),
    },
  };
}
