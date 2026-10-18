import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Observation } from "@workspace/db/schema";
import { db, pool, catsTable } from "@workspace/db";
import { like } from "drizzle-orm";
import {
  authorityLevel,
  outranks,
  resolveLifeStatus,
  resolveSterilised,
  resolveVaccinated,
  standingRows,
  type Confidence,
  type EvidenceOfLife,
  type ImportRecord,
  type LifeStatusResolved,
  type LifeStatusValue,
  type Resolved,
} from "./resolve";
import { loadCatRecords, writeObservation, type WriteObservationInput } from "./observations";
import { listGuardianChanges } from "./guardianChanges";
import { teamCatView } from "./teamCatView";
import { myStatementsOnCat } from "./guardianStatements";
import { lockActiveObservation } from "./teamCorrections";

// SYC-396 PR 3.0, Task 3.0.2 (plan Decision 6; team-dashboard-redesign.md
// §8.3, D8): for sterilised, vaccinated and vet_visit, undoing a statement
// puts back what it replaced. A `{ retracted: true }` supersedes its target
// and asserts nothing; when that target had itself replaced an earlier row,
// the earlier row stands again. Every other kind keeps `isActive`.

// ── Pure fixtures ──────────────────────────────────────────────────────────

let nextId = 1;

function obs(overrides: Partial<Observation> & { kind: string; value: unknown }): Observation {
  const id = overrides.id ?? nextId++;
  const observedAt = overrides.observedAt ?? new Date("2026-08-01T00:00:00Z");
  return {
    id,
    catId: overrides.catId ?? 1,
    kind: overrides.kind,
    value: overrides.value,
    deviceId: overrides.deviceId ?? null,
    accountId: overrides.accountId ?? "someone",
    roleAtTime: overrides.roleAtTime ?? "staff",
    authorityScope: overrides.authorityScope ?? "none",
    provenance: overrides.provenance ?? "volunteered",
    suggestedValue: null,
    suggestionSource: null,
    sightingId: null,
    photoId: overrides.photoId ?? null,
    importRecordId: null,
    observedAt,
    createdAt: overrides.createdAt ?? observedAt,
    supersedesId: overrides.supersedesId ?? null,
    supersedeReason: overrides.supersedeReason ?? null,
    redactedAt: null,
    redactionReason: null,
  } as Observation;
}

const GUARDIAN = { roleAtTime: "guardian", authorityScope: "colony:7", accountId: "eleni" } as const;
const RETRACTED = { retracted: true, reason: "the visit was the wrong cat" };
const ids = (rows: readonly Observation[]) => rows.map((o) => o.id).sort((a, b) => a - b);

describe("standingRows: the four chains", () => {
  const g = () => obs({ kind: "sterilised", value: { sterilised: false }, ...GUARDIAN });

  it("G ← Y: Y stands", () => {
    const G = g();
    const Y = obs({ kind: "sterilised", value: { sterilised: true }, supersedesId: G.id });
    expect(ids(standingRows([G, Y], "sterilised"))).toEqual([Y.id]);
  });

  it("G ← Y ← R (R retracts Y): G stands again", () => {
    const G = g();
    const Y = obs({ kind: "sterilised", value: { sterilised: true }, supersedesId: G.id });
    const R = obs({ kind: "sterilised", value: RETRACTED, supersedesId: Y.id });
    expect(ids(standingRows([G, Y, R], "sterilised"))).toEqual([G.id]);
  });

  it("G ← Y ← R ← R2 (R2 retracts the retraction): Y stands", () => {
    const G = g();
    const Y = obs({ kind: "sterilised", value: { sterilised: true }, supersedesId: G.id });
    const R = obs({ kind: "sterilised", value: RETRACTED, supersedesId: Y.id });
    const R2 = obs({ kind: "sterilised", value: RETRACTED, supersedesId: R.id });
    expect(ids(standingRows([G, Y, R, R2], "sterilised"))).toEqual([Y.id]);
  });

  it("G ← Y ← Y2 (a correction of the correction): Y2 stands, unchanged", () => {
    const G = g();
    const Y = obs({ kind: "sterilised", value: { sterilised: true }, supersedesId: G.id });
    const Y2 = obs({ kind: "sterilised", value: { sterilised: false }, supersedesId: Y.id });
    expect(ids(standingRows([G, Y, Y2], "sterilised"))).toEqual([Y2.id]);
  });

  it("the order rows arrive in doesn't matter", () => {
    const G = g();
    const Y = obs({ kind: "sterilised", value: { sterilised: true }, supersedesId: G.id });
    const R = obs({ kind: "sterilised", value: RETRACTED, supersedesId: Y.id });
    expect(ids(standingRows([R, G, Y], "sterilised"))).toEqual([G.id]);
  });

  it("only rows of the kind asked for", () => {
    const G = g();
    const v = obs({ kind: "vaccinated", value: { vaccines: ["rabies"] } });
    expect(ids(standingRows([G, v], "vaccinated"))).toEqual([v.id]);
  });
});

