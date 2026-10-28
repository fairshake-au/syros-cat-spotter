import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, like } from "drizzle-orm";
import {
  catSubscriptionsTable,
  catUnfollowsTable,
  catsTable,
  db,
  deviceCredentialsTable,
  duplicateReportsTable,
  markLeft,
  pool,
  sightingsTable,
} from "@workspace/db";

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));
vi.mock("../lib/push", () => ({ sendPushNotification: vi.fn().mockResolvedValue(undefined) }));

import app from "../app";
import { daysAgo, moveKit, tag } from "../test/moveKit";
import { libMerge } from "../test/merges";
import { guardianOn, newColony, putInColony, signedPerson, type Signed } from "../test/roleKit";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { canonicalCatOf } from "../lib/catIdentity";
import { MERGE_WORDS } from "../lib/mergeCats";
import { writeObservation } from "../lib/observations";
import { teamCatView } from "../lib/teamCatView";
import { escapeHtml as esc } from "../lib/teamPages/escape";
import { sterilisedText } from "../lib/teamPages/catFacts";

// SYC-59 PR 4.2 (which-cat-is-which.md §4.1, decision D7): the merge screen
// and the form behind it, through the real routes and real data. The merge
// itself, its locks and its refusals are PR 4.1's (team.mergeCats.test.ts);
// here each refusal must reach the screen in the spec's words, "What
// happens" must say what the merge will do, and a guardian gets a 403
// everywhere. Cat names are letters only (SYC-709).

