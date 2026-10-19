import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createThrowawayDatabase, dropThrowawayDatabase } from "../migrate/testDatabase";
import { picture, seedEverywhere, staffPerson } from "./__fixtures__/seed";
import { removePhoto, type RemoveStep } from "./remove";

// SYC-462 spec §4.4, §5.4, §5.5; tests T1, T2, T2b, T4, T5, T8.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

let dbName: string;
let dbUrl: string;
let c: pg.Client;
let seq = 0;
const nextPicture = () => picture(++seq);
const FAST = { recheckDelayMs: 5 };

beforeAll(async () => {
  const t = await createThrowawayDatabase(baseUrl, { prefix: "photo_removal" });
  dbName = t.name;
  dbUrl = t.url;
  c = new pg.Client({ connectionString: dbUrl });
  await c.connect();
});

afterAll(async () => {
  await c?.end();
  await dropThrowawayDatabase(baseUrl, dbName);
});

const run = (publicId: string, by: string, extra: Partial<Parameters<typeof removePhoto>[1]> = {}, testOnly = {}) =>
  removePhoto(c, { publicId, by, ref: "SYC-462", apply: true, requireSwitch: false, ...FAST, ...extra }, testOnly);

const count = async (sql: string, params: unknown[]) =>
  (await c.query<{ n: number }>(sql, params)).rows[0]!.n;

/**
 * The independent scan (T1): written here, not with search.ts, so a bug both
 * share can't hide. A 40-character slice from a different offset than the
 * command's fingerprint, and the public id, in every text-like column.
 */
async function independentScan(base64: string, publicId: string, photoId: number): Promise<string[]> {
  const slice = base64.slice(1200, 1240); // 4-aligned: decodes to the same 30 bytes wherever they're stored
  const cols = await c.query<{ table_name: string; column_name: string; data_type: string }>(
    `select c.table_name, c.column_name, c.data_type from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and c.data_type in ('text', 'character varying', 'json', 'jsonb', 'ARRAY', 'bytea')`,
  );
  const hits: string[] = [];
  for (const { table_name: t, column_name: col, data_type: type } of cols.rows) {
    const where =
      type === "bytea"
        ? `position(decode($1, 'base64') in x."${col}") > 0`
        : t === "photos" && col === "public_id"
          ? `x."${col}"::text like '%' || $1 || '%'`
          : `x."${col}"::text like '%' || $1 || '%' or x."${col}"::text like '%' || $2 || '%'`;
    const params = type === "bytea" || (t === "photos" && col === "public_id") ? [slice] : [slice, publicId];
    const r = await c.query<{ n: number }>(`select count(*)::int n from "${t}" x where ${where}`, params);
    if (r.rows[0]!.n > 0) hits.push(`${t}.${col}`);
  }
  const self = await c.query(`select data from photos where id = $1`, [photoId]);
  if (self.rows[0]?.data !== null) hits.push("photos.data (the row itself)");
  return hits;
}

const checksum = async () =>
  (
    await c.query<{ s: string }>(
      `select md5(string_agg(x, '|' order by x)) s from (
         select 'p' || t::text x from photos t union all
         select 'c' || t::text from cats t union all
         select 'v' || t::text from photo_variants t union all
         select 'e' || t::text from photo_visibility_events t) all_rows`,
    )
  ).rows[0]!.s;

