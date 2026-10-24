# Coat colours that people (and the AI) can tell apart

**Ticket:** SYC-696.
**Decided with Samuel** on 24 October 2026, after the coat backfill (SYC-697). His answers are quoted in §9.
**Amends:** `coat-colours-and-pattern.md` §2 (the colour words and meanings), §7 (the reader's prompt) and §15 (team words); the SYC-161 plan's re-read rules (a new reader version, run by hand as SYC-398 §7 allows).
**Status:** draft for adversarial review, then Samuel's approval. No code until it is approved.

---

## 1. In plain English

The five coat colours stay five, but two of them mean something different and three get new words:

| Today | From now on | What it covers |
|---|---|---|
| Black | **Black or dark grey** | Black, and charcoal or dark grey that looks black in the shade. Dark stripes on a tabby count here |
| Grey | **Light grey** | Pale, silvery or blue-grey: a cool, light coat |
| Brown | Brown | Warm brown, sandy or golden-brown (unchanged) |
| Ginger | **Ginger or cream** | Orange, apricot, and pale cream that is washed-out ginger |
| White | White | White (unchanged) |

You still tick **every colour you can see**, stripes included (Samuel, decision 1). A brown tabby with dark stripes is *Black or dark grey · Brown · Stripes*.

The colour reader (the AI that reads each cat's main photo) gets clearer instructions for the two pairs it confuses most. Before any new reading is saved, it reads every photo **three times** with the new instructions, and we measure how often each colour comes and goes. If light grey and brown still swap on more than a few cats, Samuel decides whether to merge them (decision 3).

---

## 2. Why: what the 24 October backfill showed

On 24 October the reader (`coat-v2`) read the main photo of every logged cat twice, once in a trial and once in the save (workflow runs 40111719781 and 40114971095). Samuel then checked every result on a contact sheet. Of the 23 cats that got two readings:

| Colour | Cats where it came and went between the two reads | Which cats |
|---|---|---|
| Grey | 5 | 6, 8, 15, 27, 29 |
| Black | 2 | 5, 8 |
| Ginger | 1 | 8 |
| Brown | 1 | 7 |
| White | 1 | 14 |

What a person sees in those photos (Claude looked at each one full-size; Samuel's corrections agree):

1. **Black vs dark grey.** Cats 3, 4, 16 and 26 have charcoal coats or patches that look black in the shade and grey in the sun. Samuel corrected cat 3 to grey; the reader said grey for cat 4 where the dashboard had said black.
2. **Grey vs brown on tabbies.** Cats 6, 8, 15, 27 and 29 have a coat between silvery and sandy. Sunlight pushes it either way. This is the most frequent flip.
3. **Pale ginger or cream.** Cat 18 (cream and white) was read as brown and Samuel corrected it to ginger; cat 7 (cream, darker ears) came back first with brown, then without. The prompt already says cream is ginger, but the word "Ginger" alone doesn't say it to a person, and the drawing shows a strong orange.

Plain ginger, plain black and white were stable everywhere.

---

## 3. The codes stay; the words and meanings change

The stored codes stay `black`, `grey`, `brown`, `ginger`, `white`. Only what `black`, `grey` and `ginger` **mean** and how they are **worded** changes.

**Why keep the codes.**
- No data migration: nothing in `observations` is rewritten, which the append-only rule (`teamCorrections.ts` header) wants anyway.
- No API change: the `coatColours` enum in `lib/api-spec/openapi.yaml`, the generated `lib/api-zod` and `lib/api-client-react` types, and the app's `COLOURS` list stay as they are, so phones on older app versions keep working.
- The old `coat` field for older phones (`legacyCoatCodes`) needs no new code.
- Saved dashboard links like `?colours=black` keep working.

**The cost.** A code name no longer says exactly what it means: `black` means black or dark grey, `grey` means light grey. `appearance.ts`, next to `COAT_COLOURS`, says so in a comment, and this spec is the reference. Renaming the codes is out of scope (§8).

**Old apps.** A phone that hasn't updated keeps showing the old words (Black, Grey, Ginger) until it does. The codes underneath are the same, so its filters still find the right cats.

---

## 4. Words

The Greek and French are drafts for Johnny (SYC-283), like every coat word.

| Code | English | Greek (draft) | French (draft) |
|---|---|---|---|
| `black` | Black or dark grey | Μαύρο ή σκούρο γκρι | Noir ou gris foncé |
| `grey` | Light grey | Ανοιχτό γκρι | Gris clair |
| `brown` | Brown | Καφέ | Brun |
| `ginger` | Ginger or cream | Πορτοκαλί ή κρεμ | Roux ou crème |
| `white` | White | Λευκό | Blanc |

**Where the words appear** (each place reads them from its strings file; nothing else hard-codes them):
- the app: `artifacts/cat-spotter/lib/i18n.ts` (`coat_black`, `coat_grey`, `coat_ginger`, in all three languages): the Find-the-cat colour chips and every coat line;
- team pages: `artifacts/api-server/src/lib/teamPages/strings/{en,el,fr}.ts` (`coat.black`, `coat.grey`, `coat.ginger`): the Correct form's colour ticks, the Cats grid and Find-a-photo filter chips;
- team coat sentences (`teamCoatWords.ts`, spec §15). These build phrases like "Black, grey and white". With the longer words they become "Black or dark grey, light grey and white". The breeders' words on team screens (Decision 4B: *Tortoiseshell*, *Calico*, *Ginger tabby*) are unchanged, and still keyed on the same codes.

**Long chips.** "Black or dark grey" is the longest chip label in any language (Greek: 19 characters). The chips wrap their text at phone width rather than cut it off. Checked at 390 px and desktop before the PR leaves draft.

---

## 5. Drawings and swatches

The drawn cat and the colour swatches carry the meaning more than the words do, so two fills change:

| Code | Today | New | Why |
|---|---|---|---|
| `black` | `#2b2b2b` | `#2b2b2b` (unchanged) | Black or dark grey reads as near-black |
| `grey` | `#8d929a` | `#c3c7cd` | Lighter, so the swatch says *light* grey and stands apart from black |
| `ginger` | `#e38b3a` | `#e9a25a` | A little paler, so cream cats look like they belong |

Both copies of the fills change together: `artifacts/api-server/src/lib/teamPages/coatDrawing.ts` (`FILL`) and `artifacts/cat-spotter/components/coat/palette.ts` (`FILL`). The stripe rule (pale stripes on a black base) is unchanged. Every new fill keeps at least 3:1 contrast against the outline and against the swatch background, in light and dark mode; the PR checks this.

---

## 6. The colour reader: `coat-v3`

**The prompt's colour list** (in `reader.ts`, `COLOUR_DESCRIPTIONS`):

- `black`: "black, or a dark charcoal grey that would look black in the shade. Dark stripes on a striped coat count here"
- `grey`: "a light, cool grey: pale, silvery or blue-grey"
- `brown`: "warm brown, sandy or golden-brown. A warm sandy brown is brown, not ginger" (unchanged)
- `ginger`: "ginger, orange, apricot, or pale cream"
- `white`: unchanged

and one added line after the list: *"Grey or brown: a cool, silvery coat is grey; a warm, sandy coat is brown. Give both only if you can clearly see both."*

`MODEL_VERSION` becomes `${VISION_MODEL}/coat-v3`. Everything else about the reader is unchanged: the answer shape, the cut-off, the one-cat rule, the budgets, and SYC-398 §7's guards on a re-read (a re-read never removes a part the cat already shows, and never touches a coat the team or a guardian decided).

### 6.1 The test before anything is saved (decision 3)

After the PR is published (and before any `write`):

1. Three **trial** runs (`mode=trial`, `reread=true`) of every cat, at least an hour apart so the hourly budget (60 calls) isn't hit. Trials write nothing. Each photo gets 3 attempts a day (`coat-read-photo`), so the three trials use the whole day's allowance and the save comes the next day.
2. For each colour, count the single-cat photos where it appears in some reads but not all three.
3. Report to Samuel, beside today's baseline (§2), as one table plus the contact sheet.

**The rule we agreed:**
- **Light grey and brown stay apart** if `grey` flips on **3 or fewer** of the single-cat photos (today: 4 of 21 single-cat photos over just two reads: cats 6, 8, 15 and 29; cat 27's photo shows two cats).
- If it flips on more, nothing is saved yet. Samuel decides between merging grey and brown, or another round of prompt changes.
- If `black` or `ginger` flips on more cats than in the baseline, that is reported too, before any save.

### 6.2 The save

Once Samuel approves the trial results: one `write` run with `reread=true`, excluding any cats he rejects, then the contact-sheet check as on 24 October. The save calls the model again, so its answers are compared with the third trial's, and any differences are reported before the job is called done.

---

## 7. Coats people already saved

Re-reading fixes the reader's own rows. People's statements are different: they were saved under the old meanings, and a re-read never overrides them.

On 24 October the live data held 8 team statements and no guardian or spotter statements. Two of the team statements use `grey`:
- **cat 3** (grey, white, patches). Under the new words this shows as *Light grey*. Its patches look charcoal in the photo, so Samuel probably means *Black or dark grey*;
- **cat 5** (grey, brown, ginger, white, patches).

Samuel re-confirms these two on the team page after the publish (one tap each). Nothing changes them automatically, because only the person who said it knows which grey they meant. The one team statement with `black` (cat 24) needs no change: black is still inside *Black or dark grey*.

Statements made after the publish use the new meanings.

---

## 8. Not in this change

- **Renaming the codes** (e.g. `dark`, `light_grey`). That would mean rewriting saved coats, changing the API and older phones' behaviour, for no visible gain.
- **Merging grey and brown.** Only if the test in §6.1 says so, and then as its own decision.
- **Not counting stripes.** Considered and dropped (Samuel changed his mind, §9).
- Markings, patterns and the "Not sure" rules.

---

## 9. Samuel's decisions (24 October 2026)

- On the problem: "the distinction btw grey and black is pretty hard. I think we should combine the two colours."
- Scope: "broaden this out and, based on the cats already logged so far, consider whether other colours are confusing (if necessary using AI) - e.g. light brown vs ginger".
- Names: "Black or dark grey; leave light grey separate".
- Decision 1, whether stripes count as a colour: first "No, the coat colour only", then "I've changed my mind. stripe colours should count too". **Stripes count.**
- Decision 2, pale ginger or cream: "Ginger becomes 'Ginger or cream'".
- Decision 3, grey vs brown on tabbies: "Keep them apart, test first".

---

## 10. Tests

- `reader.test.ts`: the prompt lists the new descriptions and the grey-or-brown line; `MODEL_VERSION` ends `coat-v3`. A cat last read by `coat-v2` is due only on a `reread` run (the existing SYC-398 §7 tests, unchanged).
- Strings: every language has the three new words, and no team page or app screen shows "Grey" or "Ginger" alone.
- `teamCoatWords.test.ts`: the sentences with the new words, including all-five-colours and the breeders' words on team screens.
- Drawings: the new fills in both `FILL` tables, and the contrast check from §5.
- Snapshots and golden tables that print the words (`teamCoatGolden.ts`, the coat page tests) are updated, not deleted.
- No test that stores or compares codes changes, because the codes don't.
