import type { DerivedCatStatus } from "../catHelpers";
import type { Confidence, LifeStatusValue } from "../resolve";
import type {
  TeamCatView,
  TeamPhoto,
  TeamResolved,
  TeamStatement,
} from "../teamCatView";
import type { Capability } from "../capabilities";
import type { QueueReport } from "../welfareQueue";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { position } from "./position";
import { t } from "./words";
import { renderAppearanceSection } from "./appearancePage";

// The team's "Cats" screens (SYC-43 part 2 plan, PR 3): finding a cat, and
// the team's page for one cat. Read-only. Server-drawn, no scripts. Every
// value goes through escapeHtml; the data comes only from lib/teamCatView.ts.

// The app's own English words (artifacts/cat-spotter/lib/i18n.ts), so the
// team reads the public line exactly as a spotter does.
export const LIFE: Record<LifeStatusValue, string> = {
  street: "Lives on the street",
  homed: "Has a home",
  in_care: "In Syros Cats' care",
  deceased: "No longer with us",
};

const CONFIDENCE: Record<Confidence, string> = {
  confirmed: "confirmed",
  likely: "likely",
  reported: "reported",
  unknown: "not known",
};

/** Dates on Syros: the team reads them in Greek time. */
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Athens",
  });

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Athens",
  });

const time = (iso: string, text = when(iso)) =>
  `<time datetime="${esc(iso)}">${esc(text)}</time>`;

// Positions print through position.ts (SYC-395, D9): 5 decimal places, with
// an "Open map" link only for an island-wide viewer (`opts.island`). This
// reverses SYC-245 / SYC-209 Decision 2B for outbound links only. The owner's
// home pin never gets one (D5): it is printed with link: false.

// Two buttons on each sighting (SYC-209 PR 3.4). Each is a POST form that
// carries only the sighting's number: the server looks the position up, so no
// position is ever in an address (K13). They replace the removed link to a map
// company, and the page must never have both.
const sightingButtons = (sightingId: number, may: (c: Capability) => boolean) =>
  (may("add_feeding_site")
    ? `<form method="post" action="/api/team/sites/from-sighting" class="sightact"><input type="hidden" name="sightingId" value="${sightingId}"><button type="submit">${esc(t("sighting.makeSite"))}</button></form>`
    : "") +
  (may("view_exact_location")
    ? `<form method="post" action="/api/team/sites/map-at-sighting#map" class="sightact"><input type="hidden" name="sightingId" value="${sightingId}"><button type="submit">${esc(t("sighting.showOnMap"))}</button></form>`
    : "");

const row = (label: string, value: string) =>
  `<dt>${esc(label)}</dt><dd>${value}</dd>`;

/**
 * The public sterilised line, word for word as the app shows it
 * (catStatusLines.ts's sterilisedLineKey): only confirmed and likely say
 * anything; everything else, "reported" included, is "Not known yet".
 */
function publicSterilisedText(s: { value: boolean | null; confidence: Confidence }): string {
  if (s.confidence === "confirmed")
    return s.value ? "Sterilised — confirmed by Syros Cats" : "Not sterilised — Syros Cats' records";
  if (s.confidence === "likely") return "Probably sterilised — a clipped ear tip has been seen";
  return "Not known yet";
}

/** The records' own answer, short: its confidence is shown beside it. */
function sterilisedText(s: { value: boolean | null; confidence: Confidence }): string {
  if (s.value === null || s.confidence === "unknown") return "Not known yet";
  if (s.value) {
    if (s.confidence === "likely") return "Probably sterilised";
    if (s.confidence === "reported") return "Reported sterilised";
    return "Sterilised";
  }
  return s.confidence === "reported" ? "Reported not sterilised" : "Not sterilised";
}

function publicStatusText(s: DerivedCatStatus): string {
  const life = LIFE[s.lifeStatus];
  const seen = s.notSeenSince ? ` · Not seen since ${day(s.notSeenSince)}` : "";
  return `${life} · ${publicSterilisedText(s.sterilised)}${seen}`;
}

// ── Finding a cat ──────────────────────────────────────────────────────────

