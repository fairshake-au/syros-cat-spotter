# Adversarial review: team cat page redesign (docs/specs/team-cat-page-redesign.md)
Paths below are relative to artifacts/api-server/src. Line numbers are from this checkout. I did not read the full text of team-dashboard-redesign.md 7 and 12 (only grepped it), and I read the mockup only by grep.

## PART A - Findings

### A1 HIGH - "Remove owner" and all owner/home information vanish
- Doc: 3.2 lists the Update menu as 5 items (lives, sterilised, coat, colony, rename). Facts panel (3.1) and History have no owner row.
- Code: `Remove owner` form is drawn today (lib/teamPages/catPages.ts:674), gated on may("remove_owner") && may("set_life_status"), with a dead-cat variant ("Still no longer with us"). The "Owner" block shows has owner / orphaned home / home note / home pin (catPages.ts:1019-1041). The home pin is gated by `view_exact_location` in the view (lib/teamCatView.ts, owner doc comment). History also shows an "owner's own claim - use Remove owner" hint (catPages.ts:396). The life-status form's "this cat has an owner, saving anything but Has a home asks first" hint (catPages.ts ~646) is also unaccounted for.
- Risk: the only way to end an owner's claim disappears, and "Has a home" in Lives gives the team no way to tell owned from guardian-homed. Spec says "Everything else stays" but does not say where this goes.
- Fix: add "Remove owner" to the Update list (conditional, same gates, "Are you sure?" kept) and an Owner fact row/fold (has owner, home note, pin only for view_exact_location). Keep the owner-claim hint on the owner's history row.

### A2 HIGH - Coat/markings: per-statement Mark wrong, "counts", disagreement warnings are lost or moved to a place that cannot host them
- Doc: 3.5 says a coat "change" row has "Mark wrong" in its menu; 3.7 says the folded section shows coat words plus two buttons and "the full list of past coat changes is in History".
- Code: History's wrongForm returns "" for `appearance` corrections (catPages.ts:288, 301). Coat/markings Mark wrong exists only in the Appearance section's statement list, shown only when `s.markable` and set_appearance (lib/teamPages/appearancePage.ts statementItem, ~262-287). TeamStatement has no `markable`/`counts` flag, so a History row cannot know which coat statement may be marked wrong or which still "counts". Also dropped by the spec: the per-part confidence (recordsSay), the guardianDisagrees warning (kindBlock), the Confirm for markings (the spec offers "markings are right" only in the open fold), photo thumbnail on a machine reading, "prompted" and "agrees with" extras.
- Also: 3.7 folds the section by default, but the post-save notice (`appearanceNotice(done)`), the redrawn coat figure (DRAWN_AFTER) and the "worth a second look" reasons all render inside it. A save then lands on a closed fold with its notice hidden. The Colour check queue links to `/api/team/cats/:id#appearance` (appearancePage.ts ~357) so it also lands on a closed fold.
- Fix: say where per-statement coat/markings Mark wrong lives (either carry `markable`/`counts` into the history row via TeamAppearanceStatement id, or keep the statement list inside the opened fold). Auto-open the fold when `done` is an appearance key, when there are check reasons, when guardianDisagrees, or when the URL fragment is #appearance. Keep the guardian-disagrees warning visible while folded.

### A3 HIGH - "Health note" and "Add a note" have no capability or kind defined, and the existing kinds don't fit
- Doc: 3.1 "Health note ... (team only)"; 3.2 "Add a note ... team-only note"; 2 "no new team powers except Add a note and Health note". No capability is named.
- Code: three exist and they differ. lib/capabilities.ts:58 `view_health_notes` (placed, EVERYONE: guardians too), :80 `add_health_note` (placed, EVERYONE), :81 `add_team_note` (island, TEAM). Observation kind `team_note` ("a team-only health note", lib/observations.ts:40,58) is separate from kind `note` (the owner/public "note", which the History describes as `Note: "..."`, lib/teamCatView.ts:211). `describeStatement` has no `team_note` case, so a team note would print as `A "team_note" statement` (default branch).
- Risk: team-only text shown to a guardian (she holds the placed capabilities), or owner notes (home details, e.g. me.delete test writes "I live at number 4" as a `note`) shown as the "newest note" Health note. The spec's "newest note counts" rule must say which kind.
- Fix: name the kind (`team_note`), the view gate (`view_health_notes` vs `add_team_note`), and the add gate; add the `team_note` case to describeStatement; make sure `note` (owner) is never the Health note.

### A4 MEDIUM - Sterilised wording claimed "already shipped" does not match the code
- Doc: 3.1 table lists "Probably, checked in person by the cat guardian" and "Not known yet" as the shipped values "keeping their wording exactly".
- Code: lib/teamPages/catFacts.ts:16-17 says the "checked in person by the cat guardian" value is not shown yet because nothing records it (SYC-400). The unknown case in the facts is "Not known" (catFacts.ts:64), not "Not known yet" (that is sterilisedText for the evidence block, catPages.ts ~110, and the public line). The table's "Not known yet" is therefore a change, not a keep.
- Fix: drop the guardian-check example (or mark it as depending on SYC-400) and say which unknown wording wins; check test pins in lib/teamPages/catFacts.test.ts before changing.

