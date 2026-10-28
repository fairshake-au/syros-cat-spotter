import { BOLD_OFF, BOLD_ON, type MergeLoad, type MergeScreen, type MergeSide } from "../mergeScreen";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { MERGE_FORM, MERGE_SCREEN, mergeHref } from "./mergeLinks";

// The merge screen (which-cat-is-which.md §4.1; SYC-59 PR 4.2): server-drawn,
// no script, every value escaped. Choosing the other cat is a search (a GET)
// and a link; "Merge" is a POST form to MERGE_FORM, which answers with this
// page again and the words of a refusal, or sends the team to the cat that
// stays, where History shows the merge with Undo merge.

export interface MergePageOptions {
  personName: string;
  /** What the address asked for, carried through every link and the form. */
  ask: { a: number; b?: number; survivor?: number; q: string };
  /** Why the last try didn't happen, in words (a refusal), with a link when the words point to a cat. */
  problem?: { message: string; link?: { href: string; label: string } };
  /** What was filled in, kept when the page comes back. */
  kept?: { reasonText?: string };
}

const catHref = (id: number) => `/api/team/cats/${id}`;

/** A line of words with the screen's bold marks: escaped first, then the marks become <b>. */
const words = (text: string) => esc(text).split(BOLD_ON).join("<b>").split(BOLD_OFF).join("</b>");

const thumbs = (urls: readonly string[], alt: string) =>
  urls.map((u) => `<img src="${esc(u)}" alt="${esc(alt)}" loading="lazy" width="64" height="64">`).join("");

/** One side of the comparison: name, photos and the facts the team compares. */
function column(side: MergeSide, role: "stays" | "goes" | "here"): string {
  const fact = (label: string, value: string) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`;
  const roleWords = { stays: "This record stays", goes: "This record becomes part of the other", here: "The cat you opened" }[role];
  return (
    `<section class="mergecol${role === "stays" ? " stays" : ""}">` +
    `<h3><a class="catlink" href="${esc(catHref(side.id))}">${esc(side.name)}</a> <span class="syr">${esc(side.syr)}</span></h3>` +
    `<p class="meta">${roleWords} · on our records since ${esc(side.since)}</p>` +
    (side.photoUrls.length > 0
      ? `<div class="photos">${thumbs(side.photoUrls, `A photo of ${side.name}`)}</div>`
      : '<p class="empty">No photos.</p>') +
    "<dl>" +
    fact("Sightings", String(side.sightings)) +
    fact("Colony", side.colony ?? "No colony") +
    fact("Sterilised", side.sterilised) +
    fact("Living", side.life) +
    fact("Owner", side.owner ? "Has an owner" : "No owner") +
    fact("Followers", String(side.followers)) +
    "</dl></section>"
  );
}

/** "Which record stays?": the answer, its reason, and the switch when there is one. */
function whichStays(s: MergeScreen, o: MergePageOptions): string {
  const a = o.ask.a;
  const b = o.ask.b!;
  return (
    "<h2>Which record stays?</h2>" +
    `<p class="chosen"><b>${esc(s.stays.name)}</b>'s record stays. It keeps its name, SYR number, main photo, map spot, colour and markings. ` +
    `${esc(s.goes.name)} becomes “also known as”.</p>` +
    (s.limit ? `<p class="hint">${esc(s.limit)}</p>` : "") +
    (s.canSwitch
      ? `<p><a class="tap" href="${esc(mergeHref({ a, b, survivor: s.goes.id }))}">Keep ${esc(s.goes.name)}'s record instead</a></p>`
      : "")
  );
}

/** The form that merges: why, What happens, the warnings, Merge. */
function mergeForm(s: MergeScreen, o: MergePageOptions): string {
  const field = (name: string, value: string) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
  return (
    `<form method="post" action="${MERGE_FORM}" class="mergeform">` +
    field("a", String(o.ask.a)) +
    field("b", String(o.ask.b)) +
    field("survivor", String(s.stays.id)) +
    field("n0", String(s.expectedCounts[0])) +
    field("n1", String(s.expectedCounts[1])) +
    '<div class="whatmoves"><h2>What happens</h2>' +
    `<ul class="happens">${s.whatHappens.map((l) => `<li>${words(l)}</li>`).join("")}</ul></div>` +
    s.warnings.map((w) => `<p class="warn" role="note">${esc(w)}</p>`).join("") +
    '<label class="label" for="merge-why">Why? A short reason, for example “Same face markings and torn left ear”</label>' +
    `<input class="text" id="merge-why" name="reasonText" required maxlength="500" autocomplete="off" value="${esc(o.kept?.reasonText ?? "")}">` +
    '<button type="submit" class="primary wide">Merge</button></form>'
  );
}

