# Team dashboard UX fixes: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build SYC-517 (places as names), SYC-515 (check before emailing a reporter), SYC-516 (error pages; keeping typed text through an expired sign-in) and SYC-519 (a shorter Queue) as the approved spec describes. Five draft PRs, one after another.

**Architecture:** These are server-drawn dashboard pages with no scripts (`TEAM_CSP`), Express routes under `/api/team`, Drizzle and Postgres. Each PR changes renderers in `lib/teamPages/*`, plus the routes that feed them. Only PR C adds a table.

**Tech Stack:** TypeScript, Express 5, zod, Drizzle ORM, Postgres, vitest + supertest.

**Spec:** `docs/specs/team-dashboard-ux-fixes.md` (approved by Samuel, 21 Oct 2026). Read it with this plan. Its decisions are final: 515-A, 516-A, 516-B = **C** (server-kept text), 517-A, 517-B, 519-A (no filters; SYC-528), 519-B = **drop "Started but not sent"**, 519-C = "Please email hello@catspotters.com."

## Global Constraints

- Branch per PR off fresh `origin/main`, in this session's worktree. Run `gh pr create --draft`. CI skips drafts, so run the affected tests locally first. `/ship` marks a PR ready and merges it.
- Commit after each task. Keep `CHECKPOINT.md` (git-excluded) current.
- Every value printed into HTML goes through `escapeHtml`. No `<script>` on any page touched here. `setTeamHeaders(res)` on every dashboard response.
- Positions print only through `lib/teamPages/position.ts`. **Open map** appears only when the viewer is island-wide (`isIslandWide(person)` / the existing `island` / `mapLinks(opts)` flags), never for a cat guardian, and never on an owner's home pin.
- A place label comes only from `placeLabel(p, publicLabelOf(site))` (`lib/areas/placeLabel.ts`). Never a site's internal `name`.
- Strings that cat guardians read live in `lib/teamPages/strings/{en,el,fr}.ts`, with keys in parity (`strings.test.ts`). The Queue, Home and team-only pages stay English, inline as today.
- Never exercise SYC-515 against the live site or a test site with a real address. Local scratch DB only.
- Each PR is checked in the browser at about 390 px and desktop, with seeded data, before it opens (memory: plant `__Host-cs_team` on `/api/healthz` only; saves via curl with `Origin: https://team.catspotters.com`).
- Tests run with a local Postgres `DATABASE_URL`, `AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:9`, `AI_INTEGRATIONS_OPENAI_API_KEY=ci-dummy-not-a-key`, and `ESBUILD_BINARY_PATH` pointing at a darwin esbuild 0.28.1.

## Review Focus

1. **A post from another site after the sign-in lapses** (bad Origin, no session). It must get today's exact 401 body, with nothing kept and nothing shown back. Test in C2.
2. **A different person signs in on the same browser within 30 minutes.** They must not get the first person's text, and the kept row must be deleted. Test in C3.
3. **A report whose reporter confirms their address while the "Close and email?" page is open.** Pressing the button must send nothing and land on "Someone else changed this report". Test in B2.
4. **`?open=` with a value that matches no report, or holds markup.** It must do nothing and never be printed back. Test in D1.
5. **A cat guardian's page whose area name was typed by the team with markup in it.** It must be escaped, with no map link. Test in A3.

---

## PR A: Places as names (SYC-517, without the map picker)

### Task A1: `position()` gives words

**Files:**
- Modify: `artifacts/api-server/src/lib/teamPages/position.ts`
- Test: `artifacts/api-server/src/lib/teamPages/position.test.ts`, `positions.source.test.ts`

**Interfaces:**
- Produces: `place(lat: number, lng: number, opts: { link: boolean; label?: PublicLabel | null }): string`. It returns trusted HTML: `esc(placeLabel({lat,lng}, label))`, plus ` · <a href=mapUrl rel="noopener noreferrer">Open map</a>` when `link`.
- Keeps: `position()` (numbers) and `mapUrl`, `roundPos`. After A2 the only callers of `position()` are a guardian's own site pages (`sitePages.ts`, `siteFormPages.ts` when `island === false`) and form-input prefill in `areasPage.ts` / `colonyPages.ts`.

