import type { Request, Response } from "express";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db, findPersonById, heldTypingTable, observationsTable } from "@workspace/db";
import {
  can,
  doorFor,
  holdsStartRow,
  type CapabilityHolder,
} from "../capabilities";
import { seesAny, visibleColonyIds } from "../guardianView";
import type { SessionPayload } from "./session";

// SYC-516 C3 (docs/specs/team-dashboard-ux-fixes.md §3.2, decision 516-B):
// keep what someone typed when their sign-in lapsed mid-save, and give it
// back to the SAME person after they sign in again on that browser.
//
// - Kept only when a genuine expired sign-in says whose it is, and that
//   person is still on the list at that session version (keepTyping).
// - Only the named text boxes of a fixed list of forms (KEEPABLE), each cut
//   to 4,000 characters. Never a hidden field, a position, or a button.
// - 30 minutes at most. The hand-off claims it (takeHeldTyping), the landing
//   page deletes it as it fills the form in (useHeldTyping), someone else
//   signing in deletes it, and deleteStaleHeldTyping clears what is left.
// - A dashboard-only cookie holds the row's random id, nothing else.

export const HELD_COOKIE = "__Host-cs_held";
/** How long typed text is kept, in seconds. */
export const HELD_SECONDS = 30 * 60;
/** How long after the hand-off claims a row the landing page may use it. */
export const CLAIM_SECONDS = 5 * 60;
/** Each kept value is cut to this many characters. */
export const HELD_FIELD_MAX = 4_000;

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = "(\\d{1,9})";
const PUBLIC_ID = "([A-Za-z0-9_-]{1,64})";
const path = (re: string) => new RegExp(`^${re}$`);

/** The body as posted (urlencoded), for reading one field. */
type Body = Record<string, unknown>;

export interface Keepable {
  /** The POST path this entry is for. */
  match: RegExp;
  /** Which form on the landing page it fills in. */
  formKey: (m: RegExpMatchArray) => string;
  /**
   * The page the form was on (never the address it posted to). Null: no
   * page to go back to, so nothing is kept. Reads at most a fixed choice
   * from the body (the "Mark wrong" form's `back`), never what was typed.
   */
  landing: (m: RegExpMatchArray, body: Body) => string | null | Promise<string | null>;
  /** The text boxes kept, by the names the route's zod schema reads. */
  fields: readonly string[];
}

/** The cat a statement is about, for "Mark wrong"'s landing. */
async function catOfStatement(id: number): Promise<number | null> {
  const [row] = await db
    .select({ catId: observationsTable.catId })
    .from(observationsTable)
    .where(eq(observationsTable.id, id));
  return row?.catId ?? null;
}

/**
 * The forms whose typed text is kept (spec §3.2's list), keyed by route.
 * Every field name here is copied from that route's zod schema; a test
 * (heldTyping.test.ts) parses each one through it.
 */
export const KEEPABLE: Record<string, Keepable> = {
  "POST /api/team/reports/:publicId/note": {
    match: path(`/api/team/reports/${PUBLIC_ID}/note`),
    formKey: (m) => `note:${m[1]}`,
    landing: (m) => `/api/team?open=${m[1]}`,
    fields: ["note"],
  },
  "POST /api/team/colonies": {
    match: path("/api/team/colonies"),
    formKey: () => "colony:new",
    landing: () => "/api/team/colonies",
    fields: ["name", "guardianName", "notes"],
  },
  "POST /api/team/colonies/:id": {
    match: path(`/api/team/colonies/${ID}`),
    formKey: (m) => `colony:${m[1]}`,
    landing: (m) => `/api/team/colonies/${m[1]}`,
    fields: ["name", "guardianName", "notes"],
  },
  "POST /api/team/sites/:id": {
    match: path(`/api/team/sites/${ID}`),
    formKey: (m) => `site:${m[1]}`,
    landing: (m) => `/api/team/sites/${m[1]}`,
    fields: ["name", "directions", "notes"],
  },
  "POST /api/team/cats/:id/name": {
    match: path(`/api/team/cats/${ID}/name`),
    formKey: (m) => `name:${m[1]}`,
    landing: (m) => `/api/team/cats/${m[1]}`,
    fields: ["name", "reason"],
  },
  "POST /api/team/cats/:id/died": {
    match: path(`/api/team/cats/${ID}/died`),
    formKey: (m) => `died:${m[1]}`,
    landing: (m) => `/api/team/cats/${m[1]}/died`,
    fields: ["reason"],
  },
  "POST /api/team/cats/:id/life-status": {
    match: path(`/api/team/cats/${ID}/life-status`),
    formKey: (m) => `life:${m[1]}`,
    landing: (m) => `/api/team/cats/${m[1]}`,
    fields: ["reason"],
  },
  "POST /api/team/cats/:id/sterilisation": {
    match: path(`/api/team/cats/${ID}/sterilisation`),
    formKey: (m) => `sterilised:${m[1]}`,
    landing: (m) => `/api/team/cats/${m[1]}`,
    fields: ["reason"],
  },
  "POST /api/team/statements/:id/wrong": {
    match: path(`/api/team/statements/${ID}/wrong`),
    formKey: (m) => `wrong:${m[1]}`,
    landing: async (m, body) => {
      if (body["back"] === "likely") return "/api/team/likely";
      const catId = await catOfStatement(Number(m[1]));
      return catId === null ? null : `/api/team/cats/${catId}?s=${m[1]}`;
    },
    fields: ["reason"],
  },
};

