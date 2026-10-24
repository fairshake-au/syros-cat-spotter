import type { AreaChange } from "../areas/areaHistory";
import type { AreaField } from "../areas/areaWrites";
import type { NamedArea } from "../areas/namedAreas";
import { escapeHtml as esc } from "./escape";
import { backLink, HOME_PATH } from "./backLink";
import { methodFold } from "./methodFold";
import { renderPage } from "./layout";
import { openMapLink } from "./position";

// The Areas page (SYC-396 PR 2.4; dashboard §3.3). The team's named areas:
// each one's centre and how many cats are nearest it, forms to add, rename,
// move or retire one, and the history of every change with who made it.
// Team-only (`edit_named_areas`). Positions go only into the page's text,
// through position.ts, and into form fields, which post in the body: never
// into one of our own addresses.

export const AREAS_PATH = "/api/team/areas";

export interface AreaRow extends NamedArea {
  /** Active cats (not "No longer with us") whose place is nearest this centre. */
  cats: number;
}

/** A form sent back with a problem: what was typed, and which field is wrong. */
export interface AreaFormAgain {
  op: "add" | "rename" | "move" | "retire" | "restore";
  /** The area a rename or move was for. */
  key?: string;
  field: AreaField;
  message: string;
  values: { name?: string; key?: string; lat?: string; lng?: string };
}

export interface AreasPageOptions {
  personName: string;
  /** The viewer's island-wide gate, for the Open map links (D9). */
  link: boolean;
  areas: readonly AreaRow[];
  /** Areas retired earlier, each with a "Bring back" button (SYC-482). */
  retired?: readonly NamedArea[];
  version: number;
  /** The version the first list made: its rows fold into one line in the history. */
  firstVersion: number;
  history: readonly AreaChange[];
  again?: AreaFormAgain;
  /** A change that just went through. */
  done?: string;
}

export const AREAS_DONE: Record<string, string> = {
  added: "The area was added.",
  renamed: "The area was renamed.",
  moved: "The area's centre was moved.",
  retired: "The area was retired.",
  restored: "The area is back on the list.",
};

const day = (d: Date) =>
  d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Athens" });

const when = (d: Date) =>
  d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Athens",
  });

/** One history line's words: "moved Kini's centre". */
function changeWords(c: AreaChange): string {
  const before = c.before?.name ?? c.after?.name ?? "an area";
  switch (c.kind) {
    case "area_added":
      return `added ${c.after?.name ?? "an area"}`;
    case "area_renamed":
      return `renamed ${before} to ${c.after?.name ?? "a new name"}`;
    case "area_moved":
      return `moved ${before}'s centre`;
    case "area_retired":
      return `retired ${before}`;
    case "restored":
      return `brought back ${before}`;
    default:
      return "changed an area";
  }
}

/** A problem shown beside its field, if it's this one's. */
const problem = (again: AreaFormAgain | undefined, op: string, key: string | undefined, field: AreaField) =>
  again && again.op === op && again.key === key && again.field === field
    ? `<p class="warn" role="alert" id="${esc(`${op}-${key ?? "new"}-${field}-err`)}">${esc(again.message)}</p>`
    : "";

/** The value to show in a field: what was typed if the form came back, else the default. */
const kept = (again: AreaFormAgain | undefined, op: string, key: string | undefined, field: keyof AreaFormAgain["values"], fallback: string) =>
  again && again.op === op && again.key === key && again.values[field] !== undefined ? again.values[field]! : fallback;

const isOpen = (again: AreaFormAgain | undefined, op: string, key?: string) =>
  again !== undefined && again.op === op && again.key === key;

const NAME_HINT = "Area names are shown to cat guardians. Use the place's name, never a person's.";

function input(
  id: string,
  label: string,
  name: string,
  value: string,
  opts: { hint?: string; invalid?: boolean; mode?: "decimal" } = {},
): string {
  return (
    `<label class="label" for="${esc(id)}">${esc(label)}</label>` +
    (opts.hint ? `<p class="hint">${esc(opts.hint)}</p>` : "") +
    `<input type="text" class="text" id="${esc(id)}" name="${esc(name)}" value="${esc(value)}"` +
    (opts.mode ? ` inputmode="${opts.mode}"` : "") +
    (opts.invalid ? ' aria-invalid="true"' : "") +
    ">"
  );
}

