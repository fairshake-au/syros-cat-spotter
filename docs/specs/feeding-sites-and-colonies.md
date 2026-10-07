# Feeding sites and colonies on the dashboard

**Feature spec · Cat Spotters (Syros)**
**Version:** 1.0 draft · 7 October 2026
**Covers:** PRODUCT-SPEC §2.6 (the feeding-site map, private by default with a per-site public toggle, and colony naming), and the part of §2.6's dashboard that `team-access-and-welfare-queue.md` §3.2 and §3.4 describe in a paragraph each.
**Linear:** SYC-209 (this spec) · SYC-43 (the dashboard it belongs to) · SYC-53 (roles: a dependency, see §7) · SYC-22 and SYC-51 (QR codes that will point at sites, see §11) · SYC-67 (Syros Cats' acceptance of the location limits).
**Status:** **Draft for Samuel's approval.** Not yet adversarially reviewed. Written against `docs/specs/DECISIONS.md`, which wins wherever they differ.

### What this document owns, and what it borrows

This is the screen-and-behaviour spec for two things: the team's **feeding-site map** and the team's **colonies**. It does not define their records and it does not set the privacy rules. Those already have owners.

| What | Owner |
|---|---|
| The `feeding_sites` and `colonies` records, `colony_name_history`, the `colony` observation | `cat-record-data-spine.md` §10.5 |
| Feeding-site privacy: private by default, absent (never blurred) from public payloads, filtered in the query not the serialiser, **and the precision at which a public site is shown** | `cat-record-data-spine.md` §6.7 and its open question 3 |
| Cat location blurring (250 m cells), the colony-averaging limit, the nearest-cat oracle | `cat-record-data-spine.md` §6 |
| Staff sign-in, the dashboard shell, capabilities, `person_scopes` | `team-access-and-welfare-queue.md` §2, §7, §8 |
| Which roles exist, and which capabilities a cat guardian holds | **SYC-53** (being specified in parallel) |

**What this document adds** and proposes the owners adopt (§12): the screens; the rule about what a public site's label may contain; the safeguards around flipping a site public; the public site card and map layer in the app; an add-only history of every change to a site or colony; and a short list of columns the spine's records need to carry for all of that.

**Two rules from the spine are repeated here only so no reader misses them.** A private site is *absent* from every public response: not blurred, not counted, not a heat patch. And switching a site off again does not undo what anyone has already seen.

---

## 1. The short version

Syros Cats already know where every feeder is. That knowledge lives in people's heads, in WhatsApp groups, and in the names they use on the phone: "Vaporia, Eleni's". The app is collecting photographs of cats from all over the island, and the team has no place to say "this is a feeding spot, these cats belong to it, this is who looks after it".

This spec gives them one:

1. **A map of every feeding site on the island, seen only by signed-in Syros Cats people.** They add sites, move them when they were put in the wrong place, and retire them when a feeder closes. Nothing is deleted.
2. **Colonies with the names they already use**, a place plus the cat guardian who looks after it, renamable whenever a guardian changes, with a way to say which cats belong to which colony.
3. **One switch per site: private or public.** Private is the default, and it is how every site starts. A site goes public only when somebody on the team decides it should, one site at a time, after a screen that shows exactly what a tourist will see and reminds them why this matters. Making it public puts a bowl-shaped marker at its exact position on the map in the app, with a short note asking people to keep their distance. It does not publish the cats, the colony, the guardian's name or any note.
4. **A record of every change**: who moved, renamed, hid or exposed what, and when, so "how did that become public?" always has an answer.

**The thing that matters most is the one-sentence reason from the spine:** cat feeders face hostility from some neighbours, and known feeding sites attract people who abandon animals. The location of a feeding site is among the most sensitive facts in the whole app, because it leads people straight to cats. Everything below is shaped by that.

### The two audiences want the same thing from different angles

A cat guardian who has fed the same alley for nine years wants the charity to know that place exists, and to keep it quiet. A tourist standing in Kini wants to see where the real feeders are and help without doing harm. These needs are complementary, and the switch is where they meet: the guardian's quiet places stay quiet, and the places Syros Cats choose to be seen become a way for visitors to find the charity's work.

---

## 2. What the team sees and does

Everything here is a page on the existing staff dashboard (`team.catspotters.com`), in the same style as the welfare queue and the cat pages: ordinary pages with buttons, drawn by the server. The top bar gains two links, **Feeding sites** and **Colonies**.

### 2.1 The Feeding sites page

The top of the page is a map of the island with a marker on every site. Below it is the same information as a list, because a list is faster when you already know the name.

- **Markers show state at a glance.** A filled marker is a public site; an outlined one is private; a grey one is retired (hidden unless "Show retired" is ticked). There is a count above the map: "31 sites: 2 public, 28 private, 1 retired".
- **The list is sorted by name** and each row says: the site's name, its colony (or "no colony yet"), private or public, and the date it was last changed.
- **A "Recently changed" strip** under the count shows the last five changes to any site, with the person's name and the day. It is the quickest way to answer "did someone just change this?".
- **Tap a marker or a row to open that site.**

### 2.2 One site

A site's page shows, in this order:

1. **Its name**, and a small map centred on it.
2. **Visibility**: a plain sentence ("Private. Only Syros Cats people signed in here can see this place.") and the button to change it (§4.3).
3. **Its colony**, with a link, or a button to pick one.
4. **Its notes**, which are for the team only ("the gate is round the back", "Maria goes on Tuesdays").
5. **History**: everything that has been done to this site, newest first, each line with the person and the date (§8).
6. **Actions**: *Edit details*, *Move on the map*, *Retire this site*.

### 2.3 Adding a site

A team member can start in three places, because people think about feeders in three ways:

- **From the Feeding sites page: "Add a site".** Pick the spot on the map (§3).
- **From a cat's page: "Make a feeding site here".** The cat's page already shows its sightings with exact positions to the team. A sighting is often the moment someone says "that's where she's fed". The button starts a new site pre-placed at that sighting, and the team member can nudge it before saving.
- **From a colony's page: "Add a feeding site to this colony".** The new site arrives already linked.

The form asks for: **a name** (the convention is a place plus the guardian, "Vaporia — Eleni's", the same as colonies), **which colony** (optional; it can be added later), and **notes** (optional). It does not ask for anything public. A new site is always private. There is no way to create a site as public.

### 2.4 Moving a site

"Move on the map" opens the same picker as adding, starting from where the site is now. Moving is for correcting a pin placed in the wrong spot, or for a feeder that really moved a few metres. The page asks for a short reason ("pin was on the wrong side of the road"). The old position stays in the site's history, readable by the team.

**If the site is public, moving it also makes it private again** until someone confirms the new position (§4.5). A wrong pin on a public site would point visitors at somebody's front door.

### 2.5 Retiring a site, and bringing it back

A feeder closes, a guardian stops, a spot is no longer used. **Retire this site** takes it off the map and out of every public view at once, whatever it was before. It asks for a reason, and the site stays in the list under "Show retired", with its full history. **Bring back** puts it back **as private**, never as public. Sites are never deleted from the dashboard, because the history of where the island has been fed is part of the charity's record.

### 2.6 The Colonies page

A list of every colony by name, with its cat guardian's name, how many feeding sites it has, and how many cats are in it. A search box finds a colony by any name it has ever had, so typing "Eleni" or an old name works.

**One colony** shows: its name; the guardian's name; how many sites and cats; its sites (with links); its cats (with photos); its team-only notes; and its history (renames, guardian changes, cats added and removed).

### 2.7 Naming and renaming a colony

- **Creating a colony:** a name and, optionally, the guardian's name and notes. The page shows the convention: *a place and the person who looks after it, like "Vaporia — Eleni's"*. It checks the name is not already taken, ignoring capitals, accents and the final-sigma difference, using the same folding as cat names. If it clashes, the page says which colony already has the name and links to it, as the cat rename does.
- **Renaming:** same form. Everything points at a colony by its number, never its name, so renaming moves nothing: its cats, its sites, any QR code (§11) stay attached. The old name goes into the colony's name history, so searching for it still finds the colony, and so a future import (`records-import.md`) still matches.
- **Changing the guardian** is an edit of the guardian's name (and, normally, a rename to match). The two fields are separate on purpose: the name is how the colony is *spoken about*, the guardian's name is who to ring, and they do not always change together.
- **Names are proper names.** They are stored once, as typed, and shown exactly like that in every language. "Vaporia — Eleni's" is never translated.

### 2.8 Putting cats in a colony

A cat belongs to a colony because the team said so. That statement is a `colony` observation on the cat, written by the same rules as every other statement (`cat-record-data-spine.md` §10.5, §10.1): signed, dated, attributed, never edited, never deleted.

Two ways in, because there are two jobs:

- **From the colony page, "Add cats":** a search box that finds cats by name or SYR number; each result has a tick box and shows which colony, if any, the cat is in now. Tick several and press *Add the ticked cats*. Each cat gets its own statement. (This is not a bulk privacy action; it changes only which cats are listed together on the team's side.)
- **From a cat's page, "Colony":** choose one from a list of all colonies. One tap, one statement.

**Moving a cat between colonies** writes a new statement; the cat's page then shows both, with the newest standing. **Taking a cat out of a colony** is "Mark wrong" on the colony statement, with a reason, exactly as the correction forms already work for life status and sterilisation (the cat is then in no colony). The history keeps the earlier claim.

**A colony statement is not evidence of life** and moves no derived status (`cat-record-data-spine.md` §10.5). Putting a cat in a colony never changes whether it is shown as alive, sterilised or anything else.

---

## 3. Picking a spot on the map

Placing and moving sites is the one place the dashboard's plain-pages design strains, because a map normally needs scripts and the dashboard deliberately has none (`script-src` is absent from its security header, and pictures may come only from the dashboard's own address). This spec keeps both rules and makes the map out of ordinary pages:

- **The map is a grid of map tile pictures**, fetched by the server on the dashboard's behalf and served from the dashboard's own address, so the browser never talks to a map company.
- **Markers are links** laid over the tiles. Tapping a marker opens that site.
- **To place a spot, each tile is itself a button.** A browser sends the exact point you tapped within an image button. The server turns that point into a position. There is no script involved, and it works on any phone browser.
- **Moving around is by links:** *Zoom in*, *Zoom out*, and the island's main areas as quick links (Ermoupoli, Vaporia, Kini, Galissas, Finikas, Posidonia, Azolimnos and so on; the list is configuration). Placing a pin needs a close zoom (about 10 metres to a tap on a phone), and the page starts there when it is opened from a cat or a colony.
- **After a tap, a confirmation page** shows a marker on the tapped spot, a small map around it, and the name form. Nothing is saved until *Save* is pressed.

**This is the cheapest correct answer, not the best-looking one.** It is slower to pan than a map people can drag. Decision 1 (§13) lists the alternatives and why this is recommended; the page the team sees is designed so a better map can be swapped in later without changing anything else in this spec.

---

## 4. Private by default, and what the switch really does

### 4.1 The rule

Every feeding site is created private. A site is public only after a named team member has deliberately made it so, with the date recorded. There is **no bulk action**: not "make all of this colony public", not "make all public", not an import that sets visibility. Adding many sites at once is possible (§13 Decision 11); making them public never is.

### 4.2 What "public" exposes, and to whom

*To whom:* to **everyone**. The app has no sign-in, and its public data is also available to anyone who asks the server directly, with or without the app. A public site can be seen by a tourist, a local, a journalist, a neighbour who dislikes the feeders, and a person who wants to leave a box of kittens somewhere. There is no "just to app users" setting, and the screen says so.

*What:* exactly the fields in this table, and nothing else.

| Field | Private site | Public site |
|---|---|---|
| That the site exists | Not visible. Not blurred, not counted, not a heat patch | Visible |
| Where it is | Team only, exact | **Exact position, as the data spine rules** (`cat-record-data-spine.md` §6.7). If Syros Cats choose blurred instead (the spine's open question 3), only the one function that decides the published position changes (§11); nothing in this spec does |
| Its public label | Not visible | Visible. Written separately from the internal name (§4.4) |
| Its internal name | Team only | **Never visible** |
| Its colony, the colony's name, the guardian's name | Team only | **Never visible** |
| Which cats use it, how many | Team only | **Never visible** (Decision 3, §13) |
| Notes | Team only | **Never visible** |
| Who made it public, and when | Team only | **Never visible** |
| A number that identifies it | Team only (internal) | A random public code, with no link to how many sites exist (§11) |

### 4.3 Making a site public: the confirmation page

The button on a site's page says **Make public…**. It does not make it public. It opens a page with:

1. **A preview of exactly what visitors will see:** the marker on a small map, and the card that opens when it is tapped, in English, Greek and French, built from the real public label.
2. **A plain list of what this will do:** "Anyone in the world will be able to see where this feeding spot is, to the metre, from today."
3. **The reason, in one line:** "Cat guardians can face hostility from neighbours, and places where cats are fed are where people sometimes leave animals they don't want."
4. **What it will not do**, because people will assume: "It will not make the cats' own pins exact. Cats near this spot stay blurred. It does not hide or reveal anything else about this place."
5. **One honest caveat, from the spine:** "Switching this off later stops new people from seeing it. It cannot take it back from anyone who has already looked."
6. **A tick box the person must tick:** *"The cat guardian for this place knows, and is happy for it to be public."* (Decision 5, §13.)
7. **The public label field**, which must be filled in and is checked against §4.4.
8. **A button: Make public.**

Pressing it records the change and who made it; the site's page then says "Public since 14 October, by Maria."

Anyone who has `set_site_public` (§7) can do this. There is no second-person approval (Decision 5 considers one).

### 4.4 The public label is written separately

A site's internal name follows the charity's own convention and so contains the guardian's name: "Vaporia — Eleni's". Publishing that would publish a private person's first name next to an exact place. So:

- **A public site has a *public label*, a separate field, required before it can go public.** Examples: "Kini harbour feeders", "Vaporia seafront".
- The confirmation page rejects a label that **contains the guardian's name or the internal name** (checked after folding accents and case), and a label that **looks like an address** (a number following a street word, in Latin or Greek letters). The check is a guard against accident, not a promise: the person is still responsible for what they type.
- The label is the same in every language. It is a place name, like a colony name. If Syros Cats want a Greek and an English label for the same place, that is a later request (§13 Decision 10 notes it).

### 4.5 Switching off, moving, and retiring a public site

- **Make private** is one tap, with a one-line confirmation, no preview and no tick box. It is the safe direction and is never made harder. It takes effect for new requests immediately (the public list is not cached for more than five minutes, §11).
- **Moving a public site makes it private** and says so on the form ("You've moved a public site, so it is private again until you confirm the new position."). The team member sees the confirmation page of §4.3 again to put it back. This costs a minute and prevents a typo from sending visitors to a stranger's door.
- **Retiring a public site** removes it from the public view at once.
- **Renaming a site, changing its notes or its colony** do not change visibility. Changing the **public label** of a public site is treated like a fresh public decision: the confirmation page appears again, because the label is the one thing a visitor reads.

### 4.6 What the switch does not protect against

Stated here because the charity should hear it from this document and not discover it, and because it is the spine's own caveat (§6.2, §6.7, and F2 in `DECISIONS.md`):

- **Cats cluster at feeding sites.** Averaging the blurred positions of the cats in a colony recovers its feeding site to about the width of a street, whether or not the site is public. Hiding the site row does not hide the cats. The switch is worth having and is never described as a guarantee, in the dashboard, the app or the privacy policy.
- **Making a site public does not make the colony public**, and this spec keeps it that way (§4.2). But the reverse is also true: nothing in this spec makes a private colony *safe*.
- **A public site and the app's own cats-near-me view sit close together on the map.** The cats are shown as blurred 250 m squares, and the site as an exact bowl. That reads correctly ("the cats are around here, the feeder is exactly there") but it also tells a watcher which of the nearby squares to walk to. This is a consequence of Syros Cats choosing to make a site public, and the confirmation page's line 4 says so in plain words.
