/**
 * One way to write an observation, and the loader every reader uses
 * (cat-record-data-spine.md §10.1, §2.3; plan `docs/superpowers/plans/data-spine.md`,
 * PR 2).
 *
 * Every later writer — this plan's PRs, SYC-42 Slice 5 (`welfare_report` /
 * `welfare_outcome`), SYC-119 Slice C (`coat`), and the dashboard once it
 * exists — goes through `writeObservation`. Nothing else may `insert` into
 * `observationsTable` outside a migration's backfill.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  db,
  catsTable,
  catIdentityTable,
  observationsTable,
  sightingsTable,
  type Observation,
} from "@workspace/db";
import type { EvidenceOfLife, EvidenceSource } from "./resolve";

/**
 * Phase-1 observation vocabulary (§10.1), plus `coat` (Part 2i, resolved as
 * Conflict C11) and SYC-2's three appearance-and-health kinds: `markings`
 * (distinguishing marks, spec §3.2), `vaccinated` (team-recorded vaccines)
 * and `team_note` (a team-only health note). Later phases add kinds without
 * a migration — this list is deliberately code, not a database enum.
 */
export const OBSERVATION_KINDS = [
  "life_status",
  "sterilised",
  "ear_tip",
  "food_and_water",
  "note",
  "name",
  "colony",
  "welfare_report",
  "welfare_outcome",
  "coat",
  "markings",
  "vaccinated",
  "team_note",
] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

const OBSERVATION_KIND_SET: ReadonlySet<string> = new Set(OBSERVATION_KINDS);

/**
 * §10.1's `roleAtTime` vocabulary is open (`public | guardian | volunteer |
 * vet | staff | admin | system`), but `guardian`, `volunteer` and `vet` are
 * "recorded from day one and unreachable in phase 1" (§10.4) — the
 * team-access spec builds exactly one role (staff/admin), and vet accounts
 * don't exist yet (SYC-24). `writeObservation` refuses them rather than
 * silently accepting a role nothing can legitimately produce yet.
 *
 * Separately, {@link ROLES_REFUSED_FOR_KIND} refuses some reachable roles for
 * particular kinds (`vet` for `coat`/`markings`; `public`, `guardian` and
 * `system` for `vaccinated`; `public` and `system` for `team_note`). That
 * check runs BEFORE this one, so the per-kind rule holds independently of
 * reachability: when SYC-53's PRs 0.2 and 2.2 add `management` and
 * `guardian` here, they only flip reachability and these refusals still apply.
 */
const REACHABLE_ROLES: ReadonlySet<string> = new Set([
  "public",
  "staff",
  "admin",
  "system",
]);

/**
 * Roles refused for a given kind, whatever their reachability (spec §10.3).
 * `coat`/`markings` refuse `vet` (a vet's word is about the cat's health, not
 * her looks); `vaccinated` is a team-recorded fact; `team_note` is team-only.
 *
 * The import exception for `vaccinated` (`system` + `provenance: import`) is
 * added when `records-import.md` is built, not now.
 */
const ROLES_REFUSED_FOR_KIND: Readonly<
  Partial<Record<ObservationKind, readonly string[]>>
> = {
  coat: ["vet"],
  // No machine markings (SYC2-D4), so `system` is refused outright.
  markings: ["vet", "system"],
  vaccinated: ["public", "guardian", "system"],
  team_note: ["public", "system"],
};

/** Only these roles may write a retraction (the team's set_appearance
 * power). */
const RETRACTING_ROLES: ReadonlySet<string> = new Set([
  "staff",
  "admin",
  "management",
  "guardian",
]);

const AUTHORITY_SCOPES: ReadonlySet<string> = new Set([
  "none",
  "guardian_of_this_cat",
  "owner_of_this_cat",
]);

const PROVENANCES: ReadonlySet<string> = new Set([
  "volunteered",
  "prompted",
  "machine",
  "import",
  "legacy",
]);

/**
 * App-written authors (DECISIONS.md Part 2g; plan's global constraints). A
 * new system writer adds its name here in its own PR. `writeObservation`
 * refuses any `accountId` starting `system:` that isn't on this list, so
 * nobody can borrow one of these identities from outside the server.
 */
export const SYSTEM_AUTHORS = [
  "system:legacy-backfill",
  "system:admin-route",
  "system:vision",
  "system:welfare-report",
] as const;
export type SystemAuthor = (typeof SYSTEM_AUTHORS)[number];

