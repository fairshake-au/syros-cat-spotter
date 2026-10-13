# SYC-53: roles and invites (guardians, the team, management)

**Status: approved by Samuel, 13 October 2026.** He accepted the "Still needs Samuel" points: he sees the management and team-only list before PR 0.3's production run; management and imports rank with the team; the sterilised news goes once per cat, ever; a withdrawn or declined invitee is anonymised and the row kept; a dashboard-only person goes straight to the dashboard; Johnny's Greek and French review targets 30 October. Decision G updated by Samuel, 13 October 2026: owner prevails over guardian. The order is now vet > owner > cat guardian > team, and the newest wins only within the same level; nothing is left open on Decision G. The independent review is `syc-53-roles-and-invites-review.md`, and "Review outcome" at the end maps every finding.
**Spec:** `docs/specs/roles-and-invites.md`, approved by Samuel on 12 October 2026 (PR #102, merged). This plan builds it as written, except where Samuel's 12 October answers amend it (news channel, Decision G); those amendments go into the spec through docs PRs D4 and D6 before the code that depends on them. Where the spec and the code on `main` disagree, the plan says so in "Where the spec and the code disagree" and asks, rather than deciding quietly.
**Builds on:** `team-access-and-welfare-queue.md` (sign-in, the people list, the welfare queue), `cat-record-data-spine.md` (observations, the resolver, colonies), `DECISIONS.md` Parts 2i, 2k and 3, and the two SYC-43 plans (`syc-43-part-1-people-and-staff-sign-in.md`, `syc-43-part-2-welfare-queue-and-corrections.md`), whose format this plan follows.
**Linear:** SYC-53 (this plan). Builds SYC-213, SYC-222, SYC-252, SYC-251, SYC-104 and SYC-254, and the guardian half of SYC-54. Touches SYC-208, SYC-209, SYC-2, SYC-130, SYC-253, SYC-256, SYC-257, SYC-263, SYC-278, SYC-283, SYC-284. SYC-188 and SYC-131 are done and are built on.
**Checked against:** `origin/main` at `586763a` (12 October 2026), where #102 (this spec), #103 (SYC-209 spec) and #104 (SYC-2 spec) have **merged**; the open PRs (#107, #111); the sign-in Worker in `fairshake-au/catspotters-website` (`admin/src/index.js`), and Linear SYC-53 with its comments and the tickets above. Every "exists today" claim names the file it was read in.

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
| **The docs PRs** | Nothing. The approved specs agree with each other (including who wins when a vet, a cat guardian, an owner and the team disagree, Decision G) |
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
| Team routes | 23 routes under `/api/team/` plus 2 under `/api/internal/` (list below). Welfare queue, report list, report photos, catalogue photos, cat search and cat page all use `requireTeam("view_exact_location")`; corrections use their own capability; two JSON observation routes use `requireTeam()` and call `can()` inside | `routes/team.ts`, `teamReports.ts`, `teamCats.ts`, `teamCorrections.ts`, `teamPhotos.ts`, `observations.ts` |
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
- **Open PRs add no migrations.** #107 and #111 are docs only (checked with `gh pr view --json files`); #102, #103 and #104 have merged, also docs only. SYC-209 will add at least one migration, which is not additive.
- **This plan adds four migrations, in this order:** `person_events` (Slice 0, PR 0.1), `roles_and_invites` (Slice 0, PR 0.3), `field_check_photos` (Slice 3, PR 3.1), `confirmation_items` (Slice 3, PR 3.4; moved out of 0.3 so it is created once SYC-209 has settled the shape of `feeding_sites`). Each takes the next free number when it is generated after rebasing on the latest `main`, never by hand (`lib/db/migrations/README.md`). SYC-209's own migrations (retiring a site, the "how to find it" line) are SYC-209's and may land in between; nothing here depends on their numbers.

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
| **C7** | §10.5: "`colonies` records who created each one (`created_by`)" is a new column. SYC-209's merged spec calls it "a link to people" | `colonies.created_by` already exists (text, nullable) | No column to add. PR 1.1's `createColonyWithPlacement` writes it with the creator's person id (as text; no foreign key, so no migration on a table SYC-209 reshapes). D5 aligns SYC-209's wording |
| **C8** | §4.1: the invitation comes "from `Cat Spotters <signin@mail.catspotters.com>`" | The API's transactional sender is `Cat Spotters <hello@mail.catspotters.com>`; `signin@` is the Worker's. Both are on the verified `mail.catspotters.com` domain | None. Slice 1 adds `signin@` as the `person_invite` sender, as the spec says; the probe after deploy confirms Resend accepts it |
| **C9** | §6.3: a guardian who signs in "goes straight to the dashboard" | The Worker's only way to the dashboard is a button inside the workspace. A dashboard-only person needs a new Worker path that mints the hand-off pass and sends her on without a workspace session | Built in the Worker PR (W1), in the other repository. W1 **follows the spec**: she goes straight on, with no extra page (the earlier "Open my colonies" page was a deviation and is dropped; see W1) |
| **C10** | §7.2, §3: followers of a cat get "the usual news" when it is confirmed sterilised, described as an email | There is **no such path** for dashboard records. `recordTeamStatement` and the dashboard routes send nothing; the only place a "desexed" update is created and fanned out is the owner-key route `routes/notifications.ts`, which SYC-185 retires. `fanOutNotifications` writes in-app rows and Expo pushes and sends no email; the `cat_news` mail purpose exists but nothing calls it | **Settled by Samuel (12 Oct): in the app and by push, no email.** PR 2.2 builds `announceSterilised` (see there). D4 corrects the spec's word "email" |
| **C11** | §7.2, §10.4: a guardian's statement is authoritative for sterilisation; silent on how it ranks against others | `resolve.ts` rule 2 is "newest authoritative statement wins, whatever sign", and `observedAt` can be sent by the client on the generic routes. A guardian's "isn't sterilised" could flip a vet's or the team's record merely by being later | **Settled by Samuel (12 Oct): Decision G.** Built in PR 0.2 (one `authorityLevel` function) and PR 2.2 (guardian writes); recorded by D6 |

---

## Decisions for Samuel

Six (A to F) about *how* to build what is approved, each now carrying the adversarial review's verdict and conditions, and one (G) that Samuel has already settled. None of A to F reopens a decision in the spec; G and the news channel amend it, on Samuel's say-so.

### Decision A: how Samuel, Jacky and Susan become management (C1)

**The question.** The spec says the migration itself adds the three management rows. Migrations run against every database, including the throwaway one CI builds, and would need the three people's addresses or ids written into the code.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A1. The migration adds the role; Claude adds the three rows straight after, with the `people` command (recommended)** | The migration makes `management` a valid role and changes nothing else about who holds what. Then Claude shows Samuel the list (the three, and every other team member, who will be team-only) and, once he says yes, runs `db-ops people-set-roles` for the three, on development and then production | No personal data in the repository. Works on every database. The list Samuel approves is the live list on the day, not one copied a week earlier. The same command is the break-glass later | Two steps instead of one. Between them, nothing changes: the code that makes inviting and removing management-only ships in a later PR, so the old rule (every team member can do it) still applies until the three hold the role |
| A2. The migration adds the rows, matched by email address | One step | Addresses of three people in the repository and in its history. Does nothing on CI's database, so the test that "exactly three people hold management" can't run there |

**Recommendation: A1.** The spec's intent (exactly three, from a list Samuel has seen) is kept exactly; only the tool changes.

**Review verdict: agree, with conditions.** This is the only decision that departs from something Samuel answered (Q1), so D4 records it. Conditions, all built in: `people-set-roles` is **additive** (`--add` and `--remove`; it prints before and after, and refuses a result with no island role unless forced; see PR 0.3); spec test 29a becomes a **production probe plus a seeded-database test of the command**, not a test of the migration; PR 0.5 does not merge until the probe shows exactly three; the Neon snapshot step needs Samuel's "ask" mode.

**What people notice.** Nothing either way.

### Decision B: how a guardian's statement records which colony gave her authority (C2)

**The question.** The record keeps who said what and in what role. For a guardian's "she's sterilised", the spec wants it also to keep *which colony* made her an authority on that cat, because the cat might move colonies later.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **B1. Use the existing `authority_scope` text, with a value like `colony:12` (recommended)** | The word list `writeObservation` checks gains one shape: `colony:<id>`. `guardian_of_this_cat` is left for the claim feature (SYC-130) | No change to the observations table, which the spec says is not touched. The colony is on the statement for ever, exactly as the spec asks | One more shape to check. A small amendment to the data spine's §10.1 word list (added to docs PR D1) |
| B2. `authority_scope = guardian_of_this_cat`, and the colony id inside the statement's value | Uses a word already in the list | Every kind of statement a guardian can make (sterilised, ear tip, life status, colony, colour) carries the colony in a different place, and the value shapes `writeObservation` checks all change |
| B3. A new `authority_colony_id` column | The cleanest to query | A change to the observations table, which the spec says this work does not touch, and a migration on the biggest table |

**Recommendation: B1.**

**Review verdict: agree on the shape; the plan now finishes the job.** There is no database check on `authority_scope`, so B1 needs no migration. Conditions, all built in: a strict pattern, `^colony:[1-9][0-9]*$`; **written only by the server**, never read from a request; **only for the role `guardian`**, rejected for every other role in `writeObservation`; and the resolver never treats that scope as authority for a non-guardian role. B1 contradicts the **merged** SYC-2 spec (which says `guardian_of_this_cat`), so a small docs PR, **D5**, aligns it before PR 2.2.

**What people notice.** Nothing. The team's cat page shows "Confirmed by Eleni, cat guardian, 14 October" either way.

### Decision C: where a field-check photo is kept (C3)

**The question.** A guardian's "it looks clipped" can carry a photo. The spec says it must never be public. The only private photo store today belongs to cat-in-trouble reports.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **C1. A small new table, `field_check_photos`, shaped like `welfare_report_photos` (recommended)** | Bytes in Postgres, a random public id, served only by a new team route that checks the photo's cat is in a colony the person holds. The ear-tip statement points at it by that id inside its value, never through `photo_id`, so no public reader can ever join to it | Same proven pattern as report photos. Nothing that serves public photos can see it | A new table, and a migration (PR 3.1). The spec's §10.5 says photo storage is untouched; this is an addition next to it, not a change to it |
| C2. Put it in `photos` with a "private" mark | One photo table | Every public reader would have to filter it. A missed filter leaks a guardian's photo, with every test green: the same silent failure the photo-hiding work spent a whole PR guarding against |
| C3. No photo on field checks for now | Nothing to store | The spec offers the photo, and the team uses it to decide whether to mark a check wrong |

**Recommendation: C1.**

**Review verdict: agree.** It copies the one proven private pattern, and public readers cannot join to it. Added: the upload rules (PR 3.1) and SYC-208 must reach these rows (listed under "What this plan does not do").

**What people notice.** Nothing different from the spec.

### Decision D: who builds the colony screens, and when a guardian can first be invited (C4)

**The question.** Two approved specs list the same routes. SYC-209 (feeding sites and colonies) owns the Colonies page, creating a colony, putting a cat in a colony, feeding sites and the "Recent guardian changes" list. The roles spec owns who may use them. Separately: a guardian is always invited *to a colony*, and today nothing can create one.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **D1. SYC-209's build owns those screens and routes; this plan owns the powers they ask for (recommended)** | This plan delivers the capability names, the rules for which colony a request is about, and one shared helper for "a guardian creates a colony and is placed on it, in one step". SYC-209's PRs call them. The first guardian invitation waits until SYC-209's "create a colony" PR is live; team and management invitations don't wait | One owner per screen. No two sessions build the same page. The roles plan stays about who, not what | Guardian invitations depend on another plan's timing. If SYC-209 slips, the first guardian waits |
| D2. This plan builds the colony screens too | Guardians can be invited as soon as invitations exist | Two plans for one set of screens; certain collision with the SYC-209 build |
| D3. D1, but Claude creates the first colonies with a db-ops command so guardians needn't wait | Unblocks the first guardian | A second way to create colonies, outside the history the team sees |

**Recommendation: D1**, with D3 kept as a fallback only if Samuel wants a guardian in before SYC-209's colony PR is live. Either way, the plan for SYC-209 should be written next, against this plan's Slice 0.

**Production check (12 October 2026, read-only).** Before saying the first guardian "waits on SYC-209", I counted what production holds: a read-only `SELECT count(*)` on `colonies`, `feeding_sites`, `person_scopes where role = 'guardian'` and `people`, through the Neon project's SQL tool. Result: **0 colonies, 0 feeding sites, 0 guardian rows, 3 people.** So the wait is real (there is no colony anyone could be invited onto), D3 is not needed, and nothing is enforcing the wait beyond that fact. Two things follow: PR 1.2's guardian invitation form shows "No colonies exist yet" and cannot send when the list is empty (so the gate is a behaviour, not a hope); and Claude re-runs the same count before Slice 2 goes live. *How to re-check:* the project's default branch was read (the plan assumes it is the production branch; Claude confirms the branch name at the snapshot step). db-ops has no read-only colony command today, so a follow-up ticket adds `db-ops colonies-count`.

**Review verdict: agree, with conditions, all now binding.** (1) The hand-off to SYC-209 is written as **acceptance criteria**, not a promise in a comment: see "Binding hand-offs to SYC-209 and SYC-2" below. (2) Any placed holder who is not island-wide is rendered through `guardianCatView`, **never** the team's cat view, including on SYC-209's `GET /api/team/colonies/:id` (the second guardian colony page). (3) D3, if it were ever used, would give those colonies no SYC-209 history.

**What people notice.** With D1, management can invite team members as soon as Slice 1 ships, and guardians once colonies can be created.

### Decision E: how "Needs a look" is sorted before the offline pages exist (C5)

**The question.** The spec sorts the list by how close each cat is to the person now. The dashboard's pages have no scripts, so they can't ask the phone where it is.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **E1. Grouped by colony name on the plain dashboard page (the spec's own fallback); sorted by distance on the field pages in Slice 4, which are allowed a small script (recommended)** | Slice 3's list is grouped by colony. Slice 4's field page asks for the position (only if the person agrees), sends it with the request, and the server sorts and forgets it | No script on the main dashboard. The spec already says a list with no position is grouped by colony | The list isn't distance-sorted until Slice 4 |
| E2. A "near me" form where the person types a place | Sorting without a script | Clumsy on a phone |
| E3. Allow a script on the "Needs a look" page | Sorted from day one | Widens the no-scripts exception beyond the one path the spec allows it on (§12.2) |

**Recommendation: E1.**

**Review verdict: agree.** Condition: the phone's position is sent in a **POST body**, never a query string, so no proxy or access log keeps it, even though the app's logger already strips queries (PR 4.2).

### Decision F: does the saved colony view need its own short spec first? (C6)

**The question.** The roles spec fixes who may open the saved colony view, what a phone may keep, and how it is deleted. It leaves "what is on the screen" to SYC-54, which has no spec.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **F1. A short SYC-54 screen spec, through the usual review, before Slice 4 is planned in detail (recommended)** | One or two pages: the saved list's layout, the round sheet, what "connect to refresh" looks like, how a queued field check shows | Slice 4 is the riskiest part (the only scripts on the dashboard, a service worker, data on phones). The screen deserves the same care as the rules | A small delay to Slice 4, which doesn't block anything before it |
| F2. Build from the spec's §12.1 lists alone | Faster | Screen decisions made in code review |

**Recommendation: F1.** Slices 0 to 3 don't wait for it.

**Review verdict: agree.** Add to that screen spec: the accept-page wording about phone locks (PR 1.1), and the `Clear-Site-Data` behaviour on removal (PR 4.1).

### Decision G: who wins when people disagree (settled by Samuel, 12 October 2026)

**The question.** Several kinds of people can now say the same thing about a cat (sterilised, alive, ear clipped, colour). When two of them disagree, whose word stands? Today the newest statement wins, whoever said it. With guardians writing, that means a guardian who taps "isn't sterilised" on a cat the vet has recorded as done would quietly put the cat back on a trapping list.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **G1. By level, then newest (chosen).** Vet records win over everyone. An owner's statement wins over a cat guardian's, and a cat guardian's wins over the team's. Within the same level, the newest wins | An owner beats a guardian, who in turn beats a team entry made from a distant record; nobody beats a vet | Uses the knowledge of the people closest to the cat, as Decision 5 intended; a vet's record can never be overturned by a casual tap | The team can no longer overwrite a guardian just by writing later, and a guardian can no longer overwrite an owner. A guardian's wrong word stands until the team marks it wrong (the existing "This is wrong", which still works) or a vet speaks |
| G2. Newest wins whatever role (today's rule) | No change | Simplest | A late tap overturns a vet record |
| G3. The team always beats a guardian | | The team keeps control | Contradicts Decision 5: the guardian's word would count only when nobody on the team has spoken |

**Decided: G1**, with Samuel's 13 October update: an owner always prevails over a cat guardian. It amends the approved roles spec (§7.2, §10.4) and the data spine's resolver rules, so docs PR **D6** records it before PR 2.2.

**How it is built** (PR 0.2 defines it, PR 2.2 uses it): one function, `authorityLevel(observation)`, in `lib/resolve.ts`. Level 4 is a vet; level 3 is an owner (`authority_scope = owner_of_this_cat`); level 2 is a cat guardian (role `guardian` with a `colony:<id>` scope); level 1 is the team (`staff`, `management`) and imported records; anything else counts for nothing. The resolver for the sterilisation answer, life status, ear tip, colour and markings picks the **highest level present, then the newest at that level** (ties by the later row). The server sets `observedAt` on every guardian route; a client-sent `observedAt` is ignored there. A guardian's statement that contradicts a team record still goes on the team's "recent guardian changes" list, marked as contradicting, and the team's record shows as a visible disagreement on the cat's page.

**Settled by Samuel, 13 October 2026: an owner always prevails over a cat guardian.** The full order is vet > owner > cat guardian > team. An owner's word is not overturned by a guardian however late the guardian speaks, and the reverse is not true: a newer owner statement beats an older guardian one, and an older owner statement still beats a newer guardian one. (Slice 6 adds the owner's writes; the ranking function is built now. Because an owner now outranks a guardian as well as the team, SYC-130's claim check matters even more: until it can prove who an owner is, no owner statement is written.)

**Assumptions I made, which Samuel has accepted:**
1. **Imported records rank with the team** (level 1), as their authority is the team's today.
2. **Management ranks with the team**, not above it.
3. **The "sterilised" news goes once per cat, ever** (see PR 2.2): if a Confirmed answer is later marked wrong and then confirmed again, followers are not told a second time. Recommendation: once, since the news can't be unsent and a second message would read as confusing spam.

**What people notice.** A guardian's "she's sterilised" or "she isn't" on her own cat now stays, even if the team entered the opposite earlier; a team member sees the disagreement on the cat's page and can mark the guardian's word wrong. A vet's record is never overturned by either.

### Also needed from Samuel, not decisions

- **Before PR 0.3's production run:** approve the list of who becomes management and who becomes team-only (Decision A). Claude shows it from the live database.
- **Before Neon production steps:** switch the session to "ask" mode, so Claude can take the Neon snapshot before each production migration (the auto mode blocks Neon snapshot writes).
- **Johnny's date (SYC-283).** The plan proposes: Johnny gets the Greek and French of the invitation, accept page, 403 page and guardian pages on the day PR 1.1's English strings merge, and is asked to sign off within seven days. Target: **30 October 2026**. English can go live first.

---

## How it ships: the order

Foundations first, then invitations, then the guardian's pages, then what she records, then the offline list. Every PR is built in **its own worktree off fresh `origin/main`**, is **one PR**, and can merge alone. "Review and merge" uses `/ship`: an independent adversarial review in **its own worktree** (never shared with the builder or another reviewer), findings folded in, CI green, merge, Linear synced, worktree removed.

| Step | PRs | Needs first | Who notices |
|---|---|---|---|
| **Docs** | D1 data spine · D2 team-access · D3 `DECISIONS.md` · D4 roles-spec corrections from this plan's decisions · **D5** SYC-2 and SYC-209 wording aligned with Decision B · **D6** Decision G (who wins) in the roles spec and the data spine | #102, #103, #104 merged (done); Samuel's answers to Decisions A–F | Nobody |
| **Slice 0: foundations** | 0.1 `person_events` · 0.2 one list of roles, the vocabulary and `authorityLevel` · 0.3 the roles migration and the `people` command · 0.4 two doors (API) · **W1** the sign-in Worker · 0.5 the capability catalogue, strict checks, the 403 page and the route walk | D1–D3 and D6 merged before 0.2 (0.2 builds `authorityLevel`); D5 before 2.2 | Almost nobody |
| **Slice 1: invitations** | 1.0 the dashboard's three-language strings · 1.1 inviting and accepting · 1.2 the people screen · 1.3 "My page" and "My colonies" | Slice 0 and W1 live | Management, then the first people they invite |
| **Slice 2: a guardian's own pages** | 2.1 her cats, in full inside her colonies, public outside (and the "moved to another colony" line) · 2.2 what she says about a cat (life status, sterilised, and the one-time news) | Slice 1; D5 and D6 merged; SYC-209's colony PR for the first real guardian (Decision D; production holds no colony yet) | Guardians and the team |
| **Slice 3: what a guardian records** | 3.1 field checks (migration `field_check_photos`) · 3.2 "Needs a look" · 3.3 cat-in-trouble reports for her own cats · 3.4 asking for a site to be made public, and "Needs an OK" (migration `confirmation_items`) | Slice 2; 3.4 also needs SYC-209's feeding-site PRs | Guardians and the team |
| **Slice 4: the colony view with no signal** | 4.1 the field pages' own narrow script rule · 4.2 the saved list and the round sheet · 4.3 field checks made with no signal | Slice 3; a short SYC-54 screen spec (Decision F) | Guardians and the team |
| **Slice 5: the small things** | 5.1 round-sheet counts and the management banner · 5.2 hand-pick review for guardians | Slice 4; 5.2 waits for SYC-152 | Management |
| **Slice 6: owners** | 6.1 a cat owner confirms a sterilisation | SYC-130's spec approved and its claim built | Residents who own a cat |

**The rule from SYC-222 that orders all of this: no role other than the team holds any capability until Slice 0 has merged and is live.** PR 0.5 is where a guardian row first grants anything, and it can't merge before 0.3 (the database refuses an island-wide guardian) and 0.4 plus W1 (the old Worker can't hand a guardian the workspace).

---

## Before any code: the docs PRs (spec §17)

Each is a small docs-only PR, built from the spec's §17 text word for word, plus this plan's decisions once Samuel has answered them. **They are written first, in parallel with PR 0.1. D1–D3 and D6 must merge before PR 0.2, and D5 before PR 2.2**, because 0.2 changes the record's vocabulary (and builds the precedence function Decision G describes) and 2.2 is where the resolver learns the guardian's scope; the code should never be ahead of the approved docs.

**Collision:** PR #107 (SYC-130 "This is my cat", still open) edits the same three files (`DECISIONS.md`, `cat-record-data-spine.md`, `team-access-and-welfare-queue.md`). Whichever merges second rebases. The sections don't overlap except the data spine's §4.2, where D1's sentence about owners must match what #107 says a claim is.

| PR | File | What it changes (spec §17) |
|---|---|---|
| **D1** | `cat-record-data-spine.md` | §6.5 the guardian row and the saved list (17.1.1); §4.2 who can confirm sterilisation, and field checks (17.1.2); the "sterilised" news goes in the app and by push (Samuel, 12 Oct), once per cat; §10.1/§10.4 vocabulary: `admin` → `management`, `guardian` live, `volunteer` retired, the *seen in person* marker and private photo reference, the authoritative roles (17.1.3), **plus Decision B's `colony:<id>` shape for `authority_scope`**; §10.5 the "no colony" value (17.1.4; `created_by` already exists, C7); §4.5 point 3 pointer (17.1.5); §3.2 guardian life-status undo and direct statements (17.1.6); §6.7 guardians see only their own sites (17.1.7) |
| **D2** | `team-access-and-welfare-queue.md` | §7.1–7.2 the roles (17.2.1); §7.3 the catalogue pointer, `view_welfare_queue`, `view_colony_welfare_reports` (17.2.2); §2.7–2.9 pending state, two doors, language (17.2.3); §2 and §8 the 403 page (17.2.4); §3 the welfare queue's capability and guardians' read-only reports (17.2.5) |
| **D3** | `DECISIONS.md` | Part 3 split the "Sign-in, trust boundary, roles" row (17.3.1); Part 2k amended by Decision 5 (17.3.2); Part 2i `match_cat_anywhere` reserved (17.3.3); **a new Part 2n, dated 12 October 2026**, carrying the §16.5 entries, plus the answers to this plan's Decisions A–F (17.3.4) |
| **D4** | `roles-and-invites.md` | The corrections this plan's decisions make to the roles spec itself: §15.2 step 5 (management added by the `people` command after the migration, Decision A); §7.3 and §10.4 (`authority_scope` = `colony:<id>`, Decision B); §7.3 point 3 and §10.5 (the `field_check_photos` table, Decision C); §15.1 (the colony routes belong to SYC-209, Decision D); §7.1 (grouped by colony until the field pages, Decision E); §10.5 (`created_by` exists, C7); **§7.2 and §3: the "sterilised" news goes in the app and by push, with no email, once per cat, whoever's statement made it Confirmed.** Only the parts Samuel agrees to |
| **D5** | `coat-markings-and-health.md` (SYC-2) and `feeding-sites-and-colonies.md` (SYC-209), both merged | **Aligns the merged specs with Decision B (review finding M4).** SYC-2's data-model line says coat and markings accept `guardian` "with `authorityScope: guardian_of_this_cat`"; it becomes "`authorityScope: colony:<id>` for her own colonies, written only by the server, only for the role `guardian`" (the strict pattern `^colony:[1-9][0-9]*$`). `guardian_of_this_cat` stays reserved for the claim feature. SYC-209's wording "`colonies.created_by` is a link to people" becomes "holds the creating person's id as text". A real PR on `main`, not an edit to a merged PR |
| **D6** | `roles-and-invites.md`, and `cat-record-data-spine.md` (the resolver rules, §10.2 and §4.6) | **Records Decision G.** The order **vet > owner > cat guardian > team**, newest wins only within the same level (settled by Samuel, 13 October: an owner always prevails over a guardian); imports and management rank with the team; the server sets `observedAt` on guardian routes; a guardian's statement contradicting a team record goes on the team's "recent guardian changes" list. Amends roles spec §7.2 and §10.4 and the data spine's "newest authoritative statement wins, whatever sign" rule. **Merges before PR 0.2 and so before PR 2.2** |

**The sibling specs (§17.4).** SYC-209 (#103) and SYC-2 (#104) have **merged**, so any correction is a real small PR (D5), not an edit to the pull request. SYC-209 already carries the 12 October names (checked: its §7.2 cites `create_colony`, `assign_cat_to_colony` and the removed `propose_colony_change`); SYC-2 is checked for the four names and the dropped `confirm_appearance` when D1 is written. SYC-130 (#107): a comment on the PR asks it to say that an owner's confirmation of sterilisation follows its claim (§17.4.3), so it is fixed in that PR before it merges.

---

## Slice 0: foundations (nobody sees anything)

**In plain English.** Before anyone who isn't on the team can get in, the app needs four things: a permanent record of every change to who can get in; one place that says what the team's roles are called; a database that refuses a guardian with no colony or an island-wide guardian; and permission checks that refuse, rather than allow, when a page forgets to say which colony it is about. This slice builds all four, and teaches the sign-in page to tell "the workspace documents" from "the dashboard". When it is live, Samuel, Jacky and Susan are management and everyone else on the team is team-only. Nobody else notices anything.

### PR 0.1: `person_events`, the record of who changed what (SYC-213; migration `person_events`)

- **Migration (next free number, expected `0015`).** `person_events (id serial, person_id uuid → people.id strict, kind text, by text, at timestamptz default now(), detail jsonb)`. The kind check holds **the fuller list from spec §11.1 from the start**: `invited`, `invite_sent`, `invite_resent`, `invite_withdrawn`, `accepted`, `added`, `roles_changed`, `left`, `rejoined`, `signed_out_everywhere`, `anonymised`. An append-only trigger refuses update and delete, written like the one on `observations`. Backfill: one `added` event per existing person (from `added_by`/`added_at`) and one `left` event for anyone with `left_at` set. Rollback: drop the table; the rollback block says in capitals that this deletes the history.
- **`lib/db/src/people.ts`.** `addPerson` writes `added` (or `rejoined` for a left address), `markLeft` writes `left` with the roles and colony ids held at the time, `signOutEverywhere` writes `signed_out_everywhere`, each **in the same transaction** as the change. `detail` holds ids and role names only, never a name or an address.
- **`removePerson` is retired** (spec §9.6, finding S6): every person now has an `added` event with a strict link, so a hard delete can never succeed. The function, the `people remove` subcommand and db-ops `people-remove` are removed; marking as left is the only way off the list. SYC-43 part 2's tests P0-4 and P1-10 are updated to say so.
- **`people list`** shows each person's history (ids and kinds only).
- **The test harness (review minor 11).** A strict `person_events` link plus the append-only trigger breaks every test that cleans up by deleting people. The existing tests clean up by switching the table's TRUNCATE guard off, truncating, and switching it back on (see `lib/db/src/migrate/people.test.ts` lines 53–59 and `deletionUnlinks.test.ts`). `person_events` gets a `person_events_no_truncate` guard of the same name shape, and **every test that creates people** is updated to the same switch-off, truncate, switch-on step, not just P0-4 and P1-10. Budgeted in this PR: its first task is `grep` for every test that touches `people` and list them in the PR.

**Tests.** T21 (spec §15.3 test 21): every operation writes exactly one event, in its own transaction. **Mutation probe:** drop each insert in turn → red. The trigger refuses `UPDATE` and `DELETE`. The backfill gives each existing person exactly one `added` event and each left person one `left`. Up/down/up passes.

### PR 0.2: one list of the team's roles, the record's vocabulary and who wins (SYC-252; Decision G)

**In plain English.** This is the PR that decides, in one place, whose word counts most: a vet first, then a cat guardian or an owner, then the team. Nobody can write as a guardian yet, so nothing visible changes, but the rule exists, is tested, and every later PR uses it.

- **One module, `lib/teamRoles.ts`**: `TEAM_ROLES` = `staff`, `management`, `vet`. `lib/resolve.ts` (`AUTHORITATIVE_ROLES`), `lib/teamCorrections.ts` (`TEAM_ROLES`) and, through it, `lib/likelyReview.ts` import it. A source test fails if a role list is written anywhere else. `guardian` is **not** added to this set (review M1): her authority comes only through the next bullet.
- **`authorityLevel(observation)` in `lib/resolve.ts` (Decision G).** Returns 4 for a vet, 3 for an owner (`authority_scope = owner_of_this_cat`), 2 for a cat guardian (role `guardian` with a scope matching `^colony:[1-9][0-9]*$`), 1 for the team (`staff`, `management`) and import-provenance records, 0 for anything else. The sterilisation fold, the life-status fold, the ear-tip rule and (through SYC-2's build, a binding hand-off) colour and markings all choose **the highest level present, then the newest at that level, ties by the later row**. It replaces the two boolean helpers `isAuthoritative` and `isAuthoritativeRole`. Today nobody writes level 2, 3 or 4, so every result is unchanged; the function is tested with fixture rows.
- **`admin` becomes `management`** in `writeObservation`'s `REACHABLE_ROLES` and in the resolver. Before this merges, Claude runs a read-only count on production through db-ops (`observations` where `role_at_time = 'admin'`); it must be zero (spec §15.2 step 1). PR 0.3's migration checks it again.
- **`actingRole(person, capability, target)`** in `lib/capabilities.ts` decides the `roleAtTime` written on a statement (spec §10.4). It replaces the hand-written `"staff"` in `lib/teamCorrections.ts` (4 places), `lib/welfareActions.ts:81` and `lib/welfareTie.ts:188`. Today it returns `staff` for every team member, so nothing written changes. The two in `routes/notifications.ts` belong to the owner-key route, which has no signed-in person; they stay, and retire with SYC-185.
- **Vocabulary that later PRs need, accepted but not yet written by anyone:** the `colony` observation accepts `{ colonyId: null }` ("no colony", spec §6.8), so SYC-209's "take out" can use it; `authority_scope` accepts `colony:<id>` (Decision B). `guardian` stays refused until PR 2.2.

**Tests.** T23 (part): a management member's correction is authoritative in the resolver, the review list and the correction routes. **Mutation probe:** revert one importer to its own list without `management` → red. A `colony` observation with `colonyId: null` is accepted; `colonyId: "x"` is still refused. **Precedence (Decision G), at the function and in the sterilisation, life-status and ear-tip folds, each edge with its own probe:**
- **vet vs guardian:** a guardian's statement newer than a vet's does not win. *Probe:* rank the guardian (level 2) equal to the vet (level 4) → red.
- **vet vs owner:** same, with an owner-scoped fixture row. *Probe:* rank the owner equal to the vet (level 4) → red.
- **guardian vs team:** a team statement newer than a guardian's does not win; a guardian's older statement beats the team's newer. *Probe:* rank the team equal to the guardian (plain newest-wins, today's rule) → red.
- **owner vs team:** same, with an owner. *Probe:* rank the owner at 1 → red.
- **owner beats guardian (Decision G, 13 October), both ways round in time:** an owner's statement older than a guardian's still wins, and an owner's newer than a guardian's wins. *Probe:* make them the same level (plain newest-wins between the two), or let the guardian win → red.
- **same level, newest wins:** two guardians, two owners, two team members, and the equal-timestamp tie (later row wins). *Probe:* oldest wins, or first-in-list wins → red.
- **a `colony:<id>` scope on a non-guardian role** counts for nothing (level 0), and `writeObservation` refuses to write it. *Probe:* count any role with the scope as level 2 → red.
- **Opus builds this PR and an Opus reviewer in its own worktree runs these probes by hand** (Model delegation).

### PR 0.3: the roles migration, and the `people` command (spec §10.1, §10.3, §15.2; migration `roles_and_invites`)

**The migration (next free number, expected `0016`), in one transaction, stopping with a list and changing nothing if any check fails:**
1. Refuse if any observation has `role_at_time = 'admin'`, printing the ids.
2. Refuse, listing every offending row, if any `person_scopes` row is `volunteer`, a `guardian` with no colony, or a `staff` row with a colony.
3. Add `people.accepted_at`, `invite_sent_at`, `invite_expires_at`, `language` (not null, default `en`, check `en`/`el`/`fr`). Set `accepted_at = added_at` for everyone.
4. Add `person_scopes.reach` (nullable), fill it from `colony_id` (`colony` when set, `island` when null), then make it not null with no default. Add `expires_at`, `relationship` (check `feeds`/`owns_here`/`covering`), `granted_by`, `granted_at` (default now).
5. Replace the role check with `staff`, `management`, `guardian`, `vet` (no `volunteer`). Add the checks: `reach = 'colony'` exactly when `colony_id` is set; `guardian` needs `reach = 'colony'`; `staff` and `management` need `reach = 'island'`. The unique (person, role, colony) constraint stays.
6. **No management rows** (Decision A1). **`confirmation_items` is not created here**: it moves to PR 3.4's own migration (review M7), because it has a strict link to `feeding_sites`, which SYC-209's non-additive migration is about to reshape, and nothing uses it for weeks.

**The rollback block (review M7). Written in capitals, as 0.1's is: ROLLING BACK THIS MIGRATION AFTER `people-set-roles` HAS RUN IS NOT SAFE.** Once `management` rows exist, and after Slice 1 `guardian` and pending rows, restoring the old role check would fail, and dropping `accepted_at`, `reach` and the placements destroys state. So the rollback block either **deletes the `management` rows, `guardian` rows and pending people and prints the count** before restoring the old check, or **refuses and lists them**; the plan picks refuse-and-list for production (nothing is lost silently) and delete-with-count for the CI harness. Plainly: **once `people-set-roles` has run in production, the production path is fix-forward, not roll back.**

**Code.** The schema in `lib/db/src/schema/people.ts` (`PERSON_ROLES`, the columns, `confirmationItemsTable`). `findAllowedPerson` and `findPersonById` now also require `accepted_at` to be set, so **a pending person is never a `CapabilityHolder`** (spec §10.1); nobody is pending yet, so nothing changes. `scopesOf` returns `reach` and `expires_at`. The `people` command: `add` requires `--colony` for `guardian` and refuses `volunteer`; gains `--language` and `--accepted` (break-glass, for a team member added directly); a new **`set-roles`** subcommand writes `roles_changed` and is **additive by default** (review minor 4; it is also the break-glass, so it must be hard to misuse): `--add <role>` and `--remove <role>` change one role at a time, a bare list needs `--replace`, it prints the person's roles **before and after**, and it **refuses a result with no island role** (`staff` or `management`) unless `--force` is given. `add` refuses `--role management` (review minor 5): between this PR and 0.5 `can()` is still staff-only, so a management-only person would have no powers and no way in; management is granted only by `set-roles --add management` on someone who already holds `staff`. `list` shows placements (ids, never addresses). db-ops gains `people-set-roles` (with the same flags) and the new role list (`scripts/db-ops.sh`).

**Behaviour after it ships: unchanged.** `can()` still answers "holds `staff`?"; the three management rows sit beside their `staff` rows.

**Tests.** T17 and the database half of T3: inserting a guardian with no colony, a guardian with `reach = 'island'`, a `staff` row with a colony, or any `volunteer` row is refused by the database. **Mutation probes (T17):** drop the `reach` check → the island-wide-guardian test red; drop the "guardian needs a colony" check → the no-colony test red. T29: on a database seeded with each kind of bad row, the migration stops and lists them (and an `admin` observation), and on a clean one it leaves every existing person with `accepted_at` set. T9 (part): a person with `accepted_at` null is found by neither finder. **Mutation probe:** drop that condition → red. Up/down/up passes on the empty CI database, **and a seeded-database rollback test (review M7)**: up, then insert a `management` row, a `guardian` row and a pending person, then down: the rollback refuses and lists them (production behaviour) or deletes them and prints the count (harness behaviour), never half-completes, and the schema is unchanged after a refusal. **Spec test 29a** becomes: a seeded-database test of `people-set-roles` (adds `management` beside `staff`, never replaces by default, refuses a no-island-role result) plus the production probe below.

**Production (Claude, in this order):** db-ops `migrate` on development → Claude shows Samuel, from the live production list, the three who will be management and every other team member who will be team-only → Samuel says yes → Neon snapshot of production (**needs Samuel's "ask" mode**) → db-ops `migrate` on production, then `verify` → db-ops `people-set-roles --add management` for Samuel, Jacky and Susan (each keeps `staff`; the command prints before and after) → `people-list` shows exactly three holding `management` (T29a, as a probe). Nobody adds people between the migration and the publish; db-ops runs `main`'s code, so its inserts already carry `reach`.

### PR 0.4: two doors, on the app's side (SYC-222 points 1 and 2; spec §4.5, §6.3)

- **`use_workspace`** joins the capability list, and `mayUseWorkspace(person)` asks `can()` for it. `can()` is still staff-only at this point, so it is true for exactly the people who get the workspace today.
- **`POST /api/internal/people/allowed`** reads an optional `version` field. With `version: 2` it answers `{ allowed, doors: { workspace, dashboard }, language, personId, name, sessionVersion }`. **The old request shape is answered `allowed: true` only for someone who holds the workspace door** (spec §14 case 11), so the Worker deployed today can never hand a guardian the workspace. Every "no" stays identical whatever the reason.
- **Tests.** T7: a guardian test row (placed on one colony) gets `allowed: false` from the old shape and `doors.workspace: false` from the new; a staff address gets both doors. T8 (part), and spec §14 case 13: an unknown address, a left person and a person with no door get byte-identical answers. **Mutation probe:** answer the old shape with `mayEnter` instead of the workspace door → T7 red. **T27 (part), probe:** make `mayUseWorkspace` return `mayEnter` → red (a guardian with a valid dashboard session is refused the workspace).

### PR W1: the sign-in Worker learns the two doors (`fairshake-au/catspotters-website`)

**In plain English.** This changes the one door every team member uses, in another repository, so it is the riskiest PR in the plan and is specified more tightly than the rest: it has a way back, it keeps a guardian's identity safe in the moment between the link and the dashboard, and it treats any doubt as "no door".

- **Where.** In the Worker's repository, in its own worktree there. It sends `version: 2`, issues a **workspace session only when `doors.workspace` is true**, and for a **dashboard-only** person sends her **straight to the dashboard**, as the spec says (§6.3: "goes straight to the dashboard"). **The earlier "Open my colonies" page is dropped**: it was an unflagged deviation from the spec and would have been English-only for a Greek guardian. No workspace session, no document password, no lock switches.
- **How her identity survives between the link and the dashboard (review M8).** It does not need to survive anywhere. The sign-in link is redeemed by the Worker's existing confirm step ("Yes, sign me in", a POST that spends the one-use token). For a dashboard-only person, **that same request** asks the app, mints the usual one-minute, one-use hand-off pass and answers with the page that posts it to `team.catspotters.com/api/team/handoff` (the same auto-submitting form, with a visible "Continue" button for browsers with scripts off, that today's `POST /dashboard` uses). Nothing is stored between the link and the dashboard, and no workspace cookie is set. The only thing that proves her address is the spent token and the pass; neither can be replayed.
- **Fail closed (review M8).** If the app answers a version-2 request in the old shape (for instance after the API is rolled back), the Worker finds no `doors` and treats that as **no door at all**: it never falls back to `allowed`. The test mocks exactly that response.
- **Ships after PR 0.4 is live**, so the new request always gets the new answer. Until W1 ships, a guardian simply can't sign in, which fails safe (spec §4.5). The sign-in email stays English for now; the person's `language` is read and used once Johnny has signed off Greek and French (SYC-283), by a one-line switch.
- **Rollback and staging (review M8).** Before deploying, record the Worker's current version id (`wrangler versions list`). Deploy. Probe at once: a real staff address still gets the workspace; the break-glass address still gets 24 hours of workspace; a test guardian row (on development) gets the dashboard and no workspace cookie. **If any probe fails, roll back immediately** (`wrangler rollback <recorded version id>`) and stop. The reason this is written down: the `admins` break-glass row covers the workspace only, so a bad Worker could lock the whole team, Samuel included, out of the dashboard.
- **SYC-26 (Google sign-in), checked.** I read the Worker repository's `syc-26-plan` worktree (branch `claude/syc-26-plan`, `d63b704`): it holds a **plan only** (`docs/plans/syc-26-google-sign-in.md`, no code yet). It pulls the "who may enter" decision into one shared function used by the email link and by Google, and says "No Worker change" for roles (SYC-188). That is now out of date: the Google door must also ask version 2, honour `doors`, and send a dashboard-only person straight to the dashboard. Order: **W1 goes first and puts the doors in the shared decision function if SYC-26 has landed, otherwise SYC-26 builds on W1's version.** Hand-off: SYC-26's plan gets a note (a comment on SYC-26, filed as a follow-up) that its decision function must carry `doors`, with a test that a Google sign-in for a dashboard-only person sets no workspace cookie. Not edited here.
- **Tests (that repository's suite, with its mocked people list):** old-shape and new-shape answers; a dashboard-only answer never sets the workspace cookie; a version-2 request answered in the old shape grants nothing. **Mutation probes:** grant on `allowed` alone → red; grant when `doors` is missing → red.

### PR 0.5: the capability catalogue, strict checks, the 403 page and the route walk (SYC-222 points 3 and 4; spec §6)

**This is the PR where a guardian row first means something. It merges only after 0.3, 0.4 and W1 are live and the three management rows exist in production.**

- **The catalogue as data** in `lib/capabilities.ts`: every name in spec §6.2, with its kind (island-only, placed, role-wide, creates its own scope) and the roles that hold it, including the reserved `match_cat_anywhere`. `manage_people` and `action_deletion_request` are **management only**; from this PR, team-only members lose them (no screen uses them yet).
- **`can(person, capability, target?)` is strict.** Island-only: an unexpired island row of a role that holds it. Placed: with a target, an island row, or an unexpired colony row for exactly that colony; **with no target, island rows only** (Decision 4). Role-wide and "creates its own scope": any unexpired row of a role that holds it. Expiry is compared with the database's clock on every request; no job runs.
- **`canSomewhere(person, capability)`** answers "for any colony?" and is used only by `mayEnter` (the dashboard door) and menus. `capabilitiesOf` now says *where* each capability applies, and `GET /api/team/me` returns that (finding S13).
- **Targets come from the record, never the request** (`lib/capabilityTargets.ts`): a cat's colony is its newest active `colony` observation (superseded ones ignored, `colonyId: null` means none); a photo's colony is its cat's; a report's colony is its cat's; a feeding site's colony is its own column. A cat in no colony has no placed target, so only island holders pass.
- **`requireTeam(capability, resolveTarget?)`.** Not signed in keeps today's 401 and redirect. **Signed in but not allowed gets a quiet 403 page**: *"That part of the dashboard is for the Syros Cats team. Your colonies are here,"* with a link home (spec §6.4). English here; PR 1.0 makes it three-language.
- **Two more refusals the review found (minors 1 and 2).** (a) **A person whose every placement has ended** (a holiday cover on the day after her end date) is a signed-in person who may no longer enter. Today `requireTeam` answers `!mayEnter` with the sign-in 401, which sends her round a loop with no explanation. After this PR a valid, accepted, not-left person who holds nothing gets the **403 page with its own sentence, "Your access has ended. Ask Syros Cats if you think that's a mistake."**; only a missing, expired or left person still gets the 401. (b) **The two JSON observation routes** (`POST /team/observations` and `POST /team/observations/:id/supersede`) use `requireTeam()` with no capability and call `can()` inside, answering a refusal with `refuseNotSignedIn`. They get an explicit row in the route table: a guardian who passes the door and is refused by the inner strict `can()` gets a **JSON 403 (`{ "error": "forbidden" }`), not the 401**. The guardian's own statements go through her own routes in Slice 2, never these.
- **Routes, moved as the spec's §6.2 note 4 says:** `GET /team` (the queue), `GET /team/reports` and `GET /team/report-photos/:publicId` → **`view_welfare_queue`** (island-only). `GET /team/cats` and `GET /team/cats/:id` → `view_exact_location` **with no target, so island-only**: the team's cat page shows things a guardian must not see, and she gets her own page in Slice 2. `GET /team/photos/:publicId` → `view_exact_location` **with the photo's cat as the target**, and a hidden photo is served only to a holder of `hide_photo`. Every correction and report route keeps its capability **with no target, so island-only**. Guardians get their own routes in Slices 2 and 3, each with its own target. Every existing route stays closed to guardians by construction.
- **No guardian can do anything useful yet.** A guardian test row can pass the dashboard door and reach `GET /team/me` and the 403 page. That is the intended state.

**Tests.**
- **T1, the route walk.** Every route registered under `/api/team` and `/api/internal` (read from the router, with a minimum count so an empty walk fails), called by eight kinds of person: team, management, a guardian on one colony, a guardian on several, a pending invitee, a left person, someone whose roles grant nothing, **and a guardian whose every placement has ended** (expects the "access has ended" 403 on page routes, the JSON 403 on JSON routes). Each answer is compared with a table in the test, and **a route not in the table fails**. It extends `team.walk.test.ts` and keeps its "not signed in" check. **Mutation probes:** register a route without `requireTeam` → red; make `can()` with no target answer "any colony" → red (the guardian reaches the queue).
- **T2.** A person who may enter but lacks the capability gets the 403 page (or the JSON 403 on the two JSON observation routes), not the sign-in redirect or 401, on every capability-gated route. **Mutation probes:** send the 401 instead → red; let the two JSON routes keep `refuseNotSignedIn` → red.
- **T3 (the rest).** A guardian placed on every colony that exists can't reach the welfare queue, the report list, a reporter's photo or the cat list.
- **T5 (part).** The catalogue photo route takes its target from the photo's cat, never from the request. **Mutation probe:** take the colony from a query parameter → red.
- **T6.** A placement whose end date has passed stops working at the next request, with no job run. **Athens midnight (review minor 3):** the form takes a date and the column is a timestamp; the placement ends at midnight Athens time at the end of that date. Clocks go back on **25 October 2026**, so the test uses an end date of 25 October: the placement works at 21:59:59 UTC on the 25th and is refused at 22:00:01 UTC (midnight Athens is 22:00 UTC that night, after the clocks change). **Mutation probes:** ignore `expires_at` → red; compare against the app's clock instead of the database's (the test freezes the app clock an hour behind) → red; compute the end as "date plus 24 hours of UTC" (which is an hour wrong across the change) → red.
- **T24, the catalogue test.** The map in code is compared with the §6.2 tables **parsed from `docs/specs/roles-and-invites.md` itself**, so the document and the code can't drift; the names SYC-209 (`feeding-sites-and-colonies.md`) and SYC-2 (`coat-markings-and-health.md`) cite must exist in it (both specs are now on `main` and are parsed too). The test **pins the table's shape** (column count and header text), so a later spec edit fails with a message that names the row or column that changed, not a parser error. **Mutation probe:** give guardians `set_site_public` in code → red.
- **T27.** `use_workspace` is refused to every role but team and management, including with a valid dashboard session. **Mutation probe:** make `mayUseWorkspace` fall back to `mayEnter` → red.
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
- `invitePerson(by, { email, name, roles, colonies, relationship?, expiresAt?, language })`: a pending person (`accepted_at` null), their placements, an `invited` event. A guardian with no colony is refused (the database refuses it too). **It records the language actually used** (`LIVE_LANGUAGES` falls back to English silently) in the event's `detail` beside the language asked for (review minor 10), and the People screen says "will be sent in English" when a language that isn't live yet is chosen.
- `findInvitee(id)`: **invited and not expired**, no placements returned. Used by the hand-off, the accept page, the decline route **and the allow-list answer for a pending invitee** (so she can receive her sign-in link; review minor 6). The "every place the list is read" inventory below says so.
- `acceptInvitation(id, name, promisesVersion)`: **one conditional update** (`where accepted_at is null and left_at is null and invite_expires_at > now()`), `accepted` event with the promises version (`promises-v1`). Pressing twice changes nothing the second time.
- `declineInvitation`, `withdrawInvitation(by)`, `resendInvitation(by)`: the same kind of guarded update. Declining and withdrawing mark the pending person as left (`invite_withdrawn`); a row is never deleted (spec §9.6). Resend sets a fresh 14 days, at most once per person per 24 hours.
- **Anonymise on withdrawal is built here, not deferred to SYC-208 (review M9).** Spec §14 case 1 lists "a wrongly invited stranger's address is anonymised on withdrawal (§9.6)" among the things that limit the accepted wrong-mailbox risk, and it must be true the day invitations go live. So, for a person who **never accepted**, withdrawing or declining replaces the address and the name with a fixed placeholder (`withdrawn-<person id>@invalid`, name "Withdrawn invitation") **in the same transaction**, and writes an `anonymised` event whose detail holds no address. The row stays (a person with a history is never deleted). It frees the address for a fresh invitation. An invitation that merely **expires** is not anonymised (nobody withdrew it); SYC-208 still owns forgetting people who did join, and reuses this placeholder.
- `setRoles(by, personId, placements)`: never your own (refused); writes `roles_changed` with before and after (role names and colony ids). Re-placing a guardian on a colony she once held **updates her old row** (clears the end date, records who and when).
- `rejoinPerson(by, personId, placements, language)`: `accepted_at` back to null, new placements, `rejoined` then `invited`; she accepts again (spec §9.4).
- `markLeft` gains: **every pending invitation the leaver sent is withdrawn in the same transaction**, with the count returned for the screen (spec §9.2); and **the last management person can't be marked as left, demoted or signed out everywhere**, checked with the management rows locked (`SELECT … FOR UPDATE`) so two managers removing each other at once can't both succeed (spec §9.5).
- `createColonyWithPlacement(person, colony)`: for SYC-209's "create a colony" route (Decision D). For a guardian, writes the colony (`created_by` = her id), her placement (`reach = 'colony'`, `granted_by` = her own id) and a `roles_changed` event in one transaction; for a team member, the colony only (spec §6.1, §6.9). Built and tested here (T30's core) so SYC-209 only calls it.
- `stopHelping(personId)`: the person's own "stop helping", recorded as `left` by `self`.

**Two new mail purposes** (`lib/mail/send.ts`), both closed templates with no free text from anyone:
- **`person_invite`**: from `Cat Spotters <signin@mail.catspotters.com>` (C8), on the transactional identity, shed after sign-in links and welfare mail when the quota is tight. A new recipient kind, **`person`**: **the caller passes a person id, not an address**; the function looks the address up and refuses unless that person is pending and unexpired (spec §8.5). The words that vary are the role and the colony name, from the person's own record, escaped and length-limited. English until Johnny signs off. `invite_sent_at` is set only when the outbox delivers it; **a failed send is shown as "Not sent yet", never "Invited"**, and retries like other mail.
  - **Delivery-time re-check (review M9).** The outbox stores only a hash, so the address is looked up **when the mail is delivered**, not when it is queued. The drain therefore re-checks, at that moment, that the person is **still pending, unexpired and not anonymised**, and that the address it resolves is the one queued; if not, the outbox row is cancelled and nothing is sent. An invitation withdrawn, expired or anonymised between the queueing and the delivery never reaches a mailbox. **The drain change and the `invite_sent_at` write on delivery are new code in `lib/mail`**, listed here as in scope for this PR.
- **`access_change_notice`**: to every other management member who hasn't left, never the one who acted. It says who made which change to whom. Sent for **every** invitation, role change, return, person marked as left and sign-out-everywhere, **whoever it concerns, a cat guardian included, which is the common case** (spec §8.1, §8.3, §9.5; review minor 8). Another new recipient kind, **`management`**.

**Limits** (spec §8.5): 10 invitations per inviter per day, 1 per address per 24 hours, 30 per IP per hour.

**The hand-off and the doors for a pending person.** The allow-list answers a pending, unexpired invitee `doors: { dashboard: true, workspace: false }` (spec §4.5). The hand-off gives her a session marked *pending*, and **`requireInvitee`** lets that session reach the accept page and the decline route and nothing else; `requireTeam` refuses it everywhere (it uses `findPersonById`, which never returns a pending person). **On accept the pending cookie is replaced (review minor 7):** the accept response issues a fresh full session (a different cookie kind), so she is not asked to sign in again, and the old pending cookie is refused by `requireTeam` and `requireInvitee` from then on.

**The accept page** (`GET /api/team/my/welcome`, `POST …/accept`, `POST …/decline`), in her language once it is live: who invited her and for what, **what she will be able to see and do** (spec §4.1 step 4), the **three promises word for word** (spec §4.1), the name field pre-filled and editable, *Yes, join* and *No, this isn't for me*. **Beyond the three promises, the page also carries what spec §12.2 and §14 cases 9 and 10 require (review M5), as plain statements, not promises:** a request to **keep a lock on her phone**, and a sentence that a phone that is never opened again keeps its saved list until the browser clears it. All three pieces in all three languages (Johnny's list). Every POST passes `requireOrigin`. No email goes to the inviter when she accepts (Decision 7).

**Tests.** T8 (complete) and T9: a pending invitee gets only the dashboard door; her session reaches the accept page and nothing else; her placements are never read by `can()`. **Mutation probe:** let `findPersonById` return pending people → red. T10: accept and withdraw at the same moment, and accept after expiry, each with exactly one winner; rejoining sets `accepted_at` to null. **Mutation probe:** drop the `invite_expires_at > now()` guard → red. T15: one management member alone can invite team, management **or a cat guardian**, change roles, bring someone back and mark another manager (or a guardian) as left, each at once, each with its event, each emailing every other manager and not the actor; there is no `approve_access` and no approval item anywhere (source test). T18: the last manager can't be removed, demoted or signed out through these functions, including two at once (a concurrent test). **Mutation probe:** drop the row lock → red. T19: leaving withdraws the leaver's pending invitations and emails the other managers (for a guardian's invitation, change and removal too). T20: withdrawing never deletes a row, **and anonymising on withdrawal replaces the address and name but keeps the row; a person who accepted is never anonymised here. Mutation probe:** skip the anonymise step → red. **Delivery-time re-check:** withdrawing, expiring or anonymising between enqueue and drain sends nothing. **Mutation probe:** drop the re-check in the drain → red. **Pending cookie:** after accept, the old pending cookie reaches no capability route and no accept route (**mutation probe:** keep honouring the pending kind → red). T21 (extended to every new kind). T22: the invitation function can't be given an address; the text holds only the role and the colony name; a name with markup or a link is escaped; the limits hold; a failed send isn't shown as sent; no acceptance email exists. **Mutation probe:** let the caller pass `to` → red. T29d: **exactly three promises** and **the whole page carries what the spec requires**: the "what you'll be able to see and do" text, the lock-your-phone request and the never-reopened-phone sentence are all present, none of the three phrased as a promise and none about keeping places private; all in three languages with key parity; and the promises version recorded with the acceptance. (T29d pins the three promises *and* the required extra text; a builder must not remove the extra text to satisfy "exactly three".) **Mutation probes:** remove the lock sentence → red; add a fourth promise → red. Spec §14 case 14: accept, decline and withdraw are Origin-checked and safe to press twice. T30 (core): `createColonyWithPlacement` writes all three rows or none (**mutation probe:** fail the placement insert → no colony left behind).

### PR 1.2: the People screen (SYC-104; spec §8.1–8.2, §9.3, §6.3)

Management only (`manage_people`), English (Decision 10), server-drawn like the rest of the dashboard.
- **The list**: name, roles in plain words, colonies, and a chip: *Not sent yet · Invited · Joined · Expired · Left* (worked out when the page is drawn; nothing writes "expired"). Beneath each person, their history from `person_events`, ids turned into names on screen. **Joined in the last 7 days** beside the list. A **Left** tab with **Bring back** (roles chosen afresh).
- **Invite someone**: address typed once (Decision 7), name, role, colonies (for a guardian), optional end date and label per placement (Decision 9), language (with "will be sent in English" when the chosen one isn't live yet). **Resend** and **Withdraw** on pending people. **With no colonies in existence, the guardian option says "No colonies exist yet" and cannot send** (production holds none today; Decision D's check), so the wait for SYC-209 is a behaviour, not a hope. The date field means the end of that date **in Athens time** (see T6's 25 October test); the screen shows the resulting instant.
- **Change roles and placements**, **Mark as left**, **Sign out everywhere**. Marking as left someone who held the workspace reminds management to change the shared document password (spec §6.3). When a guardian leaves or hands over, the screen offers *"Vaporia — Eleni's still has Eleni's name on it. Rename it?"* with a link to SYC-209's rename (spec §9.3; a nudge, never automatic). After a departure, *"3 invitations from Susan were withdrawn when she left. Re-send any you still want."*
- No free-text box on this screen ends up in an email.
- **Review and probe (review M10).** This screen is the only place access is granted and removed, so it gets a **full Opus adversarial review** (not a spot review), and a mutation probe per gate: drop `manage_people` from one route → that route's 403 test goes red (done once per route); drop the Origin check → red; allow changing your own roles → red; let a free-text field reach an email → red.
- **Tests.** T15 (screen half): a team-only member gets the 403 page on every People route. The chips match the state table in spec §10.1 for one seeded person in each state. An end date entered across the 25 October clock change lands on Athens midnight. **Browser check** at ~390 px and desktop with seeded people in every state, before the PR opens; screenshots in the PR.

### PR 1.3: "My page" and "My colonies" (spec §2.6, §9.1, §13.1)

- **`GET /api/team/my`**: the one sentence about yourself (*"You're a cat guardian for Vaporia — Eleni's and Kato Chora."*), change language, sign out, sign out everywhere, and **Stop helping** (plainly worded, different from management's route; spec §9.5). Any accepted person, no capability needed (spec §6.2 note 1).
- **`GET /api/team/my/colonies`**: a guardian's colonies by name, with any placement label and end date; a team member sees a link to the island-wide pages instead. Cats arrive in PR 2.1.
- The home a signed-in person lands on after the hand-off depends on what they hold: the welfare queue for the team, *My colonies* for someone who holds only placed capabilities.
- Three-language for the person's own pages and the 403 page.
- **Tests.** A guardian's home is *My colonies*; a team member's is the queue. *Stop helping* ends the session at the next request and writes `left` by `self`. **Browser check** at ~390 px and desktop, in English (and in Greek with `LIVE_LANGUAGES` switched on locally).

**First real use.** Once Slice 1 is live, Samuel invites one team member through the screen as the acceptance test. The first guardian is invited once a colony can be created (Decision D).

---

## Slice 2: a guardian's own pages

**In plain English.** Eleni opens *My colonies* and sees her cats: names, numbers, photos, exact positions, whether each one is done and how sure we are, when each was last seen. Any cat outside her colonies looks to her exactly as it does in the public app. She can say a cat has been homed, is in care or has died, and undo her own change within 30 days. She can say a cat is sterilised, and it shows as *Confirmed* straight away, with her name on it; followers of that cat are told once, in the app and by a push notification (no email). If her word and the team's disagree, hers stands over the team's but never over a vet's (Decision G). The team sees *"Confirmed by Eleni, cat guardian, 14 October"* on the cat's page, with a *This is wrong* button.

### PR 2.1: her cats, in full inside her colonies and public outside (spec §2.2, §6.1)

- **`lib/guardianCatView.ts`, its own serialiser** built from its own list of fields (spec §2.2's table), **not** the team's cat view with a filter. It has no field for welfare entries, hidden photos, team members' names (edits show as "Syros Cats"), spotters, owners, team notes or per-sighting positions, so leaving them out doesn't depend on a filter.
- **`GET /api/team/my/colonies/:id`** (her colony: cats, with exact discovery positions) and **`GET /api/team/my/cats/:id`** (one cat), both `view_exact_location` placed, with the target **read from the record** (the colony id in the path is checked against her placements; the cat's colony comes from its observations). A cat outside her colonies, or in none, is answered with **the public view** (`serialiseCat` with the public viewer), not a refusal. Photos go through the team photo route, whose target is the photo's cat.
- The colony's feeding sites appear here once SYC-209's sites exist, filtered in the query to her colonies (spec §6.7).
- **The "moved to another colony" notice (spec §6.8, §7.4, test 16; review M3). This PR owns the reader; SYC-209 only writes the move.** `movedCatNotices(person)` reads `colony` observations: a cat whose newest active `colony` statement names a colony she does not hold, while the statement before it named one she does, appears on her colony page as *"Mimi has moved to another colony"* for **30 days** from the move, never naming which colony or whose. Marking the move wrong (the cat reverts to hers) removes the line. **Acceptance (a fixture test in this PR):** a cat moved from her colony to another shows the line on her page and not on the other guardian's page; it names neither the new colony nor its guardian; it is gone on day 31; a reverted move removes it. **Mutation probe:** include the destination colony's name in the line → red. SYC-209's plan names this reader as the one it relies on (binding hand-off below).
- **The second guardian colony page (review minor 15).** SYC-209's approved spec has its own `GET /api/team/colonies/:id` for anyone holding `view_exact_location` placed. Any placed holder who is not island-wide **must be rendered through `guardianCatView`** there too, never the team's cat view. This PR lists SYC-209's colony page as a named reader in "Every place the guard must hold", and T4's field-by-field test runs against both pages once SYC-209's exists (until then a test fails if a placed non-island holder reaches `teamCatView` from any colony route).
- **Tests.** T4: outside her colonies, every route that returns a cat gives exactly the public view, field by field; inside, exactly the fields in spec §2.2 and none of the excluded ones. **Mutation probe:** serialise through `teamCatView` → red; add a team-note field to the guardian serialiser → red. T5: a request naming her colony but a cat from another gets the other cat's public view. **Mutation probe:** trust the path's colony id for the cat → red. **Browser check** at ~390 px and desktop with a seeded colony of cats with photos.

### PR 2.2: what she says about a cat: life status and "sterilised" (spec §7.2, §10.4, Decision 5, Q3; Decision G; the news, B1)

**In plain English.** Eleni can tell the app that a cat is sterilised, homed, in care or has died, and it counts at once, with her name on it. When her word makes a cat *Confirmed sterilised*, the people who follow that cat are told once, in the app and by a push notification, never by email. If her word and the team's disagree, hers stands over the team's, but a vet's record stands over hers; if two people at the same level disagree, the newest stands. The team can always mark a word wrong. **Opus builds this PR and an Opus reviewer attacks it in its own worktree**, because it changes who can make a cat *Confirmed* and sends news that can't be unsent.

- **`writeObservation` accepts `guardian`.** `actingRole` now returns `guardian` when the capability was granted by a colony row for that cat's colony, and the team role when an island row granted it (a team member who also guards her own alley writes `staff` for a team action). **`authority_scope` = `colony:<id>`** (Decision B), fixed at the moment of the statement and **written only by the server, never read from the request**. `writeObservation` checks the pattern `^colony:[1-9][0-9]*$`, **allows it only for the role `guardian`**, and refuses it for every other role.
- **Life status** (`POST /api/team/my/cats/:id/life-status`, `set_life_status` placed): *homed*, *in care* and *deceased* only, plus putting back a status **she herself** replaced in the last 30 days. A cat she marks homed or deceased stays flagged for 30 days (*"recently marked homed by the guardian"*) on the team's view now and, once it exists, on the round sheet (PR 4.2 carries the acceptance test for that). Any later sighting revives the cat, as now. Life status follows Decision G like every other fold.
- **Sterilised, in both directions** (`POST /api/team/my/cats/:id/sterilisation`, `set_sterilisation` placed): one tap each for *she is sterilised* and *she isn't*, no "from what record?". The resolver counts a `sterilised` statement from `guardian` with a `colony:<id>` scope at level 2 (below).
- **Who wins (Decision G; built on PR 0.2's `authorityLevel`).** Vet records win over everyone. A cat guardian's statement wins over the team's. Within the same level, the newest wins (a guardian and an owner are the same level: assumption for Samuel to confirm). So: a guardian's *isn't* after a vet's *sterilised* changes nothing; a guardian's *isn't* after a team *sterilised* **does** change the answer (hers wins), and a *newer* team *sterilised* does not flip it back; the team's remedy is *This is wrong*, which supersedes her statement and leaves it in the history. The same ordering applies to life status, the ear tip and (in SYC-2's build) colour and markings. **The server sets `observedAt` on every guardian route; a client-sent `observedAt` is ignored there.**
- **A guardian's statement that contradicts a team record** still goes on the team's "recent guardian changes" list, marked *contradicts a team record*, and the team's cat page shows both with *This is wrong* on hers. The ordering is a visible disagreement, never a silent flip.
- **The news, built here (B1; Samuel, 12 Oct: in the app and by push, no email).** A shared `commitStatement(tx, input)` is the only way routes write a statement of kind `sterilised` (or supersede one); the team's own routes (`POST /team/cats/:id/sterilisation`, `POST /team/observations`, supersede), the guardian route, and later a vet's and an owner's all go through it, and a **source test fails if any route calls `writeObservation` for those kinds directly**. Inside one transaction, with the cat row locked (`SELECT … FOR UPDATE`): resolve the sterilisation answer before, write, resolve after. If the answer **became Confirmed sterilised** (it was not before, it is now) **and no `desexed` update already exists for that cat** (the owner-key route's older ones count), insert a `desexed` cat update with `insertCatUpdate` in that transaction. After the transaction commits, call `fanOutNotifications` (in-app rows and Expo push, as other cat news; it already skips a deceased cat). **No email is queued; the `cat_news` mail purpose is not used.** The transition is worked out from the resolved answers, so it fires the same way for anyone whose statement makes the cat Confirmed (team, management, vet, guardian, owner) and for a *This is wrong* that exposes an earlier *sterilised*. It fires **once per cat, ever**. The owner-key route in `routes/notifications.ts` (SYC-185 retires it) is **not** the path and is not called.
- **Marking it wrong.** On the team's cat page, a guardian's statement shows *"Confirmed by Eleni, cat guardian, 14 October"* and *This is wrong*, which writes the team's later statement through the existing supersede (hers stays in the history). A guardian can correct **her own** statements only; the supersede layer checks the author, not just the capability. The guardian sees *"Syros Cats looked again…"* on her next visit; no push, no email (Q4).
- **A guardian-changes reader** (`listGuardianChanges()`): every statement written as `guardian`, every colony a guardian created, every placement she gave herself, newest first, each flagged if it contradicts a team record. SYC-209's "Recent guardian changes" list on the Colonies page calls it, behind `view_guardian_changes` (Decision D).
- **Tests.** *Her statements.* T12a: her "sterilised" on a cat in her colony is *Confirmed*, with her id, `guardian` and `colony:<id>`; on a cat outside her colonies, or in none, it is refused; the team's later "this is wrong" supersedes it and both stay in the history. **Mutation probe:** drop the target check → red. T23: a guardian can't write `staff` by sending it; a person who is both writes the role that authorised the action; a request that sends its own `authority_scope` or `observedAt` is ignored. **Mutation probe:** honour the client's `observedAt` on a guardian route → red. T28 and T29c: only the allowed life statuses; her own undo within 30 days and not after, and not someone else's; a later sighting revives a cat she marked deceased; the 30-day flag. A guardian can't supersede the team's statement or another guardian's.
  - *Who wins (Decision G), each edge with its own probe, run through the real routes and the real resolver:* **T12g-1 vet vs guardian:** a guardian's *isn't* newer than a vet's *sterilised* leaves it Confirmed sterilised (*probe: rank the guardian equal to the vet → red*). **T12g-2 guardian vs team:** a guardian's *isn't* after a team *sterilised* wins; a newer team *sterilised* does not flip it (*probe: plain newest-wins → red*). **T12g-3 owner vs team and vet vs owner:** with a fixture owner row (*probes: owner at level 1; owner at level 3 → red*). **T12g-4 guardian vs owner and same-level newest:** newest wins both ways round; equal timestamps go to the later row (*probe: oldest wins → red*). **T12g-5 the contradiction list:** a guardian's statement against a team record appears on `listGuardianChanges()` flagged, and the team's cat page shows both (*probe: drop the flag → red*). **T12g-6 life status** follows the same order (a vet's *deceased* is not undone by a guardian's *homed*).
  - *The news (B1), named:* **T12a-1 `announces_once_on_first_confirmed`** for each of team, management, vet (fixture), guardian and owner (fixture) making the cat Confirmed. **T12a-2 `no_repeat`:** a second confirmation by someone else, and Confirmed → marked wrong → Confirmed again, add no second update and no second notification. **T12a-3 `non_transitions_silent`:** an ear tip, a field check, a guardian's *isn't sterilised*, and a guardian's *sterilised* that a vet's record overrides, announce nothing. **T12a-4 `wrong_exposes_earlier`:** marking a wrong *not sterilised* so that an earlier *sterilised* stands announces once. **T12a-5 `concurrent`:** two confirmations at the same moment make exactly one update. **T12a-6 `no_email`:** no `mail_outbox` row of any purpose is created. **T12a-7 `rolled_back_sends_nothing`:** a write that fails after the news row is inserted leaves no update and no notification. **T12a-8 `old_owner_key_update_counts`:** a cat that already has a `desexed` update from the owner-key route is not announced again. **T12a-9 `deceased_cat_skipped`.** **Mutation probes:** drop the transition check (announce on every Confirmed write) → T12a-2 red; drop the already-announced check → T12a-2's re-confirm case red; drop the row lock → T12a-5 red; send the push inside the transaction → T12a-7 red; call `writeObservation` directly from a route → the source test red.
  - **Browser check** at ~390 px and desktop, including the in-app news row for a follower of a seeded cat.

---

## Slice 3: what a guardian records

**In plain English.** Standing next to a cat, Eleni taps *I looked at her ear*, chooses *it looks clipped*, *not a clip* or *can't tell*, and can take a photo. The cat shows *Probably sterilised, checked in person* at once (never *Confirmed*, and no "sterilised" news). The photo is seen only by the team and the colony's guardians. A short "Needs a look" list shows the cats in her colonies where one look would settle it. She can read the cat-in-trouble reports about her own cats, but never who sent them. And she can ask the team to make one of her feeding sites public, which the team decides in "Needs an OK".

### PR 3.1: field checks (spec §7.2–7.3; migration `field_check_photos`, Decision C)

- **Migration (next free number):** `field_check_photos (id, public_id unique, cat_id, bytes, mime, created_by → people.id strict, created_at)`, shaped like `welfare_report_photos`. Rollback: drop it (the rollback block says this deletes the photos).
- **Upload rules (review minor 9; checked against the code).** The shared photo check already exists: `validatePhotoBase64` in `lib/imageValidation.ts` (the second caller is the cat-in-trouble report; this is the third). It checks the **type by content (magic bytes), not extension**, decodes fully, applies the EXIF rotation and then **re-encodes, which strips all metadata including GPS** (a phone photo carries the exact spot), refuses more than 20 MB in and stores at most about 5 MB, longest edge 2048 px. This PR **must call it and nothing else**, and adds a per-person rate limit (10 field-check photos per hour; Postgres-backed once SYC-105 lands, in-memory until then, as the report routes do) and `Cache-Control: private, no-store` on the serving route. A source test fails if any route stores a field-check photo without going through `validatePhotoBase64`.
- **"From someone who has since left" (spec §9.2; review M3).** The team's cat page marks a field check **"from someone who has since left"** when its author has `left_at` set. This PR owns that marker. **Acceptance (test):** a field check written by a person later marked as left shows the marker on the team's cat page and still counts as evidence; one by a current person does not. **Mutation probe:** drop the marker → red.
- **`POST /api/team/my/cats/:id/field-check`** for guardians (placed `record_field_check`, target the cat's colony) and the same form on the team's cat page (island). It writes **one `ear_tip` observation** with `seenInPerson: true`, the side if clipped, and the photo's `public_id` inside the value (never `photo_id`). *Can't tell* is kept as a note (200 characters, escaped) and writes no ear statement. No queue item.
- **The resolver.** An in-person clipped ear raises the cat to *Probably sterilised*, shown as *"checked in person"*. A guardian's in-person *not a clip* on a cat in her colony clears a wrong *Likely* at once, like the team's (spec §7.2, "both directions count at once"); her authority for that is the same `colony:<id>` scope. It never makes a cat *Confirmed* and **never announces "sterilised" news** (the news in PR 2.2 fires only on the transition to Confirmed). Precedence is Decision G's: her in-person *not a clip* counts at level 2 and so outranks a team *clipped* statement, but never a vet's.
- **The team's Probably sterilised list** treats a guardian's in-person check like the team's *Looks right*: the cat leaves the list when the newest clipped statement is in person (spec §7.5).
- **`GET /api/team/field-check-photos/:publicId`**, the only route that serves these photos: `view_exact_location` with the photo's cat as the target. A source test fails if any other file reads `field_check_photos` (the P6-0 pattern).
- **Tests.** T11: one observation, no queue item; refused for a cat outside her colonies; *can't tell* writes no ear statement; the photo is served only by its team route, and `GET /api/photos/<that id>` and every public cat response refuse it. **Mutation probe:** serve it from the public route → red. **Upload rules:** a file over the cap, a file whose bytes are not an image (extension `.jpg`), and a photo with GPS data (the stored copy has none) are each refused or cleaned; a request over the rate limit is refused. **Mutation probes:** skip `validatePhotoBase64` → red; store the original bytes (with GPS) → red. T12: *Probably* and no further; no announcement (no `desexed` update, no notification); *not a clip* clears a wrong *Likely*; a team "this is wrong" supersedes it. **Mutation probe:** make an in-person clip authoritative for `sterilised` → red (the cat becomes *Confirmed*, and the news test goes red). **Mutation probe (T12, per review M10):** announce on an ear tip → red. **Browser check** at ~390 px (a phone photo upload) and desktop.

### PR 3.2: "Needs a look" (spec §7.1; Decision E)

- **`GET /api/team/my/needs-a-look`** (`view_needs_a_look` placed; her colonies) and the team's island-wide version on the team pages. Cats at *Probably sterilised* only, never *Unknown*, worked out from the resolver when asked; nothing stored. **Grouped by colony name** until Slice 4's field page can sort by distance. No deadlines, counts or reminders, just how long each has waited, once.
- **Tests.** Only cats in her colonies; no *Unknown* cats; a cat settled by a field check leaves the list. The words "due", "assign", "overdue" never appear. **Mutation probes (review M10):** include *Unknown* cats in the query → red; read all colonies instead of hers (drop the colony filter) → red; add a "due" column or sort by waiting time with a deadline word → red. Reviewed by an Opus reviewer because it reads positions.

### PR 3.3: cat-in-trouble reports for her own cats (SYC-254; spec §6.2, Q2)

- **`GET /api/team/my/colonies/:id/welfare-reports`** (the list and each report) and **`GET /api/team/my/report-photos/:publicId`**, gated by `view_colony_welfare_reports` with **the report's cat's colony, read from the record at each request**, as the target.
- **The queries filter `kind = 'welfare'` in SQL, not in the serialiser (review M2).** SYC-44 (approved) stores "Report an issue" reports in the **same table**, `welfare_reports`, with `kind = 'content'` (the column and check already exist, `schema/welfare.ts`), and will add a photo column and may give those reports a cat tie. The list, detail and photo queries therefore say `kind = 'welfare'` themselves, so a content report can never be returned whatever its cat tie. SYC-44's plan must not weaken this (listed in "Where this collides").
- **Their own serialiser**, with no field for the reporter's contact, device or the team's note. A report tied to no cat, and every "Report an issue" report (SYC-44), has no route for her at all. Read only: no state or note route accepts her.
- **Tests.** T29b (i)–(viii): sees reports tied to cats in her colony, with photo and location; refused (403) for another colony's report, a report tied to no cat, a guessed number, **and a `kind = 'content'` report seeded with a cat tie in her own colony (list, detail and photo route all 403; review M2)**; no contact, device or team-note field in any response, checked field by field; can't change state or add a note; moving the cat out removes the report at the next request, and adding a cat adds its reports; the team-only routes still refuse her; the report is never in the saved list (checked again in Slice 4); the route walk has a row for each new route. **Mutation probes:** add `reporterContactId` to the serialiser → red; take the colony from the path instead of the report's cat → red; **remove the `kind = 'welfare'` filter → the content-report test goes red.**

### PR 3.4: asking for a site to be made public, and "Needs an OK" (spec §7.1, §7.3, §10.3; migration `confirmation_items`)

**Needs SYC-209's feeding-site pages**, because a guardian asks about a site she can see there. Approving makes a private feeding site public, the single most sensitive position in the app, so **Opus builds the decide route** and an Opus reviewer attacks it (review M10).

- **Migration (next free number; moved here from PR 0.3, review M7):** creates `confirmation_items` (spec §10.3): the kind check (`site_public_request`), the state check, `decided_by <> proposed_by`, "decided has both, open has neither", the partial unique index on (`feeding_site_id`, `proposed_by`) while `state = 'open'`, strict links to `people` and to `feeding_sites`. It is written against `feeding_sites` **as SYC-209's migrations leave it**, which is why it waits. Rollback: drop the table (the rollback block says this deletes the open requests).
- **`POST /api/team/my/sites/:id/ask-public`** (`request_site_public` placed, target the site's colony): an open `confirmation_items` row; asking again about the same site does nothing new; at most 20 open per person.
- **`GET /api/team/needs-an-ok`** and **`POST /api/team/confirmations/:id/decide`** (`settle_confirmation`, island): approve (which calls SYC-209's make-public with its usual confirmation page) or decline with a fixed reason. **The capability is checked again when the decision is written.** The first decision wins; the second sees *"Already decided by Jacky."* A site made public some other way closes the item as *no longer needed* (a hook in SYC-209's make-public). The guardian sees the outcome on her next visit; no email (Q4).
- **Tests.** T13: the database refuses an item decided by its proposer; the route refuses a decider who has lost the capability since the page was drawn. **Mutation probes (separately):** drop the `decided_by <> proposed_by` check → the database test red; drop the route's capability re-check at decision time → the route test red. T14: the first decision wins. **Mutation probe:** replace the conditional update with read-then-write → the concurrent test red. The 20-item cap and one-per-site rule hold. **Browser check** at ~390 px and desktop.

**Colony membership and creating colonies** are built in SYC-209's PRs (Decision D), using Slice 0's targets and PR 1.1's `createColonyWithPlacement`. This spec's tests **T16** and **T30** travel with those PRs as **binding hand-offs** (below), not as a comment. This plan does **not** deliver spec §15.3 tests **16** and the route half of **30**; it delivers the reader for the moved-cat line (PR 2.1) and `createColonyWithPlacement` (PR 1.1, T30 core).

### Binding hand-offs to SYC-209 and SYC-2 (review M3)

The sibling plans (`claude/syc-209-plan`, `claude/syc-2-plan`) are being written in other sessions and are **not edited here**. Their acceptance criteria are named now so the plans can cite them, and they are repeated as Linear comments on SYC-209 and SYC-2 (follow-up tickets below):

| Hand-off | Owner | Acceptance criterion |
|---|---|---|
| **T16** guardian's colony change | SYC-209's plan | A guardian's change to colony membership takes effect immediately and is recorded; is refused for a colony she doesn't hold; moves a cat out of another colony (the other guardian then sees PR 2.1's line, which SYC-209 does not build); and appears on `listGuardianChanges()` |
| **T30** (route half) | SYC-209's plan | A guardian who creates a colony holds placed powers for it only, cannot rename it, and a team member who creates a colony is not placed on it; the route calls PR 1.1's `createColonyWithPlacement` and nothing else writes `colonies.created_by` |
| Guardian colony page | SYC-209's plan | `GET /api/team/colonies/:id` renders a placed non-island holder through `guardianCatView` only; named in "Every place the guard must hold" |
| Moved-cat line | SYC-209 writes, PR 2.1 reads | SYC-209's move writes a `colony` observation (with `colonyId: null` for "take out"); it builds no notice of its own |
| Precedence | SYC-2's plan | Colour and markings use `authorityLevel` (Decision G), accept the guardian's `colony:<id>` scope (D5), and ignore a client `observedAt` on guardian routes |
| SYC-44's plan | SYC-44 | Reports of `kind = 'content'` are never returned by a guardian query (PR 3.3's filter) |

---

## Slice 4: the colony view that works with no signal (SYC-54)

**In plain English.** The evening before a round, Eleni opens her colony view with signal. Her phone keeps her colonies' cats and the exact place of every bowl. On the hillside with no signal she sees the same list, and can record field checks that are sent when she's back in signal. After 72 hours the list deletes itself the next time she opens it, and asks her to connect. Signing out, or being removed, wipes it. A team member can carry the colonies she chooses. Anyone can print a round sheet, stamped with their name and the date.

**Starts after the short SYC-54 screen spec is approved (Decision F).** The rules below are fixed by the roles spec §12 and don't wait for it.

### PR 4.1: the field pages' own narrow script rule (spec §3, §12.2)

- A separate set of pages under **`/api/team/field/`**. Only these responses relax the dashboard's no-scripts rule: scripts allowed **only by fixed hash**, nothing inline, `connect-src 'self'`, `worker-src 'self'`. **`no-store` stays on every response.** The service worker is registered with scope `/api/team/field/` only, so it can never serve an old staff page after sign-out.
- `Clear-Site-Data: "cache", "storage"` on sign-out, on *sign out everywhere* reaching the phone, and on any field request refused because the person is gone or no longer holds the placement. **Sign-out itself is `/api/team/signout`, outside the field path, so the header is sent from that route directly** and not left to the field-page rule (review M6).
- **Tests (T26, headers half).** Every other dashboard response still has `default-src 'none'` and no script source. **Mutation probe:** apply the field rule to `/api/team/` → red. The service worker's scope is the field path. Every response keeps `no-store`.
- **`Clear-Site-Data` (named tests; review M6; spec test 26 and §12.2).** **T26-csd-1 `signout_clears_site_data`:** `POST /api/team/signout` carries `Clear-Site-Data: "cache", "storage"`. **T26-csd-2 `removed_person_clears`:** a field request from a person who has been marked as left carries it and is refused. **T26-csd-3 `lost_placement_clears`:** a field request from a guardian whose placement ended carries it and is refused. **T26-csd-4 `absent_on_normal_load`:** an ordinary page load and an ordinary successful field request do not carry it. **Mutation probes:** remove the header from the sign-out handler → csd-1 red; remove it from the refused-field path → csd-2 and csd-3 red; send it on every response → csd-4 red.

### PR 4.2: the saved list and the round sheet (spec §12.1–12.2; Decision 12)

- **`GET /api/team/field/list`** (`view_colony_targets` placed): for each of her colonies (for a team member, the colonies she picks), exactly spec §12.1's fields: cat name and SYR number, sterilisation answer and how sure, last seen, life status (with the 30-day flag), discovery position, usual feeding site, a thumbnail, and each site's name, **exact position** and optional "how to find it" line (SYC-263). Never per-sighting positions, welfare reports, reporters, hidden photos, health notes, other colonies or team names. Stamped with the server's time and the expiry.
- The page saves it in its own storage. **On every open, before drawing anything, an expired list (72 hours by server time, or a phone clock that has gone backwards) is deleted, not hidden**, and the page says *"Connect to refresh this list."* An online load re-checks the person; a refusal deletes the list at once.
- **Sorted by distance** when the person agrees to share her position (Decision E); the position is sent in a **POST body, never a query string** (review minor 12), and the server sorts and neither stores nor logs it (the request logger redacts it).
- **The round sheet**: a printable page stamped with her name and the date and *"These are exact places. Please don't share them."* It carries the **30-day "recently marked homed/deceased" flag** (spec §7.2, test 29c; review M3): **acceptance test:** a cat she marked deceased 10 days ago is on the sheet, flagged, and is gone from the sheet and the flag on day 31; one marked by someone else is flagged the same way. **Mutation probe:** drop the flag, or keep the cat past day 30 → red.
- The JSON responses are added to the OpenAPI file and the generated clients (spec §15.1).
- **Tests (T26, the rest).** **The 72-hour boundary by server time: kept at 71 h 59 min, deleted at 72 h 01 min.** Deleted on open after 72 hours; a backwards clock counts as expired; the server's refusal deletes it; only her colonies, with exact site positions, and none of the excluded fields (T29b vii). **Mutation probes:** hide instead of delete → red; trust the phone's clock → red. **Browser check** at ~390 px and desktop, including offline mode in the browser's developer tools, and a printed round sheet.

### PR 4.3: field checks made with no signal (spec §12.3)

- Up to 20 waiting, each with its photo, kept only until sent; sent under her signed-in session when she's back in signal; refused if the session or the person is gone (spec §9.2); a date more than 30 days back or in the future is refused.
- **Tests.** T28 (offline dates); a queued check from a person marked as left is refused when it arrives. **Browser check** offline then online, at ~390 px.

---

## Slice 5: the small things

**In plain English.** Management sees a gentle banner if someone prints or refreshes far more round sheets in a day than a colony needs: a prompt to ask a question, not a block. And once the "Matched by hand" list exists for the team, guardians can check the hand-picks in their own colonies.

- **PR 5.1: round-sheet counts and the banner (SYC-253; spec §11.3).** A small table counting, per person per day, round-sheet prints and downloads and saved-list refreshes, with no cat ids in it. A banner on the People screen above five a day. **Tests:** the counts, the threshold, and that the table has no cat column. **Mutation probes (review M10):** add a `cat_id` column to the table → the shape test red; move the threshold to 50 → the threshold test red; show the banner to a team-only member → red. Banner visibility is `manage_people`, so an Opus reviewer checks it.
- **PR 5.2: hand-pick review for guardians (spec §6.2 `review_hand_picks`).** Waits for SYC-152's "Matched by hand" list. Her colonies only, positions at the 250 m level only. Planned in detail when SYC-152 is.

**Not in this plan:** forgetting a former guardian or team member who joined (SYC-208, and SYC-256's button). SYC-208's own plan must reach `colonies.guardian_name`, colony names and name history, and field-check notes (spec §9.6–9.7). **Anonymising a never-accepted invitee on withdrawal is built in PR 1.1** (review M9), so it is no longer SYC-208's; SYC-208 reuses the placeholder. It is management only (`manage_people`).

---

## Slice 6: owners confirm sterilisation (after SYC-130)

**In plain English.** A resident who has said in the app that a cat lives with her can say it has been sterilised, and it counts as *Confirmed*, with her as the source.

- **Gated on SYC-130.** Its spec (PR #107) defines what a claim is, and so who counts as an owner. This slice is planned when SYC-130's plan is approved. What it adds is small: the resolver counts a `sterilised` statement with `authority_scope = owner_of_this_cat` as authoritative for that cat (spec §7.2, §10.4), written from the public app by the owner's device under SYC-130's claim. No dashboard door for owners (spec §7.2).
- **Tests (then):** an owner's statement confirms only her own cat; anyone else's is refused; the team can mark it wrong.

---

## Where each of the spec's tests is built

Spec §15.3 names the tests that must exist. Each is built in exactly one place (some in two halves).

| Spec test | PR | | Spec test | PR |
|---|---|---|---|---|
| 1 route walk | 0.5 (each later PR adds its routes' rows) | | 16 guardian colony change | **SYC-209's PRs, as a binding hand-off** (the reader for the moved-cat line is PR 2.1) |
| 2 403, not sign-in | 0.5 | | 17 guardian with no colony refused | 0.3 |
| 3 guardian can't reach island pages | 0.3 (database), 0.5 (routes) | | 18 last manager | 1.1 |
| 4 guardian's view, field by field | 2.1 | | 19 leaving withdraws invitations | 1.1 |
| 5 target from the record | 0.5 (photos), 2.1 (cats) | | 20 withdrawing never deletes | 1.1 |
| 6 placement expiry | 0.5 | | 21 one event per operation | 0.1, extended in 1.1 |
| 7 old shape refuses a guardian | 0.4 | | 22 invitation mail | 1.1 |
| 8 doors | 0.4, completed in 1.1 | | 23 `roleAtTime` from the server | 0.2, 2.2 |
| 9 pending invitee reaches only the accept page | 0.3 (finders), 1.1 | | 24 catalogue equals §6.2 | 0.5 |
| 10 accept is one conditional update | 1.1 | | 25 key parity, Greek local part | 1.0 |
| 11 a field check writes one observation | 3.1 | | 26 the saved list, `Clear-Site-Data` (T26-csd-1 to 4) | 4.1, 4.2 |
| 12 field check: *Probably*, no news | 3.1 | | 27 workspace refused | 0.4, 0.5 |
| 12a guardian's "sterilised", and the one-time news (T12a-1 to T12a-9) | 2.2 | | 28 life-status limits, offline dates | 2.2, 4.3 |
| 12g who wins: vet, guardian and owner, team (T12g-1 to T12g-6) | 0.2 (function), 2.2 (routes) | | | |
| 13 proposer can't decide | 3.4 | | 29 migration stops and lists | 0.3 |
| 14 first decision wins | 3.4 | | 29a exactly three managers | 0.3 (a seeded-database test of `people-set-roles` plus a production probe; not a test of the migration) |
| 15 management only, one manager enough | 0.5, 1.1, 1.2 | | 29b guardian's welfare reports (incl. the `kind = 'content'` row) | 3.3 (vii checked again in 4.2) |
| | | | 29c guardian marks a cat died, and the 30-day round-sheet flag | 2.2 (statement and team-view flag), 4.2 (round-sheet flag) |
| | | | 29d three promises **and** the lock and never-reopened-phone text | 1.1 |
| | | | 30 guardian creates a colony | 1.1 (core), SYC-209's PRs (routes; binding hand-off) |
| | | | Moved-cat line (spec test 16, reader half) | 2.1 |
| | | | "From someone who has since left" marker | 3.1 |

API tests use supertest against the real app and CI's Postgres, as the SYC-43 parts did; `lib/db` tests use the throwaway database built from the real migrations. Every **mutation probe** is done once by hand before merge: break the line, watch the named test go red, put it back, and say so in the PR. For anything under `manage_people`, the resolver or an exposure of positions, **the probes are run by an Opus reviewer in its own worktree**, not only by the builder.

---

## Every place the guard must hold

A permission check that silently lets too much through leaves every test green. So, as the photo-hiding work did, this plan lists **every reader** of the two things that must never leak, and the route walk (T1) is the structural backstop: a new route that isn't in its table fails the build.

**"Who is on the list, and what may they do"** is read in exactly these places, all of which go through `findPersonById`, `findAllowedPerson`, `findInvitee` and `can()`/`canSomewhere()`:
1. the hand-off (`routes/team.ts`), which now also issues pending sessions (1.1) and replaces them on accept;
2. `requireTeam`, on every dashboard request, and `requireInvitee` (1.1);
3. the Worker's question (`routes/internal.ts`), both request shapes (0.4), which also asks `findInvitee` to answer a pending invitee (1.1);
4. the Worker itself, which trusts the doors (W1);
5. the invitation and access-change mail recipients (1.1), which look people up by id **and re-check pending, unexpired and not anonymised at delivery time in the outbox drain**;
6. the `people` command and db-ops (0.3);
7. the saved list's re-check on every online load (4.2).

**"Exact positions, and private things, reach only the people placed on them"** is served in exactly these places:
1. the team's island pages: the queue, report list, cat list and cat page (island-only from 0.5);
2. the catalogue photo route and the report photo route (0.5);
3. a guardian's colony and cat pages (2.1), her field-check photos (3.1), her colony's welfare reports and their photos (3.3), "Needs a look" (3.2);
4. SYC-209's feeding-site and colony pages, **including `GET /api/team/colonies/:id`, which must render a placed non-island holder through `guardianCatView`** (their own PRs, using 0.5's targets and filtering sites in the query);
5. the saved list and the round sheet (4.2);
6. the JSON responses added to the OpenAPI file for the field pages (4.2).
Nothing in the public app changes. Push notifications, emails and the public catalogue carry no exact position and no field-check photo; PR 3.1's source test enforces the photo half.

---

## Rollout

For each PR, in order, after its own review:
1. **Merge** once CI is green (`migrate:check`, the migration tests, the API tests).
2. **PRs with a migration (0.1, 0.3, 3.1, 3.4):** db-ops `migrate` on development; a Neon snapshot of production (**Samuel switches the session to "ask" mode for this step**); db-ops `migrate` on production, then `verify`. **Migrate before publish**: each migration is additive and the running app ignores what it adds. Claude runs every production migration through db-ops; none is handed to Samuel. 0.3 has the extra steps in its section (Samuel approves the management list; `people-set-roles` after the migration).
3. **Publish.** Samuel pulls into the EU Replit project and publishes. Claude waits until `/api/healthz` shows the new commit (the EU deploy can sit in "promoting"), then runs db-ops `smoke`.
4. **Probe (Claude).** Every new route without a session → 401; with a test guardian session on development → what the route-walk table says. After 1.1: an invitation to a test address Claude controls on development shows "Not sent yet" when mail is off and "Invited" once delivered. After 3.1: a field-check photo's public URL → 404. After 4.1: the field pages' headers, and a non-field page still has no script source.
5. **W1** is deployed by Claude with wrangler after 0.4 is live in production, with the previous Worker version recorded first and rolled back on any failed probe (see W1). **0.5 publishes only after W1 is live** and the three management rows exist.
6. **Progress notification (review minor 17).** After each PR merges and is verified live, **Claude sends Samuel a short progress note** (what shipped, what is next, anything waiting on him) before starting the next PR. A final note at the end of each slice.
7. **First real use.** After Slice 1: Samuel invites one team member as the acceptance test. After SYC-209's colony PR and Slice 2: the first guardian, chosen by Samuel, ideally with Susan making the call so the invitation is read aloud on the phone first.

**Up/down/up.** Every migration's commented rollback is proved by the runner's harness in CI (`pnpm --filter @workspace/db test`): up, down, up again, schema identical. **Rolling back in production:** app first, then the database, or not at all (`lib/db/migrations/README.md`). Rolling back 0.1 deletes the history, 3.1 deletes field-check photos and 3.4 deletes open requests; the rollback blocks say so, and the snapshot is taken first. **After `people-set-roles` has run in production, rolling back 0.3 is not offered: the production path is fix-forward** (its block refuses and lists the rows that would be lost). CI proves up, down, up on an empty database **and** on a seeded one (PR 0.3).

---

## Where this collides with other work

| Other work | Where it meets this plan | What this plan does |
|---|---|---|
| **#102** (the spec; merged) | Everything | The plan's PRs build it, as amended by D4 and D6 |
| **#103 SYC-209 spec** (approved, merged) | Colony and feeding-site routes; the Recent guardian changes list; site-public requests | Decision D: SYC-209 owns those screens. This plan delivers the capabilities (0.5), the targets (0.5), `createColonyWithPlacement` (1.1) and `listGuardianChanges` (2.2). SYC-209's plan is written next, against Slice 0, and carries T16 and T30 and the guardian-colony-page rule as acceptance criteria (see "Binding hand-offs"). Its `created_by` wording is aligned by D5 |
| **#104 SYC-2 spec** (approved, merged) | `set_appearance`, `set_vaccination`, `view_health_notes`, `add_health_note`; guardian authority for colour, written there as `guardian_of_this_cat` | D5 aligns it to `colony:<id>`. In the catalogue from 0.5. SYC-2's build adds the resolver authority for colour through `authorityLevel` (Decision G) and its own screens, citing this plan |
| **#107 SYC-130 spec** | What an owner is; it edits the same three docs as D1–D3 | Slice 6 waits for it. Docs PRs rebase whichever merges second |
| **#111 SYC-44 spec** (approved 12 Oct, on its branch) | "Report an issue" reports are stored in `welfare_reports` with `kind = 'content'` | PR 3.3's guardian queries filter `kind = 'welfare'` **in SQL**, with a seeded content row that must be refused. SYC-44's plan must not weaken this. When SYC-44 is built, its reports stay behind `view_welfare_queue`, and the route walk catches any new route |
| **#115 SYC-14, #109 SYC-274** | None (app and campaign code) | Nothing |
| **Worktrees `syc-14-sixty`, `syc-nudge-kept-safe`, `mvp-progress-check`** | None of the files this plan touches | Not touched |
| **SYC-26 Google sign-in** (a plan, `claude/syc-26-plan` at `d63b704`, in the Worker repository; no code yet; checked) | The Worker's `admin/src/index.js`; its shared decision function; its note "no Worker change" for roles | W1 goes first; SYC-26's decision function must carry `doors` (comment filed on SYC-26) |
| **SYC-185** (retire the owner-key route) | `routes/notifications.ts` writes `"staff"` | Left alone (0.2); retires with SYC-185 |

---

## What this plan does not do

| Not here | Where it goes |
|---|---|
| Colony and feeding-site screens, creating colonies, moving cats between colonies, the Recent guardian changes page | SYC-209 (Decision D) |
| Colour, markings and health screens | SYC-2 |
| Forgetting a former guardian or team member who joined (anonymising a never-accepted invitee is **built here**, PR 1.1) | SYC-208, SYC-256 |
| HTML-formatted emails | SYC-278 |
| Guardians requesting paid sterilisation (€50–60 per cat) in the app | SYC-284 (by phone or WhatsApp for now) |
| A dashboard upload of a guardian's own sighting, and `match_cat_anywhere` | A follow-up, if Syros Cats want it (spec §6.2 note 3) |
| A better "usual spot" for each cat | SYC-80 |
| Vets | SYC-24 (parked) |
| Google sign-in | SYC-26 |
| The team's "delete this person's details" action (`action_deletion_request`) | With SYC-63's staff action; the capability exists from 0.5, management only |

## What works with no signal

Precisely: **only Slice 4's field pages.** Every other dashboard page, including everything in Slices 0 to 3, is drawn by the server when opened and needs signal; a button tapped with no signal fails with the browser's own "no connection" page and nothing is recorded. The field pages show the last saved list for up to 72 hours and queue up to 20 field checks; their live map does not work offline (spec §12.1). The public app is unchanged.

---

## Model delegation

Session model for this plan: **Opus 5.5**, chosen by the brief because a wrong slice order or a missed route here is a permission hole across several PRs. For the build, each package goes to the cheapest tier that can do it safely; every step up is justified on its row. **No package uses Fable**: the design decisions are already made in the approved spec and this plan, and what remains is careful implementation and review, which Opus covers.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| D1–D6 docs PRs | Sonnet | Transcribing approved text from spec §17 and this plan's decisions (D5 and D6 amend approved specs, so the session model reads them against Samuel's 12 October answers word by word) | Session model checks each line against §17, Samuel's answers and the canonical facts in `CLAUDE.md`; D6 is also read by the Opus reviewer of PR 0.2 before it merges |
| 0.1 `person_events` migration, backfill, events in `people.ts` | Sonnet | Clear spec (SYC-213), follows the `observations` trigger pattern | T21 with a **mutation probe on every insert**; up/down/up; session model reads the SQL line by line |
| 0.2 one list of roles, `actingRole`, vocabulary, `authorityLevel` (Decision G) | **Opus** | *Escalated (review M10):* it changes who the resolver treats as authoritative (`admin` to `management`, the precedence order) and introduces `actingRole`, which decides the role written on every statement; a slip silently de-authorises management or lets a role in | T23 and the precedence edges (vet vs guardian, vet vs owner, guardian vs team, owner vs team, guardian vs owner, same-level newest, stray `colony:` scope), each with its own **mutation probe**; source test; the production `admin` count probe done **before** merge; **Opus adversarial review in its own worktree** that re-runs the probes by hand |
| 0.3 the roles migration and the `people` command | **Opus** | *Escalated:* production data, list-and-stop logic, and the checks that make "guardian is never island-wide" true in the database | T17, T29, T9 with **mutation probe**; up/down/up; run against a copy of the production shape on development first; Opus adversarial review |
| 0.4 two doors (API) | **Opus** | *Escalated:* the one change that could hand a guardian the document password through the old Worker | T7 with **mutation probe**; §14 case 13 identical answers; Opus adversarial review |
| W1 the Worker | **Opus** | *Escalated:* a security boundary in another repository, with a fail-safe deploy order | That repo's tests with **mutation probe**; wrangler deploy and live probe of both kinds of person |
| 0.5 catalogue, strict `can()`, targets, 403, route walk | **Opus** | *Escalated:* the permission core. A silent over-grant here shows a guardian the whole island with every test green | T1, T2, T5, T6, T24 each with **mutation probes**; the "every place the guard must hold" list above handed to the reviewer, who is told to hunt for readers not on it; Opus adversarial review in its own worktree |
| 1.0 string catalogue and parity test | Sonnet | Follows the app's i18n shape | T25 with **mutation probe** |
| 1.0 Greek and French drafts | Sonnet | Language quality matters more than for boilerplate | Johnny's review (SYC-283) before any language is switched on |
| 1.1 invitations, accept, leave, mail purposes | **Opus** | *Escalated:* pending-state security (a pending person must never be a capability holder), conditional updates, the last-manager race, and a mail function that must not be usable to email a stranger | T8–T10, T15, T18–T22, T29d, T30 core, with **mutation probes** on T9, T10, T18, T22, T30; Opus adversarial review |
| 1.2 the People screen | Sonnet builds the markup; **Opus** reviews | Forms over 1.1's reviewed functions. *Escalated review (review M10):* this is the only place access is granted and removed, so `manage_people` gating, the Origin check, self-change refusal and "no free text reaches an email" get a full adversarial review, not a spot review | T15 screen half; chip-state test; a mutation probe per gate (drop `manage_people` from one route → that 403 test red; drop Origin → red; allow self-change → red); browser check at ~390 px and desktop; **Opus adversarial review** |
| 1.3 "My page" and "My colonies" | Sonnet | Simple pages over existing functions | Tests listed; browser check |
| 2.1 guardian serialiser and pages | **Opus** for the serialiser and targets; Sonnet for page markup | *Escalated (serialiser):* a leaked field is silent | T4, T5 with **mutation probes**; browser check; Opus review of the serialiser |
| 2.2 guardian statements, resolver precedence and the one-time news | **Opus** | *Escalated:* a resolver change that makes cats *Confirmed* and sends news that can't be unsent | T12a-1 to 9, T12g-1 to 6, T23, T28, T29c with **mutation probes**; **Opus adversarial review** in its own worktree, which re-runs the precedence and news probes by hand |
| 3.1 field checks and private photos | **Opus** for the photo store, route and resolver change; Sonnet for the forms | *Escalated (photos, resolver):* a public leak of a private photo, or a field check that confirms, is silent | T11, T12 with **mutation probes**; the source test that only one route reads `field_check_photos` |
| 3.2 "Needs a look" | Sonnet | A read over the resolver | Tests listed; mutation probes (include *Unknown* cats → red; drop the colony filter → red); **Opus reviewer** (it reads positions) |
| 3.3 guardians' welfare reports | **Opus** | *Escalated:* reporters' photos and locations; a leaked contact field is silent | T29b all parts with **mutation probes**; Opus adversarial review |
| 3.4 site-public requests and "Needs an OK" (migration `confirmation_items`) | **Opus** for the decide route and migration; Sonnet for the page markup | *Escalated (review M10):* approving makes a private feeding site public, the single most sensitive position in the app; the capability re-check at decision time and the first-decision-wins update are the safety | T13 and T14 with the separate **mutation probes** named in the PR; browser check; **Opus adversarial review** |
| 4.1–4.3 field pages, saved list, offline queue | **Opus** | *Escalated:* the only scripts on the dashboard, a service worker, and exact positions on phones | T26 with **mutation probes**; offline browser checks at ~390 px; Opus adversarial review |
| 5.1 counters and banner | Haiku | Mechanical: one table, one query, one banner | Tests listed; the three named mutation probes (cat column, threshold, banner visibility); session model reviews the diff; Opus reviewer for the `manage_people` gate on the banner |
| HTML row markup and seeded fixtures across slices | Haiku | Boilerplate against a fixed shape | Typecheck plus the PR's own tests; session model reviews the diff |
| Adversarial review of each PR | **Opus for anything touching `manage_people`, the resolver or any exposure of positions** (0.2, 0.3, 0.4, W1, 0.5, 1.1, 1.2, 2.1, 2.2, 3.1 to 3.4, 4.x, 5.1's banner); otherwise the builder's tier. **Each in its own worktree, never shared** | A reviewer proving a test can fail mutates the tree, so two reviewers can't share one; a Sonnet reviewer is not adequate for the permission core | Findings folded in and listed in each PR; the session model checks each against the code |
| Production steps: migrations, snapshots, `people-set-roles`, wrangler (with the recorded rollback version), probes, the read-only colony count | Session model | Production data and credentials; not delegated | Rollout step 4's probes |

## Crash-proofing for the build

Every PR is built in its own worktree off fresh `origin/main`, never the primary checkout. **Commit after each item**, and keep a `CHECKPOINT.md` in the worktree root (what's done, what's next), updated after each commit, so any session can resume from the last commit. Every agent prompt restates "commit after each item" word for word. Agents don't spawn nested agents. A progress note goes to Samuel at each merged PR.

---

## Linear

**Each PR closes or advances:**

| PR | Closes | Advances |
|---|---|---|
| D1–D6 | | SYC-53 |
| 0.1 | **SYC-213** | SYC-53 |
| 0.2 | **SYC-252** | SYC-53 |
| 0.3 | | SYC-53, SYC-104 |
| 0.4 + W1 + 0.5 | **SYC-222** | SYC-53 |
| 1.0 | **SYC-251** | SYC-283 (strings ready for Johnny) |
| 1.1 | | SYC-53, SYC-104 |
| 1.2 | **SYC-104** | SYC-53 |
| 1.3 | | SYC-53 |
| 2.1, 2.2 | | SYC-53 |
| 3.1–3.4 | **SYC-254** (3.3) | SYC-53, SYC-209 |
| 4.1–4.3 | **SYC-54**, **SYC-257** | SYC-53, SYC-263 |
| 5.1 | **SYC-253** | SYC-53 |
| 5.2 | | SYC-53 (waits for SYC-152) |
| 6.1 | **SYC-53** (the last piece) | SYC-130 |

SYC-53 itself closes when Slice 6 merges, or earlier if Samuel prefers to close it after Slice 5 and track owners under SYC-130.

**Follow-up tickets to file (not filed by this plan):**
0. **Comments with binding acceptance criteria (review M3).** On SYC-209: T16, T30 (route half), the guardian-colony-page rule (`guardianCatView`), the moved-cat line is PR 2.1's reader, `colonies.created_by` written only by `createColonyWithPlacement`. On SYC-2: colour and markings use `authorityLevel` and the `colony:<id>` scope (D5). On SYC-44: reports of `kind = 'content'` must never be returned by a guardian query. On SYC-26: its decision function must carry `doors`; a Google sign-in for a dashboard-only person sets no workspace cookie.
1. **SYC-54: a short screen spec for the saved colony view and round sheet**, before Slice 4 (Decision F). Also: rename the ticket away from "volunteer", and drop "reuse the existing offline queue" (the app's queue is ruled out by spec §3).
2. **The sign-in Worker: two doors and a dashboard-only path** (W1), in `catspotters-website`, linked to SYC-222.
3. **The sign-in email in Greek and French** in the Worker, switched on after Johnny signs off (SYC-283).
4. **Switch on Greek and French on the dashboard** (`LIVE_LANGUAGES`), after SYC-283.
5. **SYC-208 must also reach** `field_check_photos`' notes, and reuse PR 1.1's placeholder for anonymising (a comment on SYC-208; anonymising a never-accepted invitee on withdrawal is now built in PR 1.1, not deferred).
6. **SYC-209's plan must use this plan's Slice 0** (targets, `createColonyWithPlacement`, `listGuardianChanges`) and name tests T16 and T30 (a comment on SYC-209).
7. **SYC-2's plan: guardian authority for colour and markings in the resolver** (a comment on SYC-2).
8. **Retire db-ops `people-remove`** in the runbook and docs once 0.1 removes it (folded into 0.1 if small).
9. **"Needs a look" sorted by distance on the field page** (Decision E), if it doesn't fit in 4.2.
10. **A dashboard upload of a guardian's own sighting**, to make `match_cat_anywhere` real (spec §16.4; may already be filed from the spec).
11. **`db-ops colonies-count`** (and a generic read-only count), so Claude can re-run the Decision D production check without the Neon SQL tool.
12. **Retire the owner-key route's `desexed` path** (SYC-185 already covers the route; add that PR 2.2's once-per-cat check counts its older updates as already announced).
13. **SYC-130 (#107): confirm that an owner's statement ranks with a guardian's (level 2) and that claims are verified enough for an owner to outrank the team** (Decision G assumption 1).
14. **A one-line Linear reminder to switch Greek and French on** is already item 4; add that the People screen's "will be sent in English" label disappears with it.

---

## Still needs Samuel

Small points only; nothing blocks Slice 0 except the first.

1. **Approve the list of who becomes management** before PR 0.3's production run (Decision A). Claude shows it from the live database; production holds 3 people today. *Recommendation: approve.*
2. **Switch the session to "ask" mode** for the Neon snapshot step before each production migration (0.1, 0.3, 3.1, 3.4). Auto mode blocks Neon snapshot writes.
3. **Confirm the Decision G assumptions** (listed under Decision G): a cat guardian and an owner sit at the same level, newest wins (*recommend: yes*); imported records and management rank with the team (*recommend: yes*); and the "sterilised" news goes **once per cat, ever**, even if a Confirmed answer is marked wrong and later confirmed again (*recommend: yes, once*). Also, an owner's word outranks the team's, so SYC-130's claim should be checked before an owner's statement can be written (*recommend: keep owners out of the writes until SYC-130 says how a claim is checked; Slice 6 already waits for it*).
4. **Anonymise on withdrawal** now happens in PR 1.1 for anyone who never accepted, **including someone who taps "No, this isn't for me"**: their name and address are replaced by a placeholder and the row is kept. *Recommendation: yes; it is what the spec promised.* The alternative is to keep a declined person's real address, which keeps a stranger's address on file.
5. **Dashboard-only sign-in** now goes straight to the dashboard (the spec's wording); the extra "Open my colonies" page is dropped. *Recommendation: yes.*
6. **Johnny's date (SYC-283):** 30 October 2026, as before.
7. **The SYC-54 screen spec** before Slice 4 (Decision F). *Recommendation: yes.*

## Review outcome

Every finding in `syc-53-roles-and-invites-review.md`, and where this plan handles it. "Settled" means Samuel decided on 12 October 2026.

| Finding | Handled in |
|---|---|
| **B1** "sterilised" news mechanism does not exist | Settled: in the app and by push, no email, once per cat, anyone whose statement makes it Confirmed. PR 2.2 (`commitStatement`, `announceSterilised` logic, tests T12a-1 to 9 with named probes); gap C10; D4 corrects the spec; the owner-key route is explicitly not the path |
| **M1** guardian can overwrite vet or team | Settled: Decision G (vet > cat guardian and owner > team, newest at the same level). PR 0.2 (`authorityLevel`, edge tests and probes), PR 2.2 (routes, T12g-1 to 6, client `observedAt` ignored, contradictions on the guardian-changes list), D6; `guardian` kept out of the shared role set |
| **M2** "Report an issue" reports (`kind = 'content'`) | PR 3.3: `kind = 'welfare'` in SQL, seeded content row test, probe; "Where this collides" (SYC-44) |
| **M3** orphaned spec items | Moved-cat reader: PR 2.1 (acceptance test). "From someone who has since left": PR 3.1. 30-day round-sheet flag: PR 4.2 acceptance test (and PR 2.2 for the team's view). T16 and T30: "Binding hand-offs to SYC-209 and SYC-2" table plus Linear comments; spec tests this plan does not deliver are named |
| **M4** Decision B vs merged SYC-2 spec | Decision B verdict (strict pattern, server-written, guardian only); docs PR D5; header and collision table refreshed (#102 to #104 merged) |
| **M5** accept page leaves out required text | PR 1.1: "what you'll be able to see and do", lock request, never-reopened-phone sentence; T29d now pins three promises and the extra text |
| **M6** `Clear-Site-Data` untested | PR 4.1: T26-csd-1 to 4 with probes; header sent from `/api/team/signout` directly; PR 4.2: 71 h 59 min / 72 h 01 min boundary |
| **M7** unrecoverable rollback; `confirmation_items` timing | PR 0.3: rollback block (refuse and list in production, delete with count in CI), fix-forward statement, seeded-database rollback test; `confirmation_items` moved to PR 3.4's migration; four migrations |
| **M8** W1 under-specified | W1 section: recorded rollback version and probes; identity handled in one request, no stored state; fail closed when `doors` is missing; SYC-26 worktree read (plan only, shared decision function, "no Worker change" now out of date); follows the spec ("straight to the dashboard"), the extra page dropped as a flagged deviation |
| **M9** wrong-mailbox mitigation deferred; drain-time check | PR 1.1: anonymise on withdrawal or decline for never-accepted people; drain-time re-check (pending, unexpired, not anonymised, address matches); drain change in scope; tests and probes; "Not in this plan" updated |
| **M10** tiers, assurance, probes | Model delegation: 0.2, 3.4 (decide route) to Opus; 1.2 builds in Sonnet with a full Opus adversarial review and per-gate probes; Opus reviewers for `manage_people`, the resolver and positions; specific probes written for T6, T13, T14, T17 (PR 0.3: drop the `reach` check), T27, 3.2, 5.1 and T12 |
| Minor 1 JSON routes answer 401 | PR 0.5: JSON 403 row; T2 probe |
| Minor 2 all placements ended | PR 0.5: "Your access has ended" 403 page; eighth kind of person in T1 |
| Minor 3 Athens midnight | T6 (25 October 2026 test, three probes); PR 1.2 date field and test |
| Minor 4 `people-set-roles` replaces | PR 0.3: additive by default, before and after printed, refuses no island role |
| Minor 5 `people add --role management` | PR 0.3: `add` refuses management; `set-roles --add` only |
| Minor 6 `findInvitee` usage | PR 1.1 and the "places the list is read" inventory |
| Minor 7 pending session after accept | PR 1.1: cookie replaced on accept; old pending cookie test and probe |
| Minor 8 `access_change_notice` scope | PR 1.1: every access change, guardians included; T15 and T19 extended |
| Minor 9 photo upload rules | PR 3.1: shared `validatePhotoBase64` (type by content, EXIF and GPS stripped by re-encode, size caps), rate limit, `private, no-store`, source test, probes |
| Minor 10 Greek guardians get English | PR 1.1 records the language used; PR 1.2 shows "will be sent in English" |
| Minor 11 `removePerson` and test harness | PR 0.1: TRUNCATE-guard step for every test that creates people |
| Minor 12 distance sort position | Decision E verdict; PR 4.2: POST body |
| Minor 13 T24 parser | PR 0.5: pinned table shape, row-naming failure, SYC-209 and SYC-2 specs parsed |
| Minor 14 plan text slips | Route count 23 + 2; C7; header and collisions; migration list in rollout |
| Minor 15 two guardian colony pages | PR 2.1; "Every place the guard must hold"; hand-off table |
| Minor 16 check production before declaring Decision D | Decision D: read-only count run on 12 October 2026 (0 colonies, 0 sites, 0 guardian rows, 3 people) and how to re-check; PR 1.2 disables guardian invitations while none exist |
| Minor 17 progress notification | Rollout step 6 |
| **Decisions A to F** | Each carries the review's verdict and conditions in "Decisions for Samuel" |
| Missing Decision G | Added and settled |
| Order and safety between PRs | Reviewer's check upheld; D5 and D6 added before 0.2 and 2.2 |
