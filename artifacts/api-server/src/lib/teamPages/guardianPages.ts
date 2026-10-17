import { renderPage, MY_COLONIES_PATH } from "./layout";
import { escapeHtml as esc } from "./escape";
import { position } from "./position";
import { legacyPublicLine } from "./appearancePage";
import {
  LIVE_LANGUAGES,
  formatDate,
  pageLanguage,
  tr,
  type Language,
  type StringKey,
} from "./strings";
import type { GuardianCat } from "../guardianCatView";
import type { PersonSite } from "../teamSites";
import type { CatWithStats } from "../catHelpers";
import type { Confidence } from "../resolve";
import type { MyStatements } from "../guardianStatements";
import { GUARDIAN_LIFE_STATUSES, GUARDIAN_UNDO_DAYS } from "../guardianStatements";

// SYC-53 PR 2.1: a cat guardian's colony page and cat page (roles-and-invites
// .md §2.2). Server-drawn, no scripts, in her language once it is live.
// Built ONLY from guardianCatView's shape (or, for a cat outside her
// colonies, the public view), so nothing the team's cat page carries can
// reach here. Positions print as plain text and never as a map link
// (SYC-245, SYC-362: map links are for island-wide viewers only). Every name
// that came from a record goes through esc() where it is drawn.

/**
 * A position as text, to 5 decimal places (about 1 m), printed by position.ts
 * like every team page (SYC-395). Always link: false: these pages are a cat
 * guardian's, and D9's Open map is for island-wide viewers only
 * (positions.source.test.ts pins the literal). The result is digits, a comma
 * and a space, so the esc() at each call site leaves it as it is.
 */
const exact = (lat: number, lng: number): string => position(lat, lng, { link: false });

export const MY_CAT_PATH = "/api/team/my/cats";
export const myColonyPath = (id: number) => `${MY_COLONIES_PATH}/${id}`;
export const myCatPath = (id: number) => `${MY_CAT_PATH}/${id}`;

/** Who is looking, as far as these pages need. */
export interface GuardianViewer {
  name: string;
  language: string;
}

const CSS = `<style>
.gcats{list-style:none;padding:0;margin:12px 0}
.gcat{display:flex;gap:12px;align-items:flex-start;background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:10px;margin:10px 0;overflow-wrap:anywhere}
.gcat img.thumb{width:72px;height:72px;object-fit:cover;border-radius:6px;flex:none}
.gcat .nothumb{width:72px;height:72px;border-radius:6px;background:#ece9e1;flex:none}
.gcat a.name{font-size:17px;font-weight:700}
.gcat p,.gfacts p{margin:3px 0}
.muted{color:#5b5950;font-size:14px}
.gmain{display:block;max-width:100%;width:420px;border-radius:8px;margin:8px 0}
.gphotos{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
.gphotos img{width:104px;height:104px;object-fit:cover;border-radius:6px}
.gfacts{background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:10px 12px;margin:12px 0;overflow-wrap:anywhere}
.notice{background:#fff3cd;border:1px solid #c9a227;border-radius:8px;padding:10px 12px;margin:10px 0}
.notice p{margin:0}
.gsay{background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:10px 12px;margin:12px 0}
.gsay h3{font-size:16px;margin:12px 0 6px}
.gsay form{margin:6px 0 12px}
.gsay .row{display:flex;flex-wrap:wrap;gap:8px}
.gsay button{min-height:44px;padding:8px 14px;font-size:16px}
.gsay label.choice{display:flex;align-items:center;gap:8px;min-height:44px}
.gsay input.text{width:100%;max-width:420px;min-height:40px;font-size:16px;box-sizing:border-box}
.saved{background:#e6f2e6;border:1px solid #6a9a6a;border-radius:8px;padding:10px 12px;margin:10px 0}
</style>`;

type Say = (key: StringKey, vars?: Record<string, string>) => string;

function shell(
  who: GuardianViewer,
  title: string,
  body: string,
  live: readonly Language[],
): string {
  return renderPage({
    title,
    active: "myColonies",
    personName: who.name,
    lang: pageLanguage(who.language, live),
    liveLanguages: live,
    body: CSS + body,
  });
}

