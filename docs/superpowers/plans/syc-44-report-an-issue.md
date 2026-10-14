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

**Today, though, it's still public.** On `main` the description is in the public cat payload (`routes/cats.ts:428`, `lib/catHelpers.ts:165`), and the "has a home" push carries it (SYC-232). SYC-130's Task 4 removes it, but nothing yet makes that a condition of launch (review finding 8).

| Option | Benefits | Risks | For people using the app | For the team |
|---|---|---|---|---|
| **A. Drop it, and make SYC-130's privacy change a launch-day condition (recommended)** | Nothing to build. The roles catalogue doesn't gain a power nobody needs. The pre-launch pass can't come off while the description is public, so there's never a public description with no way to clear it | Launch waits on SYC-130's Task 4 (already being built). Until launch, only testers see the description | A neighbour's report still lands in the queue, and they're told "Syros Cats will take a look" | Location reports are handled by looking and, if needed, by contacting the owner. The map spot is already blurred to 250 m |
| B. Drop it, with no launch condition | Nothing to build, and launch doesn't wait on SYC-130 | If SYC-130 slips past launch, a description that names someone's house stays public, and the team has no way to take it down | Same | No tool when it's needed |
| C. Build it anyway | A tool exists whatever happens to SYC-130 | Builds and tests a power for text that, once SYC-130 ships, the public can't see | None | A button that will soon do nothing useful |

**Recommendation: A.** The condition goes on SYC-114's launch-day list beside the others. This plan also comments on SYC-247: its first part (clearing the text) is superseded by SYC-130, and its second part (hiding a map spot, after launch) stays.

### Decision 3: Which hidden photos can be deleted for good? (C3)

**The question.** You decided any team member can delete a photo for good if it's "already hidden for a privacy reason". The app needs an exact rule for when the **Delete for good** button appears.

| Option | What it means | Benefits | Risks | For people in photos | For the team |
|---|---|---|---|---|---|
| **A. Hidden now, and either a "shows a person or a private place" report about it, or the team ticked "for privacy" when hiding it (recommended)** | The team's **Hide** form gains a "for privacy (a person or a private place)" tick, recorded as the hide's reason. The button appears only on a photo that is hidden **and** has a privacy report or a privacy hide | Matches "privacy reason" exactly. The team can act on a private photo nobody has reported (a privacy email, say), or one reported as "upsetting" that is really private. A stranger's report only makes the button **appear**; a team member still decides, and types `DELETE` | One more tick on the hide form | A person whose face or front door is in a photo gets real removal, however it reached the team | One clear rule. The row says why the button is there |
| A2. As A, but only a "shows a person or a private place" report counts (no team tick) | The button appears only where someone reported the photo as private | Slightly less to build | The team can't delete a private photo that nobody reported as private | As A, but only through a report | Has to wait for the right report |
| B. Hidden now, and reported for either hiding reason (private, or upsetting/offensive) | Also covers offensive pictures | Also lets the team delete upsetting photos, which may be evidence about a cat's welfare. Deletion can't be undone | Same as A, plus offensive photos | More photos deletable; more chance of losing one by mistake |
| C. Any hidden photo | Simplest | The irreversible button sits on every photo the team has ever hidden, including "that's a different cat" | Same as A | Easiest to delete the wrong thing |

**Recommendation: A.** Deletion is the one action here that can't be undone, so it stays tied to the reason it exists for: privacy, as the team judges it (review finding 9).

### Small calls this plan makes (object to any, otherwise they stand)

- **What `hidden: true` means.** The reply says `hidden: true` when the photo is hidden from the public at the moment the report is saved, whoever hid it. A second report about a photo that's already hidden therefore gets the "The photo is hidden" thank-you (true), and writes no second hide. The team sees "already hidden" on the row.
- **At one year, both notes go** (D12, review finding 19): the reporter's note and the team's note, since either may quote the reporter. The bare record (reason, photo or cat, state, dates) stays, which is what D12 lists.
- **A photo deleted for good** shows a quiet tile, "Photo removed", in the sightings list, instead of "Photo hidden while Syros Cats take a look", which would no longer be true.
- **The typed confirmation for deletion** is the word `DELETE`. The dashboard is English-only until SYC-53 PR 1.0, and a fixed word is easiest to check.
- **The photo route's rate limit stays in each server's memory** after SYC-105. Every photo on every cat list passes it, so a database write per photo would cost more than it protects. Every write limit (reports, issues, hides, unchecked rows, sign-in hand-off, AI matching, new phones, deletion) moves to the database.
- **Unchecked cat-in-trouble reports beyond 10 an hour** get one "N unchecked reports waiting" email an hour at most, under the never-shed `welfare_alert` purpose, so an outage never silences a real hurt-cat report entirely.
- **Turnstile switches on in three steps** (`TURNSTILE_MODE`: `off` → `observe` → `enforce`). `observe` checks every token and logs the outcome without refusing anything, so the hostname check is proved on real traffic before it can turn anyone away. `enforce` is switched on once the phone build with the WebView is in testers' hands, and **in any case before the pre-launch pass comes off**. Older test builds would otherwise count `428` as a refusal and stop retrying after three.

---
## How it ships: the order

Every PR is built in **its own worktree off fresh `origin/main`**, is **one PR**, and leaves `main` safe on its own. "Review and merge" uses `/ship`: an independent adversarial review in **its own worktree** (never shared with the builder or another reviewer), findings folded in, CI green, merge, Linear synced, worktree removed. **Migrations take the next free number when they are generated after rebase**, never a number chosen now: `main` ends at `0015`, SYC-53 PR 0.1 holds `0016`, and SYC-53 0.3, SYC-130's home pin and SYC-209's later PRs are also queued.

| Step | PRs | Needs first | Who notices |
|---|---|---|---|
| **0. Docs** | 0.1 roles catalogue row `remove_photo` and DECISIONS Part 2q | This plan approved | Nobody |
| **1. Turnstile on the cat-in-trouble form (SYC-170)** | 1.0 spike on real phones · 1.1 server check · 1.2 website · 1.3 phone apps | 1.0 before 1.3; 1.1 before 1.2 | Nobody, unless Cloudflare asks for a tap |
| **2. Shared limits (SYC-105)** | 2.1 limits counted in Postgres | Nothing (can run beside Slice 1) | Nobody |
| **3. A new photo address on hide (SYC-279)** | 3.1 rotation and the cache rule | Decision 1 | Nobody |
| **4. Making the queue safe for a second kind of report** | 4.1 migration and the `kind` sweep · 4.2 drop the old resend key (after 4.1 is published) | Nothing | Nobody |
| **5. The report itself (server)** | 5.2 `issue_alert` mail and shedding, **then** 5.1 `POST /api/issues`, the hide, the rules | 2.1, 3.1, 4.2; 1.1 for the token; 5.1 needs 5.2 (it queues an `issue_alert`) | The team's inbox, once the app sends |
| **6. The app** | 6.1 full-screen photo, the hidden tile, the link · 6.2 the reason sheet and the saved list | 5.1; 1.2 and 1.3 for the check | Everyone |
| **7. The team's side** | 7.1 the Issues section and its actions · 7.2 deleting a photo for good (SYC-246) | 5.1; Decisions 2 and 3; docs 0.1; 7.2 needs 7.1 (its button sits on the Issues row) | The team |
| **8. Retention** | 8.1 the one-year clean-up | 4.1 | Nobody |

**Slices 1 and 2 are both needed before the launch-day step that sets `PRELAUNCH_GATE=off`** (spec §8.2; comment on SYC-114). They don't touch the same files except `routes/reports.ts`'s two limiters, so they can be built side by side; whichever merges second rebases.

**Users first see the feature at Slice 6.** Slices 3, 4 and 5 can merge without the app sending anything, and Slice 7's Issues section is empty until 6.2 publishes. 6.1 (full-screen photo and the hidden tile) is worth publishing on its own, because the team already hides photos today (PR 6) and a hidden sighting photo currently shows a blank square.

---

## Slice 0: docs

### PR 0.1: the catalogue row and DECISIONS Part 2q (docs only; CI skips it, SYC-286)

**What changes for anyone:** nothing. It records what Samuel decided so the code can't run ahead of the approved documents.

- `docs/specs/roles-and-invites.md` §6.2 gains the `remove_photo` row from spec §5.5, word for word: island-only, team ✓, management ✓, guardian —. **`clear_home_description` is not added** (Decision 2). If Samuel picks B, the row goes in too.
- `docs/specs/DECISIONS.md` gains **Part 2q, "approval of `report-an-issue.md` (SYC-44, SYC-170), 12 October 2026"**, carrying spec §15's entries word for word, plus this plan's three decisions once answered.
- **Checked first:** no PR or branch adds `remove_photo` (searched every open PR and the SYC-53 branches, 13 Oct). SYC-53's catalogue test (its T24, PR 0.5) parses §6.2 from the document itself, so the row must be on `main` before any code uses the name. SYC-53's own docs PRs (D1–D6) edit other parts of the same file; whichever merges second rebases.

---

## Slice 1: Turnstile on the cat-in-trouble form (SYC-170)

**What changes, in plain English.** Nothing a real person notices. When someone sends a cat-in-trouble report, the app quietly checks they're a person using the real app. On the rare occasion Cloudflare wants a tap, a small sheet appears with one box to tick. If the check can't finish, the report stays saved on the phone with *"We couldn't run the safety check. Your report is still saved and we'll try again."*, and it's sent next time. A script that sends reports without the check gets nothing into the queue. When Cloudflare itself is down, reports still get through, marked "unchecked", in their own small list at the bottom of the queue.

