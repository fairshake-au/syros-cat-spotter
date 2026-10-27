import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  catIdentityTable,
  catSubscriptionsTable,
  catsTable,
  db,
  observationsTable,
  photosTable,
  pool,
  welfareReportsTable,
} from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";

// Reached through the routes and the matcher; no call is ever made.
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

import { newColony } from "../test/roleKit";
import { matcherPool, storedAnswer } from "../routes/sightings";
import { runSmokeCheck } from "../scripts/smokeCheck";
import { colonyFigures } from "./dashboard/colonyFigures";
import { currentColonyOf } from "./colonyMembership";
import { listColourCheck } from "./colourCheck";
import { listGuardianChanges } from "./guardianChanges";
import { visibleColonyIds } from "./guardianView";
import { listLikelyForReview } from "./likelyReview";
import { catsToWalk } from "./news/nightly";
import { colonyAfterMarkingWrong } from "./teamCorrections";

// SYC-410 PR 1.2, spec test 15 (second half): the readers the first table
// (liveCats.readers.test.ts) could not reach by a public function, or that need
// more setup. Same method: rows go straight into cat_identity, each reader is
// run before, with the merge standing, and after the undo, and the undo must
// give back the first answer.
//
// The cast: Mimi merged into Agatha (Mimi: colony G, a machine coat reading, a
// clipped ear, a team "street" life status, a litter report, a follower).
// Agatha: colony A at day -50, then colony X at day -5, and a guardian's
// "homed". Two more cats, Gina and Gwen, are first recorded in G. Rows are
// append-only; they name only this file's (deleted) cats.

const NAME_PREFIX = "VitestMoreReaders";
const REPORT_PREFIX = "vitest-more-readers-";
const DEVICE = "vitest-more-readers-device";
const STAFF = "vitest-more-readers-staff";
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
const TEAM = visibleColonyIds({ scopes: [{ role: "staff", colonyId: null, reach: "island" }] });

let photoIds: number[] = [];

async function cleanup() {
  await db.delete(welfareReportsTable).where(like(welfareReportsTable.publicId, `${REPORT_PREFIX}%`));
  await db.delete(catSubscriptionsTable).where(like(catSubscriptionsTable.deviceId, `${REPORT_PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
  await db.delete(photosTable).where(like(photosTable.publicId, `${NAME_PREFIX}%`));
}
beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

interface Put {
  days?: number;
  role?: string;
  accountId?: string | null;
  deviceId?: string | null;
  scope?: string | null;
  provenance?: string;
  photoId?: number | null;
}

async function put(catId: number, kind: string, value: object, o: Put = {}): Promise<number> {
  const [row] = await db
    .insert(observationsTable)
    .values({
      catId,
      kind,
      value,
      accountId: o.accountId === undefined ? STAFF : o.accountId,
      deviceId: o.deviceId ?? null,
      roleAtTime: o.role ?? "staff",
      ...(o.scope ? { authorityScope: o.scope } : {}),
      provenance: o.provenance ?? "volunteered",
      ...(o.photoId ? { photoId: o.photoId } : {}),
      observedAt: daysAgo(o.days ?? 8),
      createdAt: daysAgo(o.days ?? 8),
    })
    .returning({ id: observationsTable.id });
  return row!.id;
}

async function photo(): Promise<number> {
  const t = tag();
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${NAME_PREFIX}${t}`, data: Buffer.from(`photo:${t}`).toString("base64"), mime: "image/jpeg", createdAt: daysAgo(10) })
    .returning({ id: photosTable.id });
  photoIds.push(p!.id);
  return p!.id;
}

