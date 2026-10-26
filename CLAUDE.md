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

- Verify any generated PDF/document renders correctly (margins, backgrounds) BEFORE handing over — Samuel caught a white-border bug that should have been caught in preview.
- Standard pipeline applies (spec → adversarial review → approval → plan → implement).
- **Open every PR as a draft** (`gh pr create --draft`); CI skips drafts (16 Oct 2026, to save Actions minutes). Run the affected tests locally before pushing, fold in review fixes while it's a draft, then `gh pr ready` once — that runs CI. A skipped check (left over from the draft) is not a pass: wait for a run that succeeded. If CI fails after ready, `gh pr ready --undo`, fix it as a draft, and mark it ready again. A stacked PR stays a draft until the PR below it merges, so rebasing a stack doesn't re-run every PR in it.
- **Test cat names: letters only, never random hex or `Date.now()`** (26 Oct 2026, SYC-709). A name a test sends through a public naming route (spotter naming, a new cat's name on resolve, an owner's rename) is refused if it holds 5 digits in a row or looks like a phone number. A hex tag sometimes does, so the test fails at random (main went red twice after #348). Spell tags in letters (`[...randomBytes(4)].map((b) => "bcdfghjkmpqrvwxz"[b % 16]).join("")`). Where a tag must be unique within a run, use a counter spelt in letters, not a short random one: 2 random letters repeated across 9 cases.
