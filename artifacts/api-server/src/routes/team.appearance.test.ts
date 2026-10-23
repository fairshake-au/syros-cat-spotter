import { deleteTestSightings } from "../test/sightings";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, like } from "drizzle-orm";
import {
  addPerson,
  catsTable,
  db,
  markLeft,
  observationsTable,
  photosTable,
  pool,
  sightingMatchesTable,
  sightingsTable,
  type Observation,
} from "@workspace/db";
import app from "../app";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import { signInThroughHandoff, TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { loadCatRecords } from "../lib/observations";
import { resolveCat } from "../lib/resolve";
import { correctAppearance } from "../lib/teamCorrections";
import type { ColourCheckCat } from "../lib/colourCheck";

// SYC-2 PR 3.1 (plan "Slice 3", PR 3.1; spec §4.4, §5.3, §10.3): the team's
// Confirm, Correct and Mark wrong for a cat's colour and markings, a team
// Correct overruling a cat guardian (Decision G, T-overrule), and the
// Colour check list.
//
// Cat guardian rows are seeded directly: `guardian` is not reachable in
// writeObservation until SYC-53's PR 2.2, but the resolver already ranks
// her `colony:<id>` statements above the team's (Decision G).
//
// A non-holder: today every staff member holds every capability, so `can`
// is wrapped, as in team.corrections.test.ts: `denied.cap` is refused to
// everyone.
const denied = vi.hoisted(() => ({ cap: null as string | null }));
vi.mock("../lib/capabilities", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/capabilities")>();
  return {
    ...real,
    can: (...args: Parameters<typeof real.can>) =>
      args[1] === denied.cap ? false : real.can(...args),
  };
});

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-app-${RUN}-`;
const SUSAN = `vitest-app-susan-${RUN}@example.com`;
const KEY = "vitest-app-key-0123456789abcdef-0123456789abc";
const handoffKey = makeKey();
const DAY = 86_400_000;

let cookie: string;
let susanId: string;
let n = 0;

async function cleanup() {
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  await db.delete(photosTable).where(like(photosTable.publicId, `${PREFIX}%`));
}

async function photo(): Promise<number> {
  n += 1;
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}photo-${n}`, data: Buffer.from(`fake ${n}`).toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  return p!.id;
}

async function newCat(): Promise<number> {
  n += 1;
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}cat-${n}`,
      description: "",
      primaryPhotoId: await photo(),
      lat: 37.445,
      lng: 24.942,
      discovererDeviceId: `${PREFIX}finder`,
    })
    .returning({ id: catsTable.id });
  return c!.id;
}

type Seed = {
  value: Record<string, unknown>;
  daysAgo?: number;
  supersedesId?: number;
  sightingId?: number;
  photoId?: number | null;
};

const at = (daysAgo = 1) => new Date(Date.now() - daysAgo * DAY);

async function insert(row: typeof observationsTable.$inferInsert): Promise<Observation> {
  const [o] = await db.insert(observationsTable).values(row).returning();
  return o!;
}

/** A spotter's colour or markings answer, from its own device, with its own photo. */
async function spotter(catId: number, kind: "coat" | "markings", device: string, s: Seed) {
  return insert({
    catId,
    kind,
    value: s.value,
    deviceId: `${PREFIX}${device}`,
    roleAtTime: "public",
    provenance: "volunteered",
    observedAt: at(s.daysAgo),
    photoId: s.photoId === undefined ? await photo() : s.photoId,
    sightingId: s.sightingId ?? null,
    supersedesId: s.supersedesId ?? null,
  });
}

/** The photo reader's reading (SYC-161's row shape). */
async function machine(catId: number, colours: string[], daysAgo = 3, source = "coat-reader") {
  return insert({
    catId,
    kind: "coat",
    value: { colours, modelVersion: "gpt-test-1" },
    accountId: "system:vision",
    roleAtTime: "system",
    provenance: "machine",
    suggestionSource: source,
    suggestedValue: { colours, confidence: 0.93, cats: 1 },
    observedAt: at(daysAgo),
    photoId: await photo(),
  });
}

/** A cat guardian's statement (seeded directly; see the file comment). */
async function guardian(catId: number, kind: "coat" | "markings", who: string, s: Seed) {
  return insert({
    catId,
    kind,
    value: { ...s.value, reason: "Seen at feeding" },
    accountId: `${PREFIX}${who}`,
    roleAtTime: "guardian",
    authorityScope: "colony:1",
    observedAt: at(s.daysAgo),
    supersedesId: s.supersedesId ?? null,
  });
}

/** A team statement, as an earlier team member wrote it. */
async function team(catId: number, kind: "coat" | "markings", s: Seed) {
  return insert({
    catId,
    kind,
    value: { ...s.value, reason: "Earlier note" },
    accountId: susanId,
    roleAtTime: "staff",
    observedAt: at(s.daysAgo),
  });
}

const rowsFor = (catId: number) =>
  db.select().from(observationsTable).where(eq(observationsTable.catId, catId)).orderBy(observationsTable.id);

async function snapshot(catId: number) {
  const r = (await loadCatRecords([catId])).get(catId)!;
  return resolveCat(r.observations, r.evidenceOfLife, new Date());
}

const form = (path: string) =>
  request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", cookie).type("form");
const json = (path: string) =>
  request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", cookie).set("Accept", "application/json");

/** A page without the Correct form's pattern hints (SYC-443 T3A), the one
 * place lower-case breeders' words belong; each hint must be there to remove. */
function withoutHints(html: string): string {
  let out = html;
  for (const hint of ["(stripes, swirls or spots)", "(tortoiseshell, calico, black and white…)"]) {
    expect(out, hint).toContain(hint);
    out = out.split(hint).join("");
  }
  return out;
}

const confirm = (catId: number, kind: "coat" | "markings", extra: Record<string, string> = {}) =>
  form(`/api/team/cats/${catId}/appearance/confirm`).send({ kind, ...extra });

async function colourCheck(): Promise<ColourCheckCat[]> {
  const res = await request(app)
    .get("/api/team/colour-check")
    .set("Cookie", cookie)
    .set("Accept", "application/json");
  expect(res.status).toBe(200);
  return res.body.cats as ColourCheckCat[];
}
const listed = async (catId: number) => (await colourCheck()).find((c) => c.catId === catId);

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await cleanup();
  susanId = (await addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:vitest", roles: ["staff"] })).id;
  cookie = await signInThroughHandoff(app, handoffKey, susanId);
});

beforeEach(() => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  denied.cap = null;
});

afterAll(async () => {
  await cleanup();
  await markLeft(SUSAN, "cli:vitest");
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

// ── Confirm ────────────────────────────────────────────────────────────────

describe("Confirm", () => {
  it("writes one team statement linked by agreesWith, with no photo, and the colour becomes confirmed", async () => {
    const catId = await newCat();
    const reading = await machine(catId, ["ginger", "tabby"]);
    const before = await rowsFor(catId);

    // SYC-398: the stored v1 reading Ginger · Tabby is Ginger · Stripes, and
    // the page sends each part on its own.
    const res = await confirm(catId, "coat", { expectedColours: "ginger", expectedPattern: "stripes" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/cats/${catId}?done=a_confirmed#appearance`);

    const added = (await rowsFor(catId)).slice(before.length);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      kind: "coat",
      value: { colours: ["ginger"], pattern: "stripes", agreesWith: reading.id, reason: "Looks right" },
      accountId: susanId,
      roleAtTime: "staff",
      photoId: null,
      supersedesId: null,
    });
    const snap = await snapshot(catId);
    expect(snap.coatColours).toMatchObject({ value: ["ginger"], confidence: "confirmed" });
    expect(snap.coatPattern).toMatchObject({ value: "stripes", confidence: "confirmed" });
  });

  it("SYC-398: Confirm states only the parts that are known", async () => {
    const catId = await newCat();
    await machine(catId, ["grey"]);
    const before = await rowsFor(catId);
    const res = await confirm(catId, "coat", { expectedColours: "grey", expectedPattern: "" });
    expect(res.status).toBe(303);
    const [added] = (await rowsFor(catId)).slice(before.length);
    expect(added!.value).toEqual({ colours: ["grey"], agreesWith: expect.any(Number), reason: "Looks right" });
    expect(added!.value).not.toHaveProperty("pattern");
    expect((await snapshot(catId)).coatPattern.value).toBeNull();
  });

  it("SYC-398: Confirm compares each part with what the page showed", async () => {
    const catId = await newCat();
    await machine(catId, ["ginger", "tabby"]);
    for (const shown of [
      { expectedColours: "ginger", expectedPattern: "" },
      { expectedColours: "ginger", expectedPattern: "plain" },
      { expectedColours: "brown", expectedPattern: "stripes" },
    ]) {
      const res = await confirm(catId, "coat", shown);
      expect(res.headers["location"], JSON.stringify(shown)).toContain("done=a_changed");
    }
    // One part alone never vouches for the other (JSON callers).
    const half = await json(`/api/team/cats/${catId}/appearance/confirm`).send({ kind: "coat", expectedColours: ["ginger"] });
    expect([half.status, half.body.code]).toEqual([409, "CHANGED"]);
    // A page drawn before SYC-398 sent the old codes: read through the translation.
    const stale = await confirm(catId, "coat", { expected: "ginger,tabby" });
    expect(stale.headers["location"]).toContain("done=a_confirmed");
  });

  it("confirms the markings as they resolve, nothing special included", async () => {
    const catId = await newCat();
    await team(catId, "markings", { value: { marks: [] }, daysAgo: 5 });
    const res = await confirm(catId, "markings", { expected: "" });
    expect(res.status).toBe(303);
    const last = (await rowsFor(catId)).at(-1)!;
    expect(last.value).toMatchObject({ marks: [], reason: "Looks right" });
  });

  it("with nothing known, writes nothing (a_nothing; JSON 409)", async () => {
    const catId = await newCat();
    const res = await confirm(catId, "coat");
    expect(res.headers["location"]).toContain("done=a_nothing");
    const j = await json(`/api/team/cats/${catId}/appearance/confirm`).send({ kind: "markings" });
    expect([j.status, j.body.code]).toEqual([409, "NOTHING_TO_CONFIRM"]);
    expect(await rowsFor(catId)).toHaveLength(0);
  });

  it("a page out of date confirms nothing (a_changed)", async () => {
    const catId = await newCat();
    await machine(catId, ["black"]);
    const res = await confirm(catId, "coat", { expected: "ginger" });
    expect(res.headers["location"]).toContain("done=a_changed");
    expect(await rowsFor(catId)).toHaveLength(1);
  });

  it("on a cat guardian's statement, records the team's agreement and changes nothing the public sees", async () => {
    const catId = await newCat();
    await guardian(catId, "coat", "eleni", { value: { colours: ["grey"] }, daysAgo: 4 });
    await team(catId, "coat", { value: { colours: ["black"] }, daysAgo: 1 });
    expect((await snapshot(catId)).coatColours.value).toEqual(["grey"]);
    const res = await confirm(catId, "coat", { expected: "grey" });
    expect(res.status).toBe(303);
    expect((await snapshot(catId)).coatColours).toMatchObject({ value: ["grey"], confidence: "confirmed" });
  });

  it("goes back to the Colour check list when sent from it", async () => {
    const catId = await newCat();
    await machine(catId, ["black"]);
    const res = await confirm(catId, "coat", { back: "colour" });
    expect(res.headers["location"]).toBe(`/api/team/colour-check?done=a_confirmed#c-${catId}`);
  });
});

