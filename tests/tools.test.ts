import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBookingTool, executeTool, getAvailableTimes, sendContactRequestTool, type ToolContext } from '../src/agent/tools.ts';
import { fromLocal } from '../src/booking/clock.ts';
import { emptySession } from '../src/store/store.ts';

const NOW = fromLocal('2026-10-13', 10 * 60);

function ctx(): ToolContext {
  return { now: NOW, lang: 'en', state: emptySession() };
}

test('without a mechanic the lookup lists every suitable mechanic with an ISO time', () => {
  const c = ctx();
  const out = getAvailableTimes({ issue_type: 'service', powertrain: '', mechanic_id: '', duration_min: 0, from_date: '' }, c);
  assert.match(out, /Work time 120 min/);
  assert.match(out, /petri \(Petri Lehto/);
  assert.match(out, /sami \(Sami Kuusela/);
  assert.doesNotMatch(out, /aino/);
  assert.match(out, /\[2026-10-\d{2}T\d{2}:\d{2}:00\+03:00\]/);
  assert.equal(c.state.events.length, 1);
  assert.equal(c.state.events[0]?.kind, 'lookup');
});

test('a mechanic who does not do the job is an error for the model and a blocked event', () => {
  const c = ctx();
  const out = getAvailableTimes({ issue_type: 'ac', powertrain: '', mechanic_id: 'aino', duration_min: 0, from_date: '' }, c);
  assert.match(out, /^ERROR/);
  assert.equal(c.state.events[0]?.kind, 'blocked');
});

test('an electric repair only offers the high-voltage mechanic', () => {
  const out = getAvailableTimes({ issue_type: 'repair', powertrain: 'ev', mechanic_id: '', duration_min: 0, from_date: '' }, ctx());
  assert.match(out, /aino/);
  assert.doesNotMatch(out, /petri/);
});

test('only one booking per conversation', () => {
  const c = ctx();
  const times = getAvailableTimes({ issue_type: 'service', powertrain: '', mechanic_id: 'petri', duration_min: 0, from_date: '' }, c);
  const start = times.match(/\[([^\]]+)\]/)![1]!;
  const input = {
    name: 'Test Person',
    phone: '0401234567',
    email: '',
    rego: 'ABC-123',
    make_model: '',
    powertrain: '',
    issue_type: 'service',
    description: 'Annual service, please',
    mechanic_id: 'petri',
    start,
    duration_min: 0,
    consent: true,
  };
  const first = createBookingTool(input, c);
  assert.match(first, /^Booking confirmed\. Reference B-/);
  assert.equal(c.state.bookings.length, 1);
  const second = createBookingTool(input, c);
  assert.match(second, /^ERROR: a booking already exists/);
  assert.equal(c.state.bookings.length, 1);
  assert.deepEqual(
    c.state.events.map((e) => e.kind),
    ['lookup', 'booking', 'blocked'],
  );
});

test('a booking without consent is refused and logged', () => {
  const c = ctx();
  const out = createBookingTool({ name: 'X', phone: '0401234567', consent: false }, c);
  assert.match(out, /^ERROR: The customer has not confirmed/);
  assert.match(c.state.events[0]?.text ?? '', /consent/);
});

test('contact requests are limited to one and need consent', () => {
  const c = ctx();
  const base = {
    name: 'Kalle',
    phone: '0401234567',
    email: '',
    rego: 'XYZ-987',
    make_model: '',
    issue_type: 'other',
    description: 'Courtesy car question for a long repair',
    preferred_timing: '',
    consent: true,
  };
  assert.match(sendContactRequestTool({ ...base, consent: false }, c), /^ERROR/);
  assert.match(sendContactRequestTool(base, c), /^Contact request sent\. Reference R-/);
  assert.match(sendContactRequestTool(base, c), /^ERROR: a contact request has already been sent/);
  assert.equal(c.state.requests.length, 1);
});

test('unknown tools do not crash the turn', () => {
  const c = ctx();
  assert.equal(executeTool('delete_everything', {}, c), 'ERROR: unknown tool.');
  assert.equal(c.state.events[0]?.kind, 'error');
});
