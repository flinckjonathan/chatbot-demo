// Fixed customer-facing texts the agent falls back to when the model cannot
// answer: refusals, API failures after a booking already went through, and
// rate limits. Written in plain sentences, no dashes as punctuation.

import type { Lang } from '../booking/types.ts';
import { WORKSHOP } from '../knowledge/workshop.ts';

type Texts = Record<Lang, string>;

function pick(t: Texts, lang: Lang): string {
  return t[lang] ?? t.en;
}

export function refusalText(lang: Lang): string {
  return pick(
    {
      fi: `Pahoittelut, en voi auttaa tässä aiheessa. Autan mielelläni autoihin ja huoltoon liittyvissä kysymyksissä, tai voit soittaa meille: ${WORKSHOP.phone} (${WORKSHOP.hours.fi}).`,
      sv: `Tyvärr kan jag inte hjälpa till med det här ämnet. Jag hjälper gärna med frågor om bilar och service, eller ring oss: ${WORKSHOP.phone} (${WORKSHOP.hours.sv}).`,
      en: `Sorry, I can't help with that topic. I'm happy to help with car and service questions, or you can call us at ${WORKSHOP.phone} (${WORKSHOP.hours.en}).`,
    },
    lang,
  );
}

/** The booking exists but the model did not produce a closing sentence. */
export function bookingFallbackText(lang: Lang, ref: string, when: string): string {
  return pick(
    {
      fi: `Varaus on tehty: ${when}, viite ${ref}. Muutokset ja peruutukset puhelimitse ${WORKSHOP.phone}.`,
      sv: `Bokningen är gjord: ${when}, referens ${ref}. Ändringar och avbokningar per telefon ${WORKSHOP.phone}.`,
      en: `Your booking is confirmed: ${when}, reference ${ref}. Changes and cancellations by phone ${WORKSHOP.phone}.`,
    },
    lang,
  );
}

/** The contact request exists but the model did not produce a closing sentence. */
export function requestFallbackText(lang: Lang, ref: string): string {
  return pick(
    {
      fi: `Yhteydenottopyyntösi on lähetetty, viite ${ref}. Huoltoaikaa ei ole vielä vahvistettu. Otamme sinuun yhteyttä. Kiireellisissä asioissa soita ${WORKSHOP.phone}.`,
      sv: `Din förfrågan har skickats, referens ${ref}. Servicetiden är inte bekräftad ännu. Vi kontaktar dig. I brådskande ärenden, ring ${WORKSHOP.phone}.`,
      en: `Your contact request has been sent, reference ${ref}. The service time is not confirmed yet. We will contact you. For urgent matters, call ${WORKSHOP.phone}.`,
    },
    lang,
  );
}

export function unavailableText(lang: Lang): string {
  return pick(
    {
      fi: `Neuvoja ei ole juuri nyt käytettävissä. Soita meille ${WORKSHOP.phone} (${WORKSHOP.hours.fi}).`,
      sv: `Rådgivaren är inte tillgänglig just nu. Ring oss ${WORKSHOP.phone} (${WORKSHOP.hours.sv}).`,
      en: `The advisor is not available right now. Call us at ${WORKSHOP.phone} (${WORKSHOP.hours.en}).`,
    },
    lang,
  );
}
