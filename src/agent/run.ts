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
import type { Lang } from '../booking/types.ts';
import { CHIP_TEXTS, bookingFallbackText, cutShortText, pickTimeText, refusalText, requestFallbackText } from './texts.ts';
import { TOOLS, executeTool, type ToolContext, type TurnLog } from './tools.ts';

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
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

/** A button under the reply. Tapping it sends `message` as the customer's next turn. */
export interface Chip {
  label: string;
  message: string;
  kind: 'time' | 'confirm' | 'change' | 'more';
}

export interface TurnResult {
  reply: string;
  /** Message id the browser sends back with a thumbs vote. */
  mid: string;
  /** Reference of a booking or request created during this turn. */
  ref?: string;
  /** Buttons under the reply: the offered times, or confirm/change when the bot asked for a yes. */
  chips: Chip[];
  rounds: number;
}

/** The bot asks for a yes before booking: the fixed question the prompt asks for, and the forms the model falls into. */
const ASKS_CONFIRM = /(varaanko|vahvist\S*\s+varau|teenkö varauksen|haluatko,? että varaan|ska jag boka|bekräfta\S* bokning|shall i book|confirm (the )?booking)/i;

const MAX_TIME_CHIPS = 6;

/**
 * Buttons for the browser, the same rules as the production bot: nothing
 * once a booking or request exists; confirm and change when the bot asked
 * for a yes (a tool wanted consent, or the reply ends with the question);
 * otherwise the times the lookup tool showed, earliest first, plus "more".
 */
export function replyChips(turn: TurnLog, reply: string, lang: Lang): Chip[] {
  if (turn.booking || turn.request) return [];
  if (turn.askConsent || ASKS_CONFIRM.test(reply)) {
    return [
      { label: CHIP_TEXTS.confirm[lang], message: CHIP_TEXTS.confirm[lang], kind: 'confirm' },
      { label: CHIP_TEXTS.change[lang], message: CHIP_TEXTS.change[lang], kind: 'change' },
    ];
  }
  const offered = [...turn.offered].sort((a, b) => a.start.localeCompare(b.start)).slice(0, MAX_TIME_CHIPS);
  if (offered.length === 0) return [];
  const chips: Chip[] = offered.map((o) => ({ label: o.label, message: pickTimeText(lang, o.label, o.start), kind: 'time' }));
  chips.push({ label: CHIP_TEXTS.more[lang], message: CHIP_TEXTS.more[lang], kind: 'more' });
  return chips;
}

/** Eight hex characters, like the production log's message ids. */
export function messageId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
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

/** The new user turn: pictures first, then the text, as the API prefers. */
function userContent(body: ChatBody): string | ContentBlockParam[] {
  if (body.images.length === 0) return body.message;
  const blocks: ContentBlockParam[] = body.images.map((img) => ({
    type: 'image',
    source: { type: 'base64', media_type: img.mediaType, data: img.data },
  }));
  blocks.push({ type: 'text', text: body.message || '(the customer sent a picture without text)' });
  return blocks;
}

/** What the transcript keeps of the user turn: the text and a note that pictures were sent. */
function transcriptText(body: ChatBody): string {
  const note = body.images.length ? ` (sent ${body.images.length} picture${body.images.length > 1 ? 's' : ''})` : '';
  return `${body.message}${note}`.trim().slice(0, MAX_TRANSCRIPT_CHARS);
}

/**
 * Runs one turn against `state`, which is mutated in place: bookings and
 * requests as the tools create them, the log and the transcript at the end.
 * The log is folded in even when the turn fails, so the board shows what
 * happened before the failure. Pictures are sent to the model and never stored.
 */
export async function runTurn(body: ChatBody, state: SessionState, now: Date, deps: TurnDeps): Promise<TurnResult> {
  const turn: TurnLog = { events: [], offered: [] };
  const ctx: ToolContext = { now, lang: body.lang, state, calendar: deps.calendar, turn };
  const messages: MessageParam[] = state.transcript.map((h) => ({ role: h.role, content: h.text }));
  messages.push({ role: 'user', content: userContent(body) });

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
    const mid = messageId();
    state.transcript.push(
      { role: 'user', text: transcriptText(body) },
      { role: 'assistant', text: reply.slice(0, MAX_TRANSCRIPT_CHARS), mid },
    );
    return { reply, mid, ref: turn.booking?.ref ?? turn.request?.ref, chips: replyChips(turn, reply, body.lang), rounds };
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
