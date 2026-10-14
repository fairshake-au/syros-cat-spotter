import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { addPerson, pool } from "@workspace/db";
import app from "../app";
import router from "./index";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import {
  clearWelfareTables,
  sessionCookieFor,
  TEAM_ORIGIN,
} from "../lib/teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "../test/removeTestPerson";

// SYC-43 part 2 plan, test P1-1 (SYC-42 #27, spec §8.6 #12): every
// /api/team/* route registered on the router answers the identical
// `401 not_signed_in` without a session, and for a person who holds no
// `staff` scope. The routes are read from the router itself, so a route added
// later without requireTeam is caught without anyone remembering to list it.

const EMAIL = "vitest-walk-volunteer@example.com";
const KEY = "vitest-walk-key-0123456789abcdef-0123456789";
const handoffKey = makeKey();
let volunteerCookie: string;

/**
 * The routes that are deliberately open to someone with no session or no
 * staff scope. Anything else under /api/team must refuse them. Keep this list
 * short and give each entry a reason.
 */
const WITHOUT_SESSION_OK: Record<string, string> = {
  "POST /api/team/handoff":
    "the hand-off is how a session starts; it has its own pass checks (team.handoff.test.ts)",
  "POST /api/team/signout":
    "signing out needs no session, only the dashboard's own Origin",
};
const ANY_SIGNED_IN_PERSON_OK: Record<string, string> = {
  "GET /api/team/me": "who is signed in; no capability needed (requireTeam())",
};

/**
 * Routes that check the shape of the body before they check who is asking
 * (observations.ts does, deliberately: the kind picks the capability). With
 * `{}` they would answer 400 whoever sent it, so the walk sends a well-formed
 * body. Any new route like that needs an entry here, or the walk goes red.
 */
const WELL_FORMED_BODIES: Record<string, unknown> = {
  "POST /api/team/observations": {
    catId: 1,
    kind: "life_status",
    value: { status: "street" },
    reason: "walk test",
  },
  "POST /api/team/observations/:id/supersede": {
    value: { clipped: false },
    reason: "walk test",
  },
};

/**
 * The fewest routes a correct walk can find: the part 1 routes (hand-off, the
 * page, /me, sign-out), PR 8's three observation routes, and this part's
 * three (queue JSON, report photo, catalogue photo), PR 2's two (a
 * report's state, a report's team note), PR 3's two (finding a cat, a
 * cat's page), and PR 4's six (life status, sterilisation, rename, mark a
 * statement wrong, the Probably sterilised list, Looks right), and PR 5's
 * one (tying a report to a cat). If an Express upgrade
 * changes `router.stack` and the walk finds fewer, the test fails rather than
 * passing on an empty list. Raise this when a PR adds routes.
 */
const MINIMUM_ROUTES = 23;

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  name?: string;
  handle?: { stack?: Layer[] };
}

function walk(stack: Layer[], out: string[]): void {
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        out.push(`${method.toUpperCase()} /api${layer.route.path}`);
      }
    } else if (layer.handle?.stack) {
      walk(layer.handle.stack, out);
    }
  }
}

function teamRoutes(): string[] {
  const all: string[] = [];
  walk((router as unknown as { stack: Layer[] }).stack, all);
  return all.filter((r) => /^\w+ \/api\/team(\/|$)/i.test(r)).sort();
}

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await clearWelfareTables();
  await removeTestPerson(EMAIL);
  const volunteer = await addPerson({
    email: EMAIL,
    name: "Vera Volunteer",
    addedBy: "cli:vitest",
    roles: ["volunteer"],
  });
  // A volunteer gets no session from the hand-off (SYC-188).
  volunteerCookie = sessionCookieFor(volunteer.id);
});

beforeEach(() => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
});

afterAll(async () => {
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await removeTestPerson(EMAIL);
  await pool.end();
});

function send(route: string, cookie?: string): request.Test {
  const [method, rawPath] = route.split(" ") as [string, string];
  const path = rawPath.replace(/:\w+/g, "1");
  const t = request(app)[method.toLowerCase() as "get" | "post"](path);
  // The right Origin, so it is the session check being tested, not the
  // Origin check that comes before it on a POST.
  if (method === "POST")
    t.set("Origin", TEAM_ORIGIN).send(WELL_FORMED_BODIES[route] ?? {});
  if (cookie) t.set("Cookie", cookie);
  return t;
}

describe("P1-1: every /api/team route refuses the unauthorised the same way", () => {
  it("finds at least the routes this part is known to have", () => {
    const routes = teamRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(MINIMUM_ROUTES);
    for (const known of [
      "POST /api/team/handoff",
      "GET /api/team",
      "GET /api/team/me",
      "POST /api/team/signout",
      "GET /api/team/reports",
      "GET /api/team/report-photos/:publicId",
      "GET /api/team/photos/:publicId",
      "POST /api/team/reports/:publicId/state",
      "POST /api/team/reports/:publicId/note",
      "POST /api/team/reports/:publicId/cat",
      "GET /api/team/cats",
      "GET /api/team/cats/:id",
      "POST /api/team/cats/:id/life-status",
      "POST /api/team/cats/:id/sterilisation",
      "POST /api/team/cats/:id/name",
      "POST /api/team/statements/:id/wrong",
      "GET /api/team/likely",
      "POST /api/team/likely/:id/looks-right",
      "POST /api/team/photos/:publicId/hide",
      "POST /api/team/photos/:publicId/restore",
    ]) {
      expect(routes).toContain(known);
    }
    // Every exception names a route that exists, so a stale entry can't hide.
    for (const r of [
      ...Object.keys(WITHOUT_SESSION_OK),
      ...Object.keys(ANY_SIGNED_IN_PERSON_OK),
    ]) {
      expect(routes).toContain(r);
    }
  });

  it("answers 401 not_signed_in with no session", async () => {
    for (const route of teamRoutes()) {
      if (route in WITHOUT_SESSION_OK) continue;
      const res = await send(route);
      expect([res.status, res.text], `${route} without a session`).toEqual([
        401,
        '{"error":"not_signed_in"}',
      ]);
    }
  });

  it("answers the identical 401 to a signed-in person who has no staff scope", async () => {
    for (const route of teamRoutes()) {
      if (route in WITHOUT_SESSION_OK || route in ANY_SIGNED_IN_PERSON_OK)
        continue;
      const res = await send(route, volunteerCookie);
      expect(
        [res.status, res.text],
        `${route} for a person with no staff scope`,
      ).toEqual([401, '{"error":"not_signed_in"}']);
    }
  });
});
