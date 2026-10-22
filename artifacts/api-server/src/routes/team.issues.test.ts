import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { asc, eq, sql } from "drizzle-orm";
import {
  db,
  markLeft,
  photosTable,
  photoVisibilityEventsTable,
  pool,
  reportStateEventsTable,
  welfareReportsTable,
} from "@workspace/db";
import app from "../app";
import { clearWelfareTables, seedReport, TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { guardianOn, newColony, seedCat, signedPerson, type SeededCat, type Signed } from "../test/roleKit";
import { removeTestPerson } from "../test/removeTestPerson";
import { ISSUE_GROUP_LIMIT, issueStripFor, type IssuesSection } from "../lib/issues/queue";
import { _setIssueClockForTests, REPORT_HIDES_PER_ATHENS_DAY, reportHidesToday } from "../lib/issues/hide";
import { keepHidden } from "../lib/issues/teamActions";

// SYC-44 PR 7.1 (plan Slice 7; spec §5.3, §5.4): the team's Issues section,
// the cat page's strip and the Issues row's actions. T7-1 to T7-6. The route
// walk (team.walk.test.ts) holds the rest of T7-1: every new route is in its
// table, team-only, and no route resumes the brake (T7-5).
//
// The mutation probes for these tests are in the PR description.

const RUN = randomBytes(3).toString("hex");
const KEY = "vitest-issues-key-0123456789abcdef-01234567";
// Report-author hides seeded here are dated long ago, so they never count
// toward today's brake for this file or any other (T7-5 pins its own day).
const LONG_AGO = new Date("2020-01-15T10:00:00Z");

let team: Signed;
let guardian: Signed;
let colony: number;
let cat: SeededCat;
let n = 0;

/** A catalogue photo of `cat`, as a sighting would add (a plain photos row). */
async function newPhoto(): Promise<{ id: number; publicId: string }> {
  const k = ++n;
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `vt-iss-${RUN}-${k}`, data: Buffer.from(`fake jpeg ${k}`).toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id, publicId: photosTable.publicId });
  return p!;
}

/** A report-author hide, as POST /api/issues writes it (dated long ago, see LONG_AGO). */
async function hideByReport(photoId: number, reportId: number, at = LONG_AGO) {
  await db.insert(photoVisibilityEventsTable).values({
    photoId,
    action: "hide",
    author: `report:${reportId}`,
    personId: null,
    reason: "photo_private",
    at,
  });
}

/** A hidden-by-report issue about a fresh photo of `cat`. */
async function hiddenIssue(o: { publicId: string; sentMinutesAgo?: number; reason?: string }) {
  const photo = await newPhoto();
  const r = await seedReport({
    publicId: o.publicId,
    kind: "content",
    reason: o.reason ?? "photo_private",
    photoId: photo.id,
    catId: cat.id,
    hiddenByReport: true,
    sentMinutesAgo: o.sentMinutesAgo ?? 5,
  });
  await hideByReport(photo.id, r.id);
  return { ...r, photo };
}

const get = (path: string, cookie = team.cookie) => request(app).get(path).set("Cookie", cookie);
const form = (path: string, body: Record<string, string> = {}) =>
  request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", team.cookie).type("form").send(body);
const jsonPost = (path: string, body: Record<string, string> = {}) =>
  request(app).post(path).set("Origin", TEAM_ORIGIN).set("Cookie", team.cookie).send(body);

const reportRow = async (publicId: string) =>
  (await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.publicId, publicId)))[0]!;
/** A photo's visibility events, oldest first (newest = highest id, as the code reads them). */
const eventsFor = (photoId: number) =>
  db
    .select()
    .from(photoVisibilityEventsTable)
    .where(eq(photoVisibilityEventsTable.photoId, photoId))
    .orderBy(asc(photoVisibilityEventsTable.id));
const stateEvents = async (reportId: number) =>
  db.select().from(reportStateEventsTable).where(eq(reportStateEventsTable.reportId, reportId));

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  colony = await newColony("issues");
  cat = await seedCat(colony);
  team = await signedPerson(`issues-team-${RUN}`, ["staff"]);
  // T7-1: a cat guardian whose colony holds the reported cat.
  guardian = await guardianOn(`issues-g-${RUN}`, [colony]);
});

beforeEach(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await clearWelfareTables();
});

