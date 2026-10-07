# Coat, markings and health on the cat record

**Status:** **Revised after adversarial review, awaiting Samuel's approval** (7 October 2026). The independent review is `docs/specs/reviews/coat-markings-and-health-review.md`; §17 says how every finding was handled. **Supersedes** `docs/superpowers/specs/2026-07-28-cat-health-record-design.md` (the 28 July "For review" draft, which was never approved). That file is left as it is; where it and this document disagree, this one wins once approved.
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

**Appearance (coat and markings).** A short, fixed list of colours and markings, each with a picture and a name in English, Greek and French. A tourist can answer from a photo by tapping, never typing. A spotter's tap is a **suggestion**. The team (staff and management) and cat guardians (for cats in their own colonies) state a cat's colour and markings **directly**, and their word stands (roles spec, Decision 13). A volunteer can say "yes, that's right", which counts as **evidence only**: it never becomes the answer by itself. Each cat's colour is read automatically from its main photo (SYC-161). A person with authority beats the machine; two spotters who agree, on different days and from different photos, beat it too; one spotter alone never overturns it.

**Health.** The app does **not** have a "health status" badge, and this spec argues it should never have one. What "health" means here is three separate things with three different audiences:

1. **Facts the cat page already shows**, with their own rules: sterilised, ear tip, and whether the cat is living on the street, homed, in care or gone.
2. **Vaccination**, a clinical fact that only the team can state. At launch it is **team-only**: the public never sees it on a cat's page. Donors who fund vaccines see one overall number instead ("142 cats vaccinated this year"), which says nothing about any single cat (§6.3).
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
| Roles: Admin, Staff, Volunteer, Partner vet, Cat guardian, built on Clerk. | The roles are `roles-and-invites.md`'s: staff, management, cat guardian, volunteer, and a reserved vet. This spec names which of that spec's capabilities it uses (§4.3) and adds none. |
| A single `Observation.kind` table covering all of this in one phase. | Coat is a kind that already exists. This spec proposes two more (markings, vaccinated) and one team-only note kind on the cat (§10), and nothing else. |

---

## 3. The words

Everything a person can say about appearance comes from two fixed lists. A person picks from chips, with a small picture and the word. They never type. Each list entry has a stable code (what the database stores) and a label in each language.

### 3.1 Coat colour

These are exactly the eight values `choose-a-different-cat.md` §4.7 already fixed for the colour filter. They are **not a second list**. SYC-2 inherits them and adds nothing to them in this spec.

A cat has **one or two** colours. *Tabby* is a pattern rather than a colour, so a ginger tabby is *Ginger* and *Tabby*. *Not sure* is never combined with another colour.

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

Markings are the things people use to tell two cats of the same colour apart. They are **additions**: a cat can have none, or several (at most four are recorded). The list is short on purpose; every entry has to be something a stranger can see in a normal photo and agree on.

| Code | English | What the chip's picture shows | Greek (draft) | French (draft) |
|---|---|---|---|---|
| `white_paws` | White paws | Dark cat, white feet | Λευκά πόδια | Pattes blanches |
| `white_chest` | White chest or bib | White patch under the chin and chest | Λευκό στήθος | Plastron blanc |
| `white_face` | White patch on the face | A white blaze, nose or muzzle | Λευκή κηλίδα στο πρόσωπο | Tache blanche sur le visage |
| `colourpoint` | Dark face, ears and tail | Paler body, darker "points", like a Siamese | Σκούρο πρόσωπο, αυτιά και ουρά | Visage, oreilles et queue foncés |
| `long_fur` | Long fur | A fluffy or long-haired cat | Μακρύ τρίχωμα | Poil long |
| `kinked_tail` | Kinked tail | A tail with a visible bend or break | Στραβή ουρά | Queue coudée |
| `short_tail` | Short or missing tail | A stump or a very short tail | Κοντή ή χωρίς ουρά | Queue courte ou absente |
| `missing_eye` | Missing an eye | One eye gone or sealed over for good | Λείπει ένα μάτι | Un œil manquant |
| `odd_eyes` | Eyes of different colours | One blue, one green or gold | Μάτια διαφορετικού χρώματος | Yeux de couleurs différentes |
| `three_legs` | Three legs | A cat that has lost a leg | Τρία πόδια | Trois pattes |
| `torn_ear` | Torn or notched ear | A ragged or notched ear (a fight scar), **not** a clean straight clip | Σκισμένο αυτί | Oreille déchirée ou entaillée |

Two more answers exist for every list and mean different things:

- **"Nothing special"** is a real answer: *I looked, and there is nothing to note*. It is stored as an empty list.
- **"Can't tell"** (photo too dark, wrong angle) is stored as such, stops the app asking this person about this cat again, and has **no effect on the record**, exactly as the ear-tip question treats it.

**The Greek and French wording above is a first draft for a local check.** `choose-a-different-cat.md` §12 (C11) already flagged that tabby, tortoiseshell and calico have no agreed everyday word in Greek. The same applies to *colourpoint*. A Syros Cats volunteer or a Greek speaker has to confirm every label before launch (§12, question 1).

### 3.3 What is deliberately not on either list

