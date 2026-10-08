import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, fromLocal, localIso, offsetMinutes, parseIso, timeLabel, toLocal, weekdayOf } from '../src/booking/clock.ts';

test('localIso carries the Helsinki offset for summer and winter time', () => {
  assert.equal(localIso('2026-10-13', 9 * 60), '2026-10-13T09:00:00+03:00');
  assert.equal(localIso('2026-11-02', 9 * 60), '2026-11-02T09:00:00+02:00');
});

test('toLocal reads a timestamp back as workshop wall-clock time', () => {
  const d = parseIso('2026-10-13T09:00:00+03:00');
  assert.ok(d);
  assert.deepEqual(toLocal(d), { date: '2026-10-13', minutes: 540, weekday: 2 });
  assert.equal(offsetMinutes(d), 180);
});

test('fromLocal and toLocal round-trip across the DST change', () => {
  for (const [date, minutes] of [
    ['2026-10-24', 15 * 60],
    ['2026-10-25', 15 * 60],
    ['2026-10-26', 8 * 60],
  ] as const) {
    assert.deepEqual(toLocal(fromLocal(date, minutes)), { ...toLocal(fromLocal(date, minutes)), date, minutes });
  }
});

test('date arithmetic stays in calendar days', () => {
  assert.equal(addDays('2026-10-30', 3), '2026-11-02');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekdayOf('2026-10-11'), 7);
  assert.equal(weekdayOf('2026-10-12'), 1);
});

test('parseIso rejects anything without an offset', () => {
  assert.equal(parseIso('2026-10-13T09:00:00'), null);
  assert.equal(parseIso('2026-10-13'), null);
  assert.equal(parseIso(42), null);
  assert.ok(parseIso('2026-10-13T09:00Z'));
});

test('timeLabel uses the same shape in every language', () => {
  const d = parseIso('2026-10-13T09:00:00+03:00')!;
  assert.equal(timeLabel(d, 'fi'), 'ti 13.10. klo 9.00');
  assert.equal(timeLabel(d, 'sv'), 'tis 13.10. kl. 9.00');
  assert.equal(timeLabel(d, 'en'), 'Tue 13.10. at 9.00');
});
