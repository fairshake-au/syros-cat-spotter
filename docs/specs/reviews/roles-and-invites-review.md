# Adversarial review: Roles and invites

**Target:** [docs/specs/roles-and-invites.md](../roles-and-invites.md), draft of 7 October 2026 (branch `claude/syc-53-roles-spec`, PR #102, commit `216c0ae`)
**Reviewer:** independent adversarial pass, 7 October 2026
**Evidence used:** the code on `origin/main` at `c5ee36c` (SYC-43 PR 4): `artifacts/api-server/src/lib/capabilities.ts`, `middlewares/requireTeam.ts`, `routes/team.ts`, `routes/teamCats.ts`, `routes/teamReports.ts`, `routes/observations.ts`, `routes/internal.ts`, `lib/teamCorrections.ts`, `lib/resolve.ts`, `lib/observations.ts`, `lib/teamCatView.ts`, `lib/db/src/people.ts`, `lib/db/src/schema/people.ts`; `team-access-and-welfare-queue.md`; `cat-record-data-spine.md`; `DECISIONS.md`; `docs/superpowers/plans/syc-43-part-1-people-and-staff-sign-in.md`; the parallel SYC-209 spec `feeding-sites-and-colonies.md` on `origin/claude/syc-209-feeding-sites-spec`; Linear SYC-53, SYC-54, SYC-104, SYC-208, SYC-209, SYC-213, SYC-222.

**CONFIRMED** = checked against code or an approved document. **PLAUSIBLE** = judgement, not checked against an artefact.

Findings run from most severe to least. Each one names the spec section, a way it fails, and a fix.

---

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| B1 | A volunteer placed on "all colonies" gets into the welfare queue, reporters' photos and every cat; the strict `can()` doesn't stop it | **Blocker** | CONFIRMED |
| B2 | Approving a field check makes a cat *Confirmed sterilised*, which the approved data spine forbids, and it sends emails that can't be unsent | **Blocker** | CONFIRMED |
| B3 | The "second pair of eyes" for staff and management can be got round three ways | **Blocker** | CONFIRMED |
| M1 | The wrong-mailbox safeguard doesn't work as written, and the invitation leaks a guardian's name and place | Major | CONFIRMED |
| M2 | Nobody has said what a guardian sees on her own cat's page; reusing the team's page leaks a lot | Major | CONFIRMED |
| M3 | "Where each cat is usually seen" doesn't exist, and building it would show volunteers where tourists walked | Major | CONFIRMED |
| M4 | The offline list hides itself after 7 days rather than being deleted, and four details make it weaker than the spec says | Major | CONFIRMED / PLAUSIBLE |
| M5 | Any volunteer can take cats out of a colony with nobody's OK, and a proposal can quietly move a cat out of another guardian's colony | Major | CONFIRMED |
| M6 | It contradicts the approved data spine, the ownership table in `DECISIONS.md`, the team-access spec and the parallel SYC-209 spec | Major | CONFIRMED |
| M7 | A guardian's field check moves the public answer before anyone OKs it, and nothing says where its photo is kept | Major | CONFIRMED |
| M8 | When someone leaves, the invitations they sent still work, and one manager alone can remove all the others | Major | CONFIRMED |
| M9 | Invitations that are pending, withdrawn or expired are described three different ways, and the default fails open | Major | CONFIRMED |
| M10 | The migration as described would fail on rows that already exist | Major | CONFIRMED |
| m1 | A guardian's life-status powers: she can't undo her own mistake, and she can quietly take cats off the trapping list | Minor | CONFIRMED |
| m2 | "Pick a cat from anywhere" has nowhere for a guardian to do it | Minor | CONFIRMED |
| m3 | Rules that can't be tested or have nothing behind them | Minor | CONFIRMED |
| m4 | Two uniqueness rules that don't fit what the text asks of them | Minor | CONFIRMED |
| m5 | Mail details | Minor | CONFIRMED |
| m6 | The last-manager guard has a race | Minor | PLAUSIBLE |
| m7 | Canonical facts and house rules | Minor | CONFIRMED |
| — | What is sound | — | — |
| — | The 11 decision recommendations, judged | — | — |

---

## B1. A volunteer on "all colonies" passes every island-wide page, including the welfare queue — Blocker — CONFIRMED

**Where:** §6.4 (Decision 4), §6.5 (Decision 8), §10.1 (`reach`), §16.3 S4.

**What is wrong.** Decision 4's strict `can()` is right, but it only answers "do you hold this capability for the whole island?" when no colony is named. §6.5 lets management place a volunteer on "all colonies". In §10.1's data model the only way to write that is a volunteer row with `reach = 'island'`: the check only forces `colony` for guardians and `island` for staff and management, so the volunteer can be either. A volunteer with `reach = 'island'` holds `view_exact_location` for the whole island, and the strict `can()` answers **yes**.

Every page that shows the welfare queue is guarded by exactly that capability today:

- `GET /api/team` (the welfare queue page), `routes/team.ts:105`
- `GET /api/team/reports` (the queue as JSON), `routes/teamReports.ts`
- `GET /api/team/report-photos/:publicId`, which the code calls "the only route that serves" a reporter's photograph, `routes/teamReports.ts`
- `GET /api/team/photos/:publicId`, which serves catalogue photos, hidden ones included
- `GET /api/team/cats` and `GET /api/team/cats/:id`, `routes/teamCats.ts:25,42`

The spec's own list (S4, §6.4) names only `team.ts` and `teamCats.ts`, so it misses the report and photo routes. Even once those are added, strict `can()` doesn't close the gap for an island volunteer.

**How it fails.** A volunteer who signed up last week helps with rounds everywhere, so management places her on "all colonies" (with no second OK, see B3). She opens `team.catspotters.com/api/team` and sees every welfare report: the reporter's photo, the exact location of the hurt cat, and whether the reporter left a way to be contacted. §2.3 says a volunteer "cannot see the welfare queue". The route walk in §15.3 test 1 wouldn't catch it unless "island volunteer" is one of the people it tries, and the list in §15.3 doesn't include one.

**Fix.** Three things, all needed:

1. **Give the welfare queue its own capability**, island-only and held by staff and management only (`view_welfare_queue`, or gate the reading routes on `change_report_state`). Exact positions are not what makes that queue sensitive; reporters are. The two report-photo routes go behind it too.
2. **Volunteers never get island reach.** "All colonies" becomes management ticking every current colony, written as one row per colony. A colony added later is not included automatically, which is the safe way round. The `reach` check becomes: `guardian` and `volunteer` require `colony`; `staff` and `management` require `island`.
3. **Add "island volunteer" (or, after fix 2, "volunteer on every colony") to the people the route walk tries**, and add `teamReports.ts` and both photo routes to S4. `GET /api/team/photos/:publicId` also needs a target: look up the photo's cat, then the cat's colony. Without one, a guardian's own colony page can't show its photos under strict `can()`.

---

## B2. Approving a field check makes a cat *Confirmed sterilised*, which the data spine forbids — Blocker — CONFIRMED

**Where:** §7.2 (Decision 5), §7.3 step 4, §10.4, §16.5.

**What is wrong.** In §7.3 step 4, the team member's **Yes, she's sterilised** writes a team `sterilised: true` observation. `lib/resolve.ts` treats any `staff` `sterilised` assertion as authoritative, so the cat shows publicly as *"Sterilised — confirmed by Syros Cats"*. What the team member actually has in front of them is a guardian's or volunteer's word about an ear, and maybe a photo of it. Two approved rules say that isn't enough:

- `cat-record-data-spine.md` §4.2: **"Confidence never crosses attributes. A *Confirmed* ear tip is a confirmed statement about an ear, not about an operation. It contributes to sterilised reaching *Likely* and can never make it *Confirmed*."**
- `DECISIONS.md` Part 2k (5 October 2026): "Looks right" on the *Probably sterilised* list records a team `ear_tip { clipped: true }`, and **"the cat stays *Likely* (a photo is never proof, §4.1)"**.

So the same evidence gets two different results depending on which list the team member opened it from. On the *Probably sterilised* list, a tourist's photo plus the team's "looks right" leaves the cat at *Likely*. In "Needs an OK", a volunteer's photo plus the team's "Yes" makes it *Confirmed*. A field check with **no photo** can still be approved, which turns one volunteer's say-so into the charity's confirmed record.

**How it fails, and what it costs.** A volunteer looks at a torn ear in bad light and says "clipped". A busy team member taps Yes. The cat is now *Confirmed sterilised* and drops off every trapping list. §4.1 names the result: a litter. And the F4 nightly job sends *"Agatha, the cat you named in June, was sterilised last week"* to every spotter who signed up for news about her (`email-capture.md` §5). An email can't be unsent, and §7.3 never mentions that approval sets it off.

**Fix.** Put it to Samuel as a decision that **names the amendment** to §4.2 and Part 2k. Don't let it slip through as a queue detail. My recommendation:

- **Yes** writes the team's `ear_tip { clipped: true }` with the in-person marker (the Part 2k shape). The resolver leaves the cat at *Likely*, and the team's screens show *"Probably sterilised — checked in person by a guardian, agreed by Syros Cats"*.
- *Confirmed* still comes only from the team's own records or a vet: the clinic receipt, the trapping log, the WhatsApp record. That stays a separate **Record a sterilisation** action that asks "from what record?".
- If Samuel does want "Yes" to confirm, then: require a photo; have the approver tick "I can see a clip in this photo"; record which field check it relied on; and write the §4.2 amendment into `DECISIONS.md` first. Either way, §7.3 has to say whether approval sets off the "sterilised" news email.

---

## B3. The second pair of eyes for staff and management can be got round — Blocker — CONFIRMED

**Where:** §8.1, §8.3 (Decision 11), §6.2 (`settle_confirmation`), §10.3 (`kind`), §9.4.

**What is wrong.** Decision 11 says inviting staff or management needs "a second **management** member". The data model doesn't make it so, in three places:

1. **Staff can approve it.** The invitation request is a `confirmation_items` row of kind `invitation`, settled through `settle_confirmation`. §6.2 gives that capability to **staff** as well as management, and nothing ties particular kinds to particular holders. A staff-only member can OK a management invitation. Staff also see the invitee's email address in "Needs an OK", even though the people screen is meant to be behind `manage_people`.
2. **Promotions aren't invitations.** §8.1 says "anything that adds staff or management needs the second OK" for role changes. But `kind` only allows `field_check`, `colony_member` and `invitation`, so there is nowhere to queue "make guardian Eleni staff". A role change on someone already accepted goes straight through, and the second OK never happens.
3. **Island-wide volunteers skip it** (while B1's fix isn't in). Placing a volunteer on "all colonies" gives exact positions across the whole island, and §8.3 asks for no second OK because it's "a volunteer invitation".

**How it fails.** One manager's session is stolen. The attacker invites their own address as a guardian (no second OK needed), lets it be accepted, then edits that person's roles to add `staff`. Under point 2 that goes straight through. A stolen session that also belongs to a staff member can then approve whatever is left in the queue (point 1).

**Fix.** A management-only capability, `approve_access`, that is the only thing able to settle access items. One item kind, `access_change`, covering every change that adds `staff`, `management` or an island reach: invitation, role change and rejoin. Its detail holds the before and after in ids. Access items appear only to management; staff never see them. Then add three tests: a staff-only member's approval is refused; a role change that adds staff writes an item and grants nothing until it's approved; a rejoin with a staff role does the same.

---

## M1. The wrong-mailbox safeguard doesn't work as written, and the invitation leaks a name and a place — Major — CONFIRMED

**Where:** §4.1 steps 2 and 4, §8.4 (Decision 7), §14 case 1.

**What is wrong.**

- **The name check is switched off by the pre-fill.** Decision 7's main safeguard is that "the accept page asks the invitee to type their own name; the inviter sees it". But §4.1 step 4 says the name field is **"pre-filled with what Susan typed"**. A stranger who gets the invitation by mistake just taps **Yes, join**, and Susan sees the name she typed herself. Nothing tells her it went to the wrong person.
- **The invitation tells a stranger something private.** Step 2's message reads *"…as a cat guardian for Vaporia — Eleni's"*. The colony's name follows the "place plus guardian's first name" convention. The SYC-209 spec (§6) says nothing from the `colonies` table is ever public, "not that a colony exists". A mistyped address hands a stranger a guardian's first name and her neighbourhood. That message then sits in their mailbox for good, whatever happens to the invitation.
- **"One colony at most" isn't true.** §8.4 and §14 case 1 rest on that limit. A guardian invitation can carry several colonies (§2.2), and a volunteer one can carry "all colonies" (§6.5).

**Fix.** Leave the accept-page name field **blank** ("Type your name as you'd like Syros Cats to see it"), and show the inviter what was typed next to what she expected. The invitation message names no colony and no guardian: *"Syros Cats has invited you to help. To see what you've been invited to, sign in at admin.catspotters.com."* The colonies are shown only on the accept page, after sign-in. Rewrite §14 case 1's limit as "the colonies on the invitation", and route any invitation with more than three colonies, or with island reach, through `approve_access` (B3).

## M2. Nobody has said what a guardian sees on her own cat's page — Major — CONFIRMED

**Where:** §2.2, §6.2 (`view_exact_location`), §15.3 test 3.

**What is wrong.** Test 3 says that outside her colonies a guardian sees "the public view, field by field". **Inside** her colonies, nothing defines what she sees. The obvious build is the team's cat page (`lib/teamCatView.ts`, behind `GET /api/team/cats/:id`). Today that page shows:

- the cat's welfare-report history ("Welfare report: urgent, kittens"), which §2.2 keeps from guardians;
- hidden photos, so the team can restore them. A photo is usually hidden because it is upsetting or shows a person;
- team members' names as authors, including people who have left ("Maria (left)");
- whether a spotter answered each question, and the owner's link to the cat.

**How it fails.** The guardian page gets built as "the team page with a filter on colonies", because that's the shortest route. Every one of the items above then reaches guardians without anyone choosing it.

**Fix.** Add a table to §2.2 listing, field by field, what a guardian and a volunteer see for a cat **in** scope: exact discovery position, colony, feeding site, visible photos, sterilisation answer and confidence, life status, last-seen **date**. Explicitly **not** shown: welfare entries, hidden photos, team members' names (say "Syros Cats" instead), spotter identities, owner details, team notes. Build it as its own serialiser, not a filtered team view. Extend test 3 to check every one of those fields for the in-scope case.

## M3. "Where each cat is usually seen" doesn't exist, and building it would show where tourists walked — Major — CONFIRMED

**Where:** §2.3, §6.2 (`view_colony_targets`), §12 ("usual spots (exact)"), SYC-54.

**What is wrong.** SYC-54 asks for "where each is usually seen", and §12 promises "usual spots (exact)". `cat-record-data-spine.md` §6.6 says a cat's stored position is the **discovery position**: one GPS reading, frozen. The derived position was **deferred** by Samuel on 28 September (SYC-80). So the only way to build "usual spots" today is from individual sighting positions. §6.4 point 1 of the data spine calls those "a disclosure about a person, not a cat": each one is a tourist's position and the time they stood there. A volunteer's list built that way shows where and when each tourist walked.

On top of that, an exact position without a map is just numbers. §12 never says whether map tiles are kept offline. If they aren't, the offline list shows "37.4431, 24.9412", which nobody can use on a hillside.

**Fix.** For now, say "usual spot" means the discovery position plus the feeding site. Add SYC-80 as a dependency for anything better, and state that per-sighting positions and times are never sent to guardians or volunteers. For offline, give each cat and feeding site a short line of directions the team writes ("behind the bakery steps"), plus either a small fixed map image or nothing. Say in §12 that the live map doesn't work offline.

## M4. The offline list hides itself after 7 days rather than being deleted — Major — CONFIRMED / PLAUSIBLE

**Where:** §3 (option A), §12, §14 cases 9 and 10.

**What is wrong.** §12's protections are carried out by the page's own script, so they only work while the page is running and believes the phone's clock:

1. **"Shows no cats after 7 days" hides the list; it doesn't delete it.** The list stays in the browser's storage on the phone. Anyone with the unlocked phone and a cable can read it with the browser's developer tools, and the page never has to open.
2. **Turning the phone's clock back** makes a 10-day-old list look 2 days old, if expiry is checked against the device's date.
3. **The Home Screen nudge removes the only automatic deletion.** §12 calls Safari clearing a page's storage after about a week "a caveat" and plans to nudge people away from it. For exact positions on a phone that might be lost, that clearing is the one thing that actually erases data with nobody involved. A page saved to the Home Screen doesn't get it.
4. **"A deliberate cache"** (§3 option A) is unclear. If it means loosening today's `no-store` header on the colony JSON, the response also lands in the browser's normal web cache. The page's script can't clear that on sign-out.
5. **Scripts on the dashboard origin.** Today the dashboard has `default-src 'none'`, so a cat name a tourist typed with markup in it can do no harm. The offline pages will show public text (cat names) and guardian text (site names, 200-character notes). If any of it is shown without escaping, a script there can read and send off every exact position. A service worker registered at too high a level could also serve old staff pages after sign-out.

**Fix.** Keep `no-store` on **every** response, including the colony data. Store the data only through the page's own script, in its own storage. Save the "last online" time from the **server's** clock, and treat a phone clock earlier than that as expired. When the list expires, **delete** it as soon as the page opens. Send `Clear-Site-Data: "cache", "storage"` on sign-out and on every "you're no longer on the list" refusal. Register the service worker only for the field pages' own path (for example `/api/team/field/`), never for the whole dashboard. Allow scripts only from fixed hashes, with nothing inline and `connect-src 'self'`. Don't reuse the Home Screen nudge for this page. Then change §12's promise to say plainly: "a phone that is never opened again keeps its list until the browser clears it; on a Home Screen page that may be never". Make that the sentence Q1 puts to Syros Cats.

## M5. Any volunteer can take cats out of a colony, and a proposal can move a cat out of someone else's — Major — CONFIRMED

**Where:** §6.8, §7.4 (Decision 6), §6.2.

**What is wrong.**

- §6.8 says **"Anyone placed on a colony can say a cat is no longer in it… it takes away her own reach, so it needs no approval"**. That's wrong: a cat leaving a colony takes it out of **every** guardian's and volunteer's view of that colony, and off its round sheet. A volunteer placed last week can quietly remove the unsterilised cats from a trapping round. The capability isn't in the §6.2 table either. `assign_cat_to_colony` is island-only, and nothing placed covers "remove".
- The data spine's `colony` observation is `{ colonyId }`, and there is no value meaning "in no colony". "No longer in it" needs a change to the data spine, and §10.4 doesn't list one.
- A cat has one colony: the newest `colony` observation wins (§6.1). So when Eleni's "this cat is one of mine" is approved, the cat **leaves** Maria's colony and Maria isn't told. §7.4 mentions "a cat that belongs in two colonies" as something the team might notice, but the model can't hold that.
- The answer to a proposal can tell her whether a cat is already in a colony, if "already in a colony" and "sent" read differently.

**Fix.** Removing a cat from a colony becomes a proposal like adding one: it waits for the team's OK. The approval screen says, in words, "this moves Mimi out of Kini — Maria's". The proposal always gets the same answer ("Syros Cats will check"), whatever the cat's current colony. Add the "no colony" value to §10.4's list of data spine amendments.

## M6. It contradicts four approved or parallel documents — Major — CONFIRMED

**Where:** "What this document owns", §1 (Decision 1), §2.2, §6.7, §16.5.

1. **`cat-record-data-spine.md` §6.5.** Its table says who sees exact positions: the public, a spotter on her own sightings, and the team. §16.5 says that if the web page is chosen, "§6.5 stands unchanged and gains a line". It doesn't stand unchanged: guardians and volunteers seeing exact positions is a **new row in that table**, and `DECISIONS.md` Part 3 makes the data spine the owner of "who sees exact positions". That amendment is needed whichever way Decision 1 goes.
2. **`DECISIONS.md` Part 3 ownership.** "Sign-in, trust boundary, **roles**" belongs to `team-access-and-welfare-queue.md`. This spec says it owns "who may be on the list, what each kind of person can see and do". Add a Part 3 row moving roles, invitations and the confirmation queue to this document, or write it as an amendment of team-access §7.
3. **`team-access-and-welfare-queue.md` §7.2** describes guardians as people who "**are authorised to arrange sterilisation the charity pays for**". That's the money side (€50–60 a cat), and this spec doesn't mention it anywhere. Either cover it (a request for a vet appointment, OK'd by the team) or record that it's out of scope and file a ticket for it.
4. **The SYC-209 spec** (`feeding-sites-and-colonies.md` §7.2–7.3, being written in parallel) uses different capability names: `manage_feeding_sites`, `manage_colonies`, `set_cat_colony` against this spec's `add_feeding_site`, `edit_feeding_site`, `assign_cat_to_colony`. It also gives guardians more:
   - `manage_colonies` for their own colonies (edit the guardian name, notes and centre);
   - `set_cat_colony` for cats in their colonies **and for unassigned cats near their sites**, which is exactly the thing Decision 6 says needs an OK;
   - `manage_feeding_sites`, which includes **editing a site's colony**. A guardian could move another colony's private site into her own and then read its position.

   **Fix:** agree one set of names before either spec is approved. This spec's §6.7 should state that a guardian can't change which colony a site belongs to, and can only add sites in her own colonies.

## M7. A field check changes the public answer before anyone OKs it — Major — CONFIRMED

**Where:** §1 idea 3, §7.3 steps 1–2, §12.

**What is wrong.** §1 promises that "anything a field person says that would change a cat's sterilisation answer waits for one team member's OK". But step 1 writes an `ear_tip` observation with a photo **straight away**, and in `lib/resolve.ts` step 3, any non-superseded photo-backed `clipped: true` makes the cat *Likely*. A guardian's "clipped" with a photo moves a cat from *Not known yet* to **"Probably sterilised"** in public at once. It also adds one to the public count of clipped-tip sightings (`clippedTipCount`) and puts the cat back on the team's *Probably sterilised* list (`lib/likelyReview.ts`), which uses the newest clipped answer that isn't from a team role. Step 2 admits it can raise the cat to *Likely*, so the spec contradicts itself.

The spec also doesn't say **where the field-check photo lives**. The public `/api/photos/:id` route serves photos to anyone (F7a). A photo taken at a guardian's doorstep, at her feeding spot, must never be one of those.

**Fix.** Either (a) the field check holds its photo on the confirmation item and writes its observation without a `photoId`, so the resolver ignores it until the team agrees; or (b) say honestly in §1 that a photo-backed field check raises a cat to *Likely* the moment it's sent. I recommend (a). Either way, field-check photos are served only through the team's photo route, with a target (B1, fix 3), and never by the public photo route.

## M8. A person who leaves keeps their open invitations, and one manager can remove all the others — Major — CONFIRMED

**Where:** §9.2, §8.1, §9.5, §14 case 3.

**What is wrong.**

- §9.2: "An invitation they sent **stays valid**." A person is often marked as left **because** their account was misused. The invitations and access requests they made while it was compromised should be treated as suspect, not kept.
- §8.1 lets **one** management member mark anyone as left or sign them out everywhere, with only "never the last management person" as a limit. A stolen management session can mark every other manager as left, one after another, until it is the only one left. The break-glass command (Samuel, through db-ops) is then the only way back, and nobody has been told anything happened.

**Fix.** When someone is marked as left, every pending invitation and open access request they made is **withdrawn**, and management sees a line saying so ("3 invitations from Susan were withdrawn when she left; re-send any you still want"). Marking a staff or management member as left, or signing them out everywhere, sends a short email to every other management member. Removing a management member needs `approve_access` (B3), except when the person removes themselves.

## M9. Pending, withdrawn and expired invitations are described three different ways — Major — CONFIRMED

**Where:** §4.1, §4.4, §9.6, §10.1, §10.2.

**What is wrong.**

- §4.1 ("her row is deleted") and §4.4 ("the pending row is deleted; there is no history to keep") say a withdrawn or declined invitation is deleted. §9.6 says it **can never** be deleted, because the `invited` event has a strict link, so the person is marked as left instead. Only §9.6 works with SYC-213.
- §10.1 widens "who is on the list" (`findAllowedPerson`, `findPersonById`) to include **pending** people, then relies on `can()` ignoring their placements. But `CapabilityHolder` today is only `{ scopes }`. It has no idea whether the person has accepted, so `can()` *can't* ignore pending placements unless that state is passed in. If someone forgets, a pending invitee gets in without accepting. The current default fails closed: pending people aren't on the list. The proposed default fails open.
- The accept step has a race. Withdrawal or expiry happening at the same moment as **Yes, join** has no stated order.
- §9.4 sends a returning person back through acceptance, but says nothing about resetting `accepted_at`. Today's rejoin code (`addPerson`) replaces the roles at once.

**Fix.** Keep `findAllowedPerson` and `findPersonById` as "accepted and not left". Add a separate `findInvitee` used only by the hand-off and the accept page. Accepting is one conditional update: `where accepted_at is null and left_at is null and invite_expires_at > now()`. Withdraw and expire use the same kind of guard. Rejoining sets `accepted_at` to null and writes new placements as pending. Delete the "row is deleted" wording in §4.1 and §4.4.

## M10. The migration as described would fail on rows that already exist — Major — CONFIRMED

**Where:** §10.1, §15.2.

**What is wrong.**

- `reach` is "not null, default `island`", with a check that `reach = 'colony'` exactly when `colony_id` is set. Any existing row that has a colony gets the default `island` and breaks the check, so the migration fails partway. A `staff` row with a colony (the `people` command allows one) breaks the new "staff requires island" check the same way. §10.1 only says to list-and-stop for guardian and volunteer rows **without** a colony.
- The `admin` → `management` rename assumes no observation has ever been written with `admin`. But `writeObservation` lists `admin` as a role it accepts (`REACHABLE_ROLES` in `lib/observations.ts`), so the assumption needs checking against the live database.
- The `added` events that SYC-213 backfills, the new `management` rows and the backfilled `accepted_at` all have to land before the code that reads them. The spec doesn't give that order.

**Fix.** Set `reach` from `colony_id` before adding the check. List and stop on **every** row that breaks the new checks, not only guardian and volunteer rows. Before the rename, add a step: a count of `role_at_time = 'admin'` observations that must be zero, with the migration stopping if it isn't. Write down the order: SYC-213's migration, then this one, then the code. Show Samuel the list of people who will become management before it runs. "Every current staff member" is right in principle, but test and seed accounts shouldn't come along.

---

## m1. A guardian's life-status powers cut both ways — Minor — CONFIRMED

**Where:** §2.2, §6.2 (`set_life_status`), §7.2, Q3.

- `resolveLifeStatus` doesn't look at roles: the newest statement wins, and "any non-superseded write is as good as confirmed". A guardian's "homed" overrides an older team "street" with no review. Q3 accepts that, but the spec should say so in those words.
- She can say *homed*, *in care* or *deceased*, but not *street*. If she marks the wrong cat as deceased, she can't undo it. Only a later sighting or the team can.
- **She can take cats off a trapping round.** A feeder who doesn't want her cats trapped (some don't) can mark the unsterilised ones *homed*, and nobody approves it. If the round sheet leaves out homed or deceased cats, they disappear from the round. **Fix:** the round sheet and "Needs a look" keep any cat whose life status a guardian changed in the last 30 days, flagged "recently marked homed by the guardian". The team's feed of guardian changes (§7.2) shows them.
- When guardians and volunteers write offline, the date they send should be limited the way public answers are (no more than 30 days back, never in the future). The spec doesn't say so; staff can backdate without limit.

## m2. "Pick a cat from anywhere" has nowhere for a guardian to do it — Minor — CONFIRMED

**Where:** §6.2 (`match_cat_anywhere`), `DECISIONS.md` Part 2i.

A guardian takes photos in the public app, under its anonymous phone identity. The dashboard has no way to upload a sighting. So there is no screen where she would match a photo with "pick from anywhere", and the capability can't be tested. Part 2i says guardians do this "in the staff dashboard", which assumes something that doesn't exist. **Fix:** either specify a dashboard upload of a guardian's own sighting, or record that this capability waits for one. Also say that the "Ask Syros Cats to match it" list stays team-only: it holds tourists' exact sighting positions from anywhere on the island. When a guardian checks the hand picks for her own cats (`review_hand_picks`), she should see the sighting's position only at the 250 m-square level, because a hand pick can come from up to 1.5 km outside her colony.

## m3. Rules that can't be tested, or have nothing behind them — Minor — CONFIRMED

- §14 case 3: guardian invitations "are visible as events within the hour". Nothing makes that happen, and nobody is notified.
- §11.1 lists `invite_expired` events written by `system:expiry`. But §6.6 says expiry is checked when a request comes in, with no job running. So nothing ever writes those events. Either a job writes them, or the people screen works expiry out when it's drawn and the event kind is dropped.
- §11.3's reading counter: a guardian can only open cats in her own colonies anyway, so "far more than her colonies hold" mostly measures her reloading the page. The real exfiltration risk is the round sheet, which is one request. Count round-sheet downloads and prints per person instead, and drop the "twice the cats" rule.
- §8.4: "a mistake is visible within the day" depends on the inviter reading her email. Use the people screen's own "joined in the last 7 days" list as the check that doesn't depend on that.

## m4. Two uniqueness rules don't fit what the text asks of them — Minor — CONFIRMED

- `confirmation_items`: "open items are unique per (kind, cat, proposer)". For `invitation` items `cat_id` is null, so either a manager can have only one open invitation at a time, or the rule does nothing, depending on how nulls are treated. §7.3's "asking about a cat that already has an open item **adds to it**" doesn't say whether two volunteers asking about one cat share an item. Say which, and choose a key that does it.
- `person_scopes` keeps the unique rule on (person, role, colony). §6.6 has placements that expire and §9.2 keeps rows as a record. A guardian whose holiday cover ended can't be placed on the same colony again without an update. Write that down as the expected path, or let `expires_at` take part in the rule.

## m5. Mail details — Minor — CONFIRMED

- §8.5: "shed before news". Under D2, news goes out on a **separate** identity with its own quota, so it never competes with the invitation. Say which identity invitations use (transactional, like sign-in links) and where they sit among transactional mail.
- §8.4 adds a second message, the inviter's "Eleni P. accepted your invitation". That needs its own purpose, and it carries text the invitee typed, which contradicts §8.2's "no free-text box that ends up in an email". Escape it and limit its length, or leave the name out of the email ("Your invitation was accepted; see the people screen").
- §12 reuses `homeScreenNudgeText`, whose words are about keeping *spots* safe. It needs its own string (and see M4 on whether to nudge at all).

## m6. The last-manager guard has a race — Minor — PLAUSIBLE

Two managers marking each other as left at the same moment each see one other manager still there, and both succeed. Lock the set of management rows (or one marker row) inside the same transaction. Add a test that runs two at once.

## m7. Canonical facts and house rules — Minor — CONFIRMED

- **€50–60 per cat:** correct (§7.2). **"Cat guardian":** used throughout; "colony carer" doesn't appear. **Offline:** mostly precise. §3's option table and §12 are honest. M3 and M4 list the two places it says too much ("usual spots (exact)" offline with no map; "erases").
- **Spotter and snapper:** the project's canonical roles are "spotter" and "snapper". `docs/PRODUCT-SPEC.md` line 16 says **"Spotter, not snapper"**. The spec uses "spotters and snappers" and flags the conflict in §13.3, but §16.2 doesn't list it as a question. **Reported, not settled here:** add it as Q7 for Samuel.
- **Aspirational wording:** the project rule is that a spec describes one vision and never separates "built today" from "proposed". The product sections do separate them: §1 "Today the Syros Cats team has one kind of person", §2.4 "Unchanged from today… New:", §5 "Today every person on the list is staff". The technical sections (§10, §15, §16.3) need to talk about the code. §1 to §9 should be reworded as the product as a whole.

---

## What is sound

These parts hold up, and should be kept as they are:

- **Invitation through the existing sign-in, with no secret in the message** (Decision 2 A). Mail scanners and forwarding can't do harm, and a new kind of link doesn't need protecting.
- **An explicit `reach` column with a database check**, so a guardian with no colony is refused by the database itself. It needs B1's tightening, but the idea is right.
- **Strict `can()` with a separate `canSomewhere()`** (Decision 4 A). A route that forgets its target refuses rather than over-shares. Walking every route, with a route missing from the table failing the test, is the right check.
- **A 403 page for someone signed in who isn't allowed**, instead of today's 401 and sign-in loop.
- **The Worker changeover order:** the old request gets `allowed: true` only for people with the workspace door. It fails closed, and test 6 pins it.
- **The server decides `roleAtTime`, and there is one list of team roles.** S1 and S3 are real bugs waiting to happen and are worth fixing for their own sake.
- **The database refuses `decided_by = proposed_by`**, and the item is checked again when the decision is written, not only when the page was drawn.
- **Events hold ids, not names**, so SYC-208 can anonymise without breaking the history.
- **§9.7 finds the guardian's name in colony names**, which SYC-208 would otherwise miss.

---

## The 11 decision recommendations, judged

| # | Recommendation | Verdict | Reasons |
|---|---|---|---|
| **1** | D: the dashboard as a saved web page, plus a printable round sheet | **Agree, with conditions** | Keeping exact positions out of the app every tourist installs is the right line. But the page must follow M4 (delete rather than hide, server time, no relaxed `no-store`, a narrowly scoped service worker, scripts by fixed hash). §12's promise must be rewritten to say a phone that's never reconnected may keep its list. The data spine §6.5 amendment is needed either way (M6). Shipping the round sheet first and the saved list after is sensible, and slice 3 already allows it. |
| **2** | A: a pending person plus a plain message | **Agree** | The smallest new surface. Fix the delete/mark-left contradiction and the fail-open finder (M9), and take the colony name out of the message (M1). |
| **3** | A: split staff and management; everyone is both on day one | **Agree** | But the split only means something with B3's fix (`approve_access`, management-only). Show Samuel the day-one list (M10). |
| **4** | A: strict `can()` plus `canSomewhere()` | **Agree, and it isn't enough on its own** | It doesn't close the gap for an island-wide volunteer (B1). Put the welfare and report routes on a team-only capability, give the photo routes targets, and add an island volunteer to the route walk. |
| **5** | B: a field check is evidence; one team OK moves the answer | **Disagree as written** | "Yes" writes *Confirmed*, which breaks data spine §4.2 and Part 2k, and it sets off emails that can't be unsent (B2). The field check also moves the public answer to *Likely* before any OK (M7). **Change to:** "Yes" writes the team's `ear_tip { clipped: true }` with the in-person marker (the cat stays *Likely*, shown as checked in person). *Confirmed* comes only from the team's own records or a vet. The field check doesn't count toward the public answer until it's approved. If Samuel wants "Yes" to confirm, record it as an explicit amendment to §4.2. |
| **6** | A: the guardian proposes, the team OKs | **Agree, and extend it** | Removing a cat also needs an OK. The approval screen shows that a cat is being moved out of another colony. The proposal's answer is the same whatever the cat's current colony (M5). Settle the clash with SYC-209's `set_cat_colony` for "unassigned cats near their sites" in this spec's favour (M6). |
| **7** | A: make mistakes unlikely and loud | **Agree only with fixes** | As written, the main check is switched off by the pre-filled name (M1). **Change to:** a blank name field, no colony or guardian named in the email, and any invitation with island reach or more than three colonies goes to `approve_access`. With those, A is better than B. Making a real guardian wait for the inviter costs more than it saves. |
| **8** | A: volunteers see only the colonies they're assigned | **Agree, and remove island reach for volunteers** | "All colonies" should be one row per current colony, never `reach = 'island'`. That closes B1 for volunteers without relying on route-by-route care. New colonies are not added automatically. |
| **9** | A: one guardian role; optional end date and label | **Agree** | Note the uniqueness rule (m4), and that expiry is worked out when a request comes in, so no `system:expiry` events get written (m3). |
| **10** | A: guardian and volunteer screens in three languages; team screens in English | **Agree** | Add the 403 page and the "accepted" email to the list (§13.1 has the 403 page; the email is missing). The named-reviewer gate is right. |
| **11** | A: a second management OK for staff and management invitations | **Agree, and widen it** | It must also cover role changes that add staff or management, rejoins with those roles, island reach, and removing a manager (B3, M8). Only management may give the OK. |

### On the questions for Syros Cats (§16.2)

- **Q1** should carry M4's corrected sentence about phones that are never reconnected, and be asked together with SYC-67 (the F2 acceptance), as the spec suggests.
- **Q3** (a guardian marks a cat deceased without review): yes is reasonable, given m1's 30-day flag on the round sheet.
- **Add Q7:** spotter and snapper (m7). **Add Q8:** do guardians "arrange sterilisation the charity pays for" through this system, or not yet (M6 point 3)?