- **The ear tip.** A clipped ear tip is its own question with its own rules (data spine §4), and it stays that way. Putting "ear-tipped" in a list of markings would give the public a second, rules-free way to say it. It is also the one marking where a wrong answer sends a volunteer to trap a cat that was already done. *Torn or notched ear* is on the list precisely so a tourist who sees a ragged ear has somewhere honest to put it, and its picture is shown beside the ear-tip example photo so the two are never confused. (Decision D3.)
- **Eye colour, breed, weight, temperament, age.** Eye colour shifts with light and phone cameras, and the others are guesses from a photo. If it would not change how someone finds or recognises the cat, it is not recorded.
- **Injury, illness, eye discharge, limping.** These are conditions, not markings. A cat that has *lost* an eye is a marking. A cat whose eye looks sore is a welfare report (§6.4).
- **Free text.** The app is trilingual; three words for one colour is three unsearchable strings.

---

## 4. Who can say what

### 4.1 The principle

**Spotters suggest. The team, and cat guardians for their own cats, confirm.** A suggestion is a real record: it is dated, attributed to a device, kept, and visible to the team. It simply does not decide what the public sees on its own, with the one exception in §4.2 where it would otherwise leave a gap.

This is the same shape as the ear-tip rule (data spine §4): the crowd supplies volume, a trusted person supplies certainty. The difference is that colour and markings are plainly visible and cosmetic when wrong, so the bar is lower and the rules are simpler.

### 4.2 How a cat's colour and markings are worked out

The resolver reads the cat's `coat` and `markings` observations (§10) and applies these rules in order. They are the rules `choose-a-different-cat.md` §8.4 asked the data spine to own, made precise.

**Colour**

1. **A trusted person's statement wins.** The newest non-superseded statement from the team (or, once SYC-53 gives them accounts, a cat guardian on a cat they look after) is the answer. This is the *Confirmed* level. A later machine reading is recorded but never overrides it.
2. **Otherwise, two spotters who agree.** If at least two **different devices** have each said the same colour (or pair of colours), that is the answer. This is *Likely*. Taps that merely confirmed a pre-filled guess count as **prompted**, not independent, and do not count towards the two (data spine §5.2).
3. **Otherwise, the machine's reading** (SYC-161), if it is not *Not sure*. This is *Reported*.
4. **Otherwise, one spotter's word fills a gap.** If the machine said *Not sure* or never read the cat, a single spotter's suggestion is shown until something better arrives. A single spotter **never replaces a real machine reading by themselves.**
5. **Otherwise, Not sure.**

A person saying *Not sure* or *Can't tell* is never a statement about colour and never beats anything.

**Markings** (no machine reading in this version, D4)

1. **A trusted person's statement is the whole list.** The team's newest statement is the cat's markings, including an empty list ("nothing special"). *Confirmed.*
2. **Otherwise each mark stands on its own:** a mark is shown once **two different devices** have each ticked it. *Likely.* A mark only one person ticked is held, and is visible to the team as a suggestion.
3. **Spotters can only add.** A spotter leaving a mark unticked is not evidence the cat lacks it (the cat may be photographed from the wrong side), so no number of omissions removes a mark. Only the team can remove one. This is the ear-tip rule applied to markings.

**Three guards that apply to both**

- **One voice per device.** One device's statement about one attribute of one cat counts once; a change from the same device supersedes its earlier one. The leaderboard can never become "who can tap *ginger* most".
- **Colour and markings are never evidence of life** (data spine §3.4) and never notifiable. A colour reading on an old photo says nothing about whether the cat is alive, and nobody gets a push because a cat's colour changed.
- **The public sees the answer only.** Not how many people said it, who, when, or whether a person or the model said it. The team sees all of that.

### 4.3 What the team and guardians can do, by name

SYC-53 specifies the roles. This spec needs four capabilities, named in the same style as the team-access spec's list (§7.3 there), and marks them as dependent on it:

| Capability | Lets someone | Held now by | Later |
|---|---|---|---|
| `set_appearance` | State, confirm, correct or remove a cat's colour and markings | Staff | Cat guardian, **on cats in their own colonies only**; volunteers can **confirm** but not correct |
| `set_vaccination` | Record a vaccination | Staff | Vet |
| `view_health_notes` | See team-only health notes on a cat | Staff | Vet; cat guardian for their own cats |
| `add_health_note` | Add a team-only health note | Staff (via the existing team note) | Vet; cat guardian for their own cats |

Until SYC-53 lands, staff hold all four, and "confirm" in this document means "staff confirm". **The names are the commitment; which role holds which is SYC-53's to decide.** Nothing in the app asks "is this person staff?" for any of these (the rule `capabilities.ts` already states).

**What is authoritative for what.** A vet has no special standing on appearance, and a guardian has none on a clinical fact. Authority is per attribute, as the data spine says:

| Fact | Authoritative | Everyone else |
|---|---|---|
| Colour, markings | Staff; cat guardian for their cats | Suggest |
| Sterilised | Staff, vet, import (unchanged, data spine §4.6) | Ear-tip evidence only |
| Vaccinated | Staff, vet | Nothing. They cannot see it, so they cannot say it |
| Life status | Unchanged (data spine §3.2) | Unchanged |

### 4.4 Correcting a wrong colour or mark

The team corrects from the cat's dashboard page, using the pattern PR #99 established for life status and sterilisation: every correction is a new signed statement with a required reason, nothing is overwritten, and "Mark wrong" on a standing statement writes a superseding one. A wrong colour reported by the public through "Report an issue" (SYC-44, *wrong information about this cat*) reaches the team the same way `choose-a-different-cat.md` §4.7 already describes. Spotters never edit colours or marks directly.

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

