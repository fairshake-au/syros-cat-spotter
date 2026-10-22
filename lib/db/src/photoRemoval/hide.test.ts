import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createThrowawayDatabase, dropThrowawayDatabase } from "../migrate/testDatabase";
import { picture, seedEverywhere } from "./__fixtures__/seed";
import { hidePhotoForPrivacy, restorePhoto } from "./hide";
import { listCatPhotos } from "./list";
import { removePhoto } from "./remove";

// SYC-462 spec §5.1–§5.3; T4 (hide cases) and T6.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

let name: string;
let c: pg.Client;
let seq = 100;

beforeAll(async () => {
  const t = await createThrowawayDatabase(baseUrl, { prefix: "photo_hide" });
  name = t.name;
  c = new pg.Client({ connectionString: t.url });
  await c.connect();
});

afterAll(async () => {
  await c?.end();
  await dropThrowawayDatabase(baseUrl, name);
});

const events = async (photoId: number) =>
  (
    await c.query<{ action: string; reason: string | null; author: string; person_id: string | null }>(
      `select action, reason, author, person_id from photo_visibility_events where photo_id = $1 order by id`,
      [photoId],
    )
  ).rows;

const rowChecksum = async (photoId: number) =>
  (
    await c.query<{ s: string }>(
      `select md5((select t::text from photos t where id = $1) || coalesce((select string_agg(v::text, '|' order by v.size) from photo_variants v where photo_id = $1), '')) s`,
      [photoId],
    )
  ).rows[0]!.s;

describe("photo-hide", () => {
  it("hides a public photo with reason 'privacy', authored by the approver", async () => {
    const P = await seedEverywhere(c, picture(++seq), "h-public", { hide: false, report: false });
    const r = await hidePhotoForPrivacy(c, { publicId: P.publicId, by: P.person, apply: true });
    expect(r.kind).toBe("hidden");
    expect(await events(P.photoId)).toEqual([{ action: "hide", reason: "privacy", author: P.person, person_id: P.person }]);
  });

  it("adds a privacy hide to a dashboard-hidden photo, never showing it in between", async () => {
    const P = await seedEverywhere(c, picture(++seq), "h-dash", { hide: "plain", report: false });
    const r = await hidePhotoForPrivacy(c, { publicId: P.publicId, by: P.person, apply: true });
    expect(r.kind).toBe("privacy_added");
    expect((await events(P.photoId)).map((e) => [e.action, e.reason])).toEqual([
      ["hide", null],
      ["hide", "privacy"],
    ]);
  });

  it("writes nothing when it's already hidden for privacy", async () => {
    const P = await seedEverywhere(c, picture(++seq), "h-already");
    const before = await events(P.photoId);
    expect((await hidePhotoForPrivacy(c, { publicId: P.publicId, by: P.person, apply: true })).kind).toBe("already");
    expect(await events(P.photoId)).toEqual(before);
  });

  it("a dry run says what it would do and writes nothing", async () => {
    const P = await seedEverywhere(c, picture(++seq), "h-dry", { hide: false, report: false });
    const r = await hidePhotoForPrivacy(c, { publicId: P.publicId, by: P.person, apply: false });
    expect(r).toMatchObject({ kind: "plan", would: "hide" });
    expect(await events(P.photoId)).toEqual([]);
  });

  it("refuses a removed photo, an unknown photo and someone not on the team", async () => {
    const P = await seedEverywhere(c, picture(++seq), "h-refuse");
    expect(
      (
        await removePhoto(c, {
          publicId: P.publicId,
          by: P.person,
          ref: "SYC-462",
          apply: true,
          requireSwitch: false,
          recheckDelayMs: 5,
        })
      ).kind,
    ).toBe("removed");
    expect(await hidePhotoForPrivacy(c, { publicId: P.publicId, by: P.person, apply: true })).toEqual({
      kind: "refused",
      why: "removed",
    });
    expect(
      await hidePhotoForPrivacy(c, { publicId: "00000000-0000-4000-8000-000000000000", by: P.person, apply: true }),
    ).toEqual({ kind: "refused", why: "not_found" });
    const left = (
      await c.query(
        `insert into people (email, name, added_by, accepted_at, left_at) values ('h-left-${seq}@example.com', 'L', 'cli:test', now(), now()) returning id`,
      )
    ).rows[0].id;
    const Q = await seedEverywhere(c, picture(++seq), "h-left", { hide: false, report: false });
    expect(await hidePhotoForPrivacy(c, { publicId: Q.publicId, by: left, apply: true })).toEqual({
      kind: "refused",
      why: "not_team",
    });
  });
});

describe("photo-restore and T6", () => {
  it("T6: hide then restore leaves the photo exactly as it was", async () => {
    const P = await seedEverywhere(c, picture(++seq), "r-t6", { hide: false, report: false });
    const before = await rowChecksum(P.photoId);
    expect((await hidePhotoForPrivacy(c, { publicId: P.publicId, by: P.person, apply: true })).kind).toBe("hidden");
    expect((await restorePhoto(c, { publicId: P.publicId, by: P.person, apply: true })).kind).toBe("restored");
    expect((await events(P.photoId)).at(-1)!.action).toBe("restore");
    expect(await rowChecksum(P.photoId)).toBe(before);
  });

  it("says already public, and refuses a removed photo", async () => {
    const P = await seedEverywhere(c, picture(++seq), "r-states", { hide: false, report: false });
    expect((await restorePhoto(c, { publicId: P.publicId, by: P.person, apply: true })).kind).toBe("already_public");
    const Q = await seedEverywhere(c, picture(++seq), "r-removed");
    await removePhoto(c, { publicId: Q.publicId, by: Q.person, ref: "SYC-462", apply: true, requireSwitch: false, recheckDelayMs: 5 });
    expect(await restorePhoto(c, { publicId: Q.publicId, by: Q.person, apply: true })).toEqual({
      kind: "refused",
      why: "removed",
    });
  });

  it("a dry run writes nothing", async () => {
    const P = await seedEverywhere(c, picture(++seq), "r-dry");
    const before = await events(P.photoId);
    expect(await restorePhoto(c, { publicId: P.publicId, by: P.person, apply: false })).toMatchObject({
      kind: "plan",
      would: "restore",
    });
    expect(await events(P.photoId)).toEqual(before);
  });
});

describe("photo-list", () => {
  it("lists every photo of the cat, newest first, with where it's used and the flags — and no reason text", async () => {
    const P = await seedEverywhere(c, picture(++seq), "l-cat");
    const list = await listCatPhotos(c, P.catId);
    const main = list.find((p) => p.publicId === P.publicId)!;
    expect(main.uses).toEqual(["main photo", `sighting ${P.sightingId} (first)`]);
    expect(main).toMatchObject({ hidden: true, hiddenForPrivacy: true, removedAt: null });
    expect(list.length).toBe(2); // the photo and its stand-in
    expect(list[0]!.takenAt.getTime()).toBeGreaterThanOrEqual(list[1]!.takenAt.getTime());
    // Only these fields: no reason text, report text or device can be printed.
    for (const p of list) expect(Object.keys(p).sort()).toEqual(["hidden", "hiddenForPrivacy", "publicId", "removedAt", "takenAt", "uses"]);
    const text = JSON.stringify(list);
    for (const secret of ["photo_private", "seed-device"]) expect(text).not.toContain(secret);
  });
});
