import { placeLabel } from "../areas/placeLabel";
import type { Vaccine } from "../resolve";
import { markOf, type Lives } from "../teamCatList";
import type { TeamCatView } from "../teamCatView";
import { escapeHtml as esc } from "./escape";
import { lastSeenWords } from "./lastSeen";
import { markWithWords } from "./marks";
import { coatIsUnknown, coatWordsFor } from "./teamCoatWords";

// The answer first (SYC-396 spec §7.1): a row of plain facts at the top of the
// team cat page, each a label and a value. Where a fact is uncertain the words
// say so ("Probably…", "Not known"). There is no separate confidence tag that
// could contradict the value. Each value is trusted HTML: fixed words, and
// data only through escapeHtml.
//
// Not shown yet, because nothing records them: "checked in person by the cat
// guardian" (SYC-400) and the team's health note.

export interface CatFact {
  label: string;
  /** Trusted HTML. */
  html: string;
}

/** Dates on Syros, in Greek time: "13 Aug 2026". */
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Athens",
  });

/** Always month and year (spec §7.1): "Jun 2026". */
export const monthYear = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "Europe/Athens" });

/** The Cats grid's words for where a cat lives (spec §5.1, §7.1). */
export const LIVES_WORD: Record<Lives, string> = {
  street: "On the street",
  homed: "Has a home",
  in_care: "In care",
  gone: "No longer with us",
};

/** Who said it, as the history says it: "Eleni, cat guardian" for a guardian. */
function confirmedBy(v: TeamCatView): string {
  const s = v.history.find((h) => h.id === v.records.sterilised.supportingStatementIds[0]);
  if (!s?.asGuardian) return "Syros Cats";
  return s.author.kind === "deleted" ? "a cat guardian" : `${s.author.label}, cat guardian`;
}

function sterilisedFact(v: TeamCatView): string {
  const s = v.records.sterilised;
  const m = markOf(s);
  const by = confirmedBy(v);
  let words: string;
  if (m === "sterilised") words = `Yes, confirmed by ${by}, ${day(s.asOf)}`;
  else if (m === "not_sterilised")
    words = by === "Syros Cats" ? "No, Syros Cats' records" : `No, says ${by}, ${day(s.asOf)}`;
  else if (m === "probably") {
    const n = s.clippedTipSightings;
    words = n > 0 ? `Probably: clipped ear seen in ${n} photo${n === 1 ? "" : "s"}` : "Probably";
  } else words = "Not known";
  return markWithWords(m, esc(words));
}

function livesFact(v: TeamCatView): string {
  const l = v.records.lifeStatus;
  const lives: Lives | null = l.presumedDeceased || l.value === "deceased" ? "gone" : l.value;
  // Presumed, not known: the records only say it hasn't been seen for years.
  const words =
    lives === null ? "Not known" : l.presumedDeceased && l.value !== "deceased" ? "Probably no longer with us" : LIVES_WORD[lives];
  return esc(words) + (l.notSeenSince ? `<br><span class="meta">Not seen since ${esc(monthYear(l.notSeenSince))}</span>` : "");
}

/** Who the colours rest on (not the pattern): the machine, a person, or spotters. */
function colourSource(v: TeamCatView): string | null {
  const ids = v.appearance.coat.parts?.colours.supportingStatementIds;
  const counting = v.appearance.coat.statements.filter((s) => (ids ? ids.includes(s.id) : s.counts));
  const person = counting.find((s) => s.source === "team" || s.source === "guardian");
  if (person) {
    if (person.author.kind === "deleted") return person.source === "guardian" ? "set by a cat guardian" : "set by the team";
    return person.source === "guardian" ? `set by ${person.author.label}, cat guardian` : `set by ${person.author.label}`;
  }
  if (counting.some((s) => s.source === "machine")) return "read from the photo";
  if (counting.some((s) => s.source === "spotter")) return "from spotters' photos";
  return null;
}

/** The coat in the team's words (SYC-443, §15.2): "Ginger tabby", or null when neither part is known. */
export function coatPhraseOf(v: TeamCatView): string | null {
  const parts = v.appearance.coat.parts;
  const coat = { colours: parts?.colours.value ?? null, pattern: parts?.pattern.value ?? null };
  return coatIsUnknown(coat) ? null : coatWordsFor(undefined, coat);
}

function colourFact(v: TeamCatView): string {
  const phrase = coatPhraseOf(v);
  if (phrase === null) return '<a href="#appearance">Not known</a>';
  const source = colourSource(v);
  return (
    `<a href="#appearance"><span class="colourchip">${esc(phrase)}</span></a>` +
    (source ? ` <span class="meta">${esc(source)}</span>` : "")
  );
}

function colonyFact(v: TeamCatView): string {
  return v.colony ? `<a href="/api/team/colonies/${v.colony.id}">${esc(v.colony.name)}</a>` : "No colony";
}

/** "3 days ago · Kini": the same words as the Cats grid, without its "Last seen". */
function lastSeenFact(v: TeamCatView, now: Date): string {
  const last = v.sightings[0] ?? null;
  const where = last ?? v.cat;
  const words = lastSeenWords(last ? new Date(last.at) : null, now)
    .replace(/^Last seen (on )?/, "")
    .replace(/^./, (c) => c.toUpperCase());
  const when = last ? `<time datetime="${esc(last.at)}">${esc(words)}</time>` : esc(words);
  return `${when} · ${esc(placeLabel(where))}`;
}

export const VACCINE: Record<Exclude<Vaccine, { other: string }>, string> = {
  rabies: "Rabies",
  cat_flu_enteritis: "Cat flu and enteritis",
};

export const vaccineWord = (x: Vaccine) => (typeof x === "string" ? VACCINE[x] : x.other);

function vaccinatedFact(v: TeamCatView): string | null {
  const given = v.records.vaccinations;
  if (given.length === 0) return null;
  return given.map((r) => esc(`${r.vaccines.map(vaccineWord).join(", ")}, ${day(r.date)}`)).join("<br>");
}

export function catFacts(v: TeamCatView, now: Date): CatFact[] {
  const vaccinated = vaccinatedFact(v);
  return [
    { label: "Sterilised", html: sterilisedFact(v) },
    { label: "Lives", html: livesFact(v) },
    { label: "Coat", html: colourFact(v) },
    { label: "Colony", html: colonyFact(v) },
    { label: "Last seen", html: lastSeenFact(v, now) },
    ...(vaccinated ? [{ label: "Vaccinated", html: vaccinated }] : []),
  ];
}

/** The facts row as HTML: a list of label and value. */
export function renderCatFacts(v: TeamCatView, now: Date): string {
  return (
    '<dl class="catfacts">' +
    catFacts(v, now).map((f) => `<div class="fact"><dt>${esc(f.label)}</dt><dd>${f.html}</dd></div>`).join("") +
    "</dl>"
  );
}