/** The sterilisation line, in the public app's words. */
export function sterilisedWords(
  s: { value: boolean | null; confidence: Confidence },
  t: Say,
): string {
  if (s.value === true) {
    if (s.confidence === "confirmed") return t("gcat.ster.yesConfirmed");
    if (s.confidence === "likely") return t("gcat.ster.yesLikely");
    if (s.confidence === "reported") return t("gcat.ster.yesReported");
  }
  if (s.value === false) {
    return s.confidence === "confirmed" ? t("gcat.ster.noConfirmed") : t("gcat.ster.noOther");
  }
  return t("gcat.ster.unknown");
}

/** "Last seen 3 October 2026", or "No sightings yet". */
function lastSeenWords(day: string | null, lang: string, t: Say, live: readonly Language[]): string {
  if (!day) return t("gcat.neverSeen");
  // A UTC day: noon UTC is the same day in Athens.
  return t("gcat.lastSeen", { date: formatDate(lang, new Date(`${day}T12:00:00Z`), live) });
}

/**
 * Colour and markings as the public line words them ("Ginger · Tabby · One
 * eye"), through SYC-2's one builder (appearancePage.publicLine), so her page
 * and the team's never word a cat differently. Nothing when nothing is known.
 */
function appearanceLine(lang: string, cat: { coat: readonly string[]; markings: readonly string[] }): string {
  const line = legacyPublicLine(lang, cat.coat, cat.markings);
  return line ? `<p>${esc(line)}</p>` : "";
}

export interface GuardianColonyPageInput {
  who: GuardianViewer;
  colony: { id: number; name: string };
  cats: readonly GuardianCat[];
  /** Her colony's feeding sites, from sitesForPerson (SYC-209's one filter). */
  sites?: readonly PersonSite[];
}

/**
 * The colony's feeding sites (spec §2.2: "colony and feeding sites"; SYC-416):
 * name, exact position as text, and the "how to find it" line. Always from
 * sitesForPerson, which filters to her colonies in SQL. Nothing when none.
 */
function sitesBlock(sites: readonly PersonSite[], t: Say): string {
  if (sites.length === 0) return "";
  return (
    `<h2>${esc(t("sites.title"))}</h2><ul class="gcats">` +
    sites
      .map(
        (s) =>
          `<li class="gcat"><div><strong>${esc(s.name)}</strong>` +
          `<p class="muted">${esc(exact(s.lat, s.lng))}</p>` +
          (s.directions ? `<p>${esc(s.directions)}</p>` : "") +
          "</div></li>",
      )
      .join("") +
    "</ul>"
  );
}

/** Her colony: every cat in it, with where each was first recorded. */
export function renderGuardianColonyPage(
  input: GuardianColonyPageInput,
  live: readonly Language[] = LIVE_LANGUAGES,
): string {
  const lang = pageLanguage(input.who.language, live);
  const t: Say = (k, v) => tr(lang, k, v, live);
  const list =
    input.cats.length === 0
      ? `<p class="empty">${esc(t("gcol.none"))}</p>`
      : '<ul class="gcats">' +
        input.cats
          .map((c) => {
            const thumb = c.mainPhotoUrl
              ? `<img class="thumb" src="${esc(c.mainPhotoUrl)}" alt="" loading="lazy">`
              : '<span class="nothumb"></span>';
            return (
              `<li class="gcat">${thumb}<div>` +
              `<a class="name" href="${myCatPath(c.id)}">${esc(c.name)}</a> <span class="muted">${esc(c.syr)}</span>` +
              `<p>${esc(sterilisedWords(c.sterilised, t))}</p>` +
              (c.lifeStatus ? `<p>${esc(t(`gcat.life.${c.lifeStatus}` as StringKey))}</p>` : "") +
              `<p class="muted">${esc(lastSeenWords(c.lastSeen, lang, t, live))}</p>` +
              `<p class="muted">${esc(t("gcat.position", { position: exact(c.lat, c.lng) }))}</p>` +
              "</div></li>"
            );
          })
          .join("") +
        "</ul>";
  const body =
    `<p>${esc(t("gcol.intro"))}</p>` +
    list +
    sitesBlock(input.sites ?? [], t) +
    `<p><a class="tap" href="${MY_COLONIES_PATH}">${esc(t("gcat.back"))}</a></p>`;
  return shell(input.who, input.colony.name, body, live);
}

const SAVED_KEYS: Record<string, StringKey> = {
  sterilised: "gcat.saved.sterilised",
  life: "gcat.saved.life",
  putBack: "gcat.saved.putBack",
};

