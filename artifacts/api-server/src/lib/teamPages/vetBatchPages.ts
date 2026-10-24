import { PAID_BY } from "../observations";
import type { CatToAdd } from "../colonyCats";
import type { Band } from "../findFromPhoto";
import type { Batch, BatchCat, BatchShared } from "../vetBatches";
import { BATCH_PHOTOS_MAX } from "../vetBatches";
import { ROUND_MAX, type BatchProblem } from "../vetVisits";
import { escapeHtml as esc } from "./escape";
import { renderPage } from "./layout";
import { VACCINE } from "./catFacts";
import {
  clinics,
  COST_MAX,
  LISTED_VACCINES,
  NOTE_MAX,
  OTHER_VACCINE_MAX,
  PAID_WORDS,
  priceText,
  TREATED_MAX,
} from "./vetVisitForm";

// The vet visit batch pages (SYC-677 Task 6): a day's round of cats at the
// vet, drawn on one server-drawn page with no scripts. Every card is
// `id="bc-<row>"`, and every POST answers with a 303 back to it, so a reload
// never resubmits. Words are fixed English, as on the single visit form.

const BASE = "/api/team/vet-batches";
export const batchPath = (id: number) => `${BASE}/${id}`;

/** What a batch card's "did" boxes are (no "Checked only" in a batch). */
export const BATCH_DID = ["sterilised", "vaccinated", "treated"] as const;
const DID_WORDS: Record<(typeof BATCH_DID)[number], string> = {
  sterilised: "Sterilised",
  vaccinated: "Vaccinated",
  treated: "Treated",
};

/** The sentences a 303 back can carry (`?said=<key>`): fixed text, never what was typed. */
export const SAID: Record<string, string> = {
  no_photo: "Choose at least one photo of the cat.",
  too_many_photos: `Up to ${BATCH_PHOTOS_MAX} photos for each cat.`,
  bad_photo: "That file isn't a photo we can read. Choose JPEG, PNG, HEIC or WebP photos.",
  photo_too_big: "A photo is too big. Choose photos under 10 MB.",
  bad_upload: "That upload didn't work. Choose the photos and try again.",
  batch_full: `A batch holds up to ${ROUND_MAX} cats. Save these, then start another batch.`,
  bad_place: "That place isn't there any more. Choose where to look and try again. No search was used.",
  no_such_cat: "That cat isn't there. Look it up by name or SYR number.",
  none_to_compare: "There are no cats to compare with in that place. Search somewhere else, or look the cat up by name.",
  no_photos: "None of the cats there has a photo to compare with. No search was used.",
  not_a_cat: "We couldn't see a cat in that photo. Look the cat up by name or SYR number, or search again.",
  index_down: "The looks-like search isn't working just now, so no search was used. Look the cat up by name or SYR number.",
  matching_down: "The matching service isn't working just now, so no search was used. Try again soon, or look the cat up by name.",
  counter_down: "The daily count isn't working just now, so no search was used. Look the cat up by name or SYR number.",
  capped_person:
    "You have reached your daily limit of photo searches in batches. Use “Look up by name or SYR number”, or try again tomorrow.",
  capped_team:
    "The team has reached its daily limit of photo searches in batches. Use “Look up by name or SYR number”, or try again tomorrow.",
  no_matches: "No likely cat came back. Search somewhere else, or look the cat up by name or SYR number.",
};

const BAND_WORD: Record<Band, string> = { very_likely: "Very likely", possible: "Possible", unlikely: "Unlikely" };

// ── The shared fields ──────────────────────────────────────────────────────

/** The shared form as typed: every value a string, so a bad price comes back as it was typed. */
export interface SharedValues {
  /** "", "colony:N" or "area:key"; undefined when the form had no place box. */
  place?: string;
  date: string;
  clinicId: string;
  price: string;
  paidBy: string;
  vaccines: string[];
  vaccineOther: string;
  note: string;
}

export type SharedField = "place" | "date" | "clinicId" | "price" | "paidBy" | "vaccines" | "note";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];
const lf = (s: string) => s.replace(/\r\n?/g, "\n");
const noNul = (s: string) => !s.includes(String.fromCharCode(0));
const body = (b: unknown) => (b && typeof b === "object" ? (b as Record<string, unknown>) : {});

