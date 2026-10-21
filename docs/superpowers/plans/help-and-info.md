# SYC-120 and SYC-504: Help & info, and reports that know the cat (implementation plan)

**Linear:**
- SYC-120 (Help & info) and SYC-504 (report knows the cat), built together.
- Also touches:
  - SYC-348 (two "desex" strings);
  - SYC-346 (Johnny's pack, copy freeze Thu 22 Oct);
  - SYC-66 (privacy page, a 404 today);
  - SYC-512 (vets outside an urgent report);
  - SYC-525 (tap counting, deferred).

**Design (approved, not reopened here):** `docs/specs/help-and-info.md` 0.2. Samuel approved it on 21 Oct 2026 ("approved, write the plan"), as recorded on SYC-120. All spec section numbers below (§) refer to it.

**Checked against:** `origin/main` at `f22ba944`. The newest migration on `origin/main` is `0034_photo_removal` (checked 21 Oct). The SYC-396 PR 3.3a session has claimed 0035; this work takes **0036**.

**Status:** **Approved by Samuel, 21 October 2026** ("approved, start step 1"). Step 1 in progress.

---

## In plain English

- **One pull request, built in three steps:**
  1. the server;
  2. the new Help & info page;
  3. the cat-aware report.
- Each step runs the affected tests before it is committed.
- The PR opens as a draft. An independent reviewer goes over the whole of it, and the fixes go in while it is still a draft. Only then is it marked ready, which runs CI once.

**What you'll need to do:**
- approve this plan;
- send Johnny his pack on Fri 23 Oct, which already happens for other strings;
- later, the usual republish, but only after I've applied the database change to production (I'll say "don't republish yet" until then).

**Target:** the PR ready for review by **Mon 26 Oct**, in time for launch on 31 Oct.

---

## How it ships: the order

| Step | What | Files (main ones) | Depends on |
|---|---|---|---|
| 0 | Strings into Johnny's pack | SYC-346 comment | spec §5 (today) |
| 1 | Server | `lib/db`, `api-server` | — |
| 2 | Help & info page and tab | `cat-spotter` (tabs, `help.tsx`, `Fold`, i18n) | — |
| 3 | Report knows the cat | `cat-spotter` (report flow, queue, cat page) | 1 (the body field), 2 (i18n keys added once) |
| 4 | Review and hand checks | whole PR | 1–3 |

- **The steps run one after another in this worktree, never at the same time.** Steps 2 and 3 both edit `lib/i18n.ts`, and two writers in one tree would collide.
- **One file for all app strings.** Step 2 adds every new app string, including step 3's `reportAboutCat` and `reportDifferentCat`, so `i18n.ts` is edited once.
- **Commit after each item, every step.** Every agent prompt says so word for word.

---

## Step 0: Johnny's pack (today, before the freeze)

- Post the spec §5 table (EN, EL and FR) on SYC-346 as "Help & info strings (SYC-120/504)", with the changed strings beside it:
  - `feedNudgeInsteadNoLink`, shortened;
  - the `LINK_OFF_PAGE` body in EL and FR;
  - `tabHelp` FR "Aide".
- These are drafts. If Johnny corrects them, the corrections land in the 28 Oct corrections PR (SYC-346), not in this PR.

---

## Step 1: Server (`lib/db`, `artifacts/api-server`)

Each item is committed on its own once its tests pass.

1.1 **Migration 0036.**
  - Add `reporterCatId: integer("reporter_cat_id")` to `welfareReportsTable` (`lib/db/src/schema/welfare.ts`), next to `catId`. No foreign key and no index (spec §4.3).
  - Run `pnpm --filter @workspace/db run generate --name report_suggested_cat`, which gives `0036_report_suggested_cat.sql`. Add the commented rollback (`-- ALTER TABLE "welfare_reports" DROP COLUMN "reporter_cat_id";`).
  - `migrate`, `migrate:check` and `pnpm --filter @workspace/db test` (the rollback test) must all pass.
  - If 0035 hasn't merged when this lands, rebase onto it and regenerate. The README's rule is that an older migration is refused, not skipped.

1.2 **Reports routes** (`routes/reports.ts`).
  - Add the `catId` field from spec §4.3 to both `DraftBody` and `SubmitBody`.
  - Add a helper `knownCatId(dbOrTx, id)` that returns the id if `cats` has that row, else null.
    - Submit calls it with `tx`, inside the existing transaction.
    - The draft route calls it with `db`.
  - **Both upserts set `reporterCatId` explicitly in their `set`, including null.**
  - `cat_id` is never set by these routes.

