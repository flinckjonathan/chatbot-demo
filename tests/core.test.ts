import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockCalendar } from '../src/booking/calendar.ts';
import { createBooking, createContactRequest, describeWorkTimes, parseJob, type RawInput } from '../src/booking/core.ts';
import { blockEnd } from '../src/booking/duration.ts';
import { NOW, bookingInput, firstStart } from './fixtures.ts';

const cal = new MockCalendar(NOW);
const good = bookingInput({ name: 'Maija Meikäläinen', rego: 'abc-123', make_model: 'Skoda Octavia', powertrain: 'diesel', start: firstStart('service', 120) });

function rejected(input: RawInput): string {
  const r = createBooking(input, cal, NOW);
  assert.equal(r.state, 'rejected', JSON.stringify(r));
  return r.state === 'rejected' ? r.field : '';
}

test('a complete, confirmed request is booked', () => {
  const r = createBooking(good, cal, NOW);
  assert.equal(r.state, 'booked');
  if (r.state !== 'booked') return;
  assert.match(r.booking.ref, /^B-[A-Z2-9]{5}$/);
  assert.equal(r.booking.vehicle, 'Skoda Octavia ABC-123');
  assert.equal(r.booking.workMin, 120);
  assert.equal(r.booking.mechanicId, 'service');
  assert.equal(r.booking.start, good.start);
  assert.equal(r.booking.endMin, blockEnd(r.booking.startMin, 120));
});

test('every missing piece is reported as the right field', () => {
  assert.equal(rejected({ ...good, consent: false }), 'consent');
  assert.equal(rejected({ ...good, name: '' }), 'contact');
  assert.equal(rejected({ ...good, phone: '' }), 'contact');
  assert.equal(rejected({ ...good, phone: 'call me' }), 'contact');
  assert.equal(rejected({ ...good, email: 'not-an-email' }), 'contact');
  assert.equal(rejected({ ...good, rego: '', make_model: '' }), 'vehicle');
  assert.equal(rejected({ ...good, issue_type: 'wheels' }), 'issue');
  assert.equal(rejected({ ...good, description: 'short' }), 'description');
  assert.equal(rejected({ ...good, mechanic_id: 'hv' }), 'mechanic');
  assert.equal(rejected({ ...good, start: 'tomorrow at ten' }), 'slot');
});

test('tyre jobs are an issue type the tools refuse with the phone-only wording', () => {
  const job = parseJob({ issue_type: 'tyres' });
  assert.equal(job.ok, false);
  if (!job.ok) assert.match(job.rejection.message, /by phone only/);
  assert.equal(rejected({ ...good, issue_type: 'tyres', description: 'Vaihda talvirenkaat' }), 'issue');
  assert.doesNotMatch(describeWorkTimes(), /tyres/);
  assert.match(describeWorkTimes(), /service 120/);
});

test('parseJob owns the work time coercion', () => {
  const job = parseJob({ issue_type: 'repair', powertrain: 'ev', duration_min: 'lots' });
  assert.deepEqual(job, { ok: true, value: { issue: 'repair', powertrain: 'ev', workMin: 120 } });
  const short = parseJob({ issue_type: 'repair', powertrain: 'nuclear', duration_min: 30 });
  assert.deepEqual(short, { ok: true, value: { issue: 'repair', powertrain: '', workMin: 30 } });
});

test('an electric car needs the high-voltage mechanic for repairs', () => {
  const ev = { ...good, powertrain: 'ev', issue_type: 'repair', description: 'Charging stops at 80 percent' };
  assert.equal(rejected({ ...ev, mechanic_id: 'service' }), 'mechanic');
  const r = createBooking({ ...ev, mechanic_id: 'hv', start: firstStart('hv', 120) }, cal, NOW);
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

test('a UTC start that names a free slot is booked', () => {
  const utc = new Date(good.start as string).toISOString().replace('.000Z', 'Z');
  const r = createBooking({ ...good, start: utc }, cal, NOW);
  assert.equal(r.state, 'booked');
  if (r.state === 'booked') assert.equal(r.booking.start, good.start);
});

test('contact requests share the validation and accept email instead of phone', () => {
  const base: RawInput = {
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
  const ok = createContactRequest(base, NOW);
  assert.equal(ok.state, 'sent');
  if (ok.state === 'sent') {
    assert.match(ok.request.ref, /^R-/);
    assert.equal(ok.request.vehicle, 'Volvo V60');
    assert.equal(ok.request.timing, 'next week');
  }
  const field = (input: RawInput) => {
    const r = createContactRequest(input, NOW);
    return r.state === 'rejected' ? r.field : r.state;
  };
  assert.equal(field({ ...base, consent: false }), 'consent');
  assert.equal(field({ ...base, name: '' }), 'contact');
  assert.equal(field({ ...base, email: '' }), 'contact');
  assert.equal(field({ ...base, make_model: '' }), 'vehicle');
  assert.equal(field({ ...base, issue_type: 'tyres' }), 'issue');
  assert.equal(field({ ...base, description: 'hi' }), 'description');
});
