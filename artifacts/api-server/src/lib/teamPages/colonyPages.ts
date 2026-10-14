import type { Capability } from "../capabilities";
import type { ColonyHistoryEntry, ColonyRow, ColonyView } from "../teamColonies";
import { COLONY_NAME_MAX, COLONY_NOTES_MAX, GUARDIAN_NAME_MAX } from "../teamColonies";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { t, type WordKey } from "./words";

// The team's Colonies screens (SYC-209 PR 2.1; spec §2.6, §2.7, §8).
// Server-drawn, no scripts. Every value a person typed (a colony's name, a
// guardian's name, notes) goes through escapeHtml; the fixed words come from
// words.ts and go through it too.

const w = (key: WordKey) => esc(t(key));

const colonyHref = (id: number) => `/api/team/colonies/${id}`;

/** Dates on Syros: the team reads them in Greek time. */
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Athens",
  });

const DONE: Record<string, WordKey> = {
  created: "done.created",
  saved: "done.saved",
  unchanged: "done.unchanged",
};

/** A fixed sentence for `?done=<key>`; any other key shows nothing. */
function banner(done: string | undefined): string {
  const key = done !== undefined ? DONE[done] : undefined;
  return key ? `<p class="notice" role="status">${w(key)}</p>` : "";
}

/** The note under every notes box (spec §7.4). */
const notesHint = () => `<p class="hint">${w("notes.hint")}</p>`;

// ── The list ───────────────────────────────────────────────────────────────

function colonyCard(c: ColonyRow): string {
  const guardian = c.guardianName
    ? `${w("colonies.guardian")}: ${esc(c.guardianName)}`
    : w("colonies.noGuardian");
  const formerly = c.matchedOldName
    ? `<span class="status">${w("colonies.formerly")}: ${esc(c.matchedOldName)}</span>`
    : "";
  return (
    `<li><a class="catrow" href="${esc(colonyHref(c.id))}"><span>` +
    `<strong>${esc(c.name)}</strong>` +
    `<span class="status">${guardian}</span>` +
    formerly +
    `<span class="status">${esc(String(c.siteCount))} ${w("colonies.sites").toLowerCase()} · ` +
    `${esc(String(c.catCount))} ${w("colonies.cats").toLowerCase()}</span>` +
    `</span></a></li>`
  );
}

function createForm(): string {
  return (
    `<div class="fixes"><details><summary>${w("create.open")}</summary>` +
    `<form method="post" action="/api/team/colonies">` +
    `<label class="label" for="new-name">${w("create.name")}</label>` +
    `<p class="hint">${w("create.nameHint")}</p>` +
    `<input class="text" id="new-name" name="name" type="text" required maxlength="${COLONY_NAME_MAX}" autocomplete="off">` +
    `<label class="label" for="new-guardian">${w("create.guardian")}</label>` +
    `<input class="text" id="new-guardian" name="guardianName" type="text" maxlength="${GUARDIAN_NAME_MAX}" autocomplete="off">` +
    `<label class="label" for="new-notes">${w("create.notes")}</label>` +
    `<textarea id="new-notes" name="notes" maxlength="${COLONY_NOTES_MAX}"></textarea>` +
    notesHint() +
    `<button type="submit">${w("create.button")}</button>` +
    `</form></details></div>`
  );
}

export function renderColoniesPage(opts: {
  query: string;
  colonies: ColonyRow[];
  personName: string;
  done?: string;
  canCreate: boolean;
}): string {
  const searching = opts.query.trim() !== "";
  const list =
    opts.colonies.length > 0
      ? `<ul class="cats">${opts.colonies.map(colonyCard).join("")}</ul>`
      : `<p class="empty">${w(searching ? "colonies.noMatch" : "colonies.empty")}</p>`;
  return renderPage({
    title: t("colonies.title"),
    active: "colonies",
    personName: opts.personName,
    body:
      banner(opts.done) +
      `<form class="search" method="get" action="/api/team/colonies" role="search">` +
      `<label class="label" for="colony-q">${w("colonies.searchLabel")}</label>` +
      `<div class="searchrow"><input id="colony-q" name="q" type="search" value="${esc(opts.query)}" maxlength="200" autocomplete="off">` +
      `<button type="submit">${w("colonies.searchButton")}</button></div></form>` +
      (searching ? `<p><a class="tap" href="/api/team/colonies">${w("colonies.showAll")}</a></p>` : "") +
      list +
      (opts.canCreate ? createForm() : ""),
  });
}