const KEY = "vitest-mergescreen-key-0123456789abcdef-0123456789abcdef";
const kit = moveKit("VitestMergeScreen");
let staff: Signed;
let guardian: Signed;
let colonyA: number;
let colonyB: number;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await kit.cleanup();
  staff = await signedPerson(`screener${tag()}`, ["staff"]);
  colonyA = await newColony("msa");
  colonyB = await newColony("msb");
  guardian = await guardianOn(`mscguard${tag()}`, [colonyA]);
});
afterAll(async () => {
  await kit.cleanup();
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${kit.devicePrefix}%`));
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
  const r = request(app).post("/api/team/cats/merge/form").set("Origin", TEAM_ORIGIN).type("form");
  return (cookie ? r.set("Cookie", cookie) : r).send(body);
};
const screen = (a: number, b?: number, extra = "") => `/api/team/cats/merge?a=${a}${b !== undefined ? `&b=${b}` : ""}${extra}`;
const catRow = async (id: number) => (await db.select().from(catsTable).where(eq(catsTable.id, id)))[0]!;
const resolvedCount = async (catId: number) => (await teamCatView(catId))!.sightings.length;
const standing = async (id: number) => (await canonicalCatOf([id])).get(id);

/** Agatha (older, one sighting) and Mimi (two): Agatha stays by default (D7). */
async function pair() {
  const agatha = await kit.cat(daysAgo(60));
  const mimi = await kit.cat(daysAgo(40));
  const a0 = await kit.sighting(agatha, kit.device(), daysAgo(30));
  const m1 = await kit.sighting(mimi, kit.device(), daysAgo(20));
  const m2 = await kit.sighting(mimi, kit.device(), daysAgo(4));
  return { agatha, mimi, a0, m1, m2 };
}

/** The form as the screen draws it: both cats, who stays, the counts it showed, and a reason. */
const form = async (c: { agatha: number; mimi: number }, extra: Record<string, string> = {}) =>
  post({
    a: String(c.mimi),
    b: String(c.agatha),
    survivor: String(c.agatha),
    n0: String(await resolvedCount(c.agatha)),
    n1: String(await resolvedCount(c.mimi)),
    reasonText: "Same face markings and torn left ear",
    ...extra,
  });

describe("who may open the screen and merge (D5)", () => {
  it("refuses anyone signed out, and a cat guardian: no screen, nothing merges", async () => {
    const c = await pair();
    expect((await get(screen(c.mimi, c.agatha), null)).status).toBe(401);
    expect((await get(screen(c.mimi, c.agatha), guardian.cookie)).status).toBe(403);
    expect((await get(screen(c.mimi), guardian.cookie)).status).toBe(403);
    const d = await pair();
    expect((await post({ a: String(d.mimi), b: String(d.agatha), survivor: String(d.agatha), n0: "1", n1: "2", reasonText: "x" }, null)).status).toBe(401);
    const asGuardian = await request(app)
      .post("/api/team/cats/merge/form")
      .set("Origin", TEAM_ORIGIN)
      .set("Cookie", guardian.cookie)
      .type("form")
      .send({ a: String(d.mimi), b: String(d.agatha), survivor: String(d.agatha), n0: "1", n1: "2", reasonText: "x" });
    expect(asGuardian.status).toBe(403);
    expect(await standing(d.mimi)).toBe(d.mimi);
  });

  it("a form post from another site is refused before anything is read", async () => {
    const c = await pair();
    const res = await request(app)
      .post("/api/team/cats/merge/form")
      .set("Origin", "https://evil.example.com")
      .set("Cookie", staff.cookie)
      .type("form")
      .send({ a: String(c.mimi), b: String(c.agatha), survivor: String(c.agatha), n0: "1", n1: "2", reasonText: "x" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await standing(c.mimi)).toBe(c.mimi);
  });
});

describe("the screen: choosing the other cat (\"Same cat as…\")", () => {
  it("opened from one cat it asks which cat it is the same as, nearest first, never the cat itself, with numbers-only links", async () => {
    // Every test's cats sit at one spot, and the list shows the eight nearest, so these two are set far from all of them.
    const far = { lat: 37.5301, lng: 24.8301 };
    const c = { agatha: await kit.cat(daysAgo(60)), mimi: await kit.cat(daysAgo(40)) };
    await db.update(catsTable).set({ lat: far.lat + 0.001, lng: far.lng }).where(eq(catsTable.id, c.agatha));
    await db.insert(sightingsTable).values([
      { catId: c.mimi, deviceId: kit.device(), photoId: await kit.photo(), ...far, status: "resolved", createdAt: daysAgo(20) },
      { catId: c.mimi, deviceId: kit.device(), photoId: await kit.photo(), ...far, status: "resolved", createdAt: daysAgo(4) },
    ]);
    const res = await get(screen(c.mimi));
    expect(res.status).toBe(200);
    const m = await catRow(c.mimi);
    const a = await catRow(c.agatha);
    expect(res.text).toContain(`Which cat is ${esc(m.name)} the same as?`);
    expect(res.text).toContain(`Cats near ${esc(m.name)}`);
    expect(res.text).toContain(`href="/api/team/cats/merge?a=${c.mimi}&amp;b=${c.agatha}"`);
    expect(res.text).toContain(esc(a.name));
    expect(res.text).not.toContain(`b=${c.mimi}"`);
    expect(res.text).not.toMatch(/lat=|lng=|37\.44/);
  });

  it("the search finds a cat by name and by SYR number, and says when none matches", async () => {
    const c = await pair();
    const a = await catRow(c.agatha);
    const byName = await get(screen(c.mimi, undefined, `&q=${encodeURIComponent(a.name)}`));
    expect(byName.text).toContain(`Cats matching “${esc(a.name)}”`);
    expect(byName.text).toContain(`b=${c.agatha}"`);
    const bySyr = await get(screen(c.mimi, undefined, `&q=SYR-${String(c.agatha).padStart(4, "0")}`));
    expect(bySyr.text).toContain(`b=${c.agatha}"`);
    const none = await get(screen(c.mimi, undefined, "&q=zzzzzzqqqq"));
    expect(none.text).toContain("No cat found for “zzzzzzqqqq”");
  });

  it("the same cat, an unknown cat and a cat already part of another say so, in the refusal's words", async () => {
    const c = await pair();
    const same = await get(screen(c.mimi, c.mimi));
    expect(same.text).toContain(esc(MERGE_WORDS.sameCat));
    expect(same.text).toContain("Which cat is");
    const unknown = await get(screen(c.mimi, 999999999));
    expect(unknown.text).toContain(esc(MERGE_WORDS.notFound));
    const d = await pair();
    await libMerge(d.mimi, d.agatha);
    const gone = await get(screen(c.agatha, d.mimi));
    const mimi = await catRow(d.mimi);
    expect(gone.text).toContain(esc(MERGE_WORDS.alreadyMerged(mimi.name)));
    expect(gone.text).toContain("Which cat is");
  });

  it("a cat that is already part of another has no merge screen of its own: it points to the cat it is part of now", async () => {
    const d = await pair();
    await libMerge(d.mimi, d.agatha);
    const res = await get(screen(d.mimi, d.agatha));
    const [m, a] = [await catRow(d.mimi), await catRow(d.agatha)];
    expect(res.status).toBe(409);
    expect(res.text).toContain(esc(MERGE_WORDS.alreadyMerged(m.name)));
    expect(res.text).toContain(`href="/api/team/cats/${d.agatha}"`);
    expect(res.text).toContain(`Open ${esc(a.name)}`);
    expect((await get(screen(999999999, d.agatha))).status).toBe(404);
  });
});