// ── Correct ────────────────────────────────────────────────────────────────

describe("Correct", () => {
  const correct = (catId: number, body: Record<string, unknown>) =>
    form(`/api/team/cats/${catId}/appearance/correct`).send(body);

  it("needs a reason; writes nothing without one", async () => {
    const catId = await newCat();
    const res = await correct(catId, { kind: "coat", colours: "ginger", reason: " " });
    expect(res.status).toBe(400);
    expect(await rowsFor(catId)).toHaveLength(0);
  });

  it("stores black and white as two colours (SYC-398 §6), in display order", async () => {
    const catId = await newCat();
    const res = await correct(catId, { kind: "coat", colours: ["white", "black"], reason: "Saw her" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/cats/${catId}?done=a_coat_corrected#appearance`);
    const [row] = await rowsFor(catId);
    expect(row!.value).toEqual({ colours: ["black", "white"], reason: "Saw her" });
    expect((await snapshot(catId)).coatColours).toMatchObject({ value: ["black", "white"], confidence: "confirmed" });
  });

  it("SYC-398: a colours-only Correct leaves an earlier team pattern standing", async () => {
    const catId = await newCat();
    await machine(catId, ["ginger", "tabby"]);
    // The team confirms Ginger · Stripes, then corrects the colours only.
    expect((await confirm(catId, "coat", { expectedColours: "ginger", expectedPattern: "stripes" })).status).toBe(303);
    expect((await correct(catId, { kind: "coat", colours: ["brown", "ginger"], reason: "x" })).status).toBe(303);
    const snap = await snapshot(catId);
    expect(snap.coatColours).toMatchObject({ value: ["brown", "ginger"], confidence: "confirmed" });
    expect(snap.coatPattern).toMatchObject({ value: "stripes", confidence: "confirmed" });
  });

  it("SYC-398: a JSON Confirm may send expectedPattern null for no pattern shown", async () => {
    const catId = await newCat();
    await machine(catId, ["grey"]);
    const res = await json(`/api/team/cats/${catId}/appearance/confirm`).send({
      kind: "coat",
      expectedColours: ["grey"],
      expectedPattern: null,
    });
    expect(res.status).toBe(201);
  });

  it("SYC-398: takes every colour seen, all five if need be, with no limit", async () => {
    const catId = await newCat();
    const res = await correct(catId, { kind: "coat", colours: ["white", "brown", "ginger", "grey", "black"], reason: "x" });
    expect(res.status).toBe(303);
    const [row] = await rowsFor(catId);
    expect(row!.value).toEqual({ colours: ["black", "grey", "brown", "ginger", "white"], reason: "x" });
  });

  it("refuses an old code, none, and Not sure", async () => {
    const catId = await newCat();
    for (const colours of [["ginger", "tabby", "grey"], ["black_and_white"], [], ["not_sure"]]) {
      const res = await correct(catId, { kind: "coat", colours, reason: "x" });
      expect(res.status, JSON.stringify(colours)).toBe(400);
    }
    expect(await rowsFor(catId)).toHaveLength(0);
  });

  it("a team list may hold five marks; none ticked is nothing special; JSON without marks is refused", async () => {
    const catId = await newCat();
    const five = ["white_paws", "white_chest", "white_face", "long_fur", "kinked_tail"];
    expect((await correct(catId, { kind: "markings", marks: ["", ...five], reason: "Close look" })).status).toBe(303);
    expect((await snapshot(catId)).markings.value).toEqual(five);

    // The form's hidden empty `marks` alone: nothing ticked.
    expect((await correct(catId, { kind: "markings", marks: "", reason: "Looked again" })).status).toBe(303);
    expect((await snapshot(catId)).markings).toMatchObject({ value: [], confidence: "confirmed" });

    const j = await json(`/api/team/cats/${catId}/appearance/correct`).send({ kind: "markings", reason: "x" });
    expect([j.status, j.body.fields]).toEqual([400, ["marks"]]);
  });
});

// ── T-overrule (Decision G) ───────────────────────────────────────────────

describe("T-overrule: a team Correct on a cat guardian's cat overrules her", () => {
  const correct = (catId: number, body: Record<string, unknown>) =>
    form(`/api/team/cats/${catId}/appearance/correct`).send({ reason: "Checked in person", ...body });

  it("one guardian: one retraction, then the team's statement; the public answer changes", async () => {
    const catId = await newCat();
    const g = await guardian(catId, "coat", "eleni", { value: { colours: ["grey"] }, daysAgo: 2 });
    const before = await rowsFor(catId);

    const res = await correct(catId, { kind: "coat", colours: "ginger" });
    expect(res.headers["location"]).toBe(`/api/team/cats/${catId}?done=a_coat_overruled#appearance`);

    const added = (await rowsFor(catId)).slice(before.length);
    expect(added).toHaveLength(2);
    expect(added[0]).toMatchObject({
      kind: "coat",
      value: { retracted: true },
      supersedesId: g.id,
      supersedeReason: "Checked in person",
      roleAtTime: "staff",
      accountId: susanId,
    });
    expect(added[1]).toMatchObject({ kind: "coat", value: { colours: ["ginger"] }, supersedesId: null });
    expect((await snapshot(catId)).coatColours).toMatchObject({ value: ["ginger"], confidence: "confirmed" });
  });

  it("two guardians' standing statements are both marked wrong", async () => {
    const catId = await newCat();
    const a = await guardian(catId, "coat", "eleni", { value: { colours: ["grey"] }, daysAgo: 6 });
    const b = await guardian(catId, "coat", "maria", { value: { colours: ["white"] }, daysAgo: 3 });
    const res = await json(`/api/team/cats/${catId}/appearance/correct`).send({
      kind: "coat",
      colours: ["ginger"],
      reason: "Checked in person",
    });
    expect(res.status).toBe(201);
    const retractions = (await rowsFor(catId)).filter((o) => (o.value as { retracted?: boolean }).retracted);
    expect(retractions.map((o) => o.supersedesId).sort()).toEqual([a.id, b.id].sort());
    expect(res.body.retracted).toHaveLength(2);
    expect((await snapshot(catId)).coatColours.value).toEqual(["ginger"]);
  });

  it("one guardian's Correct and Confirm both standing: both are marked wrong", async () => {
    const catId = await newCat();
    const first = await guardian(catId, "coat", "eleni", { value: { colours: ["grey"] }, daysAgo: 6 });
    const agree = await guardian(catId, "coat", "eleni", {
      value: { colours: ["grey"], agreesWith: first.id },
      daysAgo: 2,
    });
    await correct(catId, { kind: "coat", colours: "black" });
    const retracted = (await rowsFor(catId))
      .filter((o) => (o.value as { retracted?: boolean }).retracted)
      .map((o) => o.supersedesId);
    expect(retracted.sort()).toEqual([first.id, agree.id].sort());
    expect((await snapshot(catId)).coatColours.value).toEqual(["black"]);
  });

  it("a guardian's markings list is overruled the same way", async () => {
    const catId = await newCat();
    await guardian(catId, "markings", "eleni", { value: { marks: ["torn_ear"] }, daysAgo: 2 });
    await correct(catId, { kind: "markings", marks: ["", "white_paws"] });
    expect((await snapshot(catId)).markings).toMatchObject({ value: ["white_paws"], confidence: "confirmed" });
  });

  it("is one transaction: if the team's statement is refused, no retraction stays", async () => {
    const catId = await newCat();
    const g = await guardian(catId, "coat", "eleni", { value: { colours: ["grey"] }, daysAgo: 2 });
    const person = { id: susanId, scopes: [{ role: "staff", colonyId: null }] };
    // Not sure from the team is refused by writeObservation, after the retraction ran.
    await expect(
      correctAppearance(person, { catId, kind: "coat", codes: ["not_sure"], reason: "x" }),
    ).rejects.toMatchObject({ code: "MALFORMED_VALUE" });
    expect((await rowsFor(catId)).map((o) => o.id)).toEqual([g.id]);
    expect((await snapshot(catId)).coatColours.value).toEqual(["grey"]);
  });

  it("a page out of date overrules nothing: a guardian statement it didn't show stops the Correct (a_changed)", async () => {
    const catId = await newCat();
    const seen = await guardian(catId, "coat", "eleni", { value: { colours: ["grey"] }, daysAgo: 6 });
    await guardian(catId, "coat", "maria", { value: { colours: ["white"] }, daysAgo: 1 });
    const before = await rowsFor(catId);
    const stale = await correct(catId, { kind: "coat", colours: "ginger", shownAbove: String(seen.id) });
    expect(stale.headers["location"]).toContain("done=a_changed");
    expect(await rowsFor(catId)).toEqual(before);
    // Nothing shown, but one stands now: also changed.
    const none = await json(`/api/team/cats/${catId}/appearance/correct`).send({
      kind: "coat",
      colours: ["ginger"],
      reason: "x",
      shownAbove: [],
    });
    expect([none.status, none.body.code]).toEqual([409, "CHANGED"]);
    // The page's set, exactly: the overrule goes ahead.
    const ids = before.map((o) => o.id).join(",");
    const ok = await correct(catId, { kind: "coat", colours: "ginger", shownAbove: ids });
    expect(ok.headers["location"]).toContain("done=a_coat_overruled");
  });

  it("does not touch the team's own earlier statements", async () => {
    const catId = await newCat();
    await team(catId, "coat", { value: { colours: ["grey"] }, daysAgo: 4 });
    const res = await correct(catId, { kind: "coat", colours: "ginger" });
    expect(res.headers["location"]).toContain("done=a_coat_corrected");
    expect((await rowsFor(catId)).filter((o) => o.supersedesId != null)).toHaveLength(0);
  });
});

// ── Mark wrong ─────────────────────────────────────────────────────────────

describe("Mark wrong (the existing route, a retraction)", () => {
  const wrong = (id: number, body: Record<string, unknown> = {}) =>
    form(`/api/team/statements/${id}/wrong`).send({ choice: "retract", reason: "Wrong cat in the photo", ...body });

  it("writes exactly one retraction superseding that row, and goes back to Appearance", async () => {
    const catId = await newCat();
    const s = await spotter(catId, "coat", "a", { value: { colours: ["ginger"] } });
    const res = await wrong(s.id);
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/cats/${catId}?done=a_wrong#appearance`);
    const rows = await rowsFor(catId);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      kind: "coat",
      value: { retracted: true },
      supersedesId: s.id,
      supersedeReason: "Wrong cat in the photo",
      roleAtTime: "staff",
    });
    expect((await snapshot(catId)).coatColours.value).toBeNull();
  });

  it("refuses anything but a retraction, on the form and the JSON supersede route (no second way to write a colour)", async () => {
    const catId = await newCat();
    const s = await spotter(catId, "coat", "a", { value: { colours: ["ginger"] } });
    expect((await wrong(s.id, { choice: "street" })).status).toBe(400);
    const t = await spotter(catId, "markings", "b", { value: { marks: ["torn_ear"] } });
    const replace = await json(`/api/team/observations/${t.id}/supersede`).send({
      value: { marks: ["white_paws"] },
      reason: "x",
    });
    expect(replace.status).toBe(400);
    expect((await rowsFor(catId)).filter((o) => o.supersedesId != null)).toHaveLength(0);

    const retract = await json(`/api/team/observations/${t.id}/supersede`).send({
      value: { retracted: true },
      reason: "x",
    });
    expect(retract.status).toBe(201);
    const written = (await rowsFor(catId)).filter((o) => o.supersedesId != null);
    expect(written.map((o) => o.value)).toEqual([{ retracted: true }]);
  });

  it("a second Mark wrong on the same row says already, and writes nothing", async () => {
    const catId = await newCat();
    const s = await spotter(catId, "coat", "a", { value: { colours: ["ginger"] } });
    await wrong(s.id);
    const again = await wrong(s.id);
    expect(again.headers["location"]).toContain("done=already");
    const j = await json(`/api/team/statements/${s.id}/wrong`).send({ choice: "retract", reason: "x" });
    expect([j.status, j.body.code]).toEqual([409, "ALREADY_SUPERSEDED"]);
    expect(await rowsFor(catId)).toHaveLength(2);
  });

  it("removes exactly one row from the count: one of three spotters' marks", async () => {
    const catId = await newCat();
    // Three spotters, three days, three photos. white_paws: A, B, C. kinked_tail: A, B.
    const a = await spotter(catId, "markings", "a", { value: { marks: ["white_paws", "kinked_tail"] }, daysAgo: 9 });
    await spotter(catId, "markings", "b", { value: { marks: ["white_paws", "kinked_tail"] }, daysAgo: 7 });
    await spotter(catId, "markings", "c", { value: { marks: ["white_paws"] }, daysAgo: 5 });
    expect((await snapshot(catId)).markings.value).toEqual(["white_paws", "kinked_tail"]);
    await wrong(a.id);
    expect((await snapshot(catId)).markings.value).toEqual(["white_paws"]);
  });

  it("a retraction itself can't be marked wrong", async () => {
    const catId = await newCat();
    const s = await spotter(catId, "coat", "a", { value: { colours: ["ginger"] } });
    await wrong(s.id);
    const retraction = (await rowsFor(catId)).at(-1)!;
    const res = await json(`/api/team/statements/${retraction.id}/wrong`).send({ choice: "retract", reason: "x" });
    expect(res.status).toBe(400);
    expect(await rowsFor(catId)).toHaveLength(2);
  });

  it("waits for the cat: Mark wrong doesn't land while another change to the cat holds it", async () => {
    const catId = await newCat();
    const s = await spotter(catId, "coat", "a", { value: { colours: ["ginger"] } });
    const holder = await pool.connect();
    try {
      // Another team member's Correct or Confirm, part-way through.
      await holder.query("begin");
      await holder.query("select id from cats where id = $1 for update", [catId]);
      let landed = false;
      const pending = wrong(s.id).then((res) => {
        landed = true;
        return res;
      });
      await new Promise((r) => setTimeout(r, 400));
      expect(landed).toBe(false);
      expect(await rowsFor(catId)).toHaveLength(1);
      await holder.query("commit");
      const res = await pending;
      expect(res.status).toBe(303);
      expect(await rowsFor(catId)).toHaveLength(2);
    } finally {
      await holder.query("rollback").catch(() => undefined);
      holder.release();
    }
  });

  it("marking the machine's newest reading wrong leaves it with no reading", async () => {
    const catId = await newCat();
    await machine(catId, ["grey"], 9);
    const newest = await machine(catId, ["black"], 2);
    await wrong(newest.id);
    expect((await snapshot(catId)).coatColours.value).toBeNull();
  });
});