/** "Syros Cats looked again…": the team's answer to one of her statements, never a name. */
function lookedAgainLine(l: MyStatements["lookedAgain"][number], t: Say): string {
  if (l.kind === "sterilised") {
    if (l.now === true) return t("gcat.lookedAgain.sterYes");
    if (l.now === false) return t("gcat.lookedAgain.sterNo");
    return "";
  }
  if (typeof l.now !== "string") return "";
  return t("gcat.lookedAgain.life", { status: t(`gcat.life.${l.now}` as StringKey) });
}

/**
 * What she can say about this cat (PR 2.2; spec §2.2, §7.2): sterilised or
 * not, a life status with a reason, and putting back her own last change.
 * Plain forms, no script; every button at least 44 px high.
 */
function sayBlock(cat: GuardianCat, mine: MyStatements, t: Say): string {
  const base = myCatPath(cat.id);
  const ster =
    `<h3>${esc(t("gcat.say.sterTitle"))}</h3>` +
    `<form method="post" action="${base}/sterilisation"><div class="row">` +
    `<button type="submit" name="sterilised" value="yes">${esc(t("gcat.say.sterYes"))}</button>` +
    `<button type="submit" name="sterilised" value="no">${esc(t("gcat.say.sterNo"))}</button>` +
    "</div></form>";
  const choices = GUARDIAN_LIFE_STATUSES.map(
    (st) =>
      `<label class="choice" for="gl-${st}"><input type="radio" id="gl-${st}" name="status" value="${st}" required> ${esc(t(`gcat.say.life.${st}` as StringKey))}</label>`,
  ).join("");
  const life =
    `<form method="post" action="${base}/life-status">` +
    `<h3 id="gl-title">${esc(t("gcat.say.lifeTitle"))}</h3>` +
    `<fieldset aria-labelledby="gl-title">${choices}</fieldset>` +
    `<label class="label" for="gl-why">${esc(t("gcat.say.reason"))}</label>` +
    '<input class="text" id="gl-why" name="reason" required maxlength="200" autocomplete="off">' +
    `<div class="row"><button type="submit">${esc(t("gcat.say.save"))}</button></div></form>`;
  let back = "";
  if (mine.putBack) {
    const pb = mine.putBack;
    const status = t(`gcat.life.${pb.status}` as StringKey);
    const previous = t(`gcat.life.${pb.putsBack}` as StringKey);
    back =
      `<div class="notice"><p>${esc(
        t("gcat.say.putBack", { status, previous }),
      )}</p>` +
      `<form method="post" action="${base}/life-status">` +
      `<input type="hidden" name="putBack" value="${pb.statementId}">` +
      `<div class="row"><button type="submit">${esc(t("gcat.say.putBackButton", { previous }))}</button></div></form></div>`;
  }
  return (
    '<div class="gsay">' +
    `<h2>${esc(t("gcat.say.heading"))}</h2>` +
    `<p class="muted">${esc(t("gcat.say.intro", { days: String(GUARDIAN_UNDO_DAYS) }))}</p>` +
    back +
    ster +
    life +
    "</div>"
  );
}

