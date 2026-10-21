import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { pool } from "@workspace/db";
import app from "../app";
import router from "./index";
import { makeKey } from "../lib/teamAuth/__fixtures__/mint";
import { TEAM_ORIGIN } from "../lib/teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "../test/removeTestPerson";
import { expectedCsp } from "../test/wideCsp";
import { assetUrl } from "../lib/teamAssets";
import { ASSET_CACHE } from "./teamAssets";
import { COMING_SOON } from "../lib/teamPages/homePage";
import { invitePerson } from "@workspace/db";
import { inviteCookieFor } from "../test/inviteKit";
import {
  endPlacements,
  guardianOn,
  leftPerson,
  newColony,
  pendingPerson,
  seedCat,
  signedPerson,
  starterPerson,
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
  | "ended"
  | "invitee"
  // SYC-439: a cat guardian with no colony yet. Only her own pages, the
  // Colonies list and Create a colony; the 403 with her own line everywhere
  // else, never "access has ended".
  | "guardianNone";

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
  "invitee",
  "guardianNone",
];

/** What a kind of person gets from a route. */
type Outcome =
  | "pass" // through every check about who they are (any status but 401 and 403)
  | "forbidden" // the 403: "That part of the dashboard is for the Syros Cats team"
  | "management" // the 403 a team member gets on management's pages: "…is for Syros Cats management"
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
  // SYC-53 PR 1.1: someone invited (a guardian on colony A, the message
  // sent), with the invitee session the hand-off gives her. It is never a
  // team session: every team route answers it with the sign-in 401, the
  // photo route for her own colony's cat included (T9).
  invitee: "signin",
  guardianNone: "forbidden",
};

/**
 * SYC-53 PR 1.3, "My page" and its buttons: about yourself, so any accepted
 * person gets through, even one who holds nothing any more. Not yet joined
 * (pending, or the invitee's own cookie) or left: the sign-in 401.
 */
const OWN_PAGES: Partial<Record<Kind, Outcome>> = {
  team: "pass",
  management: "pass",
  guardianOne: "pass",
  guardianTwo: "pass",
  guardianEvery: "pass",
  pending: "signin",
  left: "signin",
  nothing: "pass",
  ended: "pass",
  invitee: "signin",
  guardianNone: "pass",
};

/**
 * The accept page's routes (PR 1.1): only the invitee acts there. A joined
 * person (any team session that is current, even one who holds nothing any
 * more) is sent home with a 303 and nothing changes; no session, a forged
 * pending one, or a left one gets the sign-in 401.
 */
const ACCEPT_PAGE: Partial<Record<Kind, Outcome>> = {
  team: "pass",
  management: "pass",
  guardianOne: "pass",
  guardianTwo: "pass",
  guardianEvery: "pass",
  pending: "signin",
  left: "signin",
  nothing: "pass",
  ended: "pass",
  invitee: "pass",
  // A joined starter is sent home, as any joined person is.
  guardianNone: "pass",
};

/** manage_people is management's alone: the team is refused like a guardian. */
const MANAGEMENT_ONLY: Partial<Record<Kind, Outcome>> = { team: "management" };

/** A page that only shows colonies or sites (SYC-209 PR 4.1): every cat guardian enters. */
const SEEING: Partial<Record<Kind, Outcome>> = {
  guardianOne: "pass",
  guardianTwo: "pass",
  guardianEvery: "pass",
};

interface Row {
  /** Who may: the capability and where, in words, for the reader. */
  why: string;
  /**
   * The route CHANGES the signed-in person (stop helping, sign out
   * everywhere), so the walk calls it as a brand-new person of the same kind
   * each time, never as the shared one.
   */
  fresh?: true;
  /**
   * A named exemption from "never cached", honoured on a 200 only: this one route may instead answer
   * with exactly this Cache-Control when it serves its picture (a refusal or a
   * 404 is still no-store). For the photo versions only (SYC-396 PR 1.2).
   */
  mayCache?: string;
  /** Overrides on TEAM_ONLY. */
  except?: Partial<Record<Kind, Outcome>>;
}