describe("T1: removes the photo from every place, and leaves another untouched", () => {
  it("removes P everywhere; Q (same places, another cat) is unchanged", async () => {
    const pPic = nextPicture();
    const qPic = nextPicture();
    const P = await seedEverywhere(c, pPic, "t1p");
    const Q = await seedEverywhere(c, qPic, "t1q");
    const r = await run(P.publicId, P.person);
    expect(r.kind).toBe("removed");
    if (r.kind !== "removed") return;
    expect(r.search.lines.filter((l) => l.ok !== true)).toEqual([]);
    expect(r.search.verdict).toBe("GONE");
    expect(await independentScan(pPic, P.publicId, P.photoId)).toEqual([]);
    expect(await count(`select count(*)::int n from photo_variants where photo_id = $1`, [P.photoId])).toBe(0);
    expect((await c.query(`select primary_photo_id from cats where id = $1`, [P.catId])).rows[0].primary_photo_id).toBe(
      P.standIn,
    );
    const rec = (await c.query(`select removed_by, removed_reason, removed_at from photos where id = $1`, [P.photoId])).rows[0];
    expect(rec.removed_by).toBe(P.person);
    expect(rec.removed_reason).toBe("SYC-462");
    expect(rec.removed_at).toBeInstanceOf(Date);

    expect((await c.query(`select data from photos where id = $1`, [Q.photoId])).rows[0].data).toBe(qPic);
    expect(await count(`select count(*)::int n from photo_variants where photo_id = $1`, [Q.photoId])).toBe(2);
    expect((await c.query(`select primary_photo_id from cats where id = $1`, [Q.catId])).rows[0].primary_photo_id).toBe(
      Q.photoId,
    );
  });

  it("removes a spot's face photo (a photo belongs to one spot only: sighting_photos_photo_uq)", async () => {
    const P = await seedEverywhere(c, nextPicture(), "t1face");
    const facePic = nextPicture();
    const face = (await c.query(`insert into photos (data) values ($1) returning id, public_id`, [facePic])).rows[0];
    await c.query(`insert into sighting_photos (sighting_id, photo_id, role, position) values ($1, $2, 'face', 2)`, [
      P.sightingId,
      face.id,
    ]);
    await c.query(
      `insert into photo_visibility_events (photo_id, action, author, person_id, reason) values ($1, 'hide', $2::text, $2::uuid, 'privacy')`,
      [face.id, P.person],
    );
    const r = await run(face.public_id, P.person);
    expect(r.kind).toBe("removed");
    if (r.kind !== "removed") return;
    expect(r.search.verdict).toBe("GONE");
    expect(await independentScan(facePic, face.public_id, face.id)).toEqual([]);
    expect(await count(`select count(*)::int n from sighting_photos where photo_id = $1`, [face.id])).toBe(1);
  });

  it("probe 3 (permanent): photos sharing a long common start don't make a false match", async () => {
    const shared = picture(777, 600);
    const pPic = shared + picture(++seq, 2400);
    const qPic = shared + picture(++seq, 2400);
    const P = await seedEverywhere(c, pPic, "prefixp");
    await seedEverywhere(c, qPic, "prefixq");
    const r = await run(P.publicId, P.person);
    if (r.kind !== "removed") throw new Error(r.kind);
    expect(r.search.verdict).toBe("GONE");
    expect(r.search.otherPhotoIds).toEqual([]);
  });
});

describe("T2: skip one step and the search says NOT GONE, naming the place", () => {
  it.each([
    // The row's own picture is check 1's (the byte scan looks everywhere else).
    ["delete_and_record", ["picture", "record"]],
    ["versions", ["versions"]],
    ["main_photo", ["main_photo"]],
  ] as [RemoveStep, string[]][])("skipping %s → NOT GONE naming %j", async (skip, failing) => {
    const P = await seedEverywhere(c, nextPicture(), `skip-${skip}`);
    const r = await run(P.publicId, P.person, {}, { skip });
    if (r.kind !== "removed") throw new Error(r.kind);
    expect(r.search.verdict).toBe("NOT GONE");
    const bad = r.search.lines.filter((l) => l.ok !== true).map((l) => l.check);
    for (const f of failing) expect(bad).toContain(f);
  });

  it("T2b: a version saved after the commit is found and deleted", async () => {
    const P = await seedEverywhere(c, nextPicture(), "t2b");
    const r = await run(P.publicId, P.person, {}, {
      afterCommit: async () => {
        await c.query(`insert into photo_variants (photo_id, size, bytes) values ($1, 'small', '\\x00')`, [P.photoId]);
      },
    });
    if (r.kind !== "removed") throw new Error(r.kind);
    const line = r.search.lines.find((l) => l.check === "versions")!;
    expect(line.ok).toBe(false);
    expect(line.detail).toMatch(/found and deleted 1/);
    expect(r.search.verdict).toBe("NOT GONE");
    expect(await count(`select count(*)::int n from photo_variants where photo_id = $1`, [P.photoId])).toBe(0);
  });
});

