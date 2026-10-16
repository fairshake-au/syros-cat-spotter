import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, inArray, like, sql } from "drizzle-orm";
import {
  addPerson,
  catsTable,
  db,
  mailOutboxTable,
  markLeft,
  observationsTable,
  photosTable,
  sightingsTable,
  pool,
  welfareReportsTable,
  type Observation,
} from "@workspace/db";
import app from "../app";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import {
  seedReport,
  sessionCookieFor,
  signInThroughHandoff,
  TEAM_ORIGIN,
} from "../lib/teamAuth/__fixtures__/queueKit";
import { loadCatRecords, ObservationRefused, writeObservation } from "../lib/observations";
import { resolveCat } from "../lib/resolve";
import { tieReportToCat } from "../lib/welfareTie";
import { deleteTestSightings } from "../test/sightings";

// SYC-43 part 2 plan, PR 5: "Which cat is this?" on a welfare report.
// Tests P5-1 to P5-4 (and the edges around them).
//
// `can` is wrapped as in PR 4's tests: `denied.cap`, when set, is refused to
// everyone, so a missing capability can be tested although staff hold all.
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
const PREFIX = `vt-p5-${RUN}-`;
const SUSAN = `vitest-p5-susan-${RUN}@example.com`;
const VERA = `vitest-p5-vera-${RUN}@example.com`;
const KEY = "vitest-p5-key-0123456789abcdef-0123456789abcd";
const NOTE = `NOTE-TEXT-${RUN}-thin-grey-cat-by-the-bins`;
const handoffKey = makeKey();

let cookie: string;
let volunteerCookie: string;
let susanId: string;
let n = 0;

async function cleanup() {
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(welfareReportsTable).where(like(welfareReportsTable.publicId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  await db.delete(photosTable).where(like(photosTable.publicId, `${PREFIX}%`));
}

async function newCat(name?: string): Promise<number> {
  const k = ++n; // taken before any await: callers run newCat concurrently
  const publicId = `${PREFIX}photo-${k}`;
  const [p] = await db
    .insert(photosTable)
    .values({ publicId, data: Buffer.from(`fake ${k}`).toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  const [c] = await db
    .insert(catsTable)
    .values({
      name: name ?? `${PREFIX}cat-${k}`,
      description: "",
      primaryPhotoId: p!.id,
      lat: 37.445,
      lng: 24.942,
      discovererDeviceId: `${PREFIX}spotter`,
    })
    .returning({ id: catsTable.id });
  return c!.id;
}

async function newReport(o: Parameters<typeof seedReport>[0] = {}) {
  const k = ++n;
  return seedReport({ publicId: `${PREFIX}r${k}`, note: NOTE, ...o });
}

/** The HTML of one queue row, from its opening tag to its closing one. */
function rowHtml(page: string, publicId: string): string {
  const start = page.indexOf(`id="r-${publicId}"`);
  expect(start).toBeGreaterThan(-1);
  return page.slice(start, page.indexOf("</article>", start));
}

const rowsFor = (catId: number) =>
  db.select().from(observationsTable).where(eq(observationsTable.catId, catId)).orderBy(observationsTable.id);

const welfareRowsFor = async (reportId: number): Promise<Observation[]> =>
  (
    await db
      .select()
      .from(observationsTable)
      .where(sql`${observationsTable.kind} in ('welfare_report', 'welfare_outcome') and ${observationsTable.value}->>'reportId' = ${String(reportId)}`)
      .orderBy(observationsTable.id)
  );

const reportRow = async (publicId: string) =>
  (await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.publicId, publicId)))[0]!;

const NOW = new Date("2026-10-08T12:00:00Z");

async function records(catId: number) {
  return (await loadCatRecords([catId])).get(catId)!;
}

/** What the resolver says about life status and sterilisation (not "last seen"). */
async function answers(catId: number) {
  const r = await records(catId);
  const s = resolveCat(r.observations, r.evidenceOfLife, NOW);
  return {
    lifeStatus: s.lifeStatus,
    lifeStatusConfidence: s.lifeStatusConfidence,
    presumedDeceased: s.presumedDeceased,
    sterilised: s.sterilised,
  };
}

const form = (path: string, c = cookie) =>
  request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", c).type("form");

const tie = (publicId: string, catId: number, expected: number | null, c = cookie) =>
  form(`/api/team/reports/${publicId}/cat`, c).send({
    catId: String(catId),
    expectedCatId: expected === null ? "" : String(expected),
  });

const moveState = (publicId: string, from: string, to: string) =>
  form(`/api/team/reports/${publicId}/state`).send({ from, to });

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await cleanup();
  susanId = (await addPerson({ email: SUSAN, name: "Susan", addedBy: "cli:vitest", roles: ["staff"] })).id;
  cookie = await signInThroughHandoff(app, handoffKey, susanId);
  const vera = await addPerson({ email: VERA, name: "Vera", addedBy: "cli:vitest", roles: ["vet"] });
  volunteerCookie = sessionCookieFor(vera.id);
});

