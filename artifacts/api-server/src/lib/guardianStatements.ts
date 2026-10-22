import { eq, sql } from "drizzle-orm";
import { db, observationsTable, type Observation } from "@workspace/db";
import { actingRole, can, type CapabilityHolder } from "./capabilities";
import { canonicalCats, catTarget } from "./capabilityTargets";
import { commitStatement, inStatementTransaction, type Tx } from "./commitStatement";
import { loadCatRecords, ObservationRefused } from "./observations";
import { resolveLifeStatus, supersedeChains, type LifeStatusValue } from "./resolve";

// What a cat guardian says about a cat in her own colonies (SYC-53 plan, PR
// 2.2; roles spec §2.2, §7.2, Decision 5, Q3): "she is sterilised" or "she
// isn't", and that a cat is homed, in care or has died, plus putting back a
// life status she herself replaced in the last 30 days.
//
// Everything that decides who she is and what counts is worked out HERE, on
// the server, inside the transaction that writes:
// - the cat's colony, read from the record after the cat is locked (never
//   from the request), and checked with can() for that colony;
// - the role, through actingRole (a team member who also guards a colony
//   writes her team role, as for any team action);
// - the `colony:<id>` scope, for that colony, only when the role is
//   `guardian` (Decision B);
// - the date: now. A date, role or scope sent by the phone is never read
//   (Decision G: "the server sets observedAt on every guardian route").
//
// "Sterilised" goes through commitStatement, so her word that makes a cat
// Confirmed announces it once, like anyone's.

type Person = CapabilityHolder & { id: string };

/** The statuses she may say (spec §6.2 `set_life_status`); `street` only by putting back. */
export const GUARDIAN_LIFE_STATUSES = ["homed", "in_care", "deceased"] as const;
export type GuardianLifeStatus = (typeof GUARDIAN_LIFE_STATUSES)[number];

/** How long she may put back her own life-status change, and how long a homed or deceased mark stays flagged. */
export const GUARDIAN_UNDO_DAYS = 30;
const DAY_MS = 86_400_000;

/** The reason written when she puts a status back. */
export const PUT_BACK_REASON = "Put back by the cat guardian";

const notAuthorised = () => new ObservationRefused("NOT_AUTHORISED", "Not authorised");
const notFound = () => new ObservationRefused("NOT_FOUND", "Not found");

interface Authority {
  /** The cat the statement is written on: the one asked about, or the cat it was merged into. */
  catId: number;
  roleAtTime: string;
  authorityScope: string;
}

/**
 * Locks the cat, reads its colony from the record, and checks this person may
 * use `capability` there. A cat in no colony, or in a colony that isn't hers,
 * is refused (NOT_AUTHORISED); no such cat is NOT_FOUND.
 */
async function authorityFor(
  tx: Tx,
  person: Person,
  capability: "set_sterilisation" | "set_life_status",
  catId: number,
): Promise<Authority> {
  const canonical = (await canonicalCats([catId], tx)).get(catId) ?? null;
  if (canonical === null) throw notAuthorised();
  const locked = await tx.execute<{ id: number }>(
    sql`select id from cats where id = ${canonical} for update`,
  );
  if (locked.rows.length === 0) throw notFound();
  // Read again under the lock: a move out of her colony that committed while
  // we waited is seen here.
  const target = await catTarget(canonical, tx);
  if (typeof target.colonyId !== "number" || !can(person, capability, target)) {
    throw notAuthorised();
  }
  const roleAtTime = actingRole(person, capability, target);
  return {
    catId: canonical,
    roleAtTime,
    authorityScope: roleAtTime === "guardian" ? `colony:${target.colonyId}` : "none",
  };
}

/** "She is sterilised" (true) or "she isn't" (false): one tap, no "from what record?". */
export async function guardianSaysSterilised(
  person: Person,
  catId: number,
  sterilised: boolean,
  now: Date = new Date(),
): Promise<Observation> {
  return inStatementTransaction(async (tx, news) => {
    const a = await authorityFor(tx, person, "set_sterilisation", catId);
    return commitStatement(
      tx,
      {
        catId: a.catId,
        kind: "sterilised",
        value: { sterilised },
        accountId: person.id,
        roleAtTime: a.roleAtTime,
        authorityScope: a.authorityScope,
        observedAt: now,
      },
      news,
      now,
    );
  });
}