// ── Form and JSON write identical rows ──────────────────────────────────────

describe("the forms and the JSON routes write identical rows", () => {
  const shape = (o: Observation) => {
    const { id: _id, catId: _c, createdAt: _cr, observedAt: _ob, supersedesId, ...rest } = o;
    return { ...rest, supersedes: supersedesId != null };
  };
  const strip = (o: Observation) => {
    const s = shape(o);
    const v = { ...(s.value as Record<string, unknown>) };
    delete v["agreesWith"];
    return { ...s, value: v };
  };

  it("Confirm, Correct (with an overrule) and Mark wrong", async () => {
    const [byForm, byJson] = [await newCat(), await newCat()];
    for (const catId of [byForm, byJson]) {
      await machine(catId, ["black"]);
      await guardian(catId, "markings", "eleni", { value: { marks: ["torn_ear"] }, daysAgo: 2 });
    }
    const countBefore = (await rowsFor(byForm)).length;

    await confirm(byForm, "coat", { expected: "black" });
    await json(`/api/team/cats/${byJson}/appearance/confirm`).send({ kind: "coat", expected: ["black"] });
    await form(`/api/team/cats/${byForm}/appearance/correct`).send({ kind: "markings", marks: ["", "white_paws"], reason: "Close look" });
    await json(`/api/team/cats/${byJson}/appearance/correct`).send({ kind: "markings", marks: ["white_paws"], reason: "Close look" });
    const fCoat = (await rowsFor(byForm)).find((o) => o.provenance === "machine")!;
    const jCoat = (await rowsFor(byJson)).find((o) => o.provenance === "machine")!;
    await form(`/api/team/statements/${fCoat.id}/wrong`).send({ choice: "retract", reason: "Wrong photo" });
    await json(`/api/team/statements/${jCoat.id}/wrong`).send({ choice: "retract", reason: "Wrong photo" });

    const f = (await rowsFor(byForm)).slice(countBefore);
    const j = (await rowsFor(byJson)).slice(countBefore);
    expect(f).toHaveLength(4);
    expect(f.map(strip)).toEqual(j.map(strip));
    // agreesWith points at each cat's own reading.
    expect((f[0]!.value as { agreesWith: number }).agreesWith).toBe(fCoat.id);
    expect((j[0]!.value as { agreesWith: number }).agreesWith).toBe(jCoat.id);
  });
});

