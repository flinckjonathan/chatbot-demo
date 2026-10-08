// Field rules shared by the booking core and the contact request. One
// place, so the model's tool errors and the validation never disagree.

export const RULES = {
  phone: /^[+0-9][0-9\s\-().]{4,29}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  descriptionMin: 10,
  max: {
    name: 100,
    phone: 30,
    email: 100,
    rego: 12,
    makeModel: 80,
    description: 3000,
    timing: 300,
    mechanicId: 20,
  },
} as const;

/**
 * Trims, collapses whitespace, strips control characters, cuts to `max`.
 * The cut happens before the regexes run, so a huge input costs a slice,
 * not three scans; the slack leaves room for whitespace that collapses.
 */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v
    .slice(0, max * 4)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/** Registration plates are stored upper case; "abc-123" and "ABC-123" are the same car. */
export function cleanRego(v: unknown): string {
  return cleanText(v, RULES.max.rego).toUpperCase();
}

export function validPhone(s: string): boolean {
  return RULES.phone.test(s);
}

export function validEmail(s: string): boolean {
  return RULES.email.test(s);
}
