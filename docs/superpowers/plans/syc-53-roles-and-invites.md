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

---

## Slice 1: invitations, the people screen and "My page"

**In plain English.** Management stops asking Claude to run commands. Susan opens a People screen, types someone's email address and name, picks what they'll be (team, management or cat guardian, with her colonies) and the language of the email, and taps *Send invitation*. The person gets a plain email with no secret in it, signs in the usual way, reads three short promises and taps *Yes, join*. If they do nothing for 14 days the invitation lapses. Every change is written down, and the other managers get a short email each time. A person who has joined has a page of their own where they can change their language, sign out everywhere, or stop helping. A guardian lands on "My colonies", which names her colonies; the cats arrive in Slice 2.

**Route names.** SYC-209 owns `/api/team/colonies…` (Decision D). A person's own pages live under **`/api/team/my/…`**, and the people screen under `/api/team/people…`, so the two plans never write the same path.

### PR 1.0: the dashboard speaks English, Greek and French (SYC-251; spec §13)

- One server-side string catalogue for the dashboard (`lib/teamPages/strings/{en,el,fr}.ts`), the same shape as the app's (`artifacts/cat-spotter/lib/i18n.ts`). Dates in the person's language (`en-GB`, `el-GR`, `fr-FR`), Athens time.
- Only the pages a guardian reads are translated (Decision 10): the 403 page now, and each later guardian page as it is built. Team and management screens stay English.
- **A `LIVE_LANGUAGES` list in code, `en` only at first.** Greek and French strings exist and pass the parity test, but pages and emails fall back to English until Johnny has signed them off (SYC-283). Switching a language on is a one-line PR.
- Greek and French are drafted by Sonnet, using the words already settled for the app (SYC-156: "cat guardian"; "spotter" only, never "snapper").
- **Tests.** T25: every key in every language, none empty (a missing key fails the build); a Greek local part in an email address lower-cases identically in Postgres and in JavaScript (the SYC-101 trap). **Mutation probe:** delete one Greek key → red.

### PR 1.1: inviting, accepting, withdrawing, leaving (spec §4, §8.3–8.5, §9, §10.1–10.2)

**The people functions** (`lib/db/src/people.ts`), each writing its `person_events` row in the same transaction:
- `invitePerson(by, { email, name, roles, colonies, relationship?, expiresAt?, language })`: a pending person (`accepted_at` null), their placements, an `invited` event. A guardian with no colony is refused (the database refuses it too).
- `findInvitee(id)`: **invited and not expired**, no placements returned. Used only by the hand-off, the accept page and the decline route.
- `acceptInvitation(id, name, promisesVersion)`: **one conditional update** (`where accepted_at is null and left_at is null and invite_expires_at > now()`), `accepted` event with the promises version (`promises-v1`). Pressing twice changes nothing the second time.
- `declineInvitation`, `withdrawInvitation(by)`, `resendInvitation(by)`: the same kind of guarded update. Declining and withdrawing mark the pending person as left (`invite_withdrawn`); a row is never deleted (spec §9.6). Resend sets a fresh 14 days, at most once per person per 24 hours.
- `setRoles(by, personId, placements)`: never your own (refused); writes `roles_changed` with before and after (role names and colony ids). Re-placing a guardian on a colony she once held **updates her old row** (clears the end date, records who and when).
- `rejoinPerson(by, personId, placements, language)`: `accepted_at` back to null, new placements, `rejoined` then `invited`; she accepts again (spec §9.4).
- `markLeft` gains: **every pending invitation the leaver sent is withdrawn in the same transaction**, with the count returned for the screen (spec §9.2); and **the last management person can't be marked as left, demoted or signed out everywhere**, checked with the management rows locked (`SELECT … FOR UPDATE`) so two managers removing each other at once can't both succeed (spec §9.5).
- `createColonyWithPlacement(person, colony)`: for SYC-209's "create a colony" route (Decision D). For a guardian, writes the colony (`created_by` = her id), her placement (`reach = 'colony'`, `granted_by` = her own id) and a `roles_changed` event in one transaction; for a team member, the colony only (spec §6.1, §6.9). Built and tested here (T30's core) so SYC-209 only calls it.
- `stopHelping(personId)`: the person's own "stop helping", recorded as `left` by `self`.