// ── Who may ────────────────────────────────────────────────────────────────

describe("a team member without set_appearance is refused at each route, and nothing is written", () => {
  it("Confirm, Correct, Mark wrong and the Colour check list", async () => {
    const catId = await newCat();
    const s = await spotter(catId, "coat", "a", { value: { colours: ["ginger"] } });
    denied.cap = "set_appearance";
    const results = [
      await confirm(catId, "coat"),
      await form(`/api/team/cats/${catId}/appearance/correct`).send({ kind: "coat", colours: "black", reason: "x" }),
      await form(`/api/team/statements/${s.id}/wrong`).send({ choice: "retract", reason: "x" }),
      await request(app).get("/api/team/colour-check").set("Cookie", cookie).set("Accept", "application/json"),
    ];
    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect(await rowsFor(catId)).toHaveLength(1);
  });

  it("is refused before taking any lock: a held cat doesn't keep a non-holder waiting", async () => {
    const catId = await newCat();
    const s = await spotter(catId, "coat", "a", { value: { colours: ["ginger"] } });
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select id from cats where id = $1 for update", [catId]);
      denied.cap = "set_appearance";
      const res = await Promise.race([
        form(`/api/team/statements/${s.id}/wrong`).send({ choice: "retract", reason: "x" }),
        new Promise<"waited">((r) => setTimeout(() => r("waited"), 1500)),
      ]);
      expect(res === "waited" ? "waited" : res.status).toBe(403);
    } finally {
      await holder.query("rollback").catch(() => undefined);
      holder.release();
    }
  });
});

// ── The Colour check list ───────────────────────────────────────────────────

/** Two spotters agreeing, on different days, devices and photos. */
async function twoSpotters(catId: number, kind: "coat" | "markings", value: Record<string, unknown>, from = 6) {
  await spotter(catId, kind, `p${from}a`, { value, daysAgo: from });
  await spotter(catId, kind, `p${from}b`, { value, daysAgo: from - 2 });
}

describe("the Colour check list", () => {
  it("no_authority: a colour only the machine read sits in the collapsed group; Confirm takes it off", async () => {
    const catId = await newCat();
    await machine(catId, ["grey"]);
    expect(await listed(catId)).toMatchObject({
      reasons: ["no_authority"],
      group: "not_described",
      coatColours: ["grey"],
      coatPattern: null,
    });
    await confirm(catId, "coat");
    expect(await listed(catId)).toBeUndefined();
  });

  it("spotters_over_machine: listed; Confirm takes it off", async () => {
    const catId = await newCat();
    await machine(catId, ["black"], 9);
    await twoSpotters(catId, "coat", { colours: ["ginger"] });
    expect(await listed(catId)).toMatchObject({ reasons: ["spotters_over_machine"], group: "check" });
    await confirm(catId, "coat");
    expect(await listed(catId)).toBeUndefined();
  });

  it("tied_camps: listed; Correct takes it off", async () => {
    const catId = await newCat();
    await twoSpotters(catId, "coat", { colours: ["ginger"] }, 9);
    await twoSpotters(catId, "coat", { colours: ["black"] }, 5);
    expect((await listed(catId))?.reasons).toEqual(["tied_camps"]);
    await form(`/api/team/cats/${catId}/appearance/correct`).send({ kind: "coat", colours: "black", reason: "x" });
    expect(await listed(catId)).toBeUndefined();
  });

  it("markings_reopened: two spotters add a mark after the team's list; Confirm takes it off", async () => {
    const catId = await newCat();
    await team(catId, "coat", { value: { colours: ["grey"] }, daysAgo: 20 });
    await team(catId, "markings", { value: { marks: ["white_paws"] }, daysAgo: 20 });
    await twoSpotters(catId, "markings", { marks: ["torn_ear"] });
    expect((await listed(catId))?.reasons).toEqual(["markings_reopened", "markings_changed_recently"]);
    await confirm(catId, "markings");
    expect(await listed(catId)).toBeUndefined();
  });

  it("markings_changed_recently: listed; Confirm takes it off", async () => {
    const catId = await newCat();
    await team(catId, "coat", { value: { colours: ["grey"] }, daysAgo: 20 });
    await twoSpotters(catId, "markings", { marks: ["long_fur"] });
    expect((await listed(catId))?.reasons).toEqual(["markings_changed_recently"]);
    await confirm(catId, "markings");
    expect(await listed(catId)).toBeUndefined();
  });

  it("a cat that is described and settled is not listed", async () => {
    const catId = await newCat();
    await team(catId, "coat", { value: { colours: ["grey"] }, daysAgo: 20 });
    expect(await listed(catId)).toBeUndefined();
  });

  it("not-yet-described cats never sit above a cat with another reason, however new", async () => {
    const older = await newCat();
    await machine(older, ["black"], 30);
    await twoSpotters(older, "coat", { colours: ["ginger"] }, 25);
    const newer = await newCat();
    await machine(newer, ["grey"], 0);
    const cats = await colourCheck();
    const order = cats.map((c) => c.catId);
    expect(order.indexOf(older)).toBeLessThan(order.indexOf(newer));
    const firstNotDescribed = cats.findIndex((c) => c.group === "not_described");
    const lastCheck = cats.map((c) => c.group).lastIndexOf("check");
    expect(lastCheck).toBeLessThan(firstNotDescribed === -1 ? Infinity : firstNotDescribed);

    const page = await request(app).get("/api/team/colour-check").set("Cookie", cookie);
    expect(page.status).toBe(200);
    const html = page.text;
    const group = html.indexOf('<details class="notdescribed">');
    expect(group).toBeGreaterThan(-1);
    expect(html).toMatch(/Not yet described by the team: \d+ cats?/);
    expect(html.indexOf(`id="c-${older}"`)).toBeLessThan(group);
    expect(html.indexOf(`id="c-${newer}"`)).toBeGreaterThan(group);
    expect(html).not.toContain("<script");
  });
});

