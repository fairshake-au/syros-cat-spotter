# A cat's page, in four tabs

Status: draft for review · 23 Oct 2026 · Samuel chose Option G ("Tabs") with emojis on the tabs, from the options board at https://claude.ai/artifact/AxVe5L1q4yztMwBMBXMkbT

## Why

A cat's page (`artifacts/cat-spotter/app/cat/[id].tsx`) is one long scroll that has grown a section at a time. The things people come for are hard to find:

- The key facts (has a home or lives on the street, sterilised or not, last seen) are three small grey lines that are easy to miss.
- Some things are said twice. The times-spotted count is in the "last seen" line and again in a stat tile. "Discovered by" is a line near the top and again as the first entry in the story.
- The "needs help" and "report an issue" links sit between the main button and the facts, so the page reads as loose bits.
- The photos, which people enjoy most, are at the very bottom, below the story and the map.
- A cat with many sightings makes the page longer and longer.

## What it becomes

The cat's photo and name stay at the top. Under them is a row of four tabs. Each kind of thing gets its own tab, so a cat with 60 photos never swamps its facts.

| Tab | Label (English) | Shows |
|---|---|---|
| 🐱 | About | The facts card, the "I've spotted {name}" button, and everything you can do about this cat |
| 📷 | Photos · {n} | The sighting photos, as the grid shows them today |
| 📖 | Story | `{name}'s story`, the care timeline as today |
| 🗺️ | Map | The area map and its caption, as today |

About opens first, every time.

## Goals

- The first screen shows the photo, the name, the tab row and the start of the facts card on a 390 px phone. The "I've spotted" button should be in view too where the facts allow; that part is a target to tune, not a promise.
- Every fact and number appears once.
- Photos, story and map are one tap away, and the Photos tab shows how many photos there are, so people know there's something there.
- Nothing the page does today is lost. Every sheet, link, banner and rule still works.

## Non-goals

- No new server data beyond what following needs (the Follow button, the spotters and fans counts). Everything else on the page uses fields the cat response already has.
- No change to what any existing line says, in any language, apart from the deliberate wording changes below (the help card, the report link).
- No change to the Spot flow, the claim flow, the report-an-issue sheet, the photo viewer or the map component, apart from the link wording decided below.
- No change to cat cards, the cat-alogue list or the team dashboard.

## Anti-goals (would count as failure even if it works)

- Making any fact, the location, or the map more precise than today. The map still shows the cell, never a pin, except to the owner.
- Making the help card the biggest thing on the page (it is never bigger than the main button), or "Something wrong on this page?" bigger than it.
- Making the "{name} lives with me" card anything but a secondary action.
- A notification or link that lands on the page and doesn't show the person what it was about.

## The page, top to bottom

### 1. The photo (above the tabs, unchanged in behaviour)

- The main photo with the gradient and the name, as today. The `SYR-0042` number is no longer shown on the public cat page (decision 2 below).
- Slightly shorter than today, so the tabs and the facts card's first lines show on a small phone without scrolling. **My call:** about 250 px tall, down from 300. Tune it on a 390 px-wide phone so the first screen also shows the "I've spotted" button.
- Tap-to-open full screen, and the rule that it opens only once loaded (offline-safe): unchanged.
- **The back button stays on screen** at the top left (below the safe area) however far you scroll, rather than scrolling away with the photo. **My call:** with a sticky tab row, a back button that scrolls away would leave only the system or browser back.
- **The Follow button** sits at the top right, opposite the back button, and stays on screen the same way. See "Following a cat" below.

### 2. The tab row

