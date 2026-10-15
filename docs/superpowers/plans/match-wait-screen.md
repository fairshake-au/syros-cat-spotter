# SYC-36 and SYC-48: the match-wait screen, with the feeding nudge and the starter facts (implementation plan, for Samuel's approval)

**Linear:** SYC-36 (feeding nudge) and SYC-48 (starter facts), from the spec ticket SYC-343 (Done). Also touches SYC-360 (Syros Cats' answers), SYC-350 (Google Play), SYC-346 and SYC-283 (Johnny's pack), SYC-66 (privacy policy) and SYC-53 (signed-in roles, later). **Status:** written 15 October 2026, **awaiting Samuel's approval.** Nothing here is built, published or configured.

**Design (approved, not reopened here):** `docs/specs/feeding-nudge.md` and `docs/specs/starter-facts.md`, merged in PR #174 (commit `629fbea`), with their review `docs/specs/reviews/feeding-nudge-and-starter-facts-review.md`.

**The approval, and where it comes from.** Samuel approved both specs on 15 October 2026. Source: the transcript of the session "Spec the feeding nudge and the starter facts", where his message at 14:32 UTC reads "approved, review and merge". The 10 decisions came back through question prompts in that session between 14:24 and 14:30 UTC:

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

The same answers are recorded on SYC-36 and SYC-48 (comments of 15 Oct, 14:31 UTC). One rule in the spec was not one of these questions: the one-liner stops for good after a tap on **Help feed a cat** (`feeding-nudge.md` §3.2, condition 4). The spec says Samuel approved it with that rule in; the SYC-36 comment notes he can drop it.

**Checked against:** `origin/main` at `90fc6d6` (15 October 2026); the launch plan on PR #172 (branch `claude/xenodochial-zhukovsky-df315f`, not yet approved), "Wave 1", the "Match-wait screen" row; open PRs #178, #179, #180, #181, #182 and #146; Linear SYC-36, SYC-48, SYC-343 (all comments), SYC-350 and SYC-360; the Neon project `syros-cat-spotter` (read-only queries, 15 Oct). Every "exists today" claim names the file it was read in.

---

## In plain English

**What a spotter sees.** They take a photo, confirm where the cat is and tap **Check for matches**. For the few seconds Cat Spotters takes to look, a card takes the place of the map, under the photo:

- **On their first spot**, it's the feeding nudge: why feeding street cats in summer leaves them hungry in winter, and that **€1 feeds a cat for a day, €30 for a month**. When the matches come back, the nudge moves below them, now with two buttons: **Help feed a cat** (opens Syros Cats' donation page in the phone's browser) and **Got it**.
- **On every other spot**, it's one short fact about cats, under the heading *While we look…*: the clipped ear tip with its photo on the second spot, milk on the third, then the rest in a shuffled order, never repeating until all have been seen.
- **Visitors** (phones that haven't claimed a cat and started spotting less than three weeks ago) also get one line under the matches on their first spot of each later day: *"Please don't feed the cats. €1 feeds one for a day."*, with the same button.
- **With no signal**, the sighting is saved on the phone as today, and nothing else shows.

**What the team can change without a new app.** Whether the donation button and figures show, which donation page it opens, and which facts are switched off. If Syros Cats haven't said yes by 22 October, the nudge ships without figures or a button and their unconfirmed facts are switched off; each switches on when they say yes.

**What gets counted.** Only how many times the donation button is tapped each day. Not who, not which phone, not where.

**The order.** A measuring step first (it needs your OK, Decision 2). Then two pull requests, one per publish slot in the launch plan: **PR 1, Fri 23 Oct**: the server side and the facts during the wait. **PR 2, Mon 26 Oct**: the feeding nudge, everywhere it appears. That's a small change to how the launch plan splits the work, explained under "Small calls".

---

## Where the specs and the code on `main` disagree

The specs' decisions stand. These are places where carrying them out needs the plan to say something the specs didn't, because the code has moved on or the specs left it open.

| # | What the spec says | What is true on `main` | What this plan does |
|---|---|---|---|
| C1 | "The date of the earliest sighting the server holds for this phone" (`feeding-nudge.md` §3.2) | `sightings.created_at` is set from the **photo's capture time**, not when the server got it (`routes/sightings.ts:580-588`, `createdAt: capturedAt`). A photo picked from the library can be up to 21 days old (`lib/photoClock.ts:24`, `MAX_PHOTO_AGE_DAYS = 21`). Read naively, a tourist whose first spot is a 3-week-old photo would count as a resident on day one and never get a reminder | The first-spot date is the earliest **arrival** time of that phone's photos: `photos.created_at`, which the database sets on insert (`lib/db/src/schema/photos.ts:38`). Checked on Neon, 15 Oct: real dates survived the move (earliest 22 Jul, latest 30 Sep 2026), so testers start with their true first date as the spec wants |
| C2 | "Has this phone claimed a cat? Claims are kept on the server" | There is no claims table. A claim is `cats.owner_device_id` plus a `life_status` / `homed` observation carrying the device (`lib/db/src/schema/cats.ts:34`; `lib/claiming.ts`). **Letting a cat go** clears `owner_device_id` and withdraws the observation (`routes/cats.ts:540`, `clearOwner` in `lib/claiming.ts:228`) | "Has claimed" means **has ever claimed**: any `homed` observation from this device, withdrawn or not (index `observations_device_idx`). Someone who let their cat go still lives here. Listed as a small call |
| C3 | "The app settings endpoint … the team can switch a fact off without a release" (`starter-facts.md` §9; `feeding-nudge.md` §9) | No settings store exists. The Help tab's campaign is read from **server environment variables** on every request (`lib/campaign.ts:59-80`, `CAMPAIGN_*`) and changed by editing them in Replit and republishing (`docs/DEPLOYMENT.md:51`). No table, no dashboard page | Decision 1 |
| C4 | "Signed in as a cat guardian or Syros Cats team member … once those sign-ins exist" | The app has no such sign-in today: no role, guardian or team flag anywhere in `artifacts/cat-spotter/app`, `context` or `lib` (searched 15 Oct). Team sign-in exists only on the server's dashboard (`middlewares/requireTeam.ts`) | The schedule takes a `signedInRole` input, always `null` at launch, with its tests (nudge test 14) written now. SYC-53's app work fills it in. A follow-up ticket says so |
| C5 | "The map is locked during that time anyway" (`starter-facts.md` §3.1) | `LocationPicker` gets no disabled prop while sending (`app/(tabs)/spot.tsx:1013-1020`); only the buttons are disabled. The pin itself is safe: the send copies `pickedCoords` at the start (`spot.tsx:492`) | Doesn't matter once the card replaces the map. The card shows from the moment the **send** starts, and the map comes back with the same pin if the send fails (the pin is screen state, not the map's) |
| C6 | The "record" holds "the date of this phone's first spot" (`starter-facts.md` §3.4) | The later text (`feeding-nudge.md` §3.2 and §9) moved both resident signals to the server so they survive a wiped browser | The phone's record doesn't store a first-spot date. The server's answer is kept with the settings, so the last one seen is used offline |
| C7 | The waiting card shows "while a sighting is sending" | `setSubmitting(true)` covers the offline save too (`spot.tsx:494-495`), and on a slow connection there's an "Optimising photo…" step before the upload (`spot.tsx:515-521`) | The card is driven by a new `waiting` flag set inside the `send` callback only, so an offline save never shows it. The optimising step counts as part of the wait |
| C8 | The result screens "`review.tsx` get the nudge … keyed by the sighting, so it appears on the first result screen only" | `review.tsx` also opens for a **queued** sighting matched later in the background (`spot.tsx:634-646`, `reviewPending`, by `localId`), and naming a new cat is reachable from the match list through "None of these — it's new!" (`review.tsx:512`, `showNewCat`) | The record carries `pendingResult: { sightingId }`, written only after a live send that came back with a cat. `review.tsx` shows the nudge or one-liner only when its `sightingId` matches, and only on the screen it opened on. A queued sighting never matches, so it never shows either |
| C9 | The one-liner may show "on the first one-liner-eligible result screen of the Athens day" | The app has `CAMPAIGN_TIMEZONE = 'Europe/Athens'` (`lib/campaignDates.ts:9`) but no "Athens date of this instant" helper | PR 1 adds `athensDay(instantMs)` beside it, tested across both daylight-saving changes |
| C10 | "Opens {host} in your browser" (`campaignOpensAt`) | Exists in all three languages (`lib/i18n.ts:454`, `:1012`, `:1560`) | Reused. `{host}` is the **donation page's** host (syroscats.com), not the counting address the button actually opens first |

---

## Decisions for Samuel

Two, each with a recommendation. Everything else the plan settles itself, listed under "Small calls".

### Decision 1: Where the switches live, and who flips them

**The question.** Three things must change without a new app: whether the donation button and figures show, which donation page it opens, and which facts are switched off. Syros Cats' answers (due Mon 19) decide the launch values, and they may say yes to more later. Where should those switches live?

| Option | Who flips a switch, and how | Benefits | Risks | What a spotter notices |
|---|---|---|---|---|
| **A. Server settings, like the Help tab's campaign today** *(recommended)* | Claude (or you) changes a setting in Replit and republishes the server. About 10 minutes, no app release, no store review | Same pattern as the campaign, already proven. No database change for settings. Fits the two PRs and the dates. Switches are rare: once on 22 Oct, then once per Syros Cats "yes" | Each change needs a republish, which goes through your Replit pull when `main` is ahead (SYC-96). Syros Cats can't flip anything themselves | Nothing. Phones pick the change up next time the app starts with a signal |
| B. A settings page on the team dashboard | Syros Cats staff tick boxes on team.catspotters.com | They control their own words and their own link | A third PR, a settings table and a new dashboard page, in the same files four other sessions are changing this week (SYC-53, SYC-209, the dashboard layout work). Doesn't fit 23 and 26 Oct | Same |
| C. A small settings table that Claude edits directly | Claude runs one database change, with your OK each time | No republish | A database change for a handful of switches. Writes to the live database need you to switch the session to "ask" mode each time. No audit trail beyond Linear | Same |

**Recommendation: A**, with B filed as a follow-up for after launch if Syros Cats want to manage it themselves.

### Decision 2: Measuring how long sending takes, without touching the live site

