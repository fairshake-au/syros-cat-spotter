import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createThrowawayDatabase, dropThrowawayDatabase } from "../migrate/testDatabase";
import { picture, seedEverywhere } from "./__fixtures__/seed";
import { runPhotosCommand } from "./cli";

// SYC-462 spec §5; T7 (public output) and the CLI's refusals and exit codes.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

let name: string;
let url: string;
let c: pg.Client;
let seq = 500;

beforeAll(async () => {
  const t = await createThrowawayDatabase(baseUrl, { prefix: "photo_cli" });
  name = t.name;
  url = t.url;
  c = new pg.Client({ connectionString: url });
  await c.connect();
});

afterAll(async () => {
  await c?.end();
  await dropThrowawayDatabase(baseUrl, name);
});

async function run(args: string[], target = "development", env: Record<string, string> = {}) {
  const lines: string[] = [];
  const code = await runPhotosCommand([args[0]!, "--target", target, ...args.slice(1)], {
    env: { DATABASE_TARGET: target, NEON_DEV_URL: url, NEON_PROD_URL: url, ...env },
    out: (l) => lines.push(l),
  });
  return { code, text: lines.join("\n") };
}

describe("T7: nothing private is printed", () => {
  it("list, hide, remove (dry and real) print no address, host, device, coordinates, note or reason", async () => {
    const P = await seedEverywhere(c, picture(++seq), "cli-t7", { hide: false });
    // A spot from a known device at an exact position, and a note on the report (sightings are append-only).
    const other = (await c.query(`insert into photos (data) values ('c2Vj') returning id`)).rows[0].id;
    await c.query(
      `insert into sightings (device_id, photo_id, lat, lng, status, cat_id) values ('device-secret-123', $1, 37.4441, 24.9417, 'resolved', $2)`,
      [other, P.catId],
    );
    await c.query(`update welfare_reports set note = 'note-secret', team_note = 'team-note-secret' where photo_id = $1`, [P.photoId]);
    const outputs = [
      await run(["list", "--cat", String(P.catId)]),
      await run(["hide", "--photo", P.publicId, "--by", P.person]),
      await run(["hide", "--photo", P.publicId, "--by", P.person, "--confirm", "HIDE"]),
      await run(["remove", "--photo", P.publicId, "--by", P.person, "--ref", "SYC-462"]),
      await run([
        "remove", "--photo", P.publicId, "--by", P.person, "--ref", "SYC-462",
        "--photo-confirm", P.publicId, "--confirm", "REMOVE",
      ]),
    ];
    const all = outputs.map((o) => o.text).join("\n");
    const u = new URL(url);
    for (const bad of [url, u.host, u.password, "device-secret-123", "37.4441", "24.9417", "note-secret", "team-note-secret", "photo_private"]) {
      if (bad) expect(all).not.toContain(bad);
    }
    expect(all).toContain(P.publicId);
    expect(outputs.map((o) => o.code)).toEqual([0, 0, 0, 0, 0]);
    expect(outputs[3]!.text).toContain("DRY RUN: nothing changed");
    expect(outputs[4]!.text).toMatch(/^GONE \(\d+ ms\)$/m);
  });
});

describe("refusals and exit codes", () => {
  it("refuses a target mismatch before connecting (2)", async () => {
    const lines: string[] = [];
    const code = await runPhotosCommand(["list", "--target", "development", "--cat", "1"], {
      env: { DATABASE_TARGET: "production", NEON_DEV_URL: url },
      out: (l) => lines.push(l),
    });
    expect(code).toBe(2);
    expect(lines.join("\n")).toMatch(/doesn't match target 'development'/);
  });

  it("refuses rehearsal (2)", async () => {
    expect((await run(["list", "--cat", "1"], "rehearsal", { NEON_REHEARSAL_URL: url })).code).toBe(2);
  });

  it("remove without confirm is a dry run; with confirm but a different id it refuses and changes nothing", async () => {
    const P = await seedEverywhere(c, picture(++seq), "cli-confirm");
    const dry = await run(["remove", "--photo", P.publicId, "--by", P.person, "--ref", "SYC-462"]);
    expect(dry.code).toBe(0);
    expect(dry.text).toContain("DRY RUN");
    const other = "11111111-1111-4111-8111-111111111111";
    const bad = await run([
      "remove", "--photo", P.publicId, "--by", P.person, "--ref", "SYC-462", "--photo-confirm", other, "--confirm", "REMOVE",
    ]);
    expect(bad.code).toBe(2);
    expect(bad.text).toContain("doesn't match");
    expect((await c.query(`select data is not null as has from photos where id = $1`, [P.photoId])).rows[0].has).toBe(true);
  });

  it("refuses a photo_ref with a name (T4)", async () => {
    const P = await seedEverywhere(c, picture(++seq), "cli-ref");
    const r = await run(["remove", "--photo", P.publicId, "--by", P.person, "--ref", "Maria door"]);
    expect(r.code).toBe(2);
    expect(r.text).not.toContain("Maria");
  });

  it("refuses a wrong confirm word", async () => {
    const P = await seedEverywhere(c, picture(++seq), "cli-word");
    expect((await run(["hide", "--photo", P.publicId, "--by", P.person, "--confirm", "REMOVE"])).code).toBe(2);
  });

  it("production needs photo_removal_on (T4), and then removes", async () => {
    const P = await seedEverywhere(c, picture(++seq), "cli-prod");
    const args = ["remove", "--photo", P.publicId, "--by", P.person, "--ref", "SYC-462", "--photo-confirm", P.publicId, "--confirm", "REMOVE"];
    const off = await run(args, "production");
    expect(off.code).toBe(1);
    expect(off.text).toContain("isn't switched on");
    await c.query(`insert into app_settings (key, value) values ('photo_removal_on', 'true'::jsonb) on conflict (key) do update set value = excluded.value`);
    try {
      expect((await run(args, "production")).code).toBe(0);
    } finally {
      await c.query(`delete from app_settings where key = 'photo_removal_on'`);
    }
  });

  it("exits 3 on NOT GONE, naming the other row with the same picture", async () => {
    const pic = picture(++seq);
    const P = await seedEverywhere(c, pic, "cli-dup");
    const dup = (await c.query(`insert into photos (data) values ($1) returning id`, [pic])).rows[0].id;
    const r = await run([
      "remove", "--photo", P.publicId, "--by", P.person, "--ref", "SYC-462", "--photo-confirm", P.publicId, "--confirm", "REMOVE",
    ]);
    expect(r.code).toBe(3);
    expect(r.text).toContain(`photo row ${dup}`);
    expect(r.text).toMatch(/^NOT GONE/m);
  });

  it("a second remove says already removed (0)", async () => {
    const P = await seedEverywhere(c, picture(++seq), "cli-again");
    const args = ["remove", "--photo", P.publicId, "--by", P.person, "--ref", "SYC-462", "--photo-confirm", P.publicId, "--confirm", "REMOVE"];
    expect((await run(args)).code).toBe(0);
    const again = await run(args);
    expect(again.code).toBe(0);
    expect(again.text).toContain("already removed on");
  });
});
