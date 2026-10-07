# Coat, markings and health on the cat record

**Status:** **Draft for Samuel's review** (7 October 2026). Not yet adversarially reviewed. **Supersedes** `docs/superpowers/specs/2026-07-28-cat-health-record-design.md` (the 28 July "For review" draft, which was never approved). That file is left as it is; where it and this document disagree, this one wins once approved.
**Owner:** Samuel
**Covers:** SYC-2 (coat and markings tags, and health status on cats). Also settles the trust question SYC-2 was parked on: who is allowed to assert a fact about a cat's body, and what the public sees of it.
**Related:** [`cat-record-data-spine.md`](./cat-record-data-spine.md) §2, §3.4, §4, §10.1, §10.2 · [`choose-a-different-cat.md`](./choose-a-different-cat.md) §4.7, §8.4 · [`add-details-later.md`](./add-details-later.md) §8 · [`team-access-and-welfare-queue.md`](./team-access-and-welfare-queue.md) §5, §7 · [`DECISIONS.md`](./DECISIONS.md) Part 2g, 2i, 2k · tickets SYC-161 (auto coat colour), SYC-5 (vaccination records), SYC-52 (confidence engine), SYC-53 (roles), SYC-42 (welfare reports), SYC-75 (sterilisation status), SYC-43 (staff dashboard).

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