**Two new mail purposes** (`lib/mail/send.ts`), both closed templates with no free text from anyone:
- **`person_invite`**: from `Cat Spotters <signin@mail.catspotters.com>` (C8), on the transactional identity, shed after sign-in links and welfare mail when the quota is tight. A new recipient kind, **`person`**: **the caller passes a person id, not an address**; the function looks the address up and refuses unless that person is pending and unexpired (spec §8.5). The words that vary are the role and the colony name, from the person's own record, escaped and length-limited. English until Johnny signs off. `invite_sent_at` is set only when the outbox delivers it; **a failed send is shown as "Not sent yet", never "Invited"**, and retries like other mail.
- **`access_change_notice`**: to every other management member who hasn't left, never the one who acted. It says who made which change to whom. Sent for every invitation, role change, return, person marked as left and sign-out-everywhere of a team or management member (spec §8.3, §9.5). Another new recipient kind, **`management`**.

**Limits** (spec §8.5): 10 invitations per inviter per day, 1 per address per 24 hours, 30 per IP per hour.

**The hand-off and the doors for a pending person.** The allow-list answers a pending, unexpired invitee `doors: { dashboard: true, workspace: false }` (spec §4.5). The hand-off gives her a session marked *pending*, and **`requireInvitee`** lets that session reach the accept page and the decline route and nothing else; `requireTeam` refuses it everywhere (it uses `findPersonById`, which never returns a pending person).

**The accept page** (`GET /api/team/my/welcome`, `POST …/accept`, `POST …/decline`), in her language once it is live: who invited her and for what, the **three promises word for word** (spec §4.1), the name field pre-filled and editable, *Yes, join* and *No, this isn't for me*. Every POST passes `requireOrigin`. No email goes to the inviter when she accepts (Decision 7).

**Tests.** T8 (complete) and T9: a pending invitee gets only the dashboard door; her session reaches the accept page and nothing else; her placements are never read by `can()`. **Mutation probe:** let `findPersonById` return pending people → red. T10: accept and withdraw at the same moment, and accept after expiry, each with exactly one winner; rejoining sets `accepted_at` to null. **Mutation probe:** drop the `invite_expires_at > now()` guard → red. T15: one management member alone can invite team or management, change roles, bring someone back and mark another manager as left, each at once, each with its event, each emailing every other manager and not the actor; there is no `approve_access` and no approval item anywhere (source test). T18: the last manager can't be removed, demoted or signed out through these functions, including two at once (a concurrent test). **Mutation probe:** drop the row lock → red. T19: leaving withdraws the leaver's pending invitations and emails the other managers. T20: withdrawing never deletes a row. T21 (extended to every new kind). T22: the invitation function can't be given an address; the text holds only the role and the colony name; a name with markup or a link is escaped; the limits hold; a failed send isn't shown as sent; no acceptance email exists. **Mutation probe:** let the caller pass `to` → red. T29d: exactly three promises, in all three languages with key parity, none about keeping places private, and the version recorded with the acceptance. T14: accept, decline and withdraw are Origin-checked and safe to press twice. T30 (core): `createColonyWithPlacement` writes all three rows or none (**mutation probe:** fail the placement insert → no colony left behind).

### PR 1.2: the People screen (SYC-104; spec §8.1–8.2, §9.3, §6.3)

Management only (`manage_people`), English (Decision 10), server-drawn like the rest of the dashboard.
- **The list**: name, roles in plain words, colonies, and a chip: *Not sent yet · Invited · Joined · Expired · Left* (worked out when the page is drawn; nothing writes "expired"). Beneath each person, their history from `person_events`, ids turned into names on screen. **Joined in the last 7 days** beside the list. A **Left** tab with **Bring back** (roles chosen afresh).
- **Invite someone**: address typed once (Decision 7), name, role, colonies (for a guardian), optional end date and label per placement (Decision 9), language. **Resend** and **Withdraw** on pending people.
- **Change roles and placements**, **Mark as left**, **Sign out everywhere**. Marking as left someone who held the workspace reminds management to change the shared document password (spec §6.3). When a guardian leaves or hands over, the screen offers *"Vaporia — Eleni's still has Eleni's name on it. Rename it?"* with a link to SYC-209's rename (spec §9.3; a nudge, never automatic). After a departure, *"3 invitations from Susan were withdrawn when she left. Re-send any you still want."*
- No free-text box on this screen ends up in an email.
- **Tests.** T15 (screen half): a team-only member gets the 403 page on every People route. The chips match the state table in spec §10.1 for one seeded person in each state. **Browser check** at ~390 px and desktop with seeded people in every state, before the PR opens; screenshots in the PR.

