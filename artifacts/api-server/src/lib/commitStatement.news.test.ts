import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  catSubscriptionsTable,
  catsTable,
  catUpdatesTable,
  db,
  findPersonById,
  markLeft,
  notificationsTable,
  observationsTable,
  pool,
  pushTokensTable,
  type PersonWithScopes,
} from "@workspace/db";

const sendPushNotificationMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./push", () => ({ sendPushNotification: sendPushNotificationMock }));

/** Flip to make the fan-out throw (review r2-m2). The real one runs otherwise. */
const fanOut = vi.hoisted(() => ({ fail: false }));
vi.mock("./notificationFanout", async (importOriginal) => {
  const real = await importOriginal<typeof import("./notificationFanout")>();
  return {
    ...real,
    fanOutNotifications: async (...args: Parameters<typeof real.fanOutNotifications>) => {
      if (fanOut.fail) throw new Error("vt: fan-out is down");
      return real.fanOutNotifications(...args);
    },
  };
});

import {
  commitStatement,
  inStatementTransaction,
  sterilisedNewsMessage,
  type Tx,
} from "./commitStatement";
import { insertCatUpdate } from "./notificationFanout";
import type { WriteObservationInput } from "./observations";
import { guardianSaysSterilised } from "./guardianStatements";
import { recordTeamStatement, supersedeStatement } from "./teamCorrections";
import { removeTestPerson } from "../test/removeTestPerson";
import { guardianOn, newColony, RUN, seedCat, signedPerson, type Signed } from "../test/roleKit";

// SYC-53 PR 2.2, B1: the one-time "sterilised" news (plan tests T12a-1 to
// T12a-9; roles spec §7.2; Samuel 12 and 13 Oct 2026: in the app and by push,
// once per cat, ever, whoever's statement made the cat Confirmed).
//
// Each test follows its cat with a device that has a push token, and counts
// three things for that cat only: `desexed` cat updates, in-app notification
// rows, and pushes (the push module is mocked).

let colony: number;
let eleniS: Signed;
let teamS: Signed;
let mgmtS: Signed;
let eleni: PersonWithScopes;
let team: PersonWithScopes;
let mgmt: PersonWithScopes;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = "vitest-news-key-0123456789abcdef-0123456789abc";
  colony = await newColony("news");
  eleniS = await guardianOn("news-eleni", [colony]);
  teamS = await signedPerson("news-team", ["staff"]);
  mgmtS = await signedPerson("news-mgmt", ["staff"]);
  await pool.query("update person_scopes set role = 'management' where person_id = $1", [mgmtS.id]);
  eleni = (await findPersonById(eleniS.id))!;
  team = (await findPersonById(teamS.id))!;
  mgmt = (await findPersonById(mgmtS.id))!;
});

beforeEach(() => {
  sendPushNotificationMock.mockClear();
});

/**
 * People who wrote statements keep them (the record is add-only), so they
 * can't be removed: their roles are taken away (so no stray manager is left
 * for the next file's "last manager" tests) and they are marked as left.
 * Everyone else is removed.
 */
async function cleanUp(p: { email: string; id: string } | undefined): Promise<void> {
  if (!p) return;
  if (await removeTestPerson(p.email).then(() => true, () => false)) return;
  await pool.query("delete from person_scopes where person_id = $1", [p.id]);
  await markLeft(p.email, "cli:vitest");
}

afterAll(async () => {
  for (const p of [eleniS, teamS, mgmtS]) await cleanUp(p);
});

let deviceN = 0;

/** A cat in the colony, followed by a device with a push token. */
async function followedCat(): Promise<{ id: number; device: string; name: string }> {
  const cat = await seedCat(colony);
  const device = `vt-news-follower-${RUN}-${++deviceN}`;
  await db.insert(catSubscriptionsTable).values({ deviceId: device, catId: cat.id });
  await db.insert(pushTokensTable).values({ deviceId: device, token: `ExponentPushToken[vt-${device}]` });
  const [c] = await db.select({ name: catsTable.name }).from(catsTable).where(eq(catsTable.id, cat.id));
  return { id: cat.id, device, name: c!.name };
}

async function updatesOf(catId: number) {
  return db
    .select()
    .from(catUpdatesTable)
    .where(and(eq(catUpdatesTable.catId, catId), eq(catUpdatesTable.updateType, "desexed")));
}

