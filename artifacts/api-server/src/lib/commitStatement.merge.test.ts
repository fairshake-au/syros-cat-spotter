import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { catIdentityTable, catsTable, catUpdatesTable, db, observationsTable, pool } from "@workspace/db";

vi.mock("./push", () => ({ sendPushNotification: vi.fn(async () => {}) }));

import { commitStatement, inStatementTransaction } from "./commitStatement";
import { insertCatUpdate } from "./notificationFanout";
import { RUN, seedCat } from "../test/roleKit";

// SYC-410 PR 1.2 (review): "announced as sterilised" is once per animal, ever
// (T12a-8). A `desexed` cat update on a cat merged into another counts for the
// cat she is now; after the undo it does not.

afterAll(async () => {
  await pool.end();
});

async function sayVetSterilised(catId: number) {
  let news = 0;
  await inStatementTransaction(async (tx, queued) => {
    await commitStatement(
      tx,
      { catId, kind: "sterilised", value: { sterilised: true }, accountId: `vt-merge-vet-${RUN}`, roleAtTime: "vet", observedAt: new Date() },
      queued,
      new Date(),
      async (t, input) => {
        const [row] = await t
          .insert(observationsTable)
          .values({
            catId: input.catId,
            kind: input.kind,
            value: input.value as object,
            accountId: input.accountId ?? null,
            roleAtTime: input.roleAtTime,
            authorityScope: "none",
            provenance: "volunteered",
            observedAt: input.observedAt,
          })
          .returning();
        return row!;
      },
    );
    news = queued.length;
  });
  return news;
}

async function pair(how: "alone" | "merged" | "merged then undone") {
  const mimi = await seedCat(null);
  const agatha = await seedCat(null);
  const [mimiRow] = await db.select().from(catsTable).where(eq(catsTable.id, mimi.id));
  await insertCatUpdate(db, { cat: mimiRow!, updateType: "desexed", message: "Old news about Mimi" });
  if (how !== "alone") {
    const [m] = await db
      .insert(catIdentityTable)
      .values({ catId: mimi.id, canonicalCatId: agatha.id, reason: "vitest announce once" })
      .returning({ id: catIdentityTable.id });
    if (how === "merged then undone") {
      await db.insert(catIdentityTable).values({ catId: mimi.id, canonicalCatId: mimi.id, supersedesId: m!.id, reason: "vitest announce once undo" });
    }
  }
  return agatha;
}

describe("announce once survives a merge", () => {
  it("announces Agatha as sterilised when Mimi (not merged in) was announced", async () => {
    const agatha = await pair("alone");
    expect(await sayVetSterilised(agatha.id)).toBe(1);
  });

  it("does not announce Agatha again when Mimi, merged into her, already was", async () => {
    const agatha = await pair("merged");
    expect(await sayVetSterilised(agatha.id)).toBe(0);
    const updates = await db
      .select()
      .from(catUpdatesTable)
      .where(and(eq(catUpdatesTable.catId, agatha.id), eq(catUpdatesTable.updateType, "desexed")));
    expect(updates).toHaveLength(0);
  });

  it("announces her again once the merge is undone", async () => {
    const agatha = await pair("merged then undone");
    expect(await sayVetSterilised(agatha.id)).toBe(1);
  });
});
