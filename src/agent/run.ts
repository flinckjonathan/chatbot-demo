// One conversation turn: build the request, call the model, run the tools
// it asks for (at most three rounds), and always come back with a sentence
// for the customer. The customer never sees a stack trace: when the model
// fails after a booking already went through, the fixed fallback text tells
// them what happened.

import Anthropic from '@anthropic-ai/sdk';
import type { Lang } from '../booking/types.ts';
import type { ChatRequest } from '../guard/input.ts';
import type { AgentEvent, SessionState } from '../store/store.ts';
import { systemBlocks } from './prompt.ts';
import { bookingFallbackText, refusalText, requestFallbackText } from './texts.ts';
import { TOOLS, executeTool, type ToolContext } from './tools.ts';
import { parseIso, timeLabel } from '../booking/clock.ts';

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

/** The one method of the SDK the agent uses, so tests can hand in a fake. */
export interface ModelClient {
  create(params: Params): Promise<Message>;
}

export const MODEL = 'claude-opus-5-5';
export const MAX_TOOL_ROUNDS = 3;

export class ApiUnavailable extends Error {
  constructor(cause: unknown) {
    super('model API unavailable');
    this.cause = cause;
  }
}

export interface TurnInput {
  request: ChatRequest;
  state: SessionState;
  now: Date;
}

export interface TurnResult {
  reply: string;
  /** Reference of a booking or request created during this turn. */
  ref?: string;
  /** Events added during this turn, for the counter view. */
  events: AgentEvent[];
  state: SessionState;
  rounds: number;
}

export interface TurnOptions {
  model?: string;
  calendar?: ToolContext['calendar'];
}

function buildMessages(request: ChatRequest): MessageParam[] {
  const messages: MessageParam[] = request.history.map((h) => ({ role: h.role, content: h.text }));
  messages.push({ role: 'user', content: request.message });
  return messages;
}

function textOf(message: Message): string {
  return message.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

function createdRef(state: SessionState, before: { bookings: number; requests: number }): string | undefined {
  return state.bookings[before.bookings]?.ref ?? state.requests[before.requests]?.ref;
}

function fallbackAfterProgress(state: SessionState, before: { bookings: number; requests: number }, lang: Lang): string | null {
  const booking = state.bookings[before.bookings];
  if (booking) {
    const when = parseIso(booking.start);
    return bookingFallbackText(lang, booking.ref, when ? timeLabel(when, lang) : booking.start);
  }
  const request = state.requests[before.requests];
  if (request) return requestFallbackText(lang, request.ref);
  return null;
}

export async function runTurn(input: TurnInput, client: ModelClient, options: TurnOptions = {}): Promise<TurnResult> {
  const { request, state, now } = input;
  const before = { bookings: state.bookings.length, requests: state.requests.length, events: state.events.length };
  const ctx: ToolContext = { now, lang: request.lang, state, calendar: options.calendar };
  const messages = buildMessages(request);

  const params: Params = {
    model: options.model ?? MODEL,
    // Adaptive thinking shares this budget with the answer; the model only
    // bills what it uses, so a roomy ceiling costs nothing extra.
    max_tokens: 8192,
    output_config: { effort: 'medium' },
    // A safety classifier can decline a request (stop_reason "refusal").
    // Server-side fallback re-runs it on another model so an ordinary car
    // question is still answered.
    fallbacks: 'default',
    betas: ['server-side-fallback-2026-07-01'],
    system: systemBlocks(now, state, request.lang),
    tools: TOOLS,
    messages,
  };

  const call = async (): Promise<Message> => {
    try {
      return await client.create(params);
    } catch (err) {
      if (err instanceof Anthropic.APIError || err instanceof Anthropic.APIConnectionError) throw new ApiUnavailable(err);
      throw err;
    }
  };

  const finish = (reply: string, rounds: number): TurnResult => ({
    reply,
    ref: createdRef(state, before),
    events: state.events.slice(before.events),
    state,
    rounds,
  });

  let rounds = 0;
  let message: Message;
  try {
    message = await call();
    while (message.stop_reason === 'tool_use' && rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      const toolUses = message.content.filter(
        (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use',
      );
      if (toolUses.length === 0) break;
      // The assistant turn goes back exactly as received, thinking blocks included.
      messages.push({ role: 'assistant', content: message.content });
      const results: ToolResult[] = toolUses.map((t) => ({
        type: 'tool_result',
        tool_use_id: t.id,
        content: executeTool(t.name, t.input, ctx),
      }));
      messages.push({ role: 'user', content: results });
      message = await call();
    }
  } catch (err) {
    // A booking may already exist even though the closing call failed.
    const fallback = fallbackAfterProgress(state, before, request.lang);
    if (fallback) return finish(fallback, rounds);
    throw err;
  }

  if (message.stop_reason === 'refusal') return finish(refusalText(request.lang), rounds);
  const text = textOf(message);
  if (text) return finish(text, rounds);
  const fallback = fallbackAfterProgress(state, before, request.lang);
  if (fallback) return finish(fallback, rounds);
  throw new ApiUnavailable(new Error(`empty reply, stop_reason ${message.stop_reason ?? 'none'}`));
}
