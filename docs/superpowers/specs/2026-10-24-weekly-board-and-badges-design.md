# A weekly Spotters board, and 13 new badges

Status: draft for Samuel's review · 24 Oct 2026 · Samuel's choices are marked **(Samuel)**. Everything else is Claude's call and is listed at the end so it can be checked.

## Why

Two things go wrong with the way the app rewards spotters today **(Samuel)**:

1. **Early leaders lock up the board.** The Spotters board is one all-time points table. Whoever started first has a lead nobody who arrives later can close, so most spotters look at it once and stop caring.
2. **People are active for a few days, then drop off.** All 7 badges reward doing *more* (more sightings, more cats, more points). None rewards *coming back*.

The people this is for are spotters on Syros for more than a week **(Samuel)**: cat guardians, locals, people with a holiday home, and long-stay visitors.

What Syros Cats most wants from spotters, beyond coming back, is **finding more cats** and **covering every part of the island** **(Samuel)**.

## What it becomes

### 1. The Spotters board goes weekly

- The board opens on **This week**. A switch at the top flips to **All time**, the table as it is today **(Samuel, option B)**.
- A week runs from **Monday 00:00 to the next Monday 00:00, Greek time (Europe/Athens)**, including the clock changes.
- **Points are earned exactly as now** **(Samuel)**: 25 for a new cat, 15 for spotting a known cat. No bonus for quiet areas; coverage is left to badges. A spot's points count in the week it **earned** them (the moment the spot was confirmed and points were added), not the week the photo was taken.
- **This week** shows, as the current board does: people on 0 points this week are left out, "You" is highlighted, and the summary card says where you stand ("You're 4th this week · 55 pts" / "15 more to pass Eleni"). Under the summary: "New week in 3 days" (or "in 5 hours" on the last day).
- Under the list: **Last week's top three** ("🏆 Last week: Marco, Eleni, Sophie").
- On Monday morning the This week list is empty. It says so in a friendly way ("A new week has started. Spot a cat to get on the board."), and last week's top three still show.
- **All time** is today's table and summary, unchanged. Your all-time total also stays on your profile.
- Ties: people on the same points share a place (two people on 120 are both 1st; the next person is 3rd). This applies to both tabs and to the weekly badges.

The mockup Samuel chose from is option B in `.superpowers/brainstorm/…/weekly-board.html`. The names and numbers in it were made up.

### 2. Thirteen new badges

All 13 were picked by Samuel from the full candidate list **(Samuel)**. Names and thresholds are first drafts and can be changed while reviewing this document. The 7 existing badges stay as they are, so there are **20** in all.

| Group | Badge | How you earn it |
|---|---|---|
| Coming back | **Back again** 📅 | Spot a cat in 2 different weeks |
| | **Regular** 🗓️ | Spot a cat in 4 different weeks |
| | **Part of the island** 🏡 | Spot a cat in 8 different weeks |
| Weekly board | **Podium** 🥉 | Finish a week in the top 3 |
| | **Champion of the week** 🏆 | Finish a week in 1st place |
| Finding cats | **Cat finder** 🐾 | Be the first to spot 25 new cats |
| | **Master cat finder** 🐈 | Be the first to spot 50 new cats |
| | **Hundred cats** 👑 | Be the first to spot 100 new cats |
| Covering the island | **Wanderer** 🧭 | Spot cats in 3 different areas |
| | **Roamer** 🗺️ | Spot cats in 8 different areas |
| | **All of Syros** 🏝️ | Spot cats in every area of the island |
| | **Pathfinder** 🔦 | Find a new cat in an area nobody has spotted a cat in for 30 days |
| | **Trailblazer** 🚩 | Find the first cat ever known in an area |

Not chosen: "Three good days" (3 days in one week) and "Hat-trick" (top 3 in three weeks).

What the words mean:

- **"Spot a cat"** means a spot that earned points: either confirmed as a known cat or registered as a new one. A spot still waiting for the team counts from the moment it's confirmed.
- **"A week"** is the Monday-to-Monday Greek-time week above.
- **"Area"** is one of the named areas the team keeps on the dashboard's Areas page (about 20 today: Ermoupoli, Kini, Galissas, Chalandriani, Grammata and so on). A spot is in the area whose centre is nearest, the same rule the dashboard uses. Spots that count as "Off Syros" are not in any area.
- **All of Syros** means every area on the list at the moment of the spot that completes it. If the team adds an area later, people who already have the badge keep it; others now need the new area too.
- **Pathfinder:** the new cat's area had no confirmed spot by anyone in the 30 days before this one.
- **Trailblazer:** when the new cat was registered, no other cat was known in that area. If the team adds an area that already contains cats, nobody gets Trailblazer for it.
- **Badges are never taken away.** Once earned, a badge stays, even if areas are renamed, moved or retired, or the spot is later found to be a duplicate.

