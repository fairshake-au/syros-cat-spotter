import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db, photosTable } from "@workspace/db";

// Final review (SYC-527 piece 3), from the critic's proving test: attacks the hide-vs-save race on paths the
// build's privacy.test.ts runs only one way round, plus the fill's wait.
// Two real connections each time. The model is stubbed (fingerprintOf), with
// a hook so a hide can land between the fill's read and its save.

const model = vi.hoisted(() => ({
  onCall: undefined as undefined | ((jpeg: Buffer) => Promise<void> | void),
  delayMs: 0,
}));
vi.mock("./model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./model")>();
  return {
    ...actual,
    fingerprintOf: vi.fn(async (jpeg: Buffer) => {
      await model.onCall?.(jpeg);
      if (model.delayMs) await new Promise((r) => setTimeout(r, model.delayMs));
      const v = new Float32Array(actual.DIMENSIONS);
      v[0] = 1;
      return v;
    }),
  };
});

import { setPhotoVisibility } from "../photoVisibility";
import { _setBrakeForTests, applyHideRules, prepareHide } from "../issues/hide";
import { hideFromIssue } from "../issues/teamActions";
import { markRemoved } from "../../test/removalKit";
import { __fingerprintHooks, fillMissing, saveFingerprint } from "./index";

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-fp-critic-${RUN}-`;
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
async function hasFingerprint(photoId: number): Promise<boolean> {
  return (await db.execute(sql`select 1 from photo_fingerprints where photo_id = ${photoId}`)).rows.length === 1;
}
async function seedReport(photoId: number): Promise<number> {
  const r = await db.execute<{ id: number }>(sql`
    insert into welfare_reports (public_id, severity, client_ref, kind, reason, photo_id, photo_state)
    values (${`${PREFIX}report-${photoId}`}, 'attention', ${`${PREFIX}report-${photoId}`}, 'content', 'photo_private', ${photoId}, 'none')
    returning id`);
  return r.rows[0]!.id;
}
const vector = () => new Float32Array(384).fill(1 / Math.sqrt(384));

function withTimeout<T>(p: Promise<T>, what: string, ms = 5_000): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out: ${what}`)), ms))]);
}
async function blockedBy(pid: number): Promise<boolean> {
  const until = Date.now() + 2_000;
  while (Date.now() < until) {
    const r = await db.execute(sql`select 1 from pg_stat_activity where ${pid}::int = any(pg_blocking_pids(pid))`);
    if (r.rows.length > 0) return true;
    await new Promise((res) => setTimeout(res, 25));
  }
  return false;
}

/** Runs `hide` while a save of `photoId` is paused after its lock and re-check; returns the save's answer. */
async function saveFirstThen(photoId: number, hide: () => Promise<unknown>): Promise<string> {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  let atHook!: (pid: number) => void;
  const reached = new Promise<number>((r) => (atHook = r));
  __fingerprintHooks.beforeWrite = async (id, tx) => {
    if (id !== photoId) return;
    atHook((await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0]!.pid);
    await released;
  };
  try {
    const save = saveFingerprint(photoId, vector());
    const pid = await withTimeout(reached, "save reaching hook");
    let hideErr: unknown = null;
    const h = hide().catch((e) => { hideErr = e; });
    const blocked = await blockedBy(pid);
    if (!blocked) console.log("CRITIC hide not blocked; error:", hideErr && String((hideErr as Error).message ?? hideErr), (hideErr as { cause?: { message?: string } } | null)?.cause?.message);
    expect(blocked).toBe(true);
    release();
    const out = await withTimeout(save, "save");
    await withTimeout(h, "hide");
    return out;
  } finally {
    __fingerprintHooks.beforeWrite = undefined;
    release();
  }
}

beforeAll(async () => {
  const p = await db.execute<{ id: string }>(sql`
    insert into people (email, name, added_by, accepted_at)
    values (${`${PREFIX}staff@example.com`}, 'Staff', 'cli:test', now()) returning id`);
  const id = p.rows[0]!.id;
  await db.execute(sql`insert into person_scopes (person_id, role, reach) values (${id}, 'staff', 'island')`);
  staff = { id, scopes: [{ role: "staff", colonyId: null }] };
  _setBrakeForTests(1_000_000);
});
afterAll(() => _setBrakeForTests());
afterEach(() => {
  model.onCall = undefined;
  model.delayMs = 0;
});