1.3 **`/api/go/give`** (`routes/go.ts`).
  - Same handler shape as `/go/feed`, but with no `countTap` call.
  - Add `"/api/go/give"` to the exact-path check in `middlewares/prelaunchGate.ts:105-107`. Only that exact string: no prefix or pattern.
  - Change the `LINK_OFF_PAGE` body text to spec §2.1's, in EN, EL and FR.

1.4 **OpenAPI.**
  - Add `/go/give` beside `/go/feed`.
  - Make the Help-tab description edits at `:704` and `:1279`.
  - Add `suggestedCat` to the welfare queue JSON schema.
  - Regenerate `api-zod` and `api-client-react` with the repo's codegen script.

1.5 **Team queue** (`lib/welfareQueue.ts`, `lib/teamPages/queuePage.ts`).
  - `QueueReport.suggestedCat: { id, name, photoUrl } | null`, from a second left join on `cats` aliased as the suggested cat. It takes `photoUrl` the way the team cat page does.
  - The JSON route includes it.
  - `catRow` renders the four states in spec §4.4:
    - thumbnails side by side;
    - the "Yes, it's {name}" form only when the viewer `can("change_report_state")`;
    - the name escaped with the page's existing escape helper everywhere it appears.
  - `draftCard` shows the "Sent from" line, with no buttons.

1.6 **Comments and docs** that name the Help tab (spec §2.1): `go.ts:35`, `lib/campaign.ts:2`, `docs/SPEC.md:197,315`.

**Step 1 tests:** the API part of spec §6. Run `pnpm --filter api-server test` for the touched files, plus `prelaunchGate.test.ts`, `team.tie.test.ts` and `go.test.ts`. Run `pnpm -w typecheck` if the repo has it, otherwise `tsc` in `api-server`.

---

## Step 2: The Help & info page (`artifacts/cat-spotter`)

2.1 **Tab** (`app/(tabs)/_layout.tsx`).
  - The icon changes on all three variants (spec §2).
  - `tabHelp` changes to EN "Help & info" and FR "Aide".

2.2 **`Fold`.**
  - Move it from `components/report/UrgentAdvice.tsx:30` to `components/report/Fold.tsx`, exported.
  - Add a `tone: 'urgent' | 'plain'` prop that defaults to `'urgent'`.
  - `UrgentAdvice` imports it. Its rendering must not change: `ReportAdvice.test.tsx` passes untouched.

2.3 **`app/(tabs)/help.tsx`** is rewritten as the page in spec §3.1–§3.6, in this order:
  1. the urgent card;
  2. `VetList` (full), fed by `useWelfareGuidance()`;
  3. two plain folds;
  4. Contact;
  5. Privacy;
  6. Giving.

  **Giving is a pure function in `lib/helpGiving.ts`,** `givingState({ online, campaign, campaignStatus, donateHost }) → 'campaign' | 'link' | 'none'`, so its rules can be tested without rendering.
  - The campaign card keeps today's amount chips and Donate logic (`openDonate`, `safeDonateUrl`), moved into a component `components/help/CampaignCard.tsx` with no hero.
  - The link card opens `${apiOrigin()}/api/go/give`.

  **Contact is a pure helper `lib/contactMail.ts`,** `contactMailto(lang, version, platform)`, which uses `encodeURIComponent`.

2.4 **Strings** (`lib/i18n.ts`).
  - Add every key in spec §5, in EN, EL and FR, including `reportAboutCat` and `reportDifferentCat` for step 3.
  - Shorten `feedNudgeInsteadNoLink`.
  - Change `howStepDontFeedBody` and `howStepHelpBody` (EN) from desex to sterilise.
  - Remove `campaignNotOpenYet`, `campaignOffline` and `campaignError` once nothing uses them.
  - `i18n.test.ts` must pass.

2.5 **Renames and allowlists.**
  - Rename the FeedNudge and WaitingCard tests, and update their no-link copy assertion.
  - Update the comment at `FeedNudge.tsx:15`.
  - Remove `help.tsx` from `lib/__tests__/notifyUsage.test.ts`'s allowlist if the rewrite no longer uses a local `notifyError`. Otherwise keep it there.

