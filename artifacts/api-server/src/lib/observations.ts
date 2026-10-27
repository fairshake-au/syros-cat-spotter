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
import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  db,
  catsTable,
  observationsTable,
  sightingsTable,
  type Observation,
} from "@workspace/db";
import { getGuidance } from "@workspace/welfare-guidance";
import {
  authorityLevel,
  COLONY_SCOPE_PATTERN,
  resolveCat,
  standingRows,
  supersedeChains,
  type EvidenceOfLife,
  type CatSnapshot,
  type RestorableKind,
  type EvidenceSource,
  type Vaccine,
} from "./resolve";
import { TEAM_ROLES, isTeamRole } from "./teamRoles";
import { catsFeeding } from "./catIdentity";

/**
 * Phase-1 observation vocabulary (§10.1), plus `coat` (Part 2i, resolved as
 * Conflict C11) and SYC-2's three appearance-and-health kinds: `markings`
 * (distinguishing marks, spec §3.2), `vaccinated` (team-recorded vaccines)
 * and `team_note` (a team-only health note). Later phases add kinds without
 * a migration — this list is deliberately code, not a database enum.
 * SYC-396 PR 3.0 adds `vet_visit` (team-dashboard-redesign.md §8; plan
 * Decision 4): one visit to a vet, with what was done, the clinic and the cost.
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
  "vet_visit",
] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

const OBSERVATION_KIND_SET: ReadonlySet<string> = new Set(OBSERVATION_KINDS);

/**
 * §10.1's `roleAtTime` vocabulary is open (`public | guardian | vet | staff |
 * management | system`; roles spec §10.4 renamed the never-written `admin`
 * to `management` and retired `volunteer`). `guardian` is reachable from
 * SYC-53's PR 2.2, always with the `colony:<id>` scope the server sets
 * (Decision B); `vet` stays unreachable until vet accounts exist (SYC-24).
 * `writeObservation` refuses it rather than silently accepting a role
 * nothing can legitimately produce yet. The team's roles come from the one
 * list (lib/teamRoles.ts), so a team role added there is reachable here.
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
  "system",
  // A cat guardian (SYC-53 PR 2.2): only with a `colony:<id>` scope.
  "guardian",
  // The team's roles, except `vet` (no vet accounts until SYC-24).
  ...[...TEAM_ROLES].filter((role) => role !== "vet"),
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
  team_note: ["public", "guardian", "system"],
  // A vet visit is logged by the team (`log_vet_visit` is island-only).
  vet_visit: ["public", "guardian", "system"],
};

/**
 * The kinds a vet visit writes, and whose `{ retracted: true }` only a
 * vet-visit undo may write (SYC-396 PR 3.0; plan Decisions 6 and 7). The
 * resolver reads them through `standingRows`, where retracting a row that
 * had itself replaced another stands that other row up again.
 */
const VISIT_KINDS: ReadonlySet<string> = new Set(["sterilised", "vaccinated", "vet_visit"]);

/** What a visit did (§8.2). "checked" is only ever alone. */
export const VISIT_DID = ["sterilised", "vaccinated", "treated", "checked"] as const;
/** Who paid for a visit (§8.4). */
export const PAID_BY = ["syros_cats", "donation", "owner"] as const;

/** A `vet_visit` value (§8.2; plan Task 3.0.1). The date is the row's
 * `observedAt`, as for every statement; the cost lives only here. */
export interface VetVisitValue {
  /** 1–4, distinct; "checked" only alone. */
  did: (typeof VISIT_DID)[number][];
  /** Required iff `did` has "vaccinated"; the same rules as `vaccinated`. */
  vaccines?: Vaccine[];
  /** Required iff `did` has "treated"; 1–200 characters, trimmed. */
  treatedNote?: string;
  /** One of `getGuidance("en").vets` ids (Decision 16). */
  clinicId: string;
  /** 0–2000 euros, at most two decimals, or null when not known. */
  costEur: number | null;
  paidBy: (typeof PAID_BY)[number];
  /** 0–500 characters. */
  note?: string;
  /**
   * Why a sterilisation cost what it did, when that isn't the standard price
   * (Samuel, 21 Oct 2026; SYC-396). Optional; trimmed, 1–200 characters;
   * only on a visit that sterilised and has a cost. Money information: shown
   * only with `view_vet_costs`.
   */
  costReason?: string;
}

const VISIT_DID_SET: ReadonlySet<string> = new Set(VISIT_DID);
const PAID_BY_SET: ReadonlySet<string> = new Set(PAID_BY);
const VET_VISIT_KEYS: ReadonlySet<string> = new Set([
  "did",
  "vaccines",
  "treatedNote",
  "clinicId",
  "costEur",
  "paidBy",
  "note",
  "costReason",
]);
const VISIT_COST_MAX_EUR = 2000;

/** The one clinic list (Decision 16), read once. */
const CLINIC_IDS: ReadonlySet<string> = new Set(getGuidance("en").vets.map((c) => c.id));

/**
 * The kinds Decision G ranks (roles spec §7.2; resolve.ts `authorityLevel`).
 * A supersession of one of these may not reach DOWN to a statement with
 * standing that isn't the writer's own (SYC-316): superseding is how a lower
 * level overrules a higher one ("This is wrong"), never the reverse, where a
 * plain statement already wins.
 */
const RANKED_KINDS: ReadonlySet<string> = new Set(["sterilised", "ear_tip", "life_status"]);

/** Only these roles may write a retraction (the team's set_appearance
 * power). */
const RETRACTING_ROLES: ReadonlySet<string> = new Set([
  // The team's roles (a vet is already refused for coat and markings by
  // ROLES_REFUSED_FOR_KIND, which runs first), and a cat guardian.
  ...TEAM_ROLES,
  "guardian",
]);

/** Who states appearance with authority, and so may not state Not sure: the
 * team (the one list, `isTeamRole`) and a cat guardian. */
function statesAppearanceWithAuthority(role: string): boolean {
  return isTeamRole(role) || role === "guardian";
}

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
  // SYC-209 PR 1.1: the authors of feeding-site and colony history rows that
  // no person wrote (mapping_events.actor_system; MAPPING_SYSTEM_ACTORS in
  // @workspace/db). Listed here so the name is reserved everywhere.
  "system:seed",
  "system:migration",
] as const;
export type SystemAuthor = (typeof SYSTEM_AUTHORS)[number];

