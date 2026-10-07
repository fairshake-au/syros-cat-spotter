# Adversarial review: Feeding sites and colonies on the dashboard

**Target:** [docs/specs/feeding-sites-and-colonies.md](../feeding-sites-and-colonies.md) v1.0 draft (7 Oct 2026), branch `claude/syc-209-feeding-sites-spec` at `0d5d128`
**Reviewer:** adversarial pass, 7 October 2026
**Evidence used:** `docs/specs/cat-record-data-spine.md` (§6, §10.5, §10.8, §13), `docs/specs/team-access-and-welfare-queue.md` (§3.2, §3.4, §7.3, §9.3), `docs/specs/DECISIONS.md` (F2, Parts 2h, 2i, 2k, 2m, Part 3), the SYC-53 draft `docs/specs/roles-and-invites.md` on `claude/syc-53-roles-spec` at `f512083`, and live code on `origin/main` at `c5ee36c`: `lib/db/migrations/0001_data_spine_tables.sql`, `lib/db/src/schema/colonies.ts`, `lib/db/src/schema/people.ts`, `artifacts/api-server/src/lib/capabilities.ts`, `lib/teamCorrections.ts`, `lib/observations.ts`, `lib/teamCatView.ts`, `lib/teamAuth/refuse.ts`, `middlewares/requireTeam.ts`, `lib/logger.ts`, `lib/campaign.ts`, `lib/teamPages/catPages.ts`, `lib/teamPages/queuePage.ts`, `lib/welfare/alertEmail.ts`, `artifacts/cat-spotter/lib/mapTiles.ts`. PR #99 (merged 7 Oct, not open) for the dashboard patterns. Linear: SYC-209, SYC-22, SYC-51, SYC-53, SYC-67, SYC-245.

**CONFIRMED** = checked against code or a project document. **PLAUSIBLE** = judgement, not proven by an artefact.

Findings are ordered most severe first. **Blocker** = must be fixed before approval. **Major** = must be fixed before the plan. **Minor** = fix in the spec or carry into the plan.

---

## Summary

| # | Finding | Spec section | Severity | Status |
|---|---|---|---|---|
| 1 | A moved public site keeps its public code, so anyone watching sees where a harassed feeder went | §4.5, §11.1, test 5 | Blocker | CONFIRMED (spec text) |
| 2 | The capability names and guardian powers clash with the SYC-53 draft written the same week | §7.2, §7.3, §11.2, §12 | Blocker | CONFIRMED |
| 3 | Pages, counts and searches leak other colonies' sites to a guardian with a scoped role | §2.1, §2.6, §2.7, §2.8, §11.2 | Major | CONFIRMED (design gap) |
| 4 | "Cats stay blurred" is not true once a site is exact: the matching service and photos tie named cats to the bowl | §4.3 line 4, §4.6, Decision 3 | Major | CONFIRMED |
| 5 | A guardian's name can never be erased from the add-only history | §7.4, §8, §11.1 | Major | CONFIRMED |
| 6 | Consent goes stale when the guardian changes or the site changes colony | §4.3, §4.5, §7.1 | Major | CONFIRMED (spec silent) |
| 7 | Taking a cat out of a colony doesn't work as written | §2.8, §11.5 | Major | CONFIRMED |
| 8 | The tap-to-place map works under the security header, but "works on any phone browser" is not proven | §3, §11.4, test 17 | Major | PLAUSIBLE (browser behaviour), CONFIRMED (headers) |
| 9 | The migration is not "all additive" | §11.1 | Major | CONFIRMED |
| 10 | The seed list of every feeder has no safe route into the system | §11.8, Decision 11 | Major | CONFIRMED (spec silent) |
| 11 | SYC-53 puts exact feeding-site positions on volunteers' phones offline; this spec says that never happens | §3, §9 | Major | CONFIRMED |
| 12 | Going public before Syros Cats accept F2 | Decision 2, §6, §11.6 | Major | CONFIRMED |
| 13 | Smaller gaps: ordering, label checks, logs, caching, audit, wording | various | Minor | mixed |
| 14 | The 13 open decisions: agree or disagree | §13 | — | — |
| 15 | What held up | — | — | — |

---
## 1. A moved public site keeps its public code, so a watcher sees where a harassed feeder went: Blocker, CONFIRMED (spec text)

