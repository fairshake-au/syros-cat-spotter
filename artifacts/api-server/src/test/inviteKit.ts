import { randomBytes } from "node:crypto";
import type { Response } from "express";
import {
  addPerson,
  findPersonById,
  pool,
  type PersonWithScopes,
  type PlacementInput,
} from "@workspace/db";
import { invite } from "../lib/people/actions";
import { settleOutbox } from "../lib/mail/outbox";
import { INVITE_COOKIE, SESSION_COOKIE, issueInviteSession } from "../lib/teamAuth/session";
import { sessionCookieFor } from "../lib/teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "./removeTestPerson";

// Tests only (SYC-53 PR 1.1): managers, invitations sent through the real
// actions layer and outbox, and invitee cookies. Every person made here is
// remembered and removed by `cleanUpPeople`.

if (!process.env["VITEST"]) {
  throw new Error("inviteKit is for tests only (VITEST is not set).");
}

export const RUN = randomBytes(3).toString("hex");
const made = new Set<string>();

export const emailFor = (label: string) => `vitest-inv-${label}-${RUN}@example.com`;

/** A joined person, with these roles (management given as the walk does). */
export async function joined(label: string, roles: string[] = ["staff"], colonyId?: number) {
  const island = roles.filter((r) => r !== "management");
  const p = await addPerson({
    email: emailFor(label),
    name: `Vt ${label}`,
    addedBy: "cli:vitest",
    roles: island.length ? island : ["staff"],
    colonyId,
  });
  made.add(p.id);
  if (roles.includes("management")) {
    if (island.length) {
      await pool.query(
        `insert into person_scopes (person_id, role, reach) values ($1, 'management', 'island')`,
        [p.id],
      );
    } else {
      await pool.query(`update person_scopes set role = 'management' where person_id = $1`, [p.id]);
    }
  }
  const person = (await findPersonById(p.id))!;
  return { ...person, cookie: sessionCookieFor(p.id, p.sessionVersion) };
}

/** Remember someone made another way (an invitation), for clean-up. */
export function remember(id: string): void {
  made.add(id);
}

/** Invites through the actions layer and lets the outbox deliver it. */
export async function invited(
  actor: PersonWithScopes,
  label: string,
  placements: PlacementInput[] = [{ role: "staff" }],
  language = "en",
): Promise<{ id: string; email: string }> {
  const r = await invite(actor, { email: emailFor(label), name: `Vt ${label}`, placements, language }, { ip: `10.9.${made.size % 250}.1` });
  made.add(r.personId);
  await settleOutbox();
  return { id: r.personId, email: emailFor(label) };
}

/** A real invitee cookie, as the hand-off issues it. */
export function inviteCookieFor(personId: string, sv: number): string {
  let value: string | undefined;
  const res = { cookie: (_n: string, v: string) => void (value = v) } as unknown as Response;
  if (!issueInviteSession(res, { id: personId, sessionVersion: sv }, Math.floor(Date.now() / 1000))) {
    throw new Error("TEAM_SESSION_KEYS is not set");
  }
  return `${INVITE_COOKIE}=${value}`;
}

/** The same signed value, sent under the TEAM cookie's name. */
export function asTeamCookie(inviteCookie: string): string {
  return `${SESSION_COOKIE}=${inviteCookie.slice(INVITE_COOKIE.length + 1)}`;
}

/** The person's row, as stored. */
export async function personRow(id: string) {
  return (await pool.query(`select * from people where id = $1`, [id])).rows[0] as {
    email: string;
    name: string;
    left_at: Date | null;
    accepted_at: Date | null;
    invite_sent_at: Date | null;
    invite_expires_at: Date | null;
    session_version: number;
  };
}

export async function eventKinds(id: string): Promise<string[]> {
  return (await pool.query(`select kind from person_events where person_id = $1 order by id`, [id])).rows.map(
    (r: { kind: string }) => r.kind,
  );
}

/** Every joined manager's address on the list now, but this one's. */
export async function otherManagerEmails(actorId: string): Promise<string[]> {
  const r = await pool.query(
    `select distinct p.email from people p join person_scopes s on s.person_id = p.id
      where s.role = 'management' and p.left_at is null and p.accepted_at is not null
        and (s.expires_at is null or s.expires_at > now()) and p.id <> $1
      order by p.email`,
    [actorId],
  );
  return r.rows.map((x: { email: string }) => x.email);
}

export async function cleanUpPeople(): Promise<void> {
  for (const id of made) {
    const row = await pool.query(`select email from people where id = $1`, [id]);
    if (row.rows[0]) await removeTestPerson(row.rows[0].email).catch(() => undefined);
  }
  made.clear();
}