### PR 1.0: the spike, first, on a real iPhone and a real Android phone (spec §9.4, §9.6, D10)

Nothing is merged to `main` from the spike except a short note.

1. **Cloudflare (Claude, via the API; the `turnstile-spin` skill).** Probe that the wrangler token can manage Turnstile (`GET /accounts/:id/challenges/widgets`). If it can't, that is a token-permission problem to fix, and it is the only Cloudflare step that would reach Samuel. Create the **production widget**: managed mode, domains `["apptest.catspotters.com"]` **only** (never `catspotters.com`, which would authorise every subdomain, §9.6). Development and Replit preview addresses use **Cloudflare's published test keys**, never this widget.
2. **The secret key** goes into the EU Replit project's deployment secrets as `TURNSTILE_SECRET_KEY`. Replit has no way for Claude to write a secret: `docs/runbooks/replit-github-sync.md` records the Replit agent confirming that only a human can type into the Secrets pane. So **Samuel copies it from the Cloudflare dashboard's Turnstile page straight into Replit's Secrets pane**. The value never passes through chat, a file or a prompt. This is the one human step in Slice 1. The sitekey is public and goes into the app's build settings and the website build.
3. **The page.** A one-screen `/_challenge` page, served by `serve-web.js` on the app host, that renders the widget in managed mode with the `action` and `cdata` from its query string, and hands the token back with `window.ReactNativeWebView.postMessage`. The website's own pre-launch pass lets exactly `/_challenge` through: it's static, holds no data, and the phone has no website cookie.
4. **The phones.** A development build with `react-native-webview` (a native dependency, so a new build, not a web publish). First on the iOS simulator (Claude), then on **a real iPhone and a real Android phone** through an internal test build. Each records:
   - the exact `hostname` string siteverify reports for a phone token (it must be `apptest.catspotters.com`);
   - `action` and `cdata` round-trip;
   - time to a token on Wi-Fi and on one bar;
   - what happens when Cloudflare asks for a tap;
   - that the user agent stays the same through the session.
5. **Output:** `docs/research/syc-170-turnstile-spike.md`, with the four facts above. **If the hostname isn't the app host, Slice 1.3 stops** and the options in spec §9.4 come back to Samuel.

### PR 1.1: the server check, both routes (spec §9.2, §9.5; migration `report_token_checked`)

- **`lib/turnstile.ts`**: `verifyTurnstile(token, expectedAction, expectedCdata)` returns exactly one of three outcomes:
  - `ok`: success, with `action`, `cdata` and `hostname` all matching. The hostname is compared with an **exact list** (`TURNSTILE_HOSTNAMES`, default `apptest.catspotters.com`).
  - `rejected`: missing, malformed, over 2,048 characters (refused before any call to Cloudflare), `success: false`, wrong action, wrong `cdata`, or a hostname not on the list.
  - `unreachable`: a timeout (3 seconds, then one retry with the same `idempotency_key`) or a 5xx.

  No `remoteip` is sent. The token is never logged: request bodies aren't logged today, and the siteverify error path logs only the outcome and Cloudflare's error codes.
- **What our side's own failures count as** (review finding 2):
  - a **missing secret** at start-up is logged as an error, and `/api/healthz` reports `turnstile: not_configured`;
  - a siteverify reply of `invalid-input-secret` or `missing-input-secret` (our key is wrong) is **our** fault, never the sender's. It answers **`503 turnstile_not_configured`**, which the app already retries for ever with no strike, so the report stays on the phone until the key is fixed. It's never accepted as unchecked, because a broken key would otherwise let every report in;
  - a `429` from Cloudflare, or any reply that isn't JSON, counts as `unreachable`.
- **`TURNSTILE_MODE`**:
  - `off`: no check (the default in development and tests unless a test sets it);
  - `observe`: check and log the outcome, refuse nothing;
  - `enforce`.

  **In production the default is `enforce`, and `off` and `observe` are honoured only while `PRELAUNCH_GATE` is on**, so the pass can't come off with the check asleep. **On `/api/issues`, a hide needs an `ok` verdict in every mode**: in `off` or `observe`, issue reports are queued and never hide.
- **`POST /api/reports` and `POST /api/reports/draft`**, in this order:
  1. body;
  2. device;
  3. **the duplicate check first**: a sent report with this `(device, clientRef)` gets its original answer;
  4. the token (action `welfare_report` or `welfare_draft`, `cdata` = `clientRef`):
     - `rejected` → **`428 { error: "challenge_required" }`**, nothing written;
     - `unreachable` → accept with `token_checked = false`, after the **unchecked limit** (3 an hour per address, both forms together). **Drafts count in their own unchecked bucket** (10 an hour), so a real report during an outage doesn't use up two of the three on its own draft (review finding 15);
  5. the existing write.
