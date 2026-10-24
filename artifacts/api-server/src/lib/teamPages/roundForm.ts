import { PAID_BY, VISIT_DID, type VetVisitValue } from "../observations";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { VACCINE } from "./catFacts";
import { markBadge } from "./marks";
import type { SterilisedMark } from "../teamCatList";
import {
  clinics,
  DID_WORDS,
  PAID_WORDS,
  priceText,
  readVisitForm,
  type VisitField,
  type VisitFormValues,
} from "./vetVisitForm";
import type { Vaccine } from "../resolve";
import { ROUND_MAX } from "../vetVisits";

// Log this round's vet visits (SYC-396 PR 3.2; team-dashboard-redesign.md
// §8.5; SYC-621). One form on a colony's planner: the colony's street cats,
// each with a tick box. They share a date, a clinic, a price and who paid;
// each cat can change what was done, its cost and who paid, in its own fold.
// "Add a cat not on this list" finds any other cat by name or SYR number.
// Saving logs one visit per ticked cat, all together or not at all
// (`logRound`). Team only, English (Decision 12). No scripts: the search is a
// second submit button on the same POST form, so everything typed is kept
// and nothing typed goes into the address.

const LISTED_VACCINES = Object.keys(VACCINE) as Exclude<Vaccine, { other: string }>[];
const TREATED_MAX = 200;
const NOTE_MAX = 500;

export interface RoundCat {
  id: number;
  name: string;
  syr: string;
  photoUrl: string | null;
  mark: SterilisedMark | null;
  /** "In another colony", "Not in a colony": for cats added from outside the list. */
  where?: string;
}

/** Each cat's own answers, as typed. */
export interface RoundCatValues {
  ticked: boolean;
  did: string[];
  costEur: string;
  paidBy: string;
  treatedNote: string;
}

/** The whole form, as typed: every value a string, so a failed save shows it again exactly. */
export interface RoundValues {
  date: string;
  clinicId: string;
  priceEur: string;
  paidBy: string;
  vaccines: string[];
  vaccineOther: string;
  note: string;
  /** Cats added from outside the colony's list, by id. */
  extra: number[];
  cats: Record<number, RoundCatValues>;
  /** "Add a cat not on this list": what was typed into the search. */
  q: string;
}

const today = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "Europe/Athens" });

/** What a cat starts with: Sterilised if it isn't confirmed sterilised, else Checked only. */
const startingDid = (mark: SterilisedMark | null) => (mark === "sterilised" ? ["checked"] : ["sterilised"]);