const catHref = (id: number) => `/api/team/cats/${id}`;

/**
 * The Cats page when it is choosing a cat for a welfare report (PR 5): each
 * card carries a plain "This is the cat" form posting to the tie route.
 * `report` is null when the id in the link matches no sent report.
 */
export interface TieMode {
  publicId: string;
  report: QueueReport | null;
  /** May this person tie? Without it the results are only for looking. */
  canTie: boolean;
}

// ── The team's cat page ────────────────────────────────────────────────────

/** How many statements the history shows before "Show all" (SYC-219). */
export const HISTORY_SHOWN = 20;

/**
 * The statements the history on this page shows; null when it shows every
 * one. A link to a statement left out reloads the page with the full list.
 */
type Shown = ReadonlySet<number> | null;

const statementHref = (id: number, shown: Shown) =>
  shown === null || shown.has(id) ? `#s-${id}` : `?history=all#s-${id}`;

const statementLink = (id: number, shown: Shown) =>
  `<a href="${statementHref(id, shown)}">#${id}</a>`;

/** Who said it, as the history shows it: "Eleni, cat guardian" for a guardian's word (PR 2.2). */
const byWhom = (s: TeamStatement) => (s.asGuardian ? `${s.author.label}, cat guardian` : s.author.label);

/**
 * The statements an answer rests on, in words: what was said, by whom and
 * when, each linking to its place in the history below.
 */
function statementRefs(ids: number[], byId: Map<number, TeamStatement>, shown: Shown): string {
  if (ids.length === 0) return "Nothing yet";
  return (
    '<ul class="refs">' +
    ids
      .map((id) => {
        const s = byId.get(id);
        if (!s) return `<li>${statementLink(id, shown)}</li>`;
        return (
          `<li><a href="${statementHref(id, shown)}">${esc(s.said)}</a> ` +
          `<span class="meta">(${esc(byWhom(s))}, ${time(s.createdAt, day(s.createdAt))})</span></li>`
        );
      })
      .join("") +
    "</ul>"
  );
}

function recordBlock<T>(
  label: string,
  r: TeamResolved<T>,
  valueText: string,
  extra: string,
  byId: Map<number, TeamStatement>,
  shown: Shown,
): string {
  return (
    `<h3>${esc(label)}</h3><dl>` +
    row("Status", `${esc(valueText)} <span class="tag">${esc(CONFIDENCE[r.confidence])}</span>`) +
    row("Since", time(r.asOf, day(r.asOf))) +
    row("Why we think so", statementRefs(r.supportingStatementIds, byId, shown)) +
    (r.conflictingStatementIds.length
      ? row("Says otherwise", `<div class="bad">${statementRefs(r.conflictingStatementIds, byId, shown)}</div>`)
      : "") +
    extra +
    "</dl>"
  );
}

/**
 * "Confirmed by Eleni, cat guardian, 14 October" (SYC-53 PR 2.2; spec §7.2):
 * when a cat guardian's statement decides the sterilisation answer, the team
 * sees whose word it is, and *This is wrong* (Mark wrong) is on that
 * statement in the history.
 */
function guardianConfirmed(r: TeamResolved<boolean>, byId: Map<number, TeamStatement>, shown: Shown): string {
  if (r.confidence !== "confirmed") return "";
  const s = byId.get(r.supportingStatementIds[0] ?? -1);
  if (!s || !s.asGuardian) return "";
  return row(
    "Confirmed by",
    `${esc(byWhom(s))}, ${time(s.createdAt, day(s.createdAt))} · ` +
      `<a href="${statementHref(s.id, shown)}">This is wrong?</a>`,
  );
}

/**
 * The 30-day flag (spec §2.2, §7.2): a cat a guardian marked homed or
 * deceased recently stays visible to the team, so it can't quietly leave a
 * round.
 */
function guardianMarkNotice(v: TeamCatView, byId: Map<number, TeamStatement>, shown: Shown): string {
  const m = v.recentGuardianMark;
  if (!m) return "";
  const s = byId.get(m.statementId);
  const what = m.status === "homed" ? "homed" : "as no longer with us";
  return (
    `<p class="notice" role="note">Recently marked ${what} by the cat guardian` +
    (s ? `, ${esc(s.author.label)}` : "") +
    ` (${time(m.at, day(m.at))}). <a href="${statementHref(m.statementId, shown)}">See the statement</a></p>`
  );
}

