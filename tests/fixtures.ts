// Shared test inputs. Tuesday 13 October 2026, 10.00 workshop time.

import { mockCalendarFactory } from '../src/booking/calendar.ts';
import { fromLocal } from '../src/booking/clock.ts';
import type { RawInput } from '../src/booking/core.ts';
import type { ChatBody } from '../src/guard/input.ts';

export const NOW = fromLocal('2026-10-13', 10 * 60);
export const SESSION = '123e4567-e89b-42d3-a456-426614174000';

/** A complete, confirmed create_booking input; override what the test is about. */
export function bookingInput(overrides: RawInput = {}): RawInput {
  return {
    name: 'Test Person',
    phone: '0401234567',
    email: '',
    rego: 'ABC-123',
    make_model: '',
    powertrain: '',
    issue_type: 'service',
    description: 'Annual service, please',
    mechanic_id: 'service',
    start: '',
    duration_min: 0,
    consent: true,
    ...overrides,
  };
}

/** The first free start of a mechanic in the week after NOW. */
export function firstStart(mechanicId: string, workMin: number): string {
  const slot = mockCalendarFactory(NOW, []).freeSlots(mechanicId, workMin, '2026-10-14', '2026-10-20', 1)[0];
  if (!slot) throw new Error(`no free slot for ${mechanicId}`);
  return slot.start;
}

export function chatBody(message: string, overrides: Partial<ChatBody> = {}): ChatBody {
  return { sessionId: SESSION, lang: 'en', message, images: [], ...overrides };
}

/** A 1x1 JPEG, base64. */
export const TINY_JPEG =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

/** A 1x1 PNG, base64. */
export const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
