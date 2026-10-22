import type { DerivedCatStatus } from "../catHelpers";
import { keptLine, type KeptFields } from "./signedOutPage";
import type { Confidence, LifeStatusValue } from "../resolve";
import type {
  TeamCatView,
  TeamPhoto,
  TeamStatement,
} from "../teamCatView";
import { EAR_TIP_NOT_CLIPPED, FOOD_AND_WATER_OUT } from "../teamCatView";
import type { Capability } from "../capabilities";
import type { QueueReport } from "../welfareQueue";
import type { IssueReport } from "../issues/queue";
import { reasonLabel } from "../issues/alertEmail";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { openMapLink, place } from "./position";
import { t } from "./words";
import { renderAppearanceSection } from "./appearancePage";
import { byWhom, coatPhraseOf, renderCatFacts, statementHref, vaccineWord, type Shown } from "./catFacts";

export type { Shown };
import type { VisitLine } from "../vetVisits";
import { euroText } from "../euros";
import { DID_WORDS, PAID_WORDS } from "./vetVisitForm";
import { fitView, renderMap, type MapMarker } from "./map";
import { BANDS, pointOnView } from "../mapTiles/geometry";
import { rowMenu } from "./rowMenu";
import { placeLabel } from "../areas/placeLabel";

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
// company, and the page must never have both. Since SYC-396 PR 1.4 they sit in
// the sighting's "More" menu (spec §7.3).
const sightingButtons = (sightingId: number, may: (c: Capability) => boolean): string[] => [
  may("add_feeding_site")
    ? `<form method="post" action="/api/team/sites/from-sighting" class="sightact"><input type="hidden" name="sightingId" value="${sightingId}"><button type="submit">${esc(t("sighting.makeSite"))}</button></form>`
    : "",
  may("view_exact_location")
    ? `<form method="post" action="/api/team/sites/map-at-sighting#map" class="sightact"><input type="hidden" name="sightingId" value="${sightingId}"><button type="submit">${esc(t("sighting.showOnMap"))}</button></form>`
    : "",
];

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

const statementLink = (id: number, shown: Shown) =>
  `<a href="${statementHref(id, shown)}">#${id}</a>`;


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

/**
 * "{name} has died" (SYC-513, spec §6): at the top of the summary when the
 * cat's status is "No longer with us" and nothing disagrees. A cat guardian's
 * mark in the last 30 days has its own notice instead, so the page never says
 * the same thing twice.
 */
function deathNotice(v: TeamCatView, byId: Map<number, TeamStatement>, shown: Shown): string {
  const life = v.records.lifeStatus;
  if (life.value !== "deceased" || life.conflictingStatementIds.length > 0) return "";
  if (v.recentGuardianMark?.status === "deceased") return "";
  const id = life.supportingStatementIds[0];
  const s = id === undefined ? undefined : byId.get(id);
  if (!s) return "";
  const happened = day(s.observedAt) !== day(s.createdAt) ? `, about ${time(s.observedAt, day(s.observedAt))}` : "";
  return (
    `<p class="notice" role="note"><strong>${esc(v.cat.name)} has died</strong>${happened}. ` +
    `Recorded by ${esc(byWhom(s))} on ${time(s.createdAt, day(s.createdAt))}.` +
    (s.reason ? ` How we know: ${esc(s.reason.trim().replace(/[.!?]+$/, ""))}.` : "") +
    ` If this is a mistake, use <strong>Mark wrong</strong> on it in the history. ` +
    `<a href="${statementHref(s.id, shown)}">Go to it</a></p>`
  );
}

/** Today on Syros, for a date box's max. */
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Athens" });

const LIFE_ORDER: LifeStatusValue[] = ["street", "homed", "in_care", "deceased"];

const reasonInput = (id: string, label = "Why", value?: string) =>
  `<label class="label" for="${id}">${esc(label)}</label>` +
  `<input class="text" id="${id}" name="reason" required maxlength="500" autocomplete="off"${value !== undefined ? ` value="${esc(value)}"` : ""}>`;

/** A fold that starts open when its form was filled in again (SYC-516 C3). */
const fold = (open: boolean) => `<details${open ? " open" : ""}>`;

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

/**
 * The capability "Mark wrong" under this statement needs on this page, as
 * wrongForm decides it; null when the page draws no such form here.
 */
