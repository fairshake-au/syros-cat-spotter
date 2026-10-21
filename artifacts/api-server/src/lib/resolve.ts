/**
 * The resolver (cat-record-data-spine.md §10.2, DECISIONS.md Part 2c/2g/2h).
 *
 * Pure: no database, no I/O. Every status a cat page, a push, a dashboard or
 * the nightly email job shows is derived here from the append-only
 * `observations` row list PR 2's `loadCatRecords` reads — never stored.
 *
 * This file is where the design risk in the whole data spine lives (plan
 * `docs/superpowers/plans/data-spine.md`, PR 1): a wrong confidence level
 * looks exactly like a right one, and every later PR trusts this logic.
 * Every rule below is named in §10.2 and §10.8 and has a named test in
 * `resolve.test.ts` with the same name.
 */
import type { Observation } from "@workspace/db/schema";
import { TEAM_ROLES, isTeamRole } from "./teamRoles";
import type { CoatColour, CoatPattern, Mark } from "./appearance";
import { COAT_COLOURS, COAT_PATTERNS, MARKS, readCoatValue } from "./appearance";
import { todayInStreakTimezone } from "./streak";

export type Confidence = "confirmed" | "likely" | "reported" | "unknown";

export interface Resolved<T> {
  value: T | null;
  confidence: Confidence;
  /** Which observations produced this value, for display. */
  supportingObservationIds: number[];
  /** Disagreements worth a team's attention. Never shown to the public. */
  conflicts: number[];
  /** The date this value was derived from, ISO 8601. */
  asOf: string;
}

export type LifeStatusValue = "street" | "homed" | "in_care" | "deceased";

const LIFE_STATUS_VALUES: readonly LifeStatusValue[] = [
  "street",
  "homed",
  "in_care",
  "deceased",
];

/**
 * The sources `loadCatRecords` (PR 2) can report evidence of life from,
 * exported as a typed const so PR 2 and this resolver share one vocabulary
 * instead of agreeing on a string by convention. `"sighting"` is the one
 * value this resolver inspects by name (§3.2's clearing rule, via
 * `lastSightingAt` below); every other label is used only for its date.
 *
 * Amended 3 Oct 2026, Samuel: the original `{at, source}` shape collapsed
 * every kind of evidence into a single newest instant, which meant a
 * welfare report or an ear-tip answer dated after the true clearing
 * sighting hid that sighting from the resolver entirely (§3.2's rule only
 * ever talks about sightings). `lastSightingAt` was added so the clearing
 * rule can be checked on its own, regardless of what the overall newest
 * evidence of life turned out to be.
 */
export const EVIDENCE_SOURCES = [
  "sighting",
  "life_status",
  "sterilised",
  "ear_tip",
  "welfare_report",
  // SYC-396 PR 3.0 (team-dashboard-redesign.md §8.3, amending spine §3.4):
  // a vet visit that still stands.
  "vet_visit",
  "import",
  "created",
] as const;

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/**
 * The newest thing that tells us this cat was alive, computed by PR 2's
 * `loadCatRecords` from §3.4's sources other than `life_status` itself (a
 * resolved sighting; a `sterilised` record; an `ear_tip` observation; a
 * `welfare_report`; failing all of those, the cat's `created_at`). A
 * non-superseded `life_status` of street, homed or in care is also evidence
 * of life, but this resolver already has those directly (it's resolving
 * them) and folds them in itself — PR 2's loader doesn't need to.
 *
 * `at`/`source` is the newest evidence of life of any kind — used only for
 * the 36-month presumed-deceased threshold. `lastSightingAt` is a second,
 * narrower fact: the newest *resolved sighting* specifically, whatever its
 * relationship to `at` — used only for §3.2's "a sighting after a deceased
 * statement clears it" rule. A `colony`, `note`, `name`, `food_and_water`,
 * `coat`, `markings`, `vaccinated` or `team_note` observation must never
 * reach either field, because none of those imply the cat is alive (§3.4) —
 * that filtering is `loadCatRecords`'s job, not this function's.
 *
 * `at` and `lastSightingAt` are `Date`, not strings: PR 2's loader reads
 * these from Drizzle, which already hands back `Date` objects, and an
 * untyped string input let an unparseable or zone-less value skew the
 * 36-month threshold or throw inside the resolver (caught in review).
 */
export interface EvidenceOfLife {
  at: Date;
  source: EvidenceSource;
  lastSightingAt: Date | null;
}

export interface LifeStatusResolved extends Resolved<LifeStatusValue> {
  presumedDeceased: boolean;
  /** ISO date (or null). Never shown as "presumed deceased" — §3.4. */
  notSeenSince: string | null;
}

export interface CatSnapshot {
  lifeStatus: LifeStatusValue;
  lifeStatusConfidence: Confidence;
  lifeStatusAsOf: string;
  presumedDeceased: boolean;
  notSeenSince: string | null;
  sterilised: {
    value: boolean | null;
    confidence: Confidence;
    asOf: string;
    /** For the API's `clippedTipSightings` (§4.3). */
    clippedTipSightings: number;
  };
  /**
   * SYC-2 (spec §10.2), as two parts since SYC-398
   * (coat-colours-and-pattern.md §4, §6): the colours and the pattern, each
   * resolved on its own. Team-side: the public payload copies out only the
   * values, never confidence, authors, counts or check reasons. Never
   * notifiable (data spine §9.3) and never read by the matcher.
   */
  coatColours: AppearanceResolved<CoatColour[]>;
  coatPattern: AppearanceResolved<CoatPattern | null>;
  markings: AppearanceResolved<Mark[]>;
  /** Team-only, at launch and in every public payload (spec §6.3). */
  vaccinations: VaccinationRecord[];
}

/**
 * Records-import.md §2.5's "waiting pool" of import rows not yet linked to
 * any cat. Once §2.5 is built, a pool record the team has matched to this
 * cat but not yet formally linked becomes authoritative evidence here too.
 * Nothing produces one today — the import is optional and post-MVP (data
 * spine plan, "What's out") — so every phase-1 caller passes `[]`, and
 * `resolveCat` never exposes the parameter at all. An already-*linked*
 * import record is not this: linking writes a `sterilised` observation with
 * `provenance: "import"` (records-import.md §3), which the ordinary
 * authoritative-assertion rule below already covers.
 */
export interface ImportRecord {
  id: number;
  sterilised: boolean;
  observedAt: string;
}

/**
 * The exact shape of a cat guardian's scope (plan Decision B; roles spec
 * §10.4): `colony:<id>`, written only by the server, valid only with the
 * role `guardian`.
 */
export const COLONY_SCOPE_PATTERN = /^colony:[1-9][0-9]*$/;

/**
 * Who wins when people disagree (Decision G; Samuel, 12 and 13 October 2026;
 * roles spec §7.2 and §10.4; data spine §4.6 and §10.2):
 *
 *   4  a vet
 *   3  an owner (`authorityScope` = `owner_of_this_cat`)
 *   2  a cat guardian (role `guardian` with a `colony:<id>` scope)
 *   1  the team (`staff`, `management`) and imported records
 *   0  anything else: counts for nothing
 *
 * The highest level present decides; the newest wins only within a level.
 * Management ranks with the team, not above it, and imports rank with the
 * team.
 */
export type AuthorityLevel = 0 | 1 | 2 | 3 | 4;

/** The fields `authorityLevel` reads, so callers needn't build a whole row. */
export type Rankable = Pick<Observation, "roleAtTime" | "authorityScope" | "provenance">;

type Dated = Rankable & Pick<Observation, "observedAt" | "id">;

/**
 * The ONE ranking function (SYC-53 plan, PR 0.2). Every rule in this file
 * that ranks statements uses it, and SYC-2's colour and markings rules use
 * it through {@link appearanceAuthorityLevel}. It replaced the two boolean
 * helpers `isAuthoritative` and `isAuthoritativeRole`.
 *
 * A `colony:` scope on any role but `guardian` makes the row count for
 * nothing, whatever the role (roles spec §10.4: "the resolver never treats
 * it as authority for a non-guardian"). `writeObservation` refuses to write
 * one; this is the read-time backstop. It checks the prefix, so a malformed
 * `colony:` scope on a team row is nothing too, never "team".
 */
export function authorityLevel(o: Rankable): AuthorityLevel {
  const scope = o.authorityScope ?? "none";
  if (scope.startsWith("colony:") && o.roleAtTime !== "guardian") return 0;
  if (o.roleAtTime === "vet") return 4;
  if (scope === "owner_of_this_cat") return 3;
  if (o.roleAtTime === "guardian") return COLONY_SCOPE_PATTERN.test(scope) ? 2 : 0;
  if (TEAM_ROLES.has(o.roleAtTime) || o.provenance === "import") return 1;
  return 0;
}