### 3. Existing spotters, on the day this goes live

- Badges that can be worked out from history are **awarded from history**: weeks spotted, areas spotted in (using today's areas), new cats found, and Trailblazer (the first cat in each of today's areas, by registration date). Pathfinder is worked out from history the same way.
- Podium and Champion start with **the first full week after launch**. There are no weekly results from before, so no backdated podiums.
- Badges given from history don't come with a push. The first time each spotter opens the updated app, they see **one** celebration screen for all of them together ("Your spots so far have earned you 4 new badges"), with the medals in a row, one sound and one buzz, rather than a dozen celebrations one after another. After that they carry the "New" marker on the Badges tab.

### 4. Earning a badge should feel like a reward

Today a new badge only shows as a small "New badge: …" pill with a plain award icon on the "well done" screen after a spot (`app/review.tsx`). There's no picture of the medal, nothing to say what it means or what comes next, and once you tap past it nothing on the profile marks it as new. Samuel wants badges to feel more rewarding **(Samuel)**. The model is an animated on-screen popup with a sound that says you've earned a badge and what it means **(Samuel)**.

**The badge celebration** (every badge, old and new, uses this one style **(Samuel: option A for all)**):

- It takes over the **whole screen**, in deep Aegean blue, with confetti in the app's colours.
- The medal grows in with a small bounce and a shine runs across it. A **short, cheerful sound** plays and the **phone gives a buzz** at the same moment.
- Under the medal: "New badge", the badge's name, and **one sentence saying what it means and why it helps the cats** ("You've spotted cats in 3 different parts of Syros. Every new area helps Syros Cats find the cats nobody knew about."). Each of the 20 badges gets its own sentence.
- **What's next:** the next badge in the same group, with a progress bar ("Next: Roamer 🗺️ · 3 of 8 areas"). When it's the last badge in a group, this says so instead ("You've got every coverage badge").
- One big button closes it ("Lovely!"), and a link goes to "See all my badges".
- **Two or more badges at once** come one after the other, with "1 of 2" shown, and each gets its own medal, sound and buzz.
- **When it appears after a spot:** straight after the "well done" screen has shown the cat and the points, and before the questions about the cat. The spot stays the first thing you see; the badge comes next.
- **Sound respects the phone.** No sound when the phone is on silent or the app is muted. A "Celebration sounds" switch in the profile's settings turns it off for good (on by default).
- **Reduced motion.** If the phone is set to reduce motion, there's no confetti, bounce or shine. The medal simply appears. The sound and buzz still follow the settings above.
- The mockup Samuel chose from is option A in `.superpowers/brainstorm/…/badge-moment.html`.

**On the profile's Badges tab:** a badge earned since you last looked carries a small "New" marker until you've seen the tab. Tapping any earned badge plays its celebration again, without confetti or sound, so people can show it off.

**How spotters hear about each badge:**

- **The 18 badges a spot earns** (everything except Podium and Champion) get the celebration straight after that spot, as above.
- **Podium and Champion** are decided when the week closes, when the spotter usually isn't in the app. So:
  - **On Monday morning** every top-3 spotter with push notifications on gets a push **(Samuel: "tell them on Monday too")**: "🥉 You came 2nd on Syros last week. You've earned Podium!" (or "🏆 You were the top spotter on Syros last week…"). It's sent at about 08:00 Greek time, not at midnight. Tapping it opens the app to the celebration.
  - **The next time they open the app**, they get the full-screen celebration whether or not the push arrived, with a line about their week above the medal ("You came 2nd last week with 95 points"). It plays once.
  - The same news also sits under the notification bell, so it isn't lost.
- Push uses the app's existing push system (the one that sends the daily cat round-up). People on the web app, or who said no to notifications, get the card and the bell entry only.
- A podium finish is celebrated every time it happens, not just the first: coming 2nd in a later week gets the push and card again, even though the Podium badge was already earned. The badge itself is earned once.

### 5. Greek