**The question.** The spec asks for the typical and slow send times (p50 and p90) before building, and says to raise it with you if the typical wait is under 2 seconds. I checked what's already readable (15 Oct):

- **The database can't answer it.** The Neon project's default branch has 52 sightings, the newest from 30 Sep, and **no match records at all** (`sighting_matches` has 0 rows), so there is nothing to time.
- **The server logs a time for every request** (`pino-http`, `artifacts/api-server/src/app.ts:30`), but that's only the server's share, and whether Claude can read Replit's deployment logs is **unchecked**. Nobody has spotted since 30 Sep, so there would be little to read anyway.

Every real measurement means sending sightings somewhere, so it needs your OK.

| Option | What happens | Benefits | Risks | Cost |
|---|---|---|---|---|
| **A. A local run against a throwaway copy of the database** *(recommended)* | Claude makes a temporary Neon branch (a copy of the database inside your own Neon project), runs the server on this Mac against it, and sends 10 of the existing cat photos through it with the real matcher, timing each. The branch is deleted afterwards. Phone upload time is added from the photo sizes at a typical 4G speed | Nothing touches the live site or its data. Uses the real matcher, which is most of the wait. Done in under an hour, before PR 1 | The upload part is estimated, not measured. The copy holds the same personal data as live for that hour | About 10 matching calls. Creates a temporary copy of the database (deleted the same day) |
| B. Real spots on the live test site | Someone on Syros makes 5–10 real spots with a stopwatch; Claude reads the server's times if it can | The truest number | You're away; it depends on a tester being on the island this week. Creates real sightings (of real cats, so not junk) | Someone's time |
| C. Don't measure first; log it and look after launch | PR 1 adds a timing line on the sightings route; the first week's numbers are read after 31 Oct | No extra work now | The spec's "raise it with Samuel" check happens after launch, not before | Nothing |

**Recommendation: A now, plus C's timing line in PR 1** (it's one line and keeps measuring once real tourists arrive). The design doesn't wait on the number: facts only count as seen after 3 seconds on screen, so a short wait just means facts come round again. The number decides one thing: if the typical wait is under 2 seconds, I'll bring it back to you before PR 2.

### Small calls this plan makes (object to any, otherwise they stand)

1. **The split between the two PRs changes slightly from the launch plan.** The launch plan's PR 1 is "settings, the tap count and the card". If the card showed the nudge on Fri 23 but the result screen only arrived on Mon 26, nothing would ever count it, so every spot over that weekend would show it. So **PR 1 ships the facts during the wait** (and all the server pieces, including the tap-count table); **PR 2 ships the nudge everywhere**: the wait, the result screen, the one-liner and the button. Same two slots, same migration slot.
2. **"Has claimed a cat" means "has ever claimed one"** (C2). Letting a cat go doesn't make you a visitor again.
3. **One switch for the button and the figures.** The spec has two forms only: with figures and button, or with neither (§5.2). If Syros Cats say yes to the figures but not the page (or the other way round), the no-link form stays until both are yes, or until you decide otherwise.
4. **If the server's fact list isn't set, the nine sign-off facts are hidden.** The spec's default of "nothing hidden" is for a phone that has never loaded settings, and stays as written. On the server, a forgotten setting hides the facts that need Syros Cats' yes rather than showing them. To show them, the setting lists them as approved explicitly.
5. **The tap count is a count per Athens day**, not one running total. A date isn't about a person, and it shows whether the nudge works more in July than in October. No device, address, name or place is stored, and the redirect has **no rate limiter**, because our limiter keeps a salted fingerprint of the internet address for up to two days (`middlewares/rateLimit.ts`, `rateLimits.ts`), which would make "nothing about who" untrue. The accepted risk: someone could inflate the count by tapping repeatedly. It's a number for Syros Cats and you, not money.
6. **If the donation link is off and an old phone still taps the button**, the counting address sends them to the website's Help tab and counts nothing.
7. **The ear-tip photo** is the existing `EAR_TIP_EXAMPLE_PHOTO` (`lib/earTipExample.ts:16`), not a copy, as the spec says.

---

## How it ships: the order

| Step | What | When | Who | Needs |
|---|---|---|---|---|
| M0 | Measure the send time (Decision 2) | After your OK, before PR 1 | Claude | Decision 2 |
| PR 1 | The server pieces and the facts during the wait | Built 19–22 Oct, **published Fri 23 Oct** | Sonnet build, Sonnet review | This plan approved; migration number agreed with live sessions after rebase |
| Config | Launch values set: donation page on or off, hidden facts | Thu 22 Oct evening, from Syros Cats' answers (SYC-360) | Claude sets them in Replit; your pull and republish | Decision 1 |
| PR 2 | The nudge: wait, result screen, one-liner, button, count | Built 22–25 Oct, **published Mon 26 Oct** | Sonnet build, Sonnet review | PR 1 live |
| Words | Johnny's Greek and French corrections | Arrive 23–27 Oct | Haiku edit, Claude checks | A publish slot after 27 Oct (see "Where this collides") |

---

## M0: measuring the send time (only with your OK)

