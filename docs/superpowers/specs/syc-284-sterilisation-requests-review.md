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