describe("the hand-pick reason", () => {
  async function handPicked(catId: number): Promise<number> {
    const [s] = await db
      .insert(sightingsTable)
      .values({
        catId,
        deviceId: `${PREFIX}picker-${catId}`,
        photoId: await photo(),
        lat: 37.4451,
        lng: 24.9421,
        status: "resolved",
        createdAt: at(1),
      })
      .returning({ id: sightingsTable.id });
    await db.insert(sightingMatchesTable).values({ sightingId: s!.id, choice: "hand_pick", chosenAt: at(1), chosenCatId: catId });
    return s!.id;
  }

  it("a spotter who said ginger on a hand-picked cat resolved black is listed; marking the answer wrong clears it", async () => {
    const catId = await newCat();
    await machine(catId, ["black"], 5);
    const sightingId = await handPicked(catId);
    const answer = await spotter(catId, "coat", `picker-${catId}`, { value: { colours: ["ginger"] }, sightingId, daysAgo: 1 });
    expect((await listed(catId))?.reasons).toEqual(["hand_pick", "no_authority"]);
    expect((await listed(catId))?.group).toBe("check");
    await form(`/api/team/statements/${answer.id}/wrong`).send({ choice: "retract", reason: "Wrong cat" });
    expect((await listed(catId))?.reasons).toEqual(["no_authority"]);
  });

  it("a spotter who agreed with the colour is not listed, even when the machine read something else", async () => {
    const catId = await newCat();
    await team(catId, "coat", { value: { colours: ["black"] }, daysAgo: 9 });
    await machine(catId, ["ginger"], 5);
    const sightingId = await handPicked(catId);
    await spotter(catId, "coat", `picker-${catId}`, { value: { colours: ["black"] }, sightingId, daysAgo: 1 });
    expect(await listed(catId)).toBeUndefined();
  });

  it("no spotter answer, no flag; an answer on a sighting not picked by hand, no flag", async () => {
    const quiet = await newCat();
    await team(quiet, "coat", { value: { colours: ["black"] }, daysAgo: 9 });
    await handPicked(quiet);
    expect(await listed(quiet)).toBeUndefined();

    const suggested = await newCat();
    await team(suggested, "coat", { value: { colours: ["black"] }, daysAgo: 9 });
    await spotter(suggested, "coat", "s", { value: { colours: ["ginger"] }, daysAgo: 1 });
    expect(await listed(suggested)).toBeUndefined();
  });

  it("on a cat guardian's cat, a team Confirm after the answer clears it, though her statement still decides", async () => {
    const catId = await newCat();
    await guardian(catId, "coat", "eleni", { value: { colours: ["black"] }, daysAgo: 9 });
    const sightingId = await handPicked(catId);
    await spotter(catId, "coat", `picker-${catId}`, { value: { colours: ["ginger"] }, sightingId, daysAgo: 1 });
    expect((await listed(catId))?.reasons).toEqual(["hand_pick"]);
    await confirm(catId, "coat");
    expect(await listed(catId)).toBeUndefined();
    expect((await snapshot(catId)).coatColours.value).toEqual(["black"]);
  });

  it("a team statement made after the answer clears it (the team has looked)", async () => {
    const catId = await newCat();
    await machine(catId, ["black"], 5);
    const sightingId = await handPicked(catId);
    await spotter(catId, "coat", `picker-${catId}`, { value: { colours: ["ginger"] }, sightingId, daysAgo: 1 });
    expect((await listed(catId))?.reasons).toContain("hand_pick");
    await confirm(catId, "coat");
    expect(await listed(catId)).toBeUndefined();
  });
});

// ── The Appearance section ──────────────────────────────────────────────────

describe("the Appearance section on the team cat page", () => {
  it("shows the public line, every standing statement with who and when, the machine's photo and model, and the forms", async () => {
    const catId = await newCat();
    const reading = await machine(catId, ["ginger"], 3, "coat-reader:copy");
    await spotter(catId, "markings", "a", { value: { marks: ["white_paws"] }, daysAgo: 4 });
    await team(catId, "markings", { value: { marks: ["white_paws", "missing_eye"] }, daysAgo: 1 });

    const res = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    const html = res.text;
    expect(html).toContain('<h2 id="appearance">Appearance</h2>');
    expect(html).toContain('<p class="public">Ginger · White paws · One eye</p>');
    expect(html).toContain(`id="a-${reading.id}"`);
    expect(html).toContain("read automatically from the photo");
    expect(html).toContain("model gpt-test-1");
    expect(html).toContain("a spotter");
    expect(html).toContain(`action="/api/team/cats/${catId}/appearance/confirm"`);
    expect(html).toContain(`action="/api/team/cats/${catId}/appearance/correct"`);
    expect(html).toContain(`action="/api/team/statements/${reading.id}/wrong"`);
    // The team never states Not sure on colour.
    expect(html).not.toContain('name="colours" value="not_sure"');
    expect(html).not.toContain("<script");

    const j = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie).set("Accept", "application/json");
    const coat = j.body.appearance.coat;
    expect(coat.statements[0]).toMatchObject({ id: reading.id, source: "machine", modelVersion: "gpt-test-1" });
    expect(coat.statements[0].photoUrl).toMatch(/^\/api\/team\/photos\//);
  });

  it("SYC-398: shows each part in the new words, never an old code or undefined", async () => {
    const catId = await newCat();
    // Stored history in the old shapes, as the live cats have it.
    await machine(catId, ["tabby", "white"], 6);
    await spotter(catId, "coat", "a", { value: { colours: ["black_and_white"] }, daysAgo: 4 });
    await team(catId, "coat", { value: { colours: ["brown", "ginger"] }, daysAgo: 1 });

    const res = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie);
    const html = res.text;
    const section = html.slice(html.indexOf('<h2 id="appearance">'));
    // The public line keeps §2's words: the colours, then the pattern (Plain is never said).
    expect(section).toContain('<p class="public">Brown · Ginger · Stripes</p>');
    expect(section).toContain("Colours</dt><dd>Brown · Ginger");
    // SYC-443: the pattern on its own in the team's word.
    expect(section).toContain("Pattern</dt><dd>Tabby");
    // The old reading and answer, each statement in the team's words (§15.2).
    expect(section).toContain("Tabby, colours not stated");
    expect(section).toContain("Black and white, pattern not stated");
    expect(section).toContain("Brown and ginger, pattern not stated");
    // SYC-443: the team's words are allowed now; the old codes and the old
    // public word never are. Lower-case breeders' words appear only in the
    // Patched button's hint (T3A), so they are banned everywhere else.
    for (const bad of ["Tortoiseshell or calico", "black_and_white", "undefined", "not_sure", "null"]) {
      expect(section, bad).not.toContain(bad);
    }
    expect(withoutHints(section)).not.toMatch(/tabby|calico|tortoiseshell/);
    // The Correct form offers the five colours, ticked as they stand.
    expect(section).toContain('name="colours" value="brown" checked');
    expect(section).toContain('name="colours" value="ginger" checked');
    expect(section).not.toContain('name="colours" value="tabby"');
    // Confirm sends each part.
    expect(section).toContain('name="expectedColours" value="brown,ginger"');
    expect(section).toContain('name="expectedPattern" value="stripes"');
    // The history reads every coat through the one translation, in the team's
    // words (SYC-443): each statement says the part it left "not stated".
    expect(html).toContain("Coat: Brown and ginger, pattern not stated");
    expect(html).toContain("Coat: Tabby, colours not stated");
    expect(html).toContain("Coat: Black and white, pattern not stated");
    expect(html).not.toMatch(/Coat: (brown|stripes|black and white)/);
  });

  it("shows a guardian–team disagreement, with Correct offered to overrule", async () => {
    const catId = await newCat();
    await team(catId, "coat", { value: { colours: ["black"] }, daysAgo: 1 });
    const g = await guardian(catId, "coat", "eleni", { value: { colours: ["grey"] }, daysAgo: 5 });
    const res = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie);
    expect(res.text).toContain("A cat guardian&#39;s change decides this, and the team said something different");
    expect(res.text).toContain("Saving replaces their answer with yours");
    expect(res.text).toContain(`name="shownAbove" value="${g.id}"`);
  });

  it("SYC-398: a guardian–team disagreement is per part, never a false alarm", async () => {
    const coatOf = async (catId: number) =>
      (await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie).set("Accept", "application/json")).body
        .appearance.coat;

    // The team says exactly what she said; the machine adds a pattern.
    const same = await newCat();
    await guardian(same, "coat", "eleni", { value: { colours: ["grey"] }, daysAgo: 4 });
    await machine(same, ["grey", "tabby"], 3);
    await team(same, "coat", { value: { colours: ["grey"] }, daysAgo: 1 });
    expect(await coatOf(same)).toMatchObject({ guardianDecides: true, guardianDisagrees: false });

    // She states only the pattern, the team only the colours: no overlap.
    const apart = await newCat();
    await guardian(apart, "coat", "eleni", { value: { pattern: "stripes" }, daysAgo: 4 });
    await team(apart, "coat", { value: { colours: ["ginger"] }, daysAgo: 1 });
    expect(await coatOf(apart)).toMatchObject({ guardianDecides: true, guardianDisagrees: false });

    // A real disagreement on the pattern alone.
    const pattern = await newCat();
    await guardian(pattern, "coat", "eleni", { value: { colours: ["grey"], pattern: "stripes" }, daysAgo: 4 });
    await team(pattern, "coat", { value: { colours: ["grey"], pattern: "plain" }, daysAgo: 1 });
    expect(await coatOf(pattern)).toMatchObject({ guardianDecides: true, guardianDisagrees: true });
  });

  it("the Colour check list warns before its Correct overrules a cat guardian", async () => {
    const catId = await newCat();
    const g = await guardian(catId, "markings", "eleni", { value: { marks: ["torn_ear"] }, daysAgo: 20 });
    await team(catId, "coat", { value: { colours: ["grey"] }, daysAgo: 20 });
    await twoSpotters(catId, "markings", { marks: ["long_fur"] });
    expect((await listed(catId))?.above).toEqual({ coat: [], markings: [g.id] });
    const page = await request(app).get("/api/team/colour-check").set("Cookie", cookie);
    const row = page.text.slice(page.text.indexOf(`id="c-${catId}"`));
    const next = row.indexOf('<li class="report colourcheck"', 1);
    const end = next === -1 ? row.length : next;
    expect(row.slice(0, end)).toContain("Saving replaces their answer with yours");
    expect(row.slice(0, end)).toContain(`name="shownAbove" value="${g.id}"`);
  });

  it("without set_appearance, the section shows but offers no forms", async () => {
    const catId = await newCat();
    const reading = await machine(catId, ["ginger"]);
    denied.cap = "set_appearance";
    const res = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie);
    expect(res.text).toContain('<h2 id="appearance">Appearance</h2>');
    expect(res.text).not.toContain("/appearance/confirm");
    expect(res.text).not.toContain(`/api/team/statements/${reading.id}/wrong`);
  });
});

