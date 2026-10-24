import { placeLabel } from "../areas/placeLabel";
import type { Confidence, Vaccine } from "../resolve";
import { LIFE } from "./catActions";
import { markOf, type Lives } from "../teamCatList";
import type { TeamCatView, TeamResolved, TeamStatement } from "../teamCatView";
import { escapeHtml as esc } from "./escape";
import { lastSeenWords } from "./lastSeen";
import { markBadge, markWithWords } from "./marks";
import { place } from "./position";
import { coatIsUnknown, coatWordsFor } from "./teamCoatWords";

// The answer first (SYC-396 spec §7.1): a row of plain facts at the top of the
// team cat page, each a label and a value. Where a fact is uncertain the words
// say so ("Probably…", "Not known"). There is no separate confidence tag that
// could contradict the value. Each value is trusted HTML: fixed words, and
// data only through escapeHtml.
//
// Not shown yet, because nothing records it: "checked in person by the cat
// guardian" (SYC-400).

export interface CatFact {
  label: string;
  /** Trusted HTML. */
  html: string;
  /** The grey line under the value saying where it comes from. Plain text. */
  source?: string;
  /** The folded "Why we think so", trusted HTML (a `<details>`). */
  why?: string;
}

/**
 * The statements the history on the page shows; null when it shows every one.
 * A link to a statement left out reloads the page with the full list. (Defined
 * here, where the facts use it; catPages.ts re-exports it.)
 */
export type Shown = ReadonlySet<number> | null;

export interface FactsOpts {
  byId: Map<number, TeamStatement>;
  shown: Shown;
  /** An island-wide viewer: "First recorded in …" carries an "Open map" link. */
  island?: boolean;
}

export const statementHref = (id: number, shown: Shown) =>
  shown === null || shown.has(id) ? `#s-${id}` : `?history=all#s-${id}`;

/** Who said it, as the history shows it: "Eleni, cat guardian" for a guardian's word. */
export const byWhom = (s: TeamStatement) => (s.asGuardian ? `${s.author.label}, cat guardian` : s.author.label);

const time = (iso: string, text: string) => `<time datetime="${esc(iso)}">${esc(text)}</time>`;

const dd = (label: string, value: string) => `<dt>${esc(label)}</dt><dd>${value}</dd>`;

/**
 * The statements an answer rests on, in words: what was said, by whom and
 * when, each linking to its place in the history. Never a record number.
 */
function statementRefs(ids: number[], byId: Map<number, TeamStatement>, shown: Shown): string {
  if (ids.length === 0) return "Nothing yet";
  return (
    '<ul class="refs">' +
    ids
      .map((id) => {
        const s = byId.get(id);
        if (!s) return `<li><a href="${statementHref(id, shown)}">An earlier change</a></li>`;
        return (
          `<li><a href="${statementHref(id, shown)}">${esc(s.said)}</a> ` +
          `<span class="meta">(${esc(byWhom(s))}, ${time(s.createdAt, day(s.createdAt))})</span></li>`
        );
      })
      .join("") +
    "</ul>"
  );
}

/** The records' own answer, short, its uncertainty in the words (spec §7.2: no tag beside it). */
function sterilisedText(s: { value: boolean | null; confidence: Confidence }): string {
  if (s.value === null || s.confidence === "unknown") return "Not known yet";
  if (s.value) {
    if (s.confidence === "likely") return "Probably sterilised";
    if (s.confidence === "reported") return "Reported sterilised";
    return "Sterilised";
  }
  return s.confidence === "reported" ? "Reported not sterilised" : "Not sterilised";
}

/** "Status", "Since", "Why we think so" and "Says otherwise" for one answer, as rows. */
function evidenceRows<T>(r: TeamResolved<T>, o: FactsOpts, status: string): string {
  return (
    dd("Status", esc(status)) +
    // The resolver dates "nothing known" at the epoch (SYC-270): no date then.
    (Date.parse(r.asOf) > 0 ? dd("Since", time(r.asOf, day(r.asOf))) : "") +
    dd("Why we think so", statementRefs(r.supportingStatementIds, o.byId, o.shown)) +
    (r.conflictingStatementIds.length
      ? dd("Says otherwise", `<div class="bad">${statementRefs(r.conflictingStatementIds, o.byId, o.shown)}</div>`)
      : "")
  );
}

// It opens by itself when something says otherwise, so a disagreement is never hidden.
const whyBlock = (rows: string, extra = "", open = false) =>
  `<details class="why"${open ? " open" : ""}><summary>Why we think so</summary><dl>${rows}</dl>${extra}</details>`;