/** Today on Syros, for a date box's max. */
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Athens" });

const LIFE_ORDER: LifeStatusValue[] = ["street", "homed", "in_care", "deceased"];

const reasonInput = (id: string, label = "Why") =>
  `<label class="label" for="${id}">${esc(label)}</label>` +
  `<input class="text" id="${id}" name="reason" required maxlength="500" autocomplete="off">`;

const dateInput = (id: string, label: string, hint: string) =>
  `<label class="label" for="${id}">${esc(label)} <span class="hint">${esc(hint)}</span></label>` +
  `<input id="${id}" name="date" type="date" max="${today()}">`;

const lifeChoices = (
  name: string,
  idBase: string,
  skip: LifeStatusValue | null,
  allowed: readonly LifeStatusValue[] = LIFE_ORDER,
  checked: LifeStatusValue | null = null,
) =>
  LIFE_ORDER.filter((l) => l !== skip && allowed.includes(l))
    .map(
      (l) =>
        `<label class="choice" for="${idBase}-${l}"><input type="radio" id="${idBase}-${l}" name="${name}" value="${l}" required${l === checked ? " checked" : ""}> ${esc(LIFE[l])}</label>`,
    )
    .join("");

/** "Mark wrong" under a standing statement (PR 4), when this person may. */
function wrongForm(s: TeamStatement, may: (c: Capability) => boolean): string {
  const c = s.correction;
  if (!c) return "";
  // Colour and markings are marked wrong in the Appearance section (one form
  // per statement on the page, SYC-2 PR 3.1).
  if (c.kind === "appearance") return "";
  const action = `/api/team/statements/${s.id}/wrong`;
  const id = `w${s.id}`;
  if (c.kind === "ear_tip_clipped") {
    if (!may("set_sterilisation")) return "";
    return (
      `<details><summary>Mark wrong</summary><form method="post" action="${action}">` +
      '<input type="hidden" name="choice" value="not_clipped">' +
      '<p class="hint">The cat goes back to Not known yet, unless something else says otherwise.</p>' +
      reasonInput(`${id}-why`, "Why it isn't a clip") +
      "<button type=\"submit\">Mark wrong: it's not a clip</button></form></details>"
    );
  }
  if (c.kind === "colony") {
    if (!may("assign_cat_to_colony")) return "";
    // No choice to make: the server works out what stands instead.
    return (
      `<details><summary>Mark wrong</summary><form method="post" action="${action}">` +
      '<input type="hidden" name="choice" value="colony_previous">' +
      '<p class="hint">The cat goes back to the colony it was in before this, or to no colony if there was none.</p>' +
      reasonInput(`${id}-why`) +
      '<button type="submit">Mark wrong</button></form></details>'
    );
  }
  if (c.kind === "sterilised") {
    if (!may("set_sterilisation")) return "";
    const to = c.now === true ? "sterilised_no" : "sterilised_yes";
    const toText = c.now === true ? "Not sterilised" : "Sterilised";
    return (
      `<details><summary>Mark wrong</summary><form method="post" action="${action}">` +
      `<input type="hidden" name="choice" value="${to}">` +
      `<p>It should say: <strong>${esc(toText)}</strong></p>` +
      reasonInput(`${id}-why`) +
      '<button type="submit">Mark wrong</button></form></details>'
    );
  }
  if (!may("set_life_status")) return "";
  return (
    `<details><summary>Mark wrong</summary><form method="post" action="${action}">` +
    '<fieldset><legend class="label">It should say</legend>' +
    lifeChoices("choice", `${id}-to`, c.now) +
    "</fieldset>" +
    dateInput(`${id}-date`, "Date it happened", "(needed for “No longer with us”)") +
    reasonInput(`${id}-why`) +
    '<button type="submit">Mark wrong</button></form></details>'
  );
}

