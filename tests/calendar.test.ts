import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockCalendar, bookingWindow, hash32 } from '../src/booking/calendar.ts';
import { fromLocal, parseIso, toLocal } from '../src/booking/clock.ts';
import type { Booking } from '../src/booking/types.ts';

// Tuesday 13 October 2026, 10.00 workshop time.
const NOW = fromLocal('2026-10-13', 10 * 60);

test('hash32 is stable', () => {
  assert.equal(hash32('a'), hash32('a'));
  assert.notEqual(hash32('a'), hash32('b'));
});

test('free slots respect lead time, lunch, closing time and are deterministic', () => {
  const cal = new MockCalendar(NOW);
  const slots = cal.freeSlots('petri', 120, '2026-10-13', '2026-10-13');
  assert.ok(slots.length > 0, 'expected some free slots');
  for (const s of slots) {
    const start = toLocal(parseIso(s.start)!);
    const end = toLocal(parseIso(s.end)!);
    assert.ok(start.minutes >= 12 * 60, `start ${s.start} is before lead time plus lunch`);
    assert.ok(end.minutes <= 16 * 60, `block ${s.end} runs past closing`);
    assert.equal(start.minutes % 30, 0);
  }
  assert.deepEqual(cal.freeSlots('petri', 120, '2026-10-13', '2026-10-13'), slots);
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

test('a booking removes its slot and anything that overlaps it', () => {
  const empty = new MockCalendar(NOW);
  const first = empty.freeSlots('petri', 120, '2026-10-14', '2026-10-14')[0]!;
  assert.equal(empty.isFree('petri', first.start, 120), true);

  const booking: Booking = {
    ref: 'B-TEST1',
    mechanicId: 'petri',
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
  assert.equal(busy.isFree('petri', first.start, 120), false);
  const startMin = toLocal(parseIso(first.start)!).minutes;
  const endMin = toLocal(parseIso(first.end)!).minutes;
  for (const s of busy.freeSlots('petri', 30, '2026-10-14', '2026-10-14')) {
    const m = toLocal(parseIso(s.start)!).minutes;
    assert.ok(m + 45 <= startMin || m >= endMin, `slot ${s.start} overlaps the booking`);
  }
  assert.deepEqual(
    busy.freeSlots('sami', 120, '2026-10-14', '2026-10-14'),
    empty.freeSlots('sami', 120, '2026-10-14', '2026-10-14'),
    'other mechanics are unaffected',
  );
});

test('isFree compares instants, not strings', () => {
  const cal = new MockCalendar(NOW);
  const slot = cal.freeSlots('petri', 60, '2026-10-14', '2026-10-14')[0]!;
  const utc = new Date(slot.start).toISOString().replace('.000Z', 'Z');
  assert.equal(cal.isFree('petri', utc, 60), true);
  assert.equal(cal.isFree('petri', 'nonsense', 60), false);
});
