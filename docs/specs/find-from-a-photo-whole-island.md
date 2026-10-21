# Find from a photo across the whole island: a looks-like index

**Feature spec · Cat Spotters (Syros)**
**Version:** 0.1, draft for adversarial review · 21 October 2026
**Linear:** SYC-527 (this spec). Related: SYC-396 (the dashboard), SYC-57 (visual memory, whose first half this brings forward), SYC-56 (matching accuracy), SYC-493 (the first live search), SYC-496 (the caps), SYC-462 (photo removal).
**Amends:** `team-dashboard-redesign.md` §5.2 (a place is no longer required), §10.2–§10.3 (who may use it), §13 (empty and error states) and §14 (how it's built).
**Status:** Draft. Needs adversarial review, then Samuel's approval. No code is written until he approves.

---

## 1. The short version

**What Syros Cats asked for** (via Samuel, 21 October 2026): "Syros Cats needs the ability to search and match against all cats on the island too, without specifying a location or colony."

**What exists today.** Find from a photo is live (PR 2.5, #252). The team must choose an area or a colony, which must leave 30 cats or fewer. The photo is then compared with those cats by the same AI model the app uses for sightings, in groups of 10, with a final round for the best of each group. That's at most 4 AI calls a search.

**What changes.**
- The team can choose **Anywhere on the island**. Choosing an area or a colony still works, and is still the surer search.
- When there are more cats to compare than the AI can take in a few calls, the app first picks the **20 cats that look most like the photo**, then the AI compares only those 20 closely.
- The "looks most like" step uses a **looks-like index**: every cat's display photo gets a fingerprint once, a short list of numbers that describes how the photo looks. Similar-looking cats get similar numbers, so the app can rank every cat on the island in a fraction of a second, with no AI call and no money spent.
- The fingerprints are made **on our own server**, by a small open-source image model. No new company sees any cat photo.

**What doesn't change.** The AI comparison that judges the finalists, the Very likely / Possible / Unlikely wording, the daily caps (20 a person, 100 for the team, per calendar day), and the rule that the team's photo is never kept.

**Where the island is today** (Neon, read-only query, 21 October 2026): **28 cats**, every one with a main photo. A whole-island search at launch therefore compares fewer than 30 cats, which the existing comparison already handles in at most 4 calls. The index starts doing work once the island passes 30 cats. §11 says what this means for the launch date.

## 2. Decided already (Samuel, 21 October 2026; not reopened here)

1. **Approach C, a looks-like index.** Options A (narrow by colour instead of place) and B (the app reads the coat first, then searches by colour) were offered and not chosen.
2. **Timing: before launch.** Code freeze Wed 28 October. (§11 gives the honest fit, as SYC-527 asks.)
3. **The daily caps stay** at 20 a person and 100 for the team, per calendar day (SYC-496).

## 3. How a search works, step by step

1. The team member opens Find from a photo and picks **where to look**: *Anywhere on the island* (new), *an area*, or *a colony*. Colour chips stay optional, as today.
2. The page says how many cats that leaves, and what will happen (§7.2).
3. They choose a photo and tap **Compare**. The checks before any work stay as #252 built them: the photo is re-encoded (which drops its location data), the caps are checked, nothing is stored.
4. **If 30 cats or fewer are left** (a place, or the whole island while it is small): exactly today's comparison. Every cat is compared, in up to 3 groups of 10 plus a final round. No index needed.
5. **If more than 30 are left** (the whole island once it grows, or a large area that today is refused):
   1. The server makes the photo's fingerprint in memory. It is never written anywhere.
   2. It ranks the fingerprints of those cats' display photos by how close they are to it, and keeps the **closest 20**.
   3. Those 20 go to the existing comparison: 2 groups of 10, plus the final round. **3 AI calls.**
6. The results page is today's, with one new line saying how the 20 were chosen (§7.3).

A search never makes more than 4 AI calls, as today. The index makes the whole-island search cheaper than a full narrowed search (3 calls, not 4), not dearer.

## 4. Decision 1: what makes the fingerprints

**The question.** The index needs something that turns a photo into a fingerprint. What should it be?

**What we checked (21 October 2026):**
- **The app's current AI service can't do it.** Replit's AI Integrations documentation lists chat, responses, image generation and audio for OpenAI, and no embeddings ([Replit docs](https://docs.replit.com/features/integrations/replit-ai-integrations)). And OpenAI's own embeddings endpoint takes text only, never a picture. So even if Replit passed embeddings through, it couldn't fingerprint a photo.
  - *Why no live probe:* a probe could at most show that text embeddings work, and that wouldn't change the answer. So none was run, and the paid service wasn't called. If Samuel wants it confirmed anyway, the probe is: ask the Replit agent to make one call to `openai.embeddings.create({ model: "text-embedding-3-small", input: "test" })` through the project's integration and report only the status code. Expect a 404 or "not supported".
- **On-server models, measured** on Samuel's Mac (Apple M5 Pro), with the open-source `@huggingface/transformers` library (3.7.5) on its CPU runtime, 8-bit models, a 640 px photo (the app's medium size), 12 runs each:

| Model | Fingerprint size | Time per photo (median) | Extra server memory | Model file |
|---|---|---|---|---|
| **DINOv2 small** (Meta, Apache 2.0) | 384 numbers | 44 ms | about 110 MB | 24 MB |
| CLIP ViT-B/32 (OpenAI, MIT) | 512 numbers | 32 ms | about 240 MB | 85 MB |

  The live server is slower than a new Mac. **Unchecked:** the Replit machine's size; a guess of 5–10× slower puts it at 0.2–0.5 s a photo, still well under the AI calls, which take several seconds each (also unchecked; the app doesn't log their time).