- [ ] Step 1: write tests in `position.test.ts`:
  - `place(37.445, 24.942, {link:false})` contains no digit-dot-digit run (`/\d\.\d{3}/`) and equals `esc(placeLabel(...))`;
  - with `link:true` it ends with `Open map</a>`, and the href holds the 5-decimal position;
  - with a `PublicLabel` it reads `"<Area>, <label>"`.
- [ ] Step 2: run `npx vitest run src/lib/teamPages/position.test.ts`. Expect a FAIL (`place` not exported).
- [ ] Step 3: implement `place`.
- [ ] Step 4: re-run and expect a PASS. Commit.

### Task A2: every team page uses `place()`

**Files (modify):**
- `lib/teamPages/queuePage.ts` (233; delete 268 with B/D later, leave the draft row for now)
- `colonyPages.ts` (397 `centreText`, 582)
- `catPages.ts` (844 home pin, 857, 879)
- `sitePages.ts` (315, 436 when the viewer is island-wide)
- `siteFormPages.ts` (178, 230, 231 when `island === true`: "You tapped a spot in {place}")
- `areasPage.ts` (146: Open map only, since the label is the area itself)
- `teamMap.ts:68` (read it first; same rule)

Tests: `routes/team.cats.test.ts`, `team.colonies.test.ts`, `team.sites.test.ts`, `team.areas.test.ts`, `queuePage.layout.test.ts`, `positions.source.test.ts`.

**Rules the implementer can't infer:**
- The colony history "centre moved" line uses `centreText`. Same area: "moved within {area}". Different areas: "moved from {a} to {b}". Unset to set: "set in {area}". These are new `colony.centre*` strings in en/el/fr.
- Home pin: `Pinned, in ${areaFor(lat,lng).name}`. Never a link.
- The sighting's More menu (catPages 879) drops the position line and keeps Open map only (`link` true). The `<p class="meta">` holds just the link.

- [ ] Step 1: extend `positions.source.test.ts` so `position(` is allowed only in `position.ts`, `sitePages.ts` and `siteFormPages.ts` (the guardian branch), and the RAW_PRINT check still fails on any `.toFixed(`/`roundPos(` print elsewhere except input prefill in `areasPage.ts`/`colonyPages.ts`.
- [ ] Step 2: add route-test assertions for the island-wide team member. The Queue, colony page, cat page (First recorded, More menu, home pin), team site page and Areas page each show no `/\d{2}\.\d{5}/` in visible text (tags stripped; `value="…"` attributes allowed), and each shows `Open map` where the spec's table says so.
- [ ] Step 3: run them and expect FAILs. Implement. Expect PASSes. Commit.

### Task A3: guardian pages

**Files:**
- Modify: `lib/teamPages/guardianPages.ts` (154 `sitesBlock`, 185 colony list, 305 cat page), `strings/{en,el,fr}.ts`
- Test: `routes/team.guardianView.test.ts`, `guardianPages.coat.test.ts`, `strings.test.ts`

