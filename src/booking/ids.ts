// Short references the customer can read out on the phone. No ambiguous
// characters (0/O, 1/I/L).

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeRef(prefix: string, length = 5): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}-${out}`;
}
