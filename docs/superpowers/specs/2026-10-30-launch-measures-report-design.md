# Launch measures: a report on the team dashboard

SYC-795 · parent SYC-760 · draft 4, 30 Oct 2026 · adversarial review folded in (§11) · both decisions made (Decision 1 = A; Samuel checks matches, §4.6) · for Samuel's approval

## 1. What this is

A new report under **Reports** on the team dashboard, called **Launch measures**. It shows the five numbers Samuel chose on 30 Oct 2026 (SYC-760), one row per week, starting from launch. These numbers decide what gets built after the post-launch hold. The report is how anyone, Samuel included, can read them without asking Claude.

Samuel's answers this spec builds on (SYC-760, 30 Oct 2026):

- Measures: "Spots and spotters (Rec.), Share matched (Rec.)" and "Match wait time, Matching accuracy, Follow-card effect".
- Where: "Add a new report into the dashboard".
- Targets: "Baseline the launch week's numbers once it launches. Launch will be deferred by at least a week, possibly longer".

So the report has **no targets**. The first full week after launch is the **baseline**: every later week is read against it.

This doesn't depend on how Syros Cats work day to day. Every number is about how people use the app, so the "ask Syros Cats before the spec" rule doesn't apply.

## 2. What a team member sees

The Reports list gets a sixth built report, after Vet visits and costs:

> **Launch measures** — How the app is being used since launch, week by week.

The page follows the other reports. Its sections, in order:

- the time-range bar
- one section per measure, each with a headline figure, a weekly chart and a weekly table
- a "how this is counted" note
- spreadsheet downloads, for people allowed to export

**The page opens on "Since launch".** That runs from the launch date (§3) to today. The other ranges work as they do everywhere else. "Since launch" belongs to this report only: it's this page's default plus one extra link on its own range bar. The shared range code and the other reports' bars don't change. Weeks before launch show greyed and labelled "Before launch (testing)".

**The baseline week is marked** in every table and chart as "Baseline (first full week after launch)". Each later week shows its figure next to the baseline's as a plain difference ("+12 on baseline", "−3 points on baseline"). There is no red or green: without targets, a rise isn't automatically good.

**Small numbers are labelled, not hidden.** Every percentage shows its count beside it ("62% · 31 of 50"). A week with fewer than 20 sightings behind a percentage shows the count but greys the percentage, with "Too few to compare". Off-season weeks will be small, and one cat can swing a share by 10 points.

Every section repeats the dashboard's existing promise: **spotters are counted, never named or ranked.** Nothing on this page leads back to a person or a device.

## 3. The launch date and the baseline

Launch has moved (SYC-604) and may move again, so the date is **not written into the code**.

- **A new team setting, `launch_date`,** holds the Athens calendar date of launch. It's added the same way as the existing settings: one more known key, with a shape check that accepts only a real date written YYYY-MM-DD, set with `db-ops set-setting`. A bad value is refused when it's written. A missing value reads as "not set".
- **Before it's set,** the page says "Launch date not set yet. Showing the last 3 months." There's no baseline, and every week is labelled "Before launch (testing)".
- **The baseline** is the first full Athens week (Monday to Sunday) that starts on or after the launch date. Launch-day traffic is unusual and a part-week isn't comparable, so the days between launch and that Monday show as their own row, labelled "Launch days".
- **Setting the date is a launch-day step.** It's added to SYC-345 when this ships.

## 4. The five measures, and exactly how each is counted

**Weeks.** All weeks are Athens weeks, the same as in the other reports.

**When a sighting counts.** Each sighting counts in the week it was **spotted**: the time the photo was taken. That's the same as the Coverage report. A spotter on poor signal can send a sighting up to 30 days later, so **a past week's figures can still go up**. The page says: "Counted by the day each cat was spotted. Sightings sent late are added to the week they were spotted, so recent weeks can still grow."

**Corrections.** Each count uses each cat's current record, so merged cats and moved sightings are already reflected. The page says, like the other reports, "Figures change as records are corrected".

**Wording.** Every other page calls a spot a **sighting**, so this page does too.

### 4.1 Sightings and spotters

*What it tells us:* is the app being used, and by how many people?