const today = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "Europe/Athens" });
const realDay = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s < "2000-01-01") return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export function sharedValuesOf(s: BatchShared): SharedValues {
  return {
    place: s.colonyId !== null ? `colony:${s.colonyId}` : s.areaKey !== null ? `area:${s.areaKey}` : "",
    date: s.date,
    clinicId: s.clinicId ?? "",
    price: s.priceEur.trim() === "" ? "" : priceText(Number(s.priceEur)),
    paidBy: s.paidBy,
    vaccines: s.vaccines.filter((v) => (LISTED_VACCINES as string[]).includes(v)),
    vaccineOther: s.vaccineOther,
    note: s.note,
  };
}

export function sharedValuesFrom(raw: unknown): SharedValues {
  const b = body(raw);
  return {
    place: typeof b["place"] === "string" ? b["place"] : undefined,
    date: str(b["date"]),
    clinicId: str(b["clinicId"]),
    price: str(b["price"]),
    paidBy: str(b["paidBy"]),
    vaccines: list(b["vaccines"]),
    vaccineOther: str(b["vaccineOther"]),
    note: lf(str(b["note"])),
  };
}

/**
 * Reads the shared form. The price is checked here, once (euros, up to
 * COST_MAX, like the single visit's cost), so a bad price is named at the
 * batch price and not at every cat. A blank clinic is allowed to be saved as
 * blank: saving the batch asks for it.
 */
export function readShared(
  v: SharedValues,
  opts: { now?: Date; keepVaccines?: { vaccines: string[]; vaccineOther: string } },
):
  | { ok: true; shared: Pick<BatchShared, "date" | "clinicId" | "priceEur" | "paidBy" | "vaccines" | "vaccineOther" | "note"> }
  | { ok: false; problems: Partial<Record<SharedField, string>> } {
  const problems: Partial<Record<SharedField, string>> = {};
  const now = opts.now ?? new Date();
  if (v.date.trim() === "") problems.date = "Give the date of the visit.";
  else if (!realDay(v.date)) problems.date = "The date wasn't a real date.";
  else if (v.date > today(now)) problems.date = "The date can't be in the future.";

  if (v.clinicId !== "" && !clinics().some((c) => c.id === v.clinicId)) problems.clinicId = "Choose the clinic from the list.";

  let priceEur = "";
  const price = v.price.trim().replace(",", ".");
  if (price !== "") {
    const n = Number(price);
    if (!/^\d+(\.\d{1,2})?$/.test(price) || !Number.isFinite(n) || n > COST_MAX) {
      problems.price = `The price is in euros, up to ${COST_MAX}, like 60 or 55.50. Leave it blank if you don't know.`;
    } else priceEur = price;
  }

  if (!(PAID_BY as readonly string[]).includes(v.paidBy)) problems.paidBy = "Choose who paid.";

  let vaccines = [...new Set(v.vaccines)];
  let vaccineOther = v.vaccineOther.trim();
  if (opts.keepVaccines) {
    vaccines = opts.keepVaccines.vaccines;
    vaccineOther = opts.keepVaccines.vaccineOther;
  } else {
    if (!vaccines.every((x) => (LISTED_VACCINES as string[]).includes(x))) problems.vaccines = "Tick the vaccines given.";
    else if (vaccineOther !== "" && (vaccineOther.length < 2 || vaccineOther.length > OTHER_VACCINE_MAX || !noNul(vaccineOther))) {
      problems.vaccines = `Another vaccine's name is 2 to ${OTHER_VACCINE_MAX} characters.`;
    }
  }

  const note = v.note.trim();
  if (note.length > NOTE_MAX || !noNul(note)) problems.note = `A note can be up to ${NOTE_MAX} characters.`;

  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return {
    ok: true,
    shared: { date: v.date, clinicId: v.clinicId === "" ? null : v.clinicId, priceEur, paidBy: v.paidBy, vaccines, vaccineOther, note },
  };
}

// ── One cat's answers ──────────────────────────────────────────────────────

export interface CardValues {
  did: string[];
  treatedNote: string;
  cost: string;
  paidBy: string;
  note: string;
  alsoSameDay: boolean;
}