function wrongFormNeeds(s: TeamStatement): Capability | null {
  const c = s.correction;
  if (!c || c.kind === "appearance") return null;
  if (c.kind === "ear_tip_clipped" || c.kind === "sterilised") return "set_sterilisation";
  if (c.kind === "colony") return "assign_cat_to_colony";
  return "set_life_status";
}

/** "Mark wrong" under a standing statement (PR 4), when this person may. */
function wrongForm(s: TeamStatement, may: (c: Capability) => boolean, kept?: KeptFields): string {
  const c = s.correction;
  const why = kept?.["reason"];
  if (!c) return "";
  // Colour and markings are marked wrong in the Appearance section (one form
  // per statement on the page, SYC-2 PR 3.1).
  if (c.kind === "appearance") return "";
  const action = `/api/team/statements/${s.id}/wrong`;
  const id = `w${s.id}`;
  if (c.kind === "ear_tip_clipped") {
    if (!may("set_sterilisation")) return "";
    return (
      `${fold(kept !== undefined)}<summary>Mark wrong</summary><form method="post" action="${action}">` +
      '<input type="hidden" name="choice" value="not_clipped">' +
      '<p class="hint">The cat goes back to Not known yet, unless something else says otherwise.</p>' +
      reasonInput(`${id}-why`, "Why it isn't a clip", why) +
      "<button type=\"submit\">Mark wrong: it's not a clip</button></form></details>"
    );
  }
  if (c.kind === "colony") {
    if (!may("assign_cat_to_colony")) return "";
    // No choice to make: the server works out what stands instead.
    return (
      `${fold(kept !== undefined)}<summary>Mark wrong</summary><form method="post" action="${action}">` +
      '<input type="hidden" name="choice" value="colony_previous">' +
      '<p class="hint">The cat goes back to the colony it was in before this, or to no colony if there was none.</p>' +
      reasonInput(`${id}-why`, undefined, why) +
      '<button type="submit">Mark wrong</button></form></details>'
    );
  }
  if (c.kind === "sterilised") {
    if (!may("set_sterilisation")) return "";
    const to = c.now === true ? "sterilised_no" : "sterilised_yes";
    const toText = c.now === true ? "Not sterilised" : "Sterilised";
    return (
      `${fold(kept !== undefined)}<summary>Mark wrong</summary><form method="post" action="${action}">` +
      `<input type="hidden" name="choice" value="${to}">` +
      `<p>It should say: <strong>${esc(toText)}</strong></p>` +
      reasonInput(`${id}-why`, undefined, why) +
      '<button type="submit">Mark wrong</button></form></details>'
    );
  }
  if (!may("set_life_status")) return "";
  return (
    `${fold(kept !== undefined)}<summary>Mark wrong</summary><form method="post" action="${action}">` +
    '<fieldset><legend class="label">It should say</legend>' +
    lifeChoices("choice", `${id}-to`, c.now) +
    "</fieldset>" +
    dateInput(`${id}-date`, "Date it happened", "(needed for “No longer with us”)") +
    reasonInput(`${id}-why`, undefined, why) +
    '<button type="submit">Mark wrong</button></form></details>'
  );
}

function statementItem(
  s: TeamStatement,
  byId: Map<number, TeamStatement>,
  shown: Shown,
  may: (c: Capability) => boolean = () => false,
  notice = "",
  kept?: KeptFields,
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
    wrongForm(s, may, kept) +
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
  ownerRemovedKept: "Saved. The owner is removed. The cat is still recorded as no longer with us. Nobody was told.",
  ownerGone: "This cat has no owner now, so there was nothing to remove. Nothing was changed.",
  lifeOwnerKept: "Saved. This cat still has an owner. Ask the team if the owner should be removed.",
  colony: "Saved. The colony is added to the history below.",
  colonyOut: "Saved. The cat is out of its colony. This is added to the history below.",
  colonyAlready: "The cat was already there, so nothing was changed.",
  visit: "Saved. The vet visit is below, and what it recorded is in the history.",
  visitWrong: "Saved. The vet visit and everything it recorded are marked wrong.",
  visitAlready: "This visit was already undone. Nothing was changed.",
  visitReason: "Say why the visit is wrong, in up to 500 characters. Nothing was changed.",
  died: "Saved. The cat is recorded as no longer with us.",
  diedAlready: "This cat is already recorded as no longer with us. Nothing was changed.",
};