- **Sightings:** sightings spotted that week. These are counted exactly as Coverage counts them, reusing its list of sightings, and the two must agree week by week.
- **Spotters:** how many different phones or browsers sent at least one sighting that week. A sighting from a spotter who has since deleted their account counts as a sighting but not as a spotter, in Coverage's existing words.
- **Returning spotters:** of that week's spotters, how many also sent a sighting in an earlier week since launch.
- **Shown:** sightings and spotters as a weekly chart, and the three columns in the table.
- **Caveats on the page:**
  - "A spotter here is a phone or browser. One person on two devices counts twice."
  - "November is the quiet season on Syros. A drop may be the season, not the app."
- **Testers.** There's no way to mark a tester's sightings. The baseline starts after launch, and SYC-689 clears test spotters before launch, which together cover most of them. Any tester still active after launch is counted. The method note says so.

### 4.2 Share matched

*What it tells us:* is the island's record of cats filling in, or are sightings falling through?

Every sighting spotted that week falls in exactly one group. The rules are checked **in this order**, and the first that applies wins:

| # | Group | Rule |
|---|---|---|
| 1 | Not finished | The spotter never chose a cat |
| 2 | No cat in the photo | The app said no photo shows a cat, whatever happened next |
| 3 | Matched to a suggested cat | The spotter picked one of the cats the app suggested |
| 4 | Matched to a cat they found themselves | The spotter picked a known cat by hand |
| 5 | A new cat | The spotter said it's a cat we don't know yet |
| 6 | Other or not recorded | Anything left, such as a sighting whose match record didn't save |

- **Shown:** a stacked weekly bar of the six groups, and a table with each group as a count and a percentage. Group 6 should be near zero. If it isn't, that's a fault worth a ticket, and the method note says so.
- **The headline figure:** "Matched to a known cat". That's groups 3 and 4, as a share of sightings that were finished (groups 2 to 6).
- **Matching was down.** Group 4 or 5 sightings where the matcher was down are marked in the table as "of which the matcher was down", because there the spotter had no suggestions to take.
- **The current week.** A sighting usually gets finished within minutes, so "Not finished" is only fair once a week is over. The current week is labelled "Still open", and its "Not finished" share is greyed until 48 hours after it ends. The 48 hours is this report's rule, not something the app records.
- **No "sent to the team" group.** The app has a place to record a sighting sent to the team, but nothing uses it yet. If that's built, it becomes its own group.

### 4.3 Matching accuracy

*What it tells us:* when the app suggests a cat, is it the right one? This is the baseline SYC-56 asks for, and it decides whether matching gets work next.

**Which sightings count.** Only sightings where the matcher ran properly, and the spotter either took a suggestion or picked a known cat by hand. Each figure is decided by **what was recorded at the moment the spotter chose**: their choice and which suggestion it was. It's never decided by comparing cat numbers afterwards. That way a later merge of two records of the same cat can't make a right answer look wrong.

| Figure | Rule |
|---|---|
| Right first time | The spotter took the first suggestion, and the team hasn't moved it since |
| Right, lower down | The spotter took the 2nd or 3rd suggestion, and the team hasn't moved it since |
| Suggested, then corrected | The spotter took a suggestion, and the team later moved the sighting to another cat or a new cat |
| Missed, though compared | The spotter picked by hand a cat the app looked at but didn't suggest |
| Missed, too far away | The spotter picked by hand a cat outside the 500 m the matcher searches |
| Missed, nothing to compare | The spotter picked by hand, and the app had no cats within 500 m to look at |

- "The team moved it" means a real correction. A sighting moved because two records of the same cat were merged (or a merge was undone) is not a correction, and doesn't count.
- **The headline:** "Right first time", as a share of all six rows.
- **The checked figure:** of the suggestions Samuel has checked (§4.6), the share he said looks right. It sits under the headline with its count ("Checked: 88% right · 44 of 50"). Below 20 checked it shows "Not enough checked yet". This is the figure to trust; the headline is the fast one.
- **Corrected by the team:** as a share of suggestions taken. It counts corrections made anywhere, including outside the check list.
- **Caveat on the page:** "The headline counts a suggestion nobody checked as right. The checked figure is the one to trust once it has enough behind it."

### 4.6 Matches to check (Samuel's list)

Samuel decided on 30 Oct 2026 that he checks matches himself: "I'll do the match checking, not the team". This adds a list to the dashboard, built like the existing **Probably sterilised** and **New cats to check** lists.

