import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../app";
import router from "./index";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "../test/removeTestPerson";
import {
  endPlacements,
  guardianOn,
  leftPerson,
  newColony,
  pendingPerson,
  seedCat,
  signedPerson,
  type SeededCat,
  type Signed,
} from "../test/roleKit";

// T1, the route walk (roles-and-invites.md §6.4 and §15.3 tests 1 to 3;
// SYC-53 PR 0.5). Every route registered under /api/team and /api/internal
// is read FROM THE ROUTER (with a minimum count, so an empty walk fails),
// and called by every kind of person. Each answer is compared with the
// table below, and A ROUTE NOT IN THE TABLE FAILS: a new route can't ship
// until someone has written down who may use it.
//
// It also keeps SYC-43 part 2's P1-1: every route answers the identical
// `401 not_signed_in` without a session.
//
// The kinds of person: the team; management alone; a cat guardian on one
// colony; one on two; one placed on EVERY colony that exists (T3); someone
// invited who hasn't accepted; someone who has left; someone whose roles
// grant nothing (a vet, reserved); and a guardian whose every placement has
// ended (review minor 2). Not signed in, a pending or a left person gets the
// sign-in 401. A signed-in person refused gets the 403: the "That part is
// for the team" page for a browser, `{"error":"forbidden"}` otherwise. One
// who holds nothing at all gets the "Your access has ended" 403.

const KEY = "vitest-walk-key-0123456789abcdef-0123456789";
const handoffKey = makeKey();

type Kind =
  | "team"
  | "management"
  | "guardianOne"
  | "guardianTwo"
  | "guardianEvery"
  | "pending"
  | "left"
  | "nothing"
  | "ended";

const KINDS: Kind[] = [
  "team",
  "management",
  "guardianOne",
  "guardianTwo",
  "guardianEvery",
  "pending",
  "left",
  "nothing",
  "ended",
];

/** What a kind of person gets from a route. */
type Outcome =
  | "pass" // through every check about who they are (any status but 401 and 403)
  | "forbidden" // the 403: "That part of the dashboard is for the Syros Cats team"
  | "ended" // the 403: "Your access has ended"
  | "signin"; // the sign-in 401

const GUARDIANS: Kind[] = ["guardianOne", "guardianTwo", "guardianEvery"];

/** Everything signed-in-but-refused, and not signed in, as for a team-only page. */
const TEAM_ONLY: Partial<Record<Kind, Outcome>> = {
  team: "pass",
  management: "pass",
  guardianOne: "forbidden",
  guardianTwo: "forbidden",
  guardianEvery: "forbidden",
  pending: "signin",
  left: "signin",
  nothing: "ended",
  ended: "ended",
};

interface Row {
  /** Who may: the capability and where, in words, for the reader. */
  why: string;
  /** Overrides on TEAM_ONLY. */
  except?: Partial<Record<Kind, Outcome>>;
}

/**
 * THE TABLE. Every route under /api/team and /api/internal, and who gets
 * through. A route that isn't here fails the walk.
 */
