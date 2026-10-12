// The chat: docked next to the week board on a wide screen, a button in
// the corner on a phone. Pictures are shrunk in the browser before they
// leave it, every reply gets a thumbs vote, and the board on the right
// redraws from each reply. Every label and error sentence arrives
// ready-made from the server.

import { renderBoard } from './board.js';
import { api, el, getLang, getSession, setLang } from './session.js';

const MAX_PHOTOS = 2;
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;
const DOCKED = window.matchMedia('(min-width: 1100px)');

const GREETING = {
  en: "Hi! I'm the customer advisor of this workshop. Ask about our services, describe a problem with your car, send a picture of a warning light, or book a time with one of our technicians.",
  fi: 'Hei! Olen tämän korjaamon asiakasneuvoja. Kysy palveluistamme, kerro auton ongelmasta, lähetä kuva varoitusvalosta tai varaa aika asentajalle.',
  sv: 'Hej! Jag är verkstadens kundrådgivare. Fråga om våra tjänster, beskriv ett problem med bilen, skicka en bild på en varningslampa eller boka en tid hos en tekniker.',
};

/** Things to try, in the reply language. The last one sends the sample warning-light picture. */
const STARTERS = {
  en: [
    { text: 'What does an EV battery health report cost?' },
    { text: 'My hybrid shows a battery warning light. Can I get it checked next week?' },
    { text: 'Can I book a service for next week? The car is a Skoda Octavia, ABC-123.' },
    { text: 'This came on in my dashboard this morning. What does it mean?', sample: 'sample-warning.png', label: 'Send a sample warning-light picture' },
  ],
  fi: [
    { text: 'Paljonko sähköauton akun kuntoraportti maksaa?' },
    { text: 'Hybridissäni palaa akun varoitusvalo. Pääsenkö tarkastukseen ensi viikolla?' },
    { text: 'Voinko varata huoltoajan ensi viikolle? Auto on Skoda Octavia ABC-123.' },
    { text: 'Tämä syttyi kojelautaan tänä aamuna. Mitä se tarkoittaa?', sample: 'sample-warning.png', label: 'Lähetä esimerkkikuva varoitusvalosta' },
  ],
  sv: [
    { text: 'Vad kostar en hälsorapport för elbilens batteri?' },
    { text: 'Min hybrid visar en batterivarningslampa. Kan jag få den kontrollerad nästa vecka?' },
    { text: 'Kan jag boka en service nästa vecka? Bilen är en Skoda Octavia, ABC-123.' },
    { text: 'Den här tändes på instrumentpanelen i morse. Vad betyder den?', sample: 'sample-warning.png', label: 'Skicka en exempelbild på en varningslampa' },
  ],
};

const STATUS = {
  en: {
    typing: 'Writing',
    times: 'Looking up free times',
    book: 'Making the booking',
    thanks: 'Thanks for the feedback',
    notPicture: 'That file could not be read as a picture.',
    sampleFailed: 'The sample picture could not be loaded. Attach one of your own instead.',
    offline: 'No connection to the server.',
  },
  fi: {
    typing: 'Kirjoittaa',
    times: 'Haen vapaita aikoja',
    book: 'Teen varausta',
    thanks: 'Kiitos palautteesta',
    notPicture: 'Tiedostoa ei voitu lukea kuvana.',
    sampleFailed: 'Esimerkkikuvaa ei voitu ladata. Liitä oma kuva.',
    offline: 'Ei yhteyttä palvelimeen.',
  },
  sv: {
    typing: 'Skriver',
    times: 'Söker lediga tider',
    book: 'Gör bokningen',
    thanks: 'Tack för din respons',
    notPicture: 'Filen kunde inte läsas som en bild.',
    sampleFailed: 'Exempelbilden kunde inte laddas. Bifoga en egen bild.',
    offline: 'Ingen kontakt med servern.',
  },
};

const els = {
  fab: document.getElementById('chat-fab'),
  panel: document.getElementById('chat-panel'),
  close: document.getElementById('chat-close'),
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
  board: document.getElementById('board'),
  events: document.getElementById('events'),
  staffLinks: [document.getElementById('staff-link'), document.getElementById('staff-link-2')],
};

const session = getSession();
let busy = false;
let started = false;
let awaitingConfirm = false;
/** Pictures of the message being written: { dataUrl } */
let photos = [];
/** Counts board renders, so a slow board fetch cannot overwrite a newer board from a reply. */
let boardVersion = 0;

const lang = () => els.lang.value;
const t = (key) => (STATUS[lang()] || STATUS.en)[key];

/* ---- panel ---- */

/** Docked, the chat is a section of the page; undocked, it is a dialog the button opens. */
function applyDockSemantics() {
  if (DOCKED.matches) {
    els.panel.removeAttribute('role');
    els.panel.removeAttribute('aria-hidden');
  } else {
    els.panel.setAttribute('role', 'dialog');
    els.panel.setAttribute('aria-hidden', String(els.panel.hidden));
  }
}

function openPanel() {
  els.panel.hidden = false;
  els.fab.setAttribute('aria-expanded', 'true');
  document.body.classList.add('chat-open');
  applyDockSemantics();
  if (!started) {
    started = true;
    addLine('msg assistant', GREETING[lang()] || GREETING.en);
    // The things to try sit under the greeting until the first message.
    renderStarters();
    els.messages.appendChild(els.starters);
  }
  if (!DOCKED.matches) els.input.focus({ preventScroll: true });
}

function closePanel() {
  els.panel.hidden = true;
  els.fab.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('chat-open');
  applyDockSemantics();
  els.fab.focus({ preventScroll: true });
}

/* ---- messages ---- */