/**
 * "Confirmed by Eleni, cat guardian, 14 October" (SYC-53 PR 2.2; spec §7.2):
 * when a cat guardian's statement decides the sterilisation answer, the team
 * sees whose word it is, and *This is wrong* (Mark wrong) is on that
 * statement in the history.
 */
function guardianConfirmed(r: TeamResolved<boolean>, o: FactsOpts): string {
  if (r.confidence !== "confirmed") return "";
  const s = o.byId.get(r.supportingStatementIds[0] ?? -1);
  if (!s || !s.asGuardian) return "";
  return dd(
    "Confirmed by",
    `${esc(byWhom(s))}, ${time(s.createdAt, day(s.createdAt))} · ` +
      `<a href="${statementHref(s.id, o.shown)}">This is wrong?</a>`,
  );
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

/** Where the cat lives, in the Cats grid's words; "Not known" when nothing says. */
function livesWords(v: TeamCatView): string {
  const l = v.records.lifeStatus;
  const lives: Lives | null = l.presumedDeceased || l.value === "deceased" ? "gone" : l.value;
  // Presumed, not known: the records only say it hasn't been seen for years.
  return lives === null
    ? "Not known"
    : l.presumedDeceased && l.value !== "deceased"
      ? "Probably no longer with us"
      : LIVES_WORD[lives];
}

function livesFact(v: TeamCatView): string {
  const l = v.records.lifeStatus;
  return esc(livesWords(v)) + (l.notSeenSince ? `<br><span class="meta">Not seen since ${esc(monthYear(l.notSeenSince))}</span>` : "");
}

/**
 * The one line under the cat's name (spec 3.1): the sterilisation mark and
 * word, where it lives, its colony as a link (left out when it has none), and
 * when it was last seen, in the Last seen fact's own words.
 */
export function statusLine(v: TeamCatView, now: Date): string {
  const last = v.sightings[0] ?? null;
  const parts = [
    markBadge(markOf(v.records.sterilised)),
    esc(livesWords(v) === LIVES_WORD.street ? "Lives on the street" : livesWords(v)),
    ...(v.colony ? [`<a href="/api/team/colonies/${v.colony.id}">${esc(v.colony.name)}</a>`] : []),
    esc(lastSeenWords(last ? new Date(last.at) : null, now)),
  ];
  // The separator belongs to the part before it, so a wrapped line never starts with a dot.
  const spans = parts.map((p, i) => `<span class="sl">${p}${i < parts.length - 1 ? " ·" : ""}</span>`);
  return `<p class="statusline">${spans.join(" ")}</p>`;
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
  return v.colony
    ? `<a href="/api/team/colonies/${v.colony.id}">${esc(v.colony.name)}</a>` +
        (v.colony.wasName ? ` <span class="meta">(was “${esc(v.colony.wasName)}”)</span>` : "")
    : "No colony";
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

/** "Set by Maria, 14 Oct 2026": whose word the answer rests on, or how it was worked out. */
function livesSource(v: TeamCatView, o: FactsOpts): string {
  const s = o.byId.get(v.records.lifeStatus.supportingStatementIds[0] ?? -1);
  if (!s) return "Worked out from the sightings";
  if (s.author.kind === "spotter") return "Set by a spotter";
  if (s.author.kind === "system") return "Set automatically";
  return `Set by ${byWhom(s)}, ${day(s.createdAt)}`;
}

/** "Seen 21 times since April": this year's months by name, an earlier year with its year. */
function seenSource(v: TeamCatView, now: Date): string | undefined {
  const oldest = v.sightings[v.sightings.length - 1];
  if (!oldest) return undefined;
  if (v.sightings.length === 1) return "Seen once";
  const at = new Date(oldest.at);
  const inYear = (d: Date) => d.toLocaleDateString("en-GB", { year: "numeric", timeZone: "Europe/Athens" });
  const since =
    inYear(at) === inYear(now)
      ? at.toLocaleDateString("en-GB", { month: "long", timeZone: "Europe/Athens" })
      : monthYear(oldest.at);
  return `Seen ${v.sightings.length} times since ${since}`;
}

function ownerFact(v: TeamCatView): CatFact | null {
  const o = v.owner;
  // D13: after an owner deletes their data the note and pin stay, with no
  // owner link, so show them whenever they are stored: a stored note or pin
  // always means the cat has a home (lib/teamCatView.ts).
  if (!o.has && !o.orphanedHome && !o.homeDescription && !o.homePin) return null;
  const note =
    o.has || o.homeDescription || o.homePin
      ? `<br><span class="meta">${esc(o.has ? "Where the owner says the cat lives" : "Where the cat lives, from a past owner")}: ${o.homeDescription ? esc(o.homeDescription) : "No note"}</span>`
      : "";
  const pin = o.homePin ? `<br><span class="meta">Home pin: ${esc(`Pinned, in ${placeLabel(o.homePin)}`)}</span>` : "";
  return {
    label: "Owner",
    html:
      esc(o.has ? "Has an owner" : o.orphanedHome ? "Has a home, but the owner deleted their data" : "Has a home, no owner on record") +
      note +
      pin,
  };
}

/**
 * The newest team note that still stands (SYC-602 spec §3.1): not marked wrong
 * and not itself the "Marked wrong" row. A newer note wins; one marked wrong
 * drops out and the next older shows. Null when there is none.
 */
export function healthNoteOf(v: TeamCatView): TeamStatement | null {
  const standing = v.history.filter(
    (h) => h.kind === "team_note" && h.replaces === null && h.replacedBy.length === 0 && h.noteText !== undefined,
  );
  if (standing.length === 0) return null;
  return standing.reduce((best, h) => (Date.parse(h.createdAt) > Date.parse(best.createdAt) || (h.createdAt === best.createdAt && h.id > best.id) ? h : best));
}

function healthNoteFact(v: TeamCatView): CatFact | null {
  const n = healthNoteOf(v);
  if (!n || n.noteText === undefined) return null;
  return {
    label: "Health note",
    // Escaped first, then the line breaks: the only markup is ours.
    html: esc(n.noteText).replace(/\r?\n/g, "<br>"),
    source: `${n.author.label}, ${day(n.createdAt)} · team only`,
  };
}

export function catFacts(v: TeamCatView, now: Date, opts: FactsOpts): CatFact[] {
  const vaccinated = vaccinatedFact(v);
  const records = v.records;
  const clipped = records.sterilised.clippedTipSightings;
  const owner = ownerFact(v);
  const health = healthNoteFact(v);
  const lastSource = seenSource(v, now);
  return [
    {
      label: "Sterilised",
      html: sterilisedFact(v),
      why: whyBlock(
        evidenceRows(records.sterilised, opts, sterilisedText(records.sterilised)) +
          guardianConfirmed(records.sterilised, opts) +
          dd(
            "Clipped ear",
            clipped === 0 ? "Not seen in any sighting" : esc(`Seen in ${clipped} sighting${clipped === 1 ? "" : "s"}`),
          ),
        "",
        records.sterilised.conflictingStatementIds.length > 0,
      ),
    },
    {
      label: "Lives",
      html: livesFact(v),
      source: livesSource(v, opts),
      why: whyBlock(
        evidenceRows(records.lifeStatus, opts, records.lifeStatus.value ? LIFE[records.lifeStatus.value] : "Not known") +
          (records.lifeStatus.presumedDeceased
            ? dd("Note", "Not seen for over three years. The public sees “Not seen since…”, never that it may have died.")
            : ""),
        `<p class="meta">First recorded in ${place(v.cat.lat, v.cat.lng, { link: opts.island === true })}, ${time(v.cat.createdAt, day(v.cat.createdAt))}</p>`,
        records.lifeStatus.conflictingStatementIds.length > 0,
      ),
    },
    ...(owner ? [owner] : []),
    { label: "Coat", html: colourFact(v) },
    { label: "Colony", html: colonyFact(v) },
    { label: "Last seen", html: lastSeenFact(v, now), ...(lastSource ? { source: lastSource } : {}) },
    ...(vaccinated ? [{ label: "Vaccinated", html: vaccinated }] : []),
    ...(health ? [health] : []),
  ];
}

/** The facts panel as HTML: a row per fact, its source under the value, its evidence folded. */
export function renderCatFacts(v: TeamCatView, now: Date, opts: FactsOpts): string {
  return (
    '<h2 class="sr">What we know about this cat</h2><dl class="catfacts">' +
    catFacts(v, now, opts)
      .map(
        (f) =>
          `<div class="fact"><dt>${esc(f.label)}</dt><dd>${f.html}` +
          (f.source ? `<span class="how">${esc(f.source)}</span>` : "") +
          (f.why ?? "") +
          "</dd></div>",
      )
      .join("") +
    "</dl>"
  );
}
