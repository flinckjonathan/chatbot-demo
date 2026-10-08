import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { FakeModel } from '../src/agent/fake.ts';
import { ApiUnavailable, runTurn, type ModelClient } from '../src/agent/run.ts';
import { cutShortText, refusalText } from '../src/agent/texts.ts';
import { MockCalendar } from '../src/booking/calendar.ts';
import { fromLocal } from '../src/booking/clock.ts';
import type { ChatRequest } from '../src/guard/input.ts';
import { MAX_EVENTS, emptySession, type SessionState } from '../src/store/store.ts';

const NOW = fromLocal('2026-10-13', 10 * 60);
const SESSION = '123e4567-e89b-12d3-a456-426614174000';

function req(message: string, state: SessionState): ChatRequest {
  return { sessionId: SESSION, lang: 'en', message, history: state.transcript };
}

function message(content: unknown[], stop: string): Anthropic.Beta.Messages.BetaMessage {
  return { content, stop_reason: stop } as unknown as Anthropic.Beta.Messages.BetaMessage;
}

const LOOKUP_CALL = {
  type: 'tool_use',
  id: 'toolu_lookup',
  name: 'get_available_times',
  input: { issue_type: 'service', powertrain: '', mechanic_id: '', duration_min: 0, from_date: '' },
};

test('the scripted model walks through lookup, booking and the one-booking guard', async () => {
  const fake = new FakeModel();
  const state = emptySession();

  const t1 = await runTurn({ request: req('Can I book a service?', state), state, now: NOW }, fake);
  assert.match(t1.reply, /calendar says/);
  assert.equal(t1.rounds, 1);
  assert.equal(t1.events.length, 1);
  assert.equal(t1.events[0]?.kind, 'lookup');
  assert.equal(state.bookings.length, 0);
  assert.equal(state.transcript.length, 2);

  const t2 = await runTurn({ request: req('yes', state), state, now: NOW }, fake);
  assert.match(t2.reply, /^Booking confirmed\. Reference B-/);
  assert.match(t2.ref ?? '', /^B-/);
  assert.equal(state.bookings.length, 1);
  assert.equal(t2.events.at(-1)?.kind, 'booking');

  const t3 = await runTurn({ request: req('yes', state), state, now: NOW }, fake);
  assert.match(t3.reply, /refused/);
  assert.equal(state.bookings.length, 1);
  assert.equal(t3.events.at(-1)?.kind, 'blocked');
  assert.equal(state.transcript.length, 6);
});

test('a refusal becomes the polite fixed text', async () => {
  const refusing: ModelClient = { async create() { return message([], 'refusal'); } };
  const state = emptySession();
  const t = await runTurn({ request: req('hello', state), state, now: NOW }, refusing);
  assert.equal(t.reply, refusalText('en'));
});

test('a reply cut off by max_tokens says so', async () => {
  const truncating: ModelClient = {
    async create() {
      return message([{ type: 'text', text: 'The earliest time is' }], 'max_tokens');
    },
  };
  const state = emptySession();
  const t = await runTurn({ request: req('times?', state), state, now: NOW }, truncating);
  assert.equal(t.reply, `The earliest time is\n\n${cutShortText('en')}`);
});

test('API failures are classified: a bad key is a config error, a connection drop is transient', async () => {
  const unauthorised: ModelClient = {
    async create() {
      throw new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'bad key' } }, 'bad key', new Headers());
    },
  };
  const state = emptySession();
  await assert.rejects(
    runTurn({ request: req('hello', state), state, now: NOW }, unauthorised),
    (err: unknown) => err instanceof ApiUnavailable && err.kind === 'config',
  );
  const broken: ModelClient = {
    async create() {
      throw new Anthropic.APIConnectionError({ message: 'socket hang up' });
    },
  };
  await assert.rejects(
    runTurn({ request: req('hello', state), state, now: NOW }, broken),
    (err: unknown) => err instanceof ApiUnavailable && err.kind === 'transient',
  );
  assert.equal(state.transcript.length, 0, 'failed turns are not written to the transcript');
});

test('an API failure after a booking still tells the customer about the booking', async () => {
  const state = emptySession();
  const slot = new MockCalendar(NOW).freeSlots('petri', 120, '2026-10-14', '2026-10-20')[0]!;
  let calls = 0;
  const flaky: ModelClient = {
    async create() {
      calls++;
      if (calls === 1) {
        return message(
          [
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
          'tool_use',
        );
      }
      throw new Anthropic.APIConnectionError({ message: 'timeout' });
    },
  };
  const t = await runTurn({ request: req('yes, book it', state), state, now: NOW }, flaky);
  assert.equal(state.bookings.length, 1);
  assert.match(t.reply, /^Your booking is confirmed: Wed 14\.10\. at \d+\.\d{2}, reference B-/);
  assert.equal(t.ref, state.bookings[0]?.ref);
});

test('after three tool rounds the model is asked to close the turn in words', async () => {
  let calls = 0;
  let closingCall: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming | undefined;
  const looping: ModelClient = {
    async create(params) {
      calls++;
      if (params.tool_choice?.type === 'none') {
        closingCall = params;
        return message([{ type: 'text', text: 'Here is what I found so far.' }], 'end_turn');
      }
      return message([{ ...LOOKUP_CALL, id: `toolu_${calls}` }], 'tool_use');
    },
  };
  const state = emptySession();
  const t = await runTurn({ request: req('times?', state), state, now: NOW }, looping);
  assert.equal(calls, 5);
  assert.ok(closingCall);
  assert.equal(t.reply, 'Here is what I found so far.');
  assert.equal(t.rounds, 3);
  assert.equal(t.events.length, 3);
});

test('the per-turn event list survives the log being full', async () => {
  const state = emptySession();
  for (let i = 0; i < MAX_EVENTS; i++) state.events.push({ at: NOW.toISOString(), kind: 'lookup', text: `old ${i}` });
  let calls = 0;
  const once: ModelClient = {
    async create() {
      calls++;
      return calls === 1 ? message([LOOKUP_CALL], 'tool_use') : message([{ type: 'text', text: 'Done.' }], 'end_turn');
    },
  };
  const t = await runTurn({ request: req('times?', state), state, now: NOW }, once);
  assert.equal(t.events.length, 1);
  assert.equal(state.events.length, MAX_EVENTS);
  assert.equal(state.events.at(-1)?.text, t.events[0]?.text);
});
