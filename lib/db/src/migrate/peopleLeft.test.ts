import crypto from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../schema";
import { peopleStore, PeopleError } from "../people";
import {
  defaultMigrationsFolder,
  migrateUp,
  readMigrations,
  rollbackLast,
} from "./runner";
import { schemaSignature, signatureDiff } from "./signature";
import { truncateWithGuardsOff } from "./truncatePeople";

// Marking people as left (SYC-43 part 2, Decision 7; plan tests P0-2 to P0-5),
// on a throwaway database. P0-1, the three readers of "who is allowed in",
// is in artifacts/api-server/src/routes/team.left.test.ts.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const suffix = crypto.randomBytes(4).toString("hex");
const name = `people_left_test_${suffix}`;
const cycleName = `people_left_cycle_${suffix}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;
let store: ReturnType<typeof peopleStore>;

const migrations = readMigrations(defaultMigrationsFolder());

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
  await admin.end();
});

beforeEach(async () => {
  // SYC-53 PR 0.1: the cascade reaches guarded add-only tables (including
  // person_events); the helper switches their TRUNCATE guards off for
  // this one statement and back on.
  await truncateWithGuardsOff(c, "report_state_events, welfare_reports, person_scopes, people");
});

const SUSAN = "susan@example.com";
const addSusan = (roles?: string[]) =>
  store.addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:test", roles });

/**
 * A person written with raw SQL, so with no `person_events` row. The link
 * tests below must run on this, not on addSusan(): a person made by the store
 * has an `added` event, whose strict link refuses the delete whatever the
 * welfare links say, so the test would stay green with a link removed.
 */
const rawSusan = async () => {
  const r = await c.query(
    `insert into people (email, name, added_by, accepted_at) values ($1, 'Susan', 'cli:test', now()) returning id`,
    [SUSAN],
  );
  const id = r.rows[0].id as string;
  await c.query(`insert into person_scopes (person_id, role, reach) values ($1, 'staff', 'island')`, [id]);
  return { id };
};

const row = async (id: string) =>
  (
    await c.query(
      `select session_version, left_at, left_by, added_by from people where id = $1`,
      [id],
    )
  ).rows[0] as {
    session_version: number;
    left_at: Date | null;
    left_by: string | null;
    added_by: string | null;
  };

describe("markLeft", () => {
  it("marks the person as left, and both readers refuse them", async () => {
    const p = await addSusan();
    const result = await store.markLeft(SUSAN, "cli:samuel");
    expect(result).toEqual({ id: p.id, sessionVersion: 2 });
    const r = await row(p.id);
    expect(r.left_at).toBeInstanceOf(Date);
    expect(r.left_by).toBe("cli:samuel");
    expect(await store.findAllowedPerson(SUSAN)).toBeNull();
    expect(await store.findPersonById(p.id)).toBeNull();
  });

  // P0-2. requireTeam and the hand-off compare the session's `sv` with the
  // stored session_version. This reads the row directly, skipping
  // findPersonById and so the left_at check, and does that comparison alone:
  // an open session must fail it too.
  it("P0-2: raises session_version, so the session comparison alone refuses", async () => {
    const p = await addSusan();
    const sessionSv = p.sessionVersion;
    await store.markLeft(SUSAN, "cli:samuel");
    const stored = (await row(p.id)).session_version;
    expect(stored).toBe(sessionSv + 1);
    expect(stored === sessionSv).toBe(false);
  });

  it("is one transaction: a failure leaves left_at and session_version untouched", async () => {
    const p = await addSusan();
    // left_by is text; a value Postgres can't store makes the UPDATE fail.
    await expect(store.markLeft(SUSAN, "bad\u0000by")).rejects.toThrow();
    const r = await row(p.id);
    expect(r.left_at).toBeNull();
    expect(r.session_version).toBe(1);
  });

  it("refuses to mark someone twice, keeping when and by whom they left", async () => {
    const p = await addSusan();
    await store.markLeft(SUSAN, "cli:samuel");
    const first = await row(p.id);
    const again = store.markLeft(SUSAN, "cli:someone-else");
    await expect(again).rejects.toThrow(PeopleError);
    await expect(store.markLeft(SUSAN, "cli:x")).rejects.toThrow(
      "That person is already marked as left.",
    );
    expect(await row(p.id)).toEqual(first);
  });

  it("is null for an address that was never on the list", async () => {
    expect(await store.markLeft("nobody@example.com", "cli:x")).toBeNull();
  });

  it("normalises the address", async () => {
    const p = await addSusan();
    expect(await store.markLeft(" SUSAN@Example.com ", "cli:x")).toEqual({
      id: p.id,
      sessionVersion: 2,
    });
  });
});

describe("P0-3: adding a left person's address again rejoins the same row", () => {
  it("same id, left_at cleared, a new session_version, history still theirs", async () => {
    const p = await addSusan(["staff", "vet"]);
    await c.query(
      `insert into welfare_reports
         (public_id, severity, lat, lng, client_ref, state, state_changed_by)
       values ('r-1', 'urgent', 37.4, 24.9, 'c-1', 'looking', $1)`,
      [p.id],
    );
    await store.markLeft(SUSAN, "cli:samuel");

    const back = await store.addPerson({
      email: "Susan@Example.com",
      name: "Susan P",
      addedBy: "cli:other",
    });
    expect(back.rejoined).toBe(true);
    expect(back.id).toBe(p.id);
    expect(back.sessionVersion).toBe(3); // 1, then 2 on leaving, 3 on rejoining
    expect(back.name).toBe("Susan P");

    const count = await c.query(`select count(*)::int as n from people`);
    expect(count.rows[0].n).toBe(1);
    const r = await row(p.id);
    expect(r.left_at).toBeNull();
    expect(r.left_by).toBeNull();
    expect(r.added_by).toBe("cli:test"); // when they first joined stays

    // Their old report still names them.
    const report = await c.query(
      `select p.id from welfare_reports w join people p
         on p.id = w.state_changed_by where w.public_id = 'r-1'`,
    );
    expect(report.rows).toEqual([{ id: p.id }]);

    // Back on the list, with the roles given now, not the ones they had.
    expect(await store.findAllowedPerson(SUSAN)).toMatchObject({ id: p.id });
    expect(await store.findPersonById(p.id)).toMatchObject({
      sessionVersion: 3,
      scopes: [{ role: "staff", colonyId: null, reach: "island", expiresAt: null }],
    });
  });

  it("still refuses an address that is on the list and hasn't left", async () => {
    await addSusan();
    await expect(addSusan()).rejects.toThrow(
      "That address is already on the list.",
    );
  });

  it("a session from before they left stays dead after they rejoin", async () => {
    const p = await addSusan();
    const oldSv = p.sessionVersion;
    await store.markLeft(SUSAN, "cli:samuel");
    await addSusan();
    expect((await store.findPersonById(p.id))!.sessionVersion).not.toBe(oldSv);
  });
});

describe("P0-4: nobody on the list can be hard-deleted (SYC-53 PR 0.1)", () => {
  // P1-10 (P0-4, repointed at the real links PR 1 added): each is a strict
  // link to people.id, no cascade and no set-null. Since PR 0.1 every person
  // also has an `added` event with a strict link, so a hard delete can never
  // succeed and `removePerson` is gone (spec 9.6): marking as left is the only
  // way off the list.
  const links: [string, (personId: string) => Promise<void>][] = [
    [
      "welfare_reports.state_changed_by",
      async (personId) => {
        await c.query(
          `insert into welfare_reports
             (public_id, severity, lat, lng, client_ref, state, state_changed_by)
           values ('h-1', 'urgent', 37.4, 24.9, 'h-c-1', 'looking', $1)`,
          [personId],
        );
      },
    ],
    [
      "welfare_reports.team_note_by",
      async (personId) => {
        await c.query(
          `insert into welfare_reports
             (public_id, severity, lat, lng, client_ref, team_note, team_note_by, team_note_at)
           values ('h-2', 'urgent', 37.4, 24.9, 'h-c-2', 'went, cat gone', $1, now())`,
          [personId],
        );
      },
    ],
    [
      "report_state_events.person_id",
      async (personId) => {
        const r = await c.query(
          `insert into welfare_reports (public_id, severity, lat, lng, client_ref)
           values ('h-3', 'urgent', 37.4, 24.9, 'h-c-3') returning id`,
        );
        await c.query(
          `insert into report_state_events (report_id, from_state, to_state, person_id)
           values ($1, 'new', 'looking', $2)`,
          [r.rows[0].id, personId],
        );
      },
    ],
  ];

  it.each(links)(
    "P1-10: a person named in %s can't be hard-deleted; the database refuses",
    async (_link, seed) => {
      const p = await rawSusan();
      await seed(p.id);

      await expect(
        c.query(`delete from people where id = $1`, [p.id]),
      ).rejects.toMatchObject({ code: "23503" });

      // Nothing changed: the person and their roles are both still there.
      expect(await store.findPersonById(p.id)).toMatchObject({
        scopes: [{ role: "staff", colonyId: null, reach: "island", expiresAt: null }],
      });
    },
  );

  it("an observation's author has no database link, so only the `added` event protects them", async () => {
    // account_id has no foreign key (spec 10.1). On a raw person with no
    // event nothing refuses the delete; on a person made by the store, the
    // `added` event does.
    const raw = await rawSusan();
    const cat = await c.query(
      `insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id)
         values ('Agatha', 0, 37.44, 24.94, 'd') returning id`,
    );
    await c.query(
      `insert into observations
         (cat_id, kind, value, account_id, role_at_time, authority_scope, provenance, observed_at)
       values ($1, 'sterilised', '{"sterilised": true}', $2, 'staff', 'none', 'volunteered', now())`,
      [cat.rows[0].id, raw.id],
    );
    await c.query(`delete from person_scopes where person_id = $1`, [raw.id]);
    await expect(
      c.query(`delete from people where id = $1`, [raw.id]),
    ).resolves.toBeDefined();
    const p = await addSusan();
    await c.query(
      `insert into observations
         (cat_id, kind, value, account_id, role_at_time, authority_scope, provenance, observed_at)
       values ($1, 'sterilised', '{"sterilised": true}', $2, 'staff', 'none', 'volunteered', now())`,
      [cat.rows[0].id, p.id],
    );
    await expect(
      c.query(`delete from people where id = $1`, [p.id]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("a person with no other history still has an `added` event, so the database refuses their delete", async () => {
    const p = await addSusan();
    const events = await c.query(
      `select kind from person_events where person_id = $1`,
      [p.id],
    );
    expect(events.rows).toEqual([{ kind: "added" }]);
    await expect(
      c.query(`delete from people where id = $1`, [p.id]),
    ).rejects.toMatchObject({ code: "23503" });
    expect(await row(p.id)).toBeDefined();
  });

  it("removePerson no longer exists", () => {
    expect((store as Record<string, unknown>)["removePerson"]).toBeUndefined();
  });
});

describe("P0-5: this migration's rollback", () => {
  const mine = migrations.find((m) => m.tag.endsWith("_people_left"));

  it("restores the schema from before it exactly, and up/down/up works", async () => {
    expect(mine).toBeDefined();
    await admin.query(`drop database if exists "${cycleName}"`);
    await admin.query(`create database "${cycleName}"`);
    const cc = new pg.Client({ connectionString: url(cycleName) });
    await cc.connect();
    try {
      await migrateUp(cc, migrations, { throughIdx: mine!.idx - 1 });
      const before = await schemaSignature(cc, "public");
      await migrateUp(cc, migrations, { throughIdx: mine!.idx });
      const after = await schemaSignature(cc, "public");
      expect(await rollbackLast(cc, migrations)).toBe(mine!.tag);
      expect(
        signatureDiff(await schemaSignature(cc, "public"), before, {
          actual: "after rollback",
          expected: "before",
        }),
      ).toEqual([]);
      await migrateUp(cc, migrations, { throughIdx: mine!.idx });
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

  it("refuses to roll back while anyone is marked as left, since that would let them back in", async () => {
    expect(mine).toBeDefined();
    await admin.query(`drop database if exists "${cycleName}"`);
    await admin.query(`create database "${cycleName}"`);
    const cc = new pg.Client({ connectionString: url(cycleName) });
    await cc.connect();
    try {
      await migrateUp(cc, migrations, { throughIdx: mine!.idx });
      // Raw rows: this database is migrated only through 0007, so
      // person_events (0016) doesn't exist and the store can't be used.
      await cc.query(
        `insert into people (email, name, added_by, left_at, left_by)
         values ($1, 'Susan', 'cli:test', now(), 'cli:samuel')`,
        [SUSAN],
      );
      await expect(rollbackLast(cc, migrations)).rejects.toThrow(
        /marked as left/,
      );
      const cols = await cc.query(
        `select column_name from information_schema.columns
          where table_name = 'people' and column_name in ('left_at', 'left_by')`,
      );
      expect(cols.rows).toHaveLength(2);
    } finally {
      await cc.end();
    }
  });
});