function chooseOther(load: Extract<MergeLoad, { kind: "choose" }>, o: MergePageOptions): string {
  const a = o.ask.a;
  const search =
    `<form method="get" action="${MERGE_SCREEN}" class="movesearch" role="search">` +
    `<input type="hidden" name="a" value="${a}">` +
    '<label class="label" for="merge-q">Search by name or SYR number</label>' +
    `<input class="text" id="merge-q" name="q" type="search" maxlength="60" autocomplete="off" value="${esc(o.ask.q)}">` +
    '<button type="submit">Search</button></form>';
  const list =
    load.results.cats.length === 0
      ? `<h3>${esc(load.results.heading)}</h3><p class="empty">No cats to show.</p>`
      : `<h3>${esc(load.results.heading)}</h3><ul class="moveresults">` +
        load.results.cats
          .map(
            (c) =>
              "<li>" +
              (c.thumbnailUrl ? `<img src="${esc(c.thumbnailUrl)}" alt="" loading="lazy" width="56" height="56">` : '<span class="nophoto">No photo</span>') +
              `<span class="rname"><b>${esc(c.name)}</b> <span class="syr">${esc(c.syr)}</span>${c.away ? `<span class="meta">${esc(c.away)}</span>` : ""}</span>` +
              `<a class="tap choose" href="${esc(mergeHref({ a, b: c.id }))}">Choose<span class="sr"> ${esc(c.name)}</span></a></li>`,
          )
          .join("") +
        "</ul>";
  return (
    `<h2>Which cat is ${esc(load.a.name)} the same as?</h2>` +
    `<div class="mergecols">${column(load.a, "here")}</div>` +
    (load.note ? `<p class="notice" role="alert">${esc(load.note)}</p>` : "") +
    search +
    list
  );
}

export function renderMergePage(load: Extract<MergeLoad, { kind: "ok" | "choose" }>, o: MergePageOptions): string {
  const problem = o.problem
    ? `<p class="notice" role="alert">${esc(o.problem.message)} Nothing was merged.` +
      (o.problem.link ? ` <a href="${esc(o.problem.link.href)}">${esc(o.problem.link.label)}</a>` : "") +
      "</p>"
    : "";
  const back = `<p><a class="tap" href="${esc(catHref(o.ask.a))}">Back to ${esc(load.kind === "ok" ? (load.screen.sides[0].name) : load.a.name)}</a></p>`;
  if (load.kind === "choose") {
    return renderPage({ title: "Same cat as…", active: "cats", personName: o.personName, body: back + problem + chooseOther(load, o) });
  }
  const s = load.screen;
  return renderPage({
    title: `Merge ${s.goes.name} into ${s.stays.name}`,
    active: "cats",
    personName: o.personName,
    body:
      back +
      problem +
      `<div class="mergecols">${column(s.stays, "stays")}${column(s.goes, "goes")}</div>` +
      `<p><a class="tap" href="${esc(mergeHref({ a: o.ask.a }))}">Choose a different cat</a></p>` +
      whichStays(s, o) +
      (s.block
        ? `<p class="notice" role="alert">${esc(s.block)} Nothing can be merged until then.</p>` +
          `<p>${s.sides.map((x) => `<a class="tap" href="${esc(catHref(x.id))}">Open ${esc(x.name)}</a>`).join(" ")}</p>`
        : mergeForm(s, o)),
  });
}

/** Nothing to merge from this address: the words, and where to go instead. */
export function renderMergeStopPage(
  personName: string,
  stop: { message: string; link?: { href: string; label: string } },
  backCat: number | null,
): string {
  return renderPage({
    title: "Can't merge this",
    active: "cats",
    personName,
    body:
      `<p class="notice" role="alert">${esc(stop.message)} Nothing was merged.</p>` +
      (stop.link ? `<p><a class="tap" href="${esc(stop.link.href)}">${esc(stop.link.label)}</a></p>` : "") +
      (backCat !== null ? `<p><a class="tap" href="${esc(catHref(backCat))}">Back to the cat</a></p>` : '<p><a class="tap" href="/api/team/cats">Back to Cats</a></p>'),
  });
}
