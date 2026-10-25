# Cat guardians asking Syros Cats to pay for sterilisation (SYC-284)

**Status:** Draft for adversarial review, then Samuel's approval. Nothing is built from this until he approves it.

**Linear:** SYC-284 (this design), under SYC-610 (Epic: Guardians, volunteers and roles). Builds on SYC-677 (vet visit batches, `2026-10-24-vet-visit-batches-design.md`). Related: SYC-686 ("Needs an OK" for site-public requests), SYC-476 (the "Needs an OK (N)" line on Home), SYC-53 (roles, `docs/specs/roles-and-invites.md`).

## Why

Samuel described how a sterilisation round really runs (24 Oct 2026):

> "Syros Cats volunteers (and community helpers, e.g. guardians) will trap cats, Syros Cats pays for the sterilisation and vaccinations, and then Syros Cats keeps a record with the cat's photo and the cost they approved/paid"

Cat guardians are the people most often standing next to an unsterilised cat. They arrange sterilisation that Syros Cats pays for, at **€50–60 per cat** (roles spec Q8, 12 Oct 2026). Done by phone or WhatsApp, three things get lost:

- **the ask**: which cats, from which colony, and what Syros Cats agreed to pay;
- **the proof**: the photos of each cat, which end up in a chat thread instead of on the cat's record;
- **the link** between what was approved and what was paid, so the team can't see how much of its sterilisation money went where.

This design puts the whole exchange in the app. A cat guardian asks; the team says yes (with a limit) or no; the guardian takes the cats to the vet and sends back the photos; the team records them as a vet visit batch, the same way it records any round. Nothing about a cat's record is written until the team has confirmed which cat it is.

## The whole journey in one paragraph

Eleni is the cat guardian for Vaporia. Three of her cats aren't sterilised, and she has seen a new young female. On her colony page she taps **Ask Syros Cats to pay for sterilisation**, ticks the three cats, adds "1 cat not on the app yet", picks the clinic and the week she hopes to go, and sends it. She sees "4 cats, about €220, waiting for Syros Cats". Jacky sees it in **Needs an OK** on the dashboard, sees this month's sterilisation spending beside it, and approves 4 cats at up to €55 each. Eleni sees "Approved: up to 4 cats, up to €55 each, until 15 Dec". She traps the cats, the vet does them, and she opens the request and taps **Send the photos**: one or more photos per cat, the date and the clinic, and for each photo which of her cats it is (or "a cat not on the app"). The team gets a ready-made vet visit batch, confirms each cat by photo match, puts in what the vet charged, and saves. Eleni's three cats show as sterilised in her colony, the new cat appears in the app, and her request reads "Done: 4 cats recorded on 12 Nov. Thank you."

## Goals

- A cat guardian can ask Syros Cats to pay for sterilising cats in her colonies, including cats nobody has recorded yet.
- The team approves or declines each request, and an approval says how many cats and the most Syros Cats will pay for each.
- The team sees its sterilisation spending against a monthly budget when it decides.
- After the vet, the guardian sends the photos and details back through the request, and they arrive as a vet visit batch the team only has to check and save.
- The guardian can always see where her request stands, in her own language.
- Every approved and paid euro is traceable from the request to the vet visit on each cat.

## Non-goals

- **Booking the vet.** The guardian arranges the appointment with the clinic herself, as she does now. The app records the clinic and the week she plans, not a booking.
- **Paying anyone.** The app records what Syros Cats approved and what it paid. It does not move money, issue invoices or reimburse the guardian. Who pays the clinic, and how, stays with Syros Cats.
- **Guardians writing vet visits or searching by photo.** Recording a vet visit and Find from a photo stay team-only (`log_vet_visit`, `find_cat_from_photo`). A guardian sends evidence; the team writes the record.
- **Spotters or cat owners asking.** Only cat guardians ask, and only for their own colonies. A spotter who sees an unsterilised cat sends a cat-in-trouble report or contacts Syros Cats, as now.
- **Other paid treatment.** A request is for sterilisation. Treatment for an injured or sick cat goes through the cat-in-trouble report.

