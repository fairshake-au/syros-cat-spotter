# A cat's coat: colours you can see, and one pattern

**Ticket:** SYC-398 (High). This spec replaces the earlier "Brown" draft on the same branch, which was never merged.
**Decided with Samuel** in a brainstorm on 16 October 2026 (his answers are quoted in §12). Revised after an independent adversarial review (§14).
**Amends:**
- `coat-markings-and-health.md`: §3.1, §4.2, §4.4, §5.1–§5.3, §7.2, §8, §10 and §11;
- `choose-a-different-cat.md`: §4.7 (the colour filter);
- `cat-record-data-spine.md`: §3.4, §10.1 (the `coat` value), §10.2 (its copy of the colour rules), §10.7 (the wire) and §10.9 (`colour_filter_on`);
- the SYC-2 plan: PR 3.1's Appearance section and Colour check list, and PRs 4.1–4.3 (the answers endpoint, the details card, the cat-alog filter);
- the SYC-161 plan: R2, R4, R5, PR 2 and PR 3;
- SYC-397: the reader's prompt fixes are absorbed into coat-v2 here, and it closes when that is built;
- `DECISIONS.md` Part 2n: a new entry on approval.
**Replaces this wording in those documents:**
- the fixed eight-value colour list;
- "one or two colours";
- the chip list *All · Black · White · Ginger · Grey · Tabby · Tortoiseshell or calico · Black and white · Not sure* and its *Colour not known* chip;
- the words *Tabby*, *Tortoiseshell or calico* and *Black and white* wherever the public sees them.
**Status:** **approved by Samuel, 16 October 2026** ("approved"), with every recommendation taken: 2A, 3A, 4A, 5A and 6A (§11). The implementation plan follows, for his approval before any code.

---

## 1. In plain English

People never have to name a cat's coat. They **point at it**.

- **Colours:** five drawn swatches, *Black · Grey · Brown · Ginger · White*. You tap **every colour you can see**, in any combination. Cream counts as Ginger.
- **Pattern:** drawn pictures, *Plain · Stripes · Patches*, and *Can't tell*.
- **A drawn cat** above the chips redraws with every tap, so the question is "Does it look like this?". The answers are **Looks like this** and **Not sure**.

The cat-fancier words (*tabby*, *tortoiseshell*, *calico*) disappear from everything the public sees:
- a calico is Black · Ginger · White · Patches;
- a ginger tabby is Ginger · Stripes;
- a tuxedo is Black · White · Plain or Patches, whichever it looks like.

"Find the cat" gets **two rows of drawn chips**, colours and patterns. A cat is never hidden because its coat isn't known.