### PR 1.3: "My page" and "My colonies" (spec §2.6, §9.1, §13.1)

- **`GET /api/team/my`**: the one sentence about yourself (*"You're a cat guardian for Vaporia — Eleni's and Kato Chora."*), change language, sign out, sign out everywhere, and **Stop helping** (plainly worded, different from management's route; spec §9.5). Any accepted person, no capability needed (spec §6.2 note 1).
- **`GET /api/team/my/colonies`**: a guardian's colonies by name, with any placement label and end date; a team member sees a link to the island-wide pages instead. Cats arrive in PR 2.1.
- The home a signed-in person lands on after the hand-off depends on what they hold: the welfare queue for the team, *My colonies* for someone who holds only placed capabilities.
- Three-language for the person's own pages and the 403 page.
- **Tests.** A guardian's home is *My colonies*; a team member's is the queue. *Stop helping* ends the session at the next request and writes `left` by `self`. **Browser check** at ~390 px and desktop, in English (and in Greek with `LIVE_LANGUAGES` switched on locally).

**First real use.** Once Slice 1 is live, Samuel invites one team member through the screen as the acceptance test. The first guardian is invited once a colony can be created (Decision D).

---

## Slice 2: a guardian's own pages

**In plain English.** Eleni opens *My colonies* and sees her cats: names, numbers, photos, exact positions, whether each one is done and how sure we are, when each was last seen. Any cat outside her colonies looks to her exactly as it does in the public app. She can say a cat has been homed, is in care or has died, and undo her own change within 30 days. She can say a cat is sterilised, and it shows as *Confirmed* straight away, with her name on it; followers of that cat get the usual news. The team sees *"Confirmed by Eleni, cat guardian, 14 October"* on the cat's page, with a *This is wrong* button.

### PR 2.1: her cats, in full inside her colonies and public outside (spec §2.2, §6.1)

- **`lib/guardianCatView.ts`, its own serialiser** built from its own list of fields (spec §2.2's table), **not** the team's cat view with a filter. It has no field for welfare entries, hidden photos, team members' names (edits show as "Syros Cats"), spotters, owners, team notes or per-sighting positions, so leaving them out doesn't depend on a filter.
- **`GET /api/team/my/colonies/:id`** (her colony: cats, with exact discovery positions) and **`GET /api/team/my/cats/:id`** (one cat), both `view_exact_location` placed, with the target **read from the record** (the colony id in the path is checked against her placements; the cat's colony comes from its observations). A cat outside her colonies, or in none, is answered with **the public view** (`serialiseCat` with the public viewer), not a refusal. Photos go through the team photo route, whose target is the photo's cat.
- The colony's feeding sites appear here once SYC-209's sites exist, filtered in the query to her colonies (spec §6.7).
- **Tests.** T4: outside her colonies, every route that returns a cat gives exactly the public view, field by field; inside, exactly the fields in spec §2.2 and none of the excluded ones. **Mutation probe:** serialise through `teamCatView` → red. T5: a request naming her colony but a cat from another gets the other cat's public view. **Mutation probe:** trust the path's colony id for the cat → red. **Browser check** at ~390 px and desktop with a seeded colony of cats with photos.

### PR 2.2: what she says about a cat: life status and "sterilised" (spec §7.2, §10.4, Decision 5, Q3)

- **`writeObservation` accepts `guardian`.** `actingRole` now returns `guardian` when the capability was granted by a colony row for that cat's colony, and the team role when an island row granted it (a team member who also guards her own alley writes `staff` for a team action). **`authority_scope` = `colony:<id>`** (Decision B), fixed at the moment of the statement. Never read from the request.
- **Life status** (`POST /api/team/my/cats/:id/life-status`, `set_life_status` placed): *homed*, *in care* and *deceased* only, plus putting back a status **she herself** replaced in the last 30 days. A cat she marks homed or deceased stays flagged for 30 days (*"recently marked homed by the guardian"*) on the round sheet when it exists (Slice 4) and on the team's view now. Any later sighting revives the cat, as now.
- **Sterilised** (`POST /api/team/my/cats/:id/sterilisation`, `set_sterilisation` placed): one tap, no "from what record?". **The resolver counts a `sterilised` statement from `guardian` with a `colony:<id>` scope as authoritative** (spec §10.4), so the cat is *Confirmed* at once and the "sterilised" news email is queued exactly once, as for a team record. An ear tip alone still never confirms. Colour and markings authority for guardians is SYC-2's to build; its plan cites this one.
- **Marking it wrong.** On the team's cat page, a guardian's statement shows *"Confirmed by Eleni, cat guardian, 14 October"* and *This is wrong*, which writes the team's later statement through the existing supersede (hers stays in the history). A guardian can correct **her own** statements only; the supersede layer checks the author, not just the capability. The guardian sees *"Syros Cats looked again…"* on her next visit; no push, no email (Q4).
- **A guardian-changes reader** (`listGuardianChanges()`): every statement written as `guardian`, every colony a guardian created, every placement she gave herself, newest first. SYC-209's "Recent guardian changes" list on the Colonies page calls it, behind `view_guardian_changes` (Decision D).
- **Tests.** T12a: her "sterilised" on a cat in her colony is *Confirmed*, with her id, `guardian` and `colony:<id>`, and queues the news email once; on a cat outside her colonies, or in none, it is refused; the team's later "this is wrong" supersedes it and both stay in the history. **Mutation probes:** drop the target check → red; queue the email on every write → red. T23: a guardian can't write `staff` by sending it; a person who is both writes the role that authorised the action. T28 and T29c: only the allowed life statuses; her own undo within 30 days and not after, and not someone else's; a later sighting revives a cat she marked deceased; the 30-day flag. A guardian can't supersede the team's statement or another guardian's. **Browser check** at ~390 px and desktop, including the news email in the outbox.

---

## Slice 3: what a guardian records

**In plain English.** Standing next to a cat, Eleni taps *I looked at her ear*, chooses *it looks clipped*, *not a clip* or *can't tell*, and can take a photo. The cat shows *Probably sterilised, checked in person* at once (never *Confirmed*, and no "sterilised" email). The photo is seen only by the team and the colony's guardians. A short "Needs a look" list shows the cats in her colonies where one look would settle it. She can read the cat-in-trouble reports about her own cats, but never who sent them. And she can ask the team to make one of her feeding sites public, which the team decides in "Needs an OK".

### PR 3.1: field checks (spec §7.2–7.3; migration `field_check_photos`, Decision C)

- **Migration (next free number):** `field_check_photos (id, public_id unique, cat_id, bytes, mime, created_by → people.id strict, created_at)`, shaped like `welfare_report_photos`. Rollback: drop it (the rollback block says this deletes the photos).
- **`POST /api/team/my/cats/:id/field-check`** for guardians (placed `record_field_check`, target the cat's colony) and the same form on the team's cat page (island). It writes **one `ear_tip` observation** with `seenInPerson: true`, the side if clipped, and the photo's `public_id` inside the value (never `photo_id`). *Can't tell* is kept as a note (200 characters, escaped) and writes no ear statement. No queue item.
- **The resolver.** An in-person clipped ear raises the cat to *Probably sterilised*, shown as *"checked in person"*. A guardian's in-person *not a clip* on a cat in her colony clears a wrong *Likely* at once, like the team's (spec §7.2, "both directions count at once"); her authority for that is the same `colony:<id>` scope. It never makes a cat *Confirmed* and **never queues the "sterilised" email**.
- **The team's Probably sterilised list** treats a guardian's in-person check like the team's *Looks right*: the cat leaves the list when the newest clipped statement is in person (spec §7.5).
- **`GET /api/team/field-check-photos/:publicId`**, the only route that serves these photos: `view_exact_location` with the photo's cat as the target. A source test fails if any other file reads `field_check_photos` (the P6-0 pattern).
- **Tests.** T11: one observation, no queue item; refused for a cat outside her colonies; *can't tell* writes no ear statement; the photo is served only by its team route, and `GET /api/photos/<that id>` and every public cat response refuse it. **Mutation probe:** serve it from the public route → red. T12: *Probably* and no further; no news email; *not a clip* clears a wrong *Likely*; a team "this is wrong" supersedes it. **Mutation probe:** make an in-person clip authoritative for `sterilised` → red (the cat becomes *Confirmed*). **Browser check** at ~390 px (a phone photo upload) and desktop.

### PR 3.2: "Needs a look" (spec §7.1; Decision E)

- **`GET /api/team/my/needs-a-look`** (`view_needs_a_look` placed; her colonies) and the team's island-wide version on the team pages. Cats at *Probably sterilised* only, never *Unknown*, worked out from the resolver when asked; nothing stored. **Grouped by colony name** until Slice 4's field page can sort by distance. No deadlines, counts or reminders, just how long each has waited, once.
- **Tests.** Only cats in her colonies; no *Unknown* cats; a cat settled by a field check leaves the list. The words "due", "assign", "overdue" never appear.

### PR 3.3: cat-in-trouble reports for her own cats (SYC-254; spec §6.2, Q2)

- **`GET /api/team/my/colonies/:id/welfare-reports`** (the list and each report) and **`GET /api/team/my/report-photos/:publicId`**, gated by `view_colony_welfare_reports` with **the report's cat's colony, read from the record at each request**, as the target.
- **Their own serialiser**, with no field for the reporter's contact, device or the team's note. A report tied to no cat, and every "Report an issue" report (SYC-44), has no route for her at all. Read only: no state or note route accepts her.
- **Tests.** T29b (i)–(viii): sees reports tied to cats in her colony, with photo and location; refused (403) for another colony's report, a report tied to no cat, and a guessed number; no contact, device or team-note field in any response, checked field by field; can't change state or add a note; moving the cat out removes the report at the next request, and adding a cat adds its reports; the team-only routes still refuse her; the report is never in the saved list (checked again in Slice 4); the route walk has a row for each new route. **Mutation probes:** add `reporterContactId` to the serialiser → red; take the colony from the path instead of the report's cat → red.

### PR 3.4: asking for a site to be made public, and "Needs an OK" (spec §7.1, §7.3, §10.3)

**Needs SYC-209's feeding-site pages**, because a guardian asks about a site she can see there.
- **`POST /api/team/my/sites/:id/ask-public`** (`request_site_public` placed, target the site's colony): an open `confirmation_items` row; asking again about the same site does nothing new; at most 20 open per person.
- **`GET /api/team/needs-an-ok`** and **`POST /api/team/confirmations/:id/decide`** (`settle_confirmation`, island): approve (which calls SYC-209's make-public with its usual confirmation page) or decline with a fixed reason. **The capability is checked again when the decision is written.** The first decision wins; the second sees *"Already decided by Jacky."* A site made public some other way closes the item as *no longer needed* (a hook in SYC-209's make-public). The guardian sees the outcome on her next visit; no email (Q4).
- **Tests.** T13: the database refuses an item decided by its proposer; the route refuses a decider who has lost the capability since the page was drawn. T14: the first decision wins. The 20-item cap and one-per-site rule hold. **Browser check** at ~390 px and desktop.

**Colony membership and creating colonies** are built in SYC-209's PRs (Decision D), using Slice 0's targets and PR 1.1's `createColonyWithPlacement`. This spec's tests **T16** (a guardian's colony change is immediate, recorded, refused for a colony she doesn't hold, moves a cat out of another colony with a line for its guardian, and appears on the guardian-changes list) and **T30** (the rest: she holds placed powers for her new colony only, can't rename it, and the team member who creates a colony isn't placed on it) travel with those PRs, and SYC-209's plan must name them.

---

## Slice 4: the colony view that works with no signal (SYC-54)

**In plain English.** The evening before a round, Eleni opens her colony view with signal. Her phone keeps her colonies' cats and the exact place of every bowl. On the hillside with no signal she sees the same list, and can record field checks that are sent when she's back in signal. After 72 hours the list deletes itself the next time she opens it, and asks her to connect. Signing out, or being removed, wipes it. A team member can carry the colonies she chooses. Anyone can print a round sheet, stamped with their name and the date.

**Starts after the short SYC-54 screen spec is approved (Decision F).** The rules below are fixed by the roles spec §12 and don't wait for it.

### PR 4.1: the field pages' own narrow script rule (spec §3, §12.2)

- A separate set of pages under **`/api/team/field/`**. Only these responses relax the dashboard's no-scripts rule: scripts allowed **only by fixed hash**, nothing inline, `connect-src 'self'`, `worker-src 'self'`. **`no-store` stays on every response.** The service worker is registered with scope `/api/team/field/` only, so it can never serve an old staff page after sign-out.
- `Clear-Site-Data: "cache", "storage"` on sign-out, on *sign out everywhere* reaching the phone, and on any field request refused because the person is gone or no longer holds the placement.
- **Tests (T26, headers half).** Every other dashboard response still has `default-src 'none'` and no script source. **Mutation probe:** apply the field rule to `/api/team/` → red. The service worker's scope is the field path. Every response keeps `no-store`.

### PR 4.2: the saved list and the round sheet (spec §12.1–12.2; Decision 12)

- **`GET /api/team/field/list`** (`view_colony_targets` placed): for each of her colonies (for a team member, the colonies she picks), exactly spec §12.1's fields: cat name and SYR number, sterilisation answer and how sure, last seen, life status (with the 30-day flag), discovery position, usual feeding site, a thumbnail, and each site's name, **exact position** and optional "how to find it" line (SYC-263). Never per-sighting positions, welfare reports, reporters, hidden photos, health notes, other colonies or team names. Stamped with the server's time and the expiry.
- The page saves it in its own storage. **On every open, before drawing anything, an expired list (72 hours by server time, or a phone clock that has gone backwards) is deleted, not hidden**, and the page says *"Connect to refresh this list."* An online load re-checks the person; a refusal deletes the list at once.
- **Sorted by distance** when the person agrees to share her position (Decision E); the server sorts and neither stores nor logs it (the request logger redacts it).
- **The round sheet**: a printable page stamped with her name and the date and *"These are exact places. Please don't share them."*
- The JSON responses are added to the OpenAPI file and the generated clients (spec §15.1).
- **Tests (T26, the rest).** Deleted on open after 72 hours; a backwards clock counts as expired; the server's refusal deletes it; only her colonies, with exact site positions, and none of the excluded fields (T29b vii). **Mutation probes:** hide instead of delete → red; trust the phone's clock → red. **Browser check** at ~390 px and desktop, including offline mode in the browser's developer tools, and a printed round sheet.

### PR 4.3: field checks made with no signal (spec §12.3)

- Up to 20 waiting, each with its photo, kept only until sent; sent under her signed-in session when she's back in signal; refused if the session or the person is gone (spec §9.2); a date more than 30 days back or in the future is refused.
- **Tests.** T28 (offline dates); a queued check from a person marked as left is refused when it arrives. **Browser check** offline then online, at ~390 px.

---

## Slice 5: the small things

**In plain English.** Management sees a gentle banner if someone prints or refreshes far more round sheets in a day than a colony needs: a prompt to ask a question, not a block. And once the "Matched by hand" list exists for the team, guardians can check the hand-picks in their own colonies.

- **PR 5.1: round-sheet counts and the banner (SYC-253; spec §11.3).** A small table counting, per person per day, round-sheet prints and downloads and saved-list refreshes, with no cat ids in it. A banner on the People screen above five a day. **Tests:** the counts, the threshold, and that the table has no cat column.
- **PR 5.2: hand-pick review for guardians (spec §6.2 `review_hand_picks`).** Waits for SYC-152's "Matched by hand" list. Her colonies only, positions at the 250 m level only. Planned in detail when SYC-152 is.

**Not in this plan:** forgetting a former guardian or team member (SYC-208, and SYC-256's button). SYC-208's own plan must reach `colonies.guardian_name`, colony names and name history, field-check notes, and withdrawn invitations to a wrong address (spec §9.6–9.7). It is management only (`manage_people`).

---

## Slice 6: owners confirm sterilisation (after SYC-130)

**In plain English.** A resident who has said in the app that a cat lives with her can say it has been sterilised, and it counts as *Confirmed*, with her as the source.

- **Gated on SYC-130.** Its spec (PR #107) defines what a claim is, and so who counts as an owner. This slice is planned when SYC-130's plan is approved. What it adds is small: the resolver counts a `sterilised` statement with `authority_scope = owner_of_this_cat` as authoritative for that cat (spec §7.2, §10.4), written from the public app by the owner's device under SYC-130's claim. No dashboard door for owners (spec §7.2).
- **Tests (then):** an owner's statement confirms only her own cat; anyone else's is refused; the team can mark it wrong.