const SYSTEM_AUTHOR_SET: ReadonlySet<string> = new Set(SYSTEM_AUTHORS);

// The colour, pattern and mark vocabularies live in the pure
// module `./appearance` so the resolver (which must not import the database)
// can share them. Re-exported here so every writer keeps one import.
export { COAT_COLOURS, COAT_PATTERNS, MARKS } from "./appearance";
export type { CoatColour, CoatPattern, Mark } from "./appearance";
import { COAT_COLOURS, COAT_PATTERNS, MARKS } from "./appearance";

const COAT_COLOUR_SET: ReadonlySet<string> = new Set(COAT_COLOURS);
const COAT_PATTERN_SET: ReadonlySet<string> = new Set(COAT_PATTERNS);
const MARK_SET: ReadonlySet<string> = new Set(MARKS);

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
const STATEMENT_KEYS = ["colours", "pattern", "notSure", "marks", "cantTell", "modelVersion"] as const;

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
      "a retraction cannot carry colours, pattern, notSure, marks, cantTell or modelVersion",
    );
  }
  return true;
}

const VACCINE_CODES: ReadonlySet<string> = new Set([
  "rabies",
  "cat_flu_enteritis",
]);

/** Names a typed `other` vaccine may not use, compared lower-case: the
 * listed vaccines' codes and their English names. */
const LISTED_VACCINE_NAMES: ReadonlySet<string> = new Set([
  "rabies",
  "cat_flu_enteritis",
  "cat flu and enteritis",
  "cat flu & enteritis",
]);

/** §10.1's per-kind value shapes. Refuses anything malformed; this is the
 * only place in the codebase that knows what a kind's `value` must look
 * like. `ctx` carries the two facts some shapes depend on. */
function validateValue(
  kind: ObservationKind,
  value: unknown,
  ctx: { roleAtTime: string; provenance: string },
): void {
  // Only coat, markings and the vet-visit kinds have a retraction; a stray
  // `retracted` key on any other kind is a malformed value, not an ignorable
  // extra.
  if (
    kind !== "coat" &&
    kind !== "markings" &&
    kind !== "team_note" &&
    !VISIT_KINDS.has(kind) &&
    isPlainObject(value) &&
    "retracted" in value
  ) {
    refuse("MALFORMED_VALUE", `${kind} does not accept a retracted key`);
  }
  if (isVisitRetraction(kind, value)) return;
  if (isTeamNoteRetraction(kind, value)) return;
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
      validateVisitIdShape(kind, value);
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
      // `{ colonyId: null }` is "no colony" (roles spec §6.8, §10.4), so a
      // cat can leave a colony without joining another (SYC-209's "take
      // out"). The key must be present: `{}` is still malformed.
      if (
        !isPlainObject(value) ||
        !("colonyId" in value) ||
        (value["colonyId"] !== null && typeof value["colonyId"] !== "number")
      ) {
        refuse("MALFORMED_VALUE", "colony needs { colonyId: number | null }");
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
      // SYC-398 (coat-colours-and-pattern.md §6): any of the five colours
      // plus one pattern, or a whole Not sure. Old shapes (tabby,
      // black_and_white, not_sure, ...) are refused from now on; stored ones
      // are only ever read, through readCoatValue. No key allow-list: the
      // team keeps `reason` and `agreesWith` in the value.
      if (isRetraction(value)) return;
      if (!isPlainObject(value)) {
        refuse("MALFORMED_VALUE", "coat needs { colours?, pattern? } or { notSure: true }");
      }
      const colours = value["colours"];
      const pattern = value["pattern"];
      if (value["notSure"] !== undefined) {
        if (value["notSure"] !== true) refuse("MALFORMED_VALUE", "notSure must be true");
        if (colours !== undefined || pattern !== undefined) {
          refuse("MALFORMED_VALUE", "notSure is never combined with a colour or pattern");
        }
        // The team never states Not sure on colour (Samuel, 14 October 2026):
        // Correct does not offer it, and "Mark wrong" is how the team undoes
        // a colour. A spotter and the photo reader still may.
        if (statesAppearanceWithAuthority(ctx.roleAtTime)) {
          refuse(
            "MALFORMED_VALUE",
            'the team and cat guardians never state "not sure" on colour; use a retraction ("Mark wrong") to undo a colour',
          );
        }
      } else {
        if (colours !== undefined) {
          if (!Array.isArray(colours) || colours.length < 1 || colours.length > COAT_COLOURS.length) {
            refuse("MALFORMED_VALUE", "coat.colours must have 1 to 5 entries");
          }
          if (!colours.every((c) => COAT_COLOUR_SET.has(c as string))) {
            refuse("MALFORMED_VALUE", "coat.colours must be from the five colours");
          }
          if (new Set(colours).size !== colours.length) {
            refuse("MALFORMED_VALUE", "coat.colours must be distinct");
          }
        }
        if (pattern !== undefined && !(typeof pattern === "string" && COAT_PATTERN_SET.has(pattern))) {
          refuse("MALFORMED_VALUE", "coat.pattern must be plain, stripes or patches");
        }
        if (colours === undefined && pattern === undefined) {
          refuse("MALFORMED_VALUE", "coat states nothing");
        }
        // A spotter's answer always names a colour; its pattern may be
        // "Can't tell" (absent). Only the team and the reader state a
        // pattern alone.
        if (ctx.roleAtTime === "public" && colours === undefined) {
          refuse("MALFORMED_VALUE", "a spotter's coat answer names at least one colour");
        }
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
      validateVaccineList(value["vaccines"] as unknown[], "vaccinated.vaccines");
      validateVisitIdShape(kind, value);
      const clinic = value["clinic"];
      if (
        clinic !== undefined &&
        (typeof clinic !== "string" ||
          clinic !== clinic.trim() ||
          clinic.length < 1 ||
          clinic.length > 120)
      ) {
        refuse(
          "MALFORMED_VALUE",
          "vaccinated.clinic must be trimmed, non-blank and at most 120 characters (callers store it trimmed, like an other vaccine name)",
        );
      }
      return;
    }
    case "team_note": {
      // Free text is stored as written (line breaks and all); only its raw
      // length is capped and it must not be blank. Short labels (an other
      // vaccine name, a clinic) are different: they must arrive trimmed.
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
    case "vet_visit": {
      validateVetVisit(value);
      return;
    }
  }
}

/**
 * A team note marked wrong (SYC-602 PR 4): exactly `{ retracted: true }`, the
 * reason living in `supersedeReason`. False when `retracted` is absent or the
 * kind is not `team_note`; refuses a `retracted` that is not exactly `true` or
 * that carries anything else (a note that says something is a note, not a
 * retraction).
 */
function isTeamNoteRetraction(kind: string, value: unknown): boolean {
  if (kind !== "team_note" || !isPlainObject(value) || !("retracted" in value)) return false;
  if (value["retracted"] !== true) {
    refuse("MALFORMED_VALUE", "retracted, when present, must be exactly true");
  }
  if (Object.keys(value).length !== 1) {
    refuse("MALFORMED_VALUE", "a team_note retraction carries only { retracted: true }");
  }
  return true;
}

/**
 * A `{ retracted: true, reason }` of a vet-visit kind (Task 3.0.1): true for
 * a well-formed one, false when `retracted` is absent, refused when it is
 * present but anything else is wrong. It asserts nothing, so it carries
 * nothing but its reason. Whether it may be written at all is the writer's
 * `fromVisitUndo` rule, not this shape's.
 */
function isVisitRetraction(kind: string, value: unknown): boolean {
  if (!VISIT_KINDS.has(kind) || !isPlainObject(value) || !("retracted" in value)) return false;
  if (value["retracted"] !== true) {
    refuse("MALFORMED_VALUE", "retracted, when present, must be exactly true");
  }
  if (Object.keys(value).some((k) => k !== "retracted" && k !== "reason")) {
    refuse("MALFORMED_VALUE", `a ${kind} retraction carries only { retracted: true, reason }`);
  }
  const reason = value["reason"];
  if (typeof reason !== "string" || reason.trim().length < 1 || reason.length > 500) {
    refuse("MALFORMED_VALUE", `a ${kind} retraction needs a reason of 1 to 500 characters`);
  }
  return true;
}

/** A visit link, when present, is a row id. Whether it names a standing
 * visit of the same cat is the writer's check (`checkVisitLink`). */
function validateVisitIdShape(kind: string, value: Record<string, unknown>): void {
  if (!("vetVisitId" in value)) return;
  const id = value["vetVisitId"];
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
    refuse("MALFORMED_VALUE", `${kind}.vetVisitId must be a row id`);
  }
}