/** One of her cats, in full (spec §2.2's list, nothing more), and what she can say about it. */
export function renderGuardianCatPage(
  who: GuardianViewer,
  cat: GuardianCat,
  sites: readonly PersonSite[] = [],
  live: readonly Language[] = LIVE_LANGUAGES,
  opts: { mine?: MyStatements; saved?: string | null } = {},
): string {
  const lang = pageLanguage(who.language, live);
  const t: Say = (k, v) => tr(lang, k, v, live);
  const main = cat.mainPhotoUrl
    ? `<img class="gmain" src="${esc(cat.mainPhotoUrl)}" alt="${esc(cat.name)}">`
    : "";
  const others = cat.photoUrls.filter((u) => u !== cat.mainPhotoUrl);
  const gallery =
    others.length === 0
      ? ""
      : `<h2>${esc(t("gcat.photos"))}</h2><div class="gphotos">` +
        others
          .map((u) => `<a href="${esc(u)}"><img src="${esc(u)}" alt="" loading="lazy"></a>`)
          .join("") +
        "</div>";
  const savedKey = opts.saved && Object.hasOwn(SAVED_KEYS, opts.saved) ? SAVED_KEYS[opts.saved] : undefined;
  const notes =
    (savedKey ? `<div class="saved" role="status"><p>${esc(t(savedKey))}</p></div>` : "") +
    (opts.mine?.lookedAgain ?? [])
      .map((l) => lookedAgainLine(l, t))
      .filter((line) => line !== "")
      .map((line) => `<div class="notice"><p>${esc(line)}</p></div>`)
      .join("");
  const body =
    notes +
    `<p class="muted">${esc(cat.syr)}</p>` +
    main +
    '<div class="gfacts">' +
    (cat.colony
      ? `<p><a href="${myColonyPath(cat.colony.id)}">${esc(t("gcat.colony", { name: cat.colony.name }))}</a></p>`
      : "") +
    `<p>${esc(sterilisedWords(cat.sterilised, t))}</p>` +
    (cat.lifeStatus ? `<p>${esc(t(`gcat.life.${cat.lifeStatus}` as StringKey))}</p>` : "") +
    `<p>${esc(lastSeenWords(cat.lastSeen, lang, t, live))}</p>` +
    `<p>${esc(t("gcat.position", { position: exact(cat.lat, cat.lng) }))}</p>` +
    appearanceLine(lang, cat) +
    (cat.description ? `<p class="muted">${esc(cat.description)}</p>` : "") +
    "</div>" +
    (opts.mine ? sayBlock(cat, opts.mine, t) : "") +
    sitesBlock(sites, t) +
    gallery +
    `<p><a class="tap" href="${MY_COLONIES_PATH}">${esc(t("gcat.back"))}</a></p>`;
  return shell(who, cat.name, body, live);
}

/**
 * A cat outside her colonies, or in none: the public app's lines for it, and
 * no position at all on this page.
 */
export function renderPublicCatForGuardian(
  who: GuardianViewer,
  cat: CatWithStats,
  live: readonly Language[] = LIVE_LANGUAGES,
): string {
  const lang = pageLanguage(who.language, live);
  const t: Say = (k, v) => tr(lang, k, v, live);
  // No photo: the public photo address sits behind the pre-launch pass,
  // which the dashboard doesn't carry, and the team photo route rightly
  // refuses her for a cat outside her colonies. The JSON keeps the public
  // `photoUrl`, field for field.
  const body =
    `<div class="notice"><p>${esc(t("gcat.public.note"))}</p></div>` +
    '<div class="gfacts">' +
    `<p>${esc(sterilisedWords(cat.sterilised, t))}</p>` +
    `<p>${esc(t(`gcat.life.${cat.lifeStatus}` as StringKey))}</p>` +
    `<p>${esc(lastSeenWords(cat.lastSeenAt, lang, t, live))}</p>` +
    appearanceLine(lang, cat) +
    "</div>" +
    `<p><a class="tap" href="${MY_COLONIES_PATH}">${esc(t("gcat.back"))}</a></p>`;
  return shell(who, cat.name, body, live);
}

/** A colony that isn't hers (or doesn't exist), or no such cat: the same plain page. */
export function renderGuardianNotFound(
  who: GuardianViewer,
  what: "colony" | "cat",
  live: readonly Language[] = LIVE_LANGUAGES,
): string {
  const lang = pageLanguage(who.language, live);
  const t: Say = (k, v) => tr(lang, k, v, live);
  const [title, body] =
    what === "colony"
      ? [t("gcol.notFound.title"), t("gcol.notFound.body")]
      : [t("gcat.notFound.title"), t("gcat.notFound.body")];
  return shell(
    who,
    title,
    `<p>${esc(body)}</p><p><a class="tap" href="${MY_COLONIES_PATH}">${esc(t("gcat.back"))}</a></p>`,
    live,
  );
}

/** Something she sent didn't save: what to do, and the way back to the cat. */
export function renderGuardianProblem(
  who: GuardianViewer,
  key: "gcat.problem.choose" | "gcat.problem.reason" | "gcat.problem.notYours",
  catId: number,
  live: readonly Language[] = LIVE_LANGUAGES,
): string {
  const lang = pageLanguage(who.language, live);
  const t: Say = (k, v) => tr(lang, k, v, live);
  return shell(
    who,
    t("gcat.problem.title"),
    `<p>${esc(t(key))}</p><p><a class="tap" href="${myCatPath(catId)}">${esc(t("gcat.problem.backToCat"))}</a></p>`,
    live,
  );
}
