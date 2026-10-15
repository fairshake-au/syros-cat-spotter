import { en, type StringKey } from "./en";
import { el } from "./el";
import { fr } from "./fr";

// The dashboard's three-language catalogue (SYC-53 PR 1.0; roles-and-invites
// §13). English is the source of truth; Greek and French are typed against
// its keys, so a missing key fails the build, not the page.

export type Language = "en" | "el" | "fr";
export type { StringKey };

export const CATALOGUE: Record<Language, Record<StringKey, string>> = {
  en,
  el,
  fr,
};

/**
 * The languages a real person is actually served. Greek and French exist and
 * pass the parity test, but switch on only after Johnny signs them off
 * (Linear SYC-283, target 30 Oct); switching is SYC-291, a one-line change
 * here. Until then every page and email silently falls back to English.
 */
export const LIVE_LANGUAGES: readonly Language[] = ["en"];

/** The language a page is actually drawn in: the one asked for if it is live, else English. */
export function pageLanguage(
  requested: string | null | undefined,
  live: readonly Language[] = LIVE_LANGUAGES,
): Language {
  return (live as readonly string[]).includes(requested ?? "")
    ? (requested as Language)
    : "en";
}

/**
 * A string in the person's language. Always goes through the live-language
 * fallback, so a page can never show Greek before Greek is live. `{name}`
 * style placeholders are filled from `vars` (values are inserted as they are:
 * escape them where the page is drawn).
 */
export function tr(
  requested: string | null | undefined,
  key: StringKey,
  vars?: Record<string, string>,
  live: readonly Language[] = LIVE_LANGUAGES,
): string {
  const text = CATALOGUE[pageLanguage(requested, live)][key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name]! : whole,
  );
}

const LOCALES: Record<Language, string> = {
  en: "en-GB",
  el: "el-GR",
  fr: "fr-FR",
};
const ATHENS = "Europe/Athens";

/**
 * Dates in the person's language and Athens time. Only guardian-facing pages
 * use these; the team pages keep their own English formatters (Decision 10).
 * Goes through the same live-language fallback as `tr`.
 */
export function formatDate(
  requested: string | null | undefined,
  at: Date,
  live: readonly Language[] = LIVE_LANGUAGES,
): string {
  return new Intl.DateTimeFormat(LOCALES[pageLanguage(requested, live)], {
    timeZone: ATHENS,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(at);
}

export function formatDateTime(
  requested: string | null | undefined,
  at: Date,
  live: readonly Language[] = LIVE_LANGUAGES,
): string {
  return new Intl.DateTimeFormat(LOCALES[pageLanguage(requested, live)], {
    timeZone: ATHENS,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}