async function notificationsOf(catId: number) {
  const ids = (await updatesOf(catId)).map((u) => u.id);
  if (ids.length === 0) return [];
  return db.select().from(notificationsTable).where(inArray(notificationsTable.catUpdateId, ids));
}

/** Pushes about this cat. The push is fire-and-forget, so give it a moment. */
async function pushesFor(catId: number, expected: number): Promise<number> {
  const count = () =>
    sendPushNotificationMock.mock.calls.filter((c) => {
      const data = (c as unknown[])[3] as { catId?: number } | undefined;
      return data?.catId === catId;
    }).length;
  if (expected > 0) await vi.waitFor(() => expect(count()).toBe(expected), { timeout: 3000 });
  else await new Promise((r) => setTimeout(r, 150));
  return count();
}

/** What announcing once looks like for one cat: one update, one in-app row, one push. */
async function expectAnnouncedOnce(cat: { id: number; device: string; name: string }) {
  const updates = await updatesOf(cat.id);
  expect(updates).toHaveLength(1);
  expect(updates[0]!.message).toBe(sterilisedNewsMessage(cat.name));
  const rows = await notificationsOf(cat.id);
  expect(rows.map((r) => r.deviceId)).toEqual([cat.device]);
  expect(await pushesFor(cat.id, 1)).toBe(1);
}

async function expectSilent(catId: number) {
  expect(await updatesOf(catId)).toHaveLength(0);
  expect(await notificationsOf(catId)).toHaveLength(0);
  expect(await pushesFor(catId, 0)).toBe(0);
}

/**
 * Stands in for a vet's or an owner's future route (SYC-24, SYC-130): the
 * row as it would be written, through commitStatement, which is the point.
 */
const rawWrite = async (tx: Tx, input: WriteObservationInput) => {
  const [row] = await tx
    .insert(observationsTable)
    .values({
      catId: input.catId,
      kind: input.kind,
      value: input.value as object,
      deviceId: input.deviceId ?? null,
      accountId: input.accountId ?? null,
      roleAtTime: input.roleAtTime,
      authorityScope: input.authorityScope ?? "none",
      provenance: input.provenance ?? "volunteered",
      observedAt: input.observedAt,
      supersedesId: input.supersedesId ?? null,
    })
    .returning();
  return row!;
};

function asVet(catId: number, yes: boolean, observedAt = new Date()) {
  return inStatementTransaction((tx, news) =>
    commitStatement(
      tx,
      { catId, kind: "sterilised", value: { sterilised: yes }, accountId: `vt-news-vet-${RUN}`, roleAtTime: "vet", observedAt },
      news,
      new Date(),
      rawWrite,
    ),
  );
}

function asOwner(catId: number, yes: boolean, observedAt = new Date()) {
  return inStatementTransaction((tx, news) =>
    commitStatement(
      tx,
      {
        catId,
        kind: "sterilised",
        value: { sterilised: yes },
        deviceId: `vt-news-owner-${RUN}`,
        roleAtTime: "public",
        authorityScope: "owner_of_this_cat",
        observedAt,
      },
      news,
      new Date(),
      rawWrite,
    ),
  );
}

const teamSays = (who: PersonWithScopes, catId: number, yes: boolean, observedAt?: Date) =>
  recordTeamStatement(who, { catId, kind: "sterilised", value: { sterilised: yes }, reason: "Clinic list", observedAt });