/** The messages that sit at the top of the page, not in "Update this cat". */
const TOP_DONE = new Set(["died", "diedAlready"]);

/** The messages that sit beside the Vet visits list. */
const VISIT_DONE = new Set(["visit", "visitWrong", "visitAlready", "visitReason"]);

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
  /** "Now", for "3 days ago" and the history's dates; tests pin it. */
  now?: Date;
  /**
   * The Cats grid or Map address the person came from, filters and all
   * (SYC-522), from `cameFromCats`. Left out: "Find another cat" to the plain list.
   */
  back?: string;
  /**
   * The cat's standing vet visits, newest first (SYC-396 PR 3.1a). Without
   * `view_vet_costs` the caller leaves the cost and who paid out of each.
   */
  visits?: VisitLine[];
  /**
   * SYC-44 PR 7.1 (spec §5.3): this cat's "Report an issue" reports, from
   * issueStripFor, which answers null for anyone without `view_welfare_queue`.
   * Null or left out: no strip at all, not even its heading.
   */
  issues?: { reports: IssueReport[]; total: number } | null;
  /**
   * A form filled in again after signing in (SYC-516 C3): its key
   * (`name:<cat>`, `life:<cat>`, `sterilised:<cat>`, `wrong:<statement>`)
   * and what was typed.
   */
  kept?: { formKey: string; fields: KeptFields };
}

/** The form keys renderCatPage can fill in again for this cat (SYC-516 C3). */
export function catPageFormKeys(
  v: TeamCatView,
  may: (c: Capability) => boolean,
): (formKey: string) => boolean {
  // Only the forms this page actually draws for this viewer (the same checks
  // as correctionForms and wrongForm), so a row is never used up unseen.
  const own = new Set<string>();
  if (may("rename_cat")) own.add(`name:${v.cat.id}`);
  if (may("set_life_status")) own.add(`life:${v.cat.id}`);
  if (may("set_sterilisation")) own.add(`sterilised:${v.cat.id}`);
  // A statement whose "Mark wrong" is in the history list (colour and
  // markings have theirs in the Appearance section).
  for (const s of v.history) {
    const needs = wrongFormNeeds(s);
    if (needs !== null && may(needs)) own.add(`wrong:${s.id}`);
  }
  return (k) => own.has(k);
}

const ISSUE_STATE: Record<IssueReport["state"], string> = {
  new: "New",
  looking: "Looking at it",
  done: "Done",
  nothing_needed: "Nothing needed",
};

/**
 * "Reports about this cat" (spec §5.3): the cat's issue reports, newest
 * first, each linking to its row in the Queue. Team only, and drawn only when
 * there are some. The reporter is never named: there is nothing to name.
 */