const TABLE: Record<string, Row> = {
  "GET /api/team": { why: "the welfare queue: view_welfare_queue, island-only" },
  "GET /api/team/me": {
    why: "who is signed in: the dashboard door, no capability",
    except: { guardianOne: "pass", guardianTwo: "pass", guardianEvery: "pass" },
  },
  "GET /api/team/reports": { why: "the queue as JSON: view_welfare_queue" },
  "GET /api/team/report-photos/:publicId": { why: "a reporter's photo: view_welfare_queue" },
  "GET /api/team/photos/:publicId": {
    why: "a catalogue photo: view_exact_location for the photo's cats' colonies (here a cat in colony A)",
    except: { guardianOne: "pass", guardianTwo: "pass", guardianEvery: "pass" },
  },
  "POST /api/team/reports/:publicId/state": { why: "change_report_state, island-only" },
  "POST /api/team/reports/:publicId/note": { why: "add_team_note, island-only" },
  "POST /api/team/reports/:publicId/cat": { why: "change_report_state, island-only" },
  "GET /api/team/cats": { why: "the island-wide cat list: view_exact_location with no target, so island-only" },
  "GET /api/team/cats/:id": { why: "the team's cat page: view_exact_location with no target (a guardian's own page is PR 2.1's)" },
  "POST /api/team/cats/:id/life-status": { why: "set_life_status with no target, island-only" },
  "POST /api/team/cats/:id/sterilisation": { why: "set_sterilisation with no target, island-only" },
  "POST /api/team/cats/:id/name": { why: "rename_cat, island-only" },
  "POST /api/team/cats/:id/remove-owner": { why: "remove_owner, island-only" },
  "POST /api/team/statements/:id/wrong": { why: "the door, then the statement kind's capability inside, island-only" },
  "GET /api/team/likely": { why: "set_sterilisation with no target" },
  "POST /api/team/likely/:id/looks-right": { why: "set_sterilisation with no target" },
  "POST /api/team/photos/:publicId/hide": { why: "hide_photo, island-only" },
  "POST /api/team/photos/:publicId/restore": { why: "restore_photo, island-only" },
  "GET /api/team/colonies": { why: "every colony: view_exact_location with no target until SYC-209 PR 4.1" },
  "GET /api/team/colonies/:id": { why: "one colony, team notes: view_exact_location with no target until SYC-209 PR 4.1" },
  "POST /api/team/colonies": { why: "create_colony, insisting on an island row until PR 1.1 places a guardian on hers" },
  "POST /api/team/colonies/:id": { why: "edit_colony / rename_colony with no target until SYC-209 PR 4.1" },
  "GET /api/team/colonies/:id/cats": { why: "assign_cat_to_colony with no target until SYC-209 PR 4.1 (Decision 1A)" },
  "POST /api/team/colonies/:id/cats": { why: "assign_cat_to_colony with no target until SYC-209 PR 4.1 (Decision 1A)" },
  "POST /api/team/cats/:id/colony": { why: "assign_cat_to_colony with no target until SYC-209 PR 4.1 (Decision 1A)" },
  // SYC-209 PR 3.1, the team map. Never the door's "any colony" check: a guardian's map is
  // PR 4.1's, filtered by site with each site's colony as the target.
  "GET /api/team/map": { why: "the map page: view_exact_location with no target until SYC-209 PR 4.1" },
  "POST /api/team/map": { why: "zoom, pan, areas: view_exact_location with no target until SYC-209 PR 4.1" },
  "POST /api/team/map/tap": { why: "a tap on the map: view_exact_location with no target until SYC-209 PR 4.1" },
  "GET /api/team/map-tiles/:tile": { why: "a map picture: view_exact_location with no target until SYC-209 PR 4.1" },
  // SYC-209 PR 3.2, the Feeding sites pages (read-only). Team-only, no target, until PR 4.1.
  "GET /api/team/sites": { why: "the Feeding sites page: view_exact_location with no target until SYC-209 PR 4.1" },
  "POST /api/team/sites/map": { why: "zoom, pan, areas on the Feeding sites page: view_exact_location with no target until SYC-209 PR 4.1" },
  "GET /api/team/sites/:id": { why: "one site, its history and positions: view_exact_location with no target until SYC-209 PR 4.1" },
  // SYC-209 PR 3.3, adding, moving, retiring and changing the colony of a feeding site.
  // Team-only, no target, until PR 4.1 (Decision 1A). Never canSomewhere.
  "GET /api/team/sites/new": { why: "the add-a-site map: add_feeding_site with no target until SYC-209 PR 4.1" },
  "POST /api/team/sites/new/map": { why: "zoom, pan, areas on the add page: add_feeding_site with no target until SYC-209 PR 4.1" },
  "POST /api/team/sites/pick": { why: "a tap or typed position, answers with the confirmation: add_feeding_site with no target until SYC-209 PR 4.1" },
  "POST /api/team/sites": { why: "save a new site: add_feeding_site with no target until SYC-209 PR 4.1" },
  "POST /api/team/sites/:id": { why: "edit name, notes, how to find it: edit_feeding_site with no target until SYC-209 PR 4.1" },
  "POST /api/team/sites/:id/colony": { why: "change a site's colony: reassign_feeding_site (island-only by kind)" },
  "POST /api/team/sites/:id/retire": { why: "retire a site: edit_feeding_site with no target until SYC-209 PR 4.1" },
  "POST /api/team/sites/:id/restore": { why: "bring a site back: edit_feeding_site with no target until SYC-209 PR 4.1" },
  "GET /api/team/sites/:id/move": { why: "the move picker: edit_feeding_site with no target until SYC-209 PR 4.1" },
  "POST /api/team/sites/:id/move/map": { why: "zoom, pan, areas on the move page: edit_feeding_site with no target until SYC-209 PR 4.1" },
  "POST /api/team/sites/:id/move/pick": { why: "a tap or typed position, answers with the confirmation: edit_feeding_site with no target until SYC-209 PR 4.1" },
  "POST /api/team/sites/:id/move": { why: "save a move, with its reason: edit_feeding_site with no target until SYC-209 PR 4.1" },
  // The two JSON observation routes (review minor 1): the door, then the
  // capability inside; a guardian refused there gets the JSON 403.
  "POST /api/team/observations": { why: "the door, then set_life_status / set_sterilisation inside, island-only" },
  "POST /api/team/observations/:id/supersede": { why: "the door, then the statement kind's capability inside" },
  "GET /api/team/observations/review/likely": { why: "set_sterilisation with no target" },
};

