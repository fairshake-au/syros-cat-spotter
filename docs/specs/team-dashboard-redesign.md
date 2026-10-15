# The team dashboard: finding cats, seeing the island, proving the work

**Feature spec · Cat Spotters (Syros)**
**Version:** 0.2, revised after adversarial review · 15 October 2026
**Covers:** the whole team dashboard at team.catspotters.com:
- its home;
- how cats are found;
- the island map;
- colonies and trapping rounds;
- vet visits;
- the reports Syros Cats use to run the work and show funders what it achieved.

It turns the dashboard parts of PRODUCT-SPEC §2.6 and §3 (items 9, 12 and 13) and of the proposal (§10–§13) into screens.

**Linear:**
- SYC-43: the dashboard.
- SYC-54: the volunteer colony view, offline.
- SYC-161 and SYC-2: coat colour.
- SYC-152: Matched by hand.
- SYC-59: duplicates.
- SYC-207 and SYC-394: other ways to build the dashboard.
- SYC-270, SYC-362, SYC-365 and SYC-366: fixes this spec builds on.
- SYC-288: our own island map pictures.
- SYC-395: the rest of SYC-362, handed to this spec (§15).
- SYC-24: vet access, parked.

**Evidence:** `docs/reviews/team-dashboard-ux-review-2026-10-15.md`.
**Review:** an adversarial review found 4 blockers, 13 major and 5 minor issues. Every finding is handled in this version, and the table at the end (§17) says where.
**Status:** **Approved by Samuel, 15 October 2026.**

### What this document owns, and what it borrows

| What | Owner |
|---|---|
| Records (cats, observations, sightings, colonies, feeding sites, welfare reports) | `cat-record-data-spine.md` |
| Capability names, and what a cat guardian may see | `roles-and-invites.md` §2.2 and §6. This spec adds rows to §6.2 (see §10.3). |
| Sign-in, the dashboard shell, the welfare queue's rules, the vet list | `team-access-and-welfare-queue.md` |
| Feeding-site privacy, site names, "who looked" | `feeding-sites-and-colonies.md` |
| Colour, markings, vaccination and health records; the Colour check list | `coat-markings-and-health.md` |
| **What this spec adds** | Home; the browsable Cats screen; Find from a photo; the island Map; the redesigned team cat page; colonies as trapping planners; vet visits; the Reports area; named areas; small photo versions; and the design rules every screen follows (§12). |

---

## 1. The short version

Syros Cats' office team (Jacky, Susan and the office volunteers) open the dashboard to answer four questions:

1. **What needs us today?** Reports to act on, sightings waiting for a match, cats to check, and cats not seen for a while.
2. **Which cat is this?** Nobody standing in front of a cat knows it's called Aegean Ziggy, or that it's SYR-0004. The team finds cats by how they look, where they live and what we know about them, or from a photo.
3. **Where are the cats, and where should we trap next?**
   - One map shows every cat on the island at the place it was last seen, marked by whether it's sterilised.
   - Each colony becomes a ready-made trapping plan: the cats still to do, where they're usually seen, and what it will cost at €50–60 a cat.
4. **How are we doing, and can we prove it?**
   - Sterilisation progress across the island and per colony.
   - Colony health.
   - Where nobody has looked yet.
   - Welfare patterns.
   - Vet spend.
   - A dated, exportable impact report for funders. It states its method and never exposes a single cat, colony or guardian.

The dashboard stays fast on a phone in a street with weak signal. A few screens get small pieces of interactivity: the Cats grid, the Map and the report charts. Every page still works if that interactivity fails to load.

## 2. Decisions already made (Samuel, 15 October 2026)

| # | Question | Decision |
|---|---|---|
| D1 | Who does the dashboard serve first? | **The office team.** Home is their overview. Cat guardians keep their own pages, extended where §10 says. |
| D2 | Which dashboards? | Home; Cat map; Browse cats by look and place; Sterilisation progress; Trapping round planner; Colony health; Impact report for funders; Coverage gaps and spotting activity; Welfare report statistics; Vet visits and costs; Donations. (Not chosen as dashboards: Matched by hand and duplicates, Data requests, App switches. They keep their own tickets, and Home links the existing lists, §4.) |
| D3 | How interactive? | **Light interactivity on the existing server-drawn dashboard.** A full rebuild as a new app is on record as SYC-394. |
| D4 | How are vet visits recorded? | **The team logs each visit on the cat's page.** |
| D5 | Donations? | **Designed now (§9.7), built last,** once the donation route with James is settled. |
| D6 | Welfare statistics? | **Patterns, not performance.** Never response times, targets or per-person figures. |
| D7 | Find a cat from a photo? | **Yes.** |
| D9 | Open map links | Samuel, 15 Oct 2026, in the SYC-362 plan: "map links for coordinates are fine for the team. the privacy considerations don't apply to Syros Cats users". On feeding sites: "Everywhere, sites included". These are outbound links only, for island-wide team members only (§3.2, §10.4). |
| D10 | SYC-362's unfinished work | "Hand all of it to the redesign" (Samuel, 15 Oct 2026). It's tracked as SYC-395 and placed in §15. |
| D8 | A vet visit versus a cat guardian's earlier "not sterilised" | **The visit overrules, visibly.** Logging a visit with Sterilised also marks any standing guardian "not sterilised" on that cat wrong, with the reason "vet visit on [date]". The change appears on the recent guardian changes list. This works the same way as the team's **Correct** on colour. |

## 3. How the dashboard is laid out

### 3.1 The menu

**Home · Cats · Map · Queue · Colonies · Reports · People**