/**
 * The page shapes a kept row may land on, checked on the way in and again
 * on the way out: the dashboard only, no other site, no `//`, no `..`.
 */
const LANDINGS: readonly RegExp[] = [
  path(`/api/team\\?open=${PUBLIC_ID}`),
  path("/api/team/colonies"),
  path(`/api/team/colonies/${ID}`),
  path(`/api/team/sites/${ID}`),
  path(`/api/team/cats/${ID}`),
  path(`/api/team/cats/${ID}\\?s=${ID}`),
  path(`/api/team/cats/${ID}/died`),
  path("/api/team/likely"),
];

export function isKeptLanding(landing: string): boolean {
  return LANDINGS.some((re) => re.test(landing));
}

/** The request's path, without its query. */
const pathOf = (req: Request) => (req.originalUrl ?? req.url ?? "").split("?")[0] ?? "";

/** The form this POST is, if it is one whose text may be kept. */
export function keepableFor(req: Request): { entry: Keepable; m: RegExpMatchArray } | null {
  if (req.method !== "POST") return null;
  const p = pathOf(req);
  for (const entry of Object.values(KEEPABLE)) {
    const m = p.match(entry.match);
    if (m) return { entry, m };
  }
  return null;
}

/** A browser sends a text box's line breaks as CRLF; keep them as LF. */
const lf = (s: string) => s.replace(/\r\n?/g, "\n");

/**
 * The listed text boxes of this form, as typed: strings only, non-empty,
 * each cut to HELD_FIELD_MAX. Nothing else from the body, ever.
 */
export function typedFields(req: Request, entry: Keepable): Record<string, string> {
  const body = (req.body ?? {}) as Body;
  const out: Record<string, string> = {};
  for (const f of entry.fields) {
    if (!Object.hasOwn(body, f)) continue;
    const v = body[f];
    if (typeof v !== "string" || v.trim() === "") continue;
    out[f] = lf(v).slice(0, HELD_FIELD_MAX);
  }
  return out;
}

const cookieValues = (req: Request): string[] => {
  const header = req.headers.cookie;
  if (typeof header !== "string") return [];
  const out: string[] = [];
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() !== HELD_COOKIE) continue;
    out.push(pair.slice(eq + 1).trim());
  }
  return out;
};

/**
 * Keep what was typed, for the person whose expired sign-in this is. True
 * only if the path is in KEEPABLE, the person is still on the list at that
 * session version, and at least one listed box has text. Any older row of
 * theirs goes first. Sets the cookie holding the new row's id.
 */
export async function keepTyping(req: Request, res: Response, who: SessionPayload): Promise<boolean> {
  const found = keepableFor(req);
  if (!found) return false;
  const person = await findPersonById(who.pid);
  if (!person || person.sessionVersion !== who.sv) return false;
  const fields = typedFields(req, found.entry);
  if (Object.keys(fields).length === 0) return false;
  const landing = await found.entry.landing(found.m, (req.body ?? {}) as Body);
  if (landing === null || !isKeptLanding(landing)) return false;
  const id = await db.transaction(async (tx) => {
    await tx.delete(heldTypingTable).where(eq(heldTypingTable.personId, person.id));
    const [row] = await tx
      .insert(heldTypingTable)
      .values({
        personId: person.id,
        sessionVersion: person.sessionVersion,
        formKey: found.entry.formKey(found.m),
        landingPath: landing,
        fields,
      })
      .returning({ id: heldTypingTable.id });
    return row!.id;
  });
  res.cookie(HELD_COOKIE, id, { ...COOKIE_OPTIONS, maxAge: HELD_SECONDS * 1000 });
  return true;
}

/**
 * At the hand-off's normal exit: the kept row this browser points at, if it
 * is this person's, at this session version, under 30 minutes old, with a
 * landing they may open. That row is claimed (not deleted: the landing page
 * deletes it as it fills the form in). Any other row the cookie points at is
 * deleted. The cookie is always cleared when sent.
 */
export async function takeHeldTyping(
  req: Request,
  res: Response,
  person: { id: string; sessionVersion: number },
  mayOpen: (path: string) => boolean | Promise<boolean>,
): Promise<{ id: string; landing: string } | null> {
  const values = cookieValues(req);
  if (values.length === 0) return null;
  res.clearCookie(HELD_COOKIE, COOKIE_OPTIONS);
  for (const value of values) {
    if (!UUID_RE.test(value)) continue;
    const [row] = await db.select().from(heldTypingTable).where(eq(heldTypingTable.id, value));
    if (!row) continue;
    const fresh = Date.now() - row.createdAt.getTime() < HELD_SECONDS * 1000;
    const matches =
      row.personId === person.id &&
      row.sessionVersion === person.sessionVersion &&
      fresh &&
      isKeptLanding(row.landingPath) &&
      (await mayOpen(row.landingPath));
    if (!matches) {
      await db.delete(heldTypingTable).where(eq(heldTypingTable.id, row.id));
      continue;
    }
    const [claimed] = await db
      .update(heldTypingTable)
      .set({ claimedAt: sql`now()` })
      .where(and(eq(heldTypingTable.id, row.id), eq(heldTypingTable.personId, person.id)))
      .returning({ id: heldTypingTable.id });
    if (claimed) return { id: row.id, landing: row.landingPath };
  }
  return null;
}

