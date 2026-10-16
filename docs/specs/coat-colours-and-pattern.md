# A cat's coat: colours you can see, and one pattern

**Ticket:** SYC-398 (High). This spec replaces the earlier "Brown" draft on the same branch, which was never merged.
**Decided with Samuel** in a brainstorm on 16 October 2026. His answers are quoted in §11.
**Amends:**
- `coat-markings-and-health.md`: §3.1 (the colour list), §4.2 (who wins on colour), §4.4 (Correct and Mark wrong for colour), §5.1 to §5.3 (the questions, the page, the team's screen), §8 (the filter), §10 (the data and the wire) and §11 (tests);
- `choose-a-different-cat.md`: §4.7 (the colour filter);
- `cat-record-data-spine.md`: §10.2 (its copy of the colour rules);
- the SYC-2 plan (the colour chips);
- the SYC-161 plan: rules R4 and R5, the reader, and PR 3's chips;
- SYC-397 (the reader's prompt), which this absorbs;
- `DECISIONS.md` Part 2n: a new entry on approval.

**Status:** draft for an independent review, then Samuel's approval. Nothing is built before it.

---

## 1. In plain English

People never have to name a cat's coat. They **point at it**.

- **Colours:** five drawn swatches, *Black · Grey · Brown · Ginger · White*. You tap **every colour you can see**, and any combination is allowed. Cream counts as Ginger.
- **Pattern:** three small drawings, *Plain · Stripes · Patches*. You tap one.
- **A drawn cat** above the chips redraws with every tap, so the question becomes "Does it look like this?". The answers are **Looks like this** and **Not sure**.

The cat-fancier words (*tabby*, *tortoiseshell*, *calico*) disappear from everything the public sees:
- a calico is Black · Ginger · White, Patches;
- a ginger tabby is Ginger, Stripes;
- a tuxedo is Black · White, Plain.

"Find the cat" gets **two rows of drawn chips**, colours and patterns. A cat whose coat isn't known is never hidden.

The **colour reader** (the AI that reads each cat's photo) answers in the same terms. With Samuel's approval of each change, it re-reads every cat once with its new prompt.

---

## 2. The coat

A coat is two parts. Each part can be known or not known on its own.

| Part | Values | Meaning |
|---|---|---|
| **Colours** | any of `black`, `grey`, `brown`, `ginger`, `white`, with no limit | Every colour a person can see in the coat. *Brown* covers warm brown, sandy and golden-brown fur. *Ginger* covers orange and cream. *Grey* covers what breeders call blue |
| **Pattern** | one of `plain`, `stripes`, `patches` | **Plain:** one colour all over, or a colour with white in large areas (a tuxedo is Black · White, Plain). **Stripes:** stripes, swirls or spots in the coat (what breeders call tabby). **Patches:** a patchwork of colours (what breeders call tortoiseshell or calico) |

**Not sure.** A person can answer *Not sure* to the whole question. The AI can be unsure of either part on its own. "Not known" is stored and sent as no answer for that part, never as a value.

**White in the coat or as a marking.** White is a **colour** when it is a large part of the coat (a tuxedo's chest and legs, a calico's white). A white chest or white paws alone stay **markings** (`coat-markings-and-health.md` §3.2), which are unchanged.

**The words people see** are short captions under the drawings. The drawings carry the meaning:

| Code | English | Greek (draft) | French (draft) |
|---|---|---|---|
| `black` | Black | Μαύρο | Noir |
| `grey` | Grey | Γκρι | Gris |
| `brown` | Brown | Καφέ | Brun |
| `ginger` | Ginger | Πορτοκαλί | Roux |
| `white` | White | Λευκό | Blanc |
| `plain` | Plain | Μονόχρωμη | Unie |
| `stripes` | Stripes | Ριγέ | Rayée |
| `patches` | Patches | Με μπαλώματα | Tachetée |

Johnny checks every word (SYC-283).

On a cat's page and card, the coat reads as the colours in the order above, then the pattern: "Brown · Ginger, stripes" or "Black · White". *Plain* is never written out, because the drawing shows it.

**The team's screen** may also show the breeders' name for a coat ("Red tabby", "Calico"). It is worked out from the two parts and only ever shown to the team. Whether Syros Cats want it is open question 1 (§12).

---

## 3. How people say it

**The drawn cat.** One simple drawing of a sitting cat:
- the first colour tapped fills it;
- each further colour is a patch;
- White fills the chest and legs;
- Stripes lays stripes over the coloured areas;
- Patches enlarges the patches.

It is a **picture of the answer**, not a photo, and it is the same in all three languages. Samuel judges the drawings in the browser check before the PR opens.

**Where the question appears.** These are the same places as before (`coat-markings-and-health.md` §5):
- **The spotter's line after naming a cat.** It's pre-filled from the AI's reading: "Krispy looks like this, right?", with the drawn cat, and *Yes* or *Change*.
- **The "add details later" card.**
- **The team's and cat guardians' Correct.** It uses the same screen and requires at least one colour and a pattern, because the team never states *Not sure* (as before).

**One question, both parts.** A person's answer always carries colours and a pattern together. *Not sure* answers both.

---

## 4. Who wins

The rules of `coat-markings-and-health.md` §4.2 are unchanged in who outranks whom. They are applied to **colours** and to **pattern** separately:

1. **The team or a cat guardian** decides both parts. A guardian's standing statement outranks the team's, and within one level the newest stands (Decision G). *Confirmed.*
2. **Two spotters who agree:**
   - **colours:** each colour counts on its own, and is shown when two voices hold it. There is no limit on how many are shown. The camp rule stays: if two groups of colours are each agreed but nobody named both, the group with the newer support is shown and the cat goes on the team's Colour check list;
   - **pattern:** shown when two voices name the same pattern;
   - *Likely.* "Agree" keeps its meaning: different devices, different photos, different days.
3. **The AI's newest reading** of that part. *Reported.*
4. **One spotter** fills a part the AI left unknown, but never overturns a real AI reading. *Reported.*
5. Otherwise that part is **not known**.

So a cat can show the AI's colours with the pattern two spotters agreed on. Both are visible on the photo, so that's harmless.

**Mark wrong** still retracts one statement, and the next rule decides. A retraction covers that statement's colours and its pattern together.

**Colour is never evidence of life and never notifiable**, and it never feeds the matcher (SYC2-D8), as before.

---

## 5. The filter in "Find the cat"

Two rows of drawn chips sit under the search box:

- **Colours:** *All · Black · Grey · Brown · Ginger · White*
- **Pattern:** *All · Plain · Stripes · Patches*

How a cat matches:
- **Within a row, any chip counts.** Brown and Ginger shows cats with either colour.
- **Across the rows, both must match.** Ginger and Stripes shows ginger cats with stripes.
- **Unknown always stays in.** A cat whose colours are not known stays in, under any colour. A cat whose pattern is not known stays in, under any pattern. Both kinds sit in their own section, headed *Not known*, below the cats that match.
- **Both rows start at All**, and reset each time the picker opens.
- **The line above "Can't find it? Add it as a new cat"** says how many cats the filter is hiding, with one tap to show them all: *"8 more cats nearby in other colours or patterns. Show all."*
- **The counts add up.** Every cat the search finds is counted exactly once: matching, *Not known*, or hidden.

**Offline:** the filter works over the cat-alog saved on the phone. A cat whose coat arrived after the copy was saved is *Not known*, so it is never hidden.

---

## 6. The data

**A statement** (an observation of kind `coat`) carries:

```
{ colours: ["brown", "ginger"], pattern: "stripes" }            // a person
{ colours: [...], pattern: "...", modelVersion: "..." }         // the AI
```

- `colours`: one to five distinct codes from the five, or absent when not known. The AI may leave it absent; a person can't.
- `pattern`: one of the three, or absent when not known.
- A person's *Not sure* is `{ notSure: true }`. It withdraws that same device's earlier answer, as a spotter's *Not sure* does today (§4.2).

**Statements written before this spec** used the old list (`{ colours: ["ginger", "tabby"] }`). They are **never rewritten**. Every reader translates them through one function, the same everywhere:

| Old code in a statement | Colours | Pattern |
|---|---|---|
| `black`, `white`, `ginger`, `grey` | that colour | (not said) |
| `tabby` | (adds nothing) | stripes |
| `black_and_white` | black, white | plain |
| `tortoiseshell_or_calico` | black, ginger | patches |
| `not_sure` | not known | not known |

So *Ginger · Tabby* becomes Ginger, Stripes, and plain *Tabby* becomes no colour, Stripes. On production this covers all 23 machine readings written on 15 October (GitHub runs 38770213522 and 38771548249); none of them is tortoiseshell or calico.

**No database change.** The value is an existing JSON field.

**The public wire** (`GET /cats` and `GET /cats/{id}`) carries the resolved coat as two new fields:

- `coatColours`: the codes, in the order of §2, or `[]` when not known.
- `coatPattern`: one code, or `null` when not known.

The old field `coat` keeps being sent, **worked out from the new parts**, for phones that haven't updated. It is limited to the old codes and to two of them. The rule is:

1. Black and white together, with a plain pattern: `black_and_white`.
2. Otherwise patches with black and ginger: `tortoiseshell_or_calico`.
3. Otherwise stripes: the first of ginger or grey present, if any, plus `tabby`.
4. Otherwise the first one or two old colours present.
5. Nothing that fits: `[]`.

So Brown alone is sent as `[]`, and an older phone shows no colour for it. Nothing about how sure, who said it or when is ever sent, as before.

**The cat-alog cache key stays `v2`.** The new fields are added, and a cached copy without them reads as *Not known*.

---

## 7. The colour reader

**The prompt** becomes version `coat-v2`, with the model name in front as now (`gpt-5.6-terra/coat-v2`). It asks for:
- how many cats it sees, and whether the photo is clear;
- every colour from the five it can see;
- the pattern from the three;
- one confidence.

It describes each value in plain terms:
- calico and tortoiseshell are **Patches**, never Stripes;
- a warm sandy brown is **Brown**, not Ginger;
- white counts as a colour only when it is a large part of the coat.

It folds in SYC-397, which is closed by this spec.

**Not sure.** As now, the whole answer is *Not sure* when:
- the AI saw anything other than exactly one cat;
- the photo isn't clear;
- the confidence is below the cut-off (0.8);
- it gave an unknown code.

If the AI says it can't tell the pattern but is sure of the colours, the pattern is not known and the colours stand.

**Re-reading every cat once** (Samuel, §11). SYC-161's rule R4 ("never send a photo to the AI twice") becomes **never twice with the same reader version**, guarded so that nothing it protected is lost:

- **Only a manual run re-reads.** The run started from the GitHub workflow has a re-read setting, off by default. The automatic catch-up run, and a newly named cat, never re-read for a version change; they treat any earlier reading as final.
- **The public can't cause it.** A version changes only through a PR, Samuel's pull in Replit and a publish. Each photo costs at most one call per version.
- **A photo the team rejected stays rejected.** If any reading of a photo was marked wrong, the re-read skips that photo.
- **Nothing showing is taken away.** A re-read whose answer is *Not sure* is not written over a known coat.
- **Samuel approves every change.** The re-read is a trial first. The contact sheet shows each cat's photo, its current coat and the new reading. Only the changes he approves are written (`exclude`, as for the fill-in).
- **Copying forward** copies only a reading made under the current version. A restored main photo that has only older readings is read again only by a manual re-read; an automatic run keeps its older reading, as now.
- **The budget:** about 28 calls for the trial and 28 for the write, an hour apart (the allowance is 60 an hour).

**Statements by the team, guardians and two agreeing spotters always beat any reading**, so the re-read can't overturn them.

---

## 8. What happens to the cats already read

- **18 of the 23 readings carry over exactly** through §6's table.
- **5 cats recorded as plain *Tabby*** (#6, #9, #14, #15 and #20, from the live list at about 16:40 UTC on 15 October) become *no colour, Stripes*. They are never hidden, and the re-read gives them colours.
- **The 5 cats never written** (#5, #8, #13, #25 and #29) are read for the first time by the same trial.
- **Samuel's own verdicts from 15 and 16 October** (on SYC-161 and SYC-399) become team statements once the team's Correct is live. They beat any reading:
  - Taffy and Boudicca: Black · Ginger · White, Patches;
  - Fila: Ginger · White;
  - Toula and Say Say: Brown · White, Stripes;
  - Fofi and Krispy: Brown · Ginger, Stripes.

---

## 9. Where it reaches

| Place | What changes |
|---|---|
| `artifacts/api-server/src/lib/appearance.ts` | The five colours and three patterns; the one function that translates an old statement (§6); `normaliseColours` goes, because Black + White is simply two colours now |
| `lib/observations.ts` (the check on write) | The new value shape; old-shape writes refused from now on; the same author rules as before |
| `lib/resolve.ts` (`resolveCoat`) | Colours and pattern resolved separately (§4); no limit on colours; reads old statements through the translation |
| `lib/catHelpers.ts` (`serialiseCat`) | `coatColours`, `coatPattern`, and the old `coat` worked out for older phones (§6) |
| `lib/coatReading/` (`reader.ts`, `due.ts`, `record.ts`, `sweep.ts`) | Prompt `coat-v2`; the new answer shape; the version-aware manual re-read and its guards (§7) |
| `lib/teamCatView.ts` and the team pages (SYC-2 PR 3.1) | The new words; Correct uses the tapping screen; the optional breeders' name (§2) |
| `lib/api-spec/openapi.yaml` | `coatColours` and `coatPattern` added, `coat` kept; the generated types regenerated |
| `.github/workflows/coat-readings.yml` | A `reread` choice, off by default |
| `artifacts/cat-spotter` | The drawn swatches and patterns; the drawn cat; the question screen; the two filter rows (SYC-161 PR 3); the words in three languages; reading the new fields, with the old field as fallback |
| Tests that pin the eight colours, "one or two", or the old shape | Updated to the new shape (§10) |
| Documents | The specs and plans listed at the top, and a `DECISIONS.md` entry |
| Johnny's pack (SYC-346, SYC-283) | Brown, Plain, Stripes, Patches; "What does {name} look like?", "Looks like this", "Not known", and the hidden-cats line |

---

## 10. Tests

- **The translation:**
  - every old code maps as in §6's table;
  - *Ginger · Tabby* becomes Ginger, Stripes;
  - *Tabby* becomes no colour, Stripes;
  - *Black and white* becomes Black · White, Plain.
- **The check on write:**
  - any combination of the five colours is accepted;
  - an unknown code is refused;
  - an old-shape write is refused;
  - a team statement without a pattern is refused;
  - a team *Not sure* is refused.
- **Who wins:**
  - each of the five rules for colours and for pattern, on its own and in conflict;
  - colours and pattern from different rules on one cat;
  - no limit on shown colours;
  - the camp rule on colours;
  - a later AI reading never beats the team;
  - old and new statements mixed on one cat resolve as if all were new.
- **The wire:**
  - `coatColours` and `coatPattern` match the resolved coat;
  - the old `coat` follows §6's rule for each case, including Brown alone giving `[]`;
  - nothing else about the coat is sent;
  - the cache key is still `v2`.
- **The filter:**
  - any chip within a row counts;
  - both rows must match;
  - unknown colours or an unknown pattern never hide a cat;
  - the counts add up;
  - it works offline over a saved catalogue that has no new fields.
- **The reader:**
  - the prompt lists exactly the five colours and three patterns;
  - each *Not sure* case;
  - pattern unknown while the colours stand.
- **Re-reading:**
  - the automatic run and a newly named cat never re-read for a version change;
  - a manual re-read reads each photo once per version;
  - it skips a photo with a rejected reading;
  - a *Not sure* never replaces a known coat;
  - `exclude` holds;
  - copying forward uses only current-version readings.
- **The drawn cat:** every combination renders, and the caption matches.
- **Words:** every new word in all three languages, and no raw code ever shown.

Each test that guards a silent rule gets a mutation probe in its PR: break it, watch the test go red, restore it.

---

## 11. What Samuel decided (brainstorm, 16 October 2026)

- On the words: he wasn't sure of the difference between tortoiseshell, calico and tabby, and wasn't confident users would be: "let's solve this first".
- On the limit: "why shouldn't a tabby have as many colours as it has, rather than a limit of two?"
- What felt wrong about naming: "Words are the wrong tool", and "Colour names are fuzzy".
- How to point: he chose **A, drawn cats**, over real photos and fur swatches. Then: "it needs to allow all colour combos", and he chose **a cat that changes as you tap**.
- Cream: "don't separate cream from ginger". Tapping several colours: clear enough ("yes"). The filter: "pattern too".
- Sections 1 to 3 and 5 of the design: approved as presented.
- Section 4: "Re-read all 28 too".

---

## 12. Open questions (not blocking approval)

1. **Do Syros Cats want the breeders' names on the team's screen** ("Red tabby", "Calico")? If yes, it is a small, team-only addition.
2. **The drawings.** Claude draws the first version as simple shapes, and Samuel judges them in the browser check. Commissioning illustrations later changes nothing else.
3. **Timing.** The words go into Johnny's pack by Thu 22 October. The build follows the spec, the plan and the PRs, and **never blocks the 31 October launch**. If it isn't ready, "Find the cat" launches without colour chips, and the colours already on cat pages keep showing through the translation.

---

## 13. Not in this spec

- Breed, eye colour, coat length (*Long fur* stays a marking) and patterns finer than the three.
- Changes to markings.
- Using colour or pattern in matching.
