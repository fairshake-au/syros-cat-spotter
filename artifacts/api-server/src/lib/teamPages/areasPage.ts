import type { AreaChange } from "../areas/areaHistory";
import type { AreaField } from "../areas/areaWrites";
import type { NamedArea } from "../areas/namedAreas";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { position, roundPos } from "./position";

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
  op: "add" | "rename" | "move" | "retire";
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
  version: number;
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
};

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
    input(`rename-${k}`, "New name", "name", kept(again, "rename", k, "name", a.name), { invalid: bad("rename", "name") }) +
    `<button type="submit">Rename</button></form></details>`;
  const move =
    `<details${isOpen(again, "move", k) ? " open" : ""}><summary>Move centre</summary>` +
    `<form method="post" action="${AREAS_PATH}">` +
    '<input type="hidden" name="op" value="move">' +
    `<input type="hidden" name="key" value="${esc(k)}">` +
    problem(again, "move", k, "area") +
    problem(again, "move", k, "lat") +
    input(`move-${k}-lat`, "Latitude", "lat", kept(again, "move", k, "lat", roundPos(a.lat)), {
      invalid: bad("move", "lat"),
      mode: "decimal",
    }) +
    problem(again, "move", k, "lng") +
    input(`move-${k}-lng`, "Longitude", "lng", kept(again, "move", k, "lng", roundPos(a.lng)), {
      invalid: bad("move", "lng"),
      mode: "decimal",
    }) +
    `<button type="submit">Move the centre</button></form></details>`;
  const retire =
    problem(again, "retire", k, "area") +
    `<form method="post" action="${AREAS_PATH}" class="inline">` +
    '<input type="hidden" name="op" value="retire">' +
    `<input type="hidden" name="key" value="${esc(k)}">` +
    `<button type="submit" class="risky">Retire</button></form>`;
  return (
    `<li class="statement"><h3>${esc(a.name)}</h3>` +
    `<p class="meta">Centre: ${position(a.lat, a.lng, { link: o.link })}</p>` +
    `<p class="meta">${a.cats === 1 ? "1 cat" : `${a.cats} cats`} nearest this centre</p>` +
    `<div class="fixes">${rename}${move}${retire}</div>` +
    "</li>"
  );
}

function addForm(o: AreasPageOptions): string {
  const again = o.again;
  const bad = (f: AreaField) => again?.op === "add" && again.field === f;
  return (
    `<div class="fixes"><details${isOpen(again, "add") ? " open" : ""}><summary>Add an area</summary>` +
    `<form method="post" action="${AREAS_PATH}">` +
    '<input type="hidden" name="op" value="add">' +
    problem(again, "add", undefined, "name") +
    input("add-name", "Name", "name", kept(again, "add", undefined, "name", ""), { invalid: bad("name") }) +
    problem(again, "add", undefined, "key") +
    input("add-key", "Short key", "key", kept(again, "add", undefined, "key", ""), {
      hint: "Used in the Cats filters' web address. Small letters, numbers and dashes, like mega-gialos. It can't be changed later.",
      invalid: bad("key"),
    }) +
    problem(again, "add", undefined, "lat") +
    input("add-lat", "Latitude of the centre", "lat", kept(again, "add", undefined, "lat", ""), {
      hint: "Like 37.44470. The centre must be on Syros.",
      invalid: bad("lat"),
      mode: "decimal",
    }) +
    problem(again, "add", undefined, "lng") +
    input("add-lng", "Longitude of the centre", "lng", kept(again, "add", undefined, "lng", ""), {
      hint: "Like 24.94170.",
      invalid: bad("lng"),
      mode: "decimal",
    }) +
    `<button type="submit">Add the area</button></form></details></div>`
  );
}

function historyList(history: readonly AreaChange[]): string {
  if (history.length === 0) return '<p class="hint">No changes yet.</p>';
  return (
    '<ul class="history">' +
    history
      .map(
        (c) =>
          `<li class="meta"><time datetime="${esc(c.at.toISOString())}">${esc(when(c.at))}</time> · ` +
          `${esc(c.who ?? "Syros Cats (the first list)")} · ${esc(changeWords(c))}</li>`,
      )
      .join("") +
    "</ul>"
  );
}

export function renderAreasPage(o: AreasPageOptions): string {
  const done = o.done !== undefined ? AREAS_DONE[o.done] : undefined;
  return renderPage({
    title: "Areas",
    active: null,
    personName: o.personName,
    body:
      (done ? `<p class="notice" role="status">${esc(done)}</p>` : "") +
      '<p class="hint">A place belongs to the area whose centre is nearest. More than 2 km from every centre is Off Syros. ' +
      "Place labels and the Cats filters use this list within a minute of a change.</p>" +
      addForm(o) +
      `<h2>The areas (${o.areas.length})</h2>` +
      `<ul class="history">${o.areas.map((a) => areaRow(a, o)).join("")}</ul>` +
      '<h2 id="history">History</h2>' +
      historyList(o.history) +
      `<p class="hint">Each change makes a new version. Reports name the version they used. This is version ${o.version}.</p>`,
  });
}
