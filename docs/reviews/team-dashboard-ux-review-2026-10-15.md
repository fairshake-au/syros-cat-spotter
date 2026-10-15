# Team dashboard UX review

**Date:** 15 October 2026
**Reviewed by:** Claude, for Samuel
**Feeds:** `docs/specs/team-dashboard-redesign.md`

## How this was checked

- **The live site, team.catspotters.com,** signed in as Samuel in the browser pane, at desktop width and at 375px. The live build was `2d6e643` according to `/api/healthz` on 15 Oct 2026.
- **Main as merged on 15 Oct (`06e65749`).** Every team page was rendered locally with made-up data and screenshotted at 390px and 1280px. That covered 20 page variants: queue, cats (empty, results, no result, tie mode), cat page (rich, read-only, sparse), colonies, colony, add cats, sites with the map, site, new site, Probably sterilised, People, roles, and welcome.

Where the two differ, this review says so.

## Update, later on 15 Oct

- The live build moved to `118bc03` at 16:23 UTC, which includes the People screen. Finding 1 below describes the build `2d6e643` that was reviewed.
- "Which cat: This is a cat we know" is already fixed on main as "Match to a known cat" (#184).
- #192 (SYC-362 part 2a) changed the cat page's wording on main. The redesign spec keeps that wording.

## Headline findings

1. **The live site is behind main.** The live build has no People screen (`/api/team/people` returns "Not found"), and its phone menu wraps onto two lines, which main already fixes (SYC-219). Main needs pulling and publishing in Replit.
2. **There is no overview anywhere.** You land on the Welfare queue. Nothing answers "how are we doing?" or "what needs us today?".
3. **Cats can only be found by name or SYR number.** The Cats page is blank until you type. There's no browsing, no filters, no sort and no map. Nobody standing in front of a cat knows its name, so the Cats page fails at its main job.
4. **There is no map of cats.** The only map shows feeding sites. A cat's sightings appear as 14-decimal-place coordinates.

## Findings by screen

### Everywhere

- **The menu is organised around record types, not the team's jobs.** It reads Queue, Cats, Colonies, Feeding sites, Probably sterilised.
- **"Signed in as …" sits under every page title,** using up the top of a phone screen on every page.
- **Locations are raw numbers.** For example `37.44142858244657, 24.94566362989771` on the cat page, and `37.28745, -109.54176` in the queue. There's no place name and no small map.
- **Empty pages don't guide.** "There are no colonies yet" says nothing about what a colony is for, or why you'd create one. Live has 0 colonies and 0 feeding sites.
- **Thumbnails load the full photo.** The 72px Cats thumbnails fetch originals up to 1536px wide, which is slow on island mobile data.

### Cats (search)

- It's blank until you type, as above.
- Each result says "Lives on the street · Not known yet". "Not known yet" is the sterilisation status, but nothing labels it.
- Results show no colour, colony or last-seen information. Choosing between two similar cats means opening each one.

### Cat page

- **"Sterilised… As of 1 Jan 1970"** appears on every cat with no sterilisation record. This is already SYC-270.
- **There's no at-a-glance summary.** To answer "sterilised? colony? last seen? what does it look like?" you have to read through "What the public sees", then "What the records say" with its sub-blocks.
- **"Lives on the street" sits next to a "not known" tag,** which reads as a contradiction (the tag is the confidence level).
- **The wording is technical:** "Records say", "Based on", "What has been said", and "The statement with the latest 'true on' date decides".
- **History is swamped by routine sightings.** On a well-seen cat, about 20 of 26 rows are "Spotter saw Mavros near the harbour steps, looking well".
- **Every sighting carries two full-width buttons,** "Make a feeding site here" and "Show on our map", so seven sightings means fourteen buttons.
- **Colour and markings show only as history lines.** No summary shows the cat's colour.
- **At 1280px,** the right-hand "Correct the record" column is short while the left runs long, and below them sightings and history stretch across mostly empty full-width cards.

### Welfare queue

- **Every card carries the full set of controls:** four state buttons, the reporter-email line and the team note. Four open reports make about 4,400px of scrolling at 390px.
- **"Where" is a pair of coordinates** with an "Open map" link. There's no place name.
- **"Which cat: This is a cat we know"** is unclear about what it does (it opens Cats in tie mode).
- **"Unchecked (Cloudflare was unreachable) (0)"** is a technical section that shows even when it is empty.
- There's no way to narrow the list by state or area. That's acceptable at today's volume.

### Colonies

- **Each cat on a colony page has its own red "Take out of this colony" button.** A risky action is repeated down the page and dominates it.
- **The colony's cat list doesn't show sterilisation status,** which is the one thing needed when planning trapping.
- The colony centre is shown as coordinates.

### Feeding sites and map

- **The map works but is clunky.** You zoom with buttons, move with North, South, East and West buttons, and need an "Update" button just to apply a tick box.
- **It shows feeding sites only.** There are no cats, colonies or reports on it.

### Probably sterilised

- **The name and the explanation are hard to follow.** The explanation runs to three short paragraphs of rules before the list. A rename is already open as SYC-365.

### People (main only)

- It works and is clear. It isn't live yet (see headline 1).

## Already ticketed, and not repeated in the spec

- SYC-270: the 1970 date.
- SYC-365: renaming "Probably sterilised".
- SYC-366: keyboard and screen-reader basics.
- SYC-374: the phone menu fade.
- SYC-362 (in progress elsewhere): "Are you sure?" pages, plainer cat-page wording, feeding sites on phones, map links.

The redesign spec builds on all of these and does not redo them.
