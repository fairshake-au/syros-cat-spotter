# Area names on cat cards and the cat page (SYC-810, app half)

**Status:** approved by Samuel, 6 Nov 2026, with his answers folded in and re-checked (§7, §11). **Who it's for:** spotters, in the public app. **Scope:** the app half only. The dashboard's "Where to trap next" waits for Jacky's or Susan's answers.

## 1. The problem

Spotters can't see where a cat lives. Catalogue and Home cards show "Discovered by lilacsage22". The cat page only has a place if the cat's free-text description gives one. Place is what makes a street cat feel real to a visitor walking past it.

## 2. What's already true

Checked in the code on `origin/main` at 7b0b4c22d.

- **Public position:** every public cat goes through one serialiser, `serialiseCat` (`lib/catHelpers.ts`). It sends the centre of the cat's 250m cell on a fixed, public grid (`blurPosition`), never the exact spot. An owner viewing their own cat gets the exact spot.
- **Named areas:** there are 21, flat, in `named_areas`, editable by the team on the Areas page. A place belongs to the nearest centre within 2km, otherwise it's "Off Syros" (`areas/namedAreas.ts`). There's no finer level, so the ticket's "Ermoupoli · Pigis" isn't possible without new data. This spec shows the area only.
- **Names are in one language.** The table has no Greek column.
- **The team's dashboard** already shows `c.place`, worked out from exact positions. That's team-only and stays as it is.
- **Decisions in force:** F2 keeps the 250m grid. D4 says a confirmed "not sterilised" is public, and notes that it sharpens the targeting risk. `claiming-a-cat.md` D9 says where an owned cat lives is seen only by the owner and Syros Cats.
- **An owned cat has two places.** Its public position is where it's spotted. Its home pin is separate: the owner places it within 1km of the public position, it's never in the public data, and the app promises the owner "Only you and Syros Cats will see the pin and the note."
- **Catalogue filters today:** All, Near me, Has a home and, once there's collection data, Not spotted, one at a time.

## 3. The privacy rule this spec depends on

**The area is worked out from the published cell centre, never from the exact position and never from the owner's home pin.**

So the area name gives away nothing that the public `lat` and `lng` don't already give: anyone can work out the nearest place name from the cell centre. Worked out from the exact position, a cat near an area border would leak which side of the border it's on, which is finer than the cell.

The rule holds for owners too: an owner sees the same area name as everyone else, so the name never depends on who's asking.

The home pin stays out for a stronger reason: the app has promised owners that only they and Syros Cats see it. The code that works out the area is given the cell centre only, so it can't read the pin.

## 4. What changes

### 4.1 The API

`serialiseCat` gains two fields, always built from the blurred position, even when the viewer gets the exact one:

- `areaKey`: a named area's key, or null.
- `areaName`: its name, or null.

**Null when:** the cell centre is more than 2km from every area centre, on the island or off it. A cat with a home gets its area like any other cat (see §4.5).

`namedAreas.ts` imports `haversineKm` from `catHelpers.ts`, so calling it from the serialiser would make a circular import. It switches to the same function from `@workspace/geo`.

Both fields go in `openapi.yaml` and the generated clients as optional, so a phone with old cached cats still works. #419 changes those generated files, so this starts after it merges.

### 4.2 Catalogue and Home cards

