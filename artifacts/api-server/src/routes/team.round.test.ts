import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, markLeft, observationsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { getGuidance } from "@workspace/welfare-guidance";
import app from "../app";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { currentColonyOf } from "../lib/colonyMembership";
import { removeTestPerson } from "../test/removeTestPerson";
import { guardianOn, newColony, seedCat, signedPerson, type Signed } from "../test/roleKit";

// SYC-396 PR 3.2, Task 3.2.1 (spec §8.5; SYC-621): "Log this round's vet
// visits" from a colony's planner.

const KEY = "vitest-round-key-0123456789abcdef-0123456789";
const CLINIC = getGuidance("en").vets[0]!.id;
let team: Signed;
let guardian: Signed;
let colony: number;
let other: number;
let cats: number[] = [];
let stranger: number;

const get = (path: string, who: Signed) => request(app).get(path).set("Cookie", who.cookie).set("Sec-Fetch-Mode", "navigate");
const post = (path: string, who: Signed, fields: [string, string][]) =>
  request(app)
    .post(path)
    .type("form")
    .set("Cookie", who.cookie)
    .set("Origin", TEAM_ORIGIN)
    .send(new URLSearchParams(fields).toString());

const visitsOf = async (ids: number[]) =>
  (await db.select().from(observationsTable).where(inArray(observationsTable.catId, ids))).filter((o) => o.kind === "vet_visit");

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Athens" });
const shared = (): [string, string][] => [
  ["date", today()],
  ["clinicId", CLINIC],
  ["priceEur", "60"],
  ["paidBy", "syros_cats"],
];

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  colony = await newColony("round");
  other = await newColony("round-other");
  for (let i = 0; i < 4; i += 1) cats.push((await seedCat(colony)).id);
  stranger = (await seedCat(other)).id;
  team = await signedPerson("round-team", ["staff"]);
  guardian = await guardianOn("round-g", [colony]);
});
beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
});
afterAll(async () => {
  delete process.env["TEAM_SESSION_KEYS"];
  // The team member wrote visits, so they leave rather than being removed.
  await markLeft(team.email, "cli:vitest");
  await removeTestPerson(guardian.email);
});