export type CardField = "did" | "treatedNote" | "cost" | "paidBy" | "note";

export function cardValuesOf(c: BatchCat): CardValues {
  return {
    did: c.did,
    treatedNote: c.treatedNote,
    cost: c.costEur.trim() === "" ? "" : c.costEur,
    paidBy: c.paidBy,
    note: c.note,
    alsoSameDay: c.alsoSameDay,
  };
}

export function cardValuesFrom(raw: unknown): CardValues {
  const b = body(raw);
  const cost = b["cost"];
  return {
    did: list(b["did"]),
    treatedNote: lf(str(b["treatedNote"])),
    cost: typeof cost === "number" && Number.isFinite(cost) ? String(cost) : str(cost),
    paidBy: str(b["paidBy"]),
    note: lf(str(b["note"])),
    alsoSameDay: b["alsoSameDay"] === "1",
  };
}

/** What a cat card posted, checked. A box this person may not tick is the route's refusal, not a field problem. */
export function readCard(
  v: CardValues,
): { ok: true; fields: { did: string[]; treatedNote: string; costEur: string; paidBy: string; note: string; alsoSameDay: boolean } } | { ok: false; problems: Partial<Record<CardField, string>> } {
  const problems: Partial<Record<CardField, string>> = {};
  const did = [...new Set(v.did)];
  if (!did.every((d) => (BATCH_DID as readonly string[]).includes(d))) problems.did = "Tick Sterilised, Vaccinated or Treated.";
  const treatedNote = v.treatedNote.trim();
  if (did.includes("treated") && (treatedNote.length < 1 || treatedNote.length > TREATED_MAX || !noNul(treatedNote))) {
    problems.treatedNote = `Say what was treated, in up to ${TREATED_MAX} characters.`;
  } else if (treatedNote.length > TREATED_MAX || !noNul(treatedNote)) {
    problems.treatedNote = `Say what was treated, in up to ${TREATED_MAX} characters.`;
  }
  let costEur = "";
  const cost = v.cost.trim().replace(",", ".");
  if (cost !== "") {
    const n = Number(cost);
    if (!/^\d+(\.\d{1,2})?$/.test(cost) || !Number.isFinite(n) || n > COST_MAX) {
      problems.cost = `The cost is in euros, up to ${COST_MAX}, like 60 or 55.50. Leave it blank to use the batch's price.`;
    } else costEur = cost;
  }
  if (v.paidBy !== "" && !(PAID_BY as readonly string[]).includes(v.paidBy)) problems.paidBy = "Choose who paid.";
  const note = v.note.trim();
  if (note.length > NOTE_MAX || !noNul(note)) problems.note = `A note can be up to ${NOTE_MAX} characters.`;
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return { ok: true, fields: { did, treatedNote, costEur, paidBy: v.paidBy, note, alsoSameDay: v.alsoSameDay } };
}

// ── The page ───────────────────────────────────────────────────────────────

export interface CatLine {
  name: string;
  syr: string;
  thumbUrl: string | null;
}

export interface BatchPage {
  batch: Batch;
  personName: string;
  /** May the person record a vaccination (`set_vaccination`)? */
  mayVaccinate: boolean;
  standardPriceEur: number;
  /** The place the batch is for, by name. */
  place: { kind: "colony" | "area"; name: string } | null;
  /** Names for every cat the page draws (matched, suggested, looked up), by cat id. */
  cats: Map<number, CatLine>;
  scopes: { colonies: { id: number; name: string }[]; areas: { key: string; name: string }[] };
  /** The batch searches' daily limit: ok, or whose it is. */
  limit: "ok" | "person" | "team";
  /** What a save said was wrong. */
  problems?: BatchProblem[];
  /** The shared form as typed, with what is wrong with it, when it didn't save. */
  shared?: { values: SharedValues; problems: Partial<Record<SharedField, string>> };
  /** One card's answers as typed, with what is wrong with them, when they didn't save. */
  card?: { row: number; values: CardValues; problems: Partial<Record<CardField, string>> };
  /** A lookup's answer, drawn at its card. */
  lookup?: { row: number; results: CatToAdd[] };
  /** `?said=` (fixed sentence) and the card (or the add box) it is about. */
  said?: { key: string; row: number | null };
  /** One plain sentence, when something failed that no field explains. */
  problem?: string;
  now?: Date;
}