/** Routes with their own checks instead of a person's session. */
const OWN_CHECKS: Record<string, string> = {
  "POST /api/team/handoff": "how a session starts; its own pass checks (team.handoff.test.ts)",
  "POST /api/team/signout": "needs no session, only the dashboard's own Origin",
  "POST /api/internal/people/allowed": "the sign-in Worker's bearer token (internal.people.test.ts)",
  "POST /api/internal/mail/drain": "the drain timer's bearer token (internalMail.test.ts)",
  "POST /api/internal/resend/webhook": "Resend's signature, no token (reports.reporterEmail.test.ts, prelaunchGate.test.ts)",
};

/**
 * Routes that check the shape of the body before who is asking
 * (observations.ts does, deliberately: the kind picks the capability). With
 * `{}` they would answer 400 whoever sent it, so the walk sends a
 * well-formed body, about a cat and a statement that don't exist, so the
 * team's calls write nothing.
 */
const NO_SUCH = "999999999";
const WELL_FORMED_BODIES: Record<string, unknown> = {
  "POST /api/team/observations": {
    catId: Number(NO_SUCH),
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
 * The fewest routes a correct walk can find: the table plus the four with
 * their own checks. If an Express upgrade changes `router.stack` and the walk
 * finds fewer, the test fails rather than passing on an empty list.
 */
const MINIMUM_ROUTES = 49;

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
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

function walkedRoutes(): string[] {
  const all: string[] = [];
  walk((router as unknown as { stack: Layer[] }).stack, all);
  return [...new Set(all.filter((r) => /^\w+ \/api\/(team|internal)(\/|$)/i.test(r)))].sort();
}

const people = {} as Record<Kind, Signed>;
let catInA: SeededCat;

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  const colonyA = await newColony("walk-A");
  const colonyB = await newColony("walk-B");
  catInA = await seedCat(colonyA);
  people.team = await signedPerson("walk-team", ["staff"]);
  people.management = await signedPerson("walk-mgmt", ["staff"]);
  await pool.query("update person_scopes set role = 'management' where person_id = $1", [
    people.management.id,
  ]);
  people.guardianOne = await guardianOn("walk-g1", [colonyA]);
  people.guardianTwo = await guardianOn("walk-g2", [colonyA, colonyB]);
  // T3: on every colony that exists.
  const every = (await pool.query<{ id: number }>("select id from colonies order by id")).rows.map((r) => r.id);
  people.guardianEvery = await guardianOn("walk-gall", every);
  people.pending = await pendingPerson("walk-pending");
  people.left = await leftPerson("walk-left");
  people.nothing = await signedPerson("walk-vet", ["vet"]);
  people.ended = await guardianOn("walk-ended", [colonyA]);
  await endPlacements(people.ended.id);
});

beforeEach(() => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
});

afterAll(async () => {
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  for (const p of Object.values(people)) await removeTestPerson(p.email);
  await pool.end();
});

/** The path the walk calls: a real photo for the photo route, otherwise ids that don't exist. */
function pathFor(route: string): string {
  const raw = route.split(" ")[1]!;
  if (route === "GET /api/team/photos/:publicId") {
    return `/api/team/photos/${catInA.photoPublicId}`;
  }
  return raw.replace(/:\w+/g, NO_SUCH);
}

function send(route: string, cookie?: string, browser = false): request.Test {
  const method = route.split(" ")[0]!.toLowerCase() as "get" | "post";
  const t = request(app)[method](pathFor(route));
  // The right Origin, so it is the session check being tested, not the
  // Origin check that comes before it on a POST.
  if (method === "post") t.set("Origin", TEAM_ORIGIN).send(WELL_FORMED_BODIES[route] ?? {});
  if (cookie) t.set("Cookie", cookie);
  if (browser) t.set("Sec-Fetch-Mode", "navigate");
  return t;
}

const expected = (route: string, kind: Kind): Outcome =>
  TABLE[route]!.except?.[kind] ?? TEAM_ONLY[kind]!;

