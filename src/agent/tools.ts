// The three tools the agent may call, and what happens when it does. A
// tool answers the model with a short factual text; a refusal carries the
// ERROR prefix the system prompt tells the model to look for, and is also
// flagged as an error on the API side. Every call writes an event for the
// counter view, so a visitor sees what the agent did.

import type Anthropic from '@anthropic-ai/sdk';
import { bookingWindow, type CalendarFactory } from '../booking/calendar.ts';
import { clockLabel, dayLabel, whenLabel } from '../booking/clock.ts';
import { createBooking, createContactRequest, describeWorkTimes, parseJob, type RawInput } from '../booking/core.ts';
import { WORK_MAX, WORK_MIN } from '../booking/duration.ts';
import { mechanicName, suitableMechanics } from '../booking/mechanics.ts';
import { RULES, cleanText } from '../booking/rules.ts';
import { ISSUE_TYPES, POWERTRAINS, type Booking, type ContactRequest, type Lang, type Slot } from '../booking/types.ts';
import { BUSINESS } from '../knowledge/business.ts';
import type { AgentEvent, SessionState } from '../store/store.ts';

type BetaTool = Anthropic.Beta.Messages.BetaTool;

const ISSUE_ENUM = { type: 'string', enum: [...ISSUE_TYPES] } as const;
const POWERTRAIN_ENUM = { type: 'string', enum: [...POWERTRAINS], description: 'Empty string when unknown.' } as const;

const durationHelp = `Work minutes between ${WORK_MIN} and ${WORK_MAX}. 0 means the default for the issue type (${describeWorkTimes()}). Give a value only when the customer described the job precisely.`;

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
        description: { type: 'string', description: "What the customer wants done, in the customer's words. Mention a courtesy car here if asked for." },
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

/** A time the lookup tool showed the customer; the browser turns it into a button. */
export interface OfferedTime {
  start: string;
  mechanicId: string;
  /** "Wed 14.10. 8.30", with the technician's role when several technicians were offered. */
  label: string;
}

/** What one turn's tool calls produced; the agent folds it into the session afterwards. */
export interface TurnLog {
  events: AgentEvent[];
  /** Times shown in this turn, so the reply can carry them as buttons. */
  offered: OfferedTime[];
  /** A tool refused because the customer had not said yes: the reply should carry a confirm button. */
  askConsent?: boolean;
  booking?: Booking;
  request?: ContactRequest;
}

export interface ToolContext {
  now: Date;
  lang: Lang;
  /** Read for the guards; bookings and requests are appended in place. */
  state: SessionState;
  calendar: CalendarFactory;
  turn: TurnLog;
}

export interface ToolOutcome {
  text: string;
  refused: boolean;
}

function record(ctx: ToolContext, kind: AgentEvent['kind'], text: string): void {
  ctx.turn.events.push({ at: ctx.now.toISOString(), kind, text });
}

/** Logs why and tells the model what to change. The one place the ERROR prefix is written. */
function refuse(ctx: ToolContext, log: string, text: string): ToolOutcome {
  record(ctx, 'blocked', log);
  return { text: `ERROR: ${text}`, refused: true };
}

function done(text: string): ToolOutcome {
  return { text, refused: false };
}

function slotLine(slot: Slot, lang: Lang): string {
  return `${whenLabel(slot, lang)} [${slot.start}]`;
}

/** Remembers a time the customer was shown, once per technician and start. */
function offer(ctx: ToolContext, slot: Slot, mechanicId: string, withName = ''): void {
  if (ctx.turn.offered.some((o) => o.start === slot.start && o.mechanicId === mechanicId)) return;
  const time = `${dayLabel(slot.date, ctx.lang)} ${clockLabel(slot.startMin)}`;
  ctx.turn.offered.push({ start: slot.start, mechanicId, label: withName ? `${time}, ${withName}` : time });
}