/** One to three distinct vaccines: listed codes, or a trimmed typed name
 * that isn't a listed vaccine. Shared by `vaccinated` and `vet_visit`. */
function validateVaccineList(vaccines: unknown[], label: string): void {
  if (vaccines.length < 1 || vaccines.length > 3) {
    refuse("MALFORMED_VALUE", `${label} must have 1 to 3 entries`);
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
      // A typed name that is one of the listed vaccines is the listed
      // vaccine, so it can't be stored twice under two forms.
      const folded = name.toLowerCase();
      if (LISTED_VACCINE_NAMES.has(folded)) {
        refuse(
          "MALFORMED_VALUE",
          `"${name}" is a listed vaccine: use its code, not an other name`,
        );
      }
      key = `other:${folded}`;
    } else {
      refuse(
        "MALFORMED_VALUE",
        'each vaccine must be "rabies", "cat_flu_enteritis" or { other: string }',
      );
    }
    if (seen.has(key)) {
      refuse("MALFORMED_VALUE", `${label} must be distinct`);
    }
    seen.add(key);
  }
}

/** {@link VetVisitValue}, exactly: no other keys (a new kind, so nothing
 * older to stay compatible with). */
function validateVetVisit(value: unknown): void {
  if (!isPlainObject(value)) {
    refuse("MALFORMED_VALUE", "vet_visit needs { did, clinicId, costEur, paidBy }");
  }
  const unknownKey = Object.keys(value).find((k) => !VET_VISIT_KEYS.has(k));
  if (unknownKey !== undefined) {
    refuse("MALFORMED_VALUE", `vet_visit does not accept a ${unknownKey} key`);
  }
  const did = value["did"];
  if (!Array.isArray(did) || did.length < 1 || did.length > VISIT_DID.length) {
    refuse("MALFORMED_VALUE", "vet_visit.did must have 1 to 4 entries");
  }
  if (!did.every((d) => VISIT_DID_SET.has(d as string))) {
    refuse("MALFORMED_VALUE", "vet_visit.did must be from sterilised, vaccinated, treated, checked");
  }
  if (new Set(did).size !== did.length) {
    refuse("MALFORMED_VALUE", "vet_visit.did must be distinct");
  }
  if (did.includes("checked") && did.length > 1) {
    refuse("MALFORMED_VALUE", 'vet_visit.did has "checked" only on its own');
  }
  if (did.includes("vaccinated")) {
    if (!Array.isArray(value["vaccines"])) {
      refuse("MALFORMED_VALUE", "a vaccinated visit needs its vaccines");
    }
    validateVaccineList(value["vaccines"] as unknown[], "vet_visit.vaccines");
  } else if ("vaccines" in value) {
    refuse("MALFORMED_VALUE", "vet_visit.vaccines only when the visit vaccinated");
  }
  if (did.includes("treated")) {
    const note = value["treatedNote"];
    if (typeof note !== "string" || note !== note.trim() || note.length < 1 || note.length > 200) {
      refuse("MALFORMED_VALUE", "a treated visit needs a trimmed treatedNote of 1 to 200 characters");
    }
  } else if ("treatedNote" in value) {
    refuse("MALFORMED_VALUE", "vet_visit.treatedNote only when the visit treated");
  }
  const clinicId = value["clinicId"];
  if (typeof clinicId !== "string" || !CLINIC_IDS.has(clinicId)) {
    refuse("MALFORMED_VALUE", "vet_visit.clinicId must be one of the clinic list's ids");
  }
  if (!("costEur" in value)) {
    refuse("MALFORMED_VALUE", "vet_visit.costEur is required (null when not known)");
  }
  const cost = value["costEur"];
  if (cost !== null) {
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0 || cost > VISIT_COST_MAX_EUR) {
      refuse("MALFORMED_VALUE", `vet_visit.costEur must be 0 to ${VISIT_COST_MAX_EUR} euros, or null`);
    }
    const cents = cost * 100;
    if (Math.abs(cents - Math.round(cents)) > 1e-6) {
      refuse("MALFORMED_VALUE", "vet_visit.costEur has at most two decimals");
    }
  }
  if (typeof value["paidBy"] !== "string" || !PAID_BY_SET.has(value["paidBy"])) {
    refuse("MALFORMED_VALUE", "vet_visit.paidBy must be syros_cats, donation or owner");
  }
  const note = value["note"];
  if (note !== undefined && (typeof note !== "string" || note.length > 500)) {
    refuse("MALFORMED_VALUE", "vet_visit.note is at most 500 characters");
  }
  if ("costReason" in value) {
    const reason = value["costReason"];
    if (typeof reason !== "string" || reason !== reason.trim() || reason.length < 1 || reason.length > 200) {
      refuse("MALFORMED_VALUE", "vet_visit.costReason must be trimmed, 1 to 200 characters");
    }
    if (!did.includes("sterilised") || cost === null) {
      refuse("MALFORMED_VALUE", "vet_visit.costReason only on a sterilisation with a cost");
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
  /**
   * Must be true to write a {@link WITHDRAWN} `life_status`. Only the owner's
   * let-go and the team's Remove owner say so: a withdrawal takes an owner's
   * "has a home" back without the owner link going, so no other writer
   * (a team correction, the supersede API) may produce one.
   */
  allowWithdrawal?: boolean;
  /**
   * Must be true to write a `{ retracted: true }` of `sterilised`,
   * `vaccinated` or `vet_visit` (SYC-396 PR 3.0; plan Decisions 6 and 7).
   * Only `undoVetVisit` sets it: retracting the team row that overruled a cat
   * guardian stands her statement up again, so no other writer (the generic
   * Mark wrong, the JSON supersede route) may produce one.
   */
  fromVisitUndo?: boolean;
  /**
   * Must be true to write a `sterilised` or `vaccinated` value carrying a
   * `vetVisitId` (review of PR 3.0, F1). Only `logVetVisit` sets it: undoing
   * a visit retracts every row carrying its id, so a row written any other
   * way (a Mark wrong through the generic path, a guardian's own statement)
   * must never carry one, or undoing the visit would take it back too.
   */
  fromVisit?: boolean;
}

/** A claim withdrawn (claiming-a-cat.md §6, §7): supersedes a homed, asserts
 * nothing. The resolver ignores it, because it has no `status`. */
export const WITHDRAWN = { withdrawn: true } as const;

export function isWithdrawal(kind: ObservationKind, value: unknown): boolean {
  return (
    kind === "life_status" &&
    isPlainObject(value) &&
    value["withdrawn"] === true &&
    Object.keys(value).length === 1
  );
}

const WITHDRAWAL_TARGET_MESSAGE =
  "a life_status withdrawal must supersede an active homed statement on the same cat";

/**
 * A withdrawal is valid only when `supersedesId` points at a `life_status`
 * `{ status: "homed" }` row on the same cat that nothing has superseded yet
 * (the resolver's own meaning of "active", resolve.ts `isActive`). Who may
 * write one is the caller's business (the let-go and remove-owner routes),
 * not this function's.
 */
async function checkWithdrawalTarget(
  tx: DbOrTx,
  input: WriteObservationInput,
): Promise<void> {
  const targetId = input.supersedesId;
  if (targetId == null) refuse("MALFORMED_VALUE", WITHDRAWAL_TARGET_MESSAGE);
  const [target] = await tx
    .select({
      catId: observationsTable.catId,
      kind: observationsTable.kind,
      value: observationsTable.value,
    })
    .from(observationsTable)
    .where(eq(observationsTable.id, targetId));
  const homed =
    target != null &&
    target.catId === input.catId &&
    target.kind === "life_status" &&
    isPlainObject(target.value) &&
    target.value["status"] === "homed";
  if (!homed) refuse("MALFORMED_VALUE", WITHDRAWAL_TARGET_MESSAGE);
  const [already] = await tx
    .select({ id: observationsTable.id })
    .from(observationsTable)
    .where(eq(observationsTable.supersedesId, targetId))
    .limit(1);
  if (already) refuse("MALFORMED_VALUE", WITHDRAWAL_TARGET_MESSAGE);
}

/**
 * A `sterilised` or `vaccinated` value's `vetVisitId`, when present, names a
 * `vet_visit` row of the same cat that nothing has superseded (plan Task
 * 3.1.1): a stray number can't tie two cats together, or tie a statement to
 * a visit already undone. Refused `INVALID_VISIT_LINK`.
 */
async function checkVisitLink(tx: DbOrTx, input: WriteObservationInput): Promise<void> {
  if (input.kind !== "sterilised" && input.kind !== "vaccinated") return;
  if (!isPlainObject(input.value) || !("vetVisitId" in input.value)) return;
  if (input.fromVisit !== true || !isTeamRole(input.roleAtTime)) {
    refuse("INVALID_VISIT_LINK", "only a vet visit, logged by the team, writes a statement linked to it");
  }
  const visitId = input.value["vetVisitId"] as number;
  const [visit] = await tx
    .select({ catId: observationsTable.catId, kind: observationsTable.kind })
    .from(observationsTable)
    .where(eq(observationsTable.id, visitId));
  if (!visit || visit.kind !== "vet_visit" || visit.catId !== input.catId) {
    refuse("INVALID_VISIT_LINK", "vetVisitId must name a vet visit of the same cat");
  }
  // Standing by the resolver's own rule, over the cat's visits.
  const visits = await tx
    .select()
    .from(observationsTable)
    .where(and(eq(observationsTable.catId, input.catId), eq(observationsTable.kind, "vet_visit")));
  if (!standingRows(visits, "vet_visit").some((o) => o.id === visitId)) {
    refuse("INVALID_VISIT_LINK", "vetVisitId names a vet visit that has been undone or replaced");
  }
}

/**
 * Validates and inserts one observation (§10.1). Refuses (throws
 * `ObservationRefused`) rather than writing anything for:
 *
 * - an unknown `kind`, or a `value` that doesn't match its kind's shape;
 * - a `life_status` {@link WITHDRAWN} that doesn't supersede an active
 *   `homed` on the same cat;
 * - a role refused for that kind (`ROLE_NOT_ALLOWED_FOR_KIND`), checked
 *   before reachability: `vet` for `coat` and `markings`; `system` for
 *   `markings`, and for any `coat` that is not `provenance: "machine"`;
 *   `public`, `guardian` and `system` for `vaccinated`; `public` and
 *   `system` for `team_note`;
 * - a `roleAtTime` unreachable in phase 1 (`vet`, the retired `volunteer`
 *   and `admin`, or anything else not in {public, staff, management,
 *   guardian, system}), or `guardian` without a `colony:<id>` scope;
 * - a `guardian` superseding a row that isn't her own, and, for the kinds
 *   Decision G ranks (`sterilised`, `ear_tip`, `life_status`), anyone
 *   superseding someone else's row that has standing but ranks below them
 *   (SYC-316) (`NOT_YOUR_ROW`);
 * - an unknown `authorityScope` or `provenance`, or a `colony:<id>` scope
 *   on any role but `guardian` (roles spec §10.4, Decision B), or an
 *   `owner_of_this_cat` scope on `sterilised` or `ear_tip` (until SYC-130);
 * - not exactly one of `deviceId`/`accountId` set (the same rule the
 *   database's `observations_attribution_ck` enforces, checked here first
 *   for a clear refusal rather than a constraint-violation error), or a
 *   `public` coat/markings write without a `deviceId`;
 * - an `accountId` starting `system:` that isn't on {@link SYSTEM_AUTHORS}
 *   (Part 2g: "real account ids ... never start with system:");
 * - `provenance: "machine"` from anyone but `system:vision` (the only
 *   machine-authored kind today is `coat`, SYC-119 §4.7);
 * - a future `observedAt` (refused for every role);
 * - any supersession whose target is missing or of another kind, for every
 *   role and kind; for `coat` and `markings`, also one whose target is on
 *   another cat (the code is `NOT_YOUR_ROW` when the own-row rule below
 *   applies, `INVALID_RETRACTION` for a retraction, and
 *   `INVALID_SUPERSESSION` otherwise);
 * - a `{ retracted: true }` coat/markings value from anyone but staff,
 *   management or guardian, without a `supersedesId`, or whose
 *   target is not a coat/markings row of the same kind or is itself a
 *   retraction (`INVALID_RETRACTION`); or
 * - a `public` or `system` coat/markings write superseding a row that is
 *   not its own: the same device for `public`, the same system author for
 *   `system` (`NOT_YOUR_ROW`, C2).
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

  const provenance = input.provenance ?? "volunteered";
  if (!PROVENANCES.has(provenance)) {
    refuse("INVALID_PROVENANCE", `Unknown provenance: ${provenance}`);
  }

  // Per-kind role rule, BEFORE value validation (so a public team_note with
  // empty text is refused for its role) and BEFORE the reachability check:
  // it is proven independently of reachability and still holds once SYC-53
  // makes `management` and `guardian` reachable.
  if (
    ROLES_REFUSED_FOR_KIND[input.kind]?.includes(input.roleAtTime) ||
    // `system` may write a coat only as the machine's reading.
    (input.kind === "coat" &&
      input.roleAtTime === "system" &&
      provenance !== "machine")
  ) {
    refuse(
      "ROLE_NOT_ALLOWED_FOR_KIND",
      `roleAtTime "${input.roleAtTime}" may not write ${input.kind}`,
    );
  }

  if (isWithdrawal(input.kind, input.value)) {
    if (input.allowWithdrawal !== true) {
      refuse("MALFORMED_VALUE", "A withdrawal can only be written by a let-go or Remove owner");
    }
    await checkWithdrawalTarget(tx, input);
  } else {
    validateValue(input.kind, input.value, {
      roleAtTime: input.roleAtTime,
      provenance,
    });
  }
  // Decision 7: only a vet-visit undo may retract these kinds. Checked
  // before anything else about the retraction, so no other writer can even
  // probe which rows it could reach.
  const visitRetracting = isVisitRetraction(input.kind, input.value);
  if (visitRetracting && input.fromVisitUndo !== true) {
    refuse(
      "RETRACTION_NOT_ALLOWED",
      `a ${input.kind} statement is undone only by marking its vet visit wrong`,
    );
  }

  if (!REACHABLE_ROLES.has(input.roleAtTime)) {
    refuse(
      "UNREACHABLE_ROLE",
      `roleAtTime "${input.roleAtTime}" is not reachable in phase 1`,
    );
  }

  const authorityScope = input.authorityScope ?? "none";
  // `colony:<id>` (Decision B): exactly that pattern, and only with the role
  // `guardian`. Every other role is refused it here, so the resolver's
  // read-time rule (a colony scope on a non-guardian counts for nothing) is
  // a backstop, never the only guard.
  const colonyScope = COLONY_SCOPE_PATTERN.test(authorityScope);
  if (!AUTHORITY_SCOPES.has(authorityScope) && !colonyScope) {
    refuse("INVALID_AUTHORITY_SCOPE", `Unknown authorityScope: ${authorityScope}`);
  }
  // An owner outranks the team and a guardian (Decision G), so an
  // owner-scoped `sterilised` or `ear_tip` row would make an unverified
  // claimant's word Confirmed. Refused until SYC-130 can check who an owner
  // is (SYC-53 plan, Slice 6). Owner-scoped `life_status` ("homed") and
  // `name` rows from the claim and register routes are unaffected.
  if (
    authorityScope === "owner_of_this_cat" &&
    (input.kind === "sterilised" || input.kind === "ear_tip")
  ) {
    refuse(
      "INVALID_AUTHORITY_SCOPE",
      `authorityScope "owner_of_this_cat" may not write ${input.kind} until SYC-130`,
    );
  }
  if (colonyScope && input.roleAtTime !== "guardian") {
    refuse(
      "INVALID_AUTHORITY_SCOPE",
      `authorityScope "${authorityScope}" is only for roleAtTime "guardian"`,
    );
  }
  // And the other way round: a guardian's statement always names the colony
  // that gave her the power (Decision B), so the resolver can rank it. A
  // guardian row without one would count for nothing and say so nowhere.
  if (input.roleAtTime === "guardian" && !colonyScope) {
    refuse(
      "INVALID_AUTHORITY_SCOPE",
      'roleAtTime "guardian" needs an authorityScope "colony:<id>"',
    );
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
  const teamNoteRetracting = isTeamNoteRetraction(input.kind, input.value);
  const retracting = (isAppearanceKind && isRetraction(input.value)) || visitRetracting || teamNoteRetracting;
  const supersedesId = input.supersedesId ?? null;
  if (retracting && !RETRACTING_ROLES.has(input.roleAtTime)) {
    refuse(
      "INVALID_RETRACTION",
      `roleAtTime "${input.roleAtTime}" may not retract`,
    );
  }
  // A vet-visit kind is retracted only by the team: undoing a visit needs
  // `log_vet_visit`, which is island-only (undoVetVisit checks it). A cat
  // guardian never retracts a sterilisation, even her own.
  if (visitRetracting && !isTeamRole(input.roleAtTime)) {
    refuse(
      "INVALID_RETRACTION",
      `roleAtTime "${input.roleAtTime}" may not retract a ${input.kind}`,
    );
  }
  // A team note is team-only, so only the team takes one back. Deliberately redundant behind
  // ROLES_REFUSED_FOR_KIND (defence in depth); it can't be tested on its own.
  if (teamNoteRetracting && !isTeamRole(input.roleAtTime)) {
    refuse(
      "INVALID_RETRACTION",
      `roleAtTime "${input.roleAtTime}" may not retract a team_note`,
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
    // Nor for the kinds Decision G ranks (PR 2.2 review, n2): marking another
    // cat's sterilisation or life status wrong would change that cat's answer
    // without its lock and without its news.
    // TODO(SYC-59): compare canonical cats through cat_identity once merges exist (a put-back on a merged-in row would be refused here).
    if (RANKED_KINDS.has(input.kind) && target.catId !== input.catId) {
      refuse(refusalCode, "a supersession of this kind must stay on the same cat");
    }
    // A vet-visit retraction, too: undoing a visit never reaches another cat. Nor a team note's.
    if ((visitRetracting || teamNoteRetracting) && target.catId !== input.catId) {
      refuse("INVALID_RETRACTION", "a retraction must stay on the same cat");
    }
    // And only a row that still stands (review of PR 3.0, F2): retracting a
    // row a correction already replaced would stand up the row IT replaced
    // next to that correction.
    if (visitRetracting && target.kind === input.kind) {
      // Held for the rest of the caller's transaction, so a correction or a
      // second undo of the same row queues behind this one (second review).
      await tx.execute(sql`select id from observations where id = ${target.id} for update`);
      const sameKind = await tx
        .select()
        .from(observationsTable)
        .where(or(and(eq(observationsTable.catId, target.catId), eq(observationsTable.kind, target.kind)), eq(observationsTable.supersedesId, target.id)));
      if (supersedeChains(sameKind, input.kind as RestorableKind).displaced.has(target.id)) {
        refuse("INVALID_RETRACTION", "a retraction must supersede a row that still stands");
      }
    }
    // Nothing is written over a vet-visit kind's retraction except, one day,
    // undoVetVisit's re-do (not built): a new value there would stand next
    // to the row the retraction put back.
    if (
      VISIT_KINDS.has(input.kind) &&
      !retracting &&
      isPlainObject(target.value) &&
      target.value["retracted"] === true
    ) {
      refuse("INVALID_SUPERSESSION", "a retraction can't be corrected");
    }
    // A retraction cannot retract a retraction.
    if (
      retracting &&
      isPlainObject(target.value) &&
      target.value["retracted"] === true
    ) {
      refuse("INVALID_RETRACTION", "a retraction cannot supersede a retraction");
    }
    // Every role: a retraction removes only a row of a kind that has one.
    if (
      retracting &&
      !(target.kind === "coat" || target.kind === "markings" || target.kind === "team_note" || VISIT_KINDS.has(target.kind))
    ) {
      refuse(
        "INVALID_RETRACTION",
        "a retraction must supersede a row of the same kind (coat, markings, team_note, sterilised, vaccinated or vet_visit)",
      );
    }
    // A cat guardian corrects her own statements only (SYC-53 plan, PR 2.2:
    // "the supersede layer checks the author, not just the capability"):
    // never the team's, and never another guardian's.
    const ownRow =
      (accountId != null && target.accountId === accountId) ||
      (deviceId != null && target.deviceId === deviceId);
    if (input.roleAtTime === "guardian" && !ownRow) {
      refuse("NOT_YOUR_ROW", "a cat guardian can only correct her own statements");
    }
    // SYC-316: for the kinds Decision G ranks, a supersession reaches only
    // the writer's own row, a row at the writer's level or higher, or a row
    // with no standing at all (a spotter's answer the team marks wrong).
    if (RANKED_KINDS.has(input.kind) && !ownRow) {
      const targetLevel = authorityLevel(target);
      const ownLevel = authorityLevel({
        roleAtTime: input.roleAtTime,
        authorityScope,
        provenance,
      });
      if (targetLevel > 0 && targetLevel < ownLevel) {
        refuse(
          "NOT_YOUR_ROW",
          "a statement can't be marked wrong by someone who outranks it; say it instead",
        );
      }
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

  if (!retracting) await checkVisitLink(tx, input);

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
  /**
   * Only with `loadCatRecords(…, { withHistory: true })`: what
   * {@link resolveAt} needs to rebuild this cat at any earlier moment.
   */
  history?: CatHistory;
}

