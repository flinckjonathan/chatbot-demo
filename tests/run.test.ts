import { test } from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { FakeModel, fakeMessage, fakeText, fakeToolUse } from '../src/agent/fake.ts';
import { ApiUnavailable, runTurn, type ModelClient, type TurnDeps } from '../src/agent/run.ts';
import { cutShortText, refusalText } from '../src/agent/texts.ts';
import { mockCalendarFactory } from '../src/booking/calendar.ts';
import { MAX_EVENTS, emptySession } from '../src/store/store.ts';
import { NOW, TINY_JPEG, bookingInput, chatBody, firstStart } from './fixtures.ts';

function deps(client: ModelClient): TurnDeps {
  return { client, calendar: mockCalendarFactory };
}

const LOOKUP_ALL = { issue_type: 'service', powertrain: '', mechanic_id: '', duration_min: 0, from_date: '' };

test('the scripted model walks through lookup, booking and the one-booking guard', async () => {
  const fake = deps(new FakeModel());
  const state = emptySession();

  const t1 = await runTurn(chatBody('Can I book a service?'), state, NOW, fake);
  assert.match(t1.reply, /calendar says/);
  assert.match(t1.mid, /^[a-f0-9]{8}$/);
  assert.equal(t1.rounds, 1);
  assert.deepEqual(state.events.map((e) => e.kind), ['lookup']);
  assert.equal(state.bookings.length, 0);
  assert.equal(state.transcript.length, 2);
  assert.equal(state.transcript[1]?.mid, t1.mid);

  const t2 = await runTurn(chatBody('yes'), state, NOW, fake);
  assert.match(t2.reply, /^Booking confirmed\. Reference B-/);
  assert.match(t2.ref ?? '', /^B-/);
  assert.equal(state.bookings.length, 1);
  assert.equal(state.events.at(-1)?.kind, 'booking');

  const t3 = await runTurn(chatBody('yes'), state, NOW, fake);
  assert.match(t3.reply, /refused/);
  assert.equal(t3.ref, undefined);
  assert.equal(state.bookings.length, 1);
  assert.equal(state.events.at(-1)?.kind, 'blocked');
  assert.equal(state.transcript.length, 6);
});

test('pictures go to the model as image blocks and are not kept in the transcript', async () => {
  let seen: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming | undefined;
  const client: ModelClient = {
    async create(params) {
      seen = params;
      return fakeText('That is a battery warning light.');
    },
  };
  const state = emptySession();
  await runTurn(chatBody('', { images: [{ mediaType: 'image/jpeg', data: TINY_JPEG }] }), state, NOW, deps(client));
  const last = seen?.messages.at(-1);
  assert.ok(last && Array.isArray(last.content));
  assert.equal(last.content[0]?.type, 'image');
  assert.equal(last.content[1]?.type, 'text');
  assert.equal(state.transcript[0]?.text, '(sent 1 picture)');
  assert.ok(!JSON.stringify(state).includes(TINY_JPEG));
});

test('a refusal becomes the polite fixed text', async () => {
  const refusing: ModelClient = { async create() { return fakeMessage([], 'refusal'); } };
  const state = emptySession();
  const t = await runTurn(chatBody('hello'), state, NOW, deps(refusing));
  assert.equal(t.reply, refusalText('en'));
});

test('a reply cut off by max_tokens says so', async () => {
  const truncating: ModelClient = { async create() { return fakeText('The earliest time is', 'max_tokens'); } };
  const t = await runTurn(chatBody('times?'), emptySession(), NOW, deps(truncating));
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
    runTurn(chatBody('hello'), state, NOW, deps(unauthorised)),
    (err: unknown) => err instanceof ApiUnavailable && err.kind === 'config',
  );
  const broken: ModelClient = {
    async create() {
      throw new Anthropic.APIConnectionError({ message: 'socket hang up' });
    },
  };
  await assert.rejects(
    runTurn(chatBody('hello'), state, NOW, deps(broken)),
    (err: unknown) => err instanceof ApiUnavailable && err.kind === 'transient',
  );
  assert.equal(state.transcript.length, 0, 'failed turns are not written to the transcript');
});

test('an API failure after a booking still tells the customer about the booking', async () => {
  const state = emptySession();
  let calls = 0;
  const flaky: ModelClient = {
    async create() {
      calls++;
      if (calls === 1) return fakeToolUse('create_booking', bookingInput({ start: firstStart('service', 120) }), 'toolu_1');
      throw new Anthropic.APIConnectionError({ message: 'timeout' });
    },
  };
  const t = await runTurn(chatBody('yes, book it'), state, NOW, deps(flaky));
  assert.equal(state.bookings.length, 1);
  assert.match(t.reply, /^Your booking is confirmed: Wed 14\.10\. at \d+\.\d{2}, reference B-/);
  assert.equal(t.ref, state.bookings[0]?.ref);
  assert.equal(state.events.at(-1)?.kind, 'booking');
});

test('a failed turn still folds its log into the session', async () => {
  const state = emptySession();
  let calls = 0;
  const flaky: ModelClient = {
    async create() {
      calls++;
      if (calls === 1) return fakeToolUse('get_available_times', LOOKUP_ALL, 'toolu_1');
      throw new Anthropic.APIConnectionError({ message: 'timeout' });
    },
  };
  await assert.rejects(runTurn(chatBody('times?'), state, NOW, deps(flaky)), ApiUnavailable);
  assert.deepEqual(state.events.map((e) => e.kind), ['lookup']);
});

test('after three tool rounds the model is asked to close the turn in words', async () => {
  let calls = 0;
  let closingCall: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming | undefined;
  const looping: ModelClient = {
    async create(params) {
      calls++;
      if (params.tool_choice?.type === 'none') {
        closingCall = params;
        return fakeText('Here is what I found so far.');
      }
      return fakeToolUse('get_available_times', LOOKUP_ALL, `toolu_${calls}`);
    },
  };
  const state = emptySession();
  const t = await runTurn(chatBody('times?'), state, NOW, deps(looping));
  assert.equal(calls, 5);
  assert.ok(closingCall);
  assert.equal(t.reply, 'Here is what I found so far.');
  assert.equal(t.rounds, 3);
  assert.equal(state.events.length, 3);
});

test('refused tool results are flagged as errors on the API side', async () => {
  const seen: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[] = [];
  let calls = 0;
  const client: ModelClient = {
    async create(params) {
      seen.push(params);
      calls++;
      return calls === 1 ? fakeToolUse('create_booking', bookingInput({ consent: false }), 'toolu_1') : fakeText('Please confirm first.');
    },
  };
  await runTurn(chatBody('book it'), emptySession(), NOW, deps(client));
  const last = seen[1]?.messages.at(-1);
  assert.ok(last && typeof last.content !== 'string');
  const result = last.content[0];
  assert.ok(result && result.type === 'tool_result');
  assert.equal(result.is_error, true);
});

test('the log keeps its newest lines when it is full', async () => {
  const state = emptySession();
  for (let i = 0; i < MAX_EVENTS; i++) state.events.push({ at: NOW.toISOString(), kind: 'lookup', text: `old ${i}` });
  let calls = 0;
  const once: ModelClient = {
    async create() {
      calls++;
      return calls === 1 ? fakeToolUse('get_available_times', LOOKUP_ALL, 'toolu_1') : fakeText('Done.');
    },
  };
  await runTurn(chatBody('times?'), state, NOW, deps(once));
  assert.equal(state.events.length, MAX_EVENTS);
  assert.match(state.events.at(-1)?.text ?? '', /^Looked up/);
  assert.equal(state.events[0]?.text, 'old 1');
});
