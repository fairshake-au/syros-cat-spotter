import crypto from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../schema";
import { PERSON_EVENT_KINDS } from "../schema/personEvents";
import { peopleStore } from "../people";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
  rollbackLast,
} from "./runner";
import { schemaSignature, signatureDiff } from "./signature";
import { truncateWithGuardsOff } from "./truncatePeople";

// SYC-53 PR 0.1 / SYC-213: person_events, the record of who changed what.
// Spec roles-and-invites.md 11.1 and test 21 (15.3). On a throwaway database.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const suffix = crypto.randomBytes(4).toString("hex");
const name = `person_events_test_${suffix}`;
const cycleName = `person_events_cycle_${suffix}`;
const backfillName = `person_events_backfill_${suffix}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;
let store: ReturnType<typeof peopleStore>;

const migrations = readMigrations(defaultMigrationsFolder());
const mine = migrations.find((m) => m.tag.endsWith("_person_events"))!;

beforeAll(async () => {
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
  await admin.query(`drop database if exists "${cycleName}"`);
  await admin.query(`drop database if exists "${backfillName}"`);
  await admin.end();
});

beforeEach(async () => {
  await truncateWithGuardsOff(c, "person_scopes, people");
});

const SUSAN = "susan@example.com";
const events = async (personId?: string) =>
  (
    await c.query(
      `select person_id, kind, by, at, detail from person_events
        ${personId ? "where person_id = $1" : ""} order by id`,
      personId ? [personId] : [],
    )
  ).rows as {
    person_id: string;
    kind: string;
    by: string;
    at: Date;
    detail: Record<string, unknown> | null;
  }[];
const eventCount = async () =>
  (await c.query(`select count(*)::int as n from person_events`)).rows[0]
    .n as number;

describe("the table", () => {
  it("holds the fuller list of kinds from spec 11.1, and refuses any other", async () => {
    expect([...PERSON_EVENT_KINDS]).toEqual([
      "invited",
      "invite_sent",
      "invite_resent",
      "invite_withdrawn",
      "accepted",
      "added",
      "roles_changed",
      "left",
      "rejoined",
      "signed_out_everywhere",
      "anonymised",
    ]);
    const p = await store.addPerson({
      email: SUSAN,
      name: "Susan",
      addedBy: "cli:test",
    });
    for (const kind of PERSON_EVENT_KINDS) {
      await c.query(
        `insert into person_events (person_id, kind, by) values ($1, $2, 'cli:test')`,
        [p.id, kind],
      );
    }
    await expect(
      c.query(
        `insert into person_events (person_id, kind, by) values ($1, 'deleted', 'cli:test')`,
        [p.id],
      ),
    ).rejects.toThrow(/person_events_kind_ck/);
  });

  it("is strictly linked to people: an event for nobody is refused, and so is deleting a person who has one", async () => {
    await expect(
      c.query(
        `insert into person_events (person_id, kind, by)
         values (gen_random_uuid(), 'added', 'cli:test')`,
      ),
    ).rejects.toMatchObject({ code: "23503" });
    const p = await store.addPerson({
      email: SUSAN,
      name: "Susan",
      addedBy: "cli:test",
    });
    await expect(
      c.query(`delete from people where id = $1`, [p.id]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("refuses UPDATE", async () => {
    await store.addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:test" });
    await expect(
      c.query(`update person_events set kind = 'left'`),
    ).rejects.toThrow(/person_events is append-only: UPDATE is not allowed/);
    await expect(
      c.query(`update person_events set by = 'cli:someone-else'`),
    ).rejects.toThrow(/person_events is append-only: UPDATE is not allowed/);
  });

  it("refuses DELETE", async () => {
    await store.addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:test" });
    await expect(c.query(`delete from person_events`)).rejects.toThrow(
      /person_events is append-only: DELETE is not allowed/,
    );
    expect(await eventCount()).toBe(1);
  });

  it("refuses TRUNCATE", async () => {
    await expect(c.query(`truncate person_events`)).rejects.toThrow(
      /person_events is append-only: TRUNCATE is not allowed/,
    );
    // Nor does truncating people cascade past the guard.
    await expect(c.query(`truncate people cascade`)).rejects.toThrow(
      /append-only: TRUNCATE is not allowed/,
    );
  });
});

describe("T21: every operation writes exactly one event, in its own transaction", () => {
  it("addPerson writes `added`, with the roles and the adder, and nothing about who they are", async () => {
    const p = await store.addPerson({
      email: SUSAN,
      name: "Susan Example",
      addedBy: "cli:samuel",
      roles: ["staff", "vet"],
    });
    const ev = await events(p.id);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      kind: "added",
      by: "cli:samuel",
      detail: { roles: ["staff", "vet"] },
    });
    expect(JSON.stringify(ev[0]!.detail)).not.toMatch(/susan|example/i);
  });

  it("addPerson for an address that left writes `rejoined`, once", async () => {
    const p = await store.addPerson({
      email: SUSAN,
      name: "Susan",
      addedBy: "cli:samuel",
    });
    await store.markLeft(SUSAN, "cli:samuel");
    const before = await eventCount();
    const back = await store.addPerson({
      email: SUSAN,
      name: "Susan",
      addedBy: "cli:jacky",
      roles: ["staff"],
    });
    expect(back.rejoined).toBe(true);
    expect(back.id).toBe(p.id);
    expect(await eventCount()).toBe(before + 1);
    const ev = await events(p.id);
    expect(ev.map((e) => e.kind)).toEqual(["added", "left", "rejoined"]);
    expect(ev[2]).toMatchObject({
      by: "cli:jacky",
      detail: { roles: ["staff"] },
    });
  });

  it("markLeft writes `left` with the roles and colony ids held at the time", async () => {
    const p = await store.addPerson({
      email: SUSAN,
      name: "Susan",
      addedBy: "cli:samuel",
      roles: ["staff", "guardian"],
    });
    const colony = await c.query(
      `insert into colonies (name, normalised_name) values ('Vaporia', 'vaporia') returning id`,
    );
    await c.query(
      `insert into person_scopes (person_id, role, colony_id) values ($1, 'vet', $2)`,
      [p.id, colony.rows[0].id],
    );
    const before = await eventCount();
    await store.markLeft(SUSAN, "cli:samuel");
    expect(await eventCount()).toBe(before + 1);
    const ev = (await events(p.id)).at(-1)!;
    expect(ev.kind).toBe("left");
    expect(ev.by).toBe("cli:samuel");
    expect(ev.detail).toEqual({
      roles: expect.arrayContaining(["staff", "guardian", "vet"]),
      colonyIds: [colony.rows[0].id],
    });
    expect((ev.detail as { roles: string[] }).roles).toHaveLength(3);
    expect(JSON.stringify(ev.detail)).not.toMatch(/susan|example/i);
  });

  it("signOutEverywhere writes `signed_out_everywhere`, by whom", async () => {
    const p = await store.addPerson({
      email: SUSAN,
      name: "Susan",
      addedBy: "cli:samuel",
    });
    const before = await eventCount();
    expect(await store.signOutEverywhere(SUSAN, "cli:db-ops:claude")).toBe(2);
    expect(await eventCount()).toBe(before + 1);
    expect((await events(p.id)).at(-1)).toMatchObject({
      kind: "signed_out_everywhere",
      by: "cli:db-ops:claude",
    });
  });

  it("an operation that changes nothing writes nothing", async () => {
    await store.addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:t" });
    const before = await eventCount();
    expect(await store.markLeft("nobody@example.com", "cli:t")).toBeNull();
    expect(await store.signOutEverywhere("nobody@example.com", "cli:t")).toBeNull();
    await expect(
      store.addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:t" }),
    ).rejects.toThrow(/already on the list/);
    await expect(
      store.addPerson({ email: "x@example.com", name: "X", addedBy: "cli:t", roles: ["nope"] }),
    ).rejects.toThrow(/isn't a role/);
    await store.markLeft(SUSAN, "cli:t");
    const afterLeft = await eventCount();
    await expect(store.markLeft(SUSAN, "cli:t")).rejects.toThrow(/already marked as left/);
    expect(afterLeft).toBe(before + 1);
    expect(await eventCount()).toBe(afterLeft);
  });

  describe("the change and its event stand or fall together", () => {
    // A trigger that refuses the event, so the change must be undone with it.
    const breakEvents = () =>
      c.query(`
        create function refuse_person_event() returns trigger language plpgsql as
          $$ begin raise exception 'event refused'; end $$;
        create trigger refuse_person_event before insert on person_events
          for each row execute function refuse_person_event();`);
    const fixEvents = () =>
      c.query(`
        drop trigger refuse_person_event on person_events;
        drop function refuse_person_event();`);

    it("addPerson: no event, no person", async () => {
      await breakEvents();
      try {
        await expect(
          store.addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:t" }),
        ).rejects.toThrow();
      } finally {
        await fixEvents();
      }
      expect((await c.query(`select count(*)::int as n from people`)).rows[0].n).toBe(0);
      expect((await c.query(`select count(*)::int as n from person_scopes`)).rows[0].n).toBe(0);
    });

    it("rejoining: no event, still left, roles and session untouched", async () => {
      await store.addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:t", roles: ["vet"] });
      await store.markLeft(SUSAN, "cli:t");
      const before = (await c.query(`select * from people`)).rows[0];
      await breakEvents();
      try {
        await expect(
          store.addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:t" }),
        ).rejects.toThrow();
      } finally {
        await fixEvents();
      }
      expect((await c.query(`select * from people`)).rows[0]).toEqual(before);
      expect((await c.query(`select role from person_scopes`)).rows).toEqual([{ role: "vet" }]);
    });

    it("markLeft: no event, not left, session untouched", async () => {
      await store.addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:t" });
      const before = (await c.query(`select * from people`)).rows[0];
      await breakEvents();
      try {
        await expect(store.markLeft(SUSAN, "cli:t")).rejects.toThrow();
      } finally {
        await fixEvents();
      }
      expect((await c.query(`select * from people`)).rows[0]).toEqual(before);
    });

    it("signOutEverywhere: no event, session version untouched", async () => {
      await store.addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:t" });
      await breakEvents();
      try {
        await expect(store.signOutEverywhere(SUSAN, "cli:t")).rejects.toThrow();
      } finally {
        await fixEvents();
      }
      expect(
        (await c.query(`select session_version from people`)).rows[0].session_version,
      ).toBe(1);
    });
  });

  it("listPeople shows each person's history, oldest first, kinds and ids only", async () => {
    const p = await store.addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:t" });
    await store.signOutEverywhere(SUSAN, "cli:t");
    await store.markLeft(SUSAN, "cli:t");
    const [row] = await store.listPeople();
    expect(row!.id).toBe(p.id);
    expect(row!.history.map((h) => h.kind)).toEqual([
      "added",
      "signed_out_everywhere",
      "left",
    ]);
    expect(JSON.stringify(row!.history)).not.toMatch(/susan|example/i);
  });
});

describe("the backfill", () => {
  it("gives each existing person exactly one `added` and each left person one `left`", async () => {
    await admin.query(`create database "${backfillName}"`);
    const bc = new pg.Client({ connectionString: url(backfillName) });
    await bc.connect();
    try {
      await migrateUp(bc, migrations, { throughIdx: mine.idx - 1 });
      const ins = async (
        email: string,
        addedBy: string | null,
        addedAt: string,
        left?: { at: string; by: string | null },
      ) =>
        (
          await bc.query(
            `insert into people (email, name, added_by, added_at, left_at, left_by)
             values ($1, 'N', $2, $3, $4, $5) returning id`,
            [email, addedBy, addedAt, left?.at ?? null, left?.by ?? null],
          )
        ).rows[0].id as string;
      const colony = await bc.query(
        `insert into colonies (name, normalised_name) values ('Vaporia', 'vaporia') returning id`,
      );
      const staff = await ins("a@example.com", "cli:samuel", "2026-01-01T00:00:00Z");
      const stranger = await ins("b@example.com", null, "2026-02-01T00:00:00Z");
      const gone = await ins("c@example.com", "cli:jacky", "2026-03-01T00:00:00Z", {
        at: "2026-04-01T00:00:00Z",
        by: "cli:samuel",
      });
      const goneNoAuthor = await ins("d@example.com", "cli:jacky", "2026-03-02T00:00:00Z", {
        at: "2026-04-02T00:00:00Z",
        by: null,
      });
      await bc.query(
        `insert into person_scopes (person_id, role) values ($1, 'staff'), ($2, 'staff'), ($3, 'staff')`,
        [staff, stranger, goneNoAuthor],
      );
      await bc.query(
        `insert into person_scopes (person_id, role) values ($1, 'staff')`,
        [gone],
      );
      await bc.query(
        `insert into person_scopes (person_id, role, colony_id) values ($1, 'guardian', $2)`,
        [gone, colony.rows[0].id],
      );

      await migrateUp(bc, migrations, { throughIdx: mine.idx });

      const all = (
        await bc.query(
          `select person_id, kind, by, at, detail from person_events order by id`,
        )
      ).rows;
      const of = (id: string) => all.filter((e) => e.person_id === id);
      // Exactly one `added` each.
      for (const id of [staff, stranger, gone, goneNoAuthor]) {
        expect(of(id).filter((e) => e.kind === "added")).toHaveLength(1);
      }
      // Exactly one `left` for those with left_at, none for the others.
      expect(of(staff).filter((e) => e.kind === "left")).toHaveLength(0);
      expect(of(stranger).filter((e) => e.kind === "left")).toHaveLength(0);
      expect(of(gone).filter((e) => e.kind === "left")).toHaveLength(1);
      expect(of(goneNoAuthor).filter((e) => e.kind === "left")).toHaveLength(1);
      expect(all).toHaveLength(6);
      // From added_by / added_at; the migration stands in where there is no author.
      expect(of(staff)[0]).toMatchObject({ kind: "added", by: "cli:samuel" });
      expect(of(staff)[0].at.toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(of(stranger)[0]).toMatchObject({ by: "system:migration" });
      // `left`: from left_by / left_at, with the roles and colonies they hold.
      expect(of(gone)[1]).toMatchObject({ kind: "left", by: "cli:samuel" });
      expect(of(gone)[1].at.toISOString()).toBe("2026-04-01T00:00:00.000Z");
      expect(of(gone)[1].detail.roles.sort()).toEqual(["guardian", "staff"]);
      expect(of(gone)[1].detail.colonyIds).toEqual([colony.rows[0].id]);
      expect(of(goneNoAuthor)[1]).toMatchObject({ by: "system:migration" });
      // No name or address anywhere in what was written.
      expect(JSON.stringify(all)).not.toMatch(/@example\.com/);
    } finally {
      await bc.end();
    }
  });

  it("an empty list backfills nothing", async () => {
    await admin.query(`drop database if exists "${backfillName}"`);
    await admin.query(`create database "${backfillName}"`);
    const bc = new pg.Client({ connectionString: url(backfillName) });
    await bc.connect();
    try {
      await migrateUp(bc, migrations);
      expect((await bc.query(`select count(*)::int as n from person_events`)).rows[0].n).toBe(0);
    } finally {
      await bc.end();
    }
  }, 60_000);
});

describe("this migration's rollback", () => {
  it("restores the schema from before it exactly, and up/down/up works", async () => {
    await admin.query(`drop database if exists "${cycleName}"`);
    await admin.query(`create database "${cycleName}"`);
    const cc = new pg.Client({ connectionString: url(cycleName) });
    await cc.connect();
    try {
      await migrateUp(cc, migrations, { throughIdx: mine.idx - 1 });
      const before = await schemaSignature(cc, "public");
      await migrateUp(cc, migrations, { throughIdx: mine.idx });
      const after = await schemaSignature(cc, "public");
      expect(await rollbackLast(cc, migrations)).toBe(mine.tag);
      expect(
        signatureDiff(await schemaSignature(cc, "public"), before, {
          actual: "after rollback",
          expected: "before",
        }),
      ).toEqual([]);
      await migrateUp(cc, migrations, { throughIdx: mine.idx });
      expect(
        signatureDiff(await schemaSignature(cc, "public"), after, {
          actual: "second up",
          expected: "first up",
        }),
      ).toEqual([]);
    } finally {
      await cc.end();
    }
  });

  it("says in capital letters that rolling back deletes the history", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = readFileSync(
      join(defaultMigrationsFolder(), `${mine.tag}.sql`),
      "utf8",
    );
    const before = sql.slice(0, sql.indexOf("-- rollback-begin"));
    expect(before).toMatch(/ROLLING THIS BACK DELETES THE WHOLE RECORD/);
  });
});
