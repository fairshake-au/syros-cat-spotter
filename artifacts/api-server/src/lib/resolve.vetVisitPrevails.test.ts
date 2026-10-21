import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import type { Observation } from "@workspace/db/schema";
import { db, pool, catsTable } from "@workspace/db";
import { like } from "drizzle-orm";
import { commitStatement } from "./commitStatement";
import { loadCatRecords, type VetVisitValue } from "./observations";
import {
  authorityLevel,
  outranks,
  resolveSterilised,
  standingRows,
  type ImportRecord,
  type Resolved,
} from "./resolve";
import { logVetVisit, undoVetVisit } from "./vetVisits";
import { teamCatView } from "./teamCatView";

// SYC-543 (Samuel, 21 Oct 2026): "a vet visit in which the cat was
// sterilised should always prevail". While a visit's "yes" stands, the cat
// is Sterilised / confirmed, whoever said "not sterilised" and whenever,
// even after the visit. Undoing the visit is the only way back, and then
// every other answer stands again as before. Every "no" the visit outweighs
// is a conflict, so the team cat page shows it under "Says otherwise".
//
// Database-backed, against the shared test database: every assertion is on
// this run's own fresh cats.

const RUN = randomBytes(3).toString("hex");
const NAME_PREFIX = `VitestVisitPrevails${RUN}`;
let n = 0;

const STAFF = { id: `vitest-vp-staff-${RUN}`, scopes: [{ role: "staff", colonyId: null }] };
const GUARDIAN_ID = `vitest-vp-guardian-${RUN}`;
const NOW = new Date("2026-10-21T10:00:00Z");
const STERILISED: VetVisitValue = { did: ["sterilised"], clinicId: "symviosis", costEur: 60, paidBy: "syros_cats" };

async function cleanup() {
  await db.delete(catsTable).where(like(catsTable.name, `${NAME_PREFIX}%`));
}
beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

async function insertCat() {
  n += 1;
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: `${NAME_PREFIX}-${n}`,
      description: "",
      primaryPhotoId: 0,
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: "vitest-vp-discoverer",
    })
    .returning();
  return cat!.id;
}

const at = (day: string) => new Date(`${day}T12:00:00Z`);

/** A team member's plain "not sterilised" (no visit), dated `day`. */
function teamSays(catId: number, sterilised: boolean, day: string) {
  return db.transaction((tx) =>
    commitStatement(
      tx,
      { catId, kind: "sterilised", value: { sterilised }, accountId: STAFF.id, roleAtTime: "staff", observedAt: at(day) },
      [],
      NOW,
    ),
  );
}

/** A cat guardian's "not sterilised", dated `day`. */
function guardianSaysNo(catId: number, day: string) {
  return db.transaction((tx) =>
    commitStatement(
      tx,
      {
        catId,
        kind: "sterilised",
        value: { sterilised: false },
        accountId: GUARDIAN_ID,
        roleAtTime: "guardian",
        authorityScope: "colony:1",
        observedAt: at(day),
      },
      [],
      NOW,
    ),
  );
}

async function sterilisedOf(catId: number) {
  const record = (await loadCatRecords([catId])).get(catId);
  return resolveSterilised(record?.observations ?? [], []);
}

const visit = (catId: number, date: string) => logVetVisit(STAFF, { catId, date, value: STERILISED }, NOW);
const undo = (visitId: number) => undoVetVisit(STAFF, visitId, "Logged on the wrong cat", NOW);