/**
 * Colour and markings (data spine §10.2 "Colour and markings";
 * `coat-markings-and-health.md`): the same order, with the appearance
 * carve-out that vets, imported records and owners have no standing on a
 * cat's looks. Built for SYC-2's `resolveCoat` and `resolveMarkings` (SYC-2
 * plan, PR 1.2), so there is still one ranking function underneath.
 */
export function appearanceAuthorityLevel(o: Rankable): AuthorityLevel {
  if (o.roleAtTime === "vet") return 0;
  if (o.provenance === "import") return 0;
  if ((o.authorityScope ?? "none") === "owner_of_this_cat") return 0;
  return authorityLevel(o);
}

/**
 * The ear-tip rule's authority (§10.2 rule 3): the same order, but only for
 * the roles rule 3 names ("vet, staff, management, or `guardian` with a
 * `colony:<id>` scope"). Two exclusions, both kept from the old
 * `isAuthoritativeRole`:
 *
 * - an imported record never speaks about an ear: an import is a
 *   `sterilised` statement, and letting an import row clear a *Likely* back
 *   to *Unknown* is not something the spec grants it;
 * - an owner-scoped ear answer is a spotter's answer, not a statement (§4.1:
 *   "an owner is still not vet/staff"; test "ear-tip asymmetry"). Owners'
 *   ear-tip rows exist in no writer today; if SYC-130 gives them standing on
 *   the ear, that is a spec change, made here.
 */
function earTipAuthorityLevel(o: Rankable): AuthorityLevel {
  if (o.provenance === "import") return 0;
  if (o.roleAtTime !== "vet" && (o.authorityScope ?? "none") === "owner_of_this_cat") return 0;
  return authorityLevel(o);
}

/**
 * Does an authoritative `ear_tip { clipped: false }` (`no`, level 1 or
 * above under `earTipAuthorityLevel`) knock out a photo-backed
 * `clipped: true` (`clip`)? §10.2 rule 3, with Decision G:
 *
 * - A "no" that marks the clip wrong (`supersedesId`) needs no rule here:
 *   a superseded clip is not active, so it never reaches this function.
 * - A spotter's clip (level 0) is evidence, not a statement: the "no"
 *   knocks it out only if it is as new or newer (`>=`), exactly as before
 *   Decision G. A newer spotter clip after a team "not a clip" puts the cat
 *   back at *Likely*, which is how the review list reopens (§4.1).
 * - Between two statements with standing, the order decides: a higher
 *   level wins whatever the dates, and within a level the newest wins, an
 *   exact tie going to the later row. So a guardian's in-person "not a
 *   clip" outranks a team clip, and never a vet's.
 */
function clipCountered(no: Observation, clip: Observation): boolean {
  if (earTipAuthorityLevel(clip) === 0) {
    return no.observedAt.getTime() >= clip.observedAt.getTime();
  }
  return outranks(no, clip, earTipAuthorityLevel);
}

/**
 * Does `a` beat `b`? Highest level first; within a level, the newest by
 * `observedAt`; an exact tie goes to the later row (the higher id).
 */
export function outranks(
  a: Dated,
  b: Dated,
  level: (o: Rankable) => AuthorityLevel = authorityLevel,
): boolean {
  const la = level(a);
  const lb = level(b);
  if (la !== lb) return la > lb;
  const ta = a.observedAt.getTime();
  const tb = b.observedAt.getTime();
  if (ta !== tb) return ta > tb;
  return a.id > b.id;
}

/**
 * The statement that decides among those with any standing (level 1 or
 * above), or undefined if none has any. Callers pass the active rows of one
 * kind.
 *
 * Nothing in this file calls it yet: the sterilisation fold must also rank
 * not-yet-linked import records, so it reduces with `outranks` directly. It
 * is here for SYC-2 PR 1.2's `resolveCoat` and `resolveMarkings`, with
 * `appearanceAuthorityLevel` as the ranking.
 */
export function highestAuthority<T extends Dated>(
  list: readonly T[],
  level: (o: Rankable) => AuthorityLevel = authorityLevel,
): T | undefined {
  let best: T | undefined;
  for (const o of list) {
    if (level(o) === 0) continue;
    if (!best || outranks(o, best, level)) best = o;
  }
  return best;
}

/**
 * Not pointed at by any other observation's `supersedesId`.
 *
 * Redaction (§8.3/§8.5/§10.8.14) is deliberately NOT checked here. Deleting
 * a person clears their identifying columns and stamps `redactedAt`, but
 * the observation's *value* survives for every kind in this resolver's
 * vocabulary — only a `note`'s text is ever emptied (§8.3), and `note`
 * observations never reach this resolver at all. So a redacted
 * `ear_tip`/`sterilised`/`life_status` row is exactly as active as an
 * unredacted one; a row whose value genuinely has been emptied (the `note`
 * case, or any malformed value) is excluded naturally because it fails
 * `parseEarTip`/`parseSterilised`/`parseLifeStatus`, not because of
 * `redactedAt`. Spec test: "after deletion... the cat's derived sterilised
 * and life status are unchanged" (§8.5, §10.8.14).
 */
function isActive(o: Observation, all: readonly Observation[]): boolean {
  return !all.some((other) => other.supersedesId === o.id);
}

/** The kinds a vet visit writes, whose undo puts back what it replaced
 * (SYC-396 PR 3.0; plan Decision 6). */
export type RestorableKind = "sterilised" | "vaccinated" | "vet_visit";

/** What {@link supersedeChains} works out for one kind. */
export interface SupersedeChains {
  /** The rows that stand: nothing standing in effect supersedes them, and
   * they aren't retractions (a retraction asserts nothing). */
  standing: Observation[];
  /** Rows a supersession in effect points at: they no longer stand. A row
   * whose only superseder was retracted is not here. */
  displaced: ReadonlySet<number>;
  /** Rows an effective retraction points at. Their own supersession is
   * undone, and they are never evidence of anything. */
  retracted: ReadonlySet<number>;
}

/**
 * The supersede chains of one restorable kind, walked from their newest end
 * (plan Task 3.0.2):
 *
 * - a row is **retracted** when a `{ retracted: true }` that is not itself
 *   retracted supersedes it;
 * - a row is **displaced** when any superseder that is not retracted points
 *   at it: so a retracted row's own supersession stops counting, and the row
 *   it had replaced stands again;
 * - the rest, less the retractions, stand.
 *
 * G ← Y gives Y; G ← Y ← R gives G; G ← Y ← R ← R2 gives Y; G ← Y ← Y2 gives
 * Y2. With no retraction among the rows, `displaced` is exactly "something
 * points at it", `isActive`'s rule, so no history without one changes.
 */
export function supersedeChains(observations: readonly Observation[], kind: RestorableKind): SupersedeChains {
  const rows = observations.filter((o) => o.kind === kind);
  // Every row pointing at one of this kind, whatever its own kind: a row of
  // another kind (no writer has made one since 13 Oct; older data unchecked)
  // still stands its target down exactly as `isActive` did (review of PR
  // 3.0, F3). Only a same-kind retraction undoes anything.
  const supersededBy = new Map<number, Observation[]>();
  for (const o of observations) {
    if (o.supersedesId == null) continue;
    supersededBy.set(o.supersedesId, [...(supersededBy.get(o.supersedesId) ?? []), o]);
  }
  const memo = new Map<number, boolean>();
  // Ids grow along a chain (a row supersedes one already written), so the
  // recursion ends; `memo` keeps each row to one visit.
  const isRetracted = (id: number): boolean => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    memo.set(id, false);
    const result = (supersededBy.get(id) ?? []).some(
      (r) => r.kind === kind && isRetractionValue(r.value) && !isRetracted(r.id),
    );
    memo.set(id, result);
    return result;
  };
  const displaced = new Set<number>();
  const retracted = new Set<number>();
  for (const o of rows) {
    if (isRetracted(o.id)) retracted.add(o.id);
    if ((supersededBy.get(o.id) ?? []).some((s) => s.kind !== kind || !isRetracted(s.id))) displaced.add(o.id);
  }
  return {
    standing: rows.filter((o) => !displaced.has(o.id) && !isRetractionValue(o.value)),
    displaced,
    retracted,
  };
}

/** For "sterilised" | "vaccinated" | "vet_visit". A row stands unless a standing row supersedes it.
 * A `{ retracted: true }` row supersedes its target and asserts nothing itself;
 * when the target it retracts had itself superseded an earlier row, that earlier row stands again.
 * Computed by walking each supersede chain from its newest end. Every other kind keeps `isActive`. */
