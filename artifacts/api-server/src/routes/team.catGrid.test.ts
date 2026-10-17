import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { like } from "drizzle-orm";
import { catsTable, db, observationsTable, photosTable, sightingsTable, welfareReportsTable } from "@workspace/db";
import app from "../app";
import { seedReport } from "../lib/teamAuth/__fixtures__/queueKit";
import { deleteTestSightings } from "../test/sightings";
import { guardianOn, newColony, signedPerson, type Signed } from "../test/roleKit";

// SYC-396 PR 1.3, Task 1.3.3: Cats opens on every cat as a filterable photo
// grid, with no script. Tie mode and the name/SYR search keep working.

const RUN = randomBytes(3).toString("hex");
const PREFIX = `vt-grid-${RUN}-`;
const DEVICE = `${PREFIX}device`;
const KEY = "vitest-grid-key-0123456789abcdef-0123456789ab";

let staff: Signed;
let guardian: Signed;
let ginger: number;
let black: number;
let colony: number;

async function cat(key: string, o: Partial<typeof catsTable.$inferInsert> = {}) {
  const [p] = await db
    .insert(photosTable)
    .values({ publicId: `${PREFIX}${key}-photo`, data: Buffer.from(key).toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${PREFIX}${key}`,
      primaryPhotoId: p!.id,
      lat: 37.4447,
      lng: 24.9417,
      discovererDeviceId: DEVICE,
      ...o,
    })
    .returning({ id: catsTable.id });
  return c!.id;
}

async function say(catId: number, kind: string, value: unknown) {
  await db.insert(observationsTable).values({
    catId,
    kind,
    value: value as never,
    deviceId: DEVICE,
    roleAtTime: "staff",
    observedAt: new Date(Date.now() - 40 * 86_400_000),
  });
}

const get = (path: string, who: Signed = staff) => request(app).get(path).set("Cookie", who.cookie);
const mineQ = `q=${encodeURIComponent(PREFIX)}`;

async function cleanup() {
  await deleteTestSightings(like(sightingsTable.deviceId, `${PREFIX}%`));
  await db.delete(welfareReportsTable).where(like(welfareReportsTable.publicId, `${PREFIX}%`));
  await db.delete(catsTable).where(like(catsTable.name, `${PREFIX}%`));
  await db.delete(photosTable).where(like(photosTable.publicId, `${PREFIX}%`));
}

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await cleanup();
  colony = await newColony("grid");
  staff = await signedPerson("grid-staff", ["staff"]);
  guardian = await guardianOn("grid-guardian", [colony]);
  ginger = await cat("Ginger");
  black = await cat("Black");
  await say(ginger, "coat", { colours: ["ginger"] });
  await say(ginger, "sterilised", { sterilised: true });
  await say(black, "coat", { colours: ["black"] });
  await say(black, "sterilised", { sterilised: false });
  await db.insert(sightingsTable).values({
    catId: ginger,
    deviceId: DEVICE,
    photoId: (await db.select({ id: photosTable.id }).from(photosTable).where(like(photosTable.publicId, `${PREFIX}Ginger%`)))[0]!.id,
    lat: 37.4436,
    lng: 24.8889,
    status: "resolved",
    createdAt: new Date(Date.now() - 3 * 86_400_000),
  });
});

afterAll(async () => {
  delete process.env["TEAM_SESSION_KEYS"];
  await cleanup();
});

describe("the Cats grid", () => {
  it("an empty GET lists cats, not the old 'Type a name' prompt", async () => {
    const res = await get("/api/team/cats");
    expect(res.status).toBe(200);
    expect(res.type).toBe("text/html");
    expect(res.text).not.toContain("Type a name");
    expect(res.text).toContain('class="catgrid"');
    expect(res.text).toMatch(/\d+ cats? match/);
    // Other tests' cats share the database, so look for ours by name too.
    expect((await get(`/api/team/cats?${mineQ}`)).text).toContain(`href="/api/team/cats/${ginger}"`);
  });

  it("shows the colour, colony, mark, last seen and place on each card", async () => {
    const res = await get(`/api/team/cats?${mineQ}`);
    const card = (id: number) => {
      const start = res.text.indexOf(`<li class="catcard"><a class="catcardlink" href="/api/team/cats/${id}"`);
      expect(start).toBeGreaterThan(-1);
      return res.text.slice(start, res.text.indexOf("</li>", start));
    };
    const g = card(ginger);
    expect(g).toContain("Ginger");
    expect(g).toContain("No colony");
    expect(g).toContain('<span class="mark-word">Sterilised</span>');
    expect(g).toContain("Last seen");
    expect(g).toContain("3 days ago");
    expect(g).toContain("Kini");
    expect(card(black)).toContain('<span class="mark-word">Not sterilised</span>');
    expect(card(black)).toContain("Never seen since first recorded");
  });

  it("?colours=ginger narrows", async () => {
    const res = await get(`/api/team/cats?${mineQ}&colours=ginger`);
    expect(res.text).toContain(`href="/api/team/cats/${ginger}"`);
    expect(res.text).not.toContain(`href="/api/team/cats/${black}"`);
    expect(res.text).toContain("1 cat matches");
    expect(res.text).toContain("Clear filters");
  });

  it("?q=SYR-nnnn still finds by number, and a name still finds by name", async () => {
    const syr = `SYR-${String(ginger).padStart(4, "0")}`;
    const res = await get(`/api/team/cats?q=${syr}`);
    expect(res.text).toContain(`href="/api/team/cats/${ginger}"`);
    expect(res.text).not.toContain(`href="/api/team/cats/${black}"`);
    const byName = await get(`/api/team/cats?q=${encodeURIComponent(`${PREFIX}black`)}`);
    expect(byName.text).toContain(`href="/api/team/cats/${black}"`);
  });

  it("the area key narrows, and a position given as the area is ignored", async () => {
    const kini = await get(`/api/team/cats?${mineQ}&area=kini`);
    expect(kini.text).toContain(`href="/api/team/cats/${ginger}"`);
    expect(kini.text).not.toContain(`href="/api/team/cats/${black}"`);
    const junk = await get(`/api/team/cats?${mineQ}&area=${encodeURIComponent("37.4,24.9")}`);
    expect(junk.status).toBe(200);
    expect(junk.text).toContain(`href="/api/team/cats/${black}"`);
  });

  it("shows 'No cats match these filters' with 'Clear filters'", async () => {
    const res = await get(`/api/team/cats?${mineQ}&colours=brown`);
    expect(res.text).toContain("No cats match these filters");
    expect(res.text).toContain('>Clear filters</a>');
    expect(res.text).not.toContain('class="catgrid"');
  });

  it("uses the small photo version for thumbnails, never the full photo", async () => {
    const res = await get(`/api/team/cats?${mineQ}`);
    expect(res.text).toContain(`src="/api/team/photos/${PREFIX}Ginger-photo/small"`);
    expect(res.text).not.toMatch(new RegExp(`src="/api/team/photos/${PREFIX}Ginger-photo"`));
  });

  it("has only our own script (PR 1.3.4, team.scriptTags.test.ts) and no inline handler", async () => {
    const res = await get(`/api/team/cats?${mineQ}`);
    expect(res.text.match(/<script\b/g)).toHaveLength(1);
    expect(res.text).toMatch(/<script src="\/api\/team\/assets\/dashboard-grid\.[0-9a-f]{12}\.js" defer><\/script>/);
    expect(res.text.replace(/<style>[\s\S]*?<\/style>/, "")).not.toMatch(/<[a-z][^>]*\son[a-z]+=/i);
  });

  it("puts the filters in 'Filters (n)', with active ones as chips that link to the page without them", async () => {
    const res = await get(`/api/team/cats?${mineQ}&colours=ginger&area=kini`);
    expect(res.text).toContain("<summary>Filters (2)</summary>");
    const chip = /<a class="fchip" href="([^"]+)">Ginger /.exec(res.text);
    expect(chip).not.toBeNull();
    expect(chip![1]).not.toContain("colours=");
    expect(chip![1]).toContain("area=kini");
    const none = await get("/api/team/cats");
    expect(none.text).toContain("<summary>Filters (0)</summary>");
  });

  it("never draws a position, and keeps addresses to short codes", async () => {
    const res = await get(`/api/team/cats?${mineQ}&colours=ginger&area=kini&colony=${colony}`);
    // Other tests' colony names share the database, so leave the pickers out.
    const body = res.text.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<select[\s\S]*?<\/select>/g, "");
    expect(body).not.toMatch(/\d+\.\d{3,}/);
    for (const href of res.text.matchAll(/href="([^"]*\/api\/team\/cats\?[^"]*)"/g)) {
      expect(href[1], href[1]).not.toMatch(/\d+\.\d{3,}/);
    }
  });

  it("pages with a plain 'Show more' link", async () => {
    const bulk = `${PREFIX}bulk-`;
    const [p] = await db.select({ id: photosTable.id }).from(photosTable).where(like(photosTable.publicId, `${PREFIX}Ginger%`));
    await db.insert(catsTable).values(
      Array.from({ length: 50 }, (_, i) => ({
        name: `${bulk}${String(i).padStart(2, "0")}`,
        primaryPhotoId: p!.id,
        lat: 37.4447,
        lng: 24.9417,
        discovererDeviceId: DEVICE,
      })),
    );
    const one = await get(`/api/team/cats?q=${encodeURIComponent(bulk)}&sort=name`);
    expect(one.text).toContain("50 cats match");
    expect(one.text).toMatch(/href="[^"]*page=2[^"]*">Show more</);
    const two = await get(`/api/team/cats?q=${encodeURIComponent(bulk)}&sort=name&page=2`);
    expect(two.text).not.toContain("Show more");
    expect(two.text).toContain("Back to the first cats");
  });

  it("escapes the name box and a hostile cat name", async () => {
    await cat("evil <img src=x onerror=alert(1)>");
    const res = await get(`/api/team/cats?q=${encodeURIComponent(`${PREFIX}evil`)}`);
    expect(res.text).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(res.text).not.toContain("<img src=x");
    const q = await get(`/api/team/cats?q=${encodeURIComponent('"><script>x</script>')}`);
    expect(q.text).not.toContain("<script>x");
  });

  it("is refused to a cat guardian, as today", async () => {
    const res = await get("/api/team/cats", guardian);
    expect(res.status).toBe(403);
    expect(res.text).not.toContain('class="catgrid"');
  });

  it("still gives the JSON search to a caller who asks for JSON", async () => {
    const res = await get(`/api/team/cats?${mineQ}`).set("Accept", "application/json");
    expect(Object.keys(res.body).sort()).toEqual(["query", "results"]);
  });

  it("keeps no text under 12px in the grid's own styles", async () => {
    const res = await get("/api/team/cats");
    const sizes = [...res.text.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });
});

describe("the Cats grid in tie mode (choosing a cat for a welfare report)", () => {
  it("each card has a plain 'This is the cat' form, and the filters keep the tie", async () => {
    const r = await seedReport({ publicId: `${PREFIX}r1`, note: "thin cat" });
    const res = await get(`/api/team/cats?tie=${r.publicId}&q=${encodeURIComponent(`${PREFIX}Ginger`)}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Which cat is this?");
    expect(res.text).toContain(`<input type="hidden" name="tie" value="${r.publicId}">`);
    expect(res.text).toContain(`action="/api/team/reports/${r.publicId}/cat"`);
    expect(res.text).toContain(
      `<input type="hidden" name="catId" value="${ginger}"><input type="hidden" name="expectedCatId" value="">`,
    );
    // Only our own grid script (PR 1.3.4); the forms work without it.
    expect(res.text.match(/<script\b/g)).toHaveLength(1);
    // Links that change the filters carry the tie along.
    expect(res.text).toMatch(new RegExp(`class="fchip" href="[^"]*tie=${r.publicId}`));
    // Without a tie there is no such form.
    const plain = await get(`/api/team/cats?q=${encodeURIComponent(`${PREFIX}Ginger`)}`);
    expect(plain.text).not.toContain("This is the cat");
  });

  it("shows a cat who is no longer with us, already tied to the report, with its 'already tied' hint", async () => {
    const gone = await cat("Gone");
    await say(gone, "life_status", { status: "deceased" });
    const r = await seedReport({ publicId: `${PREFIX}r2`, note: "thin cat", catId: gone });
    const q = encodeURIComponent(`${PREFIX}Gone`);
    const tied = await get(`/api/team/cats?tie=${r.publicId}&q=${q}`);
    expect(tied.text).toContain(`href="/api/team/cats/${gone}"`);
    expect(tied.text).toContain("This report is already tied to this cat.");
    // Outside tie mode the same cat is hidden by default.
    const plain = await get(`/api/team/cats?q=${q}`);
    expect(plain.text).not.toContain(`href="/api/team/cats/${gone}"`);
  });

  it("ignores a hostile or unknown tie id", async () => {
    const bad = await get(`/api/team/cats?tie=${encodeURIComponent('"><script>alert(1)</script>')}`);
    expect(bad.status).toBe(200);
    expect(bad.text).not.toContain("<script>alert");
    expect(bad.text).not.toContain("This is the cat");
    const unknown = await get(`/api/team/cats?tie=${PREFIX}nope`);
    expect(unknown.text).toContain("That report couldn't be found.");
  });
});
