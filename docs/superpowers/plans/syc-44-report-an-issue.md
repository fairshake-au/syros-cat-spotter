# SYC-44 and SYC-170: "Report an issue" on every cat and photo, and Turnstile on both public report forms (implementation plan)

**Linear:** SYC-44 (Report an issue) and SYC-170 (Turnstile), with SYC-105 (shared rate limits), SYC-279 (a new photo address on hide), SYC-246 (removal), SYC-247 (home text), SYC-113/SYC-114 (the pre-launch pass), SYC-130 (the home description), SYC-150, SYC-229, SYC-231, SYC-232 and SYC-248. **Status:** draft for Samuel's approval. Nothing here is built, published or configured.
**Design (approved, not reopened here):** `docs/specs/report-an-issue.md` v1.2, approved by Samuel on 12 October 2026 (PR #111), decisions D1–D14 and the smaller calls · its review `docs/specs/reviews/report-an-issue-review.md` · `team-access-and-welfare-queue.md` (owns the queue) · `DECISIONS.md` (wins; Part 2b) · `roles-and-invites.md` §6.2 (owns the capability names) · `hosting-and-photo-storage.md` §6.5 (the removal contract) · `cat-record-data-spine.md` · the SYC-43 part 2 plan (PR 6: `photo_visibility_events` and `publicPhotoUrl()`, on `main` as migration 0014).
**Checked against:** `origin/main` at `f3c9c00` (13 October 2026); open PRs #118 (SYC-209 plan) and #101 (SYC-166); the in-flight SYC-53 branches (PR 0.1 `person_events` as migration 0016, PR 0.2 `authorityLevel`), the SYC-130 build branch and the SYC-2 PR 1.2 branch; Linear SYC-44 (all six comments), SYC-170, SYC-105, SYC-113, SYC-114, SYC-130 (comments), SYC-150, SYC-185, SYC-229, SYC-231, SYC-232, SYC-246, SYC-247, SYC-248 and SYC-279. Every "exists today" claim below names the file it was read in.

---

## In plain English

**What a person on Syros sees, when it's all built.** Under "This cat needs help" on every cat's page there's a quiet **Report an issue** link. Tapping any photo opens it full screen, with **Report an issue with this photo** underneath. The person picks a reason in plain words ("It shows a person or a private place", "That's a different cat", "The name is wrong, or not OK", and so on), can add a sentence, and sends. There's no account and no email box. For the two reasons that hide a photo, they first see *"Are you sure? Reporting this will hide it from everyone until Syros Cats have reviewed it."* Afterwards they're told exactly what happened: the photo is hidden, or it isn't hidden yet. The words come from what the server actually did, so nobody is ever told a photo is down when it isn't. With no signal, the report is saved on the phone ("saved in this browser" on the website) and sent later. It never says "hidden" before the server has it.

**What everyone else sees.** A photo hidden by a report disappears from every public place at once and gets a new web address, so old copies of the address stop working too. In the sightings list its place shows a calm tile: "Photo hidden while Syros Cats take a look." Nothing else changes on its own. A report that a cat has died, that its name is wrong, or that the page shows where someone lives changes nothing until a person on the team acts.

**What the Syros Cats team sees.** Welfare reports stay at the top of the dashboard queue, exactly as today. Below them is a new **Issues** section in its own colour, with a text label on each row. Photos hidden by a report and still waiting come first, then location and "cat died" reports, then everything else, then a small "unchecked" list that should almost always be empty. From each row the team can keep a photo hidden, restore it in one tap, hide a photo by hand, rename the cat, or open the cat's page. For a photo hidden for privacy, any team member can also **delete it for good**, after typing a confirmation. The shared inbox gets a "Photo hidden" email (at most 10 an hour) and one daily digest of everything else. **Cat guardians never see any of it**, not even reports about cats in their own colonies.

**What stops abuse.** Both public forms (this one and "This cat needs help") get Cloudflare Turnstile, a check that's almost always invisible. On the phone apps it runs in a hidden web view on our own app address. A report with a bad or missing check is refused with a "try again" answer and creates nothing, and the app quietly runs a fresh check and resends, so **a real report about a hurt cat is never lost**. A report is let in unchecked only when our own server can't reach Cloudflare at all. Limits per internet address are counted in the database (SYC-105), so they hold across servers and restarts. **After 5 report-hides in a day (Athens time), automatic hiding stops until midnight.** The team can still hide by hand, and there's no "resume" button. A photo the team has ever restored can't be hidden again by a report.

**The order, in one line.** First Turnstile on the cat-in-trouble form (it's what lets the pre-launch pass come off on launch day), then shared limits, then the new photo address on hide, then making the queue safe for a second kind of report, then the report itself, then the app's screens, then the team's Issues section and removal, then the one-year clean-up.

---
## Where the spec and the code on `main` disagree

The spec's decisions stand. These are places where carrying them out needs the plan to say something the spec didn't, because the code (or another approved spec) has moved on. Each is checked against the file named.

| # | What the spec says | What is true on `main` (or in an approved spec) | What this plan does |
|---|---|---|---|
| C1 | D14: a new photo address on hide "makes the old address dead everywhere: browser, app, shared cache" | A shared cache keys its copy by address. Changing the address stops **new** requests finding the photo, but a cache that already holds the old address keeps serving it to anyone who asks for that address, until its lifetime runs out. `routes/photos.ts:59-65` serves public photos as `public, max-age=31536000, immutable` once the pass is off. Live probe today (13 Oct): `apptest.catspotters.com` answers through `server: Google Frontend` with `via: 1.1 google`, not Cloudflare; `api.catspotters.com` doesn't resolve. So nothing is known to cache photos today, but nothing stops one being added | Builds D14 as decided (Slice 3) **and** puts Decision 1 to Samuel: also tell shared caches not to keep photos, so D14's promise is actually true |
| C2 | D6: `clear_home_description` "only if SYC-130 leaves the home description public" | **SYC-130 decided it** (claiming spec D9, approved 13 Oct, being built on `claude/syc-130-build`): the home note is "owner and team only", never in the public cat payload or any message (`claiming-a-cat.md` §6; its plan Task 4) | Doesn't build `clear_home_description` and doesn't add it to the roles catalogue. A `location_revealing` report goes to the queue and the team acts by hand. Decision 2 asks Samuel to confirm |
| C3 | D5: removal only "on a photo already hidden for a privacy reason" | A hide records free text in `reason` (team) or `report:<id>` (report). Nothing says which hides are "for a privacy reason" | Decision 3 defines it |
| C4 | §5.2: `issue_alert` "placed in the shed order ahead of the reporter acknowledgements" | **No shedding exists.** `lib/mail/send.ts:43-44`: "shedding arrives with the first purpose that can be shed". `issue_alert` is that purpose. There's no shed order, no daily budget and no hourly cap in the mail code | Slice 5 builds the smallest shedding that makes the spec's promise true (below), with test 12 |
| C5 | §5.1: "`kind` and its check already exist" | True (`lib/db/src/schema/welfare.ts:44`, check `kind in ('welfare','content')`). But `lat` and `lng` are `NOT NULL`, the resend key is `unique (reporter_device, client_ref)`, and there's no `reason`, `photo_id`, `hidden_by_report` or `token_checked` column | Slice 4's migration, with the rollback block the spec asks for |
| C6 | §5.3 and §5.4 name `view_welfare_queue` | **Not in the code yet.** `lib/capabilities.ts` has 12 names and `can()` answers "is this person staff?". `view_welfare_queue` arrives with SYC-53 PR 0.5; today the queue's JSON route asks for `view_exact_location` (`routes/teamReports.ts`) | Slice 7 uses `view_welfare_queue`. If PR 0.5 hasn't merged when Slice 7 is built, Slice 7 adds the name to `CAPABILITIES` itself (staff hold everything today, so nothing changes for anyone), and PR 0.5 absorbs it |
| C7 | §6: hiding leaves the photo "one of the matching model's reference images" | Confirmed, and it's more than a reference: `routes/sightings.ts:242-282` (`computeMatchCandidates`) sends each nearby cat's **main photo bytes to the matching service**, with no hidden check. A privacy-hidden main photo is still sent out at every nearby match | Removal (Slice 7) takes a removed photo out of matching, as D5 says. Hiding is left as the spec accepted it, and a ticket is filed so Samuel can decide whether privacy-hidden photos should also leave matching (see "Linear") |
| C8 | §9.3: "`serve-web.js` sets only `frame-ancestors 'none'`" | True only while the website pass is on (`serve-web.js:405-408`); with it off there are no security headers at all | Nothing blocks the Turnstile script either way. `/_challenge` is a top-level page in the WebView, never framed, so `frame-ancestors` doesn't affect it |
| C9 | §4.2: the saved list "only sends while the app or page is open" | The queue syncs on a 60-second timer, on NetInfo and on AppState (`context/ReportQueueContext.tsx:242-252`). A phone app's timers pause in the background, but a NetInfo event can arrive while the app isn't on screen | Slice 1.3 makes a send that needs a check wait until the app is active, so the challenge never runs where nobody can tap it |
| C10 | §13 test 21: "the retention job deletes an issue note at one year and a welfare note at three" | **There's no welfare retention job at all.** The three-year rule is written down but nothing runs it | Slice 8 builds the one-year issue job and proves it never touches a welfare row. The three-year welfare job gets its own ticket |
| C11 | The "Think this cat is alive? Tell Syros Cats" link (§2) | Not on `main` yet (no such string in `lib/i18n.ts`) | Slice 6 provides the landing place (the sheet opens with `wrong_info` chosen when asked); `choose-a-different-cat.md`'s build adds the link |
| C12 | DECISIONS.md "§15 entries for a new Part" | Not added yet (the last Part is 2p, SYC-53) | Docs PR 0.1 adds them as **Part 2q**, word for word from spec §15 |

---

## Decisions for Samuel

Three, one at a time. Each has a recommendation. None blocks Slices 0–2; Decision 1 is needed before Slice 3, and Decisions 2 and 3 before Slice 7.

### Decision 1: Make "a new photo address on hide" actually stop shared caches (C1)

**The question.** You chose to give a photo a new web address whenever it's hidden or restored (D14). That stops anyone *new* from finding the photo at its old address. But a shared cache (a company's network proxy, or a content delivery network if one is ever put in front of the app) that already stored the photo under its old address will keep handing it out to anyone who asks for that address, for up to a year. Should the app also tell shared caches not to keep photos at all?

**Why it matters.** Today nothing is known to cache our photos: the app's address goes straight to Replit's servers (checked today). But that can change quietly, for example if the launch address is put behind Cloudflare, which already fronts `catspotters.com`. A neighbour who reported their front door would assume it's gone.

| Option | What it means | Benefits | Risks | For people using the app | For the team |
|---|---|---|---|---|---|
| **A. New address on hide, and photos marked "this browser only" (recommended)** | Keep D14, and send photos as `private, max-age=31536000, immutable` instead of `public, …`. Phones and browsers still keep a copy for a year, exactly as now; shared caches are told not to store them at all | D14's promise becomes true whatever sits in front of the app later. Costs nothing today (no shared cache exists, and the pre-launch pass already sends photos as `private`). One line, plus a test | If a delivery network is ever added for speed, photos won't benefit from it. At Syros scale that doesn't matter | No visible change. Photos load from the phone's own copy as now | Nothing to do |
| B. New address on hide, plus a cache purge on hide | Keep `public`, and whenever a photo is hidden, ask the delivery network to forget it | Keeps shared caching for speed | Only works if a delivery network exists and we have its keys; today there's none, so it's code for a case we don't have. A purge that silently fails leaves the photo up | None | Nothing, unless the purge fails unseen |
| C. New address on hide only (as written in D14) | No change to the cache header | Nothing more to build | If a shared cache is ever added, a hidden private photo can stay reachable at its old address for a year, with no warning | None | None, until it matters |

**Recommendation: A.** It's the one that makes D14 hold without anyone having to remember it later. The new address on hide is still worth having: it makes the old address answer "not found" from every fresh source at once, and it stops a photo coming back at an address someone saved before it was hidden.

### Decision 2: Drop the "clear the home description" action, now that SYC-130 has hidden that text (C2)

**The question.** You decided the team would handle "the words show where someone lives" by hand, with a narrow "clear the home description" power, **unless** SYC-130 made the home description private. SYC-130's approved spec now makes it owner-and-team only: it leaves the public cat page and every push. Should this plan drop the "clear" action?

| Option | Benefits | Risks | For people using the app | For the team |
|---|---|---|---|---|
| **A. Drop it (recommended)** | Nothing to build. The roles catalogue doesn't gain a power nobody needs. The text that worried a neighbour is no longer public once SYC-130's change ships | If SYC-130's build slipped past launch, the description would still be public for a while. The fix then is to ship SYC-130's privacy change, not to build a second tool | A neighbour's report still lands in the queue, and they're told "Syros Cats will take a look" | Location reports are handled by looking and, if needed, by contacting the owner. The map spot is already blurred to 250 m |
| B. Build it anyway | A tool exists if the text ever becomes public again | Builds and tests a power for text the public can't see | None | A button that does nothing useful |

**Recommendation: A.** This plan also comments on SYC-247: its first part (clearing the text) is superseded by SYC-130, and its second part (hiding a map spot, after launch) stays.

### Decision 3: Which hidden photos can be deleted for good? (C3)

**The question.** You decided any team member can delete a photo for good if it's "already hidden for a privacy reason". The app needs an exact rule for when the **Delete for good** button appears.

| Option | What it means | Benefits | Risks | For people in photos | For the team |
|---|---|---|---|---|---|
| **A. Hidden now, and someone reported it as "shows a person or a private place" (recommended)** | The button appears only on a photo that is hidden, with at least one "It shows a person or a private place" report about it (whether the report hid it, or the team hid it by hand after the daily brake) | Matches the words "privacy reason" exactly. An irreversible action stays tied to a privacy claim someone actually made | A photo that's private but was only reported as "upsetting" can't be deleted until someone reports it as private, or until the team adds a hand-hide route for privacy later | A person whose face or front door is in a photo gets real removal | One clear rule. The row says why the button is there |
| B. Hidden now, and reported for either hiding reason (private, or upsetting/offensive) | Also covers offensive pictures | Also lets the team delete upsetting photos, which may be evidence about a cat's welfare. Deletion can't be undone | Same as A, plus offensive photos | More photos deletable; more chance of losing one by mistake |
| C. Any hidden photo | Simplest | The irreversible button sits on every photo the team has ever hidden, including "that's a different cat" | Same as A | Easiest to delete the wrong thing |

**Recommendation: A.** Deletion is the one action here that can't be undone, so it stays tied to the reason it exists for.

### Small calls this plan makes (object to any, otherwise they stand)

- **What `hidden: true` means.** The reply says `hidden: true` when the photo is hidden from the public at the moment the report is saved, whoever hid it. A second report about a photo that's already hidden therefore gets the "The photo is hidden" thank-you (true), and writes no second hide. The team sees "already hidden" on the row.
- **The reporter's note is deleted at one year; the team's note is kept** (D12). The team note is the team's record of what it did, like a welfare report's.
- **A photo deleted for good** shows a quiet tile, "Photo removed", in the sightings list, instead of "Photo hidden while Syros Cats take a look", which would no longer be true.
- **The typed confirmation for deletion** is the word `DELETE`. The dashboard is English-only until SYC-53 PR 1.0, and a fixed word is easiest to check.
- **The photo route's rate limit stays in each server's memory** after SYC-105. Every photo on every cat list passes it, so a database write per photo would cost more than it protects. Every write limit (reports, issues, hides, unchecked rows, sign-in hand-off, AI matching, new phones, deletion) moves to the database.
- **Unchecked cat-in-trouble reports beyond 10 an hour** get one "N unchecked reports waiting" email an hour at most, under the never-shed `welfare_alert` purpose, so an outage never silences a real hurt-cat report entirely.
- **Turnstile switches on in three steps** (`TURNSTILE_MODE`: `off` → `observe` → `enforce`). `observe` checks every token and logs the outcome without refusing anything, so the hostname check is proved on real traffic before it can turn anyone away. `enforce` is switched on once the phone build with the WebView is in testers' hands, and **in any case before the pre-launch pass comes off**. Older test builds would otherwise count `428` as a refusal and stop retrying after three.

---
