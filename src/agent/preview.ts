// "What the bot sees right now": the exact prompt sections and the tool
// list for a session, for the staff page. Production has the same preview
// in the admin so staff can check an approved addition before customers
// meet it.

import type { Lang } from '../booking/types.ts';
import type { SessionState } from '../store/store.ts';
import { promptSections } from './prompt.ts';
import { TOOLS } from './tools.ts';

export interface PreviewSection {
  name: string;
  cached: boolean;
  chars: number;
  text: string;
}

export interface Preview {
  sections: PreviewSection[];
  tools: { name: string; description: string }[];
}

export function buildPreview(now: Date, state: SessionState, lang: Lang): Preview {
  return {
    sections: promptSections(now, state, lang).map((s) => ({ name: s.name, cached: s.cached === true, chars: s.text.length, text: s.text })),
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description ?? '' })),
  };
}
