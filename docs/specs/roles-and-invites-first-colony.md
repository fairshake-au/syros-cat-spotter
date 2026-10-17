# A cat guardian with no colony yet starts her first one

**Amendment to [`roles-and-invites.md`](./roles-and-invites.md) · Cat Spotters (Syros)**
**Status:** Draft for Samuel's approval (17 October 2026). Adversarial review (independent Opus, 17 October 2026): [`reviews/roles-and-invites-first-colony-review.md`](./reviews/roles-and-invites-first-colony-review.md). All 17 findings are folded in; the table in §11 says where.
**Linear:** SYC-439 (this) · SYC-53 (roles and invites) · SYC-209 (colonies; PR 4.2 built colony creation for cat guardians, PR 4.3 "Recent changes by cat guardians") · SYC-441 (no cap on colony creation) · SYC-283 (Johnny's Greek and French check; no cat guardian is invited before it).
**Decided already (Samuel, 17 October 2026, on SYC-439):** *"Yes, let her start one."* This document settles how, not whether.
**Amends:** §2.2 (cat guardian), §6.1 (the "creates its own scope" kind), §6.3 (the dashboard door), §6.9 (Decision 14), §8.2 (the people screen), §10.1 (`person_scopes`), §13 (languages), §14.1 and §14.2 (cases 1, 4 and 22), §15.3 (tests); and in [`feeding-sites-and-colonies.md`](./feeding-sites-and-colonies.md), the wording a cat guardian reads on the Colonies page (§2.7's "That name can't be used", and the empty and no-match lines). Everything not named here stays as it is.

---

## 1. The short version

Management can invite someone as **a cat guardian with no colony yet**. When she joins and signs in, she can open exactly these: **her My page (and its forms), her My colonies page, the Colonies page (empty, with "Create a colony"), the create form itself, and sign-out**. Every other page gives her the polite refusal page.

When she creates her first colony, **in one step that either fully happens or doesn't happen at all**, the colony is made, she is placed on it as its cat guardian, and her "no colony yet" standing is removed. From that moment she is an ordinary cat guardian of that colony, exactly as if management had invited her onto it, and the team sees the new colony on "Recent changes by cat guardians".

Someone whose placements have all ended still gets "Your access has ended". Holding nothing still lets nobody in.

## 2. What she's called, and every place that describes her

**She is a cat guardian.** No new role name appears on screen, in emails or in the history. Today, every place that describes a cat guardian with no colony would call her "nothing" (the review found eight). Each gets its own wording:

| Where | English (Greek and French drafted, then checked by Johnny under SYC-283) |
|---|---|
| People screen, the "A cat guardian" box | A new choice above the colony list: **"No colony yet: creates the first one"** |
| People screen, her row | **"Cat guardian · no colony yet"**, with no empty colony line under it |
| People screen, history | **"Before: nothing. Now: a cat guardian, no colony yet."**; and when she creates one, **"Before: a cat guardian, no colony yet. Now: a cat guardian for Vaporia — Eleni's."** |
| Invitation email | **"Syros Cats has invited you to help as a cat guardian, to record a colony of cats you look after."** (instead of naming a colony) |
| Accept page | **"Syros Cats has invited you as a cat guardian."** Its "What you'll be able to see and do" paragraph says: **"Create a colony for the cats you look after. Once it's created, you'll see exactly where each of its cats is, and you can add cats and feeding sites to it."** It doesn't promise positions for colonies she doesn't have |
| Notice to the other managers | **"Maria invited Eleni as a cat guardian, with no colony yet."** |
| Bring back form | The "held before" line reads **"a cat guardian, no colony yet"** |
| My page, the sentence about herself | **"You're a cat guardian. You haven't created a colony yet."** |
| My colonies | **"You haven't got a colony yet. Create one for the cats you look after."** and a button, **"Create a colony"**, which opens the Colonies page at its create form |
| The `people` command's list | `guardian (no colony yet)` |

The history label for her standing is **`guardian:start`**, never a bare `guardian`, so it can't be confused with a damaged row. Everything that reads those labels learns it: the People screen's history words and its "colonies mentioned" lookup, the managers' notice, and the People routes that read colonies out of labels.

**Gender.** The choice on the People screen is worded so it doesn't assume a woman. Greek and French change some words with gender; Johnny is asked to choose the wording under SYC-283.

**On the People screen** (invite, Change roles and Bring back all share one form, and one set of rules in the database code, §4.4):

- "No colony yet" and a ticked colony are **either/or**. Choosing both is refused: *"Choose her colonies, or 'No colony yet', not both."*
- It is **only for a cat guardian with no other role.** Combined with the team or management (who already create colonies island-wide), it is refused: *"'No colony yet' is only for a cat guardian with no other role."*
- It **takes no end date and no label** (Decision B). Either is refused with the message the team's rows get today.
- It works **even when no colony exists yet on the island.** Today the guardian box is greyed out with "No colonies exist yet"; it now offers "No colony yet" instead, and that check runs only after the "No colony yet" choice has been read.
- **Change roles and Bring back pre-tick "No colony yet"** when she holds that standing, so saving the form unchanged keeps it.

Nothing about the invitation itself changes: same 14-day expiry, resend, withdraw, the three promises on the accept page, and the same daily limits (§4, §8.5).

## 3. What she can reach before she has a colony

| Page | What she gets |
|---|---|
| My page (`/team/my`), and its forms: language, sign out everywhere, stop helping | As any cat guardian |
| My colonies (`/team/my/colonies`) | Her empty state and the "Create a colony" button (§2) |
| Colonies list (`GET /team/colonies`) | The page with **no colonies listed**, and the create form |
| Create a colony (`POST /team/colonies`) | Allowed: the form a cat guardian has today (a name and notes; her own name is the guardian's name) |
| Sign out (`POST /team/signout`) | As anyone |
| The accept page, if she follows her invitation link again | Sent home to My colonies, as any joined person is |
| **Everything else** under `/api/team` and `/api/internal`: one colony's page, the Feeding sites pages, the map, the welfare queue, the "my colony" and "my cat" pages, `GET /team/me`, and every other write | The refusal page (a 403), with her own line: *"That part of the dashboard is for the Syros Cats team. You can create your first colony here,"* linking to My colonies. Never "access has ended", never the sign-in page |

**This is a short, named list, not "anything that would refuse her anyway".** Some pages today let in anyone who may enter the dashboard and then check inside (a cat's page, for example, shows a cat outside her colonies with the public view). She doesn't get those. A page reaches her only if its own route says it is for someone with no colony yet, and a test fails the build if any route other than the Colonies list and Create a colony says so (§6). A page added next year is closed to her until someone decides otherwise and changes that test.

**Words on the Colonies page.** Anyone who isn't island-wide, so every cat guardian and not only her, gets wording that is true from where she stands:

| Where | Today | For a cat guardian |
|---|---|---|
| Nothing listed | "There are no colonies yet." | **"Colonies you look after appear here."** |
| A search that finds nothing | "No colony has ever had a name like that." | **"None of your colonies has a name like that."** |
| A name another colony already has | "That name can't be used." | **"Another colony already has that name. Choose a different one."** |

The last line is the only thing that tells her another colony exists. That is accepted (§7).

**The menu shows only what she can open:** *Colonies*, and her own name (My page). Not *Feeding sites*. Once she has a colony, the menu is the usual cat guardian's menu.

**She lands on My colonies** when she signs in, signs in twice from the same link, or accepts the invitation, like every cat guardian (Decision C).

## 4. The door rule

### 4.1 What the rule says, in plain terms

There are now three answers to "may this person in?", not two:

1. **In, as today:** she holds at least one dashboard capability somewhere (an island row, or a placement on a colony that is in force). Unchanged.
2. **In, to start a colony only:** she holds nothing in (1), and she holds a "no colony yet" row in force. She gets a session, and then only the pages in §3.
3. **Not in:** everyone else, including someone whose placements have all ended, a vet (who holds nothing yet) and someone who never held anything. Unchanged: "Your access has ended".

A "no colony yet" row is only ever written when management (or the `people` command) explicitly chooses it. **It is never inferred from a missing colony** (§4.4), and **an ended placement never turns into one.** When all of a cat guardian's placements end, she has no row in force and is in answer 3, as today.

### 4.2 The data: how "no colony yet" is stored (Decision A)

Today the database refuses a cat guardian row with no colony (§10.1: "if a guardian row were ever written with the colony left out, 'null means island' would quietly make her island-wide"). That protection stays. The question is where "no colony yet" lives.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ Recommended. A third kind of reach, "start".** A `person_scopes` row with role `guardian`, no colony, and `reach` = `start`. | It's a role row like every other, so it shows in the history, is replaced by Change roles, kept by Mark as left (like any row) and rewritten by Bring back, and is handled by the code that already handles rows. Nothing that reads rows today grants anything for it: the "island row" test needs a team role and the "colony row" test needs a colony, so an old reader **fails closed** (the review checked every reader). | One migration. Every writer and every reader that must tell her apart has to be changed once; §4.4 lists them. |
| B. A yes/no flag on the person ("may start a colony"). | No change to the roles table. | It sits outside the roles, so Change roles, the history and the People screen each need their own handling, and it's easy to forget one. |
| C. A placeholder colony ("Eleni's first colony") made at invite time, which she renames. | No new rule at all. | Empty colonies the team didn't ask for; she can't rename it herself (renaming is the team's, §6.9); it pretends something exists that doesn't. |

**The database checks (Decision A), exactly:**

- `reach` is one of `island`, `colony`, `start`.
- A cat guardian's row is `colony` or `start`, never `island` (changes today's `person_scopes_guardian_colony_ck`).
- **New:** a `start` row is always a cat guardian's, names no colony, and has no end date and no label.
- Unchanged: `colony` exactly when a colony is named; the team and management are always `island`. **No new rule is added on `island`**: a vet row is `island` today and stays so.
- "One `start` row per person" needs nothing new: the existing one-row-per-person-role-colony constraint already treats two empty colonies as the same.
- The migration is made with the repo's generator after a fresh rebase (never numbered by hand). Its written way back refuses while any `start` row exists.

### 4.3 How the code decides

- **One new question, in one place** (`capabilities.ts`, beside `can()`): *does this person hold a "start" row?* A row counts only if its role is `guardian`, its colony is empty **and** its reach says `start` in so many words. A row with no reach given, or any other reach, does not count.
- **`can(person, "create_colony")` says yes for a start row, and that is the only thing a start row grants.** In particular, `match_cat_anywhere`, which today shares a branch of code with `create_colony`, still says no.
- **`canSomewhere`, `mayEnter` and `capabilitiesOf` ignore start rows.** They keep meaning "holds something for some colony", so nothing that uses them today changes. This means `can()` and `capabilitiesOf` disagree for her on `create_colony`, on purpose: making `canSomewhere` count her would open every page that only checks the door. A comment says so, and a test (§6) goes red if anyone "fixes" it.
- **One door function** decides answers 1, 2 and 3, and all five places that let someone in use it: the hand-off, the "already signed in" path for a link tapped twice, the accept page, the sign-in Worker's "dashboard" question (`/api/internal`), and every dashboard request (`requireTeam`).
- **Every dashboard request:** answer 1 carries on exactly as today. Answer 2 passes only on a route that carries the new `starting` option: `GET` and `POST /team/colonies`. Her own pages already let in any accepted person. Everywhere else she gets the refusal page. Answer 3 gets "access has ended" (own pages excepted, as today).
- **The Colonies list gets its own door** (`requireColoniesList`): "sees some colony, or holds a start row". The shared door that eight Colonies and Feeding sites pages use (`requireSeeing`) is **not** changed. Every query behind the list is still filtered by the colonies she sees, which for her is none.
- **The menu** is told she is starting (one flag passed with the rest of the menu's context) and shows only Colonies and her name.
- **The workspace door is untouched.** A start row never grants `use_workspace`.

### 4.4 Writing "no colony yet": always on purpose, always cleared

- **It travels as its own explicit choice** from the form to the database: a form field (`no_colony`) and an explicit flag on the placement (`start: true`). Only that flag writes `reach = start`. A cat guardian placement with no colony **and no flag** is still refused with today's message, *"A cat guardian needs a colony."* So a form or API caller that loses a colony number gets an error, never a starter.
- **The rules live in the database code, not only the form**, so the invite, Change roles, Bring back and the `people` command all keep them: a start row can't be combined with any other row; it takes no end date or label.
- **One clearing rule, in the database code:** any write that leaves a person holding a row in force other than her start row deletes the start row in the same transaction. Every writer calls it: Change roles and invite (which replace the whole set), the `people` command's `--add`, Bring back, adding a person, and creating a colony. So a starter given a colony by any route can't fall back to "no colony yet" when that colony's placement later ends.
- **Every reader that has to tell her apart reads `reach` from the database**, never guesses from an empty colony: the people screen's list and history, the rows each writer compares against, the "held in force" read used when creating a colony, and the `people` command's list.

(Decision F: whether the clearing rule should also be a database trigger. Recommended: no, keep it in the database code with tests through every writer. See §9.)

## 5. What happens when she creates her first colony

All in **one database transaction**, so it either all happens or none of it does (as §6.1 already requires for a cat guardian):

1. The person is re-read and locked inside the transaction (as today). She must be accepted, not left, and hold an island row, a placement in force, **or a start row in force**. Anyone else is refused, as today.
2. The colony is created, with her as creator and her name as the guardian's name.
3. Her placement on it is written (`guardian`, `colony`, no end date, no label, granted by herself), as §6.1 defines.
4. **Her start row is deleted**, after the colony is created, selected by `reach = start`.
5. One `roles_changed` event is written, by her and about her, from *`guardian:start`* to *`guardian:<colony>`*, and it **keeps carrying `createdColony`** (the new colony's number) in its detail, exactly as today. The team's "Recent changes by cat guardians" list (SYC-209 PR 4.3) finds colonies created by cat guardians by reading exactly that. The `colony_created` history entry is written as today.

She is then taken to her new colony's page with "Colony created". From now on she is an ordinary cat guardian: she can create more colonies (Decision 14), add cats and add feeding sites.

**If the name is already taken,** nothing at all is written: no colony, no placement, no event, and her start row stays. She sees "Another colony already has that name. Choose a different one." (§3) and can try again.

**Two tabs, or a double tap on Create:** her person row is locked for the transaction (as today), so the second run waits, then sees her already placed, and creates a second colony as any cat guardian may, unless the name is the same, when it gets the "already has that name" line. Change roles, Mark as left and Stop helping lock the same row first, so they can't interleave with a create.

**Afterwards.** If her placement on that colony later ends or is removed, she has no row in force and gets "Your access has ended", like any cat guardian. She doesn't go back to "no colony yet" unless management chooses it again. If she is marked as left, her rows are kept as they are for every person (§9.2), and Bring back shows and rewrites them.

## 6. Tests this adds (amends §15.3)

**The route walk** gets a new kind, `guardianNone` (a cat guardian with a start row and nothing else):
- Team-only routes: refused. Her own pages and the accept page: pass (the accept page sends her home). The two Colonies routes: pass, and they're the only rows that name her. The eight "sees some colony" routes: refused.
- The `POST /team/colonies` row is marked to use a fresh person, so a real create can never turn the walk's starter into a guardian partway through.
- The existing `ended` (every placement ended) and `nothing` (a vet) kinds still get "access has ended" everywhere.

**End to end:**
- After creating, she sees her new colony on the Colonies list and on My colonies, and nothing else; her start row is gone; she now gets what `guardianOne` gets.
- After creating, "Recent changes by cat guardians" shows her first colony (`team.guardianChanges.test.ts`).
- A name clash leaves everything as it was: she is still a starter, and no events were written.
- She is let in by the hand-off, a link tapped twice, the accept page and the Worker's dashboard question; each still refuses an ended cat guardian.
- Her menu shows only Colonies and her name; her refusal page has her own line.
- The word "nothing" never describes her, in English, Greek or French, on any surface in §2.

**The database refuses:** a start row with a colony, an end date or a label; a start row for the team, management or a vet; a cat guardian row with `island` reach. A vet row with `island` reach is still accepted.

**The database code refuses:** a cat guardian with no colony and no "no colony yet" flag; "no colony yet" with a colony, another role, an end date or a label. These are tested through the People routes **and** through the `people` command, not only the form. Giving a starter a colony by each writer (Change roles, `--add`, Bring back) removes her start row.

**Source test:** the `starting` route option appears on exactly `GET` and `POST /api/team/colonies`; a third use fails the build.

**Mutation probes.** Each one makes a test go red, is put back, and is tabled in the implementation PR:
1. The door admits a starter on a route without the `starting` option.
2. `mayEnter`, `canSomewhere` or `capabilitiesOf` counts a start row.
3. The "holds a start row" test accepts a row with no reach given.
4. A start row grants `match_cat_anywhere`.
5. A cat guardian placement with no colony and no flag becomes a starter.
6. The Colonies list's door lets in someone who sees nothing and holds no start row.
7. The `starting` option is added to `GET /team/sites`.
8. The create leaves the start row behind.
9. The create's event drops `createdColony`.
10. The `--add` path leaves the start row behind.

## 7. Abuse limits (amends §14.1 and §14.2)

**Does this widen the SYC-441 risk?** A little, in one way. Today only someone management has placed on a colony can create colonies. Now management can also invite someone with no colony to vouch for her, and her first colony can be anywhere. Once she has it, she is where Decision 14 already puts every cat guardian (create colonies, add any cat, and so see its exact position), with the same controls: everything is in the history, and her first colony appears on "Recent changes by cat guardians".

**The one real widening is a mistyped address (case 1).** Today a mistyped cat guardian invitation gives a stranger one colony's positions. A mistyped "no colony yet" invitation gives a stranger the power to create a colony and add any cat to it. What limits it is unchanged: 14-day expiry, one-tap withdraw, the "joined in the last 7 days" list, and her first colony showing on "Recent changes by cat guardians".

**She can learn whether a colony name exists**, by trying to create one with that name and reading "Another colony already has that name". Every cat guardian can already do this. Accepted.

| Option (Decision D) | Benefits | Risks |
|---|---|---|
| **A. ✅ Recommended. Accept it, and add nothing now.** State the widening in §14.1 and case 1; leave the colony-creation cap with SYC-441, to decide after launch. | Nothing extra to build or maintain; consistent with Decisions 7 and 14. No cat guardians are invited before Johnny's check anyway (SYC-283). | A mistaken or malicious "no colony yet" invitation is noticed only when someone reads "Recent changes by cat guardians". |
| B. Tell management by email when someone creates her first colony. | Noticed within the hour. | More mail to a few volunteers, mostly about nothing; one more message to translate and test. |
| C. Her first colony needs the team's OK before it's hers. | Nothing happens until a person looks. | Brings back the wait Decision 14 removed, which was the point of Samuel's yes. |

**Case 4** ("someone grants themselves more") gains: *the database refuses a start row with a colony, an end date or a label, or for anyone but a cat guardian; only management (or the `people` command) can give one, and only on purpose; she can't give herself one; and anything that gives her another row removes it.* **Case 22** gains: *a cat guardian with no colony yet is in the same position once she has created her first colony.*

## 8. Language

Every new sentence in §2 and §3 is written in English, Greek and French, in the dashboard and email catalogues that already exist, and added to the list Johnny checks under SYC-283 (with the gender question in §2). Until a language is live, her pages fall back to English, as today. Colony names stay exactly as typed, in every language.

## 9. The open choices, with recommendations

| | Question | Recommendation |
|---|---|---|
| **A** | How "no colony yet" is stored | **A third kind of reach, "start"** (§4.2) |
| **B** | Can "no colony yet" have an end date or a label? | **No.** It ends when she creates her colony or management changes her roles. A label is about her relationship to a colony, and there isn't one yet |
| **C** | Where does she land after signing in? | **My colonies**, with the "Create a colony" button, so every cat guardian has the same home. (Landing on the Colonies page saves one tap, but gives her a different home before and after her first colony) |
| **D** | Any new abuse limit? | **None now.** Accept the stated widening and keep the cap with SYC-441 (§7) |
| **E** | Can "no colony yet" be combined with another role or a colony? | **No.** A cat guardian alone, and either/or with colonies (§2) |
| **F** | Should "a start row is cleared when she gets any other row" also be a database trigger? | **No.** One rule in the database code, called by every writer and tested through each, as the other role rules are. A trigger would make it impossible to forget, but it would be the only trigger in the roles tables and harder to read and test |

## 10. What this does not change

The workspace door; what any existing role can see or do; Decision 14 itself; the invitation's limits and expiry; the phone's saved list (she has nothing to save); how a cat comes to be in a colony; the rules on welfare reports; the shared door to the Colonies and Feeding sites pages.

## 11. How the review's findings were handled

| Finding | Severity | Where it went |
|---|---|---|
| F1 "starting" guessed from a missing colony | Major | §4.4 (explicit flag; no-flag still refused), §6 probe 5 |
| F2 database checks incomplete; vet rows | Major | §4.2 checks listed exactly; no new rule on `island`; way back |
| F3 CLI and other writers leave the start row | Major | §4.4 clearing rule in the database code, every writer; §6 tests and probe 10; Decision F |
| F4 "nothing" on every surface | Major | §2 table (every surface), `guardian:start` label; §6 test |
| F5 first colony missing from Recent changes | Major | §5 step 5 keeps `createdColony`; §6 test and probe 9 |
| F6 Colonies page contradicts itself | Major | §3 wording table for anyone not island-wide; "nobody has recorded" dropped |
| F7 route opt-in not enforceable | Major | §4.3 `starting` option and `requireColoniesList`, shared door untouched; §6 source test, probe 7 |
| F8 the "link tapped twice" door | Minor | §4.3 one door function at all five places; §6 test |
| F9 walk "pass" without creating | Minor | §6 walk entries spelled out; fresh person for the create row |
| F10 "no rows left" wording; leaving | Minor | "no row in force"; §5 "Afterwards" |
| F11 races and clashes | Minor | §5 "two tabs, or a double tap" and clash paragraph; §6 test |
| F12 Change roles and Bring back forms | Minor | §2 pre-tick; "No colonies exist yet" check order |
| F13 menu and refusal line | Minor | §3, §4.3; §6 test |
| F14 missing tests and probes | Minor | §6 |
| F15 gendered wording | Nit | §2 "Gender"; on-screen choice reworded |
| F16 name existence can be tested | Nit | §7, accepted |
| F17 `can()` and `capabilitiesOf` disagree | Nit | §4.3, on purpose, with a test |
