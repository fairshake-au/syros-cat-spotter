# Launch measures: a report on the team dashboard

SYC-795 · parent SYC-760 · draft 30 Oct 2026 · for Samuel's approval

## 1. What this is

A new report under **Reports** on the team dashboard, called **Launch measures**. It shows the five numbers Samuel chose on 30 Oct 2026 (SYC-760), one row per week, starting with launch week. These numbers decide what gets built after the post-launch hold. The report is how anyone, Samuel included, can read them without asking Claude.

Samuel's answers this spec builds on (SYC-760, 30 Oct 2026):

- Measures: "Spots and spotters (Rec.), Share matched (Rec.)" and "Match wait time, Matching accuracy, Follow-card effect".
- Where: "Add a new report into the dashboard".
- Targets: "Baseline the launch week's numbers once it launches. Launch will be deferred by at least a week, possibly longer".

So the report has **no targets**. The first full week after launch is the **baseline**: every later week is read against it.

This doesn't depend on how Syros Cats work day to day. Every number is about how people use the app. So the "ask Syros Cats before the spec" rule doesn't apply.

## 2. What a team member sees

The Reports list gets a sixth built report, after Vet visits and costs:

> **Launch measures** — How the app is being used since launch, week by week.

The page follows the other reports: the time-range bar at the top, then one section per measure, each with a headline figure, a weekly chart and a weekly table. It ends with a "how this is counted" note and a spreadsheet download for people allowed to export.

**The default range is "Since launch".** It runs from the launch date (§3) to today. The other ranges (this month, last 3 months, this year, all time, dates you choose) still work. Weeks before launch show greyed, labelled "Before launch (testing)", so tester activity is never mistaken for real use.

**Launch week is marked** in every table and chart as "Launch week (baseline)". Each later week shows its figure next to the baseline figure, as a plain difference ("+12 on launch week", "−3 points on launch week"). There is no red or green: without targets, a rise isn't automatically good.

Every section repeats the dashboard's existing promise: **spotters are counted, never named or ranked.** No list on this page leads back to a person or a device.

## 3. The launch date

The report needs to know when launch was, because launch has moved (SYC-604) and may move again. The date is **not written into the code**.

- A new app setting, `launch_date`, holds the Athens calendar date of launch. It works like the other team switches: it's set with `db-ops set-setting`, and a missing or wrongly shaped value falls back safely.
- **Before it's set,** the page says "Launch date not set yet. Showing all time." There's no baseline row, and every week is labelled "Before launch (testing)".
- **Launch week** is the Athens Monday-to-Sunday week that contains the launch date. If launch falls after Wednesday, that week is short. Then the baseline is the **first full week**, and the page says which week it used and why.
- Setting the date becomes a step on the launch-day checklist (SYC-345). It's added there when this ships.

## 4. The five measures, and exactly how each is counted

All weeks are Athens weeks, Monday 00:00 to Sunday 24:00, the same weeks as the other reports. The dashboard calls a spot a **sighting** on every other page, so this page does too. Every count uses each cat's **current** record, so merges and moved sightings (which-cat-is-which, SYC-150/59/410) are already reflected. The page says, as the other reports do, "Figures change as records are corrected".

### 4.1 Sightings and spotters

*What it tells us:* is the app being used at all, and by how many people?

- **Sightings:** sightings sent that week, counted by the date each was sent. This matches the Coverage and spotting report, and the two must give the same weekly number.
- **Spotters:** how many different devices sent at least one sighting that week. A deleted spotter's sightings count as sightings but not as spotters. The page says so in Coverage's existing words.
- **Returning spotters:** of that week's spotters, how many also sent a sighting in an earlier week since launch. That separates new people from people coming back. It's the same data, just one more column.
- **Shown:** sightings and spotters as a weekly chart, and the three columns in the table.
- **Caveat on the page:** "November is the quiet season on Syros. A drop may be the season, not the app."

### 4.2 Share matched

*What it tells us:* is the island's record of cats filling in, or are sightings falling through?

Every sighting sent that week lands in exactly one of these groups. The groups add up to 100%:

| Group | How it's decided |
|---|---|
| Matched to a suggested cat | The spotter picked one of the cats the app suggested |
| Matched to a cat they found themselves | The spotter picked a known cat by hand (nearby list, search, cat page) |
| A new cat | The spotter said it's a cat we don't know yet |
| Sent to the team | The spotter couldn't tell, and the team was asked to decide |
| Not finished | The sighting was sent but the spotter never chose (still waiting after 48 hours) |
| No cat in the photo | The app said no photo in the sighting shows a cat |