## Anti-goals

These would make it a failure even if it worked:

- **A visit or a payment on the wrong cat.** The guardian's word on which cat a photo shows is a strong hint, never the record. The team confirms each cat before saving, exactly as in a batch.
- **Paying twice for one cat.** A cat that already has a sterilising vet visit, or that is already in another open request, is flagged before anyone approves or saves.
- **Money committed with no trace.** Every approval records who approved it, how much and until when, and every saved cat points back to the request it was paid under.
- **A queue that promises a reply.** No countdown, no reminder, no "we'll answer within". The team decides when it can (the welfare queue's rule, `team-access-and-welfare-queue.md` §3.1).
- **Leaking positions or photos.** No position goes into an address. The photos a guardian sends are team-only unless they become a new cat's main photo (as in a batch). EXIF and GPS data are stripped as for every upload.
- **Guardians going back to WhatsApp** because the form is slower than a message. Asking for one cat must take under a minute on a phone.

## Who does what

| Person | Can |
|---|---|
| **A cat guardian**, for her own colonies | Ask for sterilisation for cats in her colonies and for cats not yet on the app; see, change or withdraw her open requests; send the photos and details back for an approved request; see where each of her requests stands |
| **The Syros Cats team** | See every request in **Needs an OK**; approve (within the monthly budget) or decline; change the approved number of cats or the price cap; turn sent photos into a saved vet visit batch |
| **Management** | Everything the team can, plus set the monthly sterilisation budget, and approve a request that takes the month over budget |

A guardian who is also on the team can't approve her own request (the confirmation queue's rule: the person who asked never decides, `roles-and-invites.md` §7.3).

## How it works

### 1. The guardian asks

**Where.** On her colony page there is **Ask Syros Cats to pay for sterilisation**. On a cat's page in her colony, the same button starts a request with that cat already ticked. The button doesn't show on a cat that is *Confirmed sterilised*.

**What she sends:**

- **the colony** (from her colonies; a request is for one colony);
- **which cats**: she ticks cats from her colony's list. The list shows each cat's photo, name and sterilisation answer, with cats not known to be sterilised first. A cat that is *Confirmed sterilised* is shown but can't be ticked ("Already sterilised"); a cat that is *Probably sterilised* can be ticked, with the line "This one may already be done. Check her ear if you can";
- **cats not on the app yet**: a number, 0 to 10, for cats she plans to trap that nobody has recorded. She doesn't need photos of them now;
- **the clinic**, from the one clinic list, or "Not sure yet";
- **when she hopes to go**: a week, or "As soon as possible". This is for the team's planning, not a booking;
- **a note** (optional), for anything the team should know ("the black male is very shy, may need two tries").

**What she sees before sending:** "4 cats. Syros Cats usually pays about €55 per cat, so about €220." The figure is the standard price from Vet settings times the number of cats.

**What she sees after sending:** the request, marked **Waiting for Syros Cats**, with "You'll see their answer here. There's no need to message them as well." She can change it or withdraw it while it is waiting.

*My call:* one colony per request, so the team decides with the colony's figures in front of it, and the batch it becomes has one colony.

*My call:* cats she can tick are only cats in her colonies. A cat of hers that isn't in the colony yet, she adds first (she can, `roles-and-invites.md` §7.4), or counts as "not on the app" if nobody has recorded it.

### 2. The team decides

**Where.** The request appears in **Needs an OK** on the dashboard, beside site-public requests, oldest first. Home shows "Needs an OK (N)" (SYC-476). Nobody is paged.

**What the team sees:**

- the guardian's name, the colony, the date she asked, the clinic and the week she hopes to go, and her note;
- each ticked cat with its photo, SYR number and sterilisation answer, with any warning beside it:
  - "Already has a sterilising vet visit (3 Mar 2025)". This can only appear if the cat's answer changed after she asked; the cat can't be approved;
  - "Also in Kostas's open request (12 Nov)": a cat already in another open or approved request;
  - "Probably sterilised: a spotter saw a clipped ear";