const SYSTEM_AUTHOR_SET: ReadonlySet<string> = new Set(SYSTEM_AUTHORS);

/**
 * SYC-119's fixed coat-colour vocabulary (`choose-a-different-cat.md` §4.7:
 * "Black · White · Ginger · Grey · Tabby · Tortoiseshell or calico · Black
 * and white · Not sure").
 *
 * Under Decision A1 (SYC-2), SYC-161 imports this list and these are the
 * only definitions: nothing else may define a second colour list.
 */
export const COAT_COLOURS = [
  "black",
  "white",
  "ginger",
  "grey",
  "tabby",
  "tortoiseshell_or_calico",
  "black_and_white",
  "not_sure",
] as const;
export type CoatColour = (typeof COAT_COLOURS)[number];

const COAT_COLOUR_SET: ReadonlySet<string> = new Set(COAT_COLOURS);

/**
 * The eleven distinguishing-mark codes (coat-markings-and-health.md §3.2),
 * in the spec's order. The only definition: nothing else lists them.
 */
export const MARKS = [
  "white_paws",
  "white_chest",
  "white_face",
  "colourpoint",
  "long_fur",
  "kinked_tail",
  "torn_ear",
  "short_tail",
  "missing_eye",
  "three_legs",
  "odd_eyes",
] as const;
export type Mark = (typeof MARKS)[number];

const MARK_SET: ReadonlySet<string> = new Set(MARKS);

/**
 * De-duplicates a colour list, and turns the exact set {black, white} (in
 * either order) into `["black_and_white"]`, the only stored form of that
 * pair. Everything else is returned de-duplicated, in its original order.
 *
 * Every writer calls this before `writeObservation`: the answers route
 * (4.1), and the team and guardian statement functions (3.1 and 5.1). The
 * validator's refusal of the raw black + white pair is only the backstop.
 */
export function normaliseColours(colours: readonly string[]): string[] {
  const unique = [...new Set(colours)];
  if (
    unique.length === 2 &&
    unique.includes("black") &&
    unique.includes("white")
  ) {
    return ["black_and_white"];
  }
  return unique;
}

/** Raised by `writeObservation` for every refusal, with a stable `code` so
 * callers (and tests) can tell refusals apart without parsing text. */
export class ObservationRefused extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ObservationRefused";
  }
}

