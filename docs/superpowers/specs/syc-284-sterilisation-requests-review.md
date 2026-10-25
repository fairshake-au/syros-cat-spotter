# SYC-284 spec review record (24 Oct 2026)

Two independent reviews of the first draft of `2026-10-24-guardian-sterilisation-requests-design.md`, both on Sonnet: a builder check (what a builder would have to guess) and an adversarial review against the approved specs and the code. Every finding is folded into the spec or recorded as a decision for Samuel.

| # | Finding | Where it went |
|---|---|---|
| 1 | "Needs an OK" is approved as one kind of item only (roles §7.1, §10.3), and §7.3 says nothing a guardian says about a cat is queued | New section "Changes this makes to approved specs" |
| 2 | Nobody owned a batch made from a guardian's sending (`vet_batches.created_by` is a person; guardians get 403 on batch routes), and `teamOnlyPhotoIds` would hide her own photos from her | Sendings are held by the request; **Record these** makes a batch owned by that team member; a separate route lets a guardian see her own photos; `teamOnlyPhotoIds` is not loosened |
| 3 | Budget maths undefined: approved vs paid double count, month boundary, null costs | Step 3 now defines what a request uses: the month it was approved in; while open, the larger of the approved total and what has been saved; once closed, what was saved; a null cost counts as the most-per-cat |
| 4 | Two approvals at once could overspend the budget; "one request per cat" was only a page check | A lock per month inside the approving transaction; a database unique rule on the cat across open requests |
| 5 | The guardian's "what the vet charged" became the saved cost; "Approve the extra" was a clickable tick | Her figure is a hint only; the extra needs a typed reason, and only management can approve it beyond the budget |
| 6 | Paying twice: "Record this visit as well" let a sterilised cat be paid again; the guardian was told the other guardian's name | Already sterilised by a vet visit is refused under a request; she sees only "Already in an open request" |
| 7 | The 7-day clean-up would delete a guardian's evidence | Request batches are exempt; an abandoned one goes back to the sending; a quiet "Waiting 14 days" |
| 8 | Role ending, a cat leaving or dying, sterilised another way: not covered | Step 6, "If things change mid-way" |
| 9 | Several sendings could exceed the approval; expiry with photos waiting | Approved number plus 2 across all sendings; a sending made before expiry is honoured |
| 10 | A new cat's public photo picked from an unvetted upload | The team chooses the main photo and sees it before saving |
| 11 | Capabilities: the over-budget power was mixed with setting the budget; a one-person management team; wrong section cited | Four capabilities with kinds; `approve_over_budget` split out; the one-person case stated; §10.3 cited |
| 12 | "fill the form and send it once she has signal" implied offline support | Rewritten: these pages need a connection, and typing is lost without one |
| 13 | A decline reason read as an accusation | "Syros Cats are already planning to trap this colony" |
| 14 | No rule for when a request is Done | Step 6 defines Done and Ended |
| 15 | A guardian's "Vaccinated" can't write vaccinations | It is a hint the team confirms when recording |
| 16 | Builder: does "Needs an OK" exist yet? | It is built here as the first kind; site-public requests (SYC-686) join it |
| 17 | Builder: English first, or wait for Johnny? | English may go first; each language goes live after his sign-off |
| 18 | Builder: is the email in? | Decision A for Samuel |
| 19 | One "built versus proposed" sentence | Rewritten as one vision |

## Round 2 (25 Oct 2026): after the rewrite for anyone asking

Samuel corrected the premise on 25 Oct: anyone can ask (residents, members of the public, guardians), with a photo of the cat and where it lives; the person who asked takes the cat to the vet; Syros Cats pays the clinic or pays the person back. The spec was rewritten, then reviewed again (builder check and adversarial review, both on Sonnet).

| # | Finding | Where it went |
|---|---|---|
| 1 | A pay-back could follow a swapped or long-sterilised cat: a photo can't tell a fresh clip from an old one | Money follows a clinic's bill: pay the clinic by default; pay-backs need a listed clinic, a matching date and a bill number never paid before; a different cat needs management; 2 pay-backs a month per contact without management |
| 2 | "One open request per cat" can't be checked when a stranger sends a photo; the duplicate message leaked that someone asked; a request from a cat page needed no photo | Checked on the cat the team picks; duplicates are joined and the second asker is thanked; a photo is always needed |
| 3 | Public emails can't carry free text (`lib/mail/send.ts`) | Emails are fixed templates; team messages are in the app and on dashboard pages only |
| 4 | Keeping the request after "Delete my data" contradicted the privacy policy; no retention | Contact details kept 3 months after closing; delete removes contact, notes, bill photo, exact place, unused photos; what stays is listed; `DELETE /api/me` extended |
| 5 | App identity is weak; a lost phone strands a request; per-phone caps don't protect | Caps called courtesy limits; protections named; quote SR-214 and the team records it; restore with a code brings requests back |
| 6 | 3 open requests is too few for a guardian trapping a colony | 5 per app; 20 for guardians and the team |
| 7 | Approval-month budget lets cash out run above a month | Stated plainly as a limit on decisions, with the cash option set out in Decision D |
| 8 | `saveBatch`, `vetBatches.ts` and the clean-up change, unlisted | Listed under constraints, with tests |
| 9 | "Who Syros Cats paid" on the visit observation clashes with its closed `paidBy` set and with deletion | Payments are a row on the request; the visit keeps `paidBy` |
| 10 | A batch needs a named area, not a point | The named area containing the place, changeable by the team |
| 11 | Request photos vs `teamOnlyPhotoIds` | Request photos in `photos` with a link that joins the team-only rule; bill photos in a private table of their own |
| 12 | Offline queue with several photos and expiring Turnstile tokens | Request first, photos one at a time, a fresh Turnstile check per send, as a queued report does |
| 13 | "Syros Cats will answer by email" is untrue before the address is confirmed; phone numbers had no consent wording | New confirmation text; a consent line for phone numbers; privacy policy amendment |
| 14 | "The person who asked never decides" can't be checked for a public request | Enforced for signed-in requests; team members ask from the dashboard |
| 15 | No paid state; no extension; vet finds the cat already done; withdrawing after approval | To pay / Paid; extend; "already sterilised" close with a check-up fee; withdraw at any stage before sending back |
| 16 | Needs an OK doesn't exist yet | This design builds it; site-public requests join later, each kind gated by its own capability |
| 17 | What "the website" is | The app's browser version; catspotters.com (another repository) links to it |
| 18 | Which clinic list | `lib/welfare-guidance/src/data/vets.json` |
| 19 | Languages before Johnny's sign-off | Emails go in English until a language is signed off, as the report's do |
| 20 | Wording: "A spotter" for any asker; a decline reason revealing trapping plans | "Someone"; "Syros Cats will arrange this one themselves" |