**Step 2 tests:**
- `HelpInfoScreen.test.tsx`, `helpGiving.test.ts`, `contactMail.test.ts` and `Fold.test.tsx` (spec §6);
- the full `pnpm --filter cat-spotter test`;
- `typecheck`.

---

## Step 3: The report knows the cat (`artifacts/cat-spotter`)

3.1 **Handoff.**
  - `ReportHandoff.cat?: { id: number; name: string; photoUrl: string | null }` in `lib/reportHandoff.ts`.
  - `NeedsHelpLink` gains a `cat` prop.
  - `app/cat/[id].tsx:285` passes the cat.
  - `ReportIssueSheet.goToNeedsHelp` passes `{ id: catId, name: catName, photoUrl: null }`.

3.2 **Flow** (`lib/reportFlow.ts`).
  - `startFlow` keeps the handoff's cat in the state.
  - A `clearCat` action sets it to none.
  - Back and forward keep it.

3.3 **Where screen** (`components/report/ReportWizard.tsx`).
  - The strip goes at the top of Where only: a thumbnail (falling back to the paw placeholder), "About {name}", and the "It's a different cat" link.
  - Nothing changes on the other screens.

3.4 **Queue and draft.**
  - `newPendingReport` and `isPendingReport` (`lib/reportQueue.ts`) gain `catId`. On reading back, a stored value that isn't a positive integer becomes none.
  - The submit body (`ReportQueueContext.tsx:103`) sends `catId` as a number, or `null`.
  - The draft (`app/report.tsx:149-158` and `ReportQueueContext.tsx:309-323`) includes `catId`, and it counts towards whether the draft has changed.

**Step 3 tests:**
- the step 3 part of spec §6;
- the full app suite;
- `typecheck`.

---

## Step 4: Review, hand checks, ready

1. **Draft PR first.** Push the branch and open the PR as a draft (`gh pr create --draft`), linking SYC-120 and SYC-504.
2. **Independent adversarial review** of the whole diff against the spec, in its own worktree (LIF-79).
3. **Fold the findings in** while it is still a draft, re-running the named tests myself rather than trusting an agent's "tests pass".
4. **Hand checks** (spec §6 "By hand"), in the browser pane against a local API and a scratch database:
   - Help & info at 390px and desktop, light and dark, in EN, EL and FR;
   - Where's the cat? with the strip at 390×844;
   - a report from a cat's page, seen on the local queue and tied with Yes.

   Screenshots go in the PR description.
5. **Then `gh pr ready` once**, and wait for a CI run that succeeds. A check skipped while it was a draft doesn't count.

---

## Every place the guards must hold

These are the changes that could fail **silently**: they would give a wrong-but-successful result. Each one gets a mutation probe: break it on purpose, watch a named test go red, then restore it. The tree is committed before each probe, so the probe's `git checkout` can't wipe anything.

| Guard | Where it must hold | Probe |
|---|---|---|
| `/api/go/give` passes the gate, and only by exact path | `prelaunchGate.ts` exact list | Remove it from the list: the "passes with no cookie" test must fail. Change it to a `startsWith`: the `/api/go/givex` test must fail. |
| A cleared cat overwrites the draft's suggestion | Both upserts' `set` in `reports.ts` (draft and submit) | Drop `reporterCatId` from the submit `set`: the "draft with cat, then submit null" test must fail. Repeat for the draft `set`. |
| Public routes never set `cat_id` | Both report routes | Set `catId` in the insert: the "leaves `cat_id` null" test must fail. |
| `/go/give` counts nothing | `go.ts` | Add `countTap`: the "nothing written to `donation_link_taps`" test must fail. |
| The Yes form only for `change_report_state` | `catRow` | Render it unconditionally: the capability test must fail. |
| The cat's name is escaped | Every place `suggestedCat.name` is rendered: the line, the button, the draft card | Remove the escape at each one: the `<script>` test must fail at each. |
| Mail has no device ID | `contactMail.ts` | Add `deviceId` to the body: the test must fail. |
| "Be the first to chip in!" shows only in state A | `CampaignCard` and the giving section | Render it in state B: the test must fail. |

**Consumers of the new field `reporter_cat_id` / `suggestedCat`**, listed so none is missed:
1. the submit route;
2. the draft route;
3. `welfareQueue.ts` (list and single-report loaders);
4. the queue JSON route;
5. `catRow`;
6. `draftCard`;
7. the OpenAPI schema and the generated clients.

