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
import { TEAM_ROLES } from "./teamRoles";
import type { CoatColour, Mark } from "./appearance";
import { COAT_COLOURS, MARKS, normaliseColours } from "./appearance";
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
 *    newest by `observedAt` within it wins, whatever sign (Decision G).
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
  const active = observations.filter((o) => isActive(o, observations));

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
  };
  const authoritative: Candidate[] = active
    .filter((o) => o.kind === "sterilised" && authorityLevel(o) > 0)
    .flatMap((o) => {
      const parsed = parseSterilised(o.value);
      return parsed
        ? [{ sterilised: parsed.sterilised, at: o.observedAt, rank: o, observationId: o.id }]
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
    };
  });
  const candidates = [...authoritative, ...fromImport];

  if (candidates.length > 0) {
    // Decision G (§4.6), through the one ordering (`outranks`): the highest
    // level present decides, and within it the newest by observedAt wins,
    // whatever sign it carries; an exact tie goes to the later row.
    const winner = candidates.reduce((best, candidate) =>
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
 * Who has standing to *state* a cat's colour or markings, as a level: the
 * highest level present wins, then the newest by `observedAt` within it
 * (Decision G). `null` means no standing as authority. A row with no
 * standing may still be a spotter's voice (see `isSpotterVoiceRow`).
 *
 * A parameter rather than a constant because SYC-53's `authorityLevel` (its
 * PR 0.2) is not on main yet. Whichever of the two merges second wires
 * `authorityLevel` in here; the appearance carve-out below
 * (`hasNoStandingOnAppearance`) is applied by the resolver before any
 * ranking is consulted, so a ranking that ranks vets or owners highly can
 * never give them standing on appearance.
 */
export type AppearanceRanking = (o: Observation) => number | null;

const TEAM_APPEARANCE_ROLES: ReadonlySet<string> = new Set(["staff", "admin", "management"]);

/**
 * Today's ranking: the team (staff, and `admin`/`management`) is level 1 and
 * nothing else counts. A cat guardian with a `colony:<id>` scope slots in at
 * level 2 once `guardian` is reachable (SYC-53 PR 2.2), which outranks the
 * team (Decision G).
 */
export const TEAM_APPEARANCE_RANKING: AppearanceRanking = (o) =>
  TEAM_APPEARANCE_ROLES.has(o.roleAtTime) ? 1 : null;

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

/** Roles whose `{ retracted: true }` is honoured: the `set_appearance`
 * holders. A retraction from anyone else (the writer refuses one) is
 * ignored at read time. */
const APPEARANCE_RETRACTING_ROLES: ReadonlySet<string> = new Set([
  "staff",
  "admin",
  "management",
  "guardian",
]);

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
 * - A `{ retracted: true }` from a `set_appearance` holder removes exactly
 *   the row it supersedes, and asserts nothing itself.
 * - A same-author supersession removes the row it replaces, except for
 *   markings when `keepOwnEarlierRows` is set: a device's later markings
 *   answer adds to what it ticked before (spec §4.2 markings rule 4), so its
 *   earlier rows keep counting. A retraction of a markings row also removes
 *   that device's own earlier rows in the same chain, so a retracted mark
 *   cannot come back through an ancestor.
 * - A cross-author supersession found in the data (one device "replacing"
 *   another's row) is ignored: the row it points at still counts.
 */
export function standingAppearanceRows(
  observations: readonly Observation[],
  kind: "coat" | "markings",
  keepOwnEarlierRows: boolean,
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
      if (!APPEARANCE_RETRACTING_ROLES.has(o.roleAtTime)) continue;
      removed.add(target.id);
      // Walk the target's own same-author chain back, so an ancestor the
      // target was built on cannot resurface (markings keep ancestors).
      let cursor: Observation | undefined = target;
      while (cursor?.supersedesId != null) {
        const prev = byId.get(cursor.supersedesId);
        if (!prev || !sameAuthor(prev, cursor)) break;
        removed.add(prev.id);
        cursor = prev;
      }
      continue;
    }
    if (sameAuthor(o, target) && !keepOwnEarlierRows) removed.add(target.id);
  }

  return rows.filter((o) => !removed.has(o.id) && !isRetractionValue(o.value));
}

