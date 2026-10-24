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
- **None of these: a cat we haven't recorded**: makes a new cat record from these photos (SYC-473, brought forward). See "A new cat" below.

A cat isn't ready to save until it has been confirmed.

- **The same cat twice in one batch** is refused, naming both entries.
- **A cat that already has a visit on the batch's date** gets a warning: "Mimi already has a vet visit on 24 Oct." It is saved only if the team ticks "Record this visit as well". That stops a retried or doubled batch from counting a cost twice (*my call*).
- **Two "new" cats in one batch that are really the same cat** can't be caught automatically. The team merges them afterwards, as today.

### A new cat

Samuel (24 Oct): new cats go **public straight away**, "but give Syros Cats the option to create a profile incl name the cat, or allow the public to spot and name the cat".

- **Public at once.** The new cat appears in the public app like a cat a spotter found. Its first trapping photo is its main photo, so future photo searches can match it.
- **Two ways to name it.** Syros Cats chooses one, per cat:
  - **Name it now:** the team types a name and, optionally, a short description. That is the cat's profile.
  - **Leave it for spotters:** the cat is saved without a name the team chose, and spotters who spot it can name it as they name cats today. *Builder: check how the app handles a cat with no name yet (`cats.name` and the name-suggestion flow, `routes/cats.ts`) and use the existing path rather than inventing one.*
- **Its place** is the batch's colony centre, else the batch's area centre, else an area the team picks. It's never a position typed as numbers. *My call:* the public map shows it with the same blurring as every cat, so a rough centre is no worse than a spotter's pin.
- **Its colony** is the batch's colony, if one was chosen.
- **Its SYR number** comes from its id, as for every cat.
- It's created in the same transaction as its visit.

*My call:* only the first photo is searched, so a cat costs one search. The other photos come along as extra evidence and are kept.

### 4. Say what was done and what it cost

Each cat has:

- **what was done**: one or more of **Sterilised**, **Vaccinated** and **Treated**. There is no "Checked only" in a batch (Samuel, 24 Oct). "Checked only" stays on the single-visit form; the stored value doesn't change.
  - Vaccinated asks which vaccines, which can be the same for the whole batch;
  - Treated asks what for.
  - These are the existing `VetVisitValue` fields (`did`, `vaccines`, `treatedNote`, `clinicId`, `costEur`, `paidBy`, `note`, `costReason` in `lib/observations.ts`). The visit needs no new fields and no migration.
- **the cost Syros Cats approved and paid**. It starts at the batch's price when Sterilised is ticked and can be changed for this cat. A blank cost saves as "not known" (`costEur: null`), as on the single-visit form. A batch for Vaccinated or Treated only starts blank;
- **who paid**, if it differs from the batch;
- an optional note.

### 5. Save the batch

**Save** writes one vet visit per cat, all in one transaction. It uses the same writer as a single visit (`writeVisit`/`logRound` from #327), so D8 holds: a cat guardian's standing "not sterilised" is marked overruled by the visit, and undoing a visit puts her answer back. New cats are created in the same transaction.

If anything is refused, nothing is saved, and the batch comes back with everything typed and uploaded still there and the problem named beside its field.

### 6. Keep the photos with the visit

Every photo in the batch is kept, tied to its visit (Samuel agreed, 24 Oct). These photos are:

- shown to the team on the cat's page, in its vet visit;
- for a cat already on record, **never shown to the public or to cat guardians**, and never chosen as its display photo or as a reference photo for photo searches (*my call*: the cat already has a public photo, and trap or vet shots stay private). Guardians see that a visit happened and what was done, as they do now (§10.2), without costs or vaccinations;
- for a **new** cat, the exception: its first trapping photo becomes its main, public photo (Samuel, 24 Oct). Its other batch photos stay team-only;
- stripped of EXIF and GPS data, and stored in the same photo store (`photos`), with the same size versions, as other photos. *My call:* they reuse `photos` with a team-only rule, rather than a store of their own. Every reader that picks display photos, reference photos, public galleries, guardian views, exports or fingerprints must leave them out, and a test proves it for each one.

## Constraints the builder must respect

- **Search limits.** Find from a photo allows 20 searches per person a day and 100 for the team (`findPhotoPage.ts`). Samuel (24 Oct): batches get **a bigger limit of their own**.
  - *My call, for Samuel to confirm:* 60 batch searches per person a day and 200 for the team, kept apart from the single-photo page's 20 and 100.
  - "Search somewhere else" is another search. Looking a cat up by name or SYR number isn't a search.
  - If a limit is reached mid-batch, the remaining cats can still be identified by name or SYR number, and nothing already done is lost.
- **The search engine:** the batch reuses `findFromPhoto` and draws its own results inside the batch. It searches from the batch's staged copy of the photo, so nothing is uploaded twice.
- **Who can use it:** the team only. *My call:* a batch needs `log_vet_visit`, `find_cat_from_photo` and `view_vet_costs`, because recording what Syros Cats paid is its purpose. Vaccinations also need `set_vaccination`, as on the single-visit form. Anyone missing one of these gets the 403 (today every team member holds all four). A cat guardian gets 403 on every batch route.
- **Batch size:** at most 40 cats (`ROUND_MAX`, as in #327).
- **Unfinished batches:** an unfinished batch and its uploaded photos are held on the server, so a reload or a lapsed sign-in loses nothing and no photo is uploaded twice.
  - *My call:* the batch is kept for 7 days from its last change, then removed with its staged photos by a cleanup job.
  - Staged photos are team-only and attached to nothing until the batch is saved.
  - The held-typing store (SYC-516) holds text only, so the batch needs a store of its own. That means a migration.
- **No script required:** the dashboard is server-drawn with no scripts. The batch must work that way too. Uploading several photos at once uses a plain file input with `multiple`.
- **Words:** "cat guardian", never "colony carer"; "spotter"; plain English; no text below 12px. Team pages are English only (Decision 12).
- **Process:** each PR is a draft until reviewed. Run the full api-server suite before `gh pr ready`. Screenshots at 390px and 1280px.

## What happens to existing work

- **PR #326 (the planner):** unchanged. Its "Log this round's vet visits" link is in #327, not #326, so nothing on the planner points to the old form.
- **PR #327 (the old round form):** closed when this design is approved. Its `logRound` (one transaction, ascending locks, the shared writer) and its tests carry over into the new build. Its tick-off-a-list form doesn't.
- **SYC-473** (add a new cat from the round form, 16 Nov) is absorbed by step 3. Close it as a duplicate of SYC-677 on approval.
- **The single-visit form** on a cat's page stays as it is, for a cat the team already knows.

## Calls made in this document (for Samuel to check)

- A batch's "place" is a named area, not a tapped map point.
- Only a cat's first photo is searched.
- A cat that already has a visit on the same date is saved only if the team ticks "Record this visit as well".
- Batch photos of known cats are team-only and never used as display or reference photos.
- Batch photos are stored in `photos`, with a team-only rule.
- The batch search limits are 60 per person a day and 200 for the team.
- A batch needs `log_vet_visit`, `find_cat_from_photo` and `view_vet_costs`.
- An unfinished batch is kept for 7 days.
- A new cat's place is shown with the same blurring as every cat.

## Left to the builder

- Where **Record vet visits** sits in the menu or on Home.
- The screens: one page with sections, or a short sequence of pages.
- How an unfinished batch is held between requests.
- How the kept photos are stored and linked to the visit (a new photo source or link table), within the rules above.
- The split into PRs. A likely order: storing the photos and the batch writer; then the batch form with the matching step; then new cats.
