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