/**
 * THE TABLE. Every route under /api/team and /api/internal, and who gets
 * through. A route that isn't here fails the walk.
 */
const TABLE: Record<string, Row> = {
  "GET /api/team": { why: "the welfare queue: view_welfare_queue, island-only" },
  "GET /api/team/home": { why: "Home (SYC-396 PR 2.1): view_welfare_queue, island-only, so every cat guardian gets the 403" },
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
  "GET /api/team/photos/:publicId/:size": {
    why: "a small or medium version of a catalogue photo: the photo route's checks, through the same helper (here a cat in colony A)",
    except: { guardianOne: "pass", guardianTwo: "pass", guardianEvery: "pass" },
    mayCache: "private, no-cache",
  },
  "POST /api/team/reports/:publicId/state": { why: "change_report_state, island-only" },
  "POST /api/team/reports/:publicId/note": { why: "add_team_note, island-only" },
  "POST /api/team/reports/:publicId/cat": { why: "change_report_state, island-only" },
  "GET /api/team/cats": { why: "the island-wide cat list: view_exact_location with no target, so island-only" },
  "GET /api/team/cats/find": { why: "Find from a photo's form and count (SYC-396 PR 2.5): find_cat_from_photo, island-only, so every cat guardian gets the 403" },
  "POST /api/team/cats/find": { why: "Find from a photo's search: find_cat_from_photo, island-only; the walk's form has no photo, so the team gets a 400 and no search runs" },
  "POST /api/team/cats/map": { why: "the island Map's button-map moves, for a browser with no script (SYC-396 PR 1.5): view_exact_location with no target" },
  "POST /api/team/cats/positions": { why: "the island map's cat positions (SYC-396 PR 1.5): view_exact_location with no target, so island-only" },
  "GET /api/team/cats/:id": { why: "the team's cat page: view_exact_location with no target (a guardian's own page is PR 2.1's)" },
  "POST /api/team/cats/:id/life-status": { why: "set_life_status with no target, island-only" },
  "GET /api/team/cats/:id/died": { why: "the \"This cat has died\" page (SYC-513): set_life_status with no target, island-only" },
  "POST /api/team/cats/:id/died": { why: "records a death (SYC-513): set_life_status with no target, island-only" },
  "POST /api/team/cats/:id/sterilisation": { why: "set_sterilisation with no target, island-only" },
  "POST /api/team/cats/:id/name": { why: "rename_cat, island-only" },
  "POST /api/team/cats/:id/remove-owner": { why: "remove_owner, island-only" },
  "POST /api/team/statements/:id/wrong": { why: "the door, then the statement kind's capability inside, island-only" },
  // SYC-2 PR 3.1: colour and markings. Island-only here; a cat guardian's own
  // routes, with her cat's colony as the target, are SYC-2 PR 5.1's.
  "POST /api/team/cats/:id/appearance/confirm": { why: "set_appearance with no target, island-only" },
  "POST /api/team/cats/:id/appearance/correct": { why: "set_appearance with no target, island-only" },
  "GET /api/team/colour-check": { why: "the Colour check list: set_appearance with no target, island-only" },
  "GET /api/team/likely": { why: "set_sterilisation with no target" },
  "POST /api/team/likely/:id/looks-right": { why: "set_sterilisation with no target" },
  "POST /api/team/photos/:publicId/hide": { why: "hide_photo, island-only" },
  "POST /api/team/photos/:publicId/restore": { why: "restore_photo, island-only" },
  // SYC-209 PR 4.1 (spec §7.3): the pages that only SHOW colonies and sites let in
  // anyone who sees some colony (visibleColonyIds), filtered by it in SQL; the walk's
  // made-up ids are then simply not found (404), as another colony's would be.
  // Every write keeps its capability with no target, so stays the team's until PR 4.2.
  "GET /api/team/colonies": {
    why: "her own colonies (filtered): sees some colony (visibleColonyIds), or a cat guardian with no colony yet (SYC-439: an empty list and the create form)",
    except: { ...SEEING, guardianNone: "pass" },
  },
  "GET /api/team/colonies/:id": { why: "one colony, filtered in the query: sees some colony; another colony is 404", except: SEEING },
  "POST /api/team/colonies": {
    why: "create_colony (own scope): a cat guardian creates one and is placed on it (SYC-209 PR 4.2); one with no colony yet creates her first (SYC-439)",
    except: { guardianOne: "pass", guardianTwo: "pass", guardianEvery: "pass", guardianNone: "pass" },
    // A real create would turn the walk's starter into a guardian partway through.
    fresh: true,
  },
  "POST /api/team/colonies/:id": { why: "edit_colony on that colony (PR 4.2), rename_colony island-only; a colony that isn't hers, or isn't one, is the same 403" },
  "GET /api/team/colonies/:id/cats": { why: "the Add cats search: sees some colony, then assign_cat_to_colony on the colony read from the record", except: SEEING },
  "POST /api/team/colonies/:id/cats": { why: "assign_cat_to_colony on the colony the cats go into (PR 4.2); a colony that isn't hers, or isn't one, is the same 403" },
  // SYC-209 PR 4.3: "Recent changes by cat guardians" on its own. Team-only.
  "GET /api/team/guardian-changes": { why: "view_guardian_changes: island-only, so every cat guardian gets the 403" },
  // SYC-396 PR 2.4: the Areas page and its one form route. Team-only.
  "GET /api/team/insights": { why: "the Reports list (SYC-396 PR 3.3a): view_reports with no target, so island rows only; every cat guardian gets the 403 until SYC-472" },
  "GET /api/team/insights/:report": { why: "one report: view_reports with no target, island rows only; the walk's :report is no report, so the team gets a 404" },
  "GET /api/team/insights/:report.csv": { why: "a report's spreadsheet: export_report, island-only; the walk's :report is no report, so the team gets a 404 and nothing is recorded" },
  "GET /api/team/areas": { why: "edit_named_areas: island-only, so every cat guardian gets the 403" },
  "POST /api/team/areas": { why: "edit_named_areas: island-only; the walk's empty form is a 400 for the team, and changes nothing" },
  // SYC-396 PR 3.1b: the Vet settings page and its one form route. Team-only.
  "GET /api/team/vet-settings": { why: "edit_vet_settings: island-only, so every cat guardian gets the 403" },
  "POST /api/team/vet-settings": { why: "edit_vet_settings: island-only; the walk's empty form is a 400 for the team, and changes nothing" },
  "POST /api/team/cats/:id/colony": { why: "assign_cat_to_colony on the colony it goes into, or for a take-out the one it leaves, from the record (PR 4.2); an unreadable form has no colony" },
  // SYC-209 PR 3.1, the team map. Never the door's "any colony" check. The Map page and its
  // tap stay the team's; the picture route opens to anyone who sees a colony (PR 4.1: a
  // picture is the island only, never a site).
  "GET /api/team/map": { why: "the team's map page: view_exact_location with no target" },
  "POST /api/team/map": { why: "zoom, pan, areas on the team's map page: view_exact_location with no target" },
  "POST /api/team/map/tap": { why: "a tap on the team's map page: view_exact_location with no target" },
  "GET /api/team/map-tiles/:tile": { why: "a map picture: sees some colony (PR 4.1); the walk's token is unreadable, so 404", except: SEEING },
  // SYC-396 PR 1.5, the island map's squares: team-only (the Map is the team's in phase 1).
  "POST /api/team/map-squares": { why: "tokens for the island map's squares: view_exact_location with no target, so island-only" },
  "GET /api/team/map-square/:token": {
    why: "one island map square by its token: view_exact_location with no target; the walk's token is unreadable, so 404",
    mayCache: "private, max-age=86400",
  },
  // SYC-209 PR 3.2 and PR 4.1, the Feeding sites pages.
  "GET /api/team/sites": { why: "the Feeding sites page, filtered: sees some colony", except: SEEING },
  "POST /api/team/sites/map": { why: "zoom, pan, areas on the Feeding sites page, filtered: sees some colony", except: SEEING },
  "GET /api/team/sites/:id": { why: "one site, filtered in the query: sees some colony; another colony's site is 404", except: SEEING },
  // SYC-209 PR 3.3, adding, moving, retiring and changing the colony of a feeding site.
  // PR 4.2: the add pages open to anyone who may add a site to a colony they see; each
  // one-site write is checked against that site's own colony. Never canSomewhere.
  "GET /api/team/sites/new": { why: "the add-a-site map: sees some colony, and add_feeding_site on one of them", except: { guardianOne: "pass", guardianTwo: "pass", guardianEvery: "pass" } },
  "POST /api/team/sites/new/map": { why: "zoom, pan, areas on the add page: sees some colony, and add_feeding_site on one of them", except: { guardianOne: "pass", guardianTwo: "pass", guardianEvery: "pass" } },
  "POST /api/team/sites/pick": { why: "a tap or typed position, answers with the confirmation: sees some colony, and add_feeding_site on one of them", except: { guardianOne: "pass", guardianTwo: "pass", guardianEvery: "pass" } },
  "POST /api/team/sites": { why: "save a new site: the add door, then add_feeding_site on the colony it goes into (a guardian's must be hers)", except: { guardianOne: "pass", guardianTwo: "pass", guardianEvery: "pass" } },
  "POST /api/team/sites/:id": { why: "edit name, notes, how to find it: edit_feeding_site on the site's own colony, from the record (PR 4.2)" },
  "POST /api/team/sites/:id/colony": { why: "change a site's colony: reassign_feeding_site (island-only by kind)" },
  "POST /api/team/sites/:id/retire": { why: "retire a site: edit_feeding_site on the site's own colony, from the record (PR 4.2)" },
  "POST /api/team/sites/:id/restore": { why: "bring a site back: edit_feeding_site on the site's own colony, from the record (PR 4.2)" },
  "GET /api/team/sites/:id/move": { why: "the move picker: edit_feeding_site on the site's own colony, from the record (PR 4.2)" },
  "POST /api/team/sites/:id/move/map": { why: "zoom, pan, areas on the move page: edit_feeding_site on the site's own colony, from the record (PR 4.2)" },
  "POST /api/team/sites/:id/move/pick": { why: "a tap or typed position, answers with the confirmation: edit_feeding_site on the site's own colony, from the record (PR 4.2)" },
  // PR 4.1: both sighting buttons check against the sighting's CAT's colony, from the record.
  // The walk names no sighting, so there is no colony: only the team passes.
  "POST /api/team/sites/from-sighting": { why: "'Make a feeding site here': add_feeding_site and view_exact_location on the sighting's cat's colony" },
  "POST /api/team/sites/map-at-sighting": { why: "'Show on our map': view_exact_location on the sighting's cat's colony" },
  "POST /api/team/sites/:id/move": { why: "save a move, with its reason: edit_feeding_site on the site's own colony, from the record (PR 4.2)" },
  // The two JSON observation routes (review minor 1): the door, then the
  // capability inside; a guardian refused there gets the JSON 403.
  "POST /api/team/observations": { why: "the door, then set_life_status / set_sterilisation inside, island-only" },
  "POST /api/team/observations/:id/supersede": { why: "the door, then the statement kind's capability inside" },
  "GET /api/team/observations/review/likely": { why: "set_sterilisation with no target" },
  // SYC-53 PR 1.2, the People screen: manage_people, island-only (management alone).
  "GET /api/team/people": { why: "the People list: manage_people, management only", except: MANAGEMENT_ONLY },
  "GET /api/team/people/:id/roles": { why: "the change-roles form: manage_people", except: MANAGEMENT_ONLY },
  "GET /api/team/people/:id/bring-back": { why: "the bring-back form: manage_people", except: MANAGEMENT_ONLY },
  "POST /api/team/people/invite": { why: "invite someone: manage_people", except: MANAGEMENT_ONLY },
  "POST /api/team/people/:id/resend": { why: "resend an invitation: manage_people", except: MANAGEMENT_ONLY },
  "POST /api/team/people/:id/withdraw": { why: "withdraw an invitation: manage_people", except: MANAGEMENT_ONLY },
  "POST /api/team/people/:id/roles": { why: "change roles and colonies: manage_people", except: MANAGEMENT_ONLY },
  "POST /api/team/people/:id/left": { why: "mark as left: manage_people", except: MANAGEMENT_ONLY },
  "POST /api/team/people/:id/sign-out": { why: "sign out everywhere: manage_people", except: MANAGEMENT_ONLY },
  "POST /api/team/people/:id/bring-back": { why: "bring someone back: manage_people", except: MANAGEMENT_ONLY },
  // SYC-53 PR 1.3, "My page" and "My colonies": any accepted person, no capability.
  "GET /api/team/my": { why: "My page: any accepted person (requireTeam with no capability)", except: OWN_PAGES },
  "GET /api/team/my/colonies": { why: "My colonies: any accepted person", except: OWN_PAGES },
  // SYC-53 PR 2.1: her colony and her cats. The door only (anyone who may
  // enter); inside, view_exact_location with the record's target decides
  // between her view and the public one, and another colony is not found.
  "GET /api/team/my/colonies/:id": { why: "her colony page: the door, then view_exact_location for that colony inside", except: { guardianOne: "pass", guardianTwo: "pass", guardianEvery: "pass" } },
  "GET /api/team/my/cats/:id": { why: "one cat: the door, then her view or the public view by the cat's colony from the record", except: { guardianOne: "pass", guardianTwo: "pass", guardianEvery: "pass" } },
  "POST /api/team/my/cats/:id/sterilisation": { why: "she says sterilised or not (PR 2.2): the door and Origin, then set_sterilisation for the cat's colony from the record, under a lock", except: { guardianOne: "pass", guardianTwo: "pass", guardianEvery: "pass" } },
  "POST /api/team/my/cats/:id/life-status": { why: "she says homed, in care or died, or puts back her own change (PR 2.2): the door and Origin, then set_life_status for the cat's colony from the record, under a lock", except: { guardianOne: "pass", guardianTwo: "pass", guardianEvery: "pass" } },
  "GET /api/team/my/stop-helping": { why: "the 'are you sure?' page: any accepted person; changes nothing", except: OWN_PAGES },
  "POST /api/team/my/language": { why: "change my language: any accepted person, Origin checked", except: OWN_PAGES },
  "POST /api/team/my/sign-out-everywhere": { why: "sign myself out everywhere: any accepted person, Origin checked", except: OWN_PAGES, fresh: true },
  "POST /api/team/my/stop-helping": { why: "stop helping: any accepted person, Origin checked", except: OWN_PAGES, fresh: true },
  // SYC-53 PR 1.1, the accept page: requireInvitee, never a capability.
  "GET /api/team/my/welcome": { why: "the accept page: an invitee's own session only (requireInvitee)", except: ACCEPT_PAGE },
  "POST /api/team/my/accept": { why: "Yes, join: requireInvitee and the dashboard's Origin", except: ACCEPT_PAGE },
  "POST /api/team/my/decline": { why: "No, this isn't for me: requireInvitee and the dashboard's Origin", except: ACCEPT_PAGE },
  // SYC-45 Slice 1: the nightly news check's review list. Staff only.
  "GET /api/team/news-changes": { why: "use_workspace: island-only, so every cat guardian gets the 403 (teamNews.test.ts)" },
  "POST /api/team/news-changes/:id/review": { why: "use_workspace: island-only, Origin checked (teamNews.test.ts)" },
};