function issueStrip(strip: { reports: IssueReport[]; total: number } | null | undefined): string {
  if (!strip || strip.total === 0) return "";
  const items = strip.reports
    .map(
      (i) =>
        "<li>" +
        // ?open=: the Queue opens this row even when it's a folded, closed
        // one (review of 7.1, finding 6; SYC-519), with no notice.
        `<a href="/api/team?open=${esc(encodeURIComponent(i.id))}#r-${esc(encodeURIComponent(i.id))}">${esc(reasonLabel(i.reason))}</a> ` +
        `<span class="tag state">${esc(ISSUE_STATE[i.state])}</span>` +
        (i.photo?.hidden ? ' <span class="tag hiddennow">Photo hidden</span>' : "") +
        ` <span class="meta">${time(i.at)}</span>` +
        (i.others > 0 ? ` <span class="meta">· ${esc(i.others === 1 ? "1 other open report like it" : `${i.others} other open reports like it`)}</span>` : "") +
        "</li>",
    )
    .join("");
  return (
    `<section id="issue-strip" class="issues"><h2>Reports about this cat (${strip.total})</h2>` +
    '<p class="hint">Problems the public reported with this cat\'s photos, name or page. Team only.</p>' +
    `<ul class="hplain">${items}</ul>` +
    (strip.total > strip.reports.length
      ? `<p class="empty">Showing the newest ${strip.reports.length} of ${strip.total}.</p>`
      : "") +
    "</section>"
  );
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
  kept?: { formKey: string; fields: KeptFields },
): string {
  const base = `/api/team/cats/${v.cat.id}`;
  const keptFor = (form: string) => (kept?.formKey === `${form}:${v.cat.id}` ? kept.fields : undefined);
  const life = keptFor("life");
  const ster = keptFor("sterilised");
  const rename = keptFor("name");
  const forms: string[] = [];
  // Recorded as died and nothing disagrees: no "This cat has died" button,
  // and Remove owner offers only "Still no longer with us" (SYC-513, spec §7).
  const dead =
    v.records.lifeStatus.value === "deceased" && v.records.lifeStatus.conflictingStatementIds.length === 0;
  if (may("set_life_status")) {
    forms.push(
      `${fold(life !== undefined)}<summary>Update where the cat lives</summary><form method="post" action="${base}/life-status">` +
        '<fieldset><legend class="label">The cat…</legend>' +
        lifeChoices("status", "ls", null, ["street", "homed", "in_care"]) +
        "</fieldset>" +
        // Owned cat (spec §7, SYC-362 D2): no box. Saving anything but "has a
        // home" asks first, on its own page, before the owner is removed.
        ((v.owner.has || v.owner.orphanedHome) && may("remove_owner")
          ? '<p class="hint">This cat has an owner. Saving anything but “Has a home” asks you first whether to remove the owner.</p>'
          : "") +
        dateInput("ls-date", "Date it happened", "(leave blank for today)") +
        reasonInput("ls-why", undefined, life?.["reason"]) +
        '<button type="submit">Save</button></form></details>',
    );
  }
  if (may("set_sterilisation")) {
    forms.push(
      `${fold(ster !== undefined)}<summary>Update whether sterilised</summary><form method="post" action="${base}/sterilisation">` +
        '<p class="warn">A clipped ear seen in a photo is never proof. Use this only when Syros Cats or a vet knows.</p>' +
        '<fieldset><legend class="label">The cat is…</legend>' +
        '<label class="choice" for="st-yes"><input type="radio" id="st-yes" name="sterilised" value="yes" required> Sterilised</label>' +
        '<label class="choice" for="st-no"><input type="radio" id="st-no" name="sterilised" value="no" required> Not sterilised</label>' +
        "</fieldset>" +
        dateInput("st-date", "When it was done", "(optional)") +
        '<label class="label" for="st-clinic">Clinic or vet <span class="hint">(optional)</span></label>' +
        '<input class="text" id="st-clinic" name="clinic" maxlength="100" autocomplete="off">' +
        reasonInput("st-why", "How we know", ster?.["reason"]) +
        '<button type="submit">Save</button></form></details>',
    );
  }
  if (may("assign_cat_to_colony")) forms.push(colonyForm(v, colonies));
  if (may("rename_cat")) {
    forms.push(
      `${fold(rename !== undefined)}<summary>Rename the cat</summary><form method="post" action="${base}/name">` +
        '<label class="label" for="rn-name">New name</label>' +
        `<input class="text" id="rn-name" name="name" required maxlength="60" value="${esc(rename?.["name"] ?? v.cat.name)}" autocomplete="off" spellcheck="false">` +
        reasonInput("rn-why", undefined, rename?.["reason"]) +
        '<button type="submit">Rename</button></form></details>',
    );
  }
  if ((v.owner.has || v.owner.orphanedHome) && may("remove_owner") && may("set_life_status")) {
    forms.push(
      `<details><summary>Remove owner</summary><form method="post" action="${base}/remove-owner">` +
        '<p class="hint">Ends this claim. The owner stops seeing the exact spot and getting alerts. Nobody is told.</p>' +
        (dead
          ? '<fieldset><legend class="label">The cat now…</legend>' +
            '<label class="choice" for="ro-keep"><input type="radio" id="ro-keep" name="status" value="keep" required checked> Still no longer with us</label>' +
            "</fieldset>"
          : '<fieldset><legend class="label">The cat now…</legend>' +
            lifeChoices("status", "ro", null, ["street", "in_care"], "street") +
            "</fieldset>" +
            '<p class="hint">If the cat has died, use “This cat has died” instead.</p>' +
            dateInput("ro-date", "Date it happened", "(leave blank for today)")) +
        reasonInput("ro-why") +
        '<button type="submit" class="risky">Remove owner</button></form></details>',
    );
  }
  if (may("set_life_status") && !dead) {
    forms.push(
      `<form method="get" action="${base}/died" class="diedform"><button type="submit">This cat has died</button></form>`,
    );
  }
  // Log a vet visit (spec §7.2): the main action, full width, above the rest.
  const vet = may("log_vet_visit")
    ? `<form method="get" action="${base}/vet-visit" class="vetvisit"><button type="submit" class="primary wide">Log a vet visit</button></form>`
    : "";
  if (forms.length === 0) return vet ? '<h2 id="corrections">Update this cat</h2>' + notice + vet : notice;
  return (
    '<h2 id="corrections">Update this cat</h2>' +
    notice +
    vet +
    `<div class="fixes">${forms.join("")}</div>` +
    // How changes work, folded into a short note you can open (spec §7.2), in #192's words.
    '<details class="hownote"><summary>How changes work</summary>' +
    '<p class="hint">Every change is saved with your name. Nothing is deleted. A change with an older date won\'t override a newer one. To undo a change, use <strong>Mark wrong</strong> on it in the history below.</p></details>'
  );
}

