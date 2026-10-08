import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockCalendar } from '../src/booking/calendar.ts';
import { fromLocal } from '../src/booking/clock.ts';
import { createBooking, createContactRequest, type BookingInput } from '../src/booking/core.ts';

const NOW = fromLocal('2026-10-13', 10 * 60);
const cal = new MockCalendar(NOW);

function firstSlot(mechanicId: string, workMin: number): string {
  return cal.freeSlots(mechanicId, workMin, '2026-10-14', '2026-10-20')[0]!.start;
}

const good: BookingInput = {
  name: 'Maija Meikäläinen',
  phone: '040 123 4567',
  email: '',
  rego: 'abc-123',
  make_model: 'Skoda Octavia',
  powertrain: 'diesel',
  issue_type: 'service',
  description: 'Annual service according to the schedule',
  mechanic_id: 'petri',
  start: firstSlot('petri', 120),
  duration_min: 0,
  consent: true,
};

function rejected(input: BookingInput) {
  const r = createBooking(input, cal, NOW);
  assert.equal(r.state, 'rejected');
  return r.state === 'rejected' ? r.field : '';
}

test('a complete, confirmed request is booked', () => {
  const r = createBooking(good, cal, NOW);
  assert.equal(r.state, 'booked');
  if (r.state !== 'booked') return;
  assert.match(r.booking.ref, /^B-[A-Z2-9]{5}$/);
  assert.equal(r.booking.vehicle, 'Skoda Octavia ABC-123');
  assert.equal(r.booking.workMin, 120);
  assert.equal(r.booking.mechanicId, 'petri');
});

test('every missing piece is reported as the right field', () => {
  assert.equal(rejected({ ...good, consent: false }), 'consent');
  assert.equal(rejected({ ...good, phone: '' }), 'contact');
  assert.equal(rejected({ ...good, phone: 'call me' }), 'contact');
  assert.equal(rejected({ ...good, email: 'not-an-email' }), 'contact');
  assert.equal(rejected({ ...good, rego: '', make_model: '' }), 'vehicle');
  assert.equal(rejected({ ...good, issue_type: 'tyres' }), 'issue');
  assert.equal(rejected({ ...good, description: 'short' }), 'description');
  assert.equal(rejected({ ...good, description: 'Please change my winter tyres' }), 'issue');
  assert.equal(rejected({ ...good, mechanic_id: 'aino' }), 'mechanic');
  assert.equal(rejected({ ...good, start: 'tomorrow at ten' }), 'slot');
});

test('an electric car needs the high-voltage mechanic for repairs', () => {
  const ev = { ...good, powertrain: 'ev', issue_type: 'repair', description: 'Charging stops at 80 percent' };
  assert.equal(rejected({ ...ev, mechanic_id: 'petri' }), 'mechanic');
  const r = createBooking({ ...ev, mechanic_id: 'aino', start: firstSlot('aino', 120) }, cal, NOW);
  assert.equal(r.state, 'booked');
});

test('times outside the calendar are unavailable, not rejected', () => {
  const past = createBooking({ ...good, start: '2026-10-13T09:00:00+03:00' }, cal, NOW);
  assert.equal(past.state, 'unavailable');
  const far = createBooking({ ...good, start: '2026-11-20T09:00:00+02:00' }, cal, NOW);
  assert.equal(far.state, 'unavailable');
  const taken = createBooking({ ...good, start: '2026-10-14T11:00:00+03:00' }, cal, NOW);
  assert.equal(taken.state, 'unavailable');
});

test('contact requests need a name, one contact channel, a vehicle and a description', () => {
  const base = {
    name: 'Kalle',
    phone: '',
    email: 'kalle@example.com',
    rego: '',
    make_model: 'Volvo V60',
    issue_type: 'other',
    description: 'Would like a courtesy car during a long repair',
    preferred_timing: 'next week',
    consent: true,
  };
  assert.equal(createContactRequest(base, NOW).ok, true);
  assert.equal(createContactRequest({ ...base, consent: false }, NOW).ok, false);
  assert.equal(createContactRequest({ ...base, name: '' }, NOW).ok, false);
  assert.equal(createContactRequest({ ...base, email: '' }, NOW).ok, false);
  assert.equal(createContactRequest({ ...base, make_model: '' }, NOW).ok, false);
  assert.equal(createContactRequest({ ...base, description: 'hi' }, NOW).ok, false);
  const ok = createContactRequest(base, NOW);
  if (ok.ok) assert.match(ok.request.ref, /^R-/);
});