### A5 MEDIUM - "Vet visit as one row" needs a join the data does not offer; "nothing listed twice" is not achievable as written
- Doc: 3.5 vet visit = one row (from the visit list); 3.5 "nothing listed twice".
- Code: a visit writes a `vet_visit` observation plus `sterilised`/`vaccinated` observations carrying `value.vetVisitId` (lib/vetVisits.ts:168-214; teamCatView.ts:361). All appear in `history` as separate TeamStatements; `TeamStatement` has no `vetVisitId` (only `sightingId`, teamCatView.ts:319). VisitLine comes from `visitsFor` (a separate query), with `visitId` = the vet_visit observation id. So History would show the VisitLine row AND the vet_visit, sterilised, vaccinated rows unless the builder dedupes by id and by reading `value.vetVisitId`, which the view does not expose. Also `describeStatement` words `vet_visit` ("Vet visit: sterilised") a second time.
- Fix: say that statements that came from a visit are folded into the visit row, and add `vetVisitId` to TeamStatement. Say what an undone visit shows (crossed-out row, with its reason).

### A6 MEDIUM - Evidence links, filters and the 20-row cutoff collide
- Doc: 3.1 each "Why we think so" item links "to its row in History"; 3.5 filters via `?show=...`, "newest 20 then Show all".
- Code: today `statementHref` falls back to `?history=all#s-id` when the target is beyond the 20 (catPages.ts:143), `evidenceIds` auto-open routine runs (catPages.ts ~1097), and `?history=all` is read in routes/teamCats.ts:556. Redirects after saves use `at`. With a `?show=sightings` filter, evidence rows (changes/notes) are not rendered, so the links go nowhere. With sighting rows joined by sightingId, the anchor `#s-<statementId>` no longer exists for a statement folded into a sighting row.
- Fix: say that evidence links drop the filter and show all (`?show=all` plus keep `?history=all` as an alias since existing links and emails may use it), and say which anchor ids survive (statement ids inside joined sighting rows; evidence inside routine runs still auto-opens).

### A7 MEDIUM - Post-save notices, landing, and re-fill after sign-in are not covered
- Doc: silent.
- Code: `done` messages are placed by key: TOP_DONE at the top, VISIT_DONE beside Vet visits, `at` beside the statement, PHOTO_DONE beside the photo, the rest at the top of "Update this cat" (catPages.ts:404-434, 1065-1076). `kept` (SYC-516 C3) re-opens the exact form via `fold(kept !== undefined)` and `catPageFormKeys` lists `name:`, `life:`, `sterilised:` and `wrong:<id>` (catPages.ts:462-475, 289-). Spec moves forms inside "Update this cat ▾" and Mark wrong inside each row's "⋯" menu (a nested `<details>`).
- Risk: a save lands with the notice inside a closed menu; a refilled form is hidden in two closed folds; the "sign in again" line (`keptLine`) points at nothing. Also the colony form's "Take out of this colony" button (colonyForm, catPages.ts ~590) is not in the new Update list.
- Fix: require that Update ▾, the target ⋯ menu and the target form open when `kept`, `at`, or a form-related `done` is present, and that notices render outside closed folds. Keep "Take out of this colony" (risky, red) under Change the colony.

### A8 MEDIUM - Report strip shrinks and "closed reports appear only in History" is unsupported
- Doc: 3.1 amber box with "1 open report"; "Closed reports appear only in History".
- Code: the strip lists reports with state (New/Looking at it/Done/Nothing needed), a "Photo hidden" tag and "N other open reports like it", plus "showing newest X of Y" (catPages.ts:516-541), supplied by `issueStripFor`, null without view_welfare_queue. These are IssueReports from lib/issues/queue, not observations, so they are not in `v.history` (History holds `welfare_report`/`welfare_outcome` statements only). Closed issue reports would disappear from the page.
- Fix: either keep a compact list (open first, closed folded) or add issue reports as History rows; keep the view_welfare_queue gate. Link to the specific row (`/api/team?open=<id>#r-<id>`) not just "the queue".