describe("resolveSterilised with a vet visit", () => {
  const visitDay = new Date("2026-08-13T09:00:00Z");
  const herDay = new Date("2026-08-20T09:00:00Z");

  it("Decision G still holds: a guardian's standing no beats an earlier team yes, with no visit", () => {
    const yes = obs({ kind: "sterilised", value: { sterilised: true }, observedAt: visitDay });
    const no = obs({ kind: "sterilised", value: { sterilised: false }, observedAt: herDay, ...GUARDIAN });
    const r = resolveSterilised([yes, no]);
    expect(r.value).toBe(false);
    expect(r.supportingObservationIds).toEqual([no.id]);
  });

  it("a visit yes that supersedes her no makes the cat sterilised, confirmed", () => {
    const no = obs({ kind: "sterilised", value: { sterilised: false }, observedAt: herDay, ...GUARDIAN });
    const visit = obs({ kind: "vet_visit", value: { did: ["sterilised"] }, observedAt: visitDay });
    const yes = obs({
      kind: "sterilised",
      value: { sterilised: true, clinic: "Symviosis", vetVisitId: visit.id, reason: "vet visit" },
      observedAt: visitDay,
      supersedesId: no.id,
      supersedeReason: "vet visit on 13 Aug 2026",
    });
    const r = resolveSterilised([no, visit, yes]);
    expect(r).toMatchObject({ value: true, confidence: "confirmed", supportingObservationIds: [yes.id] });
  });

  it("retracting the visit's yes brings back the guardian's no", () => {
    const no = obs({ kind: "sterilised", value: { sterilised: false }, observedAt: herDay, ...GUARDIAN });
    const visit = obs({ kind: "vet_visit", value: { did: ["sterilised"] }, observedAt: visitDay });
    const yes = obs({
      kind: "sterilised",
      value: { sterilised: true, vetVisitId: visit.id },
      observedAt: visitDay,
      supersedesId: no.id,
    });
    const undoYes = obs({ kind: "sterilised", value: RETRACTED, supersedesId: yes.id });
    const undoVisit = obs({ kind: "vet_visit", value: RETRACTED, supersedesId: visit.id });
    const r = resolveSterilised([no, visit, yes, undoYes, undoVisit]);
    expect(r).toMatchObject({ value: false, confidence: "confirmed", supportingObservationIds: [no.id] });
  });

  it("a retraction with nothing behind it leaves the cat unknown", () => {
    const yes = obs({ kind: "sterilised", value: { sterilised: true } });
    const undo = obs({ kind: "sterilised", value: RETRACTED, supersedesId: yes.id });
    expect(resolveSterilised([yes, undo])).toMatchObject({ value: null, confidence: "unknown" });
  });
});

