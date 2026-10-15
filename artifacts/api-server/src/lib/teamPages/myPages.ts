import { renderPage, MY_COLONIES_PATH, MY_PAGE_PATH } from "./layout";
import { escapeHtml as esc } from "./escape";
import {
  LIVE_LANGUAGES,
  formatDate,
  pageLanguage,
  tr,
  type Language,
  type StringKey,
} from "./strings";
import { clip, joinList } from "../people/words";

// SYC-53 PR 1.3: "My page" and "My colonies" (roles-and-invites.md §2.6,
// §9.1, §9.5, §13.1). Server-drawn, no scripts, in the person's language once
// it is live (English until then; `<html lang>` is the language actually
// used). Every name that came from a record goes through esc() where it is
// drawn; the rest is fixed text from the catalogue. Nothing on these pages
// says "role", "scope" or "capability" (§2.6).

export const MY_LANGUAGE_PATH = `${MY_PAGE_PATH}/language`;
export const MY_SIGN_OUT_EVERYWHERE_PATH = `${MY_PAGE_PATH}/sign-out-everywhere`;
export const MY_STOP_PATH = `${MY_PAGE_PATH}/stop-helping`;
export const TEAM_COLONIES_PATH = "/api/team/colonies";

/** What a language is called in itself, in its own letters: fixed, never translated. */
const ENDONYMS: Record<Language, string> = { en: "English", el: "Ελληνικά", fr: "Français" };
const LANGUAGES: readonly Language[] = ["en", "el", "fr"];

/** A guardian's placement in force now, as the page needs it. */
export interface MyPlacement {
  colonyId: number;
  name: string;
  /** feeds, owns_here, covering, or null. */
  relationship: string | null;
  /** When it stops (the instant after the last day, Athens), or null for never. */
  expiresAt: Date | null;
}

/** Who is looking, as far as the sentence about them needs. */
export interface MyPerson {
  name: string;
  language: string;
  /** In the team (the team or management). */
  team: boolean;
  management: boolean;
  placements: readonly MyPlacement[];
}

const CSS = `<style>
.about{font-size:18px;margin:8px 0 4px}
.box{background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:4px 12px 12px;margin:14px 0}
.box.stop{border-left:6px solid #b3261e}
.box h2{margin:12px 0 6px}
.box p{margin:6px 0}
.mine select{display:block;width:100%;font:inherit;font-size:16px;min-height:44px;padding:8px 10px;border:1px solid #8a877e;border-radius:8px;background:#fff}
.mine label.l{display:block;font-size:14px;font-weight:700;margin:8px 0 4px}
.mine form{margin:8px 0 0}
.mbtn,a.mbtn{font:inherit;font-size:15px;min-height:44px;padding:8px 16px;border-radius:8px;border:1px solid #0b5c6b;background:#fff;color:#0b4553;cursor:pointer;display:inline-flex;align-items:center;text-decoration:none}
.mbtn.go{background:#0b5c6b;color:#fff}
.mbtn.danger{border-color:#b3261e;color:#8c1d18}
.mbtn.danger.go{background:#b3261e;color:#fff}
.okbox{background:#e3f4ea;border:1px solid #2e7d4f;border-radius:8px;padding:10px 12px;margin:12px 0}
.okbox p{margin:0}
.notice{background:#fff3cd;border:1px solid #c9a227;border-radius:8px;padding:10px 12px;margin:10px 0}
.notice p{margin:0}
.col{background:#fff;border:1px solid #d9d5ca;border-left:6px solid #0b5c6b;border-radius:8px;padding:12px;margin:10px 0;overflow-wrap:anywhere}
.col strong{font-size:17px}
.col p{margin:4px 0 0}
.choices{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0}
</style>`;

type Say = (key: StringKey, vars?: Record<string, string>) => string;
const sayIn = (lang: Language, live: readonly Language[]): Say => (key, vars) => tr(lang, key, vars, live);

/**
 * The one sentence about yourself (§2.6): derived from what you hold now and
 * the colonies you are placed on now, in your language. Plain words, never
 * "role", "scope" or "capability". Colony names are returned as typed; the
 * caller escapes the whole sentence once.
 */
