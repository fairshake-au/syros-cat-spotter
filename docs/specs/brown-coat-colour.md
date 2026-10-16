# Brown, and how a striped coat is described

**Ticket:** SYC-398 (High).
**Asked for by Samuel**, while checking the SYC-161 colour trial in this build session:
- 15 October 2026, of #29 Krispy: "Brown and ginger tabby", and, offered *Ginger · Tabby* instead, "no, the app needs brown too";
- 16 October 2026, about 01:30 UTC, of Krispy and #13 Fofi side by side: "I think Fofi is a brown and ginger tabby, as is Krispy".

**Amends:**
- `coat-markings-and-health.md`: §3.1 (the list), §4.2 rule 2 (at most two), §5.1 (the spotter's colour line), §5.2 (the cat page), §8 (the filter), §10.4 (the wire) and §11 (tests);
- `choose-a-different-cat.md`: §4.7 ("never more than two") and §9 (the payload);
- `cat-record-data-spine.md`: §10.2 (its copy of colour rule 2);
- the SYC-2 plan (the colour chips, "pick one or two");
- the SYC-161 plan: rules R2 and R4, the reader, and PR 3's chips;
- `DECISIONS.md` Part 2n: a new entry on approval.

**Status:** draft, revised after an independent adversarial review (findings at the end). Waiting for Samuel's approval. Nothing is built before it.

---

## 1. In plain English

Most street cats on Syros are tabbies, and most tabbies are brown: warm brown or sandy fur with dark stripes. The app has **Brown** as a colour, so a brown tabby is described the way people say it: **Brown · Tabby**, beside **Ginger · Tabby** and **Grey · Tabby**.

Some cats mix brown and ginger with stripes, like Fofi and Krispy. A coat is described as **up to two colours, plus Tabby when the coat is striped**, so they are **Brown · Ginger · Tabby**. Tabby has always been a pattern rather than a colour; this makes the rule say so.

What people notice:

- **On a cat's page and card:** "Brown · Tabby", or "Brown · Ginger · Tabby". Tabby is always said last.
- **In "Find the cat":** a **Brown** chip. A cat recorded only as *Tabby* (stripes, colour not said) shows under every colour chip, so the filter never hides it.
- **For the team and cat guardians:** Brown is on the chips when they correct a colour, and Tabby is a separate tick beside up to two colours.
- **The colour reader** (the AI that reads each cat's photo) knows Brown. A one-off, checked re-read brings Brown to the cats read before it existed (Decision 3).

---

## 2. The colour list

Nine values. The codes are what the database stores. The order of the table is the order colours are said in, with Tabby always last. The Greek and French words are drafts for Johnny's check (SYC-283).

| Code | English | Greek (draft) | French (draft) | Chip picture |
|---|---|---|---|---|
| `black` | Black | Μαύρο | Noir | plain swatch |
| `white` | White | Λευκό | Blanc | plain swatch |
| **`brown`** | **Brown** | **Καφέ** | **Brun** | plain swatch, warm mid-brown |
| `ginger` | Ginger | Πορτοκαλί | Roux | plain swatch |
| `grey` | Grey | Γκρι | Gris | plain swatch |
| `black_and_white` | Black and white | Ασπρόμαυρο | Noir et blanc | split |
| `tortoiseshell_or_calico` | Tortoiseshell or calico | Χελωνόχρωμο ή τρίχρωμο | Écaille de tortue ou calico | patches |
| `tabby` | Tabby | Τιγρέ | Tigré | stripes |
| `not_sure` | Not sure | Δεν είμαι σίγουρος/η | Pas sûr | question mark |

**Brown** means a brown coat: warm brown, sandy or golden-brown fur, including what breeders call cinnamon. **Ginger** stays orange or cream. On its own Brown is a solid brown cat, which is rare; with Tabby it is the classic brown tabby.

**How a coat is described:** up to **two colours**, plus **Tabby** when the coat is striped, spotted or swirled.

- *Brown · Tabby*, *Ginger · Tabby*, *Grey · Tabby*: a tabby of one colour.
- *Brown · Ginger · Tabby*: a tabby in brown and ginger, like Fofi and Krispy.
- *White · Tabby*: a tabby with a lot of white, like Toula and Say Say. A white chest or paws alone is a marking.
- *Tabby* alone means "a tabby, colour not said". Spotters who only notice the stripes can say just that.
- *Not sure* is never combined with anything.
- *Black* plus *White* is stored as *Black and white*, with or without Tabby, so Black · White · Tabby is stored as *Black and white · Tabby*.

So a stored colour list has **one to three entries**, and three only when one of them is *Tabby*. Colours are compared as sets, never by the order they were tapped.

---

## 3. How a cat's colour is worked out

**Who wins is unchanged** (`coat-markings-and-health.md` §4.2): first the team or a cat guardian, then two spotters who agree, then the machine's newest reading, then one spotter filling a gap.

One detail changes. In **rule 2 (two spotters agree)**, "at most two colours are shown" becomes **at most two colours, plus Tabby**:
- Tabby is set aside first.
- The colours are ranked as they are now (most voices, then the newer support), and the top two are shown.
- Tabby is added when two voices hold it. It never takes a colour's place.

So two spotters who both say *Brown · Ginger · Tabby* show all three.

Unchanged:
- *Tabby* from one spotter and *Brown · Tabby* from another agree on Tabby and are not two camps.
- Two separate camps that share only Tabby are still two camps, and the newer one is shown.

---

## 4. The colour filter in "Find the cat"

Every protection stays:
- *All* is selected by default;
- more than one chip can be picked;
- *Colour not known* cats are always shown, in their own section;
- the "N more cats in other colours" line sits above "Can't find it? Add it as a new cat".

Which cats match each chip:

- **A cat matches a colour chip if it has that colour.** *Brown · Ginger · Tabby* shows under Brown, under Ginger and under Tabby.
- **A cat recorded only as *Tabby* matches every colour chip** (Decision 2). Its colour was never said, so no colour may hide it.
- **The Tabby chip** matches every cat with Tabby. A solid *Brown* cat doesn't show under Tabby.
- **Black and white** shows under Black and under White, as already decided.
- **A colour the phone doesn't know is treated as not said.** A phone that hasn't updated may receive *Brown*:
  - a cat that is only *Brown* goes to *Colour not known*, so it is never hidden;
  - a *Brown · Tabby* cat counts as plain *Tabby*, so it shows under every colour chip;
  - a *Brown · Ginger · Tabby* cat counts as *Ginger · Tabby*. That's fine, because a phone that doesn't know Brown has no Brown chip to tap.
  The phone already leaves unknown codes off the cat's page.
- **The counts add up.** Of the cats the search finds, every cat is in exactly one of: matching, *Colour not known*, or the hidden count.

---

## 5. The colour reader, and re-reading under a new prompt

**The prompt.** The reader's prompt becomes version **coat-v2**, one change with SYC-397's fixes, and adds three things:
- Brown;
- the classic brown tabby as *Brown* and *Tabby*;
- calico and tortoiseshell as patches of orange and black, never plain *Tabby*, and a warm brown that isn't ginger.

The reader accepts up to two colours plus *Tabby*. Anything else that cannot be stored becomes *Not sure*, as now.

**Re-reading under a new prompt** (Decision 3). The SYC-161 rules say a photo is never sent to the AI twice (R4). Under 3A that becomes **never twice under the same reader version**. The version is the whole `modelVersion` (for example `gpt-5.6-terra/coat-v2`), so changing the model counts as a new version too. Every rule that follows protects what R4 protected:

- **Only a manual run re-reads.** The run started from the GitHub workflow has a re-read setting, off by default. The automatic catch-up run (SYC-161 PR 2), and a new cat being named, never re-read a photo because of a version change. They treat any earlier reading as final, exactly as now.
- **The public can't cause it.** A version changes only through a PR, Samuel's pull in Replit and a publish. Then only a manual run re-reads. So the most model calls any one photo can ever cost is one per reader version. Public actions are unchanged: naming a cat and a public report that leads to a hide can each still lead to one first reading of a photo, as SYC-161 already allows.
- **A photo the team rejected stays rejected.** If any reading of a photo was marked wrong, the re-read skips that cat's photo.
- **A re-read never takes away a colour that's showing.** A re-read whose answer is *Not sure*, while the cat shows a real colour, is reported and not written. Samuel sees it on the contact sheet with the old colour beside the new one. Only colours he approves are written (the `exclude` list, as for the fill-in).
- **Copying forward stays honest.** When a restored main photo was read before, the machine reading copied forward is that photo's reading under the current version. If that photo has only older-version readings, an automatic run copies the newest, as now, and a manual re-read reads it.

**Cost:** about 28 calls for the trial and about 28 for the write. Run them an hour apart, because the reader's allowance is 60 calls an hour.

---

## 6. What the readings are today, and where this was checked

- **The 15 October fill-in run wrote 23 machine readings:**
  - **19 colours:** 18 cats in the main run, with 6 cats Samuel rejected left out (GitHub run 38770213522, `mode=write`), then #7 Milo Moon in a second run (38771548249);
  - **4 Not sure:** #3, #26, #27 and #28.
- **Plain *Tabby* on the live site:** 5 cats (#6, #9, #14, #15 and #20), read from the public cat list at about 16:40 UTC on 15 October. The SYC-161 comments of 15 October list every cat.
- **Not written:** #5, #8, #13, #25 and #29. Samuel's colours for #5, #8, #25, #9 and #15 are set by the team once it can correct colours (SYC-399). #13 and #29 wait for this spec.

---

## 7. Where it reaches

| Place | What changes |
|---|---|
| `artifacts/api-server/src/lib/appearance.ts` | `brown` added, in the order of §2; `normaliseColours` keeps Black + White as *Black and white* when Tabby is also present |
| `lib/observations.ts` (the colour check on write) | A third entry is allowed only when it is `tabby`; the messages "1 or 2 entries" and "eight-colour list" are updated |
| `lib/resolve.ts` (`resolveCoat`) | Rule 2 sets Tabby aside before choosing two colours (§3) |
| `lib/coatReading/reader.ts` | Prompt coat-v2 (§5); a `brown` description (the colour descriptions are keyed by every colour, so it won't compile without one); accepts two colours plus Tabby |
| `lib/coatReading/due.ts`, `record.ts`, `sweep.ts` | The manual re-read setting; version-aware "due" for manual runs only; skipping marked-wrong photos; holding back a Not sure re-read; copying forward the current version's reading (§5) |
| `lib/teamCatView.ts` | Its own colour words gain "brown". Without it, the team's history would print "unknown" |
| `lib/api-spec/openapi.yaml` (`coat`) | `brown` in the list; at most three items. The generated types in `lib/api-zod` and `lib/api-client-react` are regenerated |
| `artifacts/cat-spotter/lib/appearance.ts` (`COAT_LABEL_KEYS`) and `lib/i18n.ts` | `coat_brown` in English, Greek and French, in the order of §2. The "eight colours" comment becomes nine |
| The colour chips (SYC-161 PR 3; SYC-2 PRs 3.1 and 4.1–4.3) | A Brown chip; for people answering, Tabby is a separate tick beside up to two colours; the filter rules of §4 |
| The spotter's colour line after naming a cat (SYC-2 §5.1) | A pre-filled answer can be three words ("Brown · Ginger · Tabby, right?") |
| `.github/workflows/coat-readings.yml` | A `reread` choice, off by default |
| Tests that pin eight colours or at most two | `resolve.appearance`, `reader`, `observations`, the public-payload tests, the team-page word tests, and the app's catalogue test, which pins the generated list |
| Johnny's pack (SYC-346, SYC-283) | One new word, *Brown*, in Greek and French |

**Offline** is unchanged: the colours and the filter work over the saved cat-alog, and a cat whose colour arrived after the copy was saved is *Colour not known*.

**No database change.** Colours are a list of codes in an existing field.

---

## 8. Decisions for Samuel

### Decision 1: how is "brown and ginger tabby" recorded?

| Option | What it means | Benefits | Risks | What people notice |
|---|---|---|---|---|
| **1A. Up to two colours, plus Tabby (recommended)** | Fofi and Krispy are *Brown · Ginger · Tabby* | Records what Samuel said. Matches Tabby being a pattern. Someone who taps Brown or Ginger finds them | "One or two colours" changes in the colour check, the resolver's rule 2, the API's limit, the reader and the chips (§7) | Three words on some cats |
| 1B. Keep two colours; record *Brown · Tabby* | The ginger isn't recorded | Smallest change: only Brown is added | Someone who taps *Ginger* won't find Fofi or Krispy, and the filter hides the cat they're looking for | Brown · Tabby |
| 1C. Any three colours | No special place for Tabby | Most flexible | Allows lists like *Black · White · Ginger*, which is really calico; more ways for spotters to disagree | Up to three words |
| 1D. Tabby as a separate "striped" field | Colour (up to two) and pattern stored apart | The cleanest data | A new field across the database, the wire, the resolver and every screen; much larger, and past the launch | The same words as 1A |
| 1E. No Brown | Brown tabbies stay *Tabby*, or *Ginger · Tabby* | Nothing to build | Goes against what Samuel asked for; the most common cat on the island has no colour of its own | No change |

**Recommendation: 1A.** It is what Samuel described, it keeps the filter from hiding a cat someone is looking for, and its extra work sits in rules that already treat Tabby as a pattern.

### Decision 2: where do cats recorded only as "Tabby" show?

| Option | Benefits | Risks |
|---|---|---|
| **2A. Under every colour chip (recommended)** | A cat whose colour was never said is never hidden, whichever colour the spotter taps. Same idea as *Colour not known* always being shown | A spotter tapping Grey also sees plain-Tabby cats that turn out to be brown: a few extra cards to scroll past |
| 2B. Under Brown only | Fewer extra cards. Most plain-Tabby cats here are brown | A ginger or grey cat recorded as plain Tabby vanishes when someone taps its real colour |
| 2C. Under Tabby only | The tidiest rule | Tapping Brown hides most of the island's brown tabbies until they're re-read or corrected |

**Recommendation: 2A.** A filter should show too much rather than too little; a hidden cat is how duplicates are made.

### Decision 3: what happens to the 19 colours read before Brown?

| Option | What it means | Benefits | Risks | Samuel's hands |
|---|---|---|---|---|
| **3A. One checked re-read with coat-v2 (recommended)** | Rules of §5: manual only, rejected photos skipped, nothing showing is taken away, Samuel approves each change | Brown reaches the existing tabbies; the calico and *White · Tabby* misses are fixed at the same time; about 56 calls, once | More code (§7: `due.ts`, `record.ts`, `sweep.ts`, the workflow) and a second contact sheet | About 5 minutes on the sheet |
| 3B. No re-read; the team corrects by hand | Existing readings stay; the team uses Correct (SYC-2 PR 3.1) | No new AI calls; R4 stays exactly as it is | Plain-Tabby cats stay plain until someone corrects each one. With 2A they're never hidden, so the cost is a less precise description, not a lost cat | Corrections, cat by cat |
| 3C. Re-read only the 5 cats never written, with coat-v2 | They have no reading, so R4 already allows it | No rule change; fixes the cats that show nothing | The 19 existing readings never gain Brown | One small contact sheet |

**Recommendation: 3C now, and 3A later only if the plain-Tabby cats bother Samuel once the chips are live.** I've changed my recommendation after the review. With Decision 2A, a plain-Tabby cat is never hidden, so re-reading the 19 is a nicety, not a fix, and 3A adds the most code and the most risk to this spec. 3C needs no rule change. The cats Samuel already judged get their colours from the team (SYC-399), which always beats the machine.

### Decision 4: does Brown go into the launch?

| Option | Benefits | Risks |
|---|---|---|
| **4A. The word goes in Johnny's pack by Thu 22 October; the chips (SYC-161 PR 3) are built with Brown if this spec is approved before PR 3 starts (recommended)** | One word costs Johnny almost nothing. The chips launch with Brown and with the plain-Tabby rule. Never blocks the launch | If approval comes after PR 3 starts, the chips ship first and Brown follows in a small PR |
| 4B. After the launch | Nothing extra in the launch fortnight | The chips go out without Brown, and plain-Tabby cats hide under colour chips unless 2A is built anyway |

**Recommendation: 4A.**

---

## 9. Tests

- **The list:**
  - `brown` is accepted;
  - three entries are allowed only when one is `tabby`;
  - `brown` with `not_sure` is refused;
  - Black + White + Tabby is stored as *Black and white · Tabby*.
- **The resolver:**
  - two voices for *Brown · Ginger · Tabby* show all three;
  - with three agreed colours plus Tabby, the top two colours and Tabby are shown;
  - one spotter's *Tabby* and another's *Brown · Tabby* agree on Tabby;
  - two camps that share only Tabby are still two camps;
  - a team colour still beats every machine reading.
- **The filter:**
  - plain *Tabby* shows under every colour chip;
  - *Brown · Ginger · Tabby* shows under Brown, Ginger and Tabby;
  - solid *Brown* doesn't show under Tabby;
  - on a phone that doesn't know Brown: a Brown-only cat lands in *Colour not known*, and *Brown · Tabby* behaves as plain Tabby;
  - every cat the search finds is counted exactly once.
- **The wire:** a three-entry `coat` passes the API's schema; an older app shows the codes it knows and drops `brown` without error.
- **The reader:**
  - the coat-v2 colour list equals the nine codes;
  - *Brown · Ginger · Tabby* is accepted;
  - three colours without Tabby give *Not sure*.
- **Re-reading (only if 3A):**
  - the automatic run and a newly named cat never re-read for a version change;
  - a manual re-read skips a photo with a marked-wrong reading;
  - a re-read answer of *Not sure* is not written over a real colour;
  - copying forward uses the current version's reading.
- **Words:** `coat_brown` in all three languages, and colours are said in the §2 order with Tabby last.

---

## 10. Not in this spec

- Breed words and eye colour stay out, as before.
- Cream is *Ginger*; cinnamon is *Brown*.
- Markings are unchanged.

---

## Review outcome

An independent adversarial review (Sonnet, in its own worktree, read-only) of the first draft, `17b70721`, found 2 blockers, 9 majors, 2 minors and 2 nits. All were accepted.

| # | Finding | What changed |
|---|---|---|
| 1 (blocker) | Re-reading under a new version needs `due.ts`, `record.ts` and `sweep.ts` to change, and copying forward would carry the old version | §5 states the version-aware rules; §7 lists the files. The recommendation moves to 3C, which needs none of it |
| 2 (blocker) | The draft didn't say whether the 15 October colours were written, or cite evidence | §6 cites the GitHub runs and the live cat list |
| 3 | A re-read could replace a real colour with *Not sure*, or bring back a rejected one | §5: Not sure is held back, and rejected photos are skipped |
| 4 | "Prompt version" was undefined, the automatic run could re-read everything, and the "public can't cause it" argument was too loose | §5: the version is the whole `modelVersion`; only manual runs re-read; the bound is one call per photo per version |
| 5 | The reader turns three colours into *Not sure* | §5 and §7 |
| 6 | A new "tortoiseshell takes nothing else" rule wasn't needed for Brown | Dropped |
| 7 | Rule 2's "top two" would drop Tabby or a colour; Black + White + Tabby wasn't normalised | §3 sets Tabby aside first; §2 and §7 cover normalising |
| 8 | Display order gave "Ginger · Brown" and "White · Tabby" | §2 fixes the order, with Tabby last |
| 9, 10 | Documents and code places missing from the list of what changes | Both lists completed |
| 11 | A plain-Tabby ginger or grey cat would be hidden too | Decision 2 now has three options; 2A covers every colour chip; §4 defines the counts |
| 12 | Options missing from Decisions 1 and 3, and Decision 4 unclear | 1D, 1E and 3C added; 4A clarified |
| 13 | Dates and sources unchecked | §6 and the header cite their sources. The Fofi quote is from 16 October 01:30 UTC; the reviewer assumed it was still 15 October |