function statementItem(
  s: TeamStatement,
  byId: Map<number, TeamStatement>,
  shown: Shown,
  may: (c: Capability) => boolean = () => false,
  notice = "",
): string {
  const replaced = s.replacedBy.length > 0;
  const said = replaced ? `<del>${esc(s.said)}</del>` : esc(s.said);
  const differs = Math.abs(Date.parse(s.observedAt) - Date.parse(s.createdAt)) > 60_000;
  const meta =
    `${esc(byWhom(s))} · ${time(s.createdAt)}` +
    (differs ? ` · about ${time(s.observedAt)}` : "");
  const replacements = s.replacedBy
    .map((id) => byId.get(id))
    .filter((r): r is TeamStatement => r !== undefined)
    .map(
      (r) =>
        `<p class="replacement">Replaced by ${statementLink(r.id, shown)}: ${esc(r.said)}` +
        (r.reason ? `. Why: ${esc(r.reason)}` : "") +
        ` <span class="meta">(${esc(byWhom(r))}, ${time(r.createdAt)})</span></p>`,
    )
    .join("");
  const moved = s.movedTo
    ? `<p class="replacement">Moved to <a href="${esc(catHref(s.movedTo.cat.id))}">${esc(s.movedTo.cat.name)}</a> ` +
      `<span class="syr">${esc(s.movedTo.cat.syr)}</span>` +
      (s.movedTo.reason ? `. Why: ${esc(s.movedTo.reason)}` : "") +
      ` <span class="meta">(${time(s.movedTo.at)})</span></p>`
    : "";
  const corrects = s.movedFrom
    ? `<p class="meta">Moved here from <a href="${esc(catHref(s.movedFrom.cat.id))}">${esc(s.movedFrom.cat.name)}</a> ` +
      `<span class="syr">${esc(s.movedFrom.cat.syr)}</span></p>`
    : s.replaces != null
      ? `<p class="meta">Corrects ${statementLink(s.replaces, shown)}</p>`
      : "";
  return (
    `<li class="statement${replaced ? " replaced" : ""}" id="s-${s.id}">` +
    notice +
    `<p class="said"><span class="sid">#${s.id}</span> ${said}</p>` +
    `<p class="meta">${meta}</p>` +
    (s.reason ? `<p class="why">Why: ${esc(s.reason)}</p>` : "") +
    corrects +
    (s.photoUrl ? `<p class="meta"><a class="tap" href="${esc(s.photoUrl)}">See the photo</a></p>` : "") +
    replacements +
    moved +
    wrongForm(s, may) +
    (s.ownerClaim
      ? '<p class="hint">This is the owner\'s own claim. To end this claim, use Remove owner under “Update this cat”.</p>'
      : "") +
    "</li>"
  );
}

/** What the page says after a correction, by the `done` the form sent back. */
const DONE: Record<string, string> = {
  life: "Saved. Where the cat lives is added to the history below.",
  sterilised: "Saved. The sterilisation is added to the history below.",
  wrong: "Saved. The correction is in the history below, with the change it replaces.",
  renamed: "Saved. The new name is in the history below.",
  unchanged: "That is already the cat's name. Nothing was changed.",
  already: "Someone already corrected this. Here's what replaced it.",
  ownerRemoved: "Saved. The owner is removed and the cat's new status is in the history below. Nobody was told.",
  ownerGone: "This cat has no owner now, so there was nothing to remove. Nothing was changed.",
  lifeOwnerKept: "Saved. This cat still has an owner. Ask the team if the owner should be removed.",
  colony: "Saved. The colony is added to the history below.",
  colonyOut: "Saved. The cat is out of its colony. This is added to the history below.",
  colonyAlready: "The cat was already there, so nothing was changed.",
};

/** What the page says beside a photo after Hide or Restore (PR 6). */
const PHOTO_DONE: Record<string, string> = {
  hidden: "Hidden. The public no longer sees this photo. Tap Restore to bring it back.",
  restored: "Restored. The public sees this photo again.",
  already_hidden: "Someone already hid this photo a moment ago. Nothing was changed.",
  already_public: "Someone already restored this photo a moment ago. Nothing was changed.",
};

