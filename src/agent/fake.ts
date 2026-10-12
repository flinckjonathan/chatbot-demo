// A scripted stand-in for the model. It lets the UI, the tool loop and the
// week board be exercised without an API key or cost: ask to book and it
// looks up times; say yes and it books the first time it saw. Used by the
// tests and by local development with CHAT_FAKE=1.

import type Anthropic from '@anthropic-ai/sdk';
import type { ModelClient } from './run.ts';

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
type ContentBlock = Anthropic.Beta.Messages.BetaContentBlock;

/** A response with only the fields the agent reads. Tests build theirs with these too. */
export function fakeMessage(content: ContentBlock[], stop: Message['stop_reason']): Message {
  const message = {
    id: `msg_fake_${Math.random().toString(36).slice(2, 10)}`,
    type: 'message',
    role: 'assistant',
    model: 'fake-model',
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  return message as unknown as Message;
}

export function fakeText(text: string, stop: Message['stop_reason'] = 'end_turn'): Message {
  return fakeMessage([{ type: 'text', text, citations: null } as ContentBlock], stop);
}

export function fakeToolUse(name: string, input: Record<string, unknown>, id = `toolu_fake_${Date.now()}`): Message {
  return fakeMessage([{ type: 'tool_use', id, name, input } as ContentBlock], 'tool_use');
}

function lastUserText(params: Params): string {
  for (let i = params.messages.length - 1; i >= 0; i--) {
    const m = params.messages[i];
    if (!m || m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    const textBlock = m.content.find((b) => b.type === 'text');
    return textBlock && 'text' in textBlock ? textBlock.text : '';
  }
  return '';
}

function lastToolResult(params: Params): { text: string; refused: boolean } | null {
  const last = params.messages[params.messages.length - 1];
  if (!last || last.role !== 'user' || typeof last.content === 'string') return null;
  const block = last.content.find((b) => b.type === 'tool_result');
  if (!block || block.type !== 'tool_result') return null;
  const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
  return { text, refused: block.is_error === true };
}

/** Every piece of plain text in the transcript: user turns, echoed replies and tool results. */
function transcriptTexts(params: Params): string[] {
  const out: string[] = [];
  for (const m of params.messages) {
    if (typeof m.content === 'string') {
      out.push(m.content);
      continue;
    }
    for (const b of m.content) {
      if (b.type === 'text') out.push(b.text);
      else if (b.type === 'tool_result' && typeof b.content === 'string') out.push(b.content);
    }
  }
  return out;
}

/** The "[ISO]" offered to the customer in the transcript, with its mechanic id: the one asked for, or the first. */
function offeredSlot(params: Params, iso: string | null = null): { mechanicId: string; start: string } | null {
  for (const text of transcriptTexts(params)) {
    const line = text
      .split('\n')
      .find((l) => /^[a-z]+ \(.*\[\d{4}-\d{2}-\d{2}T/.test(l) && (!iso || l.includes(`[${iso}]`)));
    const start = line?.match(/\[([^\]]+)\]/)?.[1];
    const mechanicId = line?.match(/^([a-z]+) \(/)?.[1];
    if (start && mechanicId) return { mechanicId, start };
  }
  return null;
}

/** The ISO value in brackets of the latest user turn that picked a time with a button, if any. */
function chosenIso(params: Params): string | null {
  for (let i = params.messages.length - 1; i >= 0; i--) {
    const m = params.messages[i];
    if (!m || m.role !== 'user' || typeof m.content !== 'string') continue;
    const iso = m.content.match(/\((\d{4}-\d{2}-\d{2}T[^)]+)\)/)?.[1];
    if (iso) return iso;
  }
  return null;
}

export class FakeModel implements ModelClient {
  async create(params: Params): Promise<Message> {
    if (params.tool_choice?.type === 'none') return fakeText('That is all I can do for now. This is the scripted fake model speaking.');
    const result = lastToolResult(params);
    if (result) {
      if (result.refused) return fakeText(`The tool refused: ${result.text.replace(/^ERROR: /, '')}`);
      if (result.text.startsWith('Booking confirmed')) return fakeText(`${result.text.split('. Tell')[0]}. This is the scripted fake model speaking.`);
      if (result.text.startsWith('Contact request sent')) return fakeText(result.text.split('. Tell')[0] ?? result.text);
      return fakeText(`Here is what the calendar says:\n${result.text}\n\nTap a time, or answer "yes" to book the first one.`);
    }
    const asked = lastUserText(params);
    const chosen = chosenIso(params);
    if (chosen && /\b(choose|valitsen|väljer)\b/i.test(asked)) {
      return fakeText(`Summary: Demo Customer, 040 123 4567, ABC-123, service at ${chosen}. Shall I book it?`);
    }
    if (/\b(yes|kyllä|ja|joo)\b/i.test(asked)) {
      const slot = offeredSlot(params, chosen);
      if (slot) {
        return fakeToolUse('create_booking', {
          name: 'Demo Customer',
          phone: '040 123 4567',
          email: '',
          rego: 'ABC-123',
          make_model: '',
          powertrain: '',
          issue_type: 'service',
          description: 'Annual service, scripted demo booking',
          mechanic_id: slot.mechanicId,
          start: slot.start,
          duration_min: 0,
          consent: true,
        });
      }
    }
    if (/\b(book|booking|varaa|varata|boka|aika|time)\b/i.test(asked)) {
      return fakeToolUse('get_available_times', { issue_type: 'service', powertrain: '', mechanic_id: '', duration_min: 0, from_date: '' });
    }
    return fakeText('This is the scripted fake model, no API key is set. Ask to book a time to see the tools work, then answer yes to confirm.');
  }
}