describe("resolveVaccinated", () => {
  it("drops a retracted record and keeps the others", () => {
    const a = obs({ kind: "vaccinated", value: { vaccines: ["rabies"] }, observedAt: new Date("2026-05-01") });
    const b = obs({ kind: "vaccinated", value: { vaccines: ["cat_flu_enteritis"] }, observedAt: new Date("2026-06-01") });
    const undo = obs({ kind: "vaccinated", value: RETRACTED, supersedesId: b.id });
    expect(resolveVaccinated([a, b, undo]).map((v) => v.observationId)).toEqual([a.id]);
  });

  it("keeps its order: team rows first, then standing rows", () => {
    // A public row pointing at a team row (a writer refuses one) is dropped
    // before anything is worked out, so it can't stand the team row down.
    const team = obs({ kind: "vaccinated", value: { vaccines: ["rabies"] } });
    const stray = obs({
      kind: "vaccinated",
      value: { vaccines: ["cat_flu_enteritis"] },
      roleAtTime: "public",
      deviceId: "phone",
      accountId: null,
      supersedesId: team.id,
    });
    expect(resolveVaccinated([team, stray]).map((v) => v.observationId)).toEqual([team.id]);
  });
});

// ── The replay check: histories without retractions are unchanged ─────────
//
// A frozen copy of resolveSterilised and resolveLifeStatus as they stood on
// origin/main at 9665c1b3, before this PR. 300 seeded histories with
// supersede chains of length 1–3, guardian, team, spotter, owner, vet and
// import rows, and past dates. Ear tips and life statuses also get
// retraction-shaped junk (which no writer produces), so applying the new
// rule beyond its three kinds shows up here. The new behaviour itself is
// pinned by the chain tests above.

function frozenIsActive(o: Observation, all: readonly Observation[]): boolean {
  return !all.some((other) => other.supersedesId === o.id);
}
const frozenToIso = (d: Date | string) => (typeof d === "string" ? new Date(d).toISOString() : d.toISOString());
function frozenNewest<T extends Observation>(list: readonly T[]): T | undefined {
  if (list.length === 0) return undefined;
  return list.reduce((n, c) => {
    const a = n.observedAt.getTime();
    const b = c.observedAt.getTime();
    if (b > a) return c;
    if (b === a && c.id > n.id) return c;
    return n;
  });
}
function frozenParseSterilised(v: unknown): { sterilised: boolean } | null {
  return typeof v === "object" && v !== null && "sterilised" in v && typeof (v as { sterilised: unknown }).sterilised === "boolean"
    ? (v as { sterilised: boolean })
    : null;
}
function frozenParseEarTip(v: unknown): { clipped: true | false | "cant_tell" } | null {
  if (typeof v !== "object" || v === null || !("clipped" in v)) return null;
  const c = (v as { clipped: unknown }).clipped;
  return c === true || c === false || c === "cant_tell" ? (v as { clipped: true | false | "cant_tell" }) : null;
}
function frozenEarTipLevel(o: Observation) {
  if (o.provenance === "import") return 0;
  if (o.roleAtTime !== "vet" && (o.authorityScope ?? "none") === "owner_of_this_cat") return 0;
  return authorityLevel(o);
}
function frozenClipCountered(no: Observation, clip: Observation): boolean {
  if (frozenEarTipLevel(clip) === 0) return no.observedAt.getTime() >= clip.observedAt.getTime();
  return outranks(no, clip, frozenEarTipLevel);
}
const EPOCH = new Date(0).toISOString();