- the number of cats not on the app yet;
- the colony's figures (cats, how many sterilised, from the planner);
- **this month's sterilisation spending**: approved so far this month, paid so far this month, and the monthly budget. For example: "October: €1,120 approved, €880 paid, budget €1,500. Approving this adds up to €220."

**What the team can do:**

- **Approve.** The team sets:
  - **the number of cats**, which starts at the number she asked for and can be lowered (not raised; she asks again for more);
  - **the most Syros Cats will pay per cat**, which starts at the standard price;
  - **until when** the approval lasts, which starts 8 weeks ahead;
  - an optional **message to the guardian** ("Please use the Ermoupoli clinic, they've agreed our price").
  The approval is the number of cats times the per-cat cap. That figure is what is counted as "approved" against the month's budget.
- **Approve some cats only.** The team unticks cats it won't pay for, with a reason from a fixed list ("already sterilised", "in another request", "not this time") that the guardian sees.
- **Decline**, with a reason from a fixed list: "Over this month's budget, please ask again next month", "These cats are already sterilised", "Syros Cats are trapping this colony themselves", "Please call Syros Cats about this one", and an optional message. *My call:* a fixed list plus a short message, so the guardian is never left guessing, and nothing she sees is a team note.

The first decision wins. A second team member who opens it a moment later sees "Already decided by Jacky". The capability is checked again when the decision is written, not only when the page was drawn.

### 3. The spending limit

There are two limits, and they do different jobs.

- **The approval itself is the limit for that request.** It says how many cats and how much per cat. When the team records the cats (step 5), a cat whose cost is over the cap, or a cat beyond the approved number, needs the team to tick "Approve the extra" before it saves. Nothing stops the team paying more, but it is never silent, and the request shows the difference.
- **The monthly budget is the limit for Syros Cats.** Management sets it in Vet settings, beside the standard price, with its history as the price has. Every approval in a calendar month (Athens time) counts against it.
  - A team member can approve a request that fits within what is left of the month's budget.
  - A request that would take the month **over budget** can only be approved by management. A team member sees "This would take October over its €1,500 budget. Management can approve it" and can still decline it, or approve fewer cats so it fits.
  - When an approval expires or closes with cats unused, the unused part stops counting.
  - With no budget set, there is no monthly limit, and the spending line shows the month's figures without one.

*My call, for Samuel to confirm:* the budget counts **guardian requests only**, because those are the approvals the team makes on someone else's word. Rounds Syros Cats runs itself are recorded as batches and show in the month's "paid" figure, but don't use up the requests' budget.

### 4. The guardian takes the cats to the vet, then sends the photos

**What she sees once it's approved:** "Approved: up to 4 cats, up to €55 each, until 15 Dec", the team's message if any, and which cats were left out and why. The approved per-cat amount is shown to her, because she is the one arranging the visit with the clinic. *My call:* she sees the amount on her own request only; costs and vaccinations on vet visits stay hidden from guardians, as everywhere else (`team-dashboard-redesign.md` §10.2).

**After the vet,** she opens the request and taps **Send the photos**. She gives:

- **the date** of the vet visit (not in the future, and not before the request was approved);
- **the clinic**, if it changed;
- **each cat**: one to six photos, and which cat it is, chosen from the cats in the approval plus her colony's other cats, or **"A cat not on the app"**;
- **what the vet did**, per cat: Sterilised, and Vaccinated if it was;
- **what the vet charged**, per cat or in total, if she knows it (optional);
- **a photo of the vet's bill** (optional);
- **a note** (optional).

She can send photos more than once against one approval: three cats this week, the shy one next week. Each sending becomes its own batch. When she has finished she taps **That's all for this request**, or the request finishes itself when every approved cat has been recorded or the approval ends.

**What happens to the photos:** they're stripped of EXIF and GPS data, stored as a batch's staged photos are, and team-only. The guardian sees the photos she sent on her own request. Nobody else outside the team does.

**After sending,** her request reads **"Photos sent: Syros Cats will record them"**. She can still remove a photo she sent by mistake, until the team saves the batch.

### 5. The team records it as a batch

