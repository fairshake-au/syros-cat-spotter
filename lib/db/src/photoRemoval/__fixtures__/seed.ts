import crypto from "node:crypto";
import type pg from "pg";

// SYC-462 tests and the local rehearsal: one photo placed in every place
// spec §3.1 lists, plus a stand-in the public would see in its place. Raw SQL
// on a pg client, like the CLI it exercises.

export interface SeededPhoto {
  /** The approving team member (staff, joined, in force). */
  person: string;
  photoId: number;
  publicId: string;
  catId: number;
  /** The newest visible cover of the cat's resolved sightings, which the cat should move to. */
  standIn: number;
  /** The sighting whose cover and `first` photo is the photo. */
  sightingId: number;
}

/** A picture of `size` bytes no other seed shares, with no JPEG header. */
export function picture(seed: number, size = 3000): string {
  const out = Buffer.alloc(size);
  for (let i = 0; i < size; i++) out[i] = (i * (seed * 2 + 7) + seed * 13 + 5) % 251;
  return out.toString("base64");
}

export async function staffPerson(c: pg.ClientBase, label: string): Promise<string> {
  const id = (
    await c.query<{ id: string }>(
      `insert into people (email, name, added_by, accepted_at) values ($1, 'Staff', 'cli:test', now()) returning id`,
      [`${label}-${crypto.randomBytes(3).toString("hex")}@example.com`],
    )
  ).rows[0]!.id;
  await c.query(`insert into person_scopes (person_id, role, reach) values ($1, 'staff', 'island')`, [id]);
  return id;
}

/**
 * The photo as: a cat's main photo; a resolved sighting's cover and `first`
 * photo; small and medium versions; an observation; a `photo_private`
 * report; a privacy hide. `opts.hide` false leaves it public (for refusals).
 */
export async function seedEverywhere(
  c: pg.ClientBase,
  base64: string,
  label: string,
  opts: { hide?: "privacy" | "plain" | false; report?: "photo_private" | "photo_inappropriate" | false } = {},
): Promise<SeededPhoto> {
  const hide = opts.hide ?? "privacy";
  const report = opts.report ?? "photo_private";
  const person = await staffPerson(c, label);
  const one = async <T>(sql: string, params: unknown[]) => (await c.query(sql, params)).rows[0] as T;

  const p = await one<{ id: number; public_id: string }>(
    `insert into photos (data) values ($1) returning id, public_id`,
    [base64],
  );
  const standIn = await one<{ id: number }>(`insert into photos (data) values ($1) returning id`, [
    picture(9000 + p.id, 300),
  ]);
  const cat = await one<{ id: number }>(
    `insert into cats (name, description, primary_photo_id, lat, lng, discoverer_device_id)
     values ($1, '', $2, 37.44, 24.94, 'seed-device') returning id`,
    [`${label} cat ${crypto.randomBytes(3).toString("hex")}`, p.id],
  );
  // An older resolved sighting whose cover is the stand-in, then a newer one whose cover is the photo.
  await c.query(
    `insert into sightings (device_id, photo_id, lat, lng, status, cat_id, created_at)
     values ('seed-device', $1, 37.44, 24.94, 'resolved', $2, now() - interval '2 days')`,
    [standIn.id, cat.id],
  );
  const s = await one<{ id: number }>(
    `insert into sightings (device_id, photo_id, lat, lng, status, cat_id, created_at)
     values ('seed-device', $1, 37.44, 24.94, 'resolved', $2, now() - interval '1 day') returning id`,
    [p.id, cat.id],
  );
  await c.query(`insert into sighting_photos (sighting_id, photo_id, role, position) values ($1, $2, 'first', 1)`, [
    s.id,
    p.id,
  ]);
  await c.query(
    `insert into photo_variants (photo_id, size, bytes) values ($1, 'small', $2), ($1, 'medium', $3)`,
    [p.id, Buffer.from(`small-${p.id}`), Buffer.from(`medium-${p.id}`)],
  );
  await c.query(
    `insert into observations (cat_id, kind, value, observed_at, device_id, role_at_time, photo_id, sighting_id)
     values ($1, 'ear_tip', '{"clipped": true}', now(), 'seed-device', 'public', $2, $3)`,
    [cat.id, p.id, s.id],
  );
  if (report) {
    await c.query(
      `insert into welfare_reports (public_id, severity, client_ref, kind, reason, photo_id, photo_state, cat_id)
       values ($1, 'attention', $1, 'content', $2, $3, 'none', $4)`,
      [`seed-${crypto.randomBytes(6).toString("hex")}`, report, p.id, cat.id],
    );
  }
  if (hide) {
    await c.query(
      `insert into photo_visibility_events (photo_id, action, author, person_id, reason) values ($1, 'hide', $2::text, $2::uuid, $3)`,
      [p.id, person, hide === "privacy" ? "privacy" : null],
    );
  }
  return { person, photoId: p.id, publicId: p.public_id, catId: cat.id, standIn: standIn.id, sightingId: s.id };
}
