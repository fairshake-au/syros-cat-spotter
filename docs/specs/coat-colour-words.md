# Coat colours that people (and the AI) can tell apart

**Ticket:** SYC-696.
**Decided with Samuel** on 24 October 2026, after the coat backfill (SYC-697). His answers are quoted in §11.
**Revised** after an independent adversarial review (`reviews/coat-colour-words-review.md`, 2 blockers, 11 should-fixes, 7 nits); §12 says how each was handled.
**Amends:**
- `coat-colours-and-pattern.md`: §2 (the colour meanings and word table, lines 44–62), §7 (the reader's prompt), §15 (team words) and §15.6 (the approved table of 128 team phrases);
- `DECISIONS.md` Part 2n (lines 310 and 315: the colour list and the "Grey tabby with white" example), with a dated entry on approval;
- `team-dashboard-redesign.md` line 242 (the chip list);
- the SYC-161 plan's re-read rules (a new reader version, run by hand as SYC-398 §7 allows).

**Status:** revised draft. **One decision is still open** (§7, the tortoiseshell names), waiting on expert research. Then Samuel's approval. No code until then.

---

## 1. In plain English

Nothing already saved is rewritten. The five coat colours stay five, but two of them mean something different and three get new names:

| Today | From now on | What it covers |
|---|---|---|
| Black | **Black or dark grey** | Black, charcoal, and any mid or dark grey (what breeders call "blue"). The dark stripes on a tabby count here |
| Grey | **Light grey** | Only pale, silvery grey |
| Brown | Brown | Warm brown, sandy or golden-brown (unchanged) |
| Ginger | **Ginger or cream** | Orange, apricot, and pale cream |
| White | White | White (unchanged) |

You still tick **every colour you can see, stripes included**. A brown tabby with dark stripes is *Black or dark grey · Brown · Stripes*.

**What people will notice:**
- the colour chips and tick boxes use the longer names; sentences on team pages use short words ("Ginger tabby", "Light grey tabby with white");
- the light grey swatch is paler, and ginger slightly softer;
- tapping **Black or dark grey** to find a cat also shows most tabbies, because their stripes are dark. Samuel accepted this (§11);
- the drawn cat for a tabby shows its coat colour with dark stripes, not a black cat with brown spots (§5);
- for about a day after the release, around five cats show the wrong new name until the AI re-reads them (§9).

**The AI** (the colour reader that reads each cat's main photo) gets clearer instructions. Before it saves anything, it reads every photo three times with the new instructions, and we measure how often each colour comes and goes. If light grey and brown still swap on more than 3 cats, Samuel decides whether to merge them, before anything is saved.

**One job for Samuel** after the release: re-check his own saved coats that use grey or have stripes (§8).

Colour still feeds nothing else: not matching sightings to cats, not notifications (`appearance.notNotifiable.test.ts`). A re-read pings nobody.

---

## 2. Why: what the 24 October backfill showed

On 24 October the reader (`coat-v2`) read the main photo of every logged cat twice: a trial at 16:28 UTC, and the save at 17:11 UTC (workflow runs 40111719781 and 40114971095). Samuel checked every result on a contact sheet. Of the 23 cats with two readings, a colour came and went between the two reads on:

| Colour | Cats | Which |
|---|---|---|
| Grey | 5 | 6, 8, 15, 27, 29 (27's photo shows two cats, so it never showed) |
| Black | 2 | 5, 8 |
| Ginger | 1 | 8 |
| Brown | 1 | 7 |
| White | 1 | 14 |

Over the single-cat photos (a photo counted as one cat in both reads), grey flipped on **4 of 20**: cats 6, 8, 15 and 29.

What a person sees in those photos (Claude looked at each one full-size; Samuel's corrections agree):
1. **Black vs dark grey.** Cats 4 and 16 have charcoal coats that look black in the shade and grey in the sun; cats 3 and 26 have charcoal patches. The reader said grey for cat 4 where the dashboard had said black.
2. **Grey vs brown on tabbies.** Cats 6, 8, 15 and 29 have a coat between silvery and sandy. Sunlight pushes it either way. This is the most frequent flip.
3. **Pale ginger or cream.** Cat 18 (cream and white) was read as brown, and Samuel corrected it to ginger. Cat 7 (cream, darker ears) came back first with brown, then without. The prompt already says cream is ginger, but the word "Ginger" on its own doesn't say it to a person.

Plain ginger, plain black and white were stable everywhere.

---

## 3. The codes stay; the names and meanings change

The stored codes stay `black`, `grey`, `brown`, `ginger`, `white`. Only what `black`, `grey` and `ginger` **mean** and how they are **named** changes.

**Why keep the codes.**
- No data migration: nothing in `observations` is rewritten.
- No API change: the `coatColours` enum, the generated `lib/api-zod` and `lib/api-client-react` types and the app's `COLOURS` list stay as they are.
- Saved dashboard links like `?colours=black` still load. Their meaning moves with the new names: `?colours=grey` now finds light grey cats only.

**The cost.** A code name no longer says exactly what it means: `black` means black or dark grey, `grey` means light grey, `ginger` includes cream. That is written down in three places: a comment next to `COAT_COLOURS` in `appearance.ts`, the `coatColours` description in `lib/api-spec/openapi.yaml`, and this spec. Renaming the codes is out of scope (§10).

**Older phones.** A phone that hasn't updated keeps the old names. Its *Grey* chip is the code `grey`, which now means light grey, so a dark grey cat (saved as `black`) won't be in its main results. It appears under the "more cats nearby in other colours" line. That lasts until the phone updates. Before launch, check that the app's minimum-version prompt covers this release.

---

## 4. Names

### 4.1 On chips and tick boxes: the long names

The Greek and French are drafts for Johnny (SYC-283), like every coat word.

| Code | English | Greek (draft) | French (draft) |
|---|---|---|---|
| `black` | Black or dark grey | Μαύρο ή σκούρο γκρι | Noir ou gris foncé |
| `grey` | Light grey | Ανοιχτό γκρι | Gris clair |
| `brown` | Brown | Καφέ | Brun |
| `ginger` | Ginger or cream | Πορτοκαλί ή κρεμ | Roux ou crème |
| `white` | White | Λευκό | Blanc |

They come from the strings files:
- the app: `artifacts/cat-spotter/lib/i18n.ts` (`coat_black`, `coat_grey`, `coat_ginger`, in all three languages). These are the Find-the-cat colour chips and the public coat line;
- team pages: `artifacts/api-server/src/lib/teamPages/strings/{en,el,fr}.ts` (`coat.black`, `coat.grey`, `coat.ginger`). These are the Correct form's colour ticks and the Cats grid and Find-a-photo filter chips.

**Chips don't wrap today.** `CoatChips.tsx:106` sets `numberOfLines={1}`, so a long label would be cut off with "…". The PR removes that limit, so a chip grows to two lines rather than lose words. Checked at 390 px and at desktop width, in all three languages, before the PR leaves draft.

### 4.2 In sentences: short words (decision 5)

Team pages build sentences such as "Grey tabby with white" in `teamCoatWords.ts`. That file uses the code names as words today (`:82-93`), not the strings files. With the long names, sentences would read "Black or dark grey and ginger or cream tabby with white", which sounds like a choice between colours.

So sentences use **short words**, from a word table in `teamCoatWords.ts` itself (not the code names):

| Code | Word in a sentence |
|---|---|
| `black` | black |
| `grey` | light grey |
| `brown` | brown |
| `ginger` | ginger |
| `white` | white |

Examples: "Ginger tabby", "Light grey tabby with white", "Black, light grey and white, solid".

**The approved table changes.** Samuel approved all 128 team phrases (`coat-colours-and-pattern.md` §15.6, checked by `__fixtures__/teamCoatGolden.ts`). Every row containing `grey` changes ("grey" becomes "light grey"), and so do any rows the tortoiseshell decision (§7) touches. The implementation plan lists every changed row, old beside new, for Samuel to approve before the code changes. No other wording changes.

The coat line on the **public** cat page and card stays the joined list from parent §2 (colours, then pattern, joined with " · "), using the long names.

---

## 5. Drawings and swatches

### 5.1 Fills

| Code | Today | New | Why |
|---|---|---|---|
| `black` | `#2b2b2b` | `#2b2b2b` (unchanged) | Black or dark grey reads as near-black |
| `grey` | `#8d929a` | `#a3a9b1` | Lighter, so the swatch says *light* grey |
| `ginger` | `#e38b3a` | `#e9a25a` | A little paler, so cream cats look like they belong |

Both copies change together: `teamPages/coatDrawing.ts` (`FILL`) and `artifacts/cat-spotter/components/coat/palette.ts` (`FILL`).

**What tells the swatches apart.** Every swatch has a 1.5 px `#3b3934` outline. New grey is 4.9:1 against that outline. Against its neighbours, new grey is 6.0:1 against black, 2.5:1 against brown, 2.3:1 against white, and 1.8:1 against the "colours not known" fill (`#e4e0d8`), which is also drawn with a dashed outline. Pale fills against the cream page background are low contrast today and stay so. The outline, not the fill, is what makes a swatch visible. Checked at the real 20–22 px swatch size, in light and dark mode.

### 5.2 Tabbies: draw the coat, not the stripes (decision 1, kept)

Today the drawing's base colour is the first colour that isn't white, in table order (`coatDrawing.ts:109-112`, `DrawnCat.tsx:86-88`). Black is first, so a brown tabby saved as *Black or dark grey · Brown · Stripes* is drawn as a black cat with brown spots. This already happens on 24 October's data: cats 6, 14, 20 and 29.

**New rule**, in both copies: when the pattern is **Stripes** and the coat has black plus another non-white colour, the base is that other colour (the first in table order after black), and the stripes are drawn dark. A cat that is only black (and white), with stripes, is still drawn on a black base with pale stripes, as today.

**Older phones' coat field.** `legacyCoatCodes` (`appearance.ts:132-135`) sends a black-and-brown tabby as `["black","tabby"]`, which older apps show as a black tabby. New rule: for Stripes, leave `black` out of the legacy codes when `brown`, `grey` or `ginger` is also present. Its truth-table test gains those rows.

---

## 6. The colour reader: `coat-v3`

**The prompt's colour list** (`reader.ts`, `COLOUR_DESCRIPTIONS`):
- `black`: "black, charcoal, or any mid or dark grey (what breeders call blue). The dark stripes on a striped coat count here"
- `grey`: "only a pale, light, silvery grey"
- `brown`: "warm brown, sandy or golden-brown. A warm sandy brown is brown, not ginger" (unchanged)
- `ginger`: "ginger, orange, apricot, or pale cream"
- `white`: unchanged

plus one line after the list: *"Grey or brown: a cool, pale silvery coat is grey; a warm, sandy coat is brown. Give both only if you can clearly see both."*

`MODEL_VERSION` becomes `${VISION_MODEL}/coat-v3`. Everything else about the reader is unchanged: the answer shape, the cut-off, the one-cat rule, the budgets, and SYC-398 §7's re-read guards. A re-read is held back when it would come back a whole Not sure, or would leave a part not known that the cat shows now. It never touches a coat the team or a guardian decided. A change from `grey` to `black` is not a loss, so it is written.

### 6.1 The test before anything is saved (decision 3)

All runs below are started by hand from the `coat-readings` workflow. **No `write` run of any kind** (with or without `reread`) happens between the release and Samuel's approval of the test.

1. **Which cats.** First a `dry_run` with `reread=true` (no AI calls). It lists the cats the test will read. Cats the team has decided are skipped, so this list is smaller than 24 October's. The baseline in §2 is recomputed over **exactly these cats**, so the two numbers compare like with like.
2. **When.** Each photo gets 3 AI attempts in any 24 hours, on a rolling window (`coat-read-photo`). The 24 October runs used 2 of them, so the first trial starts after **17:15 UTC on 25 October** at the earliest. Up to about 30 cats, two trials fit inside the hourly budget (60 calls); the third waits for it.
3. **Three trials** (`mode=trial`, `reread=true`). Trials write nothing.
4. **Measure, pair by pair.** For each colour, compare reads 1 and 2, 2 and 3, and 1 and 3, and average the number of single-cat photos (counted as one cat in every read) where the colour differs. That compares directly with the two-read baseline. A photo with fewer than three successful reads (a failed call still uses an attempt) is listed apart and not counted as stable.
5. **Report to Samuel**: one table (each colour, baseline vs new), plus the contact sheet.

**The bar we agreed:**
- **Light grey and brown stay apart** if grey flips on **3 or fewer** photos (pair-averaged). Today's baseline is 4 of 20 over two reads.
- If grey flips on more, nothing is saved. Samuel decides between merging grey and brown, or another round of changes to the instructions.
- If black or ginger flip on more photos than in the baseline, that is reported too, before any save.
- With about 20 photos, one cat either side of the line is chance. The count guides the decision; the contact sheet decides it.

### 6.2 The save

When Samuel approves the test: one `write` run with `reread=true`, at least 24 hours after the **first** trial (the per-photo allowance), excluding any cats he rejects. Then a contact-sheet check, as on 24 October. The save calls the AI again, so its answers are compared with the third trial's. Any differences, and every **held-back** cat whose current coat still says `grey` or `black` from an older reading, are listed as "old meaning" for Samuel to correct on the team page. That includes the two-cat photos (cats 3, 13, 26, 27 and 28 on 24 October), which the AI will keep answering Not sure.

---

## 7. Tortoiseshell and calico names on team pages: OPEN

Team pages call a patched cat with black and ginger *Tortoiseshell* (no white) or *Calico* (with white) (parent §15, Decision T5A: "never calls a sandy-brown patchy cat a tortoiseshell"). With the new meanings, black also covers dark grey and dark stripes, and ginger covers cream. So the rule would now also name:
- a dark-grey-and-cream patched cat (what breeders call a dilute calico or blue-cream);
- a brown tabby with ginger patches, whose dark stripes count as black. T5A ruled this out.

Samuel asked for expert research before deciding (24 October). The options and the research go here once it is back. Whatever he decides is reflected in the changed rows of the 128-phrase table (§4.2) and in `legacyCoatCodes`'s `tortoiseshell_or_calico` (`appearance.ts:131`).

---

## 8. Coats people already saved

Re-reading fixes the reader's own rows. People's statements are different: they were saved under the old meanings, and a re-read never overrides them.

On 24 October the live data held 8 team statements, all by Samuel, and no guardian or spotter statements (live database, 24 October). Each needs a look against both changes: the new meaning of grey, and "stripes count".

| Cat | Saved | Why check |
|---|---|---|
| 3 | grey, white · patches | Its patches look charcoal. Probably *Black or dark grey* now |
| 5 | grey, brown, ginger, white · patches | Which grey? |
| 13 | brown | Fine (no grey, no pattern) |
| 18 | ginger, white · patches | Fine |
| 19 | patches (colours from the AI) | Fine |
| 24 | black, white · patches | Fine: black is inside *Black or dark grey* |
| 26 | brown, white · patches | Fine. A patched coat with stripes: say black only if the stripes are dark |
| 28 | white · patches | Fine |

**How to re-check:** open the cat's page, **Change the coat or markings**, and tick what you mean. Swap the grey tick for *Black or dark grey* if that's the one. **Don't use "That's right"** to confirm: it re-saves the value shown, so `grey` would be locked in as light grey. This list goes on SYC-696 in Linear so it isn't kept only here.

Statements made after the release use the new meanings.

---

## 9. One release

Samuel chose one release for the names, the swatches, the drawing rule and the new AI instructions (decision 7). For the day or so between the release and the save, cats whose current reading is an old v2 `grey` show as **Light grey** even when they're charcoal. On 24 October that was cats **4, 6, 8, 19 and 29**. Cat 4 is the clear case: a charcoal-and-white cat shown as light grey, and missing from the *Black or dark grey* filter until the save. Accepted.

---

## 10. Not in this change

- **Renaming the codes** (e.g. `dark`, `light_grey`). That would mean rewriting saved coats and changing the API and older phones' behaviour, for no visible gain.
- **Merging grey and brown.** Only if the test in §6.1 says so, and then as its own decision.
- **Not counting stripes.** Considered twice and dropped (§11).
- Markings, patterns and the "Not sure" rules.
- The future "{name} looks {colours}, right?" question (`i18n.ts:805-810`, not wired yet). When it is built (Slice 4), it uses the short sentence words from §4.2.

---

## 11. Samuel's decisions (24 October 2026)

- The problem: "the distinction btw grey and black is pretty hard. I think we should combine the two colours."
- Scope: "broaden this out and, based on the cats already logged so far, consider whether other colours are confusing (if necessary using AI) - e.g. light brown vs ginger".
- Names: "Black or dark grey; leave light grey separate".
- **Decision 1, stripes count as a colour.** First "No, the coat colour only", then "I've changed my mind. stripe colours should count too". After the review showed him that most tabbies would then match *Black or dark grey*: "Count them, but fix the drawing".
- **Decision 2, pale ginger or cream:** "Ginger becomes 'Ginger or cream'".
- **Decision 3, grey vs brown on tabbies:** "Keep them apart, test first".
- **Decision 5, words in team sentences:** "Short words in sentences".
- **Decision 6, mid grey ("blue"):** "Black or dark grey".
- **Decision 7, rollout:** "Everything in one release".
- **Decision 4, tortoiseshell and calico:** "do some expert research and present it back to me to help decide this". Open (§7).

---

## 12. The review, and what changed

| # | Finding | Done |
|---|---|---|
| 1 | Team sentences use code names, not strings; long names read as a choice | §4.2: short-word table; changed rows go to Samuel (decision 5) |
| 2 | Stripes as black: tabbies drawn black, filter matches tabbies, old phones show "black tabby" | Samuel kept stripes (decision 1); §5.2 fixes the drawing and the legacy codes; §1 says what people will see |
| 3 | Old readings shown under new names until the save | Samuel chose one release; §9 names the cats and accepts it |
| 4 | "That's right" would lock in the wrong grey; all statements need checking | §8: all 8 listed; re-check via Change, not "That's right" |
| 5 | Trial skips team-decided cats, so baseline differs | §6.1 step 1: dry run first, baseline recomputed on the same cats |
| 6 | Three reads vs two isn't a fair comparison | §6.1 step 4: pair-by-pair average; chance stated |
| 7 | Budget timing | §6.1 step 2, §6.2: rolling windows, earliest start, no write before approval |
| 8 | 3:1 contrast claim false; light grey vs "not known" | §5.1: new grey `#a3a9b1`, real ratios, the outline carries it |
| 9 | Mid grey had no home | §6: mid grey is *Black or dark grey* (decision 6) |
| 10 | New meanings widen Tortoiseshell/Calico | §7: open, research requested |
| 11 | "Old apps still find the right cats" was wrong | §3: the honest version |
| 12 | Missing documents in Amends | Header |
| 13 | Held-back re-reads keep the old meaning silently | §6.2: listed as "old meaning" on the contact sheet |
| 14–20 | Nits: chips cut off, links change meaning, OpenAPI description, single-cat definition, colour feeds no matching, future question, plain §1 | §4.1, §3, §3, §2, §1, §10, §1 |

---

## 13. Tests

- `reader.test.ts`: the prompt has the new descriptions and the grey-or-brown line; `MODEL_VERSION` ends `coat-v3`. A cat last read by `coat-v2` is due only on a `reread` run (the existing SYC-398 §7 tests, unchanged).
- Strings: every language has the three new long names. No chip or tick shows "Grey" or "Ginger" alone.
- `teamCoatWords.test.ts` and the golden table: every changed row, exactly as Samuel approves it (§4.2).
- Drawing, in both copies: black + brown + stripes is drawn on a brown base with dark stripes; black + white + stripes is still a black base with pale stripes; the new fills.
- `legacyCoatCodes` truth table: new rows for stripes with black plus brown, grey or ginger.
- `CoatChips`: a long label is not cut off (no `numberOfLines` limit).
- No test that stores or compares codes changes, because the codes don't.
