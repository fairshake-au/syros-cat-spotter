# Editing, adding and deleting starter facts

**Status:** Draft for Samuel's approval, 26 October 2026. An independent adversarial review (Sonnet, 26 October) found 2 blockers, 7 major and 9 minor issues. All are folded in below; how each was handled is in §11.
**Owner:** Samuel
**Ticket:** SYC-754. Builds on the App switches page (SYC-383) and the starter facts (SYC-48, [`starter-facts.md`](./starter-facts.md)).
**Decisions** (Samuel, 26 October 2026): all answered, see §8 and §9.

---

## 1. The short version

The App switches page lets the team **show or hide** each of the twenty starter facts. This adds three more things they can do there:

- **Edit** a fact's words, in English, Greek and French.
- **Add** a new fact.
- **Delete** a fact.

A change reaches a phone the next time the app is opened or comes back on screen, once the server's short cache has passed: usually within two minutes (§4.2). No new version of the app is needed, except for phones still on an older version (§3.2).

To make that possible, the facts' words move from inside the app to the server. Phones download them along with the switches they already download, and keep a copy.

---

## 2. What the team sees

The **Starter facts** section of the App switches page keeps its list. Each fact shows its English words, whether it's shown or hidden, and three buttons: **Hide it** / **Show it** (as now), **Edit** and **Delete**.

A small note under a fact says which languages it has, for example *"English and Greek. French readers see the English."* A fact with all three says nothing.

### 2.1 Edit

**Edit** opens a short page with three boxes: **English** (must be filled), **Greek** and **French** (both optional). Each box is pre-filled with the current words. Under each box is a count: *"28 of 35 words"*.

- **Save** puts the new words in the app straight away (Decision 3).
- A fact can't be saved if any box breaks the checks in §5. The page says which box is the problem and keeps what was typed.
- **Someone else's change in the meantime.** If the fact was edited, shown, hidden or deleted by someone else while you had it open, your save is refused, and you see the fact as it is now: *"Someone changed this fact while you were editing. Here it is now; make your change again."* If it was deleted: *"Someone deleted this fact while you were editing. Your words weren't saved."* with what you typed shown, so it can be copied into **Add a fact**.
- **The ear-tip fact keeps its photo** whatever its words say. The edit page for it shows the photo and says *"The app shows this photo above the words."*
- **On one of the twenty original facts,** a line beside **Save** says: *"Phones not yet updated keep showing the old words. If the old words are wrong, hide the fact for now."* (§3.2).

**When the English changes but a translation doesn't.** If the English you're saving differs from the stored English, and the Greek or French you're saving is the same as the stored Greek or French (and not empty), the page asks before saving: *"You changed the English. Check the Greek and French still say the same thing, or empty them so readers see the new English."* with **Save anyway** and **Go back**. A language with no words yet doesn't trigger it.

### 2.2 Add

At the bottom of the list, **Add a fact** opens the same three-box page, empty. A new fact goes to the end of the list on the page, and is **shown straight away** (Decision 3; question C, §8). Pressing **Add** twice by mistake adds it once: the form carries a one-time code, and a second post with the same code shows the fact that was added.

### 2.3 Delete

**Delete** opens a page that shows the fact's words and asks *"Delete this fact? This can't be undone. To stop it appearing for now, hide it instead."* with **Delete it** and **Keep it**.

Deleting is permanent: there's no change history (Samuel, 24 October 2026, for this page). Any fact can be deleted, including the ear-tip fact and the milk fact (Decision 2). Deleting the ear-tip fact removes its photo from the waiting card on updated phones, and it can't be put back from this page, because the page doesn't take photos. (A brand-new phone that hasn't heard from the server yet still has it, §3.1.)

### 2.4 Who can do this

Anyone who can open the App switches page today (the `edit_app_switches` permission), and nobody else (Decision 3). There is no second check before a change goes live. The page's existing warning stays: *"These switches change the public app for everyone… Agree a change with the team first."*

---

## 3. What spotters see

Nothing changes in how the waiting card works (`starter-facts.md` §3). One fact per wait, while a sighting is being sent, never delaying the result.

