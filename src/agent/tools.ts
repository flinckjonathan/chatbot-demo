// The three tools the agent may call, and what happens when it does. Tool
// results are written for the model: short, factual, and prefixed with
// ERROR when the model has to change course. Every call also produces an
// event for the counter view, so a visitor sees what the agent did.

import type Anthropic from '@anthropic-ai/sdk';
import { MockCalendar, WINDOW_DAYS, bookingWindow, type Calendar } from '../booking/calendar.ts';
import { addDays, isDateString, parseIso, timeLabel, toLocal } from '../booking/clock.ts';
import { createBooking, createContactRequest } from '../booking/core.ts';
import { DEFAULT_WORK, workMinutes } from '../booking/duration.ts';
import { mechanicById, suitableMechanics } from '../booking/mechanics.ts';
import { cleanText } from '../booking/rules.ts';
import { ISSUE_TYPES, POWERTRAINS, isIssueType, isPowertrain, type Lang } from '../booking/types.ts';
import { WORKSHOP } from '../knowledge/workshop.ts';
import { MAX_EVENTS, type AgentEvent, type SessionState } from '../store/store.ts';

type BetaTool = Anthropic.Beta.Messages.BetaTool;

const ISSUE_ENUM = { type: 'string', enum: [...ISSUE_TYPES] } as const;
const POWERTRAIN_ENUM = { type: 'string', enum: [...POWERTRAINS], description: 'Empty string when unknown.' } as const;

const durationHelp = `Work minutes. 0 means the default for the issue type (${Object.entries(DEFAULT_WORK)
  .map(([k, v]) => `${k} ${v}`)
  .join(', ')}). Give a value only when the customer described the job precisely.`;

/**
 * strict: true makes the API guarantee the input matches the schema, so the
 * executors below only have to defend against values that are valid but
 * wrong (an unknown mechanic id, a stale time).
 */
export const TOOLS: BetaTool[] = [
  {
    name: 'get_available_times',
    description:
      'Free times in the shop calendar. Without mechanic_id: the earliest free time of every mechanic who does this job. With mechanic_id: up to twenty free times for that mechanic from from_date. Every time comes with its exact ISO value in brackets; copy that value into create_booking.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        issue_type: ISSUE_ENUM,
        powertrain: POWERTRAIN_ENUM,
        mechanic_id: { type: 'string', description: 'Mechanic id from the roster, or empty string for all suitable mechanics.' },
        duration_min: { type: 'integer', description: durationHelp },
        from_date: { type: 'string', description: 'YYYY-MM-DD to start from, or empty string for today.' },
      },
      required: ['issue_type', 'powertrain', 'mechanic_id', 'duration_min', 'from_date'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_booking',
    description:
      'Books a time in the shop calendar. Call only after the customer has seen a summary and clearly said yes. start must be an ISO value copied from a get_available_times result. One booking per conversation.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string', description: 'Empty string when not given.' },
        rego: { type: 'string', description: 'Registration number, or empty string.' },
        make_model: { type: 'string', description: 'Make and model, or empty string.' },
        powertrain: POWERTRAIN_ENUM,
        issue_type: ISSUE_ENUM,
        description: { type: 'string', description: 'What the customer wants done, in the customer\'s words. Mention a courtesy car here if asked for.' },
        mechanic_id: { type: 'string' },
        start: { type: 'string', description: 'Exact ISO start time from get_available_times.' },
        duration_min: { type: 'integer', description: durationHelp },
        consent: { type: 'boolean', description: 'true only when the customer explicitly confirmed the summary.' },
      },
      required: ['name', 'phone', 'email', 'rego', 'make_model', 'powertrain', 'issue_type', 'description', 'mechanic_id', 'start', 'duration_min', 'consent'],
      additionalProperties: false,
    },
  },
  {
    name: 'send_contact_request',
    description:
      'Sends a contact request to the service desk; staff call the customer back. Not a confirmed time. Call only after the customer has seen a summary and clearly said yes. One request per conversation.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string', description: 'Empty string when not given.' },
        email: { type: 'string', description: 'Empty string when not given.' },
        rego: { type: 'string', description: 'Registration number, or empty string.' },
        make_model: { type: 'string', description: 'Make and model, or empty string.' },
        issue_type: ISSUE_ENUM,
        description: { type: 'string' },
        preferred_timing: { type: 'string', description: 'When the customer would like to come, in their words, or empty string.' },
        consent: { type: 'boolean', description: 'true only when the customer explicitly approved sending.' },
      },
      required: ['name', 'phone', 'email', 'rego', 'make_model', 'issue_type', 'description', 'preferred_timing', 'consent'],
      additionalProperties: false,
    },
  },
];

export interface ToolContext {
  now: Date;
  lang: Lang;
  /** Mutated in place: bookings, requests and events of this conversation. */
  state: SessionState;
  calendar?: (state: SessionState) => Calendar;
}

function calendarFor(ctx: ToolContext): Calendar {
  return ctx.calendar ? ctx.calendar(ctx.state) : new MockCalendar(ctx.now, ctx.state.bookings);
}

function record(ctx: ToolContext, kind: AgentEvent['kind'], text: string): void {
  ctx.state.events.push({ at: ctx.now.toISOString(), kind, text });
  if (ctx.state.events.length > MAX_EVENTS) ctx.state.events.splice(0, ctx.state.events.length - MAX_EVENTS);
}

function slotLine(startIso: string, lang: Lang): string {
  const d = parseIso(startIso);
  return `${d ? timeLabel(d, lang) : startIso} [${startIso}]`;
}

type Input = Record<string, unknown>;

