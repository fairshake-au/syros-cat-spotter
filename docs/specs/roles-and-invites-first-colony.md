# A cat guardian with no colony yet starts her first one

**Amendment to [`roles-and-invites.md`](./roles-and-invites.md) · Cat Spotters (Syros)**
**Status:** Draft for Samuel's approval (17 October 2026). Adversarial review: [`reviews/roles-and-invites-first-colony-review.md`](./reviews/roles-and-invites-first-colony-review.md).
**Linear:** SYC-439 (this) · SYC-53 (roles and invites) · SYC-209 (colonies; PR 4.2 built guardian colony creation) · SYC-441 (no cap on colony creation) · SYC-283 (Johnny's Greek and French check; no cat guardian is invited before it).
**Decided already (Samuel, 17 October 2026, on SYC-439):** *"Yes, let her start one."* This document settles how, not whether.
**Amends:** §2.2 (cat guardian), §6.1 (the "creates its own scope" kind), §6.3 (the dashboard door), §6.9 (Decision 14), §8.2 (the people screen), §10.1 (`person_scopes`), §14.2 (cases 1, 4 and 22), §15.3 (tests). Everything not named here stays as it is.

---

## 1. The short version

Management can invite someone as **a cat guardian with no colony yet**. When she joins and signs in, she can open exactly four things: **her own My page, her My colonies page, the Colonies page (empty, with "Create a colony") and sign-out**. Every other page gives her the polite "That part is for the Syros Cats team" page.

When she creates her first colony, **in one step that either fully happens or doesn't happen at all**, the colony is made, she is placed on it as its cat guardian, and her "no colony yet" standing is removed. From that moment she is an ordinary cat guardian of that colony, exactly as if management had invited her onto it.

Someone whose placements have all ended still gets "Your access has ended". Holding nothing still lets nobody in.

## 2. What she's called, and how she's invited

**She is a cat guardian.** There is no new role name on screen, in emails or in the history. Where the app needs to say she has no colony, it says so in plain words:

| Where | English (Greek and French drafted, then checked by Johnny under SYC-283) |
|---|---|
| People screen, the "A cat guardian" box | A new choice above the colony list: **"No colony yet: she'll create her own"** |
| People screen, her row | **"Cat guardian · no colony yet"** |
| Invitation email | Instead of naming a colony: **"…to record a colony of cats you look after, on the Cat Spotters dashboard."** |
| My page, the sentence about herself | **"You're a cat guardian. You haven't created a colony yet."** |
| My colonies | **"You haven't got a colony yet. When you find cats that someone looks after and nobody has recorded, create a colony for them."** and a button, **"Create a colony"**, which opens the Colonies page at its create form |

**On the People screen** (invite, Change roles, and Bring back all use the same form):

- "No colony yet: she'll create her own" and a ticked colony are **either/or**. Choosing both is refused with: *"Choose her colonies, or 'No colony yet', not both."*
- It is **only for a cat guardian on her own.** It can't be combined with the team or management (they already create colonies island-wide) and is refused with: *"'No colony yet' is only for a cat guardian with no other role."*
- It **takes no end date and no label.** An end date or label is refused with the same message the team's rows get today. (Decision B below.)
- It works **even when no colony exists yet on the island.** Today the guardian box is greyed out with "No colonies exist yet"; it now offers "No colony yet" instead.

Nothing about the invitation itself changes: same 14-day expiry, resend, withdraw, the three promises on the accept page, the same daily limits (§4, §8.5).

## 3. What she can reach before she has a colony

| Page | What she gets |
|---|---|
| My page (`/team/my`), language, sign out everywhere, stop helping | As any cat guardian |
| My colonies (`/team/my/colonies`) | Her empty state and the "Create a colony" button (§2) |
| Colonies list (`GET /team/colonies`) | The page with **no colonies listed** and the create form. The search box is there and finds nothing, as it finds nothing outside any guardian's own colonies |
| Create a colony (`POST /team/colonies`) | Allowed: the form a cat guardian has today (a name and notes; her own name is the guardian's name) |
| Sign out (`POST /team/signout`) | As anyone |
| **Everything else** under `/api/team`, including one colony's page, the Feeding sites pages, the map, the welfare queue, "my colony" and "my cat" pages, `GET /team/me`, and every write | The quiet 403: *"That part of the dashboard is for the Syros Cats team. Your colonies are here,"* linking to My colonies. Never "access has ended", never the sign-in page |

**This is a short, named list, not "anything that would refuse her anyway".** Some pages today let in anyone who may enter the dashboard and then check inside (a cat's page, for example, shows a cat outside her colonies the public view). She does not get those. A page reaches her only if it says, in its own route, that it is for someone with no colony yet. So a page added next year is closed to her until someone decides otherwise, and the route walk (§6) fails until they write that decision down.

**The menu shows only what she can open:** *Colonies*, and her own name (My page). Not *Feeding sites*. Once she has a colony the menu is the usual cat guardian's menu.

**She lands on My colonies** when she signs in or accepts the invitation, like every cat guardian. (Decision C below.)

## 4. The door rule

### 4.1 What the rule says, in plain terms

There are now three answers to "may this person in?", not two:

1. **In, as today:** she holds at least one dashboard capability somewhere (an island row, or a placement on a colony that hasn't ended). Unchanged.
2. **In, to start a colony only:** she holds nothing in (1), and she holds a "no colony yet" row. She gets a session, and then only the pages in §3.
3. **Not in:** everyone else, including someone whose placements have all ended, a vet (who holds nothing yet), and someone who never had anything. Unchanged: "Your access has ended".

A "no colony yet" row is never made by anything except management choosing it on the People screen. **An ended placement never turns into one.** When all of a cat guardian's placements end, she has no rows left, and she is in answer 3, as today.

### 4.2 The data: how "no colony yet" is stored (Decision A)

Today the database refuses a cat guardian row with no colony (§10.1: "if a guardian row were ever written with the colony left out, 'null means island' would quietly make her island-wide"). That protection stays. The question is where "no colony yet" lives.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ Recommended. A third kind of reach, "starting".** A `person_scopes` row with role `guardian`, no colony, and `reach` = `start`. The database's checks become: a `start` row is always a cat guardian's and never names a colony; a cat guardian's row is `colony` or `start`, never `island`; `island` still means the team. | It's a role row like every other, so it shows in the history (`roles_changed`), is removed by Change roles, Mark as left and Stop helping, and is written and read by the code that already handles rows. Nothing that reads rows today grants anything for it: the code's "island row" test needs a team role, and its "colony row" test needs a colony, so an old reader **fails closed** (it sees nothing). | One migration. Every place that reads rows must be checked once for how it treats the new reach (the review lists them). |
| B. A yes/no flag on the person ("may start a colony"). | No change to the roles table. | It sits outside the roles, so Change roles, the history and the people screen would each need their own handling, and it's easy to forget one. Removing it when she creates her colony is a second kind of write. |
| C. A placeholder colony ("Eleni's first colony") made at invite time, which she renames. | No new rule at all: she's an ordinary guardian from the start. | Empty colonies the team didn't ask for; she can't rename it herself (renaming is the team's, §6.9); it pretends something exists that doesn't. |

### 4.3 How the code decides (for the build; plain-English rules above are what matter)

- **One new question, asked in one place** (`capabilities.ts`, next to `can()`): *does this person hold a "starting" row?* A row counts only if its role is `guardian`, its colony is empty **and** its reach says `start` in so many words. A row with no reach given, or any other reach, does not count.
- **`can(person, "create_colony")` says yes for a starting row.** `create_colony` stays the only capability a starting row grants, and a test pins that every other capability says no for her.
- **`canSomewhere` and `mayEnter` ignore starting rows.** They keep meaning "holds something for some colony", so nothing that uses them today changes.
- **The sign-in door** (the hand-off, the accept page and the sign-in Worker's "dashboard" question) admits answer (1) or (2). Each of those three places asks the same new function, so they can't drift.
- **Every dashboard request**: answer (1) carries on exactly as today. Answer (2) passes only on a route marked for her in the route itself: the Colonies list and Create a colony. Her own pages (My page and its forms, My colonies) are already open to any accepted person, and sign-out needs no session check. Everywhere else she gets the quiet 403. Answer (3) gets "access has ended" (own pages excepted, as today).
- **The Colonies list's own door** (`requireSeeing`, which today needs her to see at least one colony) admits "sees some colony, **or** holds a starting row". Every query behind it is still filtered by the colonies she sees, which for her is none, so the page has nothing in it.
- **The workspace door is untouched.** A starting row never grants `use_workspace`.

## 5. What happens when she creates her first colony

All in **one database transaction**, so it either all happens or none of it does (as §6.1 already requires for a cat guardian):

1. The person is re-read inside the transaction (as today), and must be accepted, not left, and hold an island row, a placement in force, **or a starting row**. Anyone else is refused, as today.
2. The colony is created, with her as creator and her name as the guardian's name.
3. Her placement on it is written (`guardian`, `colony`, no end date, no label, granted by herself), as §6.1 defines.
4. **Her starting row is deleted.**
5. One `roles_changed` event records it, before *"cat guardian, no colony yet"*, after *"cat guardian of <colony>"*, and the `colony_created` history entry is written as today. The event keeps carrying `createdColony` (the new colony's number) in its detail, as today: the team's "Recent changes by cat guardians" list (SYC-209 PR 4.3) finds guardian-created colonies by reading exactly that, and its test (`team.guardianChanges.test.ts`) gains a case for a first colony made this way.

She is then taken to her new colony's page with "Colony created". From now on she is an ordinary cat guardian: she can create more colonies (Decision 14), add cats, add feeding sites, and the team sees her new colony on "Recent guardian changes" (SYC-209 PR 4.3). If her colony placement is later ended or removed, she has no rows left and gets "Your access has ended", like any cat guardian; she does **not** go back to "no colony yet" unless management chooses it again.

Two people pressing "Create" at once, or her pressing it twice: the person row is locked for the transaction (as today), so the second run sees her already placed and simply creates a second colony, as any cat guardian may. Two colonies can't take the same name (as today).

## 6. Tests this adds (amends §15.3)

- **The route walk gets a new kind, "guardianNone"** (a cat guardian with a starting row and nothing else). Only My page and its forms, My colonies, the Colonies list, Create a colony and sign-out pass; **every other route is 403 "forbidden"**, not "ended". The existing **"ended"** kind still gets "access has ended" everywhere, and "nothing" (a vet) still does too.
- **After creating:** she sees her new colony on the Colonies list and on My colonies, **and nothing else**; her starting row is gone; she now passes the walk as "guardianOne" does.
- **The sign-in door:** the hand-off, the accept page and the Worker's dashboard question each admit her; each still refuses an ended guardian.
- **The database refuses:** a starting row with a colony; a starting row for the team, management or a vet; a cat guardian row with `island` reach; and two starting rows for one person.
- **The People screen refuses:** a starting row with a colony, with another role, with an end date or with a label.
- **Mutation probes** (each makes a test go red, is reverted, and is tabled in the PR): the door admitting a starting row on a route not marked for her; `mayEnter` counting a starting row; the "starting" test accepting a row with no reach; the Colonies list's door letting in someone who sees nothing and holds no starting row; the create transaction leaving the starting row behind.

## 7. Abuse limits (amends §14.2)

**Does this widen the SYC-441 risk?** A little, in one way. Today only someone management has placed on a colony can create colonies. Now management can also invite someone with no colony to vouch for her, and her first colony can be anywhere. Once she has it, she is in exactly the position Decision 14 already accepts (create colonies, add any cat, see its exact position), with the same controls: everything is in the history and on "Recent guardian changes".

**The one real widening is a mistyped address (case 1).** Today a mistyped cat guardian invitation gives a stranger one colony's positions. A mistyped "no colony yet" invitation gives a stranger the power to create a colony and add any cat to it. What limits it is unchanged: 14-day expiry, one-tap withdraw, the "joined in the last 7 days" list, and her first colony showing on "Recent guardian changes".

| Option (Decision D) | Benefits | Risks |
|---|---|---|
| **A. ✅ Recommended. Accept it, and add nothing now.** State the widening in §14.1 and case 1; leave the colony-creation cap with SYC-441, to decide after launch. | Nothing extra to build or maintain; consistent with Decisions 7 and 14. No guardians are invited before Johnny's check anyway (SYC-283). | A mistaken or malicious "no colony yet" invite is noticed only when someone reads "Recent guardian changes". |
| B. Tell management by email when someone creates her first colony. | Noticed within the hour. | More mail to a few volunteers, mostly about nothing; one more thing to translate and test. |
| C. Her first colony needs the team's OK before it's hers. | Nothing happens until a human looks. | Brings back the wait Decision 14 removed, which was the point of Samuel's yes. |

Case 4 ("someone grants themselves more") gains: *the database refuses a starting row with a colony, or for anyone but a cat guardian; only management can give one; she can't give herself one; and creating her first colony removes it.* Case 22 gains: *a cat guardian with no colony yet is in the same position after her first colony.*

## 8. Language

Every new sentence in §2 and §3 is written in English, Greek and French, in the dashboard and email catalogues that already exist, and added to the list Johnny checks under SYC-283. Until a language is live, her pages fall back to English, as today. Colony names stay exactly as typed, in every language.

## 9. The open choices, with recommendations

| | Question | Recommendation |
|---|---|---|
| **A** | How "no colony yet" is stored | **A third kind of reach, "starting"** (§4.2) |
| **B** | Can "no colony yet" have an end date or a label? | **No.** It ends when she creates her colony or management removes it. A label is about her relationship to a colony, and there isn't one yet |
| **C** | Where does she land after signing in? | **My colonies**, with the "Create a colony" button, so every cat guardian has the same home. (The alternative, the Colonies page itself, saves one tap but gives her two different homes before and after her first colony) |
| **D** | Any new abuse limit? | **None now**; accept the stated widening, keep the cap with SYC-441 (§7) |
| **E** | Can "no colony yet" be combined with another role or a colony? | **No**, cat guardian alone, either/or with colonies (§2) |

## 10. What this does not change

The workspace door; what any existing role can see or do; Decision 14 itself; the invite flow's limits and expiry; the offline saved list (she has nothing to save); how a cat comes to be in a colony; the welfare report rules.
