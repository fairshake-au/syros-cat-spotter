import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { guidanceVersion } from "@workspace/welfare-guidance";
import app from "../app";

// SYC-42 plan, Slice 0 item 0.3: GET /api/welfare/guidance?lang= serves the
// guidance file with an ETag, behind the pre-launch gate like the rest of /api.

describe("GET /api/welfare/guidance", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("serves the requested language with the vet list and the Municipality", async () => {
    const res = await request(app).get("/api/welfare/guidance?lang=el");
    expect(res.status).toBe(200);
    expect(res.body.language).toBe("el");
    expect(res.body.version).toBe(guidanceVersion());
    expect(res.body.copy.urgent.send).toContain("Syros Cats");
    expect(res.body.vets).toHaveLength(3);
    expect(res.body.municipality.phone.tel).toBe("+302281361000");
  });

  it("falls back to English for a missing or unknown language", async () => {
    const a = await request(app).get("/api/welfare/guidance");
    const b = await request(app).get("/api/welfare/guidance?lang=xx");
    expect(a.body.language).toBe("en");
    expect(b.body.language).toBe("en");
  });

  it("sends an ETag and answers 304 when it matches", async () => {
    const first = await request(app).get("/api/welfare/guidance?lang=fr");
    const etag = first.headers["etag"];
    expect(etag).toBeTruthy();
    expect(first.headers["cache-control"]).toMatch(/no-cache/);
    const again = await request(app)
      .get("/api/welfare/guidance?lang=fr")
      .set("If-None-Match", etag);
    expect(again.status).toBe(304);
  });

  it("each language has its own ETag", async () => {
    const en = await request(app).get("/api/welfare/guidance?lang=en");
    const fr = await request(app).get("/api/welfare/guidance?lang=fr");
    expect(en.headers["etag"]).not.toBe(fr.headers["etag"]);
  });

  it("sits behind the pre-launch gate", async () => {
    process.env["PRELAUNCH_GATE"] = "on";
    process.env["PRELAUNCH_SESSION_KEYS"] = Buffer.alloc(32, 7).toString("base64url");
    process.env["PRELAUNCH_TESTER_KEYS"] = "tester-key-for-guidance-test";
    const refused = await request(app).get("/api/welfare/guidance?lang=en");
    expect(refused.status).toBe(401);
    const ok = await request(app)
      .get("/api/welfare/guidance?lang=en")
      .set("X-Prelaunch-Key", "tester-key-for-guidance-test");
    expect(ok.status).toBe(200);
  });
});
