import { getGuidance } from "@workspace/welfare-guidance";
import { PAID_BY, VISIT_DID, type VetVisitValue } from "../observations";
import type { Vaccine } from "../resolve";
import { escapeHtml as esc } from "./escape";
import { whatHappens } from "./help";
import { renderPage } from "./layout";
import { VACCINE } from "./catFacts";
import { euroText } from "../euros";

// Log a vet visit (SYC-396 PR 3.1a; team-dashboard-redesign.md §8.2, §13;
// plan Task 3.1.3). One server-drawn page, no scripts. A failed save comes
// back with everything typed still in it, and each problem named next to
// its field.

export const DID_WORDS: Record<VetVisitValue["did"][number], string> = {
  sterilised: "Sterilised",
  vaccinated: "Vaccinated",
  treated: "Treated",
  checked: "Checked only",
};

export const PAID_WORDS: Record<VetVisitValue["paidBy"], string> = {
  syros_cats: "Syros Cats",
  donation: "A donation given for this cat",
  owner: "The owner",
};

export const LISTED_VACCINES = Object.keys(VACCINE) as Exclude<Vaccine, { other: string }>[];
export const COST_MAX = 2000;
export const NOTE_MAX = 500;
export const TREATED_MAX = 200;
export const OTHER_VACCINE_MAX = 60;
const COST_REASON_MAX = 200;

/** What the form holds, as typed: every value a string, so a failed save shows it again exactly. */
export interface VisitFormValues {
  date: string;
  did: string[];
  vaccines: string[];
  vaccineOther: string;
  treatedNote: string;
  clinicId: string;
  costEur: string;
  paidBy: string;
  note: string;
  costReason: string;
}

export type VisitField =
  | "date"
  | "did"
  | "vaccines"
  | "treatedNote"
  | "clinicId"
  | "costEur"
  | "costReason"
  | "paidBy"
  | "note";

export const clinics = () => getGuidance("en").vets.map((c) => ({ id: c.id, name: c.name }));

/** Today on Syros, as YYYY-MM-DD. */
const today = (now: Date) => now.toLocaleDateString("en-CA", { timeZone: "Europe/Athens" });

/** The price as the cost box shows it: 60, or 55.50. */
export const priceText = (eur: number) => euroText(eur).slice(1);

/**
 * The form as it first opens: today's date, Sterilised ticked and the cost
 * filled with the standard price (§8.2), paid by Syros Cats. `?did=` picks
 * other boxes instead; the price is filled only when Sterilised is among them.
 */
export function blankVisitForm(standardPriceEur: number, did: string[] = ["sterilised"], now = new Date()): VisitFormValues {
  const ticked = did.filter((d) => (VISIT_DID as readonly string[]).includes(d));
  const chosen = ticked.length ? ticked : ["sterilised"];
  return {
    date: today(now),
    did: chosen,
    vaccines: [],
    vaccineOther: "",
    treatedNote: "",
    clinicId: "",
    costEur: chosen.includes("sterilised") ? priceText(standardPriceEur) : "",
    paidBy: "syros_cats",
    note: "",
    costReason: "",
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];

/** The form's fields from a posted body, as typed (CRLF made LF). */
export function visitFormFrom(body: unknown): VisitFormValues {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const lf = (s: string) => s.replace(/\r\n?/g, "\n");
  return {
    date: str(b["date"]),
    did: list(b["did"]),
    vaccines: list(b["vaccines"]),
    vaccineOther: str(b["vaccineOther"]),
    treatedNote: lf(str(b["treatedNote"])),
    clinicId: str(b["clinicId"]),
    // A JSON caller may send the cost as a number (second review, finding 2).
    costEur: typeof b["costEur"] === "number" && Number.isFinite(b["costEur"]) ? String(b["costEur"]) : str(b["costEur"]),
    paidBy: str(b["paidBy"]),
    note: lf(str(b["note"])),
    costReason: lf(str(b["costReason"])),
  };
}

const realDay = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s < "2000-01-01") return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const noNul = (s: string) => !s.includes(String.fromCharCode(0));