function refuse(code: string, message: string): never {
  throw new ObservationRefused(code, message);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Keys that make a coat or markings value a statement rather than a
 * retraction. */
const STATEMENT_KEYS = ["colours", "marks", "cantTell", "modelVersion"] as const;

/**
 * A retraction is a plain object with `retracted === true` and none of the
 * statement keys. Other keys, such as `reason`, are tolerated (team
 * statements keep their reason inside the value). Returns false when
 * `retracted` is absent; refuses when it is present but not exactly `true`,
 * or combined with a statement key.
 */
function isRetraction(value: unknown): boolean {
  if (!isPlainObject(value) || !("retracted" in value)) return false;
  if (value["retracted"] !== true) {
    refuse("MALFORMED_VALUE", "retracted, when present, must be exactly true");
  }
  if (STATEMENT_KEYS.some((k) => k in value)) {
    refuse(
      "MALFORMED_VALUE",
      "a retraction cannot carry colours, marks, cantTell or modelVersion",
    );
  }
  return true;
}

const VACCINE_CODES: ReadonlySet<string> = new Set([
  "rabies",
  "cat_flu_enteritis",
]);

/** §10.1's per-kind value shapes. Refuses anything malformed; this is the
 * only place in the codebase that knows what a kind's `value` must look
 * like. `ctx` carries the two facts some shapes depend on. */
function validateValue(
  kind: ObservationKind,
  value: unknown,
  ctx: { roleAtTime: string; provenance: string },
): void {
  // Only coat and markings have a retraction; a stray `retracted` key on any
  // other kind is a malformed value, not an ignorable extra.
  if (
    kind !== "coat" &&
    kind !== "markings" &&
    isPlainObject(value) &&
    "retracted" in value
  ) {
    refuse("MALFORMED_VALUE", `${kind} does not accept a retracted key`);
  }
  switch (kind) {
    case "life_status": {
      const status = isPlainObject(value) ? value["status"] : undefined;
      if (
        typeof status !== "string" ||
        !["street", "homed", "in_care", "deceased"].includes(status)
      ) {
        refuse(
          "MALFORMED_VALUE",
          'life_status needs { status: "street" | "homed" | "in_care" | "deceased" }',
        );
      }
      return;
    }
    case "sterilised": {
      if (!isPlainObject(value) || typeof value["sterilised"] !== "boolean") {
        refuse("MALFORMED_VALUE", "sterilised needs { sterilised: boolean }");
      }
      return;
    }
    case "ear_tip": {
      if (!isPlainObject(value)) {
        refuse("MALFORMED_VALUE", "ear_tip needs { clipped }");
      }
      const clipped = value["clipped"];
      if (clipped !== true && clipped !== false && clipped !== "cant_tell") {
        refuse(
          "MALFORMED_VALUE",
          'ear_tip.clipped must be true, false or "cant_tell"',
        );
      }
      const side = value["side"];
      if (
        clipped === true &&
        side !== undefined &&
        !["left", "right", "unsure"].includes(side as string)
      ) {
        refuse(
          "MALFORMED_VALUE",
          "ear_tip.side must be left, right or unsure when present",
        );
      }
      return;
    }
    case "food_and_water": {
      const present = isPlainObject(value) ? value["present"] : undefined;
      if (present !== true && present !== false && present !== "cant_tell") {
        refuse(
          "MALFORMED_VALUE",
          'food_and_water needs { present: true | false | "cant_tell" }',
        );
      }
      return;
    }
    case "note": {
      if (!isPlainObject(value) || typeof value["text"] !== "string") {
        refuse("MALFORMED_VALUE", "note needs { text: string }");
      }
      return;
    }
    case "name": {
      if (
        !isPlainObject(value) ||
        typeof value["name"] !== "string" ||
        (value["name"] as string).trim().length === 0 ||
        typeof value["normalised"] !== "string"
      ) {
        refuse("MALFORMED_VALUE", "name needs { name: string, normalised: string }");
      }
      return;
    }
    case "colony": {
      if (!isPlainObject(value) || typeof value["colonyId"] !== "number") {
        refuse("MALFORMED_VALUE", "colony needs { colonyId: number }");
      }
      return;
    }
    case "welfare_report": {
      if (
        !isPlainObject(value) ||
        !["attention", "urgent"].includes(value["severity"] as string) ||
        typeof value["isLitter"] !== "boolean" ||
        typeof value["reportId"] !== "number"
      ) {
        refuse(
          "MALFORMED_VALUE",
          "welfare_report needs { severity: \"attention\" | \"urgent\", isLitter: boolean, reportId: number }",
        );
      }
      return;
    }
    case "welfare_outcome": {
      if (
        !isPlainObject(value) ||
        !["done", "nothing_needed"].includes(value["state"] as string) ||
        typeof value["reportId"] !== "number"
      ) {
        refuse(
          "MALFORMED_VALUE",
          'welfare_outcome needs { state: "done" | "nothing_needed", reportId: number }',
        );
      }
      return;
    }
    case "coat": {
      if (isRetraction(value)) return;
      if (!isPlainObject(value) || !Array.isArray(value["colours"])) {
        refuse(
          "MALFORMED_VALUE",
          "coat needs { colours: CoatColour[], modelVersion? } or { retracted: true }",
        );
      }
      const colours = value["colours"] as unknown[];
      if (colours.length < 1 || colours.length > 2) {
        refuse("MALFORMED_VALUE", "coat.colours must have 1 or 2 entries");
      }
      if (!colours.every((c) => COAT_COLOUR_SET.has(c as string))) {
        refuse(
          "MALFORMED_VALUE",
          "coat.colours must be from SYC-119's fixed eight-colour list",
        );
      }
      if (new Set(colours).size !== colours.length) {
        refuse("MALFORMED_VALUE", "coat.colours must be distinct");
      }
      if (colours.includes("not_sure") && colours.length > 1) {
        refuse(
          "MALFORMED_VALUE",
          '"not_sure" cannot be combined with another colour',
        );
      }
      if (colours.includes("black") && colours.includes("white")) {
        refuse(
          "MALFORMED_VALUE",
          'black and white together is stored as "black_and_white" (use normaliseColours)',
        );
      }
      const modelVersion = value["modelVersion"];
      if (ctx.provenance === "machine") {
        if (typeof modelVersion !== "string" || modelVersion.length === 0) {
          refuse(
            "MALFORMED_VALUE",
            "a machine coat needs a non-empty modelVersion",
          );
        }
      } else if (modelVersion !== undefined) {
        refuse(
          "MALFORMED_VALUE",
          "modelVersion is only allowed on a machine-provenance coat",
        );
      }
      return;
    }
    case "markings": {
      if (isRetraction(value)) return;
      if (!isPlainObject(value)) {
        refuse(
          "MALFORMED_VALUE",
          "markings needs { marks }, { cantTell: true } or { retracted: true }",
        );
      }
      if (value["cantTell"] !== undefined) {
        if (value["cantTell"] !== true || "marks" in value) {
          refuse(
            "MALFORMED_VALUE",
            "markings cantTell must be exactly true and carry no marks",
          );
        }
        return;
      }
      const marks = value["marks"];
      if (!Array.isArray(marks)) {
        refuse("MALFORMED_VALUE", "markings.marks must be an array");
      }
      if (!marks.every((m) => MARK_SET.has(m as string))) {
        refuse("MALFORMED_VALUE", "markings.marks must be known mark codes");
      }
      if (new Set(marks).size !== marks.length) {
        refuse("MALFORMED_VALUE", "markings.marks must be distinct");
      }
      if (ctx.roleAtTime === "public" && marks.length > 4) {
        refuse("MALFORMED_VALUE", "a public markings answer has at most 4 marks");
      }
      return;
    }
    case "vaccinated": {
      if (!isPlainObject(value) || !Array.isArray(value["vaccines"])) {
        refuse("MALFORMED_VALUE", "vaccinated needs { vaccines: [...] }");
      }
      const vaccines = value["vaccines"] as unknown[];
      if (vaccines.length < 1 || vaccines.length > 3) {
        refuse("MALFORMED_VALUE", "vaccinated.vaccines must have 1 to 3 entries");
      }
      const seen = new Set<string>();
      for (const v of vaccines) {
        let key: string;
        if (typeof v === "string" && VACCINE_CODES.has(v)) {
          key = `code:${v}`;
        } else if (isPlainObject(v) && typeof v["other"] === "string") {
          // Callers store the name already trimmed.
          const name = v["other"];
          if (name !== name.trim() || name.length < 2 || name.length > 60) {
            refuse(
              "MALFORMED_VALUE",
              "an other vaccine name must be trimmed and 2 to 60 characters",
            );
          }
          key = `other:${name.toLowerCase()}`;
        } else {
          refuse(
            "MALFORMED_VALUE",
            'each vaccine must be "rabies", "cat_flu_enteritis" or { other: string }',
          );
        }
        if (seen.has(key)) {
          refuse("MALFORMED_VALUE", "vaccinated.vaccines must be distinct");
        }
        seen.add(key);
      }
      const clinic = value["clinic"];
      if (
        clinic !== undefined &&
        (typeof clinic !== "string" ||
          clinic.trim().length < 1 ||
          clinic.length > 120)
      ) {
        refuse(
          "MALFORMED_VALUE",
          "vaccinated.clinic must be a non-blank string of at most 120 characters",
        );
      }
      return;
    }
    case "team_note": {
      const text = isPlainObject(value) ? value["text"] : undefined;
      if (
        typeof text !== "string" ||
        text.trim().length < 1 ||
        text.length > 2000
      ) {
        refuse("MALFORMED_VALUE", "team_note needs { text } of 1 to 2000 characters");
      }
      return;
    }
  }
}

/** How far back a public-role observation may date itself — the same
 * constant `captureTime.ts`'s `clampCaptureTime` uses for sightings (§10.1:
 * "Public writes are clamped by the existing capture-time rule (30 days
 * back)"). A public `observedAt` older than this is clamped to this
 * boundary, exactly as `clampCaptureTime` clamps a sighting's capture time —
 * not refused. (Review of PR #66, 3 Oct 2026: an earlier version of this
 * code refused instead, which matched the plan's own Tests bullet but
 * contradicted both §10.1's last line and this file's design prose; it
 * broke the ordinary case of naming a new cat on resolve for a sighting
 * synced from the offline queue more than 30 days after its own [already
 * clamped] capture time — routes/sightings.ts passes that capture time
 * straight through as the name observation's `observedAt`. The plan's
 * Tests bullet is corrected to match.) */
const MAX_PUBLIC_BACKDATE_MS = 30 * 86_400_000;

/** Tolerance for a slightly-fast client clock, matching `captureTime.ts`. */
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

/** Either the plain `db` handle or a transaction's callback parameter — both
 * expose the same `.insert`/`.select` surface this module needs. Every
 * go-forward write passes its own transaction here, per the plan ("each in
 * the same transaction as the change it records"). */
export type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface WriteObservationInput {
  catId: number;
  kind: ObservationKind;
  value: unknown;
  /** Exactly one of deviceId/accountId must be set. */
  deviceId?: string | null;
  accountId?: string | null;
  roleAtTime: string;
  authorityScope?: string;
  provenance?: string;
  suggestedValue?: unknown;
  suggestionSource?: string | null;
  sightingId?: number | null;
  photoId?: number | null;
  importRecordId?: number | null;
  /** When the thing was true, not when the row is written. */
  observedAt: Date;
  supersedesId?: number | null;
  supersedeReason?: string | null;
}

/**
 * Validates and inserts one observation (§10.1). Refuses (throws
 * `ObservationRefused`) rather than writing anything for:
 *
 * - an unknown `kind`, or a `value` that doesn't match its kind's shape;
 * - a role refused for that kind (`ROLE_NOT_ALLOWED_FOR_KIND`: `vet` for
 *   `coat`/`markings`; `public`, `guardian`, `system` for `vaccinated`; `system` for `markings`
 *   and for any `coat` that is not `provenance: "machine"`;
 *   `public`, `system` for `team_note`), checked before reachability;
 * - a `roleAtTime` unreachable in phase 1 (`guardian`, `volunteer`, `vet`,
 *   or anything else not in {public, staff, admin, system});
 * - an unknown `authorityScope` or `provenance`;
 * - not exactly one of `deviceId`/`accountId` set (the same rule the
 *   database's `observations_attribution_ck` enforces, checked here first
 *   for a clear refusal rather than a constraint-violation error), or a
 *   `public` coat/markings write without a `deviceId`;
 * - an `accountId` starting `system:` that isn't on {@link SYSTEM_AUTHORS}
 *   (Part 2g: "real account ids ... never start with system:");
 * - `provenance: "machine"` from anyone but `system:vision` (the only
 *   machine-authored kind today is `coat`, SYC-119 §4.7);
 * - a future `observedAt` (refused for every role);
 * - a `{ retracted: true }` coat/markings value from anyone but {staff,
 *   admin, management, guardian}, without a `supersedesId`, or whose superseded row is missing or not the same kind
 *   (`INVALID_RETRACTION`, every role); or
 * - a `public` or `system` coat/markings write superseding a row that is not
 *   its own (same device, or same system author) (`NOT_YOUR_ROW`, C2);
 * - any supersession whose target is missing or of another kind
 *   (`INVALID_SUPERSESSION`, or the rule's own code), or, for coat and
 *   markings, on another cat;
 *
 * A `public`-role `observedAt` more than 30 days in the past is not
 * refused — it is clamped to that 30-day boundary, the same rule
 * `captureTime.ts`'s `clampCaptureTime` applies to a sighting's capture
 * time (§10.1's last line). The row returned carries the clamped date.
 *
 * Every other combination is inserted and returned.
 */
export async function writeObservation(
  tx: DbOrTx,
  input: WriteObservationInput,
  now: Date = new Date(),
): Promise<Observation> {
  if (!OBSERVATION_KIND_SET.has(input.kind)) {
    refuse("UNKNOWN_KIND", `Unknown observation kind: ${String(input.kind)}`);
  }

  validateValue(input.kind, input.value, {
    roleAtTime: input.roleAtTime,
    provenance: input.provenance ?? "volunteered",
  });

  // Per-kind role rule, BEFORE the reachability check: it is proven
  // independently of reachability and still holds once SYC-53 makes
  // `management` and `guardian` reachable.
  if (
    ROLES_REFUSED_FOR_KIND[input.kind]?.includes(input.roleAtTime) ||
    // `system` may write a coat only as the machine's reading.
    (input.kind === "coat" &&
      input.roleAtTime === "system" &&
      (input.provenance ?? "volunteered") !== "machine")
  ) {
    refuse(
      "ROLE_NOT_ALLOWED_FOR_KIND",
      `roleAtTime "${input.roleAtTime}" may not write ${input.kind}`,
    );
  }

  if (!REACHABLE_ROLES.has(input.roleAtTime)) {
    refuse(
      "UNREACHABLE_ROLE",
      `roleAtTime "${input.roleAtTime}" is not reachable in phase 1`,
    );
  }

  const authorityScope = input.authorityScope ?? "none";
  if (!AUTHORITY_SCOPES.has(authorityScope)) {
    refuse("INVALID_AUTHORITY_SCOPE", `Unknown authorityScope: ${authorityScope}`);
  }

  const provenance = input.provenance ?? "volunteered";
  if (!PROVENANCES.has(provenance)) {
    refuse("INVALID_PROVENANCE", `Unknown provenance: ${provenance}`);
  }

  const deviceId = input.deviceId ?? null;
  const accountId = input.accountId ?? null;
  if ((deviceId == null) === (accountId == null)) {
    refuse(
      "INVALID_AUTHOR",
      "Exactly one of deviceId or accountId must be set",
    );
  }
  // A public appearance write must carry a device: the own-row rule (C2) and
  // the resolver's one-voice-per-device counting both hang off it.
  if (
    (input.kind === "coat" || input.kind === "markings") &&
    input.roleAtTime === "public" &&
    deviceId == null
  ) {
    refuse("INVALID_AUTHOR", "a public coat or markings write needs a deviceId");
  }
  if (
    accountId != null &&
    accountId.startsWith("system:") &&
    !SYSTEM_AUTHOR_SET.has(accountId)
  ) {
    refuse(
      "BORROWED_SYSTEM_AUTHOR",
      `"${accountId}" is not a recognised system author`,
    );
  }
  if (provenance === "machine" && accountId !== "system:vision") {
    refuse(
      "INVALID_PROVENANCE",
      'provenance "machine" is only accepted from system:vision',
    );
  }
  // Review of PR #67 (SYC-52), finding S2: migration 0006's rollback finds
  // exactly the rows it wrote by `suggestion_source = 'backfill:data-spine'`
  // and deletes only those (the one sanctioned bypass of the observations
  // append-only trigger). The migration's own header already claimed
  // `writeObservation` refuses that value from any other caller — this
  // makes that true, so the rollback can never delete a row some other
  // write happened to tag the same way.
  if (
    typeof input.suggestionSource === "string" &&
    input.suggestionSource.startsWith("backfill:")
  ) {
    refuse(
      "RESERVED_SUGGESTION_SOURCE",
      `suggestionSource "${input.suggestionSource}" is reserved for migration backfills and may not be written through writeObservation`,
    );
  }

  const observedAtMs = input.observedAt.getTime();
  if (Number.isNaN(observedAtMs)) {
    refuse("INVALID_OBSERVED_AT", "observedAt is not a valid date");
  }
  const nowMs = now.getTime();
  if (observedAtMs > nowMs + MAX_FUTURE_SKEW_MS) {
    refuse("FUTURE_OBSERVED_AT", "observedAt cannot be in the future");
  }
  // §10.1's last line: "Public writes are clamped by the existing
  // capture-time rule (30 days back)" — clamped, not refused. See the
  // comment on MAX_PUBLIC_BACKDATE_MS for why an earlier version of this
  // refused instead, and what that broke.
  let observedAt = input.observedAt;
  if (
    input.roleAtTime === "public" &&
    observedAtMs < nowMs - MAX_PUBLIC_BACKDATE_MS
  ) {
    observedAt = new Date(nowMs - MAX_PUBLIC_BACKDATE_MS);
  }

  // Supersession rules for coat and markings. The superseded row is loaded
  // once and shared between the retraction rule and the own-row rule (C2).
  const isAppearanceKind = input.kind === "coat" || input.kind === "markings";
  const retracting = isAppearanceKind && isRetraction(input.value);
  const supersedesId = input.supersedesId ?? null;
  if (retracting && !RETRACTING_ROLES.has(input.roleAtTime)) {
    refuse(
      "INVALID_RETRACTION",
      `roleAtTime "${input.roleAtTime}" may not retract`,
    );
  }
  if (retracting && supersedesId == null) {
    refuse("INVALID_RETRACTION", "a retraction must supersede a row");
  }
  const needsOwnRow =
    isAppearanceKind &&
    (input.roleAtTime === "public" || input.roleAtTime === "system") &&
    supersedesId != null;
  if (supersedesId != null) {
    const [target] = await tx
      .select()
      .from(observationsTable)
      .where(eq(observationsTable.id, supersedesId));
    const refusalCode = needsOwnRow
      ? "NOT_YOUR_ROW"
      : retracting
        ? "INVALID_RETRACTION"
        : "INVALID_SUPERSESSION";
    // Every role, every kind: a supersession stays within one kind.
    if (!(target && target.kind === input.kind)) {
      refuse(refusalCode, "a supersession must target an existing row of the same kind");
    }
    // coat and markings only: the same cat. (Not other kinds: a welfare
    // re-tie crosses cats on purpose.)
    // TODO(SYC-59): compare canonical cats through cat_identity once merges exist; today merged cats refuse writes, so this only ever refuses.
    if (isAppearanceKind && target.catId !== input.catId) {
      refuse(refusalCode, "a coat or markings supersession must stay on the same cat");
    }
    // Every role: a retraction removes only a coat or markings row.
    if (retracting && !(target.kind === "coat" || target.kind === "markings")) {
      refuse(
        "INVALID_RETRACTION",
        "a retraction must supersede a row of the same kind (coat or markings)",
      );
    }
    // C2: a device (public) or a system author (machine) only supersedes
    // its own row. Team supersessions are unchanged (they go through
    // lockActiveObservation).
    if (needsOwnRow) {
      const own =
        input.roleAtTime === "public"
          ? target.deviceId != null && target.deviceId === input.deviceId
          : target.accountId != null && target.accountId === input.accountId;
      if (!own) {
        refuse("NOT_YOUR_ROW", "you can only supersede your own row");
      }
    }
  }

  const [row] = await tx
    .insert(observationsTable)
    .values({
      catId: input.catId,
      kind: input.kind,
      value: input.value as object,
      deviceId,
      accountId,
      roleAtTime: input.roleAtTime,
      authorityScope,
      provenance,
      suggestedValue: (input.suggestedValue ?? null) as object | null,
      suggestionSource: input.suggestionSource ?? null,
      sightingId: input.sightingId ?? null,
      photoId: input.photoId ?? null,
      importRecordId: input.importRecordId ?? null,
      observedAt,
      supersedesId,
      supersedeReason: input.supersedeReason ?? null,
    })
    .returning();
  return row!;
}

export interface CatRecords {
  observations: Observation[];
  evidenceOfLife: EvidenceOfLife | null;
}

/**
 * The batched loader every reader uses (§2.3: never one query per cat).
 * Issues a fixed number of queries whatever `catIds.length` is:
 *
 * 1. `cat_identity` — empty today (no merge exists, SYC-59), but reading
 *    through it means a future merge needs no change here: a cat's
 *    observations may have been written against an id that has since been
 *    folded into the one being asked for.
 * 2. Every observation for every id that feeds any requested cat, in one
 *    `IN (...)`.
 * 3. The newest *resolved* sighting for each of those ids, in one grouped
 *    query — needed for `lastSightingAt`, which isn't itself an
 *    observation.
 * 4. Each cat's `created_at`, for §3.4's last-resort fallback.
 *
 * The plan describes this as "one batched query for the observations ...
 * and one batched query for each cat's evidence of life". This loader
 * computes the evidence-of-life kinds (`sterilised`, `ear_tip`,
 * `welfare_report`) from the observation rows query 2 already fetches,
 * rather than a separate query for them — functionally the same thing
 * (every cat gets the same fixed, N-independent query count; the named test
 * only requires that it's fixed), one query cheaper.
 *
 * Deliberately leaves out §3.4's fourth evidence-of-life source, a linked
 * import record's operation date (SYC-49 / SYC-82, not built).
 */
export async function loadCatRecords(
  catIds: readonly number[],
): Promise<Map<number, CatRecords>> {
  const result = new Map<number, CatRecords>();
  const uniqueIds = [...new Set(catIds)];
  if (uniqueIds.length === 0) return result;

  const identityRows = await db
    .select({
      catId: catIdentityTable.catId,
      canonicalCatId: catIdentityTable.canonicalCatId,
    })
    .from(catIdentityTable)
    .where(inArray(catIdentityTable.canonicalCatId, uniqueIds));

  const idsForCanonical = new Map<number, number[]>();
  for (const id of uniqueIds) idsForCanonical.set(id, [id]);
  for (const row of identityRows) {
    idsForCanonical.get(row.canonicalCatId)?.push(row.catId);
  }
  const allCatIds = [
    ...new Set([...uniqueIds, ...identityRows.map((r) => r.catId)]),
  ];

  const obsRows = await db
    .select()
    .from(observationsTable)
    .where(inArray(observationsTable.catId, allCatIds));

  // A welfare_report that has been replaced by a row on ANY cat (re-tying a
  // report to a different cat writes the new row on the new cat, pointing
  // back at the old one; SYC-43 part 2, PR 5) no longer says the old cat was
  // alive. The replacing row is not among obsRows when it lives on another
  // cat, so this reads it across cats: one more query, the same count
  // whatever the number of cats.
  const replacer = alias(observationsTable, "replacer");
  const replacedWelfareRows = await db
    .select({ id: observationsTable.id })
    .from(observationsTable)
    .innerJoin(replacer, eq(replacer.supersedesId, observationsTable.id))
    .where(
      and(
        eq(observationsTable.kind, "welfare_report"),
        inArray(observationsTable.catId, allCatIds),
      ),
    );
  const replacedWelfare = new Set(replacedWelfareRows.map((r) => r.id));

  const sightingRows = await db
    .select({
      catId: sightingsTable.catId,
      newest: sql<string>`max(${sightingsTable.createdAt})`,
    })
    .from(sightingsTable)
    .where(
      and(
        inArray(sightingsTable.catId, allCatIds),
        eq(sightingsTable.status, "resolved"),
      ),
    )
    .groupBy(sightingsTable.catId);

  const catRows = await db
    .select({ id: catsTable.id, createdAt: catsTable.createdAt })
    .from(catsTable)
    .where(inArray(catsTable.id, allCatIds));

  const obsByCatId = new Map<number, Observation[]>();
  for (const o of obsRows) {
    const list = obsByCatId.get(o.catId) ?? [];
    list.push(o);
    obsByCatId.set(o.catId, list);
  }
  const sightingByCatId = new Map<number, Date>();
  for (const s of sightingRows) {
    if (s.catId != null && s.newest) {
      sightingByCatId.set(s.catId, new Date(s.newest));
    }
  }
  const createdAtByCatId = new Map<number, Date>();
  for (const c of catRows) createdAtByCatId.set(c.id, c.createdAt);

  for (const canonicalId of uniqueIds) {
    const feedingIds = idsForCanonical.get(canonicalId) ?? [canonicalId];
    const observations = feedingIds.flatMap((id) => obsByCatId.get(id) ?? []);

    // Evidence of life (§3.4), excluding life_status (the resolver already
    // has it directly — resolve.ts's EvidenceOfLife doc comment), colony,
    // note, name, food_and_water, coat, markings, vaccinated and team_note
    // (none imply the cat was alive).
    let bestAt: Date | null = null;
    let bestSource: EvidenceSource | null = null;
    const consider = (at: Date, source: EvidenceSource) => {
      if (bestAt == null || at.getTime() > bestAt.getTime()) {
        bestAt = at;
        bestSource = source;
      }
    };
    for (const o of observations) {
      if (o.kind === "sterilised") consider(o.observedAt, "sterilised");
      // An ear-tip answer that belongs to a sighting (data spine PR 7) adds
      // nothing the sighting doesn't already say, at its true date. Counting
      // it separately would be wrong whenever writeObservation's 30-day
      // public clamp moved its date forward (a late-synced sighting answered
      // later still), pulling the cat's "last seen alive" forward with it.
      // Ear tips with no sighting (team entries) still count.
      else if (o.kind === "ear_tip" && o.sightingId == null) consider(o.observedAt, "ear_tip");
      else if (o.kind === "welfare_report" && !replacedWelfare.has(o.id))
        consider(o.observedAt, "welfare_report");
    }

    let lastSightingAt: Date | null = null;
    for (const id of feedingIds) {
      const newest = sightingByCatId.get(id);
      if (newest && (lastSightingAt == null || newest.getTime() > lastSightingAt.getTime())) {
        lastSightingAt = newest;
      }
    }
    if (lastSightingAt != null) consider(lastSightingAt, "sighting");

    let evidenceOfLife: EvidenceOfLife | null = null;
    if (bestAt != null && bestSource != null) {
      evidenceOfLife = { at: bestAt, source: bestSource, lastSightingAt };
    } else {
      const createdAt = feedingIds
        .map((id) => createdAtByCatId.get(id))
        .filter((d): d is Date => d != null)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      if (createdAt) {
        evidenceOfLife = { at: createdAt, source: "created", lastSightingAt };
      }
    }

    result.set(canonicalId, { observations, evidenceOfLife });
  }

  return result;
}
