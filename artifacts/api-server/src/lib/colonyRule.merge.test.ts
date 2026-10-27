import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { catIdentityTable, catsTable, db, observationsTable, pool } from "@workspace/db";
import { currentColonyOf } from "./colonyMembership";
import { movedAwayNotices } from "./movedAway";
import { colonyAfterMarkingWrong } from "./teamCorrections";
import { newColony } from "../test/roleKit";

// SYC-410 PR 1.2 (review): one colony rule in every reader. For a cat with
// cats merged into her, the nearest record with a colony statement decides
// (her own; else the cats merged straight into her; else those merged into
// them), and among records the same distance away, the newest. Spec 4.1:
// "Mimi is in Ano Syros and Agatha in Vaporia. After merging she'll show as
// Vaporia." currentColonyOf, movedAwayNotices and colonyAfterMarkingWrong must
// agree, and a merge is never news ("Agatha has moved").

const NAME_PREFIX = "VitestColonyRule";
const LETTERS = "bcdfghjkmpqrvwxz";
let counter = 0;
const tag = () => {
  counter += 1;
  let n = counter;
  let out = "";
  do {
    out = LETTERS[n % 16] + out;
    n = Math.floor(n / 16);
  } while (n > 0);
  return out;
};
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function cleanup() {
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}
beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function cat(label: string): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({ name: `${NAME_PREFIX}${label}${tag()}`, primaryPhotoId: 0, lat: 37.44, lng: 24.94, discovererDeviceId: "vitest-colony-rule" })
    .returning({ id: catsTable.id });
  return c!.id;
}

async function colonyStatement(catId: number, colonyId: number, days: number): Promise<number> {
  const [row] = await db
    .insert(observationsTable)
    .values({
      catId,
      kind: "colony",
      value: { colonyId },
      accountId: "vitest-colony-rule-staff",
      roleAtTime: "staff",
      observedAt: daysAgo(days),
      createdAt: daysAgo(days),
    })
    .returning({ id: observationsTable.id });
  return row!.id;
}

const merge = async (from: number, into: number) =>
  (await db.insert(catIdentityTable).values({ catId: from, canonicalCatId: into, reason: "vitest colony rule" }).returning({ id: catIdentityTable.id }))[0]!.id;
const undo = (mergeId: number, catId: number) =>
  db.insert(catIdentityTable).values({ catId, canonicalCatId: catId, supersedesId: mergeId, reason: "vitest colony rule undo" });

describe("the colony rule is the same in every reader", () => {
  it("movedAwayNotices: merging a newer-in-G Mimi into an older-in-A Agatha is not news", async () => {
    const [a, g] = [await newColony(`${NAME_PREFIX}A${tag()}`), await newColony(`${NAME_PREFIX}G${tag()}`)];
    const agatha = await cat("Agatha");
    const mimi = await cat("Mimi");
    await colonyStatement(agatha, a, 50);
    await colonyStatement(mimi, g, 1);
    const guardian = { id: "vitest-colony-rule-guardian", scopes: [{ role: "guardian", colonyId: a }] };
    expect((await movedAwayNotices(guardian)).filter((n) => n.catId === agatha)).toEqual([]);
    const m = await merge(mimi, agatha);
    // The cat she is now keeps her own colony, so she is still in A...
    expect((await currentColonyOf([agatha])).get(agatha)).toBe(a);
    // ...and nothing says she has moved.
    expect((await movedAwayNotices(guardian)).filter((n) => n.catId === agatha)).toEqual([]);
    await undo(m, mimi);
    expect((await movedAwayNotices(guardian)).filter((n) => n.catId === agatha)).toEqual([]);
  });

  it("colonyAfterMarkingWrong lands where currentColonyOf would have said had the statement never been made", async () => {
    const [a, g, x] = [
      await newColony(`${NAME_PREFIX}A${tag()}`),
      await newColony(`${NAME_PREFIX}G${tag()}`),
      await newColony(`${NAME_PREFIX}X${tag()}`),
    ];
    const agatha = await cat("Agatha");
    const mimi = await cat("Mimi");
    await colonyStatement(agatha, a, 50);
    const xRow = await colonyStatement(agatha, x, 5);
    await colonyStatement(mimi, g, 40);
    const [original] = await db.select().from(observationsTable).where(eq(observationsTable.id, xRow));
    const m = await merge(mimi, agatha);
    expect((await colonyAfterMarkingWrong(db as never, original!)).colonyId).toBe(a);
    await undo(m, mimi);
    expect((await colonyAfterMarkingWrong(db as never, original!)).colonyId).toBe(a);
  });

  it("colonyAfterMarkingWrong: when she has no other statement, the cat merged into her decides; after the undo, none", async () => {
    const [g, x] = [await newColony(`${NAME_PREFIX}G${tag()}`), await newColony(`${NAME_PREFIX}X${tag()}`)];
    const agatha = await cat("Agatha");
    const mimi = await cat("Mimi");
    const xRow = await colonyStatement(agatha, x, 5);
    await colonyStatement(mimi, g, 40);
    const [original] = await db.select().from(observationsTable).where(eq(observationsTable.id, xRow));
    expect((await colonyAfterMarkingWrong(db as never, original!)).colonyId).toBeNull();
    const m = await merge(mimi, agatha);
    expect((await colonyAfterMarkingWrong(db as never, original!)).colonyId).toBe(g);
    await undo(m, mimi);
    expect((await colonyAfterMarkingWrong(db as never, original!)).colonyId).toBeNull();
  });

  it("a chain: Dora with none takes Agatha's colony before Mimi's, even when Mimi's is newer", async () => {
    const [a, g] = [await newColony(`${NAME_PREFIX}A${tag()}`), await newColony(`${NAME_PREFIX}G${tag()}`)];
    const dora = await cat("Dora");
    const agatha = await cat("Agatha");
    const mimi = await cat("Mimi");
    await colonyStatement(agatha, a, 50);
    await colonyStatement(mimi, g, 1);
    const m1 = await merge(mimi, agatha);
    const m2 = await merge(agatha, dora);
    expect((await currentColonyOf([dora])).get(dora)).toBe(a);
    // Undo Agatha → Dora: Dora has no records of her own left to read.
    await undo(m2, agatha);
    expect((await currentColonyOf([dora])).has(dora)).toBe(false);
    expect((await currentColonyOf([agatha])).get(agatha)).toBe(a);
    await undo(m1, mimi);
  });
});
