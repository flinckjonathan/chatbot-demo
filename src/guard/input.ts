// Shape and limits of what the browser may send: a session id, a language,
// one message and up to two pictures. The conversation history is not
// accepted from the client; it lives in the session store, so a visitor
// cannot forge earlier assistant turns. Pictures are typed by their bytes,
// never by what the client claims.

import { cleanText } from '../booking/rules.ts';
import { isLang, type Lang } from '../booking/types.ts';

export const MAX_MESSAGE_CHARS = 1500;
export const MAX_IMAGES = 2;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export interface ChatImage {
  mediaType: ImageType;
  /** Base64 without a data: prefix. */
  data: string;
}

export interface ChatBody {
  sessionId: string;
  lang: Lang;
  message: string;
  images: ChatImage[];
}

export const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

export function parseLang(v: unknown): Lang {
  return isLang(v) ? v : 'en';
}

export function parseSessionId(v: unknown): string {
  return typeof v === 'string' && SESSION_ID.test(v) ? v.toLowerCase() : '';
}

/** Reads the image type from the first bytes, the way a file(1) call would. */
export function sniffImageType(base64: string): ImageType | null {
  let raw: string;
  try {
    raw = atob(base64.slice(0, 48));
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  const has = (offset: number, values: readonly number[]): boolean =>
    bytes.length >= offset + values.length && values.every((v, i) => bytes[offset + i] === v);
  const ascii = (offset: number, text: string): boolean => has(offset, Array.from(text, (c) => c.charCodeAt(0)));

  if (has(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (has(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP') && (ascii(12, 'VP8 ') || ascii(12, 'VP8L') || ascii(12, 'VP8X'))) {
    return 'image/webp';
  }
  return null;
}

/** Accepts raw base64 strings or data URLs. Null when any picture is unusable. */
export function parseImages(v: unknown): ChatImage[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  if (v.length > MAX_IMAGES) return null;
  const out: ChatImage[] = [];
  for (const item of v) {
    if (typeof item !== 'string') return null;
    const data = item.startsWith('data:') ? item.slice(item.indexOf(',') + 1) : item;
    if (!data || data.length > MAX_BASE64_CHARS || !BASE64.test(data)) return null;
    if (data.length % 4 === 1) return null;
    const mediaType = sniffImageType(data);
    if (!mediaType) return null;
    out.push({ mediaType, data });
  }
  return out;
}

export type JsonReadResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'invalid' | 'too_large' };

/** Reads JSON without trusting content-length; stops as soon as the byte cap is exceeded. */
export async function readJsonLimited(request: Request, maxBytes: number): Promise<JsonReadResult> {
  const length = request.headers.get('content-length');
  if (length !== null) {
    const bytes = Number(length);
    if (!Number.isFinite(bytes) || bytes > maxBytes) return { ok: false, reason: 'too_large' };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, reason: 'invalid' };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body)) };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

export type ParseResult = { ok: true; body: ChatBody } | { ok: false; error: string };

export function parseChatBody(body: unknown): ParseResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be a JSON object' };
  const b = body as Record<string, unknown>;

  const sessionId = parseSessionId(b.session);
  if (!sessionId) return { ok: false, error: 'session must be a UUID' };

  const images = parseImages(b.images);
  if (!images) return { ok: false, error: `images must be at most ${MAX_IMAGES} JPEG, PNG, WebP or GIF pictures of at most 3 MB` };

  const message = cleanText(b.message, MAX_MESSAGE_CHARS);
  if (!message && images.length === 0) return { ok: false, error: 'message is empty' };

  return { ok: true, body: { sessionId, lang: parseLang(b.lang), message, images } };
}
