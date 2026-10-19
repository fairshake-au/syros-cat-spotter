# Marking a cat as died, from the team's cat page

**Status:** Draft for Samuel's approval, 18 October 2026. One adversarial review pass done and folded in (§12).
**Owner:** Samuel
**Covers:** SYC-513.
**Related:** [`cat-record-data-spine.md`](./cat-record-data-spine.md) §3.2–§3.4 (life status, a sighting after a death, presumed deceased) · [`claiming-a-cat.md`](./claiming-a-cat.md) §7 (removing an owner) · [`roles-and-invites.md`](./roles-and-invites.md) §2.2, §7.2 (a cat guardian's own "Has died") · SYC-362 (the "Are you sure?" page for an owned cat) · SYC-489 (litter reports on a dead cat)

**What this document owns.** How the Syros Cats team records that a cat has died, on the team's page for one cat (team.catspotters.com, `/api/team/cats/:id`). It does **not** change what a death *means*: what the public sees, which notifications stop, and how a later sighting brings a cat back all stay as `cat-record-data-spine.md` sets them out. It does not touch the public app, the cat guardian's own cat page (`/team/my/cats/:id`, which already has "Has died"), or the "Report an issue" queue.

---

## 1. The short version

The cat's page gets its own **"This cat has died"** button. You no longer have to know that a death is filed under "Update where the cat lives".

Pressing it opens one short page that:

- says plainly what will happen;
- asks **when** it happened. The date box is optional: leave it blank if you're not sure;
- asks **how we know**, in a few words;
- has one button to save.

If the cat has an owner, the same page says the owner will be removed. There is no second "Are you sure?" page.

If the date would leave the cat showing as alive, the page says why and asks again rather than saving something that looks done but isn't. That happens when someone spotted the cat after that date, or when a newer change already says otherwise.

Afterwards, the cat's page says at the top that the cat has died, when, and who recorded it. It also says how to undo it if it was a mistake.

---

## 2. The problem today

To record a death today, someone on the team has to:

1. open **"Update where the cat lives"**, a folded section, which is not where anyone looks for a death;
2. choose **"No longer with us"** from a list next to "Lives on the street" and "Has a home";
3. type an **exact date**, which is refused if blank, even though the team often only knows "Maria found her this week";
4. type a reason;
5. for a cat with an owner, get a second "Are you sure?" page about removing the owner.

The same "No longer with us" choice also appears inside **"Remove owner"**, so there are two places to record a death and neither is labelled as one.

Nothing warns the team when the date they type can't win:

- **Someone spotted the cat after that date.** The cat shows as alive straight away.
- **A newer change of where the cat lives already stands.** The newest-dated change counts, so a death dated before it has no effect.

---

## 3. Where the button is

- It sits in **"Update this cat"**, as the **last item**, below the folded forms and separated from them by a little space. It looks like a button, full width on a phone, and it is always visible rather than folded away.
- It reads **"This cat has died"**. It is not red: it isn't an alarm, and red is kept for things like "Remove owner" and "Hide from the public".
- **Who sees it:** the island-wide team, meaning the same people who see "Update where the cat lives" on this page today (`set_life_status` with no colony limit). Cat guardians keep using "Has died" on their own colony cat page.
- It is **not shown when the cat is recorded as died** (§6). It **is** shown when the cat is only *presumed* dead after three years without being seen. That is when the team is most likely to confirm it. It is also shown when a later sighting has brought a dead cat back.

It opens its own page, `GET /api/team/cats/:id/died`. The button is a small form that goes to that page, so it looks and behaves like the page's other buttons. Like the rest of the team site, the page is drawn by the server and needs no scripts.

---

## 4. The "This cat has died" page

**Heading:** "Agatha has died", using the cat's name. The cat's main photo is shown small, so nobody records the wrong cat. A cat with no photo shows the usual "No photo" box. The team always sees the photo, even if it is hidden from the public.

**What will happen:** a short list, in these words.

- The public will see "No longer with us" on Agatha's page.
- Nobody will get alerts or news about Agatha any more.
- Agatha can't be claimed. Spotters can't pick her by hand: she is greyed out in the list.
- If someone spots Agatha after the date below, she will show as alive again, and you'll see that on this page. That includes a photo taken earlier but only sent once the spotter had signal.
- *Only when the cat has an owner, or a home whose owner deleted their data, and this person may remove owners:*
  - **With an owner:** "Agatha's owner will be removed. They stop seeing her exact spot and getting alerts. They are not told. Undoing this later won't put the owner back."
  - **With a home whose owner deleted their data:** "Agatha's old home details will be cleared."
- *Only when the cat has an owner and this person may **not** remove owners:* "Agatha has an owner. The owner stays until someone who can remove owners does so."

**Date it happened:** one optional date box, labelled "Date it happened (leave blank if you're not sure)". It accepts today or earlier.

- **Blank, or today's date:** saved as **right now**. A sighting from earlier today, before the news reached the team, is not evidence the cat is alive now. Saving "now" never wrongly brings a cat back.
- **An earlier date:** saved as that day, the same way dates are saved today.

**How do you know?** A required text box, up to 500 characters, as every team change has a reason today. The hint reads: "For example: found by the harbour; Maria, her cat guardian, told us; the vet let us know."

**Buttons:** "Save: Agatha has died" and a link "Back to Agatha (nothing changed)".

This page **is** the confirmation. Saving records the death and, when allowed, removes the owner, in one go. No second page follows.

**When the page says no.** The page comes back with everything still filled in and one plain message. Each case:

- **No reason given.** "Say in a few words how we know."
- **A future date.** "The date can't be in the future."
- **Someone spotted the cat after the date.** "Agatha was spotted on 12 Oct, after that date. Saving it would show her as alive straight away. Leave the date blank, or check that sighting in the history first."
- **A newer change of where the cat lives already stands.** "Eleni recorded “Has a home” on 11 Oct, after that date, so this wouldn't take effect. Leave the date blank, or use Mark wrong on that change first."

The last two checks are made on the server, at the moment of saving.

**Opening the page when it can't be used:**

- **The cat is already recorded as died.** The cat's page opens with the notice "Agatha is already recorded as died. Nothing was changed."
- **Someone without permission.** The same refusal as the cat page gives today.
- **No such cat.** The same "No such cat" page as today.

---

## 5. What saving does

The page posts to its own route, `POST /api/team/cats/:id/died`, allowed for the same people as §3.

It records the same thing the current life-status form records. There is no new kind of record, no new field, and no change to the database:

- one team life-status change: `deceased`, with the reason, the person's name and role, and the date from §4;
- if the cat has an owner, or a home whose owner deleted their data, and this person may remove owners: the owner is removed in the **same** step, exactly as "Remove owner" does today (`removeOwnerAndSay`, `if_owner`). Nobody is told.

**Two people at once.** The cat is locked while the server checks and saves. If the second save finds the cat already recorded as died, it writes nothing and shows "Agatha is already recorded as died. Nothing was changed." This holds whether or not the cat has an owner.

**A cat merged into another.** The died page and route treat a merged-away cat exactly as the existing life-status form does. The implementation plan confirms which cat the change lands on and adds a test for it.

Then the cat's page opens at the top, where the §6 notice is. If the cat kept its owner because this person may not remove owners, the notice adds: "Agatha still has an owner. Ask someone who can remove owners."

---

## 6. A cat that has died, on its page

At the top of the summary, where the cat guardian's 30-day notice already appears, a calm notice:

> **Agatha has died**, about 12 Oct 2026. Recorded by Eleni on 18 Oct 2026. *How we know:* found by the harbour.
> If this is a mistake, use **Mark wrong** on it in the history. [Go to it]

- The first date is when it happened. It is left out when that's the same day it was recorded.
- "Go to it" jumps to that change in the history, where **Mark wrong** already lets the team put the right status back. No new undo is needed. Mark wrong does not bring back an owner who was removed. The §4 page says so before saving.

**When the notice shows:** when the cat's status, as the page works it out, is "No longer with us" and nothing disagrees with it. That covers a death recorded with this button, through Mark wrong, or by a cat guardian more than 30 days ago (then it names the cat guardian).

**When it doesn't:**

- **A cat guardian recorded the death in the last 30 days.** Their existing notice, "Recently marked as no longer with us by the cat guardian…", shows **instead**, so the page never says the same thing twice.
- **A later sighting has brought the cat back.** The existing "What we know about this cat" section already opens by itself to show the disagreement.

While this notice shows, the "This cat has died" button (§3) is hidden.

---

## 7. Tidying the old ways in

So there is one obvious way to record a death:

- **"Update where the cat lives"** no longer offers "No longer with us". Its date box stops saying "(needed for 'No longer with us')".
- **"Remove owner"**, for a cat that is **alive**, offers "Lives on the street" and "In Syros Cats' care". A line under them says: "If the cat has died, use 'This cat has died' instead."
- **"Remove owner"**, for a cat **already recorded as died** that still has an owner, offers one choice: "Still no longer with us". Saving removes the owner and writes **no** new change of status, so the death and its date stand. This needs a small option in `removeOwnerAndSay` to skip writing a status. Without it, removing the owner of a dead cat would bring it back to life. That case comes up when:
  - someone who couldn't remove owners recorded the death;
  - an owner claimed the cat before it died;
  - a cat guardian marked the cat died.
- **"Mark wrong"** in the history **keeps** "No longer with us". It corrects what an older change said ("this wasn't homed, she died"), which isn't the same as recording news.
- The existing POST routes (`/life-status`, `/remove-owner`), whether used from a form or as JSON, keep accepting `deceased` as they do today, so nothing outside these two forms changes.

---

## 8. Phones and wide screens

The team uses this on phones on the street. The page is checked at about **390 px** wide and at desktop width before the PR opens. The button is a full-width tap target on a phone. The photo on the died page is small enough that the save button is visible without much scrolling. The form uses a proper group label for screen readers, like the page's other forms.

---

## 9. What doesn't change

- What a death does elsewhere: the public line, no pushes, no nightly news, no round-ups, no claiming, greyed out in the picker.
- A later sighting reviving a cat (data spine §3.2).
- "Presumed deceased" after three years, and the public never being told a cat may have died.
- The cat guardian's own "Has died" on their colony cat page, and the public's "Report an issue → This cat has died".
- Language: the team's cat page is in English, and so is this. The Greek and French word lists are for the cat guardian's pages and aren't touched. Staff-facing words avoid "statement", as the page's word test already requires.

---

## 10. Decisions for Samuel

Each has a recommendation. They are written so the spec reads as if the recommendation is accepted.

**D1. Take "No longer with us" out of the two older forms (§7)?**
- *Yes (recommended):* one way to do it, so nobody has to find it twice. Risk: someone used to the old way looks for it there. The line in "Remove owner" points them to the button.
- *No, keep all three:* nothing to relearn, but the confusing route stays.

**D2. Is "How do you know?" required?**
- *Required (recommended):* every team change today has a reason, and a death is the change most worth explaining later. Risk: one more box when someone is upset. The hint gives quick examples.
- *Optional:* faster, but the history may say only "died" with no source.

**D3. When the team isn't sure of the date, leave it blank and save "now" (§4)?**
- *Blank means now (recommended):* nobody has to invent a date, and it never wrongly brings a cat back. Risk: the history shows when the team heard, not when the cat died. The "How do you know?" note can carry the real story.
- *Make them pick a date:* what happens today. People invent one, and a too-early guess can wrongly bring a cat back.

**D4. When the date would leave the cat showing as alive, refuse and explain (§4)?**
- *Refuse and explain (recommended):* the team never sees "saved" for a death that didn't take. Risk: one more message to read. It tells them exactly what to do.
- *Save anyway:* simpler, but the page says the cat is alive straight after the team recorded its death, with no reason given.

**D5. Show the "Agatha has died" notice at the top of the page (§6)?**
- *Yes (recommended):* it's obvious at a glance, and it's where the undo is explained.
- *No:* the facts already say "No longer with us", but anyone looking for how to undo has to search the history.

---

## 11. How we'll know it works (tests)

**The button**
- It appears for the island-wide team and not for anyone without `set_life_status`.
- It's hidden when the cat is recorded as died, and shown when the cat is only presumed dead or was brought back by a sighting.

**Saving and its date**
- A blank date, or today's date, saves `deceased` dated now, including after midday.
- An earlier date saves at that day.
- A future date is refused with the page kept as filled.
- A blank "How do you know?" is refused.

**The two "would stay alive" refusals**
- A date earlier than the cat's last sighting is refused with the sighting's date.
- A date earlier than a newer standing change of where the cat lives is refused with who made it and when.
- In both cases nothing is written.

**Owners**
- **Owned cat, person can remove owners:** one save removes the owner and records the death, with no extra confirm page.
- **Home whose owner deleted their data:** it is cleared too.
- **Person can't remove owners:** the owner stays and the notice says so.

**Repeats and bad visits**
- A second save on a cat already recorded as died writes nothing and says so, with or without an owner.
- Opening the died page for an already-dead cat goes back to the cat page with that notice.
- No permission gets today's refusal, and no such cat gets today's "No such cat" page.
- A merged-away cat behaves as the life-status form does.

**The notice**
- After saving, the §6 notice shows with the date it happened and a working link to the change.
- A cat guardian's death within 30 days shows only the cat guardian's notice. After 30 days, the §6 notice shows and names them.
- A cat brought back by a sighting shows neither.

**The tidied forms**
- "Update where the cat lives" no longer lists "No longer with us".
- "Remove owner" doesn't list it for a live cat. For a dead cat it offers "Still no longer with us", which writes no new status.
- "Mark wrong" still lists it.
- The existing routes still accept `deceased`.

**Words and layout**
- The page's word test includes the new words.
- The page renders at 390 px and on desktop.

---

## 12. Adversarial review, 18 October 2026

One independent pass checked every claim against the code. What it found and what changed:

- **An earlier date could silently not take effect.** This happens when a newer change already stands, or someone spotted the cat after that date. The page now refuses and explains (§4, D4).
- **"Today" was saved as midday,** so a sighting that afternoon would bring the cat straight back. Today now saves as now (§4).
- **The page couldn't use the existing route,** which needs an exact date and sends its own "Are you sure?" page. It now has its own route (§5).
- **A date box that only appears after a choice needs scripts.** The radios are gone; one optional date box replaces them (§4).
- **Removing the owner of an already-dead cat would have brought it back to life** once "No longer with us" left "Remove owner". There's now "Still no longer with us", which writes no new status (§7).
- **Two saves at once, an already-dead cat, a merged cat, and bad visits** are now covered (§4, §5).
- **Mark wrong doesn't bring back a removed owner.** The page says so (§4, §6).
- **The notice rule is now exact.** That covers a cat guardian's death after 30 days, deaths through Mark wrong, and showing the date it happened (§6).
- **Who sees the button is now stated as the island-wide team.** A home whose owner deleted their data is covered (§3, §4).
- **Language, the word test, and the missing-photo and accessibility cases** are now stated (§4, §8, §9).

Not taken: the reviewer said "greyed out in the picker" had no code behind it. It does, in the public app's cat picker (`CatPicker.tsx`, `pickerDeceased`), so the wording stays.
