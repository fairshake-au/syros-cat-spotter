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
 * Deliberately a manual constant, not a live check (unlike `pr3Gate.ts`):
 * no database row means "SYC-103 works and a SYC-43 screen exists".
 *
 * **Flipped to `true` by SYC-75 (15 Oct 2026).** All three conditions were
 * checked against production build f03901a: PR 8's correction routes and
 * PR 4's "Probably sterilised" list (`/api/team/likely`) answer 401, not
 * 404; SYC-103 is Done; SYC-43 part 2 PR 4 (#99) is the screen. Merged only
 * after Samuel confirmed the Syros Cats team has seen the list. The constant
 * stays so the switch can be thrown back in one line if the team can't keep
 * up with corrections.
 */
export const LIKELY_STERILISED_PUBLIC_LIVE = true;