// ── One colony ─────────────────────────────────────────────────────────────

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

const quoted = (v: string | null) => (v === null || v === "" ? esc(t("history.nobody")) : `“${esc(v)}”`);

function centreText(v: unknown): string {
  const c = v as { lat?: unknown; lng?: unknown } | null | undefined;
  return c && typeof c.lat === "number" && typeof c.lng === "number"
    ? esc(`${c.lat}, ${c.lng}`)
    : esc(t("colony.noCentre"));
}

/** What a history row says, as trusted HTML built from fixed words and esc. */
function describe(e: ColonyHistoryEntry): string {
  if (e.redacted) return w("history.removed");
  const b = e.before ?? {};
  const a = e.after ?? {};
  switch (e.kind) {
    case "colony_created":
      return `${w("history.created")}: ${quoted(str(a["name"]))}`;
    case "colony_renamed":
      return `${w("history.renamed")}: ${quoted(str(b["name"]))} → ${quoted(str(a["name"]))}`;
    case "guardian_changed":
      return `${w("history.guardian")}: ${quoted(str(b["guardianName"]))} → ${quoted(str(a["guardianName"]))}`;
    case "colony_notes_changed":
      return w("history.notes");
    case "colony_centre_changed":
      return `${w("history.centre")}: ${centreText(b["centre"])} → ${centreText(a["centre"])}`;
    default:
      return esc(e.kind.replace(/_/g, " "));
  }
}

function historyList(history: ColonyHistoryEntry[]): string {
  if (history.length === 0) return `<p class="empty">${w("colony.noHistory")}</p>`;
  return (
    `<ol class="history">` +
    history
      .map(
        (e) =>
          `<li class="statement"><p>${describe(e)}</p>` +
          `<p class="meta">${w("history.by")} ${esc(e.by)} · <time datetime="${esc(e.at)}">${esc(day(e.at))}</time></p></li>`,
      )
      .join("") +
    `</ol>`
  );
}

function catList(cats: ColonyView["cats"]): string {
  if (cats.length === 0) return `<p class="empty">${w("colony.noCats")}</p>`;
  return (
    `<ul class="cats">` +
    cats
      .map((c) => {
        const thumb = c.photoUrl
          ? `<img class="thumb" src="${esc(c.photoUrl)}" alt="" loading="lazy">`
          : `<span class="thumb nothumb">${w("colony.noPhoto")}</span>`;
        return (
          `<li><a class="catrow" href="/api/team/cats/${c.id}">${thumb}` +
          `<span><strong>${esc(c.name)}</strong> <span class="syr">${esc(c.syr)}</span></span></a></li>`
        );
      })
      .join("") +
    `</ul>`
  );
}

function editForm(v: ColonyView, may: (c: Capability) => boolean): string {
  const rename = may("rename_colony")
    ? `<label class="label" for="edit-name">${w("colony.rename")}</label>` +
      `<input class="text" id="edit-name" name="name" type="text" required maxlength="${COLONY_NAME_MAX}" value="${esc(v.name)}" autocomplete="off">`
    : "";
  return (
    `<div class="fixes"><details><summary>${w("colony.editTitle")}</summary>` +
    `<form method="post" action="${esc(colonyHref(v.id))}">` +
    rename +
    `<label class="label" for="edit-guardian">${w("create.guardian")}</label>` +
    `<input class="text" id="edit-guardian" name="guardianName" type="text" maxlength="${GUARDIAN_NAME_MAX}" value="${esc(v.guardianName ?? "")}" autocomplete="off">` +
    `<label class="label" for="edit-notes">${w("create.notes")}</label>` +
    `<textarea id="edit-notes" name="notes" maxlength="${COLONY_NOTES_MAX}">${esc(v.notes ?? "")}</textarea>` +
    notesHint() +
    `<label class="label" for="edit-lat">${w("colony.centreLat")}</label>` +
    `<input class="text" id="edit-lat" name="lat" type="text" inputmode="decimal" value="${v.lat !== null ? esc(String(v.lat)) : ""}" autocomplete="off">` +
    `<label class="label" for="edit-lng">${w("colony.centreLng")}</label>` +
    `<input class="text" id="edit-lng" name="lng" type="text" inputmode="decimal" value="${v.lng !== null ? esc(String(v.lng)) : ""}" autocomplete="off">` +
    `<p class="hint">${w("colony.centreHint")}</p>` +
    `<button type="submit">${w("colony.save")}</button>` +
    `</form></details></div>`
  );
}

