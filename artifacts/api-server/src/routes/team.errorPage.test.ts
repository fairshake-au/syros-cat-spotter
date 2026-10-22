import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import { removeTestPerson } from "../test/removeTestPerson";
import { signedPerson, type Signed } from "../test/roleKit";
import { STRICT_CSP } from "../test/wideCsp";
import { renderTeamErrorPage, wantsTeamPage, preferredLanguage } from "../lib/teamPages/errorPage";

// SYC-516 C1 (spec 3.1; closes SYC-339): a browser page under /api/team gets a
// friendly page with the dashboard's headers; everything else keeps its JSON.

vi.mock("../lib/teamCatList", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/teamCatList")>()),
  listTeamCats: vi.fn(async () => {
    throw new Error("vitest: the cat list failed");
  }),
}));

const { default: app } = await import("../app");

const KEY = "vitest-errorpage-key-0123456789abcdef-01234567";
let staff: Signed;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  staff = await signedPerson("errorpage-staff", ["staff"]);
});

afterAll(async () => {
  delete process.env["TEAM_SESSION_KEYS"];
  await removeTestPerson(staff.email);
  await pool.end();
});

function headersOk(res: request.Response): void {
  expect(res.headers["content-security-policy"]).toBe(STRICT_CSP);
  expect(res.headers["cache-control"]).toBe("no-store");
  expect(res.headers["x-content-type-options"]).toBe("nosniff");
  expect(res.headers["referrer-policy"]).toBe("same-origin");
}

describe("an unmatched /api/team path", () => {
  it("is a friendly 404 page for a browser navigation", async () => {
    const res = await request(app).get("/api/team/nope").set("Sec-Fetch-Mode", "navigate");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("This page doesn&#39;t exist");
    expect(res.text).toContain('href="/api/team/home"');
    expect(res.text).toContain("Go to the dashboard");
    expect(res.text).not.toContain("<script");
    expect(res.text).not.toContain("/api/team/signout");
    expect(res.text).not.toContain("Signed in as");
    headersOk(res);
  });

  it("is the same for an old browser that only sends Accept: text/html", async () => {
    const res = await request(app).get("/api/team/nope").set("Accept", "text/html,application/xhtml+xml");
    expect(res.status).toBe(404);
    expect(res.text).toContain("The link may be old or mistyped.");
    headersOk(res);
  });

  it("does not read the session: a signed-in person sees no name or menu", async () => {
    const res = await request(app).get("/api/team/nope").set("Sec-Fetch-Mode", "navigate").set("Cookie", staff.cookie);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("Signed in as");
    expect(res.text).not.toContain("<nav");
  });

  it("keeps today's JSON, now with the team headers, for anything else", async () => {
    const res = await request(app).get("/api/team/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
    headersOk(res);
  });

  it("leaves a non-team /api path exactly as it was", async () => {
    const res = await request(app).get("/api/cats/nope").set("Sec-Fetch-Mode", "navigate").set("Accept", "text/html");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
    expect(res.headers["content-security-policy"]).toBeUndefined();
  });
});

describe("a route failure under /api/team", () => {
  it("is a friendly 500 page for a browser opening a page", async () => {
    const res = await request(app)
      .get("/api/team/cats")
      .set("Cookie", staff.cookie)
      .set("Accept", "text/html")
      .set("Sec-Fetch-Mode", "navigate");
    expect(res.status).toBe(500);
    expect(res.text).toContain("Something went wrong on our side");
    expect(res.text).toContain("Please try again in a minute.");
    expect(res.text).not.toContain("may not have been saved");
    expect(res.text).not.toContain("vitest: the cat list failed");
    headersOk(res);
  });

  it("keeps the JSON 500 for a data request, with the headers", async () => {
    const res = await request(app).get("/api/team/cats").set("Cookie", staff.cookie);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Something went wrong. Please try again." });
    headersOk(res);
  });
});

describe("a form too big or garbled to read", () => {
  it("413 for an oversized form post, as a page", async () => {
    const res = await request(app)
      .post("/api/team/anything")
      .set("Sec-Fetch-Mode", "navigate")
      .type("form")
      .send("note=" + "a".repeat(300_000));
    expect(res.status).toBe(413);
    expect(res.text).toContain("may not have been saved");
    headersOk(res);
  });

  it("413 for a data caller keeps its JSON, with the headers", async () => {
    const res = await request(app)
      .post("/api/team/anything")
      .type("form")
      .send("note=" + "a".repeat(300_000));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "This request is too large." });
    headersOk(res);
  });

  it("400 for garbled JSON, as a page", async () => {
    const res = await request(app)
      .post("/api/team/anything")
      .set("Accept", "text/html")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.text).toContain("We couldn&#39;t read that");
    headersOk(res);
  });
});

describe("renderTeamErrorPage", () => {
  it("uses the save wording after a save, and the retry wording otherwise", () => {
    const after = renderTeamErrorPage("broken", { afterSave: true, lang: "en" });
    expect(after).toContain("Your change may not have been saved. Go back and check before trying again.");
    expect(after).not.toContain("Please try again in a minute.");
    const open = renderTeamErrorPage("broken", { afterSave: false, lang: "en" });
    expect(open).toContain("Please try again in a minute.");
  });

  it("draws Greek and French when they are live", async () => {
    const { tr } = await import("../lib/teamPages/strings");
    const el = renderTeamErrorPage("not_found", { afterSave: false, lang: "el", liveLanguages: ["en", "el", "fr"] });
    expect(el).toContain('<html lang="el">');
    expect(el).toContain(tr("el", "error.notFound.title", undefined, ["el"]));
    const fr = renderTeamErrorPage("not_found", { afterSave: false, lang: "fr", liveLanguages: ["en", "el", "fr"] });
    expect(fr).toContain('<html lang="fr">');
    // Not live: English.
    expect(renderTeamErrorPage("not_found", { afterSave: false, lang: "el" })).toContain('<html lang="en">');
  });
});

describe("wantsTeamPage and preferredLanguage", () => {
  const req = (path: string, headers: Record<string, string>) => ({ path, headers }) as never;
  it("needs a team path and a browser", () => {
    expect(wantsTeamPage(req("/api/team/x", { "sec-fetch-mode": "navigate" }))).toBe(true);
    expect(wantsTeamPage(req("/api/team/x", { accept: "text/html" }))).toBe(true);
    expect(wantsTeamPage(req("/api/team/x", { accept: "application/json" }))).toBe(false);
    expect(wantsTeamPage(req("/api/team/x", { "sec-fetch-mode": "cors" }))).toBe(false);
    expect(wantsTeamPage(req("/api/teamx", { "sec-fetch-mode": "navigate" }))).toBe(false);
    expect(wantsTeamPage(req("/api/cats", { "sec-fetch-mode": "navigate" }))).toBe(false);
  });
  it("takes the first of el/fr/en", () => {
    expect(preferredLanguage(req("/", { "accept-language": "de-DE,fr-CH;q=0.9,el" }))).toBe("fr");
    expect(preferredLanguage(req("/", { "accept-language": "el-GR,en;q=0.5" }))).toBe("el");
    expect(preferredLanguage(req("/", {}))).toBe("en");
  });
});