/**
 * The summary and "Update this cat" side by side on a wide screen, one under
 * the other on a phone (spec §7.1–7.2). Without the forms, the summary alone.
 */
function summaryAndActions(summary: string, fixes: string): string {
  if (!fixes.includes('id="corrections"')) return `<div class="catsummary"><div>${summary}</div></div>` + fixes;
  return `<div class="catsummary"><div>${summary}</div><div class="catactions">${fixes}</div></div>`;
}

// ── The history's routine sightings (spec §7.3) ─────────────────────────────

/**
 * A routine row: something a spotter's sighting said that means all is well,
 * "Food and water were out" or "Ear tip not clipped". "No food or water" and
 * "Couldn't tell" are never folded under "looking well". Status, colony,
 * colour, name, notes, welfare reports and vet visits are never routine, nor
 * a clipped ear (it counts towards "Probably"), nor anything corrected or
 * correcting.
 */
export function isRoutine(s: TeamStatement): boolean {
  if (s.author.kind !== "spotter") return false;
  if (s.replacedBy.length > 0 || s.replaces != null || s.movedTo || s.movedFrom) return false;
  if (s.kind === "food_and_water") return s.said === FOOD_AND_WATER_OUT;
  return s.kind === "ear_tip" && s.correction === null && s.said === EAR_TIP_NOT_CLIPPED;
}

type HistoryPart = { one: TeamStatement } | { run: TeamStatement[] };

/** The history in order, with each run of two or more routine rows as one part. */
export function groupHistory(rows: readonly TeamStatement[]): HistoryPart[] {
  const parts: HistoryPart[] = [];
  let run: TeamStatement[] = [];
  const flush = () => {
    if (run.length === 1) parts.push({ one: run[0]! });
    else if (run.length > 1) parts.push({ run });
    run = [];
  };
  for (const s of rows) {
    if (isRoutine(s)) run.push(s);
    else {
      flush();
      parts.push({ one: s });
    }
  }
  flush();
  return parts;
}

const dayMonth = (iso: string, withYear: boolean) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "Europe/Athens",
  });

const yearOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { year: "numeric", timeZone: "Europe/Athens" });

/**
 * "Seen 19 times by spotters between 29 Jul and 24 Sep, looking well". Counted
 * by sighting: one sighting can say two routine things. The year is added
 * when the run isn't all in this year.
 */
export function runWords(run: readonly TeamStatement[], now: Date): string {
  const times = new Set(run.map((s) => (s.sightingId === null ? `row ${s.id}` : `sighting ${s.sightingId}`))).size;
  // The earliest and latest dates seen. The history is in the order sightings
  // were matched, which isn't always the order they were seen.
  const seen = run.map((s) => s.observedAt).sort((a, b) => Date.parse(a) - Date.parse(b));
  const first = seen[0]!;
  const last = seen[seen.length - 1]!;
  const thisYear = yearOf(now.toISOString());
  const withYear = yearOf(first) !== thisYear || yearOf(last) !== thisYear;
  const from = dayMonth(first, withYear);
  const to = dayMonth(last, withYear);
  if (times === 1) return `Seen once by a spotter on ${to}, looking well`;
  return from === to
    ? `Seen ${times} times by spotters on ${to}, looking well`
    : `Seen ${times} times by spotters between ${from} and ${to}, looking well`;
}