/**
 * The dated ingredients of a cat's evidence of life (SYC-396 PR 3.0, Task
 * 3.0.3), so a report loads the island once and asks {@link resolveAt} for
 * each point instead of loading it again per point.
 */
export interface CatHistory {
  /** The cat's own `created_at`. */
  createdAt: Date;
  /**
   * Every cat merged into this one, with when it started counting for it
   * (`catsFeeding`'s `since`: the newest merge on its way here). Only merges
   * standing when the records were loaded: a merge undone since then is not
   * here, so `resolveAt` inside its window leaves it out, where
   * `loadCatRecords(…, { asOf })` folds it in, as spec §9.10 requires. A known
   * gap, fixed in PR 3.1 (see {@link resolveAt}).
   */
  mergedAt: ReadonlyMap<number, Date>;
  /** `created_at` of each cat that feeds this one (itself and the merged ones). */
  feedingCreatedAt: ReadonlyMap<number, Date>;
  /** Every resolved sighting of a feeding cat: which cat, and when it was entered. */
  sightings: readonly { catId: number; at: Date }[];
  /** Each `welfare_report` replaced by a row on any cat, with when the first replacing row was entered. */
  welfareReplacedAt: ReadonlyMap<number, Date>;
}

/** `loadCatRecords`'s options (SYC-396 PR 3.0, Decision 10). */
export interface LoadCatRecordsOptions {
  /**
   * The records as they stood at this moment: only rows *entered* by then
   * (`createdAt <= asOf`) — observations, the rows that replaced them,
   * sightings, merges — before supersession is worked out. A cat created
   * after it is left out of the result. A redacted row stays as it is now
   * (privacy beats reproducibility). Known limit: a sighting entered before
   * `asOf` but matched to the cat after it counts, because a match isn't
   * dated.
   */
  asOf?: Date;
  /** Also return each cat's {@link CatHistory}, for `resolveAt`. */
  withHistory?: boolean;
}