- Four equal tabs in a segmented row. Each tab has the emoji on top and the label under it: `🐱 About`, `📷 Photos`, `📖 Story`, `🗺️ Map`.
- **Sticky, on web and native:** when you scroll down, the tab row stays pinned to the top of the screen, below the safe area, with the back button beside or over its left end. This is decided, not left to the builder; how it's achieved on each platform is the builder's (for example `stickyHeaderIndices` with the hero and the tab row as separate direct children of the scroll content).
- The selected tab looks raised (card colour, ink text). The others are muted. Built from Purropolis tokens; no new colours.
- **Photos count:** a small count badge on the Photos tab's emoji, e.g. `14`. It counts the photos the grid actually shows people: each sighting's cover photo plus its extra photos, leaving out hidden and removed ones. It's worked out by the same function the grid uses, so the two can't drift. With no visible photos there is no badge. **My call:** a badge rather than "Photos · 14" in the label, so long Greek labels fit. The screen-reader label says "Photos, 14".
- **Labels must fit.** Drafts: Greek `Σχετικά`, `Φωτογραφίες`, `Ιστορία`, `Χάρτης`; French `À propos`, `Photos`, `Histoire`, `Carte`. The longest, `Φωτογραφίες`, must fit a quarter-width tab at 360 px. The label may shrink to fit, down to 10 px, but is never cut off with an ellipsis and never breaks mid-word. Checked by screenshot in Greek at 360 px.
- **Accessibility:** the row is a tab list and each tab is a tab with a selected state (`role="tablist"`/`role="tab"`, `aria-selected`, and `accessibilityRole`/`accessibilityState` on native). The content below is a tab panel linked to its tab (`role="tabpanel"`, `aria-labelledby`). Only the selected tab's content is rendered, so a screen reader never reads the other three. Each tab is at least 44 px tall. The emoji is hidden from screen readers; the reader hears "About, tab, 1 of 4, selected". On web, the tab list is one stop for the Tab key and the left and right arrow keys move between tabs (roving tab index).
- **Switching tabs:** if you've scrolled past the photo, the page scrolls so the tab row sits at the top and you see the start of the new tab. If you haven't, the page doesn't move. It never scrolls the photo back into view by itself.
- The chosen tab lasts while you're on the page, including through a refresh of the cat's data. Leaving and coming back opens About. **My call:** no tab in the URL. A shared link always opens About.

### 3. 🐱 About

In this order:

1. **Edit** (owner only), as today.
2. **The update banner** from a tapped notification (`?updateId=`), as today. It stays at the top of About so the person sees what the notification was about. When the update is about something on another tab, the banner ends with a quiet link to it: a new sighting gets "See photos", and a sterilised, adopted or general update gets "See {name}'s story". **My call.** If the notification loads after the page has opened, the banner appears without switching tabs for the person.
3. **The facts card.** One card with up to four rows. Each row has a small tinted icon, a bold line and an optional quiet second line:
   - **Home:** the life line's words exactly as today, with any date in the page's one date style (`lifeLine(cat)`: "Lives on the street", "Has a home", "Staying with Syros Cats", "No longer with us", or "Not seen since {date}").
   - **Sterilised:** the sterilised line exactly as today (`sterilisedLineKey`). The card shows the whole sentence as the bold line; no new short forms. **My call:** keeping today's sentences avoids new translations of sensitive wording.
   - **Seen:** "Last seen {date}" as the bold line, using the existing `lastSeen` word and the page's one date style. The quiet line is new copy, for example **"Spotted 14 times by 6 spotters · 9 fans"**. `n` is `cat.sightingsCount`, `s` is the new `spottersCount`, and `f` is the new `followersCount` (see "Following a cat"). Each combination is a **whole-sentence template** per language, not three fragments glued together, so Greek and French can order the words naturally. The cases:
     - n ≥ 2, s ≥ 2: "Spotted {n} times by {s} spotters"; n ≥ 2, s = 1: "Spotted {n} times by 1 spotter"; n = 1: "Spotted once".
     - s = 0 while n > 0 (every spotter deleted their data): "Spotted {n} times" / "Spotted once".
     - n = 0: no "Spotted" sentence at all.
     - Fans are a separate short phrase after " · ": "{f} fans" / "1 fan". 0 fans, or no `followersCount` (an older server or cache), means no fans phrase. **My call:** "0 fans" reads as a sad fact about the cat.
     - If nothing is left, there is no quiet line.
   - **Where and what:** the place (`cat.description`) as the bold line and the appearance line as the quiet line. If only one exists, it becomes the bold line. If neither exists, the row isn't shown. That matches today, where neither chip shows.
