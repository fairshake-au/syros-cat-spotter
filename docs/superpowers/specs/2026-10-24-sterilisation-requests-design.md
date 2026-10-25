# Asking Syros Cats to pay for sterilising a cat (SYC-284)

**Status:** Rewritten 25 Oct 2026 after Samuel corrected the premise: anyone can ask, not only cat guardians. Builder check and adversarial review done on this version, findings folded in. **Waiting for Samuel's approval**, including Decisions A to D at the end. Nothing is built from this until he approves it.

**Linear:** SYC-284 (this design), under SYC-610. Builds on SYC-677 (vet visit batches, `2026-10-24-vet-visit-batches-design.md`) and copies the cat-in-trouble report (`docs/specs/team-access-and-welfare-queue.md` §4). Related: SYC-686 (site-public requests in "Needs an OK"), SYC-476 (the "Needs an OK (N)" line on Home), SYC-283 (Johnny's Greek and French check).

## Why

Samuel described how a sterilisation round really runs (24 Oct 2026):

> "Syros Cats volunteers (and community helpers, e.g. guardians) will trap cats, Syros Cats pays for the sterilisation and vaccinations, and then Syros Cats keeps a record with the cat's photo and the cost they approved/paid"

The people who ask Syros Cats to pay for sterilising a cat are a mixed group. Samuel (25 Oct 2026): "Syros residents, other interested members of the public. I can't clearly define this because it is pretty random". Cat guardians ask too, as one kind of asker among many. Most askers have no account with Syros Cats and never will.

What the team needs before saying yes is short. Samuel (25 Oct 2026): "a photo of the cat and where it lives". After a yes, **the person who asked** catches the cat and takes it to the vet (Samuel, 25 Oct 2026). Syros Cats then pays, either the vet directly or the person, paying them back. Both happen (Samuel, 25 Oct 2026: "assume either is a possibility").

Done by phone, email or WhatsApp, three things get lost:

- **the ask**: which cat, where it lives, and what Syros Cats agreed to pay;
- **the proof**: the photos of the cat, which end up in a chat thread instead of on its record;
- **the link** between what was approved and what was paid, so the team can't see where its sterilisation money went.

This design puts the exchange in the app. Anyone asks, with a photo and a place. The team checks the photo against the cats on record and says yes, with a limit, or no. The person takes the cat to the vet and sends back a photo and the vet's details. The team records it as a vet visit batch, as it records any round, and marks the money paid.

## The whole journey in one paragraph

Maria lives in Ano Syros and feeds a tabby that keeps having kittens. In the Cat Spotter app she taps **Ask Syros Cats to sterilise a cat**, takes a photo, confirms the spot on the map, adds "she sleeps under the steps by the bakery", and leaves her email. Her phone shows "Sent. Check your email to confirm your address. Syros Cats will answer by email and here in the app." At the dashboard, Jacky opens it in **Needs an OK**. Find from a photo says the tabby is very likely Pipa, SYR-0412, not sterilised. With October's budget beside it, Jacky approves: up to €55 at the Ermoupoli clinic until 19 Dec, paid straight to the clinic. Maria gets an email and a note in the app: "Yes. Syros Cats will pay up to €55 at the Ermoupoli clinic. Quote request SR-214." She catches Pipa and the vet does her. Maria opens the request and sends a photo of Pipa after the operation, with the date. The team taps **Record these**, confirms it's Pipa, puts in the vet's €52, and saves. When the clinic's bill is paid, the team marks it paid. Pipa shows as sterilised in the app, and Maria gets "Done. Thank you for helping Pipa."

## Goals

- Anyone can ask Syros Cats to pay for sterilising a cat, with a photo and where the cat lives, in the app on a phone or in a browser, with no account.
- A cat guardian, or a team member, can ask the same way from the dashboard while signed in.
- The team identifies the cat from the photo before deciding, so a cat that is already sterilised is caught before any money is approved.
- The team approves or declines each request, against a monthly budget it can't overspend by accident.
- The person who asked hears the answer, can quote it at the clinic, and can send back the photo and details after the vet.
- What was paid, to whom (the clinic, or the person paid back) and when is recorded, and can be traced from the request to the cat's vet visit.

## Non-goals

- **Booking the vet.** The person who asked arranges the appointment with the clinic. The app records the clinic Syros Cats approved, not a booking.
- **Moving money.** The app records what Syros Cats approved, what it paid, to whom and when. It doesn't pay anyone, issue invoices, or hold bank details.
- **The person who asked writing the cat's record.** Recording a vet visit and Find from a photo stay with the team (`log_vet_visit`, `find_cat_from_photo`). The person who asked sends evidence; the team writes the record.
- **Syros Cats trapping the cat for them.** If the person can't catch the cat, the team declines with "Please call Syros Cats about this one", and arranges it outside the app or adds the place to the trapping planner.
- **Paid treatment for a sick or injured cat.** That goes through the cat-in-trouble report.
- **A form on catspotters.com.** That site lives in another repository (`docs/WEBSITE.md`). It links to the app's browser version, where the ask works as it does on a phone.

## Anti-goals

These would make it a failure even if it worked:

- **A visit or a payment on the wrong cat.** The photo match is the team's to confirm, before approving and again before saving, exactly as in a batch.
- **Paying for a cat that wasn't sterilised under this request.** A photo can't tell a fresh ear clip from an old one. So money follows a clinic's bill, not a photo: Syros Cats pays a clinic on its list, or pays a person back only against that clinic's bill, once per bill.
- **Paying twice for one cat.** A cat already sterilised by a vet visit can't be approved or recorded under a request. A cat can be in only one open request at a time.
- **Overspending without anyone deciding to.** Every euro above an approval, and every approval above the month's budget, is a named person's deliberate act with a reason.
- **A machine for spending a charity's money, or its email.** The ask is public, so it has the cat-in-trouble report's protections: Turnstile, limits per internet address and per email address, and no email to an address until its holder confirms it (`team-access-and-welfare-queue.md` §4.3–4.4). Every email is a fixed template.
- **Leaking where an unsterilised cat lives, or who asked.** The place, the photos and the contact details are team-only. No position goes into an address. The public app never shows that a cat has a request, and an asker is never told that anyone else asked.
- **A queue that promises a reply.** No countdown, no "we'll answer within". The team decides when it can (the welfare queue's rule, §3.1).
- **Going back to WhatsApp** because the form is slower than a message. Asking must take under a minute on a phone.

## Who asks, and who decides

| Person | Can |
|---|---|
| **Anyone**, in the app on a phone or in a browser, with no account | Ask for one cat at a time; see their own requests in that app; withdraw a request; send the photo and details back for an approved request |
| **A cat guardian**, on her dashboard pages | All of that, for cats in her colonies, picking the cat from her colony instead of taking a new photo |
| **A team member**, on the dashboard | Ask the same way as a guardian, for any cat, signed in |
| **The Syros Cats team** | See every request in **Needs an OK**; identify the cat; approve within the month's budget, or decline; record what comes back as a vet visit batch; mark it paid; end or extend an approval |
| **Management** | Everything the team can, plus set the monthly budget, and approve beyond it |

**The person who asked never decides.** For a request made signed in on the dashboard, the database refuses a decision by the person who asked (the confirmation queue's rule, `roles-and-invites.md` §10.3). A request made in the public app carries no person, so this can't be checked there. Team members therefore ask from the dashboard, and the team's own page says so.

## How it works

### 1. Asking

**Where.**
- **In the app**, on a phone or in a browser: on a cat's page ("Ask Syros Cats to sterilise her"), and as **Ask Syros Cats to sterilise a cat** beside "Report a cat in trouble". The button isn't shown on a cat that is *Confirmed sterilised*.
- **On the dashboard**: a cat guardian has it on her colony page and on each cat in her colonies. The team has it on any cat's page.

**What they send** (the cat-in-trouble report's flow, §4.2, kept as short):

1. **A photo of the cat**, reused if they have just taken one. One is needed, even when they started from a cat's page; up to six are allowed.
2. **Where it lives**: the confirmed spot on the map, exactly as the spotting and report flows do it.
3. **Anything that would help** (optional, free text): "she sleeps under the steps by the bakery".
4. **How to reach them**: an email address, a phone number, or both. One is needed, because the answer has to reach them. The email consent wording is `email-capture.md` §3.4's. The phone number has its own line: "Syros Cats will only use this number to answer this request."

A cat guardian picks the cat from her colony instead of steps 1 and 2, and can add a photo. The place is her colony's. Syros Cats reaches her at her sign-in address, which her sign-in has already confirmed. A team member asking picks the cat the same way.

**One cat per request.** The photo is what the team decides on. Someone with several cats sends one request each. The place and contact details are kept for their next request in that app, so a second one takes seconds.

**After sending** the screen says:
- with an email: "Sent. Check your email to confirm your address. Syros Cats will answer by email and here in the app";
- with only a phone number: "Sent. Syros Cats will call you, or answer here in the app".

No price is promised on this screen. *My call:* "about €55" would read as an offer to someone who isn't a guardian.

**With no signal**, the request is saved on the phone and sent when it next has a connection, as reports are (§4.3). The screen says it hasn't reached Syros Cats yet. The request is sent first and then its photos one at a time, as a sighting's extra photos are. Each send gets a fresh Turnstile check at the moment it goes, as a queued report does (`reportQueue.ts`).

### 2. The team identifies the cat and decides

**Where.** On the dashboard, **Needs an OK** lists waiting requests, oldest first, and Home shows "Needs an OK (N)" (SYC-476). Nobody is paged. This design builds Needs an OK. Site-public requests (SYC-686) join it later, each kind shown only to people holding its own capability.

**What the team sees:**

- the photos, the place on the team map, the note, and when it was sent;
- **who asked**: "Someone" with their contact details, or the guardian's or team member's name. A request from an app that has asked before shows "3 earlier requests from this app, 2 recorded";
- **the cat**: Find from a photo runs on the first photo when the team opens the request, narrowed to the area around the place. The team picks **This is the cat**, **Search somewhere else**, or **A cat we haven't recorded**, as in a batch. A cat chosen by a guardian or team member arrives already picked, and the team checks it against the photo;
- **warnings** once the cat is picked:
  - "Sterilised by a vet visit on 3 Mar 2025": the request can't be approved;
  - "Confirmed sterilised by her cat guardian", or "Probably sterilised: a spotter saw a clipped ear";
  - "Already in an open request, SR-198 (12 Nov)": see "Two people asking about one cat" below;
- **the month's budget line** (step 3): "October: €1,120 of €1,500 approved. Approving this uses up to €55 more."

**What the team can do:**

- **Approve.** The team sets:
  - **the most Syros Cats will pay**, starting at the standard price in Vet settings. It covers the sterilisation and the vaccinations given at the same visit (Decision B);
  - **who Syros Cats pays**: **the clinic**, which is where it starts, or **the person who asked, paid back against the clinic's bill**;
  - **the clinic**, from the clinic list (`lib/welfare-guidance/src/data/vets.json`), or "any clinic on our list";
  - **until when**, starting 8 weeks ahead;
  - optionally, **a message**, shown in the app and on the guardian's pages, never in an email: "Ask for Dr Nikolaou, she knows our price".
- **Decline**, with a reason from a fixed list and an optional message (in the app only):
  - "She's already sterilised. Thank you for checking";
  - "This month's budget is used up. Please ask again next month";
  - "Syros Cats will arrange this one themselves";
  - "Please call Syros Cats about this one".
- **Answer it's already done** in one tap, when the photo match shows a sterilised cat. This sends the first reason above.

*My call:* fixed reasons plus a short message in the app, so the person is never left guessing, and nothing they see is a team note.

The first decision wins. A second team member sees "Already decided by Jacky". The decision checks the capability again when it is written.

The cat the team picks is saved with the request. If the team chose **A cat we haven't recorded**, nothing is created yet. The cat is created when the visit is recorded (step 5), from the photos that come back.

**Two people asking about one cat.** The team only knows it's the same cat once it has picked the cat, so the check is on the cat the team picked. A cat can be in only one open request, held by the database. When the team picks a cat that is already in an open request, it **joins** the new request to the open one: the new photos and place are added to it as more evidence, and the new asker sees "Syros Cats is already helping this cat. Thank you". Neither asker is told about the other.

### 3. The spending limit

There are two limits, doing different jobs.

**The approval is the limit for that request:** the most Syros Cats will pay for that cat.

**The monthly budget limits what Syros Cats approves each month.** Management sets it in Vet settings, beside the standard price, and every change is kept in its history as price changes are. With no budget set there is no monthly limit, and the budget line shows only what has been approved.

**How a request uses the budget.** Each request belongs to the month it was **approved** in (Athens time), and only that month, however late its cat is done. Any extra cost saved later counts in that month too. What it uses of that month's budget:

- **while it is open:** the larger of its approved amount and what has been saved under it;
- **once it has closed:** only what was saved under it. A visit saved with no cost known counts as the approved amount until a cost is put in.

So the budget is a limit on decisions: "this month we agreed to pay for at most €1,500 of sterilisations". It isn't a limit on cash leaving the bank in a month. Approvals made in October can be paid in November, beside November's own. The **Paid** figure on Vet settings shows the cash side: every saved vet visit cost from any batch, by visit date. *My call:* deciding against the approval month is the figure a person approving can act on. Decision D asks Samuel to confirm it.

**Who may approve what:**

- A team member can approve a request that fits in what is left of its month's budget.
- Beyond the budget, only management can approve, with a typed reason. A team member sees "This would take October over its €1,500 budget. Management can approve it", and can still decline it.
- **Approvals can't race.** Approving, and saving a cost above an approval, happen in one transaction that holds a lock for that month and works out what is left inside it.

*My call:* the budget is for requests only (Decision C). Rounds Syros Cats runs itself are recorded as batches as now and don't use it.

### 4. Hearing back, and going to the vet

**How the answer reaches them:**

- **In the app they asked from**, under **My requests** in the profile, always. The app's own notification also tells them "Syros Cats answered your request", as it tells followers about a cat.
- **By email**, if they gave an address and confirmed it: one email per answer, in their language (Decision A). It is a fixed template with parameters only (amount, clinic, date, reference, reason), from the reports address, with replies going to Syros Cats.
- **By phone**, if they gave only a number. The team calls, and marks the request "Answered by phone".
- **A cat guardian or team member** sees it on their dashboard pages, and by email at their sign-in address (Decision A).

**What a yes says** (the email's fixed wording):

> Yes, Syros Cats will pay up to €55 to sterilise this cat at the Ermoupoli clinic, until 19 Dec. Quote request **SR-214** at the clinic. Syros Cats pays the clinic directly.

or, when Syros Cats pays the person back:

> … Pay the clinic, keep the bill, and send a photo of it with a photo of the cat. Syros Cats will pay you back up to €55.

*My call:* the reference **SR-214** is the request's number, short enough to say at a clinic counter. It carries nothing private. A clinic paid directly checks it with Syros Cats in its usual way.

The email never contains the photos, the place or the contact details, and links to nothing that needs a sign-in.

**If they lose the phone or clear the app**, they can no longer see the request in the app. They quote SR-214 to Syros Cats, and the team records the visit for them (step 5). Restoring their spots with a code (`restore-with-a-code.md`) brings their requests back too.

### 5. After the vet: sending it back, recording it, and paying

**What they send.** They open the request in the same app (or on their dashboard pages) and tap **Send the photos**:

- **a photo of the cat after the operation**, and up to five more;
- **the date** of the vet visit, not in the future and not before the approval;
- **the clinic**, if it changed. When Syros Cats pays them back, it has to be a clinic on the list;
- **what the vet did**: Sterilised, and Vaccinated if it was. This is a hint the team confirms;
- **a photo of the clinic's bill**: needed when Syros Cats pays them back, optional otherwise;
- **what the vet charged**, if they know. A hint, shown to the team, never the cost on its own;
- **a note** (optional).

**With no signal** it is saved on the phone and sent later, as the request was.

**The team can also record it for them.** On any approved request, **Record a visit for this request** opens the same batch with the request's details, for news that came by phone, or from the clinic. This is a normal way in, not a fallback.

**Recording it.** It appears in Needs an OK as **Photos to record**. **Record these** makes a vet visit batch, owned by the team member who tapped it, with the photos moved in (nothing is uploaded again), filled in with:

- the date and clinic;
- **where the cat came from**: the named area that contains the request's place (the nearest one if none does), which the team can change. The exact place stays on the request;
- the approved amount as the price, and **who paid**: Syros Cats;
- the cat the team picked when deciding, at the top of the matches, with its photo beside the new ones;
- what they said the vet did, and charged, as hints.

From there it is an ordinary batch (vet visit batches spec, steps 3 to 5). The team confirms the cat, puts in the cost and saves. For a cat nobody had recorded, the team creates it here and chooses which photo becomes its public main photo, as in a batch. The new cat's place is that area's centre, as in a batch.

**Checks on a batch made from a request:**

- **Already sterilised by a vet visit:** refused. The team removes the cat with the reason "already sterilised". If the earlier visit was a mistake, the team marks it wrong first.
- **Over the approval:** a cost above the approved amount needs **Approve the extra** with a typed reason. A team member can do that while the month's budget has room for it; beyond the budget only management can. The reason is kept on the request and is also the visit's cost note (`costReason`).
- **A different cat:** if the photos that come back show a different cat from the one approved, only management can record it under the request, with a typed reason. Otherwise the team removes it, and the person is asked to send a new request for that cat.

**Saving** writes the vet visit as any batch does. The cat becomes *Confirmed sterilised*, and the "sterilised" news goes out once to its followers, as for any confirmation. A new cat goes public. The visit records the request it was paid under.

**Paying.** Once the visit is saved, the request shows **To pay**: who (the clinic, or the person who asked), how much, and the bill if there is one. When Syros Cats has paid, outside the app, a team member taps **Paid**, with the date. When paying a person back:
- the bill's clinic must be on the list, and its date must match the visit;
- the team types the bill's number, and the database refuses a bill number from the same clinic that has already been paid;
- *My call:* at most 2 pay-backs a month to the same contact. More need management.

**If the team can't use the photos** (blurry, or the cat can't be told apart), it sends them back with "We couldn't tell which cat this is. Could you send another photo?", and they can send again.

**The evidence is kept safe.** A batch made from a request is never removed by the 7-day clean-up for unfinished batches. If the team abandons it, the photos go back to the request as **Photos to record**.

### 6. When a request closes

A request **closes** once it is **Paid**, or once it **Ends** without a visit. It ends when:

- the approval's date passes with nothing sent back. A sending made before that date is still recorded. The team can **extend** an approval before it ends, for a vet's delay or a shy cat;
- the person taps **I couldn't do it after all**, while it waits or once it's approved;
- the vet finds the cat was already sterilised. The person says so when sending back ("The vet said she was already done"), and the team closes it as "already sterilised". A check-up fee, if the clinic charged one, can still be recorded and paid;
- the team taps **End this approval**, with a reason they see.

Once closed, the unused part goes back to its month's budget.

### 7. What the person sees

**My requests**, in the profile of the app they asked from (and on dashboard pages), lists their requests, newest first:

| Where it stands | They see |
|---|---|
| Not yet delivered | Saved on this phone. It will send when you have a connection |
| Waiting | Waiting for Syros Cats |
| Approved | Yes: up to €55 at the Ermoupoli clinic until 19 Dec. Quote SR-214 |
| Photos sent | Photos sent: Syros Cats will record them |
| Recorded | Pipa was sterilised on 12 Nov. Thank you |
| Paid back (pay-backs only) | Syros Cats paid you back €52 on 20 Nov |
| Joined | Syros Cats is already helping this cat. Thank you |
| Declined | Syros Cats can't pay for this one: reason |
| Withdrawn | You withdrew this request |
| Ended | This approval ended on 19 Dec |

A recorded cat links to its page in the app, where it shows as sterilised. The person sees the amount on their own request, and nothing about costs elsewhere. When the clinic is paid directly, the person's request reads "Recorded"; a payment to the clinic isn't theirs to see.

## Limits and protections

The ask is public and unauthenticated, and it costs attention and money, so it has the cat-in-trouble report's protections (§4.4). The ones that bear weight are:

- **Turnstile** on every send;
- **limits per internet address and per email address**, as for reports;
- **no email to an unconfirmed address**, except the one "is this you?" message (F7b);
- **the team as the gate**: no money is committed until a named team member approves, and nothing is paid back without a clinic's bill that hasn't been paid before.

Courtesy limits only (an app's identity costs nothing to make, so these don't stop anyone determined): at most 5 open requests per app. Guardians and team members, who ask signed in, can have up to 20 open, for a colony being trapped.

- **One open request per cat**, held by the database, on the cat the team picked.
- **Photos:** at most 6 per sending; stripped of EXIF and GPS data; team-only (below).

## Privacy

- **The place is exact and team-only.** It is stored like a report's location, never shown in the public app or on the public map, and never put in an address. The cat's own public position is unchanged.
- **Photos are team-only**, as report and batch photos are. The person who asked sees their own photos on their own request. A photo becomes public only when the team makes it a new cat's main photo while recording.
- **The bill photo is private** and kept apart from cat photos. It is never a cat photo, never public, and seen only by the team.
- **Contact details** (email, phone) are seen only by the team and used only to answer the request. They are deleted 3 months after the request closes, as report addresses are.
- **"Delete my data"** removes everything that identifies the person, as the privacy policy promises:
  - their contact details, notes, bill photo and the exact place on their requests;
  - photos that weren't used on a cat's record;
  - the link to their app.

  What stays is Syros Cats' record of what it paid for: the cat's vet visit and the photos on it, the amount, the clinic, the bill's number and date, and "Someone (data deleted)" as who asked. A request still waiting is withdrawn.
- **The public app shows nothing** about a cat having a request, and requests are in no public catalogue or export.

## Words

- "Cat guardian", never "colony carer"; "spotter" for people using the public app; "someone" for an asker the team doesn't know.
- Everything the person asking sees, including every fixed reason, state and email, is in English, Greek and French, as the app is. Johnny checks the Greek and French (SYC-283). Until he has signed a language off, that language's emails go in English, as the report's emails do. The app's own words follow the app's usual rule.
- Team pages stay English.
- Money in whole euros, "€55".
- No text below 12px.

## Constraints the builder must respect

- **The person who asked never writes the record.** Only saving a batch writes a vet visit, through the batch writer (`saveBatch` in `lib/vetVisits.ts`), so D8 and every batch rule hold. The batch belongs to the team member who taps **Record these**.
- **What changes in the batch code**, with tests for each:
  - `saveBatch` learns the request: the "already sterilised" refusal, the over-approval check under the month lock, and linking each visit to its request;
  - `lib/vetBatches.ts` holds the request link;
  - the 7-day clean-up leaves request batches alone, and abandoning one returns its photos to the request.
- **Two front doors, one request.** The public ask is a public route (like `POST /api/reports`), tied to the app's device identity, which works on phones and in the browser. The signed-in ask is on the dashboard (`/api/team/my/…` for guardians, the cat page for the team), server-drawn with no scripts. Both make the same kind of request.
- **Storage.** Requests, their decisions, their sendings and their payments are tables of their own, with the confirmation queue's rules: the first decision wins, the decision re-checks the capability, a signed-in asker never decides, and rows are never deleted (only redacted, for "Delete my data"). A batch records the request it came from, and so does the visit saved from it. That needs a migration.
- **Payments live on the request, not the cat.** Who was paid, how much, when, and the bill are a payment row on the request. The vet visit keeps its existing `paidBy` (Syros Cats, a donation, or the owner), so nothing about the person who asked goes on the cat's permanent record.
- **Photos.**
  - Request and sending photos are stored in `photos` with a link to the request, and that link joins the team-only rule in `teamOnlyPhotoIds`, so moving them into a batch is a change of link, not a copy.
  - Bill photos are in a private table of their own, like `welfare_report_photos`, never in `photos`.
  - The person who asked reads their own photos through a route that checks they are the asker (their app's device identity, or the dashboard sign-in).
  - Every reader that picks display photos, reference photos, public galleries, guardian views, exports or fingerprints leaves request photos out, with a test for each.
- **Mail.** Answer emails are fixed templates with parameters (`lib/mail/send.ts`: public purposes carry no caller text): a new transactional purpose to a confirmed public address (`verified_public`, like `report_outcome`), and a person purpose for a signed-in asker. Replies go to Syros Cats.
- **"Delete my data"** (`DELETE /api/me`) is extended to the new tables, and `me.delete.test.ts` lists them.
- **Capabilities.** New rows in the catalogue (`roles-and-invites.md` §6.2):
  - `request_sterilisation`, placed: asking from the dashboard, for a guardian's own colonies and for the team island-wide. The public ask needs no capability, as reports need none;
  - `settle_sterilisation_request`, island: identify, approve, decline, join, extend, end, record and mark paid. *My call:* its own capability, not `settle_confirmation`, because this one commits money. Recording also needs what a batch needs: `log_vet_visit`, `find_cat_from_photo`, `view_vet_costs`;
  - `set_sterilisation_budget`, management only;
  - `approve_over_budget`, management only: beyond the budget, a different cat, or more than 2 pay-backs a month to one contact.

  Every new team route gets its row in `team.walk.test.ts`; a module that reads team-only data joins `ISLAND_ONLY_MODULES` in `guardianView.source.test.ts`.
- **Search limits.** Identifying the cat on a request uses the batch search allowance (vet visit batches spec), not the single-photo page's.
- **Process:** each PR is a draft until reviewed. Run the full api-server suite before `gh pr ready`. Screenshots at 390px and 1280px, in each live language.

## Changes this makes to approved specs

These go in with this design, once Samuel approves it:

- **`roles-and-invites.md` §7.1:** "Needs an OK" holds a second kind of item, a request for Syros Cats to pay for sterilising a cat, and the photos sent back for it. Each kind is shown to people holding its own capability.
- **`roles-and-invites.md` §7.3**, "Nothing a guardian says about a cat is queued": add "A request for Syros Cats to pay for sterilisation is not a statement about a cat. It asks for money, so it waits for the team (SYC-284)."
- **`roles-and-invites.md` §6.2:** the four new capabilities above.
- **`roles-and-invites.md` Q8:** answered further: anyone can ask in the app, guardians included (SYC-284).
- **`team-access-and-welfare-queue.md` §4:** a second public ask beside the report, with the same protections.
- **`privacy-policy.md`:** the app now asks for a phone number (it hasn't before), an exact place and a bill photo, for this one purpose. It says what each is used for, who sees it, how long it is kept, and what "Delete my data" removes and keeps.
- **`2026-10-24-vet-visit-batches-design.md`:** a batch can come from a request. Such a batch is exempt from the 7-day clean-up, and its "Already sterilised by a vet visit" check is a refusal rather than a tick.

## Decisions for Samuel

Each has a recommendation, and the rest of the document assumes it.

**A. Does the person who asked get an email when Syros Cats answers?**
- *Yes, one fixed email per answer, to a confirmed address, in their language (recommended).* An approval is what lets them go to the vet, and most askers will never open the app's profile to check. Risk: more email to look after, though it is the same kind as the report's outcome email.
- *No, they check My requests in the app.* Simpler. Risk: they don't, and phone Syros Cats anyway.

**B. What does the approved amount cover?**
- *Sterilisation and the vaccinations given at the same visit, as one amount (recommended).* That matches "Syros Cats pays for the sterilisation and vaccinations", and a vet's bill for the visit reads that way. Risk: the standard price is a sterilisation price, so the team may often raise the starting figure.
- *Sterilisation only.* Risk: half the bill is outside the record.

**C. What does the monthly budget cover?**
- *Requests only (recommended).* It limits what the team approves on someone else's word. Rounds Syros Cats runs itself are its own decision. Risk: the budget isn't the charity's whole sterilisation spend. The Paid figure shows that.
- *Everything, including the team's own rounds.* Risk: a team round can use up the money for public requests without anyone deciding to.

**D. How does the spending limit work?**
- *A monthly budget on what is approved each month, with management approving anything over it (recommended).* The person approving sees exactly what is left to agree to. Risk: a month's approvals can be paid in the next month, so cash out in one month can run above that month's budget. The Paid figure shows when that happens.
- *A monthly budget on cash paid out each month.* Matches the bank. Risk: when approving, nobody knows which month the money will land in, so the team can't tell whether a request fits.
- *A per-request limit only.* Simplest. Risk: nothing shows the month's total until the money has gone.
- *A hard monthly stop.* Risk: a pregnant cat in December waits for January.

## Calls made in this document (for Samuel to check)

- One cat per request; a photo is always needed, even from a cat's page.
- A phone number is enough to ask; the team calls back.
- No price is shown to the person before the team answers.
- The team identifies the cat by photo match before deciding; a new cat is created only when the visit is recorded.
- Two requests found to be about the same cat are joined, and the second asker is thanked.
- Syros Cats pays the clinic unless the team chooses to pay the person back.
- A pay-back needs a bill from a clinic on the list, with a date matching the visit, and a bill number not already paid; at most 2 pay-backs a month to one contact without management.
- A different cat coming back needs management to record it under the request.
- The yes carries a short reference (SR-214) to quote at the clinic.
- Team messages appear in the app and on dashboard pages, never in emails.
- A request uses the budget of the month it was approved in; an unused approval goes back when it closes; a visit with no cost counts as the approved amount.
- The batch's place is the named area containing the request's place.
- Contact details are kept until 3 months after the request closes.
- Courtesy limit of 5 open requests per app; 20 for guardians and the team.
- A batch made from a request is kept until saved; an abandoned one goes back to the request.
- Requests have tables of their own; payments live on the request, not on the cat's visit.

## Left to the builder

- Where **My requests** sits in the app's profile and on the dashboard, and the layout of Needs an OK.
- How the month lock is taken.
- How "the named area that contains the place" is worked out.
- The split into PRs. A likely order: requests, Needs an OK and the decision; the budget; sending back, **Record these** and paying; answers by email and in the app; the dashboard door.