export function aboutYou(
  requested: string | null | undefined,
  who: Pick<MyPerson, "team" | "management" | "placements">,
  live: readonly Language[] = LIVE_LANGUAGES,
): string {
  const lang = pageLanguage(requested, live);
  const t = sayIn(lang, live);
  const colonies = joinList(lang, who.placements.map((p) => clip(p.name)), live);
  const guardian = who.placements.length > 0;
  if (who.management) return guardian ? t("my.is.managementGuardian", { colonies }) : t("my.is.management");
  if (who.team) return guardian ? t("my.is.teamGuardian", { colonies }) : t("my.is.team");
  return guardian ? t("my.is.guardian", { colonies }) : t("my.is.none");
}

function shell(
  person: Pick<MyPerson, "name" | "language">,
  titleKey: StringKey,
  body: string,
  live: readonly Language[],
  extra: { active?: "myPage" | "myColonies"; banner?: string } = {},
): string {
  const lang = pageLanguage(person.language, live);
  return renderPage({
    title: tr(lang, titleKey, undefined, live),
    active: extra.active ?? "myPage",
    personName: person.name,
    lang,
    liveLanguages: live,
    banner: extra.banner,
    body: CSS + `<div class="mine">${body}</div>`,
  });
}

export interface MyPageInput {
  person: MyPerson;
  /** "Saved." after a language change (a fixed key in the address, nothing echoed). */
  savedLanguage?: boolean;
  /** A refusal to say plainly above the page (never an echo of what was typed). */
  problem?: StringKey;
}

export function renderMyPage(input: MyPageInput, live: readonly Language[] = LIVE_LANGUAGES): string {
  const { person } = input;
  const lang = pageLanguage(person.language, live);
  const t = sayIn(lang, live);
  const chosen = LANGUAGES.includes(person.language as Language) ? (person.language as Language) : "en";
  const options = LANGUAGES.map(
    (l) => `<option value="${l}"${l === chosen ? " selected" : ""}>${esc(ENDONYMS[l])}</option>`,
  ).join("");
  // Said plainly whenever the language she chose isn't live yet (no guessing).
  const notLive = !(live as readonly string[]).includes(chosen)
    ? `<div class="notice"><p>${esc(t("my.language.notLive", { language: t(`lang.name.${chosen}` as StringKey) }))}</p></div>`
    : "";
  const body =
    `<p class="about">${esc(aboutYou(person.language, person, live))}</p>` +
    (person.placements.length > 0
      ? `<p><a class="tap" href="${MY_COLONIES_PATH}">${esc(t("my.colonies.link"))}</a></p>`
      : "") +
    (input.problem ? `<div class="notice"><p>${esc(t(input.problem))} ${esc(t("my.problem.nothing"))}</p></div>` : "") +
    // Change language.
    '<section class="box">' +
    `<h2>${esc(t("my.language.title"))}</h2>` +
    (input.savedLanguage ? `<div class="okbox"><p>${esc(t("my.language.saved"))}</p></div>` : "") +
    notLive +
    `<form method="post" action="${MY_LANGUAGE_PATH}">` +
    `<label class="l" for="language">${esc(t("my.language.label"))}</label>` +
    `<select id="language" name="language">${options}</select>` +
    `<div class="choices"><button class="mbtn go" type="submit">${esc(t("my.language.save"))}</button></div>` +
    "</form></section>" +
    // Sign out.
    '<section class="box">' +
    `<h2>${esc(t("my.signOut.title"))}</h2>` +
    '<form method="post" action="/api/team/signout">' +
    `<button class="mbtn" type="submit">${esc(t("my.signOut.here"))}</button></form>` +
    `<p>${esc(t("my.signOut.everywhere.body"))}</p>` +
    `<form method="post" action="${MY_SIGN_OUT_EVERYWHERE_PATH}">` +
    `<button class="mbtn" type="submit">${esc(t("my.signOut.everywhere.button"))}</button></form>` +
    "</section>" +
    // Stop helping: set apart, in its own words (§9.5: not management's route).
    '<section class="box stop">' +
    `<h2>${esc(t("my.stop.title"))}</h2>` +
    `<p>${esc(t("my.stop.body"))}</p>` +
    `<p><a class="mbtn danger" href="${MY_STOP_PATH}">${esc(t("my.stop.link"))}</a></p>` +
    "</section>";
  return shell(person, "my.title", body, live);
}

