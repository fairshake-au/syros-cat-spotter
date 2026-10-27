# Editable starter facts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Commit after each task (and after each green step inside a long task). Never hold work only in memory.** Write a one-line checkpoint to `docs/superpowers/plans/2026-10-26-editable-starter-facts.progress.md` after each commit (what's done, what's next).

**Goal:** The team can edit, add and delete starter facts on the App switches page, and phones show the server's facts in the reader's language with English fallback.

**Architecture:** A new `starter_facts` table holds the words, shown state and a version number. The api-server reads and writes it under the existing advisory lock, keeps the old `app_settings.starter_facts_hidden` row in step for older phones and rollback, and adds an optional `facts` list to `GET /api/app-settings`. The app keeps its built-in twenty as the never-loaded fallback and otherwise picks from the saved `facts`. Word counting and text cleaning live in one new shared workspace package used by both sides.

**Tech Stack:** Postgres + Drizzle (migrations in `lib/db/migrations`), Express + server-rendered HTML team pages, Expo/React Native app, orval codegen from `lib/api-spec/openapi.yaml`, vitest.

**Spec:** [`docs/specs/editable-starter-facts.md`](../../specs/editable-starter-facts.md) (approved by Samuel, 26 Oct 2026). Ticket SYC-754.

**One deviation from the spec:** §5 puts the shared word count "in `lib/db`". The app can't import `@workspace/db` (it's server-only), so it goes in a new small package, `@workspace/fact-words`, that both sides import. Same intent: one copy.

**Two PRs, both opened as drafts (`gh pr create --draft`):**
- **PR 1, server (Tasks 1–6).** Safe alone: older phones see no change. Its migration goes to production **before** Samuel republishes (memory: migrate before republish).
- **PR 2, app (Tasks 7–9).** Stacked on PR 1; stays a draft until PR 1 merges.

## Global Constraints

- Facts: **35 words or fewer** per language, **400 characters** max per box (characters, not bytes). English required; Greek (`el`) and French (`fr`) optional, stored as `null` when empty, never `""`.
- Word rule (`starter-facts.md` §3.3): a piece between whitespace or NBSP (U+00A0) counts if it contains a letter or digit (`/[\p{L}\p{N}]/u`).
- New ids: `fact.new.` + 8 letters from `"bcdfghjkmpqrvwxz"` (project rule: letters only, never hex or `Date.now()`); retry on clash.
- `hiddenFacts` on the wire = the original twenty (`STARTER_FACT_IDS`, in that order) minus those that exist **and** are shown.
- Missing `facts` field = phone keeps what it had. `facts: []` = nothing shown. The server omits `facts` when it can't read the table.
- Default when `starter_facts_hidden` is missing or misshapen: the nine `SIGN_OFF_FACT_IDS` hidden.
- Lock: `pg_advisory_xact_lock(hashtext('app_switches.starter_facts'))` for every fact write.
- Permission: `edit_app_switches` on every new route.
- Copy is exactly as in the spec §2 and §5 (quoted strings below are verbatim from it).
- Terminology: "cat guardian", "spotter"; sterilisation €50–60. Plain words in all copy.
- Test cat names / tags: letters only (CLAUDE.md, SYC-709).

## Review Focus

1. **A server read failure must not blank phones.** If the `starter_facts` query throws, `/api/app-settings` omits `facts` and still sends `hiddenFacts` from the legacy row. Test in Task 4.
2. **Deleted original = hidden for old phones, and rollback state stays right.** After delete of `fact.milk`, the `starter_facts_hidden` row includes `fact.milk`. Test in Task 3, mutation-probed.
3. **Stale edit over a delete or a show/hide.** Edit page opened at version 3; someone hides it (version 4); save is refused with the "Someone changed…" copy. Test in Task 3 and Task 5.
4. **Fact text with HTML or quotes** (`<script>`, `"`, `&`) round-trips through the edit page escaped in textareas and the list. Test in Task 5.
5. **A phone with only the old saved copy and an answer with no `facts`** keeps built-in words and its hidden list. Test in Task 7.

---

## File map