1. Heads-up line to you first (it creates a temporary database copy and spends about 10 matching calls).
2. Create a Neon branch from the default branch, named `measure-send-time-YYYYMMDD`.
3. Run `artifacts/api-server` locally against it, with the real matching key (read from the existing local environment, never printed).
4. Send 10 existing photos of different cats, one at a time, through `POST /api/sightings` with a test device, timing each response.
5. Add upload time: each photo's size on a 4G connection at 5 and 1 Mbit/s up (two figures, labelled estimates).
6. Delete the branch. Probe that it's gone.
7. Write p50 and p90 (server, and server + estimated upload) on SYC-36. If the typical total is under 2 seconds, bring it to you before PR 2.

---

## PR 1: the server pieces, and the facts during the wait (Fri 23 Oct)

**In plain English.** The server learns three new things: what the settings are, whether this phone looks like a resident's, and how to count a tap on the donation button. The app learns the twenty facts in three languages, and shows one in place of the map while a sighting sends. The feeding nudge isn't shown yet; its words go in, switched off.

### Server (`artifacts/api-server`)

- **`GET /api/app-settings`** (new, `routes/appSettings.ts`), public, no device needed. Reads the server's settings (Decision 1 A) on each request, as `getCampaign()` does:
  - `FEED_NUDGE_DONATE_URL`: the donation page. Passed through the existing `sanitizeDonateUrl` (`lib/campaign.ts:35-46`): https only, else empty. **Empty means the link and figures are off** (`feeding-nudge.md` §5.2).
  - `STARTER_FACTS_HIDDEN`: a comma-separated list of fact ids. Unknown ids are ignored and logged once. Unset means the nine sign-off ids (small call 4). The word `none` means nothing hidden.
  - Response: `{ feedNudge: { donateHost: "syroscats.com" } | null, hiddenFacts: string[] }`. The full donation address isn't sent; the app opens the counting address. `Cache-Control: public, max-age=300`.
- **`GET /api/app-settings/:deviceId/signals`** (new, same file). Uses `verifyDeviceSecret(req, res, id, { bind: false })` (`lib/deviceAuth.ts:86`), so asking never binds a new phone or spends the new-device allowance. Returns:
  - `hasClaimedCat`: does any `life_status` observation with `value->>'status' = 'homed'` exist for this device, withdrawn or not (C2).
  - `firstSpotDate`: the Athens calendar date of `MIN(photos.created_at)` over this device's sightings (C1), or `null` if it has none.
  - `Cache-Control: private, no-store`. A deleted identity gets the existing 410, which the app reads as "unknown" (no one-liner). The builder checks what `bind: false` does for a phone that has never bound and writes a test for it; it must answer `{ hasClaimedCat: false, firstSpotDate: null }` without binding, or 401, never 500.
- **`GET /api/go/feed`** (new, `routes/go.ts`):
  - Adds one to today's row in a new table and answers `302` to `FEED_NUDGE_DONATE_URL`.
  - The count is best effort: if the database write fails or takes over 500 ms, it logs and redirects anyway. **The redirect never fails because of the count.**
  - With no donation page set, it redirects to the website's Help tab and counts nothing (small call 6).
  - Only `GET` counts; `HEAD` (link previews) redirects without counting.
  - `FEED_TAP_COUNT=off` stops the count and keeps the redirect, so a "no" from Syros Cats to counting (their question 5) needs no new code.
  - No rate limiter (small call 5). No query string is read or kept. The request log line already drops the IP (`app.ts:30`, serializers keep only id, method and the redacted URL).