describe("the screen: the two cats, which record stays (D7)", () => {
  it("shows both cats side by side and the earlier record stays by default, with a switch", async () => {
    const c = await pair();
    const res = await get(screen(c.mimi, c.agatha));
    expect(res.status).toBe(200);
    const [m, a] = [await catRow(c.mimi), await catRow(c.agatha)];
    for (const cat of [m, a]) expect(res.text).toContain(esc(cat.name));
    expect(res.text).toContain(`SYR-${String(c.agatha).padStart(4, "0")}`);
    expect(res.text).toContain(`SYR-${String(c.mimi).padStart(4, "0")}`);
    expect(res.text).toContain("<dt>Sightings</dt><dd>1</dd>");
    expect(res.text).toContain("<dt>Sightings</dt><dd>2</dd>");
    expect(res.text).toContain("Which record stays?");
    // No heading the spec doesn't have.
    expect(res.text).not.toContain("These two records are the same cat");
    expect(res.text).toContain(`<b>${esc(a.name)}</b>'s record stays.`);
    expect(res.text).toContain(`href="/api/team/cats/merge?a=${c.mimi}&amp;b=${c.agatha}&amp;survivor=${c.mimi}"`);
    expect(res.text).toContain(`Keep ${esc(m.name)}'s record instead`);
    // The form carries who stays and the counts the screen showed (1 + 2), numbers only.
    expect(res.text).toContain('action="/api/team/cats/merge/form"');
    expect(res.text).toContain(`name="survivor" value="${c.agatha}"`);
    expect(res.text).toContain('name="n0" value="1"');
    expect(res.text).toContain('name="n1" value="2"');
  });

  it("the team can switch: the other record stays, and the preview follows", async () => {
    const c = await pair();
    const res = await get(screen(c.mimi, c.agatha, `&survivor=${c.mimi}`));
    const [m, a] = [await catRow(c.mimi), await catRow(c.agatha)];
    expect(res.text).toContain(`<b>${esc(m.name)}</b>'s record stays.`);
    expect(res.text).toContain(`<b>${esc(a.name)}</b> becomes part of <b>${esc(m.name)}</b>. ${esc(m.name)} will have 3 sightings (2 + 1).`);
    expect(res.text).toContain(`name="survivor" value="${c.mimi}"`);
    expect(res.text).toContain('name="n0" value="2"');
    expect(res.text).toContain('name="n1" value="1"');
    // A survivor that is neither cat is ignored.
    const odd = await get(screen(c.mimi, c.agatha, "&survivor=999999999"));
    expect(odd.text).toContain(`<b>${esc(a.name)}</b>'s record stays.`);
  });

  it("an earlier record whose name is still pending doesn't stay over a named one, and the screen says why", async () => {
    const c = await pair();
    await db.update(catsTable).set({ name: `SYR-${c.agatha}`, namePending: true }).where(eq(catsTable.id, c.agatha));
    const res = await get(screen(c.mimi, c.agatha, `&survivor=${c.agatha}`));
    const m = await catRow(c.mimi);
    expect(res.text).toContain(`<b>${esc(m.name)}</b>'s record stays.`);
    expect(res.text).toContain("name is still waiting for a spotter, so it can&#39;t stay over a named record.");
    expect(res.text).not.toContain("record instead");
    expect(res.text).toContain(`name="survivor" value="${c.mimi}"`);
    // Naming it first opens the choice again.
    await db.update(catsTable).set({ name: `${m.name}x`, namePending: false }).where(eq(catsTable.id, c.agatha));
    expect((await get(screen(c.mimi, c.agatha))).text).toContain("record instead");
  });

  it("a cat with an owner always stays; the screen offers no switch", async () => {
    const c = await pair();
    await db.update(catsTable).set({ ownerDeviceId: kit.device(), ownerName: "Vt" }).where(eq(catsTable.id, c.mimi));
    const res = await get(screen(c.mimi, c.agatha));
    const m = await catRow(c.mimi);
    expect(res.text).toContain(`<b>${esc(m.name)}</b>'s record stays.`);
    expect(res.text).toContain("An owner never moves from one record to another.");
    expect(res.text).not.toContain("record instead");
    expect(res.text).toContain(`name="survivor" value="${c.mimi}"`);
    expect(res.text).toContain("Has an owner");
    expect(res.text).toContain(esc(`Owner: ${m.name} keeps hers.`));
  });

  it("both cats with an owner blocks the merge in the spec's words, and there is no Merge button", async () => {
    const c = await pair();
    for (const id of [c.mimi, c.agatha]) await db.update(catsTable).set({ ownerDeviceId: kit.device(), ownerName: "Vt" }).where(eq(catsTable.id, id));
    const res = await get(screen(c.mimi, c.agatha));
    expect(res.text).toContain(esc(MERGE_WORDS.twoOwners));
    expect(res.text).not.toContain('action="/api/team/cats/merge/form"');
    expect(res.text).not.toContain(">Merge</button>");
    // Links to sort the owners out on each cat's own page.
    expect(res.text).toContain(`href="/api/team/cats/${c.mimi}"`);
    expect(res.text).toContain(`href="/api/team/cats/${c.agatha}"`);
    // A crafted post is refused all the same, back on the screen, and nothing merges.
    const crafted = await form(c);
    expect(crafted.status).toBe(409);
    expect(crafted.text).toContain(esc(MERGE_WORDS.twoOwners));
    expect(await standing(c.mimi)).toBe(c.mimi);
  });
});

