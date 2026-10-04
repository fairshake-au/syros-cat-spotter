/**
 * Decision Q2 (plan `docs/superpowers/plans/data-spine.md`, "Decisions for
 * Samuel"; `DECISIONS.md` cross-reference via the plan's §4.5/C6): "Should
 * 'Probably sterilised' show publicly before Syros Cats can correct it?"
 * Decided A — collect the ear-tip answers now (once PR 7 ships them), but
 * show *Likely* publicly only once all three of these are true:
 *
 *   1. PR 8's correction endpoints are live in production;
 *   2. the workspace hand-off (SYC-103) lets staff actually reach the
 *      dashboard; and
 *   3. a SYC-43 screen exists for staff to use PR 8's endpoints from.
 *
 * Until then "the public sees 'Not known yet'. Nothing is lost: the
 * answers are stored, and those cats update the day the correction screen
 * arrives."
 *
 * **No ear-tip observations exist yet** — PR 7 (the question that writes
 * them) isn't built in this PR either, so `resolveSterilised` can't return
 * `confidence: "likely"` from real traffic today regardless of this flag.
 * This gate is written now, defensively, so PR 7/PR 8 don't have to
 * remember it later, and so a test seeding an `ear_tip` observation directly
 * (as this PR's own tests do, ahead of PR 7) proves the public line never
 * shows *Likely* early.
 *
 * **Deliberately a manual constant, not a live check** (unlike `pr3Gate.ts`):
 * there is no single row in any database that means "SYC-103 works and a
 * SYC-43 screen exists" — those are an infrastructure hand-off and a UI
 * screen, not a migration. Flipping this to `true` is a one-line PR once all
 * three conditions are actually true in production; filed as a reminder on
 * SYC-43 (the screen) so it isn't forgotten. See the PR body for the Linear
 * ticket.
 */
export const LIKELY_STERILISED_PUBLIC_LIVE = false;