**Interfaces:**
- Replace the `gcat.position` key with `gcat.firstSeenIn: "First seen in {place}"`, plus el/fr. `{place}` is `placeLabel({lat,lng})` (area only; no site label on a guardian's cat page).
- Colony list: no position line. `sitesBlock`: no position line.
- A guardian's own site pages keep exact positions (spec §4). `team.guardianView.test.ts:424, 700, 778-782` stay green unchanged.

- [ ] Step 1: tests:
  - Eleni's colony page and cat page contain no `/\d{2}\.\d{5}/` in visible text and no `google.com/maps`;
  - the cat page contains `First seen in `;
  - with an area renamed to `<b>Kini</b>` (seed through `lib/areas`), the page holds `&lt;b&gt;` (Review Focus 5).
- [ ] Step 2: FAIL, implement, PASS. Run `strings.test.ts`. Commit.

### Task A4: Areas page hint

- [ ] Add a hint under the area name inputs on `areasPage.ts`: "Area names are shown to cat guardians. Use the place's name, never a person's." (team page, English). Assert it in `team.areas.test.ts`. Commit.

**PR A done when:** `npx vitest run src/lib/teamPages src/routes/team.*.test.ts` is green, the browser check is done, and the draft PR is open.

---

## PR B: Check before emailing the reporter (SYC-515)

### Task B1: one answer for "what happens to the reporter?"

**Files:**
- Modify: `lib/welfare/reporterEmail.ts`
- Test: `lib/welfare/reporterEmail.test.ts` (or the existing reporter-email test file; check `ls lib/welfare`)

**Interfaces:**
- Produces: `export type ReporterOnClose = "none" | "already_sent" | "will_send" | "held" | "may_not_arrive";`
- Produces: `export async function reporterOnClose(tx: Tx | typeof db, reportId: number): Promise<ReporterOnClose>`.
  - "none": `kind <> 'welfare'`, or no `reporter_contact_id`.
  - "already_sent": `outcomeAlreadySent`.
  - "held": contact `status <> 'confirmed'`.
  - "may_not_arrive": confirmed but `isReportSuppressed` (or last delivery bounced/complained, as `sendMail` judges it).
  - Otherwise "will_send".
- `QueueReport` (`lib/welfareQueue.ts`) gains `onClose: ReporterOnClose`, filled by the same function.

- [ ] Step 1: one test per answer, seeding rows as the existing reporter-email tests do. Include an issue report → "none".
- [ ] Step 2: FAIL, implement, PASS. Commit.

### Task B2: the confirm step

**Files:**
- Modify: `routes/teamReports.ts` (state route at line 322), `lib/welfareActions.ts`, `lib/teamPages/queuePage.ts` (`actionForms`)
- Test: `routes/team.reports.test.ts` (find the existing state-route test file with `grep -l "reports/.*state" src/routes/*.test.ts`)

**Interfaces:**
- `StateBody` gains `confirm: z.literal("1").optional()` and `expect: z.enum([...ReporterOnClose]).optional()`.
- `moveReportState` input gains `expectReporter?: ReporterOnClose`. Inside the transaction, after the UPDATE matches, call `reporterOnClose(tx, id)`. If `expectReporter` is set and differs, throw a private rollback marker and return `"changed"`. The whole move is undone, so nothing is sent.
- Form posts only: when `to` is `done` or `nothing_needed`, there's no `confirm`, and `reporterOnClose` is "will_send", "held" or "may_not_arrive", answer 200 with `renderConfirmPage`. JSON callers act in one step as today.

**Copy (exact):**
- title "Close this report and email the person who sent it?"
- lines: the email's fixed text from `reportOutcome` (import its two constants, don't retype them); "held" adds "They haven't confirmed their email yet. If they do while this report is still closed, they get the standard message."; "may_not_arrive" adds "Our last email to them didn't arrive, so this one may not either."
- yes: "Close and send the email", or "Close the report" for held
- cancel: "Back to the Queue (nothing changed)" → `/api/team?open=<id>#r-<id>`
- On Done with "will_send"/"may_not_arrive": the extra-line `<input name="reporterSentence">` sits on the confirm page. `renderConfirmPage` carries fields as hidden inputs, so add an optional `extra?: string` (trusted HTML) slot above the Yes button. Escape everything in it.
- `actionForms` in queuePage.ts drops the sentence input.

- [ ] Step 1: tests, all form posts with `Origin: TEAM_ORIGIN`:
  - "will_send" without confirm: 200, the page text, **no** state change, **no** outbox row;
  - with `confirm=1&expect=will_send&reporterSentence=Thanks`: 303, state done, one outbox row whose params carry the sentence;
  - "held": no sentence box on the page; confirm moves the report, no outbox row;
  - "none": one tap, 303, moved;
  - **Review Focus 3:** confirm page shown as "held", then the contact set to confirmed, then a press with `expect=held` gives a 303 to `?changed=`, the state is unchanged, and there are no outbox rows;
  - JSON post: acts in one step, as before.