/**
 * Reads the form into a visit, or says what's wrong with each field. With
 * `costs: false` (no `view_vet_costs`) the form has no cost or "paid by"
 * boxes: the cost is not known, and Syros Cats is taken as the payer.
 */
export function readVisitForm(
  f: VisitFormValues,
  opts: { costs: boolean; vaccinate?: boolean; now?: Date },
): { ok: true; date: string; value: VetVisitValue } | { ok: false; problems: Partial<Record<VisitField, string>> } {
  const problems: Partial<Record<VisitField, string>> = {};
  const now = opts.now ?? new Date();

  if (f.date.trim() === "") problems.date = "Give the date of the visit.";
  else if (!realDay(f.date)) problems.date = "The date wasn't a real date.";
  else if (f.date > today(now)) problems.date = "The date can't be in the future.";

  const did = [...new Set(f.did)];
  if (did.length === 0) problems.did = "Tick what was done.";
  else if (!did.every((d) => (VISIT_DID as readonly string[]).includes(d))) problems.did = "Tick what was done.";
  else if (did.includes("checked") && did.length > 1) problems.did = "“Checked only” can't go with anything else.";
  else if (did.includes("vaccinated") && opts.vaccinate === false) {
    problems.did = "You can't record a vaccination. Untick Vaccinated, or ask someone who can.";
  }

  const vaccines: Vaccine[] = [];
  if (did.includes("vaccinated")) {
    for (const v of [...new Set(f.vaccines)]) {
      if ((LISTED_VACCINES as string[]).includes(v)) vaccines.push(v as Vaccine);
      else problems.vaccines = "Tick the vaccines given.";
    }
    const other = f.vaccineOther.trim();
    if (other) {
      if (other.length < 2 || other.length > OTHER_VACCINE_MAX || !noNul(other)) {
        problems.vaccines = `Another vaccine's name is 2 to ${OTHER_VACCINE_MAX} characters.`;
      } else {
        const listed = LISTED_VACCINES.find((code) => VACCINE[code].toLowerCase() === other.toLowerCase());
        // A listed vaccine typed as well as ticked is the same vaccine, once.
        if (!listed) vaccines.push({ other });
        else if (!vaccines.includes(listed)) vaccines.push(listed);
      }
    }
    if (vaccines.length === 0 && !problems.vaccines) problems.vaccines = "Tick the vaccines given, or type another.";
    if (vaccines.length > 3) problems.vaccines = "Up to three vaccines.";
  }

  const treatedNote = f.treatedNote.trim();
  if (did.includes("treated") && (treatedNote.length < 1 || treatedNote.length > TREATED_MAX || !noNul(treatedNote))) {
    problems.treatedNote = `Say what was treated, in up to ${TREATED_MAX} characters.`;
  }

  if (!clinics().some((c) => c.id === f.clinicId)) problems.clinicId = "Choose the clinic.";

  let costEur: number | null = null;
  let paidBy: VetVisitValue["paidBy"] = "syros_cats";
  if (opts.costs) {
    const cost = f.costEur.trim().replace(",", ".");
    if (cost !== "") {
      const n = Number(cost);
      if (!/^\d+(\.\d{1,2})?$/.test(cost) || !Number.isFinite(n) || n > COST_MAX) {
        problems.costEur = `The cost is in euros, up to ${COST_MAX}, like 60 or 55.50. Leave it blank if you don't know.`;
      } else costEur = n;
    }
    if ((PAID_BY as readonly string[]).includes(f.paidBy)) paidBy = f.paidBy as VetVisitValue["paidBy"];
    else problems.paidBy = "Choose who paid.";
  }

  // Optional (Samuel, 21 Oct 2026): why a sterilisation didn't cost the standard price.
  const costReason = opts.costs ? f.costReason.trim() : "";
  if (costReason) {
    if (!did.includes("sterilised")) {
      problems.costReason = "A reason for the cost is only for a sterilisation. Clear it, or tick Sterilised.";
    } else if (costEur === null && !problems.costEur) {
      problems.costReason = "Type the cost, or clear the reason.";
    } else if (costReason.length > COST_REASON_MAX || !noNul(costReason)) {
      problems.costReason = `Say why in up to ${COST_REASON_MAX} characters.`;
    }
  }

  const note = f.note.trim();
  if (note.length > NOTE_MAX || !noNul(note)) problems.note = `A note can be up to ${NOTE_MAX} characters.`;

  if (Object.keys(problems).length > 0) return { ok: false, problems };
  const value: VetVisitValue = { did: did as VetVisitValue["did"], clinicId: f.clinicId, costEur, paidBy };
  if (did.includes("vaccinated")) value.vaccines = vaccines;
  if (did.includes("treated")) value.treatedNote = treatedNote;
  if (note) value.note = note;
  if (costReason) value.costReason = costReason;
  return { ok: true, date: f.date, value };
}