- **What's on it:** sightings since launch where the spotter took one of the app's suggestions, and nobody has checked or moved the sighting yet.
- **Each row shows:**
  - the spotter's photo next to the chosen cat's main photo
  - the cat's name and number
  - the area and day spotted
  - which suggestion it was (1st, 2nd or 3rd)
- **Two buttons:**
  - **Looks right.** Records that the match was checked and right, and takes it off the list.
  - **Different cat.** Opens the existing move screen with this sighting filled in. Moving it records the correction exactly as moves already do.
- **Order is fixed, oldest first.** It doesn't let you pick easy ones, and it isn't sorted by how confident the app was. Otherwise the checked figure would only measure the easy cases. If Samuel skips a row it stays at the top, so the order is never chosen by hand.
- **Who sees it:** people who can move sightings today. That's the team permission added for moving and merging. Nobody else on the team sees it, and nothing goes to Jacky or Susan.
- **On the road:** it's a phone-width page, usable on Samuel's phone. Server-drawn with no scripts, like the other lists.
- **Where:** a link from the dashboard home with a count ("12 matches to check"), the same way New cats to check is reached.
- **Recording:** "Looks right" fills the match record's team step, which is written once and only while empty, with "looks right", who, and when. The app already allows that value. Nothing writes it today. A later move still counts as a correction, and moves already only fill the step if it's empty. So a sighting checked as right and later moved shows in both rows. The report counts it as "corrected", because the later word wins.

### 4.4 Match wait time

*What it tells us:* how long a spotter waits after "Check for matches". A long wait on island signal loses spots. This is SYC-389's measure.

**What the app keeps today isn't enough.** It does record when the matcher last answered. But that time is overwritten whenever the same sighting is matched again, which happens when a phone sends the same photos twice. And the sighting's own time is when the photo was taken, not when it reached the server. So the app has to start recording the wait (see **Decision 1**). With the recommended option the page shows:

- **Typical wait** (the median) and **slow end** (the 90th percentile) per week, in seconds, as two lines on one chart.
- It covers the server's part only: from the photos arriving to the matcher's answer. Upload time on the phone isn't included, and the page says: "Doesn't include upload time on the spotter's phone".
- It counts **only each sighting's first successful match**. When the matcher was down or timed out, the sighting is left out of the times and counted instead in a third line: "Matcher down or timed out", as a share of sightings. A timeout is about 35 seconds, and mixing those in would drown the typical wait.

SYC-389's own rule still applies: if the typical wait is under 2 seconds, those numbers go to Samuel with a recommendation about the feeding nudge.

### 4.5 Follow-card effect

*What it tells us:* does asking for an email after a sighting put people off sending the next one? This is SYC-376's measure, from the risk in `docs/specs/email-capture.md` §10.1.

**The "follow this cat" email card on the reward screen hasn't been built yet.** I checked origin/main and the app code: the only part of email capture that has shipped is the nightly news check, which sends nothing (#239). So this measure starts as the **before** figure, which SYC-376 needs before the card is switched on.