export function standingRows(observations: readonly Observation[], kind: RestorableKind): Observation[] {
  return supersedeChains(observations, kind).standing;
}

function toIso(d: Date | string): string {
  return typeof d === "string" ? new Date(d).toISOString() : d.toISOString();
}

function newestByObservedAt<T extends Observation>(
  list: readonly T[],
): T | undefined {
  if (list.length === 0) return undefined;
  return list.reduce((newest, candidate) => {
    const newestAt = newest.observedAt.getTime();
    const candidateAt = candidate.observedAt.getTime();
    if (candidateAt > newestAt) return candidate;
    // Deterministic tie-break: the higher id is the later write.
    if (candidateAt === newestAt && candidate.id > newest.id) return candidate;
    return newest;
  });
}

interface LifeStatusValueShape {
  status: LifeStatusValue;
}

function parseLifeStatus(value: unknown): LifeStatusValueShape | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    LIFE_STATUS_VALUES.includes((value as { status: unknown }).status as LifeStatusValue)
  ) {
    return value as LifeStatusValueShape;
  }
  return null;
}

interface SterilisedValueShape {
  sterilised: boolean;
}

function parseSterilised(value: unknown): SterilisedValueShape | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "sterilised" in value &&
    typeof (value as { sterilised: unknown }).sterilised === "boolean"
  ) {
    return value as SterilisedValueShape;
  }
  return null;
}

interface EarTipValueShape {
  clipped: true | false | "cant_tell";
}

function parseEarTip(value: unknown): EarTipValueShape | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "clipped" in value &&
    (() => {
      const c = (value as { clipped: unknown }).clipped;
      return c === true || c === false || c === "cant_tell";
    })()
  ) {
    return value as EarTipValueShape;
  }
  return null;
}

/** A statement a vet visit wrote: its value names the visit (SYC-396 PR 3.1a). */
function isFromVisit(value: unknown): boolean {
  return typeof value === "object" && value !== null && typeof (value as { vetVisitId?: unknown }).vetVisitId === "number";
}

/** Before any date exists to derive from. Never shown; only a fallback for "nothing at all". */
const EPOCH = new Date(0).toISOString();

/**
 * Sterilised — an ordered fold, not independent clauses (§10.2).
 *
 * 1. Discard superseded observations (redaction does not discard anything
 *    here — see `isActive`'s doc comment).
 * 2. Authoritative assertions (any `authorityLevel` above 0: vet, owner,
 *    cat guardian with a `colony:<id>` scope, staff/management, or
 *    `provenance: "import"`) — the highest level present decides, and the
 *    newest by `observedAt` within it wins, whatever sign (Decision G),
 *    after setting aside every `false` that a `true` with standing is dated
 *    strictly later than (SYC-315 B: a newer "sterilised" always wins).
 *    A standing statement from a vet visit (its value carries `vetVisitId`)
 *    decides over all of that (SYC-543): see the rule in the fold.
 * 3. Otherwise, a photo-backed `ear_tip { clipped: true }` reaches *likely*,
 *    unless an authoritative `clipped: false` (§10.2 rule 3: never an
 *    import — see `earTipAuthorityLevel`) beats it: see `clipCountered`.
 * 4. Otherwise, *unknown*.
 *
 * Rule 1 (the ear-tip asymmetry) falls out of this by construction: a
 * spotter's `clipped: false` / `"cant_tell"` is never authoritative, so it
 * never reaches step 2 and never overrides step 3's survivors. It is still
 * collected into `supportingObservationIds` for display (§4.1).
 *
 * J2 (Samuel, flagged to the team): when an authoritative negative wins at
 * step 2 but a *newer* photo-backed clipped-tip observation also exists,
 * the public answer stays the authoritative negative (§4.6: nothing beats
 * an authoritative assertion except a newer authoritative one) — but that
 * newer clip is surfaced in `conflicts` so the team sees it rather than it
 * silently vanishing into "we already said no".
 */
export function resolveSterilised(
  observations: readonly Observation[],
  importRecords: readonly ImportRecord[] = [],
): Resolved<boolean> {
  // Sterilisation statements stand by the restore rule (an undone vet visit
  // puts back the statement it overruled); ear tips keep `isActive`.
  const standingSterilised = new Set(standingRows(observations, "sterilised").map((o) => o.id));
  const active = observations.filter((o) =>
    o.kind === "sterilised" ? standingSterilised.has(o.id) : isActive(o, observations),
  );

  // Step 2: authoritative sterilised assertions (phase 1: observations only;
  // importRecords is always [] today — see ImportRecord's doc comment).
  // Each candidate carries the one observation id supporting it (or none,
  // for a not-yet-linked import record), so the newest-wins fold works the
  // same way regardless of where the assertion came from.
  // `rank` is what `outranks` compares: the observation itself, or, for a
  // not-yet-linked import record, a stand-in that ranks with the team.
  type Candidate = {
    sterilised: boolean;
    at: Date;
    rank: Dated;
    observationId: number | null;
    /** Written by a vet visit that stands (its value carries `vetVisitId`). */
    fromVisit: boolean;
  };
  const authoritative: Candidate[] = active
    .filter((o) => o.kind === "sterilised" && authorityLevel(o) > 0)
    .flatMap((o) => {
      const parsed = parseSterilised(o.value);
      return parsed
        ? [{ sterilised: parsed.sterilised, at: o.observedAt, rank: o, observationId: o.id, fromVisit: isFromVisit(o.value) }]
        : [];
    });
  // A not-yet-linked import record ranks with the team (Decision G). Its
  // stand-in id is 0, below every real row (ids are serial from 1), so at
  // the same instant a cat's own record beats it.
  const fromImport: Candidate[] = importRecords.map((r) => {
    const at = new Date(r.observedAt);
    return {
      sterilised: r.sterilised,
      at,
      rank: { roleAtTime: "system", authorityScope: "none", provenance: "import", observedAt: at, id: 0 },
      observationId: null,
      fromVisit: false,
    };
  });
  // SYC-315, option B (Samuel, 16 October 2026): a newer "sterilised" beats
  // any older "not sterilised", whoever said either, because the operation
  // can't be undone. So a `false` that some `true` with standing is dated
  // strictly later than is set aside before anything is ranked: it was true
  // when it was said, and is no longer a disagreement. A newer `false` is
  // kept and ranked as usual, so it beats an older `true` only from the same
  // level or higher (a guardian's later "isn't" never undoes a vet's
  // "sterilised"). Only sterilisation: the ear tip and life status keep the
  // plain order.
  const newestYesAt = Math.max(
    ...[...authoritative, ...fromImport].filter((c) => c.sterilised).map((c) => c.at.getTime()),
  );
  const candidates = [...authoritative, ...fromImport].filter(
    (c) => c.sterilised || !(c.at.getTime() < newestYesAt),
  );

  if (candidates.length > 0) {
    // Decision G (§4.6), through the one ordering (`outranks`): the highest
    // level present decides, and within it the newest by observedAt wins,
    // whatever sign it carries; an exact tie goes to the later row.
    // SYC-543 (Samuel, 21 October 2026): "a vet visit in which the cat was
    // sterilised should always prevail". While a visit's "yes" stands, it
    // decides, whoever said "not sterilised" and whenever, even after the
    // visit. Only standing rows reach here, so an undone visit decides
    // nothing and the rest rank as before. Each "no" it outweighs stays a
    // conflict, so the team sees it under "Says otherwise".
    const visitYes = candidates.filter((c) => c.fromVisit && c.sterilised);
    const winner = (visitYes.length > 0 ? visitYes : candidates).reduce((best, candidate) =>
      outranks(candidate.rank, best.rank) ? candidate : best,
    );
    const disagreeingConflicts = candidates
      .filter((c) => c !== winner && c.sterilised !== winner.sterilised)
      .flatMap((c) => (c.observationId != null ? [c.observationId] : []));

    // J2: a newer photo-backed clipped-tip observation doesn't move the
    // winning authoritative answer, but is flagged for the team.
    const newerClips = active
      .filter((o) => o.kind === "ear_tip" && o.observedAt.getTime() > winner.at.getTime())
      .flatMap((o) => {
        const parsed = parseEarTip(o.value);
        return parsed?.clipped === true && o.photoId != null ? [o.id] : [];
      });

    const conflicts = [...disagreeingConflicts, ...newerClips];

    return {
      value: winner.sterilised,
      confidence: "confirmed",
      supportingObservationIds: winner.observationId != null ? [winner.observationId] : [],
      conflicts,
      asOf: toIso(winner.at),
    };
  }

  // Step 3: photo-backed ear-tip evidence, only when nothing authoritative exists.
  const earTip = active.flatMap((o) => {
    if (o.kind !== "ear_tip") return [];
    const parsed = parseEarTip(o.value);
    return parsed ? [{ o, clipped: parsed.clipped }] : [];
  });

  const clippedTrueWithPhoto = earTip.filter(
    (e) => e.clipped === true && e.o.photoId != null,
  );
  const authoritativeFalse = earTip.filter(
    (e) => e.clipped === false && earTipAuthorityLevel(e.o) > 0,
  );

  const survivors = clippedTrueWithPhoto.filter(
    (candidate) => !authoritativeFalse.some((af) => clipCountered(af.o, candidate.o)),
  );

  // Every ear-tip statement is collected for display (§4.1: "the cat page
  // shows how many people have said it"), whatever its effect on the level.
  const supportingObservationIds = earTip.map((e) => e.o.id);

  if (survivors.length > 0) {
    const newest = newestByObservedAt(survivors.map((s) => s.o))!;
    return {
      value: true,
      confidence: "likely",
      supportingObservationIds,
      conflicts: [],
      asOf: toIso(newest.observedAt),
    };
  }

  return {
    value: null,
    confidence: "unknown",
    supportingObservationIds,
    conflicts: [],
    asOf: earTip.length > 0 ? toIso(newestByObservedAt(earTip.map((e) => e.o))!.observedAt) : EPOCH,
  };
}

