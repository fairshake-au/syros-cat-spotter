# SYC-53: roles and invites (guardians, the team, management)

**Status: draft for Samuel's approval. Nothing is built yet.** Six questions below need Samuel's answer before the build starts (see "Decisions for Samuel"); each has a recommendation.
**Spec:** `docs/specs/roles-and-invites.md`, approved by Samuel on 12 October 2026 (PR #102, merging once CI is green). This plan builds it as written. Where the spec and the code on `main` disagree, the plan says so in "Where the spec and the code disagree" and asks, rather than deciding quietly.
**Builds on:** `team-access-and-welfare-queue.md` (sign-in, the people list, the welfare queue), `cat-record-data-spine.md` (observations, the resolver, colonies), `DECISIONS.md` Parts 2i, 2k and 3, and the two SYC-43 plans (`syc-43-part-1-people-and-staff-sign-in.md`, `syc-43-part-2-welfare-queue-and-corrections.md`), whose format this plan follows.
**Linear:** SYC-53 (this plan). Builds SYC-213, SYC-222, SYC-252, SYC-251, SYC-104 and SYC-254, and the guardian half of SYC-54. Touches SYC-208, SYC-209, SYC-2, SYC-130, SYC-253, SYC-256, SYC-257, SYC-263, SYC-278, SYC-283, SYC-284. SYC-188 and SYC-131 are done and are built on.
**Checked against:** `origin/main` at `00271a6` (12 October 2026), the open PRs (#102, #103, #104, #107, #109, #111, #115), the sign-in Worker in `fairshake-au/catspotters-website` (`admin/src/index.js`), and Linear SYC-53 with its comments and the tickets above. Every "exists today" claim names the file it was read in.

---

## In plain English

Today only the Syros Cats team can sign in to the dashboard, and every team member can do everything on it. This plan opens the dashboard, carefully, to **cat guardians**: the people who feed and look after a colony every week. It also splits off a small **management** group (Samuel, Jacky and Susan on day one) who decide who gets in.

When it is all built:

- **Management invites people from a screen**, not by asking Claude to run a command. Susan types Eleni's email address, picks "cat guardian" and Eleni's colony, picks Greek, and taps *Send invitation*. Eleni gets a plain email in Greek that tells her where to go. It holds no secret. She signs in the way the team already does, reads three short promises, and taps *Yes, join*.
- **A guardian sees her own colonies in full and nothing else.** Exact positions of her cats and feeding sites, which cats are done, photos, cat-in-trouble reports about her cats (read only, never who sent them). Everywhere else on the island looks to her exactly as it looks to a tourist. If she follows a link to a team page she gets a polite "that part is for the Syros Cats team; your colonies are here", never a confusing sign-in loop.
- **What a guardian says counts at once**, with her name on it: "she's sterilised" makes the cat *Confirmed*; "I looked at her ear, it looks clipped" makes the cat *Probably sterilised, checked in person*; "she's been homed", "she's died", "this cat is one of mine", "this one isn't". Nothing waits for the team. The team sees every change in a list, and can mark any of them wrong.
- **The one thing a guardian asks the team to decide** is making a feeding site public. That goes into a short "Needs an OK" list.
- **On a hillside with no signal**, a guardian or team member can open a saved list of her colonies' cats and the exact places of the bowls, kept on the phone for 72 hours and then deleted.
- **Every change to who can get in is written down** and can't be edited, and the other managers get a short email every time someone is invited, changed, brought back or removed.

Nothing changes for spotters. They never sign in, and never will.

**How it is built.** Foundations first, so that nobody can be given a power before the checks that limit it are in place. Then invitations, then the guardian's own pages, then the things she records, then the saved offline list. Each step is its own pull request, can ship on its own, and leaves the app safe if the next step is late.

### What Samuel, the team and guardians notice, step by step

| After | What people notice |
|---|---|
| **The docs PRs** | Nothing. The approved specs agree with each other |
| **Foundations (Slice 0)** | Almost nothing. Samuel, Jacky and Susan become management. Anyone else on the team no longer sees "manage people" in their capabilities (there is no people screen yet, so nothing visible moves). Guardians still can't sign in |
| **The new sign-in Worker** | Nothing for the team. The sign-in page can now tell "workspace" from "dashboard", ready for guardians |
| **Invitations and the people screen (Slice 1)** | Management can invite, change, bring back and remove people from the dashboard, and gets an email when another manager does. The first guardian can be invited, accept, and land on an empty "My colonies" page that names her colonies |
| **A guardian's own pages (Slice 2)** | A guardian sees her colonies' cats with exact positions, and can say a cat is sterilised, homed, in care or has died |
| **What a guardian records (Slice 3)** | Field checks ("it looks clipped"), the "Needs a look" list, cat-in-trouble reports for her own cats, and asking for a site to be made public |
| **The colony view (Slice 4)** | The saved list that works with no signal, and a printable round sheet |
| **The small things (Slice 5)** | Management sees a banner if someone prints far more round sheets than a colony needs |
| **Owners (Slice 6, after SYC-130)** | A resident who says a cat lives with her can confirm it is sterilised |

---

## What exists today, and what this plan needs

| Needed | Exists on `main`? | Evidence |
|---|---|---|
| One list of people, with roles as rows | **Yes.** `people` (id, email, name, session_version, added_at/by, left_at/by) and `person_scopes` (person_id, role, colony_id). Roles allowed: `staff`, `guardian`, `volunteer`, `vet` | `lib/db/src/schema/people.ts` |
| Marking someone as left, rejoining, sign out everywhere | **Yes**, in `peopleStore` (`addPerson` rejoins a left address, `markLeft`, `signOutEverywhere`, `removePerson` only for someone with no history) | `lib/db/src/people.ts` |
| A history of people changes (`person_events`) | **No.** SYC-213 is in Backlog | `grep person_events` finds nothing |
| A capability check | **Yes, staff-only.** `can()` ignores its target and answers "holds `staff`?"; 12 capability names; `mayEnter()` = holds any capability | `artifacts/api-server/src/lib/capabilities.ts` |
| Dashboard guard | **Yes.** `requireTeam(capability?)`. Every refusal, including "signed in but not allowed", is the same 401 and sign-in redirect | `middlewares/requireTeam.ts` |
| Workspace and dashboard as separate doors | **No.** `POST /api/internal/people/allowed` answers one yes for `mayEnter`; the Worker turns any yes into a workspace session, and the dashboard is a button inside the workspace | `routes/internal.ts`; Worker `admin/src/index.js` lines 289–390 |
| Team routes | 19 routes under `/api/team/` (list below). Welfare queue, report list, report photos, catalogue photos, cat search and cat page all use `requireTeam("view_exact_location")`; corrections use their own capability; two JSON observation routes use `requireTeam()` and call `can()` inside | `routes/team.ts`, `teamReports.ts`, `teamCats.ts`, `teamCorrections.ts`, `teamPhotos.ts`, `observations.ts` |
| A route-walk test | **Yes, for "not signed in" only.** Walks the router and expects the same 401 | `routes/team.walk.test.ts` |
| One list of team roles | **No, three.** `AUTHORITATIVE_ROLES` (`vet`, `staff`, `admin`) in `lib/resolve.ts:132`; `TEAM_ROLES` (same three) in `lib/teamCorrections.ts:214`, imported by `lib/likelyReview.ts`; `"staff"` hard-written into `roleAtTime` in `teamCorrections.ts` (4 places), `welfareActions.ts:81`, `welfareTie.ts:188` and `routes/notifications.ts` (2, the owner-key route) | as listed |
| Observations can be written as `guardian` | **No, refused on purpose.** `REACHABLE_ROLES` is `public`, `staff`, `admin`, `system` | `lib/observations.ts:52` |
| `authority_scope` on an observation | **Yes, but a fixed word list**: `none`, `guardian_of_this_cat`, `owner_of_this_cat`. Not a colony id | `lib/db/src/schema/observations.ts:40`, `lib/observations.ts` `AUTHORITY_SCOPES` |
| The `colony` observation | **Yes**, `{ colonyId: number }`. No "no colony" value | `lib/observations.ts:214` |
| Colonies and feeding sites | **Tables yes, screens no.** `colonies` already has `created_by` (text) and `guardian_name`; `feeding_sites` has no "retired" flag and no "how to find it" line. No route creates a colony or a site | `lib/db/src/schema/colonies.ts`; SYC-209 builds the screens |
| A private photo store | **Yes, for report photos only**: `welfare_report_photos` (bytes in Postgres, served only by `/api/team/report-photos/:publicId`) | `lib/db/src/schema/welfare.ts:110` |
| Mail purposes | 12 purposes; recipients are `team`, `unverified_public` or `verified_public`. None names a person on the list | `lib/mail/send.ts` |
| Dashboard pages | Server-drawn HTML, no scripts, `default-src 'none'`, `no-store`, English, `en-GB` dates | `lib/teamAuth/refuse.ts`, `lib/teamPages/*` |
| Dashboard session | 30 days, `__Host-cs_team` cookie | `lib/teamAuth/session.ts` |
| The `people` command and db-ops | `people-add`, `people-list`, `people-mark-left`, `people-remove`, `people-sign-out-everywhere`; `--role` accepts `staff`, `guardian`, `volunteer`, `vet`, and guardian needs no colony | `lib/db/src/people/cli.ts`, `scripts/db-ops.sh:369` |

**The team routes on `main` today** (the route walk in Slice 0 must cover each, and fail on any it doesn't know): `POST /team/handoff`, `GET /team`, `GET /team/me`, `POST /team/signout`, `GET /team/reports`, `GET /team/report-photos/:publicId`, `GET /team/photos/:publicId`, `POST /team/reports/:publicId/state`, `POST /team/reports/:publicId/note`, `POST /team/reports/:publicId/cat`, `GET /team/cats`, `GET /team/cats/:id`, `POST /team/cats/:id/life-status`, `POST /team/cats/:id/sterilisation`, `POST /team/statements/:id/wrong`, `POST /team/cats/:id/name`, `GET /team/likely`, `POST /team/likely/:id/looks-right`, `POST /team/photos/:publicId/hide`, `POST /team/photos/:publicId/restore`, `POST /team/observations`, `POST /team/observations/:id/supersede`, `GET /team/observations/review/likely`; and `/internal/people/allowed`, `/internal/mail/drain`.

### Migrations, and what has merged

- **On `main`: `0000`–`0014`.** `0012_keep_my_spots_safe` (**SYC-3 Slice 1 has merged**, #106, plus #114), `0013_deletion_unlinks_people` (**SYC-63 has merged**, #97), `0014_photo_visibility` (SYC-43 part 2 PR 6). Checked with `git log origin/main` and `lib/db/migrations/`.
- **Open PRs add no migrations.** #115, #109 touch app and campaign code; #102, #103, #104, #107, #111 are docs only (checked with `gh pr view --json files`).
- **This plan adds three migrations, in this order:** `person_events` (Slice 0, PR 0.1), `roles_and_invites` (Slice 0, PR 0.3), `field_check_photos` (Slice 3, PR 3.1). Each takes the next free number when it is generated after rebasing on the latest `main`, never by hand (`lib/db/migrations/README.md`). SYC-209's own migrations (retiring a site, the "how to find it" line) are SYC-209's and may land in between; nothing here depends on their numbers.

---

## Where the spec and the code disagree

The spec was written against `main` on 7 October. These are the places where building it literally would not work, or would need something the spec says it doesn't touch. None changes what anyone experiences; each is a "how", and each has a recommendation in "Decisions for Samuel".

| # | The spec says | The code says | Effect |
|---|---|---|---|
| **C1** | §15.2 step 5: the migration adds `management` rows for Samuel, Jacky and Susan | Migrations run on every database (CI's throwaway one, development, production), and these three people exist only in production and development, under different ids. Writing their addresses into a migration puts personal data in the repository | Decision A |
| **C2** | §7.3, §10.4: a guardian's statement is written with "`authorityScope` = that colony" | `authority_scope` is text with a fixed list (`none`, `guardian_of_this_cat`, `owner_of_this_cat`), checked in `writeObservation`. There is no place for a colony id | Decision B |
| **C3** | §7.3 point 3: the field-check photo "is stored in private storage, referenced only from the field-check observation"; §10.5: "photo storage" is not touched | The only private store is `welfare_report_photos`, tied to a report. `observations.photo_id` points at the public `photos` table, which public routes serve | Decision C |
| **C4** | §15.1 lists colony routes (`colonies/:id/cats`, `guardian-changes`, creating a colony) as this spec's routes | SYC-209's approved spec (PR #103, §11.2) lists the same routes as its own: `POST /api/team/colonies`, `POST /api/team/colonies/:id/cats`, the Colonies page and its "Recent guardian changes" list. And no route creates a colony today, so management has no colony to invite a guardian to | Decision D |
| **C5** | §7.1: "Needs a look" is sorted by how close each cat is to where the phone is now | Dashboard pages have no scripts (`default-src 'none'`), and a page can't learn the phone's position without one | Decision E |
| **C6** | §1 table: "The offline colony view itself (what is on the screen)" belongs to SYC-54, "to be specified" | SYC-54 has no spec; its ticket still says "volunteer" and "reuse the existing offline queue" (the app's, which this spec rules out) | Decision F |
| **C7** | §10.5: "`colonies` records who created each one (`created_by`)" is a new column | `colonies.created_by` already exists (text, nullable) | None. No column to add; Slice 3 writes it with the creator's person id |
| **C8** | §4.1: the invitation comes "from `Cat Spotters <signin@mail.catspotters.com>`" | The API's transactional sender is `Cat Spotters <hello@mail.catspotters.com>`; `signin@` is the Worker's. Both are on the verified `mail.catspotters.com` domain | None. Slice 1 adds `signin@` as the `person_invite` sender, as the spec says; the probe after deploy confirms Resend accepts it |
| **C9** | §6.3: a guardian who signs in "goes straight to the dashboard" | The Worker's only way to the dashboard is a button inside the workspace. A dashboard-only person needs a new Worker path that mints the hand-off pass and sends her on without a workspace session | Built in the Worker PR (W1), in the other repository |

---

## Decisions for Samuel

Six, all about *how* to build what is approved. None reopens a decision in the spec.

### Decision A: how Samuel, Jacky and Susan become management (C1)

**The question.** The spec says the migration itself adds the three management rows. Migrations run against every database, including the throwaway one CI builds, and would need the three people's addresses or ids written into the code.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A1. The migration adds the role; Claude adds the three rows straight after, with the `people` command (recommended)** | The migration makes `management` a valid role and changes nothing else about who holds what. Then Claude shows Samuel the list (the three, and every other team member, who will be team-only) and, once he says yes, runs `db-ops people-set-roles` for the three, on development and then production | No personal data in the repository. Works on every database. The list Samuel approves is the live list on the day, not one copied a week earlier. The same command is the break-glass later | Two steps instead of one. Between them, nothing changes: the code that makes inviting and removing management-only ships in a later PR, so the old rule (every team member can do it) still applies until the three hold the role |
| A2. The migration adds the rows, matched by email address | One step | Addresses of three people in the repository and in its history. Does nothing on CI's database, so the test that "exactly three people hold management" can't run there |

**Recommendation: A1.** The spec's intent (exactly three, from a list Samuel has seen) is kept exactly; only the tool changes.

**What people notice.** Nothing either way.

### Decision B: how a guardian's statement records which colony gave her authority (C2)

**The question.** The record keeps who said what and in what role. For a guardian's "she's sterilised", the spec wants it also to keep *which colony* made her an authority on that cat, because the cat might move colonies later.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **B1. Use the existing `authority_scope` text, with a value like `colony:12` (recommended)** | The word list `writeObservation` checks gains one shape: `colony:<id>`. `guardian_of_this_cat` is left for the claim feature (SYC-130) | No change to the observations table, which the spec says is not touched. The colony is on the statement for ever, exactly as the spec asks | One more shape to check. A small amendment to the data spine's §10.1 word list (added to docs PR D1) |
| B2. `authority_scope = guardian_of_this_cat`, and the colony id inside the statement's value | Uses a word already in the list | Every kind of statement a guardian can make (sterilised, ear tip, life status, colony, colour) carries the colony in a different place, and the value shapes `writeObservation` checks all change |
| B3. A new `authority_colony_id` column | The cleanest to query | A change to the observations table, which the spec says this work does not touch, and a migration on the biggest table |

**Recommendation: B1.**

**What people notice.** Nothing. The team's cat page shows "Confirmed by Eleni, cat guardian, 14 October" either way.

### Decision C: where a field-check photo is kept (C3)

**The question.** A guardian's "it looks clipped" can carry a photo. The spec says it must never be public. The only private photo store today belongs to cat-in-trouble reports.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **C1. A small new table, `field_check_photos`, shaped like `welfare_report_photos` (recommended)** | Bytes in Postgres, a random public id, served only by a new team route that checks the photo's cat is in a colony the person holds. The ear-tip statement points at it by that id inside its value, never through `photo_id`, so no public reader can ever join to it | Same proven pattern as report photos. Nothing that serves public photos can see it | A new table, and a migration (PR 3.1). The spec's §10.5 says photo storage is untouched; this is an addition next to it, not a change to it |
| C2. Put it in `photos` with a "private" mark | One photo table | Every public reader would have to filter it. A missed filter leaks a guardian's photo, with every test green: the same silent failure the photo-hiding work spent a whole PR guarding against |
| C3. No photo on field checks for now | Nothing to store | The spec offers the photo, and the team uses it to decide whether to mark a check wrong |

**Recommendation: C1.**

**What people notice.** Nothing different from the spec.

### Decision D: who builds the colony screens, and when a guardian can first be invited (C4)

**The question.** Two approved specs list the same routes. SYC-209 (feeding sites and colonies) owns the Colonies page, creating a colony, putting a cat in a colony, feeding sites and the "Recent guardian changes" list. The roles spec owns who may use them. Separately: a guardian is always invited *to a colony*, and today nothing can create one.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **D1. SYC-209's build owns those screens and routes; this plan owns the powers they ask for (recommended)** | This plan delivers the capability names, the rules for which colony a request is about, and one shared helper for "a guardian creates a colony and is placed on it, in one step". SYC-209's PRs call them. The first guardian invitation waits until SYC-209's "create a colony" PR is live; team and management invitations don't wait | One owner per screen. No two sessions build the same page. The roles plan stays about who, not what | Guardian invitations depend on another plan's timing. If SYC-209 slips, the first guardian waits |
| D2. This plan builds the colony screens too | Guardians can be invited as soon as invitations exist | Two plans for one set of screens; certain collision with the SYC-209 build |
| D3. D1, but Claude creates the first colonies with a db-ops command so guardians needn't wait | Unblocks the first guardian | A second way to create colonies, outside the history the team sees |

**Recommendation: D1**, with D3 kept as a fallback only if Samuel wants a guardian in before SYC-209's colony PR is live. Either way, the plan for SYC-209 should be written next, against this plan's Slice 0.

**What people notice.** With D1, management can invite team members as soon as Slice 1 ships, and guardians once colonies can be created.

### Decision E: how "Needs a look" is sorted before the offline pages exist (C5)

**The question.** The spec sorts the list by how close each cat is to the person now. The dashboard's pages have no scripts, so they can't ask the phone where it is.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **E1. Grouped by colony name on the plain dashboard page (the spec's own fallback); sorted by distance on the field pages in Slice 4, which are allowed a small script (recommended)** | Slice 3's list is grouped by colony. Slice 4's field page asks for the position (only if the person agrees), sends it with the request, and the server sorts and forgets it | No script on the main dashboard. The spec already says a list with no position is grouped by colony | The list isn't distance-sorted until Slice 4 |
| E2. A "near me" form where the person types a place | Sorting without a script | Clumsy on a phone |
| E3. Allow a script on the "Needs a look" page | Sorted from day one | Widens the no-scripts exception beyond the one path the spec allows it on (§12.2) |

**Recommendation: E1.**

### Decision F: does the saved colony view need its own short spec first? (C6)

**The question.** The roles spec fixes who may open the saved colony view, what a phone may keep, and how it is deleted. It leaves "what is on the screen" to SYC-54, which has no spec.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **F1. A short SYC-54 screen spec, through the usual review, before Slice 4 is planned in detail (recommended)** | One or two pages: the saved list's layout, the round sheet, what "connect to refresh" looks like, how a queued field check shows | Slice 4 is the riskiest part (the only scripts on the dashboard, a service worker, data on phones). The screen deserves the same care as the rules | A small delay to Slice 4, which doesn't block anything before it |
| F2. Build from the spec's §12.1 lists alone | Faster | Screen decisions made in code review |

**Recommendation: F1.** Slices 0 to 3 don't wait for it.

### Also needed from Samuel, not decisions

- **Before PR 0.3's production run:** approve the list of who becomes management and who becomes team-only (Decision A). Claude shows it from the live database.
- **Before Neon production steps:** switch the session to "ask" mode, so Claude can take the Neon snapshot before each production migration (the auto mode blocks Neon snapshot writes).
- **Johnny's date (SYC-283).** The plan proposes: Johnny gets the Greek and French of the invitation, accept page, 403 page and guardian pages on the day PR 1.1's English strings merge, and is asked to sign off within seven days. Target: **30 October 2026**. English can go live first.

---

## How it ships: the order

Foundations first, then invitations, then the guardian's pages, then what she records, then the offline list. Every PR is built in **its own worktree off fresh `origin/main`**, is **one PR**, and can merge alone. "Review and merge" uses `/ship`: an independent adversarial review in **its own worktree** (never shared with the builder or another reviewer), findings folded in, CI green, merge, Linear synced, worktree removed.

| Step | PRs | Needs first | Who notices |
|---|---|---|---|
| **Docs** | D1 data spine · D2 team-access · D3 `DECISIONS.md` · D4 roles-spec corrections from this plan's decisions | #102 merged; Samuel's answers to Decisions A–F | Nobody |
| **Slice 0: foundations** | 0.1 `person_events` · 0.2 one list of roles and the vocabulary · 0.3 the roles migration and the `people` command · 0.4 two doors (API) · **W1** the sign-in Worker · 0.5 the capability catalogue, strict checks, the 403 page and the route walk | D1–D3 merged before 0.2 | Almost nobody |
| **Slice 1: invitations** | 1.0 the dashboard's three-language strings · 1.1 inviting and accepting · 1.2 the people screen · 1.3 "My page" and "My colonies" | Slice 0 and W1 live | Management, then the first people they invite |
| **Slice 2: a guardian's own pages** | 2.1 her cats, in full inside her colonies, public outside · 2.2 what she says about a cat (life status, sterilised) | Slice 1; SYC-209's colony PR for the first real guardian (Decision D) | Guardians and the team |
| **Slice 3: what a guardian records** | 3.1 field checks (migration `field_check_photos`) · 3.2 "Needs a look" · 3.3 cat-in-trouble reports for her own cats · 3.4 asking for a site to be made public, and "Needs an OK" | Slice 2; 3.4 also needs SYC-209's feeding-site PRs | Guardians and the team |
| **Slice 4: the colony view with no signal** | 4.1 the field pages' own narrow script rule · 4.2 the saved list and the round sheet · 4.3 field checks made with no signal | Slice 3; a short SYC-54 screen spec (Decision F) | Guardians and the team |
| **Slice 5: the small things** | 5.1 round-sheet counts and the management banner · 5.2 hand-pick review for guardians | Slice 4; 5.2 waits for SYC-152 | Management |
| **Slice 6: owners** | 6.1 a cat owner confirms a sterilisation | SYC-130's spec approved and its claim built | Residents who own a cat |

**The rule from SYC-222 that orders all of this: no role other than the team holds any capability until Slice 0 has merged and is live.** PR 0.5 is where a guardian row first grants anything, and it can't merge before 0.3 (the database refuses an island-wide guardian) and 0.4 plus W1 (the old Worker can't hand a guardian the workspace).

---

## Before any code: the docs PRs (spec §17)

Each is a small docs-only PR, built from the spec's §17 text word for word, plus this plan's decisions once Samuel has answered them. **They are written first, in parallel with PR 0.1, and D1–D3 must merge before PR 0.2**, because 0.2 changes the record's vocabulary and the code should never be ahead of the approved docs.

**Collision:** PR #107 (SYC-130 "This is my cat") edits the same three files (`DECISIONS.md`, `cat-record-data-spine.md`, `team-access-and-welfare-queue.md`). Whichever merges second rebases. The sections don't overlap except the data spine's §4.2, where D1's sentence about owners must match what #107 says a claim is.

| PR | File | What it changes (spec §17) |
|---|---|---|
| **D1** | `cat-record-data-spine.md` | §6.5 the guardian row and the saved list (17.1.1); §4.2 who can confirm sterilisation, and field checks (17.1.2); §10.1/§10.4 vocabulary: `admin` → `management`, `guardian` live, `volunteer` retired, the *seen in person* marker and private photo reference, the authoritative roles (17.1.3), **plus Decision B's `colony:<id>` shape for `authority_scope`**; §10.5 the "no colony" value (17.1.4; `created_by` already exists, C7); §4.5 point 3 pointer (17.1.5); §3.2 guardian life-status undo and direct statements (17.1.6); §6.7 guardians see only their own sites (17.1.7) |
| **D2** | `team-access-and-welfare-queue.md` | §7.1–7.2 the roles (17.2.1); §7.3 the catalogue pointer, `view_welfare_queue`, `view_colony_welfare_reports` (17.2.2); §2.7–2.9 pending state, two doors, language (17.2.3); §2 and §8 the 403 page (17.2.4); §3 the welfare queue's capability and guardians' read-only reports (17.2.5) |
| **D3** | `DECISIONS.md` | Part 3 split the "Sign-in, trust boundary, roles" row (17.3.1); Part 2k amended by Decision 5 (17.3.2); Part 2i `match_cat_anywhere` reserved (17.3.3); **a new Part 2n, dated 12 October 2026**, carrying the §16.5 entries, plus the answers to this plan's Decisions A–F (17.3.4) |
| **D4** | `roles-and-invites.md` | The corrections this plan's decisions make to the roles spec itself: §15.2 step 5 (management added by the `people` command after the migration, Decision A); §7.3 and §10.4 (`authority_scope` = `colony:<id>`, Decision B); §7.3 point 3 and §10.5 (the `field_check_photos` table, Decision C); §15.1 (the colony routes belong to SYC-209, Decision D); §7.1 (grouped by colony until the field pages, Decision E); §10.5 (`created_by` exists, C7). Only the parts Samuel agrees to |

**The sibling specs (§17.4).** SYC-209 (#103) already carries the 12 October names (checked: its §7.2 cites `create_colony`, `assign_cat_to_colony` and the removed `propose_colony_change`). SYC-2 (#104) is checked for the four names and the dropped `confirm_appearance` when D1 is written; any gap is a one-line edit on #104 itself, not a new PR. SYC-130 (#107): a comment on the PR asks it to say that an owner's confirmation of sterilisation follows its claim (§17.4.3), so it is fixed in that PR before it merges.

---

## Slice 0: foundations (nobody sees anything)

**In plain English.** Before anyone who isn't on the team can get in, the app needs four things: a permanent record of every change to who can get in; one place that says what the team's roles are called; a database that refuses a guardian with no colony or an island-wide guardian; and permission checks that refuse, rather than allow, when a page forgets to say which colony it is about. This slice builds all four, and teaches the sign-in page to tell "the workspace documents" from "the dashboard". When it is live, Samuel, Jacky and Susan are management and everyone else on the team is team-only. Nobody else notices anything.

### PR 0.1: `person_events`, the record of who changed what (SYC-213; migration `person_events`)

- **Migration (next free number, expected `0015`).** `person_events (id serial, person_id uuid → people.id strict, kind text, by text, at timestamptz default now(), detail jsonb)`. The kind check holds **the fuller list from spec §11.1 from the start**: `invited`, `invite_sent`, `invite_resent`, `invite_withdrawn`, `accepted`, `added`, `roles_changed`, `left`, `rejoined`, `signed_out_everywhere`, `anonymised`. An append-only trigger refuses update and delete, written like the one on `observations`. Backfill: one `added` event per existing person (from `added_by`/`added_at`) and one `left` event for anyone with `left_at` set. Rollback: drop the table; the rollback block says in capitals that this deletes the history.
- **`lib/db/src/people.ts`.** `addPerson` writes `added` (or `rejoined` for a left address), `markLeft` writes `left` with the roles and colony ids held at the time, `signOutEverywhere` writes `signed_out_everywhere`, each **in the same transaction** as the change. `detail` holds ids and role names only, never a name or an address.
- **`removePerson` is retired** (spec §9.6, finding S6): every person now has an `added` event with a strict link, so a hard delete can never succeed. The function, the `people remove` subcommand and db-ops `people-remove` are removed; marking as left is the only way off the list. SYC-43 part 2's tests P0-4 and P1-10 are updated to say so.
- **`people list`** shows each person's history (ids and kinds only).

**Tests.** T21 (spec §15.3 test 21): every operation writes exactly one event, in its own transaction. **Mutation probe:** drop each insert in turn → red. The trigger refuses `UPDATE` and `DELETE`. The backfill gives each existing person exactly one `added` event and each left person one `left`. Up/down/up passes.

### PR 0.2: one list of the team's roles, and the record's vocabulary (SYC-252)

- **One module, `lib/teamRoles.ts`**: `TEAM_ROLES` = `staff`, `management`, `vet`. `lib/resolve.ts` (`AUTHORITATIVE_ROLES`), `lib/teamCorrections.ts` (`TEAM_ROLES`) and, through it, `lib/likelyReview.ts` import it. A source test fails if a role list is written anywhere else.
- **`admin` becomes `management`** in `writeObservation`'s `REACHABLE_ROLES` and in the resolver. Before this merges, Claude runs a read-only count on production through db-ops (`observations` where `role_at_time = 'admin'`); it must be zero (spec §15.2 step 1). PR 0.3's migration checks it again.
- **`actingRole(person, capability, target)`** in `lib/capabilities.ts` decides the `roleAtTime` written on a statement (spec §10.4). It replaces the hand-written `"staff"` in `lib/teamCorrections.ts` (4 places), `lib/welfareActions.ts:81` and `lib/welfareTie.ts:188`. Today it returns `staff` for every team member, so nothing written changes. The two in `routes/notifications.ts` belong to the owner-key route, which has no signed-in person; they stay, and retire with SYC-185.
- **Vocabulary that later PRs need, accepted but not yet written by anyone:** the `colony` observation accepts `{ colonyId: null }` ("no colony", spec §6.8), so SYC-209's "take out" can use it; `authority_scope` accepts `colony:<id>` (Decision B). `guardian` stays refused until PR 2.2.

**Tests.** T23 (part): a management member's correction is authoritative in the resolver, the review list and the correction routes. **Mutation probe:** revert one importer to its own list without `management` → red. A `colony` observation with `colonyId: null` is accepted; `colonyId: "x"` is still refused.

### PR 0.3: the roles migration, and the `people` command (spec §10.1, §10.3, §15.2; migration `roles_and_invites`)

**The migration (next free number, expected `0016`), in one transaction, stopping with a list and changing nothing if any check fails:**
1. Refuse if any observation has `role_at_time = 'admin'`, printing the ids.
2. Refuse, listing every offending row, if any `person_scopes` row is `volunteer`, a `guardian` with no colony, or a `staff` row with a colony.
3. Add `people.accepted_at`, `invite_sent_at`, `invite_expires_at`, `language` (not null, default `en`, check `en`/`el`/`fr`). Set `accepted_at = added_at` for everyone.
4. Add `person_scopes.reach` (nullable), fill it from `colony_id` (`colony` when set, `island` when null), then make it not null with no default. Add `expires_at`, `relationship` (check `feeds`/`owns_here`/`covering`), `granted_by`, `granted_at` (default now).
5. Replace the role check with `staff`, `management`, `guardian`, `vet` (no `volunteer`). Add the checks: `reach = 'colony'` exactly when `colony_id` is set; `guardian` needs `reach = 'colony'`; `staff` and `management` need `reach = 'island'`. The unique (person, role, colony) constraint stays.
6. Create `confirmation_items` (spec §10.3): the kind check (`site_public_request`), the state check, `decided_by <> proposed_by`, "decided has both, open has neither", the partial unique index on (`feeding_site_id`, `proposed_by`) while `state = 'open'`, strict links to `people` and to `feeding_sites`.
7. **No management rows** (Decision A1). Rollback: drop `confirmation_items`, the new columns and checks, and restore the old role check.

**Code.** The schema in `lib/db/src/schema/people.ts` (`PERSON_ROLES`, the columns, `confirmationItemsTable`). `findAllowedPerson` and `findPersonById` now also require `accepted_at` to be set, so **a pending person is never a `CapabilityHolder`** (spec §10.1); nobody is pending yet, so nothing changes. `scopesOf` returns `reach` and `expires_at`. The `people` command: `add` requires `--colony` for `guardian` and refuses `volunteer`; gains `--language` and `--accepted` (break-glass, for a team member added directly); a new **`set-roles`** subcommand replaces a person's roles and writes `roles_changed`; `list` shows placements (ids, never addresses). db-ops gains `people-set-roles` and the new role list (`scripts/db-ops.sh`).

**Behaviour after it ships: unchanged.** `can()` still answers "holds `staff`?"; the three management rows sit beside their `staff` rows.

**Tests.** T17 and the database half of T3: inserting a guardian with no colony, a guardian with `reach = 'island'`, a `staff` row with a colony, or any `volunteer` row is refused by the database. T29: on a database seeded with each kind of bad row, the migration stops and lists them (and an `admin` observation), and on a clean one it leaves every existing person with `accepted_at` set. T9 (part): a person with `accepted_at` null is found by neither finder. **Mutation probe:** drop that condition → red. Up/down/up passes.

**Production (Claude, in this order):** db-ops `migrate` on development → Claude shows Samuel, from the live production list, the three who will be management and every other team member who will be team-only → Samuel says yes → Neon snapshot of production (**needs Samuel's "ask" mode**) → db-ops `migrate` on production, then `verify` → db-ops `people-set-roles` for Samuel, Jacky and Susan (each keeps `staff` and gains `management`) → `people-list` shows exactly three holding `management` (T29a, as a probe). Nobody adds people between the migration and the publish; db-ops runs `main`'s code, so its inserts already carry `reach`.

### PR 0.4: two doors, on the app's side (SYC-222 points 1 and 2; spec §4.5, §6.3)

- **`use_workspace`** joins the capability list, and `mayUseWorkspace(person)` asks `can()` for it. `can()` is still staff-only at this point, so it is true for exactly the people who get the workspace today.
- **`POST /api/internal/people/allowed`** reads an optional `version` field. With `version: 2` it answers `{ allowed, doors: { workspace, dashboard }, language, personId, name, sessionVersion }`. **The old request shape is answered `allowed: true` only for someone who holds the workspace door** (spec §14 case 11), so the Worker deployed today can never hand a guardian the workspace. Every "no" stays identical whatever the reason.
- **Tests.** T7: a guardian test row (placed on one colony) gets `allowed: false` from the old shape and `doors.workspace: false` from the new; a staff address gets both doors. T8 (part) and T13: an unknown address, a left person and a person with no door get byte-identical answers. **Mutation probe:** answer the old shape with `mayEnter` instead of the workspace door → T7 red.

### PR W1: the sign-in Worker learns the two doors (`fairshake-au/catspotters-website`)

- In the Worker's repository, in its own worktree there. It sends `version: 2`, issues a **workspace session only when `doors.workspace` is true**, and for a **dashboard-only** person shows one plain page, *"Open my colonies"*, whose button posts the usual one-minute hand-off pass to `team.catspotters.com` (C9). No workspace session, no document password, no lock switches. The sign-in email stays English for now; the person's `language` is read and used once Johnny has signed off Greek and French (SYC-283), by a one-line switch.
- **Ships after PR 0.4 is live**, so the new request always gets the new answer. Until W1 ships, a guardian simply can't sign in, which fails safe (spec §4.5).
- **Collision:** a SYC-26 (Google sign-in) plan is being written in that repository's `syc-26-plan` worktree and touches `admin/src/index.js`. W1 is small and goes first; SYC-26 rebases on it.
- **Deploy:** Claude deploys with wrangler (the token exists) and probes: a staff test address still gets the workspace; a guardian test row gets the "Open my colonies" page and no workspace cookie.
- **Tests (that repository's suite, with its mocked people list):** old-shape and new-shape answers; a dashboard-only answer never sets the workspace cookie. **Mutation probe:** grant on `allowed` alone → red.

### PR 0.5: the capability catalogue, strict checks, the 403 page and the route walk (SYC-222 points 3 and 4; spec §6)

**This is the PR where a guardian row first means something. It merges only after 0.3, 0.4 and W1 are live and the three management rows exist in production.**

- **The catalogue as data** in `lib/capabilities.ts`: every name in spec §6.2, with its kind (island-only, placed, role-wide, creates its own scope) and the roles that hold it, including the reserved `match_cat_anywhere`. `manage_people` and `action_deletion_request` are **management only**; from this PR, team-only members lose them (no screen uses them yet).
- **`can(person, capability, target?)` is strict.** Island-only: an unexpired island row of a role that holds it. Placed: with a target, an island row, or an unexpired colony row for exactly that colony; **with no target, island rows only** (Decision 4). Role-wide and "creates its own scope": any unexpired row of a role that holds it. Expiry is compared with the database's clock on every request; no job runs.
- **`canSomewhere(person, capability)`** answers "for any colony?" and is used only by `mayEnter` (the dashboard door) and menus. `capabilitiesOf` now says *where* each capability applies, and `GET /api/team/me` returns that (finding S13).
- **Targets come from the record, never the request** (`lib/capabilityTargets.ts`): a cat's colony is its newest active `colony` observation (superseded ones ignored, `colonyId: null` means none); a photo's colony is its cat's; a report's colony is its cat's; a feeding site's colony is its own column. A cat in no colony has no placed target, so only island holders pass.
- **`requireTeam(capability, resolveTarget?)`.** Not signed in keeps today's 401 and redirect. **Signed in but not allowed gets a quiet 403 page**: *"That part of the dashboard is for the Syros Cats team. Your colonies are here,"* with a link home (spec §6.4). English here; PR 1.0 makes it three-language.
- **Routes, moved as the spec's §6.2 note 4 says:** `GET /team` (the queue), `GET /team/reports` and `GET /team/report-photos/:publicId` → **`view_welfare_queue`** (island-only). `GET /team/cats` and `GET /team/cats/:id` → `view_exact_location` **with no target, so island-only**: the team's cat page shows things a guardian must not see, and she gets her own page in Slice 2. `GET /team/photos/:publicId` → `view_exact_location` **with the photo's cat as the target**, and a hidden photo is served only to a holder of `hide_photo`. Every correction and report route keeps its capability **with no target, so island-only**. Guardians get their own routes in Slices 2 and 3, each with its own target. Every existing route stays closed to guardians by construction.
- **No guardian can do anything useful yet.** A guardian test row can pass the dashboard door and reach `GET /team/me` and the 403 page. That is the intended state.

**Tests.**
- **T1, the route walk.** Every route registered under `/api/team` and `/api/internal` (read from the router, with a minimum count so an empty walk fails), called by seven kinds of person: team, management, a guardian on one colony, a guardian on several, a pending invitee, a left person, someone whose roles grant nothing. Each answer is compared with a table in the test, and **a route not in the table fails**. It extends `team.walk.test.ts` and keeps its "not signed in" check. **Mutation probes:** register a route without `requireTeam` → red; make `can()` with no target answer "any colony" → red (the guardian reaches the queue).
- **T2.** A person who may enter but lacks the capability gets the 403 page, not the sign-in redirect, on every capability-gated route. **Mutation probe:** send the 401 instead → red.
- **T3 (the rest).** A guardian placed on every colony that exists can't reach the welfare queue, the report list, a reporter's photo or the cat list.
- **T5 (part).** The catalogue photo route takes its target from the photo's cat, never from the request. **Mutation probe:** take the colony from a query parameter → red.
- **T6.** A placement whose end date has passed stops working at the next request, with no job run.
- **T24, the catalogue test.** The map in code is compared with the §6.2 tables **parsed from `docs/specs/roles-and-invites.md` itself**, so the document and the code can't drift; the names SYC-209 and SYC-2 cite must exist in it. **Mutation probe:** give guardians `set_site_public` in code → red.
- **T27.** `use_workspace` is refused to every role but team and management, including with a valid dashboard session.
- **T15 (part).** A team-only member does not hold `manage_people` or `action_deletion_request`; a management member does.

**After deploy (Claude):** `curl` every `/api/team/*` route without a session → 401; with a test guardian's session on development → the 403 page on team routes; `GET /api/team/me` for the test guardian lists only placed capabilities, with her colony.
