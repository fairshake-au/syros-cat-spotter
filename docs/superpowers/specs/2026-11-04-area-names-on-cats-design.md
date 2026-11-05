# Area names on cat cards and the cat page (SYC-810, app half)

**Status:** adversarial review done and folded in, ready for Samuel. **Who it's for:** spotters, in the public app. **Scope:** the app half only. The dashboard's "Where to trap next" waits for Jacky's or Susan's answers.

## 1. The problem

Spotters can't see where a cat lives. Catalogue and Home cards show "Discovered by lilacsage22". The cat page only has a place if the cat's free-text description gives one. Place is what makes a street cat feel real to a visitor walking past it.

## 2. What's already true

Checked in the code on `origin/main` at 7b0b4c22d.

- **Public position:** every public cat goes through one serialiser, `serialiseCat` (`lib/catHelpers.ts`). It sends the centre of the cat's 250m cell on a fixed, public grid (`blurPosition`), never the exact spot. An owner viewing their own cat gets the exact spot.
- **Named areas:** there are 21, flat, in `named_areas`, editable by the team on the Areas page. A place belongs to the nearest centre within 2km, otherwise it's "Off Syros" (`areas/namedAreas.ts`). There's no finer level, so the ticket's "Ermoupoli · Pigis" isn't possible without new data. This spec shows the area only.
- **Names are in one language.** The table has no Greek column.
- **The team's dashboard** already shows `c.place`, worked out from exact positions. That's team-only and stays as it is.
- **Decisions in force:** F2 keeps the 250m grid. D4 says a confirmed "not sterilised" is public, and notes that it sharpens the targeting risk. `claiming-a-cat.md` D9 says where an owned cat lives is seen only by the owner and Syros Cats.

## 3. The privacy rule this spec depends on

**The area is worked out from the published cell centre, never from the exact position.**

So the area name gives away nothing that the public `lat` and `lng` don't already give: anyone can work out the nearest place name from the cell centre. Worked out from the exact position, a cat near an area border would leak which side of the border it's on, which is finer than the cell.

The rule holds for owners too: an owner sees the same area name as everyone else, so the name never depends on who's asking.

## 4. What changes

### 4.1 The API

`serialiseCat` gains two fields, always built from the blurred position, even when the viewer gets the exact one:

- `areaKey`: a named area's key, or null.
- `areaName`: its name, or null.

**Null when:** the cell centre is more than 2km from every area centre, on the island or off it; or the cat has a home (see §4.5).

`namedAreas.ts` imports `haversineKm` from `catHelpers.ts`, so calling it from the serialiser would make a circular import. It switches to the same function from `@workspace/geo`.

Both fields go in `openapi.yaml` and the generated clients as optional, so a phone with old cached cats still works. #419 changes those generated files, so this starts after it merges.

### 4.2 Catalogue and Home cards

