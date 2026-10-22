# Dashboard pages: less to read before the thing you came for

**Ticket:** SYC-619 (parent: SYC-609, Team dashboard).
**Source:** the design review of 22 Oct 2026 (artifact on SYC-619), checked on the live build `2394828e`, the same as main that day.
**Scope:** every team dashboard page except Home (SYC-603, PR #292) and the team cat page (SYC-602).
**Status:** first draft, 22 Oct 2026. Waiting for the adversarial review, then for Samuel's decisions (§10) and approval.

## Contents

1. [What this changes, in short](#short)
2. [Every page](#every-page)
3. [Content first, rules after](#content-first)
4. [Lists that don't repeat their buttons](#lists)
5. [Cats and the Map](#cats-map)
6. [Queue](#queue)
7. [Colonies and a colony](#colonies)
8. [Reports](#reports)
9. [People, Areas, the checks and Find from a photo](#other-pages)
10. [Decisions](#decisions)
11. [Words for Greek and French](#translations)
12. [Tests](#tests)
13. [Out of scope](#out-of-scope)
14. [Build](#build)
15. [Corrections to the review](#corrections)

---

<a id="short"></a>
## 1. What this changes, in short

Each page asks people to read and scroll too much before they reach what they came for. Three patterns cause most of it:

- On a phone, the menu and a stack of controls fill a quarter or more of the screen.
- Pages explain how their figures are counted before showing the figures, even when there are none.
- Lists give every row its full set of buttons.

This spec sets one rule for each pattern (§2–§4), then lists the page-by-page fixes (§5–§9).

The look stays the same: the warm background, dark ink, teal links and buttons, the system font, and red only for risky actions and urgent reports (`team-dashboard-redesign.md` §12.1). Team pages stay English only, except the pages a cat guardian also reads (§11).

---

<a id="every-page"></a>
## 2. Every page

### 2.1 The menu on a phone (Decision D1)

**Today.** Below 600px the menu wraps onto rows so that no link is hidden (SYC-522, `layout.ts:123`). At 390px, a manager's menu takes two rows of links. "Signed in as Samuel Porter" and Sign out take a third row. The page title starts 225px down an 844px screen.

**Recommended (D1, option B): a "Menu" fold on phones.** Below 600px the bar shows one row:

- the current page's name, in bold, at the left;
- a **Menu** button at the right.

Menu is a `<details>` element, so it works without scripts, like every other fold on the dashboard. When it is open, every link shows as a full-width row, each 44px tall, with the current page marked as it is today (bold, underlined, `aria-current="page"`). "Signed in as {name}" and Sign out are the last two rows.

- At 600px and wider, nothing changes: one bar, with the name and Sign out at the right.
- A page whose `active` is null (Vet settings, the error pages) shows "Menu" with no page name.
- The fold closes when a link is followed, because the next page starts closed.
- This keeps SYC-522's aim (no link is ever cut off), because every link is a full row inside the fold.

Options A and C are in §10.

### 2.2 Workspace in the menu: management only (decided)

**Decided by Samuel, 22 Oct 2026 (option C):** the Workspace link shows in the menu only to people who hold the management role.

- Today the link shows to everyone with `use_workspace`, and that capability is given to the whole team, staff and management (`capabilities.ts`, `use_workspace: { kind: "island", roles: TEAM }`).
- This spec changes **only the menu link**. `navContext.workspace` becomes `mayUseWorkspace(person) && holdsManagement(person)`, set in `requireTeam.ts`. "Holds management" means a management placement is in force, the same test that `manage_people` uses.
- **Who can get into the workspace doesn't change.** A staff member who has the workspace address can still open it. Whether staff should keep that access is note N1 (§10).

### 2.3 The menu's Map and the Cats Grid/Map switch: both stay (decided)

**Decided by Samuel, 22 Oct 2026 (option C):** both ways to the map stay.

The review said the two ways light up different menu items. That was wrong (§15): the map view always passes `active: "map"` (`catMapPage.ts:194`, `:238`) and the grid passes `active: "cats"`, however you arrive. **Nothing changes here.**

### 2.4 One left edge at every width

**Today.** `main` is 760px wide on most pages and 1120px on Cats, the Map, the Queue, Find from a photo's results and the five reports. Both are centred, so on a laptop the left edge jumps about 180px between, say, People and Reports.

**Change.** Every page sits in the same 1120px frame, the same one the menu bar already uses (`layout.ts:108`). A page that reads best narrow keeps its 760px column, but starts at the frame's left edge instead of being centred.

- In CSS: `main` gets `max-width:1120px` on every page. Its content is limited to 760px unless the page passes `mainClass: "wide"`.
- `.mappage` keeps its whole-pixel rule (SYC-209 PR 3.1). Only its left margin moves, and that margin must still be a whole pixel.
- At 390px nothing changes, because both widths are wider than the screen.

### 2.5 One kind of back link

Every page below the top level gets a back link in the same place (`beforeTitle`), in the same form: **"← " plus the name of the page you'll land on.**

| Page | Today | Becomes |
|---|---|---|
| A colony | "All colonies" | "← Colonies" |
| Add cats to a colony | "Back to the colony" | "← {colony name}" |
| A feeding site | "All feeding sites" | "← Feeding sites" |
| Feeding sites | none | "← Colonies" |
| Change someone's roles | "All people" | "← People" |
| Bring someone back | "Left" | "← People who left" |
| Find from a photo | "Back to Cats" | "← Cats" |
| Find from a photo, from a report | "Back to the report" | unchanged, with the arrow: "← Back to the report" |
| Vet settings | none | "← Home" |
| Areas, Ear clips to check, Colour check | "← Back to Home" | "← Home" |
| A report | "← All reports" | "← Reports" |
| The team cat page, the vet-visit form | unchanged | unchanged (out of scope) |

Problem pages ("That didn't save") keep their links in the page body.

### 2.6 Folds look like folds

**Today.** "Create a colony", "Add an area", "Rename" and "Change this colony" are `.fixes details`: white boxes with bold teal text and no marker, so they read as cards. "Invite someone" is a filled button that looks the same open or closed. People's "History" fold is bold teal text with no marker.

**Change.** Every `<details>` summary on the team pages shows a small triangle before its words. The triangle points right when closed and down when open (`::before`, rotated by `details[open]`). The `.fixes` box keeps its border.

- "Invite someone" becomes an outlined button with the triangle. It is no longer filled: the page's main action is the list itself.
- Buttons that do something straight away (Save, Create the colony, Send the invitation) stay filled.
- The marker is decoration, so it carries `aria-hidden`. The `<summary>` element already tells screen readers it opens.

---

<a id="content-first"></a>
## 3. Content first, rules after

**The rule.** A page opens with at most one short line saying what it is for, then its content. Rules about how something is counted, and what it leaves out, go in a fold at the end called **"How this is worked out"**. Text a person must see to use the page safely stays visible. "This map is only for the team" is one example (`design-review-fixes-oct22.md` §1.5).

One shared helper, `methodFold(lines)`, draws the fold, so every page words and styles it the same way.

Where it applies:

| Page | Moves into "How this is worked out" | Stays visible |
|---|---|---|
| Reports index | The intro "Each report is worked out from the records when you open it, for the time range you choose." is removed. The list is enough. | — |
| Every report | Each report's own method lines (listed in §8), plus "Figures change as records are corrected." | "Worked out {date}, {time} Syros time · {range}" |
| Every report except Vet | "Place names from the named areas, version N." stays inside the fold | — |
| Areas | "A place belongs to the area whose centre is nearest. More than 2 km from every centre is Off Syros. Place labels and the Cats filters use this list within a minute of a change." and "Each change makes a new version. Reports name the version they used. This is version N." | — |
| Ear clips to check | Nothing moves. When the list is empty, the page shows only "Nothing to check. Every Probably sterilised cat has been looked at." and leaves out the explanation, which is about buttons that aren't on the page. | The explanation, when there are cats to check |
| Vet settings | "A new price is used everywhere within a minute." is removed. | "The trapping planner's estimate uses it, and a vet visit with Sterilised ticked starts with it as the cost. The cost of each visit can still be changed." |

"Syros time" is added to the "Worked out" line, because `stamp()` already formats in `Europe/Athens` (`reportPages.ts:53-56`) but doesn't say so.

---

<a id="lists"></a>
## 4. Lists that don't repeat their buttons

**The rule.** A list of people, areas or cats shows one short row per item. A row's actions appear only when that row is opened, as the Queue's report cards already do (`queuePage.ts:263-278`). A risky action never appears on a row that isn't open.

### 4.1 People

Each person becomes a fold, `<details class="person">`.

- **The closed row:** name, the state chip ("Joined", "Invited", "Expired", "Left"), and the short role ("Management", "Team", "Cat guardian"). It is 56px tall, the same as a Queue row.
- **Open:** today's card body: email, roles sentence, colonies, the date line, the buttons, and History.
- **Your own row** shows "This is you" in place of the chip's neighbour text and opens to the same "To step back, use Stop helping on your own page." line as today.
- A person whose action just finished (`?done=` names them) opens already, so the result is in view.
- "Joined" is said once. The open card's date line becomes "Since 3 October 2026." for a joined person, because the chip already says "Joined".
- **"Joined in the last 7 days"** is left out when nobody has joined in that time.

"Mark as left" already asks before doing anything (`<details class="confirm">`, `peoplePages.ts:159-184`). That stays as it is, one level down inside the opened row.

### 4.2 Areas (Decision D5)

**Recommended (D5, option A).** The areas become a list of folds, sorted by **number of cats, most first**, then by name.

- **The closed row:** the area's name and "N cats". It is 48px tall.
- **Open:** "Open map", "Rename" (its own small fold, as today), "Move centre on a map", and **"Retire"**.
- **Retire gets an "Are you sure?" page,** using `confirm.ts` and the `sure.*` words, as Retire this site already does (SYC-395). Today it is a one-tap red button with no check (`areasPage.ts:110-146`).
- **History:** rows written by the first setup (`who` is null and the kind is `area_added`) fold into one line: "21 areas set up by Syros Cats, 15 Oct 2026". Later changes are listed one by one as today.
- At 390px, 21 closed rows take about 1,000px, where today's 21 cards take about 5,600px.

Option B is in §10.

### 4.3 A colony's cats

Covered in §7.2.

---

<a id="cats-map"></a>
## 5. Cats and the Map

### 5.1 The cards say what's known (Cats grid)

The card today (`catGridPage.ts:255-283`) always draws a coat line, a colony line, the sterilisation mark, last seen and a tag. On the live site almost every card reads "Coat not known · No colony · ○ Not known".

- **Leave out a line that says nothing is known.** "Coat not known" and "No colony" aren't drawn. The photo's alt text still says "Photo of {name}" with the coat words when they're known.
- **The sterilisation line is never left out,** because it's what the team plans around. Its wording is SYC-601's ("Sterilised: not known yet", as the app now says). This spec doesn't word it again. SYC-601 should merge first or in the same PR.
- **The order on every card:** name and SYR number; coat (if known); colony (if any); sterilisation; last seen · place; tag.
- The card's height varies with what it has. The grid's rows already let cards differ in height (`ul.catgrid` uses `align-items:start`). The build checks this at 390px and 1280px.

### 5.2 Sharper card photos (Decision D6)

The grid loads the `small` version, 160px wide (`photoVariants.ts:15`), with no `srcset`. It draws it in a box about 170px wide on a phone and 193px on a laptop. A phone screen needs about twice that, about 340px, for a sharp picture.

**Recommended (D6, option B): add a `card` version, 360px wide,** made and served exactly as `small` and `medium` are (SYC-396 PR 1.2). The grid uses `srcset` with `small 160w, card 360w` and `sizes="(min-width:1000px) 200px, 45vw"`.

- A 360px JPEG is roughly a quarter of the 640px `medium`'s size, so a grid of 28 cats stays light on island mobile data.
- Until a cat's `card` version exists, the route falls back to `small`, as the other versions already fall back.
- The migration and the version-making job are sized in the implementation plan. **Unchecked:** whether adding a width needs a migration (the `photo_variants` table may hold the size as a checked value).

Options A and C are in §10.

### 5.3 Two rows of controls before the cats

**Today on a phone:** the search row, then Filters, then Grid/Map, then Find from a photo, each on its own row.

**Change:**

1. **Row 1:** the search box and "Show cats", as today.
2. **Row 2:** "Filters (n)" at the left and the Grid/Map switch at the right, on one row.
3. "Find from a photo" moves to a text link under the search box: **"Or find a cat from a photo"**.

The map view uses the same two rows and gains the same link in the same place, so nothing jumps between the views (SYC-522's aim). At 900px and wider, the filter panel stays open as today (`layout.ts:515-517`), and the switch and the link sit above it.

### 5.4 The map while its pictures load

Today the map box is plain beige (`#e8e4d8`) for the 3–6 seconds before its pictures arrive, with the cat bubbles on nothing.

- **Change:** `dashboard-map.js` draws its existing Syros outline (`OUTLINE`, used today only when the pictures fail) **as soon as the map starts**, under the tiles. It also shows a small line, "Loading the map…", at the top of the map box.
- The line is removed on the first tile's `load` event. If the pictures fail, today's "Map pictures aren't loading. The cats are still shown." replaces it.
- The no-script map is unchanged.

### 5.5 Number bubbles that overlap

`drawCats()` buckets cats into fixed 44px squares (`dashboard-map.js:536-554`, `CELL = 44`) and places each group at its cats' average position. Two neighbouring groups can end up less than 44px apart. Live, two "11"s overlap at Kini, and "2" and "3" overlap at Ermoupoli.

**Change.** After bucketing, one merge pass runs. Any two markers (single or group) whose centres are less than 44px apart on screen become one group. It holds all their cats and sits at their average position. The pass repeats until no two markers are closer than 44px.

- With 28 cats it's instant. The build measures it with 2,000 made-up cats and keeps it under 16ms on a laptop.
- It runs on `zoomend`, as the bucketing does now.
- Tapping a merged group does what tapping a group does today: zoom in by 2 levels, or at the closest zoom open the "N cats here" sheet.

The no-script map already groups on the server in a fixed grid (`buttonMapMarkers`), and is left as it is.

---

<a id="queue"></a>
## 6. Queue

### 6.1 Suggest the next step

**Today** an opened report shows four equal buttons under "Move this report to", with the current one as a greyed, disabled button: "New (current)" (`queuePage.ts:109-147`).

**Change:**

- The current state is said in words above the buttons: **"Now: New"** (or "Now: Looking at it", and so on). It is no longer a button.
- The other three states are buttons. **The usual next step is the filled teal button:**
  - from New, "Looking at it";
  - from Looking at it, "Done".
  - From Done or Nothing needed, there's no filled button: the report is closed, and reopening it is a deliberate choice.
- The others are outlined, as today. "Move this report to" stays as the label.
- The buttons keep their `name="to"` values. The form, the server and the `from` check are unchanged.

### 6.2 The folded row

- **No "No photo" box.** A report with no photo has no 56px box at the start of its row (`queuePage.ts:266-268`). Its words start at the left edge. A report whose photo failed or is still uploading keeps the note in its open body, as today.
- **Two lines of words, not one.** The first words (`said1`) may run to two lines (`-webkit-line-clamp:2`), so "Four kittens under the steps behind the bakery" isn't cut to "Four kittens under t…".
- **Said once when open.** When the row is open, the short words in its summary are hidden (`details[open] .said1{display:none}`), because "What they said" shows them in full just below.

### 6.3 The stripe means something

Today every open report that isn't urgent has an amber stripe (`layout.ts:130`), so amber stops meaning anything.

- Urgent: red, as today.
- Issues: blue, as today.
- Closed: grey, as today.
- **Every other open report:** the card's own light border colour, `#d9d5ca`. Kittens still show their "Kittens" tag.

---

<a id="colonies"></a>
## 7. Colonies and a colony

### 7.1 Colonies list

- **With no colonies** (and not searching): the lead line, then "Create a colony", as today. The search form and "Recent changes by cat guardians" are left out, because there is nothing to search and nothing has changed.
- **With colonies,** the order becomes:
  1. search;
  2. sort;
  3. the figures line;
  4. the list;
  5. "Create a colony";
  6. "Recent changes by cat guardians", last.

  SYC-522 found "Recent changes" sitting above the colonies. Only the empty case was changed then (SYC-577).
- The colony card itself is unchanged.

### 7.2 A colony's page (Decision D3)

**Order.** The page becomes:

1. the summary;
2. "Change this colony" (the fold);
3. **Cats**, with "Add cats";
4. Feeding sites, with "Add a feeding site";
5. the moved-away list;
6. notes;
7. history.

Today the cats come after the feeding sites.

**Each cat's row (recommended, D3 option B).** Each row gains the sterilisation mark and the last-seen line that the Cats grid card shows. They come from the same helpers: `loadTeamCats()` for `mark` and `lastSeenAt`, `markBadge()`, and `lastSeenWords()`. The rows are sorted with not-sterilised first, then not known, then probably, then sterilised. Within each group, the most recently seen come first, following `team-dashboard-redesign.md` §9.2's order.

- A cat guardian reading her own colony gets the same two lines. §10.2 of the redesign spec already gives guardians the badge and the last-seen **date**. No place and no position is added to the row.
- A cat that `colonyView` lists but `loadTeamCats` leaves out (a merged-away record) keeps its row with no mark line, rather than disappearing.
- This is a stopgap. The full trapping planner (`team-dashboard-redesign.md` §9.2, SYC-396 PR 2.3) is approved but not built; only its price setting shipped (PR 2.3.1, #256). This change uses the planner's order so the planner can replace the list later without reshuffling. A ticket is filed for the planner itself (§14).

Options A and C are in §10.

**The "More" button goes inside the row.** Today "More" (which holds "Take out of this colony") is a separate bordered button under each cat's card, outside it (`colonyPages.ts:502-540`, `rowMenu.ts`). It isn't clear which cat it belongs to, and it doubles the list's length.

- The `<li>` takes the card styling. Inside it, the cat's link fills the row, and a small **"⋯"** fold sits at its right edge, 44×44px, labelled "More (for {name})" for screen readers, as now.
- Opening it shows "Take out of this colony" inside the same card, under the row.
- The link and the fold are siblings inside the `<li>`, because a fold can't sit inside a link.

---

<a id="reports"></a>
## 8. Reports

### 8.1 The index

- The intro line is removed (§3).
- **Not built yet:** "Impact report for funders" and "Donations" get muted text and a grey "Coming soon" chip, so they don't look like the reports you can open. "For team members who can see vet costs" (Vet visits without `view_vet_costs`) gets the same treatment.

### 8.2 Every report

- **The period choices** ("This month", "Last 3 months", "This year", "All time") lose their underline, because the pill shape already says they're choices. The current one stays filled.
- **"How this is worked out"** at the end holds the method lines (§3).
- **Empty means empty.** When a report shows "Nothing recorded in this period", the sections that can only show zeros or "none" in that case are left out. They come back when there is data.

  | Report | Left out when empty |
  |---|---|
  | Coverage and spotting | The spotting chart, its table and its download. The headline stays ("0 sightings, from 0 spotters"), and so does Where spotters have looked, because squares not looked at still matter. |
  | Welfare patterns | "Welfare reports per week", "Counted separately" and "Where reports came from" |
  | Vet visits and costs | "Spend by what was done", "Cost per sterilisation", "Sterilisations with no cost recorded" and "Every visit". "0 vet visits, €0 spent by Syros Cats" stays as the headline. |

- **"See all time" only when it would help.** On Colony health, when there are no colonies at all, the empty line becomes "No colonies yet. Colonies are set up on the Colonies page." with a link to Colonies, instead of "See all time".

### 8.3 Each report's own fixes

- **Sterilisation progress:** "Each point shows the records as they stood on that date." is said once, under the chart. It is removed from the footer (`reportPages.ts:235`).
- **Vet visits and costs:** these move into the fold:
  - "Each visit is counted once, under its main purpose: Sterilised if ticked, else Vaccinated, else Treated, else Checked only."
  - "A visit that also vaccinated or treated the cat counts its whole cost."
  - the no-cost section's explanation;
  - "Counted by the date of the visit."
  - "An undone visit isn't counted anywhere."

  "Spend is Syros Cats' money and donations given for a cat. Owner-paid visits are listed, but never added into spend." stays visible, because it says what the main figure is.
- **Welfare patterns:** "Each report is in one kind only: a report with kittens is Litter, however urgent." and the two footer lines move into the fold.
- **Coverage and spotting:** "Counted by the date each sighting was sent." and "Sightings from spotters who have since deleted their account count as sightings, but not as spotters." move into the fold. "Spotters are counted, never named." stays visible.

### 8.4 Where spotters have looked (Decision D4)

**Today** (`coverageMap.ts:38-96`): an SVG of 250m squares with no coastline. Area names are drawn on top of the squares, nudged down when they collide. Sighted squares often fall outside an area's dotted ring, because sightings aren't near the area centres. So Kini, with 22 of the 28 cats, looks unvisited.

**Recommended (D4, option B):**

- **The island's outline goes behind the squares,** as a light filled shape. It is the same outline `dashboard-map.js` uses, moved to one shared module so the server and the script read the same points.
- **Names go beside the squares.** Each name is placed just outside its area's group of squares (to the right, or to the left at the east coast), with a thin leader line where it had to move. Names no longer sit on top of the squares.
- **The ring's meaning is said in the legend:** "Dotted: within 500 m of an area's centre, no sighting yet. Grey: a sighting in this period."
- **"Show as table" opens by default on a phone** (below 600px), where the picture is smallest. On a laptop it stays folded.

Options A and C are in §10.

---

<a id="other-pages"></a>
## 9. People, Areas, the checks and Find from a photo

### 9.1 Changing someone's roles

- **A line under each tick box** says what that role can do. The paragraph after the three boxes is removed.
  - "A member of the Syros Cats team": "Sees the whole island and records what they find."
  - "A member of Syros Cats management": "Can also invite people, change what they can do and sign anyone out."
  - "A cat guardian": "Sees only the colonies they look after."
- **"Now:" names every role in force.** Jacky holds a team placement and a management placement, so both boxes are ticked, but "Now:" says only management (`roleSentence` shows the higher one). It becomes "Now: a member of the Syros Cats team and of Syros Cats management."

### 9.2 Colour check

When there's nothing in "To check", the "Not yet described by the team: N cats" fold opens by default, because it's then the only list on the page. When there is something to check, it stays folded, as today.

### 9.3 Find from a photo (Decision D7)

**Today** (`findPhotoPage.ts:138-218`) there are two forms. Step 1, "Where to look", is a GET form with a "Count the cats" button that reloads the page. Step 2, "Your photo", is a separate POST form that carries step 1's choices as hidden fields. On a phone the photo is below the fold.

The order exists for a reason. Choosing a photo and then reloading the page for step 1 would lose the photo, and a file field can't go in a GET form (`findPhotoPage.ts:22-24`).

**Recommended (D7, option B): one form, photo first.**

1. **"Your photo"**: the file input, as today.
2. **"Narrow it down (optional)"**: a fold holding Area, Colony and Colours. These become ordinary fields of the same POST form.
3. **"Compare"**: the submit button.

- The count line becomes static: "Compares with all 28 cats on the app, or the ones you narrow it down to." The count is no longer recalculated before you compare, because the whole-island search (the looks-like index, SYC-527) no longer needs narrowing to run.
- "Count the cats" is removed.
- `find-photo.js` keeps working (`form.findphoto`, the submit button, `#find-progress`).
- The "Go to it" links on a problem page point at `#find-photo` and at the fold, which opens when its fields carry the problem.
- When there are no cats at all, the form isn't drawn, as today.

Options A and C are in §10.

### 9.4 Feeding sites

Out of scope, because SYC-585 moves this page onto the new map, and the order above the map is pinned by `.mappage`. Two points are added to SYC-585:

- "Add a site" should come before the map;
- the "Update" button for "Show retired sites" goes away with the old map.

---

<a id="decisions"></a>
## 10. Decisions

Each decision is written so it can be answered on its own. Samuel's answers will be recorded here and on SYC-619.

**D1. The menu on a phone** (§2.1)

| | What it is | For | Against |
|---|---|---|---|
| A | Keep it as it is: links wrap onto rows, with a row for the name and Sign out | Every link is one tap away | 225px before the title on every page |
| **B (recommended)** | One row: the page name and a "Menu" fold | The title starts about 60px down. Nothing is cut off. It works without scripts. | Getting to another page takes two taps instead of one |
| C | Keep the wrap, but move "Signed in as" and Sign out to My page | Saves one row (about 44px) and keeps one-tap links | Still two rows of links. Sign out is one more step away. |

**D3. A colony's cat list** (§7.2)

| | What it is | For | Against |
|---|---|---|---|
| A | Build the full trapping planner now (redesign §9.2) instead | The real answer: to-do list, estimate, printable plan | A much bigger piece of work, and it holds up the rest of this spec if it's done here |
| **B (recommended)** | Add the mark and last seen to each row now, in the planner's order; the planner follows on its own ticket | Small. Useful at once. The planner can drop in later. | A little work that the planner later replaces |
| C | Leave the list as it is until the planner | No throwaway work | The team keeps opening each cat to see if it's done |

**D4. "Where spotters have looked"** (§8.4)

| | What it is | For | Against |
|---|---|---|---|
| A | Draw the squares on the real map pictures | Roads and villages show | Map pictures go through our tile server with tokens. Drawing on them server-side is a bigger change, and a report would then depend on the map service. |
| **B (recommended)** | The island outline behind the squares, names beside them, and the table open on phones | Readable, server-drawn, no new service | Still no roads |
| C | Drop the picture and show only the table | Simplest, and fully accessible | Loses the at-a-glance view of gaps |

**D5. Areas** (§4.2)

| | What it is | For | Against |
|---|---|---|---|
| **A (recommended)** | Folded rows, sorted by cats, with a confirm page for Retire | Short page, the busy areas first, no one-tap retire | One tap to open a row before acting |
| B | A table: name, cats, and a "Change" link to a page per area | Densest | A new page per area to build and test |

**D6. Card photos** (§5.2)

| | What it is | For | Against |
|---|---|---|---|
| A | Use the existing 640px `medium` in the grid | No new version | About 4× the data on a phone, on island mobile data |
| **B (recommended)** | Add a 360px `card` version | Sharp and still light | A new version to make and serve, and possibly a migration |
| C | Leave `small` | No work | Soft photos on every phone |

**D7. Find from a photo** (§9.3)

| | What it is | For | Against |
|---|---|---|---|
| A | Keep the two forms and their order | No change to a page that works | The photo stays below the fold on a phone |
| **B (recommended)** | One form, photo first, narrowing optional in a fold | The photo is the first thing. One fewer button. | The live count before comparing is lost |
| C | Keep two forms, put the photo form first, and recount with a script | Keeps the count | Needs a script for the count, and still loses the photo without it |

**Note N1. Workspace access.** §2.2 hides the menu link from staff, as decided. Staff keep their access to the workspace itself (`use_workspace` is given to the whole team). Should that access also become management-only? Recommended: **no change in this spec**, because it changes who can read the shared documents and needs Syros Cats' view.

**Decided already** (Samuel, 22 Oct 2026, "1C, 2C"):
- the Workspace link is management-only (§2.2);
- both ways to the map stay (§2.3).

---

<a id="translations"></a>
## 11. Words for Greek and French

Most team pages are English only, as inline text. Some changed pages are also read by cat guardians in their own language, through the catalogue (`strings/en.ts`, `el.ts`, `fr.ts`, with `strings.test.ts` checking every key exists in all three):

- the menu fold (§2.1): "Menu";
- the back links on a colony, adding cats and a feeding site (§2.5);
- the colony's cat rows (§7.2), which reuse the existing mark and last-seen words;
- the "⋯" label (§7.2).

New keys are added in en, el and fr together. Greek and French aren't live yet (`LIVE_LANGUAGES = ["en"]`), so Johnny's check (SYC-283) covers them before they are.

---

<a id="tests"></a>
## 12. Tests

Each change is tested before its commit. The affected api-server suites run locally (vitest with the esbuild workaround), and the full api-server suite runs before `gh pr ready`. Every changed page is checked in the browser pane at 390px and 1280px, with data, by keyboard as well as by tapping. Form posts are tested through `page.request.post` with the dashboard's Origin, never by submitting from localhost.

- **Menu (§2.1):**
  - Below 600px the bar has one row, with the current page's name and a Menu fold.
  - Every link is inside the fold and none is cut off at 320px.
  - Name and Sign out are the last rows.
  - At 600px and wider the bar is unchanged (the existing `layout.test.ts` cases still pass).
  - A screen reader reaches the fold from the skip link's position.
- **Workspace (§2.2):**
  - A staff member's menu has no Workspace link.
  - A manager's menu does.
  - A cat guardian's menu has none (unchanged).
  - **Mutation:** dropping the management check must fail the staff test.
- **Widths (§2.4):** at 1280px, the left edge of the title is the same on People, Reports, Cats and Areas. The map still starts on a whole pixel (`dashboardMap.fit.test.ts` and the `.mappage` tests).
- **Back links (§2.5):** one test walks every page in the §2.5 table and checks the text and target.
- **Folds (§2.6):** every `<details>` summary on the team pages carries the marker class. The marker is `aria-hidden`.
- **"How this is worked out" (§3):** each page in the §3 table has the fold with the listed lines inside it and none outside. Ear clips with no cats shows only the empty line.
- **People (§4.1):**
  - Each person is one closed fold.
  - `?done=` opens that person.
  - Nobody's buttons are visible until their row opens.
  - "Joined in the last 7 days" is absent when empty.
- **Areas (§4.2):**
  - Rows are sorted by cats, then name.
  - Retire goes to a confirm page and retires nothing until confirmed.
  - **Mutation:** a direct POST without the confirm must still be refused or must show the confirm.
  - First-setup history folds into one line.
- **Cats cards (§5.1):** a card with no coat and no colony has neither line. A card with both has both. The sterilisation line is always there.
- **Card photos (§5.2):** the grid's `<img>` has the `srcset` and `sizes` above. The `card` route falls back to `small` when the version is missing, and follows the same access checks as `small` (`team.photoVariants.test.ts`).
- **Controls (§5.3):** grid and map views put search, Filters, the switch and the photo link in the same order.
- **Map (§5.4–5.5):**
  - The outline is drawn before any tile loads.
  - The loading line goes on the first tile `load`.
  - After the merge pass, no two markers are closer than 44px, at every zoom, for a made-up set of 2,000 cats.
  - **Mutation:** removing the pass must fail that test.
- **Queue (§6):**
  - "Now: New" with "Looking at it" filled.
  - "Now: Looking at it" with "Done" filled.
  - No filled button for closed states.
  - No "No photo" box.
  - The short words are hidden when open.
  - The stripe colours by state.
  - The existing `queuePage.layout.test.ts` cases are updated on purpose, and each update is listed in the PR.
- **Colonies (§7):**
  - With no colonies there is no search and no Recent changes.
  - With colonies, the order is as in §7.1.
  - A colony's rows carry the mark and last seen, in the planner's order.
  - A guardian's view of her colony shows the same two lines and no place or position (route-walk test per `roles-and-invites.md` §6.4).
  - "⋯" sits inside the row.
- **Reports (§8):**
  - Each report's empty state leaves out the sections in §8.2's table.
  - Colony health with no colonies links to Colonies.
  - The duplicate sentence is gone.
  - The "Worked out" line says "Syros time".
  - CSV downloads are unchanged.
- **Coverage picture (§8.4):** the outline is drawn. No area name's box overlaps a square. The table is open below 600px.
- **Roles (§9.1):** "Now:" names both roles for someone holding both. Each box has its line.
- **Find from a photo (§9.3):**
  - The photo input comes first.
  - Area, colony and colours post with it.
  - Narrowing still limits the cats compared.
  - Problem anchors work.
  - The daily caps are unchanged (`team.findPhoto.test.ts`).

---

<a id="out-of-scope"></a>
## 13. Out of scope

- Home (SYC-603, PR #292) and the team cat page (SYC-602).
- The Feeding sites page and its old map (SYC-585; §9.4 adds two points to it).
- The sterilisation line's wording (SYC-601).
- Typing latitude and longitude to add an area (SYC-557).
- The full trapping planner (redesign §9.2; a ticket is filed, §14).
- Who can get into the workspace (N1).
- Greek and French going live (SYC-283, SYC-291).
- Map pictures with Latin-letter place names (SYC-288).

---

<a id="build"></a>
## 14. Build

**Suggested split: four PRs,** each opened as a draft, each with one commit per change and its tests:

1. **The shell:** menu (§2.1), Workspace (§2.2), widths (§2.4), back links (§2.5), folds (§2.6), and the shared `methodFold` helper.
2. **Lists:** People (§4.1), Areas (§4.2), a colony's page (§7.2), Colonies list order (§7.1).
3. **Cats, Map and Queue:** §5 and §6.
4. **Reports and the rest:** §3's remaining pages, §8 and §9.

PR 1 goes first, because the others use its fold marker and back-link form. The rest can go in any order. PR 1 starts after #292 (Home) merges, because both change `layout.ts`.

**Migration:** only D6 option B might need one. If it does, it follows migrate-before-republish: merge, run `db-ops migrate` and `verify-history` on production, and only then does Samuel republish.

**Tickets filed with this spec:**
- the trapping planner (redesign §9.2, SYC-396 PR 2.3);
- two points added to SYC-585 (§9.4).

---

<a id="corrections"></a>
## 15. Corrections to the review

Three things the 22 Oct review said were wrong. Checking the code for this spec found them, and the review and SYC-619 are corrected to match.

| The review said | What's true | Source |
|---|---|---|
| The map "opens on the whole island, not on the cats" | It fits to the cats on its first answer (`shouldFitToCats`, `dashboard-map.js:150-153`, `:665`). Live, the cats run from Kini to Ermoupoli, which is most of the island. | Code |
| The menu's Map and the Cats switch "highlight different menu items" | Map view always lights Map, and grid view always lights Cats | `catMapPage.ts:194`, `:238`; `catGridPage.ts:350` |
| "Mark as left" is "easy to hit by mistake" | It already asks "Yes, mark as left" first. Retiring an area is the one-tap risky action. | `peoplePages.ts:159-184`; `areasPage.ts:110-146` |