| File | Responsibility |
|---|---|
| `lib/fact-words/` (new package `@workspace/fact-words`) | `wordCount`, `cleanFactText`, `factTextProblem`, limits. Shared by api-server and app. |
| `lib/db/src/schema/starterFacts.ts` (new) + `schema/index.ts` | Drizzle table `starterFactsTable`. |
| `lib/db/migrations/0053_starter_facts.sql` + `meta/` | Create + seed + rollback. |
| `lib/db/src/appSettings/shape.ts`, `cli.ts` | db-ops refuses `starter_facts_hidden`. |
| `artifacts/api-server/src/lib/starterFacts.ts` (new) | All fact reads/writes, legacy-row sync. |
| `artifacts/api-server/src/lib/appSwitches.ts` | `setFactShown` and fact bits move out; donation stays. |
| `artifacts/api-server/src/lib/appSettings.ts`, `routes/appSettings.ts` | `facts` on the wire. |
| `artifacts/api-server/src/lib/teamPages/appSwitchesPage.ts`, new `factEditPage.ts` | List, edit/add form, delete confirm, English-changed confirm. |
| `artifacts/api-server/src/routes/teamAppSwitches.ts` | New routes. |
| `artifacts/api-server/src/lib/teamPages/appSwitchFacts.ts` + test | Deleted. |
| `lib/api-spec/openapi.yaml` + generated `api-zod`, `api-client-react` | Optional `facts`. |
| `artifacts/cat-spotter/lib/appSettings.ts`, `lib/starterFacts.ts`, `lib/waitingCard.ts`, `components/WaitingCard.tsx`, the screen that renders it | Phone side. |

---

## PR 1 — server

### Task 1: Shared fact-words package

**Files:**
- Create: `lib/fact-words/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts` (copy the shape of `lib/welfare-guidance`)
- Modify: `artifacts/api-server/package.json`, `artifacts/cat-spotter/package.json` (add `"@workspace/fact-words": "workspace:*"`), `artifacts/cat-spotter/lib/starterFacts.ts` (re-export `wordCount`, `MAX_FACT_WORDS` from the package and delete its own copies), root tsconfig references if libs are listed there, then `pnpm install`.

**Interfaces — Produces:**
- `MAX_FACT_WORDS = 35`, `MAX_FACT_CHARS = 400`
- `wordCount(text: string): number`
- `cleanFactText(raw: string): string` — trims; turns `\r\n`, `\n`, `\r` into one space; removes all C0/C1 control characters and the bidi controls U+202A–U+202E, U+2066–U+2069; collapses nothing else.
- `type FactLang = "en" | "el" | "fr"`
- `factTextProblem(lang: FactLang, cleaned: string): string | null` — returns the spec §5 copy: empty English → `"Write the fact in English. Greek and French are optional."`; over 400 chars → `"That's too long for a fact."`; over 35 words → `` `The ${name} is ${n} words. Facts must be 35 words or fewer so people can read them during the wait.` `` with name `English` / `Greek` / `French`. Empty `el`/`fr` → `null`.

- [ ] **Step 1: Write failing tests** in `src/index.test.ts`:
  - `wordCount("Pourquoi ?")` → 1; `wordCount("l’oignon")` → 1; `wordCount("“Can’t tell” is a good answer.")` → 6; `wordCount("€50–60 per cat")` → 3; `wordCount("a — b")` → 2; `wordCount("chat ")` → 1.
  - Every English, Greek and French starter fact in `artifacts/cat-spotter/lib/i18n.ts` gives the same count as the app's old function did (move the existing `starterFacts.test.ts` ≤35 assertion here or keep it calling the re-export).
  - `cleanFactText("  a\nb‮ ")` → `"a b"`.
  - `factTextProblem("en", "")` → the English message; `factTextProblem("el", "")` → `null`; a 36-word Greek string → message containing `"The Greek is 36 words."`; a 401-char string → `"That's too long for a fact."`.
- [ ] **Step 2:** Run `pnpm --filter @workspace/fact-words exec vitest run` → FAIL (module missing). (If esbuild fails locally, use the `ESBUILD_BINARY_PATH` workaround from memory `local-vitest-esbuild`.)
- [ ] **Step 3:** Implement. Move the body of `wordCount` from `cat-spotter/lib/starterFacts.ts` verbatim.
- [ ] **Step 4:** Run the package tests and `pnpm --filter @workspace/cat-spotter exec vitest run lib/__tests__/starterFacts.test.ts` → PASS. `pnpm -w run typecheck` → clean.
- [ ] **Step 5:** Commit `SYC-754: shared fact word count and text checks`.