**Does it look hurt?** Whenever a spotter ticks *Torn or notched ear* or *Kinked tail*, the screen shows, right there, the same "This cat needs help" link the cat page carries, with the words "Does it look hurt? Tell Syros Cats." Those two marks can be fresh injuries, a tourist cannot tell the difference, and the appearance question must never be the only place a worried person's attention lands. A test checks that the link renders whenever either chip is ticked.

**No points for appearance.** The data spine's guard (one person, one attribute, one cat counts once) is satisfied by simply paying nothing here. If Samuel later wants a small reward, SYC-38 owns points and it is a one-line change; this spec does not create a way to farm points by tapping colours.

### 5.2 On the cat's page

The page shows what is known, quietly, next to the location label:

> **Ginger tabby** · White paws · Kinked tail

Nothing is shown for a cat whose colour is *Not sure* and has no markings. The page never says how sure the app is, and never shows "suggested by 1 person". Those belong to the team.

Four marks can only be stated by the team or a cat guardian, not by a spotter (§3.2): *Missing an eye*, *Three legs*, *Short or missing tail* and *Eyes of different colours*. When one is stated, the page shows it as a plain recognition feature ("One eye", "Three legs"), never as an injury or a condition. Whether the public should see those four at all is a question for Syros Cats (§12, question 5).

### 5.3 The team

On a cat's dashboard page, an **Appearance** section next to *Correct the record*:

- the current colour and markings, with every statement beneath (the machine's reading, each spotter's suggestion, each volunteer's confirmation, any guardian or team statement), who made it and when;
- **Confirm** (one tap: *that's right*) and **Correct** (pick the right chips, with a short reason). Confirm writes a team statement with the same value; the history shows it linked to what it confirmed, as PR #99's *Looks right* does;
- **Mark wrong** on any single statement. This **retracts** that one statement: it removes it from the count and asserts nothing in its place. It does not make the team member re-type a list or pick a colour. If a replacement is wanted, the team member then uses **Correct** (§4.4).

A small **"Colour check"** list in the top bar is the team's low-priority list of cats whose appearance deserves a second look, with the main photo, newest first, and the same Confirm / Correct buttons. A cat is on it when any of these is true:

- its colour is the machine's alone, or *Not sure*, and no team or guardian statement stands;
- its colour **came from spotters and disagrees with the machine's reading** (the case where two people have overturned a real reading);
- its colour is tied between two groups of spotters (§4.2);
- its markings **changed on spotter agreement in the last 30 days**, or moved after a team statement (§4.2, rule M5);
- on a **hand pick** (`choose-a-different-cat.md` §4.3), the cat chosen is recorded as one colour and the spotter's own colour answer for that sighting is another. That flag is team-only and the spotter sees nothing different.

It is low priority by design, a few minutes a week, and it is **not** the roles spec's "Needs an OK" confirmation queue. When cat guardians have accounts, they see the same list for their own colonies.

### 5.4 Cat guardians and volunteers (once the roles spec is live)

- **A cat guardian** sees the same Appearance section for cats in her own colonies, with `set_appearance` for those colonies only. What she states **stands directly**. It is not queued for an OK, because a wrong colour is cosmetic and easy to reverse (roles spec, Decision 13). The team sees it in their feed of recent guardian changes. She also reads and adds team-only health notes on cats in her colonies (`view_health_notes`, `add_health_note`, §6.4).
- **A volunteer** assigned to a colony has `confirm_appearance`: a "Yes, that's right" button on the cat's colour and markings. It is **evidence only**: it is recorded, shown to the team, and counted as one more voice (§4.2), but it never replaces a team or guardian statement and never becomes the answer on its own. The volunteer sees "thanks", nothing else. A volunteer cannot correct, and has no health notes.
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
| **A. On the cat page already** | Sterilised; ear tip; life status (street, homed, in care, no longer with us) | As the data spine says (§3.2, §4.6) | Everyone, in the existing lines |
| **B. Vaccination** | Rabies; the combination vaccine | The team (`set_vaccination`, staff and management). Never a spotter, guardian or volunteer. A vet column is added when vets exist | **The team only**, at launch. The public sees at most an overall count, never a cat (§6.3) |
| **C. Condition** | Illness, injury, a long-term condition, treatment under way, pregnancy | The team, and cat guardians for cats in their own colonies, as a **team-only note on the cat** (`add_health_note`) | **The team, and cat guardians for their own colonies** (`view_health_notes`). Never the public, never in any public payload |

**Public rule, in one sentence: the public sees what helps them find, recognise or help a cat, and nothing about its medical history.**

### 6.3 Vaccination (kind B): team-only at launch

A vaccination is a clinical fact. A spotter cannot see it in a photo, so a spotter cannot state it, and there is no spotter question for it. This is the same logic as the old draft's "sterilised, vaccinated: not visible at all, so never machine-read and never crowd-stated".

- It is an observation of a new kind, `vaccinated` (§10), stated by the team with the date it happened as the observation's date and the vaccine named from a short list (rabies, the combination vaccine, other). The vaccine names are fine in the team's own record; they are the part that must never reach a public screen (below).
- The team enters it from the cat's dashboard page with `set_vaccination`, which is island-only: staff and management hold it, a guardian does not (roles spec §6.2). Syros Cats' existing records could populate it through the optional import (`records-import.md`) without any change here.
- **There is no *Likely* level and no negative.** The state is either *the team has recorded a vaccination* (with its date) or *nothing recorded*. *Nothing recorded* is **not** "not vaccinated"; it means we do not know.
- **It is not on the public page, the public timeline or the public payload.** Why: a line like "Vaccinated against rabies" on a cat's page is a medical claim the charity cannot stand behind. A tourist who has just been scratched would reasonably read it as "I don't need to see a doctor", on the strength of a record that might be years old or matched to the wrong cat. It also sits badly beside the onboarding advice to keep your distance.
- **Donors see an overall count instead.** SYC-5's need ("€10 covers a rabies vaccine") is better met by one number the charity reports, such as "142 cats vaccinated this year". It is a count of cats, with no cat identifiable and no vaccine named. Where it appears (the app's donate screen, the charity's own reporting) is SYC-5's to decide; this spec only says it is an aggregate computed on the server and that no per-cat vaccination ever leaves it.
- **If it is ever made public** (SYC2-D6, option B), three things are required before it ships: Syros Cats and their vet have seen the exact wording; **the vaccine is never named** (no "rabies" anywhere); and beside it, in all three languages, a fixed line: **"If a cat bites or scratches you, see a doctor."** A test asserts that the word "rabies" appears in no public payload and no public string, in any language, whatever is decided.
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

The photo decides. Colour is never used to pre-filter the matcher's suggestions, and `choose-a-different-cat.md` §4.7 already says so. This spec keeps that rule and adds nothing to the matching call. Neither colour nor markings are fed into the model's prompt (D8), because the model would then be partly agreeing with a reading it produced itself, and a wrong colour would quietly steer it away from the right cat.

### 7.2 Finding a cat by hand

- **The colour filter in "Find the cat"** now sits on top of the resolved colour: the machine's reading, improved by people's corrections. More cats have a colour, and the wrong ones get fixed. All the filter's protections stay exactly as specified: *All* by default, more than one colour allowed, *Colour not known* cats always stay visible, and the "N more cats in other colours. Show all colours." line sits above "Can't find it? Add it as a new cat".
- **Markings show on each card** in the picker as one short line ("White paws · Kinked tail"). This lets a spotter compare in the moment, the way people actually say it: "the one with the missing eye". They are **not a filter**. A cat with no markings recorded is most cats, and a "Kinked tail" filter would hide cats that simply have not been described. If a marking filter is ever added it must keep the colour rule: cats with no marking recorded always stay in the list.
- **A hand pick that disagrees with a confirmed colour** is flagged to the team in the "Matched by hand" review ("the cat picked is recorded as black; the sighting's photo was read as ginger"). The spotter sees nothing different. This extends the review flags in `choose-a-different-cat.md` §4.3 and is team-only.

### 7.3 The cat-alog

The ticket noted that colour data makes the design's "Needs vet" and "Desexed" filters possible. They are not equally good ideas.

- **Colour** is added to the cat-alog's filters (the same chips, the same "Colour not known" rule).
- **"Needs vet"** is not built, now or later. It would be a public list of cats marked as unwell, which is exactly the health information §6 keeps private, and it would invite people to treat the filter as a substitute for the urgent route. (D7)
- **A sterilised / not-sterilised filter** is deferred. The public "Probably sterilised" line sits behind its own gate (decision Q2 in the data spine plan, the `LIKELY_STERILISED_PUBLIC_LIVE` switch, SYC-198), and a filter over a status that is not yet public would leak it. Revisit when that gate opens.

---

## 8. What works offline

Being precise, because offline support in this app is partial:

| Thing | Offline? |
|---|---|
| Seeing a cat's colour and markings on its page or card, for cats in the last catalogue the phone loaded | **Yes.** They ride in the cached public catalogue (§10.4). A stale cache can show an out-of-date colour; it corrects on the next fetch |
| The colour filter in "Find the cat" | **Yes, over the cached catalogue.** The picker is built from the cached cats, so filtering needs no signal. A cat that arrived after the last load will not appear, as for the rest of the picker |
| Saying a cat's colour or markings when naming a new cat | **No.** Naming a new cat happens after matching, which needs signal. A spot saved offline is matched and named when it syncs |
| Suggesting colour or markings on the "add details later" card | **No.** The card is hidden offline, as it is now. Appearance suggestions are not added to the offline queue (D9) |
| Team confirm / correct / vaccination | **No.** The dashboard is online only. A volunteer offline view is explicitly not built (team-access spec §7.3) |

So: appearance **reading** works with the cached catalogue; appearance **writing** needs a connection. Nothing here queues, so nothing here can go stale in the queue or race a team correction.

---

## 9. English, Greek and French

- Every label in §3 exists in all three languages, with the same code underneath, so a Greek spotter's *Τιγρέ* and a French spotter's *Tigré* are the same `tabby`, and one filter chip finds both.
- **The labels in §3 are drafts for a local check before launch** (§12, question 1). The strings go in the existing translation files (`lib/i18n.ts`), with a test that every key exists in `en`, `el` and `fr`, as `catStatusLines` already has.
- Chips carry **the word as well as a picture**, so they work for colour-blind people and in bright sun, as `choose-a-different-cat.md` §4.7 requires.
- Wording for the questions, the "nothing special" and "can't tell" answers, the vaccination line and the team-only Appearance section is written once in plain English and translated in the same change; nothing ships in one language only.
- Public copy never uses the words "healthy", "sick", "diseased" or "unvaccinated". The vaccination line is a statement of a fact that happened, in all three languages.

---

## 10. How it is built (for the builder)

Everything above is the product; this is the record underneath. **No database migration.** Observation kinds are code, not a database enum (data spine §10.1).

### 10.1 Observation kinds

`OBSERVATION_KINDS` gains `markings` and `vaccinated`. `coat` already exists. Values:

```ts
//   coat        { colours: CoatColour[] }                       // 1–2 from the eight; "not_sure" alone
//               { colours: CoatColour[], modelVersion: string }  // machine reading (system:vision)
//   markings    { marks: Mark[] }                               // 0–4 distinct from §3.2; [] = "nothing special"
//               { cantTell: true }                              // recorded, no effect
//   vaccinated  { vaccines: ("rabies" | "combination" | "other")[], clinic?: string }  // 1–3 distinct; date = observedAt
```

- **`modelVersion` is required only on a machine reading.** The `coat` validator in `observations.ts` currently requires it on every `coat` value, which would refuse a person's statement. It becomes: required when `provenance` is `machine`, absent otherwise.
- **`vaccinated` is refused from the `public` role** (and `system`, except the import). `markings` and `coat` accept `public` (suggestions), `staff` and `admin`, and — once SYC-53 makes those roles reachable — `guardian` with `authorityScope: guardian_of_this_cat`. `vet` has no standing on appearance and is refused for `coat` and `markings`.
- A prefilled "Yes" is `provenance: "prompted"`, with `suggestedValue` set to the machine's value and `suggestionSource` naming the reading. A different answer is `volunteered`. A team Confirm carries `agreesWith: <statement id>` and **no photo**, the PR #99 pattern, so it never counts as independent public evidence.
- A team statement on `markings` is the whole list; an empty list is meaningful.

### 10.2 The resolver

Three pure functions are added to `resolve.ts` and included in the cat snapshot: `resolveCoat`, `resolveMarkings`, `resolveVaccinated`. Same rules as §4.2 and §6.3, with these details:

- **Counting "different devices" survives deletion.** After "Delete my data" a statement's device is cleared (data spine §8, DECISIONS Part 2g). The resolver counts each non-superseded statement as one voice, and each redacted row as one voice of its own. "One voice per device" is enforced at write time (a device's new statement supersedes its previous one on that cat), while the device is still known, so a person's deletion cannot turn two voices into one or one into two.
- **Authoritative statements are compared by the date they describe** (`observedAt`), newest first, as the sterilised fold already does (data spine §4.6). A later machine reading never beats an earlier authoritative statement.
- **Confidence output** uses the existing ladder: authoritative `confirmed`; two voices `likely`; machine or a single gap-filling spotter `reported`. `reported` is the fourth rung the resolver already reserves; if SYC-52 has not made it reachable when this is built, this spec asks SYC-52 to make it so for these two attributes.
- **Never crosses attributes.** A confirmed colour says nothing about sterilisation, life status or vaccination, and a `vaccinated` observation does not feed sterilised (no clinical inference in either direction). `coat`, `markings` and `vaccinated` are **not** evidence of life (data spine §3.4; `vaccinated` is excluded deliberately, because a record imported from years ago must not make an old cat look recently seen).
- **Not notifiable.** None of the three kinds is a derived-status change (data spine §9.3).

### 10.3 Writing

- **Spotter suggestions** are written by extending the post-points answers family that `add-details-later.md` already builds (`POST /sightings/{id}/answers` and its open-sightings read). **A device may only suggest for a cat it has a resolved sighting of**, so a stranger cannot tag cats they have never met. The write is per-device rate limited and refused for a deceased or merged cat. During naming, the same call carries the discoverer's colour and markings with the new cat's first sighting.
- **Team writes** go through `lib/teamCorrections.ts`'s existing statement function, behind `set_appearance` / `set_vaccination` and the same Origin, session and capability order PR #99 established, with a required reason. JSON and form routes call the same function so they cannot write different rows.
- **The "Colour check" list** is `GET /api/team/colour-check`, built like the Probably sterilised list: a cat is listed while its resolved colour is `reported` or *Not sure* and no team statement stands.
- **No script on the dashboard pages** (DECISIONS Part 2k), so the chip pickers are plain checkboxes and radio buttons in a form.

### 10.4 The public payload and the cache

`GET /cats` and `GET /cats/{id}` gain `coat` (the resolved colours, or none), `markings` (the resolved list) and `vaccinated` (`{ vaccines, month: "YYYY-MM" }` or null). Nothing else about them: not confidence, not author, not counts, not model version, not the date a colour was read. A test asserts the payload contains none of those, as `choose-a-different-cat.md` §8.4 requires of the colour. The OpenAPI spec and generated client change accordingly, and the catalogue cache key moves to `cats-cache/public/v3` (data spine §6.5: a payload-shape change forces a re-fetch). Vaccination carries a month, not a day, for the same coarse-time reason as "last seen".

### 10.5 Capabilities

`set_appearance`, `set_vaccination`, `view_health_notes`, `add_health_note` are added to `CAPABILITIES`. Until SYC-53, `can()` grants them to staff only, exactly as for the existing twelve. `add_health_note` is today the existing `add_team_note`; the separate name exists so a vet or guardian can later be given one without the other.

### 10.6 Tests

- **Colour:** each of the five rules in §4.2 in isolation and in conflict; a person's *Not sure* never wins; a prompted confirmation never counts as independent; two prompted confirmations never beat the machine; a later machine reading never beats a team statement; a statement from the same device twice counts once; a deletion between two voices still leaves two; the team correcting after two spotters agree wins.
- **Markings:** a mark held at one voice, shown at two; omissions never remove a mark; only a team statement removes one; an empty team list clears the marks; `cantTell` changes nothing.
- **Vaccinated:** refused from public; no negative state exists; the public payload carries month only; not evidence of life (a backfill of years-old records does not move *not seen since*).
- **Privacy:** no health note, welfare report, confidence or author in any public payload (the public-payload leak list the data spine already tests, §10.8).
- **Welfare separation:** a recorded team note never hides the "needs help" link on that cat's page; a welfare report writes no condition.
- **Languages:** every chip label and line exists in `en`, `el` and `fr`; nothing renders a raw code.
- **Offline:** the colour filter works on a cached catalogue with no network; the appearance question never renders offline.
- **Browser check** at ~390 px and desktop widths in all three languages, before the PR opens.

---

## 11. Open decisions

Each has every realistic option, what it buys and what it costs, how it feels to people, and a recommendation. Five of them were changed or tightened by the adversarial review (SYC2-D1, D2, D5, D6, and the new D10); each says so. SYC2-D1, D6 and D10 are the weighty ones; the rest are small and could be taken as a batch.

### SYC2-D1. Do a spotter's suggestions change what the public sees?

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

*Changed after review: the naming screen comes before the points, so asking there put two questions between a spotter and their reward, which the data spine calls the fastest way to kill this project. The recommendation is now one optional line after the points, plus the details card.*

| Option | Benefits | Risks | What people notice |
|---|---|---|---|
| **A. One optional colour line on the new-cat result screen, after the points, plus the "add details later" card (recommended)** | Both are moments of curiosity and neither is between a person and their points. The line is one tap ("Yes") when the colour is already read. Nothing is a new screen | The cat is described by whoever found it, usually one person. Markings are asked only on the card. The result screen gains a fourth thing after the points, so it must stay a single quiet line | A small "right?" after the reward; skippable and never returns |
| **B. On the naming screen and the card (the original recommendation)** | Asks while the person is closest to the cat | The naming screen sits before the points. Two extra lines on the path, "optional" or not; a tourist who does not know *colourpoint* stalls before their reward | A question before the reward |
| **C. On the reward screen as full questions (colour and markings)** | More answers, sooner | The reward screen already carries the ear-tip, food and water and note questions. Two more turns a reward into a form | A longer reward screen |
| **D. Never ask the public; team only** | No questionnaire at all | The crowd never contributes; the record depends on a few people's time | Nothing |

**Recommendation: A.**

### SYC2-D3. Is the ear tip one of the markings?

| Option | Benefits | Risks |
|---|---|---|
| **A. No: it stays its own question, with its own rules (recommended)** | No second, rules-free route into the sterilised line. "Torn or notched ear" gives people an honest place for a fight scar | Two places to describe an ear, and a person must know which is which. The example photo carries that, and is a required asset for the markings chips (§3.3) |
| **B. Yes: add "ear-tipped" as a chip** | One place to describe a cat | A wrong chip becomes a claim that a cat is sterilised, without the notch-versus-clip guard. The failure is volunteers trapping cats already done |
| **C. Show the sterilised line next to the markings, read-only** | The page reads as one description | It is what the cat page already does; this adds nothing and duplicates the line |

**Recommendation: A**, and the cat page keeps showing sterilisation in its own line.

### SYC2-D4. Does the model also read markings from the photo?

| Option | Benefits | Risks |
|---|---|---|
| **A. Not yet: people only (recommended)** | Honest from day one. Markings are small, often hidden by pose, and the model has not been measured on them | Fewer cats have markings recorded, so the card line is often empty |
| **B. Read markings with colour, as a gap-filler** | Every cat gets some markings, free with the colour call | The model will miss subtle marks and invent others ("white paws" from a bright patch). A wrong mark is shown to everyone |
| **C. Read markings but only show them as a prefilled guess to a person** | Fills in quickly with a human check | Prompted taps are not independent evidence, and the data spine warns that people agree with whatever is on screen |

**Recommendation: A**, revisited when SYC-56's labelled set can measure it (SYC-243 holds the follow-up).

### SYC2-D5. How much health do we record at all?

*Changed after review: the original option A relied on "the existing team note", which turned out to be a note on a welfare report, not on a cat. It is now a team-only note on the cat itself, with its own read and write capabilities.*

| Option | Benefits | Risks | UX |
|---|---|---|---|
| **A. Sterilised and vaccination as structured facts; everything else as a team-only note on the cat (recommended)** | Nothing invented. Matches what the charity can state with authority. No new public surface. A cat being treated with no open welfare report still has somewhere for its condition to go, and the history lives as long as the cat does | Condition cannot be filtered or counted; "which cats are under treatment?" needs a human to read notes. Needs one new kind of observation in the data spine (§10) | None for the public. The team and cat guardians write plain notes |
| **B. Add a small fixed team-only condition list now** | Can be counted and listed | We would be guessing what Syros Cats track. Stale entries ("needs attention", set in July) read as current in October | None public. A new team form |
| **C. The old draft's full record** (condition, pregnancy, sex, age, with spotter statements) | Rich data for targeting | Spotters assert health from a photo; free-for-all condition claims on a public page sit beside the urgent route and could stand in for it. Large build, thin evidence | A health question in front of the points |

**Recommendation: A, on two conditions.** The note is a note on the cat (never on a welfare report) gated by `view_health_notes` and `add_health_note`; and B waits on Syros Cats' answer to §12 question 2.

### SYC2-D6. Is vaccination shown to the public?

*Changed after review: from "public, positive and dated" to "team only for launch". A public line such as "Vaccinated against rabies" is a medical claim. Someone who has just been scratched would reasonably read it as "no need to see a doctor", on a record that may be years old or matched to the wrong cat.*

| Option | Benefits | Risks | UX |
|---|---|---|---|
| **A. Team only at launch, with an overall count for donors (recommended)** | No claim about any single animal. Donors still see what a vaccine round achieved ("142 cats vaccinated this year"). No new public health information. The team's record is complete | The cat's own page cannot show good news about a vaccinated cat. A donor cannot see "my €10 vaccinated this cat" | Nothing new on a cat's page; one number where the charity chooses to put it |
| **B. Public, positive and dated, without naming the vaccine** | A small good-news line on a cat's page | Still reads as reassurance to a stressed person, still rests on a record the charity cannot vouch for, still can sit on the wrong cat. Only acceptable with Syros Cats' and their vet's agreement on the wording, **no vaccine named**, and "If a cat bites or scratches you, see a doctor." beside it in all three languages | One quiet line plus a safety line |
| **C. Public, both ways ("Vaccinated" / "Not vaccinated")** | Consistent with `DECISIONS.md` D4's public negative on sterilisation | A second public negative on a cat, a pure label that serves no donor, spotter or guardian, and sharpens the targeting concern | A second line that reads as a label |

**Recommendation: A.** Revisit B only after Syros Cats and their vet have seen the wording.

### SYC2-D7. Which filters does the cat-alog get?

| Option | Benefits | Risks |
|---|---|---|
| **A. Colour only, now (recommended)** | The one filter backed by data and harmless to publish | Fewer filters than the original design |
| **B. Colour and a sterilised filter** | Helps people find cats that still need help | Leaks the "Probably sterilised" line before its gate opens, and filters over a status the public does not fully see |
| **C. Colour plus "Needs vet" as in the design** | Matches the design | A public list of cats marked unwell. It is the health information §6 keeps private, and it invites the filter to stand in for the urgent route |

**Recommendation: A.** "Needs vet" is not built, and this is the one recommendation here that is a firm no rather than a preference.

### SYC2-D8. Does appearance help the matcher?

| Option | Benefits | Risks |
|---|---|---|
| **A. No: the photo decides; disagreements on hand picks are flagged to the team (recommended)** | Keeps the matcher independent of the colour reading. A wrong colour cannot steer it away from the right cat | Gives up a cheap hint |
| **B. Feed confirmed colour and markings into the prompt as hints** | Might help in a 30-cat colony | Circular if the colour came from the same model; a wrong confirmed mark biases against the right cat. Cannot be judged without SYC-56's measurements |
| **C. Hard pre-filter on colour** | Smaller candidate lists | `choose-a-different-cat.md` §4.7 already rejects it: a mislabelled cat vanishes, and the fix for a vanished cat is a duplicate |

**Recommendation: A.** Revisit B after SYC-56. The hand-pick flag compares against the spotter's own colour answer on that sighting when there is one, so it costs no new model call (§7.2).

### SYC2-D9. Can appearance suggestions queue offline?

| Option | Benefits | Risks |
|---|---|---|
| **A. No: online only, like the details card (recommended)** | No stale suggestions, no race with a team correction | A tourist offline cannot add a colour until they have signal |
| **B. Queue them with the sighting** | Works in the field | A suggestion replayed weeks later can land after a team correction, needing the checked-by-team ordering the ear-tip answers needed (EAR_TIP_CHECKED). More machinery for a cosmetic fact |

**Recommendation: A.**

### SYC2-D10. Does one spotter ever overturn the machine's colour? (a change to an approved sentence)

*New, from the review: the first draft changed an approved rule without saying so.* `choose-a-different-cat.md` §8.4 (approved) says "a person's reading always beats the machine's". This spec's colour rule is different: a spotter alone fills a gap but never overturns a real machine reading. SYC-161's ticket repeats the older wording. If Samuel approves option A, `DECISIONS.md` gets an entry that names the change (§15) and SYC-161's wording is updated.

| Option | What it means | Benefits | Risks | What people notice |
|---|---|---|---|---|
| **A. A spotter alone fills a gap but never overturns a real machine reading; two spotters agreeing, a guardian or the team do (recommended)** | The approved sentence is narrowed. People still win, but "a person" means a person with authority or two independent spotters | One mischievous tap cannot change a good reading everyone sees. Still self-corrects in busy places | A careful single spotter who is right cannot fix a wrong colour on their own; they wait for a second voice or the team | A single tap on a cat the machine has read seems to do nothing publicly, yet the team sees it on the Colour check list when it disagrees |
| **B. Keep the approved sentence as it is: any person's reading beats the machine's** | Simplest, and already approved. A cat the machine got wrong is fixed at once | One careless or mischievous tap changes a colour everyone sees, and can hide a cat from people filtering by colour, which is how duplicates are made | Griefing is cheap; the clean-up lands on the team | A wrong tap changes things instantly, for everyone |
| **C. Narrow it further: only the team or a guardian ever overturns a machine reading** | Strongest protection against bad edits | The crowd's two-spotter agreement no longer helps; cats the model misread wait for a person with an account | Slow; recreates SYC2-D1 option B | Spotters' taps seem to do nothing |

**Recommendation: A.** It is SYC2-D1's recommendation (C there) written as the one sentence that changes an approved document, so the two cannot drift apart.

---

## 12. Questions only Syros Cats can answer

1. **Do these words match how your volunteers describe cats?** Please check every English, Greek and French label in §3 (especially *tortoiseshell or calico*, *colourpoint* and *kinked tail*), and tell us any marks you use that are missing or any here you would never use.
2. **What health information do you actually keep about a cat?** If there is a spreadsheet or a WhatsApp convention, its headings beat our guesses (it decides D5's option B).
3. **Which vaccines do you give, and should the public see the date?** (It decides the vaccine list and D6.)
4. **Should cat guardians be able to correct a cat's colour and markings in their own colonies,** or should that stay with the team?

---

## 13. Not in this spec

- **Sex, age class and pregnancy or nursing.** Useful for targeting and for matching kittens to adults, but a spotter cannot reliably state them and they need their own expiry rules (a pregnancy ends). Their own spec, once Syros Cats say they matter.
- **A structured team-only condition list** (D5, option B).
- **A markings filter** in the picker or cat-alog (§7.2).
- **Markings read by the model** (D4).
- **A sterilised / not-sterilised filter** (D7).
- **Reminders** for re-vaccination.
- **Eye colour**, breed, weight, temperament.
- **How roles, invitations and the confirmation queue work.** SYC-53's. This spec only names four capabilities.
- **Points for appearance.** SYC-38's, if ever wanted.

---

## 14. Rollout, in slices that can ship alone

| Slice | Contains | Needs |
|---|---|---|
| **1. Record and resolver** | The `markings` and `vaccinated` kinds, the relaxed `coat` validator, the three resolver functions with their tests, the public payload fields and the cache key bump | SYC-161 for the machine's colour; otherwise nothing. Useful alone: team-entered colour and a richer resolved value |
| **2. Team** | The Appearance section, Confirm / Correct / Mark wrong, the Colour check list, vaccination entry | Slice 1; the SYC-43 dashboard (merged) |
| **3. Spotters** | Chips on the naming screen and the details card, the three-language strings, markings on picker cards, colour in the cat-alog filter | Slices 1 and 2 (so there is somebody to confirm), and `add-details-later.md`'s answers family |
| **4. Vaccination on the page** | The public line, the care timeline row | Slice 1; SYC-5 |
| **5. Guardians** | `set_appearance` for cats in their own colonies; the Colour check list scoped to a colony | SYC-53 |

Rollback for slices 1 to 4 is a revert: observations already written remain valid and are simply not read.

---

## 15. Proposed DECISIONS.md entries

For Samuel to approve (nobody has edited `DECISIONS.md`):

- **Health is three things, not one status.** On the cat page: what the record already shows (sterilised, ear tip, life status), a dated positive vaccination line, and nothing about condition. Condition is team-only. There is no "Looks healthy" badge, ever.
- **"Needs vet" is never a public filter or label.** The urgent route ("This cat needs help") is the only public way to say a cat is in trouble, and nothing replaces or delays it.
- **Spotters suggest appearance; the team and cat guardians confirm.** A person with authority beats the machine; two different devices agreeing also beat it; one device never overturns a real machine reading.
- **Markings and colour are never evidence of life and never notifiable.**
- **The ear tip is not a marking.** It stays its own question with its own rules.
- **Vaccination is stated only by a vet or the team and is shown publicly, if at all, as a dated positive, never a negative.**
- **Four capability names** (`set_appearance`, `set_vaccination`, `view_health_notes`, `add_health_note`) join the capability list, held by staff until SYC-53.
- **The colour and marking words are the fixed lists in `coat-markings-and-health.md` §3.** No free text.

---

## 16. Checked against the code

Done on 7 October 2026 against `main` at `c5ee36c` (PR #99 merged). Findings that shaped the spec:

1. `cats.description` is the cat's location label, shown as such on the cat page, so the old draft's "fills the description field" is wrong (§2).
2. The `coat` validator requires `modelVersion` on every value, which refuses a person's statement. Fixed in §10.1.
3. `writeObservation` refuses `guardian`, `volunteer` and `vet` as roles. Everything here that names them is inert until SYC-53 makes them reachable, and says so.
4. `resolve.ts` has no coat, markings or vaccination rule. The colour rule `choose-a-different-cat.md` §8.4 deferred to the data spine is written here (§4.2).
5. The deletion mechanism clears a statement's device, which would break "two different devices". Handled in §10.2.
6. The capability list has twelve names and none for appearance, vaccination or health notes (§10.5).
7. The picker and cat-alog draw on the cached public catalogue, so reading appearance works offline and the details card is already hidden offline (§8).
8. The care timeline's sterilisation row reads from `cat_updates`, a parallel record to observations. SYC-5 should read vaccination from observations (§6.3).
9. `choose-a-different-cat.md` already says the public payload carries only the resolved colour and the cat-alog's filters today are All, Near me and Has a home (§7.3).
10. The brief's reference to "C11 in data-spine.md" is the data spine plan's conflict C11, not the spec.