const sentence = (key: string) => (Object.hasOwn(SAID, key) ? SAID[key]! : undefined);
const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Athens" });

const thumbUrl = (publicId: string) => `/api/team/photos/${encodeURIComponent(publicId)}/small`;

function checkbox(name: string, id: string, value: string, label: string, checked: boolean): string {
  return `<label class="choice" for="${id}"><input type="checkbox" id="${id}" name="${name}" value="${esc(value)}"${checked ? " checked" : ""}> ${esc(label)}</label>`;
}
function radio(name: string, id: string, value: string, label: string, checked: boolean): string {
  return `<label class="choice" for="${id}"><input type="radio" id="${id}" name="${name}" value="${esc(value)}"${checked ? " checked" : ""}> ${esc(label)}</label>`;
}
const errLine = (id: string, words: string | undefined) =>
  words ? `<p class="bad" id="${id}" role="alert">${esc(words)}</p>` : "";
const describedBy = (id: string, words: string | undefined, extra = "") =>
  words || extra
    ? ` aria-describedby="${[extra, words ? id : ""].filter(Boolean).join(" ")}"${words ? ' aria-invalid="true"' : ""}`
    : "";

function placeOptions(p: BatchPage, chosen: string): string {
  const opt = (v: string, label: string) => `<option value="${esc(v)}"${chosen === v ? " selected" : ""}>${esc(label)}</option>`;
  return (
    opt("", "Not chosen") +
    (p.scopes.areas.length ? `<optgroup label="Areas">${p.scopes.areas.map((a) => opt(`area:${a.key}`, a.name)).join("")}</optgroup>` : "") +
    (p.scopes.colonies.length ? `<optgroup label="Colonies">${p.scopes.colonies.map((c) => opt(`colony:${c.id}`, c.name)).join("")}</optgroup>` : "")
  );
}

function sharedSection(p: BatchPage): string {
  const b = p.batch;
  const typed = p.shared;
  const f = typed?.values ?? sharedValuesOf(b.shared);
  const saveProblems = (field: string) => p.problems?.find((x) => x.batchCatId === null && x.field === field)?.words;
  const pr = (field: SharedField) => typed?.problems[field] ?? saveProblems(field);
  const priceHint = `The standard sterilisation price is €${esc(priceText(p.standardPriceEur))}, set in Vet settings. Change it here if this batch cost something else.`;
  const clinicOptions =
    `<option value=""${f.clinicId === "" ? " selected" : ""}>Choose the clinic</option>` +
    clinics()
      .map((c) => `<option value="${esc(c.id)}"${f.clinicId === c.id ? " selected" : ""}>${esc(c.name)}</option>`)
      .join("");
  const vaccines = p.mayVaccinate
    ? '<fieldset><legend class="label">If any cat was vaccinated: which vaccines <span class="hint">(up to three)</span></legend>' +
      errLine("vb-vaccines-err", pr("vaccines")) +
      LISTED_VACCINES.map((v) => checkbox("vaccines", `vb-vac-${v}`, v, VACCINE[v], f.vaccines.includes(v))).join("") +
      '<label class="label" for="vb-vac-other">Another vaccine <span class="hint">(optional)</span></label>' +
      `<input class="text" id="vb-vac-other" name="vaccineOther" maxlength="${OTHER_VACCINE_MAX}" autocomplete="off" value="${esc(f.vaccineOther)}"${describedBy("vb-vaccines-err", pr("vaccines"))}>` +
      "</fieldset>"
    : "";
  return (
    '<section class="batchshared" id="shared"><h2>For every cat in this batch</h2>' +
    `<form method="post" action="${batchPath(b.id)}" novalidate>` +
    '<label class="label" for="vb-place">Where the cats came from <span class="hint">(optional)</span></label>' +
    errLine("vb-place-err", pr("place")) +
    `<select class="text" id="vb-place" name="place"${describedBy("vb-place-err", pr("place"))}>${placeOptions(p, f.place ?? "")}</select>` +
    '<label class="label" for="vb-date">Date of the visit</label>' +
    errLine("vb-date-err", pr("date")) +
    `<input id="vb-date" name="date" type="date" required max="${today(p.now ?? new Date())}" value="${esc(f.date)}"${describedBy("vb-date-err", pr("date"))}>` +
    '<label class="label" for="vb-clinic">Clinic</label>' +
    errLine("vb-clinic-err", pr("clinicId")) +
    `<select class="text" id="vb-clinic" name="clinicId"${describedBy("vb-clinic-err", pr("clinicId"))}>${clinicOptions}</select>` +
    '<label class="label" for="vb-price">Price for each sterilisation, in euros <span class="hint">(leave blank if you don\'t know)</span></label>' +
    `<p class="hint" id="vb-price-hint">${priceHint}</p>` +
    errLine("vb-price-err", pr("price")) +
    `<input class="text" id="vb-price" name="price" inputmode="decimal" autocomplete="off" value="${esc(f.price)}"${describedBy("vb-price-err", pr("price"), "vb-price-hint")}>` +
    '<fieldset><legend class="label">Paid by</legend>' +
    errLine("vb-paid-err", pr("paidBy")) +
    PAID_BY.map((w) => radio("paidBy", `vb-paid-${w}`, w, PAID_WORDS[w], f.paidBy === w)).join("") +
    "</fieldset>" +
    vaccines +
    '<label class="label" for="vb-note">Note for every cat <span class="hint">(optional)</span></label>' +
    errLine("vb-note-err", pr("note")) +
    `<textarea id="vb-note" name="note" maxlength="${NOTE_MAX}"${describedBy("vb-note-err", pr("note"))}>${esc(f.note)}</textarea>` +
    '<button type="submit" class="primary wide">Save these</button></form></section>'
  );
}

