# SYC-42: "This cat needs help" — implementation plan (for Samuel's approval)

**Linear:** SYC-42 (urgent), with SYC-43 (the dashboard queue), SYC-45 (email capture), SYC-3 (the shared send function), SYC-68 (vet pins), SYC-35 (the onboarding promise). **Status:** plan only. Nothing here is built, published or configured.
**Design (approved, not reopened here):** `docs/specs/team-access-and-welfare-queue.md` v2.0 (approved 28 Sep 2026) §1, §3.1, §4, §5, §8.3–§8.6, §9.3 · `docs/specs/DECISIONS.md` F1, F7b, F8 and Part 2b, which win over the spec · the review `docs/specs/reviews/team-access-and-welfare-queue-review.md` · Susan's reply `docs/specs/source/syros-cats-standard-reply.md` · `docs/specs/source/syros-vets-verified.md` · `docs/specs/source/safety-copy-translations.md`.
**Checked against:** `origin/main` at `4cc8a2d` (30 Sep 2026); open PRs #23 (data spine plan), #24 (SYC-98), #28 (SYC-43 part 1), #45 (SYC-35), #52 (SYC-119 Slice A); the SYC-3 and SYC-121 plans on `main`; Linear SYC-42 in full, including its comments. Every "exists today" claim below names the file it was read in.

---

## In plain English

**What a worried person gets, first.** On a cat's page, after taking a photo, and on the map, there is a quiet "This cat needs help" button. It asks for a photo, where the cat is, and how bad it is: *Needs attention* or *Urgent*. Before they send, the app tells them the truth in Syros Cats' own words: Syros Cats is a small private sanctuary, not an emergency service, and it's at full capacity. A vet is the fast route. **The vets on Syros will lend you a carrying cage.** Then it shows the three clinics with tap-to-call numbers and map links, how to get a hurt cat into a cage with strong-smelling food, handling only as a last resort, what the vet costs, and the Municipality's number for a cat that needs weeks of care. For kittens: please don't move them. The report always goes through; nobody is ever blocked from telling Syros Cats.

**What Syros Cats get, first.** Every report lands in the app's own database, and an email goes to `admin@syroscats.com` with the photo attached, the exact spot, a map link, how urgent it is and what the person said. Urgent reports have their own subject line. The database row is written first, so a mail failure can never lose a report.

**What comes after.** The welfare queue on the staff dashboard (once staff sign-in is live), then emails to reporters who leave an address (checked first, so nobody can use the form to spam a stranger), then the launch protections (Turnstile and shared rate limits), then tying a report to a cat's record.

**What this does for the onboarding promise.** PR #45 ends the "Look, don't touch." screen with *"If you find a cat that is hurt or sick, that is different, and the app will tell you what to do."* Slice 1 is what keeps that promise. It should be live on the website before, or in the same publish as, #45.

**What isn't in this plan.** "Report an issue" on photos (SYC-44, spec §6), push updates to reporters (spec §9.2, undecided), the feeding-site map and colonies (SYC-43's later parts).

---

## A conflict to read first: the WhatsApp alert

The brief for this plan says urgent reports "need an alerting channel that wakes a human". That was the review's top finding (review §3, 3 Sep 2026), and SYC-42's description records it. **But Samuel decided against it after the review:** F1 in `DECISIONS.md` says *"Nothing pages a human, by design"*. SYC-42's own later paragraph (3 Sep) says *"F1 is confirmed in the charity's own words … The no-alarm decision and vet-first messaging are right."* The spec Samuel approved on 28 Sep says it three times: §1, §3.1 ("never grow an 'escalate' or 'page someone' button") and §3.6 ("No alerting, paging, escalation or on-call rota").

So this plan **builds no alert by default**. It sets the question out properly as Decision 1, with how WhatsApp would actually work and whose number it would use, so it can be built straight away if Samuel changes his mind. **Slice 1 doesn't depend on the answer.**

---

## Decisions for Samuel

Seven, one at a time. Each has a recommendation. Decisions 1 and 2 belong together; the rest stand alone.

### Decision 1 — Should an urgent report message a person, and how?

**The question.** When someone sends an *Urgent* report, should anything reach a Syros Cats person straight away, beyond the email to the shared inbox?

**Why it matters.** On a Sunday evening in February nobody may open `admin@syroscats.com` until Monday. The copy sends the reporter to a vet first, so the cat isn't relying on Syros Cats. But Syros Cats might still want to know quickly.

| Option | What it means | Benefits | Risks | For reporters (tourists and cat guardians) | For the Syros Cats team |
|---|---|---|---|---|---|
| **A. Keep F1: no alert (recommended)** | Urgent reports go to the inbox with a distinct subject line, and to the queue at the top. If Syros Cats want to, they can turn on phone notifications for that subject line in their own Gmail. That's their choice, set up by them, and costs no code | Matches what Samuel and Susan decided: "a private sanctuary, not an emergency service". Promises nothing. Nothing to build or keep running | An urgent report can sit unread for a day or two. That risk was accepted with F1, and it's survivable because the copy has already sent the person to a vet | No change. They're told to go to a vet, which is the fastest help either way | No new duty. Nobody is woken. Anyone who wants faster notice can opt in on their own phone |
| B. A message to the WhatsApp group Syros Cats already use | The app posts "Urgent cat report near X, photo, map link" into their group | Fastest route to people who read WhatsApp daily | **Reopens F1 and three parts of the approved spec.** Technically awkward: WhatsApp's official business service sends to one person at a time, and group sending is new and limited (it has to be checked before anyone relies on it). Unofficial tools that drive a personal WhatsApp account break WhatsApp's rules and get numbers banned, so they're ruled out. Needs a dedicated number and Meta business checks, which take days | None visible, as long as the copy doesn't change. **If anyone is tempted to add "Syros Cats have been alerted" to the confirmation screen, that is the promise F1 forbids** | A buzz in a group at night that nobody agreed to answer. The charity may feel responsible for cats it can't take |
| C. A WhatsApp message to one or two named people who volunteer for it | The same, but to people who said yes, from a number Syros Cats own | Only people who agreed get messaged. Uses WhatsApp's standard one-to-one messages, which are well supported | Still reopens F1. Needs a dedicated number, a Meta business account, an approved message template and a small monthly cost. Volunteers leave, and the list goes stale quietly | As B | Puts the duty on one or two people, which is exactly how volunteers burn out |
| D. Email-to-phone only: a separate "urgent" address that forwards to people's phones | The urgent email also goes to a second address that Syros Cats forward wherever they like | Cheap. No WhatsApp account | Another inbox to look after. Same F1 question in a lighter form | As A | Lighter than B or C |

**Whose number, if B or C is chosen:** a **new number owned by Syros Cats** (a cheap SIM or a virtual number registered to the charity), never Samuel's or Susan's personal number. The business account would be in Syros Cats' name, and its access key would sit in Replit's secret store like the mail keys (spec §2.11). The message would carry a map link and the photo, never the reporter's details.

**Recommendation: A.** It's what was decided, it's what Susan's own reply says, and it costs nothing. If Syros Cats later ask for faster notice, C is the honest version, and the plan leaves room for it: the send function has an `urgent_alert` purpose slot that does nothing until it's switched on.