- **"Before" doesn't mean no ask at all.** Two related things already exist:
  - a spotter's phone already follows a cat it matches, with no email (SYC-624, #308)
  - onboarding already offers "keep my spots safe" by email (SYC-524, #311)

  The method note names both. What's measured is the effect of the *reward-screen* card on top of those.
- **The figure:** of the week's finished sightings, the share whose spotter sent **another sighting within 7 days**. It's counted from sightings alone, with no new tracking, as SYC-376 asked. Sightings from spotters who later deleted their account are left out, since we can't tell whether they came back.
- **When a week is complete.** A sighting from the last 7 days can't be judged yet, and late uploads still arrive, so the current week and the one before are labelled "Still open".
- **Once the card exists,** the date it's switched on is drawn as a marker on the chart. The table then compares the two weeks before with the two weeks after. Recording that date belongs to the card's own build (SYC-45). A note goes on SYC-45 when this ships.
- **Until then** the section says: "The follow card isn't switched on yet. This is the 'before' figure it will be compared against."

## 5. Who can see it, and the downloads

- **Seeing it:** anyone on the team who can see reports today. It's island-wide, like Coverage, and isn't added to the cat guardians' view.
- **Downloading:** anyone who can export reports gets one spreadsheet (CSV) per measure, one row per week. The baseline week is flagged in its own column, and dates are YYYY-MM-DD. Downloads are logged like the other reports' downloads.
- **Nothing personal leaves the page:** no device, no name, no place. Accuracy and wait time are counts, percentages and seconds, never a list of sightings.

## 6. What it touches

- **New:**
  - a counting module, `lib/reports/launchMeasures.ts`
  - its page in `teamPages/reportPages.ts`, in the Reports list, the spreadsheet list and the file names
  - its page and download routes in `routes/teamReportsArea.ts`
- **Settings:** `launch_date` joins the known setting keys and shape checks (`lib/db/src/appSettings/shape.ts`), and the settings reader (`lib/appSettings.ts`).
- **The island-only guard:** the new module is registered in the list of team-only report modules in `guardianView.source.test.ts`, with the reports and export permissions. Without that, the existing safety test fails.
- **Charts** are drawn on the server with the existing chart helpers, like the other reports. The dashboard runs no scripts.
- **Decision 1, option A:** one small database change, adding one number to the match record. It follows `lib/db/migrations/README.md`, and the coordinator decides when it merges. The match code has to note the time the photos arrived and pass it through to where the match is saved.
- **Matches to check (§4.6):**
  - its page, next to `likelyPage.ts` and `newCatsPage.ts`
  - its routes
  - a "Looks right" action that writes the match record's team step
  - its count on the dashboard home
- **Shared areas** (repo CLAUDE.md): reports are English-only and don't use the translation files.
  - The report needs no dashboard layout change, because the Reports menu entry already exists.
  - **The Matches to check page does touch the dashboard layout file** (`teamPages/layout.ts`), to register the page under Home, as the other check lists are. That's a one-line change, but the builder brief names the layout owner.
  - The migration (Decision 1 = A) is the other shared area.
- **Build order:** two PRs.
  1. The report, plus the `launch_date` setting and the wait-time number.
  2. Matches to check.

  The report shows "Not enough checked yet" until PR 2 is in and Samuel has checked 20, so PR 1 doesn't wait for PR 2.

## 7. Decisions for Samuel

### Decision 1: how to time the wait (measure 4): decided, A

**Samuel, 30 Oct 2026:** "Yes, option A". The options as they were put to him:

**What this is about.** The app doesn't currently keep a trustworthy record of how long a spotter waits for matches. To show the wait, it has to start recording one.

| Option | Benefit | Risk |
|---|---|---|
| **A. Record the server's time for each sighting's first successful match (Recommended)** | Exact, and easy to explain. It's one small number added to the record the app already keeps, counting from the day it ships. | It leaves out upload time on the phone, which on weak island signal may be the biggest part. The page says so. It needs one small database change. |
| B. A as well as the phone reporting its own total wait | The real wait a spotter feels, upload included | Much more to build: the phone sends a new piece of data, there's the app and the website, and offline sightings need handling. Unlikely to be ready by launch. |
| C. Estimate from what the app already keeps | Nothing new to record | Wrong whenever a photo was sent twice, or sent late from poor signal, and we can't tell which. Any number would be untrustworthy. |
| D. Drop wait time from the report for now | Simplest | One of your five measures is missing, and SYC-389 stays unanswered |

**Recommendation: A.** It's accurate for what it measures, and small enough to be ready before launch. If the server part turns out tiny and spotters still say they're waiting, B becomes its own ticket.

### Decision 2: who confirms a match is right (measure 3): decided

**Samuel, 30 Oct 2026:** "I'll do the match checking, not the team". So the dashboard gets the **Matches to check** list (§4.6) with a "Looks right" button, for Samuel. The report shows a checked accuracy figure under the headline. This replaces draft 2's options, which were to defer confirming, to have the team do it, or to drop accuracy.

## 8. How we'll know it's right (tests)

**Test rules.** Each measure's counting is a pure function, tested with fixed sightings in fixed Athens weeks. Use the Athens week helpers and fixed dates, never "now" or "N days ago". Test cat names are letters only.

**Sightings and spotters**
- Sightings per week equal Coverage's sightings per week for the same rows. That's a test that runs both. Coverage has no per-week spotter count, so the period's total spotters are compared instead.
- A sighting spotted in week 1 and sent in week 2 counts in week 1.

**Share matched**
- The six groups always add up to the week's total.
- A sighting with "no cat" and a hand pick lands in group 2.
- A finished sighting with no match record lands in group 6.

**Accuracy**
- A correct first suggestion on a cat that's later merged still counts as "Right first time".
- A move made because of a merge is not counted as "Suggested, then corrected".
- A rank-1 suggestion later corrected by the team counts only as "Suggested, then corrected".

**Wait time** (if Decision 1 = A)
- Only the first successful match is recorded.
- Sending the same photos again doesn't overwrite it.
- A timed-out first try followed by a success records the success.

**Matches to check**
- Only suggestions taken, unchecked and unmoved, since launch, oldest first.
- "Looks right" writes the team step once. A second press, or a press after a move, changes nothing.
- A sighting checked right and later moved counts as corrected in the report.
- Someone without the move permission gets the usual refusal and sees no count on the home page.
- The page works at phone width.

**Baseline and labels**
- Launch on a Tuesday gives "Launch days" then the baseline from the next Monday.
- Launch on a Monday gives a baseline that week.
- With no launch date there's no baseline, and a message instead.
- "Still open" and "Too few to compare" appear where §4 says.

**Access and safety**
- Without reports permission you get the usual refusal.
- Without export permission there are no download links.
- The island-only guard test passes with the new module registered.

**Screens:** the page checked at phone width (~390px) and on desktop with real-shaped data before the PR opens.

## 9. Out of scope

- Targets. They get set once the baseline exists (Samuel, 30 Oct).
- Welfare reports closed within a week, active guardians, and donation taps. Samuel left these off. Donation taps keep their own ticket (SYC-525).
- Building the follow card itself (SYC-45). This report only measures it.
- Checking matches the spotter picked by hand, or new cats. New cats already have their own list, and hand picks can come later if the checked figure needs them.
- Phone-side upload timing (Decision 1, option B), unless Samuel picks it.
- Marking tester devices.
- An email or push summary of the numbers. Samuel chose the dashboard.

## 10. Follow-ups this creates

- **SYC-345 (launch day):** add "set `launch_date`" to the checklist.
- **SYC-45 (email capture):** record the date the follow card is switched on.
- **SYC-389 and SYC-376:** point each at this report as where its number now lives. SYC-56 keeps the deeper accuracy work.
- **SYC-56:** note that Samuel's checked matches are its first labelled set.

## 11. Adversarial review (30 Oct), and what changed

An independent reviewer checked draft 1 against the code. I re-checked each blocker in the code before changing anything.

| Finding | Severity | Change |
|---|---|---|
| Nothing records a sighting as "sent to the team", and there's no such choice | Blocker, confirmed | Group removed. "Not finished" is defined as never chosen. |
| The team never records "looks right": the only team step written is a correction on a move | Blocker, confirmed | Team-checked figure replaced with "Corrected by the team", plus Decision 2 |
| A sighting is dated by when the photo was taken (up to 30 days earlier), not when it was sent | Blocker, confirmed | Wording changed to "spotted". Late uploads are explained. "Still open" covers this. |
| Coverage has no per-week spotter count | Should-fix | The cross-check test compares weekly sightings and period spotters |
| Groups weren't exclusive (a sighting can have "no cat" and a choice), and unrecorded rows fit nowhere | Should-fix | Ordered rules, plus an "Other or not recorded" group |
| "Right first time" and "later corrected" overlapped, and a merge could look like a miss | Should-fix | Decided by the recorded choice and rank. Merge moves excluded. Rows made exclusive. The "too far" group split from "nothing to compare". |
| Wait-time option C is also wrong because of capture time, and a timed-out first run would skew A | Should-fix | Both explained. Only the first successful match is timed. Failures get their own line. |
| The spec missed the settings keys, the island-only guard registration, the spreadsheet list and the shared range code | Should-fix | Named in §6. "Since launch" kept local to this report. |
| A follow-a-cat and an onboarding email ask already exist before the card | Should-fix | Named in §4.5. Deleted spotters left out of the 7-day figure. |
| Spotters are devices, testers aren't marked, and weekly numbers are small | Should-fix | Caveats added. A count beside every percentage. "Too few to compare" below 20. |
| The translation-owner note was wrong, because reports are English-only | Nit | Corrected in §6 |
