# Editing, adding and deleting starter facts

**Status:** Draft for Samuel's approval, 26 October 2026. Adversarial review pending.
**Owner:** Samuel
**Ticket:** SYC-754. Builds on the App switches page (SYC-383) and the starter facts (SYC-48, [`starter-facts.md`](./starter-facts.md)).
**Decisions already made** (Samuel, 26 October 2026): see §8.

---

## 1. The short version

The App switches page lets the team **show or hide** each of the twenty starter facts. This adds three more things they can do there:

- **Edit** a fact's words, in English, Greek and French.
- **Add** a new fact.
- **Delete** a fact.

A change reaches phones the same way a Show/Hide does now: within a couple of minutes, the next time the app is opened. No new version of the app is needed.

To make that possible, the facts' words move from inside the app to the server. Phones download them along with the switches they already download, and keep a copy.

---

## 2. What the team sees

The **Starter facts** section of the App switches page keeps its list. Each fact shows its English words, whether it's shown or hidden, and three buttons: **Hide it** / **Show it** (as now), **Edit** and **Delete**.

A small note under a fact says which languages it has, for example *"English and Greek. French readers see the English."* A fact with all three says nothing.

### 2.1 Edit

**Edit** opens a short page with three boxes: **English** (must be filled), **Greek** and **French** (both optional). Each box is pre-filled with the current words. Under each box is a count: *"28 of 35 words"*.

- **Save** puts the new words in the app straight away (Decision 3).
- A fact can't be saved with more than **35 words** in any language, or with an empty English box. The page says which box is the problem and keeps what was typed.
- If someone else saved that fact while you had it open, your save is refused: *"Someone changed this fact while you were editing. Here it is now; make your change again."* Nobody's words are lost without them seeing.
- **The ear-tip fact keeps its photo** whatever its words say. The edit page for it shows the photo and says *"The app shows this photo above the words."*

If the English is changed and Greek or French is left as it was, the page warns before saving: *"You changed the English. Check the Greek and French still say the same thing, or empty them so readers see the new English."* This is a warning, not a block (§7, open question A).

### 2.2 Add

At the bottom of the list, **Add a fact** opens the same three-box page, empty. A new fact is **shown straight away** and goes to the end of the list. It's included in each phone's next round of facts (§4.3).

### 2.3 Delete

**Delete** opens a page that shows the fact's words and asks *"Delete this fact? This can't be undone. To stop it appearing for now, hide it instead."* with **Delete it** and **Keep it**.

Deleting is permanent: there's no change history (Samuel, 24 October 2026, for this page). Any fact can be deleted, including the ear-tip fact and the milk fact (Decision 2). Deleting the ear-tip fact also removes its photo from the app's facts, and it can't be put back from this page, because the page doesn't take photos.

### 2.4 Who can do this

Anyone who can open the App switches page today, and nobody else (Decision 3). There is no second check before a change goes live. The page's existing warning stays: *"These switches change the public app for everyone… Agree a change with the team first."*

---

## 3. What spotters see

Nothing changes in how the waiting card works (`starter-facts.md` §3). One fact per wait, while a sighting is being sent, never delaying the result.

- **In their language** if the fact has it. **In English** if it doesn't (Decision 1). The card itself ("While we look…") stays in their language.
- **Edited words** appear from the next wait after their phone has heard from the server.
- **A deleted fact** stops appearing, like a hidden one.
- **A new fact** joins the facts the phone hasn't shown yet in this round.

### 3.1 With no signal, and before the phone has ever heard from the server

The card only appears while a sighting is being sent, so the phone has signal at that moment. It still uses **its saved copy** of the facts, not a fresh download, so the card never waits on one.

- **A phone that has heard from the server at least once** uses the facts from its last download, including the words.
- **A brand-new phone that hasn't heard from the server yet** uses the twenty original facts built into the app, in all three languages, with nothing hidden. This is today's rule for switches that haven't loaded (`starter-facts.md` §9). So for one wait or two on a new phone, a fact the team has edited may appear in its old words, and a deleted one may appear.

### 3.2 Phones still on an older version of the app

A phone on an older version keeps using the words built into it. On those phones:

- **Show/Hide still works**, as now.
- **A deleted original fact disappears**: the server tells older phones it's hidden.
- **Edited words don't appear**: they see the original words. If an edit corrects something wrong, the team should hide that fact until most phones are updated. The page says this beside **Save** on an original fact: *"Phones not yet updated keep showing the old words. If the old words are wrong, hide the fact for now."*
- **New facts don't appear.**

This lasts until people update the app.

---

## 4. How it works

### 4.1 Where the words live

A new table, `starter_facts`, one row per fact:

| Column | What it holds |
|---|---|
| `id` | The fact's name. The originals keep theirs (`fact.earTip` …). New ones get `fact.c` plus a letters-only tag, made by the server. |
| `en`, `el`, `fr` | The words. `en` must be filled; `el` and `fr` may be empty (null). |
| `shown` | True or false. Replaces the `starter_facts_hidden` list. |
| `position` | Its place in the list on the page. New facts go last. |
| `photo` | True only for the ear-tip fact. Can't be set from the page. |
| `updated_at` | When it last changed. Used to refuse a save over someone else's change (§2.1). |

