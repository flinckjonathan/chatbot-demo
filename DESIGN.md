# DESIGN.md

## Brief
Subject: a customer advisor agent for a placeholder car repair shop that books real times in a simulated calendar, with the staff side on its own page.
Audience: a hackathon reviewer or developer who opens the link, types one question or sends a picture, and wants to see what the agent actually did.
Page's single job: have a conversation in the widget that ends in a booking, then open the staff view and see the booking land and the prompt change after an approval.
Differentiator: both sides of the counter, nothing hidden.

## Direction
Aesthetic: workshop paperwork. Concrete floor, white job cards, one hi-vis accent.
Not a dark terminal, not cream and terracotta.

Signature element: the week board behind the counter that shows the booking the chat just made.

## Colour
--bg:          #E8EAE6   concrete
--surface:     #FFFFFF   job card
--ink:         #15181B
--muted:       #5B636C
--line:        #C9CDC7
--free:        #EEF1EC   free slot chip, prompt preview background
--accent:      #E8590C   hi-vis orange: chat button, send, booked block, approved status, focus ring
--accent-soft: #FBE3D6   only the fake-model note

Rule: the accent appears at most three times per viewport.

## Type
Display: Big Shoulders Display, weight 900, uppercase, tracking 0.02em. Sign, panel titles, technician roles.
Body:    Atkinson Hyperlegible, weight 400 and 700, line-height 1.5.
Mono:    IBM Plex Mono, weights 400 and 600. Times, references, day labels, log timestamps, the prompt preview.

Scale: 12 / 13 / 16 / 18 / 22 / 48 to 96 (sign only).

## Icons
One family, drawn inline: 24px strokes, width 2, round caps. Chat, close, camera, send, thumbs up, thumbs down. Nothing else.

## Voice
Three adjectives: plain, specific, unhurried.
Forbidden: em dash as punctuation, small-caps eyebrow labels, "X, not Y" sentences, invented names or numbers presented as real.

## Layout
Customer page (index.html): sign, then two columns on a wide screen. Left the chat, open from the start, with four things to try (three questions and a sample warning-light picture). Right the week board and the agent's log, which redraw from every reply, so a booking lands on the board while the customer reads the confirmation. Under 1100 px the chat becomes a button in the corner that opens a 400 px panel, and under 620 px the panel fills the screen; the board sits under the sign. Then how it works, then the footer with the placeholder hours and phone.
Staff page (staff.html): sign with the session line, two columns (week board and log, the approval queue), then the prompt preview full width. Stacks under 1100 px.

Explicitly not on these pages:
- no centred hero with a badge above the headline
- no icon grid
- no dark mode (one committed look)

## Motion budget
One page-load stagger (sign, main, how: 12 px rise, 0.6 s, 80 ms apart).
The chat panel and each message rise 0.3 s when they appear.
One blink on the "working" line. Nothing else animates. prefers-reduced-motion disables all of it.

## Stack
Static HTML, CSS and three JavaScript modules in public/. Cloudflare Pages Functions in TypeScript for the API. No build step for the UI.

## Learned rules
- Visible text follows the Finnish writing guide of the parent project: no em dashes, short sentences, headings first and explanations as plain sentences.
- Nothing invented may look real: the shop has no name, the technicians have roles, the phone number is a placeholder and the page says so.