**What is wrong.** §11.1 says a site's `public_id` "stays the same if the site is later made private and public again", and test 5 requires it ("making a site public, private, public again keeps one code"). §4.5 says moving a public site makes it private until someone confirms the new spot, and then it goes public again. Put those together: the public list shows code `X` at spot A, then `X` disappears, then `X` comes back at spot B.

**Failure scenario.** A neighbour has been harassing Eleni at the Vaporia feeder. Syros Cats move the feeder 300 m round the corner to get away from him, and re-publish it so tourists can still find it. The neighbour has been saving the public list every few minutes. That costs nothing: it's one unauthenticated request with no parameters. He sees code `X` vanish from A and reappear at B. The one thing the move was for, getting away from him, is undone by the identifier. A printed QR sticker carrying `X` (§11.6) now points at the new place too. The spec's own reason for having a public code ("cannot be used to count or probe") doesn't apply, because here the code links two places together.

The same thing happens without a move. A site that goes private and later comes back with the same code tells anyone watching "this is the same feeder, quiet for a while, now back". That is a pattern of life for the feeder.

**Fix.** A site gets a **new** `public_id` whenever it is made public at a position more than a few metres from where it last stood in public, and always after it has been retired. Keep the old code(s) in a team-only list so the history can show them. An old code answers exactly like an unknown one (`feedingSpotGone`), so a sticker at the old spot no longer finds the new one. Rewrite test 5 to match: same position gives the same code; a move gives a new one, and the old code returns the "unknown" answer. Add a line to the confirmation page for any re-publish after a move: "Old QR stickers for this place will stop working. Take them down." Whether to keep the code after a plain private/public cycle with no move is a fair choice for Samuel, but the spec must say it is a choice and what it reveals.

## 2. The capability names and guardian powers clash with the SYC-53 draft: Blocker, CONFIRMED

**What is wrong.** §7.2 asks for three new capabilities: `manage_feeding_sites`, `manage_colonies` and `set_cat_colony`. §12 proposes them as a DECISIONS.md entry. The SYC-53 draft (`roles-and-invites.md` §6.2 and §6.7, on `claude/syc-53-roles-spec`), written the same week, gives different names and different rules:

| This spec | SYC-53 draft |
|---|---|
| `manage_feeding_sites` (add, edit, move, retire, bring back) | `add_feeding_site` and `edit_feeding_site`, both "placed", meaning each check is made against one colony |
| `manage_colonies` (create, guardian's name, notes, centre) | Not in the table at all |
| `set_cat_colony`, which a guardian holds for her own cats **and "unassigned cats near their sites"** (§7.3 point 4) | `assign_cat_to_colony` is **island-only** (team only). A guardian may only *propose* a cat (`propose_colony_member`), and "a cat in no colony can only be touched by island-wide holders" |
| `view_exact_location` used for sites and colony pages | `view_exact_location` described as "See exact positions of **cats**" |
| Test 12: a missing capability gets "the identical `401 not_signed_in`" | §6.4: someone signed in but not allowed gets a **403** page, because a 401 sends a guardian round a sign-in loop |

**Failure scenario.** Samuel approves both specs as written. DECISIONS.md then has two entries naming different capabilities for the same buttons, and nobody can say which wins. Worse, §7.3 point 4 hands a guardian a way to escalate. She puts an unassigned cat "near her sites" into her colony. Her scoped `view_exact_location` now covers that cat, so she sees its exact sightings. "Near" is measured with exact positions she isn't supposed to see yet. SYC-53 closed this gap on purpose by making assignment team-only, and this spec reopens it.

**Fix.** Don't name capabilities in this spec. Cite SYC-53 §6.2 as the source of truth (SYC-53 §6.7 already offers that), and turn §7.2 into "screens call these SYC-53 capabilities", matched up with that table. Drop §7.3 point 4. Drop `manage_colonies`, or get SYC-53 to add it as island-only. Cut §12 proposed entry 8. Change test 12 to "matches SYC-53's refusal rule". Until SYC-53 is approved, every capability check here is effectively "staff", which is what `can()` does today (`capabilities.ts`: `person.scopes.some(s => s.role === "staff")`), so nothing is held up.

---