4. **"I've spotted {name}"**, the main button, as today, including being hidden for a cat in care or one that has died. It gains a camera icon before the words: the same Feather `camera` icon as the Spot tab in the tab bar, through the button's existing `iconLeft`, like "{name} lives with me" uses its home icon. The icon is hidden from screen readers. **Samuel asked for an emoji or icon (23 Oct); the icon is my call**, so the button points to the Spot tab it opens.
5. **Two cards side by side, right under the button** (Samuel chose this layout, "Option 3", 23 Oct): **🩹 {name} needs help** and **🏠 {name} lives with me**. They are equal, soft cards (card background, thin border, rounded), clearly smaller and quieter than the main button. The emoji sits above the words, and the words may wrap to two or three lines, never cut off. When only one card applies, it takes the full width. When there's no "I've spotted" button (a cat in care or one that has died), the cards sit straight under the facts card. This keeps `design-review-fixes-oct22.md` §2.1 (the main button sits above the help route) and keeps the urgent route near the top for a worried passer-by.
   - **Wording (Samuel, 23 Oct):** the two read as a matching pair of statements, using the cat's name. "{name} needs help" is new (`reportNeedsHelpNamed`). "{name} lives with me" reuses the existing `claimCat` string. Everywhere without a named cat (the Spot flow, the match list, the map) the help link keeps "This cat needs help". "Does {name} live with you?" is no longer shown on the cat page; its sheet still is.
   - **🩹 {name} needs help** opens the same help flow as today's link (`NeedsHelpLink`'s handoff with this cat). It's shown for every cat, whatever its status, as today.
   - **🏠 {name} lives with me** does what today's claim pieces do, chosen by the same logic:
     - this phone may claim (`canClaim`): opens the claim sheet (`ClaimCatSheet`). Offline, the card is disabled and shows the existing "You need a connection to do this." line under the pair.
     - a street cat this phone can't claim yet, outside the cooldown: opens the "Does {name} live with you?" sheet in street mode, with its "Spot {name} now" button, as today's link does.
     - a homed cat, for everyone but the owner: opens that sheet in homed mode, as today's link under "Has a home" does.
     - the owner, a cat in care, a cat that has died, or a phone in the 7-day cooldown: no card (help takes the full width).
   - When a sheet opened from a card closes, focus goes back to that card.
   - **Claiming stays secondary.** The card is never styled as a primary button and never bigger than the main button (`claiming-a-cat.md` §4.1). The claim sheet's own guards (spot first, cooldown, limits) are unchanged, and they are what stop accidental claims.
