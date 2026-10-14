import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  addPerson,
  db,
  mailOutboxTable,
  pool,
  reportStateEventsTable,
  welfareReportsTable,
} from "@workspace/db";
import app from "../app";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import {
  clearWelfareTables,
  seedReport,
  sessionCookieFor,
  signInThroughHandoff,
  TEAM_ORIGIN,
} from "../lib/teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "../test/removeTestPerson";

// SYC-43 part 2 plan, PR 2: moving a report between the four states.
// P2-1 (one event, the signed-in person), P2-2 (two at once), P2-3 (Origin),
// P2-4 (no mail), P2-5 (drafts and bad states).

const SUSAN = "vitest-state-susan@example.com";
const MARIA = "vitest-state-maria@example.com";
const VERA = "vitest-state-vera@example.com";
const KEY = "vitest-state-key-0123456789abcdef-0123456789";
const handoffKey = makeKey();
let susanId: string;
let mariaId: string;
let susanCookie: string;
let mariaCookie: string;
let veraCookie: string;

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await clearWelfareTables();
  for (const e of [SUSAN, MARIA, VERA]) await removeTestPerson(e);
  const susan = await addPerson({
    email: SUSAN,
    name: "Susan",
    addedBy: "cli:vitest",
  });
  const maria = await addPerson({
    email: MARIA,
    name: "Maria",
    addedBy: "cli:vitest",
  });
  const vera = await addPerson({
    email: VERA,
    name: "Vera",
    addedBy: "cli:vitest",
    roles: ["vet"],
  });
  susanId = susan.id;
  mariaId = maria.id;
  susanCookie = await signInThroughHandoff(app, handoffKey, susan.id);
  mariaCookie = await signInThroughHandoff(app, handoffKey, maria.id);
  // A vet (who holds nothing yet) gets no session from the hand-off (SYC-188).
  veraCookie = sessionCookieFor(vera.id);
});

beforeEach(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await clearWelfareTables();
});

afterAll(async () => {
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await clearWelfareTables();
  for (const e of [SUSAN, MARIA, VERA]) await removeTestPerson(e);
  await pool.end();
});

const move = (
  publicId: string,
  body: Record<string, unknown>,
  cookie = susanCookie,
) =>
  request(app)
    .post(`/api/team/reports/${publicId}/state`)
    .set("Origin", TEAM_ORIGIN)
    .set("Cookie", cookie)
    .send(body);

const moveForm = (
  publicId: string,
  body: Record<string, string>,
  cookie = susanCookie,
) =>
  request(app)
    .post(`/api/team/reports/${publicId}/state`)
    .set("Origin", TEAM_ORIGIN)
    .set("Cookie", cookie)
    .type("form")
    .send(body);

const events = (reportId: number) =>
  db
    .select()
    .from(reportStateEventsTable)
    .where(eq(reportStateEventsTable.reportId, reportId));

const report = async (reportId: number) =>
  (
    await db
      .select()
      .from(welfareReportsTable)
      .where(eq(welfareReportsTable.id, reportId))
  )[0]!;

describe("P2-1: a state change writes exactly one event, by the signed-in person", () => {
  it("answers JSON 200 with the new row, and records who moved it", async () => {
    const { id, publicId } = await seedReport({ state: "new" });
    const res = await move(publicId, { from: "new", to: "looking" });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(publicId);
    expect(res.body.state).toBe("looking");
    expect(res.body.stateChangedBy).toEqual({ name: "Susan", left: false });
    const ev = await events(id);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      reportId: id,
      fromState: "new",
      toState: "looking",
      personId: susanId,
      reporterMessage: null,
    });
    const row = await report(id);
    expect(row.state).toBe("looking");
    expect(row.stateChangedBy).toBe(susanId);
    expect(row.stateChangedAt).not.toBeNull();
  });

  it("records the other person when someone else signed in moves it", async () => {
    const { id, publicId } = await seedReport({ state: "looking" });
    await move(publicId, { from: "looking", to: "done" }, mariaCookie);
    expect((await events(id))[0]!.personId).toBe(mariaId);
  });

  it("answers a browser form post with 303 back to the report", async () => {
    const { id, publicId } = await seedReport({ state: "new" });
    const res = await moveForm(publicId, { from: "new", to: "nothing_needed" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team#r-${publicId}`);
    expect((await report(id)).state).toBe("nothing_needed");
    expect(await events(id)).toHaveLength(1);
  });

  it("can reopen a closed report", async () => {
    const { id, publicId } = await seedReport({ state: "done" });
    const res = await move(publicId, { from: "done", to: "looking" });
    expect(res.status).toBe(200);
    expect((await report(id)).state).toBe("looking");
  });
});

