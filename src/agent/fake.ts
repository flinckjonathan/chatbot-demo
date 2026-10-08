// A scripted stand-in for the model. It lets the UI, the tool loop and the
// counter board be exercised without an API key or cost: ask to book and it
// looks up times; say yes and it books the first time it saw. Used by the
// tests and by local development with CHAT_FAKE=1.

import type Anthropic from '@anthropic-ai/sdk';
import type { ModelClient } from './run.ts';

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
type ContentBlock = Anthropic.Beta.Messages.BetaContentBlock;

function reply(content: ContentBlock[], stop: Message['stop_reason']): Message {
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

function text(t: string): Message {
  return reply([{ type: 'text', text: t, citations: null } as ContentBlock], 'end_turn');
}

function toolUse(name: string, input: Record<string, unknown>): Message {
  return reply([{ type: 'tool_use', id: `toolu_fake_${Date.now()}`, name, input } as ContentBlock], 'tool_use');
}

function lastUserText(params: Params): string {
  for (let i = params.messages.length - 1; i >= 0; i--) {
    const m = params.messages[i];
    if (!m || m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    const textBlock = m.content.find((b) => b.type === 'text');
    if (textBlock && 'text' in textBlock) return textBlock.text;
    return '';
  }
  return '';
}

function lastToolResult(params: Params): string | null {
  const last = params.messages[params.messages.length - 1];
  if (!last || last.role !== 'user' || typeof last.content === 'string') return null;
  const block = last.content.find((b) => b.type === 'tool_result');
  if (!block || block.type !== 'tool_result') return null;
  return typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
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

/** First "[ISO]" offered to the customer anywhere in the transcript, with its mechanic id. */
function offeredSlot(params: Params): { mechanicId: string; start: string } | null {
  for (const text of transcriptTexts(params)) {
    const line = text.split('\n').find((l) => /^[a-z]+ \(.*\[\d{4}-\d{2}-\d{2}T/.test(l));
    const iso = line?.match(/\[([^\]]+)\]/)?.[1];
    const mechanicId = line?.match(/^([a-z]+) \(/)?.[1];
    if (iso && mechanicId) return { mechanicId, start: iso };
  }
  return null;
}

export class FakeModel implements ModelClient {
  async create(params: Params): Promise<Message> {
    const result = lastToolResult(params);
    if (result !== null) {
      if (result.startsWith('Booking confirmed')) return text(`${result.split('. Tell')[0]}. This is the scripted fake model speaking.`);
      if (result.startsWith('Contact request sent')) return text(result.split('. Tell')[0] ?? result);
      if (result.startsWith('ERROR')) return text(`The tool refused: ${result.slice(7)}`);
      return text(`Here is what the calendar says:\n${result}\n\nAnswer "yes" to book the first time.`);
    }
    const asked = lastUserText(params);
    if (/\b(yes|kyllä|ja|joo)\b/i.test(asked)) {
      const slot = offeredSlot(params);
      if (slot) {
        return toolUse('create_booking', {
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
      return toolUse('get_available_times', { issue_type: 'service', powertrain: '', mechanic_id: '', duration_min: 0, from_date: '' });
    }
    return text('This is the scripted fake model, no API key is set. Ask to book a time to see the tools work, then answer yes to confirm.');
  }
}
