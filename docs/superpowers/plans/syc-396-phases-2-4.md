# Team dashboard redesign: implementation plan for phases 2, 3 and 4

**Status:** draft for Samuel's approval on Tue 20 Oct 2026. One combined plan, as Samuel decided on 18 Oct (D1, recorded on SYC-463).

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. **Commit after every task, and write a checkpoint line to `PROGRESS.md` in your worktree after every task (what's done, what's next). Never hold work only in memory. Do not sub-delegate.**

**Goal:** give Syros Cats' team the rest of the redesigned dashboard, in this order:
- Home: what needs us today;
- colonies as trapping plans;
- named areas the team can edit;
- Find from a photo;
- vet visits, one at a time and a whole round;
- the five working reports;
- the funders' impact report.

**Architecture:** this is the same server-drawn Express dashboard that phases 0 and 1 built.
- Every number is worked out from the records on each request, through one shared "who is counted" module (§9.5).
- Vet visits are a new kind of observation, written in the same transaction as the statements they create.
- Reports are server-drawn SVG with a table beside each chart.
- Two small migrations add the areas table and its history; a third records downloads.

**Tech stack:**
- TypeScript, Express, Drizzle on Postgres (Neon), and Vitest with a throwaway database;
- `sharp` for photos;
- `multer` 2.x, new, for the Find-from-a-photo upload.

**Spec:** `docs/specs/team-dashboard-redesign.md` (approved 15 Oct 2026). Section numbers (§) refer to it. Read it with this plan.
**Earlier plan:** `docs/superpowers/plans/syc-396-team-dashboard-redesign.md` (phases 0 and 1, approved 15 Oct). Its global constraints all still apply, and are repeated below where they matter.
**Linear:** SYC-396 is the parent and SYC-463 is this plan. The slip order is D2 on SYC-396: phase 5 first, then phase 4, then phase 3.3's reports, then Find from a photo.
**Evidence base:** `origin/main` at `97420af3` (18 Oct 2026), read by three code inventories on 18 Oct. Every signature below was read from that commit. **Before starting any PR, re-read every signature it names on the then-current `origin/main`. If one has changed, update the task's code, not the intent.**

---

## Global constraints

Every task's requirements include these.

**Words and facts**
- Sterilisation costs €50–60 per cat. The default standard price is **€55**.
- The terms are "cat guardian" and "spotter", never "colony carer" or "snapper".
- Team pages are English only (Decision 12).
  - Pages shared with cat guardians take their words from `lib/teamPages/strings/{en,el,fr}.ts`. `strings.test.ts` enforces that all three have the same keys and the same `{placeholders}`.
  - Greek and French drafts are written by the builder and flagged on SYC-346 for Johnny.
- No text below 12px.
- The same thing is always worded the same way: "Last seen 3 days ago", "% confirmed sterilised".
- Home and the reports never show response times, targets, rankings or per-person figures (D6).

**Who is counted (§9.5).** Every figure, list and report goes through `lib/dashboard/countedCats.ts` (PR 2.0). No PR writes its own "street cat" filter.

**Privacy and security**
- No position, and no person's or colony's name, ever appears in one of our own web addresses. Dates, area keys, colony **numbers** and report keys may.
- Open map links come only from `lib/teamPages/position.ts` with `link: isIslandWide(person)`. A new file that prints positions must be added to `position.guard.source.test.ts` `ALLOWED`, and to `team.guardianView.test.ts` `hers()` if guardians can open it.
- Every team route is declared with `requireTeam(cap)`, or `...formRoute(cap)` for a POST. It calls `setTeamHeaders(res)` before any `await`, and has a row in `routes/team.walk.test.ts` `TABLE`.
- No reader of sites, colonies or `mapping_events` may skip the colony filter. A new reader takes a `Visible` and joins `FILTERED_MODULES`, or is registered in `ISLAND_ONLY_MODULES` with the capability that guards it (`lib/guardianView.source.test.ts`).
- A feeding site's internal `name` never appears in a place label, a printed plan, a CSV or a report. Only `publicLabelOf(site)` may.
- New capabilities are added to `lib/capabilities.ts` `CATALOGUE` **and** to the table in `docs/specs/roles-and-invites.md` §6.2 in the same commit. `capabilities.catalogue.test.ts` compares the two.

**Sterilisation marks** (§12.2) mean sterilisation status and nothing else. Use `MARK_ORDER`, `MARK_COLOUR`, `MARK_WORD` and `markBadge` from `lib/teamPages/marks.ts`. A total that isn't a status is drawn in neutral ink `#1d1d1b` at 55% opacity.

**Migrations.** Three are planned, numbered in the order the PRs are expected to merge:
- `0031_named_areas` (PR 2.4);
- `0032_vet_settings_history` (PR 3.1);
- `0033_report_downloads` (PR 3.3a).

If they merge in another order, the later one is deleted and regenerated, as `lib/db/migrations/README.md` says. Every migration has a commented rollback and passes `migrate:check`. All three are applied to production by Claude before the publish that carries them. Production writes need Samuel to switch the session to "ask" mode first (memory `neon-writes-need-ask-mode`).