- **A hosted fingerprint service** (for example Voyage's multimodal model) costs about **$0.0002 a photo** at its listed $0.60 per billion pixels ([Voyage pricing](https://docs.voyageai.com/docs/pricing)). Others exist (Cohere, Google, Jina), at similar prices (unchecked).

**The options**

| | A. Our own server, DINOv2 small **(recommended)** | B. Our own server, CLIP | C. A hosted service |
|---|---|---|---|
| **Who sees the photos** | Nobody new | Nobody new | **A new company sees every cat's display photo and every photo the team searches with.** The privacy policy going live this week would have to name it, and it needs a data-processing agreement |
| **Money** | None. Server time only | None. Server time only | About $0.0002 a photo; a few cents for the whole island |
| **Good at telling one cat from another** | Built for "find the same thing again"; usually the stronger of the two at telling individuals apart (to be confirmed by §6's check) | Built for matching photos to words ("a ginger cat"). Good at kind, weaker at individuals | Varies by service; unmeasured |
| **Server memory** | +110 MB | +240 MB | None |
| **Risks** | A native library (`onnxruntime-node`, 208 MB installed) must work on Replit's build and machine; the model file has to reach the server (§4.1) | The same, and twice the memory | A new outside dependency that can be down, change price or change terms; another key to keep secret |
| **What the team sees** | Nothing different, unless the server can't run the model; then *Anywhere on the island* says so and offers the area search (§7.4) | Same as A | Same, plus a short wait for the round trip |

**Recommendation: A, DINOv2 small on our own server.** It keeps every photo inside services we already use, costs nothing per search, uses the least memory, and is the better kind of model for "is this the same cat". §6's accuracy check runs both DINOv2 and CLIP on the same photos before the build commits; if CLIP does clearly better there, we use CLIP instead. **C only if Samuel prefers it**, and then only once the privacy policy names the service (his call: say so before it goes live this week).

### 4.1 Getting the model onto the server

- **The model file is fetched when the app is built, not at run time.** The build downloads one pinned version from Hugging Face, checks its fingerprint (SHA-256) against the one written in our code, and fails the build if it doesn't match. At run time the library is told never to download anything. So the live app never talks to Hugging Face, and a changed file can't slip in.
- **It loads on the first whole-island search**, not when the server starts, so ordinary pages don't pay for it. On the Mac, loading took 0.2 s. On a fresh Replit instance it's likely a second or two (unchecked).
- `onnxruntime-node` is already on the server build's list of packages kept outside the bundle (`build.mjs`), so the bundler needs no change. **Unchecked, and the build's first task:** that the package installs and runs on Replit's Linux machine and its deploy step, and how much it adds to the deploy size. If it doesn't run there, stop and come back to Samuel with options (C, or WebAssembly instead of the native runtime, which is slower).

## 5. Decision 2: where the fingerprints are kept, and keeping them in step

### 5.1 Storage

**The question.** Neon (our database) offers pgvector, an add-on built for storing and searching fingerprints. Do we need it?

**What we checked (Neon, read-only, 21 October 2026):** pgvector 0.8.0 is **available but not switched on** in the production database. Our CI's test database (`postgres:16` in `.github/workflows/ci.yml`) and the local test database on the Mac (Homebrew `postgresql@16`) **don't have it**.

| | A. A plain list of numbers in an ordinary table, ranked by the server **(recommended)** | B. pgvector |
|---|---|---|
| **What it is** | Each fingerprint is stored as a list of 384 numbers (`real[]`). At search time the server reads the fingerprints of the cats being compared and ranks them itself | Postgres stores and ranks the fingerprints, and can use a special index to stay fast with millions |
| **Speed for us** | A few hundred cats is about 100,000 multiplications: well under a millisecond. Still fine at several thousand cats | Same at our size; better only at sizes we won't reach for years |
| **What it takes** | One ordinary migration | Switching the add-on on in production (Samuel's ask-mode switch), changing the CI database image, and installing it on every Mac and Replit database that runs tests |
| **Risks** | None new | More moving parts in launch week. A test database without it fails every test run |
| **What the team sees** | Nothing | Nothing |

**Recommendation: A.** pgvector is the right tool when SYC-57 grows to the whole sighting history or on-device matching. Moving from A to B later is a small migration, because the numbers are the same.

**The table** (one migration):
- `photo_fingerprints`: the photo's id (the key, and deleted with the photo), the model and version that made it, the 384 numbers, and when it was made.
- **It holds no cat id.** Which photo a cat is shown by is worked out on each search by the existing rule (`catDisplayPhotoIds`), so the index can never disagree with what the public sees.

**Migration number:** **not claimed by this spec.** On fresh `origin/main` (21 October) the newest is `0034_photo_removal`. `0035` is already used on the branch `claude/syc-396-pr-3-1b-vet-settings`, and PR 3.3a's `report_downloads` comes next. The build session claims its number when it starts, after checking `origin/main` and the open branches, and posts it on SYC-396 so the other sessions know. Its production run shares Samuel's ask-mode switch with the other migrations of that publish day.

### 5.2 Keeping the index in step

Because fingerprints belong to **photos**, not cats, most changes need nothing:

| What happens | What the index does |
|---|---|
| A new cat is named from a sighting | Its display photo has no fingerprint yet. The next search that includes it makes one (§5.3) |
| A cat's main photo changes (SYC-163, later) | The new photo has no fingerprint yet: same as above. The old photo's fingerprint is no longer used, because it's no longer anyone's display photo |
| **The team hides a photo** | **Its fingerprint is deleted in the same database transaction as the hide** (`setPhotoVisibility` for the dashboard, `photoRemoval/hide.ts` for the written procedure). If it was a cat's display photo, the cat's stand-in photo is used and fingerprinted in its place |
| The team restores a photo | Nothing. If it's a display photo again, the next search fingerprints it again |
| **A photo is removed for good** (SYC-462) | **Its fingerprint is deleted in the same transaction as the picture**, beside the small versions it already deletes (`photoRemoval/remove.ts`). The table's link to the photo also deletes it if the photo row ever goes |
| Two cats are merged | Nothing. The cat merged away isn't compared any more (the cat list already leaves it out) |
| A cat dies, is homed or leaves Syros | Nothing new. The search compares the same cats as today's (§9.5's "active cats") |
| The model changes | Fingerprints from the old model are ignored and remade as searches need them |

**Belt and braces:** a search only ever reads the fingerprints of the photos that are *right now* the cats' display photos, which are never hidden or removed. So even a fingerprint that a missed delete left behind could never be used. A test proves each of the three deletes happens, and a mutation probe (taking one out) turns it red.

### 5.3 Filling the index (the backfill, and new cats)

**The question.** Every cat's display photo needs a fingerprint before the index can rank it. When are they made?

| | A. When a search needs them **(recommended)** | B. As soon as a cat or a display photo appears | C. A nightly job |
|---|---|---|---|
| **How** | Before ranking, the search fingerprints any display photo that has none (at most 50 in one search), and saves them | The code that names a cat, or hides a main photo, also queues a fingerprint | Every night, fingerprint whatever is missing |
| **Benefits** | One place does it, and it can't miss a path. The first search after launch does the whole backfill: 28 photos at an estimated 0.2–0.5 s each is 6–14 s, once | New cats are ready before anyone searches | Searches are never slowed |
| **Risks** | A search after a big wave of new cats is slower. Over 50 missing, the rest are left out of that search, and the page says how many | Touches the sighting and hiding code, which other work changes all the time; a missed path is silent | A new scheduled job on Replit autoscale, which has no always-on process; new cats wait up to a day |
| **What the team sees** | Usually nothing. Rarely: "12 newer cats weren't included this time. Search again in a minute, or choose an area." | Nothing | Brand-new cats missing from whole-island searches until the next morning |

**Recommendation: A**, with the cap of 50 a search. At launch rates (28 cats in three months of testing), a search will almost never meet more than a handful of missing photos. A new cat with no fingerprint is **never silently missed**: either it is fingerprinted in that search, or the page counts it as left out.

**Measured cost and time of the backfill.** Money: none (no AI service is called). Time: measured on the Mac at 44 ms a photo, so 28 photos ≈ 1.2 s plus reading the photos. **On Replit: unchecked until the build runs it**; the build records the real time on SYC-527 from the first search's log line (§9).

## 6. Decision 4: does the right cat make the 20? (accuracy)

**The question.** The index only helps if the right cat is nearly always among the 20 it picks. How do we know, and is 20 the right number?

**What there is to test on** (Neon, read-only, 21 October 2026): 35 confirmed sightings with a photo, across all 28 cats. Only **6 cats** have more than one photo. That gives about **7 test searches** (a cat's other photo against every cat's display photo). That's enough to catch a broken index, not to measure one.

**The check, run by the build before the page changes:**
1. **The island's own photos.** For every cat with two or more confirmed, visible photos: search with each photo that isn't its display photo, against the display photos of every active cat. Record where the right cat ranks. Hidden and removed photos are never used, and only the ranks are written down: no photo leaves our systems. **Pass:** every one ranks in the top 10.
2. **A larger set of known cats.** A published collection of photos of individually known cats, with at least 100 cats and two or more photos each, used only on the Mac and never uploaded. **Pass:** the right cat is in the top 20 at least 90% of the time. **Unchecked:** which collection, and whether its licence allows this. If none fits, the check is the island's own photos only, and the PR says so plainly.
3. **Both models** (DINOv2 small and CLIP) run on both sets. The better one is used (§4).

**Choosing K (how many go to the AI):**

| K | AI calls | Benefits | Risks |
|---|---|---|---|
| 10 | 1 | Cheapest and fastest | The right cat has to be in the closest 10: least room for a different angle or light |
| **20 (recommended)** | 3 | Twice the room for error, and still fewer calls than today's narrowed search of 21–30 cats | — |
| 30 | 4 | Most room | The same calls as today's largest search, for little gain if 20 already passes |

**Recommendation: 20**, unless the check shows 10 passing just as well on both sets, in which case Samuel chooses between saving 2 calls a search and keeping the room. The check's numbers are recorded on SYC-527, and become the first entry in SYC-56's baseline (labelled as a small one).

## 7. Decision 5: the page

### 7.1 Anywhere beside area and colony

**The question.** Does *Anywhere on the island* replace choosing a place, or sit beside it?

| | A. Both kept, *Anywhere* as the first choice **(recommended)** | B. Both kept, a place still the first choice | C. *Anywhere* only |
|---|---|---|---|
| **What the team sees** | "Where to look: Anywhere on the island · An area · A colony". *Anywhere* is picked unless they arrived with an area or colony from the Cats page | The same three, with *An area* picked | No place choice at all |
| **Benefits** | What Syros Cats asked for is the obvious path. A place is one tap away when they know it | Nudges the team toward the surer search | Simplest page |
| **Risks** | Some searches that could have been narrowed won't be | Syros Cats' request is a step away | Throws away the surer search for a resident's WhatsApp photo from a known street |

**Recommendation: A.** The place is still the strongest clue when it's known, so the page keeps it one tap away and says why: "If you know where the photo was taken, choosing the area is surer."

**A large area** (more than 30 cats) stops being refused: it uses the index within that area, the same way. Colours stay optional narrowing for every choice.

### 7.2 The words before the search

- *Anywhere*, 30 cats or fewer: "**28 cats to compare** across the island."
- *Anywhere*, more than 30: "**412 cats on the island.** The app picks the 20 that look most alike, then compares those closely."
- A place: today's words ("12 cats to compare"), or the line above with the area's count.

### 7.3 §5.2's "less sure" sentence

Today: "This is less sure than the app's matching, because it compares more cats at once and has no exact position. Check the photos yourself."

**Proposed, when the index was used:** "This is less sure than the app's matching. It first picked the 20 cats whose photos look most alike, so a cat photographed in very different light or from another angle can be missed. Check the photos yourself, and if you know where the photo was taken, try choosing the area."

When the index wasn't used (30 cats or fewer), today's sentence stays.

**The results line:** "Compared closely with the 20 of 412 cats that look most alike" (index) or "Compared with 28 cats" (today's). **No close match:** "No close match among the 20 cats that look most alike. Try choosing an area, or browse the cats." The browse link opens the Cats grid as today (filtered by area when one was chosen).

These are **team-only words**, in English like the rest of the dashboard. They aren't in Johnny's translation pack (SYC-346), so the 22 October copy freeze doesn't bind them; #252 had none either.

### 7.4 When the index can't run

If the model fails to load or the fingerprint fails: "Searching the whole island isn't working right now. Choose an area or a colony to search without it." No search is used up (the failure happens before the caps are counted), and a place search of 30 cats or fewer still works, because it never needs the index.

### 7.5 The caps

**Unchanged:** 20 a person and 100 for the team, per calendar day (SYC-496). A whole-island search makes 3 AI calls, fewer than the largest narrowed search, so the most the AI service can be billed per day stays at 400 calls (100 searches of at most 4). The fingerprint costs no money. **Cost in money per call: still unchecked** (the app logs no tokens; SYC-493). A deferred ticket adds token logging (§12).

## 8. Decision 6: privacy

- **The team's photo:** re-encoded (no location data), fingerprinted **in memory only**, compared, and forgotten. Its fingerprint is never written to the database, a log or a file. A test runs a search and checks that the fingerprint table's row count only grows by the cats' display photos, never by one for the upload. Same rule as #252's "nothing is stored" test.
- **Hidden and removed photos are never fingerprinted.** The search fingerprints only current display photos, which by the existing rule are never hidden or removed. A fingerprint is deleted when its photo is hidden or removed (§5.2).
- **No new company sees any photo** (with §4's recommendation). The model file comes from Hugging Face at build time only; the running app never contacts it.
- **No positions in addresses.** *Anywhere on the island* is one more value of the existing place choice (no position, no name). The address rule in spec §10.4 and its tests are unchanged.
- **The privacy policy:** with on-server fingerprints, nothing changes. With a hosted service (option C), it must name the service before launch.

## 9. Decision 7: who can use it

| | A. The team only **(recommended)** | B. Cat guardians too (`match_cat_anywhere`) |
|---|---|---|
| **What it means** | Same as Find from a photo today: `find_cat_from_photo`, island-wide team members | A guardian could search every cat on the island from the dashboard |
| **Benefits** | No new permission, no new tests of who sees what | Guardians could identify a cat that wandered in from elsewhere |
| **Risks** | Guardians still ask the office | A guardian would see photos and names of cats in colonies that aren't theirs, which spec §10.2 deliberately keeps from them. `roles-and-invites.md` note 3 reserves this power until a guardian can upload her own sighting in the dashboard, which doesn't exist |
| **What guardians see** | No change | A new search page |

**Recommendation: A.** `match_cat_anywhere` stays reserved. A guardian who tries the route still gets the refusal page (#252's route test, extended to the *Anywhere* choice).

## 10. How it's built (outline for the plan)

1. **Probe the runtime on Replit first** (§4.1): install, load the model, fingerprint one photo, report memory and time. Stop if it fails.
2. **The accuracy check** (§6), on both models. Choose the model and K.
3. **Migration:** `photo_fingerprints`, number claimed at build start (§5.1).
4. **`lib/photoFingerprint.ts`:** load the pinned model once, fingerprint a photo's medium version, save it; and rank a set of display photos against an in-memory fingerprint.
5. **`findFromPhoto.ts`:** *Anywhere* as a place choice; over 30 cats, fill missing fingerprints (cap 50), rank, keep 20, compare as today. Nothing else in the comparison changes.
6. **The deletes** in `setPhotoVisibility`, `photoRemoval/hide.ts` and `photoRemoval/remove.ts`, each in the existing transaction.
7. **The page words** (§7) and the guardian route test.
8. **Logging:** each search logs which path it took, how many cats, how many fingerprints it had to make and how long they took. Counts and times only, never a photo id.

**Tests that must exist, each proven red by breaking the code it guards:** the upload's fingerprint is never stored; a hidden photo's fingerprint is deleted; a removed photo's fingerprint is deleted; a search never reads a non-display photo's fingerprint; at 30 cats the index isn't used (today's comparison exactly); over 30, exactly 20 reach the AI and 3 calls are made; the model failing gives §7.4's page and spends no search; a guardian is refused.

**Review:** an adversarial review on the PR, focused on the privacy rules above and on the model running on Replit.

## 11. Decision 8: does it fit by 28 October?

**The honest picture** (21 October; plan `docs/superpowers/plans/syc-396-phases-2-4.md`, "Fit to 31 October", and Samuel's new build order on SYC-396):
- **Building now or next:** PR 2.3.1 (draft #256), then 3.1a, 3.1b (branch exists) and 3.3a in parallel. **At most three building agents at once** share the test database on the Mac.
- **The critical path** is 2.3 → 3.1 → 3.2, each needing a review and one of Samuel's merge windows. Publishes left: Fri 23, Mon 26 and the freeze on Wed 28.
- **This feature, with the index:** about 2 building days, plus review and a merge window, plus one migration (sharing an ask-mode switch). Its biggest unknown is the native model runtime on Replit, which can only be found out by trying.
- **The index has nothing to do at launch.** With 28 cats, every whole-island search is 30 cats or fewer and uses today's comparison. The index only matters once the island passes 30 cats, which took three months of testing to reach 28.

**The options**

| | A. Everything before the freeze (Samuel's 21 Oct timing) | B. *Anywhere* before the freeze, the index straight after launch **(recommended)** | C. Everything after launch |
|---|---|---|---|
| **What ships by 28 Oct** | *Anywhere*, the index, the migration, the model on Replit | *Anywhere on the island* using today's comparison while the island has 30 cats or fewer: the page words, one rule changed, its tests. About half a day. No migration, no model | Nothing |
| **What Syros Cats get at launch** | Search the whole island | **The same**: search the whole island (it's 28 cats) | They still must choose a place |
| **Then** | — | The index ships in the 16 Nov release, before the island is likely to pass 30. If it passes 30 sooner, *Anywhere* asks for a place, as today | — |
| **What slips** | It takes a building slot from 3.1a/3.1b/3.3a, or waits for one. By D2's slip order, the reports (3.3) go first. And a new native library goes into the freeze publish | Nothing on the critical path | Nothing |
| **Risks** | A failed model install on Replit found in freeze week | The index's own risks move to a calmer week | Syros Cats' request is unmet at launch |

**Recommendation: B.** It gives Syros Cats exactly what they asked for on launch day, takes about half a day, and keeps a new native library and a migration out of freeze week. The index still comes before it's needed. This keeps Samuel's decision on approach C and changes only when the index lands, so **it's Samuel's call**: if he prefers A, the build starts as soon as this spec is approved, and §10's step 1 decides by Friday whether it can make the Mon 26 publish.

## 12. Deferred (each filed in Linear)

- **Log AI tokens per search**, so the cost per search stops being unchecked (SYC-493 found the app logs counts only).
- **pgvector**, when SYC-57 moves to the whole sighting history or on-device matching (§5.1).
- **A larger accuracy set** from launch-era confirmed sightings (SYC-56, existing ticket; this spec's check is its first small entry).
- **`match_cat_anywhere`** stays reserved (existing note 3; no new ticket).

## 13. Changes to `team-dashboard-redesign.md`

- **§5.2 Narrowing:** "Required: a named area, or a colony" becomes "Where to look: anywhere on the island, a named area, or a colony". Over 30 cats, the app picks the 20 that look most alike first (this spec §3), instead of refusing.
- **§5.2 What the page says plainly:** add §7.3's sentence for searches that used the index.
- **§5.2 Cost:** "at most 4 AI requests" stands; a whole-island search makes 3.
- **§10.2:** unchanged: guardians don't get Find from a photo.
- **§13:** add §7.4's error and §5.3's "weren't included" line.
- **§14:** add the looks-like index: an on-server model, fingerprints in an ordinary table, keyed by photo.