// ── The small map of the cat's sightings (spec §7.1) ────────────────────────

/** How many sightings the small map numbers: the newest, so it stays readable. */
export const MAP_SIGHTINGS = 30;

/**
 * The cat's sightings on the same composed map picture as the rest of the
 * dashboard, numbered in time order (1 is the oldest shown), each marker a
 * link to its row in Sightings. No script; no position in any address.
 */
function sightingsMap(v: TeamCatView): string {
  if (v.sightings.length === 0) return "";
  const shown = v.sightings.slice(0, MAP_SIGHTINGS).reverse();
  const markers: MapMarker[] = shown.map((s, i) => ({
    lat: s.lat,
    lng: s.lng,
    n: i + 1,
    look: "seen",
    label: `Sighting ${i + 1}, ${when(s.at)}`,
    href: `#sg-${s.id}`,
  }));
  const more = v.sightings.length > shown.length;
  const view = fitView(shown);
  let map: string;
  try {
    map = renderMap({ mode: "view", view, markers, controls: false });
  } catch (e) {
    // Only a picture that can't be signed (no session key) is shown as "not
    // available", with the rest of the page (spec §13). Anything else is a bug.
    if (!(e instanceof Error && e.message.includes("TEAM_SESSION_KEYS"))) throw e;
    return '<p class="hint catmap">The map isn\'t available right now. The sightings are listed below.</p>';
  }
  // Sightings too far apart for one picture are said, never silently dropped.
  const drawn = shown.filter((s) => pointOnView(view, BANDS[0].size, s) !== null).length;
  return (
    '<div class="catmap">' +
    map +
    `<p class="hint">${
      more
        ? `The newest ${shown.length} of ${v.sightings.length} sightings, numbered oldest first.`
        : `Sightings numbered oldest first.`
    }${
      drawn < shown.length
        ? ` ${shown.length - drawn} ${shown.length - drawn === 1 ? "is" : "are"} too far from the others to fit on this map; see Sightings below.`
        : ""
    }</p>` +
    // The island Map, opened on this cat's numbered trail (PR 1.5). Only the
    // cat's number is in the address: never a position or a name.
    `<p class="maplink"><a class="tap" href="/api/team/cats?view=map&amp;focus=${v.cat.id}">Open the full map</a></p></div>`
  );
}

/** Any other photos as a thin strip under the main one (spec §7.1). */
function photoStrip(v: TeamCatView): string {
  const others = v.photos.filter((p) => p.url !== v.cat.mainPhotoUrl);
  if (others.length === 0) return "";
  return (
    '<ul class="photostrip" aria-label="Other photos">' +
    others
      .slice(0, 8)
      .map(
        (p, i) =>
          `<li><a href="#p-${esc(p.publicId)}"><img src="${esc(`${p.url}/small`)}" alt="${esc(`Other photo ${i + 1}`)}" loading="lazy" width="56" height="56"></a></li>`,
      )
      .join("") +
    (others.length > 8 ? `<li><a class="more" href="#photos">+${others.length - 8}</a></li>` : "") +
    "</ul>"
  );
}


/** What a visit did, in words: "Sterilised, vaccinated (Rabies)". */
export function visitDidWords(l: Pick<VisitLine, "did" | "vaccines" | "treatedNote">): string {
  return l.did
    .map((d, i) => {
      const w = i === 0 ? DID_WORDS[d] : DID_WORDS[d].toLowerCase();
      if (d === "vaccinated" && l.vaccines?.length) return `${w} (${l.vaccines.map(vaccineWord).join(", ")})`;
      if (d === "treated" && l.treatedNote) return `${w} (${l.treatedNote})`;
      return w;
    })
    .join(", ");
}

