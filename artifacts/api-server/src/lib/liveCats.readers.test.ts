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
  vetVisitPhotosTable,
} from "@workspace/db";
import { inArray, like } from "drizzle-orm";

// Reached through findFromPhoto.ts; no call is ever made.
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import { mergeKeepingSightings } from "../test/merges";
import { deleteTestSightings } from "../test/sightings";
import { newColony } from "../test/roleKit";
import { visibleColonyIds } from "./guardianView";
import { letGoWithinDays, removedByTeamWithinDays } from "./claiming";
import { listCatsWithStats, totalCatCount } from "./catHelpers";
import { currentColonyOf, catsInColony, catsByColony } from "./colonyMembership";
import { searchCatsToAdd } from "./colonyCats";
import { trappingPlan } from "./dashboard/trappingPlan";
import { displayPhotoOf } from "./findFromPhoto";
import { guardianCats } from "./guardianCatView";
import { newCatsAfterFailedCheck } from "./matcherHealth";
import { movedAwayNotices } from "./movedAway";
import { loadProgressInputs } from "./reports/progress";
import { parseRange } from "./reports/range";
import { vetCostsReport } from "./reports/vetCosts";
import { searchTeamCats } from "./teamCatView";
import { loadTeamCats } from "./teamCatList";
import { colonyView } from "./teamColonies";
import { visitsFor } from "./vetVisits";

// SYC-410 PR 1.2 (which-cat-is-which.md §9.3; spec test 15): every reader that
// lists or counts cats, or gathers what is known about a cat, treats a merged
// pair as one cat. Rows go straight into cat_identity: a merge, then its undo.
// Each reader is run before, with the merge standing, and after the undo; the
// undo must give back exactly the first answer.
//
// The cast: Mimi (colony M, then moved to colony X by someone else; a vet visit
// with a kept photo; a let-go and a team removal by one phone; a failed-check
// new cat) merged into Agatha (colony A); and Lola (colony L) merged into Rosa
// (no colony). cat_identity, observations and sightings are append-only: this
// file's rows stay, naming only its own (deleted) cats, and the throwaway
// database goes at the end of the run.

