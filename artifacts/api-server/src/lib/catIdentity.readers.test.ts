import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  catIdentityTable,
  catsTable,
  db,
  observationsTable,
  photosTable,
  pool,
  sightingMatchesTable,
  sightingsTable,
} from "@workspace/db";
import { like } from "drizzle-orm";

// The coat reader is imported through coatReading/due.ts; no call is ever made.
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import { deleteTestSightings } from "../test/sightings";
import { catTarget } from "./capabilityTargets";
import { claimEligibility, hasMetCat } from "./claiming";
import { catsDueForReading } from "./coatReading/due";
import { loadCatRecords } from "./observations";
import { resolveCat } from "./resolve";
import { loadTeamCats } from "./teamCatList";

// SYC-410 (which-cat-is-which.md §9.3; spec test 15's core, and test 16):
// every reader of merges, given rows inserted directly into cat_identity, for
// a merge, a merge then undo, a chain of two, and a loop. Each reader gets
// its own test per case, so a broken rule turns every reader it reaches red.
//
// The cast: Mimi (sterilised, in colony M, seen by one phone), Agatha (colony
// A) and Dora (colony D), each with a public main photo and nothing else.
// cat_identity, observations and sightings are append-only: this file's rows
// stay, naming only its own (deleted) cats, and the throwaway database goes
// at the end of the run.

const NAME_PREFIX = "VitestIdentityReaders";
const DEVICE_PREFIX = "vitest-identity-readers-";
const LETTERS = "bcdfghjkmpqrvwxz";
let counter = 0;
/** A unique tag spelt in letters (CLAUDE.md, SYC-709). */
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