/** "Homed", "in care" or "has died", with her short reason. */
export async function guardianSaysLifeStatus(
  person: Person,
  catId: number,
  status: GuardianLifeStatus,
  reason: string,
  now: Date = new Date(),
): Promise<Observation> {
  if (!(GUARDIAN_LIFE_STATUSES as readonly string[]).includes(status)) {
    throw new ObservationRefused("MALFORMED_VALUE", "A cat guardian says homed, in care or deceased");
  }
  return inStatementTransaction(async (tx, news) => {
    const a = await authorityFor(tx, person, "set_life_status", catId);
    return commitStatement(
      tx,
      {
        catId: a.catId,
        kind: "life_status",
        value: { status, reason },
        accountId: person.id,
        roleAtTime: a.roleAtTime,
        authorityScope: a.authorityScope,
        observedAt: now,
      },
      news,
      now,
    );
  });
}

/** Active, parsed life-status rows, newest first (observedAt, then id): the resolver's order. */
function activeLifeStatusRows(observations: readonly Observation[]): Observation[] {
  const replaced = new Set(
    observations.map((o) => o.supersedesId).filter((id): id is number => id != null),
  );
  return observations
    .filter((o) => o.kind === "life_status" && !replaced.has(o.id))
    .filter((o) => {
      const v = o.value as { status?: unknown } | null;
      return typeof v?.status === "string";
    })
    .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime() || b.id - a.id);
}

/**
 * What she may put back on this cat now, or null: her OWN statement that
 * still decides the cat's life status (the newest standing one), made in the
 * last 30 days, and the status that stood before it.
 */
export function puttableBack(
  personId: string,
  observations: readonly Observation[],
  evidenceOfLife: Parameters<typeof resolveLifeStatus>[1],
  now: Date,
): { statement: Observation; putsBack: LifeStatusValue } | null {
  const newest = activeLifeStatusRows(observations)[0];
  if (!newest) return null;
  if (newest.accountId !== personId || newest.roleAtTime !== "guardian") return null;
  // Still the statement that decides it: a later sighting that revived a cat
  // she marked deceased leaves nothing of hers to put back.
  if (!resolveLifeStatus(observations, evidenceOfLife, now).supportingObservationIds.includes(newest.id)) {
    return null;
  }
  if (now.getTime() - newest.createdAt.getTime() > GUARDIAN_UNDO_DAYS * DAY_MS) return null;
  // What the record says without her statement: the status she replaced.
  const without = observations.filter((o) => o.id !== newest.id);
  const putsBack = resolveLifeStatus(without, evidenceOfLife, now).value ?? "street";
  return { statement: newest, putsBack };
}

/**
 * Puts back the life status she herself replaced, within 30 days (spec §2.2,
 * test 28 and 29c). Marks her own statement wrong with the status that stood
 * before it, dated as hers was (so nothing else on the cat moves, and the cat
 * gains no new "seen alive" date). Refused if the statement isn't hers, is
 * older than 30 days, or no longer decides the cat's status (someone has said
 * something newer since).
 */
export async function guardianPutsBack(
  person: Person,
  catId: number,
  statementId: number,
  now: Date = new Date(),
): Promise<Observation> {
  return inStatementTransaction(async (tx, news) => {
    const a = await authorityFor(tx, person, "set_life_status", catId);
    const record = (await loadCatRecords([a.catId], tx)).get(a.catId);
    const back = puttableBack(person.id, record?.observations ?? [], record?.evidenceOfLife ?? null, now);
    if (!back || back.statement.id !== statementId) {
      throw new ObservationRefused("NOT_YOUR_ROW", "Only your own change from the last 30 days can be put back");
    }
    // The statement row itself, locked: a second press at the same moment
    // finds it already put back.
    await tx.execute(sql`select id from observations where id = ${statementId} for update`);
    const [taken] = await tx
      .select({ id: observationsTable.id })
      .from(observationsTable)
      .where(eq(observationsTable.supersedesId, statementId))
      .limit(1);
    if (taken) throw new ObservationRefused("ALREADY_SUPERSEDED", "Already put back");
    return commitStatement(
      tx,
      {
        catId: a.catId,
        kind: "life_status",
        value: { status: back.putsBack },
        accountId: person.id,
        roleAtTime: a.roleAtTime,
        authorityScope: a.authorityScope,
        observedAt: back.statement.observedAt,
        supersedesId: statementId,
        supersedeReason: PUT_BACK_REASON,
      },
      news,
      now,
    );
  });
}