const NAME_PREFIX = "VitestLiveCats";
const DEVICE_PREFIX = "vitest-live-cats-";
const STAFF = "vitest-live-cats-staff";
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
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function cleanup() {
  await deleteTestSightings(like(sightingsTable.deviceId, `${DEVICE_PREFIX}%`));
  await db.delete(vetVisitPhotosTable).where(inArray(vetVisitPhotosTable.catId, db.select({ id: catsTable.id }).from(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`))));
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}
beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function say(
  catId: number,
  kind: string,
  value: object,
  o: { days?: number; accountId?: string | null; deviceId?: string | null; supersedesId?: number } = {},
): Promise<number> {
  const deviceOnly = o.deviceId != null;
  const [row] = await db
    .insert(observationsTable)
    .values({
      catId,
      kind,
      value,
      accountId: deviceOnly ? (o.accountId ?? null) : (o.accountId ?? STAFF),
      deviceId: o.deviceId ?? null,
      roleAtTime: deviceOnly && o.accountId == null ? "public" : "staff",
      observedAt: daysAgo(o.days ?? 8),
      createdAt: daysAgo(o.days ?? 8),
      supersedesId: o.supersedesId ?? null,
    })
    .returning({ id: observationsTable.id });
  return row!.id;
}

async function cat(name: string): Promise<{ id: number; name: string }> {
  const t = tag();
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${NAME_PREFIX}${t}`, data: Buffer.from(`photo:${t}`).toString("base64"), mime: "image/jpeg", createdAt: daysAgo(10) })
    .returning({ id: photosTable.id });
  const full = `${NAME_PREFIX}${name}${t}`;
  const [c] = await db
    .insert(catsTable)
    .values({ name: full, primaryPhotoId: p!.id, lat: 37.4441, lng: 24.9412, discovererDeviceId: "vitest-live-cats", createdAt: daysAgo(10) })
    .returning({ id: catsTable.id });
  return { id: c!.id, name: full };
}

// Mimi and Lola keep their resolved sightings through the merge (the shape
// these readers were written for until PR 3.1/4.1 record the merge's moves),
// so the merge row goes in with migration 0053's "no sighting left" check off
// for that one insert (test/merges.ts).
async function merge(from: number, into: number): Promise<number> {
  const row = await mergeKeepingSightings({ catId: from, canonicalCatId: into, reason: "vitest live cats" });
  return row.id;
}

async function undo(mergeId: number, catId: number) {
  await db.insert(catIdentityTable).values({ catId, canonicalCatId: catId, supersedesId: mergeId, reason: "vitest live cats undo" });
}

interface Cast {
  mimi: { id: number; name: string };
  agatha: { id: number; name: string };
  rosa: { id: number; name: string };
  lola: { id: number; name: string };
  colony: { m: number; a: number; l: number; x: number };
  /** The phone that let Mimi go, and was removed as her owner. */
  device: string;
  all: number[];
}

async function cast(): Promise<Cast> {
  const colony = {
    m: await newColony(`${NAME_PREFIX}M${tag()}`),
    a: await newColony(`${NAME_PREFIX}A${tag()}`),
    l: await newColony(`${NAME_PREFIX}L${tag()}`),
    x: await newColony(`${NAME_PREFIX}X${tag()}`),
  };
  const mimi = await cat("Mimi");
  const agatha = await cat("Agatha");
  const rosa = await cat("Rosa");
  const lola = await cat("Lola");
  // Mimi: in M, moved to X by someone else five days ago.
  await say(mimi.id, "colony", { colonyId: colony.m }, { days: 20 });
  await say(mimi.id, "colony", { colonyId: colony.x }, { days: 5, accountId: "vitest-live-cats-other" });
  await say(agatha.id, "colony", { colonyId: colony.a }, { days: 30 });
  await say(lola.id, "colony", { colonyId: colony.l }, { days: 8 });

  // A vet visit on Mimi with a kept (team-only) photo.
  const visitId = await say(mimi.id, "vet_visit", { did: ["checked"], clinicId: "symviosis", costEur: 20, paidBy: "syros_cats" }, { days: 6 });
  const t = tag();
  const [kept] = await db
    .insert(photosTable)
    .values({ publicId: `${NAME_PREFIX}${t}`, data: Buffer.from(`kept:${t}`).toString("base64"), mime: "image/jpeg", createdAt: daysAgo(6) })
    .returning({ id: photosTable.id });
  await db.insert(vetVisitPhotosTable).values({ photoId: kept!.id, visitId, catId: mimi.id });

  // One phone let Mimi go; the team removed it as her owner.
  const device = `${DEVICE_PREFIX}${tag()}`;
  await say(mimi.id, "life_status", { withdrawn: true }, { deviceId: device, days: 3 });
  const homed = await say(mimi.id, "life_status", { status: "homed" }, { deviceId: device, days: 4 });
  await say(mimi.id, "life_status", { withdrawn: true }, { supersedesId: homed, days: 2 });

  // Mimi's spot: a failed photo check, then "It's a new cat".
  const [s] = await db
    .insert(sightingsTable)
    .values({ catId: mimi.id, deviceId: device, photoId: 0, lat: 37.4441, lng: 24.9412, status: "resolved", createdAt: daysAgo(2) })
    .returning({ id: sightingsTable.id });
  await db.insert(sightingMatchesTable).values({
    sightingId: s!.id,
    choice: "new_cat",
    chosenCatId: mimi.id,
    chosenAt: daysAgo(2),
    matcherFailed: true,
  });
  return { mimi, agatha, rosa, lola, colony, device, all: [mimi.id, agatha.id, rosa.id, lola.id] };
}

const sorted = (ids: Iterable<number>) => [...ids].sort((a, b) => a - b);
const TEAM = visibleColonyIds({ scopes: [{ role: "staff", colonyId: null, reach: "island" }] });

interface Reader {
  name: string;
  /** What the reader says, narrowed to the cast so other tests' rows don't matter. */
  observe: (c: Cast) => Promise<unknown>;
  /** What it says with Mimi merged into Agatha and Lola into Rosa, given what it said before. */
  merged: (before: unknown, c: Cast) => unknown;
}

const inCast = (c: Cast, ids: Iterable<number>) => sorted([...ids].filter((id) => c.all.includes(id)));
const goneAway = (c: Cast) => (before: unknown) => (before as number[]).filter((id) => id !== c.mimi.id && id !== c.lola.id);

const READERS: Reader[] = [
  {
    name: "totalCatCount: the island count goes down by one for each merge",
    observe: () => totalCatCount(),
    merged: (before) => (before as number) - 2,
  },
  {
    name: "listCatsWithStats: the public list and its total leave out merged-away cats",
    observe: async (c) => {
      const ids: number[] = [];
      let total = 0;
      for (let page: number | null = 1; page !== null; ) {
        const r = await listCatsWithStats({ page, pageSize: 100 });
        ids.push(...r.cats.map((x) => x.id));
        total = r.total;
        page = r.nextPage;
      }
      return { ids: inCast(c, ids), total };
    },
    merged: (before, c) => ({
      ids: goneAway(c)((before as { ids: number[] }).ids),
      total: (before as { total: number }).total - 2,
    }),
  },
  {
    name: "loadTeamCats: the team list leaves out merged-away cats",
    observe: async (c) => inCast(c, (await loadTeamCats()).map((t) => t.id)),
    merged: (before, c) => goneAway(c)(before),
  },
  {
    name: "searchTeamCats: search no longer finds a merged-away cat by name",
    observe: async (c) => sorted((await searchTeamCats(c.mimi.name)).map((r) => r.id)),
    merged: () => [],
  },
  {
    name: "searchCatsToAdd: the colony picker no longer offers a merged-away cat",
    observe: async (c) => sorted((await searchCatsToAdd(TEAM, c.lola.name)).map((r) => r.id)),
    merged: () => [],
  },
  {
    name: "guardianCats: a colony's cats leave out merged-away ones",
    observe: async (c) => sorted((await guardianCats(c.all, new Map())).map((g) => g.id)),
    merged: (before, c) => goneAway(c)(before),
  },
  {
    name: "displayPhotoOf: a merged-away cat is not a candidate for 'Find this cat'",
    observe: async (c) => sorted((await displayPhotoOf(c.all)).keys()),
    merged: (before, c) => goneAway(c)(before),
  },
  {
    name: "newCatsAfterFailedCheck: a merged-away cat is no longer a new cat to check",
    observe: async (c) => inCast(c, (await newCatsAfterFailedCheck()).map((n) => n.catId)),
    merged: () => [],
  },
  {
    name: "loadProgressInputs: the Progress report counts the merged pair once",
    observe: async (c) => {
      const p = await loadProgressInputs(new Date());
      return { cats: inCast(c, p.cats.map((x) => x.id)), found: inCast(c, p.found.keys()) };
    },
    merged: (before, c) => ({
      cats: goneAway(c)((before as { cats: number[] }).cats),
      found: goneAway(c)((before as { found: number[] }).found),
    }),
  },
  {
    name: "currentColonyOf by id: the cat she is now takes her own colony, else a merged-in cat's",
    observe: async (c) => Object.fromEntries(await currentColonyOf(c.all)),
    // Agatha keeps A; Rosa had none and takes Lola's L; the merged-away cats still answer for themselves.
    merged: (before, c) => ({ ...(before as object), [c.rosa.id]: c.colony.l }),
  },
  {
    name: "currentColonyOf for the whole island: merged-away cats are not listed",
    observe: async (c) => Object.fromEntries([...(await currentColonyOf())].filter(([id]) => c.all.includes(id))),
    merged: (_, c) => ({ [c.agatha.id]: c.colony.a, [c.rosa.id]: c.colony.l }),
  },
  {
    name: "catsInColony: a colony lists the cat she is now, once",
    observe: async (c) => ({ l: await catsInColony(c.colony.l), x: await catsInColony(c.colony.x), a: await catsInColony(c.colony.a) }),
    merged: (_, c) => ({ l: [c.rosa.id], x: [], a: [c.agatha.id] }),
  },
  {
    name: "catsByColony: colony counts cover both records",
    observe: async (c) => {
      const out: Record<number, number[]> = {};
      for (const [colonyId, ids] of await catsByColony()) {
        const mine = inCast(c, ids);
        if (mine.length > 0) out[colonyId] = mine;
      }
      return out;
    },
    merged: (_, c) => ({ [c.colony.a]: [c.agatha.id], [c.colony.l]: [c.rosa.id] }),
  },
  {
    name: "trappingPlan: a colony's plan lists the cat she is now, once",
    observe: async (c) => ((await trappingPlan(TEAM, c.colony.l, { island: true }))!.toDo.map((t) => t.id)),
    merged: (_, c) => [c.rosa.id],
  },
  {
    name: "colonyView: a colony page lists the cat she is now, once",
    observe: async (c) => ((await colonyView(TEAM, c.colony.l))!.cats.map((t) => t.id)),
    merged: (_, c) => [c.rosa.id],
  },
  {
    name: "movedAwayNotices: a merge is never a move, and a merged-in cat's moves are not the cat she is now's",
    observe: async (c) =>
      (await movedAwayNotices({ id: "vitest-live-cats-guardian", scopes: [{ role: "guardian", colonyId: c.colony.m }] })).map((n) => n.catId),
    merged: () => [],
  },
  {
    name: "visitsFor and its photos: a merged-in cat's visits and kept photos are the cat she is now's",
    observe: async (c) => (await visitsFor(c.agatha.id, { costs: true })).map((v) => ({ did: v.did, photos: v.photos?.length ?? 0 })),
    merged: () => [{ did: ["checked"], photos: 1 }],
  },
  {
    name: "vetCostsReport: each visit is listed under the cat she is now",
    observe: async (c) => {
      const r = await vetCostsReport(parseRange({ range: "all" }, new Date()), new Date());
      return inCast(c, r.visits.map((v) => v.catId));
    },
    merged: (_, c) => [c.agatha.id],
  },
  {
    name: "letGoWithinDays: a phone that let Mimi go has let the cat she is now go",
    observe: async (c) => [await letGoWithinDays(db, c.agatha.id, c.device, 30), await letGoWithinDays(db, c.mimi.id, c.device, 30)],
    merged: () => [true, true],
  },
  {
    name: "removedByTeamWithinDays: a phone the team removed as Mimi's owner is checked against the cat she is now",
    observe: async (c) => [await removedByTeamWithinDays(db, c.agatha.id, c.device, 30), await removedByTeamWithinDays(db, c.mimi.id, c.device, 30)],
    merged: () => [true, true],
  },
];

describe("spec test 15: merge, then undo, for every moved reader", () => {
  const before = new Map<string, unknown>();
  const during = new Map<string, unknown>();
  const after = new Map<string, unknown>();
  let c: Cast;

  beforeAll(async () => {
    c = await cast();
    for (const r of READERS) before.set(r.name, await r.observe(c));
    const m1 = await merge(c.mimi.id, c.agatha.id);
    const m2 = await merge(c.lola.id, c.rosa.id);
    for (const r of READERS) during.set(r.name, await r.observe(c));
    await undo(m1, c.mimi.id);
    await undo(m2, c.lola.id);
    for (const r of READERS) after.set(r.name, await r.observe(c));
  });

  it.each(READERS.map((r) => [r.name, r] as const))("%s", (_name, r) => {
    expect(during.get(r.name), "with the merge standing").toEqual(r.merged(before.get(r.name), c));
    expect(after.get(r.name), "after the undo").toEqual(before.get(r.name));
  });

  it("the cast is set up so the merge changes something for every reader", () => {
    for (const r of READERS) {
      // A reader that says the same before and during would prove nothing about the merge.
      expect(JSON.stringify(during.get(r.name)), `${r.name}: unchanged by the merge`).not.toBe(JSON.stringify(before.get(r.name)));
    }
  });
});