describe("the screen: What happens (§4.1)", () => {
  it("names the sightings, the also-known-as name and the island count", async () => {
    const c = await pair();
    const res = await get(screen(c.mimi, c.agatha));
    const [m, a] = [await catRow(c.mimi), await catRow(c.agatha)];
    expect(res.text).toContain("What happens");
    expect(res.text).toContain(`<b>${esc(m.name)}</b> becomes part of <b>${esc(a.name)}</b>. ${esc(a.name)} will have 3 sightings (1 + 2).`);
    expect(res.text).toContain(`Also known as: ${esc(m.name)}.`);
    expect(res.text).toContain("The island count goes down by one.");
    expect(res.text).toContain("Colony: none.");
    expect(res.text).toContain("Owner: neither has one.");
    // Nothing untrue: no warning, no followers, no points.
    expect(res.text).not.toContain('class="warn"');
    expect(res.text).not.toMatch(/follow [^<]*; they'll follow/);
    expect(res.text).not.toContain("get 10 points");
  });

  it("sterilised is worked out over both records, in the spec's words: a clipped ear on Mimi makes Agatha Likely (was Unknown)", async () => {
    const c = await pair();
    await kit.answer(c.m1, "ear_tip", { clipped: true, side: "left" });
    const res = await get(screen(c.mimi, c.agatha));
    const [m, a] = [await catRow(c.mimi), await catRow(c.agatha)];
    expect(res.text).toContain(esc(`Sterilised: Likely, from ${m.name}'s clipped ear (was Unknown).`));
    // The preview is what the merge then does.
    expect(sterilisedText((await teamCatView(c.agatha))!.records.sterilised)).toBe("Not known yet");
    await libMerge(c.mimi, c.agatha);
    expect(sterilisedText((await teamCatView(c.agatha))!.records.sterilised)).toBe("Probably sterilised");
    expect(a.id).toBe(c.agatha);
  });

  it("life status: the preview matches the merge when Agatha is recorded as died and Mimi was seen after", async () => {
    const c = await pair();
    // Agatha's only sighting is 30 days old; she is recorded as having died 29 days ago; Mimi was seen 20 and 4 days ago.
    await writeObservation(db, { catId: c.agatha, kind: "life_status", value: { status: "deceased" }, accountId: "vitest-ms-team", roleAtTime: "staff", observedAt: daysAgo(29) });
    expect((await teamCatView(c.agatha))!.records.lifeStatus.value).toBe("deceased");
    const res = await get(screen(c.mimi, c.agatha));
    const a = await catRow(c.agatha);
    expect(res.text).toContain(esc("Where the cat lives: Lives on the street (was No longer with us)."));
    expect(res.text).toContain(esc(`${a.name} is recorded as having died in `));
    await libMerge(c.mimi, c.agatha);
    expect((await teamCatView(c.agatha))!.records.lifeStatus.value).toBe("street");
  });

  it("followers carry over; those who unfollowed the staying cat don't", async () => {
    const c = await pair();
    const [f1, f2, f3] = [kit.device(), kit.device(), kit.device()];
    await db.insert(catSubscriptionsTable).values([f1, f2, f3].map((deviceId) => ({ deviceId, catId: c.mimi })));
    await db.insert(catUnfollowsTable).values({ deviceId: f3, catId: c.agatha });
    const res = await get(screen(c.mimi, c.agatha));
    const [m, a] = [await catRow(c.mimi), await catRow(c.agatha)];
    expect(res.text).toContain(esc(`2 people follow ${m.name}; they'll follow ${a.name}.`));
    expect(res.text).toContain(esc(`1 other person who follows ${m.name} had unfollowed ${a.name}, so they won't follow ${a.name}.`));
  });

  it("colonies: the staying record's colony, the other's, and who gains or loses sight of the cat", async () => {
    const c = await pair();
    await putInColony(c.agatha, colonyA);
    await putInColony(c.mimi, colonyB);
    const label = `eleni${tag()}`;
    const eleni = await guardianOn(label, [colonyB]);
    const res = await get(screen(c.mimi, c.agatha));
    const [m] = [await catRow(c.mimi)];
    const colA = (await teamCatView(c.agatha))!.colony!.name;
    const colB = (await teamCatView(c.mimi))!.colony!.name;
    expect(res.text).toContain(esc(`Colony: ${colA}. ${m.name} was in ${colB}; change it after merging if that's wrong.`));
    expect(res.text).toContain(esc(`${m.name} is in ${colB} and `));
    expect(res.text).toContain(esc(`After merging she'll show as ${colA}.`));
    // The guardian of Mimi's colony stops seeing the cat; the guardian of Agatha's colony keeps it.
    expect(res.text).toContain(esc(`Cat guardian Vt ${label} (${colB}) will no longer see this cat`));
    expect(res.text).toContain(esc(`colony (${colA}) keeps it.`));
    await markLeft(eleni.email, "cli:vitest");
  });

  it("only the other record has a colony: the staying record will be in it, and its cat guardian will see her", async () => {
    const c = await pair();
    await putInColony(c.mimi, colonyB);
    const label = `gaining${tag()}`;
    const g = await guardianOn(label, [colonyB]);
    const res = await get(screen(c.mimi, c.agatha));
    const [m, a] = [await catRow(c.mimi), await catRow(c.agatha)];
    const colB = (await teamCatView(c.mimi))!.colony!.name;
    expect(res.text).toContain(esc(`Only ${m.name} is in a colony (${colB}). After merging, ${a.name} will be in ${colB}.`));
    expect(res.text).toContain(esc(`Colony: ${colB}, from ${m.name} (${a.name} had none).`));
    expect(res.text).toContain(esc(`Cat guardian Vt ${label} (${colB}) will see ${a.name}'s record.`));
    await markLeft(g.email, "cli:vitest");
  });

  it("the staying record marked \"in no colony\" keeps that: the preview and the merge agree on the colony and on who sees the cat", async () => {
    const c = await pair();
    await putInColony(c.agatha, null);
    await putInColony(c.mimi, colonyB);
    const label = `nonecol${tag()}`;
    const g = await guardianOn(label, [colonyB]);
    const res = await get(screen(c.mimi, c.agatha));
    const [m, a] = [await catRow(c.mimi), await catRow(c.agatha)];
    const colB = (await teamCatView(c.mimi))!.colony!.name;
    expect(res.text).toContain(esc(`Colony: none. ${m.name} was in ${colB}; change it after merging if that's wrong.`));
    expect(res.text).not.toContain("had none)");
    expect(res.text).not.toContain("is in a colony (");
    expect(res.text).not.toContain(esc(`will see ${a.name}'s record`));
    expect(res.text).toContain(esc(`Cat guardian Vt ${label} (${colB}) will no longer see this cat`));
    await libMerge(c.mimi, c.agatha);
    expect((await teamCatView(c.agatha))!.colony).toBeNull();
    await markLeft(g.email, "cli:vitest");
  });

  it("colour: the staying record's own is kept, and the other's is named so the team can change it", async () => {
    const c = await pair();
    const coat = (catId: number, colours: string[]) =>
      writeObservation(db, { catId, kind: "coat", value: { colours, pattern: "plain" }, accountId: "vitest-ms-team", roleAtTime: "staff", observedAt: daysAgo(10) });
    await coat(c.agatha, ["ginger"]);
    await coat(c.mimi, ["black"]);
    const res = await get(screen(c.mimi, c.agatha));
    const [m, a] = [await catRow(c.mimi), await catRow(c.agatha)];
    expect(res.text).toContain(esc(`Colour: ${a.name}'s (`));
    expect(res.text).toContain(esc(`${m.name} was recorded as `));
    expect(res.text).toContain("change it after merging if that&#39;s wrong.");
  });

  it("spotters who reported the pair as the same cat get 10 points each: only counting phones, once per pair", async () => {
    const c = await pair();
    const elsewhere = await kit.cat(daysAgo(200));
    const counting = kit.device();
    for (let i = 0; i < 3; i++) await kit.sighting(elsewhere, counting, daysAgo(70 + i * 2));
    await db.insert(duplicateReportsTable).values({ catLow: Math.min(c.agatha, c.mimi), catHigh: Math.max(c.agatha, c.mimi), source: "spotter_question", says: "same", deviceId: counting, createdAt: daysAgo(1) });
    const newPhone = kit.device();
    await kit.sighting(elsewhere, newPhone, daysAgo(60));
    await db.insert(duplicateReportsTable).values({ catLow: Math.min(c.agatha, c.mimi), catHigh: Math.max(c.agatha, c.mimi), source: "spotter_question", says: "same", deviceId: newPhone, createdAt: daysAgo(1) });
    const res = await get(screen(c.mimi, c.agatha));
    expect(res.text).toContain("1 spotter who reported this gets 10 points.");
    await libMerge(c.mimi, c.agatha);
  });
});

describe("the screen: the warnings, only when true (§4.1)", () => {
  it("two cats usually seen more than 2 km apart", async () => {
    const c = await pair();
    // Agatha is also seen 7 km north, so her sightings are centred 3.6 km from Mimi.
    const far = await kit.photo();
    await db.insert(sightingsTable).values({ catId: c.agatha, deviceId: kit.device(), photoId: far, lat: 37.5741, lng: 24.9412, status: "resolved", createdAt: daysAgo(31) });
    const res = await get(screen(c.mimi, c.agatha));
    expect(res.text).toMatch(/These two are usually seen \d+\.\d km apart\./);
    const near = await pair();
    expect((await get(screen(near.mimi, near.agatha))).text).not.toContain("usually seen");
  });

  it("one recorded as having died and the other seen since says the merged record will say alive", async () => {
    const c = await pair();
    await writeObservation(db, { catId: c.agatha, kind: "life_status", value: { status: "deceased" }, accountId: "vitest-ms-team", roleAtTime: "staff", observedAt: daysAgo(29) });
    const res = await get(screen(c.mimi, c.agatha));
    const [a, m] = [await catRow(c.agatha), await catRow(c.mimi)];
    const month = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", timeZone: "Europe/Athens" });
    expect(res.text).toContain(esc(`${a.name} is recorded as having died in ${month(daysAgo(29))}. ${m.name} was seen in ${month(daysAgo(4))}, so the merged record will say alive.`));
    expect(res.text.match(/class="warn"/g)).toHaveLength(1);
    // Neither is recorded as having died: no such warning.
    const fine = await pair();
    expect((await get(screen(fine.mimi, fine.agatha))).text).not.toContain("recorded as having died");
  });
});

describe("Merge (the form)", () => {
  it("merges, sends the team to the cat that stays, and the page says so; the merge is in History with Undo merge", async () => {
    const c = await pair();
    const res = await form(c);
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/cats/${c.agatha}?done=merged#history`);
    expect(await standing(c.mimi)).toBe(c.agatha);
    expect((await sightingRow(c.m1.id)).catId).toBe(c.agatha);
    const page = await get(`/api/team/cats/${c.agatha}?done=merged`);
    expect(page.text).toContain("The two records are one cat now.");
  });

  it("the other record can stay too (switched), written as what it was", async () => {
    const c = await pair();
    const res = await form(c, { survivor: String(c.mimi), n0: String(await resolvedCount(c.mimi)), n1: String(await resolvedCount(c.agatha)) });
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/cats/${c.mimi}?done=merged#history`);
    expect(await standing(c.agatha)).toBe(c.mimi);
  });

  it("a reason is required; what was typed comes back; nothing merges", async () => {
    const c = await pair();
    const none = await form(c, { reasonText: "   " });
    expect(none.status).toBe(400);
    expect(none.text).toContain("Say why they are the same cat. Nothing was merged.");
    const tooLong = await form(c, { reasonText: "x".repeat(501) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.text).toContain("Keep the reason to 500 characters.");
    expect(tooLong.text).toContain(`value="${"x".repeat(501)}"`);
    expect(await standing(c.mimi)).toBe(c.mimi);
  });

  it("the form's own checks: a survivor that is neither cat, missing counts, no other cat", async () => {
    const c = await pair();
    expect((await form(c, { survivor: "999999999" })).text).toContain("Choose which record stays. Nothing was merged.");
    const noCounts = await post({ a: String(c.mimi), b: String(c.agatha), survivor: String(c.agatha), reasonText: "Same cat" });
    expect(noCounts.text).toContain("Something in the form wasn&#39;t right.");
    const noOther = await post({ a: String(c.mimi), reasonText: "Same cat" });
    expect(noOther.status).toBe(400);
    expect(noOther.text).toContain("Which cat is");
    expect(await standing(c.mimi)).toBe(c.mimi);
  });

  it("STALE: if a sighting changed since the screen was drawn, the screen comes back with fresh numbers and 'Someone changed this a moment ago.'", async () => {
    const c = await pair();
    const stale = await form(c, { n1: "1" });
    expect(stale.status).toBe(409);
    expect(stale.text).toContain(esc(MERGE_WORDS.stale));
    expect(stale.text).toContain('name="n1" value="2"');
    expect(await standing(c.mimi)).toBe(c.mimi);
    // Pressing Merge on the fresh screen works.
    expect((await form(c)).status).toBe(303);
  });

  it("ALREADY_MERGED: someone merged one first; the screen says so with a link to the cat it is part of now", async () => {
    const c = await pair();
    const other = await pair();
    await libMerge(c.mimi, other.agatha);
    const res = await form(c);
    expect(res.status).toBe(409);
    const m = await catRow(c.mimi);
    expect(res.text).toContain(esc(MERGE_WORDS.alreadyMerged(m.name)));
    expect(await standing(c.agatha)).toBe(c.agatha);
  });

  it("OWNER_MUST_STAY and NAME_PENDING_MUST_GO: a crafted post is refused and the screen shows who must stay", async () => {
    const c = await pair();
    await db.update(catsTable).set({ ownerDeviceId: kit.device(), ownerName: "Vt" }).where(eq(catsTable.id, c.mimi));
    const owner = await form(c);
    const m = await catRow(c.mimi);
    expect(owner.status).toBe(409);
    expect(owner.text).toContain(esc(MERGE_WORDS.ownerMustStay(m.name)));
    expect(owner.text).toContain(`name="survivor" value="${c.mimi}"`);
    const d = await pair();
    await db.update(catsTable).set({ name: `SYR-${d.agatha}`, namePending: true }).where(eq(catsTable.id, d.agatha));
    const pending = await form(d);
    expect(pending.status).toBe(409);
    expect(pending.text).toContain(esc(MERGE_WORDS.namePendingMustGo(`SYR-${d.agatha}`)));
    expect(await standing(c.mimi)).toBe(c.mimi);
    expect(await standing(d.mimi)).toBe(d.mimi);
  });

  it("a cat that doesn't exist is a 404 stop page", async () => {
    const c = await pair();
    const res = await post({ a: "999999999", b: String(c.agatha), survivor: String(c.agatha), n0: "1", n1: "1", reasonText: "Same cat" });
    expect(res.status).toBe(404);
    expect(res.text).toContain(esc(MERGE_WORDS.notFound));
  });
});

describe("escaping", () => {
  it("names and reasons are escaped everywhere on the screen", async () => {
    const c = await pair();
    const evil = `VitestMergeScreen<script>alert(1)</script>${tag()}`;
    await db.update(catsTable).set({ name: evil }).where(eq(catsTable.id, c.mimi));
    const reason = `"><img src=x onerror=alert(2)>`;
    const res = await form(c, { reasonText: reason, n0: "0" });
    expect(res.status).toBe(409);
    for (const bad of ["<script>alert(1)</script>", "<img src=x onerror=alert(2)>"]) expect(res.text).not.toContain(bad);
    expect(res.text).toContain(esc(reason));
    expect(res.text).toContain(esc(evil));
    const plain = await get(screen(c.mimi, c.agatha));
    expect(plain.text).not.toContain("<script>alert(1)</script>");
    expect(plain.text).toContain(esc(evil));
  });
});

const sightingRow = async (id: number) => (await db.select().from(sightingsTable).where(eq(sightingsTable.id, id)))[0]!;