### A9 MEDIUM - History row types are incomplete
- Doc 3.5 lists sighting, vet visit, change, note. Code also has: `welfare_report` and `welfare_outcome` rows, "Moved to / Moved here from another cat" (movedTo/movedFrom), "Corrects #n", reason text ("Why:"), "about <date>" when observed differs from recorded, "Eleni, cat guardian" attribution, "See the photo" for statement photos, withdrawn-owner wording, `retracted` "Marked wrong" rows, and the dead-cat "How we know" (catPages.ts:157-405; teamCatView.ts:100-280). The spec also removes `#id` so "Corrects #n" and "Replaced by #n" need new wording that still links.
- Also: a sighting row that joins statements: grouping rule is unclear when one sighting has both routine (food and water out) and non-routine (clipped ear) statements; `isRoutine` works per statement (catPages.ts ~713), but `runWords` counts by sighting. The filter counts "Sightings 17" vs `v.sightings` (all, including photo-only sightings with no statement) vs routine grouping must agree.
- Fix: list the row types and say "same as today" for the ones not redesigned; define the mixed-sighting rule (a sighting with any non-routine statement stays its own row).

### A10 MEDIUM - Notices and facts shown today with no place in the design
- guardianMarkNotice (catPages.ts:217), deathNotice (235, with "how we know" and the Mark wrong pointer), "Not seen since..." and presumed-deceased note (catPages.ts ~989-1003), "Clipped ear: seen in N sightings", "Confirmed by Eleni, cat guardian ... This is wrong?" (guardianConfirmed, 195), colony `wasName` ("was ..."), first recorded where/when (1046-1052), cat.description (`<p>${cat.description}</p>` in the summary), "Hidden main photo" explanation (the main-photo-hidden note), "The map isn't available" fallback.
- Fix: map each one in the spec (most are one-liners that belong in the status line, Why-we-think-so, or the notice area).

### A11 MEDIUM - Photo Hide: spec describes a reason form and confirmation that do not exist today
- Doc: 3.6 "Hide from the public..." then "today's reason form and confirmation"; section 7 "keeps its reason form and confirmation".
- Code: galleryItem posts only `cat` with no reason field, "one tap, no are you sure" (catPages.ts:547-585, comment "(3.3)"); routes/teamPhotos.ts:28-35 takes an optional reason with no confirm page. Restore is likewise one tap.
- Impact: if the builder follows the doc they invent a new reason form and confirm route; if they follow the code, the "risky action harder to trigger" goal is just one extra tap (the menu). Decide which. Also the landing param (`p=`/`photo` and `#p-id`) must still work inside a ⋯ menu.
- Fix: say explicitly "add a confirm page (new)" or "no confirm, menu only".

### A12 LOW - Small data claims to correct
- "Set by Maria, 14 Oct" assumes the author is a person; `author` can be spotter/system/deleted ("a spotter", "imported", "someone who has since deleted..."), so the line needs wording for those. Resolver gives only `supportingStatementIds[0]` for lifeStatus, which must be found in `history`.
- "Seen 21 times since April" and "on our records since 3 Apr" are derivable (v.sightings count/oldest; cat.createdAt) but "Seen N times" counts only resolved sightings; and "records since" is the cat record's createdAt, not first sighting. Fine, but state it.
- 3.3 says markers with a range ("2-4") for repeated spots and "centred on sightings" (SYC-459): needs map.ts changes; MAP_SIGHTINGS caps at 30 (catPages.ts:793), and then the caption count must be "newest 30 of N".
- Mockup uses `<a href="#">` for Mark wrong; the real thing is a form with reason (and choice/date for lives). The "one tap further" is really tap menu, tap summary, fill reason, submit.
- Place labels: `placeLabel(s)` already exists (catFacts.ts, areas/placeLabel); the statement that SYC-447 is "not built" is fine, but the doc should not imply an unbuilt label.

### Checked and fine
- No-JS: all controls proposed are `<details>`/links/forms; sticky jump bar is CSS only. Costs: doc says "for people who may see costs" and code gates via `view_vet_costs` (routes/teamCats.ts:541; visitItem `"costEur" in l`), consistent. Hidden-photo who/when exists (`TeamPhoto.hidden.by/at`).

## PART B - Builder questions (ranked)
1. Health note / Add a note: which observation kind (`team_note` vs `note`) and which capabilities (`add_team_note` TEAM vs `add_health_note` placed; `view_health_notes` placed)? Can a cat guardian see or add them? Changes the route, the view payload and a privacy risk.
2. Where do Remove owner and the Owner/home info (note, pin) go? Changes the Update list, the facts panel, and the view_exact_location gating.
3. Coat/markings Mark wrong: per-statement in the fold or on History rows? If on rows, TeamStatement needs `markable` and `counts` and a link to the appearance statement.
4. Does Hide from the public gain a confirm step/reason field (new route behaviour), or stay one tap behind a menu?
5. How are visit-written statements folded into the visit row: expose `vetVisitId` on TeamStatement, and what does an undone visit look like?
6. What do closed issue reports become: kept in a compact list or added to History (they aren't observations)?
7. Evidence links with filters/cutoff: is `?show=all` forced on those links, and is `?history=all` kept as an alias?
8. Sterilised unknown wording ("Not known" vs "Not known yet") and the guardian-checked value: change or keep?
