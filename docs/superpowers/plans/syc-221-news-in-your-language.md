# Plan: cat news in your language (SYC-221)

**Spec:** `docs/specs/news-in-your-language.md`, approved by Samuel on 1 Nov 2026 ("Approve, all A")
**Status:** approved by Samuel, 1 Nov 2026 ("Approve the plan")
**Owner:** the Notifications lane (SYC-612). It owns the translation files and migrations for this wave.

## Shape: three stacked PRs

Each is a draft until the one below it merges (CLAUDE.md stacked-PR rule).

| PR | What it does | Goes live when | Needs an app build? |
|---|---|---|---|
| **1. Server words** | Every push is worded in the phone's language. | Samuel republishes | no |
| **2. Migration** | Adds `cat_updates.wording` and `wording_day`. Every new piece of cat news fills them in. | migrate, then republish | no |
| **3. The bell** | The API returns the label and the day; the app words each bell line itself. | next app build | yes |

PR 1 helps Greek and French spotters straight away. PRs 2 and 3 don't hold it up.

## PR 1: server words (no migration)

**New file:** `artifacts/api-server/src/lib/newsWords.ts`
- `type NewsLanguage = "en" | "el" | "fr"`, and `languageOf(raw: string | null): NewsLanguage`. Anything unknown becomes `"en"`.
- One table per kind, taken from spec §3.4: `sterilised`, `spotted_again`, `seen_weekday`, `seen_date`, `new_cat`, `home`, `rename`, `home_details`, the round-up title, and the 1, 2 and 3+ cat lines.
- Monday's weekly copy moves here from `weeklyClose.ts`: `WEEK_COPY`, `rankWord` and `PushLanguage`, which becomes an alias of `NewsLanguage`. `weeklyClose.ts` imports them.
- Day words: weekday and month names come from fixed per-language lists, in the grammatical case each sentence needs. They don't come from raw `Intl` output. The Syros day is worked out as `sightingMessage.ts` does today.
- `newsText(kind, lang, params) → { title, body }`.

**Every push path reads the language.** This list is the full set of consumers. The plan's checker greps `sendPushNotification(` to prove none is missed.

| File | Change |
|---|---|
| `lib/notifications.ts` (`notifyDevices`, `notifyCatFollowers`) | `CatNotification` becomes `{ kind, params, data }`. The token select adds `language`, and the text is worded per token. |
| `lib/notificationFanout.ts` (`fanOutNotifications`) | `language` is added to the token select. The push body comes from `newsText`, using a label passed in memory: `insertCatUpdate` and `createUpdateAndFanOut` accept `wording` and `wordingDay` and pass them through (PR 2 also stores them). With no label (staff text), the stored message is pushed as today. |
| `lib/sightingRoundUp.ts` | The SQL selects `pt.language`, `Planned` carries it, and `roundUpText(names, lang)`. |
| `lib/weeklyClose.ts` | Imports from `newsWords.ts`. Its behaviour is unchanged. |
| `routes/cats.ts` (claim, rename, home details) | Passes a kind and names to `notifyCatFollowers`. |
| `routes/sightings.ts` (resolve) | Passes `new_cat`, `spotted_again`, `seen_weekday` or `seen_date`, plus the Syros day. `sightingMessage.ts` returns `{ wording, day, message }`, and the English message stays exactly as today. |
| `lib/commitStatement.ts` | Passes `sterilised`. |
| `routes/notifications.ts` (staff route) | No label: typed text, Decision 2A. |

**Tests (vitest, api-server):**
- `newsWords.test.ts`: every kind × every language is present and non-empty. Unknown or null languages give English. No line contains any name from the place list (reuse the existing place-name guard). Weekday and date in each language come from Athens-helper fixtures, including 00:30 Athens, the 24-hour edge and the 25 Oct 2026 clock change. No wall clock is used.
- Each sender gets a test that a Greek-registered phone receives the Greek words, a French one French, and a null one English. The Expo call is stubbed (the existing tests already stub `fetch`).
- Test cat names come from `nameTag` (letters only).

## PR 2: migration

