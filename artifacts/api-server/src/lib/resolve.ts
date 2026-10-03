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
 * statement clears it" rule. A `colony`, `note`, `name`, `food_and_water` or
 * `coat` observation must never reach either field, because none of those
 * imply the cat is alive (§3.4) — that filtering is `loadCatRecords`'s job,
 * not this function's.
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

const AUTHORITATIVE_ROLES = new Set(["vet", "staff", "admin"]);

/**
 * §10.2 rule 2's authority: a team/vet role, OR an imported record. Used for
 * the `sterilised` assertions themselves.
 */
function isAuthoritative(o: Observation): boolean {
  return AUTHORITATIVE_ROLES.has(o.roleAtTime) || o.provenance === "import";
}

/**
 * §10.2 rule 3's narrower authority: a team/vet role, full stop. Used for an
 * `ear_tip { clipped: false }` correction. The spec's rule 3 names
 * "roleAtTime in {vet, staff, admin}" only — it does not extend
 * import-provenance authority to ear-tip corrections the way rule 2 does for
 * `sterilised` assertions, and nothing in DECISIONS.md says otherwise (an
 * import record is a `sterilised` statement, §10.2 rule 2 already covers
 * it; it never carries an ear-tip answer). Using the broader
 * `isAuthoritative` here would let a `provenance: "import"` row with no
 * team/vet role clear a *Likely* back to *Unknown*, which the spec doesn't
 * grant it.
 */
function isAuthoritativeRole(o: Observation): boolean {
  return AUTHORITATIVE_ROLES.has(o.roleAtTime);
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
 * 2. Authoritative assertions (`roleAtTime` vet/staff/admin, or
 *    `provenance: "import"`) — newest by `observedAt` wins, whatever sign.
 * 3. Otherwise, a photo-backed `ear_tip { clipped: true }` reaches *likely*,
 *    unless a team/vet `clipped: false` (§10.2 rule 3: roles only, not
 *    import — see `isAuthoritativeRole`) supersedes or postdates it.
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
  type Candidate = { sterilised: boolean; at: Date; observationId: number | null };
  const authoritative: Candidate[] = active
    .filter((o) => o.kind === "sterilised" && isAuthoritative(o))
    .flatMap((o) => {
      const parsed = parseSterilised(o.value);
      return parsed
        ? [{ sterilised: parsed.sterilised, at: o.observedAt, observationId: o.id }]
        : [];
    });
  const fromImport: Candidate[] = importRecords.map((r) => ({
    sterilised: r.sterilised,
    at: new Date(r.observedAt),
    observationId: null,
  }));
  const candidates = [...authoritative, ...fromImport];

  if (candidates.length > 0) {
    // Newest by observedAt wins, whatever sign it carries (§10.2, §4.6).
    // Ties: an observation (a cat's own record) beats a not-yet-linked
    // import row at the same instant.
    const winner = candidates.reduce((newest, candidate) => {
      if (candidate.at.getTime() > newest.at.getTime()) return candidate;
      if (
        candidate.at.getTime() === newest.at.getTime() &&
        candidate.observationId != null &&
        newest.observationId == null
      )
        return candidate;
      return newest;
    });
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
    (e) => e.clipped === false && isAuthoritativeRole(e.o),
  );

  const survivors = clippedTrueWithPhoto.filter(
    (candidate) =>
      !authoritativeFalse.some(
        (af) =>
          af.o.supersedesId === candidate.o.id ||
          af.o.observedAt.getTime() >= candidate.o.observedAt.getTime(),
      ),
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
