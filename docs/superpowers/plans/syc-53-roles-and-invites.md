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
