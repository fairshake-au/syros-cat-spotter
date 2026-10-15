# Choosing a different cat when matching misses

**Status:** **Approved by Samuel, 30 September 2026** (`DECISIONS.md` Part 2i). Three adversarial review passes done and folded in (§12). Revised the same day to add the colour filter Samuel asked for (§4.7).
**Owner:** Samuel
**Covers:** SYC-119, from point 4 of the 29 September user-testing call (SYC-116), including the colour filter Samuel asked for on 30 September 2026 (§4.7).
**Related:** [`cat-record-data-spine.md`](./cat-record-data-spine.md) §3.2, §6.3 (and its SYC-39 override), §6.4, §6.5, §10.1, §10.3 · [`DECISIONS.md`](./DECISIONS.md) Part 2h (500 m matching) and Part 3 (ownership) · [`team-access-and-welfare-queue.md`](./team-access-and-welfare-queue.md) §3.3, §6, §7 · [`offline-queue-on-web.md`](./offline-queue-on-web.md) · [`docs/PRODUCT-SPEC.md`](../PRODUCT-SPEC.md) §2.3 · SYC-38 (points), SYC-43 (staff dashboard), SYC-53 (roles and the confirmation queue), SYC-56 (matching accuracy), SYC-59 (duplicate merging), SYC-80 (a cat's position following its sightings), SYC-2 (coat and markings tags), SYC-52 (per-attribute authority) · [`docs/superpowers/specs/2026-07-28-cat-health-record-design.md`](../superpowers/specs/2026-07-28-cat-health-record-design.md) §4.2 and §5 (appearance vocabulary, machine suggestions)

**What this document owns.** The spotter's experience of picking an existing cat by hand when the suggested matches are wrong, what that pick counts for, and what the team sees about it. It does **not** own the cat record, observations, location blurring or merging: those are `cat-record-data-spine.md`'s, and where this feature needs something from them it says so and points there (§8), in line with the ownership rule in `DECISIONS.md` Part 3.

---

## 1. The short version

When the app's suggested matches don't include the right cat, the spotter can find it themselves: **a list of cats known around here (within 1.5 km), always nearest first, with big photos, plus a search box for a name or an SYR number and a colour filter that narrow that list.** Tourists pick by face, and narrow by colour; cat guardians type the name. In the app, every spotter picks only from cats near where the photo was taken, and the server enforces that too. Picking a cat from anywhere on the island is for the Syros Cats team, cat guardians and vets, and it happens in the staff dashboard (§4.8). If the right cat isn't nearby, the spotter can **ask Syros Cats to match it**. Each cat's colour is read automatically from its main photo, and a cat the app isn't sure about is never hidden. The same way in appears when the app has no suggestions at all, and when someone types a name that another cat already has.

A pick made by hand earns **the same 15 points** as confirming a suggestion, straight away. It is **recorded as a hand pick**, which is useful twice over: it tells the team to glance at it, and it is exactly the evidence SYC-56 needs about where the matcher goes wrong. Hand picks appear in a short, low-priority list on the staff dashboard, where the team can say *looks right* or move the sighting to the right cat. Nothing waits for the team, and nothing breaks if the team never looks.

The list shows only what the public catalogue already shows. It is built from blurred positions, and it never depends on which cats the matcher looked at. Browsing, searching and filtering by colour work without signal from the phone's saved copy of the catalogue. **Sending the choice needs signal**, just like "That's the one" does.

---

## 2. The problem, as a spotter meets it

At the 29 September user-testing call, spotters described the gap. The app photographs a cat, shows up to three lookalikes, each with "That's the one", and a card saying "New cat". If the right cat isn't among the three, "New cat" is the only way forward, and the same cat ends up in the cat-alogue twice. When the app has no lookalikes at all, it goes straight to naming a new cat, with no way back.

Three things make this happen more often than you'd expect:

- **Matching only looks within 500 m** of where the photo was taken (`DECISIONS.md` Part 2h). That was the right call, but it means any cat more than 500 m from its recorded position is never suggested.
- **A cat's recorded position is where it was first spotted** (`cat-record-data-spine.md` §6.6, until SYC-80). A cat first photographed at the ferry terminal stays pinned there. If it's spotted up the hill a month later, it can't be suggested.
- **The photo check sometimes gets it wrong**, and when it fails outright the app shows no suggestions at all.

Every duplicate costs something real. It inflates the island count Syros Cats reports, splits a cat's history in two, and hands the team a merge job later (SYC-59). Duplicates are the single biggest threat to the count.

### 2.1 Two kinds of spotter, needs that fit together

| | Tourists | Cat guardians and residents |
|---|---|---|
| **What they know** | What the cat looks like, and roughly where they are | The cat's name, often its SYR number, and where it usually hangs out |
| **What they need** | To recognise the cat by its face, among cats around here, without typing anything | To type "Agatha" and be done in two seconds |
| **What goes wrong without this** | They add a duplicate because it's the only button | They add a duplicate knowing it's wrong, or give up on the sighting |

The two needs fit together. The guardian's search keeps the catalogue clean in the places guardians go every day. The tourist's photo list catches the cats guardians never see. One screen serves both: photos first, with a search box on top. For the rarer case of a cat whose recorded position is far away, a guardian's knowledge reaches it through the staff dashboard (§4.8), not the phone.

---

## 3. What the spotter experiences

### 3.1 Three ways in

1. **Below the suggestions.** Between the last suggestion and "New cat", a quiet card: **"Not one of these? Find the cat yourself."**
2. **When there are no suggestions.** The "a new furriend" naming screen has one line under the name box: **"Seen this cat in the app before? Find it instead."** Without it, that screen is a dead end for anyone who knows the cat is already in the cat-alogue. The same line appears whenever the naming screen is reached from the suggestions too.
3. **When the name is already taken.** If the spotter types a name another cat already has, the app doesn't just say "taken". It shows that cat's photo: **"There's already a cat called Agatha. Is this her?"**, with **"Yes, that's her"** and **"No, a different cat"**. "Yes" makes a hand pick of that cat. "No" goes back to choosing a name. The prompt is only offered for a cat within the spotter's nearby set (§4.8). If the cat with that name is further away, the spotter sees *"There's already a cat called Agatha, but not near here. Is it her?"*, and "Yes" sends the sighting to Syros Cats to match (§3.2). Names are public, so this reveals nothing new, and it is the moment a guardian is most likely to be adding a duplicate by accident. If the cat with that name is recorded as deceased, the prompt isn't shown. The spotter is simply asked for a different name, because a deceased cat can't be picked by hand (§4.3).

### 3.2 The "Find the cat" screen

From top to bottom:

- **The spotter's own photo**, small, so they can compare as they scroll.
- **A search box**: *"Name or SYR number"*. Typing narrows "Cats known around here". It does not search the rest of the island (§4.8).
- **A row of colour chips** under the search box: *All · Black · White · Ginger · Grey · Tabby · Tortoiseshell or calico · Black and white · Not sure*. "All" is on until the spotter taps a colour. How it behaves is in §4.7.
- **"Cats known around here"**: every cat whose public position is within 1.5 km of the photo, which is the same "Nearby" the Cats tab already uses. Each card shows the cat's main photo (large, since for a tourist the face is the decision), its name and its SYR number.

> **The list is always nearest first.** "Nearest" means nearest by map square: the cat's published 250 m square, measured from where the photo was taken. Cats in the same square tie, and ties are broken by SYR number, lowest first. The order is never worked out from a cat's exact position, because an order based on exact distance would give that position away (§4.4). Search and the colour filter (§4.7) narrow the list. They never change its order.
- Tapping a card opens a **side-by-side check**: the spotter's photo next to the cat's main photo and up to two more of its public photos, with the button **"Yes, this is the cat"**. There's no match percentage, because the app hasn't compared these photos and must not look as if it has. The check is a deliberate second step. It stops a hurried spotter tapping the first cat in the list just to be done, which would swap a duplicate for a wrong match.
- At the bottom, two ways out, so the picker never traps anyone:
  - **"Know this cat, but it isn't here? Ask Syros Cats to match it."** This sends the photo to the team's "Matched by hand" list, marked *waiting for a match* (§5). The sighting leaves the spotter's review list with the message *"Sent to Syros Cats. We'll let you know when they've matched it."* The spotter earns the 15 points when the team matches it, or 25 if the team decides it is a new cat, credited to the spotter as discoverer. If the team never looks, nothing is lost but the points.
  - **"Can't find it? Add it as a new cat."**

### 3.3 After a pick

The spotter sees the same reward screen as for any match: **"Match confirmed"**, the cat's name, **+15 points**, badges, and then the usual optional questions about ear tip, food and water, and "anything you noticed?" (`cat-record-data-spine.md` §4.4 and §7). The spotter is not told their pick will be checked. It is a normal sighting, and treating it as suspect would punish the people doing the right thing.

### 3.4 What the screen never does

- Never shows an exact position, a map pin or a distance worked out from exact positions.
- Never shows who spotted a cat, when to the minute, or where anyone was standing.
- Never shows a match score for a cat the matcher didn't return.
- Never lists a cat that has been merged into another. Search finds the surviving cat under either name (§8.5).

---

## 4. Decisions

Each decision gives the question, every realistic option, and a recommendation.

### 4.1 How does someone find the right cat?

| Option | What the spotter does | Benefits | Risks | Tourists | Guardians |
|---|---|---|---|---|---|
| **A. Search only** (name or SYR number) | Types | Simplest to build. The Cats tab already searches names and numbers. | Useless to anyone who doesn't know the name, which is nearly every tourist. They'd still hit "New cat". | Doesn't help | Great |
| **B. Nearby list only** (photos) | Scrolls and recognises | Works for everyone who can recognise a face. No typing. | Misses cats far from their recorded position, which is exactly the frozen-position case in §2. A long list in a dense bit of Ermoupoli is slow to scan. | Great | Slow when they already know the name |
| **C. Map browse** | Pans a map and taps shapes | Feels natural. The map already exists. | The public map shows 250 m squares, not pins, so ten cats sit in one square and the map says nothing about which is which. More to build. On a small phone screen it's the worst way to compare faces. | Poor | Poor |
| **D. Nearby photo list plus search (recommended)** | Scrolls or types, whichever fits | Serves both audiences on one screen. It reuses the catalogue, its search and its "Nearby" definition. Cats beyond 1.5 km are reached through "Ask Syros Cats to match it" (§4.8), which covers the frozen-position case without an island-wide public search. | Two things on one screen. It needs to look calm and not like a form. | Scroll by face | Type the name |

**Recommendation: D.** The photo list is the tourist's way in and the search box is the guardian's. No map inside the picker: the map is still one tap away in the Cats tab, and it can't tell apart cats in the same square.

**Why 1.5 km for the list and not 500 m.** The list exists to catch the cats the 500 m check missed. A list bounded at 500 m would miss the same cats. 1.5 km is what the Cats tab already calls "Nearby", so one idea of "near" runs through the whole app.

**This does not break the 500 m promise to Syros Cats.** `PRODUCT-SPEC.md` §2.3 and `DECISIONS.md` Part 2h are about which cats the app *automatically* compares and suggests, and that stays at 500 m. A spotter choosing a cat they recognise within 1.5 km is a different thing. Samuel decided (open question 4) that picking from further away is for trusted people only (§4.8).

### 4.2 Does a hand pick earn the same points? (SYC-38)

| Option | Benefits | Risks |
|---|---|---|
| **A. Same as confirming a suggestion, 15 points, straight away (recommended)** | Simple and fair. The spotter did more work than tapping a suggestion, not less. Keeps "New cat" (25) only a little more rewarding, which is the whole point of SYC-38's rebalance. | Someone could pick any cat to collect it. But they can already do that by tapping any suggestion, and §4.3 catches the pattern. |
| **B. Fewer points than a confirmation** (say 10) | Discourages careless picks | **Backfires.** The gap to "New cat" (25) grows, so the rational move is to add a duplicate, which is the very thing this feature exists to stop. |
| **C. A bonus for finding a cat the matcher missed** | Rewards genuinely useful evidence | Pays people to ignore good suggestions and search instead. It's also an incentive to game, and the charity gets nothing from it. |
| **D. Points held until the team checks** | Nobody gains from a wrong pick | The team may take days, or not have a dashboard yet. The reward moment is the heart of the app, and "pending" feels like being accused. It also turns the review list into a to-do list the charity must clear, which `team-access-and-welfare-queue.md` §3.1 warns against. |

**Recommendation: A.** The pick also counts toward streaks, badges and the spotter's collection, exactly like any sighting. If the team later moves the sighting to a different cat (§4.3), **the spotter keeps the points**. That follows the same principle as SYC-59, where nobody loses points over a merge. The collection follows the corrected cat automatically, because it is worked out from sightings.

### 4.3 Guarding against the wrong cat, by mistake or mischief

**What a wrong pick can actually do**, worst first:

1. **Bring a dead cat back to life.** Under the data spine's rule (§3.2), a sighting dated after a *deceased* statement clears it. A tourist who picks Agatha because she looks similar would make her cat page say "Lives on the street" again, and restart "spotted again" notifications to her followers.
2. **Make an unsterilised cat look sterilised.** If the spotter answers "Yes, clipped" to the ear-tip question, a single photo-backed answer puts the chosen cat at *Probably sterilised* (`cat-record-data-spine.md` §4.3). On the wrong cat, that could drop a cat that still needs the operation down the trapping list.
3. **Muddle a cat's history.** A wrong photo on its page, a wrong "last seen", and a "spotted again" notification with somebody else's cat in it.
4. **Farm the collection.** Pick famous cats to fill a collection or climb the leaderboard. The nearby-only rule (§4.8) limits this to cats near where the photo was taken.

**Options**

| Option | Benefits | Risks |
|---|---|---|
| **A. Trust it and record nothing special** | No work for anyone | Harms 1 and 2 happen silently and nobody can find them afterwards. The matcher-miss evidence is lost. |
| **B. Every hand pick waits for the team before it counts** | Nothing wrong ever lands | Punishes honest spotters, and needs a team that is reliably there. Syros Cats is small, and F1 decided the app never promises attention nobody has agreed to give. Until the dashboard exists, nothing would ever count. |
| **C. Picks count at once, are marked as hand picks, and appear in a low-priority team list with warning flags. The two harmful effects have guards (recommended)** | Honest spotters get their reward. The team spends its minutes on the few picks that matter. It works with no dashboard at all, and gets better once there is one. | The team may never look. So the two serious harms need guards that work by themselves, not just a list. |
| **D. A second spotter must pick the same cat** | Independent confirmation | Most cats are spotted by one person (`cat-record-data-spine.md` §4.3). Most picks would never be confirmed. |

**Recommendation: C, with these guards.**

- **Cats recorded as deceased are not offered in the picker.** The matcher can still suggest them, since a close photo match is real evidence a cat has walked back into frame. Search finds a deceased cat, but the card reads *"No longer with us"* and can't be chosen. Instead it offers **"Think this cat is alive? Ask Syros Cats to match it"**. This is the same request as in §3.2, marked *spotter says this cat is alive*. The team decides, and if they match it, the data spine's rule clears the death as usual. This leaves the data spine's rule untouched and closes harm 1 for hand picks. (Cats that are *presumed* deceased, meaning not seen for three years, stay pickable. A new sighting is exactly how they're meant to come back.)
- **A "Yes, clipped" answer on a hand pick goes to the top of the team's *Likely* review list**, marked *matched by hand* (`cat-record-data-spine.md` §4.5). It still counts, the same as any other answer, because a wrongly matched suggestion carries the same risk. But the one list the team already clears weekly will put it first.
- **The team's list of hand picks** (§5) flags the ones worth a look: a pick far from the cat's recorded position, a cat already picked by hand several times recently, and a device with an unusually high share of hand picks.
- **Anyone can still say "not this cat".** "Report an issue" already offers *this is not a cat, or not this cat* on every photo (`team-access-and-welfare-queue.md` §6).

