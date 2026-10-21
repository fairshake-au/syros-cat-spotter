# SYC-513: "This cat has died" on the team's cat page

**Status:** Plan for Samuel's approval, 18 Oct 2026.
**Spec:** [`docs/specs/mark-a-cat-as-died.md`](../../specs/mark-a-cat-as-died.md), approved by Samuel 18 Oct 2026 (D1–D5 as recommended; the owner is never removed).
**Linear:** SYC-513. Related: SYC-40, SYC-362, SYC-489.
**Shape:** one PR, opened as a draft. No migration, no change to the public app, no new environment settings.

---

## 0. In one paragraph

We add one server-drawn page and one save route for "This cat has died". There's a small library function that records a death safely: under a lock, refusing a date that wouldn't take effect, and writing nothing for a cat already recorded as died. On the cat's page there's a new button and a new notice at the top. Two tidy-ups take "No longer with us" out of the older forms. One of them, Remove owner on a dead cat, gains a "Still no longer with us" choice that removes the owner without bringing the cat back. Everything is tested against a real database, the guards are mutation-probed, and the pages are checked at 390 px and desktop before the PR leaves draft.

---

## 1. Work, in order

Each step is committed on its own, so a crash loses at most one step.

### 1.1 The library: `recordDeath` (`lib/teamCorrections.ts`)

`recordDeath(person, { catId, reason, date? }, now = new Date())` returns one of:

- `{ outcome: "recorded", row }`
- `{ outcome: "already" }`
- `{ outcome: "sightedAfter", at }`
- `{ outcome: "newerStatus", at, by, status, ownerClaim }`

It runs in one transaction:

1. **Permission.** `can(person, "set_life_status")` with no target, or `NOT_AUTHORISED` (the same refusal as today).
2. **Lock.** `select id from cats where id = $1 for update`; no row means `NOT_FOUND`. The lock covers owned and ownerless cats alike, so two saves at once can't both write (spec §5).
3. **Read the record.** `loadCatRecords([catId], tx)`, resolved with `resolveLifeStatus(observations, evidenceOfLife, now)`.
4. **Already died.** If the resolved value is `deceased` with no conflicts, return `already` and write nothing.
5. **The date (spec §4).**
   - Blank, or equal to `athensToday()`: save as `now`.
   - Otherwise: `observedAtFor(date)`.
   - A future date is refused in the route before this point, as today.