**Not consumers:**
- the alert email, by design (spec §4.3);
- `welfareTie.ts`, which is unchanged;
- data deletion: SYC-63's device delete clears `reporter_device`. The suggestion is a public cat id, not personal data, so it stays.

---

## What works with no signal, precisely

| Part | Without signal |
|---|---|
| A cat needs help | Works. The report is saved on the phone (in the browser on the website) and sent later. |
| Vets | Show, from the built-in copy. Call buttons work. Map buttons open the map app, which may have no tiles. |
| How it works | Works (static text). |
| Contact us | Opens the email app. Sending is the email app's job. The address can be copied. |
| Privacy policy | Says "Needs an internet connection". Delete my data behaves as it does today. |
| Giving | Shows the link card from saved settings, with "Needs an internet connection" on the button; or nothing. |
| The report's cat strip | Shows the name. The photo falls back to the paw. |

---

## What this plan does not do

- Publish the privacy page (SYC-66).
- Count Help & info taps (SYC-525).
- Add a FAQ (SYC-526).
- Change the alert email or the tie route.
- Republish. That's Samuel's, after migration 0036 is applied to production.

---

## Rollout (after merge)

1. **Apply 0036 to production Neon** with the repo's migrate path (`db-ops`, `docs/runbooks/neon-database.md`), then `verify-history`. Until it's done: "don't republish yet". Neon writes need ask mode, so I'll ask Samuel to switch the session if auto mode blocks it.
2. **Samuel pulls main in Replit and republishes** (the replit-publish skill).
3. **Checks:**
   1. `/api/healthz` shows the new commit.
   2. `curl -sI` on `/api/go/give` with no cookie gives a **302**.
   3. Help & info renders on the test site.
4. **One test report from a cat's page, tied on the team queue.** I give a heads-up before this, because it creates a test report.

---

## Model delegation

The session runs on Opus. Building goes to Sonnet: the specs are clear and the code is standard. Review stays on Opus, and the plain copy edits go to Haiku.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Step 0: Johnny's pack comment | Session (Opus) | Copying out the spec §5 table | Samuel reads the SYC-346 comment |
| Step 1: server (1.1–1.5) | Sonnet | Clear spec and existing patterns (upserts, gate list, `catRow`) | Tests and typecheck; **mutation probes on every silent guard above**; Opus spot review of the diff; the adversarial review in step 4 |
| Steps 1.6 and 2.5: comments, docs, test renames | Haiku | Mechanical text edits at named lines | Typecheck and the full suites; diff spot review |
| Step 2: Help & info page, `Fold`, strings | Sonnet | A standard screen built from existing parts | Tests and typecheck; mutation probes (chip-in, mail); hand checks at 390px and desktop by the session |
| Step 3: report knows the cat | Sonnet | Threading one field through known files | Tests and typecheck; the "survives Back" and "clear then draft" tests; an end-to-end probe against a local API |
| Step 4: adversarial review of the whole PR | Opus | Finding subtle cross-file and privacy mistakes needs judgment above Sonnet's | Findings are checked against code before they're folded in; the named tests re-run by the session |
| Hand checks, integration, rollout | Session (Opus) | Judgment on screens, and production writes | Screenshots in the PR; healthz and curl probes |

**Rules every agent prompt carries word for word:**
- "Commit after each item. Never hold work only in memory. Write a checkpoint note (done / next) to `docs/superpowers/plans/help-and-info.progress.md` after each commit."
- "Work only in `/Users/samuelporter/Projects/syros-cat-spotter/.claude/worktrees/help-icon-confusion-4bcddc`. Confirm `pwd` before the first write."
- "Do not spawn sub-agents."
- "Use the local vitest/esbuild workaround (`ESBUILD_BINARY_PATH`) if esbuild fails to start."
- "Commit before any mutation probe; restore with `git checkout` after."

---

## Linear

- SYC-120 and SYC-504 move to **In Progress** when step 1 starts, and to **Done** when the PR merges, with the PR noted.
- SYC-348: a comment saying which two strings this PR fixes.
- SYC-512: a comment saying the vets item is answered by this PR.
- SYC-346: step 0's comment.
- Anything deferred in review is filed as a new ticket.

---

## Still needs Samuel

1. Approve this plan.
2. Send Johnny's pack on Fri 23 Oct (already planned for SYC-346).
3. After merge: switch the session to ask mode if the production migration needs it, then pull main in Replit and republish once I say the migration is in.
