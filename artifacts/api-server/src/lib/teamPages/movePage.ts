import type { MoveScreen } from "../moveScreen";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { MOVE_FORM, MOVE_SCREEN, moveHref, type MoveSource } from "./moveLinks";

// The move screen (which-cat-is-which.md §5.2; SYC-150 PR 3.3): server-drawn,
// no script, every value escaped. Choosing a cat is a search (a GET) and a
// link; "Move" is a POST form to MOVE_FORM, which answers with this page again
// and the words of a refusal, or sends the team back to the cat's History.

export interface MovePageOptions {
  personName: string;
  /** What the address asked for, carried through every link and the form. */
  ask: { cat: number; sightings: readonly number[]; source: MoveSource; report?: string; fresh: boolean; q: string; to?: number };
  /** Why the last try didn't happen, in words (a refusal), with a link when the words point to a cat. */
  problem?: { message: string; link?: { href: string; label: string } };
  /** What was filled in, kept when the page comes back. */
  kept?: { reason?: string; reasonText?: string; name?: string; letSpottersName?: boolean; mainPhoto?: string };
}

const REASONS: { value: string; label: string }[] = [
  { value: "different_markings", label: "Different markings" },
  { value: "two_cats", label: "Two cats in the photo" },
  { value: "wrong_pick", label: "Wrong cat picked" },
  { value: "other", label: "Other…" },
];

const dayTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });

const catHref = (id: number) => `/api/team/cats/${id}`;

const thumbs = (urls: readonly string[], alt: string, size = 72) =>
  urls.map((u) => `<img src="${esc(u)}" alt="${esc(alt)}" loading="lazy" width="${size}" height="${size}">`).join("");

/** "a", "a and b", "a, b, and c" (the spec's list in §5.2 has the comma). */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function hiddenFields(o: MovePageOptions): string {
  const a = o.ask;
  const field = (name: string, value: string) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
  return (
    field("cat", String(a.cat)) +
    field("s", a.sightings.join(",")) +
    field("source", a.source) +
    (a.report ? field("report", a.report) : "")
  );
}

/** The photos being moved, and the cat they are under now (§5.2 "At the top"). */
function top(s: MoveScreen): string {
  const moving = s.moving
    .map(
      (m) =>
        `<li><div class="compare">${thumbs(m.photoUrls, `Photo from the sighting on ${dayTime(m.at)}`)}</div>` +
        `<span class="meta">${esc(dayTime(m.at))} · ${esc(m.place)}</span></li>`,
    )
    .join("");
  const f = s.from;
  return (
    `<h2>${s.moving.length === 1 ? "Moving this sighting" : `Moving these ${s.moving.length} sightings`}</h2>` +
    `<ul class="movelist">${moving}</ul>` +
    `<h2>Filed under now</h2>` +
    `<p><a class="catlink" href="${esc(catHref(f.id))}">${esc(f.name)}</a> <span class="syr">${esc(f.syr)}</span></p>` +
    (f.mainPhotoUrl || f.recentPhotoUrls.length > 0
      ? `<div class="compare">${thumbs([...(f.mainPhotoUrl ? [f.mainPhotoUrl] : []), ...f.recentPhotoUrls], `A photo of ${f.name}`)}</div>`
      : "")
  );
}

/** "Which cat is it?": the search, the cats, and "It's a new cat". */
function choose(s: MoveScreen, o: MovePageOptions): string {
  const a = o.ask;
  const base = { cat: a.cat, sightings: a.sightings, source: a.source, report: a.report };
  const search =
    `<form method="get" action="${MOVE_SCREEN}" class="movesearch" role="search">${hiddenFields(o)}` +
    '<label class="label" for="move-q">Search by name or SYR number</label>' +
    `<input class="text" id="move-q" name="q" type="search" maxlength="60" autocomplete="off" value="${esc(a.q)}">` +
    '<button type="submit">Search</button></form>';
  const list = s.results
    ? `<h3>${esc(s.results.heading)}</h3>` +
      (s.results.cats.length === 0
        ? '<p class="empty">No cats to show.</p>'
        : '<ul class="moveresults">' +
          s.results.cats
            .map(
              (c) =>
                "<li>" +
                (c.thumbnailUrl ? `<img src="${esc(c.thumbnailUrl)}" alt="" loading="lazy" width="56" height="56">` : '<span class="nophoto">No photo</span>') +
                `<span class="rname"><b>${esc(c.name)}</b> <span class="syr">${esc(c.syr)}</span>${c.away ? `<span class="meta">${esc(c.away)}</span>` : ""}</span>` +
                `<a class="tap choose" href="${esc(moveHref({ ...base, to: c.id }))}">Choose<span class="sr"> ${esc(c.name)}</span></a></li>`,
            )
            .join("") +
          "</ul>")
    : "";
  return (
    "<h2>Which cat is it?</h2>" +
    (s.chooseNote ? `<p class="notice" role="alert">${esc(s.chooseNote)}</p>` : "") +
    search +
    list +
    `<p><a class="tap" href="${esc(moveHref({ ...base, fresh: true }))}">It's a new cat</a></p>`
  );
}