function frozenResolveSterilised(observations: readonly Observation[], importRecords: readonly ImportRecord[] = []): Resolved<boolean> {
  const active = observations.filter((o) => frozenIsActive(o, observations));
  type Candidate = { sterilised: boolean; at: Date; rank: Parameters<typeof outranks>[0]; observationId: number | null };
  const authoritative: Candidate[] = active
    .filter((o) => o.kind === "sterilised" && authorityLevel(o) > 0)
    .flatMap((o) => {
      const p = frozenParseSterilised(o.value);
      return p ? [{ sterilised: p.sterilised, at: o.observedAt, rank: o, observationId: o.id }] : [];
    });
  const fromImport: Candidate[] = importRecords.map((r) => {
    const at = new Date(r.observedAt);
    return {
      sterilised: r.sterilised,
      at,
      rank: { roleAtTime: "system", authorityScope: "none", provenance: "import", observedAt: at, id: 0 },
      observationId: null,
    };
  });
  const newestYesAt = Math.max(...[...authoritative, ...fromImport].filter((c) => c.sterilised).map((c) => c.at.getTime()));
  const candidates = [...authoritative, ...fromImport].filter((c) => c.sterilised || !(c.at.getTime() < newestYesAt));
  if (candidates.length > 0) {
    const winner = candidates.reduce((best, c) => (outranks(c.rank, best.rank) ? c : best));
    const disagreeing = candidates
      .filter((c) => c !== winner && c.sterilised !== winner.sterilised)
      .flatMap((c) => (c.observationId != null ? [c.observationId] : []));
    const newerClips = active
      .filter((o) => o.kind === "ear_tip" && o.observedAt.getTime() > winner.at.getTime())
      .flatMap((o) => {
        const p = frozenParseEarTip(o.value);
        return p?.clipped === true && o.photoId != null ? [o.id] : [];
      });
    return {
      value: winner.sterilised,
      confidence: "confirmed",
      supportingObservationIds: winner.observationId != null ? [winner.observationId] : [],
      conflicts: [...disagreeing, ...newerClips],
      asOf: frozenToIso(winner.at),
    };
  }
  const earTip = active.flatMap((o) => {
    if (o.kind !== "ear_tip") return [];
    const p = frozenParseEarTip(o.value);
    return p ? [{ o, clipped: p.clipped }] : [];
  });
  const clipped = earTip.filter((e) => e.clipped === true && e.o.photoId != null);
  const authFalse = earTip.filter((e) => e.clipped === false && frozenEarTipLevel(e.o) > 0);
  const survivors = clipped.filter((c) => !authFalse.some((af) => frozenClipCountered(af.o, c.o)));
  const supportingObservationIds = earTip.map((e) => e.o.id);
  if (survivors.length > 0) {
    return {
      value: true,
      confidence: "likely",
      supportingObservationIds,
      conflicts: [],
      asOf: frozenToIso(frozenNewest(survivors.map((s) => s.o))!.observedAt),
    };
  }
  return {
    value: null,
    confidence: "unknown",
    supportingObservationIds,
    conflicts: [],
    asOf: earTip.length > 0 ? frozenToIso(frozenNewest(earTip.map((e) => e.o))!.observedAt) : EPOCH,
  };
}

const LIFE: readonly LifeStatusValue[] = ["street", "homed", "in_care", "deceased"];
function frozenResolveLifeStatus(observations: readonly Observation[], evidenceOfLife: EvidenceOfLife | null, now: Date): LifeStatusResolved {
  const active = observations.filter((o) => o.kind === "life_status" && frozenIsActive(o, observations));
  const parsed = active.flatMap((o) => {
    const s = (o.value as { status?: unknown } | null)?.status;
    return typeof s === "string" && LIFE.includes(s as LifeStatusValue) ? [{ o, status: s as LifeStatusValue }] : [];
  });
  const newest = frozenNewest(parsed.map((p) => p.o));
  const entry = newest ? parsed.find((p) => p.o.id === newest.id) : undefined;
  let value: LifeStatusValue = entry ? entry.status : "street";
  const confidence: Confidence = entry ? "confirmed" : "unknown";
  let supportingObservationIds = entry ? [entry.o.id] : [];
  let conflicts: number[] = [];
  if (
    value === "deceased" &&
    entry &&
    evidenceOfLife?.lastSightingAt != null &&
    evidenceOfLife.lastSightingAt.getTime() > entry.o.observedAt.getTime()
  ) {
    conflicts = [entry.o.id];
    value = "street";
    supportingObservationIds = [];
  }
  const lifeAt = entry && entry.status !== "deceased" ? entry.o.observedAt.getTime() : null;
  let presumedDeceased = false;
  let notSeenSince: string | null = null;
  if (value !== "deceased") {
    const c = [evidenceOfLife ? evidenceOfLife.at.getTime() : null, lifeAt].filter((x): x is number => x != null);
    if (c.length > 0) {
      const latest = Math.max(...c);
      const threshold = new Date(latest);
      threshold.setUTCMonth(threshold.getUTCMonth() + 36);
      if (now.getTime() > threshold.getTime()) {
        presumedDeceased = true;
        notSeenSince = new Date(latest).toISOString();
      }
    }
  }
  const asOf = entry ? frozenToIso(entry.o.observedAt) : evidenceOfLife ? frozenToIso(evidenceOfLife.at) : EPOCH;
  return { value, confidence, supportingObservationIds, conflicts, asOf, presumedDeceased, notSeenSince };
}

