import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import { removeTestPerson } from "../test/removeTestPerson";
import { signedPerson, type Signed } from "../test/roleKit";
import { STRICT_CSP } from "../test/wideCsp";

// SYC-396 PR 1.3.4 (adversarial review, finding 2): the wider security
// header goes only on the finished grid page. If building the list fails,
// the 500 that goes out carries the strict header, exactly.

vi.mock("../lib/teamCatList", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/teamCatList")>()),
  listTeamCats: vi.fn(async () => {
    throw new Error("vitest: the cat list failed");
  }),
}));

const { default: app } = await import("../app");

const KEY = "vitest-griderror-key-0123456789abcdef-01234567";
let staff: Signed;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = KEY;
  staff = await signedPerson("griderror-staff", ["staff"]);
});

afterAll(async () => {
  delete process.env["TEAM_SESSION_KEYS"];
  await removeTestPerson(staff.email);
  await pool.end();
});

describe("a failure while building the grid", () => {
  it("answers 500 with exactly the strict security header", async () => {
    const res = await request(app)
      .get("/api/team/cats")
      .set("Cookie", staff.cookie)
      .set("Accept", "text/html")
      .set("Sec-Fetch-Mode", "navigate");
    expect(res.status).toBe(500);
    expect(res.headers["content-security-policy"]).toBe(STRICT_CSP);
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});
