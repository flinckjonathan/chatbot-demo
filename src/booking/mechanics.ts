// The roster: three roles, no people. One source for the booking rules, the
// system prompt and the counter board, so they cannot drift apart.

import type { IssueType, Mechanic, Powertrain } from './types.ts';

export const MECHANICS: readonly Mechanic[] = [
  {
    id: 'hv',
    name: 'HV technician',
    title: 'Electric and hybrid cars, high-voltage batteries',
    skills: ['ev_hybrid', 'diagnostics', 'repair'],
  },
  {
    id: 'service',
    name: 'Service technician',
    title: 'Scheduled maintenance, inspection service, repairs',
    skills: ['service', 'inspection', 'repair'],
  },
  {
    id: 'diag',
    name: 'Diagnostics technician',
    title: 'Fault finding, air conditioning, repairs',
    skills: ['diagnostics', 'ac', 'repair', 'service', 'other'],
  },
];

export function mechanicById(id: string): Mechanic | undefined {
  return MECHANICS.find((m) => m.id === id);
}

/** Display name, or the id itself when the roster changed under a stored booking. */
export function mechanicName(id: string): string {
  return mechanicById(id)?.name ?? id;
}

/** Issue types that need high-voltage training when the car is electric. */
const HV_SENSITIVE: readonly IssueType[] = ['repair', 'diagnostics', 'ev_hybrid'];

export function suitableMechanics(issue: IssueType, powertrain: Powertrain = ''): Mechanic[] {
  const electric = powertrain === 'ev' || powertrain === 'hybrid';
  return MECHANICS.filter((m) => {
    if (!m.skills.includes(issue)) return false;
    if (electric && HV_SENSITIVE.includes(issue)) return m.skills.includes('ev_hybrid');
    return true;
  });
}