describe("Log this round's vet visits", () => {
  it("the planner links to the form; the form lists the colony's cats, unticked, with the shared price", async () => {
    const page = await get(`/api/team/colonies/${colony}`, team);
    expect(page.text).toContain(`href="/api/team/colonies/${colony}/round"`);
    const form = await get(`/api/team/colonies/${colony}/round`, team);
    expect(form.status).toBe(200);
    for (const id of cats) expect(form.text).toContain(`name="cat" value="${id}">`);
    expect(form.text).not.toMatch(/name="cat" value="\d+" checked/);
    expect(form.text).toMatch(/id="rd-price" name="priceEur"[^>]*value="\d+(\.\d\d)?"/);
  });

  it("three ticked cats give three visits, and the planner says so", async () => {
    const ticked = cats.slice(0, 3);
    const res = await post(`/api/team/colonies/${colony}/round`, team, [
      ...shared(),
      ...ticked.map((id): [string, string] => ["cat", String(id)]),
      ...ticked.map((id): [string, string] => [`did-${id}`, "sterilised"]),
      ["action", "save"],
    ]);
    expect(res.status).toBe(303);
    expect(res.headers["location"]).toBe(`/api/team/colonies/${colony}?done=round#todo`);
    expect(await visitsOf(ticked)).toHaveLength(3);
    expect(await visitsOf([cats[3]!])).toHaveLength(0);
    const page = await get(res.headers["location"]!, team);
    expect(page.text).toContain("The round&#39;s vet visits are saved.");
  });

  it("a problem on one cat saves nothing and keeps everything typed", async () => {
    const id = cats[3]!;
    const res = await post(`/api/team/colonies/${colony}/round`, team, [
      ...shared(),
      ["note", "Trapped at dawn"],
      ["cat", String(id)],
      [`did-${id}`, "treated"],
      [`treated-${id}`, ""],
      ["action", "save"],
    ]);
    expect(res.status).toBe(400);
    expect(res.text).toContain("Nothing was saved yet.");
    expect(res.text).toContain("Trapped at dawn");
    expect(res.text).toMatch(new RegExp(`name="cat" value="${id}" checked`));
    expect(res.text).toContain("Say what was treated");
    expect(await visitsOf([id])).toHaveLength(0);
  });

  it("refuses a round with no cat ticked, with words", async () => {
    const res = await post(`/api/team/colonies/${colony}/round`, team, [...shared(), ["action", "save"]]);
    expect(res.status).toBe(400);
    expect(res.text).toContain("Tick the cats that went to the vet.");
  });

  it("finds a cat from another colony, adds it, and its visit leaves it in its own colony", async () => {
    const syr = `SYR-${String(stranger).padStart(4, "0")}`;
    const found = await post(`/api/team/colonies/${colony}/round`, team, [...shared(), ["q", syr], ["action", "find"]]);
    expect(found.status).toBe(200);
    expect(found.text).toContain(`name="add" value="${stranger}"`);
    // Nothing searched for is in an address.
    expect(found.text).not.toContain(`?q=`);
    const added = await post(`/api/team/colonies/${colony}/round`, team, [...shared(), ["note", "kept"], ["add", String(stranger)]]);
    expect(added.status).toBe(200);
    expect(added.text).toContain(`name="extra" value="${stranger}"`);
    expect(added.text).toMatch(new RegExp(`name="cat" value="${stranger}" checked`));
    expect(added.text).toContain(">kept</textarea>");
    const saved = await post(`/api/team/colonies/${colony}/round`, team, [
      ...shared(),
      ["extra", String(stranger)],
      ["cat", String(stranger)],
      [`did-${stranger}`, "sterilised"],
      ["action", "save"],
    ]);
    expect(saved.status).toBe(303);
    expect(await visitsOf([stranger])).toHaveLength(1);
    expect((await currentColonyOf([stranger])).get(stranger)).toBe(other);
  });

  it("refuses a cat guardian, on the form and on the save", async () => {
    expect((await get(`/api/team/colonies/${colony}/round`, guardian)).status).toBe(403);
    const res = await post(`/api/team/colonies/${colony}/round`, guardian, [...shared(), ["cat", String(cats[3])], [`did-${cats[3]}`, "sterilised"]]);
    expect(res.status).toBe(403);
    expect(await visitsOf([cats[3]!])).toHaveLength(0);
    // And her planner has no link to it.
    expect((await get(`/api/team/colonies/${colony}`, guardian)).text).not.toContain("/round\"");
  });

  it("Enter in a box saves rather than searching: the first submit button is Save", async () => {
    const form = (await get(`/api/team/colonies/${colony}/round`, team)).text;
    const first = /<button type="submit"[^>]*>/.exec(form.slice(form.indexOf(`action="/api/team/colonies/${colony}/round"`)))![0];
    expect(first).toContain('value="save"');
  });

  it("an unknown colony is not found, and a post from elsewhere is refused", async () => {
    expect((await get(`/api/team/colonies/1999999999/round`, team)).status).toBe(404);
    const res = await request(app)
      .post(`/api/team/colonies/${colony}/round`)
      .type("form")
      .set("Cookie", team.cookie)
      .send(new URLSearchParams([...shared(), ["cat", String(cats[3])], [`did-${cats[3]}`, "sterilised"]]).toString());
    // No Origin: refused before the session is read.
    expect([401, 403]).toContain(res.status);
    expect(await visitsOf([cats[3]!])).toHaveLength(0);
  });

  it("escapes what was typed, and refuses a ticked cat the form no longer lists", async () => {
    const res = await post(`/api/team/colonies/${colony}/round`, team, [
      ...shared(),
      ["note", "<script>alert(1)</script>"],
      ["q", "<b>x</b>"],
      ["cat", String(stranger)],
      [`did-${stranger}`, "sterilised"],
      ["action", "save"],
    ]);
    expect(res.status).toBe(400);
    expect(res.text).not.toContain("<script>alert(1)");
    expect(res.text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(res.text).not.toContain("<b>x</b>");
    expect(res.text).toContain("no longer on this colony");
  });
});