// ── SYC-398 PR B: the pattern on the team's Correct, and the drawn cat ─────

describe("SYC-398 PR B: Correct states colours, a pattern, or both", () => {
  const correct = (catId: number, body: Record<string, unknown>) =>
    form(`/api/team/cats/${catId}/appearance/correct`).send({ reason: "Looked closely", ...body });

  it("colours only: writes the colours and no pattern key (Not stated is the default)", async () => {
    const catId = await newCat();
    const res = await correct(catId, { kind: "coat", colours: ["ginger", "brown"], pattern: "none" });
    expect(res.status).toBe(303);
    const [row] = await rowsFor(catId);
    expect(row!.value).toEqual({ colours: ["brown", "ginger"], reason: "Looked closely" });
    // A form that sends no pattern at all is the same: Not stated.
    expect((await correct(catId, { kind: "coat", colours: "grey" })).status).toBe(303);
    expect((await rowsFor(catId))[1]!.value).toEqual({ colours: ["grey"], reason: "Looked closely" });
  });

  it("pattern only: writes the pattern and no colours; the colours standing fall through", async () => {
    const catId = await newCat();
    await machine(catId, ["grey"]);
    const res = await correct(catId, { kind: "coat", pattern: "stripes" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/cats/${catId}?done=a_coat_corrected#appearance`);
    const rows = await rowsFor(catId);
    expect(rows.at(-1)!.value).toEqual({ pattern: "stripes", reason: "Looked closely" });
    const snap = await snapshot(catId);
    expect(snap.coatPattern).toMatchObject({ value: "stripes", confidence: "confirmed" });
    expect(snap.coatColours).toMatchObject({ value: ["grey"], confidence: "reported" });
  });

  it("both: writes the colours and the pattern, each confirmed", async () => {
    const catId = await newCat();
    const res = await correct(catId, { kind: "coat", colours: ["white", "black"], pattern: "patches" });
    expect(res.status).toBe(303);
    const [row] = await rowsFor(catId);
    expect(row!.value).toEqual({ colours: ["black", "white"], pattern: "patches", reason: "Looked closely" });
    const snap = await snapshot(catId);
    expect(snap.coatColours).toMatchObject({ value: ["black", "white"], confidence: "confirmed" });
    expect(snap.coatPattern).toMatchObject({ value: "patches", confidence: "confirmed" });
  });

  it("neither: the form is shown again with an error and the reason kept, and nothing is written", async () => {
    const catId = await newCat();
    const res = await correct(catId, { kind: "coat", pattern: "none", reason: "Saw her at dusk", shownAbove: "" });
    expect(res.status).toBe(400);
    expect(res.text).toContain("Tick at least one colour or choose a pattern. Nothing was changed.");
    expect(res.text).toContain(`action="/api/team/cats/${catId}/appearance/correct"`);
    expect(res.text).toContain("<details open>");
    expect(res.text).toContain('value="Saw her at dusk"');
    expect(res.text).toContain('name="pattern" value="none" checked');
    expect(res.text).not.toContain("<script");
    // No pattern field at all is neither, too.
    expect((await correct(catId, { kind: "coat" })).status).toBe(400);
    // JSON names both parts.
    const j = await json(`/api/team/cats/${catId}/appearance/correct`).send({ kind: "coat", reason: "x" });
    expect([j.status, j.body.fields]).toEqual([400, ["colours", "pattern"]]);
    expect(await rowsFor(catId)).toHaveLength(0);
  });

  it("neither, shown again, keeps the guardian guard and the way back to the Colour check list", async () => {
    const catId = await newCat();
    const g = await guardian(catId, "coat", "eleni", { value: { colours: ["grey"] }, daysAgo: 2 });
    const res = await correct(catId, { kind: "coat", pattern: "none", shownAbove: String(g.id), back: "colour" });
    expect(res.status).toBe(400);
    expect(res.text).toContain(`name="shownAbove" value="${g.id}"`);
    expect(res.text).toContain('name="back" value="colour"');
    expect(res.text).toContain(`href="/api/team/colour-check#c-${catId}"`);
    expect(res.text).toContain("Saving replaces their answer with yours");
    expect((await rowsFor(catId)).filter((o) => o.id > g.id)).toHaveLength(0);
  });

  it("JSON: pattern null is Not stated", async () => {
    const catId = await newCat();
    const res = await json(`/api/team/cats/${catId}/appearance/correct`).send({
      kind: "coat",
      colours: ["grey"],
      pattern: null,
      reason: "x",
    });
    expect(res.status).toBe(201);
    expect((await rowsFor(catId))[0]!.value).toEqual({ colours: ["grey"], reason: "x" });
  });

  it("refuses a pattern outside the three and Not stated", async () => {
    const catId = await newCat();
    for (const pattern of ["tabby", "not_sure", "calico", ""]) {
      const res = await correct(catId, { kind: "coat", colours: "grey", pattern });
      expect(res.status, pattern).toBe(400);
    }
    expect(await rowsFor(catId)).toHaveLength(0);
  });

  it("a colours-only Correct leaves an older team pattern standing (§4: a part not stated falls through)", async () => {
    const catId = await newCat();
    expect((await correct(catId, { kind: "coat", colours: "ginger", pattern: "stripes" })).status).toBe(303);
    expect((await correct(catId, { kind: "coat", colours: ["brown", "ginger"], pattern: "none" })).status).toBe(303);
    const rows = await rowsFor(catId);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.value).toEqual({ colours: ["brown", "ginger"], reason: "Looked closely" });
    expect(rows[1]!.value).not.toHaveProperty("pattern");
    const snap = await snapshot(catId);
    expect(snap.coatColours).toMatchObject({ value: ["brown", "ginger"], confidence: "confirmed" });
    expect(snap.coatPattern).toMatchObject({ value: "stripes", confidence: "confirmed" });
  });

  it("Correct on a cat guardian's statement retracts it, both parts (§4, as before)", async () => {
    const catId = await newCat();
    const g = await guardian(catId, "coat", "eleni", { value: { colours: ["grey"], pattern: "stripes" }, daysAgo: 2 });
    // The team states the pattern only; her colours go with her statement.
    const res = await correct(catId, { kind: "coat", pattern: "patches", shownAbove: String(g.id) });
    expect(res.headers["location"]).toBe(`/api/team/cats/${catId}?done=a_coat_overruled#appearance`);
    const added = (await rowsFor(catId)).filter((o) => o.id > g.id);
    expect(added).toHaveLength(2);
    expect(added[0]).toMatchObject({ value: { retracted: true }, supersedesId: g.id });
    expect(added[1]!.value).toEqual({ pattern: "patches", reason: "Looked closely" });
    const snap = await snapshot(catId);
    expect(snap.coatPattern).toMatchObject({ value: "patches", confidence: "confirmed" });
    // Nothing else said a colour: her grey no longer counts.
    expect(snap.coatColours.value).toBeNull();
    // The page draws the coat after an overrule too.
    const page = await request(app).get(`/api/team/cats/${catId}?done=a_coat_overruled`).set("Cookie", cookie);
    expect(page.text).toContain("the team&#39;s change is added");
    expect(page.text).toContain('aria-label="Patched, colours not known"');
  });
});

describe("SYC-398 PR B: the form and the drawn cat on the team cat page", () => {
  const page = async (catId: number, done?: string) =>
    (await request(app).get(`/api/team/cats/${catId}${done ? `?done=${done}` : ""}`).set("Cookie", cookie)).text;
  const correct = (catId: number, body: Record<string, unknown>) =>
    form(`/api/team/cats/${catId}/appearance/correct`).send({ reason: "Looked closely", ...body });

  it("offers the pattern as radio buttons, Not stated ticked, and a swatch for each colour", async () => {
    const catId = await newCat();
    await machine(catId, ["ginger", "tabby"]);
    const html = await page(catId);
    const section = html.slice(html.indexOf('<h2 id="appearance">'));
    for (const p of ["plain", "stripes", "patches"]) {
      expect(section).toContain(`type="radio" id="ac-coat-p-${p}" name="pattern" value="${p}">`);
    }
    expect(section).toContain('type="radio" id="ac-coat-p-none" name="pattern" value="none" checked>');
    expect(section).toContain("Not stated");
    expect(section).toContain("Choose the pattern, if you can see it");
    // A swatch beside each of the five colours.
    expect(section.match(/<svg viewBox="0 0 20 20"/g)).toHaveLength(5);
    // No drawn cat until a Correct is saved.
    expect(section).not.toContain('class="drawncat"');
  });

  it("after a coat Correct, the coat is drawn with its caption, for each of Samuel's examples", async () => {
    const cases = [
      // SYC-443 §15.4: the caption is the team's phrase.
      { body: { colours: ["brown", "ginger"], pattern: "stripes" }, caption: "Brown and ginger tabby" },
      { body: { colours: ["black", "white"], pattern: "patches" }, caption: "Black and white" },
      { body: { colours: ["grey"], pattern: "plain" }, caption: "Grey" },
      { body: { pattern: "stripes" }, caption: "Tabby, colours not known" },
      { body: { colours: ["ginger", "white"] }, caption: "Ginger and white, pattern not known" },
    ];
    for (const c of cases) {
      const catId = await newCat();
      const res = await correct(catId, { kind: "coat", ...c.body });
      const done = new URL(res.headers["location"], "http://x").searchParams.get("done")!;
      expect(done).toBe("a_coat_corrected");
      const html = await page(catId, done);
      const section = html.slice(html.indexOf('<h2 id="appearance">'));
      expect(section, c.caption).toContain('<svg class="drawncat"');
      expect(section, c.caption).toContain(`aria-label="${c.caption}"`);
      expect(section, c.caption).toContain(`<strong>${c.caption}</strong>`);
      // "Tabby" is the team's word now; the Patched button's hint names
      // "tortoiseshell, calico" in lower case (T3A), so it is removed first.
      for (const bad of ["undefined", "null", "NaN", "Tortoiseshell"]) {
        expect(section, `${c.caption}: ${bad}`).not.toContain(bad);
      }
      // (Lower-case "tabby" belongs in phrases such as "Brown and ginger tabby".)
      expect(withoutHints(section), c.caption).not.toMatch(/calico|tortoiseshell/);
    }
  });

  it("a markings Correct draws nothing", async () => {
    const catId = await newCat();
    await machine(catId, ["grey"]);
    const res = await correct(catId, { kind: "markings", marks: ["", "torn_ear"] });
    expect(res.headers["location"]).toContain("done=a_corrected");
    expect(await page(catId, "a_corrected")).not.toContain('class="drawncat"');
  });

  it("no script: the cat page, the drawn cat and the form shown again never carry a <script>", async () => {
    const catId = await newCat();
    await correct(catId, { kind: "coat", colours: ["brown", "ginger"], pattern: "stripes" });
    const html = await page(catId, "a_coat_corrected");
    expect(html).toContain('class="drawncat"');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<[^>]*\son[a-z]+=/i);
    const again = await correct(catId, { kind: "coat" });
    expect(again.text).not.toMatch(/<script/i);
    const list = await request(app).get("/api/team/colour-check?done=a_coat_corrected").set("Cookie", cookie);
    expect(list.text).not.toMatch(/<script/i);
  });
});