describe("P2-2: two people move the same report at once", () => {
  it("one wins, the other is told someone else changed it, and there is one event", async () => {
    for (let i = 0; i < 5; i++) {
      const { id, publicId } = await seedReport({ state: "new" });
      const [a, b] = await Promise.all([
        move(publicId, { from: "new", to: "looking" }, susanCookie),
        move(publicId, { from: "new", to: "done" }, mariaCookie),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      expect(loser.body.error).toBe("changed_by_someone_else");
      expect(loser.body.message).toBe(
        "Someone else changed this report a moment ago. Here's where it is now.",
      );
      const winner = a.status === 200 ? a : b;
      // The loser is shown where the report is now: the winner's state.
      expect(loser.body.report.state).toBe(winner.body.state);
      expect(await events(id)).toHaveLength(1);
    }
  });

  it("a stale page writes nothing, and a browser is sent back with the notice flag", async () => {
    const { id, publicId } = await seedReport({ state: "new" });
    await move(publicId, { from: "new", to: "looking" }, mariaCookie);
    const res = await moveForm(publicId, { from: "new", to: "done" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(
      `/api/team?changed=${publicId}#r-${publicId}`,
    );
    expect((await report(id)).state).toBe("looking");
    expect(await events(id)).toHaveLength(1);
  });
});

describe("P2-3: Origin", () => {
  it("refuses a missing, wrong or look-alike Origin with the identical 401, and writes nothing", async () => {
    const { id, publicId } = await seedReport({ state: "new" });
    const origins: (string | undefined)[] = [
      undefined,
      "https://evil.catspotters.com",
      "https://catspotters.com",
      "http://team.catspotters.com",
      "https://team.catspotters.com.evil.example",
      "null",
    ];
    for (const route of ["state", "note"]) {
      for (const origin of origins) {
        const t = request(app)
          .post(`/api/team/reports/${publicId}/${route}`)
          .set("Cookie", susanCookie);
        if (origin !== undefined) t.set("Origin", origin);
        const res = await t.send(
          route === "state" ? { from: "new", to: "looking" } : { note: "x" },
        );
        expect([res.status, res.text], `${route} with ${origin}`).toEqual([
          401,
          '{"error":"not_signed_in"}',
        ]);
      }
    }
    const row = await report(id);
    expect(row.state).toBe("new");
    expect(row.teamNote).toBeNull();
    expect(await events(id)).toHaveLength(0);
  });
});

describe("P2-4: moving a report sends nothing", () => {
  it("leaves mail_outbox exactly as it was for every state", async () => {
    const { publicId } = await seedReport({
      state: "new",
      mail: { state: "sent" },
    });
    const before = await db.select().from(mailOutboxTable);
    expect(before).toHaveLength(1);
    let from = "new";
    for (const to of ["looking", "done", "nothing_needed", "new", "done"]) {
      const res = await move(publicId, { from, to });
      expect(res.status).toBe(200);
      from = to;
      expect(await db.select().from(mailOutboxTable)).toEqual(before);
    }
  });

  it("queues no mail for a report that had no alert either", async () => {
    const { publicId } = await seedReport({ state: "new" });
    await move(publicId, { from: "new", to: "done" });
    expect(await db.select().from(mailOutboxTable)).toHaveLength(0);
  });
});

describe("P2-5: drafts, and states outside the four", () => {
  it("a draft can't be moved: nothing written", async () => {
    const { id, publicId } = await seedReport({ isDraft: true, state: "new" });
    const res = await move(publicId, { from: "new", to: "looking" });
    expect(res.status).toBe(404);
    expect((await report(id)).state).toBe("new");
    expect((await report(id)).stateChangedBy).toBeNull();
    expect(await events(id)).toHaveLength(0);
  });

  it("refuses a state outside the four, with field names only", async () => {
    const { id, publicId } = await seedReport({ state: "new" });
    for (const to of ["resolved", "", "DONE", "looking'; --"]) {
      const res = await move(publicId, { from: "new", to });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Invalid request", fields: ["to"] });
      expect(res.text).not.toContain("resolved");
    }
    const bad = await move(publicId, { from: "closed", to: "done" });
    expect(bad.body.fields).toEqual(["from"]);
    const none = await move(publicId, {});
    expect(none.body.fields.sort()).toEqual(["from", "to"]);
    expect((await report(id)).state).toBe("new");
    expect(await events(id)).toHaveLength(0);
  });

  it("refuses moving a report to the state it is already in", async () => {
    const { id, publicId } = await seedReport({ state: "looking" });
    const res = await move(publicId, { from: "looking", to: "looking" });
    expect(res.status).toBe(400);
    expect(await events(id)).toHaveLength(0);
  });

  it("answers 404 for an unknown report, and for an id that isn't an id", async () => {
    expect((await move("nope", { from: "new", to: "done" })).status).toBe(404);
    expect((await move("%00", { from: "new", to: "done" })).status).toBe(404);
  });

  it("a person without the capability gets the identical 401 and nothing is written", async () => {
    const { id, publicId } = await seedReport({ state: "new" });
    const res = await move(publicId, { from: "new", to: "done" }, veraCookie);
    expect([res.status, res.text]).toEqual([401, '{"error":"not_signed_in"}']);
    expect(await events(id)).toHaveLength(0);
  });
});
