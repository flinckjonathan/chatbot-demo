import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/store.ts';
import { SESSION } from './fixtures.ts';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test('session updates serialize read-modify-write mutations', async () => {
  const store = new MemoryStore();
  await Promise.all([
    store.update(SESSION, async (state) => {
      await wait(10);
      state.events.push({ at: '2026-10-13T07:00:00.000Z', kind: 'lookup', text: 'first' });
      return true;
    }),
    store.update(SESSION, (state) => {
      state.events.push({ at: '2026-10-13T07:00:01.000Z', kind: 'feedback', text: 'second' });
      return true;
    }),
  ]);

  const state = await store.get(SESSION);
  assert.deepEqual(state.events.map((e) => e.text), ['first', 'second']);
});

test('session updates can validate without saving a failed mutation', async () => {
  const store = new MemoryStore();
  await store.update(SESSION, (state) => {
    state.events.push({ at: '2026-10-13T07:00:00.000Z', kind: 'lookup', text: 'kept' });
    return true;
  });
  await store.update(SESSION, (state) => {
    state.events.push({ at: '2026-10-13T07:00:01.000Z', kind: 'error', text: 'discarded' });
    return false;
  });

  const state = await store.get(SESSION);
  assert.deepEqual(state.events.map((e) => e.text), ['kept']);
});