**Accepted, knowingly: harm 3 is not prevented, only corrected.** A wrong hand pick sends the cat's followers a "spotted again" notification (batched and coarse, per `cat-record-data-spine.md` §6.4.4) and puts a wrong photo on its page until someone notices. Holding notifications for hand picks until the team checks was considered and rejected: it brings back option B's problem, and the cost is a mildly wrong update about a living cat. **Also accepted: points aren't taken back.** Someone farming hand picks keeps the points, and could climb the leaderboard. The flags in §5 make the pattern visible, and the stakes are a leaderboard, not the cat record.

**Should hand picks go to the SYC-43/SYC-53 confirmation queue?** Not as the ticket imagines. The confirmation queue in SYC-53 is a different thing: a list of cats at *Likely* that a guardian or volunteer could settle by going to look. Hand picks need a person at a desk comparing two photos, which is the SYC-43 dashboard's "fixing what is wrong" area (`team-access-and-welfare-queue.md` §3.3). The hand-pick list belongs there. When guardian roles arrive (SYC-53), a guardian can check hand picks in their own colonies too (Samuel, 30 September 2026: yes).

**Until the dashboard exists**, nothing waits on it. Picks are recorded as hand picks from day one, so the first time the list opens it shows every pick made so far. The deceased guard and the ear-tip marking work without anyone looking.