- [ ] Step 2: FAIL, implement, PASS. Run every existing state-route and welfareActions test unchanged. Commit.
- [ ] Step 3: **mutation probe.** Comment out the `expectReporter` comparison: the Review Focus 3 test must go red. Restore it.

**PR B done when:** tests are green, the probe is recorded in the PR body, the browser check of the confirm page is done at 390 px and desktop (local only), and the draft PR is open.

---

## PR C: Error pages, and typed text kept through an expired sign-in (SYC-516; closes SYC-339)

### Task C1: dashboard error page

**Files:**
- Create: `lib/teamPages/errorPage.ts`
- Modify: `app.ts` (the `/api` 404 at 98; `jsonErrorHandler`), `lib/teamPages/strings/{en,el,fr}.ts`
- Test: `routes/team.errorPage.test.ts`, `team.headers.test.ts`, `team.walk.test.ts`

**Interfaces:**
- `export function wantsTeamPage(req: Request): boolean`: the path starts with `/api/team/` and either `sec-fetch-mode` is `navigate` or `Accept` includes `text/html`.
- `export function renderTeamErrorPage(kind: "not_found" | "broken" | "bad_request", opts: { afterSave: boolean; lang: Language }): string`. It's built with `renderPage({ nav: false, personName: null-equivalent })`. Check what `renderPage` accepts for no person, and add an option if needed. Language comes from `Accept-Language`: the first of el/fr/en, live-gated by `LIVE_LANGUAGES` like `pageLanguage`.
- Copy keys `error.notFound.title/line`, `error.broken.title`, `error.broken.afterSave`, `error.broken.retry`, `error.bad.title`, `error.home` ("Go to the dashboard" → `/api/team/home`), with the spec's §3.1 text.
- In `app.ts`: before the JSON 404, `app.use("/api/team", …)` sets `setTeamHeaders` for every unmatched `/api/team` path (SYC-339), then sends the page if `wantsTeamPage`, else today's JSON. In `jsonErrorHandler`: for `/api/team` paths, `setTeamHeaders`, then the page for 500, 413 and 400 when `wantsTeamPage`. `afterSave` = `req.method === "POST"`.

- [ ] Step 1: tests:
  - `GET /api/team/nope` with `Sec-Fetch-Mode: navigate` → 404 HTML with "This page doesn't exist" and the full `TEAM_CSP` header set;
  - the same with `Accept: text/html` only → same;
  - with neither → today's JSON plus team headers;
  - a forced route error (mock as `team.catGrid.error.test.ts` does) → 500 page; POST wording vs GET wording;
  - `/api/cats/nope` (not team) unchanged.
- [ ] Step 2: FAIL, implement, PASS. Add `/api/team/nope` to the walk's expectations. Commit.

### Task C2: recognise an expired sign-in, and the signed-out page

**Files:**
- Modify: `lib/teamAuth/session.ts`, `middlewares/requireTeam.ts:107-112`, `lib/teamAuth/refuse.ts`
- Test: `lib/teamAuth/session.test.ts`, `routes/team.signedOut.test.ts`

**Interfaces:**
- `SESSION_COOKIE_GRACE_SECONDS = 86_400`. `issueSession`'s cookie `maxAge` becomes `(SESSION_LIFETIME_SECONDS + SESSION_COOKIE_GRACE_SECONDS) * 1000`; the signed `exp` is unchanged.
- `verifyValue(value, keys, now, opts?: { expiredWithin?: number })`. When given, it accepts `now - expiredWithin < exp <= now` only (not live ones).
- `export function readExpiredSession(req: Request, nowSeconds: number): SessionPayload | null`. It returns a **genuine, expired** team session, never a live one and never an invite kind.
- `readSession` behaviour is unchanged (an expired cookie is still refused). This is the guard that matters.
- In `requireTeam`, only in the `!session` branch: if `isBrowserNavigation(req) && req.method === "POST" && req.headers.origin === TEAM_ORIGIN && isFormPost(req)`, call `refuseSignedOutSave(req, res)` (C3). Otherwise `refuseNotSignedIn` exactly as today. Every other refusal path stays byte-for-byte.

