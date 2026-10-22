import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, photosTable } from "@workspace/db";
import { setPhotoVisibility } from "../photoVisibility";
import { _setBrakeForTests, applyHideRules, prepareHide } from "../issues/hide";
import { markRemoved } from "../../test/removalKit";

// SYC-527 piece 3, spec docs/specs/find-from-a-photo-whole-island.md §6.2:
// a hidden or removed photo has no fingerprint, ever. The two api-server
// paths that write a hide, run for real:
//   1. setPhotoVisibility (lib/photoVisibility.ts), the team's dashboard hide;
//   2. applyHideRules (lib/issues/hide.ts), a "Report an issue" report's hide.
// The two lib/db paths (the written procedure's hide and removal), the table's
// own checks and the removal search are in lib/db/src/photoFingerprints.test.ts.
// The only writer of fingerprints is guarded by fingerprint.source.test.ts.
//
// Fingerprint rows are written straight into the table, to set up the state
// a real writer would leave. Everything is seeded under this run's prefix,
// and only this run's ids are asserted on.

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-fp-privacy-${RUN}-`;
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let n = 0;
let staff: { id: string; scopes: { role: string; colonyId: number | null }[] };

async function seedPhoto(): Promise<{ id: number; publicId: string }> {
  n += 1;
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}photo-${n}`, data: TINY_JPEG_B64, mime: "image/jpeg" })
    .returning({ id: photosTable.id, publicId: photosTable.publicId });
  return p!;
}

async function addFingerprint(photoId: number): Promise<void> {
  await db.execute(
    sql`insert into photo_fingerprints (photo_id, model, vector) values (${photoId}, 'test-model', array_fill(0.05::real, array[384]))`,
  );
}

async function hasFingerprint(photoId: number): Promise<boolean> {
  const r = await db.execute(sql`select 1 from photo_fingerprints where photo_id = ${photoId}`);
  return r.rows.length === 1;
}

async function seedReport(photoId: number): Promise<number> {
  const r = await db.execute<{ id: number }>(sql`
    insert into welfare_reports (public_id, severity, client_ref, kind, reason, photo_id, photo_state)
    values (${`${PREFIX}report-${photoId}`}, 'attention', ${`${PREFIX}report-${photoId}`}, 'content', 'photo_private', ${photoId}, 'none')
    returning id`);
  return r.rows[0]!.id;
}

beforeAll(async () => {
  const p = await db.execute<{ id: string }>(sql`
    insert into people (email, name, added_by, accepted_at)
    values (${`${PREFIX}staff@example.com`}, 'Staff', 'cli:test', now()) returning id`);
  const id = p.rows[0]!.id;
  await db.execute(sql`insert into person_scopes (person_id, role, reach) values (${id}, 'staff', 'island')`);
  staff = { id, scopes: [{ role: "staff", colonyId: null }] };
  // Other files' report-hides count towards today's brake; lift it so the
  // hide here isn't stopped by it.
  _setBrakeForTests(1_000_000);
});

afterAll(() => {
  _setBrakeForTests();
});

describe("path 1: setPhotoVisibility (the team hides a photo)", () => {
  it("deletes the photo's fingerprint, and leaves another photo's", async () => {
    const a = await seedPhoto();
    const b = await seedPhoto();
    await addFingerprint(a.id);
    await addFingerprint(b.id);
    const out = await setPhotoVisibility(staff, { publicId: a.publicId, action: "hide" });
    expect(out.kind).toBe("changed");
    expect(await hasFingerprint(a.id)).toBe(false);
    expect(await hasFingerprint(b.id)).toBe(true);
  });

  it("restoring the photo doesn't bring its fingerprint back", async () => {
    const a = await seedPhoto();
    await addFingerprint(a.id);
    expect((await setPhotoVisibility(staff, { publicId: a.publicId, action: "hide" })).kind).toBe("changed");
    expect((await setPhotoVisibility(staff, { publicId: a.publicId, action: "restore" })).kind).toBe("changed");
    expect(await hasFingerprint(a.id)).toBe(false);
  });
  // That a restore event never deletes one (the trigger's WHEN) is tested in
  // lib/db/src/photoFingerprints.test.ts: here a restore of a public photo
  // writes no event at all.
});

describe("path 2: applyHideRules (a report hides a photo)", () => {
  it("deletes the photo's fingerprint, and leaves another photo's", async () => {
    const a = await seedPhoto();
    const b = await seedPhoto();
    await addFingerprint(a.id);
    await addFingerprint(b.id);
    const reportId = await seedReport(a.id);
    const limitsAt = await prepareHide();
    const out = await db.transaction((tx) =>
      applyHideRules(tx, {
        reportId,
        reason: "photo_private",
        photoId: a.id,
        tokenOk: true,
        address: `2001:db8:527:${n.toString(16)}::1`,
        limitsAt,
      }),
    );
    expect(out).toEqual({ hiddenByReport: true, skipped: null });
    expect(await hasFingerprint(a.id)).toBe(false);
    expect(await hasFingerprint(b.id)).toBe(true);
  });

  it("a report that doesn't hide (no verified token) leaves the fingerprint", async () => {
    const a = await seedPhoto();
    await addFingerprint(a.id);
    const reportId = await seedReport(a.id);
    const out = await db.transaction((tx) =>
      applyHideRules(tx, {
        reportId,
        reason: "photo_private",
        photoId: a.id,
        tokenOk: false,
        address: "2001:db8:527:ffff::1",
        limitsAt: Date.now(),
      }),
    );
    expect(out).toEqual({ hiddenByReport: false, skipped: "unchecked" });
    expect(await hasFingerprint(a.id)).toBe(true);
  });
});

describe("the app's removal reader (test kit), for completeness", () => {
  it("a photo marked removed has no fingerprint", async () => {
    const a = await seedPhoto();
    await addFingerprint(a.id);
    await markRemoved(a.id, staff.id);
    expect(await hasFingerprint(a.id)).toBe(false);
  });
});
