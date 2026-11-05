# Dashboard Map: map first, filters folded (SYC-812)

**Status:** adversarial review done and folded in, ready for Samuel. **Who it's for:** the Syros Cats team on `/api/team/cats?view=map`.

## 1. The problem

The team opens the Map to see where cats are, and especially where the unsterilised ones are. Today the map starts about 1,000px down on a desktop and about 500px down on a phone, below a panel of about 35 controls. The base map is full colour, so green parks and orange roads compete with the cat dots.

## 2. What's already true

Checked in the code on `origin/main` at 7b0b4c22d. The live site wasn't checked.

- **Clusters already show the sterilisation mix.** SYC-783 (#417) draws each group as a four-part ring (`assets/dashboard-map.js` `ring()`). The critique's "plain blue circles" came before that merged. This spec adds nothing here.
- **The filter panel is forced open from 900px** by a CSS rule (`layout.ts`, `details.filters::details-content`). SYC-833 asks whether those hidden-but-shown controls take keyboard focus properly. Removing the rule ends that question.
- **Base map:** the dashboard and the app share `lib/map-style`, whose colours are an OpenStreetMap-like palette. `routes/teamMapData.ts` builds the dashboard's style.
- **"Last seen" bands** (`teamCatList.ts`): `week` is 7 days or fewer, `month` is 30 days or fewer (so it includes `week`), `1to3` is 31–90 days, `over3` is over 90 days, `quiet` is 42 days or more (Home's "Not seen lately", which also leaves out cats off the island), `never` is no sighting.
- **Filters count:** `activeFilterCount` leaves out the default Lives choice, so "Filters (0)" shows while three of the four Lives boxes are ticked and cats who've died are hidden.

## 3. What changes

### 3.1 The page order on the Map view

1. Title. The page's help line moves below the map on this view.
2. Search with Show cats, then a row with the Filters fold, the Grid/Map switch and "Find from a photo".
3. Active filter chips and the count line, in one row where they fit.
4. **The map.**
5. Below the map: the help line, the layer choices, "Go to an area", the credit and the privacy note.

The map starts within the first screen at 390px and at 1280px. **Aim:** at 390px, the map's top edge is about 300px down with no filters on, and at least half of an 844px-tall phone screen is map. The real number gets measured in a prototype at the start of the build and reported to Samuel before the rest goes ahead. Opening the Filters fold pushes the map down; it doesn't cover it.

**Grid stays in step:** `dashboard-grid.js` only replaces `#catresults`, and the Grid/Map switch and "Find from a photo" sit inside it so their links follow the filters. On Grid they stay inside it and are styled into the row. The Map's script updates its own links by id, so the ids (`view-grid`, `view-map`) and `.viewrow .findentrylink` stay as they are.

The layer choices (Cats, Feeding sites) move below the map because they're used less often than the map itself. The Key stays in its corner.

### 3.2 Filters fold on every width, on both views

Remove the rule that forces the panel open at 900px. The Filters fold works the same on Grid and Map, on a phone and on a desktop, so the controls stay put when you switch view (SYC-522 still holds).

**What the fold keeps:** when a filter is on, its chip shows outside the fold, so nothing is hidden without saying so.

That needs a script change on the Map. Today `dashboard-map.js` deletes the chips on the first filter change and never updates the "Filters (n)" label, which didn't matter while the panel stayed open. It must now update that label and redraw the chips and the §3.6 note on every change, the way `dashboard-grid.js` does.

**Open choice for Samuel:** see §6, question 1.

### 3.3 No Sort on the Map view

Sort means nothing on a map, so its control isn't drawn when `view=map`. Choosing a cat for a report keeps Sort, because that's the grid. A chosen sort stays in the address as a hidden field, so going back to Grid keeps it.

### 3.4 A quiet base map

Add a `quiet` option to `buildStyle` in `lib/map-style`. The dashboard's `teamMapData` route asks for it; the app doesn't, so spotters see no change.

Quiet means low colour, per §12.4: land is whitewash (#f4f2ec), water a pale Aegean (#cfe7f9), parks and woods a pale grey-green, roads white with hairline casing, major roads hairline grey, and buildings a shade darker than land. Labels stay, and stay readable: place, road and beach names are at least 4.5:1 on land.

**This applies to every dashboard map,** because they all get their style from one route: the Map, the cat page's map, the colony plan map, the feeding-site pages and the site and area pickers. People still need to recognise streets there. The labels and road shapes don't change, only their colour.

`quiet` is off unless asked for, so the app's two `buildStyle` calls and `lib/map-style`'s tests stay as they are.

**Checks:** measured from the final colours, using the live marks (`#0f4a72`, `#1c77c3`, `#d7dee4`, `#b8552f`). Each mark, the group ring and feeding-site squares keep at least 3:1 against quiet land and water, or their outline carries it. "Not known" (`#d7dee4`) will rely on its outline, because it's nearly the land's colour. Beach and small-place labels are close to 4.5:1 on the new land colour and may need darkening. Dark mode: maps stay on light paper, as they do today.

### 3.5 "Last seen" options that don't overlap

The dropdown becomes:

| Option | Means | Value |
|---|---|---|
| Any time | no filter | (none) |
| In the last week | 0–7 days | `week` |
| 1 week to 1 month | 8–30 days | `month` (changed) |
| 1–3 months | 31–90 days | `1to3` |
| Over 3 months | over 90 days | `over3` |
| Never seen since first recorded | no sighting | `never` |

**"6 weeks or more"** (`quiet`) overlaps two others, so it leaves the dropdown. The value stays, so old links keep working. Arriving with it shows its chip, as today, and the dropdown shows it as a one-off extra option with the same words, so the form doesn't quietly lose the filter on submit.

**`month` changes meaning** from "30 days or fewer" to "8–30 days". Saved links with `lastSeen=month` will show fewer cats. In the code only the dropdown, its chip and one test use it. The reports' own "month" ranges are separate and unaffected.

### 3.6 An honest Filters count

The default leaves out cats marked "No longer with us". The count stays a count of what you changed, so "Filters (0)" remains right, but the page says what's left out: "Not showing cats who are no longer with us. Show them".

The Cats grid already has a line like this (`catGridPage.ts:390`) whenever that box isn't ticked. Its words are wrong: it says "or haven't been seen for a long time", but only "No longer with us" is hidden. This fixes the words and shows the same line on the Map, outside the part of the page the script rewrites.

## 4. Accessibility

- The map still has its list alternative: the "see these cats as a grid" link stays right below it.
- Tab order follows the new page order, so a keyboard user reaches the filters before the map, as today.
- The Filters fold is a bordered 44px button with no marker today. It gets the same ▸/▾ as other folds, and "Go to an area" gets one too (a SYC-815 gap).
- The closed fold must be reachable and clearly a control at 1280px, not only on phones.

## 5. Not in this spec

SYC-832 (cluster focus), the app's map, feeding-site symbols, the Key's design, anything on Home.

## 6. Questions for Samuel

1. **Should the Grid view's filters fold on desktop too, or only the Map's?** Recommendation: both. It's what the ticket asks and it keeps the view switch steady. The risk is one extra click for someone who filters the grid all day.
2. **Is it fine that every dashboard map goes quiet, including the feeding-site and area pickers?** Recommendation: yes. One map look is simpler, and the street names stay. The risk is that landmarks stand out less when placing a pin.

## 7. Dependencies and order

- Needs `layout.ts`, so it starts from fresh `origin/main` after #420 merges.
- `lib/map-style` is shared with the app. Its tests pin the app's style, and those must stay unchanged.
- No database changes.

## 8. Checks before the PR

Map and Grid at 390px and 1280px, light and dark, with real-looking data; map top edge measured; filters fold by keyboard; on the Map, chips, count and "Filters (n)" stay right after several filter changes; on Grid, the Map link follows the filters; a `lastSeen=quiet` link round trip; contrast measured on the quiet base; the app's map unchanged.

## 9. What the adversarial review changed

The review (4 Nov 2026) confirmed the cluster rings are merged and that switching off JavaScript still works. It changed these things:

- Moving the Grid/Map switch out of the part `dashboard-grid.js` replaces would have left a stale link. §3.1 keeps it in place.
- With the fold closed, the Map's script would have hidden filter state after the first change. §3.2 now requires a script change, which makes this a bigger job than the ticket suggests.
- The 320px target wasn't realistic at 390px. §3.1 now moves the help line and measures in a prototype first.
- The quiet map reaches more pages than the first draft listed.
- The grid's "hidden by default" note says something untrue, and that's now fixed here.