- [ ] Step 1: tests:
  - a cookie expired 1 h ago: `readSession` null, `readExpiredSession` returns its pid;
  - expired 25 h ago: both null;
  - live: `readExpiredSession` null;
  - a bad signature: null;
  - an invite kind: null;
  - **Review Focus 1:** a POST with `Origin: https://evil.example`, no session, a `note` field → today's exact 401 body (compare with `NOT_SIGNED_IN_PAGE`), no `held_typing` row;
  - `team.colonies.test.ts:1001-1030` and `team.walk.test.ts:592` unchanged and green.
- [ ] Step 2: FAIL, implement, PASS. **Mutation probe:** make `readSession` accept `expiredWithin`; at least the "expired cookie still refused" test must go red. Restore. Commit.

### Task C3: keep, return and clear typed text

**Files:**
- Create: `lib/db/src/schema/heldTyping.ts`, migration `lib/db/migrations/00NN_held_typing.sql`. **NN is claimed at build time:** list the live sessions' branches and open PRs for `lib/db/migrations/00*`, and message each that adds one before taking the next free number (0035 on 21 Oct).
- Create: `lib/teamAuth/heldTyping.ts`
- Modify: `routes/team.ts` (hand-off normal exit, line ~165), the renderers of the forms in the registry below
- Test: `lib/teamAuth/heldTyping.test.ts`, `routes/team.signedOut.test.ts`

**Table `held_typing`:**
- `id uuid pk default gen_random_uuid()`
- `person_id` (FK to people, on delete cascade)
- `session_version int`
- `form_key text`
- `landing_path text`
- `fields jsonb`
- `created_at timestamptz default now()`
- index on `created_at`

No IP, no device, no address.

**Interfaces (`heldTyping.ts`):**
- `export const HELD_COOKIE = "__Host-cs_held"`. Secure, HttpOnly, SameSite=Lax, Path=/, Max-Age 1800. Value: the row id.
- `export const KEEPABLE: Record<string, { match: RegExp; formKey: (m: RegExpMatchArray) => string; landing: (m) => string; fields: readonly string[] }>`. Its entries are fixed here; the implementer copies each field name from that route's zod schema, and a test checks every listed field exists in it:
  - `POST /api/team/reports/:id/note` → landing `/api/team?open=:id`, fields `note`
  - `POST /api/team/colonies` → `/api/team/colonies`, fields `name, guardianName, notes`
  - `POST /api/team/colonies/:id` → `/api/team/colonies/:id`, fields `name, guardianName, notes`
  - `POST /api/team/sites/:id` → `/api/team/sites/:id`, the site edit form's text fields (name, public label, directions, notes)
  - `POST /api/team/cats/:id/name` → `/api/team/cats/:id`, `name`
  - `POST /api/team/cats/:id/died` → `/api/team/cats/:id/died`, `reason`
  - `POST /api/team/cats/:id/life-status`, `/sterilisation` → `/api/team/cats/:id`, `reason`
  - `POST /api/team/statements/:id/wrong` → that route's landing, `reason`
- `export async function keepTyping(req, res, who: SessionPayload): Promise<boolean>`:
  - true only if the path matches `KEEPABLE`, the person exists and `sessionVersion === who.sv`, and at least one listed field is a non-empty string;
  - each value is cut to 4,000 characters;
  - any older row for that person is deleted first;
  - inserts the row and sets the cookie.
- `export async function takeHeldTyping(req, res, person: { id: string; sessionVersion: number }, mayOpen: (path: string) => boolean): Promise<{ id: string; landing: string } | null>`:
  - reads the cookie's row and always clears the cookie;
  - a row for another person, another session version, older than 30 minutes, or with a landing `mayOpen` refuses is deleted, and null is returned;
  - a matching row is marked claimed (see the hand-off below).
