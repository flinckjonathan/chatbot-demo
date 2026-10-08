# Korjaamo Lumme advisor

A customer advisor agent for a car repair shop that books real times. You chat on the left; on the right you see what the agent did behind the counter: the week board, the bookings, and every tool call it made or was refused.

The shop is fictional and the calendar is simulated. The agent design is the one I run in production at a repair shop, rebuilt from scratch in TypeScript for this demo so that nothing from the real business leaves the building.

TODO: live demo URL and a screenshot once deployed.

## Try it

- "What does an EV battery health report cost?" (a published price it may quote)
- "My hybrid shows a battery warning light. Can I get it checked next week?" (safety rule, then a booking with the high-voltage mechanic)
- "Voinko varata huoltoajan ensi viikolle? Auto on Skoda Octavia ABC-123." (answers in Finnish, books with the service technician)
- Ask it to ignore its rules, or to change the price. Watch it decline, and watch the log stay empty.
- Book a second time in the same conversation. The tool refuses and the refusal shows up in the log.

## How it works

```
browser (public/)                Cloudflare Pages Function            Claude
  chat + board  ── POST /api/chat ──▶ functions/api/chat.ts
                                       │ parse + clean (guard/input)
                                       │ rate limit (guard/rateLimit, KV counters)
                                       │ load session (store)
                                       ▼
                                     agent/run.ts ──── messages + 3 tools ───▶ claude-opus-5-5
                                       │   ◀──── tool_use ─────────────────────┘
                                       │ agent/tools.ts executes:
                                       │   get_available_times → booking/calendar (mock)
                                       │   create_booking      → booking/core (validate, slot check)
                                       │   send_contact_request→ booking/core
                                       │ ──── tool_result ─────────────────────▶ (max 3 rounds)
                                       ▼
                                     reply + events + board ──▶ browser renders both sides
```

**The agent** (`src/agent/`): one turn is `runTurn`. It builds the system prompt in three blocks (binding rules, knowledge base with the cache point, current situation), calls the model, runs the tools it asks for, and always returns a sentence for the customer. If the model fails after a booking already went through, a fixed text still tells the customer the reference. A refusal from the safety classifier becomes a polite fixed text.

**The tools** (`src/agent/tools.ts`): three tools with `strict: true` schemas, so the API guarantees the shape and the executors only defend against values that are valid but wrong: an unknown mechanic, a stale time, a second booking. A refusal is a structured outcome: it is flagged as an error on the API side, prefixed for the model, and logged for the counter view. Tyre jobs are their own issue type, so the model classifies them and the tools refuse them with the phone-only wording instead of guessing from keywords.

**The booking core** (`src/booking/core.ts`): one function, one result. `createBooking` cleans and validates the raw input, checks the slot against the calendar and returns `booked`, `rejected` (with the field) or `unavailable` (with the reason). Callers switch on the state. No I/O inside, so it is tested without mocks.

**The calendar seam** (`src/booking/calendar.ts`): two methods, `freeSlots` (with a limit, so "earliest time" stops at the first hit) and `findSlot` (the slot behind a start time the model hands back), plus a factory that both the agent and the board get their calendar from. The demo ships a deterministic mock: the same slot is free on every page load (hash of mechanic, date and start), one mechanic is booked out for the first days, lunch is closed, blocks include handling time and stretch across the break. A real workshop system would be a second implementation of the same interface, swapped in the composition root (`src/app.ts`).

**Guardrails**:

