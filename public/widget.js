// The chat widget: a button in the corner, a panel with the conversation,
// pictures shrunk in the browser before they leave it, a thumbs vote under
// every reply. The page talks to /api/chat and /api/feedback; every label
// and every error sentence arrives ready-made from the server.

import { api, el, getLang, getSession, setLang } from './session.js';

const MAX_PHOTOS = 2;
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

const GREETING = {
  en: "Hi! I'm the customer advisor of this workshop. Ask about our services, describe a problem with your car, send a picture of a warning light, or book a time with one of our technicians.",
  fi: 'Hei! Olen tämän korjaamon asiakasneuvoja. Kysy palveluistamme, kerro auton ongelmasta, lähetä kuva varoitusvalosta tai varaa aika asentajalle.',
  sv: 'Hej! Jag är verkstadens kundrådgivare. Fråga om våra tjänster, beskriv ett problem med bilen, skicka en bild på en varningslampa eller boka en tid hos en tekniker.',
};

const STATUS = {
  en: { typing: 'Writing', times: 'Looking up free times', book: 'Making the booking', thanks: 'Thanks for the feedback' },
  fi: { typing: 'Kirjoittaa', times: 'Haen vapaita aikoja', book: 'Teen varausta', thanks: 'Kiitos palautteesta' },
  sv: { typing: 'Skriver', times: 'Söker lediga tider', book: 'Gör bokningen', thanks: 'Tack för din respons' },
};

const els = {
  fab: document.getElementById('chat-fab'),
  panel: document.getElementById('chat-panel'),
  close: document.getElementById('chat-close'),
  open: document.getElementById('open-chat'),
  messages: document.getElementById('messages'),
  form: document.getElementById('form'),
  input: document.getElementById('input'),
  send: document.getElementById('send'),
  attach: document.getElementById('attach'),
  file: document.getElementById('file'),
  photos: document.getElementById('photos'),
  lang: document.getElementById('lang'),
  starters: document.getElementById('starters'),
  fakeNote: document.getElementById('fake-note'),
  staffLink: document.getElementById('staff-link'),
};

const session = getSession();
let busy = false;
let started = false;
let awaitingConfirm = false;
/** Pictures of the message being written: { dataUrl } */
let photos = [];

const lang = () => els.lang.value;
const t = (key) => (STATUS[lang()] || STATUS.en)[key];

/* ---- panel ---- */

function openPanel() {
  els.panel.hidden = false;
  els.panel.setAttribute('aria-hidden', 'false');
  els.fab.setAttribute('aria-expanded', 'true');
  document.body.classList.add('chat-open');
  if (!started) {
    started = true;
    addLine('msg assistant', GREETING[lang()] || GREETING.en);
    checkMode();
  }
  els.input.focus({ preventScroll: true });
}

function closePanel() {
  els.panel.hidden = true;
  els.panel.setAttribute('aria-hidden', 'true');
  els.fab.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('chat-open');
  els.fab.focus({ preventScroll: true });
}

async function checkMode() {
  try {
    const { ok, data } = await api(`/api/board?session=${encodeURIComponent(session)}&lang=${lang()}`);
    if (ok) els.fakeNote.hidden = !data.fake;
  } catch {
    // Mode note is cosmetic.
  }
}

/* ---- messages ---- */

function addLine(className, text) {
  const li = el('li', className, text);
  els.messages.appendChild(li);
  els.messages.scrollTop = els.messages.scrollHeight;
  return li;
}