/** mulberry32: a small seeded generator, so the 300 histories are the same every run. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AUTHORS: readonly Partial<Observation>[] = [
  { roleAtTime: "guardian", authorityScope: "colony:3", accountId: "g1" },
  { roleAtTime: "guardian", authorityScope: "colony:4", accountId: "g2" },
  { roleAtTime: "staff", accountId: "s1" },
  { roleAtTime: "management", accountId: "m1" },
  { roleAtTime: "public", deviceId: "p1", accountId: null },
  { roleAtTime: "public", deviceId: "p2", accountId: null },
  { roleAtTime: "public", authorityScope: "owner_of_this_cat", deviceId: "owner", accountId: null },
  { roleAtTime: "vet", accountId: "v1" },
  { roleAtTime: "system", accountId: "system:legacy-backfill", provenance: "import" },
];

interface History {
  rows: Observation[];
  evidence: EvidenceOfLife | null;
  longestChain: number;
}

function generateHistories(count: number, seed: number): History[] {
  const rand = seeded(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const now = new Date("2026-10-18T12:00:00Z").getTime();
  const out: History[] = [];
  let id = 100_000;
  for (let c = 0; c < count; c++) {
    const rows: Observation[] = [];
    const n = 1 + Math.floor(rand() * 12);
    for (let i = 0; i < n; i++) {
      const kind = pick(["sterilised", "sterilised", "ear_tip", "life_status", "vaccinated"] as const);
      const author = pick(AUTHORS);
      const observedAt = new Date(now - Math.floor(rand() * 5 * 365) * 86_400_000 - Math.floor(rand() * 86_400_000));
      const sameKind = rows.filter((r) => r.kind === kind);
      const supersedesId = sameKind.length > 0 && rand() < 0.4 ? pick(sameKind).id : null;
      let value: unknown;
      if (kind === "sterilised") value = { sterilised: rand() < 0.5 };
      else if (kind === "vaccinated") value = { vaccines: ["rabies"] };
      else if (kind === "ear_tip") value = { clipped: pick([true, false, "cant_tell"] as const) };
      else value = { status: pick(LIFE) };
      // Retraction-shaped junk on kinds the new rule must not touch.
      if ((kind === "ear_tip" || kind === "life_status") && supersedesId != null && rand() < 0.25) {
        value = { retracted: true, reason: "junk" };
      }
      rows.push(
        obs({
          id: id++,
          catId: c + 1,
          kind,
          value,
          observedAt,
          supersedesId,
          photoId: kind === "ear_tip" && rand() < 0.7 ? 1 : null,
          ...author,
        }),
      );
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const depth = (r: Observation): number => (r.supersedesId == null ? 0 : 1 + depth(byId.get(r.supersedesId)!));
    const evidenceAt = new Date(now - Math.floor(rand() * 6 * 365) * 86_400_000);
    out.push({
      rows,
      evidence: rand() < 0.2 ? null : { at: evidenceAt, source: "sighting", lastSightingAt: rand() < 0.5 ? evidenceAt : null },
      longestChain: Math.max(0, ...rows.map(depth)),
    });
  }
  return out;
}

describe("the replay check", () => {
  const histories = generateHistories(300, 396);
  const now = new Date("2026-10-18T12:00:00Z");

  it("is not vacuous: it has chains of length 1, 2 and 3, and junk retractions", () => {
    const chains = new Set(histories.map((h) => Math.min(h.longestChain, 3)));
    expect(chains).toEqual(new Set([0, 1, 2, 3]));
    const junk = histories.flatMap((h) => h.rows).filter((r) => (r.value as { retracted?: unknown }).retracted === true);
    expect(junk.length).toBeGreaterThan(10);
    expect(histories.filter((h) => h.rows.some((r) => r.kind === "sterilised" && r.supersedesId != null)).length).toBeGreaterThan(50);
  });

  it("resolveSterilised gives the old answer for every one of 300 histories", () => {
    for (const h of histories) {
      expect(resolveSterilised(h.rows)).toEqual(frozenResolveSterilised(h.rows));
    }
  });

  it("resolveLifeStatus gives the old answer for every one of 300 histories", () => {
    for (const h of histories) {
      expect(resolveLifeStatus(h.rows, h.evidence, now)).toEqual(frozenResolveLifeStatus(h.rows, h.evidence, now));
    }
  });
});

// ── Database-backed: the writer, evidence of life and the other readers ────

const NAME_PREFIX = "VitestRestore";
let catCounter = 0;

async function cleanup() {
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}
beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function insertCat() {
  catCounter += 1;
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}${catCounter}`,
      description: "",
      primaryPhotoId: 0,
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: "vitest-restore-discoverer",
    })
    .returning();
  return cat!;
}

const run = `${Date.now()}`;
const HER = `vitest-restore-guardian-${run}`;
const TEAM = `vitest-restore-staff-${run}`;
const MONTH = 30 * 86_400_000;

function put(input: Omit<WriteObservationInput, "observedAt"> & { observedAt?: Date }) {
  return writeObservation(db, { observedAt: new Date(), ...input });
}

/** Her standing "no" (dated `herDay`), overruled by a vet visit's "yes" (D8). */
async function overruledCat(herDay: Date, visitDay: Date) {
  const cat = await insertCat();
  const no = await put({
    catId: cat.id,
    kind: "sterilised",
    value: { sterilised: false },
    accountId: HER,
    roleAtTime: "guardian",
    authorityScope: "colony:1",
    observedAt: herDay,
  });
  const visit = await put({
    catId: cat.id,
    kind: "vet_visit",
    value: { did: ["sterilised"], clinicId: "symviosis", costEur: 55, paidBy: "syros_cats" },
    accountId: TEAM,
    roleAtTime: "staff",
    observedAt: visitDay,
  });
  const yes = await put({
    catId: cat.id,
    kind: "sterilised",
    value: { sterilised: true, clinic: "Symviosis", vetVisitId: visit.id, reason: "vet visit" },
    accountId: TEAM,
    roleAtTime: "staff",
    observedAt: visitDay,
    supersedesId: no.id,
    supersedeReason: "vet visit on 13 Aug 2026",
  });
  return { cat, no, visit, yes };
}