6. **Sighted after.** If `evidenceOfLife.lastSightingAt > observedAt`, return `sightedAfter` with that date.
7. **A newer status.** If the newest standing `life_status` row (the resolver's own order: `observedAt`, then id) has `observedAt > observedAt`, return `newerStatus`. That covers the owner's own "has a home" claim, with `ownerClaim: true` so the page can word it.
8. **Record it.** Otherwise `recordTeamStatement(person, { catId, kind: "life_status", value: { status: "deceased" }, reason, observedAt }, tx)`. It never calls `removeOwnerAndSay`, so the owner is untouched (Samuel, 18 Oct).

On merged-away cats, the spec says the died route does whatever the life-status form does. That form passes the asked-for id straight to `recordTeamStatement`, so `recordDeath` does the same, and a test pins it.

### 1.2 Remove owner on a dead cat (`removeOwnerAndSay`)

- **New input.** `status: "keep"` is added. Under the existing lock, `keep` is allowed only when the cat resolves as `deceased`; otherwise it is refused as `MALFORMED_VALUE`.
- **What `keep` does.** It withdraws the owner's "has a home" claims and clears the owner exactly as today, but **skips** `recordTeamStatement`. It returns `row: null`.
- **Why the order matters.** The withdrawn claim is superseded, so the death stays the newest standing status and the cat stays dead. A test checks this through `resolveLifeStatus`.
- **The route.** `POST /team/cats/:id/remove-owner` accepts `status=keep`. The confirm page reads "Agatha stays recorded as “No longer with us”." `deceased` itself is still accepted, unchanged, as spec §7 requires.

### 1.3 Routes (`routes/teamCorrections.ts`)

**`GET /team/cats/:id/died`** uses `requireTeam("set_life_status")`:
- a bad id gets the existing "No such cat" page;
- a cat already recorded as died gets a 303 to the cat page with `done=diedAlready`;
- otherwise it renders the died page (§1.4).

**`POST /team/cats/:id/died`** uses `formRoute("set_life_status")` and a zod form `{ reason, date? }`. Each outcome:

| What happens | Response |
|---|---|
| Form problem or future date | `formProblem` with the page kept as filled, as today |
| Death recorded | 303 to `catPage(catId, "died", row.id)` |
| Already recorded | 303 to `catPage(catId, "diedAlready")` |
| Sighted after, or a newer status | 400 re-render of the died page with the spec §4 message and the fields kept |
| JSON request | 201 `{ id }`, 409 `{ code }` for each refusal, 200 `{ already: true }` |

The landing point is the page top (the §6 notice), not `#corrections`.

### 1.4 Pages

**New file `lib/teamPages/diedPage.ts`: `renderDiedPage(view, personName, { problem?, fields? })`.** It contains:
- the heading "{name} has died";
- the small main photo, or the "No photo" box;
- the "what will happen" list from spec §4, including the owner-stays line when `owner.has || owner.orphanedHome`;
- one optional `type="date"` box with `max` set to today;
- the required reason box with its hint;
- "Save: {name} has died" and the "Back to {name} (nothing changed)" link.

It uses no script, and the word "statement" doesn't appear.

**`lib/teamPages/catPages.ts` changes:**
- **The button.** "This cat has died" goes last in `correctionForms`, as a `GET` form to `/died`. It shows when `may("set_life_status")` and the cat isn't resolved `deceased`-without-conflict. It gets a full-width style on phones and is not `.risky`.
- **The notice.** `deathNotice(v, byId, shown)` at the top of the summary:
  - **Condition:** `records.lifeStatus.value === "deceased"`, no conflicts, and not `recentGuardianMark?.status === "deceased"`.
  - **Contents:** the date it happened (when it differs from the recorded date), who recorded it, when, and why, plus a "Go to it" link to the statement anchor.
- **"Update where the cat lives".** Its choices become `["street", "homed", "in_care"]`, and its date hint loses the "needed for" clause.
- **"Remove owner":**
  - a live cat gets `["street", "in_care"]` plus the pointer line;
  - a dead cat gets the single choice "Still no longer with us" (`status=keep`), with no date box.
- **`wrongForm`** is unchanged.
- **`DONE` keys.** `died` ("Saved. {name} is recorded as no longer with us.") and `diedAlready` are added. The notice text is fixed: no query text is ever shown.

### 1.5 Tests

**New `routes/team.died.test.ts`**, using the same database harness as `team.corrections.test.ts`. It covers every spec §11 line:
- **The button:** shown or hidden for each life state and permission.
- **Dates:** blank, today after midday Athens (via `now` injection), an earlier date, a future date, and a missing reason.
- **The two refusals:** a sighting after the date, and a newer team status or owner claim, each writing nothing.
- **Concurrency:** two concurrent saves leave exactly one `deceased` row. Both run through `Promise.all` against the lock.
- **Already died:** the GET redirects, and the POST writes nothing.
- **No permission or no such cat:** the existing refusal.
- **The owner is untouched:** link, claim, note and pin are all the same after saving.
- **Merged-away cat:** matches the life-status form.
- **The notice:** right for a team death, a cat guardian's death inside and after 30 days, and a revived cat.
- **The tidied forms:** the old forms no longer list it; Mark wrong still does; `remove-owner` with `keep` on a dead cat removes the owner and the cat stays dead; `keep` on a live cat is refused.
- **The old routes:** `deceased` is still accepted on `/life-status` and `/remove-owner`.

**Existing tests:**
- `catPages.words.test.ts` gets the new words.
- The existing `deceased` posts in `team.corrections.test.ts` and `team.removeOwner.test.ts` stay green unchanged (routes unchanged).

### 1.6 Guards that could fail silently: mutation probes

Four guards could fail silently: a run that looks fine but records the wrong thing. For each, I break the code on purpose, check that a named test goes red, then restore it. That's a throwaway script, run after committing so a restore can't wipe work.

| Break this | This test must go red |
|---|---|
| Remove the "already died" check | the concurrent-save test, and "second save writes nothing" |
| Save "today" as `observedAtFor(date)` (midday) | "today after midday is saved as now" |
| Remove the sighting-after check | "a sighting after the date is refused" |
| Remove the newer-status check | "a newer team status is refused" and "a newer owner claim is refused" |
| Let `keep` write a status | "remove owner on a dead cat keeps it dead" |

**Every place that must also hold** ("where else must this hold?"):

- **Callers of `lifeChoices`:** the life-status form, Remove owner, and Mark wrong. All three are handled above.
- **Callers of `removeOwnerAndSay`:** the life-status route, the remove-owner route, and the JSON `removeOwner=1` path. Only the remove-owner route gets `keep`; the others keep their current inputs.
- **Readers of the resolved life status** (notifications, nightly news, round-ups, claiming, picker). These are untouched, because the death is written as the same row as today.

### 1.7 Look at it, then open the PR

- Run the affected test files locally, using the vitest/esbuild workaround from memory.
- Check the cat page and died page in the browser pane at 390 px and desktop, using a local preview with seeded data (memory: dashboard preview cookie host). Both must render **with data**, and the page must be checked as a cat with an owner and as a dead cat.
- Open a **draft** PR. An adversarial code review runs in its own worktree (§2), and its fixes are folded in while it's still a draft. Then `gh pr ready`, and wait for a real green CI run.

---

## 2. Model delegation

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| 1.1 `recordDeath` and 1.2 `keep` (library) | Opus (session) | Small, but full of resolver, lock and date subtleties that the spec review only just caught. Doing it in-session avoids a hand-off for about 120 lines. | The 1.5 tests, plus the 1.6 mutation probes, plus the adversarial review below |
| 1.3 routes and 1.4 pages | Sonnet sub-agent, in this worktree after 1.1–1.2 are committed | Clear spec, existing patterns to copy (the life-status route, `renderConfirmPage`, `correctionForms`) | Typecheck, plus the 1.5 tests, plus a spot review of the diff by the session model, plus the browser check at 390 px and desktop |
| 1.5 test file | Sonnet, the same sub-agent | Routine tests against a written list (spec §11) | The session model re-runs the named files itself (memory: re-run delegated tests), plus the mutation probes prove the tests can fail |
| `catPages.words.test.ts` word list | Haiku-sized edit | Mechanical | Kept in the Sonnet package: too small to hand off separately |
| Adversarial code review of the draft PR | Sonnet critic, **its own worktree** (LIF-79) | Default tier for review. The riskiest parts are already covered by the mutation probes. | Findings checked by the session model against the code before folding in |
| Integration, mutation probes, browser check, PR | Opus (session) | Judgement and final checks | n/a |

Every sub-agent prompt repeats the commit-after-each-item rule word for word and writes a checkpoint note to the worktree.

---

## 3. Things to flag

- **Going live:** there's no migration, so after merge it goes live the usual way: you pull main in Replit and republish. Nothing has to reach production first.
- **The cat guardian's own page** (`/team/my/cats/:id`) is out of scope and unchanged. Its "Has died" already exists.
- **SYC-489** (litter reports on a dead cat) is untouched and stays its own decision.