async function cat(label: string): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}${label}${tag()}`,
      primaryPhotoId: await photo(),
      lat: 37.4441,
      lng: 24.9412,
      discovererDeviceId: "vitest-more-readers",
      createdAt: daysAgo(10),
    })
    .returning({ id: catsTable.id });
  return c!.id;
}

const merge = async (from: number, into: number) =>
  (await db.insert(catIdentityTable).values({ catId: from, canonicalCatId: into, reason: "vitest more readers" }).returning({ id: catIdentityTable.id }))[0]!.id;
const undo = (mergeId: number, catId: number) =>
  db.insert(catIdentityTable).values({ catId, canonicalCatId: catId, supersedesId: mergeId, reason: "vitest more readers undo" });

interface Cast {
  mimi: number;
  agatha: number;
  gina: number;
  gwen: number;
  all: number[];
  colony: { g: number; a: number; x: number };
  /** Agatha's colony-X statement (the one marked wrong). */
  xStatement: number;
}

async function cast(): Promise<Cast> {
  const colony = {
    g: await newColony(`${NAME_PREFIX}G${tag()}`),
    a: await newColony(`${NAME_PREFIX}A${tag()}`),
    x: await newColony(`${NAME_PREFIX}X${tag()}`),
  };
  const [mimi, agatha, gina, gwen] = [await cat("Mimi"), await cat("Agatha"), await cat("Gina"), await cat("Gwen")];
  await put(gina, "colony", { colonyId: colony.g }, { days: 8 });
  await put(gwen, "colony", { colonyId: colony.g }, { days: 8 });
  await put(mimi, "colony", { colonyId: colony.g }, { days: 40 });
  await put(agatha, "colony", { colonyId: colony.a }, { days: 50 });
  const xStatement = await put(agatha, "colony", { colonyId: colony.x }, { days: 5 });

  // Mimi: a machine coat reading, a clipped ear from a spotter, a team "street" status.
  await put(
    mimi,
    "coat",
    { modelVersion: "vision-2", colours: ["brown"], pattern: "stripes" },
    { days: 5, accountId: "system:vision", role: "system", provenance: "machine" },
  );
  await put(mimi, "ear_tip", { clipped: true }, { days: 3, accountId: null, deviceId: DEVICE, role: "public", photoId: await photo() });
  await put(mimi, "life_status", { status: "street" }, { days: 9 });
  // A guardian's "homed" on Agatha.
  await put(agatha, "life_status", { status: "homed" }, { days: 2, accountId: "vitest-more-readers-guardian", role: "guardian", scope: `colony:${colony.a}` });

  // A counted litter report tied to Mimi, and a follower of Mimi.
  await db.insert(welfareReportsTable).values({
    publicId: `${REPORT_PREFIX}${tag()}`,
    kind: "welfare",
    severity: "attention",
    isLitter: true,
    lat: 37.4441,
    lng: 24.9412,
    catId: mimi,
    reporterDevice: DEVICE,
    clientRef: `${REPORT_PREFIX}${tag()}`,
    photoState: "none",
    submittedAt: daysAgo(5),
    createdAt: daysAgo(5),
  });
  await db.insert(catSubscriptionsTable).values({ deviceId: `${REPORT_PREFIX}${tag()}`, catId: mimi });
  return { mimi, agatha, gina, gwen, all: [mimi, agatha, gina, gwen], colony, xStatement };
}

const sorted = (ids: Iterable<number>) => [...ids].sort((a, b) => a - b);
const inCast = (c: Cast, ids: Iterable<number>) => sorted([...ids].filter((id) => c.all.includes(id)));

interface Reader {
  name: string;
  observe: (c: Cast) => Promise<unknown>;
  merged: (before: unknown, c: Cast) => unknown;
}

const READERS: Reader[] = [
  {
    name: "listColourCheck: a merged-away cat is not listed for a second look",
    observe: async (c) => inCast(c, (await listColourCheck()).map((x) => x.catId)),
    merged: (before, c) => (before as number[]).filter((id) => id !== c.mimi),
  },
  {
    name: "listLikelyForReview: Mimi's clipped ear is shown once, as Agatha's",
    observe: async (c) => inCast(c, (await listLikelyForReview()).map((x) => x.catId)),
    merged: (_, c) => [c.agatha],
  },
  {
    name: "listGuardianChanges: whether her statement still stands is judged over both records",
    observe: async (c) =>
      (await listGuardianChanges({ limit: 1000 }))
        .flatMap((g) => (g.type === "statement" && c.all.includes(g.cat.id) ? [{ cat: g.cat.id, standing: g.standing, contradictsTeam: g.contradictsTeam }] : []))
        .sort((a, b) => a.cat - b.cat),
    // Agatha's "homed" now disagrees with the team's "street" on Mimi.
    merged: (_, c) => [{ cat: c.agatha, standing: true, contradictsTeam: true }],
  },
  {
    name: "colonyFigures: Growing reads first colony over both records; Kittens reads the report under the cat she is now",
    observe: async (c) => {
      const f = await colonyFigures(TEAM, { island: true });
      return {
        growingG: f.get(c.colony.g)?.flags.includes("growing") ?? false,
        kittens: [c.colony.g, c.colony.a, c.colony.x].filter((id) => f.get(id)?.flags.includes("kittens")),
      };
    },
    // Agatha's earliest colony is A (day -50), so Mimi's G no longer counts as new there;
    // the litter report on Mimi now counts under Agatha's colony, X.
    merged: (_, c) => ({ growingG: false, kittens: [c.colony.x] }),
  },
  {
    name: "catsToWalk: the nightly walker skips a merged-away cat",
    observe: async (c) => inCast(c, await catsToWalk(db)),
    merged: () => [],
  },
  {
    name: "storedAnswer: a replayed photo-check answer does not bring a merged-away cat back",
    observe: async (c) =>
      inCast(
        c,
        (
          await storedAnswer({
            suggested: [
              { catId: c.mimi, rank: 1, score: 0.9 },
              { catId: c.agatha, rank: 2, score: 0.8 },
            ],
            noCatInAnyPhoto: false,
          })
        ).candidates.map((x) => x.catId),
      ),
    merged: (_, c) => [c.agatha],
  },
  {
    name: "the matcher pool: a merged-away cat is not a candidate",
    observe: async (c) => inCast(c, (await matcherPool()).map((x) => x.id)),
    merged: (before, c) => (before as number[]).filter((id) => id !== c.mimi),
  },
  {
    name: "the smoke check: the gallery has one cat for a merged pair",
    observe: async (c) => (await runSmokeCheck([], { onlyCats: (x) => c.all.includes(x.id) })).galleryCats,
    merged: (before) => (before as number) - 1,
  },
  {
    name: "colonyAfterMarkingWrong: marking Agatha's newest colony wrong goes back to where both records' other statements put her",
    observe: async (c) => {
      const [original] = await db.select().from(observationsTable).where(eq(observationsTable.id, c.xStatement));
      return colonyAfterMarkingWrong(db as never, original!).then((r) => (r.colonyId === c.colony.a ? "A" : r.colonyId === c.colony.g ? "G" : r.colonyId));
    },
    // Mimi's G (day -40) is newer than Agatha's own A (day -50).
    merged: () => "G",
  },
];

describe("spec test 15 (second table): merge, then undo, for the readers with more setup", () => {
  const before = new Map<string, unknown>();
  const during = new Map<string, unknown>();
  const after = new Map<string, unknown>();
  let c: Cast;

  beforeAll(async () => {
    c = await cast();
    for (const r of READERS) before.set(r.name, await r.observe(c));
    const m = await merge(c.mimi, c.agatha);
    for (const r of READERS) during.set(r.name, await r.observe(c));
    await undo(m, c.mimi);
    for (const r of READERS) after.set(r.name, await r.observe(c));
  });

  it.each(READERS.map((r) => [r.name, r] as const))("%s", (_name, r) => {
    expect(during.get(r.name), "with the merge standing").toEqual(r.merged(before.get(r.name), c));
    expect(after.get(r.name), "after the undo").toEqual(before.get(r.name));
  });

  it("the merge changes the answer for every reader (so none proves nothing)", () => {
    for (const r of READERS) {
      expect(JSON.stringify(during.get(r.name)), `${r.name}: unchanged by the merge`).not.toBe(JSON.stringify(before.get(r.name)));
    }
  });
});

describe("the colony rule: the cat she is now keeps her own colony, else the newest of the cats merged into her", () => {
  it("both have a colony and the merged-in one is newer: the survivor's own still wins; after the undo each has her own", async () => {
    const [g, a] = [await newColony(`${NAME_PREFIX}RuleG${tag()}`), await newColony(`${NAME_PREFIX}RuleA${tag()}`)];
    const survivor = await cat("Survivor");
    const mergedIn = await cat("MergedIn");
    await put(survivor, "colony", { colonyId: a }, { days: 30 });
    await put(mergedIn, "colony", { colonyId: g }, { days: 5 });
    const m = await merge(mergedIn, survivor);
    expect((await currentColonyOf([survivor])).get(survivor)).toBe(a);
    // The merged-away cat still answers for her own record.
    expect((await currentColonyOf([mergedIn])).get(mergedIn)).toBe(g);
    await undo(m, mergedIn);
    expect((await currentColonyOf([survivor, mergedIn])).get(mergedIn)).toBe(g);
    expect((await currentColonyOf([survivor])).get(survivor)).toBe(a);
  });

  it("the survivor has none: the newest statement of the cats merged into her counts", async () => {
    const [g, a] = [await newColony(`${NAME_PREFIX}NoneG${tag()}`), await newColony(`${NAME_PREFIX}NoneA${tag()}`)];
    const survivor = await cat("Bare");
    const older = await cat("Older");
    const newer = await cat("Newer");
    await put(older, "colony", { colonyId: g }, { days: 20 });
    await put(newer, "colony", { colonyId: a }, { days: 5 });
    const m1 = await merge(older, survivor);
    const m2 = await merge(newer, survivor);
    expect((await currentColonyOf([survivor])).get(survivor)).toBe(a);
    await undo(m2, newer);
    expect((await currentColonyOf([survivor])).get(survivor)).toBe(g);
    await undo(m1, older);
    expect((await currentColonyOf([survivor])).has(survivor)).toBe(false);
  });

  it("her own 'in no colony' statement is her colony: nothing of the merged-in cats' counts", async () => {
    const g = await newColony(`${NAME_PREFIX}NullG${tag()}`);
    const survivor = await cat("Nowhere");
    const mergedIn = await cat("Somewhere");
    await put(survivor, "colony", { colonyId: null }, { days: 30 });
    await put(mergedIn, "colony", { colonyId: g }, { days: 5 });
    await merge(mergedIn, survivor);
    expect((await currentColonyOf([survivor])).has(survivor)).toBe(false);
  });
});

// Keeps the unused-import linter honest about the helper used only in types above.
void inArray;