const CSS = `<style>
details.arearow{background:#fff;border:1px solid #d9d5ca;border-left:6px solid #0b5c6b;border-radius:8px;margin:8px 0;overflow-wrap:anywhere}
details.arearow>summary{cursor:pointer;min-height:48px;box-sizing:border-box;padding:6px 12px;display:flex;flex-wrap:wrap;align-items:center;gap:2px 10px;list-style:none}
details.arearow>summary::-webkit-details-marker{display:none}
details.arearow>summary strong{font-size:17px}
details.arearow .arebody{padding:0 12px 12px}
ul.retired li{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin:8px 0}
ul.retired button{min-height:44px;padding:0 16px}
</style>`;

function areaRow(a: AreaRow, o: AreasPageOptions): string {
  const k = a.key;
  const again = o.again;
  const bad = (op: string, f: AreaField) => again?.op === op && again.key === k && again.field === f;
  const rename =
    `<details${isOpen(again, "rename", k) ? " open" : ""}><summary>Rename</summary>` +
    `<form method="post" action="${AREAS_PATH}">` +
    '<input type="hidden" name="op" value="rename">' +
    `<input type="hidden" name="key" value="${esc(k)}">` +
    problem(again, "rename", k, "name") +
    problem(again, "rename", k, "area") +
    input(`rename-${k}`, "New name", "name", kept(again, "rename", k, "name", a.name), {
      hint: NAME_HINT,
      invalid: bad("rename", "name"),
    }) +
    `<button type="submit">Rename</button></form></details>`;
  // The centre is moved by tapping a map (SYC-517, 517-B). A problem the save
  // sent back still shows here, beside the link.
  const move =
    problem(again, "move", k, "area") +
    problem(again, "move", k, "lat") +
    problem(again, "move", k, "lng") +
    `<p><a class="tap" href="${AREAS_PATH}/${encodeURIComponent(k)}/centre">Move centre on a map</a></p>`;
  const retire =
    problem(again, "retire", k, "area") +
    `<form method="post" action="${AREAS_PATH}" class="inline">` +
    '<input type="hidden" name="op" value="retire">' +
    `<input type="hidden" name="key" value="${esc(k)}">` +
    `<button type="submit" class="risky">Retire</button></form>`;
  return (
    `<li><details class="arearow"${isOpen(again, "rename", k) || isOpen(again, "move", k) || isOpen(again, "retire", k) ? " open" : ""}>` +
    `<summary><strong>${esc(a.name)}</strong> <span class="meta">${a.cats === 1 ? "1 cat" : `${a.cats} cats`}</span></summary>` +
    `<div class="arebody">` +
    (o.link ? `<p class="meta">${openMapLink(a.lat, a.lng)}</p>` : "") +
    `<div class="fixes">${rename}${move}${retire}</div></div>` +
    "</details></li>"
  );
}

function addForm(o: AreasPageOptions): string {
  const again = o.again;
  const bad = (f: AreaField) => again?.op === "add" && again.field === f;
  return (
    `<div class="fixes"><details${isOpen(again, "add") ? " open" : ""}><summary>Add an area</summary>` +
    `<form method="post" action="${AREAS_PATH}/new">` +
    problem(again, "add", undefined, "name") +
    input("add-name", "Name", "name", kept(again, "add", undefined, "name", ""), {
      hint: NAME_HINT,
      invalid: bad("name"),
    }) +
    problem(again, "add", undefined, "key") +
    input("add-key", "Short key", "key", kept(again, "add", undefined, "key", ""), {
      hint: "Used in the Cats filters' web address. Small letters, numbers and dashes, like mega-gialos. It can't be changed later.",
      invalid: bad("key"),
    }) +
    // A centre that came back from the map's save and was refused shows here.
    problem(again, "add", undefined, "lat") +
    problem(again, "add", undefined, "lng") +
    `<p class="hint">Next you tap the area's centre on a map. You see the spot before anything is saved.</p>` +
    `<button type="submit">Choose the centre on the map</button></form></details></div>`
  );
}