export interface CatPageOptions {
  /** May the signed-in person do this? Decides which forms are shown. */
  may?: (capability: Capability) => boolean;
  /** What was just done, from the redirect after a form (a fixed key). */
  done?: string;
  /** The history row the page lands on after a correction. */
  at?: number;
  /** The photo the page lands on after Hide or Restore (its publicId). */
  photo?: string;
  /** Every colony, for the "Colony" list. Only asked for if the person may assign. */
  colonies?: { id: number; name: string }[];
  /** ?history=all: show every statement, not just the newest HISTORY_SHOWN. */
  allHistory?: boolean;
  /**
   * Can the viewer see the whole island (`isIslandWide`)? Only then do
   * positions get an "Open map" link (D9). Left out means no link.
   */
  island?: boolean;
}

/**
 * One photo in the gallery. Staff see hidden photos too, labelled with who
 * hid them and when, with Hide or Restore: one tap, no "are you sure?" (§3.3).
 */
function galleryItem(
  p: TeamPhoto,
  i: number,
  total: number,
  catId: number,
  may: (c: Capability) => boolean,
  notice: string,
): string {
  const action = p.hidden ? "restore" : "hide";
  const allowed = may(p.hidden ? "restore_photo" : "hide_photo");
  // SYC-415: a spot's face or body photo says so, in its caption and for a
  // screen reader. The first photo and the main photo carry no label.
  const roleWords = p.role === "face" ? "Face photo" : p.role === "body" ? "Whole body photo" : null;
  const roleSr = roleWords ? `${roleWords.toLowerCase()}, ` : "";
  const form = allowed
    ? `<form method="post" action="/api/team/photos/${encodeURIComponent(p.publicId)}/${action}">` +
      `<input type="hidden" name="cat" value="${catId}">` +
      `<button type="submit" class="${p.hidden ? "restore" : "hide risky"}">${p.hidden ? "Restore" : "Hide from the public"}` +
      // Which photo, for a screen reader: every button says the same words.
      `<span class="sr"> (${roleSr}photo ${i + 1} of ${total})</span></button></form>`
    : "";
  const label = p.hidden
    ? `<p class="hiddenby">Hidden from the public by ${esc(p.hidden.by)}, ${time(p.hidden.at, day(p.hidden.at))}` +
      (p.hidden.reason ? `<br><span class="why">${esc(p.hidden.reason)}</span>` : "") +
      "</p>"
    : "";
  return (
    `<figure id="p-${esc(p.publicId)}"${p.hidden ? ' class="ishidden"' : ""}>` +
    `<a href="${esc(p.url)}"><img src="${esc(p.url)}" alt="${esc(`Photo ${i + 1} of ${total}${p.hidden ? ", hidden from the public" : ""}`)}" loading="lazy"></a>` +
    (roleWords ? `<p class="role">${roleWords}</p>` : "") +
    notice +
    label +
    form +
    "</figure>"
  );
}

/** "Colony": pick one from the list of all colonies, or take the cat out of its colony. */
function colonyForm(v: TeamCatView, colonies: { id: number; name: string }[]): string {
  const base = `/api/team/cats/${v.cat.id}/colony`;
  if (colonies.length === 0) {
    return (
      "<details><summary>Colony</summary>" +
      '<p class="hint">There are no colonies yet. <a href="/api/team/colonies">Create one</a> first.</p></details>'
    );
  }
  const options = colonies
    .map(
      (c) =>
        `<option value="${c.id}"${c.id === v.colony?.id ? " selected" : ""}>${esc(c.name)}</option>`,
    )
    .join("");
  return (
    `<details><summary>Colony</summary><form method="post" action="${base}">` +
    '<label class="label" for="co-pick">Put the cat in</label>' +
    `<select class="text" id="co-pick" name="colonyId" required>${options}</select>` +
    '<p class="hint">If the cat is in another colony now, it moves. Both are kept in the history below.</p>' +
    '<button type="submit">Save</button></form>' +
    (v.colony
      ? `<form method="post" action="${base}"><input type="hidden" name="colonyId" value="none">` +
        '<button type="submit" class="risky">Take out of this colony</button></form>'
      : "") +
    "</details>"
  );
}

