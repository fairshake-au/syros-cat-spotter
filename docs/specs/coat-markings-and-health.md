# Coat, markings and health on the cat record

**Status:** **Approved by Samuel, 12 October 2026.** All decisions and questions are recorded in the sections below; the adversarial review and how each finding was handled are linked from this document.
**Owner:** Samuel
**Covers:** SYC-2 (coat and markings tags, and health status on cats). Also settles the trust question SYC-2 was parked on: who is allowed to assert a fact about a cat's body, and what the public sees of it.
**Related:** [`cat-record-data-spine.md`](./cat-record-data-spine.md) §2, §3.4, §4, §10.1, §10.2 · [`choose-a-different-cat.md`](./choose-a-different-cat.md) §4.7, §8.4 · [`add-details-later.md`](./add-details-later.md) §6, §8 · [`team-access-and-welfare-queue.md`](./team-access-and-welfare-queue.md) §4, §7 · [`roles-and-invites.md`](./roles-and-invites.md) §6.2, §6.7, §7.6 (Decision 13), §17.4 · [`DECISIONS.md`](./DECISIONS.md) Part 2g, 2i, 2k, 3 · tickets SYC-161 (auto coat colour), SYC-5 (vaccination records), SYC-52 (confidence engine), SYC-53 (roles), SYC-42 (welfare reports), SYC-75 (sterilisation status), SYC-43 (staff dashboard).

**What this document owns:** the coat-and-markings vocabulary (the words and pictures); who may say what about a cat's appearance and how disagreements are settled in plain terms; what "health" means in this app and what is shown publicly; the vaccination fact.

**What it borrows, and does not own:**
- **The roles and the capability names** come from `roles-and-invites.md` §6.2, which is the single list. This spec cites those names and adds none of its own.
- **The observation model and the resolver** belong to the data spine. Where this spec needs new kinds of observation and resolver rules, §10 writes them as a **proposed data-spine amendment** for Samuel to approve together with this spec, and the data spine is edited then, not before. One of those rules changes an approved sentence in `choose-a-different-cat.md` §8.4, and is put to Samuel as a decision of its own (SYC2-D10).
- **The welfare flow** belongs to the welfare spec and is untouched.

**Decision numbering.** This spec's decisions are called SYC2-D1 to SYC2-D10, so they cannot be confused with the numbered decisions in `DECISIONS.md` (whose D4, the public "not sterilised" line, is referred to by name below).

---

## 1. The short version

A cat on the Syros Cats map is more than a photo and a name. People describe cats to each other by what they look like ("the black-and-white one with the kinked tail by the bakery"). This spec gives the app that same language, and a careful rule for who gets to say it.

**Appearance (coat and markings).** A short, fixed list of colours and markings, each with a picture and a name in English, Greek and French. A tourist can answer from a photo by tapping, never typing. A spotter's tap is a **suggestion**. The team (staff and management) and cat guardians (for cats in their own colonies) state a cat's colour and markings **directly**, and their word stands (roles spec, Decision 13). The Syros Cats team is one group (staff, management and the people who help in the field), so a team member's statement is a team statement. Each cat's colour is read automatically from its main photo (SYC-161). A person with authority beats the machine; two spotters who agree, on different days and from different photos, beat it too; one spotter alone never overturns it.

**Health.** The app does **not** have a "health status" badge, and this spec argues it should never have one. What "health" means here is three separate things with three different audiences:

1. **Facts the cat page already shows**, with their own rules: sterilised, ear tip, and whether the cat is living on the street, homed, in care or gone.
2. **Vaccination**, a clinical fact that only the team can state. At launch it is **team-only**: the public never sees it on a cat's page. Donors who fund vaccines see one overall number instead ("142 cats vaccinated this year"), worked out automatically from the team's vaccination records, which says nothing about any single cat (§6.3).
3. **Everything else about a cat's condition** (illness, injury, a long-term condition, pregnancy). This is sensitive, it changes, and it is **never shown publicly**. It lives in a team-only note on the cat itself, readable by the team and by cat guardians for their own colonies. A spotter who is worried about a cat uses the existing "This cat needs help" route. Nothing in this spec replaces it, delays it or sits in front of it.

There is no "Looks healthy" badge. A tourist cannot see health from a photo, and a green label on a sick cat is worse than no label.

**How it helps.** The colour filter in "Find the cat" gets people (and their corrections) behind it. Markings show on the cat's card so a spotter can compare in the moment. The team gets a small list of cats whose colour or markings deserve a second look. Matching itself is unchanged: the photo still decides.

---

## 2. What changed from the July draft

The 28 July draft was written before the cat record existed. Most of its ideas survived into the data spine. Four things in it are not carried forward:

| The July draft said | This spec says |
|---|---|
| Appearance "fills the `description` field that exists in the schema and is never written to". | `cats.description` is the cat's **location label** ("by the blue boat"), and the cat page shows it as such. Appearance does not go there. It is stored as observations. |
| A health attribute table with sex, age class, pregnancy, condition (healthy / needs attention / urgent) and a "Condition: anyone can say it" rule. | Public free-for-all condition statements conflict with the urgent welfare route and with privacy (§6). The condition row is dropped. Sex, age and pregnancy are not part of this spec (§13). |
| Roles: Admin, Staff, Volunteer, Partner vet, Cat guardian, built on Clerk. | The roles are `roles-and-invites.md`'s: the Syros Cats team (staff and management; volunteers and staff are one role), cat guardian, and a reserved vet. This spec names which of that spec's capabilities it uses (§4.3) and adds none. |
| A single `Observation.kind` table covering all of this in one phase. | Coat is a kind that already exists. This spec proposes two more (markings, vaccinated) and one team-only note kind on the cat (§10), and nothing else. |

---

## 3. The words

Everything a person can say about appearance comes from two fixed lists. A person picks from chips, with a small picture and the word. They never type. Each list entry has a stable code (what the database stores) and a label in each language.

### 3.1 Coat colour

These are exactly the eight values `choose-a-different-cat.md` §4.7 already fixed for the colour filter. They are **not a second list**. SYC-2 inherits them and adds nothing to them in this spec.

A cat has **one or two** colours. *Tabby* is a pattern rather than a colour, so a ginger tabby is *Ginger* and *Tabby*. *Not sure* is never combined with another colour.

**One way to say it.** *Black* plus *White* and *Black and white* mean the same cat, so a pair that is exactly black and white is stored as the single value `black_and_white` before anything is compared (§4.2). Colours are always compared as sets, never as the order or the way someone tapped them.

| Code | English | Greek (draft) | French (draft) |
|---|---|---|---|
| `black` | Black | Μαύρο | Noir |
| `white` | White | Λευκό | Blanc |
| `ginger` | Ginger | Πορτοκαλί | Roux |
| `grey` | Grey | Γκρι | Gris |
| `tabby` | Tabby | Τιγρέ | Tigré |
| `tortoiseshell_or_calico` | Tortoiseshell or calico | Χελωνόχρωμο ή τρίχρωμο | Écaille de tortue ou calico |
| `black_and_white` | Black and white | Ασπρόμαυρο | Noir et blanc |
| `not_sure` | Not sure | Δεν είμαι σίγουρος/η | Pas sûr |

*Black and white* is the everyday word for the original design's "Tuxedo", and they are the same value.

### 3.2 Markings

Markings are the things people use to tell two cats of the same colour apart. They are **additions**: a cat can have none, or several. The list is short on purpose; every entry has to be something a stranger can see in a normal photo and agree on. **Anyone can state any of the eleven**, spotters included, under the same rules (§4.2).

> **Decided (Samuel, 12 October 2026): the "This cat needs help" link shows when any of the four markings is ticked, as recommended.**
>
> **Updated after Samuel's decisions (12 Oct 2026).** The review (M6) had made four of these team-only. Samuel reversed that: they are ordinary recognition features and anyone can tick them, because they are exactly how people describe a cat ("the one with one eye"). The "This cat needs help" link now also appears when any of the four is ticked (§5.1).

**The first seven** (plainly visible and cosmetic, or a ragged ear that needs somewhere honest to go):

| Code | English | What the chip's picture shows | Greek (draft) | French (draft) |
|---|---|---|---|---|
| `white_paws` | White paws | Dark cat, white feet | Λευκά πόδια | Pattes blanches |
| `white_chest` | White chest or bib | White patch under the chin and chest | Λευκό στήθος | Plastron blanc |
| `white_face` | White patch on the face | A white blaze, nose or muzzle | Λευκή κηλίδα στο πρόσωπο | Tache blanche sur le visage |
| `colourpoint` | Dark face, ears and tail | Paler body, darker "points", like a Siamese | Σκούρο πρόσωπο, αυτιά και ουρά | Visage, oreilles et queue foncés |
| `long_fur` | Long fur | A fluffy or long-haired cat | Μακρύ τρίχωμα | Poil long |
| `kinked_tail` | Kinked tail | A tail with a visible bend or break | Στραβή ουρά | Queue coudée |
| `torn_ear` | Torn or notched ear | A ragged or notched ear (a fight scar), **not** a clean straight clip | Σκισμένο αυτί | Oreille déchirée ou entaillée |

**These four are also ticked by spotters, exactly like the seven above.** Updated after Samuel's decisions (12 Oct 2026): anyone can state them. Reason: they are the words people actually use to recognise a cat, and a spotter who can only add a mark (§4.2) cannot do lasting harm with them:

| Code | English | What it means | Greek (draft) | French (draft) |
|---|---|---|---|---|
| `short_tail` | Short or missing tail | A stump or a very short tail | Κοντή ή χωρίς ουρά | Queue courte ou absente |
| `missing_eye` | Missing an eye | One eye gone or sealed over for good | Λείπει ένα μάτι | Un œil manquant |
| `three_legs` | Three legs | A cat that has lost a leg | Τρία πόδια | Trois pattes |
| `odd_eyes` | Eyes of different colours | One blue, one green or gold | Μάτια διαφορετικού χρώματος | Yeux de couleurs différentes |

**They are plain recognition features, never injuries.** The public wording is "One eye", "Three legs", "Short or missing tail", "Eyes of different colours". Nothing about them says hurt, lost or damaged.

**Odd eyes.** Eye colour in general stays out of the vocabulary (§3.3), because it looks different in every light. Only *eyes of different colours* (one blue, one green or gold) is a marking.

**Because a fresh injury can look like these,** a spotter who ticks *torn ear*, *kinked tail* or **any of these four** is shown the "This cat needs help" link on the spot (§5.1). The chip is never the way to report an injury, and a worried person must always have a route to help.

