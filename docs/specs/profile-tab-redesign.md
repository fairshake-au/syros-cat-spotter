# The Profile tab, redesigned

**Status:** Samuel chose the design on 23 Oct 2026 ("Option D, revised" on the design canvas) and waived approval of this spec and its plan: "proceed to spec and implementation plan. I don't need to approve either. proceed with the build after they're complete".
**Ticket:** SYC-628 (epic SYC-606). Covers the Profile parts of SYC-578 and SYC-511.
**Design:** [design canvas](https://claude.ai/artifact/8hA67X5utkG9P7FnDnAQnH), bottom row "Option D, revised" (Me tab and Settings screen). The Badges and Spotters tabs follow the "Option D — Profile with tabs" row.
**Covers:** the spotter app's Profile tab (`artifacts/cat-spotter/app/(tabs)/profile.tsx`) and a new Settings screen (`artifacts/cat-spotter/app/settings.tsx`).

## 1. Why

Today the Profile tab is one long page with everything stacked in this order: name, three counts, name editor, a badge grid, a 20-row leaderboard, Keep my spots safe, language, appearance and Delete my data. Seen on the live app on 22 Oct 2026 (SYC-578, SYC-511):

1. **The one setting that stops a spotter losing everything is buried.** "Keep my spots safe: Off" sits below the 20-row leaderboard.
2. **The leaderboard is mostly noise.** Most rows are people on 0 points, including leftover test names.
3. **The counts disagree with Home.** Home shows Spotted / First finds / Badges; Profile shows Cats spotted / First finds / Points.
4. **Badges don't say how to earn them.** A locked badge is a grey padlock, and badge names are cut off on phones ("Cat Whispe…"), worse in Greek. The "how to earn" text already exists in all three languages but nothing shows it.
5. **Settings take up half the page.**

## 2. Goals and non-goals

**Goals**
- The first screen of Profile shows *the spotter's own progress*: their counts, whether their spots are safe, their streak, and what badge is next.
- Every badge says in full how to earn it, and how close the spotter is.
- The leaderboard shows only spotters with points, with the spotter's own row easy to find.
- Settings live on their own screen, reached by a button that says "Settings" in words.
- The three counts are the same three as Home.

**Non-goals**
- No server or API change. Everything shown comes from the existing `GET /profiles/:deviceId` and `GET /leaderboard`.
- No change to Home, the Cats tab, onboarding, or what each setting does.
- The other SYC-578 items (cat-card wording, the empty notifications button, deleting the leftover test accounts) stay on SYC-578.

**Anti-goals** (failures even if it works)
- Showing a confident wrong number: a zero, a rank or "0 of 7" when the real figure is unknown (offline, still loading, or an old server). The existing rule stands: unknown is a dash or nothing, never a plausible zero.
- Making a setting harder to reach than it is today: one tap from Profile, not buried.
- Progress bars that disagree with the badges the server actually awards.

## 3. The design

### 3.1 Top of the Profile tab (all three tabs)

- The Aegean-blue header carries the avatar, the spotter's name and one line beneath: "Spotter", plus " · 4th on the island" when their rank is known (§3.4).
- Right of the name: a **Settings** button. It is a pill showing a gear icon *and* the word "Settings", at least 44px tall. It opens the Settings screen (§3.5). Samuel's concern was that a bare gear "is not clear enough", so it is never icon-only.
- The name follows the same order as Home (SYC-13): nickname, then the saved name, then the name held offline ("Not saved yet" under it), then "Spotter". These come from the phone, so the name shows offline too. The 🐾 watermark and streak chip move: the streak becomes a card on Me (§3.2).
- Below the name: three tabs, **Me**, **Badges** and **Spotters**, full width, each at least 48px tall, with a gold underline on the open one. They switch the content below without leaving the screen. Me is open whenever the screen is first opened. Screen readers hear them as a tab list, with the open one marked selected.

### 3.2 Me

From top to bottom:

1. **Three counts:** Spotted (`catsSpotted`), First finds (`uniqueCatsDiscovered`) and Badges (number earned). Same words, colours and order as Home. Unknown values show a dash.
   - **Before the first spot** (profile loaded and `totalSightings` is 0): instead of three zeros, one card says "Your first spot is waiting" with the line "Spot a cat to start collecting badges." and a **Spot a cat** button that opens the Spot tab.
2. **Safety reminder**, only when Keep my spots safe is known to be **off** (not pending, not on, not unknown or offline). It reads "**Your spots are only on this phone.** Add an email so you can get them back." with an **Add** button that opens the existing Keep my spots safe screen (`/keep-safe`). Once an email is pending or confirmed it disappears; Settings still shows the state.
3. **Streak card**, only when the streak is 1 day or more: "3-day streak" and "Spot a cat today to keep it going."
4. **Badges panel:**
   - A heading "Badges · 3 of 7" and a "See all" link that opens the Badges tab.
   - **Next up:** the first badge not yet earned, in the fixed badge order (§3.3). It shows the badge icon, name, how to earn it, "3 to go" and a progress bar. When every badge is earned, this reads "You've earned every badge."
   - A row of seven small circles, one per badge: earned ones in colour with their icon, the rest as dashed outlines. Tapping the row opens the Badges tab. The row says "3 of 7 badges earned" to screen readers rather than reading seven circles.
   - When the profile has no `badges` list (old server or not loaded), the whole panel is hidden, as the grid is today.

### 3.3 Badges

- A line "3 of 7 earned", then two lists: **Earned** (each with a tick) and **Still to earn**. Badges keep the fixed order within each list.
- Each row shows the icon, the full name (wrapping to as many lines as it needs, never cut off), and the "how to earn" line from the existing `badge_*_desc` text.
- Each badge not yet earned also shows "7 of 10" and a progress bar. Progress uses the same rule the server uses to award it (`artifacts/api-server/src/lib/badges.ts`):

| Badge | Counts | Goal |
|---|---|---|
| First Steps | sightings (`totalSightings`) | 1 |
| First finder | first finds (`uniqueCatsDiscovered`) | 1 |
| Cat Friend | different cats spotted (`catsSpotted`) | 5 |
| Cat Whisperer | different cats spotted (`catsSpotted`) | 10 |
| Great Explorer | first finds (`uniqueCatsDiscovered`) | 10 |
| Island Wanderer | sightings (`totalSightings`) | 25 |
| Island Legend | points | 500 |

  A badge counts as earned only when the server lists it in `badges`. If a count has reached the goal but the server hasn't listed the badge yet, the badge shows as still to earn at "10 of 10". The bar never claims a badge the server hasn't given.
- Unknown profile: the tab shows "Badges will show when you're back online." (offline) or a loading spinner.

### 3.4 Spotters

- The list is the existing top-20 leaderboard with **everyone on 0 points left out**. A short line under it says "Spotters show up here once they've earned points."
- **Rank numbers come from the server**, unchanged. Hiding zero-point rows never renumbers anyone.
- The spotter's own row reads "You" and is highlighted. Other rows show the username, or "Spotter 3F2A" when there isn't one, as today.
- A summary card above the list:
  - In the list, not first: "You're 4th with 85 points" and "35 more points to pass vaporia_vee." (the spotter one rank above).
  - First: "You're top of the island with 310 points."
  - Not in the list but has points: "You have 40 points." and "The top 20 spotters show here."
  - On 0 points: "Spot a cat to get on the board."
  - Unknown (profile not loaded): no summary card.
- The header's "· 4th on the island" uses the same rank, and shows only when the spotter is in the list.
- Offline, the tab says "The leaderboard needs a connection." and shows nothing else.

### 3.5 The Settings screen

A new screen, `/settings`, opened from the Settings button. It has a back arrow and the title "Settings". Everything on it already exists today and moves here unchanged in behaviour:

1. **You:** the name editor (`UsernameEditor`, including the "Change it" note when the name was changed while saving), then **Keep my spots safe** and **Get your spots back** (`KeepSafeSettings`).
2. **Language:** English / Ελληνικά / Français.
3. **Appearance:** Match my phone / Light / Dark.
4. **Your data:** Delete my data.

The conditions that decide when the name editor shows (online, a device id, no name held offline) stay as they are. The rename note still shows on Profile too: a spotter can see it without opening Settings, and its "Change it" button opens Settings with the name editor ready.

Screens that used to return to Profile when there is nothing to go back to (`/delete-my-data`, `/get-spots-back`, `/keep-safe`) keep doing so. When opened from Settings they go back to Settings, as normal back navigation does.

## 4. Words

New text, in English, Greek and French. Greek and French are first drafts for Johnny to check, as with earlier releases (SYC-507).

| Key | English |
|---|---|
| `profileTabMe` | Me |
| `profileTabBadges` | Badges |
| `profileTabSpotters` | Spotters |
| `profileSettingsButton` | Settings |
| `profileRankLine` | {rank} on the island |
| `profileFirstSpotTitle` | Your first spot is waiting |
| `profileFirstSpotBody` | Spot a cat to start collecting badges. |
| `profileSpotACat` | Spot a cat |
| `profileSafeNudge` | Your spots are only on this phone. |
| `profileSafeNudgeBody` | Add an email so you can get them back. |
| `profileSafeNudgeAdd` | Add |
| `profileStreakBody` | Spot a cat today to keep it going. |
| `profileBadgesHeading` | Badges · {earned} of {total} |
| `profileSeeAll` | See all |
| `profileNextBadge` | Next up |
| `profileToGo` | {n} to go |
| `profileAllBadges` | You've earned every badge. |
| `profileBadgesEarned` | {earned} of {total} earned |
| `profileBadgesEarnedList` | Earned |
| `profileBadgesStill` | Still to earn |
| `profileBadgeProgress` | {value} of {goal} |
| `profileBadgesOffline` | Badges will show when you're back online. |
| `profileYou` | You |
| `profileRankSummary` | You're {rank} with {points} points |
| `profileRankPass` | {n} more points to pass {name}. |
| `profileRankTop` | You're top of the island with {points} points. |
| `profileRankOutside` | You have {points} points. |
| `profileRankOutsideBody` | The top 20 spotters show here. |
| `profileRankZero` | Spot a cat to get on the board. |
| `profileSpottersNote` | Spotters show up here once they've earned points. |
| `profileSpottersOffline` | The leaderboard needs a connection. |
| `settingsTitle` | Settings |
| `settingsYou` | You |
| `settingsYourData` | Your data |

Ordinals ("4th") come from a small helper per language: English 1st/2nd/3rd/4th…, Greek "4η θέση"-style ("{n}η"), French 1er/2e/3e. Where a translation reads more naturally with the number elsewhere, the whole phrase is translated, not stitched together.

## 5. Behaviour when things are missing

| Situation | Me | Badges | Spotters | Header |
|---|---|---|---|---|
| Offline with a profile loaded earlier | Shows the last loaded figures, as Home does (§8.1) | Same | Last loaded list | As online |
| Offline, no profile loaded yet | Dashes in the counts; no reminder, streak or badges panel | Offline line | Offline line | Name only, "Spotter" line |
| Online, profile still loading | Spinner, as today | Spinner | List loads alone; no summary card | Name only |
| Profile failed to load | The existing "Couldn't load your stats just now." line; dashes | Same line | List if it loaded; no summary | Name only |
| Old server: no `badges` list | Badges count is a dash; panel hidden | Only the "— of 7 earned" line; no lists | Unaffected | Unaffected |
| Keep-safe state unknown or offline | No reminder | | | |

## 6. Testing

Component tests (vitest, react-native-web), in `components/__tests__/`:

- **Badge progress** (pure helper `lib/badgeProgress.ts`): the goals table in §3.3; "earned" only from the server list; the next badge is the first unearned one in order; all earned gives no next badge; a missing `badges` list returns unknown.
- **Leaderboard helper** (`lib/leaderboardView.ts`): zero-point rows dropped; server ranks kept; the spotter's own row found by spotter code; the pass-target is the row ranked directly above; the four summary cases.
- **Profile screen:** Me is open by default; tapping Badges and Spotters switches content; "See all" opens Badges; the first-spot card replaces the counts at 0 sightings; the reminder shows only when keep-safe is off; the Settings button is labelled "Settings" and goes to `/settings`.
- **Settings screen:** shows the name editor, Keep my spots safe, language, appearance and Delete my data; the back arrow goes back.
- Ordinal helper per language.

Before the PR: check the screen in the web preview at about 390px and at desktop width, in English and in Greek (to catch long words), with real data.

## 7. Other tickets folded in

A Linear sweep on 24 Oct 2026 found open tickets whose Profile or Settings parts this rebuild touches anyway. These parts are done here; the rest of each ticket stays open.

| Ticket | Part done here | Left on the ticket |
|---|---|---|
| SYC-578 | Safety setting moved up; leaderboard without 0-point rows; Profile counts match Home; no three zeros before the first spot (Profile) | Cat-card wording, empty notifications button, deleting test accounts, Home's three zeros |
| SYC-511 | Every badge shows how to earn it; names wrap, never cut off | Nothing on Profile (the silent first badge was SYC-502, done) |
| SYC-13 | The header name uses the same order as Home: nickname, then saved name, then name held offline, then "Spotter". Counts still show dashes when unknown | Nothing (close it) |
| SYC-158 | The Profile header and the Settings screen leave room for top banners with `useBannerAreaReserve()`, as Home does | Cat-alogue, Help, cat detail, notifications, review |
| SYC-594 | The "First finds: Cats nobody had spotted before you." caption stays, tucked directly under the counts (4px, not 20px), with a test that pins it | Its other nits |
| SYC-509 | On Profile and Settings: language and appearance buttons get roles, labels and selected state; Keep my spots safe's Add / Change / Remove links reach 44px; new grey text uses the darker grey that passes contrast | Every other screen |
| SYC-508 | Profile's "Couldn't load your stats just now." line gets a **Try again** button that reloads the profile | Home and other screens |

Not folded in, because they are about other screens: SYC-212 (name-screen wording), SYC-507 (the page language for Greek), SYC-538 (server setting comments). The new Greek and French lines go on Johnny's review list (SYC-346).

## 8. Decisions from the adversarial review (24 Oct 2026)

A Sonnet reviewer checked this spec against the code and raised 10 must-fix and 8 nice-to-have points. Every one is taken. **Where this section and an earlier one differ, this section wins.**

1. **Offline shows recent data, as Home does.** The app keeps the last profile and leaderboard it loaded in memory, so they stay visible offline (the offline banner is already on screen). The "offline" lines in §3.3, §3.4 and §5 show only when nothing was ever loaded. Delete today's comment that says the profile "is not cached".
2. **First spot uses Home's rule.** The first-spot card shows when `homeHeroState(profile) === 'firstSpot'` (`lib/spotted.ts`). When that is `'unknown'`, the counts show dashes.
3. **One set of words for counts and badges.** The tiles use `statSpotted`, `statFirstFinds` and `statBadges`, Home's own keys. The Badges tab label and the "Badges · 3 of 7" heading also use `statBadges`, so Greek says "Διακρίσεις" everywhere on this screen. The Badges count is the number of known badge ids the server lists (`BADGE_IDS` ∩ `badges`), which is what "3 of 7" needs.
4. **Ties on the leaderboard.** Ranks are list positions from the server, and the server breaks ties in no fixed order. When the row above has the same points, the summary says "You're level with {name} on {points} points." Never "0 more points", never "tied for 3rd". A server tiebreaker goes to a follow-up ticket.
5. **Register the screen.** Add `settings` to the `Stack` in `app/_layout.tsx` with `headerShown: false`, like the other pushed screens.
6. **Leaving Settings.** Its back arrow does `router.canGoBack() ? router.back() : router.replace('/(tabs)/profile')`. After a web refresh, Profile opens on Me.
7. **The rename note and "Change it".** The note shows on the Me tab and at the top of Settings. Both read and clear the same `nameNote`. "Change it" on Me clears the note and opens `/settings?editName=1`. Settings reads that and asks the name editor to open, by bumping its own `editRequest` once the editor is mounted. "Change it" on Settings bumps it directly. "Dismiss" clears the note on both.
8. **Exact rule for the safety reminder.** Show it only when online, keep-safe data has loaded without error, and `status === 'none'`. Also hide it while the first-badge offer is due (`keepSafeOffer === 'skipped-onboarding'`), so it never appears beside that sheet. **Add** opens `/keep-safe` with no extra parameters.
9. **Name and "You".** The header name is `profile.nickname ?? profile.username ?? username ?? heldUsername ?? "Spotter"`, as Home does. The spotter's own leaderboard row is matched by `spotterCode`. When the profile has no `spotterCode`, there is no "You" row, no rank in the header and no summary card.
10. **Missing counts.** When the count a badge needs is missing (an old server), its row shows only the "how to earn" line, with no number or bar. Shown progress is capped at the goal (`min(value, goal)`). Island Legend's row reads "85 of 500 points".
11. **Reuse existing words where they already mean the same thing:** `you`, `seeAll`, `profileStreak` ("{n}-day streak"), `profileBadgeCount` ("{earned} of {total}"), `language`, `appearance`, `profileRole` (the header's "Spotter" line). Drop `profileYou`, `profileSeeAll` and `profileBadgeProgress`.
12. **Rank wording is translated as a whole phrase,** with the number placed inside it by each language. English uses ordinals ("4th on the island", "You're 4th with 85 points"). Greek avoids gendered ordinals: "Θέση {n} στο νησί" and "Είσαι στη θέση {n} με {points} πόντους". French uses "{n}e sur l'île", with "1er" for 1. A small `formatRank(language, n)` helper does this and is tested.
13. **Tabs fit in Greek and at large text sizes.** Each label stays on one line, can shrink to fit (`adjustsFontSizeToFit`, minimum 80%), and is at least 48px tall. The tabs sit inside the blue header, under its safe-area padding. On a 320px phone the Settings pill keeps its word, and the name gives way (one line, cut with "…").
14. **Accessibility.** The tabs are `tablist` / `tab` with selected state, and the content below is labelled by the open tab. The Settings pill has the label "Settings". Each progress bar reports `min`, `max` and `now`. The row of seven circles is one button labelled "3 of 7 badges earned. See all badges."
15. **Dark mode.** Every new colour comes from `useColors()` or the existing tone palette used by `StatTile`. Check the screen in dark mode before the PR.
16. **Leaderboard edge cases.** When `profile.points` is missing, there is no summary card. When nobody has points, the tab shows "Nobody's on the board yet. Spot a cat to be first." Spotters with points keep their username, even leftover test names; deleting those accounts stays on SYC-578.
17. **Navigation.** "Spot a cat" does `router.push('/spot')`, as Home does. "See all" and the circle row only switch the tab, without leaving the screen.
18. **Problem-to-section map.** Each §1 problem is fixed in: 1 → §3.2 (2); 2 → §3.4; 3 → §3.2 (1) and this section (3); 4 → §3.3; 5 → §3.5.

## 9. Open questions

None blocking. Recorded assumptions:
- Badges and Spotters tabs follow Option D because Samuel's message specified only Me.
- Greek and French wording needs Johnny's check (filed as a follow-up).
