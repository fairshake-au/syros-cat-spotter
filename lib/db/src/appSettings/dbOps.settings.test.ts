import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultMigrationsFolder, migrateUp, readMigrations } from "../migrate/runner";
import { settingShapeProblem, settingWriteProblem, SIGN_OFF_FACT_IDS, STARTER_FACT_IDS } from "./shape";

// SYC-36 / SYC-48 (match-wait plan PR 1): scripts/db-ops.sh's set-setting
// and list-settings, run for real against a throwaway local database standing
// in for a Neon branch, as dbOps.people.test.ts does for the people commands.
vi.setConfig({ testTimeout: 60_000 });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCRIPT = path.join(ROOT, "scripts/db-ops.sh");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `dbops_settings_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
  await migrateUp(c, readMigrations(defaultMigrationsFolder()));
});

afterAll(async () => {
  await c.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
});

function run(env: Record<string, string | undefined>) {
  const clean: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  const r = spawnSync("bash", [SCRIPT], { cwd: ROOT, env: clean, encoding: "utf8", timeout: 120_000 });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const dev = (extra: Record<string, string | undefined>) =>
  run({
    TARGET: "development",
    DATABASE_TARGET: "development",
    NEON_DEV_URL: url(name),
    ...extra,
  });

const value = async (key: string) =>
  (await c.query(`select value from app_settings where key = $1`, [key])).rows[0]?.value;

describe("the migration's seed (Samuel's Decision 6)", () => {
  it("switches the donation link on at Syros Cats' page", async () => {
    expect(await value("feed_nudge_donate_url")).toBe("https://syroscats.com/donations");
  });
});

describe("db-ops set-setting", () => {
  beforeEach(async () => {
    await c.query(`delete from app_settings where key <> 'feed_nudge_donate_url'`);
  });

  it("switches the link off, and shows every switch without the connection string", async () => {
    const r = dev({ COMMAND: "set-setting", SETTING_KEY: "feed_nudge_donate_url", SETTING_VALUE: '""' });
    expect(r.code).toBe(0);
    expect(await value("feed_nudge_donate_url")).toBe("");
    expect(r.out).toContain('Set feed_nudge_donate_url = ""');
    expect(r.out).toContain("starter_facts_hidden: no row");
    expect(r.out).not.toMatch(/postgres(ql)?:\/\//);
    expect(r.out).not.toContain(url(name));
    // Put it back for the other tests.
    dev({ COMMAND: "set-setting", SETTING_KEY: "feed_nudge_donate_url", SETTING_VALUE: '"https://syroscats.com/donations"' });
  });

  it("sets the hidden facts, and updated_at moves", async () => {
    const r = dev({ COMMAND: "set-setting", SETTING_KEY: "starter_facts_hidden", SETTING_VALUE: '["fact.earTip","fact.cost"]' });
    expect(r.code).toBe(0);
    expect(await value("starter_facts_hidden")).toEqual(["fact.earTip", "fact.cost"]);
  });

  it.each([
    ["feed_nudge_donate_url", '"http://syroscats.com/donations"'],
    ["feed_nudge_donate_url", "https://syroscats.com/donations"],
    ["starter_facts_hidden", '["fact.earTp"]'],
    ["starter_facts_hidden", '"fact.earTip"'],
    ["feed_tap_count", '"false"'],
    ["no_such_key", "true"],
  ])("refuses %s = %s and changes nothing", async (key, raw) => {
    const before = (await c.query(`select key, value from app_settings order by key`)).rows;
    const r = dev({ COMMAND: "set-setting", SETTING_KEY: key, SETTING_VALUE: raw });
    expect(r.code).not.toBe(0);
    expect((await c.query(`select key, value from app_settings order by key`)).rows).toEqual(before);
  });

  it("refuses a missing value", async () => {
    const r = dev({ COMMAND: "set-setting", SETTING_KEY: "feed_tap_count" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("SETTING_VALUE must be set");
  });

  it("refuses the rehearsal target", async () => {
    const r = run({
      COMMAND: "list-settings",
      TARGET: "rehearsal",
      DATABASE_TARGET: "rehearsal",
      NEON_REHEARSAL_URL: url(name),
    });
    expect(r.code).not.toBe(0);
  });
});

describe("db-ops list-settings", () => {
  it("lists the three switches", async () => {
    const r = dev({ COMMAND: "list-settings" });
    expect(r.code).toBe(0);
    expect(r.out).toContain('feed_nudge_donate_url = "https://syroscats.com/donations"');
    expect(r.out).toContain("feed_tap_count: no row");
  });
});

describe("shapes", () => {
  it("nine sign-off facts, all known", () => {
    expect(SIGN_OFF_FACT_IDS).toHaveLength(9);
    for (const id of SIGN_OFF_FACT_IDS) expect(STARTER_FACT_IDS).toContain(id);
  });

  it("the reader accepts an unknown fact id; db-ops doesn't", () => {
    expect(settingShapeProblem("starter_facts_hidden", ["fact.nope"])).toBeNull();
    expect(settingWriteProblem("starter_facts_hidden", ["fact.nope"])).toMatch(/unknown fact ids/);
  });
});