/** What undoVetVisit (PR 3.1) will write: the visit's rows, then the visit. */
async function undo(catId: number, ...rows: Observation[]) {
  const out: Observation[] = [];
  for (const row of rows) {
    out.push(
      await put({
        catId,
        kind: row.kind as WriteObservationInput["kind"],
        value: { retracted: true, reason: "wrong cat" },
        accountId: TEAM,
        roleAtTime: "staff",
        supersedesId: row.id,
        fromVisitUndo: true,
      }),
    );
  }
  return out;
}

describe("evidence of life", () => {
  it("loadCatRecords reports source vet_visit when the visit is the newest evidence", async () => {
    const cat = await insertCat();
    const at = new Date(Date.now() - 86_400_000);
    await put({
      catId: cat.id,
      kind: "vet_visit",
      value: { did: ["checked"], clinicId: "dermitzaki", costEur: null, paidBy: "owner" },
      accountId: TEAM,
      roleAtTime: "staff",
      observedAt: at,
    });
    const records = (await loadCatRecords([cat.id])).get(cat.id)!;
    expect(records.evidenceOfLife).toMatchObject({ source: "vet_visit", at });
  });

  it("a retraction is never evidence of life: undoing a visit on a cat last seen 40 months ago leaves it presumed deceased", async () => {
    const herDay = new Date(Date.now() - 40 * MONTH);
    const { cat, visit, yes } = await overruledCat(herDay, new Date(Date.now() - 86_400_000));
    const before = (await loadCatRecords([cat.id])).get(cat.id)!;
    expect(before.evidenceOfLife?.at.getTime()).toBeGreaterThan(herDay.getTime());

    await undo(cat.id, yes, visit);
    const after = (await loadCatRecords([cat.id])).get(cat.id)!;
    expect(after.evidenceOfLife).toMatchObject({ source: "sterilised", at: herDay });
    const life = resolveLifeStatus(after.observations, after.evidenceOfLife, new Date());
    expect(life.presumedDeceased).toBe(true);
  });
});

