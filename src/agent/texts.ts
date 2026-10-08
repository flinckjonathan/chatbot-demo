// Every fixed customer-facing sentence: refusals, fallbacks after a booking
// already went through, a reply that was cut short, and the HTTP error
// texts the browser shows. Plain sentences: what happened and what to do,
// no apologies, no dashes as punctuation.

import type { Lang } from '../booking/types.ts';
import { WORKSHOP } from '../knowledge/workshop.ts';

function callUs(lang: Lang): string {
  return `${WORKSHOP.phone} (${WORKSHOP.hours[lang]})`;
}

export function refusalText(lang: Lang): string {
  return {
    fi: `Tähän aiheeseen en voi vastata. Autan mielelläni autoihin ja huoltoon liittyvissä kysymyksissä, tai voit soittaa meille: ${callUs('fi')}.`,
    sv: `Det här ämnet kan jag inte svara på. Jag hjälper gärna med frågor om bilar och service, eller ring oss: ${callUs('sv')}.`,
    en: `I can't answer on that topic. I'm happy to help with car and service questions, or you can call us at ${callUs('en')}.`,
  }[lang];
}

/** The booking exists but the model did not produce a closing sentence. */
export function bookingFallbackText(lang: Lang, ref: string, when: string): string {
  return {
    fi: `Varaus on tehty: ${when}, viite ${ref}. Muutokset ja peruutukset puhelimitse ${WORKSHOP.phone}.`,
    sv: `Bokningen är gjord: ${when}, referens ${ref}. Ändringar och avbokningar per telefon ${WORKSHOP.phone}.`,
    en: `Your booking is confirmed: ${when}, reference ${ref}. Changes and cancellations by phone ${WORKSHOP.phone}.`,
  }[lang];
}

/** The contact request exists but the model did not produce a closing sentence. */
export function requestFallbackText(lang: Lang, ref: string): string {
  return {
    fi: `Yhteydenottopyyntösi on lähetetty, viite ${ref}. Huoltoaikaa ei ole vielä vahvistettu. Otamme sinuun yhteyttä. Kiireellisissä asioissa soita ${WORKSHOP.phone}.`,
    sv: `Din förfrågan har skickats, referens ${ref}. Servicetiden är inte bekräftad ännu. Vi kontaktar dig. I brådskande ärenden, ring ${WORKSHOP.phone}.`,
    en: `Your contact request has been sent, reference ${ref}. The service time is not confirmed yet. We will contact you. For urgent matters, call ${WORKSHOP.phone}.`,
  }[lang];
}

/** Appended when the reply hit the token ceiling mid-sentence. */
export function cutShortText(lang: Lang): string {
  return {
    fi: 'Vastaus katkesi kesken. Kysy tarkemmin, niin jatkan siitä.',
    sv: 'Svaret bröts av. Fråga mer specifikt så fortsätter jag därifrån.',
    en: 'The answer was cut short. Ask a narrower question and I will continue from there.',
  }[lang];
}

/** The model is unreachable (HTTP 502). */
export function unavailableText(lang: Lang): string {
  return {
    fi: `Neuvoja ei ole juuri nyt käytettävissä. Soita meille ${callUs('fi')}.`,
    sv: `Rådgivaren är inte tillgänglig just nu. Ring oss ${callUs('sv')}.`,
    en: `The advisor is not available right now. Call us at ${callUs('en')}.`,
  }[lang];
}

/** Too many messages (HTTP 429), per visitor or for the whole demo. */
export function rateLimitedText(lang: Lang, scope: 'visitor' | 'global'): string {
  if (scope === 'global') {
    return {
      fi: 'Demon päiväraja on täynnä. Tule takaisin huomenna.',
      sv: 'Demons dagsgräns är nådd. Kom tillbaka i morgon.',
      en: 'The demo has reached its daily limit. Come back tomorrow.',
    }[lang];
  }
  return {
    fi: 'Viestejä tuli juuri nyt liikaa. Odota muutama minuutti ja yritä uudelleen.',
    sv: 'För många meddelanden just nu. Vänta några minuter och försök igen.',
    en: 'Too many messages right now. Wait a few minutes and try again.',
  }[lang];
}

/** No API key on the server (HTTP 503). */
export function switchedOffText(lang: Lang): string {
  return {
    fi: 'Neuvoja on pois käytöstä: palvelimelle ei ole asetettu API-avainta.',
    sv: 'Rådgivaren är avstängd: ingen API-nyckel är inställd på servern.',
    en: 'The advisor is switched off: no API key is configured on the server.',
  }[lang];
}

/** The request could not be used (HTTP 400 or 413). */
export function invalidRequestText(lang: Lang): string {
  return {
    fi: 'Viestiä ei voitu lähettää. Lataa sivu uudelleen ja yritä lyhyemmällä viestillä.',
    sv: 'Meddelandet kunde inte skickas. Ladda om sidan och försök med ett kortare meddelande.',
    en: 'The message could not be sent. Reload the page and try a shorter message.',
  }[lang];
}

/** Something broke on the server (HTTP 500). */
export function serverErrorText(lang: Lang): string {
  return {
    fi: 'Palvelimella tapahtui virhe. Se on kirjattu lokiin.',
    sv: 'Ett fel uppstod på servern. Det har loggats.',
    en: 'Something went wrong on the server. The error has been logged.',
  }[lang];
}
