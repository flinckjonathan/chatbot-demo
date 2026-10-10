// Shared by the customer page and the staff page: one session id per
// browser (so both pages see the same conversation), small DOM and fetch
// helpers. The id is random and means nothing outside this browser.

export const SESSION_KEY = 'advisor-session';
export const LANG_KEY = 'advisor-lang';

export function getSession() {
  const fromUrl = new URLSearchParams(location.search).get('session');
  const valid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
  try {
    if (valid(fromUrl)) {
      localStorage.setItem(SESSION_KEY, fromUrl.toLowerCase());
      return fromUrl.toLowerCase();
    }
    let id = localStorage.getItem(SESSION_KEY);
    if (!valid(id)) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return valid(fromUrl) ? fromUrl.toLowerCase() : crypto.randomUUID();
  }
}

export function newSession() {
  const id = crypto.randomUUID();
  try {
    localStorage.setItem(SESSION_KEY, id);
  } catch {
    // Storage blocked: the id lives in the URL from here on.
  }
  return id;
}

export function getLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'fi' || saved === 'sv' || saved === 'en') return saved;
  } catch {
    // Default below.
  }
  return 'en';
}

export function setLang(lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** POST JSON, GET when body is undefined. Returns { status, data }. */
export async function api(path, body) {
  const res = await fetch(path, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}