function visitItem(l: VisitLine, may: (c: Capability) => boolean): string {
  const money =
    "costEur" in l
      ? `<br><span class="meta">${l.costEur == null ? "Cost not recorded" : esc(euroText(l.costEur))}` +
        (l.paidBy ? ` · paid by ${esc(PAID_WORDS[l.paidBy].replace(/^A /, "a ").replace(/^The /, "the "))}` : "") +
        (l.costReason ? `<br>Why the cost was different: ${esc(l.costReason)}` : "") +
        "</span>"
      : "";
  const wrong = may("log_vet_visit")
    ? `<details><summary>Mark the visit wrong</summary><form method="post" action="/api/team/vet-visits/${l.visitId}/wrong">` +
      '<p class="hint">Everything this visit recorded is marked wrong with it.</p>' +
      reasonInput(`vw${l.visitId}-why`) +
      '<button type="submit">Mark the visit wrong</button></form></details>'
    : "";
  return (
    `<li id="vv-${l.visitId}" class="statement">` +
    `<strong>${time(l.date, day(l.date))}</strong>: ${esc(visitDidWords(l))}` +
    `<br>${esc(l.clinicName)} · logged by ${esc(l.by)}` +
    money +
    (l.note ? `<br><span class="meta">${esc(l.note)}</span>` : "") +
    wrong +
    "</li>"
  );
}

/**
 * Where "back" goes from a cat page: the Cats grid or Map the person just
 * left, with its filters (SYC-522). Takes the Referer header (the dashboard
 * sends `Referrer-Policy: same-origin`) but keeps only its path and query,
 * and only when the path is exactly the Cats page, so no other site can
 * make the link point anywhere else. Anything else: undefined.
 */
export function cameFromCats(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  let u: URL;
  try {
    u = new URL(referer);
  } catch {
    return undefined;
  }
  if (u.pathname !== "/api/team/cats") return undefined;
  const q = new URLSearchParams(u.search);
  // A page of results or a report being tied is not a place to return to.
  q.delete("page");
  q.delete("tie");
  const qs = q.toString();
  return `/api/team/cats${qs ? `?${qs}` : ""}`;
}

function backToCats(back: string | undefined): string {
  if (!back) return '<p class="back"><a href="/api/team/cats">&larr; Find another cat</a></p>';
  const words = new URLSearchParams(back.split("?")[1] ?? "").get("view") === "map" ? "Back to the map" : "Back to the cats";
  return `<p class="back"><a href="${esc(back)}">&larr; ${words}</a></p>`;
}

