# The team dashboard: finding cats, seeing the island, proving the work

**Feature spec · Cat Spotters (Syros)**
**Version:** 0.1, draft for adversarial review · 15 October 2026
**Covers:** the whole team dashboard at team.catspotters.com. That means its home, how cats are found, the island map, colonies and trapping rounds, vet visits, and the reports Syros Cats use to run the work and show funders what it achieved. This spec takes the dashboard parts of PRODUCT-SPEC §2.6 and §3 (items 9, 12, 13) and of the proposal (§10–§13) and turns them into screens.
**Linear:** SYC-43 (the dashboard) · SYC-54 (volunteer colony view, offline) · SYC-161 and SYC-2 (coat colour) · SYC-152 (Matched by hand) · SYC-207 and SYC-394 (other ways to build it) · SYC-270, SYC-362, SYC-365, SYC-366 (fixes this builds on) · SYC-24 (vet access, parked).
**Evidence:** `docs/reviews/team-dashboard-ux-review-2026-10-15.md`.
**Status:** draft. Samuel's decisions from the 15 Oct brainstorm are recorded in §2.

### What this document owns, and what it borrows

| What | Owner |
|---|---|
| Records (cats, observations, sightings, colonies, feeding sites, welfare reports) | `cat-record-data-spine.md` |
| Who may see and do what (capabilities, guardians' colonies) | `roles-and-invites.md` §6 and `lib/capabilities.ts` |
| Sign-in, the dashboard shell, the welfare queue's rules | `team-access-and-welfare-queue.md` |
| Feeding-site privacy and the feeding-site screens | `feeding-sites-and-colonies.md` |
| Colour, markings and health records | `coat-markings-and-health.md` |
| **This spec adds** | Home; the browsable Cats screen; Find from a photo; the island Map; the redesigned cat page; colonies as trapping planners; vet visits; the Reports area; and the design rules every screen follows (§11). |

---

## 1. The short version

Syros Cats' office team (Jacky, Susan and the office volunteers) opens the dashboard to answer four questions:

1. **What needs us today?** Reports to act on, cats to check, cats not seen for a while.
2. **Which cat is this?** Nobody standing in front of a cat knows it's called Aegean Ziggy or that it's SYR-0004. The team finds cats by how they look, where they live, and what we know about them, or from a photo.
3. **Where are the cats, and where should we trap next?** One map of every cat on the island at the place it was last seen, coloured by whether it's sterilised. Each colony becomes a ready-made trapping plan: the cats still to do, where they are usually seen, and what it will cost at €50–60 a cat.
4. **How are we doing, and can we prove it?** Sterilisation progress across the island and per colony, colony health, where nobody has looked yet, welfare patterns, vet spend, and a dated, exportable impact report for funders that states its method and never exposes a single cat.

The dashboard stays fast on a phone in a street with weak signal. A few screens (the map, the filters, the charts) get small pieces of interactivity, and every page still works if that interactivity fails to load.

## 2. Decisions already made (Samuel, 15 October 2026)

| # | Question | Decision |
|---|---|---|
| D1 | Who does the dashboard serve first? | **The office team.** Home is their overview. Cat guardians see the same screens limited to their own colonies (§10). |
| D2 | Which dashboards? | Home; Cat map; Browse cats by look and place; Sterilisation progress; Trapping round planner; Colony health; Impact report for funders; Coverage gaps and spotting activity; Welfare report statistics; Vet visits and costs; Donations. (Not chosen: a Matched-by-hand and duplicates dashboard, Data requests, App switches. These stay with their own tickets.) |
| D3 | How interactive? | **Light interactivity on the existing server-drawn dashboard.** A map you can drag and pinch, and filters that update straight away. Every page works without scripts. A full rebuild as a new app is on record as SYC-394. |
| D4 | How are vet visits recorded? | **The team logs each visit on the cat's page.** Recording a sterilisation also confirms the cat as sterilised. |
| D5 | Donations? | **Designed now (§9.7), built last,** once the donation route with James is settled. |
| D6 | Welfare statistics? | **Patterns, not performance.** Volumes, kinds and where problems cluster. Never response times or targets. |
| D7 | Find a cat from a photo? | **Yes.** The team uploads a photo and sees the closest matching cats. |

## 3. How the dashboard is laid out

### 3.1 The menu

**Home · Cats · Map · Queue · Colonies · Reports · People**

- The menu names the team's jobs, not record types.
- Feeding sites move inside the Map (as a layer) and inside each colony. Their own page stays reachable from both.
- "Probably sterilised" folds into Home's "Cats to check" (§4), alongside cats matched by hand once SYC-152 exists. The separate page stays reachable from there. That settles SYC-365's rename.
- People shows only to those who can manage people, as now.
- On a phone the menu is one row you can slide sideways, with the current page underlined. On a desktop it's a single bar.

### 3.2 Every page

- **The page title comes first.** "Signed in as …" and Sign out move into the menu bar, at the right on desktop and at the end of the row on a phone. They don't repeat under every title.
- **Places are shown as names, never numbers.** A location reads "Kini, by the harbour". It's worked out from the nearest named area (§3.3) and, where there is one, the nearest feeding site. Where precision matters, a small map picture shows the spot. Exact coordinates stay one tap away for the team, for copying into a phone's maps (SYC-245).
- **Empty pages explain themselves.** For example: "No colonies yet. A colony is a group of cats fed in the same place, usually by one cat guardian. Grouping cats into colonies lets you plan trapping rounds and see each colony's progress. Create the first one."
- **Thumbnails are small pictures.** Each photo has a small version (about 160px) and a medium one (about 640px), made once when it's stored. Lists only ever load the small one.

### 3.3 Named areas

Filters, place names and coverage all need a shared idea of "where". Syros Cats keep a short list of **named areas** of the island. It starts with the map's existing place list (Ermoupoli, Ano Syros, Vaporia, Kini, Galissas, Finikas, Posidonia, Azolimnos), plus the rest of the villages. Each area is a simple outline drawn once on the map. Every cat, sighting, report and feeding site falls into exactly one area, or into "Elsewhere on Syros". The team can rename an area or redraw its outline, and every change goes in the history.

## 4. Home: what needs us today

Home is the first page after signing in. It reads top to bottom in order of urgency.

1. **Needs us now.** Only shown when something is waiting.
   - Urgent welfare reports, then new ones. Each is one line: photo, place name, how long ago, and the first words of the report. Tap to open it in the Queue.
   - "Started but not sent" reports from the last 24 hours.
   - Data requests close to their legal deadline, once that feature exists.
2. **Cats to check.** A count and the first few photos for each kind:
   - cats probably sterilised from a clipped-ear photo, waiting for a look;
   - cats matched by hand (SYC-152);
   - cats whose colour the machine wasn't sure of.

   Each kind links to its list.
3. **Not seen lately.** Cats with no sighting for 6 weeks or more that aren't already presumed gone. It shows the photo, name, colony, and "last seen 9 weeks ago, Galissas". The team reads this as "worth asking the guardian", never as "dead".
4. **The headline.** One large figure: **"142 cats known on Syros"**. Under it sits a single bar split into confirmed sterilised, probably sterilised, and not known, with the numbers written beside each part. "As of 15 Oct 2026" and a link to Sterilisation progress complete it.
5. **This month.** Four small figures, each with last month in brackets: sightings, new cats, sterilisations recorded, and vet spend.

Home never shows response times, league tables of people, or anything that reads as someone falling behind (D6).

## 5. Cats: finding a cat without knowing its name

### 5.1 The Cats screen

The Cats screen opens on **every cat**, most recently seen first. It's a grid of photo cards: two across on a phone, four to six on a desktop.

**Each card shows:**
- the photo (the small version);
- the name, with the SYR number in smaller text;
- colour chips, e.g. "Black and white";
- the colony, or "No colony";
- a sterilised badge: **Sterilised**, **Probably**, or **Not known**. Each badge has a word and a shape (filled, half-filled or empty circle), never colour alone;
- "Last seen 3 days ago · Kini";
- a small "Has a home" or "Presumed gone" tag where it applies.

**Filters**, in one row above the grid that wraps on a phone:
- **Look:** the colour chips from SYC-161 (Black, White, Ginger, Grey, Tabby, Tortoiseshell or calico, Black and white, Not sure). You can pick more than one.
- **Where:** a named area or a colony.
- **Sterilised:** Sterilised, Probably, or Not known.
- **Lives:** On the street, Has a home, or Presumed gone. Presumed-gone cats are hidden unless asked for.
- **Last seen:** This week, This month, 1–3 months, Over 3 months, or Never seen since first recorded.
- **Name or SYR number:** a search box, now just one filter among the others.

**How the filters behave:**
- With interactivity, the grid updates as filters change.
- Without it, the filters are an ordinary form with a "Show cats" button. The results are the same.
- The page's web address carries the chosen filters (colours, area name, colony, status), so a filtered view can be bookmarked or shared within the team. It never carries a position (see §10).
- A count above the grid reads "38 cats match". "Clear filters" sits beside it.
- The grid loads 48 cats at a time, with "Show more" below.

**Sort:** most recently seen (the default), newest to the records, or name A–Z.

### 5.2 Find from a photo

A **"Find from a photo"** button sits at the top of the Cats screen. The team takes or chooses a photo, for example one a resident sent on WhatsApp. They can also say roughly where it was taken by choosing a named area, which narrows the search. The dashboard then shows the closest matching cats, best first. Each match shows its photo next to the uploaded one, plus a plain word for how close it is: "Very likely", "Possible" or "Unlikely".

- It uses the same matching the app uses for spotters' sightings, so its accuracy and limits are the same. The team always confirms by eye. The dashboard never decides for them.
- From the results the team can open the cat, or tie a welfare report to it when they came from the Queue.
- If none match, it says so plainly and offers to browse that area's cats instead.
- **The uploaded photo isn't kept.** It's used for the search and discarded. Saving it as a new sighting is a separate, explicit choice.
- Each search costs a small AI fee. To protect against runaway cost, searches are capped at 50 per team member per day, and the cap is shown when it's reached.

## 6. The Map: every cat on the island

### 6.1 What it shows

- **Each cat appears once, at the place it was last seen,** as a dot.
- **The dot's look carries the sterilised status**, using the same three states as the badge: Sterilised (a filled dot), Probably (a half-filled dot), Not known (an empty ring). The colour runs from deep for Sterilised, through mid for Probably, to light for Not known, so the map reads even in black and white.
- **Zoomed out, nearby cats merge into a group** showing a count ("14") and a small ring split by sterilised share. Tap the group to zoom in.
- **Layers** you can switch on and off: Cats (on by default), Feeding sites, Colonies (each colony's outline or centre, with its name), Welfare reports from the last 30 days, and Not looked at yet (§9.3).
- **The Cats screen's filters apply here too.** One switch above the content changes between Grid and Map, and the filters stay as they are.

### 6.2 Tapping a cat

Tapping a dot opens a card over the map, or a sheet from the bottom on a phone. It shows the photo, name, badge, colony and last seen, plus **"Show where else it's been seen"**. That draws the cat's other sightings as small numbered dots joined in time order, with a date on each. **"Open the cat"** goes to the cat page.

### 6.3 Moving around

- With interactivity: drag, pinch or scroll to zoom, and "Go to" an area.
- Without it: the zoom, pan and "Go to" buttons that work today.

Either way:
- **Map pictures come through our own server**, so no outside map company learns where the team is looking. The server never writes down which part of the map was asked for (SYC-255).
- **Positions never appear in the page's web address.**

## 7. The cat page

The cat page answers "who is this and what do we know" in the first screenful, then lets the team act, then shows the evidence.

### 7.1 Summary (top)

- **Photo,** with any other photos as a thin strip below it to flick through.
- **Name and SYR number.**
- **A row of plain facts**, each as a label and a value:
  - **Sterilised:** "Yes, confirmed by Syros Cats, 13 Aug 2026", "Probably: clipped ear seen in 3 photos", or "Not known".
  - **Lives:** "On the street", "Has a home", or "Presumed gone (not seen since June)".
  - **Colour:** chips, plus "read from the photo" or "set by Maria".
  - **Colony:** a name with a link, or "No colony".
  - **Last seen:** "3 days ago · Kini harbour".
  - **Vaccinated / health note:** team only, where recorded.

  Where a fact is uncertain, the words say so ("Probably …", "Not known"). There's no separate "confidence" tag that could contradict the value.
- **A small map** of the cat's sightings, numbered in time order. Tap it to open the full Map focused on this cat.
- **What the public sees:** one line, smaller, under the facts.

### 7.2 Actions

A short row of buttons:
- **Log a vet visit** (§8).
- **Correct something.** This opens the existing correction forms (life status, sterilised, colour, colony, rename) one at a time.
- **Add a note.**

The explanation of how corrections work moves into a short "How corrections work" note you can open. It's in plain words: "Every change is kept, with your name. To undo one, mark it wrong."

### 7.3 Evidence (folded, below)

- **Sightings:** a compact list (date, place name, thumbnail). "Make a feeding site here" and "Show on the map" move into a small menu on each sighting.
- **Vet visits:** each with date, what was done, clinic and cost.
- **History:** the full record, newest first, as now, with one change. Routine sightings are grouped: "Seen 19 times by spotters between 29 Jul and 24 Sep, looking well". Tap the line to expand it. Statements that change something (status, colony, colour, name, vet visits, notes) are never grouped.

On a desktop the summary and actions sit side by side above the evidence, so the evidence uses the full width.

## 8. Vet visits

**Who can log one:** the team, and a cat guardian for cats in their own colony. Vets get no access (SYC-24 stays parked).

**A vet visit records:**
- **Date.**
- **What was done** (one or more): Sterilised, Vaccinated, Treated (with a short free-text note), Checked only.
- **Clinic:** chosen from a short list the team keeps, or "Other".
- **Cost in euros.** When "Sterilised" is ticked, this is pre-filled with the standard sterilisation price, which the team sets (typically €50–60) and can change on the form.
- **Paid by:** Syros Cats, the owner, or a donation for this cat. This keeps spend figures honest.
- **Note** (optional).

**What it changes:**
- A vet visit with **Sterilised** also records the cat as **sterilised, confirmed**, attributed to the person who logged it and noting "vet visit on 13 Aug 2026". This uses the existing rule that the team's statement confirms at once.
- A visit with **Vaccinated** also records the vaccination (team only).

**How it's kept:** like every other record, a vet visit is added, never edited in place. A wrong one is marked wrong with a reason. It shows on the cat's page, in the cat's history, and in the vet and progress reports.

**Logging several cats after a trapping round:** the colony's trapping planner (§9.2) offers "Log this round's vet visits". It's a single form listing the colony's cats with a tick box beside each, sharing one date, clinic and price. Each ticked cat gets its own record.

## 9. Colonies and Reports

### 9.1 Colonies list

Each colony is a card showing:
- its name and cat guardian;
- a **progress bar** of sterilised share (confirmed, probably, not known), with numbers;
- the number of cats;
- the date of the latest sighting;
- flags, each a word and an icon: **Growing** (more cats newly recorded here in the last 90 days than in the 90 before), **Kittens reported** (a litter report within 300 m in the last 60 days), **No guardian**, **Not visited lately** (no sighting in 30 days).

Sort by name, by fewest sterilised, or by latest activity. A **Map** switch shows the same colonies on the island map.

### 9.2 A colony: the trapping planner

The colony page leads with what a trapping round needs:

1. **To do: N cats not known to be sterilised.** Each shows a photo, name, colour chips, where it's usually seen (the feeding site or place it's seen at most), last seen, and a "Probably" note where an ear clip has been spotted. They're sorted by most recently seen, because those are the cats most likely to turn up.
2. **The estimate:** "N cats × €55 = €X". It uses the standard price from §8, and the price is shown.
3. **Feeding sites** for this colony, on a small map.
4. **Print or save this plan.** A clean one-page version for taking on the round: photos, names, usual spots. The offline version for phones is SYC-54's.
5. **Log this round's vet visits** (§8).
6. **Done:** the sterilised cats, folded.
7. Guardian, notes and history, as now.

Each cat's "Take out of this colony" moves into that cat's own small menu, so a risky action isn't repeated down the page.

### 9.3 Reports

The Reports area is a list of seven reports. Each opens as its own page, and each has a time range (this month, last 3 months, this year, all time, or chosen dates) in one row at the top.

1. **Sterilisation progress.**
   - The island figure first, as on Home.
   - A line over time of cats confirmed sterilised and all cats known (two lines, one scale, labelled at their ends).
   - Then every colony as a row with its progress bar, sorted by fewest sterilised, so the next trapping target is at the top.
2. **Colony health.**
   - One table, one row per colony: cats now, change over 90 days, kittens reported, not seen lately, guardian yes or no, last visit.
   - Each column can be sorted. Flags match the Colonies list.
3. **Coverage and spotting.**
   - A map of the island split into squares of about 250 m. Squares with a sighting in the period are lightly shaded; squares in villages and along roads with none are marked "Not looked at yet".
   - Next to it, sightings per week as a single bar series, and the number of spotters who sent at least one sighting (a count only; nobody is named or ranked).
   - The aim is to show where to send spotters next.
4. **Welfare patterns.**
   - Reports per week as bars, split by kind (injured or unwell, litter, other, content). Each kind is labelled.
   - A table of the areas with the most reports in the period.
   - Welfare reports as a map layer.
   - No response times, no "time open", and no per-person figures (D6).
5. **Vet visits and costs.**
   - Visits and spend per month.
   - Spend split by what was done.
   - Cost per sterilisation: the average and the range.
   - A table of visits with cat, date, clinic, what was done, cost and paid by. It's exportable for the accounts.
6. **Impact report for funders** (§9.4).
7. **Donations** (§9.7).

Every chart has a **"Show as table"** switch, and every table can be downloaded as a spreadsheet file (CSV).

### 9.4 The impact report

This is a single page built to be printed or saved as a PDF, or downloaded as CSV. It follows the proposal's §11.

- **The headline,** with confidence: "142 cats known on Syros. 89 confirmed sterilised, 23 probably sterilised, 30 not known." It's dated and states who produced it: "Syros Cats, from Cat Spotters records".
- **Progress over the chosen period:** new cats recorded, sterilisations, colonies reached.
- **Per-area figures** at the named-area level (§3.3), only for areas with at least 5 cats. Smaller areas fold into "Elsewhere on Syros".
- **Milestones** reached in the period, for example "100th cat recorded" or "Kini harbour colony fully sterilised".
- **Vet spend** in the period, with cost per sterilisation.
- **"How these figures are worked out":** a short, plain explanation of what confirmed, probably and not known mean, what counts as a cat, and what isn't counted.

**The report never shows** a single cat's photo, name or position, a feeding site, a guardian's name, or any position finer than a named area. "Donors see an overall count, never a cat" (DECISIONS Part 2n).

### 9.5 Not seen lately, and presumed gone

"Not seen lately" (6 weeks or more) is a prompt for the team. It's different from the record's existing "presumed gone" rule, which it doesn't change. Neither is ever shown to the public as a death.

### 9.6 Figures are worked out from the records

Every number is worked out from the existing records each time it's asked for, using the same rules as the cat pages. Results are kept for up to 10 minutes so busy pages stay fast. A page always says when its figures were worked out. There's no separate copy of the data that could drift from the records.

### 9.7 Donations (designed now, built last)

Once the donation route with James is settled, a Donations report shows:
- money received per month, by source;
- money spent on vet work per month (from §8);
- "cats sterilised with donated money" (vet visits marked "a donation for this cat", or covered by general donations);
- a simple meter towards a fundraising goal the team sets, worded as "€X raised, enough for about N sterilisations at €55".

Until then, the Reports list shows Donations as "Coming once donations are set up". The data source is decided with James. Nothing about payment tools is fixed by this spec.

## 10. Privacy and who sees what

- **The team** sees everything on these screens, island-wide, as now.
- **A cat guardian** sees the same screens limited to their own colonies: Cats, the Map, colony pages, vet visits they logged, and the progress and health reports for their colonies. They don't see the welfare queue, the impact report, or other colonies' cats. Their existing My page and My colonies (SYC-53 PR 1.3) stay their landing page.
- **The public** sees nothing new. Nothing in this spec changes what the app shows spotters.
- **No position ever appears in a web address,** including filters, the map, and shared links. Map pictures and cat positions reach the browser only inside a signed-in page or a signed-in data request to our own server.
- **Find from a photo** sends the photo to the same AI service the app already uses for matching, under the same terms, and keeps nothing afterwards.
- **Exported files** (CSV, PDF) from the team reports contain only what that page shows. Only the impact report is meant for outside eyes, and it follows §9.4's limits.

## 11. Design rules

These rules apply to every screen in this spec. The adversarial review and the design review check against them.

### 11.1 Look and feel

- **Keep the dashboard's own look.** Warm off-white background (`#f6f4ef`), dark ink (`#1d1d1b`), teal (`#0b5c6b`) for links and main buttons, and the system font. Red stays reserved for risky actions and urgent reports.
- **One main action per screen,** in the solid teal button. Everything else is a plain or outlined button.
- **Cards for things, rows for lists.** A cat, a colony or a report is a card. A list of sightings or history is rows.
- **Phone first.** Every screen is designed at 390px first, then laid out wider at 1000px and above. Tap targets are at least 44px. Nothing scrolls sideways except the menu.
- **Words are plain English for a volunteer,** never database words. "What we know", not "Records say". "Probably sterilised", not a confidence tag. Team pages stay English only (Decision 12).

### 11.2 Numbers and charts

These follow the data-visualisation method:

- **Choose the simplest form that does the job.**
  - A single number is a large figure, not a chart.
  - A share of a whole (sterilised, probably, not known) is **one horizontal bar** split into three parts with the numbers written beside it. It's never a pie or donut.
  - Change over time is a **line**, or **bars** for counts per week.
  - Comparing colonies is **a sorted list of bars**.
  - Anything with more than about seven groups is a table.
- **One scale per chart.** Never two different y-axes on one chart. Two measures get two charts.
- **Colour has one job per chart.**
  - Sterilised, probably and not known are an ordered scale, so they use **one hue from deep to light**: deep teal `#0b5c6b`, mid teal `#3d8794`, and light teal `#88afb6`. This set passed the palette checker on 15 Oct 2026 (steps read light to dark, visible gaps between steps, light end at 2.16:1 against the page background and 2.37:1 against white cards). On the map the dots also carry a 2px light ring, so they stand clear of the base map.
  - Welfare kinds are separate categories with a fixed colour each, in a fixed order. A kind keeps its colour on every chart, and filtering never repaints it.
  - Red and amber are kept for warnings ("Urgent", "No guardian") and always come with a word and an icon.
- **Never colour alone.** Every coloured part has a label, a legend, or a shape (filled, half-filled, empty) that says the same thing. Charts must read for someone who is colour-blind and when printed in black and white.
- **The palette is checked with a tool before it ships.** That covers colour-blindness separation, contrast against the background, and print. A palette that fails is changed, not argued with.
- **Quiet chrome.** Thin bars with rounded ends, 2px lines, faint solid grid lines (never dashed), a small gap between bar segments, and no numbers on every point. Label the ends, the extremes, and the one that matters.
- **Every chart has a "Show as table" view** and a tooltip on tap or hover with the exact numbers and dates.
- **Every figure says when it was worked out** and what period it covers.

### 11.3 The map

- **The map is quiet.** It uses a light, low-colour base map so the dots stand out.
- **Dots are at least 10px,** with a 2px light ring so overlapping dots stay distinct. Tap targets are at least 44px even where the dot is smaller.
- **There's a legend in the corner,** always visible, using the same shapes as the badges.
- **The map has a list twin.** The same filtered cats are one switch away as the grid, for anyone who can't use a map.

### 11.4 Accessibility

- Includes SYC-366's basics: a skip link, a labelled menu, and a visible focus outline.
- Text contrast is at least 4.5:1.
- Every photo has a short description: "Photo of Mavros, black and white".
- Everything that works with a tap also works with a keyboard.

## 12. How it's built (outline for the plan)

This section is a guide for the implementation plan, not a design in itself.

- **Same server, same pages.** Every screen is a server-drawn page in `artifacts/api-server`, using the shared layout and words. Interactivity is a small amount of script served from our own server, never from an outside website. It's added only to the Cats grid, the Map and the report charts.
  - The security rules change from "no scripts" to "scripts only from our own server, only on these screens". DECISIONS Part 2k is amended.
  - The tests that guard positions in addresses and map links are extended, not loosened.
- **The map script** is an open-source map library (Leaflet, or similar) kept on our own server. It's fed map pictures through the existing map-picture route. It gets cat positions from a signed-in data request, never from the address.
- **Charts** are drawn by the server as simple pictures (SVG), with the table beside them. A small script adds the hover tooltips.
- **A cat list query** returns filtered, paged cats with the facts each card needs. It works from the database, not by loading every cat into memory.
- **Named areas** are a small new record with an outline and a name, plus a history of changes.
- **Vet visits** are a new kind of observation, `vet_visit`, with the fields in §8.
- **Small and medium photo versions** are made when a photo is stored, and once for every existing photo.

## 13. Build order

| Phase | What ships | Why first |
|---|---|---|
| 1 | Cats screen with filters and grid; cat page summary; the Map with cats and the sightings trail; small photo versions; named areas | Fixes "you must know its name" and "show me all cats on a map", the two problems Samuel named |
| 2 | Home; Colonies list with progress and flags; the trapping planner; Find from a photo | The office's daily view and the trapping rounds |
| 3 | Vet visits (single and round); Reports: Sterilisation progress, Colony health, Coverage and spotting, Welfare patterns, Vet visits and costs | Needs vet visits to give honest figures |
| 4 | The impact report with print, PDF and CSV | Built on phase 3's figures |
| 5 | Donations | Waits on the donation route with James |

Each phase is its own set of pull requests, reviewed and shipped before the next starts.

## 14. Open questions

1. **Standard sterilisation price.** Is there one price at the clinic Syros Cats use, or one per clinic? The spec assumes one standard price the team sets, and lets the form override it.
2. **Named areas.** Who draws the first outlines: Syros Cats, or us from the map's existing place list, with them correcting afterwards? The spec assumes we draft them and Syros Cats correct them.
3. **Threshold for "Not seen lately".** The spec uses 6 weeks. Syros Cats may know better for street cats on Syros.
4. **The impact report's smallest area.** The spec uses at least 5 cats before an area shows on its own. Is that enough to stop a funder working out where a small colony is?

## 15. What this spec does not do

- **No offline use of the dashboard.** The trapping plan can be printed or saved. The offline phone view is SYC-54.
- **No vet access** (SYC-24).
- **No response times, targets, assignments or rankings** of people.
- **No new public screens.**
- **No payment tool.** Donations are designed, not built.
- **No Greek or French** for team pages yet (SYC-291).
