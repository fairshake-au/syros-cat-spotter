# Adversarial review: a cat guardian with no colony starts her first one (SYC-439)

**Date:** 17 October 2026 · **Reviewer:** independent Opus subagent · **Spec:** `docs/specs/roles-and-invites-first-colony.md` (draft 17 Oct), checked against the code on branch `claude/syc-439-first-colony` (commit 223081c7).

**Scope:** Samuel has already decided "yes, let her start one", so this review only looks at how it is done. All line numbers below are from this tree.

**How each finding was handled** is in the table at the end (added by the spec's author when folding the findings in).

---

## What I checked and found safe (fail-closed, verified in code)

A row with role `guardian`, no colony and reach `start` does not make anyone island-wide in any reader I could find:

- **`isIslandRow`** (`capabilities.ts:130-136`) needs a team or management role. **`isColonyRow`** (`:139-147`) needs a colony number. So `can`, `canSomewhere`, `mayEnter`, `capabilitiesOf`, `holdsIslandRow` and `actingRole` all grant her nothing today. The existing test at `capabilities.test.ts:122-134` already pins a guardian row with no colony to "nothing".
- **The colonies filter.** `visibleColonyIds` gives `[]` (`guardianView.ts:43-51`). From there `colonyFilter` gives SQL `false`, `covers` gives false, `seesAny` gives false, and `nameLabeller` names everyone "Syros Cats" (`:113-129`).
- **SQL readers.** None treats `colony_id IS NULL` as "island" without also checking the role. Management locks and counts use `role = 'management'`. `stopHelping` filters on team roles (`people/actions.ts:330-337`). `myColonies` inner-joins on colonies (`people.ts:2087-2101`). `placementsOf` drops rows with no colony (`:928-930`). The create check is based on role (`people.ts:2018-2020`).
- **Sign-in.** The sign-in Worker's old request shape still says no to her (`internal.ts:102-110`), and the workspace door stays shut. After the hand-off she would land on My colonies (`team.ts:166-169`, `refuse.ts:109`).
- **Name-clash rollback.** `createColonyAs` catches the clash outside `db.transaction` (`lib/teamColonies.ts:425-441`), so a clash rolls back cleanly.
- **Unchecked:** the sign-in Worker's source is not in this repo. It only reads `doors.dashboard` from `internal.ts`.

Decision A (a third kind of reach, "starting") is the right choice. The findings below are about the parts the spec leaves open.

---

## Findings

### F1 · Major · "Starting" will be guessed from a missing colony, because nothing carries the reach

**Evidence.**
- `scopeRow` works out the reach from the role alone (`people.ts:160-171`): a guardian always gets `colony`.
- `PlacementInput` and `Placement` have no reach field (`:418-431`).
- `heldRows` (`:607-622`), `heldInForce` (`:760-765`), `peopleScreen`/`ScreenPerson` (`:2128-2138`, `:139-145`) and `listPeople` don't read `reach` at all.
- Today `checkPlacements` refuses a guardian with no colony: "A cat guardian needs a colony." (`:453-456`).

**What goes wrong.** The easiest build is to treat `role === "guardian" && colonyId === null` as "starting" everywhere: in `scopeRow`, in `checkPlacements`, in the create check at `:2021`, and in the People screen. That brings back exactly the "null means something" rule §10.1 banned. Any bug that drops a colony id would then quietly invite a starter instead of being refused. Examples: a form field mis-parsed, or a JSON caller leaving out `colonyId`. The refusal at `:454` is the safety net that would disappear, and every test would still pass.

**Fix to the spec.**
- "No colony yet" travels as its own explicit token from the form to the database. For example `PlacementInput { role: "guardian", start: true }` and a form field `no_colony=1`.
- `scopeRow` writes `reach: 'start'` only from that token.
- A guardian with no colony and no token is still refused with today's message.
- Every reader that tells a starter apart reads `reach` from the database: `heldRows`, `heldInForce`, `ScreenPerson.placements`, `listPeople`. List these in §4.3.
- Add a mutation probe: "a guardian placement with no colony and no token becomes a starter" must turn a test red.

### F2 · Major · The proposed database checks are incomplete, and one sentence would break vet rows

**Evidence.**
- `schema/people.ts:145-178` lists today's checks.
- `scopeRow` writes non-guardian roles, vets included, as `island` (`people.ts:166-170`). The test fixture `vet = {role:"vet", colonyId:null, reach:"island"}` is at `capabilities.test.ts:30`.
- Decision B ("no end date, no label") is only enforced on the People screen in the spec.

**What goes wrong.**
1. Nothing in the database stops a `start` row from having an `expires_at` or a `relationship`. `writePlacements` copies `endsAt` and `relationship` onto rows it updates (`:640-650`). So the CLI, or any future caller, could write a starting row that ends. That row would then follow the ended-row rules ("put back by updating", `:609-613`).
2. "`island` still means the team", read as a check (`reach = 'island'` ⇒ staff or management), fails the migration on any vet row and on the test fixtures.
3. §6 lists "two starting rows for one person" as a new refusal. The existing unique constraint (`person_scopes_role_scope_unique`, nulls not distinct, `:176-178`) already guarantees it. The spec should say so, so nobody adds a redundant partial index.

**Fix to the spec.** Give the checks exactly:
- `reach IN ('island','colony','start')`
- `guardian_colony_ck`: `role <> 'guardian' OR reach IN ('colony','start')`
- new: `reach <> 'start' OR (role = 'guardian' AND colony_id IS NULL AND expires_at IS NULL AND relationship IS NULL)`
- keep `reach_colony_ck` and `team_island_ck` unchanged
- add no new rule on `island`; vets keep it

Add database tests for a `start` row with an end date and with a label. The migration also needs a written down-step that refuses while any `start` row exists.

### F3 · Major · "Starting only on her own" is not enforced on every writer, so she can quietly fall back to starting

**Evidence.**
- The CLI `setRoles --add guardian --colony N` inserts the placement and leaves every other row alone (`people.ts:1368-1378`, `:1449-1457`). `--add staff` does the same.
- `writePlacements` replaces the whole set, so it is safe. `createColonyWithPlacement` is covered by spec §5 step 4. The CLI is not covered.
- The either/or rule ("colonies or 'No colony yet', not both") is assigned to "the People screen", which is the form parser at `screen.ts:312-366`. The lib/db `checkPlacements` (`:441-505`) is shared by invite, Change roles, Bring back and any future JSON caller, and it would not refuse the combination.

**What goes wrong.** A starter given a colony through the CLI keeps her starting row. When that placement later ends, she becomes a starter again instead of getting "Your access has ended". That directly contradicts §1 and §5 ("she does not go back to 'no colony yet'"), and no test listed would notice.

**Fix to the spec.** One rule, enforced in lib/db: any write that leaves a person with a row in force other than `start` deletes her `start` row in the same transaction, using a shared helper called by `writePlacements`, `setRoles`, `createColonyWithPlacement` and `addPerson`. A database trigger would make this structural (on insert or update of a row other than `start`, delete that person's `start` rows; refuse a `start` insert while she has another row in force). `checkPlacements` in lib/db refuses `start` combined with anything. Add tests through the CLI path and the lib path, not only the form.

### F4 · Major · Every place that describes her today would call her "nothing"

**Evidence.**
- `roleSentence` returns `role.none` ("nothing") when the roles are `["guardian"]` and there are no colonies (`people/words.ts:63-73`, `strings/en.ts:35`).
- The event label is just `"guardian"` (`scopeLabel`, `people.ts:150-151`). That cannot be told apart from a broken legacy row.

Where it shows up:

| Where | What it would say | Source |
|---|---|---|
| Invitation email | "Syros Cats has invited you to help as nothing." | `mail/personTemplates.ts:59`, `en.ts:67` |
| Accept page | "…invited you as nothing.", and it would also promise her "exactly where each cat is" for her colonies | `welcomePage.ts:48`, `:40`, `en.ts:44-47` |
| Notice to the other managers | "Maria invited Eleni as nothing." | `personTemplates.ts:114`, `en.ts:74` |
| People screen, her row | "Nothing", plus an empty `<li>` placement | `screen.ts:283`, `:238-241`, `peoplePages.ts:147` |
| People screen, history | "Before: nothing. Now: a cat guardian for X." | `screen.ts:113`, `:154` |
| Bring back form | the "held" line for a left starter | `teamPeople.ts:280-288` |
| My page / My colonies | "You aren't helping with a colony…" / "If that seems wrong, ask Syros Cats" | `myPages.ts:92`, `:239`, `en.ts:93`, `:125` |
| CLI `listPeople` | `guardian` | `people.ts:2238` |

The spec's §2 table covers only the email, My page, My colonies and the People row.

**Fix to the spec.**
- List every one of these places with its new sentence: email, accept page (including its "What you'll be able to see and do" paragraph), managers' notice, People row and its placement list, People history, Bring back, CLI.
- Define the event label as `guardian:start`, and list the label parsers that must learn it: `screen.ts` `wordsForLabels` and `idsMentioned`, `personTemplates.ts` `parseLabels`, `teamPeople.ts` `guardianColonies` and line 395.
- Add a test: the word "nothing" never appears for a starter on any of these surfaces, in all three languages.

### F5 · Major · Her first colony may never reach "Recent guardian changes", the one safeguard §7 relies on

**Evidence.** The list picks up created colonies only from `roles_changed` events where `by = personId` and `detail.createdColony` is set (`guardianChanges.ts:211-225`). Today's write includes `createdColony` (`people.ts:2041-2046`). Spec §5 step 5 redefines this event ("before *cat guardian, no colony yet*, after …") and doesn't mention `createdColony`.

**What goes wrong.** An implementer who rewrites the event for the starter's branch can drop `createdColony`. Her first colony would then be missing from the only control Decision D accepts for a mistyped invitation, and every listed test would still pass.

**Fix to the spec.** Step 5 keeps `detail.createdColony` and `by = her id`. Add a test: after her first create, "Recent guardian changes" shows that colony. Optionally mark it "first colony" so the team can spot it.

### F6 · Major · The Colonies page tells her things that aren't true

**Evidence.**
- With no colonies listed she sees "There are no colonies yet." (`colonyPages.ts:146`, `en.ts:288`).
- A search shows "No colony has ever had a name like that." (`en.ts:289`).
- If she then creates that name, the clash page says "That name can't be used" without naming it (`teamColonies.ts` `takenResponse`, filtered by `covers`).
- The proposed My colonies copy asks her to create a colony only for cats "nobody has recorded", which she has no way to check.

**What goes wrong.** Her main path is search, then create, and it contradicts itself: she's told nothing exists, then told the name is taken. §3 says the search "finds nothing, as for any guardian" but sets no wording.

**Fix to the spec.**
- Give separate wording to anyone who isn't island-wide. Empty list: "Colonies you look after appear here." Search: "None of your colonies has a name like that." Clash: "Another colony already has that name. Choose a different one."
- Drop "nobody has recorded" from the My colonies copy.
- Say plainly that the clash message is the only thing that reveals another colony exists, and that this is accepted (see F16).

### F7 · Major · "Routes must opt in" is not yet something the build can enforce

**Evidence.**
- `GET /team/colonies` is `requireSeeing()` (`teamColonies.ts:151-153`), which is `[requireTeam(), enterIfSees]` (`requireSeeing.ts:35`). That same helper guards 8 routes (the SEEING rows in `team.walk.test.ts:142-147`).
- §4.3 says the `requireSeeing` door "admits … or holds a starting row". Built literally, that changes `enterIfSees` for all 8 routes. Only `requireTeam` would then stop her on the other 7.
- The route walk records decisions; it doesn't prevent them. The author who opts a route in also writes its TABLE row as "pass".

**Fix to the spec.**
- Name the mechanism: a `requireTeam` option (for example `starting: true`) and a separate `requireColoniesList()`. Leave `enterIfSees` alone.
- Only answer (2) people get past the door, and only on a route carrying that option.
- Add a source test, like the existing `canSomewhere` scan at `capabilities.test.ts:187`, that pins the option to exactly `GET` and `POST /api/team/colonies`. A third use fails the build.
- Add a mutation probe: put the option on `GET /team/sites`; the walk must go red.

### F8 · Minor · One sign-in door is missing from the spec's list

**Evidence.** `mayEnter` is called in `requireTeam`, in `internal.ts:99`, in the hand-off (`team.ts:151`), at accept (`teamWelcome.ts:94`), **and** in `alreadySignedInAs` (`team.ts:59`). That last one is the double-tap replay path from SYC-353. §4.3 names three places.

**What goes wrong.** A starter who taps her sign-in link twice is sent to the sign-in page, not home.

**Fix to the spec.** One door function, used at all five call sites. Add a replay test for a starter.

### F9 · Minor · The route walk would show "pass" for creating without ever creating anything

**Evidence.** The walk posts `{}` (`team.walk.test.ts:475`). `POST /team/colonies` answers that with a 400 from `badForm`, and the walk counts any status other than 401/403 as "pass".

**What goes wrong.** The walk proves only that she gets past the door, not that she can create. If someone later adds a well-formed body for this route, the shared starter person turns into a guardian partway through the walk, and every row after it is tested against the wrong person.

**Fix to the spec.**
- Mark the `POST /team/colonies` row `fresh`.
- Spell out the walk entries: `TEAM_ONLY.guardianNone = "forbidden"`, `OWN_PAGES` and `ACCEPT_PAGE` `guardianNone = "pass"` (a joined starter is redirected home), explicit entries on the two colonies rows only, and `SEEING` must **not** include her.
- Keep §6 "After creating" as a separate, real end-to-end test.

### F10 · Minor · Two statements in the spec don't match what the code does

**Evidence.**
- Mark as left and Stop helping **keep** her rows (`leave()`, `people.ts:770-829`; base spec §9.2). They don't remove them.
- Ended placements are kept as ended rows (`writePlacements` `:668-672`). So "she has no rows left" (§4.1, §5) is not literally true.

**What goes wrong.** An implementer reading §4.2 might add a delete to `leave()`. That would break Bring back's record of what she held.

**Fix to the spec.** Say "no row in force". Say a starter who leaves keeps her starting row, like any placement, and that Bring back rewrites it.

### F11 · Minor · Create races and double submits: wording and one gap

**Evidence.** The create transaction locks her people row and re-reads her rows (`people.ts:2004-2021`). Every roles writer locks the people row first. So a concurrent Change roles or Mark as left is serialised; I verified this. One gap remains: `requireTeam` reads the person before the transaction, so for a second, near-simultaneous submit, `pageViewer` still sees no colonies.

**What goes wrong.** If the second submit uses the same name, she gets "That name can't be used", not "That's your colony". "Two people pressing Create" is also not possible: only she can create for herself.

**Fix to the spec.**
- Reword to "two tabs or a double tap".
- Say the starting row's delete runs after the colony insert, in the same transaction, filtered on `reach = 'start'`.
- Say a clash rolls back everything: the starting row stays, and no `roles_changed` or `colony_created` event is written. Add a test for that.
- Optionally re-read what she can see before drawing the clash page.

### F12 · Minor · The Change roles and Bring back forms aren't defined for a starter

**Evidence.**
- The Change roles form fills in its ticks from her placements on colonies only (`teamPeople.ts:250-258`).
- `parsePlacements` refuses "No colonies exist yet" before it would look at a "no colony yet" choice (`screen.ts:328-330`).

**What goes wrong.** Opening Change roles for a starter ticks "cat guardian" with nothing under it. Saving without changes then fails with "A cat guardian needs at least one colony."

**Fix to the spec.** Both forms pre-tick "No colony yet" when she holds a starting row. The "No colonies exist yet" check runs after the "no colony yet" choice is read.

### F13 · Minor · Her menu and the refusal page

**Evidence.**
- `GUARDIAN_NAV` always includes Feeding sites (`layout.ts:55-58`).
- `navContext` has no way to know she is a starter (`requireTeam.ts:153`).
- The 403 page says "Your colonies are here" (`refuse.ts:139-140`), which for her links to an empty list.

**Fix to the spec.** Pass a starter flag into `navContext`. Add a test that her menu shows only Colonies and her name. Give her her own refusal line: "…You can create your first colony here."

### F14 · Minor · Missing tests and mutation probes

Each of these should be added to §6:
- `canSomewhere` or `capabilitiesOf` counting a starting row.
- A starting row granting `match_cat_anywhere`. It shares a branch with `create_colony` (`capabilities.ts:183-185`), so the obvious one-line change grants both.
- lib/db `checkPlacements` refusing each bad combination (F3).
- The CLI `setRoles` paths (F3).
- Database refusal of a starting row with an end date or a label (F2).
- No surface says "nothing" for her (F4).
- `createdColony` reaches "Recent guardian changes" (F5).
- A name clash leaves her a starter (F11).
- The `alreadySignedInAs` replay (F8).
- A starter landing on the accept page is redirected home (`requireInvitee.ts:45-47`, `:62-65`).

### F15 · Nit · Wording and terminology

- "No colony yet: she'll create her own" assumes every invitee is a woman. In Greek and French the word changes with gender. Use something like "No colony yet (creates their own)", and give Johnny the gender question under SYC-283.
- Terminology checked: "cat guardian" is used throughout. There is no "colony carer" and no "snapper".

### F16 · Nit · She can test whether a colony name exists

**Evidence.** The clash path tells her when a name is already taken by another colony (`takenResponse`).

**What goes wrong.** By trying to create colonies, a starter (or a stranger behind a mistyped invite) can confirm whether a colony name exists anywhere on the island. Today's cat guardians can already do this.

**Fix to the spec.** Record it as accepted in §7 / §14.1, alongside case 1.

### F17 · Nit · `can()` and `capabilitiesOf` disagree for her

**Evidence.** `can(create_colony)` says yes for her, but `capabilitiesOf` (`capabilities.ts:254`), which is built on `canSomewhere`, leaves it out.

**What goes wrong.** Nothing a user can see: `GET /team/me` is closed to her. It is still an inconsistency someone may later try to "fix" by making `canSomewhere` count her, which would open every route (F14's probe guards against that).

**Fix to the spec.** Say so in §4.3, so nobody fixes it the wrong way.

---

## Verdict

**The approach is sound; the spec isn't ready for approval yet.** Storing "no colony yet" as a third kind of reach is right, and every existing reader fails closed: I found no path that makes her island-wide or gives her more than `create_colony`.

The risk is in what the spec leaves unsaid. Seven things could be built wrong while every test stays green:
- guessing "starting" from a missing colony (F1)
- incomplete database checks (F2)
- the CLI path that lets her fall back to starting (F3)
- "nothing" on every surface that describes her (F4)
- her first colony missing from the one safeguard (F5)
- a Colonies page that contradicts itself (F6)
- a route opt-in nothing enforces (F7)

Fold in F1 to F7 before approval. F8 to F17 are small edits.