/** A reply scrolls to its own top, so a long answer is read from the start; everything else scrolls to the end. */
function addLine(className, text, scrollToTop = false) {
  const li = el('li', className, text);
  els.messages.appendChild(li);
  if (scrollToTop) els.messages.scrollTop += li.getBoundingClientRect().top - els.messages.getBoundingClientRect().top - 8;
  else els.messages.scrollTop = els.messages.scrollHeight;
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
  const li = addLine('msg assistant', text, true);
  if (!mid) return li;
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
  return li;
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
    const { ok } = await api('/api/feedback', { session, mid, vote });
    if (ok) loadBoard();
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

/* ---- things to try, in the reply language; gone after the first message ---- */

function renderStarters() {
  if (!els.starters.isConnected && started) return;
  els.starters.replaceChildren();
  for (const starter of STARTERS[lang()] || STARTERS.en) {
    const button = el('button', 'chip', starter.label || starter.text);
    button.type = 'button';
    button.dataset.text = starter.text;
    if (starter.sample) button.dataset.sample = starter.sample;
    els.starters.appendChild(button);
  }
}

/* ---- buttons under a reply: the offered times and the quick answers ---- */

let chipsEl = null;

function removeChips() {
  if (chipsEl) chipsEl.remove();
  chipsEl = null;
}

/** The server decides the buttons from what the tools did; the browser only places them under `reply`. */
function renderChips(chips, reply) {
  removeChips();
  awaitingConfirm = chips.some((c) => c.kind === 'confirm');
  if (chips.length === 0) return;
  chipsEl = el('li', 'chips');
  for (const chip of chips) {
    const button = el('button', chip.kind === 'time' ? 'chip time' : 'chip', chip.label);
    button.type = 'button';
    button.addEventListener('click', () => {
      els.input.value = chip.message;
      els.form.requestSubmit();
    });
    chipsEl.appendChild(button);
  }
  els.messages.appendChild(chipsEl);
  // Bring the buttons into view as far as the reply's first line stays visible.
  const m = els.messages;
  const replyTop = reply.getBoundingClientRect().top - m.getBoundingClientRect().top;
  m.scrollTop += Math.max(0, Math.min(replyTop - 8, m.scrollHeight - m.clientHeight - m.scrollTop));
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

/** Attaches what it can and returns how many pictures it added. */
async function addFiles(files) {
  let added = 0;
  for (const file of files) {
    if (photos.length >= MAX_PHOTOS) break;
    if (!file.type.startsWith('image/')) continue;
    try {
      photos.push({ dataUrl: await shrink(file) });
      added++;
    } catch {
      addLine('msg system', t('notPicture'));
    }
  }
  renderPhotos();
  return added;
}

/** The sample warning light: fetched from the site, then treated like any attached picture. */
async function useSample(path, text) {
  if (busy) return;
  try {
    const res = await fetch(path);
    const blob = await res.blob();
    if (!res.ok || !blob.type.startsWith('image/')) throw new Error(`sample ${res.status} ${blob.type}`);
    const added = await addFiles([new File([blob], 'warning-light.png', { type: blob.type })]);
    if (added === 0 || busy) return;
    els.input.value = text;
    els.form.requestSubmit();
  } catch {
    addLine('msg system', t('sampleFailed'));
  }
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
  els.input.style.height = '';
  els.starters.remove();
  removeChips();
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
      const reply = addReply(data.reply, data.mid);
      renderChips(Array.isArray(data.chips) ? data.chips : [], reply);
      boardVersion++;
      renderBoard(els.board, els.events, data.board, data.ref);
    } else {
      addLine('msg system', typeof data.text === 'string' ? data.text : t('offline'));
      // Lookups and refusals recorded before a failure are on the server already.
      loadBoard();
    }
  } catch {
    pending.remove();
    addLine('msg system', t('offline'));
    loadBoard();
  } finally {
    setBusy(false);
    els.input.focus({ preventScroll: true });
  }
}

/* ---- board ---- */

async function loadBoard() {
  const version = boardVersion;
  try {
    const { ok, data } = await api(`/api/board?session=${encodeURIComponent(session)}&lang=${lang()}`);
    if (!ok) return;
    els.fakeNote.hidden = !data.fake;
    // A reply rendered a newer board while this fetch was in flight: keep the newer one.
    if (version !== boardVersion) return;
    renderBoard(els.board, els.events, data.board, null);
  } catch {
    // The board is a view; the chat still works without it.
  }
}

/* ---- wiring ---- */

function init() {
  els.lang.value = getLang();
  els.lang.addEventListener('change', () => {
    setLang(els.lang.value);
    renderStarters();
    loadBoard();
  });
  for (const link of els.staffLinks) {
    if (link) link.href = `staff?session=${encodeURIComponent(session)}`;
  }

  els.fab.addEventListener('click', () => (els.panel.hidden ? openPanel() : closePanel()));
  document.getElementById('open-chat').addEventListener('click', openPanel);
  els.close.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.panel.hidden && !DOCKED.matches) closePanel();
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
    addFiles([...els.file.files]).then(() => els.input.focus({ preventScroll: true }));
    els.file.value = '';
  });
  els.starters.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    if (button.dataset.sample) {
      useSample(button.dataset.sample, button.dataset.text || '');
      return;
    }
    els.input.value = button.dataset.text;
    els.form.requestSubmit();
  });

  // Docked on a wide screen: the conversation is the page, so it starts open.
  applyDockSemantics();
  if (DOCKED.matches) openPanel();
  DOCKED.addEventListener('change', (e) => {
    if (e.matches && els.panel.hidden) openPanel();
    else if (!e.matches && !els.panel.hidden) closePanel();
    else applyDockSemantics();
  });
  loadBoard();
}

init();
