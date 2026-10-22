# SYC-527 spec: adversarial review, 21 Oct 2026

Reviewer: Sonnet subagent, own worktree (agent-af73ebdaf8d6e4e1b), on spec commit 63949534. Read-only: no database, no paid service, no code written.

## Findings

### 1. BLOCKER (privacy): the "belt and braces" does not cover a fingerprint written AFTER the hide's delete (spec 5.2, 8)
- A search fills a missing fingerprint in three steps: read the display photo set, compute (0.2-0.5 s), insert. A hide or a removal can commit between the read and the insert. The hide's delete then finds nothing, and the insert lands afterwards. Both `setPhotoVisibility` (photoVisibility.ts:259) and `removePhoto` (remove.ts, `select ... for update`) hold the photo-row lock, but an insert into a table with a foreign key to `photos` only takes FOR KEY SHARE on the row. It waits for the lock, then succeeds. Nothing re-checks "still visible".
- The cascade the spec leans on ("deleted with the photo if the photo row ever goes") is moot: removal NEVER deletes the `photos` row. It sets `data = null, removed_at = ...` (remove.ts). A fingerprint of a photo removed for privacy therefore survives indefinitely.
- "Reads only current display photos" protects use, not retention. A removed-for-privacy photo leaving derived data behind is what SYC-462 exists to prevent.
- The repo solved this once: `variantFor` (photoVariants.ts:59-64) locks the row FOR KEY SHARE and re-checks `data is not null` before saving a version, because a bare insert read the old snapshot.
- Fix: say the fill does the same. Insert inside a transaction that locks the photo row, re-checks "not removed, newest visibility event not hide" via `hiddenPhotoIds(..., tx)`, then `INSERT ... ON CONFLICT DO NOTHING`. Add a race test (hide between compute and insert), proven red. Removal also runs `delete from photo_fingerprints where photo_id = $1` after its lock.

