import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createThrowawayDatabase, dropThrowawayDatabase } from "./migrate/testDatabase";
import { picture, seedEverywhere } from "./photoRemoval/__fixtures__/seed";
import { hidePhotoForPrivacy, restorePhoto } from "./photoRemoval/hide";
import { removePhoto } from "./photoRemoval/remove";
import { scanBytes, scannedColumns } from "./photoRemoval/search";
import { fingerprint } from "./photoRemoval/rules";

// SYC-527 piece 3, spec docs/specs/find-from-a-photo-whole-island.md §6.1–§6.2:
// a hidden or removed photo has no fingerprint, ever. This file covers the
// table itself and the two lib/db paths; the two api-server paths are in
// artifacts/api-server/src/lib/fingerprint/privacy.test.ts.
//
// Every place the rule must hold (spec §6.2), and where it is tested:
//   1. setPhotoVisibility (api-server lib/photoVisibility.ts)  -> privacy.test.ts
//   2. applyHideRules (api-server lib/issues/hide.ts)          -> privacy.test.ts
//   3. hidePhotoForPrivacy (lib/db photoRemoval/hide.ts)        -> here
//   4. removePhoto (lib/db photoRemoval/remove.ts)              -> here
//   5. the only writer, saveFingerprint (Task 7)                -> fingerprint.source.test.ts
//
// The fingerprint rows are written straight into the table: these tests set
// up the state a real writer would leave, then run the REAL hide or removal.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

let name: string;
let c: pg.Client;
let seq = 5270;

beforeAll(async () => {
  const t = await createThrowawayDatabase(baseUrl, { prefix: "photo_fingerprints" });
  name = t.name;
  c = new pg.Client({ connectionString: t.url });
  await c.connect();
});

afterAll(async () => {
  await c?.end();
  await dropThrowawayDatabase(baseUrl, name);
});

async function addFingerprint(photoId: number, len = 384): Promise<void> {
  await c.query(
    `insert into photo_fingerprints (photo_id, model, vector) values ($1, 'test-model', array_fill(0.05::real, array[$2::int]))`,
    [photoId, len],
  );
}

const hasFingerprint = async (photoId: number) =>
  (await c.query(`select 1 from photo_fingerprints where photo_id = $1`, [photoId])).rowCount === 1;

describe("the table", () => {
  it("takes a list of exactly 384 numbers", async () => {
    const P = await seedEverywhere(c, picture(++seq), "fp-len", { hide: false, report: false });
    await expect(addFingerprint(P.photoId, 383)).rejects.toThrow(/photo_fingerprints_vector_len_ck/);
    await expect(addFingerprint(P.photoId, 385)).rejects.toThrow(/photo_fingerprints_vector_len_ck/);
    await expect(
      c.query(`insert into photo_fingerprints (photo_id, model, vector) values ($1, 'm', '{}')`, [P.photoId]),
    ).rejects.toThrow(/photo_fingerprints_vector_len_ck/);
    // 2 x 192 is 384 numbers, but not a flat list.
    await expect(
      c.query(
        `insert into photo_fingerprints (photo_id, model, vector) values ($1, 'm', array_fill(0.1::real, array[2, 192]))`,
        [P.photoId],
      ),
    ).rejects.toThrow(/photo_fingerprints_vector_len_ck/);
    await addFingerprint(P.photoId, 384);
    expect(await hasFingerprint(P.photoId)).toBe(true);
  });

  it("deleting a photo row deletes its fingerprint (the cascade), and only its own", async () => {
    const a = (await c.query<{ id: number }>(`insert into photos (data) values ($1) returning id`, [picture(++seq, 200)]))
      .rows[0]!.id;
    const b = (await c.query<{ id: number }>(`insert into photos (data) values ($1) returning id`, [picture(++seq, 200)]))
      .rows[0]!.id;
    await addFingerprint(a);
    await addFingerprint(b);
    await c.query(`delete from photos where id = $1`, [a]);
    expect(await hasFingerprint(a)).toBe(false);
    expect(await hasFingerprint(b)).toBe(true);
  });
});