/** The `?kept=` row id on a landing page, if it is shaped like one. */
const keptId = (req: Request): string | null => {
  const k = req.query["kept"];
  return typeof k === "string" && UUID_RE.test(k) ? k : null;
};

/**
 * On a landing page with `?kept=`: the kept fields for `formKey`, deleted
 * as they are read, only if that row is this person's, for that form, and
 * claimed by a hand-off within the last 5 minutes. Otherwise null, and the
 * page draws as normal.
 */
export async function useHeldTyping(
  req: Request,
  person: { id: string },
  formKey: string,
): Promise<Record<string, string> | null> {
  return (await useHeldTypingFor(req, person, (k) => k === formKey))?.fields ?? null;
}

/** The same, for a page with several forms: `accepts` names the ones it can fill in. */
export async function useHeldTypingFor(
  req: Request,
  person: { id: string },
  accepts: (formKey: string) => boolean,
): Promise<{ formKey: string; fields: Record<string, string> } | null> {
  // A HEAD request shows nothing, so it never uses a row up (every landing
  // route calls through here, so this one check covers them all).
  if (req.method === "HEAD") return null;
  const id = keptId(req);
  if (!id) return null;
  const mine = and(
    eq(heldTypingTable.id, id),
    eq(heldTypingTable.personId, person.id),
    gt(heldTypingTable.claimedAt, sql`now() - make_interval(secs => ${CLAIM_SECONDS})`),
  );
  const [row] = await db.select({ formKey: heldTypingTable.formKey }).from(heldTypingTable).where(mine);
  if (!row || !accepts(row.formKey)) return null;
  const [gone] = await db
    .delete(heldTypingTable)
    .where(and(mine, eq(heldTypingTable.formKey, row.formKey)))
    .returning({ formKey: heldTypingTable.formKey, fields: heldTypingTable.fields });
  if (!gone) return null;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(gone.fields ?? {})) if (typeof v === "string") fields[k] = v;
  return { formKey: gone.formKey, fields };
}

/** Rows older than 30 minutes: deleted by the server's regular tidy-up. */
export async function deleteStaleHeldTyping(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - HELD_SECONDS * 1000);
  const gone = await db
    .delete(heldTypingTable)
    .where(lt(heldTypingTable.createdAt, cutoff))
    .returning({ id: heldTypingTable.id });
  return gone.length;
}

const TIDY_EVERY_MS = 60_000;
let lastTidy = 0;

/** On unless HELD_TYPING_TIDY_ON_REQUEST=off; off under tests unless =on (the outbox's pattern). */
function tidyEnabled(): boolean {
  const flag = process.env["HELD_TYPING_TIDY_ON_REQUEST"];
  if (flag === "off") return false;
  if (flag === "on") return true;
  return process.env["NODE_ENV"] !== "test";
}

/** Express middleware: after a response, at most once a minute, the tidy-up. */
export function opportunisticHeldTypingTidy(
  _req: unknown,
  res: { on(event: "finish", cb: () => void): unknown },
  next: () => void,
): void {
  if (tidyEnabled()) {
    res.on("finish", () => {
      const now = Date.now();
      if (now - lastTidy < TIDY_EVERY_MS) return;
      lastTidy = now;
      void deleteStaleHeldTyping(new Date(now)).catch(() => {
        // A failed tidy-up is retried a minute later; rows are also refused
        // by age when read, so nothing old is ever given back.
      });
    });
  }
  next();
}

/**
 * May this person open the page a kept row lands on? The same doors the
 * GET routes use. Unsure means no: they land on their usual home instead.
 */
export function mayOpenPath(person: CapabilityHolder, landing: string): boolean {
  if (!isKeptLanding(landing)) return false;
  const door = doorFor(person);
  if (door === "out") return false;
  const p = landing.split("?")[0]!;
  if (p === "/api/team/colonies") return seesAny(visibleColonyIds(person)) || holdsStartRow(person);
  if (door !== "in") return false;
  if (p === "/api/team") return can(person, "view_welfare_queue");
  if (/^\/api\/team\/(colonies|sites)\/\d+$/.test(p)) return seesAny(visibleColonyIds(person));
  if (/^\/api\/team\/cats\/\d+$/.test(p)) return can(person, "view_exact_location");
  if (/^\/api\/team\/cats\/\d+\/died$/.test(p)) return can(person, "set_life_status");
  if (p === "/api/team/likely") return can(person, "set_sterilisation");
  return false;
}