/** Routes with their own checks instead of a person's session. */
const OWN_CHECKS: Record<string, string> = {
  "POST /api/team/handoff": "how a session starts; its own pass checks (team.handoff.test.ts)",
  "POST /api/team/signout": "needs no session, only the dashboard's own Origin",
  "POST /api/internal/people/allowed": "the sign-in Worker's bearer token (internal.people.test.ts)",
  "POST /api/internal/mail/drain": "the drain timer's bearer token (internalMail.test.ts)",
  "POST /api/internal/coat/sweep": "the drain timer's bearer token, SYC-161 Decision D1 (internalCoat.test.ts)",
  "POST /api/internal/resend/webhook": "Resend's signature, no token (reports.reporterEmail.test.ts, prelaunchGate.test.ts)",
  "POST /api/internal/news/nightly": "the news check's own bearer token, SYC-45 (news/nightly.test.ts)",
  "GET /api/internal/news/last-run": "the news check's own bearer token, SYC-45 (news/nightly.test.ts)",
};

/**
 * Routes that need no session at all: the same public bytes for everyone
 * (SYC-396 PR 1.3.4). Each names the one Cache-Control its 200 may carry,
 * which the walk allows for that route, by name, and for no other.
 */
const PUBLIC_BYTES: Record<string, { why: string; path: () => string; mayCache: string }> = {
  "GET /api/team/assets/:file": {
    why: "first-party scripts, public bytes: only hashed names from the manifest (team.assets.test.ts)",
    path: () => assetUrl("dashboard-grid.js") ?? "/api/team/assets/missing",
    mayCache: ASSET_CACHE,
  },
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
  "POST /api/team/my/cats/:id/sterilisation": { sterilised: "yes" },
  "POST /api/team/my/cats/:id/life-status": { status: "in_care", reason: "walk test" },
  // A range off Syros: a well-formed ask that gets no tokens.
  "POST /api/team/map-squares": { z: 14, xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
};

/**
 * The fewest routes a correct walk can find: the table plus the four with
 * their own checks. If an Express upgrade changes `router.stack` and the walk
 * finds fewer, the test fails rather than passing on an empty list.
 */
const MINIMUM_ROUTES = 80; // 76, plus SYC-396 PR 1.5's four map routes

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
let catInA: SeededCat & { colonyId: number; otherColony: number };

beforeAll(async () => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  const colonyA = await newColony("walk-A");
  const colonyB = await newColony("walk-B");
  catInA = { ...(await seedCat(colonyA)), colonyId: colonyA, otherColony: colonyB };
  // A real picture, so the photo-version route is walked through its 200 (and its cache header) too.
  const jpeg = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#284" } }).jpeg().toBuffer();
  await pool.query("update photos set data = $1 where id = $2", [jpeg.toString("base64"), catInA.photoId]);
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
  // An invitee: a guardian on colony A, invited and the message delivered
  // (written directly, as the outbox would), with her invitee session.
  const inv = await invitePerson(people.management.id, {
    email: `vitest-walk-invitee-${Date.now()}@example.com`,
    name: "Vt walk invitee",
    placements: [{ role: "guardian", colonyId: colonyA }],
    language: "en",
    languageUsed: "en",
  });
  await pool.query(`update people set invite_sent_at = now() where id = $1`, [inv.id]);
  people.invitee = { id: inv.id, email: inv.email, cookie: inviteCookieFor(inv.id, 1) };
  people.guardianNone = await starterPerson("walk-gnone");
});