/** For the API's `clippedTipSightings` (§4.3): how many people have said it,
 * whatever a later correction did to the level. */
export function clippedTipCount(observations: readonly Observation[]): number {
  return observations.filter((o) => {
    if (o.kind !== "ear_tip" || !isActive(o, observations)) return false;
    const parsed = parseEarTip(o.value);
    return parsed?.clipped === true && o.photoId != null;
  }).length;
}

const PRESUMED_DECEASED_MONTHS = 36;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/**
 * Life status (§10.2, §3.2, §3.4).
 *
 * The newest non-superseded `life_status` observation wins — except that a
 * resolved sighting dated after a live `deceased` observation clears it in
 * the same read, returning `street` with the disagreement in `conflicts`.
 * `presumedDeceased` is true when the newest evidence of life is more than
 * 36 months old and the resolved status isn't `deceased` (a live `deceased`
 * statement suppresses the derivation entirely, §3.4).
 *
 * B2 (Samuel, 3 Oct 2026): the clearing check uses `evidenceOfLife.lastSightingAt`
 * specifically, never `evidenceOfLife.at`/`source` — §3.2 is a rule about
 * sightings, not about "whatever the newest evidence of life happened to
 * be". A welfare report or an ear-tip answer dated after the clearing
 * sighting must not hide that sighting from this rule.
 */
// Not ranked by authorityLevel yet: newest wins until SYC-130 can check who an owner is (Samuel, 14 Oct 2026).
export function resolveLifeStatus(
  observations: readonly Observation[],
  evidenceOfLife: EvidenceOfLife | null,
  now: Date,
): LifeStatusResolved {
  const active = observations.filter(
    (o) => o.kind === "life_status" && isActive(o, observations),
  );
  const parsed = active.flatMap((o) => {
    const v = parseLifeStatus(o.value);
    return v ? [{ o, status: v.status }] : [];
  });
  const newest = newestByObservedAt(parsed.map((p) => p.o));
  const newestEntry = newest ? parsed.find((p) => p.o.id === newest.id) : undefined;

  let value: LifeStatusValue = newestEntry ? newestEntry.status : "street";
  // Every life_status write comes from someone §3.2 authorises for this cat
  // (enforced upstream by PR 2's writeObservation, not here) — so any
  // non-superseded write is as good as confirmed. Nothing claimed at all is
  // the untouched default: street, unconfirmed.
  let confidence: Confidence = newestEntry ? "confirmed" : "unknown";
  let supportingObservationIds = newestEntry ? [newestEntry.o.id] : [];
  let conflicts: number[] = [];

  // S2 (Samuel decided): a death cleared by a sighting keeps
  // confidence: "confirmed" — it isn't touched below. The clearing sighting
  // itself has no observation id to add to supportingObservationIds
  // (EvidenceOfLife carries only a date, not an id); flagged in the PR body
  // for PR 2 to consider passing one through, rather than widening this
  // contract further on a guess.
  if (
    value === "deceased" &&
    newestEntry &&
    evidenceOfLife?.lastSightingAt != null &&
    evidenceOfLife.lastSightingAt.getTime() > newestEntry.o.observedAt.getTime()
  ) {
    conflicts = [newestEntry.o.id];
    value = "street";
    supportingObservationIds = [];
  }

  // A non-deceased life_status write is itself evidence of life (§3.4), and
  // unlike a sighting, sterilised record, ear-tip or welfare report, this
  // resolver already has it directly — it doesn't need PR 2's loader to
  // fold it into evidenceOfLife, and must not miss it if the loader's
  // evidenceOfLife happens to be stale (test: "a life_status newer than the
  // last evidence of life suppresses it").
  const lifeStatusEvidenceAt =
    newestEntry && newestEntry.status !== "deceased"
      ? newestEntry.o.observedAt.getTime()
      : null;

  let presumedDeceased = false;
  let notSeenSince: string | null = null;
  if (value !== "deceased") {
    const evidenceOfLifeAt = evidenceOfLife ? evidenceOfLife.at.getTime() : null;
    const candidates = [evidenceOfLifeAt, lifeStatusEvidenceAt].filter(
      (at): at is number => at != null,
    );
    if (candidates.length > 0) {
      const latestAt = Math.max(...candidates);
      const threshold = addMonths(new Date(latestAt), PRESUMED_DECEASED_MONTHS);
      if (now.getTime() > threshold.getTime()) {
        presumedDeceased = true;
        notSeenSince = new Date(latestAt).toISOString();
      }
    }
  }

  const asOf = newestEntry
    ? toIso(newestEntry.o.observedAt)
    : evidenceOfLife
      ? toIso(evidenceOfLife.at)
      : EPOCH;

  return {
    value,
    confidence,
    supportingObservationIds,
    conflicts,
    asOf,
    presumedDeceased,
    notSeenSince,
  };
}

// ---------------------------------------------------------------------------
// Appearance: colour and markings (data spine §10.2 "Colour and markings",
// coat-markings-and-health.md §4.2, plan SYC-2 PR 1.2).
// ---------------------------------------------------------------------------

/**
 * Who has standing to *state* a cat's colour or markings, as a Decision G
 * level (0 = none). The default is `appearanceAuthorityLevel` (SYC-53 PR
 * 0.2): a cat guardian with a `colony:<id>` scope (2) outranks the team and
 * management (1), and vets, imports and owners are 0. Kept a parameter so
 * tests can inject a ranking. A row with no standing may still be a
 * spotter's voice (see `isSpotterVoiceRow`).
 *
 * The appearance carve-out (`hasNoStandingOnAppearance`) is also applied by
 * the resolver before any ranking is consulted, so even a ranking that
 * ranks vets or owners highly can never give them standing here.
 */
export type AppearanceRanking = (o: Rankable) => AuthorityLevel;

/**
 * Vets, imported records and owners have no standing on colour or markings,
 * neither as authority nor as a voice (spec §4.2 rule 1; data spine §10.2
 * "`vet` and `import` rows are excluded"). Applied before the ranking.
 */
function hasNoStandingOnAppearance(o: Observation): boolean {
  return (
    o.roleAtTime === "vet" ||
    o.provenance === "import" ||
    o.authorityScope === "owner_of_this_cat"
  );
}

/** A spotter's voice: a public, person-made answer (volunteered or
 * prompted). Machine, team, guardian and system rows are never voices. */
function isSpotterVoiceRow(o: Observation): boolean {
  return (
    o.roleAtTime === "public" &&
    (o.provenance === "volunteered" || o.provenance === "prompted")
  );
}

function isRetractionValue(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { retracted?: unknown }).retracted === true
  );
}

/** The same author wrote both rows: the same device, or the same account.
 * A redacted row has neither, so it is never provably the same author. */
function isRedactedSpotterRow(o: Observation): boolean {
  return o.deviceId == null && o.accountId == null && o.roleAtTime === "public";
}

/**
 * A supersession the writer could only have made as the same author: the
 * same device or account, or (after "Delete my data" cleared both ends) two
 * redacted spotter rows, since a public write may only supersede its own
 * row (PR 1.1, C2). A cross-device link between two live devices is not.
 */
function sameAuthorLink(o: Observation, target: Observation): boolean {
  return sameAuthor(o, target) || (isRedactedSpotterRow(o) && isRedactedSpotterRow(target));
}

