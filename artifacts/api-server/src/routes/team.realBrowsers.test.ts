import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  addPerson,
  coloniesTable,
  db,
  pool,
  welfareReportsTable,
} from "@workspace/db";
import app from "../app";
import { claimsFor, makeKey, mint } from "../lib/teamAuth/__fixtures__/mint";
import {
  clearWelfareTables,
  seedReport,
  signInThroughHandoff,
} from "../lib/teamAuth/__fixtures__/queueKit";
import { removeTestPerson } from "../test/removeTestPerson";

// SYC-330: the dashboard's buttons, pressed in real browsers.
//
// WHY THIS EXISTS. Every other team test sets the Origin header by hand, so
// none could notice that a real browser sends `Origin: null` when the page it
// is on says `Referrer-Policy: no-referrer`. This test starts the real app on
// a real port and clicks the real buttons in Chromium, Firefox and WebKit.
//
// NOT RUN IN CI (CI has no browsers). It is skipped unless REAL_BROWSERS=1.
//
//   cd artifacts/api-server
//   REAL_BROWSERS=1 PLAYWRIGHT_DIR=/path/to/a/folder/with/node_modules/playwright \
//     DATABASE_URL=... pnpm exec vitest run src/routes/team.realBrowsers.test.ts
//
// PLAYWRIGHT_DIR is a folder whose node_modules holds `playwright` (and the
// browsers installed with `npx playwright install chromium firefox webkit`).
// Playwright is deliberately not a dependency of the repo. BROWSERS=firefox
// (comma-separated) narrows the run.
//
// ABOUT TEAM_ORIGIN. In production the dashboard is https://team.catspotters.com
// and `requireOrigin(TEAM_ORIGIN)` accepts only that. A browser on localhost
// has a different origin (https://127.0.0.1:<port>, with a throwaway
// certificate), so for this run the
// config's team URLs are swapped for the local ones. Nothing else changes: the
// same requireOrigin comparison runs, against whatever Origin the browser
// really sends, so it tests what production does.

const ENABLED = process.env["REAL_BROWSERS"] === "1";

const local = vi.hoisted(() => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  return { port, origin: `https://127.0.0.1:${port}` };
});

vi.mock("../lib/teamAuth/config", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/teamAuth/config")>();
  return {
    ...real,
    TEAM_ORIGIN: local.origin,
    TEAM_HOME: `${local.origin}/api/team/`,
    // Where sign-out sends the browser. A page of the local server, so the
    // redirect can be followed and seen.
    SIGN_IN_PAGE: `${local.origin}/api/signed-out`,
  };
});

const EMAIL = "vitest-realbrowsers-susan@example.com";
const KEY = "vitest-rb-key-0123456789abcdef-0123456789abcd";
const handoffKey = makeKey();

type Seen = { method: string; path: string; origin: string | undefined };
const seen: Seen[] = [];
let server: Server;
let cookie: string;
let reportPublicId: string;

type PW = {
  chromium: BrowserType;
  firefox: BrowserType;
  webkit: BrowserType;
};
// Just the slice of Playwright's API this file uses.
interface BrowserType {
  launch(): Promise<{
    newContext(o?: { ignoreHTTPSErrors: boolean }): Promise<Ctx>;
    close(): Promise<void>;
  }>;
}
interface Ctx {
  addCookies(c: object[]): Promise<void>;
  newPage(): Promise<Page>;
  cookies(): Promise<{ name: string }[]>;
}
interface Page {
  goto(url: string): Promise<unknown>;
  url(): string;
  getByRole(role: string, o: { name: string | RegExp }): Loc;
  getByLabel(label: string | RegExp): Loc;
  getByText(t: string): Loc;
  waitForURL(re: RegExp, o?: { timeout: number }): Promise<void>;
  waitForLoadState(s: string): Promise<void>;
}
interface Loc {
  click(): Promise<void>;
  fill(v: string): Promise<void>;
}

function loadPlaywright(): PW {
  const dir = process.env["PLAYWRIGHT_DIR"];
  if (!dir) throw new Error("Set PLAYWRIGHT_DIR (see the top of this file)");
  return createRequire(join(dir, "x.js"))("playwright") as PW;
}

/** Fail fast, saying which POSTs the browser sent and with what Origin. */
async function waitOrExplain(page: Page, re: RegExp, what: string) {
  try {
    await page.waitForURL(re, { timeout: 8000 });
  } catch {
    const posts = seen.filter((s) => s.method === "POST");
    throw new Error(
      `${what} was not accepted (now at ${page.url()}). ` +
        `POSTs the server saw: ${JSON.stringify(posts.map((p) => [p.path, p.origin]))}`,
    );
  }
}