- **In their language** if the fact has it. **In English** if it doesn't (Decision 1). The card's heading ("While we look…") stays in their language.
- **Edited words** appear from the next wait after the phone has downloaded them.
- **A deleted fact** stops appearing, like a hidden one.
- **A new fact** is slotted into the rest of this round at a random place, so it comes up before the round ends.

### 3.1 Where the words come from at the moment of a wait

The card **never downloads anything**. It uses the copy the phone already has. The phone refreshes that copy when the app opens, when it comes back on screen, and when signal returns, as it does for the switches today. So the card works the same whatever the signal is doing during the send.

- **A phone that has downloaded the facts at least once** uses its last download, words included.
- **A brand-new phone that has never heard from the server** uses the twenty original facts built into the app, in all three languages, with nothing hidden, the ear-tip photo included. This is today's rule for switches that haven't loaded (`starter-facts.md` §9). So on a brand-new phone with no connection yet, a fact the team has edited may appear in its old words, and a hidden or deleted one may appear.
- **If a download goes wrong** (the server couldn't read its facts), the phone keeps the copy it had (§4.2).

### 3.2 Phones still on an older version of the app

A phone on an older version keeps using the words built into it. On those phones:

- **Show/Hide still works**, as now.
- **A deleted original fact disappears**: the server tells older phones it's hidden.
- **Edited words don't appear**: they see the original words. The edit page says so (§2.1).
- **New facts don't appear.**

This lasts until people update the app.

---

## 4. How it works

### 4.1 Where the words live

A new table, `starter_facts`, one row per fact:

| Column | What it holds |
|---|---|
| `id` | The fact's name. The originals keep theirs (`fact.earTip` …). New ones get `fact.new.` plus 8 random letters (letters only, per the project's test-name rule), made by the server; on the rare clash it tries again. The `fact.new.` start means a new id can never match an original. |
| `en`, `el`, `fr` | The words. `en` must be filled; `el` and `fr` are null when empty (never `""`). |
| `shown` | True or false. |
| `position` | Its place in the list on the page. New facts go last. |
| `photo` | True only for the ear-tip fact. Can't be set from the page. |
| `version` | A whole number that goes up by one on every change to the row (edit, show, hide). The edit page carries it, and a save whose number doesn't match is refused (§2.1). |

**The migration** (`0053`) creates the table and fills it with the twenty originals:
- Words are copied from the app's `i18n.ts`. A test checks every seeded row against `TRANSLATIONS.en/el/fr['fact.*']`, character for character.
- `shown` comes from the current `starter_facts_hidden` row. **If there's no row, or it's the wrong shape, it uses the same default the server uses today: the nine facts awaiting Syros Cats' yes are hidden** (`SIGN_OFF_FACT_IDS`).
- It has a rollback block, per `lib/db/migrations/README.md`. The Drizzle schema and snapshot are updated with it.

