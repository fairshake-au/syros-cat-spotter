import crypto from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../schema";
import { PeopleError, peopleStore, START_ALONE, START_NO_END, START_OR_COLONIES } from "../people";
import { defaultMigrationsFolder, migrateUp, readMigrations, rollbackLast } from "./runner";
import { truncateWithGuardsOff } from "./truncatePeople";

// SYC-439 (roles-and-invites-first-colony.md §4.2, §4.4, §5, §6): "no colony
// yet", a person_scopes row with reach `start`. What the database refuses,
// how every writer writes and clears it, and the migration's way back. On a
// throwaway database.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");
const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `first_colony_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;
let store: ReturnType<typeof peopleStore>;

const all = readMigrations(defaultMigrationsFolder());
const mine = all.find((m) => m.tag.endsWith("_person_scopes_start_reach"))!;
// Stop at this migration, so "roll back the last one" always means this one.
const migrations = all.filter((m) => m.idx <= mine.idx);

beforeAll(async () => {
  expect(mine).toBeDefined();
  await admin.connect();
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
  await migrateUp(c, migrations);
  store = peopleStore(drizzle(c, { schema }));
});

afterAll(async () => {
  await c.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
});

beforeEach(async () => {
  await truncateWithGuardsOff(c, "person_scopes, people");
});

const newColony = async (label = `Vaporia ${crypto.randomBytes(3).toString("hex")}`) =>
  (
    await c.query(`insert into colonies (name, normalised_name) values ($1, lower($1)) returning id`, [label])
  ).rows[0].id as number;

const rawPerson = async (email: string) =>
  (
    await c.query(
      `insert into people (email, name, added_by, accepted_at) values ($1, 'Mara', 'cli:test', now()) returning id`,
      [email],
    )
  ).rows[0].id as string;

const insertScope = (
  person: string,
  role: string,
  reach: string,
  colony: number | null,
  extra: { expires?: string; relationship?: string } = {},
) =>
  c.query(
    `insert into person_scopes (person_id, role, reach, colony_id, expires_at, relationship) values ($1, $2, $3, $4, $5, $6)`,
    [person, role, reach, colony, extra.expires ?? null, extra.relationship ?? null],
  );

const rowsOf = async (person: string) =>
  (
    await c.query<{ role: string; colony_id: number | null; reach: string; expired: boolean }>(
      `select role, colony_id, reach, (expires_at is not null and expires_at <= now()) as expired
         from person_scopes where person_id = $1 order by id`,
      [person],
    )
  ).rows;

const starter = async (email = "mara@example.com") => {
  const p = await rawPerson(email);
  await insertScope(p, "guardian", "start", null);
  return p;
};

describe("what person_scopes refuses (SYC-439)", () => {
  it("accepts a cat guardian with no colony yet, and a vet island-wide as before", async () => {
    const p = await rawPerson("mara@example.com");
    await insertScope(p, "guardian", "start", null);
    const v = await rawPerson("vet@example.com");
    await insertScope(v, "vet", "island", null);
  });

  it("refuses a start row with a colony", async () => {
    const p = await rawPerson("mara@example.com");
    await expect(insertScope(p, "guardian", "start", await newColony())).rejects.toThrow(
      /person_scopes_(start|reach_colony)_ck/,
    );
  });

  it("refuses a start row for the team, management or a vet (person_scopes_start_ck)", async () => {
    const p = await rawPerson("mara@example.com");
    await expect(insertScope(p, "vet", "start", null)).rejects.toThrow(/person_scopes_start_ck/);
    for (const role of ["staff", "management"]) {
      await expect(insertScope(p, role, "start", null)).rejects.toThrow(/person_scopes_(start|team_island)_ck/);
    }
  });

  it("refuses a start row with an end date or a label (person_scopes_start_ck)", async () => {
    const p = await rawPerson("mara@example.com");
    await expect(insertScope(p, "guardian", "start", null, { expires: "2099-01-01" })).rejects.toThrow(
      /person_scopes_start_ck/,
    );
    await expect(insertScope(p, "guardian", "start", null, { relationship: "feeds" })).rejects.toThrow(
      /person_scopes_start_ck/,
    );
  });

  it("still refuses an island-wide cat guardian, and two start rows for one person", async () => {
    const p = await rawPerson("mara@example.com");
    await expect(insertScope(p, "guardian", "island", null)).rejects.toThrow(/person_scopes_guardian_colony_ck/);
    await insertScope(p, "guardian", "start", null);
    await expect(insertScope(p, "guardian", "start", null)).rejects.toThrow(/person_scopes_role_scope_unique/);
  });
});

describe("writing 'no colony yet': only on purpose (§4.4)", () => {
  const invite = (placements: Parameters<typeof store.invitePerson>[1]["placements"], email = "new@example.com") =>
    store.invitePerson("cli:test", { email, name: "Mara", placements, language: "en", languageUsed: "en" });

  it("an invitation with the explicit flag writes a start row and says so in the event", async () => {
    const { id } = await invite([{ role: "guardian", start: true }]);
    expect(await rowsOf(id)).toEqual([{ role: "guardian", colony_id: null, reach: "start", expired: false }]);
    const ev = await c.query(`select detail from person_events where person_id = $1 and kind = 'invited'`, [id]);
    expect(ev.rows[0].detail).toMatchObject({ start: true, roles: ["guardian"], colonyIds: [] });
  });

  it("a cat guardian with no colony and no flag is refused, never turned into a starter", async () => {
    await expect(invite([{ role: "guardian" }])).rejects.toThrow("A cat guardian needs a colony.");
    await expect(invite([{ role: "guardian", colonyId: null }])).rejects.toThrow("A cat guardian needs a colony.");
    await expect(invite([{ role: "guardian", start: false }])).rejects.toThrow("A cat guardian needs a colony.");
  });

  it("refuses the flag with another role, a colony, an end date or a label", async () => {
    const colony = await newColony();
    await expect(invite([{ role: "guardian", start: true }, { role: "staff" }])).rejects.toThrow(START_ALONE);
    await expect(invite([{ role: "staff", start: true }])).rejects.toThrow(START_ALONE);
    await expect(invite([{ role: "guardian", start: true }, { role: "guardian", colonyId: colony }])).rejects.toThrow(
      START_OR_COLONIES,
    );
    await expect(invite([{ role: "guardian", start: true, colonyId: colony }])).rejects.toThrow(START_OR_COLONIES);
    await expect(
      invite([{ role: "guardian", start: true, endsAt: new Date(Date.now() + 86_400_000) }]),
    ).rejects.toThrow(START_NO_END);
    await expect(invite([{ role: "guardian", start: true, relationship: "feeds" }])).rejects.toThrow(START_NO_END);
  });

  it("the people command gives it only with --add guardian --start, to someone holding nothing else", async () => {
    const p = await rawPerson("mara@example.com");
    await store.setRoles({ email: "mara@example.com", by: "cli:test", add: "guardian", start: true, force: true });
    expect((await rowsOf(p)).map((r) => r.reach)).toEqual(["start"]);
    await expect(
      store.setRoles({ email: "mara@example.com", by: "cli:test", add: "guardian", start: true, force: true }),
    ).rejects.toThrow(/already hold guardian:start/);
    const s = await rawPerson("susan@example.com");
    await insertScope(s, "staff", "island", null);
    await expect(
      store.setRoles({ email: "susan@example.com", by: "cli:test", add: "guardian", start: true, force: true }),
    ).rejects.toThrow(START_ALONE);
    await expect(
      store.setRoles({ email: "susan@example.com", by: "cli:test", add: "staff", start: true }),
    ).rejects.toThrow(/--start is only for --add guardian/);
  });
});

describe("clearing 'no colony yet': any other row ends it (§4.4)", () => {
  it("Change roles onto a colony deletes the start row; ending that placement later leaves no row in force", async () => {
    const p = await starter();
    const colony = await newColony();
    const r = await store.setPlacements("cli:test", p, [{ role: "guardian", colonyId: colony }]);
    expect(r.before).toEqual(["guardian:start"]);
    expect(r.after).toEqual([`guardian:${colony}`]);
    expect((await rowsOf(p)).map((x) => x.reach)).toEqual(["colony"]);
    await c.query(`update person_scopes set expires_at = now() - interval '1 second' where person_id = $1`, [p]);
    expect((await rowsOf(p)).every((x) => x.expired && x.reach === "colony")).toBe(true);
  });

  it("Change roles to the team deletes it too", async () => {
    const p = await starter();
    await store.setPlacements("cli:test", p, [{ role: "staff" }]);
    expect((await rowsOf(p)).map((x) => [x.role, x.reach])).toEqual([["staff", "island"]]);
  });

  it("saving Change roles unchanged keeps it", async () => {
    const p = await starter();
    await expect(store.setPlacements("cli:test", p, [{ role: "guardian", start: true }])).rejects.toThrow(
      /already hold exactly that/,
    );
    expect((await rowsOf(p)).map((x) => x.reach)).toEqual(["start"]);
  });

  it("--replace deletes it too, so dropping the new role later can't bring it back (review R4)", async () => {
    const p = await starter("mara@example.com");
    await store.setRoles({ email: "mara@example.com", by: "cli:test", replace: ["staff"] });
    expect((await rowsOf(p)).map((x) => [x.role, x.reach])).toEqual([["staff", "island"]]);
  });

  it("Bring back onto a colony leaves only that colony (review R4)", async () => {
    const p = await starter("mara@example.com");
    await c.query(`update people set left_at = now(), left_by = 'cli:test' where id = $1`, [p]);
    const colony = await newColony();
    await store.rejoinPerson("cli:test", p, [{ role: "guardian", colonyId: colony }], "en", "en");
    expect((await rowsOf(p)).map((x) => [x.colony_id, x.reach])).toEqual([[colony, "colony"]]);
  });

  it("--remove guardian --start takes it away (review R10)", async () => {
    const p = await starter("mara@example.com");
    await store.setRoles({ email: "mara@example.com", by: "cli:test", remove: "guardian", start: true, force: true });
    expect(await rowsOf(p)).toEqual([]);
    await expect(
      store.setRoles({ email: "mara@example.com", by: "cli:test", remove: "guardian", start: true, force: true }),
    ).rejects.toThrow(/don't hold guardian:start/);
  });

  it("the people command's --add guardian --colony and --add staff delete it", async () => {
    const p = await starter("mara@example.com");
    const colony = await newColony();
    const r = await store.setRoles({ email: "mara@example.com", by: "cli:test", add: "guardian", colonyId: colony, force: true });
    expect(r.before).toEqual(["guardian:start"]);
    expect(r.after).toEqual([`guardian:${colony}`]);
    expect((await rowsOf(p)).map((x) => x.reach)).toEqual(["colony"]);
    const q = await starter("zoe@example.com");
    await store.setRoles({ email: "zoe@example.com", by: "cli:test", add: "staff" });
    expect((await rowsOf(q)).map((x) => [x.role, x.reach])).toEqual([["staff", "island"]]);
  });
});

describe("her first colony (§5)", () => {
  it("one transaction: the colony, her placement, the start row gone, one roles_changed with createdColony", async () => {
    const p = await starter();
    const { colonyId, placed } = await store.createColonyWithPlacement({ id: p }, { name: "Vaporia — Mara's" });
    expect(placed).toBe(true);
    expect(await rowsOf(p)).toEqual([{ role: "guardian", colony_id: colonyId, reach: "colony", expired: false }]);
    const ev = await c.query(`select by, detail from person_events where person_id = $1 and kind = 'roles_changed'`, [p]);
    expect(ev.rows).toEqual([
      { by: p, detail: { before: ["guardian:start"], after: [`guardian:${colonyId}`], createdColony: colonyId } },
    ]);
  });

  it("her first colony ends only HER 'no colony yet', not another starter's (review R3)", async () => {
    const p = await starter("mara@example.com");
    const q = await starter("zoe@example.com");
    await store.createColonyWithPlacement({ id: p }, { name: `Ano Syros ${crypto.randomBytes(3).toString("hex")}` });
    expect((await rowsOf(p)).map((x) => x.reach)).toEqual(["colony"]);
    expect((await rowsOf(q)).map((x) => x.reach)).toEqual(["start"]);
  });

  it("a name clash writes nothing: no colony, no event, and she is still a starter", async () => {
    const p = await starter();
    await newColony("Kini");
    await expect(store.createColonyWithPlacement({ id: p }, { name: "Kini" })).rejects.toThrow();
    expect((await rowsOf(p)).map((x) => x.reach)).toEqual(["start"]);
    const ev = await c.query(`select 1 from person_events where person_id = $1`, [p]);
    expect(ev.rowCount).toBe(0);
  });

  it("a guardian row with no colony and no 'start' reach (bad data) can't create one", async () => {
    // The database refuses that row, so the nearest bad data is a vet: nothing creates.
    const v = await rawPerson("vet@example.com");
    await insertScope(v, "vet", "island", null);
    await expect(store.createColonyWithPlacement({ id: v }, { name: "Nowhere" })).rejects.toBeInstanceOf(PeopleError);
  });
});

describe("the migration's way back", () => {
  it("refuses while anyone has 'no colony yet', and runs once nobody does", async () => {
    await starter();
    await expect(rollbackLast(c, migrations)).rejects.toThrow(/no colony yet/);
    await truncateWithGuardsOff(c, "person_scopes, people");
    expect(await rollbackLast(c, migrations)).toBe(mine.tag);
    await migrateUp(c, migrations);
  });
});
