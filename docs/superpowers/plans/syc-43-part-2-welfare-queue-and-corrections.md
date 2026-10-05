# SYC-43 part 2: the welfare queue and the corrections screens

**Status: all seven decisions made by Samuel, 5 Oct 2026 (1–6 as recommended; 7 as "strict link + mark as left", see below). The plan as a whole still awaits his approval. Plan only, nothing is built. Adversarially reviewed (Sonnet critic, 4 Oct 2026): 2 blockers, 1 major and 2 minor findings, all folded in (see "Review").**
**Spec:** `docs/specs/team-access-and-welfare-queue.md` (approved 28 Sep 2026) §3.1, §3.3, §3.6, §4.3 (report photos), §5.3(h) (closing states), §7.3, §8.4–§8.6. `DECISIONS.md` wins where they differ (F1, Part 2b, 2g, 2i, 2j). The record model is `docs/specs/cat-record-data-spine.md` (§4.5, §10.1, §10.3, §10.7).
**Linear:** SYC-43 (this part), and SYC-42 Slices 2 and 5.1, which this plan carries out (Decision 2). It touches SYC-44, SYC-150, SYC-152, SYC-163, SYC-185 and SYC-198.
**Checked against:** `origin/main` at `a7eec8f` (4 Oct 2026), open PRs #46 and #71, the branch `claude/spine-pr7-questions`, and Linear SYC-43 in full with its comments. Every "exists today" claim below names the file it was read in.

---

## In plain English

Part 1 built the front door. A Syros Cats person signs in on `admin.catspotters.com`, taps **Cat Spotters dashboard**, and lands on `team.catspotters.com`. Today that page says one line: "The welfare queue is coming soon."

This part builds the two screens behind that door that matter most.

**1. The welfare queue: "what needs us today?"** Every "this cat needs help" report, urgent ones first, then newest. Each one shows:
- the photo;
- exactly where the cat was;
- how long ago;
- what the person said;
- whether it's kittens.

A volunteer standing in the street can:
- **move the report** with one tap: *New*, *Looking at it*, *Done* or *Nothing needed*;
- **leave a team note** ("Maria went, the cat had moved on");
- **say which cat it is**, so the report becomes part of that cat's history.

Reports somebody started but never sent appear in their own short list, so the team still knows someone was worried about a cat in that street. There is no "escalate" button, no assigning and no due dates. That is deliberate (F1, spec §3.6).

**2. Fixing what is wrong.** Find any cat by name or SYR number, and see its whole record as the team sees it: exact positions, every photo, and every statement anyone has made about it. From there a team member can:
- **say a cat's life status**: street, homed, in care or deceased, with a short reason;
- **say whether a cat is sterilised**, which is *Confirmed* when the team says so;
- **mark one statement wrong**, with a reason: "that's a torn ear, not a clip";
- **rename a cat** to the name Syros Cats actually use;
- **hide a photo** in one tap, or bring it back.

There is also a short **"Probably sterilised" review list**. It shows the cats the app thinks are sterilised only because a spotter saw a clipped ear, with the photo beside each one. A few minutes a week stops a wrong *Likely* from wasting a €50–60 trapping trip.

**Nothing on these screens rubs anything out.** Every correction is a new, signed statement added to the cat's record ("Susan said this, on this date, because…"). The earlier statement stays visible underneath. The way back from a wrong correction is another correction, never a delete (spec §3.3).