function scopeSelect(p: BatchPage, id: string): string {
  const b = p.batch.shared;
  const here = p.place ? `Where this batch is (${esc(p.place.name)})` : "Anywhere on the island";
  const batchOption = p.place ? `<option value="batch">${here}</option>` : "";
  const island = `<option value="island">Anywhere on the island</option>`;
  const colonies = p.scopes.colonies.map((c) => `<option value="colony:${c.id}">${esc(c.name)}</option>`).join("");
  const areas = p.scopes.areas.map((a) => `<option value="area:${esc(a.key)}">${esc(a.name)}</option>`).join("");
  void b;
  return (
    `<select class="text" id="${id}" name="scope">${batchOption}${island}` +
    (areas ? `<optgroup label="Areas">${areas}</optgroup>` : "") +
    (colonies ? `<optgroup label="Colonies">${colonies}</optgroup>` : "") +
    "</select>"
  );
}

const catChip = (line: CatLine | undefined, id: number) => {
  const name = line?.name ?? `Cat ${id}`;
  const syr = line?.syr ?? "";
  return `${esc(name)}${syr ? ` <span class="syr">${esc(syr)}</span>` : ""}`;
};

function thumbs(c: BatchCat, n: number): string {
  if (c.photos.length === 0) return "";
  return (
    '<p class="thumbs">' +
    c.photos
      .map((ph, i) => `<img class="thumb" src="${thumbUrl(ph.publicId)}" alt="${esc(`Photo ${i + 1} of ${c.photos.length} for cat ${n}`)}" loading="lazy">`)
      .join("") +
    "</p>"
  );
}

function suggestions(p: BatchPage, c: BatchCat, action: string): string {
  const list = c.suggestions;
  if (!list) return "";
  if (list.length === 0) return `<p class="hint">${esc(SAID["no_matches"]!)}</p>`;
  return (
    '<ul class="batchsuggest">' +
    list
      .map((r) => {
        const line = p.cats.get(r.catId);
        const pic = r.photoPublicId ? `<img class="thumb" src="${thumbUrl(r.photoPublicId)}" alt="${esc(`Photo of ${line?.name ?? "this cat"}`)}" loading="lazy">` : "";
        return (
          `<li class="catrow">${pic}<span><strong>${catChip(line, r.catId)}</strong><br>` +
          `<span class="findband ${r.band}"><strong>${esc(BAND_WORD[r.band])}</strong></span>` +
          (r.reasoning ? ` <span class="meta">${esc(r.reasoning)}</span>` : "") +
          `</span><form method="post" action="${action}/confirm"><input type="hidden" name="catId" value="${r.catId}">` +
          '<button type="submit" class="primary">This is the cat</button></form></li>'
        );
      })
      .join("") +
    "</ul>"
  );
}

