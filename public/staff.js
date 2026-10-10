// The staff page: the week board and the log, the approval queue for staff
// additions, and the prompt preview. Everything is per session; the page
// reloads its data after every action instead of guessing.

import { api, el, getLang, getSession, newSession } from './session.js';

const EMPTY_LOG = 'Nothing yet. The log fills when the agent looks up times, books, gets refused, or a customer votes on a reply.';

const els = {
  sessionId: document.getElementById('session-id'),
  newSession: document.getElementById('new-session'),
  refresh: document.getElementById('refresh'),
  siteLink: document.getElementById('site-link'),
  board: document.getElementById('board'),
  events: document.getElementById('events'),
  form: document.getElementById('addition-form'),
  text: document.getElementById('addition-text'),
  error: document.getElementById('addition-error'),
  additions: document.getElementById('additions'),
  preview: document.getElementById('preview'),
};

let session = getSession();
const lang = getLang();

/* ---- board and log ---- */

function renderBoard(board) {
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
          const block = el('span', 'block', `${b.start}–${b.end} `);
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

/* ---- additions ---- */

const STATUS_LABEL = { pending: 'Waiting for approval', approved: 'Approved, the bot sees it', hidden: 'Hidden from the bot' };

function renderAdditions(additions) {
  els.additions.replaceChildren();
  if (!additions.length) {
    els.additions.appendChild(el('li', 'empty', 'No additions yet. Write one above, then approve it and ask the bot about it.'));
    return;
  }
  for (const a of [...additions].reverse()) {
    const li = el('li', `addition ${a.status}`);
    li.appendChild(el('p', 'addition-text', a.text));
    const meta = el('div', 'addition-meta');
    meta.appendChild(el('span', 'addition-status', STATUS_LABEL[a.status] || a.status));
    const actions = el('span', 'addition-actions');
    if (a.status !== 'approved') actions.appendChild(actionButton('Approve', () => setStatus(a.id, 'approved')));
    if (a.status === 'approved') actions.appendChild(actionButton('Hide', () => setStatus(a.id, 'hidden')));
    actions.appendChild(actionButton('Delete', () => remove(a.id)));
    meta.appendChild(actions);
    li.appendChild(meta);
    els.additions.appendChild(li);
  }
}

function actionButton(label, onClick) {
  const b = el('button', 'linkish', label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

async function mutate(body) {
  els.error.hidden = true;
  const { ok, data } = await api('/api/additions', { session, ...body });
  if (!ok) {
    els.error.textContent = data.error || (data.code === 'rate' ? 'Too many changes right now. Wait a few minutes.' : 'That did not work.');
    els.error.hidden = false;
    return;
  }
  renderAdditions(data.additions);
  loadPreview();
}

const setStatus = (id, status) => mutate({ action: 'status', id, status });
const remove = (id) => mutate({ action: 'delete', id });

async function onAdd(event) {
  event.preventDefault();
  const text = els.text.value.trim();
  if (!text) return;
  await mutate({ action: 'add', text });
  if (els.error.hidden) els.text.value = '';
}

/* ---- preview ---- */

function renderPreview(preview) {
  els.preview.replaceChildren();
  for (const s of preview.sections) {
    const details = el('details', 'preview-section');
    const summary = el('summary');
    summary.appendChild(el('span', 'preview-name', s.name));
    summary.appendChild(el('span', 'preview-meta', `${s.chars.toLocaleString('en')} characters${s.cached ? ', cache breakpoint here' : ''}`));
    details.appendChild(summary);
    details.appendChild(el('pre', 'preview-text', s.text));
    els.preview.appendChild(details);
  }
  const tools = el('details', 'preview-section');
  const summary = el('summary');
  summary.appendChild(el('span', 'preview-name', 'Tools'));
  summary.appendChild(el('span', 'preview-meta', `${preview.tools.length} tools with strict schemas`));
  tools.appendChild(summary);
  const list = el('ul', 'preview-tools');
  for (const t of preview.tools) {
    const li = el('li');
    li.appendChild(el('code', '', t.name));
    li.appendChild(el('span', '', ` ${t.description}`));
    list.appendChild(li);
  }
  tools.appendChild(list);
  els.preview.appendChild(tools);
}

/* ---- loading ---- */

async function loadBoard() {
  const { ok, data } = await api(`/api/board?session=${encodeURIComponent(session)}&lang=${lang}`);
  if (ok) renderBoard(data.board);
}

async function loadAdditions() {
  const { ok, data } = await api(`/api/additions?session=${encodeURIComponent(session)}`);
  if (ok) renderAdditions(data.additions);
}

async function loadPreview() {
  const { ok, data } = await api(`/api/preview?session=${encodeURIComponent(session)}&lang=${lang}`);
  if (ok) renderPreview(data);
}

function loadAll() {
  els.sessionId.textContent = session.slice(0, 8);
  els.siteLink.href = `./?session=${encodeURIComponent(session)}`;
  Promise.all([loadBoard(), loadAdditions(), loadPreview()]).catch(() => {
    els.error.textContent = 'No connection to the server.';
    els.error.hidden = false;
  });
}

function init() {
  els.form.addEventListener('submit', onAdd);
  els.refresh.addEventListener('click', loadAll);
  els.newSession.addEventListener('click', () => {
    session = newSession();
    history.replaceState(null, '', `staff?session=${encodeURIComponent(session)}`);
    loadAll();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadAll();
  });
  loadAll();
}

init();