export function getAvailableTimes(input: RawInput, ctx: ToolContext): ToolOutcome {
  const job = parseJob(input);
  if (!job.ok) return refuse(ctx, `Lookup refused: ${job.rejection.message}`, job.rejection.message);
  const { issue, powertrain, workMin } = job.value;
  const suitable = suitableMechanics(issue, powertrain);
  if (suitable.length === 0) {
    return refuse(
      ctx,
      `Lookup refused: no mechanic does ${issue} for powertrain "${powertrain}".`,
      `No technician does this job for this powertrain. Offer a contact request or the phone number ${BUSINESS.phone}.`,
    );
  }
  const calendar = ctx.calendar(ctx.now, ctx.state.bookings);
  const window = bookingWindow(ctx.now, input.from_date);
  const mechanicId = cleanText(input.mechanic_id, RULES.max.mechanicId);

  if (!mechanicId) {
    const lines = suitable.map((m) => {
      const [first] = calendar.freeSlots(m.id, workMin, window.from, window.to, 1);
      if (!first) return `${m.id} (${m.name}): no free times before ${window.to}`;
      offer(ctx, first, m.id, m.name);
      return `${m.id} (${m.name}, ${m.title}): earliest free ${slotLine(first, ctx.lang)}`;
    });
    record(ctx, 'lookup', `Looked up the earliest times for ${issue} (${workMin} min): ${suitable.map((m) => m.name).join(', ')}.`);
    return done(
      `Work time ${workMin} min. Earliest free times of the suitable mechanics (ISO value in brackets for booking):\n${lines.join('\n')}\nCall again with a mechanic_id to get all of one mechanic's times.`,
    );
  }

  const mechanic = suitable.find((m) => m.id === mechanicId);
  if (!mechanic) {
    return refuse(
      ctx,
      `Lookup refused: ${mechanicId} does not do ${issue}.`,
      `Technician "${mechanicId}" does not do this job. Suitable: ${suitable.map((m) => m.id).join(', ')}.`,
    );
  }
  const slots = calendar.freeSlots(mechanic.id, workMin, window.from, window.to, 20);
  record(ctx, 'lookup', `Looked up ${mechanic.name}'s times for ${issue} (${workMin} min) from ${window.from}: ${slots.length} free.`);
  if (slots.length === 0) {
    return done(`${mechanic.name}: no free times between ${window.from} and ${window.to}. Try a later from_date or another mechanic.`);
  }
  for (const s of slots) offer(ctx, s, mechanic.id);
  return done(`Work time ${workMin} min. ${mechanic.name}, free times (ISO value in brackets for booking):\n${slots.map((s) => slotLine(s, ctx.lang)).join('\n')}`);
}

export function createBookingTool(input: RawInput, ctx: ToolContext): ToolOutcome {
  const existing = ctx.state.bookings[0];
  if (existing) {
    return refuse(
      ctx,
      `Second booking refused: ${existing.ref} already exists in this conversation.`,
      `A booking already exists in this conversation (reference ${existing.ref}). Do not make another one; changes go by phone ${BUSINESS.phone}.`,
    );
  }
  const result = createBooking(input, ctx.calendar(ctx.now, ctx.state.bookings), ctx.now);
  if (result.state !== 'booked') {
    if (result.state === 'rejected' && result.field === 'consent') ctx.turn.askConsent = true;
    const why = result.state === 'rejected' ? result.field : result.reason;
    return refuse(ctx, `Booking refused (${why}): ${result.message}`, result.message);
  }
  const b = result.booking;
  ctx.state.bookings.push(b);
  ctx.turn.booking = b;
  const label = whenLabel(b, ctx.lang);
  const mechanic = mechanicName(b.mechanicId);
  record(ctx, 'booking', `Booked ${mechanic}, ${label}, ${b.issueType} ${b.workMin} min, ${b.vehicle}. Reference ${b.ref}.`);
  return done(
    `Booking confirmed. Reference ${b.ref}. Technician ${mechanic}. Start ${label}. Tell the customer the reference, the technician and the start time, and that changes and cancellations go by phone ${BUSINESS.phone}.`,
  );
}

export function sendContactRequestTool(input: RawInput, ctx: ToolContext): ToolOutcome {
  const existing = ctx.state.requests[0];
  if (existing) {
    return refuse(
      ctx,
      `Second contact request refused: ${existing.ref} already sent in this conversation.`,
      `A contact request has already been sent in this conversation (reference ${existing.ref}). Do not send another one.`,
    );
  }
  const result = createContactRequest(input, ctx.now);
  if (result.state !== 'sent') return refuse(ctx, `Contact request refused (${result.field}): ${result.message}`, result.message);
  const r = result.request;
  ctx.state.requests.push(r);
  ctx.turn.request = r;
  record(ctx, 'request', `Contact request sent for ${r.vehicle}, ${r.issueType}. Reference ${r.ref}. Staff will call back.`);
  return done(
    `Contact request sent. Reference ${r.ref}. Tell the customer the reference and that the time is not confirmed yet: staff will call back. Urgent matters by phone ${BUSINESS.phone}.`,
  );
}

/** Routes one tool_use block to its executor. Unknown names are an error for the model, not a crash. */
export function executeTool(name: string, input: unknown, ctx: ToolContext): ToolOutcome {
  const args: RawInput = input && typeof input === 'object' ? (input as RawInput) : {};
  switch (name) {
    case 'get_available_times':
      return getAvailableTimes(args, ctx);
    case 'create_booking':
      return createBookingTool(args, ctx);
    case 'send_contact_request':
      return sendContactRequestTool(args, ctx);
    default:
      record(ctx, 'error', `Unknown tool "${name}" requested.`);
      return { text: 'ERROR: unknown tool.', refused: true };
  }
}