Every new line (badge names, descriptions and "what it means" sentences, the tabs, the countdown, the empty week, last week's top three, the push, the celebration screen and the sounds setting) is written in English and Greek, like every other line in the app.

## Goals

- A spotter who arrives in their third week on Syros can reach the weekly top 3.
- A spotter can see which new badges they're close to, as the Badges tab already does for the current ones: "3 of 8 areas", "2 of 4 weeks".
- Winning a week is a moment the spotter hears about, even if they're not in the app that Monday.
- Every spotter's existing points, all-time rank and badges stay exactly as they are.

## Non-goals

- No change to how many points a spot earns.
- No bonus points for quiet areas.
- No new screens apart from the switch on the board, the badge celebration and the sounds setting.
- No change to the team dashboard, apart from anything the builder needs in order to keep the Areas page and the badges in step.
- No email about badges or weekly results.

## Anti-goals (it fails if it does these, even if it works)

- **A spotter can't trust their own number.** If This week, All time, the profile and the "well done" screen ever disagree about points, the board has lost its point.
- **It wakes people up.** No push before morning, Greek time.
- **It nags.** One push per podium week, at most. Never "you're about to drop off the board" or "you haven't spotted this week".
- **A badge disappears.** Badges are never taken away (see above).
- **It rewards unsafe or harmful behaviour.** Nothing should encourage chasing, handling or feeding cats to get a photo, or going onto private land. The Pathfinder and coverage copy should say "spot" and nothing more.
- **It shows where a spotter lives.** Badges and the board name areas only in a spotter's own Badges tab, never next to their name on the public board.

## Constraints from how the app works today

- Points are kept as one running total per spotter (`profiles.points`). There's no dated record of when each point was earned, so the weekly board needs one, written at the moment points are awarded (`routes/sightings.ts`, where `pointsAwarded` is added). The builder decides its shape.
- Badges are worked out fresh from four totals every time (`lib/badges.ts`) and aren't stored. Podium, Champion, Pathfinder, Trailblazer and "never taken away" all need badges to be **stored once earned**.
- The client's badge list, translations and progress goals (`lib/i18n.ts` BADGE_IDS, `lib/badgeProgress.ts`) are pinned to the server's list by a test. The new badges join both.
- Areas come from `areaFor(lat, lng)` over the live named-areas list, which the team can change (at least 5 areas always remain).
- Deleting an account (`me.delete`, `severPerson`) must remove or unlink everything new that names the spotter: weekly points, stored badges, weekly results and pending cards.
- "Keep my spots safe" moves a spotter to a new device (`keepSafe/move.ts`). Weekly points, badges and results move with them.
- The weekly close must run once and only once per week, even if the server restarts or two copies run. The daily round-up's "claim the run first" pattern (`push_roundup_runs`) is the model.
- Use the existing push helper and push tokens; delivery is best effort and never blocks anything.
- The app already has `expo-haptics` (the buzz) and `react-native-reanimated` (the animation). It has no audio library, so the sound needs one added (`expo-audio` is the Expo-standard choice), plus a short sound file the charity is free to use.
- The celebration must work on the web app too, where there's no buzz and browsers may block sound until the page has been tapped.
- Draft PRs, local tests before `gh pr ready`, per the project's working rules.

## Left to the builder

- The shape of the dated points record and the stored badges.
- How the weekly close is triggered (an in-server schedule like the round-up, or the Cloudflare cron worker that already calls the mail drain).
- The exact push time on Monday morning, within "morning, Greek time".
- How the history backfill runs (a migration or a one-off job), as long as it's safe to run twice.
- Medal artwork for the 13 new badges. Use the emoji above as the starting point, in the existing `BadgeMedal` style.
- How the Badges tab groups 20 badges. Grouping by the four headings above is the suggestion.

## Claude's calls (for Samuel to check)

1. Weeks run Monday 00:00 to Monday 00:00, Greek time.
2. A spot's points count in the week it was confirmed, not the week the photo was taken.
3. Ties share a place, and everyone tied in the top 3 gets Podium.
4. Monday's push goes out at about 08:00 Greek time, not at midnight.
5. Badges are never taken away.
6. History counts: existing spotters get the badges their past spots have already earned, with no push and one combined celebration the first time they open the updated app. Podium and Champion start from the first full week after launch.
7. A podium finish gets a push and a celebration every time, but the badge is earned once.
8. "All of Syros" means every area on the list at the time. People who already have it keep it when an area is added.
9. Pathfinder's quiet period is 30 days.
10. Areas never appear next to a spotter's name on the public board.
11. The celebration comes after the "well done" screen, never before it, so the spot stays the first thing people see.
12. A "Celebration sounds" switch, on by default, and no sound on a silenced phone.
13. Reduced-motion phones get no confetti or animation.
14. A "New" marker on the Badges tab, and tapping an earned badge replays its celebration quietly.
15. Each badge gets one sentence saying what it means and how it helps the cats.
