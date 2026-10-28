# SYC-410 PR 1.2: live cats and statements by cat (the rulings)

**What this is.** The first half of PR 1.2 in [`syc-150-59-which-cat-is-which.md`](syc-150-59-which-cat-is-which.md) (table row C2, PR 1.2 items 1–4), against spec [`which-cat-is-which.md`](../../specs/which-cat-is-which.md) §9.3 and §4.2. It designs the two helpers, lists every place the server reads cats or reads statements by cat, and rules on each one. A Sonnet builder applies the rulings afterwards; nothing here moves a reader.

**Checked against:** branch `claude/syc-410-pr1.2-live-cats`, stacked on PR 1.1 (`origin/claude/syc-410-pr1.1-cat-identity` at `9e29c45c8`), so `lib/catIdentity.ts` (`canonicalCatOf`, `catsMergedAway`, `catsFeeding`) exists.

**Words used here:**
- *Merged away*: a cat with a standing merge row whose chain ends at another real cat (exactly `catsMergedAway`'s rule: a loop or a chain deeper than 8 hops is **not** merged away, so bad data never makes a cat vanish).
- *Live cat*: a cat that is not merged away.
- *Survivor*: the cat a merged-away cat now counts for (`canonicalCatOf`).

---

## 1. The design

### 1.1 `liveCats`: the only way to list or count cats

Both new exports live in `artifacts/api-server/src/lib/catIdentity.ts`, beside `catsMergedAway`, because the "merged away" rule must be spelled once and `catIdentityGuard.test.ts` already forbids `cat_identity` anywhere else.

```ts
/**
 * SQL that is true when `catId` names a cat that is not merged away (as of
 * `asOf`): the same answer as catsMergedAway, for every id, in one fixed
 * subquery whatever the number of cats. For a query that already reads cats
 * through liveCats, or a raw-SQL reader on the cats allowlist that must leave
 * out merged-away cats.
 */
export function notMergedAway(catId: SQLWrapper, opts?: MergeReadOptions): SQL;

/**
 * Cats that are not merged away: `select <fields> from cats where
 * notMergedAway(cats.id) and <where>`. The only way to list or count cats
 * (spec §9.3). The caller may still join, group, order, page and lock
 * (Drizzle keeps join/groupBy/orderBy/limit/offset/for open after where).
 */
export function liveCats<F extends SelectedFields>(
  fields: F,
  opts?: MergeReadOptions & { where?: SQL },
  q?: Pick<typeof db, "select">,
): /* the Drizzle select builder, after .from(catsTable).where(...) */;
```

How it works, in one line: `notMergedAway(x)` renders `x not in (<merged-away ids>)`, where the merged-away ids come from the same `standing(asOf)` rows and the same 8-hop walk as `canonicalCatOf` (a standing row whose walk ends, within 8 hops and without a loop, at a cat with no standing row). `cat_id` is `NOT NULL`, so `not in` is safe.

Usage:

```ts
// totalCatCount
const [row] = await liveCats({ n: sql<number>`count(*)::int` });

// listCatsWithStats: page, count and map read the same live set
await liveCats({ id: catsTable.id, ... })
  .leftJoin(sightingsTable, and(eq(sightingsTable.catId, catsTable.id), eq(sightingsTable.status, "resolved")))
  .groupBy(catsTable.id);

// a list of named ids (a team list, a batch): merged-away ids drop out
await liveCats({ id: catsTable.id, name: catsTable.name }, { where: inArray(catsTable.id, ids) });
```

What it is **not**: a way to load one cat by id for a page or an action. Those load the cat by id (allowlisted), after resolving the id through `canonicalCatOf` where the spec says to act on the survivor (§9.3 table: `GET /cats/:id`, resolve, follow, name, let-go, `PATCH`, team corrections). Resolving them is PR 4.1's job (it owns `MERGED` refusals and `mergedFrom`); this PR only puts the list and count readers on `liveCats` and allowlists the by-id loads with that reason.

No other cats export. `liveCatCount`, a paging helper or an "also known as" search are not added: the spec doesn't ask for them, and `searchTeamCats`'s "also known as" is PR 4.1.

A reader that starts from another table and joins cats (`newCatsAfterFailedCheck`, `likelyReview`) is turned round to start from `liveCats(...)` and join the other table, or filters with `notMergedAway(<its cat id column>)`. Either way it never names `catsTable` as a table, which is what the guard looks for (§5.3).

### 1.2 `catsFeeding`: every read of statements by cat id

`catsFeeding(catIds, { asOf?, excludeKinds? }, q)` already exists (PR 1.1). No signature change. One small export is added beside it, so that a reader never spells `observationsTable.catId` in a comparison itself (that spelling is what the statements guard refuses, §5.3):

```ts
/**
 * SQL: the statement's cat is one of the cats feeding these. `col` defaults
 * to observationsTable.catId; a raw-SQL reader passes its own alias
 * (sql`w.cat_id`). An empty set matches nothing.
 */
export function observationCatIn(feedings: Iterable<Feeding>, col?: SQLWrapper): SQL;
```

The rule for readers:

1. **Reading one cat's statements:** `const f = (await catsFeeding([catId], opts, q)).get(catId)!`, then `observationCatIn([f])` instead of `eq(observationsTable.catId, catId)`, then keep only `rows.filter((r) => f.counts(r))`.
2. **Reading many cats' statements:** one `catsFeeding(ids)` call; query `observationCatIn(feeding.values())`; give each row to every target whose `f.counts(row)` is true (a merged-in cat can feed several asked-about cats in a chain: Mimi feeds both Agatha and Dora if both are asked). Two queries for catsFeeding plus one for the rows, whatever the number of cats (data spine §2.3).
3. **`excludeKinds: ["coat", "markings"]`** whenever the rows go into `resolveCoatParts`, `resolveMarkings` or anything else that shows colour or markings (spec §4.2: they are the staying record's own). `f.counts(row)` then drops a merged-in cat's coat and markings rows and keeps the survivor's own.
4. **`asOf`:** pass the reader's own `asOf` through, so a past view uses the merges as they stood then (spec §9.10).
5. **A reader that only ever reads `coat` or `markings`** doesn't need catsFeeding at all: it reads the survivor's own rows by `eq(catId)`. That's an allowlist entry, reason "coat/markings only (spec §4.2)".
6. **Answers that belong to one statement row** (a statement's own cat, by statement id) are not "by cat id" reads: the guard doesn't fire on them (§5.3).
7. **`since`** is for news silencing (spec §9.12), not for counting. A merged-in cat's statements count for the survivor whatever their date.
8. **A statement read keyed by something else** (a colony, a kind, island-wide) that then files rows under cats goes the other way: `canonicalCatOf(row cat ids)` maps each row to its survivor (a null, a looping or too-deep chain, keeps the row under its own cat, as `catsFeeding` does), and a merged-in cat's `coat`/`markings` rows are dropped rather than mapped. That is the same rule as `catsFeeding`, read from the row's side; it is counted below as a `catsFeeding` ruling.

Sightings are not in scope for `catsFeeding`: a merge **moves** every sighting of the merged-away cat to the survivor (spec §4.2, first bullet; PR 4.1), so `sightingsTable.catId` already names the survivor once the merge commits. The same holds for `cat_subscriptions` (followers move, D4) and `points_ledger` (credit stays, §4.2).

---

## 2. Every read of cats

**The shapes searched** (§5 has the exact commands): any `.from(` / `.innerJoin(` / `.leftJoin(` / `.rightJoin(` / `.fullJoin(` / `.crossJoin(catsTable`, `alias(catsTable`, `${catsTable}` in a template, `db.query.cats`, and raw SQL matching `\b(from|join)\s+cats\b` (case-insensitive). Every hit was read in context; a by-id load is told apart from a list only by reading the function.

**How the rulings were made, so the builder can extend them the same way:**
- A read that **decides which cats appear** in a list, a count, a pool or a search → **`liveCats`**.
- A read that fetches columns for **ids a list already chose** → **`liveCats`** too (`where: inArray(catsTable.id, ids)`), so a merge committing between the two queries can't leak a merged-away row.
- **One cat by id** for a page or an action → **allowlist**. The spec's survivor handling for those (§9.3 table: `GET /cats/:id`, resolve, follow, name, let-go, `PATCH`, team corrections, welfare and `cat_updates` lists) is **PR 4.1**, which owns `MERGED` and `mergedFrom`; this PR doesn't move them.
- A **name for an id a stored row already names** (a log, a report, a batch line, a notification) → **allowlist**: dropping a merged-away id would leave "#123" or drop the row; showing the survivor instead is PR 4.1 where the spec asks for it.
- **A lock by id before a write**, and **an existence check before a write** → **allowlist**.
- **Credit and ownership** (who discovered, who owns): **allowlist**, spec §4.2 "Points and credit: unchanged for everyone" and §4.1 (only the staying record can have an owner).
- **Name taken**: **allowlist**. A merged-away cat's name stays taken (§4.2 "Nobody can give a new cat the name Mimi while she's part of Agatha"); naming the survivor in the prompt is PR 4.1.

### 2.1 `artifacts/api-server/src/lib` (a–m)

| # | file:line | function | reads | ruling | reason |
|---|---|---|---|---|---|
| C1 | `lib/badges/award.ts:123` | `isFirstCatInArea` | this cat's `(created_at, id)` | allowlist | credit: a badge decision on the registering cat's own row; a merge changes no credit (§4.2) |
| C2 | `lib/badges/award.ts:129` | `isFirstCatInArea` | resolved sightings of other cats in the area, `join cats` for `redacted_at` | allowlist | credit: who was first in an area is history; a merge changes no credit (§4.2) |
| C3 | `lib/badges/award.ts:144` | `isFirstCatInArea` | other cats near the area (`from cats`) | allowlist | credit, as C2. Ambiguous (see Risks R7) |
| C4 | `lib/badges/backfill.ts:184` | `historyEventBadges` | this device's resolved sightings `join cats` on discoverer | allowlist | credit: discoverer badges stay with both discoverers (§4.2) |
| C5 | `lib/badges/stats.ts:25` | `computeBadgeStats` | count of cats this device discovered | allowlist | credit: "both spotters who discovered a record keep the credit" (§4.2) |
| C6 | `lib/capabilityTargets.ts:103` | `catsOfPhoto` | cats whose main photo is this photo | allowlist | lookup by photo id; the ids go through `canonicalCatOf` in `targetsOf` (PR 1.1); moved rows are PR 3.1 |
| C7 | `lib/catHelpers.ts:523` | `listCatsWithStats` | every cat, ordered (the public list, map and nearby list: `GET /cats`) | **liveCats** | spec §9.3 row 1: the public list and map leave out merged-away cats; `total` must drop too |
| C8 | `lib/catHelpers.ts:557` | `listCatsWithStats` | full rows for this page's ids | **liveCats** | ids already chosen by C7; `liveCats` with `inArray(pageIds)` so a merge between the two queries can't leak |
| C9 | `lib/catHelpers.ts:649` | `getProfileStats` | count of cats this device discovered | allowlist | credit (§4.2), as C5 |
| C10 | `lib/catHelpers.ts:723` | `totalCatCount` | count of every cat ("12 of 142") | **liveCats** | spec §9.3 / §4.2: "The island count goes down by one" |
| C11 | `lib/catHelpers.ts:774` | `profilePayload` | cats this device owns | allowlist | owner lookup: a merged-away cat never has an owner (§4.1, refused in PR 4.1) |
| C12 | `lib/catNames.ts:17` | `catNamed` | the cat holding a folded name | allowlist | name taken: a merged-away cat's name stays taken (§4.2); the prompt naming the survivor is PR 4.1 |
| C13 | `lib/claiming.ts:42` | `claimEligibility` | one cat by id (owner) | allowlist | single-cat load by id; the merged-away refusal is already `canonicalCatOf` at `claiming.ts:63` (PR 1.1) |
| C14 | `lib/coatReading/due.ts:123` | `catsDueForReading` | every cat (or the given ids) due a coat reading | **liveCats** | a list; replaces the read-then-`catsMergedAway` filter at `due.ts:132` with one query |
| C15 | `lib/colonyCats.ts:83` | `placeCats` | the chosen cats, `for update` | allowlist | lock by id before a write; placing on the survivor is a team correction route (PR 4.1) |
| C16 | `lib/colonyCats.ts:173` | `searchCatsToAdd` | cats matching a name or SYR number | **liveCats** | a search list; Mimi drops out (§4.2); "also known as" is PR 4.1 |
| C17 | `lib/colourCheck.ts:100` | `listColourCheck` | every cat, for the Colour check list | **liveCats** | a list of cats (plan review's missed reader) |
| C18 | `lib/commitStatement.ts:92` | `commitStatement` | the cat being written, `for update` | allowlist | lock by id before a write (the sterilised announcement) |
| C19 | `lib/dashboard/trappingPlan.ts:199` | `trappingPlan` | where each cat in this colony was first found (`needRows`) | **liveCats** | ids come from `catsInColony` (which moves, S-rulings); the comment "merged-away halves" goes, since a survivor's colony now covers them |
| C20 | `lib/findFromPhoto.ts:113` | `displayPhotoOf` | display photo for ids from `allTeamCats` | **liveCats** | a candidate list for "Find this cat" (§9.3 row: `findFromPhoto.ts` leaves out merged-away cats) |
| C21 | `lib/findFromPhoto.ts:323` | `referencePhotos` | display photo for the cats to compare | **liveCats** | as C20: a merged-away cat is never a candidate |
| C22 | `lib/guardianCatView.ts:138` | `guardianCats` | a guardian's cats by id (from `catsInColony`) | **liveCats** | a list of a colony's cats (plan review's missed reader) |
| C23 | `lib/guardianChanges.ts:296` | `listGuardianChanges` | names for the cats a change-log row names | allowlist | a log: each entry names the cat its own row is on |
| C24 | `lib/guardianStatements.ts:66` | (guardian authority check) | `select id from cats where id = <canonical> for update` | allowlist | lock by id before a write; already locks the canonical cat (PR 1.1) |
| C25 | `lib/issues/queue.ts:153` | `issueRows` | the cat a content report names (`left join cats`) | allowlist | a report's own cat named by id; "show under the survivor" is PR 4.1 (§9.3 welfare_reports row) |
| C26 | `lib/likelyReview.ts:65` | `listLikelyForReview` | cats with an `ear_tip` statement (`innerJoin cats`) | **liveCats** | a list: map the ear-tip cats through `canonicalCatOf`, then `liveCats` by id (Likely must show Agatha once, not Mimi too); its moved-row handling is PR 3.1 |
| C27 | `lib/mail/outbox.ts:178` | `sendIssueDigestIfDue` | open content reports grouped by cat name | allowlist | each report names its own cat by id (an email digest); survivor display is PR 4.1 |
| C28 | `lib/mail/outbox.ts:609` | `payload` (issue alert) | the one cat a report names | allowlist | single-cat load by id for one report's email |
| C29 | `lib/matcherHealth.ts:173` | `newCatsAfterFailedCheck` | new cats made after a failed photo check (`innerJoin cats`) | **liveCats** | spec §9.3 row: "New cats to check" leaves out merged-away cats; write it as `liveCats(...).innerJoin(sightingsTable…)`; `new_cat_checks` exclusion is PR 5.1 |

### 2.2 `artifacts/api-server/src/lib` (n–z)

| # | file:line | function | reads | ruling | reason |
|---|---|---|---|---|---|
| C30 | `lib/movedAway.ts:117` | `movedAwayNotices` | names for the cats that left her colony | **liveCats** | the cats come from a statement read that moves to `catsFeeding` (S-rulings), so they are survivors; a list |
| C31 | `lib/news/nightly.ts:339` | `catsToWalk` | `where cat_id in (select id from ${catsTable})` | **liveCats** | spec §9.3 row: the nightly walker skips merged-away cats; write `inArray(x, liveCats({ id: catsTable.id }))` or `notMergedAway`; silencing and re-baselining are PR 3.1/4.1 |
| C32 | `lib/observations.ts:1509` | `loadCatRecords` | `created_at` for every id feeding the asked cats | allowlist | reads merged-away feeders **on purpose** (their `created_at` folds into the survivor's); ids come from `catsFeeding` |
| C33 | `lib/publicCat.ts:93` | `publicCatView` | one cat by id (public cat page, `teamMy`) | allowlist | single-cat load by id; `GET /cats/:id` returning the survivor with `mergedFrom` is PR 4.1 |
| C34 | `lib/recentGuardianChanges.ts:214` | `into` (`recentGuardianChanges`) | names for the cats a recent change names | allowlist | a log: each entry names the cat its own row is on |
| C35 | `lib/reports/progress.ts:76` | `loadProgressInputs` | where each cat was found, for ids from `loadTeamCats` | **liveCats** | the Progress report counts cats (plan names `reports/progress.ts`) |
| C36 | `lib/reports/vetCosts.ts:197` | `vetCostsReport` | names for the cats with vet visits | **liveCats** | the visit rows move to their survivors (S-rulings, island-wide read), so the names are survivors' |
| C37 | `lib/sightingRoundUp.ts:137` | `sendDailyRoundUp` | followed cats' updates `join cats` for the name | allowlist | a later PR changes it: plan PR 3.1 item 3 (moved rows) and PR 4.1 (followers and `cat_updates` move to the survivor) |
| C38 | `lib/teamCatList.ts:212` | `loadTeamCats` | every cat as of `asOf` | **liveCats** | the team list; `liveCats({ asOf })` replaces the read-then-`catsMergedAway` filter at `teamCatList.ts:215` |
| C39 | `lib/teamCatList.ts:350` | `catTrail` | one cat by id, for the map's focus trail | allowlist | single-cat load by id; the merged-away team page is PR 4.2 |
| C40 | `lib/teamCatView.ts:739` | `crossCatLinks` | the cat a replacing statement is on (`leftJoin cats`) | allowlist | names the other cat a statement was re-tied to, by the row's own cat id ("moved to X"); move/merge rows are PR 3.1/4.2 |
| C41 | `lib/teamCatView.ts:755` | `crossCatLinks` | the cat a replaced statement is on (`leftJoin cats`) | allowlist | as C40, the other direction |
| C42 | `lib/teamCatView.ts:828` | `teamCatView` | one cat by id (the team cat page) | allowlist | single-cat load by id; the merged-away team page is PR 4.2 |
| C43 | `lib/teamCatView.ts:1289` | `searchTeamCats` | every cat, for team search | **liveCats** | plan PR 1.2 item 1; "Mimi (now part of Agatha)" and "also known as" are PR 4.1 |
| C44 | `lib/teamColonies.ts:213` | `catHistoryEntries` | names for the cats in a colony's history | **liveCats** | the history rows move to `catsFeeding` (S-rulings), so they name survivors |
| C45 | `lib/teamColonies.ts:342` | `colonyView` | this colony's cats by id (from `catsInColony`) | **liveCats** | a list of a colony's cats (plan names `teamColonies.ts`) |
| C46 | `lib/teamCorrections.ts:238` | `recordTeamStatement` | the cat exists | allowlist | existence check before a write; acting on the survivor is PR 4.1 |
| C47 | `lib/teamCorrections.ts:303` | `removeOwnerAndSay` | `select id from cats … for update` | allowlist | lock by id before a write |
| C48 | `lib/teamCorrections.ts:308` | `removeOwnerAndSay` | the locked cat's owner and name | allowlist | single-cat load by id under the lock (owner never moves, §4.2) |
| C49 | `lib/teamCorrections.ts:457` | `catOwnerState` | one cat's name and owner | allowlist | single-cat load by id (owner never moves, §4.2) |
| C50 | `lib/teamCorrections.ts:581` | `supersedeStatement` (`run`) | `select id from cats … for update` | allowlist | lock by id before a write |
| C51 | `lib/teamCorrections.ts:659` | `lockCat` | `select id from cats … for update` | allowlist | lock by id before a write |
| C52 | `lib/teamCorrections.ts:1021` | `renameCat` | one cat's name | allowlist | single-cat load by id before a write; a merged-away rename is refused in PR 4.1 |
| C53 | `lib/teamCorrections.ts:1075` | `addTeamNote` | the cat exists | allowlist | existence check before a write |
| C54 | `lib/teamOnlyPhotos.ts:46` | `teamOnlyPhotoIds` | whether any cat shows these vet photos as its main photo | allowlist | lookup by photo id: a merged-away cat's main photo stays as public as it was (nothing is un-published by a merge). Ambiguous (Risks R6) |
| C55 | `lib/vetBatchRoutes.ts:91` | `pageFor` | names and photos for the cats a vet batch names | allowlist | each batch line names its own cat by id; dropping one would blank a batch line |
| C56 | `lib/vetVisits.ts:172` | `lockCat` | `select id from cats … for update` | allowlist | lock by id before a write |
| C57 | `lib/vetVisits.ts:608` | `saveBatch` (`add`) | names for the cats a batch names | allowlist | each batch line names its own cat by id (an error message) |
| C58 | `lib/vetVisits.ts:639` | `saveBatch` (`add`) | a cat holding a new cat's name | allowlist | name taken: merged-away names stay taken (§4.2) |
| C59 | `lib/weekBoard.ts:17` | `uniqueCatsSql` | cats this spotter discovered (week board tie-break) | allowlist | credit (§4.2) |
| C60 | `lib/welfareQueue.ts:37` | (module) `suggestedCat` | `alias(catsTable)`: the cat a reporter sent the report from | allowlist | the alias joined by `reporter_cat_id` (C61's query); a report's own cat by id; survivor display is PR 4.1 |
| C61 | `lib/welfareQueue.ts:315` | `reportsQuery` | the cat a welfare report is tied to (`leftJoin cats`), and C60 | allowlist | a report's own cat named by id; "welfare_reports readers … show under the survivor" is PR 4.1 |
| C62 | `lib/welfareTie.ts:146` | `tieReportToCat` | the cat exists | allowlist | existence check before a write; tying to the survivor is PR 4.1 |
| C63 | `scripts/smokeCheck.ts:129` (`artifacts/api-server/src/scripts`) | smoke check | display photos for ids from `allTeamCats` | **liveCats** | ids already live; read through `liveCats` like every other list |

### 2.3 `artifacts/api-server/src/routes`

| # | file:line | function | reads | ruling | reason |
|---|---|---|---|---|---|
| C64 | `routes/cats.ts:83` | `POST /cats/name-suggestions` | every cat's name (names already in use) | allowlist | deliberate raw read: every name in use, merged-away ones included, since they stay taken (§4.2) |
| C65 | `routes/cats.ts:215` | `GET /cats/:catId` | one cat by id | allowlist | single-cat load by id; the survivor page with `mergedFrom` is PR 4.1 |
| C66 | `routes/cats.ts:434` | `POST /cats/:catId/claim` | one cat by id | allowlist | single-cat load by id; `MERGED` refusal is PR 4.1 (and `claimEligibility` already refuses a merged-away cat) |
| C67 | `routes/cats.ts:492` | `POST /cats/:catId/claim` | `select id from cats … for update` | allowlist | lock by id before a write |
| C68 | `routes/cats.ts:535` | `POST /cats/:catId/claim` | the cat again, after the claim | allowlist | single-cat load by id (the response) |
| C69 | `routes/cats.ts:584` | `POST /cats/:catId/let-go` | `select id from cats … for update` | allowlist | lock by id before a write |
| C70 | `routes/cats.ts:587` | `POST /cats/:catId/let-go` | the locked cat's owner | allowlist | single-cat load by id under the lock |
| C71 | `routes/cats.ts:620` | `POST /cats/:catId/let-go` | the cat again (the response) | allowlist | single-cat load by id; let-go on the survivor is PR 4.1 |
| C72 | `routes/cats.ts:663` | `followHandler` | `select id from cats … for update` | allowlist | lock by id before a write |
| C73 | `routes/cats.ts:666` | `followHandler` | the locked cat's owner | allowlist | single-cat load by id; follow acting on the survivor is PR 4.1 |
| C74 | `routes/cats.ts:783` | `POST /cats/:catId/name` | `select id, name_pending, redacted_at from cats … for update` | allowlist | lock by id before a write; `MERGED` is PR 4.1 |
| C75 | `routes/cats.ts:791` | `POST /cats/:catId/name` | a cat holding the folded name | allowlist | name taken: merged-away names stay taken (§4.2) |
| C76 | `routes/cats.ts:878` | `PATCH /cats/:catId` | one cat by id | allowlist | single-cat load by id before a write; acting on the survivor is PR 4.1 |
| C77 | `routes/issues.ts:375` | `POST /issues` | the reported cat and its main photo | allowlist | single-cat load by id for a report (existence before a write) |
| C78 | `routes/notifications.ts:36` | `POST /cats/:catId/updates` | one cat by id | allowlist | single-cat load by id before a write |
| C79 | `routes/notifications.ts:138` | `GET /notifications/:deviceId` | the cat a `cat_update` names (`leftJoin cats`) | allowlist | each notification names its own cat by id; "cat_updates/notifications list … show under the survivor" is PR 4.1 |
| C80 | `routes/reports.ts:266` | `knownCatId` | the cat exists | allowlist | existence check before a write (a welfare report's cat) |
| C81 | `routes/sightings.ts:267` | `computeMatchCandidates` | every cat, for the matcher pool | **liveCats** | spec §9.3 row: the matcher candidate pool leaves out merged-away cats |
| C82 | `routes/sightings.ts:753` | `storedAnswer` | the cats a stored match answer suggested | **liveCats** | a candidate list replayed later: a cat merged away since must not come back as a suggestion (§4.2 "photo check's candidates") |
| C83 | `routes/sightings.ts:928` | `POST /sightings/:sightingId/resolve` | the chosen cat by id | allowlist | single-cat load by id before a write; resolve files under the survivor in PR 4.1 |
| C84 | `routes/sightings.ts:1103` | `POST /sightings/:sightingId/resolve` | `select 1 from cats … for share` | allowlist | lock by id before a write (the auto-follow) |
| C85 | `routes/teamNews.ts:47` | `GET /team/news-changes` | the cat a news change names (`leftJoin cats`) | allowlist | a log: each change names its own cat by id; merge silencing is PR 4.1 |
| C86 | `routes/teamVetBatches.ts:285` | confirm a batch line | the typed cat id exists | allowlist | existence check before a write. Ambiguous (Risks R8) |

### 2.4 `lib/db/src`

| # | file:line | function | reads | ruling | reason |
|---|---|---|---|---|---|
| C87 | `lib/db/src/photoRemoval/list.ts:28` | `listCatPhotos` | one cat's main photo id (`from cats where id = $1`) | allowlist | deliberate raw read: the photo-removal tool (SYC-462) lists one cat's photos by id |
| C88 | `lib/db/src/photoRemoval/list.ts:33` | `listCatPhotos` | whether a photo is that cat's main photo | allowlist | as C87 |
| C89 | `lib/db/src/photoRemoval/remove.ts:68` | dry run (`one`) | cats whose main photo is this photo | allowlist | deliberate raw read by photo id: removal must repoint every cat showing it, merged-away ones included |
| C90 | `lib/db/src/photoRemoval/search.ts:273` | removal check | cats whose main photo is this photo | allowlist | deliberate raw read by photo id, as C89 |
| C91 | `lib/db/src/photoRemoval/standIn.ts:24` | `standInFor` | whether a photo is any cat's main photo | allowlist | deliberate raw read by photo id, as C89 |

### 2.5 Writes found by the wider grep (not read shapes, so not scanned by the guard)

`insert(catsTable)`: `lib/vetVisits.ts:500` (`createBatchCat`), `routes/sightings.ts:1025` (resolve, new cat). `update(catsTable)`: `lib/claiming.ts:238` (`clearOwner`), `lib/teamCorrections.ts:1034` (`renameCat`), `lib/vetVisits.ts:512` (`createBatchCat`), `routes/cats.ts:504` (claim), `routes/cats.ts:795` (name), `routes/cats.ts:949` (`PATCH`). Raw `update cats`: `lib/severPerson.ts:80`, `lib/severPerson.ts:87` (deleting a person), `lib/db/src/photoRemoval/remove.ts:153` (repoint a main photo). None of these reads a list. Refusing a write on a merged-away cat is PR 2.1's trigger and PR 4.1's routes.

`lib/db/src/switchover/fingerprint.ts:14` names `"cats"` as a table to fingerprint for the database switchover: a whole-table copy check, not a reader. No ruling needed.

---

## 3. Every read of statements by cat id

**The shapes searched:** `eq` / `ne` / `inArray` / `notInArray` with `observationsTable.catId` (or an `alias(observationsTable)`'s `.catId`) as either argument, `${observationsTable.catId}` inside a `sql` template, rebinding the table to a bare name (`const o = observationsTable`, which hides every later `o.catId`), and raw SQL templates that name `observations` and compare a `cat_id`. One hit is one query (the `orderBy` / `selectDistinctOn` / select-field uses of `catId` inside the same query are part of it, listed in "lines").

How the rulings were made: a read that **shows or counts what is known about a cat** moves to `catsFeeding`; a read that **checks a write against the statement chain it writes into** (supersede, retract, a visit link) stays on the row's own cat, because a supersede chain never crosses cats; a reader the plan gives to a later PR is allowlisted naming that PR.

### 3.1 Hits

| # | file:line (lines) | function | reads | ruling | reason |
|---|---|---|---|---|---|
| S1 | `lib/claiming.ts:167` (raw) | `newestActiveOwnerHomed` | the active owner "has a home" statement on this cat | allowlist | owner: the staying record keeps its owner and the other never has one (§4.1, §4.2) |
| S2 | `lib/claiming.ts:190` (raw) | `letGoWithinDays` | this phone let go of this cat recently | **catsFeeding** | spec §9.3 table: claim waits check every cat feeding the survivor (§4.2 "checked against both records"); in the raw template, `observationCatIn([f], sql.raw("cat_id"))` |
| S3 | `lib/claiming.ts:216` (raw, `w`/`h`) | `removedByTeamWithinDays` | the team removed this phone as owner recently | **catsFeeding** | as S2; both `w.cat_id` and `h.cat_id` take `observationCatIn([f], …)` |
| S4 | `lib/colonyMembership.ts:60` (39–67) | `currentColonyOf` | each cat's newest standing colony statement | **catsFeeding** | colony counts over both records (§4.2). The hub: `loadTeamCats`, `catsByColony`, `catsInColony` all read it (Risks R3). With no `catIds` (the whole island), the targets are `liveCats` |
| S5 | `lib/dashboard/colonyFigures.ts:135` (126–142) | `firstColonyOf` | each cat's earliest colony statement | **catsFeeding** | "first recorded in" is the earliest over both records (§4.2) |
| S6 | `lib/guardianChanges.ts:251` | `listGuardianChanges` | every statement of the same kinds on the cats a guardian spoke about, to say which of hers still stand | **catsFeeding** (`excludeKinds: ['coat','markings']`) | the restore rule (`supersedeChains`) must see the same rows the cat page's resolver sees, which after a merge is both records' rows |
| S7 | `lib/likelyReview.ts:65` | `listLikelyForReview` | `innerJoin(catsTable, eq(catsTable.id, observationsTable.catId))` | **liveCats** | the same query as C26; counted under liveCats |
| S8 | `lib/movedAway.ts:80` (74–85) | `movedAwayNotices` | the candidates' colony statements, newest first | **catsFeeding** | a move is read off the survivor's combined colony history (§4.2) |
| S9 | `lib/observations.ts:882` | `checkVisitLink` | this cat's vet visits, to check a linked statement's visit stands | allowlist | checks a write against the visit chain on the row's own cat. But see Risks R5: the same-cat test at `observations.ts:875` needs PR 3.1's canonical comparison |
| S10 | `lib/observations.ts:1185` | `writeObservation` (retraction) | same-kind rows on the target's cat, to check the target still stands | allowlist | checks a write against its own supersede chain, which never crosses cats |
| S11 | `lib/observations.ts:1455` | `loadCatRecords` | every statement of every cat feeding the asked cats | **catsFeeding** (`excludeKinds: ['coat','markings']`) | already reads `catsFeeding` ids (PR 1.1) but **folds a merged-in cat's coat and markings in**; spell it `observationCatIn` and keep `f.counts(row)` per target (Risks R1) |
| S12 | `lib/observations.ts:1474` | `loadCatRecords` | welfare reports replaced by a row on any cat | **catsFeeding** | already the `catsFeeding` ids; spell it `observationCatIn`; PR 3.1 generalises the query (plan C11) |
| S13 | `lib/teamCatView.ts:739` | `crossCatLinks` | join condition naming the replacing row's cat | allowlist | rows chosen by `supersedes_id`, not by cat; the join only names the row's own cat (C40) |
| S14 | `lib/teamCatView.ts:755` | `crossCatLinks` | join condition naming the replaced row's cat | allowlist | as S13 (C41) |
| S15 | `lib/teamColonies.ts:203` (197–208) | `catHistoryEntries` | the colony statements of every cat ever in this colony | **catsFeeding** | the colony history reads the survivor's combined record (plan names `teamColonies.ts`) |
| S16 | `lib/teamCorrections.ts:106` | `colonyAfterMarkingWrong` | the cat's original colony statements, to say where it goes back to | **catsFeeding** | "where its other statements put it" means both records' statements once merged; resolve `original.catId` with `canonicalCatOf` first. Ambiguous (Risks R9) |
| S17 | `lib/teamCorrections.ts:175` | `lockActiveObservation` | same-kind rows on the row's cat, to check it still stands | allowlist | checks a write against its own supersede chain |
| S18 | `lib/teamCorrections.ts:927` | `agreeWithClip` | the spotter's cat's `ear_tip` and `sterilised` rows | allowlist | a later PR changes it: plan PR 3.1 item 3 (refuse a moved row, resolve and lock the canonical cat) |
| S19 | `lib/vetVisits.ts:315` | `undoVetVisit` (`lock`) | the sterilised/vaccinated rows linked to this visit | allowlist | rows linked by `vetVisitId` are written on the visit's own cat, in the visit's transaction |
| S20 | `lib/vetVisits.ts:357` | `visitsFor` | this cat's vet visits | **catsFeeding** | plan PR 1.2 item 2; spec §4.2 "vet visits and their photos" count for the survivor (photos: A1) |
| S21 | `lib/vetVisits.ts:729` | `saveBatch` (`add`) | earlier vet visits for the batch's known cats (same-day check) | **catsFeeding** | a visit on a merged-in cat that day is a visit to the same animal. Ambiguous (Risks R10) |
| S22 | `routes/cats.ts:496` (raw) | `POST /cats/:catId/claim` | earlier owner "has a home" statements on this cat (is this the first claim?) | **catsFeeding** | "first claim" is of the animal, so both records' history counts. Low stakes; ambiguous (Risks R10) |
| S23 | `routes/sightings.ts:190` | `earTipStateFor` | this phone's `ear_tip` answer on this cat | allowlist | a later PR changes it: plan PR 3.1 item 3 |
| S24 | `routes/sightings.ts:198` | `earTipStateFor` | any `sterilised` statement on this cat | allowlist | a later PR changes it: plan PR 3.1 item 3 |
| S25 | `routes/sightings.ts:235` | `hasAnsweredEarTip` | this phone's `ear_tip` answer on this cat | allowlist | a later PR changes it: plan PR 3.1 item 3 |
| S26 | `lib/reports/vetCosts.ts:181` (`const o = observationsTable`; read at 186–194) | `vetCostsReport` | every sterilised and vet_visit row on the island | **catsFeeding** (row side, §1.2 item 8) | plan names `reports/vetCosts.ts`: each visit is listed and counted under its survivor (`canonicalCatOf`); drop the rebinding so the guard can see the table |

### 3.2 Statement reads the guard cannot see (keyed by something else, then filed under cats)

These read `observations` by colony, kind, role or for the whole island, and then group rows by `row.catId` in TypeScript. No source pattern can tell them from a read that never files rows under a cat, so the guard is blind to them. Each is listed here, and each needs spec test 15 (merge, then undo) in the builder's PR. **This is the gap most likely to let a reader slip through later** (Risks R2).

| # | file:line | function | reads | ruling | reason |
|---|---|---|---|---|---|
| B1 | `lib/colonyMembership.ts:83` | `catsInColony` | cats any colony statement put in this colony (candidates) | **catsFeeding** (row side) | map candidates through `canonicalCatOf` before S4, so the colony lists Agatha, not Mimi and Agatha |
| B2 | `lib/colonyMembership.ts:39` (no `catIds`) | `currentColonyOf` → `catsByColony` | every colony statement on the island | **catsFeeding** (row side) | island-wide: file each row under its survivor; targets are `liveCats` (part of S4's move) |
| B3 | `lib/movedAway.ts:59` | `movedAwayNotices` | candidates by colony | **catsFeeding** (row side) | as B1, before S8 |
| B4 | `lib/teamColonies.ts:188` | `catHistoryEntries` | cats ever touched by this colony's statements | **catsFeeding** (row side) | as B1, before S15 |
| B5 | `lib/reports/vetCosts.ts:186` | `vetCostsReport` | all sterilised/vet_visit rows | **catsFeeding** (row side) | the same query as S26 (counted there) |
| B6 | `lib/guardianChanges.ts:199`, `:208` | `listGuardianChanges` | a guardian's statements and the rows overruling them (by role) | allowlist | a log of her statements, each on the cat it was written on; S6 decides whether each still stands |
| B7 | `lib/recentGuardianChanges.ts:129` | `recentGuardianChanges` | guardians' colony statements (by role) | allowlist | a log: each entry is about the cat its row is on (C34 names it) |
| B8 | `lib/dashboard/home.ts:148` | `vetSpend` | every vet_visit (money spent) | allowlist | money, not cats: "Every visit counts, wherever the cat is" (its own comment); a merge changes no total |
| B9 | `lib/capabilityTargets.ts:118` | `catsOfPhoto` | statements with this photo | allowlist | by photo id; ids go through `canonicalCatOf` in `targetsOf` (PR 1.1); moved rows are PR 3.1 |

Checked and **not** cat-keyed (no ruling needed): reads by statement id (`observations.ts:841,852,873,1147`, `teamCorrections.ts:164,184,527,855,904`, `vetVisits.ts:291`, `guardianStatements.ts:205`, `coatReading/record.ts:118`, `coatReading/sweep.ts:178`, `teamAuth/heldTyping.ts:77`, `routes/teamCats.ts:684`), by sighting (`routes/sightings.ts:1357,1392,1484`), by report (`welfareTie.ts:113,129`), by device (`routes/appSettings.ts:54`) and by photo (`lib/db/src/photoRemoval/remove.ts:78`). The loose `cat_id` grep's other hits are on `sightings`, `cat_subscriptions` or the schema, not `observations`: `claiming.ts:114–121` (`hasMetCat`, on sightings; PR 3.1), `news/nightly.ts:337–341`, `teamCatList.ts:226–238`, `routes/sightings.ts:1105–1109`, `schema/observations.ts:26,100`.

### 3.3 Other cat-keyed tables the spec names (§9.3: "The same goes for cat-keyed tables")

Neither guard covers these, because they're other tables. They're listed so the builder moves them along with the readers above.

| # | file:line | function | reads | ruling | reason |
|---|---|---|---|---|---|
| A1 | `lib/vetVisits.ts:381` | `visitsFor` | `vet_visit_photos` by `catId` | **catsFeeding** | spec §4.2 "vet visits and their photos"; moves with S20 |
| A2 | `lib/capabilityTargets.ts:126`, `:130` | `catsOfPhoto` | `vet_visit_photos` / `vet_batch_cats` by photo | allowlist | by photo; canonical in `targetsOf` |
| A3 | `routes/cats.ts:292` | `GET /cats/:catId` (care timeline) | `cat_updates` by `catId` | **catsFeeding** | plan PR 1.2 item 2 names it; PR 4.1 then serves the survivor's page |
| A4 | `lib/catHelpers.ts:374` | `deriveCatStatuses` (legacy fallback) | `desexed` `cat_updates` for a page of cats | **catsFeeding** | runs only before the PR 3 switch (`pr3Recorded`), but a page of cats is a by-cat read; cheap to keep consistent |
| A5 | `lib/commitStatement.ts:106` | `commitStatement` | whether this cat already has a `desexed` update | allowlist | write path (one announcement per cat); merge silencing is PR 4.1 |
| A6 | `lib/dashboard/colonyFigures.ts:187` | `kittensTiedToCats` | `welfare_reports.cat_id` of counted litters | **catsFeeding** (row side) | file each report under its survivor's colony (§4.2 "welfare reports" count for the survivor) |
| A7 | `routes/issues.ts:351` | `POST /issues` | an earlier identical report by this phone on this cat | allowlist | duplicate-report check on the raw ids the phone sent (one report's own cat) |
| A8 | `lib/vetBatches.ts:262` | `updateCat` | one `vet_batch_cats` row by its id | allowlist | by row id |

---

## 4. Where the public map gets its cats (spec §9.3 row 1)

**It comes from `listCatsWithStats`.** The app's map is `AppMap` on the Cats tab (`artifacts/cat-spotter/app/(tabs)/cats.tsx:286`), fed by `useCatsWithCache` (`cats.tsx:63`), which calls the generated `listCats` (`hooks/useCatsWithCache.ts:4,49-50`), which is `GET /api/cats` (`lib/api-client-react/src/generated/api.ts:187`), which is `listCatsWithStats` (`routes/cats.ts:188-201`). The home tab's nearby strip uses the same hook (`app/(tabs)/index.tsx:57,108`), so C7/C8 cover the list, the map and the nearby list together. The map's tiles (`lib/mapSource.ts`, `tiles.catspotters.com`) carry no cats. Nothing needs adding.

The team's island map (`routes/teamMap.ts`) draws no cats (only a tapped spot), and the team cat map reads `allTeamCats` → `loadTeamCats` (C38).

---

## 5. Counts, the exact commands, and the two guards

### 5.1 Counts

**Cats (91 hits in 50 files):**

| shape | hits |
|---|---|
| `.from(catsTable` | 58 |
| `.innerJoin(catsTable` | 2 |
| `.leftJoin(catsTable` | 5 |
| `alias(catsTable` | 1 |
| `${catsTable}` in a template | 1 |
| raw `from cats` / `join cats` | 24 |
| `db.query.cats`, `.rightJoin`/`.fullJoin`/`.crossJoin(catsTable`, `= catsTable` rebinding | 0 |

| ruling | hits |
|---|---|
| move to `liveCats` | 23 (C7, C8, C10, C14, C16, C17, C19, C20, C21, C22, C26, C29, C30, C31, C35, C36, C38, C43, C44, C45, C63, C81, C82) |
| allowlist | 68: single-cat load by id 18; lock by id 12; existence check before a write 5; a row's own cat named by id (logs, reports, batch lines, notifications) 12; credit or owner 8; name taken 4; photo removal (deliberate raw read) 5; lookup by photo id 2; reads feeders on purpose 1; a later PR 1 |

Plus 11 writes (§2.5), not read shapes and not scanned.

**Statements (26 hits in 14 files):**

| shape | hits |
|---|---|
| `eq`/`ne`/`inArray`/`notInArray(observationsTable.catId, …)` | 18 |
| `eq(x, observationsTable.catId)` (catId second) | 3 |
| `${observationsTable.catId}` in a template, or an alias's `.catId` | 0 |
| `= observationsTable` rebinding | 1 |
| raw template naming `observations` and comparing `cat_id` | 4 |

| ruling | hits |
|---|---|
| move to `catsFeeding` | 14 (S2, S3, S4, S5, S6, S8, S11, S12, S15, S16, S20, S21, S22, S26), of which with `excludeKinds: ['coat','markings']`: 2 (S6, S11) |
| move to `liveCats` | 1 (S7, the same query as C26) |
| allowlist | 11 (a write checked against its own chain 4; owner 1; a later PR (3.1) 4; a join naming a row's own cat 2) |

**Not caught by the guard** (§3.2): 9 readers, 5 move (row side) and 4 are allowlisted logs or by-photo/money reads. **Other cat-keyed tables** (§3.3): 8 readers, 4 move to `catsFeeding`, 4 stay.

**Totals across the doc:** 134 rows (91 + 26 + 9 + 8); moves: 23 + 1 to `liveCats`, 14 + 5 + 4 to `catsFeeding`.

### 5.2 The commands

From the repo root, on `claude/syc-410-pr1.2-live-cats` at the commit named in the report. The first two are plain greps; the third needs the template-aware scan, so the sweep script that produced every count above is committed beside this doc: `python3 -I docs/superpowers/plans/syc-410-pr1.2-sweep.py cats|statements [--lines]`.

```sh
grep -rnE '\.(from|innerJoin|leftJoin|rightJoin|fullJoin|crossJoin)\(\s*catsTable\b|\balias\(\s*catsTable\b|\$\{\s*catsTable\s*\}|\bquery\.cats\b|=\s*catsTable\s*[;,)]' artifacts lib scripts --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.cjs' | grep -vE '/node_modules/|/dist/|/migrations/|/__fixtures__/|/test/|\.test\.' | grep -vE '^[^:]+:[0-9]+:\s*(//|\*)' | wc -l
```
→ 67

```sh
grep -rniE '\b(from|join)\s+cats\b' artifacts lib scripts --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.cjs' | grep -vE '/node_modules/|/dist/|/migrations/|/__fixtures__/|/test/|\.test\.' | grep -vE '^[^:]+:[0-9]+:\s*(//|\*)' | wc -l
```
→ 24 (67 + 24 = 91)

```sh
grep -rnE '\b(eq|ne|inArray|notInArray)\(\s*observationsTable\.catId\b|\b(eq|ne)\([^()]*,\s*observationsTable\.catId\s*\)|\$\{\s*observationsTable\.catId\s*\}|=\s*observationsTable\s*[;,)]' artifacts lib scripts --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.cjs' | grep -vE '/node_modules/|/dist/|/migrations/|/__fixtures__/|/test/|\.test\.' | grep -vE '^[^:]+:[0-9]+:\s*(//|\*)' | wc -l
```
→ 22; plus the 4 raw templates from `python3 -I docs/superpowers/plans/syc-410-pr1.2-sweep.py statements --lines | grep raw` (`claiming.ts:167,190,216`, `routes/cats.ts:496`) = 26.

The wider first-pass greps used to find writes, aliases and blind spots (all read by hand, §2.5, §3.2, §3.3):

```sh
grep -rn -i -E '\b(update|into)\s+cats\b|,\s*cats\s+[a-z]\b|"cats"|\bpublic\.cats\b' artifacts/api-server/src lib/db/src scripts --include='*.ts'
grep -rn -E 'alias\(' artifacts/api-server/src lib/db/src scripts --include='*.ts'
grep -rn -E '\.(from|innerJoin|leftJoin)\(\s*(observationsTable|o)\b|\b(from|join)\s+observations\b|\$\{observationsTable\}' artifacts/api-server/src lib/db/src scripts --include='*.ts'
grep -rn -E '(vetVisitPhotosTable|vetBatchCatsTable|welfareReportsTable|catUpdatesTable)\.catId' artifacts/api-server/src lib/db/src --include='*.ts'
```
(each piped through `grep -vE '\.test\.|__fixtures__|/test/|/migrations/'`).

Scope note: `artifacts` includes the app (`cat-spotter`) and `mockup-sandbox`; neither has a hit (the app never queries the database).

### 5.3 The two structural guards

Both follow `catIdentityGuard.test.ts` (PR 1.1) and `welfareKindGuard.test.ts`, and sit beside them in `artifacts/api-server/src/lib/`: `liveCatsGuard.test.ts` and `statementsByCatGuard.test.ts`.

**What they scan** (exactly `catIdentityGuard`'s walk): roots `artifacts`, `lib`, `scripts`; skip directories `node_modules`, `dist`, `build`, `.expo`, `.git`, `coverage`, `migrations`, `__fixtures__`; skip `*.test.*` and anything under `/test/`; extensions `ts tsx mts cts js mjs cjs`; comments stripped with `withoutComments` (a `//` after `:` is a URL, kept). Reuse PR 1.1's `walk` and `withoutComments` (export them from a shared non-test helper under `src/test/`, which the scan skips, rather than copying a third time).

**Patterns.**

*Cats* (`liveCatsGuard.test.ts`): any of
- `/\.(from|innerJoin|leftJoin|rightJoin|fullJoin|crossJoin)\(\s*catsTable\b/`
- `/\balias\(\s*catsTable\b/`
- `/\$\{\s*catsTable\s*\}/`
- `/\bquery\.cats\b/`
- `/\b(from|join)\s+cats\b/i` (raw SQL)
- `/=\s*catsTable\s*[;,)]/` (rebinding the table hides every later read)

Not matched, on purpose: `catsTable.<column>` (needed to pick fields for `liveCats`), `update(catsTable)` / `insert(catsTable)` and raw `update cats` (writes), and the word "cats" in strings and HTML.

*Statements* (`statementsByCatGuard.test.ts`): per file, collect `names = ["observationsTable", ...every x in "x = alias(observationsTable"]`, `col = (names).catId`; then any of
- `/\b(eq|ne|inArray|notInArray)\(\s*COL/`
- `/\b(eq|ne)\([^()]*?,\s*COL\s*\)/`
- `/\$\{\s*COL\s*\}/`
- `/=\s*observationsTable\s*[;,)]/` (rebinding)
- a backtick template whose body (nested `${…}` included) matches `/\bobservations\b(?!Table)/` and `/\bcat_id\s*(=|<>|!=|\bin\b)|(=|<>|!=)\s*(\w+\.)?cat_id\b/` (raw SQL by cat id); one hit per template.

Not matched, on purpose: `catId: observationsTable.catId` as a selected field, and comparisons on other columns. That leaves the §3.2 blind spot: reads keyed by colony, kind or role that group rows by `row.catId` in TypeScript. A third pattern on selected `catId` fields was tried (19 hits): it can't tell a moved reader (which still selects `catId` to group rows) from an unmoved one, so it would allowlist every moved reader and protect nothing. It is not proposed; §3.2's readers get spec test 15 instead.

**Allowlist format: one reason per hit, not per file.** `welfareKindGuard` keys by file and says plainly that a new query in a listed file is invisible to it. The plan's mutation probes (put a reader back on `.from(catsTable)`, on `.leftJoin(catsTable…)`, on a raw `from cats`) would then stay green in any already-listed file, such as `routes/cats.ts` with its 13 allowlisted hits. So:

```ts
/**
 * File (from the repo root, with "/") -> one reason per hit, in source order.
 * A file's hit count must equal its number of reasons: a new read in a listed
 * file turns this red as surely as a read in a new file.
 */
const ALLOWLIST: Record<string, readonly string[]> = {
  "artifacts/api-server/src/lib/catIdentity.ts": ["liveCats: the one place cats are listed and counted"],
  "artifacts/api-server/src/lib/catNames.ts": ["catNamed: name taken; a merged-away cat's name stays taken (spec §4.2)"],
  "artifacts/api-server/src/routes/cats.ts": [
    "name-suggestions: every name in use, merged-away ones included (§4.2)",
    "GET /cats/:catId: single cat by id; the survivor page with mergedFrom is PR 4.1",
    // …one per hit, in source order
  ],
};
```

Tests in each guard:
1. **Every hit is listed:** for each file, the hits found (with their `file:line`, printed in the failure message) must number exactly its reasons. An unlisted file, or one more hit than reasons, is red with a message naming the helper to use (`liveCats` / `notMergedAway`, or `catsFeeding` + `observationCatIn`).
2. **The list stays honest:** no listed file has fewer hits than reasons (a moved reader's reason must go).
3. **Every reason is a reason:** each is longer than 10 characters (as `welfareKindGuard`).
4. **The patterns themselves:** match `.from(catsTable)`, `.leftJoin(catsTable, …)`, `alias(catsTable, "x")`, `` sql`select 1 from cats` ``, `` sql`… join cats c on …` ``, `${catsTable}`, `const c = catsTable;`; don't match `catsTable.name`, `// from cats`, `update(catsTable)`, `"cats"`. Statements: match `eq(observationsTable.catId, 1)`, `inArray(observationsTable.catId, ids)`, `eq(catsTable.id, observationsTable.catId)`, `eq(replacer.catId, 1)` with `replacer = alias(observationsTable, …)`, `const o = observationsTable;`, `` sql`select 1 from observations where cat_id = ${x}` ``, `` sql`… from observations w … where w.cat_id = ${x}` ``; don't match `select({ catId: observationsTable.catId })`, `eq(observationsTable.id, x)`, `` sql`… from sightings where cat_id = ${x}` ``, and `` sql`… from observations where ${observationCatIn([f], sql.raw("cat_id"))}` ``.

**Limits, said plainly** (as both existing guards do): it reads source text, so a table reached through a re-export under another name is invisible; a hit swapped for another in the same file keeps the count (the reviewer of any PR touching a listed file checks its reasons); and §3.2's readers are invisible by construction.

**Expected size once the builder has applied the rulings:** cats 69 entries' worth of reasons (the 68 allowlisted hits + `liveCats` itself in `catIdentity.ts`); statements 11 (the allowlisted hits; `observationCatIn` builds `inArray(col, …)` with a parameter, which the patterns don't match). If the builder's count differs, a reader moved or stayed against its ruling.

**Mutation probes** (plan PR 1.2 item 5): commit first; then (a) `totalCatCount` back on `.from(catsTable)`; (b) `newCatsAfterFailedCheck` back on `.innerJoin(catsTable…)`, and separately one extra `.leftJoin(catsTable…)` added in an already-listed file (say `routes/notifications.ts`), which proves the per-hit count; (c) `catsToWalk` back on a raw `select id from cats`; (d) `visitsFor` back on `eq(observationsTable.catId, catId)`; (e) the claim wait back on raw `where cat_id = ${catId}`. Each goes red; `git checkout -- <file>` and the tree is clean again.

---

## 6. The plan's named files, checked

Every file the plan names in PR 1.2 items 1, 2 and 4 appears above:

- **Item 1 (`liveCats`):** `totalCatCount` C10; `listCatsWithStats` C7, C8; `trappingPlan.ts` C19; `colonyCats.ts` C15, C16; `reports/progress.ts` C35; the nightly walker C31; the matcher pool C81; `findFromPhoto.ts` C20, C21; `newCatsAfterFailedCheck` C29; the nearby list C7 (§4); `searchTeamCats` C43.
- **Item 2 (`catsFeeding`):** `visitsFor` S20 and its photos A1; `reports/vetCosts.ts` S26, B5, C36; `teamColonies.ts` S15, B4, C44, C45; `colonyMembership.ts` S4, B1, B2; `movedAway.ts` S8, B3, C30; `guardianChanges.ts` S6, B6, C23; `dashboard/colonyFigures.ts` S5, A6; `routes/cats.ts` care timeline A3; `teamCorrections.ts` S16, S17, S18, C46–C53; `welfareTie.ts` C62; `teamOnlyPhotos.ts` C54; `vet_batch_cats` readers C55, C57, S21, A8; the claim waits S2, S3.
- **Item 4 (missed by the first list):** `colourCheck.ts` C17; `guardianCatView.ts` C22; `publicCat.ts` C33; `teamCatView.ts` C40–C43, S13, S14; `recentGuardianChanges.ts` C34, B7; `vetBatchRoutes.ts` C55; `teamVetBatches.ts` C86; `routes/reports.ts` C80; `routes/issues.ts` C77, A7; `routes/notifications.ts` C78, C79; `commitStatement.ts` C18, A5; `mail/outbox.ts` C27, C28; `likelyReview.ts` C26, S7; `teamAuth/heldTyping.ts` (by statement id only: §3.2's "not cat-keyed" list); `observations.ts` C32, S9–S12; `weekBoard.ts` C59; `sightingRoundUp.ts` C37; `badges/award.ts` C1–C3; `issues/queue.ts` C25; `routes/sightings.ts` ear-tip state S23–S25.

**Readers this sweep found that no plan list names:** `badges/backfill.ts` C4, `badges/stats.ts` C5, `catHelpers.ts` `getProfileStats` C9 and `profilePayload` C11 and the legacy `desexed` fallback A4, `catNames.ts` C12, `claiming.ts` `claimEligibility` C13 and `newestActiveOwnerHomed` S1, `coatReading/due.ts` C14, `capabilityTargets.ts` C6/B9/A2, `guardianStatements.ts` C24, `welfareQueue.ts` C60/C61, `teamCatList.ts` `loadTeamCats` C38 and `catTrail` C39, `routes/teamNews.ts` C85, `routes/cats.ts` name suggestions, claim, let-go, follow, name and `PATCH` (C64–C76) and the first-claim count S22, `routes/sightings.ts` `storedAnswer` C82, resolve C83/C84, `scripts/smokeCheck.ts` C63, `lib/db/src/photoRemoval/*` C87–C91, `observations.ts` `checkVisitLink` S9 and the retraction check S10, `teamCorrections.ts` `colonyAfterMarkingWrong` S16 and `lockActiveObservation` S17, `vetVisits.ts` `undoVetVisit` S19 and the batch same-day check S21, `dashboard/colonyFigures.ts` `kittensTiedToCats` A6, `dashboard/home.ts` `vetSpend` B8.

---

## 7. Risks and ambiguous readers

- **R1 (real gap, PR 1.1 left it): colour and markings leak through a merge.** `loadCatRecords` (S11) calls `catsFeeding` without `excludeKinds`, so a merged-in cat's `coat` and `markings` rows reach `resolveCoatParts` / `resolveMarkings` (`teamCatView.ts:919-920`, `teamCorrections.ts:645-646`, `resolve.ts:1645,1663`, `colourCheck.ts:120-121`). Spec §4.2 says they are the survivor's own. Fix in this PR: `excludeKinds: ['coat','markings']` in `loadCatRecords` and filter each target's rows with `f.counts`. Test: merge two cats with different coats; the survivor's coat is its own; undo; unchanged. Mutation probe: drop `excludeKinds`, and it goes red.
- **R2: the statements guard can't see §3.2's readers** (by colony, kind or role, grouped in TypeScript). Five of them move. Each needs spec test 15. A future reader of the same shape will also be invisible; the guard's comment should say so.
- **R3: `currentColonyOf` (S4/B2) is a hub.** `loadTeamCats`, `catsByColony`, `catsInColony`, the trapping plan, colony figures and the guardian views all read it. Moving it changes every colony figure at once (behaviour-neutral today, because there are no merges). Its test should cover the island-wide path (no `catIds`) as well as the by-id path.
- **R4: searches drop Mimi before "also known as" exists.** `searchTeamCats` (C43) and `searchCatsToAdd` (C16) on `liveCats` hide a merged-away cat until PR 4.1 adds "Mimi (now part of Agatha)". Harmless before PR 4.1 (no merges), but PR 4.1 must not ship without it.
- **R5: a same-cat check the plan doesn't list.** `checkVisitLink` (`observations.ts:875`, `visit.catId !== input.catId`) refuses a statement on Agatha linked to a visit on Mimi. Plan PR 3.1 item 3 names only the two `TODO(SYC-59)` checks (`observations.ts:1160,1167`). Add this one to PR 3.1's canonical comparisons.
- **R6 (ambiguous): `teamOnlyPhotoIds` (C54).** It's allowlisted so a merged-away cat's main photo stays public as it was. The other reading is that it should only exempt live cats' main photos. That would quietly turn a public vet photo team-only on merge. The spec is silent; I chose "nothing is un-published by a merge".
- **R7 (minor): `isFirstCatInArea` (C1–C3)** counts a merged-away duplicate as an earlier cat in the area, which can deny a later "first in area" badge. It's allowlisted as credit. The alternative, `notMergedAway` there, changes who can earn the badge after a merge. That's a points question for Samuel, not something to decide in this PR.
- **R8: `teamVetBatches` confirm (C86)** accepts a typed id of a merged-away cat, so a vet visit would be written on Mimi. It still counts for Agatha through `catsFeeding`, but PR 4.1's "team correction routes act on the survivor" should cover this route too. PR 2.1's trigger guards only sightings.
- **R9 (ambiguous): `colonyAfterMarkingWrong` (S16)** is a write path whose read decides a value. I ruled `catsFeeding` (resolve the canonical cat first) so the restored colony matches what the page shows. A builder who reads "write path" as "allowlist" would leave a merged cat's colony restored from one record only.
- **R10 (judgement calls, low stakes):** the batch same-day visit check (S21) and the "first claim" announcement count (S22) are ruled `catsFeeding` because they're about the animal. Either could reasonably stay on the raw id.
- **R11 (names that stay taken):** C12, C58, C64 and C75 deliberately keep merged-away names, so "Mimi" stays taken (§4.2). PR 4.1's name-taken prompt must then name the survivor, not Mimi.
