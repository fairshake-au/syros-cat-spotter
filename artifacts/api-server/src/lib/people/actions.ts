import {
  invitePerson,
  markLeftById,
  normaliseEmail,
  PeopleError,
  rejoinPerson,
  resendInvitation,
  setPlacements,
  signOutEverywhereById,
  withdrawInvitation,
  type PersonWithScopes,
  type PlacementInput,
  type PeopleTx,
} from "@workspace/db";
import { can } from "../capabilities";
import { addressKey, consume, declareLimit } from "../limits";
import { enqueueAccessNotices, enqueuePersonInvite } from "../mail/personOutbox";
import { kickRow } from "../mail/outbox";
import { hashRecipient } from "../mail/send";
import { sql } from "drizzle-orm";
import type { AccessChange } from "../mail/personTemplates";
import { pageLanguage } from "../teamPages/strings";

// SYC-53 PR 1.1: the actions layer the People screen (PR 1.2) calls
// (roles-and-invites.md §8.1, §8.3, §8.5, §9). Each action does, in order:
// the permission it can check (`manage_people`, and never on yourself where
// the spec forbids it), the limits, the lib/db function, and, INSIDE that
// function's own transaction, the emails: the invitation and one
// access-change notice per other manager. So a change can't happen without
// its notice, and a refused change queues nothing. After it commits, each
// queued row is tried at once (the drain is the retry).
//
// Which changes send the notice (§8.1 "an access change", §8.3, §9.5; plan
// review minor 8): an invitation, a role change, a return, someone marked as
// left and a sign-out everywhere, whoever it concerns (a cat guardian
// included). Resending and withdrawing an invitation give and take no role,
// so they send none (the history still records them).

/** Why an action was refused. `message` is plain English for the screen. */
export class ActionRefused extends Error {
  constructor(
    readonly reason: "forbidden" | "limited" | "refused",
    message: string,
  ) {
    super(message);
    this.name = "ActionRefused";
  }
}

// Limits (§8.5), counted in Postgres (lib/limits.ts), each its own bucket.
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
export const INVITES_PER_INVITER_PER_DAY = 10;
export const INVITES_PER_IP_PER_HOUR = 30;
export const INVITES_PER_ADDRESS_PER_DAY = 1;
const INVITER_BUCKET = "people_invite_inviter";
const IP_BUCKET = "people_invite_ip";
// These two buckets are lib/limits.ts counters, whose windows are aligned
// to the clock: the IP limit is per clock hour; the inviter's day is a
// sliding estimate over two clock-aligned UTC days. Neither is an exact
// rolling window.
declareLimit(INVITER_BUCKET, INVITES_PER_INVITER_PER_DAY, DAY_MS, { sliding: true });
declareLimit(IP_BUCKET, INVITES_PER_IP_PER_HOUR, HOUR_MS);

/**
 * Per address (spec §8.5): one invitation per address in any rolling 24
 * hours, exactly, by the database's clock. Not a counter bucket (a
 * clock-aligned day allowed two a few minutes apart across midnight): the
 * proof is the outbox itself, whose `person_invite` rows keep the keyed
 * fingerprint of the address they went to, even after the person is
 * anonymised. A transaction-scoped advisory lock on that fingerprint comes
 * first, so two invitations to one address at once queue and the second
 * sees the first's row. Runs at the start of invitePerson's transaction,
 * after the input was validated; a refusal changes nothing.
 */