describe("a standing vet visit's 'sterilised' always prevails", () => {
  it("a team 'no' dated after the visit loses, and shows as a conflict", async () => {
    const catId = await insertCat();
    const saved = await visit(catId, "2026-08-13");
    const teamNo = await teamSays(catId, false, "2026-09-01");

    const answer = await sterilisedOf(catId);
    expect(answer.value).toBe(true);
    expect(answer.confidence).toBe("confirmed");
    expect(answer.supportingObservationIds).toEqual(saved.sterilisedIds);
    expect(answer.asOf).toBe(at("2026-08-13").toISOString());
    expect(answer.conflicts).toEqual([teamNo.id]);
  });

  it("undoing the visit brings the team's 'no' back", async () => {
    const catId = await insertCat();
    const saved = await visit(catId, "2026-08-13");
    const teamNo = await teamSays(catId, false, "2026-09-01");
    await undo(saved.visitId);

    const answer = await sterilisedOf(catId);
    expect(answer.value).toBe(false);
    expect(answer.confidence).toBe("confirmed");
    expect(answer.supportingObservationIds).toEqual([teamNo.id]);
    expect(answer.conflicts).toEqual([]);
  });

  it("a guardian 'no' entered after the visit loses, and shows as a conflict", async () => {
    const catId = await insertCat();
    const saved = await visit(catId, "2026-08-13");
    // Nothing to overrule when the visit was saved, so D8 wrote a plain row.
    expect(saved.overruled).toEqual([]);
    const hers = await guardianSaysNo(catId, "2026-09-01");

    const answer = await sterilisedOf(catId);
    expect(answer.value).toBe(true);
    expect(answer.confidence).toBe("confirmed");
    expect(answer.supportingObservationIds).toEqual(saved.sterilisedIds);
    expect(answer.conflicts).toEqual([hers.id]);
  });

  it("undoing the visit brings the guardian's later 'no' back", async () => {
    const catId = await insertCat();
    const saved = await visit(catId, "2026-08-13");
    const hers = await guardianSaysNo(catId, "2026-09-01");
    await undo(saved.visitId);

    const answer = await sterilisedOf(catId);
    expect(answer.value).toBe(false);
    expect(answer.supportingObservationIds).toEqual([hers.id]);
  });

  it("D8 is unchanged: a guardian's standing 'no' is overruled visibly, and undo stands it back up", async () => {
    const catId = await insertCat();
    const hers = await guardianSaysNo(catId, "2026-08-20");
    const saved = await visit(catId, "2026-08-13");
    expect(saved.overruled).toEqual([hers.id]);
    expect((await sterilisedOf(catId)).value).toBe(true);
    // Overruled, not standing, so not a conflict either.
    expect((await sterilisedOf(catId)).conflicts).toEqual([]);

    await undo(saved.visitId);
    const answer = await sterilisedOf(catId);
    expect(answer.value).toBe(false);
    expect(answer.supportingObservationIds).toEqual([hers.id]);
  });

  it("two visits, one undone: still sterilised", async () => {
    const catId = await insertCat();
    const first = await visit(catId, "2026-07-01");
    const second = await visit(catId, "2026-08-13");
    const teamNo = await teamSays(catId, false, "2026-09-01");
    await undo(second.visitId);

    const answer = await sterilisedOf(catId);
    expect(answer.value).toBe(true);
    expect(answer.supportingObservationIds).toEqual(first.sterilisedIds);
    expect(answer.conflicts).toEqual([teamNo.id]);

    await undo(first.visitId);
    expect((await sterilisedOf(catId)).value).toBe(false);
  });

  it("the team cat page lists the outweighed team 'no' under Says otherwise", async () => {
    const catId = await insertCat();
    const saved = await visit(catId, "2026-08-13");
    const teamNo = await teamSays(catId, false, "2026-09-01");
    const view = await teamCatView(catId, NOW);
    expect(view!.records.sterilised.value).toBe(true);
    expect(view!.records.sterilised.supportingStatementIds).toEqual(saved.sterilisedIds);
    expect(view!.records.sterilised.conflictingStatementIds).toEqual([teamNo.id]);
  });
});

