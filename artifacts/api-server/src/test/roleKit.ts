import { randomBytes } from "node:crypto";
import {
  addPerson,
  catsTable,
  db,
  markLeft,
  observationsTable,
  photosTable,
  photoVisibilityEventsTable,
  pool,
} from "@workspace/db";
import { sessionCookieFor } from "../lib/teamAuth/__fixtures__/queueKit";

// Tests only (SYC-53 PR 0.5): every kind of person the route walk and the
// placement tests need, each with a session cookie, plus colonies and cats
// placed in them. Everything is named with a per-run prefix.

if (!process.env["VITEST"]) {
  throw new Error("roleKit is for tests only (VITEST is not set).");
}

export const RUN = randomBytes(3).toString("hex");

/** A new colony; its id. */
export async function newColony(label: string): Promise<number> {
  const name = `vt-roles ${label} ${RUN} ${randomBytes(3).toString("hex")}`;
  const r = await pool.query<{ id: number }>(
    "insert into colonies (name, normalised_name) values ($1, lower($1)) returning id",
    [name],
  );
  return r.rows[0]!.id;
}

let clock = Date.parse("2026-09-01T10:00:00Z");

/** Says a cat is in a colony (or in none), as the team would. */
export async function putInColony(catId: number, colonyId: number | null): Promise<void> {
  clock += 60_000;
  await db.insert(observationsTable).values({
    catId,
    kind: "colony",
    value: { colonyId },
    deviceId: `vt-roles-device-${RUN}`,
    roleAtTime: "staff",
    observedAt: new Date(clock),
  });
}

export interface SeededCat {
  id: number;
  photoId: number;
  photoPublicId: string;
}

/** A cat with its own main photo, in `colonyId` (or none). */
export async function seedCat(colonyId: number | null): Promise<SeededCat> {
  const [p] = await db
    .insert(photosTable)
    .values({ data: Buffer.from("fake-jpeg").toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id, publicId: photosTable.publicId });
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `vt-roles cat ${RUN} ${randomBytes(3).toString("hex")}`,
      primaryPhotoId: p!.id,
      lat: 37.445,
      lng: 24.942,
      discovererDeviceId: `vt-roles-device-${RUN}`,
    })
    .returning({ id: catsTable.id });
  if (colonyId !== null) await putInColony(c!.id, colonyId);
  return { id: c!.id, photoId: p!.id, photoPublicId: p!.publicId };
}

/** Hides a photo from the public, as the team would. */
export async function hidePhoto(photoId: number): Promise<void> {
  // As a public report would (SYC-44's author shape), so no person is tied
  // to the row and the test's people can be cleaned up.
  await db.insert(photoVisibilityEventsTable).values({
    photoId,
    action: "hide",
    author: `report:vt-roles-${RUN}`,
    personId: null,
    reason: "vt-roles",
  });
}

export interface Signed {
  id: string;
  email: string;
  cookie: string;
}

const email = (label: string) => `vitest-roles-${label}-${RUN}@example.com`;

/** Someone added directly (joined), with these rows, and a session. */
export async function signedPerson(
  label: string,
  roles: string[],
  colonyId?: number,
): Promise<Signed> {
  const p = await addPerson({
    email: email(label),
    name: `Vt ${label}`,
    addedBy: "cli:vitest",
    roles,
    colonyId,
  });
  return { id: p.id, email: email(label), cookie: sessionCookieFor(p.id, p.sessionVersion) };
}

/** A guardian placed on each of these colonies. */
export async function guardianOn(label: string, colonies: number[]): Promise<Signed> {
  const g = await signedPerson(label, ["guardian"], colonies[0]);
  for (const colony of colonies.slice(1)) {
    await pool.query(
      `insert into person_scopes (person_id, role, colony_id, reach) values ($1, 'guardian', $2, 'colony')`,
      [g.id, colony],
    );
  }
  return g;
}

/**
 * A cat guardian with no colony yet (SYC-439): joined, holding only a
 * "start" row, written the way the people command writes one.
 */
export async function starterPerson(label: string): Promise<Signed> {
  const s = await signedPerson(label, ["vet"]);
  await pool.query("delete from person_scopes where person_id = $1", [s.id]);
  await pool.query(
    `insert into person_scopes (person_id, role, colony_id, reach, granted_by) values ($1, 'guardian', null, 'start', 'cli:vitest')`,
    [s.id],
  );
  return s;
}

/** Ends every placement this person has, a second ago by the database's clock. */
export async function endPlacements(personId: string): Promise<void> {
  await pool.query(
    `update person_scopes set expires_at = now() - interval '1 second' where person_id = $1`,
    [personId],
  );
}

/** An invitee who hasn't accepted: their session (forged) must not count. */
export async function pendingPerson(label: string): Promise<Signed> {
  const s = await signedPerson(label, ["staff"]);
  await pool.query("update people set accepted_at = null where id = $1", [s.id]);
  return s;
}

/** Someone who has left; the cookie carries their new session version. */
export async function leftPerson(label: string): Promise<Signed> {
  const s = await signedPerson(label, ["staff"]);
  const left = await markLeft(s.email, "cli:vitest");
  return { ...s, cookie: sessionCookieFor(s.id, left!.sessionVersion) };
}