export function renderColonyPage(
  v: ColonyView,
  personName: string,
  opts: { may: (c: Capability) => boolean; done?: string },
): string {
  const sites =
    v.sites.length === 0
      ? `<p class="empty">${w("colony.noSites")}</p>`
      : `<ul class="refs">${v.sites.map((s) => `<li>${esc(s.name)}</li>`).join("")}</ul>`;
  const summary =
    `<dl>` +
    `<dt>${w("colonies.guardian")}</dt><dd>${v.guardianName ? esc(v.guardianName) : w("colonies.noGuardian")}</dd>` +
    `<dt>${w("colonies.sites")}</dt><dd>${esc(String(v.siteCount))}</dd>` +
    `<dt>${w("colonies.cats")}</dt><dd>${esc(String(v.catCount))}</dd>` +
    `<dt>${w("colony.centre")}</dt><dd>${v.lat !== null && v.lng !== null ? esc(`${v.lat}, ${v.lng}`) : w("colony.noCentre")}</dd>` +
    `</dl>`;
  const notes =
    `<h2>${w("colony.notes")}</h2>` +
    (v.notes ? `<p class="note">${esc(v.notes)}</p>` : `<p class="empty">${w("colony.noNotes")}</p>`);
  return renderPage({
    title: v.name,
    active: "colonies",
    personName,
    beforeTitle: `<p class="back"><a href="/api/team/colonies">${w("colony.back")}</a></p>`,
    body:
      banner(opts.done) +
      summary +
      (opts.may("edit_colony") ? editForm(v, opts.may) : "") +
      `<h2>${w("colony.sitesTitle")}</h2>` +
      sites +
      `<h2>${w("colony.catsTitle")}</h2>` +
      catList(v.cats) +
      notes +
      `<h2>${w("colony.historyTitle")}</h2>` +
      historyList(v.history),
  });
}

export function renderNoSuchColony(personName: string): string {
  return renderPage({
    title: t("none.title"),
    active: "colonies",
    personName,
    body: `<p>${w("none.body")}</p><p><a href="/api/team/colonies">${w("problem.backToColonies")}</a></p>`,
  });
}

/** "Already used by [colony]", with a link to it, for the team. */
export function renderNameTaken(
  personName: string,
  holder: { id: number; name: string } | null,
  back: { href: string; label: string },
): string {
  return renderPage({
    title: t("taken.title"),
    active: "colonies",
    personName,
    body:
      (holder
        ? `<p>${w("taken.before")} <a href="${esc(colonyHref(holder.id))}"><strong>${esc(holder.name)}</strong></a>. ${w("taken.after")}</p>`
        : `<p>${w("taken.generic")} ${w("taken.after")}</p>`) +
      `<p>${w("problem.nothingChanged")}</p>` +
      `<p><a class="tap" href="${esc(back.href)}">${esc(back.label)}</a></p>`,
  });
}

/** A short page saying what was wrong, with a way back. */
export function renderColonyProblem(
  personName: string,
  message: string,
  back: { href: string; label: string },
): string {
  return renderPage({
    title: t("problem.title"),
    active: "colonies",
    personName,
    body:
      `<p>${esc(message)} ${w("problem.nothingChanged")}</p>` +
      `<p><a class="tap" href="${esc(back.href)}">${esc(back.label)}</a></p>`,
  });
}
