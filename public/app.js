// Customer side and counter side of one conversation. No framework: the
// page talks to /api/chat and /api/board and renders what comes back.

const SESSION_KEY = 'advisor-session';
const LANG_KEY = 'advisor-lang';
const MAX_HISTORY = 12;

const GREETING = {
  en: "Hi! I'm the customer advisor at Korjaamo Lumme. Ask about our services, describe a problem with your car, or book a time with one of our mechanics.",
  fi: 'Hei! Olen Korjaamo Lumpeen asiakasneuvoja. Kysy palveluistamme, kerro auton ongelmasta tai varaa aika asentajalle.',
  sv: 'Hej! Jag är kundrådgivaren på Korjaamo Lumme. Fråga om våra tjänster, beskriv ett problem med bilen eller boka en tid hos en mekaniker.',
};

const els = {
  messages: document.getElementById('messages'),
  form: document.getElementById('form'),
  input: document.getElementById('input'),
  send: document.getElementById('send'),
  lang: document.getElementById('lang'),
  board: document.getElementById('board'),
  events: document.getElementById('events'),
  starters: document.getElementById('starters'),
  fakeNote: document.getElementById('fake-note'),
};

const session = getSession();
const history = [];
let busy = false;

function getSession() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function addMessage(role, text) {
  const li = el('li', `msg ${role}`, text);
  els.messages.appendChild(li);
  els.messages.scrollTop = els.messages.scrollHeight;
  return li;
}

function addPending() {
  const li = el('li', 'pending', 'The advisor is working');
  els.messages.appendChild(li);
  els.messages.scrollTop = els.messages.scrollHeight;
  return li;
}

function errorText(status, data) {
  if (status === 429 && data && data.scope === 'global') return 'The demo has reached its daily limit. Come back tomorrow.';
  if (status === 429) return 'Too many messages right now. Wait a few minutes and try again.';
  if (status === 503) return 'The advisor is switched off: no API key is configured on the server.';
  if (status === 502) return 'The advisor is not available right now. In a real shop this is where the phone number would be: 010 234 5678.';
  if (status === 400) return 'The message could not be sent.';
  return 'No connection to the server.';
}

function setBusy(on) {
  busy = on;
  els.send.disabled = on;
  els.input.disabled = on;
}

async function onSubmit(event) {
  event.preventDefault();
  if (busy) return;
  const text = els.input.value.trim();
  if (!text) return;

  setBusy(true);
  els.input.value = '';
  els.starters.hidden = true;
  addMessage('user', text);
  const pending = addPending();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session, lang: els.lang.value, message: text, history: history.slice(-MAX_HISTORY) }),
    });
    const data = await res.json().catch(() => ({}));
    pending.remove();
    if (res.ok && typeof data.reply === 'string') {
      history.push({ role: 'user', text }, { role: 'assistant', text: data.reply });
      addMessage('assistant', data.reply);
      renderBoard(data.board, data.events || []);
    } else {
      addMessage('system', errorText(res.status, data));
    }
  } catch {
    pending.remove();
    addMessage('system', errorText(0));
  } finally {
    setBusy(false);
    els.input.focus();
  }
}

function clockLabel(iso) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Helsinki', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .format(new Date(iso))
      .replace(':', '.');
  } catch {
    return '';
  }
}

function renderBoard(board, newEvents) {
  if (!board) return;
  const landed = new Set();
  for (const e of newEvents) {
    const ref = e.kind === 'booking' && /Reference (B-[A-Z0-9]+)/.exec(e.text);
    if (ref) landed.add(ref[1]);
  }

  const table = els.board;
  table.replaceChildren();
  const thead = el('thead');
  const headRow = el('tr');
  headRow.appendChild(el('th', '', ''));
  for (const m of board.mechanics) {
    const th = el('th', '', m.name);
    th.appendChild(el('span', 'mech-title', m.title));
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const day of board.days) {
    const tr = el('tr');
    const th = el('th', '', day.label);
    th.scope = 'row';
    tr.appendChild(th);
    for (const m of board.mechanics) {
      const cell = board.cells.find((c) => c.mechanicId === m.id && c.date === day.date);
      const td = el('td');
      if (cell) {
        for (const b of cell.booked) {
          const block = el('span', landed.has(b.ref) ? 'block landed' : 'block', `${b.start}–${b.end} `);
          block.appendChild(el('span', 'ref', b.ref));
          block.appendChild(el('small', '', b.label));
          td.appendChild(block);
        }
        if (cell.free.length) {
          const chips = el('div', 'chips');
          for (const t of cell.free) chips.appendChild(el('span', 'free', t));
          td.appendChild(chips);
        } else if (!cell.booked.length) {
          td.appendChild(el('span', 'none', 'full'));
        }
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  els.events.replaceChildren();
  if (!board.events.length) {
    els.events.appendChild(el('li', 'empty', 'Nothing yet. The log fills when the agent looks up times, books, or gets refused.'));
  }
  for (const e of board.events) {
    const li = el('li', e.kind);
    const time = el('time', '', clockLabel(e.at));
    time.dateTime = e.at;
    li.appendChild(time);
    li.appendChild(el('span', 'text', e.text));
    els.events.appendChild(li);
  }
  els.events.scrollTop = els.events.scrollHeight;
}

async function loadBoard() {
  try {
    const res = await fetch(`/api/board?session=${encodeURIComponent(session)}&lang=${encodeURIComponent(els.lang.value)}`);
    if (!res.ok) return;
    const data = await res.json();
    els.fakeNote.hidden = !data.fake;
    renderBoard(data.board, []);
  } catch {
    // The board is a view, the chat still works without it.
  }
}

function init() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && GREETING[saved]) els.lang.value = saved;
  } catch {
    // Private mode or blocked storage: the default language is fine.
  }
  els.lang.addEventListener('change', () => {
    try {
      localStorage.setItem(LANG_KEY, els.lang.value);
    } catch {
      // Same as above.
    }
    loadBoard();
  });
  els.form.addEventListener('submit', onSubmit);
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      els.form.requestSubmit();
    }
  });
  els.starters.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-text]');
    if (!button) return;
    els.input.value = button.dataset.text;
    els.form.requestSubmit();
  });
  addMessage('assistant', GREETING[els.lang.value] || GREETING.en);
  loadBoard();
}

init();