/**
 * One voice key per author chain, for every row of one appearance kind: a
 * device's rows share its key, and rows joined by a same-author
 * supersession share one key even when redaction has cleared the device.
 * Each redacted row outside any chain stays a voice of its own.
 */
export function appearanceVoiceKeys(
  observations: readonly Observation[],
  kind: "coat" | "markings",
): Map<number, string> {
  const rows = observations.filter((o) => o.kind === kind && !hasNoStandingOnAppearance(o));
  const byId = new Map(rows.map((o) => [o.id, o]));
  const parent = new Map(rows.map((o) => [o.id, o.id]));
  const find = (id: number): number => {
    const p = parent.get(id)!;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  for (const o of rows) {
    if (o.supersedesId == null || isRetractionValue(o.value)) continue;
    const target = byId.get(o.supersedesId);
    if (target && sameAuthorLink(o, target)) parent.set(find(o.id), find(target.id));
  }
  // A link joins only rows of one device, one account, or redacted rows,
  // so a chain's key is its device or account, or the chain's root row.
  //
  // One "Delete my data" clears all of a device's rows in a single update,
  // so they share one `redactedAt` (Postgres `now()` is the transaction's
  // time, severPerson.ts). That instant is the redacted voice's key, so a
  // deleted device stays one voice even where no supersession links its
  // rows. The chain root is the fallback for a redacted row with no stamp.
  const keys = new Map<number, string>();
  for (const o of rows) {
    if (!isRedactedSpotterRow(o)) keys.set(o.id, voiceKey(o));
    else if (o.redactedAt != null) keys.set(o.id, `redacted-at:${o.redactedAt.getTime()}`);
    else keys.set(o.id, `redacted:${find(o.id)}`);
  }
  return keys;
}

function sameAuthor(a: Observation, b: Observation): boolean {
  if (a.deviceId != null && a.deviceId === b.deviceId) return true;
  if (a.accountId != null && a.accountId === b.accountId) return true;
  return false;
}

/**
 * The rows of one appearance kind that still stand, before any value is
 * read. Shared by colour and markings.
 *
 * - Rows from someone with no standing on appearance are dropped.
 * - A `{ retracted: true }` from someone `ranking` gives a level removes exactly
 *   the row it supersedes, and asserts nothing itself.
 * - A same-author supersession, or one authority statement replacing
 *   another, removes the row it replaces, except a spotter's own markings
 *   when `keepOwnEarlierRows` is set: a device's later markings answer adds
 *   to what it ticked before (spec §4.2 markings rule 4), so its earlier
 *   rows keep counting. A retraction removes only its own target,
 *   never that device's earlier rows.
 * - A cross-author supersession found in the data (one device "replacing"
 *   another's row) is ignored: the row it points at still counts.
 */
export function standingAppearanceRows(
  observations: readonly Observation[],
  kind: "coat" | "markings",
  keepOwnEarlierRows: boolean,
  ranking: AppearanceRanking,
): Observation[] {
  const rows = observations.filter(
    (o) => o.kind === kind && !hasNoStandingOnAppearance(o),
  );
  const byId = new Map(rows.map((o) => [o.id, o]));
  const removed = new Set<number>();

  for (const o of rows) {
    if (o.supersedesId == null) continue;
    const target = byId.get(o.supersedesId);
    if (!target) continue;
    if (isRetractionValue(o.value)) {
      // Only someone the ranking gives standing may mark a row wrong, so a
      // guardian's retraction is inert until the ranking includes her.
      if (ranking(o) === 0) continue;
      // Exactly the row it points at (spec §4.4, §10.6), nothing else.
      removed.add(target.id);
      continue;
    }
    // A replacement removes the row it replaces when the writer could only
    // have done it as that author, or when both are authority statements (a
    // team member correcting the team's list). Only a spotter's own earlier
    // markings are kept (add-only, `keepOwnEarlierRows`): an authority list
    // is the whole list, so a replaced one never comes back.
    const replaces =
      sameAuthorLink(o, target) || (ranking(o) > 0 && ranking(target) > 0);
    if (replaces && !(keepOwnEarlierRows && isSpotterVoiceRow(target))) removed.add(target.id);
  }

  return rows.filter((o) => !removed.has(o.id) && !isRetractionValue(o.value));
}

/**
 * The standing statements of one kind that outrank the team on this cat:
 * every cat guardian's (Decision G; `appearanceAuthorityLevel` above 1).
 * "Standing" is `standingAppearanceRows`, the rule the resolver itself uses,
 * so a statement already marked wrong, replaced, or itself a retraction is
 * never among them. These are what a team Correct marks wrong (SYC-2 PR 3.1),
 * and the dashboard shows them so nobody overrules a statement unseen.
 */
export function standingAboveTeam(
  observations: readonly Observation[],
  kind: "coat" | "markings",
): Observation[] {
  return standingAppearanceRows(observations, kind, kind === "markings", appearanceAuthorityLevel).filter(
    (o) => o.provenance !== "machine" && appearanceAuthorityLevel(o) > 1,
  );
}

/** The Europe/Athens calendar day of an instant, as YYYY-MM-DD. Reuses the
 * streak's Athens bucketing so the app has one notion of a Syros day. */
export function athensDay(at: Date): string {
  return todayInStreakTimezone(at);
}

/** Each row's Athens day, worked out once per row object rather than once
 * per comparison: the independence checks compare rows pairwise. */
const rowDayCache = new WeakMap<Observation, string>();
function rowDay(o: Observation): string {
  let day = rowDayCache.get(o);
  if (day === undefined) {
    day = athensDay(o.observedAt);
    rowDayCache.set(o, day);
  }
  return day;
}

/** One spotter's voice on one value. */
export interface Voice {
  /** The device, or `redacted:<row id>` for a row whose author was cleared. */
  key: string;
  /** The voice's newest row: for colour, the one that says which colours
   * the device holds now. */
  row: Observation;
  /** Every one of the voice's rows that were passed in. Independence is
   * judged across all of them, so a device repeating itself never costs a
   * value its second voice. */
  rows: Observation[];
}

function voiceKey(o: Observation): string {
  if (o.deviceId != null) return `device:${o.deviceId}`;
  if (o.accountId != null) return `account:${o.accountId}`;
  // Redacted (§8.5): the device is cleared. Each such row is a voice of its
  // own (data spine §10.2 "Redacted rows").
  return `redacted:${o.id}`;
}

function isNewer(a: Observation, b: Observation): boolean {
  const at = a.observedAt.getTime();
  const bt = b.observedAt.getTime();
  return at > bt || (at === bt && a.id > b.id);
}

/**
 * One voice per author chain (`keys`, from `appearanceVoiceKeys`; by device
 * when absent): of the given spotter rows, keep each voice's
 * newest (by `observedAt`, ties by id). Non-spotter rows are ignored.
 */
export function onePerVoice(
  rows: readonly Observation[],
  keys: ReadonlyMap<number, string> = new Map(),
): Voice[] {
  const byKey = new Map<string, Voice>();
  for (const o of rows) {
    if (!isSpotterVoiceRow(o)) continue;
    const key = keys.get(o.id) ?? voiceKey(o);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { key, row: o, rows: [o] });
      continue;
    }
    current.rows.push(o);
    if (isNewer(o, current.row)) current.row = o;
  }
  return [...byKey.values()];
}

/** Two rows from different voices are independent evidence: neither is a
 * prompted tap, they came from different photos (where both still carry
 * one), and they describe different Europe/Athens calendar days. */
function independentRows(a: Observation, b: Observation): boolean {
  if (a.provenance === "prompted" || b.provenance === "prompted") return false;
  if (a.photoId != null && a.photoId === b.photoId) return false;
  return rowDay(a) !== rowDay(b);
}

/** The earliest instant two voices were independent: over every pair of
 * their rows that is independent, the later row's date, minimised. */
function independentSince(a: Voice, b: Voice): number | null {
  if (a.key === b.key) return null;
  let earliest: number | null = null;
  for (const ra of a.rows) {
    for (const rb of b.rows) {
      if (!independentRows(ra, rb)) continue;
      const at = Math.max(ra.observedAt.getTime(), rb.observedAt.getTime());
      if (earliest == null || at < earliest) earliest = at;
    }
  }
  return earliest;
}

/**
 * Two voices count as two only if some row of one and some row of the
 * other are independent (see `independentRows`): a later repeat by either
 * device never undoes an earlier independent pair.
 */
export function independentPair(a: Voice, b: Voice): boolean {
  return independentSince(a, b) != null;
}

/**
 * When two independent voices first stood together on a value: the
 * earliest instant at which some independent pair existed (the later row of
 * that pair). `null` when no pair is independent, i.e. the value has fewer
 * than two voices.
 */