describe("no fingerprint for a hidden or removed photo (spec §6.2)", () => {
  it("path 3: hidePhotoForPrivacy deletes the photo's fingerprint, and no other", async () => {
    const P = await seedEverywhere(c, picture(++seq), "fp-hide", { hide: false, report: false });
    const Q = await seedEverywhere(c, picture(++seq), "fp-hide-other", { hide: false, report: false });
    await addFingerprint(P.photoId);
    await addFingerprint(Q.photoId);
    const r = await hidePhotoForPrivacy(c, { publicId: P.publicId, by: P.person, apply: true });
    expect(r.kind).toBe("hidden");
    expect(await hasFingerprint(P.photoId)).toBe(false);
    expect(await hasFingerprint(Q.photoId)).toBe(true);
  });

  it("path 3: a privacy hide added to an already-hidden photo deletes it too", async () => {
    const P = await seedEverywhere(c, picture(++seq), "fp-hide-again", { hide: "plain", report: false });
    // The state a fingerprint written before this trigger existed would leave.
    await addFingerprint(P.photoId);
    const r = await hidePhotoForPrivacy(c, { publicId: P.publicId, by: P.person, apply: true });
    expect(r.kind).toBe("privacy_added");
    expect(await hasFingerprint(P.photoId)).toBe(false);
  });

  it("a dry run of the hide changes nothing", async () => {
    const P = await seedEverywhere(c, picture(++seq), "fp-hide-dry", { hide: false, report: false });
    await addFingerprint(P.photoId);
    const r = await hidePhotoForPrivacy(c, { publicId: P.publicId, by: P.person, apply: false });
    expect(r.kind).toBe("plan");
    expect(await hasFingerprint(P.photoId)).toBe(true);
  });

  it("restoring a hidden photo doesn't bring its fingerprint back", async () => {
    const P = await seedEverywhere(c, picture(++seq), "fp-restore", { hide: false, report: false });
    await addFingerprint(P.photoId);
    expect((await hidePhotoForPrivacy(c, { publicId: P.publicId, by: P.person, apply: true })).kind).toBe("hidden");
    expect((await restorePhoto(c, { publicId: P.publicId, by: P.person, apply: true })).kind).toBe("restored");
    expect(await hasFingerprint(P.photoId)).toBe(false);
  });

  it("a restore event leaves a fingerprint alone (only a hide deletes)", async () => {
    const P = await seedEverywhere(c, picture(++seq), "fp-restore-keep", { hide: "privacy", report: false });
    expect((await restorePhoto(c, { publicId: P.publicId, by: P.person, apply: true })).kind).toBe("restored");
    // Public again; a fingerprint is made for it later, and the next restore-shaped event must not touch it.
    await addFingerprint(P.photoId);
    await c.query(
      `insert into photo_visibility_events (photo_id, action, author, person_id) values ($1, 'restore', $2::text, $2::uuid)`,
      [P.photoId, P.person],
    );
    expect(await hasFingerprint(P.photoId)).toBe(true);
  });

  it("path 4: removePhoto deletes the photo's fingerprint, and leaves the stand-in's", async () => {
    // seedEverywhere hides P for privacy first, so the fingerprint is added
    // after the hide: only the removal trigger can delete it.
    const P = await seedEverywhere(c, picture(++seq), "fp-remove");
    await addFingerprint(P.photoId);
    await addFingerprint(P.standIn);
    const r = await removePhoto(c, {
      publicId: P.publicId,
      by: P.person,
      ref: "SYC-527",
      apply: true,
      requireSwitch: false,
      recheckDelayMs: 5,
    });
    expect(r.kind).toBe("removed");
    expect(await hasFingerprint(P.photoId)).toBe(false);
    expect(await hasFingerprint(P.standIn)).toBe(true);
  });

  it("a removal that rolls back leaves the fingerprint (the trigger is in the same transaction)", async () => {
    const P = await seedEverywhere(c, picture(++seq), "fp-remove-rollback");
    await addFingerprint(P.photoId);
    const r = await removePhoto(
      c,
      { publicId: P.publicId, by: P.person, ref: "SYC-527", apply: true, requireSwitch: false, recheckDelayMs: 5, timeoutMs: 50 },
      { slowScanMs: 200 },
    );
    expect(r.kind).toBe("timed_out");
    expect(await hasFingerprint(P.photoId)).toBe(true);
  });
});

describe("the removal search and this table (spec §6.1)", () => {
  it("skips photo_fingerprints.vector: a list of numbers can't hold a picture or an id", async () => {
    const scanned = await scannedColumns(c);
    expect(scanned).not.toContain("photo_fingerprints.vector");
    // The rest of the table is still read, and every other list column too.
    expect(scanned).toContain("photo_fingerprints.model");
  });

  it("doesn't flag it, as a hit or as an unscanned column", async () => {
    const P = await seedEverywhere(c, picture(++seq), "fp-scan", { hide: false, report: false });
    await addFingerprint(P.photoId);
    const data = (await c.query<{ data: string }>(`select data from photos where id = $1`, [P.photoId])).rows[0]!.data;
    const out = await scanBytes(c, P, fingerprint(data), { inTransaction: false });
    expect(out.line.detail).not.toMatch(/photo_fingerprints/);
  });
});
