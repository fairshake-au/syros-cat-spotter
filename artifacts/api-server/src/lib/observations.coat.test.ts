import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool, catsTable } from "@workspace/db";
import { like } from "drizzle-orm";
import { writeObservation } from "./observations";

// SYC-398 A1.2: the write check on a coat (coat-colours-and-pattern.md §6).
// New writes use { colours?, pattern? } or { notSure: true }; old shapes are
// refused from now on, though stored ones are still read (readCoatValue).
// There is no key allow-list: the team keeps `reason` and `agreesWith` in
// the value. Every case goes through writeObservation on a throwaway cat.
//
// observations is append-only: cleanup removes only this file's cats.
const NAME_PREFIX = "VitestCoatWrite";
let catIdCounter = 0;

async function cleanup() {
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function insertCat() {
  catIdCounter += 1;
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}${catIdCounter}`,
      description: "",
      primaryPhotoId: 0,
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: "vitest-coat-discoverer",
    })
    .returning();
  return cat!;
}

type Who = "spotter" | "team" | "management" | "machine";

async function write(catId: number, who: Who, value: unknown, extra: Record<string, unknown> = {}) {
  const author =
    who === "spotter"
      ? { deviceId: "dev-coat", roleAtTime: "public" }
      : who === "team"
        ? { accountId: "staff-coat", roleAtTime: "staff" }
        : who === "management"
          ? { accountId: "manager-coat", roleAtTime: "management" }
          : { accountId: "system:vision", roleAtTime: "system", provenance: "machine" };
  return writeObservation(db, {
    catId,
    kind: "coat",
    value,
    observedAt: new Date(),
    ...author,
    ...extra,
  } as Parameters<typeof writeObservation>[1]);
}

const malformed = { code: "MALFORMED_VALUE" };

describe("coat write check: accepted", () => {
  const cases: [string, Who, unknown][] = [
    ["a spotter's colours and pattern", "spotter", { colours: ["brown", "ginger"], pattern: "stripes" }],
    ["a spotter with all five colours", "spotter", { colours: ["black", "grey", "brown", "ginger", "white"] }],
    ["a spotter's Not sure", "spotter", { notSure: true }],
    ["a team pattern alone, with its reason", "team", { pattern: "plain", reason: "x" }],
    ["a team Confirm's colours, with reason and agreesWith", "team", { colours: ["ginger"], reason: "x", agreesWith: 12 }],
    ["a machine's colours", "machine", { colours: ["grey"], modelVersion: "m" }],
    ["a machine's pattern alone", "machine", { pattern: "stripes", modelVersion: "m" }],
    ["a machine's Not sure", "machine", { notSure: true, modelVersion: "m" }],
  ];
  for (const [label, who, value] of cases) {
    it(label, async () => {
      const cat = await insertCat();
      const row = await write(cat.id, who, value);
      expect(row.kind).toBe("coat");
      expect(row.value).toEqual(value);
    });
  }
});

describe("coat write check: refused", () => {
  const cases: [string, Who, unknown][] = [
    ["the old shape tabby", "spotter", { colours: ["tabby"] }],
    ["the old shape black_and_white", "team", { colours: ["black_and_white"] }],
    ["the old shape not_sure", "spotter", { colours: ["not_sure"] }],
    ["the old shape tortoiseshell_or_calico", "team", { colours: ["tortoiseshell_or_calico"] }],
    ["an old machine v1 reading", "machine", { colours: ["ginger", "tabby"], modelVersion: "m" }],
    ["an unknown colour", "team", { colours: ["purple"] }],
    ["a duplicate colour", "spotter", { colours: ["ginger", "ginger"] }],
    ["an empty colour list", "team", { colours: [] }],
    ["colours that are not a list", "team", { colours: "ginger" }],
    ["an unknown pattern", "team", { pattern: "spots" }],
    ["the pattern Not stated sent as a code", "team", { colours: ["grey"], pattern: "none" }],
    ["nothing at all", "team", {}],
    ["a reason alone", "team", { reason: "x" }],
    ["a spotter's pattern without colours", "spotter", { pattern: "stripes" }],
    ["a team Not sure", "team", { notSure: true, reason: "x" }],
    ["a manager's Not sure", "management", { notSure: true }],
    ["notSure with colours", "spotter", { notSure: true, colours: ["ginger"] }],
    ["notSure with a pattern", "machine", { notSure: true, pattern: "plain", modelVersion: "m" }],
    ["notSure that isn't true", "spotter", { notSure: false, colours: ["ginger"] }],
    ["modelVersion on a spotter's coat", "spotter", { colours: ["ginger"], modelVersion: "m" }],
    ["modelVersion on a team coat", "team", { colours: ["ginger"], modelVersion: "m" }],
    ["a machine coat without modelVersion", "machine", { colours: ["ginger"] }],
    ["a machine coat with an empty modelVersion", "machine", { colours: ["ginger"], modelVersion: "" }],
  ];
  for (const [label, who, value] of cases) {
    it(label, async () => {
      const cat = await insertCat();
      await expect(write(cat.id, who, value)).rejects.toMatchObject(malformed);
    });
  }
});

describe("coat retraction", () => {
  it("is refused when it carries a pattern or notSure", async () => {
    const cat = await insertCat();
    const base = await write(cat.id, "team", { colours: ["ginger"] });
    for (const value of [
      { retracted: true, pattern: "plain" },
      { retracted: true, notSure: true },
    ]) {
      await expect(write(cat.id, "team", value, { supersedesId: base.id })).rejects.toMatchObject(malformed);
    }
  });

  it("is accepted alone, tolerating a reason", async () => {
    const cat = await insertCat();
    const base = await write(cat.id, "team", { colours: ["ginger"], pattern: "stripes" });
    const row = await write(cat.id, "team", { retracted: true, reason: "wrong cat" }, { supersedesId: base.id });
    expect(row.supersedesId).toBe(base.id);
  });
});
