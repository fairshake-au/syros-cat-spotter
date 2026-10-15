# SYC-161: each cat's colour read from its photo, and the colour chips in "Find the cat"

**Status: draft for Samuel's approval. Nothing is built.**
**Ticket:** SYC-161 (Urgent). Parent SYC-119. It builds on SYC-2 (Decision A1 of `syc-2-coat-markings-and-health.md`).
**Specs:** `docs/specs/choose-a-different-cat.md` §4.7, §4.5, §6, §8.4, §9 and §10, as amended by `docs/specs/coat-markings-and-health.md` §4.2, §7.2, §8, §10.2, §10.4 and §10.7, and `DECISIONS.md` Part 2n (including SYC2-D10). Samuel's 30 September answers to the SYC-119 plan still stand: Decision 2A (a background job fills in existing cats; nobody has to run it by hand) and Decision 3A (the chips appear only once existing cats have been read).
**Checked against:** `origin/main` at `ad38e17` (15 Oct 2026). Live build `f03901a` carries SYC-2 PR 2.1. That comes from SYC-2's comment of 15 Oct 06:41 UTC; I did not probe `/api/healthz` again. I also checked: the open PRs #146, #172, #174, #176, #178–#181; Linear SYC-161 (all 6 comments), SYC-2 (all comments), SYC-329, SYC-56 and SYC-119; and the MVP launch plan on PR #172 (`docs/superpowers/plans/mvp-launch-31-oct.md` on branch `claude/xenodochial-zhukovsky-df315f`). Every "exists today" claim names the file I read it in.

---

## In plain English

Today a cat's colour shows only once someone on the team has described it. Production has no colour records at all (SYC-2's read-only check, 15 Oct), so every cat shows no colour.

When this plan is built:

- **Every cat with a photo gets a colour, read once from its photo** by the same AI model that already compares cats for matching. Examples: "Ginger · Tabby", "Black and white". When the model can't tell, the answer is **Not sure**. That happens when the photo is dark or blurred, shows two cats or none, or the model isn't confident. A Not sure cat simply shows no colour.
- **Existing cats get colours Samuel has checked first** (Decision A). **New cats get their colour within seconds of being named**, once the team can fix a wrong colour (SYC-2 PR 3.1). When the team hides a cat's photo, the colour is read again from the photo the public now sees.
- **People still have the final say**, by SYC-2's rules, unchanged. The team or a cat guardian always wins. Two spotters who agree beat the machine. One spotter alone fills a gap but never overturns a real reading. A later reading never beats the team or a guardian.
- **"Find the cat" gets a row of colour chips**: *All · Black · White · Ginger · Grey · Tabby · Tortoiseshell or calico · Black and white · Not sure*.
  - *All* is on until someone taps a colour, and more than one can be picked.
  - Cats whose colour isn't known **always stay in the list**, under their own heading, "Colour not known".
  - A line just above "Can't find it? Add it as a new cat" says how many cats the filter is hiding, with one tap to show them all.
  - It all works offline, from the cat-alog already saved on the phone.

**What it costs:** one model call per cat. Production has 28 cats (live payload, 15 Oct), so the first fill-in is about 28 calls. A trial run beforehand reads them once more and writes nothing, another 28 calls at most. After that, each new cat costs one call. Each colour call sends **one** photo. A matching call sends the new photo plus up to 10 nearby cats' photos (`candidateSelection.ts:18`, `MAX_CANDIDATES = 10`). So one colour call costs less than any matching call that has a candidate. I did not look up this model's price per call: **unchecked**.

**No database change** is needed (§ "Migrations").

### What people notice, step by step

| Step | What changes for people |
|---|---|
| **PR 1: the colour reader** | Nothing. The server can read a colour, but nothing starts it automatically |
| **Trial run** (on production, writes nothing) | Nothing public. Samuel sees a contact sheet of every cat's photo beside the colour the model gave it |
| **Checked fill-in run** | The colours Samuel agreed with appear on cats' pages and on "Find the cat" cards (SYC-2 PR 2.1 already shows them) |
| **PR 3: the chips** | Spotters can filter "Find the cat" by colour |
| **PR 2, switched on once the team can fix a colour** | New cats show a colour seconds after they're named. A hidden photo leads to a fresh reading |

---

## What exists today, and what this plan needs