describe("T4: refusals change nothing", () => {
  const refused = async (publicId: string, by: string, why: string, extra = {}) => {
    const before = await checksum();
    const r = await run(publicId, by, extra);
    expect(r).toEqual({ kind: "refused", why });
    expect(await checksum()).toBe(before);
  };

  it("not hidden", async () => {
    const P = await seedEverywhere(c, nextPicture(), "t4-public", { hide: false });
    await refused(P.publicId, P.person, "not_hidden");
  });

  it("hidden only after an offensive report (photo_inappropriate)", async () => {
    const P = await seedEverywhere(c, nextPicture(), "t4-offensive", { hide: false, report: "photo_inappropriate" });
    await c.query(
      `insert into photo_visibility_events (photo_id, action, author, reason) values ($1, 'hide', 'report:seed', 'photo_inappropriate')`,
      [P.photoId],
    );
    await refused(P.publicId, P.person, "not_for_privacy");
  });

  it("hidden by the team with no reason (the dashboard's Hide)", async () => {
    const P = await seedEverywhere(c, nextPicture(), "t4-plain", { hide: "plain", report: false });
    await refused(P.publicId, P.person, "not_for_privacy");
  });

  it("a privacy hide, then a restore, then a plain hide", async () => {
    const P = await seedEverywhere(c, nextPicture(), "t4-restored", { report: false });
    for (const [action, reason] of [["restore", null], ["hide", null]] as const) {
      await c.query(
        `insert into photo_visibility_events (photo_id, action, author, person_id, reason) values ($1, $2, $3::text, $3::uuid, $4)`,
        [P.photoId, action, P.person, reason],
      );
    }
    await refused(P.publicId, P.person, "not_for_privacy");
  });

  it("an unknown id", async () => {
    const person = await staffPerson(c, "t4-unknown");
    await refused("00000000-0000-4000-8000-000000000000", person, "not_found");
  });

  it.each(["Maria door", "SYC-462 x", "a@b", "0123456789", "hello 2026-10-21", ""])("photo_ref %j", async (ref) => {
    const P = await seedEverywhere(c, nextPicture(), "t4-ref");
    await refused(P.publicId, P.person, "bad_ref", { ref });
  });

  it("photo_by who never joined, has left, has only an expired role, or is only a cat guardian", async () => {
    const P = await seedEverywhere(c, nextPicture(), "t4-person");
    const mk = async (sql: string) => (await c.query(sql)).rows[0].id as string;
    const invited = await mk(`insert into people (email, name, added_by) values ('inv-${seq}@example.com', 'I', 'cli:test') returning id`);
    await c.query(`insert into person_scopes (person_id, role, reach) values ($1, 'staff', 'island')`, [invited]);
    const left = await mk(
      `insert into people (email, name, added_by, accepted_at, left_at) values ('left-${seq}@example.com', 'L', 'cli:test', now(), now()) returning id`,
    );
    await c.query(`insert into person_scopes (person_id, role, reach) values ($1, 'staff', 'island')`, [left]);
    const expired = await mk(
      `insert into people (email, name, added_by, accepted_at) values ('exp-${seq}@example.com', 'E', 'cli:test', now()) returning id`,
    );
    await c.query(
      `insert into person_scopes (person_id, role, reach, expires_at) values ($1, 'staff', 'island', now() - interval '1 day')`,
      [expired],
    );
    const guardian = await mk(
      `insert into people (email, name, added_by, accepted_at) values ('g-${seq}@example.com', 'G', 'cli:test', now()) returning id`,
    );
    await c.query(`insert into person_scopes (person_id, role, reach) values ($1, 'guardian', 'start')`, [guardian]);
    for (const by of [invited, left, expired, guardian, "not-a-uuid"]) await refused(P.publicId, by, "not_team");
  });

  it("switched off: requireSwitch with photo_removal_on absent, then false", async () => {
    const P = await seedEverywhere(c, nextPicture(), "t4-switch");
    await refused(P.publicId, P.person, "switched_off", { requireSwitch: true });
    await c.query(`insert into app_settings (key, value) values ('photo_removal_on', 'false'::jsonb)`);
    await refused(P.publicId, P.person, "switched_off", { requireSwitch: true });
    await c.query(`update app_settings set value = 'true'::jsonb where key = 'photo_removal_on'`);
    expect((await run(P.publicId, P.person, { requireSwitch: true })).kind).toBe("removed");
    await c.query(`delete from app_settings where key = 'photo_removal_on'`);
  });

  it("succeeds: hidden from the dashboard (no reason), then a second hide for privacy", async () => {
    const P = await seedEverywhere(c, nextPicture(), "t4-ok-dash", { hide: "plain", report: false });
    await c.query(
      `insert into photo_visibility_events (photo_id, action, author, person_id, reason) values ($1, 'hide', $2::text, $2::uuid, 'privacy')`,
      [P.photoId, P.person],
    );
    expect((await run(P.publicId, P.person)).kind).toBe("removed");
  });

  it("succeeds: hidden by a photo_private report only", async () => {
    const P = await seedEverywhere(c, nextPicture(), "t4-ok-report", { hide: false });
    await c.query(
      `insert into photo_visibility_events (photo_id, action, author, reason) values ($1, 'hide', 'report:seed', 'photo_private')`,
      [P.photoId],
    );
    expect((await run(P.publicId, P.person)).kind).toBe("removed");
  });
});

