// One conversation turn: build the request, call the model, run the tools
// it asks for (at most three rounds), and always come back with a sentence
// for the customer. The customer never sees a stack trace: when the model
// fails after a booking already went through, the fixed fallback text tells
// them what happened.

import Anthropic from '@anthropic-ai/sdk';
import type { CalendarFactory } from '../booking/calendar.ts';
import { whenLabel } from '../booking/clock.ts';
import type { ChatBody } from '../guard/input.ts';
import { MAX_TRANSCRIPT_CHARS, trimSession, type SessionState } from '../store/store.ts';
import { systemBlocks } from './prompt.ts';
import { bookingFallbackText, cutShortText, refusalText, requestFallbackText } from './texts.ts';
import { TOOLS, executeTool, type ToolContext, type TurnLog } from './tools.ts';

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

/** The one method of the SDK the agent uses, so tests can hand in a fake. */
export interface ModelClient {
  create(params: Params): Promise<Message>;
}

export interface TurnDeps {
  client: ModelClient;
  calendar: CalendarFactory;
}

export const MODEL = 'claude-opus-5-5';
export const MAX_TOOL_ROUNDS = 3;

/**
 * The model could not be used. `config` means the request itself is wrong
 * (bad key, rejected parameter) and retrying will not help; `transient`
 * means the service is unreachable or overloaded right now.
 */
export class ApiUnavailable extends Error {
  readonly kind: 'config' | 'transient';
  constructor(cause: unknown, kind: 'config' | 'transient') {
    super(`model API unavailable (${kind})`);
    this.cause = cause;
    this.kind = kind;
  }
}

export interface TurnResult {
  reply: string;
  /** Reference of a booking or request created during this turn. */
  ref?: string;
  rounds: number;
}

function textOf(message: Message): string {
  return message.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

function classify(err: unknown): ApiUnavailable | null {
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError ||
    err instanceof Anthropic.BadRequestError ||
    err instanceof Anthropic.NotFoundError
  ) {
    return new ApiUnavailable(err, 'config');
  }
  if (err instanceof Anthropic.APIError) return new ApiUnavailable(err, 'transient');
  return null;
}

/** What to tell the customer when the model is gone but a tool already did something. */
function fallbackText(turn: TurnLog, lang: ChatBody['lang']): string | null {
  if (turn.booking) return bookingFallbackText(lang, turn.booking.ref, whenLabel(turn.booking, lang));
  if (turn.request) return requestFallbackText(lang, turn.request.ref);
  return null;
}

/**
 * Runs one turn against `state`, which is mutated in place: bookings and
 * requests as the tools create them, the log and the transcript at the end.
 * The log is folded in even when the turn fails, so the board shows what
 * happened before the failure.
 */
export async function runTurn(body: ChatBody, state: SessionState, now: Date, deps: TurnDeps): Promise<TurnResult> {
  const turn: TurnLog = { events: [] };
  const ctx: ToolContext = { now, lang: body.lang, state, calendar: deps.calendar, turn };
  const messages: MessageParam[] = state.transcript.map((h) => ({ role: h.role, content: h.text }));
  messages.push({ role: 'user', content: body.message });

  const params: Params = {
    model: MODEL,
    // Adaptive thinking shares this budget with the answer; the model only
    // bills what it uses, so a roomy ceiling costs nothing extra.
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    // A safety classifier can decline a request (stop_reason "refusal").
    // Server-side fallback re-runs it on another model so an ordinary car
    // question is still answered.
    fallbacks: 'default',
    betas: ['server-side-fallback-2026-07-01'],
    system: systemBlocks(now, state, body.lang),
    tools: TOOLS,
    messages,
  };

  const call = async (p: Params): Promise<Message> => {
    try {
      return await deps.client.create(p);
    } catch (err) {
      throw classify(err) ?? err;
    }
  };

  const finish = (reply: string, rounds: number): TurnResult => {
    state.transcript.push(
      { role: 'user', text: body.message.slice(0, MAX_TRANSCRIPT_CHARS) },
      { role: 'assistant', text: reply.slice(0, MAX_TRANSCRIPT_CHARS) },
    );
    return { reply, ref: turn.booking?.ref ?? turn.request?.ref, rounds };
  };

  let rounds = 0;
  try {
    let message: Message;
    try {
      message = await call(params);
      while (message.stop_reason === 'tool_use' && rounds < MAX_TOOL_ROUNDS) {
        rounds++;
        const toolUses = message.content.filter(
          (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use',
        );
        if (toolUses.length === 0) break;
        // The assistant turn goes back exactly as received, thinking blocks included.
        messages.push({ role: 'assistant', content: message.content });
        const results: ToolResult[] = toolUses.map((t) => {
          const outcome = executeTool(t.name, t.input, ctx);
          return { type: 'tool_result', tool_use_id: t.id, content: outcome.text, is_error: outcome.refused };
        });
        messages.push({ role: 'user', content: results });
        message = await call(params);
      }
      if (message.stop_reason === 'tool_use') {
        // Round cap reached with the model still wanting tools: ask it to
        // close the turn in words instead of reporting an outage.
        message = await call({ ...params, tool_choice: { type: 'none' } });
      }
    } catch (err) {
      const fallback = fallbackText(turn, body.lang);
      if (!fallback) throw err;
      console.error('model call failed after progress, answering with the fixed text', err);
      return finish(fallback, rounds);
    }

    if (message.stop_reason === 'refusal') return finish(refusalText(body.lang), rounds);
    const text = textOf(message);
    if (text) {
      return finish(message.stop_reason === 'max_tokens' ? `${text}\n\n${cutShortText(body.lang)}` : text, rounds);
    }
    const fallback = fallbackText(turn, body.lang);
    if (fallback) return finish(fallback, rounds);
    throw new ApiUnavailable(new Error(`empty reply, stop_reason ${message.stop_reason ?? 'none'}`), 'transient');
  } finally {
    state.events.push(...turn.events);
    trimSession(state);
  }
}