The **colour reader** (the AI that reads each cat's photo) answers in the same terms. It re-reads every cat once with its new prompt, and Samuel approves every change it makes.

---

## 2. The coat

A coat has two parts. Each part is known or not known on its own.

| Part | Values | Meaning |
|---|---|---|
| **Colours** | any of `black`, `grey`, `brown`, `ginger`, `white`, with no limit | Every colour you can see in the coat. *Brown* is warm brown, sandy or golden-brown. *Ginger* is orange or cream. *Grey* is what breeders call blue |
| **Pattern** | one of `plain`, `stripes`, `patches` | **Plain:** one colour all over, perhaps with a small white bib, socks or face. **Stripes:** stripes, swirls or spots (what breeders call tabby). **Patches:** any patchy look: patchwork of colours, including black-and-white or ginger-and-white in patches (calico, tortoiseshell, cow-patched). A coat that is both striped and patchy is *Patches* |

**Plain or Patches is sometimes a judgement call** (Samuel chose "any patchy look", 16 October). A tuxedo can look like either. The filter allows for that (§5), so the call never hides a cat.

**White in the coat or as a marking.** White is a **colour** when a person can see it as part of the coat. A small white chest or white paws can also be recorded as **markings** (`coat-markings-and-health.md` §3.2), which are unchanged. The two don't conflict.

**Words.** The drawings carry the meaning; the words are captions. All are nouns, so there is no grammar to agree (Decision E1). The Greek and French are drafts for Johnny (SYC-283):

| Code | English | Greek (draft) | French (draft) |
|---|---|---|---|
| `black` | Black | Μαύρο | Noir |
| `grey` | Grey | Γκρι | Gris |
| `brown` | Brown | Καφέ | Brun |
| `ginger` | Ginger | Πορτοκαλί | Roux |
| `white` | White | Λευκό | Blanc |
| `plain` | Plain | Ενιαίο | Uni |
| `stripes` | Stripes | Ρίγες | Rayures |
| `patches` | Patches | Μπαλώματα | Plaques |
| (the pattern chip) | Can't tell | Δεν ξέρω | Je ne sais pas |

**On a cat's page and card**, the coat is one line joined with " · " in every language:
- colours first, in the order of the table;
- then the pattern, except *Plain*, which the photo shows;
- then the markings.

For example: "Brown · Ginger · Stripes · White paws".

---

## 3. How people say it

**The drawn cat.** One simple drawing of a sitting cat:
- the first colour tapped fills it;
- each further colour is a patch;
- White fills the chest and legs;
- Stripes lays stripes over the coloured areas;
- Patches enlarges the patches.

It is a picture of the answer, the same in all three languages. Samuel judges the drawings in the browser check before the PR opens.

**One answer, two parts.** A person taps at least one colour, then a pattern or *Can't tell*. *Can't tell* leaves the pattern not said, so a tourist who saw the colours but not the pattern is never pushed into a guess. **Not sure** answers both parts as not known. It withdraws that same device's earlier answer, as a spotter's *Not sure* does today (`coat-markings-and-health.md` §4.2).

**Where the question appears.** The same places as before (`coat-markings-and-health.md` §5):

- **The spotter's line after naming a cat.** Pre-filled from the AI's reading: "Krispy looks like this, right?", with the drawn cat.
  - The buttons stay **Yes · Change · Skip**. *Yes* is recorded as a prompted answer for the parts that were pre-filled, so it never counts as an independent voice (as now).
  - If the AI knew only the colours, the line asks for the pattern alone.
  - If the AI knew nothing, the line opens the full question.
- **The "add details later" card**, with the full question.
- **The team's and cat guardians' Correct** (`coat-markings-and-health.md` §4.4).
  - The team's pages are plain server-drawn pages with no scripts. So Correct is a **form**: five colour checkboxes with swatches, and pattern radio buttons, including *Not stated*.
  - The drawn cat is shown once, after the form is saved.
  - A team statement states colours, a pattern, or both. A part it leaves blank is *not stated* and falls to the next rule (§4).
  - The team never states *Not sure*, as now.

**Words on the team's screen.** The team sees the same words and drawings as everyone else. The breeders' names are not shown (Decision 4).

---

## 4. Who wins

The rules of `coat-markings-and-health.md` §4.2 keep their order. They are applied to **colours** and to **pattern** separately, and every statement says which parts it states.

1. **The team or a cat guardian.** For each part the statement states, it decides. A guardian's standing statement outranks the team's, and within one level the newest stands (Decision G). A part the statement leaves not stated falls through to the next rules. *Confirmed.*
2. **Two spotters who agree.**
   - **Colours:** each colour counts on its own and is shown when two voices hold it. There is no limit. The camp rule stays: if two groups of colours are each agreed but nobody named both, the group with the newer support is shown, and the cat goes on the Colour check list.
   - **Pattern:** shown when two voices name the same pattern. If two patterns each have two voices, the one with the newer support is shown, and the cat goes on the Colour check list ("spotters disagree on the pattern").
   - *Likely.* "Agree" keeps its meaning: different devices, different photos, different days.
3. **The AI's reading** is its **newest row** only. A part that row leaves not known is not known: an older reading never fills it (Samuel, 14 October, `DECISIONS.md` 2n). *Reported.*
4. **One spotter** fills a part rules 1–3 left not known, but never overturns a real AI reading of that part. *Reported.*
5. Otherwise that part is **not known**.

**Mixed sources.** A cat can show the AI's colours with the pattern two spotters agreed on. When the two parts come from different rules, the cat goes on the team's Colour check list ("colour and pattern from different sources"), so a coat nobody stated is seen and confirmed (Decision 2).

**What a statement counts as.**
- A statement with colours and no pattern is a colour statement.
- A statement with a pattern and no colours is a pattern statement. An old *Tabby* alone is read this way (§6).
- **Only `{ notSure: true }` withdraws.** An empty part never does.

**Each part resolves on its own**, with its own confidence, supporting statements and date, and its own Colour check reasons. The team's Appearance section, the Colour check list and Confirm read each part separately.

**Confirm** records the resolved coat as a team statement. It states only the parts that are known; a part that isn't known is left not stated. If neither part is known, Confirm isn't offered (as now).

**Mark wrong** retracts one whole statement, both parts, and the next rule decides each part.

**Unchanged:**
- colour and pattern are never evidence of life and never notifiable;
- they never feed the matcher (SYC2-D8);
- a later AI reading never beats a team or guardian statement.

---

## 5. The filter in "Find the cat"

Two rows of drawn chips sit under the search box:

- **Colours:** *All · Black · Grey · Brown · Ginger · White*
- **Pattern:** *All · Plain · Stripes · Patches*

**How each cat is placed**, for each row someone has picked a chip in:
- **A known match:** the cat has a picked colour (or the picked pattern).
- **A known mismatch:** the cat's part is known and doesn't match.
- **Not known:** the cat's part isn't known.

Then:
1. **Hidden** if any picked row is a known mismatch.
2. Otherwise **Not known** if any picked row is not known. The cat is shown in its own section, headed *Not known*, below the matches.
3. Otherwise **matching**.

Further rules:
- **Within a row, any chip counts.** Brown and Ginger shows cats with either colour.
- **Plain and Patches are forgiving.** A cat with White among its colours shows under Plain **and** under Patches, whichever was recorded, because the line between them is a judgement call (§2).
- **Both rows start at All** and reset each time the picker opens.
- **The line above "Can't find it? Add it as a new cat"** says how many cats the filter hides, with one tap to show them all: *"8 more cats nearby in other colours or patterns. Show all."*
- **Every cat the search finds is counted once:** matching, Not known, or hidden.

**The filter reads only the new fields** (§6). A cat the phone has without them, for example from a catalogue saved before the update, is Not known in both rows, so it is never hidden. The old `coat` field is never used to filter.

**Offline:** the filter works over the cat-alog saved on the phone.

**The match record** (`sighting_matches.colour_filter_on`, data spine §10.9) is true when **either** row had a chip picked. The name stays as it is.

---

## 6. The data

**A statement** (an observation of kind `coat`):

```
{ colours: ["brown", "ginger"], pattern: "stripes" }            // a person
{ colours: ["ginger"] }                                         // pattern not said
{ pattern: "stripes" }                                          // colours not said (a team statement, or an old "Tabby")
{ notSure: true }                                               // a person's Not sure
{ colours: [...], pattern: "...", modelVersion: "..." }         // the AI; either part may be absent
```

- `colours`: one to five distinct codes, or absent.
- `pattern`: one code, or absent.
- A spotter's answer always has `colours`, or is `{ notSure: true }`.
- A team or guardian statement has at least one part.

**Statements written before this spec** used the old list. They are **never rewritten**. One function, used everywhere, reads them, and **only what an old statement said becomes known**:

| Old statement | Colours | Pattern |
|---|---|---|
| contains `tabby` | the other colours, except a bare `white` (the tabby's own colour was never said); `black_and_white` still gives black and white; if nothing remains, not known | stripes |
| `black_and_white` | black, white | not known |
| `tortoiseshell_or_calico` | black, ginger | patches |
| `black`, `white`, `ginger` or `grey` without `tabby` | those colours | not known |
| `not_sure` alone | | Not sure (a withdrawal) |

So:
- *Ginger · Tabby* → Ginger · Stripes;
- *Tabby* → Stripes, colours not known;
- *Tabby · White* → Stripes, colours not known (the tabby's own colour was never said);
- *Black and white* → Black · White, pattern not known.

**What that does to the 23 machine readings written on 15 October** (GitHub runs 38770213522 and 38771548249):
- **12 stay known:**
  - 3 Ginger · Tabby (#11, #17, #22);
  - 3 Ginger · White (#12, #18, #21);
  - 1 Black (#16);
  - 5 Black and white, with the pattern not known (#2, #4, #7, #23, #24).
- **5 are plain *Tabby*** (#6, #9, #14, #15, #20) and **2 are *Tabby · White*** (#10, #19). All seven become Stripes, colours not known.
- **4 are Not sure** (#3, #26, #27, #28).
- None is tortoiseshell or calico.

One thing is lost until the re-read: #10 and #19 show "Tabby · White" today, and will show only "Stripes", because their white was said but their main colour never was. That is deliberate: a half-known colour would hide them from people tapping their real colour. The re-read (§7) fills in what's missing. (Counts from the live cat list, about 16:40 UTC on 15 October.)

**No database change.** The value is an existing JSON field.

**The public wire** (`GET /cats` and `GET /cats/{id}`) carries the resolved coat as two new fields:
- `coatColours`: the codes in the order of §2, or `[]` when not known;
- `coatPattern`: one code, or `null` when not known.

The old field `coat` stays, for phones that haven't updated. It is **only for display**, never for the filter. It is worked out by a single function with a full truth table, at most two old codes, tested for every combination of the five colours and four pattern states:

| New coat | Old `coat` sent |
|---|---|
| Black + White, any pattern except Stripes, no other colour | `black_and_white` |
| Patches, with Black and Ginger | `tortoiseshell_or_calico` |
| Stripes | `tabby`, plus the first of ginger, grey, black, white present (Brown has no old code) |
| any other coat | the first two old colours present (black, white, ginger, grey) |
| no old colour and no stripes, or not known | `[]` |

So a brown tabby is sent as `tabby`, and Brown alone as `[]`. An older phone shows coarser words, never wrong ones. A Brown · White · Stripes cat is sent as `tabby · white`, never as plain "White".

**The cat snapshot** (`resolve.ts`) has `coatColours` and `coatPattern` in place of `coat`. The not-notifiable guard (`appearance.notNotifiable.test.ts`, `SYC2_FIELDS`) is updated to name exactly those two, so neither can ever be notifiable.

**The cat-alog cache key stays `v2`.** The fields are added. For the filter, a cached copy without them reads as Not known. For display, the updated app translates the old `coat` through the same table, so it shows "Stripes" rather than "Tabby", and never shows the old words.

---

## 7. The colour reader

**The prompt** becomes version `coat-v2` (`gpt-5.6-terra/coat-v2`). It asks for:
- how many cats it sees, and whether the photo is clear;
- every colour from the five it can see;
- the pattern from the three, or that it can't tell;
- one confidence.

It describes each value plainly:
- any patchy look is **Patches**, never Stripes;
- a warm sandy brown is **Brown**, not Ginger;
- white counts when it is part of the coat.

**Not sure.** As now, the whole answer is *Not sure* (`{ colours: ["not_sure"] }` is replaced by `{ notSure: true }` for new rows) when:
- the AI sees anything other than exactly one cat;
- the photo isn't clear;
- the confidence is below 0.8;
- it gives an unknown code.

If it can't tell the pattern but is sure of the colours, the pattern is absent and the colours stand.

**Re-reading every cat once** (Samuel, §12). SYC-161's rule R4 becomes:

> **At most one written reading per photo per reader version.** Model calls stay bounded by the existing budgets: 3 attempts a day per photo, and 60 calls an hour.

The guards:

- **Only a manual run re-reads.** The workflow's run gains a `reread` setting, off by default. The automatic catch-up run, and a newly named cat, never re-read for a version change.
- **"Due" depends on the run.** In an automatic run, a cat whose newest reading is from an older version is **not due** for that reason, so it never fills an automatic run's slots. The re-checks inside `record.ts` and before a photo is sent use the same setting as the run.
- **Copying forward still works.** When a restored main photo was read before, its newest reading is copied forward in the new shape (translated through §6), keeping its own `modelVersion`. A manual re-read later reads it with the current version.
- **A rejected photo stays rejected.** If any reading of a photo was marked wrong, the re-read skips it.
- **Cats the team has decided are skipped.** If both parts are stated by the team or a guardian, a reading can't change what's shown, so the re-read doesn't spend a call on that cat.
- **Nothing showing is lost.** A re-read is **held back**, not written, if it would leave unknown any part that the cat's current machine reading knows. A whole *Not sure* is held back the same way. Held-back cats are listed on the contact sheet.
- **Samuel approves every change.**
  - The re-read is a trial first. The contact sheet shows each cat's photo, its current coat and the new reading.
  - The write run then calls the AI again, so its answer can differ from the trial's.
  - The write run's results are compared with the trial's, cat by cat. Any that differ are shown to Samuel before the filter's chips go out (as in SYC-161's rollout).
  - Only cats he approved are written (`exclude`).
- **The bound if the password leaked.** The re-read is opened by the same mail-drain password as the colour run (SYC-161 Decision D1). If it leaked, someone could start re-reads. That costs at most one written reading per photo per version, inside the budgets above. Each re-read also needs a new version, which takes a PR and a publish.
- **The budget:** about 28 calls for the trial and 28 for the write. That fits in one hour (56 of 60).

**The team, guardians and two agreeing spotters always outrank any reading**, so the re-read can't overturn them.

---

## 8. What happens to the cats already read

- **Every colour showing today keeps showing** through §6's translation, except the White of #10 and #19 (§6).
- **The 7 cats recorded as *Tabby* or *Tabby · White*** become Stripes, colours not known. Under any colour chip they sit in *Not known*, never hidden, and the re-read gives them colours.
- **The 5 cats Samuel rejected** on 15 October (#5, #8, #13, #25, #29) were left out of the fill-in on purpose. They are read by the coat-v2 trial, and their rejections are the first test of whether coat-v2 does better.
- **Samuel's own verdicts** become team statements once the team's Correct is live (SYC-399). They are written exactly as he said them, translated through §6. A team member confirms any part he didn't state.

| Cat | Samuel's words (SYC-161 and SYC-399, 15–16 October) | Recorded as |
|---|---|---|
| #5 Taffy, #8 Boudicca | "Tortoiseshell or calico" | Black · Ginger · Patches |
| #25 Fila | "Ginger · White" | Ginger · White, pattern not stated |
| #9 Toula, #15 Say Say | "Tabby · White" | Stripes, colours not stated |
| #13 Fofi, #29 Krispy | "a brown and ginger tabby" | Brown · Ginger · Stripes |

---

## 9. Where it reaches

| Place | What changes |
|---|---|
| `lib/appearance.ts` | The five colours and three patterns; the translation of old statements (§6); the old-`coat` truth table; `normaliseColours` goes |
| `lib/observations.ts` | The new value shape; old-shape writes refused from now on; the author rules unchanged |
| `lib/resolve.ts` | Colours and pattern resolved separately, each with its own confidence and reasons (§4); the snapshot fields `coatColours` and `coatPattern` |
| `lib/catHelpers.ts` (`serialiseCat`, `deriveCatStatuses`) | The two new wire fields, and the old `coat` worked out for display |
| `lib/handPick.ts` (`handPickDisagrees`) | The spotter's own answer is read through the translation. A hand pick is flagged when it shares no colour with the cat's resolved colours, or when both patterns are known and differ |
| `lib/colourCheck.ts` | Reasons per part, including "spotters disagree on the pattern" and "colour and pattern from different sources" |
| `lib/teamCorrections.ts`, `lib/teamPages/appearancePage.ts`, `lib/teamCatView.ts`, the team strings | Correct as a form (checkboxes and radio buttons); Confirm states only the known parts; the new words; Correct on a guardian's statement retracts both parts |
| `lib/coatReading/` (`reader.ts`, `due.ts`, `record.ts`, `sweep.ts`) | Prompt coat-v2; the new answer shape; the `reread` setting and its guards; copy-forward in the new shape (§7) |
| The answers endpoint (`POST /sightings/{id}/answers`, SYC-2 PR 4.1) and `openapi.yaml` | The colour answer's request body is `{ colours, pattern? }` or `{ notSure: true }`; `coatColours` and `coatPattern` on the cat; `coat` kept |
| `.github/workflows/coat-readings.yml` | A `reread` choice, off by default |
| `artifacts/cat-spotter` | The drawn swatches, patterns and cat; the question; the two filter rows (SYC-161 PR 3); the cat-alog's filter (SYC-2 PR 4.3); the words; reading the new fields |
| Tests | The public payload snapshots (`publicPayload.p6.txt`, `cats.publicDetail.p3-2.txt`) gain `coatColours` and `coatPattern`, regenerated on purpose and recorded in the PR; `appearance.notNotifiable.test.ts`'s `SYC2_FIELDS`; every test that pins the eight codes or "one or two" |
| Documents | Everything listed at the top, and a `DECISIONS.md` entry |
| Johnny's pack (SYC-346, SYC-283) | Brown, Plain, Stripes, Patches, Can't tell; "What does {name} look like?", "Looks like this", "Not known", the hidden-cats line |

---

## 10. Tests

- **Translation:**
  - every row of §6's first table, including that *Tabby · White* gives colours not known;
  - an old statement's unknown parts never count as known.
- **Old `coat` for older phones:** every combination of the five colours and four pattern states against the truth table, including that Brown alone gives `[]` and Brown · White · Stripes gives `tabby · white`.
- **Write check:**
  - any combination of colours is accepted;
  - an unknown code is refused;
  - an old-shape write is refused;
  - a spotter answer without colours is refused unless it is `notSure`;
  - a team statement with neither part is refused;
  - a team *Not sure* is refused.
- **Who wins:**
  - each rule for each part, alone and in conflict;
  - a team statement of colours only, with the pattern falling through;
  - a pattern-only statement doesn't withdraw;
  - only `notSure` withdraws;
  - the newest AI row with a part absent leaves that part not known, even when an older row had it;
  - pattern ties go on the check list;
  - mixed sources go on the check list;
  - old and new statements from the same device count as one voice;
  - a later AI reading never beats the team.
- **Confirm** states only the known parts.
- **Mark wrong** retracts both parts.
- **Filter:**
  - the three-way placement in every combination of the two rows;
  - the Plain/Patches forgiveness for cats with White;
  - a cat without the new fields is Not known, never hidden;
  - the counts add up;
  - offline.
- **Snapshot and not-notifiable:** `coatColours` and `coatPattern` are the only coat fields on the snapshot, and neither is notifiable.
- **Hand pick:** translated answers; a shared colour means no flag; a pattern mismatch flags.
- **Reader:**
  - the prompt lists exactly the five colours and three patterns;
  - each *Not sure* case;
  - pattern unknown while the colours stand.
- **Re-read:**
  - an automatic run never lists or reads a cat for a version change;
  - a manual run writes at most once per photo per version;
  - rejected photos are skipped;
  - team-decided cats are skipped;
  - a reading that would lose a known part is held back;
  - copy-forward translates and keeps its version;
  - the re-checks honour the setting.
- **Drawn cat:** every combination renders, and the caption matches.
- **Words:** every new word in three languages, and no raw code ever shown.

Each test that guards a silent rule gets a mutation probe in its PR.

---

## 11. Decisions for Samuel

**Decision 1: the words people tap.** Settled in the brainstorm: drawn swatches and patterns, captions only (§12).

### Decision 2: when colour and pattern come from different sources

| Option | Benefits | Risks |
|---|---|---|
| **2A. Each part on its own, and the cat goes on the Colour check list (recommended)** | Each part uses the best evidence it has. The team sees every mixed coat and confirms it once | A coat nobody stated shows until the team looks; harmless, because both parts are visible on the photo |
| 2B. Both parts from the highest rule that states either | Never mixes sources | A spotter pair's colours would throw away the AI's pattern, leaving the pattern not known more often |

**Recommendation: 2A.**

### Decision 3: "Can't tell" on the pattern

| Option | Benefits | Risks |
|---|---|---|
| **3A. A *Can't tell* chip in the pattern row (recommended)** | A tourist who saw the colours but not the pattern answers honestly; two lazy taps of *Plain* can't outvote a real reading | One more chip |
| 3B. Pattern required | Every answer has a pattern | People guess *Plain*, and guesses outvote the AI |

**Recommendation: 3A.**

### Decision 4: breeders' names on the team's screen

| Option | Benefits | Risks |
|---|---|---|
| **4A. No: the team sees the same drawings and words (recommended)** | One vocabulary everywhere, which is why the cat words were dropped | Experienced volunteers lose a term they may use among themselves |
| 4B. Yes, beside the drawing ("Red tabby", "Calico") | Familiar to experts | Brings back the words Samuel rejected; three more translations if the team pages ever leave English |

**Recommendation: 4A.** Syros Cats can ask for 4B later.

### Decision 5: the drawings

| Option | Benefits | Risks |
|---|---|---|
| **5A. Claude draws simple shapes; Samuel judges them in the browser check (recommended)** | No waiting; easy to change | Plain-looking |
| 5B. Commission an illustrator | Polished | Cost and time; misses the launch |

**Recommendation: 5A**, with 5B later if wanted. Nothing else depends on it.

### Decision 6: timing

| Option | Benefits | Risks |
|---|---|---|
| **6A. Words to Johnny by Thu 22 October; build after approval; never blocks the 31 October launch (recommended)** | Johnny's check isn't the bottleneck. If the build isn't ready, "Find the cat" launches without colour chips, and cat pages keep showing today's colours through the translation | The chips may miss the launch |
| 6B. Hold the launch for it | Chips at launch | Puts the launch date at risk for a filter |

**Recommendation: 6A.**

---

## 12. What Samuel said (brainstorm, 16 October 2026)

- On the words: he wasn't sure of the difference between tortoiseshell, calico and tabby, nor confident users would be. "let's solve this first".
- On the limit: "why shouldn't a tabby have as many colours as it has, rather than a limit of two?"
- What felt wrong about naming: "Words are the wrong tool", and "Colour names are fuzzy".
- How to point: drawn cats (A), over real photos and fur swatches; "it needs to allow all colour combos"; "a cat that changes as you tap".
- He asked "is striped how cat experts describe it?". The answer: experts say *tabby*; *Stripes* is the plain-English caption, chosen for visitors.
- Cream: "don't separate cream from ginger". Tapping several colours: clear enough ("yes"). The filter: "pattern too".
- The design's sections 1, 2, 3 and 5: approved as presented. Section 4: "Re-read all 28 too".
- Plain or Patches: "Patches = any patchy look".

---

## 13. Not in this spec

- Breed, eye colour, coat length (*Long fur* stays a marking), and patterns finer than the three.
- Changes to markings.
- Using colour or pattern in matching.

---

## 14. Review outcome

An independent adversarial review (Sonnet, its own worktree) of the first draft, `299e0b7c`, found no outright blocker, 10 majors and 4 minors. All were accepted.

| # | Finding | What changed |
|---|---|---|
| 1 | Translating *Tabby · White* to White · Stripes made two live cats look known and hid them | §6: an old *Tabby* never makes White a known colour; the cat's colours are not known |
| 2 | *Black and white* → Plain invented a pattern, and Plain and Patches overlapped | §6 maps only what was said. Samuel ruled "any patchy look", and §5 makes the filter forgiving between Plain and Patches |
| 3 | The filter could fall back to the lossy old field | §5 and §6: the old field is only for display |
| 4 | The old-field rule was ambiguous and could show a brown tabby as "White" | §6: a full truth table, tested for every combination |
| 5 | The resolver wasn't defined for half statements, older AI rows, team statements without a pattern, pattern ties, or confidence per part | §4 defines each |
| 6 | Confirm would break on a half-known coat | §4: Confirm states only the known parts |
| 7 | Missing places: the hand-pick flag, the Colour check list, the team form (no scripts), `colour_filter_on`, data-spine sections, snapshots, the not-notifiable guard, SYC-2 4.x | All added to §3, §5, §6 and §9 |
| 8 | Re-read traps: cats due forever, "one call per version" untrue, the trial and write differing, the re-checks, the leaked-password bound | §7 rewritten |
| 9 | A re-read could quietly drop a known pattern | §7: held back unless every known part stays known |
| 10 | Spotters were forced to guess a pattern; the button labels clashed | §3 and Decision 3: *Can't tell*; Yes · Change · Skip kept on the pre-filled line |
| 11 | Samuel's verdicts were partly inferred, not quoted | §8 quotes his words and translates them through §6 |
| 12 | Greek and French drafts (*Tachetée* means spotted) and the join style | §2: nouns joined with " · " (E1); new drafts for Johnny |
| 13 | The filter's placement rule was unclear | §5: a three-step rule |
| 14 | Open questions lacked options, and SYC-397 was closed too early | §11 gives each decision options and a recommendation; SYC-397 closes when built |

---

## 15. Team words (amended 17 October 2026, SYC-443)

**Decision 4 is now 4B, on team screens only.** Asked whether team screens should use the old words (tabby, tortoiseshell, calico), Samuel said: **"yes team screens use old words"** (17 October 2026). He had also said "ginger tabby": an orange striped cat is a **Ginger tabby**, never a "Red tabby". Everywhere else is unchanged: the public app, the public API and the drawn cat keep §2's words (Black, Grey, Brown, Ginger, White; Plain, Stripes, Patches).

**Nothing stored changes.** A coat is still colours plus one pattern (§2), stored and resolved exactly as §4 and §6 say. The team words are only a way of *saying* a coat on team screens, worked out from the two parts each time a page is drawn. Changing the words later never touches the records.

### 15.1 Who sees the team words, and where

- **Who:** everyone signed in to the team dashboard (Decision T1).
- **Where:** every place a team screen says a coat:
  - the team cat page: the facts row at the top, the Appearance section's status rows, each statement, the history list and the drawn cat's caption;
  - the Colour check list;
  - the team's Correct form (its pattern buttons, Decision T3);
  - the Cats grid: each card's coat line, the photo's description for screen readers, and the Pattern filter when it is built (SYC-435);
  - cat guardians' own pages, if T1 is A (SYC-436 then uses the team words, not §2's).
- **Never:** the box headed **"What the public sees"** on the team cat page. It shows exactly what the public sees, so it keeps §2's words: "Ginger · Stripes", not "Ginger tabby". The public app and the public API never carry a team word.

The grid's **colour** filter stays the five colours. A colour is a colour in both vocabularies.

### 15.2 The words

**The pattern on its own** (status rows, pattern buttons, the grid's Pattern filter):

| Part | Team word | §2 word, unchanged for the public |
|---|---|---|
| `plain` | Solid | Plain |
| `stripes` | Tabby | Stripes |
| `patches` | Patched | Patches |
| not known | Not known | Not known |

**The whole coat** in one phrase (facts row, cards, Colour check rows, statements, the drawn cat's caption). The colours are §2's colour words, in §2's order, with only the first word capitalised. "Main colours" means the colours other than White.

| Pattern | Colours | Team words | Example |
|---|---|---|---|
| Stripes | none known | Tabby | Tabby |
| Stripes | White only | Tabby and white | Tabby and white |
| Stripes | main colours | {colours} tabby | Ginger tabby; Brown and ginger tabby |
| Stripes | main colours and White | {colours} tabby and white | Grey tabby and white |
| Patches | Ginger with Black, Grey or Brown, no White | Tortoiseshell | Tortoiseshell |
| Patches | Ginger with Black, Grey or Brown, and White | Calico | Calico |
| Patches | any other main colours, and White | {colours} and white | Black and white |
| Patches | any other main colours, no White | {colours}, patched | Black and grey, patched |
| Patches | White only | White, patched | White, patched |
| Patches | none known | Patched | Patched |
| Solid | main colours | {colours} | Black; Black and grey |
| Solid | main colours and White | {colours} and white | Ginger and white |
| Solid | White only | White | White |
| Solid | none known | Solid colour | Solid colour |
| not known | some known | {colours}, as Solid would say them | Ginger and white |
| not known | none known | Not known | Not known |

"{colours}" joins the colours with commas and a final "and": "Black, brown and ginger tabby".

The rows above are rules, not a list. Every one of the 32 colour sets × 4 pattern states gets exactly one phrase, and the build tests all 128.

### 15.3 Decisions for Samuel (team words)

#### Decision T1: who sees the team words

| Option | Benefits | Risks |
|---|---|---|
| **T1A. Everyone on the dashboard: the island-wide team and cat guardians (recommended)** | One vocabulary per page. Guardians are locals, and these are the words people on Syros use (SYC-435). SYC-436 becomes "use the team words" | Guardians see words §2 dropped for visitors. Harmless: they are the people who already use them |
| T1B. The island-wide team only; guardians get §2's words | Matches 4B's "team" most literally | The same page says a coat two ways depending on who is looking, and the build has to pass the viewer through every coat line |

**Recommendation: T1A.**

#### Decision T2: the team words instead of §2's, or beside them

| Option | Benefits | Risks |
|---|---|---|
| **T2A. Instead of (recommended)** | One phrase per coat ("Calico"). The Appearance status rows still give each part on its own (Colours: Black · Ginger · White; Pattern: Patched), so nothing is hidden | A team member can't see the public's phrase except in the "What the public sees" box. That box is right there on the same page |
| T2B. Beside: "Calico (Black · Ginger · White · Patches)" | Both at once | Twice the text on cards and rows; brings back the two-vocabulary muddle Samuel wanted gone |

**Recommendation: T2A.**

#### Decision T3: the pattern buttons on the team's Correct form

| Option | Benefits | Risks |
|---|---|---|
| **T3A. The team words, each with a short hint (recommended):** *Solid (one colour, maybe a little white)*, *Tabby (stripes, swirls or spots)*, *Patched (tortoiseshell, calico, black and white…)*, *Not stated* | The form speaks the page's language; the hints keep Patches = "any patchy look" clear | Longer labels; checked at 390 px in the build |
| T3B. Keep Plain, Stripes and Patches on the form | No change to PR B's form | The form says "Stripes" and the page says "Tabby" right beside it |

**Recommendation: T3A.**

#### Decision T4: Greek and French

Team pages are served in English only until Johnny signs off Greek and French (SYC-291). Phrases like "Brown and ginger tabby and white" can't be built word by word in Greek or French: the adjectives agree and the order changes.

| Option | Benefits | Risks |
|---|---|---|
| **T4A. The team words are English only. A team page drawn in Greek or French says the coat in §2's words, already with Johnny (recommended)** | Nothing new for Johnny before the 22 October freeze; nothing wrong can show | When Greek and French go live, a Greek page says "Πορτοκαλί · Ρίγες", not a Greek "ginger tabby". A second pack can add them later |
| T4B. Write Greek and French team phrases now | Full parity | Hard grammar, new work for Johnny inside the freeze week, and nobody sees it until SYC-291 |

**Recommendation: T4A.**

#### Decision T5: the unclear cases

| Case | Recommended wording | Alternative |
|---|---|---|
| Black and Ginger, Stripes | **"Black and ginger tabby"** (the general rule) | "Torbie", the experts' word: jargon even to most volunteers |
| Grey and Ginger, Patches | **"Tortoiseshell"**, or "Calico" with White | "Dilute tortoiseshell": correct for experts, unfamiliar to most |
| Pattern not known | **The colours alone**: "Ginger and white". The status row says "Pattern: Not known" | "Ginger and white, pattern not known" on every card: clearer, but long |
| Plain, colours not known | **"Solid colour"** | "Not known" (hides that the pattern *is* known) |

**Recommendation:** the bold wording in each row.

### 15.4 What else changes

- **SYC-436** (guardian pages): with T1A, guardians get the team words. Their pages move off the old public field either way.
- **SYC-435** (the grid's Pattern filter): its chips are *Solid · Tabby · Patched · Not known*.
- **PR B's drawn cat** keeps the drawing; its caption becomes the team phrase.
- **The SYC-396 facts row** (`catFacts.ts`, `coatWordsOf`) calls the one team-words function instead of joining §2's words.
- **One function** turns a coat's two parts into the team phrase, and one gives the team's pattern word. Every team screen calls them, so the wording lives in one place.
- **Timing:** built after PR B merges, as its own PR. Never blocks the 31 October launch (6A stands).

### 15.5 Tests

- All 128 combinations of colours and pattern give exactly one phrase, matching §15.2, with no "undefined" or raw code.
- Every team screen in §15.1 shows the team phrase; "What the public sees" shows §2's line.
- **The public never sees a team word:** the public cat list, a cat's page data and the name-taken reply never contain "tabby" (outside the old `coat` codes kept for older phones, §6), "tortoiseshell", "calico", "solid" or "patched" as display words. The public payload snapshots are unchanged.
- The team's Correct still writes `plain`, `stripes` or `patches`, whatever the button says.
- Greek and French (T4A): a team page drawn in either shows §2's words.