/** The form that moves: why, what moves, the main photo, the warnings, Move. */
function moveForm(s: MoveScreen, o: MovePageOptions): string {
  const a = o.ask;
  const k = o.kept ?? {};
  const base = { cat: a.cat, sightings: a.sightings, source: a.source, report: a.report };
  const where = s.chosen
    ? `<p class="chosen"><b>${esc(s.chosen.name)}</b> <span class="syr">${esc(s.chosen.syr)}</span> ` +
      `<a class="tap" href="${esc(moveHref(base))}">Choose a different cat</a></p>` +
      (s.chosen.thumbnailUrl ? `<div class="compare">${thumbs([s.chosen.thumbnailUrl], `A photo of ${s.chosen.name}`)}</div>` : "")
    : "";
  const fresh = a.fresh
    ? "<h2>It's a new cat</h2>" +
      `<p><a class="tap" href="${esc(moveHref(base))}">Choose an existing cat instead</a></p>` +
      '<label class="label" for="move-name">Name</label>' +
      `<input class="text" id="move-name" name="name" maxlength="60" autocomplete="off" value="${esc(k.name ?? "")}" aria-describedby="move-name-hint">` +
      '<p class="hint" id="move-name-hint">Type a name, or tick the box below and leave it blank.</p>' +
      `<label class="choice"><input type="checkbox" name="letSpottersName" value="1"${k.letSpottersName ? " checked" : ""}> Let spotters name it</label>` +
      '<p class="hint">With the tick, the new cat shows its SYR number until someone names it, and the spotter whose photo started it may name it.</p>'
    : "";
  const why =
    '<fieldset class="why"><legend class="label">Why?</legend>' +
    REASONS.map(
      (r, i) =>
        `<label class="choice"><input type="radio" name="reason" value="${r.value}"${i === 0 ? " required" : ""}${k.reason === r.value ? " checked" : ""}> ${esc(r.label)}</label>`,
    ).join("") +
    '<label class="label" for="move-why-text">Say what, if you chose “Other…”. You can add a few words to any reason.</label>' +
    `<input class="text" id="move-why-text" name="reasonText" maxlength="500" autocomplete="off" value="${esc(k.reasonText ?? "")}">` +
    "</fieldset>";
  const what =
    '<div class="whatmoves"><h2>What moves</h2>' +
    `<p>Moves to <b>${esc(s.chosen ? s.chosen.name : a.fresh ? "a new cat" : "the cat you choose")}</b>: ${esc(andList(s.whatMoves.items))}.</p>` +
    `<p>${esc(s.whatMoves.keeps)}</p>` +
    (s.whatMoves.points ? `<p>${esc(s.whatMoves.points)}</p>` : "") +
    "</div>";
  const main = s.mainPhoto
    ? `<fieldset class="mainphoto"><legend class="label">${esc(s.from.name)}'s main photo is moving. Choose the next one.</legend>` +
      '<div class="pickgrid">' +
      s.mainPhoto.choices
        .map(
          (c) =>
            `<label class="pick"><input type="radio" name="mainPhoto" value="${c.id}"${k.mainPhoto === String(c.id) ? " checked" : ""}>` +
            `<img src="${esc(c.url)}" alt="A photo of ${esc(s.from.name)}" loading="lazy" width="72" height="72"></label>`,
        )
        .join("") +
      "</div>" +
      `<label class="choice"><input type="radio" name="mainPhoto" value="0"${k.mainPhoto === "0" ? " checked" : ""}> No photo for now</label>` +
      "</fieldset>"
    : "";
  const warnings = s.warnings.map((w) => `<p class="warn" role="note">${esc(w)}</p>`).join("");
  return (
    where +
    `<form method="post" action="${MOVE_FORM}" class="moveform">` +
    hiddenFields(o) +
    (s.chosen ? `<input type="hidden" name="to" value="${s.chosen.id}">` : "") +
    (a.fresh ? '<input type="hidden" name="new" value="1">' : "") +
    fresh +
    why +
    what +
    main +
    warnings +
    '<button type="submit" class="primary wide">Move</button></form>'
  );
}

export function renderMovePage(s: MoveScreen, o: MovePageOptions): string {
  const chosen = s.chosen !== null || o.ask.fresh;
  return renderPage({
    title: "Move to the right cat",
    active: "cats",
    personName: o.personName,
    body:
      `<p><a class="tap" href="${esc(catHref(o.ask.cat))}">Back to ${esc(s.from.name)}</a></p>` +
      (o.problem
        ? `<p class="notice" role="alert">${esc(o.problem.message)} Nothing was moved.` +
          (o.problem.link ? ` <a href="${esc(o.problem.link.href)}">${esc(o.problem.link.label)}</a>` : "") +
          "</p>"
        : "") +
      top(s) +
      (chosen ? moveForm(s, o) : choose(s, o)),
  });
}

/** Nothing to move from this address: the words, and where each sighting is now. */
export function renderMoveStopPage(
  personName: string,
  stop: { message: string; now: { catId: number; name: string }[] },
  backCat: number | null,
): string {
  return renderPage({
    title: "Can't move this",
    active: "cats",
    personName,
    body:
      `<p class="notice" role="alert">${esc(stop.message)} Nothing was moved.</p>` +
      (stop.now.length > 0
        ? `<p>It is now filed under ${stop.now
            .map((n) => `<a href="${esc(catHref(n.catId))}">${esc(n.name)}</a>`)
            .join(", ")}.</p>`
        : "") +
      (backCat !== null ? `<p><a class="tap" href="${esc(catHref(backCat))}">Back to the cat</a></p>` : '<p><a class="tap" href="/api/team/cats">Back to Cats</a></p>'),
  });
}