export function twoVoicesSince(voices: readonly Voice[]): Date | null {
  // Walk every row in date order, checking it against the rows already
  // seen. The first row with an independent partner from another voice
  // dates the earliest pair (a pair is dated by its later row), so the walk
  // stops there.
  const entries = voices
    .flatMap((v) => v.rows.filter((r) => r.provenance !== "prompted").map((r) => ({ key: v.key, r })))
    .sort((x, y) => (isNewer(y.r, x.r) ? -1 : isNewer(x.r, y.r) ? 1 : 0));
  const seen: typeof entries = [];
  for (const e of entries) {
    for (const prev of seen) {
      if (prev.key !== e.key && independentRows(prev.r, e.r)) return new Date(e.r.observedAt.getTime());
    }
    seen.push(e);
  }
  return null;
}

/** Two independent voices hold this value. Stops at the first pair found. */
export function hasTwoVoices(voices: readonly Voice[]): boolean {
  for (let i = 0; i < voices.length; i++) {
    for (let j = i + 1; j < voices.length; j++) {
      const a = voices[i]!;
      const b = voices[j]!;
      if (a.key === b.key) continue;
      for (const ra of a.rows) for (const rb of b.rows) if (independentRows(ra, rb)) return true;
    }
  }
  return false;
}

/** The voices that count towards a value's tally: those with at least one
 * row that is not a prompted tap. */
function countingVoices(voices: readonly Voice[]): Voice[] {
  return voices.filter((v) => v.rows.some((r) => r.provenance !== "prompted"));
}

/** The newest supporting statement: the newest non-prompted row. */
function newestVoiceAt(voices: readonly Voice[]): number {
  return Math.max(
    -Infinity,
    ...voices.flatMap((v) =>
      v.rows.filter((r) => r.provenance !== "prompted").map((r) => r.observedAt.getTime()),
    ),
  );
}

/** The authority statement that decides, or undefined: Decision G's order
 * through `highestAuthority` (highest level, then newest by `observedAt`,
 * ties by id). Machine readings are never authority. */
function pickAuthority<T extends { row: Observation }>(
  statements: readonly T[],
  ranking: AppearanceRanking,
): T | undefined {
  const candidates = statements.filter((s) => s.row.provenance !== "machine");
  const winner = highestAuthority(
    candidates.map((s) => s.row),
    ranking,
  );
  return winner ? candidates.find((s) => s.row === winner) : undefined;
}

/** The Colour check conditions (spec §5.3), as data for Slice 3. The
 * hand-pick reason is computed there. */
export type AppearanceCheckReason =
  | "no_authority"
  | "spotters_over_machine"
  | "tied_camps"
  /** Two groups of spotters each agree on a different pattern (SYC-398 §4). */
  | "pattern_tied_camps"
  /** The colours and the pattern come from different rules (SYC-398 §4, Decision 2A). */
  | "mixed_sources"
  | "markings_reopened"
  | "markings_changed_recently";

export interface AppearanceResolved<T> extends Resolved<T> {
  checkReasons: AppearanceCheckReason[];
}

/** Which of the five rules (spec §4.2, coat-colours-and-pattern.md §4)
 * decided a part: 1 authority, 2 two spotters, 3 the machine, 4 one
 * spotter, 5 not known. */
export type CoatRule = 1 | 2 | 3 | 4 | 5;

/** A projected row's codes for one part, or null for a malformed value.
 * `["not_sure"]` and a machine row's `[]` come back as `[]`: they say
 * nothing. */
function projectedCodes(value: unknown, codes: ReadonlySet<string>): string[] | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = (value as { colours?: unknown }).colours;
  if (!Array.isArray(raw) || !raw.every((c) => c === "not_sure" || codes.has(c as string))) return null;
  return (raw as string[]).filter((c) => c !== "not_sure");
}

function sameColourSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c) => b.includes(c));
}

/**
 * One part of a cat's coat (spec §4.2 "Colour", data spine §10.2;
 * coat-colours-and-pattern.md §4), over rows already projected onto that
 * part by `projectCoatRows`: each row's `value.colours` holds the part's
 * codes. Pure. This is the engine `resolveCoat` was before SYC-398, with the
 * code list and the number shown as parameters and no normaliser.
 *
 * Machine readings are the `provenance: "machine"` rows in the same list.
 *
 * 1. Authority: the highest `ranking` level present, then the newest by
 *    `observedAt`. A team Confirm is a statement with the same value.
 *    *Confirmed*. A later machine reading or spotter never beats it.
 * 2. Two independent voices per code. Separate camps (nobody named both)
 *    show only the camp with the newer support, flagged `tied_camps`; at
 *    most `maxShown` codes, in the order of `codes`.
 *    *Likely*. If the machine has a different real reading, flagged
 *    `spotters_over_machine`.
 * 3. The machine's newest reading, if it is not Not sure. *Reported*.
 * 4. The newest single spotter fills a gap the machine left. *Reported*.
 * 5. Not sure: `value: null`, *unknown*.
 *
 * `no_authority` is set when the part is the machine's alone or not known.
 *
 * `voiceKeys` are the author chains of the cat's whole, untransformed coat
 * history (`appearanceVoiceKeys`). Defensive: since only a chain's head
 * stands, keys from the projected rows give the same voices today (Opus spot
 * review, finding 5), but the whole history is the one source of truth.
 */