- **The table** (migration name `donation_link_taps`, **number agreed after rebasing**, never picked by hand; #181 currently holds 0025): `donation_link_taps (day date primary key, taps integer not null default 0)`. Increment with `INSERT … ON CONFLICT (day) DO UPDATE SET taps = donation_link_taps.taps + 1`. Schema in `lib/db/src/schema/donationLinkTaps.ts`, exported from `schema/index.ts`. Generated with drizzle-kit, rollback block commented (`lib/db/migrations/README.md`), following `0021_rate_limit_counters.sql`.
- **Timing line** (Decision 2 C): `logRouteDuration` (`lib/requestTiming.ts`) on `POST /api/sightings`, from the start of the handler to the response.
- **OpenAPI and client:** the three routes in `lib/api-spec/openapi.yaml`, client regenerated (`lib/api-client-react`).

### App (`artifacts/cat-spotter`)

- **`lib/starterFacts.ts`** (new): the twenty facts listed once, each with `id`, `strand`, `core`, `signOff` and `photo` flags, reading their words from `lib/i18n.ts`. Ids: `fact.earTip`, `fact.litters`, `fact.disease`, `fact.backHome`, `fact.vacuum`, `fact.cost`, `fact.milk`, `fact.leftovers`, `fact.water`, `fact.hiss`, `fact.dontPickUp`, `fact.kittensAlone`, `fact.tortie`, `fact.whiteBlue`, `fact.slowBlink`, `fact.tailUp`, `fact.purr`, `fact.kittenEyes`, `fact.colonyFemales`, `fact.cantTell` (facts 1–20 in the spec's order).
- **`lib/i18n.ts`**: the facts, the card's words and **all the nudge's words** (unused until PR 2), in all three languages, word for word from Appendix A. Non-breaking spaces inside « », before « ? : ; ! » in French and between a number and €, as the spec says.
- **`lib/athensDay.ts`** (new, beside `campaignDates.ts`): `athensDay(instantMs) → 'YYYY-MM-DD'` and `athensDaysBetween(a, b)`, using `Intl` with `Europe/Athens`, never a fixed offset.
- **`lib/waitingCard.ts`** (new): the pure schedule, with no React and no storage.
  - `chooseForWait(record, settings, ctx)` returns `{ kind: 'nudge', form: 'full' | 'noLink', countable }` or `{ kind: 'fact', id }`. In PR 1 the nudge branch sits behind `NUDGE_ENABLED = false`.
  - `settleWait(record, shown, outcome)` returns the new record. Outcomes: `result` (sent, a cat), `notCat`, `failed` (send failed, rejected, save for later, or not saved).
  - `chooseForResult(record, settings, signals, ctx, sightingId)` returns `'nudge' | 'line' | null` (used from PR 2).
  - Rules as `starter-facts.md` §3.2 and `feeding-nudge.md` §3.2, conditions 1–6, word for word.
- **`lib/waitingCardStore.ts`** (new): one record in AsyncStorage under `catSpotters.waitingCard.v1` (localStorage on the website, as AsyncStorage already does there). Every read and write in try/catch. If it can't be read, `chooseForWait` gets `null` and shows a fact, never the nudge, and nothing is written for that wait. Fields: `nudgeCounted`, `nudgeCountedDay`, `lastLineDay`, `tapped`, `seenFacts`, `order`, `lastFactId`, `pendingResult`.
- **`context/AppSettingsContext.tsx`** (new): fetches both endpoints when the app starts with a signal and keeps the last answers in AsyncStorage (`catSpotters.appSettings.v1`), so a phone that has been online once knows them offline. Never-loaded settings: link off, nothing hidden, signals unknown.
- **`components/WaitingCard.tsx`** (new): the card as `starter-facts.md` §3.5 and `feeding-nudge.md` §4 describe it. Eyebrow, fact text, ear-tip photo at 2:1 with `earTipExampleAlt`. On appearing it announces `waitingFactA11yLabel` (or `feedNudgeA11yLabel`) through `AccessibilityInfo.announceForAccessibility`, leaves focus on the button, and appears without a transition when reduce motion is on. It reports how long it was on screen when it goes.
- **`app/(tabs)/spot.tsx`**: a `waiting` flag set at the start of the `send` callback and cleared when it returns (C7). While it's true, `WaitingCard` takes the place of the `LocationPicker` block (`spot.tsx:1013-1020`). After the outcome, `settleWait` runs: `sent` with a cat is `result`; `sent` with no cat is `notCat`; everything else is `failed`. On `sent` with a cat, `pendingResult = { sightingId }` is written before `router.push` to `/review`.
- **`context/DeleteMyDataContext.tsx`**: `wipePhone` also removes `catSpotters.waitingCard.v1` and `catSpotters.appSettings.v1`.

### PR 1 tests

From `starter-facts.md` §9.1 (all 13, numbered as the spec):

| Spec test | Where |
|---|---|
| 1 Order: nudge (with the flag on), fact 1 with photo, fact 7, then shuffled | `lib/__tests__/waitingCard.test.ts` |
| 2 No repeat until all switched-on facts are seen; reshuffle never starts with the last one seen | same |
| 3 Under 3 seconds isn't seen | same |
| 4 No-cat, failed send, save for later: nothing marked, next wait the same | same |
| 5 Offline save: no card, record unchanged | `lib/__tests__/spotWaiting.test.ts` (the `send`-only flag) |
| 6 A hidden fact never shows, including 1 and 7, the rest still rotate | `waitingCard.test.ts` |
| 7 Nothing about facts on the result screens | `lib/__tests__/reviewRoutes.test.ts` extension |
| 8 Unreadable record: a fact, never the nudge, nothing written | `lib/__tests__/waitingCardStore.test.ts` |
| 9 Delete my data removes the record | `lib/__tests__/deleteMyData.test.ts` extension |
| 10 All twenty facts and the card's words in three languages | existing parity test, `lib/__tests__/i18n.test.ts` |
| 11 Every fact 35 words or fewer per language (the spec's word rule) | `lib/__tests__/starterFacts.test.ts` |
| 12 Fact 20's quoted label matches `earTipCantTell`, after normalising quotes | same |
| 13 Card top in view at 375 × 667, default and largest text, three languages, ear-tip fact included | browser-pane check (below), plus a layout test that the card replaces the map, not follows the button |

Plus:

- **The words match the spec.** `starterFacts.test.ts` reads `docs/specs/starter-facts.md` §4 and checks each language's string in `i18n.ts` against it, after normalising non-breaking spaces. A wording change has to change both.
- **Athens days**: `lib/__tests__/athensDay.test.ts`, including 25 Oct 2026 (clocks go back) and 28 Mar 2027.
- **Server** (`routes/appSettings.test.ts`, `routes/go.test.ts`): settings with the page unset, invalid (`http:`, `javascript:`), and valid; hidden facts unset (nine sign-off ids), `none`, and with an unknown id. Signals: no sightings; first photo 20 and 21 days ago returns the right Athens date; a sighting whose capture time is 20 days earlier than its arrival uses the arrival (C1); claimed then let go is still `true`; wrong secret 403; deleted 410; never-bound phone doesn't bind. Redirect: counts once per GET, not on HEAD; two taps on one day make 2; the redirect still answers 302 when the database write throws; no page set redirects to Help and counts nothing.
- **Migration**: CI's `migrate:check` and the db package's up/down/up test.

**Mutation probes** (silent failures, so a green suite isn't enough; break the site, confirm the named test goes red, restore):

1. Use `sightings.created_at` instead of `photos.created_at` → the C1 test goes red.
2. Count a fact as seen at 0 seconds → spec test 3 goes red.
3. Show the card on the offline branch (set `waiting` before `submitSighting`) → spec test 5 goes red.
4. Let the redirect wait for the count and fail with it → the "write throws" redirect test goes red.
5. Server default for hidden facts set to "nothing hidden" → the unset-setting test goes red.

**Browser-pane check**, with the PR: the spot flow on the local web build with data, at about 390 px and at desktop width, in English, Greek and French, at the default and largest text size, with the ear-tip fact (photo) and one long fact (fact 13 in Greek). Screenshots on the PR.

---

## PR 2: the feeding nudge (Mon 26 Oct)

**In plain English.** The nudge appears on a phone's first spot, moves below the matches when they come back, and gets its two buttons there. Visitors get the one-line reminder on later days. Tapping **Help feed a cat** goes through the counting address to Syros Cats' page in the phone's browser.

- **`lib/waitingCard.ts`**: `NUDGE_ENABLED` removed. The nudge comes first, as `feeding-nudge.md` §3.2 says: not yet counted and `signedInRole` is `null`. With settings never loaded it shows the no-link form and is marked **not countable**.
- **`components/FeedNudge.tsx`** (new): the full nudge (`feedNudgeTitle`, `feedNudgeWhy`, `feedNudgeInstead` or `feedNudgeInsteadNoLink`, `feedNudgeEuro` when the link is on), and the one-liner (`feedNudgeLine`). `variant: 'wait' | 'result' | 'line'`. Buttons only in `result` and `line`:
  - **Help feed a cat**: secondary style, with `campaignOpensAt` and the donation host beneath.
  - **Got it**: quiet, full nudge only.
  - Side by side where they fit, stacked on narrow screens and at large text. Both at least 44 × 44, both reachable by keyboard on the website.
- **`app/review.tsx`**: on the screen it **opens** on (the match list, or naming when there are no candidates), if `record.pendingResult.sightingId` matches this sighting:
  - `chooseForResult` decides `'nudge'`, `'line'` or nothing, once, when the screen mounts.
  - On the match list it goes after the "None of these — it's new!" card and before `NeedsHelpLink` (`review.tsx:819-855`). On naming, after the name field and its button.
  - Counting happens as it appears: the full nudge sets `nudgeCounted` and `nudgeCountedDay` (unless not countable); the one-liner sets `lastLineDay`. Then `pendingResult` is cleared.
  - It stays until **Got it**, **Help feed a cat**, or leaving the screen. It doesn't follow the spotter to naming via "None of these", or to the reward screen. Coming back to the match list with the back arrow shows it again until it's dismissed.
  - Never on the no-cat screen (`review.tsx:382`), which never reads `pendingResult`; the record is left alone there.
- **The button** opens `${API_BASE}/api/go/feed` with `Linking.openURL`, the same way the Help tab's Donate button does (`app/(tabs)/help.tsx:78-97`), and sets `tapped`. Never a page inside the app (Apple 3.2.2(iv)). The sighting is already saved, so leaving the app loses nothing.
- **Privacy policy** (`docs/specs/privacy-policy.md`, SYC-66): one sentence under "What we collect if you say nothing" (Appendix B).

### PR 2 tests

All 19 of `feeding-nudge.md` §9.1, in `lib/__tests__/waitingCard.test.ts` (schedule) and `lib/__tests__/feedNudge.test.tsx` (screen placement), except:

- **Test 9** (23:58 / 00:05 Athens, and a daylight-saving day) uses `athensDay` with fixed instants: 24–25 Oct 2026 and 28–29 Mar 2027.
- **Test 10** (resident signals) takes `signals` as input: `hasClaimedCat` true; `firstSpotDate` 21 days ago (no line) and 20 days ago (a line).
- **Test 14** (signed-in guardian or team) passes `signedInRole: 'guardian'` and `'team'` (C4).
- **Test 17** (wiped phone, resident still gets nothing) clears the record and keeps the signals.
- **Test 18** is the browser-pane check below, plus a test that the buttons stack below 360 px.

Plus:

- A queued sighting opened from the Spot tab's list never shows the nudge or the line (C8).
- Naming reached from the match list doesn't show it (C8).
- `pendingResult` for one sighting doesn't show on another sighting's screen.

**Mutation probes:**

1. Count the nudge when the wait starts instead of on the result screen → spec tests 4 and 16 go red.
2. Treat "signals unknown" as a visitor → spec test 11 goes red.
3. Compare days in UTC → spec test 9 goes red.
4. Drop the `sightingId` match in `review.tsx` → the queued-sighting test goes red.
5. Forget `tapped` → spec test 12 goes red.

**Browser-pane check**: first spot (nudge in the wait, then below the matches), second spot (fact), next day's first spot (one-liner, by moving the phone's clock in the test build), the no-cat screen (nothing), in three languages at about 390 px and desktop, with link on and off. **Help feed a cat** is checked against a local server whose donation page is a test address, so the count goes up by one and the browser lands there. No live-site taps.

---

## Every place the guards must hold

| Rule | Every place it must hold |
|---|---|
| Nothing shows after an offline save | `spot.tsx` `send` callback (the only place `waiting` is set); `settleWait` for `saved`; the background sync in `OfflineContext` (never writes `pendingResult`); `review.tsx` opened by `localId` |
| The nudge counts only on the result screen | `review.tsx` only; never in `settleWait`; never on the no-cat screen; never when shown only because settings didn't load |
| A guess never nags | `chooseForResult` when signals are unknown, when the signals request returned 410 or failed, and when settings never loaded |
| The first-spot date is the server's arrival time | the signals query only (no other consumer); the C1 mutation probe |
| Nothing about who tapped | `routes/go.ts` (no IP, device, query string or limiter); the request log serializer (`app.ts:30`); the table's two columns |
| Hidden facts never show | `chooseForWait`, including the fixed start (facts 1 and 7) and the reshuffle |
| The redirect only goes to an https page | `sanitizeDonateUrl` on the server; the app never builds the donation address itself |

---

## Syros Cats' answers and the defaults (SYC-360)

Answers are due Mon 19 Oct. Nothing waits on them; this is what each answer changes, all as settings (Decision 1).

| Their answer | Setting on 22 Oct |
|---|---|
| Figures and page both yes | `FEED_NUDGE_DONATE_URL=https://syroscats.com/donations` |
| Either no, or no answer | `FEED_NUDGE_DONATE_URL` empty: the no-link nudge (small call 3) |
| A yes to some of the nine sign-off facts | `STARTER_FACTS_HIDDEN` lists the sign-off facts **without** a yes |
| No answer on the facts | `STARTER_FACTS_HIDDEN` left unset: all nine hidden |
| Counting (their question 5) is no | The link still goes through `/api/go/feed`, but a setting `FEED_TAP_COUNT=off` stops the count. That's one extra line in PR 1, so a "no" needs no new code |

**Worth knowing now:** if Syros Cats answer nothing on the facts **and** the launch has to use the core-ten cut (D4 in the launch plan), only **four** facts would show at launch: 2 (litters), 7 (milk), 13 (tortoiseshell) and 20 ("can't tell"). Six of the ten core facts need their yes (1, 3, 4, 6, 8, 12). That's the strongest reason to get their answers by Monday.

**The core-ten cut is a setting**: hide the ten non-core facts, `fact.vacuum, fact.water, fact.hiss, fact.dontPickUp, fact.whiteBlue, fact.slowBlink, fact.tailUp, fact.purr, fact.kittenEyes, fact.colonyFemales` (plus any unapproved sign-off ones). Bringing them back in the first update is the same setting, and needs an app update only if Johnny changed their words.

---

## The app stores (SYC-350)

- **Apple** (checked in the spec, App Review Guideline 3.2.2(iv), opened 15 Oct): donations "may only collect funds outside of the app, such as via Safari". The button opens the phone's own browser. Meets it.
- **Google Play** (checked 15 Oct, Play Console Help, "Payments", answer 9858738, opened): Google Play's billing "must not be used in cases where … payments include peer-to-peer payments, online auctions, and tax exempt donations". So Play's own billing is ruled out for donations, and linking out to the charity's page is the expected path. **Still unchecked:** whether a gift to a UK registered charity counts as "tax exempt" in Google's sense, and whether the listing must name Syros Cats. Both go to the store-listing work (SYC-323), and the SYC-350 ticket gets this finding. If either store objects, the fix is the no-link setting, not a release.

---

## Where this collides with other work

| Stream | Overlap | What happens |
|---|---|---|
| PR #181 (SYC-42 Slice 3, mail queue) | Holds migration 0025 and edits `lib/i18n.ts` | This plan takes the next free number after rebasing, agreed with that session before claiming. i18n edits are appends in each language block; rebase, don't renumber |
| Email capture (SYC-344 plan, in progress) | Its "follow this cat" card is on the **reward** screen of the first spot (`email-capture.md`, decision of 28 Sep). The nudge is on the **match list or naming** screen, before it | They never share a screen. Order on a first spot: wait → match list or naming (nudge) → reward (email card). Message sent to that session on 15 Oct to confirm; answer recorded on SYC-36 |
| PR #182 (SYC-161 plan, colour chips) | Changes "Find the cat" (`components/CatPicker.tsx`), not the match list or naming | None |
| PR #180 (SYC-209 PR 3.4) | Team pages only | None |
| PRs #178, #179 (SYC-53) and the dashboard layout work | Team dashboard; later, signed-in roles in the app | Decision 1 A keeps this plan off the dashboard. SYC-53's app sign-in fills `signedInRole` |
| The launch plan (PR #172) | Its Wave 1 row; small call 1 changes what's in each PR | Message to that session with the change, once you approve |
| Johnny's corrections, 23–27 Oct | Corrections arriving 27 Oct land after the Mon 26 publish | They need a publish between 27 and 30 Oct. On the launch plan's list to schedule; noted on SYC-346 |

---

## What works with no signal, precisely

- **No signal at all:** the sighting is saved on the phone as today. No card, no fact, no nudge, no one-liner, nothing counted. When it's sent later it's matched in the background, and opening it from the Spot tab shows no nudge or line.
- **Weak signal:** the wait is longer, so there's more to read. The facts, the nudge and the ear-tip photo are inside the app, so they show at once.
- **Settings and signals:** fetched when the app starts with a signal; the last answers are kept on the phone. A phone that has never loaded them shows the no-link nudge (not counted), hides no facts, and gets no one-liner.
- **Help feed a cat** needs a connection (it opens a web page). It only appears on the result screen, seconds after the server answered.
- **The website** can't be opened from scratch with no signal; that's true of the whole site.

---

## What this plan does not do

- No settings page on the dashboard (Decision 1 B, follow-up).
- No nudge on the cat's page, no long form, no page of all facts, no fact about the cat just photographed (Teaching in full, SYC-61).
- No in-app donations (SYC-1).
- No offline nudge (Samuel, decision 5).
- No signed-in guardian or team detection in the app (SYC-53 provides it).

---

## Model delegation

This session runs on Opus (the parent's model). Nothing here goes above Sonnet.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| M0 measurement | Sonnet | A scripted run with a fixed recipe | Probe: the branch is listed then gone; the numbers are posted with the raw timings attached |
| PR 1 server: settings, signals, redirect, table | Sonnet | Clear plan, existing patterns (`campaign.ts`, `notifications.ts` device auth, `0021`) | CI (types, tests, `migrate:check`); the named tests; mutation probes 1, 4 and 5; adversarial review on Sonnet in its own worktree |
| PR 1 app: schedule, store, card, `spot.tsx` | Sonnet | The pure function is fully specified by the two specs' rule lists | Spec tests 1–13; mutation probes 2 and 3; browser-pane check at 390 px and desktop; adversarial review |
| Putting the 60 fact strings and 11 nudge strings into `i18n.ts` | Haiku | Pure copying from Appendix A | The parity test plus the spec-match test (it reads the spec and compares every string), so a typo goes red; Sonnet builder spot-checks the diff |
| PR 2: nudge, result screen, one-liner, button | Sonnet | Clear rules, tested as a pure function first | All 19 nudge tests; mutation probes 1–5; browser-pane check; adversarial review |
| Johnny's corrections | Haiku | Replacing strings he supplies | Spec-match test (the spec is corrected first, then the strings); Claude reads the diff |
| Merging and publishing | the session model | Judgement, ordering with other sessions | `/ship`; `/api/healthz` shows the new commit before any check on the live site |

Every agent prompt carries, word for word: *commit early and often in the worktree, keep a `CHECKPOINT.md` (what's done, what's next), commit after EACH item, not at the end; do not spawn nested background agents.* Each reviewer gets its own worktree.

---

## Linear

- **SYC-36, SYC-48:** a comment with this plan's PR, and the PR 1 / PR 2 split.
- **SYC-343:** a comment linking the plan.
- **SYC-350:** the Google Play finding above.
- **New, filed with this plan (deduplicated first):**
  - A settings page on the team dashboard for the nudge and facts (Decision 1 B), after launch.
  - Fill `signedInRole` when the app gets guardian and team sign-in (C4), under SYC-53.
  - A publish slot for Johnny's corrections arriving after 26 Oct (on the launch plan's list).

---

## Still needs Samuel

1. Approve this plan.
2. Decisions 1 and 2.
3. OK for M0, if Decision 2 is A (it creates a temporary database copy and spends about 10 matching calls).
4. Send SYC-360 to Syros Cats (answers by Mon 19), knowing the four-fact worst case above.
5. Your Replit pull before the 23 and 26 Oct publishes, and before any settings change (Decision 1 A).

---

## Review outcome

An independent adversarial review (Sonnet) read this plan against both specs, `origin/main` and the launch plan. Its findings and what happened to each are in [`match-wait-screen-review.md`](./match-wait-screen-review.md).

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

## Appendix B: the one new sentence (privacy policy, SYC-66)

The only visitor-facing sentence this plan adds. The privacy policy is written in English today (`docs/specs/privacy-policy.md`); the Greek and French drafts are for whenever it's translated, and go in Johnny's pack with the rest.

| | Text |
|---|---|
| English | When someone taps "Help feed a cat", we add one to a count for that day. We don't record who tapped it, their phone, or where they were. |
| Ελληνικά | Όταν κάποιος πατά «Βοήθησε να φάει μια γάτα», προσθέτουμε ένα στη μέτρηση εκείνης της μέρας. Δεν καταγράφουμε ποιος το πάτησε, το τηλέφωνό του ή πού βρισκόταν. |
| Français | Quand quelqu’un appuie sur « Aide à nourrir un chat », nous ajoutons un au compte de la journée. Nous n’enregistrons ni qui a appuyé, ni son téléphone, ni où il se trouvait. |

The button's name in each language matches `feedNudgeHelp` (Appendix A.1).