export function getAvailableTimes(input: Input, ctx: ToolContext): string {
  if (!isIssueType(input.issue_type)) return 'ERROR: issue_type is not one of the allowed values.';
  const issue = input.issue_type;
  const powertrain = isPowertrain(input.powertrain) ? input.powertrain : '';
  const workMin = workMinutes(issue, typeof input.duration_min === 'number' ? input.duration_min : 0);
  const suitable = suitableMechanics(issue, powertrain);
  if (suitable.length === 0) {
    record(ctx, 'blocked', `Lookup refused: no mechanic does ${issue} for powertrain "${powertrain}".`);
    return `ERROR: no mechanic does this job for this powertrain. Offer a contact request or the phone number ${WORKSHOP.phone}.`;
  }
  const calendar = calendarFor(ctx);
  const window = bookingWindow(ctx.now);
  const mechanicId = cleanText(input.mechanic_id, 20);

  if (!mechanicId) {
    const lines = suitable.map((m) => {
      const first = calendar.freeSlots(m.id, workMin, window.from, window.to)[0];
      return first
        ? `${m.id} (${m.name}, ${m.title}): earliest free ${slotLine(first.start, ctx.lang)}`
        : `${m.id} (${m.name}): no free times within ${WINDOW_DAYS} days`;
    });
    record(ctx, 'lookup', `Looked up the earliest times for ${issue} (${workMin} min): ${suitable.map((m) => m.name).join(', ')}.`);
    return `Work time ${workMin} min. Earliest free times of the suitable mechanics (ISO value in brackets for booking):\n${lines.join('\n')}\nCall again with a mechanic_id to get all of one mechanic's times.`;
  }

  const mechanic = suitable.find((m) => m.id === mechanicId);
  if (!mechanic) {
    record(ctx, 'blocked', `Lookup refused: ${mechanicId} does not do ${issue}.`);
    return `ERROR: mechanic "${mechanicId}" does not do this job. Suitable: ${suitable.map((m) => m.id).join(', ')}.`;
  }
  const today = toLocal(ctx.now).date;
  let from = today;
  if (isDateString(input.from_date) && input.from_date > today && input.from_date <= window.to) from = input.from_date;
  let to = addDays(from, 13);
  if (to > window.to) to = window.to;
  const slots = calendar.freeSlots(mechanic.id, workMin, from, to).slice(0, 20);
  record(ctx, 'lookup', `Looked up ${mechanic.name}'s times for ${issue} (${workMin} min) from ${from}: ${slots.length} free.`);
  if (slots.length === 0) {
    return `${mechanic.name}: no free times between ${from} and ${to}. Try a later from_date or another mechanic.`;
  }
  return `Work time ${workMin} min. ${mechanic.name}, free times (ISO value in brackets for booking):\n${slots.map((s) => slotLine(s.start, ctx.lang)).join('\n')}`;
}

export function createBookingTool(input: Input, ctx: ToolContext): string {
  const existing = ctx.state.bookings[0];
  if (existing) {
    record(ctx, 'blocked', `Second booking refused: ${existing.ref} already exists in this conversation.`);
    return `ERROR: a booking already exists in this conversation (reference ${existing.ref}). Do not make another one; changes go by phone ${WORKSHOP.phone}.`;
  }
  const result = createBooking(input, calendarFor(ctx), ctx.now);
  if (result.state === 'booked') {
    const b = result.booking;
    ctx.state.bookings.push(b);
    const when = parseIso(b.start);
    const label = when ? timeLabel(when, ctx.lang) : b.start;
    const mech = mechanicById(b.mechanicId)?.name ?? b.mechanicId;
    record(ctx, 'booking', `Booked ${mech}, ${label}, ${b.issueType} ${b.workMin} min, ${b.vehicle}. Reference ${b.ref}.`);
    return `Booking confirmed. Reference ${b.ref}. Mechanic ${mech}. Start ${label}. Tell the customer the reference, the mechanic and the start time, and that changes and cancellations go by phone ${WORKSHOP.phone}.`;
  }
  const why = result.state === 'rejected' ? `${result.field}: ${result.message}` : `${result.reason}: ${result.message}`;
  record(ctx, 'blocked', `Booking refused (${why})`);
  return `ERROR: ${result.message}`;
}

export function sendContactRequestTool(input: Input, ctx: ToolContext): string {
  const existing = ctx.state.requests[0];
  if (existing) {
    record(ctx, 'blocked', `Second contact request refused: ${existing.ref} already sent in this conversation.`);
    return `ERROR: a contact request has already been sent in this conversation (reference ${existing.ref}). Do not send another one.`;
  }
  const result = createContactRequest(input, ctx.now);
  if (!result.ok) {
    record(ctx, 'blocked', `Contact request refused: ${result.message}`);
    return `ERROR: ${result.message}`;
  }
  ctx.state.requests.push(result.request);
  record(ctx, 'request', `Contact request sent for ${result.request.vehicle}, ${result.request.issueType}. Reference ${result.request.ref}. Staff will call back.`);
  return `Contact request sent. Reference ${result.request.ref}. Tell the customer the reference and that the time is not confirmed yet: staff will call back. Urgent matters by phone ${WORKSHOP.phone}.`;
}

/** Routes one tool_use block to its executor. Unknown names are an error for the model, not a crash. */
export function executeTool(name: string, input: unknown, ctx: ToolContext): string {
  const args = input && typeof input === 'object' ? (input as Input) : {};
  switch (name) {
    case 'get_available_times':
      return getAvailableTimes(args, ctx);
    case 'create_booking':
      return createBookingTool(args, ctx);
    case 'send_contact_request':
      return sendContactRequestTool(args, ctx);
    default:
      record(ctx, 'error', `Unknown tool "${name}" requested.`);
      return 'ERROR: unknown tool.';
  }
}
