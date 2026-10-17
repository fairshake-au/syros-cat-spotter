import { placeLabel } from "../areas/placeLabel";
import type { Vaccine } from "../resolve";
import { markOf, type Lives } from "../teamCatList";
import type { TeamCatView } from "../teamCatView";
import { escapeHtml as esc } from "./escape";
import { lastSeenWords } from "./lastSeen";
import { markWithWords } from "./marks";
import { tr, type StringKey } from "./strings";

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
  return s?.asGuardian ? `${s.author.label}, cat guardian` : "Syros Cats";
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
  const words = lives === null ? "Not known" : LIVES_WORD[lives];
  return esc(words) + (l.notSeenSince ? `<br><span class="meta">Not seen since ${esc(monthYear(l.notSeenSince))}</span>` : "");
}

/** Who the coat's answer rests on: the machine, a person, or spotters. */
function colourSource(v: TeamCatView): string | null {
  const counting = v.appearance.coat.statements.filter((s) => s.counts);
  const person = counting.find((s) => s.source === "team" || s.source === "guardian");
  if (person) return person.source === "guardian" ? `set by ${person.author.label}, cat guardian` : `set by ${person.author.label}`;
  if (counting.some((s) => s.source === "machine")) return "read from the photo";
  if (counting.some((s) => s.source === "spotter")) return "from spotters' photos";
  return null;
}

/** The coat in the Cats grid's words (SYC-398 §2): the colours, then the pattern unless Plain. */
export function coatWordsOf(v: TeamCatView): string[] {
  const parts = v.appearance.coat.parts;
  return [
    ...(parts?.colours.value ?? []).map((c) => tr(undefined, `coat.${c}` as StringKey)),
    ...(parts?.pattern.value && parts.pattern.value !== "plain"
      ? [tr(undefined, `pattern.${parts.pattern.value}` as StringKey)]
      : []),
  ];
}

function colourFact(v: TeamCatView): string {
  const words = coatWordsOf(v);
  if (words.length === 0) return '<a href="#appearance">Not known</a>';
  const source = colourSource(v);
  return (
    `<a href="#appearance">${words.map((w) => `<span class="colourchip">${esc(w)}</span>`).join(" ")}</a>` +
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

const VACCINE: Record<Exclude<Vaccine, { other: string }>, string> = {
  rabies: "Rabies",
  cat_flu_enteritis: "Cat flu and enteritis",
};

const vaccineWord = (x: Vaccine) => (typeof x === "string" ? VACCINE[x] : x.other);

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
    { label: "Colour", html: colourFact(v) },
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