describe("a sterilisation recorded without a visit is unchanged", () => {
  it("Decision G: a newer team 'no' beats an older plain team 'yes'", async () => {
    const catId = await insertCat();
    const yes = await teamSays(catId, true, "2026-08-13");
    const no = await teamSays(catId, false, "2026-09-01");
    const answer = await sterilisedOf(catId);
    expect(answer.value).toBe(false);
    expect(answer.supportingObservationIds).toEqual([no.id]);
    expect(answer.conflicts).toEqual([yes.id]);
  });

  it("Decision G: a guardian's 'no' outranks a newer plain team 'yes'... unless the yes is newer (SYC-315 B)", async () => {
    const catId = await insertCat();
    const hers = await guardianSaysNo(catId, "2026-09-01");
    await teamSays(catId, true, "2026-08-13");
    expect((await sterilisedOf(catId)).supportingObservationIds).toEqual([hers.id]);

    const later = await teamSays(catId, true, "2026-09-10");
    const answer = await sterilisedOf(catId);
    expect(answer.value).toBe(true);
    expect(answer.supportingObservationIds).toEqual([later.id]);
  });
});

// ── The replay check: cats with no visit keep exactly today's answer ──────
//
// A frozen copy of resolveSterilised as it stood on origin/main at 54e73a0b,
// before SYC-543 (it reads `standingRows`, which this change leaves alone).
// 400 seeded histories with every kind of author, supersede chains,
// retractions of sterilisation rows (as an undo writes) and import records,
// but no row that names a visit.

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
function frozenNewest<T extends Observation>(list: readonly T[]): T | undefined {
  if (list.length === 0) return undefined;
  return list.reduce((m, c) => {
    const a = m.observedAt.getTime();
    const b = c.observedAt.getTime();
    if (b > a) return c;
    if (b === a && c.id > m.id) return c;
    return m;
  });
}
const iso = (d: Date | string) => (typeof d === "string" ? new Date(d).toISOString() : d.toISOString());

function frozenResolveSterilised(observations: readonly Observation[], importRecords: readonly ImportRecord[] = []): Resolved<boolean> {
  const standing = new Set(standingRows(observations, "sterilised").map((o) => o.id));
  const active = observations.filter((o) =>
    o.kind === "sterilised" ? standing.has(o.id) : !observations.some((x) => x.supersedesId === o.id),
  );
  type Candidate = { sterilised: boolean; at: Date; rank: Parameters<typeof outranks>[0]; observationId: number | null };
  const authoritative: Candidate[] = active
    .filter((o) => o.kind === "sterilised" && authorityLevel(o) > 0)
    .flatMap((o) => {
      const p = frozenParseSterilised(o.value);
      return p ? [{ sterilised: p.sterilised, at: o.observedAt, rank: o, observationId: o.id }] : [];
    });
  const fromImport: Candidate[] = importRecords.map((r) => {
    const a = new Date(r.observedAt);
    return {
      sterilised: r.sterilised,
      at: a,
      rank: { roleAtTime: "system", authorityScope: "none", provenance: "import", observedAt: a, id: 0 },
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
      asOf: iso(winner.at),
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
      asOf: iso(frozenNewest(survivors.map((s) => s.o))!.observedAt),
    };
  }
  return {
    value: null,
    confidence: "unknown",
    supportingObservationIds,
    conflicts: [],
    asOf: earTip.length > 0 ? iso(frozenNewest(earTip.map((e) => e.o))!.observedAt) : new Date(0).toISOString(),
  };
}

/** mulberry32: a small seeded generator, so the histories are the same every run. */
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
  { roleAtTime: "public", authorityScope: "owner_of_this_cat", deviceId: "owner", accountId: null },
  { roleAtTime: "vet", accountId: "v1" },
  { roleAtTime: "system", accountId: "system:legacy-backfill", provenance: "import" },
];

function row(o: Partial<Observation> & { id: number; kind: string; value: unknown; observedAt: Date }): Observation {
  return {
    catId: 1,
    deviceId: null,
    accountId: "someone",
    roleAtTime: "staff",
    authorityScope: "none",
    provenance: "volunteered",
    suggestedValue: null,
    suggestionSource: null,
    sightingId: null,
    photoId: null,
    importRecordId: null,
    createdAt: o.observedAt,
    supersedesId: null,
    supersedeReason: null,
    redactedAt: null,
    redactionReason: null,
    ...o,
  } as Observation;
}

