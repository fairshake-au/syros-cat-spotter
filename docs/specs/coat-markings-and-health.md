# Coat, markings and health on the cat record

**Status:** **Draft for Samuel's review** (7 October 2026). Not yet adversarially reviewed. **Supersedes** `docs/superpowers/specs/2026-07-28-cat-health-record-design.md` (the 28 July "For review" draft, which was never approved). That file is left as it is; where it and this document disagree, this one wins once approved.
**Owner:** Samuel
**Covers:** SYC-2 (coat and markings tags, and health status on cats). Also settles the trust question SYC-2 was parked on: who is allowed to assert a fact about a cat's body, and what the public sees of it.
**Related:** [`cat-record-data-spine.md`](./cat-record-data-spine.md) §2, §3.4, §4, §10.1, §10.2 · [`choose-a-different-cat.md`](./choose-a-different-cat.md) §4.7, §8.4 · [`add-details-later.md`](./add-details-later.md) §8 · [`team-access-and-welfare-queue.md`](./team-access-and-welfare-queue.md) §4, §7 · [`DECISIONS.md`](./DECISIONS.md) Part 2g, 2i, 2k · tickets SYC-161 (auto coat colour), SYC-5 (vaccination records), SYC-52 (confidence engine), SYC-53 (roles), SYC-42 (welfare reports), SYC-75 (sterilisation status), SYC-43 (staff dashboard).

**What this document owns:** the coat-and-markings vocabulary; who may say what about a cat's appearance and how disagreements are settled; what "health" means in this app and what is shown publicly; the vaccination fact. It **does not** own the observation model, the resolver's overall shape, the welfare flow or roles. It uses the data spine's model, the welfare spec's report flow and SYC-53's roles, and says where it needs something from them.

---

## 1. The short version

A cat on the Syros Cats map is more than a photo and a name. People describe cats to each other by what they look like ("the black-and-white one with the kinked tail by the bakery"). This spec gives the app that same language, and a careful rule for who gets to say it.

**Appearance (coat and markings).** A short, fixed list of colours and markings, each with a picture and a name in English, Greek and French. A tourist can answer from a photo by tapping, never typing. A spotter's tap is a **suggestion**. The team (and, once they have accounts, cat guardians) **confirm or correct**. A cat's colour is already read automatically from its main photo (SYC-161); a person's word beats the machine's, and two spotters who agree beat it too.

**Health.** The app does **not** have a "health status" badge, and this spec argues it should never have one. What "health" means here is three separate things with three different audiences:

1. **Facts the cat page already shows**, with their own rules: sterilised, ear tip, and whether the cat is living on the street, homed, in care or gone.
2. **Vaccination**, a clinical fact that only a vet or the team can state, shown to the public only as a positive and dated line.
3. **Everything else about a cat's condition** (illness, injury, a long-term condition, pregnancy). This is sensitive, it changes, and it is **never shown publicly**. A spotter who is worried about a cat uses the existing "This cat needs help" route. Nothing in this spec replaces it, delays it or sits in front of it.

There is no "Looks healthy" badge. A tourist cannot see health from a photo, and a green label on a sick cat is worse than no label.

**How it helps.** The colour filter in "Find the cat" gets people (and their corrections) behind it. Markings show on the cat's card so a spotter can compare in the moment. The team gets a small list of cats whose colour nobody has checked. Matching itself is unchanged: the photo still decides.

---

## 2. Why the old draft was replaced

The 28 July draft was written before the cat record existed. Most of its ideas survived into the data spine. Four things in it are wrong or out of date, and are not carried forward:

| The old draft said | What is true now |
|---|---|
| Appearance "fills the `description` field that exists in the schema and is never written to". | `cats.description` is the cat's **location label** ("by the blue boat"), and the cat page shows it as such. Appearance does not go there. It is stored as observations. |
| A health attribute table with sex, age class, pregnancy, condition (healthy / needs attention / urgent) and a "Condition: anyone can say it" rule. | Public free-for-all condition statements conflict with the urgent welfare route and with privacy (§6). The condition row is dropped. Sex, age and pregnancy are not part of this spec (§13). |
| Roles: Admin, Staff, Volunteer, Partner vet, Cat guardian, built on Clerk. | Roles are SYC-53's to specify, in the team-access spec's model (§7 there: capabilities by name, roles as scopes). This spec only names the capabilities it needs (§4.3). |
| A single `Observation.kind` table covering all of this in one phase. | Coat already exists as a kind, written by the matching model. This spec adds one more appearance kind (markings) and one clinical kind (vaccinated), and nothing else. |

One correction to what the brief for this spec said: the note that "C11 in data-spine.md says `coat` was added" is a pointer to the data spine **plan** (`docs/superpowers/plans/data-spine.md`, conflict C11), not the spec. The spec itself never mentions `coat`; `DECISIONS.md` Part 2i and the plan are where it was added.

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

**Nothing changes before the points.** The spot flow and the reward screen are untouched; no appearance question appears between a spotter and their points (data spine §7).

Appearance is asked in the two places where describing the cat feels like part of the fun, and nowhere else:

1. **When naming a new cat.** The person is already looking at the cat and deciding what to call it. Below the name, one optional line, pre-filled where the matching model has already read the colour:

   > *Agatha looks* **Ginger · Tabby** *— right?*
   > `Yes` `Change` `Skip`

   *Change* opens the colour chips (pick one or two, or *Not sure*). A second optional line, *"Anything that makes her easy to spot?"*, opens the marking chips with pictures. Both can be skipped, and skipping both costs nothing.

2. **On the "add details later" card** (`add-details-later.md` §8 names this as the next kind of detail), for a cat the person has spotted before whose colour is unconfirmed or *Not sure*, or that has no markings recorded. The same two lines, one at a time, never more than one new question on the card per visit. It is hidden offline, like the rest of the card.

Taking a pre-filled "Yes" is recorded as a **prompted** confirmation (it agrees with the machine); picking something different is recorded as a **volunteered** statement. The difference matters for §4.2, and it is how the record tells a considered answer from a tap-through.

**No points for appearance.** The data spine's guard (one person, one attribute, one cat counts once) is satisfied by simply paying nothing here. If Samuel later wants a small reward, SYC-38 owns points and it is a one-line change; this spec does not create a way to farm points by tapping colours.

### 5.2 On the cat's page

The page shows what is known, quietly, next to the location label:

> **Ginger tabby** · White paws · Kinked tail

Nothing is shown for a cat whose colour is *Not sure* and has no markings. The page never says how sure the app is, and never shows "suggested by 1 person". Those belong to the team.

### 5.3 The team

On a cat's dashboard page, an **Appearance** section next to *Correct the record*:

- the current colour and markings, with every statement beneath (the machine's reading, each spotter's suggestion, any team statement), who made it and when;
- **Confirm** (one tap: *that's right*) and **Correct** (pick the right chips, with a short reason). Confirm writes a team statement with the same value; the history shows it linked to what it confirmed, as PR #99's *Looks right* does;
- **Mark wrong** on any single statement.

A small **"Colour check"** list in the top bar shows cats whose colour is the machine's alone, or *Not sure*, with the main photo, newest first, and the same Confirm / Correct buttons. It is low priority by design, a few minutes a week, and it is **not** the SYC-53 confirmation queue. When cat guardians have accounts, they see the same list for their own colonies.

### 5.4 Cat guardians (once SYC-53 gives them accounts)

A cat guardian sees the same Appearance section for cats in their own colonies, with `set_appearance` scoped to those colonies. They know their cats; their word is authoritative. Until then, a guardian who spots a wrong colour does what anyone does: "Report an issue".

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
| **B. Vaccination** | Rabies; the combination vaccine | Vet, staff. Never a spotter | Everyone, as a dated positive line, if D6 is approved; the team always |
| **C. Condition** | Illness, injury, a long-term condition, treatment under way, pregnancy | Team (and later vet, and guardian for their cats), as a **team-only note** | **The team and the people with `view_health_notes`. Never the public, never in any public payload** |

**Public rule, in one sentence: the public sees what helps them find, recognise or help a cat, and nothing about its medical history.**

### 6.3 Vaccination (kind B)

A vaccination is a clinical fact. A spotter cannot see it in a photo, so a spotter cannot state it, and there is no spotter question for it. This is the same logic as the old draft's "sterilised, vaccinated: not visible at all, so never machine-read and never crowd-stated" (§5.1 there), which is still right.

- It is an observation of a new kind, `vaccinated` (§10), stated by a vet or the team, with the date it happened as the observation's date and the vaccine named from a short list (rabies, the combination vaccine, other).
- The team and, later, vets enter it from the cat's dashboard page with `set_vaccination`. Syros Cats' existing records could populate it through the optional import (`records-import.md`) without any change here.
- **There is no *Likely* level and no negative.** The state is either *a vet or the team has recorded a vaccination* (with its date) or *nothing recorded*. *Nothing recorded* is **not** "not vaccinated"; it means we do not know.
- **It never claims protection.** The line says "Vaccinated against rabies, June 2026", never "up to date" or "protected". The team's own view shows how long ago, so a re-vaccination round can be planned.
- It feeds the **Care timeline** that SYC-5 asked for: the timeline's "Vaccinated" row is read from these observations, not from a new `cat_updates` type. (The care timeline's existing sterilisation row reads from `cat_updates`; SYC-5's build should make both read from the same observations. That coordination is SYC-5's.)

### 6.4 Conditions (kind C) and the urgent route

This is the part that must not go wrong.

**The urgent route is untouched and always first.** "This cat needs help" (`team-access-and-welfare-queue.md` §4) sits on every cat page, in the camera flow and on the map, and it points a worried person to a vet first (F1). The rules below keep it that way:

1. **There is no condition control for the public, anywhere.** No "is this cat healthy?" question, no health chips, no free-text health box in the spot flow. A spotter who is worried about a cat uses the report route, or the optional note on the details card, which the team sees and highlights (data spine §7.1).
2. **A recorded condition never replaces, hides or closes a welfare report**, and a welfare report never writes a condition. They are different records: the report is the queue's, the condition is the cat's. A team member can see both side by side.
3. **A recorded condition never changes what the cat page offers.** The "needs help" link is on every page of a cat whatever the team has noted about it, including a cat noted as "treatment under way". Someone seeing a *new* problem on a cat already under treatment must still be able to say so.
4. **Nothing on a public page implies the cat is well.** No "healthy", "fine" or "no known problems". A page that is silent about health says nothing, and says it equally for every cat.
5. **Team notes about condition are plain, team-only text** (the existing team note, `add_team_note`), with `view_health_notes` controlling who reads them as roles arrive. They are not a structured status and nothing is derived from them (D5).

Why not a structured, team-only condition list now: nobody has told us what Syros Cats track. The old draft invented the list; inventing it again repeats the mistake. A free-text team note costs nothing and loses nothing. Once Syros Cats say what they actually keep (§12, question 2), a small fixed list can be added the same way coat was, without changing anything here.

### 6.5 What is public, in full

| Fact | Public? | How |
|---|---|---|
| Colour | Yes | The resolved value only (one or two colours, or none) |
| Markings | Yes | The resolved list only |
| Sterilised | Yes | Existing four lines (D4 in `DECISIONS.md` shows a confirmed negative) |
| Ear tip | Yes | Existing; not repeated as a marking |
| Life status / not seen since | Yes | Existing lines |
| Vaccinated | Yes, **positive and dated only**, if D6 is approved | "Vaccinated against rabies, June 2026" |
| Not vaccinated / unknown | **No**, never shown | Absence is silent |
| Condition, treatment, pregnancy, notes | **Never** | Team only |
| Welfare reports and outcomes | **Never** | Team only (data spine §10.1) |
| Who stated what, when, how many people | **Never** | Team only |

