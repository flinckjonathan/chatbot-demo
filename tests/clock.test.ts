import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  clockLabel,
  dayLabel,
  fromLocal,
  isDateString,
  localIso,
  offsetForDate,
  offsetMinutes,
  parseIso,
  timeLabel,
  toLocal,
  weekdayOf,
  whenLabel,
} from '../src/booking/clock.ts';

test('localIso carries the Helsinki offset for summer and winter time', () => {
  assert.equal(localIso('2026-10-13', 9 * 60), '2026-10-13T09:00:00+03:00');
  assert.equal(localIso('2026-11-02', 9 * 60), '2026-11-02T09:00:00+02:00');
  assert.equal(offsetForDate('2026-10-13'), 180);
  assert.equal(localIso('2026-10-13', 9 * 60, 180), localIso('2026-10-13', 9 * 60));
});

test('toLocal reads a timestamp back as workshop wall-clock time', () => {
  const d = parseIso('2026-10-13T09:00:00+03:00');
  assert.ok(d);
  assert.deepEqual(toLocal(d), { date: '2026-10-13', minutes: 540 });
  assert.equal(offsetMinutes(d), 180);
});

test('fromLocal and toLocal round-trip across the DST change', () => {
  for (const [date, minutes] of [
    ['2026-10-24', 15 * 60],
    ['2026-10-25', 15 * 60],
    ['2026-10-26', 8 * 60],
  ] as const) {
    assert.deepEqual(toLocal(fromLocal(date, minutes)), { date, minutes });
  }
});

test('date arithmetic stays in calendar days', () => {
  assert.equal(addDays('2026-10-30', 3), '2026-11-02');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekdayOf('2026-10-11'), 7);
  assert.equal(weekdayOf('2026-10-12'), 1);
});

test('isDateString accepts only real calendar dates', () => {
  assert.equal(isDateString('2026-10-13'), true);
  assert.equal(isDateString('2026-02-31'), false);
  assert.equal(isDateString('2026-13-01'), false);
  assert.equal(isDateString('13.10.2026'), false);
  assert.equal(isDateString(20261013), false);
});

test('parseIso rejects anything without an offset', () => {
  assert.equal(parseIso('2026-10-13T09:00:00'), null);
  assert.equal(parseIso('2026-10-13'), null);
  assert.equal(parseIso(42), null);
  assert.ok(parseIso('2026-10-13T09:00Z'));
  assert.equal(parseIso('2026-10-13T07:00:00.000Z')?.getTime(), parseIso('2026-10-13T10:00:00+03:00')?.getTime());
});

test('labels use the same shape in every language', () => {
  const d = parseIso('2026-10-13T09:00:00+03:00')!;
  assert.equal(timeLabel(d, 'fi'), 'ti 13.10. klo 9.00');
  assert.equal(timeLabel(d, 'sv'), 'tis 13.10. kl. 9.00');
  assert.equal(timeLabel(d, 'en'), 'Tue 13.10. at 9.00');
  assert.equal(whenLabel({ date: '2026-10-13', startMin: 540 }, 'fi'), timeLabel(d, 'fi'));
  assert.equal(dayLabel('2026-10-13', 'en'), 'Tue 13.10.');
  assert.equal(clockLabel(8 * 60 + 5), '8.05');
  assert.equal(clockLabel(16 * 60), '16.00');
});