/**
 * Evidence of life (§3.4) from a cat's rows, excluding life_status (the
 * resolver already has it directly — resolve.ts's EvidenceOfLife doc
 * comment), colony, note, name, food_and_water, coat, markings, vaccinated
 * and team_note (none imply the cat was alive). The one rule, shared by
 * `loadCatRecords` and `resolveAt`.
 */
function evidenceOfLifeOf(
  observations: readonly Observation[],
  replacedWelfare: ReadonlySet<number>,
  lastSightingAt: Date | null,
  createdAt: Date | null,
): EvidenceOfLife | null {
  let bestAt: Date | null = null;
  let bestSource: EvidenceSource | null = null;
  const consider = (at: Date, source: EvidenceSource) => {
    if (bestAt == null || at.getTime() > bestAt.getTime()) {
      bestAt = at;
      bestSource = source;
    }
  };
  // SYC-396 PR 3.0: a retraction is never evidence of life, nor is a row it
  // retracted (an undone vet visit's "sterilised"); every other
  // sterilisation row still counts, superseded or not, as before. The
  // newest standing vet visit counts (§8.3, amending spine §3.4).
  const sterilisedRetracted = supersedeChains(observations, "sterilised").retracted;
  for (const o of standingRows(observations, "vet_visit")) consider(o.observedAt, "vet_visit");
  for (const o of observations) {
    if (o.kind === "sterilised") {
      if (!isPlainObject(o.value) || o.value["retracted"] !== true) {
        if (!sterilisedRetracted.has(o.id)) consider(o.observedAt, "sterilised");
      }
    }
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
  if (lastSightingAt != null) consider(lastSightingAt, "sighting");

  if (bestAt != null && bestSource != null) return { at: bestAt, source: bestSource, lastSightingAt };
  if (createdAt) return { at: createdAt, source: "created", lastSightingAt };
  return null;
}

const newestOf = (dates: Iterable<Date>): Date | null => {
  let newest: Date | null = null;
  for (const d of dates) if (newest == null || d.getTime() > newest.getTime()) newest = d;
  return newest;
};
const earliestOf = (dates: Iterable<Date>): Date | null => {
  let earliest: Date | null = null;
  for (const d of dates) if (earliest == null || d.getTime() < earliest.getTime()) earliest = d;
  return earliest;
};

/**
 * The batched loader every reader uses (§2.3: never one query per cat).
 * Issues a fixed number of queries whatever `catIds.length` is:
 *
 * 1. The merges, through `catsFeeding` (lib/catIdentity.ts, two queries):
 *    a cat's observations may have been written against an id that has
 *    since been folded into the one being asked for, directly or through a
 *    chain. A merge since undone feeds nothing. Empty today (no merge
 *    exists, SYC-59).
 * 2. Every observation for every id that feeds any requested cat, in one
 *    `IN (...)`.
 * 3. The welfare reports replaced by a row on any cat.
 * 4. The newest *resolved* sighting for each of those ids, in one grouped
 *    query — needed for `lastSightingAt`, which isn't itself an
 *    observation (with `withHistory`, every resolved sighting's date).
 * 5. Each cat's `created_at`, for §3.4's last-resort fallback.
 *
 * The plan describes this as "one batched query for the observations ...
 * and one batched query for each cat's evidence of life". This loader
 * computes the evidence-of-life kinds (`sterilised`, `ear_tip`,
 * `welfare_report`, `vet_visit`) from the observation rows query 2 already
 * fetches, rather than a separate query for them — functionally the same
 * thing (every cat gets the same fixed, N-independent query count; the
 * named test only requires that it's fixed), one query cheaper.
 *
 * Deliberately leaves out §3.4's fourth evidence-of-life source, a linked
 * import record's operation date (SYC-49 / SYC-82, not built).
 *
 * `exec` lets a caller read through its own transaction (claiming-a-cat.md
 * §5: the claim reads the cat's status inside the transaction that locks it).
 * `opts.asOf` reads the records as they stood then (Decision 10).
 */
export async function loadCatRecords(
  catIds: readonly number[],
  exec: DbOrTx = db,
  opts: LoadCatRecordsOptions = {},
): Promise<Map<number, CatRecords>> {
  const result = new Map<number, CatRecords>();
  const uniqueIds = [...new Set(catIds)];
  if (uniqueIds.length === 0) return result;
  const asOf = opts.asOf;

  // Every cat merged into each one, through chains, as of `asOf`: the one
  // reader of merges (SYC-410). An undone merge feeds nothing.
  const feeding = await catsFeeding(uniqueIds, { asOf }, exec);
  const idsForCanonical = new Map<number, number[]>();
  const mergedAtByCanonical = new Map<number, ReadonlyMap<number, Date>>();
  for (const id of uniqueIds) {
    const f = feeding.get(id);
    idsForCanonical.set(id, f?.ids ?? [id]);
    mergedAtByCanonical.set(id, f?.since ?? new Map());
  }
  const allCatIds = [...new Set([...idsForCanonical.values()].flat())];

  const obsRows = await exec
    .select()
    .from(observationsTable)
    .where(
      and(
        inArray(observationsTable.catId, allCatIds),
        asOf ? lte(observationsTable.createdAt, asOf) : undefined,
      ),
    );

  // A welfare_report that has been replaced by a row on ANY cat (re-tying a
  // report to a different cat writes the new row on the new cat, pointing
  // back at the old one; SYC-43 part 2, PR 5) no longer says the old cat was
  // alive. The replacing row is not among obsRows when it lives on another
  // cat, so this reads it across cats: one more query, the same count
  // whatever the number of cats.
  const replacer = alias(observationsTable, "replacer");
  const replacedWelfareRows = await exec
    .select({ id: observationsTable.id, at: replacer.createdAt })
    .from(observationsTable)
    .innerJoin(replacer, eq(replacer.supersedesId, observationsTable.id))
    .where(
      and(
        eq(observationsTable.kind, "welfare_report"),
        inArray(observationsTable.catId, allCatIds),
        asOf ? lte(replacer.createdAt, asOf) : undefined,
      ),
    );
  const welfareReplacedAt = new Map<number, Date>();
  for (const r of replacedWelfareRows) {
    const was = welfareReplacedAt.get(r.id);
    if (!was || r.at.getTime() < was.getTime()) welfareReplacedAt.set(r.id, r.at);
  }
  const replacedWelfare = new Set(welfareReplacedAt.keys());

  const sightingWhere = and(
    inArray(sightingsTable.catId, allCatIds),
    eq(sightingsTable.status, "resolved"),
    asOf ? lte(sightingsTable.createdAt, asOf) : undefined,
  );
  // With history, every resolved sighting's date; otherwise the newest per cat.
  const sightingRows: { catId: number | null; at: Date }[] = opts.withHistory
    ? await exec
        .select({ catId: sightingsTable.catId, at: sightingsTable.createdAt })
        .from(sightingsTable)
        .where(sightingWhere)
    : (
        await exec
          .select({
            catId: sightingsTable.catId,
            newest: sql<string>`max(${sightingsTable.createdAt})`,
          })
          .from(sightingsTable)
          .where(sightingWhere)
          .groupBy(sightingsTable.catId)
      ).flatMap((s) => (s.newest ? [{ catId: s.catId, at: new Date(s.newest) }] : []));

  const catRows = await exec
    .select({ id: catsTable.id, createdAt: catsTable.createdAt })
    .from(catsTable)
    .where(inArray(catsTable.id, allCatIds));

  const obsByCatId = new Map<number, Observation[]>();
  for (const o of obsRows) {
    const list = obsByCatId.get(o.catId) ?? [];
    list.push(o);
    obsByCatId.set(o.catId, list);
  }
  const sightingsByCatId = new Map<number, Date[]>();
  for (const s of sightingRows) {
    if (s.catId == null) continue;
    sightingsByCatId.set(s.catId, [...(sightingsByCatId.get(s.catId) ?? []), s.at]);
  }
  const createdAtByCatId = new Map<number, Date>();
  for (const c of catRows) createdAtByCatId.set(c.id, c.createdAt);

  for (const canonicalId of uniqueIds) {
    const ownCreatedAt = createdAtByCatId.get(canonicalId);
    // Not created yet at `asOf`: not a cat then.
    if (asOf && ownCreatedAt && ownCreatedAt.getTime() > asOf.getTime()) continue;

    const feedingIds = idsForCanonical.get(canonicalId) ?? [canonicalId];
    const observations = feedingIds.flatMap((id) => obsByCatId.get(id) ?? []);
    const lastSightingAt = newestOf(feedingIds.flatMap((id) => sightingsByCatId.get(id) ?? []));
    const createdAt = earliestOf(
      feedingIds.map((id) => createdAtByCatId.get(id)).filter((d): d is Date => d != null),
    );
    const evidenceOfLife = evidenceOfLifeOf(observations, replacedWelfare, lastSightingAt, createdAt);

    const records: CatRecords = { observations, evidenceOfLife };
    if (opts.withHistory && ownCreatedAt) {
      const feedingCreatedAt = new Map<number, Date>();
      for (const id of feedingIds) {
        const at = createdAtByCatId.get(id);
        if (at) feedingCreatedAt.set(id, at);
      }
      const welfareIds = new Set(observations.filter((o) => o.kind === "welfare_report").map((o) => o.id));
      records.history = {
        createdAt: ownCreatedAt,
        mergedAt: mergedAtByCanonical.get(canonicalId) ?? new Map(),
        feedingCreatedAt,
        sightings: feedingIds.flatMap((id) => (sightingsByCatId.get(id) ?? []).map((at) => ({ catId: id, at }))),
        welfareReplacedAt: new Map([...welfareReplacedAt].filter(([id]) => welfareIds.has(id))),
      };
    }
    result.set(canonicalId, records);
  }

  return result;
}

/**
 * One cat as it stood at `at` (SYC-396 PR 3.0, Task 3.0.3; Decision 10),
 * from records loaded once with `withHistory`: only what had been entered by
 * then (`createdAt <= at`) — rows, the rows that replaced them, sightings,
 * merges — and resolved as `resolveCat` would at `now`. Null when the cat
 * had not been created yet. Pure: a report with many points loads the
 * island once and calls this per point.
 *
 * `resolveAt(records, T, now)` equals `loadCatRecords(…, { asOf: T })` then
 * `resolveCat(…, now)`, as long as `records` was loaded at or after T, with
 * one known exception: a merge undone between T and the load. `records`
 * only knows the merges standing when it was loaded, so inside an undone
 * merge's window the merged-in cat is left out here, where `asOf` folds it
 * in (spec §9.10 says it should be folded in). Not reachable today: no
 * merge exists (SYC-59). PR 3.1 builds the merge and move timeline that
 * fixes it (catIdentity.attack.test.ts A11, marked `it.fails` until then).
 */
export function resolveAt(records: CatRecords, at: Date, now: Date): CatSnapshot | null {
  const h = records.history;
  if (!h) throw new Error("resolveAt needs records loaded with { withHistory: true }");
  const t = at.getTime();
  if (h.createdAt.getTime() > t) return null;
  const merged = (catId: number) => {
    const m = h.mergedAt.get(catId);
    return m === undefined || m.getTime() <= t;
  };
  const observations = records.observations.filter((o) => o.createdAt.getTime() <= t && merged(o.catId));
  const replaced = new Set([...h.welfareReplacedAt].filter(([, d]) => d.getTime() <= t).map(([id]) => id));
  const lastSightingAt = newestOf(
    h.sightings.filter((s) => s.at.getTime() <= t && merged(s.catId)).map((s) => s.at),
  );
  const createdAt = earliestOf([...h.feedingCreatedAt].filter(([id]) => merged(id)).map(([, d]) => d));
  return resolveCat(observations, evidenceOfLifeOf(observations, replaced, lastSightingAt, createdAt), now);
}
