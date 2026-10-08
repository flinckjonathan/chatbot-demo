# DESIGN.md

## Brief
Subject: a customer advisor agent for a fictional car repair shop (Korjaamo Lumme) that books real times in a simulated calendar.
Audience: a hackathon reviewer or developer who opens the link, types one question and wants to see what the agent actually did.
Page's single job: have a conversation that ends in a booking, and see the booking land behind the counter.
Differentiator: both sides of the counter on one page, nothing hidden.

## Direction
Aesthetic: workshop paperwork. Concrete floor, white job cards, one hi-vis accent.
Not a dark terminal, not cream and terracotta.

Signature element: the week board behind the counter that updates live when the agent books.

## Colour
--bg:          #E8EAE6   concrete
--surface:     #FFFFFF   job card
--ink:         #15181B
--muted:       #5B636C
--line:        #C9CDC7
--free:        #EEF1EC   free slot chip
--accent:      #E8590C   hi-vis orange: send button, booked block, focus ring
--accent-soft: #FBE3D6   only inside the landing pulse

Rule: the accent appears at most three times per viewport (send, focus, booked blocks).

## Type
Display: Big Shoulders Display, weight 900, uppercase, tracking 0.02em. Sign, panel titles, mechanic names.
Body:    Atkinson Hyperlegible, weight 400 and 700, line-height 1.5.
Mono:    IBM Plex Mono, weights 400 and 600. Times, references, day labels, log timestamps only.

Scale: 12 / 13 / 16 / 18 / 22 / 48 to 96 (sign only).

## Voice
Three adjectives: plain, specific, unhurried.
Forbidden: em dash as punctuation, small-caps eyebrow labels, "X, not Y" sentences, invented numbers.

## Layout
Sections in order:
1. Sign: shop name, one sentence of what this is, two links.
2. Counter: customer side (chat) left, behind the counter (board + log) right. Stacks under 900 px.
3. How it works: three short paragraphs.
4. Footer: provenance and fiction notice.

Explicitly not on this site:
- no centred hero with a badge above the headline
- no icon grid
- no dark mode (one committed look)

## Motion budget
One page-load stagger (sign, chat, desk, how: 12 px rise, 0.6 s, 80 ms apart).
One landing pulse when a booking appears on the board (1.2 s).
One blink on the "advisor is working" line.
Message bubbles rise 0.3 s. Nothing else animates. prefers-reduced-motion disables all of it.

## Stack
Static HTML, CSS and one JavaScript module in public/. Cloudflare Pages Functions in TypeScript for the API. No build step for the UI.

## Learned rules
- Visible text follows the Finnish writing guide of the parent project: no em dashes, short sentences, headings first and explanations as plain sentences.