**What staff notice when it ships:** the "coming soon" line is replaced by a working queue, a cat search, and the review list. They can reach it once SYC-103 (the Worker's dashboard button) is live.

**What this part leaves for later**, each with its own ticket (see "What this part does not do"):
- the feeding-site map;
- colony names;
- the people screen (SYC-104);
- the "Matched by hand" list (SYC-152);
- emails to reporters (SYC-42 Slice 3);
- the deletion-requests section.

## Decisions for Samuel

Seven decisions, each with a recommendation. Decisions 1–3 shape the whole build. 4–7 are smaller. **All seven were decided by Samuel on 5 Oct 2026**, and each decision's heading says how.

### Decision 1: How the dashboard screens are built

**Decided by Samuel, 5 Oct 2026: A, plain server-drawn pages, "for now".** He also wants ready-made alternatives explored, such as off-the-shelf admin tools and plugins. That exploration is ticketed separately (SYC-207) and doesn't block this build.

**The question.** The dashboard lives inside the app's own server, at `team.catspotters.com/api/team/`, because Replit only sends `/api/...` to that server (`artifacts/api-server/.replit-artifact/artifact.toml`, `paths = ["/api"]`). Today's signed-in page is plain HTML with no scripts. Its security header allows no scripts and no images at all (`lib/teamAuth/refuse.ts`, `setTeamHeaders`). How should the real screens be built?

| Option | What it means | Benefits | Risks | What staff experience |
|---|---|---|---|---|
| **A. Plain pages with buttons and forms, drawn by the server (recommended)** | Each screen is an ordinary web page. Tapping *Done* sends a form, the server records it, and the page reloads, with the report scrolled back into view | Works on any phone browser, including old ones and slow connections. No scripts means a whole class of attack (injected scripts stealing a staff session) can't happen; the security header stays as strict as it is, with images allowed only from the dashboard itself. The least code, and it follows part 1's page. Each screen is tested exactly as it's served | Every tap reloads the page, which takes about a second on a weak signal. No live updates: a report that arrives while the page is open shows on the next reload | Simple and dependable. A tap, a short reload, and the change is there |
| B. A small app in the browser (React), served by the same server | A separate web app that talks to the server's data endpoints | Feels quicker: taps update in place, with no reload | A second front-end to build, test and deploy, and the security header has to allow scripts. More moving parts for four buttons and a note. It needs a build step that Replit's "only `/api`" routing makes awkward | Slicker. Breaks harder if something goes wrong with the scripts |
| C. Reuse the Expo app's web build as the dashboard | Add staff screens to the public app | One code base | Staff-only screens and their data shapes would ship inside the public app's bundle. The correction endpoints were kept out of the public client for exactly this reason (`routes/observations.ts` header comment). Mixes the two audiences' sessions | Confusing: the same app behaves differently for different people |

**Recommendation: A.** The spec asks for "one page, mobile-first… a simple thing" (§3, §3.1), and A is the simplest dependable version of that. If live updates are ever wanted, B can be added later behind the same server routes without redoing anything.

### Decision 2: The queue is already planned in SYC-42. Which plan governs it?

**Decided by Samuel, 5 Oct 2026: A.**

**The question.** The approved SYC-42 plan (`docs/superpowers/plans/syc-42-cat-in-trouble.md`) already defines **Slice 2, "the welfare queue on the dashboard"**: its routes, its database table and tests 27–30. It also defines **Slice 5, "tying a report to a cat"**. SYC-43 is the dashboard ticket. Without a clear owner, two sessions could build the same screen.

| Option | Benefits | Risks |
|---|---|---|
| **A. This plan builds SYC-42 Slice 2 and Slice 5.1, using SYC-42's approved design and test numbers, and both tickets point here (recommended)** | One dashboard, one look, built once. The queue and the corrections share the cat search and the photo route, so building them together avoids doing those twice. SYC-42's approved decisions stand unchanged | SYC-42 stays "In Progress" until this part's queue PRs merge. The cross-references have to stay tidy |
| B. SYC-42 builds the queue; this part only builds corrections | Each ticket keeps its own scope | Two sessions building two halves of one page. The "which cat is this?" link needs the corrections' cat search, so they would collide anyway |

**Recommendation: A.** Slice 5.2 ("use this photo on the cat") is *not* included; see "What this part does not do".

### Decision 3: How "hide this photo" is recorded

**Decided by Samuel, 5 Oct 2026: A, the hide/restore log.**

**The question.** Nothing on `main` can hide a photo. `photos` has no hidden flag (`lib/db/src/schema/photos.ts`). SYC-119's spec says "Hide this photo… already exists". It doesn't. Spec §3.3 says every correction "appends an observation", but observations are statements *about a cat* (life, sterilisation, names). A hidden photo is about a picture. The same hiding is also needed by "Report an issue" (SYC-44), where a single member-of-the-public report hides a photo pending review, and that can happen without anyone on the team being involved.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. A small add-only log of hide and restore events for photos (recommended)** | A new table, `photo_visibility_events`: which photo, hide or restore, who (a team member's id, or later a public report), why, and when. A photo is hidden if its newest event is "hide". Nothing is ever edited or deleted | Matches the spec's rule in spirit: nothing is overwritten, "who hid this and when?" always has an answer, and restore is one more row. SYC-44 can write into the same log with a "public report" author, so there is one hiding mechanism, not two. Doesn't touch the cat record, so it can't affect a cat's derived status | One new table and one extra lookup wherever a public photo is shown. That cost is the same in every option |
| B. A new observation kind, `photo_hidden`, on the cat | Exactly what §3.3's wording says | Every place that shows a photo would have to load and work through the cat's observations to decide whether a photo can be shown. A photo with no cat (SYC-44, report photos) has nowhere to go. It mixes "is this picture appropriate?" into the record that decides life and sterilisation status |
| C. A `hidden_at` / `hidden_by` column on `photos` | Smallest change | An edited field: restoring wipes who hid it. That is the "edit a field" model §3.3 rejects. `hosting-and-photo-storage.md` §7.2 already cut a photo `visibility` column once |

**Recommendation: A.** It is a deliberate, small departure from §3.3's literal wording ("appends an observation"), made for the reasons above. The spirit of the rule (append, attribute, never undo by deleting) is kept exactly.

### Decision 4: What the public sees when the cat's main photo is hidden

**Decided by Samuel, 5 Oct 2026: A.**

**The question.** Every cat has exactly one main photo (`cats.primary_photo_id`, not null). If the team hides it, what does the public catalogue show?

| Option | Benefits | Risks |
|---|---|---|
| **A. The newest photo of that cat that isn't hidden; if none, the existing "no photo" placeholder (recommended)** | The cat stays recognisable. Restoring the photo brings the original main photo back on its own, because nothing was changed. No new screen is needed to "choose a main photo", which SYC-163 will design properly | Which photo stands in is chosen automatically, not by a person. SYC-163 replaces this rule when it adds "choose the main photo" |
| B. Always the placeholder | Simplest to explain | A cat with twenty good photos looks photoless because one was bad |
| C. Make the team choose a new main photo before hiding | The team decides | Breaks "one tap, no confirmation theatre" (§3.3). A bad photo has to come down first |

**Recommendation: A.** SYC-119's spec already expects the cat's colour to be re-read "when the team hides a photo that was the main one". That re-read doesn't exist yet. It belongs to SYC-161 (noted there), not here.

### Decision 5: Renaming a cat keeps today's pattern

**Decided by Samuel, 5 Oct 2026: A.**

**The question.** Spec §3.3 says "nothing on this screen edits a field". But a cat's name is the `cats.name` column, which every screen reads. Since data spine PR 2, each naming already writes the column *and* a `name` observation in the same step (`routes/cats.ts`, the two `kind: "name"` writes). Nothing reads names from observations yet (data spine plan, PR 3b).

| Option | Benefits | Risks |
|---|---|---|
| **A. Follow the existing pattern: update `cats.name` and append a signed `name` observation, both in one transaction (recommended)** | Identical to how every other rename already works, so no second rule. The observation keeps the full name history, with who and why. Nothing else in the app changes | The column is overwritten. It acts as "the current name", and the history lives in the observations |
| B. Observations only; every screen works the name out from them | Literally "no field edited" | Every reader of `cats.name` would change, along with the unique-name rule and matching's name check. That is a data spine change far bigger than a rename button |
| C. Wait for SYC-101 (names unique by a folded form) | Uniqueness checked the right way from day one | Holds up a small feature for a separate ticket |

**Recommendation: A**, with uniqueness checked the way the app checks it at build time. If SYC-101 has landed by then, that's the folded form. If not, it's today's `lower(name)`, and SYC-101 changes it in one place.

### Decision 6: What "Looks right" does on the Probably sterilised list

**Decided by Samuel, 5 Oct 2026: A.**

**The question.** The data spine gives the review list two buttons, *looks right* and *that's not a clip* (§4.5). *That's not a clip* is defined: a team `ear_tip { clipped: false }` replaces the spotter's answer, and the cat goes back to *Not known yet*. *Looks right* isn't defined.

| Option | What happens | Benefits | Risks |
|---|---|---|---|
| **A. It records a team "yes, that's a clip" on that photo, and the cat leaves the list until new evidence arrives (recommended)** | A signed `ear_tip { clipped: true }` from the team, pointing at the same photo. The cat stays *Probably sterilised*: the resolver treats a team "clipped" like any other clipped evidence, so it can only ever produce *Likely* (checked in `lib/resolve.ts`, `resolveSterilised`). Leaving the list is a rule of **the list**, not of the resolver (PR 4 states it exactly) | Honest. A clipped tip is still only evidence, not proof: Syros Cats can't know from a photo that a specific operation happened (§4.1). The list empties as it's worked through | The cat is still *Likely*, not *Confirmed*. To confirm it, the team uses "say whether a cat has been sterilised" |
| B. It records "sterilised: yes", which is *Confirmed* | One tap to confirm | Turns a photo into a confirmed sterilisation. If wrong, a cat is never trapped, which is the costlier mistake. Not what §4.1 or §4.5 allow |
| C. It records nothing and just hides the cat on this device | Nothing written | The next team member sees the same cat again. No record that anyone looked |

**Recommendation: A.**

### Decision 7: Who changed a report, and what happens when someone leaves

**Decided by Samuel, 5 Oct 2026: a strict database link to the people list, and people who leave are marked "left", not deleted.** He first picked option C, the link as SYC-42 wrote it. Then he was shown that, with deletion as it works today, nobody who had ever moved a report could be removed. He confirmed instead the strict link combined with a change to how leaving works. The table below is the original write-up. What the decision requires is in **"Decision 7's knock-on: marking people as left"**, further down.

**The question.** The SYC-42 plan (Slice 2, item 2.1) said to add a database link from `welfare_reports.state_changed_by` to `people.id`. A database link like that would **stop anyone being removed** from the people list once they had touched a report. That breaks "removing somebody is one deletion" (spec §2.9, §10).

| Option | Benefits | Risks |
|---|---|---|
| **A. Store the person's id as plain text, with no link, the same way part 1's `people.added_by` and every observation's `account_id` do (recommended)** | Removing a person always works. History keeps the id, and the screen shows "a former team member" when that person is gone | Nothing in the database proves the id was valid when it was written. The route only ever writes the signed-in person's id, and a test pins it |
| B. A link that empties the field when the person is removed | Database-checked | Removing someone wipes who did what, which is the attribution the spec says is permanent (§7.3) |
| C. The link as SYC-42's plan says | Database-checked | Blocks removal, as above |

*Original recommendation: A.* What was decided is neither A nor C as written: it is C's strict link plus "mark as left". That keeps every attribution permanent and checked by the database, and still ends a leaver's access at their next request.

### Decision 7's knock-on: marking people as left

**What Syros Cats staff experience.** When someone leaves, a team member (or Claude, until SYC-104's people screen exists) marks them as left. Their next tap on any dashboard page, on any device, sends them back to the sign-in page. The sign-in page then treats their address like any address not on the list, so no link is sent. Everything they did stays attributed to them by name, with "(left)" after it. If they come back, adding the same address again brings back the same person, with their history intact and a fresh sign-in.

**What changes, built as PR 0 before PR 1:**
- **Migration** (next free number, the first in this part): `people` gains `left_at` (timestamptz, nullable) and `left_by` (text, like `added_by`).
- **One rule, in `lib/db/src/people.ts`: a person with `left_at` set is not on the list.** `findPersonById` and `findAllowedPerson` both refuse such a person. Those two functions are every reader of "who is allowed in" in this repo:
  - the hand-off (`routes/team.ts`);
  - `requireTeam` (every dashboard request);
  - the Worker's question (`routes/internal.ts`).

  The Worker reads the list only through that question, so it obeys too.
- `markLeft(email, by)` sets `left_at`/`left_by` **and** raises `session_version`, in one transaction, so an open session dies at its next request even before the `left_at` check is reached.
- `addPerson` for an address that already exists and has left **rejoins** that person: it clears `left_at` and raises `session_version`. It doesn't create a second row, because the email is unique and the history should stay with one person.
- **`removePerson` (hard delete) stays**, but only for someone with no history: a mistaken add. For anyone else the database link refuses it, and the command says *"This person has history. Use mark-left instead."*
- The `people` command gains `mark-left`. `list` shows who has left.
- **SYC-131** (db-ops `people-remove`) becomes db-ops `people-mark-left`, and **SYC-104** (the people screen) uses "Mark as left". Both tickets are updated.
- **Spec amendment, recorded in `DECISIONS.md` Part 2k:** §2.9's "removal takes effect at the next request… one deletion" now reads "marking someone as left takes effect at the next request, in both systems, in one step". Removal is still one action in one place, and nothing about how fast it takes effect changes.

**The database links this part then adds**, all to `people.id` and all strict (no cascade, no set-null):
- `welfare_reports.state_changed_by` and `welfare_reports.team_note_by`. Both change from text to uuid. They are empty in production today (nothing writes them; checked against `routes/reports.ts`), so the type change is safe. The migration asserts they're empty before altering them.
- `report_state_events.person_id` (uuid).
- `photo_visibility_events` keeps `author` as text, because SYC-44 will write `report:<id>` there. It also gets a nullable `person_id` uuid link that is set whenever a team member is the author.

**Not linked:** `observations.account_id` stays text, as the data spine defines it (§10.1). It also holds `system:…` authors and device-era ids, and changing it is the data spine's call, not this part's. Removal is no longer a delete, so it never orphans these ids either.

**A risk to know about.** A former staff member's name and email now stay in `people` for as long as their actions are on record. That is staff personal data the charity holds about a former volunteer. If one of them asks to be forgotten, the answer is to replace their email and name with a placeholder ("Former team member 3"), not to delete the row. That keeps every link intact. This is filed as a follow-up (SYC-208), and the privacy policy (SYC-66) should mention it.

**Tests (PR 0):**
- **P0-1** A person marked as left is refused by the hand-off, by `requireTeam` on their very next request with an existing cookie, and by the Worker's question (`allowed: false`). It's the identical refusal in each case. **M:** remove the `left_at` check from `findPersonById` → the hand-off and `requireTeam` cases go red. Remove it from `findAllowedPerson` → the Worker case goes red.
- **P0-2** `markLeft` raises `session_version`. **M:** drop the raise → a test that bypasses the `left_at` check (by calling the session comparison alone) goes red.
- **P0-3** Adding a left person's address again rejoins the same row: same id, `left_at` cleared, new `session_version`, and their old reports still attributed to them.
- **P0-4** Hard-deleting a person who has moved a report is refused by the database. Hard-deleting a person with no history works.
- **P0-5** The migration's rollback and up/down/up pass.

---

## What exists today, and what this part needs

| Needed | Exists on `main`? | Evidence |
|---|---|---|
| Staff sign-in, session check on every request, named permissions | **Yes**: `requireTeam(capability)`, `can()`, the 12 names in §7.3 | `middlewares/requireTeam.ts`, `lib/capabilities.ts`, `routes/team.ts` (#28, live 3 Oct) |
| Every dashboard POST must come from `https://team.catspotters.com` | **Yes**: `requireOrigin(TEAM_ORIGIN)` | `lib/teamAuth/refuse.ts` |
| Where the dashboard is served | `https://team.catspotters.com/api/team/` on the API server. `GET /api/team` is the "coming soon" page, server-rendered, no scripts. The hand-off sends people to `TEAM_HOME` | `routes/team.ts` line 108, `lib/teamAuth/config.ts` |
| Page security header | `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'`. **No images, no scripts** | `setTeamHeaders` in `lib/teamAuth/refuse.ts` |
| Life status and sterilisation statements, the supersede write, the Likely list | **Yes, JSON only**: `POST /api/team/observations` (`life_status`, `sterilised`), `POST /api/team/observations/:id/supersede`, `GET /api/team/observations/review/likely` | `routes/observations.ts` (#68) |
| One checked way to write an observation | **Yes**: `writeObservation`, `loadCatRecords`, `resolveCat` | `lib/observations.ts`, `lib/resolve.ts` |
| Welfare reports | **Yes**: `welfare_reports` (with `state`, `team_note`, `state_changed_at`, `state_changed_by` and `cat_id` present but unused), `welfare_report_photos`, `mail_outbox` | `lib/db/src/schema/welfare.ts`, migration `0004` (live 3 Oct) |
| `report_state_events`, `mail_deliveries` | **No** | SYC-42 Slice 2 and Slice 3 |
| Any team report route, and the team-only report-photo route | **No** | `grep` of `routes/` |
| Catalogue photos on the team domain | **Not reachable**: `/api/photos/*` sits behind the pre-launch tester gate, and only `/api/team/*` skips it | `middlewares/prelaunchGate.ts` (rule 4). The Likely list returns `/api/photos/…` URLs, which won't load on the dashboard |
| Hiding a photo | **No mechanism anywhere** | `lib/db/src/schema/photos.ts`; Decision 3 |
| Renaming a cat | Column plus `name` observation pattern exists. No team route | `routes/cats.ts` (two `kind: "name"` writes) |
| Team cat search and team cat page | **No** | — |
| Reporter email, contact yes/no, reporter delivery state | **No**: SYC-42 Slice 3. `reporter_contact_id` is always empty | `welfare.ts` comment "Unused until Slice 3" |
| Next free migration number | `0007` (`0006` is PR 3's backfill). `spine-pr7-questions` adds none | `lib/db/migrations/` |

## What this part builds, in seven PRs

Each PR can be reviewed and shipped on its own, in this order. **PR 0** (marking people as left) comes first and is described under "Decision 7's knock-on" above. Only PRs 0, 1 and 6 change the database. Migration numbers are generated at merge time, never typed by hand (`lib/db/migrations/README.md`).

### PR 1: The dashboard frame and the queue, read-only (migration `welfare_queue`)

**Database (next free number, expected `0007`).** Plain tables and columns only:
- **`report_state_events`** (spec §8.4):
  - `id`;
  - `report_id` → `welfare_reports.id`, on delete cascade;
  - `from_state`, `to_state`, both checked against the four states;
  - `person_id`, uuid, a strict link to `people.id` (Decision 7);
  - `at`;
  - `reporter_message`, nullable text. It stays empty until SYC-42 Slice 3, and will record which reporter email this change sent, so "never mail twice" is a query (§5.3h).
- **`welfare_reports` gains `team_note_by` (uuid, a strict link to `people.id`) and `team_note_at`**, so "who wrote this note?" has an answer. `state_changed_by` changes from text to uuid and gets the same link (see "Decision 7's knock-on"). The note itself stays the one free-text field the spec asks for (§3.1).
- Rollback block: drop both. No data exists before the migration runs.

**The frame.** New `lib/teamPages/`:
- `layout.ts`: one page shell with a top bar showing *Welfare queue · Cats · Probably sterilised · Sign out*, mobile-first. Inline styles only. Every value is escaped, using one `escapeHtml` shared with `team.ts`.
- `setTeamHeaders` gains `img-src 'self'`, and nothing else: still no scripts, still `form-action 'self'`, still `frame-ancestors 'none'`.

**The queue page.** `GET /api/team` replaces the "coming soon" line, behind `requireTeam("view_exact_location")`. Its data comes from one function, `listWelfareQueue()` in `lib/welfareQueue.ts`, which `GET /api/team/reports` also returns as JSON (SYC-42 2.2).

Sent reports, urgent first, then newest (§3.1). *Done* and *Nothing needed* fold into a "Closed" section underneath, newest first. Each row shows:
- the photo through the team route, or *Photo still uploading* or *No photo*, from `photo_state`;
- the exact position, as coordinates and a plain map link;
- how long ago;
- the reporter's note;
- a *Kittens* tag;
- **Contact left: yes/no**, which is always "no" until Slice 3, and the reporter's address never appears (§3.1);
- the state;
- the team note;
- **"Email to Syros Cats: sent / waiting / failed"**, the alert's delivery state from `mail_outbox`.

The reporter's own delivery state arrives with Slice 3's `mail_deliveries`. Until then the row shows nothing for it, rather than a guess.

Drafts (`is_draft = true`) appear in their own list, *"Started but not sent"*, with severity, place and time only (§4.2, SYC-42 2.3).

The page also shows **a mail-failure banner** (§8.3 "persistent send failure raises a dashboard banner") when any alert in `mail_outbox` is `failed`, or still unsent an hour after it was due, which is the same condition the drain workflow already treats as late. It says what's wrong and that reports are still safe in the queue. It never pages anyone (F1).

**Team photo routes** (both `requireTeam("view_exact_location")`, `no-store`, served with `Content-Type` from the row and `X-Content-Type-Options: nosniff`):
- `GET /api/team/report-photos/:publicId`: **the only route that serves a report photo** (§4.3), reading `welfare_report_photos`.
- `GET /api/team/photos/:publicId`: catalogue photos for the dashboard. It also serves photos hidden from the public (§6: hidden items stay visible to staff), and stays inside `/api/team/` so the pre-launch gate and CORS rules don't need a new exception.

**Not on the page, by rule:** no assign, no due date, no escalate or "page someone" button, no countdown (§3.1, §3.6). A test pins these words as absent.

### PR 2: Moving a report and the team note

- `POST /api/team/reports/:publicId/state`, behind `requireOrigin(TEAM_ORIGIN)` and `requireTeam("change_report_state")`. It is a form with four buttons. The form carries the state the page showed (`from`). In one transaction it runs `UPDATE … WHERE state = :from`, writes `state_changed_at` and `state_changed_by`, and inserts a `report_state_events` row.
  - If someone else changed the report first, nothing is written, and the page says *"Someone else changed this report a moment ago. Here's where it is now."*
  - Drafts can't be moved.
  - A closing state sends **nothing yet**: reporter email is Slice 3, and *Looking at it* never sends (§5.3h).
- `POST /api/team/reports/:publicId/note`, behind `requireTeam("add_team_note")` and the same Origin rule, with up to 2,000 characters. It writes `team_note`, `team_note_by` and `team_note_at`. The page labels it *"Team only. Never shown to the reporter."* (§8.5).
- Both answer a browser with `303` back to `/api/team#r-<publicId>` (the report stays in view). A JSON caller gets `200` with the new row. Bad input gets `400` with field names only, and never echoes the note (the `reports.ts` convention).
- **What Done does once a report is tied to a cat** is added in PR 5.

### PR 3: Finding a cat, and the team's view of a cat (read-only)

- `GET /api/team/cats?q=` (`view_exact_location`): search by name (matched on the folded form, using PR 1's `foldName`) or SYR number. Up to 30 results, each with a thumbnail, name, SYR number and status.
- `GET /api/team/cats/:id` (`view_exact_location`): **the team's cat page**:
  - the derived status from `resolveCat`, exactly as the public sees it, plus the team-only detail behind it;
  - every sighting with its **exact** position and time;
  - every photo, through the team photo route;
  - **the full statement history**, newest first. Each statement shows what was said, who said it ("a spotter", a team member's name, with "(left)" if they've left, or "imported"), when, and its reason. Replaced statements stay visible, struck through, with what replaced them and why (§3.3: "the earlier statement stays visible underneath").
  - Notes and food-and-water answers from data spine PR 7 appear in the history once they exist; nothing here waits on them.
- **Team payloads never go through the public serialiser.** The team view builds its own shape in `lib/teamCatView.ts`. When data spine PR 6 adds `serialiseCat(cat, viewer)`, this becomes its `team` viewer. That way PR 6 has one more emitter to name, not a hidden fifth one. See "Where this collides with other work".

### PR 4: The corrections

Every action below is a form on the team cat page. Each is `requireOrigin(TEAM_ORIGIN)` plus `requireTeam(<capability>)`, and each **appends** a signed observation (`roleAtTime: "staff"`, `accountId` = the person's id) through `writeObservation`. Nothing is updated or deleted.

| Action | Capability | What it writes | Reuses |
|---|---|---|---|
| **Say the life status** (street · homed · in care · deceased) with a reason. "Deceased" asks for a reason and the date the team knows of; a date in the future is refused | `set_life_status` | `life_status` | PR 8's `POST /api/team/observations` logic, extracted into a shared function both the JSON route and the form call |
| **Say whether sterilised** (yes / no), with an optional date, clinic and reason. On screen: *"A clipped ear seen in a photo is never proof. Use this only when Syros Cats or a vet knows."* | `set_sterilisation` | `sterilised` | Same |
| **Mark a statement wrong**, from any row in the history, with a reason. For an ear-tip answer this is *"That's not a clip"* | Whatever capability the statement's kind needs (PR 8's `capabilityFor`) | A new statement of the same kind, with `supersedesId` set | PR 8's supersede, including its row lock and its "already corrected" `409`, shown as *"Someone already corrected this."* |
| **Rename the cat**, with a reason | `rename_cat` | `cats.name` updated **and** a `name` observation, in one transaction (Decision 5). A name another cat already has is refused, and the screen says which cat has it. The name passes the existing name moderation filter | The `routes/cats.ts` pattern |
| **Probably sterilised list** at `GET /api/team/likely`: cats at *Likely* with their evidence photos, newest first. Each has two buttons: **Looks right** (Decision 6) and **That's not a clip** (supersede) | `set_sterilisation` | `ear_tip { clipped: true }` agreeing (Looks right), or the supersede | PR 8's `GET …/review/likely`, changed in two ways:<br>• Photo URLs point at the team photo route; they don't load on the team domain today.<br>• **The list rule:** a cat is listed when the resolver says *Likely* **and** its newest active `ear_tip { clipped: true }` (newest by `createdAt`) was written by a spotter (`roleAtTime` not `staff`, `vet` or `admin`). When the newest one is the team's agreement, the cat is off the list. A newer spotter "clipped" puts it back.<br>The resolver itself is not changed, and the cat's public answer is the same with or without the agreement (P4-2) |

**This PR unblocks SYC-198.** The "Probably sterilised" answer can go public (`LIKELY_STERILISED_PUBLIC_LIVE`) once this screen and SYC-103 are live. **It also unblocks SYC-185**: staff can now record sterilised and homed, so the `OWNER_SECRET` route can retire. Both stay their own tickets.

### PR 5: "Which cat is this?" on a report (SYC-42 Slice 5.1)

- On each queue row: **This is a cat we know**. It opens the PR 3 search, prefilled with nothing, and the team member picks the cat.
- `POST /api/team/reports/:publicId/cat` (`change_report_state`). In one transaction it:
  - sets `cat_id`;
  - writes a `welfare_report` observation (`{ severity, isLitter, reportId }`, `observedAt` = when the report was submitted), **authored by the reporter's device**, or `system:welfare-report` if the device has been deleted (`DECISIONS.md` Part 2g). The reporter's note is **never** copied in (§8.4).
- Choosing a different cat later is a new tie. The first observation is superseded with the reason "tied to the wrong cat", so the cat's history stays honest.
- **Two people tying the same report at once.** `writeObservation` doesn't check for an earlier correction on its own; only the supersede route does, with a row lock. So the tie route does the same, in one transaction:
  1. lock the report row (`SELECT … FOR UPDATE` on `welfare_reports`);
  2. lock the current `welfare_report` observation, if there is one, the same way `routes/observations.ts` does;
  3. check it hasn't already been superseded, and that `cat_id` is still what the page showed.

  The second person gets *"Someone else tied this report a moment ago."* The lock shape is extracted from the supersede route into one shared helper rather than copied. SYC-199's database index stays the later backstop.
- **Closing a tied report** (PR 2's route) also writes `welfare_outcome { state, reportId }` authored by the staff member, in the same transaction as the state change. Reopening and closing again writes a second outcome. That is history, and nothing is emailed (Slice 3).
- **Neither kind changes a derived status** (§8.4). A test pins that.
- The queue row then links to the team cat page, and the cat's history shows the report (§3.1).

### PR 6: Hiding and restoring a photo (migration `photo_visibility`)

- **Database (next free number):** `photo_visibility_events`:
  - `id`;
  - `photo_id` → `photos.id`;
  - `action`, either `hide` or `restore` (checked);
  - `author`, text: a person id now, and later `report:<id>` for SYC-44;
  - `reason`, nullable;
  - `at`.

  It has an index on `(photo_id, at desc)`. Rows are never updated or deleted (Decision 3). Rollback: drop the table, which un-hides everything; the rollback block says so in capitals.
- On the team cat page, each photo has **Hide** or **Restore**: one tap, no "are you sure?" (§3.3), behind `hide_photo` or `restore_photo` and the Origin rule. A hidden photo stays visible to staff, marked *Hidden from the public by Susan, 4 Oct*.
- **`lib/photoVisibility.ts` is the only place visibility is decided.** It holds `hiddenPhotoIds(ids)` (one batched query) and `publicPhotoUrl(photo, hidden)`, the only builder of a public photo address. Every public reader goes through it, and a source test enforces that (see "Every place a hidden photo must stay hidden").
- When the hidden photo is a cat's main photo, the public sees the newest visible photo of that cat, or the placeholder (Decision 4). `cats.primary_photo_id` isn't changed, so a restore brings the original back.

---

## Every place a hidden photo must stay hidden

The guard on any one of these can fail without anyone noticing: a hidden photo still showing, with every test green. So each place gets a named test, and the test gets a mutation probe.

**A list written by hand misses places.** The first draft of this plan missed the notifications screen, which the review found. So the build doesn't rely on the list alone:
- **Every public photo address is built in one function**, `publicPhotoUrl()` in `lib/photoVisibility.ts`. It returns `null` for a hidden photo.
- PR 6 moves the five places that build `/api/photos/…` by hand today onto it:
  - `lib/catHelpers.ts:61` and `:290`;
  - `routes/cats.ts:275`;
  - `routes/sightings.ts:218`;
  - `routes/notifications.ts:144`.
- **A source test (P6-0) fails if the text `/api/photos/` appears in any file under `artifacts/api-server/src` apart from `lib/photoVisibility.ts`, `routes/photos.ts` and tests.** A new place that builds a photo address by hand turns that test red, even if nobody remembered to add it to the list.

The places known on `main` today:

1. `GET /api/photos/:publicId`: a hidden photo answers `404`, exactly as an unknown id does.
2. `GET /api/cats` (list, `lib/catHelpers.ts:290`): the thumbnail falls back per Decision 4.
3. `GET /api/cats/:id` (detail, `routes/cats.ts:275` and `lib/catHelpers.ts:61`): the main photo and each sighting's photo. A sighting whose photo is hidden stays in the list but shows no photo.
4. The match candidates in `POST /api/sightings` (`routes/sightings.ts:218`), and the cat returned inline by `POST /api/sightings/:id/resolve`: candidate photos are what a spotter sees when choosing a match.
5. **`GET /api/notifications/:deviceId`** (`routes/notifications.ts:144`, `catPhotoUrl`): a device-authenticated public reader that joins straight to the main photo. Found by the review.
6. The hand-pick list "cats known around here" (SYC-119, once Slice B ships). It reads the same cat thumbnails as item 2, and P6-0 forces it through `publicPhotoUrl()`. Noted on SYC-119.
7. Push notifications (`lib/notificationFanout.ts`), if they carry a photo address. Checked during the build; if they don't, the test asserts that.
8. **Not affected, by design:**
   - the team routes, because staff see hidden photos;
   - the matching model's own reference images, because hiding is about what people see, not about identification (flagged in the PR for Samuel);
   - report photos, which were never public.

## Every place "a report photo never leaves the team" must hold

This carries SYC-42's list forward:
- the public photo route (SYC-42 test 9, already on `main`);
- the alert email (test 11);
- the queue's JSON and HTML, which carry only `/api/team/report-photos/<publicId>` URLs, never bytes and never a public URL (test P1-4 below);
- the team report-photo route itself (test P1-3);
- PR 5's tie, which copies **no** photo;
- any export (none exist; a review check).

## Where this collides with other work

| Other work | Where it meets this plan | What this plan does |
|---|---|---|
| **Data spine PR 6, blurring** (`serialiseCat`, feeding-site privacy; queued) | PR 3's team cat view is a new place cat positions are sent. PR 6 makes "every emitter goes through `serialiseCat`" a rule. PR 6 also edits the same public emitters PR 6 here (hiding) must filter: `lib/catHelpers.ts` and `routes/cats.ts` | Team views get exact positions **only** behind `view_exact_location`, and are named in PR 6's emitter list as its `team` viewer. **PR 6 (hiding) is built after data spine PR 6 merges**, so the photo filter goes into `serialiseCat` once, not into four functions twice. If data spine PR 6 slips, hiding goes first and PR 6 inherits the filter. No feeding-site data is shown anywhere in this part |
| **SYC-63, deletion** (queued) | It clears `welfare_reports.reporter_device`. That breaks nothing here: "contact left" reads `reporter_contact_id`, and drafts are grouped by report, not device. PR 5 authors `welfare_report` as `system:welfare-report` when the device is gone. Staff ids in `report_state_events`, `team_note_by` and observations aren't personal data of a spotter, and stay | The SYC-63 build's checklist gains: "a welfare report with no device still shows and still ties to a cat" (test P5-3 covers this side) |
| **SYC-131 and SYC-104, removing people** (Backlog) | Decision 7 turns "remove" into "mark as left" | SYC-131 becomes db-ops `people-mark-left`, and SYC-104's screen uses "Mark as left". Both tickets are updated. PR 0 provides `markLeft()` for both |
| **SYC-101, folded names** (queued) | PR 3's search and PR 4's rename both check names | Both call `foldName` (PR 1's) and the uniqueness check that exists when they're built. SYC-101 moves the check in one place (Decision 5) |
| **Data spine PR 7, sighting questions** (in flight: `routes/sightings.ts`, `openapi.yaml`) | The team cat page shows its `note` and `food_and_water` answers | No shared files: this plan doesn't touch `sightings.ts` or `openapi.yaml`. All team routes stay out of `openapi.yaml`, by the #68 rule |
| **Data spine PR 9, push coarsening** (queued) | `notificationFanout.ts` (item 6 above) | Item 6's test is written against whichever version is on `main` |
| **SYC-151, match record** (#59, #70, #71) | A future "Matched by hand" list reads it | Not used here; SYC-152 |
| **SYC-44, Report an issue** (Backlog) | Hides a photo on one public report | Writes into PR 6's `photo_visibility_events` with author `report:<id>`, so there's one hiding mechanism. Noted on SYC-44 |
| **SYC-163, more photos per cat** | Leave room for `add_photo` and `set_primary_photo`, and for a gallery on the cat page | The team cat page already shows every photo as a gallery. No capability is added before SYC-163's spec says what it means |

## What this part does not do

| Not here | Where it goes |
|---|---|
| Reporter emails, contact yes/no, reporter delivery state, the optional team sentence on *Done* | SYC-42 Slice 3. PR 1's `reporter_message` column is ready for it |
| "Use this photo on the cat" (SYC-42 Slice 5.2) | **SYC-203**, built with SYC-163. A promoted photo has no sighting, so nothing on a cat's page would show it until SYC-163 designs how extra photos appear |
| The feeding-site map, the public/private switch, colony names | SYC-43 part 3 (spec §3.2, §3.4) |
| Managing people | SYC-104 |
| "Matched by hand" list, moving a sighting | SYC-152, SYC-150 |
| Data requests (deletions by email) | With SYC-63's staff action (spec §3.5) |
| Banner for sign-in rate limits crossed on the Worker | **SYC-202**. Needs the Worker to report crossings to the API. Mail failures are covered in PR 1 |
| Re-reading a cat's colour when its main photo is hidden | **SYC-161** (coat colour from the main photo), commented there |
| A database-level guarantee of one correction per statement | SYC-199 |
| Ready-made admin tools as an alternative to these screens | SYC-207 (Samuel, Decision 1) |
| Forgetting a former staff member without breaking links | SYC-208 (Decision 7's risk) |

## What works with no signal

Precisely: **nothing on the dashboard works offline.** Every screen is drawn by the server when it's opened, and every button sends a form. With no signal, the page doesn't load, or a button tap fails with the browser's own "no connection" page, and nothing is recorded. The phone's back button returns to the last page, and that page may be out of date. No change is queued for later. The dashboard says nothing to suggest otherwise. An offline volunteer view belongs with the volunteer role (spec §7.2, §7.3: "explicitly not built now").

## Tests

API tests use supertest against the real app and CI's Postgres, as part 1 did. `lib/db` tests use the throwaway database built from the real migrations. SYC-42 test numbers are kept where this plan carries them out. Each mutation check (**M**) is done once by hand before merge: break the line, watch the named test go red, put it back.

**PR 1**
- **P1-1 [SYC-42 #27, §8.6 #12]** A walk test: every `/api/team/*` route registered on the router (read from the router itself, not a hand-written list) returns the identical `401 not_signed_in` without a session, and with a session for a person who has no `staff` scope. **M:** register one new route without `requireTeam` → red. Reading routes from the router uses Express's internal `router.stack`, which isn't public and has changed shape between versions. So the test also asserts that it found at least as many routes as a fixed minimum (the routes this part adds). If an Express upgrade makes it find none, it fails instead of passing on an empty list.
- **P1-2 [SYC-42 #28]** Urgent above attention, then newest. Closed reports are below open ones. Drafts appear only under "Started but not sent".
- **P1-3 [§8.6 #12, team half]** The team report-photo route serves the bytes with a session and `401`s without one. `GET /api/photos/<report photo publicId>` is `404`. **M:** make the team route read `photos` → red.
- **P1-4 [SYC-42 #30]** Neither the queue HTML nor its JSON contains a reporter address, a device id, or any photo URL outside `/api/team/`. A seeded report with a contact row proves this once Slice 3 exists. Until then, the test asserts the columns are never selected. **M:** add `reporterDevice` to the queue's select → red.
- **P1-5** Every response has the team headers. The security header now includes `img-src 'self'` and still has no `script-src`. **M:** add `script-src 'self'` → red.
- **P1-6** The words "escalate", "assign", "due", "on call" and "urgent alert" don't appear anywhere on the page (§3.1, §3.6, F1).
- **P1-7** The mail banner shows for a `failed` alert or one an hour overdue, and not otherwise.
- **P1-8** A note containing `<script>` renders as text. **M:** remove the escape → red.
- **P1-9** The migration's rollback restores the schema exactly; up/down/up passes (the runner's harness).

**PR 2**
- **P2-1 [SYC-42 #29]** A state change writes exactly one `report_state_events` row carrying the signed-in person's id.
- **P2-2** Two people move the same report at once, from the same `from`: one wins, the other gets the "someone else changed this" answer, and there is one event. **M:** drop `WHERE state = :from` → red.
- **P2-3** POSTs with a missing Origin or a wrong Origin (including `https://evil.catspotters.com`) are refused with the identical 401. **M:** accept a missing Origin → red.
- **P2-4** Moving to *Looking at it*, *Done* or *Nothing needed* puts nothing in `mail_outbox` (until Slice 3).
- **P2-5** A draft can't be moved. A state outside the four is refused.
- **P2-6** A person marked as left after changing a report: the report still shows, attributed to "Maria (left)". Hard-deleting that person is refused by the database link (Decision 7). **M:** drop the link from the migration → red.

**PR 3**
- **P3-1** Search finds `Μιμή` by `μιμη`, `ΜΙΜΗ` and `mimi`… (only what `foldName` actually folds, no Greek/Latin look-alikes, per Part 2j), and by `SYR-0012`.
- **P3-2** The team cat page shows exact sighting positions. The **public** `GET /api/cats/:id` for the same cat is byte-for-byte unchanged by this PR (compared against a snapshot taken before the PR). **M:** route the public detail through `lib/teamCatView.ts` → red.
- **P3-3** A superseded statement appears with the statement that replaced it and its reason.
- **P3-4** A person who has left → their name with "(left)". `system:*` → "imported" or the right label. A spotter → "a spotter", never a device id.

**PR 4**
- **P4-1** Each form writes exactly one observation with `roleAtTime: staff`, the person's id and the reason. Nothing in `observations` is ever updated (the append-only trigger stays the backstop).
- **P4-2** After *That's not a clip*, the cat reads *Not known yet*. After *Looks right*, it's still *Probably sterilised* and off the review list. A newer spotter clip puts it back on. The cat's resolved answer is identical before and after *Looks right*. **M:** drop the "newest clipped is a spotter's" rule → red (the cat stays listed).
- **P4-3** Rename: the column and the `name` observation are written together, or neither is (a forced failure in the second write leaves the old name). A clash with another cat's name is refused. **M:** write the column outside the transaction → red.
- **P4-4** Each form is refused without its capability. Using a person whose scopes grant nothing: the identical 401, and no write.
- **P4-5** The Likely list's photo URLs are all under `/api/team/photos/`. **M:** restore the `/api/photos/` URL → red.
- **P4-6** The life-status and sterilisation forms and PR 8's JSON route produce identical rows for the same input (one shared function).

**PR 5**
- **P5-1 [SYC-42 #40]** Tying writes one `welfare_report` authored by the reporter's device, with no note text. Closing a tied report writes `welfare_outcome` by the staff account. Neither changes the resolved status. **M:** copy the note into the value → red.
- **P5-2** Re-tying to another cat supersedes the first `welfare_report`, and the old cat's history shows why.
- **P5-3** A report whose `reporter_device` is null ties as `system:welfare-report`.
- **P5-4** Six concurrent re-ties of one report to different cats: exactly one succeeds, the rest get the "someone else" answer, and exactly one superseding observation exists. **M:** remove the row lock → red (the pattern of #68's six-way test).

**PR 6**
- **P6-0** The source test above: no `/api/photos/` text outside `lib/photoVisibility.ts`, `routes/photos.ts` and tests. **M:** put the hand-built URL back in `routes/notifications.ts` → red.
- **P6-1…P6-7** One test per public reader (items 1–7 above): hide → gone, restore → back. **M** on each: bypass `publicPhotoUrl()` at that site → that test red.
- **P6-7b** Hiding the main photo shows the newest visible photo, or the placeholder (Decision 4). Restoring brings the original back.
- **P6-8** Staff still see a hidden photo, labelled with who hid it and when.
- **P6-9** Events are only ever inserted. Hide → restore → hide gives three rows.

**In a real browser, before each PR with a screen opens (1–6):** sign in through a locally minted hand-off pass on a dev build, with seeded reports and cats that include photos. Check at **~390 px and at desktop width**, with data: urgent at the top, photos loading, each button doing what it says and returning to the same report. Screenshots go in the PR. Browser flows need a browser: curl alone missed a live sign-in bug once (SYC-25).

## Rollout

For each PR, in order, after its own review:
1. Merge. CI runs `migrate:check`, the migration tests and the API tests.
2. PRs 0, 1 and 6 only: db-ops `migrate` on development, then a Neon snapshot of production, then db-ops `migrate` on production and `verify`. **Migrate before publish**, as with 0003 and 0004.
3. Samuel pulls into the EU Replit project and publishes. Then db-ops `smoke`.
4. **Probe (Claude):** `curl` every new `/api/team/*` route without a session → `401 not_signed_in`. `curl` a report photo's public URL → `404`. After PR 6, hide a test photo and `curl` its public URL → `404`, then restore it.
5. **Once SYC-103 lets staff in:** Samuel signs in and walks the queue on his phone. Then he shows Susan or Jacky, and their first real use is the acceptance test.

**Rolling back:** revert the PR. The PR 1 and PR 6 migrations have commented rollbacks. Take a snapshot first once real state changes or hides exist; undoing PR 6's migration un-hides every photo, and the rollback block says so.

## Model delegation

Session model for this plan: **Opus 5.5** (the brief named Sonnet for planning; this session ran on Opus). For the build, work goes to the cheapest tier that can do it, with the reasons stated wherever it goes up.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| PR 0 marking people as left (migration, `people.ts`, command) | **Opus** | *Escalated:* it changes who is allowed in, and a missed reader is a silent security hole (a leaver who can still sign in) | P0-1…P0-5 with **mutation probes** on P0-1 (both functions) and P0-2; the walk-through of every reader of the people list (hand-off, `requireTeam`, Worker question); independent review |
| PR 1 migration, schema, rollback block | Sonnet | Two plain tables/columns, following `0004`'s pattern | `migrate:check`, P1-9 up/down/up; the session model reads the generated SQL line by line |
| PR 1 page frame, queue page, team photo routes | Sonnet | Server-rendered HTML following part 1's page; queries over one table | P1-1…P1-8 with their **mutation probes** (P1-1, P1-3, P1-5, P1-8); browser check at 390 px and desktop; Opus spot review of the diff |
| PR 2 state and note routes | Sonnet | Two form routes with a conditional update | P2-1…P2-6, **mutation probes** on P2-2, P2-3, P2-6; Opus spot review |
| PR 3 search and team cat view | Sonnet | Reads through existing `loadCatRecords` / `resolveCat` | P3-1…P3-4; P3-2's byte-for-byte check guards the public payload; browser check |
| PR 4 corrections (extract PR 8's shared function, forms, rename, Likely list) | Sonnet | Calls already-reviewed write paths | P4-1…P4-6, **mutation probe** on P4-3; Opus review of the extraction, because a mistake there silently changes the JSON route's behaviour (P4-6 pins it) |
| PR 5 tying a report to a cat | Sonnet | Two `writeObservation` calls in one transaction | P5-1…P5-3, **mutation probe** on P5-1; Opus spot review |
| PR 6 photo hiding across every public reader | **Opus** | *Escalated:* a missed reader is a silent failure (a hidden upsetting photo still public, every test green). The work is finding every reader, not writing the filter | The reader list above, P6-1…P6-9 with a **mutation probe at every site**; the independent review below is told to hunt for readers not on the list |
| Rendering repetitive HTML table/row markup and test fixtures (seeded reports and cats) | Haiku | Mechanical boilerplate against a fixed shape | Typecheck plus the PR's own tests; the session model reviews the diff |
| Adversarial review of each PR before merge | Sonnet, in its own worktree, never shared | Equal tier to the builder, focused on refuting the changes | Findings folded in and listed in each PR; the session model checks each one |
| Production steps (migrate, snapshot, probes) | Session model | Production data, not delegated | Rollout step 4's probes |

## Crash-proofing for the build

Each PR is built in its own worktree off fresh `origin/main`, with one commit per numbered item, and a `CHECKPOINT.md` (what's done, what's next) updated after each commit. Every agent prompt restates "commit after each item". Agents don't spawn nested agents.

## Review

A Sonnet critic reviewed this plan in its own worktree, against the spec, `DECISIONS.md`, the SYC-42, part 1 and data spine plans, and the code on `main` (`a7eec8f`). It found two blockers, one major and two minor issues. The session model checked each one against the code before folding it in.

| # | Severity | Finding | What changed |
|---|---|---|---|
| 1 | Blocker | **"Looks right" couldn't take a cat off the review list as written.** The resolver treats a team "clipped" exactly like a spotter's, so the cat stays *Likely*, and the review list is driven only by the resolver. The plan named no rule that would remove it. Confirmed in `lib/resolve.ts` (`resolveSterilised`: `isAuthoritativeRole` applies only to `clipped: false`). | Decision 6 now says leaving the list is the list's rule, not the resolver's. PR 4 states the exact rule: listed only while the newest active "clipped" is a spotter's. P4-2 checks that the public answer is unchanged, with a mutation probe. |
| 2 | Blocker | **A public place showing photos was missing from the "hidden stays hidden" list:** `GET /api/notifications/:deviceId` builds a main-photo address by hand (`routes/notifications.ts:144`). | Added as item 5. The session model's own check (grepping for `/api/photos/`) found five places that build the address by hand, not one. So the fix is structural: one builder, `publicPhotoUrl()`, and a source test (P6-0) that turns red if any other file builds the address. A forgotten place now fails a test instead of relying on the list. |
| 3 | Major | **Re-tying a report had no protection against two people doing it at once.** `writeObservation` doesn't check for an earlier correction; only the supersede route locks the row (#68's double-supersede fix). | PR 5 now locks the report and the current observation in one transaction, using a helper shared with the supersede route. New test P5-4: six at once, exactly one wins, with a mutation probe. |
| 4 | Minor | Three "nothing leaks" checks had no mutation probe: P1-4, P3-2 and P4-5. | Each has one now. |
| 5 | Minor | The route walk test relies on Express internals and could silently find no routes after an upgrade. | P1-1 now also requires a minimum route count, so an empty walk fails. |

**Checked and confirmed correct by the critic:**
- the pre-launch gate claim: `/api/photos/*` is gated and `/api/team/*` is exempt;
- the current security header;
- `requireOrigin` works as a defence against cross-site form posts with plain HTML forms. Browsers send `Origin` on form POSTs, and the URL-encoded body parser is registered app-wide before the routes;
- the 12 capability names;
- `photos` has no hidden column, and `cats.primary_photo_id` is not null;
- the two `name` writes in `routes/cats.ts`;
- the `welfare_reports` columns;
- `0007` as the next migration, with PR 7 adding none;
- `serialiseCat` doesn't exist yet;
- the append-only trigger;
- `capabilityFor`;
- the SYC-119 "already exists" wording;
- Replit's `/api`-only routing;
- the canonical facts and the offline section.

It found no part of spec §3.1 or §3.3 dropped without being named in "What this part does not do".
