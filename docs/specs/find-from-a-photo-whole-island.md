# Find from a photo across the whole island: a looks-like index

**Feature spec · Cat Spotters (Syros)**
**Version:** 0.3, with Samuel's nine decisions · 21 October 2026
**Linear:** SYC-527 (this spec). Related: SYC-396 (the dashboard), SYC-57 (visual memory, whose first half this brings forward), SYC-56 (matching accuracy), SYC-493 (the first live search), SYC-496 (the caps), SYC-462 (photo removal), SYC-534 (logging AI cost).
**Amends:** `team-dashboard-redesign.md` §5.2 (a place is no longer required), §13 (empty and error states) and §14 (how it's built).
**Review:** a Sonnet adversarial review of v0.1 found 1 blocker, 8 major and several minor points (`docs/reviews/syc-527-spec-adversarial-review.md`). §15 says where each is handled.
**Status:** All nine decisions answered by Samuel on 21 October 2026 (his exact words are on SYC-527; summary in §2). Awaiting his approval of the spec as a whole. No code is written until he approves.

---

## 1. The short version

**What Syros Cats asked for** (via Samuel, 21 October 2026): "Syros Cats needs the ability to search and match against all cats on the island too, without specifying a location or colony."

**How it works.**
- In Find from a photo, the team can choose **Anywhere on the island**, as well as an area or a colony. A place is still the surer search when they know it.
- When there are more cats than the AI can compare in a few calls, the app first picks the **20 cats whose photos look most like the team's photo**. Then the AI that already does Find from a photo compares only those 20 closely.
- The "look most like" step uses a **looks-like index**. Every cat's display photo gets a fingerprint once: a short list of numbers that describes how the photo looks. Similar-looking photos get similar numbers. So the app can rank every cat on the island in a fraction of a second, with no AI call and no money spent.
- The fingerprints are made **on our own server**, by a small open-source image model. No new company sees any cat photo.
- The AI comparison, the Very likely / Possible / Unlikely wording, the daily caps (20 a person, 100 for the team, per calendar day) and "the team's photo is never kept" all stay exactly as they are.

**The island now** (read-only query on the production database, 21 October 2026): **28 cats**, every one with a main photo. The first was added on 27 July and the most recent on 29 September; none has been added in the three weeks since. While the island has 30 cats or fewer, a whole-island search simply compares them all, as a narrowed search does. The index starts doing the work once the island passes 30.

### Words used in this spec

| Word | Meaning |
|---|---|
| **Fingerprint** | A list of 384 numbers worked out from a photo. Two photos of the same cat usually get close numbers. It isn't a picture, and a photo can't be rebuilt from it. |
| **Display photo** | The photo the public sees for a cat: its main photo, or a stand-in if the team hid the main one. Worked out by the app's existing rule. |
| **Shortlist** | The 20 cats whose display photos' fingerprints are closest to the team's photo's. |
| **Transaction** | A group of database changes that all happen together or not at all. |
| **Trigger** | A rule kept inside the database that runs every time a certain row is written, whichever part of the app writes it. |
| **Autoscale** | How the live app runs on Replit: copies of the server start and stop with demand, each with a fixed amount of memory. |

## 2. Decided already (Samuel, 21 October 2026; not reopened here)

1. **Approach C, a looks-like index.** Options A (narrow by colour instead of place) and B (the app reads the coat first, then searches by colour) were offered and not chosen.
2. **Timing: before launch.** Code freeze Wed 28 October. §12 gives the honest fit, as SYC-527 asks.
3. **The daily caps stay** at 20 a person and 100 for the team, per calendar day (SYC-496).

**The spec's nine decisions** (Samuel, 21 October 2026, answered one at a time; his exact words are quoted on SYC-527):

| # | Decision | His answer |
|---|---|---|
| 9 | Launch fit (§12) | **"Anywhere now, index when ready"**: *Anywhere* ships before the freeze and compares every cat while the island has 30 or fewer; the Replit check runs this week; the index ships in an early fix release once built and reviewed, not held for 16 November |
| 1 | What makes fingerprints (§4) | DINOv2 small, on our own server |
| 2 | Getting the model live (§5) | Keep the file in our code |
| 3 | Storage (§6) | An ordinary table, no pgvector |
| 4 | Filling the index (§7) | **"Batch updates every night"** (his own option), and, asked as a follow-up, "Nightly + small top-ups" |
| 5 | Shortlist length (§8) | **"Let the test decide"**: 20, or 10 if the test shows it finds the right cat just as often |
| 6 | The page (§9) | All three choices, *Anywhere* first |
| 7 | Privacy (§10) | The rules as written |
| 8 | Who (§11) | The team only |

## 3. How a search works, step by step

1. The team member opens Find from a photo and picks **where to look**: *Anywhere on the island*, *an area*, or *a colony*. Colour chips stay optional.
2. The page says how many cats that leaves and what will happen (§9.2).
3. They choose a photo and tap **Compare**. In this order, and **nothing in steps 3–6 uses up a search**:
   1. The photo is re-encoded (which drops its location data) and checked, as #252 does.
   2. A free look at the caps: someone already over their cap is turned away before any work (#252, second review, finding 5).
   3. The cats to compare are worked out. "The number of cats" means **cats with a display photo**; a cat with none can't be compared by any method.
4. **30 cats or fewer:** the search is exactly #252's. Every cat is compared, in up to 3 groups of 10, plus a final round.
5. **More than 30:**
   1. The server works out the team's photo's fingerprint, in memory only.
   2. It makes any fingerprints still missing for those cats' display photos (§7), within a time limit.
   3. It ranks the cats by how close their fingerprints are, and keeps the **closest 20**.
   4. Only then does it read those 20 cats' photos for the AI. #252 reads every cat's photo; reading 400 would be slow.
6. If step 5 fails (the model won't load, or the fingerprint can't be made), the page says so (§9.4) and the search isn't counted.
7. **The caps are counted** (the same gate as #252, before any AI call).
8. The AI compares: up to 4 calls for 30 cats or fewer, **3 calls** for a shortlist of 20 (2 groups of 10, plus the final round).
9. The results page is #252's, with one new line saying how the 20 were chosen (§9.3).

A search never makes more than 4 AI calls. A whole-island search on a large island is cheaper than today's largest narrowed search (3 calls, not 4).

**Two searches at once.** Each server copy makes fingerprints for only one search at a time; a second search waits for the first to finish making them and then reuses them. This stops a burst of searches from each starting the same slow work.

## 4. Decision 1: what makes the fingerprints

**The question.** Something has to turn a photo into a fingerprint. What should it be?

**What we checked (21 October 2026):**
- **The app's current AI service can't do it.** Replit's AI Integrations documentation lists chat, responses, image generation and audio for OpenAI, and no embeddings ([Replit docs](https://docs.replit.com/features/integrations/replit-ai-integrations)). And OpenAI's own embeddings service takes text only, never a picture.
  - *Why there was no live test call:* a test could at most show that text fingerprints work, and that wouldn't change the answer. So the paid service wasn't called. If Samuel wants it confirmed anyway: ask the Replit agent to make one call to `openai.embeddings.create({ model: "text-embedding-3-small", input: "test" })` through the project's integration and report only whether it worked. Expect a "not found" or "not supported".
- **Two open-source models, measured on Samuel's Mac** (Apple M5 Pro). These used the `@huggingface/transformers` library (3.7.5) on the computer's processor, with the models' compact 8-bit versions and a 640 px photo (the app's medium size), 12 runs each:

| Model | Fingerprint | Time per photo | Extra server memory | Model file |
|---|---|---|---|---|
| **DINOv2 small** (Meta, Apache 2.0 licence) | 384 numbers | 44 ms | about 110 MB | 24 MB |
| CLIP ViT-B/32 (OpenAI, MIT licence) | 512 numbers | 32 ms | about 240 MB | 85 MB |

  **Unchecked:** how fast the Replit server is, and how much memory each copy has. A guess of 5–10 times slower puts a fingerprint at 0.2–0.5 s.
- **A hosted fingerprint service** (for example Voyage's multimodal model) costs about **$0.0002 a photo** at its listed $0.60 per billion pixels ([Voyage pricing](https://docs.voyageai.com/docs/pricing)). Others (Cohere, Google, Jina) are similar (unchecked).

**The options**

| | A. Our own server, DINOv2 small **(recommended)** | B. Our own server, CLIP | C. A hosted service |
|---|---|---|---|
| **Who sees the photos** | Nobody new | Nobody new | **A new company sees every cat's display photo and every photo the team searches with.** The privacy policy going live this week would have to name it, with a data-processing agreement (the contract that says what they may do with it) |
| **Money** | None. Server time only | None. Server time only | About $0.0002 a photo: a few cents for the whole island |
| **Telling one cat from another** | Made for "find this same thing again". Published comparisons usually rate it better than CLIP at that (**unchecked here**; §8 decides) | Made for matching photos to words ("a ginger cat"): good at kind, expected to be weaker at individuals | Varies by service; not measured |
| **Server memory** | +110 MB | +240 MB | None |
| **Risks** | A new piece of compiled software (`onnxruntime-node`) must install and run on Replit (§5) | The same, with twice the memory and a file too big to keep in our code | A new outside dependency that can be down, change price or change terms; another secret key to keep |
| **What the team sees** | Nothing different. If the model can't run, *Anywhere on the island* says so and offers the area search (§9.4) | Same as A | Same, plus a short extra wait |

**Recommendation: A, DINOv2 small on our own server.** It keeps every photo inside services we already use, costs nothing per search, and uses the least memory. §8's check runs both A and B on the same photos. The rule for choosing: **use the one that puts the right cat in the top 20 more often; if they're within 5 percentage points, use DINOv2 small** for its smaller memory and file. **Choose C only if Samuel prefers it**, and then only once the privacy policy names the service (his call, before the policy goes live this week).

## 5. Decision 2: getting the model onto the live server

**The question.** The model is a 24 MB file and a piece of compiled software. How do they reach the live app, and what has to change?

**What the code shows (origin/main, 21 October):** `onnxruntime-node` is already on the server build's list of packages it leaves out of the bundle (`artifacts/api-server/build.mjs`), but neither it nor `@huggingface/transformers` is installed anywhere. The workspace has a 1-day minimum age for new packages, an allowlist of packages that may run build steps (`onlyBuiltDependencies`) and rules that strip other computers' versions of some packages (`pnpm-workspace.yaml`). The live server runs `node dist/index.mjs` after a build step on Replit (`.replit`).

**Where the model file comes from**

| | A. Kept in our code, beside the server **(recommended for DINOv2 small)** | B. Downloaded from Hugging Face during each build | C. Downloaded when the server starts |
|---|---|---|---|
| **How** | The 24 MB file is committed once under `artifacts/api-server/models/`, with its licence. The server reads it from disk | The build fetches one pinned version and checks its checksum (a fingerprint of the file itself) | The server fetches it on the first search |
| **Benefits** | No outside service during a build or a search; the exact file is reviewed in the PR | Keeps the repository small; works for CLIP's 85 MB | Nothing to set up |
| **Risks** | 24 MB added to the repository for good (each model change adds another) | A Hugging Face outage in release week fails the build | The live app depends on Hugging Face; a slow first search on every new server copy |
| **What the team sees** | Nothing | Nothing, unless a build fails on publish day | A slower first search |

**Recommendation: A** for DINOv2 small; **B** if §8 picks CLIP (85 MB is too big to keep in the code). Never C. At run time the library is told never to download anything.

**What the build changes** (the build PR lists each):
- `artifacts/api-server/package.json`: add `@huggingface/transformers` and `onnxruntime-node`, at versions over a day old.
- `artifacts/api-server/build.mjs`: also leave `@huggingface/transformers` out of the bundle, so it loads its compiled part at run time.
- `pnpm-workspace.yaml`: allow `onnxruntime-node`'s build step only if it needs one (it ships ready-made copies for Linux, macOS and Windows).
- The repository's package-safety tests, updated for the two new packages.

**The first task of the build, before anything else:** on Replit, install the two packages, load the model, fingerprint one photo, and report three numbers: time per photo, the server's extra memory, and how much bigger the deploy is. **The limit:** no more than 200 MB of extra memory per server copy. The model loads on the first whole-island search, not at start-up, so other pages never pay for it. **If it fails or breaks the limit,** the build stops and comes back to Samuel with options (C from §4, or a slower version of the library that needs no compiled part).

## 6. Decision 3: where fingerprints are kept, and keeping them safe

### 6.1 Storage

**The question.** Neon (our database) offers pgvector, an add-on made for storing and searching fingerprints. Do we need it?

**What we checked (read-only, 21 October 2026):** pgvector 0.8.0 is **available but not switched on** in the production database. The test database CI uses (`postgres:16` in `.github/workflows/ci.yml`) and the one on the Mac (Homebrew `postgresql@16`) **don't have it**.

| | A. An ordinary table, ranked by the server **(recommended)** | B. pgvector |
|---|---|---|
| **What it is** | Each fingerprint is stored as a list of numbers. The server reads the ones it needs and ranks them itself | The database stores and ranks them, with a special index for very large collections |
| **Speed for us** | A few hundred cats is about 100,000 multiplications: under a millisecond. Fine at several thousand | The same at our size; better only at sizes we won't reach for years |
| **What it takes** | One ordinary database change | Switching the add-on on in production, a different CI database, and installing it on every database that runs tests |
| **Risks** | None new | More moving parts in launch week; a test database without it fails every run |
| **What the team sees** | Nothing | Nothing |

**Recommendation: A.** pgvector belongs to SYC-57, when the index extends to the whole sighting history. Moving later is a small change, because the numbers are the same.

**The table, `photo_fingerprints`:** the photo's id (one row per photo), which model made it, the numbers (scaled to length 1, so closeness is a plain dot product), and when it was made. **It holds no cat id.** Which photo shows each cat is worked out on every search by the existing rule (`catDisplayPhotoIds`), so the index can never disagree with what the public sees. Its link to `photos` deletes the fingerprint if a photo row is ever deleted.

**SYC-462's photo catalogue** (`lib/db/src/photoRemoval/catalogue.test.ts`, test T3) lists every column that points at a photo, and its test fails on a new one. The build adds `photo_fingerprints.photo_id` to it as "deleted on removal". The removal search scans list-type columns for photo addresses; the build makes it skip this table, whose lists hold only numbers, and says so in that file.

**Database change number:** **not claimed by this spec.** On fresh `origin/main` (21 October) the newest is `0034_photo_removal`. `0035` is used on the branch `claude/syc-396-pr-3-1b-vet-settings`, and PR 3.3a's `report_downloads` comes next. The build claims its number when it starts, after checking `origin/main` and the open branches, and posts it on SYC-396. Its production run shares Samuel's ask-mode switch with the other changes of that publish day.

### 6.2 Hidden and removed photos: no fingerprint, ever

**The rule:** a photo that is hidden or removed has no fingerprint in the table. Not just "not used": not kept.

**Where photos get hidden or removed** (checked on origin/main):
1. The team hides one on the dashboard (`setPhotoVisibility`, `lib/photoVisibility.ts`).
2. A welfare report hides one automatically (`applyHideRules`, `lib/issues/hide.ts`; SYC-44).
3. The written procedure hides one (`lib/db/src/photoRemoval/hide.ts`).
4. The written procedure removes one for good (`lib/db/src/photoRemoval/remove.ts`, SYC-462). It empties the picture and records who and why; it **doesn't delete the photo row**.

**How the rule holds, whatever writes the hide:**
- **Two database triggers delete the fingerprint**, in the same transaction:
  - every time a "hide" row is added to `photo_visibility_events` (all three hide paths write one; migration 0034 already uses a trigger on that table the same way);
  - every time a photo's picture is removed (the `removed_at` column is set).
- **Making a fingerprint re-checks first.** The save locks the photo's row, re-checks that it isn't hidden or removed, and only then saves (copying how `variantFor` saves photo versions, `lib/photoVariants.ts`). The hide triggers take the same row lock. So whichever goes first, a hide and a fingerprint can never both win:
  - hide first: the save waits, re-checks, sees the hide, and saves nothing;
  - save first: the hide waits, then its trigger deletes the new fingerprint.
- **And a search only reads fingerprints of current display photos,** which by the existing rule are never hidden or removed.

**Tests, each shown to fail when the thing it guards is taken out:** each of the four paths leaves no fingerprint; a hide racing a fingerprint save leaves none either way round; a source test fails if any new code writes a fingerprint without the locked re-check.

### 6.3 Everything else that changes a cat's photo

| What happens | What the index does |
|---|---|
| A new cat is named | Its display photo has no fingerprint yet; the next big search, or the backfill, makes one (§7) |
| A cat's main photo changes (SYC-163, later), or a stand-in takes over | The new display photo gets a fingerprint the same way. The old one's stays; it's a public photo's fingerprint, unused unless it becomes a display photo again |
| The team restores a photo | Nothing. The next search makes its fingerprint again if it's a display photo |
| Two cats are merged | Nothing. The cat merged away is no longer compared (`lib/teamCatList.ts` already leaves it out) |
| A cat dies, is homed or leaves Syros | Nothing new: the cats compared are the same as #252's |
| The model changes | Old fingerprints are ignored; the backfill makes new ones |

## 7. Decision 4: filling the index (the backfill, and new cats)

**The question.** Every cat's display photo needs a fingerprint before it can be ranked. When are they made?

**Why this matters more than it looks:** the 16 November release may bring Syros Cats' old records (SYC-49, "if Syros Cats want it", `mvp-launch-31-oct.md`). Any cats that arrive with photos then need fingerprints all at once, as they do after any model change.

| | A. A one-off backfill, plus filling gaps during a search **(recommended)** | B. Filling during searches only | C. Fingerprint the moment a cat or display photo appears |
|---|---|---|---|
| **How** | A command fingerprints every display photo that has none. It runs once at release, after any import, and after any model change. A search still fills small gaps, at most 15 seconds' worth | Each big search fills what's missing, up to a limit | The code that names a cat or hides a main photo also makes a fingerprint |
| **Benefits** | Big jobs never land on a team member's search; small gaps (a new cat this week) still get filled | Nothing to run by hand | New cats ready at once |
| **Risks** | One more command to remember. **It runs where the production database is reachable, so it needs Samuel's ask-mode switch**, like a database change | After an import, the first several searches each leave cats out and are slow | Touches sighting and hiding code that other work changes constantly; a missed path is silent |
| **What the team sees** | Usually nothing. Rarely: "12 newer cats weren't included this time" | After a big addition, several searches that leave cats out | Nothing |

**Recommended: A. Decided (Samuel, 21 October 2026): "Batch updates every night", his own option, plus "Nightly + small top-ups" as a follow-up.** So the index is filled in two ways:
- **A nightly batch,** built the same way as the nightly news check (`.github/workflows/news-nightly.yml`). A scheduled GitHub job calls a route on the app that only that job's token can open, and the app fingerprints every display photo that has none, oldest first, and reports how many it made and how many failed.
  - **The app does the work itself, so no ask-mode switch is needed**, unlike the command option A described.
  - The same job, started by hand, does the first backfill, and the batch after a records import or a model change.
  - **It needs a new job token,** set in GitHub and Replit from a file with no line break, in the same way as the news token. No token value goes in any routine, prompt or file.
  - **It runs only once the index ships** (the early fix release, §12), not before the freeze.
- **During a search**, missing fingerprints are made oldest first, for at most 15 seconds, so a cat added this morning can be found this afternoon. Any cat still missing is left out, and the page counts it: "12 newer cats weren't included this time. Choose an area to include them." Choosing an area of 30 cats or fewer always includes them, because that needs no fingerprints.
- **A photo that can't be fingerprinted** is left out of that search and counted the same way. Nothing is stored about the failure; the next night's batch tries it again.

**Measured cost and time:** no money (no AI service is used). On the Mac, 44 ms a photo: the island's 28 photos take about 1–2 s. **On Replit: unchecked until §5's first task measures it.** The build writes the real figure on SYC-527.

## 8. Decision 5: does the right cat make the 20? (accuracy)

**The question.** The index only helps if the right cat is nearly always on the shortlist. How do we know, and how long should the shortlist be?

**What there is to test on** (read-only, 21 October 2026): 35 confirmed sightings with a photo across the 28 cats, and only **6 cats** with more than one photo. That's about 7 test searches.

**Why that isn't enough on its own:**
- With 28 cats, a shortlist of 20 would include the right cat 71% of the time **by pure chance**.
- Two photos of the same cat from the same visit look almost identical, which flatters any method.
- These models look at the whole photo, background included. Street cats at one feeding site share a background, so the index may rank "photos taken at the same spot" close together. That helps when the team's photo comes from the cat's usual spot, and hurts when it doesn't.

**The check, run by the build before the page changes:**
1. **A smoke test on the island's own photos.** For each cat with two confirmed, visible photos **taken on different days**: search with the one that isn't its display photo, against every active cat. Record the right cat's rank. Only ranks are written down, and no photo leaves our systems. It passes if every one is in the top 10. It shows the index isn't broken; it can't show the index is good.
2. **A larger set of individually known cats,** used only on the Mac and never uploaded: at least 100 cats, with two or more photos each taken on different occasions. **Unchecked: which public collection, and whether its licence allows this.** If none fits, the build says so, and the only measure until SYC-56's launch-era set exists is the smoke test.
   - **It passes if the right cat is in the top 20 at least 90% of the time.** That bar means 1 search in 10 might miss the right cat, which the page's "if you know where, choose the area" line (§9.3) is there to cover.
   - The check also records how often the top 20 are mostly cats from one place, to see how much background sways it.
3. **Both models** run on both sets, chosen by §4's rule.

**Choosing the shortlist's length (K):**

| K | AI calls | What the team sees | Benefits | Risks |
|---|---|---|---|---|
| 10 | 1 | The quickest answer | Cheapest | The right cat must be in the closest 10: least room for different light or angle |
| **20 (recommended)** | 3 | The same results page; a few seconds slower than K=10 | Twice the room, and still one call fewer than today's largest narrowed search | — |
| 30 | 4 | The slowest | Most room | Today's maximum calls, for little gain if 20 passes |

**Recommended: 20. Decided (Samuel, 21 October 2026): "Let the test decide".**
- K is 20 by default.
- It becomes 10 if, on check 2, the right cat is in the top 10 within 2 percentage points as often as it is in the top 20, and the smoke test still passes at 10.
- If check 2's set isn't available, K stays at 20. The results go on SYC-527, and become the first small entry in SYC-56's baseline.

## 9. Decision 6: the page

### 9.1 Anywhere beside area and colony

**The question.** Does *Anywhere on the island* replace choosing a place, or sit beside it?

| | A. Both kept, *Anywhere* chosen first **(recommended)** | B. Both kept, a place chosen first | C. *Anywhere* only |
|---|---|---|---|
| **What the team sees** | "Where to look: Anywhere on the island · An area · A colony", with *Anywhere* picked unless they came from the Cats page with an area or colony | The same three, with *An area* picked | No place choice |
| **Benefits** | What Syros Cats asked for is the obvious path, and a place is one tap away | Nudges toward the surer search | Simplest page |
| **Risks** | Some searches that could have been narrowed won't be | Syros Cats' request is a step away | Throws away the surer search for a resident's photo from a known street |

**Recommendation: A**, with the line "If you know where the photo was taken, choosing the area is surer."

**A large area** (more than 30 cats) is no longer refused: it uses the index within that area. Colours stay optional for every choice. The place rule lives in five places today, and each changes together: `hasPlace` in `lib/findFromPhoto.ts`, the route's check (`routes/teamCats.ts`), `findFilters`, the form page and the "tie a report" flow.

### 9.2 The words before the search

- *Anywhere*, 30 cats or fewer: "**28 cats to compare** across the island."
- *Anywhere*, more than 30: "**412 cats on the island.** The app picks the 20 whose photos look most like yours, then compares those closely. This can take up to a minute."
- A place: #252's words ("12 cats to compare"), or the line above with the area's count.

### 9.3 §5.2's "less sure" sentence

#252's sentence stays when every cat was compared: "This is less sure than the app's matching, because it compares more cats at once and has no exact position. Check the photos yourself."

**When the shortlist was used:** "This is less sure than the app's matching. It first picked the 20 cats whose photos look most like yours. A cat photographed in different light, from another angle or somewhere else can be missed. Check the photos yourself, and if you know where the photo was taken, try choosing the area."

**The results line:** "Compared closely with the 20 of 412 cats whose photos look most like yours", or #252's "Compared with 28 cats".

**No close match:** "No close match among the 20 cats whose photos look most like yours. Try choosing an area, or browse the cats." The browse link opens the Cats grid, filtered by area when one was chosen.

These are **team-only words**, in English like the rest of the dashboard. They aren't in Johnny's translation pack (SYC-346), so the 22 October copy freeze doesn't bind them. #252 had none either.

### 9.4 When the index can't run

"Searching the whole island isn't working right now. Choose an area or a colony to search without it." No search is used up: this happens before the caps are counted (§3). A place with 30 cats or fewer still works, because it never needs the index.

### 9.5 The caps

**Unchanged:** 20 a person and 100 for the team, per calendar day (SYC-496). A shortlist search makes 3 AI calls, so the most the AI service can be billed for in a day stays at 400 calls (100 searches of at most 4). Fingerprints cost no money. **The money per call is still unchecked:** the app logs no tokens (SYC-493). SYC-534 adds that logging.

## 10. Decision 7: privacy

- **The team's photo:** re-encoded (no location data), fingerprinted in memory only, compared, and forgotten. Its fingerprint never goes to the database, a log line or an error report. **Test:** after a search, no fingerprint row exists for anything but the compared cats' display photos (checked by photo id, so other tests on the shared test database can't upset it).
- **Hidden and removed photos are never fingerprinted, and lose any fingerprint they had** (§6.2).
- **No new company sees any photo** with §4's recommendation. The model file is kept in our code (§5), so nothing contacts Hugging Face at all.
- **No positions in addresses.** *Anywhere on the island* is one more value of the existing place choice, with no position and no name. Spec §10.4's rule and its tests are unchanged.
- **The privacy policy:** nothing changes with on-server fingerprints. A hosted service (§4, option C) would have to be named before launch.

## 11. Decision 8: who can use it

| | A. The team only **(recommended)** | B. Cat guardians too (`match_cat_anywhere`) |
|---|---|---|
| **What it means** | The same as Find from a photo today: `find_cat_from_photo`, island-wide team members | A guardian could search every cat on the island |
| **Benefits** | No new permission, and no new tests of who sees what | Guardians could identify a cat that wandered in from elsewhere |
| **Risks** | Guardians still ask the office | A guardian would see photos and names of cats in colonies that aren't theirs, which spec §10.2 keeps from them. `roles-and-invites.md` note 3 reserves this until a guardian can upload her own sighting in the dashboard, which doesn't exist |
| **What guardians see** | No change | A new search page |

**Recommendation: A.** `match_cat_anywhere` stays reserved. A guardian who tries the route still gets the refusal page; #252's route test is extended to the *Anywhere* choice.

## 12. Decision 9: does it fit by 28 October?

**The picture** (21 October; `docs/superpowers/plans/syc-396-phases-2-4.md`, "Fit to 31 October", and Samuel's new build order on SYC-396):
- **Building now or next:** PR 2.3.1 (draft #256), then 3.1a, 3.1b (branch exists) and 3.3a in parallel. **At most three building agents at once** share the test database on the Mac.
- **The critical path** is 2.3 → 3.1 → 3.2, each needing a review and one of Samuel's merge windows. Publishes left: Fri 23, Mon 26, and the freeze on Wed 28.
- **This feature with the index** (estimate): the Replit check (§5), the accuracy check (§8), the table and two triggers, the fingerprint code, the backfill command, the page, and the tests above. **About 2–3 building days**, plus a review and a merge window, and one database change sharing an ask-mode switch. Its biggest unknown is the compiled model software on Replit, which only trying will answer.
- **The index has nothing to do at launch.** With 28 cats, every whole-island search compares 30 or fewer and doesn't use it.
- **The headroom is small:** 2 cats. No cat has been added since 29 September, but launch opens the app to tourists. **How fast cats will be added after launch is unchecked.**

**The options**

| | A. Everything before the freeze (Samuel's 21 Oct timing) | B. *Anywhere* before the freeze; the index after launch, with its riskiest part checked this week **(recommended)** | C. Everything after launch |
|---|---|---|---|
| **What ships by 28 Oct** | *Anywhere*, the index, the table, the model on Replit | *Anywhere on the island*, comparing every cat while the island has 30 or fewer. That's the five place-rule changes in §9.1, the page words and their tests: **an estimated half to one day**, with no database change and no model | Nothing |
| **Also this week** | — | **§5's Replit check** (an hour or two, a throwaway branch, nothing published), so the index's biggest risk is known before the freeze | — |
| **What Syros Cats get at launch** | A whole-island search | **The same**, while the island is 30 cats or fewer | They must still choose a place |
| **Then** | — | The index ships in the 16 Nov release, with the backfill command run at that release and after any records import. If the island passes 30 before then, *Anywhere* asks for an area again, and the page says why | — |
| **What slips** | A building slot taken from 3.1a, 3.1b or 3.3a. By D2's slip order the reports (3.3) go first. And new compiled software goes into the freeze publish | Nothing on the critical path | Nothing |
| **Risks** | A failed model install found in freeze week | The island passes 30 before 16 Nov (2 cats of headroom), and *Anywhere* stops working in the weeks after launch. If the Replit check passes cleanly, the index could instead go in an early fix release | Syros Cats' request is unmet at launch |

**Recommendation: B.** It gives Syros Cats what they asked for on launch day, at a fraction of the work, and keeps new compiled software and a database change out of freeze week. Running the Replit check this week means the index's biggest unknown is answered before the freeze rather than after it. This keeps Samuel's decision on approach C and changes only when the index lands, so **it's Samuel's call**. If he prefers A, the build starts as soon as this spec is approved, and §5's check decides by Friday whether it can make the Mon 26 publish.

**Decided (Samuel, 21 October 2026): "Anywhere now, index when ready".** This is B, except that the index doesn't wait for 16 November: it ships in an early fix release as soon as it is built and reviewed, which closes the 2-cat headroom gap sooner. The cost is one more publish in the busy week after launch.

## 13. How it's built (outline for the plan)

It comes in three pieces, in this order:

**Piece 1, before the freeze (Wed 28 Oct): *Anywhere on the island*, with no index.**
- *Anywhere* is the first choice, with area and colony kept (§9.1).
- While the island has 30 cats or fewer with a display photo, it compares every cat exactly as #252 does.
- Over 30, it asks for an area or colony, and says why: "There are now too many cats to compare them all at once. Choose an area or a colony."
- It changes the five places the place rule lives (§9.1), the page words and their tests. There's no database change and no model.
- Team only, with the guardian refusal test extended.

**Piece 2, this week: the Replit check** (§5), on a throwaway branch, with nothing published. Its numbers go on SYC-527.

**Piece 3, the index, for an early fix release:**

1. **The accuracy check** (§8) on both models. Choose the model and K.
2. **The database change:** `photo_fingerprints` and its two triggers (§6), with its number claimed at build start.
3. **`lib/photoFingerprint.ts`:** load the model from disk once; make a fingerprint from a photo's medium version; save it with the locked re-check; rank a set of display photos against an in-memory fingerprint; one fill at a time per server copy.
4. **`lib/findFromPhoto.ts`:** the order in §3; over 30 cats, fill (15 s), rank, keep K, then read those K photos and compare as now.
5. **The nightly batch** (§7): a token-protected route, a scheduled GitHub job modelled on `news-nightly.yml`, and the new job token rolled out from a file with no line break.
6. **The page words** for shortlisted searches (§9.2–§9.4).
7. **Logging:** each search logs which path it took, the number of cats, how many fingerprints it made, how many were left out and how long it took. Counts and times only: never a photo id, never a fingerprint.
8. **SYC-462's catalogue** updated (§6.1).

**Tests, each shown to fail when the code it guards is broken:** the upload's fingerprint is never stored; every hide and removal path leaves no fingerprint, including when racing a save; a search reads only display photos' fingerprints; with 30 cats or fewer the index isn't touched and #252's comparison runs unchanged; over 30, exactly 20 cats' photos are read and 3 AI calls are made; a model failure gives §9.4's page and spends no search; the 15-second fill limit leaves cats out and counts them; a guardian is refused.

**Review:** an adversarial review on the PR, in its own worktree, focused on §6.2's race, privacy, and the model on Replit.

## 14. Deferred (filed in Linear)

- **SYC-534:** log the AI tokens each call uses, so the cost per search stops being unchecked.
- **SYC-57** (existing, comment added): pgvector, when the index extends to the whole sighting history.
- **SYC-56** (existing): a larger accuracy set from launch-era confirmed sightings. §8's check is its first small entry.
- **`match_cat_anywhere`** stays reserved (existing note 3; no new ticket).

## 15. How the adversarial review was handled

| # | Finding | Where it's handled |
|---|---|---|
| 1 | Blocker: a fingerprint save could land after a hide's delete; removal never deletes the photo row | §6.2: triggers on hide and removal, a locked re-check before every save, a race test |
| 2 | A third hide path (`lib/issues/hide.ts`) was missed | §6.2: all four paths listed; the trigger covers any path that writes a hide |
| 3 | The order against the caps was contradictory; #252 reads every cat's photo | §3: the full order, nothing before the gate counts, photos read for the 20 only, one fill at a time |
| 4 | Filling during searches fails after a big addition (records import, model change) | §7: a nightly batch (Samuel's choice) plus a 15-second fill; "three months" replaced with sourced dates |
| 5 | Option B has 2 cats of headroom; the forecast was unlabelled | §12: headroom stated, forecast labelled unchecked, the Replit check moved into this week |
| 6 | The accuracy check couldn't answer the question; background bias | §8: check 1 is a smoke test on different-day pairs; check 2's dataset marked unchecked; the 90% bar explained; background measured; a model-choice rule (§4) |
| 7 | The deploy story was thin | §5: the model kept in our code, every file to change listed, a 200 MB memory limit, the check first |
| 8 | Time and load: no limit, no lock, no progress line | §3 (one fill at a time), §7 (15 s), §9.2 ("up to a minute"); the save skips a fingerprint that already exists |
| 9 | The new table trips SYC-462's catalogue and its scan | §6.1 |
| Minor | "One rule changed" was optimistic | §9.1 lists the five places; §12 re-estimates |
| Minor | Words: background, "look most alike" | §9.3 rewritten |
| Minor | Jargon | The word list in §1; technical names kept only where a builder needs them |
| Minor | Decision numbering, §4.1 with no options, K table missing what the team sees | Decisions numbered 1–9; §5 and §8 now have both |
| Minor | Unlabelled claims (DINOv2 vs CLIP, estimates) | Labelled unchecked or estimate |
| Minor | CLAUDE.md: "never distinguish built today vs proposed" | Kept to a minimum. This spec changes a live feature, so it names what #252 does where a builder needs it; flagged to Samuel |
| Nits | Normalising, the racy row-count test, vectors in logs, orphan fingerprints | §6.1 (scaled to length 1), §10 (checked by photo id), §13 (never logged), §6.3 (kept, harmless) |

## 16. Changes to `team-dashboard-redesign.md`

- **§5.2 Narrowing:** "Required: a named area, or a colony" becomes "Where to look: anywhere on the island, a named area, or a colony". Over 30 cats, the app shortlists the 20 whose photos look most alike instead of refusing (this spec §3).
- **§5.2 What the page says plainly:** add §9.3's sentence for shortlisted searches.
- **§5.2 Cost:** "at most 4 AI requests" stands; a shortlisted search makes 3.
- **§13:** add §9.4's error and §7's "weren't included" line.
- **§14:** add the looks-like index: an on-server model, fingerprints in an ordinary table, one per photo, removed by triggers on hide and removal.