function resolveCodeSet(
  observations: readonly Observation[],
  codes: readonly string[],
  maxShown: number,
  ranking: AppearanceRanking,
  voiceKeys: ReadonlyMap<number, string>,
): AppearanceResolved<string[]> & { rule: CoatRule } {
  const codeSet: ReadonlySet<string> = new Set(codes);
  const inCodeOrder = (xs: readonly string[]) => codes.filter((c) => xs.includes(c));
  const statements = standingAppearanceRows(observations, "coat", false, ranking).flatMap((row) => {
    const colours = projectedCodes(row.value, codeSet);
    return colours ? [{ row, colours }] : [];
  });

  // Rule 1: authority. A person's Not sure is never a statement.
  const authority = pickAuthority(
    statements.filter((s) => s.colours.length > 0),
    ranking,
  );
  if (authority) {
    return {
      value: authority.colours,
      confidence: "confirmed",
      supportingObservationIds: [authority.row.id],
      conflicts: [],
      asOf: toIso(authority.row.observedAt),
      checkReasons: [],
      rule: 1,
    };
  }

  // The machine's reading is its NEWEST reading only (Samuel, 14 Oct 2026,
  // review finding 9). If that row is Not sure, or the team marked it wrong,
  // the machine has no reading: an older reading never comes back.
  const newestMachineRow = observations
    .filter((o) => o.kind === "coat" && o.provenance === "machine" && !isRetractionValue(o.value))
    .reduce<Observation | undefined>((best, o) => (!best || isNewer(o, best) ? o : best), undefined);
  const newestMachine = newestMachineRow
    ? statements.find((s) => s.row.id === newestMachineRow.id)
    : undefined;
  const machine = newestMachine && newestMachine.colours.length > 0 ? newestMachine : undefined;

  // Rule 2: two voices per colour. A device's colour is its newest standing
  // colour row (Samuel, 14 Oct 2026, review finding 8): when that row is Not
  // sure the device holds no colour and counts towards nothing, linked to
  // its earlier answer or not. Not sure still never wins anything.
  const coloursById = new Map(statements.map((s) => [s.row.id, s.colours]));
  const coloursOfRow = (o: Observation) => coloursById.get(o.id) ?? [];
  //
  // A withdrawal also cuts off the past: once a device has said Not sure,
  // only its rows dated after its newest Not sure count for it, for
  // independence and everything else (ship review finding 6).
  const voices = onePerVoice(
    statements.map((s) => s.row),
    voiceKeys,
  )
    .map((v) => {
      const lastNotSure = v.rows
        .filter((r) => coloursOfRow(r).length === 0)
        .reduce<Observation | undefined>((best, r) => (!best || isNewer(r, best) ? r : best), undefined);
      return lastNotSure ? { ...v, rows: v.rows.filter((r) => isNewer(r, lastNotSure)) } : v;
    })
    .filter((v) => coloursOfRow(v.row).length > 0);
  const coloursOf = (v: Voice) => coloursOfRow(v.row);

  const agreed: { colour: string; voices: Voice[] }[] = [];
  for (const colour of codes) {
    // The device's current colours come from its newest row; its evidence
    // for this colour is every one of its rows that named it.
    const holding = voices
      .filter((v) => coloursOf(v).includes(colour))
      .map((v) => ({ ...v, rows: v.rows.filter((r) => (coloursById.get(r.id) ?? []).includes(colour)) }));
    if (hasTwoVoices(holding)) agreed.push({ colour, voices: holding });
  }

  if (agreed.length > 0) {
    // Camps: agreed colours joined when some voice named both.
    const parent = agreed.map((_, i) => i);
    const indexOf = new Map(agreed.map((a, i) => [a.colour, i] as const));
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    // Only a voice that said something itself joins two colours: a prompted
    // tap merely agreed with a pre-filled guess.
    for (const v of countingVoices(voices)) {
      const named = coloursOf(v).flatMap((c) => (indexOf.has(c) ? [indexOf.get(c)!] : []));
      for (let k = 1; k < named.length; k++) parent[find(named[k]!)] = find(named[0]!);
    }
    const camps = new Map<number, typeof agreed>();
    agreed.forEach((a, i) => {
      const root = find(i);
      camps.set(root, [...(camps.get(root) ?? []), a]);
    });
    const campList = [...camps.values()];
    const campNewest = (camp: typeof agreed) => Math.max(...camp.map((a) => newestVoiceAt(a.voices)));
    const camp = campList.reduce((best, c) => (campNewest(c) > campNewest(best) ? c : best));

    // Within the camp: most voices, then the newer support; at most
    // `maxShown` (every agreed colour; one pattern).
    const shown = [...camp]
      .sort(
        (x, y) =>
          countingVoices(y.voices).length - countingVoices(x.voices).length ||
          newestVoiceAt(y.voices) - newestVoiceAt(x.voices),
      )
      .slice(0, maxShown);
    const value = inCodeOrder(shown.map((a) => a.colour));
    const supporting = [...new Set(shown.flatMap((a) => countingVoices(a.voices).map((v) => v.row.id)))];

    const checkReasons: AppearanceCheckReason[] = [];
    const conflicts: number[] = [];
    if (campList.length > 1) {
      checkReasons.push("tied_camps");
      for (const other of campList) {
        if (other === camp) continue;
        for (const a of other) conflicts.push(...countingVoices(a.voices).map((v) => v.row.id));
      }
    }
    if (machine && !sameColourSet(machine.colours, value)) {
      checkReasons.push("spotters_over_machine");
      conflicts.push(machine.row.id);
    }
    const asOfAt = Math.max(...shown.map((a) => newestVoiceAt(a.voices)));
    return {
      value,
      confidence: "likely",
      supportingObservationIds: supporting,
      conflicts: [...new Set(conflicts)],
      asOf: new Date(asOfAt).toISOString(),
      checkReasons,
      rule: 2,
    };
  }

  // Rule 3: the machine's real reading.
  if (machine) {
    return {
      value: machine.colours,
      confidence: "reported",
      supportingObservationIds: [machine.row.id],
      conflicts: [],
      asOf: toIso(machine.row.observedAt),
      checkReasons: ["no_authority"],
      rule: 3,
    };
  }

  // Rule 4: the newest single spotter fills the gap.
  const newestVoice = voices.reduce<Voice | undefined>(
    (best, v) => (!best || isNewer(v.row, best.row) ? v : best),
    undefined,
  );
  if (newestVoice) {
    return {
      value: coloursOf(newestVoice),
      confidence: "reported",
      supportingObservationIds: [newestVoice.row.id],
      conflicts: [],
      asOf: toIso(newestVoice.row.observedAt),
      checkReasons: [],
      rule: 4,
    };
  }

  // Rule 5: not sure.
  return {
    value: null,
    confidence: "unknown",
    supportingObservationIds: [],
    conflicts: [],
    asOf: EPOCH,
    checkReasons: ["no_authority"],
    rule: 5,
  };
}


/**
 * The coat rows each part is resolved from (coat-colours-and-pattern.md §4).
 *
 * 1. Only the standing statements, worked out on the full, untransformed
 *    history: a newer statement by the same author (or one authority
 *    statement replacing another) replaces the WHOLE earlier one, so a part
 *    the newer one doesn't state is "not stated", never the old one. Every
 *    retraction and every machine row is kept as well, so the engine still
 *    sees which machine row is the newest.
 * 2. Each kept row is projected onto the part, as `{ colours: codes }`:
 *    - a retraction stays as it is;
 *    - a whole Not sure becomes `["not_sure"]`, the only withdrawal;
 *    - a machine row is always kept, a part it doesn't state as `[]`, so the
 *      newest machine row's missing part is not known and an older machine
 *      row never fills it;
 *    - a person's row that doesn't state the part is dropped from it (an old
 *      "Tabby" says nothing of the colours, so withdraws nothing).
 */
function projectCoatRows(
  observations: readonly Observation[],
  ranking: AppearanceRanking,
): { colours: Observation[]; pattern: Observation[] } {
  const coatRows = observations.filter((o) => o.kind === "coat");
  const standing = new Set(standingAppearanceRows(coatRows, "coat", false, ranking).map((o) => o.id));
  const kept = coatRows.filter(
    (o) => standing.has(o.id) || isRetractionValue(o.value) || o.provenance === "machine",
  );
  const project = (part: "colours" | "pattern"): Observation[] =>
    kept.flatMap((o): Observation[] => {
      if (isRetractionValue(o.value)) return [o];
      const parts = readCoatValue(o.value);
      if (parts?.notSure) return [{ ...o, value: { colours: ["not_sure"] } }];
      const said: string[] | null = !parts
        ? null
        : part === "colours"
          ? parts.colours
          : parts.pattern
            ? [parts.pattern]
            : null;
      if (o.provenance === "machine") return [{ ...o, value: { colours: said ?? [] } }];
      return said ? [{ ...o, value: { colours: said } }] : [];
    });
  return { colours: project("colours"), pattern: project("pattern") };
}

export type CoatPartResolved<T> = AppearanceResolved<T> & { rule: CoatRule };

/**
 * A cat's coat as two parts, each resolved on its own with its own
 * confidence, supporting statements, date and Colour check reasons
 * (coat-colours-and-pattern.md §4). Pure.
 *
 * - Colours: every agreed colour is shown (no limit).
 * - Pattern: one; two agreed patterns are `pattern_tied_camps`.
 * - When both parts are known from different rules (say the team's colours
 *   and the machine's pattern), both carry `mixed_sources` (Decision 2A).
 */
export function resolveCoatParts(
  observations: readonly Observation[],
  ranking: AppearanceRanking = appearanceAuthorityLevel,
): { colours: CoatPartResolved<CoatColour[]>; pattern: CoatPartResolved<CoatPattern | null> } {
  const voiceKeys = appearanceVoiceKeys(observations, "coat");
  const projected = projectCoatRows(observations, ranking);
  const c = resolveCodeSet(projected.colours, COAT_COLOURS, Infinity, ranking, voiceKeys);
  const p = resolveCodeSet(projected.pattern, COAT_PATTERNS, 1, ranking, voiceKeys);
  const colours: CoatPartResolved<CoatColour[]> = { ...c, value: c.value as CoatColour[] | null };
  const pattern: CoatPartResolved<CoatPattern | null> = {
    ...p,
    value: (p.value?.[0] as CoatPattern | undefined) ?? null,
    // A pattern nobody has said is never "not yet described" on its own:
    // "once someone has said a colour, it should stand until corrected"
    // (Samuel, 16 Oct 2026, on SYC-398 A1). The colours part still raises it.
    checkReasons: p.checkReasons
      .filter((r) => !(r === "no_authority" && p.value === null))
      .map((r) => (r === "tied_camps" ? "pattern_tied_camps" : r)),
  };
  if (colours.value !== null && pattern.value !== null && colours.rule !== pattern.rule) {
    colours.checkReasons = [...colours.checkReasons, "mixed_sources"];
    pattern.checkReasons = [...pattern.checkReasons, "mixed_sources"];
  }
  return { colours, pattern };
}

const MARK_SET: ReadonlySet<string> = new Set(MARKS);

/** A markings row's list, or null when it says nothing (`cantTell`) or is
 * malformed. `[]` ("nothing special") is a real, empty list. */
function markingsList(value: unknown): Mark[] | null {
  if (typeof value !== "object" || value === null) return null;
  const marks = (value as { marks?: unknown }).marks;
  if (!Array.isArray(marks) || !marks.every((m) => MARK_SET.has(m as string))) return null;
  return [...new Set(marks as Mark[])];
}

function inMarkOrder(marks: Iterable<Mark>): Mark[] {
  const set = new Set(marks);
  return MARKS.filter((m) => set.has(m));
}

/** "Changed on spotter agreement in the last 30 days" (spec §5.3). */
const MARKINGS_RECENT_DAYS = 30;
const DAY_MS_APPEARANCE = 86_400_000;