/** The page ends up at the same address after a note, so wait on the POST. */
async function untilPosts(n: number, what: string) {
  for (let i = 0; i < 80; i++) {
    if (seen.filter((s) => s.method === "POST").length >= n) {
      // let the redirect and the database write finish
      await new Promise((r) => setTimeout(r, 500));
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${what}: the server never saw the POST`);
}

beforeAll(async () => {
  if (!ENABLED) return;
  process.env["TEAM_HANDOFF_PUBLIC_KEYS"] = handoffKey.publicRaw;
  process.env["TEAM_SESSION_KEYS"] = KEY;
  await removeTestPerson(EMAIL);
  await clearWelfareTables();
  const p = await addPerson({
    email: EMAIL,
    name: "Susan",
    addedBy: "cli:vitest",
  });
  cookie = await signInThroughHandoff(app, handoffKey, p.id);
  // Note every request's real Origin as the server sees it.
  // A throwaway self-signed certificate, so the browsers treat the page as
  // secure (as in production) and keep the Secure session cookie.
  const dir = mkdtempSync(join(tmpdir(), "syc330-"));
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
      "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"),
      "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"],
    { stdio: "ignore" },
  );
  const tls = {
    key: readFileSync(join(dir, "k.pem")),
    cert: readFileSync(join(dir, "c.pem")),
  };
  server = createServer(tls, (req, res) => {
    seen.push({
      method: req.method ?? "",
      path: (req.url ?? "").split("?")[0]!,
      origin: req.headers.origin,
    });
    app(req, res);
  });
  await new Promise<void>((ok) => server.listen(local.port, "127.0.0.1", ok));
});

afterAll(async () => {
  if (!ENABLED) return;
  server?.close();
  delete process.env["TEAM_HANDOFF_PUBLIC_KEYS"];
  delete process.env["TEAM_SESSION_KEYS"];
  await clearWelfareTables();
  // A person who created a colony has history and cannot be removed; the
  // throwaway database is dropped at the end of the run anyway.
  await removeTestPerson(EMAIL).catch((err: unknown) => {
    if (!(err instanceof Error && err.message.includes("has history"))) throw err;
  });
  await pool.end();
});

const names = (process.env["BROWSERS"] ?? "chromium,firefox,webkit")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean) as (keyof PW)[];

describe.skipIf(!ENABLED)("SYC-330: real browsers press the dashboard buttons", () => {
  it.each(names)(
    "%s: moving a report, saving a note, creating a colony and signing out are accepted",
    async (name) => {
      const pw = loadPlaywright();
      await clearWelfareTables();
      const report = await seedReport({ note: `rb-${name}` });
      reportPublicId = report.publicId;
      seen.length = 0;

      const browser = await pw[name].launch();
      try {
        const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
        const value = cookie.slice(cookie.indexOf("=") + 1);
        await ctx.addCookies([
          {
            name: "__Host-cs_team",
            value,
            domain: "127.0.0.1",
            path: "/",
            httpOnly: true,
            secure: true,
            sameSite: "Lax",
          },
        ]);
        const page = await ctx.newPage();
        await page.goto(`${local.origin}/api/team`);
        expect(page.url()).toBe(`${local.origin}/api/team`);

        // (1) Move the report to "Looking into it".
        await page.getByRole("button", { name: /^Looking/ }).click();
        await waitOrExplain(page, /#r-/, "moving the report");
        await untilPosts(1, "moving the report");
        const [moved] = await db
          .select({ state: welfareReportsTable.state })
          .from(welfareReportsTable)
          .where(eq(welfareReportsTable.publicId, reportPublicId));
        expect(moved?.state).toBe("looking");

        // (2) Save a team note.
        const noteText = `note from ${name}`;
        await page.getByLabel(/^Team note/).fill(noteText);
        await page.getByRole("button", { name: "Save note" }).click();
        await untilPosts(2, "saving the note");
        await page.waitForLoadState("load");
        const [noted] = await db
          .select({ note: welfareReportsTable.teamNote })
          .from(welfareReportsTable)
          .where(eq(welfareReportsTable.publicId, reportPublicId));
        expect(noted?.note).toBe(noteText);

        // (3) Create a colony (open the form, fill the name, press the button).
        const colonyName = `rb-${name}-${Date.now().toString(36)}`;
        await page.goto(`${local.origin}/api/team/colonies`);
        await page.getByText("Create a colony").click();
        await page.getByLabel("Colony name").fill(colonyName);
        await page.getByRole("button", { name: "Create the colony" }).click();
        await untilPosts(3, "creating the colony");
        const made = await db
          .select({ id: coloniesTable.id })
          .from(coloniesTable)
          .where(eq(coloniesTable.name, colonyName));
        expect(made).toHaveLength(1);

        // (4) Sign out: the redirect is followed and the cookie is gone.
        await page.getByRole("button", { name: "Sign out" }).click();
        await waitOrExplain(page, /\/api\/signed-out$/, "signing out");
        const stillHeld = (await ctx.cookies()).some(
          (c) => c.name === "__Host-cs_team",
        );
        expect(stillHeld).toBe(false);

        // The browser really sent the dashboard's own origin on each POST.
        const posts = seen.filter((s) => s.method === "POST");
        console.log(
          `[${name}] POST Origin headers seen by the server:`,
          JSON.stringify(posts.map((p) => [p.path, p.origin])),
        );
        expect(posts).toHaveLength(4);
        for (const p of posts) expect(p.origin).toBe(local.origin);
      } finally {
        await browser.close();
      }
    },
    60000,
  );
});
