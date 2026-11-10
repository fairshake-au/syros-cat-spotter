# Syros Cat Spotter — project instructions

Linear team: SYC. Charity app for Syros Cats.

## Canonical facts (corrected repeatedly — never contradict these)

Added 2026-08-29 from retro: each of these was corrected by Samuel at least once, some twice. Check here before writing spec/copy.

- Sterilisation cost: **€50–60 per cat** (never €25).
- Terminology: **"cat guardian"**, not "colony carer". Role word: **"spotter"** only, never "snapper" (Samuel, 12 Oct 2026).
- The spec is **aspirational**: never distinguish "built today" vs "proposed" in spec/proposal documents — describe the whole product as one vision.
- The two audiences (locals/guardians and tourists) have **complementary** needs, not opposite ones.
- Do not claim the app "all works with no signal" — offline support is partial; be precise about what works offline.
- Mapping the island is NOT exclusive to BL families — don't frame it that way.

## Working rules

Added 27 Oct 2026 from the project retrospective (Samuel chose each one):

- **Ask Syros Cats before the spec, not after the build.** When a feature depends on how Syros Cats work (trapping, vet visits, funding requests, records, feeding), first write 3–5 plain questions for Samuel to send Jacky or Susan. The spec waits for their answers. Answers go into the Syros Cats fact sheet (SYC-761, `docs/syros-cats-facts.md` once it exists), and every such spec quotes it. Rework from guessing: the trapping round form, the sterilisation-request premise, records import, coat colours.
- **Post-launch hold, 1–14 Nov 2026:** bug fixes (safety wording included), small polish, and the follow-up and real-phone tidy (SYC-762) only. No new features unless Samuel says so for that feature. What gets built next is judged against the launch success measures (SYC-760).
- **At most 5 builder sessions at once.** A builder session is one that edits and commits code; reviewers and read-only sessions don't count. Three shared areas have one owner session at a time:
  - the translation files: `artifacts/cat-spotter/lib/i18n.ts` and `artifacts/api-server/src/lib/teamPages/strings/*.ts`
  - dashboard layout: `artifacts/api-server/src/lib/teamPages/layout.ts`
  - database migrations

  The session that started the wave (usually /next) names the owners in each brief. If no owner is named, ask Samuel before editing those files. For migrations, follow `lib/db/migrations/README.md`: generate on fresh `origin/main`, and if another migration merges first, delete yours and regenerate. The coordinator decides the order migrations merge in, not their numbers.
- **Main requires the "Test and build" check** (branch protection since 27 Oct 2026, admins included). For a PR that only changes documents, the "What changed" job skips it, and a skipped check counts as passing. A docs-only PR branched before 27 Oct needs main merged in first, or the check never reports. GitHub also treats a draft's skipped run as passing, so protection won't stop a draft merge. Never merge a draft: mark it ready and wait for a real pass.

- **New packages: latest stable version, advisories checked first** (SYC-768, 1 Nov 2026). When a plan or an agent adds a dependency, use the latest stable major version unless the plan gives a written reason not to. Before pinning it, check its advisories (`pnpm audit` after adding it, or the package's GitHub security tab). A critical advisory fails CI and blocks Replit's publish (SYC-746), and the nightly `security-nightly` workflow fails if one appears on main later (GitHub emails whoever last changed its cron line).
- Verify any generated PDF/document renders correctly (margins, backgrounds) BEFORE handing over — Samuel caught a white-border bug that should have been caught in preview.
- Standard pipeline applies (spec → adversarial review → approval → plan → implement).
- **Open every PR as a draft** (`gh pr create --draft`); CI skips drafts (16 Oct 2026, to save Actions minutes). Run the affected tests locally before pushing, fold in review fixes while it's a draft, then `gh pr ready` once — that runs CI. A skipped check (left over from the draft) is not a pass: wait for a run that succeeded. If CI fails after ready, `gh pr ready --undo`, fix it as a draft, and mark it ready again. A stacked PR stays a draft until the PR below it merges, so rebasing a stack doesn't re-run every PR in it.
- **Test cat names: letters only, never random hex or `Date.now()`** (26 Oct 2026, SYC-709). A name a test sends through a public naming route (spotter naming, a new cat's name on resolve, an owner's rename) is refused if it holds 5 digits in a row or looks like a phone number. A hex tag sometimes does, so the test fails at random (main went red twice after #348). Spell tags in letters (`[...randomBytes(4)].map((b) => "bcdfghjkmpqrvwxz"[b % 16]).join("")`). Where a tag must be unique within a run, use a counter spelt in letters, not a short random one: 2 random letters repeated across 9 cases.

## Code map (graphify)

Added 10 Nov 2026 (Samuel: "make it automatic"). Setup and what it sends where: `docs/graphify.md`.

- Each checkout has a code map at `graphify-out/` (ignored by git). When a session starts, a hook builds it in the background (offline, code only, about a minute), or refreshes it if the code has changed since; `graphify-out/build.log` shows progress.
- When `graphify-out/graph.json` exists, use `graphify explain "<file or symbol>"`, `graphify path "<A>" "<B>"` or `graphify query "<question>"` to find where something lives and what touches it, then read only the lines it points to. Results can be noisy (a query may surface unrelated parts first), so grep for exact text once you know the files. Put this rule in any subagent prompt that explores code.
- `graphify-out/GRAPH_REPORT.md` is long (about 18k tokens). Read only its top sections (most-connected parts, import loops) for an overview.
- After changing code, `graphify update .` refreshes the map (offline, no cost).
- Where graphify isn't installed (Replit, cloud sessions) the hooks do nothing; carry on as usual.
