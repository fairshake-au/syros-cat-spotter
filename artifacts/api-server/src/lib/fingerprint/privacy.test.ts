import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, photosTable } from "@workspace/db";
import { setPhotoVisibility } from "../photoVisibility";
import { _setBrakeForTests, applyHideRules, prepareHide } from "../issues/hide";
import { hideFromIssue } from "../issues/teamActions";
import { markRemoved } from "../../test/removalKit";
import { __fingerprintHooks, saveFingerprint } from "./index";

// SYC-527 piece 3, spec docs/specs/find-from-a-photo-whole-island.md §6.2:
// a hidden or removed photo has no fingerprint, ever. The two api-server
// paths that write a hide, run for real:
//   1. setPhotoVisibility (lib/photoVisibility.ts), the team's dashboard hide;
//   2. applyHideRules (lib/issues/hide.ts), a "Report an issue" report's hide;
//   and one the spec's list (§6.2) missed, found while building this:
//   2b. hideFromIssue (lib/issues/teamActions.ts), the team's "Hide this
//       photo" on an Issues row, a second writer of hide events by design.
//       The trigger covers it like the others; this proves it.
// The two lib/db paths (the written procedure's hide and removal), the table's
// own checks and the removal search are in lib/db/src/photoFingerprints.test.ts.
// The only writer of fingerprints is guarded by fingerprint.source.test.ts,
// and the race between it and a hide is run for real at the end of this
// file, both ways round, on two connections.
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

describe("path 2b: hideFromIssue (the team hides a reported photo from the Issues queue)", () => {
  it("deletes the photo's fingerprint, and leaves another photo's", async () => {
    const a = await seedPhoto();
    const b = await seedPhoto();
    await addFingerprint(a.id);
    await addFingerprint(b.id);
    await seedReport(a.id);
    expect(await hideFromIssue(staff, { publicId: `${PREFIX}report-${a.id}` })).toBe("hidden");
    expect(await hasFingerprint(a.id)).toBe(false);
    expect(await hasFingerprint(b.id)).toBe(true);
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

// Spec §6.2: "a hide racing a fingerprint save leaves none either way round".
// Two real connections. saveFingerprint holds the photo row FOR SHARE; every
// hide path takes it FOR UPDATE; so one waits for the other. The save's test
// hook sits after its lock and re-check, right before the write: the window
// a missing lock would leave open.
describe("the race: a hide and a fingerprint save at the same moment", () => {
  const LIMIT_MS = 5_000;

  function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
    return Promise.race([
      p,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out: ${what}`)), LIMIT_MS)),
    ]);
  }

  /** Waits until some backend is blocked by `pid`, or gives up after 2 s. */
  async function blockedBy(pid: number): Promise<boolean> {
    const until = Date.now() + 2_000;
    while (Date.now() < until) {
      const r = await db.execute(
        sql`select 1 from pg_stat_activity where ${pid}::int = any(pg_blocking_pids(pid))`,
      );
      if (r.rows.length > 0) return true;
      await new Promise((res) => setTimeout(res, 25));
    }
    return false;
  }

  const vector = () => new Float32Array(384).fill(1 / Math.sqrt(384));

  afterAll(() => {
    __fingerprintHooks.beforeWrite = undefined;
  });

  it(
    "save first: the hide waits for the save to commit, then its trigger deletes the new fingerprint",
    async () => {
      const a = await seedPhoto();
      let release!: () => void;
      const released = new Promise<void>((r) => (release = r));
      let atHook!: (pid: number) => void;
      const reachedHook = new Promise<number>((r) => (atHook = r));
      __fingerprintHooks.beforeWrite = async (photoId, tx) => {
        if (photoId !== a.id) return;
        const r = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        atHook(r.rows[0]!.pid);
        await released;
      };
      try {
        const save = saveFingerprint(a.id, vector());
        const savePid = await withTimeout(reachedHook, "the save reaching its hook");
        let hideDone = false;
        const hide = setPhotoVisibility(staff, { publicId: a.publicId, action: "hide" }).then((out) => {
          hideDone = true;
          return out;
        });
        // The hide must be stuck behind the save's lock, not finished.
        const waited = await blockedBy(savePid);
        expect({ waited, hideDone }).toEqual({ waited: true, hideDone: false });
        release();
        expect(await withTimeout(save, "the save")).toBe("saved");
        expect((await withTimeout(hide, "the hide")).kind).toBe("changed");
        expect(await hasFingerprint(a.id)).toBe(false);
      } finally {
        __fingerprintHooks.beforeWrite = undefined;
        release();
      }
    },
    15_000,
  );

  it("hide first, committed: the save sees it and writes nothing", async () => {
    const a = await seedPhoto();
    expect((await setPhotoVisibility(staff, { publicId: a.publicId, action: "hide" })).kind).toBe("changed");
    expect(await withTimeout(saveFingerprint(a.id, vector()), "the save")).toBe("hidden_or_removed");
    expect(await hasFingerprint(a.id)).toBe(false);
  });

  it(
    "hide first, still open: the save waits for it, then sees it and writes nothing",
    async () => {
      const a = await seedPhoto();
      // A hide held open mid-transaction, in the order every production hide
      // path uses (task 6 report, lock order): the photo row FOR UPDATE,
      // then the hide event (whose trigger deletes any fingerprint).
      let release!: () => void;
      const released = new Promise<void>((r) => (release = r));
      let locked!: (pid: number) => void;
      const holding = new Promise<number>((r) => (locked = r));
      const hide = db.transaction(async (tx) => {
        await tx.execute(sql`select id from photos where id = ${a.id} for update`);
        await tx.execute(
          sql`insert into photo_visibility_events (photo_id, action, author, person_id) values (${a.id}, 'hide', ${staff.id}, ${staff.id})`,
        );
        const r = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        locked(r.rows[0]!.pid);
        await released;
      });
      try {
        const hidePid = await withTimeout(holding, "the hide taking its lock");
        let saveDone = false;
        const save = saveFingerprint(a.id, vector()).then((out) => {
          saveDone = true;
          return out;
        });
        const waited = await blockedBy(hidePid);
        expect({ waited, saveDone }).toEqual({ waited: true, saveDone: false });
        release();
        await withTimeout(hide, "the hide");
        expect(await withTimeout(save, "the save")).toBe("hidden_or_removed");
        expect(await hasFingerprint(a.id)).toBe(false);
      } finally {
        release();
      }
    },
    15_000,
  );
});