/**
 * A cat's markings (spec §4.2 "Markings", data spine §10.2). Pure.
 *
 * 1. Authority (highest `ranking` level, then newest by `observedAt`) is the
 *    whole list, an empty list included. *Confirmed*.
 * 2. A mark two independent voices ticked in rows dated after that standing
 *    statement is shown alongside it, flagged `markings_reopened` (Decision
 *    G). The list is then *Likely*, because part of it is.
 * 3. Otherwise each mark with two independent voices is shown. *Likely*.
 * 4. Spotters only add: a device's voice on a mark is any of its standing
 *    rows that ticked it, so a later answer, `[]`, `cantTell` or an omission
 *    withdraws nothing. Only an authority list or a retraction removes one.
 *
 * `markings_changed_recently` is set when a shown mark reached two voices
 * within 30 days of `now`. No marks known is `value: null`, *unknown*.
 */
export function resolveMarkings(
  observations: readonly Observation[],
  now: Date,
  ranking: AppearanceRanking = appearanceAuthorityLevel,
): AppearanceResolved<Mark[]> {
  const statements = standingAppearanceRows(observations, "markings", true, ranking).flatMap((row) => {
    const marks = markingsList(row.value);
    return marks ? [{ row, marks }] : [];
  });
  const spotterStatements = statements.filter((s) => s.row.provenance !== "machine");
  const voiceKeys = appearanceVoiceKeys(observations, "markings");
  const recentSince = now.getTime() - MARKINGS_RECENT_DAYS * DAY_MS_APPEARANCE;

  /** Each mark with two independent voices among rows passing `include`,
   * with the date the second voice arrived. */
  const rowsByMark = new Map<Mark, Observation[]>(MARKS.map((m) => [m, []]));
  for (const s of spotterStatements) {
    if (!isSpotterVoiceRow(s.row)) continue;
    for (const m of s.marks) rowsByMark.get(m)!.push(s.row);
  }
  const agreedMarks = (include: (o: Observation) => boolean) => {
    const out: { mark: Mark; since: Date; voices: Voice[] }[] = [];
    for (const mark of MARKS) {
      const rows = rowsByMark.get(mark)!.filter(include);
      if (rows.length < 2) continue;
      const voices = onePerVoice(rows, voiceKeys);
      const since = twoVoicesSince(voices);
      if (since) out.push({ mark, since, voices: countingVoices(voices) });
    }
    return out;
  };

  const reasonsFor = (agreed: ReturnType<typeof agreedMarks>): AppearanceCheckReason[] =>
    agreed.some((a) => a.since.getTime() >= recentSince) ? ["markings_changed_recently"] : [];

  const authority = pickAuthority(statements, ranking);
  if (authority) {
    const after = authority.row.observedAt.getTime();
    const reopened = agreedMarks((o) => o.observedAt.getTime() > after).filter(
      (a) => !authority.marks.includes(a.mark),
    );
    if (reopened.length === 0) {
      return {
        value: inMarkOrder(authority.marks),
        confidence: "confirmed",
        supportingObservationIds: [authority.row.id],
        conflicts: [],
        asOf: toIso(authority.row.observedAt),
        checkReasons: [],
      };
    }
    const newest = Math.max(...reopened.map((a) => a.since.getTime()));
    return {
      value: inMarkOrder([...authority.marks, ...reopened.map((a) => a.mark)]),
      confidence: "likely",
      supportingObservationIds: [
        authority.row.id,
        ...new Set(reopened.flatMap((a) => a.voices.map((v) => v.row.id))),
      ],
      conflicts: [],
      asOf: new Date(newest).toISOString(),
      checkReasons: ["markings_reopened", ...reasonsFor(reopened)],
    };
  }

  const agreed = agreedMarks(() => true);
  if (agreed.length === 0) {
    return {
      value: null,
      confidence: "unknown",
      supportingObservationIds: [],
      conflicts: [],
      asOf: EPOCH,
      checkReasons: [],
    };
  }
  return {
    value: inMarkOrder(agreed.map((a) => a.mark)),
    confidence: "likely",
    supportingObservationIds: [...new Set(agreed.flatMap((a) => a.voices.map((v) => v.row.id)))],
    conflicts: [],
    asOf: new Date(Math.max(...agreed.map((a) => a.since.getTime()))).toISOString(),
    checkReasons: reasonsFor(agreed),
  };
}

export type Vaccine = "rabies" | "cat_flu_enteritis" | { other: string };

/** One vaccination the team recorded. Team-side only: never in a public
 * payload (spec §6.3). */
export interface VaccinationRecord {
  observationId: number;
  /** The date it was given (`observedAt`), ISO 8601. */
  date: string;
  vaccines: Vaccine[];
  clinic: string | null;
}


function parseVaccines(value: unknown): { vaccines: Vaccine[]; clinic: string | null } | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as { vaccines?: unknown; clinic?: unknown };
  if (!Array.isArray(v.vaccines) || v.vaccines.length === 0) return null;
  const ok = v.vaccines.every(
    (x) =>
      x === "rabies" ||
      x === "cat_flu_enteritis" ||
      (typeof x === "object" && x !== null && typeof (x as { other?: unknown }).other === "string"),
  );
  if (!ok) return null;
  return {
    vaccines: v.vaccines as Vaccine[],
    clinic: typeof v.clinic === "string" ? v.clinic : null,
  };
}

/**
 * The vaccinations the team recorded (spec §6.3), newest first by the date
 * given, or `[]`. There is no negative and no *Likely*: an empty list means
 * nothing is recorded, never "not vaccinated". Only team rows count
 * (`isTeamRole`, less `vet` until vets can sign in and hold
 * `set_vaccination`); a row from anyone else, including a public or
 * guardian row a writer should have refused, is ignored. A team row that
 * replaces another team row (a correction) removes it, and an undone vet
 * visit's retraction removes its record (`standingRows`): team rows first,
 * then standing rows, so a stray row can't stand a team record down.
 */
export function resolveVaccinated(observations: readonly Observation[]): VaccinationRecord[] {
  const teamRows = observations.filter(
    (o) => o.kind === "vaccinated" && isTeamRole(o.roleAtTime) && o.roleAtTime !== "vet",
  );
  return standingRows(teamRows, "vaccinated")
    .flatMap((o) => {
      const parsed = parseVaccines(o.value);
      return parsed ? [{ o, ...parsed }] : [];
    })
    .sort((a, b) => (isNewer(a.o, b.o) ? -1 : isNewer(b.o, a.o) ? 1 : 0))
    .map(({ o, vaccines, clinic }) => ({
      observationId: o.id,
      date: toIso(o.observedAt),
      vaccines,
      clinic,
    }));
}

/** SYC-2's kinds, kept away from the life-status and sterilised resolvers. */
export const APPEARANCE_AND_HEALTH_KINDS: ReadonlySet<string> = new Set([
  "coat",
  "markings",
  "vaccinated",
  "team_note",
]);

/**
 * The one snapshot the cat page, the fan-out check, the nightly notify job,
 * the dashboard and SYC-119's dead-cat guard all read (§9.1). Phase 1 takes
 * an empty import list (see `ImportRecord`'s doc comment), so it isn't a
 * parameter here at all.
 */
export function resolveCat(
  observations: readonly Observation[],
  evidenceOfLife: EvidenceOfLife | null,
  now: Date,
): CatSnapshot {
  // Never crosses attributes (spec §10.2): the life-status and sterilised
  // resolvers are not handed the appearance and health kinds at all.
  const statusRows = observations.filter((o) => !APPEARANCE_AND_HEALTH_KINDS.has(o.kind));
  const life = resolveLifeStatus(statusRows, evidenceOfLife, now);
  const sterilised = resolveSterilised(statusRows, []);
  const coat = resolveCoatParts(observations, appearanceAuthorityLevel);
  return {
    // resolveLifeStatus always resolves to a concrete status (street is the
    // untouched default) — never null, unlike the generic Resolved<T> shape
    // it's built on.
    lifeStatus: life.value as LifeStatusValue,
    lifeStatusConfidence: life.confidence,
    lifeStatusAsOf: life.asOf,
    presumedDeceased: life.presumedDeceased,
    notSeenSince: life.notSeenSince,
    sterilised: {
      value: sterilised.value,
      confidence: sterilised.confidence,
      asOf: sterilised.asOf,
      clippedTipSightings: clippedTipCount(statusRows),
    },
    coatColours: coat.colours,
    coatPattern: coat.pattern,
    markings: resolveMarkings(observations, now, appearanceAuthorityLevel),
    vaccinations: resolveVaccinated(observations),
  };
}