`CatCard` is used on those two screens only. Its "Discovered by" row becomes one line that never wraps, so cards stay the same height (this also closes SYC-816's uneven cards):

| The cat | The row shows |
|---|---|
| Has an area | Map pin and the area: "Kini" |
| On the island, far from every area | Map pin and "Somewhere on Syros" |
| Has a home, or off the island | "Discovered by…", as today |
| From an old phone cache with no area field | "Discovered by…", as today |

The app tells these apart from `hasHome`, the published position and whether the field exists at all. The card's spoken label matches the row.

"Discovered by" isn't lost: the cat page's Story tab already says who first spotted the cat.

### 4.3 The cat page

The "where" row leads with the area and keeps the description under it:

- **Bold:** the area alone, "Kini". An area is already a rough place. No "Around…" wording, because Greek and French would each need their own grammar for every name (articles, cases, "d'"), and SYC-723 showed what that costs.
- **Quiet line:** the cat's description, if it has one ("Up by the church steps").

With no area and no description, there's no row. With a description only, it shows as today.

### 4.4 Search

The Catalogue's search box already says "Search by name, ID, or area", but only looks at the name, description and ID. `app/(tabs)/cats.tsx` adds the area to what it searches, in both the shown name and the server's name, so "Kini" and "Κίνι" both find a Kini cat in Greek. Then the box does what it says.

### 4.5 Cats with a home

A cat with a home shows no area, and `areaName` is null for everyone, the owner included, so the answer never depends on who's asking. D9 keeps where an owned cat lives private, and a place name beside "Has a home" reads as a statement about a household.

**Why not rely on the map?** The cell is already public for these cats, so this adds no new protection against someone determined. It stops the app from saying it out loud. See §7, question 2.

### 4.6 Three languages

English and French show the name as the team wrote it. Greek needs Greek script.

There's no column for it, and this batch adds no database changes. So the app holds a small list of Greek names by area key (`lib/areaNames.ts`). A key that isn't on the list, such as an area the team adds later, falls back to the name from the server.

**The Greek names need checking by Syros Cats or a Greek speaker before launch.** The list is Claude's draft.

New string in en, el, fr: "Somewhere on Syros". There's no template with the area name inside it, so no grammar to get wrong.

### 4.7 The Areas page

**Area names become public with this change.** Today they're team-only, so nothing stops a name like "Maria's colony". The team's Areas page gets a line saying that names show in the public app and must be places, never people or feeding sites.

Before this goes live, someone checks the 21 live names. The seed list is all place names, but the team can edit them.

## 5. Threats and how this holds up

| Worry | Answer |
|---|---|
| The name narrows a cat's location below 250m | No. It's worked out from the published centre (§3), and an independent read of the code found no way round that. Tests: an owner's response carries the same `areaName` as the public one for the same cat, and a cat whose exact spot is across an area border from its cell centre gets the cell centre's area. |
| A list of "not sterilised" cats by area | The map and the API already allow this, but search makes it easier. D4 recorded this risk as Syros Cats' to accept. See §7, question 1. |
| Averaging cats' positions finds a colony | Unchanged (F2). The name adds nothing to it. |
| Private feeding sites | Not touched. Sites aren't in `named_areas`, and no site data goes through this code. |
| A team-typed name reveals a person or site | §4.7. |
| The field leaks through another route | The serialiser is the only builder and is an allow-list. A test covers its callers: `GET /cats`, `GET /cats/:id` (`publicCat.ts`) and the resolve response. |
| The team's retiring or renaming an area | The app shows the new name within about a minute (`AREAS_TTL_MS`). Cached phones show the old one until they refresh, which is harmless. |

**A security review is required before merge,** as the brief says.

## 6. Accessibility and layout

- The pin icon is hidden from screen readers; the area text is plain text.
- Long Greek and French strings fit: the card row truncates on one line, and the spoken label keeps the full name.
- The cat page row wraps.

## 7. Questions for Samuel

1. **Should Syros Cats be told before this goes live?** F2 and D4 say location risks are theirs to accept, and this makes "which cats are in Kini" easier to read. Recommendation: yes, one plain line to Jacky or Susan with the three questions already going to them. It doesn't need to hold up building.
2. **Should cats with a home show no area?** Recommendation: yes, leave it off. The cost is a slightly thinner card for homed cats. The other option, showing it, gives a more even catalogue but puts a place beside a household.
3. **Is losing "Discovered by" from cards all right?** It's a small reward for spotters who find a cat first. Recommendation: yes. It stays on the cat page, and the ticket asks for this swap. The other option is keeping both, which makes cards taller and uneven.

## 8. Not in this spec

The dashboard half, area filters in the app, sub-areas, area pages, Home's place names (parked in SYC-835).

## 9. Checks before the PR

Catalogue, Home and cat page at 390px and desktop, in en, el and fr, with long names; a homed cat; a cat off the island; a cat far from every area; old cached data with no area fields; a Catalogue search test for the area; the tests in §5.

## 10. What the adversarial review changed

The review (4 Nov 2026) confirmed the §3 privacy rule holds. It changed these things:

- The grid is public, not secret. The first draft repeated a stale comment.
- "Somewhere on Syros" was going to show for cats off the island and homed cats, where it's untrue or misleading. §4.2 now has a row for each case.
- Old cached phones would have shown "Somewhere on Syros" for every cat. They now keep "Discovered by".
- "Around {area}" is gone, because Greek and French need different grammar per name.
- Search needs a client change and should match both name forms.
- A circular import in the build is named and solved.

The review also said `CatCard` reaches four more screens. That was checked and is wrong: only Home and the Catalogue render it.