/** A row nobody announced: an imported Syros Cats record (the PR 3 backfill wrote these). */
async function imported(catId: number, yes: boolean, observedAt: Date) {
  const [row] = await db
    .insert(observationsTable)
    .values({
      catId,
      kind: "sterilised",
      value: { sterilised: yes },
      accountId: "system:legacy-backfill",
      roleAtTime: "system",
      provenance: "import",
      observedAt,
    })
    .returning({ id: observationsTable.id });
  return row!.id;
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

describe("T12a-1 announces_once_on_first_confirmed", () => {
  it("the team", async () => {
    const cat = await followedCat();
    await teamSays(team, cat.id, true);
    await expectAnnouncedOnce(cat);
  });

  it("management", async () => {
    const cat = await followedCat();
    await teamSays(mgmt, cat.id, true);
    await expectAnnouncedOnce(cat);
  });

  it("a vet (fixture writer)", async () => {
    const cat = await followedCat();
    await asVet(cat.id, true);
    await expectAnnouncedOnce(cat);
  });

  it("a cat guardian, through her own function", async () => {
    const cat = await followedCat();
    await guardianSaysSterilised(eleni, cat.id, true);
    await expectAnnouncedOnce(cat);
  });

  it("an owner (fixture writer)", async () => {
    const cat = await followedCat();
    await asOwner(cat.id, true);
    await expectAnnouncedOnce(cat);
  });
});

describe("T12a-2 no_repeat", () => {
  it("a second confirmation by someone else adds no second update or notification", async () => {
    const cat = await followedCat();
    await teamSays(team, cat.id, true);
    await guardianSaysSterilised(eleni, cat.id, true);
    await teamSays(mgmt, cat.id, true);
    await expectAnnouncedOnce(cat);
  });

  it("Confirmed, then marked wrong, then Confirmed again: told once, ever", async () => {
    // Probe: drop the already-announced check → red.
    const cat = await followedCat();
    const first = await teamSays(team, cat.id, true);
    await supersedeStatement(team, { id: first.id, value: { sterilised: false }, reason: "Wrong cat" });
    await teamSays(mgmt, cat.id, true);
    await expectAnnouncedOnce(cat);
  });

  it("a cat already Confirmed by an imported record (never announced) is not announced by a later confirmation", async () => {
    // Probe: drop the transition check (announce on every Confirmed write) → red.
    const cat = await followedCat();
    await imported(cat.id, true, ago(60 * 24 * 365));
    await teamSays(team, cat.id, true);
    await guardianSaysSterilised(eleni, cat.id, true);
    await expectSilent(cat.id);
  });
});

describe("T12a-3 non_transitions_silent", () => {
  it("an ear tip, a guardian's in-person clip (a field check), and a guardian's 'isn't' announce nothing", async () => {
    const cat = await followedCat();
    await inStatementTransaction((tx, news) =>
      commitStatement(
        tx,
        { catId: cat.id, kind: "ear_tip", value: { clipped: true }, accountId: team.id, roleAtTime: "staff", observedAt: new Date() },
        news,
      ),
    );
    await inStatementTransaction((tx, news) =>
      commitStatement(
        tx,
        {
          catId: cat.id,
          kind: "ear_tip",
          value: { clipped: true },
          accountId: eleni.id,
          roleAtTime: "guardian",
          authorityScope: `colony:${colony}`,
          observedAt: new Date(),
        },
        news,
      ),
    );
    await guardianSaysSterilised(eleni, cat.id, false);
    await expectSilent(cat.id);
  });

  it("a guardian's 'sterilised' that a vet's record overrides announces nothing", async () => {
    // The vet's "not sterilised" is dated after her word, so it outranks it
    // whichever came first (SYC-315 B only lets a NEWER "sterilised" through).
    const cat = await followedCat();
    await asVet(cat.id, false, new Date(Date.now() + 2 * 60_000));
    await guardianSaysSterilised(eleni, cat.id, true);
    await expectSilent(cat.id);
  });

  it("changed by SYC-315 B: her 'sterilised' after a vet's OLDER 'not sterilised' makes the cat Confirmed, so it announces", async () => {
    const cat = await followedCat();
    await asVet(cat.id, false, ago(60));
    await guardianSaysSterilised(eleni, cat.id, true);
    await expectAnnouncedOnce(cat);
  });
});

describe("T12a-4 wrong_exposes_earlier", () => {
  it("marking a wrong 'not sterilised' so that an earlier 'sterilised' stands announces once", async () => {
    const cat = await followedCat();
    await imported(cat.id, true, ago(60 * 24 * 30));
    const no = await teamSays(team, cat.id, false);
    await expectSilent(cat.id);
    await supersedeStatement(team, { id: no.id, value: { sterilised: true }, reason: "That was another cat" });
    await expectAnnouncedOnce(cat);
  });
});

describe("T12a-5 concurrent", () => {
  it("two confirmations at the same moment make exactly one update", async () => {
    // Probe: drop the row lock → red, every time, on the real check (review
    // m3, r2-m1). A third connection holds a SHARE lock on cat_updates, which
    // lets every read through and blocks only the news row's INSERT. With
    // commitStatement's cat lock, one writer per cat reaches that INSERT and
    // the other queues on the cat. Without it, both writers of a cat read "not
    // yet Confirmed" and both queue at the INSERT, so both announce once the
    // hold ends. Four cats, eight writers: with the holder and the check below,
    // that is the pool's ten connections.
    const cats = await Promise.all([1, 2, 3, 4].map(() => followedCat()));
    const holder = await pool.connect();
    let writes: Promise<unknown> | undefined;
    try {
      await holder.query("begin");
      await holder.query("lock table cat_updates in share mode");
      writes = Promise.allSettled(cats.flatMap((cat) => [teamSays(team, cat.id, true), teamSays(mgmt, cat.id, true)]));
      // Let go once all eight are queued on a lock (or after 10 s whatever
      // happened), then judge by the result, never by this wait.
      const deadline = Date.now() + 10_000;
      for (;;) {
        const r = await pool.query<{ n: string }>(
          "select count(*) as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
        );
        if (Number(r.rows[0]!.n) >= 8 || Date.now() > deadline) break;
        await new Promise((res) => setTimeout(res, 50));
      }
      await holder.query("commit");
    } catch (err) {
      await holder.query("rollback").catch(() => {});
      throw err;
    } finally {
      holder.release();
      await writes;
    }
    for (const cat of cats) expect(await updatesOf(cat.id), `cat ${cat.id}`).toHaveLength(1);
    // And a guardian and the team at the same moment.
    const more = await Promise.all([1, 2].map(() => followedCat()));
    await Promise.all(more.flatMap((cat) => [guardianSaysSterilised(eleni, cat.id, true), teamSays(team, cat.id, true)]));
    for (const cat of more) expect(await updatesOf(cat.id), `cat ${cat.id}`).toHaveLength(1);
  });
});

describe("T12a-6 no_email", () => {
  it("no mail_outbox row of any purpose is created", async () => {
    const maxId = async () =>
      Number((await pool.query<{ m: number | null }>("select max(id) as m from mail_outbox")).rows[0]!.m ?? 0);
    const before = await maxId();
    const cat = await followedCat();
    await guardianSaysSterilised(eleni, cat.id, true);
    await expectAnnouncedOnce(cat);
    expect(await maxId()).toBe(before);
  });
});

describe("T12a-7 rolled_back_sends_nothing", () => {
  it("a write that fails after the news row is inserted leaves no update and no notification", async () => {
    // Probe: send the push inside the transaction → red.
    const cat = await followedCat();
    await expect(
      inStatementTransaction(async (tx, news) => {
        await commitStatement(
          tx,
          { catId: cat.id, kind: "sterilised", value: { sterilised: true }, accountId: team.id, roleAtTime: "staff", observedAt: new Date() },
          news,
        );
        expect(news).toHaveLength(1);
        throw new Error("something after the news row failed");
      }),
    ).rejects.toThrow("something after the news row failed");
    await expectSilent(cat.id);
  });
});

describe("a failed fan-out after the save (review m4, r2-m2)", () => {
  it("is logged, not thrown: her statement is saved and the once-ever update stands", async () => {
    // Probe: let sendNews rethrow → red.
    const cat = await followedCat();
    fanOut.fail = true;
    try {
      const row = await guardianSaysSterilised(eleni, cat.id, true);
      expect(row.kind).toBe("sterilised");
    } finally {
      fanOut.fail = false;
    }
    expect(await updatesOf(cat.id)).toHaveLength(1);
    expect(await notificationsOf(cat.id)).toHaveLength(0);
  });
});

describe("T12a-8 old_owner_key_update_counts", () => {
  it("a cat that already has a desexed update from the owner-key route is not announced again", async () => {
    const cat = await followedCat();
    const [row] = await db.select().from(catsTable).where(eq(catsTable.id, cat.id));
    await insertCatUpdate(db, { cat: row!, updateType: "desexed", message: "Old owner-key news" });
    await teamSays(team, cat.id, true);
    const updates = await updatesOf(cat.id);
    expect(updates.map((u) => u.message)).toEqual(["Old owner-key news"]);
    expect(await notificationsOf(cat.id)).toHaveLength(0);
    expect(await pushesFor(cat.id, 0)).toBe(0);
  });
});

describe("T12a-9 deceased_cat_skipped", () => {
  it("a cat recorded as deceased gets no notification and no push", async () => {
    const cat = await followedCat();
    await recordTeamStatement(team, { catId: cat.id, kind: "life_status", value: { status: "deceased" }, reason: "Found" });
    await teamSays(team, cat.id, true);
    // The once-ever record is kept; nobody is told.
    expect(await updatesOf(cat.id)).toHaveLength(1);
    expect(await notificationsOf(cat.id)).toHaveLength(0);
    expect(await pushesFor(cat.id, 0)).toBe(0);
  });
});