**Tests**
- CI runs, in order:
  - `pnpm --filter @workspace/db run migrate:check`;
  - `pnpm --filter @workspace/db test`;
  - `pnpm run typecheck:libs`;
  - `pnpm --filter @workspace/api-server run typecheck`;
  - `pnpm --filter @workspace/api-server test`.
- Locally, use the esbuild workaround (memory `local-vitest-esbuild`). Set:
  - `DATABASE_URL=postgres://postgres:postgres@localhost:5432/catspotter_test`;
  - `AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:9`;
  - `AI_INTEGRATIONS_OPENAI_API_KEY=ci-dummy-not-a-key`.
- The test database is shared by every file in a run and is never truncated. Tests seed rows under a per-run prefix, and assert on their own rows or on **deltas**, never on absolute island totals. `observations` is append-only, so tests can't delete them.
- **Every guard against a silent failure gets a mutation probe:** break the site on purpose, watch a named test go red, then restore it. "Tests pass" is not enough for these.
- Never run high-volume port or network loops.

**Process**
- One PR per numbered PR below. Each runs in its own worktree from fresh `origin/main` and opens as a **draft** (`gh pr create --draft`).
- Before `gh pr ready`: the affected tests run locally, the adversarial review's findings are folded in, and screenshots are taken at 390px and 1280px for any page change.
- Samuel merges.

---

## Sequencing and dependencies

```
                         ┌─► 2.1 Home ───────────────────────────────┐
2.0 Counted cats ────────┼─► 2.2 Colonies list ─► 2.3 Planner ─┐      │
                         │                                     ├─► 3.1 Vet visits ─► 3.2 Round
2.4 Named areas ─────────┤                                     │          │
2.5 Find from a photo    │   3.0 Resolver groundwork ──────────┘          │
                         └─► 3.3a Reports area, progress, health ─┬─► 3.3b Coverage, welfare
                                                                  ├─► 3.3c Vet costs (needs 3.1)
                                                                  └─► 4.1 Impact report (needs 3.1, 2.4)
```

**Wave 1 (from Tue 20, once this plan is approved):** these can run in parallel, with no file collisions between them.
- 2.0 is small and should merge first, on Tue 20 or Wed 21.
- 2.4 and 2.5 don't need 2.0.
- 3.0 touches only the resolver and the observation writer.

**Wave 2 (once 2.0 merges):** 2.1, 2.2 and 3.3a run in parallel.
- 2.3 starts once 2.2 merges, because both change `lib/teamPages/colonyPages.ts`.
- 3.3a needs 2.4 for its areas version line, but can be built against the read-only list and rebased.

**Wave 3:**
- 3.1 starts once 3.0 and 2.3 merge (it needs the price setting and `view_vet_costs` from 2.3).
- 3.2 and 3.3c follow 3.1.
- 3.3b follows 3.3a.
- 4.1 follows 3.3a and 3.1.