describe("critic: save first, then each other hide path (two connections)", () => {
  it("a hide written with no row lock of its own (the trigger's lock alone) still deletes the new row", async () => {
    const a = await seedPhoto();
    const out = await saveFirstThen(a.id, () =>
      db.execute(
        sql`insert into photo_visibility_events (photo_id, action, author, person_id) values (${a.id}, 'hide', ${staff.id}, ${staff.id})`,
      ),
    );
    expect(out).toBe("saved");
    expect(await hasFingerprint(a.id)).toBe(false);
  }, 15_000);

  it("applyHideRules (a report) waits, then deletes the new row", async () => {
    const a = await seedPhoto();
    const reportId = await seedReport(a.id);
    const limitsAt = await prepareHide();
    await saveFirstThen(a.id, () =>
      db.transaction((tx) =>
        applyHideRules(tx, { reportId, reason: "photo_private", photoId: a.id, tokenOk: true, address: `2001:db8:5270:${n.toString(16)}::1`, limitsAt }),
      ),
    );
    expect(await hasFingerprint(a.id)).toBe(false);
  }, 15_000);

  it("hideFromIssue waits, then deletes the new row", async () => {
    const a = await seedPhoto();
    await seedReport(a.id);
    await saveFirstThen(a.id, () => hideFromIssue(staff, { publicId: `${PREFIX}report-${a.id}` }));
    expect(await hasFingerprint(a.id)).toBe(false);
  }, 15_000);

  it("a removal (removed_at set) waits, then deletes the new row", async () => {
    const a = await seedPhoto();
    await saveFirstThen(a.id, () => markRemoved(a.id, staff.id));
    expect(await hasFingerprint(a.id)).toBe(false);
  }, 15_000);
});

describe("critic: restore, re-hide, and a fill that read before the hide", () => {
  it("restore → save → re-hide leaves no row; a save after the re-hide writes nothing", async () => {
    const a = await seedPhoto();
    expect((await setPhotoVisibility(staff, { publicId: a.publicId, action: "hide" })).kind).toBe("changed");
    expect((await setPhotoVisibility(staff, { publicId: a.publicId, action: "restore" })).kind).toBe("changed");
    expect(await saveFingerprint(a.id, vector())).toBe("saved");
    expect(await hasFingerprint(a.id)).toBe(true);
    expect((await setPhotoVisibility(staff, { publicId: a.publicId, action: "hide" })).kind).toBe("changed");
    expect(await hasFingerprint(a.id)).toBe(false);
    expect(await saveFingerprint(a.id, vector())).toBe("hidden_or_removed");
    expect(await hasFingerprint(a.id)).toBe(false);
  });

  it("a fill that read the photo before a hide, and saves after it, writes nothing and counts it failed", async () => {
    const a = await seedPhoto();
    model.onCall = async () => {
      // The fill has already read the photo's bytes; the hide lands now.
      await setPhotoVisibility(staff, { publicId: a.publicId, action: "hide" });
    };
    const out = await fillMissing([a.id], 10_000);
    expect(out).toEqual({ made: 0, failed: 1, left: [] });
    expect(await hasFingerprint(a.id)).toBe(false);
  });
});

describe("critic: a search's fill waits behind a long fill (the nightly batch)", () => {
  it("a search's 300 ms fill budget is not kept while the nightly 2 s fill runs", async () => {
    const nightly: number[] = [];
    for (let i = 0; i < 8; i++) nightly.push((await seedPhoto()).id);
    const search = [(await seedPhoto()).id];
    model.delayMs = 250;
    const batch = fillMissing(nightly, 2_000); // the nightly route's call, scaled down from 90 s
    await new Promise((r) => setTimeout(r, 50));
    const t0 = Date.now();
    const out = await fillMissing(search, 300); // a search's call, scaled down from 15 s
    const waited = Date.now() - t0;
    await batch;
    // The budget ran out waiting: nothing filled, the photo is counted as left out.
    expect(out).toEqual({ made: 0, failed: 0, left: search });
    // Spec §7: a search spends at most its budget on fingerprints. Allow 700 ms slack.
    expect(waited, `the search's fill took ${waited} ms against a 300 ms budget`).toBeLessThan(1_000);
  }, 20_000);
});