interface History {
  rows: Observation[];
  imports: ImportRecord[];
}

function generateHistories(count: number, seed: number): History[] {
  const rand = seeded(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const now = new Date("2026-10-21T12:00:00Z").getTime();
  const out: History[] = [];
  let id = 200_000;
  for (let c = 0; c < count; c++) {
    const rows: Observation[] = [];
    const total = 1 + Math.floor(rand() * 12);
    for (let i = 0; i < total; i++) {
      const kind = pick(["sterilised", "sterilised", "sterilised", "ear_tip"] as const);
      const observedAt = new Date(now - Math.floor(rand() * 5 * 365) * 86_400_000 - Math.floor(rand() * 86_400_000));
      const sameKind = rows.filter((r) => r.kind === kind);
      const supersedesId = sameKind.length > 0 && rand() < 0.4 ? pick(sameKind).id : null;
      let value: unknown =
        kind === "sterilised" ? { sterilised: rand() < 0.5, reason: rand() < 0.3 ? "clinic list" : undefined } : { clipped: pick([true, false, "cant_tell"] as const) };
      // An undo's retraction, on sterilisation rows (the restore rule's kind).
      if (kind === "sterilised" && supersedesId != null && rand() < 0.3) value = { retracted: true, reason: "wrong cat" };
      rows.push(
        row({ id: id++, catId: c + 1, kind, value, observedAt, supersedesId, photoId: kind === "ear_tip" && rand() < 0.7 ? 1 : null, ...pick(AUTHORS) }),
      );
    }
    const imports: ImportRecord[] =
      rand() < 0.2
        ? [{ id: c + 1, sterilised: rand() < 0.5, observedAt: new Date(now - Math.floor(rand() * 8 * 365) * 86_400_000).toISOString() }]
        : [];
    out.push({ rows, imports });
  }
  return out;
}

describe("the replay check", () => {
  const histories = generateHistories(400, 543);

  it("is not vacuous: retractions, import records, and both answers and every confidence occur", () => {
    const all = histories.flatMap((h) => h.rows);
    expect(all.filter((r) => (r.value as { retracted?: unknown }).retracted === true).length).toBeGreaterThan(30);
    expect(histories.filter((h) => h.imports.length > 0).length).toBeGreaterThan(30);
    const answers = histories.map((h) => frozenResolveSterilised(h.rows, h.imports));
    expect(new Set(answers.map((a) => `${a.value}/${a.confidence}`))).toEqual(
      new Set(["true/confirmed", "false/confirmed", "true/likely", "null/unknown"]),
    );
    // Many cats where a "no" that wasn't set aside is the answer or a conflict.
    expect(answers.filter((a) => a.value === false).length).toBeGreaterThan(40);
  });

  it("no history names a visit, so none is outside what this check covers", () => {
    const named = histories.flatMap((h) => h.rows).filter((r) => typeof (r.value as { vetVisitId?: unknown }).vetVisitId === "number");
    expect(named).toEqual([]);
  });

  it("resolveSterilised gives today's answer for every one of 400 histories", () => {
    for (const h of histories) {
      expect(resolveSterilised(h.rows, h.imports)).toEqual(frozenResolveSterilised(h.rows, h.imports));
    }
  });

  it("the check can tell: the same histories with a visit's yes added change many answers", () => {
    let changed = 0;
    for (const h of histories) {
      const oldest = new Date("2021-01-01T12:00:00Z");
      const withVisit = [
        ...h.rows,
        row({ id: 900_000, kind: "sterilised", value: { sterilised: true, vetVisitId: 899_999, reason: "vet visit" }, observedAt: oldest }),
      ];
      const answer = resolveSterilised(withVisit, h.imports);
      expect(answer.value).toBe(true);
      expect(answer.supportingObservationIds).toEqual([900_000]);
      if (frozenResolveSterilised(withVisit, h.imports).value !== true) changed += 1;
    }
    expect(changed).toBeGreaterThan(40);
  });
});