**What else is running.** SYC-44's 6.1, 6.2 and 7.1 change `queuePage.ts` and add the Issues section. PR 2.1 links to that section by the anchor `#issues`, so 7.1's builder must give the section `id="issues"` (agreed through SYC-44). SYC-439 (#229) changes colony creation in `teamColonies.ts`. PR 2.2 rebases on it if #229 merges first.

**Fit to 31 October (D2).** The launch plan has eight building days, from Tue 20 to the freeze on Wed 28. Phase 2 (six PRs) and 3.0, 3.1 and 3.2 fit. 3.3a–c and 4.1 are the first to slip, in D2's order. Every PR here can go live any day after 31 October without a relaunch.

## Decisions this plan makes (within the approved spec)

Each one is a choice the spec leaves open. "What the team sees" says what it means for them.

1. **Home lives at `GET /api/team/home`, and `GET /api/team` stays the Queue.** Signing in lands on Home (`TEAM_HOME` and the sign-in hand-off change). The menu's Queue item keeps its address. *What the team sees:* Home opens first, and every old Queue link and email still works.
2. **Work lists with nothing behind them stay hidden on Home.** "Ask Syros Cats to match it", "Needs an OK" and "Matched by hand" have no records or pages yet (nothing writes `sightings.status = 'awaiting_team'`; confirmation items and SYC-152 are unbuilt).
   - Home gets a counter for `awaiting_team` now, which is always 0 today. Its section shows only when the count is above 0.
   - The other two sections arrive with their own tickets: SYC-152, and a new ticket for the confirmation queue.
   - *What the team sees:* Home never offers a link to a page that doesn't exist.
3. **The menu becomes Home · Cats · Map · Queue · Colonies · Reports · People** (§3.1, folding in SYC-450).
   - "Probably sterilised" becomes "Ear clips to check" (settles SYC-365). It leaves the menu along with Colour check and Feeding sites. Home links the two lists, and Feeding sites is linked from the Colonies list and the Map.
   - Reports appears in the menu with PR 3.3a.
   - The guardian menu is unchanged.
4. **Vet visits are an observation kind, `vet_visit`, not a new table.** Observations are already append-only, dated, attributed and correctable, and kinds are a list in code, so this needs no migration.
5. **A visit's sterilisation statement is `{ sterilised: true, clinic, vetVisitId, reason }`.** Today's `sterilised` value is just `{ sterilised }` plus optional `clinic` and `reason`; the spec's "existing `{ date, costEur }`" doesn't exist in code. The date is the row's `observedAt`, as for every statement. The **cost lives only on the visit**, so there's one source for money.
6. **D8 is done by making the visit's "yes" supersede the guardian's standing "no".**
   - That one row records the yes and marks the guardian row wrong, with the reason "vet visit on 13 Aug 2026". `listGuardianChanges` already shows such rows as "overruled".
   - Undoing the visit retracts that row. A new resolver rule (PR 3.0) makes a **retraction of a superseding row** stand the row it replaced up again, for `sterilised` and `vaccinated` only, so the guardian's statement comes back.
   - *What the team sees:* undo really is undo.
7. **A statement created by a visit can only be undone through the visit.** The generic "Mark wrong" refuses rows that carry a `vetVisitId`, with the words "This came from a vet visit. Mark the visit wrong instead." Otherwise a cat page and the vet report could disagree.
8. **The standard price is an app setting, `standard_sterilisation_price_eur`, defaulting to 55.** Its changes go into `mapping_events` as a new subject kind, `vet_settings`, the "same add-only history" §10.3 asks for.
   - PR 2.3 reads it for the planner's estimate.
   - PR 3.1 adds the page that changes it.
9. **Named areas move into a `named_areas` table** (migration 0031). The first rows are seeded from today's 22 entries.
   - `areaFor` and `areaByKey` stay synchronous by reading a cache. The cache reloads after any write on this server, and at most 60 seconds later on every other server.
   - Their changes go into `mapping_events` as subject kind `named_area`.
   - `namedAreasAt(asOf)` rebuilds the list as it stood at any moment, so a report names its version and an old report never moves.
   - The public map's "Go to" list (`lib/mapTiles/areas.ts`) is a separate list, and stays untouched.
10. **"As of" means "entered by then".** A report as of time T uses only observations, sightings, cats and welfare reports with `createdAt <= T`.
    - One exception: a record **redacted** for privacy after T stays gone. Privacy beats reproducibility.
    - The method note already says figures change as records are corrected.
11. **Welfare kinds never overlap on a chart.** Every report is in exactly one kind:
    - **Litter:** any report with kittens, whatever its urgency, so kitten counts are never split;
    - **Urgent:** urgent, without kittens;
    - **Needs attention:** everything else.
12. **Charts are SVG pictures drawn by the server, with no chart script.**
    - Each chart has a `<title>` on every mark for hover, and a "Show as table" `<details>` holding the exact numbers.
    - On a phone, the table is the tap-friendly way to see the numbers.
    - A tooltip script can follow later.
13. **The coverage map is a grid of 250 m squares drawn as SVG, without map pictures.** The squares with sightings trace the island's shape, and area names are written at their centres. It uses `blurPosition`'s 250 m cells from `lib/blur.ts`, so it lines up with the public grid.
14. **"Spend split by what was done" files each visit under its main purpose:** Sterilised if ticked, else Vaccinated, else Treated, else Checked. One visit is never counted twice.
15. **"No guardian" means** no active guardian placement on the colony **and** a blank `guardianName`. A colony whose guardian has no account yet is not flagged.
16. **A visit's clinic is stored by id, from the one clinic list** (`getGuidance("en").vets`, three clinics today). Older statements that have free-text clinics are left as they are.
17. **Find from a photo takes the photo as an ordinary file upload** (`multer`, held in memory only, one file of at most 10 MB). The form therefore works with no script.
    - The daily caps use the shared limiter's UTC day, so the words say "They reset overnight", not "at midnight".
    - The candidates' reference photos are their **display** photo (`catDisplayPhoto`), never a hidden one. This also fixes SYC-303 for this route.

## Questions for Samuel (with the approval)

These change the spec's scope, so they're his.

| # | Question | Recommendation |
|---|---|---|
| Q1 | Should cat guardians get their two reports (Sterilisation progress and Colony health, for their own colonies) on 31 Oct, or on 16 Nov? | **16 Nov.** The reports land after Johnny's copy freeze (Thu 22), so their Greek and French would go live unchecked, and the reports are the third thing to slip anyway. The team gets them as soon as they're built. |
| Q2 | Should round logging be able to create a new cat for one trapped on the round that isn't in the records yet (§8.5)? | **Not at launch; 16 Nov.** A new cat needs a photo and a position, which makes it a second form. At launch, the round form can add any existing cat, and a new cat is made the usual way first. |
| Q3 | The Colonies list's Map switch, and the map layers for colonies, welfare reports and "Not looked at yet" (§6.1, §9.1): now or later? | **Later, on SYC-454.** They change the Map's script, the riskiest file in phase 1. The Colonies list and the reports show the same facts as words and tables. |

---
