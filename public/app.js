// Customer side and counter side of one conversation. No framework: the
// page talks to /api/chat and /api/board and renders what comes back. All
// labels arrive ready-made from the server; the page only places them.

const SESSION_KEY = 'advisor-session';
const LANG_KEY = 'advisor-lang';
const EMPTY_LOG = 'Nothing yet. The log fills when the agent looks up times, books, or gets refused.';

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

/** Appends one line to the conversation: a message bubble or the working indicator. */
function addLine(className, text) {
  const li = el('li', className, text);
  els.messages.appendChild(li);
  els.messages.scrollTop = els.messages.scrollHeight;
  return li;
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
  addLine('msg user', text);
  const pending = addLine('pending', 'The advisor is working');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session, lang: els.lang.value, message: text }),
    });
    const data = await res.json().catch(() => ({}));
    pending.remove();
    if (res.ok && typeof data.reply === 'string') {
      addLine('msg assistant', data.reply);
      renderBoard(data.board, data.ref);
    } else {
      addLine('msg system', typeof data.text === 'string' ? data.text : 'No connection to the server.');
    }
  } catch {
    pending.remove();
    addLine('msg system', 'No connection to the server.');
  } finally {
    setBusy(false);
    // Keep the page where it is; the message list has its own scrolling.
    els.input.focus({ preventScroll: true });
  }
}

/** Draws the week board and the log. `landedRef` is the booking this turn created, if any. */
function renderBoard(board, landedRef) {
  if (!board) return;
  const cells = new Map(board.cells.map((c) => [`${c.mechanicId}|${c.date}`, c]));

  const thead = el('thead');
  const headRow = el('tr');
  headRow.appendChild(el('th', '', ''));
  for (const m of board.mechanics) {
    const th = el('th', '', m.name);
    th.appendChild(el('span', 'mech-title', m.title));
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  const tbody = el('tbody');
  for (const day of board.days) {
    const tr = el('tr');
    const th = el('th', '', day.label);
    th.scope = 'row';
    tr.appendChild(th);
    for (const m of board.mechanics) {
      const cell = cells.get(`${m.id}|${day.date}`);
      const td = el('td');
      if (cell) {
        for (const b of cell.booked) {
          const block = el('span', b.ref === landedRef ? 'block landed' : 'block', `${b.start}–${b.end} `);
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
  els.board.replaceChildren(thead, tbody);

  els.events.replaceChildren();
  if (!board.events.length) els.events.appendChild(el('li', 'empty', EMPTY_LOG));
  for (const e of board.events) {
    const li = el('li', e.kind);
    const time = el('time', '', e.time);
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
    renderBoard(data.board, null);
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
  addLine('msg assistant', GREETING[els.lang.value] || GREETING.en);
  loadBoard();
}

init();