### 2. MAJOR: the spec lists two places that hide photos; there are three (spec 5.2, 10 step 6)
- `artifacts/api-server/src/lib/issues/hide.ts:244` (`applyHideRules`, SYC-44): a welfare report can auto-hide a photo, inserting a `photo_visibility_events` hide row with author `report:<id>`. It takes the photo lock (hide.ts:~157) but is not named in 5.2 or 10.6. A build following the spec would leave this path without the fingerprint delete, and a test "hidden photo's fingerprint is deleted" would pass on the two named paths only.
- This one is also the likeliest in practice: it fires from the public app, with no team member involved.
- Fix: name all three writers, or (better) put the delete in ONE place the three share. `photo_visibility_events` is append-only with a lock convention; a trigger on insert of a "hide" row (like migration 0034's trigger that refuses events on removed photos) deletes the fingerprint, and no future hide path can miss it. A source test, like photoVisibility.ts's P6-0, can grep for any other `insert(photoVisibilityEventsTable)`. Also `truncatePeople.ts` and `scripts/db-ops.sh` touch these tables: state they are out of scope.

### 3. MAJOR: ordering against the caps is contradictory, and one reading brings back #252 finding 2 (spec 3, 5.3, 7.4)
- 3 puts "the caps are checked" at step 3 and fingerprinting at step 5, after. 7.4 says a model failure "happens before the caps are counted" and "no search is used up". Both cannot hold. If the fill runs after the gate (the 3 reading), a model that won't load, or a photo that won't fingerprint, spends one of the person's 20 and one of the team's 100: the same fault as #252 review finding 2 (a search used up when nothing could be compared; fixed by reading reference photos before the gate, findFromPhoto.ts "BEFORE the caps").
- If the fill runs before the gate (the 7.4 reading), up to 50 fingerprints (10-25 s of server work, spec's own estimate) run for a person who can still burn it with no limit beyond the free early peek, which is only a read (teamCats.ts:358) and not atomic. A burst of requests just under the cap can each start a fill. Review finding 5's concern (don't make over-cap people wait) is only half met.
- Fix: state the order explicitly in 3 and 10: validate photo, early peek, fingerprint the upload, fill and rank (all before the gate), THEN the gate, THEN the AI calls. Failures before the gate spend nothing. Bound the cost by (a) a one-fill-at-a-time lock per server process, (b) `ON CONFLICT DO NOTHING`, (c) a test that a failed fingerprint leaves both counts unchanged.
- Related: today's `referencePhotos` (findFromPhoto.ts:195-228) loads and base64-encodes the medium photo of EVERY cat it is given. With 412 cats that is 412 reads (and variant creation for any missing) before ranking. The spec must say ranking happens first and `referencePhotos` runs on the 20 only.

### 4. MAJOR: the lazy fill's cap of 50 and "a handful will be missing" fall over at the first big addition (spec 5.3, 11)
- The 16 Nov release (mvp-launch-31-oct.md:46) includes the records import (SYC-49), which can add many cats at once, and the 31 Oct launch is "for everyone, tourists included". The spec's "28 cats in three months" is the test period's rate and is unsourced.
- With 300 new cats and a cap of 50, the first ~6 searches each leave 250+ cats out, silently ranking the island on a fraction of it. The page's remedy, "Search again in a minute", spends another search each time (see finding 3). Which 50 get filled is unspecified, so who is left out is arbitrary.
- Same trap on a model change (5.2, "remade as searches need them"): every cat is stale at once.
- A permanently bad photo (unreadable) is retried and counted as "left out" in every search.
- Fix: add a one-off backfill command (a script run by the build session after a deploy, like `db-ops`), run as part of releasing the index and again after any import or model change; keep lazy fill only as the safety net. Make fill order deterministic (candidates of the chosen area first, then newest). Record a per-photo failure so a bad one is skipped for a while. The "left out" line must never be silent about WHICH kind of cat.

### 5. MAJOR: Option B (11) has two cats of headroom and the spec's own "then" is wrong (spec 11)
- 28 active cats against a 30 limit. The launch is open to tourists and creates cats; the records import (16 Nov, same release as the index) is the likeliest thing to cross 30. Option B's fallback ("if it passes 30 sooner, Anywhere asks for a place, as today") means Syros Cats' request fails on exactly the week they were promised it. "Before the island is likely to pass 30" is an unchecked forecast, not labelled unchecked.
- Also, 28 is a count of cats shown; `compared` can be lower (cats with no visible photo, finding 3 / no_photos). The threshold in 3 is on cats (`count > FIND_MAX_CATS`) not candidates: say which.
- Fix: label the forecast unchecked; ask Samuel about a stopgap in option B: raise the no-index ceiling from 30 to a size one extra round can handle cheaply, or on crossing 30 fall back to colour chips + area suggestion. Better: give A a real chance by splitting the runtime risk, e.g. ship Anywhere on 28 Oct and the index probe (spec 10 step 1) on the Replit build the same week, so the risk is known before the freeze.

### 6. MAJOR: the accuracy check cannot answer the question it is asked (spec 6)
- The index only matters at hundreds of cats, but check 1 runs against 28. Top-20 of 28 is 71% by chance, top-10 of 28 is 36%. "All ~7 rank in the top 10" has a chance probability near 0.0008, so it does catch a broken index, as the spec says, but says nothing about top-20 of 400. State that, and do not present the pass as evidence for K=20 at scale.
- Those 7 pairs are probably from the same visit (same light, same spot), which flatters the result. "Other photo of the cat" needs to be from a different day to count. Not checked.
- DINOv2/CLIP global vectors encode the scene as much as the cat. Street-cat display photos from the same feeding site share a background, so a photo from that site ranks its colony's cats first whether or not it is the same cat, and a cat photographed elsewhere ranks badly. No cropping to the cat is in the plan. This is the main risk to "does the right cat make the 20" and is not mentioned.
- Check 2 depends on a dataset the spec has not found ("unchecked ... which collection"), and the pass bar (90% top-20) is unjustified for a 100-cat set (chance level 20%).
- "The better model is used" has no rule when results are within noise on 7 pairs.
- Fix: say plainly that check 1 is a smoke test; require pairs from different days; add a test that holds the cat out of its own colony; fix the rule for choosing a model (e.g. DINOv2 unless CLIP is better by at least 10 points on set 2); name the dataset or drop check 2 and say the real evidence comes from labelled launch-period searches (SYC-56).

### 7. MAJOR: the Replit deploy story is thinner than "already on the list" (spec 4.1)
- `onnxruntime-node` is on build.mjs's external list only as a precaution ("some of the packages ... may not be imported or installed"). It is in NO package.json. It is not installed, and `@huggingface/transformers` is not either. "The bundler needs no change" is true for onnx, untrue for transformers.js itself, which esbuild would bundle (it has optional imports of sharp, onnxruntime-web and dynamic requires). Add it to `external`, or say the build checks it.
- Production runs `node artifacts/api-server/dist/index.mjs` straight from the repo (artifact.toml), so externals must be present in `node_modules` at run time. `.replit` runs `pnpm store prune` post-build. Where the model file lives (inside `dist/`? a `models/` folder?) and whether it is kept in the deploy image are not stated. A file fetched at build into a folder the deploy does not copy is a silent run-time miss.
- pnpm-workspace.yaml has `minimumReleaseAge: 1440`, `onlyBuiltDependencies` (an allowlist for install scripts: onnxruntime-node's install script will not run unless added), and a platform-stripping `overrides` block. Each needs a deliberate line. `scripts/dependency-security.test.cjs` and the lockfile (`--frozen-lockfile` in CI) also change.
- Autoscale starts a fresh instance per scale-out: each pays model load (spec guesses "a second or two", unchecked) and +110 MB RSS (unchecked on a Replit instance whose size the spec doesn't know). Nothing says what happens on out-of-memory (the whole server, including ordinary pages, restarts).
- The build downloads from Hugging Face. If that is down in release week, the build fails and so does the freeze publish. State the fallback (commit the 24 MB file with Git LFS? cache?).
- Fix: put the probe (10 step 1) BEFORE spec approval of the build slot, not after; list the files to change; decide the model's location; give the memory ceiling as a number.

### 8. MAJOR: time and load of a search (spec 5.3, 3)
- The fill is up to 50 sequential photos at 0.2-0.5 s (spec's own unverified 5-10x guess) = 10-25 s of CPU on the same Node process that serves every other page, then 3 AI calls (several seconds each, unchecked). 30-40 s for one HTTP request on a form POST. No timeout, no progress state, and no stated proxy limit for Replit autoscale appear anywhere. Also `variantFor` makes the medium version if it's missing (more CPU).
- Two people searching at once both fill the same missing photos (no lock, no `ON CONFLICT`); 20 people x 50 photos at once is the memory risk.
- Fix: a per-process single-flight for fill; measure on Replit in the probe and write the number into the spec; give the page a "this can take up to a minute" line and say what the browser shows while waiting; cap the fill by time (e.g. 8 s) not only count.

### 9. MAJOR: a new table breaks SYC-462's catalogue and its removal search (spec 5.1, 5.2)
- `lib/db/src/photoRemoval/catalogue.test.ts` (T3) lists every column that points at `photos.id`, and goes red when a new one appears "until someone decides how a removal treats it, and updates the spec's map and this list". `photo_fingerprints.photo_id` is such a column. The removal search (search.ts) scans `ARRAY` columns, so a `real[]` fingerprint column gets text-scanned for bytes: slow and a false-positive risk. Neither is mentioned. Fix: add P9 to SYC-462's map; say the scan skips this table or handles it; remove.ts's `RemoveStep` gets a fourth step ("fingerprint") with its own skip-test (T2 style).

### 10. MINOR: other claims about existing code
- Verified true: a place search of 30 or fewer never needs the index (`count > FIND_MAX_CATS` returns `too_many` first, findFromPhoto.ts:97). `catDisplayPhotoIds` never returns a hidden or removed photo (`hiddenPhotoIds` includes `removed_at is not null`; stand-ins are filtered the same way). Merged cats are excluded (teamCatList.ts:164-200 `away`).
- "One rule changed" for Anywhere (11, Option B) is optimistic. `hasPlace` is also enforced in the route (teamCats.ts:333, "Choose an area or a colony first"), in `findFilters`, the form page and the `tie` flow. Each must accept a third value, with its own test.
- `FIND_MAX_CATS` semantic: today `too_many` is by cats, the index threshold in 3 is by cats too, but candidates can be fewer. Pick one.
- 7.4's "a place search of 30 or fewer still works" is right, but if the index fails on a place of 31-60 the page tells them to choose an area: the same area.
- SYC-163 and "a new cat is named from a sighting": naming code is sightings.ts:~778; nothing there needs a change, agreed.

### 11. MINOR: the "less sure" sentence and the page words
- 7.3 says the index can miss "a cat photographed in very different light". It also should say it favours cats photographed in the same place (finding 6). One sentence.
- 7.2's "The app picks the 20 that look most alike" reads as if it compares the cats with each other. Say "look most like your photo".

### 12. PLAIN-ENGLISH AND DECISION FORMAT
- Jargon left unexplained for Samuel: "SHA-256", "pgvector" (explained once, then used), "real[]", "RSS" (as "Extra server memory" is fine), "transaction", "mutation probe", "autoscale", "WebAssembly", "bundler"/"kept outside the bundle", "native library", "data-processing agreement", "migration" (used throughout), "ON CONFLICT"-level detail is absent (good). Put each in a clause or drop it.
- Decision numbering skips: 1, 2, 4, 5, 6, 7, 8. There is no "Decision 3" (5.3 is probably it).
- Decisions missing a part: 4.1 (how the model reaches the server) is a real choice with no options table or recommendation; 6's K table has no "what the team sees" column; 5.1's "what it takes" is fine; 11 option C has no UX line beyond the request unmet. 7.1 and 9 are complete. 4's recommendation to go ahead of the accuracy check ("if CLIP does clearly better, we use CLIP") hides a second decision (memory) with no owner.
- The spec says things like "Samuel's ask-mode switch" in a decision table: a reader who is not Samuel will not know it. Fine for him.

### 13. MINOR: canonical facts and labelling
- CLAUDE.md says specs describe the product as one vision and "never distinguish built today vs proposed". This spec's structure ("What exists today / What changes", 3 "exactly today's comparison", 11's phasing) does exactly that. As an amendment it is defensible; if Samuel reads that rule strictly, 1 and 3 need rewording. Flagging, not asserting.
- No "colony carer" and no "snapper" found. "Cat guardians" is used correctly. "Spotters" is not used at all; fine.
- Stated as fact without a source or an "unchecked" label: "which took three months of testing to reach 28" (1, 11); "DINOv2 ... usually the stronger of the two at telling individuals apart" and "CLIP ... weaker at individuals" (4; the "to be confirmed" covers only the first); "the index starts doing work once the island passes 30"; "about 2 building days" and "about half a day" (11); "a few cents for the whole island" is fine (priced). The AI call timing is labelled unchecked (good).

### 14. NIT
- 5.1: ranking in the server needs the vectors normalised (cosine vs dot) and an agreed distance; one line.
- 8: "a test checks the table's row count only grows by display photos" is racy under parallel test agents (shared test DB); count rows for the search's own cat ids.
- 10 step 8: log lines must not include the vector; `safeError` on a model failure must not print input. Say so.
- 5.2 row "A cat's main photo changes (SYC-163)": the old fingerprint remains forever as an orphan, for a photo that may later be hidden. Prune by "not a display photo for N days" or leave it for the model-change sweep.

## Checked and fine
- The upload re-encode, early cap peek, gate order and `no_photos` handling in findFromPhoto.ts match #252's fixes; nothing in the spec moves them except as in finding 3.
- Place search of 30 or fewer: unchanged code path, as the spec says.
- `catDisplayPhotoIds` excludes hidden and removed photos and stand-ins; merged cats are excluded by `allTeamCats`.
- The 4-call ceiling holds: K=20 gives 2 groups + a final round = 3 calls; the daily AI ceiling arithmetic (100 x 4) is right.
- Guardians: `find_cat_from_photo` is not theirs; `match_cat_anywhere` is reserved in roles-and-invites.md note 3, as the spec says.
- Migration number: the spec correctly refuses to claim one.
- Dates: 16 Nov is a real second release (mvp-launch-31-oct.md:4); publish days match the plan.
- Option C (hosted fingerprint service) is correctly flagged for the privacy policy.

