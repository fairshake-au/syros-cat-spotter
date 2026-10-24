# Recording a batch of vet visits from photos (SYC-677)

**Status:** draft for Samuel's approval, 24 Oct 2026. This replaces §8.5 of `docs/specs/team-dashboard-redesign.md` ("Logging a whole trapping round"). It is the design for re-building PR #327, which is held as a draft.

**Linear:** SYC-677 (this design), SYC-621 (the planner, PR #326, unaffected), SYC-473 (adding a cat nobody has recorded yet, folded in here).

## Why

The approved §8.5 assumed the team ticks known cats off a colony's list. Samuel corrected that on 24 Oct 2026:

> "the reality of trapping rounds is that Syros Cats will trap whichever cats they find, and they won't know which cats they've caught without a photo match"

> "Syros Cats volunteers (and community helpers, e.g. guardians) will trap cats, Syros Cats pays for the sterilisation and vaccinations, and then Syros Cats keeps a record with the cat's photo and the cost they approved/paid"

> "ultimately, Syros Cats receives the photos, information and pays, and needs to record that"

So the job is **record keeping at Syros Cats' desk**, after the event. Syros Cats has received photos of each trapped cat and the details of what the vet did. It has approved and paid the cost. Now it needs a record against the right cat.

## Goals

- Someone at Syros Cats records a batch of vet visits, starting from the photos they received.
- Each cat in the batch is identified by a photo match, or recorded as a new cat when nobody has recorded it before.
- Each visit records what was done (one or more of Sterilised, Vaccinated, Treated) and the cost Syros Cats approved and paid.
- The photos are kept with the visit, as the record of what Syros Cats paid for.
- The batch saves whole or not at all.

## Non-goals

- Planning a round. That is the planner (PR #326): To do, the estimate, the map, the printed photo sheet.
- Trappers or cat guardians entering visits themselves. Guardians can't log visits today (`log_vet_visit` is island-only) and this design doesn't change that. They send photos and details to Syros Cats by whatever means they use now.
- Recording who trapped each cat as a person in the app.
- Vet invoices, payment runs or accounting.

## Anti-goals

These would make it a failure even if it worked:

- **A visit on the wrong cat.** Identity is the riskiest step. Nothing is saved against a cat that nobody confirmed. A machine suggestion alone is never enough.
- **Retyping.** A batch of 12 cats must not mean 12 copies of the same date, clinic and price.
- **Losing work.** A problem with one cat, or a search limit, must never throw away what was typed or uploaded for the others.
- **Leaking positions or photos.** No position goes into an address. The kept photos are never shown to the public, and EXIF and GPS data are stripped as for every upload.

## How it works

### 1. Start a batch

On the dashboard, **Record vet visits** opens a new batch. It appears in the menu or on Home (builder's call). A colony's planner page links to it with that colony already chosen.

The batch holds what its cats share:

- **the date** of the vet visits (not in the future, as now);
- **the clinic**, from the one clinic list;
- **where the cats came from** (optional): a colony, or a place. This narrows the photo search to the right cats first. Samuel (24 Oct) wants the batch's colony or place recorded because "Syros Cats will use the app's data to decide where to trap": a batch from a colony feeds that colony's figures through its visits.
  - A **colony** is chosen from the colonies list.
  - A **place** is a named area, chosen from the areas list. *My call:* the named areas, rather than a tapped map point, because they already exist, they can go in an address, and they're how the Cats filters narrow a search. A tapped point can come later if the team wants one.
- **the standard price**, filled from Vet settings and changeable for this batch;
- **who paid** (Syros Cats, a donation for this cat, or the owner), which each cat can change;
- **a note** (optional).

### 2. Add the cats, one or more photos each

The team adds each trapped cat with **one or more photos** (Samuel, 24 Oct: "it could be more than one photo per cat"). Adding a cat uploads its photos together.

### 3. Confirm who each cat is

For each cat the app runs **Find from a photo** on its first photo, narrowed by the batch's colony or place when one is set. It shows the suggested matches as today: photo, name, SYR number, and a "very likely" / "possible" band. The team then picks one of these:

- **This is the cat**: one of the matches.
- **Search somewhere else**: widen the search, or look up a cat by name or SYR number.
- **None of these: a cat we haven't recorded**: makes a new cat record from these photos (SYC-473, brought forward). The new cat needs:
  - a name, which the team types (*my call:* required, as for every cat today);
  - a place. *My call:* the batch's colony centre or area centre, else the team picks an area. It is never a position typed as numbers.
  - membership of the batch's colony, if one was chosen.

A cat isn't ready to save until it has been confirmed.

*My call:* only the first photo is searched, so a cat costs one search. The other photos come along as extra evidence and are kept.

### 4. Say what was done and what it cost

Each cat has:

- **what was done**: one or more of **Sterilised**, **Vaccinated** and **Treated**. There is no "Checked only" in a batch (Samuel, 24 Oct);
  - Vaccinated asks which vaccines, which can be the same for the whole batch;
  - Treated asks what for;
- **the cost Syros Cats approved and paid**. It starts at the batch's price when Sterilised is ticked and can be changed for this cat;
- **who paid**, if it differs from the batch;
- an optional note.

### 5. Save the batch

**Save** writes one vet visit per cat, all in one transaction. It uses the same writer as a single visit (`writeVisit`/`logRound` from #327), so D8 holds: a cat guardian's standing "not sterilised" is marked overruled by the visit, and undoing a visit puts her answer back. New cats are created in the same transaction.

If anything is refused, nothing is saved, and the batch comes back with everything typed and uploaded still there and the problem named beside its field.

### 6. Keep the photos with the visit

Every photo in the batch is kept, tied to its visit (Samuel agreed, 24 Oct). These photos are:

- shown to the team on the cat's page, in its vet visit;
- never shown to the public or to cat guardians. Guardians see that a visit happened and what was done, as they do now (§10.2), without costs or vaccinations;
- not made the cat's main photo automatically (*my call*);
- stripped of EXIF and GPS data, and stored in the same photo store, with the same size versions, as other photos.

## Constraints the builder must respect

- **Search limits.** Find from a photo allows 20 searches per person a day and 100 for the team (`findPhotoPage.ts`). A batch of 15 cats uses 15 searches at most, since only the first photo of each cat is searched. *My call:* batch searches count towards the same limits. If a limit is reached mid-batch, the remaining cats can still be identified by name or SYR number, and nothing already done is lost. Raising the limits is for Samuel to decide, not the builder.
- **Who can use it:** the team only. That means `log_vet_visit`, plus `find_cat_from_photo` for the search. Vaccinations need `set_vaccination`, and cost and payer fields appear only with `view_vet_costs`, as on the single-visit form. A cat guardian gets 403 on every batch route.
- **Batch size:** at most 40 cats (`ROUND_MAX`, as in #327).
- **Unfinished batches:** they live only until saved or abandoned. *My call:* the builder decides how an unfinished batch survives a page reload or a lapsed sign-in. The repo's held-typing pattern (SYC-516) is the model, and photos already uploaded must not need uploading again.
- **No script required:** the dashboard is server-drawn with no scripts. The batch must work that way too. Uploading several photos at once uses a plain file input with `multiple`.
- **Words:** "cat guardian", never "colony carer"; "spotter"; plain English; no text below 12px. Team pages are English only (Decision 12).
- **Process:** each PR is a draft until reviewed. Run the full api-server suite before `gh pr ready`. Screenshots at 390px and 1280px.

## What happens to existing work

- **PR #326 (the planner):** unchanged. Its "Log this round's vet visits" link is in #327, not #326, so nothing on the planner points to the old form.
- **PR #327 (the old round form):** closed when this design is approved. Its `logRound` (one transaction, ascending locks, the shared writer) and its tests carry over into the new build. Its tick-off-a-list form doesn't.
- **SYC-473** (add a new cat from the round form, 16 Nov) is absorbed by step 3. Close it as a duplicate of SYC-677 on approval.
- **The single-visit form** on a cat's page stays as it is, for a cat the team already knows.

## Left to the builder

- Where **Record vet visits** sits in the menu or on Home.
- The screens: one page with sections, or a short sequence of pages.
- How an unfinished batch is held between requests.
- How the kept photos are stored and linked to the visit (a new photo source or link table), within the rules above.
- The split into PRs. A likely order: storing the photos and the batch writer; then the batch form with the matching step; then new cats.