function addUserLine(text, pictures) {
  const li = el('li', 'msg user');
  if (pictures.length) {
    const row = el('div', 'msg-pictures');
    for (const p of pictures) {
      const img = el('img');
      img.src = p.dataUrl;
      img.alt = 'Picture sent to the advisor';
      row.appendChild(img);
    }
    li.appendChild(row);
  }
  if (text) li.appendChild(el('span', '', text));
  els.messages.appendChild(li);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function addReply(text, mid) {
  const li = addLine('msg assistant', text);
  if (!mid) return;
  const fb = el('div', 'feedback');
  for (const [vote, label, path] of [
    ['up', 'Helpful', 'M7 11v9H4v-9zm3 9h7.5a2 2 0 0 0 2-1.6l1.2-6A2 2 0 0 0 18.7 10H14V5.5A1.5 1.5 0 0 0 12.5 4L10 11z'],
    ['down', 'Not helpful', 'M17 13V4h3v9zm-3-9H6.5a2 2 0 0 0-2 1.6l-1.2 6A2 2 0 0 0 5.3 14H10v4.5a1.5 1.5 0 0 0 1.5 1.5L14 13z'],
  ]) {
    const button = el('button', 'feedback-btn');
    button.type = 'button';
    button.dataset.vote = vote;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
    button.addEventListener('click', () => sendVote(fb, mid, vote));
    fb.appendChild(button);
  }
  li.appendChild(fb);
}

async function sendVote(fb, mid, vote) {
  if (fb.classList.contains('done')) return;
  fb.classList.add('done');
  for (const b of fb.querySelectorAll('button')) {
    b.disabled = true;
    b.classList.toggle('selected', b.dataset.vote === vote);
  }
  fb.appendChild(el('span', 'feedback-thanks', t('thanks')));
  try {
    await api('/api/feedback', { session, mid, vote });
  } catch {
    // A lost vote is not worth an error in the conversation.
  }
}

function typingStatus(text) {
  const s = (text || '').toLowerCase();
  if (awaitingConfirm && /^(kyllä|joo|ja\b|yes|ok)/.test(s)) return t('book');
  if (/aik(a|oja|aa)|vapaa|milloin|pääs|varaa|boka|tid|book|time|slot|next week|ensi viikko/.test(s)) return t('times');
  return t('typing');
}

/* ---- pictures ---- */

function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('not an image'));
    };
    img.src = url;
  });
}

/** Shrinks a picture to MAX_EDGE on its long side and re-encodes it as JPEG. */
async function shrink(file) {
  const img = await readImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

function renderPhotos() {
  els.photos.replaceChildren();
  els.photos.hidden = photos.length === 0;
  photos.forEach((p, index) => {
    const li = el('li');
    const img = el('img');
    img.src = p.dataUrl;
    img.alt = `Picture ${index + 1}`;
    li.appendChild(img);
    const remove = el('button', 'photo-remove', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove picture ${index + 1}`);
    remove.addEventListener('click', () => {
      photos.splice(index, 1);
      renderPhotos();
    });
    li.appendChild(remove);
    els.photos.appendChild(li);
  });
}

async function addFiles(files) {
  for (const file of files) {
    if (photos.length >= MAX_PHOTOS) break;
    if (!file.type.startsWith('image/')) continue;
    try {
      photos.push({ dataUrl: await shrink(file) });
    } catch {
      addLine('msg system', 'That file could not be read as a picture.');
    }
  }
  renderPhotos();
  els.input.focus({ preventScroll: true });
}

/* ---- sending ---- */

function setBusy(on) {
  busy = on;
  els.send.disabled = on;
  els.attach.disabled = on;
  els.input.disabled = on;
}

async function onSubmit(event) {
  event.preventDefault();
  if (busy) return;
  const text = els.input.value.trim();
  if (!text && photos.length === 0) return;

  const pictures = photos;
  photos = [];
  renderPhotos();
  setBusy(true);
  els.input.value = '';
  els.starters.hidden = true;
  addUserLine(text, pictures);
  const pending = addLine('pending', typingStatus(text));

  try {
    const { ok, data } = await api('/api/chat', {
      session,
      lang: lang(),
      message: text,
      images: pictures.map((p) => p.dataUrl),
    });
    pending.remove();
    if (ok && typeof data.reply === 'string') {
      addReply(data.reply, data.mid);
      awaitingConfirm = /\?\s*$/.test(data.reply) && /(varaa|boka|book|confirm|vahvist|bekräft)/i.test(data.reply);
    } else {
      addLine('msg system', typeof data.text === 'string' ? data.text : 'No connection to the server.');
    }
  } catch {
    pending.remove();
    addLine('msg system', 'No connection to the server.');
  } finally {
    setBusy(false);
    els.input.focus({ preventScroll: true });
  }
}

/* ---- wiring ---- */

function init() {
  els.lang.value = getLang();
  els.lang.addEventListener('change', () => setLang(els.lang.value));
  els.staffLink.href = `staff?session=${encodeURIComponent(session)}`;

  els.fab.addEventListener('click', () => (els.panel.hidden ? openPanel() : closePanel()));
  els.open.addEventListener('click', openPanel);
  els.close.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.panel.hidden) closePanel();
  });

  els.form.addEventListener('submit', onSubmit);
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      els.form.requestSubmit();
    }
  });
  els.input.addEventListener('input', () => {
    els.input.style.height = 'auto';
    els.input.style.height = `${Math.min(els.input.scrollHeight, 120)}px`;
  });
  els.attach.addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', () => {
    addFiles([...els.file.files]);
    els.file.value = '';
  });
  els.starters.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    if (button.dataset.picture) {
      els.file.click();
      return;
    }
    els.input.value = button.dataset.text;
    els.form.requestSubmit();
  });
}

init();