export function blankRound(cats: readonly RoundCat[], standardPriceEur: number, now = new Date()): RoundValues {
  return {
    date: today(now),
    clinicId: "",
    priceEur: priceText(standardPriceEur),
    paidBy: "syros_cats",
    vaccines: [],
    vaccineOther: "",
    note: "",
    extra: [],
    cats: Object.fromEntries(
      cats.map((c) => [c.id, { ticked: false, did: startingDid(c.mark), costEur: "", paidBy: "", treatedNote: "" }]),
    ),
    q: "",
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];
const lf = (s: string) => s.replace(/\r\n?/g, "\n");
const ID_RE = /^\d{1,9}$/;
const ids = (v: unknown) => [...new Set(list(v).filter((s) => ID_RE.test(s)).map(Number))];

/**
 * The form's fields from a posted body. `listed` is every cat the form drew
 * a row for (the colony's and the extras), so a row's answers are read only
 * for a cat that has one.
 */
export function roundFrom(body: unknown, listed: readonly number[]): RoundValues {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const ticked = new Set(ids(b["cat"]));
  return {
    date: str(b["date"]),
    clinicId: str(b["clinicId"]),
    priceEur: str(b["priceEur"]),
    paidBy: str(b["paidBy"]),
    vaccines: list(b["vaccines"]),
    vaccineOther: str(b["vaccineOther"]),
    note: lf(str(b["note"])),
    extra: ids(b["extra"]),
    q: str(b["q"]).slice(0, 200),
    cats: Object.fromEntries(
      listed.map((id) => [
        id,
        {
          ticked: ticked.has(id),
          did: list(b[`did-${id}`]),
          costEur: str(b[`cost-${id}`]),
          paidBy: str(b[`paid-${id}`]),
          treatedNote: lf(str(b[`treated-${id}`])),
        },
      ]),
    ),
  };
}

export type RoundField = "date" | "clinicId" | "priceEur" | "paidBy" | "vaccines" | "note" | "cats";
export type RoundCatField = Extract<VisitField, "did" | "costEur" | "paidBy" | "treatedNote">;

export interface RoundProblems {
  shared: Partial<Record<RoundField, string>>;
  cats: Record<number, Partial<Record<RoundCatField, string>>>;
}

/**
 * Reads the round into one visit per ticked cat, through the single visit's
 * own reader (`readVisitForm`), so a round can never save what the cat
 * page's form would refuse. Each cat's cost is its own if typed, else the
 * shared price when Sterilised is ticked, else not known. Who paid is the
 * cat's own choice, else the shared one.
 */
export function readRound(
  f: RoundValues,
  opts: { costs: boolean; vaccinate: boolean; now?: Date },
):
  | { ok: true; date: string; visits: { catId: number; value: VetVisitValue }[] }
  | { ok: false; problems: RoundProblems } {
  const problems: RoundProblems = { shared: {}, cats: {} };
  const chosen = Object.entries(f.cats).filter(([, c]) => c.ticked);
  if (chosen.length === 0) problems.shared.cats = "Tick the cats that went to the vet.";
  if (chosen.length > ROUND_MAX) problems.shared.cats = `Up to ${ROUND_MAX} cats in one round. Save this round in two parts.`;

  const price = f.priceEur.trim().replace(",", ".");
  if (opts.costs && price !== "" && !/^\d+(\.\d{1,2})?$/.test(price)) {
    problems.shared.priceEur = "The price is in euros, like 60 or 55.50. Leave it blank if you don't know.";
  }
  if (opts.costs && !(PAID_BY as readonly string[]).includes(f.paidBy)) problems.shared.paidBy = "Choose who paid.";
  if (f.note.trim().length > NOTE_MAX) problems.shared.note = `A note can be up to ${NOTE_MAX} characters.`;

  const visits: { catId: number; value: VetVisitValue }[] = [];
  let date = f.date;
  for (const [key, c] of chosen) {
    const catId = Number(key);
    const values: VisitFormValues = {
      date: f.date,
      did: c.did,
      vaccines: f.vaccines,
      vaccineOther: f.vaccineOther,
      treatedNote: c.treatedNote,
      clinicId: f.clinicId,
      costEur: c.costEur.trim() !== "" ? c.costEur : c.did.includes("sterilised") ? f.priceEur : "",
      paidBy: c.paidBy !== "" ? c.paidBy : f.paidBy,
      note: f.note,
      costReason: "",
    };
    const read = readVisitForm(values, { costs: opts.costs, vaccinate: opts.vaccinate, now: opts.now });
    if (read.ok) {
      visits.push({ catId, value: read.value });
      date = read.date;
      continue;
    }
    const p = read.problems;
    // The shared fields' problems are named once, at the shared fields.
    if (p.date) problems.shared.date = p.date;
    if (p.clinicId) problems.shared.clinicId = p.clinicId;
    if (p.vaccines) problems.shared.vaccines = p.vaccines;
    if (p.note) problems.shared.note = p.note;
    const own: Partial<Record<RoundCatField, string>> = {};
    if (p.did) own.did = p.did;
    if (p.treatedNote) own.treatedNote = p.treatedNote;
    // A bad cost is the cat's own if it typed one, else the shared price's.
    if (p.costEur && c.costEur.trim() !== "") own.costEur = p.costEur;
    else if (p.costEur) problems.shared.priceEur ??= p.costEur;
    if (p.paidBy && c.paidBy !== "") own.paidBy = p.paidBy;
    if (Object.keys(own).length > 0) problems.cats[catId] = own;
  }
  const any = Object.keys(problems.shared).length > 0 || Object.keys(problems.cats).length > 0;
  if (any) return { ok: false, problems };
  return { ok: true, date, visits };
}

export interface RoundPage {
  colony: { id: number; name: string };
  personName: string;
  /** The colony's street cats (To do, then Done), then any added from outside. */
  cats: RoundCat[];
  values: RoundValues;
  costs: boolean;
  vaccinate: boolean;
  standardPriceEur: number;
  /** "Add a cat not on this list" results; null when nothing was searched for. */
  found?: RoundCat[] | null;
  problems?: RoundProblems;
  /** One plain sentence, when the save failed for a reason no field explains. */
  problem?: string;
  now?: Date;
}

export function renderRoundForm(p: RoundPage): string {
  const f = p.values;
  const problems = p.problems ?? { shared: {}, cats: {} };
  const base = `/api/team/colonies/${p.colony.id}`;
  const err = (id: string, text: string | undefined) =>
    text ? `<p class="bad" id="${id}-err" role="alert">${esc(text)}</p>` : "";
  const described = (id: string, text: string | undefined) => (text ? ` aria-describedby="${id}-err" aria-invalid="true"` : "");
  const box = (name: string, id: string, value: string, label: string, checked: boolean) =>
    `<label class="choice" for="${id}"><input type="checkbox" id="${id}" name="${name}" value="${esc(value)}"${checked ? " checked" : ""}> ${esc(label)}</label>`;
  const radio = (name: string, id: string, value: string, label: string, checked: boolean) =>
    `<label class="choice" for="${id}"><input type="radio" id="${id}" name="${name}" value="${esc(value)}"${checked ? " checked" : ""}> ${esc(label)}</label>`;
  const s = problems.shared;

  const clinicOptions =
    `<option value=""${f.clinicId === "" ? " selected" : ""}>Choose the clinic</option>` +
    clinics().map((c) => `<option value="${esc(c.id)}"${f.clinicId === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("");
  const shared =
    "<fieldset class=\"roundshared\"><legend><h2>For every cat in this round</h2></legend>" +
    '<label class="label" for="rd-date">Date of the visits</label>' +
    err("rd-date", s.date) +
    `<input id="rd-date" name="date" type="date" required max="${today(p.now ?? new Date())}" value="${esc(f.date)}"${described("rd-date", s.date)}>` +
    '<label class="label" for="rd-clinic">Clinic</label>' +
    err("rd-clinic", s.clinicId) +
    `<select class="text" id="rd-clinic" name="clinicId" required${described("rd-clinic", s.clinicId)}>${clinicOptions}</select>` +
    (p.costs
      ? '<label class="label" for="rd-price">Cost of each sterilisation, in euros</label>' +
        `<p class="hint" id="rd-price-hint">The standard price from Vet settings is €${esc(priceText(p.standardPriceEur))}. A cat's own cost, under its name, replaces it.</p>` +
        err("rd-price", s.priceEur) +
        `<input class="text" id="rd-price" name="priceEur" inputmode="decimal" autocomplete="off" value="${esc(f.priceEur)}" aria-describedby="rd-price-hint${s.priceEur ? " rd-price-err" : ""}"${s.priceEur ? ' aria-invalid="true"' : ""}>` +
        '<fieldset><legend class="label">Paid by</legend>' +
        err("rd-paid", s.paidBy) +
        PAID_BY.map((w) => radio("paidBy", `rd-paid-${w}`, w, PAID_WORDS[w], f.paidBy === w)).join("") +
        "</fieldset>"
      : "") +
    (p.vaccinate
      ? '<fieldset><legend class="label">If vaccinated: which vaccines <span class="hint">(the same for every cat vaccinated)</span></legend>' +
        err("rd-vac", s.vaccines) +
        LISTED_VACCINES.map((v) => box("vaccines", `rd-vac-${v}`, v, VACCINE[v], f.vaccines.includes(v))).join("") +
        '<label class="label" for="rd-vac-other">Another vaccine <span class="hint">(optional)</span></label>' +
        `<input class="text" id="rd-vac-other" name="vaccineOther" maxlength="60" autocomplete="off" value="${esc(f.vaccineOther)}"${described("rd-vac", s.vaccines)}>` +
        "</fieldset>"
      : "") +
    '<label class="label" for="rd-note">Note for every visit <span class="hint">(optional)</span></label>' +
    err("rd-note", s.note) +
    `<textarea id="rd-note" name="note" maxlength="${NOTE_MAX}"${described("rd-note", s.note)}>${esc(f.note)}</textarea>` +
    "</fieldset>";

  const dids = VISIT_DID.filter((d) => d !== "vaccinated" || p.vaccinate);
  const row = (c: RoundCat) => {
    const v = f.cats[c.id] ?? { ticked: false, did: startingDid(c.mark), costEur: "", paidBy: "", treatedNote: "" };
    const own = problems.cats[c.id] ?? {};
    const id = `rc-${c.id}`;
    const thumb = c.photoUrl
      ? `<img class="thumb" src="${esc(c.photoUrl)}" alt="" loading="lazy">`
      : `<span class="thumb nothumb">No photo</span>`;
    const opened = Object.keys(own).length > 0 || v.costEur !== "" || v.paidBy !== "" || v.treatedNote !== "";
    return (
      `<li class="roundcat${Object.keys(own).length ? " needs" : ""}">` +
      `<label class="catrow" for="${id}"><input type="checkbox" id="${id}" name="cat" value="${c.id}"${v.ticked ? " checked" : ""}>${thumb}` +
      `<span class="catinfo"><span><strong>${esc(c.name)}</strong> <span class="syr">${esc(c.syr)}</span></span>` +
      (c.mark ? `<span class="status">${markBadge(c.mark)}</span>` : "") +
      (c.where ? `<span class="status">${esc(c.where)}</span>` : "") +
      `</span></label>` +
      `<fieldset class="rounddid"><legend class="label">What was done for ${esc(c.name)}</legend>` +
      err(`${id}-did`, own.did) +
      dids.map((d) => box(`did-${c.id}`, `${id}-did-${d}`, d, DID_WORDS[d], v.did.includes(d))).join("") +
      "</fieldset>" +
      `<details class="planfold"${opened ? " open" : ""}><summary>More for ${esc(c.name)}</summary>` +
      `<label class="label" for="${id}-treated">If treated: what for</label>` +
      err(`${id}-treated`, own.treatedNote) +
      `<input class="text" id="${id}-treated" name="treated-${c.id}" maxlength="${TREATED_MAX}" autocomplete="off" value="${esc(v.treatedNote)}"${described(`${id}-treated`, own.treatedNote)}>` +
      (p.costs
        ? `<label class="label" for="${id}-cost">This cat's cost in euros <span class="hint">(blank: the price above)</span></label>` +
          err(`${id}-cost`, own.costEur) +
          `<input class="text" id="${id}-cost" name="cost-${c.id}" inputmode="decimal" autocomplete="off" value="${esc(v.costEur)}"${described(`${id}-cost`, own.costEur)}>` +
          `<label class="label" for="${id}-paid">Paid by</label>` +
          err(`${id}-paid`, own.paidBy) +
          `<select class="text" id="${id}-paid" name="paid-${c.id}"${described(`${id}-paid`, own.paidBy)}>` +
          `<option value=""${v.paidBy === "" ? " selected" : ""}>As above</option>` +
          PAID_BY.map((w) => `<option value="${w}"${v.paidBy === w ? " selected" : ""}>${esc(PAID_WORDS[w])}</option>`).join("") +
          "</select>"
        : "") +
      "</details></li>"
    );
  };

  const listed = new Set(p.cats.map((c) => c.id));
  const found =
    p.found == null
      ? ""
      : p.found.length === 0
        ? `<p class="empty">No cat has that name or SYR number.</p>`
        : `<ul class="cats">` +
          p.found
            .map((c) =>
              listed.has(c.id)
                ? `<li><span class="catrow"><span class="catinfo"><span><strong>${esc(c.name)}</strong> <span class="syr">${esc(c.syr)}</span></span><span class="status">Already on this list</span></span></span></li>`
                : `<li><button type="submit" class="catrow addcat" name="add" value="${c.id}">` +
                  `<span class="catinfo"><span><strong>${esc(c.name)}</strong> <span class="syr">${esc(c.syr)}</span></span>` +
                  (c.where ? `<span class="status">${esc(c.where)}</span>` : "") +
                  `<span class="status">Add to this round</span></span></button></li>`,
            )
            .join("") +
          `</ul>`;
  const add =
    '<h2 id="add">Add a cat not on this list</h2>' +
    '<label class="label" for="rd-q">Name or SYR number</label>' +
    `<div class="searchrow"><input id="rd-q" name="q" type="search" value="${esc(f.q)}" maxlength="100" autocomplete="off" autocapitalize="none" spellcheck="false">` +
    `<button type="submit" name="action" value="find" formnovalidate>Find</button></div>` +
    found;

  return renderPage({
    title: `Log this round's vet visits: ${p.colony.name}`,
    active: "colonies",
    personName: p.personName,
    beforeTitle: `<p class="back"><a href="${base}">&larr; ${esc(p.colony.name)}</a></p>`,
    body:
      (p.problem ? `<p class="notice" role="alert">${esc(p.problem)} Nothing was saved.</p>` : "") +
      (Object.keys(problems.shared).length + Object.keys(problems.cats).length > 0
        ? '<p class="notice" role="alert">Some answers need a look. Nothing was saved yet.</p>'
        : "") +
      `<form method="post" action="${base}/round" class="diedpage" novalidate>` +
      f.extra.map((id) => `<input type="hidden" name="extra" value="${id}">`).join("") +
      shared +
      `<h2 id="round-cats">The cats</h2>` +
      `<p class="hint">Tick each cat that went to the vet. Each gets its own visit.</p>` +
      err("rd-cats", s.cats) +
      (p.cats.length === 0 ? `<p class="empty">No cats are in this colony yet.</p>` : `<ul class="cats roundcats">${p.cats.map(row).join("")}</ul>`) +
      add +
      `<button type="submit" class="primary wide" name="action" value="save">Save the ticked cats' visits</button></form>` +
      `<p><a class="tap" href="${base}">${esc(`Back to ${p.colony.name} (nothing saved)`)}</a></p>`,
  });
}
