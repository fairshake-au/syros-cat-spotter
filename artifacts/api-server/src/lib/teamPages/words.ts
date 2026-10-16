import { escapeHtml } from "./escape";
import { tr, type StringKey } from "./strings";

// The words on the Colonies and Feeding sites pages (SYC-209).
//
// They live in the dashboard's three-language catalogue (./strings, SYC-53
// PR 1.0) since SYC-209 PR 4.1, because a cat guardian reads these pages in
// her own language. The team reads them in English (spec Decision 9): the
// routes pass "en" for anyone island-wide (`pageLangFor`, lib/guardianView.ts).
// Greek and French still fall back to English until Johnny signs them off
// (LIVE_LANGUAGES, SYC-283).
//
// Everything here is fixed text written by us, never a person's input, so a
// page may draw it as it is. Names and notes that people typed are not words:
// they go through escapeHtml where they are drawn.

export type WordKey = StringKey;

/** The words for a key, in `lang` (English when it is left out or not live). */
export function t(key: WordKey, lang?: string | null, vars?: Record<string, string>): string {
  return tr(lang ?? "en", key, vars);
}

/** A page's word helpers in one language: `t` as text, `w` escaped for HTML. */
export interface Words {
  lang: string;
  t: (key: WordKey, vars?: Record<string, string>) => string;
  w: (key: WordKey, vars?: Record<string, string>) => string;
}

export function wordsIn(lang?: string | null): Words {
  const l = lang ?? "en";
  return {
    lang: l,
    t: (key, vars) => t(key, l, vars),
    w: (key, vars) => escapeHtml(t(key, l, vars)),
  };
}
