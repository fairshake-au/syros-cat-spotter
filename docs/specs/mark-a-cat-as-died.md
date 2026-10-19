# Marking a cat as died, from the team's cat page

**Status:** Draft for Samuel's approval, 18 October 2026. Not yet adversarially reviewed.
**Owner:** Samuel
**Covers:** SYC-513.
**Related:** [`cat-record-data-spine.md`](./cat-record-data-spine.md) §3.2–§3.4 (life status, a sighting after a death, presumed deceased) · [`claiming-a-cat.md`](./claiming-a-cat.md) §7 (removing an owner) · [`roles-and-invites.md`](./roles-and-invites.md) §2.2, §7.2 (a cat guardian's own "Has died") · SYC-362 (the "Are you sure?" page for an owned cat) · SYC-489 (litter reports on a dead cat)

**What this document owns.** How someone on the Syros Cats team records that a cat has died, on the team's page for one cat (team.catspotters.com, `/api/team/cats/:id`). It does **not** change what a death *means*: what the public sees, which notifications stop, and how a later sighting brings a cat back all stay as `cat-record-data-spine.md` sets them out. It does not touch the public app, the cat guardian's own cat page (`/team/my/cats/:id`, which already has "Has died"), or the "Report an issue" queue.

---

## 1. The short version

The cat's page gets its own **"This cat has died"** button. You don't have to know that a death is filed under "Update where the cat lives".

Pressing it opens one short page that:

- says plainly what will happen;
- asks **when** it happened. The choices are "Recently, or I'm not sure" or "On a date I know", so nobody has to invent a date;
- asks **how we know**, in a few words;
- has one button to save.

If the cat has an owner, the same page says the owner will be removed. There is no second "Are you sure?" page.

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

---

## 3. Where the button is

- It sits in **"Update this cat"**, as the **last item**, below the folded forms and separated from them by a little space. It is a plain button, not another folded section, so it is always visible.
- It reads **"This cat has died"**. It is not styled in red: it isn't an alarm, and red is kept for things like "Remove owner" and "Hide from the public".
- It is shown only to someone who may change a cat's life status (`set_life_status`), the same people who can use the life-status form today.
- It is **not shown when the cat is already recorded as died** (§6). It **is** shown when the cat is only *presumed* dead after three years without being seen. That is when the team is most likely to confirm it.

It is a link to its own page (`GET /api/team/cats/:id/died`). Like the rest of the team site, that page is drawn by the server and works without scripts.

---

## 4. The "This cat has died" page

**Heading:** "Agatha has died" (the cat's name), with the cat's main photo, small, so nobody records the wrong cat.

**What will happen** (a short list, in these words):

- The public will see "No longer with us" on Agatha's page.
- Nobody will get alerts or news about Agatha any more.
- Agatha can't be claimed, and spotters will see her greyed out when picking a cat.
- If someone spots Agatha after the date below, she will show as alive again, and you'll see that on this page.
- *Only when the cat has an owner and this person may remove owners:* "Agatha's owner will be removed. They stop seeing her exact spot and getting alerts. They are not told."
- *Only when the cat has an owner and this person may **not** remove owners:* "Agatha has an owner. The owner stays until someone who can remove owners does so."

**When did it happen?** Two choices, the first already chosen:

- **"Recently, or I'm not sure"**: saved as today.
- **"On a date I know"**: shows a date box. Today or earlier only. The page refuses a future date or no date, as the current form does.

Why "not sure" saves as **today** rather than a guess further back: the date decides which later sightings bring the cat back (§3.2 of the data spine). A sighting from before the team heard the news is not evidence the cat is alive now, and a date later than the real one never wrongly revives a cat. A guessed earlier date could.

**How do you know?** A required text box, up to 500 characters, as every team change has a reason today. The hint reads: "For example: found by the harbour; Maria, her cat guardian, told us; the vet let us know."

**Buttons:** "Save: Agatha has died" and a link "Back to Agatha (nothing changed)".

This page **is** the confirmation. Saving records the death and, when allowed, removes the owner, in one go. No second page follows.

---

## 5. What saving does

Saving records the same thing the current form records, through the same code path:

- one team life-status statement: `deceased`, with the reason, the person's name and role, and the date from §4;
- if the cat has an owner and this person may remove owners, the owner is removed in the **same** step, exactly as "Remove owner" does today (`removeOwnerAndSay`, `if_owner`). Nobody is told.

No new kind of record, no new field, and no change to the database.

Then the cat's page opens again, with the notice from §6 at the top.

If two people press save at once, or the cat was merged into another cat in the meantime, the same rules as today's life-status form apply.

---

## 6. A cat that has died, on its page

At the top of the summary, where the cat guardian's 30-day notice already appears, a calm notice:

> **Agatha has died.** Recorded by Eleni on 18 Oct 2026. *How we know:* found by the harbour.
> If this is a mistake, use **Mark wrong** on it in the history. [Go to it]

- "Go to it" jumps to that statement in the history, where **Mark wrong** already lets the team put the right status back. No new undo is needed.
- If the death was recorded by the cat guardian, the existing 30-day notice ("Recently marked as no longer with us by the cat guardian…") is shown **instead**, so the page never says the same thing twice.
- If a later sighting has brought the cat back, the notice is not shown. The existing "What we know about this cat" section already opens by itself to show the disagreement.
- The "This cat has died" button (§3) is not shown while this notice is.

---

## 7. Tidying the old ways in

So there is one obvious way to record a death:

- **"Update where the cat lives"** no longer offers "No longer with us". Its date box stops saying "(needed for 'No longer with us')".
- **"Remove owner"** no longer offers "No longer with us". It offers "Lives on the street" and "In Syros Cats' care", and a line under them says: "If the cat has died, use 'This cat has died' instead."
- **"Mark wrong"** in the history **keeps** "No longer with us". It corrects what an older statement said ("this wasn't homed, she died"), which isn't the same as recording news.
- The JSON routes (`POST /api/team/cats/:id/life-status`, `/remove-owner`) keep accepting `deceased`, unchanged. Nothing outside the team pages is affected.

---

## 8. Phones and wide screens

The team uses this on phones on the street. The page is checked at about **390 px** wide and at desktop width before the PR opens. The button is a full-width tap target on a phone. The photo on the died page is small enough that the save button is visible without much scrolling.

---

## 9. What doesn't change

- What a death does elsewhere: the public line, no pushes, no nightly news, no round-ups, no claiming, greyed out in the picker.
- A later sighting reviving a cat (data spine §3.2).
- "Presumed deceased" after three years, and the public never being told a cat may have died.
- The cat guardian's own "Has died" on their colony cat page, and the public's "Report an issue → This cat has died".
- Languages: the staff cat page's words stay in the same language set they are in today.

---

## 10. Decisions for Samuel

Each has a recommendation. They are written so the spec reads as if the recommendation is accepted.

**D1. Take "No longer with us" out of the two older forms (§7)?**
- *Yes (recommended):* one way to do it, so nobody has to find it twice. Risk: someone used to the old way looks for it there. The line in "Remove owner" points them to the button.
- *No, keep all three:* nothing to relearn, but the confusing route stays.

**D2. Is "How do you know?" required?**
- *Required (recommended):* every team change today has a reason, and a death is the change most worth explaining later. Risk: one more box when someone is upset. The hint gives quick examples.
- *Optional:* faster, but the history may say only "died" with no source.

**D3. When the team isn't sure of the date, save today's date (§4)?**
- *Today (recommended):* never wrongly brings a cat back from a sighting before the news. Risk: the history shows the date the team heard rather than when the cat died. The "How do you know?" note can carry the real story.
- *Make them pick a date anyway:* what happens today. People invent one, and a too-early guess can wrongly bring a cat back.

**D4. Show the "Agatha has died" notice at the top of the page (§6)?**
- *Yes (recommended):* it's obvious at a glance, and it's where the undo is explained.
- *No:* the facts already say "No longer with us", but anyone looking for how to undo has to search the history.

---

## 11. How we'll know it works (tests)

- The button appears for someone with `set_life_status` and not for someone without it. It's hidden when the cat is recorded as died, and shown when the cat is only presumed dead.
- "Recently, or I'm not sure" saves a `deceased` statement dated now. "On a date I know" saves it at that date. A future date or a missing date is refused with the page kept as filled.
- A blank "How do you know?" is refused.
- An owned cat with a remover: one save removes the owner and records the death, with no extra confirm page. Without a remover, the owner stays and the page says so.
- The page after saving shows the §6 notice with a working link to the statement. A guardian-recorded death shows only the guardian notice. A cat revived by a sighting shows neither.
- "Update where the cat lives" and "Remove owner" no longer list "No longer with us". "Mark wrong" still does. The JSON routes still accept `deceased`.
- The page renders at 390 px and on desktop.
