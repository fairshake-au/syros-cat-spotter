import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { markLeft } from "@workspace/db";
import app from "../app";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "../test/removeTestPerson";
import { guardianOn, newColony, seedCat, signedPerson, type SeededCat, type Signed } from "../test/roleKit";

// SYC-602 PR 4, Review Focus 5: team notes never leave the team. A cat
// guardian's cat page, the public cat API and the guardian JSON never contain
// a team note's text; neither does any other page that lists cats, colonies,
// news or reports. The same pages are read by the team too where they could
// carry it, and the team's cat page and its JSON DO carry it, so each
// "absent" below can't pass because the note was never written.

const RUN = randomBytes(3).toString("hex");
const KEY = "vitest-noteleak-key-0123456789abcdef-01234567";
const JSON_ACCEPT = { Accept: "application/json" };
const MARKER = `TNLEAK${RUN}`;
const NOTE = `${MARKER} limping on the left, ask the vet <b>soon</b>`;

let colony: number;
let otherColony: number;
let cat: SeededCat;
let team: Signed;
let eleni: Signed; // guardian of the cat's colony
let maria: Signed; // guardian of another colony
let noteId: number;

const get = (path: string, cookie?: string, json = false) => {
  const r = request(app).get(path);
  if (cookie) r.set("Cookie", cookie);
  if (json) r.set(JSON_ACCEPT);
  return r;
};

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  colony = await newColony("noteleak-A");
  otherColony = await newColony("noteleak-B");
  eleni = await guardianOn("noteleak-eleni", [colony]);
  maria = await guardianOn("noteleak-maria", [otherColony]);
  team = await signedPerson("noteleak-team", ["staff"]);
  cat = await seedCat(colony);
  // Through the real route, as the team writes one.
  const res = await request(app)
    .post(`/api/team/cats/${cat.id}/note`)
    .set("Origin", TEAM_ORIGIN)
    .set("Cookie", team.cookie)
    .type("form")
    .send({ text: NOTE });
  expect(res.status).toBe(303);
  const json = await get(`/api/team/cats/${cat.id}`, team.cookie, true);
  noteId = json.body.history.find((h: { kind: string }) => h.kind === "team_note").id;
});

beforeEach(() => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
});

afterAll(async () => {
  for (const p of [eleni, maria]) await removeTestPerson(p.email);
  await markLeft(team.email, "cli:vitest");
  delete process.env["TEAM_SESSION_KEYS"];
});

describe("a team note is on the team's cat page, and nowhere else (Review Focus 5)", () => {
  it("is on the island-wide team member's cat page, as the Health note and in the history, escaped", async () => {
    const page = await get(`/api/team/cats/${cat.id}`, team.cookie);
    expect(page.status).toBe(200);
    expect(page.text).toContain(MARKER);
    expect(page.text).toContain("<dt>Health note</dt>");
    expect(page.text).toContain(`id="s-${noteId}"`);
    expect(page.text).toContain("&lt;b&gt;soon&lt;/b&gt;");
    expect(page.text).not.toContain("<b>soon</b>");
    const json = await get(`/api/team/cats/${cat.id}`, team.cookie, true);
    expect(JSON.stringify(json.body)).toContain(MARKER);
  });

  it("is not in the public cat API: the cat, the list, or its sightings", async () => {
    const one = await get(`/api/cats/${cat.id}`);
    expect(one.status).toBe(200);
    expect(one.text).not.toContain(MARKER);
    expect(one.text).not.toContain("team_note");
    const list = await get(`/api/cats`);
    expect(list.status).toBe(200);
    expect(list.text).not.toContain(MARKER);
  });

  it("is not on a cat guardian's cat page, nor in the guardian JSON, for a guardian of the cat's colony", async () => {
    const html = await get(`/api/team/my/cats/${cat.id}`, eleni.cookie);
    expect(html.status).toBe(200);
    expect(html.text).not.toContain(MARKER);
    expect(html.text).not.toContain("Health note");
    expect(html.text).not.toContain("team only");
    const json = await get(`/api/team/my/cats/${cat.id}`, eleni.cookie, true);
    expect(json.status).toBe(200);
    expect(json.body.view).toBe("guardian");
    expect(json.text).not.toContain(MARKER);
    expect(json.text).not.toContain("team_note");
    expect(json.text).not.toContain("Health note");
  });

  it("is not in what a guardian of another colony gets for the cat (the public view)", async () => {
    for (const json of [false, true]) {
      const res = await get(`/api/team/my/cats/${cat.id}`, maria.cookie, json);
      expect(res.status).toBe(200);
      expect(res.text).not.toContain(MARKER);
    }
  });

  it("a cat guardian cannot open the team's cat page at all, as a page or as JSON", async () => {
    for (const json of [false, true]) {
      const res = await get(`/api/team/cats/${cat.id}`, eleni.cookie, json);
      expect(res.status).toBeGreaterThanOrEqual(300);
      expect(res.text).not.toContain(MARKER);
    }
    const signedOut = await get(`/api/team/cats/${cat.id}`);
    expect(signedOut.text).not.toContain(MARKER);
  });

  it("is on no guardian page that lists her cats, colonies or changes", async () => {
    // Two team lists are not hers to open (the documented 403); every other page is a 200 she reads.
    const refused = new Set(["/api/team/cats", "/api/team/guardian-changes"]);
    for (const path of [
      "/api/team/my",
      "/api/team/my/colonies",
      `/api/team/my/colonies/${colony}`,
      `/api/team/colonies/${colony}`,
      `/api/team/colonies/${colony}/cats`,
      "/api/team/cats",
      "/api/team/guardian-changes",
    ]) {
      for (const json of [false, true]) {
        const res = await get(path, eleni.cookie, json);
        const label = `${path} ${json ? "json" : "html"} (${res.status})`;
        expect(res.status, label).toBe(refused.has(path) ? 403 : 200);
        expect(res.text, label).not.toContain(MARKER);
      }
    }
  });

  it("is on no other team page that lists cats, news, reports or colonies, even for the team", async () => {
    // Every page is a 200 the team reads, but the guardian-changes page as HTML, which sends the team on (303); its JSON is the 200.
    for (const path of [
      "/api/team",
      "/api/team/home",
      "/api/team/cats",
      `/api/team/colonies/${colony}`,
      `/api/team/colonies/${colony}/cats`,
      "/api/team/colonies",
      "/api/team/news-changes",
      "/api/team/guardian-changes",
      "/api/team/issues",
      "/api/team/reports",
      "/api/team/likely",
      "/api/team/colour-check",
      "/api/team/map",
      "/api/team/sites",
    ]) {
      for (const json of [false, true]) {
        const res = await get(path, team.cookie, json);
        const label = `${path} ${json ? "json" : "html"} (${res.status})`;
        expect(res.status, label).toBe((path === "/api/team/guardian-changes" && !json) || path === "/api/team/map" ? 303 : 200);
        expect(res.text, label).not.toContain(MARKER);
      }
    }
  });
});