### Task 2: Table and migration

**Files:**
- Create: `lib/db/src/schema/starterFacts.ts`; export from `lib/db/src/schema/index.ts` and `lib/db/src/index.ts`.
- Create via generate: `lib/db/migrations/0053_starter_facts.sql`, `meta/` entries.
- Create: `artifacts/api-server/src/lib/starterFactsSeed.test.ts`.

**Interfaces — Produces:** `starterFactsTable` with columns:
`id text pk`, `en text not null`, `el text null`, `fr text null`, `shown boolean not null`, `position integer not null`, `photo boolean not null default false`, `version integer not null default 1`, `addCode text null unique` (`add_code`), `updatedAt timestamptz not null default now()`.
Checks: `en <> ''`, `el is null or el <> ''`, `fr is null or fr <> ''`, `version > 0`.

- [ ] **Step 1:** Write the schema file, then `pnpm --filter @workspace/db run generate --name starter_facts`.
- [ ] **Step 2:** Append the seed to the generated SQL (hand-written, below the CREATE). Twenty `INSERT`s with words copied from `i18n.ts` (`en`, `el`, `fr` blocks), `position` 1–20 in `STARTER_FACT_IDS` order, `photo = true` only for `fact.earTip`. Escape `'` as `''`; curly quotes and NBSPs go in literally. Then set `shown`:

