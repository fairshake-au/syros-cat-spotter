import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { catsTable, db, deviceCredentialsTable, markLeft, observationsTable, pool } from "@workspace/db";
import app from "../app";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { syrNumber } from "../lib/teamCatView";
import { TEAM_DESK_DEVICE } from "../lib/teamDesk";
import { guardianOn, newColony, putInColony, signedPerson, type Signed } from "../test/roleKit";

// SYC-677 D, Task 12: a cat Syros Cats left for spotters to name reads "No
// name yet" wherever the team and a cat guardian see it, and the team's
// existing Rename the cat form names it (clearing name_pending).

// Letters only: a cat name can't hold 5 digits in a row (SYC-709), and a
// hex tag sometimes does, which made this file fail at random.
const RUN = [...randomBytes(4)].map((b) => "bcdfghjkmpqrvwxz"[b % 16]).join("");
const NAME = `VtCatName${RUN}`;
const KEY = "vitest-catname-key-0123456789abcdef-0123456789";
const SECRET = "vitest-catname-device-secret-aaaa";
const DEVICE = `vitest-catname-${RUN}-spotter`;
const handoffKey = makeKey();

const madeCats: number[] = [];
const people: Signed[] = [];
let team: Signed;
let guardian: Signed;
let colonyId: number;
let ipN = 0;
const freshIp = () => `2001:db8:6771:${(++ipN).toString(16)}::1`;

async function pendingCat(): Promise<number> {
  const [c] = await db
    .insert(catsTable)
    .values({
      name: `${NAME}tmp${madeCats.length}`,
      description: "",
      primaryPhotoId: 0,
      lat: 37.445,
      lng: 24.942,
      discovererDeviceId: TEAM_DESK_DEVICE,
    })
    .returning({ id: catsTable.id });
  await db.update(catsTable).set({ name: syrNumber(c!.id), namePending: true }).where(eq(catsTable.id, c!.id));
  madeCats.push(c!.id);
  return c!.id;
}

const rename = (catId: number, name: string, cookie = team.cookie) =>
  request(app)
    .post(`/api/team/cats/${catId}/name`)
    .set("Origin", TEAM_ORIGIN)
    .set("Cookie", cookie)
    .type("form")
    .send({ name, reason: "Syros Cats chose it" });

const get = (path: string, cookie = team.cookie) => request(app).get(path).set("Cookie", cookie);

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  team = await signedPerson("catname-team", ["staff"]);
  colonyId = await newColony("catname");
  guardian = await guardianOn("catname-guardian", [colonyId]);
  people.push(team, guardian);
  await request(app).get(`/api/profiles/${DEVICE}`).set("X-Device-Secret", SECRET);
});

afterAll(async () => {
  if (madeCats.length) await db.delete(catsTable).where(inArray(catsTable.id, madeCats));
  await db.delete(deviceCredentialsTable).where(like(deviceCredentialsTable.deviceId, `${DEVICE}%`));
  for (const p of people) await markLeft(p.email, "cli:vitest").catch(() => undefined);
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await pool.end();
});

describe("No name yet", () => {
  it("shows on the grid card, and the SYR number beside it", async () => {
    const id = await pendingCat();
    const res = await get(`/api/team/cats?q=${syrNumber(id)}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("No name yet");
    expect(res.text).toContain(syrNumber(id));
  });

  it("heads the team cat page 'No name yet · SYR-…' and offers 'Name this cat'", async () => {
    const id = await pendingCat();
    const res = await get(`/api/team/cats/${id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`No name yet · ${syrNumber(id)}`);
    expect(res.text).toContain("Name this cat");
    expect(res.text).not.toContain("Rename the cat");
    // The name's own field starts empty, not as the SYR number.
    expect(res.text).not.toMatch(new RegExp(`id="rn-name"[^>]*value="${syrNumber(id)}"`));
  });

  it("shows in the team's colony list and the cat guardian's own planner", async () => {
    const id = await pendingCat();
    await putInColony(id, colonyId);
    const teamPage = await get(`/api/team/colonies/${colonyId}`);
    expect(teamPage.status).toBe(200);
    expect(teamPage.text).toContain("No name yet");
    const mine = await get(`/api/team/my/colonies/${colonyId}`, guardian.cookie);
    expect(mine.status).toBe(200);
    expect(mine.text).toContain("No name yet");
  });

  it("shows in the Add cats search", async () => {
    const id = await pendingCat();
    const res = await get(`/api/team/colonies/${colonyId}/cats?q=${syrNumber(id)}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("No name yet");
    expect(res.text).toContain(syrNumber(id));
  });

  it("a named cat shows its name, not the words", async () => {
    const id = await pendingCat();
    expect((await rename(id, `${NAME}Mimi`)).status).toBe(303);
    const res = await get(`/api/team/cats/${id}`);
    expect(res.text).toContain(`${NAME}Mimi`);
    expect(res.text).toContain("Rename the cat");
    expect(res.text).not.toContain("No name yet");
  });
});

describe("The team names a cat", () => {
  it("clears name_pending in the same write as the name, and a spotter then gets 409 ALREADY_NAMED", async () => {
    const id = await pendingCat();
    const res = await rename(id, `${NAME}Kiki`);
    expect(res.status).toBe(303);
    const [row] = await db.select().from(catsTable).where(eq(catsTable.id, id));
    expect(row!.name).toBe(`${NAME}Kiki`);
    expect(row!.namePending).toBe(false);
    const names = await db.select().from(observationsTable).where(eq(observationsTable.catId, id));
    expect(names.filter((o) => o.kind === "name")).toHaveLength(1);

    const spotter = await request(app)
      .post(`/api/cats/${id}/name`)
      .set("X-Device-Secret", SECRET)
      .set("X-Forwarded-For", freshIp())
      .send({ deviceId: DEVICE, name: `${NAME}Other` });
    expect(spotter.status).toBe(409);
    expect(spotter.body.code).toBe("ALREADY_NAMED");
  });

  it("refuses a SYR-shaped name, and the cat stays pending", async () => {
    const id = await pendingCat();
    for (const bad of [syrNumber(id), "syr42", "SYR-7"]) {
      const res = await rename(id, bad);
      expect(res.status).toBe(400);
      expect(res.text).toContain("That looks like a cat&#39;s SYR number. Choose a name.");
    }
    const [row] = await db.select().from(catsTable).where(eq(catsTable.id, id));
    expect(row!.namePending).toBe(true);
    expect(row!.name).toBe(syrNumber(id));
  });

  it("a name another cat has is refused and the cat stays pending", async () => {
    const a = await pendingCat();
    const b = await pendingCat();
    expect((await rename(a, `${NAME}Twin`)).status).toBe(303);
    const res = await rename(b, `${NAME}TWIN`);
    expect(res.status).toBe(409);
    const [row] = await db.select().from(catsTable).where(eq(catsTable.id, b));
    expect(row!.namePending).toBe(true);
  });

  it("a cat guardian can't use the route", async () => {
    const id = await pendingCat();
    await putInColony(id, colonyId);
    const res = await rename(id, `${NAME}Nope`, guardian.cookie);
    expect(res.status).toBe(403);
    const [row] = await db.select().from(catsTable).where(eq(catsTable.id, id));
    expect(row!.namePending).toBe(true);
  });
});