export interface VisitFormPage {
  cat: { id: number; name: string; mainPhotoUrl: string | null };
  personName: string;
  values: VisitFormValues;
  /** May the person see and enter costs (`view_vet_costs`)? */
  costs: boolean;
  /** May the person record a vaccination (`set_vaccination`)? */
  vaccinate: boolean;
  /** The standard price, for the hint beside the cost. */
  standardPriceEur: number;
  problems?: Partial<Record<VisitField, string>>;
  /** One plain sentence, when the save failed for a reason no field explains. */
  problem?: string;
  now?: Date;
}

export function renderVetVisitForm(p: VisitFormPage): string {
  const { cat, values: f } = p;
  const problems = p.problems ?? {};
  const base = `/api/team/cats/${cat.id}`;
  const err = (field: VisitField) =>
    problems[field] ? `<p class="bad" id="vv-${field}-err" role="alert">${esc(problems[field]!)}</p>` : "";
  const described = (field: VisitField) => (problems[field] ? ` aria-describedby="vv-${field}-err" aria-invalid="true"` : "");
  const box = (name: string, id: string, value: string, label: string, checked: boolean) =>
    `<label class="choice" for="${id}"><input type="checkbox" id="${id}" name="${name}" value="${esc(value)}"${checked ? " checked" : ""}> ${esc(label)}</label>`;
  const radio = (name: string, id: string, value: string, label: string, checked: boolean) =>
    `<label class="choice" for="${id}"><input type="radio" id="${id}" name="${name}" value="${esc(value)}" required${checked ? " checked" : ""}> ${esc(label)}</label>`;

  const didBoxes = VISIT_DID.filter((d) => d !== "vaccinated" || p.vaccinate)
    .map((d) => box("did", `vv-did-${d}`, d, DID_WORDS[d], f.did.includes(d)))
    .join("");
  const vaccinePicker = p.vaccinate
    ? '<fieldset><legend class="label">If vaccinated: which vaccines <span class="hint">(up to three)</span></legend>' +
      err("vaccines") +
      LISTED_VACCINES.map((v) => box("vaccines", `vv-vac-${v}`, v, VACCINE[v], f.vaccines.includes(v))).join("") +
      '<label class="label" for="vv-vac-other">Another vaccine <span class="hint">(optional)</span></label>' +
      `<input class="text" id="vv-vac-other" name="vaccineOther" maxlength="${OTHER_VACCINE_MAX}" autocomplete="off" value="${esc(f.vaccineOther)}"${described("vaccines")}>` +
      "</fieldset>"
    : "";
  const clinicOptions =
    `<option value=""${f.clinicId === "" ? " selected" : ""}>Choose the clinic</option>` +
    clinics()
      .map((c) => `<option value="${esc(c.id)}"${f.clinicId === c.id ? " selected" : ""}>${esc(c.name)}</option>`)
      .join("");
  const money = p.costs
    ? '<label class="label" for="vv-cost">Cost in euros <span class="hint">(leave blank if you don\'t know)</span></label>' +
      `<p class="hint" id="vv-cost-hint">The standard sterilisation price is €${esc(priceText(p.standardPriceEur))}. Change it here if this visit cost something else.</p>` +
      err("costEur") +
      `<input class="text" id="vv-cost" name="costEur" inputmode="decimal" autocomplete="off" value="${esc(f.costEur)}" aria-describedby="vv-cost-hint${problems.costEur ? " vv-costEur-err" : ""}"${problems.costEur ? ' aria-invalid="true"' : ""}>` +
      '<label class="label" for="vv-cost-why">Why the cost is different <span class="hint">(optional)</span></label>' +
      `<p class="hint" id="vv-cost-why-hint">For a sterilisation that didn't cost the standard €${esc(priceText(p.standardPriceEur))}.</p>` +
      err("costReason") +
      `<input class="text" id="vv-cost-why" name="costReason" maxlength="${COST_REASON_MAX}" autocomplete="off" value="${esc(f.costReason)}" aria-describedby="vv-cost-why-hint${problems.costReason ? " vv-costReason-err" : ""}"${problems.costReason ? ' aria-invalid="true"' : ""}>` +
      '<fieldset><legend class="label">Paid by</legend>' +
      err("paidBy") +
      PAID_BY.map((w) => radio("paidBy", `vv-paid-${w}`, w, PAID_WORDS[w], f.paidBy === w)).join("") +
      "</fieldset>" +
      whatHappens("If the owner paid, the cost is not counted in Syros Cats' spend in Reports.")
    : "";

  const photo = cat.mainPhotoUrl
    ? `<img class="photo catmain diedphoto" src="${esc(cat.mainPhotoUrl)}" alt="${esc(`Photo of ${cat.name}`)}">`
    : "";
  return renderPage({
    title: `Log a vet visit: ${cat.name}`,
    active: "cats",
    personName: p.personName,
    beforeTitle: `<p class="back"><a href="${base}">&larr; Back to ${esc(cat.name)}</a></p>`,
    body:
      photo +
      (p.problem ? `<p class="notice" role="alert">${esc(p.problem)} Nothing was saved.</p>` : "") +
      (Object.keys(problems).length > 0
        ? '<p class="notice" role="alert">Some answers need a look. Nothing was saved yet.</p>'
        : "") +
      `<form method="post" action="${base}/vet-visit" class="diedpage" novalidate>` +
      '<label class="label" for="vv-date">Date of the visit</label>' +
      err("date") +
      `<input id="vv-date" name="date" type="date" required max="${today(p.now ?? new Date())}" value="${esc(f.date)}"${described("date")}>` +
      `<fieldset><legend class="label">What was done</legend>${err("did")}${didBoxes}</fieldset>` +
      whatHappens(
        "Ticking Sterilised records the cat as sterilised. If a cat guardian had recorded the cat as not sterilised, this visit overrules that, and undoing the visit puts it back.",
      ) +
      vaccinePicker +
      '<label class="label" for="vv-treated">If treated: what for <span class="hint">(a few words)</span></label>' +
      err("treatedNote") +
      `<input class="text" id="vv-treated" name="treatedNote" maxlength="${TREATED_MAX}" autocomplete="off" value="${esc(f.treatedNote)}"${described("treatedNote")}>` +
      '<label class="label" for="vv-clinic">Clinic</label>' +
      err("clinicId") +
      `<select class="text" id="vv-clinic" name="clinicId" required${described("clinicId")}>${clinicOptions}</select>` +
      money +
      '<label class="label" for="vv-note">Note <span class="hint">(optional)</span></label>' +
      err("note") +
      `<textarea id="vv-note" name="note" maxlength="${NOTE_MAX}"${described("note")}>${esc(f.note)}</textarea>` +
      '<button type="submit" class="primary wide">Save the visit</button></form>' +
      `<p><a class="tap" href="${base}">${esc(`Back to ${cat.name} (nothing saved)`)}</a></p>`,
  });
}