- The menu names the team's jobs, not record types.
- **Feeding sites** move inside the Map (as a layer) and inside each colony. The Feeding sites page itself stays, reachable from both.
- **Work lists keep their pages,** and Home links to each one with a count (§4):
  - Probably sterilised (renamed "Ear clips to check", settling SYC-365);
  - Ask Syros Cats to match it;
  - Needs an OK;
  - Colour check (#191 gives it a menu entry. In this menu, it moves to Home);
  - Matched by hand (once SYC-152 exists).
- **People** shows only to those who can manage people, as now.
- **On a phone** the menu is one row you can slide sideways, with the current page underlined. Sign out sits at the end of the row. On a desktop it's a single bar with Sign out at the right.

### 3.2 Every page

- **The page title comes first.** "Signed in as …" and Sign out move into the menu bar. Today they sit under each title, which shipped in #184.
- **Places are shown as names, never numbers.** A place label is built from:
  - the **named area** (§3.3);
  - plus, where one exists and the viewer may see it, a feeding site's **public label**.

  A site's internal name is never used, because it usually contains a guardian's name ("Vaporia — Eleni's"). The result reads like "Kini" or "Kini, harbour steps".
- **"Open map" is the one tap to the exact spot (D9).** For island-wide team members, every place label carries an **Open map** link that opens the position in the phone's maps. It's built only by `lib/teamPages/position.ts`, and it appears only when the viewer can see the whole island (`visibleColonyIds(person) === null`). It never appears for cat guardians, never on an owner's home position, and never in anything public.
- **Empty pages explain themselves.** For example: "No colonies yet. A colony is a group of cats fed in the same place, usually by one cat guardian. Grouping cats into colonies lets you plan trapping rounds and see each colony's progress. Create the first one."
- **Every new screen has its error and empty states written down** (§13).
- **Lists load small pictures** (§11).

### 3.3 Named areas

Filters, place labels and coverage need one shared idea of "where".

- **What an area is.** Syros Cats keep a short list of **named areas**, each with a single centre point. The list starts with the map's existing places (Ermoupoli, Ano Syros, Vaporia, Kini, Galissas, Finikas, Posidonia, Azolimnos) and adds the other villages, such as Vari, Mega Gialos, Fabrika, Manna and Chroussa.
- **How a place gets its area.** A place belongs to **the area whose centre is nearest**. Nothing has to be drawn, it works without scripts, and every point on Syros falls into exactly one area.
- **Off the island.** A point more than 2 km from every centre, or off the island, is **"Off Syros"**. It's never counted in any figure. (The live queue already holds a test report from Arizona.)
- **Who can change the list.** The team adds, renames or moves an area centre on an "Areas" settings page. Every change goes in the history with who made it and when.
- **Versions.** Each change to the list makes a new **version**, and every report names the version it used. That way, moving a centre doesn't silently rewrite last year's figures.
- **First draft.** We draft the first list from the map's place list and the village names. Syros Cats correct it.

## 4. Home: what needs us today

Home is the first page after signing in. It reads top to bottom in order of urgency. A section only shows when it has something in it.

1. **Needs us now.**
   - Urgent welfare reports, then new ones. Each is one line: photo, place label, how long ago, and the first words of the report. Tap to open it in the Queue.
   - "Started but not sent" reports from the last 24 hours.
   - **Sightings waiting for a match** ("Ask Syros Cats to match it"), with a count. Spotters' points are held until the team acts.
   - **Needs an OK:** guardians' requests waiting for a team decision.
   - "Report an issue" reports (problems with photos or names), with a count.
2. **Cats to check.** A count for each list and the first few photos:
   - Ear clips to check;
   - the Colour check list, using that list's own rules from `coat-markings-and-health.md` §5.3;
   - Matched by hand, once SYC-152 exists.

   Each links to its list.
3. **Not seen lately.** Active street cats (§9.5) that have been seen at least once, but not for 6 weeks or more. Each shows the photo, name, colony, and "last seen 9 weeks ago, Galissas". This is a prompt to ask the guardian, never a claim that a cat has died.
4. **The headline.**
   - One large figure: **"142 street cats known on Syros"**, counted as defined in §9.5.
   - Under it, one bar split into four parts (confirmed sterilised, probably, not sterilised, not known), with each part's number beside it.
   - "As of 15 Oct 2026, 16:40" and a link to Sterilisation progress.
   - A smaller line for cats with homes and cats in care, counted separately.
5. **This month.** Four small figures, each with last month in brackets:
   - sightings;
   - new cats;
   - sterilisations, counted by the date of the operation;
   - vet spend (Syros Cats' money only, §8.4).

Home never shows response times, league tables of people, or anything that reads as someone falling behind (D6).

## 5. Cats: finding a cat without knowing its name

### 5.1 The Cats screen

The Cats screen opens on **every active cat**, most recently seen first. It's a grid of photo cards: two across on a phone, four to six on a desktop.

**Each card shows:**
- the photo (the small version);
- the name, with the SYR number in smaller text;
- colour chips, e.g. "Black and white";
- the colony, or "No colony";
- a **sterilised badge** with a word and a shape, never colour alone (§12.2):
  - **Sterilised** (filled circle);
  - **Probably** (half-filled), with "checked in person" added where a guardian checked;
  - **Not sterilised** (ring with a slash);
  - **Not known** (empty ring);
- "Last seen 3 days ago · Kini";
- a small tag where it applies: "Has a home", "In care", or "Not seen since Jun 2026".

**Filters.** On a desktop they sit in one row above the grid. On a phone, a single **"Filters (2)"** button opens a panel with every filter. The active filters show beneath it as chips with a × to remove each one. The name search box stays beside the button. The filters are:
- **Look:** the colour chips from SYC-161 (Black, White, Ginger, Grey, Tabby, Tortoiseshell or calico, Black and white, Not sure). You can pick more than one.
- **Where:** a named area or a colony.
- **Sterilised:** Sterilised, Probably, Not sterilised, or Not known.
- **Lives:** On the street, Has a home, In care, or No longer with us (which includes cats not seen for 3 years). The default is On the street, Has a home and In care.
- **Last seen:** This week, This month, 1–3 months, Over 3 months, or Never seen since first recorded.
- **Name or SYR number:** a search box, now just one filter among the others.

**How the filters behave:**
- With interactivity, the grid updates as filters change. Without it, the filters are an ordinary form with a "Show cats" button, and the results are the same.
- The page's web address carries the chosen filters, so a filtered view can be bookmarked or shared within the team. It holds only colour names, the area's **short key**, the colony's **number** (never its name), and the statuses. It never holds a position or a person's name.
- A count above the grid reads "38 cats match", with "Clear filters" beside it.
- The grid shows 48 cats at a time, with "Show more" below.

**Sort:** most recently seen (the default), newest to the records, or name A–Z.

**When nothing matches,** the page says "No cats match these filters", shows which filters are on, and offers "Clear filters".

### 5.2 Find from a photo

**Who and what it's for.** It's for the team only, and sits on the Cats screen as **"Find from a photo"**. The team chooses or takes a photo, for example one a resident sent on WhatsApp, and narrows the search before it runs.

**Narrowing.** The search compares the photo against a limited set of cats, so the team must say where to look:
- **Required:** a named area, or a colony.
- **Strongly suggested:** one or more colour chips.
- The page shows how many cats that leaves ("34 cats to compare").
- If more than 30 cats are left, it asks for a colour or a smaller area before it will run.

**How it compares.** It uses the matching model the app uses for sightings. The app's matching compares a photo with at most 10 nearby cats in one go, so Find from a photo works through the narrowed cats **in groups of up to 10** (at most 3 groups). The best few from all the groups are then compared again together in one final round, so their scores can be ranked against each other.

**What it shows.** The closest cats, best first, each beside the uploaded photo, with a plain word for how close it is:
- **Very likely:** the model's match score is 0.8 or higher;
- **Possible:** from 0.5 up to 0.8;
- **Unlikely:** below 0.5. These are folded away under "Show unlikely matches".

**What the page says plainly.** "This is less sure than the app's matching, because it compares more cats at once and has no exact position. Check the photos yourself." The team always decides; the dashboard never does.

**Afterwards.** From the results, the team can open a cat, or tie a welfare report to it when they came from the Queue. If nothing scores above Unlikely, the page says "No close match among these 34 cats" and offers to browse them as a grid.

**The photo.**
- Its location data and other hidden details are stripped before it's sent anywhere.
- It's sent to the same AI service the app already uses for matching, under the same terms.
- It isn't kept afterwards.
- This spec doesn't save it as a sighting. A sighting needs a phone behind it, and team-made sightings would be a separate change.

**Cost.**
- A search makes at most 4 AI requests (3 groups, plus the final comparison).
- Searches are capped at 20 per team member per day, and 100 a day across the team. The page shows the cap once it's reached.
- The cap is set after measuring the real cost per search in the first week.

**When it fails.** If the AI service is down or returns something unreadable, the page says "Matching isn't working right now. Try again in a few minutes, or browse this area's cats." It links to the grid already filtered.

## 6. The Map: every cat on the island

### 6.1 What the team sees

- **Each active cat appears once, at the place it was last seen,** as a dot. The dot's shape and shade are the sterilised badge's (§12.2), and it has a light ring and a thin dark outline so it stays visible on land and on sea.
- **Zoomed out, nearby cats merge into a group** showing a count ("14"). The group's ring is split by sterilised status. Tap the group to zoom in.
- **Layers** you can switch on and off:
  - Cats (on by default);
  - Feeding sites;
  - Colonies, each shown at its feeding sites with its name;
  - Welfare reports from the last 30 days;
  - Not looked at yet (§9.3).
- **The Cats screen's filters apply here too.** One switch above the content changes between Grid and Map, and the filters stay as they are.
- **The map has a list twin.** The same filtered cats are one switch away as the grid, for anyone who can't use a map.

### 6.2 Tapping a cat

A tap opens a card over the map on desktop, or a sheet from the bottom on a phone. It shows:
- the photo, name, badge, colony and last seen;
- **"Show where else it's been seen"**, which draws the cat's other sightings as small numbered dots joined in time order, each with its date;
- **"Open the cat"**.

### 6.3 Moving around, and the map pictures

- **With interactivity:** drag, pinch or scroll to zoom, and "Go to" an area.
- **Without it:** the zoom, pan and "Go to" buttons that work today.

**Map pictures always come through our own server, and positions never appear in a web address.** The draggable map needs one picture per map square, but today's route serves 2×2 composites behind tokens. So the draggable map uses a **new map-picture request**:
- the page asks our server, in a signed-in POST, for the squares it needs;
- the server answers with a short-lived token for each square;
- the map then fetches each square by its token alone.

A small map layer of our own does this, in place of the map library's usual tile addresses. The server doesn't record which squares were asked for (SYC-255). It allows at most 300 squares per person per 10 minutes, to protect OpenStreetMap's goodwill and our 200 MB picture cache. If SYC-288 (our own island map pictures) arrives first, the map uses that instead.

**When map pictures fail,** the map shows a plain grey island outline with the dots still on it, and says "Map pictures aren't loading. The cats are still shown." If the map script itself fails, the page falls back to the button map.

## 7. The team cat page

The team cat page answers "who is this and what do we know" in the first screenful. Then it lets the team act. Then it shows the evidence. (Guardians keep their own cat page; see §10.)

### 7.1 Summary (top)

- **Photo,** with any other photos as a thin strip below it.
- **Name and SYR number.**
- **A row of plain facts**, each a label and a value:
  - **Sterilised:**
    - "Yes, confirmed by Syros Cats, 13 Aug 2026";
    - "Probably: clipped ear seen in 3 photos";
    - "Probably, checked in person by the cat guardian";
    - "No, Syros Cats' records";
    - "Not known".
  - **Lives:** "On the street", "Has a home", "In care", or "No longer with us".
    - A cat not seen for a long time adds "Not seen since Jun 2026" (always month and year).
  - **Colour:** chips, plus "read from the photo" or "set by Maria". Tapping it goes to the Appearance section (#191), which stays in the evidence area below.
  - **Colony:** the name, with a link, or "No colony".
  - **Last seen:** "3 days ago · Kini, harbour steps".
  - **Vaccinated** and **Health note:** where recorded (team only).

  Where a fact is uncertain, the words say so ("Probably…", "Not known"). There's no separate confidence tag that could contradict the value.
- **A small map** of the cat's sightings, numbered in time order. Tap it to open the full Map focused on this cat.
- **What the public sees:** one line, in smaller text, under the facts.

### 7.2 Actions

A short set of buttons:
- **Log a vet visit** (§8): full width, the main action.
- **Update this cat:** opens the existing forms one at a time (where the cat lives, whether sterilised, colour, colony, rename). It keeps the "Are you sure?" page before an owner is removed (#192).
- **Add a note.**

The explanation of how changes work moves into a short note you can open, keeping the wording that shipped in #192: "Every change is saved with your name. Nothing is deleted. A change with an older date won't override a newer one. To undo a change, use Mark wrong on it in the history below."

The page keeps #192's words throughout: "What we know about this cat", "Since", "Why we think so", "Says otherwise", "Date it happened", "History", and "change" rather than "statement". This spec changes two things on the cat page. The "not known / likely / confirmed" tags are replaced by the plain-worded values in §7.1, so a value can never contradict its own tag. And the side-by-side desktop layout from #184 becomes the summary-and-actions layout below.

### 7.3 Evidence (folded, below)

- **Sightings:** a compact list of date, place label and thumbnail. "Make a feeding site here" and "Show on the map" move into a small menu on each sighting.
- **Vet visits:** each with date, what was done, clinic and cost.
- **History:** the full record, newest first, as now. It keeps the newest 20 with "Show all N" (shipped in #184), with one change. Routine sightings are grouped into one line, such as "Seen 19 times by spotters between 29 Jul and 24 Sep, looking well". Tap the line to expand it. Statements that change something (status, colony, colour, name, vet visits, notes) are never grouped.

On a desktop, the summary and actions sit side by side above the evidence, and the evidence uses the full width.

## 8. Vet visits

### 8.1 Who logs them

**The team only** (D4). Cat guardians don't log vet visits. They keep their existing "Say whether sterilised" answer, which shows as "checked in person". Any visit a guardian arranges is logged by the team. Vets get no access (SYC-24 stays parked).

### 8.2 What a visit records

- **Date of the visit.** The team may enter a past date, as they can for any team statement.
- **What was done** (one or more):
  - **Sterilised**;
  - **Vaccinated**, with the vaccine picker from `coat-markings-and-health.md` §6.3 (rabies, cat flu and enteritis, or another named vaccine);
  - **Treated**, with a short note;
  - **Checked only**.
- **Clinic:** chosen from the vet list in `team-access-and-welfare-queue.md` §5.7, which becomes the one clinic list. There's no second list.
- **Cost in euros.** When Sterilised is ticked, it's pre-filled with the standard sterilisation price. The team sets that price (typically €50–60) and can change it on the form.
- **Paid by:** Syros Cats; a donation given for this cat; or the owner.
- **Note** (optional).

### 8.3 What it writes, and how it's undone

**Writing a visit.** One save writes, together:
- one `vet_visit` record with the fields above;
- a `sterilised` statement, if Sterilised was ticked. It uses the existing `{ sterilised: true, date, clinic, costEur }` value, so nothing new is invented for it;
- a `vaccinated` statement, if Vaccinated was ticked.

Each statement it creates points back to the visit.

**Undoing a visit.** Marking the visit wrong marks every statement it created wrong too, in one step and with one reason. The cat page and the reports therefore always agree.

**When a guardian disagrees (D8).** Under Decision G, a cat guardian's standing "not sterilised" on the same cat would outrank a team statement. So the same save also marks that guardian statement wrong, with the reason "vet visit on 13 Aug 2026". It appears on the recent guardian changes list, so nobody is overruled silently. This mirrors the team's **Correct** on colour (DECISIONS, 13 Oct 2026). Undoing the visit restores the guardian's statement.

**Sterilisations recorded without a visit.** "Update this cat → whether sterilised" still works. The vet report counts those as "sterilised, no cost recorded".

**Proof the cat was alive.** A vet visit also counts as proof the cat was alive on that date. This amends the data spine's list in §3.4.

### 8.4 Money

- **Spend and cost per sterilisation count only Syros Cats' money:** visits "paid by Syros Cats" and "a donation for this cat".
- Owner-paid visits are listed, but never added into spend.
- Cost and "paid by" are seen only by the team.

### 8.5 Logging a whole trapping round

The colony's trapping planner (§9.2) offers **"Log this round's vet visits"**.

- **The form.** One form lists the colony's cats, each with a tick box. They share a date, a clinic and a price, but each cat can override what was done, the cost and who paid.
- **Cats from outside the colony.** "Add a cat not on this list" lets the team pick any cat, using the Cats filters, or create a new one for a cat trapped on the round that isn't in the records yet.
- **What gets saved.** Each ticked cat gets its own visit, saved as in §8.3.

## 9. Colonies and Reports

### 9.1 Colonies list

Each colony is a card showing:
- its name and cat guardian;
- a **progress bar** of its active street cats, split four ways, with numbers and "% confirmed sterilised";
- the number of cats;
- the date of the latest sighting;
- flags, each a word and an icon:
  - **Growing:** at least 3 cats were added to the records for the first time in this colony in the last 90 days, more than in the 90 days before. Cats moved in from elsewhere don't count.
  - **Kittens reported:** a litter report in the last 60 days, either tied to a cat in this colony or within 300 m of one of its feeding sites.
  - **No guardian.**
  - **Not visited lately:** no sighting of any of its cats in 30 days.

Sort by name, by fewest confirmed sterilised, or by latest activity. A **Map** switch shows the colonies at their feeding sites on the island map.

### 9.2 A colony: the trapping planner

The colony page leads with what a trapping round needs:

1. **To do: the active street cats here that aren't known to be sterilised** (§9.5).
   - "Not sterilised" cats come first, then "Not known", then "Probably". Within each group, most recently seen comes first, because those cats are most likely to turn up.
   - Every cat is listed. The list is never cut short.
   - Each cat shows: photo, name, colour chips, the place label where it's usually seen (its feeding site's public label, or its area), last seen, and "ear clip seen" where that applies.
2. **The estimate:** "N cats × €55 = €X", using the standard price from §8.2. The price is shown.
3. **The colony's feeding sites,** on a small map.
4. **A printable plan.** A clean one-page version for the round:
   - it shows photos, names, colours and place labels;
   - it has no map coordinates and no feeding sites' internal names;
   - it's for the team only. Guardians' offline view is SYC-54's, with its 72-hour limit.
5. **Log this round's vet visits** (§8.5).
6. **Done:** the sterilised cats, folded away.
7. **The guardian, notes and history,** as now.

"Take out of this colony" moves into each cat's own small menu, so a risky action isn't repeated all the way down the page.

### 9.3 Reports

**The Reports area** lists seven reports. Each opens on its own page, with a time range at the top (this month, last 3 months, this year, all time, or dates you choose).

**How dates work in every report.**
- An event (a sterilisation, a new cat, a sighting) counts in the period when it happened. For a sterilisation, that's the date of the operation.
- The report says so: "Counted by the date of the operation".
- A record entered late can therefore change an earlier month. The page shows "Figures change as records are corrected".

**The seven reports:**

1. **Sterilisation progress.**
   - The island headline first, as on Home.
   - A line over time of confirmed sterilised and of all street cats known: two lines on one scale, labelled at their ends.
   - Each past point is worked out from the records as they stood on that date.
   - Then every colony as a row with its bar, sorted by fewest confirmed sterilised, so the next trapping target is at the top.
2. **Colony health.** One table, one row per colony: cats now; change over 90 days; kittens reported; not seen lately; guardian yes or no; last visit. Every column can be sorted, and the flags match the Colonies list.
3. **Coverage and spotting.**
   - A map of the island split into squares of about 250 m. Squares with a sighting in the period are lightly shaded. Squares within 500 m of a named-area centre with no sighting are marked "Not looked at yet".
   - Beside it: sightings per week, as one series of bars, and the number of spotters who sent at least one sighting (a count only; nobody is named or ranked).
   - The point is to show where to send spotters next.
4. **Welfare patterns.**
   - Welfare reports per week as bars, split into **Urgent**, **Needs attention** and **Litter**. Each is labelled, and each keeps its colour on every chart.
   - "Started, not sent" reports are counted separately.
   - A table of the named areas with the most reports in the period.
   - Welfare reports as a map layer.
   - "Report an issue" reports are about photos and names, not cats' welfare. They get their own small count, "Problems reported with photos or names", and stay off the welfare chart and map.
   - No response times, no "time open", and no per-person figures (D6).
5. **Vet visits and costs.**
   - Visits and Syros Cats' spend per month.
   - Spend split by what was done.
   - Cost per sterilisation: average and range.
   - Sterilisations with no cost recorded, counted separately.
   - A table of visits (cat, date, clinic, what was done, cost, paid by), which can be exported for the accounts.
6. **Impact report for funders** (§9.4).
7. **Donations** (§9.7).

**Tables and downloads.**
- Every chart has a **"Show as table"** switch, and every table can be downloaded as a spreadsheet file (CSV).
- Downloads are protected against spreadsheet formulas: any cell starting with `=`, `+`, `-` or `@` is made safe.
- Each download is recorded with who, which report and when, but not its contents.

### 9.4 The impact report

A single page built to be printed or saved as a PDF by the browser, or downloaded as CSV. It follows the proposal's §11.

**The headline,** with confidence: "142 street cats known on Syros. 89 confirmed sterilised, 23 probably sterilised, 12 known not sterilised, 18 not known." It's dated to the minute and says who produced it: "Syros Cats, from Cat Spotters records".

**Progress over the period:**
- new cats recorded;
- sterilisations;
- the number of colonies with at least one sterilisation.

**Figures by area,** at named-area level only, and only for areas with at least 5 cats. Smaller areas fold into "Elsewhere on Syros".

**Milestones** reached in the period, worded as counts and never naming a colony: "100th cat recorded", "3 colonies fully sterilised this year".

**Vaccinations:** "N cats vaccinated this year", hidden when the number is below 5.

**Vet spend** in the period, with the cost per sterilisation. This is Syros Cats' money only.

**"How these figures are worked out":** a short, plain explanation covering:
- what confirmed, probably, not sterilised and not known mean;
- who counts as a street cat (§9.5), and that cats with homes and cats in care aren't included;
- that the same cat recorded twice and not yet merged may be counted twice;
- that figures can change as records are corrected;
- the named-areas version used.

**Every report is reproducible.** Each one has an "as of" moment. Running it again for the same "as of" moment uses only records entered by then, so it gives the same figures as the copy a funder already holds.

**The report never shows:**
- a single cat's photo, name or position;
- a colony's name;
- a feeding site;
- a guardian's or team member's name;
- any position finer than a named area.

"Donors see an overall count, never a cat" (DECISIONS Part 2n), and "Nothing from colonies is public" (Part 2o).

### 9.5 Who is counted

Every figure, list and report uses these definitions:

| Term | Means |
|---|---|
| **Street cat** | Life status "on the street". Not presumed deceased. Not the merged-away half of a duplicate. |
| **Active cat** | A street cat, a cat with a home, or a cat in care. Never "no longer with us" or presumed deceased. |
| **Headline count, progress and impact figures** | Street cats only. Cats with homes and in care are shown in a separate line. |
| **Trapping "To do"** | Street cats in the colony whose sterilisation is Not sterilised, Not known, or Probably. Never cats with homes, in care, or no longer with us. |
| **Not seen lately** | Street cats with at least one matched sighting, whose last sighting is 6 or more weeks ago. Never cats only ever seen in an import. |

"Presumed deceased" is the data spine's existing rule, and this spec doesn't change it. The dashboard words it as "Not seen since [month year]". It's never shown to the public as a death.

### 9.6 Figures are worked out from the records

**On every request.** Every number is worked out from the records each time it's asked for, using the same rules as the cat pages. At Syros's scale (hundreds of cats, as the data spine says), that means loading and working out every cat on each request. That's fine, and each page records how long it took.

**Cache only if needed.** If a page grows slow, a short-lived cache may be added. It must be kept separately for each kind of viewer and each set of filters, and it's cleared whenever any record is written. A guardian can then never see figures worked out for the team, and the reverse.

**Labelled with a time.** A page always says when its figures were worked out.

### 9.7 Donations (designed now, built last)

Once the donation route with James is settled, a Donations report will show:
- money received per month, by source;
- Syros Cats' vet spend per month (§8.4);
- cats sterilised with money given for that cat;
- a simple meter towards a fundraising goal the team sets, worded as "€X raised, enough for about N sterilisations at €55".

Until then, the Reports list shows Donations as "Coming once donations are set up". The data source will be decided with James. This spec fixes nothing about payment tools.

## 10. Privacy and who sees what

### 10.1 The team

The team sees everything on these screens island-wide, as now.

### 10.2 Cat guardians

Cat guardians keep their own pages (SYC-53 PR 1.3: My page and My colonies). Their own cat page is built from its own list of fields, not from the team's cat page with a filter on it (`roles-and-invites.md` §2.2). This spec gives guardians only the following:

| Screen | What a guardian gets |
|---|---|
| Home | No. They keep My page. |
| Cats grid | Their own colonies' cats only. Cards show the photo, name, colour, badge (including "checked in person"), colony and last-seen **date**. Filters: Look, Sterilised, Last seen. No area filter. |
| Map | Their own colonies' cats only, each at its **discovery position**. No last-sighting position, no sightings trail, no welfare layer, no coverage layer. Their own colonies' feeding sites, as the feeding-sites spec already allows. |
| Find from a photo | No. Matching anywhere stays reserved (`match_cat_anywhere`). |
| Team cat page | No. Their own cat page gains the plain facts row (§7.1) where its fields allow. Edits by team members show as "Syros Cats". |
| Colonies list and trapping planner | Their own colonies only. The to-do list shows place labels from the cat's feeding site, not sighting positions. No estimate, no cost, no printable plan, no round logging. |
| Reports | Sterilisation progress and Colony health, for their own colonies only. The "Kittens reported" flag counts only litter reports they're allowed to read: reports tied to a cat in their colonies. No other reports. No downloads. |
| Vet visits | They see that a visit happened and what was done (except vaccination and costs). They can't log one. |

Every new route gets a route-walk test case for a guardian, as `roles-and-invites.md` §6.4 requires.

### 10.3 New capabilities

These are added to `roles-and-invites.md` §6.2 before anything is built:

| Capability | Kind | Who |
|---|---|---|
| `log_vet_visit` | island | team |
| `view_vet_costs` | island | team |
| `find_cat_from_photo` | island | team |
| `view_reports` | placed | team island-wide; guardians for their colonies, limited as in §10.2 |
| `view_impact_report` | island | team |
| `export_report` | island | team |
| `edit_named_areas` | island | team |
| `edit_vet_settings` (standard price; the vet list stays as team-access §5.7 sets it) | island | team |

Changes to named areas and to the standard price are kept in the same add-only history as site and colony changes.

### 10.4 Everyone else

- **The public** sees nothing new. Nothing in this spec changes what the app shows spotters.
- **No position, and no person's or colony's name, ever appears in one of our own web addresses.** That covers filters, the map, map pictures and shared links. The one exception is D9's outbound **Open map** link. It carries a position to the phone's maps app, only for island-wide team members, and is built only by `position.ts`. Guardian-view tests fail if any map company's address appears on a guardian's page. Cat positions reach the browser only inside a signed-in page, or a signed-in request to our own server.
- **Downloaded files** contain only what the page shows to that viewer. They never include a feeding site's internal name or a guardian's name unless the team chooses to add them. Only the impact report is meant for outside eyes, and it follows §9.4's limits.

## 11. Small photo versions

Lists and grids must never load full-size photos. Photos are stored as text in the database today, so small versions are a piece of work in their own right:

- **The table.** A new `photo_variants` table holds a small version (about 160px wide) and a medium one (about 640px wide) of each photo.
- **When they're made.** On first request, then kept. There's no big up-front backfill. A batched, resumable fill can run later if first loads feel slow.
- **Who can see them.** They're served through the same visibility-checked route as the photo itself. A hidden photo's versions are hidden too.
- **Removal.** Permanently removing a photo removes its versions in the same step.
- **Location data.** Every version is checked to be free of location data, with a test for each size.
- **Retention.** When the 12-month rule shrinks a photo, its versions are remade from the shrunk copy.
- **Report photos** are stored separately and are treated the same way.

## 12. Design rules

Every screen in this spec follows these rules, and the design review checks against them.

### 12.1 Look and feel

- **Keep the dashboard's own look:**
  - warm off-white background (`#f6f4ef`);
  - dark ink (`#1d1d1b`);
  - teal (`#0b5c6b`) for links and main buttons;
  - the system font.

  Red stays reserved for risky actions and urgent reports.
- **One main action per screen,** in the solid teal button. Everything else is a plain or outlined button.
- **Cards for things, rows for lists.** A cat, a colony or a report is a card. Sightings and history are rows.
- **Phone first.**
  - Every screen is designed at 390px first, then laid out wider from 1000px.
  - Tap targets are at least 44px.
  - Nothing scrolls sideways except the menu.
- **Text size and wording:**
  - No text below 12px, including on cards and chart labels.
  - The same thing always gets the same words, e.g. always "Last seen 3 days ago".
  - Words are plain English for a volunteer, never database words: "What we know", not "Records say".
  - Team pages stay English only (Decision 12).

### 12.2 Sterilisation marks

Sterilisation status appears on badges, map dots, bars and charts. It always uses the same four marks:

| State | Shape | Colour |
|---|---|---|
| Sterilised | filled circle | deep teal `#0a4d59` |
| Probably | half-filled circle | mid teal `#2f7884` |
| Not known | empty ring | light teal `#6a949b` |
| Not sterilised | ring with a slash | amber `#a6540a` |

**Checks on these colours (15 Oct 2026):**
- The three teal shades passed the palette checker as an ordered scale: they read light to dark, with visible steps.
- Against the page background, the light teal measures 3.02:1, and it measures 3.32:1 against white cards. Both meet WCAG's 3:1 minimum for shapes.
- Amber measures 4.9:1 against the page.
- No light shade reaches 3:1 against both the map's land and its sea. So **every map dot also gets a 2px light ring and a 1px dark outline**, and the shape carries the meaning on its own.

**What the marks mean, and nothing else:**
- These four marks mean sterilisation status, and nothing else.
- A total that isn't a status, such as "all street cats known" on the progress chart, is drawn in neutral grey ink.
- Amber here is the "needs doing" state, and always comes with its word and its slashed shape.

### 12.3 Numbers and charts

These rules follow the data-visualisation method.

**Choose the simplest form that does the job:**
- A single number is a large figure, not a chart.
- A share of a whole (the four sterilisation states) is **one horizontal bar** split into parts, with the numbers written beside it. It's never a pie or a donut.
- Change over time is a **line**, or **bars** for counts per week.
- Comparing colonies is **a sorted list of bars**.
- Anything with more than about seven groups is a table.

**Never two scales on one chart.** Two measures get two charts.

**Colour has one job per chart:**
- Welfare kinds have fixed colours, in a fixed order.
- A kind keeps its colour on every chart, and filtering never repaints it.
- Red and amber always come with a word and an icon.

**Never colour alone.** Every coloured part has a label, a legend or a shape that says the same thing. Charts must read for someone who is colour-blind, and when printed in black and white.

**Every percentage says what it counts,** e.g. "% confirmed sterilised".

**Quiet chrome:**
- thin bars with rounded ends;
- 2px lines;
- faint, solid grid lines, never dashed;
- a small gap between bar segments;
- no number on every point. Label the ends, the extremes, and the one that matters.

**Every chart has a "Show as table" view,** and a tooltip on tap or hover with the exact numbers and dates.

**Every figure says when it was worked out** and what period it covers.

### 12.4 The map

- **Feeding sites are squares, never circles, and never teal.** Circles mean cats, and teal means sterilisation status. Public sites are filled dark-ink squares, private sites are dark-ink outlined squares, and retired sites are dashed grey squares (shown only when asked for). The key beside the map shows all of them.
- **On a phone, the Feeding sites view keeps SYC-362's aim:** what matters (the list, or the map with its key) sits near the top, and pan and "Go to" come after.

- **A quiet base map.** It's light and low-colour, so the dots stand out.
- **Dots** are at least 10px, with the ring and outline from §12.2. Tap targets are at least 44px even where the dot is smaller.
- **The legend** sits small in the top-right corner, using the same shapes as the badges. It can be folded away, and it never covers the sheet that opens when you tap a cat.

### 12.5 Accessibility

- SYC-366's basics: a skip link, a labelled menu, and a visible focus outline.
- Text contrast of at least 4.5:1. Shapes and chart marks of at least 3:1.
- Every photo has a short description: "Photo of Mavros, black and white".
- Everything that works with a tap also works with a keyboard.

## 13. Errors and empty states

| Screen | Empty | Error |
|---|---|---|
| Home | "Nothing needs you right now." The headline and This month still show. | If a figure can't be worked out: "This figure isn't available right now", and the rest of Home still shows. |
| Cats | No cats: "No cats recorded yet. Cats appear here once spotters send sightings." No match: §5.1. | — |
| Find from a photo | No close match: §5.2. | AI service down or unreadable: §5.2. Over the daily cap: "You've used today's 20 searches. They reset at midnight." |
| Map | No cats match: the map shows, with "No cats match these filters" and "Clear filters". | Map pictures or script fail: §6.3. |
| Colony planner | No to-do: "Every street cat here is sterilised." | — |
| Reports | No data in the period: "Nothing recorded in this period", with the range shown and a link to "All time". | — |
| Vet visit form | — | A missing date or "what was done" is named next to the field. A save that fails keeps everything typed. |

## 14. How it's built (outline for the plan)

This is a guide for the implementation plan, not a design in itself.

**Same server, same pages.** Every screen is a server-drawn page in `artifacts/api-server`, using the shared layout and words.

**A little script, from our own server.** Interactivity is added only to the Cats grid, the Map and the report charts, and comes only from our own server, never from an outside website.

**Security rules (DECISIONS Part 2k is amended):**
- Today's strict rule stays the default for every page.
- Only the Cats, Map, Reports and Find-from-a-photo pages get a wider, page-specific rule:
  - `script-src 'self'`;
  - `style-src 'self' 'unsafe-inline'`;
  - `connect-src 'self'`;
  - `img-src 'self' blob:`.
- A test checks that every other page still sends the strict rule.
- The tests that guard positions and names in web addresses are extended, not loosened.

**The map.**
- It uses an open-source map library (Leaflet), kept on our own server.
- A small custom layer fetches map pictures through the token request in §6.3.
- Cat positions come from a signed-in POST, never from the address.

**Charts** are drawn by the server as simple pictures (SVG), with the table beside them. A small script adds hover tooltips.

**The cat list** works out every cat per request (§9.6), then filters, sorts and pages them.

**Named areas** are a small new record (key, name, centre, version), with a history of changes.

**Vet visits** are a new kind of record, `vet_visit`. They're saved and undone together with the statements they create (§8.3).

**Small photo versions:** §11.

## 15. Build order

| Phase | What ships | Why |
|---|---|---|
| 0 | From SYC-395: an "Are you sure?" page before Retire this site (using `confirm.ts` and `sure.*` words); D9's Open map links for island-wide team members, with the guard and tests swapped (replace `noMapLinks.source.test.ts`, allow-list `position.guard`, add guardian-view tests, remove the queue's near-site rule) | Small, already designed and approved in the SYC-362 plan, and independent of the rest. **Builds on SYC-209 PR 4.1 (#194) once it merges.** That PR makes the Feeding sites, site, Colonies and colony pages shared with cat guardians. So the Open map gate is on the viewer, not the page: `isIslandWide(person)` from `lib/guardianView.ts`. Each shared page also gets a guardian-view test that fails on any map company's address, plus a probe that forces the gate true and expects the test to fail. No new reader may skip the colony filter (`guardianView.source.test.ts`). The Feeding sites map keeps starting on a whole pixel (`.mappage`). |
| 1 | Named areas; small photo versions; the Cats screen with filters and grid; the team cat page summary; the Map with cats, the sightings trail, and feeding sites as a square-marker layer (SYC-395 item 3) | Fixes the two problems Samuel named: "you must know its name", and "show me all cats on a map" |
| 2 | Home (with every work list linked); Colonies list with progress and flags; the trapping planner; Find from a photo | The office's daily view, and the trapping rounds |
| 3 | Vet visits (single and round); the Reports: Sterilisation progress, Colony health, Coverage and spotting, Welfare patterns, Vet visits and costs | Reports need vet visits to give honest figures |
| 4 | The impact report with print, PDF and CSV, reproducible "as of" | Built on phase 3's figures |
| 5 | Donations | Waits on the donation route with James |
| Alongside | The guardian additions in §10.2, each with its route-walk tests | Shipped with the phase that builds the screen |

Each phase is its own set of pull requests, reviewed and shipped before the next starts.

## 16. Questions still open

**Decided:** D8, when a vet visit and a cat guardian disagree (§8.3).

**Questions for Syros Cats** (they don't block approval; the spec's assumptions stand until answered):
1. **Standard sterilisation price.** Is there one price at the clinic Syros Cats use, or one per clinic? The spec assumes one standard price, which the team sets and can override per visit.
2. **The named-area list.** We draft it. Syros Cats correct it.
3. **The "Not seen lately" threshold.** The spec uses 6 weeks. Syros Cats may know better for street cats on Syros.
4. **The impact report's smallest area.** The spec shows an area only with at least 5 cats. Is that enough?

## 17. How the adversarial review was handled

| # | Finding | Handled in |
|---|---|---|
| 1 | Guardians would see per-sighting positions, team names and reports they mustn't | §10.2 table: discovery positions only, "Syros Cats" attribution, no welfare layer, limited Kittens flag, no Find from a photo |
| 2 | Place labels from site names leak private sites and guardians' names | §3.2: labels from named areas and public labels only; §10.4 downloads |
| 3 | Impact report names colonies | §9.4: milestones as counts, never a colony name |
| 4 | Find from a photo can't simply reuse matching | §5.2: required narrowing, groups of 10 plus a final round, thresholds, "less sure" wording, cost cap |
| 5 | A vet visit doesn't beat a guardian's answer | D8 (Samuel, 15 Oct): the visit overrules, visibly (§8.3) |
| 6 | Guardian vet visits break vaccination and date rules | §8.1: team only; §8.2: vaccine picker |
| 7 | Overlapping records; undoing leaves orphans | §8.3: one save, reuses the `sterilised` value, undo together |
| 8 | Who is counted is undefined | §9.5 table |
| 9 | "Not sterilised" and "checked in person" were missing | §5.1, §7.1, §12.2: four states |
| 10 | Dates of figures undefined; Growing and Kittens misfire | §9.3 date rule; §9.4 reproducible "as of"; §9.1 new definitions |
| 11 | Draggable map vs map-picture tokens; security rule | §6.3 token request; §14 page-specific rule and tests |
| 12 | Area outlines need drawing; coverage needs road data | §3.3 nearest centre, versions, "Off Syros"; §9.3 coverage near centres |
| 13 | Cat list, cache and filters conflict | §9.6: work out per request; any cache kept per viewer and cleared on write |
| 14 | Photo versions are a project | §11 |
| 15 | No capabilities, owner or history | §10.3; one clinic list (§8.2) |
| 16 | Printed plans and CSVs | §9.2 team-only plan with no coordinates; §9.3 formula-safe, recorded downloads |
| 17 | Welfare "kinds" don't exist | §9.3 (4): Urgent / Needs attention / Litter; content reports kept apart |
| 18 | Menu lost the work lists | §3.1 and §4 |
| 19 | Light teal under 3:1 | §12.2: new shades, outline on map dots |
| 20 | "Save as a sighting"; colony names in addresses | §5.2 dropped; §5.1 numbers and keys only |
| 21 | Lives filter missing states; dates without the year | §5.1, §7.1 |
| 22 | Whose money counts | §8.4 |
| 23 | Round form, proof of life, vaccination count, error states | §8.5, §8.3, §9.4, §13 |

## 18. What this spec does not do

- **No offline use of the dashboard.** The team can print a trapping plan. Guardians' offline view is SYC-54.
- **No vet access** (SYC-24).
- **No response times, targets, assignments or rankings** of people.
- **No new public screens.**
- **No payment tool.** Donations are designed, not built.
- **No team-made sightings.**
- **No Greek or French** on team pages yet (SYC-291).