describe("the other readers agree with the resolver (G ← Y ← R shows G standing)", () => {
  const herDay = new Date(Date.now() - 5 * 86_400_000);
  const visitDay = new Date(Date.now() - 10 * 86_400_000);

  it("the resolver: the visit's yes wins, and undoing it brings her no back", async () => {
    const { cat, visit, yes, no } = await overruledCat(herDay, visitDay);
    const read = async () => {
      const r = (await loadCatRecords([cat.id])).get(cat.id)!;
      return resolveSterilised(r.observations);
    };
    expect(await read()).toMatchObject({ value: true, confidence: "confirmed", supportingObservationIds: [yes.id] });
    await undo(cat.id, yes, visit);
    expect(await read()).toMatchObject({ value: false, confidence: "confirmed", supportingObservationIds: [no.id] });
  });

  it("guardianChanges: her statement stands again, and the overrule is shown as put back", async () => {
    const kept = await overruledCat(herDay, visitDay);
    const undone = await overruledCat(herDay, visitDay);
    await undo(undone.cat.id, undone.yes, undone.visit);
    const list = await listGuardianChanges({ limit: 1000 });
    const statementOf = (id: number) => list.find((c) => c.type === "statement" && c.statementId === id);
    const overruleOf = (id: number) => list.find((c) => c.type === "overruled" && c.statementId === id);

    expect(statementOf(kept.no.id)).toMatchObject({ standing: false });
    expect(overruleOf(kept.yes.id)).toMatchObject({ overruledId: kept.no.id, putBack: false });

    expect(statementOf(undone.no.id)).toMatchObject({ standing: true, contradictsTeam: false });
    expect(overruleOf(undone.yes.id)).toMatchObject({ overruledId: undone.no.id, putBack: true });
  });

  it("teamCatView: the history marks her statement standing and markable, and the visit's yes replaced", async () => {
    const { cat, visit, yes, no } = await overruledCat(herDay, visitDay);
    const [undoYes] = await undo(cat.id, yes, visit);
    const view = (await teamCatView(cat.id))!;
    const row = (id: number) => view.history.find((s) => s.id === id)!;
    expect(view.records.sterilised.value).toBe(false);
    expect(row(no.id)).toMatchObject({ replacedBy: [], correction: { kind: "sterilised", now: false } });
    expect(row(yes.id)).toMatchObject({ replacedBy: [undoYes!.id], correction: null });
    expect(row(undoYes!.id)).toMatchObject({ said: "Marked wrong", correction: null });
  });

  it("guardianStatements: once the visit is undone she no longer sees Syros Cats looking again", async () => {
    const kept = await overruledCat(herDay, visitDay);
    const undone = await overruledCat(herDay, visitDay);
    await undo(undone.cat.id, undone.yes, undone.visit);
    expect((await myStatementsOnCat(HER, kept.cat.id)).lookedAgain).toHaveLength(1);
    expect((await myStatementsOnCat(HER, undone.cat.id)).lookedAgain).toEqual([]);
  });

  it("Mark wrong can reach her restored statement, and not the undone yes", async () => {
    const { cat, visit, yes, no } = await overruledCat(herDay, visitDay);
    await undo(cat.id, yes, visit);
    await db.transaction(async (tx) => {
      await expect(lockActiveObservation(tx, no.id)).resolves.toMatchObject({ id: no.id });
      await expect(lockActiveObservation(tx, yes.id)).rejects.toMatchObject({ code: "ALREADY_SUPERSEDED" });
    });
  });

  it("the writer links a statement only to a standing visit", async () => {
    const { cat, visit, yes } = await overruledCat(herDay, visitDay);
    await undo(cat.id, yes, visit);
    await expect(
      put({
        catId: cat.id,
        kind: "vaccinated",
        value: { vaccines: ["rabies"], vetVisitId: visit.id },
        accountId: TEAM,
        roleAtTime: "staff",
      }),
    ).rejects.toMatchObject({ code: "INVALID_VISIT_LINK" });
  });
});
