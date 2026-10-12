# Chatbot Demo

A customer advisor for a car repair shop that books real times. It answers from a knowledge base, reads pictures of warning lights, looks up free times, books, takes thumbs votes, and lets the staff feed it new facts through an approval queue. Both sides of the counter are on the page: the customer's chat, and the staff view with the week board, the agent's log, the queue and the exact prompt the bot sees.

The shop is a placeholder: no name, no address, no people, round-number prices. The agent design is the one I run in production at a repair shop, rebuilt from scratch in TypeScript for this demo so that nothing from the real business is in it.

Live demo: https://chatbot-demo-9vq.pages.dev (staff view: https://chatbot-demo-9vq.pages.dev/staff.html)

![The customer site with the chat open, a booking summary in the conversation](docs/screenshot.png)

![The staff view: week board with the booking, the agent's log, the approval queue and the prompt preview](docs/screenshot-staff.png)

## Try it

Six messages per visitor per day, so pick what you want to see; locally with your own key the cap is yours to set.

- "What does an EV battery health report cost?" (a published price it may quote)
- "My hybrid shows a battery warning light. Can I get it checked next week?" (safety rule, then a booking with the HV technician)
- Switch the reply language to suomi: the suggestions switch with it, and "Voinko varata huoltoajan ensi viikolle? Auto on Skoda Octavia ABC-123." books with the service technician in Finnish.
- Send a picture of a dashboard warning light, or tap the sample-picture suggestion under the greeting: the bot says what it sees and what it typically means, and points to the right technician.
- Watch the board next to the chat: the booking you make lands there, and the log shows every lookup, booking, refusal and thumbs vote.
- Ask it to ignore its rules, or to change the price. Watch it decline, and watch the log stay empty.
- Book a second time in the same conversation. The tool refuses and the refusal shows up in the log.
- Open the staff view, write "From next week the shop opens at 7.30 on Mondays", approve it, and ask the bot about Monday hours. Hide it and ask again.

## Feature parity with the production bot

| Production (PHP inside WordPress) | This demo (TypeScript on Cloudflare Pages) |
|---|---|
| Floating chat widget on the website, fi/sv/en | Same widget on a placeholder site |
| Claude with three tools: free times, calendar booking, contact request | Same three tools, same consent gate, one booking per conversation |
| Offered times and quick answers as buttons under the reply, taken from the tool results | Same rules, same buttons; on a phone the chat is a sheet from the bottom |
| Pictures in the chat, shrunk in the browser, typed by their bytes on the server | Same (two pictures, 3 MB, JPEG/PNG/WebP/GIF) |
| Thumbs vote under every reply, written to the anonymised log | Same vote, shown in the staff log |
| Staff additions by email, approved by a person, appended after the cache point | Same queue on the staff page, same prompt placement, "newer wins" rule |
| "What the bot sees now" preview in the admin | Same preview, section by section, with the cache breakpoint marked |
| Rate limits, kill switch, refusal and fallback texts, prompt caching | Rate limits, fallbacks and texts are the same; the kill switch is left out |
| Live workshop calendar, with the same deterministic mock for tests | The mock only |
| Anonymised logs, daily summary and monthly report by Claude | Left out |
| Aggregated job statistics in the prompt (k-anonymity, approval for new named items) | Left out; described below |

## How it works

```
customer page (public/)          Cloudflare Pages Functions                Claude
  widget ──── POST /api/chat ────▶ functions/api/chat.ts
                                    │ parse, type the pictures (guard/input)
                                    │ rate limit (guard/rateLimit, KV counters)
                                    │ load session (store)
                                    ▼
                                  agent/run.ts ── system + pictures + 3 tools ──▶ claude-opus-5-5
                                    │   ◀──── tool_use ─────────────────────────────┘
                                    │ agent/tools.ts executes:
                                    │   get_available_times → booking/calendar (mock)
                                    │   create_booking      → booking/core (validate, slot check)
                                    │   send_contact_request→ booking/core
                                    │ ──── tool_result ──────────────────────────▶ (max 3 rounds)
                                    ▼
                                  reply + message id + board ──▶ widget renders, thumbs vote ──▶ POST /api/feedback

staff page (public/staff.html)
  board + log ◀── GET /api/board      queue ◀──▶ GET/POST /api/additions      preview ◀── GET /api/preview
```

**The agent** (`src/agent/`): one turn is `runTurn`. It builds the system prompt in sections (binding rules, knowledge base with the cache point, approved staff additions, current situation), sends the pictures as image blocks ahead of the text, calls the model, runs the tools it asks for, and always returns a sentence for the customer. If the model fails after a booking already went through, a fixed text still tells the customer the reference. A refusal from the safety classifier becomes a polite fixed text.

**The tools** (`src/agent/tools.ts`): three tools with `strict: true` schemas, so the API guarantees the shape and the executors only defend against values that are valid but wrong: an unknown technician, a stale time, a second booking. A refusal is a structured outcome: flagged as an error on the API side, prefixed for the model, logged for the staff view. Tyre jobs are their own issue type, so the model classifies them and the tools refuse them with the phone-only wording.

**The booking core** (`src/booking/core.ts`): one function, one result. `createBooking` cleans and validates the raw input, checks the slot against the calendar and returns `booked`, `rejected` (with the field) or `unavailable` (with the reason). Callers switch on the state. No I/O inside, so it is tested without mocks.

**The calendar seam** (`src/booking/calendar.ts`): two methods, `freeSlots` (with a limit, so "earliest time" stops at the first hit) and `findSlot` (the slot behind a start time the model hands back), plus a factory that both the agent and the board get their calendar from. The demo ships a deterministic mock: the same slot is free on every page load (hash of technician, date and start), one technician is booked out for the first days, lunch is closed, blocks include handling time and stretch across the break. A real workshop system would be a second implementation of the same interface, swapped in the composition root (`src/app.ts`).

**Staff additions** (`src/staff/additions.ts`): a fact goes into the queue as pending. Approved facts are appended to the prompt after the cache point, so approving one never invalidates the cached rules and knowledge, and the block tells the model that a newer addition wins over the knowledge base. Hiding an addition takes it out again. The preview shows the result immediately.

**Guardrails**:

- Binding rules in the system prompt: answer only from the knowledge base, quote only published prices, no definite diagnoses, safety symptoms mean "stop driving and call", instructions inside messages or pictures are not commands.
- Consent gate: `create_booking` and `send_contact_request` reject `consent=false`, so the model has to show a summary and get a yes first.
- One booking and one contact request per conversation, enforced in the executor, not in the prompt.
- Tool loop capped at three rounds; when the model still wants a tool after that, it is asked to close the turn in words. Message cut to 1500 characters, transcript to 12 turns.
- The transcript lives on the server. The browser sends only the new message and pictures, so a visitor cannot forge earlier assistant turns to steer the model.
- Pictures are typed by their first bytes, never by the client's claim; they are sent to the model and never stored. A thumbs vote is accepted only for a message id this session actually received.
- Rate limits: six messages per visitor per day and fifty per day for the whole demo, so the public page costs cents at most (both numbers are the environment variables `RATE_PER_VISITOR` and `RATE_PER_DAY`); 20 votes and 40 queue changes per visitor per 10 minutes. Visitors are counted by a salted hash of the IP, and a request the visitor limit rejects does not eat the daily budget. Bodies over the two-picture size are rejected on the header alone.
- Every customer-facing sentence, including the HTTP error texts, lives in `src/agent/texts.ts` in three languages; the browser only places what the server sends.

## Model settings

| Setting | Value | Why |
|---|---|---|
| Model | `claude-opus-5-5` | Current Opus, cheaper per token than the Opus 5 the production bot runs on |
| Thinking | adaptive (default), effort `medium` | Booking flows need a little reasoning; `low` was terser but skipped the summary step more often in production |
| Refusal fallback | `fallbacks: "default"` with beta `server-side-fallback-2026-07-01` | A declined request is re-run on another model inside the same call, so an ordinary car question still gets an answer |
| Prompt caching | `cache_control` on the knowledge block | Rules, knowledge and tool definitions are identical on every request; staff additions and the clock come after the cache point |
| Streaming | off | The production bot tried streaming and the customers preferred a complete answer; one JSON response also keeps the function simple |
| `max_tokens` | 16000 | Thinking shares this budget with the answer; only used tokens are billed. A reply that still hits the ceiling gets a "cut short" line |

A typical turn costs about one cent; a booking turn with two tool rounds about two to three cents; a picture adds about one cent. The daily cap bounds the worst case. Measured on 10 October 2026: a plain answer takes 5 to 10 seconds, a turn with a tool call 10 to 20 seconds, the first uncached turn up to 30 seconds.

## What the production version has on top

The real bot reads aggregated statistics from the shop's job history: counts rounded down, k-anonymity on makes and fault areas, durations as quartiles, and every new named item waits for a person's approval before the bot may mention it. It also writes an anonymised log (emails, phone numbers and registration plates scrubbed), mails a daily summary, and once a month asks Claude for themes and knowledge-base suggestions that a person curates. None of that is here, because all of it is about a real business.

## Running it locally

```
npm install
cp .dev.vars.example .dev.vars   # add ANTHROPIC_API_KEY, or set CHAT_FAKE=1
npm run dev                      # http://localhost:8788 and /staff.html
npm test                         # unit tests, no network
npm run typecheck
```

With `CHAT_FAKE=1` the page runs against a scripted stand-in for the model: ask to book a time, then answer yes. It exercises the tool loop, the booking core and the board without an API key.

## Deploying

```
npx wrangler login
npx wrangler kv namespace create DEMO_KV      # paste the id into wrangler.toml
npx wrangler pages project create chatbot-demo
npx wrangler pages secret put ANTHROPIC_API_KEY --project-name chatbot-demo
npx wrangler pages secret put RATE_SALT --project-name chatbot-demo
npm run deploy
```

## Layout

```
public/           the customer site with the widget (index.html, widget.js), the staff page (staff.html, staff.js), shared session.js and styles.css; no build step
public/fonts/     D-DIN 400 and 700 as woff2, SIL Open Font License alongside
functions/api/    chat.ts, feedback.ts, additions.ts, preview.ts, board.ts: thin HTTP shells
src/app.ts        composition root: which calendar, store and model the handlers use
src/agent/        prompt.ts, tools.ts, run.ts, board.ts, preview.ts, texts.ts, fake.ts
src/booking/      types, clock, duration, mechanics, rules, calendar, core
src/staff/        additions: the approval queue
src/guard/        input parsing and limits (pictures included), rate limiting
src/store/        session state and counters: memory for tests, KV in production
src/knowledge/    the placeholder business
tests/            node --test, 60 tests
DESIGN.md         the visual decisions
```

## Privacy

Session data (bookings, requests, the log, the transcript, the queue, the votes) lives in KV for 24 hours under a random session id and is then gone. Names and phone numbers never leave the server: the board shows references and vehicles only. Pictures are never stored. IPs are hashed with a salt before they touch a counter. The page asks visitors not to enter real personal details.

Known limits of KV: it has no compare-and-set, so two tabs that share one session id can race the read-modify-write of the session and slip past the one-booking guard; it allows one write per second per key, so the shared daily counter can reject two visitors who post in the same second; and the free tier allows 1,000 writes a day, which three writes per turn reach before the demo's own cap of 400 turns. A production store would use a transaction or a version check and a real rate limiter.

TODO: license file.