A migration fills the table with the twenty originals, words copied from the app's `i18n.ts`, with `shown` set from the current hidden list. After that, the hidden list in `app_settings` is no longer written by the page. It stays readable for one release so a rollback is safe (§6).

The **strand**, **core** and **sign-off** labels on the originals (used in planning, not shown anywhere) stay in the app's code for the twenty originals. New facts don't have them. Teaching in full (SYC-61) can add them later if it needs them.

### 4.2 What the server sends

The app-settings answer the phones already download (`GET /api/app-settings`) gains one field:

- `facts`: the facts that are **shown**, in list order, each with `id`, `en`, `el`, `fr` (missing when empty) and `photo`.

It keeps `hiddenFacts`, for older phones (§3.2): every original fact that's hidden **or deleted**. Newer phones ignore it when `facts` is there.

The answer is cached for a short time as now (`SETTINGS_CACHE_MS`), and each save on the page clears this server's cache, as Show/Hide does.

Twenty facts in three languages is about 12 KB, a small addition to a download the phone already makes when the app opens.

### 4.3 What the phone does

- It saves `facts` with the switches it already keeps (`catSpotters.appSettings.v1` becomes `.v2`; a saved `.v1` copy is read as "words as built in, these hidden").
- The waiting card picks from the saved facts instead of the built-in list. The fixed start stays: the ear-tip fact on the second wait and the milk fact on the third, **if they still exist and are shown**. Otherwise straight into the shuffle.
- The phone's record of what it has shown (`waitingCard` record) holds fact names. Names that no longer exist are dropped when it's read. A new fact not in this round's order is added to the end of it, so it comes up before the round ends.
- A fact whose words changed but whose name didn't counts as already seen if it was seen. Edits don't make a fact come round again early.
- If the server sends no facts at all (all deleted or all hidden), the card shows only "While we look…", as when every fact is hidden now.
- Words from the server are shown as plain text, never as links or formatting.

### 4.4 The page

The page stays server-made HTML, like the rest of the team pages, with forms posting to new routes under `/api/team/app-switches/`: `fact/edit`, `fact/add`, `fact/delete`. All need `edit_app_switches`, as the Show/Hide route does now. Each is added to the team-pages walk test's list with its reason. Every save happens in one database transaction, and Show/Hide moves to the new `shown` column.

The English copy of the facts on the server (`appSwitchFacts.ts`), and the test that checks it matches the app, are removed: the table is now where the words come from.

---

## 5. Checks on what's typed

| Check | Why | What the page says |
|---|---|---|
| English isn't empty | Every reader can see something | *"Write the fact in English. Greek and French are optional."* |
| 35 words or fewer, in each language, counted the way the app counts them (`starter-facts.md` §3.3) | The wait is short | *"The Greek is 41 words. Facts must be 35 words or fewer so people can read them during the wait."* |
| No more than 400 characters in any box | Keeps a pasted paragraph out | *"That's too long for a fact."* |
| Spaces at the start and end are trimmed; a box with only spaces counts as empty | — | — |

There's no limit on how many facts there can be.

---

## 6. Rolling it out

1. **Server first.** The migration creates and fills the table. The server starts sending `facts` and keeps `hiddenFacts`. Older phones notice nothing.
2. **App update.** The new app reads `facts`. Until it's installed, phones behave as in §3.2.
3. **Later, once nearly every phone is updated:** stop sending `hiddenFacts` and drop the old `app_settings` row. That's a separate ticket, filed when this is merged.

The migration goes to production **before** the new server code is published, so the new code never runs without its table.

---

## 7. Open questions for Samuel

**A. When the English is edited, what happens to the Greek and French?**
- *Warn, keep them (recommended).* The page warns, as in §2.1. Benefit: a typo fix in English doesn't wipe good translations. Risk: someone ignores the warning and Greek readers see the old meaning.
- *Clear them automatically.* Greek and French readers see the new English until someone translates again. Benefit: nobody ever sees an out-of-date translation. Risk: every English typo fix loses two translations.
- *Ask with a tick box.* "The Greek and French still say the same" must be ticked to keep them. Benefit: a deliberate choice each time. Risk: one more step, and people tick without reading.

**B. Should the team be able to change the order of the list?**
- *No, new facts go last (recommended).* The order only matters on the page: phones shuffle anyway, apart from ear-tip and milk at the start.
- *Yes, with Move up / Move down.* More to build, for little difference to spotters.

---

## 8. Decisions already made

Samuel, 26 October 2026, asked one at a time with a recommendation each (SYC-754):

1. **Languages:** English is required; Greek and French are optional. A reader whose language is missing sees the English. *(Recommended was all three required.)*
2. **The original twenty:** full control. Any fact can be edited or deleted, including ear-tip and milk. If they're deleted, new spotters go straight to the shuffle. *(Recommended was "edit all, delete all but two".)*
3. **Who:** the same people who can use the App switches page today. Saves go live straight away.

---

## 9. Not included

- Adding or changing a fact's **photo**.
- A **change history** or undo.
- **Translating** for the team. The page doesn't suggest Greek or French.
- Facts shown **anywhere else** in the app.
- Anything about the **feeding nudge** or the donation button, which stay as they are.
