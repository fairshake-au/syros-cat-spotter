# SYC-362: dashboard design review, part 2 — plan

**Linear:** SYC-362 (this plan). Parent: SYC-219 / PR #184 (part 1, layout). Related: SYC-245 and SYC-255 (the map-link rules this reverses), SYC-209 (feeding sites; its PR 4.1 opens the Colonies and Feeding sites pages to cat guardians and moves their words into the three-language catalogue), SYC-251 / SYC-291 (Greek and French), `docs/specs/claiming-a-cat.md` §7 (removing an owner).
**Status:** v2. Samuel approved all five decisions as recommended on 15 Oct 2026 (D1 A, D2 A, D3 as written, D4 A, D5 A). Revised after an adversarial review and a check by the SYC-209 session. Steps 1–3 start once PR #184 merges; steps 4–5 wait for SYC-209 PR 4.1.
**Written:** 15 October 2026.

## What this is

Part 1 (PR #184) made the staff dashboard fit phones and desktops and fixed the small design-review findings. Part 2 is the five changes that alter how things *behave*, which is why they get a plan first:

1. An **"Are you sure?" page** before retiring a feeding site and before removing a cat's owner.
2. **No more pre-ticked "Also remove the owner"** when changing where a cat lives.
3. **Plainer words on the team's cat page.**
4. **The Feeding sites page works on a phone**: the list of sites comes before most of the map buttons, the key sits right under the map, and the pins stop being the same red as "Urgent".
5. **"Open map" links on positions**, for island-wide team members only.

All are server-drawn pages with no scripts (the dashboard's security header allows none). No database change, no migration.

## Decisions for Samuel

Each has a recommendation. The steps below assume the recommendation.

### D1. How "Are you sure?" works

There are no scripts, so it can't be a pop-up. It has to be a second page.

| Option | What staff see | Benefits | Risks |
|---|---|---|---|
| **A. A confirm page after the form (recommended)** | They fill in the form as now and press "Retire this site". A page says what will happen ("Vaporia bins leaves the map. You can bring it back later from its page.") with **Yes, retire it** and **Cancel**. | One extra tap, only on risky actions. What they typed is carried on the confirm page, so nothing is retyped. | None found. Pressing Yes twice, going back, or refreshing is already safe: the second try finds the site already retired, or the owner already gone, and writes nothing. |
| B. An "I understand" tick box on the form | The button only works once the box is ticked. | No extra page. | Easy to tick without reading. That's exactly how the owner box went wrong. |

**Recommendation: A.**

Honest note: the confirm page protects people from slips. It is not a security control. A program talking to the dashboard's JSON interface can still retire a site in one step, as today; only tests use that interface.

### D2. What replaces the pre-ticked "Also remove the owner" box

Today, setting an owned cat to anything but "Has a home" removes its owner unless the person notices and unticks a small box. Only the island-wide team can remove owners. **Cat guardians can also change where a cat lives**, but never see the box: for them, the change saves and the owner stays.

| Option | What staff see | Benefits | Risks |
|---|---|---|---|
| **A. No box. Team members get the confirm page; cat guardians save as today, with a note (recommended)** | A **team member** picks "Lives on the street" for Mimi and presses Save. Because Mimi has an owner, a page says: "Mimi has an owner. Saving this also removes the owner. The owner stops seeing the exact spot and getting alerts. The owner is not told." **Yes, save and remove the owner** / **Cancel**. To keep the owner, they go back and choose "Has a home". A **cat guardian** saves as today, and the page then says: "Saved. Mimi still has an owner. Ask the team if the owner should be removed." | Nobody removes an owner by accident; it's always said out loud on its own page. Guardians lose nothing. | One extra page for team members, and only for owned cats (rare). |
| B. Keep the box, unticked; refuse the save when it's unticked | An error page asking them to tick it or choose "Has a home". | Small change. | An error after pressing Save is a telling-off and a round trip. It would also need special handling for guardians. |
| C. Keep the box, unticked, and allow "street with an owner" | Saves as asked; the owner stays. | Simplest. | The claiming spec accepted this state as a risk, but a street cat whose owner still gets alerts and sees the exact spot is what the box exists to prevent. |

**Recommendation: A.** The check for "does this cat have an owner?" happens inside the same database transaction as the save, so an owner who claims the cat in the same second can't slip through.

### D3. The new words on the cat page

Team page only. It stays English for now; Greek and French come with SYC-251.

| Today | Proposed |
|---|---|
| What the records say | What we know about this cat |
| Team only. How the answer above was worked out. | Team only. How we got to what the public sees. |
| Records say | Status |
| As of | Since |
| Based on | Why we think so |
| Disagrees | Says otherwise |
| Correct the record | Update this cat |
| The two-paragraph intro | "Every change is saved with your name. Nothing is deleted. A change with an older date won't override a newer one. To undo a change, use **Mark wrong** on it in the history below." |
| Say the life status | Update where the cat lives |
| Say whether sterilised | Update whether sterilised |
| Date the team knows of (all three forms, and the error messages that mention it) | Date it happened (leave blank for today) |
| How the team knows | How we know |
| What has been said (N) | History (N) |
| Newest first. Nothing is ever deleted: a statement that was corrected stays, struck through, with what replaced it. | Newest first. A change marked wrong stays here, crossed out, with what replaced it. |
| "statement" wherever staff read it (e.g. "the statement it replaces", "Replaced by", "Corrects") | "change" |
| "…use Remove owner under 'Correct the record'" | "…use Remove owner under 'Update this cat'" |

The "older date doesn't override a newer one" rule stays visible as one sentence in the intro.

**Recommendation: approve as written.** Samuel can change any line.

### D4. The Feeding sites page on a phone

The map must stay pixel-exact (SYC-209: everything above the map has a whole-pixel height, or taps land in the wrong place). So the map stays where it is, and only what comes *after* it moves.

Today on a phone: map → map credit → zoom, compass and "Go to" buttons (about 900px) → key → Add a site → All sites list.

| Option | New order on a phone | Benefits | Risks |
|---|---|---|---|
| **A. Map, key, zoom, list, then the rest (recommended)** | map → credit → **key** → Zoom in/out → **All sites** → compass buttons and "Go to" → Add a site | The list is one screen down instead of three. Zoom stays by the map. Nothing above the map changes. | Panning and "Go to" are further down. They're the least-used controls. |
| B. List first, then map | list → map → … | The list is at the top. | Everything above the map would change height with the number of sites, which puts the tap accuracy at risk. Not recommended. |

Desktop keeps today's order.

Pins: today every pin is red (#b3261e), the same as "Urgent". New colours:
- **public**: filled dark teal (#0b5c6b) with a white ring;
- **private**: a dark teal ring with a see-through middle;
- **retired**: a dashed grey ring (#6b685f).

Contrast on the map's background is 6.0:1 for teal and 4.4:1 for grey; the white halo the pins already have keeps them clear over busy map pictures. The key's words change to match. The red ring for "the spot you just tapped" stays red, because it's a different thing.

**Recommendation: A.**

### D5. Should an owner's home pin get an "Open map" link? (new)

You decided Open map links are fine for the team, feeding sites included. One position on the cat page is different: the **owner's home pin**, where a member of the public says their cat lives.

| Option | Benefits | Risks |
|---|---|---|
| **A. No link on the home pin (recommended)** | A private person's home is never sent to Google. Everything else gets its link. | One position on the page without a link. |
| B. Link it too | Consistent. | Tapping it tells Google where a member of the public lives. Your reason ("the privacy considerations don't apply to Syros Cats users") was about the team and feeding sites, not owners. |

**Recommendation: A.**

## Open map links: what's decided and what it changes

Samuel decided on 15 October 2026: "map links for coordinates are fine for the team. the privacy considerations don't apply to Syros Cats users". Asked about feeding sites, he chose **"Everywhere, sites included"**.

**What it reverses**, named plainly (the SYC-209 session flagged this so Samuel can confirm with eyes open):
- SYC-245 / SYC-209 Decision 2 option B: "no exact position leaves the dashboard for a map company". PR 0.2 removed exactly these links from the cat page.
- SYC-209 plan rule **K13**: "no position in any `href`, `action`, `src` or redirect". This plan breaks K13 **only** for Open map links to the map company. Our own map pages keep K13 in full: they are still reached by POST forms carrying only a record's id, like PR 3.4's "Show on our map".
- In practice: when a team member taps Open map, Google learns that spot. For a private feeding site, that's a place Syros Cats chose not to publish.

**Who gets the links: island-wide team members only.** After SYC-209 PR 4.1, the Feeding sites, site, Colonies and colony pages are shared with cat guardians (filtered to their own colonies), and guardians already see cat pages. So the links depend on **who is looking**, not on which page it is. They show only when `visibleColonyIds(person) === null` (PR 4.1), the same as having `view_exact_location` with no target. Everyone else sees the position as today, with no link.

**Where the links go:** every position an island-wide viewer sees. That means:
- a cat's "First recorded" and each sighting;
- a colony's centre, and colony-centre lines in a colony's history;
- a feeding site's position, and the "added here" / "moved from … to …" lines in its history;
- the welfare queue;
- the place-a-site pages (the spot just tapped, and a move's "now" and "new" positions).

Not the owner's home pin (D5).

**Rounding:** positions are printed to 5 decimal places (about 1 m) instead of raw computer numbers like "37.446999999999996". The cat page's `place()` deliberately printed exact numbers ("never rounded"); this reverses that. Five places is finer than any phone's GPS, so nothing a person could use is lost.

**One builder.** A new `lib/teamPages/position.ts` is the only place that prints a position or builds a map link. The welfare alert email's `mapLinks` (`lib/welfare/alertEmail.ts`) is moved onto it too, so there's one Google address builder, not two.

**The queue's near-site rule goes:** the queue's "Near a feeding site: see the dashboard map" line, `queueNearFeedingSites` (`lib/welfareQueue.ts`) and the `NearSites` plumbing in `queuePage.ts` and `routes/team.ts` are removed, with their tests (`team.queuePage.test.ts` near-site cases). **Kept:** `lib/feedingSiteProximity.ts`, because the alert email still uses it. The email still leaves out links near a site. That difference is deliberate: Samuel's decision was about the team's pages, and the email goes to an inbox, not the dashboard. Filed as a follow-up question, not changed here.

**Tests that guard it:**
- `noMapLinks.source.test.ts` is replaced by a source test: outside `position.ts`, no team page may print a position itself (it bans `toFixed(`, `` `${…lat}, ${…lng}` `` and `fmtPos(` outside an allow-list), so nothing can bypass the link rules.
- **Guardian view:** each shared page (cat, Feeding sites, site, Colonies, colony), rendered as a cat guardian, contains no map-company address. This sits alongside PR 4.1's own guardian scan and never replaces it.
- The home pin never carries a link (D5).

**Docs updated, quoting the decision:**
- `docs/specs/feeding-sites-and-colonies.md`: §2.3 "Precondition: SYC-245" (line ~76), "No site page links out to another company's map" (~140), Decision 2 (~620 and ~900), and finding 13.5 (~883).
- `docs/specs/claiming-a-cat.md` §7: the "offers Remove owner in the same step" bullet and D6, rewritten to describe D2.
- `threat_model.md`: a new entry (it has none on maps today). Map pictures are fetched by our server. Open map links go to Google for island-wide team members only, never guardians, never the owner's home pin, never the public.

## Steps

One commit per step, tests first where behaviour changes. Steps 1–3 touch only the cat page and shared helpers. Steps 4–5 touch the site and colony pages, so they wait for SYC-209 PR 4.1 to merge (see Coordination).

**Step 1. Shared pieces.**
- (a) `lib/teamPages/confirm.ts`: one "Are you sure?" page. It takes:
  - a title, plain sentences saying what will happen, the form action and the Yes button's words;
  - the hidden fields to carry, every one escaped;
  - a Cancel link;
  - which words to use: plain English for the cat page, or catalogue keys for the shared site pages, under a new `sure.*` prefix, since `confirm.*` is taken.

  It adds `confirm=1`.
- (b) `lib/teamPages/position.ts`: `position(lat, lng, { link })`. It rounds, escapes, and adds " · Open map" only when `link` is true. The alert email's link builder moves here.
- Tests:
  - every carried field round-trips escaped, including a reason containing `"><script>`;
  - the Yes form posts to the same action with `confirm=1`, and Cancel goes back;
  - `position` rounds, escapes, and links only when asked.

**Step 2. Remove owner asks first (D1, cat page).**
- `POST /team/cats/:id/remove-owner` as a **form** post without `confirm=1`: once the form passes its checks, it answers 200 with the confirm page, carrying `status`, `reason` and `date`. With `confirm=1` it acts as today. The existing owner re-check under a row lock (`require_owner` → "ownerGone") already makes a second Yes, the back button or a refresh harmless.
- JSON posts are unchanged.
- Tests:
  - no confirm: nothing written, confirm page shown;
  - confirm: written once;
  - a second confirm: "ownerGone", nothing written;
  - a `confirm=1` post with the dashboard Origin passes, and without it is refused (SYC-330);
  - JSON unchanged;
  - a missing capability is refused on both posts.

**Step 3. The owner box goes (D2), and the cat page's words (D3).**
- (a) Remove the checkbox. Give `removeOwnerAndSay` a mode, `confirm_if_owner`: under the row lock, if the cat has an owner (or an orphaned home), the new status isn't "Has a home", and there's no `confirm=1`, it writes nothing and returns `needs_confirm`. The route then shows D2's confirm page. With `confirm=1`, it removes whichever owner exists at that moment.
- People **without** `remove_owner` (cat guardians) save as today, keeping the owner, and see D2's note.
- The JSON path keeps accepting `removeOwner=1` as today.
- (b) D3's wording: `catPages.ts`, its `DONE` notices, the "Mark wrong" and Remove-owner forms, and the date messages in `routes/teamCorrections.ts` (`FIELD_WORDS`, "give the date the team knows of").
- Tests:
  - the owner cases, including **a guardian-role cookie**: saves and keeps the owner;
  - no `checked` box anywhere on the page;
  - a grep-style test that the old words ("Records say", "statement", "true on", "Correct the record", "What has been said", "Also remove the owner", "Date the team knows of") don't appear on the cat page;
  - update the tests that assert the old words or the old box: `team.removeOwner.test.ts` (~460–505, rewritten), `catPages.history.test.ts` and any other matches.

**Step 4 (after PR 4.1). Retire asks first, and Feeding sites on a phone (D1, D4).**
- Retire: the same confirm flow as step 2. The route reads the site (for its name; 404 if missing) and carries `updatedAt` and `reason`. Its words go into the three-language catalogue (`sure.*` keys in en/el/fr; `strings.test.ts` enforces all three).
  - A second Yes hits the existing "already retired" check. Because that's usually the same person tapping twice, the message softens to "This site is already retired."
- Phone order: split `controls()` in `map.ts` into two forms, zoom and compass/"Go to". Both carry the same hidden view fields, so this is safe. Under the map, the order is credit → key → zoom form → list → compass/"Go to" form → Add a site.
  - Do this in the HTML order on every width if the desktop screenshot reads fine. Otherwise, use a flex wrapper with CSS `order` on narrow screens.
  - The wrapper starts after `.map` and `.attrib`, so nothing above the map moves.
- Pins: the CSS for `.pin`, `.site-public`, `.site-private` and `.site-retired` together, plus the key's words.
- Checks:
  - the SYC-209 browser check (`docs/screenshots/syc-209-pr-3-1/layout-and-tap-check.mjs`) at 320, 360, 375, 390 and 1280px in Chromium, WebKit and Firefox. The pass count must not drop below today's 106/110.
  - screenshots at 390 and 1280px.

**Step 5 (after PR 4.1). Open map links.**
- Replace every position print with `position(…)`, passing `link: visibleColonyIds(person) === null`, and `false` for the home pin.
- Remove the queue's near-site rule (see above).
- Swap the source test, add the guardian-view tests, and update the docs.

**Step 6. Browser check and review.**
- A local build with seeded data. The part-1 seed script is in the session scratchpad: check it still runs against the new schema, then copy it to `docs/screenshots/syc-362/` so it outlives this session.
- 390 and 1280px screenshots of:
  - retire → confirm → done;
  - an owned cat's status change → confirm → done, as a team member and as a guardian;
  - the cat page, the Feeding sites page and the queue.
- An independent adversarial review, then fold in its findings.

## Coordination

- **SYC-209 PR 4.1** (another session, being built now) opens the Colonies and Feeding sites pages to cat guardians, adds `visibleColonyIds`, and moves those pages' words into the catalogue. Steps 4–5 depend on it and start after it merges. Message that session before starting step 4.
- **PR #184** (part 1) and **PR #180** (SYC-209 PR 3.4) touch the same files. This branch starts from main after #184 lands.

## Not in this plan (filed or to be filed)

- **The welfare alert email's near-site rule**: should the email get Open map links near feeding sites too? Filed as SYC-385.
- **The cat page on phones** (summary first, forms lower): SYC-363.
- **Greek and French for the cat page's new words**: SYC-251 / SYC-291.
- **"An older date was saved, so the status didn't change" notice**: cut as scope creep, because it would need the cat's status worked out before and after each save. The intro sentence covers the rule instead. Filed as SYC-386.

## Model delegation

Session model: Opus.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Step 1: confirm page and position helper | Sonnet | small, fully specified | the step's tests (written first), typecheck, and a diff spot-review by the session model |
| Step 2: Remove owner confirm | Opus (session) | refusal paths and a race between two taps; acting twice, or acting without asking, would fail silently | tests, plus a **mutation probe**: delete the `confirm` check and confirm a named test goes red, then restore |
| Step 3a: owner-box replacement, inside the transaction | Opus (session) | changes a rule from the claiming spec; the guardian path and the race need judgement | tests, including the guardian cookie, plus a **mutation probe**: make `confirm_if_owner` ignore the owner, and the "confirm page shown" test must fail |
| Step 3b: wording | Sonnet | wide but mechanical against D3's table | the old-words-absent test (it can fail: probe by putting one old phrase back), plus a screenshot spot-check |
| Step 4: retire confirm, phone order, pins | Sonnet, with the retire route's confirm reviewed by the session model | CSS and catalogue keys are mechanical; the route mirrors step 2 | the three-engine tap check (pass count must not drop), `strings.test.ts`, a retire mutation probe as in step 2, and 390/1280 screenshots reviewed by the session model |
| Step 5: Open map links | Sonnet | mechanical once the helper exists | the source test (probe: print one position with `toFixed` directly and it must fail); the guardian-view test (probe: force `link: true` on one shared page and it must fail); a spot-review of the doc wording by the session model |
| Step 6: seed and screenshots | Sonnet | mechanical | the screenshots, checked by the session model |
| Adversarial review of the PR | Opus | behaviour changes with races and a permission split; part 1's Sonnet critics were strong on CSS, this needs more | its findings, verified before folding in |

Every delegated agent commits after each item and keeps a checkpoint note in the worktree.

**Where else must each rule hold?** (consumers)
- *"Retire and Remove owner never act on a form post without a confirm"*:
  - the retire route (`teamSites.ts`), the remove-owner route and the life-status route's owner branch (`teamCorrections.ts`);
  - every caller of `removeOwnerAndSay` (grep in review).
- *"No owner is removed without it being said"*: the `removeOwnerAndSay` callers: life-status, remove-owner, and the JSON API, which stays explicit by design.
- *"A cat guardian never sees a map-company link"*:
  - the cat page and every page shared after PR 4.1 (Feeding sites, site, Colonies, colony), plus any page later opened to guardians;
  - enforced by the guardian-view tests (PR 4.1's scan and this plan's).
- *"Every position an island-wide viewer sees has its link, and only through `position()`"*:
  - `catPages.ts` `place()` and the sightings;
  - `colonyPages.ts` `centreText` (history) and the colony centre;
  - `sitePages.ts` `fmtPos` and `where()` (history), and the site position;
  - `siteFormPages.ts` `fmtPos` (the tapped spot, and a move's now/new positions);
  - `queuePage.ts` `place()`;
  - the alert email's `mapLinks`.