- Schema: `cat_updates.wording text` (nullable) and `cat_updates.wording_day date` (nullable), plus a check that `wording_day` is set only for `seen_weekday` and `seen_date`.
- Generate on fresh `origin/main` (`pnpm --filter @workspace/db run generate --name cat_update_wording`), with a commented rollback that drops both columns.
- If another lane's migration merges first, delete this one and regenerate (`lib/db/migrations/README.md`). Before generating, ask the coordinator whether any other lane has a migration in flight.
- `insertCatUpdate` stores the label and day it already receives from PR 1. No backfill (Decision 3A).
- Tests: `pnpm --filter @workspace/db test` (the rollback restores the schema), `migrate:check`, the `lib/db` runner test, the switchover fingerprint test, and one api-server test per writer showing the label and day are stored, and that staff text stays unlabelled.
- **Production order:** the migration runs on production before Samuel republishes. Old code ignores the new nullable columns, so migrating early is safe (memory: migrate before republish).

## PR 3: the bell

- `lib/api-spec/openapi.yaml` `AppNotification` gets `wording` (an enum, nullable) and `wordingDay` (a date string, nullable). Then run codegen (`pnpm --filter @workspace/api-spec codegen`).
- `routes/notifications.ts` GET returns both from `cat_updates`.
- App: new keys in `artifacts/cat-spotter/lib/i18n.ts`, in en, el and fr (the spec's §3.4 table, marked `// SYC-4: draft`). Weekday and month lists are kept in the app too, so they don't depend on Hermes `Intl`. `notificationText()` in `app/notifications.tsx` words cat news from `wording` + `catName` + `wordingDay`, and falls back to `message` when there's no label.
- Tests (app vitest): each label × language. A missing label shows the stored message. A merged cat shows the survivor's name. `wordingDay` is formatted with no wall clock.
- Check by hand: the web preview of the bell at about 390px and at desktop width, in `el` and `fr`, with planted bell rows on a scratch database. Screenshots go in the PR.

## Order, PR rules and hand-offs

- Each PR opens as a draft, has its affected tests run locally, and gets an independent Sonnet critic in its own worktree. Fixes are folded in, then `gh pr ready` once, then a real CI pass. Merging is Samuel's call (`/ship`).
- After merge: Samuel pulls main in Replit and republishes. For PR 2, the migration goes to production first.
- Greek and French strings go to Johnny's review pack (SYC-346 / SYC-4) when PR 1 opens.

## Model delegation

The session model is Opus.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| The word table in `newsWords.ts` (translations and grammar cases) | Opus (this session) | getting Greek and French cases right is judgment work; mistakes are user-visible | Johnny's native review (SYC-4); `newsWords.test.ts` completeness checks |
| PR 1 plumbing: language through every push path | Sonnet | clear spec, a known pattern (`weeklyClose.ts` already does it) | tests per sender; Sonnet adversarial critic in its own worktree; **mutation probe** (below); the session model reviews the diff |
| PR 2 migration and writers | Sonnet | mechanical, with strict repo rules | `migrate:check`, the db test suite (rollback), fingerprint test, writer tests; the session model reads the SQL |
| PR 3 API, codegen and app wording | Sonnet | standard app change with a clear spec | app vitest; web preview screenshots at 390px and desktop in el and fr (session model); Sonnet critic |
| Final integration, PR descriptions, Linear | Opus (this session) | judgment and synthesis | n/a |

No package goes above Opus.

**Silent-failure guard.** A push in the wrong language is a wrong-but-successful result: nothing errors, the phone just gets English. So PR 1's assurance includes a mutation probe:
1. Make `languageOf` always return `"en"`, and confirm the named sender tests go red.
2. Drop `language` from the round-up SQL, and confirm the round-up test goes red.
3. Restore both.

The consumers of "every push reads the language" are the eight files in PR 1's table. The checker greps `sendPushNotification(` and `notifyDevices(` and must find no caller outside that list.

## Out of scope

SYC-779 and SYC-55 (new kinds of news, quiet hours, settings, email) wait for Syros Cats' answers (`docs/specs/news-for-finders-groundwork.md`). They reuse `newsWords.ts`.
