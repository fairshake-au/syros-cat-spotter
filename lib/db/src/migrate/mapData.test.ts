import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
} from "./runner";

// SYC-705 Phase 2: feeding_sites.position_approximate (0051) and the
// map_data_files table that holds the dashboard map's style and font files
// (0052).

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `map_data_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;

const HASH = "a".repeat(64);
const insertFile = (
  version: number,
  path: string,
  bytes: Buffer,
  size: number,
  sha = HASH,
) =>
  c.query(
    `insert into map_data_files (version, path, bytes, sha256, size) values ($1, $2, $3, $4, $5)`,
    [version, path, bytes, sha, size],
  );

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

describe("feeding_sites.position_approximate", () => {
  it("exists, is not null, and defaults to false", async () => {
    const col = (
      await c.query(
        `select is_nullable, column_default, data_type from information_schema.columns
         where table_name = 'feeding_sites' and column_name = 'position_approximate'`,
      )
    ).rows[0];
    expect(col).toEqual({
      is_nullable: "NO",
      column_default: "false",
      data_type: "boolean",
    });
    const row = (
      await c.query(
        `insert into feeding_sites (name, lat, lng) values ('Site', 37.4, 24.9) returning position_approximate`,
      )
    ).rows[0];
    expect(row.position_approximate).toBe(false);
  });
});

describe("map_data_files", () => {
  it("stores a file and defaults fetched_at", async () => {
    await insertFile(1, "style.json", Buffer.from("abc"), 3);
    const r = await c.query(
      `select fetched_at from map_data_files where version = 1 and path = 'style.json'`,
    );
    expect(r.rows[0].fetched_at).toBeInstanceOf(Date);
  });

  it("refuses a size that isn't the byte length", async () => {
    await expect(insertFile(1, "bad.json", Buffer.from("abc"), 4)).rejects.toThrow(
      /map_data_files_size_ck/,
    );
  });

  it("refuses a version of zero or less", async () => {
    await expect(insertFile(0, "v0.json", Buffer.from("a"), 1)).rejects.toThrow(
      /map_data_files_version_ck/,
    );
  });

  it("refuses a sha256 that isn't 64 lowercase hex characters", async () => {
    for (const sha of ["abc", "A".repeat(64), "g".repeat(64), `${HASH}0`]) {
      await expect(
        insertFile(1, "sha.json", Buffer.from("a"), 1, sha),
      ).rejects.toThrow(/map_data_files_sha256_ck/);
    }
  });

  it("keeps one row per (version, path)", async () => {
    await expect(insertFile(1, "style.json", Buffer.from("abc"), 3)).rejects.toThrow(
      /map_data_files_version_path_pk/,
    );
    await insertFile(2, "style.json", Buffer.from("abc"), 3);
  });
});
