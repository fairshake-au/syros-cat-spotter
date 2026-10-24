# Adversarial review: `coat-colour-words.md` (SYC-696)

Reviewer: Opus, independent pass, 24 October 2026, against draft `4262058b`.
Evidence: the repo at that commit, plus the JSON output of GitHub runs 40111719781 (trial, 16:28 UTC) and 40114971095 (write, 17:11 UTC, `exclude: [18, 22]`), read with `gh run view --log`. I could not see the live database, so claims about stored statements are marked **unchecked**, not wrong.

Summary: 2 blockers, 11 should-fix, 7 nits. The main idea (keep the codes, change the words) is sound for storage, the API and filters. It breaks in three places the draft says are unchanged: the team's coat sentences, the drawn cat, and the two days between the publish and the save.

---

## Blockers

### 1. Blocker: the team's coat sentences don't come from the strings files, and the draft contradicts itself about them

- **Claim (§4):** "each place reads them from its strings file; nothing else hard-codes them", and team sentences "become 'Black or dark grey, light grey and white'", while "the breeders' words … *Ginger tabby* … are unchanged". §10 then says "no team page or app screen shows 'Grey' or 'Ginger' alone".
- **Evidence:**
  - `artifacts/api-server/src/lib/teamPages/teamCoatWords.ts:82-93` builds English team phrases from the **code names themselves** (`listed(colours)`, then `capital(...)`). It never reads `coat.*` strings. The header at `:11-13` says so: "The phrases are English constants, not catalogue keys". Changing `strings/en.ts` changes nothing on English team pages. Cards, the summary line, the Colour check list and the drawing's caption would still say "Grey tabby", which now means light grey only.
  - "Ginger tabby" is Samuel's own wording (parent §15, quoted: "ginger tabby"). It keeps "Ginger" on its own, so §4 and §10 can't both hold.
  - All 128 phrases are a table Samuel approved (parent §15.6, `__fixtures__/teamCoatGolden.ts`). The build checks against that table, not against its own rules (parent §15.7 #6–8). Putting the long words into a list gives sentences you can misread: "Black or dark grey and ginger or cream tabby with white" (row 86); "Black or dark grey, light grey and white, solid" (row 73). Read aloud, "or" sounds like a choice between colours, not a list.
- **Fix:** add a decision for Samuel with a recommendation. My recommendation: **long words on chips and ticks, short words in sentences.** Ticks and chips say "Black or dark grey", "Light grey", "Ginger or cream". Team sentences use "black", "light grey" and "ginger" ("Ginger tabby", "Light grey tabby with white", "Black, light grey and white, solid"). Then write out every one of the 128 rows that changes (at least rows 9–12, 25–28, 41–52, 65–76, 89–100, 105–116, 121–128) as an amendment to §15.6, for Samuel to approve. `teamCoatWords.ts` gets its own word table for this; it does not use the codes as words. Fix §4's "nothing else hard-codes them" and the §10 test so they match.

### 2. Blocker: with "dark stripes count as black", the drawing paints most tabbies as black cats, and the "Black or dark grey" chip matches most tabbies

- **Claim (§5):** "The stripe rule (pale stripes on a black base) is unchanged", and the drawings "carry the meaning more than the words do".
- **Evidence:**
  - The drawing's base is the first colour that isn't white, in display order, and Black comes first. See `coatDrawing.ts:109-112` and `artifacts/cat-spotter/components/coat/DrawnCat.tsx:86-88`. So a brown tabby saved as Black or dark grey · Brown · Stripes (§1's own example) is drawn as a near-black cat (`#2b2b2b`) with brown spots and pale stripes (`coatDrawing.ts:122-125`). A person would never draw a brown tabby that way.
  - This already happens on v2 data. The 24 October write stored `black, brown, stripes` for cats 6, 14, 20 and 29, and `black, grey, brown, stripes` for 6 and 29 (run 40114971095). The new prompt line "Dark stripes on a striped coat count here" (§6) will make it happen more often.
  - The filter: 12 of the 21 cats written on 24 October already include `black`. If dark stripes always count, a visitor who taps "Black or dark grey" for a solid black cat gets nearly every tabby too (`lib/coat.ts:72`, any shared colour matches). Samuel chose this (decision 1), but nothing in the draft shows him that consequence.
  - Older phones: `legacyCoatCodes` (`appearance.ts:132-135`) sends a black-and-brown tabby as `["black","tabby"]`, which older apps show as a black tabby. Before stripes counted, it was plain `tabby`. The parent spec promised "coarser, never wrong".
- **Fix:**
  1. Change the drawing rule. When the pattern is Stripes and there is any other main colour, Black is drawn as the stripes, not the base: the base is the next main colour and the stripes are dark. Do this in both copies, and add a test that a black + brown + stripes coat has a brown base.
  2. In `legacyCoatCodes`, for Stripes, skip `black` when `brown` or `ginger` is present. Add rows to its truth-table test.
  3. Add a line to §1 saying what a visitor will see: "Tapping *Black or dark grey* will also show most tabbies, because their stripes are dark." Ask Samuel to confirm decision 1 with that in front of him.
  4. Consider the same "stripes are implied" rule for team sentences, so it's "Brown tabby", not "Black and brown tabby". Breeders already mean the dark stripes when they say "brown tabby".

---

## Should-fix

### 3. Should-fix: for a day or more, the public sees old-meaning readings under the new words

- **Claim (§6.1):** the words, fills and coat-v3 ship in one PR. Then come three trials, then, "the next day", the save.
- **Evidence:** from the publish until the save, every cat shows its v2 reading under the new words. v2 used `grey` for any grey ("what breeders call blue", `reader.ts:45`). Cat 4 is charcoal by §2's own account, and v2 wrote `grey, white` for it (run 40114971095). So the public would see cat 4 as *Light grey*, and a visitor tapping *Black or dark grey* wouldn't find it: a known mismatch hides the cat (`lib/coat.ts:72,82`). The same goes for v2 `grey` on cats 6, 8, 19 and 29. The gap is at least 24 hours (see #6), plus Samuel's review and the Replit publish.
- **Fix:** ship in two steps. **PR 1:** the coat-v3 prompt only, with the words and fills unchanged. Trials and the save run on it. During that time, v3's `black` (which includes dark grey) shows as "Black", which is only slightly off. **PR 2:** the words and fills, published straight after the save. If Samuel wants one PR, the spec should name the cats affected during the gap and accept the risk out loud.

### 4. Should-fix: "Re-confirm (one tap each)" would record the wrong grey

- **Claim (§7):** "Samuel re-confirms these two on the team page after the publish (one tap each)."
- **Evidence:** the one-tap button is "That's right" (`appearancePage.ts:147-175`, `strings/en.ts:268`). It "sends the value the page shows", which re-saves `grey`. Saved after the publish, that means *Light grey* (§7: "Statements made after the publish use the new meanings"). For cat 3, which §7 itself thinks is probably dark grey, one tap would lock in the wrong colour.
- **Fix:** say that for each cat Samuel opens **"Update the colour"** and ticks what he means: swap Light grey for Black or dark grey if that's what he meant. He taps "That's right" only if he really means light grey. Also: §7's list should cover **all 8** team statements (unchecked: I can't see them), each checked against both changes:
  - the grey meaning;
  - "stripes count". A striped team statement with no black, such as parent §8's #13 and #29, "Brown · Ginger · Stripes", is now incomplete under decision 1 (unchecked whether those were written).

  File the list in Linear so it isn't kept in chat.

### 5. Should-fix: the trial measures a different set of cats than the baseline

- **Claim (§6.1):** count flips "beside today's baseline (§2)" of 4 of 21 single-cat photos.
- **Evidence:** a re-read skips any cat where the team or a guardian has stated both parts (`due.ts:193-197`). Since 24 October, the 8 team statements (§7) have made some baseline cats ineligible. The trial reported 28 cats due and the write 25, with only 18 and 22 excluded, so cats 3, 26 and 28 had already dropped out between the runs. Cat 5 has a team statement (§7) and is in the baseline's Black row. Cat 8 is likely team-decided too: it's in the baseline's grey, black and ginger rows (unchecked). The trial won't read them.
- **Fix:** run a `dry_run` with `reread=true` first (free). List the cats it will read, and recompute the baseline over **exactly those cats**. Otherwise add a trial-only setting that also reads team-decided cats (it writes nothing, so it's safe), so both sets of cats are the same.

### 6. Should-fix: the bar compares three reads with two, and is within noise

- **Claim (§6.1):** grey "stays apart if it flips on 3 or fewer" over three reads, against a baseline of 4 over two reads.
- **Evidence:** a colour the reader sees with probability q on each read flips over two reads with probability 2q(1−q), and over three with 3q(1−q). That's 1.5 times higher with no change in behaviour, so "4 of 21" over two reads is about 6 of 21 over three. A bar of 3 asks for the instability to roughly halve. That may be what Samuel wants, but the draft presents it as "about today's level". With 21 photos, the spread is about ±2 cats, so a result of 3 versus 4 says almost nothing.
- **Fix:** report flips **pair by pair** (reads 1–2, 2–3 and 1–3, averaged), so they compare directly with the two-read baseline. State the bar in those terms. Say in plain words that one cat either side of the line is noise, and recommend Samuel reads the contact sheet instead of the count alone.

### 7. Should-fix: the budget timing in §6.1 is off

- **Evidence:** `coat-read-photo` is 3 attempts per (cat, photo) in a **sliding** 24-hour window (`sweep.ts:47-52,75`). The 24 October trial (16:28 UTC) and write (17:11 UTC) used 2 of each photo's 3 attempts. Until about 16:28–17:11 on 25 October, every photo has only 1 attempt left. A failed call (a timeout, or an answer that isn't JSON) still uses an attempt, and the photo then has fewer than 3 reads (`sweep.ts:220-234`). The hourly budget is sliding too: two 28-call trials do fit in one hour (56 of 60), so "at least an hour apart" is cautious but not needed. **That only holds while the cat count stays near 28.** With more than 30 due, two runs in an hour stop.
- **Fix:**
  - The first trial starts at least 24 hours after 17:11 UTC on 24 October.
  - The save comes at least 24 hours after the **first** trial, not "the next day".
  - A photo with fewer than 3 successful reads is reported separately and not counted as stable.
  - No `write` of any kind (`reread` false included) runs between the publish and approval, because a plain write would save v3 readings of new cats unreviewed.

### 8. Should-fix: the 3:1 contrast promise can't be met, and light grey looks like "not known"

- **Claim (§5):** "Every new fill keeps at least 3:1 contrast against the outline and against the swatch background".
- **Evidence (WCAG relative luminance):**
  - Against the team swatch background `#f4f1ea` (`coatDrawing.ts:144`), new grey `#c3c7cd` is **1.5:1** and new ginger `#e9a25a` is **1.9:1**. Today's fills fail too: grey 2.77 and ginger 2.32.
  - Against the outline `#3b3934`, black is 1.23:1, and that's unchanged.
  - New grey against UNKNOWN `#e4e0d8` (the "colours not known" fill, `coatDrawing.ts:29`, `palette.ts:16`) is **1.29:1**. Against White `#fbfaf6` it is 1.63:1. A light grey cat will look like the "we don't know" drawing, with only the dashed outline to tell them apart, and its white chest will nearly disappear.
- **Fix:** drop the 3:1 promise. What matters here is the outline: each swatch has a 1.5 px `#3b3934` outline, and new grey has 6.8:1 against it. Say that instead. Pick a grey that stays visibly apart from UNKNOWN and White (about `#aeb3ba` gives about 2:1 against White, so test it), or change UNKNOWN to a hatched or dotted fill so it doesn't rely on its colour alone. Check it at the 20–22 px swatch size.

### 9. Should-fix: mid grey ("blue") cats fit neither word

- **Evidence:** the v2 prompt calls grey "what breeders call blue" (`reader.ts:45`), and so does parent §2 ("*Grey* is what breeders call blue"). The v3 wording splits grey into "dark charcoal … would look black in the shade" and "light, cool grey: pale, silvery". A mid slate-blue coat (Russian-blue-like, and blue torties) fits neither, which is exactly where the black/grey flips come from.
- **Fix:** say where mid grey goes, in the prompt and in §1. I suggest "a mid or dark grey goes in *Black or dark grey*; *Light grey* is only for pale, silvery coats". That matches the new swatch, and the trial will test it.

### 10. Should-fix: the new meanings quietly undo Decision T5A (no "tortoiseshell" for non-black patches)

- **Evidence:** only Black + Ginger + Patches makes *Tortoiseshell* or *Calico* (`teamCoatWords.ts:90`; parent T5A: "Never calls a sandy-brown patchy cat a tortoiseshell"). From now on, `black` covers dark grey, `ginger` covers cream, and dark stripes count as black. So:
  - a dark-grey-and-cream patched cat (a "dilute calico") becomes *Calico*, though T5A chose not to name it;
  - a brown-and-ginger patched tabby with dark stripes becomes *Tortoiseshell* (rows 79 and 119), the exact case T5A ruled out.

  The same goes for the old public code: `legacyCoatCodes` sends `tortoiseshell_or_calico` (`appearance.ts:131`).
- **Fix:** put this in front of Samuel as a choice. Either (a) accept it, since experts would call most of these torties anyway, or (b) make the rule "Black + Ginger, and no Brown". Recommendation: (b), because it keeps T5A's promise. Update the golden rows that change.

### 11. Should-fix: the "old apps" claim is wrong

- **Claim (§3):** an older phone "keeps showing the old words … its filters still find the right cats".
- **Evidence:** on an older app, a visitor who sees a dark grey cat taps "Grey", which is the code `grey`, now light grey only. The dark grey cat, saved as `black`, is a known mismatch and is **hidden** (`lib/coat.ts:72,82`). Only the "N more cats nearby in other colours" line points to it.
- **Fix:** say it honestly: "an older phone's *Grey* finds light grey cats only, until it updates; dark grey cats are under the 'more cats nearby' line." Check that the app's minimum supported version, or the update prompt, covers this before launch.

### 12. Should-fix: documents the change amends are missing from the header

- **Evidence:**
  - `docs/specs/DECISIONS.md:310` says "Colours: Black, Grey, Brown, Ginger, White … Cream counts as Ginger".
  - `:315` uses "Grey tabby with white" as its example.
  - Parent §2's table (`coat-colours-and-pattern.md:48`) has "*Grey* is what breeders call blue", and its word table is at `:56-62`.
  - `team-dashboard-redesign.md:242` lists the chips as "Black, Grey, Brown, Ginger, White".
- **Fix:** list each one in the **Amends** line. Add a dated DECISIONS.md entry on approval: the new meanings, decision 1 (stripes count), decision 2 and decision 3's bar.

### 13. Should-fix: a held-back re-read keeps the old meaning with no flag

- **Evidence:** a re-read is held back only when it comes back as a whole Not sure, or when it would leave a part not known (`sweep.ts:296-306`). In those cases the v2 reading stays, under the new words. Two examples:
  - a v3 "can't tell" pattern on a cat whose v2 reading had a pattern;
  - a photo where the cat count wavers. Cat 24 counted 1 cat in the trial and 2 in the write.

  A v2 `grey` (any grey) then shows as *Light grey* for good. For your question 2: **a swap from v2 grey to v3 black is not held back.** It's written, because `losesWhatIsKnown` only checks whether a part goes missing, not which colours. So the draft's guard description in §6 is accurate.
- **Fix:** the contact sheet marks every held-back cat whose current coat includes `grey` or `black` as "old meaning". Samuel corrects those on the team page, or they go on the Colour check list. Two-cat photos (cats 3, 13, 26, 27 and 28 in the runs) will come back Not sure again under v3, so they never benefit from the new prompt. §2's "Cats 3, 4, 16 and 26" includes two of them.

---

## Nits

### 14. Nit: the chips don't wrap, they cut off

§4 says "The chips wrap their text at phone width rather than cut it off." `CoatChips.tsx:106` sets `numberOfLines={1}`, so a label wider than the row ends in "…". At 13 pt (`theme.ts:38`), 19 Greek characters plus the swatch should fit in 390 px. Either remove `numberOfLines`, or reword the claim. The Cats grid cards' coat line will also get much longer ("Black or dark grey, light grey and brown tabby"). Check any single-line `text-overflow:ellipsis` rule on cards (e.g. `layout.ts:169`, `.said1`).

### 15. Nit: saved links keep working but change meaning

§3 says "Saved dashboard links like `?colours=black` keep working". They load, but `?colours=grey` now means light grey only (`teamCatFilters.ts:39`). Say so in one line.

### 16. Nit: the OpenAPI enum has no meaning attached

`lib/api-spec/openapi.yaml:1269-1271` gives `coatColours` only an enum. Add one sentence: "`black` includes dark grey; `grey` is light grey; `ginger` includes cream (coat-colour-words.md)". Then anyone reading the wire data gets the new meanings too.

### 17. Nit: "single-cat photo" needs a definition

The "21 single-cat photos" count includes cat 24, whose write read counted 2 cats (run 40114971095). Define a single-cat photo as "counted 1 cat in every read" and count cat 24 accordingly. Pattern flips are left out of the baseline too: cat 9 went Patches → Stripes. Fine as scope, but say so.

### 18. Nit: colour feeds no matching or notifications (verified)

Colour feeds neither matching nor notifications: `appearance.notNotifiable.test.ts:48,142` guards `coatColours`/`coatPattern` and `lib/matching.ts`. The draft could say so in one line, which answers "will the re-read ping anyone?" (No.)

### 19. Nit: the future "looks … — right?" question

The future "{name} looks {colours} — right?" question (`artifacts/cat-spotter/lib/i18n.ts:805-810`, not wired yet) will read "looks black or dark grey, light grey and white". Note it for Slice 4, with the same short-words rule as #1.

### 20. Nit: §1 is mostly plain, with three gaps

- "more than a few cats" should give the number (3) or say "a handful".
- §1 doesn't say what a visitor will notice: longer chip words, a lighter grey swatch, tabbies showing up under *Black or dark grey* (#2).
- §1 doesn't mention the one job left for Samuel: re-checking the team's saved greys (#4).

§3's "append-only rule", "enum", `lib/api-zod` and so on are fine for the technical sections, but §3 should open with one plain sentence: "Nothing already saved is rewritten; only the labels and their meaning change."

---

## Claims checked

| Claim | Result | Evidence |
|---|---|---|
| §2: runs 40111719781 / 40114971095, a trial then a save on 24 Oct | ✓ | trial 16:28 UTC `reread:true`; write 17:11 UTC `exclude:[18,22]` |
| §2: 23 cats with two readings | ✓ | counting raw answers, including the two-cat photos 13, 24 and 27 |
| §2: grey 6, 8, 15, 27, 29; black 5, 8; ginger 8; brown 7; white 14 | ✓ | per-cat diff of the two outputs. Cat 27's grey is from raw answers to a two-cat photo, Not sure both times, so it never showed |
| §2: cat 4 read grey where the dashboard said black | ✓ | write: `grey, white`, current `black, white` |
| §2: cat 18 read as brown; cat 7 brown then not | ✓ | trial `brown, white` (18); `black, brown, white` → `black, white` (7) |
| §2: Samuel corrected cat 3 to grey | unchecked | stored team statement |
| §6.1: 4 of 21 single-cat photos | ✓ with #17 | 6, 8, 15, 29 |
| §6: re-read never removes a part; skips team-decided cats | ✓ | `sweep.ts:296-306`, `due.ts:193-197` |
| §6.1: three trials use the day's allowance | ✓ with #7 | `sweep.ts:47-52`, sliding window |
| §7: 8 team statements; cats 3, 5 use grey; cat 24 black | unchecked | live DB |
| §4: words come only from strings files | ✗ | #1 |
| §5: stripe rule unchanged is harmless | ✗ | #2 |
| §5: 3:1 contrast | ✗ | #8 |
| §4: chips wrap | ✗ | #14 |
