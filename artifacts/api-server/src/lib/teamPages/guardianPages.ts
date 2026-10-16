import { renderPage, MY_COLONIES_PATH } from "./layout";
import { escapeHtml as esc } from "./escape";
import { publicLine } from "./appearancePage";
import {
  LIVE_LANGUAGES,
  formatDate,
  pageLanguage,
  tr,
  type Language,
  type StringKey,
} from "./strings";
import type { GuardianCat } from "../guardianCatView";
import type { CatWithStats } from "../catHelpers";
import type { Confidence } from "../resolve";

// SYC-53 PR 2.1: a cat guardian's colony page and cat page (roles-and-invites
// .md §2.2). Server-drawn, no scripts, in her language once it is live.
// Built ONLY from guardianCatView's shape (or, for a cat outside her
// colonies, the public view), so nothing the team's cat page carries can
// reach here. Positions print as plain text and never as a map link
// (SYC-245, SYC-362: map links are for island-wide viewers only). Every name
// that came from a record goes through esc() where it is drawn.

/**
 * A position as text, to 5 decimal places (about 1 m), as the team's pages
 * print it. Never a link: position.ts is the only builder of map links and
 * SYC-362 keeps them off every page a cat guardian reads.
 */
const exact = (lat: number, lng: number): string => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

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
  const line = publicLine(lang, cat.coat, cat.markings);
  return line ? `<p>${esc(line)}</p>` : "";
}

export interface GuardianColonyPageInput {
  who: GuardianViewer;
  colony: { id: number; name: string };
  cats: readonly GuardianCat[];
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
    `<p><a class="tap" href="${MY_COLONIES_PATH}">${esc(t("gcat.back"))}</a></p>`;
  return shell(input.who, input.colony.name, body, live);
}

/** One of her cats, in full (spec §2.2's list, nothing more). */
export function renderGuardianCatPage(
  who: GuardianViewer,
  cat: GuardianCat,
  live: readonly Language[] = LIVE_LANGUAGES,
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
  const body =
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
