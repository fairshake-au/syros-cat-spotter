# Asking Syros Cats to pay for sterilising a cat (SYC-284)

**Status:** Rewritten 25 Oct 2026 after Samuel corrected the premise: anyone can ask, not only cat guardians. Waiting for review, then Samuel's approval. Nothing is built from this until he approves it.

**Linear:** SYC-284 (this design), under SYC-610. Builds on SYC-677 (vet visit batches, `2026-10-24-vet-visit-batches-design.md`) and copies the cat-in-trouble report (`docs/specs/team-access-and-welfare-queue.md` §4). Related: SYC-686 (site-public requests in "Needs an OK"), SYC-476 (the "Needs an OK (N)" line on Home), SYC-283 (Johnny's Greek and French check).

## Why

Samuel described how a sterilisation round really runs (24 Oct 2026):

> "Syros Cats volunteers (and community helpers, e.g. guardians) will trap cats, Syros Cats pays for the sterilisation and vaccinations, and then Syros Cats keeps a record with the cat's photo and the cost they approved/paid"

The people who ask Syros Cats to pay for sterilising a cat are a mixed group. Samuel (25 Oct 2026): "Syros residents, other interested members of the public. I can't clearly define this because it is pretty random". Cat guardians ask too, but they are one kind of asker among many. Most askers have no account with Syros Cats and never will.

What the team needs before saying yes is short. Samuel (25 Oct 2026): "a photo of the cat and where it lives". After a yes, **the person who asked** catches the cat and takes it to the vet (Samuel, 25 Oct 2026). Syros Cats then pays, either the vet directly or the person, paying them back. Both happen (Samuel, 25 Oct 2026: "assume either is a possibility").

Done by phone, email or WhatsApp, three things get lost:

- **the ask**: which cat, where it lives, and what Syros Cats agreed to pay;
- **the proof**: the photos of the cat, which end up in a chat thread instead of on its record;
- **the link** between what was approved and what was paid, so the team can't see where its sterilisation money went.

This design puts the exchange in the app. Anyone asks, with a photo and a place. The team checks the photo against the cats on record and says yes, with a limit, or no. The person takes the cat to the vet and sends back a photo and the vet's details. The team records it as a vet visit batch, as it records any round.

## The whole journey in one paragraph

Maria lives in Ano Syros and feeds a tabby that keeps having kittens. In the Cat Spotter app she taps **Ask Syros Cats to sterilise a cat**, takes a photo, confirms the spot on the map, adds "she sleeps under the steps by the bakery", and leaves her email. Her phone shows "Sent. Syros Cats will answer you by email and here in the app." At the dashboard, Jacky opens it in **Needs an OK**. Find from a photo says the tabby is very likely Pipa, SYR-0412, not sterilised. With October's budget beside it, Jacky approves: up to €55, the Ermoupoli clinic, until 19 Dec, paid straight to the vet. Maria gets an email and a note in the app: "Yes. Syros Cats will pay up to €55 at the Ermoupoli clinic. Quote request SR-214." She catches Pipa, the vet does her, and Maria opens the request and sends a photo of Pipa after the operation and the date. The team taps **Record these**, confirms it's Pipa, puts in the vet's €52, and saves. Pipa shows as sterilised in the app, and Maria gets "Done. Thank you for helping Pipa."

## Goals

- Anyone can ask Syros Cats to pay for sterilising a cat, with a photo and where the cat lives, in the app or on the website, with no account.
- A cat guardian can ask the same way from her own pages, for a cat in her colony.
- The team identifies the cat from the photo before deciding, so a cat that is already sterilised is caught before any money is approved.
- The team approves or declines each request, against a monthly budget it can't overspend by accident.
- The person who asked hears the answer, can quote it at the clinic, and can send back the photo and details after the vet.
- What was paid, and to whom (the vet, or the person paid back), is recorded and can be traced from the request to the cat's vet visit.

## Non-goals

- **Booking the vet.** The person who asked arranges the appointment with the clinic. The app records the clinic Syros Cats approved, not a booking.
- **Moving money.** The app records what Syros Cats approved, what it paid, and to whom. It doesn't pay anyone, issue invoices, or hold bank details.
- **The person who asked writing the cat's record.** Recording a vet visit and Find from a photo stay with the team (`log_vet_visit`, `find_cat_from_photo`). The person who asked sends evidence; the team writes the record.
- **Syros Cats trapping the cat for them.** If the person can't catch the cat, the team declines with "Please call Syros Cats about this one" and arranges it outside the app, or puts the colony in the trapping planner.
- **Paid treatment for a sick or injured cat.** That goes through the cat-in-trouble report.

## Anti-goals

These would make it a failure even if it worked:

- **A visit or a payment on the wrong cat.** The photo match is the team's to confirm, before approving and again before saving, exactly as in a batch.
- **Paying twice for one cat.** A cat already sterilised by a vet visit can't be approved or recorded under a request. A cat can be in only one open request at a time.
- **Overspending without anyone deciding to.** Every euro above an approval, and every approval above the month's budget, is a named person's deliberate act with a reason.
- **A machine for spending a charity's money, or its email.** The form is public, so it has the cat-in-trouble report's protections: Turnstile, per-address limits, and no email to an address until its holder confirms it (`team-access-and-welfare-queue.md` §4.3–4.4).
- **Leaking where an unsterilised cat lives, or who asked.** The place, the photos and the contact details are team-only. No position goes into an address, and the public app never shows that a cat has a request.
- **A queue that promises a reply.** No countdown, no "we'll answer within". The team decides when it can (the welfare queue's rule, §3.1).
- **Going back to WhatsApp** because the form is slower than a message. Asking must take under a minute on a phone.

## Who asks, and who decides

| Person | Can |
|---|---|
| **Anyone** (a resident, a visitor, any spotter), in the app or on the website, with no account | Ask for one cat at a time; see their own requests on the phone or browser they asked from; withdraw a request while it waits; send the photo and details back for an approved request |
| **A cat guardian**, on her own pages | All of that, for cats in her colonies, picking the cat from her colony instead of taking a new photo |
| **The Syros Cats team** | See every request in **Needs an OK**; identify the cat; approve within the month's budget, or decline; record what comes back as a vet visit batch; end an approval |
| **Management** | Everything the team can, plus set the monthly budget, and approve beyond it |

The person who asked never decides. A team member who asks (for a cat on her own street, say) can't approve, decline or record her own request (the confirmation queue's rule, `roles-and-invites.md` §10.3: `decided_by` is never `proposed_by`).

## How it works

### 1. Asking

**Where.** In the app and on the website: on a cat's page ("Ask Syros Cats to sterilise her"), and as **Ask Syros Cats to sterilise a cat** beside "Report a cat in trouble". *My call:* the button isn't shown on a cat that is *Confirmed sterilised*. A cat guardian also has it on her colony page and on each cat in her colony.

**What they send** (the cat-in-trouble report's flow, §4.2, kept as short):

1. **A photo of the cat**, reused if they have just taken one. One is needed; up to six are allowed. Started from a cat's page, the cat is already chosen, and the photo is still asked for but can be skipped.
2. **Where it lives**: the confirmed spot on the map, exactly as the spotting and report flows do it.
3. **Anything that would help** (optional, free text): "she sleeps under the steps by the bakery".
4. **How to reach them**: an email address, a phone number, or both. One is needed, because the answer has to reach them. The consent wording follows `email-capture.md` §3.4, and nothing is emailed to an address until its holder confirms it.

A cat guardian picks the cat from her colony instead of steps 1 and 2. The place is her colony's, and Syros Cats reaches her at her sign-in address.

**One cat per request.** The photo is what the team decides on. Someone with three cats sends three; the place and contact details are kept for their next request on that phone.

**After sending** the screen says: "Sent. Syros Cats will answer you by email and here in the app." With only a phone number given, the screen says: "Syros Cats will call you or answer here in the app." No price is promised on this screen. *My call:* "about €55" would read as an offer to someone who isn't a guardian.

**With no signal**, the request is saved on the phone and sent when it next has a connection, as reports are (§4.3). The screen says it hasn't reached Syros Cats yet.

### 2. The team identifies the cat and decides

**Where.** On the dashboard, **Needs an OK** lists waiting requests, oldest first, and Home shows "Needs an OK (N)" (SYC-476). Nobody is paged. Site-public requests (SYC-686) join the same list.

**What the team sees:**

- the photo, the place on the team map, the note, and when it was sent;
- **who asked**: "A spotter" with their contact details, or the cat guardian's name and colony. A request from a phone that has asked before shows "3 earlier requests from this phone, 2 recorded";
- **the cat**: Find from a photo runs on the first photo when the team opens the request, narrowed to the area around the place. The team picks **This is the cat**, **Search somewhere else**, or **A cat we haven't recorded**, as in a batch. A cat chosen from its page, or by a guardian, arrives already picked, and the team checks it;
- **warnings** once the cat is picked:
  - "Sterilised by a vet visit on 3 Mar 2025": it can't be approved;
  - "Confirmed sterilised by her cat guardian", or "Probably sterilised: a spotter saw a clipped ear";
  - "Already in an open request" (with the date);
- **the month's budget line** (step 3): "October: €1,120 of €1,500 used. Approving this uses up to €55 more."

**What the team can do:**

- **Approve.** The team sets:
  - **the most Syros Cats will pay**, starting at the standard price in Vet settings. It covers the sterilisation and the vaccinations given at the same visit (Decision B);
  - **who Syros Cats pays**: **the vet**, or **the person who asked, paid back against the vet's bill**;
  - **the clinic**, from the one clinic list, or "any clinic on our list";
  - **until when**, starting 8 weeks ahead;
  - optionally, **a message**: "Ask for Dr Nikolaou, she knows our price".
- **Decline**, with a reason from a fixed list and an optional message:
  - "She's already sterilised. Thank you for checking";
  - "This month's budget is used up. Please ask again next month";
  - "Syros Cats are already planning to trap there";
  - "Please call Syros Cats about this one".
- **Answer it's already done** in one tap, when the photo match shows a sterilised cat. This sends the first reason above.

*My call:* fixed reasons plus a short message, so the person is never left guessing, and nothing they see is a team note.

The first decision wins. A second team member sees "Already decided by Jacky". The decision checks the capability again when it is written.

The cat the team picks is saved with the request. If the team chose **A cat we haven't recorded**, nothing is created yet. The cat is created when the visit is recorded (step 5), from the photos that come back.

### 3. The spending limit

There are two limits, doing different jobs.

**The approval is the limit for that request:** the most Syros Cats will pay for that cat. The team can approve more cats only by approving more requests.

**The monthly budget is the limit for Syros Cats.** Management sets it in Vet settings, beside the standard price, and every change is kept in its history as price changes are. With no budget set there is no monthly limit, and the budget line shows only what has been used.

**How a request uses the budget.** Each request belongs to the month it was **approved** in (Athens time), and only that month. What it uses of that month's budget:

- **while it is open:** the larger of its approved amount and what has been saved under it;
- **once it has closed:** only what was saved under it, so an unused approval goes back to that month's budget.

"Saved under it" is the cost on the vet visit recorded from it. A visit saved with no cost known counts as the approved amount until a cost is put in, so the budget never looks emptier than it is.

**Who may approve what:**

- A team member can approve a request that fits in what is left of its month's budget.
- Beyond the budget, only management can approve, with a typed reason. A team member sees "This would take October over its €1,500 budget. Management can approve it", and can still decline it.
- **Approvals can't race.** Approving, and saving a cost above an approval, happen in one transaction that holds a lock for that month and works out what is left inside it.

*My call:* the budget is for requests only (Decision C). Rounds Syros Cats runs itself are recorded as batches as now and don't use it. The month's **Paid** figure on Vet settings counts every saved vet visit cost from any batch, by visit date, for the team's information.

### 4. Hearing back, and going to the vet

**How the answer reaches them:**

- **In the app or browser they asked from**, under **My requests** (in the profile), always. If they follow the cat or allow notifications, they also get the app's own notice: "Syros Cats answered your request".
- **By email**, if they gave an address and confirmed it: one email per answer, in their language (Decision A). It is transactional, from the reports address, with replies going to Syros Cats.
- **By phone**, if they gave only a number. The team calls, and the request shows "Answered by phone" once the team marks it so.
- **A cat guardian** sees it on her pages, and by email at her sign-in address (Decision A).

**What a yes says:**

> Yes, Syros Cats will pay up to €55 to sterilise this cat at the Ermoupoli clinic, until 19 Dec. Quote request **SR-214** at the clinic. Syros Cats pays the clinic directly.

or, when Syros Cats pays the person back:

> … Pay the clinic, keep the bill, and send us a photo of it with the cat's photo. Syros Cats will pay you back up to €55.

*My call:* the reference **SR-214** is the request's number, short enough to say at a clinic counter. It carries nothing private.

The photo they sent, the place and their contact details are never in the email. The email links to nothing that needs a sign-in.

### 5. After the vet: sending it back, and recording it

**What they send.** They open the request on the same phone or browser (or a guardian on her pages) and tap **Send the photos**:

- **a photo of the cat after the operation**, and up to five more;
- **the date** of the vet visit, not in the future and not before the approval;
- **the clinic**, if it changed;
- **what the vet did**: Sterilised, and Vaccinated if it was. This is a hint the team confirms;
- **a photo of the vet's bill**: needed when Syros Cats pays them back, optional otherwise;
- **what the vet charged**, if they know. A hint, shown to the team, never the cost on its own;
- **a note** (optional).

**With no signal** it is saved on the phone and sent later, as the request was.

**If they lose the phone or can't send it**, the team records the visit directly from what they hear, in an ordinary batch, choosing the request it was paid under. The request then closes as usual.

**Recording it.** It appears in Needs an OK as **Photos to record**. **Record these** makes a vet visit batch, owned by the team member who tapped it, with the photos moved in (nothing is uploaded again), filled in with:

- the date and clinic they gave;
- the request's place, as "where the cat came from" (its area);
- the approved amount as the price, and **who paid**: Syros Cats;
- the cat the team picked when deciding, at the top of the matches, with its photo beside the new ones;
- what they said the vet did, and charged, as hints.

From there it is an ordinary batch (vet visit batches spec, steps 3 to 5). The team confirms the cat (the new photo should show the same cat, with a fresh clip), puts in the cost and saves. For a cat nobody had recorded, the team creates it here and chooses which photo becomes its public main photo, as in a batch.

**Checks on a batch made from a request:**

- **Already sterilised by a vet visit:** refused. The team removes it with the reason "already sterilised". If the earlier visit was a mistake, the team marks it wrong first.
- **Over the approval:** a cost above the approved amount is marked and needs **Approve the extra** with a typed reason. A team member can do that while the month's budget has room for it; beyond the budget only management can.
- **Not the same cat:** if the photos that come back show a different cat from the one approved, the team records the cat that was actually done. The request shows "A different cat was recorded". The money follows the cat that was sterilised.

**Saving** writes the vet visit as any batch does. The cat becomes *Confirmed sterilised*, and the "sterilised" news goes out once to its followers, as for any confirmation. A new cat goes public. The visit records the request it was paid under, and **who Syros Cats paid**: the vet, or the person who asked. *My call:* "who Syros Cats paid" is a new field on the visit, beside the existing "who paid" (Syros Cats, a donation, or the owner).

**If the team can't use the photos** (blurry, or the cat can't be told apart), it sends them back with "We couldn't tell which cat this is. Could you send another photo?", and they can send again.

**The evidence is kept safe.** A batch made from a request is never removed by the 7-day clean-up for unfinished batches. If the team abandons it, the photos go back to the request as **Photos to record**.

### 6. When a request closes

A request is **Done** when its visit is saved. It **Ends** without a visit when:

- the approval's date passes with nothing sent back. A sending made before that date is still recorded;
- the person taps **I couldn't do it after all**;
- the team taps **End this approval**, with a reason they see.

Once closed, the unused part goes back to its month's budget.

**If the person asked from a phone and later deleted their data** ("Delete my data"), their contact details and the link to their phone go, as for reports. The request, its photos and any recorded visit stay as Syros Cats' record of what it paid for, with "A spotter (data deleted)" as who asked.

### 7. What the person sees

**My requests**, in the profile on the phone or browser they asked from (and on a guardian's pages), lists their requests, newest first:

| Where it stands | They see |
|---|---|
| Sent, not yet delivered | Saved on this phone. It will send when you have a connection |
| Waiting | Waiting for Syros Cats |
| Approved | Yes: up to €55 at the Ermoupoli clinic until 19 Dec. Quote SR-214 |
| Photos sent | Photos sent: Syros Cats will record them |
| Done | Done: Pipa was sterilised on 12 Nov. Thank you |
| Declined | Syros Cats can't pay for this one: reason |
| Withdrawn | You withdrew this request |
| Ended | This approval ended on 19 Dec |

A recorded cat links to its page in the app, where it shows as sterilised. The person sees the amount approved on their own request, and nothing about costs elsewhere.

## Limits and protections

The ask is public and unauthenticated, and it costs attention and money, so it has the cat-in-trouble report's protections (§4.4):

- **Turnstile** on sending a request.
- **Per internet address and per email address** limits, as for reports. Per-phone limits are only a courtesy, because a phone's identity costs nothing to make.
- **At most 3 open requests** per phone or per guardian, and **one open request per cat**, held by the database, not only by the page. A person asking about a cat that already has an open request sees "Someone has already asked about this cat. Thank you". They are never told who.
- **No email to an unconfirmed address**, except the one "is this you?" message (F7b).
- **Photos:** at most 6 per sending; stripped of EXIF and GPS data; team-only (below).
- **The team is the gate.** No money is committed until a named team member approves, and nothing is paid back without the vet's bill and a photo of the cat the team has matched.

## Privacy

- **The place is exact and team-only.** It is stored like a report's location, never shown in the public app or on the public map, and never put in an address. The cat's own public position is unchanged.
- **Photos are team-only**, as report photos and batch photos are. The person who asked sees their own photos, on their own request. A photo becomes public only when the team makes it a new cat's main photo while recording.
- **Contact details** are seen only by the team, used only to answer the request, and deleted with "Delete my data".
- **The public app shows nothing** about a cat having a request, and no request is in the public catalogue or exports.

## Words

- "Cat guardian", never "colony carer"; "spotter" for people using the public app.
- Everything the person asking sees, including every fixed reason, state and email, is in English, Greek and French, as the app is. Johnny checks the Greek and French (SYC-283). English may go first, and a language goes live once he has signed it off. Team pages stay English.
- Money in whole euros, "€55".
- No text below 12px.

## Constraints the builder must respect

- **The person who asked never writes the record.** Only saving a batch writes a vet visit, through the batch writer (`saveBatch` in `lib/vetVisits.ts`), so D8 and every batch rule hold. The batch belongs to the team member who taps **Record these**.
- **Two front doors, one request.** The public ask is a public route (like `POST /api/reports`), tied to the phone's device identity. The guardian's ask is on her pages (`/api/team/my/…`), server-drawn with no scripts. Both make the same kind of request.
- **Storage.** Requests, their decisions and their sendings are tables of their own, keeping the confirmation queue's rules: the person who asked never decides, the first decision wins, the decision re-checks the capability, and rows are never deleted. A batch records the request it came from, and so does the visit saved from it, with who Syros Cats paid. That needs a migration.
- **Photos.** Request photos are team-only from upload and stay out of every public reader: display photos, reference photos, public galleries, guardian views of other people's photos, exports and fingerprints, with a test for each. The person who asked reads their own photos through a route that checks they are the asker (their device, or the guardian's sign-in). Once in a batch, the photos follow the batch rules exactly.
- **Mail.** The answer email is a new transactional purpose to a confirmed public address (`verified_public`, like `report_outcome`), and a person purpose for a guardian. Replies go to Syros Cats.
- **Capabilities.** New rows in the catalogue (`roles-and-invites.md` §6.2):
  - `request_sterilisation`, placed: a guardian asking from her pages for a cat in her colonies. The public ask needs no capability, as reports need none;
  - `settle_sterilisation_request`, island: identify, approve, decline, end, and record. *My call:* its own capability, not `settle_confirmation`, because this one commits money. Recording also needs what a batch needs: `log_vet_visit`, `find_cat_from_photo`, `view_vet_costs`;
  - `set_sterilisation_budget`, management only;
  - `approve_over_budget`, management only.

  Every new team route gets its row in `team.walk.test.ts`; a module that reads team-only data joins `ISLAND_ONLY_MODULES` in `guardianView.source.test.ts`.
- **Search limits.** Identifying the cat on a request uses the batch search allowance (vet visit batches spec), not the single-photo page's.
- **Process:** each PR is a draft until reviewed. Run the full api-server suite before `gh pr ready`. Screenshots at 390px and 1280px, in each live language.

## Changes this makes to approved specs

These go in with this design, once Samuel approves it:

- **`roles-and-invites.md` §7.1:** "Needs an OK" holds a second kind of item, a request for Syros Cats to pay for sterilising a cat, and the photos sent back for it.
- **`roles-and-invites.md` §7.3**, "Nothing a guardian says about a cat is queued": add "A request for Syros Cats to pay for sterilisation is not a statement about a cat. It asks for money, so it waits for the team (SYC-284)."
- **`roles-and-invites.md` §6.2:** the four new capabilities above.
- **`roles-and-invites.md` Q8:** answered further: anyone can ask in the app, guardians included (SYC-284).
- **`team-access-and-welfare-queue.md` §4:** a second public ask beside the report, with the same protections.
- **`privacy-policy.md`:** the app now asks for a phone number (it hasn't before) and an exact place, for this one purpose. It says what each is used for, who sees it, and that "Delete my data" removes the contact details.
- **`2026-10-24-vet-visit-batches-design.md`:** a batch can come from a request. Such a batch is exempt from the 7-day clean-up, its "Already sterilised by a vet visit" check is a refusal rather than a tick, and its visits record who Syros Cats paid.

## Decisions for Samuel

Each has a recommendation, and the rest of the document assumes it.

**A. Does the person who asked get an email when Syros Cats answers?**
- *Yes, one email per answer, to a confirmed address, in their language (recommended).* An approval is what lets them go to the vet, and most askers will never open the app's profile to check. Risk: more email to look after. It is the same kind as the report's outcome email.
- *No, they check My requests in the app.* Simpler. Risk: they don't, and phone Syros Cats anyway.

**B. What does the approved amount cover?**
- *Sterilisation and the vaccinations given at the same visit, as one amount (recommended).* That matches "Syros Cats pays for the sterilisation and vaccinations", and a vet's bill for the visit reads that way. Risk: the standard price is a sterilisation price, so the team may often raise the starting figure.
- *Sterilisation only.* Risk: half the bill is outside the record.

**C. What does the monthly budget cover?**
- *Requests only (recommended).* It limits what the team approves on someone else's word. Rounds Syros Cats runs itself are its own decision. Risk: the budget isn't the charity's whole sterilisation spend. The Paid figure shows that.
- *Everything, including the team's own rounds.* Risk: a team round can use up the money for public requests without anyone deciding to.

**D. How does the spending limit work?**
- *A monthly budget, with management approving anything over it (recommended).*
- *A per-request limit only.* Simplest. Risk: nothing shows the month's total until the money has gone.
- *A hard monthly stop.* Risk: a pregnant cat in December waits for January.

## Calls made in this document (for Samuel to check)

- One cat per request.
- A phone number is enough to ask; the team calls back.
- No price is shown to the person before the team answers.
- The team identifies the cat by photo match before deciding; a new cat is created only when the visit is recorded.
- The yes carries a short reference (SR-214) to quote at the clinic.
- The bill photo is required when Syros Cats pays the person back.
- If a different cat comes back, the team records the cat that was done and the money follows it.
- A request uses the budget of the month it was approved in; an unused approval goes back when it closes; a visit with no cost counts as the approved amount.
- At most 3 open requests per phone or guardian; one open request per cat.
- A batch made from a request is kept until saved; an abandoned one goes back to the request.
- After "Delete my data", the request and its record stay, without the person's details.
- Requests have tables of their own.

## Left to the builder

- Where **My requests** sits in the app's profile and on the guardian's pages, and the layout of Needs an OK.
- How the month lock is taken.
- How "who Syros Cats paid" is stored on the visit.
- The split into PRs. A likely order: requests, Needs an OK and the decision; the budget; sending back and **Record these**; answers by email and in the app; the guardian's door.