Why vaccination gets a positive-only line while sterilised shows a confirmed negative (D4): the sterilisation status is the app's central purpose and Samuel decided honesty there outweighs the targeting risk. Vaccination has no such mission weight. A public "not vaccinated" would be a pure label on a cat that serves no donor, spotter or guardian, and would add to the same targeting signal D4 already worried about.

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

Each has every realistic option, what it buys and what it costs, how it feels to people, and a recommendation. D1, D5 and D6 are the weighty ones; the rest are small and could be taken as a batch.

### D1. Do a spotter's suggestions change what the public sees?

| Option | What it means | Benefits | Risks | Tourists | Guardians and the team |
|---|---|---|---|---|---|
| **A. Live at once** | Any person's tap overrides the machine's reading immediately | Simplest. A cat the model got wrong is fixed the moment someone says so | One careless or mischievous tap changes a colour everyone sees, and the filter can hide a cat from people looking for it, which is how duplicates are made | A wrong tap fixes things instantly, or breaks them instantly | Extra clean-up work |
| **B. Held until the team or a guardian confirms** | Spotter taps are only suggestions the team sees; the public sees the machine's reading until someone confirms | Nothing the public sees was unchecked. No griefing | Slow: with a few team members, most wrong colours stay wrong for a long time, and cats the model could not read stay "Colour not known" | Their taps seem to do nothing | Every correction is their job |
| **C. Two people agreeing, plus filling empty gaps (recommended)** | The machine's reading stands until a person with authority corrects it, or two different devices independently say the same thing. One person can fill a cat whose colour is *Not sure*, but not overturn a real reading | Needs two people to change a good reading, so one tap cannot do harm; still self-corrects in busy places; fills gaps fast | Two devices are cheap to make, so a determined pair could still move a colour. The cost is cosmetic and the team's correction always wins. More rules to test | Mostly invisible; taps feel useful | Fewer corrections, and a clear queue of the disagreements |

**Recommendation: C.** The harm from a wrong colour is small and fixable, and a rule of two keeps casual griefing out without making the crowd useless.

### D2. Where do we ask people about appearance?

| Option | Benefits | Risks |
|---|---|---|
| **A. When naming a new cat, and on the "add details later" card (recommended)** | Both are moments of curiosity and neither is between a person and their points. Nothing is a new screen | The cat gets described by whoever named it, which is usually one person. Many cats will have only the machine's colour |
| **B. Also on the reward screen after the points** | More answers, sooner | The reward screen already carries the ear-tip, food and water and note questions. A fourth and fifth turns a reward into a form, the very thing the data spine warns against |
| **C. Never ask the public; team only** | No questionnaire at all | The crowd never contributes; the record depends on a few people's time |

**Recommendation: A.**

### D3. Is the ear tip one of the markings?

| Option | Benefits | Risks |
|---|---|---|
| **A. No: it stays its own question, with its own rules (recommended)** | No second, rules-free route into the sterilised line. "Torn or notched ear" gives people an honest place for a fight scar | Two places to describe an ear, and a person must know which is which. The example photo carries that |
| **B. Yes: add "ear-tipped" as a chip** | One place to describe a cat | A wrong chip becomes a claim that a cat is sterilised, without the notch-versus-clip guard. The failure is volunteers trapping cats already done |
| **C. Show the sterilised line next to the markings, read-only** | The page reads as one description | It is what the cat page already does; this adds nothing and duplicates the line |

**Recommendation: A**, and the cat page keeps showing sterilisation in its own line.

### D4. Does the model also read markings from the photo?

| Option | Benefits | Risks |
|---|---|---|
| **A. Not yet: people only (recommended)** | Honest from day one. Markings are small, often hidden by pose, and the model has not been measured on them | Fewer cats have markings recorded, so the card line is often empty |
| **B. Read markings with colour, as a gap-filler** | Every cat gets some markings, free with the colour call | The model will miss subtle marks and invent others ("white paws" from a bright patch). A wrong mark is shown to everyone |
| **C. Read markings but only show them as a prefilled guess to a person** | Fills in quickly with a human check | Prompted taps are not independent evidence, and the data spine warns that people agree with whatever is on screen |