/** The second page: are you sure? (No scripts: a page, then a button.) */
export function renderStopHelpingConfirm(
  person: Pick<MyPerson, "name" | "language">,
  live: readonly Language[] = LIVE_LANGUAGES,
  refused = false,
): string {
  const t = sayIn(pageLanguage(person.language, live), live);
  const body =
    (refused ? `<div class="notice"><p>${esc(t("my.stop.lastManager"))} ${esc(t("my.problem.nothing"))}</p></div>` : `<p>${esc(t("my.stop.confirm.body"))}</p>`) +
    '<div class="choices">' +
    (refused
      ? ""
      : `<form method="post" action="${MY_STOP_PATH}"><button class="mbtn danger go" type="submit">${esc(t("my.stop.confirm.yes"))}</button></form>`) +
    `<a class="mbtn" href="${MY_PAGE_PATH}">${esc(refused ? t("my.back") : t("my.stop.confirm.no"))}</a>` +
    "</div>";
  return shell(person, "my.stop.confirm.title", body, live);
}

/** A refusal in plain words, with a way back. Changed nothing. */
export function renderMyProblem(
  person: Pick<MyPerson, "name" | "language">,
  message: StringKey,
  live: readonly Language[] = LIVE_LANGUAGES,
): string {
  const t = sayIn(pageLanguage(person.language, live), live);
  return shell(
    person,
    "my.problem.title",
    `<p>${esc(t(message))}</p><p>${esc(t("my.problem.nothing"))}</p><p><a class="tap" href="${MY_PAGE_PATH}">${esc(t("my.back"))}</a></p>`,
    live,
  );
}

/** After stopping: a short page with no menu and no one signed in. */
export function renderStoppedPage(language?: string | null, live: readonly Language[] = LIVE_LANGUAGES): string {
  const lang = pageLanguage(language, live);
  const title = esc(tr(lang, "my.stop.done.title", undefined, live));
  return (
    "<!doctype html>" +
    `<html lang="${lang}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    `<title>${title}</title>` +
    "<style>body{font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:40rem;padding:1rem}</style>" +
    `</head><body><main><h1>${title}</h1><p>${esc(tr(lang, "my.stop.done.body", undefined, live))}</p></main></body></html>`
  );
}

export interface MyColoniesInput {
  person: MyPerson;
}

/**
 * "My colonies": a cat guardian's colonies by name, each with the label the
 * team gave it and when it ends (Athens date, her language). The team sees one
 * line and a link to the island-wide pages instead. Cats arrive in PR 2.1;
 * SYC-209's `movedAwayNotices(person)` will add its moved-cat lines under the
 * colony names here once it exists (not on main when this was written).
 */
export function renderMyColoniesPage(input: MyColoniesInput, live: readonly Language[] = LIVE_LANGUAGES): string {
  const { person } = input;
  const lang = pageLanguage(person.language, live);
  const t = sayIn(lang, live);
  let body: string;
  if (person.team) {
    body =
      `<p>${esc(t("mycol.team"))}</p>` +
      `<p><a class="mbtn go" href="${TEAM_COLONIES_PATH}">${esc(t("mycol.teamLink"))}</a></p>`;
  } else if (person.placements.length === 0) {
    body = `<p class="empty">${esc(t("mycol.none"))}</p>`;
  } else {
    body =
      `<p>${esc(t("mycol.intro"))}</p>` +
      person.placements
        .map((p) => {
          const label =
            p.relationship && ["feeds", "owns_here", "covering"].includes(p.relationship)
              ? `<p>${esc(t(`mycol.rel.${p.relationship}` as StringKey))}</p>`
              : "";
          // The placement ends at the START of the next day; she is told the last day.
          const ends = p.expiresAt
            ? `<p>${esc(t("mycol.until", { date: formatDate(person.language, new Date(p.expiresAt.getTime() - 60_000), live) }))}</p>`
            : "";
          return `<div class="col"><strong>${esc(clip(p.name))}</strong>${label}${ends}</div>`;
        })
        .join("");
  }
  return shell(person, "mycol.title", body, live, { active: "myColonies" });
}