- `refuseSignedOutSave(req, res)` (in refuse.ts):
  - `who = readExpiredSession(...)`;
  - if `who` is set and `keepTyping` succeeds: 401 page "You were signed out, so this wasn't saved. We've kept what you typed for 30 minutes. Sign in again to carry on." with a **Sign in again** link to `SIGN_IN_PAGE`;
  - otherwise: 401 page "You were signed out, so this wasn't saved." with the allow-listed fields shown in `<textarea readonly>` (escaped) when the path is in `KEEPABLE`, and the same link;
  - never a meta refresh.
- Hand-off normal exit: after `issueSession`, `const held = await takeHeldTyping(req, res, person, (p) => mayOpenPath(person, p))`. `takeHeldTyping` does **not** delete a matching row: it sets `claimed_at = now()` (add `claimed_at timestamptz` to the table), clears the cookie, and returns `{ id, landing }`. The hand-off redirects to `TEAM_ORIGIN + landing + (landing has "?" ? "&" : "?") + "kept=" + id`; with no match it goes to the usual home, as today.
- `export async function useHeldTyping(req, person: { id: string }, formKey: string): Promise<Record<string,string> | null>`. The landing routes call it when `?kept=` is present. It deletes the row with that id **only if** `person_id` matches, `form_key` matches and `claimed_at` is within 5 minutes, and returns its fields. Otherwise it returns null and the page renders as normal.
- `mayOpenPath(person, path)` maps the landing to its capability: Queue → `view_welfare_queue`, colony/site/cat pages → the same `can()` checks their GET routes use. If unsure, it returns false and the person lands at home.
- Each renderer for the registry's landing pages accepts an optional `kept?: Record<string,string>`. It pre-fills those inputs, opens their fold, and prints "You were signed out before this was saved. We kept what you typed. Check it and press Save." at the top (`role="status"`).
- Tidy-up: `deleteStaleHeldTyping(now)` deletes rows older than 30 minutes. It's called from the existing opportunistic drain middleware in app.ts (same pattern as `opportunisticRoundUp`) at most once a minute.

- [ ] Step 1: tests:
  - signed-out note save with a genuine cookie expired 1 h ago → 401 page, one row, the cookie set;
  - the hand-off for the same person → 303 to `/api/team?open=<id>&kept=<rowid>`; GET that → the textarea holds the note and the status line shows; the row is gone after;
  - **Review Focus 2:** hand-off for a different person → their normal home, the row deleted;
  - a posted `lat`/`lng`/`from` is never stored or shown back;
  - a row 31 minutes old → not returned;
  - a removed person or a bumped session version → nothing kept, and the copy-back page shown;
  - a guardian whose landing is a team page → her home, the row deleted;
  - `kept=` with someone else's row id → ignored.
- [ ] Step 2: FAIL, implement, PASS. Run `pnpm run migrate` against the scratch DB and the migration runner tests in `lib/db`. Commit.
- [ ] Step 3: **mutation probes:** drop the `person_id` check in `useHeldTyping` and the `takeHeldTyping` match → the Review Focus 2 test goes red. Drop the field allow-list → the lat/lng test goes red. Restore.

**PR C done when:** tests and probes are green, the browser walk is done (expire a session by signing a cookie with a past `exp`; save a note via a real form in the browser where possible, otherwise curl; sign in via the test hand-off key locally), the PR body says **"don't republish until migration 00NN is applied"**, and the draft is open. Also check on the test site that the hand-off still carries `__Host-` cookies. Existing evidence: `alreadySignedInAs` in `routes/team.ts` already reads the team cookie during the hand-off.

---

## PR D: A shorter Queue (SYC-519)

Before starting, message the session building SYC-44 PR 7.1 (if one exists: `list_sessions`, open PRs touching `queuePage.ts`). Whichever lands second rebases.

### Task D1: one-line rows that open, and `?open=`

**Files:**
- Modify: `lib/teamPages/queuePage.ts`, `routes/team.ts` (the `GET /team` handler reads `open`), `homePage.ts:56`, `findPhotoPage.ts:193`, `catGridPage.ts:365`, `routes/teamReports.ts` (`backToReport`, `backToTiedReport` and the note redirect add `open=`)
- Test: `queuePage.layout.test.ts`, `routes/team.queue*.test.ts`, `team.home.test.ts`

