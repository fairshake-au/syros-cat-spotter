import type { UndoSighting, UndoScreen } from "../undoMergeScreen";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { undoForm } from "./mergeLinks";

// The undo screen (which-cat-is-which.md §4.4; SYC-59 PR 4.2): server-drawn,
// no script, every value escaped. It asks why, says what undoing does, lists
// Mimi's sightings that go back, and lists the later sightings with a tick
// box each ("Tick any that are Mimi."). "Undo merge" posts a form to
// `undoForm`, which answers with this page again and the words of a refusal,
// or sends the team to Mimi's page.

export interface UndoPageOptions {
  personName: string;
  /** Why the last try didn't happen, in words (a refusal). */
  problem?: { message: string };
  /** What was filled in, kept when the page comes back. */
  kept?: { reasonText?: string; ticked?: readonly number[] };
}

const catHref = (id: number) => `/api/team/cats/${id}`;

const dayTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Athens" });

const thumbs = (urls: readonly string[], alt: string) =>
  urls.map((u) => `<img src="${esc(u)}" alt="${esc(alt)}" loading="lazy" width="72" height="72">`).join("");

function seen(s: UndoSighting): string {
  return `${esc(dayTime(s.at))} · ${esc(s.place)}`;
}

function goingBack(s: UndoScreen): string {
  if (s.goesBack.length === 0) return "";
  return (
    `<h2>Going back to ${esc(s.mimi.name)}</h2><ul class="movelist">` +
    s.goesBack
      .map(
        (g) =>
          `<li><div class="compare">${thumbs(g.photoUrls, `Photo from the sighting on ${dayTime(g.at)}`)}</div><span class="meta">${seen(g)}</span></li>`,
      )
      .join("") +
    "</ul>"
  );
}

function tickList(s: UndoScreen, o: UndoPageOptions): string {
  if (s.tickable.length === 0) return "";
  const ticked = new Set(o.kept?.ticked ?? []);
  return (
    `<fieldset class="why"><legend class="label">Tick any that are ${esc(s.mimi.name)}.</legend>` +
    '<p class="hint">These were filed under the other cat after the merge, or moved again by the team. Ticked ones are moved to ' +
    `${esc(s.mimi.name)} with the undo. The rest stay where they are.</p>` +
    '<ul class="undolist">' +
    s.tickable
      .map(
        (t) =>
          "<li><div>" +
          `<label class="tick"><input type="checkbox" name="tick" value="${t.id}"${ticked.has(t.id) ? " checked" : ""}> ` +
          `<span>${seen(t)}<span class="sr"> (sighting ${t.id})</span></span></label>` +
          `<p class="meta">${esc(t.why)}</p>` +
          `<div class="compare">${thumbs(t.photoUrls, `Photo from the sighting on ${dayTime(t.at)}`)}</div></div></li>`,
      )
      .join("") +
    "</ul>" +
    (s.tickableMore > 0
      ? `<p class="hint">and ${s.tickableMore} more not shown here (the newest ${s.tickable.length} are listed).</p>`
      : "") +
    "</fieldset>"
  );
}

export function renderUndoPage(s: UndoScreen, o: UndoPageOptions): string {
  return renderPage({
    title: `Undo the merge of ${s.mimi.name}`,
    active: "cats",
    personName: o.personName,
    body:
      `<p><a class="tap" href="${esc(catHref(s.agatha.id))}">Back to ${esc(s.agatha.name)}</a></p>` +
      (o.problem ? `<p class="notice" role="alert">${esc(o.problem.message)} Nothing was undone.</p>` : "") +
      `<h2>Undo the merge of ${esc(s.mimi.name)} into ${esc(s.agatha.name)}</h2>` +
      `<p class="meta">Merged on ${esc(day(s.merged.at))}${s.merged.reasonText ? `: “${esc(s.merged.reasonText)}”` : ""}</p>` +
      `<form method="post" action="${undoForm(s.mergeId)}" class="mergeform">` +
      '<div class="whatmoves"><h2>What happens</h2>' +
      `<ul class="happens">${s.willDo.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>` +
      goingBack(s) +
      tickList(s, o) +
      '<label class="label" for="undo-why">Why? A short reason, for example “They turned out to be two cats”</label>' +
      `<input class="text" id="undo-why" name="reasonText" required maxlength="500" autocomplete="off" value="${esc(o.kept?.reasonText ?? "")}">` +
      '<button type="submit" class="primary wide">Undo merge</button></form>',
  });
}

/** Nothing to undo from this address: the words, and where to go instead. */
export function renderUndoStopPage(personName: string, stop: { message: string; link?: { href: string; label: string } }): string {
  return renderPage({
    title: "Can't undo this",
    active: "cats",
    personName,
    body:
      `<p class="notice" role="alert">${esc(stop.message)} Nothing was undone.</p>` +
      (stop.link ? `<p><a class="tap" href="${esc(stop.link.href)}">${esc(stop.link.label)}</a></p>` : "") +
      '<p><a class="tap" href="/api/team/cats">Back to Cats</a></p>',
  });
}