afterEach(() => _setIssueClockForTests(null));

afterAll(async () => {
  await clearWelfareTables();
  // The team member now has history (moves, hides), so is marked left, never deleted.
  await markLeft(team.email, "cli:vitest");
  await removeTestPerson(guardian.email);
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

describe("T7-1 (spec test 17): only view_welfare_queue sees an issue, anywhere", () => {
  it("a team member gets the section, its JSON, the reported photo and the cat page's strip", async () => {
    const r = await hiddenIssue({ publicId: `vt-iss-${RUN}-t71` });
    const page = await get("/api/team");
    expect(page.status).toBe(200);
    expect(page.text).toContain('<section id="issues"');
    expect(page.text).toContain(`id="r-${r.publicId}"`);
    const json = await get("/api/team/issues");
    expect(json.status).toBe(200);
    expect((json.body as IssuesSection).hidden.map((i) => i.id)).toEqual([r.publicId]);
    const photo = await get(`/api/team/issue-photos/${r.publicId}`);
    expect(photo.status).toBe(200);
    expect(photo.headers["content-type"]).toBe("image/jpeg");
    expect(photo.headers["cache-control"]).toBe("no-store");
    const catPage = await get(`/api/team/cats/${cat.id}`);
    expect(catPage.status).toBe(200);
    expect(catPage.text).toContain("Reports about this cat (1)");
    expect(catPage.text).toContain(`href="/api/team?issue=open&amp;r=${r.publicId}#r-${r.publicId}"`);
  });

  it("a cat guardian with that cat in her colony is refused the section, its JSON, the reported photo and the alert's link", async () => {
    // The reported photo is the cat's own main photo, which she may see in the catalogue.
    const r = await seedReport({
      publicId: `vt-iss-${RUN}-g`,
      kind: "content",
      reason: "photo_private",
      photoId: cat.photoId,
      catId: cat.id,
    });
    expect((await get(`/api/team/photos/${cat.photoPublicId}`, guardian.cookie)).status).toBe(200);
    for (const path of [
      "/api/team",
      "/api/team/issues",
      `/api/team/issue-photos/${r.publicId}`,
      // The "Photo hidden" alert links to the team cat page (alertEmail.ts).
      `/api/team/cats/${cat.id}`,
    ]) {
      const res = await get(path, guardian.cookie);
      expect([res.status, res.text], path).toEqual([403, '{"error":"forbidden"}']);
    }
  });

  it("the strip has its own check: a guardian on the cat's colony gets none, the team gets the list", async () => {
    const r = await seedReport({ publicId: `vt-iss-${RUN}-strip`, kind: "content", reason: "wrong_name", catId: cat.id });
    expect(await issueStripFor({ scopes: [{ role: "guardian", colonyId: colony }] }, cat.id)).toBeNull();
    const strip = await issueStripFor({ scopes: [{ role: "staff", colonyId: null }] }, cat.id);
    expect(strip?.map((i) => i.id)).toEqual([r.publicId]);
  });

  it("the reported-photo route serves only a sent issue report's photo", async () => {
    const welfare = await seedReport({ publicId: `vt-iss-${RUN}-w`, photo: { mime: "image/jpeg", bytes: Buffer.from("x") } });
    const draft = await seedReport({ publicId: `vt-iss-${RUN}-d`, kind: "content", reason: "photo_private", photoId: cat.photoId, isDraft: true });
    const noPhoto = await seedReport({ publicId: `vt-iss-${RUN}-np`, kind: "content", reason: "wrong_name", catId: cat.id });
    for (const id of [welfare.publicId, draft.publicId, noPhoto.publicId, "no-such-report", "bad%00id"]) {
      expect((await get(`/api/team/issue-photos/${id}`)).status, id).toBe(404);
    }
  });

  it("a photo deleted for good is the 410, said plainly", async () => {
    const photo = await newPhoto();
    const r = await seedReport({ publicId: `vt-iss-${RUN}-rm`, kind: "content", reason: "photo_private", photoId: photo.id, catId: cat.id });
    await pool.query(
      "update photos set data = null, removed_at = now(), removed_by = $1, removed_reason = 'vitest' where id = $2",
      [team.id, photo.id],
    );
    const res = await get(`/api/team/issue-photos/${r.publicId}`);
    expect([res.status, res.text]).toEqual([410, "Removed for good."]);
  });
});

describe("T7-2: the four groups, in order, and never above a welfare report", () => {
  it("hidden (longest wait first), location and died, everything else (newest first), unchecked; all below the welfare reports", async () => {
    await seedReport({ publicId: `vt-iss-${RUN}-w-open`, sentMinutesAgo: 1 });
    await seedReport({ publicId: `vt-iss-${RUN}-w-closed`, state: "done", sentMinutesAgo: 2 });
    await seedReport({ publicId: `vt-iss-${RUN}-w-unchecked`, tokenChecked: false, sentMinutesAgo: 3 });
    const hNew = await hiddenIssue({ publicId: `vt-iss-${RUN}-h-new`, sentMinutesAgo: 10 });
    const hOld = await hiddenIssue({ publicId: `vt-iss-${RUN}-h-old`, sentMinutesAgo: 300 });
    const died = await seedReport({ publicId: `vt-iss-${RUN}-died`, kind: "content", reason: "cat_died", catId: cat.id, sentMinutesAgo: 20 });
    const where = await seedReport({ publicId: `vt-iss-${RUN}-where`, kind: "content", reason: "location_revealing", catId: cat.id, sentMinutesAgo: 400 });
    const oNew = await seedReport({ publicId: `vt-iss-${RUN}-o-new`, kind: "content", reason: "wrong_name", catId: cat.id, sentMinutesAgo: 30 });
    const oOld = await seedReport({ publicId: `vt-iss-${RUN}-o-old`, kind: "content", reason: "other", catId: cat.id, sentMinutesAgo: 500 });
    // A photo_private report whose photo was never hidden is "everything else".
    const notHidden = await seedReport({ publicId: `vt-iss-${RUN}-o-nh`, kind: "content", reason: "photo_private", photoId: (await newPhoto()).id, catId: cat.id, hideSkipped: "brake", sentMinutesAgo: 40 });
    const unchecked = await seedReport({ publicId: `vt-iss-${RUN}-u`, kind: "content", reason: "photo_private", photoId: (await newPhoto()).id, catId: cat.id, tokenChecked: false, hideSkipped: "unchecked", sentMinutesAgo: 1 });
    const closed = await seedReport({ publicId: `vt-iss-${RUN}-closed`, kind: "content", reason: "other", catId: cat.id, state: "done", sentMinutesAgo: 2 });

    const json = (await get("/api/team/issues")).body as IssuesSection;
    expect(json.hidden.map((i) => i.id)).toEqual([hOld.publicId, hNew.publicId]);
    expect(json.needsPerson.map((i) => i.id)).toEqual([died.publicId, where.publicId]);
    expect(json.other.map((i) => i.id)).toEqual([oNew.publicId, notHidden.publicId, oOld.publicId]);
    expect(json.unchecked.map((i) => i.id)).toEqual([unchecked.publicId]);
    expect(json.closed.map((i) => i.id)).toEqual([closed.publicId]);

    const html = (await get("/api/team")).text;
    const at = (id: string) => {
      const i = html.indexOf(`id="r-${id}"`);
      expect(i, id).toBeGreaterThan(-1);
      return i;
    };
    const order = [hOld, hNew, died, where, oNew, notHidden, oOld, unchecked, closed].map((r) => at(r.publicId));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Every welfare report, open, closed or unchecked, is above the section.
    const section = html.indexOf('<section id="issues"');
    for (const w of ["w-open", "w-closed", "w-unchecked"]) expect(at(`vt-iss-${RUN}-${w}`)).toBeLessThan(section);
    expect(section).toBeLessThan(at(hOld.publicId));
    // Every row says "Issue" in words, not only in colour.
    const issueRows = html.slice(section).match(/<article class="report issue/g) ?? [];
    expect(issueRows).toHaveLength(9);
    expect(html.slice(section).match(/<span class="tag issue">Issue<\/span>/g)).toHaveLength(9);
    // The waiting count at the top of the page.
    expect(html.indexOf("2 photos hidden by a report are waiting for you")).toBeLessThan(html.indexOf("Waiting for the team"));
    // No "Which cat is this?" on an issue row.
    expect(html.slice(section)).not.toContain("?tie=");
  });

  it("a report-hidden photo the team has since restored falls back to its reason's group", async () => {
    const r = await hiddenIssue({ publicId: `vt-iss-${RUN}-back` });
    await db.insert(photoVisibilityEventsTable).values({ photoId: r.photo.id, action: "restore", author: team.id, personId: team.id, at: new Date() });
    const json = (await get("/api/team/issues")).body as IssuesSection;
    expect(json.hidden).toEqual([]);
    expect(json.other.map((i) => i.id)).toEqual([r.publicId]);
  });
});

describe("T7-3: \"N others reported this\", by group", () => {
  it("counts other OPEN reports with the same photo and reason, or the same cat and reason for a report about the cat", async () => {
    const photo = await newPhoto();
    const other = await newPhoto();
    const p1 = await seedReport({ kind: "content", reason: "photo_private", photoId: photo.id, catId: cat.id });
    await seedReport({ kind: "content", reason: "photo_private", photoId: photo.id, catId: cat.id, state: "looking" });
    await seedReport({ kind: "content", reason: "photo_private", photoId: photo.id, catId: cat.id, state: "done" }); // closed: not counted
    await seedReport({ kind: "content", reason: "photo_inappropriate", photoId: photo.id, catId: cat.id }); // another reason
    await seedReport({ kind: "content", reason: "photo_private", photoId: other.id, catId: cat.id }); // another photo
    await seedReport({ kind: "content", reason: "photo_private", photoId: photo.id, catId: cat.id, isDraft: true }); // a draft
    const c1 = await seedReport({ kind: "content", reason: "wrong_name", catId: cat.id });
    await seedReport({ kind: "content", reason: "wrong_name", catId: cat.id });
    await seedReport({ kind: "content", reason: "wrong_name", catId: cat.id });
    // About a photo of the same cat, not the cat: a different group.
    await seedReport({ kind: "content", reason: "wrong_cat", catId: cat.id, photoId: photo.id });
    const solo = await seedReport({ kind: "content", reason: "wrong_cat", catId: cat.id });

    const json = (await get("/api/team/issues")).body as IssuesSection;
    const all = [...json.hidden, ...json.needsPerson, ...json.other, ...json.unchecked, ...json.closed];
    const others = (id: string) => all.find((i) => i.id === id)!.others;
    expect(others(p1.publicId)).toBe(1);
    expect(others(c1.publicId)).toBe(2);
    expect(others(solo.publicId)).toBe(0);
    const html = (await get("/api/team")).text;
    expect(html).toContain("2 others reported this");
    expect(html).toContain("1 other reported this");
  });
});

describe("T7-4: Keep hidden and Restore", () => {
  it("Keep hidden writes NO visibility event and closes the report as Done", async () => {
    const r = await hiddenIssue({ publicId: `vt-iss-${RUN}-keep` });
    const before = await eventsFor(r.photo.id);
    const res = await form(`/api/team/issues/${r.publicId}/keep-hidden`, { from: "new" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team?issue=kept&r=${r.publicId}#r-${r.publicId}`);
    expect(await eventsFor(r.photo.id)).toEqual(before);
    expect((await reportRow(r.publicId)).state).toBe("done");
    expect((await reportRow(r.publicId)).stateChangedBy).toBe(team.id);
    expect(await stateEvents(r.id)).toHaveLength(1);
    const page = (await get(`/api/team?issue=kept&r=${r.publicId}`)).text;
    expect(page).toContain("Saved. The photo stays hidden, and this report is closed as Done.");
  });

  it("Keep hidden is refused once someone has restored the photo: nothing is closed, and it says so", async () => {
    const r = await hiddenIssue({ publicId: `vt-iss-${RUN}-keep2` });
    // A colleague restores it on the cat page meanwhile.
    const restored = await form(`/api/team/photos/${r.photo.publicId}/restore`);
    expect(restored.status).toBe(303);
    const before = await eventsFor(r.photo.id);
    const res = await form(`/api/team/issues/${r.publicId}/keep-hidden`, { from: "new" });
    expect(res.headers["location"]).toBe(`/api/team?issue=not_hidden&r=${r.publicId}#r-${r.publicId}`);
    expect((await reportRow(r.publicId)).state).toBe("new");
    expect(await stateEvents(r.id)).toHaveLength(0);
    expect(await eventsFor(r.photo.id)).toEqual(before);
    const json = await jsonPost(`/api/team/issues/${r.publicId}/keep-hidden`, { from: "new" });
    expect(json.status).toBe(409);
    expect(json.body.outcome).toBe("not_hidden");
    expect(json.body.message).toBe("Nothing changed: someone has already made this photo public again.");
  });

  it("Restore writes exactly one restore event, as the person, and closes as Nothing needed", async () => {
    const r = await hiddenIssue({ publicId: `vt-iss-${RUN}-restore` });
    const before = await eventsFor(r.photo.id);
    const res = await jsonPost(`/api/team/issues/${r.publicId}/restore`, { from: "new" });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("restored");
    const after = await eventsFor(r.photo.id);
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)).toMatchObject({ action: "restore", author: team.id, personId: team.id });
    expect((await reportRow(r.publicId)).state).toBe("nothing_needed");
    expect(await stateEvents(r.id)).toHaveLength(1);
    expect(res.body.report).toMatchObject({ id: r.publicId, state: "nothing_needed", photo: { hidden: false } });
    // And again on the closed report: refused before anything is read (finding 3).
    const again = await jsonPost(`/api/team/issues/${r.publicId}/restore`, { from: "nothing_needed" });
    expect(again.status).toBe(400);
    expect(await eventsFor(r.photo.id)).toHaveLength(before.length + 1);
  });

  it("Restore is refused on a photo deleted for good; Keep hidden still closes it", async () => {
    const r = await hiddenIssue({ publicId: `vt-iss-${RUN}-gone` });
    await pool.query(
      "update photos set data = null, removed_at = now(), removed_by = $1, removed_reason = 'vitest' where id = $2",
      [team.id, r.photo.id],
    );
    const restore = await jsonPost(`/api/team/issues/${r.publicId}/restore`, { from: "new" });
    expect([restore.status, restore.body.outcome]).toEqual([409, "removed"]);
    expect((await reportRow(r.publicId)).state).toBe("new");
    const keep = await jsonPost(`/api/team/issues/${r.publicId}/keep-hidden`, { from: "new" });
    expect([keep.status, keep.body.outcome]).toEqual([200, "kept"]);
  });

  it("a stale page (someone moved the report first) closes nothing and writes nothing", async () => {
    const r = await hiddenIssue({ publicId: `vt-iss-${RUN}-stale` });
    await form(`/api/team/reports/${r.publicId}/state`, { from: "new", to: "looking" });
    const before = await eventsFor(r.photo.id);
    const res = await jsonPost(`/api/team/issues/${r.publicId}/restore`, { from: "new" });
    expect([res.status, res.body.outcome]).toEqual([409, "changed"]);
    expect(await eventsFor(r.photo.id)).toEqual(before);
    expect((await reportRow(r.publicId)).state).toBe("looking");
  });

  it("Hide this photo: one hide event as the person; the report stays open; a second tap writes nothing", async () => {
    const photo = await newPhoto();
    const r = await seedReport({ publicId: `vt-iss-${RUN}-hide`, kind: "content", reason: "photo_not_cat", photoId: photo.id, catId: cat.id });
    const res = await form(`/api/team/issues/${r.publicId}/hide`);
    expect(res.headers["location"]).toBe(`/api/team?issue=hidden&r=${r.publicId}#r-${r.publicId}`);
    const events = await eventsFor(photo.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "hide", author: team.id, personId: team.id, reason: "Issue report: That's not a cat" });
    expect((await reportRow(r.publicId)).state).toBe("new");
    const again = await jsonPost(`/api/team/issues/${r.publicId}/hide`);
    expect([again.status, again.body.outcome]).toEqual([409, "already_hidden"]);
    expect(await eventsFor(photo.id)).toHaveLength(1);
  });

  it("the page offers Keep hidden and Restore on a hidden photo, Hide on a public one, nothing on a report with no photo", async () => {
    const hidden = await hiddenIssue({ publicId: `vt-iss-${RUN}-b1` });
    const pub = await seedReport({ publicId: `vt-iss-${RUN}-b2`, kind: "content", reason: "wrong_cat", photoId: (await newPhoto()).id, catId: cat.id });
    const none = await seedReport({ publicId: `vt-iss-${RUN}-b3`, kind: "content", reason: "wrong_name", catId: cat.id });
    const html = (await get("/api/team")).text;
    const card = (id: string) => html.slice(html.indexOf(`id="r-${id}"`), html.indexOf("</article>", html.indexOf(`id="r-${id}"`)));
    expect(card(hidden.publicId)).toContain(`action="/api/team/issues/${hidden.publicId}/keep-hidden"`);
    expect(card(hidden.publicId)).toContain(`action="/api/team/issues/${hidden.publicId}/restore"`);
    expect(card(hidden.publicId)).not.toContain("/hide\"");
    expect(card(pub.publicId)).toContain(`action="/api/team/issues/${pub.publicId}/hide"`);
    expect(card(pub.publicId)).not.toContain("keep-hidden");
    expect(card(none.publicId)).not.toContain("/api/team/issues/");
    expect(card(none.publicId)).toContain(`href="/api/team/cats/${cat.id}#corrections">Rename the cat</a>`);
  });

  it("the capability is checked inside the action too", async () => {
    const r = await hiddenIssue({ publicId: `vt-iss-${RUN}-cap` });
    const outcome = await keepHidden(
      { id: guardian.id, scopes: [{ role: "guardian", colonyId: colony }] },
      { publicId: r.publicId, from: "new" },
    );
    expect(outcome).toBe("not_authorised");
    expect((await reportRow(r.publicId)).state).toBe("new");
  });
});

describe("T7-5 (spec test 5): the brake banner", () => {
  // A day of its own, so no other test's hides count (and none of these count elsewhere).
  const DAY = Date.parse("2030-03-12T09:00:00Z");

  it("shows once today's report-hides reach the limit, not before; it offers nothing to press", async () => {
    _setIssueClockForTests(DAY);
    const photo = await newPhoto();
    for (let k = 1; k < REPORT_HIDES_PER_ATHENS_DAY; k++) await hideByReport(photo.id, 900_000 + k, new Date(DAY - k * 60_000));
    const quiet = (await get("/api/team")).text;
    expect(quiet).not.toContain("Automatic hiding is paused");
    expect(((await get("/api/team/issues")).body as IssuesSection).brake).toEqual({ on: false, hidesToday: 4, limit: 5 });

    await hideByReport(photo.id, 900_000, new Date(DAY - 30_000));
    const page = (await get("/api/team")).text;
    expect(page).toContain("<strong>Automatic hiding is paused until midnight, Athens time.</strong>");
    expect(page).toContain("Reports hid 5 photos today");
    expect(((await get("/api/team/issues")).body as IssuesSection).brake).toEqual({ on: true, hidesToday: 5, limit: 5 });
    const banner = page.slice(page.indexOf('<div class="banner brake" role="status"><strong>Automatic hiding'));
    expect(banner.slice(0, banner.indexOf("</div>"))).not.toMatch(/<form|<button|<a /);
    expect(page.toLowerCase()).not.toContain("resume");
    // Never mistaken for the page's mail-failure banner, which other tests look for.
    expect(page).not.toContain('class="banner"');
  });
});

describe("T7-6 (spec test 11): no device, address or contact in the section, its JSON or the strip", () => {
  it("carries none of them", async () => {
    const device = `device-SECRET-${RUN}`;
    const r = await hiddenIssue({ publicId: `vt-iss-${RUN}-priv` });
    await pool.query("update welfare_reports set reporter_device = $1, reporter_language = 'el' where id = $2", [device, r.id]);
    const json = await get("/api/team/issues");
    const html = await get("/api/team");
    const catPage = await get(`/api/team/cats/${cat.id}`);
    for (const text of [json.text, html.text, catPage.text]) {
      expect(text).not.toContain(device);
      expect(text).not.toMatch(/reporterDevice|reporter_device|reporterContact|reporter_contact|reporterLanguage|"ip"/);
    }
    const row = (json.body as IssuesSection).hidden[0]!;
    expect(Object.keys(row).sort()).toEqual(
      [
        "at", "cat", "group", "hiddenByReport", "hideSkipped", "id", "note", "others", "photo", "reason",
        "state", "stateChangedAt", "stateChangedBy", "teamNote", "teamNoteAt", "teamNoteBy", "unchecked",
      ].sort(),
    );
    expect(html.text).toContain("A member of the public");
  });

  it("escapes what the reporter wrote", async () => {
    await seedReport({ publicId: `vt-iss-${RUN}-esc`, kind: "content", reason: "other", catId: cat.id, note: '<img src=x onerror="alert(1)">' });
    const html = (await get("/api/team")).text;
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

describe("the issue row's actions keep the welfare rules", () => {
  it("an issue action never touches a welfare report", async () => {
    const w = await seedReport({ publicId: `vt-iss-${RUN}-welfare` });
    for (const path of ["keep-hidden", "restore", "hide"]) {
      const res = await jsonPost(`/api/team/issues/${w.publicId}/${path}`, { from: "new" });
      expect(res.status, path).toBe(404);
    }
    expect((await reportRow(w.publicId)).state).toBe("new");
    // ...and no observation is written for an issue closed by Keep hidden.
    const r = await hiddenIssue({ publicId: `vt-iss-${RUN}-noobs` });
    await jsonPost(`/api/team/issues/${r.publicId}/keep-hidden`, { from: "new" });
    const obs = await db.execute(sql`select 1 from observations where value->>'reportId' = ${String(r.id)}`);
    expect(obs.rows).toHaveLength(0);
  });
});

describe("review of 7.1: the critic's findings, pinned", () => {
  const card = (html: string, id: string) => {
    const start = html.indexOf(`id="r-${id}"`);
    expect(start, id).toBeGreaterThan(-1);
    return html.slice(start, html.indexOf("</article>", start));
  };

  it("finding 2: a row whose photo is still hidden offers no plain Done or Nothing needed", async () => {
    const hidden = await hiddenIssue({ publicId: `vt-iss-${RUN}-f2h` });
    const pub = await seedReport({ publicId: `vt-iss-${RUN}-f2p`, kind: "content", reason: "wrong_cat", photoId: (await newPhoto()).id, catId: cat.id });
    const html = (await get("/api/team")).text;
    const h = card(html, hidden.publicId);
    expect(h).not.toContain('name="to" value="done"');
    expect(h).not.toContain('name="to" value="nothing_needed"');
    expect(h).toContain('name="to" value="looking"');
    expect(h).toContain("To close it, keep the photo hidden or restore it, above.");
    expect(card(html, pub.publicId)).toContain('name="to" value="nothing_needed"');
  });

  it("finding 3: Keep hidden and Restore refuse a missing or closed `from`, and write nothing", async () => {
    const r = await hiddenIssue({ publicId: `vt-iss-${RUN}-f3` });
    const before = await eventsFor(r.photo.id);
    for (const [path, body] of [
      ["keep-hidden", {}],
      ["keep-hidden", { from: "done" }],
      ["restore", { from: "done" }],
      ["restore", { from: "nothing_needed" }],
      ["restore", { from: "bogus" }],
    ] as const) {
      const res = await jsonPost(`/api/team/issues/${r.publicId}/${path}`, body);
      expect(res.status, `${path} ${JSON.stringify(body)}`).toBe(400);
    }
    expect(await eventsFor(r.photo.id)).toEqual(before);
    expect(await stateEvents(r.id)).toHaveLength(0);
  });

  it("finding 4: an open unchecked report counts among the others (every open report does, §5.3)", async () => {
    const photo = await newPhoto();
    const checked = await seedReport({ kind: "content", reason: "photo_private", photoId: photo.id, catId: cat.id });
    await seedReport({ kind: "content", reason: "photo_private", photoId: photo.id, catId: cat.id, tokenChecked: false });
    const json = (await get("/api/team/issues")).body as IssuesSection;
    expect(json.other.find((i) => i.id === checked.publicId)!.others).toBe(1);
  });

  it("finding 5: each group draws at most ISSUE_GROUP_LIMIT rows, and says how many there are", async () => {
    await pool.query(
      `insert into welfare_reports (public_id, kind, reason, cat_id, severity, reporter_device, client_ref, photo_state, submitted_at)
       select 'vt-iss-${RUN}-many-' || g, 'content', 'other', $1, 'attention', 'dev-many-' || g, 'ref-many-' || g, 'none', now() - make_interval(mins => g)
         from generate_series(1, $2::int) g`,
      [cat.id, ISSUE_GROUP_LIMIT + 1],
    );
    const json = (await get("/api/team/issues")).body as IssuesSection;
    expect(json.other).toHaveLength(ISSUE_GROUP_LIMIT);
    expect(json.totals.other).toBe(ISSUE_GROUP_LIMIT + 1);
    const html = (await get("/api/team")).text;
    expect(html).toContain(`Everything else (${ISSUE_GROUP_LIMIT + 1})</h3>`);
    expect(html).toContain(`Showing ${ISSUE_GROUP_LIMIT} of ${ISSUE_GROUP_LIMIT + 1}.`);
    expect(html).toContain(`<h2>Issues (${ISSUE_GROUP_LIMIT + 1})</h2>`);
  });

  it("finding 6: the strip's link opens a folded, closed card", async () => {
    const r = await seedReport({ publicId: `vt-iss-${RUN}-f6`, kind: "content", reason: "other", catId: cat.id, state: "done" });
    const shut = card((await get("/api/team")).text, r.publicId);
    expect(shut).toContain("<details>");
    const opened = card((await get(`/api/team?issue=open&r=${r.publicId}`)).text, r.publicId);
    expect(opened).toContain("<details open>");
    expect(opened).not.toContain('class="notice"');
  });

  it("finding 7: hide_skipped is said in words", async () => {
    const words: Record<string, string> = {
      already_hidden: "Already hidden when this was sent",
      restored_before: "Not hidden: the team restored this photo before, so a report can't hide it again",
      address_limit: "Not hidden: hide limit reached for the sender",
      brake: "Not hidden: daily brake (automatic hiding was paused for the day)",
      unchecked: "Not hidden: unchecked (the safety check couldn't reach Cloudflare)",
    };
    for (const k of Object.keys(words)) {
      await seedReport({ publicId: `vt-iss-${RUN}-skip-${k}`, kind: "content", reason: "photo_private", photoId: (await newPhoto()).id, catId: cat.id, hideSkipped: k });
    }
    const html = (await get("/api/team")).text;
    for (const [k, w] of Object.entries(words)) {
      expect(card(html, `vt-iss-${RUN}-skip-${k}`), k).toContain(w.replace(/'/g, "&#39;"));
    }
  });

  it("finding 7: no_photo, and Hide on a photo deleted for good, write nothing", async () => {
    const none = await seedReport({ publicId: `vt-iss-${RUN}-nophoto`, kind: "content", reason: "wrong_name", catId: cat.id });
    const res = await jsonPost(`/api/team/issues/${none.publicId}/hide`);
    expect([res.status, res.body.outcome]).toEqual([409, "no_photo"]);
    const photo = await newPhoto();
    const gone = await seedReport({ publicId: `vt-iss-${RUN}-gonehide`, kind: "content", reason: "photo_not_cat", photoId: photo.id, catId: cat.id });
    await pool.query(
      "update photos set data = null, removed_at = now(), removed_by = $1, removed_reason = 'vitest' where id = $2",
      [team.id, photo.id],
    );
    const hide = await jsonPost(`/api/team/issues/${gone.publicId}/hide`);
    expect([hide.status, hide.body.outcome]).toEqual([409, "already_hidden"]);
    expect(await eventsFor(photo.id)).toHaveLength(0);
  });

  it("finding 7: a team member's Hide never counts toward the brake", async () => {
    const DAY = Date.parse("2031-05-20T09:00:00Z");
    _setIssueClockForTests(DAY);
    const before = await reportHidesToday();
    const r = await seedReport({ publicId: `vt-iss-${RUN}-teamhide`, kind: "content", reason: "photo_not_cat", photoId: (await newPhoto()).id, catId: cat.id });
    // The hide's own time is the database clock; count "today" at that real day too.
    _setIssueClockForTests(null);
    const realBefore = await reportHidesToday();
    expect((await jsonPost(`/api/team/issues/${r.publicId}/hide`)).body.outcome).toBe("hidden");
    expect(await reportHidesToday()).toBe(realBefore);
    _setIssueClockForTests(DAY);
    expect(await reportHidesToday()).toBe(before);
  });

  it("finding 7: two people pressing Keep hidden at once close it once", async () => {
    const r = await hiddenIssue({ publicId: `vt-iss-${RUN}-race` });
    const both = await Promise.all([
      jsonPost(`/api/team/issues/${r.publicId}/keep-hidden`, { from: "new" }),
      jsonPost(`/api/team/issues/${r.publicId}/keep-hidden`, { from: "new" }),
    ]);
    expect(both.map((b) => b.body.outcome).sort()).toEqual(["changed", "kept"]);
    expect(await stateEvents(r.id)).toHaveLength(1);
  });
});