async function onePerAddressPerDay(tx: PeopleTx, email: string): Promise<void> {
  const hash = hashRecipient(normaliseEmail(email), "person_invite");
  // Fail closed: without the key every address would share one fingerprint.
  if (hash === "nokey") throw new Error("EMAIL_FINGERPRINT_KEY is not set; invitations can't be checked per address");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`person_invite_address:${hash}`}, 0))`);
  const recent = await tx.execute(sql`
    select 1 from mail_outbox
     where purpose = 'person_invite' and recipient_hash = ${hash}
       and created_at > now() - interval '24 hours'
     limit 1`);
  if (recent.rows.length > 0) throw new ActionRefused("limited", LIMITED);
}

const LIMITED = "That's more invitations than allowed for now. Please try again later.";

// The limits are counted INSIDE the change's own transaction, after the
// lib/db function has validated everything and made the change (review
// minor 3): a refused typo, an address already on the list, or a change
// refused for any other reason rolls the count back with it, so it never
// spends one of the inviter's ten. A refusal by a limit rolls back too.

/** Tests only: the clock the limits read. */
export type LimitClock = { now?: number };

async function limit(
  tx: PeopleTx,
  bucket: string,
  key: string,
  max: number,
  windowMs: number,
  clock: LimitClock,
  sliding = false,
) {
  const r = await consume(bucket, key, max, windowMs, tx, clock.now ?? Date.now(), { sliding });
  if (!r.allowed) throw new ActionRefused("limited", LIMITED);
}

/** Every invitation message counts against its sender and the address it came from. */
async function countInvitation(tx: PeopleTx, actor: PersonWithScopes, ctx: { ip?: string } & LimitClock) {
  await limit(tx, INVITER_BUCKET, actor.id, INVITES_PER_INVITER_PER_DAY, DAY_MS, ctx, true);
  await limit(tx, IP_BUCKET, addressKey(ctx.ip), INVITES_PER_IP_PER_HOUR, HOUR_MS, ctx);
}

function requireManager(actor: PersonWithScopes): void {
  if (!can(actor, "manage_people")) {
    throw new ActionRefused("forbidden", "Only Syros Cats management can do that.");
  }
}

export const RACED =
  "Someone else changed this at the same moment. Nothing was changed; please try again.";

/** Postgres gave up on a transaction because another one raced it (deadlock, serialisation). */
function isRace(err: unknown): boolean {
  for (let e = err, depth = 0; e && typeof e === "object" && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (code === "40P01" || code === "40001") return true;
  }
  return false;
}

/**
 * Runs a lib/db call, turning its plain-English refusals into
 * ActionRefused. A transaction Postgres rolled back because another raced it
 * (40P01 deadlock, 40001 serialisation; review minor 2) changed nothing, so
 * it is said plainly and never becomes a 500.
 */
export async function run<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof PeopleError) throw new ActionRefused("refused", err.message);
    if (isRace(err)) throw new ActionRefused("refused", RACED);
    throw err;
  }
}

/** Queued rows, tried as soon as the change has committed. */
function kickAll(ids: readonly number[]): void {
  for (const id of ids) kickRow(id);
}

const roleNames = (placements: readonly PlacementInput[]) => [...new Set(placements.map((p) => p.role))].sort();
const colonyIdsOf = (placements: readonly PlacementInput[]) =>
  [...new Set(placements.map((p) => p.colonyId).filter((c): c is number => typeof c === "number"))].sort(
    (a, b) => a - b,
  );

export interface ActionResult {
  personId: string;
  /** The outbox rows queued with the change. */
  outboxIds: number[];
}

/**
 * Invite someone (§4.1, §8.1, §8.5). The language actually used is the one
 * asked for if it is live, else English (review minor 10); the screen says
 * so beforehand, and the event records both.
 */
export async function invite(
  actor: PersonWithScopes,
  input: { email: string; name: string; placements: PlacementInput[]; language: string },
  ctx: { ip?: string } & LimitClock = {},
): Promise<ActionResult & { languageUsed: string }> {
  requireManager(actor);
  const languageUsed = pageLanguage(input.language);
  const outboxIds: number[] = [];
  const r = await run(() =>
    invitePerson(
      actor.id,
      { ...input, languageUsed },
      {
        beforeChange: (tx, { email }) => onePerAddressPerDay(tx, email),
        inTransaction: async (tx, person) => {
          await countInvitation(tx, actor, ctx);
          outboxIds.push(
            await enqueuePersonInvite(tx, { personId: person.id, email: person.email, kind: "invite_sent", by: actor.id }),
          );
          outboxIds.push(
            ...(await notify(tx, actor, person.id, {
              kind: "invited",
              roles: roleNames(input.placements),
              colonyIds: colonyIdsOf(input.placements),
            })),
          );
        },
      },
    ),
  );
  kickAll(outboxIds);
  return { personId: r.id, outboxIds, languageUsed };
}

function notify(tx: PeopleTx, actor: PersonWithScopes, subjectId: string, change: AccessChange) {
  return enqueueAccessNotices(tx, { actorId: actor.id, subjectId, change });
}

/** Resend (§4.4): a fresh 14 days and one more message, at most once a day. */
export async function resend(
  actor: PersonWithScopes,
  personId: string,
  ctx: { ip?: string } & LimitClock = {},
): Promise<ActionResult> {
  requireManager(actor);
  const outboxIds: number[] = [];
  await run(() =>
    resendInvitation(actor.id, personId, {
      inTransaction: async (tx, person) => {
        await countInvitation(tx, actor, ctx);
        outboxIds.push(
          await enqueuePersonInvite(tx, { personId: person.id, email: person.email, kind: "invite_resent", by: actor.id }),
        );
      },
    }),
  );
  kickAll(outboxIds);
  return { personId, outboxIds };
}

/** Withdraw a pending invitation (§4.4, §9.6): marked as left, anonymised if never joined. */
export async function withdraw(actor: PersonWithScopes, personId: string): Promise<{ withdrawn: boolean }> {
  requireManager(actor);
  const r = await run(() => withdrawInvitation(actor.id, personId));
  return { withdrawn: r !== null };
}

/** Change someone's roles and placements (§8.1): never your own; never the last manager's management. */
export async function changeRoles(
  actor: PersonWithScopes,
  personId: string,
  placements: PlacementInput[],
): Promise<ActionResult & { before: string[]; after: string[] }> {
  requireManager(actor);
  const outboxIds: number[] = [];
  const r = await run(() =>
    setPlacements(actor.id, personId, placements, {
      inTransaction: async (tx, res) => {
        outboxIds.push(...(await notify(tx, actor, personId, { kind: "roles_changed", before: res.before, after: res.after })));
      },
    }),
  );
  kickAll(outboxIds);
  return { personId, outboxIds, before: r.before, after: r.after };
}

/**
 * Mark someone as left (§9.1, §9.2): never yourself, never the last manager.
 * Their pending invitations are withdrawn with them; the count is for the
 * screen's line ("3 invitations from Susan were withdrawn when she left").
 */
export async function markLeft(
  actor: PersonWithScopes,
  personId: string,
): Promise<ActionResult & { withdrawnInvitations: number }> {
  requireManager(actor);
  const outboxIds: number[] = [];
  const r = await run(() =>
    markLeftById(actor.id, personId, {
      inTransaction: async (tx, res) => {
        outboxIds.push(...(await notify(tx, actor, personId, { kind: "left", withdrawn: res.withdrawnInvitations })));
      },
    }),
  );
  kickAll(outboxIds);
  return { personId, outboxIds, withdrawnInvitations: r.withdrawnInvitations };
}

/**
 * Sign someone out everywhere (§8.1): management, or the person themselves;
 * never the last management person (§9.5). The other managers are told.
 */
export async function signOutEverywhere(actor: PersonWithScopes, personId: string): Promise<ActionResult> {
  if (actor.id !== personId) requireManager(actor);
  const outboxIds: number[] = [];
  await run(() =>
    signOutEverywhereById(actor.id, personId, {
      inTransaction: async (tx) => {
        outboxIds.push(...(await notify(tx, actor, personId, { kind: "signed_out_everywhere" })));
      },
    }),
  );
  kickAll(outboxIds);
  return { personId, outboxIds };
}

/** Bring someone back (§9.4): roles afresh, pending again, a new invitation. */
export async function bringBack(
  actor: PersonWithScopes,
  personId: string,
  placements: PlacementInput[],
  language: string,
  ctx: { ip?: string } & LimitClock = {},
): Promise<ActionResult & { languageUsed: string }> {
  requireManager(actor);
  const languageUsed = pageLanguage(language);
  const outboxIds: number[] = [];
  await run(() =>
    rejoinPerson(actor.id, personId, placements, language, languageUsed, {
      // Bringing someone back sends an invitation too: the same one per
      // address in any rolling 24 hours (review nit 2).
      beforeChange: (tx, { email }) => onePerAddressPerDay(tx, email),
      inTransaction: async (tx, person) => {
        await countInvitation(tx, actor, ctx);
        outboxIds.push(
          await enqueuePersonInvite(tx, { personId: person.id, email: person.email, kind: "invite_sent", by: actor.id }),
        );
        outboxIds.push(
          ...(await notify(tx, actor, person.id, {
            kind: "rejoined",
            roles: roleNames(placements),
            colonyIds: colonyIdsOf(placements),
          })),
        );
      },
    }),
  );
  kickAll(outboxIds);
  return { personId, outboxIds, languageUsed };
}