beforeEach(() => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  denied.cap = null;
});

afterAll(async () => {
  await cleanup();
  await markLeft(SUSAN, "cli:vitest");
  await markLeft(VERA, "cli:vitest");
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

// ── P5-1 ───────────────────────────────────────────────────────────────────

describe("P5-1 [SYC-42 #40]: tying and closing write the right rows and move no answer", () => {
  it("writes one welfare_report by the reporter's device, with no note, and one welfare_outcome by the staff member", async () => {
    const device = `${PREFIX}reporter-device`;
    const catId = await newCat();
    // The cat already has team answers, so "identical before and after" says something.
    await writeObservation(db, {
      catId,
      kind: "life_status",
      value: { status: "in_care", reason: "Taken in" },
      accountId: susanId,
      roleAtTime: "staff",
      observedAt: new Date(Date.now() - 3 * 86_400_000),
    });
    await writeObservation(db, {
      catId,
      kind: "sterilised",
      value: { sterilised: true, reason: "Vet record" },
      accountId: susanId,
      roleAtTime: "staff",
      observedAt: new Date(Date.now() - 2 * 86_400_000),
    });
    const r = await newReport({ severity: "urgent", isLitter: true, reporterDevice: device, sentMinutesAgo: 90 });
    const before = await answers(catId);
    const rowsBefore = await rowsFor(catId);

    const res = await tie(r.publicId, catId, null);
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team?tied=ok&r=${r.publicId}#r-${r.publicId}`);

    const added = (await rowsFor(catId)).slice(rowsBefore.length);
    expect(added).toHaveLength(1);
    const row = added[0]!;
    expect(row.kind).toBe("welfare_report");
    expect(row.deviceId).toBe(device);
    expect(row.accountId).toBeNull();
    expect(row.roleAtTime).toBe("public");
    expect(row.supersedesId).toBeNull();
    expect(Object.keys(row.value as object).sort()).toEqual(["isLitter", "reportId", "severity"]);
    expect(row.value).toEqual({ severity: "urgent", isLitter: true, reportId: r.id });
    // The reporter's note, and any photo, are nowhere in the row.
    expect(JSON.stringify(row)).not.toContain(NOTE);
    expect(JSON.stringify(row)).not.toContain("thin-grey-cat");
    expect(row.photoId).toBeNull();
    expect(row.sightingId).toBeNull();
    // When it was sent, not when it was tied.
    const sent = (await reportRow(r.publicId)).submittedAt!;
    expect(row.observedAt.getTime()).toBe(sent.getTime());
    expect((await reportRow(r.publicId)).catId).toBe(catId);
    expect(await answers(catId)).toEqual(before);

    // Closing writes the outcome, authored by the staff member.
    const close = await moveState(r.publicId, "new", "done");
    expect(close.status).toBe(303);
    const outcomes = (await rowsFor(catId)).filter((o) => o.kind === "welfare_outcome");
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.accountId).toBe(susanId);
    expect(outcomes[0]!.roleAtTime).toBe("staff");
    expect(outcomes[0]!.deviceId).toBeNull();
    expect(outcomes[0]!.value).toEqual({ state: "done", reportId: r.id });
    expect(await answers(catId)).toEqual(before);

    // Nothing was emailed.
    const mail = await db.select({ id: mailOutboxTable.id }).from(mailOutboxTable).where(eq(mailOutboxTable.reportId, r.id));
    expect(mail).toHaveLength(0);
  });

  it("reopening and closing again writes a second outcome; closing an untied report writes none", async () => {
    const catId = await newCat();
    const r = await newReport();
    await tie(r.publicId, catId, null);
    expect((await moveState(r.publicId, "new", "done")).status).toBe(303);
    expect((await moveState(r.publicId, "done", "new")).status).toBe(303);
    // Reopening is not an outcome.
    expect((await rowsFor(catId)).filter((o) => o.kind === "welfare_outcome")).toHaveLength(1);
    expect((await moveState(r.publicId, "new", "nothing_needed")).status).toBe(303);
    const outcomes = (await rowsFor(catId)).filter((o) => o.kind === "welfare_outcome");
    expect(outcomes.map((o) => (o.value as { state: string }).state)).toEqual(["done", "nothing_needed"]);
    // A stale move (someone else moved it first) writes no outcome.
    expect((await moveState(r.publicId, "new", "done")).headers["location"]).toContain("changed=");
    expect((await rowsFor(catId)).filter((o) => o.kind === "welfare_outcome")).toHaveLength(2);

    const untied = await newReport();
    expect((await moveState(untied.publicId, "new", "done")).status).toBe(303);
    expect(await welfareRowsFor(untied.id)).toHaveLength(0);
    const mail = await db.select({ id: mailOutboxTable.id }).from(mailOutboxTable).where(inArray(mailOutboxTable.reportId, [r.id, untied.id]));
    expect(mail).toHaveLength(0);
  });
});

// ── P5-2 ───────────────────────────────────────────────────────────────────

describe("P5-2: choosing a different cat supersedes the first welfare_report, and the old cat's history says why", () => {
  it("writes ONE row on the new cat that replaces the old one, and none on the old cat", async () => {
    const a = await newCat(`${PREFIX}Alpha`);
    const b = await newCat(`${PREFIX}Beta`);
    const r = await newReport({ severity: "attention", isLitter: true });

    await tie(r.publicId, a, null);
    const [first] = (await rowsFor(a)).filter((o) => o.kind === "welfare_report");
    const aBefore = await rowsFor(a);
    // While tied to A, the report counts as evidence A was alive.
    expect((await records(a)).evidenceOfLife!.source).toBe("welfare_report");

    const res = await tie(r.publicId, b, a);
    expect(res.headers["location"]).toBe(`/api/team?tied=ok&r=${r.publicId}#r-${r.publicId}`);
    expect((await reportRow(r.publicId)).catId).toBe(b);

    // Nothing new on the old cat.
    expect(await rowsFor(a)).toEqual(aBefore);
    const onB = (await rowsFor(b)).filter((o) => o.kind === "welfare_report");
    expect(onB).toHaveLength(1);
    expect(onB[0]!.supersedesId).toBe(first!.id);
    expect(onB[0]!.supersedeReason).toBe("tied to the wrong cat");
    expect(onB[0]!.value).toEqual({ severity: "attention", isLitter: true, reportId: r.id });
    expect(JSON.stringify(onB[0])).not.toContain(NOTE);

    // The old cat's page shows it struck through, with the reason and where it went.
    const json = await request(app).get(`/api/team/cats/${a}`).set("Cookie", cookie).set("Accept", "application/json");
    const struck = (json.body.history as { id: number; replacedBy: number[]; movedTo: { cat: { id: number; name: string }; reason: string } | null }[]).find((h) => h.id === first!.id)!;
    expect(struck.replacedBy).toEqual([onB[0]!.id]);
    expect(struck.movedTo!.cat).toMatchObject({ id: b, name: `${PREFIX}Beta` });
    expect(struck.movedTo!.reason).toBe("tied to the wrong cat");
    const pageA = await request(app).get(`/api/team/cats/${a}`).set("Cookie", cookie);
    expect(pageA.text).toContain("<del>Welfare report: needs attention, kittens</del>");
    expect(pageA.text).toContain(`Moved to <a href="/api/team/cats/${b}">${PREFIX}Beta</a>`);
    expect(pageA.text).toContain("Why: tied to the wrong cat");
    // The new cat's history shows the new entry, and where it came from.
    const pageB = await request(app).get(`/api/team/cats/${b}`).set("Cookie", cookie);
    expect(pageB.text).toContain("Welfare report: needs attention, kittens");
    expect(pageB.text).not.toContain("<del>Welfare report");
    expect(pageB.text).toContain(`Moved here from <a href="/api/team/cats/${a}">${PREFIX}Alpha</a>`);

    // The old cat's evidence of life no longer counts the replaced report;
    // the new cat's does.
    expect((await records(a)).evidenceOfLife!.source).toBe("created");
    expect((await records(b)).evidenceOfLife!.source).toBe("welfare_report");
  });

  it("closing after a re-tie records the outcome on the cat it is tied to now", async () => {
    const a = await newCat();
    const b = await newCat();
    const r = await newReport();
    await tie(r.publicId, a, null);
    await tie(r.publicId, b, a);
    await moveState(r.publicId, "new", "done");
    expect((await rowsFor(a)).filter((o) => o.kind === "welfare_outcome")).toHaveLength(0);
    expect((await rowsFor(b)).filter((o) => o.kind === "welfare_outcome")).toHaveLength(1);
  });

  it("loadCatRecords still issues the same number of queries however many cats it is asked for", async () => {
    const few = [await newCat(), await newCat()];
    const many = await Promise.all(Array.from({ length: 20 }, () => newCat()));
    const spy = vi.spyOn(pool, "query");
    spy.mockClear();
    await loadCatRecords(few);
    const fewCount = spy.mock.calls.length;
    spy.mockClear();
    await loadCatRecords(many);
    const manyCount = spy.mock.calls.length;
    spy.mockRestore();
    expect(fewCount).toBeGreaterThan(0);
    expect(manyCount).toBe(fewCount);
  });
});

// ── P5-3 ───────────────────────────────────────────────────────────────────

describe("P5-3: a report whose reporter's device is gone ties as the app's own welfare-report author", () => {
  it("authors as system:welfare-report", async () => {
    const catId = await newCat();
    const r = await newReport({ reporterDevice: null });
    expect((await tie(r.publicId, catId, null)).status).toBe(303);
    const [row] = (await rowsFor(catId)).filter((o) => o.kind === "welfare_report");
    expect(row!.accountId).toBe("system:welfare-report");
    expect(row!.roleAtTime).toBe("system");
    expect(row!.deviceId).toBeNull();
    expect(row!.value).toEqual({ severity: "attention", isLitter: false, reportId: r.id });
    // The queue still shows it, tied.
    const q = await request(app).get("/api/team/reports").set("Cookie", cookie);
    const found = (q.body.open as { id: string; cat: { id: number } | null }[]).find((x) => x.id === r.publicId);
    expect(found!.cat!.id).toBe(catId);
    // The cat's history labels it as a welfare report.
    const view = await request(app).get(`/api/team/cats/${catId}`).set("Cookie", cookie).set("Accept", "application/json");
    expect((view.body.history as { author: { label: string } }[])[0]!.author.label).toBe("a welfare report");
  });
});

// ── P5-4 ───────────────────────────────────────────────────────────────────

describe("P5-4: two people tying one report at once", () => {
  it("six concurrent re-ties to six different cats: exactly one wins and exactly one superseding row exists", async () => {
    const a = await newCat();
    const r = await newReport();
    await tie(r.publicId, a, null);
    const [first] = (await rowsFor(a)).filter((o) => o.kind === "welfare_report");
    const targets = await Promise.all(Array.from({ length: 6 }, () => newCat()));

    const results = await Promise.all(targets.map((c) => tie(r.publicId, c, a)));
    const ok = results.filter((x) => String(x.headers["location"]).includes("tied=ok"));
    const changed = results.filter((x) => String(x.headers["location"]).includes("tied=changed"));
    expect(results.every((x) => x.status === 303)).toBe(true);
    expect(ok).toHaveLength(1);
    expect(changed).toHaveLength(5);

    const superseding = await db.select().from(observationsTable).where(eq(observationsTable.supersedesId, first!.id));
    expect(superseding).toHaveLength(1);
    const winner = (await reportRow(r.publicId)).catId;
    expect(winner).toBe(superseding[0]!.catId);
    expect(targets).toContain(winner);
    // One standing welfare_report for the report, and the losers wrote nothing.
    const all = (await welfareRowsFor(r.id)).filter((o) => o.kind === "welfare_report");
    expect(all).toHaveLength(2);
    // The page the browser lands on says it where the row is.
    const page = await request(app).get(changed[0]!.headers["location"]!).set("Cookie", cookie);
    expect(rowHtml(page.text, r.publicId)).toContain('<p class="notice" role="status">Someone else tied this report a moment ago.');
    expect(page.text.split("Someone else tied this report a moment ago.")).toHaveLength(2);
  });

  it("JSON callers get the message and a 409", async () => {
    const a = await newCat();
    const b = await newCat();
    const r = await newReport();
    await tie(r.publicId, a, null);
    const res = await request(app)
      .post(`/api/team/reports/${r.publicId}/cat`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .send({ catId: b, expectedCatId: null });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Someone else tied this report a moment ago.");
    expect(res.body.report.cat.id).toBe(a);
    const ok = await request(app)
      .post(`/api/team/reports/${r.publicId}/cat`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .send({ catId: b, expectedCatId: a });
    expect(ok.status).toBe(200);
    expect(ok.body.cat.id).toBe(b);
  });

  it("a burst of ties across many reports doesn't exhaust the connection pool, and each report is tied once", async () => {
    const c1 = await newCat();
    const c2 = await newCat();
    const reports = await Promise.all(Array.from({ length: 14 }, () => newReport()));
    const results = await Promise.all(
      reports.flatMap((r) => [tie(r.publicId, c1, null), tie(r.publicId, c2, null)]),
    );
    expect(results.every((x) => x.status === 303)).toBe(true);
    for (const r of reports) {
      const mine = results.filter((x) => String(x.headers["location"]).includes(`r=${r.publicId}#`));
      expect(mine.filter((x) => String(x.headers["location"]).includes("tied=ok"))).toHaveLength(1);
      expect(mine.filter((x) => String(x.headers["location"]).includes("tied=changed"))).toHaveLength(1);
      const rows = await welfareRowsFor(r.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.catId).toBe((await reportRow(r.publicId)).catId);
    }
  }, 30_000);
});

// ── Refusals and edges ─────────────────────────────────────────────────────

describe("refusals and edges", () => {
  it("refuses without change_report_state, with the 403, the same way as everything else, and writes nothing", async () => {
    const catId = await newCat();
    const r = await newReport();
    denied.cap = "change_report_state";
    const res = await tie(r.publicId, catId, null);
    expect([res.status, res.text]).toEqual([403, '{"error":"forbidden"}']);
    // The second layer, inside the function, refuses on its own too.
    const person = { id: susanId, scopes: [{ role: "staff", colonyId: null }] };
    await expect(
      tieReportToCat({ person, publicId: r.publicId, catId, expectedCatId: null }),
    ).rejects.toBeInstanceOf(ObservationRefused);
    denied.cap = null;
    expect((await reportRow(r.publicId)).catId).toBeNull();
    expect(await welfareRowsFor(r.id)).toHaveLength(0);
    // And a session with no staff scope gets the identical answer.
    const vol = await tie(r.publicId, catId, null, volunteerCookie);
    expect([vol.status, vol.text]).toEqual([403, '{"error":"forbidden"}']);
    expect(await welfareRowsFor(r.id)).toHaveLength(0);
  });

  it("refuses a missing or wrong Origin", async () => {
    const catId = await newCat();
    const r = await newReport();
    const none = await request(app).post(`/api/team/reports/${r.publicId}/cat`).set("Cookie", cookie).type("form").send({ catId: String(catId), expectedCatId: "" });
    const wrong = await request(app).post(`/api/team/reports/${r.publicId}/cat`).set("Origin", "https://evil.example").set("Cookie", cookie).type("form").send({ catId: String(catId), expectedCatId: "" });
    for (const res of [none, wrong]) expect([res.status, res.text]).toEqual([401, '{"error":"not_signed_in"}']);
    expect((await reportRow(r.publicId)).catId).toBeNull();
  });

  it("a draft can't be tied; an unknown report is not found", async () => {
    const catId = await newCat();
    const draft = await newReport({ isDraft: true });
    expect((await tie(draft.publicId, catId, null)).status).toBe(404);
    expect((await tie(`${PREFIX}nope`, catId, null)).status).toBe(404);
    expect((await reportRow(draft.publicId)).catId).toBeNull();
  });

  it("an unknown cat is a 400 naming the field only", async () => {
    const r = await newReport();
    const res = await request(app)
      .post(`/api/team/reports/${r.publicId}/cat`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .send({ catId: 999_999_998, expectedCatId: null });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid request", fields: ["catId"] });
    expect(JSON.stringify(res.body)).not.toContain("999999998");
    const html = await tie(r.publicId, 999_999_998, null);
    expect(html.status).toBe(400);
    expect(html.text).toContain("That cat couldn&#39;t be found.");
    expect(html.text).not.toContain("999999998");
    const junk = await request(app)
      .post(`/api/team/reports/${r.publicId}/cat`)
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", cookie)
      .send({ catId: "<b>x</b>", expectedCatId: "nope" });
    expect(junk.status).toBe(400);
    expect(junk.body.fields.sort()).toEqual(["catId", "expectedCatId"]);
    expect(JSON.stringify(junk.body)).not.toContain("<b>");
    expect((await reportRow(r.publicId)).catId).toBeNull();
    expect(await welfareRowsFor(r.id)).toHaveLength(0);
  });

  it("a page that showed the report untied, or tied elsewhere, is told someone else got there first", async () => {
    const a = await newCat();
    const b = await newCat();
    const r = await newReport();
    const stale = await tie(r.publicId, a, b); // page claimed it was tied to b
    expect(stale.headers["location"]).toContain("tied=changed");
    expect((await reportRow(r.publicId)).catId).toBeNull();
    await tie(r.publicId, a, null);
    const again = await tie(r.publicId, a, null); // a second tap of the same tie
    expect(again.headers["location"]).toContain("tied=changed");
    // Choosing the cat it is already tied to is a no-op, said plainly.
    const same = await tie(r.publicId, a, a);
    expect(same.headers["location"]).toContain("tied=same");
    expect((await welfareRowsFor(r.id)).filter((o) => o.kind === "welfare_report")).toHaveLength(1);
    const page = await request(app).get(same.headers["location"]!).set("Cookie", cookie);
    expect(page.text).toContain("This report is already tied to that cat.");
  });

  it("works on a closed report too", async () => {
    const catId = await newCat();
    const r = await newReport({ state: "done" });
    expect((await tie(r.publicId, catId, null)).headers["location"]).toContain("tied=ok");
    expect((await rowsFor(catId)).filter((o) => o.kind === "welfare_report")).toHaveLength(1);
  });
});

// ── The screens ────────────────────────────────────────────────────────────

describe("the queue row and the tie-mode search", () => {
  it("offers 'Match to a known cat' on an untied row, and the cat's name with 'Wrong cat?' on a tied one", async () => {
    const catId = await newCat(`${PREFIX}Tigger <i>`);
    const r = await newReport();
    const page = await request(app).get("/api/team").set("Cookie", cookie);
    expect(page.text).toContain(`<a class="tap" href="/api/team/cats?tie=${r.publicId}">Match to a known cat</a>`);
    await tie(r.publicId, catId, null);
    const tied = await request(app).get("/api/team").set("Cookie", cookie);
    expect(tied.text).toContain(`<a class="tap catlink" href="/api/team/cats/${catId}">${PREFIX}Tigger &lt;i&gt;</a>`);
    expect(tied.text).toContain(`href="/api/team/cats?tie=${r.publicId}">Wrong cat? Choose another</a>`);
    expect(tied.text).not.toContain(`/api/team/cats?tie=${r.publicId}">Match to a known cat`);
    expect(tied.text).not.toContain("Tigger <i>");
    // The row's confirmation sits at the row.
    const landed = await request(app).get(`/api/team?tied=ok&r=${r.publicId}`).set("Cookie", cookie);
    expect(rowHtml(landed.text, r.publicId)).toContain('<p class="notice" role="status">Saved. This report is now tied to the cat shown below.');
    // An unknown key says nothing, and the id is never echoed.
    const junk = await request(app).get("/api/team?tied=%3Cscript%3E&r=%3Cscript%3E").set("Cookie", cookie);
    expect(junk.status).toBe(200);
    expect(junk.text).not.toContain("<script>");
    // Inherited keys on a real row say nothing either (not a 500).
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      const proto = await request(app).get(`/api/team?tied=${key}&r=${r.publicId}`).set("Cookie", cookie);
      expect(proto.status, key).toBe(200);
      expect(rowHtml(proto.text, r.publicId), key).not.toContain('<p class="notice"');
    }
  });

  it("each result in tie mode has a plain 'This is the cat' form carrying what the page showed", async () => {
    const a = await newCat(`${PREFIX}Gamma`);
    const b = await newCat(`${PREFIX}Delta`);
    const r = await newReport();
    const fresh = await request(app).get(`/api/team/cats?tie=${r.publicId}&q=${encodeURIComponent(`${PREFIX}Gamma`)}`).set("Cookie", cookie);
    expect(fresh.status).toBe(200);
    expect(fresh.text).toContain("Which cat is this?");
    expect(fresh.text).toContain(`<input type="hidden" name="tie" value="${r.publicId}">`);
    expect(fresh.text).toContain(`action="/api/team/reports/${r.publicId}/cat"`);
    expect(fresh.text).toContain(`<input type="hidden" name="catId" value="${a}"><input type="hidden" name="expectedCatId" value="">`);
    // Only our own grid script (SYC-396 PR 1.3.4); the forms work without it.
    expect(fresh.text.match(/<script\b/g)).toHaveLength(1);
    expect(fresh.text).toMatch(/<script src="\/api\/team\/assets\/dashboard-grid\.[0-9a-f]{12}\.js" defer><\/script>/);
    // Without a tie, the search is the plain search from PR 3.
    const plain = await request(app).get(`/api/team/cats?q=${encodeURIComponent(`${PREFIX}Gamma`)}`).set("Cookie", cookie);
    expect(plain.text).not.toContain("This is the cat");
    // Tied to A: A says so, B offers the form with expectedCatId = A.
    await tie(r.publicId, a, null);
    const forA = await request(app).get(`/api/team/cats?tie=${r.publicId}&q=${encodeURIComponent(`${PREFIX}Gamma`)}`).set("Cookie", cookie);
    expect(forA.text).toContain("This report is already tied to this cat.");
    expect(forA.text).not.toContain(`name="catId" value="${a}"`);
    const forB = await request(app).get(`/api/team/cats?tie=${r.publicId}&q=${encodeURIComponent(`${PREFIX}Delta`)}`).set("Cookie", cookie);
    expect(forB.text).toContain(`<input type="hidden" name="catId" value="${b}"><input type="hidden" name="expectedCatId" value="${a}">`);
    // And the JSON search ignores tie mode.
    const json = await request(app).get(`/api/team/cats?tie=${r.publicId}&q=${encodeURIComponent(`${PREFIX}Gamma`)}`).set("Cookie", cookie).set("Accept", "application/json");
    expect(Object.keys(json.body).sort()).toEqual(["query", "results"]);
  });

  it("escapes a hostile cat name and ignores a hostile or unknown tie id", async () => {
    const hostile = `${PREFIX}Zed <img src=x onerror=alert(1)>`;
    await newCat(hostile);
    const r = await newReport();
    const page = await request(app).get(`/api/team/cats?tie=${r.publicId}&q=${encodeURIComponent(`${PREFIX}Zed`)}`).set("Cookie", cookie);
    expect(page.text).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(page.text).not.toContain("<img src=x");
    const bad = await request(app).get(`/api/team/cats?tie=${encodeURIComponent('"><script>alert(1)</script>')}`).set("Cookie", cookie);
    expect(bad.status).toBe(200);
    expect(bad.text).not.toContain("<script>alert");
    expect(bad.text).not.toContain("This is the cat");
    const unknown = await request(app).get(`/api/team/cats?tie=${PREFIX}nope`).set("Cookie", cookie);
    expect(unknown.status).toBe(200);
    expect(unknown.text).toContain("That report couldn't be found.");
    expect(unknown.text).not.toContain("This is the cat");
    // A draft isn't a report you can tie.
    const draft = await newReport({ isDraft: true });
    const d = await request(app).get(`/api/team/cats?tie=${draft.publicId}`).set("Cookie", cookie);
    expect(d.text).toContain("That report couldn't be found.");
  });
});

// ── The close follows the report ───────────────────────────────────────────

describe("a closed report's outcome moves with it", () => {
  const standing = async (catId: number) => {
    const rows = (await rowsFor(catId)).filter((o) => o.kind === "welfare_outcome");
    const replaced = new Set(
      (await db.select({ s: observationsTable.supersedesId }).from(observationsTable)).map((r) => r.s),
    );
    return rows.filter((o) => !replaced.has(o.id));
  };

  it("tie, close, re-tie: one standing outcome, on the new cat; the old cat shows it moved", async () => {
    const a = await newCat(`${PREFIX}Outa`);
    const b = await newCat(`${PREFIX}Outb`);
    const r = await newReport();
    await tie(r.publicId, a, null);
    await moveState(r.publicId, "new", "done");
    const [old] = await standing(a);
    expect(old).toBeDefined();

    expect((await tie(r.publicId, b, a)).headers["location"]).toContain("tied=ok");
    expect(await standing(a)).toHaveLength(0);
    const onB = await standing(b);
    expect(onB).toHaveLength(1);
    expect(onB[0]).toMatchObject({
      supersedesId: old!.id,
      supersedeReason: "tied to the wrong cat",
      accountId: susanId,
      roleAtTime: "staff",
      value: { state: "done", reportId: r.id },
    });
    expect(onB[0]!.observedAt.getTime()).toBe(old!.observedAt.getTime());

    const json = await request(app).get(`/api/team/cats/${a}`).set("Cookie", cookie).set("Accept", "application/json");
    const struck = (json.body.history as { id: number; kind: string; movedTo: { cat: { id: number } } | null }[]).find((h) => h.id === old!.id)!;
    expect(struck.movedTo!.cat.id).toBe(b);
    const pageA = await request(app).get(`/api/team/cats/${a}`).set("Cookie", cookie);
    expect(pageA.text).toContain("<del>Welfare report closed: done</del>");
    const pageB = await request(app).get(`/api/team/cats/${b}`).set("Cookie", cookie);
    expect(pageB.text).toContain(`Moved here from <a href="/api/team/cats/${a}">${PREFIX}Outa</a>`);
  });

  it("tying a report that was already closed writes the outcome, by the person who closed it", async () => {
    // Closed by Nikos, tied by Susan: the outcome is Nikos's, not the tier's.
    const nikosId = (await addPerson({ email: `${PREFIX}nikos@example.com`, name: "Nikos", addedBy: "cli:vitest", roles: ["staff"] })).id;
    const catId = await newCat();
    const r = await newReport({ state: "nothing_needed", stateChangedBy: nikosId });
    const closedAt = (await reportRow(r.publicId)).stateChangedAt!;
    await tie(r.publicId, catId, null);
    const [o] = await standing(catId);
    expect(o).toMatchObject({ accountId: nikosId, roleAtTime: "staff", value: { state: "nothing_needed", reportId: r.id } });
    expect(o!.observedAt.getTime()).toBe(closedAt.getTime());
    // Closed with nobody on record: the person tying, now.
    const anon = await newReport({ state: "done" });
    const c2 = await newCat();
    await tie(anon.publicId, c2, null);
    const [o2] = await standing(c2);
    expect(o2).toMatchObject({ accountId: susanId, roleAtTime: "staff" });
  });

  it("reopen, re-tie, close: one standing outcome per close, all on the new cat", async () => {
    const a = await newCat();
    const b = await newCat();
    const r = await newReport();
    await tie(r.publicId, a, null);
    await moveState(r.publicId, "new", "done");
    await moveState(r.publicId, "done", "new");
    await tie(r.publicId, b, a);
    await moveState(r.publicId, "new", "nothing_needed");
    expect(await standing(a)).toHaveLength(0);
    const onB = await standing(b);
    expect(onB.map((o) => (o.value as { state: string }).state)).toEqual(["done", "nothing_needed"]);
  });
});

// ── The public answer does not move ────────────────────────────────────────

describe("tying changes nothing the public sees", () => {
  it("GET /api/cats/:id is byte-identical before and after the first tie", async () => {
    const catId = await newCat();
    const [p] = await db.select({ id: photosTable.id }).from(photosTable).where(like(photosTable.publicId, `${PREFIX}photo-%`)).limit(1);
    await db.insert(sightingsTable).values({
      catId,
      deviceId: `${PREFIX}spotter`,
      photoId: p!.id,
      lat: 37.4451,
      lng: 24.9421,
      status: "resolved",
      createdAt: new Date(Date.now() - 3_600_000),
    });
    const r = await newReport({ severity: "urgent", isLitter: true });
    const before = await request(app).get(`/api/cats/${catId}`);
    expect(before.status).toBe(200);
    expect((await tie(r.publicId, catId, null)).headers["location"]).toContain("tied=ok");
    await moveState(r.publicId, "new", "done");
    const after = await request(app).get(`/api/cats/${catId}`);
    expect(after.text).toBe(before.text);
  });
});
