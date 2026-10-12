// Renders the week board and the agent log. Shared by the customer page,
// where the board sits next to the chat, and the staff page. Every label
// arrives ready-made from the server; this file only places them.

import { el } from './session.js';

export const EMPTY_LOG = 'Nothing yet. The log fills when the agent looks up times, books, gets refused, or a customer votes on a reply.';

/** Draws the board into `table` and the log into `list`. `landedRef` is the booking this turn created, if any. */
export function renderBoard(table, list, board, landedRef) {
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
    const tr = el('tr', day.later ? 'later' : '');
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
  table.replaceChildren(thead, tbody);

  list.replaceChildren();
  if (!board.events.length) list.appendChild(el('li', 'empty', EMPTY_LOG));
  for (const e of board.events) {
    const li = el('li', e.kind);
    const time = el('time', '', e.time);
    time.dateTime = e.at;
    li.appendChild(time);
    li.appendChild(el('span', 'text', e.text));
    list.appendChild(li);
  }
  list.scrollTop = list.scrollHeight;
}