- **Migration:** `welfare_reports.token_checked boolean` (nullable). `null` means "sent before Turnstile", `true` means "checked", `false` means "accepted while Cloudflare was unreachable". Rollback drops the column.
- **The unchecked limit** counts in memory until Slice 2 merges. That's correct today, because the deployment is pinned to one instance (`docs/DEPLOYMENT.md`, SYC-105 step 1). Whichever of 1.1 and 2.1 merges second moves it to the shared store.
- **The queue page:** unchecked reports sit in their own **"Unchecked (Cloudflare was unreachable)"** list below the checked ones, never in the urgent-first order. Unchecked drafts are collapsed. The count shows even when it's zero, as an early warning.
- **Unchecked alert emails:** individually up to 10 an hour in total, then at most one "N unchecked reports waiting" email an hour (small call above).
- **Tests:**
  - **T1-1:** `rejected` for each of missing, malformed, over-long, `success: false`, wrong action, wrong `cdata`, `team.catspotters.com`, and a reused token (Cloudflare's `timeout-or-duplicate`). Each gets `428`, with no row, no outbox row and no draft.
  - **T1-2:** a siteverify timeout and a 503 each create an unchecked row and email it.
  - **T1-3:** the 4th unchecked row from one address in an hour is `429`, across both forms.
  - **T1-4:** a resend of an already-sent report with **no** token gets its original `200`, not `428` (the duplicate check comes first).
  - **T1-5:** the draft route with no token is `428` and writes nothing; during an outage it writes a collapsed unchecked draft (spec test 15).
  - **T1-6 (spec test 13):** neither the token nor the secret ever appears in any log line (captured logger).
  - **T1-7:** `observe` refuses nothing and logs the outcome; with the pass off in production, `off` and `observe` are ignored and `enforce` applies.
  - **T1-7b:** a wrong secret (`invalid-input-secret`) is `503`, with no row and never an unchecked row; a `429` from Cloudflare is unchecked.
  - **T1-8:** the unchecked list is below every checked report on the queue page.
  - Siteverify is faked at the `fetch` boundary.
- **Mutation probes:**
  - drop the hostname comparison → T1-1 (`team.`) goes red;
  - map `rejected` to "accept unchecked" → T1-1 red;
  - put the token check before the duplicate check → T1-4 red;
  - drop the unchecked limit → T1-3 red;
  - treat `invalid-input-secret` as unreachable → T1-7b red.

### PR 1.2: the website, and the saved list's rule (spec §9.3, §9.5, D11)

- **`lib/turnstile.ts` in the app** (the client twin): `getTurnstileToken(action, cdata)`. It resolves to a token, or rejects with `ChallengeUnavailable` after about 20 seconds. On the web it loads Cloudflare's script once and renders a managed widget into a small sheet that is invisible unless Cloudflare asks for a tap. A fresh token is fetched for every send, including each resend from the saved list.
- **`lib/reportQueue.ts`**:
  - `isPermanentRefusal` treats **`428` as not a refusal** (`reportQueue.ts:145-148` would otherwise count it, a fact the spec relies on).
  - A `428` triggers one fresh check and an immediate resend of that item.
  - `ChallengeUnavailable` leaves the item `queued` with no strike, and the confirmation shows the "safety check" message.
- **`sendDraft`** gets a token too. It stays best-effort: a failed check means no draft row, which is what happens today when a draft fails.
- **Strings** in en, el and fr: the safety-check message, and the tap sheet's one line. On the web, "saved on your phone" reads "saved in this browser".
- **Tests:**
  - **T1-9 (spec test 16):** a `428` doesn't count toward three strikes; the item is kept and resent with a new token.
  - **T1-10:** `ChallengeUnavailable` keeps the item and shows the message, with no strike.
  - **T1-11:** a token is fetched per send, never reused, and never stored in the saved list (the stored item has no token field; checked with `isPendingReport`).
  - **T1-12:** the i18n test has every new key in all three languages.
- **Mutation probe:** let `428` count as a strike → T1-9 red.
- **Browser check** (with data, en/el/fr, 390 px and desktop): send a report with the test sitekey that always passes, then with the one that always fails (it must stay saved), then with the one that forces a tap.

### PR 1.3: the phone apps (spec §9.4, option A)

- **`react-native-webview`** is added (with Expo SDK 54's matching version).
- **A `TurnstileHost`** in the root layout keeps one hidden WebView ready. It loads `https://<app host>/_challenge?action=…&cdata=…` (the app host is the one the build already uses for `/api`), passes the token back by `postMessage`, and shows itself as a small sheet only when Cloudflare asks for a tap. It times out after 20 seconds, with the same fallback as the web. JavaScript and DOM storage are on; navigation is allowed only to the app host, `challenges.cloudflare.com`, `about:blank` and `about:srcdoc`; the user agent is fixed.
- **A send that needs a check waits until the app is active** (C9). A NetInfo event in the background marks the queue "due" instead of sending.
- **A new store build** (EAS) is needed. `TURNSTILE_MODE` moves to `enforce` only once this build is in testers' hands (small call above).
- **Tests:**
  - **T1-13:** the host resolves a token from a fake `postMessage`, and times out to `ChallengeUnavailable`.
  - **T1-14:** a background NetInfo event doesn't start a check.
  - **T1-15:** navigation outside the allowed list is refused.
- **Probe (Claude, then Samuel's phones):** a cat-in-trouble report from each phone lands as `token_checked = true`, and the production log shows `ok` with the exact hostname.

---

## Slice 2: shared limits, counted in Postgres (SYC-105)

**What changes, in plain English.** Nothing anyone sees. Limits that used to reset whenever the app restarted, and would multiply if Replit ran two copies, now hold properly. That's one of the two things that must be true before the pre-launch pass can come off.

### PR 2.1: the store (migration `rate_limit_counters`)

- **The table:** `rate_limit_counters (bucket text, key text, window_start timestamptz, hits int, primary key (bucket, key, window_start))`. `key` is a SHA-256 of the address **after grouping it the way the limits do today** (`ipKeyGenerator`: an IPv6 address counts by its /56 network, and an IPv4-mapped address as the IPv4 one, `newDeviceLimit.ts:29-33`; review finding 4), and a **salt that changes every day**. The salt is generated and kept in a one-row table by the server itself, so no new secret is needed. The table never holds an address, and old windows are deleted by the mail drain's sweep (the keep-safe sweep's pattern).
- **`lib/limits.ts`** provides:
  - `consume(bucket, key, limit, windowMs)`: one `insert … on conflict do update … returning hits`, atomic across instances;
  - `peek()`;
  - an `express-rate-limit` store built on them.
- **Moved onto it:** the report and draft limiters, the AI matcher, the sign-in hand-off, delete-me, the keep-safe link limiters, the per-device match limit and the new-phone cap (`newDeviceLimit.ts`'s in-memory map). The photo route's limiter stays in memory (small call above). SYC-130 and SYC-2 are adding limiters to `rateLimit.ts`; whichever merges second uses the shared factory.
- **Tests:**
  - **T2-1 (SYC-105 step 3; spec test 4's shape):** two app instances sharing one test database share the limit. The 11th report from one address across both is `429`.
  - **T2-2:** a restart doesn't reset a window.
  - **T2-3:** the stored key isn't the address, and differs on two days.
  - **T2-5:** two IPv6 addresses in the same /56 share one count.
  - **T2-4:** old windows are swept.
- **What happens when the counter itself fails** (review finding 16). If `consume()` errors (a lock timeout, say), the **cat-in-trouble routes let the report through** and log it, because a hurt-cat report must never be lost to a limiter. **Hides fail closed**: the issue row is still queued, with no hide (`hide_skipped = 'address_limit'`). Tested by **T2-6**, which makes the counter throw.
- **Mutation probes:**
  - key the store per process (in memory) → T2-1 red;
  - hash the raw address → T2-5 red;
  - fail closed on the welfare route → T2-6 red.
- **After it's live (Claude):** lift the one-instance pin in Replit's deployment settings **only after** a probe shows the limit holding. This is SYC-105 step 4. It's a Replit setting, so if Claude can't change it through the connector, it goes on Samuel's list. Update `docs/DEPLOYMENT.md`.

---

## Slice 3: a new photo address on hide and restore (SYC-279, D14)

**What changes, in plain English.** When the team hides a photo (or later, a report does), it gets a new web address, and the old one never works again. If it's restored, it gets yet another address. Nobody sees a difference, except that a copy of an old address (a saved link, an old page) stops showing the photo. With Decision 1's option A, shared caches are also told not to keep photos.

### PR 3.1: rotation, the retired-address list and the cache rule (migration `photo_public_id_history`)

- **The table:** `photo_public_id_history (public_id text primary key, photo_id int not null references photos, retired_at timestamptz not null)`.
- **The lock moves from the public id to the photo's own id** (review finding 3). Today `setPhotoVisibility` locks with `select … from photos where public_id = … for update` (`photoVisibility.ts:192`). Once the id can change, a second request waiting on that lock would find no row when the first one commits, and answer "No such photo" for a photo that exists. So the photo is first found by `findPhotoByAnyPublicId` (below), then locked by `photos.id`.
- **`setPhotoVisibility`**, inside that lock, on a real change only:
  1. move the current `photos.public_id` into the history;
  2. set a fresh `gen_random_uuid()`;
  3. write the event.

  A no-op ("already hidden") rotates nothing. The report-hide writer in Slice 5 calls the **same** helper. The outcome carries the **new** public id, so the team page's redirect after Hide or Restore (`teamPhotos.ts` `backTo`, which lands on `#p-<publicId>`; `catPages.ts:572`) lands on the photo, not on a missing anchor.
- **Two lookups, deliberately different:**
  - the **public** photo route (`routes/photos.ts`) answers only to the current id;
  - **`findPhotoByAnyPublicId()`**, used only by the issue route and the team routes, also accepts a retired id. A report queued on a phone before a rotation still finds its photo, and the team route answers a retired id with a redirect to the current one.
- **The cache rule (if Decision 1 is A):** with the pass off, photos are sent as `private, max-age=31536000, immutable`. With the pass on, nothing changes (it's already `private`).
- **Tests:**
  - **T3-1:** hide rotates. The old id is `404` on the public route, the new id is `404` while hidden, and after a restore the newest id is `200` while both older ids stay `404`.
  - **T3-2:** a no-op doesn't rotate.
  - **T3-3:** a retired id resolves through `findPhotoByAnyPublicId` and **never** through the public route.
  - **T3-4:** six simultaneous hides of one photo rotate once, and the five that lose the race answer "already hidden", **never "No such photo"**.
  - **T3-7:** after Hide and after Restore, the team page lands on the photo under its new id.
  - **T3-5:** the public cat list, cat detail, match candidates and notifications carry only current ids (PR 6's reader list, re-run).
  - **T3-6:** the photo route's header with the pass off.
  - **P6-0** (the source test that only `photoVisibility.ts` builds `/api/photos/`) still holds.
- **Mutation probes:**
  - let the public route accept a retired id → T3-3 red;
  - rotate before the lock → T3-4 red;
  - lock by public id again → T3-4 red ("No such photo");
  - send `public` → T3-6 red.
- **Probe (Claude, after publish):** hide a test photo; `curl` the old address (`404`) and the new one (`404`); restore it; `curl` all three. Check the response has no `age` header. With the pass on, the probe uses a tester key.

---
## Slice 4: making the queue safe for a second kind of report (D1)

**What changes, in plain English.** Nothing visible. The team's queue, alert emails and "Which cat is this?" behave exactly as today. This is the groundwork that lets "Report an issue" rows share the welfare table without any welfare code mistaking one for a hurt cat.

### PR 4.1: the migration and the `kind` sweep (migration `issue_reports`)

**The migration**, in one transaction. Each rule is in the database where it can be, so a code path that forgets it fails loudly instead of quietly:

- `lat` and `lng` become nullable, with a check `kind <> 'welfare' or (lat is not null and lng is not null)`.
- New columns:
  - `reason` text, with a check that it's one of the nine keys in spec §2, and `(kind = 'content') = (reason is not null)`;
  - `photo_id` int → `photos.id`;
  - `hidden_by_report` boolean not null, default false;
  - `hide_skipped` text, null or one of `already_hidden`, `restored_before`, `address_limit`, `brake`, `unchecked` (shown to the team as "hide limit reached" and so on);
  - `note_cleared_at` timestamptz (Slice 8).
- **Content rows, checked in the database:** `photo_state = 'none'`, `severity = 'attention'`, `is_litter = false`, and `photo_private`, `photo_inappropriate` and `photo_not_cat` always carry a `photo_id` (review finding 17). `wrong_cat` may or may not, because it's offered from both the cat page and a photo. "Photo still uploading" can then never show on an issue, and the alert email can never wait for a photo that isn't coming (spec §5.1).
- **The resend key includes the kind, in two steps** (review finding 1). Both live upserts in `routes/reports.ts` (lines 122-124 and 167-169) name `(reporter_device, client_ref)` as their conflict target, and migrations run **before** publish. Dropping that key in the same migration would make Postgres refuse every cat-in-trouble report and draft between migrate and publish. So:
  - **4.1 adds** the new unique `(reporter_device, kind, client_ref)` **beside** the old one, and its code moves both upserts to the new target;
  - **PR 4.2**, a one-line migration merged and migrated only **after** 4.1 is published, drops the old key.

  No issue row can exist before 4.2, because the issue route arrives in Slice 5, which needs 4.2.
- An index on `(kind, state, created_at)`, and one on `photo_id`.
- `issue_digest_runs (day date primary key, sent_at timestamptz)`, the digest's once-a-day guard (Slice 5.2).
- **The rollback blocks.**
  - **4.2's** puts back the old key. It first deletes every content row, because a content row and a welfare row with the same device and reference can't both survive it.
  - **4.1's** drops the new key, columns and table, and puts back `not null` on `lat`/`lng`. It starts with `-- DELETES EVERY "REPORT AN ISSUE" ROW FIRST: THE WELFARE ROWS' "POSITION ALWAYS PRESENT" RULE CANNOT COME BACK WHILE THEY EXIST.`

  Both are tested up, down and up. Once Slice 5 is live, either runs only with Samuel's yes.

**The sweep.** Every reader and writer of `welfare_reports` on `main`, from a full search (13 Oct). Each gets its rule and a named test:

| Place | Rule | Test |
|---|---|---|
| `lib/welfareQueue.ts` `reportsQuery()`, the open and closed lists, `getQueueReport` | `kind = 'welfare'` (the Issues section gets its own query in Slice 7) | **T4-1:** with content rows seeded, the welfare queue's JSON and HTML are **byte-for-byte** what they are without them (snapshot) |
| `welfareQueue.ts` closed count, drafts list and count | `kind = 'welfare'` | T4-1 |
| `welfareQueue.ts:187` `mailHealth` (the mail-failure banner) | Counts failed `welfare_alert` **and** `issue_alert` rows (spec §5.1) | **T4-2** |
| `lib/welfareActions.ts` `moveReportState` | Works for both kinds (same four states), but **writes a `welfare_outcome` only when `kind = 'welfare'`** (spec §5.1: the guard goes into this code now) | **T4-3 (spec test 8):** closing a content row tied to a cat writes no observation; closing a welfare row still writes one |
| `welfareActions.ts` `writeTeamNote` | Both kinds | Existing tests, plus one content row |
| `lib/welfareTie.ts` and its route | **Refuses `kind = 'content'`**: the function returns `not_welfare`, the route answers 409, and the page never offers the control | **T4-4 (spec test 8):** the tie on a content row is refused and **no `welfare_report` observation is ever written for a content row** (checked by a query over the observation table after every content-row test in the file) |
| `lib/mail/outbox.ts` `processRow` | A `welfare_alert` row whose report isn't `welfare` is marked failed `wrong_kind`, never built with welfare copy | **T4-5** |
| `routes/reports.ts` (submit and draft upserts) | `on conflict (reporter_device, kind, client_ref)`, writing `kind = 'welfare'` explicitly | **T4-6 (spec test 10):** a content row and a welfare report from the same device with the same `clientRef` are two reports |
| `routes/reports.ts:211-282` `PUT /reports/:publicId/photo` (review finding 6: a writer the first draft missed) | Looks the report up with **`kind = 'welfare'`**, so a reporter can't aim their own issue row's public id at it (it would set `photo_state = 'attached'`, which the database check refuses with a 500) → `404` | **T4-8:** a photo PUT at the reporter's own content row is `404`, writes nothing, and the row is unchanged |
| `lib/severPerson.ts:80-83` (SYC-63 deletion) | **No kind filter**: it clears the device from both kinds | **T4-7:** "delete my data" clears `reporter_device` on a content row |
| Test fixture `lib/teamAuth/__fixtures__/queueKit.ts` | Seeds both kinds | n/a |
| **Not on `main` yet:** SYC-53's guardian routes (`view_colony_welfare_reports`, its PR 3.3) | `kind = 'welfare'` in SQL (its plan already says so; SYC-44 comment, 12 Oct) | That PR's own test 29b(ii) |

- **The structural guard (T4-0).** A list written by hand misses places; PR 6's own review proved it. So a **source test** lists every file under `artifacts/api-server/src` (and `lib/`) that names `welfareReportsTable` or `welfare_reports`, and fails if a file appears that isn't in its allowlist. Each allowlist entry carries a one-line note of its `kind` rule. A new reader turns the test red until someone decides its rule. **It works file by file, so it can't see a new query added to a file already on the list** (review finding 6). Each query in an allowlisted file is therefore covered by a route test that seeds a content row (T4-1 to T4-8), and the reviewer of every later PR that touches one of those files is told to check its `kind` rule.
- **Mutation probes:**
  - drop the `kind` filter from `reportsQuery` → T4-1 red;
  - drop the `welfare_outcome` guard → T4-3 red;
  - let the tie accept content rows → T4-4 red;
  - add a dummy reader file → T4-0 red;
  - drop `kind = 'welfare'` from the photo PUT → T4-8 red.

---

## Slice 5: the report itself (server)

**What changes, in plain English.** The server can take a "Report an issue" report, hide a photo in the same moment if the rules allow, and email the team. Nothing in the app sends one yet, so nobody notices until Slice 6.

### PR 5.1: `POST /api/issues` and the hide (spec §5.1, §6, §8, §9.5, §13)

**The route.** Public, with the same CORS and pre-launch pass as `/api/reports`, and device-authenticated through `verifyDeviceSecret`. That's trust-on-first-use, with the new-phone cap. The body is `deviceId`, `clientRef`, `reason` (one of nine), `catId`, `photoPublicId` (photo reasons only), `note` (≤ 1,000), `language` and `turnstileToken`. It's added to `lib/api-spec/openapi.yaml`, and the clients are generated.

**The order inside it** (spec §13, exactly):
1. **Body and device.**
2. **Duplicate:** a content row with `(device, clientRef)` exists → reply with what it did (`200`, the stored `hidden`, below). The **upgrade case** (spec §9.5) applies when that row is unchecked, still `new` or `looking`, and its photo has never been restored. Then a valid token re-marks it checked and runs steps 6–8 for it.
3. **Courtesy:** the same device reported the same photo (or cat) for the same reason in the last 24 hours → treated as that report (spec §8.1). It's a courtesy, not a control.
4. **Attempts limit** (review finding 7): 60 calls an hour per address, counted **before** the token. Without it, junk tokens would mean unlimited calls to Cloudflare, and a Cloudflare slowed by them would turn into "unreachable" and unchecked rows. It adds to the spec's order rather than changing it: the spec's 20-reports limit still comes after the token. A real phone retrying after a `428` uses a handful.
5. **Token** (action `report_issue`, `cdata` = `clientRef`):
   - `rejected` → `428`, nothing written;
   - `unreachable` → continue as **unchecked**, after the unchecked limit (3 an hour per address, shared with the welfare form).
6. **Address limit:** 20 issue reports an hour (`429`).
7. **Find the cat and photo.** The cat must exist (`404`). The photo is found through `findPhotoByAnyPublicId` (so a rotation since the phone saved the report doesn't lose it), and must be that cat's main photo or a photo on one of its resolved sightings (`422` otherwise, so nobody can hide another cat's photo through a report about a different one).
8. **One transaction:**
   1. insert the row (`insert … on conflict (reporter_device, kind, client_ref) do nothing`; if two sends of the same `clientRef` race, the loser reads the winner's row and replies with it — review finding 10) with `kind = 'content'`, `photo_state = 'none'` and `token_checked`;
   2. for `photo_private` and `photo_inappropriate`, **lock the photo row** (the same `for update` as `setPhotoVisibility`) and apply the rules in this order, recording the first that stops the hide in `hide_skipped`:
      1. already hidden → `already_hidden`, and the reply is `hidden: true` (small call above);
      2. unchecked → `unchecked` (rule (i));
      3. **any `restore` row for this photo, ever** → `restored_before` (rule (ii));
      4. **the brake** → `brake` (rule (iv)): take a transaction advisory lock on a fixed key, and count `hide` events whose author starts with `report:` since **midnight Athens time**, worked out in SQL (`date_trunc('day', now() at time zone 'Europe/Athens') at time zone 'Europe/Athens'`), so the app's clock never matters. At 5, no hide. The lock makes the count exact when two reports race for the 5th place;
      5. **address hide limits**, 5 an hour and 15 a day, consumed in the same transaction (`lib/limits.ts`), so a rolled-back report doesn't use them up → `address_limit`;
   3. otherwise write the `hide` event (author `report:<id>`, no `person_id`, `reason` = the key) through Slice 3's helper, so the address rotates, and set `hidden_by_report`;
   4. queue the alert (5.2).

   Commit, then reply `201 { publicId, hidden }`. **The reply's `hidden` is read from the database after the hide step, never from the reason.**
- **What a repeat send is told** (review finding 10). The first answer is stored, not worked out again: `hidden` was true exactly when `hidden_by_report` is true or `hide_skipped = 'already_hidden'`. A repeat gets that stored answer, even if the team has restored the photo since. It tells the reporter what their report did, never the photo's state today.
- **No reporter details anywhere:** the IP isn't stored on the row, and the device is stored only for the resend check and cleared by SYC-63 (T4-7).

**Tests** (spec test numbers in brackets):

| Test | What it proves | Mutation probe |
|---|---|---|
| **T5-1 [1]** | A confirmed `photo_private`, and a confirmed `photo_inappropriate`, with a valid token hides in the same transaction (`hidden: true`). The photo is then `404` on the public route and absent from the cat list, cat detail, match candidates and notifications | Hide after commit in a second transaction → a forced failure between them leaves a row with no hide; the test checks atomicity by failing the outbox insert |
| **T5-2 [2]** | Each bad token is `428` with no row and no hide; a timeout or 5xx makes an unchecked row that doesn't hide | Map `rejected` to unchecked → red |
| **T5-3 [3]** | A photo with any `restore` row isn't hidden by a report, including one hidden again by the team and restored a second time | Check only the newest event → red |
| **T5-4 [4]** | The 6th hide from one address in an hour doesn't hide and records `address_limit`, across two app instances, on a day the brake hasn't tripped. **With the brake at 5 that day can't exist in production** (five hides from one address trip both at once, and the brake is checked first; review finding 5), so the brake's threshold is a named constant the test raises to 50. In production the address limit is the second line the spec says it is (§8.1) | Consume outside the transaction → red on the rollback case; drop the address check → red with the raised brake |
| **T5-5 [5]** | With 5 report-hides since midnight Athens time, the 6th queues with `hidden: false` and `brake`; there's no resume route; the first report after midnight Athens time hides again. **Run across the clock change on 25 Oct 2026** (midnight Athens is 21:00 UTC on the 24th and 22:00 UTC on the 25th) | Count a rolling 24 hours instead of the Athens day → red; count team hides too → red |
| **T5-6 [6]** | For each of `address_limit`, `restored_before`, `brake`, `unchecked`: the reply is `hidden: false` | Reply from the reason, not the database → red |
| **T5-7 [7]** | `cat_died`, `wrong_name`, `wrong_info` and `location_revealing` change nothing public: the cat's public payload is byte-for-byte unchanged, no push is sent, and no observation is written | — |
| **T5-8 [14, server]** | A second send of the same `clientRef` makes one report. A resend with a valid token **upgrades** an unchecked, undecided, never-restored report to a hide. A resend of a decided or restored one doesn't | Drop the "undecided" condition → red |
| **T5-9 [11]** | No response, and no queue JSON, carries the reporter's device, address or IP; a photo appears only as a team URL | — |
| **T5-10** | Two reports racing for the 5th brake slot: exactly one hides | Remove the advisory lock → red (run 20 times) |
| **T5-11** | A report about a photo that isn't the cat's is `422`; a retired photo id still finds its photo | — |
| **T5-12 [20]** | P6-0 still passes: no new place builds `/api/photos/` by hand | — |

### PR 5.2: the `issue_alert` email, its cap, the digest and the first shedding (spec §5.2; C4)

- **`issue_alert`** goes into `MAIL_PURPOSES` and `DEFAULT_ENABLED`, and is **not** in `NEVER_SHED_PURPOSES`. It goes to `WELFARE_ALERT_TO`, which the caller can't choose. `urgent_alert` stays off (F1).
- **Two kinds, one purpose:**
  - **"Photo hidden"** emails go out individually, **at most 10 an hour in total**, counted with `consume()` inside the report's transaction. Beyond 10, the report is left for the digest;
  - **the digest**, `Issue reports: N waiting`, is queued from the mail drain at most once per Athens day. `issue_digest_runs` is claimed with `insert … on conflict do nothing` **in the same transaction that puts the digest into the outbox**, so a failed send is retried by the outbox, and the day isn't lost (review finding 19). It lists reasons and cats with team links, and no notes.
- **The builder:** `lib/issues/alertEmail.ts`. The subject is `Photo hidden: possible private or offensive content`. The body has the reason's English label, the note (escaped), the cat's name and a team-page link, and **the photo attached** (never linked), skipped if it has since been deleted for good. There are no reporter details. `processRow` gets an `issue_alert` branch.
- **Shedding, the smallest version that keeps the promise:**
  - `claimDue` takes never-shed purposes first, so a queue of issue alerts can never sit in front of a hurt cat;
  - a sheddable purpose is **shed** (marked failed with `shed`, which the mail-failure banner doesn't count as a failure) once today's sends reach `MAIL_DAILY_BUDGET − MAIL_NEVER_SHED_RESERVE`. Resend's daily limit is account-wide. The build checks the account's real plan limit with a Resend API call and sets the default from it.
- **Tests:**
  - **T5-13 [12]:** the email has no reporter details, attaches the photo and escapes every typed string;
  - **T5-14 [12]:** with 500 issue alerts queued in an hour, a `welfare_alert` queued after them is sent in the first drain batch;
  - **T5-15:** the 11th "Photo hidden" alert in an hour is folded into the digest;
  - **T5-16:** the digest goes once a day even with two drains at the same moment;
  - **T5-17:** at the budget, `issue_alert` is shed and `welfare_alert` still sends;
  - **T5-18 (spec test 9):** a content row's alert never waits ten minutes for a photo, and the queue page never shows "Photo still uploading" on an issue row.
- **Mutation probes:**
  - order `claimDue` by age only → T5-14 red;
  - add `issue_alert` to the never-shed list → T5-17 red;
  - drop the digest guard → T5-16 red.

---

## Slice 6: the app

**What changes, in plain English.** Everyone can now tap a cat's photo to see it full screen, and can report an issue about a cat or a photo. A photo the team or a report has hidden shows a calm tile instead of a blank square.

### PR 6.1: the full-screen photo, the hidden tile and the link (spec §3, §4.3, D4, D8)

- **A full-screen view** opens from the cat page's main photo and from every photo in the sightings history (`app/cat/[id].tsx:150-154` and `:399-421`). It shows the photo, the date, who spotted it, and **Close**, with **Report an issue with this photo** beneath it. It's a modal built on the `ClaimCatSheet` pattern (`registerModalOpen`). It opens only for a photo already loaded, so nothing changes offline (spec §4.2).
- **Report an issue**, a quiet text link beside and below `NeedsHelpLink` on the cat page, never bigger than it.
- **The tile.** The public sighting payload gains `photoHidden: boolean`, set by the same `hiddenPhotoIds` call that blanks `photoUrl`, and documented in the OpenAPI spec. The app shows *"Photo hidden while Syros Cats take a look."* where the photo was (D4), or *"Photo removed"* once deleted (small call above). The flag says only that a photo was hidden, never why or by whom, which D4 accepted.
- **Not added to** the cat list cards, map pins, push notifications or the "is this the cat?" picker (spec §3.3).
- **Tests:**
  - **T6-1:** the tile shows for `photoHidden` and nothing else;
  - **T6-2:** the server sets `photoHidden` for a hidden sighting photo, and never for a sighting without one;
  - **T6-3:** the full-screen view isn't offered on the excluded surfaces (component test on `CatCard` and `CatPicker`).
- **Browser check** with real data, en/el/fr, 390 px and desktop: the cat page, the viewer, a hidden tile.

### PR 6.2: the reason sheet, the confirm step and the saved list (spec §2, §4, §11)

- **The sheet** lists the reasons as large plain buttons: cat reasons from the cat page, photo reasons first from a photo. Its first line is *"Is a cat hurt or in trouble right now? Use 'This cat needs help' instead."* as a link. Then comes the optional "Anything we should know?" box. For a hiding reason there's the **confirm step** in the approved words, with **Report and hide** and **Cancel**. It can be opened with `wrong_info` already chosen and the box asking "What do you know?", for `choose-a-different-cat.md`'s link (C11).
- **The saved list:** `lib/issueQueue.ts` on the generic `QueueStore` (`cat-spotter/pending-issues`), with the same cross-tab lock and the 24-hour reminder. It uses Slice 1's token-per-send, the `428` rule and the `ChallengeUnavailable` rule, shared with `reportQueue.ts` rather than copied.
- **The confirmation is chosen from the server's `hidden`**: hidden, "not hidden yet", or the plain thank-you (spec §4.1). Offline, it's *"Saved on your phone. It will be sent when you have a connection."*, or on the web *"Saved in this browser…"* with the line that a browser can clear what it stores. **It never says "hidden" before the server has answered.**
- **Strings** in en, el and fr for every reason, hint, the first line, the confirm step, the four confirmations, the safety-check message, the tile and the reminder. Greek capitals use `displayUpperCase` (SYC-159). The confirm step's Greek and French keep both halves: "everyone", and "until reviewed".
- **Tests:**
  - **T6-4 [18]:** the first line links to "This cat needs help"; the `wrong_info` entry opens with it chosen; the `photo_private` hint is exactly "faces, house numbers, number plates, inside a home or garden" (D2), with no "doorway";
  - **T6-5 [6, app]:** for `hidden: false` on a hiding reason, the "not hidden yet" text shows, never the hidden one;
  - **T6-6 [14, app]:** offline, the confirmation is the saved text and never "hidden"; a resend fetches a fresh token;
  - **T6-7 [16]:** `428` isn't a strike in `issueQueue`;
  - **T6-8 [19]:** every key exists in all three languages, and the web strings say "saved in this browser".
- **Mutation probes:**
  - choose the confirmation from the reason → T6-5 red;
  - drop the web wording branch → T6-8 red.
- **Browser check** (spec §13), with data, en/el/fr, 390 px and desktop: the sheet, the confirm step, each confirmation, offline.
- **Native review** of the new el/fr strings is a launch blocker for this feature (spec §11). It's filed as its own ticket (see "Linear"), linked to SYC-4.

---

## Slice 7: the team's side

**What changes, in plain English.** The team's dashboard gets an **Issues** section under the welfare reports. A photo hidden by a report sits at the top until someone decides, with **Keep hidden** and **Restore** one tap away. When the daily brake has tripped, a banner says so. On a cat's team page, a "Reports about this cat" strip shows its issues. For a photo hidden because it shows a person or a private place, the team can delete it for good, after typing `DELETE`.

### PR 7.1: the Issues section, the strip and the actions (spec §5.3, §5.4)

- **Capabilities.** `view_welfare_queue` gates the section, its data, the strip and the alert links.
- **The reported photo has its own route** (review finding 14): `GET /api/team/issue-photos/:reportPublicId`, gated by `view_welfare_queue`. It serves the photo a report points at, hidden or not, and nothing else. The catalogue photo route (`/team/photos/:publicId`, `view_exact_location` with the photo's cat as the target, hidden only to `hide_photo` holders) is unchanged. So a guardian who can see her colony's catalogue photos never reaches a photo **through an issue report**. If SYC-53 PR 0.5 isn't on `main` yet, this PR adds the name to `CAPABILITIES` (C6). Each gated route **refuses**, rather than hides, for anyone without it.
- **The section**, below "Waiting for the team", with its own colour band **and** an "Issue" text label on each row:
  1. Hidden, waiting for you (longest wait first; the count goes in the top bar);
  2. location and died;
  3. everything else (newest first);
  4. **Unchecked** (its own list).

  Each row has the reason's English label, the cat, the photo through the team route, the note (escaped), how long ago, the four states and team note, "a member of the public", **"N others reported this"** (open rows with the same photo and reason, or the same cat and reason), and `hide_skipped` in words ("hide limit reached", "restored before", "daily brake", "unchecked", "already hidden").
- **The brake banner** is shown while today's report-hides are at 5, read from the same function the route uses. There's no resume control anywhere.
- **Actions**, each with the Origin check and its capability, each in one transaction:
  - **Keep hidden** (`hide_photo`; closes as Done). It checks, under the photo lock, that the photo is **still hidden**. If someone restored it in the meantime, it closes nothing and says so (review finding 13);
  - **Restore** (`restore_photo`; writes the restore through Slice 3's helper, so the address rotates; closes as Nothing needed);
  - **Hide this photo** on `photo_not_cat` and `wrong_cat` rows (`hide_photo`);
  - links to the cat page's existing rename, life-status and "mark wrong" forms.

  **No "Which cat is this?" on a content row** (Slice 4).
- **The strip** on the team cat page lists the cat's issue reports, gated separately (spec §5.3).
- **Tests:**
  - **T7-1 [17]:** the route walk gains every new route. A guardian with the cat in her colony gets no strip, no Issues section, and a refusal on `/team/issue-photos/…` and the alert links; a team member gets all of them. This extends `team.walk.test.ts`, and SYC-53's eight-person walk once PR 0.5 exists;
  - **T7-2:** the order of the four groups, and that the section is never above a welfare report;
  - **T7-3:** the "others" count by group;
  - **T7-4:** Keep hidden writes **no** event and closes the report only while the photo is hidden (refused after a restore); Restore writes exactly one event, rotates and closes the report;
  - **T7-5:** the banner shows at 5 and there's no resume route (the walk finds none);
  - **T7-6 [11]:** the section's HTML and JSON carry no device, address or IP.
- **Mutation probes:**
  - show the strip without its own check → T7-1 red;
  - gate `/team/issue-photos/` with `view_exact_location` → T7-1 red;
  - put Issues above Waiting → T7-2 red.
- **Browser check** of the dashboard at 390 px and desktop, with seeded issues of every kind.

### PR 7.2: deleting a photo for good (SYC-246; D5; hosting §6.5; migration `photo_removal`)

- **The migration:** `photos.data` becomes nullable, and `photos` gains `removed_at`, `removed_by` (→ `people.id`) and `removed_reason`, with a check that `data is null` exactly when `removed_at is not null`. **Removing is one database write** (hosting §6.5): one `update photos set data = null, removed_at, removed_by, removed_reason`. The row stays, so every link to it survives. Rollback can't bring bytes back; the rollback block says so in capitals.
- **`removePhoto(person, publicId, reason)`** in `lib/photoVisibility.ts`. It needs `remove_photo`, a typed `DELETE`, and Decision 3's rule (under option A: hidden now, and a `photo_private` report about it or a team hide with the privacy tick). It takes the same photo lock, and records who, when and why.
- **Every place that reads a photo's bytes or could bring it back.** Each degrades gracefully, never into a 500, and each has a named test (**T7-7**). Because `data` becomes `string | null`, **the type checker finds every reader**. On top of that, **a source test (T7-8)** fails if `photosTable.data` or `photos.data` is read in a file outside the reviewed list:

  | Place | After removal |
  |---|---|
  | `GET /api/photos/:id` | `404` (it's hidden already; removal makes it permanent) |
  | Team photo route (`routes/teamReports.ts`) | `410` page: "Deleted for good by … on …" |
  | `setPhotoVisibility` restore, and the Issues "Restore" | Refused: `removed` |
  | `catDisplayPhotos` | Skips it (the newest visible photo, or the placeholder; hosting §6.5's "degrades gracefully") |
  | **Matching** (`routes/sightings.ts` `computeMatchCandidates`) | Skips a removed main photo, so it's no longer a matching reference (D5) |
  | **A repeat sighting upload** (`routes/sightings.ts:527-537`, review finding 11) | Reads the existing sighting's photo bytes. A removed one is treated like the "photo has gone" case already written there: the sighting returns without fresh matches |
  | `issue_alert` attachment | No attachment, with a line saying it was deleted |
  | Sightings payload | `photoHidden` plus "Photo removed" tile |
  | SYC-81 (shrinking old photos, not built) | Must skip removed rows; commented on SYC-81 |

- **The privacy tick** (Decision 3 A): the team cat page's **Hide** form (`routes/teamPhotos.ts`) gains a "for privacy (a person or a private place)" tick, stored as the hide event's `reason` = `privacy`.
- **The button** is on the Issues row and the team cat page, only where Decision 3 allows. The confirmation page says plainly that it can't be undone, and asks for `DELETE`.
- **Tests:**
  - **T7-7** (each place above);
  - **T7-8** (source);
  - **T7-9:** refused without `remove_photo`, without `DELETE`, on a photo that isn't hidden, and on a hidden photo with neither a `photo_private` report nor a privacy-ticked hide;
  - **T7-10:** two simultaneous removals write once.
- **Mutation probes:**
  - let restore through on a removed photo → T7-7 red;
  - drop the matching skip → T7-7 (matching) red;
  - drop the Decision 3 check → T7-9 red.

---

## Slice 8: retention (D12)

### PR 8.1: the one-year clean-up

**What changes, in plain English.** A year after an issue report is closed, the reporter's note is deleted. The bare record stays (reason, which photo or cat, what the team decided, dates), so "have we been asked about this photo before?" still has an answer.

- **A daily sweep hung off the mail drain** (the keep-safe sweep's pattern, since there's no other scheduler). For `kind = 'content'` rows in `done` or `nothing_needed` whose `state_changed_at` is over a year ago, it sets `note`, `team_note`, `team_note_by` and `team_note_at` to null and `note_cleared_at = now()` (small call above).
- **Tests:**
  - **T8-1 [21]:** an issue row's note and team note go at one year and a day, and are kept at 364 days;
  - **T8-2 [21]:** a welfare row closed four years ago is untouched (the three-year welfare job doesn't exist; ticket below);
  - **T8-3:** a reopened report (moved back to `looking`) isn't swept.
- **Mutation probe:** drop `kind = 'content'` → T8-2 red.
- The privacy policy wording (one year, Cloudflare as a processor, "the report stays with the cat's record" corrected) is SYC-248's, not this plan's.

---
## Where each of the spec's tests is built

Spec §13 names 21 tests. Each is built in exactly one PR (and sometimes checked again in the app):

| Spec test | Built in | Plan test |
|---|---|---|
| 1 hide in the same transaction; gone from every public reader | 5.1 | T5-1 (+ T3-5's reader list) |
| 2 bad token → `428`, nothing; outage → unchecked, no hide | 1.1 (welfare), 5.1 (issues) | T1-1, T1-2, T5-2 |
| 3 any restore, ever, blocks a report-hide | 5.1 | T5-3 |
| 4 6th hide from one address in an hour, across two processes | 2.1 (store), 5.1 (rule) | T2-1, T5-4 |
| 5 the brake at 5 a day, Athens time, no resume | 5.1, 7.1 (banner) | T5-5, T5-10, T7-5 |
| 6 every refusal → `hidden: false` and the "not hidden yet" text | 5.1, 6.2 | T5-6, T6-5 |
| 7 died/name/info/location reports change nothing public | 5.1 | T5-7 |
| 8 no `welfare_outcome` on close; no `welfare_report` observation ever; tie refused | 4.1 | T4-3, T4-4 |
| 9 `photo_state = 'none'`; never "Photo still uploading"; no alert delay | 4.1 (database check), 5.2 | T4-1, T5-18 |
| 10 same device, same `clientRef`, two kinds → two reports | 4.1 | T4-6 |
| 11 no device, address or IP in queue or JSON | 5.1, 7.1 | T5-9, T7-6 |
| 12 email: no reporter details, photo attached, escaped; 500 issue alerts can't delay a welfare alert | 5.2 | T5-13, T5-14 |
| 13 Turnstile: action, hostname (`team.`), `cdata`, `success: false`, reuse, timeout; secret never logged | 1.1 | T1-1, T1-2, T1-6 |
| 14 saved report: fresh check, never "hidden" early, one report per `clientRef`, the upgrade case | 1.2, 5.1, 6.2 | T1-11, T5-8, T6-6 |
| 15 draft with no token → `428`; outage → collapsed unchecked draft | 1.1 | T1-5 |
| 16 `428` isn't a strike in the app's queue | 1.2, 6.2 | T1-9, T6-7 |
| 17 route walk: a guardian sees no strip, no section, refused photo and links | 7.1 | T7-1 |
| 18 first line links to "needs help"; "alive?" link opens `wrong_info` | 6.2 | T6-4 |
| 19 every key in en/el/fr; web says "saved in this browser" | 1.2, 6.2 | T1-12, T6-8 |
| 20 P6-0 covers every new place | 3.1, 5.1 | T3-5, T5-12 |
| 21 retention by kind | 8.1 | T8-1, T8-2 |

**Mutation probes are done by hand before each merge.** Break the named line, watch the named test go red, then put it back. Each PR lists its probes and the result. Every silent-failure guard in this plan has one:
- the hostname check;
- `428` vs unchecked;
- `428` as a strike;
- the brake;
- the restore rule;
- the reply's `hidden`;
- the `kind` filter;
- the `welfare_outcome` guard;
- the tie refusal;
- retired ids on the public route;
- the cache header;
- the shed order;
- removal's restore block and matching skip;
- retention's kind.

## Every place the guards must hold

A mutation probe proves a test protects a place someone thought of. It says nothing about a place nobody thought of. So each invariant lists every consumer, and three have a **structural** check that fails on a place nobody listed:

1. **"An issue row is never treated as a welfare report."** The readers are in Slice 4's table. Structural: **T4-0**, the allowlist of files that touch `welfare_reports`.
2. **"A hidden photo is never public."** PR 6's reader list (public photo route, cat list, cat detail, match candidates, notifications, the hand-pick list, push), re-run by T3-5 after rotation. Structural: **P6-0** (only `photoVisibility.ts` builds `/api/photos/`). New places in this plan: the issue alert attachment (a team email, never a link), the Issues section and the strip (team route only), and `photoHidden` in the sighting payload (a flag, not a photo).
3. **"A deleted photo's bytes are gone and nothing brings them back."** Slice 7.2's table. Structural: **T7-8** (the `photos.data` reader allowlist), plus the type checker once `data` can be null.
4. **"A token is checked before a report is accepted, except when Cloudflare is down."** Every public write that creates a queue row: `POST /api/reports`, `POST /api/reports/draft` and `POST /api/issues`. `PUT /api/reports/:publicId/photo` needs no token (spec §9.5: it's tied to the device and to a report that has passed). T1-1, T1-5 and T5-2 cover the three routes. The route walk records that no other public route writes `welfare_reports` (T4-0 again).

---

## Rollout

For each PR, in order, after its own review:

1. Merge. CI runs `migrate:check`, the migration tests, the API and app tests. (Docs PRs get no "Test and build" run; CI skips them on purpose, SYC-286.)
2. **PRs with a migration (1.1, 2.1, 3.1, 4.1, 7.2):**
   - db-ops `migrate` on development;
   - **a Neon snapshot of production.** Auto mode blocks Neon snapshot writes, so **Samuel switches this session to "ask" mode for this one step**, then back;
   - db-ops `migrate` on production, then `verify`.

   **Migrate before publish**, as with every migration so far.
3. Samuel pulls into the EU Replit project and publishes; Claude waits until `/api/healthz` shows the new commit before probing. **1.3 and 6.x** also need a phone build: an EAS build and an internal test release.
4. **Probes (Claude), by slice:**
   - **1.1:** set `TURNSTILE_MODE=observe`. Send a web report and check the log shows `ok` with the exact hostname. `curl` a report with a junk token in `enforce` on development to get `428`, with no row.
   - **2.1:** two quick bursts from one address hit the same limit after a redeploy.
   - **3.1:** hide, `curl` and restore, as in 3.1.
   - **5.1:** on development, a `photo_private` report hides a test photo, the old address is `404`, and the alert arrives with the photo attached.
   - **7.1:** `curl` every new `/api/team/*` route without a session → `401`.
   - **7.2:** delete a test photo on development; its team route is `410`; a match near its cat still works.
5. **Switching Turnstile on** (`TURNSTILE_MODE`; small call above): `observe` after 1.2 publishes; `enforce` once 1.3's build is in testers' hands.
6. **Launch day** (comment on SYC-114): `PRELAUNCH_GATE=off` only after:
   - `TURNSTILE_MODE=enforce` is live on both forms (the code also refuses `off`/`observe` with the pass off);
   - Slice 2 is live, **and the one-instance pin has been lifted or deliberately kept**;
   - under Decision 2 A, SYC-130's Task 4 is live (no home description in the public payload or any push);
   - SYC-114's own step 0 (blurring live).

**Rolling back:** revert the PR. Every migration has a commented rollback, run on a snapshot first. 4.1's rollback **deletes every issue report** (said in capitals), so after Slice 5 is live it's run only with Samuel's yes. 7.2's can't restore deleted bytes.

---

## Where this collides with other work

| Other work | Where it meets this plan | What this plan does |
|---|---|---|
| **SYC-53 roles** (Slice 0 in flight: PR 0.1 `person_events` = migration 0016; PR 0.2 `authorityLevel`; PR 0.5 the catalogue, strict `can()`, route walk) | `CAPABILITIES`, `team.walk.test.ts`, the queue's capability, the roles spec §6.2 | Docs 0.1 adds `remove_photo` to §6.2 first (T24 parses it). Slice 7 uses `view_welfare_queue`, adding it to `CAPABILITIES` only if 0.5 hasn't merged (C6). T7-1 extends whichever walk is on `main`. Its guardian report routes keep `kind = 'welfare'` (SYC-44 comment, 12 Oct) |
| **SYC-130 claiming** (`claude/syc-130-build`) | Takes the home description out of the public payload (C2); adds limiters to `rateLimit.ts`; its own migration | Decision 2. Whichever of SYC-130 and 2.1 merges second moves its limiters onto the shared store |
| **SYC-2 coat and health** (PR 1.2 in flight) | Adds to `rateLimit.ts` and `openapi.yaml` | Rebase; new limiters use the shared factory |
| **SYC-209 feeding sites** (plan PR #118) | Its migrations take numbers too; no shared files with this plan | Next free number at generation time |
| **SYC-150** move a sighting | Moving must keep the photo's internal id, or rule (ii)'s restore history is lost | Rule (ii) keys on `photos.id`, not on the sighting or the public id, so rotation (Slice 3) and moving can't lose it. Comment on SYC-150 |
| **SYC-163** more photos per cat | A gallery would be a new place photos appear | P6-0 forces it through `publicPhotoUrl()`; the full-screen view (6.1) should be reused |
| **SYC-81** shrink old photos | Must skip a deleted photo (null bytes) | Comment on SYC-81 |
| **SYC-166** photo location (PR #101) | Reads photo metadata | No overlap unless it adds a `photos.data` reader, which T7-8 would catch |
| **SYC-231** mail drain every 3–7 hours | The digest and the retention sweep hang off the drain | Accepted (spec §5.2): the hide never waits for mail. SYC-231's fix helps both |
| **SYC-229** proxy hops | Per-address limits need `req.ip` to be real on every address | Probe result (13 Oct) commented there; SYC-306 checks the launch address |

## What this plan does not do

| Not here | Where it goes |
|---|---|
| Privacy policy wording (Cloudflare as a processor, one-year retention, "hiding isn't erasure", what's done about addresses) | SYC-248 |
| The three-year welfare retention job | **SYC-302** (new) |
| Taking privacy-hidden photos out of matching | **SYC-303** (new), Samuel's call |
| Hiding a cat's map spot pending review (D6 option B) | SYC-247's second part, after launch |
| Moving a photo to the right cat (`wrong_cat`) | SYC-150 |
| Recalling copies already on phones and browsers | SYC-276 (can't be done; the policy must not imply it) |
| App attestation on native (D10 option D) | Only if scripted abuse of the native path appears |
| Native review of el/fr | **SYC-305** (new) |
| The launch web address | **SYC-306** (new) |
| The "Think this cat is alive?" link itself | `choose-a-different-cat.md`'s build; 6.2 provides where it lands |

## What works with no signal, precisely

- **Saving a report works with no signal**, on the phone and in the browser. It's sent when there's a connection **and** the app is open, because each send needs a fresh Turnstile check, which needs a connection to Cloudflare.
- **Nothing is hidden until the server has the report.** The offline confirmation says so.
- **The full-screen photo** opens only for a photo the phone has already loaded.
- **The phone's offline cat list** may keep showing a photo that has since been hidden, until it next refreshes (spec §6).
- **The dashboard doesn't work offline**, as today.

---

## Model delegation

Session model for this plan: **Opus 5.5**. Opus was asked for in the brief: the plan adds a public, no-account endpoint that can hide photos, and changes the anti-bot rules on the cat-in-trouble form, so a wrong order or a missed guard is an abuse or privacy hole. For the build, each package goes to the cheapest tier that can do it, with the reason stated wherever it goes up.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Docs 0.1 (catalogue row, Part 2q) | Haiku | Copying approved text word for word | Session model diffs it against spec §5.5 and §15 |
| 1.0 spike: `/_challenge`, simulator run, spike note (**the production widget itself is created by the session model**, review finding 18) | Sonnet | Clear steps, documented API | **Probe:** a real token's siteverify answer shows the exact hostname, action and `cdata` (pasted into the note); session model reads the note before 1.3 starts |
| 1.1 `lib/turnstile.ts` and the two routes | **Opus** | *Escalated:* the order (duplicate before token, `428` vs unchecked) is the whole security of the welfare queue, and a wrong branch is silent (a scripted report accepted, every test green) | T1-1…T1-8 with **mutation probes** (hostname, `rejected`→unchecked, order, unchecked limit); independent review in its own worktree told to find a way in without a token |
| 1.2 web client and `reportQueue.ts` `428` rule | Sonnet | Small, well-specified client change | T1-9…T1-12, **mutation probe** (`428` as a strike); browser check with the three test sitekeys |
| 1.3 native WebView host | Sonnet | Follows the spike's proven recipe | T1-13…T1-15; **probe** on Samuel's two phones (a checked row in production); Opus spot review of the navigation allow-list |
| 2.1 shared store and moving the limiters | Sonnet | One table and a known `express-rate-limit` store interface | T2-1, T2-5 and T2-6 with their **mutation probes**; an **Opus adversarial review in its own worktree** (not a spot review; review finding 18), because every abuse limit and the hide limits stand on this store |
| 3.1 rotation and the retired-id lookup | **Opus** | *Escalated:* two lookups that must differ (public vs internal), inside an existing lock. A mix-up silently re-publishes a hidden photo at an old address | T3-1…T3-6 with **mutation probes**; P6-0; **probe** after publish |
| 4.1 migration and the `kind` sweep | Sonnet | Mechanical once the reader table exists, which this plan provides | T4-0 structural guard plus T4-1's byte-for-byte snapshot, **mutation probes** on four sites; session model reads the generated SQL and the rollback line by line |
| 5.1 `POST /api/issues` and the hide transaction | **Opus** | *Escalated:* rule order, the advisory-locked brake, limits consumed inside the transaction, the upgrade case. Every one fails silently | T5-1…T5-12 with **mutation probes**; T5-10 run 20 times; independent review told to hide 6 photos in one Athens day |
| 5.2 `issue_alert`, digest, shedding | Sonnet | Follows the outbox's existing pattern | T5-13…T5-18 with **mutation probes** (shed order, never-shed list, digest guard); Opus spot review |
| 6.1 full-screen view, tile, `photoHidden` | Sonnet | Standard screen work on an existing pattern | T6-1…T6-3; browser check 390 px and desktop, en/el/fr, real data |
| 6.2 reason sheet, confirmations, `issueQueue` | Sonnet | Clear copy and states from the spec | T6-4…T6-8, **mutation probes** (confirmation from reason; web wording); browser check; SYC-305 for native review |
| String tables and repetitive fixtures | Haiku | Mechanical | i18n test; session model reads the English |
| 7.1 Issues section, strip, actions | Sonnet | Server-rendered HTML following the queue page | T7-1…T7-6 with **mutation probes** (strip check, order); route walk; browser check |
| 7.2 deleting for good | **Opus** | *Escalated:* irreversible, and every reader of photo bytes must degrade. A missed one is a silent privacy failure or a 500 | T7-7…T7-10, T7-8 structural guard, **mutation probes**; independent review told to find a way to show or restore a deleted photo |
| 8.1 retention sweep | Sonnet | One scoped update | T8-1…T8-3, **mutation probe** (kind) |
| Adversarial review of each PR before merge | Sonnet, in its own worktree, never shared; Opus for 1.1, 2.1, 3.1, 5.1 and 7.2 | Equal tier to the builder | Findings folded in and listed in each PR; the session model checks each against the code |
| Production steps (Cloudflare widget, migrations, snapshots, probes) | Session model | Production state, not delegated | The rollout probes |

## Crash-proofing for the build

Each PR is built in its own worktree off fresh `origin/main`. **Commit after each numbered item**, with a `CHECKPOINT.md` (what's done, what's next) updated after each commit and deleted before the PR is marked ready. **Every agent prompt restates "commit after each item"** word for word. Agents don't spawn nested agents. If a session stops mid-PR, it comments where it got to on the PR's Linear ticket before stopping.

---

## Linear

**Tickets this plan builds** (no new build tickets; each slice belongs to one that exists):

| Slice | Ticket |
|---|---|
| 0, 4, 5, 6, 7.1, 8 | SYC-44 |
| 1 | SYC-170 |
| 2 | SYC-105 |
| 3 | SYC-279 |
| 7.2 | SYC-246 |

**Filed by this plan (13 Oct, deduplicated against the team's open issues first):**
- **SYC-302:** delete welfare-report notes after three years (no job exists; C10).
- **SYC-303:** a hidden main photo is still sent to the matching service (C7; Samuel's call).
- **SYC-305:** native review of the "Report an issue" strings, with the confirm step a launch blocker (spec §11).
- **SYC-306:** decide the web app's launch address, then add it to the widget and the hostname list (spec §9.6).

**Comments added (no state changes):**
- SYC-44 and SYC-170: this plan's PR;
- SYC-114: the launch-day preconditions (Turnstile `enforce`, Slice 2 live, and, under Decision 2 A, SYC-130's privacy change);
- SYC-247: its first part is superseded by SYC-130, pending Decision 2;
- SYC-229: the 13 Oct probe;
- SYC-81: skip deleted photos;
- SYC-150: rule (ii) keys on `photos.id`;
- SYC-53: `remove_photo`, and `view_welfare_queue` used by Slice 7.

## Still needs Samuel

1. **Decisions 1, 2 and 3** (above). Decision 1 is needed before Slice 3; 2 and 3 before Slice 7.
2. **One paste:** copy the Turnstile secret key from Cloudflare's Turnstile page into the EU Replit project's Secrets pane as `TURNSTILE_SECRET_KEY` (PR 1.0). Claude can't write Replit secrets (documented in `docs/runbooks/replit-github-sync.md`), and the value never comes through chat.
3. **Two phones for the spike:** a real iPhone and a real Android phone to open the internal test build (PR 1.0). If there's no Android phone to hand, say so and the spike uses a tester's.
4. **"Ask" mode** for each production Neon snapshot (Slices 1.1, 2.1, 3.1, 4.1, 7.2).
5. **Publishing** in the EU Replit project after each merge, and the phone builds for 1.3 and 6.x.
6. **Lifting the one-instance pin** in Replit's deployment settings after 2.1, if the connector can't do it.

---

## Review outcome

A Sonnet critic reviewed this plan in its own worktree, against the approved spec, its review, `DECISIONS.md`, the roles, hosting, claiming and SYC-43 part 2 documents, and the code on `main` (`f3c9c00`). The review is `docs/superpowers/plans/syc-44-report-an-issue-review.md`. It found **one blocker, seven majors and eleven minors**, and confirmed all twelve "spec versus code" claims (C1–C12). The session model checked each finding against the code before folding it in (`routes/reports.ts:122-124` and `:167-169`, `:228-232`; `routes/sightings.ts:524-540`; `routes/teamReports.ts:92-109`; `middlewares/newDeviceLimit.ts:26-36`). **Every finding was accepted. None was rejected.**

| # | Severity | Finding | What changed |
|---|---|---|---|
| 1 | Blocker | Slice 4 dropped the resend key the live upserts name; migrating before publishing would refuse every cat-in-trouble report in between | The key change is now two steps: 4.1 adds the new key beside the old, and **4.2** drops the old one after 4.1 is published. Both rollback blocks were rewritten |
| 2 | Major | No behaviour for a wrong secret, Cloudflare's `429`, or `off`/`observe` on the issue route, and nothing tied the pass to `enforce` | A wrong secret is `503` (retried, never unchecked); a `429` is unreachable; production defaults to `enforce`, and `off`/`observe` are ignored with the pass off; a hide always needs an `ok` verdict. T1-7, T1-7b |
| 3 | Major | Rotating the public id broke `setPhotoVisibility`'s lock (a lost race said "No such photo") and the team page's landing | The lock is taken on `photos.id`; the outcome returns the new id for the redirect. T3-4 (extended), T3-7 |
| 4 | Major | Hashing the raw address dropped today's IPv6 /56 grouping | Group first, then hash. T2-5 |
| 5 | Major | The address hide limit can't be reached with the brake at 5 | The test raises the brake constant; the plan says the address limit is a second line, as the spec does |
| 6 | Major | The photo upload route also writes `welfare_reports` and could be aimed at an issue row; T4-0 is file-level | The route filters `kind = 'welfare'` (T4-8); T4-0's limit is stated, and covered by per-route tests |
| 7 | Major | The token was checked before any per-address limit on the issue route | An attempts limit (60 an hour) now comes before the token, adding to the spec's order rather than changing it |
| 8 | Major | Decision 2 relied on SYC-130's privacy change with no launch condition | Decision 2's recommendation now makes SYC-130's Task 4 a launch-day condition, and option B (no condition) is set out with its risk |
| 9 | Minor | Decision 3 lacked a team "hidden for privacy" option | Decision 3 A now includes a privacy tick on the team's Hide form; the narrower rule is kept as A2 |
| 10 | Minor | A repeat send had no stored answer to repeat; a same-reference race was unhandled | The answer is read from stored columns; the insert uses `on conflict do nothing` and the loser replies with the winner's row |
| 11 | Minor | The removal reader list missed the repeat-sighting path | Added to 7.2's table |
| 12 | Minor | 5.1 queued a mail purpose only 5.2 adds; 7.2 needed 7.1 | 5.2 now comes first; 7.2 lists 7.1 |
| 13 | Minor | "Keep hidden" didn't check the photo was still hidden | It checks under the lock and refuses after a restore. T7-4 rewritten |
| 14 | Minor | The reported photo shared the catalogue photo route | Its own route, `/team/issue-photos/:reportPublicId`, behind `view_welfare_queue`. T7-1 |
| 15 | Minor | Drafts used up the unchecked limit | Drafts have their own unchecked bucket |
| 16 | Minor | No fail mode for the shared counter | Welfare reports go through on a counter error; hides fail closed. T2-6 |
| 17 | Minor | Spec tests 9 and 13 partly mapped; no database check that a hiding reason carries a photo; D2's hint not tested | T5-18 and T1-6 extended; a database check added; T6-4 pins the hint |
| 18 | Minor | The production widget sat with Sonnet; the limits store had only a spot review | The session model creates the widget; 2.1 gets an Opus adversarial review |
| 19 | Minor | The team note was kept for ever, and a failed digest lost the day | Both notes go at one year; the digest's daily claim is written with its outbox row, so the outbox retries it |