Each sending makes a **vet visit batch**, ready to open from the request and from the batch list (**Record vet visits**). The batch comes filled in:

- the date and clinic she gave;
- the request's colony as "where the cats came from";
- the request's per-cat cap as the batch's price, unless she said what the vet charged, which is used instead;
- **who paid**: Syros Cats;
- each cat, with its photos and what the vet did;
- for each cat, **her pick** at the top of the matches: "Eleni says this is Mimi", with Mimi's photo beside the photos she sent. The usual Find from a photo matches are listed below it.

From there the team does exactly what a batch asks (vet visit batches spec, steps 3 to 5): confirm each cat (**This is the cat**, **Search somewhere else**, or **None of these: a cat we haven't recorded**), check what was done and the cost, and save.

Two extra checks on a batch that came from a request:

- **Over the approval:** a cat beyond the approved number, or a cost above the per-cat cap, is marked and needs "Approve the extra" (step 3).
- **Already paid for:** a confirmed cat that already has a sterilising vet visit gets "Mimi already had a sterilising vet visit on 3 Mar 2025", and saves only if the team ticks "Record this visit as well". Saved visits record a sterilisation once; this stops paying twice for a cat that was misidentified or caught twice.

**Saving** writes the vet visits as any batch does, in one transaction: a cat confirmed as sterilised by a vet visit becomes *Confirmed sterilised* (and the "sterilised" news goes out once, as for any confirmation), a new cat goes public, and each visit records which request it was paid under. The request's "paid" figure becomes the sum of the costs saved.

**If the team can't use the photos** (blurry, or a cat it can't identify and won't add), it can remove a cat from the batch with a reason from a fixed list that the guardian sees ("We couldn't tell which cat this is. Could you send another photo?"). She can send that cat again.

**A batch made from a request is kept until it is saved or the team removes it.** It is never cleared by the 7-day clean-up for unfinished batches, because the photos in it are the guardian's evidence and she can't re-take them.

### 6. What the guardian sees afterwards

On her request:

- **Done: 4 cats recorded on 12 Nov. Thank you.** Each recorded cat is listed with its name and photo (the cat's public photo, or for a new cat its new main photo).
- A cat the team removed is listed with the reason.
- If cats were left unused when the approval ended: "1 approved cat wasn't used. Ask again whenever you're ready."

On her colony and on each cat: the vet visit shows as visits always do on her pages ("Seen by a vet on 12 Nov"), with the date and what was done, without the cost or the vaccinations. The cat's sterilisation answer shows *Confirmed sterilised*. A new cat appears in her colony.

**"My requests"** on her pages lists all her requests, newest first, with where each one stands:

| State | She sees |
|---|---|
| Waiting | Waiting for Syros Cats |
| Approved | Approved: up to N cats, up to €X each, until date |
| Photos sent | Photos sent: Syros Cats will record them |
| Done | Done: N cats recorded on date |
| Declined | Syros Cats can't pay for this one: reason |
| Withdrawn | You withdrew this request |
| Ended | The approval ended on date with N cats unused |

**No email** when the team decides (as roles spec Q4 decided for site-public requests). She sees the answer on her next visit to her pages. Guardians are people with a sign-in, not app devices, so there is no push to send them. *My call, for Samuel to confirm:* a guardian waiting to book a vet may want to know sooner. If so, the fix is one email on each decision, in her language, through the mail outbox as a new purpose for a person (as invitations are).

## Limits

- **Open requests:** at most 3 waiting or approved per guardian, and at most 20 cats in one request (10 of them not on the app).
- **One request per cat:** a cat can be in only one waiting or approved request at a time. A guardian ticking a cat that is in someone else's open request sees "Kostas has already asked about this cat" and can't tick it.
- **Photos:** at most 6 per cat, as in a batch. A sending has at most the approved number of cats plus 3 (for extra cats she found), and at most 40 cats in all (`ROUND_MAX`).
- **Upload rate:** the same per-person photo upload limit as other guardian uploads.
- **Signal:** asking, sending photos and reading the answer all need a connection. A guardian with no signal can fill the form and send it once she has signal, as with any dashboard page; nothing is queued for her in the meantime. *My call:* a request isn't urgent enough to justify an offline queue on these pages.

## Words

- "Cat guardian", never "colony carer"; "spotter" for public app users; "Syros Cats" for the team on her pages, never a team member's name except in "Already decided by".
- Everything the guardian sees is in English, Greek and French (roles spec Decision 10), drafted and checked by Johnny (SYC-283). Team pages stay English.
- Money in whole euros, "€55", as in Vet settings.
- No text below 12px.

## Constraints the builder must respect

- **Guardians stay on the dashboard.** All of this is on the guardian's pages at `team.catspotters.com`, server-drawn with no scripts. Uploading several photos uses a plain file input with `multiple`. The public app is unchanged.
- **Guardians never write the record.** A request and its photos are evidence held for the team. Only saving a batch writes vet visits, through the batch writer (`saveBatch` in `lib/vetVisits.ts`), so D8 and every batch rule hold.
- **Capabilities:**
  - a guardian needs a new colony-scoped capability to ask and to send photos (`request_sterilisation`), checked for the colony on every write;
  - the team needs a new island capability to decide (`settle_sterilisation_request`) plus `view_vet_costs`. *My call:* a capability of its own rather than `settle_confirmation`, because this one commits money; turning a sending into saved visits needs what a batch needs (`log_vet_visit`, `find_cat_from_photo`, `view_vet_costs`);
  - management needs a new capability for the budget and for approving over it (`set_sterilisation_budget`). The standard price stays under `edit_vet_settings`, which the whole team holds.
  These join the catalogue in `roles-and-invites.md` §6.2.
- **The record of a decision is never deleted.** Requests, decisions and their reasons are kept, with who and when, as confirmation items are (`roles-and-invites.md` §10.3): the person who decided can't be the person who asked, the first decision wins, and the decision re-checks the capability.
- **Each visit points to its request**, so a cat's page can say "Paid under Eleni's request of 2 Nov" to the team, and the request's paid figure is the sum of its visits' costs. Batches carry no such link yet (`vet_batches` has no source field), so this needs a migration: a link from a batch to its request and from each saved visit to it.
- **Request pages and the budget read are guardian-reachable or island-only on purpose.** A new lib module that reads team-only data (spending, other guardians' requests) joins `ISLAND_ONLY_MODULES` in `guardianView.source.test.ts`; every new `/api/team/*` route gets its row in `team.walk.test.ts`.
- **Photo rules:** the sent photos follow the batch rules exactly (team-only, never a display or reference photo for a known cat, a new cat's first photo becomes its main photo). Every reader that picks display photos, reference photos, public galleries, guardian views, exports or fingerprints must leave them out, and a test proves it for each. The one addition: a guardian sees the photos she herself sent, on her request.
- **Process:** each PR is a draft until reviewed. Run the full api-server suite before `gh pr ready`. Screenshots at 390px and 1280px, for guardian pages in all three languages.

## Calls made in this document (for Samuel to check)

- A request is for one colony.
- A guardian can tick only cats in her colonies, plus a count of cats not on the app.
- The team can lower the number of cats but not raise it.
- An approval lasts 8 weeks by default.
- Declining uses a fixed list of reasons plus an optional message.
- The monthly budget counts guardian requests only, and going over it needs management.
- The guardian sees the approved per-cat amount on her own request, but no costs elsewhere.
- No email or push when the team decides.
- One request per cat at a time; at most 3 open requests per guardian, 20 cats per request.
- A batch made from a request is kept until saved or removed, not cleared after 7 days.
- No offline queue for requests.

## Left to the builder

- How requests are stored: a table of their own, or a kind of confirmation item with a table for the cats. Either must keep the confirmation queue's rules above.
- How the request's states are stored, as long as the guardian's table of states above is what she sees.
- Where "My requests" sits on the guardian's pages.
- The layout of Needs an OK when it holds both kinds of item.
- The split into PRs. A likely order: requests and the decision; the budget; sending photos as a batch; the guardian's views and words.
