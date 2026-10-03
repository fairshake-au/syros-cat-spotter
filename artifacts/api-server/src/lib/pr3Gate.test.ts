/**
 * The PR 4 code gate (plan `docs/superpowers/plans/data-spine.md`, PR 4):
 * "with PR 3's step not recorded, a claimed cat with no `homed` observation
 * still has `hasHome: true`; once it's recorded, `hasHome` follows life
 * status." This file tests {@link pr3Recorded} itself in isolation; the
 * end-to-end behaviour it gates is tested in `catHelpers.test.ts` and
 * `sightings.resolve.test.ts`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  PR3_MIGRATION_TAG,
  pr3Recorded,
  resetPr3GateCacheForTests,
} from "./pr3Gate";

function makeScratchFolder(sqlBody: string, tag = PR3_MIGRATION_TAG): {
  folder: string;
  hash: string;
} {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "pr3gate-test-"));
  fs.writeFileSync(path.join(folder, `${tag}.sql`), sqlBody);
  fs.mkdirSync(path.join(folder, "meta"));
  fs.writeFileSync(
    path.join(folder, "meta/_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: [{ idx: 0, version: "7", when: 1, tag }],
    }),
  );
  const hash = crypto.createHash("sha256").update(sqlBody).digest("hex");
  return { folder, hash };
}

describe("pr3Recorded", () => {
  const scratchFolders: string[] = [];
  const insertedHashes: string[] = [];

  beforeEach(() => {
    resetPr3GateCacheForTests();
  });

  afterEach(async () => {
    for (const hash of insertedHashes) {
      await db.execute(
        sql`delete from "drizzle"."__drizzle_migrations" where hash = ${hash}`,
      );
    }
    insertedHashes.length = 0;
    for (const folder of scratchFolders) {
      fs.rmSync(folder, { recursive: true, force: true });
    }
    scratchFolders.length = 0;
    resetPr3GateCacheForTests();
  });

  it("is false when the tag isn't in the local migrations folder at all (PR 3 not in this tree yet)", async () => {
    const { folder } = makeScratchFolder("select 1;", "0006_something_else");
    scratchFolders.push(folder);
    await expect(pr3Recorded(folder)).resolves.toBe(false);
  });

  it("is false when the migration file exists but its hash isn't recorded as applied", async () => {
    const { folder } = makeScratchFolder("select 1;");
    scratchFolders.push(folder);
    await expect(pr3Recorded(folder)).resolves.toBe(false);
  });

  it("is true once the exact hash is recorded in drizzle.__drizzle_migrations, and stays true after the row is removed (cached)", async () => {
    const { folder, hash } = makeScratchFolder("select 2;");
    scratchFolders.push(folder);
    await db.execute(
      sql`insert into "drizzle"."__drizzle_migrations" (hash, created_at) values (${hash}, ${Date.now()})`,
    );
    insertedHashes.push(hash);

    await expect(pr3Recorded(folder)).resolves.toBe(true);

    // Remove the row (simulating nothing — the cache is what matters here):
    // once observed true in this process, it must never flip back to false,
    // because a migration that has run stays run.
    await db.execute(
      sql`delete from "drizzle"."__drizzle_migrations" where hash = ${hash}`,
    );
    insertedHashes.length = 0;
    await expect(pr3Recorded(folder)).resolves.toBe(true);
  });

  it("re-reads on every call while false — no caching of a negative result", async () => {
    const { folder, hash } = makeScratchFolder("select 3;");
    scratchFolders.push(folder);

    await expect(pr3Recorded(folder)).resolves.toBe(false);

    await db.execute(
      sql`insert into "drizzle"."__drizzle_migrations" (hash, created_at) values (${hash}, ${Date.now()})`,
    );
    insertedHashes.push(hash);

    // The same process, same call, now sees it — proving the earlier `false`
    // wasn't cached.
    await expect(pr3Recorded(folder)).resolves.toBe(true);
  });
});