function lookupResults(c: BatchCat, results: CatToAdd[], action: string): string {
  void c;
  if (results.length === 0) return '<p class="hint">No cat has that name or number. Try part of the name.</p>';
  return (
    '<ul class="batchsuggest">' +
    results
      .map((r) => {
        const pic = r.thumbnailUrl ? `<img class="thumb" src="${esc(r.thumbnailUrl)}" alt="${esc(`Photo of ${r.name}`)}" loading="lazy">` : "";
        return (
          `<li class="catrow">${pic}<span><strong>${esc(r.name)}</strong> <span class="syr">${esc(r.syr)}</span>` +
          (r.colony ? `<br><span class="meta">${esc(r.colony.name)}</span>` : "") +
          `</span><form method="post" action="${action}/confirm"><input type="hidden" name="catId" value="${r.id}">` +
          '<button type="submit" class="primary">This is the cat</button></form></li>'
        );
      })
      .join("") +
    "</ul>"
  );
}

function card(p: BatchPage, c: BatchCat, n: number): string {
  const b = p.batch;
  const action = `${batchPath(b.id)}/cats/${c.id}`;
  const line = c.catId !== null ? p.cats.get(c.catId) : undefined;
  const matched = c.catId !== null && c.confirmed;
  const state = c.newCat
    ? "New cat"
    : matched
      ? `Matched: ${catChip(line, c.catId!)}`
      : c.catId !== null
        ? `Chosen, not confirmed: ${catChip(line, c.catId)}`
        : "Not matched yet";
  const mine = (field: string) => p.problems?.find((x) => x.batchCatId === c.id && x.field === field)?.words;
  const said = p.said && p.said.row === c.id ? sentence(p.said.key) : undefined;
  const typed = p.card && p.card.row === c.id ? p.card : undefined;
  const f = typed?.values ?? cardValuesOf(c);
  const pr = (field: CardField) => typed?.problems[field] ?? mine(field);
  const id = (s: string) => `bc-${c.id}-${s}`;

  const cardProblems = (p.problems ?? [])
    .filter((x) => x.batchCatId === c.id && !["did", "treatedNote", "costEur", "paidBy", "note", "alsoSameDay"].includes(x.field))
    .map((x) => `<p class="bad" role="alert">${esc(x.words)}</p>`)
    .join("");

  let finding = "";
  if (!matched && !c.newCat) {
    const find =
      p.limit === "ok"
        ? `<form method="post" action="${action}/search" class="batchfind">` +
          `<label class="label" for="${id("scope")}">Look in</label>${scopeSelect(p, id("scope"))}` +
          '<button type="submit" class="primary">Find this cat</button></form>'
        : `<p class="notice" role="status">${esc(SAID[p.limit === "person" ? "capped_person" : "capped_team"]!)}</p>`;
    const lookupHere = p.lookup && p.lookup.row === c.id ? lookupResults(c, p.lookup.results, action) : "";
    finding =
      find +
      `<form method="post" action="${action}/lookup" class="batchlookup">` +
      `<label class="label" for="${id("q")}">Look up by name or SYR number</label>` +
      `<input class="text" id="${id("q")}" name="q" maxlength="100" autocomplete="off" placeholder="Mimi or SYR-0040">` +
      '<button type="submit" class="primary">Look up</button></form>' +
      lookupHere +
      suggestions(p, c, action);
  }

  let answers = "";
  if (matched) {
    const didBoxes = BATCH_DID.filter((d) => d !== "vaccinated" || p.mayVaccinate)
      .map((d) => checkbox("did", id(`did-${d}`), d, DID_WORDS[d], f.did.includes(d)))
      .join("");
    const sameDay = mine("alsoSameDay");
    answers =
      `<form method="post" action="${action}" class="batchanswers" novalidate>` +
      `<fieldset><legend class="label">What was done</legend>${errLine(id("did-err"), pr("did"))}${didBoxes}</fieldset>` +
      `<label class="label" for="${id("treated")}">If treated: what for <span class="hint">(a few words)</span></label>` +
      errLine(id("treated-err"), pr("treatedNote")) +
      `<input class="text" id="${id("treated")}" name="treatedNote" maxlength="${TREATED_MAX}" autocomplete="off" value="${esc(f.treatedNote)}"${describedBy(id("treated-err"), pr("treatedNote"))}>` +
      `<label class="label" for="${id("cost")}">This cat's cost in euros <span class="hint">(blank: the batch's price)</span></label>` +
      errLine(id("cost-err"), pr("cost") ?? mine("costEur")) +
      `<input class="text" id="${id("cost")}" name="cost" inputmode="decimal" autocomplete="off" value="${esc(f.cost)}"${describedBy(id("cost-err"), pr("cost") ?? mine("costEur"))}>` +
      '<fieldset><legend class="label">Paid by</legend>' +
      errLine(id("paid-err"), pr("paidBy")) +
      radio("paidBy", id("paid-same"), "", "Same as the batch", f.paidBy === "") +
      PAID_BY.map((w) => radio("paidBy", id(`paid-${w}`), w, PAID_WORDS[w], f.paidBy === w)).join("") +
      "</fieldset>" +
      `<label class="label" for="${id("note")}">Note for this cat <span class="hint">(optional)</span></label>` +
      errLine(id("note-err"), pr("note")) +
      `<textarea id="${id("note")}" name="note" maxlength="${NOTE_MAX}"${describedBy(id("note-err"), pr("note"))}>${esc(f.note)}</textarea>` +
      (sameDay || f.alsoSameDay
        ? `<div class="warn">${sameDay ? `<p class="bad" id="${id("same-err")}" role="alert">${esc(sameDay)}</p>` : ""}` +
          checkbox("alsoSameDay", id("same"), "1", "This is a second visit the same day. Save it anyway.", f.alsoSameDay) +
          "</div>"
        : "") +
      '<button type="submit" class="primary">Save this cat\'s answers</button></form>' +
      `<form method="post" action="${action}/confirm" class="batchundo"><input type="hidden" name="catId" value="none"><button type="submit" class="tap">This isn't the right cat</button></form>`;
  }

  return (
    `<section class="batchcat" id="bc-${c.id}" aria-labelledby="bc-${c.id}-h">` +
    `<h3 id="bc-${c.id}-h">Cat ${n}</h3>` +
    `<p class="batchstate">${state}</p>` +
    (said ? `<p class="notice" role="status">${esc(said)}</p>` : "") +
    cardProblems +
    thumbs(c, n) +
    finding +
    answers +
    `<form method="post" action="${action}/remove" class="batchremove"><button type="submit" class="risky">Remove from batch</button></form>` +
    "</section>"
  );
}

