import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockCalendar, bookingWindow, hash32 } from '../src/booking/calendar.ts';
import type { Booking } from '../src/booking/types.ts';
import { NOW } from './fixtures.ts';

test('hash32 is stable', () => {
  assert.equal(hash32('a'), hash32('a'));
  assert.notEqual(hash32('a'), hash32('b'));
});

test('the booking window starts today unless a later date inside it is asked for', () => {
  assert.deepEqual(bookingWindow(NOW), { from: '2026-10-13', to: '2026-10-27' });
  assert.equal(bookingWindow(NOW, '2026-10-20').from, '2026-10-20');
  assert.equal(bookingWindow(NOW, '2026-10-01').from, '2026-10-13');
  assert.equal(bookingWindow(NOW, '2026-11-20').from, '2026-10-13');
  assert.equal(bookingWindow(NOW, 'next week').from, '2026-10-13');
});

test('free slots respect lead time, lunch, closing time and are deterministic', () => {
  const cal = new MockCalendar(NOW);
  const slots = cal.freeSlots('petri', 120, '2026-10-13', '2026-10-13');
  assert.ok(slots.length > 0, 'expected some free slots');
  for (const s of slots) {
    assert.ok(s.startMin >= 12 * 60, `start ${s.start} is before lead time plus lunch`);
    assert.ok(s.endMin <= 16 * 60, `block ${s.end} runs past closing`);
    assert.equal(s.startMin % 30, 0);
    assert.equal(s.date, '2026-10-13');
    assert.match(s.start, /^2026-10-13T\d{2}:\d{2}:00\+03:00$/);
  }
  assert.deepEqual(cal.freeSlots('petri', 120, '2026-10-13', '2026-10-13'), slots);
});

test('limit stops the scan early and keeps the earliest slots', () => {
  const cal = new MockCalendar(NOW);
  const all = cal.freeSlots('petri', 60, '2026-10-13', '2026-10-27');
  assert.deepEqual(cal.freeSlots('petri', 60, '2026-10-13', '2026-10-27', 1), all.slice(0, 1));
  assert.deepEqual(cal.freeSlots('petri', 60, '2026-10-13', '2026-10-27', 5), all.slice(0, 5));
});

test('weekends have no slots', () => {
  const cal = new MockCalendar(NOW);
  assert.deepEqual(cal.freeSlots('petri', 60, '2026-10-17', '2026-10-18'), []);
});

test('a booked-out mechanic has nothing for the first days but something in the window', () => {
  const cal = new MockCalendar(NOW);
  assert.deepEqual(cal.freeSlots('aino', 60, '2026-10-13', '2026-10-15'), []);
  const window = bookingWindow(NOW);
  assert.ok(cal.freeSlots('aino', 60, window.from, window.to).length > 0);
});

test('a booking removes its slot and anything that overlaps it, for that mechanic only', () => {
  const empty = new MockCalendar(NOW);
  const first = empty.freeSlots('petri', 120, '2026-10-14', '2026-10-14', 1)[0]!;
  assert.ok(empty.findSlot('petri', first.start, 120));

  const booking: Booking = {
    ref: 'B-TEST1',
    mechanicId: 'petri',
    date: first.date,
    startMin: first.startMin,
    endMin: first.endMin,
    start: first.start,
    end: first.end,
    workMin: 120,
    issueType: 'service',
    name: 'Test',
    phone: '040 123 4567',
    email: '',
    vehicle: 'ABC-123',
    description: 'test booking',
    createdAt: NOW.toISOString(),
  };
  const busy = new MockCalendar(NOW, [booking]);
  assert.equal(busy.findSlot('petri', first.start, 120), null);
  for (const s of busy.freeSlots('petri', 30, '2026-10-14', '2026-10-14')) {
    assert.ok(s.endMin <= first.startMin || s.startMin >= first.endMin, `slot ${s.start} overlaps the booking`);
  }
  assert.deepEqual(
    busy.freeSlots('sami', 120, '2026-10-14', '2026-10-14'),
    empty.freeSlots('sami', 120, '2026-10-14', '2026-10-14'),
    'other mechanics are unaffected',
  );
});

test('findSlot compares instants, not strings', () => {
  const cal = new MockCalendar(NOW);
  const slot = cal.freeSlots('petri', 60, '2026-10-14', '2026-10-14', 1)[0]!;
  const utc = new Date(slot.start).toISOString().replace('.000Z', 'Z');
  assert.deepEqual(cal.findSlot('petri', utc, 60), slot);
  assert.equal(cal.findSlot('petri', 'nonsense', 60), null);
  assert.equal(cal.findSlot('petri', '2026-10-14T11:00:00+03:00', 60), null, 'lunch is never a slot');
});