// Colony ids no other file uses: colony statements name them, nothing else.
const COLONY = { mimi: 914_001, agatha: 914_002, dora: 914_003 } as const;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function cleanup() {
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
  await deleteTestSightings(like(sightingsTable.deviceId, `${DEVICE_PREFIX}%`));
}
beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function cat(colonyId: number): Promise<number> {
  const t = tag();
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${NAME_PREFIX}${t}`, data: Buffer.from(`photo:${t}`).toString("base64"), mime: "image/jpeg", createdAt: daysAgo(10) })
    .returning({ id: photosTable.id });
  const [c] = await db
    .insert(catsTable)
    .values({ name: `${NAME_PREFIX}${t}`, primaryPhotoId: p!.id, lat: 37.4441, lng: 24.9412, discovererDeviceId: "vitest-identity-readers", createdAt: daysAgo(10) })
    .returning({ id: catsTable.id });
  await say(c!.id, "colony", { colonyId });
  return c!.id;
}

async function say(catId: number, kind: string, value: object) {
  await db.insert(observationsTable).values({
    catId,
    kind,
    value,
    accountId: "vitest-identity-readers-staff",
    roleAtTime: "staff",
    observedAt: daysAgo(8),
    createdAt: daysAgo(8),
  });
}

async function merge(from: number, into: number): Promise<number> {
  const [row] = await db
    .insert(catIdentityTable)
    .values({ catId: from, canonicalCatId: into, reason: "vitest readers" })
    .returning({ id: catIdentityTable.id });
  return row!.id;
}

async function undo(mergeId: number, catId: number) {
  await db.insert(catIdentityTable).values({ catId, canonicalCatId: catId, supersedesId: mergeId, reason: "vitest readers undo" });
}

interface Cast {
  mimi: number;
  agatha: number;
  dora: number;
  /** The phone that met Mimi. */
  device: string;
}

async function cast(): Promise<Cast> {
  const mimi = await cat(COLONY.mimi);
  const agatha = await cat(COLONY.agatha);
  const dora = await cat(COLONY.dora);
  await say(mimi, "sterilised", { sterilised: true });
  const device = `${DEVICE_PREFIX}${tag()}`;
  const [s] = await db
    .insert(sightingsTable)
    .values({ catId: mimi, deviceId: device, photoId: 0, lat: 37.4441, lng: 24.9412, status: "resolved", createdAt: daysAgo(5) })
    .returning({ id: sightingsTable.id });
  await db.insert(sightingMatchesTable).values({ sightingId: s!.id, choice: "suggested", chosenCatId: mimi, chosenAt: daysAgo(5), suggestedRank: 1 });
  return { mimi, agatha, dora, device };
}

/** What every reader says, for one case. */
interface Expected {
  /** The cat whose records Mimi's should be read through, or null if none. */
  survivor: number | null;
  /** Cats Mimi's records count for (a merged-away cat is still fed by the cats merged into it). */
  fedByMimi: number[];
  /** Cats that should be left out of the team's list and the coat reader. */
  away: number[];
  /** Mimi's colony target. */
  mimiColony: number | null;
}

type Case = { name: string; build: (c: Cast) => Promise<void>; expected: (c: Cast) => Expected };

const CASES: Case[] = [
  {
    name: "merge: Mimi → Agatha",
    build: async (c) => void (await merge(c.mimi, c.agatha)),
    expected: (c) => ({ survivor: c.agatha, fedByMimi: [c.agatha], away: [c.mimi], mimiColony: COLONY.agatha }),
  },
  {
    name: "merge then undo",
    build: async (c) => undo(await merge(c.mimi, c.agatha), c.mimi),
    expected: () => ({ survivor: null, fedByMimi: [], away: [], mimiColony: COLONY.mimi }),
  },
  {
    name: "a chain of two: Mimi → Agatha → Dora",
    build: async (c) => {
      await merge(c.mimi, c.agatha);
      await merge(c.agatha, c.dora);
    },
    expected: (c) => ({ survivor: c.dora, fedByMimi: [c.agatha, c.dora], away: [c.mimi, c.agatha], mimiColony: COLONY.dora }),
  },
  {
    name: "a loop: Mimi → Agatha → Mimi",
    build: async (c) => {
      await merge(c.mimi, c.agatha);
      await merge(c.agatha, c.mimi);
    },
    // Bad data: nobody's records feed anybody, nobody is hidden, and Mimi has
    // no colony, so only the team passes a check on her.
    expected: () => ({ survivor: null, fedByMimi: [], away: [], mimiColony: null }),
  },
];

const sterilisedOf = async (catId: number) => {
  const r = (await loadCatRecords([catId])).get(catId)!;
  return resolveCat(r.observations, r.evidenceOfLife, new Date()).sterilised.value;
};

describe.each(CASES)("every reader of merges: $name", ({ build, expected }) => {
  let c: Cast;
  let e: Expected;
  beforeAll(async () => {
    c = await cast();
    await build(c);
    e = expected(c);
  });

  it("loadCatRecords: Mimi's statements count for the cats she was merged into, and only there", async () => {
    for (const id of [c.agatha, c.dora]) {
      expect(await sterilisedOf(id), `cat ${id}`).toBe(e.fedByMimi.includes(id) ? true : null);
    }
    // Mimi's own records are always her own.
    expect(await sterilisedOf(c.mimi)).toBe(true);
  });

  it("loadTeamCats: merged-away cats are left out, and the survivor carries Mimi's records", async () => {
    const listed = new Map((await loadTeamCats()).map((t) => [t.id, t]));
    for (const id of [c.mimi, c.agatha, c.dora]) {
      expect(listed.has(id), `cat ${id} listed`).toBe(!e.away.includes(id));
    }
    if (e.survivor !== null) expect(listed.get(e.survivor)!.snapshot.sterilised.value).toBe(true);
  });

  it("catsDueForReading: a merged-away cat is never read on its own", async () => {
    const due = await catsDueForReading(Infinity, db, { catIds: [c.mimi, c.agatha, c.dora] });
    const ids = due.map((d) => d.catId).sort((a, b) => a - b);
    expect(ids).toEqual([c.mimi, c.agatha, c.dora].filter((id) => !e.away.includes(id)).sort((a, b) => a - b));
  });

  it("claimEligibility: a merged-away cat (or one in a loop) can't be claimed; Mimi on her own can", async () => {
    const mimiStands = e.survivor === null && e.mimiColony === COLONY.mimi;
    expect(await claimEligibility(db, { catId: c.mimi, deviceId: c.device })).toEqual(
      mimiStands ? { ok: true } : { ok: false, code: "NOT_ON_STREET" },
    );
  });

  it("hasMetCat: the phone that met Mimi has met every cat she was merged into, and nobody else", async () => {
    for (const id of [c.agatha, c.dora]) {
      expect(await hasMetCat(db, id, c.device), `cat ${id}`).toBe(e.fedByMimi.includes(id));
    }
  });

  it("catTarget: Mimi is judged by the cat she now is", async () => {
    expect(await catTarget(c.mimi)).toEqual({ colonyId: e.mimiColony });
  });
});
