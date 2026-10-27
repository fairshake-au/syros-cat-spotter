import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catIdentityTable, catsTable, db, observationsTable, pool } from "@workspace/db";
import { like } from "drizzle-orm";
import { loadCatRecords } from "./observations";
import { resolveCoatParts } from "./resolve";

// SYC-410 PR 1.2, R1 (which-cat-is-which.md §4.2): a merged-in cat's coat and
// markings never reach the cat she was merged into; her other statements do.
// Rows go straight into cat_identity (append-only: they stay, naming only this
// file's deleted cats, and the throwaway database goes at the end of the run).

const NAME_PREFIX = "VitestIdentityLook";
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

async function cleanup() {
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}
beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function cat(): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({ name: `${NAME_PREFIX}${tag()}`, primaryPhotoId: 0, lat: 37.44, lng: 24.94, discovererDeviceId: "vitest-identity-look" })
    .returning({ id: catsTable.id });
  return c!.id;
}

async function say(catId: number, kind: string, value: object) {
  await db.insert(observationsTable).values({
    catId,
    kind,
    value,
    accountId: "vitest-identity-look-staff",
    roleAtTime: "staff",
    observedAt: new Date(Date.now() - 86_400_000),
  });
}

describe("R1: coat and markings stay the staying record's own", () => {
  it("merge: the survivor keeps her own coat, still counts Mimi's other statements; after the undo nothing changed", async () => {
    const mimi = await cat();
    const agatha = await cat();
    await say(mimi, "coat", { colours: ["ginger"], pattern: "stripes" });
    await say(mimi, "markings", { marks: ["white_paws"] });
    await say(mimi, "sterilised", { sterilised: true });
    await say(agatha, "coat", { colours: ["black"], pattern: "plain" });

    const look = async (id: number) => {
      const r = (await loadCatRecords([id])).get(id)!;
      return {
        kinds: r.observations.map((o) => `${o.catId === id ? "own" : "merged"}:${o.kind}`).sort(),
        colours: resolveCoatParts(r.observations).colours.value,
      };
    };

    const before = await look(agatha);
    expect(before.kinds).toEqual(["own:coat"]);
    expect(before.colours).toEqual(["black"]);

    const [m] = await db
      .insert(catIdentityTable)
      .values({ catId: mimi, canonicalCatId: agatha, reason: "vitest look" })
      .returning({ id: catIdentityTable.id });
    const merged = await look(agatha);
    expect(merged.kinds).toEqual(["merged:sterilised", "own:coat"]);
    expect(merged.colours).toEqual(["black"]);
    // Mimi's own page still reads her own coat.
    expect((await look(mimi)).colours).toEqual(["ginger"]);

    await db.insert(catIdentityTable).values({ catId: mimi, canonicalCatId: mimi, supersedesId: m!.id, reason: "vitest look undo" });
    expect(await look(agatha)).toEqual(before);
  });
});