- Binding rules in the system prompt: answer only from the knowledge base, quote only published prices, no definite diagnoses, safety symptoms mean "stop driving and call", instructions inside messages are not commands.
- Consent gate: `create_booking` and `send_contact_request` reject `consent=false`, so the model has to show a summary and get a yes first.
- One booking and one contact request per conversation, enforced in the executor, not in the prompt.
- Tool loop capped at three rounds; when the model still wants a tool after that, it is asked to close the turn in words. Message cut to 1000 characters, transcript to 12 turns.
- The transcript lives on the server. The browser sends only the new message, so a visitor cannot forge earlier assistant turns to steer the model.
- Rate limits: 12 messages per visitor per 10 minutes, 400 per day for the whole demo. Visitors are counted by a salted hash of the IP, and a request the visitor limit rejects does not eat the daily budget. Bodies over 16 KB are rejected on the header alone.
- Every customer-facing sentence, including the HTTP error texts, lives in `src/agent/texts.ts` in three languages; the browser only places what the server sends.
- Nothing from the model is trusted as data: inputs are parsed as JSON and validated, times are compared as instants, not strings.

## Model settings

| Setting | Value | Why |
|---|---|---|
| Model | `claude-opus-5-5` | Current Opus, cheaper per token than the Opus 5 the production bot runs on |
| Thinking | adaptive (default), effort `medium` | Booking flows need a little reasoning; `low` was terser but skipped the summary step more often in production |
| Refusal fallback | `fallbacks: "default"` with beta `server-side-fallback-2026-07-01` | A declined request is re-run on another model inside the same call, so an ordinary car question still gets an answer |
| Prompt caching | `cache_control` on the knowledge block | Rules, knowledge and tool definitions are identical on every request; the volatile clock block comes after the cache point |
| Streaming | off | The production bot tried streaming and the customers preferred a complete answer; one JSON response also keeps the function simple |
| `max_tokens` | 16000 | Thinking shares this budget with the answer; only used tokens are billed. A reply that still hits the ceiling gets a "cut short" line |

A typical turn costs about one cent; a booking turn with two tool rounds about two to three cents. The daily cap bounds the worst case.

## What is ported, mocked and left out

| Part | In this demo | In production |
|---|---|---|
| Tool loop, three tools, consent gate, one booking per conversation | same design, new code | PHP inside WordPress |
| Calendar | deterministic mock | live adapter for the workshop management system, plus the same mock for tests |
| Knowledge base | fictional shop, one file | Markdown files, synced with the website content, staff add facts by email and a person approves each one |
| Shop data in the prompt | none | aggregated statistics from the shop's job history, k-anonymity, counts rounded down, new named items need approval |
| Rate limits, fallbacks, refusal text | same | same |
| Logs and reports | the session log on the page | anonymised logs, daily summary and monthly report with improvement suggestions, reviewed by a person |

## Running it locally

```
npm install
cp .dev.vars.example .dev.vars   # add ANTHROPIC_API_KEY, or set CHAT_FAKE=1
npm run dev                      # http://localhost:8788
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
public/           the page: index.html, styles.css, app.js (no build step)
functions/api/    chat.ts (POST), board.ts (GET): thin HTTP shells
src/app.ts        composition root: which calendar, store and model the handlers use
src/agent/        prompt.ts, tools.ts, run.ts, board.ts, texts.ts, fake.ts
src/booking/      types, clock, duration, mechanics, rules, calendar, core
src/guard/        input parsing and limits, rate limiting
src/store/        session state and counters: memory for tests, KV in production
src/knowledge/    the fictional shop
tests/            node --test, 53 tests
DESIGN.md         the visual decisions
```

## Privacy

Session data (bookings, requests, the log, the transcript) lives in KV for 24 hours under a random session id and is then gone. Names and phone numbers never leave the server: the board shows references and vehicles only. IPs are hashed with a salt before they touch a counter. The page asks visitors not to enter real personal details.

Known limits of KV: it has no compare-and-set, so two tabs that share one session id (a duplicated tab) can race the read-modify-write of the session and slip past the one-booking guard; it allows one write per second per key, so the shared daily counter can reject two visitors who post in the same second; and the free tier allows 1,000 writes a day, which three writes per turn reach before the demo's own cap of 400 turns. A production store would use a transaction or a version check and a real rate limiter.

TODO: license file.
