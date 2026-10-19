import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createThrowawayDatabase, dropThrowawayDatabase } from "../migrate/testDatabase";
import { picture, seedEverywhere } from "./__fixtures__/seed";

// SYC-462: scripts/db-ops.sh's photo-list / photo-hide / photo-restore /
// photo-remove, run for real against a throwaway local database standing in
// for a Neon branch, as dbOps.settings.test.ts does for the settings commands.
vi.setConfig({ testTimeout: 120_000 });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCRIPT = path.join(ROOT, "scripts/db-ops.sh");

let name: string;
let url: string;
let c: pg.Client;

beforeAll(async () => {
  const t = await createThrowawayDatabase(baseUrl, { prefix: "dbops_photos" });
  name = t.name;
  url = t.url;
  c = new pg.Client({ connectionString: url });
  await c.connect();
});

afterAll(async () => {
  await c?.end();
  await dropThrowawayDatabase(baseUrl, name);
});

function run(env: Record<string, string | undefined>) {
  const clean: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  const r = spawnSync("bash", [SCRIPT], { cwd: ROOT, env: clean, encoding: "utf8", timeout: 120_000 });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const dev = (extra: Record<string, string | undefined>) =>
  run({ TARGET: "development", DATABASE_TARGET: "development", NEON_DEV_URL: url, ...extra });

describe("db-ops photo-*", () => {
  it("refuses rehearsal", () => {
    const r = run({ TARGET: "rehearsal", DATABASE_TARGET: "rehearsal", NEON_REHEARSAL_URL: url, COMMAND: "photo-list", PHOTO_CAT: "1" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("only runs against target=development or target=production");
  });

  it("F4: photo-remove with CONFIRM=REMOVE but a missing or different PHOTO_ID_CONFIRM is refused, and changes nothing", async () => {
    const P = await seedEverywhere(c, picture(902), "dbops-f4");
    const base = { COMMAND: "photo-remove", PHOTO_ID: P.publicId, PHOTO_BY: P.person, PHOTO_REF: "SYC-462", CONFIRM: "REMOVE" };
    const missing = dev(base);
    expect(missing.code).not.toBe(0);
    expect(missing.out).toContain("doesn't match");
    const other = dev({ ...base, PHOTO_ID_CONFIRM: "11111111-1111-4111-8111-111111111111" });
    expect(other.code).not.toBe(0);
    expect(other.out).toContain("doesn't match");
    expect((await c.query(`select data is not null as has from photos where id = $1`, [P.photoId])).rows[0].has).toBe(true);
  });

  it("refuses a missing PHOTO_ID before running anything", () => {
    const r = dev({ COMMAND: "photo-hide", PHOTO_BY: "00000000-0000-4000-8000-000000000000" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("PHOTO_ID must be set");
  });

  it("list, hide (dry, then real), remove (dry, then real), and the output never shows the address", async () => {
    const P = await seedEverywhere(c, picture(901), "dbops", { hide: false });
    const steps = [
      dev({ COMMAND: "photo-list", PHOTO_CAT: String(P.catId) }),
      dev({ COMMAND: "photo-hide", PHOTO_ID: P.publicId, PHOTO_BY: P.person }),
      dev({ COMMAND: "photo-hide", PHOTO_ID: P.publicId, PHOTO_BY: P.person, CONFIRM: "HIDE" }),
      dev({ COMMAND: "photo-remove", PHOTO_ID: P.publicId, PHOTO_BY: P.person, PHOTO_REF: "SYC-462" }),
      dev({
        COMMAND: "photo-remove",
        PHOTO_ID: P.publicId,
        PHOTO_ID_CONFIRM: P.publicId,
        PHOTO_BY: P.person,
        PHOTO_REF: "SYC-462",
        CONFIRM: "REMOVE",
      }),
    ];
    expect(steps.map((s) => s.code)).toEqual([0, 0, 0, 0, 0]);
    expect(steps[1]!.out).toContain("DRY RUN");
    expect(steps[3]!.out).toContain("DRY RUN");
    expect(steps[4]!.out).toMatch(/^GONE \(\d+ ms\)$/m);
    const all = steps.map((s) => s.out).join("\n");
    expect(all).not.toMatch(/postgres(ql)?:\/\//);
    expect(all).not.toContain(new URL(url).host);
    expect((await c.query(`select data is null as gone from photos where id = $1`, [P.photoId])).rows[0].gone).toBe(true);
  });
});
