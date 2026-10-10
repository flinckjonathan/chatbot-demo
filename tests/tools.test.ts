import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBookingTool, executeTool, getAvailableTimes, sendContactRequestTool, type ToolContext } from '../src/agent/tools.ts';
import { mockCalendarFactory } from '../src/booking/calendar.ts';
import { emptySession } from '../src/store/store.ts';
import { NOW, bookingInput } from './fixtures.ts';

function ctx(): ToolContext {
  return { now: NOW, lang: 'en', state: emptySession(), calendar: mockCalendarFactory, turn: { events: [] } };
}

const LOOKUP_ALL = { issue_type: 'service', powertrain: '', mechanic_id: '', duration_min: 0, from_date: '' };

test('without a mechanic the lookup lists every suitable mechanic with an ISO time', () => {
  const c = ctx();
  const out = getAvailableTimes(LOOKUP_ALL, c);
  assert.equal(out.refused, false);
  assert.match(out.text, /Work time 120 min/);
  assert.match(out.text, /service \(Service technician/);
  assert.match(out.text, /diag \(Diagnostics technician/);
  assert.doesNotMatch(out.text, /hv/);
  assert.match(out.text, /\[2026-10-\d{2}T\d{2}:\d{2}:00\+03:00\]/);
  assert.deepEqual(c.turn.events.map((e) => e.kind), ['lookup']);
});

test('a mechanic who does not do the job is a refusal for the model and a blocked event', () => {
  const c = ctx();
  const out = getAvailableTimes({ ...LOOKUP_ALL, issue_type: 'ac', mechanic_id: 'hv' }, c);
  assert.equal(out.refused, true);
  assert.match(out.text, /^ERROR: Technician "hv" does not do this job/);
  assert.equal(c.turn.events[0]?.kind, 'blocked');
});

test('tyre jobs are refused with the phone-only wording', () => {
  const c = ctx();
  const out = getAvailableTimes({ ...LOOKUP_ALL, issue_type: 'tyres' }, c);
  assert.equal(out.refused, true);
  assert.match(out.text, /by phone only/);
});

test('an electric repair only offers the high-voltage mechanic', () => {
  const out = getAvailableTimes({ ...LOOKUP_ALL, issue_type: 'repair', powertrain: 'ev' }, ctx());
  assert.match(out.text, /hv/);
  assert.doesNotMatch(out.text, /service/);
});

test('a from_date inside the window moves the lookup, one outside is ignored', () => {
  const c = ctx();
  const later = getAvailableTimes({ ...LOOKUP_ALL, mechanic_id: 'service', from_date: '2026-10-20' }, c);
  assert.match(later.text, /\[2026-10-2\d/);
  assert.doesNotMatch(later.text, /\[2026-10-1\d/);
  const ignored = getAvailableTimes({ ...LOOKUP_ALL, mechanic_id: 'service', from_date: '2027-01-01' }, c);
  assert.match(ignored.text, /\[2026-10-1\d/);
});

test('only one booking per conversation', () => {
  const c = ctx();
  const times = getAvailableTimes({ ...LOOKUP_ALL, mechanic_id: 'service' }, c);
  const start = times.text.match(/\[([^\]]+)\]/)![1]!;
  const input = bookingInput({ start });
  const first = createBookingTool(input, c);
  assert.equal(first.refused, false);
  assert.match(first.text, /^Booking confirmed\. Reference B-/);
  assert.equal(c.state.bookings.length, 1);
  assert.equal(c.turn.booking?.ref, c.state.bookings[0]?.ref);
  const second = createBookingTool(input, c);
  assert.equal(second.refused, true);
  assert.match(second.text, /^ERROR: A booking already exists/);
  assert.equal(c.state.bookings.length, 1);
  assert.deepEqual(c.turn.events.map((e) => e.kind), ['lookup', 'booking', 'blocked']);
});

test('a booking without consent is refused and logged', () => {
  const c = ctx();
  const out = createBookingTool(bookingInput({ consent: false }), c);
  assert.equal(out.refused, true);
  assert.match(out.text, /^ERROR: The customer has not confirmed/);
  assert.match(c.turn.events[0]?.text ?? '', /consent/);
});

test('contact requests are limited to one and need consent', () => {
  const c = ctx();
  const base = bookingInput({ rego: 'XYZ-987', issue_type: 'other', description: 'Courtesy car question for a long repair', preferred_timing: '' });
  assert.equal(sendContactRequestTool({ ...base, consent: false }, c).refused, true);
  const sent = sendContactRequestTool(base, c);
  assert.match(sent.text, /^Contact request sent\. Reference R-/);
  assert.equal(c.turn.request?.ref, c.state.requests[0]?.ref);
  assert.match(sendContactRequestTool(base, c).text, /^ERROR: A contact request has already been sent/);
  assert.equal(c.state.requests.length, 1);
});

test('unknown tools do not crash the turn', () => {
  const c = ctx();
  assert.deepEqual(executeTool('delete_everything', {}, c), { text: 'ERROR: unknown tool.', refused: true });
  assert.equal(c.turn.events[0]?.kind, 'error');
});