### Decision 2 — If there is an alert, does it repeat?

**Only matters if Decision 1 is B, C or D.** The review suggested re-sending an urgent report still marked *New* after a few hours, then messaging a named person.

| Option | Benefits | Risks |
|---|---|---|
| **A. No repeat (recommended)** | Nobody is chased. Nothing implies a response time | An urgent report that one person dismissed by accident isn't raised again |
| B. One morning round-up at 09:00 Athens time of urgent reports still *New* | Never wakes anyone. Catches anything missed overnight | A daily message about cats nobody can help becomes noise, then gets muted |
| C. Re-send after N hours, then to a named person after 2N | The strongest safeguard | An on-call rota in all but name, which F1 rejects |

**Recommendation: A.** If Decision 1 stays at A, there is nothing to repeat. If Samuel picks an alert, B is the gentlest repeat. C isn't recommended.

### Decision 3 — SYC-68 (vet pins and after-hours lines) isn't finished. Ship anyway?

**Where it stands.** The vet list is verified and on `main` (`docs/specs/source/syros-vets-verified.md`, spec §5.7). The pins are anchored to the petrol stations opposite each clinic, so they're accurate to about 50–100 m. Dermitzaki's pin still points at Lazareta, and the clinic is in Livadia, Manna (settled 28 Sep). Nobody has rung the two after-hours lines. On 28 Sep Samuel accepted that risk: the after-hours numbers stay in the vet list, labelled, and the urgent block doesn't mention them (Part 2b).

| Option | Benefits | Risks |
|---|---|---|
| **A. Ship with what's verified, labelled honestly (recommended)** | Help reaches people now. Pins and numbers are settings data, so fixing them later takes minutes, not a release | A pin 100 m out. An after-hours line that might not answer. Both are already accepted and labelled |
| B. Hide the two after-hours numbers until someone rings them | Nothing untested is shown | Takes away the only numbers that might answer at night, against Samuel's 28 Sep decision |
| C. Wait for SYC-68 | Everything exact | Waits on someone being physically on Syros. Delays the most urgent feature for a ten-minute pin job |

**Recommendation: A.** One small fix ships with Slice 1: Dermitzaki gets the interim **search links** from spec §5.7 (no coordinates), not the old Lazareta pin. SYC-68's description is out of date (it still lists Dermitzaki's location as open, and says to ring the lines), so this plan adds a comment there.

### Decision 4 — Ship the first version without the "your email" box?

**The question.** The spec lets the reporter leave an email to get an acknowledgement and one update. Before anything is sent to that address, it must be checked: one fixed "is this you?" email, and nothing else until they confirm (F7b). That checking system doesn't exist yet. SYC-3 and SYC-45 are building it.

| Option | Benefits | Risks | For reporters | For the team |
|---|---|---|---|---|
| **A. First version has no email box; it arrives in Slice 3 (recommended)** | The report flow ships days sooner. **Nothing in Slice 1 can email a stranger**, so the "reflected mailbomb" (review §2) can't happen | The first reporters can't hear back | Told on screen that the report is in, and pointed at a vet. Nobody waits for an email that isn't coming | No replies to send yet. No queue exists to send them from anyway (Slice 2) |
| B. Collect the address now, send nothing until checking exists | Addresses collected from day one | Holding addresses we can't use yet, and a box that promises a reply that doesn't come. That's the broken promise SYC-3's plan refused for the news box | A promise not kept | Personal data held without a use |
| C. Wait and ship everything together | One release | Delays help to injured cats for the least important part | — | — |

**Recommendation: A.** The confirmation screen in Slice 1 uses the spec's wording without the "if an email was given" line.

### Decision 5 — Where SYC-42's database change goes in the queue

**Where things stand.** After the Neon move, database changes go out in an agreed order: #24 (SYC-98), then #28 (SYC-43 part 1), then the rest (SYC-121 plan §A.6). Each is applied to Neon by the db-ops workflow before Samuel pulls into the EU Replit project and publishes. SYC-42's Slice 1 adds one change (three new tables). It doesn't need anything #28 adds.

| Option | Benefits | Risks |
|---|---|---|
| **A. Straight after #28, ahead of SYC-63 §5, SYC-3 and data spine PR 3. If #28 is still unmerged when Slice 1 is reviewed and ready, Slice 1 goes ahead of #28 (recommended)** | SYC-42 is the top priority, and this never makes it wait for someone else's review | Whoever is behind re-generates their migration number. It's a two-minute, mechanical job, but it touches a PR under review |
| B. Strictly after everything already queued | No churn for anyone | The most urgent feature waits behind work that isn't urgent |

**Recommendation: A.**

### Decision 6 — How the advice and vet list are kept editable without an app release

**The question.** The spec says the safety copy and the vet list live in configuration, so fixing a wrong phone number "takes a minute — not a release, a store review and a week" (§5.7). Nothing like that exists in the app today. It also has to work with **no signal**, because a hurt cat might be in a dead spot.

| Option | Benefits | Risks |
|---|---|---|
| **A. One settings file in the repository, served by the API, with a copy built into the app (recommended)** | A fix is a one-file change plus a republish: minutes, and no store review. The app keeps the last version it downloaded, so the advice shows offline. A first-ever offline open uses the copy built into the app. Changes are reviewed like code, so the urgent block can't be edited by accident | Needs a republish, so Samuel or Claude has to do it, not Syros Cats themselves |
| B. A database table edited from the dashboard | Syros Cats could edit it themselves | Needs the dashboard (Slice 2 at the earliest) and an editing screen nobody has designed. The urgent block must not be a free edit (§5.4), so editing would need a lock anyway |
| C. An outside remote-settings service | Instant changes | A new supplier and key for one file. Another thing that can be down |

**Recommendation: A.** The urgent block gets a marker that the spec asks for (§5.4): a test pins its exact text, and changing it means updating that pin with a note saying Samuel approved it. That turns "goes back through Samuel" from a rule people must remember into a check that fails.

### Decision 7 — The onboarding promise if Slice 1 isn't live when #45 publishes

**The question.** #45's last line promises that "the app will tell you what to do". Samuel kept the line because SYC-42 is being prioritised (SYC-42 comment, 30 Sep). If #45 is published to testers before Slice 1, the promise points at nothing for a while.

| Option | Benefits | Risks |
|---|---|---|
| **A. Publish #45 and Slice 1 together, or Slice 1 first. If #45 must go first, accept a short gap on the test site only (recommended)** | The promise is never broken in a store build. Testers already have Samuel's contact | A few days where web testers read a promise the app can't yet keep |
| B. Hide the line until Slice 1 ships, then turn it back on | The promise is never unbacked | A copy change in #45 under review, and a second change to undo it |

**Recommendation: A**, with one hard rule: **no store build carries #45's line unless it also carries Slice 1.** That's checked in the rollout.

---

## What exists today, and what has to be built first

Checked against `origin/main` at `4cc8a2d` and the open PRs, not the tickets.