**Interfaces:**
- `export function reportRow(r: QueueReport, now: Date, opts: { open: boolean; island: boolean; closed: boolean; notices: string }): string`. This is the shared row SYC-44 7.1 will reuse for Issues.
  - `<article id="r-…">` wraps `<details${open}>`;
  - the summary holds the photo thumb (56 px, as Home), `placeLabel`, `timeAgo`, `firstWords(note)` (move `firstWords` out of homePage.ts into `lib/teamPages/words.ts` and import it in both), the state chip, and an Urgent/Kittens/Unchecked tag;
  - the body holds today's `<dl>` and `actionForms`.
- `renderQueuePage(..., open?: string)`: a row is open when its id equals `open`, `changedId`, `noted` or `tied.id`. `open` is checked against `PUBLIC_ID_RE` in the route; anything else is ignored and never printed.

- [ ] Step 1: tests:
  - each open report renders one `<details>` with the place and first words in `<summary>`;
  - `?open=<id>` opens exactly that one;
  - **Review Focus 4:** `?open=<script>` and `?open=nope` change nothing, and the value never appears in the HTML;
  - Home's report link is `/api/team?open=<id>#r-<id>`;
  - urgent reports still come first.
- [ ] Step 2: FAIL, implement, PASS. Commit.

### Task D2: words, Unchecked hidden at zero, drafts gone

**Files:**
- Modify: `queuePage.ts` (`EMAIL`, `REPORTER_EMAIL`, `mailBanner`, `uncheckedSection`, remove `draftCard` and the drafts block), `homePage.ts` (remove `draftLine` and the drafts list), `lib/welfareQueue.ts` / `lib/dashboard/home.ts` (stop querying drafts for these pages; leave the table and the public app alone)
- Test: as D1, plus `team.home.test.ts`

**Copy (exact, from spec §5):**
- EMAIL: sent and delivered → "We emailed the team about it" / "We emailed the team about it, and it arrived"; bounced and failed → "Our email to the team didn't arrive. Nothing is lost: it's here."; waiting → "Our email to the team is waiting to send"
- REPORTER_EMAIL:
  - unconfirmed → "They left an email but haven't confirmed it yet."
  - confirmed → "They left an email and confirmed it."
  - sent/delivered → "They left an email. Our last message to them was sent." / "…arrived."
  - waiting → "They left an email. A message to them is waiting to send."
  - bounced/failed → "They left an email, but our last message to them didn't arrive."
  - none → "No email left"
- Row labels: "Email to Syros Cats" → "Team alert". "Contact left" → "Their email".
- Banner's last sentence: "Please email hello@catspotters.com."
- Unchecked: when `reportsTotal === 0`, nothing at all. Otherwise the heading "Arrived while our spam check was down (N)" and one line: "Our spam check couldn't be reached when these arrived. Most are real; check before acting."
- The unchecked drafts fold is removed.

- [ ] Step 1: update the pinned-words tests (P1-6 and the queue layout tests) to the new words. Assert no "Started but not sent", no "Unchecked drafts", and no `id="d-` on the Queue or Home. Assert there's no Unchecked section at zero.
- [ ] Step 2: FAIL, implement, PASS. Commit.

**PR D done when:** green, browser-checked at 390 px and desktop with 5+ seeded reports (one urgent, one with a photo, one closed, one unchecked), and the draft is open.

---

## PR E: Tap the map for centres (SYC-517, decision 517-B)

### Task E1: colony centre by map

**Files:**
- Modify: `lib/teamPages/colonyPages.ts` (edit form 528: replace the lat/lng inputs with a link "Set the centre on a map"), `routes/teamColonies.ts` (or wherever `POST /team/colonies/:id` lives)
- Create routes: `POST /team/colonies/:id/centre/map` (pan/zoom, as `/team/sites/new/map`) and `POST /team/colonies/:id/centre/pick` (as `/team/sites/pick`). Both reuse `renderPicker` and `readPick` from `siteFormPages.ts` / `teamSites.ts`; export them if needed. Then a confirm page "Set the centre here, in {place}?" posts the existing `POST /team/colonies/:id` with `lat`/`lng` hidden and the `updated_at` stamp the edit form carries.
- Off-island pick: "That's off Syros. Tap a spot on the island." (`areaFor` returns Off Syros).
- The start view: the colony's centre if set, otherwise its sites' midpoint, otherwise Ermoupoli.
- Test: `routes/team.colonies.test.ts`

