import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { FakeModel } from '../src/agent/fake.ts';
import { ApiUnavailable, runTurn, type ModelClient } from '../src/agent/run.ts';
import { refusalText } from '../src/agent/texts.ts';
import { MockCalendar } from '../src/booking/calendar.ts';
import { fromLocal } from '../src/booking/clock.ts';
import type { ChatRequest } from '../src/guard/input.ts';
import { emptySession } from '../src/store/store.ts';

const NOW = fromLocal('2026-10-13', 10 * 60);
const SESSION = '123e4567-e89b-12d3-a456-426614174000';

function req(message: string, history: ChatRequest['history'] = []): ChatRequest {
  return { sessionId: SESSION, lang: 'en', message, history };
}

test('the scripted model walks through lookup, booking and the one-booking guard', async () => {
  const fake = new FakeModel();
  const state = emptySession();

  const t1 = await runTurn({ request: req('Can I book a service?'), state, now: NOW }, fake);
  assert.match(t1.reply, /calendar says/);
  assert.equal(t1.rounds, 1);
  assert.equal(t1.events.length, 1);
  assert.equal(t1.events[0]?.kind, 'lookup');
  assert.equal(state.bookings.length, 0);

  const history: ChatRequest['history'] = [
    { role: 'user', text: 'Can I book a service?' },
    { role: 'assistant', text: t1.reply },
  ];
  const t2 = await runTurn({ request: req('yes', history), state, now: NOW }, fake);
  assert.match(t2.reply, /^Booking confirmed\. Reference B-/);
  assert.match(t2.ref ?? '', /^B-/);
  assert.equal(state.bookings.length, 1);
  assert.equal(t2.events.at(-1)?.kind, 'booking');

  history.push({ role: 'user', text: 'yes' }, { role: 'assistant', text: t2.reply });
  const t3 = await runTurn({ request: req('yes', history), state, now: NOW }, fake);
  assert.match(t3.reply, /refused/);
  assert.equal(state.bookings.length, 1);
  assert.equal(t3.events.at(-1)?.kind, 'blocked');
});

test('a refusal becomes the polite fixed text', async () => {
  const refusing: ModelClient = {
    async create() {
      return { content: [], stop_reason: 'refusal' } as unknown as Anthropic.Beta.Messages.BetaMessage;
    },
  };
  const t = await runTurn({ request: req('hello'), state: emptySession(), now: NOW }, refusing);
  assert.equal(t.reply, refusalText('en'));
});

test('an API failure before any progress is reported as unavailable', async () => {
  const broken: ModelClient = {
    async create() {
      throw new Anthropic.APIConnectionError({ message: 'socket hang up' });
    },
  };
  await assert.rejects(runTurn({ request: req('hello'), state: emptySession(), now: NOW }, broken), ApiUnavailable);
});

test('an API failure after a booking still tells the customer about the booking', async () => {
  const state = emptySession();
  const slot = new MockCalendar(NOW).freeSlots('petri', 120, '2026-10-14', '2026-10-20')[0]!;
  let calls = 0;
  const flaky: ModelClient = {
    async create() {
      calls++;
      if (calls === 1) {
        return {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'create_booking',
              input: {
                name: 'Test Person',
                phone: '0401234567',
                email: '',
                rego: 'ABC-123',
                make_model: '',
                powertrain: '',
                issue_type: 'service',
                description: 'Annual service, please',
                mechanic_id: 'petri',
                start: slot.start,
                duration_min: 0,
                consent: true,
              },
            },
          ],
          stop_reason: 'tool_use',
        } as unknown as Anthropic.Beta.Messages.BetaMessage;
      }
      throw new Anthropic.APIConnectionError({ message: 'timeout' });
    },
  };
  const t = await runTurn({ request: req('yes, book it'), state, now: NOW }, flaky);
  assert.equal(state.bookings.length, 1);
  assert.match(t.reply, /^Your booking is confirmed: Wed 14\.10\. at \d+\.\d{2}, reference B-/);
  assert.equal(t.ref, state.bookings[0]?.ref);
});

test('the tool loop stops after three rounds even if the model keeps asking', async () => {
  let calls = 0;
  const looping: ModelClient = {
    async create() {
      calls++;
      return {
        content: [
          {
            type: 'tool_use',
            id: `toolu_${calls}`,
            name: 'get_available_times',
            input: { issue_type: 'service', powertrain: '', mechanic_id: '', duration_min: 0, from_date: '' },
          },
        ],
        stop_reason: 'tool_use',
      } as unknown as Anthropic.Beta.Messages.BetaMessage;
    },
  };
  await assert.rejects(runTurn({ request: req('times?'), state: emptySession(), now: NOW }, looping), ApiUnavailable);
  assert.equal(calls, 4);
});