/** The Europe/Athens calendar day of an instant, as YYYY-MM-DD. Reuses the
 * streak's Athens bucketing so the app has one notion of a Syros day. */
export function athensDay(at: Date): string {
  return todayInStreakTimezone(at);
}

/** One spotter's voice on one value: the row that decides it. */
export interface Voice {
  /** The device, or `redacted:<row id>` for a row whose author was cleared. */
  key: string;
  row: Observation;
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
 * One voice per device: of the given spotter rows, keep only each voice's
 * newest (by `observedAt`, ties by id). Non-spotter rows are ignored.
 */
export function onePerVoice(rows: readonly Observation[]): Voice[] {
  const newest = new Map<string, Observation>();
  for (const o of rows) {
    if (!isSpotterVoiceRow(o)) continue;
    const key = voiceKey(o);
    const current = newest.get(key);
    if (!current || isNewer(o, current)) newest.set(key, o);
  }
  return [...newest.entries()].map(([key, row]) => ({ key, row }));
}

/**
 * Two voices count as two only if they are independent: neither is a
 * prompted tap, they came from different photos (where both still carry
 * one), and they describe different Europe/Athens calendar days.
 */
export function independentPair(a: Voice, b: Voice): boolean {
  if (a.key === b.key) return false;
  if (a.row.provenance === "prompted" || b.row.provenance === "prompted") return false;
  if (a.row.photoId != null && a.row.photoId === b.row.photoId) return false;
  return athensDay(a.row.observedAt) !== athensDay(b.row.observedAt);
}

/**
 * When two independent voices first stood together on a value: the
 * earliest instant at which some independent pair existed (the later row of
 * that pair). `null` when no pair is independent, i.e. the value has fewer
 * than two voices.
 */
export function twoVoicesSince(voices: readonly Voice[]): Date | null {
  let earliest: number | null = null;
  for (let i = 0; i < voices.length; i++) {
    for (let j = i + 1; j < voices.length; j++) {
      const a = voices[i]!;
      const b = voices[j]!;
      if (!independentPair(a, b)) continue;
      const at = Math.max(a.row.observedAt.getTime(), b.row.observedAt.getTime());
      if (earliest == null || at < earliest) earliest = at;
    }
  }
  return earliest == null ? null : new Date(earliest);
}

/** Two independent voices hold this value. */
export function hasTwoVoices(voices: readonly Voice[]): boolean {
  return twoVoicesSince(voices) != null;
}

/** The voices that count towards a value's tally (prompted taps never do). */
function countingVoices(voices: readonly Voice[]): Voice[] {
  return voices.filter((v) => v.row.provenance !== "prompted");
}

function newestVoiceAt(voices: readonly Voice[]): number {
  return Math.max(-Infinity, ...countingVoices(voices).map((v) => v.row.observedAt.getTime()));
}

/** The authority statement that decides, or undefined: highest level, then
 * newest by `observedAt` (ties by id). */
function pickAuthority<T extends { row: Observation }>(
  statements: readonly T[],
  ranking: AppearanceRanking,
): T | undefined {
  let best: { s: T; level: number } | undefined;
  for (const s of statements) {
    if (s.row.provenance === "machine") continue;
    const level = ranking(s.row);
    if (level == null) continue;
    if (
      !best ||
      level > best.level ||
      (level === best.level && isNewer(s.row, best.s.row))
    ) {
      best = { s, level };
    }
  }
  return best?.s;
}

/** The Colour check conditions (spec §5.3), as data for Slice 3. The
 * hand-pick reason is computed there. */
export type AppearanceCheckReason =
  | "no_authority"
  | "spotters_over_machine"
  | "tied_camps"
  | "markings_reopened"
  | "markings_changed_recently";

export interface AppearanceResolved<T> extends Resolved<T> {
  checkReasons: AppearanceCheckReason[];
}

const COAT_COLOUR_SET: ReadonlySet<string> = new Set(COAT_COLOURS);

/** A coat row's colours, normalised (black + white is black and white), or
 * null for a malformed value. `["not_sure"]` comes back as `[]`: it says
 * nothing. */
function coatColours(value: unknown): CoatColour[] | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = (value as { colours?: unknown }).colours;
  if (!Array.isArray(raw) || !raw.every((c) => COAT_COLOUR_SET.has(c as string))) return null;
  const colours = normaliseColours(raw as string[]) as CoatColour[];
  return colours.filter((c) => c !== "not_sure");
}

function sameColourSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c) => b.includes(c));
}

/**
 * A cat's coat colour (spec §4.2 "Colour", data spine §10.2). Pure.
 *
 * Machine readings are the `provenance: "machine"` rows in the same list.
 *
 * 1. Authority: the highest `ranking` level present, then the newest by
 *    `observedAt`. A team Confirm is a statement with the same value.
 *    *Confirmed*. A later machine reading or spotter never beats it.
 * 2. Two independent voices per colour. Separate camps (nobody named both)
 *    show only the camp with the newer support, flagged `tied_camps`.
 *    *Likely*. If the machine has a different real reading, flagged
 *    `spotters_over_machine`.
 * 3. The machine's newest reading, if it is not Not sure. *Reported*.
 * 4. The newest single spotter fills a gap the machine left. *Reported*.
 * 5. Not sure: `value: null`, *unknown*.
 *
 * `no_authority` is set when the colour is the machine's alone or not sure.
 */
export function resolveCoat(
  observations: readonly Observation[],
  ranking: AppearanceRanking = TEAM_APPEARANCE_RANKING,
): AppearanceResolved<CoatColour[]> {
  const statements = standingAppearanceRows(observations, "coat", false).flatMap((row) => {
    const colours = coatColours(row.value);
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
    };
  }

  // The machine's reading is its newest row, Not sure included: a newer
  // Not sure means the machine no longer has a real reading.
  const machineRows = statements.filter((s) => s.row.provenance === "machine");
  const newestMachine = machineRows.reduce<(typeof machineRows)[number] | undefined>(
    (best, s) => (!best || isNewer(s.row, best.row) ? s : best),
    undefined,
  );
  const machine = newestMachine && newestMachine.colours.length > 0 ? newestMachine : undefined;

  // Rule 2: two voices per colour. Not sure answers are dropped before the
  // one-voice-per-device step, so a later Not sure withdraws nothing.
  const spotterRows = statements.filter((s) => s.colours.length > 0);
  const coloursById = new Map(spotterRows.map((s) => [s.row.id, s.colours]));
  const voices = onePerVoice(spotterRows.map((s) => s.row));
  const coloursOf = (v: Voice) => coloursById.get(v.row.id) ?? [];

  const agreed: { colour: CoatColour; voices: Voice[] }[] = [];
  for (const colour of COAT_COLOURS) {
    const holding = voices.filter((v) => coloursOf(v).includes(colour));
    if (hasTwoVoices(holding)) agreed.push({ colour, voices: holding });
  }

  if (agreed.length > 0) {
    // Camps: agreed colours joined when some voice named both.
    const parent = agreed.map((_, i) => i);
    const indexOf = new Map(agreed.map((a, i) => [a.colour, i] as const));
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    for (const v of voices) {
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

    // Within the camp: most voices, then the newer support; at most two.
    const shown = [...camp]
      .sort(
        (x, y) =>
          countingVoices(y.voices).length - countingVoices(x.voices).length ||
          newestVoiceAt(y.voices) - newestVoiceAt(x.voices),
      )
      .slice(0, 2);
    const value = shown.map((a) => a.colour);
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
  };
}

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
  const life = resolveLifeStatus(observations, evidenceOfLife, now);
  const sterilised = resolveSterilised(observations, []);
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
      clippedTipSightings: clippedTipCount(observations),
    },
  };
}