```sql
UPDATE "starter_facts" f SET "shown" = NOT (f."id" = ANY (
  COALESCE(
    (SELECT ARRAY(SELECT jsonb_array_elements_text(s."value"))
       FROM "app_settings" s
      WHERE s."key" = 'starter_facts_hidden' AND jsonb_typeof(s."value") = 'array'),
    ARRAY['fact.earTip','fact.disease','fact.backHome','fact.vacuum','fact.cost','fact.leftovers','fact.water','fact.kittensAlone','fact.colonyFemales']
  )));
```
(Seed inserts use `shown = true`, then this update runs. Check `app_settings.value` is `jsonb`; adjust if it's `json`.)
Rollback block, every line prefixed `-- ` (notes inside use `-- --`, memory `rollback-block-comments`): `-- DROP TABLE "starter_facts";`
- [ ] **Step 3: Write the failing seed test** `starterFactsSeed.test.ts`: after migrate, for every id in `STARTER_FACT_IDS`, the row's `en`/`el`/`fr` equal the `i18n.ts` values (read `i18n.ts` as text, as `teamPages/appSwitchFacts.test.ts` does today: each id appears three times, in the order en, el, fr; take all three matches with a global regex and unescape `\'` and `\"`); positions are 1–20; only `fact.earTip` has `photo`. Plus: with no `starter_facts_hidden` row, exactly the nine sign-off ids are `shown = false` (run the UPDATE statement against a scratch transaction).
- [ ] **Step 4:** `pnpm --filter @workspace/db run migrate`, `pnpm --filter @workspace/db test` (runner + rollback), `migrate:check`, then the seed test → PASS.
- [ ] **Step 5:** Commit `SYC-754: starter_facts table, seeded from the app's words`.

### Task 3: Server fact store (reads, writes, legacy sync)

**Files:**
- Create: `artifacts/api-server/src/lib/starterFacts.ts`, `starterFacts.test.ts`
- Modify: `artifacts/api-server/src/lib/appSwitches.ts` (delete `setFactShown`, `FACTS_KEY`, `KNOWN`; `switchesNow` returns only `donateUrl`), server startup file (call `syncShownFromLegacy()` once after DB is reachable; find where other startup jobs run, e.g. `src/index.ts`).

**Interfaces — Produces:**
```ts
export interface StoredFact { id: string; en: string; el: string | null; fr: string | null; shown: boolean; position: number; photo: boolean; version: number }
export interface FactWordsInput { en: string; el: string; fr: string }   // raw form values
export class FactRefused extends Error { constructor(public kind: "bad_words" | "changed" | "gone", message: string, public field?: "en" | "el" | "fr") }
export async function listFacts(): Promise<StoredFact[]>                    // position order; throws on DB error
export async function getFact(id: string): Promise<StoredFact | null>
export async function setFactShown(id: string, shown: boolean): Promise<void>   // FactRefused("gone") if no row
export async function editFact(id: string, words: FactWordsInput, version: number): Promise<StoredFact>
export async function addFact(words: FactWordsInput, addCode: string): Promise<StoredFact> // same addCode twice → returns the first row, no new row
export async function deleteFact(id: string): Promise<void>                 // no-op if already gone
export function legacyHiddenList(rows: Pick<StoredFact, "id" | "shown">[]): string[]  // STARTER_FACT_IDS order
export async function syncShownFromLegacy(): Promise<void>
export function newFactId(random: () => number): string   // "fact.new." + 8 letters
```
Rules:
- Every write: one transaction, the advisory lock first, then the change, then `version = version + 1, updated_at = now()` on the touched row, then upsert `app_settings.starter_facts_hidden = legacyHiddenList(all rows)` (same `put` as `appSwitches.ts`), then `clearAppSettingsCache()` after commit.
- `editFact`/`addFact`: run `cleanFactText` then `factTextProblem` on each language; first problem → `FactRefused("bad_words", msg, lang)`. Empty `el`/`fr` stored as `null`. `editFact` refuses `gone` if no row, `changed` if `version` differs. Edit never touches `photo` or `shown`.
- `addFact`: `position = max + 1`, `shown = true`, `photo = false`; `INSERT … ON CONFLICT (add_code) DO NOTHING`, then select by `add_code`. Retry `newFactId` on id clash (max 5).
- `syncShownFromLegacy`: under the lock, if the legacy row exists, is an array, and its `updated_at` is **strictly later** than `max(starter_facts.updated_at)`, set `shown` on the original twenty from it (and bump their version). Otherwise nothing.

- [ ] **Step 1: Write failing tests** (real DB, as the other api-server lib tests do):
  - `listFacts` returns 20 seeded rows in order.
  - `editFact` happy path: words change, version +1, `photo` on earTip still true.
  - `editFact` with stale version → `FactRefused` kind `changed`; after `setFactShown` bumped it → `changed`; after `deleteFact` → `gone`.
  - `editFact` with 36-word Greek → `bad_words`, field `el`; nothing changed.
  - `editFact` with `el: "   "` stores `null`.
  - `addFact` twice with the same code → one new row; id matches `/^fact\.new\.[bcdfghjkmpqrvwxz]{8}$/`; position 21; shown.
  - `deleteFact("fact.milk")` → row gone and `app_settings.starter_facts_hidden` contains `"fact.milk"`.
  - `legacyHiddenList` ignores `fact.new.*` ids and lists missing originals.
  - `syncShownFromLegacy`: write the legacy row with `updated_at` later than the table → shown re-copied; with equal `updated_at` (written by our own transaction) → nothing changes.
  - Two concurrent `setFactShown` on different ids → both stick (`Promise.all`).
- [ ] **Step 2:** Run `pnpm --filter @workspace/api-server exec vitest run src/lib/starterFacts.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS. **Mutation probe** (commit first, memory `commit-before-probes`): (a) make `legacyHiddenList` skip missing ids → the delete test must go red; (b) drop the version check in `editFact` → the stale test must go red; restore with `git checkout` and re-run green.
- [ ] **Step 5:** Commit `SYC-754: fact store with versioned edits and the old hidden list kept in step`.

### Task 4: `facts` on the app-settings answer

**Files:**
- Modify: `artifacts/api-server/src/lib/appSettings.ts` (add `facts: WireFact[] | null` to `AppSettings`; read the table in the same cached load; on any table error log a warning and set `null`; `hiddenFacts` keeps coming from the legacy row as now), `routes/appSettings.ts` (send `facts` only when not null), `lib/api-spec/openapi.yaml` (`AppSettings.facts`, optional, array of `WireFact { id, en, el?, fr?, photo }`), then `pnpm --filter @workspace/api-spec run codegen`.
- Test: `routes/appSettings.test.ts`, `lib/appSettings.test.ts`.

**Interfaces — Produces:** `interface WireFact { id: string; en: string; el?: string; fr?: string; photo: boolean }` (shown facts only, position order; `el`/`fr` omitted when null). Generated client type `AppSettings` gains `facts?: WireFact[]`.

- [ ] **Step 1: Write failing tests:** key list becomes `["extraPhotos", "facts", "feedNudge", "hiddenFacts"]`; hiding a fact removes it from `facts` and adds it to `hiddenFacts`; a fact with no Greek has no `el` key; **table unreadable** (mock the facts query to throw, or `vi.spyOn` the reader) → body has no `facts` key and `hiddenFacts` still present. Update the existing `hiddenFacts` assertions at lines ~101, 134, 154, 157 to write through `setFactShown` instead of the raw row.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement + codegen. **Step 4:** Run → PASS; mutation probe: make the catch return `[]` instead of `null` → the unreadable test must go red; restore.
- [ ] **Step 5:** Commit `SYC-754: app-settings sends the shown facts`.

### Task 5: Team page — list, edit, add, delete

**Files:**
- Modify: `artifacts/api-server/src/lib/teamPages/appSwitchesPage.ts` (list from `StoredFact[]`; per row: Show/Hide form, **Edit** link `GET /api/team/app-switches/fact/edit?id=…`, **Delete** link `GET …/fact/delete?id=…`; language note; **Add a fact** link at the end; `hint` count uses the rows). `APP_SWITCHES_DONE` gains `edited: "That fact is saved. Phones get it the next time the app is opened."`, `added: "The new fact is in the app."`, `deleted: "That fact is deleted."`.
- Create: `artifacts/api-server/src/lib/teamPages/factEditPage.ts` with `renderFactEditPage(o)`, `renderFactDeletePage(o)`, `renderEnglishChangedPage(o)`.
- Modify: `routes/teamAppSwitches.ts` — routes below; GET JSON adds `facts: StoredFact[]`, drops nothing.
- Delete: `teamPages/appSwitchFacts.ts`, `appSwitchFacts.test.ts`.
- Test: `routes/team.appSwitches.test.ts`, `routes/team.walk.test.ts` (new entries with reasons, like the existing three).

Routes (all `edit_app_switches`; POSTs via `...formRoute("edit_app_switches")`):
| Route | Does |
|---|---|
| `GET /team/app-switches/fact/edit?id=` | Edit form, prefilled, hidden `version`. Unknown id → list with 404. |
| `GET /team/app-switches/fact/add` | Empty form with hidden `addCode` (`newFactId`-style 16 letters). |
| `POST /team/app-switches/fact/edit` | Body `id, version, en, el, fr, confirm?`. If English differs from stored and a non-empty `el`/`fr` is unchanged and `confirm !== "1"` → `renderEnglishChangedPage` (copy: *"You changed the English. Check the Greek and French still say the same thing, or empty them so readers see the new English."*, buttons **Save anyway** / **Go back**, carrying the typed values). Else `editFact`. `bad_words` → 400 form with message by the box and typed text kept. `changed` → 409 form with current words and *"Someone changed this fact while you were editing. Here it is now; make your change again."* `gone` → 410 page *"Someone deleted this fact while you were editing. Your words weren't saved."* plus what was typed. Success → 303 `?done=edited#id`. |
| `POST /team/app-switches/fact/add` | Body `addCode, en, el, fr` → `addFact` → 303 `?done=added#id`. |
| `GET /team/app-switches/fact/delete?id=` | Confirm page via existing `renderConfirmPage`: the fact's words and *"Delete this fact? This can't be undone. To stop it appearing for now, hide it instead."*, **Delete it** / **Keep it**. |
| `POST /team/app-switches/fact/delete` | Body `id, confirm=1` → `deleteFact` → 303 `?done=deleted`. |

Edit form details: three `<textarea>`s labelled **English**, **Greek**, **French**; hint under each *"N of 35 words"* (server-computed from current text); for `photo` facts show the ear-tip photo and *"The app shows this photo above the words."*; for ids in `STARTER_FACT_IDS`, beside **Save**: *"Phones not yet updated keep showing the old words. If the old words are wrong, hide the fact for now."* Language note on the list: none if all three; otherwise e.g. *"English and Greek. French readers see the English."* / *"English only. Greek and French readers see the English."* All text through `esc`.

- [ ] **Step 1: Write failing route tests:** edit happy path (303, words changed); stale version → 409 with the "Someone changed" copy; deleted → 410 copy; 36-word French → 400 with "The French is 36 words." and typed text kept; English changed with Greek untouched → English-changed page, then `confirm=1` saves; add twice same code → one fact; delete GET shows the confirm copy, POST removes it; guardian gets 403 on every new route; **XSS:** edit with `en = '<script>x</script> & "q"'` → list and edit form contain `&lt;script&gt;` and no raw `<script>x`; JSON GET has `facts`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run this file plus `team.walk.test.ts`, `team.settings.test.ts`, `team.home.test.ts` → PASS.
- [ ] **Step 5:** Screenshot the list, edit form (with an error), English-changed page and delete confirm at 390px and desktop (memory `dashboard-preview-cookie-host` for the local session cookie). Save under `docs/screenshots/syc-754/`.
- [ ] **Step 6:** Commit `SYC-754: edit, add and delete facts on the App switches page`.

### Task 6: db-ops refuses the old key; PR 1 wrap

**Files:** `lib/db/src/appSettings/shape.ts` (`settingWriteProblem("starter_facts_hidden", …)` → `"Facts are changed on the App switches page now."`), `lib/db/src/appSettings/dbOps.settings.test.ts`, `.github/workflows/db-ops.yml` (remove `starter_facts_hidden` from the options list on line ~69/75). Keep the key in `SETTING_KEYS` (the reader still uses it).

- [ ] **Step 1:** Failing test: `settingWriteProblem("starter_facts_hidden", [])` returns that message. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Full api-server suite (memory `welfare-kind-guard-allowlist`: run it all before ready) and `pnpm --filter @workspace/db test`. Commit `SYC-754: db-ops no longer writes the hidden-facts list`.
- [ ] **Step 6:** Push, `gh pr create --draft` with the rollout note: *migration 0053 to production before republish; old phones unaffected.*

---

## PR 2 — app (branch stacked on PR 1)

### Task 7: Phone saves the facts

**Files:** `artifacts/cat-spotter/lib/appSettings.ts`, `lib/waitingCard.ts` (`SettingsView`), `lib/__tests__/appSettings.test.ts`, `context/__tests__/AppSettingsContext.test.tsx`.

**Interfaces — Produces:**
```ts
export interface PhoneFact { id: string; en: string; el: string | null; fr: string | null; photo: boolean }
// SettingsView gains:
facts: readonly PhoneFact[] | null   // null = use the built-in twenty with hiddenFacts
```
- `settingsFromResponse(res, prev: SettingsView)`: if `res.facts` is an array → cleaned list (drop entries without string `id`/non-empty `en`; `""` el/fr → `null`); if missing → `prev.facts` (keep). Callers pass the previous settings.
- `parseStoredSettings`: a stored copy without `facts` → `facts: null`. Same storage key `catSpotters.appSettings.v1`.
- `emptySettingsState().settings.facts = null`.

- [ ] **Step 1: Failing tests:** response with `facts: []` → `facts: []`; response without `facts` after a previous `facts` list → previous kept; old stored copy (no `facts`) → `facts: null`, hiddenFacts kept; `el: ""` → `null`.
- [ ] **Steps 2–4:** FAIL → implement (update the `refresh` call in `AppSettingsContext.tsx` to pass `prev.settings`) → PASS.
- [ ] **Step 5:** Commit `SYC-754: the app keeps the server's facts`.

### Task 8: Waiting-card schedule uses the saved facts

**Files:** `lib/waitingCard.ts`, `lib/starterFacts.ts`, `lib/__tests__/waitingCard.test.ts`.

**Interfaces:**
- `starterFacts.ts`: `builtInFacts(): PhoneFact[]` — the twenty from `STARTER_FACTS` + `TRANSLATIONS.en/el/fr[id]` (so `t()` is no longer needed for fact words).
- `waitingCard.ts`: `factsInUse(settings: SettingsView): PhoneFact[]` — `settings.loaded && settings.facts ? settings.facts : builtInFacts().filter(not in hidden list when loaded)`. `visibleFacts(settings)` returns `factsInUse(settings).map(f => f.id)`. Fixed start unchanged (`EAR_TIP_FACT`, `MILK_FACT`, only if in visible).
- When saving a record (`settleWait` and wherever `chooseForWait` returns a record), trim `seenFacts` and `everSeen` to ids in `visible` **plus** the built-in ids (so a phone that falls back briefly doesn't forget them); `lastFactId` left as is.

- [ ] **Step 1: Failing tests:** with `facts` lacking `fact.earTip` a new phone's first fact wait goes straight to shuffle; a new id appears in `order` at some position and is eligible this round; an edited fact (same id) already in `seenFacts` isn't shown again this round; `facts: []` → `{ kind: 'empty' }`; never-loaded settings → the twenty built-ins; seen lists don't keep an id that's in neither `facts` nor the built-ins.
- [ ] **Steps 2–4:** FAIL → implement → PASS (also the existing waitingCard tests).
- [ ] **Step 5:** Commit `SYC-754: the waiting card picks from the server's facts`.

### Task 9: Card shows words by language, photo by flag

**Files:** `components/WaitingCard.tsx`, its caller (find with `git grep -n "<WaitingCard"`), `components/__tests__/WaitingCard.test.tsx`.

**Interfaces:** `WaitingCardProps` gains `fact?: PhoneFact` and `language: Language`. Caller looks up the fact by `choice.id` in `factsInUse(settings)`. Words: `fact[language] ?? fact.en` (treat `""` as missing). Photo shown when `fact.photo` (not by id). Text via RN `Text` only.

- [ ] **Step 1: Failing tests:** Greek reader + fact with `el` → Greek words; French reader + fact with `fr: null` → English words; `photo: true` on a `fact.new.*` id → photo shown; `fact.earTip` with `photo: false` → no photo; text `<b>x</b>` renders literally.
- [ ] **Steps 2–4:** FAIL → implement → PASS. Run the whole app suite.
- [ ] **Step 5:** Web preview check (memory `web-offline-simulation` not needed): run the app's web build locally against the PR 1 server, edit a fact on the team page, reload the app, send a sighting, see the new words on the card. Screenshot at 390px.
- [ ] **Step 6:** Commit, push, `gh pr create --draft` (base = PR 1's branch).

---

## After both PRs (by the session, not a subagent)

- Independent adversarial review of each PR (separate worktree per reviewer, LIF-79) before `gh pr ready`.
- Ship order: PR 1 merge → migration 0053 to production → Samuel republishes → probe `/api/app-settings` on the live build shows `facts` (memory `confirm-live-build-before-smoke`) → PR 2 retarget to main, ready, merge → app release.
- File the follow-up ticket (spec §6 step 4): *count app versions in the app-settings request, then retire `hiddenFacts` below a set share.*

## Model delegation

Session model: Opus.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Task 1 shared package | Sonnet | Clear spec, moves an existing function | Package tests over all 60 existing fact strings; typecheck; session spot-review of diff |
| Task 2 table + seed migration | Sonnet | Mechanical SQL + seed, but copied words must be exact | Seed-equals-i18n test (character for character); `migrate:check`; rollback test; session spot-review of the SQL |
| Task 3 fact store | **Opus** | Escalated: transactions, lock, version clash, dual-write and the startup re-sync are silent-failure guards with subtle ordering | Tests + **two mutation probes** (Step 4); adversarial review at PR stage |
| Task 4 app-settings `facts` + codegen | Sonnet | Small, well specified | Tests + **mutation probe** on missing-vs-empty; session spot-review |
| Task 5 team page + routes | Sonnet | Standard server HTML pattern exists to copy | Route tests incl. XSS and 403s; screenshots at 390px/desktop reviewed by session |
| Task 6 db-ops refusal | Haiku | One-line rule + test + yml edit | Unit test; full api-server + db suites run by session |
| Tasks 7–8 phone settings + schedule | Sonnet | Pure functions with existing test patterns | Tests incl. missing-vs-empty and old stored copy; session re-runs the named files (memory `rerun-delegated-tests`) |
| Task 9 card + web probe | Sonnet | Small component change | Component tests; end-to-end web probe with screenshot |
| PR adversarial reviews | Opus | Equal-tier critic; Fable not needed for a two-PR feature of this size | Findings folded in before `gh pr ready` |
| Ship sequencing, live probe | Session (Opus) | Production ordering and judgment | `/api/healthz` commit match, then `/api/app-settings` probe |

Every subagent prompt restates: work only in its assigned worktree, commit after each task, write the progress checkpoint, never sub-delegate.