export function renderCatPage(
  v: TeamCatView,
  personName: string,
  opts: CatPageOptions = {},
): string {
  const { cat, records } = v;
  const may = opts.may ?? (() => false);
  const island = opts.island === true;
  const now = opts.now ?? new Date();
  // The message goes where the page lands: beside the statement after a
  // correction, at the top of "Update this cat" after the other forms.
  // Own keys only: ?done=constructor must not reach Object.prototype.
  const notice =
    opts.done && Object.hasOwn(DONE, opts.done)
      ? `<p class="notice" role="status">${esc(DONE[opts.done]!)}</p>`
      : "";
  const atStatement = opts.at !== undefined && v.history.some((h) => h.id === opts.at);
  const topDone = opts.done !== undefined && TOP_DONE.has(opts.done);
  const visitDone = opts.done !== undefined && VISIT_DONE.has(opts.done);
  const formsNotice = atStatement || topDone || visitDone ? "" : notice;
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
  const coat = coatPhraseOf(v);
  const main =
    (cat.mainPhotoUrl
      ? `<img class="photo catmain" src="${esc(cat.mainPhotoUrl)}" alt="${esc(`Photo of ${cat.name}${coat !== null ? `, ${coat}` : ""}`)}">`
      : '<div class="nophoto">No photo</div>') +
    (mainHidden
      ? '<p class="hiddenby">The main photo is hidden from the public. They see the newest photo of this cat that isn\'t hidden, or no photo if every one is. See <a href="#photos">All photos</a>.</p>'
      : "") +
    photoStrip(v);

  // The answer first (spec §7.1): photo, the facts, the small map, and what
  // the public sees in one line.
  const summary =
    main +
    (cat.description ? `<p>${esc(cat.description)}</p>` : "") +
    (topDone ? notice : "") +
    deathNotice(v, byId, shown) +
    guardianMarkNotice(v, byId, shown) +
    renderCatFacts(v, now, { byId, shown, island }) +
    sightingsMap(v) +
    `<p class="publicline">What the public sees: <span class="public">${esc(publicStatusText(v.publicStatus))}</span></p>`;

  // A compact list: date, place and thumbnail. The position, "Open map" and
  // the two buttons fold into each sighting's "More" menu (spec §7.3).
  const sightings =
    `<h2>Sightings (${v.sightings.length})</h2>` +
    (v.sightings.length === 0
      ? '<p class="empty">No sightings yet.</p>'
      : '<ul class="sightings">' +
        v.sightings
          .map(
            (s) =>
              `<li id="sg-${s.id}">` +
              (s.photoUrl
                ? `<a href="${esc(s.photoUrl)}"><img class="thumb" src="${esc(s.photoUrl)}" alt="${esc(`Photo from the sighting on ${when(s.at)}`)}" loading="lazy"></a>`
                : '<span class="thumb nothumb">No photo</span>') +
              `<span class="sightwhat">${time(s.at)}<br>${esc(placeLabel(s))}` +
              // SYC-415 spec §4.5: the matcher thought this spot's photos may be of more than one cat.
              (s.mixedCats ? '<br><span class="mixed">May show more than one cat</span>' : "") +
              rowMenu("More", `the sighting on ${when(s.at)}`, [
                ...(island ? [`<p class="meta">${openMapLink(s.lat, s.lng)}</p>`] : []),
                ...sightingButtons(s.id, may),
              ]) +
              "</span></li>",
          )
          .join("") +
        "</ul>");

  // Vet visits (spec §7.3): date, what was done, clinic and, for those who
  // may see it, the cost. Each can be marked wrong, which undoes everything
  // the visit recorded.
  const visitList = opts.visits ?? [];
  const visits =
    `<h2 id="vet-visits">Vet visits (${visitList.length})</h2>` +
    (visitDone ? notice : "") +
    (visitList.length === 0
      ? '<p class="empty">No vet visits recorded.</p>'
      : '<ol class="history visits">' + visitList.map((l) => visitItem(l, may)).join("") + "</ol>");

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

  const evidenceIds = new Set([
    ...records.lifeStatus.supportingStatementIds,
    ...records.lifeStatus.conflictingStatementIds,
    ...records.sterilised.supportingStatementIds,
    ...records.sterilised.conflictingStatementIds,
  ]);
  const keptWrong = (s: TeamStatement) => (opts.kept?.formKey === `wrong:${s.id}` ? opts.kept.fields : undefined);
  const item = (s: TeamStatement) =>
    statementItem(s, byId, shown, may, atStatement && s.id === opts.at ? notice : "", keptWrong(s));
  const historyItems = groupHistory(shown === null ? v.history : newest)
    .map((part) => {
      if ("one" in part) return item(part.one);
      // A run opens by itself when the page lands on one of its rows, or when
      // "Why we think so" or "Says otherwise" above links to one of them.
      const open = part.run.some((s) => (atStatement && s.id === opts.at) || evidenceIds.has(s.id));
      return (
        `<li class="statement routine"><details${open ? " open" : ""}><summary>${esc(runWords(part.run, now))}</summary>` +
        `<ol class="history">${part.run.map(item).join("")}</ol></details></li>`
      );
    })
    .join("");
  const history =
    `<h2 id="history">History (${v.history.length})</h2>` +
    '<p class="hint">Newest first. A change marked wrong stays here, crossed out, with what replaced it.</p>' +
    (v.history.length === 0
      ? '<p class="empty">No changes yet.</p>'
      : `<ol class="history">${historyItems}</ol>` +
        (shown === null
          ? ""
          : `<p class="more"><a class="tap" href="?history=all#history">Show all ${v.history.length}</a></p>`));

  return renderPage({
    title: cat.name,
    active: "cats",
    personName,
    beforeTitle: backToCats(opts.back),
    afterTitle: `<p class="syrline">${esc(cat.syr)}</p>`,
    mainClass: "wide",
    body:
      (opts.kept ? keptLine() : "") +
      summaryAndActions(summary, correctionForms(v, may, formsNotice, opts.colonies, opts.kept)) +
      issueStrip(opts.issues) +
      renderAppearanceSection(v, may, opts.done) +
      sightings +
      visits +
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