### 4.4 Privacy: what the "nearby cats" list may show

The rule in one sentence: **the list may show only what the public cat-alogue already shows, worked out only from public positions, and it must never depend on which cats the matcher checked.**

**Nearest first, by map square, ties broken by SYR number.** Samuel asked for nearest first, and it is: the list is sorted by the distance from the photo to the centre of each cat's published 250 m square, the same coarse distance the Cats tab uses (`cat-record-data-spine.md` §6.4.2–3). Cats in the same square are listed by SYR number. Sorting by exact distance was ruled out, and not for tidiness: an order based on exact distance lets anyone standing in different places work out where a cat really is, one tap at a time. That is exactly the leak §6.4 closes for the rest of the app.

**What each card may show:** the cat's main photo, its name, its SYR number, its coat colour (§4.7), and on the side-by-side check up to two more of its *public* photos. It may also show the same short status lines the cat page shows (for example *"No longer with us"* on a card that can't be picked).

**What it must not show or use:**

| Must not | Why |
|---|---|
| An exact position, a pin, or any sighting's position | `cat-record-data-spine.md` §6.4.1 and §6.5. The phone is always a public reader. |
| A distance, or a nearest-first order, worked out from the cat's exact position | Distances and sorting use the cat's **published** position, the centre of its 250 m square. Ties break on cat number, never on true distance (§6.4.2–3). The list needs no distance figure on the card at all; the order is enough. |
| Anything about which cats the matcher compared | The matcher compares a photo with the cats within 500 m on **exact** positions (Part 2h). If the list hid the cats that had already been compared, or marked them, whatever is left over would show which cats are more than 500 m away on exact positions, handing back the probing channel §6.3 worries about, one tap at a time. **The list is built as if the matcher had never run.** Suggested cats can appear in it again; that is harmless, because they were already shown. |
| A warning such as "this cat is usually far from here" worked out from exact positions | That is the same probe in a friendlier coat. Any such prompt could only use published positions, and this spec adds none. The "far from recorded position" flag in §4.3 is shown **only to the team**, and the response to the spotter is the same whether a pick is flagged or not. |
| A match score for a cat the matcher didn't return | The app hasn't compared them. A made-up score would mislead. Offering an "ask the AI to compare" button would turn the picker into a free photo-comparison service. |
| Colony names, guardians, feeding sites, notes, who spotted a cat, times | Colony names carry a guardian's name, and linking a cat to a colony in public says where it's fed (§6.2, §6.7). Notes are never public (§7.1). Public times are dates, never times (§6.4.4). |
| The cat's exact position in the reply once the pick is sent | Already a data spine rule for every confirmation (§10.6, third row). It applies to hand picks unchanged. |
| Exact positions in the server's nearby check (§4.8) | The server decides whether a picked cat is nearby from its **published** square, measured from the sighting's location, exactly as the phone does. If it used exact positions, a refusal would answer "is this cat within 1.5 km of here?" about the true position, which is the §6.3 probe again. With published positions, a refusal says nothing anyone couldn't work out from the public cat-alogue. |

**What this list does not make worse.** Everything on a card is already in the public cat-alogue, which every phone already downloads. The one new question a spotter can ask is "which cats are listed near this photo?", and the Cats tab's "Nearby" filter already answers it from blurred positions.

### 4.5 What works without signal

Precisely, because "it all works offline" is never true of this app:

| Step | Without signal? |
|---|---|
| Taking the photo and queueing it | Yes, as now. |
| Getting suggestions | **No.** The photo check runs on the server once the phone has signal. After that, the suggestions are saved on the phone with the sighting. |
| Opening the review screen for a sighting that has already synced | Yes. The saved suggestions show. |
| Opening "Find the cat yourself", scrolling "Cats known around here", searching it by name or SYR number | **Yes, from the phone's saved copy of the cat-alogue**, the same copy the Cats tab uses offline. The nearby set is measured from the location saved with the sighting, so it doesn't need a GPS fix either. Cats added since that copy was last refreshed won't be there. |
| Filtering by colour | **Yes.** Each cat's colour is part of the public cat-alogue, so the filter runs on the phone against the saved copy. A cat whose colour was read after the copy was saved shows as "Not sure" until the phone next has signal, and so is never hidden. Working out a colour needs signal, because the model runs on the server. |
| Seeing the cats' photos in the list | **Only photos the phone has already loaded before.** The others show a placeholder with the name and SYR number. |
| Sending the pick, "That's the one", "New cat" or "Ask Syros Cats to match it" | **No.** All four need signal. Without it, the app says so plainly: *"No signal. Your sighting is saved. Finish this when you're back online."* The sighting stays in the review list and nothing is lost. |

**Options for that last row**

| Option | Benefits | Risks |
|---|---|---|
| **A. Choosing needs signal, and the sighting waits safely (recommended)** | Matches how "That's the one" and "New cat" already behave. Nothing new to go wrong in the offline queue, which was hard-won (`offline-queue-on-web.md`). | A spotter in a dead spot has to come back to it. |
| **B. Queue the choice and send it later** | Smoother in the moment | The only queued choice in the app. The points and the "Match confirmed" screen would be promises made before the server has agreed. If the cat was merged or marked deceased in the meantime, the queued choice fails later with nobody watching. If it's worth doing, it's worth doing for all three choices at once, as its own piece of work. |

**Recommendation: A.** Queueing every kind of choice is filed as a separate follow-up (§11), not smuggled in here.

### 4.6 How a hand pick is recorded, and how it fits the data spine

**What gets recorded, and by whom.** The **server** decides whether a choice was a suggestion or a hand pick. The phone never gets to say. To do that, the server keeps, with each sighting and visible only to the team, the list of cats it compared and the ones it suggested, with their rank. When the choice arrives, the server labels it:

- **suggested**, with its rank (1st, 2nd or 3rd);
- **hand pick from the nearby list**, **hand pick from search**, or **hand pick from the name-taken prompt**. The phone says which screen it came from, which is harmless because it only describes the phone's own screen;
- **sent to Syros Cats to match**, and later **matched by the team**, with who did it;
- **new cat**, noting whether the spotter opened "Find the cat" first and still chose new, and whether a colour filter was on at the time. A "new cat" chosen after looking is weak but useful evidence the cat really is new, and one chosen from a filtered list is weaker still (§8.5).

For hand picks, the server also records for the team whether the chosen cat was among those compared but scored too low (a *matcher miss*), or outside the 500 m that were compared (a *distance miss*).

**Options for where that record lives**

| Option | Benefits | Risks |
|---|---|---|
| **A. On the sighting row itself**, written once when the sighting is resolved | One place to look. The sighting already changes from pending to resolved at exactly that moment. | Adds a few team-only columns to a public-facing table. Every public reader of sightings must leave them out. |
| **B. As an observation on the cat** | Reuses the observation table | Wrong kind of thing. Observations are statements *about a cat* ("its ear tip is clipped"). "Which cat is this photo of" is a statement about the *sighting*, and it can change when the team moves it, which an observation fixed to one cat cannot follow. |
| **C. A small team-only table of match records**, one row per sighting, written when the match runs and completed when the choice arrives (recommended) | Keeps the matcher's working, and what the spotter chose, out of every public payload by construction, the same principle as private feeding sites (§10.5: filtered in the query, not the serialiser). It is exactly the dataset SYC-56 needs, and can be read without touching public tables. | One more table. |

**Recommendation: C.** It is owned by the data spine, since `DECISIONS.md` Part 3 keeps the records this feature relies on, the match record among them, with the data spine, so the table is defined there, in `cat-record-data-spine.md` §10.9. This spec states what it must hold, not its columns.

**Matching accuracy (SYC-56).** SYC-56 builds its test set from confirmed sightings, treating each as a human-checked "same cat" label. Hand picks change that in two ways, and both are recommended:

| Option | Benefits | Risks |
|---|---|---|
| **A. Treat a hand pick like any confirmation** | More labels | A wrong hand pick becomes a wrong answer in the test. |
| **B. Leave hand picks out** | Clean labels | Throws away the most useful evidence there is: the cases where the matcher failed. |
| **C. Count every hand pick as a miss, but only use it as a "same cat" label once the team has said *looks right* or nobody has flagged it within 30 days (recommended)** | Measures how often the matcher misses, which suggestions alone can't show, and keeps the labels honest | A few weeks' delay before a pick counts as a label |

**Recommendation: C.** And one thing SYC-56 should know: **a confirmed suggestion is a weaker label than it looks.** People tend to agree with what they are shown, the prompted-versus-volunteered bias the data spine already records for ear tips (§10.1). A hand pick is volunteered. The evaluation should report the two kinds separately.

**Matcher misses also test the 500 m decision.** How many hand picks are *distance misses* is the real-world evidence on whether 500 m, measured from a frozen first-spotted position, is too tight. It feeds SYC-80 (letting a cat's position follow its sightings) more directly than any argument could.

### 4.7 A colour filter, with colours read automatically from each cat's photo

**Decision (Samuel, 30 September 2026): option B.** Samuel asked for a "filter by colour" box in the picker, and chose to have each cat's colour worked out automatically from its main photo rather than tagged by people or left out.

**Why it helps.** In a dense part of Ermoupoli, "Cats known around here" can run to forty cards. A tourist who has just photographed a ginger cat shouldn't have to scroll past thirty black-and-white ones to find it. A guardian who knows the name doesn't need the filter, and loses nothing because it's there.

**The question:** where does each cat's colour come from?

| Option | What it means | Benefits | Risks | Tourists | Guardians |
|---|---|---|---|---|---|
| **A. People tag colours** (through SYC-2's coat and markings tags) | A spotter or guardian taps colour chips when adding or confirming a cat | People are usually right about colour. It builds the record SYC-2 wants anyway. | Most cats would have no colour for a long time, because it depends on people filling it in. A filter that hides most cats, or shows most of them under "not sure", is worse than no filter. It also puts a form between spotters and their points, which the data spine warns against (§7). SYC-2 isn't built. | Little help for a season | Extra tapping |
| **B. Read automatically from each cat's main photo (chosen)** | The vision model matching already uses looks at the main photo once and records the colour | Every cat has a colour, or an honest "not sure", from the day it lands, backfilled for existing cats. Nobody has to tap anything. It costs one model call per cat. | The model is sometimes wrong, and wrong in predictable ways (below). A mislabelled cat disappears from a filtered list, and that could lead to a duplicate. The guards below exist for this. | Helps from day one | Can correct it once SYC-2 lands |
| **C. No colour filter in this version** | Photos and search only | Nothing to get wrong, nothing to build | Long lists stay long in the busiest parts of town, which is exactly where duplicates are most likely | Slower scrolling | No change |

**The colours.** A small fixed list, shown as tappable chips so it works the same in all three languages:

**Black · White · Ginger · Grey · Tabby · Tortoiseshell or calico · Black and white · Not sure**

- **It fits SYC-2 and the health-record design.** SYC-2's design shows *Tuxedo / Black / Tabby / Ginger / White paws*, and the health-record design (`docs/superpowers/specs/2026-07-28-cat-health-record-design.md` §4.2) asks for a controlled list of base colour, pattern and markings, never free text. This list is the colour-and-pattern part of that vocabulary. *Black and white* is the everyday word for SYC-2's *Tuxedo*, and the two are the same value. *White paws* is a marking, not a coat colour, so it stays with SYC-2's markings and is not in the filter. When SYC-2 defines its full vocabulary, these eight values are its colour-and-pattern subset. They are not a second list.
- **A cat can carry two colours**, because *tabby* is a pattern and not a colour. A ginger tabby is recorded as *Ginger* and *Tabby*, and a grey tabby as *Grey* and *Tabby*. It shows under either chip. The model never gives more than two.
- **"Not sure"** is what a cat gets when the model can't tell, when the photo is dark or blurred, when the model call fails, or before its colour has been worked out.

**How the filter behaves**

- **"All" is selected by default.** Nothing is filtered until the spotter taps a colour.
- **More than one colour can be chosen at once** ("Ginger" and "Tabby", say).
- **Cats marked "Not sure" always stay in a filtered list**, in their own section under the matching cats, headed *"Colour not known"*. A filter never hides a cat whose colour the app doesn't know.
- **Under the list, the spotter sees how many cats the filter is hiding**, with one tap to show them: *"8 more cats nearby in other colours. Show all colours."* This is the escape hatch for a mislabelled cat (§12, pass 3). **"Can't find it? Add it as a new cat" always sits below this line**, so nobody can reach "new cat" from a filtered list without passing the reminder that some cats are hidden.
- **Chips carry the word, not just a swatch.** Each chip shows a small colour sample and the colour's name in the spotter's language, so the filter works for colour-blind spotters and in bright sun.
- **It combines with search.** Both narrow the same nearby list. When a search finds nothing because of the filter, the app says so and offers to clear it.
- **Order doesn't change.** A filtered list is still nearest first by map square, with ties by SYR number (§3.2).
- **It never touches the matcher's suggestions.** The filter lives only on the "Find the cat" screen. The suggested matches on the screen before are never filtered, reordered or hidden by colour.

**Where the colour comes from, and who can correct it**

- **Worked out once from the main photo**, by the same vision model matching already uses. It runs again whenever the main photo changes, including when the team hides a photo that was the main one. It is **backfilled** once for every existing cat.
- **Stored as an observation** in the data spine's model (`cat-record-data-spine.md` §10.1): a new kind, `coat`, authored by `system:vision` (per `DECISIONS.md` Part 2g), with `provenance: "machine"`, the photo it was read from, and which model version read it. It is never an edit to the cat. A new reading after a photo change is a new observation.
- **People outrank the machine.** A Syros Cats team member's correction always wins over the model. So does a cat guardian's, for cats they look after, once guardians have accounts (SYC-53) and SYC-2 gives them the chips to do it. A later machine reading never overrides a person's correction. It is recorded, and the person's answer still shows. This is per-attribute authority as the data spine and SYC-52 intend it: the machine's word counts for colour only, and only until a person says otherwise.
- **One cat, or "not sure".** If the main photo shows more than one cat, or no clear cat, the reading is "Not sure" rather than the colour of whichever cat is biggest.
- **Cats with no photo are "Not sure".** A resident can register a cat without a photo. The matcher can never suggest such a cat, because it has nothing to compare, so a hand pick (if it's nearby) or the team (§4.8) is the only way a sighting ever reaches it. Its colour is read when it first gets a main photo from the team.
- **Wrong colours are corrected through "Report an issue"** (*wrong information about this cat*, `team-access-and-welfare-queue.md` §6), and fixed by the team with one tap on the cat's dashboard page. Spotters don't edit colours directly.
- **The model is never asked about anything but colour here.** It does not suggest sex, age, ear tip or health from this call. The health-record design is right that those are not colour-like (§5.1 there).

**How accurate to expect it to be, honestly**

Colour is the easiest thing a vision model can read from a cat photo, and it will still get some wrong. The predictable mistakes:

- **Tabby, tortoiseshell and calico get confused with each other**, especially dark tortoiseshells and brown tabbies. That is why tortoiseshell and calico share one chip.
- **Black and dark grey or dark tabby merge** in shade or at dusk.
- **White and cream, grey and "blue"** drift with light and phone cameras.
- **A photo of half a cat**, a cat in deep shadow, or a kitten whose coat is still changing reads badly.

When the model is unsure, the answer is **"Not sure"**, never a guess. The cut-off starts cautious and is tuned against real labels once SYC-56's evaluation set exists. The health-record design (§5.1) is right that a model's stated confidence is not a probability. Until then, "Not sure" and the hidden-count line are what stop a wrong colour from causing a duplicate.

**What it costs.** One model call per cat when it joins the cat-alogue, one more whenever its main photo changes, and a single backfill of one call per existing cat (a few hundred calls). A matching call already looks at the new cat's photo when it's first spotted, so the first reading can ride along with that call, at no extra cost (*see Decision C of `docs/superpowers/plans/syc-161-auto-coat-colour.md`: the first reading is its own one-photo call, made just after the new cat is saved, and the matching call never asks about colour*). If a call fails, the cat is "Not sure" and the reading is retried the next time the photo changes, or in the next backfill run.

### 4.8 Who can pick a cat from where

**Decision (Samuel, 30 September 2026).** Only the Syros Cats team, cat guardians and vets can pick a cat from anywhere on the island. Everyone else, meaning every spotter in the app, tourists and residents alike, picks only from **"Cats known around here"**: the cats whose published 250 m square is within 1.5 km of where the photo was taken. For them, search and the colour filter narrow that list and never reach beyond it.

**Why.** It keeps the promise behind 500 m: a stranger can't attach a photo to a cat on the other side of the island. And it closes the easiest way to farm a collection, which is searching for famous cats by name.

**What "nearby" is measured from.** The location saved with the sighting: where the spotter said the photo was taken on the "New spot" screen. It is not wherever the phone is when they review it, so reviewing at the hotel that evening shows the same list as on the street. The phone and the server work it out the same way: the distance from that location to the centre of each cat's published square, with a cut-off of 1.5 km inclusive. It never uses exact positions (§4.4).

**The server enforces it.** A spotter's hand pick is accepted only if the cat is either (a) one of the suggestions the server itself made for this sighting, or (b) within the sighting's nearby set, worked out by the server as above. It must also not be deceased, and not merged away. Anything else is refused with one plain message: *"That cat isn't listed near where you took this photo. Ask Syros Cats to match it instead."* The refusal reads the same whatever the reason, and it relies only on public facts. A modified app can't get round the rule.

**Where trusted people pick from anywhere.** The app has no sign-in and never will (`cat-record-data-spine.md` §6.5), so in the app, a team member or guardian out walking is an ordinary spotter too. Picking from anywhere happens in the **staff dashboard**, where people do sign in: matching a photo sent by "Ask Syros Cats to match it", or moving a sighting to another cat (SYC-150). In plain terms:

| Who | Pick from anywhere? | When |
|---|---|---|
| **Syros Cats team** | Yes, in the dashboard | As soon as the dashboard can match and move sightings (SYC-43, SYC-150, SYC-152). **Until guardians have accounts, this is the only way anyone picks from anywhere.** |
| **Cat guardians** | Yes, in the dashboard | Only once guardians have accounts and a role (SYC-53). Until then they are ordinary spotters in the app. |
| **Vets** | Yes, in the dashboard | **Depends on a vet role that doesn't exist.** Vets have no accounts, and vet access (SYC-24) is parked by Syros Cats. Until then, a vet's knowledge reaches the record through the team. |
| **Everyone in the app** | No, nearby only | Always |

**Options considered, and why this one**

| Option | Benefits | Risks |
|---|---|---|
| **A. Anyone can pick from anywhere** (the earlier draft) | Fewest duplicates for cats far from their first-spotted position | Anyone can attach a photo to any cat on the island. It makes collection farming by name easy, and it stretches the 500 m promise further than Syros Cats may accept. |
| **B. Nearby only for spotters; anywhere for trusted people, through the dashboard (chosen)** | Keeps strangers local, and the server enforces it. Trusted people keep full reach where they sign in. "Ask Syros Cats" stops the far-away case turning into a duplicate. | A few more "ask Syros Cats" requests for the team, especially while cats sit at their frozen first-spotted positions (until SYC-80). Guardians can't do it themselves until SYC-53. |
| **C. Nearby only for everyone** | Simplest | The team couldn't fix a match across the island, and far-away cats would become duplicates. |

**The limit, stated honestly.** The spotter chooses the sighting's location: the "New spot" screen lets them move the pin, and it must, because phone GPS on Syros is often poor. So someone determined can put a photo "near" any cat by moving the pin. The rule stops casual and scripted cross-island picks. It does not stop a person who lies about where they were. Each attempt still costs a real photo of a real cat against the per-device limits, and a sighting pinned far from where the phone actually was gives nothing away about any cat. Recording the phone's own GPS reading beside the pin, to flag big moves, was considered and rejected. It would store more of the spotter's own movements than the app needs.

---

## 5. What the team sees

**A "Matched by hand" list on the staff dashboard**, in the "fixing what is wrong" area (`team-access-and-welfare-queue.md` §3.3). It sits below the welfare queue and below "Report an issue", and is never above either. A wrongly matched photo is not an emergency.

- Each row: the spotter's photo beside the chosen cat's main photo and two recent photos. How the pick was made (nearby, search or name prompt). For the team only, the distance between the photo and the cat's recorded position. And any flags: *far from recorded position*, *picked by hand often lately*, *this device picks by hand a lot*, *says ear tip clipped*.
- **Photos waiting for a match**, from "Ask Syros Cats to match it", sit at the top of the list, with the spotter's photo, the location's published square, and a search across the whole island. Here the team (and later guardians and vets, §4.8) chooses the cat, or makes it a new cat. Doing so resolves the sighting on the spotter's behalf, credits their points, and sends them a notification (*"Syros Cats matched your photo to Agatha"*).
- Then flagged rows, then newest first.
- Three buttons: **Looks right** · **Different cat…** (search, then move) · **It's a new cat** (move it to a new cat record).
- The list is for glancing, not clearing. Unchecked picks simply age out of view after 30 days. They are not deleted, and SYC-56 can still use them as labels (§4.6).
- The same checks appear on the cat's own dashboard page, so a team member looking at Agatha sees "3 photos matched by hand" without opening a separate list.

**Moving a sighting to a different cat is not something the data spine can do yet** (§8.2). "Different cat…" and "It's a new cat" depend on it. Until it exists, the list offers **Looks right** plus **Hide this photo**, which already exists and is reversible, and the hand-pick record carries the team's verdict so the move can be done properly later.

---

## 6. Words on screen

English below. Every string also needs Greek and French, and a local check before launch, the same as all copy in `team-access-and-welfare-queue.md` §5. The colour words most of all: *tabby* (τιγρέ, tigré) and *tortoiseshell or calico* are the ones people get wrong.

| Where | Copy |
|---|---|
| Card under suggestions | **Not one of these?** Find the cat yourself |
| Line on the new-cat screen | Seen this cat in the app before? **Find it instead** |
| Picker title | Which cat is it? |
| Search box | Name or SYR number |
| Colour chips | All · Black · White · Ginger · Grey · Tabby · Tortoiseshell or calico · Black and white · Not sure |
| Section under filtered cats | Colour not known |
| Hidden-count line | {n} more cats nearby in other colours. **Show all colours** |
| Search finds nothing because of the filter | No {colour} cats called "{text}". **Search all colours** |
| List heading | Cats known around here |
| Side-by-side button | Yes, this is the cat |
| Bottom of picker | Know this cat, but it isn't here? **Ask Syros Cats to match it** · Can't find it? **Add it as a new cat** |
| After asking | Sent to Syros Cats. We'll let you know when they've matched it. |
| Refused as not nearby | That cat isn't listed near where you took this photo. **Ask Syros Cats to match it instead** |
| Name taken, cat not nearby | There's already a cat called {name}, but not near here. Is it {them}? · **Yes, ask Syros Cats to match it** · No, a different cat |
| Notification when matched | Syros Cats matched your photo to {name} |
| Deceased card (not pickable) | No longer with us |
| Name taken | There's already a cat called {name}. Is this {them}? · **Yes, that's them** · No, a different cat |
| No signal when sending | No signal. Your sighting is saved. Finish this when you're back online. |
| Saved cat-alogue is old (shown offline only) | Showing the cats saved on your phone. New ones may be missing. |

---

## 7. Abuse, and what stops it

| Someone tries to… | What happens |
|---|---|
| Fill their collection by picking famous cats from anywhere on the island | The server only accepts a spotter's hand pick of a nearby cat (§4.8). Moving the pin to sit near a famous cat still works for someone determined, and that is accepted. Each pick needs a real photo of a real cat (the no-cat check still runs) and counts against the per-device limits on sending photos (`cat-record-data-spine.md` §6.3 point 2). The team's list flags picks far from the cat and devices that pick by hand a lot. They keep their points if moved, but the collection follows the corrected cat. |
| Mark a cat dead or alive | Deceased cats can't be picked by hand. A hand pick can't clear a death. |
| Make an unsterilised cat look sterilised | The "clipped" answer counts, but goes to the top of the team's *Likely* review list, marked *matched by hand*. |
| Find a cat's exact position by trying picks from different places | The picker uses published positions only, doesn't depend on what the matcher checked, and replies the same whether a pick is flagged or not (§4.4). |
| Flood a cat's page with wrong photos | "Report an issue → not this cat", the *picked by hand often lately* flag, and one-tap photo hiding. |

---

## 8. Fit with the data spine and duplicate merging

### 8.1 A hand pick is an ordinary sighting

The sighting, its photo and the optional answers (ear tip, food and water, note) are written exactly as for any match, as `cat-record-data-spine.md` §10.7 defines. The only additions are the team-only match record (§4.6), the two guards in §4.3, and the nearby-only check (§4.8). A photo sent to Syros Cats to match waits on the server, unresolved, until the team matches it, and it earns nothing and counts for no cat until then. Nothing about how status is worked out changes, apart from the guard that keeps deceased cats out of the picker. That guard changes what the picker offers, not the data spine's rule.

### 8.2 The gap this spec finds: moving a sighting to the right cat

Nothing in the approved specs lets the team say *this sighting is of a different cat*, and it is harder than it sounds:

- A sighting records the cat it belongs to, and the spine treats sightings as rows that are added, never rewritten, apart from redaction (§8.5).
- The observations written from that sighting (ear tip, food and water, note) each carry the **cat's** id as well as the sighting's. If only the sighting moved, a "clipped" answer would stay on the wrong cat.
- `cat_identity` (§10.3) merges whole cats. It can't move one photo.

**What it needs to do, in plain terms:** moving a sighting is a new, attributed, dated statement, never an edit. The old link stays in the record. Every observation made from that sighting is marked as replaced on the old cat and restated on the new one, attributed to the team member who moved it. The old cat's derived status then works itself out again. That shape belongs to the data spine and is filed there (§11). Until it exists, §5's fallback applies.

### 8.3 Deceased cats and the "walk back into frame" rule

§3.2 of the data spine says any later sighting clears a deceased statement, and this spec keeps that rule exactly. It only stops a hand pick from being the sighting that does it (§4.3). A suggested match, where the photo check itself found the likeness, still clears it.

### 8.4 Coat colour is an observation like any other

The colour behind the filter is a `coat` observation (§4.7), written by `system:vision` with `provenance: "machine"`. People's corrections are observations too, written by staff or, once they have accounts, by guardians. **The data spine owns the new kind and the rule for which reading wins**: a single spotter fills a gap but never overturns a machine reading; two independent spotters (different devices, photos and days), a cat guardian for her own cats, or the team do (`coat-markings-and-health.md` §4.2, SYC2-D10). That rule is filed there (§11), not defined here. *(Amended 12 October 2026, SYC2-D10.)* What this spec needs from it is small: the public cat payload carries the resolved colour (`coat`, a list of one or two colours; `coat: []` means not known, never the string "not sure"), and nothing else about how it was worked out.

Colour is **not evidence of life** (`cat-record-data-spine.md` §3.4). Reading a colour off a years-old photo says nothing about whether the cat is alive, so a backfill run never makes an old cat look recently seen. It is also **never notifiable** (§9): nobody gets news that a cat's colour changed.

**The public payload carries the resolved colour only**: not when it was read, not which model read it, and not whether a person or the machine said it. Those stay in the observation, visible to the team.

**A hand pick never becomes a cat's main photo automatically.** Otherwise a wrong hand pick on a photoless cat would give it the wrong face, and then the wrong colour. A main photo comes only from the sighting that created the cat, or from the team.

### 8.5 Duplicate merging (SYC-59)

- **This feature stops duplicates being made. SYC-59 cleans up the ones that get through.** They share evidence: a spotter who opened "Find the cat", looked, and still chose "New cat" is weak evidence the cat really is new. A spotter who chose "New cat" without opening it is none. SYC-59's detection can use the difference.
- **Merged cats.** The picker lists only the surviving cat of a merge. Its colour is the surviving cat's own. A merge doesn't combine colour readings. Search matches a cat's earlier names too, so "Agatha" still finds her after she was merged into "Αγάθη". Names are compared in the folded form from `DECISIONS.md` Part 2g, so Greek accents and capitals don't matter.
- **The name-taken prompt** (§3.1) is a lightweight version of SYC-59's third trigger ("this might be the same cat as…") at the moment of creation, and both should use the same words for it.

---

## 9. Technical notes

For whoever builds it. Everything above is the product.

- **The picker reads the same public cat-alogue as the Cats tab** (the saved copy offline, fresh when online), filtered and sorted on the phone by published position. There is no new "list cats near this sighting" endpoint. If the cat-alogue becomes paginated (`cat-record-data-spine.md` §2.3), the phone must still hold every cat within 1.5 km of the sighting, fetched by a public "cats near here" request that uses published positions only. Offline search then only covers what the phone has saved, and the "may be missing" line says so.
- **Deceased cats** are marked in the public cat payload already (`lifeStatus`), so the phone can grey them out. **The server must also refuse** a hand-pick choice of a deceased cat, because the phone can't be trusted to enforce it.
- **Resolve.** The choice request gains an optional "which screen" field (`nearby`, `search`, `name_prompt`). The server compares the chosen cat against its own stored list of suggestions to decide *suggested* versus *hand pick*. It never accepts the phone's word on that.
- **Nearby check on resolve.** For a device caller, a hand pick is accepted only if the cat is in the server's stored suggestions for that sighting, or its published square is within 1.5 km of the sighting's stored location (inclusive, the same shared function the phone uses). The cat must also not be deceased or merged away. Every refusal returns the same status and message. The phone uses the location it sent with the sighting, so both sides measure from the same point.
- **"Ask Syros Cats to match it"** is a new request on the sighting. It marks it *waiting for a match* (team-only), removes it from the phone's review list, and adds it to the team list. A team match resolves it on the spotter's behalf through the dashboard, with a new named capability (`match_sighting`, alongside `team-access-and-welfare-queue.md` §7.3's list), awards the points and notifies the spotter.
- **Stored with each match**: the cats compared, the cats suggested with rank and score, and later the choice and how it was made. Team-only, never in any public response.
- **Response shape** for a hand pick is identical to a suggested match, including timing. No field, message or status code differs when a pick is flagged.
- **Name-taken**: when the name is taken, the server's refusal also returns that cat's id, name, main photo and whether it is deceased (all public), so the phone can ask "Is this them?", or skip the question for a deceased cat. The comparison uses the folded name from `DECISIONS.md` Part 2g.
- **SYR numbers in search** accept every way people write them: `SYR-0042`, `syr 42`, `0042` and `42` all find cat 42.
- **Colour** travels in the public cat payload as a list of at most two values from the fixed eight. A missing value, as in an older saved cat-alogue, is treated as "Not sure". There is no cache bump: `coat` is already in the v2 cat-alogue (`coat-markings-and-health.md` §10.4), and a retired cache key is deleted unread, which would empty a phone's offline cat-alogue.
- **Colour reading** is a server job: on a new cat, on a main-photo change, and a one-off backfill that can be re-run safely. It asks the model for colour only. It writes a `coat` observation, including "not sure", and never writes over a person's correction. Failures are logged and leave the cat "Not sure".
- **Nothing about colour reaches the matcher.** The suggestions are worked out exactly as `DECISIONS.md` Part 2h says, with no colour pre-filter. The health-record design's idea of colour as a cheap pre-filter for matching is a separate decision, not made here.
- **The match record is linked to the sighting, never to a device.** Deleting a person (`cat-record-data-spine.md` §8) severs the sighting from them, and the match record needs nothing extra.

## 10. Tests that must exist

1. The picker's list for a given photo location is identical whether the matcher compared 0, 3 or 10 cats. It depends only on published positions.
2. Moving a cat's exact position anywhere inside its 250 m square doesn't change the picker list or its order for any photo location. Only published positions count.
3. A hand-pick response is byte-for-byte the same shape whether or not the pick is flagged far away.
4. The server labels a choice *suggested* only if that cat was in its stored suggestions. A phone claiming otherwise changes nothing.
5. A hand pick of a cat with a live deceased statement is refused by the server. A suggested match of the same cat is accepted and clears it (data spine §3.2 unchanged).
6. A hand pick awards the same points as a suggested match (SYC-38 values).
7. A "clipped" answer on a hand pick puts that cat at the top of the *Likely* review list, marked *matched by hand*.
8. No public payload contains the match record, the compared list, the "which screen" field or any flag.
9. A merged-away cat never appears in the picker. Searching its old name finds the surviving cat.
10. Offline: the picker opens and searches from the saved cat-alogue. Sending without signal keeps the sighting in the review list and loses nothing.
11. The name-taken prompt is not offered for a deceased cat.
12. `SYR-0042`, `syr 42`, `0042` and `42` all find cat 42.
13. With a colour selected, every cat whose colour is "Not sure" or missing still appears, under "Colour not known".
14. The filter never changes the order: a filtered list is the unfiltered list with cats removed, still nearest first by map square, with ties by SYR number.
15. The suggested matches are identical whatever colour filter the spotter last used.
16. A team correction of a cat's colour wins over any machine reading, including a newer one after a photo change.
17. A backfilled colour reading doesn't change any cat's "last seen" or presumed-deceased status.
18. The picker list for a given photo location, with any colour filter, is a subset of the unfiltered list and depends on nothing but public data (extends test 1).
19. A main photo showing two cats reads as "Not sure".
20. No public payload contains a colour reading's date, model version or author.
21. A hand pick on a cat with no photo does not become that cat's main photo.
22. The server refuses a spotter's hand pick of a cat whose published square is more than 1.5 km from the sighting's location, even if the request is crafted by hand. It accepts one at exactly 1.5 km.
23. The server accepts a suggested cat whatever the distance rule says.
24. Moving a cat's exact position within its square never changes whether a pick is accepted. Every refusal is identical in status, message and shape.
25. The phone's nearby list and the server's nearby check agree for every cat, over a grid of sighting locations, because both use one shared function.
26. The nearby set is measured from the sighting's saved location, not the phone's current one.
27. "Ask Syros Cats to match it" awards nothing until the team matches it. A team match awards 15 points (25 for a new cat) to the spotter's device and notifies them.
28. Search and the colour filter never return a cat outside the nearby set in the app.

---

## 11. Follow-ups this spec creates

Filed to Linear under SYC-119 (deduplicated against existing tickets):

- **Coat colour read automatically from each cat's main photo, backfilled, and stored as a `coat` observation** (data spine, with SYC-2): the vocabulary, the machine reading, the backfill, and the rule that people outrank the machine (§4.7, §8.4). Filed as SYC-161, linked to SYC-2.
- **"Ask Syros Cats to match it", matched in the dashboard** (§3.2, §4.8, §5): added to SYC-152's scope, together with the server's nearby check on resolve.
- **Vets picking from anywhere** depends on a vet role that doesn't exist. Noted on SYC-24 (vet access, parked by Syros Cats) rather than filed as a new ticket.
- **Moving a sighting to a different cat, or to a new cat** (data spine): the append-only reassignment in §8.2, including restating the sighting's observations on the right cat.
- **The team-only match record** (data spine): what was compared, suggested and chosen, per sighting (§4.6). This is the data SYC-56 needs. Defined in `cat-record-data-spine.md` §10.9.
- **SYC-56 note**: report hand picks and confirmed suggestions separately, and count distance misses as evidence for SYC-80 (§4.6). Added as a comment on SYC-56 rather than a new ticket.
- **Queue "That's the one", "New cat" and hand picks when there's no signal** (§4.5, option B): its own piece of work, if ever.
- **The "Matched by hand" dashboard list** (§5): an addition to SYC-43's scope, filed as its own ticket linked to SYC-43.

## 12. Review findings

The review ran in four passes, and all of them assumed the spec was wrong. They looked for abuse paths, privacy leaks, conflicts with the approved specs and `DECISIONS.md`, and dead ends. **Pass 1** stress-tested the design while it was being written, so the first committed draft already handled those findings. **Pass 2** attacked that committed draft (commit `5523d70`) and changed it. **Pass 3** attacked the colour filter and nearest-first wording added on 30 September. **Pass 4** attacked Samuel's nearby-only rule for spotters, also added on 30 September. Every finding is folded into the sections cited.

### Pass 4: review of the "nearby only for spotters" rule (30 September 2026)

Samuel decided that only the team, guardians and vets pick from anywhere. This pass attacked that change.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| N1 | **A rule only the app enforces isn't a rule.** Anyone can send a choice request by hand. | High (integrity) | The server checks every spotter's hand pick against the nearby set (§4.8, §9, test 22). |
| N2 | **The server's check could become the location probe again.** A refusal worked out from exact positions answers "is this cat within 1.5 km of here?" about where it really is. | High (privacy) | The check uses published squares only, and every refusal is identical (§4.4, tests 24 and 25). |
| N3 | **Spoofing the photo location widens the nearby set.** The spotter sets the pin, and must be able to. | Medium (abuse) | Accepted and stated. It stops casual and scripted picks, not a determined liar. Each attempt costs a real photo against the device limits. Recording the phone's GPS beside the pin was rejected as more personal data than the app needs (§4.8). |
| N4 | **What is "nearby" measured from?** The phone's current location would change the list depending on where someone reviews, and would disagree with the server. | Medium (consistency) | Measured from the sighting's saved location, the same on both sides (§4.8, test 26). |
| N5 | **Phone and server could disagree at the edge**, for example 1.49 km against 1.51 km, or after a cat's published position changes (SYC-80). | Medium (UX) | One shared function with an inclusive cut-off. If the saved cat-alogue is stale, the refusal points to "Ask Syros Cats" (test 25). |
| N6 | **A new dead end: a guardian who knows a far-away cat** could only add a duplicate. With SYC-80 not built, cats sit at their first-spotted positions, so this will happen. | High (duplicates) | "Ask Syros Cats to match it" on the picker and on the name-taken prompt. Points are paid when the team matches it (§3.2, §5). |
| N7 | **"Guardians and vets can pick from anywhere" sounds live, but isn't.** The app has no sign-in, guardians have no accounts yet (SYC-53), and vets have no role at all (SYC-24 is parked). | Medium (honesty) | Stated plainly: for now it is team-only, in the dashboard. The vet dependency is noted on SYC-24 (§4.8). |
| N8 | **The deceased-cat route sent people to "Report an issue",** a separate flow that left the sighting stuck. | Low (UX) | Folded into "Ask Syros Cats to match it", marked *says this cat is alive* (§4.3). |
| N9 | **Pagination could shrink the nearby set on the phone** if the cat-alogue stops arriving whole. | Low | The phone must hold every cat within 1.5 km, fetched from published positions (§9). |

### Pass 3: review of the colour filter and the nearest-first wording (30 September 2026)

These additions were attacked on their own: could colour plus nearest-first plus search narrow down where a cat is, what happens when the model gets a colour wrong, and what breaks elsewhere.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| C1 | **Does colour plus nearest-first plus search narrow down where a cat is?** Checked, and no. Every input is public: the published square, the SYR number, the name, and a colour read from a photo that is already public. Filtering a public list by a public value picks out public records. It adds nothing to what the cat-alogue already says about position, and the order is still by map square. The hidden-count line counts cats from the same public list. | Checked (privacy) | No new location channel. Locked in by tests 14 and 18. |
| C2 | **A mislabelled cat vanishes from a filtered list**, and the spotter adds a duplicate. This is the main risk the filter brings, because the colours the model mixes up (tabby and tortoiseshell, black and dark tabby) are common on Syros. | High (duplicates) | "Not sure" cats always stay visible. The hidden-count line with "Show all colours" sits above "Add it as a new cat", so nobody reaches "new cat" without passing it. A filtered search that finds nothing says why (§4.7). |
| C3 | **The model could read the wrong cat** when the main photo shows two. | Medium (data quality) | Two cats, or no clear cat, reads as "Not sure" (§4.7, test 19). |
| C4 | **A wrong hand pick on a cat with no photo** could become its main photo, giving it the wrong face and then the wrong colour. This compounds the hand-pick risk in §4.3. | Medium (data quality) | A hand pick never becomes a main photo automatically (§8.4, test 21). |
| C5 | **Colour metadata could leak when things happen.** A reading's date shows when a main photo changed, and so when the team acted on a cat. | Low (privacy) | The public payload carries the resolved colour only (§8.4, test 20). |
| C6 | **A backfill could look like evidence the cat is alive.** Reading hundreds of old photos in one night must not refresh "last seen" or undo "presumed deceased". | Medium (conflicts with data spine §3.4) | Colour is not evidence of life and is never notifiable (§8.4, test 17). |
| C7 | **A machine reading could overwrite a guardian's or the team's correction** after a photo change. | Medium (authority) | People always outrank the machine, even a newer reading (§4.7, test 16). The rule is filed with the data spine. |
| C8 | **Could the public run up the model bill?** Only a main-photo change triggers a reading, and no public route changes a main photo: an owner can rename a cat, but not change its photo. | Checked (cost) | No new abuse path. The backfill is a one-off that can be re-run safely. |
| C9 | **Could the filter touch the matcher's suggestions** and hide the right cat before the spotter ever reaches the picker? | High if it did | It can't. The filter lives only on the picker. Colour is never a matching pre-filter (§4.7, §9, test 15). |
| C10 | **Colour-only chips fail colour-blind spotters, and sunlight on a phone screen.** | Low (accessibility) | Every chip carries the colour's name as well as a sample (§4.7). |
| C11 | **Coat words are easy to mistranslate** (tabby is τιγρέ in Greek and tigré in French; tortoiseshell and calico have no everyday Greek word). | Low (copy) | Named for the local check (§6). |
| C12 | **"Nearest first" could be read as "exactly nearest".** A reader who missed §4.4 might "fix" the order to use exact distance. | Medium (future regression) | Stated prominently in §3.2 and §4.4, with the reason, and locked in by tests 2 and 14. |

### Pass 2: review of the written draft

| # | Finding | Severity | Resolution |
|---|---|---|---|
| R1 | **A mistakenly "deceased" cat became a dead end.** Blocking hand picks of deceased cats left a guardian holding a photo of a living cat with only "New cat" to press, which creates exactly the duplicate this feature exists to stop. | High (UX, duplicates) | The card offers "Think this cat is alive? Tell Syros Cats", which opens Report an issue with the photo. The sighting waits safely in the review list (§4.3). |
| R2 | **The name-taken prompt could offer a deceased cat**, and the server would then refuse the "Yes". | Medium (UX) | No prompt for a deceased cat. The spotter is asked for another name (§3.1, §9, test 11). |
| R3 | **Island-wide search goes beyond the 500 m promise.** *(Superseded by Samuel's rule in §4.8.)* The promise is about automatic suggestions, but Syros Cats may read it as "photos never get attached to cats across the island". | Medium (conflict with a commitment to the charity) | Stated explicitly (§4.1), and put to Syros Cats as open question 4. |
| R4 | **Wrong "spotted again" notifications and kept points were risks the draft left unstated.** A wrong hand pick notifies followers with the wrong photo, and a points farmer keeps the points. | Medium (honesty of the spec) | Both named as knowingly accepted, with reasons (§4.3). |
| R5 | **A lazy spotter might tap the first cat just to finish**, swapping a duplicate for a wrong match. | Medium (data quality) | The side-by-side check is a deliberate second step (§3.2). |
| R6 | **Test 2 was untestable as written.** It compared a 499 m and a 501 m sighting, which can sit in different 250 m squares. | Low | Rewritten: moving a cat's exact position within its square changes nothing (test 2). |
| R7 | **"SYR number" search would fail on how people write it.** The Cats tab searches the bare number, and people will type `SYR-0042`. | Low | All forms accepted (§9, test 12). |
| R8 | **The spec described current behaviour as "today"**, against the project rule that specs describe one vision. | Low (house style) | Reworded. The problem is framed as what testers met on 29 September (§2). |
| R9 | **Was the match record personal data under deletion?** | Low | It is linked to the sighting, never to a device, so deletion needs nothing extra (§9). |

### Pass 1: found while designing, before the first draft was committed

| # | Finding | Severity | Resolution |
|---|---|---|---|
| D1 | **The nearby list could hand back the 500 m probe.** A list that left out cats already compared, to avoid repeats, would reveal which cats are more than 500 m away on exact positions, one tap at a time. | High (privacy) | The list is built as if the matcher had never run. Suggested cats may repeat (§4.4, test 1). |
| D2 | **A friendly "this cat is usually far from here, are you sure?" warning is an oracle.** Moving around and watching when it appears locates the cat. | High (privacy) | Not offered. The far-away flag is team-only, and the reply is identical either way (§4.4, §9, test 3). |
| D3 | **A hand pick could bring a dead cat back to life.** The data spine clears *deceased* on any later sighting. That is right for a photo match and wrong for a guess. | High (welfare, trust) | Deceased cats can't be picked by hand. The server refuses too. The spine's rule is unchanged (§4.3, §8.3, test 5). |
| D4 | **A wrong hand pick plus "Yes, clipped" makes the wrong cat *Probably sterilised*.** The cat that really needs the €50–60 operation drops down the trapping list. | High (welfare) | The answer counts but goes to the top of the *Likely* review list, marked (§4.3, test 7). |
| D5 | **The choice request takes any cat and nothing records what was suggested**, so a hand-pick label sent by the phone could simply be left off. | High (integrity) | The server stores what it suggested and decides the label itself (§4.6, §9, test 4). |
| D6 | **"Send picks to the SYC-43/SYC-53 confirmation queue" misreads SYC-53.** That queue is for cats at *Likely* that someone could settle by going to look. | Medium (conflicts with approved scope) | The list lives in the dashboard's "fixing what is wrong" area (§4.3, §5). |
| D7 | **Moving a sighting isn't possible in the approved data model**, and observations from the sighting stay tied to the old cat. | Medium (gap in approved specs) | Gap named, shape stated, ticket filed. Interim: *Looks right* plus *Hide this photo* (§5, §8.2). |
| D8 | **Dead end when there are no suggestions.** After Part 2h this is the case most likely to create duplicates. | Medium (UX) | A way in on the new-cat screen (§3.1). |
| D9 | **Fewer points for a hand pick would create more duplicates**, because "New cat" would then clearly pay more. | Medium (incentives) | Same 15 points (§4.2). |
| D10 | **A 500 m nearby list would miss exactly the cats the matcher missed.** | Medium (UX) | 1.5 km list, matching the Cats tab (§4.1). Cats further away go through "Ask Syros Cats to match it" (§4.8). |
| D11 | **Offline is easy to overstate.** Photos only show if already loaded, the saved cat-alogue can be stale, and sending needs signal. | Medium (canonical fact) | Step-by-step table (§4.5) and honest on-screen lines (§6). |
| D12 | **Colony-name search would publish which colony a cat belongs to**, with a guardian's name. | Medium (privacy) | No colony search in the public picker (§4.4). |
| D13 | **A match percentage on cats the app never compared** would be invented. A "compare for me" button would be a free AI service. | Low | Neither is offered (§3.2, §4.4). |
| D14 | **Confirmed suggestions are biased labels for SYC-56.** | Low (measurement) | Report the two kinds separately (§4.6). |
| D15 | **Holding points until the team checks** would make the list a backlog the charity must clear. | Low | Rejected (§4.2, option D). |
| D16 | **A merged-away cat in the picker** would spread picks across both halves of a merge. | Low | Only the surviving cat is listed. Old names still find it (§8.5, test 9). |
| D17 | **Telling the spotter their pick "will be checked"** treats the helpful as suspects. | Low (tone) | Not said (§3.3). |

## 13. Open questions

**All five are answered.** Samuel's approval on 30 September 2026 accepted the recommendations on questions 1, 2 and 5. The same day he answered 3 and 4 himself, so nothing needs asking of Syros Cats.

| # | Question | Owner | Recommendation |
|---|---|---|---|
| 1 | Should Syros Cats see a hand pick's flags on the cat's dashboard page as well as in the list? | Samuel | **Answered 30 Sep 2026: yes** (§5). It costs nothing and is where they'll actually be looking. |
| 2 | Is 30 days right, both for the list ageing out and for an unflagged hand pick to become a SYC-56 label? | Samuel | **Answered 30 Sep 2026: yes, 30 days for launch.** Revisit once SYC-56 has a first baseline. |
| 3 | Should guardians see hand picks in their own colonies once they have accounts (SYC-53)? | Samuel | **Answered 30 Sep 2026: yes.** Guardians see hand picks in their own colonies once they have accounts (SYC-53). |
| 4 | Can anyone pick a cat from anywhere on the island, while automatic suggestions stay within 500 m? | Samuel | **Answered 30 Sep 2026, with a change: no.** Only the Syros Cats team, cat guardians and vets can pick from anywhere, in the dashboard. Spotters in the app pick only from cats known around here, and the server enforces it (§4.8). |
| 5 | Where should the "not sure" cut-off sit for colour at launch, before SYC-56 has labels to tune it? | Samuel | **Answered 30 Sep 2026: cautious.** It's better to show a cat under "Not sure" than to hide it under the wrong colour. Re-tune once there are a few hundred checked cats. |