**What this choice accepts.** A tourist may tick *three legs* for a cat that has only tucked a leg under, or *missing eye* for a squint, or *short tail* for a tail curled out of frame. Three things limit the harm: spotters can only add marks, and a mark is shown only once two independent voices (different devices, photos and days) agree, so one mistaken tap does not reach the page; the team (or a cat guardian for her own colonies) can retract a wrong mark, which removes it for good (§4.4); and the "needs help" link appears beside the chips, so a real injury still has a route to the team. (Updated after Samuel's decisions, 12 Oct 2026.)

**How many.** A spotter's answer holds **at most four** marks, to keep the card short. A team or guardian statement carries **the whole list**, however long: a cat with white paws, white chest, white face, long fur and a kinked tail has five, and the record must be able to say so.

Two more answers exist for every list and mean different things:

- **"Nothing special"** is a real answer: *I looked, and there is nothing to note*. It is stored as an empty list.
- **"Can't tell"** (photo too dark, wrong angle) is stored as such, stops the app asking this person about this cat again, and has **no effect on the record**, exactly as the ear-tip question treats it. It also withdraws nothing the same person ticked earlier (§4.2).

**The Greek and French wording above is a first draft for a local check.** `choose-a-different-cat.md` §12 (C11) already flagged that tabby, tortoiseshell and calico have no agreed everyday word in Greek. The same applies to *colourpoint*. Johnny checks every Greek and French label (SYC-283), and Syros Cats feed back during testing if any word is wrong (§12, question 1, answered).

### 3.3 What is deliberately not on either list

- **The ear tip.** A clipped ear tip is its own question with its own rules (data spine §4), and it stays that way. Putting "ear-tipped" in a list of markings would give the public a second, rules-free way to say it. It is also the one marking where a wrong answer sends someone to trap a cat that was already done. *Torn or notched ear* is on the list precisely so a tourist who sees a ragged ear has somewhere honest to put it. **Whenever the markings chips are shown, the picture of *Torn or notched ear* is shown beside the ear-tip example photo from Syros Cats** (the one SYC-79 ships), so the two are never confused. That side-by-side image is a required asset for the markings chips, as the data spine §4.4 made it for the ear tip. (Decision SYC2-D3.)
- **Eye colour as a changing impression, breed, weight, temperament, age.** Eye colour shifts with light and phone cameras, and the others are guesses from a photo. If it would not change how someone finds or recognises the cat, it is not recorded. (*Eyes of different colours* is a lasting feature the team states, not a spotter's impression.)
- **Injury, illness, eye discharge, limping.** These are conditions, not markings. A cat that has *lost* an eye is a marking, stated by someone who knows the cat. A cat whose eye looks sore is a welfare report (§6.4).
- **Free text.** The app is trilingual; three words for one colour is three unsearchable strings.

---

## 4. Who can say what

### 4.1 The principle

**Spotters suggest. The team, and cat guardians for their own colonies, state.** A suggestion is a real record: it is dated, attributed to a device, kept, and visible to the team. It simply does not decide what the public sees on its own, with the one exception in §4.2 where it would otherwise leave a gap.

This is the same shape as the ear-tip rule (data spine §4): the crowd supplies volume, a trusted person supplies certainty. The difference is that colour and markings are plainly visible and cosmetic when wrong, so the bar is lower, the rules are simpler, and a guardian's word stands directly instead of waiting in a queue (roles spec, Decision 13).

### 4.2 How a cat's colour and markings are worked out

These are the rules the resolver applies. They are written here in plain terms so the product can be judged; §10.2 puts them into the data spine as a proposed amendment, and from then on that is where they live. They are the rules `choose-a-different-cat.md` §8.4 asked the data spine to own, made precise, with one deliberate change to an approved sentence (SYC2-D10).

**Before any rule runs, tidy the statements:**

- Throw out any statement that has been replaced or **retracted** (§4.4).
- Treat *Not sure*, *Can't tell* and any other answer that says nothing as no statement at all, with one exception for colour: **a spotter's newer *Not sure* withdraws that same device's earlier colour** (Samuel, 14 October 2026). Their device then counts towards nothing until it names a real colour again. For markings, *Can't tell* and "nothing special" still withdraw nothing (markings rule 4).
- **Black plus white means black and white.** A pair that is exactly black and white is stored as `black_and_white`. Colours are then compared one at a time as plain values, never as the order or the way someone tapped them.
- **One voice per device, counted when the answer is worked out.** Whoever is the author of a statement is one *voice*. If several standing statements on one cat come from the same device, only the newest counts. This is checked every time the answer is worked out, so a mistake in any writing route cannot let one device count twice. (It is also enforced at writing time, §10.3.)
- **A pair of voices only counts as two if they come from different photos and were written on different days** (Syros calendar days). A real user loses nothing by this; the "same photo from two browsers on one afternoon" trick now needs two visits.
- A team member's or guardian's "yes, that's right" is stored as a team (or guardian) statement that agrees with an earlier one, not as a separate kind of evidence (§4.4). There is no lesser "volunteer confirmation".

**Colour**

1. **A statement from the team or a cat guardian wins.** A cat guardian's standing statement (for a cat in her own colonies) outranks the team's (staff and management), whichever is newer; within the same level, the newest standing statement is the answer (Decision G, `roles-and-invites.md` plan, applied to colour by Samuel on 13 October 2026). The team overrules a guardian deliberately: **Correct** on a cat whose answer is a guardian's statement marks every guardian statement of colour that stands on that cat wrong and records the team's colour in one step, with a required reason, shown on the recent guardian changes list. Vets, imported records and owners have no standing on appearance (owners until the SYC-130 claim work decides otherwise). This is the *Confirmed* level. A later machine reading is recorded but never overrides it, and a spotter whose answer is later cannot change it.
2. **Otherwise, two spotters who agree, colour by colour.** A colour is *Likely* when two voices hold it (a colour a voice named as part of a pair counts for that colour). So *Ginger · Tabby* from one spotter and *Ginger* from another agree on *Ginger*; *Tabby* has only one voice and is not shown. At most two colours are shown.
   - If more than two colours are agreed, the two with the most voices are shown; on a tie, the colours whose newest supporting statement is more recent.
   - If two colours are agreed but **nobody ever named both** (two separate camps, such as two voices for *ginger* and two for *black*), only the camp with the **newer supporting statement** is shown, and the cat goes onto the team's Colour check list.
   Taps that merely confirmed a pre-filled guess count as **prompted**, not independent, and do not count towards the two (the data spine §10.1 comment on `provenance`; the original July draft §5.2 made the same point).
3. **Otherwise, the machine's reading** (SYC-161), if it is not *Not sure*. This is *Reported*. Only the machine's **newest** reading counts: if the team has marked it wrong, or it is *Not sure*, the machine has no reading and an older one never comes back (Samuel, 14 October 2026).
4. **Otherwise, one spotter's word fills a gap.** If the machine said *Not sure* or never read the cat, the **newest** single spotter's suggestion is shown until something better arrives. A single spotter **never replaces a real machine reading by themselves.** (This is the change to an approved sentence; see SYC2-D10.)
5. **Otherwise, Not sure.**

A person saying *Not sure* or *Can't tell* is never a statement about colour and never beats anything; a spotter's *Not sure* can only withdraw that same device's own earlier colour. If the answer came from spotters (rule 2 or 4) and the machine has a different real reading, the cat goes onto the team's Colour check list (§5.3): the one case the review found a determined pair could use is the case the team is shown.

**Markings** (no machine reading in this version, SYC2-D4)

1. **A statement from the team or a cat guardian is the whole list.** A cat guardian's standing statement outranks the team's, and within the same level the newest stands (as for colour, Decision G); it is the cat's markings, including an empty list ("nothing special"). The team overrules a guardian's list with **Correct**, as for colour. *Confirmed.* It cannot be gamed by a spotter changing their answer: once a team or guardian statement stands, a spotter who had already answered cannot change that answer (as `EAR_TIP_CHECKED` does for the ear tip), and a new spotter's colour answer is refused with a gentle "Syros Cats have checked this one."
2. **Cats change, so the list can reopen.** A mark that **two voices** have ticked, whose sightings are **dated after** the standing team or guardian statement (the one that currently decides the list), is shown alongside that list, and the cat goes back onto the Colour check list for the team to confirm or reject. A cat loses an eye or tears an ear after the team wrote its list; this is how that reaches the page. Removals still need the team.
3. **Otherwise each mark stands on its own:** a mark is shown once two voices (different devices, photos and days) have each ticked it. *Likely.* A mark only one person ticked is held, and is visible to the team as a suggestion.
4. **Spotters can only add.** A spotter leaving a mark unticked is not evidence the cat lacks it (the cat may be photographed from the wrong side), so no number of omissions removes a mark. A device's later markings answer **adds to** what that device ticked before and never withdraws it. *Can't tell* is recorded and withdraws nothing, and so does "nothing special" from a device that had ticked marks earlier. Only the team (or a guardian) can remove one. This is the ear-tip rule applied to markings.

**Four guards that apply to both**

- **A new statement only ever replaces the same device's own earlier statement.** One device can never replace another's (the ownership rule in `add-details-later.md` §6), and there is a test for it.
- **Colour and markings are never evidence of life** (data spine §3.4) and never notifiable. A colour reading on an old photo says nothing about whether the cat is alive, and nobody gets a push because a cat's colour changed.
- **The public sees the answer only.** Not how many people said it, who, when, or whether a person or the model said it. The team sees all of that.
- **At most one appearance question per sighting.** The details card asks one thing at a time, and never again once answered or skipped.

### 4.3 What the team and guardians can do, by name

`roles-and-invites.md` §6.2 is the single list of capability names. This spec uses four of them, with the holders that spec gives them, and adds none. *Updated after Samuel's decisions (12 Oct 2026): volunteers and staff are one role, so there is no volunteer column and no `confirm_appearance`; a team member's statement is a team statement.*

| Capability | What it lets someone do | Kind | Team (staff) | Management | Cat guardian |
|---|---|---|---|---|---|
| `set_appearance` | State, confirm, correct or remove a cat's colour and markings | Placed | All | All | Own colonies |
| `set_vaccination` | Record a vaccination | Island-only | ✓ | ✓ | — |
| `view_health_notes` | Read team-only health notes on a cat | Placed | All | All | Own colonies |
| `add_health_note` | Add a team-only health note on a cat | Placed | All | All | Own colonies |

"All" means the whole island, "Own colonies" the colonies she guards. **Placed** capabilities need a target, and the target is looked up from the record, never from the request: a cat's colony is its newest colony observation, and a cat in no colony can only be touched by island-wide holders. Nothing in the app asks "is this person a guardian?" for any of these; every screen and route asks for the capability by name (roles spec §6.1).

**Vets are reserved** (roles spec §2.6). A vet has no standing on appearance. When vets exist, `set_vaccination`, `view_health_notes` and `add_health_note` gain a vet column and nothing else changes.

**What is authoritative for what.** Authority is per attribute, as the data spine says:

| Fact | Authoritative | Everyone else |
|---|---|---|
| Colour, markings | Staff and management; a cat guardian for cats in her own colonies (stands directly, not queued, Decision 13) | Spotters suggest |
| Sterilised | Not restated here. Who can confirm sterilisation is `roles-and-invites.md` §7.2 (Decision 5, decided 12 Oct 2026); how a statement is recorded and weighed is the data spine's (§4.6, and its amendment from the roles spec) | Ear-tip evidence only |
| Vaccinated | Staff and management (`set_vaccination`) | Nothing. They cannot see it, so they cannot say it |
| Condition notes | Anyone with `add_health_note` (team; guardians for their own colonies) | Cannot see or write them |
| Life status | Unchanged (data spine §3.2; roles spec §6.2) | Unchanged |

Appearance and health are not sterilisation, so nothing in them goes through the roles spec's sterilisation routes or its field-check queue.

### 4.4 Correcting a wrong colour or mark

The team and guardians correct from the cat's dashboard page (a guardian from her workspace), using the pattern PR #99 established for life status and sterilisation: every change is a new signed statement with a required reason, nothing is overwritten. For appearance there are three kinds of write, because "this one statement is wrong" is not the same as "here is the right answer":

- **Confirm.** A statement with the same value as the one it confirms, linked to it.
- **Correct.** A real statement carrying the whole new value (for markings, the whole list). It becomes *Confirmed*. On a cat whose answer is a cat guardian's statement, Correct also marks her standing statements wrong in the same step (§4.2 rule 1), so the team's answer is the one shown. For colour, Correct offers the colour chips without *Not sure* (Samuel, 14 October 2026): the team undoes a colour with **Mark wrong**, never by stating *Not sure*.
- **Mark wrong (retract).** A statement whose value is **retracted** (`{ retracted: true }`). It removes the statement it points at from the count and asserts nothing in its place. Marking one of three spotters' marks wrong leaves the other two marks shown; marking a spotter's colour wrong leaves the next rule to decide, rather than freezing whatever the team member happened to type. A retraction is a `set_appearance` act: accepted from staff, management, or a guardian on her own colonies, and refused from everyone else, including spotters.

The correction route is extended to accept `coat` and `markings` (including the retraction), gated by `set_appearance` (§10.3).

A wrong colour reported by the public through "Report an issue" (SYC-44, *wrong information about this cat*) reaches the team the same way `choose-a-different-cat.md` §4.7 already describes. Spotters never edit colours or marks directly.

---

## 5. What people actually see and do

### 5.1 A tourist or resident, spotting

**Nothing changes before the points.** The spot flow, the naming screen and the reward are untouched. No appearance question appears between a spotter and their points (data spine §7). The naming screen is the step that finds out whether the cat is new and then shows the points, so it comes before them; it never carries an appearance question.

Appearance is asked in two places, both after the points:

1. **On the result screen for a new cat, one optional line below the points.** The person has just been told they found a new cat, is still looking at it, and the model has usually already read its colour. One line, colour only, pre-filled where the colour has been read:

   > *Agatha looks* **Ginger · Tabby** *— right?*
   > `Yes` `Change` `Skip`

   *Change* opens the colour chips (pick one or two, or *Not sure*). Skipping costs nothing and the line does not come back on this screen. If the cat has no name yet, the line says "This cat looks…". The answer is written through the same answers endpoint as the details card (§10.3), so it needs signal, which this screen already has because the cat was just named online.

2. **On the "add details later" card** (`add-details-later.md` §8 names this as the next kind of detail). The card exists for **an open sighting of the person's own (the last 30 days)**, and shows **that sighting's own photo** beside the chips, not the cat's main photo. If the match was wrong, the person describes what they saw and the mismatch can be caught. The card asks about colour if the cat's colour is unconfirmed or *Not sure*, and about markings if the cat has none recorded, **at most one appearance question per sighting**, colour first. The question for markings reads "Anything that makes Agatha easy to spot?" (the cat's name, or "this cat" if unnamed; never "her" or "him", because sex is not recorded and Greek and French carry gender through the whole sentence). The card is hidden offline, like the rest of the card.

Taking a pre-filled "Yes" is recorded as a **prompted** confirmation (it agrees with the machine); picking something different is recorded as a **volunteered** statement. The difference matters for §4.2, and it is how the record tells a considered answer from a tap-through.

**Does it look hurt?** Whenever a spotter ticks *Torn or notched ear*, *Kinked tail*, or any of *Short or missing tail*, *Missing an eye*, *Three legs* or *Eyes of different colours*, the screen shows, right there, the same "This cat needs help" link the cat page carries, with the words "Does it look hurt? Tell Syros Cats." Any of these can be a fresh injury, a tourist cannot tell the difference, and the appearance question must never be the only place a worried person's attention lands. A test checks that the link renders whenever any of the six chips is ticked.

> *Updated after Samuel's decisions (12 Oct 2026).* The first two triggers were in the reviewed draft. Showing the link for the four newly open marks is **added so an injury still reaches help; Samuel can drop it.**

**No points for appearance.** The data spine's guard (one person, one attribute, one cat counts once) is satisfied by simply paying nothing here. If Samuel later wants a small reward, SYC-38 owns points and it is a one-line change; this spec does not create a way to farm points by tapping colours.

### 5.2 On the cat's page

The page shows what is known, quietly, next to the location label:

> **Ginger · Tabby** · White paws · Kinked tail

*(Updated 12 October 2026, plan decision E1: two colours are joined with " · " in every language, so there is no grammar to get wrong.)*

Nothing is shown for a cat whose colour is *Not sure* and has no markings. The page never says how sure the app is, and never shows "suggested by 1 person". Those belong to the team.

Four marks are shown like any other, whoever stated them (§3.2): *Missing an eye*, *Three legs*, *Short or missing tail* and *Eyes of different colours*. The page shows each as a plain recognition feature ("One eye", "Three legs"), never as an injury or a condition. Whether those words are right is a question for Syros Cats (§12, question 5).

### 5.3 The team

On a cat's dashboard page, an **Appearance** section next to *Correct the record*:

- the current colour and markings, with every statement beneath (the machine's reading, each spotter's suggestion, any guardian or team statement), who made it and when;
- **Confirm** (one tap: *that's right*) and **Correct** (pick the right chips, with a short reason). Confirm writes a team statement with the same value; the history shows it linked to what it confirmed, as PR #99's *Looks right* does (on a cat whose answer is a cat guardian's, Confirm records the team's agreement and changes nothing the public sees; Correct is how the team overrules her);
- **Mark wrong** on any single statement. This **retracts** that one statement: it removes it from the count and asserts nothing in its place. It does not make the team member re-type a list or pick a colour. If a replacement is wanted, the team member then uses **Correct** (§4.4).

A small **"Colour check"** list in the top bar is the team's low-priority list of cats whose appearance deserves a second look, with the main photo, newest first, and the same Confirm / Correct buttons. A cat is on it when any of these is true:

- its colour is the machine's alone, or *Not sure*, and no team or guardian statement stands;
- its colour **came from spotters and disagrees with the machine's reading** (the case where two people have overturned a real reading);
- its colour is tied between two groups of spotters (§4.2);
- its markings **changed on spotter agreement in the last 30 days**, or moved after a team statement (§4.2, markings rule 2);
- on a **hand pick** (`choose-a-different-cat.md` §4.3), the cat chosen is recorded as one colour and the spotter's own colour answer for that sighting is another. That flag is team-only and the spotter sees nothing different.

It is low priority by design, a few minutes a week, and it is **not** the roles spec's "Needs an OK" confirmation queue. When cat guardians have accounts, they see the same list for their own colonies.

### 5.4 Cat guardians (once the roles spec is live)

- **A cat guardian** sees the same Appearance section for cats in her own colonies, with `set_appearance` for those colonies only. What she states **stands directly**. It is not queued for an OK, because a wrong colour is cosmetic and easy to reverse (roles spec, Decision 13). The team sees it in their feed of recent guardian changes. She also reads and adds team-only health notes on cats in her colonies (`view_health_notes`, `add_health_note`, §6.4).
- **Everyone else** who spots a wrong colour does what anyone does: "Report an issue", or the details-card suggestion if they have a recent sighting.

---

## 6. Health: what it means, and what is public

### 6.1 Why there is no "health status"

The original design wanted a badge row: *Ear-tipped*, *Looks healthy*. Both halves have problems.

- **"Looks healthy"** is a claim about a cat's body from a stranger's glance. Most illness in street cats is invisible in a photo. A green badge on a cat that is quietly unwell tells the next person not to worry, which is the opposite of what the app is for. And a status that is true on Tuesday is a falsehood by Friday.
- **"Ear-tipped"** is already handled, and handled carefully. It is the sterilised line on the cat page (data spine §4.2), and nothing here repeats it as a badge.

What remains is a set of different facts, with different audiences. Calling them all "health status" is what made SYC-2 look like one decision when it is really three.

### 6.2 The three kinds of fact

| Kind | Examples | Who can state it | Who sees it |
|---|---|---|---|
| **A. On the cat page already** | Sterilised; ear tip; life status (street, homed, in care, no longer with us) | As the data spine says (§3.2, §4.6). For sterilisation, who may confirm it is `roles-and-invites.md` §7.2 (Decision 5), not restated here | Everyone, in the existing lines |
| **B. Vaccination** | Rabies; "cat flu and enteritis" (the standard core combination); another vaccine the team adds by name | The team (`set_vaccination`, staff and management). Never a spotter or a guardian. A vet column is added when vets exist | **The team only**, at launch. The public sees at most an overall count, never a cat (§6.3) |
| **C. Condition** | Illness, injury, a long-term condition, treatment under way, pregnancy | The team, and cat guardians for cats in their own colonies, as a **team-only note on the cat** (`add_health_note`) | **The team, and cat guardians for their own colonies** (`view_health_notes`). Never the public, never in any public payload |

**Public rule, in one sentence: the public sees what helps them find, recognise or help a cat, and nothing about its medical history.**

### 6.3 Vaccination (kind B): team-only at launch

A vaccination is a clinical fact. A spotter cannot see it in a photo, so a spotter cannot state it, and there is no spotter question for it. This is the same logic as the old draft's "sterilised, vaccinated: not visible at all, so never machine-read and never crowd-stated".

- It is an observation of a new kind, `vaccinated` (§10), stated by the team with the date it happened as the observation's date and the vaccine named from a short list (**Answered, Samuel, 12 October 2026, Q3: rabies, and the core "cat flu and enteritis" combination**) or, for anything else, by a name the team types. No brand is named anywhere. The vaccine names are fine in the team's own record; they are the part that must never reach a public screen (below).
- The team enters it from the cat's dashboard page with `set_vaccination`, which is island-only: staff and management hold it, a guardian does not (roles spec §6.2). Syros Cats' existing records could populate it through the optional import (`records-import.md`) without any change here.
- **There is no *Likely* level and no negative.** The state is either *the team has recorded a vaccination* (with its date) or *nothing recorded*. *Nothing recorded* is **not** "not vaccinated"; it means we do not know.
- **It is not on the public page, the public timeline or the public payload.** Why: a line like "Vaccinated against rabies" on a cat's page is a medical claim the charity cannot stand behind. A tourist who has just been scratched would reasonably read it as "I don't need to see a doctor", on the strength of a record that might be years old or matched to the wrong cat. It also sits badly beside the onboarding advice to keep your distance.
- **Donors see an overall count instead, worked out automatically (Answered, Samuel, 12 October 2026, Q6: yes).** SYC-5's need ("€10 covers a rabies vaccine") is better met by one number, "N cats vaccinated this year". The app computes it on the server from the team's `vaccinated` records; nobody types it. It is a count of **cats** (a cat vaccinated twice, or against two diseases, counts once), with no cat identifiable and no vaccine named. It appears on the **donate screen** and in the **charity's reports**.
  - **What counts.** Distinct cats with at least one recorded vaccination dated in the current calendar year. *Nothing recorded* is not counted.
  - **Small numbers.** Until the count reaches 5 the figure is not shown (a count of 1 or 2 near a named colony would point at a cat). This is a judgement call for Samuel to veto.
  - **One endpoint, no detail.** A public read returns only the number and the year, with a short cache; it has no list, no date of any single vaccination, no colony.
  - **Where it must fit.** The donate screen is part of the donation work (SYC-1) and the reports are SYC-62's; this spec supplies the figure and its rules, and those tickets must show it as a single sentence with no per-cat or per-colony breakdown. Checking that fit is a task for each of those specs when they are written. No SYC-62 document exists in the repo yet, so it is recorded here as a requirement on it.
- **If it is ever made public** (SYC2-D6, option B), three things are required before it ships: Syros Cats and their vet have seen the exact wording; **the vaccine is never named** (no "rabies" and no "cat flu and enteritis" anywhere); and beside it, in all three languages, a fixed line: **"If a cat bites or scratches you, see a doctor."** A test asserts that the words "rabies", "cat flu" and "enteritis" appear in no public payload and no public string, in any language, whatever is decided.
- It feeds the team's view of a cat's care history: the team can see how long ago, so a re-vaccination round can be planned. SYC-5's public **Care timeline** does not show it. SYC-5's description should be updated to point here (§10.7).

### 6.4 Conditions (kind C) and the urgent route

This is the part that must not go wrong.

**The urgent route is untouched and always first.** "This cat needs help" (`team-access-and-welfare-queue.md` §4) sits on every cat page, in the camera flow and on the map, and it points a worried person to a vet first (F1). The rules below keep it that way:

1. **There is no condition control for the public, anywhere.** No "is this cat healthy?" question, no health chips, no free-text health box in the spot flow. A spotter who is worried about a cat uses the report route, or the optional note on the details card, which the team sees and highlights (data spine §7.1).
2. **A recorded condition never replaces, hides or closes a welfare report**, and a welfare report never writes a condition. They are different records: the report is the queue's, the condition is the cat's. A team member can see both side by side.
3. **A recorded condition never changes what the cat page offers.** The "needs help" link is on every page of a cat whatever the team has noted about it, including a cat noted as "treatment under way". Someone seeing a *new* problem on a cat already under treatment must still be able to say so.
4. **Nothing on a public page implies the cat is well.** No "healthy", "fine" or "no known problems". A page that is silent about health says nothing, and says it equally for every cat.
5. **Condition notes are a team-only note on the cat itself.** They are a new kind of observation on the cat, `team_note { text }` (a proposed data-spine amendment, §10), refused from the public role and never in any public payload. They are **not** the note on a welfare report: the report's note (`add_team_note`) stays exactly as it is, belongs to the report, and goes when the report is deleted after its three years. A cat's health history belongs to the cat and lives as long as the cat's record does. Reading these notes is gated by `view_health_notes` and writing them by `add_health_note`, both **placed** capabilities: staff and management on every cat, a cat guardian on cats in her own colonies, nobody else. They are plain text, nothing is derived from them, and they are not a structured status (SYC2-D5). The spotters' own optional "Anything you noticed?" notes are where most health information first arrives (data spine §7.1); they are team-visible today, and when guardians arrive, whether a guardian sees them is controlled by `view_health_notes` too.
6. **Health and vaccination are never written through the old care route.** The shared-password route `POST /cats/:catId/updates` writes a row on the **public** care timeline and sends push notifications to followers. Nothing about a cat's condition or vaccination is ever written through it. Its `general` type is retired for team use when the shared-password care route is retired (team-access spec), or sooner. Old app builds show an unknown care-timeline type as a raw `general` message, so any new timeline row for any purpose needs a message that reads well untranslated, or is left out for old builds.

Why not a structured, team-only condition list now: nobody has told us what Syros Cats track. The old draft invented the list; inventing it again repeats the mistake. A free-text note costs nothing and loses nothing. Once Syros Cats say what they actually keep (§12, question 2), a small fixed list can be added the same way coat was, without changing anything here.

### 6.5 What is public, in full

| Fact | Public? | How |
|---|---|---|
| Colour | Yes | The resolved value only (one or two colours, or none) |
| Markings | Yes | The resolved list only |
| Sterilised | Yes | Existing four lines (`DECISIONS.md` D4 shows a confirmed negative) |
| Ear tip | Yes | Existing; not repeated as a marking |
| Life status / not seen since | Yes | Existing lines |
| Vaccinated | **No**, at launch. Never per cat | Team only. Donors see an overall count with no cat identifiable |
| Not vaccinated / unknown | **No**, never shown | Absence is silent |
| Condition, treatment, pregnancy, notes | **Never** | Team only; guardians for their own colonies |
| Welfare reports and outcomes | **Never** | Team only (data spine §10.1) |
| Who stated what, when, how many people | **Never** | Team only |

Why vaccination was not given a positive-only public line the way sterilisation shows a confirmed negative (`DECISIONS.md` D4): the sterilisation status is the app's central purpose and Samuel decided honesty there outweighs the targeting risk. Vaccination has no such mission weight, and a public line about it carries a medical meaning the charity cannot stand behind (§6.3).

---

## 7. How this helps matching and finding a cat

### 7.1 Matching is unchanged

The photo decides. Colour is never used to pre-filter the matcher's suggestions, and `choose-a-different-cat.md` §4.7 already says so. This spec keeps that rule and adds nothing to the matching call. Neither colour nor markings are fed into the model's prompt (SYC2-D8), because the model would then be partly agreeing with a reading it produced itself, and a wrong colour would quietly steer it away from the right cat.

### 7.2 Finding a cat by hand

- **The colour filter in "Find the cat"** sits on top of the resolved colour: the machine's reading, improved by people's corrections. More cats have a colour, and the wrong ones get fixed. All the filter's protections stay exactly as specified: *All* by default, more than one colour allowed, *Colour not known* cats always stay visible, and the "N more cats in other colours. Show all colours." line sits above "Can't find it? Add it as a new cat".
- **Markings show on each card** in the picker as one short line ("White paws · Kinked tail"). This lets a spotter compare in the moment, the way people actually say it: "the one with the missing eye". They are **not a filter**. A cat with no markings recorded is most cats, and a "Kinked tail" filter would hide cats that simply have not been described. If a marking filter is ever added it must keep the colour rule: cats with no marking recorded always stay in the list.
- **A hand pick that disagrees with the cat's colour** is flagged to the team on the Colour check list and in the "Matched by hand" review. The comparison is between the cat's resolved colour and **the colour the spotter themselves gave for that sighting**, when they gave one ("the cat picked is recorded as black; the spotter called this sighting ginger"). No new model call is made: the matching model reads the cat's main photo once per cat (`choose-a-different-cat.md` §4.7), not each sighting photo, and reading every hand-picked photo would add a model call with its own cost for a cosmetic flag. If a spotter gave no colour, nothing is flagged. The spotter sees nothing different. This extends the review flags in `choose-a-different-cat.md` §4.3 and is team-only.

### 7.3 The cat-alog

The ticket noted that colour data makes the design's "Needs vet" and "Desexed" filters possible. They are not equally good ideas.

- **Colour** is added to the cat-alog's filters (the same chips, the same "Colour not known" rule).
- **"Needs vet"** is not built, now or later. It would be a public list of cats marked as unwell, which is exactly the health information §6 keeps private, and it would invite people to treat the filter as a substitute for the urgent route. (SYC2-D7)
- **A sterilised / not-sterilised filter** is deferred. The public "Probably sterilised" line sat behind its own gate (decision Q2 in the data spine plan, the `LIKELY_STERILISED_PUBLIC_LIVE` switch, SYC-198) until SYC-75 opened it in October 2026, so the filter can now be reconsidered on its own merits.

---

## 8. What works offline

Being precise, because offline support in this app is partial:

| Thing | Offline? |
|---|---|
| Seeing a cat's colour and markings on its page or card, for cats in the last catalogue the phone loaded | **Yes.** They ride in the cached public catalogue (§10.4). A stale cache can show an out-of-date colour; it corrects on the next fetch. A phone that updates the app with no signal keeps its existing catalogue (§10.4): the cache key is not changed |
| The colour filter in "Find the cat" | **Yes, over the cached catalogue.** The picker is built from the cached cats, so filtering needs no signal. A cat that arrived after the last load will not appear, as for the rest of the picker |
| Saying a cat's colour when a new cat is named | **No.** Naming a new cat happens after matching, which needs signal, and the colour line sits on the result screen after the points, which is already online. A spot saved offline is matched and named when it syncs |
| Suggesting colour or markings on the "add details later" card | **No.** The card is hidden offline, as it is now. Appearance suggestions are not added to the offline queue (SYC2-D9) |
| Team and guardian confirm / correct / vaccination / health notes | **No.** The dashboard is online only. A guardian's saved list on a phone (roles spec §12) does not include appearance writes |

So: appearance **reading** works with the cached catalogue; appearance **writing** needs a connection. Nothing here queues, so nothing here can go stale in the queue or race a team correction.

---

## 9. English, Greek and French

- Every label in §3 exists in all three languages, with the same code underneath, so a Greek spotter's *Τιγρέ* and a French spotter's *Tigré* are the same `tabby`, and one filter chip finds both.
- **The labels in §3 are drafts: Johnny checks Greek and French (SYC-283) and Syros Cats say in testing if a word is wrong** (§12, question 1). The strings go in the existing translation files (`lib/i18n.ts`), with a test that every key exists in `en`, `el` and `fr`, as `catStatusLines` already has.
- Chips carry **the word as well as a picture**, so they work for colour-blind people and in bright sun, as `choose-a-different-cat.md` §4.7 requires.
- Wording for the questions, the "nothing special" and "can't tell" answers, the "Does it look hurt? Tell Syros Cats" line and the team-only Appearance section is written once in plain English and translated in the same change; nothing ships in one language only. **Questions use the cat's name or "this cat", never "her" or "him"** (sex is not recorded, and Greek and French carry gender through the whole sentence).
- Public copy never uses the words "healthy", "sick", "diseased" or "unvaccinated", and no public string names a vaccine (see §6.3).

---

## 10. Proposed data-spine amendment, and how it is built (for the builder)

Everything above is the product; this is the record underneath. **No database migration.** Observation kinds are code, not a database enum (data spine §10.1): `observations.kind` is free text with no constraint on its values, capabilities are code, and the public payload is built by `serialiseCat`.

**Who owns what.** The data spine owns observation kinds and the rules for which reading wins. This spec used to write those rules itself, which would have left two documents describing one resolver. So §10.1 and §10.2 below are written as an **amendment to the data spine**, to be approved together with this spec and then copied into the data spine's §10.1 (vocabulary) and §10.2 (resolver); from then on the data spine is the only place they live and this spec points at them. The ownership split is added to `DECISIONS.md` Part 3 (§15): *coat and marking vocabulary, health meaning and what is public* stay with this spec; *the kinds and the resolver rules* stay with the data spine.

### 10.1 Observation kinds (proposed amendment to data spine §10.1)

`OBSERVATION_KINDS` gains `markings`, `vaccinated` and `team_note`. `coat` already exists. Values:

```ts
//   coat        { colours: CoatColour[] }                        // 1–2 from the eight; ["not_sure"] alone
//               { colours: CoatColour[], modelVersion: string }  // machine reading (system:vision)
//               { retracted: true }                               // "mark wrong" (set_appearance only)
//   markings    { marks: Mark[] }                                // from §3.2; [] = "nothing special"; spotter answers hold at most 4, a team or guardian statement holds the whole list
//               { cantTell: true }                               // recorded, no effect
//               { retracted: true }                              // "mark wrong" (set_appearance only)
//   vaccinated  { vaccines: ("rabies" | "cat_flu_enteritis" | { other: string })[], clinic?: string }  // 1–3 distinct; "other" is a name the team types (no brand); date = observedAt
//   team_note   { text: string }                                 // a team-only note on the CAT; not a welfare-report note
```

- **`modelVersion` is required only on a machine reading.** The `coat` validator in `observations.ts` currently requires it on every `coat` value, which would refuse a person's statement. It becomes: required when `provenance` is `machine`, absent otherwise.
- **Who may write which kind.** `coat` and `markings` accept `public` (suggestions), `staff`, `management`, and `guardian` (with `authorityScope: colony:<id>` for her own colonies, written only by the server and only for the role `guardian`; the pattern is exactly `^colony:[1-9][0-9]*$`; `guardian_of_this_cat` stays reserved for the claim feature, SYC-130; `roles-and-invites.md` plan Decision B, Samuel 13 October 2026). There is no `volunteer` value: volunteers are on the team. `vet` has no standing on appearance and is refused. `vaccinated` is refused from `public` and `guardian`, and from `system` except `provenance: import` once `records-import.md` is built (the import is optional and after the first release). `team_note` is refused from `public` and `system`, accepted from staff and management, and from `guardian` only for her own colonies. The rename of the reserved `roleAtTime` value `admin` to `management`, and the live `guardian` value, are the roles spec's amendment to this section (`roles-and-invites.md` §17.1, item 3).
- A prefilled "Yes" is `provenance: "prompted"`, with `suggestedValue` set to the machine's value and `suggestionSource` naming the reading. A different answer is `volunteered`. A team or guardian Confirm carries `agreesWith: <statement id>` and **no photo**, the PR #99 pattern, so it never counts as independent public evidence.
- A team or guardian statement on `markings` is the whole list; an empty list is meaningful.
- **`coat`, `markings`, `vaccinated` and `team_note` are not evidence of life** (data spine §3.4). The honest reason for `vaccinated` is "not needed yet": a vaccination's `observedAt` is the date it happened, so an old import only says the cat was alive then, which moves nothing. A vet or team member who handles a cat is stronger evidence than an ear-tip answer; if Syros Cats begin recording vaccinations on the day, listing `vaccinated` as evidence of life is a one-line data-spine §3.4 amendment, and nothing here blocks it. The loader is an allow-list, so leaving it out takes no code.
- **The `team_note` kind is how the cat gets a note** (B2 in the review). Welfare-report notes (`add_team_note`, `POST /api/team/reports/:id/note`) are unchanged and stay on the report. A `team_note` is never in any public payload and is not removed when a welfare report is deleted.

### 10.2 The resolver (proposed amendment to data spine §10.2)

Three pure functions are added to `resolve.ts` and included in the cat snapshot: `resolveCoat`, `resolveMarkings`, `resolveVaccinated`. The rules for colour and markings are §4.2, word for word; those sentences move into the data spine on approval. Details:

- **Counting voices.** The resolver counts **at most one voice per `deviceId`**, among standing rows that still have one, whatever the write path did. Two voices also need **different `photoId`s** and **different calendar days** (Syros time). A device's write that would supersede a row only supersedes **that device's own** row. All of this is checked at read time, so no write route (the answers endpoint, a backfill, a future route) can make one device count twice.
- **Redacted rows.** After "Delete my data" a statement's device is cleared (data spine §8, DECISIONS Part 2g). Everything one "Delete my data" clears counts as **one** voice, so deleting your data never turns one person into two (the cleared rows share the moment they were cleared; review of PR 1.2, 14 October 2026). The limit is stated, not hidden: a deleted person's statement still counts, so someone who deletes their data and returns is a second voice. The photo-and-day rule above still applies where those fields survive redaction. SYC2-D1 accepts this.
- **Retraction.** A `{ retracted: true }` row removes the statement it supersedes from the count and asserts nothing. The resolver treats it as a gap, not a value.
- **Authoritative statements are compared by the date they describe** (`observedAt`), newest first, as the sterilised fold already does (data spine §4.6). A later machine reading never beats an earlier authoritative statement.
- **Confidence output** uses the existing ladder: authority `confirmed`; two voices `likely`; machine or a single gap-filling spotter `reported`. `reported` is the fourth rung the resolver already reserves; if SYC-52 has not made it reachable when this is built, this spec asks SYC-52 to make it so for these two attributes.
- **Never crosses attributes.** A confirmed colour says nothing about sterilisation, life status or vaccination, and a `vaccinated` observation does not feed sterilised (no clinical inference in either direction).
- **Not notifiable.** None of the four kinds is a derived-status change (data spine §9.3).

**The one approved sentence this changes.** `choose-a-different-cat.md` §8.4 says "a person's reading always beats the machine's". Under rule 4 of §4.2 a single spotter does not overturn a real machine reading. This is SYC2-D10, and a `DECISIONS.md` entry names it (§15). SYC-161's ticket repeats the old wording and is updated on approval (§10.7).

### 10.3 Writing

- **Spotter suggestions** are written through the post-points answers family that `add-details-later.md` already builds (`POST /sightings/{id}/answers` and its open-sightings read). That covers the colour line on the new-cat result screen and the details card alike. **The naming call carries no appearance data**: naming happens before the points, and no appearance question lives on that screen (§5.1). A device may only suggest for a cat it has a resolved sighting of, and only for an **open sighting (the last 30 days)**, so a stranger cannot tag cats they have never met. The write is per-device rate limited and refused for a deceased or merged cat.
- **The lock.** A device's appearance write takes the same lock as the details-card writes, on (device, cat), and **re-checks under the lock** that it is not already counted, so a double tap, a retry, or the result-screen line and the details card sent together cannot both land as two voices. This is the class of bug the details-card spec's second-pass review found (its finding 1).
- **A statement is refused after the team has ruled** where §4.2 says so (a changed answer from a device that had already answered; a new colour answer after a team or guardian statement).
- **Team and guardian writes** go through `lib/teamCorrections.ts`'s existing statement function, behind `set_appearance` / `set_vaccination` / `add_health_note` and the same Origin, session and capability order PR #99 established, with a required reason. `capabilityFor()` in that file is extended, because it currently returns nothing for any kind except life status, sterilised and ear tip, to accept `coat` and `markings` (gated by `set_appearance`, including `{ retracted: true }`), `vaccinated` (gated by `set_vaccination`) and `team_note` (gated by `add_health_note`). JSON and form routes call the same function so they cannot write different rows.
- **The "Colour check" list** is `GET /api/team/colour-check`, built like the Probably sterilised list: a cat is listed while any of the conditions in §5.3 holds. Guardians see the same list scoped to their own colonies.
- **Reading health notes** goes through a route gated by `view_health_notes` with the cat as the target; the cat's colony is looked up from the record.
- **No script on the dashboard pages** (DECISIONS Part 2k), so the chip pickers are plain checkboxes and radio buttons in a form.

### 10.4 The public payload and the cache

`GET /cats` and `GET /cats/{id}` gain `coat` (the resolved colours, as a list; `[]` means not known) and `markings` (the resolved list). **Not `vaccinated`**: vaccination is team-only (§6.3). Nothing else about them: not confidence, not author, not counts, not model version, not the date a colour was read.

- **One shape for "not known".** On the wire it is `coat: []`, never the string `not_sure`. `choose-a-different-cat.md` §8.4 and SYC-161 say "at most two values, or 'not sure'"; that becomes this single shape, written once in the data spine's §10.7 and used by every reader.
- **Tests.** A test asserts the payload contains none of confidence, author, counts, model version or read date for these fields. The public payload **already** carries `sterilised.confidence` and `clippedTipSightings`, so the test names the new fields specifically and does not assert "no confidence anywhere". A second test asserts the word "rabies" appears in no public payload or public string.
- **No cache-key bump.** The new fields are additive: an old client ignores them and a new client treats a missing `coat` or `markings` as "not known". The data spine's reason for a bump (§6.5, a *shape* change that could leak or break) does not apply. `cats-cache/public/v2` stays. In `cat-spotter/lib/catalogue.ts`, retired keys are deleted without being read, so bumping the key would empty the offline catalogue for anyone who updates the app with no signal (on a ferry, say), contradicting §8. A test reads a v2 cache written by today's build with the new client. If a bump is ever needed, the new code reads the old key as a fallback until the first successful fetch and only then deletes it. SYC-161 also plans a bump for the same field; it drops it.
- The OpenAPI spec and generated client change accordingly, and the public-payload snapshot test (`routes/__snapshots__/cats.publicDetail.p3-2.txt`) changes. That is expected.

### 10.5 Capabilities

No names are added. `roles-and-invites.md` §6.2 already lists `set_appearance`, `set_vaccination`, `view_health_notes` and `add_health_note`, and a test in that spec walks the catalogue so the document and the code cannot disagree. This spec asks only that the catalogue's holders (§4.3) are built as written. Until the roles spec ships, `can()` grants these to staff, exactly as for the existing twelve. `add_health_note` is **not** `add_team_note`: the first writes a note on a cat, the second a note on a welfare report, and they are held differently.

### 10.6 Tests

- **Colour:** each of the five rules in §4.2 in isolation and in conflict; a person's *Not sure* never wins; a prompted confirmation never counts as independent, **including a prompted tap on a spotter-filled value**; **two voices for *ginger* and two for *black* resolve to the camp with the newer support and land on the Colour check list**; *Ginger · Tabby* and *Ginger* agree on *Ginger*; *Black* plus *White* equals *Black and white*; **two single spotters filling a gap with different colours show the newest**; a later machine reading never beats a team or guardian statement; **one device counts once at read time even if two live rows exist**; **two concurrent writes from one device (a double tap) leave one voice**; **a device superseding someone else's row is refused**; **two devices uploading the same photo, or on the same day, count as one**; a deletion between two voices still leaves two; the team correcting after two spotters agree wins; a guardian's statement stands directly, and a team member's confirmation is a team statement.
- **Markings:** a mark held at one voice, shown at two; omissions never remove a mark; a device's later answer adds and never withdraws; *Can't tell* and "nothing special" withdraw nothing; only a team or guardian statement removes one; an empty team list clears the marks; **marking one of three spotters' marks wrong leaves the other two shown**; **two voices dated after the newest team statement show a mark and put the cat on the Colour check list**; each of the four marks (*short tail*, *missing eye*, *three legs*, *odd eyes*) is accepted from a spotter and follows the same two-voice and add-only rules as the other seven; a team list may hold more than four marks; `cantTell` changes nothing.
- **Retraction:** the retraction removes only the statement it points at, and is refused from a spotter.
- **Vaccinated:** refused from public and guardian; no negative state exists; **absent from every public payload; the word "rabies", "cat flu" and "enteritis" appear in no public payload or string**; not evidence of life; an "other" vaccine needs a typed name; **the donor count (§6.3) counts distinct cats vaccinated this calendar year, counts a twice-vaccinated cat once, ignores a cat with nothing recorded, shows nothing below 5, and the public response holds only the number and the year**.
- **Health notes:** a `team_note` is refused from public, never in a public payload, readable only with `view_health_notes`, and survives deletion of a welfare report; a welfare-report note never becomes a cat note.
- **Old care route:** nothing about health or vaccination is written to `cat_updates`.
- **Privacy:** no health note, welfare report, confidence or author in any public payload (the public-payload leak list the data spine already tests, §10.8), checked against the new fields by name.
- **Welfare separation:** a recorded team note never hides the "needs help" link on that cat's page; a welfare report writes no condition; **the "Does it look hurt?" link renders whenever *Torn or notched ear*, *Kinked tail*, *Short or missing tail*, *Missing an eye*, *Three legs* or *Eyes of different colours* is ticked**.
- **Cache:** a v2 cache written by today's build is read correctly by the new client, with no key change.
- **Languages:** every chip label and line exists in `en`, `el` and `fr`; nothing renders a raw code; no question uses a gendered pronoun.
- **Offline:** the colour filter works on a cached catalogue with no network; the appearance question never renders offline.
- **Browser check** at ~390 px and desktop widths in all three languages, before the PR opens.

### 10.7 Follow-ups for other tickets and specs (not edited here)

- **SYC-161** (auto coat colour): drop "People outrank the machine" in favour of the narrowed rule (SYC2-D10), drop the cache-version bump, and use the single `coat: []` wire shape.
- **SYC-5** (vaccination records): vaccination is team-only; the public Care timeline gets no vaccination row and no new `cat_update_type` enum value; donors see an overall count, computed automatically from the team's vaccination records (§6.3). Nothing about health is written through `POST /cats/:catId/updates` (§6.4, rule 6).
- **`choose-a-different-cat.md` §8.4:** edited on approval of SYC2-D10. **`roles-and-invites.md` §17.4** already asks this spec to cite the capability names and state that appearance is not queued and vets are reserved; both are done here.

---

## 11. Open decisions

Each has every realistic option, what it buys and what it costs, how it feels to people, and a recommendation. Five of them were changed or tightened by the adversarial review (SYC2-D1, D2, D5, D6, and the new D10); each says so. SYC2-D1, D6 and D10 are the weighty ones; the rest are small and could be taken as a batch.

### SYC2-D1. Do a spotter's suggestions change what the public sees?

**Decided (Samuel, 12 October 2026): option C, two people agreeing plus filling empty gaps, on its four conditions, as recommended.**

*Changed after review: the review agreed with option C only on conditions, because "two devices" can be one person with two browsers and the case the rule admits was never shown to the team. The conditions are now part of the recommendation.*

| Option | What it means | Benefits | Risks | Tourists | Guardians and the team |
|---|---|---|---|---|---|
| **A. Live at once** | Any person's tap overrides the machine's reading immediately | Simplest. A cat the model got wrong is fixed the moment someone says so | One careless or mischievous tap changes a colour everyone sees, and the filter can hide a cat from people looking for it, which is how duplicates are made | A wrong tap fixes things instantly, or breaks them instantly | Extra clean-up work |
| **B. Held until the team or a guardian confirms** | Spotter taps are only suggestions the team sees; the public sees the machine's reading until someone confirms | Nothing the public sees was unchecked. No griefing | Slow: with a few team members, most wrong colours stay wrong for a long time, and cats the model could not read stay "Colour not known" | Their taps seem to do nothing | Every correction is their job |
| **C. Two people agreeing, plus filling empty gaps (recommended, with conditions)** | The machine's reading stands until a person with authority corrects it, or two different spotters independently say the same thing. One person can fill a cat whose colour is *Not sure*, but not overturn a real reading | Needs two people to change a good reading, so one tap cannot do harm; still self-corrects in busy places; fills gaps fast | Two devices are cheap to make, so a determined pair could still move a colour (see the conditions). The cost is cosmetic and the team's or a guardian's word always wins. More rules to test | Mostly invisible; taps feel useful | Fewer corrections, and a clear list of the disagreements |

**Recommendation: C, on four conditions.** The harm from a wrong colour is small and fixable, and a rule of two keeps casual griefing out without making the crowd useless. The conditions make it hold up:

1. **At most one voice per device, checked when the answer is worked out**, not only when it is written, and a per-device lock on writing so a double tap or retry cannot count twice (§4.2, §10.2).
2. **Two voices must come from two different photos on two different days.** A real user loses nothing; the two-browsers trick now needs two visits.
3. **Any cat where spotters have overturned a machine reading, and any cat whose markings moved on spotter agreement, goes onto the team's Colour check list** (§5.3). The one case this option admits is possible is the case the team is now shown.
4. **The limit is accepted openly:** a person who deletes their data and comes back is a new voice, because a deleted person's statement still counts. The cost is cosmetic.

### SYC2-D2. Where do we ask people about appearance?

**Decided (Samuel, 12 October 2026): option A, one optional colour line on the new-cat result screen after the points, plus the "add details later" card, as recommended.**

*Changed after review: the naming screen comes before the points, so asking there put two questions between a spotter and their reward, which the data spine calls the fastest way to kill this project. The recommendation is now one optional line after the points, plus the details card.*

| Option | Benefits | Risks | What people notice |
|---|---|---|---|
| **A. One optional colour line on the new-cat result screen, after the points, plus the "add details later" card (recommended)** | Both are moments of curiosity and neither is between a person and their points. The line is one tap ("Yes") when the colour is already read. Nothing is a new screen | The cat is described by whoever found it, usually one person. Markings are asked only on the card. The result screen gains a fourth thing after the points, so it must stay a single quiet line | A small "right?" after the reward; skippable and never returns |
| **B. On the naming screen and the card (the original recommendation)** | Asks while the person is closest to the cat | The naming screen sits before the points. Two extra lines on the path, "optional" or not; a tourist who does not know *colourpoint* stalls before their reward | A question before the reward |
| **C. On the reward screen as full questions (colour and markings)** | More answers, sooner | The reward screen already carries the ear-tip, food and water and note questions. Two more turns a reward into a form | A longer reward screen |
| **D. Never ask the public; team only** | No questionnaire at all | The crowd never contributes; the record depends on a few people's time | Nothing |

**Recommendation: A.**

### SYC2-D3. Is the ear tip one of the markings?

**Decided (Samuel, 12 October 2026): option A, no: the ear tip stays its own question with its own rules, as recommended.**

| Option | Benefits | Risks |
|---|---|---|
| **A. No: it stays its own question, with its own rules (recommended)** | No second, rules-free route into the sterilised line. "Torn or notched ear" gives people an honest place for a fight scar | Two places to describe an ear, and a person must know which is which. The example photo carries that, and is a required asset for the markings chips (§3.3) |
| **B. Yes: add "ear-tipped" as a chip** | One place to describe a cat | A wrong chip becomes a claim that a cat is sterilised, without the notch-versus-clip guard. The failure is people trapping cats already done |
| **C. Show the sterilised line next to the markings, read-only** | The page reads as one description | It is what the cat page already does; this adds nothing and duplicates the line |

**Recommendation: A**, and the cat page keeps showing sterilisation in its own line.

### SYC2-D4. Does the model also read markings from the photo?

**Decided (Samuel, 12 October 2026): option A, not yet: people only, as recommended.**

| Option | Benefits | Risks |
|---|---|---|
| **A. Not yet: people only (recommended)** | Honest from day one. Markings are small, often hidden by pose, and the model has not been measured on them | Fewer cats have markings recorded, so the card line is often empty |
| **B. Read markings with colour, as a gap-filler** | Every cat gets some markings, free with the colour call | The model will miss subtle marks and invent others ("white paws" from a bright patch). A wrong mark is shown to everyone |
| **C. Read markings but only show them as a prefilled guess to a person** | Fills in quickly with a human check | Prompted taps are not independent evidence, and the data spine warns that people agree with whatever is on screen |

**Recommendation: A**, revisited when SYC-56's labelled set can measure it (SYC-243 holds the follow-up).

### SYC2-D5. How much health do we record at all?

**Decided (Samuel, 12 October 2026): option A, sterilised and vaccination as structured facts with everything else as a team-only note on the cat, on its two conditions, as recommended.**

*Changed after review: the original option A relied on "the existing team note", which turned out to be a note on a welfare report, not on a cat. It is now a team-only note on the cat itself, with its own read and write capabilities.*

| Option | Benefits | Risks | UX |
|---|---|---|---|
| **A. Sterilised and vaccination as structured facts; everything else as a team-only note on the cat (recommended)** | Nothing invented. Matches what the charity can state with authority. No new public surface. A cat being treated with no open welfare report still has somewhere for its condition to go, and the history lives as long as the cat does | Condition cannot be filtered or counted; "which cats are under treatment?" needs a human to read notes. Needs one new kind of observation in the data spine (§10) | None for the public. The team and cat guardians write plain notes |
| **B. Add a small fixed team-only condition list now** | Can be counted and listed | We would be guessing what Syros Cats track. Stale entries ("needs attention", set in July) read as current in October | None public. A new team form |
| **C. The old draft's full record** (condition, pregnancy, sex, age, with spotter statements) | Rich data for targeting | Spotters assert health from a photo; free-for-all condition claims on a public page sit beside the urgent route and could stand in for it. Large build, thin evidence | A health question in front of the points |

**Recommendation: A, on two conditions.** The note is a note on the cat (never on a welfare report) gated by `view_health_notes` and `add_health_note`; and **B is not needed now** (Answered, Samuel, 12 October 2026, Q2: free notes are enough). A structured condition list is left to SYC-242.

### SYC2-D6. Is vaccination shown to the public?

**Decided (Samuel, 12 October 2026): option A, team only at launch with an overall count for donors, as recommended.**

*Changed after review: from "public, positive and dated" to "team only for launch". A public line such as "Vaccinated against rabies" is a medical claim. Someone who has just been scratched would reasonably read it as "no need to see a doctor", on a record that may be years old or matched to the wrong cat.*

| Option | Benefits | Risks | UX |
|---|---|---|---|
| **A. Team only at launch, with an overall count for donors (recommended)** | No claim about any single animal. Donors still see what a vaccine round achieved ("142 cats vaccinated this year"). No new public health information. The team's record is complete | The cat's own page cannot show good news about a vaccinated cat. A donor cannot see "my €10 vaccinated this cat" | Nothing new on a cat's page; one number where the charity chooses to put it |
| **B. Public, positive and dated, without naming the vaccine** | A small good-news line on a cat's page | Still reads as reassurance to a stressed person, still rests on a record the charity cannot vouch for, still can sit on the wrong cat. Only acceptable with Syros Cats' and their vet's agreement on the wording, **no vaccine named**, and "If a cat bites or scratches you, see a doctor." beside it in all three languages | One quiet line plus a safety line |
| **C. Public, both ways ("Vaccinated" / "Not vaccinated")** | Consistent with `DECISIONS.md` D4's public negative on sterilisation | A second public negative on a cat, a pure label that serves no donor, spotter or guardian, and sharpens the targeting concern | A second line that reads as a label |

**Recommendation: A.** Revisit B only after Syros Cats and their vet have seen the wording.

### SYC2-D7. Which filters does the cat-alog get?

**Decided (Samuel, 12 October 2026): option A, colour only for now, as recommended. "Needs vet" is not built.**

| Option | Benefits | Risks |
|---|---|---|
| **A. Colour only, now (recommended)** | The one filter backed by data and harmless to publish | Fewer filters than the original design |
| **B. Colour and a sterilised filter** | Helps people find cats that still need help | When decided, would have leaked the "Probably sterilised" line before its gate opened (it opened with SYC-75) |
| **C. Colour plus "Needs vet" as in the design** | Matches the design | A public list of cats marked unwell. It is the health information §6 keeps private, and it invites the filter to stand in for the urgent route |

**Recommendation: A.** "Needs vet" is not built, and this is the one recommendation here that is a firm no rather than a preference.

### SYC2-D8. Does appearance help the matcher?

**Decided (Samuel, 12 October 2026): option A, no: the photo decides, as recommended.**

| Option | Benefits | Risks |
|---|---|---|
| **A. No: the photo decides; disagreements on hand picks are flagged to the team (recommended)** | Keeps the matcher independent of the colour reading. A wrong colour cannot steer it away from the right cat | Gives up a cheap hint |
| **B. Feed confirmed colour and markings into the prompt as hints** | Might help in a 30-cat colony | Circular if the colour came from the same model; a wrong confirmed mark biases against the right cat. Cannot be judged without SYC-56's measurements |
| **C. Hard pre-filter on colour** | Smaller candidate lists | `choose-a-different-cat.md` §4.7 already rejects it: a mislabelled cat vanishes, and the fix for a vanished cat is a duplicate |

**Recommendation: A.** Revisit B after SYC-56. The hand-pick flag compares against the spotter's own colour answer on that sighting when there is one, so it costs no new model call (§7.2).

### SYC2-D9. Can appearance suggestions queue offline?

**Decided (Samuel, 12 October 2026): option A, no: online only, as recommended.**

| Option | Benefits | Risks |
|---|---|---|
| **A. No: online only, like the details card (recommended)** | No stale suggestions, no race with a team correction | A tourist offline cannot add a colour until they have signal |
| **B. Queue them with the sighting** | Works in the field | A suggestion replayed weeks later can land after a team correction, needing the checked-by-team ordering the ear-tip answers needed (EAR_TIP_CHECKED). More machinery for a cosmetic fact |

**Recommendation: A.**

### SYC2-D10. Does one spotter ever overturn the machine's colour? (a change to an approved sentence)

**Decided (Samuel, 12 October 2026): option A, a spotter alone fills a gap but never overturns a real machine reading, as recommended. This narrows the approved sentence in `choose-a-different-cat.md` §8.4, as §15 records.**

*New, from the review: the first draft changed an approved rule without saying so.* `choose-a-different-cat.md` §8.4 (approved) says "a person's reading always beats the machine's". This spec's colour rule is different: a spotter alone fills a gap but never overturns a real machine reading. SYC-161's ticket repeats the older wording. If Samuel approves option A, `DECISIONS.md` gets an entry that names the change (§15) and SYC-161's wording is updated.

| Option | What it means | Benefits | Risks | What people notice |
|---|---|---|---|---|
| **A. A spotter alone fills a gap but never overturns a real machine reading; two spotters agreeing, a guardian or the team do (recommended)** | The approved sentence is narrowed. People still win, but "a person" means a person with authority or two independent spotters | One mischievous tap cannot change a good reading everyone sees. Still self-corrects in busy places | A careful single spotter who is right cannot fix a wrong colour on their own; they wait for a second voice or the team | A single tap on a cat the machine has read seems to do nothing publicly, yet the team sees it on the Colour check list when it disagrees |
| **B. Keep the approved sentence as it is: any person's reading beats the machine's** | Simplest, and already approved. A cat the machine got wrong is fixed at once | One careless or mischievous tap changes a colour everyone sees, and can hide a cat from people filtering by colour, which is how duplicates are made | Griefing is cheap; the clean-up lands on the team | A wrong tap changes things instantly, for everyone |
| **C. Narrow it further: only the team or a guardian ever overturns a machine reading** | Strongest protection against bad edits | The crowd's two-spotter agreement no longer helps; cats the model misread wait for a person with an account | Slow; recreates SYC2-D1 option B | Spotters' taps seem to do nothing |

**Recommendation: A.** It is SYC2-D1's recommendation (C there) written as the one sentence that changes an approved document, so the two cannot drift apart.

---

## 12. Questions for Syros Cats (all answered by Samuel, 12 October 2026)

1. **Do these words match how your team describes cats?** Please check every English, Greek and French label in §3 (especially *tortoiseshell or calico*, *colourpoint* and *kinked tail*), and tell us any marks you use that are missing or any here you would never use.
   **Answered (Samuel, 12 October 2026): checked in testing.** Syros Cats will say during testing if any word is wrong; Johnny still checks the Greek and French (SYC-283).
2. **What health information do you actually keep about a cat?**
   **Answered (Samuel, 12 October 2026): free notes are enough.** Health stays as the sterilised and vaccinated facts plus a team-only note on the cat. SYC2-D5's option B (a structured condition list) is not needed now; it is left to SYC-242.
3. **Which vaccines do you give?**
   **Answered (Samuel, 12 October 2026): rabies, and the core "cat flu and enteritis" combination** (the standard core feline vaccine). The team can add another by name. No brand is named. If the public line were ever reconsidered (SYC2-D6 option B), your vet would still have to see the exact wording first.
4. **Is a cat guardian's word on colour and markings final straight away,** with the team seeing it in their feed of recent guardian changes, rather than waiting for the team's OK?
   **Answered (Samuel, 12 October 2026): yes, it stands.** This is `roles-and-invites.md` Decision 13, already decided by Samuel.
5. **Are these words right?** Samuel has decided that anyone can tick *Short or missing tail*, *Missing an eye*, *Three legs* and *Eyes of different colours*, and that the public sees them as plain recognition features ("One eye", "Three legs"), never as injuries. Please check that the English, Greek and French wording is what your volunteers would say and would not read as medical history or as unkind. Also tell us if a tucked leg or a squint is often mistaken for one of these.
   **Answered (Samuel, 12 October 2026): checked in testing**, as question 1; Johnny checks Greek and French (SYC-283).
6. **Would a single overall number ("142 cats vaccinated this year") on the donate screen or in your reports help donors who fund vaccines,** and who should compute it?
   **Answered (Samuel, 12 October 2026): yes.** The app computes it automatically from the team's vaccination records, with no individual cat identifiable. It goes on the donate screen and in reports (§6.3); it must fit SYC-1 and SYC-62.

---

## 13. Not in this spec

- **Sex, age class and pregnancy or nursing.** Useful for targeting and for matching kittens to adults, but a spotter cannot reliably state them and they need their own expiry rules (a pregnancy ends). Their own spec, once Syros Cats say they matter.
- **A structured team-only condition list** (SYC2-D5, option B): not needed now; left to SYC-242.
- **A markings filter** in the picker or cat-alog (§7.2).
- **Markings read by the model** (SYC2-D4).
- **A sterilised / not-sterilised filter** (SYC2-D7).
- **A public vaccination line** (SYC2-D6, options B and C).
- **Reminders** for re-vaccination.
- **Eye colour as an impression**, breed, weight, temperament.
- **How roles, invitations and the confirmation queue work.** `roles-and-invites.md`'s. This spec only cites four of its capability names.
- **Points for appearance.** SYC-38's, if ever wanted.

---

## 14. Rollout, in slices that can ship alone

| Slice | Contains | Needs |
|---|---|---|
| **1. Record and resolver** | The `markings`, `vaccinated` and `team_note` kinds, the relaxed `coat` validator, the three resolver functions with their tests, the public payload fields (`coat`, `markings`), no cache-key change | The approved data-spine amendment (§10), and the colour rules, which handle a cat with no machine reading yet. **SYC-161 is no longer a prerequisite for the record and resolver**; spotters (slice 3 below) wait for SYC-161 (updated 12 October 2026, plan decision A1). Useful alone: team-entered colour and a richer resolved value |
| **2. Team** | The Appearance section, Confirm / Correct / Mark wrong (retract), the Colour check list, vaccination entry, health notes on the cat | Slice 1; the SYC-43 dashboard (merged) |
| **3. Spotters** | The colour line on the new-cat result screen, the chips on the details card, the three-language strings, the ear-tip side-by-side picture, the "Does it look hurt?" link, markings on picker cards, colour in the cat-alog filter | Slices 1 and 2 (so there is somebody to confirm), and `add-details-later.md`'s answers family |
| **4. Vaccination count** | The overall "N cats vaccinated this year" figure, computed automatically (§6.3), on the donate screen (SYC-1) and in reports (SYC-62) | Slice 1; SYC-5, SYC-1, SYC-62 |
| **5. Guardians** | `set_appearance`, `view_health_notes`, `add_health_note` for cats in their own colonies; the Colour check list scoped to a colony | The roles spec (SYC-53) |

Rollback for slices 1 to 4 is a revert: observations already written remain valid and are simply not read.

---

## 15. Proposed DECISIONS.md entries

For Samuel to approve (nobody has edited `DECISIONS.md`):

- **Health is three things, not one status.** On the cat page: what the record already shows (sterilised, ear tip, life status), and nothing about vaccination or condition. Vaccination is team-only at launch; donors see an overall count, computed automatically and never a cat. The vaccine list is rabies, the core cat flu and enteritis combination, and others by name (no brand). Condition is a team-only note on the cat. There is no "Looks healthy" badge, ever.
- **"Needs vet" is never a public filter or label.** The urgent route ("This cat needs help") is the only public way to say a cat is in trouble, and nothing replaces or delays it.
- **Spotters suggest appearance; the team and cat guardians state it.** This amends `choose-a-different-cat.md` §8.4: it said "a person's reading always beats the machine's"; it now says **a single spotter fills a gap but never overturns a machine reading; two independent spotters (different devices, photos and days), a cat guardian for her own cats, or the team do.** (SYC-161's wording is updated to match.)
- **Markings and colour are never evidence of life and never notifiable.**
- **The ear tip is not a marking.** It stays its own question with its own rules.
- **Vaccination is stated only by the team (`set_vaccination`) and is not public per cat.** If it is ever made public: the vaccine is never named, and "If a cat bites or scratches you, see a doctor." sits beside it in all three languages.
- **Health and vaccination are never written through the old shared-password care route** (`cat_updates`).
- **A team-only note on the cat** (`team_note`) is a new observation kind in the data spine, gated by `view_health_notes` and `add_health_note`. Welfare-report notes are unchanged.
- **The four capability names** (`set_appearance`, `set_vaccination`, `view_health_notes`, `add_health_note`) are the roles spec's. This spec adds none. Volunteers and staff are one role (the Syros Cats team), so there is no `confirm_appearance` and no volunteer rule.
- **The colour and marking words are the fixed lists in `coat-markings-and-health.md` §3.** No free text.
- **Part 3 ownership row (new):** *Coat and marking vocabulary, what "health" means and what is public* → `coat-markings-and-health.md`. *The observation kinds and the resolver rules for them* stay with `cat-record-data-spine.md`, which gains §10.1 and §10.2 of this spec on approval.

---

## 16. Code facts this spec relies on

Checked on 7 October 2026 against `main` at `c5ee36c` (PR #99 merged), and again against the review.

1. `cats.description` is the cat's location label, shown as such on the cat page, so appearance cannot go there (§2).
2. The `coat` validator requires `modelVersion` on every value, which would refuse a person's statement. Relaxed in §10.1.
3. `resolve.ts` has no coat, markings or vaccination rule. §4.2 and §10.2 specify them.
4. The deletion mechanism clears a statement's device, so "two different devices" needs the rule in §10.2.
5. The capability list in code has twelve names and none for appearance, vaccination or health notes. The roles spec's catalogue supplies them (§10.5).
6. `add_team_note` guards one route, a note on a welfare report. There is no note on a cat, so §10.1 adds `team_note`.
7. `capabilityFor()` in `teamCorrections.ts` returns nothing for any kind but life status, sterilised and ear tip. §10.3 extends it.
8. The picker and cat-alog draw on the cached public catalogue, so reading appearance works offline, the details card is hidden offline, and retired cache keys are deleted unread, which is why the key must not change (§10.4).
9. The public payload already carries `sterilised.confidence` and `clippedTipSightings`, so the new privacy test names the new fields (§10.4).
10. The legacy care route writes to the public timeline and sends push notifications; health never goes through it (§6.4).

---

## 17. Review outcome

An independent adversarial review (`docs/specs/reviews/coat-markings-and-health-review.md`, 7 October 2026) found three blockers, nine major findings and eleven minor ones, and agreed with the shape of the spec. Every finding was accepted and folded in. The roles spec (`roles-and-invites.md`) has since fixed the capability names, so the permission findings were resolved against it.

### Blockers

| # | Finding | How it was handled | Where |
|---|---|---|---|
| B1 | The naming screen comes before the points, so the colour question did too | Dropped from the naming screen. One optional colour line on the new-cat result screen, after the points; markings only on the details card. SYC2-D2 changed | §5.1, §10.3, SYC2-D2 |
| B2 | The "existing team note" is a note on a welfare report, not on a cat | A team-only `team_note` kind on the cat, proposed as a data-spine amendment, read with `view_health_notes` and written with `add_health_note`. Welfare-report notes unchanged. No migration. SYC2-D5 changed | §6.4, §10.1, SYC2-D5 |
| B3 | A public "Vaccinated against rabies" line is a medical claim | Vaccination is team-only at launch; donors see an overall count. If ever public: no vaccine named and "If a cat bites or scratches you, see a doctor." beside it; a test that "rabies" is in no public string. SYC2-D6 changed to team-only | §6.3, §10.4, SYC2-D6 |

### Major findings

| # | Finding | How it was handled | Where |
|---|---|---|---|
| M1 | The spec writes resolver rules it does not own and changes an approved sentence without saying so | Kinds and resolver moved into a "Proposed data-spine amendment"; the change to `choose-a-different-cat.md` §8.4 is its own decision (SYC2-D10) with options and a recommendation; a DECISIONS entry and an ownership row are proposed | §10, §15, SYC2-D10 |
| M2 | "Two different devices" can be gamed, and the team never sees it | One voice per device counted when the answer is worked out; the per-device lock under (device, cat); two voices need different photos on different days; spotter-versus-machine disagreements and moved markings go on the Colour check list; the deleted-and-returned limit is stated in SYC2-D1 | §4.2, §5.3, §10.2, §10.3, SYC2-D1 |
| M3 | Several rules cannot be tested | One sentence for each case: ties, per-colour agreement, black plus white, gap-fillers, additive markings, *Can't tell*, one question per sighting, no change after a team ruling, a device only supersedes its own row | §3.1, §4.2, §10.6 |
| M4 | "Mark wrong" has no safe value | A `{ retracted: true }` value for colour and markings, written under `set_appearance`; the roles spec lets guardians remove too, so it is not staff-only (see below) | §4.4, §10.1 |
| M5 | One team statement freezes the markings | Two voices dated after the newest team or guardian statement reopen the list and put the cat on the Colour check list; removals still need the team | §4.2, §5.3 |
| M6 | Several markings are injuries, and some cannot be read from a photo | The review made *Missing an eye*, *Three legs*, *Short or missing tail* and *Eyes of different colours* team-or-guardian only, and added the "Does it look hurt?" link for *Torn ear* and *Kinked tail*, with a test. **Partly reversed by Samuel (12 Oct 2026):** the four are open to anyone, as plain recognition features; the link is kept and now also shows for the four ("added so an injury still reaches help; Samuel can drop it"); §3.2 says what this accepts; §12 question 5 becomes "are these words right?" | §3.2, §5.1, §5.2, §12 |
| M7 | The cache-key bump can wipe the offline catalogue; two specs plan two bumps and two shapes | No key change; the old key stays; a missing field means "not known"; a v2-cache test; one wire shape `coat: []`; a safe fallback rule if a bump is ever needed | §8, §10.4, §10.7 |
| M8 | The role assignments conflict with the roles spec | The four names and holders are the roles spec's (§6.2), appearance statements are not queued (Decision 13), vets reserved. **Updated after Samuel's decisions (12 Oct 2026):** volunteers and staff are one role, so the volunteer column and `confirm_appearance` are gone. The "Later" column is gone | §4.3, §5.4 |
| M9 | The old shared-password care route can still publish health, with a push | Health and vaccination are never written through it; its `general` type is retired for team use with the route; the untranslated old-build note is recorded | §6.4 (rule 6), §10.7 |

### Minor findings

| # | How it was handled |
|---|---|
| m1 | Wrong references fixed (the data spine's `provenance` comment and the July draft §5.2 are named); the one-voice guard is written as this spec's own rule and moved to the data spine; decisions renumbered SYC2-D1 to D10 so they cannot collide with `DECISIONS.md` D4 |
| m2 | Spotter answers are capped at four marks; a team or guardian statement carries the whole list |
| m3 | No "her": questions use the cat's name or "this cat", in all three languages |
| m4 | `vaccinated` is kept out of evidence of life, with the honest reason ("not needed yet") and the one-line way to change it |
| m5 | The import exception is "`provenance: import` once `records-import.md` is built" |
| m6 | The details card is for an open sighting (the last 30 days) and shows the spotter's own sighting photo beside the chips |
| m7 | The hand-pick flag compares against the spotter's own colour answer, so no new model call is needed |
| m8 | The test list now has the cases that matter: prompted taps on a spotter-filled value, concurrent writes from one device, a device superseding another's row, two devices with the same photo, and a tie |
| m9 | The side-by-side picture of *Torn or notched ear* next to the ear-tip example is a required asset for the markings chips |
| m10 | Every "built today vs proposed" framing is gone: §2 is "what changed from the July draft", the "held now by / later" column is gone, "inert until SYC-53" findings are replaced by §16, and "each cat's colour is read automatically" (Slice 1's dependency on SYC-161 is explicit in §14) |
| m11 | The proposed DECISIONS entry names what it amends (`choose-a-different-cat.md` §8.4) and a Part 3 ownership row is added |

### Updated after Samuel's decisions (12 Oct 2026)

1. **The four marks are open to anyone.** *Short or missing tail*, *Missing an eye*, *Three legs* and *Eyes of different colours* can be ticked by spotters like any other mark. This **partly reverses M6**: the review's team-only change is gone; its "Does it look hurt?" link stays and now also shows for these four (added so an injury still reaches help). **Decided (Samuel, 12 October 2026): the "This cat needs help" link stays on all four markings, as recommended.**. §3.2 records what the choice accepts.
2. **Roles.** Volunteers and staff are one role (the Syros Cats team). Every volunteer rule and `confirm_appearance` are removed. A cat guardian's colour and markings statement stands directly. Sterilisation is not restated here: roles spec Decision 5 and the data spine amendment own it.
3. **The role word is "spotter"**, never "snapper" (the draft contained none).
4. **Questions for Syros Cats answered by Samuel (12 October 2026), §12.** Q1 and Q5 (wording): checked in testing, Johnny for Greek and French (SYC-283). Q2: free notes are enough; option B left to SYC-242. Q3: vaccines are rabies and the core cat flu and enteritis combination, others by name, no brand (§6.3, §10.1). Q4: a guardian's colour statement stands. Q6: yes, the donor count is computed automatically (§6.3, §10.6, slice 4).

### Decisions

SYC2-D1 and SYC2-D5 gained conditions; SYC2-D2 and SYC2-D6 changed their recommendation; SYC2-D10 is new. SYC2-D3, D4, D7, D8 and D9 were agreed as written. Each changed decision carries a "Changed after review" note and keeps every option.

### Where this spec follows the roles spec rather than the review

- The review said a retraction should be "staff only". The roles spec's `set_appearance` is "state, confirm, correct or remove", held by cat guardians for their own colonies, so a guardian may retract a statement on her own colonies. A spotter cannot.
- The review asked for a comment to SYC-53 about the four capabilities. The roles spec already added them, so none is needed. (`confirm_appearance` was later removed: volunteers and staff are one role.)

