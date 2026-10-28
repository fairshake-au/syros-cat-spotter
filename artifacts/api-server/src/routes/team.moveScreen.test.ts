import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, like } from "drizzle-orm";
import {
  catsTable,
  db,
  markLeft,
  pointsLedgerTable,
  pool,
  sightingMovesTable,
  sightingsTable,
  welfareReportsTable,
} from "@workspace/db";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
vi.mock("../lib/push", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));

import app from "../app";
import { daysAgo, moveKit, tag } from "../test/moveKit";
import { guardianOn, hidePhoto, newColony, signedPerson, type Signed } from "../test/roleKit";
import { seedReport, TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { MOVE_WORDS } from "../lib/moveSightings";
import { recordTeamStatement } from "../lib/teamCorrections";
import { writeObservation } from "../lib/observations";
import { escapeHtml as esc } from "../lib/teamPages/escape";
import { NAME_HAS_LINK, NAME_TAKEN_WORDS, SYR_SHAPED_NAME } from "../lib/catNames";

// SYC-150 PR 3.3 (which-cat-is-which.md §5.1, §5.2, §5.4, §5.5): the move
// screen and the form behind it, through the real routes and real data. The
// move itself, its locks and its refusals are PR 3.2's
// (team.moveSighting.test.ts); here each refusal must reach the screen in
// words, and the History of both cats must show the move. Cat names are
// letters only (SYC-709).

const KEY = "vitest-movescreen-key-0123456789abcdef-0123456789abcdef";
const kit = moveKit("VitestMoveScreen");
let staff: Signed;
let guardian: Signed;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await kit.cleanup();
  staff = await signedPerson(`screen${tag()}`, ["staff"]);
  guardian = await guardianOn(`guards${tag()}`, [await newColony("screen")]);
});
afterAll(async () => {
  await db.delete(welfareReportsTable).where(like(welfareReportsTable.publicId, "vt-screen-%"));
  await kit.cleanup();
  await markLeft(staff.email, "cli:vitest");
  await markLeft(guardian.email, "cli:vitest");
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

const get = (url: string, cookie: string | null = staff.cookie) => {
  const r = request(app).get(url);
  return cookie ? r.set("Cookie", cookie) : r;
};
const post = (body: Record<string, string>, cookie: string | null = staff.cookie) => {
  const r = request(app).post("/api/team/sightings/move/form").set("Origin", TEAM_ORIGIN).type("form");
  return (cookie ? r.set("Cookie", cookie) : r).send(body);
};
const screen = (cat: number, ids: number[], extra = "") => `/api/team/sightings/move?cat=${cat}&s=${ids.join(",")}${extra}`;
const catRow = async (id: number) => (await db.select().from(catsTable).where(eq(catsTable.id, id)))[0]!;
const sightingRow = async (id: number) => (await db.select().from(sightingsTable).where(eq(sightingsTable.id, id)))[0]!;
const movesOf = (sightingId: number) => db.select().from(sightingMovesTable).where(eq(sightingMovesTable.sightingId, sightingId));
const staffPerson = () => ({ id: staff.id, scopes: [{ role: "staff", colonyId: null }] }) as never;

/** Mimi with two sightings (so a move leaves her something), and Agatha. */
async function twoCats() {
  const mimi = await kit.cat();
  const agatha = await kit.cat();
  const spotter = kit.device();
  const older = await kit.sighting(mimi, kit.device(), daysAgo(9));
  const s = await kit.sighting(mimi, spotter, daysAgo(3));
  return { mimi, agatha, spotter, older, s };
}

const move = (c: { mimi: number; agatha: number; s: { id: number } }, extra: Record<string, string> = {}) =>
  post({ cat: String(c.mimi), s: String(c.s.id), to: String(c.agatha), source: "cat_page", reason: "different_markings", ...extra });

describe("who may open the screen and move", () => {
  it("refuses anyone signed out, and a cat guardian: no screen, nothing moves", async () => {
    const c = await twoCats();
    expect((await get(screen(c.mimi, [c.s.id]), null)).status).toBe(401);
    expect((await get(screen(c.mimi, [c.s.id]), guardian.cookie)).status).toBe(403);
    expect((await post({ cat: String(c.mimi), s: String(c.s.id), to: String(c.agatha), reason: "wrong_pick" }, null)).status).toBe(401);
    expect((await move(c).set("Cookie", guardian.cookie)).status).toBe(403);
    expect((await sightingRow(c.s.id)).catId).toBe(c.mimi);
  });

  it("a form post from another site is refused before anything is read", async () => {
    const c = await twoCats();
    const res = await request(app)
      .post("/api/team/sightings/move/form")
      .set("Origin", "https://evil.example.com")
      .set("Cookie", staff.cookie)
      .type("form")
      .send({ cat: String(c.mimi), s: String(c.s.id), to: String(c.agatha), reason: "wrong_pick" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await sightingRow(c.s.id)).catId).toBe(c.mimi);
  });
});

describe("the screen: choosing the cat (§5.2)", () => {
  it("shows the photo, the cat it is under now, and the cats near the photo first, never the cat it is under", async () => {
    const c = await twoCats();
    const res = await get(screen(c.mimi, [c.s.id]));
    expect(res.status).toBe(200);
    const [m, a] = [await catRow(c.mimi), await catRow(c.agatha)];
    expect(res.text).toContain("Which cat is it?");
    expect(res.text).toContain("Cats near this photo");
    expect(res.text).toContain("Filed under now");
    expect(res.text).toContain(esc(m.name));
    // Agatha is in the list, with a link that carries only numbers.
    expect(res.text).toContain(`href="/api/team/sightings/move?cat=${c.mimi}&amp;s=${c.s.id}&amp;to=${c.agatha}"`);
    expect(res.text).toContain(esc(a.name));
    expect(res.text).not.toContain(`to=${c.mimi}"`);
    expect(res.text).toContain("It's a new cat");
    // Never a position in the page's addresses.
    expect(res.text).not.toMatch(/lat=|lng=|37\.44/);
  });

  it("the search finds a cat by name and by SYR number, and says when none matches", async () => {
    const c = await twoCats();
    const a = await catRow(c.agatha);
    const byName = await get(screen(c.mimi, [c.s.id], `&q=${encodeURIComponent(a.name)}`));
    expect(byName.text).toContain(`Cats matching “${esc(a.name)}”`);
    expect(byName.text).toContain(`to=${c.agatha}"`);
    const bySyr = await get(screen(c.mimi, [c.s.id], `&q=SYR-${String(c.agatha).padStart(4, "0")}`));
    expect(bySyr.text).toContain(`to=${c.agatha}"`);
    const none = await get(screen(c.mimi, [c.s.id], "&q=zzzzzzqqqq"));
    expect(none.text).toContain("No cat found for “zzzzzzqqqq”");
  });

  it("a cat that is the one it is under says so, and an unknown cat is not taken", async () => {
    const c = await twoCats();
    const same = await get(screen(c.mimi, [c.s.id], `&to=${c.mimi}`));
    expect(same.text).toContain(esc(MOVE_WORDS.sameCat));
    expect(same.text).toContain("Which cat is it?");
    const unknown = await get(screen(c.mimi, [c.s.id], "&to=999999999"));
    expect(unknown.text).toContain(esc(MOVE_WORDS.notFound));
  });
});

describe("the screen: the form (§5.2)", () => {
  it("lists what moves in the spec's words: the photo, the spotter's answers, what the old cat keeps, the points", async () => {
    const c = await twoCats();
    await kit.answer(c.s, "ear_tip", { clipped: true, side: "left" });
    await kit.answer(c.s, "food_and_water", { present: true });
    await kit.answer(c.s, "note", { text: "Limping" });
    await db.insert(pointsLedgerTable).values({
      deviceId: c.spotter,
      sightingId: c.s.id,
      catId: c.mimi,
      points: 15,
      athensDay: "2026-10-20",
      weekStart: "2026-10-19",
      source: "live",
    });
    const res = await get(screen(c.mimi, [c.s.id], `&to=${c.agatha}`));
    const [m, a] = [await catRow(c.mimi), await catRow(c.agatha)];
    expect(res.text).toContain(`Moves to <b>${esc(a.name)}</b>: this photo, &quot;ear tip clipped (left)&quot;, &quot;food and water were out&quot;, and the spotter&#39;s note.`);
    expect(res.text).toContain(`${esc(m.name)} keeps 1 sighting.`);
    expect(res.text).toContain("The spotter keeps their 15 points.");
    for (const w of ["Different markings", "Two cats in the photo", "Wrong cat picked", "Other…"]) expect(res.text).toContain(w);
    expect(res.text).toContain('action="/api/team/sightings/move/form"');
    // Only the warning that is true (the clipped ear); none of the others.
    expect(res.text.match(/class="warn"/g)).toHaveLength(1);
    expect(res.text).toContain("will go on the Likely list for a check.");
    for (const untrue of ["recorded as having died", "km from where", "is hidden and stays hidden"]) expect(res.text).not.toContain(untrue);
  });

  it("a second move (Move back) still lists the spotter's answers and still warns about the clipped ear", async () => {
    const c = await twoCats();
    await kit.sighting(c.agatha, kit.device(), daysAgo(15));
    await kit.answer(c.s, "ear_tip", { clipped: true, side: "left" });
    await kit.answer(c.s, "food_and_water", { present: true });
    await kit.answer(c.s, "note", { text: "Limping" });
    expect((await move(c)).status).toBe(303);
    const back = await get(screen(c.agatha, [c.s.id], `&to=${c.mimi}`));
    expect(back.text).toContain(`: this photo, &quot;ear tip clipped (left)&quot;, &quot;food and water were out&quot;, and the spotter&#39;s note.`);
    expect(back.text).toContain("will go on the Likely list for a check.");
  });

  it("an answer the spotter changed counts as what they said now, on a first move and on a second", async () => {
    const c = await twoCats();
    await kit.sighting(c.agatha, kit.device(), daysAgo(15));
    const first = await kit.answer(c.s, "ear_tip", { clipped: false });
    await writeObservation(db, {
      catId: c.mimi,
      kind: "ear_tip",
      value: { clipped: true, side: "right" },
      deviceId: c.s.deviceId,
      roleAtTime: "public",
      authorityScope: "none",
      provenance: "volunteered",
      sightingId: c.s.id,
      photoId: c.s.photoId,
      observedAt: c.s.createdAt,
      supersedesId: first.id,
    });
    const before = await get(screen(c.mimi, [c.s.id], `&to=${c.agatha}`));
    expect(before.text).toContain("&quot;ear tip clipped (right)&quot;");
    expect(before.text).toContain("will go on the Likely list");
    expect((await move(c)).status).toBe(303);
    const back = await get(screen(c.agatha, [c.s.id], `&to=${c.mimi}`));
    expect(back.text).toContain("&quot;ear tip clipped (right)&quot;");
    expect(back.text).not.toContain("not clipped");
  });

  it("warns when the chosen cat is recorded as having died and the photo is newer than that", async () => {
    const c = await twoCats();
    await recordTeamStatement(staffPerson(), { catId: c.agatha, kind: "life_status", value: { status: "deceased" }, reason: "Found", observedAt: daysAgo(30) });
    const res = await get(screen(c.mimi, [c.s.id], `&to=${c.agatha}`));
    const a = await catRow(c.agatha);
    expect(res.text).toContain(`${esc(a.name)} is recorded as having died. Moving this photo says she was seen alive on`);
    expect(res.text).toContain("which will change her record back to alive.");
  });

  it("warns when a clipped ear will put the chosen cat on the Likely list, and not otherwise", async () => {
    const c = await twoCats();
    expect((await get(screen(c.mimi, [c.s.id], `&to=${c.agatha}`))).text).not.toContain("Likely list");
    await kit.answer(c.s, "ear_tip", { clipped: true, side: "right" });
    const res = await get(screen(c.mimi, [c.s.id], `&to=${c.agatha}`));
    expect(res.text).toContain(`${esc((await catRow(c.agatha)).name)} will go on the Likely list for a check.`);
  });

  it("warns when the photo was taken over a kilometre from where the chosen cat is usually seen", async () => {
    const c = await twoCats();
    await db.insert(sightingsTable).values({ catId: c.agatha, deviceId: kit.device(), photoId: await kit.photo(), lat: 37.52, lng: 24.99, status: "resolved", createdAt: daysAgo(20) });
    const res = await get(screen(c.mimi, [c.s.id], `&to=${c.agatha}`));
    expect(res.text).toMatch(/This photo was taken \d+\.\d km from where .* is usually seen\./);
  });

  it("warns when the photo is hidden, and says it stays hidden", async () => {
    const c = await twoCats();
    await hidePhoto(c.s.photoId!);
    const res = await get(screen(c.mimi, [c.s.id], `&to=${c.agatha}`));
    expect(res.text).toContain("This photo is hidden and stays hidden after the move. If the only reason was the wrong cat, show it again from the photo&#39;s own menu.");
  });

  it("asks for the next main photo only when the moving photo is the old cat's main photo", async () => {
    const c = await twoCats();
    expect((await get(screen(c.mimi, [c.s.id], `&to=${c.agatha}`))).text).not.toContain('name="mainPhoto"');
    await db.update(catsTable).set({ primaryPhotoId: c.s.photoId! }).where(eq(catsTable.id, c.mimi));
    const res = await get(screen(c.mimi, [c.s.id], `&to=${c.agatha}`));
    expect(res.text).toContain("main photo is moving. Choose the next one.");
    expect(res.text).toContain(`name="mainPhoto" value="${c.older.photoId}"`);
    expect(res.text).not.toContain(`name="mainPhoto" value="${c.s.photoId}"`);
    expect(res.text).toContain('name="mainPhoto" value="0"');
  });

  it("“It's a new cat” asks for a name or the tick", async () => {
    const c = await twoCats();
    const res = await get(screen(c.mimi, [c.s.id], "&new=1"));
    expect(res.text).toContain('name="letSpottersName"');
    expect(res.text).toContain("Moves to <b>a new cat</b>");
    expect(res.text).toContain('<input type="hidden" name="new" value="1">');
  });

  it("several ticked sightings come from the History bar (mode=new, tick=…)", async () => {
    const c = await twoCats();
    const res = await get(`/api/team/sightings/move?cat=${c.mimi}&tick=${c.older.id}&tick=${c.s.id}&mode=new`);
    expect(res.text).toContain("Moving these 2 sightings");
    expect(res.text).toContain('<input type="hidden" name="s" value="' + [c.older.id, c.s.id].sort((x, y) => x - y).join(",") + '">');
    expect(res.text).toContain('name="letSpottersName"');
  });

  it("nothing ticked is a plain page, and a sighting that has moved is told where it is", async () => {
    const c = await twoCats();
    const none = await get(`/api/team/sightings/move?cat=${c.mimi}&mode=different`);
    expect(none.status).toBe(400);
    expect(none.text).toContain("Tick at least one sighting to move.");
    expect((await move(c)).status).toBe(303);
    const stale = await get(screen(c.mimi, [c.s.id], `&to=${c.agatha}`));
    expect(stale.status).toBe(409);
    expect(stale.text).toContain(`${MOVE_WORDS.changed} Nothing was moved.`);
    expect(stale.text).toContain(`href="/api/team/cats/${c.agatha}"`);
  });
});

describe("Move (§9.7 through the form)", () => {
  it("moves it and sends the team back to the old cat's History, which then shows the move on both cats", async () => {
    const c = await twoCats();
    await kit.answer(c.s, "ear_tip", { clipped: true, side: "left" });
    const res = await move(c, { reason: "other", reasonText: "Two cats at the bowl" });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/cats/${c.mimi}?done=moved#history`);
    expect((await sightingRow(c.s.id)).catId).toBe(c.agatha);
    const rows = await movesOf(c.s.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fromCatId: c.mimi, toCatId: c.agatha, reason: "other", reasonText: "Two cats at the bowl", source: "cat_page", movedByAccountId: staff.id });

    const [m, a] = [await catRow(c.mimi), await catRow(c.agatha)];
    const [old, joined] = [await get(`/api/team/cats/${c.mimi}?done=moved`), await get(`/api/team/cats/${c.agatha}`)];
    expect(old.text).toContain("Saved. The move is in the history below, with where it went. Nobody was told.");
    expect(old.text).toContain(`Moved to <a href="/api/team/cats/${c.agatha}">${esc(a.name)}</a>`);
    expect(old.text).toContain("Why: Two cats at the bowl.");
    expect(joined.text).toContain(`Moved here from <a href="/api/team/cats/${c.mimi}">${esc(m.name)}</a>`);
    // Move back is offered on both, to the same place.
    const back = `/api/team/sightings/move?cat=${c.agatha}&amp;s=${c.s.id}&amp;to=${c.mimi}`;
    expect(joined.text).toContain(back);
    expect(old.text).toContain(back);
  });

  it("Move back is another move, with its own reason, and the History then shows both moves", async () => {
    const c = await twoCats();
    // Agatha has a sighting of her own, so moving this one back leaves her something.
    await kit.sighting(c.agatha, kit.device(), daysAgo(15));
    expect((await move(c)).status).toBe(303);
    const back = await get(screen(c.agatha, [c.s.id], `&to=${c.mimi}`));
    expect(back.status).toBe(200);
    expect(back.text).toContain("Moves to <b>");
    expect((await post({ cat: String(c.agatha), s: String(c.s.id), to: String(c.mimi), reason: "wrong_pick", source: "cat_page" })).status).toBe(303);
    expect((await sightingRow(c.s.id)).catId).toBe(c.mimi);
    expect(await movesOf(c.s.id)).toHaveLength(2);
    // Only the newest move offers "Move back": the first move's offer is gone on both pages.
    const [agatha, mimi] = [await get(`/api/team/cats/${c.agatha}`), await get(`/api/team/cats/${c.mimi}`)];
    expect(agatha.text).toContain("Moved to <a");
    expect(mimi.text).toContain("Moved here from");
    expect(mimi.text).toContain("Moved to <a");
    expect(agatha.text.match(/Move back to/g)).toHaveLength(1);
    expect(mimi.text.match(/Move back to/g)).toHaveLength(1);
  });

  it("splitting: several ticked go to a new cat in one step, the oldest starting it", async () => {
    const mimi = await kit.cat();
    const keep = await kit.sighting(mimi, kit.device(), daysAgo(20));
    const one = await kit.sighting(mimi, kit.device(), daysAgo(8));
    const two = await kit.sighting(mimi, kit.device(), daysAgo(4));
    const name = `VitestMoveScreenNew${tag()}`;
    const res = await post({ cat: String(mimi), s: `${one.id},${two.id}`, new: "1", name, reason: "two_cats", source: "cat_page" });
    expect(res.status).toBe(303);
    const [a, b] = [await sightingRow(one.id), await sightingRow(two.id)];
    expect(a.catId).not.toBe(mimi);
    expect(b.catId).toBe(a.catId);
    expect((await sightingRow(keep.id)).catId).toBe(mimi);
    expect((await catRow(a.catId!)).name).toBe(name);
    const rows = [...(await movesOf(one.id)), ...(await movesOf(two.id))];
    expect(new Set(rows.map((r) => r.batchId)).size).toBe(1);
    expect(rows.filter((r) => r.madeNewCat)).toHaveLength(1);
    const newCat = await get(`/api/team/cats/${a.catId}`);
    expect(newCat.text).toContain("Started this cat. Moved here from");
  });

  it("“Let spotters name it” starts a cat showing its SYR number", async () => {
    const c = await twoCats();
    const res = await post({ cat: String(c.mimi), s: String(c.s.id), new: "1", letSpottersName: "1", reason: "different_markings", source: "cat_page" });
    expect(res.status).toBe(303);
    const moved = await sightingRow(c.s.id);
    const cat = await catRow(moved.catId!);
    expect(cat.namePending).toBe(true);
    expect((await movesOf(c.s.id))[0]).toMatchObject({ madeNewCat: true, letSpottersName: true });
  });

  it("choosing the next main photo moves a main photo; leaving it out brings the screen back", async () => {
    const c = await twoCats();
    await db.update(catsTable).set({ primaryPhotoId: c.s.photoId! }).where(eq(catsTable.id, c.mimi));
    const missing = await move(c);
    expect(missing.status).toBe(400);
    expect(missing.text).toContain(esc(MOVE_WORDS.mainPhotoNeeded((await catRow(c.mimi)).name)));
    expect(missing.text).toContain("Nothing was moved.");
    expect((await sightingRow(c.s.id)).catId).toBe(c.mimi);
    expect((await move(c, { mainPhoto: String(c.older.photoId) })).status).toBe(303);
    expect((await catRow(c.mimi)).primaryPhotoId).toBe(c.older.photoId);
    const noPhoto = await twoCats();
    await db.update(catsTable).set({ primaryPhotoId: noPhoto.s.photoId! }).where(eq(catsTable.id, noPhoto.mimi));
    expect((await move(noPhoto, { mainPhoto: "0" })).status).toBe(303);
    expect((await catRow(noPhoto.mimi)).primaryPhotoId).toBe(0);
  });
});

describe("every refusal reaches the screen in words, and nothing moves", () => {
  it("the form's own checks: why, “Other…” says what, a cat or a new cat, a name or the tick", async () => {
    const c = await twoCats();
    const base = { cat: String(c.mimi), s: String(c.s.id), to: String(c.agatha), source: "cat_page" };
    const no = await post({ ...base });
    expect(no.status).toBe(400);
    expect(no.text).toContain("Choose why you are moving it. Nothing was moved.");
    const other = await post({ ...base, reason: "other" });
    expect(other.text).toContain("Say what the other reason is.");
    expect(other.text).toMatch(/value="other" checked/);
    const neither = await post({ cat: String(c.mimi), s: String(c.s.id), reason: "wrong_pick", source: "cat_page" });
    expect(neither.text).toContain("Choose which cat it is, or say it&#39;s a new cat.");
    const blank = await post({ ...base, to: "", new: "1", reason: "wrong_pick" });
    expect(blank.text).toContain("Type a name, or tick “Let spotters name it”.");
    const both = await post({ ...base, to: "", new: "1", name: "Kiki", letSpottersName: "1", reason: "wrong_pick" });
    expect(both.text).toContain("Type a name, or tick “Let spotters name it”, not both.");
    expect((await sightingRow(c.s.id)).catId).toBe(c.mimi);
  });

  it("MERGE_INSTEAD offers the merge (SYC-59 PR 4.2): the spec's words, and a link that opens the merge screen with both cats filled in", async () => {
    const mimi = await kit.cat();
    const agatha = await kit.cat();
    const only = await kit.sighting(mimi, kit.device());
    const res = await move({ mimi, agatha, s: only });
    expect(res.status).toBe(409);
    const [m, a] = [await catRow(mimi), await catRow(agatha)];
    expect(res.text).toContain(esc(MOVE_WORDS.mergeInstead(m.name, a.name)));
    expect(res.text).toContain("Nothing was moved.");
    const link = `/api/team/cats/merge?a=${mimi}&amp;b=${agatha}&amp;survivor=${agatha}`;
    expect(res.text).toContain(`<a href="${link}">Open the merge screen</a>`);
    expect((await sightingRow(only.id)).catId).toBe(mimi);
    // The link opens the merge screen for the two cats: Agatha stays, Mimi becomes part of her.
    const screenPage = await get(link.replace(/&amp;/g, "&"));
    expect(screenPage.status).toBe(200);
    expect(screenPage.text).toContain("Which record stays?");
    expect(screenPage.text).toContain(`<b>${esc(a.name)}</b>'s record stays.`);
    expect(screenPage.text).toContain(`<b>${esc(m.name)}</b> becomes part of <b>${esc(a.name)}</b>.`);
  });

  it("ALREADY_ITS_OWN_CAT: “It's a new cat” with nothing left", async () => {
    const mimi = await kit.cat();
    const only = await kit.sighting(mimi, kit.device());
    const res = await post({ cat: String(mimi), s: String(only.id), new: "1", name: `VitestMoveScreenNew${tag()}`, reason: "wrong_pick", source: "cat_page" });
    expect(res.status).toBe(409);
    expect(res.text).toContain(esc(MOVE_WORDS.alreadyItsOwnCat((await catRow(mimi)).name)));
  });

  it("SAME_CAT: the cat it is under", async () => {
    const c = await twoCats();
    const res = await move(c, { to: String(c.mimi) });
    expect(res.status).toBe(400);
    expect(res.text).toContain(esc(MOVE_WORDS.sameCat));
  });

  it("MOVED_ALREADY: someone moved it first, and the page says where it is now", async () => {
    const c = await twoCats();
    const third = await kit.cat();
    expect((await move(c, { to: String(third) })).status).toBe(303);
    const res = await move(c);
    expect(res.status).toBe(409);
    expect(res.text).toContain(`${MOVE_WORDS.changed} Nothing was moved.`);
    expect(res.text).toContain(`href="/api/team/cats/${third}"`);
    expect((await sightingRow(c.s.id)).catId).toBe(third);
  });

  it("NOT_RESOLVED: a spot still waiting to be matched is matched, not moved", async () => {
    const c = await twoCats();
    const [pending] = await db
      .insert(sightingsTable)
      .values({ catId: null, deviceId: kit.device(), photoId: await kit.photo(), lat: 37.4441, lng: 24.9412, status: "pending", createdAt: daysAgo(1) })
      .returning();
    const res = await post({ cat: String(c.mimi), s: String(pending!.id), to: String(c.agatha), reason: "wrong_pick", source: "cat_page" });
    expect(res.status).toBe(409);
    expect(res.text).toContain(esc(MOVE_WORDS.notResolved));
  });

  it("REPORT_NOT_FOUND: a report that isn't one about what moves", async () => {
    const c = await twoCats();
    const res = await move(c, { source: "report", report: "vt-screen-no-such-report" });
    expect(res.status).toBe(404);
    expect(res.text).toContain(esc(MOVE_WORDS.reportNotFound));
    expect((await sightingRow(c.s.id)).catId).toBe(c.mimi);
  });

  it("the name refusals for a new cat: offensive, a SYR number, a link, a phone number, taken (with the cat that has it)", async () => {
    const c = await twoCats();
    const named = (name: string) => post({ cat: String(c.mimi), s: String(c.s.id), new: "1", name, reason: "wrong_pick", source: "cat_page" });
    expect((await named("fuck")).text).toContain("Cat name contains offensive language");
    expect((await named("SYR-0042")).text).toContain(esc(SYR_SHAPED_NAME));
    const link = await named("Kiki www.catsforsale.com");
    expect(link.status).toBe(400);
    expect(link.text).toContain(esc(NAME_HAS_LINK));
    expect((await named("Kiki 6912345678")).text).toContain(esc(NAME_HAS_LINK));
    const a = await catRow(c.agatha);
    const taken = await named(a.name.toLowerCase());
    expect(taken.status).toBe(409);
    expect(taken.text).toContain(esc(NAME_TAKEN_WORDS));
    expect(taken.text).toContain(`<a href="/api/team/cats/${c.agatha}">Open ${esc(a.name)}</a>`);
    // What was typed comes back in the box.
    expect(taken.text).toContain(`value="${esc(a.name.toLowerCase())}"`);
    expect((await sightingRow(c.s.id)).catId).toBe(c.mimi);
  });
});

describe("“Move to the right cat” on a “That's a different cat” report (§5.1 way 3)", () => {
  it("shows on the report, carries it through, and moving closes it as done", async () => {
    const c = await twoCats();
    const report = await seedReport({ publicId: `vt-screen-${tag()}`, kind: "content", reason: "wrong_cat", catId: c.mimi, photoId: c.s.photoId });
    const queue = await get("/api/team");
    expect(queue.status).toBe(200);
    const link = `/api/team/sightings/move?cat=${c.mimi}&amp;s=${c.s.id}&amp;source=report&amp;report=${report.publicId}`;
    expect(queue.text).toContain(`href="${link}"`);
    expect(queue.text).toContain("Move to the right cat");

    const screenPage = await get(`/api/team/sightings/move?cat=${c.mimi}&s=${c.s.id}&source=report&report=${report.publicId}&to=${c.agatha}`);
    expect(screenPage.text).toContain('<input type="hidden" name="source" value="report">');
    expect(screenPage.text).toContain(`<input type="hidden" name="report" value="${report.publicId}">`);
    const res = await post({ cat: String(c.mimi), s: String(c.s.id), to: String(c.agatha), reason: "wrong_pick", source: "report", report: report.publicId });
    expect(res.status).toBe(303);
    const [after] = await db.select().from(welfareReportsTable).where(eq(welfareReportsTable.id, report.id));
    expect(after!.state).toBe("done");
    expect((await movesOf(c.s.id))[0]).toMatchObject({ source: "report" });
  });

  it("is not offered on another kind of report, a closed one, or a photo that isn't a spot of that cat", async () => {
    const c = await twoCats();
    const other = await seedReport({ publicId: `vt-screen-${tag()}`, kind: "content", reason: "photo_private", catId: c.mimi, photoId: c.s.photoId });
    const closed = await seedReport({ publicId: `vt-screen-${tag()}`, kind: "content", reason: "wrong_cat", catId: c.mimi, photoId: c.s.photoId, state: "done" });
    const stray = await seedReport({ publicId: `vt-screen-${tag()}`, kind: "content", reason: "wrong_cat", catId: c.agatha, photoId: c.s.photoId });
    const queue = await get("/api/team");
    for (const r of [other, closed, stray]) {
      const row = queue.text.split(`id="r-${r.publicId}"`)[1]!.split("</article>")[0]!;
      expect(row, r.publicId).not.toContain("Move to the right cat");
    }
  });
});