/** The four correction forms (PR 4), each shown only to someone who may. */
function correctionForms(
  v: TeamCatView,
  may: (c: Capability) => boolean,
  notice = "",
  colonies: { id: number; name: string }[] = [],
): string {
  const base = `/api/team/cats/${v.cat.id}`;
  const forms: string[] = [];
  if (may("set_life_status")) {
    forms.push(
      `<details><summary>Update where the cat lives</summary><form method="post" action="${base}/life-status">` +
        '<fieldset><legend class="label">The cat…</legend>' +
        lifeChoices("status", "ls", null) +
        "</fieldset>" +
        // Owned cat (spec §7, SYC-362 D2): no box. Saving anything but "has a
        // home" asks first, on its own page, before the owner is removed.
        ((v.owner.has || v.owner.orphanedHome) && may("remove_owner")
          ? '<p class="hint">This cat has an owner. Saving anything but “Has a home” asks you first whether to remove the owner.</p>'
          : "") +
        dateInput("ls-date", "Date it happened", "(needed for “No longer with us”; leave blank for today)") +
        reasonInput("ls-why") +
        '<button type="submit">Save</button></form></details>',
    );
  }
  if (may("set_sterilisation")) {
    forms.push(
      `<details><summary>Update whether sterilised</summary><form method="post" action="${base}/sterilisation">` +
        '<p class="warn">A clipped ear seen in a photo is never proof. Use this only when Syros Cats or a vet knows.</p>' +
        '<fieldset><legend class="label">The cat is…</legend>' +
        '<label class="choice" for="st-yes"><input type="radio" id="st-yes" name="sterilised" value="yes" required> Sterilised</label>' +
        '<label class="choice" for="st-no"><input type="radio" id="st-no" name="sterilised" value="no" required> Not sterilised</label>' +
        "</fieldset>" +
        dateInput("st-date", "When it was done", "(optional)") +
        '<label class="label" for="st-clinic">Clinic or vet <span class="hint">(optional)</span></label>' +
        '<input class="text" id="st-clinic" name="clinic" maxlength="100" autocomplete="off">' +
        reasonInput("st-why", "How we know") +
        '<button type="submit">Save</button></form></details>',
    );
  }
  if (may("assign_cat_to_colony")) forms.push(colonyForm(v, colonies));
  if (may("rename_cat")) {
    forms.push(
      `<details><summary>Rename the cat</summary><form method="post" action="${base}/name">` +
        '<label class="label" for="rn-name">New name</label>' +
        `<input class="text" id="rn-name" name="name" required maxlength="60" value="${esc(v.cat.name)}" autocomplete="off" spellcheck="false">` +
        reasonInput("rn-why") +
        '<button type="submit">Rename</button></form></details>',
    );
  }
  if ((v.owner.has || v.owner.orphanedHome) && may("remove_owner") && may("set_life_status")) {
    forms.push(
      `<details><summary>Remove owner</summary><form method="post" action="${base}/remove-owner">` +
        '<p class="hint">Ends this claim. The owner stops seeing the exact spot and getting alerts. Nobody is told.</p>' +
        '<fieldset><legend class="label">The cat now…</legend>' +
        lifeChoices("status", "ro", null, ["street", "in_care", "deceased"], "street") +
        "</fieldset>" +
        dateInput("ro-date", "Date it happened", "(needed for “No longer with us”)") +
        reasonInput("ro-why") +
        '<button type="submit" class="risky">Remove owner</button></form></details>',
    );
  }
  if (forms.length === 0) return notice;
  return (
    '<h2 id="corrections">Update this cat</h2>' +
    notice +
    '<p class="hint">Every change is saved with your name. Nothing is deleted. A change with an older date won\'t override a newer one. To undo a change, use <strong>Mark wrong</strong> on it in the history below.</p>' +
    `<div class="fixes">${forms.join("")}</div>`
  );
}

/**
 * The record and "Update this cat" side by side on a wide screen, one
 * under the other on a phone. Without the forms, the record alone.
 */
