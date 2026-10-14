import type { DerivedCatStatus } from "../catHelpers";
import type { Confidence, LifeStatusValue } from "../resolve";
import type {
  TeamCatSearchResult,
  TeamCatView,
  TeamPhoto,
  TeamResolved,
  TeamStatement,
} from "../teamCatView";
import { QUERY_MAX } from "../teamCatView";
import type { Capability } from "../capabilities";
import type { QueueReport } from "../welfareQueue";
import { timeAgo } from "./queuePage";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";

// The team's "Cats" screens (SYC-43 part 2 plan, PR 3): finding a cat, and
// the team's page for one cat. Read-only. Server-drawn, no scripts. Every
// value goes through escapeHtml; the data comes only from lib/teamCatView.ts.

// The app's own English words (artifacts/cat-spotter/lib/i18n.ts), so the
// team reads the public line exactly as a spotter does.
const LIFE: Record<LifeStatusValue, string> = {
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

const place = (lat: number, lng: number) => {
  // Exact: the stored numbers as they are, never rounded.
  const here = `${lat}, ${lng}`;
  // A plain link: leaving the dashboard sends nothing until it is tapped.
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
  return `${esc(here)} &middot; <a class="tap" href="${esc(map)}" rel="noopener noreferrer">Open map</a>`;
};

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

function resultCard(c: TeamCatSearchResult): string {
  const thumb = c.thumbnailUrl
    ? `<img class="thumb" src="${esc(c.thumbnailUrl)}" alt="" loading="lazy">`
    : '<span class="thumb nothumb">No photo</span>';
  return (
    `<li><a class="catrow" href="${esc(catHref(c.id))}">${thumb}` +
    `<span><strong>${esc(c.name)}</strong> <span class="syr">${esc(c.syr)}</span>` +
    `<span class="status">${esc(publicStatusText(c.status))}</span></span></a></li>`
  );
}

/**
 * The search when it is choosing a cat for a welfare report (PR 5): the same
 * results, each with a plain "This is the cat" form posting to the tie route.
 * `report` is null when the id in the link matches no sent report.
 */
export interface TieMode {
  publicId: string;
  report: QueueReport | null;
  /** May this person tie? Without it the results are only for looking. */
  canTie: boolean;
}

function tieResultCard(c: TeamCatSearchResult, tie: TieMode & { report: QueueReport }): string {
  const thumb = c.thumbnailUrl
    ? `<img class="thumb" src="${esc(c.thumbnailUrl)}" alt="" loading="lazy">`
    : '<span class="thumb nothumb">No photo</span>';
  const current = tie.report.cat?.id === c.id;
  const action = current
    ? '<p class="hint">This report is already tied to this cat.</p>'
    : tie.canTie
      ? `<form method="post" action="/api/team/reports/${esc(encodeURIComponent(tie.publicId))}/cat">` +
        `<input type="hidden" name="catId" value="${c.id}">` +
        `<input type="hidden" name="expectedCatId" value="${tie.report.cat ? tie.report.cat.id : ""}">` +
        `<button type="submit" class="tiebtn">This is the cat</button></form>`
      : "";
  return (
    `<li class="tiecard"><div class="catrow">${thumb}` +
    `<span><a class="tap" href="${esc(catHref(c.id))}"><strong>${esc(c.name)}</strong></a> <span class="syr">${esc(c.syr)}</span>` +
    `<span class="status">${esc(publicStatusText(c.status))}</span></span></div>${action}</li>`
  );
}

export function renderCatSearchPage(
  query: string,
  results: TeamCatSearchResult[],
  personName: string,
  tie?: TieMode,
  now: Date = new Date(),
): string {
  const tieField = tie
    ? `<input type="hidden" name="tie" value="${esc(tie.publicId)}">`
    : "";
  const form =
    '<form class="search" method="get" action="/api/team/cats" role="search">' +
    tieField +
    '<label class="label" for="q">Name or SYR number</label>' +
    `<div class="searchrow"><input id="q" name="q" type="search" value="${esc(query)}" maxlength="${QUERY_MAX}"${query.trim() === "" ? " autofocus" : ""} autocomplete="off" autocapitalize="none" spellcheck="false">` +
    '<button type="submit">Find</button></div></form>';
  let body: string;
  if (query.trim() === "") {
    body = '<p class="empty">Type a name, or a number like SYR-0012.</p>';
  } else if (results.length === 0) {
    body =
      `<p class="empty">No cat matches “${esc(query)}” by name or SYR number.</p>` +
      '<p class="empty">Check the spelling, try fewer letters, or try the SYR number.</p>';
  } else {
    const more =
      results.length >= 30
        ? '<p class="empty">Showing the first 30. Type more of the name to narrow it.</p>'
        : "";
    const items =
      tie && tie.report
        ? results.map((c) => tieResultCard(c, { ...tie, report: tie.report! })).join("")
        : results.map(resultCard).join("");
    body = `<ul class="cats">${items}</ul>${more}`;
  }
  if (!tie) {
    return renderPage({ title: "Cats", active: "cats", personName, body: form + body });
  }
  const back = `/api/team#r-${encodeURIComponent(tie.publicId)}`;
  if (!tie.report) {
    return renderPage({
      title: "Which cat is this?",
      active: "queue",
      personName,
      body:
        '<p class="notice" role="status">That report couldn\'t be found.</p>' +
        '<p><a class="tap" href="/api/team">Back to the welfare queue</a></p>',
    });
  }
  const r = tie.report;
  const sev = r.severity === "urgent" ? "Urgent" : "Needs attention";
  const intro =
    `<p class="hint">Report: ${esc(sev)}${r.isLitter ? ", kittens" : ""}, sent ` +
    `${esc(timeAgo(r.at, now))}. ` +
    (r.cat
      ? `Now tied to ${esc(r.cat.name)}. Pick the right cat below.`
      : "Find the cat it is about, then tap “This is the cat”.") +
    " Nothing is sent to anyone.</p>";
  return renderPage({
    title: "Which cat is this?",
    active: "queue",
    personName,
    beforeTitle: `<p class="back"><a class="tap" href="${esc(back)}">Back to the report</a></p>`,
    body: intro + form + body,
  });
}

// ── The team's cat page ────────────────────────────────────────────────────

const statementLink = (id: number) => `<a href="#s-${id}">#${id}</a>`;

/**
 * The statements an answer rests on, in words: what was said, by whom and
 * when, each linking to its place in the history below.
 */
function statementRefs(ids: number[], byId: Map<number, TeamStatement>): string {
  if (ids.length === 0) return "Nothing yet";
  return (
    '<ul class="refs">' +
    ids
      .map((id) => {
        const s = byId.get(id);
        if (!s) return `<li>${statementLink(id)}</li>`;
        return (
          `<li><a href="#s-${id}">${esc(s.said)}</a> ` +
          `<span class="meta">(${esc(s.author.label)}, ${time(s.createdAt, day(s.createdAt))})</span></li>`
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
): string {
  return (
    `<h3>${esc(label)}</h3><dl>` +
    row("Records say", `${esc(valueText)} <span class="tag">${esc(CONFIDENCE[r.confidence])}</span>`) +
    row("As of", time(r.asOf, day(r.asOf))) +
    row("Based on", statementRefs(r.supportingStatementIds, byId)) +
    (r.conflictingStatementIds.length
      ? row("Disagrees", `<div class="bad">${statementRefs(r.conflictingStatementIds, byId)}</div>`)
      : "") +
    extra +
    "</dl>"
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
  const action = `/api/team/statements/${s.id}/wrong`;
  const id = `w${s.id}`;
  if (c.kind === "ear_tip_clipped") {
    if (!may("set_sterilisation")) return "";
    return (
      `<details><summary>That's not a clip</summary><form method="post" action="${action}">` +
      '<input type="hidden" name="choice" value="not_clipped">' +
      '<p class="hint">The cat goes back to Not known yet, unless something else says otherwise.</p>' +
      reasonInput(`${id}-why`, "Why it isn't a clip") +
      "<button type=\"submit\">That's not a clip</button></form></details>"
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
      '<button type="submit">Save the correction</button></form></details>'
    );
  }
  if (!may("set_life_status")) return "";
  return (
    `<details><summary>Mark wrong</summary><form method="post" action="${action}">` +
    '<fieldset><legend class="label">It should say</legend>' +
    lifeChoices("choice", `${id}-to`, c.now) +
    "</fieldset>" +
    dateInput(`${id}-date`, "Date the team knows of", "(needed for “No longer with us”)") +
    reasonInput(`${id}-why`) +
    '<button type="submit">Save the correction</button></form></details>'
  );
}

function statementItem(
  s: TeamStatement,
  byId: Map<number, TeamStatement>,
  may: (c: Capability) => boolean = () => false,
  notice = "",
): string {
  const replaced = s.replacedBy.length > 0;
  const said = replaced ? `<del>${esc(s.said)}</del>` : esc(s.said);
  const differs = Math.abs(Date.parse(s.observedAt) - Date.parse(s.createdAt)) > 60_000;
  const meta =
    `${esc(s.author.label)} · ${time(s.createdAt)}` +
    (differs ? ` · about ${time(s.observedAt)}` : "");
  const replacements = s.replacedBy
    .map((id) => byId.get(id))
    .filter((r): r is TeamStatement => r !== undefined)
    .map(
      (r) =>
        `<p class="replacement">Replaced by ${statementLink(r.id)}: ${esc(r.said)}` +
        (r.reason ? `. Why: ${esc(r.reason)}` : "") +
        ` <span class="meta">(${esc(r.author.label)}, ${time(r.createdAt)})</span></p>`,
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
      ? `<p class="meta">Corrects ${statementLink(s.replaces)}</p>`
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
    "</li>"
  );
}

/** What the page says after a correction, by the `done` the form sent back. */
const DONE: Record<string, string> = {
  life: "Saved. The life status is added to the history below.",
  sterilised: "Saved. The sterilisation is added to the history below.",
  wrong: "Saved. The correction is in the history below, with the statement it replaces.",
  renamed: "Saved. The new name is in the history below.",
  unchanged: "That is already the cat's name. Nothing was changed.",
  already: "Someone already corrected this. Here's what replaced it.",
  ownerRemoved: "Saved. The owner is removed and the cat's new status is in the history below. Nobody was told.",
  ownerGone: "This cat has no owner now, so there was nothing to remove. Nothing was changed.",
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
  const form = allowed
    ? `<form method="post" action="/api/team/photos/${encodeURIComponent(p.publicId)}/${action}">` +
      `<input type="hidden" name="cat" value="${catId}">` +
      `<button type="submit" class="${action}">${p.hidden ? "Restore" : "Hide from the public"}</button></form>`
    : "";
  const label = p.hidden
    ? `<p class="hiddenby">Hidden from the public by ${esc(p.hidden.by)}, ${time(p.hidden.at, day(p.hidden.at))}` +
      (p.hidden.reason ? `<br><span class="why">${esc(p.hidden.reason)}</span>` : "") +
      "</p>"
    : "";
  return (
    `<figure id="p-${esc(p.publicId)}"${p.hidden ? ' class="ishidden"' : ""}>` +
    `<a href="${esc(p.url)}"><img src="${esc(p.url)}" alt="${esc(`Photo ${i + 1} of ${total}${p.hidden ? ", hidden from the public" : ""}`)}" loading="lazy"></a>` +
    notice +
    label +
    form +
    "</figure>"
  );
}

/** The four correction forms (PR 4), each shown only to someone who may. */
function correctionForms(
  v: TeamCatView,
  may: (c: Capability) => boolean,
  notice = "",
): string {
  const base = `/api/team/cats/${v.cat.id}`;
  const forms: string[] = [];
  if (may("set_life_status")) {
    forms.push(
      `<details><summary>Say the life status</summary><form method="post" action="${base}/life-status">` +
        '<fieldset><legend class="label">The cat…</legend>' +
        lifeChoices("status", "ls", null) +
        "</fieldset>" +
        // Owned cat (spec §7): removing the owner is offered in the same step,
        // so a correction can't leave the cat stuck "street" with an owner.
        (v.owner.has && may("remove_owner")
          ? '<label class="choice" for="ls-owner"><input type="checkbox" id="ls-owner" name="removeOwner" value="1" checked> Also remove the owner</label>' +
            '<p class="hint">Ticked, an owner is removed unless the cat is saved as having a home. Nobody is told.</p>'
          : "") +
        dateInput("ls-date", "Date the team knows of", "(needed for “No longer with us”; leave empty for today)") +
        reasonInput("ls-why") +
        '<button type="submit">Save</button></form></details>',
    );
  }
  if (may("set_sterilisation")) {
    forms.push(
      `<details><summary>Say whether sterilised</summary><form method="post" action="${base}/sterilisation">` +
        '<p class="warn">A clipped ear seen in a photo is never proof. Use this only when Syros Cats or a vet knows.</p>' +
        '<fieldset><legend class="label">The cat is…</legend>' +
        '<label class="choice" for="st-yes"><input type="radio" id="st-yes" name="sterilised" value="yes" required> Sterilised</label>' +
        '<label class="choice" for="st-no"><input type="radio" id="st-no" name="sterilised" value="no" required> Not sterilised</label>' +
        "</fieldset>" +
        dateInput("st-date", "When it was done", "(optional)") +
        '<label class="label" for="st-clinic">Clinic or vet <span class="hint">(optional)</span></label>' +
        '<input class="text" id="st-clinic" name="clinic" maxlength="100" autocomplete="off">' +
        reasonInput("st-why", "How the team knows") +
        '<button type="submit">Save</button></form></details>',
    );
  }
  if (may("rename_cat")) {
    forms.push(
      `<details><summary>Rename the cat</summary><form method="post" action="${base}/name">` +
        '<label class="label" for="rn-name">New name</label>' +
        `<input class="text" id="rn-name" name="name" required maxlength="60" value="${esc(v.cat.name)}" autocomplete="off" spellcheck="false">` +
        reasonInput("rn-why") +
        '<button type="submit">Rename</button></form></details>',
    );
  }
  if (v.owner.has && may("remove_owner") && may("set_life_status")) {
    forms.push(
      `<details><summary>Remove owner</summary><form method="post" action="${base}/remove-owner">` +
        '<p class="hint">Ends this claim. The owner stops seeing the exact spot and getting alerts. Nobody is told.</p>' +
        '<fieldset><legend class="label">The cat now…</legend>' +
        lifeChoices("status", "ro", null, ["street", "in_care", "deceased"], "street") +
        "</fieldset>" +
        dateInput("ro-date", "Date the team knows of", "(needed for “No longer with us”)") +
        reasonInput("ro-why") +
        '<button type="submit">Remove owner</button></form></details>',
    );
  }
  if (forms.length === 0) return notice;
  return (
    '<h2 id="corrections">Correct the record</h2>' +
    notice +
    '<p class="hint">Each change is added to the history below, signed with your name. Nothing is deleted: to undo one, mark it wrong.</p>' +
    '<p class="hint">The statement with the latest “true on” date decides. If a statement below is simply wrong, use <strong>Mark wrong</strong> on it rather than adding a new one with an earlier date.</p>' +
    `<div class="fixes">${forms.join("")}</div>`
  );
}

export function renderCatPage(
  v: TeamCatView,
  personName: string,
  opts: CatPageOptions = {},
): string {
  const { cat, records } = v;
  const may = opts.may ?? (() => false);
  // The message goes where the page lands: beside the statement after a
  // correction, at the top of "Correct the record" after the other forms.
  // Own keys only: ?done=constructor must not reach Object.prototype.
  const notice =
    opts.done && Object.hasOwn(DONE, opts.done)
      ? `<p class="notice" role="status">${esc(DONE[opts.done]!)}</p>`
      : "";
  const atStatement = opts.at !== undefined && v.history.some((h) => h.id === opts.at);
  const formsNotice = atStatement ? "" : notice;
  const byId = new Map(v.history.map((s) => [s.id, s]));
  const mainHidden = v.photos.find((p) => p.source === "main")?.hidden ?? null;
  const main =
    (cat.mainPhotoUrl
      ? `<img class="photo catmain" src="${esc(cat.mainPhotoUrl)}" alt="Main photo of ${esc(cat.name)}">`
      : '<div class="nophoto">No photo</div>') +
    (mainHidden
      ? '<p class="hiddenby">The main photo is hidden from the public. They see the newest photo of this cat that isn\'t hidden, or no photo if every one is. See <a href="#photos">Photos</a>.</p>'
      : "");
  const clipped = records.sterilised.clippedTipSightings;

  const overview =
    main +
    (cat.description ? `<p>${esc(cat.description)}</p>` : "") +
    "<h2>What the public sees</h2>" +
    `<p class="public">${esc(publicStatusText(v.publicStatus))}</p>` +
    "<h2>What the records say</h2>" +
    '<p class="hint">Team only. How the answer above was worked out.</p>' +
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
    ) +
    recordBlock(
      "Sterilised",
      records.sterilised,
      sterilisedText(records.sterilised),
      row(
        "Clipped ear",
        clipped === 0
          ? "Not seen in any sighting"
          : esc(`Seen in ${clipped} sighting${clipped === 1 ? "" : "s"}`),
      ),
      byId,
    ) +
    "<h3>Owner</h3><dl>" +
    row("Owner", v.owner.has ? "Has an owner" : "No owner") +
    (v.owner.has
      ? row(
          "Where the owner says the cat lives",
          v.owner.homeDescription ? esc(v.owner.homeDescription) : "No note",
        ) + (v.owner.homePin ? row("Home pin", place(v.owner.homePin.lat, v.owner.homePin.lng)) : "")
      : "") +
    "</dl>" +
    "<h2>First recorded</h2><dl>" +
    row("Where", place(cat.lat, cat.lng)) +
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
              `<span>${time(s.at)}<br>${place(s.lat, s.lng)}</span></li>`,
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
    `<h2 id="photos">Photos (${v.photos.length})</h2>` +
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
    `<h2>What has been said (${v.history.length})</h2>` +
    '<p class="hint">Newest first. Nothing is ever deleted: a statement that was corrected stays, struck through, with what replaced it.</p>' +
    (v.history.length === 0
      ? '<p class="empty">Nothing has been said about this cat yet.</p>'
      : `<ol class="history">${v.history.map((s) => statementItem(s, byId, may, atStatement && s.id === opts.at ? notice : "")).join("")}</ol>`);

  return renderPage({
    title: cat.name,
    active: "cats",
    personName,
    beforeTitle: '<p class="back"><a href="/api/team/cats">&larr; Find another cat</a></p>',
    afterTitle: `<p class="syrline">${esc(cat.syr)}</p>`,
    body:
      overview +
      correctionForms(v, may, formsNotice) +
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
