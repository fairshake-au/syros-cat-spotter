# SYC-36 and SYC-48: the match-wait screen, with the feeding nudge and the starter facts (implementation plan, for Samuel's approval)

**Linear:** SYC-36 (feeding nudge) and SYC-48 (starter facts), from the spec ticket SYC-343 (Done). It also touches:
- SYC-360 (Syros Cats' answers) and SYC-350 (Google Play);
- SYC-346 and SYC-283 (Johnny's pack);
- SYC-66 (privacy policy) and SYC-109 (device ids in logs);
- SYC-345 (the launch-day checklist);
- SYC-53 (signed-in roles, later).

**Status:** written and reviewed on 15 October 2026, **awaiting Samuel's approval.** Nothing here is built, published or configured.

**Design (approved, not reopened here):** `docs/specs/feeding-nudge.md` and `docs/specs/starter-facts.md`, merged in PR #174 (commit `629fbea`), with their review `docs/specs/reviews/feeding-nudge-and-starter-facts-review.md`.

**The approval, and where it comes from.** Samuel approved both specs on 15 October 2026. The source is the transcript of the session "Spec the feeding nudge and the starter facts", where his message at 14:32 UTC reads "approved, review and merge". The 10 decisions came back through question prompts in that session between 14:24 and 14:30 UTC:

| # | Decision | Samuel's answer (quoted from the prompt result) |
|---|---|---|
| Nudge 1 | Where "Help feed a cat" goes | "Syros Cats' page (Recommended)" |
| Nudge 2 | Which figure | "€1 a day and €30 a month (Recommended)" |
| Nudge 3 | After the wait | "Move below the matches (Recommended)" |
| Nudge 4 | How often | First answer: "give me some other options. why not every spot for spotters? residents are the least likely to want to pay, so if anything I'm inclined for them to only see it once only". Then, on the revised question: "Full once, then a daily one-liner (Recommended)" |
| Nudge 5 | Offline | "No, nothing offline" |
| Nudge 6 | Counting link opens | "Yes, a bare count (Recommended)" |
| Facts 1 | Order | "Fixed start, then shuffled (Recommended)" |
| Facts 2 | Facts after the result | "No, it goes with the wait (Recommended)" |
| Facts 3 | Twenty or ten | "All 20, fall back to 10+10 (Recommended)" |
| Facts 4 | First spot | "Feeding nudge first (Recommended)" |

The same answers are recorded on SYC-36 and SYC-48 (comments of 15 Oct, 14:31 UTC). One rule in the spec wasn't one of these questions: the one-liner stops for good after a tap on **Help feed a cat** (`feeding-nudge.md` §3.2, condition 4). The spec says Samuel approved it with that rule in, and the SYC-36 comment notes he can drop it.

**Checked against:**
- `origin/main` at `8899205` (15 October 2026, after PR #181 and the SYC-161 plan merged).
- The launch plan on PR #172 (branch `claude/xenodochial-zhukovsky-df315f`, not yet approved): "Wave 1", the "Match-wait screen" row, and the calendar.
- Open PRs #146, #172, #178, #179, #180, #183, #184 and #185.
- Linear SYC-36, SYC-48, SYC-343 (all comments), SYC-350 and SYC-360.
- The Neon project `syros-cat-spotter`, by read-only queries on 15 Oct.

Every "exists today" claim names the file it was read in. An independent Sonnet review found 1 blocker and 7 major problems in the first draft. All are fixed here, and four became decisions for Samuel (§ "Review outcome").

---

## In plain English

**What a spotter sees.** They take a photo, confirm where the cat is and tap **Check for matches**. For the few seconds Cat Spotters takes to look, a card takes the place of the map, under the photo:

- **On their first spot**, it's the feeding nudge: why feeding street cats in summer leaves them hungry in winter, and that **€1 feeds a cat for a day, €30 for a month**. When the matches come back, the nudge moves below them, now with two buttons: **Help feed a cat** (opens Syros Cats' donation page in the phone's browser) and **Got it**.
- **On every other spot**, it's one short fact about cats, under *While we look…*: the clipped ear tip with its photo on the second spot, milk on the third, then the rest in a shuffled order, with no repeats until all have been seen.
- **Visitors** also get one line under the matches on their first spot of each later day: *"Please don't feed the cats. €1 feeds one for a day."*, with the same button. A visitor is a phone that hasn't claimed a cat and started spotting less than three weeks ago.
- **With no signal**, the sighting is saved on the phone as today, and nothing else shows.

**What can change without a new app.** Whether the donation button and figures show, which donation page it opens, and which facts are switched off. If Syros Cats haven't said yes by 22 October:
- the nudge ships without figures or a button;
- their unconfirmed facts are switched off;
- each switches on when they say yes.

**What gets counted.** Only how many times the donation button is tapped. Not who, not which phone, not where.

**The order.** A measuring step first, which needs your OK (Decision 2). Then two pull requests, one per publish slot in the launch plan:
- **PR 1, Fri 23 Oct:** the server side, and the facts during the wait.
- **PR 2, Mon 26 Oct:** the feeding nudge, everywhere it appears.

That splits the work slightly differently from the launch plan, for a reason given under "Small calls".

**Six decisions for you**, each with a recommendation:
1. Where the switches live.
2. How to measure the wait without touching the live site.
3. Letting the donation button work for testers before launch.
4. What a phone shows before it has ever loaded the switches.
5. Counting taps per day or as one total.
6. One switch or two for the button and the figures.

---

## Where the specs and the code on `main` disagree

The specs' decisions stand. These are places where carrying them out needs the plan to say something the specs didn't, because the code has moved on or the specs left it open.

| # | What the spec says | What is true on `main` | What this plan does |
|---|---|---|---|
| C1 | "The date of the earliest sighting the server holds for this phone" (`feeding-nudge.md` §3.2) | `sightings.created_at` is set from the **photo's capture time**, not when the server got it (`routes/sightings.ts:580-588`, `createdAt: capturedAt`). A photo picked from the library can be up to 21 days old (`lib/photoClock.ts:24`). Read naively, a tourist whose first spot is a three-week-old photo would count as a resident on day one | The first-spot date is the earliest **arrival** time of that phone's sightings: `photos.created_at`, set by the database on insert (`lib/db/src/schema/photos.ts:38`). The photos table has no foreign key from sightings, so the query is a LEFT JOIN with `COALESCE(photos.created_at, sightings.created_at)`, so a deleted photo never makes a resident look new. Checked on Neon, 15 Oct: real dates survived the move (earliest 22 Jul, latest 30 Sep 2026). A sighting saved offline arrives, and counts, when it's sent |
| C2 | "Has this phone claimed a cat? Claims are kept on the server" | There's no claims table. A claim is `cats.owner_device_id` plus a `life_status` / `homed` observation with `authority_scope = 'owner_of_this_cat'` and the device (`lib/db/src/schema/cats.ts:34`; `newestActiveOwnerHomed`, `lib/claiming.ts:154`). Letting a cat go clears the owner and adds a **withdrawing** row; the original `homed` row keeps its device id (`routes/cats.ts:540`; `clearOwner`, `lib/claiming.ts:228`) | "Has claimed" means **has ever claimed**: any such `homed` row for this device (index `observations_device_idx`). Someone who let their cat go still lives here. Small call 2, with a let-go test |
| C3 | "The app settings endpoint … switched off without [an app update]" (`starter-facts.md` §9; `feeding-nudge.md` §9) | No settings store exists. The Help tab's campaign is read from **server environment variables** on every request (`lib/campaign.ts:59-80`, `CAMPAIGN_*`), changed by editing them in Replit and publishing (`docs/DEPLOYMENT.md:51`) | Decision 1 |
| C4 | "Signed in as a cat guardian or Syros Cats team member … once those sign-ins exist" | The app has no such sign-in. There's no role, guardian or team flag anywhere in `artifacts/cat-spotter/app`, `context` or `lib` (searched 15 Oct). Team sign-in exists only on the server's dashboard (`middlewares/requireTeam.ts`) | The schedule takes `signedInRole`, which is always `null` at launch. Its tests (nudge test 14) are written now. SYC-53's app work fills it in, and a follow-up ticket says so |
| C5 | "The map is locked during that time anyway" (`starter-facts.md` §3.1) | `LocationPicker` gets no disabled prop while sending (`spot.tsx:1017-1020`). The pin itself is safe: the send copies `pickedCoords` at the start (`spot.tsx:492`) | Doesn't matter once the card replaces the map. The map comes back with the same pin if the send fails, because the pin is screen state, not the map's |
| C6 | The record holds "the date of this phone's first spot" (`starter-facts.md` §3.4) | The later text (`feeding-nudge.md` §3.2 and §9) moved both resident signals to the server, so they survive a wiped browser | The phone's record doesn't store a first-spot date. The server's answer is kept with the settings, so the last one seen is used offline |
| C7 | The card shows "while a sighting is sending" | `setSubmitting(true)` covers the offline save too (`spot.tsx:494-495`). On a slow connection there's an "Optimising photo…" step before the upload (`spot.tsx:513-520`) | The card is driven by a new `waiting` flag, set when the **send** starts, so an offline save never shows it. It's cleared in the existing `finally` (`spot.tsx` after the outcome switch), so the map doesn't flash back while the photo is saved for the result screen. The optimising step counts as part of the wait |
| C8 | The result screens "get the nudge … keyed by the sighting, so it appears on the first result screen only" | `review.tsx` also opens for a **queued** sighting matched later in the background (`spot.tsx:634-646`, `reviewPending`, by `localId`). Naming a new cat is reachable from the match list through "None of these — it's new!" (`review.tsx:512`, `showNewCat`). Naming, the picker and the reward screen are all state toggles inside one component | The record carries `pendingResult`, written only after a live send that came back with a cat. `review.tsx` shows the nudge or one-liner only when its `sightingId` matches, and only on the screen it opened on. A queued sighting never matches. Details in PR 2 |
| C9 | The one-liner may show "on the first … result screen of the Athens day" | `CAMPAIGN_TIMEZONE` (`lib/campaignDates.ts:9`) and `GREEK_TIME_ZONE` (`lib/photoClock.ts:29`) exist, but no "Athens date of this instant" helper | PR 1 adds `athensDay(instantMs)`, reusing the existing zone constant, tested across both daylight-saving changes |
| C10 | "Opens {host} in your browser" (`campaignOpensAt`) | Exists in all three languages (`lib/i18n.ts:454`, `:1012`, `:1560`) | Reused. `{host}` is the **donation page's** host (syroscats.com), not the counting address the button opens first |
| C11 | A tap opens "a Cat Spotters address that counts the open and redirects" (`feeding-nudge.md` §9) | Until launch day the server answers almost everything with `401 prelaunch_pass_required` unless the browser carries the website's pass (`middlewares/prelaunchGate.ts:84-122`; only health, `/api/internal`, `/api/team` and `/api/mail` are exempt). The phone's own browser doesn't carry it | Decision 3 |
| C12 | "The app settings response … includes a yes/no for this phone" | Device ids in a web address are written to the request log unless the address is on the redaction list (`lib/logger.ts:61-62`: `profiles`, `notifications`, `profile`, `keep-safe`). SYC-109 treats the id as a credential | `app-settings` is added to that list in the same PR, with a case in `app.logRedaction.test.ts` |

---

## Decisions for Samuel

Six, each with a recommendation. 1, 2 and 3 matter most. 4, 5 and 6 are small, and the recommendation is what the plan assumes unless you say otherwise.

### Decision 1: Where the switches live, and who flips them

**The question.** Three things must be changeable without a new app:
- whether the donation button and figures show;
- which donation page the button opens;
- which facts are switched off.

Syros Cats' answers (due Mon 19) decide the launch values, and they may say yes to more later. Where should those switches live?

| Option | Who flips a switch, and how | Good | Bad | What a spotter notices |
|---|---|---|---|---|
| **A. Server settings, like the Help tab's donation campaign today** *(recommended)* | The switch is a setting on the server. Changing it means editing the setting and publishing the server again | Same way the campaign already works. Nothing new to build for the switches themselves. Fits the two build days. Switches are rare: once before 23 Oct, then once per "yes" from Syros Cats | Every change needs your pull-and-publish step, the same as any other release of the server. The last publish before launch is Thu 29 Oct, so a "yes" that arrives on the 30th goes live after launch. **Unchecked:** whether Claude can change a server setting itself, or needs you to type it in. Syros Cats can't flip anything themselves | Nothing. Phones pick a change up the next time the app opens with a signal |
| B. A settings page on the team dashboard | Syros Cats staff tick boxes on team.catspotters.com | They control their own words and link, with no publish | A third PR, a database table and a new dashboard page, in files four other sessions are changing this week. Doesn't fit 23 and 26 Oct | Same |
| C. A small table in the database that Claude edits | Claude changes one database row, with your OK each time | No publish needed | Each change to the live database needs you to switch the session to "ask" mode first. A database change for a handful of switches | Same |

**Recommendation: A**, with B filed as a follow-up for after launch, if Syros Cats want to manage it themselves.

### Decision 2: Measuring how long the wait is, without touching the live site

**The question.** The spec asks for the typical wait and the slow end (the time half of sends beat, and the time nine in ten beat) before building, and says to come back to you if the typical wait is under 2 seconds. Here's what I could check today (15 Oct):

- **The database can't answer it.** The main copy of the database has 52 sightings, the newest from 30 Sep, and no match records at all, so there's nothing to time.
- **The server writes a time for every request** to its own log, but that's only the server's share. Whether Claude can read those logs is **unchecked**, and nobody has spotted since 30 Sep, so there'd be little to read anyway.

Every real measurement means sending sightings somewhere, so it needs your OK.

| Option | What happens | Good | Bad | What a spotter notices |
|---|---|---|---|---|
| **A. A run on this Mac, against a temporary copy of the database** *(recommended)* | Claude makes a temporary copy of the database inside your Neon account, runs the server on this Mac against it, and sends 10 existing cat photos through the real matching service, timing each. Upload time is added as an estimate from the photo sizes. The copy is deleted the same day | Nothing touches the live site or its data. Uses the real matching service, which is most of the wait. Done before PR 1 | The Mac's speed and network differ from the live server's, so it's a guide, not the live number. With 10 sends, "nine in ten" is just the second-slowest. Making the copy needs you to switch the session to "ask" mode. **Unchecked:** whether the matching key works from this Mac. Costs about 10 matching calls | Nothing |
| B. Real spots on the live test site | Someone on Syros makes 5–10 real spots with a stopwatch | The truest number | You're away. It depends on a tester being on the island this week | Nothing |
| C. Don't measure first; read the server's own log after launch | The first week's times are read after 31 Oct, if the logs can be read | No work now | The spec's "come back to you if it's under 2 seconds" check happens after launch, not before | Nothing |

**Recommendation: A now, and C after launch.** The design doesn't wait on the number. Facts only count as seen after 3 seconds on screen, so a short wait just means facts come round again. The number decides one thing: if the typical wait is under 2 seconds, I'll bring it back to you before PR 2.

### Decision 3: Letting the donation button work for testers before launch

**The question.** Until launch day, the live server only answers phones and browsers that carry the testers' pass. The app carries it, but **Help feed a cat** opens the phone's own browser, which doesn't. So from 26 Oct until the pass comes off on 31 Oct, a tester tapping the button would see an error page instead of Syros Cats' donation page.

| Option | What a tester sees before 31 Oct | Good | Bad |
|---|---|---|---|
| **A. Let that one address through the pass** *(recommended)* | The button works: their browser opens Syros Cats' page | Testers can check the whole flow before launch. Launch day has one less thing to go wrong. The address can only ever forward to the one https page in the server's settings, so letting it through reveals nothing | It's a change to the pre-launch protection, so it gets its own test that nothing else got through |
| B. Leave the pass as it is | An error page after tapping the button | No change to the protection | The first real tap happens on launch day, in front of real visitors. Testers may report it as a bug |

**Recommendation: A.** Either way, a real tap on the live site goes on the launch-day checklist (SYC-345), straight after the pass comes off.

### Decision 4: What a phone shows before it has ever loaded the switches

**The question.** A phone gets the switches the first time the app opens with a signal. Until then, the spec says, nothing is hidden: every fact shows, including the nine that need Syros Cats' yes (for example "On Syros it's usually the left ear"). Normally that's a matter of seconds, but a phone first opened with no signal could show an unconfirmed fact.

| Option | What that phone shows | Good | Bad |
|---|---|---|---|
| **A. Hide the nine sign-off facts until the switches have loaded once** *(recommended; changes the spec's default)* | Only facts that never need Syros Cats' yes | The app never says something in Syros Cats' name that they haven't confirmed | A small change to an approved spec |
| B. As the spec says: nothing hidden | Any fact | Exactly the spec | An unconfirmed fact can show, rarely |

**Recommendation: A.** It's the same rule as the spec's own "switched off until they say yes", applied to a phone that hasn't heard yet.

### Decision 5: Counting taps per day, or as one total

**The question.** You approved "a bare count" of taps on **Help feed a cat**. The plan keeps one number for each day (Athens time). A date isn't about a person, but it is more than one total, and the privacy policy sentence changes with it.

| Option | What's kept | Good | Bad |
|---|---|---|---|
| **A. One number per day** *(recommended)* | For each day: how many taps | Shows whether the nudge works better in July than in October, and whether a change to the words made a difference | Slightly more than "one number" |
| B. One running total | A single number | Exactly "a bare count" | Can't tell when taps happened, or whether anything changed them |

Either way: no phone, address, name or place is kept. The counting address has **no rate limit**, because our rate limiter keeps a scrambled fingerprint of the internet address for up to two days (`middlewares/rateLimit.ts`), which would make "nothing about who" untrue. The cost: someone could inflate the number by tapping again and again, and a slow database at the moment of a tap means that tap isn't counted. It's a number for Syros Cats and you, not money.

**Recommendation: A.**

### Decision 6: One switch for the button and the figures, or two

**The question.** Syros Cats are asked two separate things: can the app say "€1 a day, €30 a month", and can the button open their donation page. The spec has two forms of the nudge only: figures and button, or neither (§5.2).

| Option | If they say yes to one but not the other | Good | Bad |
|---|---|---|---|
| **A. One switch: both or neither** *(recommended)* | The nudge stays words-only until both are yes | Exactly the spec's two forms; nothing new to write or translate | A yes to the figures alone doesn't show the figures |
| B. Two switches | Figures without a button, or a button without figures | Uses every yes straight away | Needs new in-between wording, which would miss the copy freeze on 22 Oct |

**Recommendation: A.** If their answers come back split, I'll bring it to you.

### Small calls this plan makes (object to any, otherwise they stand)

1. **The split between the two PRs changes slightly from the launch plan.** The launch plan's PR 1 is "settings, the tap count and the card". If the card showed the nudge on Fri 23 but the result screen only arrived on Mon 26, nothing would ever count it, so every spot over that weekend would show it again. So:
   - **PR 1 ships the facts during the wait**, and all the server pieces, including the tap-count table.
   - **PR 2 ships the nudge everywhere.**

   Same two publish slots, same migration slot. PR 1 therefore carries some code nothing uses until PR 2: the signals route, the nudge's words, and the nudge branch behind a switch that's off in the code.
2. **"Has claimed a cat" means "has ever claimed one"** (C2). Letting a cat go doesn't make you a visitor again.
3. **If the server's fact setting is missing, the nine sign-off facts are hidden.** A forgotten setting should hide unconfirmed facts, not show them. Showing all of them takes an explicit `none`.
4. **The ear-tip photo** is the existing `EAR_TIP_EXAMPLE_PHOTO` (`lib/earTipExample.ts:16`), not a copy, as the spec says.
5. **An out-of-date phone.** If a phone still shows the button after the link has been switched off, tapping it shows a short plain page from the server ("This link isn't available. The Help tab in the app shows how to give.", Appendix B) and counts nothing. The phone is out of date only until its next start with a signal.

---

## How it ships: the order

| Step | What | When | Who | Needs |
|---|---|---|---|---|
| M0 | Measure the wait (Decision 2) | After your OK, before PR 1 | Claude | Decision 2; "ask" mode for the database copy |
| PR 1 | The server pieces and the facts during the wait | Built 19–22 Oct, **published Fri 23 Oct** | Sonnet build, Sonnet review | This plan approved; migration number agreed with live sessions after rebasing |
| Settings | Launch values: donation page on or off, hidden facts, from Syros Cats' answers (SYC-360) | Set before the Fri 23 publish, so they go live with it. No publish of their own | Claude prepares them; whoever can enter server settings enters them (Decision 1, unchecked) | Decision 1 |
| PR 2 | The nudge: wait, result screen, one-liner, button, count | Built 22–25 Oct, **published Mon 26 Oct** | Sonnet build, Sonnet review | PR 1 live; Decision 3 |
| Words | Johnny's Greek and French corrections | Back Tue 27; applied in the launch plan's single corrections PR on **Wed 28** (feature freeze); live with the Thu 29 final publish | Haiku edit, Claude checks | The launch plan's existing slot |
| Launch | A real tap on **Help feed a cat** on the live site, and a check that the tap count went up by one | 31 Oct, after the testers' pass comes off | Claude | SYC-345 checklist |

**If time runs short, this drops first:**
1. The visitors' daily one-liner moves to the first week of November. The full nudge and the facts still launch.
2. Then the nudge's result-screen buttons: the nudge launches words-only, in its no-link form, pointing to the Help tab.
3. The facts and the server pieces (PR 1) don't drop. They're what everything else stands on.

---

## M0: measuring the wait (only with your OK)

1. One line of warning to you first: it creates a temporary database copy and spends about 10 matching calls. You switch the session to "ask" mode.
2. Create a Neon branch from the main branch, named `measure-send-time-YYYYMMDD`.
3. Run `artifacts/api-server` locally against it, with the matching key from the existing local environment (never printed). If that key isn't available locally, stop and say so.
4. Send 10 existing photos of different cats, one at a time, through `POST /api/sightings` with a test device, timing each response.
5. Add an estimated upload time: each photo's size at 5 and at 1 Mbit/s upload, two figures, labelled as estimates.
6. Delete the branch, and probe that it's gone.
7. Post the median and the second-slowest of the 10 (server, and server plus estimated upload) on SYC-36, with the raw times. If the typical total is under 2 seconds, bring it to you before PR 2.

---

## PR 1: the server pieces, and the facts during the wait (Fri 23 Oct)

**In plain English.** The server learns three new things: what the switches are, whether this phone looks like a resident's, and how to count a tap on the donation button. The app learns the twenty facts in three languages, and shows one in place of the map while a sighting sends. The feeding nudge's words go in, but it doesn't show yet.

### Server (`artifacts/api-server`)

- **`GET /api/app-settings`** (new, `routes/appSettings.ts`). Public, no device needed. It reads the server's settings on each request, as `getCampaign()` does:
  - `FEED_NUDGE_DONATE_URL` is the donation page. It goes through the existing `sanitizeDonateUrl` (`lib/campaign.ts:35-46`), which allows https only and otherwise returns empty. **Empty means the link and figures are off** (`feeding-nudge.md` §5.2; Decision 6).
  - `STARTER_FACTS_HIDDEN` is a comma-separated list of fact ids. Unknown ids are ignored and logged once. If it's unset, the nine sign-off ids are hidden (small call 3). `none` means nothing is hidden.
  - The response is `{ feedNudge: { donateHost: "syroscats.com" } | null, hiddenFacts: string[] }`, sent with `Cache-Control: public, max-age=300`. The full donation address isn't sent, because the app opens the counting address.
- **`GET /api/app-settings/:deviceId/signals`** (new, same file). It uses `verifyDeviceSecret(req, res, id, { bind: false })` (`lib/deviceAuth.ts:86`), so asking never binds a new phone or uses up the new-device allowance. It returns:
  - `hasClaimedCat`: whether any `life_status` observation exists for this device with `value->>'status' = 'homed'` and `authority_scope = 'owner_of_this_cat'`, withdrawn or not (C2).
  - `firstSpotDate`: the Athens date of `MIN(COALESCE(photos.created_at, sightings.created_at))` over this device's sightings, with photos LEFT JOINed (C1). It's `null` if the device has none.
  - `Cache-Control: private, no-store`.
  - A phone that has never bound a secret gets **403** "Device secret does not match" (`deviceAuth.ts`, the no-row case). A deleted identity gets **410**. The app reads both as "unknown". Only `403 device_moved` means a moved phone (`lib/deviceMoved.ts:9`), so this route must never trigger the moved-phone screen.
  - It's rate limited with a new `sharedLimiter` bucket (`middlewares/rateLimit.ts`), 60 requests per 15 minutes per address. The existing limiter's privacy note already covers that.
  - **The path is added to the log redaction list** (`lib/logger.ts:61-62`), with a case in `app.logRedaction.test.ts` (C12).
- **`GET /api/go/feed`** (new, `routes/go.ts`):
  - It adds one to today's count (Decision 5) and answers `302` to `FEED_NUDGE_DONATE_URL`, with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
  - The count is best effort. If the database write fails or takes more than 500 ms, it logs and redirects anyway. **The redirect never fails because of the count.**
  - If no donation page is set, it answers a short plain page in the visitor's language (Appendix B, chosen from `Accept-Language`) and counts nothing (small call 5).
  - Only `GET` counts. `HEAD` (link previews) is answered without counting. Express sends HEAD to GET handlers, so the method is checked explicitly.
  - It has no rate limiter (Decision 5), and it reads and keeps no query string. Its log line carries no IP: the serializers keep only id, method and the redacted address (`app.ts:30`). `req.ip` is used only by the limiters.
  - `FEED_TAP_COUNT=off` stops the count and keeps the redirect, so a "no" from Syros Cats to counting (their question 5) needs no new code.
  - **The pre-launch gate** (Decision 3 A): `middlewares/prelaunchGate.ts` lets exactly `GET` and `HEAD` on `/api/go/feed` through, beside the health check. A gate test proves that, and proves that `/api/go/feed/x`, `/api/go`, `POST /api/go/feed` and `/api/app-settings` are still gated.
- **The table**, migration name `donation_link_taps`. The number is taken after rebasing and agreed with the live sessions first, never picked by hand. 0025 is on `main` today, so it's 0026 or higher. The table is `donation_link_taps (day date primary key, taps integer not null default 0)`; with Decision 5 B it would be a single row instead. Each tap runs `INSERT … ON CONFLICT (day) DO UPDATE SET taps = donation_link_taps.taps + 1`. The schema goes in `lib/db/src/schema/donationLinkTaps.ts`, exported from `schema/index.ts`. It's generated with drizzle-kit, with a commented rollback block (`lib/db/migrations/README.md`), following `0021_rate_limit_counters.sql`.
- **OpenAPI and client:** the routes go in `lib/api-spec/openapi.yaml`, and the client is regenerated (`lib/api-client-react`). `/api/go/feed` is documented but not called by the client; it's a link.

### App (`artifacts/cat-spotter`)

- **`lib/starterFacts.ts`** (new): the twenty facts, listed once, each with `id`, `strand`, `core`, `signOff` and `photo` flags, reading their words from `lib/i18n.ts`. The ids are `fact.earTip`, `fact.litters`, `fact.disease`, `fact.backHome`, `fact.vacuum`, `fact.cost`, `fact.milk`, `fact.leftovers`, `fact.water`, `fact.hiss`, `fact.dontPickUp`, `fact.kittensAlone`, `fact.tortie`, `fact.whiteBlue`, `fact.slowBlink`, `fact.tailUp`, `fact.purr`, `fact.kittenEyes`, `fact.colonyFemales` and `fact.cantTell` (facts 1–20, in the spec's order).
- **`lib/i18n.ts`**: the facts, the card's words and **all the nudge's words** (unused until PR 2), in all three languages, word for word from Appendix A. In French and Greek, non-breaking spaces go inside « », before « ? : ; ! » in French, and between a number and €, as the spec says.
- **`lib/athensDay.ts`** (new): `athensDay(instantMs) → 'YYYY-MM-DD'` and `athensDaysBetween(a, b)`, using `Intl` with the existing Athens zone constant, never a fixed offset.
- **`lib/waitingCard.ts`** (new): the pure schedule, with no React and no storage:
  - `shouldShowWaitingCard({ waiting })` decides whether the card replaces the map.
  - `chooseForWait(record, settings, ctx)` returns `{ kind: 'nudge', form: 'full' | 'noLink', countable }` or `{ kind: 'fact', id }`. In PR 1 the nudge branch is behind `NUDGE_ENABLED = false`.
  - `settleWait(record, shown, outcome, shownMs)` returns the new record. The outcome is one of:
    - `result`: sent, with a cat;
    - `notCat`;
    - `failed`: the send failed or was refused, the spotter chose save for later, or nothing was saved.
  - `chooseForResult(record, settings, signals, ctx, { sightingId, localId, screen })` returns `'nudge' | 'line' | null`. It's used from PR 2.
  - The rules are `starter-facts.md` §3.2 and `feeding-nudge.md` §3.2, conditions 1–6, word for word, plus these edge cases:
    - With one fact switched on, it repeats. With none, the card shows only *While we look…*.
    - A stored order drops ids that no longer exist or are hidden, and adds new ids at random places.
    - Signals loaded with `firstSpotDate: null` mean "no spots yet", so the phone is a visitor whose first spot is today.
    - Signals that are unknown, or that failed with a 403 or 410, mean no one-liner.
    - Before the switches have ever loaded, the sign-off facts are hidden (Decision 4 A).
- **`lib/waitingCardStore.ts`** (new): one record per device id in AsyncStorage, under `catSpotters.waitingCard.v1` (localStorage on the website, as AsyncStorage already does there). Every read and write is in try/catch. If the record can't be read, `chooseForWait` gets `null`: it shows a fact, never the nudge, and writes nothing (no `pendingResult` either) for that wait. The fields are `nudgeCounted`, `nudgeCountedDay`, `lastLineDay`, `tapped`, `seenFacts`, `order`, `lastFactId` and `pendingResult: { sightingId, nudge: 'full' | 'noLink' | null, countable }`.
- **`context/AppSettingsContext.tsx`** (new, wired into `app/_layout.tsx`): fetches the switches and this phone's signals:
  - when the app starts;
  - when it comes back to the foreground;
  - when the connection returns;
  - after a claim succeeds;
  - when the device id changes.

  It keeps the last answers in AsyncStorage (`catSpotters.appSettings.v1`), so a phone that has been online once knows them offline. Everything it holds is keyed by device id and reset when the id changes (after "Delete my data" or a restore). A successful claim sets `hasClaimedCat` locally at once (`feeding-nudge.md` §3.2). A first successful send sets `firstSpotDate` to today if it was `null`. If the switches have never loaded, the link is off, the sign-off facts are hidden (Decision 4 A), and the signals are unknown.
- **`components/WaitingCard.tsx`** (new): the card, as `starter-facts.md` §3.5 and `feeding-nudge.md` §4 describe:
  - The eyebrow, the fact text, and for the ear-tip fact the photo at 2:1 with `earTipExampleAlt`.
  - When it appears, it announces `waitingFactA11yLabel` (or `feedNudgeA11yLabel`) through `AccessibilityInfo.announceForAccessibility` and leaves focus on the button.
  - With reduce motion on, it appears without a transition.
  - It reports how long it was on screen, counting only time while the app is in the foreground.
- **`app/(tabs)/spot.tsx`**: a `waiting` flag is set at the start of the `send` callback and cleared in the existing `finally`, so it's never set on an offline save (C7). While it's set, `WaitingCard` takes the place of the `LocationPicker` block (`spot.tsx:1017-1020`). The outcome is taken when `send` returns, and `settleWait` runs:
  - `sent` with a cat settles as `result`;
  - `sent` with no cat settles as `notCat`;
  - everything else settles as `failed`.

  On `sent` with a cat, `pendingResult` is written before `router.push` to `/review`.
- **`context/DeleteMyDataContext.tsx`**: `wipePhone` also removes both keys, and the in-memory state resets with the new device id.

### PR 1 tests

The app's test setup runs `lib/**/*.test.ts` and `.test.tsx` under `context`, `components` and `hooks`, in a `node` environment (`vitest.config.ts:15-22`). Screens in `app/` aren't rendered in tests; the repo checks them by reading the source (`lib/__tests__/spotRetake.test.ts`). So each test is one of three kinds:

- **Pure:** the rules, in `lib/__tests__/`.
- **Component:** in `components/__tests__/`, following the existing component tests.
- **Source scan:** a check that the code in a screen is in the right place and order. This is **the weak kind**, because it can't see the screen, so the browser-pane check backs each one up.

All 13 of `starter-facts.md` §9.1, numbered as the spec:

| Spec test | Kind and where |
|---|---|
| 1 Order: the nudge (switch on), fact 1 with its photo, fact 7, then shuffled | Pure, `lib/__tests__/waitingCard.test.ts` |
| 2 No repeat until every switched-on fact is seen; a reshuffle never starts with the last one seen; with one fact, it repeats | Pure, same |
| 3 Under 3 seconds isn't seen; time in the background doesn't count | Pure, same; component, `components/__tests__/WaitingCard.test.tsx` |
| 4 No cat, a failed send, or save for later: nothing marked, and the next wait shows the same item | Pure, `waitingCard.test.ts` |
| 5 Offline save: no card, record unchanged | Pure (`shouldShowWaitingCard`, `settleWait`); source scan of `spot.tsx` that `waiting` is set only inside `send` (weak) |
| 6 A hidden fact never shows, including 1 and 7, and the rest still rotate | Pure, `waitingCard.test.ts` |
| 7 Nothing about facts on the result screens | Source scan of `review.tsx` (weak); browser-pane check |
| 8 Unreadable record: a fact, never the nudge, nothing written, no `pendingResult` | Pure, `lib/__tests__/waitingCardStore.test.ts` |
| 9 Delete my data removes the record and resets the in-memory state | `lib/__tests__/deleteMyData.test.ts` extension |
| 10 All twenty facts and the card's words in three languages | The existing parity test, `lib/__tests__/i18n.test.ts` |
| 11 Every fact is 35 words or fewer in each language, by the spec's word rule | Pure, `lib/__tests__/starterFacts.test.ts` |
| 12 Fact 20's quoted label matches `earTipCantTell` after normalising quotes | Pure, same |
| 13 The card's top is in view at 375 × 667, at default and largest text, in three languages, ear-tip fact included | Source scan that the card sits where the map was, not after the button (weak); the browser-pane check (the real test) |

Plus these:

- **The words match the spec.** `starterFacts.test.ts` reads `docs/specs/starter-facts.md` §4 and checks each language's string in `i18n.ts` against it, after normalising non-breaking spaces. A change to the wording has to change both.
- **Athens days** (`lib/__tests__/athensDay.test.ts`): including 25 Oct 2026 (clocks go back) and 28 Mar 2027.
- **Settings and signals on the phone** (`context/__tests__/AppSettingsContext.test.tsx`):
  - re-fetched on foreground, on reconnect, after a claim and on a device id change;
  - a claim sets `hasClaimedCat` at once;
  - a 403 or 410 gives "unknown" and doesn't touch the moved-phone flow;
  - never-loaded switches hide the sign-off facts.
- **Server tests** (`routes/appSettings.test.ts`, `routes/go.test.ts`, the gate's tests, `app.logRedaction.test.ts`):
  - The donation page unset, invalid (`http:`, `javascript:`) and valid.
  - Hidden facts unset (the nine sign-off ids), `none`, and with an unknown id.
  - Signals: no sightings; a first arrival 20 and 21 days ago gives the right Athens date; a sighting captured 20 days before it arrived uses the arrival (C1); a sighting whose photo row is gone still counts (C1); claimed then let go is still `true` (C2); a wrong secret is 403; a never-bound phone is 403 and isn't bound; a deleted phone is 410; the device id is redacted from the log line.
  - The redirect:
    - counts once per GET, not on HEAD; two taps on one day make 2;
    - still answers 302 when the database write throws;
    - with no page set, answers the plain page and counts nothing;
    - with `FEED_TAP_COUNT=off`, counts nothing;
    - carries `no-store`.
  - The gate lets exactly `GET`/`HEAD /api/go/feed` through and nothing next to it.
- **Migration:** CI's `migrate:check` and the db package's up/down/up test.

**Mutation probes.** These guard against silent failures, so a green test run isn't enough. Break the site, confirm the named test goes red, then restore:

1. Use `sightings.created_at` instead of the photo's arrival → the C1 capture-time test goes red.
2. Use an inner join on photos → the deleted-photo test goes red.
3. Count a fact as seen at 0 seconds → spec test 3 goes red.
4. Make `shouldShowWaitingCard` true whenever `submitting` → spec test 5's pure test goes red. Then move `setWaiting(true)` before `submitSighting` → the source scan goes red.
5. Make the redirect wait for the count and fail with it → the "write throws" test goes red.
6. Set the server default for hidden facts to "nothing hidden" → the unset-setting test goes red.
7. Remove `app-settings` from the redaction list → the log test goes red.
8. Widen the gate exemption to `isUnder('/api/go')` → the gate test for `/api/go/feed/x` goes red.

**Browser-pane check**, with the PR: the spot flow on the local web build, with data, at about 390 px and at desktop width, in English, Greek and French, at the default and the largest text size. It covers the ear-tip fact with its photo and one long fact (fact 13 in Greek), plus an offline save, which must show no card. Screenshots go on the PR.

---

## PR 2: the feeding nudge (Mon 26 Oct)

**In plain English.** The nudge appears on a phone's first spot, moves below the matches when they come back, and gets its two buttons there. Visitors get the one-line reminder on later days. **Help feed a cat** goes through the counting address to Syros Cats' page, in the phone's own browser.

- **`lib/waitingCard.ts`**: `NUDGE_ENABLED` is removed. The nudge comes first when it hasn't been counted yet and `signedInRole` is `null` (`feeding-nudge.md` §3.2). If the switches have never loaded, it shows the no-link form and is **not countable**. `pendingResult` records the form and whether it's countable at the wait, so the result screen shows the same form the wait did, even if the switches load in between.
- **`components/FeedNudge.tsx`** (new) has three variants: `wait`, `result` and `line`.
  - **The full nudge:** `feedNudgeTitle`, `feedNudgeWhy`, `feedNudgeInstead` (or `feedNudgeInsteadNoLink`), and `feedNudgeEuro` when the link is on.
  - **The one-liner:** `feedNudgeLine`.
  - **Buttons** appear only in the `result` and `line` variants:
    - **Help feed a cat**: secondary style, with `campaignOpensAt` and the donation host beneath.
    - **Got it**: quiet, on the full nudge only.
  - The buttons sit side by side where they fit, and stack on narrow screens and at large text. Both are at least 44 × 44, and both can be reached by keyboard on the website.
- **`app/review.tsx`**: the nudge or one-liner is decided once, when the screen first renders. It needs `pendingResult.sightingId` to match this sighting, no `localId`, and the screen opened on the match list, or on naming when there are no candidates.
  - **Where it goes:** on the match list, after the "None of these — it's new!" card and before `NeedsHelpLink` (`review.tsx:819-855`). On naming, after the name field and its button.
  - **When it's counted:** as it appears. The full nudge sets `nudgeCounted` and `nudgeCountedDay`, unless it isn't countable. The one-liner sets `lastLineDay`. Then `pendingResult` is cleared.
  - **How long it stays:** visibility is component state in `review.tsx`. It stays until **Got it**, **Help feed a cat**, or leaving the screen. Going from the match list to naming hides it. Coming back with the back arrow shows it again, because it's the same component and the state is kept, until it's dismissed. It never appears on the reward screen. A reload of the page (on the website) or a fresh mount doesn't bring it back, because `pendingResult` is gone. That's intended.
  - **The no-cat screen** (`review.tsx:382`) never reads `pendingResult` and leaves the record alone.
- **The button** opens `` `${apiOrigin()}/api/go/feed` `` (`lib/urls.ts:15`) with `Linking.openURL`, as the Help tab opens its donation link (`app/(tabs)/help.tsx:78-97`), and sets `tapped`. It never opens a page inside the app (Apple 3.2.2(iv)). The sighting is already saved, so leaving the app loses nothing.
- **Privacy policy** (`docs/specs/privacy-policy.md`, SYC-66): one sentence under "What we collect if you say nothing" (Appendix B).

### PR 2 tests

All 19 of `feeding-nudge.md` §9.1, numbered as the spec:

| Spec test | Kind and where |
|---|---|
| 1 New phone, switches loaded, link on: the first wait shows the full nudge's words, no buttons | Pure, `waitingCard.test.ts`; component, `components/__tests__/FeedNudge.test.tsx` (the `wait` variant has no buttons) |
| 2 Placement below the matches, "None of these" and "Find the cat yourself", above "This cat needs help"; on naming, below the name form; both buttons; counted | Pure (`chooseForResult` returns `'nudge'` and the record is counted); source-order scan of `review.tsx` (weak); browser-pane check |
| 3 Never on the no-cat screen, nothing counted | Pure (`screen: 'notCat'` returns `null`); source scan |
| 4 A rejected photo, a failed send, or save for later doesn't count; the next wait shows it again | Pure |
| 5 Once counted, never again | Pure |
| 6 On the day it's counted, no one-liner, even on a later spot | Pure |
| 7 The next Athens day: the first match list or naming shows the one-liner, and a second spot that day doesn't; that wait shows a fact | Pure |
| 8 A no-cat result or failed send as the day's first spot doesn't use up the one-liner | Pure |
| 9 Counted at 23:58 Athens time, a spot at 00:05 shows the one-liner, including on a daylight-saving day | Pure, fixed instants on 24–25 Oct 2026 and 28–29 Mar 2027 |
| 10 No one-liner when `hasClaimedCat` is true; none at 21+ days; one at 20 days | Pure |
| 11 No one-liner when the switches have never loaded | Pure |
| 12 No one-liner after a tap on **Help feed a cat** | Pure |
| 13 No one-liner when the link is off | Pure |
| 14 Signed in as a guardian or team member: neither | Pure (`signedInRole: 'guardian'` and `'team'`) |
| 15 An offline save shows nothing and changes nothing; matched later in the background, still nothing | Pure (`settleWait`; `chooseForResult` with a `localId` returns `null`) |
| 16 Link off: the no-link form, counted. Switches never loaded: the same form, not counted | Pure; component (the form has **Got it**, no figures, no **Help feed a cat**) |
| 17 After the phone's record is wiped, a resident still gets no one-liner | Pure (cleared record, resident signals) |
| 18 Card top visible at 375 × 667 in three languages; buttons stack at the largest text; both at least 44 × 44 | Component (the stacking rule and the minimum sizes); browser-pane check |
| 19 All keys in three languages | The existing parity test |

Plus these:

- A queued sighting opened from the Spot tab never shows the nudge or the line (C8). This is pure: a `localId` returns `null`.
- Naming reached from the match list doesn't show it. This is pure (`screen` is where it opened), plus a source scan.
- A `pendingResult` for one sighting doesn't show on another sighting's screen.
- Switches that load between the wait and the result keep the wait's form.

**Mutation probes:**

1. Count the nudge when the wait starts, instead of on the result screen → spec tests 4 and 16 go red.
2. Treat unknown signals as a visitor → spec test 11 goes red.
3. Compare days in UTC → spec test 9 goes red.
4. Drop the `sightingId` / `localId` check in `chooseForResult` → the queued-sighting test goes red. Then move the call in `review.tsx` above the matches → the source-order scan goes red.
5. Forget `tapped` → spec test 12 goes red.

**Browser-pane check:** the first spot (the nudge in the wait, then below the matches), the second spot (a fact), the next day's first spot (the one-liner, using a test build's clock), and the no-cat screen (nothing). All in three languages, at about 390 px and at desktop, with the link on and off. **Help feed a cat** is checked against a local server whose donation page is a test address: the count goes up by one and the browser lands there. No taps on the live site until launch day (Decision 3).

---

## Every place the guards must hold

| Rule | Every place it must hold |
|---|---|
| Nothing shows after an offline save | The `spot.tsx` `send` callback (the only place `waiting` is set); `settleWait` for `failed`; the background sync in `OfflineContext` (never writes `pendingResult`); `review.tsx` opened with a `localId` |
| The nudge counts only on the result screen | `review.tsx`, through `chooseForResult`, only. Never in `settleWait`, never on the no-cat screen, never when `pendingResult.countable` is false |
| A guess never nags | `chooseForResult` when the signals are unknown, 403, 410 or failed, and when the switches never loaded; the in-memory reset on a device id change |
| The first-spot date is the server's arrival time | The signals query only (no other reader); mutation probes 1 and 2 |
| Nothing about who tapped is kept by Cat Spotters | `routes/go.ts` (no IP, device, query string or limiter); the request-log serializers (`app.ts:30`); the table's two columns. Replit's own access logs: **unchecked** |
| Device ids stay out of logs | The redaction list (`lib/logger.ts:61-62`) for the signals route; mutation probe 7 |
| Only the one address gets past the pre-launch gate | `middlewares/prelaunchGate.ts` exact match; mutation probe 8 |
| Unconfirmed facts never show | `chooseForWait`, including the fixed start (facts 1 and 7), the reshuffle and the never-loaded default; the server default for the unset setting |
| The redirect only goes to an https page | `sanitizeDonateUrl` on the server; the app never builds the donation address itself |

---

## Syros Cats' answers and the switches (SYC-360)

Answers are due Mon 19 Oct. Nothing waits on them. This is what each answer changes, all as switches (Decision 1):

| Their answer | Switch, set before the Fri 23 publish |
|---|---|
| Figures and page both yes | `FEED_NUDGE_DONATE_URL=https://syroscats.com/donations` |
| Either one no, or no answer | `FEED_NUDGE_DONATE_URL` left empty: the no-link nudge (Decision 6) |
| A yes to some of the nine sign-off facts | `STARTER_FACTS_HIDDEN` lists the sign-off facts **without** a yes |
| No answer on the facts | `STARTER_FACTS_HIDDEN` left unset: all nine hidden |
| No to counting (their question 5) | `FEED_TAP_COUNT=off` |

**Worth knowing now:** if Syros Cats answer nothing on the facts **and** the launch has to use the core-ten cut (D4 in the launch plan), only **four** facts would show at launch:
- 2 (litters);
- 7 (milk);
- 13 (tortoiseshell);
- 20 ("can't tell").

Six of the ten core facts need their yes (1, 3, 4, 6, 8 and 12). That's the strongest reason to get their answers by Monday.

**The core-ten cut is a switch.** It hides the ten non-core facts: `fact.vacuum, fact.water, fact.hiss, fact.dontPickUp, fact.whiteBlue, fact.slowBlink, fact.tailUp, fact.purr, fact.kittenEyes, fact.colonyFemales`, plus any unapproved sign-off ones. Bringing them back in the first update is the same switch. It needs an app update only if Johnny changed their words.

---

## The app stores (SYC-350)

- **Apple** (checked in the spec, App Review Guideline 3.2.2(iv), opened 15 Oct): donations "may only collect funds outside of the app, such as via Safari". The button opens the phone's own browser, which meets this.
- **Google Play** (checked 15 Oct, Play Console Help, "Payments", answer 9858738, opened, and re-fetched independently by the reviewer): Google Play's billing "must not be used in cases where … payments include peer-to-peer payments, online auctions, and tax exempt donations". So Play's own billing is ruled out for donations, and linking out to the charity's page is the expected path.
- **Still unchecked:** whether a gift to a UK registered charity counts as "tax exempt" in Google's sense, and whether the store listing must name Syros Cats. Both go to the store-listing work (SYC-323), and SYC-350 gets this finding. If either store objects, the fix is the no-link switch, not a release.

---

## Where this collides with other work

| Stream | Overlap | What happens |
|---|---|---|
| PR #181 (SYC-42 Slice 3), **merged** 15 Oct | Took migration 0025; edited `lib/i18n.ts` | This plan is rebased on it. The tap-count migration is 0026 or higher, taken after rebasing and agreed with the live sessions before claiming |
| Email capture (SYC-344 plan) | Its "follow this cat" card goes on the **success** block of `review.tsx` (below the points and badges) | **Agreed with that session on 15 Oct:** they never share a screen. Order on a first spot: wait → match list or naming (nudge) → success (email card). Its PR rebases after this plan's PR 2. Its migrations don't touch this plan's table |
| PRs #178, #179, #183 (SYC-53) | `routes/index.ts` (one line each); later, signed-in roles in the app | A one-line merge in `routes/index.ts`. SYC-53's app sign-in fills `signedInRole` |
| PR #184 (SYC-219, dashboard layout) | Team dashboard only | None, with Decision 1 A |
| PR #185 (SYC-323, store build settings) | `eas.json` and build profiles | None. The store listing's donation check (SYC-350) is that stream's |
| PR #180 (SYC-209 PR 3.4) | Team pages only | None |
| SYC-161 (colour chips, plan merged as #182) | "Find the cat" (`components/CatPicker.tsx`), not the match list or naming | None |
| The launch plan (PR #172) | Its Wave 1 row; small call 1 changes what's in each PR; Decision 3 changes the gate | A message to that session with both, once you approve |
| Johnny's corrections | Back Tue 27; the launch plan applies them in one PR on Wed 28 | This plan uses that slot (no new one) |

---

## What works with no signal, precisely

- **No signal at all:** the sighting is saved on the phone as today. No card, no fact, no nudge, no one-liner, and nothing counted. When it's sent later, it's matched in the background, and opening it from the Spot tab shows no nudge or line.
- **Weak signal:** the wait is longer, so there's more to read. The facts, the nudge and the ear-tip photo are inside the app, so they show straight away.
- **The switches and signals** are fetched when the app opens with a signal, and again on returning to it and when the signal comes back. The last answers are kept on the phone. A phone that has never loaded them:
  - shows the no-link nudge, which isn't counted;
  - hides the sign-off facts (Decision 4 A);
  - gets no one-liner.
- **Help feed a cat** needs a connection, because it opens a web page. It only appears on the result screen, seconds after the server answered.
- **The website** can't be opened from scratch with no signal. That's true of the whole site.

---

## What this plan does not do

- No settings page on the dashboard (Decision 1 B, a follow-up).
- No nudge on the cat's page, no long form, no page of all the facts, and no fact about the cat just photographed. Those belong to Teaching in full (SYC-61).
- No in-app donations (SYC-1).
- No offline nudge (Samuel, decision 5).
- No signed-in guardian or team detection in the app (SYC-53 provides it).

---

## Model delegation

This session runs on Opus, the parent session's model. Nothing below goes above Sonnet.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| M0 measurement | Sonnet | A scripted run with a fixed recipe | Probe: the branch is listed, then gone. The numbers are posted with the raw times |
| PR 1 server: switches, signals, redirect, gate, table | Sonnet | Clear plan; existing patterns (`campaign.ts`, `notifications.ts` device auth, `0021`, the gate's own tests) | CI (types, tests, `migrate:check`); the named tests; mutation probes 1, 2, 5, 6, 7 and 8; an adversarial review on Sonnet in its own worktree |
| PR 1 app: schedule, store, settings context, card, `spot.tsx` | Sonnet | The pure functions are fully specified by the two specs' rule lists | Spec tests 1–13; mutation probes 3 and 4; the browser-pane check at 390 px and desktop; an adversarial review |
| Copying the 60 fact strings and 11 nudge strings into `i18n.ts` | Haiku | Pure copying from Appendix A | The parity test, plus the spec-match test (it reads the spec and compares every string), so a typo goes red. The Sonnet builder spot-checks the diff |
| PR 2: nudge, result screen, one-liner, button | Sonnet | Clear rules, tested as pure functions first | All 19 nudge tests; mutation probes 1–5; the browser-pane check; an adversarial review |
| Johnny's corrections | Haiku | Replacing strings he supplies | The spec-match test (the spec is corrected first, then the strings). Claude reads the diff |
| Merging, publishing, the launch-day tap | The session model | Judgement, and ordering with other sessions | `/ship`; `/api/healthz` shows the new commit before any check on the live site |

Every agent prompt carries, word for word: *commit early and often in the worktree, keep a `CHECKPOINT.md` (what's done, what's next), commit after EACH item, not at the end; do not spawn nested background agents.* Each reviewer gets its own worktree.

---

## Linear

- **SYC-36, SYC-48 and SYC-343:** a comment with this plan's PR, and the PR 1 / PR 2 split.
- **SYC-350:** the Google Play finding above.
- **SYC-345:** the launch-day tap check.
- **New, filed with this plan (checked against existing issues first):**
  - **SYC-383**: a settings page on the team dashboard for the nudge and facts (Decision 1 B), after launch.
  - **SYC-384**: fill `signedInRole` when the app gets guardian and team sign-in (C4), under SYC-53.
- **Commented on 15 Oct:** SYC-36, SYC-48, SYC-343, SYC-350 (the Google Play finding) and SYC-345 (the launch-day tap).

---

## Still needs Samuel

1. Approve this plan.
2. Decisions 1–6. The recommendations are what the plan assumes; 4, 5 and 6 are small.
3. The OK for M0, if Decision 2 is A. It creates a temporary database copy, spends about 10 matching calls, and needs "ask" mode.
4. Send SYC-360 to Syros Cats (answers by Mon 19), knowing the four-fact worst case above.
5. Your pull before the 23 and 26 Oct publishes. With Decision 1 A, also whoever enters the server switches, if Claude can't.

---

## Review outcome

An independent adversarial review (Sonnet) read the first draft against both specs, `origin/main` and the launch plan. It found:
- **1 blocker:** the pre-launch gate blocks the donation link.
- **7 major problems:** a device-id log leak; tests the repo's setup can't run; a dropped spec rule (a claim sets the flag at once); switches never loaded when the app first opened offline; stale migration facts; under-specified server queries; a self-contradictory result-screen lifecycle.
- **Smaller points.**

It confirmed the copy matches the specs word for word, and that the PR split is sound. Every finding is folded in above. Four became decisions (3, 4, 5 and 6). The findings and what happened to each are in [`match-wait-screen-review.md`](./match-wait-screen-review.md).

---

## Appendix A: every visitor-facing sentence, for Johnny's pack (SYC-346)

Copied word for word from the approved specs. Nothing new is written for the app. Greek and French are drafts for Johnny (SYC-283) at the copy freeze, Thu 22 Oct.

### A.1 The nudge (from `feeding-nudge.md` §5.1, unchanged)

| Key | English | Ελληνικά | Français |
|---|---|---|---|
| `feedNudgeTitle` | Thinking of sharing your lunch? | Σκέφτεσαι να μοιραστείς το φαγητό σου; | Tu comptes partager ton déjeuner ? |
| `feedNudgeWhy` | We'd gently ask you not to. Cats fed all summer by visitors come to rely on it. When the visitors leave, the food leaves with them, and the cats go hungry through the winter. | Σου ζητάμε ευγενικά να μην το κάνεις. Οι γάτες που τις ταΐζουν οι επισκέπτες όλο το καλοκαίρι καταλήγουν να εξαρτώνται από αυτό. Όταν φεύγουν οι επισκέπτες, φεύγει και το φαγητό, και οι γάτες πεινάνε όλο τον χειμώνα. | On te demande gentiment de ne pas le faire. Les chats nourris tout l’été par les visiteurs finissent par en dépendre. Quand les visiteurs partent, la nourriture part avec eux, et les chats ont faim tout l’hiver. |
| `feedNudgeInstead` | Syros Cats and local cat guardians feed colonies the right food, in the right places, all year round. | Οι Syros Cats και οι ντόπιοι κηδεμόνες γατών ταΐζουν τις αποικίες με τη σωστή τροφή, στα σωστά σημεία, όλο τον χρόνο. | Syros Cats et les gardiens de chats locaux nourrissent les colonies avec une alimentation adaptée, aux bons endroits, toute l’année. |
| `feedNudgeEuro` | €1 feeds a cat for a day. €30 feeds one for a month. | Με 1 € τρέφεται μια γάτα για μια μέρα. Με 30 €, για έναν μήνα. | 1 € nourrit un chat pendant une journée. 30 € le nourrissent pendant un mois. |
| `feedNudgeHelp` | Help feed a cat | Βοήθησε να φάει μια γάτα | Aide à nourrir un chat |
| `feedNudgeDismiss` | Got it | Κατάλαβα | Compris |
| `feedNudgeA11yLabel` | Why not to feed the cats | Γιατί να μην ταΐζεις τις γάτες | Pourquoi ne pas nourrir les chats |

### A.2 The daily one-liner (§5.1a, unchanged)

| Key | English | Ελληνικά | Français |
|---|---|---|---|
| `feedNudgeLine` | Please don't feed the cats. €1 feeds one for a day. | Σου ζητάμε να μην ταΐζεις τις γάτες. Με 1 € τρέφεται μια γάτα για μια μέρα. | S’il te plaît, ne nourris pas les chats. 1 € en nourrit un pendant une journée. |

### A.3 Without a donation link (§5.2, unchanged)

| Key | English | Ελληνικά | Français |
|---|---|---|---|
| `feedNudgeInsteadNoLink` | Syros Cats and local cat guardians feed colonies the right food, in the right places, all year round. The Help tab shows how to give. | Οι Syros Cats και οι ντόπιοι κηδεμόνες γατών ταΐζουν τις αποικίες με τη σωστή τροφή, στα σωστά σημεία, όλο τον χρόνο. Στην καρτέλα «Βοήθεια» θα δεις πώς μπορείς να κάνεις δωρεά. | Syros Cats et les gardiens de chats locaux nourrissent les colonies avec une alimentation adaptée, aux bons endroits, toute l’année. L’onglet « Aider » te montre comment faire un don. |

### A.4 The card's own words (`starter-facts.md` §4.1, unchanged)

| Key | English | Ελληνικά | Français |
|---|---|---|---|
| `waitingEyebrow` | While we look… | Όσο ψάχνουμε… | Pendant qu’on cherche… |
| `waitingFactA11yLabel` | While we look, a cat fact | Όσο ψάχνουμε, κάτι για τις γάτες | Pendant qu’on cherche, une info sur les chats |

### A.5 The twenty facts (`starter-facts.md` §4, unchanged)

#### Sterilisation (strand 3)

**Fact 1 · The clipped ear tip** · *core* · *sign-off* · **shows the ear-tip example photo**
- **EN** The flat top on the ear in this photo is a clipped tip: the sign a cat is sterilised. The vet trims it while she's asleep. On Syros it's usually the left ear.
- **EL** Η ίσια κοπή στην κορυφή του αυτιού σε αυτή τη φωτογραφία δείχνει ότι η γάτα έχει στειρωθεί. Ο κτηνίατρος την κάνει ενώ κοιμάται. Στη Σύρο είναι συνήθως το αριστερό αυτί.
- **FR** Le haut tout plat de l’oreille sur cette photo, c’est un bout coupé : le signe qu’une chatte est stérilisée. Le vétérinaire le coupe pendant qu’elle dort. À Syros, c’est généralement l’oreille gauche.

**Fact 2 · How fast it adds up** · *core*
- **EN** One unsterilised female can have two or three litters a year, and her daughters can be pregnant themselves from as young as four months.
- **EL** Μία μη στειρωμένη θηλυκή γάτα μπορεί να κάνει δύο ή τρεις γέννες τον χρόνο, και οι κόρες της μπορούν να μείνουν έγκυες ήδη από τεσσάρων μηνών.
- **FR** Une femelle non stérilisée peut avoir deux ou trois portées par an, et ses filles peuvent elles-mêmes attendre des petits dès l’âge de quatre mois.

**Fact 3 · Sterilisation and disease** · *core* · *sign-off* · the 1 September meeting's addition
- **EN** Sterilised cats fight and roam less, so they're less likely to catch or pass on diseases spread by bites, like FIV, which doesn't affect people.
- **EL** Οι στειρωμένες γάτες τσακώνονται και περιφέρονται λιγότερο, οπότε είναι λιγότερο πιθανό να κολλήσουν ή να μεταδώσουν ασθένειες που περνούν με δαγκωματιές, όπως ο FIV, που δεν προσβάλλει τους ανθρώπους.
- **FR** Les chats stérilisés se battent et errent moins : ils risquent moins d’attraper ou de transmettre des maladies qui passent par les morsures, comme le FIV, qui ne touche pas les humains.

**Fact 4 · Back home afterwards** · *core* · *sign-off*
- **EN** After sterilisation, most street cats go back to exactly where they were found: their own patch, their own colony, the people who feed them.
- **EL** Μετά τη στείρωση, οι περισσότερες γάτες του δρόμου επιστρέφουν ακριβώς εκεί που βρέθηκαν: στη γειτονιά τους, στην αποικία τους, στους ανθρώπους που τις ταΐζουν.
- **FR** Après leur stérilisation, la plupart des chats des rues retournent exactement là où on les a trouvés : leur coin, leur colonie, les gens qui les nourrissent.

**Fact 5 · Why taking cats away doesn't work** · *sign-off*
- **EN** Take cats away from a place with food and shelter, and new cats often move in. Sterilising them instead aims for a settled colony that stops growing.
- **EL** Αν απομακρύνεις τις γάτες από ένα μέρος με φαγητό και καταφύγιο, συχνά έρχονται καινούργιες. Η στείρωση στοχεύει σε μια σταθερή αποικία που σταματά να μεγαλώνει.
- **FR** Si on retire les chats d’un endroit où il y a à manger et un abri, d’autres arrivent souvent. Les stériliser vise plutôt une colonie stable qui cesse de grandir.

**Fact 6 · What it costs** · *core* · *sign-off*
- **EN** Sterilising one female cat costs Syros Cats €50–60. That one operation prevents every litter she would otherwise have had.
- **EL** Η στείρωση μίας θηλυκής γάτας κοστίζει στις Syros Cats 50–60 €. Αυτή η μία επέμβαση αποτρέπει κάθε γέννα που θα έκανε διαφορετικά.
- **FR** Stériliser une chatte coûte 50 à 60 € à Syros Cats. Cette seule opération évite toutes les portées qu’elle aurait eues.

#### Food, and being around a street cat (strand 4)

**Fact 7 · Milk** · *core* · the lactose fact (Jacky)
- **EN** Most grown-up cats digest milk badly, so a saucer of milk often means an upset stomach. Fresh water is what they need.
- **EL** Οι περισσότερες ενήλικες γάτες δεν χωνεύουν καλά το γάλα, γι’ αυτό ένα πιατάκι γάλα συχνά τους φέρνει στομαχόπονο. Αυτό που χρειάζονται είναι φρέσκο νερό.
- **FR** La plupart des chats adultes digèrent mal le lait : une soucoupe de lait leur donne souvent mal au ventre. Ce qu’il leur faut, c’est de l’eau fraîche.

**Fact 8 · Leftovers aren't cat food** · *core* · *sign-off*
- **EN** Onions, garlic and chocolate are poisonous to cats. Cooked bones, cured meat and salty leftovers can hurt them too. Leftovers aren't cat food.
- **EL** Το κρεμμύδι, το σκόρδο και η σοκολάτα είναι δηλητηριώδη για τις γάτες. Τα μαγειρεμένα κόκαλα, τα αλλαντικά και τα αλμυρά αποφάγια μπορούν επίσης να τις βλάψουν. Τα αποφάγια δεν είναι τροφή για γάτες.
- **FR** L’oignon, l’ail et le chocolat sont toxiques pour les chats. Les os cuits, la charcuterie et les restes salés peuvent aussi leur faire du mal. Les restes ne sont pas de la nourriture pour chats.

**Fact 9 · Water at a feeding spot** · *sign-off*
- **EN** See a dry water bowl at a feeding spot? Topping it up helps, especially in summer. Food is best left to the people who feed the cats regularly.
- **EL** Βλέπεις άδειο μπολ για νερό σε σημείο ταΐσματος; Αν το γεμίσεις, βοηθάς, ειδικά το καλοκαίρι. Το φαγητό καλύτερα να το αφήνεις σε όσους ταΐζουν τις γάτες τακτικά.
- **FR** Tu vois une gamelle d’eau vide à un point de nourrissage ? La remplir aide, surtout en été. La nourriture, mieux vaut la laisser à ceux qui nourrissent les chats régulièrement.

**Fact 10 · A hiss means space**
- **EN** A hissing cat isn't being nasty. It's frightened and asking for space. Step back and let it be.
- **EL** Μια γάτα που φυσάει δεν είναι κακιά. Έχει φοβηθεί και ζητά χώρο. Κάνε ένα βήμα πίσω και άφησέ την ήσυχη.
- **FR** Un chat qui crache n’est pas méchant. Il a peur et demande de l’espace. Recule et laisse-le tranquille.

**Fact 11 · Admire, don't pick up**
- **EN** Even a friendly street cat can panic, scratch or bite if you pick it up. Let it come to you, or simply admire it where it is.
- **EL** Ακόμη και μια φιλική γάτα του δρόμου μπορεί να πανικοβληθεί, να γρατζουνίσει ή να δαγκώσει αν τη σηκώσεις. Άφησέ τη να έρθει σε σένα ή απλώς θαύμασέ τη εκεί που είναι.
- **FR** Même un chat des rues gentil peut paniquer, griffer ou mordre si tu le prends dans tes bras. Laisse-le venir à toi, ou admire-le simplement là où il est.

#### When a cat needs help (strand 5)

**Fact 12 · Kittens on their own** · *core* · *sign-off*
- **EN** Kittens on their own? Their mother has usually just gone for food. Don't pick them up; watch from a distance. If they look cold, hurt or ill, report them in the app.
- **EL** Γατάκια μόνα τους; Η μητέρα τους συνήθως έχει πάει για φαγητό. Μην τα σηκώσεις· παρακολούθησε από απόσταση. Αν κρυώνουν, είναι τραυματισμένα ή άρρωστα, ανέφερέ τα από την εφαρμογή.
- **FR** Des chatons tout seuls ? Leur mère est souvent juste partie manger. Ne les prends pas : observe de loin. S’ils ont froid, sont blessés ou malades, signale-les dans l’appli.

The fact names no button, because the spotter reads it during the wait, when "This cat needs help" is hidden. The link is on the Spot screen when nothing is sending, on the match list, and on every cat's page; it isn't on the naming screen (checked on origin/main `f757c0d`). The report flow itself explains what Syros Cats can and can't do (the capacity messaging from Susan's standard reply); the fact promises nothing.

#### Reading a cat (strand 1)

**Fact 13 · Tortoiseshells are girls** · *core*
- **EN** Almost every tortoiseshell or calico cat is female. The gene for orange fur sits on the X chromosome, with black as its alternative, so showing both takes two Xs.
- **EL** Σχεδόν όλες οι χελωνόχρωμες και οι τρίχρωμες γάτες είναι θηλυκές. Το γονίδιο του πορτοκαλί τριχώματος βρίσκεται στο χρωμόσωμα Χ, με εναλλακτική το μαύρο, οπότε για να υπάρχουν και τα δύο χρειάζονται δύο Χ.
- **FR** Presque tous les chats écaille de tortue ou calico sont des femelles. Le gène du pelage roux est sur le chromosome X, avec le noir comme alternative : avoir les deux demande deux X.

**Fact 14 · White cats with blue eyes**
- **EN** Many all-white cats with two blue eyes are born deaf. If one doesn't turn when you come near, it may not have heard you: stay where it can see you.
- **EL** Πολλές κάτασπρες γάτες με δύο γαλάζια μάτια γεννιούνται κουφές. Αν κάποια δεν γυρίσει όταν πλησιάζεις, ίσως δεν σε άκουσε: μείνε εκεί που μπορεί να σε δει.
- **FR** Beaucoup de chats tout blancs aux deux yeux bleus naissent sourds. S’il ne se retourne pas quand tu approches, il ne t’a peut-être pas entendu : reste là où il peut te voir.

**Fact 15 · The slow blink**
- **EN** Try a slow blink, from a distance. A 2020 study found cats often slow-blink back, and seem more at ease with people who do it.
- **EL** Δοκίμασε ένα αργό ανοιγοκλείσιμο των ματιών, από απόσταση. Μια μελέτη του 2020 βρήκε ότι οι γάτες συχνά το ανταποδίδουν και φαίνονται πιο άνετες με όποιον το κάνει.
- **FR** Essaie un clignement lent des yeux, de loin. Une étude de 2020 a montré que les chats y répondent souvent, et semblent plus à l’aise avec ceux qui le font.

**Fact 16 · Tail up**
- **EN** A tail held straight up is a cat's friendly hello. A tail tucked low, or fur standing on end, means give it room.
- **EL** Η ουρά σηκωμένη ίσια προς τα πάνω είναι το φιλικό «γεια» μιας γάτας. Ουρά χαμηλά ή τρίχωμα σηκωμένο σημαίνει «κράτα αποστάσεις».
- **FR** Une queue dressée bien droite, c’est le bonjour amical d’un chat. Une queue basse, ou des poils hérissés, veulent dire : laisse-lui de l’espace.

**Fact 17 · Not every purr is happy**
- **EN** Cats purr when they're content, but also when they're stressed, hurt or giving birth. A purr can be a cat calming itself down.
- **EL** Οι γάτες γουργουρίζουν όταν είναι ευχαριστημένες, αλλά και όταν έχουν άγχος, πονάνε ή γεννάνε. Το γουργούρισμα μπορεί να είναι ο τρόπος τους να ηρεμούν.
- **FR** Les chats ronronnent quand ils sont contents, mais aussi quand ils sont stressés, blessés ou en train de mettre bas. Ronronner peut être une façon de se calmer.

**Fact 18 · Kittens' eyes open blue**
- **EN** Kittens' eyes open blue. Their real colour comes through over the first few months, so a blue-eyed kitten may grow up green or gold.
- **EL** Τα μάτια των γατακιών ανοίγουν γαλάζια. Το πραγματικό τους χρώμα φαίνεται μέσα στους πρώτους μήνες, οπότε ένα γατάκι με γαλάζια μάτια μπορεί να μεγαλώσει με πράσινα ή χρυσά.
- **FR** Les yeux des chatons s’ouvrent bleus. Leur vraie couleur apparaît au cours des premiers mois : un chaton aux yeux bleus peut grandir avec des yeux verts ou dorés.

#### Life in a colony (strand 2)

**Fact 19 · Families of females** · *sign-off*
- **EN** A street colony often grows around related females: mothers, daughters, sisters. They may even help look after each other's kittens.
- **EL** Μια αποικία του δρόμου συχνά σχηματίζεται γύρω από συγγενικές θηλυκές γάτες: μητέρες, κόρες, αδελφές. Μπορεί μάλιστα να φροντίζουν η μία τα γατάκια της άλλης.
- **FR** Une colonie des rues se forme souvent autour de femelles apparentées : mères, filles, sœurs. Elles s’occupent parfois même des chatons les unes des autres.

#### You're doing science (strand 6)

**Fact 20 · "Can't tell" is a good answer** · *core*
- **EN** "Can't tell" is a good answer. An honest "not sure" keeps the island's record true. A confident wrong guess can make a cat look sterilised when it isn't.
- **EL** Το «Δεν μπορώ να πω» είναι καλή απάντηση. Μια ειλικρινής αμφιβολία κρατά σωστό το αρχείο του νησιού. Μια σίγουρη αλλά λάθος απάντηση μπορεί να κάνει μια γάτα να φαίνεται στειρωμένη ενώ δεν είναι.
- **FR** « Je ne sais pas » est une bonne réponse : l’honnêteté garde le registre de l’île fiable. Une réponse sûre mais fausse peut faire croire qu’un chat est stérilisé alors qu’il ne l’est pas.

The quoted "Can't tell" matches the live answer labels (`earTipCantTell`: *Can’t tell*, *Δεν μπορώ να πω*, *Je ne sais pas*; checked on origin/main `f757c0d`). The live strings use a curly apostrophe; the shipped fact uses the same.

## Appendix B: the two new pieces of wording

The only visitor-facing words this plan adds. Greek and French drafts go in Johnny's pack with the rest, by Thu 22 Oct.

### B.1 The privacy policy sentence (SYC-66)

The privacy policy is written in English today (`docs/specs/privacy-policy.md`). The Greek and French are for whenever it's translated. This is the wording for Decision 5 A (per day); with B, "a count for that day" becomes "a running count". It speaks only for Cat Spotters' own records. Whether Replit's own access logs keep addresses is **unchecked**.

| | Text |
|---|---|
| English | When someone taps "Help feed a cat", Cat Spotters adds one to a count for that day. It keeps nothing about who tapped it, their phone, or where they were. |
| Ελληνικά | Όταν κάποιος πατά «Βοήθησε να φάει μια γάτα», το Cat Spotters προσθέτει ένα στη μέτρηση εκείνης της μέρας. Δεν κρατά τίποτα για το ποιος το πάτησε, το τηλέφωνό του ή το πού βρισκόταν. |
| Français | Quand quelqu’un appuie sur « Aide à nourrir un chat », Cat Spotters ajoute un au compte de la journée. Rien n’est conservé sur la personne qui a appuyé, son téléphone ou l’endroit où elle se trouvait. |

The button's name in each language matches `feedNudgeHelp` (A.1).

### B.2 The plain page when the link is off (small call 5)

Shown only to a phone whose switches are out of date. It's served by the server in the language the browser asks for, with English as the fallback.

| Key | English | Ελληνικά | Français |
|---|---|---|---|
| `feedLinkOffTitle` | This link isn't available | Αυτός ο σύνδεσμος δεν είναι διαθέσιμος | Ce lien n’est pas disponible |
| `feedLinkOffBody` | The Help tab in the Cat Spotters app shows how to give. | Στην καρτέλα «Βοήθεια» της εφαρμογής Cat Spotters θα δεις πώς μπορείς να κάνεις δωρεά. | L’onglet « Aider » de l’appli Cat Spotters te montre comment faire un don. |

The tab names match `tabHelp` (Help, Βοήθεια, Aider; `lib/i18n.ts:237`, `:802`, `:1349`), and the wording follows `feedNudgeInsteadNoLink` (A.3).
