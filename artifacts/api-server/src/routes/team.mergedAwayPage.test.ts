import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, like } from "drizzle-orm";
import { catsTable, db, deviceCredentialsTable, markLeft, observationsTable, pool } from "@workspace/db";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
vi.mock("../lib/push", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));

import app from "../app";
import { daysAgo, moveKit, tag } from "../test/moveKit";
import { guardianOn, newColony, signedPerson, type Signed } from "../test/roleKit";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { escapeHtml as esc } from "../lib/teamPages/escape";
import { teamCatView } from "../lib/teamCatView";

// SYC-59 PR 4.2 (which-cat-is-which.md §4.3): the merged-away cat's own team
// page. GET /api/team/cats/:id for Mimi must say "Mimi was merged into
// Agatha on 26 Oct by Maria" with links to Agatha and Undo, and must draw
// Mimi's own page (her name, her photos, her own notes), never Agatha's.
// Its forms would write on Agatha (every team correction acts on the cat a
// cat is part of now), so it draws none. Cat names are letters only (SYC-709).

const KEY = "vitest-mergedaway-key-0123456789abcdef-0123456789abcdef";
const kit = moveKit("VitestMergedAway");
let staff: Signed;
let staffLabel: string;
let guardian: Signed;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await kit.cleanup();
  staffLabel = `awayer${tag()}`;
  staff = await signedPerson(staffLabel, ["staff"]);
  guardian = await guardianOn(`awguard${tag()}`, [await newColony("aw")]);
});
afterAll(async () => {
  await kit.cleanup();
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${kit.devicePrefix}%`));
  await markLeft(staff.email, "cli:vitest");
  await markLeft(guardian.email, "cli:vitest");
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

const get = (url: string, cookie = staff.cookie) => request(app).get(url).set("Cookie", cookie);
const count = async (catId: number) => (await teamCatView(catId))!.sightings.length;
const merge = async (mergedId: number, survivorId: number, reasonText = "Same face markings and torn left ear") =>
  request(app)
    .post("/api/team/cats/merge")
    .set("Origin", TEAM_ORIGIN)
    .set("Cookie", staff.cookie)
    .send({ survivorId, mergedId, expectedSightingCounts: [await count(survivorId), await count(mergedId)], reasonText, survivorChosen: "default" });
const undo = (mergeId: number) =>
  request(app).post(`/api/team/cats/merge/${mergeId}/undo`).set("Origin", TEAM_ORIGIN).set("Cookie", staff.cookie).send({ reasonText: "Two cats after all" });
const nameOf = async (id: number) => (await db.select().from(catsTable).where(eq(catsTable.id, id)))[0]!.name;

async function pair() {
  const agatha = await kit.cat(daysAgo(60));
  const mimi = await kit.cat(daysAgo(40));
  const a0 = await kit.sighting(agatha, kit.device(), daysAgo(30));
  const m1 = await kit.sighting(mimi, kit.device(), daysAgo(20));
  const m2 = await kit.sighting(mimi, kit.device(), daysAgo(4));
  return { agatha, mimi, a0, m1, m2 };
}

describe("Mimi's own page once she is part of Agatha", () => {
  it("says who merged her, when and why, and links to Agatha and to Undo", async () => {
    const c = await pair();
    const m = await merge(c.mimi, c.agatha);
    expect(m.status).toBe(200);
    const [mimi, agatha] = [await nameOf(c.mimi), await nameOf(c.agatha)];
    const page = await get(`/api/team/cats/${c.mimi}`);
    expect(page.status).toBe(200);
    expect(page.text).toMatch(new RegExp(`${esc(mimi)} was merged into <a href="/api/team/cats/${c.agatha}">${esc(agatha)}</a> on \\d{1,2} \\w{3} by Vt ${staffLabel}\\.`));
    expect(page.text).toContain("Why: Same face markings and torn left ear.");
    expect(page.text).toContain(`<a class="tap" href="/api/team/cats/${c.agatha}">Open ${esc(agatha)}</a>`);
    expect(page.text).toContain(`<a class="tap" href="/api/team/cats/merge/${m.body.mergeId}/undo">Undo this merge</a>`);
    expect(page.text).toContain(`Everything recorded about this cat now counts for ${esc(agatha)}.`);
  });

  it("is Mimi's page, not Agatha's: her name in the heading, none of the sightings, her own note", async () => {
    const c = await pair();
    await db.insert(observationsTable).values({ catId: c.mimi, kind: "team_note", value: { text: "Shy at the bowl" }, accountId: staff.id, roleAtTime: "staff", observedAt: daysAgo(2) });
    await merge(c.mimi, c.agatha);
    const [mimi, agatha] = [await nameOf(c.mimi), await nameOf(c.agatha)];
    const page = await get(`/api/team/cats/${c.mimi}`);
    expect(page.text).toContain(`<title>${esc(mimi)}`);
    expect(page.text).toContain(`<h1>${esc(mimi)}</h1>`);
    expect(page.text).not.toContain(`<h1>${esc(agatha)}</h1>`);
    expect(page.text).toContain(`SYR-${String(c.mimi).padStart(4, "0")} · on our records since`);
    // Her sightings are Agatha's now: not in her History; Agatha's own sighting neither.
    for (const s of [c.m1, c.m2, c.a0]) expect(page.text).not.toContain(`id="sg-${s.id}"`);
    expect(page.text).toContain("Shy at the bowl");
    // And the merge is in her History, as Merged into Agatha.
    expect(page.text).toContain(`Merged into <a href="/api/team/cats/${c.agatha}">${esc(agatha)}</a>`);
    // The JSON view of the same address is Mimi's too.
    const json = await get(`/api/team/cats/${c.mimi}`).set("Accept", "application/json");
    expect(json.body.cat).toMatchObject({ id: c.mimi, name: mimi });
    expect(json.body.sightings).toEqual([]);
  });

  it("draws no form that writes: they would act on Agatha", async () => {
    const c = await pair();
    await merge(c.mimi, c.agatha);
    const page = await get(`/api/team/cats/${c.mimi}`);
    for (const absent of [
      `/api/team/cats/${c.mimi}/life-status`,
      `/api/team/cats/${c.mimi}/sterilisation`,
      `/api/team/cats/${c.mimi}/name`,
      `/api/team/cats/${c.mimi}/note`,
      `/api/team/cats/${c.mimi}/vet-visit`,
      "Update this cat",
      "Log a vet visit",
      "Same cat as…",
      "Rename the cat",
      "/api/team/photos/",
    ]) {
      if (absent === "/api/team/photos/") {
        expect(page.text).not.toMatch(/action="\/api\/team\/photos\/[^"]*\/(hide|restore)"/);
      } else expect(page.text).not.toContain(absent);
    }
    // Only Undo merge is drawn.
    expect(page.text).toContain("Undo this merge");
  });

  it("a cat guardian can't open it", async () => {
    const c = await pair();
    await merge(c.mimi, c.agatha);
    expect((await get(`/api/team/cats/${c.mimi}`, guardian.cookie)).status).toBe(403);
  });

  it("Agatha's page is still Agatha's, with the sightings and the forms", async () => {
    const c = await pair();
    await merge(c.mimi, c.agatha);
    const agatha = await nameOf(c.agatha);
    const page = await get(`/api/team/cats/${c.agatha}`);
    expect(page.text).toContain(`<h1>${esc(agatha)}</h1>`);
    expect(page.text).not.toContain("was merged into");
    for (const s of [c.m1, c.m2, c.a0]) expect(page.text).toContain(`id="sg-${s.id}"`);
    expect(page.text).toContain("Update this cat");
    expect(page.text).toContain("Same cat as…");
  });

  it("after the undo it is an ordinary page again, with her sightings and her forms", async () => {
    const c = await pair();
    const m = await merge(c.mimi, c.agatha);
    await undo(m.body.mergeId);
    const mimi = await nameOf(c.mimi);
    const page = await get(`/api/team/cats/${c.mimi}`);
    expect(page.text).not.toContain("was merged into");
    expect(page.text).toContain(`<h1>${esc(mimi)}</h1>`);
    for (const s of [c.m1, c.m2]) expect(page.text).toContain(`id="sg-${s.id}"`);
    expect(page.text).toContain("Update this cat");
  });

  it("in a chain it says which cat she is part of now: Mimi into Agatha, Agatha into Dora", async () => {
    const c = await pair();
    const dora = await kit.cat(daysAgo(80));
    await kit.sighting(dora, kit.device(), daysAgo(70));
    await merge(c.mimi, c.agatha);
    await merge(c.agatha, dora);
    const [agatha, doraName] = [await nameOf(c.agatha), await nameOf(dora)];
    const page = await get(`/api/team/cats/${c.mimi}`);
    expect(page.text).toContain(`was merged into <a href="/api/team/cats/${c.agatha}">${esc(agatha)}</a>`);
    expect(page.text).toContain(`${esc(agatha)} is part of <a href="/api/team/cats/${dora}">${esc(doraName)}</a> now.`);
    expect(page.text).toContain(`<a class="tap" href="/api/team/cats/${dora}">Open ${esc(doraName)}</a>`);
    expect(page.text).toContain(`Everything recorded about this cat now counts for ${esc(doraName)}.`);
  });

  it("the merger's name and the reason are escaped", async () => {
    const c = await pair();
    await merge(c.mimi, c.agatha, `<img src=x onerror=alert(1)>`);
    const page = await get(`/api/team/cats/${c.mimi}`);
    expect(page.text).not.toContain("<img src=x onerror=alert(1)>");
    expect(page.text).toContain("Why: &lt;img src=x onerror=alert(1)&gt;.");
  });
});
