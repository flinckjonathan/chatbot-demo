import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockEnd, inBreak, workMinutes } from '../src/booking/duration.ts';

test('work minutes fall back to the issue default', () => {
  assert.equal(workMinutes('service'), 120);
  assert.equal(workMinutes('diagnostics', 0), 60);
  assert.equal(workMinutes('other', -5), 60);
  assert.equal(workMinutes('repair', 'ninety'), 120);
  assert.equal(workMinutes('repair', Number.NaN), 120);
});

test('suggestions are clamped and rounded to the booking step', () => {
  assert.equal(workMinutes('repair', 30), 30);
  assert.equal(workMinutes('repair', 20), 30);
  assert.equal(workMinutes('repair', 44), 30);
  assert.equal(workMinutes('repair', 46), 60);
  assert.equal(workMinutes('repair', 1000), 240);
});

test('the lunch break is closed for starts and stretches a block that runs across it', () => {
  assert.equal(inBreak(11 * 60), true);
  assert.equal(inBreak(11 * 60 + 44), true);
  assert.equal(inBreak(11 * 60 + 45), false);
  assert.equal(blockEnd(8 * 60, 60), 8 * 60 + 75);
  assert.equal(blockEnd(10 * 60, 120), 13 * 60);
});
