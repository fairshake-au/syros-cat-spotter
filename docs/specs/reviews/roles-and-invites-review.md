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

