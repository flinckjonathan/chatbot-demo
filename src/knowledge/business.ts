// The fictional business the agent speaks for. Everything the model may
// claim about it is in this file and nowhere else. The shop has no name,
// no address and no people: every fact is a placeholder, and the text says
// so. Opening hours come from the booking constants, so the text and the
// calendar cannot disagree.

import { WINDOW_DAYS } from '../booking/calendar.ts';
import { clockLabel } from '../booking/clock.ts';
import { BREAKS, DAY_END, DAY_START } from '../booking/duration.ts';

const open = `${clockLabel(DAY_START)}–${clockLabel(DAY_END)}`;

export const BUSINESS = {
  /** Shown on the pages. */
  title: 'Chatbot Demo',
  /** How the bot refers to the shop in a sentence. */
  name: 'the workshop',
  /** Placeholder number; it goes nowhere. */
  phone: '010 123 4567',
  hours: { fi: `ma–pe ${open}`, sv: `mån–fre ${open}`, en: `Mon–Fri ${open}` },
} as const;

const breaks = BREAKS.map((b) => `${clockLabel(b.start)}–${clockLabel(b.end)}`).join(', ');

/** Knowledge block of the system prompt. Stable text, so it is cached. */
export const KNOWLEDGE = `=== KNOWLEDGE BASE ===
This is a demonstration. The workshop, its prices and its team are placeholders; treat them as the facts of the business you work for.

BASICS
- An independent car repair shop that services all makes, including electric and hybrid cars.
- Phone ${BUSINESS.phone}. Opening hours ${BUSINESS.hours.en}. Closed on weekends.
- The address and email are not published in this demo: for anything that needs them, give the phone number.
- Three mechanics on the floor. The service desk answers the phone during opening hours.

SERVICES
- Scheduled maintenance for all makes according to the manufacturer's service programme, so the original warranty stays valid.
- Repairs: brakes, suspension, exhaust, timing belts, clutches, electrical faults, warning lights, diagnostics with manufacturer-level tools.
- Electric and hybrid cars: high-voltage battery diagnostics, battery health reports, battery module repair, charging faults, coolant systems for battery and drive unit. The HV mechanic does this work.
- Inspection service: pre-inspection check and any repairs before the annual inspection, and taking the car to the inspection station on request.
- Air conditioning: service, leak search, compressor repair.
- Courtesy car for the duration of a service when requested at booking. Limited number, first come first served.
- Estimate before work: the customer gets a cost estimate before any work starts. If something unexpected comes up, the shop calls before continuing.

WHAT THE SHOP DOES NOT DO
- No bodywork, paint, rust repair or windscreen replacement. For windscreens the shop recommends a glass specialist.
- No motorcycles or heavy vehicles.
- Tyre changes and tyre storage are handled by the tyre desk and are booked by phone only, not through this chat.

PUBLISHED PRICES (placeholders, and the only prices the agent may quote)
- Seasonal tyre change: cars 50 €, vans and large SUVs 60 €. Booked by phone.
- Tyre hotel: 80 € per season, includes the change, washing and insured storage.
- EV battery health report: 150 €, includes a written report of state of health and cell balance.
- Everything else: estimate before work. The agent must not guess or estimate prices.

THE TEAM (ids in brackets are used by the booking tools)
- HV mechanic [hv]: electric and hybrid cars, high-voltage batteries, diagnostics, repairs. Bookable.
- Service mechanic [service]: scheduled maintenance, inspection service, repairs. Bookable.
- Diagnostics mechanic [diag]: fault finding, air conditioning, repairs, maintenance, other jobs. Bookable.

BOOKING
- Bookings through this chat are real bookings in the shop calendar (in this demo, a simulated calendar).
- The shop takes bookings for the next ${WINDOW_DAYS} days on weekdays between ${clockLabel(DAY_START)} and ${clockLabel(DAY_END)}. Lunch break ${breaks}.
- A courtesy car is requested in the job description.
- Cancellations and changes: by phone ${BUSINESS.phone} at the latest the day before.
`;
