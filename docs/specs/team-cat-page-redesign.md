# The team cat page, redesigned

**Status:** approved by Samuel, 22 Oct 2026 ("approved, write the plan"). D1 and D2 decided the same day (§6).
**Covers:** the page the team sees for one cat in the dashboard (`/api/team/cats/:id`, `renderCatPage` in `artifacts/api-server/src/lib/teamPages/catPages.ts`).
**Mockup:** [`assets/team-cat-page-redesign/mockup.html`](assets/team-cat-page-redesign/mockup.html). Open it in a browser and narrow the window to see the phone layout.
**Builds on:** [team-dashboard-redesign.md](team-dashboard-redesign.md) §7 (the team cat page) and §12 (design rules). Where this document and §7 differ, this one wins. Everything else in that spec still stands.

## 1. Why

The team opens a cat's page to answer three questions: *who is this cat?*, *what do we know about it?*, and *what do I need to do?* Today the first two are answered at the top. After that, the page turns into a long scroll of the same facts in three different lists.

We rendered today's page with an ordinary sample cat (6 sightings, 4 photos, 1 vet visit, 21 history entries) on 22 Oct 2026. These are the problems:

1. **It's very long.** About 4,800px on a desktop and 5,700px on a phone, even with everything folded. Every sighting, photo and history entry is its own large box with its own button.
2. **The same visits are listed three times.** Sightings, All photos and History each list the same visits. A vet visit appears in both Vet visits and History.
3. **The coat section reads like a database.** It sits in the middle of the page, with "likely" and "reported" tags, "#120" numbers, model names, and a "That's right" button that doesn't say what it agrees with (SYC-521, SYC-469). It shows even when the "What we know about this cat" heading above it looks closed.
4. **Half the desktop screen is empty.** The buttons on the right end after about 600px. Below them is blank space while the facts are squeezed into the left half.
5. **A risky action is the loudest thing on the page.** Every photo has a red "Hide from the public" button under it.
6. **Small wording slips.** One button says "Colony" where the others say "Update…", record numbers like "#301" appear, and there's no "Add a note" (SYC-446).

On the same sample cat, the mockup is about 1,800px on a desktop and 3,600px on a phone, and shows the same information.

## 2. Goals, non-goals, anti-goals

**Goals**
- In the first screenful, on a phone and on a desktop, the team sees: the photo, the name, the four facts that matter (sterilised, where the cat lives, colony, last seen), and the main buttons.
- Everything that happened to the cat is in **one history list**, newest first, with nothing listed twice.
- Risky actions are in red and always say what they act on. Mark wrong and Hide from the public are one tap further away, in a ⋯ menu. "This cat has died" stays its own button (SYC-513), set apart from the others.
- Plain words throughout, keeping the words agreed in #192: "What we know about this cat", "Since", "Why we think so", "Says otherwise", "Date it happened", "History", and "change".

**Non-goals**
- No change to what is recorded, or how a fact is worked out from the records (the resolver). The page shows the same data, laid out differently.
- No change to the cat guardian's cat page, the public app, or the Cats grid.
- No new team powers except "Add a note" and the "Health note" fact, which §7 of the dashboard spec already includes (SYC-446).

**Anti-goals** (what would make this a failure even if it works)
- Hiding a fact's evidence so that the team has to trust a value without being able to see why.
- A page that needs JavaScript to be usable. Today every part of the dashboard works without it, and this page must too.
- Making it easier to change a record by accident.

## 3. The page, top to bottom

### 3.1 The summary

**Name line.** The cat's name, then a small line with the SYR number and "on our records since 3 Apr 2026".

**Status line.** One line under the name: the sterilisation mark and word (§12.2 of the dashboard spec), where the cat lives, the colony (as a link), and "Last seen 4 days ago". On a phone this line sits above the photo, so a glance tells you who the cat is before you scroll.

**Photo.** The main photo, 4:3, with a strip of up to three more and an "All N" tile that jumps to Photos. A photo hidden from the public is dimmed in the strip and labelled "Hidden" (fixes SYC-459 item 2).

**Facts.** One white panel with a row per fact: the label on the left, the value on the right, and one line of grey text under the value saying where it comes from. This replaces today's grid of boxes, which takes twice the height. The rows, in this order:

