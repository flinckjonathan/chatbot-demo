// The fictional roster. One source for the booking rules, the system prompt
// and the counter board, so they cannot drift apart.

import type { IssueType, Mechanic, Powertrain } from './types.ts';

export const MECHANICS: readonly Mechanic[] = [
  {
    id: 'aino',
    name: 'Aino Rautio',
    title: 'EV and high-voltage battery technician',
    skills: ['ev_hybrid', 'diagnostics', 'repair'],
  },
  {
    id: 'petri',
    name: 'Petri Lehto',
    title: 'Service and inspection technician',
    skills: ['service', 'inspection', 'repair'],
  },
  {
    id: 'sami',
    name: 'Sami Kuusela',
    title: 'Diagnostics and air conditioning technician',
    skills: ['diagnostics', 'ac', 'repair', 'service', 'other'],
  },
];

export function mechanicById(id: string): Mechanic | undefined {
  return MECHANICS.find((m) => m.id === id);
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
