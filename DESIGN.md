# DESIGN.md

## Brief
Subject: a customer advisor agent for a placeholder car repair shop that books real times in a simulated calendar, with the staff side on its own page.
Audience: a hackathon reviewer or developer who opens the link, types one question or sends a picture, and wants to see what the agent actually did.
Page's single job: have a conversation in the chat that ends in a booking, and see the booking land on the board beside it.
Differentiator: the customer's chat and the shop's week board side by side, nothing hidden.

## Direction
Aesthetic: a job card. White paper, black ink, one steel blue for what matters. Hairlines instead of shadows.
Decided 12 October 2026 with the owner: white base, the steel blue of the owner's other apps, one typeface, no texture, no load animation.

Signature element: the booking that lands on the week board while the customer reads the confirmation.

## Colour
--bg:       #FFFFFF   page
--surface:  #FFFFFF   panels
--paper:    #F6F7F5   assistant bubbles, free slot chips, prompt preview
--ink:      #15171A   text, headings, the customer's bubbles
--muted:    #5B636C
--line:     #E2E4DF   hairlines
--steel:    #2E5C7E   links, buttons, the booked block, approved status, focus ring
--steel-50: #EDF3F8   the fake-model note and the landing pulse

Rule: steel blue is the only colour. It marks what can be pressed and what the agent did.

## Type
One family: D-DIN, self-hosted (SIL Open Font License), weights 400 and 700. Headings uppercase with 0.04em tracking; the sign at 40 to 72 px.
Times, references, day labels and the prompt preview use the system monospace stack. No web font requests.

Scale: 12 / 13 / 15 / 17 / 20 / 40 to 72 (sign only).

## Icons
One family, drawn inline: 24px strokes, width 2, round caps. Chat, close, camera, send, thumbs up, thumbs down. Nothing else.

## Voice
Three adjectives: plain, specific, unhurried.
Forbidden: em dash as punctuation, small-caps eyebrow labels, "X, not Y" sentences, invented names or numbers presented as real.

## Layout
Customer page (index.html): sign, then two columns on a wide screen. Left the chat, open from the start, with four things to try as buttons under the greeting (three questions and a sample warning-light picture). The times the bot offers and its "shall I book it" question come back as buttons under the reply, and a reply scrolls to its own top so a long answer is read from the start. Right the week board and the agent's log, which redraw from every reply. Under 1100 px the chat becomes a button in the corner that opens a 400 px panel, and under 620 px the panel is a sheet from the bottom, 85 % of the screen, with the page still visible above it (the same shape as the production widget); the board sits under the sign. Then how it works, then the footer with the placeholder hours and phone.
Staff page (staff.html): sign with the session line, two columns (week board and log, the approval queue), then the prompt preview full width. Stacks under 1100 px.

Explicitly not on these pages:
- no background texture or gradient
- no page-load animation
- no shadows except the floating chat on narrow screens
- no dark mode (one committed look)

## Motion budget
One landing pulse when a booking appears on the board (1.2 s). One blink on the "working" line. Nothing else animates. prefers-reduced-motion disables both.

## Stack
Static HTML, CSS and three JavaScript modules in public/. Cloudflare Pages Functions in TypeScript for the API. No build step for the UI.

## Learned rules
- Visible text follows the Finnish writing guide of the parent project: no em dashes, short sentences, headings first and explanations as plain sentences.
- Nothing invented may look real: the shop has no name, the mechanics have roles, the phone number is a placeholder and the page says so.
- A transform on an ancestor (even from a finished animation with fill-mode both) anchors position: fixed children to that ancestor. Animate opacity only, or fill backwards.
- Words (owner's decision 12 October 2026): the people who fix cars are mechanics, never technicians. No shop-counter metaphors in headings or copy ("behind the counter", "both sides of the counter"); say what the panel is, such as "Week board and log" or "Staff view".