6. **"You spotted {name} on {date}. Anything to add?"** (`MoreToAdd`), as today. When it has nothing to show, it takes no space. It now sits below the cards, so "{name} lives with me" is never straight under "You spotted {name}…" ([SYC-512](https://linear.app/fair-shake/issue/SYC-512)).
7. **"Has a home"** (`OwnershipBanner`), for a homed cat, as today, without the link under it (the 🏠 card does that job).

**🚩 Something wrong on this page? is on every tab** (Samuel, 23 Oct), as the last thing in each tab's content: a quiet text link with a flag emoji in front (Samuel asked for the flag). On About it sits below everything else, so it stays below the help card (`report-an-issue.md` §3.1). The flag is hidden from screen readers.

Removed from About: the two stat tiles (their numbers are now in the Seen row), the separate "Last seen" line, the place and appearance chips (now the Where row), and the "Discovered by" line (it's the first entry in Story).

### 4. 📷 Photos

The sighting grid exactly as today: same `SightingPhotos` component, dates, spotter names, hidden and removed photo states, and report-a-photo from the viewer. The "Sighting history" heading becomes unnecessary because the tab names it. **My call:** drop the heading and keep the existing `sightingsHistory` string in the i18n files, in case it's needed elsewhere.

### 5. 📖 Story

`{name}'s story`, the care timeline exactly as today, including the "First spotted by" entry. If `careTimeline` is missing (an older server or cache), the Story tab isn't shown at all and the row has three tabs. A real cat always has at least its "First spotted" entry, so an empty-looking story would be false (the rule in the comment above today's page code). **My call.**

### 6. 🗺️ Map

The map exactly as today: the cell drawn as an area labelled "Somewhere in here", the pin only for the owner, not interactive, and the "First spotted around here" / owner caption. The map is created only when the Map tab is opened, after the tab is on screen, so it never starts at zero size. It's removed again when you leave the tab, like the other tabs' content. **My call:** this saves data and battery for the many visits that never open it, and the map tiles are cached, so reopening is quick. Offline it behaves exactly as the map does today.

## Also fixed on this page (folded in from other tickets, Samuel, 23 Oct)

Only the cat-page parts of these tickets. The rest of each ticket stays open.

**From [SYC-512](https://linear.app/fair-shake/issue/SYC-512):**
- **One date for one moment.** Today "You spotted Agatha on 18/10/2026" can sit above "Last seen 19/10/2026" for the same sighting. "You spotted" formats the sighting's exact time on the phone's clock and time zone. "Last seen" is a bare day that the server cuts from UTC (`toPublicDay`, `lib/catHelpers.ts`). The fix has two halves (**my call**, checked by the second review):
  - **The server's public days become Syros days.** `toPublicDay` cuts the date in Europe/Athens rather than UTC, so a sighting at 00:30 on Syros is that day, not the day before. This changes every public payload that carries a day (list, map and cat page). Their saved test snapshots are updated in the same change. It reveals nothing new: still a day, never a time.
  - **The app formats by kind.** Exact times (like `takenAt`) are formatted in Europe/Athens. Bare days (like `lastSeenAt`, the Story's dates and `notSeenSince`) are formatted from their year, month and day parts, never through a time zone, so a phone in Australia or California shows the same day as one on Syros.
- **One date style.** Every date on the page uses the same style in the person's language: day, short month, year ("21 Oct 2026"; Greek "21 Οκτ 2026"; French "21 oct. 2026"). The Story's dates keep month and year only, but with the full year ("Mar 2026", not "Mar 26"). One shared formatter does this for every part of the page, including `MoreToAdd`, the photo grid and the photo viewer when opened from this page. **My call.**
- **The back button says "Back".** It's an icon-only button whose spoken label is "Back" in each language, not "Cat-alogue", because people arrive from Home, notifications and the Spot flow too. If there's nothing to go back to, it still goes to the Cat-alogue, as today.
- **"{name} lives with me" no longer sits under "You spotted…"** (About items 5 and 6 above).

**From [SYC-509](https://linear.app/fair-shake/issue/SYC-509):**
- **Tap targets:** the back button and every tab are at least 44 × 44 points.
- **Contrast:** grey text on this page (the quiet links, the quiet second lines in the facts card, captions) uses a darker grey that reaches 4.5:1 on the page background in light and dark mode. Today's muted grey is about 4.07:1. **My call:** fix it on this page only. The app-wide token change stays in SYC-509.
- **No emojis read aloud:** every emoji on the page (tabs, facts-card icons, Story icons) is hidden from screen readers. Each item's words carry the meaning.

**From [SYC-510](https://linear.app/fair-shake/issue/SYC-510)** (Samuel's decisions, 23 Oct):
1. **"Fans" splits into spotters and fans.** Spotters are people whose sighting of the cat has been confirmed. Fans are people who follow the cat: anyone who tapped Follow, plus spotters who haven't unfollowed. Today's "Fans" number really counts spotters, so it is renamed and a real fans count is added. See "Following a cat" below.
2. **The SYR number comes off the public cat page** (Samuel chose 2C). It is no longer shown anywhere on this page. The cat picker's search ("Name or cat number (like SYR-0012)") and the match screen still show and accept numbers. Whether they keep them is left for SYC-510, which stays open for that.
3. **"Report an issue" becomes "Something wrong on this page?"**, and the photo version, "Report an issue with this photo", becomes **"Something wrong with this photo?"** (Samuel chose 3A). These are **new link-only strings** (`reportIssueLink`, `reportIssuePhotoLink`). The existing `reportIssue` and `reportIssuePhoto` strings stay as they are, because the report sheet uses them as its heading, and a question in capitals would read badly there. **My call.** The links change on the cat page and in the photo viewer, the two places they appear. The report sheet is unchanged. The Greek and French are new drafts in question form, flagged for SYC-4. The order rule stays: it sits below the needs-help link and is never bigger.

## Following a cat (fans)

Samuel, 23 Oct: split "fans" into spotters and fans; a fan gets the same news a spotter gets; fold this into the redesign.

### What already exists (checked in the code, 23 Oct)

- Each cat has a follower list (`cat_subscriptions`). A spotter is added to it when their sighting is confirmed (`routes/sightings.ts`).
- That list decides who gets live care updates in the app and by push (`notificationFanout.ts`), the evening sighting round-up (`sightingRoundUp.ts`), and the nightly good-news check behind the SYC-45 emails (`news/nightly.ts`). "Delete my data" clears a person's rows from it (`severPerson.ts`).
- **One path ignores it:** `notifyCatSpotters` (`lib/notifications.ts`) pushes "{name} has a home!" on a claim, and the owner's rename or edit, to every phone with a confirmed sighting, follower or not (`routes/cats.ts` claim and edit routes).
- Owners get live sighting news only through their row on the list. Claiming adds no row; an owner has one only because claiming requires having spotted the cat.
- Nobody can follow without spotting, and nobody can unfollow.
- Today's `fansCount` counts the different phones that have spotted the cat, so it is really a spotters count.

### What changes

- **A Follow button** on the cat page, top right of the photo, on every tab. It reads `♡ Follow` when you don't follow the cat and `♥ Following` when you do, with the state spoken as a toggle ("Follow Agatha, not following" / "following"). Tapping Follow adds this phone to the cat's follower list. Tapping Following removes it straight away, with no "are you sure?". Tapping Follow again undoes it. **My call:** the hearts are drawn icons, hidden from screen readers.
- **A fan gets exactly what a spotter gets** (Samuel): care updates straight away and sightings in the evening round-up, in the app and by push. They hear only about updates after the moment they followed, as the round-up already works.
- **Following never asks for an email address** (Samuel, 23 Oct). Tapping Follow gives in-app news only (and push, if the phone allows it). Emails come only to someone who has separately given and confirmed an address through the email sign-up (SYC-45), exactly as for spotters today. The Follow button opens no sheet and no prompt.
- **Unfollowing stops all of this cat's news** for this phone, emails included. Spots and points are kept. **My call.**
- **Unfollowing sticks.** Spotting the cat again later does not quietly make you a fan again, because you said no. You can always tap Follow. The app remembers who unfollowed which cat in a separate record, so the follower list keeps meaning "follows now" and the notification, round-up and email code doesn't change. **My call.**
- **Every piece of cat news goes to followers, and only to them.** `notifyCatSpotters` switches to the follower list (excluding the phone that acted, and deleted phones), so "has a home" and owner-edit pushes reach fans and stop for anyone who unfollowed. **My call**, because it follows from "a fan gets what a spotter gets" and "unfollowing stops all of this cat's news".
- **Counts, as new fields** so old app versions and old cached pages are never misread. `fansCount` stays in the response and keeps meaning spotters, for older app versions. The response gains `spottersCount` (the same number, under its real name), `followersCount` (phones following now, never counting deleted phones), and `isFollowing` for this phone. The new page shows the fans phrase and the Follow button only when these new fields are present. The OpenAPI file, the generated client and the snapshot tests are updated to match. **My call.**
- **Every spotter starts as a fan.** A one-off backfill adds a follower row for every phone with a confirmed sighting of a cat that has no row for it and no unfollow record, (test, import or hand-made rows). Without it a cat could show "5 spotters · 1 fan" on day one. It means those few phones start getting that cat's news, which is what "spotters who haven't unfollowed are fans" means. **My call.** Merging duplicate cats isn't built yet (SYC-59, checked 23 Oct: nothing writes `cat_identity` outside tests). When it is, it must move follows and unfollow records to the cat merged into. That's noted on SYC-59.
- **The owner** of a homed cat doesn't see the Follow button and can't unfollow their own cat, because they must keep hearing about sightings of it. The server refuses an owner's unfollow too, not just the app. Claiming a cat makes the claimer a follower and clears any unfollow record, so someone who unfollowed and then claimed doesn't end up with a silent cat. **My call.**
- **A cat that has died:** news already stops for every follower, and follows are kept, as today, in case the record is corrected. Someone who doesn't follow sees no Follow button. Someone who does still sees "Following" and can unfollow, so news can't quietly resume for them if the record is corrected. **My call.** A cat staying with Syros Cats is alive and keeps the Follow button.
- **Who sees the button:** only a phone the server knows (its id and secret are loaded, as for "lives with me"). Until then, or for an older server, the button isn't shown.
- **Tapping** changes the button at once and asks the server. If the server refuses or can't be reached, the button goes back, with a short note. The app's copy of the page (held in memory by the query cache, which is also what shows offline) is updated to match.
- **Offline:** following needs a connection, like claiming. Offline, the button shows its current state but is disabled, with the existing "needs a connection" style of note. **My call:** no offline queue for follows.
- **Limits:** follow and unfollow calls share a courtesy cap, using the app's existing limiter (`lib/limits.ts`): about 50 a day per phone and a larger cap per network address. Every call counts, including re-following, so a follow-unfollow loop can't hammer the database. This is a cost ceiling, not a privacy control: new phone ids are free, so it can't stop a determined person. The privacy argument is below. **My call** on the numbers.
- **Delete my data** also removes this phone's unfollow records.
- **Keep my spots safe / Get your spots back:** restoring on a new phone takes over the old phone's id rather than copying rows (`lib/keepSafe/move.ts`, checked 23 Oct), so follows and unfollow records carry over with no new code. A test proves it.
- **The notifications inbox's empty message**, "No notifications yet. Spot a cat to follow its updates!", becomes "No notifications yet. Spot or follow a cat to get its news." **My call.**

### Privacy (for review)

Today only people who have spotted a cat get its evening round-up (`cat-record-data-spine.md` §6.4.4 limited sighting news that way). Opening following to anyone means anyone can learn, day by day, whether a particular cat was seen. This is accepted because the public page already shows the same thing: "Last seen" is a public day, the round-up is at most one message a day, and it never carries a time or place. The real-time protection in §6.4.4, where only the owner hears about a sighting straight away, is unchanged.

Following never reveals who else follows a cat. Only the count is public, and it never counts deleted phones.

A list of the cats a phone follows without having spotted them, plus its unfollow records, is new personal data: it hints at where someone has been or cares about. It is deleted with "Delete my data". It must be added to the privacy policy (SYC-66, which isn't published yet). A phone that is lost or reinstalled stays counted as a fan until its data is deleted; the count means "phones following", not "people", and the page never claims otherwise.

### Note on SYC-45

The email-capture spec asks people after a spot to "follow this cat" by giving an email, and says someone who declines "still follow[s] Agatha in the app" (`email-capture.md` around line 166). With a real Follow button and unfollow-sticks, that isn't always true, so the card needs a variant for a phone that has unfollowed this cat. That is a change for SYC-45 and is noted on that ticket. It isn't built here.

## Arriving on the page

| Arrives from | Opens on | Notes |
|---|---|---|
| Cat-alogue list, map, cat card, Spot flow, ownership banner | About | |
| A notification, or the inbox (`?updateId=`) | About | The update banner is at the top of About, as today |
| "Think this cat is alive?" (`?report=wrong_info`) | About | The report sheet opens on top, as today |

Every sheet and viewer (report an issue, the claim sheets, the "Does {name} live with you?" sheet opened from the 🏠 card, the full-screen photo viewer) belongs to the page, not to a tab. It opens over whichever tab is showing, and switching tabs never closes or reopens it.

## Every state still covered

- **Owner:** Edit button, exact pin on the map, no 🏠 card.
- **Cat in care or that has died:** no "I've spotted" button (unchanged). The tabs are the same.
- **Offline:** the page shows the cached cat as today. Tabs switch without a connection. The claim button stays disabled with its note.
- **Older server or cache** without the spotters count, `fansCount`, `isFollowing` or `careTimeline`: the missing count's part is left out, the Follow button isn't shown, and the Story tab is hidden. None of them shows a false 0, a false "not following" or a false empty story.
- **Cat with one photo:** badge `1`, fine. **No visible photos** (all hidden or removed): no badge, and the tab shows the hidden or removed tiles as today.

## Copy

New strings, English authoritative, Greek and French as drafts flagged for a native check on SYC-4 like the other recent strings:

| Key (suggested) | English |
|---|---|
| `catTabAbout` | About |
| `catTabPhotos` | Photos |
| `catTabStory` | Story |
| `catTabMap` | Map |
| `reportNeedsHelpNamed` | {name} needs help (draft el: `Η {name} χρειάζεται βοήθεια`, fr: `{name} a besoin d’aide`, following the existing `claimCat` pattern) |
| `claimCat` (existing, reused) | {name} lives with me |
| `catBannerSeePhotos` | See photos |
| `catBannerSeeStory` | See {name}’s story |
| `catSpottedTimesBy` / `catSpottedTimesByOne` / `catSpottedTimes` / `catSpottedOnce` | Spotted {n} times by {s} spotters / Spotted {n} times by 1 spotter / Spotted {n} times / Spotted once |
| `followFailed` | Couldn’t update that. Try again. |
| `catFans` / `catFansOne` | {n} fans / 1 fan |
| `followCat` / `followingCat` | Follow / Following |
| `followA11y` | Follow {name} (spoken as a toggle with a pressed state: "Follow Agatha, toggle, on" when following) |
| `followNeedsConnection` | You need a connection to follow {name}. |
| `reportIssueLink` (new) | Something wrong on this page? |
| `reportIssuePhotoLink` (new) | Something wrong with this photo? |
| `noNotifications` (changed) | No notifications yet. Spot or follow a cat to get its news. |

The Greek and French tab labels drafted above, and the Greek and French for the other new strings, are drafts flagged for a native check on SYC-4.

`timesSpottedStat`, `fansStat` and `sightingsHistory` stay in the i18n files but are no longer used on this page. The builder checks whether any test or lint fails on unused keys; if one does, remove the keys instead.

The emojis are not part of the strings; they're added in code so translators can't drop them.

## Tests (for the builder to fill in)

- The existing cat-page tests (`CatPageClaim`, `CatPagePhotos`, `CatPageSpotted`) switch to the right tab before checking things that moved, and otherwise keep the same checks. `CatPagePhotos`' sighting tile and viewer checks need the Photos tab. The order checks ("Last seen" before the button, the button before "needs help", "needs help" before "report an issue") must still pass on About, with any check that looks for "This cat needs help" on the cat page updated to the new wording.
- New checks, at least:
  - About opens first, and only the selected tab's content is rendered.
  - The cat page shows the two cards "Agatha needs help" and "Agatha lives with me" right under the spot button; the other screens still say "This cat needs help".
  - The 🏠 card's four cases: canClaim opens the claim sheet (disabled offline with the note); street cat without canClaim opens the street sheet; homed cat (not owner) opens the homed sheet; owner / in care / died / cooldown shows no card and the help card is full width. Focus returns to the card when a sheet closes.
  - "Something wrong on this page?" with its flag is the last item on every tab.
  - The "I've spotted" button has its icon, and the icon is hidden from screen readers.
  - Each tab shows its own content.
  - The Photos badge equals the visible photos in the grid, including extra photos, and excluding hidden and removed ones.
  - The update banner shows on About when arriving from a notification, and its link opens the right tab.
  - `?report=wrong_info` still opens the sheet.
  - A sheet or viewer stays open when the tab changes.
  - The tab choice survives a refetch.
  - The map is created only once the Map tab is opened.
  - The tab list, tab and tab panel semantics are there for screen readers.
  - The fans part is left out when `fansCount` is missing or 0, and the Story tab is hidden when `careTimeline` is missing.
  - No SYR number appears anywhere on the cat page.
  - Server: follow adds the phone to the follower list and unfollow removes it; both need the phone's id and secret; follow is refused past 50 new cats a day; `fansCount` counts followers and the spotters count counts spotting phones.
  - Server: after unfollowing, a new confirmed sighting by that phone does not re-add it; tapping Follow again does.
  - Server: a new follower gets the evening round-up and live care updates only for updates after they followed, and an unfollowed phone gets neither.
  - Server: "Delete my data" removes the phone's follows and unfollow records.
  - App: the Follow button's state, its hiding for the owner, a cat that has died (hidden for non-followers, "Following" for followers), an older server, an unknown phone, offline, and going back after a refused tap.
  - Server: an owner's unfollow is refused; claiming after an unfollow restores the follow; `notifyCatSpotters` reaches followers and not unfollowed spotters; follow is refused for a missing cat, a deleted phone and a missing secret; double taps are safe; the courtesy cap counts every call; `followersCount` never counts deleted phones; the response for one phone isn't cached for another.
  - App: a cached or older payload with `fansCount` but none of the new fields shows no fans phrase and no Follow button.
  - Dates: a sighting at 22:30 UTC and 23:30 UTC (after midnight on Syros) shows the same day for "You spotted" and "Last seen", on a phone set to Athens, to London and to Pacific/Auckland.
  - The report sheet's heading still says "Report an issue" when opened from the new link.
- **Database change order:** the new unfollow table and the backfill run on production before the new code is published. Say "don't republish yet" until they have.
- Sticky behaviour, scroll on switching tabs, the fixed back button, and label fit can't be tested in vitest (the scroll view isn't simulated). They're checked by screenshot instead: 360 px, 390 px and desktop, in English and Greek, light and dark, before the PR leaves draft, plus one native check in the iOS simulator.

## Left to the builder

- Exact sizes and spacing, and how sticky is achieved on each platform (the decision to make it sticky is made above).
- Whether the tab row becomes a small reusable Purropolis component or stays inside the page.
- How the page is split into smaller files. The page is 700 lines today, and moving each tab's content into its own component is welcome.

## Review

Second adversarial review on 23 Oct 2026 (Sonnet) of the following, dates and wording sections. Folded in: the `notifyCatSpotters` path that ignored followers, dates (the server cut days in UTC), owner follows after an unfollow, new field names instead of redefining `fansCount`, the backfill and merges, an honest courtesy cap, privacy (why the round-up is acceptable, new personal data, ghost followers, restore), the report sheet's heading, the SYC-45 card, the Seen row as whole sentences, and the missing tests. All its questions follow from decisions Samuel had already made, so they are recorded as my calls.

First adversarial review on 23 Oct 2026 (a Sonnet reviewer against the code and earlier specs). Everything it raised is folded in above: the photo count, the older-server fallbacks, where "needs help" sits, sticky and back-button behaviour, lazy-loading the map, tab panels for screen readers, Greek label width, plurals and zeros, banner links to other tabs, sheets across tabs, and the test list. "About" as the first tab's name was kept; it's the label in the mockup Samuel chose.