| Needed | Exists? | Evidence |
|---|---|---|
| Welfare report tables (`welfare_reports`, `welfare_report_photos`, `report_state_events`, `mail_deliveries`) | **No.** No welfare table anywhere in the schema or migrations | `lib/db/src/schema/` holds `cats`, `colonies`, `devices`, `notifications`, `observations`, `photos`, `profiles`, `sightings`; `lib/db/migrations/0000_baseline.sql`, `0001_data_spine_tables.sql` |
| `welfare_report` / `welfare_outcome` observation kinds | **Yes, as allowed values.** `observations.kind` is open text and the comment lists both kinds. Nothing writes them | `lib/db/src/schema/observations.ts` (comment on `kind`), `0001_data_spine_tables.sql` |
| One checked way to write an observation (`writeObservation`) | **No.** It's data spine PR 2, in a plan that isn't approved yet | PR #23, `docs/superpowers/plans/data-spine.md` "PR 2" |
| Migrations with history (SYC-64) | **Yes.** Generated SQL, commented rollbacks, `migrate:check` in CI | `lib/db/migrations/README.md`, `lib/db/src/migrate/` |
| Getting migrations to production after the Neon move | **Yes.** db-ops workflow: development, then production before publish, then smoke | `docs/superpowers/plans/syc-121-neon-switchover.md` §A.4; `docs/runbooks/neon-database.md`; `.github/workflows/db-ops.yml` (PR #28 adds `people` commands to it) |
| Mail sending from the API | **No.** No Resend client, no send function, no API mail key. `grep -ri resend` across `artifacts/api-server/src` and `lib` finds nothing. SYC-25 (Done) set up `mail.catspotters.com` and a key for the **sign-in Worker** only | `artifacts/api-server/src/lib/` (no `mail/`); SYC-3 plan's "What exists today" table; SYC-25 |
| The shared send function `lib/mail/send.ts` | **Planned, not built.** The SYC-3 plan (awaiting approval, `docs/superpowers/plans/syc-3-keep-my-spots-safe.md` Slice 1 step 2) specifies it: purpose-tagged, a closed list of purposes, no free-text path, Resend through `fetch`, refuses loudly with no key. **SYC-42 builds it first** (see "Coordinating the send function") | SYC-3 plan; SYC-3 comments (plan still awaiting approval) |
| Email verification, consent events, suppression list | **No.** Planned in SYC-3 Slice 1 (`mail_tokens`, `email_consent_events`, `email_suppressions`) for SYC-45 to reuse. SYC-45 is Backlog with no plan | SYC-3 plan Slice 1 step 1; Linear SYC-45 |
| Staff sign-in, `people`, `person_scopes`, `requireTeam(capability)`, `can()` | **In PR #28, not merged.** Next in the queue after #24. Its dashboard is one line: "The welfare queue is coming soon" | PR #28 files: `lib/db/src/schema/people.ts`, `artifacts/api-server/src/middlewares/requireTeam.ts`, `src/lib/capabilities.ts`, `src/routes/team.ts` |
| Staff can actually reach the dashboard | **No.** Needs the Worker to mint the hand-off and show the button (SYC-103) and to read `people` (SYC-83), both in `fairshake-au/catspotters-website` | Linear SYC-103, SYC-83 (Backlog) |
| The staff dashboard queue screen (SYC-43) | **No** | SYC-43 part 1 plan, "Not in this part" table |
| Pre-launch gates | **Yes** (PR #30). Every `/api` route needs the website session or the tester key, except `/api/healthz`, `/api/internal/*` (internal token only) and `/api/team/*` (its own session) | `artifacts/api-server/src/middlewares/prelaunchGate.ts` (lines 21–23, 78–105), `src/lib/prelaunch.ts` |
| Server-side internal token check | **Yes** | `artifacts/api-server/src/lib/internalAuth.ts` (`checkInternalToken`) |
| Photo checking (magic bytes, decode, EXIF rotate and **strip**, re-encode, size caps) | **Yes**, called only from sightings | `artifacts/api-server/src/lib/imageValidation.ts` (`validatePhotoBase64`), `routes/sightings.ts` |
| Unguessable photo ids (`public_id`) | **In PR #24, not merged** (first in the post-move queue). Report photos get their own `public_id` in their own table, so nothing here waits on #24 | PR #24 files: `lib/db/migrations/0002_photos_public_id.sql`, `routes/photos.ts` |
| Device secret check | **Yes**, trust-on-first-use | `artifacts/api-server/src/lib/deviceAuth.ts` (`requireDeviceAuth`) |
| Rate limits | **In memory, per server.** Shared limits in Postgres are SYC-105 (Backlog) | `artifacts/api-server/src/middlewares/rateLimit.ts`; Linear SYC-105 |
| Turnstile | **No**, anywhere in this repo. No ticket for the report form | `grep -ri turnstile artifacts` finds nothing; Linear |
| Offline queue | **Yes, for sightings only**: one serialised write path, web photos in IndexedDB. The store is typed to sightings | `artifacts/cat-spotter/lib/queueStore.ts` (`QueueStoreOptions`, `PendingSighting`), `lib/offlineQueue.ts`, `context/OfflineContext.tsx` (`QUEUE_KEY`), `lib/webPhotoStore.ts`, `lib/pendingPhotos.ts` |
| Website works with no signal from a fresh open | **No.** There's no service worker, so the website only works offline if it's already open | no `serviceWorker` or `workbox` in `artifacts/cat-spotter/{app,components,context,lib,server}` |
| Location confirm | **Yes**: `components/LocationPicker.tsx` and `.web.tsx` (PR #50 is reworking the web one) | files; PR #50 |
| The onboarding promise | **In PR #45**: `howSafetyHurt` in `artifacts/cat-spotter/lib/i18n.ts` (en/el/fr) | PR #45 diff |
| Safety copy in Greek and French | **Partly.** Urgent block, onboarding and one confirmation line are drafted, awaiting a native check. *Needs attention*, litter, most of the confirmation screen and every field label are not | `docs/specs/source/safety-copy-translations.md` |
| Background jobs | **None reliable.** The deployment is autoscale, so it can scale to zero; a timer inside the server isn't guaranteed to run | `.replit` (`deploymentTarget = "autoscale"`) |

### Does SYC-42 depend on the unapproved data spine plan (PR #23)?

**Only its last slice does.** Writing `welfare_report` and `welfare_outcome` onto a cat's record needs PR 2's `writeObservation`. Every observation should go through one checked path, so this plan doesn't write a second one. Tying a report to a cat happens in the dashboard, so it can't happen before Slice 2 anyway. The spec says a report not tied to a cat writes no observation (§8.4).

**So Slices 0–4 go ahead without anything from #23.** Slice 5 waits for PR 2 to be approved and live. #23's "PR P" (getting migrations to production) is replaced by the SYC-121 db-ops route, which already works.

### Coordinating the send function (SYC-3, SYC-45)

- **SYC-42 builds `artifacts/api-server/src/lib/mail/send.ts` first**, exactly to the SYC-3 plan's interface: a TypeScript union of purposes, no free-text path, Resend through `fetch`, a loud refusal and a start-up log line when the key is missing. Slice 1 switches on one purpose, `welfare_alert`. `urgent_alert` is reserved and off (Decision 1).
- **One API key for the API's transactional mail on `mail.catspotters.com`**, separate from the Worker's sign-in key (spec §2.10). SYC-3 uses the same key later; it doesn't create a second one.
- **The priority budget (§2.10) is built in Slice 1 as the "never shed" rule only:** `welfare_alert` is in the never-shed group with sign-in. Shedding the other purposes arrives with the first purpose that can be shed (SYC-3 or Slice 3).
- **SYC-3's tables are not needed until Slice 3.** Whichever of SYC-3 Slice 1 and SYC-42 Slice 3 is built first creates them, to SYC-3's design, and the other reuses them.
- **The mail outbox table is SYC-42's**, created in Slice 1. SYC-3 can use it, since its restore link is also sent after the response.

---

## The smallest shippable slice, and everything after it

Each slice is its own PR, built in its own worktree from fresh `origin/main`, one commit per numbered item.

### Slice 0 — groundwork, no migration (can start the moment this plan is approved)

- **0.1 The send function** (`artifacts/api-server/src/lib/mail/send.ts`), as above. Plus `lib/mail/resend.ts` (the `fetch` call, a 10-second timeout, the Resend message id returned and logged without the recipient's address). HTML parts escape everything the reporter typed, and nothing typed goes into a header (§8.3).
- **0.2 The guidance file** (Decision 6): `lib/welfare-guidance/` (a new workspace package so both the API and the app import it), holding:
  - `vets.json`: the three clinics, every field from §5.7 (name, area and landmark, published address, labelled phone numbers including after-hours, Google and Apple links, coordinates or `null`). Dermitzaki carries the interim search links and `coordinates: null` (Decision 3).
  - `municipality.json`: Syros-Ermoupoli, **+30 22813 61000** (the spec's grouping of Susan's "+30 2281 361000"; same digits).
  - `copy.{en,el,fr}.json`: §5.3 (b), (c), (d) and (e), word for word from the spec as amended by Part 2b, with the F1 framing first. The Greek and French come from `safety-copy-translations.md` where it exists; the rest are our drafts, each marked `"review": "pending-native-check"`.
  - A `version` (a content hash) for caching.
  - **The urgent-block lock**: a test pins the SHA-256 of the English §5.3(b) block. Changing the text fails the test until the pin is updated with a comment naming Samuel's approval and date (§5.4).
- **0.3 `GET /api/welfare/guidance?lang=`** serves the file with an `ETag`, behind the pre-launch gate like the rest of `/api`.
- **0.4 Make the app's queue store generic** (`createQueueStore<T>` in `artifacts/cat-spotter/lib/queueStore.ts`), with no change to how sightings behave. The report queue in Slice 1 then gets the same single serialised write path, Web Lock and "never overwrite an unreadable list" rule, rather than a second, weaker copy.

### Slice 1 — the report flow, the advice, and the email to Syros Cats (one migration)

This is the cut line's first step (spec §9.3: "works with no dashboard at all").

**Server**

- **1.1 Schema** (`lib/db/src/schema/welfare.ts`, one migration, `welfare_reports_and_mail_outbox`):
  - `welfare_reports`: the spec's §8.4 columns. `kind` is `welfare` only for now. `severity` (`attention` | `urgent`), `is_litter`, `lat`/`lng` (exact), `note`, `reporter_language`, `reporter_device` (nullable, so SYC-63 deletion can clear it), `reporter_contact_id` (nullable, unused until Slice 3), `cat_id` (nullable), `state` (default `new`), `state_changed_at`, `state_changed_by` (nullable text; the foreign key to `people` is added in Slice 2), `team_note`, `is_draft`, `created_at`. Plus three columns the spec implies: `public_id` (unguessable), `client_ref` (unique with `reporter_device`, so a resent queued report isn't stored twice), and `photo_state` (`pending` | `attached` | `none`, so "photo pending" is visible, §4.3).
  - `welfare_report_photos`: `id`, `public_id`, `report_id`, `bytes`, `mime`, `created_at`. **Not rows in `photos`**, so the public photo route can't serve them (§4.3).
  - `mail_outbox`: `id`, `purpose`, `report_id` (nullable), `recipient_hash`, `payload` (no reporter address in it), `state` (`queued` | `sending` | `sent` | `failed`), `attempts`, `next_attempt_at`, `last_error`, `provider_message_id`, `created_at`. Rows are claimed with `FOR UPDATE SKIP LOCKED`, so two servers never send the same alert.
- **1.2 `POST /api/reports/draft`**: called once severity and location are set (§4.2). It creates or updates the draft row keyed by `(reporter_device, client_ref)`. Online only; best effort; a failure is silent to the user. Sends nothing.
- **1.3 `POST /api/reports`**: device secret required (`requireDeviceAuth`) as a courtesy check against a broken app, not as abuse control (§4.4). Body: `client_ref`, severity, litter flag, lat/lng, note, language. It turns the draft into a real report (or creates one), sets `photo_state = pending`, and puts a `welfare_alert` row in `mail_outbox` **in the same transaction**. Replies `201 { publicId }`. Sending the same `client_ref` again returns the same report. Limit: 10 per IP per hour (§2.6), counted in memory until SYC-105.
- **1.4 `PUT /api/reports/:publicId/photo`**: device secret required; must be the same device that filed the report. The bytes go through **`validatePhotoBase64`**, the second caller the spec asks for (§4.3), then into `welfare_report_photos`, and `photo_state` becomes `attached`. **The text goes first and the photo second**, so on a weak signal the small part arrives even if the big one struggles.
- **1.5 The alert email** (`welfare_alert`), from `Syros Cats via Cat Spotters <reports@mail.catspotters.com>` to `WELFARE_ALERT_TO` (a setting: Samuel's address for the first probe, then `admin@syroscats.com`):
  - Subject: urgent → `Urgent cat report: badly hurt or in danger`; attention → `Cat report: needs attention`; with ` · kittens` added when the litter box is ticked. Distinct enough to filter on (Decision 1 A).
  - Body: severity, the litter flag, what the reporter wrote (escaped), when, the exact coordinates, Google and Apple map links, the report's id, and *"No contact details were left."* (Slice 3 changes that line to "the reporter left contact details; reply from the dashboard").
  - **The photo is an attachment, not a link** (§4.3).
  - **When it's sent:** as soon as the photo is attached, or 10 minutes after the report if the photo hasn't arrived. Then it says *"The photo is still uploading."* If the photo arrives later, a short follow-up email carries it, with the same subject plus ` (photo)`.
- **1.6 Making sure the email actually goes** (autoscale can sleep):
  1. Right after the transaction commits, the same server tries to send.
  2. Every API request checks for due outbox rows (one cheap query, at most two rows) and sends them after replying.
  3. **A GitHub Actions schedule, `mail-drain.yml`, every 10 minutes**, calls `POST /api/internal/mail/drain` with its own narrow token, `MAIL_DRAIN_TOKEN`. That token is a GitHub Environment secret and a Replit deployment secret, never in a file or a prompt (§2.11), and it can only drain the outbox. `prelaunchGate.ts` accepts it for that one path only.
  4. Retries back off (1, 5, 15, 60 minutes, then hourly) and never give up silently.
  5. **If any `welfare_alert` has been unsent for over an hour, the drain call fails, and GitHub emails Samuel about the failed run.** That's a different delivery path from Resend. It stands in for the dashboard's "persistent send failure" banner (§8.3) until the dashboard exists. It's about the system being broken, not about a cat.
- **1.7 Logs**: the report's note, coordinates and device id never go to the request log (the existing cleaner drops query strings; this adds bodies for `/api/reports*`). Resend message ids are logged. Recipients are logged only as a hash.

**App** (`artifacts/cat-spotter`)

- **1.8 Entry points** (§4.1), quiet and never the biggest thing on screen: on the cat page (`app/cat/[id].tsx`), in the spot flow after a photo is taken (`app/(tabs)/spot.tsx`, which reuses that photo), and on the map (`app/(tabs)/cats.tsx`, no photo yet, so the flow asks for one).
- **1.9 The flow** (`app/report.tsx` plus `components/report/*`), in the spec's order (§4.2): photo → where (the existing `LocationPicker`) → how bad (the two plain choices) → **the advice for that choice**: urgent shows §5.3(b) with the "How to get a hurt cat to a vet" section open on first use (§5.2), and needs attention shows §5.3(c). Then the litter tick box (ticked shows §5.3(d)) → what you saw (optional, no counter) → **Send**. The draft call (1.2) fires when severity and location are both set. **Nothing in the flow blocks sending.**
- **1.10 The vet list**: each clinic with tap-to-call `tel:` links (one per labelled number, after-hours labelled as such), the area and landmark, Google and Apple map buttons, and *"Map pin is near the clinic (within about 100 m)"* where coordinates are landmark-anchored. Read from the guidance cache, falling back to the copy built into the app.
- **1.11 The report queue**: `cat-spotter/pending-reports`, using the generic store (0.4) and the same photo store as sightings (IndexedDB on web, files on the phone). On submit, it saves first, then sends the text, then the photo. It uses the same retry rules as sightings, separately counted.
- **1.12 The confirmation screen** (§5.3(e), as cut by Part 2b): *"Sent. Syros Cats have this."* only once the server has accepted the text. If it's still queued: *"This report is saved on your phone and sends itself the moment you have a signal."*, and **never "Sent"**. The "if an email was given" line is left out (Decision 4).
- **1.13 The 24-hour reminder** (§4.3): *"You have a cat report that hasn't sent yet."* Once per report. On the phone apps it's a local notification. On the website, which can't notify when closed, it's a banner the next time the app opens.
- **1.14 Copy and languages**: every user-facing string comes from the guidance file or `lib/i18n.ts`. The `pending-native-check` drafts ship to testers and are listed for SYC-4.

**Slice 1 ships when:** a report filed on a phone with the signal cut reaches the test inbox with its photo after the signal returns; the urgent advice reads exactly as §5.3(b); and the tests below pass.

### Slice 2 — the welfare queue on the dashboard (after #28; useful once SYC-103 lets staff in)

- **2.1 Migration** `welfare_queue`: `report_state_events` (§8.4), and the foreign key from `welfare_reports.state_changed_by` to `people.id`.
- **2.2 Team routes**, every one behind `requireTeam(capability)` from #28: `GET /api/team/reports` (`view_exact_location`); `POST /api/team/reports/:publicId/state` (`change_report_state`: New, Looking at it, Done, Nothing needed, each writing a state event); `POST …/note` (`add_team_note`); **`GET /api/team/report-photos/:publicId`**, the only route that serves report photos (§4.3).
- **2.3 The queue screen** on `team.catspotters.com`, replacing #28's "coming soon" line: urgent first, then newest (§3.1). Each row shows the photo (or "photo pending"), the exact place, how long ago, the note, the litter tag, "contact left: yes/no", the state, the team note, and the alert's delivery state. Drafts that were never sent show separately as *"Started but not sent"*, so the team still sees that somebody reported a cat in that street (§4.2) and the abandonment rate can be measured (§5.6). **No assign, no due date, no escalate button** (§3.1, §3.6).
- **2.4** #27's test 12a (walk every `/api/team/*` route with no session, expect `401 not_signed_in`) gains the new routes (SYC-122).

### Slice 3 — the reporter's email (needs the shared verification tables, and `news.` verified)

- **3.1** The email box and the consent wording from `email-capture.md` §3.4, word for word, plus the separate unticked news box only if SYC-45 has built news (otherwise hidden, as SYC-3 does).
- **3.2** The address goes into the verified-contact model (SYC-3's `mail_tokens`, `email_consent_events`, `email_suppressions`; whoever is first builds them). The report row holds only `reporter_contact_id` (§8.4).
- **3.3** The fixed verification message (`email-capture.md` §4.1) **from the news identity** (§2.10, the D2 amendment). **Nothing else goes to that address until it's confirmed** (F7b).
- **3.4** After confirmation: the acknowledgement (§5.3(g), with the litter variant and the delete link) and, at a closing state only, one outcome email (§5.3(h), fixed copy, optional team sentence on *Done*). Both are transactional, with `Reply-To: admin@syroscats.com`. Duplicate suppression is a query on `report_state_events`. "Looking at it" sends nothing.
- **3.5** Limits (§2.6): 1 verification or acknowledgement per address per 24 hours, 3 in its lifetime, then suppression. **The report row is always written.**
- **3.6** `mail_deliveries` and the Resend `delivered` / `bounced` / `complained` webhook (signature-checked, under `/api/internal/resend/*`). Bounces and complaints go on the suppression list, which also blocks verification sends (§2.10). The queue's delivery column reads it.
- **3.7** The confirmation screen gains the spec's "If an email was given" line.

### Slice 4 — launch protections (must be live before the `/api` pre-launch pass comes off)

Until launch, the pre-launch gate means only testers can reach `POST /api/reports`. That is the main abuse control today. Before the pass is removed:

- **4.1 Turnstile on report submit** (§4.4): a short spike first on how it runs in the native Expo apps (a web-view widget) as well as the website, using the `turnstile-spin` skill. The server checks the token with Cloudflare before accepting the text.
- **4.2 Shared rate limits** (SYC-105), so "10 per IP per hour" is true across servers, plus a **global daily ceiling on report submissions** that writes the row but holds alerts beyond it into a daily digest, so a flood can't bury real reports in a thousand emails.
- **4.3 The retention job** (§8.5): reports and their photos deleted after 3 years, a reporter's address 90 days after a closing state, unverified addresses after 7 days. It runs from the same scheduled workflow as the drain.
- **4.4** The privacy policy names welfare reports as a new kind of personal data (§8.5; `privacy-policy.md`, SYC-66) before store submission.

### Slice 5 — tying a report to a cat (needs data spine PR 2 live)

- **5.1** From the queue: "This is SYR-1234" sets `cat_id` and, in the same transaction, writes a `welfare_report` observation through `writeObservation`, authored by the reporter's device (Part 2g). If the report has no device (deleted), it's authored `system:welfare-report`. Moving the report to a closing state writes `welfare_outcome`, authored by the staff member's account. **The reporter's note is not copied into the observation** (§8.4). Neither kind changes a derived status.
- **5.2** "Use this photo on the cat": the bytes are checked again by `validatePhotoBase64` and copied into `photos` (§4.3). It's a deliberate tap, never a side effect.

---

## What works with no signal, precisely

Never "it all works offline". This is what the confirmation screen, tester notes and store listing may say.

| | Phone apps | Website |
|---|---|---|
| Opening the report flow | Yes | **Only if the website is already open in the browser.** A fresh open with no signal shows nothing, because the site has no offline mode (ticket filed) |
| The advice, the vet list, the Municipality's number | Yes: the last version downloaded, or the version built into the app | Yes, if the site is already open: the last version downloaded, or the one built into the site |
| Tapping a vet's number | Needs **phone** signal (a voice call), not mobile data | Same, on a phone |
| The map links to a clinic | Need mobile data, unless offline maps are downloaded in Google or Apple Maps | Same |
| Confirming where the cat is | GPS works without data. The map behind the pin needs data unless tiles were saved earlier (`lib/offlineTiles.ts`) | The map shows grey squares without signal (SYC-167). GPS still sets the point |
| Filling in and "sending" the report | Saved on the phone and sent when signal returns. **Not delivered while offline**, and the screen says so | The same, saved in the browser. **The browser can clear it**: Safari after seven days unused (unless added to the Home Screen), private browsing, or clearing site data (`offline-queue-on-web.md` R1). In-app browsers without IndexedDB keep the photo inline, with the same limits as sightings (R3) |
| The "started but not sent" record for Syros Cats | **Not recorded** if the flow is abandoned offline. Drafts are online only | Same |
| The email to Syros Cats | Goes when the report reaches the server, never before | Same |
| The 24-hour "not sent yet" reminder | A local notification | A banner next time the site is opened |

---

## Migrations

| Slice | Migration | Adds | Rollback |
|---|---|---|---|
| 1 | `welfare_reports_and_mail_outbox` | 3 tables | Drop the 3 tables (additive, no data before it runs) |
| 2 | `welfare_queue` | `report_state_events`, one foreign key | Drop both |
| 3 | `mail_deliveries` (plus SYC-3's three mail tables, if SYC-42 is first) | 1–4 tables | Drop them |
| 0, 4, 5 | none | — | — |

Each one: generated with `pnpm --filter @workspace/db run generate --name …`, a commented rollback, `migrate:check` and the up/down/up test in CI (`lib/db/migrations/README.md`).

## How this fits the Neon move (SYC-121)

The move is done (cutover 1 Oct 2026). Every SYC-42 migration follows the SYC-121 §A.4 route: merge → `db-ops -f target=development -f command=migrate` (or Samuel's next Git-pane pull) → `db-ops -f target=production -f command=migrate`, then `-f command=verify` → **Samuel pulls in the EU Replit project and publishes** (a Replit database review that isn't empty means stop, rule R3) → `db-ops -f command=smoke`.

**Place in the post-move queue (Decision 5):** #24 → #28 → **SYC-42 Slice 1** → SYC-63 §5 → SYC-3 Slice 1 → data spine PR 3's backfill → … **SYC-42 Slice 2** goes wherever it falls when it's ready (it needs #28 anyway). If #28 is still unmerged when Slice 1 is ready, Slice 1 goes first and #28 regenerates.

---

## Tests (mapped to the spec)

Mutation checks are marked **(M: …)**. Each one is done once by hand before merge: break the line, watch the named test go red, put it back.

**Slice 0**
1. The send function refuses a purpose outside the list (`@ts-expect-error` and at run time) and refuses to send with no key, logging why. *(§8.3)*
2. Reporter text is escaped in the HTML part, and a newline in a note can't add a header. **(M: drop the escape → red.)** *(§8.3)*
3. The urgent-block lock: changing one word of English §5.3(b) fails until the pin is updated. *(§5.4)*
4. The guidance file has every §5.7 field for every clinic, and every phone number is a valid `tel:` value. Dermitzaki has no coordinates and the search links. *(§5.7, Decision 3)*
5. The copy contains none of the forbidden phrases: "on duty", "standing by", "on call", "someone is coming", "we'll come", "alerted". Checked in all three languages. **(M: add "standing by" to the confirmation → red.)** *(§5.1, §10 "nobody comes away believing somebody is standing by")*
6. The generic queue store passes every existing sighting queue test unchanged.

**Slice 1** (spec §8.6 numbers in brackets)
7. **A report submitted while every mail path fails still writes the row** [§8.6 #8]. **(M: put the row insert after the send → red.)**
8. The row is written before the photo; with no photo, `photo_state` is `pending` and the alert goes at 10 minutes saying so. *(§4.3)*
9. **A report photo is not served by the public photo route** (`GET /api/photos/*` returns 404 for every report photo id, whether numeric or public) [§8.6 #12, public half]. **(M: insert report photos into `photos` → red.)**
10. **`PUT /api/reports/:id/photo` strips GPS**: a JPEG uploaded with a GPS block is stored with none [§8.6 #13]. **(M: skip `validatePhotoBase64` → red.)**
11. The alert email has the photo as an attachment, no `http` link into any photo route, and no reporter contact. *(§4.3)*
12. Urgent and attention have different subjects; the litter flag adds " · kittens".
13. Sending the same `client_ref` twice makes one report and one alert. **(M: drop the unique key → red.)**
14. Two drain calls at once send each alert exactly once (`SKIP LOCKED`). **(M: remove `SKIP LOCKED` → red with two parallel drains.)**
15. The drain path refuses without `MAIL_DRAIN_TOKEN`, and that token opens nothing else under `/api/internal`. **(M: accept it for all of `/api/internal` → red.)**
16. The drain call fails (non-2xx) when a `welfare_alert` is over an hour old and unsent. **(M: drop the check → red.)**
17. The photo route refuses a different device's secret.
18. The per-IP limit returns 429 after 10 an hour, and the row is still written for every accepted report.
19. Logs for `/api/reports*` contain no note, coordinates or device id.
20. **App:** with the network off, submitting shows the "saved on your phone" wording and never "Sent"; when the network returns, the text then the photo are sent and the screen updates. *(§4.3, §5.3(e))* **(M: show "Sent" on save → red.)**
21. **App:** the urgent advice opens with the "How to get a hurt cat to a vet" section expanded on first use, collapsed after; the lead is "Send this…", never "we may not come". *(§5.2)*
22. **App:** the cage instruction appears before any handling line, and the handling paragraph begins "If the cat will not go in". *(§10: "Nobody is told to pick up a frightened, injured cat as the first thing to try")*
23. **App:** the litter block appears when the box is ticked, with no donation ask. *(§5.3(d))*
24. **App:** the advice renders from the built-in copy with storage empty and the network off.
25. **App:** the 24-hour reminder fires once per unsent report.
26. Checked in a real browser at 390 px and desktop: the full flow on a local build with a fake mail endpoint, including offline then online.

**Slice 2**
27. Every `/api/team/reports*` route and the report-photo route return the identical `401 not_signed_in` without a session [§8.6 #12, team half; SYC-122]. **(M: leave one route without `requireTeam` → the walk test goes red.)**
28. Urgent sorts above attention, then newest first; drafts are listed separately. *(§3.1)*
29. A state change writes a `report_state_events` row with the person's id.
30. The queue response never contains a reporter address. *(§3.1)*

**Slice 3**
31. **No message other than the fixed verification goes to an unconfirmed address** (F7b). **(M: send the acknowledgement before confirmation → red.)**
32. The verification sends from `news.`; the acknowledgement and outcome from `mail.`. *(§2.10)*
33. One outcome email per report: New → Looking at it → Done sends one, and reopening and re-closing sends no second [§5.3(h)].
34. **No reporter-facing message contains an internal state name** [§8.6 #9].
35. A suppressed or rate-limited address gets nothing, and the report row is still written [§2.6].
36. A bounce webhook suppresses later verification sends to that address. A webhook with a bad signature is refused.

**Slice 4**
37. A submit without a valid Turnstile token is refused; with one, it's accepted.
38. Limits hold across two server processes [§8.6 #5].
39. The retention job deletes exactly what's past each deadline and nothing else.

**Slice 5**
40. Tying a report writes one `welfare_report` observation, authored by the reporter's device, with no note text; closing writes `welfare_outcome` by the staff account; neither changes the resolved status. *(§8.4)*

**Every place the rule "a report photo never leaves the team" has to hold**, so none is missed: the public photo route (test 9), the alert email (test 11), the queue's JSON (it returns `public_id`s for the team route, never bytes or public URLs), the team photo route (test 27), "use this photo on the cat" (Slice 5, a deliberate copy), any export or backup script (none exist; a review check), and SYC-63's deletion (reporter link cleared, photo kept as the cat's history).

---

## Rollout (after approval, and after each slice's review)

**Slice 1**
1. **Probe Resend through its API**: `mail.catspotters.com` is verified (SYC-25). Create the API's own send-only key on `mail.` and the `MAIL_DRAIN_TOKEN`. **Samuel pastes both into Replit's deployment secrets** from a terminal tab opened for him, and the drain token also into the GitHub `production` environment, so the values are never printed, filed or chatted (§2.11). Set `WELFARE_ALERT_TO` to Samuel's own address.
2. Migration through db-ops (development, then production, then verify). Samuel pulls and publishes. `smoke`.
3. **Probes**: file one urgent report from the website with Samuel's phone, signal on. Check that the row is in Neon (read-only `run_sql`), that the email reached Samuel with the photo attached, and that Resend's log shows one send. Then file one with the signal off, turn it back on, and check the same. Then `curl` the public photo route with the report photo's id and expect 404. Then run `mail-drain.yml` by hand and see it succeed.
4. **Tell Syros Cats** (human step, Samuel): reports will start arriving at `admin@syroscats.com`, what the two subject lines look like, and that they can set up a Gmail notification for the urgent one if they want (Decision 1 A).
5. Switch `WELFARE_ALERT_TO` to `admin@syroscats.com`, republish, and file one clearly marked test report. Samuel confirms with Syros Cats that it arrived (not in spam).
6. **#45's promise check**: Slice 1 is live on the test site before or with #45. No store build carries #45 without Slice 1 (Decision 7).
7. Tester note in the WhatsApp group: what the button does, and that a report sent with no signal waits on the phone.

**Slice 2:** migration through db-ops, publish, then sign in as a staff member (once SYC-103 is live) and confirm the queue shows the probe reports, urgent first, with photos through the team route. Open a report photo's team URL in a private window and expect the sign-in page.

**Slice 3:** probe that `news.catspotters.com` is verified in Resend. File a report with Samuel's address; check that exactly one verification arrives from `news.`, then the acknowledgement from `mail.` after confirming. Move it to *Done*; one outcome email arrives. Fire a test bounce from Resend's dashboard to a test address and confirm the suppression row.

**Slice 4:** before the `/api` pass comes off, a scripted burst of 20 submits from one IP gets 429 after 10, on two server instances; a submit with no Turnstile token is refused.

---

## Human blockers, owners, and what the build does meanwhile

| Blocker | Owner | Blocks | What the build does meanwhile |
|---|---|---|---|
| Decision 1 (alert, which number) and Decision 2 | **Samuel** | Nothing in Slices 0–4. Only an alert, if chosen | Builds no alert. The `urgent_alert` purpose stays off |
| Decisions 3–7 | **Samuel** | Slice 1's start (Decisions 4, 5, 6 shape it) | — |
| The API's Resend key and `MAIL_DRAIN_TOKEN` pasted into Replit and GitHub | **Samuel** (Claude creates them and opens the terminal tab) | Slice 1's rollout | Built and tested against a fake mail endpoint |
| Syros Cats told that reports are coming, and confirming one arrived | **Samuel**, with Syros Cats | Switching the recipient to `admin@syroscats.com` | Alerts go to Samuel's address |
| Susan's copy: confirm the wording during the closed test (§5.4) | **Syros Cats (Susan)** | Nothing (settled copy, confirmed in testing) | Ships as Samuel left it on 4 Sep, as amended 27–28 Sep |
| Liability and insurance check of the urgent block before launch (§5.4) | **Samuel / Fair Shake** | Launch (not testing) | Ships to testers. Ticket filed |
| SYC-68: three door pins and Dermitzaki's pin | **Someone on Syros** | Nothing (Decision 3) | Landmark pins labelled "within about 100 m"; Dermitzaki uses the search links |
| SYC-68: ringing the after-hours lines | **Nobody needs to** (Samuel accepted the risk on 28 Sep) | Nothing | Numbers shown, labelled, promising nothing |
| Greek and French: draft the rest (needs attention, litter, confirmation, labels), then a native check of all of it, including Greek informal vs formal and French *vous* vs *tu* to match whatever SYC-154 decides for onboarding | **Fair Shake** to draft · **a local speaker** to check (SYC-4, SYC-154) | Launch of the copy, the urgent block most of all (§5.5) | Our drafts ship to testers marked `pending-native-check` in the guidance file |
| A phone or WhatsApp number for litters | **Syros Cats** | Nothing. It would only appear in the acknowledgement email (Slice 3) | Acknowledgement ships without it |
| Staff can reach the dashboard (SYC-103, SYC-83, Worker repo) | **Samuel** (the other repo) | Slice 2 being *useful* (it can ship before) | Reports still arrive by email |
| `news.catspotters.com` verified in Resend | **Samuel** (DNS) | Slice 3 | Slice 3 waits; no email box until then |
| Privacy policy names welfare reports (SYC-66) | **Samuel** | Store submission | — |

---

## Model delegation

Active model: **Opus** (Samuel's chosen tier for this work, as set in the brief). Per `plan-model-delegation`, work goes down a tier where it's mechanical or clearly specified, and up a tier only for judgement that a plausible mistake would hide.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| 0.2 guidance file: transcribe §5.3, §5.7 and the translations into JSON | **Haiku** | Mechanical copying from fixed sources | Tests 3–5 (lock, every field, forbidden phrases); a line-by-line diff against the spec by the session model; **mutation probe** on test 5 |
| 0.4 generic queue store | **Sonnet** | Clear refactor with a full existing test suite | Every existing queue test unchanged (test 6); spot review by the session model |
| 0.1, 0.3, 1.1–1.4, 1.7: send function, schema, report and photo routes, logs | **Sonnet** | Clear spec, routine Express and Drizzle work | Tests 1, 2, 7–13, 17–19, with the named **mutation probes** (7, 9, 10, 13); `migrate:check`; Opus review of the diff |
| 1.5–1.6 outbox, drain, scheduled workflow, the stuck-alert failure | **Opus** (session model) | Its failures are silent: an alert that's never sent, sent twice, or a token that opens too much all look "green" | Tests 14–16 with **mutation probes**; probe step 3 (a manual drain run); an independent Sonnet adversarial review in its own worktree |
| 1.8–1.14 app flow, queue wiring, confirmation, reminder | **Sonnet** | Standard React Native screens against exact copy | Tests 20–25 (20 with a **mutation probe**); a browser check at 390 px and desktop (test 26); Opus review against §5.2 and §5.3 |
| Slice 2 team routes and queue screen | **Sonnet** | Follows #28's `requireTeam` pattern | Tests 27–30, with the walk-test **mutation probe**; Opus review |
| Slice 3 verification, acknowledgement, webhooks, suppression | **Opus** | Abuse and privacy: the mailbomb, F7b, signature checking. A plausible mistake sends mail to a stranger | Tests 31–36 (31 with a **mutation probe**); live probe with a real bounce; independent adversarial review |
| Slice 4 Turnstile spike and integration | **Sonnet** | Known pattern, with the `turnstile-spin` skill | Test 37; the burst probe in rollout |
| Slice 5 observation writes | **Sonnet** | Calls PR 2's `writeObservation`, already validated | Test 40; Opus spot review |
| Adversarial review of each slice before merge | **Opus**, in its own worktree, never shared | Judgement; the spec has silent failure modes | Findings folded in and listed in each PR |
| Upward escalation | **None planned** | No part needs architecture or ambiguity resolution above Opus; the design is approved | — |

---

## Crash-proofing for the build

Each slice gets its own worktree from fresh `origin/main` (never the primary checkout), on `claude/syc-42-slice-<n>`. **Commit after each numbered item** (0.1, 0.2, … 1.14), not at the end, and update `CHECKPOINT.md` (what's done, what's next, any open question) after each commit. The file is git-ignored, so the commits are the durable record. **Every sub-agent prompt restates "commit after each item and update CHECKPOINT.md" verbatim.** Each reviewer gets its own worktree. No nested agents from a chip. A progress message goes out at each slice's review-ready point, merge and probe. If a session dies, the next one starts from the last commit and the checkpoint, and checks live state (git, open PRs, Linear) before doing anything.

---

## Adversarial review of this plan

The session model reviewed this plan, assuming it was wrong, against the spec, DECISIONS (F1, F7b, F8, Parts 2b and 2g), Susan's reply, `main`, PRs #23, #24, #28 and #45, the SYC-3 and SYC-121 plans, and Linear SYC-42, 43, 45, 68 and 73. Every finding is folded in above.

| # | Severity | Finding | What changed |
|---|---|---|---|
| R1 | Blocker | **The brief asked for an alert that wakes a human; the approved design forbids one.** Building it from the brief would have silently reversed F1 and three spec sections. | Raised as "A conflict to read first" and Decision 1. Nothing is built by default; Slice 1 doesn't depend on the answer. |
| R2 | High | **A hurt cat waiting unseen.** With no alert and no dashboard in Slice 1, a report whose email fails could sit nowhere anyone looks. Autoscale can sleep, so an in-server retry timer may never fire. | Three-layer sending (1.6), a scheduled drain every 10 minutes, and a drain that **fails loudly to Samuel through GitHub** when an alert is an hour late, a path that doesn't depend on Resend. Test 16 with a mutation probe. |
| R3 | High | **Reflected mailbomb** (review §2). Any reporter-email feature in Slice 1 would need verification that doesn't exist yet. | Decision 4: Slice 1 collects no reporter email, so it can't mail a stranger. The alert goes to one fixed address. Slice 3 adds email only with F7b verification, recipient limits and suppression. |
| R4 | High | **Report photo leaving the team.** The easiest "fix" for a broken photo in an email is a public link. | The photo is an attachment, report photos live in their own table, and every place the rule must hold is listed, with tests 9, 11 and 27. |
| R5 | High | **Saying "Sent" when nothing was sent.** A queued report showing the online confirmation would tell someone Syros Cats have it when they don't. | 1.12: "Sent" only after the server accepts the text. Test 20 with a mutation probe. |
| R6 | High | **"Works offline" overstated.** The website has no offline mode, so a fresh open with no signal shows nothing, which the spec's own wording didn't anticipate. | The offline table says so, the tester note avoids the claim, and a ticket is filed for an offline website shell. |
| R7 | Medium | **Copy contradicting onboarding.** Onboarding says "Picking one up, or feeding it, does it no favours"; the urgent block says to lure the cat with food and, as a fallback, lift it. F8 settled this by splitting the advice by situation, and the onboarding line itself says a hurt cat "is different". | No copy change (it's settled). Test 22 pins the cage-first order. #45's promise is tied to Slice 1 in the rollout (Decision 7). |
| R8 | Medium | **The unbacked promise.** If #45 publishes before Slice 1, web testers read "the app will tell you what to do" with nothing behind it. | Decision 7, and rollout step 6: no store build carries #45 without Slice 1. |
| R9 | Medium | **Abuse before Turnstile.** The report endpoint is public by design, and device ids are free to mint. | Before launch the pre-launch gate limits it to testers. Slice 4 (Turnstile, shared limits, a daily alert ceiling with digest) is a hard condition for removing the `/api` pass. |
| R10 | Medium | **The drain token as a new skeleton key.** Reusing the internal people token for a scheduled job would put a sign-in-critical secret in a second place. | A separate `MAIL_DRAIN_TOKEN` that opens one path only. Test 15 with a mutation probe. Stored only in GitHub and Replit secret stores. |
| R11 | Medium | **Reporter privacy in logs and after deletion.** Exact coordinates and device ids in request logs; a deleted spotter still linked to their reports. | 1.7 strips them from logs (test 19). `reporter_device` is nullable, and SYC-63 is asked to clear it on deletion (comment filed). |
| R12 | Medium | **Duplicate alerts.** The offline queue retries, and two servers can drain at once. | `client_ref` uniqueness and `SKIP LOCKED` (tests 13 and 14, each with a mutation probe). |
| R13 | Medium | **Building a second send function.** SYC-3's plan already designed one. | SYC-42 builds SYC-3's design first, under the same path and interface; one API key; SYC-3's tables reused in Slice 3. |
| R14 | Medium | **Hidden dependency on the unapproved data spine plan.** | Only Slice 5 depends on #23 (PR 2's `writeObservation`); stated, and Slices 0–4 go ahead without it. |
| R15 | Low | **Wrong number shown.** Dermitzaki's old pin points at Lazareta; Susan's Municipality number is grouped differently from the spec's. | Dermitzaki uses search links with no coordinates. The Municipality is shown as +30 22813 61000 (same digits). Test 4 checks every field. |
| R16 | Low | **Urgent block edited from settings without Samuel.** | Test 3 pins it; changing it needs a named approval. |
| R17 | Low | **SYC-68 is out of date** (Dermitzaki settled 28 Sep; the after-hours call test was dropped in Part 2b). | Comment filed on SYC-68. |
