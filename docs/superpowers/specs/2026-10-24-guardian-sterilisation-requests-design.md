# Cat guardians asking Syros Cats to pay for sterilisation (SYC-284)

**Status:** Adversarial review done (24 Oct 2026), findings folded in. **Waiting for Samuel's approval**, including the four decisions in "Decisions for Samuel" below. Nothing is built from this until he approves it.

**Linear:** SYC-284 (this design), under SYC-610 (Epic: Guardians, volunteers and roles). Builds on SYC-677 (vet visit batches, `2026-10-24-vet-visit-batches-design.md`). Related: SYC-686 (site-public requests in "Needs an OK"), SYC-476 (the "Needs an OK (N)" line on Home), SYC-53 (roles, `docs/specs/roles-and-invites.md`), SYC-283 (Johnny's Greek and French check).

## Why

Samuel described how a sterilisation round really runs (24 Oct 2026):

> "Syros Cats volunteers (and community helpers, e.g. guardians) will trap cats, Syros Cats pays for the sterilisation and vaccinations, and then Syros Cats keeps a record with the cat's photo and the cost they approved/paid"

Cat guardians are the people most often standing next to an unsterilised cat. They arrange sterilisation that Syros Cats pays for, at **€50–60 per cat** (roles spec Q8, 12 Oct 2026). Done by phone or WhatsApp, three things get lost:

- **the ask**: which cats, from which colony, and what Syros Cats agreed to pay;
- **the proof**: the photos of each cat, which end up in a chat thread instead of on the cat's record;
- **the link** between what was approved and what was paid, so the team can't see how much of its sterilisation money went where.

This design puts the whole exchange in the app. A cat guardian asks. The team says yes, with a limit, or no. The guardian takes the cats to the vet and sends back the photos. The team records them as a vet visit batch, the same way it records any round. Nothing is written on a cat's record until the team has confirmed which cat it is.

## The whole journey in one paragraph

Eleni is the cat guardian for Vaporia. Three of her cats aren't sterilised, and she has seen a new young female. On her colony page she taps **Ask Syros Cats to pay for sterilisation**, ticks the three cats, adds "1 cat not on the app yet", picks the clinic and the week she hopes to go, and sends it. She sees "4 cats, about €220. Waiting for Syros Cats". Jacky sees it in **Needs an OK** on the dashboard, with this month's sterilisation budget beside it, and approves 4 cats at up to €55 each. Eleni sees "Approved: up to 4 cats, up to €55 each, until 19 Dec". She traps the cats and the vet does them. Then she opens the request and taps **Send the photos**: the date and the clinic, one or more photos per cat, and for each cat which of hers it is, or "a cat not on the app". In Needs an OK the team taps **Record these**, which opens a vet visit batch already filled in. They confirm each cat by photo match, put in what the vet charged, and save. Eleni's three cats show as sterilised in her colony, the new cat appears in the app, and her request reads "Done: 4 cats recorded on 12 Nov. Thank you."

## Goals

- A cat guardian can ask Syros Cats to pay for sterilising cats in her colonies, including cats nobody has recorded yet.
- The team approves or declines each request, and an approval says how many cats and the most Syros Cats will pay for each.
- The team sees its sterilisation spending against a monthly budget when it decides, and the budget can't be overspent by accident.
- After the vet, the guardian sends the photos and details back through the request. They become a vet visit batch the team only has to check and save.
- The guardian can always see where her request stands, in her own language.
- Every approved and paid euro can be traced from the request to the vet visit on each cat.

## Non-goals

- **Booking the vet.** The guardian arranges the appointment with the clinic herself. The app records the clinic and the week she plans, not a booking.
- **Paying anyone.** The app records what Syros Cats approved and what it paid. It doesn't move money, issue invoices or reimburse the guardian. Who pays the clinic, and how, stays with Syros Cats.
- **Guardians writing vet visits or searching by photo.** Recording a vet visit and Find from a photo are team powers (`log_vet_visit`, `find_cat_from_photo`). A guardian sends evidence; the team writes the record.
- **Spotters or cat owners asking.** Only cat guardians ask, and only for their own colonies. A spotter who sees an unsterilised cat sends a cat-in-trouble report or contacts Syros Cats.
- **Paid treatment for a sick or injured cat.** That goes through the cat-in-trouble report.

## Anti-goals

These would make it a failure even if it worked:

- **A visit or a payment on the wrong cat.** The guardian's word on which cat a photo shows is a strong hint, never the record. The team confirms each cat before saving, exactly as in any batch.
- **Paying twice for one cat.** A cat already sterilised by a vet visit can't be recorded under a request, and a cat can't be in two open requests at once (see "Paying twice").
- **Overspending without anyone deciding to.** Every euro above an approval, and every approval above the month's budget, is a named person's deliberate act with a reason, never a tick box clicked through.
- **A queue that promises a reply.** No countdown, no reminder, no "we'll answer within". The team decides when it can (the welfare queue's rule, `team-access-and-welfare-queue.md` §3.1).
- **Leaking positions, photos or other people.** No position goes into an address. A guardian never learns who else asked about a cat. The photos she sends are team-only, except that she sees her own, and a new cat's main photo is public as in a batch. EXIF and GPS data are stripped as for every upload.
- **Guardians going back to WhatsApp** because the form is slower than a message. Asking for one cat must take under a minute on a phone.

## Who does what

| Person | Can |
|---|---|
| **A cat guardian**, for her own colonies | Ask for cats in her colonies and for cats not yet on the app; change or withdraw a request while it waits; send photos for an approved request; see where each of her requests stands, and the photos she sent |
| **The Syros Cats team** | See every request in **Needs an OK**; approve within the month's budget, or decline; turn sent photos into a vet visit batch and save it; end an approval early |
| **Management** | Everything the team can, plus set the monthly budget, and approve a request or an extra cost that takes the month over budget |

**The person who asked never decides.** A guardian who is also on the team can't approve, decline or record her own request (the confirmation queue's rule, `roles-and-invites.md` §10.3: `decided_by` is never `proposed_by`). If she is the only person in management, a request of hers that goes over budget can be approved only by lowering it to fit, or after someone else in management is added.

## How it works

### 1. The guardian asks

**Where.** On her colony page, **Ask Syros Cats to pay for sterilisation**. On a cat's page in her colony, the same button starts a request with that cat already ticked. The button isn't shown on a cat that is *Confirmed sterilised*.

**What she sends:**

- **the colony**, one of hers. A request is for one colony;
- **which cats**, ticked from her colony's list. The list shows each cat's photo, name and sterilisation answer, with the cats not known to be sterilised first.
  - A cat that is *Confirmed sterilised* is shown but can't be ticked ("Already sterilised").
  - A cat that is *Probably sterilised* can be ticked, with "This one may already be done. Check her ear if you can".
  - A cat already in an open request can't be ticked: "Already in an open request". She isn't told whose;
- **cats not on the app yet**: a number from 0 to 10, for cats she plans to trap that nobody has recorded. She doesn't need photos of them yet;
- **the clinic**, from the one clinic list, or "Not sure yet";
- **when she hopes to go**: a week, or "As soon as possible". This is for the team's planning, not a booking;
- **a note** (optional): "the black male is very shy, may need two tries".

**Before sending** she sees: "4 cats. Syros Cats usually pays about €55 per cat, so about €220." That is the standard price in Vet settings at that moment, times the number of cats. It's a guide, not an offer.

**After sending** she sees the request as **Waiting for Syros Cats**, with "You'll see their answer here." She can change it or withdraw it while it waits. Once it's decided she can't change it; she asks again for more cats.

*My call:* one colony per request, so the team decides with that colony's figures in front of it, and the batch it becomes has one colony.

*My call:* she can tick only cats in her colonies. A cat of hers that isn't in the colony yet, she adds first (she can, `roles-and-invites.md` §7.4), or counts as "not on the app" if nobody has recorded it.

### 2. The team decides

**Where.** On the dashboard, **Needs an OK** lists every waiting request, oldest first, and Home shows "Needs an OK (N)" (SYC-476). Nobody is paged. Site-public requests (SYC-686) join the same list when they are built.

**What the team sees:**

- the guardian's name, the colony, when she asked, the clinic and the week she hopes to go, and her note;
- each ticked cat with its photo, SYR number and sterilisation answer, and any warning:
  - "Sterilised by a vet visit on 3 Mar 2025" (if that happened after she asked). That cat can't be approved;
  - "Probably sterilised: a spotter saw a clipped ear";
  - "No longer in Vaporia", "Marked as died" or "Marked as homed", if that changed after she asked;
- the number of cats not on the app yet;
- the colony's figures from the planner: how many cats, how many sterilised;
- **the month's budget line** (see step 3): "October: €1,120 of €1,500 used. Approving this uses up to €220 more."

**What the team can do:**

- **Approve.** The team sets:
  - **the number of cats**, which starts at the number she asked for. It can be lowered but not raised;
  - **the most Syros Cats will pay per cat**, which starts at the standard price. This covers the sterilisation and the vaccinations given at the same visit (see Decision B);
  - **until when** the approval lasts, which starts 8 weeks ahead;
  - optionally, **a message to the guardian**: "Please use the Ermoupoli clinic, they've agreed our price".
- **Approve some cats only.** The team unticks cats it won't pay for, each with a reason from a fixed list that the guardian sees: "already sterilised", "no longer in your colony", "not this time".
- **Decline**, with a reason from a fixed list and an optional message:
  - "This month's budget is used up. Please ask again next month";
  - "These cats are already sterilised";
  - "Syros Cats are already planning to trap this colony";
  - "Please call Syros Cats about this one".

*My call:* a fixed list plus a short message, so the guardian is never left guessing, and nothing she sees is a team note.

The first decision wins. A second team member who opens it a moment later sees "Already decided by Jacky". The decision checks the capability again when it is written, not only when the page was drawn.

### 3. The spending limit

There are two limits, doing different jobs.

**The approval is the limit for that request.** It is a number of cats and a most-per-cat. Its **approved total** is the two multiplied: 4 × €55 = €220.

**The monthly budget is the limit for Syros Cats.** Management sets it in Vet settings, beside the standard price, and every change is kept in its history as price changes are. With no budget set there is no monthly limit, and the budget line shows only what has been used.

**How a request uses the budget.** Each request belongs to the month it was **approved** in (Athens time), and only that month, however long its cats take. What it uses of that month's budget is:

- **while it is open:** the larger of its approved total and what has been saved under it so far. So an approval holds its whole amount until it closes, and spending above it counts in full;
- **once it has closed:** only what was saved under it. The unused part goes back to that month's budget.

"Saved under it" is the sum of the costs on the vet visits recorded from it. A visit saved with no cost known counts as the request's most-per-cat until a cost is put in, so the budget never looks emptier than it is.

**Who may approve what:**

- A team member can approve a request whose approved total fits in what is left of its month's budget.
- A request that doesn't fit can be approved only by management, with a typed reason. A team member sees "This would take October over its €1,500 budget. Management can approve it", and can still decline, or approve fewer cats so it fits.
- **Approvals can't race.** Approving, and saving anything above an approval, happen in one transaction that holds a lock for that month and works out what is left inside it. Two people approving at the same moment can't both use the last €100.

*My call:* the budget is for guardian requests only (Decision C). Rounds Syros Cats runs itself are recorded as batches as now and don't use it. The month's **Paid** figure on the Vet settings page counts every saved vet visit cost, from any batch, by the visit's date, for the team's information.

### 4. After the vet, the guardian sends the photos

**Once it's approved** she sees "Approved: up to 4 cats, up to €55 each, until 19 Dec", the team's message if there is one, and any cats left out with the reason. She sees the per-cat amount because she arranges the visit with the clinic. *My call:* she sees amounts only on her own request. Costs and vaccinations on vet visits stay hidden from guardians, as everywhere (`team-dashboard-redesign.md` §10.2).

**After the vet** she opens the request and taps **Send the photos**. She gives:

- **the date** of the vet visit, which can't be in the future or before the approval;
- **the clinic**, if it changed;
- **each cat**: one to six photos, and which cat it is. She picks from the approved cats, from her colony's other cats, or **"A cat not on the app"**;
- **what the vet did**, per cat: Sterilised, and Vaccinated if it was. This is a hint for the team, who confirm it when recording;
- **what the vet charged**, per cat or in total, if she knows (optional). This is a hint too: it is shown to the team, and never becomes the cost on its own;
- **a photo of the vet's bill** (optional);
- **a note** (optional).

**More than one sending.** She can send more than once against one approval: three cats this week, the shy one next week. Across all her sendings for one request she can send at most the approved number of cats plus 2, for cats she found on the day. *My call:* "plus 2" because a trapping day often catches an extra cat, and anything beyond that is a new request. A cat she has already sent, in a sending not yet recorded, can't be picked again.

**What happens to the photos.** They are stripped of EXIF and GPS data and stored as team-only photos, held by the request. The guardian sees the photos she sent, on her own request, for as long as she is a guardian of that colony. Nobody else outside the team sees them. She can remove a photo, or a whole cat, from a sending until the team starts recording it.

**After sending** her request reads **"Photos sent: Syros Cats will record them"**.

**A sending made before the approval ends is honoured.** If the "until" date passes while it waits to be recorded, it is still recorded under the request.

### 5. The team records it as a batch

Each sending appears in Needs an OK as **Photos to record**. **Record these** makes a vet visit batch, owned by the team member who tapped it, with the sending's photos moved in (nothing is uploaded again). The batch is filled in:

- the date and clinic she gave;
- the request's colony, as "where the cats came from";
- the batch price: the request's most-per-cat;
- **who paid**: Syros Cats;
- each cat with its photos, and what she said the vet did;
- what she said the vet charged, shown beside each cat's cost as "Eleni says €50", not filled in;
- for each cat, **her pick** at the top of the matches: "Eleni says this is Mimi", with Mimi's photo beside the photos she sent. The usual Find from a photo matches are listed below.

From there the team does what any batch asks (vet visit batches spec, steps 3 to 5). They confirm each cat (**This is the cat**, **Search somewhere else**, or **None of these: a cat we haven't recorded**), check what was done, put in the cost, and save. For a new cat, the team chooses which of her photos becomes its public main photo, and sees it before saving.

**Checks on a batch made from a request:**

- **Already sterilised by a vet visit:** refused. A cat confirmed as one with a standing vet visit that sterilised it can't be saved in this batch. The team removes it with the reason "already sterilised". If the earlier visit was a mistake, the team marks it wrong on the cat's page first. This replaces the "Record this visit as well" tick for request batches.
- **Over the approval:** a cost above the most-per-cat, or more cats recorded under the request than it approved, is marked. Saving it needs **Approve the extra** with a typed reason. A team member can do that while the month's budget still has room for it; beyond the budget, only management can (step 3).
- **The same cat twice** in one batch is refused, as in every batch.

**If the team can't use a cat's photos** (blurry, or a cat it can't identify and won't add), it removes that cat from the batch with a reason from a fixed list that the guardian sees: "We couldn't tell which cat this is. Could you send another photo?" She can send it again.

**Saving** writes the vet visits as every batch does, in one transaction. A cat sterilised by a vet visit becomes *Confirmed sterilised*, and the "sterilised" news goes out once, as for any confirmation. A new cat goes public. Each visit records the request it was paid under, and the request's saved total goes up by its costs.

**The batch keeps the guardian's evidence safe.** A batch made from a request is never removed by the 7-day clean-up for unfinished batches. If the team abandons it, the cats and photos go back to the sending as **Photos to record**, rather than being deleted. A sending waiting more than 14 days shows "Waiting 14 days" in Needs an OK, once, quietly.

### 6. When a request closes

A request is **Done** when nothing is waiting to be recorded and one of these is true:

- every approved cat has been recorded, or removed with a reason;
- she taps **That's all for this request**;
- the approval's date has passed;
- the team taps **End this approval** (with a reason she sees).

A request with nothing recorded when its approval ends reads **Ended**. Once closed, the unused part goes back to its month's budget.

**If things change mid-way:**

- **Her guardian role for the colony ends.** A waiting request withdraws itself. An approved one stays with the team, who can still record what she has sent and end it. She no longer sees it.
- **A cat leaves her colony, dies or is homed** after she asked. The team sees it flagged. She sees "no longer in your colony" (or the status) beside it, and doesn't send photos for it.
- **A cat is sterilised another way** (a team round, say). It is flagged, and can't be recorded under the request (step 5).

### 7. What the guardian sees afterwards

On her request:

- **Done: 4 cats recorded on 12 Nov. Thank you.** Each recorded cat is listed with its name and its public photo, or a new cat's new main photo.
- A cat the team removed, with the reason.
- If approved cats weren't used: "1 approved cat wasn't used. Ask again whenever you're ready."

On her colony and on each cat: the vet visit shows as visits always do on her pages ("Seen by a vet on 12 Nov"), with what was done and without the cost or the vaccinations. The cat's answer shows *Confirmed sterilised*. A new cat appears in her colony.

**My requests** on her pages lists all her requests, newest first:

| Where it stands | She sees |
|---|---|
| Waiting | Waiting for Syros Cats |
| Approved | Approved: up to N cats, up to €X each, until date |
| Photos sent | Photos sent: Syros Cats will record them |
| Done | Done: N cats recorded on date. Thank you |
| Declined | Syros Cats can't pay for this one: reason |
| Withdrawn | You withdrew this request |
| Ended | The approval ended on date with no cats recorded |

**Being told.** She sees each answer on her next visit to her pages. Whether she also gets an email is Decision A.

## Limits

- **Open requests:** at most 3 per guardian that are waiting or approved, and at most 20 cats in one request, 10 of them not on the app.
- **One open request per cat**, held by the database (a unique rule on the cat across open requests), not only by the page.
- **Photos:** at most 6 per cat, as in a batch. A batch holds at most 40 cats (`ROUND_MAX`).
- **Uploads** count against the same per-person photo upload limit as her other uploads.
- **Signal:** asking, sending photos and reading the answer all need a connection. These are dashboard pages with no offline copy: if she loses signal while filling the form, what she typed is lost.

## Words

- "Cat guardian", never "colony carer"; "spotter" for people using the public app; "Syros Cats" for the team on her pages, never a team member's name.
- Everything the guardian sees is in English, Greek and French (roles spec Decision 10), including every fixed reason and state above. Johnny checks the Greek and French (SYC-283). As with the guardian pages, English may go first; a language goes live once Johnny has signed it off.
- Team pages stay English.
- Money in whole euros, "€55", as in Vet settings.
- No text below 12px.

## Constraints the builder must respect

- **Guardians stay on the dashboard.** Everything here is on the guardian's pages (`/api/team/my/…` on `team.catspotters.com`), server-drawn with no scripts. Several photos are uploaded with a plain file input with `multiple`. The public app doesn't change.
- **Guardians never write the record.** A request and its sendings are evidence the request holds. Only saving a batch writes vet visits, through the batch writer (`saveBatch` in `lib/vetVisits.ts`), so D8 and every batch rule hold. The batch is created by, and belongs to, the team member who taps **Record these**. A guardian gets 403 on every batch route, as now.
- **Storage.** Requests, their cats, their decisions and their sendings are tables of their own: a request is money, cats and photos, which the one-site shape of `confirmation_items` (`roles-and-invites.md` §10.3) doesn't fit. They keep the confirmation queue's rules: the person who asked never decides, the first decision wins, the decision re-checks the capability, and rows are never deleted. A batch records the request and the sending it came from, and so does each visit saved from it. That needs a migration.
- **Photos.**
  - A sending's photos are team-only from upload. `teamOnlyPhotoIds` covers them, and isn't loosened.
  - The guardian sees her own through a route of its own. It checks that she sent the photo and is still a guardian of the request's colony.
  - Once in a batch, they follow the batch rules exactly: never a display or reference photo for a known cat, and the chosen photo becomes a new cat's public main photo.
  - Every reader that picks display photos, reference photos, public galleries, guardian views, exports or fingerprints leaves them out, with a test for each.
- **Capabilities.** New rows in the catalogue (`roles-and-invites.md` §6.2, which `capabilities.catalogue.test.ts` reads):
  - `request_sterilisation`, placed: a guardian for her own colonies, checked for the colony on every write;
  - `settle_sterilisation_request`, island: approve, decline, end an approval, and record a sending. *My call:* its own capability, not `settle_confirmation`, because this one commits money. Recording a sending also needs what a batch needs: `log_vet_visit`, `find_cat_from_photo`, `view_vet_costs`;
  - `set_sterilisation_budget`, management only: set the monthly budget;
  - `approve_over_budget`, management only: approve a request, or an extra cost, beyond the month's budget.

  The standard price stays under `edit_vet_settings`. Every new route gets its row in `team.walk.test.ts`, and a new module that reads team-only data (spending, other guardians' requests) joins `ISLAND_ONLY_MODULES` in `guardianView.source.test.ts`.
- **The budget lock.** Approving, and saving anything above an approval, take a lock for the request's month and work out what's left inside the same transaction.
- **Process:** each PR is a draft until reviewed. Run the full api-server suite before `gh pr ready`. Screenshots at 390px and 1280px, for guardian pages in each live language.

## Changes this makes to approved specs

These go in with this design, once Samuel approves it:

- **`roles-and-invites.md` §7.1:** "Needs an OK" holds a second kind of item, a guardian's sterilisation request, and its sent photos. The row's "One kind only" becomes "two kinds".
- **`roles-and-invites.md` §7.3**, "Nothing a guardian says about a cat is queued": add "A request for Syros Cats to pay for sterilisation is not a statement about a cat. It asks for money, so it waits for the team (SYC-284)."
- **`roles-and-invites.md` §6.2:** the four new capabilities above.
- **`roles-and-invites.md` Q8:** answered further: guardians ask in the app (SYC-284). The team-access spec §7.2 sentence on guardians arranging paid sterilisation stays, as a description of the role.
- **`team-dashboard-redesign.md` §10.2:** a guardian sees the amount approved on her own request, and nothing else about cost.
- **`2026-10-24-vet-visit-batches-design.md`:** a batch can come from a guardian's request. Such a batch is exempt from the 7-day clean-up, and its "Already sterilised by a vet visit" check is a refusal, not a tick.

## Decisions for Samuel

Each has a recommendation. The rest of the document assumes the recommended answer.

**A. Does the guardian get an email when Syros Cats answers?**
- *Yes, one email per answer, in her language (recommended).* An approval is what lets her book the vet, so she needs to know, and without an email she will message the team to ask, which is the WhatsApp loop this replaces. It is a new kind of message to a person, sent like an invitation. Risk: one more email to look after, and it departs from the site-public decision (Q4), where no email was wanted because nothing was waiting on it.
- *No, she sees it on her next visit*, as for site-public requests. Simpler, and consistent with Q4. Risk: she checks again and again, or phones anyway.

**B. What does the per-cat amount cover?**
- *Sterilisation and the vaccinations given at the same visit, as one amount (recommended).* That matches "Syros Cats pays for the sterilisation and vaccinations", and it's how a vet's bill for the visit reads. The team sets it, starting from the standard price. Risk: the standard price in Vet settings is a sterilisation price, so if vaccinations add a lot the team will often raise the starting figure.
- *Sterilisation only.* Vaccinations go by phone, as now. Risk: half the bill is outside the record.

**C. What does the monthly budget cover?**
- *Guardian requests only (recommended).* It limits what the team approves on someone else's word, which is what a spending limit is for here. Rounds Syros Cats runs itself are its own decision. Risk: the budget isn't the charity's whole sterilisation spend. The Paid figure shows that.
- *Everything, including the team's own rounds.* One number for all sterilisation money. Risk: a team round can use up the guardians' budget without anyone deciding to, and saving a team batch would need the over-budget gate too.

**D. How does the spending limit work?**
- *A monthly budget, with management approving anything over it (recommended).* The team decides day to day, and the few people who answer for the money decide the exceptions.
- *A per-request limit only:* each approval is its own cap, and nothing adds them up. Simplest. Risk: nothing shows the month's total until the money has gone.
- *A hard monthly stop:* nothing over budget, even for management. Risk: a pregnant cat in December waits for January.

## Calls made in this document (for Samuel to check)

- A request is for one colony, and she can tick only cats in her colonies, plus a count of cats not on the app.
- The team can lower the number of cats but not raise it. An approval lasts 8 weeks by default.
- Declining, unticking, removing and ending use fixed reasons plus an optional message.
- A request uses the budget of the month it was approved in. An open request holds its whole approved total, and a closed one only what was saved.
- A visit saved with no cost counts as the most-per-cat in the budget.
- The guardian's "what the vet charged" is a hint, never the cost.
- A cat already sterilised by a vet visit is refused under a request, not saved with a tick.
- At most the approved number plus 2 cats across one request's sendings.
- At most 3 open requests per guardian, 20 cats per request; one open request per cat.
- A batch made from a request is kept until saved, and an abandoned one goes back to the sending.
- When her guardian role ends, a waiting request withdraws itself and an approved one stays with the team.
- Requests have tables of their own rather than being stored as confirmation items.

## Left to the builder

- Where **My requests** sits on the guardian's pages, and the layout of Needs an OK.
- How a request's states are stored, as long as what the guardian sees matches the table in step 7.
- How the month lock is taken (an advisory lock or a locked budget row).
- The split into PRs. A likely order: requests, Needs an OK and the decision; the budget; sendings and **Record these**; the guardian's views and words.
