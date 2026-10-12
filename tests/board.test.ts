import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, workingDays } from '../src/agent/board.ts';
import { mockCalendarFactory } from '../src/booking/calendar.ts';
import { createBooking } from '../src/booking/core.ts';
import { emptySession } from '../src/store/store.ts';
import { NOW, bookingInput, firstStart } from './fixtures.ts';

test('the board covers the next five working days from today', () => {
  assert.deepEqual(workingDays(NOW), ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19']);
});

test('a booking beyond the five days adds its day to the board, marked as later', () => {
  const state = emptySession();
  // Wednesday 21 October is inside the booking window but past the five board days.
  const slot = mockCalendarFactory(NOW, []).freeSlots('service', 120, '2026-10-21', '2026-10-21', 1)[0];
  assert.ok(slot, 'expected a free slot on 21 October');
  const r = createBooking(bookingInput({ start: slot.start }), mockCalendarFactory(NOW, []), NOW);
  assert.equal(r.state, 'booked');
  if (r.state !== 'booked') return;
  state.bookings.push(r.booking);
  const board = buildBoard(NOW, state, 'en', mockCalendarFactory);
  assert.deepEqual(
    board.days.map((d) => `${d.date}${d.later ? '*' : ''}`),
    ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-21*'],
  );
  const cell = board.cells.find((c) => c.date === '2026-10-21' && c.mechanicId === 'service');
  assert.equal(cell?.booked.length, 1);
});

test('a booking shows as a block in its cell and the log carries a workshop-time label', () => {
  const state = emptySession();
  const start = firstStart('service', 120);
  const r = createBooking(bookingInput({ start }), mockCalendarFactory(NOW, []), NOW);
  assert.equal(r.state, 'booked');
  if (r.state !== 'booked') return;
  state.bookings.push(r.booking);
  state.events.push({ at: NOW.toISOString(), kind: 'booking', text: 'Booked.' });

  const board = buildBoard(NOW, state, 'fi', mockCalendarFactory);
  assert.equal(board.days[0]?.label, 'ti 13.10.');
  const cell = board.cells.find((c) => c.mechanicId === 'service' && c.date === r.booking.date);
  assert.ok(cell);
  assert.equal(cell.booked[0]?.ref, r.booking.ref);
  assert.match(cell.booked[0]?.start ?? '', /^\d{1,2}\.\d{2}$/);
  assert.ok(!cell.free.includes(cell.booked[0]!.start), 'the booked start is no longer free');
  assert.equal(board.events[0]?.time, '10.00');
  assert.ok(!JSON.stringify(board).includes('Test Person'), 'customer names never leave the server');
});