describe("SYC-398 PR B: the drawn cat itself", () => {
  it("every combination of the five colours and four pattern states renders, and the caption is the golden table's", async () => {
    const { coatSvg, drawnCaption } = await import("../lib/teamPages/coatDrawing");
    const { TEAM_COAT_GOLDEN } = await import("../lib/teamPages/__fixtures__/teamCoatGolden");
    // SYC-443 §15.6: the caption is checked against the spec's table, typed by hand.
    let drawn = 0;
    for (const [row, colours, pattern, words] of TEAM_COAT_GOLDEN) {
      const coat = { colours, pattern };
      const svg = coatSvg(undefined, coat, `t${row}`);
      const caption = drawnCaption(undefined, coat);
      expect(caption, `row ${row}`).toBe(words);
      expect(svg.startsWith('<svg class="drawncat"')).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg).toContain(`aria-label="${caption}"`);
      expect(svg).not.toMatch(/undefined|null|NaN|<script/);
      drawn += 1;
    }
    expect(drawn).toBe(128);
  });

  it("draws only the vocabulary: an unknown code is dropped, never written into the SVG", async () => {
    const { coatSvg } = await import("../lib/teamPages/coatDrawing");
    const svg = coatSvg(undefined, { colours: ["ginger", '"><script>x</script>', "tabby"], pattern: "calico" }, 'x"><y');
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("tabby");
    expect(svg).not.toContain("calico");
    expect(svg).not.toContain('x"><y');
    expect(svg).toContain('aria-label="Ginger, pattern not known"');
  });
});

// ── SYC-443 PR 1: team pages say a coat in the old words ───────────────────

