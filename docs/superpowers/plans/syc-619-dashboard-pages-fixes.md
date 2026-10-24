# Dashboard pages fixes (SYC-619): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make every team dashboard page except Home and the team cat page put its content first. That means a phone menu fold, rules moved into folds, short list rows, and the page-by-page fixes in the spec.

**Architecture:** the dashboard is server-drawn HTML from `artifacts/api-server/src/lib/teamPages/*`. Its CSS is one string in `layout.ts` (`STYLES`) and its routes are in `routes/team*.ts`. Pages must work without scripts. Three plain scripts in `artifacts/api-server/assets/` (`dashboard-grid.js`, `dashboard-map.js`, `find-photo.js`) only add to what the page already does. Strings that a cat guardian reads go through `lib/teamPages/strings/{en,el,fr}.ts`. Team-only strings are written straight into the page code.

**Tech stack:**
- TypeScript, Express and vitest.
- jsdom, for the asset-script tests.
- Drizzle, for the one migration.
- The browser pane, for the 390px and 1280px checks.

**Spec:** `docs/specs/dashboard-pages-fixes.md` (approved by Samuel, 23 Oct 2026). Section numbers below (§) are the spec's.

## Global constraints

- **Look.** `#f6f4ef` background, `#1d1d1b` ink, `#0b5c6b` teal, the system font. Red is only for risky actions and urgent reports. Tap targets are at least 44px.
- **Scripts.** Every page works without scripts. Never add a script that a page needs in order to work.
- **Addresses.** No position, and no person's or colony's name, goes into an address (redesign §10.4). A new `?open=` takes only an id of the right shape.
- **Words.** Plain English, with the words "cat guardian" and "spotter". Team pages stay English. A guardian-read string is added to en, el and fr together (`strings.test.ts` checks every language has every key).
- **What a guardian sees.** On a colony row: the mark and the last-seen date. Never a place, a position or a map company's address.
- **Pull requests.** Draft PRs only (`gh pr create --draft`). Run the affected tests locally before every push, and the full api-server suite before `gh pr ready`. A skipped CI run is not a pass.
- **Push, then ready.** Pushing and then running `gh pr ready` at once cancels the real CI run, so rerun it.
- **After a merge.** Report main's push CI on the merge commit.
- **Commits.** Commit after every task, and after every review fix. Never leave work uncommitted, because probe runners restore with `git checkout`. Each agent writes a checkpoint note to `docs/superpowers/plans/syc-619-checkpoint.md`: what's done and what's next.
- **Browser checks.** Seed a scratch database. Plant `__Host-cs_team` on `/api/healthz`. In Playwright, call `context.route` to abort every non-localhost request **before** the first navigation. Run with `PRELAUNCH_GATE=off`. Post forms with `page.request.post` and the Origin `https://team.catspotters.com`.
- **Shared code.** `rowMenu()`, `roleSentence()`, `.report` and `placementFields()` are shared with pages and emails outside this scope. Each task below says how it stays in scope.

## Review focus

The cases the spec implies but no other test covers, most likely to break first. Each is pinned by a test in the task named.

1. **A very long name in the phone bar** (for example, "Signed in as Aikaterini Papadopoulou-Vasilopoulou" at 320px) wraps inside its row and never widens the page. Task 1.
2. **A cat guardian's colony cat that was never seen** shows "No sightings yet" (`gcat.neverSeen`), not a blank line, and no team-only text. Task 8.
3. **`?open=` on People** for a person on the other tab, one who doesn't exist, or a malformed id: nothing opens, there's no error, and the page loads. Task 6.
4. **Areas with equal cat counts** sort by name, and the sort is stable. An area with 0 cats is still listed. Task 7.
5. **Many cats at one spot at the closest zoom:** the merge pass makes one group, and tapping it opens the sheet listing every cat. Task 14.

---

## Setup (once, before Task 1)