describe("T1: the route walk", () => {
  it("finds every route, and every route is in the table or has its own checks", () => {
    const routes = walkedRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(MINIMUM_ROUTES);
    for (const r of routes) {
      expect(
        r in TABLE || r in OWN_CHECKS,
        `${r} is not in the route walk's table: say who may use it`,
      ).toBe(true);
    }
    // Every row names a route that exists, so a stale row can't hide.
    for (const r of [...Object.keys(TABLE), ...Object.keys(OWN_CHECKS)]) {
      expect(routes, `the table names ${r}, which isn't registered`).toContain(r);
    }
  });

  it("P1-1: every route answers the identical 401 not_signed_in without a session", async () => {
    for (const route of walkedRoutes()) {
      if (route in OWN_CHECKS) continue;
      const res = await send(route);
      expect([res.status, res.text], `${route} without a session`).toEqual([
        401,
        '{"error":"not_signed_in"}',
      ]);
    }
  });

  for (const kind of KINDS) {
    it(`every route answers ${kind} as the table says (JSON and browser)`, async () => {
      for (const route of walkedRoutes()) {
        if (!(route in TABLE)) continue;
        const want = expected(route, kind);
        const cookie = people[kind].cookie;
        const json = await send(route, cookie);
        const page = await send(route, cookie, true);
        const where = `${route} as ${kind} (expected ${want})`;
        switch (want) {
          case "pass":
            expect([401, 403], `${where}: got ${json.status} ${String(json.text ?? "").slice(0, 80)}`).not.toContain(json.status);
            expect([401, 403], `${where} (browser)`).not.toContain(page.status);
            // Through the checks and answered, not crashed (review finding 10).
            expect(json.status, `${where}: ${json.status}`).toBeLessThan(500);
            expect(page.status, `${where} (browser): ${page.status}`).toBeLessThan(500);
            break;
          case "signin":
            expect([json.status, json.text], where).toEqual([401, '{"error":"not_signed_in"}']);
            expect(page.status, where).toBe(401);
            expect(page.text, where).toContain("Please sign in again.");
            break;
          case "forbidden":
            expect([json.status, json.text], where).toEqual([403, '{"error":"forbidden"}']);
            expect(page.status, where).toBe(403);
            expect(page.text, where).toContain("That part of the dashboard is for the Syros Cats team.");
            expect(page.text, where).toContain("Your colonies are here");
            expect(page.text, where).not.toContain("Please sign in again.");
            break;
          case "ended":
            expect([json.status, json.text], where).toEqual([403, '{"error":"forbidden"}']);
            expect(page.status, where).toBe(403);
            expect(page.text, where).toContain("Your access has ended.");
            break;
        }
        // Every dashboard answer, refusal or not, is never cached.
        expect(json.headers["cache-control"], where).toBe("no-store");
      }
    });
  }

  it("the routes with their own checks give a session no say: every kind gets the same answer as no session", async () => {
    for (const route of Object.keys(OWN_CHECKS)) {
      if (route === "POST /api/team/signout") continue; // 204 for anyone; tested in team.session.test.ts
      const none = await send(route);
      for (const kind of KINDS) {
        const res = await send(route, people[kind].cookie);
        expect([res.status, res.text], `${route} as ${kind}`).toEqual([none.status, none.text]);
      }
    }
  });
});

describe("T3 (routes): a guardian on every colony that exists still can't reach the island's pages", () => {
  it("the welfare queue, the report list, a reporter's photo and the cat list all refuse her", async () => {
    for (const route of [
      "GET /api/team",
      "GET /api/team/reports",
      "GET /api/team/report-photos/:publicId",
      "GET /api/team/cats",
      "GET /api/team/cats/:id",
    ]) {
      const res = await send(route, people.guardianEvery.cookie);
      expect([res.status, res.text], route).toEqual([403, '{"error":"forbidden"}']);
    }
  });
});

describe("T2: a person who may enter but lacks the capability gets the 403, never the sign-in 401", () => {
  it("on every capability-gated route, as a guardian (JSON and browser)", async () => {
    for (const route of Object.keys(TABLE)) {
      if (expected(route, "guardianOne") !== "forbidden") continue;
      const json = await send(route, people.guardianOne.cookie);
      expect(json.status, route).toBe(403);
      expect(json.text, route).not.toContain("not_signed_in");
      const page = await send(route, people.guardianOne.cookie, true);
      expect(page.status, route).toBe(403);
      expect(page.text, route).not.toContain('http-equiv="refresh"');
    }
  });

  it("the 403 page is a quiet, uncached dashboard page with no team menu for a guardian", async () => {
    const page = await send("GET /api/team", people.guardianOne.cookie, true);
    expect(page.status).toBe(403);
    expect(page.headers["content-type"]).toMatch(/^text\/html/);
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(page.text).toContain('href="/api/team/me">Your colonies are here</a>');
    expect(page.text).not.toContain("Welfare queue");
    expect(page.text).toContain("Sign out");
  });
});