- **Shown:** a stacked weekly bar of the six groups, and a table with each group as a count and a percentage.
- **The headline figure:** "Matched to a known cat". That's the first two groups together, as a share of sightings that were finished.
- The 48-hour wait means the current week's "Not finished" share is always too high. The current week is labelled "Still open" until 48 hours after it ends.

### 4.3 Matching accuracy

*What it tells us:* when the app suggests a cat, is it the right one? This is the baseline SYC-56 asks for, and it decides whether matching gets work next.

The app already records what it suggested for each sighting, what the spotter chose, why a hand-picked cat wasn't suggested, and whether the team later moved the sighting to a different cat. This measure is built from those records. It looks only at sightings that **ended up on a known cat** and where the matcher **actually ran** (it didn't fail and the photo wasn't missing).

| Figure | Meaning |
|---|---|
| Right first time | The cat it ended up on was the app's first suggestion |
| Right, lower down | The cat was among the suggestions, but not first |
| Missed, but nearby | The spotter picked a cat the app looked at and didn't suggest |
| Missed, too far away | The spotter picked a cat the app never looked at, because it was outside the 500 m the matcher searches |
| Later corrected | The spotter took a suggestion, and the team later moved the sighting to a different cat |

- **The headline figure:** "Right first time", as a share of the sightings above.
- **Team-checked figure:** a second, stricter figure counts only sightings where the team actually looked: the team said "looks right" or "different cat", or moved the sighting. It's slower to fill up, but nobody has to take the spotter's word for it. The page shows how many sightings it's based on, and hides it below 20 ("Not enough checked yet").
- **Caveat on the page:** "A suggestion the spotter accepted, and nobody checked, counts as right. The team-checked figure is the one to trust once it has enough sightings."

### 4.4 Match wait time

*What it tells us:* how long a spotter waits after "Check for matches". Island signal can be slow, and a long wait loses spots. This is SYC-389's measure.

The app doesn't keep a reliable record of this today, so this measure needs one new recorded number (see **Decision 1** in §7). With the recommended option, it shows:

- **Typical wait** (the median) and **slow end** (the 90th percentile) per week, in seconds, as two lines on one chart.
- What it covers: the server's part only, from receiving the photos to having the matcher's answer. It doesn't cover the time the phone spends uploading the photos on island signal. The page says this in one line: "Doesn't include upload time on the spotter's phone".
- When the matcher ran more than once for a sighting (a re-check, or the same photo sent twice), only the first run counts.

SYC-389's own rule still applies: if the typical wait is under 2 seconds, those numbers go to Samuel with a recommendation about the feeding nudge.

### 4.5 Follow-card effect

*What it tells us:* does asking for an email address after a sighting put people off sending the next one? This is SYC-376's measure. The risk comes from `docs/specs/email-capture.md` §10.1.

The "follow this cat" email card on the reward screen **hasn't been built yet**. On origin/main only the nightly news check has shipped, and it sends nothing (#239). So this measure starts as the **before** figure, which is exactly what SYC-376 needs to exist before the card is switched on.

- **The figure:** of the week's finished sightings, the share whose spotter sent **another sighting within 7 days**. It's counted from sightings alone, with no new tracking, as SYC-376 asked.
- A sighting from the last 7 days can't be judged yet, so the current week and the one before are labelled "Still open".
- **Once the card exists,** the date it's switched on is drawn as a marker on the chart. The table then compares the two weeks before with the two weeks after. Recording that date belongs to the card's own build (SYC-45), not to this report. A note goes on SYC-45 when this ships.
- Until then the section says: "The follow card isn't switched on yet. This is the 'before' figure it will be compared against."

## 5. Who can see it, and the download

- **Seeing the report:** anyone on the team who can see reports today (the existing reports permission). It's island-wide, like Coverage. It isn't added to the cat guardians' view.
- **Downloading:** anyone who can export reports today gets one spreadsheet (CSV) per measure, one row per week. The baseline week is flagged in its own column. Dates are YYYY-MM-DD, as in the other downloads.
- **Nothing personal leaves the page:** no device, no name, no place finer than "on Syros". Accuracy and wait time are percentages and seconds, never a list of sightings.

## 6. What it touches, and who owns what

- **New:** the report's counting module (`lib/reports/launchMeasures.ts`), its page section in `teamPages/reportPages.ts`, and its route alongside the others in `routes/teamReportsArea.ts`.
- **Small changes:**
  - one more entry in the Reports list
  - the `launch_date` app setting
  - Decision 1's recorded number, if Samuel picks it: one database migration