function addSection(p: BatchPage): string {
  const said = p.said && p.said.row === null ? sentence(p.said.key) : undefined;
  const full = p.batch.cats.length >= ROUND_MAX;
  return (
    '<section id="add"><h2>Add a cat</h2>' +
    (said ? `<p class="notice" role="alert">${esc(said)}</p>` : "") +
    (full
      ? `<p class="hint">${esc(SAID["batch_full"]!)}</p>`
      : `<form method="post" action="${batchPath(p.batch.id)}/cats" enctype="multipart/form-data">` +
        `<label class="label">Photos of one cat <span class="hint">(1 to ${BATCH_PHOTOS_MAX})</span>` +
        '<input type="file" name="photos" accept="image/*" multiple></label>' +
        '<button type="submit" class="primary wide">Add this cat</button></form>') +
    "</section>"
  );
}

function placeLine(p: BatchPage): string {
  if (!p.place) return `<p class="meta">Place: <strong>not chosen</strong></p>`;
  return `<p class="meta">${p.place.kind === "colony" ? "Colony" : "Area"}: <strong>${esc(p.place.name)}</strong></p>`;
}

export function renderBatchPage(p: BatchPage): string {
  const b = p.batch;
  const wholeBatch = (p.problems ?? []).filter((x) => x.batchCatId === null && ["cats", "batch"].includes(x.field));
  const anyProblem = (p.problems?.length ?? 0) > 0;
  return renderPage({
    title: "Vet visit batch",
    active: "colonies",
    personName: p.personName,
    body:
      placeLine(p) +
      (p.problem ? `<p class="notice" role="alert">${esc(p.problem)} Nothing was saved.</p>` : "") +
      (anyProblem ? '<p class="notice" role="alert">Some answers need a look. Nothing was saved yet.</p>' : "") +
      sharedSection(p) +
      `<section id="cats"><h2>The cats</h2>${
        b.cats.length === 0
          ? '<p class="hint">No cats yet. Add the first cat below, from its photos.</p>'
          : b.cats.map((c, i) => card(p, c, i + 1)).join("")
      }</section>` +
      addSection(p) +
      '<section id="save"><h2>Save the batch\'s visits</h2>' +
      wholeBatch.map((x) => `<p class="bad" role="alert">${esc(x.words)}</p>`).join("") +
      `<p class="hint">Each cat gets its own vet visit. Nothing is saved until every cat is matched and has something done.</p>` +
      `<form method="post" action="${batchPath(b.id)}/save"><button type="submit" class="primary wide">Save the batch's visits</button></form>` +
      `<form method="post" action="${batchPath(b.id)}/abandon" class="batchabandon"><button type="submit" class="risky">Throw this batch away</button></form>` +
      "</section>",
  });
}

