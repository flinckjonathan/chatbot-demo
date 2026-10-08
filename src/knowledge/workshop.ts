// The fictional workshop the agent speaks for. Everything the model may
// claim about the business is in this file and nowhere else. Korjaamo Lumme,
// its people, prices and phone number are invented for the demo. Opening
// hours of the calendar come from the booking constants, so the text and
// the calendar cannot disagree.

import { WINDOW_DAYS } from '../booking/calendar.ts';
import { clockLabel } from '../booking/clock.ts';
import { BREAKS, DAY_END, DAY_START } from '../booking/duration.ts';

export const WORKSHOP = {
  name: 'Korjaamo Lumme',
  street: 'Pajatie 8',
  city: '90400 Oulu',
  phone: '010 234 5678',
  phoneTel: '+358102345678',
  hours: { fi: 'ma–pe 7.30–16.30', sv: 'mån–fre 7.30–16.30', en: 'Mon–Fri 7.30–16.30' },
  web: 'korjaamolumme.example',
} as const;

const breaks = BREAKS.map((b) => `${clockLabel(b.start)}–${clockLabel(b.end)}`).join(', ');

/** Knowledge block of the system prompt. Stable text, so it is cached. */
export const KNOWLEDGE = `=== KORJAAMO LUMME: KNOWLEDGE BASE ===

BASICS
- Korjaamo Lumme, ${WORKSHOP.street}, ${WORKSHOP.city}. Independent multi-brand car repair shop, founded 1998.
- Phone ${WORKSHOP.phone}. Opening hours ${WORKSHOP.hours.en}. Closed on weekends.
- Three mechanics on the floor. Service desk answers the phone during opening hours.
- Website ${WORKSHOP.web}. Email is not published; use the phone or this chat.

SERVICES
- Scheduled maintenance for all makes according to the manufacturer's service programme, so the original warranty stays valid.
- Repairs: brakes, suspension, exhaust, timing belts, clutches, electrical faults, warning lights, diagnostics with manufacturer-level tools.
- Electric and hybrid cars: high-voltage battery diagnostics, battery health reports, battery module repair, charging faults, coolant systems for battery and drive unit. Aino Rautio is the high-voltage specialist.
- Inspection service: pre-inspection check and any repairs before the annual inspection, and taking the car to the inspection station on request.
- Air conditioning: service, leak search, compressor repair.
- Courtesy car for the duration of a service when requested at booking. Limited number, first come first served.
- Estimate before work: the customer gets a cost estimate before any work starts. If something unexpected comes up, the shop calls before continuing.

WHAT THE SHOP DOES NOT DO
- No bodywork, paint, rust repair or windscreen replacement. For windscreens the shop recommends a glass specialist.
- No motorcycles or heavy vehicles.
- Tyre changes and tyre storage are handled by the tyre desk and are booked by phone only, not through this chat.

PUBLISHED PRICES (the only prices the agent may quote)
- Seasonal tyre change: cars 45 €, vans and large SUVs 55 €. Booked by phone.
- Tyre hotel: 75 € per season, includes the change, washing and insured storage.
- EV battery health report: 149 €, includes a written report of state of health and cell balance.
- Everything else: estimate before work. The agent must not guess or estimate prices.

THE TEAM (mechanic ids in brackets are used by the booking tools)
- Aino Rautio [aino]: EV and high-voltage battery technician. Electric and hybrid cars, diagnostics, repairs. Bookable.
- Petri Lehto [petri]: service and inspection technician. Scheduled maintenance, inspection service, repairs. Bookable.
- Sami Kuusela [sami]: diagnostics and air conditioning technician. Fault finding, AC, repairs, maintenance, other jobs. Bookable.

BOOKING
- Bookings through this chat are real bookings in the shop calendar (in this demo, a simulated calendar).
- The shop takes bookings for the next ${WINDOW_DAYS} days on weekdays between ${clockLabel(DAY_START)} and ${clockLabel(DAY_END)}. Lunch break ${breaks}.
- A courtesy car is requested in the job description.
- Cancellations and changes: by phone ${WORKSHOP.phone} at the latest the day before.
`;
