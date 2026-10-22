# Dashboard pages: less to read before the thing you came for

**Ticket:** SYC-619 (parent: SYC-609, Team dashboard).
**Source:** the design review of 22 Oct 2026 (artifact on SYC-619). It was checked on the live build `2394828e`, which was the same as main that day.
**Scope:** every team dashboard page except Home (SYC-603, PR #292) and the team cat page (SYC-602).
**Status:** revised after the adversarial review of 22 Oct. All 22 findings are addressed; see [the review record](#review-record). Waiting for Samuel's decisions (§10) and approval.

## Contents

1. [What this changes, in short](#short)
2. [Every page](#every-page)
3. [Content first, rules after](#content-first)
4. [Lists that don't repeat their buttons](#lists)
5. [Cats and the Map](#cats-map)
6. [Queue](#queue)
7. [Colonies and a colony](#colonies)
8. [Reports](#reports)
9. [People, the checks, Vet settings and Find from a photo](#other-pages)
10. [Decisions](#decisions)
11. [Words for Greek and French](#translations)
12. [Tests](#tests)
13. [Out of scope](#out-of-scope)
14. [Build](#build)
15. [Corrections to the review](#corrections)
16. [Review record](#review-record)

---

<a id="short"></a>
## 1. What this changes, in short

Each page asks people to read and scroll too much before they reach what they came for. Three patterns cause most of it:

- On a phone, the menu and a stack of controls fill a quarter of the screen or more.
- Pages explain how their figures are counted before showing the figures, even when there are none.
- Lists give every row its full set of buttons.

This spec sets one rule for each pattern (§2 to §4), then lists the fixes page by page (§5 to §9).

The look stays the same: the warm background, dark ink, teal links and buttons, the system font, and red only for risky actions and urgent reports (`team-dashboard-redesign.md` §12.1). Team pages stay English only, except the parts a cat guardian also reads (§11).

**Shared code.** Several helpers are shared with pages, emails or languages outside this scope: `.report`, `rowMenu()`, `roleSentence()`, `placementFields()` and the guardian strings. Each section below says how its change stays inside this scope.

---

<a id="every-page"></a>
## 2. Every page

### 2.1 The menu on a phone (Decision D1)

**Today.**
- Below 600px the menu wraps onto rows so that no link is cut off (SYC-522, `layout.ts:123`). Before SYC-522 it was the one sliding row that `team-dashboard-redesign.md` §3.1 describes.
- At 390px a manager's menu takes two rows of links. "Signed in as Samuel Porter" and Sign out take a third.
- The page title starts 225px down an 844px screen (measured live, 22 Oct).

**Recommended (D1, option B): a "Menu" fold on phones.** This amends redesign §3.1 and SYC-522's wrap, both for phones only.

**How it's built.** The page carries the menu twice, and CSS shows exactly one copy.
- **At 600px and wider:** today's `<nav class="bar">`, unchanged.
- **Below 600px:** a new `<nav class="phonebar">`.
- The copy that isn't shown has `display:none`, which also takes it out of what screen readers hear. Nobody hears the links twice.
- Every browser supports this. It needs no script, and doesn't depend on `::details-content`, which the dashboard only uses under `@supports` (`layout.ts:513-519`).
- It adds about 1 KB to each page.

**The phone bar.**
- **At the left:** the current page's name, in bold. It is plain text outside the fold, so the fold's spoken name is just "Menu".
- **At the right:** a `<details>` whose `<summary>` is **"Menu"**, 44px tall.
- **Opened, every link is a full-width row, 44px tall.**
  - The current page keeps `aria-current="page"` and today's bold, underlined look.
  - "Signed in as {name}" and Sign out are the last two rows.
- A page whose `active` is null (Vet settings, for example) shows "Menu" with no page name.
- Following a link closes the fold, because the next page starts closed.

**Who gets it.** The fold is used for every signed-in menu, a cat guardian's included. Her menu has two to four links, so the gain is smaller, but the dashboard behaves the same for everyone.

**What doesn't change:**
- A refusal page draws only the name and Sign out, with no `<nav>` (`layout.ts:668-672`). It stays as it is.
- The welcome page, which has no links, stays as it is.
- The error page, which has no person, stays as it is.

**Sign out moves behind the fold on phones.** On a shared phone that's one more tap. D1's "Against" column says so.

Options A and C are in §10.

### 2.2 Workspace in the menu: management only (decided)

**Decided by Samuel, 22 Oct 2026 (option C):** the Workspace link shows in the menu only to people who hold the management role.

- Today everyone with `use_workspace` gets the link. That capability is given to the whole team, staff and management (`capabilities.ts`, `use_workspace: { kind: "island", roles: TEAM }`).
- **This spec changes only the menu link.** In `requireTeam.ts`, `navContext.workspace` becomes `mayUseWorkspace(person) && can(person, "manage_people")`. That second test is the one that already decides the People link (`navContext.people`). `manage_people` is management-only (`capabilities.ts:116`).
- **Who can get into the workspace doesn't change.** A staff member with the workspace address can still open it. Whether staff should keep that access is note N1 in §10.

### 2.3 The menu's Map and the Cats Grid/Map switch: both stay (decided)

**Decided by Samuel, 22 Oct 2026 (option C):** both ways to the map stay.

The review said the two light up different menu items. That was wrong (§15). The map view always passes `active: "map"` (`catMapPage.ts:194` and `:238`), and the grid always passes `active: "cats"` (`catGridPage.ts:350`). **Nothing changes here.**

### 2.4 One left edge at every width

**Today.**
- `main` is 760px wide on most pages.
- It is 1120px (`wide`) on Cats, the Map, the Queue, Find from a photo's results and the five reports.
- Both widths are centred, so on a laptop the left edge jumps about 180px between pages, for example from People to Reports.

**Change.**
- `main` is 1120px wide on every page, the same frame the menu bar already uses (`layout.ts:108`).
- A page without `mainClass: "wide"` gets one inner wrapper, `<div class="col">`, around everything `renderPage` puts in `main` (banner, back link, title and body). `.col` is 760px wide and starts at the frame's left edge.
- `mainClass` stays a single value. `renderPage` adds the wrapper whenever the value isn't `wide`, so no page has to change.
- **`.mappage`** keeps the map starting on a whole pixel (SYC-209 PR 3.1). Its margin rule, `round(down,(100% - 760px) / 2,1px)` at `layout.ts:364`, is rewritten for the 1120px frame and must still round to a whole pixel. The `.mappage` pages are Feeding sites, a site, the site forms, the centre pickers and the tap-check map (`sitePages.ts`, `siteFormPages.ts`, `centrePages.ts`, `routes/teamMap.ts`). The Cats map view is `wide`, not `mappage`.
- At 390px nothing changes, because both widths are wider than the screen.

### 2.5 One kind of back link, going to the right place

Every page below the top level gets a back link in the same place (`beforeTitle`), in the same form: **"← " plus the name of the page you'll land on.**

**Fixed on the way:** "← Back to Home" on Areas, Ear clips to check and Colour check goes to `/api/team`. That is the **Queue**, not Home (`areasPage.ts:215`, `likelyPage.ts:99`, `appearancePage.ts:499`). Home is `/api/team/home`.

| Page | Today | Becomes | Goes to |
|---|---|---|---|
| Areas, Ear clips to check, Colour check | "← Back to Home" | "← Home" | `/api/team/home` (fixed) |
| Vet settings | none | "← Home" | `/api/team/home` |
| A colony | "All colonies" | "← Colonies" | unchanged |
| Add cats to a colony | "Back to the colony" | "← {colony name}" | unchanged |
| A feeding site | "All feeding sites" | "← Feeding sites" | unchanged |
| Change someone's roles | "All people" | "← People" | unchanged |
| Bring someone back | "Left" | "← People who left" | unchanged |
| Find from a photo | "Back to Cats" | "← Cats" | unchanged |
| Find from a photo, or the Cats grid, reached from a report | "Back to the report" | "← The report" | unchanged |
| A report | "← All reports" | "← Reports" | unchanged |

- The Feeding sites page itself is out of scope (SYC-585, §9.5).
- The team cat page and the vet-visit form are out of scope.
- Problem pages ("That didn't save") keep their links in the page body.
- `colourCheck.back` is a catalogue key, so it changes in en, el and fr (§11).

### 2.6 Folds look like folds

**Today.** Some folds have no marker, so they read as cards or headings:
- "Create a colony", "Add an area", "Rename" and "Change this colony" (`.fixes summary`);
- People's "History" (`details.hist`);
- Colour check's "Not yet described" (`details.notdescribed`).

"Invite someone" is a filled button that looks the same open or closed. The team cat page already marks its folds with "▸" and "▾" (`layout.ts:222-224`).

**Change.** These summaries get the same marker, from the same CSS:
- `.fixes summary`;
- `.typedfold summary`;
- `details.hist > summary`;
- `details.notdescribed > summary`;
- `details.invitefold > summary`;
- the new "How this is worked out" fold (§3).

The marker is written `content:"▸" / ""`, and `"▾" / ""` when open. The empty alternative text means screen readers don't read the triangle out. The `<summary>` already tells them it opens.

**These keep no marker,** because they're rows or buttons with their own look:
- the Queue's rows (`summary.rowline`);
- Filters (`details.filters`);
- the "⋯" menu (`rowmenu`);
- "Mark as left" (`details.confirm`);
- the phone Menu (§2.1);
- the People and Areas rows (§4).

**"Invite someone"** becomes an outlined button with the marker, not a filled one. Buttons that act at once stay filled: Save, Create the colony, Send the invitation.

---

<a id="content-first"></a>
## 3. Content first, rules after

**The rule.** A page opens with at most one short line saying what it's for, then its content. Rules about how something is counted, and what it leaves out, go in a fold at the end called **"How this is worked out"**.

Text a person must see stays visible:
- to use the page safely, for example "This map is only for the team" (`design-review-fixes-oct22.md` §1.5);
- or to trust it, for example the welfare report's "No response times and nothing about who sent or handled a report".

**Built from what's there.** Reports already draw their footer with `methodNote()` (`reportPages.ts:119-128`), in a `div.method`. It holds the report's own lines, "Figures change as records are corrected.", "Worked out…" and the areas version.

- `methodNote()` becomes a `<details class="method"><summary>How this is worked out</summary>…</details>` holding the report's lines, "Figures change…" and the areas version.
- **"Worked out…" moves out of the fold** and stays visible just above it. It keeps its `id="worked-out"`.
- `id="areas-version"` stays on its line inside the fold.
- `team.reportPages.test.ts` pins both ids. It is updated to expect them in their new places.
- Areas reuses the same helper.

| Page | Moves into "How this is worked out" | Stays visible |
|---|---|---|
| Reports index | — (the intro "Each report is worked out from the records when you open it, for the time range you choose." is removed; the list is enough) | — |
| Every report | Its own method lines (listed in §8.3), "Figures change as records are corrected.", and, except on Vet, "Place names from the named areas, version N." | "Worked out {date}, {time} Syros time · {range}" |
| Areas | "A place belongs to the area whose centre is nearest. More than 2 km from every centre is Off Syros. Place labels and the Cats filters use this list within a minute of a change." and "Each change makes a new version. Reports name the version they used. This is version N." | — |
| Ear clips to check | — | With cats to check, the explanation stays: it tells you what the two buttons do. With none, the page shows only "Nothing to check. Every Probably sterilised cat has been looked at." |

"Syros time" is added to the "Worked out" line. `stamp()` already uses `Europe/Athens` (`reportPages.ts:53-56`), but the line doesn't say so.

---

<a id="lists"></a>
## 4. Lists that don't repeat their buttons

**The rule.** A list of people, areas or cats shows one short row per item. A row's actions appear only when that row is opened, as the Queue's report cards already do (`queuePage.ts:263-278`).

### 4.1 People

Each person becomes a fold, `<details class="person" id="p-{id}">`.

**The closed row** is 56px tall, the same as a Queue row. It shows:
- the name;
- the state chip: "Not sent yet", "Invited", "Joined", "Expired" or "Left" (`CHIP_LABELS`, `lib/people/screen.ts:27`);
- a short role: "Management", "Team", "Cat guardian", or both joined with a comma, for example "Team, cat guardian".

**Opened,** it shows today's card body: the email, the roles sentence, colonies, the date line, the buttons and History.

**Your own row** has no buttons inside, as today. It opens to "This is you. To step back, use Stop helping on your own page."

**Which row is open:**
- After an action, the person it acted on opens, but only when the page has a proven result. That means `doneFrom()` returned a result (`teamPeople.ts:123-150`), not just any `?done=`. "Marked as left" still goes to the Left tab, as today.
- "Joined in the last 7 days" links to `?open={id}#p-{id}`, and the server opens that row. Today it links to `#p-{id}` alone (`peoplePages.ts:314`), and browsers don't reliably open a closed fold from an address like that. `open` takes only an id of the right shape, as the Queue's `?open=` does.

**Smaller changes:**
- "Joined" is said once. For a joined person, the open card's date line becomes "Since 3 October 2026.", because the chip already says "Joined".
- "Joined in the last 7 days" is left out when nobody has joined in that time.
- "Mark as left" already asks before doing anything (`details.confirm`, `peoplePages.ts:159-184`). It stays as it is, inside the opened row.

### 4.2 Areas (Decision D5)

**Recommended (D5, option A):** the areas become a list of folds, sorted by **number of cats, most first**, then by name. Today they are in the order they were added (`teamAreas.ts:43-48`).

- **The closed row:** the area's name and "N cats", 48px tall.
- **Opened:** "Open map", "Rename" (its own small fold, as today), "Move centre on a map" and "Retire".
- **Retire already asks "Retire {name}?"** on its own page before doing anything (`teamAreas.ts:122-146`, SYC-517 PR E). That stays as it is.
- **History:** the rows from the first version of the list fold into one line, for example "21 areas set up by Syros Cats, 15 Oct 2026". Later changes are listed one by one, as today. The fold is chosen by version, not by "nobody's name", so a later change whose author was anonymised is never swept into it.

At 390px, 21 closed rows take about 1,000px. Today's 21 cards take about 5,600px (live Areas page, 21 areas, 22 Oct).

Option B is in §10.

### 4.3 A colony's cats

Covered in §7.2.

---

<a id="cats-map"></a>
## 5. Cats and the Map

### 5.1 The cards say what's known (Cats grid)

Today the card always has a coat line, a colony line, the sterilisation mark, the last-seen line and a tag (`catGridPage.ts:255-283`). On the live site almost every card reads "Coat not known · No colony · ○ Not known".

- **A line that says nothing is known is left out.** "Coat not known" and "No colony" are no longer drawn. The photo's alt text still says "Photo of {name}", with the coat words when they're known.
- **The sterilisation line is always drawn,** because it's what the team plans around. Its wording is SYC-601's ("Sterilised: not known yet", matching the app), so this spec doesn't word it again.
- **The order on every card:** name and SYR number; coat (if known); colony (if any); sterilisation; last seen · place; tag.
- Cards in a row still end up the same height, because `ul.catgrid` stretches them (`layout.ts:410`). The build checks this at 390px and 1280px.

### 5.2 Sharper card photos (Decision D6)

**Today.**
- The grid loads the `small` version, 160px wide (`photoVariants.ts:12`), with no `srcset`.
- It draws it in a box about 170px wide on a phone and 193px on a laptop.
- A phone screen needs about twice the box width, about 340px, for a sharp picture.

**Recommended (D6, option B): a `card` version, 360px wide.** Versions are made the first time someone asks for one (`variantFor`; redesign §11), so there is no job to run. The grid uses `srcset="…/small 160w, …/card 360w"` with `sizes="(min-width:1000px) 200px, 45vw"`.

**What it takes:**
- **A migration.** `photo_variants` checks `size in ('small','medium')` (`lib/db/src/schema/photoVariants.ts:38`), so the migration adds `'card'`. It follows migrate-before-republish (§14).
- `VARIANT_WIDTH` and `isVariantSize` gain `card`.
- So do the 12-month remake and the removal paths, so a removed photo loses its `card` version with the others.
- The variant route serves `card` with the same checks as `small`. Today it answers "not found" for a size it doesn't know (`teamReports.ts:277-281`).
- The "no location data in a version" test (redesign §11) covers `card`.

**Data cost.** A 360px JPEG is roughly a quarter the size of the 640px `medium`, so a grid of 28 cats stays light on island mobile data.

Options A and C are in §10.

### 5.3 Fewer rows of controls before the cats

**Today on a phone,** each of these is on its own row:
1. the search row;
2. Filters;
3. Grid/Map;
4. Find from a photo.

**Change.** Grid/Map and "Find from a photo" share one row, the switch at the left and the link at the right.
- Both stay inside `#catresults`, where they are today. The photo link is there on purpose: `dashboard-grid.js` replaces that part of the page when the filters change, so the link always carries the current filters (`catGridPage.ts:291-296`, `:342-344`).
- The phone loses one row.
- The search row and Filters stay where they are.

**The map view.** It has no photo link today. It gains one in the same place, so nothing jumps between the views (SYC-522's aim). Its `href` must follow the map's filters, the same way the map's Grid link does now. The build confirms how `dashboard-map.js` keeps that link current and does the same for this one.

### 5.4 The map while its pictures load

**Today** the map box is plain beige (`#e8e4d8`) for the 3 to 6 seconds before its pictures arrive (live, 22 Oct), with the cat bubbles on nothing.

**Change.**
- `dashboard-map.js` draws a light outline of Syros in **a pane of its own, below the map pictures** (a Leaflet `createPane` with a `zIndex` under the tile pane). The pictures cover it as they arrive. That outline is new.
- The existing outline is untouched. `tilesFailing()` adds it with `fillOpacity:1` when pictures fail (`dashboard-map.js:183-204`), and it sits above the pictures on purpose.
- A small line, **"Loading the map…"**, shows at the top of the map box. It goes when the first picture's `onload` fires. Pictures are loaded by our own `img.onload` (`:237`), not Leaflet's `tileload`.
- If the pictures fail, today's "Map pictures aren't loading. The cats are still shown." replaces the loading line.
- The outline points are rough on purpose (`OUTLINE`, 20 points, `dashboard-map.js:80-87`). That's fine under the pictures, because they cover it.
- The no-script map is unchanged.

### 5.5 Number bubbles that overlap

**Today.**
- `drawCats()` sorts cats into fixed 44px squares (`dashboard-map.js:536-554`, `CELL = 44`).
- It places each group at the average position of its cats.
- So two neighbouring groups can end up less than 44px apart. On the live map, two "11"s overlap at Kini, and a "2" and a "3" overlap at Ermoupoli.

**Change: one merge pass after the sorting.**
- Any two markers, single cats or groups, whose centres are less than 44px apart on screen become one group.
- The new group holds all their cats and sits at their average position.
- The pass repeats until no two markers are closer than 44px.

**How it behaves:**
- It runs on `zoomend`, as the sorting does now.
- With 28 cats it's instant. The build measures it with 2,000 made-up cats and keeps it under 16ms on a laptop.
- Tapping a merged group does what tapping a group does today. It zooms in two levels, or at the closest zoom opens the "N cats here" sheet.

The no-script map already groups cats on the server, in a fixed grid (`buttonMapMarkers`). It is left as it is.

---

<a id="queue"></a>
## 6. Queue

Every change in this section applies to the Queue's own cards (`article.report`) only. `.report` is also used by Colour check (`li.report.colourcheck`, `appearancePage.ts:450`) and Ear clips to check (`likelyPage.ts:53`), and those keep their look.

### 6.1 Suggest the next step

**Today.** An opened report shows four equal buttons under "Move this report to". The current state is one of them, greyed out and disabled: "New (current)" (`queuePage.ts:109-147`).

**Change:**
- **The current state is said in words** above the buttons, "Now: New", and is no longer a button.
- **The usual next step is the filled teal button.** For a report that's New, it's "Looking at it". For one that's Looking at it, it's "Done". The others are outlined, as today.
- **Only offered states are drawn.** `actionForms` is given the states a row may move to (`offered`, `queuePage.ts:113-118`). For example, an issue with a hidden photo can't offer "Nothing needed".
- If the usual next step isn't offered, no button is filled.
- A report that's Done or Nothing needed has no filled button, because reopening it should be a choice.
- "Move this report to" stays as the label.
- The buttons keep their `name="to"` values, so the form, the server and the `from` check are unchanged.
- This covers report rows and Issues rows alike.

### 6.2 The folded row

- **No "No photo" box.** A report with no photo has no 56px box at the start of its row (`queuePage.ts:266-268`), so its words start at the left edge. Today the box is the only place that says there's no photo (`queuePage.ts:97`), so the open body gains a line: "No photo".
- **Two lines of words, not one.** The short words (`said1`) may run to two lines, so "Four kittens under the steps behind the bakery" isn't cut to "Four kittens under t…". This uses CSS `line-clamp`, which only shortens what is shown. The full note is always in the body, under "What they said".
- **Said once when open.** When the row is open, the short words in its summary are hidden, because "What they said" shows them in full just below.

### 6.3 The stripe means something

Today every open report that isn't urgent has an amber stripe (`layout.ts:130`), so amber stops meaning anything. The stripes become:

| Report | Stripe |
|---|---|
| Urgent | red, as today |
| Issue | blue, as today |
| Closed | grey, as today |
| Any other open report | the card's own light border colour, `#d9d5ca` |

Reports about kittens keep their "Kittens" tag.

---

<a id="colonies"></a>
## 7. Colonies and a colony

### 7.1 Colonies list

- **With no colonies** (and not searching), the page shows the lead line, then "Create a colony", as today. The search form and "Recent changes by cat guardians" are left out: there's nothing to search, and nothing has changed.
- **With colonies,** the order becomes:
  1. search;
  2. sort;
  3. the figures line;
  4. the list;
  5. "Create a colony";
  6. "Recent changes by cat guardians", last.

  SYC-522 found "Recent changes" above the colonies; only the empty case was changed then (SYC-577).
- The colony card itself is unchanged.

### 7.2 A colony's page (Decision D3)

**Order.** The cats move up, ahead of the feeding sites:
1. the summary;
2. "Change this colony" (the fold);
3. **Cats**, with "Add cats";
4. Feeding sites, with "Add a feeding site";
5. the moved-away list;
6. notes;
7. history.

**Each cat's row (recommended, D3 option B).** Each row gains the sterilisation mark and a last-seen line, with **no place in either view**.

| | For the team | For a cat guardian (her own colony) |
|---|---|---|
| Mark | `markBadge()` with its English words | the mark's shape, with the colony bar's existing words in her language (`colonies.mark.*`, `strings/en.ts:343-346`; SYC-600 may reword "Not known yet" there, and this follows it) |
| Last seen | `lastSeenWords()` (`lastSeen.ts:21`), without the " · place" the grid adds | the date only, from the guardian pages' own `lastSeenWords(day, lang)` (`guardianPages.ts:98`), as redesign §10.2 allows |

- **Where the data comes from:** `loadTeamCats()`, joined on the cat's id. `ColonyCat` today holds only `{ id, syr, name, photoUrl }` (`teamColonies.ts:145-150`).
- **A record `colonyView` lists but `loadTeamCats` leaves out** (a merged-away cat) keeps its row with no mark line. It doesn't disappear.
- **Sort order:** not sterilised first, then not known, then probably, then sterilised. Within each group, the most recently seen come first. That is the order of redesign §9.2's to-do list.
- **This is a stopgap.** The full trapping planner (redesign §9.2, SYC-396 PR 2.3) is approved but not built; only its price setting shipped (PR 2.3.1, #256). Using the planner's order here lets it replace this list later without reshuffling. A ticket for the planner is filed under SYC-396 (§14); no planner ticket existed on 22 Oct.

Options A and C are in §10.

**The "More" button goes inside the row.** Today "More" (which holds "Take out of this colony") is a separate bordered button under each cat's card, outside it (`colonyPages.ts:502-540`, `rowMenu.ts`). It isn't clear which cat it belongs to, and it doubles the list's length.

- **The row is the card.** The `<li>` takes the card styling. Inside it, the cat's link fills the row, and a **"⋯"** fold sits at its right edge, 44×44px.
- **Siblings, not nested.** The link and the fold sit side by side inside the `<li>`, because a fold can't go inside a link.
- **What a screen reader hears.** The "⋯" glyph is `aria-hidden`. The fold's name is still `colony.more` plus "(for {name})", as now. So the glyph needs no new words.
- **Opening it** shows "Take out of this colony" inside the same card, under the row.
- **The team cat page isn't touched.** `rowMenu()` is shared with that page's sightings (`catPages.ts:1068`, SYC-602, out of scope). So this is a new option, `rowMenu(label, forWhat, items, { compact: true })`. The cat page keeps today's look.

---

<a id="reports"></a>
## 8. Reports

### 8.1 The index

- The intro line goes (§3).
- **"Impact report for funders"** gets muted text and a grey **"Coming soon"** chip, so it doesn't look like a report you can open.
- **"Donations"** keeps its own words, "Coming once donations are set up", in the same muted style.
- **"Vet visits and costs"** for someone without cost access is built, just closed to them (`VET_COSTS_ONLY`). It keeps "For team members who can see vet costs", in the muted style, with no "Coming soon" chip.

### 8.2 Every report

- **The period choices** lose their underline ("This month", "Last 3 months", "This year", "All time"). The pill shape already says they're choices. The current one stays filled.
- **"How this is worked out"** at the end holds the method lines (§3).
- **Empty means empty.** When a report shows "Nothing recorded in this period", these sections are left out, because they can only show zeros or "none". They come back when there's data.

  | Report | Left out when empty | Stays |
  |---|---|---|
  | Coverage and spotting | The spotting chart, its table and its download | The headline ("0 sightings, from 0 spotters"), and "Where spotters have looked", because squares nobody has looked at still matter |
  | Welfare patterns | "Welfare reports per week", "Counted separately" and "Where reports came from" | The promise line (§3) |
  | Vet visits and costs | "Spend by what was done", "Cost per sterilisation", "Sterilisations with no cost recorded" and "Every visit" | "0 vet visits, €0 spent by Syros Cats" as the headline |

- **"See all time" only when it would help.** On Colony health, when there are no colonies at all, the empty line becomes "No colonies yet. Colonies are set up on the Colonies page.", with a link to Colonies, in place of "See all time".
- **Downloads (CSV) are unchanged.**

### 8.3 Each report's own fixes

**Sterilisation progress.** "Each point shows the records as they stood on that date." is said once, under the chart. It is taken out of the footer (`reportPages.ts:235`).

**Vet visits and costs.**
- **These move into the fold:**
  - "Each visit is counted once, under its main purpose: Sterilised if ticked, else Vaccinated, else Treated, else Checked only."
  - "A visit that also vaccinated or treated the cat counts its whole cost."
  - the explanation in the no-cost section;
  - "Counted by the date of the visit."
  - "An undone visit isn't counted anywhere."
- **This stays visible,** because it says what the main figure is: "Spend is Syros Cats' money and donations given for a cat. Owner-paid visits are listed, but never added into spend."

**Welfare patterns.**
- **These move into the fold:**
  - "Each report is in one kind only: a report with kittens is Litter, however urgent."
  - "Counted by the date each report was sent."
- **This stays visible:** "No response times and nothing about who sent or handled a report." (§3).

**Coverage and spotting.**
- **These move into the fold:**
  - "Counted by the date each sighting was sent."
  - "Sightings from spotters who have since deleted their account count as sightings, but not as spotters."
- **This stays visible:** "Spotters are counted, never named."

### 8.4 Where spotters have looked (Decision D4)

**Today** (`coverageMap.ts:38-96`):
- The picture is an SVG of 250m squares with no coastline. Grey squares had a sighting in the period; dotted squares are within 500m of an area's centre with no sighting yet.
- Each area's name is drawn at its centre, on top of the squares, and nudged down when two collide.
- The sightings aren't near the area centres, so sighted squares often fall outside an area's dotted squares. Kini, with 22 of the 28 cats (live Areas page and Cats page, 22 Oct), looks unvisited.

**Recommended (D4, option B):**

- **The island's outline goes behind the squares,** as a light filled shape.
  - The points live in one server module, `lib/geo/syrosOutline.ts`. Today `dashboard-map.js`, a plain file with no build step (`teamAssets.ts`), keeps its own copy.
  - The map page will pass the points to the script in a `data-outline` attribute, so there is one source.
  - The outline is rough on purpose, so the build first checks that every square with a sighting since launch falls inside it. Any point outside is moved out until they do.
- **Names move off the squares.** Each name is drawn just above the box around its area's squares, not at the area's centre. Today's nudging stays, so names don't overlap each other.
- **The legend stays** ("Sighted in this period", "Not looked at yet (within 500 m of an area's centre)").
- **"Show as table" is unchanged.** Opening it by screen width can't be done without a script, so that idea from the draft is dropped.

Options A and C are in §10.

---

<a id="other-pages"></a>
## 9. People, the checks, Vet settings and Find from a photo

### 9.1 Changing someone's roles

- **A line under each tick box** says what that role can do, and replaces the paragraph after the three boxes.
  - "A member of the Syros Cats team": "Sees the whole island and records what they find."
  - "A member of Syros Cats management": "Can also invite people, change what they can do and sign anyone out."
  - "A cat guardian": "Sees only the colonies they look after."
- **Same words, now split up.** They are today's paragraph cut into three, which is the wording SYC-522 chose so that an invitee is told the same thing.
- **All three forms change.** `placementFields()` is shared by Invite, Change roles and Bring back, and each gets the same change.
- **"Now:" is unchanged.** It says only "management" for someone who holds both, because management already includes everything the team can do. `roleSentence()`, which writes it, also writes invitation emails in three languages (`lib/people/words.ts:56`, `personTemplates.ts:61` and `:123`), so it isn't touched.

### 9.2 Colour check

When there's nothing in "To check", the "Not yet described by the team: N cats" fold opens by default, because it's then the only list on the page. When there is something to check, it stays folded, as today.

### 9.3 Vet settings

- **New back link:** "← Home" (§2.5).
- **The explanation, rewritten** to drop the trapping planner, which isn't built yet (§7.2): "A vet visit with Sterilised ticked starts with this price as its cost. Each visit's cost can still be changed."
  - "A new price is used everywhere within a minute." is removed.
  - The planner's own spec puts the estimate back when the planner is built.

### 9.4 Find from a photo (Decision D7)

**Today** the page has two forms (`findPhotoPage.ts:138-218`), in this order:

1. **"Where to look"** is a GET form, with a "Count the cats" button that reloads the page.
2. **"Your photo"** is a POST form that carries step 1's choices as hidden fields.

On a phone, the photo is below the fold.

**Why it's in this order:**
- A file can't go in a GET form, or its name would appear in the address (`findPhotoPage.ts:22-24`).
- Reloading the page for step 1 after choosing a photo would lose the photo.
- The approved whole-island search (`find-from-a-photo-whole-island.md` §9.2) requires its words *before* a search of more than 30 cats: "The app picks the 20… up to a minute".
- When the looks-like index can't run, the fix it offers is "Choose an area or a colony" (§9.4). So the narrowing still matters.
- A narrowing that leaves no cats is caught before any photo is sent, which saves a wasted upload on island mobile data.

**Recommended (D7, option A): keep the order, and make the photo step easier to find.**
- The intro becomes one line: **"Choose where to look, then add the photo below."**
- "1. Where to look" stays as it is.
- The count line stays as it is, including the over-30 shortlist words.
- On a phone, the "2. Your photo" heading gets a jump link from the intro, "Go to the photo", so the photo is one tap away.
- Nothing about the forms, the addresses or the caps changes.

**Option B ("one form, photo first")** was the first draft's recommendation. The review showed it breaks three things:
- the over-30 words;
- the index-down fallback;
- the address-privacy tests in `team.findPhoto.test.ts`.

Option B is set out in §10 with what it would take.

### 9.5 Feeding sites

Out of scope, because SYC-585 moves this page onto the new map, and `.mappage` pins the order above the map. Two points are added to SYC-585:

- "Add a site" should come before the map.
- The "Update" button for "Show retired sites" goes away with the old map.

---

<a id="decisions"></a>
## 10. Decisions

Each decision can be answered on its own. Samuel's answers will be recorded here and on SYC-619.

**D1. The menu on a phone** (§2.1)

| | What it is | For | Against |
|---|---|---|---|
| A | Keep it as it is: links wrap onto rows, plus a row for the name and Sign out | Every link is one tap away | 225px before the title on every page |
| **B (recommended)** | One row: the page name and a "Menu" fold | The title starts about 60px down. Nothing is cut off. No script. | Another page takes two taps instead of one. Sign out is behind the fold. |
| C | Keep the wrap, but move "Signed in as" and Sign out to My page | Saves one row (about 44px). Links stay one tap away. | Still two rows of links. Sign out is a page away. |

**D3. A colony's cat list** (§7.2)

| | What it is | For | Against |
|---|---|---|---|
| A | Build the full trapping planner now (redesign §9.2) instead | The real answer: a to-do list, an estimate and a printable plan | Much bigger; it would hold up the rest of this spec |
| **B (recommended)** | Add the mark and last seen to each row now, in the planner's order; the planner follows on its own ticket | Small and useful at once; the planner drops in later | A little work the planner later replaces |
| C | Leave the list as it is until the planner | No throwaway work | The team keeps opening each cat to see whether it's done |

**D4. "Where spotters have looked"** (§8.4)

| | What it is | For | Against |
|---|---|---|---|
| A | Draw the squares on the real map pictures | Roads and villages show | The pictures come through our tile server with tokens; a server-drawn report would then depend on the map service |
| **B (recommended)** | The island's outline behind the squares, and names off the squares | Readable, server-drawn, no new service | Still no roads |
| C | Drop the picture; show only the table | Simplest, and fully accessible | Loses the at-a-glance view of the gaps |

**D5. Areas** (§4.2)

| | What it is | For | Against |
|---|---|---|---|
| **A (recommended)** | Folded rows, sorted by number of cats | A short page with the busy areas first | One tap to open a row before acting |
| B | A table: name, cats and a "Change" link to a page for each area | The densest | A new page for each area to build and test |

**D6. Card photos** (§5.2)

| | What it is | For | Against |
|---|---|---|---|
| A | Use the existing 640px `medium` in the grid | No new version, no migration | About 4× the data on a phone, on island mobile data |
| **B (recommended)** | Add a 360px `card` version | Sharp and still light | A migration, and a version to add to the remake and removal paths |
| C | Leave `small` | No work | Soft photos on every phone |

**D7. Find from a photo** (§9.4)

| | What it is | For | Against |
|---|---|---|---|
| **A (recommended)** | Keep the two forms and their order; a one-line intro with "Go to the photo" | Keeps every approved rule and test. A phone reaches the photo in one tap. | The photo is still second on the page |
| B | One POST form: photo first, narrowing in a fold | The photo comes first, and there's one button fewer | The count, the over-30 words and the index-down fallback must all be rebuilt around a form that only reports after the upload. Three address-privacy tests are replaced, and an empty narrowing is found only after the photo is sent. |
| C | Two forms, photo form first, with a script recounting as you narrow | Keeps the count | Without the script, narrowing after choosing a photo loses the photo |

**Note N1. Workspace access.** §2.2 hides the menu link from staff, as decided. Staff keep access to the workspace itself, because `use_workspace` is given to the whole team. Should access also become management-only? Recommended: **no change in this spec**. It changes who can read the shared documents, and needs Syros Cats' view.

**Decided already** (Samuel, 22 Oct 2026: "1C, 2C"):
- the Workspace link is management-only (§2.2);
- both ways to the map stay (§2.3).

---

<a id="translations"></a>
## 11. Words for Greek and French

Most team pages are English only, written straight into the page. The changed parts that a cat guardian also reads go through the catalogue (`strings/en.ts`, `el.ts`, `fr.ts`; `strings.test.ts` checks that every key exists in all three):

- the phone Menu (§2.1): "Menu";
- back links (§2.5):
  - on a colony, adding cats and a feeding site;
  - `colourCheck.back`, which is in the catalogue already;
- the guardian's cat rows (§7.2), which use existing keys only (`colonies.mark.*` and the guardian last-seen words);
- "How this is worked out" (§3), on any report a guardian sees (redesign §10.2 gives her Sterilisation progress and Colony health for her own colonies).

New keys are added in en, el and fr together. Greek and French aren't live yet (`LIVE_LANGUAGES = ["en"]`), so Johnny's check (SYC-283) covers them before they are.

---

<a id="tests"></a>
## 12. Tests

**How everything is checked.**
- Each change is tested before its commit.
- The affected api-server suites run locally (vitest, with the esbuild workaround).
- The full api-server suite runs before `gh pr ready`.
- Every changed page is checked in the browser pane at 390px and 1280px, with data, by keyboard as well as by tapping.
- Form posts are tested with `page.request.post` and the dashboard's Origin, never by submitting from localhost.

**Tests changed on purpose.** Each is listed in its PR description with the reason:

| Test | Why it changes |
|---|---|
| `layout.test.ts` "wraps onto more rows on a phone… (SYC-522)" (`:237`) and "the phone padding rule reaches the wide bar" (`:233`) | The phone bar replaces the wrap (D1) |
| `queuePage.layout.test.ts` `:59` and `:202` (the menu's shape); its state-button cases | D1; §6.1 |
| `team.reportPages.test.ts` (`#worked-out` and `#areas-version`) | §3 |
| `team.people.test.ts` cases that expect visible buttons on every card | §4.1 |
| `team.areas.test.ts` cases that expect the order areas were added in | §4.2 |
| Colony page cases that expect "More" as a separate button | §7.2 |

**New and extended tests, by section.**

**Menu (§2.1)**
- Below 600px only `.phonebar` shows; at 600px and wider only `.bar` shows.
- Every link is inside the fold, and none is cut off at 320px.
- The name and Sign out are the fold's last rows.
- The fold's `<summary>` text is exactly "Menu".
- A guardian's menu folds too.
- The refusal, welcome and error pages are unchanged.

**Workspace (§2.2)**
- A staff member's menu has no Workspace link; a manager's does.
- A guardian's has none.
- **Mutation:** dropping `can(person, "manage_people")` must fail the staff test.

**Widths (§2.4)**
- At 1280px the title's left edge is the same on People, Reports, Cats and Areas.
- **Whole pixel:** a browser-pane check reads the map image's left and top on Feeding sites and a centre picker at 390px, 768px, 1013px and 1280px, and expects whole numbers. No current test checks this. The PR records the values.

**Back links (§2.5)**
- One test walks every page in the §2.5 table and checks each back link's text and target.
- Areas, Ear clips and Colour check go to `/api/team/home`.

**Folds (§2.6)**
- The listed summaries carry the marker.
- The listed exceptions don't.
- The marker's alternative text is empty.

**"How this is worked out" (§3)**
- Each page in the §3 table has the fold, with the listed lines inside it.
- "Worked out" is outside the fold.
- Ear clips with no cats shows only the empty line.

**People (§4.1)**
- Each person is one closed fold.
- A proven result opens that person; a bare `?done=` opens nobody.
- `?open=` with a malformed id opens nobody.
- No row shows buttons until it's opened.
- "Joined in the last 7 days" is absent when it's empty.

**Areas (§4.2)**
- Areas are sorted by number of cats, then by name.
- Retire still goes through its confirm page (`team.areas.test.ts`, unchanged).
- The first version's history folds into one line, and a later anonymised change stays on its own line.

**Cats cards (§5.1)**
- With no coat and no colony, neither line shows; with both, both show.
- The sterilisation line always shows.

**Card photos (§5.2)**
- The grid's `srcset` and `sizes` are as given in §5.2.
- `card` is served with the same access checks as `small` (`team.photoVariants.test.ts`).
- A `card` version carries no location data.
- Removing a photo removes its `card` version.
- The migration and its rollback run against a test database.

**Controls (§5.3)**
- The grid and the map have the same control order.
- The photo link carries the current filters after a filter change, in both views.

**Map (§5.4, §5.5)**
- The loading outline's pane sits below the tile pane.
- "Loading the map…" goes on the first picture's `onload`.
- `tilesFailing()` behaves as before.
- After the merge pass, no two markers are closer than 44px, at every zoom, for 2,000 made-up cats.
- **Mutation:** removing the merge pass must fail that test.

**Queue (§6)**
- "Now: New" shows "Looking at it" filled; "Now: Looking at it" shows "Done" filled.
- No button is filled when the next step isn't offered, or when the report is closed.
- Issue rows follow the same rules.
- There is no "No photo" box, and the open body says "No photo".
- The short words are hidden when the row is open.
- The stripe changes by state on `article.report` only.
- Colour check and Ear clips look the same as before.

**Colonies (§7)**
- With no colonies, there's no search and no "Recent changes".
- With colonies, the order is as in §7.1.
- A colony's rows carry the mark and last seen, in the planner's order.
- A merged-away cat keeps its row.
- **Guardian route-walk test** (`roles-and-invites.md` §6.4):
  - her rows show the mark in her language and the date only;
  - they show no place label, no position and no map company's address.
- "⋯" is inside the row.
- The team cat page's "More" is unchanged.

**Reports (§8)**
- Each report's empty state leaves out the sections in §8.2's table.
- Colony health with no colonies links to Colonies.
- The duplicate sentence is gone.
- "Worked out" says "Syros time".
- The welfare promise line stays visible.
- CSV downloads are unchanged.

**Coverage picture (§8.4)**
- The outline is drawn.
- Every square with a sighting falls inside it (checked against the live squares before merge, then against a made-up set in the test).
- No name's box overlaps its own area's squares.
- No two names overlap.

**Roles (§9.1)**
- Each tick box has its line, on Invite, Change roles and Bring back.
- `roleSentence()` and the invitation emails are unchanged.

**Find from a photo (§9.4)**
- The intro is the new line, and "Go to the photo" jumps to `#find-photo`.
- Everything else in `team.findPhoto.test.ts` passes unchanged.

---

<a id="out-of-scope"></a>
## 13. Out of scope

- Home (SYC-603, PR #292) and the team cat page (SYC-602).
- The Feeding sites page and its old map (SYC-585; §9.5 adds two points to it).
- The wording of the sterilisation line (SYC-601).
- Typing latitude and longitude to add an area (SYC-557).
- The full trapping planner (redesign §9.2; a ticket is filed, §14).
- Who can get into the workspace (N1).
- Greek and French going live (SYC-283, SYC-291).
- Map pictures with Latin-letter place names (SYC-288).

---

<a id="build"></a>
## 14. Build

**Wait for #292.** PR #292 (Home) changes `layout.ts`, `colonyPages.ts`, `homePage.ts`, `lastSeen.test.ts` and `team-dashboard-redesign.md`. So **no PR here starts until #292 has merged**, and each one is rebased onto main as it stands then.

**Suggested split: four PRs.** Each is opened as a draft, with one commit per change and its tests.

1. **The shell:** menu (§2.1), Workspace (§2.2), widths (§2.4), back links (§2.5), folds (§2.6), and the `methodNote` fold (§3).
2. **Lists:**
   - People (§4.1);
   - Areas (§4.2);
   - a colony's page (§7.2);
   - the Colonies list's order (§7.1).
3. **Cats, Map and Queue:** §5 and §6. This includes the `card` version's migration (D6).
4. **Reports and the rest:** §3's remaining pages, §8 and §9.

**Order.**
- PR 1 goes first, because the others use its fold marker, its back-link form and the `.col` wrapper.
- PRs 2, 3 and 4 each touch `layout.ts` as well, so they go one at a time. Each is rebased onto main after the one before it merges, following the stacked-PR rule (one fix per PR, rebased after each squash merge).

**The migration (D6 option B)** follows migrate-before-republish:
1. Merge.
2. Run `db-ops migrate` on production.
3. Run `db-ops verify-history`.
4. Run a `run_sql` check that the size constraint includes `card`.
5. Only then does Samuel republish. Until step 4 passes, Claude says "don't republish yet".

**Tickets filed with this spec:**
- the trapping planner, under SYC-396 (no planner ticket existed on 22 Oct);
- two points added to SYC-585 (§9.5).

---

<a id="corrections"></a>
## 15. Corrections to the review

These things in the 22 Oct review were wrong. The review and SYC-619 have been corrected to match.

| The review said | What's true | Source |
|---|---|---|
| The map "opens on the whole island, not on the cats" | It fits to the cats on its first answer (`shouldFitToCats`, `dashboard-map.js:148-150`, used at `:658`). The cats run from Kini to Ermoupoli, which is most of the island, so it looked like a whole-island view. | Code |
| The menu's Map and the Cats switch "highlight different menu items" | Map view always lights Map, and grid view always lights Cats | `catMapPage.ts:194`, `:238`; `catGridPage.ts:350` |
| "Mark as left" is "easy to hit by mistake", and (the first draft of this spec) Retire on Areas is "one tap" | Both already ask first, on a page of their own: "Yes, mark as left", and "Retire {name}?" | `peoplePages.ts:159-184`; `routes/teamAreas.ts:122-146` |

---

<a id="review-record"></a>
## 16. Review record

An adversarial review (Opus, read-only) of the first draft, commit `51b7e8c7`, raised 22 findings. All are addressed.

| # | Finding | Severity | How it was addressed |
|---|---|---|---|
| 1 | Retire on Areas already has an "Are you sure?" page | Blocker | §4.2: no new confirm; §15 row 3 corrected; review and SYC-619 corrected |
| 2 | "One form, photo first" breaks the over-30 words, the index-down fallback and the address-privacy tests | Blocker | §9.4: D7 recommendation changed to A; B's costs set out in §10 |
| 3 | No no-script way to fold on phones but not on desktops | Blocker | §2.1: two copies of the menu, one shown by CSS; refusal, welcome and guardian cases stated; tests that change listed |
| 4 | Guardian rows reused English-only, relative-time, place-bearing helpers | Should-fix | §7.2 table; §11; guardian route-walk test |
| 5 | The migration is certain; versions are made on first request; no fallback exists | Should-fix | §5.2 |
| 6 | `.report` is shared with Colour check and Ear clips | Should-fix | §6 scoped to `article.report` |
| 7 | Issue rows offer fewer states; "No photo" lived only in the tile | Should-fix | §6.1, §6.2 |
| 8 | Not every fold should get the marker; `::before` can't take `aria-hidden` | Should-fix | §2.6 lists both sets; `content:"▸" / ""` |
| 9 | `rowMenu()` is shared with the team cat page | Should-fix | §7.2: a `compact` option; the glyph is hidden from screen readers |
| 10 | No test for the whole-pixel rule; `mainClass` is a single value | Should-fix | §2.4: one `.col` wrapper; §12 browser check |
| 11 | The "Home" back links go to the Queue; Feeding sites is out of scope; "Back to the report" broke the rule | Should-fix | §2.5 |
| 12 | Fragment links don't open folds; `?done=` doesn't name a person; chips and short roles incomplete | Should-fix | §4.1 |
| 13 | `roleSentence()` also writes emails; `placementFields()` is shared | Should-fix | §9.1: "Now:" left alone; same words on all three forms |
| 14 | The vet-costs card isn't "coming soon"; the legend already says it; outline and table-by-width points | Should-fix | §8.1, §8.4 |
| 15 | A Leaflet polygon sits above the tiles; pictures load by `img.onload` | Should-fix | §5.4 |
| 16 | Moving the photo link out of `#catresults` would break its filters | Should-fix | §5.3: it stays inside, on the switch's row |
| 17 | The Vet settings sentence names a planner that isn't built | Should-fix | §9.3 |
| 18 | #292 overlaps more than PR 1 | Should-fix | §14: nothing starts before #292; PRs go one at a time |
| 19 | `methodNote()` exists, and tests pin its ids; the welfare promise should stay visible | Should-fix | §3 |
| 20 | `ul.catgrid` stretches; it isn't `align-items:start` | Nit | §5.1 |
| 21 | Line references, `holdsManagement`, the history grouping, unsourced figures | Nit | Throughout; sources added |
| 22 | The page name must sit outside `<summary>`; Sign out moves behind the fold | Nit | §2.1; D1 "Against" column |
