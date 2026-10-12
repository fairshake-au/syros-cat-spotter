# Feeding sites and colonies on the dashboard

**Feature spec · Cat Spotters (Syros)**
**Version:** 1.1, revised after adversarial review · 7 October 2026
**Covers:** PRODUCT-SPEC §2.6 (the feeding-site map, private by default with a per-site public toggle, and colony naming), and the part of §2.6's dashboard that `team-access-and-welfare-queue.md` §3.2 and §3.4 describe in a paragraph each.
**Linear:** SYC-209 (this spec) · SYC-43 (the dashboard it belongs to) · SYC-53 (roles: the source of truth for permissions, see §7) · SYC-22 and SYC-51 (QR codes that will point at sites, see §11) · SYC-67 (Syros Cats' acceptance of the location limits; the public sites' matching and photo risk is accepted by Samuel and no longer gates this spec, §4.6) · SYC-245 (Google Maps links, a precondition of §2.3) · SYC-255 (map-tile logging) · SYC-256 (erasing a guardian's name) · SYC-257 (what a phone may keep, settled in the roles spec).
**Status:** **Revised after adversarial review, and updated after Samuel's roles decisions of 12 October 2026 (see "Updated after the roles decisions" at the end). Decisions made and Syros Cats questions answered by Samuel, 12 October 2026; awaiting final approval.** The review is `docs/specs/reviews/feeding-sites-and-colonies-review.md`; section "Review outcome" at the end says how each finding was handled. Permissions follow `roles-and-invites.md` (SYC-53, §6.2 and §6.7), which wins on capability names. Written against `docs/specs/DECISIONS.md`, which wins wherever they differ.

### What this document owns, and what it borrows

This is the screen-and-behaviour spec for two things: the team's **feeding-site map** and the team's **colonies**. It does not define their records and it does not set the privacy rules. Those already have owners.

| What | Owner |
|---|---|
| The `feeding_sites` and `colonies` records, `colony_name_history`, the `colony` observation | `cat-record-data-spine.md` §10.5 |
| Feeding-site privacy: private by default, absent (never blurred) from public payloads, filtered in the query not the serialiser, **and the precision at which a public site is shown** | `cat-record-data-spine.md` §6.7 and its open question 3 |
| Cat location blurring (250 m cells), the colony-averaging limit, the nearest-cat oracle | `cat-record-data-spine.md` §6 |
| Team sign-in, the dashboard shell, capabilities, `person_scopes` | `team-access-and-welfare-queue.md` §2, §7, §8 |
| Which roles exist, the capability names, and which capabilities a cat guardian holds | **SYC-53**, `roles-and-invites.md` §6.2 (the catalogue) and §6.7 (what this spec cites) |

**What this document adds** and proposes the owners adopt (§12): the screens; the rule about what a public site's label may contain; the safeguards around flipping a site public; the public site card and map layer in the app; an add-only history of every change to a site or colony; and a short list of columns the spine's records need to carry for all of that.

**Two rules from the spine are repeated here only so no reader misses them.** A private site is *absent* from every public response: not blurred, not counted, not a heat patch. And switching a site off again does not undo what anyone has already seen.

---

## 1. The short version

Syros Cats already know where every feeding spot is. That knowledge lives in people's heads, in WhatsApp groups, and in the names they use on the phone: "Vaporia, Eleni's". The app is collecting photographs of cats from all over the island, and the team has no place to say "this is a feeding spot, these cats belong to it, this is who looks after it".

This spec gives them one:

1. **A map of every feeding site on the island, seen only by signed-in Syros Cats people** (and, once cat guardians have accounts, each guardian sees only her own colonies' sites). They add sites, move them when they were put in the wrong place, and retire them when a spot closes. Nothing is deleted.
2. **Colonies with the names they already use**, a place plus the cat guardian who looks after it, renamable by the team whenever a guardian changes, with a way to say which cats belong to which colony. A cat guardian can create a colony herself and becomes its guardian.
3. **One switch per site: private or public.** Private is the default, and it is how every site starts. A site goes public only when somebody on the team decides it should, one site at a time, after a screen that shows exactly what a tourist will see and reminds them why this matters. Making it public puts a bowl-shaped marker at its exact position on the map in the app, with a short note asking people to keep their distance. It does not publish the cats, the colony, the guardian's name or any note.
4. **A record of every change**: who moved, renamed, hid or exposed what, and when, so "how did that become public?" always has an answer.

**The thing that matters most is the one-sentence reason from the spine:** cat guardians face hostility from some neighbours, and known feeding sites attract people who abandon animals. The location of a feeding site is among the most sensitive facts in the whole app, because it leads people straight to cats. Everything below is shaped by that.

### The two audiences want the same thing from different angles

A cat guardian who has fed the same alley for nine years wants the charity to know that place exists, and to keep it quiet. A tourist standing in Kini wants to see where the real feeding spots are and help without doing harm. These needs are complementary, and the switch is where they meet: the guardian's quiet places stay quiet, and the places Syros Cats choose to be seen become a way for visitors to find the charity's work.

---

## 2. What the team sees and does

Everything here is a page on the existing team dashboard (`team.catspotters.com`), in the same style as the welfare queue and the cat pages: ordinary pages with buttons, drawn by the server. The top bar gains two links, **Feeding sites** and **Colonies**.

### 2.1 The Feeding sites page

The top of the page is a map of the island with a marker on every site. Below it is the same information as a list, because a list is faster when you already know the name.

- **Who sees what.** The text here describes the team's view. A cat guardian with an account sees only her own colonies' sites, counts and changes; §7.3 lists every item.
- **Markers show state at a glance.** A filled marker is a public site; an outlined one is private; a grey one is retired (hidden unless "Show retired" is ticked). There is a count above the map: "31 sites: 2 public, 28 private, 1 retired".
- **The list is sorted by name** and each row says: the site's name, its colony (or "no colony yet"), private or public, and the date it was last changed.
- **A "Recently changed" strip** under the count shows the last five changes to any site, with the person's name and the day. It is the quickest way to answer "did someone just change this?".
- **Tap a marker or a row to open that site.**

### 2.2 One site

A site's page shows, in this order:

1. **Its name**, and a small map centred on it.
2. **Visibility**: a plain sentence ("Private. Only Syros Cats people signed in here can see this place.") and the button to change it (§4.3).
3. **Its colony**, with a link, or a button to pick one.
4. **Its notes**, which are for the team only ("the gate is round the back"). Under the box: "Don't write when people come and go." And **"How to find it"**, an **optional** short line of directions in words ("down the steps by the blue gate, behind the bakery wall"), useful as a human hint beside the exact position. It is for the team and the colony's guardian only (§9). *Updated after Samuel's roles decisions (12 Oct 2026): it is no longer required for offline use, because a guardian's phone may now hold the exact position (§9).*
5. **History**: everything that has been done to this site, newest first, each line with the person and the date (§8).
6. **Actions**: *Edit details*, *Move on the map*, *Retire this site*. A team member also gets *Change colony* (island-wide power); a guardian instead gets *Ask the team to make this public* (§7.3).

### 2.3 Adding a site

A team member can start in three places, because people think about feeding spots in three ways:

- **From the Feeding sites page: "Add a site".** Pick the spot on the map (§3).
- **From a cat's page: "Make a feeding site here".** The cat's page already shows its sightings with exact positions to the team. A sighting is often the moment someone says "that's where she's fed". The button starts a new site pre-placed at that sighting, and the team member can nudge it before saving. **Precondition: SYC-245 must be done first.** Today the same cat page, the welfare queue and the welfare alert email link the exact sighting position out to Google Maps, so the spot has probably already been sent to Google before anyone makes a site of it. The button does not ship until those links are gone (or, as a fallback, are dropped for any sighting within 50 m of a site).
- **From a colony's page: "Add a feeding site to this colony".** The new site arrives already linked.

The form asks for: **a name** (the convention is a place plus the guardian, "Vaporia — Eleni's", the same as colonies), **which colony** (optional for the team; it can be added later; a guardian's is always her own), **how to find it** (optional) and **notes** (optional). It does not ask for anything public. A new site is always private. There is no way to create a site as public. A second way to place a site, for anyone who cannot use a tap (a keyboard or screen-reader user): type coordinates, with a warning "Don't copy these from a map company's site; ask a colleague who has been there" (§3).

### 2.4 Moving a site

"Move on the map" opens the same picker as adding, starting from where the site is now. Moving is for correcting a pin placed in the wrong spot, or for a feeding spot that really moved a few metres. The page asks for a short reason ("pin was on the wrong side of the road"). The old position stays in the site's history, readable by the team. If the site is in a guardian's colony she can move it too (`edit_feeding_site`); she cannot change its colony.

**If the site is public, moving it also makes it private again** until someone confirms the new position (§4.5). A wrong pin on a public site would point visitors at somebody's front door.

### 2.5 Retiring a site, and bringing it back

A feeding spot closes, a guardian stops, a spot is no longer used. **Retire this site** takes it off the map and out of every public view at once, whatever it was before. It asks for a reason, and the site stays in the list under "Show retired", with its full history. **Bring back** puts it back **as private**, never as public. Sites are never deleted from the dashboard, because the history of where the island has been fed is part of the charity's record.

### 2.6 The Colonies page

A list of every colony by name, with its cat guardian's name, how many feeding sites it has, and how many cats are in it (worked out by the same "newest active statement stands" rule as §2.8, so a cat marked "in no colony" is not counted). A search box finds a colony by any name it has ever had, so typing "Eleni" or an old name works.

**One colony** shows: its name; the guardian's name; how many sites and cats; its sites (with links); its cats (with photos); its team-only notes; and its history (renames, guardian changes, cats added and removed).

**"Recent guardian changes"** sits at the top of the team's Colonies page: the last twenty things cat guardians did here (colonies they created, sites they added or moved, cats they added or took out), each with the guardian's name and the day, and a link to the colony. It exists so the team can notice anything odd quickly (see the accepted risk in §7.3).

### 2.7 Naming and renaming a colony

- **Creating a colony** (*Updated after Samuel's roles decisions (12 Oct 2026): cat guardians can create colonies, because a guardian who finds a place nobody has recorded should be able to record it herself, without waiting for the team*). A team member gives a name and, optionally, the guardian's name and notes. A **cat guardian** gives a name and notes only: **she becomes the colony's guardian automatically**, her own name is filled in as the guardian's name, and the colony is hers from the moment she saves, with no step in between. She names it herself when she creates it. The page shows the convention: *a place and the person who looks after it, like "Vaporia — Eleni's"*. It checks the name is not already taken, ignoring capitals, accents and the final-sigma difference, using the same folding as cat names. If it clashes, a team member's page says which colony already has the name and links to it, as the cat rename does. Anyone whose rights do not cover that colony, a guardian included, only gets "That name can't be used", with no link and no colony named (§7.3).
- **Renaming stays with the team** (`rename_colony`). A guardian names a colony once, when she creates it; if it later needs a different name she asks the team, who rename it (and the old name stays findable, below). Same form for the team. Everything points at a colony by its number, never its name, so renaming moves nothing: its cats, its sites, any QR code (§11.6) stay attached. The old name goes into the colony's name history, so searching for it still finds the colony, and so a future import (`records-import.md`) still matches.
- **Changing the guardian** is an edit of the guardian's name (`edit_colony`) and, normally, a rename to match (`rename_colony`). **If any of the colony's sites is public, changing the guardian makes those sites private until someone re-confirms them** (§4.7). The two fields are separate on purpose: the name is how the colony is *spoken about*, the guardian's name is who to ring, and they do not always change together.
- **Names are proper names.** They are stored once, as typed, and shown exactly like that in every language. "Vaporia — Eleni's" is never translated.

### 2.8 Putting cats in a colony

A cat belongs to a colony because the team or that colony's cat guardian said so (*Updated after Samuel's roles decisions (12 Oct 2026): a guardian decides alone which cats are in her colonies, and nobody approves it*). That statement is a `colony` observation on the cat, written by the same rules as every other statement (`cat-record-data-spine.md` §10.5, §10.1): signed, dated, attributed, never edited, never deleted. The team writes them for any colony and a guardian writes them for her own colonies (`assign_cat_to_colony`, a placed power, §7.2). A guardian's takes effect at once: there is no "propose" step and no waiting for the team. There is no approval queue for colony membership at all.

Two ways in, because there are two jobs:

- **From the colony page, "Add cats":** a search box that finds cats by name or SYR number; each result has a tick box and shows which colony, if any, the cat is in now (to a guardian, a cat in a colony that is not hers shows only "in another colony", with no name). A guardian can only add to a colony she holds. Tick several and press *Add the ticked cats*. Each cat gets its own statement. (This is not a bulk privacy action; it changes which cats are listed together. For a guardian it also means she can see those cats' exact positions, which is the accepted risk in §7.3.)
- **From a cat's page, "Colony":** choose one from a list of all colonies. One tap, one statement.

**The rule for "which colony is a cat in".** The newest active colony statement stands. A statement may name a colony, or it may say **"in no colony"** (an explicit value, `colony { colonyId: null }`, which the data spine's `colony` observation gains; `roles-and-invites.md` §17.1 point 4 asks for the same amendment). "In no colony" is an ordinary new statement, not an erasure.

Two separate buttons, because they mean different things:

- **Take out of this colony** writes a new "in no colony" statement. The cat's earlier colony stays in its history as true-at-the-time. A guardian can do this for a cat in her own colony, with immediate effect.
- **A cat that is in somebody else's colony.** If a guardian adds a cat that another colony currently holds, the cat moves to hers at once (the newest statement stands) and the other colony's guardian is not asked, but she is told ("Mimi has moved to another colony") without being told whose. The move is in the history and the team's "Recent guardian changes" list (Decision 14, decided).
- **Mark wrong** (with a reason, exactly as the correction forms already work for life status and sterilisation) means "this was never true". It is a correction made by the team; a guardian who added a cat by mistake simply takes it out. The marked statement stops counting, and **the next newest active statement stands**. So if a cat was moved from colony A to colony B and the team marks the B statement wrong, the cat is back in A. If there is no earlier statement, it is in no colony.

**Moving a cat between colonies** writes a new statement; the cat's page then shows both, with the newest standing.

**A colony statement is not evidence of life** and moves no derived status (`cat-record-data-spine.md` §10.5). Putting a cat in a colony never changes whether it is shown as alive, sterilised or anything else.

---

## 3. Picking a spot on the map

Placing and moving sites is the one place the dashboard's plain-pages design strains, because a map normally needs scripts and the dashboard deliberately has none (`script-src` is absent from its security header, and pictures may come only from the dashboard's own address). This spec keeps both rules and makes the map out of ordinary pages. The technique needs no change to the header: a picture button that posts to the same address needs only `img-src 'self'` and `form-action 'self'`, and markers placed by an inline style are allowed by the header's existing `style-src 'unsafe-inline'`.

- **The map is a grid of map tile pictures**, fetched by the server on the dashboard's behalf and served from the dashboard's own address, so the browser never talks to a map company.
- **Tiles are drawn at a fixed size and never shrunk.** A browser reports the tap point in the picture's *displayed* pixels, so if a phone shrank the picture the server would compute the wrong place. On a 390 px phone (358 px of room after margins) the map is therefore a single column of tiles, or 2x2 tiles of 179 px drawn from a server-made double-size mosaic at exactly that size, never a sideways-scrolling page and never a squeezed picture. The 390 px check (test 20) asserts the displayed size equals the server's assumed size.
- **Markers are links** laid over the tiles. Tapping a marker opens that site.
- **To place a spot, each tile is itself a button.** A browser sends the exact point you tapped within an image button. The server turns that point into a position. There is no script involved. **Whether every phone browser sends that point the same way is checked before the plan is approved**, in Safari on iPhone, Chrome on Android and Firefox (test 17); this spec does not assume it.
- **Tap accuracy, stated honestly.** A fingertip is about 40 CSS pixels wide; at the closest zoom on Syros that is roughly 10 metres. That is good enough to choose a spot, and the confirmation page lets the person nudge it. It is not "a few metres".
- **A second way in for anyone who cannot tap:** typed coordinates, with a warning not to copy them from a third-party map. This also serves keyboard and screen-reader users, for whom tap-to-place is impossible.
- **Moving around is by links:** *Zoom in*, *Zoom out*, and the island's main areas as quick links (Ermoupoli, Vaporia, Kini, Galissas, Finikas, Posidonia, Azolimnos and so on; the list is configuration). The page starts at a close zoom when it is opened from a cat or a colony.
- **No site page links out to another company's map.** Opening a feeding site's coordinates in a third-party maps service would tell that company where the site is. Positions are shown only on the dashboard's own map. (The dashboard cat page does link sightings out today; SYC-245 removes that, and is a precondition of the "Make a feeding site here" button, §2.3.)
- **Tile requests are kept out of the logs.** A tile address contains the position to within about 75 metres at the closest zoom, so logging it logs where a site is every time its page opens. The log rules log tile requests as `/api/team/map-tiles/:tile` and nothing more; this is **SYC-255**, which must be done before the map ships (§11.4).
- **After a tap, a confirmation page** shows a marker on the tapped spot, a small map around it, and the name form. Nothing is saved until *Save* is pressed.

**This is the cheapest correct answer, not the best-looking one.** It is slower to pan than a map people can drag. Decision 1 (§13) lists the alternatives and why this is recommended; the page the team sees is designed so a better map can be swapped in later without changing anything else in this spec.

---

## 4. Private by default, and what the switch really does

### 4.1 The rule

Every feeding site is created private. A site is public only after a named team member has deliberately made it so, with the date recorded. There is **no bulk action**: not "make all of this colony public", not "make all public", not an import that sets visibility. Adding many sites at once is possible (§13 Decision 11); making them public never is.

### 4.2 What "public" exposes, and to whom

*To whom:* to **everyone**. The app has no sign-in, and its public data is also available to anyone who asks the server directly, with or without the app. A public site can be seen by a tourist, a local, a journalist, a neighbour who dislikes the cat guardians, and a person who wants to leave a box of kittens somewhere. There is no "just to app users" setting, and the screen says so.

*What:* exactly the fields in this table, and nothing else.

| Field | Private site | Public site |
|---|---|---|
| That the site exists | Not visible. Not blurred, not counted, not a heat patch | Visible |
| Where it is | Team only, exact | **Exact position, as the data spine rules** (`cat-record-data-spine.md` §6.7). If Syros Cats choose blurred instead (the spine's open question 3), only the one function that decides the published position changes (§11); nothing in this spec does |
| Its public label | Not visible | Visible. Written separately from the internal name (§4.4) |
| Its internal name | Team only | **Never visible** |
| Its colony, the colony's name, the guardian's name | Team only | **Never visible** |
| Which cats use it | Team only | **Never visible**: no names, no photos, no list (Decision 3, §13) |
| How many cats use it | Team only, exact | **A rough count only, in bands** ("About 10 cats use this spot"), never the exact number (Decision 3, §4.8) |
| Notes | Team only | **Never visible** |
| Who made it public, and when | Team only | **Never visible** |
| A number that identifies it | Team only (internal) | A random public code, with no link to how many sites exist (§11) |

### 4.3 Making a site public: the confirmation page

The button on a site's page says **Make public…**. It does not make it public. It opens a page with:

1. **A preview of exactly what visitors will see:** the marker on a small map, and the card that opens when it is tapped, in English, Greek and French, built from the real public label **and the real rough count for this colony today** (for example "About 10 cats use this spot", §4.8), so the person sees the number words a visitor will read.
2. **A plain list of what this will do:** "Anyone in the world will be able to see where this feeding spot is, to the metre, from today."
3. **The reason, in one line:** "Cat guardians can face hostility from neighbours, and places where cats are fed are where people sometimes leave animals they don't want."
4. **What it will and will not do**, because people will assume the cats stay hidden: "The cats here stay as blurred squares on the map, but anyone who knows this spot can match photos of cats to it. Treat a public spot as telling people that cats live here. It does not reveal anything else about this place." It then adds, because the card now carries a rough count: "The card tells people roughly how many cats use this spot (for example 'About 10'). That tells anyone how many animals are at this exact place, and may make someone look for them." (§4.6 explains the ways this happens.)
5. **One honest caveat, from the spine:** "Switching this off later stops new people from seeing it. It cannot take it back from anyone who has already looked."
6. **A tick box the person must tick:** *"The cat guardian for this place knows, and is happy for it to be public."* (Decision 5, §13.)
7. **The public label field**, which must be filled in and is checked against §4.4.
8. **A button: Make public.**

Pressing it records the change and who made it; the site's page then says "Public since 14 October, by Maria."

Only someone who holds `set_site_public` (an island-wide team power, §7.2) can do this. There is no second-person approval (Decision 5 considers one).

### 4.4 The public label is written separately

A site's internal name follows the charity's own convention and so contains the guardian's name: "Vaporia — Eleni's". Publishing that would publish a private person's first name next to an exact place. So:

- **A public site has a *public label*, a separate field, required before it can go public.** Examples: "Kini harbour feeding spot", "Vaporia seafront".
- The confirmation page rejects a label that fails any of these rules, each written out so it can be tested. Names are compared after folding accents, case and the final sigma.
  1. It contains the site's **own internal name minus the place words**: take the internal name, remove the words that name only a place ("Vaporia", "Kini"), and reject if what is left (normally a person's name) appears as a whole word in the label. So "Vaporia seafront" passes and "Eleni's corner" fails.
  2. It contains **any word of the current guardian's name or of any earlier guardian's name** in the colony's name history. A site with no colony has no guardian to check, and cannot go public anyway (§4.7).
  3. It **looks like an address**: a word and a number side by side ("Ermou 12", "Ερμού 12", "12 Ermou"), in Latin or Greek letters. The usual Greek form has no street word, so the rule is "a word and a number side by side", not "a street word followed by a number".
  The check is a guard against accident, not a promise: the person is still responsible for what they type.
- The label is the same in every language. It is a place name, like a colony name. If Syros Cats want a Greek and an English label for the same place, that is a later request (§13 Decision 10 notes it).

### 4.5 Switching off, moving, and retiring a public site

- **Make private** is one tap, with a one-line confirmation, no preview and no tick box. It is the safe direction and is never made harder. It takes effect for new requests immediately (the public list is not cached for more than five minutes, §11). The confirmation adds: "Take down any QR sticker at this place."
- **Moving a public site makes it private** and says so on the form ("You've moved a public site, so it is private again until you confirm the new position."). The team member sees the confirmation page of §4.3 again to put it back. This costs a minute and prevents a typo from sending visitors to a stranger's door.
- **A new public code after a move or a retire.** A site gets a **new public code** whenever it is made public at a position more than 10 metres from where it last stood in public, and always when it is made public again after being retired. Without that, a watcher saving the public list every few minutes would see one code vanish from spot A and return at spot B, and learn where a harassed cat guardian's feeding spot went. The old code (or codes) are kept in a team-only list so the history can show them. **An old code answers exactly like a code that never existed** (`feedingSpotGone`, §11.3), so a printed sticker at the old spot no longer finds the new one. The confirmation page for any re-publish after a move says: "Old QR stickers for this place will stop working. Take them down." A site made private and public again **with no move** keeps its code; this is a choice, set out in Decision 6, because it tells a watcher "the same spot, quiet for a while, now back".
- **Retiring a public site** removes it from the public view at once, and the retire confirmation adds: "Take down any QR sticker at this place."
- **Renaming a site, changing its notes** do not change visibility. Changing the **public label** of a public site is treated like a fresh public decision: the confirmation page appears again, because the label is the one thing a visitor reads. **Changing a site's colony, or the guardian of its colony, while it is public** also forces the confirmation page again (§4.7).

### 4.6 What the switch does not protect against

Stated here because the charity should hear it from this document and not discover it, and because it is the spine's own caveat (§6.2, §6.7, and F2 in `DECISIONS.md`):

- **Cats cluster at feeding sites.** Averaging the blurred positions of the cats in a colony recovers its feeding site to about the width of a street, whether or not the site is public. Hiding the site row does not hide the cats. The switch is worth having and is never described as a guarantee, in the dashboard, the app or the privacy policy.
- **Making a site public does not make the colony public**, and this spec keeps it that way (§4.2). But the reverse is also true: nothing in this spec makes a private colony *safe*.
- **A public site and the app's own cats-near-me view sit close together on the map.** The cats are shown as blurred 250 m squares, and the site as an exact bowl. That reads correctly ("the cats are around here, the bowl is exactly there") but it also tells a watcher which of the nearby squares to walk to.
- **Two channels tie named cats to an exact bowl, and the blurred squares do not stop them.** (1) *The matching service.* When someone submits a sighting, the app picks match candidates by exact distance within 500 m and sends back the cat's number, name and photo (`DECISIONS.md` Part 2h, accepted as Samuel's risk when no public sites existed). With a public exact bowl, a hostile person no longer needs to guess where to probe: he can submit a cat's public photo at the bowl's exact spot and read back which named cats live within 500 m. (2) *The photos.* The background of a photo is never blurred (spine §6.4.5). Once the bowl is public at its exact spot, any public photo taken at that bowl (the wall, the gate, the bowl itself) has an exact place. So the honest statement is that **a public spot tells people that cats live here and lets them match photos of cats to it**. It is a consequence of Syros Cats choosing to make a site public, and the confirmation page's line 4 says so in plain words (§4.3). The Part 2h risk acceptance was made before public sites existed. **Answered (Samuel, 12 October 2026): accepted.** Samuel accepts the matching-service and photo risk for public feeding sites: public sites go ahead as specced, published one at a time by the team, and nothing more is asked of Syros Cats about it.
- **A rough count of cats at an exact bowl (Decision 3, decided 12 October 2026).** **What this choice accepts:** a public site's card says "About N cats use this spot". Together with the exact position, that tells anyone how many animals are at one exact place, and invites a visitor to look for them. What limits it: the number is rounded into bands and never exact (§4.8); it counts only cats alive and seen in the last 12 months; it never comes with names, photos or a list; and a site's card is still switched on one site at a time by the team, who see the real band in the preview before they press the button. It is not a promise that this many cats will be found, and a site is not made safer by the rounding, only less precise.

### 4.7 When the guardian or the colony changes under a public site

The "cat guardian knows" tick (§4.3) is a statement about a particular person and a particular place. So it goes stale when either changes.

- **If a colony's guardian name changes while any of its sites is public, those sites go private at once** until someone re-confirms on the §4.3 page, with the new guardian named. The history records "made private automatically: guardian changed". (Chosen over a warning banner because a banner can be ignored; Decision 5 weighs the two.)
- **If a public site is moved to another colony** (which only the team can do, `reassign_feeding_site`), it goes private in the same way.
- **No site goes public without a named guardian.** A site with no colony, or whose colony has no guardian name, cannot be made public. If Syros Cats are themselves responsible for a place and no guardian exists, that is a later request, not a loophole: the tick would have to read "Syros Cats are responsible for this place", and the history would record which wording was used.


### 4.8 The rough count of cats (Decision 3)

**Decided (Samuel, 12 October 2026): a public site shows a rough count, "About N cats use this spot".** It is never exact and never comes with anything that identifies a cat.

- **What is counted.** Cats in the site's colony that are alive and were last seen within the last 12 months, worked out on the server from the cat records (`cat-record-data-spine.md` §10.5 colony statements and life status; a cat marked "in no colony" is not counted). Presumed-deceased, deceased, homed and in-care cats are not counted. A site with no colony cannot be public (§4.7), so it never has a count.
- **The bands.** The server turns the number into one of five bands and sends the band, never the number:

| Real number | The card says |
|---|---|
| 1 to 4 | "A few cats use this spot." |
| 5 to 7 | "About 5 cats use this spot." |
| 8 to 12 | "About 10 cats use this spot." |
| 13 to 19 | "About 15 cats use this spot." |
| 20 or more | "20 or more cats use this spot." |

- **Zero shows nothing.** If no cat qualifies, the card has no count line at all (it does not say "no cats", which would be a claim about a place).
- **Never names, photos or a list.** Only the band. The colony's name, guardian and exact count stay team-only (§6).
- **The wording is about the colony, not the bowl.** Every public site of one colony shows the same band, because the count is the colony's. That is a judgement call recorded for Samuel: a colony with two public bowls would say the same thing at both.
- **Where it is worked out.** In the one query that builds the public list (§11.3), so the exact count never leaves the server and is never written to a cache. The band changes only when a cat crosses a band edge (for example the fifth cat), so a watcher who saves the list every few minutes can learn when that happens; that is accepted and is part of §4.6.

---

## 5. What spotters and tourists see when a site is public

The app has no sign-in and no roles. A tourist, a spotter and a local resident are the same reader (`cat-record-data-spine.md` §6.5), and they all see the same thing.

- **A "Feeding spots" layer on the map**, on by default, with a switch to hide it. Each public site is a bowl-shaped marker at its exact position. Cats are still drawn as their blurred 250 m squares, and the two are visibly different things.
- **Tapping a marker opens a small card** with the public label and five short lines: who looks after the cats here, **a rough count ("About 10 cats use this spot", §4.8; absent when it would be zero)**, give them room, please don't leave food, and a link to "See how you can help" that opens the Help tab. The card never says when anyone feeds, never lists cats, never shows an exact number, never names a person.
- **Distance is worked out on the phone**, from the phone's own location and the public position, so the server never learns where a visitor stood.
- **The spot flow is unchanged.** A sighting made near a public site is matched and recorded exactly like any other. No screen says "you are near feeding spot X", and a public site is never used to decide which cat a photo shows.
- **A site made private or retired disappears from the layer** the next time the phone is online (§9 gives the exact rule).

### 5.1 What the card asks of visitors

The card must not contradict the app's existing first lesson, which tells every new user that scraps make cats sick and that the local cat guardians feed them properly. A marker that quietly invites people to bring food to a feeding spot would undo it, and would also crowd the colony. So the card says to give the cats room and not to leave food, and offers help in the ways the charity actually wants (the Help tab). Decision 13 (§13) settled it: **Decided (Samuel, 12 October 2026)**, option A, "Give the cats room, please don't leave food, see how you can help".

### 5.2 The words, in three languages

New strings in `artifacts/cat-spotter/lib/i18n.ts`, in all three languages with the usual parity test. The Greek and French are drafted by us and go to the native-speaker review that already exists for the other new strings (SYC-4); they use the app's existing words for "cat guardian" in each language and the same friendly "you" the rest of the app uses.

| Key | English | Greek | French |
|---|---|---|---|
| `feedingSpotsLayer` | Feeding spots | Σημεία σίτισης | Points de nourrissage |
| `feedingSpotMarkerLabel` | Syros Cats feeding spot: {label} | Σημείο σίτισης της Syros Cats: {label} | Point de nourrissage de Syros Cats : {label} |
| `feedingSpotBody` | Cat guardians look after the cats here. | Οι κηδεμόνες γατών φροντίζουν τις γάτες εδώ. | Des gardiens de chats s'occupent des chats ici. |
| `feedingSpotCatsFew` | A few cats use this spot. | Λίγες γάτες χρησιμοποιούν αυτό το σημείο. | Quelques chats fréquentent cet endroit. |
| `feedingSpotCats5` | About 5 cats use this spot. | Περίπου 5 γάτες χρησιμοποιούν αυτό το σημείο. | Environ 5 chats fréquentent cet endroit. |
| `feedingSpotCats10` | About 10 cats use this spot. | Περίπου 10 γάτες χρησιμοποιούν αυτό το σημείο. | Environ 10 chats fréquentent cet endroit. |
| `feedingSpotCats15` | About 15 cats use this spot. | Περίπου 15 γάτες χρησιμοποιούν αυτό το σημείο. | Environ 15 chats fréquentent cet endroit. |
| `feedingSpotCats20` | 20 or more cats use this spot. | 20 ή περισσότερες γάτες χρησιμοποιούν αυτό το σημείο. | 20 chats ou plus fréquentent cet endroit. |
| `feedingSpotSpace` | Keep a step or two back and let them come to you if they want to. | Κράτα ένα-δυο βήματα απόσταση και άσε τες να έρθουν σ' εσένα, αν το θέλουν. | Reste à un pas ou deux et laisse-les venir à toi s'ils en ont envie. |
| `feedingSpotNoFood` | Please don't leave food. Scraps make cats sick, and the cat guardians feed them properly. | Μην αφήνεις φαγητό. Τα αποφάγια αρρωσταίνουν τις γάτες, και οι κηδεμόνες γατών τις ταΐζουν σωστά. | Ne laisse pas de nourriture. Les restes rendent les chats malades, et les gardiens de chats les nourrissent correctement. |
| `feedingSpotHelp` | See how you can help | Δες πώς μπορείς να βοηθήσεις | Vois comment tu peux aider |
| `feedingSpotGone` | This feeding spot isn't on the map any more. | Αυτό το σημείο σίτισης δεν υπάρχει πια στον χάρτη. | Ce point de nourrissage n'est plus sur la carte. |

`feedingSpotGone` is what a QR scan or an old link shows for any code that is not currently public. It is identical for a site that is private, retired or never existed (§11).

**Nothing on the card is claimed beyond what is true of every public site by definition.** It says cat guardians look after the cats *here*, which is why Syros Cats listed the place. It does not say all the cats are fed, watched or known (that sentence was cut from onboarding for being not necessarily true).

---

## 6. Colonies and the public

**Nothing from the `colonies` table is public**: not the name, not the guardian, not the centre, not the notes, not the exact count of cats, not that a colony exists. (The one derived thing a public site carries is a rough band of the colony's cats, §4.8; the exact number never leaves the server.) The colony centre is team-only because publishing it would hand over for free the thing the spine's accepted colony-averaging limit is about (§6.2, §10.5). A public site's link to a colony is invisible to the public by the same rule.

Public copy elsewhere follows the same rule: the Help tab's campaign text (`lib/campaign.ts`) must never use a colony's internal name or its guardian's name (its default title is a public colony name today and is changed in the same plan), and a test checks that no public string contains one.

**One exception is waiting, and is not decided here:** SYC-22 wants a QR scan at a Kini feeding spot to land on "that colony's cats". That is a public page about a colony, with cats shown in relation to an exact place. It reopens the question Syros Cats accepted in F2. §11.6 lists what that ticket must settle first, and Decision 3 (decided: a rough count and nothing more) means nothing of the kind ships with the switch.

---

## 7. The cat guardian and their sites

A cat guardian is the person a colony and its sites are named after. Most have no account and never will; some will have a dashboard account when invited roles exist. This spec treats both.

### 7.1 Without an account

A guardian with no account appears as **text**: the `guardian_name` on a colony (the spine's deliberate choice, §10.5). The team keeps it up to date. Nothing sends them mail, shows them anything or makes them accountable for anything. Their consent to a site going public is recorded by the team ticking the box in §4.3, which is how the charity would naturally ask ("Eleni, are you happy for the Kini feeding spot to be on the app?").

### 7.2 With an account (SYC-53)

`roles-and-invites.md` (SYC-53) decides which roles exist and is the **single list of capability names** (its §6.2). **This spec adds no capability of its own.** Its screens call the catalogue names below. The working names an earlier draft of this spec used map onto them as SYC-53 §6.7 says: `manage_feeding_sites` is `add_feeding_site`, `edit_feeding_site` and `reassign_feeding_site`; `manage_colonies` is `create_colony`, `edit_colony` and `rename_colony`; `set_cat_colony` is `assign_cat_to_colony`, held by the team for every colony and by a guardian for her own. `propose_colony_change` no longer exists (*Updated after Samuel's roles decisions (12 Oct 2026)*).

*Updated after Samuel's roles decisions (12 Oct 2026): there is one team role, the Syros Cats team, covering the whole island. Volunteers and staff are the same role, so this spec has no volunteer-specific rule, screen or test. Below the team there is only the cat guardian, who holds her own colonies. Management is the team plus the power to manage people, which nothing in this spec needs (§7.5).*

"Placed" means the check is made against one colony (for a site, the site's own colony, read from the record and never from the request). "Island-only" means only the team, whose roles cover the whole island, holds it.

| Capability (SYC-53 §6.2) | Kind | The team (and management) | Cat guardian | What it allows here | Screens |
|---|---|---|---|---|---|
| `view_exact_location` | Placed | All | Own colonies | See sites (private ones included) and their exact positions; the map | Feeding sites page, site page, colony pages, map |
| `add_feeding_site` | Placed | All | Own colonies | Add a site to a colony. Always private | §2.3 |
| `edit_feeding_site` | Placed | All | Own colonies | Rename, change notes, change the "how to find it" line, move, retire, bring back. **Cannot change which colony the site belongs to** | §2.2, 2.4, 2.5 |
| `reassign_feeding_site` | Island-only | Yes | No | Change which colony a site belongs to | §2.2 |
| `set_site_public` | Island-only | Yes | No | Make a site public or private; change a public label | §4 |
| `request_site_public` | Placed | No | Own colonies | Ask the team to make a site public. Changes nothing by itself: it adds a "site-public request" to the team's "Needs an OK" list (SYC-53 §7) | §7.3 |
| `create_colony` | Held by everyone listed (a new colony has no owner yet, so there is nothing to place the check against) | Yes | Yes. She becomes the new colony's guardian automatically | Create a colony, and name it at creation. *Updated after Samuel's roles decisions (12 Oct 2026)* | §2.7 |
| `edit_colony` | Placed | All | Own colonies | Edit the guardian's name text, notes and centre. Not the name | §2.7 |
| `rename_colony` | Island-only | Yes | No | Change a colony's name after it was created. A guardian names her colony when she creates it; renaming afterwards is the team's | §2.7 |
| `assign_cat_to_colony` | Placed | All | Own colonies | Put a cat in a colony, move it, take it out. A guardian does this alone, with immediate effect (the team does not approve it). *Updated after Samuel's roles decisions (12 Oct 2026)* | §2.8 |

Until SYC-53 is approved and built, every one of these checks behaves as "the team", which is what `can()` does today, so nothing in the team's half waits for it. A person who is signed in but lacks the capability gets the SYC-53 refusal: a quiet **403** page ("That part of the dashboard is for the Syros Cats team"), not the sign-in redirect. A person who is not signed in still gets the 401 and the sign-in page.

### 7.3 What a guardian sees and can do (agreed with SYC-53 §6.7)

Five rules, taken from SYC-53 §6.7 and Samuel's roles decisions of 12 October 2026:

1. **A guardian sees only her own colonies' sites.** Other sites are **absent**, not approximate, and the filtering is done **in the query**, not on the page. A guardian is a member of the public as far as other people's feeding spots go.
2. **A guardian can add a site only to a colony she holds, and it is always private.** She can correct a pin, change notes and the "how to find it" line, retire a closed spot and bring it back. **She cannot change which colony a site belongs to** (`reassign_feeding_site` is island-only): moving a private site into her own colony would let her read its position.
3. **No guardian can ever make a site public.** She uses `request_site_public`; the team decides. The recorded consent in §4.3 is how her voice enters.
4. **A guardian decides alone which cats are in her colonies** (*Updated after Samuel's roles decisions (12 Oct 2026)*): she adds and takes out cats herself (`assign_cat_to_colony`, her own colonies only) and it takes effect immediately. Nobody approves it. Being "near" a site still gives her no reach over any cat: she chooses cats by name or number, never by distance (the earlier "unassigned cats near their sites" idea stays dropped). The price is the accepted risk below: adding a cat shows her its exact position.

**Everything that must be filtered for a guardian.** The risk is not only lists of sites. Every screen below is entered with SYC-53's "held for any colony of hers" check (`canSomewhere`), and then **filtered by her colonies in the query**. A route that forgets to filter fails closed (SYC-53 §6.4).

| Screen or item | What a team member sees | What a guardian sees |
|---|---|---|
| Count above the map ("31 sites: 2 public, 28 private, 1 retired") | Island totals | Counts of her own colonies' sites only |
| Map and its markers | Every site | Her own colonies' sites only |
| Map tiles route | Any tile | Any tile (a tile reveals nothing; it still needs a session and the capability) |
| Feeding sites list and "Show retired" | Every site | Her own colonies' sites only |
| "Recently changed" strip | Last five changes anywhere, with names | Last five changes to her own sites only, and no other person's name beyond her colony's team members |
| Site page | Any site | Her own colonies' sites; any other id answers the same 403/"not found" page as an id that does not exist |
| Colonies page and search | Every colony, with guardian, counts | Her own colonies only. Other colonies' names, guardians and counts never appear |
| "Add a feeding site to this colony" | Any colony | Only a colony she holds |
| Pick-a-colony lists (a site's colony, a cat's colony) | All colonies | Her own colonies only, for putting a cat in one (§2.8). She cannot reassign a site to another colony. A colony she has just created is on the list at once |
| "Create a colony" button on the Colonies page | Shown | Shown. The new colony is hers from the moment she saves |
| Name clash when creating or renaming a colony | "Already used by [colony]", with a link | When she creates one, and for anyone whose rights do not cover that colony: only "That name can't be used", with no link and no colony named. She cannot rename |
| "Add cats" search, with "which colony the cat is in now" | Shown, with the colony's name | Shown for her own colonies. A cat in a colony that is not hers shows "in another colony", with no name and no link |
| Cat page colony line | Current colony name | Her own colony's name only; another colony shows as "another colony". Once a cat is in her colony she sees the cat page as for any cat of hers, with *Take out of this colony* |
| History on a site or colony | Full history | The history of her own sites and colonies, with positions (they are hers) |
| Public-site request button | Not needed | On her own sites, until the site is public |

A test for this is in §15 (test 21): a guardian of colony 1 never sees colony 2's name, guardian, count, sites, or even a message that distinguishes it from a colony that does not exist, on any page.

5. **Revoking a guardian keeps every record she wrote**, as SYC-53 states. Her sites and colonies stay; the guardian's name text is a team edit (§7.4).
6. **A guardian can create a colony** (*Updated after Samuel's roles decisions (12 Oct 2026)*), and becomes its guardian automatically. She cannot rename it afterwards (`rename_colony` is the team's) and cannot see or learn about any colony that is not hers.

**The accepted risk of rule 6, in plain words.** A guardian could create a colony anywhere on the island and add cats to it, and doing so shows her those cats' exact positions (the same is true of adding cats to a colony she already holds). Samuel has accepted that, because the alternative (asking the team for every new colony) would leave real places unrecorded. What stands in its place: **every change is in the history** (§8), with her name on it, and **the team's dashboard lists recent guardian changes** (§2.6) so something unusual is noticed. Nothing here stops the misuse in advance; it makes it visible afterwards.

### 7.4 A guardian's name is personal data

A guardian's first name next to a place is personal data about a person who is usually not a user of the app. It is held for the charity's own work, never public (§6), and never in any export without the team choosing to include it.

**It is stored in more places than the colony record.** The guardian's name appears in: the colony's `guardian_name` and its name history; site names that follow the same convention ("Vaporia — Eleni's"); the before and after of the `mapping_events` history (§8); and free-text notes, whose own example is "Maria goes on Tuesdays", a named person's routine at an exact place. And as drafted, the history table's trigger refused every update, so none of it could ever be erased.

**What this spec requires.** (1) The `mapping_events` history gets a redaction path like the one on observations: `redacted_at` and `redaction_reason`, with the trigger allowed to blank `before`, `after` and `note` and nothing else. (2) `colony_name_history` gets the same. (3) One "forget this guardian" action reaches all of these stores (colony, name history, site names, events, notes), with its own event. (4) A hint under every notes box: "Don't write when people come and go." (5) `privacy-policy.md` lists all of these stores. This work is tracked as **SYC-256** and is covered by SYC-208's anonymising; the plan for this spec must not ship `mapping_events` without the redaction path in it, because adding it afterwards means changing a trigger on a table that already holds names.

### 7.5 Two tiers: nothing here needs management

*Updated after Samuel's roles decisions (12 Oct 2026)*

There are two tiers above the guardian: the team, and management (the team plus the power to manage people: invite, remove, change roles). Every capability this spec uses in §7.2 is held by the team, so **nothing in this spec needs a management-only power**. Specifically: making a site public, renaming a colony, reassigning a site, retiring and bringing back, the "forget this guardian" action (§7.4) and reading the history are all ordinary team powers. If the roles spec later decides that "forget this guardian" should be management-only (it is a privacy action on a person), that is a one-line change in §7.2 and §7.4 and does not alter any screen.

---

## 8. Audit: who changed what, and when

Every change to a site or a colony is written as one row in a small add-only history, in the same transaction as the change, so the two always agree. Nothing in it is ever edited or deleted, with one exception: a redaction path that blanks a guardian's name when she asks to be forgotten (§7.4, SYC-256). It follows the pattern already chosen for hiding photos (`photo_visibility_events`, SYC-43 part 2 Decision 3): a history table, not an edited column, so "restore" never wipes "who hid it".

**What is recorded**, one row each:

| Event | Detail kept |
|---|---|
| Site created / seeded | Name, position, who (a person, or `system:seed` / `system:migration` for the first load and for sites that existed before this history did) |
| Site renamed / notes edited / colony changed | Before and after |
| Site moved | Old position and new position, and the reason |
| Made public | The label, the public code in force, **whether the guardian was recorded as aware** and which wording of the tick was used, who |
| Made private | Who, and whether it was automatic (the site was moved, changed colony, or its colony's guardian changed) |
| Public label changed | Before and after |
| Retired / brought back | Reason; the public code retired with it |
| Colony created / renamed / guardian changed / notes or centre changed | Before and after. For a colony a guardian created, "created by" is the guardian herself |
| Cat added to or taken out of a colony | Already a signed `colony` statement on the cat (below); the colony's history and the team's "Recent guardian changes" list read from it |

Cat membership changes need no extra table: each is a `colony` observation, already signed and dated, with `roleAtTime` and the person's id, and the cat's page already shows them.

**Who did it** is the person's id, linked strictly to the people list, and a person who has left stays in the history shown as "Maria (left)", exactly as welfare actions already do (SYC-43 part 2, Decision 7).

**Who can read it:** anyone with `view_exact_location`, because positions are inside it. The history holds exact positions, including positions of sites that are now private, and is therefore as sensitive as the sites. It is never in a public payload, a log line or an email.

**What the dashboard shows from it:** a site's own history (§2.2), a colony's history (§2.6), and the "Recently changed" strip (§2.1). There is no separate audit screen.

**Who looked.** Opening a site's page writes a small read record: person, site number, time, and **no position**. For the most sensitive data in the app this answers "who could have leaked this?" cheaply. It is deliberately not a log of every map or list view (a row per view would mostly be noise, as `roles-and-invites.md` §11.3 says of cat pages); it is site pages only.

**Guardian name in the history.** Every field in this table can hold a guardian's name, so the history has the redaction path of §7.4.

**What it does not do.** It records what the team did and who opened a site page, not what the public saw. Whether anyone saw a site while it was public is not knowable and not recorded.

---

## 9. What works with no signal

Stated precisely, as the other specs do.

**The dashboard.** Nothing on it works offline. Every page, including the map, is drawn by the server when opened, and every button sends a form. With no signal the page does not load, or a tap on *Save* fails with the browser's own "no connection" page, and nothing is recorded. There is no queue for team changes. In particular the map's tiles are fetched live. A person on a hillside with no data cannot place a pin; they write it down and place it later.

**What a cat guardian's phone may hold (the roles spec, `roles-and-invites.md` §12, Decision 12, which settles SYC-257). *Updated after Samuel's roles decisions (12 Oct 2026): this replaces the earlier "directions in words, no coordinates" rule.*** A guardian's phone may hold everything for her own colonies, **including the exact positions of her feeding sites**, and only for her colonies. The rules, which are the roles spec's:

- **72 hours from her last online load, counted by the server's clock**, not the phone's. A phone whose clock is wound back counts as expired.
- **Deleted, not hidden, the next time the page opens** after the 72 hours, or when the server says she is no longer a guardian of that colony.
- **Cleared on sign-out and on removal:** the sign-out response, and the response to a removed person's next request, carry `Clear-Site-Data`, which makes the browser throw the saved copy away.
- The saved copy lives on the dashboard's own web address (a saved page with its own storage), never in the public app. The app stays a public reader and never holds a private site.
- **A phone that is never opened again keeps its copy until the browser clears it.** The 72 hours stops the copy being *used* after it is next opened; it cannot reach into a lost phone. This is the residual risk the roles spec states, and it is stated here too.
- The team's own pages have no offline copy at all.

The live map still does not work offline: the saved copy lists each site with its position as text (and the optional "how to find it" line), not as map tiles. The app's own offline list of public sites (this spec's Decision 8) is unaffected and holds only public sites. The "how to find it" line (§2.2) is optional: a small text field on the site, written by the team or the guardian of that colony, and public to no one.

**The app's feeding-spots layer.** The phone keeps the last list of public sites it fetched, so the layer and its cards still work on a hillside with no signal, **for a limited time**:

- The list is stored under its own key, separate from the cats cache, with the time it was fetched.
- The key and the shape are versioned, so a change forces a re-fetch.
- **The app refreshes the list each time the map is opened while the phone is online, at most once every five minutes.** (If it refreshed only on a cold start, a phone left open for a week would never refresh.) Test 18 covers this.
- A stored list older than the limit (Decision 8: seven days is recommended) is **not shown**; the layer quietly disappears until the phone is next online. A site that was made private is therefore gone from a connected phone within five minutes of the next time the map is opened, and from an offline phone within the limit.
- If the phone has never fetched the list, there is nothing to show offline. The map tiles themselves are partly available offline (the app downloads Syros tiles), so the base map works; the markers need the list. The card's **"See how you can help" link opens the Help tab, whose campaign content is fetched from the server, so that link needs a connection**; the rest of the card works without one.

**What this does not claim.** It does not claim that the whole app works with no signal. A phone offline for longer than the limit shows no feeding spots, and a phone that already saw a site has already learned where it is; making it private afterwards cannot unlearn that (§4.5).

---

## 10. Languages: English, Greek and French

- **The public card and layer** (§5.2) are in all three languages, with the same key-parity test as the rest of the app and the same native-speaker review before launch.
- **The public label** (§4.4) is a place name and the same in all languages (Decision 10).
- **Colony and site names** are proper names, stored as typed and shown as typed everywhere.
- **The dashboard is in English**, as every dashboard page already is (the page shell, the welfare queue and the correction forms are English text drawn by the server). Syros Cats team members read and write both Greek and English; names and notes they type can be in either, and search folds accents, case and the final sigma, so `ΜΙΜΗ` finds `Μιμή`. There is no Greek–Latin look-alike matching (`DECISIONS.md` Part 2m, SYC-223). **Decided (Samuel, 12 October 2026, Decision 9): English only for the team's own pages.**
- **The confirmation page of §4.3 previews the card in all three languages** so that whoever presses the button sees exactly what a Greek or French visitor will see. The card's words live in one place only: the server imports the app's string file (`artifacts/cat-spotter/lib/i18n.ts`) rather than keeping a second copy, and the parity test covers both uses.

---

## 11. Technical notes

*For whoever writes the plan. Everything above is the product; this is the wiring.* Checked against `origin/main` at `c5ee36c`.

### 11.1 Columns and tables the feature relies on

The spine owns `feeding_sites` and `colonies`; the following are what this feature needs those records to carry. They are listed here so the spine's definition can be amended once (§12), not defined a second time.

**`feeding_sites`** (beyond the spine's §10.5 columns):
- `public_label` text, null until set; required before `is_public` can be true (check constraint).
- `directions` text, null: the optional "how to find it" line (§2.2). Words only; it is a hint, not a position, and nothing requires it (SYC-263).
- `public_id` text, unique, null until the site is first made public: a random 128-bit value. A site that has never been public has no public identifier at all, and the identifier is never derived from the internal number, so the public list and any QR code cannot be used to count or probe private sites. **A new `public_id` is issued whenever the site is made public at a position more than 10 metres from where it last stood in public, and always when it is made public again after being retired** (§4.5). A plain private-then-public cycle with no move keeps its code (Decision 6). Superseded codes go to `feeding_site_old_codes` (`site_id`, `public_id`, `retired_at`, `reason`), team-only, kept so the history can show them and so the public lookup can refuse them.
- `last_public_position` (lat, lng), team-only: where the site last stood in public, used to decide whether a re-publish needs a new code.
- `guardian_aware` boolean null: the last value of the §4.3 tick box.
- `retired_at`, `retired_by`: set when retired, cleared when brought back. A retired site is never public (check constraint).
- `updated_at`, used as the version for every write (§11.2).
- `made_public_by` and `made_public_at` hold the **latest** publish and are kept (not cleared) on make private; the history is the full record, and a test checks they agree with the newest "made public" event. `made_public_by` is `text` today and `people.id` is a `uuid`, so linking it to the people list is a **separate, checked migration step** (below), not an additive column.

**`colonies`**: no new columns are required. `colony_name_history` gains an optional `redacted_at` (§7.4).

**`mapping_events`** (new, add-only): `id`, `subject_kind` (`site` or `colony`), `subject_id`, `kind`, `person_id` (strict link to `people`), `actor_system` text (for `system:seed` and `system:migration`), `at`, `before` json, `after` json, `note`, `guardian_aware` boolean null, `redacted_at`, `redaction_reason`. **Exactly one of `person_id` and `actor_system` is set** (check constraint). A database trigger refuses updates and deletes, with one allowed update: a redaction that sets `redacted_at`/`redaction_reason` and blanks `before`, `after` and `note` only, as the `observations` trigger allows for redaction. (§7.4, SYC-256.)

**`site_page_reads`** (new, small): person, site number, time. No position (§8).

**The migration is not all additive, and the plan's first step is a count.** Before anything else, count `feeding_sites` rows on production: all of them, any with `is_public = true`, and any `made_public_by` that is not a valid uuid. The new rules ("public needs a label", "retired is never public") fail on deploy if a public row already exists, so any such row is made private (or labelled) by hand first. Changing `made_public_by` from text to a link is its own step, with a check that every value converts. Existing sites have no "created" event, so the migration writes one `system:migration` "existing" event per existing site, so "how did this become public?" has an answer for them too. Every existing site stays private, with no label and no public code.

### 11.2 Routes (all under `/api/team/`, server-drawn pages, no scripts)

Each follows the PR 4 pattern: a POST first runs `requireOrigin(TEAM_ORIGIN)`, then the capability check, then checks the body. A browser gets a `303` back to the page it came from with a message shown there, and anything else gets JSON. A bad form answers `400` naming fields only, never echoing what was typed. Every value drawn into a page passes `escapeHtml`. **Not signed in** answers `401 not_signed_in`; **signed in but lacking the capability** answers `403`, per `roles-and-invites.md` §6.4, because a 401 would send a guardian round a sign-in loop. The shared walk test (every `/api/team/*` route without a session returns the same `401`) gets the new routes added; SYC-53's walk test (every route, every role, compared with a table) covers the 403s.

**Entry versus filtering.** The existing `requireTeam(capability)` takes no colony. Placed capabilities are therefore checked in two parts: SYC-53's `canSomewhere` to get into a list page, and the colony taken **from the record** (never from the request) for anything that acts on one site or colony. List queries filter by the person's colonies **in the query** (§7.3).

| Route | Capability (SYC-53 §6.2) |
|---|---|
| `GET /api/team/sites` (list and map), `GET /api/team/sites/:id` | `view_exact_location` (placed) |
| `GET /api/team/sites/new`, `POST /api/team/sites` | `add_feeding_site` (placed; the colony named in the form must be one she holds) |
| `GET/POST /api/team/sites/:id/move`, `POST /api/team/sites/:id` (edit), `…/retire`, `…/restore` | `edit_feeding_site` (placed; target is the site's colony) |
| `POST /api/team/sites/:id/colony` | `reassign_feeding_site` (island-only) |
| `GET /api/team/sites/:id/publish` (the §4.3 page), `POST …/publish`, `POST …/unpublish` | `set_site_public` (island-only) |
| `POST /api/team/sites/:id/request-public` | `request_site_public` (placed) |
| `GET /api/team/colonies`, `GET /api/team/colonies/:id` | `view_exact_location` (placed; list filtered in the query) |
| `POST /api/team/colonies` | `create_colony` (held by the team and by guardians; for a guardian the same call also gives her the new colony, in the same transaction) |
| `POST /api/team/colonies/:id` | `edit_colony` (placed) for guardian name, notes, centre; `rename_colony` (island-only) for the name |
| `POST /api/team/colonies/:id/cats`, `POST /api/team/cats/:id/colony` | `assign_cat_to_colony` (placed; checked against the colony the cat is being put in, and for "take out" against the colony it is leaving, both read from the records) |
| `GET /api/team/map-tiles/:z/:x/:y.png` | `view_exact_location` via `canSomewhere` |

**Concurrent edits.** Every write to a site (visibility, move, retire, rename, label, notes, colony) is a conditional write on the `updated_at` the page showed (`WHERE id = … AND updated_at = <what the page saw>`), and answers "Someone already changed this." like the corrections do. Checking only `is_public` would let two people moving the same site, or one moving while another edits the label, both succeed.

### 11.3 The public endpoint

`GET /api/feeding-sites`, unauthenticated, no query parameters.

- **Filters in the query, not the serialiser**: `WHERE is_public = true AND retired_at IS NULL`, with an explicit column list. Private rows never enter a response object (`cat-record-data-spine.md` §10.5).
- **Returns only** `{ id: <public_id>, label, position, cats }`, where `cats` is one of five band keys (`few`, `about5`, `about10`, `about15`, `20plus`, §4.8) or absent when no cat qualifies; **ordered by `public_id`**. The band is worked out in the same query from the site's colony (alive cats seen in the last 12 months), so the exact number is never in a response object, a log or a cache. The order is stated and tested: an order by internal number or creation date would reveal which public site is older and when a new one was added, and "byte-identical" could not be tested.
- **Identical for every caller.** No ordering by distance, no filter by area or distance, no parameter that reaches into the data. A site's position comes from one function, `publishedSitePosition(site)`, which returns the exact position (the spine's §6.7) and is the single place to change if Syros Cats choose a blurred position (the spine's open question 3). A test fails if public code reads the site's latitude or longitude any other way (the test searches the public routes for `feedingSitesTable.lat` and `.lng` outside `publishedSitePosition`).
- **Cache headers short and public**: at most five minutes at any shared cache (the band is part of the cached body, never the exact count), so "make private" reaches new requests within five minutes at the outside.
- **Rate-limited like the other public reads.**
- **A lookup by public code** (for QR codes and shared links) filters `is_public AND retired_at IS NULL AND public_id = :code` **in the query**, so a private row is never read and timing cannot tell a private site from no site, and is rate-limited like the list. It answers `404` with the same body for a site that is private, retired, never existed, has a wrong code, **or has a superseded code** (a site moved or retired and re-published has a new code, and the old one answers exactly like an unknown one). Nobody can tell a private site from no site, and nobody can follow a feeding spot from its old code to its new one.

### 11.4 The map tiles

Served through `GET /api/team/map-tiles/…`, so the security header (`img-src 'self'`, no `script-src`) is unchanged and the browser never contacts a map company. The server fetches each tile from the map provider once, caches it (Postgres or disk, with a size cap), and sends it with a valid identifying `User-Agent`, as the provider's policy asks. The attribution line the provider requires is printed on every map page.

- **Cache headers.** Every dashboard response is `Cache-Control: no-store` today. Tiles are the one stated exception: `private, max-age=…`, never `public`, so a shared cache in front of the dashboard can never serve a session-gated route to someone else.
- **Logs.** The request logger removes query strings but keeps paths, so every tile address would be logged, and at the closest zoom a tile address is a position to within about 75 metres. Tile requests are logged as `/api/team/map-tiles/:tile` only. This is **SYC-255** and is done before the map ships.
- **Provider policy.** OpenStreetMap's tile policy allows light, cached use with a real identifying User-Agent and discourages bulk downloading. The app's own downloaded tiles (`lib/offlineTiles.ts`) are not a precedent, because bulk offline download is what the policy discourages. Volume here is a few team members a few times a week, which is within fair use; if volume is unclear, the paid provider `DEPLOYMENT.md` already budgets, or Decision 1 option C, is chosen from day one rather than later.

The provider's servers see the tile areas the server asks for, which are the areas the team look at. It is tied to the dashboard server's address, not to a person, but it is a small leak of "somebody is looking closely at these streets". Decision 1 lists the alternative (an island map set we host ourselves) that avoids it.

### 11.5 Writes to cats

`colony` is a known observation kind with a number-only value check. What the plan must handle:

- **The spine gains an explicit "in no colony" value** (`colony { colonyId: null }`), as the roles spec §17.1 also asks. Today `writeObservation` rejects a `colony` value unless `colonyId` is a number, so this is a change to the spine's value check, and the spine owns it (§12).
- The team correction layer (`lib/teamCorrections.ts`) refuses any kind that has no capability. `colony` must be added to **both** `capabilityFor` and the first, pre-lookup gate (`SUPERSEDE_CAPABILITIES`), or a person whose only power is assigning cats is refused before the lookup. It is gated by `assign_cat_to_colony` (placed, so the gate needs the colony as well as the capability), sharing code with the JSON route as the other corrections do. A guardian's statement takes effect at once; there is no pending state. `supersedeStatement` always writes a replacement of the same kind, so "Take out" writes the "in no colony" statement and "Mark wrong" supersedes with the previous active value; the rule is §2.8's.
- `teamCorrections.ts` hard-codes `roleAtTime: "staff"` (the old name for the team's role; the code should say "team", and `roles-and-invites.md` decides the stored value); a guardian's statement must carry her real role (`roleAtTime`), not the team's.
- The value check does not confirm the colony exists, so the writer must.

The team cat page currently shows a colony statement as "Put in colony 12". It should show the colony's current name (and its older name if it has been renamed since).

### 11.6 Hooks for SYC-22 and SYC-51

Printed codes should carry the **public code** of a site (§11.1) or, later, of a colony page, never an internal number, so a printed sticker survives a rename and cannot be used to count private records. A code for a site that is not currently public, **or whose code has been superseded**, lands on `feedingSpotGone` (§5.2) and nothing else. A move or a retire therefore also means taking the old sticker down (§4.5). SYC-51's launch materials point at the app and need none of this. SYC-22 must settle, before it builds a colony page: what such a page shows about cats at an exact place (Decision 3 decided only the rough count on the card, not a colony page), whether the colony needs its own public code, and whether a colony page needs anything beyond what Samuel has accepted for public sites, because it is the first public thing that ties cats to a specific spot.

**The public half is not gated on SYC-67.** Answered (Samuel, 12 October 2026): accepted (the matching-service and photo risk, §4.6). The public switch, the public endpoint and the app layer ship after launch, per Decision 2, with no wait for a recorded acceptance from Syros Cats. (The earlier gate, finding 12 of the review, is removed.) The confirmation page and the cards still say plainly what a public spot tells people (§4.3, §4.6, §4.8).

### 11.7 Phone cache

A new key alongside `cat-spotter/cats-cache/public/v2`, for example `cat-spotter/feeding-sites-cache/public/v1`, storing `{ fetchedAt, sites }`, with the age check of §9 and the refresh rule of §9 (each time the map is opened while online, at most every five minutes).

### 11.8 The seed

The first load of sites, if Decision 11 goes the recommended way, runs by the safe route in Decision 11: the sites are placed on the dashboard by Syros Cats themselves, or sent as names and rough areas only. If a file of positions turns out to be unavoidable: it is **never committed** (a `.gitignore` rule and a check in the seed script that refuses a file inside the repository), it is loaded from a scratch location, it is deleted after loading, and it is never pasted into an agent session. Every site is private; each gets a `mapping_events` row with `actor_system = 'system:seed'` (added to the app-written authors list, as the other system writers are), with no copy of the file. It never sets visibility.

---

## 12. Proposed `DECISIONS.md` entries, and asks of the other specs

Nobody edits `DECISIONS.md` from this branch. For Samuel to carry across on approval:

**Proposed DECISIONS.md entries**

1. **Feeding-site map and colony screens are specified in `feeding-sites-and-colonies.md`.** Ownership table: that document owns the screens and the public site card; the data spine still owns the records, privacy and precision; `roles-and-invites.md` owns the capability names.
2. **A public site has a separate, required public label.** The internal name (which follows the "place — guardian" convention) is never published.
3. **Making a site public takes a confirmation page, a preview of what visitors see, and a recorded "the cat guardian knows" tick.** There is no bulk action and no import that sets visibility. It needs a named guardian, and is re-confirmed when the guardian or the colony changes.
4. **Moving a public site makes it private until reconfirmed, and gives it a new public code. Retiring removes it from public view and retires its code.**
5. **Nothing from `colonies` is public.** Not names, guardians, centres, notes or exact counts. (The one derived exception is the rough band on a public site's card, entry 11.)
6. **Every change to a site or colony is recorded in an add-only history** (`mapping_events`), linked to the people list, with a redaction path for a guardian's name.
7. **The public sites endpoint returns an opaque code, label and position only**, ordered by code, identical for every caller, with a short shared-cache lifetime. A lookup for anything not currently public, or for a superseded code, answers identically to an unknown code.

8. **Cat guardians can create colonies and become their guardian automatically; renaming afterwards is the team's.** (*Updated after Samuel's roles decisions (12 Oct 2026)*, reason: a guardian who finds an unrecorded place should be able to record it. Accepted risk: she could create a colony anywhere and add cats to see their positions; every change is in the history and the team's dashboard lists recent guardian changes.)
9. **A guardian decides alone which cats are in her colonies, adding and taking out, with immediate effect.** `assign_cat_to_colony` is held by guardians for their own colonies; `propose_colony_change` no longer exists. (*Updated after Samuel's roles decisions (12 Oct 2026)*, reason: the team should not be a queue for a guardian's own cats.)
10. **A guardian's phone may hold her colonies' data, exact feeding-site positions included, for 72 hours from her last online load by server time, deleted on next open, with `Clear-Site-Data` on sign-out and removal.** This replaces "directions in words, no coordinates". The "how to find it" line is optional. (*Updated after Samuel's roles decisions (12 Oct 2026)*, roles Decision 12.)

11. **A public site's card shows a rough count, "About N cats use this spot", in five bands, counting cats in the site's colony that are alive and seen in the last 12 months; never the exact number, never names, photos or a list.** (*Samuel, 12 October 2026, Decision 3.* Accepted: it tells anyone how many animals are at one exact place, and invites looking for them, §4.6.)
12. **The team's own dashboard pages are English only.** (*Samuel, 12 October 2026, Decision 9.*)
13. **The public card asks visitors to give the cats room, not leave food, and see how they can help.** (*Samuel, 12 October 2026, Decision 13.*)

(An earlier draft's entry about new team capabilities is withdrawn: the capability names are in `roles-and-invites.md` §6.2. Volunteers and staff are one team role, so no entry mentions either word.)

**Asks of `cat-record-data-spine.md` (to be amended on approval)**

1. §10.5: the `feeding_sites` columns in §11.1 here (`public_label`, `directions`, `public_id`, `last_public_position`, `guardian_aware`, `retired_at`, `retired_by`, `updated_at`, and `made_public_by` as a link to people), and `feeding_site_old_codes`.
2. §10.5: the public sites endpoint of §11.3 here as the definition of "the public sites endpoint filters `isPublic = true` in the query".
3. §10.5: `colony_name_history.redacted_at`.
4. §10.5: **the `colony` observation gains an explicit "in no colony" value** (`colonyId: null`), with the rule "the newest active statement stands" (the same amendment as `roles-and-invites.md` §17.1 point 4).
5. §10.5: `colonies` records who created each colony (`created_by`, a link to people), since a guardian can now create one and becomes its guardian; and the `colony` observation may be written by a guardian for her own colonies (the observation's `roleAtTime` carries her real role). *Updated after Samuel's roles decisions (12 Oct 2026)*
6. §6.5: the saved list on a guardian's phone includes the exact positions of her own colonies' feeding sites (72 hours, server time, deleted on open, `Clear-Site-Data`), replacing the amendment that said "no site coordinates". The app is unaffected and still holds only public sites. *Updated after Samuel's roles decisions (12 Oct 2026)*
7. §6.7: add that a public site's label must not contain the guardian's name, that a private site is indistinguishable from an unknown code, and that a guardian sees only her own colonies' sites, filtered in the query (the same as `roles-and-invites.md` §17.1 point 7).

**Asks of `team-access-and-welfare-queue.md`**

1. §7.3: use the catalogue in `roles-and-invites.md` §6.2 (that spec's §17.2 point 2 already asks for it); this spec adds no names.
2. §3.2: "one switch per site" gains the confirmation page of §4.3 here. Its "there is no bulk action" stands.
3. §2 and §8: a signed-in person lacking a capability gets a 403 page (that spec's §17.2 point 4).

**Asks of `roles-and-invites.md`:** none beyond what its §17.4 point 1 already lists. It must also keep the optional "how to find it" field (`directions`) and the `site-public request` queue item it already describes, and its Decision 12 text must say the saved list includes exact feeding-site positions for the guardian's own colonies (this spec now assumes that).

**Asks of Syros Cats:** none. Samuel has accepted the matching-service and photo risk for public sites (Answered (Samuel, 12 October 2026): accepted, §4.6), including the rough count on the card (§4.8).

---

## 13. Open decisions

Each lists every realistic option, what it costs and gives, and a recommendation. All are now decided by Samuel (12 October 2026). Everything is private until the team make a site public, so none of them blocks the team's half.

### Decision 1. How the map is drawn on a dashboard with no scripts

*The question.* The dashboard deliberately has no scripts (Samuel's Decision 1 on the dashboard, 5 Oct 2026, "plain server-drawn pages, for now"; SYC-207 is exploring ready-made tools). A map where you tap a spot is where that hurts most.

| Option | What the team gets | Benefits | Risks |
|---|---|---|---|
| **A. Server-fetched tile pictures, markers as links, each tile a button for placing (recommended)** (§3) | A map they can tap on, panned by zoom and area links | No change to the security header, no map company in the browser, works on any phone, consistent with every other page | Panning is clumsier than dragging. The map provider sees which areas the server asks for. Needs a tile cache and a tile-provider policy |
| B. A real interactive map: allow one script on the map pages, load a map library and tiles from outside | Drag, pinch, smooth zoom | Best experience | Adds `script-src` and an outside tile address on the one page that shows the most sensitive data in the app, and the map company sees every browser's view. The biggest change to the security posture of any option |
| C. Our own island tile set, built once from OpenStreetMap data and served by us | As A, with no third party asked per tap | No outside party sees anything; works the same as A for the team | A one-off build job and storage. More work than A. Needs updating when the island changes |
| D. No map in v1: a list only, coordinates typed or pasted from a phone's map app | A sortable list and a form | Quick to build | Placing a feeding spot by typing numbers is error-prone and puts exact feeding-site coordinates through a third-party maps app on someone's phone. The word "map" in the ticket is not met |
| E. A hosted admin tool (SYC-207) | Whatever it offers | Possibly less to build | Sends the most sensitive data in the app to another company, which becomes a new processor to name in the privacy policy. Not ruled out for other screens, but not for exact feeding-site positions without a deliberate decision |

**Changed after review (conditions added).** A holds only if: tiles are drawn at a fixed size and never shrunk (otherwise the tap point is read in the wrong scale); the tap point is checked in Safari on iPhone, Chrome on Android and Firefox before the plan is approved; tile addresses are kept out of the logs (SYC-255); tiles get an explicit private cache exception to the dashboard's no-store rule; and typed coordinates are offered as a second way in. If the real-browser check fails, the fallback is C plus typed coordinates, before B is considered.

**What people notice.** The team taps a map picture, sees a confirmation page with a marker, and saves. Panning is by buttons, not dragging.

**Recommendation: A, with those conditions, and C as the upgrade if Syros Cats mind the map company seeing the areas.** It is the only option that keeps the dashboard's header unchanged and still gives a tap-to-place map. If SYC-207 finds a tool, it must pass the test in E before it touches sites.

### Decision 2. Keep this in the MVP, or move it after launch (SYC-209's own question; SYC-73)

**Decided (Samuel, 12 October 2026): option A, as recommended.** Build the team's private map and colonies before launch; the public half comes after launch. It no longer waits for SYC-67's recorded acceptance: Samuel has accepted the matching-service and photo risk (§4.6).

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. Split it: the team's half before launch, the public half after (recommended)** | Before launch: colonies (create, rename, guardian, cats in colonies), the private site map, history. After launch: the public switch, the public endpoint and the app layer | Colony names are what the charity already speaks in and what guardian roles and any import hang off. A private map of sites has real value from day one. The riskiest piece, the one that exposes locations, waits until nobody is rushing | The public half is in PRODUCT-SPEC's MVP list and would slip. Nothing breaks: everything is private by default and the list of public sites "never blocks" (team-access §5.5) |
| B. All of it before launch | As the MVP list says | Matches the plan; launches with the Kini feeding spots visible | Adds the public endpoint and the app layer inside the store-submission window, on top of the dashboard work; the piece with the most ways to go wrong in public. **Cannot ship before SYC-67's acceptance is recorded (§11.6), so it risks quietly getting round F2** |
| C. All of it after launch | Descope per SYC-73 | Smallest launch | The team has no way to name colonies or record sites at launch; colony names and sites stay in WhatsApp |

**Changed after review (one ordering; the gate removed on 12 October 2026).** (1) The review added a gate: the public half would not ship until SYC-67's acceptance was recorded. **Samuel removed it (12 October 2026, accepted, §4.6).** (2) Within the team half, colonies come first (§16). The tile map is the riskiest piece of engineering, so it is the first thing to slip, ahead of colony naming.

**What people notice.** The team gets named colonies and a private map at launch; tourists see no feeding spots until the public half ships.

**Recommendation: A (decided).** It keeps what the team need and defers what only matters once Syros Cats have chosen sites to show. The team-access spec already names the map and colony naming as the first things to slip to hardening (its §9.3); this is a more careful cut line than all-or-nothing. **Decided by Samuel (12 October 2026).**

### Decision 3. What a public site shows about the cats and the colony

| Option | What a visitor sees | Benefits | Risks |
|---|---|---|---|
| A. Nothing about cats or the colony | A marker, a label, a short note | Weakens the cat blurring least of the three (it still weakens it a little, see §4.6: the matching service and photos tie cats to an exact bowl). Smallest thing that serves "come and help" | Less to engage a visitor, and not the "land on that colony's cats" Kini experience |
| **B. ✅ Decided. A rough count ("About N cats use this spot", in bands)** | A rounded band, never the exact number (§4.8) | Gives a sense of scale without a list or a name | A number plus an exact place is a statement of how many animals are at one door. It also invites a visitor to look for them. Rounding makes it less precise, not safe |
| C. A list of the colony's cats with photos | Faces and names | The Kini QR experience; very engaging | Ties named cats to an exact place, making their blurring pointless for those cats. Reopens the F2 acceptance (SYC-67) |

**Decided (Samuel, 12 October 2026): option B, a rough count.** Our earlier recommendation was A (nothing). C belongs to SYC-22, which must make its own decision and not slip in via a card. **What this choice accepts:** see §4.6 and §4.8 (anyone can learn roughly how many animals are at one exact place, and may look for them). The bands, what is counted and the wording are in §4.8; the preview, the endpoint, the cache and the tests follow from it.

### Decision 4. Whether the public label is separate, or the internal name is used

| Option | Benefits | Risks |
|---|---|---|
| **A. A separate, required public label, checked for the guardian's name (recommended)** | The guardian's first name never reaches the public by accident; the team writes what the visitor reads | One more field to fill in; the check is a guard, not a guarantee |
| B. Use the internal name | No extra field | Publishes a private person's first name next to an exact place |
| C. Strip the guardian from the name automatically | No extra field | Names are free text; stripping fails silently on "Eleni's" versus "Ελένης" and leaves a mangled label |

**Recommendation: A.**

### Decision 5. How hard it is to make a site public, and what happens when the guardian changes

| Option | Benefits | Risks |
|---|---|---|
| A. One confirmation tap | Quick | The most consequential click in the dashboard gets the least thought |
| **B. A confirmation page with a preview and a recorded "the guardian knows" tick, and a re-confirmation when the guardian or the colony changes (recommended)** | The person sees exactly what goes out, the guardian's agreement is recorded, and the agreement cannot go stale unnoticed | A minute's friction per site, for a thing done a few times a year. A guardian change makes the site vanish from the public map until someone re-confirms it |
| B2. As B, but a guardian change only shows a banner on the public site ("Public since 14 Oct with Eleni's agreement. The guardian is now Nikos. Check with him.") | The site stays visible | A banner can be ignored; the site stays public under a consent the new guardian never gave |
| C. B plus a second team member must approve | Strongest | With a team of two or three the second person may not be around, and a delayed approval is quietly worked around. Not proportionate yet |

**Changed after review (conditions added).** The tick was recorded once. It now has to be asked again when a colony's guardian changes or a public site moves to another colony (§4.7), and **no site goes public without a named guardian**. A site with no colony or no guardian name cannot be made public.

**What people notice.** When Nikos takes over from Eleni and the team updates the colony, the public sites of that colony quietly go private with a note, and the page asks the team to check with Nikos.

**Recommendation: B.** Revisit C if the team grows or a site is ever made public by mistake.

### Decision 6. What moving a public site does, and whether it keeps its public code

**Decided (Samuel, 12 October 2026): option A with A2's rule, as recommended.** A site keeps its public code after a private-to-public cycle with no move. A move of more than 10 metres, or a retire, still gives a new code (§4.5).

| Option | Benefits | Risks |
|---|---|---|
| **A. It becomes private until reconfirmed, and when it is made public again at a new place it gets a new public code; the old code stops working (recommended)** | A wrong pin never sits publicly even briefly, and a person watching the public list cannot follow a spot that moved (for example away from a hostile neighbour). An old QR sticker at the old place no longer leads to the new one | One extra confirmation after a deliberate move. A printed sticker has to be replaced. The team must take down old stickers |
| A2. As A, but the code is kept if the site is made private and public again without moving | Fewer replaced stickers | A site that disappears and comes back with the same code tells a watcher "same feeding spot, quiet for a while, now back" |
| A3. As A, and a new code every time a site is made public again, moved or not | Nothing links one public showing to another | More stickers to replace; every pause becomes a printing job |
| B. It stays public at the new position, with the same code | Fewer steps | A slip sends visitors to the wrong door; nobody is looking at the live public view; the same code ties the old and new places together |
| C. Ask each time | Flexible | A choice nobody wants to make; the safe default is better |

**Changed after review.** Without a new code, A protected against a wrong pin but not against a watcher. The code now changes when the position changes (more than 10 metres from where it last stood in public) and always after a retire (§4.5, §11.1).

**What people notice.** After a move the team sees "Old QR stickers for this place will stop working. Take them down." A visitor who scans an old sticker sees "This feeding spot isn't on the map any more."

**Recommendation: A, with A2's rule (keep the code after a plain private-and-public cycle with no move)**, because it spares stickers and the leak is small. **Decided by Samuel (12 October 2026)**; A3, the strictest, was not chosen.

### Decision 7. What a cat guardian can do with sites (settled with SYC-53)

*Updated after Samuel's roles decisions (12 Oct 2026): guardians can create colonies (the new row F below). Options B and E stay rejected for the reason given.*

| Option | Benefits | Risks |
|---|---|---|
| **A. Follow the roles spec: a guardian sees only her own colonies' sites; may add sites to her own colonies (always private) and edit, move, retire and bring back her own sites (`add_feeding_site`, `edit_feeding_site`); cannot change which colony a site belongs to; cannot make a site public but can ask (`request_site_public`); puts cats in and takes them out of her own colonies herself, with immediate effect (`assign_cat_to_colony`); can create colonies (`create_colony`) (recommended, updated after Samuel's roles decisions of 12 Oct 2026)** | One rule across both specs. The most affected person is never surprised, the record stays accurate with less phone traffic, a guardian never waits for the team to record her own cats, and she can ask for a public site without a second queue (it uses SYC-53's "Needs an OK") | A guardian who wants a site public has to ask and wait. Adding cats shows her their exact positions, which is the accepted risk (§7.3) |
| B. A guardian proposes cats and the team approves (the earlier recommendation, `propose_colony_change`) | Nobody can read a cat's position by adding it | Every cat a guardian finds waits for the team; the team's queue grows. **Withdrawn by Samuel's decision of 12 Oct 2026**: a guardian decides alone which cats are in her colonies |
| C. A guardian can make her own sites public | Least team work | She cannot judge the wider picture, and one hasty tap is a public location |
| D. A guardian sees other colonies' sites approximately | Matches the wording used for cats | A private site is meant to be absent, not blurred (spine §6.7); an approximate marker still says "there is a feeding spot around here" |
| E. A guardian may assign "unassigned cats near her sites" (the earlier draft) | Quicker for her | "Near" is measured with exact positions she is not meant to see; it reopens the escalation SYC-53 closed |
| **F. A guardian can create a colony and becomes its guardian; renaming afterwards is the team's (Samuel's decision, 12 Oct 2026)** | She records a new place herself, the day she finds it. No queue for the team | She could create a colony anywhere and add cats to it, which shows her their exact positions. Accepted; the history and the team's "Recent guardian changes" list make it visible (§7.3) |

**Changed after review.** The earlier draft recommended "A now, B later" with its own capability names and a guardian power over unassigned cats. The roles spec was written the same week with different rules; it is the source of truth. Settled once, there. **Reject C, D and E.** **Changed again on 12 Oct 2026**: the review had rejected a guardian assigning cats directly; Samuel decided the opposite, so that is now the recommendation and the "propose and approve" route is withdrawn.

**What people notice.** A guardian opens her colony and sees her own sites and cats; she can fix a pin, retire a closed spot, add a cat she has found or take one out, and it happens at once. A button on each of her sites says "Ask the team to make this public". Nothing else on the island is visible to her.

**Recommendation: A.**

### Decision 8. How long a phone keeps the list of public sites for offline use

| Option | Benefits | Risks |
|---|---|---|
| A. No offline copy | Simplest, and nothing stale | Walkers on the hills with patchy signal never see the layer |
| B. One day | Quick to follow a change | Offline overnight and the layer vanishes |
| **C. Seven days (recommended)** | Covers a holiday week of patchy signal | A site made private stays visible to an offline phone for up to a week. That phone already saw where it is, so the exposure was already made |
| D. Indefinite, like the cat cache | Always works | An old list outliving the site's own change; the failure the spine warns about (§6.5) |

**Recommendation: C.**

### Decision 9. Whether the dashboard is offered in Greek

| Option | Benefits | Risks |
|---|---|---|
| **A. English only (recommended)** | Matches every page already built; no translation of an internal tool | A team member who prefers Greek reads English labels |
| B. English and Greek | Friendlier for the team | A second set of dashboard words to maintain and a language switch on server-drawn pages, where none exists |
| C. Greek only | Natural for the island | Breaks the build already made |

**Decided (Samuel, 12 October 2026): A, English only for the team's own pages.** (Our recommendation was the same.) Nothing is asked of Syros Cats; if anyone later finds it hard, B is its own ticket. SYC-53 already plans English, Greek and French for the pages guardians use, so if guardians use these screens (their own sites and colony), those pages get the three languages with SYC-53, not with this spec.

### Decision 10. Whether a site has a Greek label and an English one

| Option | Benefits | Risks |
|---|---|---|
| **A. One label, same in every language (recommended)** | Simple; place names are place names | Reads slightly less natural in one language |
| B. A label per language | Natural everywhere | Three fields to fill and keep matching, and a gap if one is empty |

**Recommendation: A**, and revisit if Syros Cats ask.

### Decision 11. How the first sites get into the system

**Decided (Samuel, 12 October 2026): option A, as recommended.** Syros Cats place their own sites on the dashboard; loading a list under the safe route (A2, with the conditions below) is the fallback if the slow route proves too slow.

| Option | Benefits | Risks |
|---|---|---|
| **A. Syros Cats place their own sites on the dashboard, or send names plus rough areas only and the team places them; we load nothing with exact positions (recommended)** | The most sensitive list in the app never travels outside it. No file to leak, commit or forget | Slower; the team may take weeks to finish |
| A2. We load the list Syros Cats send, positions included, with a one-off script | Day-one usefulness; no hundred forms to fill | The list will most likely arrive as a WhatsApp message, an email attachment or a Google My Maps link: a complete map of every feeding spot, handled by third parties. It could be committed beside the script and stay in git history for ever, or be pasted into an agent session. Mistakes are loaded in bulk (the history shows `system:seed`, each is fixed with Move) |
| B. The team adds them one at a time, from scratch | No script | Slow; the team may never finish, and the map stays empty |
| C. Import from the WhatsApp history (`records-import.md`) | Uses existing material | That spec is optional and after the MVP, and its data has scant detail. Not a dependency of this one |

**Changed after review (conditions added).** A2 is acceptable only with a stated safe route: the file is never committed (a `.gitignore` rule and a check in the seed script, §11.8), it is loaded from a scratch location, deleted after loading, never pasted into an agent session, and the history records `system:seed` with no copy of the file. Its risk, in plain words: the list travels outside the system on the way in.

**What people notice.** The team sees a populated map sooner under A2; under A they build it themselves, starting with the sites they know best.

**Recommendation: A**, falling back to A2 only with the safe route above if the slow route proves too slow. Neither ever sets visibility. **Decided by Samuel (12 October 2026).**

### Decision 12. What a colony's name form looks like

| Option | Benefits | Risks |
|---|---|---|
| **A. One free-text name plus a separate guardian name, with the convention shown as a hint (recommended)** | Matches how the charity speaks; handles names that don't fit a pattern ("Kini harbour") | The two can drift apart when a guardian changes |
| B. Two boxes (place, guardian) that build the name | Always consistent | Cannot name a colony without a guardian; in Greek the possessive changes the word ("Ελένης"), which a simple join gets wrong |

**Recommendation: A.**

### Decision 13. What the public card asks visitors to do

| Option | Benefits | Risks |
|---|---|---|
| **A. Keep your distance, don't leave food, find the Help tab (recommended)** | Agrees with the app's first lesson and with the charity's own guidance | Gives visitors nothing to "do" at the spot except spot and donate |
| B. Say nothing about food | Shorter | The card and onboarding disagree by omission |
| C. Invite visitors to bring food | Feels welcoming | Reverses the app's teaching, crowds the colony and draws cats to a spot |

**Decided (Samuel, 12 October 2026): option A.** The card reads "Give the cats room, please don't leave food, see how you can help", in all three languages (§5.2). Nothing further is asked of Syros Cats.

### Decision 14. When a guardian adds a cat that is already in another guardian's colony

**Decided (Samuel, 12 October 2026): B.** The cat moves at once and the other guardian is told, without being told whose colony it went to.

*Updated after Samuel's roles decisions (12 Oct 2026): raised by the decision that a guardian adds cats alone, with no approval.*

| Option | Benefits | Risks |
|---|---|---|
| A. The cat moves to her colony at once; the other guardian is not asked; the move is in the history and in the team's "Recent guardian changes" list | Exactly as decided: no approval, no waiting. Simple | A guardian can take a cat out of another guardian's colony by adding it to hers, by mistake or on purpose. The other guardian only finds out when the cat vanishes from her list |
| **B. ✅ As A, but the other colony's guardian is told ("Mimi has moved to another colony"), without being told whose** | She notices, can say "that's mine" to the team | A little more to build; a notice a guardian may not understand |
| C. As A, but a cat already in another colony cannot be added by a guardian; the team moves it | No cat is taken from anyone by accident | Reintroduces a team step for exactly the cases most likely to be genuine disputes. Goes beyond what Samuel decided |

It keeps "no approval" but means a mistake is noticed by the person it affects, not only by someone reading a list. The notice appears on her colony page next time she opens it, and on her saved list; it never names the other colony or its guardian. A test asserts the notice is shown to the losing guardian and carries no colony name or guardian name.

---

## 14. Risks

| # | Risk | Why it matters | Mitigation |
|---|---|---|---|
| 1 | **A site becomes public by accident or by a wrong pin.** | It is a published list of where to find cats. | Private by default; per-site; no bulk; confirmation page; preview; moving a public site makes it private; short cache so a mistake is fixed in minutes. |
| 2 | **The guardian's name or a house number reaches the public label.** | Identifies a person next to an exact place. | Separate required label; checked against the site's own name, current and earlier guardians, and "a word and a number" (§4.4); shown in a preview. |
| 3 | **Private sites are counted or probed through the public interface.** | Site numbers and ids leak how many private sites exist. | Random public code assigned only at first publish; no internal number in any public response; unknown, private, retired and superseded codes are indistinguishable; public list ordered by code. |
| 4 | **The map tile provider learns which streets the team study.** | A faint pattern of "somebody is looking here". | Tiles come through our server and are cached; the provider sees only the server; Decision 1 option C removes it. |
| 5 | **The team's exact positions leak through the history, logs or an email.** | The history holds every old position; a tile address is a position to about 75 m. | Same capability as the sites; tile addresses logged without their position (SYC-255); not in mail; tests assert it. |
| 6 | **A phone keeps showing a site long after it went private.** | Perceived as the charity "still advertising" it. | Server cache five minutes; the app refreshes when the map is opened online; the phone's copy expires (Decision 8); honest statement that sight cannot be taken back. |
| 7 | **Colony averaging, the matching service and photos still tie cats to a public bowl.** | The spine's accepted limit gets sharper once the bowl is exact. | Not oversold: the confirmation page and every description say a public spot tells people cats live here (§4.6). **Accepted by Samuel, 12 October 2026** (matching-service and photo risk); the public half is no longer gated on SYC-67 (§4.6, §11.6). |
| 8 | **A guardian is named on a public screen.** | They never agreed. | Nothing from colonies is public; the label check; the guardian tick, asked again when the guardian changes (§4.7). |
| 9 | **The pin-by-tapping page is awkward on a phone, or reads the wrong place.** | Wrong pins, abandoned adds. | Fixed-size tiles; real-browser check of the tap point before the plan is approved; typed coordinates as a second way; confirmation page before saving; Move is always available; checked at 390 px and desktop before the PR opens. |
| 10 | **A guardian cannot be forgotten.** | A lawful request cannot be honoured. | Redaction path on the history and one "forget this guardian" action (§7.4, SYC-256). |
| 11 | **A moved spot can be followed by its public code.** | Undoes the reason for the move. | New code after a move or a retire; old codes answer as unknown (§4.5). |
| 12 | **The list of every feeding spot travels outside the system on the way in.** | A complete map handled by third parties. | Decision 11: the team place sites themselves, or a never-committed, deleted-after-loading file (§11.8). |
| 13 | **A guardian creates a colony somewhere and adds cats to it to see where they are.** | Exact positions of cats outside her real colonies. *Accepted by Samuel, 12 Oct 2026.* | Every change is in the history with her name; the team's dashboard lists recent guardian changes (§2.6, §7.3). |
| 15 | **The rough count tells people how many cats are at one exact place, and invites looking for them.** | Anyone, not only visitors with good intentions. *Accepted by Samuel, 12 October 2026 (Decision 3).* | Bands never the exact number; only cats alive and seen in the last 12 months; no names, photos or list; zero shows nothing; the team see the band in the preview before making a site public (§4.8). |
| 14 | **A guardian's phone holds the exact position of her feeding sites for 72 hours.** | A lost or shared phone could show where her sites are. *Accepted by Samuel, 12 Oct 2026 (roles Decision 12).* | Only her own colonies; 72 hours by server time; deleted on next open; `Clear-Site-Data` on sign-out and removal; honest statement that a phone never reopened keeps its copy until the browser clears it. |

---

## 15. Tests that must exist

Named here so they appear in the plan. API tests use supertest against the real app and a real Postgres, as the existing dashboard tests do. Mutation checks (M) are done once by hand before merge, as the other plans do.

1. **Public isolation (the canary).** Seed a private site with a distinctive name, label, notes, directions and coordinates, and a colony with a distinctive exact cat count (for example 13); call every public route (`GET /api/feeding-sites`, `/api/cats`, `/api/cats/:id`, the resolve and sighting responses, notification payloads, the health route) and assert the strings, the coordinates and the exact count appear in none of them, including after the site has been public and made private again. **M:** drop `is_public = true` from the query -> red.
2. **Only listed fields, in a fixed order.** The public endpoint's items have exactly the keys `id`, `label`, `position` and (when a cat qualifies) `cats`, ordered by `id` (the public code); a snapshot fails on any new key or a different order. **M:** add `notes` to the select -> red.
2a. **The rough count (§4.8).** For a colony with 0, 1, 4, 5, 7, 8, 12, 13, 19, 20 and 40 qualifying cats the band is none, `few`, `few`, `about5`, `about5`, `about10`, `about10`, `about15`, `about15`, `20plus`, `20plus`. A cat that is dead, presumed-deceased, homed, in care, in no colony, in another colony, or last seen over 12 months ago is not counted; the endpoint, a log line and the cache never hold the exact number (13 is not in any body); the response has no cat names, photos or ids; two public sites of one colony show the same band; the confirmation page preview shows the same band the endpoint will, in all three languages with key parity for the five strings; a site with no colony cannot be public, so never has a band. **M:** return the exact number -> red.
3. **Identical for every caller.** Calls with different headers, query strings, device ids and positions return byte-identical bodies.
4. **Not distinguishable.** A lookup by public code for a private site, a retired site, a site that was never public, a random code, and **a superseded code** returns the same status and body, and the query reads no private row.
5. **Opaque code, and a move gives a new one.** A never-public site has no `public_id`; `public_id` is not derivable from the internal number; making a site public, private, public again **at the same position** keeps one code; making it public again **more than 10 metres from where it last stood in public**, or after a retire, issues a new code, and the old code returns the "unknown" answer; the old code is kept in the team-only list.
6. **One position function.** A test searches the public routes for `feedingSitesTable.lat` and `.lng` (and their equivalents) outside `publishedSitePosition`, and fails on any hit.
7. **Never created public.** No route or script can create a site as public; no route sets visibility on more than one site per request; the seed sets none.
8. **Make public needs everything.** No label -> refused. Label containing the site's own name minus place words, or any current or earlier guardian's name word (also in a different case or accent) -> refused. Address-shaped label ("Ermou 12", "Ερμού 12", "12 Ermou") -> refused. "Vaporia seafront" -> passes. No guardian tick -> refused. **A site with no colony, or a colony with no guardian name -> refused.** Each refusal writes nothing.
9. **Moving a public site makes it private**, writes both events, and the public list no longer has it; re-confirming puts it back.
10. **Retired is never public**, by the database check and by the route; bringing a site back never makes it public; a retire retires the code.
11. **Every change writes exactly one history row in the same transaction.** A forced failure in the history write leaves the site unchanged. The history table refuses delete and refuses every update except a redaction that blanks `before`, `after` and `note`. `made_public_by/at` agree with the newest "made public" event and are kept on make private.
12. **Capabilities and refusals.** For each route in §11.2, a session lacking exactly that SYC-53 capability gets a **403** (not the sign-in redirect) and nothing is written; a request with no session gets the identical `401 not_signed_in`; the pages hide controls the person cannot use; a foreign or missing `Origin` is refused on every POST. The capability names in code equal `roles-and-invites.md` §6.2 (SYC-53's catalogue test). **M:** a route asking for the wrong capability -> red.
13. **Concurrent writes.** Two simultaneous "make public" and "make private" presses, **two simultaneous moves of one site, and a move while another person edits the label,** each leave one definite state, and the loser sees "Someone already changed this."
14. **Colony names.** A name clashing under folding (case, accents, final sigma, NFD) is refused (with a link to the holder for the team, without one for anyone else); a rename keeps every cat and site attached; **a guardian creating a colony with a name that clashes gets "That name can't be used", with no link, exactly as for a name that fails any other way;** the old name still finds the colony; two simultaneous creates of the same name produce one.
15. **Cats in colonies.** Adding cats writes one signed `colony` statement each and moves no derived status (snapshot before and after); a colony that does not exist is refused; moving a cat writes a new statement and the newest stands; "Take out" writes an "in no colony" statement and the earlier statement stays visible; **A -> B, then "Mark wrong" on B, puts the cat back in A;** "Mark wrong" with no earlier statement leaves the cat in no colony; the colonies list counts agree. **A guardian can add a cat to, and take a cat out of, her own colony and it takes effect immediately with her real role recorded; she is refused (403, nothing written) for a colony that is not hers; there is no `propose_colony_change` route and no pending state; adding a cat that is in another colony moves it, and shows that colony's name nowhere on her pages.**
16. **Escaping.** A site or colony name containing markup is shown as text on every page.
17. **Map.** Tiles are only reachable with a session and the right capability; the page's security header is byte-identical to the existing expected header (no `script-src`); a tap on a tile button yields the position it should (checked at several zooms, including a tile boundary); tapping outside the island's limits is refused; **the tile route's cache header is `private`, never `public`; a tile request is logged as `/api/team/map-tiles/:tile` with no position; and a real-browser check (Safari on iPhone, Chrome on Android, Firefox) shows the tap point matches the server's assumption at the displayed size.**
18. **Phone cache.** A stored list older than the limit is not shown; a list of an older shape is dropped; the key differs from the cats cache; **the app re-fetches when the map is opened online, at most every five minutes.**
19. **Language parity.** The new strings exist in all three languages with no empty values (the existing parity suite), and the server preview and the app card use the same strings.
20. **Looks right in a browser.** At 390 px and desktop widths: the Feeding sites page, a site, the make-public page with its preview, the colony page, and the app card, with real-looking data, not just an empty page. **At 390 px the map has no sideways scroll and each tile's displayed size equals the size the server assumes.**
21. **A guardian sees only her own colonies.** With a guardian of colony 1: colony 2's name, guardian, counts and sites never appear on any page in the §7.3 table (including the count above the map, "Recently changed", the Colonies page, the name-clash message and the cat page); an id of another colony's site answers the same as an id that does not exist; she **can** create a colony and it becomes hers in the same step (she sees it at once, with her own name as guardian, and a team member sees it too); she cannot rename it or any other colony, or change a site's colony; she can add cats to and take cats out of her own colony only, with immediate effect; she can add a site only to her own colony and it is private. **After she creates a colony, colonies 1 and 2 are still invisible to each other, and her new colony appears in the team's "Recent guardian changes" list.**
22. **Re-confirmation.** Changing a colony's guardian, or moving a public site to another colony, makes its public sites private and writes an automatic "made private" event; the §4.3 page then puts them back.
23. **Forgetting a guardian.** The "forget this guardian" action blanks her name in the colony, name history, site names, events and notes, writes its own event, and leaves every other field intact.
24. **Migration.** On a copy of production data: a public row, a non-uuid `made_public_by` and a retired-and-public row each stop the migration with a clear message; existing sites each get one `system:migration` event; exactly one of `person_id` and `actor_system` is set on every event.
25. **Public copy.** No public string (including the Help tab's campaign text) contains any colony's internal name or guardian name.

26. **A guardian's saved copy.** It contains only her own colonies' sites, with their exact positions; a list older than 72 hours by the server's stamp is deleted (not hidden) when the page opens; a phone clock set backwards counts as expired; sign-out and removal both send `Clear-Site-Data`; no team page, and no response of the public app, ever carries a private site for offline use; the public app's cache holds only public sites. (Shares code with the roles spec's test 26.)

---

## 16. The cut line, and what "done" looks like

**If the window bites** (see Decision 2): the order of value is (1) colonies and cats in colonies, (2) the private site map and history, (3) the public switch, endpoint and app layer. Each is useful alone; none requires the next. The tile map is the riskiest piece of engineering and is the first to slip, ahead of colony naming. The public half ships after launch whenever it is ready; it has no gate other than the team making a site public, one at a time.

**Done looks like:**

- A Syros Cats person can add a feeding site from a cat's sighting in under a minute, and see it on the map.
- A colony called "Vaporia — Eleni's" can be renamed when Eleni stops, and nothing attached to it moves.
- Every site is private until a named person has deliberately made it public, one at a time, after seeing what visitors will see.
- Making a site private is one tap and cannot be made harder.
- No private site, colony name, guardian name, note or exact cat count is in any public response (only the rough band of §4.8), and a test proves it.
- A tourist in Kini sees a bowl marker at the exact spot, taps it, and is told in their own language to give the cats room and not to leave food.
- "How did this become public?" has an answer in the site's history.
- A cat guardian can create her own colony, put her own cats in it and take them out, and see her sites' exact positions on her phone for 72 hours with no signal; she still cannot see anything that is not hers or make a site public.
- Nothing here has to be unpicked when cat guardians get their own accounts: a guardian sees only her own colonies' sites, and every power she holds is a row in `roles-and-invites.md` §6.2.

---

## Review outcome

The adversarial review (`docs/specs/reviews/feeding-sites-and-colonies-review.md`, 7 October 2026) found two blockers, ten majors and a set of minors. Each is handled as follows. The roles spec (`roles-and-invites.md`) was approved-in-draft the same week and is treated as the source of truth for permissions.

| # | Finding | Outcome | Where |
|---|---|---|---|
| 1 (Blocker) | A moved public site keeps its public code | **Fixed.** New code after a move over 10 m and after any retire; old codes answer as unknown; QR-sticker warnings on move, make-private and retire; test 5 rewritten. A plain private-and-public cycle with no move keeps its code, presented as Samuel's choice | §4.5, §11.1, §11.3, §11.6, Decision 6, test 5 |
| 2 (Blocker) | Capability names clash with the roles spec | **Fixed.** Every screen cites the roles spec's catalogue names; `manage_*`/`set_cat_colony` removed; "unassigned cats near their sites" dropped; a guardian cannot change a site's colony (*cat assignment by guardians reversed on 12 Oct 2026, see the end of this section*); proposed DECISIONS entry 8 cut; a signed-in person without the capability gets 403, not 401 | §7.2, §7.3, §11.2, §12, test 12 |
| 3 | Pages, counts and searches leak other colonies | **Fixed.** A per-screen table of what a guardian sees; entry by `canSomewhere`, filtering in the query; name clash gives a generic message | §7.3, §11.2, test 21 |
| 4 | "Cats stay blurred" not true once a site is exact | **Fixed.** Confirmation page line 4 rewritten honestly; both channels (matching service, photos) stated in §4.6. The Part 2h risk acceptance, made before public sites existed, **was accepted by Samuel on 12 October 2026** | §4.3, §4.6, §11.6 |
| 5 | A guardian's name cannot be erased | **Fixed in the spec, built under SYC-256.** Redaction path on the history, one "forget this guardian" action over every store, notes hint, privacy-policy ask | §7.4, §8, §11.1, test 23 |
| 6 | Consent goes stale | **Fixed.** A guardian change or a move to another colony makes public sites private until re-confirmed; no site goes public without a named guardian | §4.7, Decision 5, test 22 |
| 7 | Taking a cat out of a colony does not work | **Fixed.** Explicit "in no colony" value (matching the roles spec §17.1); "newest active statement stands"; "Take out" and "Mark wrong" are two buttons; both capability gates named | §2.8, §11.5, §12, test 15 |
| 8 | Tap-to-place on phones not proven | **Fixed.** Fixed-size tiles, honest tap accuracy, typed coordinates as a second way, real-browser check before the plan is approved, tile addresses out of logs (SYC-255), tile cache exception | §3, §11.4, tests 17, 20 |
| 9 | Migration not "all additive" | **Fixed.** First plan step is a count; the `made_public_by` type change is a separate checked step; `system:migration` events; `actor_system` with an exactly-one rule | §11.1, test 24 |
| 10 | No safe route for the seed list | **Fixed.** Decision 11 recommends the team place sites; the file route has conditions (never committed, scratch location, deleted, `system:seed`) | §11.8, Decision 11 |
| 11 | Roles spec puts positions on phones; this spec said never | **Fixed.** The roles spec's §12.4 sentence is used, with its references adjusted to this document (private positions on the dashboard map only; the saved list holds names and directions, never coordinates, 72 hours; the app's public list unaffected); `directions` field added | §9, §2.2, §11.1 |
| 12 | Public half before SYC-67 | **Gate added by the review, then removed by Samuel (12 October 2026).** He accepted the matching-service and photo risk, so the public half is not gated on SYC-67 | §4.6, §11.6, Decision 2 |
| 13 (minors) | 13.1 order -> by code; 13.2 lookup filters in query, rate limit; 13.3 label rules written out; 13.4 campaign copy; 13.5 SYC-245 precondition of "Make a feeding site here"; 13.6 `updated_at` version on every write; 13.7 `made_public_*` kept; 13.8 one source for card words; 13.9 refresh rule; 13.10 Help link needs signal; 13.11 OSM policy; 13.12 read log of site pages; 13.13 QR stickers on make-private and retire; 13.14 colony count rule; 13.15 Part 2m; 13.16 "feeder" (a person) -> "cat guardian"; 13.17 test 6 defined | **All applied** | §2.3, §3, §4, §6, §8, §9, §10, §11, §15 |
| 14 (decisions) | Agree 3, 4, 8, 9, 10, 12, 13; change 7; conditions on 1, 2, 5, 6, 11 | **Applied.** Each changed decision has a "Changed after review" note, with every option, benefits and risks kept. Decision 3's wording changed from "cannot weaken" to "weakens least" | §13 |
| 15 | What held up | Kept as written | all |

### Updated after the roles decisions (12 October 2026)

Samuel's roles decisions of 12 October change some of what the review settled. The review findings are unchanged except where noted.

| Decision | Effect on this spec | Where |
|---|---|---|
| Cat guardians can create colonies | New: she becomes its guardian automatically; renaming stays the team's; accepted risk stated; "Recent guardian changes" list for the team; tests 14 and 21 extended; Decision 7 option F; risk 13 | §2.6, §2.7, §7.2, §7.3, §11.2, Decision 7 |
| Volunteers and staff are one role, the team | Every "staff" now says "the team"; no volunteer rule, view or test remains | throughout, §7.2 |
| A guardian decides alone which cats are in her colonies | Review finding 2's "a guardian cannot assign cats" is reversed. `propose_colony_change` and the proposal route are removed; `assign_cat_to_colony` is placed; test 15 extended; Decision 7 option A updated and "propose and approve" withdrawn; new Decision 14 | §2.8, §7.2, §7.3, §11.2, §11.5, Decision 7, Decision 14 |
| Offline (roles Decision 12) | Review finding 11's "names and directions, never coordinates" is replaced: a guardian's phone may hold exact site positions for her colonies for 72 hours by server time, deleted on open, `Clear-Site-Data`; `directions` becomes optional; test 26; risk 14 | §2.2, §9, §11.1, test 26 |
| Two tiers | Checked: nothing here needs a management-only power | §7.5 |
| Unchanged | Making a site public stays team-only (`set_site_public`); a guardian can ask (`request_site_public`); public codes, privacy and history rules stand; the SYC-67 gate is removed | §4, §11 |

**Decisions left for Samuel.** **There are none.** Every decision is made. **Decided (Samuel, 12 October 2026):** Decision 2, option A (the team's private map and colonies before launch; the public half after launch, with no SYC-67 gate); Decision 6, a site keeps its public code after a private-to-public cycle with no move (A with A2's rule); Decision 11, Syros Cats place their own sites on the dashboard, with loading a list under the safe route as the fallback; Decision 14, B (the cat moves and the other guardian is told). **Answered (Samuel, 12 October 2026): accepted.** The Part 2h matching-service and photo risk stands for public sites. **Also decided (Samuel, 12 October 2026):** Decision 3, a rough count (option B, §4.8); Decision 9, English only; Decision 13, option A. **No question is left open in this spec, for Samuel or for Syros Cats.**