function sideBySide(record: string, fixes: string): string {
  if (!fixes.includes('id="corrections"')) return record + fixes;
  return `<div class="twocol"><div>${record}</div><div>${fixes}</div></div>`;
}

export function renderCatPage(
  v: TeamCatView,
  personName: string,
  opts: CatPageOptions = {},
): string {
  const { cat, records } = v;
  const may = opts.may ?? (() => false);
  const island = opts.island === true;
  // The message goes where the page lands: beside the statement after a
  // correction, at the top of "Update this cat" after the other forms.
  // Own keys only: ?done=constructor must not reach Object.prototype.
  const notice =
    opts.done && Object.hasOwn(DONE, opts.done)
      ? `<p class="notice" role="status">${esc(DONE[opts.done]!)}</p>`
      : "";
  const atStatement = opts.at !== undefined && v.history.some((h) => h.id === opts.at);
  const formsNotice = atStatement ? "" : notice;
  const byId = new Map(v.history.map((s) => [s.id, s]));
  // The history is newest first. After a correction to an older statement
  // the page lands on it, so then every statement is shown.
  const newest = v.history.slice(0, HISTORY_SHOWN);
  const shown: Shown =
    opts.allHistory ||
    v.history.length <= HISTORY_SHOWN ||
    (atStatement && !newest.some((h) => h.id === opts.at))
      ? null
      : new Set(newest.map((h) => h.id));
  const mainHidden = v.photos.find((p) => p.source === "main")?.hidden ?? null;
  const main =
    (cat.mainPhotoUrl
      ? `<img class="photo catmain" src="${esc(cat.mainPhotoUrl)}" alt="Main photo of ${esc(cat.name)}">`
      : '<div class="nophoto">No photo</div>') +
    (mainHidden
      ? '<p class="hiddenby">The main photo is hidden from the public. They see the newest photo of this cat that isn\'t hidden, or no photo if every one is. See <a href="#photos">All photos</a>.</p>'
      : "");
  const clipped = records.sterilised.clippedTipSightings;

  const overview =
    main +
    (cat.description ? `<p>${esc(cat.description)}</p>` : "") +
    "<h2>What the public sees</h2>" +
    `<p class="public">${esc(publicStatusText(v.publicStatus))}</p>` +
    "<h2>What we know about this cat</h2>" +
    '<p class="hint">Team only. How we got to what the public sees.</p>' +
    guardianMarkNotice(v, byId, shown) +
    recordBlock(
      "Life",
      records.lifeStatus,
      records.lifeStatus.value ? LIFE[records.lifeStatus.value] : "Not known",
      (records.lifeStatus.notSeenSince
        ? row("Not seen since", time(records.lifeStatus.notSeenSince, day(records.lifeStatus.notSeenSince)))
        : "") +
        (records.lifeStatus.presumedDeceased
          ? row(
              "Note",
              "Not seen for over three years. The public sees “Not seen since…”, never that it may have died.",
            )
          : ""),
      byId,
      shown,
    ) +
    recordBlock(
      "Sterilised",
      records.sterilised,
      sterilisedText(records.sterilised),
      guardianConfirmed(records.sterilised, byId, shown) +
      row(
        "Clipped ear",
        clipped === 0
          ? "Not seen in any sighting"
          : esc(`Seen in ${clipped} sighting${clipped === 1 ? "" : "s"}`),
      ),
      byId,
      shown,
    ) +
    "<h3>Owner</h3><dl>" +
    row(
      "Owner",
      v.owner.has
        ? "Has an owner"
        : v.owner.orphanedHome
          ? "Has a home, but the owner deleted their data"
          : "No owner",
    ) +
    // D13: after an owner deletes their data the note and pin stay, with no
    // owner link, so show them whenever they are stored.
    (v.owner.has || v.owner.homeDescription || v.owner.homePin
      ? row(
          v.owner.has ? "Where the owner says the cat lives" : "Where the cat lives, from a past owner",
          v.owner.homeDescription ? esc(v.owner.homeDescription) : "No note",
        ) + (v.owner.homePin ? row("Home pin", position(v.owner.homePin.lat, v.owner.homePin.lng, { link: false })) : "")
      : "") +
    "</dl>" +
    "<h3>Colony</h3><dl>" +
    row(
      "Colony",
      v.colony
        ? `<a href="/api/team/colonies/${v.colony.id}">${esc(v.colony.name)}</a>` +
            (v.colony.wasName ? ` <span class="meta">(was “${esc(v.colony.wasName)}”)</span>` : "")
        : "Not in a colony",
    ) +
    "</dl>" +
    "<h2>First recorded</h2><dl>" +
    row("Where", position(cat.lat, cat.lng, { link: island })) +
    row("When", time(cat.createdAt)) +
    "</dl>";

  const sightings =
    `<h2>Sightings (${v.sightings.length})</h2>` +
    (v.sightings.length === 0
      ? '<p class="empty">No sightings yet.</p>'
      : '<ul class="sightings">' +
        v.sightings
          .map(
            (s) =>
              "<li>" +
              (s.photoUrl
                ? `<a href="${esc(s.photoUrl)}"><img class="thumb" src="${esc(s.photoUrl)}" alt="${esc(`Photo from the sighting on ${when(s.at)}`)}" loading="lazy"></a>`
                : '<span class="thumb nothumb">No photo</span>') +
              `<span>${time(s.at)}<br>${position(s.lat, s.lng, { link: island })}` +
              // SYC-415 spec §4.5: the matcher thought this spot's photos may be of more than one cat.
              (s.mixedCats ? '<br><span class="mixed">May show more than one cat</span>' : "") +
              `${sightingButtons(s.id, may)}</span></li>`,
          )
          .join("") +
        "</ul>");

  // After Hide or Restore, the message goes beside that photo (own keys only:
  // ?done=constructor must not reach Object.prototype).
  const photoNotice =
    opts.done && Object.hasOwn(PHOTO_DONE, opts.done)
      ? `<p class="notice" role="status">${esc(PHOTO_DONE[opts.done]!)}</p>`
      : "";
  const landed = v.photos.some((p) => p.publicId === opts.photo);
  const hiddenCount = v.photos.filter((p) => p.hidden).length;
  const photos =
    `<h2 id="photos">All photos (${v.photos.length})</h2>` +
    (landed ? "" : photoNotice) +
    (hiddenCount > 0
      ? `<p class="hint">${hiddenCount} hidden from the public. The team still sees ${hiddenCount === 1 ? "it" : "them"} here.</p>`
      : "") +
    (v.photos.length === 0
      ? '<p class="empty">No photos.</p>'
      : '<div class="gallery">' +
        v.photos
          .map((p, i) =>
            galleryItem(p, i, v.photos.length, cat.id, may, landed && p.publicId === opts.photo ? photoNotice : ""),
          )
          .join("") +
        "</div>");

  const history =
    `<h2 id="history">History (${v.history.length})</h2>` +
    '<p class="hint">Newest first. A change marked wrong stays here, crossed out, with what replaced it.</p>' +
    (v.history.length === 0
      ? '<p class="empty">No changes yet.</p>'
      : `<ol class="history">${(shown === null ? v.history : newest).map((s) => statementItem(s, byId, shown, may, atStatement && s.id === opts.at ? notice : "")).join("")}</ol>` +
        (shown === null
          ? ""
          : `<p class="more"><a class="tap" href="?history=all#history">Show all ${v.history.length}</a></p>`));

  return renderPage({
    title: cat.name,
    active: "cats",
    personName,
    beforeTitle: '<p class="back"><a href="/api/team/cats">&larr; Find another cat</a></p>',
    afterTitle: `<p class="syrline">${esc(cat.syr)}</p>`,
    mainClass: "wide",
    body:
      sideBySide(overview, correctionForms(v, may, formsNotice, opts.colonies)) +
      renderAppearanceSection(v, may, opts.done) +
      sightings +
      photos +
      history,
  });
}

export function renderNoSuchCat(personName: string): string {
  return renderPage({
    title: "No such cat",
    active: "cats",
    personName,
    body: '<p>There is no cat with that number.</p><p><a href="/api/team/cats">Find a cat</a></p>',
  });
}