- **Shared areas** (repo CLAUDE.md). The report's words go in the team dashboard's string files. That's the translation area, so the builder brief names its owner. It doesn't change `teamPages/layout.ts`: the Reports nav entry already exists. A migration, if Decision 1 needs one, follows `lib/db/migrations/README.md`, and the coordinator decides when it merges.
- **Speed:** the counting runs over all sightings since launch, which is a few thousand rows in season. It shouldn't need caching. Like the other reports, the page shows how long it took to work out.

## 7. Decisions for Samuel

### Decision 1: how to time the wait (measure 4)

**What this is about.** Nothing the app records today says how long a spotter waited for matches. There's a time stamp for when the matcher last answered, but a re-check overwrites it, so it can't be trusted for this. To show the wait time, the app has to start recording it.

| Option | Benefit | Risk |
|---|---|---|
| **A. Record the server's time for each sighting's first match (Recommended)** | Exact, and easy to explain. It's one small number added to the record the app already keeps. It starts counting from launch day. | It leaves out upload time on the phone, which on weak island signal may be the biggest part of the wait. The page says so. It needs one small database change. |
| B. A as well as the phone reporting its own total wait | The real wait a spotter feels, upload included | Much more to build: the phone has to send a new piece of data, there are app and website versions, and offline sightings need handling. It probably wouldn't be ready by launch. |
| C. Estimate from the time stamps the app already has | Nothing new to record, and no database change | Wrong whenever the matcher ran twice, and we can't tell which ones those are. Any number it shows would be untrustworthy. |
| D. Drop wait time from the report for now | Simplest | One of the five measures you chose is missing. SYC-389 stays unanswered. |

**Recommendation: A.** It's accurate for what it measures, it's small enough to be ready before launch, and the page says plainly what it leaves out. If the server part turns out tiny and spotters still complain about waiting, B becomes its own ticket.

### Decision 2: does an unchecked suggestion count as right? (measure 3)

**What this is about.** Most of the time a spotter accepts the app's suggestion and nobody ever checks it. The headline accuracy figure either trusts those or leaves them out.

| Option | Benefit | Risk |
|---|---|---|
| **A. Headline counts them as right, with a stricter team-checked figure underneath (Recommended)** | A meaningful number from week one, with the trustworthy one beside it once enough sightings are checked | The headline flatters the matcher, because spotters tend to accept a plausible suggestion. The page's caveat has to carry that. |
| B. Team-checked figure only | Only counts what a person confirmed | Blank or tiny for weeks. The team checks few sightings in quiet season, so the launch baseline may never fill. |
| C. Spotter-accepted figure only | Simplest page | Nothing guards against the matcher being confidently wrong |

**Recommendation: A.** It gives you a number now and an honest one as it fills up.

## 8. How we'll know it's right (tests)

- Each measure's counting is a pure function, tested with fixed sightings in fixed Athens weeks. Tests use the Athens week helpers and fixed dates, never "now" or "N days ago". Test cat names are letters only.
- Sightings and spotters per week match the Coverage report's figures for the same range. That's a test with both run on the same rows.
- The six share-matched groups add up to the total for every week.
- A merged cat and a moved sighting are each counted on the cat they ended up on.
- The baseline rules: launch on a Tuesday (that week is the baseline), launch on a Thursday (the next full week is), and no launch date set (no baseline, a message instead).
- The "Still open" labels on the current week (share matched, follow-card), and the 20-sighting floor on the team-checked accuracy figure.
- Wait time (if Decision 1 = A): only the first match is recorded, and a re-check doesn't overwrite it.
- Permissions: someone without reports permission gets the usual refusal, and someone without export permission sees no download links.
- Pages checked at phone width (~390px) and desktop with real-shaped data before the PR opens.

## 9. Out of scope

- Targets. They get set once the baseline exists (Samuel, 30 Oct).
- Welfare reports closed within a week, active guardians, and donation taps. Samuel left these off the measures. Donation taps keep their own ticket (SYC-525).
- Building the follow card itself (SYC-45). This report only measures it.
- Phone-side upload timing (Decision 1, option B), unless Samuel picks it.
- An email or push summary of the numbers. Samuel chose the dashboard.

## 10. Follow-ups this creates

- SYC-345 (launch day): add "set `launch_date`" to the checklist.
- SYC-45 (email capture): record the date the follow card is switched on, so measure 5 can draw its before/after line.
- SYC-389 and SYC-376: point each at this report as where its number now lives. SYC-56 still owns the deeper accuracy work (an evaluation set, stored model version).