| Area | Today on `main` | Read in |
|---|---|---|
| The colour list | `COAT_COLOURS` (the eight, `not_sure` included), `normaliseColours()` (black + white → `black_and_white`). These are the only definitions; nothing else may list colours | `artifacts/api-server/src/lib/appearance.ts` |
| Writing a machine reading | `writeObservation` accepts `coat` from `roleAtTime: "system"` only with `provenance: "machine"`; `machine` only from `accountId: "system:vision"` (already on `SYSTEM_AUTHORS`); `modelVersion` required on a machine coat and refused on any other; 1–2 colours; `not_sure` alone; black + white refused unless normalised. A system author may supersede only its **own** row. `suggestionSource` starting `backfill:` is **refused** (reserved for migrations) | `lib/observations.ts:131-148`, `:343-415`, `:690-700`, `:783-789`, `:806-817`, `:878-890` |
| Which reading counts | `resolveCoat`: rule 1 team/guardian; rule 2 two independent spotters; rule 3 **the machine's newest reading only**, by `observedAt` then id; if that row is Not sure or was marked wrong, the machine has no reading and an older one never comes back; rule 4 one spotter fills a gap; rule 5 Not sure (`value: null`) | `lib/resolve.ts:1008-1180`, `isNewer` at `:849` |
| The public field | `serialiseCat` sends `coat` (a list; `[]` = not known) and nothing else about it; R7a pins the only two reads | `lib/catHelpers.ts`; `lib/appearance.notNotifiable.test.ts` |
| Guards | Notifiers, `matching.ts` and the rest of `catHelpers.ts` must not read colour (source tests, including destructuring). **`candidateSelection.ts` is not covered** | `lib/appearance.notNotifiable.test.ts` |
| The matcher | `matchCatPhoto` calls `openai.chat.completions.create({ model: "gpt-5.6-terra" })` through the Replit OpenAI integration. The model name is a literal inside `matching.ts`. The client needs `AI_INTEGRATIONS_OPENAI_*`, which exist only inside Replit | `lib/matching.ts:46`; `lib/integrations-openai-ai-server/src/client.ts` |
| Photo bytes | `photos.data` (base64) and `photos.mime`, read by id | `routes/sightings.ts:272-283` |
| Which photo the public sees | `catDisplayPhotos`: the main photo (`cats.primary_photo_id`, never changed); if the team hid it, the newest unhidden photo from the cat's resolved sightings; if all are hidden, none. **The only place this is decided** | `lib/photoVisibility.ts:12-20`, `:84-135` |
| Hiding and restoring | `setPhotoVisibility` (team photos route; SYC-44's report hide uses it too) | `lib/photoVisibility.ts:~185`; `routes/teamPhotos.ts` |
| New cats | Created **by a public route**: `POST /sightings/:id/resolve` with `newCatName`, main photo = the sighting's photo, inside a transaction. Every such sighting already went through the AI-limited upload | `routes/sightings.ts:728-790`; `routes/sightings.aiLimiter.test.ts` |
| Background work | No scheduler. The production server is Replit **autoscale** (`.replit`). Periodic work rides `POST /api/internal/mail/drain`, called every 2 hours by the `mail-drain-cron` Worker and every 3 hours by a backup GitHub workflow (which can also be run by hand). It carries `MAIL_DRAIN_TOKEN`, which "opens exactly one path". The keep-safe and rate-limit sweeps ride it. Work after a response already exists: `opportunisticRoundUp` uses `res.on("finish")` | `routes/internalMail.ts`; `.github/workflows/mail-drain.yml`; `lib/internalAuth.ts:41-63`; `middlewares/prelaunchGate.ts:96`; `lib/sightingRoundUp.ts:218` |
| Shared counters | Database-backed rate-limit buckets (`declareLimit`, `consume`), shared by every server | `lib/limits.ts:111`, `:181` |
| Team fix for a wrong colour | **None yet.** `POST /team/statements/:id/wrong` works only for kinds `capabilityFor` maps (life status, sterilised, ear tip, colony). Colour arrives with SYC-2 PR 3.1 (Appearance section), which **no session is building** (session list, 15 Oct 14:45 UTC) | `lib/teamCorrections.ts:52-65`; `routes/teamCorrections.ts:424` |
| The app | `COAT_LABEL_KEYS` maps the seven public colours to `coat_*` keys. `coat_not_sure` exists in `en`, `el` and `fr`. `catPicker.ts` has `pickerList` (nearest first, then search). `CatPicker.tsx` says "Not in this slice: the colour chips". The cache key is `cat-spotter/cats-cache/public/v2`, with a test guarding it. `react-native-svg` is installed | `artifacts/cat-spotter/lib/appearance.ts`; `lib/i18n.ts:533-544`; `lib/catPicker.ts`; `components/CatPicker.tsx:11`; `lib/catalogue.ts:17`; `package.json:68` |
| The launch plan | SYC-161 is **not** in PR #172's must-launch list, publish calendar or cut list. Copy freeze is **Thu 22 Oct**. Publishes are on 16, 19, 21, 23, 26, 28 and 29 Oct | `mvp-launch-31-oct.md` (PR #172) |

### Migrations

**None.** `observations.kind` and `value` are free text and `jsonb`. `coat`, `system:vision` and `machine` already exist. The fill-in run's bookkeeping uses the existing rate-limit counters and the observations themselves. If a PR finds it does need a migration after all, it stops. It then takes the next free number after rebasing on the latest `main`, which is 0025 or higher today, agreed with the live sessions first. It never picks a number by hand.

---

## Where the specs, the earlier plan and the code disagree

| # | Written down | The tree, or a later decision | What this plan does |
|---|---|---|---|
| **K1** | Spec §4.7 and SYC-119 plan Slice C: "the first reading **can** ride along with the matching call" | SYC2-D8 and the source guard: `matching.ts` may not name colour at all. The matching call also runs **before** the cat exists, for every sighting, not just new cats | A separate one-photo call after the new cat is saved (Decision C). The matching prompt is untouched |
| **K2** | Spec §9: "the payload change bumps the cat-alogue cache version" | SYC-2 §10.4: no bump; `coat` already ships in v2; the cache-key test guards it | No bump. PR 1 corrects the §9 sentence |
| **K3** | SYC-119 plan Slice C: "a background job after start-up reads a few cats a minute" | Autoscale has no always-on process. The tree's pattern is "rides the drain" | Decision 2A kept in substance: nobody runs anything by hand once PR 2 is live. The job rides the drain and the new-cat moment, not start-up |
| **K4** | SYC-119 Decision 3A: "the server says when it's ready, and the app shows the chips from then" | Nothing like that exists, and it would be one more public field | The order does the job instead: the chips (PR 3) merge only after the fill-in run has read every cat it can. No "ready" flag |
| **K5** | Spec test 14: "a filtered list is the unfiltered list with cats removed, still nearest first" | Spec §4.7 puts "Colour not known" cats in their own section *under* the matching ones | Read together: **each section** is the unfiltered list with cats removed, in the same order. The test asserts exactly that |
| **K6** | Spec §4.7: wrong colours are fixed "by the team with one tap" | No team route can mark a colour wrong until SYC-2 PR 3.1 | **Decision A** |
| **K7** | This plan's brief: "No public route triggers a reading" (from spec §12 C8: "no public route changes a main photo") | New cats are made by a public route, and the spec also wants "one model call per cat when it joins" | **Decision C**. Whichever is chosen, the public can never cause a **second** reading of a cat (§ "The reading rules", rule R4) |
| **K8** | Spec §4.7: "If a call fails, the cat is Not sure" | Writing a Not sure row on failure would stop the photo ever being retried | A failed call writes **nothing**. The cat is not known on the wire anyway (`[]`). It is retried, with a limit (rule R6) |

PR 1 makes the two document fixes K2 and K1 (a pointer from §4.7's "can ride along" to this plan). The SYC-119 plan's Slice C gets a one-line pointer to this plan.

---

## Decisions for Samuel

Four decisions. **A and B matter most**. C and D are smaller.

### Decision A: when should machine colours start showing, given the team can't yet fix a wrong one?

**The question.** Once a reading is written, it shows on the cat's page and its "Find the cat" card at once (SYC-2 PR 2.1 is live). The model will get some wrong; tabby and tortoiseshell are the usual mix-up. Today nobody can undo a wrong colour, because the team's "Mark wrong" for colour arrives with SYC-2 PR 3.1, and nobody is building that yet.

| Option | What it means | Benefits | Risks | What people notice |
|---|---|---|---|---|
| **A1. Checked colours now, automatic colours later (recommended)** | The trial reads every existing cat and writes nothing. Samuel looks at a contact sheet: each cat's photo beside the colour the model gave it. The fill-in run then writes only the colours he agrees with; any he rejects are left out, and those cats stay "colour not known". New cats are read automatically only once the team can mark a colour wrong (SYC-2 PR 3.1). Until then they are "colour not known", which the filter never hides | No unchecked colour goes public before it can be fixed. Doesn't wait on SYC-2 PR 3.1, so the launch dates in Decision B can hold. A rejected reading is never written, so SYC-56's accuracy data stays clean. The contact sheet doubles as a first accuracy measure | Samuel spends about five minutes on the contact sheet. New cats show no colour until SYC-2 PR 3.1 is live | Colours on existing cats within a day of PR 1 going live, and the chips soon after. New cats gain colours later |
| A2. Wait for SYC-2 PR 3.1 before writing any colour | As A1, but the fill-in run also waits for 3.1 | Every colour is fixable from the moment it is public | Waits on a PR nobody has started, so the 23 and 26 October slots (Decision B) can't hold | Nothing until 3.1 is live |
| A3. Go live as soon as each PR merges, unchecked | Colours and chips appear as soon as the fill-in run is done | Fastest | A wrong colour stays public, with nothing anyone can do, until 3.1. A cat filed under the wrong colour drops out of a filtered list; the "N more cats" line is the only safety net | Colours at once; some wrong ones that stay wrong for a while |
| A4. SYC-161 builds a small "Mark wrong" for colour itself | One team button that marks a machine colour wrong, built in PR 1, ahead of SYC-2 PR 3.1 | Fixable from day one, with no wait | Builds part of SYC-2 PR 3.1 twice, or pulls it into this plan. That work belongs to SYC-2 (Decision A1 of its plan) | As A3, with fixes possible at once |

**Recommendation: A1.** With 28 cats a human check is cheap, and it leaves nothing wrong and unfixable in public. SYC-2's stream is still asked to make PR 3.1 its next PR, because automatic reading for new cats waits on it.

### Decision B: does any of this go out before the 31 October launch?

**The question.** The launch plan (PR #172) doesn't mention SYC-161. The chips add six new sentences that need Greek and French, and Johnny's check starts with the copy freeze on Thu 22 Oct.

| Option | Benefits | Risks | What people notice at launch |
|---|---|---|---|
| **B1. Aim for launch, never block it (recommended)** | The chips' words go into Johnny's pack by 22 Oct, whether or not the chips ship. PR 1 fits the Fri 23 Oct publish, then the trial and the checked fill-in run (Decision A1). PR 3 fits Mon 26 Oct. PR 2 is published switched off and switched on once SYC-2 PR 3.1 is live, whenever that is. If anything slips, SYC-161 goes in the first week of November, ahead of the launch plan's own cuts. **Not on the must-launch list** | Tourists in busy Ermoupoli get the filter from day one, which is when duplicates are most likely | Two more PRs through Samuel's merge windows in the busiest fortnight | The chips, if everything lands; otherwise nothing changes |
| B2. After launch | Nothing extra in the launch fortnight | The colour filter misses the first weeks of real tourist use; spotters' "Ginger · Tabby, right?" (SYC-2 Slice 4) waits too | Nothing |

**Recommendation: B1.** It adds no risk to the date, because SYC-161 is never on the must-launch list. The launch-plan session (`local_78021dc8…`) is told, so the calendar can show it.

### Decision C: how soon does a new cat get its colour?

**The question.** A new cat is created when a member of the public names it. Reading its colour at that moment means a public action starts a model call. The spec counted that call in its costs, but the brief for this plan says "no public route triggers a reading". SYC-2's spotter question ("Agatha looks Ginger · Tabby, right?") appears on the screen straight after naming, and needs the colour to be there.

| Option | What it means | Benefits | Risks | What people notice |
|---|---|---|---|---|
| **C1. Read it right after the new cat is saved (recommended)** | Once the naming has finished, the server reads the new cat's photo in the background, so the spotter's screen never waits. If that is missed (the server can go quiet once it has answered), the catch-up run a couple of hours later reads it instead | The colour is there within seconds. SYC-2's one-tap question works as designed. Still one call per cat | Naming a cat, which anyone can do, starts one model call. It can only ever be one per cat, because a photo is never read twice. Every new cat has already cost a bigger matching call, and photo uploads are already limited per phone. New-cat readings also get their own small hourly allowance, so a burst of new cats can't use up the catch-up run's | New cats show their colour almost at once |
| C2. Only the catch-up run reads new cats | Every couple of hours the server catches up on cats with no colour, new ones included | Keeps the brief's wording to the letter: nothing the public does ever starts a call | For up to about 2 hours a new cat has no colour. SYC-2's question after the points would usually show empty chips | Colours appear on new cats a while later |
| C3. Ask the matching call for the colour as well (the spec's "ride along") | The model gives a colour for every sighting photo during matching | No extra call | It changes the matching prompt, which nobody can measure yet (SYC-56 isn't built). It breaks SYC2-D8's rule and its guard, and reads colour for every sighting, not just new cats | Same as C1, with a risk to matching quality |

**Recommendation: C1.** The rule the brief quotes exists to stop the public running up the bill (spec §12 C8). C1 keeps that protection, because the public can't trigger a second call for any cat. If Samuel prefers the brief's letter, C2 is the safe alternative.

### Decision D: how the fill-in run is started, checked and kept going

**The question.** The model can only be called from inside the live server, because the AI keys exist only in Replit. So the trial and the fill-in run have to be started by a call to the live server, with a password the server checks.

| Option | Benefits | Risks | Samuel's hands |
|---|---|---|---|
| **D1. Reuse the password the mail job already uses (recommended)** | No new secret. Claude starts the dry run, the trial and the fill-in run from a GitHub button, and the catch-up run rides the existing mail job every couple of hours | That password now opens two doors, not one, and the second can spend money on model calls. If it leaked, the most anyone could do is make the server read colours that are due anyway: a photo is never read twice, and an hourly allowance caps the calls (about 60 an hour at most). Like the mail job, the new GitHub button only ever sends the password to the real app's address | None |
| D2. Same, with its own new password | The mail job's password keeps its single meaning, and a leak of one doesn't open the other | One more secret to keep in Replit and GitHub | One paste into Replit's Secrets tab, and one publish |
| D3. No manual start; only the automatic catch-up run (the 30 Sept Decision 2A, word for word) | Least code | No dry run or trial before colours go public, and no way to leave out readings Samuel rejects (Decision A1) | None |

**Recommendation: D1.** A leak could only bring forward work that would happen anyway, at a capped cost. That's why I don't think it needs a new secret, and Samuel has no step to take. Technically: `POST /api/internal/coat/sweep`, opened by `MAIL_DRAIN_TOKEN`, through a new `coat-readings.yml` workflow.

---

## The reading rules (the heart of it)

These are the rules for **when** to read and **what** gets written. They sit on top of SYC-2's rules for which reading wins, and never replace them.

- **R1. Which photo.** The reader reads the photo the public sees for that cat. One place decides that: `photoVisibility.ts`.
  - `catDisplayPhotos` returns web addresses, not photo ids, so PR 1 adds `catDisplayPhotoIds` beside it. It shares the same stand-in code, and `catDisplayPhotos` is rewritten on top of it.
  - A test asserts that the two always agree. Nothing parses an address back into an id.
  - The reader never reads a hidden photo, so a photo the team hid for privacy is never sent to the model.
  - A cat with no public photo is not read.
- **R2. When a cat is due.** A cat is due if any of these holds:
  1. it has **no machine row at all** (counting rows the team marked wrong and Not sure rows), and it has a public photo;
  2. its main photo is public, and the machine's newest reading is not of the main photo. This covers a restored main photo and SYC-163's future "choose a main photo". If the main photo was read before, see R4: no new model call;
  3. its main photo is hidden, and the photo of the newest reading is no longer public. This covers hiding.

  **A new sighting never makes a cat due by itself.** When the main photo is hidden, the stand-in photo the public sees changes with every new sighting. Reading again each time would let the public trigger readings, so a reading stands as long as its own photo stays public.

  Cats with a standing team or guardian colour are still read. The call costs little, and SYC-2's Colour check list compares the machine's reading with people's.

  **When every photo is hidden, or the main photo is deleted, the last reading stays.** The cat's colour is still true even when its photo isn't public, and the machine can't withdraw its own reading without reading something. A team member who thinks it is wrong marks it wrong (SYC-2 PR 3.1).
  - Today a deleted main photo gets no stand-in in `catDisplayPhotos`, whatever this plan does. That's a gap in photo display, not in colour, and SYC-44 PR 7.2 (deleting hidden photos for good) gets a comment about it.
- **R3. One reading is one new row.** Each reading is a new `coat` observation, never an edit and never a supersession:
  - `accountId: "system:vision"`, `roleAtTime: "system"`, `provenance: "machine"`;
  - `photoId` = the photo read;
  - `value: { colours, modelVersion }`, with the colours passed through `normaliseColours`;
  - `observedAt` = **the moment of the reading**, never the photo's date. "Newest machine reading" must mean the last one read, or a reading of an older stand-in photo would lose to the reading of the photo it replaced. Colour is not evidence of life, so the date says nothing about whether the cat is alive.
  - The model's raw answer (its colours, its confidence, how many cats it saw) goes in the team-only `suggestedValue`, with `suggestionSource: "coat-reader"`. That lets SYC-56 tune the Not sure cut-off later without paying for a second reading. It never reaches the public, and the resolver doesn't read it.
- **R4. Never call the model twice for the same photo.**
  - A cat's photo is never sent to the model again once it has a machine reading, whatever that reading said.
  - When R2 rule 2 makes a cat due for a main photo that was read before (a restore), the reader **copies that earlier reading forward** with no model call:
    - a new row, with the same colours, the same `modelVersion` and `photoId`, and `observedAt` = now;
    - `suggestionSource: "coat-reader:copy"`, and `suggestedValue` naming the row copied.
  - It does this **only if the team never marked that earlier reading wrong.** If they did, nothing is written, and the stand-in's reading stays the newest.
  - So the fill-in run can never bring back a colour the team rejected.
  - Only a team action (hide or restore) can make a cat due again, and that is why the public can never cause a second call.
- **R5. Not sure, honestly.** The model answers in a fixed JSON shape: how many cats it sees, whether the photo is clear, one or two colours from the list it is given, and a confidence. The list comes from `COAT_COLOURS` through a `Record<CoatColour, string>` of plain descriptions, so it can't drift from the real one. The reader writes `["not_sure"]` if any of these holds:
  - it saw anything other than exactly one cat;
  - the photo isn't clear;
  - it gave no colours, more than two, an unknown one, `not_sure` beside a colour, or an impossible pair that `normaliseColours` and the validator refuse;
  - its confidence is **below 0.8** (cautious to start; tuned with SYC-56's labels and filed there).
- **R6. A failed call writes nothing.** A timeout, an error or unreadable output leaves no row; the cat stays not known.
  - Each attempt is counted before the call, in a shared database bucket `coat-read-photo`, keyed by (cat, photo): **3 attempts a day, sliding**.
  - `limits.ts` only allows windows of a day or less (`assertWindow`, `limits.ts:78`), so a photo that always fails costs at most 3 calls a day.
  - The plan accepts that rather than adding a table. The hourly allowance in R7 caps it too.
- **R7. A budget.** All reading shares one sliding counter, `coat-read-hour`, of **60 model calls an hour**, enough for a trial and a fill-in run of today's 28 cats in the same hour.
  - New-cat readings (Decision C1) also draw on their own smaller counter, `coat-read-new`, of **20 an hour**, so a burst of new cats can't use up the catch-up run's allowance.
  - The automatic catch-up run reads at most 10 cats a run, and runs no more often than the mail job calls it. A manual run reads at most 50.
  - A run that hits a limit stops at once. It reports how many it read and how many are still due, and writes nothing for the cat it was on.
  - Copying a reading forward (R4) makes no call and draws on no counter.
- **R8. Two servers at once.** The write happens inside a transaction that takes an advisory lock on the cat and checks again that the cat is still due for the same photo. Two servers reading the same cat at once can waste one call, but can't write two rows.

---

## How it ships: the order

Every PR is built in **its own worktree off fresh `origin/main`**, is one PR, and leaves `main` safe on its own. "Review and merge" uses `/ship`: an independent adversarial review in **its own worktree**, never shared; findings folded in; CI green; merge; Linear synced; worktree removed.

| Step | PR | Needs first | Who notices |
|---|---|---|---|
| 1 | **PR 1: the reader, the manual address and the docs fixes** | This plan approved | Nobody |
| 2 | **Dry run, trial and contact sheet** on production | PR 1 live | Samuel (about 5 minutes) |
| 3 | **Checked fill-in run** (Decision A1), leaving out any Samuel rejects | Samuel's answer on the contact sheet | Everyone: existing cats show colours |
| 4 | **PR 3: the "Find the cat" chips** | PR 1; built in parallel with PR 2; **merges after the fill-in run** (K4) | Spotters |
| 5 | **PR 2: reading by itself**, merged and published switched off | PR 1 | Nobody |
| 6 | **Switch-on PR** (`AUTO_COAT_READING = true`) | SYC-2 PR 3.1 live (A1) | New cats get colours |

**Rollback:** a revert for each PR. Readings already written stay valid, and SYC-2's resolver keeps using them. To make every machine colour stop counting, the team marks them wrong once 3.1 exists. Nothing is deleted.

---

## PR 1: the reader, the manual address, and the docs fixes

**In plain English.** The server learns to look at one cat's photo and say its colour, or Not sure, and to record that answer. Nothing starts it yet, except a manual run that Claude starts from GitHub.

**Files**
- `lib/visionModel.ts` (new): `VISION_MODEL = "gpt-5.6-terra"`, the one place the model name lives. `matching.ts` imports it **and changes nothing else**: same prompt, same parsing, and the source guard stays green.
- `lib/coatReading/reader.ts` (new): `readCoatFromPhoto({ data, mime })` returns `{ kind: "reading", colours, raw }` or `{ kind: "failed", reason }`. It makes one call with one image. The prompt asks about colour only (spec §4.7: never sex, age, ear tip or health) and builds its colour list from `COAT_COLOURS`. It applies R5 and never throws.
  - `MODEL_VERSION = "${VISION_MODEL}/coat-v1"`. A prompt change bumps `coat-v1`.
- `lib/photoVisibility.ts`: a new `catDisplayPhotoIds(cats, q)` returns `Map<catId, photoId | null>`, by the same rule. `catDisplayPhotos` is rewritten to use it, so there is still one stand-in rule. No new public address is built anywhere, and P6-0 stays green.
- `lib/coatReading/due.ts` (new): `catsDueForReading(limit, q)`, batched with a fixed number of queries. It returns `{ catId, photoId, action: "read" | "copy", copyOf? }[]` by R1, R2 and R4, oldest cat first. It uses only `photoVisibility.ts`'s functions for visibility, and reads through `cat_identity` like every other reader.
- `lib/coatReading/record.ts` (new): `recordReading(...)` and `copyReadingForward(...)`. Each locks, re-checks and calls `writeObservation` (R3, R4, R8). **The only caller in `src/` that passes `system:vision` or `provenance: "machine"`.**
- `lib/coatReading/sweep.ts` (new): `sweepCoatReadings({ mode, limit, exclude, now })` with three modes.
  - `dry_run`: no model call and no write. Returns how many cats are due, their ids, photo ids and actions, and the calls it would make.
  - `trial`: calls the model and writes nothing. Returns, for each cat, its id, photo id, the colours it would write, and the raw answer: colours, confidence, how many cats it saw, clear or not. It also returns the cut-off in use.
  - `write`: the real thing. `exclude` lists cat ids **not** to write, for the readings Samuel rejects (Decision A1).

  Because the trial returns the raw confidence, a different cut-off can be judged from one trial without paying for another. Only a change to the **prompt** needs a new trial, and that means a PR, Samuel's pull in Replit and a publish, because the model can only be called from the live server.

  The sweep enforces R6 and R7 through the `declareLimit`/`consume` buckets `coat-read-hour`, `coat-read-new` and `coat-read-photo`, all sliding.
- `routes/internalCoat.ts` (new): `POST /api/internal/coat/sweep`, body `{ mode, limit, exclude }`; `mode` defaults to `dry_run`. Opened by the drain token (Decision D1) and answers `no-store`.
  - Added to the pre-launch gate's exception next to `MAIL_DRAIN_PATH`.
  - `internalAuth.ts`'s comment is updated so the token's two paths are both named, and so is `internalMail.ts`'s stale "every 10 minutes".
- `.github/workflows/coat-readings.yml` (new): `workflow_dispatch` only, with inputs `mode` (a choice: `dry_run`, `trial`, `write`; default `dry_run`), `limit` and `exclude`.
  - It uses the `production` environment's `MAIL_DRAIN_TOKEN`.
  - It has **the same host check as `mail-drain.yml`**: the token only ever goes to `https://apptest.catspotters.com` or the production variable's address, never to an address typed into the run.
  - It prints the JSON answer: ids, colours and the raw answer's numbers. Never a photo, never a token.
- **Docs:** `choose-a-different-cat.md` §9, where the cache sentence becomes "no bump; `coat` is in v2 (coat-markings-and-health.md §10.4)". §4.7's "can ride along" gets a pointer to Decision C. The SYC-119 plan's Slice C gets a pointer to this plan.

**Tests**
- **T-shape.** A good model answer gives `{colours}`. Each R5 case gives `["not_sure"]`: 2 cats, 0 cats, not clear, confidence 0.79, three colours, `not_sure` with a colour, an unknown code, `black`+`white` (stored as `black_and_white`), `black_and_white`+`white`. A thrown error, a timeout and unparseable text each give `failed`. The model is mocked in every test.
- **T-prompt.** The prompt asks about colour only: none of "sex", "age", "ear", "health", "sterilis" appears in it. Its colour list equals `COAT_COLOURS` exactly.
- **T-row.** A reading writes exactly one row: `system:vision`, `system`, `machine`, the right `photoId`, `observedAt` = now, and `value` with exactly the keys `colours` and `modelVersion`. No `supersedesId`. `suggestionSource` is `coat-reader`, never `backfill:`.
- **T-photo.**
  - A cat whose main photo is hidden is read from its newest public sighting photo.
  - A cat with every photo hidden is not read.
  - **No hidden photo's bytes ever reach the mocked model.**
  - A cat with no photo (`primaryPhotoId: 0`) is not read.
- **T-due.**
  - Each R2 case, as due and as not due.
  - A new sighting on a cat whose main is hidden **does not** make it due.
  - A restored main photo does.
  - A photo already read is never sent to the model again, including when that reading was marked wrong (a retraction row seeded directly) and when it was Not sure.
  - A restored main photo that was read before is **copied forward with no model call** (T-copy). If its earlier reading was marked wrong, nothing is written.
  - A cat whose only machine row was marked wrong is not "unread" under R2 rule 1.
  - A cat whose photo row has been deleted is not read.
- **T-ids.** `catDisplayPhotoIds` and `catDisplayPhotos` agree for every cat across these fixtures: main public, main hidden with a stand-in, everything hidden, main deleted.
- **T-newest** (through the real resolver): after a hide, the stand-in's reading (dated now) beats the older main-photo reading. After a restore, the copied-forward reading of the main photo beats the stand-in's.
- **T-exclude.** `write` with `exclude: [id]` writes every due cat except that one, and that cat stays due.
- **T-precedence** (through the real resolver; these are spec tests 16 and SYC2-D10):
  - a team colour beats a newer machine reading;
  - one spotter doesn't overturn a machine reading;
  - two independent spotters do;
  - a machine Not sure after a real reading leaves no machine reading.
- **T-life.** A fill-in run over cats with old photos changes no cat's `lastSeen`, `notSeenSince` or presumed-deceased state (spec test 17).
- **T-quiet.** A run queues no push, mail or round-up: notification, outbox and push spies stay at zero.
- **T-public.** After a reading, `GET /cats/:id` carries `coat` with the colours. Nothing anywhere in the payload names `modelVersion`, `photoId` of the reading, `suggestedValue`, `confidence` for coat, `system:vision` or the reading's date (spec test 20). A Not sure reading gives `coat: []`. The snapshot's shape is unchanged.
- **T-budget.** These calls aren't made:
  - the 61st in an hour;
  - the 21st new-cat reading in an hour;
  - a 4th attempt on one photo within a day.

  Each limit holds across two simulated servers, through the database. A run that hits the limit reports how many cats are still due.
- **T-race.** A test hook holds the first `recordReading` between its re-check and its insert while a second one runs, which forces the interleave. Exactly one row results.
- **T-route.**
  - No token gives 401; no server token gives 503; the mail-drain path is unchanged.
  - `dry_run` and `trial` write no row and make the right number of calls (0, N).
  - `limit` above 50 is refused.
  - The pre-launch gate lets this path through with the drain token **and with nothing else**.
- **Source guards** (extending `appearance.notNotifiable.test.ts`):
  - `matching.ts` and `candidateSelection.ts` import nothing from `coatReading/` and read no colour (spec test 15's server half);
  - no notifier imports `coatReading/`;
  - `coatReading/` imports no notifier, push or mail module;
  - only `coatReading/record.ts` names `system:vision` with `provenance: "machine"` in `src/` (tests excepted).

**Mutation probes** (each: break it, see the named test go red, restore):
1. `observedAt` set to the photo's date: T-row and T-newest.
2. R4 removed (read the same photo again): T-due's "marked wrong" case and T-copy (a model call is made).
2a. Copying forward a reading the team marked wrong: T-copy.
2b. `catDisplayPhotoIds` with its own stand-in rule that drifts from the address rule: T-ids.
3. The confidence cut-off removed: T-shape at 0.79.
4. `catDisplayPhotos` swapped for `primaryPhotoId`: T-photo's hidden-bytes case.
5. A `not_sure` row written on failure: T-shape's failed cases and T-due.
6. The lock removed: T-race.
7. A `consume` call removed: T-budget.
8. `dry_run` falling through to `write`: T-route.
9. `coat` read inside `candidateSelection.ts`: the new source guard.

**Model:** Sonnet builds. Before the PR opens, **Opus spot reviews `due.ts`, `record.ts` and `catDisplayPhotoIds`.** These are the subtle part: R2 and R4 (the copy-forward included) and how they interact with the resolver's "newest machine reading".

## PR 2: reading by itself

**In plain English.** From now on nobody has to start anything. Every couple of hours the server catches up on any cat that needs a reading, and under Decision C1 a new cat is read the moment it's named.

- `routes/internalMail.ts`: the drain calls `sweepCoatReadings({ mode: "write", limit: 10 })` after the welfare check, at most hourly per server, like the keep-safe sweep. A failure is logged and **never changes the drain's status code**, which stays about welfare alerts only.
- **C1 only:** `routes/sightings.ts`, after the resolve transaction has committed and only when `isNewCat`, `res.on("finish")` starts `readCatNow(catId)`. That runs the same due check, budget and `recordReading`, and is never awaited by the response. A failure is logged; the sweep catches it later. With C2, this bullet is dropped.
- The new-cat read is **best effort**. On autoscale a server can go quiet once it has answered, and the catch-up run picks up anything it missed.
- **Both of the above sit behind one constant, `AUTO_COAT_READING`**, merged as `false` under Decision A1 (also A2). A one-line PR flips it once SYC-2 PR 3.1 is live, so PR 2 can merge and be published with other work without reading anything. Under A3 it merges as `true`.
- While it is `false`, a photo the team hides keeps its old reading until the switch is on. That's acceptable, because the team only hides a few photos.
- A hide or restore needs no hook: R2 makes the cat due, and the next sweep reads it. That takes up to about 2 hours, which is acceptable for a team action and keeps `teamPhotos.ts` untouched.

**Tests**
- the drain runs the sweep and its status is the same with the sweep failing;
- a new cat gets exactly one reading after resolve (C1);
- **the resolve response is identical and arrives without waiting** with the model mocked to hang;
- resolving onto an existing cat starts no reading;
- a hide followed by a drain gives a reading of the stand-in;
- the round-up and keep-safe sweeps still run.

**Mutation probes:** awaiting the read inside the response (the hang test goes red); reading on every resolve, not just new cats (the existing-cat test); letting a sweep error reach the status code.

**Model:** Sonnet; reviewed in `/ship`.

## PR 3: the colour chips in "Find the cat"

**In plain English.** The picker gets its row of colour chips, and every protection the spec asks for comes with it.

- `lib/catPicker.ts`: `colourFilter(list, selected)` is pure. It takes `pickerList`'s output and returns `{ matching, notKnown, hiddenCount }`.
  - A cat matches if any of its colours is selected.
  - **A black-and-white cat also matches Black and White.** It is partly both, and someone who saw a tuxedo and tapped "Black" mustn't lose it, because a hidden cat is how duplicates get made. The chip *Black and white* matches only black-and-white cats.
  - A cat with `coat` missing or `[]` is always in `notKnown`, under any selection (spec test 13).
  - Both lists keep `pickerList`'s order exactly (K5, spec tests 14 and 18).
  - `hiddenCount` counts the cats that match the search but not the colour.
  - Under *All* there is no "Colour not known" heading: one list, as today.
  - Picking the not-known chip alone shows only `notKnown`.
- **The not-known chip is labelled "Colour not known"** (`pickerColourNotKnown`, the same words as the heading), not "Not sure". The Greek `coat_not_sure` reads "I'm not sure", which suits a spotter answering a question but not a filter. This departs from spec §6's chip list in one word, and Johnny checks it.
- `components/ColourChips.tsx` (new): the shared chip component, which SYC-2's PRs 4.2 and 4.3 reuse.
  - Each chip has a drawn picture and the word (D1): plain swatches for the five solid colours, stripes for tabby, patches for tortoiseshell or calico, a split for black and white, a question mark for Not sure. *All* has no picture.
  - Each chip is a toggle button with `accessibilityState.selected`.
  - The pictures are `react-native-svg`, already a dependency.
- `components/CatPicker.tsx`:
  - the chips under the search box;
  - the matching cats, then a "Colour not known" heading and those cats;
  - then the hidden-count line, with "Show all colours" (which resets to *All*), **directly above** "Can't find it? Add it as a new cat";
  - when search plus filter finds nothing but search alone would, the "No {colour} cats called…" line with "Search all colours".
  - The filter resets to *All* each time the picker opens (nothing is saved).
- `lib/i18n.ts`, new keys in `en`, `el` and `fr`:
  - `pickerColourAll`;
  - `pickerColourNotKnown`;
  - `pickerHiddenByColourOne` and `pickerHiddenByColourMany` ("{n} more cats nearby in other colours.");
  - `pickerShowAllColours`;
  - `pickerNoColourMatch` ("No {colour} cats called “{text}”.");
  - `pickerSearchAllColours`.

  Chip words reuse the `coat_*` keys. The Greek and French drafts go in **Johnny's pack by 22 Oct** (SYC-346, SYC-283).

**Tests**
- `colourFilter`:
  - the order is kept in both lists;
  - not-known cats are present under every selection;
  - a ginger tabby shows under Ginger and under Tabby;
  - a black-and-white cat shows under Black, under White and under Black and white; a black cat doesn't show under Black and white;
  - no "Colour not known" heading under *All*;
  - `hiddenCount` counts only the cats the search matches;
  - the counts add up: matching + not known + hidden = total;
  - a cat from an old cache with no `coat` field is not known.
- Screen:
  - the hidden line sits above the new-cat link, checked through the order of the rendered tree;
  - "Show all colours" restores *All*;
  - the search-empty message, with its clear action;
  - every chip label in all three languages, with no raw code rendered.
- **Offline:** filtering works from the saved catalogue with the network mocked off (spec §4.5).
- **Matcher untouched:** the suggestions on the review screen are identical whatever the filter was (spec test 15's app half). A source check confirms `review.tsx`'s suggestion list doesn't import `colourFilter`.
- **The cache key is still v2** (the existing test stays green, unedited).

**Mutation probes:** dropping not-known cats when a colour is selected (spec test 13); sorting `matching` by colour (spec test 14); moving the hidden line below the new-cat link (the order test); an off-by-one in `hiddenCount`.

**Browser check** before the PR opens: about 390 px and desktop, in en, el and fr, on a seeded local list of 40 cats with mixed colours and some not known. The screenshots go in the PR, including the chip pictures, which **Samuel judges** (D1).

**Model:** Sonnet (the chip pictures are simple shapes; Samuel judges them in the browser check).

---

## Every place the rules must hold

These are the places the rules must hold, not only the code these PRs touch.

| Rule | Must hold at | Held by |
|---|---|---|
| One colour list, one normaliser | the reader's prompt and its result; the app's chips | import of `COAT_COLOURS`/`normaliseColours`; `Record<CoatColour,…>`; app chips from `COAT_LABEL_KEYS` + `coat_not_sure`; T-prompt |
| One rule for which reading wins | the public payload, the app, the team pages (SYC-2 3.1), SYC-2's spotter question | unchanged `resolveCoat`; the reader only writes rows; T-precedence |
| Machine rows only from the reader | every writer in `src/` | source guard (only `record.ts`); `writeObservation`'s own refusals |
| A new reading never edits | `record.ts` | no `supersedesId`; T-row |
| Never read a hidden photo | `due.ts`, the reader | `catDisplayPhotos` only; T-photo's bytes check |
| The public can't cause a second call | resolve (C1), new sightings, everything public | R2 + R4; T-due; PR 2's existing-cat test |
| Not evidence of life | `loadCatRecords`, the deceased fold, `lastSeen` | `coat` already excluded by name; T-life |
| Never notifiable | push fan-out, round-up, mail outbox, the future nightly news job (data spine §9) | existing guards plus the new import guard; T-quiet. The news job, when built, must use the same `SYC2_FIELDS` exclusion: a note goes on its ticket |
| Never a matcher pre-filter, never in its prompt | `matching.ts`, `candidateSelection.ts`, the review screen | source guards (server and app); T-prompt untouched for matching |
| Public sees the colour only | `GET /cats`, `GET /cats/:id`, the name-taken body, the picker cards | unchanged `serialiseCat`; T-public |
| "Not known" is `[]`, never `not_sure` | the wire, the app's cache, the filter | `coatColours` drops `not_sure`; the app treats missing as not known; tests |
| Cache key stays v2 | `catalogue.ts` | existing test, unedited |
| Cost bounded | sweep, route, new-cat read | R6, R7; T-budget |

---

## Rollout and the checks after each deploy

Each publish follows the launch plan's routine: Samuel pulls main in Replit, Claude publishes and waits until `/api/healthz` shows the new commit before probing. No database step.

1. **PR 1 live.**
   - Probe: `/api/healthz` shows the commit.
   - `POST /api/internal/coat/sweep` with no token answers 401 (curl).
   - The mail drain still answers as before (one manual `mail-drain` run).
2. **Dry run.** `gh workflow run coat-readings.yml -f mode=dry_run`.
   - The run goes through the drain token, which the pre-launch gate already lets in.
   - Expect about 28 cats due. Compare the ids with the cats that have a public photo in `GET /api/cats`, read in the browser pane: Samuel's monthly pre-launch sign-in covers that, and Claude never types the password. If that sign-in has lapsed, Claude asks him to sign in again.
   - Anything unexpected stops here.
3. **Trial.** `mode=trial`, limit 50: about 28 calls.
   - Claude builds a **contact sheet** (a private artifact): each cat's public photo, loaded in the browser pane, beside the trial colour and the model's confidence. It is checked by eye, then sent to Samuel.
   - If too many are wrong (more than about 1 in 10), the cut-off is raised from the trial's own numbers, at no new cost. If that isn't enough, the prompt changes (`coat-v1` becomes `coat-v2`), which takes a PR, Samuel's pull and a publish, and then another trial.
   - The result is recorded on SYC-161, and the labels go to SYC-56.
4. **Checked fill-in run** (Decision A1). `mode=write`, limit 50, `exclude` = the cats Samuel rejected.
   - Probe: `GET /api/cats` shows `coat` on every cat written with a colour, and `[]` on the Not sure and excluded ones.
   - A read-only query on production counts exactly one `system:vision` row per cat written, with no `backfill:` source.
   - A dry run straight afterwards reports **0 due** apart from the excluded cats. That proves R4 holds on production; "no rows written" alone could be the budget talking.
   - Three cats' `lastSeen` values are unchanged from before.
   - A model call made now could answer differently from the trial. So the write run's answer is compared with the trial, cat by cat. Any cat whose colour changed is shown to Samuel before PR 3 merges.
5. **PR 3 published.** The picker is checked on the live site at 390 px and desktop: the chips, "Colour not known", and the hidden line above "Add it as a new cat".
6. **PR 2 published, switched off.** The next drain run's answer is checked: it reports no coat reading.
7. **SYC-2 PR 3.1 live, then the switch-on PR published.**
   - The new-cat path is **not** probed by naming a test cat, because that would create public data on production. It is proven by PR 2's tests and by the next real new cat: Claude checks its row and says so on the ticket.
   - The next drain run's answer reports how many cats it read.

**Heads-up before outside effects:** nothing in this rollout emails or messages anyone. The trial and the fill-in run touch only production's own records, and the fill-in run is the agreed change. Samuel gets one line of warning before step 4 anyway.

---

## What works offline

| Thing | Offline? |
|---|---|
| Seeing a cat's colour on its page or card | **Yes**, for cats in the catalogue the phone last saved. A colour read after that shows when the phone next has signal |
| The colour chips and "Colour not known" | **Yes**, over the saved catalogue. A cat whose colour was read after the copy was saved is "Colour not known", so it is never hidden |
| The hidden-count line and "Show all colours" | **Yes** |
| Reading a colour | **No.** The model runs on the server |
| Fixing a wrong colour | **No.** That is the team's dashboard, which is online only |

Nothing here waits in the offline queue.

---

## What this plan does not do

- No colour in the cat-alog's filters: that is SYC-2 PR 4.3, which reuses this plan's chip component.
- No spotter questions about colour: SYC-2 Slice 4, which waits for this plan.
- No machine reading of markings (SYC2-D4; SYC-243).
- No reading of every sighting photo, so there is no "hand pick disagrees with colour" flag from the machine (SYC-2 §7.2 compares the spotter's own answer).
- No change to matching, its prompt, its candidates or its order.
- No team screen: SYC-2 PR 3.1 shows the team machine readings beside people's.
- No public "colours are ready" field (K4).
- No cache-key change.

---

## Where this collides with other work

- **SYC-2 PR 3.1** (not started): only the switch-on for new cats waits for it (Decision A1). Its Appearance section should show the machine reading's photo and model version to the team. A comment on SYC-2 asks for that, and for 3.1 next.
- **SYC-44** hides photos through `setPhotoVisibility` (author `report:<id>`), so its hides make cats due by R2, with nothing to change. Its PR 7.2 deletes hidden photos for good. A reading keeps its `photoId` after its photo is gone, and the last reading stays (R2). T-due checks that a deleted photo is never read. The display gap for a deleted main photo is noted on SYC-44.
- **SYC-163** (team chooses a main photo): R2 rule 2 already re-reads when the main photo changes.
- **SYC-59** (merges): a merge doesn't combine readings (spec §8.5). Today merged cats refuse writes, so the reader skips them: `due.ts` reads through `cat_identity` like every other reader.
- **The launch plan (#172):** Decision B. The launch-plan session agreed on 15 Oct. PR #172 at `b4c7668` lists SYC-161 as outside the launch, pending Decision B, and cut before the launch plan's own cuts. Its slots, if it lands, are Fri 23 and Mon 26 Oct, and its colours go public only after SYC-2 PR 3.1. The six picker strings are on SYC-346 for Johnny's pack.
- **Open PRs today:** none touches `lib/coatReading/`, `matching.ts`, `internalMail.ts` or `CatPicker.tsx` (checked with `gh pr diff --name-only` before each PR opens). PR #181 (SYC-42 Slice 3) touches mail; PR 2 rebases after it if both are open.

---

## Model delegation

This session is on Opus; the plan was written here. That's judgment across the specs, the tree and the earlier decisions, so it stays on the session model.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| This plan | Opus (this session) | Weighing three specs, two earlier plans and the tree against each other | Independent adversarial review (below) |
| Adversarial review of this plan | Sonnet, own worktree, read-only | Checking claims against files is ordinary search-and-compare | Every finding is checked by Opus against the file it names before it's folded in |
| PR 1 build | Sonnet | Clear spec; the rules are written above | Tests plus mutation probes 1–9, 2a and 2b. These are silent failures: a wrong `observedAt`, a re-read or a drifting stand-in rule each "succeeds" but is wrong. **Opus spot reviews `due.ts`, `record.ts` and `catDisplayPhotoIds`**, because how R2 and R4 interact with "newest machine reading" is the one place a green suite can hide a wrong answer |
| PR 2 build | Sonnet | Small wiring | Tests plus its 3 mutation probes; `/ship` review |
| PR 3 build | Sonnet | Standard UI and a pure function | Tests plus 4 mutation probes; the browser check at two widths in three languages; Samuel judges the chip pictures |
| The i18n drafts | Sonnet, inside PR 3 | Short strings from the spec's English | i18n parity test; Johnny (SYC-283) |
| Each `/ship` adversarial review | Sonnet, own worktree | Standard review | It re-runs the named tests itself (memory: delegated "tests pass" can be false) |
| Trial contact sheet and the go/no-go call | Opus (session) | Judging photos against colours | Samuel looks at it |
| Live probes | Haiku, or the session if cheaper inline | Mechanical curl and gh calls | Exact expected outputs are listed in "Rollout" |

Every build prompt restates: **commit after each item**, keep a `CHECKPOINT.md` (untracked), and use your own worktree off fresh `origin/main`.

## Crash-proofing for the build

Each PR's builder commits after each item and keeps an untracked `CHECKPOINT.md`. If it is interrupted, it comments on SYC-161 with where it got to. No nested background agents.

## Linear

- **SYC-161:** this plan's PR link; after approval, its description updated to name Decisions A–D as answered.
- **SYC-2:** comment asking for PR 3.1 next (Decision A1), and for the team page to show a machine reading's photo and model version.
- **SYC-56:** comment saying readings keep the model's raw answer in `suggestedValue`, and that the 0.8 cut-off is to be tuned from its labels.
- **Launch plan / SYC-346:** the six picker strings go in Johnny's pack.
- **Follow-up tickets** are filed once Samuel approves, deduplicated first. Candidates:
  - tune the Not sure cut-off from SYC-56's labels (may fold into SYC-56);
  - the data spine news job must exclude colour (a comment on its ticket if one exists).

---

## Review outcome

**Independent adversarial review** (Sonnet, its own worktree, read-only), 15 Oct 2026. It read the plan at `76d1dc8` and the code at `origin/main` `629fbea`. Verdict: "not ready to approve" until findings 1–4 were fixed. I checked findings 1, 2 and 7 against the files myself (`limits.ts:78`, `photoVisibility.ts:84-135`, `mail-drain.yml:55-64`). Every finding was accepted.

| # | Severity | Finding | What changed |
|---|---|---|---|
| 1 | Blocker | R6's "3 tries in 7 days" can't be built: `limits.ts` refuses windows over a day | R6 is now 3 attempts a day, sliding. A photo that always fails costs at most 3 calls a day, and the hourly allowance caps it too |
| 2 | Blocker | `catDisplayPhotos` returns web addresses, not photo ids | PR 1 adds `catDisplayPhotoIds`, sharing the one stand-in rule; T-ids; probe 2b |
| 3 | Major | R2 (re-read a restored main photo) contradicted R4 (never read a photo twice) | A restore copies the earlier reading forward with no model call, unless the team marked it wrong; T-copy, T-newest, probe 2a |
| 4 | Major | Decision A1 (wait for SYC-2 PR 3.1) contradicted B1's dates; two realistic options were missing | Decision A rewritten. The new A1 is a fill-in run Samuel has checked, with the readings he rejects left out, and automatic reading switched on after 3.1. A team "Mark wrong" built here is now option A4 |
| 5 | Major | 30 calls an hour collided with a trial plus a fill-in run, and the manual limit of 50 was meaningless | 60 an hour, sliding; a run stops cleanly and reports what's left |
| 6 | Major | A prompt change needs a PR, a pull and a publish | Said so. The trial returns the raw confidence and the cut-off, so tuning the cut-off needs no re-run |
| 7 | Major | The new workflow could send the drain token anywhere | It has the same host check as `mail-drain.yml`. Decision D now says the password can spend money and what caps it |
| 8 | Minor | New cats could use up the shared allowance | A separate `coat-read-new` allowance of 20 an hour |
| 9 | Minor | Every photo hidden, or a deleted main photo, leaves an old reading; my "covered by T-due" claim was wrong | Stated as a rule (the last reading stays; the team marks it wrong if needed). Claim corrected; SYC-44 gets a comment about the display gap |
| 10 | Minor | R2 rule 1 didn't say what "no machine reading" means | It means no machine row at all. Cats with a team colour are still read (stated, with the reason) |
| 11 | Minor | Some probes could pass by luck | The race is forced with a hook. A resolver-level ordering test was added. The production probe checks "0 due", not just "no rows". How Claude gets past the pre-launch gate is stated |
| 12 | Minor | Filter semantics unspecified | A black-and-white cat shows under Black and under White. No heading under *All*. The hidden count follows the search. The not-known chip reads "Colour not known" (it departs from spec §6 in one word; Johnny checks it) |
| 13 | Minor | Jargon in Decisions C and D | Rewritten around what people notice; the technical names moved to one closing line |
| 14 | Nit | Trial output, the stale "every 10 minutes" comment, the new-cat read being best effort, the run frequency | All fixed |

**Hard constraints the review checked and found holding:**
- one colour list, and `resolveCoat` reused;
- machine rows with `system:vision`, machine provenance, `photoId` and `modelVersion`;
- a new reading is always a new row;
- a single spotter never overturns the machine, and the machine never beats the team or a guardian;
- `[]` means not known;
- no cache-key bump and no migration;
- no colour in the matcher;
- not evidence of life, and never notifiable;
- the public sees the colour only;
- the offline claims match spec §4.5.

One new risk came out of the fixes. A write run calls the model again, so its answer can differ from the trial's. Rollout step 4 compares the two cat by cat, and shows Samuel any cat whose colour changed before the chips merge.
