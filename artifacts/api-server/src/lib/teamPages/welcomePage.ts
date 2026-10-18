import { renderPage } from "./layout";
import { escapeHtml } from "./escape";
import { LIVE_LANGUAGES, pageLanguage, tr, type Language, type StringKey } from "./strings";
import { clip, roleSentence } from "../people/words";

// SYC-53 PR 1.1: the accept page (roles-and-invites.md §4.1 step 4; plan
// review M5; spec §12.2 and §14 cases 9, 10, 14). In her language once it is
// live (English until then). It says who invited her and for what, what she
// will be able to see and do, the THREE promises word for word, a request to
// keep a lock on her phone and the plain statement that a phone never
// opened again keeps its saved list until the browser clears it. Those two
// are statements, not promises, and nothing here is about keeping places
// private (§13.4, §14.1). A name field, pre-filled and editable, and two
// buttons: Yes, join and No, this isn't for me.

/** The version of the promises a person accepts, recorded with `accepted` (§11.1). */
export const PROMISES_VERSION = "promises-v1";

/** The promises, in order. Exactly three (T29d). */
export const PROMISE_KEYS = ["welcome.promise1", "welcome.promise2", "welcome.promise3"] as const satisfies readonly StringKey[];

/** The text beside the promises that the spec requires, which is not a promise. */
export const STATEMENT_KEYS = ["welcome.lock", "welcome.neverReopened"] as const satisfies readonly StringKey[];

/** The longest name the field takes (the database's own limit is the same). */
export const NAME_FIELD_MAX = 100;

export interface WelcomeInput {
  name: string;
  language: string;
  inviterName: string | null;
  roles: readonly string[];
  colonies: readonly string[];
  /** A cat guardian with no colony yet (SYC-439). */
  starting?: boolean;
}

/** What she will be able to see and do, from the roles she was invited with. */
function seeAndDo(
  lang: Language,
  roles: readonly string[],
  live: readonly Language[],
  starting: boolean,
): string[] {
  const out: string[] = [];
  if (roles.includes("staff") || roles.includes("management")) out.push(tr(lang, "welcome.seeDo.team", undefined, live));
  if (roles.includes("management")) out.push(tr(lang, "welcome.seeDo.management", undefined, live));
  // With no colony yet she is promised nothing about positions (SYC-439).
  if (roles.includes("guardian")) {
    out.push(tr(lang, starting ? "welcome.seeDo.starting" : "welcome.seeDo.guardian", undefined, live));
  }
  return out;
}

export function renderWelcomePage(input: WelcomeInput, live: readonly Language[] = LIVE_LANGUAGES): string {
  const lang = pageLanguage(input.language, live);
  const t = (key: StringKey, vars?: Record<string, string>) => tr(lang, key, vars, live);
  const starting = input.starting === true;
  const role = roleSentence(lang, input.roles, input.colonies, (n) => clip(n), live, starting);
  const invited = input.inviterName
    ? t("welcome.invitedBy", { inviter: clip(input.inviterName), role })
    : t("welcome.invited", { role });
  const body =
    `<p class="invited">${escapeHtml(invited)}</p>` +
    `<h2>${escapeHtml(t("welcome.seeDo.title"))}</h2>` +
    seeAndDo(lang, input.roles, live, starting).map((p) => `<p class="seedo">${escapeHtml(p)}</p>`).join("") +
    `<h2>${escapeHtml(t("welcome.ask.title"))}</h2>` +
    `<ol class="promises">${PROMISE_KEYS.map((k) => `<li>${escapeHtml(t(k))}</li>`).join("")}</ol>` +
    STATEMENT_KEYS.map((k) => `<p class="statement">${escapeHtml(t(k))}</p>`).join("") +
    // The two answers, finger-sized on a phone (44 px, a 16 px field so iOS
    // doesn't zoom), in the dashboard's own button styles.
    '<div class="actions join">' +
    '<form method="post" action="/api/team/my/accept">' +
    `<label class="label" for="name">${escapeHtml(t("welcome.name.label"))}</label>` +
    `<input id="name" name="name" type="text" required maxlength="${NAME_FIELD_MAX}" autocomplete="name" value="${escapeHtml(clip(input.name, NAME_FIELD_MAX))}">` +
    `<button type="submit" class="save">${escapeHtml(t("welcome.yes"))}</button>` +
    "</form>" +
    '<form method="post" action="/api/team/my/decline">' +
    `<button type="submit">${escapeHtml(t("welcome.no"))}</button>` +
    "</form>" +
    "</div>";
  return renderPage({
    title: t("welcome.title"),
    active: null,
    nav: false,
    personName: input.name,
    lang,
    liveLanguages: live,
    body,
  });
}

/** A short page with no person on it: after declining, or a closed invitation. */
function shortPage(lang: Language, titleKey: StringKey, bodyKey: StringKey, live: readonly Language[]): string {
  const title = escapeHtml(tr(lang, titleKey, undefined, live));
  return (
    "<!doctype html>" +
    `<html lang="${lang}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    `<title>${title}</title>` +
    "<style>body{font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:40rem;padding:1rem}</style>" +
    `</head><body><main><h1>${title}</h1><p>${escapeHtml(tr(lang, bodyKey, undefined, live))}</p></main></body></html>`
  );
}

export function renderDeclinedPage(language?: string | null, live: readonly Language[] = LIVE_LANGUAGES): string {
  return shortPage(pageLanguage(language, live), "welcome.declined.title", "welcome.declined.body", live);
}

export function renderClosedPage(language?: string | null, live: readonly Language[] = LIVE_LANGUAGES): string {
  return shortPage(pageLanguage(language, live), "welcome.closed.title", "welcome.closed.body", live);
}
