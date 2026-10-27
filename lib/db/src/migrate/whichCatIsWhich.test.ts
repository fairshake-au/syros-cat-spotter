import crypto from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsFolder, migrateUp, readMigrations } from "./runner";

// SYC-150 PR 2.1 (migration 0053; which-cat-is-which.md §9.1, §9.2, §9.4,
// §9.6, §9.8; spec test 1 and the database half of 16a). A sighting's cat
// changes only with a move or a merge recorded in the same transaction and
// named by its transaction-local setting. No resolved sighting is ever filed
// under a merged-away cat. Moves, merges and the duplicate records are
// add-only: redaction is the one update.

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set to run these tests");

const url = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};
const name = `which_cat_test_${crypto.randomBytes(4).toString("hex")}`;
const admin = new pg.Client({ connectionString: url("postgres") });
let c: pg.Client;
// A second connection, for the resolve that races a merge (16a).
let c2: pg.Client;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database "${name}"`);
  c = new pg.Client({ connectionString: url(name) });
  await c.connect();
  c2 = new pg.Client({ connectionString: url(name) });
  await c2.connect();
  await migrateUp(c, readMigrations(defaultMigrationsFolder()));
});

afterAll(async () => {
  await c.end();
  await c2.end();
  await admin.query(`drop database if exists "${name}"`);
  await admin.end();
});

// Cat names in letters only (CLAUDE.md, SYC-709): a counter spelt in letters.
let counter = 0;
const letters = (n: number) =>
  [...String(n)].map((d) => "bcdfghjkmp"[Number(d)]).join("");

async function inTx<T>(client: pg.Client, fn: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    const out = await fn();
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
}

async function one<T = Record<string, unknown>>(
  client: pg.Client,
  text: string,
  params: unknown[] = [],
): Promise<T> {
  const r = await client.query(text, params);
  return r.rows[0] as T;
}

async function cat(): Promise<number> {
  const r = await one<{ id: number }>(
    c,
    `insert into cats (name, primary_photo_id, lat, lng, discoverer_device_id)
     values ($1, 1, 37.44, 24.94, 'dev-a') returning id`,
    [`Cat${letters(++counter)}`],
  );
  return r.id;
}

async function sighting(status = "pending", device = "dev-a"): Promise<number> {
  const r = await one<{ id: number }>(
    c,
    `insert into sightings (device_id, photo_id, lat, lng, status)
     values ($1, 1, 37.44, 24.94, $2) returning id`,
    [device, status],
  );
  return r.id;
}

/** A sighting resolved to `catId` the way the resolve route does it. */
async function resolved(catId: number): Promise<number> {
  const id = await sighting();
  await c.query(`update sightings set cat_id = $1, status = 'resolved' where id = $2`, [catId, id]);
  return id;
}

async function sightingRow(id: number) {
  return one<{ cat_id: number | null; status: string; lat: number; device_id: string | null }>(
    c,
    `select * from sightings where id = $1`,
    [id],
  );
}

/** Inserts a move row on `client` and returns its id. */
async function moveRow(
  client: pg.Client,
  sightingId: number,
  from: number,
  to: number,
  extra: { mergeId?: number; reason?: string; batch?: string } = {},
): Promise<number> {
  const reason = extra.reason ?? (extra.mergeId ? "merged" : "wrong_pick");
  const r = await one<{ id: number }>(
    client,
    `insert into sighting_moves
       (sighting_id, from_cat_id, to_cat_id, merge_id, batch_id, reason, source,
        moved_by_account_id, role_at_time)
     values ($1, $2, $3, $4, $5, $6, $7, 'acct-team', 'staff') returning id`,
    [
      sightingId,
      from,
      to,
      extra.mergeId ?? null,
      extra.batch ?? crypto.randomUUID(),
      reason,
      extra.mergeId ? (reason === "merged" ? "merge" : "undo") : "cat_page",
    ],
  );
  return r.id;
}

const setMove = (client: pg.Client, id: number | string) =>
  client.query(`select set_config('app.sighting_move_id', $1, true)`, [String(id)]);
const setMerge = (client: pg.Client, id: number | string) =>
  client.query(`select set_config('app.cat_merge_id', $1, true)`, [String(id)]);
const recat = (client: pg.Client, sightingId: number, to: number) =>
  client.query(`update sightings set cat_id = $1 where id = $2`, [to, sightingId]);

/** A legitimate move: the row, the setting, the change, in one transaction. */
async function move(sightingId: number, from: number, to: number): Promise<number> {
  return inTx(c, async () => {
    const id = await moveRow(c, sightingId, from, to);
    await setMove(c, id);
    await recat(c, sightingId, to);
    return id;
  });
}

async function mergeRow(client: pg.Client, mergedId: number, survivorId: number, supersedes?: number) {
  const r = await one<{ id: number }>(
    client,
    `insert into cat_identity
       (cat_id, canonical_cat_id, supersedes_id, reason_text, by_account_id, role_at_time, survivor_chosen)
     values ($1, $2, $3, 'the same cat', 'acct-team', 'staff', $4) returning id`,
    [mergedId, survivorId, supersedes ?? null, supersedes ? null : "default"],
  );
  return r.id;
}

/** A legitimate merge (§9.7 merge steps 2–3), in raw SQL. */
async function merge(mergedId: number, survivorId: number): Promise<number> {
  return inTx(c, async () => {
    const id = await mergeRow(c, mergedId, survivorId);
    await setMerge(c, id);
    const batch = crypto.randomUUID();
    const rows = await c.query<{ id: number }>(
      `select id from sightings where cat_id = $1 and status = 'resolved' order by id for update`,
      [mergedId],
    );
    for (const s of rows.rows) {
      await moveRow(c, s.id, mergedId, survivorId, { mergeId: id, batch });
      await recat(c, s.id, survivorId);
    }
    return id;
  });
}

/** A legitimate undo: a row naming the cat itself, superseding the merge; its moves go back. */
async function undo(mergeId: number): Promise<number> {
  const m = await one<{ cat_id: number; canonical_cat_id: number }>(
    c,
    `select cat_id, canonical_cat_id from cat_identity where id = $1`,
    [mergeId],
  );
  return inTx(c, async () => {
    const id = await mergeRow(c, m.cat_id, m.cat_id, mergeId);
    await setMerge(c, id);
    const rows = await c.query<{ sighting_id: number }>(
      `select sighting_id from sighting_moves where merge_id = $1 order by sighting_id`,
      [mergeId],
    );
    for (const s of rows.rows) {
      await moveRow(c, s.sighting_id, m.canonical_cat_id, m.cat_id, {
        mergeId: id,
        reason: "merge_undone",
      });
      await recat(c, s.sighting_id, m.cat_id);
    }
    return id;
  });
}

const APPEND_ONLY = /append-only/;
const ADD_ONLY = /add-only/;

describe("today's sighting updates still pass (0046's branches)", () => {
  it("pending -> resolved, awaiting_team -> resolved, the place stamp and redaction", async () => {
    const a = await cat();
    const one1 = await sighting();
    await c.query(
      `update sightings set cat_id = $1, status = 'resolved', area_key = 'ermoupoli', on_island = true where id = $2`,
      [a, one1],
    );
    expect(await sightingRow(one1)).toMatchObject({ cat_id: a, status: "resolved" });

    const two = await sighting();
    await c.query(`update sightings set status = 'awaiting_team' where id = $1`, [two]);
    await c.query(`update sightings set cat_id = $1, status = 'resolved' where id = $2`, [a, two]);
    expect(await sightingRow(two)).toMatchObject({ cat_id: a, status: "resolved" });

    const three = await resolved(a);
    await c.query(`update sightings set area_key = 'off', on_island = true where id = $1`, [three]);
    await c.query(
      `update sightings set device_id = null, redacted_at = now(), redaction_reason = 'deleted' where id = $1`,
      [three],
    );
    expect(await sightingRow(three)).toMatchObject({ cat_id: a, device_id: null });
  });

  it("still refuses a resolved sighting's cat being set again by a status move", async () => {
    const a = await cat();
    const b = await cat();
    const s = await resolved(a);
    await expect(
      c.query(`update sightings set cat_id = $1, status = 'resolved' where id = $2`, [b, s]),
    ).rejects.toThrow(APPEND_ONLY);
  });
});

describe("a recorded move (spec test 1)", () => {
  it("accepts a move with the setting and a fresh move row", async () => {
    const a = await cat();
    const b = await cat();
    const s = await resolved(a);
    await move(s, a, b);
    expect(await sightingRow(s)).toMatchObject({ cat_id: b, status: "resolved" });
  });

  it("accepts a move made inside a savepoint (txid, not xmin)", async () => {
    const a = await cat();
    const b = await cat();
    const s = await resolved(a);
    await inTx(c, async () => {
      await c.query("savepoint inner_move");
      const id = await moveRow(c, s, a, b);
      await setMove(c, id);
      await recat(c, s, b);
      await c.query("release savepoint inner_move");
    });
    expect((await sightingRow(s)).cat_id).toBe(b);
  });

  it("accepts a batch: one move row per sighting, the setting named before each change", async () => {
    const a = await cat();
    const b = await cat();
    const s1 = await resolved(a);
    const s2 = await resolved(a);
    await inTx(c, async () => {
      const batch = crypto.randomUUID();
      for (const s of [s1, s2]) {
        const id = await moveRow(c, s, a, b, { batch });
        await setMove(c, id);
        await recat(c, s, b);
      }
    });
    expect((await sightingRow(s1)).cat_id).toBe(b);
    expect((await sightingRow(s2)).cat_id).toBe(b);
  });

  it("refuses a forged change with no setting", async () => {
    const a = await cat();
    const b = await cat();
    const s = await resolved(a);
    await expect(recat(c, s, b)).rejects.toThrow(APPEND_ONLY);
    // A fresh move row is not enough without the setting.
    await expect(
      inTx(c, async () => {
        await moveRow(c, s, a, b);
        await recat(c, s, b);
      }),
    ).rejects.toThrow(APPEND_ONLY);
    expect((await sightingRow(s)).cat_id).toBe(a);
  });

  it("refuses the setting naming an older move row with the same cats", async () => {
    const a = await cat();
    const b = await cat();
    const s = await resolved(a);
    // Recorded in an earlier transaction, never carried out.
    const old = await inTx(c, () => moveRow(c, s, a, b));
    await expect(
      inTx(c, async () => {
        await setMove(c, old);
        await recat(c, s, b);
      }),
    ).rejects.toThrow(APPEND_ONLY);
    expect((await sightingRow(s)).cat_id).toBe(a);
  });

  it("refuses a move row rolled back to a savepoint, even with the setting put back", async () => {
    const a = await cat();
    const b = await cat();
    const s = await resolved(a);
    await expect(
      inTx(c, async () => {
        await c.query("savepoint gone");
        const id = await moveRow(c, s, a, b);
        await setMove(c, id);
        await c.query("rollback to savepoint gone");
        await setMove(c, id);
        await recat(c, s, b);
      }),
    ).rejects.toThrow(APPEND_ONLY);
    expect((await sightingRow(s)).cat_id).toBe(a);
  });

  it("refuses a move row for another sighting or other cats", async () => {
    const a = await cat();
    const b = await cat();
    const d = await cat();
    const s = await resolved(a);
    const other = await resolved(a);
    await expect(
      inTx(c, async () => {
        await setMove(c, await moveRow(c, other, a, b));
        await recat(c, s, b);
      }),
    ).rejects.toThrow(APPEND_ONLY);
    await expect(
      inTx(c, async () => {
        await setMove(c, await moveRow(c, s, a, d));
        await recat(c, s, b);
      }),
    ).rejects.toThrow(APPEND_ONLY);
    expect((await sightingRow(s)).cat_id).toBe(a);
  });

  it("refuses any other column changing in a move", async () => {
    const a = await cat();
    const b = await cat();
    const s = await resolved(a);
    for (const set of [`lat = 37.45`, `status = 'pending'`, `device_id = 'dev-b'`]) {
      await expect(
        inTx(c, async () => {
          await setMove(c, await moveRow(c, s, a, b));
          await c.query(`update sightings set cat_id = $1, ${set} where id = $2`, [b, s]);
        }),
      ).rejects.toThrow(APPEND_ONLY);
    }
    expect(await sightingRow(s)).toMatchObject({ cat_id: a, status: "resolved", device_id: "dev-a" });
  });

  it("refuses a move of a sighting that isn't resolved", async () => {
    const a = await cat();
    const b = await cat();
    const s = await sighting("pending");
    await expect(
      inTx(c, async () => {
        await setMove(c, await moveRow(c, s, a, b));
        await c.query(`update sightings set cat_id = $1 where id = $2`, [b, s]);
      }),
    ).rejects.toThrow(APPEND_ONLY);
  });
});

describe("a recorded merge (spec test 1, §9.2)", () => {
  it("accepts a merge that moves every resolved sighting to the survivor, and its undo", async () => {
    const survivor = await cat();
    const away = await cat();
    const s1 = await resolved(away);
    const s2 = await resolved(away);
    const id = await merge(away, survivor);
    expect((await sightingRow(s1)).cat_id).toBe(survivor);
    expect((await sightingRow(s2)).cat_id).toBe(survivor);
    await undo(id);
    expect((await sightingRow(s1)).cat_id).toBe(away);
    expect((await sightingRow(s2)).cat_id).toBe(away);
    // Filed under the cat again: it is not merged away now.
    expect(await resolved(away)).toBeGreaterThan(0);
  });

  it("refuses a merge's setting naming an older merge row, even with a fresh move row", async () => {
    const survivor = await cat();
    const away = await cat();
    // An undo from an earlier transaction: its moves would go from the
    // survivor back to `away`.
    const staleUndo = await undo(await merge(away, survivor));
    const s = await resolved(survivor);
    await expect(
      inTx(c, async () => {
        await setMerge(c, staleUndo);
        await moveRow(c, s, survivor, away, { mergeId: staleUndo, reason: "merge_undone" });
        await recat(c, s, away);
      }),
    ).rejects.toThrow(APPEND_ONLY);
    expect((await sightingRow(s)).cat_id).toBe(survivor);
  });

  it("refuses a fresh merge row whose move row was written earlier (its id reserved ahead)", async () => {
    const survivor = await cat();
    const away = await cat();
    const s = await resolved(away);
    const reserved = await inTx(c, async () => {
      const r = await one<{ id: string }>(c, `select nextval(pg_get_serial_sequence('cat_identity', 'id')) as id`);
      await moveRow(c, s, away, survivor, { mergeId: Number(r.id) });
      return Number(r.id);
    });
    await expect(
      inTx(c, async () => {
        await c.query(
          `insert into cat_identity (id, cat_id, canonical_cat_id, by_account_id) values ($1, $2, $3, 'acct-team')`,
          [reserved, away, survivor],
        );
        await setMerge(c, reserved);
        await recat(c, s, survivor);
      }),
    ).rejects.toThrow(APPEND_ONLY);
    expect((await sightingRow(s)).cat_id).toBe(away);
  });

  it("refuses a merge whose sighting has no move row, or a move row for other cats", async () => {
    const survivor = await cat();
    const away = await cat();
    const elsewhere = await cat();
    const s = await resolved(away);
    await expect(
      inTx(c, async () => {
        await setMerge(c, await mergeRow(c, away, survivor));
        await recat(c, s, survivor);
      }),
    ).rejects.toThrow(APPEND_ONLY);
    await expect(
      inTx(c, async () => {
        const id = await mergeRow(c, away, survivor);
        await setMerge(c, id);
        await moveRow(c, s, away, elsewhere, { mergeId: id });
        await recat(c, s, elsewhere);
      }),
    ).rejects.toThrow(APPEND_ONLY);
    expect((await sightingRow(s)).cat_id).toBe(away);
  });

  it("refuses at commit a merge that leaves a resolved sighting on the merged-away cat", async () => {
    const survivor = await cat();
    const away = await cat();
    const s = await resolved(away);
    await expect(inTx(c, () => mergeRow(c, away, survivor))).rejects.toThrow(
      /still has resolved sightings/,
    );
    expect((await sightingRow(s)).cat_id).toBe(away);
    expect(
      (await c.query(`select 1 from cat_identity where cat_id = $1`, [away])).rowCount,
    ).toBe(0);
  });

  it("refuses filing a sighting under a merged-away cat: resolve, new row and move", async () => {
    const survivor = await cat();
    const away = await cat();
    const other = await cat();
    await merge(away, survivor);
    const p = await sighting();
    await expect(
      c.query(`update sightings set cat_id = $1, status = 'resolved' where id = $2`, [away, p]),
    ).rejects.toThrow(/merged into another/);
    await expect(
      c.query(
        `insert into sightings (device_id, photo_id, lat, lng, status, cat_id)
         values ('dev-a', 1, 37.44, 24.94, 'resolved', $1)`,
        [away],
      ),
    ).rejects.toThrow(/merged into another/);
    const s = await resolved(other);
    await expect(
      inTx(c, async () => {
        await setMove(c, await moveRow(c, s, other, away));
        await recat(c, s, away);
      }),
    ).rejects.toThrow(/merged into another/);
    // The survivor takes them.
    await c.query(`update sightings set cat_id = $1, status = 'resolved' where id = $2`, [survivor, p]);
    expect((await sightingRow(p)).cat_id).toBe(survivor);
  });

  it("16a: a resolve racing a merge never leaves a resolved sighting on the merged-away cat", async () => {
    // The resolve gets there first: the merge's deferred check waits for it,
    // sees its sighting, and refuses the merge.
    const survivor = await cat();
    const away = await cat();
    const p = await sighting();
    await c.query("begin");
    await c.query(`update sightings set cat_id = $1, status = 'resolved' where id = $2`, [away, p]);
    await c2.query("begin");
    await mergeRow(c2, away, survivor);
    const mergeCommit = c2.query("commit");
    // Give the merge's commit time to reach the cat lock and wait on it.
    await new Promise((r) => setTimeout(r, 200));
    await c.query("commit");
    await expect(mergeCommit).rejects.toThrow(/still has resolved sightings/);
    expect((await sightingRow(p)).cat_id).toBe(away);
    expect((await c.query(`select 1 from cat_identity where cat_id = $1`, [away])).rowCount).toBe(0);

    // The merge gets there first: the resolve waits for it, sees it, and is
    // refused; the route then files under the survivor (PR 4.1).
    const survivor2 = await cat();
    const away2 = await cat();
    const p2 = await sighting();
    await c2.query("begin");
    await mergeRow(c2, away2, survivor2);
    await c2.query(`set constraints all immediate`);
    await c.query("begin");
    const resolve = c.query(`update sightings set cat_id = $1, status = 'resolved' where id = $2`, [
      away2,
      p2,
    ]);
    await new Promise((r) => setTimeout(r, 200));
    await c2.query("commit");
    await expect(resolve).rejects.toThrow(/merged into another/);
    await c.query("rollback");
    expect((await sightingRow(p2)).cat_id).toBeNull();
  });
});

describe("moves, merges and duplicates are add-only: redaction is the one update", () => {
  it("sighting_moves: refuses an update other than redaction, delete and truncate", async () => {
    const a = await cat();
    const b = await cat();
    const s = await resolved(a);
    const id = await move(s, a, b);
    await expect(c.query(`update sighting_moves set to_cat_id = $1 where id = $2`, [a, id])).rejects.toThrow(ADD_ONLY);
    await expect(c.query(`update sighting_moves set reason_text = 'x' where id = $1`, [id])).rejects.toThrow(ADD_ONLY);
    await expect(
      c.query(`update sighting_moves set moved_by_account_id = 'acct-other' where id = $1`, [id]),
    ).rejects.toThrow(ADD_ONLY);
    await expect(
      c.query(`update sighting_moves set moved_by_account_id = null, redacted_at = now(), txid = 1 where id = $1`, [id]),
    ).rejects.toThrow(ADD_ONLY);
    await expect(c.query(`delete from sighting_moves where id = $1`, [id])).rejects.toThrow(ADD_ONLY);
    await expect(c.query(`truncate sighting_moves`)).rejects.toThrow(/TRUNCATE is not allowed/);
    // Redaction, and running it again.
    await c.query(`update sighting_moves set moved_by_account_id = null, redacted_at = now() where id = $1`, [id]);
    await c.query(`update sighting_moves set moved_by_account_id = null where id = $1`, [id]);
    await expect(
      c.query(`update sighting_moves set redacted_at = now() + interval '1 day' where id = $1`, [id]),
    ).rejects.toThrow(ADD_ONLY);
  });

  it("cat_identity: refuses an update other than redaction, delete and truncate", async () => {
    const survivor = await cat();
    const away = await cat();
    const id = await merge(away, survivor);
    await expect(
      c.query(`update cat_identity set canonical_cat_id = $1 where id = $2`, [away, id]),
    ).rejects.toThrow(ADD_ONLY);
    await expect(c.query(`update cat_identity set reason_text = 'x' where id = $1`, [id])).rejects.toThrow(ADD_ONLY);
    await expect(c.query(`delete from cat_identity where id = $1`, [id])).rejects.toThrow(ADD_ONLY);
    await expect(c.query(`truncate cat_identity`)).rejects.toThrow(/TRUNCATE is not allowed/);
    await c.query(`update cat_identity set by_account_id = null, redacted_at = now() where id = $1`, [id]);
    expect(
      await one(c, `select by_account_id, redacted_at is not null as redacted from cat_identity where id = $1`, [id]),
    ).toEqual({ by_account_id: null, redacted: true });
  });

  it("duplicate_reports, duplicate_decisions, new_cat_checks: add-only, redaction only", async () => {
    const lo = await cat();
    const hi = await cat();
    const report = await one<{ id: number }>(
      c,
      `insert into duplicate_reports (cat_low, cat_high, source, says, device_id, sighting_id)
       values ($1, $2, 'spotter_question', 'same', 'dev-a', 1) returning id`,
      [lo, hi],
    );
    const decision = await one<{ id: number }>(
      c,
      `insert into duplicate_decisions (cat_low, cat_high, decision, by_account_id)
       values ($1, $2, 'different', 'acct-team') returning id`,
      [lo, hi],
    );
    const check = await one<{ id: number }>(
      c,
      `insert into new_cat_checks (cat_id, by_account_id) values ($1, 'acct-team') returning id`,
      [lo],
    );
    const cases = [
      { table: "duplicate_reports", id: report.id, person: "device_id", other: `says = 'different'` },
      { table: "duplicate_decisions", id: decision.id, person: "by_account_id", other: `decision = 'not_sure'` },
      { table: "new_cat_checks", id: check.id, person: "by_account_id", other: `cat_id = ${hi}` },
    ];
    for (const t of cases) {
      await expect(c.query(`update ${t.table} set ${t.other} where id = $1`, [t.id])).rejects.toThrow(ADD_ONLY);
      await expect(
        c.query(`update ${t.table} set ${t.person} = null, redacted_at = now(), ${t.other} where id = $1`, [t.id]),
      ).rejects.toThrow(ADD_ONLY);
      await expect(c.query(`delete from ${t.table} where id = $1`, [t.id])).rejects.toThrow(ADD_ONLY);
      await expect(c.query(`truncate ${t.table}`)).rejects.toThrow(/TRUNCATE is not allowed/);
      await c.query(`update ${t.table} set ${t.person} = null, redacted_at = now() where id = $1`, [t.id]);
    }
  });

  it("refuses a report's pair out of order", async () => {
    const lo = await cat();
    const hi = await cat();
    await expect(
      c.query(
        `insert into duplicate_reports (cat_low, cat_high, source, says) values ($1, $2, 'team', 'same')`,
        [hi, lo],
      ),
    ).rejects.toThrow(/duplicate_reports_pair_ck/);
  });
});

describe("statements a move writes (§9.4, §9.5)", () => {
  async function statement(
    client: pg.Client,
    catId: number,
    sightingId: number,
    extra: { moveId?: number; redacted?: boolean } = {},
  ) {
    return client.query(
      `insert into observations
         (cat_id, kind, value, device_id, sighting_id, observed_at, sighting_move_id, redacted_at, redaction_reason)
       values ($1, 'ear_tip', '{"earTip": true}', $2, $3, now(), $4, $5, $6)`,
      [
        catId,
        extra.redacted ? null : "dev-a",
        sightingId,
        extra.moveId ?? null,
        extra.redacted ? new Date() : null,
        extra.redacted ? "deleted" : null,
      ],
    );
  }

  it("accepts a statement naming the current move, attributed or already redacted", async () => {
    const a = await cat();
    const b = await cat();
    const s = await resolved(a);
    await inTx(c, async () => {
      const id = await moveRow(c, s, a, b);
      await setMove(c, id);
      await recat(c, s, b);
      await statement(c, b, s, { moveId: id });
      await statement(c, b, s, { moveId: id, redacted: true });
    });
    expect((await c.query(`select 1 from observations where sighting_id = $1`, [s])).rowCount).toBe(2);
  });

  it("refuses one with no setting, an older move, or another sighting's move", async () => {
    const a = await cat();
    const b = await cat();
    const s = await resolved(a);
    const other = await resolved(a);
    const old = await inTx(c, () => moveRow(c, s, a, b));
    await expect(statement(c, b, s, { moveId: old })).rejects.toThrow(/naming a move/);
    await expect(
      inTx(c, async () => {
        await setMove(c, old);
        await statement(c, b, s, { moveId: old });
      }),
    ).rejects.toThrow(/naming a move/);
    await expect(
      inTx(c, async () => {
        const id = await moveRow(c, other, a, b);
        await setMove(c, id);
        await statement(c, b, s, { moveId: id });
      }),
    ).rejects.toThrow(/naming a move/);
    // A fresh move of this sighting, but not named by the setting.
    await expect(
      inTx(c, async () => {
        const id = await moveRow(c, s, a, b);
        await statement(c, b, s, { moveId: id });
      }),
    ).rejects.toThrow(/naming a move/);
    // Arriving redacted still needs a move.
    await expect(statement(c, b, s, { redacted: true })).rejects.toThrow(/already redacted/);
  });

  it("still allows an ordinary statement and its redaction, and refuses setting a move id later", async () => {
    const a = await cat();
    const s = await resolved(a);
    const r = await one<{ id: number }>(
      c,
      `insert into observations (cat_id, kind, value, device_id, sighting_id, observed_at)
       values ($1, 'note', '{"text": "hi"}', 'dev-a', $2, now()) returning id`,
      [a, s],
    );
    await expect(
      c.query(`update observations set sighting_move_id = 1 where id = $1`, [r.id]),
    ).rejects.toThrow(APPEND_ONLY);
    await c.query(
      `update observations set device_id = null, redacted_at = now(), redaction_reason = 'deleted', value = '{}' where id = $1`,
      [r.id],
    );
  });
});

describe("points for finding a duplicate (C4, §9.8)", () => {
  const ledger = (device: string, sightingId: number | null, catId: number, pair: [number, number] | null, points = 10) =>
    c.query(
      `insert into points_ledger
         (device_id, sighting_id, duplicate_cat_low, duplicate_cat_high, cat_id, points, athens_day, week_start, source)
       values ($1, $2, $3, $4, $5, $6, '2026-11-02', '2026-11-02', $7)`,
      [device, sightingId, pair?.[0] ?? null, pair?.[1] ?? null, catId, points, sightingId ? "live" : "duplicate"],
    );

  it("pays a duplicate award and a same-day spot of the same cat both, still once a day for spots", async () => {
    await ledger("dev-ledger", null, 5, [4, 5]);
    await ledger("dev-ledger", 900_001, 5, null, 15);
    await expect(ledger("dev-ledger", 900_002, 5, null, 15)).rejects.toThrow(/points_ledger_once_a_day_uq/);
    await ledger("dev-ledger", 900_003, 5, null, 0);
  });

  it("pays a phone once per pair, ever", async () => {
    await ledger("dev-pair", null, 7, [6, 7]);
    await expect(ledger("dev-pair", null, 7, [6, 7])).rejects.toThrow(/points_ledger_duplicate_pair_uq/);
    await ledger("dev-pair-other", null, 7, [6, 7]);
  });

  it("refuses a row that is neither a sighting's award nor a pair's", async () => {
    await expect(ledger("dev-bad", null, 7, null)).rejects.toThrow(/points_ledger_award_ck/);
    await expect(ledger("dev-bad", 900_010, 7, [6, 7])).rejects.toThrow(/points_ledger_award_ck/);
    await expect(ledger("dev-bad", null, 7, [7, 6])).rejects.toThrow(/points_ledger_award_ck/);
  });
});

describe("the bell's new kinds (C5)", () => {
  it("accepts merged and duplicate_points with a message and no cat update", async () => {
    for (const kind of ["merged", "duplicate_points"]) {
      await c.query(`insert into notifications (device_id, kind, message) values ('dev-a', $1, 'words')`, [kind]);
      await expect(
        c.query(`insert into notifications (device_id, kind) values ('dev-a', $1)`, [kind]),
      ).rejects.toThrow(/notifications_kind_ck/);
    }
    await expect(
      c.query(`insert into notifications (device_id, kind, message) values ('dev-a', 'other', 'words')`),
    ).rejects.toThrow(/notifications_kind_ck/);
  });
});