`CatCard` is used on those two screens only. Its "Discovered by" row becomes one line that never wraps, so cards stay the same height (this also closes SYC-816's uneven cards):

| The cat | The row shows |
|---|---|
| Has an area | Map pin and the area: "Kini" |
| On the island, far from every area | Map pin and "Somewhere on Syros" |
| Off the island | "Discovered by…", as today |
| From an old phone cache with no area field | "Discovered by…", as today |

A cat with a home follows the same rows and keeps its "Has a home" badge. The app tells the rows apart from the published position and whether the field exists at all. The card's spoken label matches the row.

"Discovered by" isn't lost: the cat page's Story tab already says who first spotted the cat.

### 4.3 The cat page

The "where" row leads with the area and keeps the description under it:

- **Bold:** the area alone, "Kini". An area is already a rough place. No "Around…" wording, because Greek and French would each need their own grammar for every name (articles, cases, "d'"), and SYC-723 showed what that costs.
- **Quiet line:** the cat's description, if it has one ("Up by the church steps").

With no area and no description, there's no row. With a description only, it shows as today.

### 4.4 Search and the No home filter

The Catalogue's search box already says "Search by name, ID, or area", but only looks at the name, description and ID. `app/(tabs)/cats.tsx` adds the area to what it searches, in both the shown name and the server's name, so "Kini" and "Κίνι" both find a Kini cat in Greek. Then the box does what it says.

**A new filter, "No home",** joins the Catalogue's filters. It shows only cats where `c.hasHome === false`, on the list and on the map. Search and filters already work together, so typing "Kini" and tapping No home shows the cats in Kini without a home. That gives Samuel's option without a separate area picker. A cat from an old phone cache with no `hasHome` field is left out. With nothing to show and no search typed, the screen says "No cats without a home here." With a search typed, it keeps today's no-match message. That needs `noHome` in the `CatalogueFilter` type and a new case in `catalogueEmptyKey`, both in `lib/spotted.ts`.

### 4.5 Cats with a home

A cat with a home shows its area, like any other cat (Samuel, 6 Nov). The area comes from the published cell centre, the same as for every cat, and everyone sees the same name, the owner included.

**It's the area where the cat is seen, not where its home pin is.** The two nearly always match, because the pin must be within 1km of the public position. Near an area border they can differ, and then the app shows the area of the published position. Using the pin would tell the public something the app has promised owners it won't (§3).

The wording stays a plain place name: never "Lives in Kini" or "Home in Kini", on the card, the cat page or the spoken label.

**What this does and doesn't give away.** It adds no location: the cell is already public for these cats. It does make it easier to read, because a place name now sits beside "Has a home", and Has a home plus a search for "Kini" lists owned cats in Kini. Samuel accepted that with his answer. See §7, question 2.

### 4.6 Three languages

English and French show the name as the team wrote it. Greek needs Greek script.

There's no column for it, and this batch adds no database changes. So the app holds a small list of Greek names by area key (`lib/areaNames.ts`). A key that isn't on the list, such as an area the team adds later, falls back to the name from the server.

**The Greek names need checking by Syros Cats or a Greek speaker before launch.** The list is Claude's draft.

New strings in en, el, fr: "Somewhere on Syros", "No home" and "No cats without a home here." There's no template with the area name inside it, so no grammar to get wrong.

### 4.7 The Areas page

**Area names become public with this change.** Today they're team-only, so nothing stops a name like "Maria's colony". The team's Areas page gets a line saying that names show in the public app and must be places, never people or feeding sites.

Before this goes live, someone checks the 21 live names. The seed list is all place names, but the team can edit them.

## 5. Threats and how this holds up

| Worry | Answer |
|---|---|
| The name narrows a cat's location below 250m | No. It's worked out from the published centre (§3), and an independent read of the code found no way round that. Tests: an owner's response carries the same `areaName` as the public one for the same cat, a cat whose exact spot is across an area border from its cell centre gets the cell centre's area, and a homed cat whose pin is in another area gets the cell centre's area. |
| A list of "not sterilised" cats by area | The map and the API already allow this, but search makes it easier. D4 recorded this risk as Syros Cats' to accept. Samuel's call is to tell them after it goes live. See §7, question 1. |
| The name gives away where an owned cat lives | It names the area of the public position, which anyone could work out already. The home pin is never read (§3). It does put a place beside "Has a home", which Samuel accepted (§7, question 2). |
| A list of cats with no home, by area | Has a home plus the public data already allows this, and No home plus search makes it easier. These are the cats nobody is watching over at home, so it's the same risk as D4. It's on the list for Syros Cats (§7, question 1). |
| Averaging cats' positions finds a colony | Unchanged (F2). The name adds nothing, but No home takes homed cats out of the Catalogue map's counts, so street-cat clusters read more clearly. No new data, and it goes in the same post-launch line to Syros Cats. |
| No home points at cats someone could claim | Claiming is older than this feature, and a claim's reply carries the cat's exact spot, which goes against the rule that exact street positions stay private. `hasHome` was already public, but No home makes choosing targets by area quick. This doesn't change what a claim gives away, so it doesn't block this work. It has its own ticket, and it goes in the post-launch line to Syros Cats. |
| The area's key or centre gives something away | `areaKey` goes out with every cat, and borders between areas can be traced from the labels, which roughly shows where centres are. The Add form says both: use the place's name for the key, and put the centre on the place, never a home or feeding site. The check before live covers names and keys of every live area. |
| Private feeding sites | Not touched. Sites aren't in `named_areas`, and no site data goes through this code. |
| A team-typed name reveals a person or site | §4.7. |
| The field leaks through another route | The serialiser is the only builder and is an allow-list. A route test covers its callers with a cat across a border from its cell and a home pin in a third area: `GET /cats`, `GET /cats/:id` (`publicCat.ts`), the owner's `GET` and `PATCH`, and the resolve response. Claim and let-go share `catPayload`. |
| The team's retiring or renaming an area | The app shows the new name within about a minute (`AREAS_TTL_MS`). Cached phones show the old one until they refresh, which is harmless. |

**A security review is required before merge,** as the brief says.

## 6. Accessibility and layout

- The pin icon is hidden from screen readers; the area text is plain text.
- Long Greek and French strings fit: the card row truncates on one line, and the spoken label keeps the full name.
- The cat page row wraps.

## 7. Samuel's answers (6 Nov 2026)

1. **Should Syros Cats be told before this goes live?** Samuel: "no, we can tell them after it goes live". So one plain line goes to Jacky or Susan after launch, covering area names and the No home filter. The two checks before live stay, because they're about correct names: the 21 live names (§4.7) and the Greek list (§4.6).
2. **Should cats with a home show no area?** Samuel: "cats with a home should show in the area in which they're homed, with an option to only show the cats that are not homed in that area". §4.5 shows the area, and §4.4 adds the No home filter. One reading to confirm: the area shown is where the cat is seen, not its home pin, for the reason in §3.
3. **Is losing "Discovered by" from cards all right?** Samuel: "yes". §4.2 stands.

## 8. Not in this spec

The dashboard half, a separate area picker in the app, sub-areas, area pages, Home's place names (parked in SYC-835).

## 9. Checks before the PR

Catalogue, Home and cat page at 390px and desktop, in en, el and fr, with long names; a homed cat, including one whose pin is in another area; the No home filter with a search, on the list and the map, a `spotted.test.ts` case for its empty message and one for a cached cat with no `hasHome` field, and the filter row at 390px in Greek; a cat off the island; a cat far from every area; old cached data with no area fields; a Catalogue search test for the area; the tests in §5.

## 10. What the adversarial review changed

The review (4 Nov 2026) confirmed the §3 privacy rule holds. It changed these things:

- The grid is public, not secret. The first draft repeated a stale comment.
- "Somewhere on Syros" was going to show for cats off the island and homed cats, where it's untrue or misleading. §4.2 now has a row for each case.
- Old cached phones would have shown "Somewhere on Syros" for every cat. They now keep "Discovered by".
- "Around {area}" is gone, because Greek and French need different grammar per name.
- Search needs a client change and should match both name forms.
- A circular import in the build is named and solved.

The review also said `CatCard` reaches four more screens. That was checked and is wrong: only Home and the Catalogue render it.

## 11. What changed after Samuel's answers

Samuel's answer to question 2 reversed §4.5 and added a filter, so both went back through the privacy rule.

- **Showing an area on homed cats:** passes, as long as it comes from the published position. It adds no location. It does put a place beside "Has a home".
- **Using the home pin for the area:** fails. It would make public something the app promises owners only they and Syros Cats see, so this spec doesn't do it.
- **The No home filter:** passes. It adds no new data, because `hasHome` is already public. It makes a list of cats with no home in an area easier to get, which is listed in §5.

A second, independent read on 6 Nov agreed: the rule holds, and nothing in the claiming spec hides homed cats from public lists or maps. It also found that the filter's empty message needs a change in `lib/spotted.ts` and that old cached cats need a strict check. §4.4 covers both. §10's note on homed cats describes the first draft; they now follow the same rows as other cats.