/** What her cat page tells her about her own statements on one cat. */
export interface MyStatements {
  /** Her change she may put back now, and what it would put back. */
  putBack: { statementId: number; status: LifeStatusValue; putsBack: LifeStatusValue } | null;
  /**
   * Her statements Syros Cats marked wrong in the last 30 days, newest first,
   * with what the team now says (spec §7.2: "Syros Cats looked again…"). No
   * team member's name, ever.
   */
  lookedAgain: { kind: "sterilised" | "life_status"; now: boolean | LifeStatusValue | null; at: string }[];
}

/**
 * Her own statements about this cat, as her page shows them. Only rows SHE
 * wrote, and the team's answers to them; never anyone else's statements.
 */
export async function myStatementsOnCat(
  personId: string,
  catId: number,
  now: Date = new Date(),
): Promise<MyStatements> {
  const record = (await loadCatRecords([catId], db)).get(catId);
  const observations = record?.observations ?? [];
  const back = puttableBack(personId, observations, record?.evidenceOfLife ?? null, now);
  const mine = new Map(
    observations
      .filter(
        (o) =>
          o.accountId === personId &&
          o.roleAtTime === "guardian" &&
          (o.kind === "sterilised" || o.kind === "life_status"),
      )
      .map((o) => [o.id, o]),
  );
  const lookedAgain: MyStatements["lookedAgain"] = [];
  // A team row that overruled her and was then undone with its vet visit no
  // longer says anything: her statement stands again (SYC-396 PR 3.0).
  const undone = supersedeChains(observations, "sterilised").retracted;
  for (const o of observations) {
    if (o.supersedesId == null || !mine.has(o.supersedesId)) continue;
    if (undone.has(o.id)) continue;
    // Her own put-back is not someone looking again.
    if (o.accountId === personId) continue;
    if (now.getTime() - o.createdAt.getTime() > GUARDIAN_UNDO_DAYS * DAY_MS) continue;
    const v = (o.value ?? {}) as Record<string, unknown>;
    const said =
      o.kind === "sterilised"
        ? typeof v["sterilised"] === "boolean"
          ? (v["sterilised"] as boolean)
          : null
        : typeof v["status"] === "string"
          ? (v["status"] as LifeStatusValue)
          : null;
    lookedAgain.push({
      kind: o.kind as "sterilised" | "life_status",
      now: said,
      at: o.createdAt.toISOString(),
    });
  }
  lookedAgain.sort((a, b) => b.at.localeCompare(a.at));
  return {
    putBack: back
      ? {
          statementId: back.statement.id,
          status: (back.statement.value as { status: LifeStatusValue }).status,
          putsBack: back.putsBack,
        }
      : null,
    lookedAgain,
  };
}

/**
 * The team's 30-day flag (spec §2.2, §7.2): a cat a guardian marked homed or
 * deceased in the last 30 days, while that statement still DECIDES the cat's
 * life status (`deciding`: the resolver's supporting ids). A newer status, a
 * sighting that revived the cat, or the team marking hers wrong all end it.
 * Shown on the team's cat page now, and on the round sheet once it exists
 * (PR 4.2).
 */
export function recentGuardianMark(
  observations: readonly Observation[],
  deciding: readonly number[],
  now: Date = new Date(),
): Observation | null {
  const replaced = new Set(
    observations.map((o) => o.supersedesId).filter((id): id is number => id != null),
  );
  let newest: Observation | null = null;
  for (const o of observations) {
    if (o.kind !== "life_status" || o.roleAtTime !== "guardian" || replaced.has(o.id)) continue;
    if (!deciding.includes(o.id)) continue;
    const status = (o.value as { status?: unknown } | null)?.status;
    if (status !== "homed" && status !== "deceased") continue;
    if (now.getTime() - o.createdAt.getTime() > GUARDIAN_UNDO_DAYS * DAY_MS) continue;
    if (!newest || o.createdAt.getTime() > newest.createdAt.getTime()) newest = o;
  }
  return newest;
}