beforeEach(() => {
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
});

afterAll(async () => {
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  for (const p of Object.values(people)) await removeTestPerson(p.email);
  for (const email of freshMade) await removeTestPerson(email);
  await pool.end();
});

/** The path the walk calls: a real photo for the photo route, otherwise ids that don't exist. */
function pathFor(route: string): string {
  const raw = route.split(" ")[1]!;
  if (route === "GET /api/team/photos/:publicId") {
    return `/api/team/photos/${catInA.photoPublicId}`;
  }
  if (route === "GET /api/team/photos/:publicId/:size") {
    return `/api/team/photos/${catInA.photoPublicId}/small`;
  }
  return raw.replace(/:\w+/g, NO_SUCH);
}

let freshCount = 0;
const freshMade: string[] = [];

/**
 * A brand-new person of this kind, for a route that changes the person it is
 * called as. The kinds that can't be changed this way (not signed in, pending,
 * left, an invitee) keep their shared cookie.
 */
async function freshCookie(kind: Kind): Promise<string> {
  const n = ++freshCount;
  const colonyA = catInA.colonyId;
  let who: Signed;
  switch (kind) {
    case "team":
      who = await signedPerson(`walk-f${n}-team`, ["staff"]);
      break;
    case "management":
      who = await signedPerson(`walk-f${n}-mgmt`, ["staff"]);
      await pool.query("update person_scopes set role = 'management' where person_id = $1", [who.id]);
      break;
    case "guardianOne":
      who = await guardianOn(`walk-f${n}-g1`, [colonyA]);
      break;
    case "guardianTwo":
      who = await guardianOn(`walk-f${n}-g2`, [colonyA, catInA.otherColony]);
      break;
    case "guardianEvery": {
      const every = (await pool.query<{ id: number }>("select id from colonies order by id")).rows.map((r) => r.id);
      who = await guardianOn(`walk-f${n}-gall`, every);
      break;
    }
    case "nothing":
      who = await signedPerson(`walk-f${n}-vet`, ["vet"]);
      break;
    case "ended":
      who = await guardianOn(`walk-f${n}-ended`, [colonyA]);
      await endPlacements(who.id);
      break;
    case "guardianNone":
      who = await starterPerson(`walk-f${n}-gnone`);
      break;
    default:
      return people[kind].cookie;
  }
  freshMade.push(who.email);
  return who.cookie;
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
        r in TABLE || r in OWN_CHECKS || r in PUBLIC_BYTES,
        `${r} is not in the route walk's table: say who may use it`,
      ).toBe(true);
    }
    // Every row names a route that exists, so a stale row can't hide.
    for (const r of [...Object.keys(TABLE), ...Object.keys(OWN_CHECKS), ...Object.keys(PUBLIC_BYTES)]) {
      expect(routes, `the table names ${r}, which isn't registered`).toContain(r);
    }
  });

  it("P1-1: every route answers the identical 401 not_signed_in without a session", async () => {
    for (const route of walkedRoutes()) {
      if (route in OWN_CHECKS || route in PUBLIC_BYTES) continue;
      const res = await send(route);
      expect([res.status, res.text], `${route} without a session`).toEqual([
        401,
        '{"error":"not_signed_in"}',
      ]);
      expect(res.headers["x-content-type-options"], `${route} without a session: nosniff`).toBe("nosniff");
    }
  });

  it("review 4: every answer under /api/team is nosniff, even one no route gives", async () => {
    for (const route of [...walkedRoutes(), "GET /api/team/no-such-page", "POST /api/team/no/such/thing"]) {
      if (!/ \/api\/team(\/|$)/.test(route)) continue;
      // Signed in on GETs only: some POSTs change the person they're sent as.
      for (const cookie of route.startsWith("GET ") ? [undefined, people.team.cookie] : [undefined]) {
        const res = await send(route, cookie);
        expect(res.headers["x-content-type-options"], `${route} (${cookie ? "team" : "no session"})`).toBe("nosniff");
      }
    }
  });

  for (const kind of KINDS) {
    it(`every route answers ${kind} as the table says (JSON and browser)`, async () => {
      for (const route of walkedRoutes()) {
        if (!(route in TABLE)) continue;
        const want = expected(route, kind);
        const fresh = TABLE[route]!.fresh === true;
        const json = await send(route, fresh ? await freshCookie(kind) : people[kind].cookie);
        const page = await send(route, fresh ? await freshCookie(kind) : people[kind].cookie, true);
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
            // SYC-439: a cat guardian with no colony yet is pointed at her first one.
            expect(page.text, where).toContain(
              kind === "guardianNone" ? "You can create your first colony here" : "Your colonies are here",
            );
            expect(page.text, where).not.toContain("Please sign in again.");
            break;
          case "management":
            expect([json.status, json.text], where).toEqual([403, '{"error":"forbidden"}']);
            expect(page.status, where).toBe(403);
            expect(page.text, where).toContain("That part of the dashboard is for Syros Cats management.");
            expect(page.text, where).not.toContain("Please sign in again.");
            break;
          case "ended":
            expect([json.status, json.text], where).toEqual([403, '{"error":"forbidden"}']);
            expect(page.status, where).toBe(403);
            expect(page.text, where).toContain("Your access has ended.");
            break;
        }
        // Every dashboard answer, refusal or not, is never cached.
        const allowed = ["no-store", ...(TABLE[route]!.mayCache && json.status === 200 ?[TABLE[route]!.mayCache!] : [])];
        expect(allowed, `${where}: cache-control ${String(json.headers["cache-control"])}`).toContain(
          json.headers["cache-control"],
        );
        // SYC-396 PR 1.3.4: the strict security header on every answer, but
        // an exempt route's own page (test/wideCsp.ts WIDE_CSP_ROUTES). A
        // route that widens it without being named there fails here.
        expect(json.headers["content-security-policy"], `${where}: security header`).toBe(expectedCsp(route, json));
        // Review 4: never sniffed as another type, refusal or not.
        expect(json.headers["x-content-type-options"], `${where}: nosniff`).toBe("nosniff");
        expect(page.headers["x-content-type-options"], `${where} (browser): nosniff`).toBe("nosniff");
        expect(page.headers["content-security-policy"], `${where} (browser): security header`).toBe(
          expectedCsp(route, page),
        );
      }
    });
  }

  it("the routes that need no session give everyone the same public bytes, cached only as named, with no cookie", async () => {
    for (const [route, row] of Object.entries(PUBLIC_BYTES)) {
      const none = await request(app).get(row.path());
      expect(none.status, `${route}: ${row.why}`).toBe(200);
      expect(none.headers["cache-control"], route).toBe(row.mayCache);
      expect(none.headers["set-cookie"], route).toBeUndefined();
      for (const kind of KINDS) {
        const res = await request(app).get(row.path()).set("Cookie", people[kind].cookie);
        expect([res.status, res.headers["cache-control"], res.text], `${route} as ${kind}`).toEqual([
          200,
          row.mayCache,
          none.text,
        ]);
        expect(res.headers["set-cookie"], `${route} as ${kind}`).toBeUndefined();
        expect(res.headers["x-content-type-options"], `${route} as ${kind}`).toBe("nosniff");
      }
      // Anything not a file it serves is a 404 that is never cached.
      const missing = await send(route);
      expect([missing.status, missing.headers["cache-control"]], `${route}, no such file`).toEqual([404, "no-store"]);
    }
  });

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
    expect(page.text).toContain('href="/api/team/my/colonies">Your colonies are here</a>');
    expect(page.text).not.toContain("Welfare queue");
    expect(page.text).toContain("Sign out");
  });
});

describe("Home's Coming soon line (SYC-396 PR 2.1)", () => {
  // A feature whose route is in the TABLE has arrived: the PR that built it
  // must take it off Home's "Coming soon" line in the same change.
  it("names no feature whose route already exists", () => {
    const arrived = COMING_SOON.filter((f) => f.route in TABLE).map((f) => `${f.label} (${f.route})`);
    expect(arrived, "remove these from COMING_SOON in lib/teamPages/homePage.ts").toEqual([]);
  });

  it("lists every route in the same form as the TABLE's keys", () => {
    for (const f of COMING_SOON) expect(f.route).toMatch(/^(GET|POST) \/api\/team\//);
  });
});