- [ ] Step 1: tests:
  - the pick posts a centre and the history shows "set in {area}";
  - an off-island pick is refused with that line;
  - a guardian on her own colony gets no Open map on the picker;
  - the typed inputs are gone from the edit form.
- [ ] Step 2: FAIL, implement, PASS. Commit.

### Task E2: area centre by map; site typing folded

- [ ] `areasPage.ts`: each area's "Move centre" gets the same picker flow (routes `POST /team/areas/:key/centre/map|pick`), replacing the typed inputs.
- [ ] `siteFormPages.ts` `renderPicker`: wrap the typed block in `<details><summary>Type a position instead</summary>`.
- [ ] Tests in `team.areas.test.ts` and `team.sites.test.ts`. FAIL → implement → PASS. Commit.

**PR E done when:** green, browser-checked (picker at 390 px: map starts on a whole pixel, `.mappage`), and the draft is open.

---

## Model delegation

Session model: Opus.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| PR A (A1–A4) | Sonnet | Clear rules, many small renderer edits | The session re-runs the named tests itself (an agent's "pass" is never trusted alone). The extended source test is mutation-probed: add a `position(` call in queuePage and watch it go red. Session spot-reviews the diff, plus the browser check |
| PR B (B1–B2) | Sonnet | Standard route plus confirm page, well specified | The tests named above, plus the B2 mutation probe (it's a silent-failure guard: an email sent when the page said it wouldn't). Sonnet adversarial review before ready |
| PR C1 (error pages) | Sonnet | Mechanical | Tests, plus a header-set check |
| PR C2–C3 (expired sign-in, kept text) | **Opus** | Security-sensitive: it reads expired sign-ins, adds a cookie and a store, and changes the hand-off. A subtle mistake hands one person's text to another or weakens the 401 rule | The four mutation probes in C2/C3, plus an **Opus adversarial review** focused on session handling, Origin, the cookie and the hand-off branches. Then a live probe on the test site that the hand-off carries `__Host-` cookies |
| PR D | Sonnet | Rendering and copy, coordinated with SYC-44 7.1 | Tests, the pinned-words updates checked by the session against spec §5, and the browser check |
| PR E | Sonnet | Reuses the existing picker pattern | Tests plus the browser check at 390 px |
| String translations (el/fr for A3, C1) | Haiku | Short mechanical copy into two files | `strings.test.ts` parity, plus the session reads each line; added to Johnny's review pack (SYC-346) |
| Migration-number claim, cross-session messages, PR bodies, Linear | (session, Opus) | Coordination and judgment | n/a |

Every agent prompt carries the crash-proofing paragraph verbatim and commits after each task. No agent spawns another.

## Self-review

- **Spec coverage:**
  - §2 → B1–B2;
  - §3.1 → C1;
  - §3.2 → C2–C3, return-to via kept rows (landing). The spec's separate return-to cookie for a *GET* while signed out stays on today's instant jump, which the spec keeps;
  - §4 table → A2/A3; Areas hint → A4; 517-B → E;
  - §5 → D1–D2; 519-B drop → D2; 519-C → D2;
  - §6 privacy → A2/A3 source and guardian tests, C2/C3 tests;
  - §7 empty and error states → D2 (empty Queue), B2 (changed), C3 (no fields), E1 (off island).
- **Gap fixed while writing:** spec §3.2 says the person comes back "where they were" for a save. The kept row's `landing_path` does that. When nothing is kept, the signed-out page links to sign-in and the person lands on Home, as today. The spec allows that ("if it doesn't hold, the person lands on Home").
- **Type consistency:** `ReporterOnClose` is used in B1, B2 and `QueueReport.onClose`. `place()` is used in A2/A3/E1. `readExpiredSession` is used in C2/C3.
