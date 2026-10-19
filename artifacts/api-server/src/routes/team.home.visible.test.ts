import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app";
import { signedPerson, type Signed } from "../test/roleKit";
import * as home from "../lib/dashboard/home";

// SYC-396 PR 2.1 (review of #243): the Home route must hand homeData the
// viewer's own colonies, or every Not-seen card would lose its colony name.

vi.mock("../lib/dashboard/home", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/dashboard/home")>();
  return { ...real, homeData: vi.fn(real.homeData) };
});

const RUN = randomBytes(3).toString("hex");
let staff: Signed;

beforeAll(async () => {
  process.env["TEAM_SESSION_KEYS"] = "vitest-home-visible-key-0123456789abcdef-0123456789";
  staff = await signedPerson(`home-visible-${RUN}`, ["staff"]);
});

afterAll(() => {
  delete process.env["TEAM_SESSION_KEYS"];
});

describe("GET /api/team/home passes the viewer's colonies", () => {
  it("homeData gets visibleColonyIds(person): the whole island for the team", async () => {
    const res = await request(app).get("/api/team/home").set("Cookie", staff.cookie);
    expect(res.status).toBe(200);
    const call = vi.mocked(home.homeData).mock.calls.at(-1);
    expect(call?.[2], "the third argument is the viewer's Visible").toBeDefined();
    expect(call?.[2]?.ids).toBeNull();
  });
});