describe("SYC-443: the team cat page says the coat in the team's words (§15.1)", () => {
  const page = async (catId: number, done?: string) =>
    (await request(app).get(`/api/team/cats/${catId}${done ? `?done=${done}` : ""}`).set("Cookie", cookie)).text;
  const correct = (catId: number, body: Record<string, unknown>) =>
    form(`/api/team/cats/${catId}/appearance/correct`).send({ reason: "Looked closely", ...body });
  const sectionOf = (html: string) => html.slice(html.indexOf('<h2 id="appearance">'));

  it("every place on the page: summary line, photo description, Appearance, drawn cat and history", async () => {
    const catId = await newCat();
    expect((await correct(catId, { kind: "coat", colours: ["brown", "ginger"], pattern: "stripes" })).status).toBe(303);
    const html = await page(catId, "a_coat_corrected");
    const name = `${PREFIX}cat-`;
    // The summary line: the label Coat, one chip.
    expect(html).toContain('<dt>Coat</dt><dd><a href="#appearance"><span class="colourchip">Brown and ginger tabby</span></a>');
    expect(html).not.toContain("<dt>Colour</dt>");
    // The main photo's description.
    expect(html).toMatch(new RegExp(`alt="Photo of ${name}\\d+, Brown and ginger tabby"`));
    const section = sectionOf(html);
    // The heading, Confirm's hidden label and the pattern row.
    expect(section).toContain("<h3>Coat</h3>");
    expect(section).toContain('<span class="sr"> (Coat)</span>');
    expect(section).toContain("Pattern</dt><dd>Tabby");
    expect(section).toContain("Colours</dt><dd>Brown · Ginger");
    // The statement and the drawn cat.
    expect(section).toMatch(/<p class="said"><span class="sid">#\d+<\/span> Brown and ginger tabby[ <]/);
    expect(section).toContain('aria-label="Brown and ginger tabby"');
    expect(section).toContain("<strong>Brown and ginger tabby</strong>");
    // The history, and the team JSON's `said` (changed on purpose, English only).
    expect(html).toContain("Coat: Brown and ginger tabby");
    const j = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie).set("Accept", "application/json");
    expect(j.body.history.find((h: { kind: string }) => h.kind === "coat").said).toBe("Coat: Brown and ginger tabby");
    for (const bad of ["undefined", "null", "NaN", "<script"]) expect(html, bad).not.toContain(bad);
  });

  it("What the public sees still shows Brown · Ginger · Stripes", async () => {
    const catId = await newCat();
    await correct(catId, { kind: "coat", colours: ["brown", "ginger"], pattern: "stripes" });
    const section = sectionOf(await page(catId));
    expect(section).toContain('<h3>What the public sees</h3><p class="public">Brown · Ginger · Stripes</p>');
  });

  it("an unknown pattern says ', pattern not known' on the summary line and in the photo description", async () => {
    const catId = await newCat();
    await team(catId, "coat", { value: { colours: ["black", "white"] }, daysAgo: 1 });
    const html = await page(catId);
    expect(html).toContain('<span class="colourchip">Black and white, pattern not known</span>');
    expect(html).toMatch(/alt="Photo of [^"]+, Black and white, pattern not known"/);
    expect(sectionOf(html)).toContain("Pattern</dt><dd>Not known");
  });

  it("a cat with nothing known: Not known, and the photo description leaves the coat out", async () => {
    const catId = await newCat();
    const html = await page(catId);
    expect(html).toContain('<dt>Coat</dt><dd><a href="#appearance">Not known</a>');
    expect(html).toMatch(new RegExp(`alt="Photo of ${PREFIX}cat-\\d+"`));
    expect(html).not.toMatch(/Photo of [^"]+, Not known/);
  });

  it("a pattern-only team Correct's statement says 'Tabby, colours not stated'", async () => {
    const catId = await newCat();
    await correct(catId, { kind: "coat", pattern: "stripes" });
    const html = await page(catId);
    // The statement in the Appearance section itself, not the history below it.
    const [row] = await rowsFor(catId);
    expect(html).toMatch(new RegExp(`<p class="said"><span class="sid">#${row!.id}</span> Tabby, colours not stated[ <]`));
    expect(html).toContain("Coat: Tabby, colours not stated");
  });

  it("the pattern buttons show the team's words with their hints, and still post the codes", async () => {
    const catId = await newCat();
    const section = sectionOf(await page(catId));
    const labels: Record<string, string> = {
      plain: "Solid (one colour all over, maybe a little white)",
      stripes: "Tabby (stripes, swirls or spots)",
      patches: "Patched (tortoiseshell, calico, black and white…)",
      none: "Not stated",
    };
    for (const [code, label] of Object.entries(labels)) {
      expect(section).toContain(`name="pattern" value="${code}"${code === "none" ? " checked" : ""}> ${label}</label>`);
    }
    expect(section).not.toMatch(/name="pattern" value="(tabby|solid|patched)"/i);
    // Post exactly what the Tabby button carries: the code, which the write check accepts.
    const posted = /value="([^"]+)"> Tabby \(stripes/.exec(section)![1]!;
    expect(posted).toBe("stripes");
    expect((await correct(catId, { kind: "coat", colours: "ginger", pattern: posted })).status).toBe(303);
    expect((await rowsFor(catId)).at(-1)!.value).toEqual({ colours: ["ginger"], pattern: "stripes", reason: "Looked closely" });
  });
});

describe("SYC-443: the Colour check list and the Cats grid", () => {
  it("each Colour check line starts 'Coat:' with the team's phrase", async () => {
    const catId = await newCat();
    await team(catId, "coat", { value: { colours: ["grey"], pattern: "stripes" }, daysAgo: 20 });
    await twoSpotters(catId, "markings", { marks: ["long_fur"] });
    expect(await listed(catId)).toBeDefined();
    const page = await request(app).get("/api/team/colour-check").set("Cookie", cookie);
    const row = page.text.slice(page.text.indexOf(`id="c-${catId}"`));
    const end = row.indexOf('<li class="report colourcheck"', 1);
    const mine = row.slice(0, end === -1 ? row.length : end);
    expect(mine).toContain("Coat: Grey tabby · Markings:");
    expect(mine).not.toMatch(/Colour: |undefined|null/);
  });

  it("the Cats grid card says the phrase, and Coat not known when nothing is", async () => {
    const tabby = await newCat();
    await team(tabby, "coat", { value: { colours: ["ginger"], pattern: "stripes" }, daysAgo: 1 });
    const blank = await newCat();
    const nameOf = async (id: number) => (await db.select().from(catsTable).where(eq(catsTable.id, id)))[0]!.name;
    /** The grid, searched down to the one cat by its name. */
    const grid = async (id: number) =>
      (await request(app).get(`/api/team/cats?q=${encodeURIComponent(await nameOf(id))}`).set("Cookie", cookie)).text;
    const tabbyHtml = await grid(tabby);
    expect(tabbyHtml).toContain('<span class="cardfact">Ginger tabby</span>');
    expect(tabbyHtml).toContain(`alt="Photo of ${await nameOf(tabby)}, Ginger tabby"`);
    const blankHtml = await grid(blank);
    expect(blankHtml).toContain('<span class="cardfact">Coat not known</span>');
    expect(blankHtml).toContain(`alt="Photo of ${await nameOf(blank)}"`);
  });
});

describe("SYC-398 PR B: the words", () => {
  it("string parity: every new word is in en, el and fr, none empty, and never a breeder's name", async () => {
    const { en } = await import("../lib/teamPages/strings/en");
    const { el } = await import("../lib/teamPages/strings/el");
    const { fr } = await import("../lib/teamPages/strings/fr");
    expect(Object.keys(el).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    const keys = [
      "pattern.plain",
      "pattern.stripes",
      "pattern.patches",
      "pattern.none",
      "appearance.pickPattern",
      "appearance.needAPart",
      "appearance.problemTitle",
      "appearance.drawnTitle",
      "appearance.drawnColoursNotKnown",
      "appearance.drawnPatternNotKnown",
    ] as const;
    const all = { en, el, fr } as Record<string, Record<string, string>>;
    for (const k of keys) {
      for (const lang of ["en", "el", "fr"]) {
        const w = all[lang]![k];
        expect(w, `${lang} ${k}`).toBeTruthy();
        expect(w!.trim(), `${lang} ${k}`).toBe(w);
        expect(w, `${lang} ${k}`).not.toMatch(/tabby|tortoiseshell|calico|colony carer|snapper/i);
      }
      // Greek and French are their own words, not English left in place.
      expect(all["el"]![k], k).not.toBe(all["en"]![k]);
      expect(all["fr"]![k], k).not.toBe(all["en"]![k]);
    }
    // The pattern names are the spec's (§2).
    expect([en["pattern.plain"], en["pattern.stripes"], en["pattern.patches"], en["pattern.none"]]).toEqual([
      "Plain",
      "Stripes",
      "Patches",
      "Not stated",
    ]);
  });
});
