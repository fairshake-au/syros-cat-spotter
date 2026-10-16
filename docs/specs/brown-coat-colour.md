# Brown, and how a striped coat is described

**Ticket:** SYC-398 (High). **Asked for by:** Samuel, 15 October 2026, while checking the colour trial. Of #29 Krispy he said "Brown and ginger tabby" and "no, the app needs brown too", and on 16 October, of Krispy and #13 Fofi side by side, "I think Fofi is a brown and ginger tabby, as is Krispy".
**Amends:** `coat-markings-and-health.md` §3.1 (the colour list), §4.2 (how a cat's colour is worked out), §5 (the chips and the cat page), §8 (the colour filter); `choose-a-different-cat.md` §4.7 (the colour filter); the SYC-161 plan's reader prompt (SYC-397) and its chips (PR 3).
**Status:** draft for review, then Samuel's approval. Nothing is built until it is approved.

---

## 1. In plain English

Most street cats on Syros are tabbies, and most tabbies are brown: warm brown or sandy fur with dark stripes. The app now has **Brown** as a colour, so a brown tabby is described the way people actually say it: **Brown · Tabby**, beside **Ginger · Tabby** and **Grey · Tabby**.

Some cats are a mix of brown and ginger with stripes, like Fofi and Krispy. A cat's description is **up to two colours, plus Tabby when the coat is striped**, so they are **Brown · Ginger · Tabby**. Tabby was always a pattern rather than a colour; this makes the rule match that.

What people notice:

- **On a cat's page and card:** "Brown · Tabby", or "Brown · Ginger · Tabby".
- **In "Find the cat":** a **Brown** chip. Tapping *Brown* also shows cats recorded only as *Tabby*, because most of those are brown tabbies, and a filter must never hide the cat someone is looking for.
- **For the team and cat guardians:** Brown is on the chips when they correct a colour.
- **The colour reader** (the AI that reads each cat's photo) knows Brown, and its colours are checked by Samuel before they go public, as before.

---

## 2. The colour list

Nine values. The codes are what the database stores; the words are drafts for Johnny's check (SYC-283).

| Code | English | Greek (draft) | French (draft) | Chip picture |
|---|---|---|---|---|
| `black` | Black | Μαύρο | Noir | plain swatch |
| `white` | White | Λευκό | Blanc | plain swatch |
| `ginger` | Ginger | Πορτοκαλί | Roux | plain swatch |
| `grey` | Grey | Γκρι | Gris | plain swatch |
| **`brown`** | **Brown** | **Καφέ** | **Brun** | plain swatch, warm mid-brown |
| `tabby` | Tabby | Τιγρέ | Tigré | stripes |
| `tortoiseshell_or_calico` | Tortoiseshell or calico | Χελωνόχρωμο ή τρίχρωμο | Écaille de tortue ou calico | patches |
| `black_and_white` | Black and white | Ασπρόμαυρο | Noir et blanc | split |
| `not_sure` | Not sure | Δεν είμαι σίγουρος/η | Pas sûr | question mark |

**Brown** means a brown coat: warm brown, sandy or golden-brown fur. On its own it is a solid brown cat, which is rare. With *Tabby* it is the classic brown tabby.

**How a coat is described.** Up to **two colours**, plus **Tabby** when the coat is striped, spotted or swirled:

- *Brown · Tabby*, *Ginger · Tabby*, *Grey · Tabby*: a tabby of one colour.
- *Brown · Ginger · Tabby*: a tabby in brown and ginger (Fofi, Krispy).
- *Tabby · White*: a tabby with white (Toula, Say Say), unchanged.
- *Tabby* alone still means "a tabby, colour not said". Spotters who only notice the stripes, and every reading made before Brown existed, stay valid.
- *Not sure* is never combined with anything, as before.
- *Black* plus *White* is still stored as *Black and white*.
- *Tortoiseshell or calico* is a coat of its own. It does not take *Tabby* (a striped calico is still *Tortoiseshell or calico*), and it takes no second colour.

So a stored colour list has **one to three entries**. Three entries are allowed only when one of them is *Tabby*.

---

## 3. How a cat's colour is worked out

The rules in `coat-markings-and-health.md` §4.2 are unchanged in who wins: the team or a cat guardian first, then two spotters who agree, then the machine's newest reading, then one spotter filling a gap. Two details change, because *Tabby* is now a pattern beside up to two colours:

- **Rule 2 (two spotters agree):** "at most two colours are shown" becomes **at most two colours, plus Tabby**. Tabby is shown when two voices hold it, like any colour. It never takes the place of a colour.
- **Voices for Brown and for plain Tabby don't clash.** "Tabby" from one spotter and "Brown · Tabby" from another agree on *Tabby*. They are not two camps.

Nothing else in the rules moves.

---

## 4. The colour filter in "Find the cat"

The filter keeps every protection it already has: *All* by default; more than one chip at a time; *Colour not known* cats always shown, in their own section; and the "N more cats in other colours" line above "Can't find it? Add it as a new cat".

New matching rules, all for the same reason (a hidden cat is how duplicates get made):

- **The Brown chip shows Brown cats and plain-Tabby cats.** A cat recorded only as *Tabby* has no colour said, and most tabbies here are brown, so it must not vanish when someone taps Brown. A *Ginger · Tabby* or *Grey · Tabby* cat does not show under Brown.
- **A Brown · Ginger cat shows under Brown and under Ginger**, as any two-colour cat does.
- **A colour the phone doesn't know counts as "not known", never as "doesn't match".** A phone that hasn't updated may receive *Brown* from the server. It already leaves unknown codes off the cat's page; in the filter, a cat whose only colours are unknown to that phone goes into *Colour not known*, so it is never hidden.

---

## 5. The colour reader

The reader's prompt gains Brown, and says the classic brown tabby is *Brown* and *Tabby*. It also says calico and tortoiseshell are patches of orange and black, never plain *Tabby*, and that a warm brown is not ginger. That is SYC-397's prompt fix. It becomes one change, prompt version **coat-v2**, so the cats are read once with the full list rather than twice.

The reader answers with up to two colours plus *Tabby*. Everything else stays as it is: Not sure when it isn't confident or sees more than one cat; a photo never sent twice under the same prompt version; every colour checked by Samuel on a contact sheet before it goes public.

**Readings made before Brown existed** (23 readings on 15 October: 19 colours, mostly *Tabby*, *Ginger · Tabby* and *Tabby · White*, and 4 Not sure) are decided in Decision 3.

---

## 6. Where it reaches

| Place | What changes |
|---|---|
| The colour list (`appearance.ts`) | `brown` added; the validator allows a third entry only when it is `tabby` |
| The resolver (`resolve.ts`) | Rule 2's "at most two" becomes "two colours, plus Tabby" (§3) |
| The public API (`openapi.yaml`, `coat`) | `brown` in the list; at most three items |
| The app's words (`i18n.ts`, `COAT_LABEL_KEYS`) | `coat_brown` in English, Greek and French |
| The chips (SYC-161 PR 3; SYC-2 PRs 3.1, 4.1–4.3) | A Brown chip with a plain swatch; the matching rules in §4 |
| The colour reader (SYC-397) | Prompt coat-v2, with Brown and the calico and ginger guidance |
| The team's Appearance section (SYC-2 PR 3.1) | Brown on the Correct chips |
| Johnny's pack (SYC-346, SYC-283) | One new word, *Brown*, in Greek and French |

**What works offline** is unchanged: the colour and the filter work over the saved cat-alog, and a cat whose colour was read after the copy was saved is *Colour not known*, so it is never hidden.

**No database change.** Colours are stored as a list of codes in an existing field.

---

## 7. Decisions for Samuel

### Decision 1: how is "brown and ginger tabby" recorded?

| Option | What it means | Benefits | Risks | What people notice |
|---|---|---|---|---|
| **1A. Up to two colours, plus Tabby (recommended)** | Fofi and Krispy are *Brown · Ginger · Tabby* | Says exactly what Samuel said. Matches the rule that Tabby is a pattern, not a colour. A spotter who taps either Brown or Ginger finds them | The "one or two colours" rule changes in the validator, the resolver's rule 2, the API's limit and the chips' "pick up to two". More to test | Three words on some cats' pages |
| 1B. Keep two; record them as *Brown · Tabby* | The ginger tinge isn't recorded | Smallest change: only Brown is added | A spotter who saw a ginger-ish cat and taps *Ginger* won't find Fofi or Krispy. The filter then hides the very cat they're looking for | Brown · Tabby |
| 1C. Any three colours | No special place for Tabby | Most flexible | Allows odd lists like *Black · White · Ginger*, which is really calico. More ways for spotters to disagree | Up to three words anywhere |

**Recommendation: 1A.** It records what Samuel actually sees, and it keeps the filter from hiding a cat someone is looking for. The extra work is in rules that already treat Tabby as a pattern.

### Decision 2: does the Brown chip also show plain-Tabby cats?

| Option | Benefits | Risks |
|---|---|---|
| **2A. Yes (recommended)** | Every cat recorded before Brown existed as plain *Tabby* (5 of the 19 cats with a colour on 15 October: #6, #9, #14, #15 and #20, from the live cat list) still appears when a spotter taps Brown. Same idea as *Black and white* showing under Black and under White | A grey tabby recorded only as *Tabby* also shows under Brown. That's one extra card to scroll past, which is harmless |
| 2B. No, Brown means Brown only | A tidier rule | Until those cats are re-read or corrected, tapping Brown hides most of the brown tabbies on the island |

**Recommendation: 2A.** A filter should err on showing too much, never too little.

### Decision 3: what happens to the colours read before Brown?

| Option | What it means | Benefits | Risks | Samuel's hands |
|---|---|---|---|---|
| **3A. One checked re-read with the new prompt (recommended)** | The rule becomes "a photo is never read twice **under the same prompt version**". When coat-v2 is published, a manual run reads every cat once more, and Samuel checks a contact sheet before any new colour is written | Brown reaches the existing tabbies. The calico cats and the Tabby · White misses are fixed the same way. About 28 AI calls, once | A second contact sheet to check. The rule change must keep "the public can never cause a second call": only a prompt-version change, which needs a PR and a publish, makes a cat readable again | About 5 minutes on the contact sheet |
| 3B. No re-read; the team corrects by hand | Existing readings stay; the team uses Correct (SYC-2 PR 3.1) | No new AI calls | The brown tabbies stay plain *Tabby* until someone corrects each one, and the calico misses wait on the team | Corrections, cat by cat |

**Recommendation: 3A.** With 28 cats, a checked re-read is cheaper than correcting them one by one, and it fixes the calico cats at the same time. Cats Samuel has already given a colour for (SYC-399) get that colour from the team, which always beats the machine.

### Decision 4: does Brown go into the launch?

| Option | Benefits | Risks |
|---|---|---|
| **4A. The word is in Johnny's pack by Thu 22 October; the code follows the colour chips (recommended)** | One word in three languages costs Johnny almost nothing, and the chips can include Brown whenever the code is ready. Never blocks the launch | The chips (SYC-161 PR 3, aimed at the 26 October publish) either wait a few days for Brown, or ship first and gain Brown later |
| 4B. After the launch | Nothing extra in the launch fortnight | The chips go out without Brown, and the most common cat on the island has no colour of its own in the filter's first weeks |

**Recommendation: 4A**, with the chips (PR 3) built with Brown from the start if this spec is approved before PR 3 begins.

---

## 8. Tests

- **The list:** `brown` accepted; three entries only when one is `tabby`; `tortoiseshell_or_calico` with `tabby` refused; `brown` + `not_sure` refused; Black + White still stored as Black and white.
- **The resolver:** two voices for *Brown · Ginger · Tabby* show all three; one spotter's *Tabby* and another's *Brown · Tabby* agree on Tabby and are not two camps; a team colour still beats every machine reading.
- **The filter:** Brown shows Brown cats and plain-Tabby cats, but not *Ginger · Tabby*; *Brown · Ginger · Tabby* shows under Brown, Ginger and Tabby; a cat whose only colour is unknown to the phone lands in *Colour not known* under every selection; the counts still add up.
- **The public payload:** a three-entry `coat` passes the API's schema; an older app shows the known entries and drops `brown` without error.
- **The reader:** coat-v2's colour list equals the nine codes; Brown + Ginger + Tabby is accepted; a re-read happens only under a new prompt version, never on a public action.
- **Words:** `coat_brown` in all three languages; no raw code is ever shown.

---

## 9. Not in this spec

- **Breed words** (such as "Bengal") and **eye colour** stay out, as before.
- **Cream**, **cinnamon** and the like are not separate colours: cream is *Ginger*, cinnamon is *Brown*.
- **Markings** (white paws, white chest) are unchanged. *Tabby · White* still describes a tabby with a lot of white; a white chest alone is a marking.