describe("dry run, T5 and T8", () => {
  it("a dry run plans and changes nothing", async () => {
    const P = await seedEverywhere(c, nextPicture(), "dry");
    const before = await checksum();
    const r = await run(P.publicId, P.person, { apply: false });
    expect(r.kind).toBe("plan");
    if (r.kind !== "plan") return;
    expect(r.plan.repoints).toEqual([{ catId: P.catId, to: P.standIn }]);
    expect(r.plan.versions.sort()).toEqual(["medium", "small"]);
    expect(r.plan.spotPhotos).toEqual([{ sightingId: P.sightingId, role: "first" }]);
    expect(r.plan.observations).toBe(1);
    expect(r.plan.reports).toBe(1);
    expect(r.plan.bytes).toBeGreaterThan(2000);
    expect(await checksum()).toBe(before);
  });

  it("T5: a second removal says already, and writes nothing", async () => {
    const P = await seedEverywhere(c, nextPicture(), "t5");
    expect((await run(P.publicId, P.person)).kind).toBe("removed");
    const before = await checksum();
    const again = await run(P.publicId, P.person);
    expect(again.kind).toBe("already");
    expect(await checksum()).toBe(before);
  });

  it("T8: two at once — one removes, the other says already", async () => {
    const P = await seedEverywhere(c, nextPicture(), "t8");
    const c2 = new pg.Client({ connectionString: dbUrl });
    await c2.connect();
    try {
      const input = { publicId: P.publicId, by: P.person, ref: "SYC-462", apply: true, requireSwitch: false, ...FAST };
      const kinds = (await Promise.all([removePhoto(c, input), removePhoto(c2, input)])).map((r) => r.kind).sort();
      expect(kinds).toEqual(["already", "removed"]);
    } finally {
      await c2.end();
    }
  });
});