- [ ] **S1.** Confirm `pwd` is `/Users/samuelporter/Projects/syros-cat-spotter/.claude/worktrees/dashboard-pages-design-review-52a085` and that the branch is up to date with `origin/main` (synced 23 Oct, merge `ddd6ce64`, which includes #292). If it isn't, stop and say so.
- [ ] **S2.** Run `pnpm install` at the repo root. Then apply the darwin esbuild and rollup workaround (memory: `local-vitest-esbuild`). The binary is in the session scratchpad at `esb/package/bin/esbuild`.
- [ ] **S3.** Run a baseline of the suites this plan touches. Record the pass counts in the checkpoint note:

```bash
cd artifacts/api-server && ESBUILD_BINARY_PATH=<scratchpad>/esb/package/bin/esbuild AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:9 AI_INTEGRATIONS_OPENAI_API_KEY=ci-dummy-not-a-key DATABASE_URL=postgres://localhost/postgres pnpm exec vitest run src/lib/teamPages src/routes/team.people.test.ts src/routes/team.areas.test.ts src/routes/team.colonies.test.ts src/routes/team.colonyCats.test.ts src/routes/team.reportPages.test.ts src/routes/team.findPhoto.test.ts src/routes/teamNews.test.ts src/routes/internal.people.test.ts src/routes/team.walk.test.ts src/routes/team.roles.test.ts src/lib/capabilities.test.ts
```

---

## PR 1: the shell (§2, the shared fold for §3)

Branch: `claude/syc-619-pr1-shell`, off this worktree's branch. Wait for each step's checks before going on.

### Task 1: the phone menu fold (§2.1)

**Files:**
- Modify: `lib/teamPages/layout.ts` (`renderPage` around lines 592–683, and the `STYLES` rules at lines 100–123)
- Modify: `lib/teamPages/strings/en.ts`, `el.ts`, `fr.ts` (add one key)
- Test: `lib/teamPages/layout.test.ts`, `lib/teamPages/queuePage.layout.test.ts`

**Interfaces:**
- Produces:
  - the CSS classes `.bar` (unchanged, 600px and wider) and `.phonebar` (new, below 600px);
  - the string key `shell.menuButton`: en "Menu", el "Μενού", fr "Menu".
- `renderPage(opts)` keeps the signature it has today.

- [ ] **Step 1: Write the failing tests** in `layout.test.ts`, in `describe("phone menu (SYC-619 §2.1)")`.
  - `"draws .bar and .phonebar, each with every link once"`: render with `active:"cats"`, people and workspace on. Assert each copy holds the same set of `href`s, `.phonebar` has `<details class="menufold"><summary>Menu</summary>`, and the current page's name ("Cats") sits **before** the `<details>`, not inside its `<summary>`.
  - `"one copy shows at a time"`: `STYLES` contains `@media (max-width:599px){.bar{display:none}` and `.phonebar{display:none}` outside that media query.
  - `"the fold ends with the name and Sign out"`: the last two children of `.menufold`'s link list are `.who` and the sign-out `<form>`.
  - `"aria-current stays on the current link inside the fold"`.
  - `"a guardian's menu folds too"`: with `nav:"guardian"`.
  - `"null active: Menu with no page name"`.
  - `"refusal, welcome and error bars are unchanged"`: `nav:false`, a page with no links, and `personName:null`. Snapshot today's output first.
  - **Review focus 1:** `"a long name wraps"`: a 60-character name. `.phonebar .who` has `white-space:normal` and `overflow-wrap:anywhere`.
- [ ] **Step 2: Update on purpose, and list in the PR description.**
  - In `layout.test.ts`, "wraps onto more rows on a phone… (SYC-522)" (line 237) and "the phone padding rule reaches the wide bar" (line 233) now assert the `.phonebar` rules.
  - In `queuePage.layout.test.ts`, lines 59 and 202 now find the menu inside `.bar`.
- [ ] **Step 3: Run the tests and watch them fail.** Run `pnpm exec vitest run src/lib/teamPages/layout.test.ts src/lib/teamPages/queuePage.layout.test.ts` (with the S3 environment). Expect the new cases to fail.
- [ ] **Step 4: Implement it.**
  - Build `items` once, then emit `<nav class="bar" aria-label="{shell.menu}">…</nav>` followed by `<nav class="phonebar" aria-label="{shell.menu}"><span class="phonehere">{active label or ""}</span><details class="menufold"><summary>{shell.menuButton}</summary><div class="menulinks">{items}{who}</div></details></nav>`.
  - In CSS, `.menulinks a` and `.menulinks button` are `display:flex;min-height:44px;width:100%`.
  - Remove the old phone wrap rules from the SYC-522 block.
- [ ] **Step 5: Run the tests and see them pass,** together with `strings.test.ts`.
- [ ] **Step 6: Commit.** Message: `SYC-619 PR1: one-row phone menu with a Menu fold (spec §2.1, D1)`.

### Task 2: Workspace for management only, and `review_cat_news` (§2.2, N1)

**Files:**
- Modify: `lib/capabilities.ts` (line 65 for `use_workspace`; add `review_cat_news`)
- Modify: `routes/teamNews.ts` (lines 30 and 66)
- Modify: `docs/specs/roles-and-invites.md` (the §6.2 rows)
- Test:
  - `lib/capabilities.test.ts`
  - `routes/internal.people.test.ts`
  - `routes/internal.doors.future.test.ts`
  - `routes/team.roles.test.ts`
  - `routes/team.walk.test.ts`
  - `routes/teamNews.test.ts`
  - `lib/teamPages/layout.test.ts`

**Interfaces:**
- Produces:
  - `use_workspace: { kind: "island", roles: ["management"] }`;
  - the new `review_cat_news: { kind: "island", roles: TEAM }`.
- The menu still reads `mayUseWorkspace(person)`. There is no new check in `requireTeam.ts`.

- [ ] **Step 1: Check the live Worker first.** Find out whether the live sign-in Worker asks with `version: 2`.
  - Look in `~/Projects/catspotters-website` for the `people/allowed` request body, and compare the version `wrangler deployments list` shows with that source.
  - Write down which source you used.
  - If you can't tell, stop the task and tell Samuel. **Don't guess.** Without `version: 2`, staff would lose the dashboard too.
- [ ] **Step 2: Check who would lose access.** Run a read-only `run_sql` on production through the Neon MCP:

```sql
select p.id from people p
where p.left_at is null
  and exists (select 1 from person_scopes s where s.person_id = p.id and s.role = 'staff')
  and not exists (select 1 from person_scopes s where s.person_id = p.id and s.role = 'management');
```

  - Expect 0 rows.
  - If any row comes back, tell Samuel how many, but not who, before going on.
  - If auto mode blocks the query, ask Samuel to switch to ask mode (memory: `neon-writes-need-ask-mode`).
- [ ] **Step 3: Write the failing tests.**
  - `capabilities.test.ts`: `"use_workspace is management only"` and `"review_cat_news is the team's"`.
  - `internal.people.test.ts`: `"version 2: staff-only gets workspace false and dashboard true; a manager gets both"` and `"no version: staff-only gets the fixed no body"`.
  - `teamNews.test.ts`: `"staff still reach news-changes; a guardian gets 403"`.
  - `layout.test.ts`: `"a staff member's menu has no Workspace; a manager's does"`.
- [ ] **Step 4: Run the tests and see them fail.**
- [ ] **Step 5: Implement it.**
  - Change the two catalogue entries.
  - Swap `requireTeam("use_workspace")` and `formRoute("use_workspace")` in `teamNews.ts` for `review_cat_news`.
  - Update `roles-and-invites.md` §6.2: the `use_workspace` row becomes management-only, and add a `review_cat_news` row.
  - Update `team.walk.test.ts` and `team.roles.test.ts` on purpose for the new row.
- [ ] **Step 6: Mutation probe.**
  - Put `TEAM` back on `use_workspace`. The staff tests in Step 3 must fail.
  - Restore it.
  - Record the failing test names in the checkpoint note.
- [ ] **Step 7: Run all the files in this task, and see them pass.**
- [ ] **Step 8: Commit.** Message: `SYC-619 PR1: workspace is management-only; cat-news review gets its own team capability (spec §2.2, N1)`.

### Task 3: one left edge (§2.4)

**Files:**
- Modify: `lib/teamPages/layout.ts` (`main` CSS at lines 124–125, the `.mappage` margin at line 364, and the `renderPage` body)
- Test: `lib/teamPages/layout.test.ts`

**Interfaces:**
- Produces: `<div class="readcol">` wrapping everything inside `<main>` when `mainClass !== "wide"`.
- `mainClass` stays `"mappage" | "wide" | undefined`.

- [ ] **Step 1: Write the failing tests.**
  - `"main is 1120px on every page"`.
  - `"a narrow page wraps its content in .readcol, 760px, left-aligned"`.
  - `"wide pages have no .readcol"`.
  - `"the .mappage margin rule uses the 1120px frame and still rounds down to 1px"`: assert the CSS text `round(down,(100% - 1120px) / 2,1px)`, or its equivalent.
- [ ] **Step 2: Run the tests and see them fail. Implement it. Run them and see them pass.**
- [ ] **Step 3: Check the whole-pixel rule in the browser pane.**
  - On Feeding sites and a centre picker, at 390px, 768px, 1013px and 1280px, read the map image's `getBoundingClientRect().left` and `.top`.
  - Every value must be a whole number.
  - Record the values in the PR description. No unit test covers this.
- [ ] **Step 4: Commit.** Message: `SYC-619 PR1: one left edge at every width (spec §2.4)`.

### Task 4: back links (§2.5)

**Files:**
- Modify:
  - `areasPage.ts:215`
  - `likelyPage.ts:99`
  - `appearancePage.ts:499` (the `colourCheck.back` key in en, el and fr)
  - `vetSettingsPage.ts` (add `beforeTitle`)
  - `colonyPages.ts:627` and `:793`
  - `sitePages.ts:434`
  - `peoplePages.ts:333` and `:361`
  - `findPhotoPage.ts:231-236`
  - `catGridPage.ts:365`
  - `reportPages.ts:141`
- Create: `lib/teamPages/backLink.ts`
- Test: create `lib/teamPages/backLinks.test.ts`

**Interfaces:**
- Produces: `backLink(href: string, label: string): string`. It returns `<p class="back"><a href="{href}">← {label}</a></p>`, with the label escaped.

- [ ] **Step 1: Write the failing test** `backLinks.test.ts`. It is one table-driven test over the spec's §2.5 table. Each row renders the page and checks the `p.back a` text and its `href` exactly. Areas, Ear clips and Colour check must go to `/api/team/home`.
- [ ] **Step 2: Run it and see it fail. Implement the change.** Every page in the list calls `backLink`. Change `colourCheck.back` to "← Home" in en, el ("← Αρχική") and fr ("← Accueil").
- [ ] **Step 3: Run it and see it pass,** with `strings.test.ts` and the page tests that pinned the old text. Update those on purpose.
- [ ] **Step 4: Commit.** Message: `SYC-619 PR1: one kind of back link; Home links go to Home, not the Queue (spec §2.5)`.

### Task 5: fold markers, and the shared "How this is worked out" fold (§2.6, §3)

**Files:**
- Modify: `lib/teamPages/layout.ts` (`STYLES`, near the existing `▸` rules at lines 222–224)
- Modify: `lib/teamPages/peoplePages.ts` (the `invitefold` summary class)
- Create: `lib/teamPages/methodFold.ts`
- Test: `lib/teamPages/layout.test.ts`, and create `lib/teamPages/methodFold.test.ts`

**Interfaces:**
- Produces: `methodFold(lines: readonly string[]): string`. It returns `<details class="method"><summary>How this is worked out</summary>{lines as <p class="hint">, escaped}</details>`, or `""` when `lines` is empty.

- [ ] **Step 1: Write the failing tests.**
  - The marker rule lists exactly these selectors: `.fixes summary`, `.typedfold summary`, `details.hist>summary`, `details.notdescribed>summary`, `details.invitefold>summary`, `details.method>summary`.
  - It uses `content:"▸" / ""` and, when open, `content:"▾" / ""`.
  - None of these get it: `summary.rowline`, `details.filters`, `.rowmenu`, `details.confirm`, `.menufold`, `details.person`, `details.arearow`.
  - "Invite someone" is outlined, not filled.
  - `methodFold` escapes its lines and returns `""` for an empty list.
- [ ] **Step 2: Run them and see them fail. Implement it. Run them and see them pass. Commit.** Message: `SYC-619 PR1: folds show a marker; shared How this is worked out fold (spec §2.6, §3)`.

### PR 1 close

- [ ] Run every suite in S3. Check each page in the browser pane at 390px and 1280px: Cats, Queue, People, Reports, Areas, Feeding sites and a guardian's Colonies.
- [ ] Open a **draft** PR against `main`. List the deliberate test updates. Run an adversarial review (§ Model delegation), fold its fixes in, then run `gh pr ready` and wait for a CI run that succeeded.
- [ ] Merge only on Samuel's go, with a plain merge, never `--auto`. Then check main's push CI.

---

## PR 2: lists (§4, §7)

Branch `claude/syc-619-pr2-lists`, from `main` after PR 1 merges.

### Task 6: People rows (§4.1)

**Files:**
- Modify: `lib/teamPages/peoplePages.ts` (`card` at lines 186–199, `renderPeoplePage` at 286–317)
- Modify: `routes/teamPeople.ts` (pass `openId`, and the proven `Done`, at lines 123–150)
- Test: `routes/team.people.test.ts`

**Interfaces:**
- `renderPeoplePage(o)` gains `openId?: string`. It is set only when the id matches the people-id shape, the same check `/people/:id/roles` uses.
- `card(p, open: boolean)`.
- The short-role words: `"Management" | "Team" | "Cat guardian"`. Join two with ", " and capitalise only the first word: "Team, cat guardian".

- [ ] **Step 1: Write the failing tests.**
  - Each person is `<details class="person" id="p-{id}">`, closed, and the summary has the name, the chip and the short role.
  - No `.pbtn` appears outside an open fold.
  - A proven `Done` opens that person; a bare `?done=` opens nobody.
  - `?open={id}` opens that row.
  - **Review focus 3:** `?open=` with an unknown id, a malformed id, or the id of a person on the Left tab opens nothing, and the page answers 200.
  - "Joined in the last 7 days" links to `?open={id}#p-{id}`, and the section is absent when it's empty.
  - A joined person's date line reads "Since 3 October 2026."
  - The `not_sent` chip shows "Not sent yet".
- [ ] **Step 2: Run them and see them fail. Implement it. Run them and see them pass,** together with `team.people.noColonies.test.ts`. Update any old tests that expected visible buttons, on purpose.
- [ ] **Step 3: Commit.** Message: `SYC-619 PR2: People as short rows that open (spec §4.1)`.

### Task 7: Areas rows (§4.2, D5)

**Files:**
- Modify: `lib/teamPages/areasPage.ts` (`areaRow` at lines 110–146, `historyList` at 181–194, and the intro and footer at 219–226)
- Modify: `routes/teamAreas.ts` (the sort at lines 43–48, and pass `firstVersion`)
- Test: `routes/team.areas.test.ts`

**Interfaces:**
- `areaRow(a, o)` returns `<li><details class="arearow"{open if isOpen}><summary><strong>{name}</strong> <span class="meta">{N cats}</span></summary>…today's controls…</details></li>`.
- `historyList(history, firstVersion: number)` folds the rows whose `version === firstVersion` into one line, `"{n} areas set up by Syros Cats, {day}"`.
- The intro and the footer go into `methodFold([...])` (Task 5).

- [ ] **Step 1: Write the failing tests.**
  - The sort is cats descending, then name.
  - **Review focus 4:** two areas with 0 cats sort by name, and both are listed.
  - A form that comes back with an error keeps its row open (`isOpen`).
  - Retire still goes to its confirm page. The existing `confirm: "1"` tests stay unchanged.
  - The first version's rows fold into one line.
  - A later row with `who === null` stays on a line of its own.
- [ ] **Step 2: Run them and see them fail. Implement it. Run them and see them pass. Commit.** Message: `SYC-619 PR2: Areas as short rows, busiest first (spec §4.2, D5)`.

### Task 8: a colony's page (§7.2, D3)

**Files:**
- Modify: `lib/teamPages/colonyPages.ts` (`catList` at lines 502–540, and the `renderColonyPage` order at 586–657)
- Modify: `lib/teamPages/rowMenu.ts`
- Modify: `routes/teamColonies.ts` (lines 249–279: load the marks)
- Modify: the guardian colony route that renders the same page
- Test: `routes/team.colonyCats.test.ts`, `routes/team.colonies.test.ts`, and the guardian route-walk in `team.walk.test.ts`

**Interfaces:**
- `ColonyCatRow = ColonyCat & { mark: SterilisedMark | null; lastSeenAt: Date | null }`. `mark` is null when `loadTeamCats` leaves the cat out.
- `renderColonyPage(v, personName, opts)` gains `rows: ColonyCatRow[]`, already sorted.
- `sortForPlanner(rows: ColonyCatRow[]): ColonyCatRow[]`. The order is `not_sterilised`, `not_known`, `probably`, `sterilised`, then null. Within each, the latest `lastSeenAt` comes first, and null goes last.
- `rowMenu(label, forWhat, items, opts?: { compact?: boolean })`. The compact form draws its summary as `<span aria-hidden="true">⋯</span><span class="sr">{label} ({forWhat})</span>`.

- [ ] **Step 1: Write the failing tests.**
  - The sections run in the §7.2 order.
  - The team's row shows `markBadge` and `lastSeenWords` with **no " · "** and no place.
  - The guardian's row shows `colonies.mark.*` words in her language, and the date from the guardian `lastSeenWords(day, lang…)`.
  - **Review focus 2:** for a guardian, a cat that was never seen shows `gcat.neverSeen`.
  - The guardian page has no place label, no position, and no `google.com/maps` or `openstreetmap` address.
  - A merged-away cat keeps its row and has no mark.
  - `sortForPlanner` has a unit test for every group and for ties.
  - The compact "⋯" sits inside the `<li>`.
  - The team cat page's `rowMenu("More", …)` output is unchanged. Snapshot it.
- [ ] **Step 2: Run them and see them fail. Implement it.** Call `loadTeamCats(now)` once per page and join on id. Don't add a database query per cat.
- [ ] **Step 3: Run them and see them pass,** with `strings.test.ts`. Then commit. Message: `SYC-619 PR2: a colony's cats show their mark and last seen, not-done first (spec §7.2, D3)`.

### Task 9: the Colonies list order (§7.1)

**Files:**
- Modify: `lib/teamPages/colonyPages.ts` (`renderColoniesPage` at lines 259–348)
- Test: `lib/teamPages/colonyPages.lead.test.ts`, `routes/team.colonies.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - With 0 colonies and no search, there is no `role="search"` and no `recent-changes`.
  - With colonies, the order is: search, sort, the figures line, the list, Create, then Recent changes.
  - The existing SYC-577 lead tests still pass. Update the order assertion on purpose.
- [ ] **Step 2: Run them and see them fail. Implement it. Run them and see them pass. Commit.**

### PR 2 close

Same as PR 1's close. The browser checks cover People (with 3 people, one of them on Left), Areas (21 areas), a colony with 8 cats as the team, and the same colony as its guardian.

---

## PR 3: Cats, the Map and the Queue (§5, §6)

Branch `claude/syc-619-pr3-cats-map-queue`, from `main` after PR 2 merges.

### Task 10: cards that say what's known (§5.1)

**Files:**
- Modify: `lib/teamPages/catGridPage.ts` (`card` at lines 255–283)
- Test: `lib/teamPages/catGridPage.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - A card with an unknown coat and no colony has no "Coat not known" and no "No colony".
  - A card with both shows both.
  - The mark line always shows.
  - The alt text is "Photo of {name}" when the coat is unknown.
  - The lines come in the §5.1 order.
- [ ] **Step 2: Run them and see them fail. Implement it. Run them and see them pass. Commit.**
- Note: if SYC-601 has merged by then, keep its words. If not, leave the mark's words as they are.

### Task 11: the 360px `card` photo version (§5.2, D6)

**Files:**
- Modify: `lib/db/src/schema/photoVariants.ts:38` (the check becomes `in ('small','medium','card')`)
- Create: the migration through `pnpm --filter @workspace/db run generate --name photo_variants_card`, with a commented rollback (`lib/db/migrations/README.md`)
- Modify: `artifacts/api-server/src/lib/photoVariants.ts:12` (`VARIANT_WIDTH = { small: 160, medium: 640, card: 360 }`)
- Modify: `lib/teamPages/catGridPage.ts:259` (`srcset`, `sizes`)
- Modify: the doc comment at `routes/teamReports.ts:268`
- Test: `lib/photoVariants.test.ts` (or wherever `makeVariant` is tested), `routes/team.photoVariants.test.ts`, `catGridPage.test.ts`, and the `lib/db` migration tests

- [ ] **Step 1: Write the failing tests.**
  - `makeVariant(buf, "card")` is 360px wide and has no EXIF or GPS.
  - `GET /api/team/photos/:id/card` follows the same access checks as `small`: a hidden photo gives 404, and a guardian outside her colony gets the same answer as for `small`.
  - `clearVariants(photoId)` removes `card` rows too.
  - The grid `<img>` has `srcset=".../small 160w, .../card 360w"` and `sizes="(min-width:1000px) 200px, 45vw"`.
- [ ] **Step 2: Run them and see them fail. Implement it.** Generate the migration, read it, and add the rollback.
- [ ] **Step 3: Check the migration.** Run `pnpm --filter @workspace/db test` and `migrate:check` with `DATABASE_URL` pointing at a scratch database. Both must pass.
- [ ] **Step 4: Commit.** Message: `SYC-619 PR3: a 360px card photo for the Cats grid (spec §5.2, D6; migration)`.

### Task 12: fewer rows of controls (§5.3)

**Files:**
- Modify: `lib/teamPages/catGridPage.ts` (lines 291–296 and 342–345)
- Modify: `lib/teamPages/catMapPage.ts` (lines 186–187)
- Modify: `assets/dashboard-map.js`, so the photo link's `href` follows the filters wherever the Grid link's does
- Test: `catGridPage.test.ts`, `dashboardGrid.script.test.ts`, `dashboardMap.script.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - On both views, `viewSwitch` and the find link sit in one `.viewrow` inside `#catresults` (or the map page's equivalent).
  - After a filter change in jsdom, the find link's `href` carries the new filters, on both views.
  - The map script still builds only the three fixed addresses (the existing `dashboardMap.script.test.ts` rule).
- [ ] **Step 2: Run them and see them fail. Implement it. Run them and see them pass. Commit.**

### Task 13: the map while it loads (§5.4), and one outline module (§8.4)

**Files:**
- Create: `lib/geo/src/syrosOutline.ts` (export `SYROS_OUTLINE: readonly [number, number][]`, the 20 points from `dashboard-map.js:80-87`)
- Modify: `lib/geo/src/index.ts` (re-export it)
- Modify: `lib/teamPages/catMapPage.ts` (`data-outline="{JSON}"` on `#island-map`)
- Modify: `assets/dashboard-map.js` (lines 80–87, 183–204 and 237)
- Test: create `lib/teamPages/dashboardMap.loading.test.ts`, modelled on `dashboardMap.fit.test.ts` (jsdom plus the chained Leaflet stub)

**Interfaces:**
- Produces: `SYROS_OUTLINE`, also used by Task 17.
- The script reads `JSON.parse(el.dataset.outline)`. If that's missing or invalid, it falls back to no loading outline. The failure outline stays as it is.

- [ ] **Step 1: Write the failing tests.**
  - The script calls `map.createPane("outlineBelow")` with a `zIndex` under the tile pane's 200, and adds a polygon to that pane before any picture loads.
  - `#maploading` with the text "Loading the map…" is present at start, and is removed on the first `img.onload`.
  - `tilesFailing()` still adds its own outline, which replaces the loading line.
  - The page's `data-outline` equals `JSON.stringify(SYROS_OUTLINE)`.
- [ ] **Step 2: Run them and see them fail. Implement it. Run them and see them pass. Commit.**

### Task 14: merge overlapping bubbles (§5.5)

**Files:**
- Modify: `assets/dashboard-map.js` (`drawCats` at lines 536–554)
- Test: create `lib/teamPages/dashboardMap.merge.test.ts`

**Interfaces:**
- `mergeClose(markers: { x: number; y: number; cats: Cat[] }[], minPx: number)` returns a new array of markers. It sits at the top of the script, and the script sets `window.__dashboardMapInternals = { mergeClose }` only when `window.__dashboardMapTest === true`, so tests can reach it.
- The pass repeats until no two markers are less than `minPx` apart. A merged marker sits at its cats' average point.

- [ ] **Step 1: Write the failing tests.**
  - Two markers 30px apart become one, holding both sets of cats.
  - A chain of three markers 40px apart ends as one marker.
  - Markers 50px apart are unchanged.
  - With 2,000 random cats in a 1000×800 box, the result has no pair under 44px, and the run takes under 16ms (use `performance.now`, and allow 3 runs).
  - **Review focus 5:** 30 cats at one point at the closest zoom become one group, and the group's tap opens the sheet listing all 30.
  - **Mutation:** a test runs the real `drawCats` with the pass removed (via the stub's recorded markers), and must fail.
- [ ] **Step 2: Run them and see them fail. Implement it.** Call `mergeClose(..., CELL)` after the bucketing in `drawCats`.
- [ ] **Step 3: Run them and see them pass. Mutation probe:** comment out the call, check that the named test goes red, then restore it. Record this in the checkpoint note. Commit.

### Task 15: Queue (§6)

**Files:**
- Modify:
  - `lib/teamPages/queuePage.ts`: `actionForms` (lines 109–147), the summary tile (266–268), `photoBlock` (89–107), and the stripe classes
  - `lib/teamPages/layout.ts`: lines 130, 150–153 and 176–179, with every new rule scoped to `article.report`
- Test: `lib/teamPages/queuePage.layout.test.ts`, `routes/team.queuePage.test.ts`

**Interfaces:**
- `nextStep(state: ReportState, offered: readonly ReportState[]): ReportState | null`. It gives `new` → `looking`, `looking` → `done`, and null otherwise. It also returns null when the result isn't in `offered`.

- [ ] **Step 1: Write the failing tests.**
  - "Now: New" shows as text, not a button. "Looking at it" is the filled button (`class="go"`).
  - From Looking at it, "Done" is filled.
  - No button is filled for Done or Nothing needed, or for an issue whose hidden photo can't offer the next step.
  - A report with no photo has no `hthumb nothumb`, and its body has "No photo".
  - `.said1` uses `-webkit-line-clamp:2`, and `details[open] .said1{display:none}` exists.
  - An open non-urgent `article.report` has `border-left-color:#d9d5ca`. Urgent, issue and closed reports keep their colours.
  - **Scope:** the `li.report.colourcheck` and Ear clips cards render with today's CSS. Snapshot them.
  - Update the existing state-button cases on purpose.
- [ ] **Step 2: Run them and see them fail. Implement it. Run them and see them pass. Commit.**

### PR 3 close

Same as PR 1's close, plus the migration steps (spec §14) **after the merge and before Samuel republishes**:

1. Run `db-ops migrate` on production.
2. Run `verify-history`.
3. Run `run_sql` to check that `photo_variants_size_ck` includes `card`.
4. Tell Samuel "don't republish yet" until step 3 passes.

---

## PR 4: reports and the rest (§3, §8, §9)

Branch `claude/syc-619-pr4-reports`, from `main` after PR 3 merges.

### Task 16: reports (§8.1–§8.3)

**Files:**
- Modify: `lib/teamPages/reportPages.ts`:
  - the index at lines 66–83;
  - `methodNote` at 119–128, rebuilt on `methodFold`;
  - `stamp` at 53–56;
  - `nothing()` at 133–135;
  - each report's render function, at 198–571.
- Modify: `lib/reports/chartCss.ts` (the chip underline at lines 44–46, and the muted card)
- Test: `routes/team.reportPages.test.ts`

**Interfaces:**
- `methodNote(range, workedOutAt, areasVersion, lines)` returns the visible line `<p class="hint" id="worked-out">Worked out {stamp} Syros time · {range}</p>` followed by `methodFold([...lines, CORRECTED, areasLine?])`. The `id="areas-version"` line goes inside the fold.

- [ ] **Step 1: Write the failing tests,** one per §8 bullet.
  - The index has no intro line. The impact card has a "Coming soon" chip. Donations keeps its own words. The vet card has no chip when there's no cost access.
  - The chips have `text-decoration:none`.
  - `#worked-out` is outside the fold and contains "Syros time". `#areas-version` is inside it.
  - On progress, "Each point shows…" appears exactly once.
  - Each report's empty state leaves out exactly the sections in §8.2's table.
  - The welfare promise line is visible when empty and when not.
  - Colony health with no colonies says "No colonies yet. Colonies are set up on the Colonies page." and links to `/api/team/colonies`.
  - The vet and welfare rule lines are inside the fold. The vet spend sentence and "Spotters are counted, never named." are outside it.
  - The CSV routes' output is unchanged. Snapshot one per report.
  - Update the `#worked-out` and `#areas-version` position tests on purpose.
- [ ] **Step 2: Run them and see them fail. Implement it. Run them and see them pass. Commit.**

### Task 17: the coverage picture (§8.4, D4)

**Files:**
- Modify: `lib/reports/coverageMap.ts` (lines 38–96)
- Test: `lib/reports/coverageMap.test.ts` (create it if it doesn't exist)

**Interfaces:**
- `coverageMap(o)` gains `outline: readonly [number, number][]` and `toGrid(lat: number, lng: number): { row: number; col: number }`. The caller in `reportPages.ts:381` passes `SYROS_OUTLINE` (Task 13) and the same grid projection the cells use.

- [ ] **Step 1: Check the outline before writing code.** Run a read-only `run_sql` that lists the 250m cells with a sighting since launch. Check that each one's centre falls inside `SYROS_OUTLINE`, using a point-in-polygon test in a scratch script. Move any outline points needed in Task 13's module, and record what moved.
- [ ] **Step 2: Write the failing tests.**
  - The SVG's first drawn shape is a `<path>` or `<polygon>` from the outline, with a light fill and before the cells.
  - Each name's box sits above its own area's cell box and doesn't intersect it.
  - No two name boxes overlap.
  - The legend text is unchanged.
- [ ] **Step 3: Run them and see them fail. Implement it.** Place each name at its area's cell box's top-centre, minus the font height. Keep today's step-down nudge for collisions between names.
- [ ] **Step 4: Run them and see them pass. Commit.**

### Task 18: tick-box lines on the roles forms (§9.1)

**Files:**
- Modify: `lib/teamPages/peoplePages.ts` (`placementFields` at lines 216–255)
- Test: `routes/team.people.test.ts`, `routes/team.invite.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - Each of the three boxes has its §9.1 line directly under its label, on Invite, Change roles and Bring back.
  - The old paragraph is gone.
  - `roleSentence` output and the invitation email bodies are unchanged. Snapshot them through the existing template tests.
- [ ] **Step 2: Run them and see them fail. Implement it. Run them and see them pass. Commit.**

### Task 19: Colour check, Ear clips, Vet settings and Find from a photo (§3, §9.2–§9.4)

**Files:**
- Modify:
  - `appearancePage.ts` (`renderColourCheckPage`, around lines 466–501)
  - `likelyPage.ts` (lines 73–102)
  - `vetSettingsPage.ts:83`
  - `findPhotoPage.ts:250-269`, the intro
- Test:
  - `routes/team.appearance.test.ts`
  - `likelyPage.kept.test.ts`
  - `routes/team.vetSettings.test.ts`
  - `routes/team.findPhoto.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - The "Not yet described" fold has `open` when "To check" is empty, and no `open` otherwise.
  - Ear clips with no cats renders only "Nothing to check. Every Probably sterilised cat has been looked at." after the title, with no `hintlist`.
  - Vet settings says "A vet visit with Sterilised ticked starts with this price as its cost. Each visit's cost can still be changed." and has no "within a minute".
  - Find from a photo's intro is exactly "Choose where to look, then add the photo below.", followed by `<a href="#find-photo">Go to the photo</a>`.
  - Every other `team.findPhoto.test.ts` case passes unchanged, including the address-privacy cases.
- [ ] **Step 2: Run them and see them fail. Implement it. Run them and see them pass. Commit.**

### PR 4 close

Same as PR 1's close. The browser checks cover every report with no data and with seeded data, Colour check, Ear clips, Vet settings and Find from a photo at 390px.

---

## After all four PRs

- [ ] Mark SYC-619 Done, with the four PRs noted. File anything deferred in review as its own SYC ticket.
- [ ] Tell Samuel "pull main in Replit, then republish". After the republish, confirm `/api/healthz` shows the new commit before smoke-testing live.
- [ ] Remove this session's merged worktrees and branches.

---

## Model delegation

The session runs on Opus. Each task goes to the cheapest tier that can do it. Every `Agent` call names its tier.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Setup S1–S3 | session (Opus) | Needs this session's scratchpad and worktree checks | Baseline counts recorded |
| Task 1: phone menu | Sonnet | A clear spec with exact markup; one file plus strings | Tests; session spot review of the diff; browser check at 320, 390 and 1280px |
| Task 2: workspace and `review_cat_news` | **Opus** | It changes who can reach the workspace through the sign-in Worker. A mistake locks people out, and it needs judgment about the live Worker and the production query | Mutation probe (Step 6); the session re-runs the named tests; the adversarial review of PR 1 |
| Task 2 Steps 1–2 (Worker and SQL checks) | session (Opus) | Live systems, and Samuel's go may be needed | The sources used are recorded in the PR |
| Task 3: widths | Sonnet | CSS with a precise rule | Tests plus the browser whole-pixel check (values recorded) |
| Task 4: back links | Haiku | Mechanical: one helper and about 13 call sites from a table | The table-driven test; the session re-runs it and greps that every listed file calls `backLink` |
| Task 5: fold markers, `methodFold` | Sonnet | Small CSS and helper work | Tests; spot review |
| Task 6: People rows | Sonnet | Clear spec; touches routes and the page | Tests, including review focus 3; spot review |
| Task 7: Areas rows | Sonnet | Clear spec | Tests, including review focus 4; spot review |
| Task 8: colony page | **Opus** | Two viewers (team and guardian), a guardian-privacy rule, a shared `rowMenu`, and a join across loaders | The guardian route-walk test; the session re-runs it; the PR 2 adversarial review checks guardian leaks |
| Task 9: Colonies order | Haiku | Reordering sections | Tests |
| Task 10: cards | Haiku | Leaving out two lines | Tests |
| Task 11: `card` variant and migration | Sonnet | A known pattern (the PR 1.2 versions) plus a generated migration | Tests; the `lib/db` rollback test and `migrate:check`; the session reads the SQL before commit |
| Task 12: controls row | Sonnet | Markup plus a small script change | jsdom script tests; browser check that filters carry over |
| Task 13: loading outline | Sonnet | A Leaflet pane, with the harness to test it | jsdom tests; browser check on a throttled connection |
| Task 14: bubble merge | Sonnet | A small algorithm with exact tests | The mutation probe (Step 3); performance assertion; spot review |
| Task 15: Queue | Sonnet | Clear rules, with the scoping spelled out | Tests including the scope snapshots; spot review |
| Task 16: reports | Sonnet | Many small, well-specified changes in one file | Tests; CSV snapshots unchanged |
| Task 17: coverage picture | Sonnet, with session-run Step 1 | SVG layout with testable geometry; the live query stays in the session | Geometry tests; the outline check against live cells is recorded |
| Task 18: roles lines | Haiku | A copy change in one function | Tests; email snapshots unchanged |
| Task 19: checks, vet and find | Haiku | Copy and one `open` attribute | Tests; the existing find tests unchanged |
| Adversarial review of each PR | **Opus**, read-only, its own worktree | Finds what the tests don't (privacy, scoping, a11y). Its own worktree so it can't clash with other agents (LIF-79). | Its findings are folded in or answered in the PR |
| Integration, browser checks, PRs, Linear | session (Opus) | Judgment and the live checks | — |

**Rules for every delegated agent** (written into each prompt):
- Commit after each task and after each review fix, and update `syc-619-checkpoint.md`.
- Never hold work only in memory. Don't spawn sub-agents.
- Run only the tests named in its task, and report the exact command and its counts.

The session **re-runs every test file an agent says passed**, and greps that each claimed test exists (memory: `rerun-delegated-tests`) before accepting the task.

---

## Self-review against the spec

| Spec | Task |
|---|---|
| §2.1 | 1 |
| §2.2, N1 | 2 |
| §2.3 | none (nothing changes) |
| §2.4 | 3 |
| §2.5 | 4 |
| §2.6 | 5 |
| §3 | 5 (helper); 7 (Areas); 16 (reports); 19 (Ear clips, Vet settings) |
| §4.1 | 6 |
| §4.2 | 7 |
| §5.1 | 10 |
| §5.2 | 11 |
| §5.3 | 12 |
| §5.4 | 13 |
| §5.5 | 14 |
| §6 | 15 |
| §7.1 | 9 |
| §7.2 | 8 |
| §8.1–8.3 | 16 |
| §8.4 | 13 (outline module) and 17 |
| §9.1 | 18 |
| §9.2–9.4 | 19 |
| §9.5 | already filed on SYC-585 |
| §11 | 1, 4, 8 (strings) |
| §14 | the PR closes, and the PR 3 migration steps |

Every spec section maps to a task.