/** Areas retired earlier, each with a button to bring it back. Empty: nothing. */
function retiredList(o: AreasPageOptions): string {
  const list = o.retired ?? [];
  if (list.length === 0) return "";
  const again = o.again;
  return (
    `<h2>Retired areas (${list.length})</h2>` +
    `<ul class="retired">` +
    list
      .map(
        (a) =>
          `<li><span><strong>${esc(a.name)}</strong></span> ` +
          `<form method="post" action="${AREAS_PATH}" class="inline">` +
          '<input type="hidden" name="op" value="restore">' +
          `<input type="hidden" name="key" value="${esc(a.key)}">` +
          problem(again, "restore", a.key, "area") +
          problem(again, "restore", a.key, "name") +
          `<button type="submit">Bring back</button></form></li>`,
      )
      .join("") +
    `</ul>`
  );
}

/**
 * The history, newest first. The rows the first list made fold into one line,
 * chosen by version (never by "no name": a later change whose author was
 * anonymised stays on its own line).
 */
export function historyList(history: readonly AreaChange[], firstVersion: number): string {
  if (history.length === 0) return '<p class="hint">No changes yet.</p>';
  const first = history.filter((c) => c.version <= firstVersion);
  const rest = history.filter((c) => c.version > firstVersion);
  const lines = rest.map(
    (c) =>
      `<li class="meta"><time datetime="${esc(c.at.toISOString())}">${esc(when(c.at))}</time> · ` +
      `${esc(c.who ?? "Syros Cats (the first list)")} · ${esc(changeWords(c))}</li>`,
  );
  if (first.length > 0) {
    // Newest first, and the seed's rows run from version 1 without gaps, so the
    // newest one's version is how many were set up, even when the history's row
    // limit has cut the older ones off.
    const at = first[first.length - 1]!.at;
    lines.push(
      `<li class="meta">${first[0]!.version} ${first[0]!.version === 1 ? "area" : "areas"} set up by Syros Cats, <time datetime="${esc(at.toISOString())}">${esc(day(at))}</time></li>`,
    );
  }
  return `<ol class="history">${lines.join("")}</ol>`;
}

/**
 * Can a problem be shown beside its own form? Not when the area it was about
 * is no longer listed (retired meanwhile), nor for a form the page doesn't
 * have: then it goes at the top (review of #245, F3).
 */
function placed(o: AreasPageOptions): boolean {
  const again = o.again;
  if (!again) return true;
  if (again.op === "add") return again.field !== "area";
  if (again.op === "restore") return (o.retired ?? []).some((a) => a.key === again.key);
  return o.areas.some((a) => a.key === again.key);
}

export function renderAreasPage(o: AreasPageOptions): string {
  const done = o.done !== undefined ? AREAS_DONE[o.done] : undefined;
  const loose = !placed(o) ? `<p class="warn" role="alert">${esc(o.again!.message)}</p>` : "";
  return renderPage({
    title: "Areas",
    active: null,
    personName: o.personName,
    beforeTitle: backLink(HOME_PATH, "Home"),
    body:
      (done ? `<p class="notice" role="status">${esc(done)}</p>` : "") +
      loose +
      CSS +
      addForm(o) +
      `<h2>The areas (${o.areas.length})</h2>` +
      `<ul class="cats">${o.areas.map((a) => areaRow(a, o)).join("")}</ul>` +
      retiredList(o) +
      '<h2 id="history">History</h2>' +
      historyList(o.history, o.firstVersion) +
      methodFold([
        "A place belongs to the area whose centre is nearest. More than 2 km from every centre is Off Syros. " +
          "Place labels and the Cats filters use this list within a minute of a change.",
        `Each change makes a new version. Reports name the version they used. This is version ${o.version}.`,
      ]),
  });
}