**The old hidden list stays in step** for as long as older phones exist. Every Show, Hide and Delete, in the same transaction, also rewrites `app_settings.starter_facts_hidden` as *the original twenty minus the ones that exist and are shown*. That means:
- older phones see deletes as hides (§3.2);
- the server can be rolled back to the previous version at any time, and still serves the right Show/Hide state (edits and new facts just stop appearing);
- a Show or Hide made on the old server between the migration and the publish isn't lost: the new server's first start re-copies `shown` from the old list if the old list changed after the migration ran (it compares the row's `updated_at` with the migration time). In practice this window is a few minutes (§6).

Show, Hide, Edit, Add and Delete all take the same lock the page uses today (`app_switches.starter_facts`), so two people's changes never cross.

The **strand**, **core** and **sign-off** labels on the originals (used in planning, not shown anywhere) stay in the app's code for the twenty originals. New facts don't have them. Teaching in full (SYC-61) can add them later.

### 4.2 What the server sends

The answer phones already download (`GET /api/app-settings`) gains one optional field:

- **`facts`**: the facts that are **shown**, in list order, each with `id`, `en`, `el` and `fr` (missing when empty), and `photo`.
- **When the server can't read its facts, it leaves `facts` out**, and never sends an empty list by mistake. A phone treats a missing `facts` as *keep what I have*, and `facts: []` as *nothing is shown*. Tests cover both, including for a phone that only has an older saved copy.
- **`hiddenFacts` stays**, worked out as in §4.1, for older phones. Newer phones ignore it when `facts` is there.
- The API description (`lib/api-spec/openapi.yaml`) adds `facts` as optional, and the generated types are rebuilt.

Timing, stated plainly: each server keeps the answer for up to 60 seconds, and the answer itself may be reused for 60 seconds (`Cache-Control: max-age=60`). A save clears the cache only on the server that took it; with more than one server running, the others catch up within 60 seconds. So a change is visible within about two minutes, at the phone's next refresh (§3.1).

Twenty facts in three languages is about 12 KB, a small addition to a download the phone already makes.

The team page's JSON view of the switches (`GET /api/team/app-switches` with JSON) gains the same `facts` list, with hidden facts included and marked.

### 4.3 What the phone does

- **Saving the download.** The phone keeps its saved switches under the same key (`catSpotters.appSettings.v1`) with a new optional `facts` field, as was done for the extra-photos switch. A saved copy with no `facts` means *the built-in words, with these hidden* (today's behaviour). Nothing already saved is lost.
- **Picking a fact.** The list the waiting card picks from (`visibleFacts`) becomes the saved facts, not the built-in list. The fixed start keeps keying on the names `fact.earTip` and `fact.milk`: second and third wait, **if they still exist and are shown**; otherwise straight into the shuffle.
- **The photo follows the `photo` flag** sent with the fact, not the fact's name. Built-in facts keep their flag from `starterFacts.ts`.
- **Language.** The card shows the words for the app's language; if that's missing (null or empty), the English. An empty string from anywhere is treated as missing.
- **The phone's record of what it has shown** (`catSpotters.waitingCard.v1`) holds fact names. As now, names that no longer exist are dropped from this round's order and new ones are slotted in at random places (`withRepairedOrder`). The seen lists (`seenFacts`, `everSeen`) are also trimmed to names that still exist each time the record is saved, so they don't grow forever.
- **An edited fact keeps its name**, so if it was seen it stays seen. Edits don't make a fact come round again early.
- **Nothing shown** (all deleted or all hidden): the card shows only "While we look…", as when every fact is hidden today.
- **Words are shown as plain text** by the app's text component, which can't show links or formatting. Nothing is stripped; it simply can't render.

### 4.4 The page

The page stays server-made HTML like the other team pages, with forms posting to new routes under `/api/team/app-switches/`: `fact/edit`, `fact/add`, `fact/delete` (plus the existing `fact` for Show/Hide). All need `edit_app_switches`. Each is added to the team-pages walk test's list with its reason. Every save is one database transaction under the lock in §4.1.

Everything typed is escaped where it appears on the page, inside text boxes and in attributes alike, using the page's existing escaping.

The English copy of the facts on the server (`appSwitchFacts.ts`) and its matching test are removed; the table is where the words come from now.

`db-ops set-setting starter_facts_hidden` is **refused** from now on, with *"Facts are changed on the App switches page now."* Its entry in `.github/workflows/db-ops.yml` is removed.

---

## 5. Checks on what's typed

The same rules on the page and in the app, from **one shared copy** of the word-counting code (in `lib/db`, next to the facts' other shared rules). The app's copy in `starterFacts.ts` is replaced by it, and a test runs both against the same examples: « ? » with non-breaking spaces, l’oignon, “Can’t tell”, a number, a dash on its own, a trailing non-breaking space.

| Check | Why | What the page says |
|---|---|---|
| English isn't empty | Every reader sees something | *"Write the fact in English. Greek and French are optional."* |
| 35 words or fewer in each box, counted as `starter-facts.md` §3.3 says | The wait is short | *"The Greek is 41 words. Facts must be 35 words or fewer so people can read them during the wait."* |
| No more than 400 characters in a box (characters, not bytes, so Greek isn't penalised) | Keeps a pasted paragraph out; the longest original is 207 | *"That's too long for a fact."* |
| Spaces at the start and end trimmed; line breaks turned into spaces; invisible control characters removed | A fact is one line on the card | — |
| A box with only spaces counts as empty | — | — |

There's no limit on how many facts there can be.

---

## 6. Rolling it out

1. **Migration to production first**, before the new server code is published (project rule: migrate before republish). The old server keeps running on the old list, which stays correct.
2. **Publish the new server.** On start, it re-copies Show/Hide from the old list if that changed after the migration (§4.1). It starts sending `facts`, and keeps `hiddenFacts` in step.
3. **App update.** New phones read `facts`. Until people update, phones behave as in §3.2.
4. **Later:** stop sending `hiddenFacts` and drop the old row, once older versions have mostly gone. There's no record today of which app version phones run, so this needs one first. A follow-up ticket is filed when this merges: *count app versions in the app-settings request, then retire `hiddenFacts` below a set share.*

---

## 7. Tests that change

Named here so the plan doesn't miss them:
- `routes/appSettings.test.ts`: the exact key list (now with `facts`), and the `hiddenFacts` values (now worked out from the table).
- `routes/team.appSwitches.test.ts`: writes through the table, not the old row; new cases for edit, add, delete, version clash, deleted-while-editing, double add.
- `lib/appSettings.test.ts` (server): defaults and the "can't read facts" case.
- `teamPages/appSwitchFacts.test.ts`: removed with the file.
- App: `waitingCard.test.ts` (facts from saved settings, not the built-in list), `WaitingCard.test.tsx` (words by language with English fallback, photo by flag), `appSettings.test.ts` (missing vs empty `facts`, older saved copy).
- New: seeded rows match `i18n.ts`; shared word count gives the same answers on both sides; `hiddenFacts` equals originals minus shown-and-existing.
- Migration: `lib/db` runner test, as for every migration.

---

## 8. Questions raised while writing this (answered)

Samuel, 26 October 2026, each with a recommendation; he took all three:

- **A. English edited, translation not:** the page asks before saving (§2.1).
- **B. List order:** can't be changed; new facts go last.
- **C. New facts:** go live straight away, as Decision 3.

---

## 9. Decisions already made

Samuel, 26 October 2026, asked one at a time with a recommendation each (SYC-754):

1. **Languages:** English is required; Greek and French are optional. A reader whose language is missing sees the English. *(Recommended was all three required.)*
2. **The original twenty:** full control. Any fact can be edited or deleted, including ear-tip and milk. If they're deleted, new spotters go straight to the shuffle. *(Recommended was "edit all, delete all but two".)*
3. **Who:** the same people who can use the App switches page today. Saves go live straight away.

---

## 10. Not included

- Adding or changing a fact's **photo**.
- A **change history** or undo.
- **Translating** for the team. The page doesn't suggest Greek or French.
- Facts shown **anywhere else** in the app.
- The **feeding nudge** and the donation button, which stay as they are.
- Counting which **app versions** are in use (follow-up, §6 step 4).

---

## 11. How the review was handled

| Finding | What changed |
|---|---|
| B1 Show/Hide lost between migration and publish; rollback serves a stale list | Old list kept in step on every change; re-copy on first start (§4.1, §6) |
| B2 a server read failure could blank every phone's facts | Missing `facts` = keep; `[]` = none; server omits the field on failure (§4.2) |
| M1 missing hidden row would show the nine unapproved facts; new/edited facts skip Syros Cats' yes | Migration uses today's default (§4.1); question C answered: live straight away (§8) |
| M2 timestamp clash check unreliable; delete-while-editing and double Add undefined | Whole-number `version`; both cases defined; one-time code on Add; same lock for all (§2.1, §2.2, §4.1) |
| M3 "added to the end" was wrong; seen lists grow; `visibleFacts` uses built-in list | Random slot, as the code does; seen lists trimmed; `visibleFacts` from saved facts (§3, §4.3) |
| M4 photo tied to the name in several places; English fallback on empty strings | Photo follows the flag; fixed start by name; empty = missing (§4.3) |
| M5 two word counts could disagree | One shared copy and shared examples (§5) |
| M6 API description and generated types; tests that break | `facts` optional in openapi + regenerate (§4.2); §7 |
| M7 db-ops would silently write a list nothing reads | db-ops refuses that key (§4.4) |
| Minor: overclaimed signal; timing; storage key bump; id clashes; escaping; deleted = hidden for old phones; ear-tip on new phones; warning rule; migration mechanics; retiring `hiddenFacts` needs a version count | §3.1; §1, §4.2; keep `.v1` (§4.3); `fact.new.` + 8 letters (§4.1); §4.4, §5; §4.1; §2.3; §2.1; §4.1; §6 step 4 |