/** Where a batch hands back to when it has been saved or thrown away. */
export const afterBatch = (colonyId: number | null, done?: string) =>
  colonyId !== null ? `/api/team/colonies/${colonyId}${done ? `?done=${done}` : ""}` : "/api/team/home";

/** The page for a batch that is already saved: it can't change, and says so. */
export function renderBatchSaved(o: { personName: string; colonyId: number | null; just?: boolean; visits?: number }): string {
  return renderPage({
    title: o.just ? "The batch is saved" : "This batch was already saved.",
    active: "colonies",
    personName: o.personName,
    body:
      (o.just
        ? `<p class="notice" role="status">The batch's vet visits are saved.</p>`
        : "<p>This batch was already saved, so it can't be changed here. Each cat's visit is on its own page.</p>") +
      `<p><a class="tap" href="${esc(afterBatch(o.colonyId))}">${o.colonyId !== null ? "Back to the colony" : "Back to Home"}</a></p>`,
  });
}

export function renderNoSuchBatch(personName: string): string {
  return renderPage({
    title: "No such batch",
    active: "colonies",
    personName,
    body: '<p>That batch isn\'t there. It may have been saved or thrown away. Nothing was changed.</p><p><a class="tap" href="/api/team/colonies">Back to Colonies</a></p>',
  });
}

export function renderBatchProblem(personName: string, words: string, backHref: string): string {
  return renderPage({
    title: "That didn't work",
    active: "colonies",
    personName,
    body: `<p class="bad" role="alert">${esc(words)}</p><p><a class="tap" href="${esc(backHref)}">Back to the batch</a></p>`,
  });
}

export interface BatchListRow {
  id: number;
  date: string;
  place: string;
  cats: number;
  startedBy: string;
}

/** The unsaved batches (SYC-677 Task 7): a way back into a round that was left half-done. */
export function renderBatchList(personName: string, rows: BatchListRow[]): string {
  const items = rows
    .map(
      (r) =>
        `<li class="batchrow"><a class="hrow" href="${batchPath(r.id)}"><span class="htext"><strong>${esc(r.place)}</strong> ` +
        `<span class="hint">${esc(`${r.date} · ${r.cats} ${r.cats === 1 ? "cat" : "cats"} · started by ${r.startedBy}`)}</span></span></a></li>`,
    )
    .join("");
  return renderPage({
    title: "Record vet visits",
    active: "colonies",
    personName,
    body:
      '<p><a class="tap" href="/api/team/vet-batches/new">Start a new batch</a></p>' +
      "<h2>Batches not saved yet</h2>" +
      (rows.length === 0
        ? '<p class="empty">No unsaved batches.</p>'
        : `<p class="hint">An unfinished batch is kept for 7 days after its last change.</p><ul class="hlist">${items}</ul>`),
  });
}