**Recommendation: A**, revisited when SYC-56's labelled set can measure it.

### D5. How much health do we record at all?

| Option | Benefits | Risks | UX |
|---|---|---|---|
| **A. Sterilised and vaccination as structured facts; everything else as team-only notes (recommended)** | Nothing invented. Matches what the charity can state with authority. No new public surface | Condition cannot be filtered or counted; "which cats are under treatment?" needs a human to read notes | None for the public. The team writes plain notes |
| **B. Add a small fixed team-only condition list now** | Can be counted and listed | We would be guessing what Syros Cats track. Stale entries ("needs attention", set in July) read as current in October | None public. A new team form |
| **C. The old draft's full record** (condition, pregnancy, sex, age, with spotter statements) | Rich data for targeting | Spotters assert health from a photo; free-for-all condition claims on a public page sit beside the urgent route and could stand in for it. Large build, thin evidence | A health question in front of the points |

**Recommendation: A**, with B waiting on Syros Cats' answer to §12 question 2.

### D6. Is vaccination shown to the public?

| Option | Benefits | Risks | UX |
|---|---|---|---|
| **A. Team only** | No new public health information | The care timeline cannot show it; donors who fund a vaccine cannot see the result | Nothing new |
| **B. Public, positive and dated only (recommended)** | A cat that has been vaccinated says so, which is a small, honest good-news line and answers SYC-5. Absence is silent | Someone could read silence as "not vaccinated". The line never claims protection, and the team's own view carries the age | One quiet line on the page |
| **C. Public, both ways ("Vaccinated" / "Not vaccinated")** | Consistent with D4's public negative on sterilisation | Adds a second public negative on a cat. It serves no purpose the sterilised line does not, and sharpens the targeting concern | A second line that reads as a label |

**Recommendation: B.**

### D7. Which filters does the cat-alog get?

| Option | Benefits | Risks |
|---|---|---|
| **A. Colour only, now (recommended)** | The one filter backed by data and harmless to publish | Fewer filters than the original design |
| **B. Colour and a sterilised filter** | Helps people find cats that still need help | Leaks the "Probably sterilised" line before its gate opens, and filters over a status the public does not fully see |
| **C. Colour plus "Needs vet" as in the design** | Matches the design | A public list of cats marked unwell. It is the health information §6 keeps private, and it invites the filter to stand in for the urgent route |

**Recommendation: A.** "Needs vet" is not built, and this is the one recommendation here that is a firm no rather than a preference.

### D8. Does appearance help the matcher?

| Option | Benefits | Risks |
|---|---|---|
| **A. No: the photo decides; disagreements on hand picks are flagged to the team (recommended)** | Keeps the matcher independent of the colour reading. A wrong colour cannot steer it away from the right cat | Gives up a cheap hint |
| **B. Feed confirmed colour and markings into the prompt as hints** | Might help in a 30-cat colony | Circular if the colour came from the same model; a wrong confirmed mark biases against the right cat. Cannot be judged without SYC-56's measurements |
| **C. Hard pre-filter on colour** | Smaller candidate lists | `choose-a-different-cat.md` §4.7 already rejects it: a mislabelled cat vanishes, and the fix for a vanished cat is a duplicate |

**Recommendation: A.** Revisit B after SYC-56.

### D9. Can appearance suggestions queue offline?

| Option | Benefits | Risks |
|---|---|---|
| **A. No: online only, like the details card (recommended)** | No stale suggestions, no race with a team correction | A tourist offline cannot add a colour until they have signal |
| **B. Queue them with the sighting** | Works in the field | A suggestion replayed weeks later can land after a team correction, needing the checked-by-team ordering the ear-tip answers needed (EAR_TIP_CHECKED). More machinery for a cosmetic fact |

**Recommendation: A.**

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