| Fact | Example value | Grey line under it |
|---|---|---|
| Sterilised | "Yes, confirmed by Syros Cats, 13 Aug 2026" / "Probably: clipped ear seen in 3 photos" / "No, Syros Cats' records" / "Not known" | (in "Why we think so") |
| Lives | "On the street" / "Has a home" / "In care" / "No longer with us", plus "Not seen since Jun 2026" where it applies, and today's presumed-dead note | "Set by Maria, 14 Oct 2026", or "Set by a spotter" / "Worked out from the sightings" when no team member set it |
| Owner | only when the cat has an owner or an orphaned home: "Has an owner", the home note, and the home pin (pin only for `view_exact_location`, as today) | today's owner-claim hint |
| Colony | the name as a link, or "No colony" | none |
| Coat | chips, e.g. "Grey tabby", "White paws" | "Read from the photo · Maria agreed" |
| Last seen | "4 days ago · Ermoupoli" | "Seen 21 times since April" |
| Vaccinated | "Rabies, 13 Aug 2026" (only where recorded) | none |
| Health note | the newest standing team note's text (only where there is one) | "Maria, 2 Oct 2026 · team only" |

The sterilised values are the ones already shipped (#228, #290) and keep their wording exactly, including "Not known". "Probably, checked in person by the cat guardian" is not shown, because nothing records it yet (SYC-400). The "Confirmed by …, This is wrong?" line for a cat guardian's confirmation stays under Sterilised, as today. Colony keeps "was called …" for a renamed colony. The cat's description, written by whoever first spotted it, stays as one line under the facts panel.

**Notices.** Today's notices keep their place at the very top of the summary, above the name: the cat guardian's recent mark (`guardianMarkNotice`), the death notice, and the explanation when the main photo is hidden. A notice never sits inside something folded.

**Why we think so.** Each fact that has evidence gets a small "Why we think so" link under its value. It unfolds to show "Since", "Why we think so" and "Says otherwise", each item linking to its row in History. This is where today's "What we know about this cat" section goes. The evidence is one tap away beside the fact it explains, not in a separate section further down.

**What the public sees.** One line in smaller grey text under the facts panel, as today.

**Reports.** Only for people who may see the welfare queue (`view_welfare_queue`, as today). If the cat has open "Report an issue" reports, an amber box sits above the facts panel: "1 open report: Looks injured · 2 days ago", linking to that report in the queue. Today's full list of reports (state, "Photo hidden", "N others like it", "showing newest X of Y") moves to its own **Reports** section beside Photos, with a "Reports (N)" jump link. With no reports at all, neither the box nor the section appears.

### 3.2 The buttons

Four buttons, in this order:

1. **Log a vet visit**: the solid teal main button, full width.
2. **Update this cat ▾**: one outlined button. It unfolds into the list of things the person may change: "Where the cat lives", "Whether sterilised", "Coat and markings", "Change the colony", "Take out of this colony" (red), "Rename the cat", and "Remove owner" (red; only when the cat has an owner or an orphaned home, with today's `remove_owner` and `set_life_status` gates, its dead-cat variant and its "Are you sure?" page, #192). Each opens the same form as today, folded inside the list. Each item shows only if the person may do it, as today.
3. **Add a note**: outlined. It opens a short form for a team-only note. As SYC-446 set out, this writes the existing `team_note` record kind, gated on `add_team_note` (island-wide, team roles only). Only people with that capability see team notes, on this page or anywhere else. They never reach a cat guardian or the public. The newest standing note shows as the "Health note" fact. This is separate from the owner/public `note` kind and from `add_health_note`, which this design doesn't touch.
4. **This cat has died**: red outline, set a little apart below the others, as shipped in SYC-513, with its confirmation.

"How changes work" moves from beside the buttons to the foot of History, where Mark wrong lives. It keeps #192's words.

**After a save.** Any form opened from a menu (Update this cat, a ⋯ menu, the Coat fold) is drawn open again when the page comes back with its result (`done`, `at`, `p`) or its re-filled text after signing in (`kept`). The "saved" notice shows beside the thing that changed, as today, never inside something closed.

### 3.3 The small map

The sightings map from #228, under the buttons on a phone and under the photo on a desktop. Numbers go in time order. A spot seen more than once shows one marker with a range ("2–4"), not numbers drawn on top of each other (SYC-459 item 1). The map is centred on the sightings, not lined up to a tile edge (SYC-459 item 5). It shows the newest 30 sightings, as today; with more, the caption says "Newest 30 of 41". Its caption gives the place of the last sighting and an "Open the map" link (to the full Map, focused on this cat, for people who may see the whole island; D9 unchanged).

### 3.4 Jump links

A row of pill links that stays at the top of the screen as you scroll: "History (21)", "Photos (4)", "Coat and markings", and "Reports (N)" where there are any. They are plain links to the sections below, not tabs. None of them is shown as "selected".

### 3.5 History: one list instead of three

**History** replaces today's Sightings, Vet visits and History lists. Newest first. Each row has the date and time on the left, what happened in the middle, and a "⋯" menu on the right.

- **A sighting** is one row (rows are joined by `sightingId`): "Seen in Ermoupoli", with whatever that sighting recorded joined on ("ear tip clipped, left ear", "food and water were out", "looking well"), who saw it, and its photo thumbnail. A sighting that may show more than one cat keeps its amber tag. Its ⋯ menu has "Show on the map", "Make a feeding site here", and one "Mark wrong" for each thing it recorded (e.g. "Mark wrong: ear tip clipped"). Each joined statement keeps its own `#s-<id>` anchor inside the row, so links to it still land.
- **A vet visit** is one row with a teal edge: what was done, the clinic, the cost and who paid (only with `view_vet_costs`, as today), and who logged it. The sterilised and vaccinated changes the visit wrote are folded into its row, not listed again: this needs `vetVisitId` added to each history entry. Its ⋯ menu has "Mark the visit wrong", in red. A visit marked wrong stays in the list, crossed out, with the date and who marked it.
- **A change** (where the cat lives, colony, coat, name, sterilised) is one row: what it now says, and "Maria changed this". Its ⋯ menu has "Mark wrong". The system's own colony corrections don't offer "Mark wrong" (SYC-331).
- **A note** is one row with a "team only" tag.
- **Coat and markings changes** show in History like any change, but their "Mark wrong" stays in the Coat and markings section, where it is today; the row's ⋯ menu links there.
- **Everything else today's History shows** keeps its row, in plain words and without record numbers: welfare reports and their outcomes, sightings moved to or from another cat, "Replaced by …", "Why: …" reasons, "about <date>" for approximate dates, "cat guardian" as the author where it applies, a statement's own photo, a withdrawn owner claim, and changes marked wrong. Where a row today says "Corrects #301", it says "Corrects the change of 14 Oct" and links to it.
- **A change marked wrong or replaced** stays in the list, crossed out, with what replaced it, as today.
- **Routine sightings** are grouped as today: "Seen 9 times by spotters, looking well", with the date range on the left and up to three thumbnails. Tapping the line opens the sightings as rows. The count is always the whole group, even when the list is cut short (SYC-459 item 3). Changes, vet visits and notes are never grouped. A sighting that recorded anything that isn't routine (such as a clipped ear) is never grouped either.

Above the list, filter links: "All 21", "Sightings 17", "Vet visits 1", "Changes and notes 3". Each reloads the page with that filter (`?show=…`), so they work without JavaScript. The counts come from the same rows the list draws. The list keeps today's "newest 20, then Show all N", and `?history=all` keeps working. A "Why we think so" link always opens History unfiltered and in full, so the row it points to is always there.

No row shows a record number ("#301") or a model name.

### 3.6 Photos

A grid of square thumbnails. The first one is labelled "Main photo"; the others carry their date. Each has a ⋯ menu with "Open full size" and "Hide from the public" (red). Today hiding is one tap with no confirmation. Moving it into the menu adds a tap, which is enough: "Show to the public again" undoes it. No new confirmation page is added. A hidden photo is dimmed and labelled "Hidden · Maria, 3 Oct", and its menu offers "Show to the public again".

### 3.7 Coat and markings

Folded by default. The folded line says the coat in words and where it came from: "Grey tabby, white paws · Read from the photo on 3 Apr · Maria agreed on 5 Apr". Opened, it shows the coat and the markings separately, each with one sentence on where it came from, and two buttons that say what they act on: "Yes, the coat is right" / "Yes, the markings are right", and "Change the coat or markings". Today's "Worth a second look" reasons stay, in plain words, as does the warning when the cat guardian disagrees. Each coat change that counts keeps its own "Mark wrong" here, with the photo it was read from. The section opens by itself when a coat form has just been saved, when there are "Worth a second look" reasons or a guardian disagreement, or when the page is opened at `#appearance` (from the Colour check queue). The full list of past coat changes is in History, not repeated here. No confidence tags, record numbers or model names (SYC-521, SYC-469).

## 4. Layout

**Phone (designed at 390px first).** One column: back link, name and status line, photo and strip, facts, buttons, map, jump links, History, Photos, Coat and markings. Tap targets are at least 44px. Nothing scrolls sideways except the top menu and the jump links.

**Desktop (from 1000px).** The summary is three columns. The photo, strip and map are on the left (340px). The name, status line and facts are in the middle. The buttons are on the right (260px). Below the summary, History takes the wide left column. Photos and Coat and markings sit in a narrower right column that stays in view as you scroll.

The look stays the dashboard's own (§12.1): warm off-white background, dark ink, teal for links and the main button, red only for risky actions, the system font, no text under 12px.

## 5. Tickets this closes or touches

| Ticket | What this design does with it |
|---|---|
| SYC-363 (phone: summary first, forms lower) | Answered differently: the summary comes first, and the buttons follow because they now take three rows, not eight. See decision D2. |
| SYC-459 (small fixes from PR 1.4) | Items 1, 2, 3 and 5 are folded in (§3.1, §3.3, §3.5). Item 4 (a `<span>` holding a menu) goes away with the new sighting rows. |
| SYC-521 (the "What we know" section reads like a database) | Folded in (§3.1 "Why we think so", §3.7, no #numbers anywhere). Its point about three names for "Probably" is left to its own ticket, because it touches the grid and Home. |
| SYC-469 ("Update the colour" under "Coat") | Folded in (§3.7). |
| SYC-446 (Add a note, Health note) | Folded in (§3.2, §3.1). Needs its route and the "newest note counts" rule. |
| SYC-331 (Mark wrong on system colony corrections) | Folded in (§3.5). |
| SYC-447 (place labels such as "Kini, harbour steps") | Not built here. Where a place label exists it is used; until then the town name shows, as today. |
| SYC-550, SYC-386, SYC-587, SYC-523 | Not touched: they are about what a fact says or where a link goes, not the layout. |

## 6. Decisions for Samuel

**D1. One History list instead of three (Sightings, Vet visits, History).**
- *Option A, one list (recommended).* Benefits: nothing is listed twice; the page is about a third shorter; a sighting and what it recorded are read together. Risks: someone who just wants "where has this cat been seen" uses the "Sightings" filter instead of scrolling to a section; sighting actions move into a ⋯ menu.
- *Option B, keep three lists, just made compact.* Benefits: closest to today, so the team re-learns less. Risks: every visit still shows up two or three times, and the page stays around 2,800px on a phone.
- *Recommendation: A.* The duplication is the main reason the page is long, and the filters cover the "just sightings" need.
- **Decided by Samuel, 22 Oct 2026: A, one list.**

**D2. On a phone, where do the buttons go?**
- *Option A, straight after the facts (recommended).* Benefits: "Log a vet visit" is on the first or second screen, where the team needs it at a vet or a feeding round. Risk: the history starts a little lower.
- *Option B, at the bottom, after History and Photos (SYC-363's idea).* Benefits: reading comes first. Risks: the main action of the page is several screens down, and you have to scroll past the whole history to change anything.
- *Recommendation: A.* SYC-363 was raised when the buttons took eight rows; now they take three.
- **Decided by Samuel, 22 Oct 2026: A, after the facts.**

## 7. Calls made in this design (check these while reading)

- The section is still called **History**, not "Timeline", to keep #192's word, even though it now includes sightings and vet visits.
- **"Hide from the public"** moves into each photo's ⋯ menu (one more tap). No confirmation page is added; "Show to the public again" undoes it.
- **Owner details** become a facts row shown only when there is an owner. "Remove owner" moves into Update this cat, with its gates and "Are you sure?" page unchanged.
- **Coat "Mark wrong"** stays in the Coat and markings section rather than moving to History rows.
- **Closed reports** keep a compact list in their own Reports section; only open ones get the amber box.
- The **status line** repeats four facts that are also in the facts panel. It's there for the first glance on a phone, and is cheap.
- **"Why we think so"** sits under each fact instead of in its own section.
- **Photos and Coat** sit beside History on a desktop instead of below it.
- **"This cat has died"** stays its own red-outlined button (SYC-513), set apart below the other three.

## 8. What the review changed

An independent review (22 Oct 2026) checked this design against the code. It found that the first draft:
- dropped "Remove owner", the owner details, and "Take out of this colony";
- described a reason form and confirmation for hiding a photo, which don't exist;
- listed a sterilised wording that isn't shipped;
- didn't say who may see a team note;
- would have listed a vet visit's own changes twice;
- would have lost the closed reports, several notices, and the coat section's Mark wrong.

All of these are fixed above. The review's full notes are in [docs/reviews/team-cat-page-redesign-adversarial-review.md](../reviews/team-cat-page-redesign-adversarial-review.md).

## 9. What's left to the builder

- The exact HTML and class names, reusing `rowMenu`, `renderMap` and the existing forms.
- How a sighting's statements are joined into one row (by `sightingId`), and what the row says when a sighting recorded nothing beyond "seen".
- Wording for the sentence-level edge cases: a change set by the system or a deleted account, an undone vet visit, a sighting that recorded nothing beyond "seen".
- Page tests: each section renders without JavaScript; each risky action is behind a menu and says what it acts on; no `#number` or model name appears in the page text; checked at 390px and 1280px before the PR opens.

## 10. Suggested build order (for the plan)

1. Summary, facts panel, "Why we think so" and buttons (§3.1–3.3), with the existing forms moved under "Update this cat".
2. The single History list with its filters (§3.5).
3. Photos grid and the Coat and markings fold (§3.6–3.7).
4. Add a note and the Health note fact (SYC-446): the route, the form, the rule, and a `describeStatement` case for `team_note`.
