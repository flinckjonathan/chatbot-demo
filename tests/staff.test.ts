import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPreview } from '../src/agent/preview.ts';
import { additionsBlock, promptSections } from '../src/agent/prompt.ts';
import { MAX_ADDITIONS, addAddition, approvedAdditions, deleteAddition, setAdditionStatus } from '../src/staff/additions.ts';
import { emptySession } from '../src/store/store.ts';
import { NOW } from './fixtures.ts';

test('an addition waits for approval and only then reaches the prompt', () => {
  const state = emptySession();
  const added = addAddition(state, 'From next week the shop opens at 7.30 on Mondays.', NOW);
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.addition.status, 'pending');
  assert.equal(additionsBlock(state), '');
  assert.equal(promptSections(NOW, state, 'en').length, 3);

  assert.equal(setAdditionStatus(state, added.addition.id, 'approved'), true);
  const block = additionsBlock(state);
  assert.match(block, /^=== STAFF ADDITIONS ===/);
  assert.match(block, /\(added 13\.10\.2026\):\nFrom next week/);
  assert.match(block, /the addition is the current information/);
  const sections = promptSections(NOW, state, 'en');
  assert.deepEqual(sections.map((s) => s.name), ['Binding rules', 'Knowledge base', 'Staff additions', 'Current situation']);
  assert.deepEqual(sections.map((s) => s.cached === true), [false, true, false, false], 'the cache point stays on the knowledge base');

  assert.equal(setAdditionStatus(state, added.addition.id, 'hidden'), true);
  assert.equal(additionsBlock(state), '');
  assert.equal(setAdditionStatus(state, 'A-NOPE', 'approved'), false);
});

test('additions are cleaned, bounded and deletable', () => {
  const state = emptySession();
  assert.equal(addAddition(state, 'short', NOW).ok, false);
  assert.equal(addAddition(state, 42, NOW).ok, false);
  const long = addAddition(state, `x${' '.repeat(5)}y`.repeat(500), NOW);
  assert.equal(long.ok && long.addition.text.length <= 2000, true);
  for (let i = state.additions.length; i < MAX_ADDITIONS; i++) assert.equal(addAddition(state, `fact number ${i} for the bot`, NOW).ok, true);
  assert.equal(addAddition(state, 'one too many for the queue', NOW).ok, false);
  const first = state.additions[0]!;
  assert.equal(deleteAddition(state, first.id), true);
  assert.equal(deleteAddition(state, first.id), false);
  assert.equal(state.additions.length, MAX_ADDITIONS - 1);
  assert.equal(approvedAdditions(state).length, 0);
});

test('the preview mirrors the prompt sections and lists the tools', () => {
  const state = emptySession();
  const preview = buildPreview(NOW, state, 'fi');
  assert.deepEqual(preview.sections.map((s) => s.name), ['Binding rules', 'Knowledge base', 'Current situation']);
  assert.equal(preview.sections[1]?.cached, true);
  assert.equal(preview.sections[1]?.chars, preview.sections[1]?.text.length);
  assert.deepEqual(preview.tools.map((t) => t.name), ['get_available_times', 'create_booking', 'send_contact_request']);
  assert.ok(preview.tools.every((t) => t.description.length > 20));
});
