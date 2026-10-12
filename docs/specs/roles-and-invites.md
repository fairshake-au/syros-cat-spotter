# Roles and invites: guardians, the Syros Cats team, management and the confirmation queue

**Feature spec · Cat Spotters (Syros)**
**Status:** **Decisions made 12 October 2026; ready for final approval.** Samuel's decisions of 12 October 2026 are recorded in each decision section as "Decided" and listed in §16.7. The independent review of 7 October 2026 is in [`reviews/roles-and-invites-review.md`](./reviews/roles-and-invites-review.md); §16.6 says how each finding was handled.
**Owner:** Samuel
**Covers:** SYC-53 (roles, invitations, the confirmation queue). Written so that SYC-104 (the people screen), SYC-213 (`person_events`), SYC-54 (the guardians' and team's colony view), SYC-222 (workspace documents versus dashboard) and SYC-208 (forgetting a former team member) can each be built from it without a rebuild.
**Builds on:** [`team-access-and-welfare-queue.md`](./team-access-and-welfare-queue.md) §2 (sign-in), §2.7–2.9 (one list of people), §7 (roles later), §8.4 (tables) · [`cat-record-data-spine.md`](./cat-record-data-spine.md) §3.2 (who can set what), §4.5 (fixing a wrong *Likely*), §6.5 (who sees exact locations), §10.1 (observations), §10.5 (colonies and feeding sites) · [`DECISIONS.md`](./DECISIONS.md) Parts 2i, 2k and 3 · the code on `main` as of 7 October 2026 (`lib/db/src/people.ts`, `lib/db/src/schema/people.ts`, `artifacts/api-server/src/lib/capabilities.ts`, `middlewares/requireTeam.ts`, `routes/team.ts`, `routes/internal.ts`).
**Linear:** SYC-53 · SYC-104 · SYC-213 · SYC-54 · SYC-222 · SYC-208 · SYC-188 (done) · SYC-76 (done) · SYC-131 (done) · SYC-209 and SYC-2 (cite §6) · SYC-257 (settled in Decision 12) · SYC-24 (vets, parked) · SYC-26 (Google sign-in).

### What this document owns, and what it borrows

This document owns **who may be on the list of people, what each kind of person can see and do, how they get on the list and off it, and the confirmation queue**. It extends the list and the capability function that `team-access-and-welfare-queue.md` §2.7–2.9 and §7.3 already put in place; it does not replace them.

It borrows, and does not restate:

| What | Owner |
|---|---|
| Staff sign-in by emailed link, the one-minute hand-off pass, the dashboard session, mail identities | `team-access-and-welfare-queue.md` §2 |
| The welfare queue, the "this cat needs help" flow, the safety copy | `team-access-and-welfare-queue.md` §3–5 |
| The cat record: observations, how a status is worked out, ear-tip rules, life status, presumed-deceased | `cat-record-data-spine.md` |
| Colonies and feeding sites as records; blurring; who sees exact positions | `cat-record-data-spine.md` §6.5, §10.5 |
| Picking a cat by hand, the "Matched by hand" list | `choose-a-different-cat.md` |
| Deleting a spotter's own data | `cat-record-data-spine.md` §8 (F3) |
| The offline colony view itself (what is on the screen) | SYC-54, to be specified; this document fixes who may open it and what may be kept on a phone |

---

## 1. The short version

The island has two kinds of people who know the cats: the Syros Cats team, who can do everything on the dashboard, and the cat guardians who see the cats every week. The team includes the people who help with field work (trapping rounds, ear checks, counting): there is one team, not a team and a separate group of helpers. A team of two or three could be trusted with everything. A team that asks the people who actually know the cats to help cannot give each of them the keys to the whole island.

The product has four kinds of person, and the public is exactly as it was:

- **The Syros Cats team**, who do the cat work across the whole island: the welfare queue, records, field work, trapping rounds. Everyone who helps Syros Cats in the field is on the team and sees and does the same island-wide.
- **Cat guardians** who look after a colony. They see *their own* colonies in full: exact positions, feeding sites, which cats are done and which aren't. They can say a cat is homed, in care or has died, decide which cats are in her colonies, look after their colony's feeding sites, and tell the team "I've looked at her ear, it is clipped".
- **Management**: the few people on the team who invite and remove others. The people who are on the team when roles go live are also made management, so nothing any of them can do is taken away; the charity can narrow it afterwards.
- **Spotters**, everyone using the public app. They never need an account and are never asked for one.

Three ideas hold it together:

1. **Invitation is the only way in, and it reuses the sign-in that already exists.** Management invites a person by their own email address. The person gets a plain message (it contains no secret), signs in the way the team already does, and taps "Yes, join". No second sign-in system, no new kind of link to protect.
2. **What you can see and do depends on where you are placed.** A guardian's powers stop at the edge of her colonies. This is enforced where the data is read, not by hiding buttons.
3. **A guardian's word that a cat is sterilised counts at once, and it is always recorded with who said it.** The team, vets, cat guardians and cat owners can each confirm a sterilisation, and the team can mark one wrong. What a guardian saw of a cat's *ear* (a field check) is the lighter statement: it waits for one team member's OK and records "checked in person". The person who made a statement can never be the one who approves it.

### The one thing that surprised us, stated up front

`cat-record-data-spine.md` §6.5 says the mobile app has no sign-in and never will, so that exact positions never reach a phone that every tourist installs. SYC-54 asks for a colony view for guardians and the team that works offline. Those two cannot both be taken literally. §3 puts the choice to Samuel (Decision 1) and recommends keeping the app as a public reader and making the colony view an installable web page on the dashboard's own domain, with a printable round sheet as the fall-back that needs no phone at all. What that page may keep on a phone, for how long and how it is deleted is Decision 12 (§12); it is the one place exact feeding-site positions are allowed to leave the dashboard map, and the feeding-sites spec (SYC-209) matches it. **The rest of this spec is written so it works whichever way Decision 1 goes.**

### The two audiences want the same thing from different angles

A tourist supplies a photograph and attention at the moment it matters. A guardian who has fed the same alley for nine years supplies judgment: which cat this is, whether she was ever done, whether she has gone. The team supplies legs and the record. These needs are **complementary**: this spec is the point where they meet, so that nobody's contribution is thrown away and nobody has to be trusted with more than their part.

---

## 2. Each role, in plain terms

### 2.1 Spotters (no account)

Everyone with the app. They sign in to nothing, and that does not change. They see cats at the blurred, 250 m-square level the data spine promises. They add sightings, answer the ear-tip question, add details later to their own sightings, report a cat in trouble, and delete their own data. **Nothing in this spec asks a spotter to do anything differently, and no screen will ever put an account wall in front of one.**

A resident who feeds a cat and has no email address, or no wish for one, stays in this group and loses nothing. When the team wants her word on a cat they record it on her behalf, as a team entry with a note saying whose word it was. This matters: the most valuable guardians on the island are often the least likely to want an account.

### 2.2 Cat guardian

A person who looks after one or more colonies, endorsed by Syros Cats. In plain terms:

| She can | She cannot |
|---|---|
| See, for **her own colonies only**, every cat's exact position, the colony's feeding sites, photos, and each cat's sterilisation answer with how sure we are | See exact positions anywhere else. Other colonies look to her exactly as they look to a tourist |
| Say a cat in her colony is **homed**, **in care** or **has died**, with a short reason, and put back the status she herself replaced in the last 30 days (so she can undo her own mistake) | Hide a cat's earlier sterilisation statement or delete another person's. Only the team can mark a confirmation wrong (§7.2) |
| Say a cat in her colony **is sterilised**, or **isn't**, and see it *Confirmed* straight away, recorded as hers (§7.2). Say "I looked at this cat's ear today" with an optional photo (a **field check**, which waits for the team's OK) | Rename cats or colonies, hide photos, or make a feeding site public |
| Add a feeding site to her colony, and rename, move, retire or bring back her colony's sites (always private, §6.7) | Move a feeding site to a different colony, or see any other colony's sites |
| Say "this cat is one of mine", or "this cat is no longer in my colony"; the team decides (§7.4) | Invite or remove anybody |
| State a cat's colour and markings, and add team-only health notes, for cats in her colonies (§6.7) | See the welfare queue, reporters' details, or anyone's data requests |
| Check the **hand picks** in her own colonies (a hand-picked sighting's position shows only at the 250 m-square level) | See the workspace documents and the shared document password |
| Stop being a guardian herself, at any time (§9) | |

Picking a cat from anywhere on the island when matching a photo (the 30 September decision in `DECISIONS.md` Part 2i) is a reserved power, `match_cat_anywhere` (§6.2, note 3), because the dashboard has no screen for a guardian to upload her own sighting.

**What a guardian sees of a cat in her own colonies.** This is its own page, built from its own list of fields. It is **not** the team's cat page with a filter on it, because the team's page shows things she must not see.

| She sees | She does not see |
|---|---|
| The cat's name, SYR number, exact discovery position, colony and feeding sites | Welfare reports about the cat |
| Photos that are visible to the public | Hidden photos, or any photo a reporter or guardian sent privately |
| The sterilisation answer and how sure we are, with "checked in person" where it applies | Team members' names: edits show as "Syros Cats" |
| Life status and the date the cat was last seen | Who a spotter is, any owner details, or the team's notes (a guardian also sees health notes, §6.7) |
| Colour and markings | Per-sighting positions or the times tourists stood there |

**For any cat outside her colonies, and for any cat in no colony, she sees exactly what the public sees.**

A guardian can hold several colonies, and a guardian can also be on the team (a team member who guards her own alley). Both are rows, so neither blocks the other.

**What a guardian is *not*:** an owner. A resident who claims a cat in the app (name and home description only) has never needed endorsement and still does not. Guardian is the endorsed, wider version of that relationship, as the health-record design put it (§6.3). The relationship a guardian has with a colony (feeds it, owns a cat in it, covers temporarily) is recorded as a label on the colony, for the team's benefit; it does **not** change what she can do (Decision 9).

### 2.3 The Syros Cats team

Everyone who works for Syros Cats on the island, including the people who help with field work: trapping rounds, checking ears, counting. In plain terms, one team with one set of powers, island-wide:

| They can | They cannot |
|---|---|
| Use the whole dashboard: the welfare queue, every cat, colony and feeding site on the island, the colony view and the round sheet for any colony | Invite or remove anybody, or action a data-deletion request. That is management (§2.4) |
| Record what they found in the field: "ear is clipped, here is the photo", "not a clip, torn ear" (a **field check**, §7) | |
| Fix records, rename cats and colonies, move cats between colonies, hide and restore photos, state colour and markings, record sterilisations, make feeding sites public one at a time | |
| Settle field checks and site-public requests (§7) | |
| Stop being on the team themselves | |

A new team member, office or field, is invited the same way as anyone else (§4) and is placed on the whole island. There is no placement per colony for the team and no separate volunteer role. The stored role value is `staff`; on screen it is "the Syros Cats team".

### 2.4 Management

A tier of the team, held by the few people who decide who is on the list. Everything a team member can do, plus: invite, place, re-place, remove and re-admit people; sign somebody out everywhere; and action data-deletion requests.

**Everyone on the team when roles go live is made management too.** No capability anyone holds is taken away, and management is narrowed afterwards by a person with the right to do it, in the people screen (Decision 3).

### 2.5 Vets (reserved, not designed here)

SYC-24 is parked by Syros Cats. The role name `vet` already exists in the database and in the vocabulary of the record; it grants nothing. When it is picked up, a vet is one more row in the capability table (§6) and one more invitation. Nothing here blocks it and nothing here builds it.

### 2.6 What each role is called on screen

Never "role", "scope" or "capability" on screen. Each person sees one sentence about themselves: *"You're a cat guardian for Vaporia — Eleni's and Kato Chora."* Greek and French wording is part of the translation work in §13.

---

## 3. Decision 1: where do guardians and the team do their work?

This is the question that decides most of the build, so it comes first.

**The facts.** The dashboard is a plain web page on `team.catspotters.com`, signed in with the cookie the hand-off sets. The mobile app is a public reader with an anonymous device identity and, by design, no sign-in (`cat-record-data-spine.md` §6.5: "there is not going to be one"). SYC-54 wants a colony view that works with no mobile data, and says to reuse the existing offline queue. The old health-record design (§6.2) said "signing in upgrades the phone". Those three sentences disagree.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ The dashboard, made installable and partly offline.** Guardians and the team use `team.catspotters.com` on their phone. The colony view and round sheet are pages that can be saved on the home screen and that keep the last list they loaded. The app stays a public reader. | One sign-in, one session, one place their data comes from. The app never holds exact positions, so a tourist's phone cannot leak them. The data spine's rule stays true. | A web page cannot be wiped from a distance: a phone that is lost and never opened again keeps its saved list until the browser clears it (§12 says this plainly). The dashboard is "no scripts, for now" (`DECISIONS.md` Part 2k): every team response carries a policy that forbids scripts (`default-src 'none'`) and a `no-store` cache header (`lib/teamAuth/refuse.ts`). An offline view needs a small amount of script, so this one set of pages under its own path gets a narrow relaxation of the script rule only (fixed script hashes, nothing inline, `connect-src 'self'`); **`no-store` stays on every response**, and the saved list lives in the page's own storage, not the browser's web cache. Field checks made offline need a small queue of their own in the browser. |
| **B. Sign in inside the app.** A guardian signs in to the app; the account becomes her identity and the phone credential stays as the session. | The offline machinery is already there. One app to install. | **Reverses a settled rule.** The app is what every tourist installs; with a sign-in, exact positions of cats in a colony would sit in app storage on guardians' phones, in an app whose cache code was written on the promise that exact positions never arrive. A lost phone then carries a map of where the island's unsterilised cats gather. The data spine's own warning (§6.5) is that such a mode "must use a distinct key"; that is doable but is a large new surface, and the app review process now has to consider it. |
| **C. Paper and files only.** The dashboard produces a round sheet (a printable list or a downloaded file), and that is the "offline view". | The safest: nothing sensitive persists on a device the charity does not control. Works with no signal because it is already on the page. | It goes stale the moment it is printed. Field checks can't be queued; the guardian or team member remembers and enters them later. Not what SYC-54 asked for. |
| **D. Both A and C.** | The round sheet is a by-product of A (it is the same data, printed). | Two things to look after. | None beyond A's. |

**What people notice.** A (and D): a guardian opens a link on her phone, saves it to the Home Screen once, and sees her list; with no signal she sees the last list she loaded, and a printed sheet if she wants paper. B: she opens the app, signs in once, and everything is in one place, but every tourist's app now contains a sign-in door. C: she prints a list before she goes out and writes down what she finds.

**Recommendation: A, with the round sheet from C as part of it (so, D).** It keeps the rule that the app never holds exact positions, keeps one sign-in, and still gives a guardian or team member something to carry when there is no signal. The browser-storage weakness is real; Decision 12 (§12) says exactly what a phone may hold, for how long, and how it is deleted.

**Conditions added after review** (the recommendation is unchanged): the saved list is deleted, not just hidden, when it expires; expiry uses the server's clock; the page's script is confined to its own path; and §12 states honestly that a phone never reopened keeps its list until the browser clears it. The data spine's §6.5 table needs a new row for guardians whichever option is chosen (§16.5).

**If B is chosen instead**, §7 to §11 are unchanged (identity, capabilities, invitations, the queue). What changes is §12 and `cat-record-data-spine.md` §6.5, which would need an approved amendment first.

---

## 4. Decision 2: how someone is invited, accepts, and signs in

### 4.1 What the person experiences

1. **Eleni is told.** Susan, in management, has asked her on the phone, and she has said yes. Susan opens the people screen (SYC-104), taps **Invite someone**, types Eleni's own email address and name, chooses **Cat guardian**, picks Vaporia — Eleni's, and chooses the language of the message (Greek). She types the address twice. She taps **Send invitation**.
2. **Eleni gets a plain message**, in Greek, from `Cat Spotters <signin@mail.catspotters.com>`: *"Syros Cats has invited you to help. To see what you've been invited to, go to admin.catspotters.com, type this address, and tap the link we send you."* It contains **no secret, no link she could be tricked with, and no colony or guardian name** (a mistyped address would otherwise hand a stranger a guardian's first name and neighbourhood, for good). Anyone who finds it learns only that an invitation exists.
3. **Eleni signs in** the way staff already do (§2.1 of the team-access spec): she types her address on `admin.catspotters.com`, gets the emailed link, taps it, taps **Yes, sign me in**.
4. **She lands on one page:** *"Susan from Syros Cats invited you as a cat guardian for Vaporia — Eleni's. Here is what you'll be able to see and do. Here is what we ask of you."* The colonies are named here for the first time, after sign-in. Four short promises (below). A **blank** name field (*"Type your name as you'd like Syros Cats to see it"*): it is not pre-filled, so that Susan can see whether the person who arrived is the person she meant. Two buttons: **Yes, join** and **No, this isn't for me.**
5. **She taps Yes, join** and arrives on **My colonies**. From then on she signs in exactly like staff: type address, tap link. Her session lasts thirty days on that phone.

If she taps **No**, the invitation is withdrawn: she is marked as left, as for anyone else (a person is never deleted once they have a history, §9.6). If she does nothing, the invitation stops working after **14 days** (§4.4) and Susan sees "expired" next to her name.

**The four promises on the accept page** (wording for Syros Cats and native review, §13):

- I will keep the exact places of cats to myself. I won't post them or give them to anyone, however kind the reason.
- I will say what I actually saw, and say "I'm not sure" when I'm not.
- If I stop helping, or lose my phone, I'll tell Syros Cats.
- I understand Syros Cats keeps my name and email address to run this, and I can ask to leave at any time.

These are not a legal contract. They are the moment the person is told, in plain words, what they are being trusted with. The acceptance is recorded (§11).

### 4.2 Why not use an account service such as Clerk

The old design (health-record spec §6.1, repeated in the SYC-53 ticket) said to use Clerk for accounts and invitations. That was written before staff sign-in existed. Today there is a working, reviewed sign-in, one list of people (`people`), a hand-off to the dashboard, and a mail path. Adding a second identity system would put every person on two lists again, which is the exact problem `team-access-and-welfare-queue.md` §2.7 spent a section removing, and would make "remove somebody in one place, effective at their next request in both systems" untrue. Option C below records why it is rejected.

### 4.3 The options

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ A pending person row plus a plain invitation message.** Inviting creates the person in a "not yet accepted" state with the roles intended for them. They sign in the usual way. Roles grant nothing until they accept. | Builds on what exists: no new kind of link, no new token. The invitation message holds no secret, so a mail scanner or a forwarded message can do no harm. Expiry, revoke and resend are just changes to a row. Removal, "sign out everywhere" and `session_version` already work. | Two messages arrive (the invitation, then the sign-in link). The sign-in Worker has to say yes to a person who isn't yet accepted, so that she can receive her link; the API decides what she may then do. A mistyped address that belongs to a stranger lets that stranger accept (§8.4, §14 case 1). |
| **B. A single-use invitation link.** The invitation message carries a token; following it signs her in and accepts. | One message instead of two. Matches the old design's "single-use, tied to an email, expiring". | A new kind of secret in a mailbox, to be protected from mail scanners (the same fix as sign-in links needs, §2.5 of the team-access spec) and from forwarding. The Worker has to redeem it, so a new Worker route in the other repository. A second sign-in mechanism, which §7.3 of the team-access spec rules out ("no second sign-in mechanism gets built for the second role"). |
| **C. Clerk, as the health-record design said.** | Invitations, roles and sessions come ready-made. | A second list of people; two places to remove someone; the dashboard session, the hand-off and the sign-in Worker would all have to be reworked or doubled; a new supplier holding the names and emails of a small charity's guardians and team, and a price to confirm (the old design's own open item). It also contradicts the decision already built (D3, F5). |
| **D. Self-service sign-up with approval.** A person asks to join; management approves. | No typing of addresses by management. | An open door on the sign-in page, which today deliberately reveals nothing about who has access. Invitations are the whole point (§7.3: "invitation is the only way in, at every tier"). |

**What people notice.** A: two emails and one extra tap, the first time only. B: one email, but a link that can be forwarded or opened by a mail scanner and then doesn't work, which is the failure staff sign-in already had to fix. C: a new sign-up screen to learn. D: nothing for the invitee, and a door on the sign-in page.

**Recommendation: A.** It is the least new surface. The cost, two messages, is a small friction paid once per person. Wrong-address risk is handled in Decision 7.

### 4.4 Expiry, resend, withdraw

- An invitation is valid for **14 days** from when it is sent. After that the person is treated as not on the list (the Worker answers "no", as for any unknown address) and management sees "expired".
- Management can **resend** (a fresh 14 days; at most one invitation message per person per 24 hours) or **withdraw** (the pending person is marked as left; §9.6 says why a row is never deleted).
- Fourteen days is long enough for a guardian who checks mail on Sundays and short enough that an invitation to a mistyped address stops being a standing hole.

### 4.5 What the Worker has to learn (and the order it ships in)

`POST /api/internal/people/allowed` today answers one question: yes or no, and for yes the person's id, name and session version. Two things change, both in the sign-in Worker's repository as well as here, and **they must ship in a safe order**:

- The answer gains **two doors**: `{ workspace: bool, dashboard: bool }`, plus the person's language, so the sign-in message can be sent in it. §6.3 explains the split (SYC-222). A person who has been invited but not yet accepted gets `dashboard: true` (so the hand-off can take her to the accept page) and `workspace: false`.
- **Compatibility.** The Worker deployed today reads only `allowed: true` and gives the workspace to everyone for whom it is true. So the API answers the old request shape with `allowed: true` **only for people who hold the workspace door**; the new Worker sends a version marker and receives the full answer. Until the new Worker ships, a guardian simply can't sign in, which fails safe. Nobody gets the shared document password by accident during the changeover.

### 4.6 Signing in later, and the second door

After accepting, a guardian signs in exactly as the team does. Google sign-in (SYC-26) is the planned second door; it uses the same list and the same rule ("Google proving who you are is never the same as being let in"), and would help guardians who already live in Gmail. This spec adds nothing to it.

### 4.7 Someone with no email address

No email, no account (§2.1). This is deliberate, not a gap. The team records what she tells them. If a texting-based sign-in is ever wanted (many islanders live in WhatsApp), it is a different door onto the same list and a decision for later; it is not designed here.

---

## 5. Decision 3: should the team and management be two tiers?

**Decided (Samuel, 12 October 2026): option A, two tiers, team and management.** Everyone on the team when roles go live is also made management, so nothing is taken away on day one; management alone holds `manage_people` and `action_deletion_request`.

Every member of the team holds every team capability, including adding and removing people and actioning data-deletion requests. That is fine while the list is Samuel, Jacky and a few colleagues. It is a real exposure once the list includes guardians, because **whoever can invite can create a person who sees where cats gather.** The question is whether the power to change the list should sit with everyone on the team or with a few.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ Decided. Two tiers, with nothing taken away on day one.** The *team* does the cat work, including field work. *Management* additionally manages people and actions deletion requests. Everyone who is on the team when roles go live is given both. | The sensitive powers sit with a few named people from the moment the charity chooses. No one loses anything on the day it ships. The people screen (SYC-104) can narrow it later. | One more thing to explain. Until someone is demoted to team-only, the tier changes nothing in practice. The charity must actually choose who is management, or the split is decoration. |
| **B. One tier.** Every team member can invite, place and remove. | Nothing new to explain. | Any team member, or anyone who gets into a team member's mailbox, can create more accounts and widen who can see exact positions. |
| **C. Three tiers** (read-only team members as well). | Finer control. | Nobody has asked for it. A system with more tiers than the charity has people is a system the charity stops maintaining. |

**What this choice accepts.** The earlier recommendation was the same two tiers, with management also holding `approve_access` (a second management member's OK for access changes). Decision 11 removed that power, so management here holds two powers, not three, and nothing stops one management member alone from changing who is on the list (§8.3 says what that accepts).

**What people notice.** Nothing on day one for anyone. Later, a team-only member no longer sees the People screen.

**Which capabilities are management-only.** `manage_people` and `action_deletion_request`. Everything else a team member holds, they keep. §6.2 has the whole catalogue.

**The word in the database.** The value stored is `management`. The record of who said what (`observations.role_at_time`) already reserves the word `admin` for the same idea, and nothing has ever written it. **Proposal:** rename the reserved `admin` to `management` in the data spine's vocabulary and in the resolver's list of authoritative roles, in the same change that adds the role. Two names for one thing is how a permissions list drifts, and `staff`, `admin` and `management` would be three. (The team's own stored value stays `staff`; on screen it is "the Syros Cats team".) The one place that maps a person's role to what is written on an observation is §10.4.

---

## 6. The capability model

### 6.1 The principle

Every check goes through one function, `can()` in `artifacts/api-server/src/lib/capabilities.ts`, and every screen and route asks for a capability **by name**. No code asks "is this person a guardian?". `team-access-and-welfare-queue.md` §7.3 set that rule; this section is the list it points at. What is added to that function:

- A person's **roles** are rows (`person_scopes`), and each row says *where* it applies: the whole island, or one colony. Only team and management rows cover the whole island. **A guardian row always names one colony** (§10.1).
- A capability is one of three kinds:
  - **Island-only.** Held only by someone whose row covers the whole island. Using it needs no target.
  - **Placed.** Held by someone for the colonies their rows cover. Using it needs a target, and the target is **never taken from the request**: for a cat, the server looks up the cat's colony from the record (the newest `colony` observation); for a photo, the photo's cat and then that cat's colony; for a feeding site, the site's colony. A cat in no colony can only be touched by island-wide holders. Where a form names a colony (for example, "add a feeding site to this colony"), the server checks that the person holds that colony for that capability; naming a colony she doesn't hold is refused.
  - **Role-wide.** Held by anyone with the role, whatever colony (for instance, picking a cat from anywhere when matching a photo, which uses only blurred positions).
- The catalogue below is **data in code** (a map from role to capability to kind), and a test walks it so the table in this document and the code cannot silently disagree (§15.3).

### 6.2 The catalogue

**This table is the single list of capability names.** The feeding-sites spec (SYC-209), the coat and health spec (SYC-2) and every later spec cite these names and add none of their own; a spec that needs a power not in this table adds a row here first. §6.7 says which row answers each of those specs' needs.

"All" means the whole island. "Own" means the colonies she guards. A dash means no.

**Seeing**

| Capability | What it lets you do | Kind | Team | Management | Guardian |
|---|---|---|---|---|---|
| `view_exact_location` | See exact positions of cats and of private feeding sites, and open a cat's page, photos and feeding sites in scope (§2.2 says exactly what the page shows). Sites in other colonies are absent from the answer, not blurred | Placed | All | All | Own |
| `view_colony_targets` | The colony view and round sheet: unsterilised cats, discovery position, feeding site, directions, last seen (SYC-54) | Placed | All | All | Own |
| `view_needs_a_look` | The "Needs a look" list (§7.1) | Placed | All | All | Own |
| `view_health_notes` | Read team-only health notes on a cat (SYC-2) | Placed | All | All | Own |
| `view_welfare_queue` | The welfare queue, welfare reports and reporters' photographs | Island-only | ✓ | ✓ | — |
| `use_workspace` | See the workspace documents and the shared document password (§6.3) | Island-only | ✓ | ✓ | — |
| `view_guardian_changes` | The "recent guardian changes" list on the team's dashboard: every cat a guardian added to or took out of a colony, and every sterilisation, life-status and colour statement she made, with who and when (§7.4) | Island-only | ✓ | ✓ | — |

**Saying what you saw or know**

| Capability | What it lets you do | Kind | Team | Management | Guardian |
|---|---|---|---|---|---|
| `record_field_check` | Say what you saw of a cat's ear in person, with an optional photo (§7). A guardian's waits for a team member's OK; a team member's is recorded at once as the team's own in-person statement | Placed | All | All | Own |
| `set_life_status` | Street, homed, in care, deceased. A guardian's is limited to *homed*, *in care* and *deceased*, plus putting back the status she herself replaced in the last 30 days (§2.2) | Placed | All | All | Own |
| `set_sterilisation` | Say a cat is, or is not, sterilised. The team's statement is from a record ("from what record?"); a guardian's is her own word, for cats in her own colonies. Makes the cat *Confirmed* at once, recorded with who said it. The team can mark one wrong with its own later statement (§7.2). Vets gain a column when the role exists (SYC-24); an owner's confirmation follows SYC-130 | Placed | All | All | Own |
| `set_appearance` | State, confirm, correct or remove a cat's colour and markings (SYC-2) | Placed | All | All | Own |
| `set_vaccination` | Record a vaccination (SYC-2) | Island-only | ✓ | ✓ | — |
| `add_health_note` | Add a team-only health note to a cat (SYC-2) | Placed | All | All | Own |
| `add_team_note` | Add a note to a welfare report | Island-only | ✓ | ✓ | — |
| `change_report_state` | Move a welfare report between states | Island-only | ✓ | ✓ | — |

**Colonies, cats and feeding sites**

| Capability | What it lets you do | Kind | Team | Management | Guardian |
|---|---|---|---|---|---|
| `assign_cat_to_colony` | Put a cat in a colony, move it, or take it out of one. A guardian does this alone, for her own colonies, with immediate effect and no team OK (§7.4). The target is the colony she is adding to, or the colony she is taking the cat out of; naming a colony she doesn't hold is refused | Placed | All | All | Own |
| `create_colony` | Create a colony | Island-only | ✓ | ✓ | — |
| `edit_colony` | Edit a colony's guardian-name text, notes and centre point (not its name) | Placed | All | All | Own |
| `rename_colony` | Change a colony's name | Island-only | ✓ | ✓ | — |
| `add_feeding_site` | Add a feeding site to a colony. Always private | Placed | All | All | Own |
| `edit_feeding_site` | Rename, re-describe, move, retire or bring back a feeding site. **Cannot change which colony it belongs to** | Placed | All | All | Own |
| `reassign_feeding_site` | Change which colony a feeding site belongs to | Island-only | ✓ | ✓ | — |
| `set_site_public` | Make a feeding site public or private again, and change a public label | Island-only | ✓ | ✓ | — |
| `request_site_public` | Ask the team to make a site in her colony public. Changes nothing by itself (§6.7) | Placed | — | — | Own |
| `review_hand_picks` | Check the "Matched by hand" list for cats in her colonies; she sees a hand-picked sighting's position only at the 250 m-square level | Placed | All | All | Own |
| `match_cat_anywhere` | Pick a cat from anywhere on the island when matching a photo (published positions only). Reserved: see note 3 | Role-wide | ✓ | ✓ | ✓ |
| `rename_cat` | Change a cat's name | Island-only | ✓ | ✓ | — |
| `hide_photo` · `restore_photo` | Take a photo down, put it back | Island-only | ✓ | ✓ | — |

**Deciding, and running the list of people**

| Capability | What it lets you do | Kind | Team | Management | Guardian |
|---|---|---|---|---|---|
| `settle_confirmation` | Approve or decline an item in "Needs an OK" of kind field check or site-public request (§7) | Island-only | ✓ | ✓ | — |
| `approve_access` | Approve or decline an access change (§8.3). **The only capability that can settle one.** Access items are invisible to anyone without it | Island-only | — | ✓ | — |
| `manage_people` | Invite, place, remove, re-admit, sign out everywhere | Island-only | — | ✓ | — |
| `action_deletion_request` | Delete a person's details on a data request | Island-only | — | ✓ | — |

**Notes on the catalogue**

1. Everyone who has accepted can also, without any capability: see their own page and which colonies and roles they hold, change their language, sign out, sign out everywhere, and stop helping (§9).
2. **Guardians deliberately don't get:** the welfare queue; hiding or restoring photos; renaming cats or colonies; making a site public; moving a feeding site between colonies; settling anything. Each is easy to add later as a row here, and none is needed to make guardians useful. The welfare queue holds a reporter's photograph, an exact location and whether they left a way to be contacted; widening it needs its own thought (Question Q2).
3. **`match_cat_anywhere` is reserved.** A guardian takes photos in the public app under its anonymous phone identity; the dashboard has no way to upload a sighting, so there is no screen where she would use this power and no test can exercise it. It stays in the catalogue so the name is settled, and is built together with a dashboard upload of a guardian's own sighting if Syros Cats want one. The "Ask Syros Cats to match it" list stays team-only: it holds tourists' exact sighting positions from anywhere on the island.
4. **Which routes use which capability.** The welfare queue page, the welfare report list and the photo route that serves a reporter's photograph are gated by `view_welfare_queue`. The catalogue photo route is gated by `view_exact_location` with the photo's cat as the target; a hidden photo is served only to a holder of `hide_photo`. The island-wide cat list is `view_exact_location` held island-wide, which no guardian has.

### 6.3 Two doors: the workspace and the dashboard (SYC-222)

One yes from the sign-in page must not open two things at once: the workspace (shared documents, the document password, the lock switches) and the dashboard.

- **The workspace is its own capability, `use_workspace`**, held by staff and management only. Decided through `can()` like everything else; never "has any capability".
- **The dashboard door** is open to an accepted person who holds at least one dashboard capability (`canSomewhere`, §6.4), and to a pending invitee heading for the accept page, who reaches that page and nothing else.
- **The Worker is asked both questions** (§4.5) and issues the workspace session only for the first. A guardian who signs in at `admin.catspotters.com` never gets a workspace session at all, and goes straight to the dashboard.
- **The break-glass row in `admins`** (`team-access-and-welfare-queue.md` §2.7) grants the workspace only.
- The shared document password is changed on the day any person leaves who ever held `use_workspace`. The people screen says so in the "mark as left" confirmation for those people.

### 6.4 Decision 4: how a check answers when nobody names a colony

SYC-222 asks that `can()` called with no colony answer "does she hold this for any colony?". The reason is sound: the sign-in question ("may she in at all?") and the menu ("show the Colony view?") need exactly that answer. **But the same function guards every route.** A route written as `requireTeam("view_exact_location")`, like the welfare queue page and the all-cats list, would then let in a guardian who holds that capability for one colony, and show her the whole island.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ Two functions, plus a team-only capability for the welfare queue.** `can(person, capability, target?)` is **strict**: a placed capability needs a target, and with none it answers "held island-wide?". A separate `canSomewhere(person, capability)` answers "held for any colony?" and is used only for entry and menus. The welfare queue and its photographs have their own island-only capability, `view_welfare_queue`. Guardians are never given island-wide rows (§6.5, §10.1). | A route that forgets its target fails **closed**: the guardian is refused rather than shown everything. The welfare queue is protected twice: by strictness and by a capability nobody outside the team holds. | It departs from the wording in SYC-222 point 3 (same purpose, different shape). Every placed route must say where it applies, which is more to write. |
| **B. One function, as SYC-222 words it.** No target means "any colony". | One function, one answer. | The failure mode is a silent over-grant, discovered only when someone notices a guardian reading the welfare queue. |
| **C. Separate capability names for island and placed** (`view_exact_location_anywhere` and `view_exact_location_here`). | Impossible to confuse. | Twice as many names; every future check picks one and a wrong pick still compiles. |

**Changed after review:** the recommendation is still A, but A on its own was not enough. The review showed that a field helper placed "on all colonies" would hold an island-wide row, pass the strict check, and reach the welfare queue and every reporter's photograph. So A now includes the team-only welfare capability and the rule that guardians never hold an island-wide row. With the volunteer role merged into the team, a field helper is simply on the team.

**What people notice.** Almost nothing, if it works: a guardian sees only her own pages and the occasional polite *"that part is for the team"* page. Under B the thing people would notice is the one nobody should: a guardian seeing the whole island.

**Recommendation: A.** The failure mode of the alternative is silent and the failure mode of this is a refusal. It is also checkable: a test walks **every** route under `/api/team` and `/api/internal`, each with a signed-in person of every role (including a team member, and a guardian on one colony and on several), and compares the result with a table of what that role should get. A route that isn't in the table fails the test, so a new route cannot ship unguarded (the same idea as the test that walks routes with no session, `docs/superpowers/plans/syc-113-pre-launch-gates.md`, test 12a).

**A refusal for a signed-in person is not "sign in again".** Every failure, including "signed in but lacking the capability", gets the same 401 and a redirect to the sign-in page. With guardians that is a trap: a guardian who follows a link to a staff page is sent to sign in, which signs her straight back in and lands her on the same refusal. So: **not signed in** keeps the 401; **signed in but not allowed** gets a quiet 403 page that says *"That part of the dashboard is for the Syros Cats team. Your colonies are here,"* with a link to her home. It reveals only that the page exists, which is no secret.

### 6.5 Decision 8: how far a volunteer sees

**Settled by the merge (Samuel, 12 October 2026).** There is no volunteer role. The people who help with field work are on the Syros Cats team, and the team sees and does the same island-wide, so there is nothing to place and no "all colonies" question. The options below are kept for the record only; none applies.

| Option | What it meant | Benefits | Risks |
|---|---|---|---|
| **A. (earlier recommendation) The colonies they are assigned, one at a time.** | Management placed each field helper on named colonies, one row per colony, never island-wide. | The reach of a new person was as small as the job. | Someone helping on rounds across the island needed many placements, and each new colony needed adding for her. |
| **B. The whole island by default.** | Nothing to set up per field helper. | A field helper could read the position of every unsterilised cat on the island. | |
| **C. Only unsterilised cats, in assigned colonies.** | Smallest possible reach. | | Hid the sterilised cats a helper needs to recognise in order to skip them. |

**What this choice accepts.** The earlier recommendation kept a person who "signed up last week" to the colonies they were placed on. With one team, a new field helper on the team sees every colony island-wide, including the welfare queue and reporters' photographs. The protection is who management chooses to put on the team, and that every action is recorded against a named person (§11).

**What people notice.** A field helper opens the dashboard and sees the whole island, as every team member does. Nobody is added to a colony one by one.

### 6.6 Decision 9: temporary roles, and the guardian's relationship to a colony

A guardian can look after a colony as a regular feeder, as the owner of a cat in it, or as a temporary cover.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ One guardian role. Each placement can carry an optional end date and an optional label** (*feeds*, *owns a cat here*, *covering temporarily*). An end date turns the placement off by itself. The label is for the team's records and the colony page; it changes no capability. | A holiday cover is a placement that ends on the day the regular guardian returns, without anyone remembering to remove her. Simple to explain. | The label can be wrong or out of date. It must never be used to grant anything. |
| **B. No end dates.** Remove by hand. | Simplest. | The colony view stays open to a holiday cover for ever, if nobody remembers. |
| **C. Three roles with different powers.** | Fine-grained. | Nobody has said a temporary carer needs different powers. More tiers than people. |

**What people notice.** A holiday cover's colony simply disappears from her page on the day she's due to stop. The label shows as a small tag on the colony and changes nothing she can do.

**Recommendation: A.** Expiry is checked at the moment of each request, not by a nightly job, so a placement ends at midnight Athens time on its end date even if a job is late. Because nothing runs at expiry, no "expired" event is written; the people screen works out "ended" when it draws the page. Putting a guardian back on a colony she once covered **updates her existing placement** (clears the end date, records who and when, and writes a `roles_changed` event) rather than adding a second row.

### 6.7 What SYC-209 and SYC-2 cite

**Feeding sites and colonies (SYC-209).** Its three working names map onto the catalogue as follows, and its screens cite the catalogue names:

| SYC-209's working name | The catalogue rows it means |
|---|---|
| `manage_feeding_sites` | `add_feeding_site` (placed), `edit_feeding_site` (placed), `reassign_feeding_site` (island-only) |
| `manage_colonies` | `create_colony` (island-only), `edit_colony` (placed), and `rename_colony` for the name |
| `set_cat_colony` | `assign_cat_to_colony` (placed: the team island-wide, a guardian for her own colonies) |
| `view_exact_location`, `set_site_public` | The same names |

Four rules for those screens:

- **A guardian sees only her own colonies' feeding sites.** Other sites are absent from the answer, not approximate. The filter is applied in the query, not on the page.
- **A guardian can add a site only to a colony she holds, and it is always private.** She can retire or bring back a site in her colony. **She cannot change which colony a site belongs to**; that is `reassign_feeding_site`, island-only, because moving a private site into her own colony would let her read its position.
- **No guardian can ever make a site public** (`set_site_public` is island-only): "private by default, public one at a time, by the team" is a safety rule, `team-access-and-welfare-queue.md` §3.2. A guardian who wants a site public uses `request_site_public`, which adds an item of kind *site-public request* to "Needs an OK" for the team to close. It changes nothing by itself.
- **"Unassigned cats near their sites" give a guardian no reach.** Being near a site is not a reason to see a cat's exact position. A guardian who finds a cat of hers adds it to her colony herself, with `assign_cat_to_colony` (§7.4).

**Coat, markings and health (SYC-2).** Its four names are in the catalogue: `set_appearance`, `set_vaccination`, `view_health_notes`, `add_health_note`. Its fifth name, `confirm_appearance`, for its "volunteers can confirm" rule, is **removed**: there is no volunteer role, and a guardian or team member who agrees with a colour uses `set_appearance`. One decision about them is made here (Decision 13, §7.6): a guardian's appearance statement is not queued. The vet role stays reserved (§2.5): when vets exist, `set_vaccination`, `view_health_notes` and `add_health_note` gain a vet column and nothing else changes. Appearance and health are not sterilisation, so nothing in them goes through the field-check queue.

### 6.8 How a cat comes to be "in a colony"

Placed capabilities on a cat depend on the cat's colony, so how a cat gets one matters. A cat joins a colony through a `colony` observation (`cat-record-data-spine.md` §10.5), and the newest one wins. This spec adds only **who may write one**:

- The team writes them directly (`assign_cat_to_colony`), island-wide. The data spine's `colony` observation gains one more value, **"no colony"**, so a cat can be taken out of a colony without putting it in another (§16.5).
- A guardian writes them herself, for her own colonies only (`assign_cat_to_colony`): "add this cat" or "take this cat out". It takes effect at once, with no team OK (§7.4, Decision 6). Nobody else can change a cat's colony.
- Adding a cat that is in another colony **moves it**: a cat has one colony at a time (the newest observation wins). The guardians of the colony the cat leaves see a line on their page that it moved to another colony (not which one).
- A guardian can only name a colony she holds (§6.1). She cannot take a cat out of a colony she doesn't hold.
- Every change is a `colony` observation with her id, so it is in the cat's history, and it appears on the team's "recent guardian changes" list (§7.4).
- A cat in no colony is visible to the placed roles only at the blurred, public level.

---

## 7. The confirmation queue

The ticket calls it one queue. It is really two lists with one job: **turn what guardians see in person into something the team can use, without trusting anyone beyond their part.**

### 7.1 The two lists

| List | What it is | Where it comes from | Who sees it |
|---|---|---|---|
| **Needs a look** | Cats where the record says *Probably sterilised* (the *Likely* level) and one person standing next to the cat would settle it. Sorted by closeness. | **Worked out when asked**, from the record, by the same resolver as everything else. There is no stored list to go stale. | Placed roles, for their colonies; the team for the island |
| **Needs an OK** | Things waiting for one other person to decide. Three kinds: a **field check** (what a guardian or volunteer saw of a cat's ear), a **site-public request**, and an **access change** (an invitation or role change that gives someone more reach, §8.3). | **Stored**, one row per item (§10.3). | Field checks and site-public requests: the team and management (`settle_confirmation`). **Access changes: management only** (`approve_access`). Staff never see them. A guardian sees the outcome of her own items |

Neither list pages anyone. There is no deadline, countdown, assignment or reminder, the same rule as the welfare queue (`team-access-and-welfare-queue.md` §3.1, F1): a list that implies someone is standing by is a promise nobody has made. A row shows how long it has been waiting, once, quietly.

**Sorted by proximity.** "Closest first" means closest to where the person is *now*, so a guardian or team member on a hillside sees the cats on that hillside first. The phone sends its position with the request only if the person agrees; the server uses it to order the list and **does not store or log it** (the request logger redacts it like other location parameters); with no position the list is grouped by colony name. The caller only ever receives cats inside her own scope, so she learns nothing about places she can't already see.

**Why "Likely" and nothing else.** *Probably sterilised* is the case where one look is worth a trapping trip saved or a wrong answer corrected. A cat at *Unknown* is not put in this list, because a missing ear tip is not evidence of anything (`cat-record-data-spine.md` §4.1), and asking a guardian or team member to chase unknowns would send people to places for no reason, which is the exact failure the ear-tip rules exist to prevent.

### 7.2 Decision 5: who can confirm that a cat is sterilised

**Decided (Samuel, 12 October 2026): Syros Cats (the team), vets, cat guardians and cat owners can confirm sterilisation.** A guardian's or owner's statement that a cat is sterilised makes it **Confirmed**, with no team OK. The people who actually know the cat are the best source we have, and holding their word in a queue would put it back on WhatsApp.

**Who counts.**

- **The team** (including management): from a record, as now (`set_sterilisation` asks "from what record?").
- **A cat guardian**, for cats in her own colonies: her own word, one tap, no record asked for.
- **A vet**, when that role exists. Vets are reserved (SYC-24), so this applies from the day a vet can sign in and no earlier.
- **A cat owner**: a resident who has said in the app that a cat lives with them. That is the claim feature, being redesigned in SYC-130 (PR #107). An owner's confirmation follows whatever SYC-130 makes a claim; this spec does not design it and does not add a dashboard door for owners.

**What an ear tip still does not do.** The data spine's rule stands for the ear: a clipped ear is a statement about an ear, not about an operation, and on its own it never makes a cat *Confirmed* (`cat-record-data-spine.md` §4.2). What changes is who may say the other thing, "this cat is sterilised", and have it count as *Confirmed*. That is an amendment to the data spine §4.2 and to `DECISIONS.md` Part 2k (the statement that *Confirmed* comes only from a team record or a vet), listed in §17.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. The field person's word about the ear settles it.** A guardian's in-person "clipped" makes the cat *Confirmed* sterilised. | Fastest. No queue, no backlog. | Treats an ear as an operation, which breaks the data spine's rule that an ear is not an operation. A wrong *Confirmed* means a cat is never put on a trapping list and may have another litter; a wrong *Likely* only costs a wasted trip (€50–60 per cat sterilised is what is at stake each way). |
| **B. The field check is evidence; one team OK makes the cat *Confirmed*.** | Fast for the team: look at a photo, tap. | Needs the data spine's §4.2 and Part 2k amended first. One mistaken tap on a bad photo is a *Confirmed* record, and it sets off the "sterilised" news email, which can't be unsent. |
| **C. (earlier recommendation) The field check is held as evidence; one team OK records it the way "Looks right" does, and the cat stays *Probably sterilised*, shown as "checked in person".** *Confirmed* still comes only from a team record or a vet. | Keeps *Confirmed* meaning one thing. Nothing public changes until the OK. No news email on approval. | A guardian's careful look never makes a cat *Confirmed* on its own; the team still needs a record. |
| **D. Field people can't record sterilisation at all.** They tell the team on WhatsApp. | No new feature. | What guardians know never reaches the record (`add-details-later.md` §2.1). |
| **E. ✅ Decided. The team, vets, guardians and owners can each confirm sterilisation, and their statement makes the cat *Confirmed* at once.** Every confirmation is recorded with who said it. The team can mark one wrong. | The record uses the knowledge of the people closest to the cat, immediately, with no backlog for the team. A cat a guardian has fed for nine years and knows was done is shown as done today. | Amends the data spine and Part 2k. A mistaken or careless confirmation is public straight away (see below). |

**What this choice accepts.** The earlier recommendation (C) kept *Confirmed* for the team's records so that one mistaken word could never set off an email that can't be unsent. Choosing E accepts that:

- **A mistaken confirmation sets off the "sterilised" news email**, to everyone following that cat. That email cannot be unsent.
- **A cat wrongly shown as sterilised may be skipped on a trapping round**, and may have another litter before anyone notices.
- **The mitigation** is a record, not a block: every confirmation is stored with who said it, in what role, for what cat, and when; the team sees it and can mark it wrong with their own later statement (the earlier statement stays in the cat's history). A guardian can also correct her own.

**What people notice.** A guardian opens a cat in her colony, taps *She is sterilised*, and the cat shows *Confirmed sterilised* on her page and in the app straight away. Followers of that cat get the usual news. A team member sees, on the cat's page, *"Confirmed by Eleni, cat guardian, 14 October"*, and a button *This is wrong*. The public sees *Confirmed*, with no name.

**A field check is still a different thing.** A guardian may not know whether a cat was done: she sees a clipped ear on a cat nobody has told her about, or she sees a spotter's "clipped" and thinks it is a torn ear. She records what she saw (a field check, §7.3), and that waits for one team OK and leaves the cat *Probably sterilised*, shown as "checked in person". Saying "she is sterilised" is the statement about the operation; "I looked at her ear" is the statement about the ear. A team member's own field check is recorded at once as the team's in-person statement.

**Both directions of a field check need an OK.** A guardian who looks at a spotter's "clipped" and says "that's a torn ear, not a clip" is also making a statement that moves the answer (it can clear a wrong *Likely*, `cat-record-data-spine.md` §4.5). It goes to the same queue. The team's "that's not a clip" is the statement that clears it.

**What isn't a sterilisation statement.** A guardian saying "she's gone" (deceased), "she's been homed", or "she's with the vet" is a life-status statement. The data spine lets guardians set those directly and reverses them whenever a sighting contradicts them (`cat-record-data-spine.md` §3.2, and its open question 5, recommended yes). These are not queued. They have two safeguards (§2.2): the team sees a list of recent guardian changes, and a cat a guardian marked homed or deceased in the last 30 days stays on the round sheet, flagged *"recently marked homed by the guardian"*, so a guardian who would rather not have her cats trapped cannot quietly remove them from a round.

### 7.3 How an item moves

1. **A field check is written.** A guardian taps *I looked at her ear* on a cat in her colony, chooses *clipped / not clipped / can't tell*, which ear if clipped, and optionally takes a photo. *Can't tell* is kept as a note and creates no item. For the others, if the person is a guardian, the server writes, **in one transaction**, a "Needs an OK" item **and** an `ear_tip` observation marked *seen in person* and *pending*, with `roleAtTime` = `guardian` taken from the signed-in person, never from anything she sends. **If the person is a team member** nothing waits: the server writes the team's own in-person ear-tip statement at once, as "Looks right" does (Part 2k), and no item is created. **The photo is stored on the item, in private storage served only through the team's photo route with a target (the same way welfare-report photos are kept), and is never attached to the observation.** The photo never reaches the public photo route.
2. **Nothing changes in the cat's answer, anywhere, yet.** The resolver, the public count of clipped-tip sightings and the team's *Probably sterilised* review list all ignore an observation that is marked pending. A pending field check can raise nobody's answer, including to *Probably*.
3. **A team member opens the item.** She sees the cat, the field photo, who looked and in what role, the earlier evidence, and three buttons: **Agreed, it's clipped**, **That's not a clip**, **Not enough to say**. If two people have an open field check on the same cat, she sees both together and one decision settles every open field check on that cat that said the same thing; each is still recorded as its own decision.
4. **Her decision writes the team's own statement**, in the same shape and with the same result as "Looks right" on the *Probably sterilised* list (`DECISIONS.md` Part 2k): a team `ear_tip { clipped: true }` with the in-person marker, or an `ear_tip { clipped: false }` that supersedes the earlier answer, both pointing back at the field check. The cat stays *Probably sterilised* (or is cleared, for "not a clip"), and shows *"checked in person"*. **No news email is sent.** "Not enough" closes the item and changes nothing. The item closes with who decided and when.
5. **The guardian sees the outcome** on her next visit: *"Syros Cats agreed with you about Mimi. Thank you."* or *"Syros Cats couldn't tell from this photo."* No push, and no email unless she asked for one (Question Q4).

**The person who made the statement can never settle it.** The database refuses an item where the person who decided is the person who proposed it, and the route checks the capability again when the decision is written, not only when the page was drawn. The first decision wins; a second team member who tapped a moment later sees *"Already decided by Jacky."* An item that becomes pointless (a team member or vet states the answer first) closes itself as *no longer needed*.

**A cap on open items.** A person can have at most 20 open items, one per cat. Asking about a cat that already has an open item of hers does nothing new. Two different people asking about the same cat each get their own item. This stops one enthusiastic guardian swamping the team.

**Team entries stand on their own.** A team or management member already speaks with their own name attached, so their field checks and their `set_sterilisation` are not queued. A guardian's `set_sterilisation` is not queued either (§7.2); only her field check is. The second-person rule is for a guardian's *ear* statement, not for the team.

### 7.4 Decision 6: who decides which cats are in a colony, and which are taken out

**Decided (Samuel, 12 October 2026): option B, a cat guardian decides alone** which cats are in her colonies, adding and taking out, with immediate effect and no team OK. The people who look after the colony know best which cats belong to it, and a wait for the team would send them back to WhatsApp.

A guardian can see exact positions of cats in her colony (§2.2). That is the thing to keep in mind: adding a cat to her colony shows her that cat's exact position.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. (earlier recommendation) She proposes, either way; a team member OKs.** "This cat is one of mine" and "this cat is no longer in my colony" both wait in "Needs an OK". Until it is OK'd she sees a cat she proposed to add only at the public level. | Closes the walk-around-the-island hole and the quiet-removal hole. The team, who know the colonies, confirm in a tap, and notice a cat that might belong in two colonies. | A small wait for a legitimate guardian who has just found a cat of hers the team hadn't recorded. |
| **B. ✅ Decided. She adds and removes directly.** | No wait. The colony is right the moment she knows it. | See "What this choice accepts". A guardian can pull in another guardian's cats by mistake with no one to notice at the time. |
| **C. Only the team ever assigns cats.** | Strictest. | Every new cat in an existing colony needs a message to the team; guardians would go back to WhatsApp, which is the current problem. |

**What this choice accepts.** The earlier recommendation was A because of one hole:

- **Adding a cat shows her its exact position, so a guardian could reveal any cat's location by adding it to her colony.** One at a time she could walk through every cat on the island.
- **Taking a cat out** removes it from the round sheet and from her view, and a cat added from another guardian's colony leaves that guardian's view.
- **The mitigation** is a record, not a block: every change goes in the history (a `colony` observation with her id and the time), and a **"recent guardian changes" list** on the team's dashboard (`view_guardian_changes`) shows the team who added or removed which cat, in which colony, and when, so a pattern is easy to spot.

**What people notice.** A guardian who finds a cat of hers the team hadn't recorded taps *This cat is one of mine* and sees it in her colony straight away. A team member sees the change on the recent guardian changes list, with who made it, and can put the cat back with `assign_cat_to_colony`. The guardian of a colony a cat leaves sees a line that it moved.

### 7.5 What the queue never does

No paging, no escalation, no assignment, no due date, no countdown. No exact position shown to anyone outside their scope. No reporter details. No "approve all" button: each cat is decided on its own photos.

It does not replace the *Probably sterilised* review list that already exists for the team (`cat-record-data-spine.md` §4.5 point 3, `lib/likelyReview.ts`): that list is for the team to check a **tourist's** evidence, and it keeps its two buttons (*looks right* / *that's not a clip*). Guardians add a second source of evidence for the same cats. The cat's page shows both, so nobody decides without seeing both, and an item decided on one list is closed on the other.

### 7.6 Decision 13: what a guardian's statement about colour and markings does

SYC-2 (coat, markings and health) lets someone state, confirm or correct a cat's colour and markings. Colour is also used to help people pick the right cat when matching a photo, so a wrong colour has a small cost. A guardian knows her cats.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ A guardian's statement about her own colony's cats stands directly.** Guardian changes appear in the team's list of recent guardian changes. | Matches SYC-2's wording ("their word is authoritative"). No queue for something low-stakes. Guardians do the work they know best. | A guardian's mistake is public until the team notices; it is easy to reverse and visible in the list. |
| **B. Everything goes through "Needs an OK".** | Nothing changes without a second person. | A lot of queue traffic for low-stakes facts; the team stops reading the queue. |
| **C. Only the team sets colour and markings.** | Simplest. | Guardians' colour knowledge doesn't reach the record. |

**What people notice.** A guardian corrects a cat's colour and sees it change. The team sees the guardian's change in their list.

**Recommendation: A.** Sterilisation is queued because a wrong answer costs a litter. Colour is not.

---

## 8. The people screen: who may invite, and the safeguards

SYC-104 is the screen. This section says what it must allow and what it must refuse.

### 8.1 Who may do what

| Action | Who | Extra rule |
|---|---|---|
| Invite a guardian or volunteer | Management | Placement (colonies) is chosen at the same moment. A guardian or volunteer with no colony is refused by the database (§10.1). More than three colonies is an **access change** (below) |
| Invite staff or management | Management | An **access change**: a second management member must OK it before the invitation is sent |
| Change someone's roles or placements | Management | Never your own. Anything that adds staff or management, or takes a guardian or volunteer past three colonies, is an **access change** |
| Bring someone back | Management | Roles are chosen afresh (§9.4). A return with staff or management roles is an **access change** |
| Resend, withdraw an invitation | Management | One invitation message per person per 24 hours |
| Mark someone as left | Management | Never the last management person (§9.5). Marking a *management* member as left is an **access change** unless they are leaving themselves |
| Sign someone out everywhere | Management, or the person themselves | Signing out a staff or management member sends an email to every other management member (§9.5) |
| See who did what | Management | Ids resolved to names on screen; the history itself holds ids (§11) |
| Stop helping, change my language, sign out | Any accepted person, for themselves | |

**An access change** is the one idea behind every row above that says so: any change that gives someone more reach than a small guardian or volunteer placement, or takes reach away from a manager. It is written as an item of kind *access change* in "Needs an OK". Nothing is granted, sent or removed until it is decided. **Only a management member other than the one who proposed it can decide it, using `approve_access`.** Staff never see these items, not even the invitee's address.

### 8.2 What the screen shows

A list of people with, for each: name, roles in plain words, colonies, and a chip (**Waiting for an OK · Invited · Joined · Expired · Left**). *Expired* is worked out when the page is drawn; nothing writes it. Beneath each, their history (§11). Beside the list: **Invite someone**, and **Joined in the last 7 days** (with the name each person typed on the accept page beside the name the inviter expected). A tab for people who have left, with **Bring back**. Every change records who made it (SYC-104's own requirement); the screen has no free-text box that ends up in an email.

### 8.3 Decision 11: one person alone, or a second pair of eyes, for staff and management

Inviting a guardian gives someone sight of a colony. Inviting a staff member or management person gives sight of the island and, for management, the power to invite.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ A second management member OKs every access change, using a management-only power.** That covers: inviting staff or management; any role change that adds staff or management; bringing someone back with those roles; a guardian or volunteer invitation with more than three colonies; and marking a management member as left. Ordinary guardian and volunteer invitations need no second OK. | The two most powerful roles can't be created, or removed, by one compromised mailbox or one mistake, and can't be OK'd by staff. | With only one management person the system can't make these changes. The `people` command stays for exactly this break-glass case, run by Samuel. |
| **B. Any management member alone, for every role.** | Fastest. | One stolen management session mints unlimited high-access accounts, or removes every other manager. |
| **C. Second OK for every invitation.** | Most careful. | Guardian and volunteer invitations, the common case, all wait for someone: the friction the charity will notice first. |

**Changed after review:** the earlier draft covered only the invitation, and let any staff member give the OK. The review showed three ways round it: staff could OK a management invitation; a role change on an accepted person went straight through; and an invitation could carry wide reach. All three are now closed by the one power, `approve_access`.

**What people notice.** Inviting a guardian is one form and done. Inviting a team member shows *"Waiting for Jacky to OK this"*, and Jacky sees a one-tap item.

**Recommendation: A.** The request appears in "Needs an OK" as an item of kind *access change*, visible only to management other than the one who made it. The invitation message is sent only when it is OK'd; a role change takes effect only then. The item holds the before and after as ids. The first decision wins.

### 8.4 Decision 7: protecting against an invitation to the wrong mailbox

Nothing stops Susan mistyping a letter and inviting a stranger. The sign-in then gets that stranger an accept page.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ Make mistakes unlikely, quiet and visible.** The address is typed twice. The invitation message names no colony and no guardian, only that Syros Cats has invited the person. The accept page leaves the name field **blank** ("type your name as you'd like Syros Cats to see it"), and shows the colonies only after sign-in. The inviter sees the name typed beside the name she expected, in the people screen and in a "joined in the last 7 days" list, and gets an email that says only that the invitation was accepted. Management can withdraw her in one tap. | No extra step for the right person. A mismatch is visible. The damage is limited to the colonies on the invitation (never more than three without a second OK). The mistaken stranger learns nothing private from the message. | There is a window in which a mistaken stranger holds a view of up to three colonies. |
| **B. Hold access until the inviter confirms.** The invitee accepts; her access starts when the inviter taps *Yes, that's Eleni*. | A mistaken stranger sees nothing. | A real guardian waits, perhaps a day, perhaps until Susan next opens the screen. That is the first impression of the whole system for someone who agreed to help. |
| **C. A code the inviter reads out.** The invitation shows a 6-digit code Susan gives her on the phone; the accept page asks for it. | Defeats a mistyped address entirely. | The guardian must have the code, find it and type it in. The people most likely to be put off are the people this system most needs. |

**Changed after review:** the earlier draft's main check did not work. The name field was pre-filled with what Susan typed, so a stranger who tapped *Yes, join* produced exactly the name Susan expected. And the invitation named the colony, which tells a mistaken stranger a guardian's first name and neighbourhood, and stays in their mailbox for ever. The recommendation is still A, but A now means a blank field, a message that names nothing, and a second OK for anything beyond three colonies.

**What people notice.** A: nothing extra for the right person. The inviter sees, next to Eleni's name, what Eleni typed. B: the new guardian sees *"Thanks. Susan will confirm you shortly"* instead of her colony. C: she has to find a six-digit code.

**Recommendation: A for guardians and volunteers.** The blast radius is a few colonies and the inviter sees a mismatch on her screen. Staff and management invitations already get Decision 11's second OK. If Syros Cats would rather have B for guardians, it is a one-line change: a new guardian's placement starts inactive until the inviter's confirmation.

### 8.5 Limits on the invitation path

- **10 invitations per inviter per day**, 1 per address per 24 hours, 30 per IP per hour.
- The message is a closed template in the one send function with a new purpose, `person_invite`. **The caller names a person, not an address**: the function looks the address up itself and refuses unless that person is pending and unexpired, so it can't be used to email an arbitrary stranger. No free text from the inviter goes into it, and it names no colony or guardian.
- The acceptance email to the inviter (`invite_accepted`) is also a closed template. It carries no text the invitee typed: *"Your invitation was accepted. See the people screen."*
- If the mail path is down, the invitation is saved and visible as *Not sent yet*, and sending retries like other mail. **An invitation that failed to send is never shown as sent.**
- Both messages travel on the same transactional identity as sign-in links and welfare mail (not the separate news identity, which has its own quota). They are shed after sign-in links and welfare mail when the quota is tight.

---

## 9. Leaving and re-admitting

This builds on what SYC-76 shipped ("mark people as left", `DECISIONS.md` Part 2k): a person who leaves is **marked as left, not deleted**, so everything they did stays attributed to them through a strict link, and their next request is refused in both systems.

### 9.1 The ways someone stops

| How | Who does it | Effect |
|---|---|---|
| **Marked as left** | Management | Immediately. The person is off the list, their sessions end at their next request |
| **Stops helping herself** | The person, from "My page" | Same effect, recorded as her own choice |
| **A placement ends** (end date, or management removes one colony) | Automatic, or management | Only that placement goes. She stays on the list if she holds anything else |
| **An invitation expires or is withdrawn** | Automatic, or management | The pending person is treated as not on the list |

### 9.2 What happens at once

- `left_at` is set and `session_version` rises, so a stolen or forgotten cookie dies at its next request (as now).
- **Everything they wrote stays**, attributed to them: observations, report state changes, team notes, photo hides, queue decisions, invitations they sent.
- **Field checks they started stay open.** A field check they made waiting in "Needs an OK" is still evidence and can still be decided. It is marked *from someone who has since left*.
- **Invitations and access requests they started are withdrawn.** A person is often marked as left *because* their account was misused, so anything they set in motion while it might have been compromised is not kept. Every pending invitation they sent, and every open access change they proposed, is withdrawn in the same transaction, and management sees a line: *"3 invitations from Susan were withdrawn when she left. Re-send any you still want."*
- **A field check still queued on their phone** (§12) is refused when the phone next connects: the person isn't on the list any more. They can tell the team what they saw.
- **The shared document password** is changed if they held `use_workspace` (§6.3).
- **Their colony placements** are kept on their row as the record of what they held when they left, and ignored by `can()` because they are not on the list. The history entry (§11) also records which roles and colonies they held, in ids.

### 9.3 When a colony changes guardian

Colonies are named "Vaporia — Eleni's" and carry a guardian's name as free text (`colonies.guardian_name`). When a guardian leaves or hands over, the people screen offers: *"Vaporia — Eleni's still has Eleni's name on it. Rename it?"* with `rename_colony`'s screen one tap away. The colony keeps its old name in its name history, so searches and imports still find it (`team-access-and-welfare-queue.md` §3.4). **This is a nudge, not a rule**: nothing renames a colony automatically, because a colony's name is how the team talk about it on the phone.

### 9.4 Bringing someone back

Management finds the person under *Left* and taps **Bring back**. The screen shows what they held and when they left, and asks for roles to be chosen **afresh**: nothing is restored automatically. This is how the existing code already behaves (re-adding a left address clears `left_at`, raises the session version and replaces the roles). New in this spec:

- It is the same flow as a first invitation: `accepted_at` is set back to null, the new placements are written, the person is pending again, gets the invitation message, signs in and **accepts again**. Someone who left a year ago re-reads the four promises before they see a colony.
- It records a `rejoined` event with who brought them back (SYC-213).
- A return with staff or management roles is an access change and needs the second OK (Decision 11).

### 9.5 Guards that stop the charity locking itself out

- **The last management person can't be marked as left, demoted, or sign out everywhere through the screen**, because then nobody could invite anyone. The `people` command (run by Samuel through db-ops) remains the break-glass route. The check and the change run in one transaction that locks the management rows, so two managers marking each other as left at the same moment cannot both succeed; a test runs both at once.
- **One manager alone cannot remove the others.** Marking a management member as left is an access change that needs a second management member (§8.3), unless the person is leaving themselves. Marking any staff or management member as left, or signing them out everywhere, also sends a short email to every other management member, so a stolen management session cannot quietly remove people.
- **You can't change your own roles or mark yourself as left through the management route.** Use "stop helping" (§9.1), which is a different, plainly worded action.

### 9.6 Taking back an invitation

Withdrawing an invitation, or the person saying *No, this isn't for me*, ends the pending state. Because every addition now writes an event with a strict link (SYC-213), a pending person **can never be deleted afterwards**: `removePerson` today only refuses someone with history, and every person will have at least their `added` event. So withdrawal marks the pending person as left, as for anyone else. This leaves a stranger's email address in the table when the invitation went to the wrong mailbox. **Recommendation: SYC-208's anonymising routine runs in the same transaction for a person who never accepted**, replacing the address with its reserved placeholder and the name with "Withdrawn invitation". That belongs in SYC-208's design and is noted there (§16).

### 9.7 Forgetting someone (SYC-208), and two places it must also reach

SYC-208 anonymises a former team member's name and email while keeping the row and every link. Because this spec puts guardians on the list, it adds two places that routine has to reach:

- **`colonies.guardian_name`** and the **colony's own name** (and `colony_name_history`) hold a guardian's first name as free text. Forgetting her without clearing those leaves her name on the map of the island.
- **Free-text notes** on field checks, if the field-check form allows a note (it allows 200 characters, escaped; it is the one free-text box in this feature). The routine blanks a former person's notes or replaces them with "note removed".

Everything else in this spec holds ids, not names (§11), so the audit trail survives anonymising untouched.

A guardian's wish to be forgotten is separate from a spotter's "Delete my data" in the app (F3, SYC-63): the app deletion removes her anonymous *spotting* identity; her *account* is removed by the team through this route. The privacy policy (SYC-66) says both.

---

## 10. How it lands in the data model

Extend what is there. The cat record (observations, colonies, feeding sites) is the data spine's and is **not** changed here, except for the vocabulary note in §10.4.

### 10.1 `people` and `person_scopes`: what changes

`people` (id, email, name, session_version, added_at, added_by, left_at, left_by) gains:

| Column | Type | Meaning |
|---|---|---|
| `accepted_at` | timestamptz, null | When the person tapped *Yes, join*. Null means not accepted. **Set to `added_at` for everyone on the list when this ships.** Set back to null when a person is brought back (§9.4) |
| `invite_sent_at` | timestamptz, null | When the invitation message went out. Null with `accepted_at` null means "waiting for a second OK" |
| `invite_expires_at` | timestamptz, null | 14 days after `invite_sent_at`; null once accepted |
| `language` | text, not null, default `en`, check in (`en`, `el`, `fr`) | For messages and the person's own pages |

**The states a person can be in** are worked out from those columns, in this order, and nothing else:

| State | When |
|---|---|
| **Left** | `left_at` is set. (A withdrawn invitation, a declined one and a person who stopped helping are all *Left*; §9.6) |
| **Joined** | not left, `accepted_at` set |
| **Invited** | not left, not accepted, `invite_sent_at` set, `invite_expires_at` in the future |
| **Expired** | not left, not accepted, `invite_sent_at` set, `invite_expires_at` in the past. Worked out when read; no job runs and no event is written |
| **Waiting for an OK** | not left, not accepted, `invite_sent_at` null |

**Who is "on the list" is two separate questions, with two separate finders:**

- `findAllowedPerson` and `findPersonById` mean **joined and not left**, and only these build the holder `can()` sees. A pending person is never a `CapabilityHolder`, so no placement she has can be read by mistake. This keeps the safe default: anyone not explicitly accepted is off the list.
- `findInvitee` means **invited and not expired**, and is used only by the hand-off, the accept page and the decline route. It returns no placements.

**Accepting is one conditional update:** set `accepted_at` and clear `invite_expires_at` `where accepted_at is null and left_at is null and invite_expires_at > now()`. Withdrawing, declining and expiring use the same kind of guard. Whichever statement runs first wins; the other changes nothing and says so.

`person_scopes` (id, person_id, role, colony_id) gains:

| Column | Type | Meaning |
|---|---|---|
| `reach` | text, not null, check in (`island`, `colony`) | Where this role applies. **No default.** A check requires `reach = 'colony'` exactly when `colony_id` is set |
| `expires_at` | timestamptz, null | When this placement turns itself off (Decision 9) |
| `relationship` | text, null, check in (`feeds`, `owns_here`, `covering`) | A label for the team's records. Grants nothing |
| `granted_by` | text | A person id or `cli:<operator>`; same convention as `added_by` |
| `granted_at` | timestamptz, not null, default now | |

Checks added to the table:

- `role` = `guardian` requires `reach = 'colony'`. A guardian is **never** island-wide. The database refuses the rest, not a code path someone might skip. `volunteer` is not a role value: the people who help in the field are on the team (`staff`), island-wide (Decision 8, settled by the merge).
- `role` in (`staff`, `management`) requires `reach = 'island'`.
- The role list gains `management`.
- The "unique person, role, colony" constraint stays. Putting someone back on a colony she once held updates that row (§6.6).

**Why an explicit `reach` rather than "colony is null means island".** If a guardian row were ever written with the colony left out, "null means island" would quietly turn her into an island-wide viewer. An explicit column and a check make the dangerous mistake impossible instead of merely unlikely.

**The migration must not guess**, and must not fail halfway. §15.2 says how existing rows are set up and what stops it.

**Management for existing team members.** Decision 3 is decided, so the migration adds a `management` row for every real person who holds `staff` and has not left, from a list Samuel has seen and approved first. They then hold exactly what they hold now.

### 10.2 The invitation

No separate invitations table. An invitation is a **pending person** plus their placement rows plus an event. This is what lets removal, "sign out everywhere", expiry and the history work with code that already exists. A returning person is the same: `accepted_at` goes back to null, new placements are written, and she is pending again.

### 10.3 `confirmation_items`

| Column | Type | Meaning |
|---|---|---|
| `id` | serial | |
| `kind` | text, check in (`field_check`, `site_public_request`, `access_change`) | What is being asked |
| `state` | text, check in (`open`, `approved`, `declined`, `no_longer_needed`, `withdrawn`) | |
| `cat_id` | integer, null | For `field_check` |
| `feeding_site_id` | integer, null | For `site_public_request` |
| `subject_person_id` | uuid, null → `people.id`, strict | For `access_change`: the person the change is about |
| `change_kind` | text, null, check in (`invitation`, `roles_change`, `rejoin`, `remove_manager`) | For `access_change` |
| `detail` | jsonb | For `access_change`: roles and colony ids before and after. Ids and role names only |
| `proposed_by` | uuid → `people.id`, strict | Who asked |
| `proposed_at` | timestamptz | |
| `observation_id` | integer, null | The field check's own (pending) observation |
| `photo_key` | text, null | The field check's photo in private storage (§7.3) |
| `decided_by` | uuid, null → `people.id`, strict | |
| `decided_at` | timestamptz, null | |
| `decision_reason` | text, null | One of a fixed list, never free text from the guardian into the cat's page |
| `resulting_observation_id` | integer, null | The team's own statement, if approved |

Checks and indexes:

- `decided_by` is not `proposed_by`; a decided item has both `decided_by` and `decided_at`; an `open` item has neither.
- **Open items are unique by what they are about, and the rule is written so nulls don't defeat it:** a partial unique index per kind. `field_check`: (`kind`, `cat_id`, `proposed_by`). `site_public_request`: (`feeding_site_id`, `proposed_by`). `access_change`: (`subject_person_id`, `change_kind`). Each applies only while `state = 'open'`. So one person has at most one open item per cat, two different people asking about one cat each have their own, and a manager can have many open invitations, each for a different person.
- **Visibility is part of the query, not the page.** Listing "Needs an OK" returns `access_change` rows only to a caller holding `approve_access`; for anyone else those rows are not in the result.
- **The right capability decides the right kind**, checked when the decision is written: `field_check` and `site_public_request` need `settle_confirmation`; `access_change` needs `approve_access`. A staff-only member's attempt to decide an access change is refused.
- Rows are never deleted. The strict links mean nobody who has proposed or decided anything can be hard-deleted, the same rule as for report changes (Decision 7).

### 10.4 What is written on an observation

Small, deliberate changes to the record's vocabulary, all for the data spine's owner to confirm (proposed in §16.5):

- **`roleAtTime`** gains the live value `guardian` (already in the vocabulary, refused by `writeObservation` until now), renames the never-written `admin` to `management`, and retires the never-written `volunteer`: there is no volunteer role. There is **one** list of team roles in code, used by the resolver, the *Probably sterilised* list and the correction routes, replacing the three copies (`resolve.ts`, `likelyReview.ts` via `teamCorrections.ts`, and the hand-written `"staff"` in each correction).
- **Which role is written** is decided by the server from the person and the action: the role under which the capability was granted for that target. A person who is staff and also a guardian, using a staff capability, writes `staff`; using a guardian-only capability on her colony, writes `guardian`. It is never read from the request.
- **`ear_tip` observations may carry two markers:** *seen in person*, and *pending* (waiting for the team's OK, §7.3). The resolver, the public clipped-tip count and the *Probably sterilised* list all ignore a pending observation. The *seen in person* marker changes no rule; it is what the cat's page and the team's screens show as "checked in person".
- **The `colony` observation gains a "no colony" value**, so a cat can leave a colony without joining another (§6.8).
- **Authority grows in one place.** The resolver's list of authoritative roles is team (`staff`), management, vet and, for **sterilisation and for colour and markings only**, `guardian`: a guardian's sterilisation statement about a cat that was in one of her colonies when she made it is authoritative, recorded with `authorityScope` = that colony, and makes the cat *Confirmed* like a team record (§7.2). Her **ear-tip** observation (a field check) is still evidence, and it is the team's reading of it that records an ear-tip statement (§7.3). An owner's authority follows SYC-130. Authority is fixed at the moment of the statement: if the cat later leaves her colony, her earlier statement stays in the history.

### 10.5 What this does not touch

The observation table itself, colonies, feeding sites, the resolver's rules, welfare reports, photo storage, and the mobile app's tables. Deleting a spotter's data (F3) does not touch `people`.

---

## 11. What's audited (SYC-213)

**Principle: every change to who is on the list, or to what they may do, is a row nobody can edit, and it records ids, never names or addresses.** Ids survive anonymising (SYC-208).

### 11.1 `person_events` (SYC-213), extended

SYC-213 specifies an add-only table with kinds `added`, `left`, `rejoined`, `roles_changed`, `signed_out_everywhere`. This spec needs more kinds and asks SYC-213 to land with the fuller list (they cost nothing extra to include at the start and a migration to add later):

| Kind | When | `detail` holds (ids and role names only) |
|---|---|---|
| `invited` | An invitation is created | roles and colony ids intended; language |
| `access_approved` | A second management member OKs an access change (§8.3) | the confirmation item id |
| `invite_sent` · `invite_resent` | The message went out | |
| `invite_withdrawn` | Management withdraws, the person declines, or the person who sent it has left | who, and why |
| `accepted` | The person tapped *Yes, join* | the version of the four promises they accepted |
| `added` | A person is added without an invitation (the `people` command, break-glass) | |
| `roles_changed` | A placement is added, removed or edited | before and after, as role and colony ids |
| `left` | | who (`self`, a person id, `cli:<operator>`), roles and colony ids held at the time |
| `rejoined` | | |
| `signed_out_everywhere` | | by whom |
| `anonymised` | SYC-208 runs | by whom |

`by` is a person id, `self` or `cli:<operator>`. There is no expiry event: an invitation's expiry is worked out when read (§10.1). Each operation in `lib/db/src/people.ts` writes its event **in the same transaction** as the change (SYC-213's test: drop the insert and a test goes red). A database trigger refuses updates and deletes, as for observations.

### 11.2 Everything else that records who

| What | Where it is recorded | Already exists? |
|---|---|---|
| What a person said about a cat | `observations`: author, `roleAtTime`, `authorityScope`, when | Yes |
| Who decided a queue item, and on what basis | `confirmation_items.decided_by`, `resulting_observation_id` | New (§10.3) |
| Who moved a report between states | `report_state_events` | Yes |
| Who hid or restored a photo | `photo_visibility_events` | Yes |
| Who made a feeding site public, and when | `feeding_sites.made_public_by` / `made_public_at` | Yes |
| Who renamed a colony | `colony_name_history.replaced_by` | Yes |

### 11.3 Reading is audited lightly, not row by row

A row for every colony page view would be mostly noise and itself a record of where cats are. Instead: a **counter per person per day** of the things that can carry a whole colony away in one request: **round-sheet downloads and prints, and refreshes of the saved list**. A guardian can only open cats in her own colonies anyway, so counting cat pages would mostly measure her reloading. Management sees a banner when a person's round-sheet count in one day is well above what a colony needs (for example, more than five). It is a prompt to ask a question, not an accusation, and not a block. Counts live in a small table with no cat ids in it (§14, case 8).

Separately, the people screen's **Joined in the last 7 days** list (§8.2) is the check that a new account is the person who was meant. It does not depend on anybody reading an email.

---

## 12. Decision 12: what a phone may keep (SYC-257)

Decision 1 recommends the offline view be a saved web page on `team.catspotters.com`. That recommendation and the feeding-sites spec (SYC-209) disagreed: this spec would keep exact feeding-site positions on a phone for up to a week, while SYC-209 says private positions appear only on the dashboard map, which has no offline copy. This section settles it, in terms SYC-209 can copy.

**The question.** A guardian or team member on a hillside with no signal needs something to work from. Anything saved on a phone can outlive a sign-out, a loss or a departure, and the charity cannot wipe a web page from a distance. What exactly may the phone hold, for how long, and how is it deleted?

**The facts that shape the answer.**

- A web page's saved data is deleted by the page's own script when the page is next opened, or by the browser if it chooses to. A phone that is **never opened again keeps its list until the browser clears it**. On a page saved to the Home Screen that may be never.
- The people who most need this view are the people who are on a hillside with no signal, so "nothing saved" has a real cost.
- A cat's stored position is its discovery position, one reading frozen in time (`cat-record-data-spine.md` §6.6). A better "usual spot" is deferred (SYC-80). Per-sighting positions and times are a disclosure about the tourists who stood there, and never go to a guardian.
- A feeding site is the single most sensitive position the app holds: the data spine's only honest privacy setting for a private site is absence.

| Option | What the phone holds | Benefits | Risks |
|---|---|---|---|
| **A. Nothing saved. A printed or downloaded round sheet only.** | Paper, or a file the person chooses to keep. | The safest: nothing persists in a browser. | Goes stale the moment it is printed. Field checks can't be queued. Not what SYC-54 asked for. A printed sheet is itself a record of exact places, and cannot be deleted at all. |
| **B. Cats' exact positions *and* private feeding sites' exact positions, for 7 days.** (The earlier draft.) | Everything a round needs, including coordinates for each site. | Most useful on a hillside. | A lost phone carries exact coordinates of private feeding sites for up to a week, which contradicts SYC-209's rule that those appear only on the dashboard map. |
| **C. The same as B, for 72 hours.** | As B. | Shorter window. | Still puts private-site coordinates on a phone. |
| **D. ✅ Cats' discovery positions, plus each feeding site's name and a short line of directions written by the team (no site coordinates), for 72 hours.** | For each placed colony: cat name and SYR number, sterilisation answer, last-seen date, discovery position, her usual feeding site, a thumbnail photo, and each feeding site's name with a "how to find it" line. | Enough to find the cats and the places on a round. Exact private-site coordinates stay on the online dashboard map only, as SYC-209 says. A phone that is lost holds less, and for a shorter time. | A guardian needs the team to have written directions. The discovery position of a cat sits close to its feeding site, so a lost phone does still hint at where a site is; D narrows the disclosure, it does not remove it. Seventy-two hours means a volunteer opens the page online the evening before a round to refresh it. |

**What people notice.** D: a guardian opens the saved page the night before, sees her cats and the words describing each feeding place, and on the hillside with no signal sees the same list. Open the page on a Friday, still fine on Saturday and Sunday; the following Monday it asks her to connect and shows no cats. On a map, she can open a site's exact position only when she has signal. A: she prints a list. B: she sees every coordinate but the phone carries them for a week.

**Recommendation: D.** It gives a guardian or team member something to carry, keeps the most sensitive position (the private feeding site) off phones, and makes the window short and honest. If Syros Cats find the directions lines too much to write, C is the next choice; B is not recommended.

### 12.1 Exactly what is kept, and what is never kept

| Kept, for the person's placed colonies only | Never kept on a phone |
|---|---|
| Cat name and SYR number; sterilisation answer with how sure we are; last-seen date; life status; discovery position; the feeding site she is usually found at; a small thumbnail photo (a cat only) | Per-sighting positions or times; welfare reports; reporters' details; hidden photos; other colonies; health notes; team members' names; exact private feeding-site coordinates |
| Each feeding site's name and "how to find it" line | A map of any kind. **The live map does not work offline.** A small fixed map image may be added later; it is not part of this decision |
| The person's own queued field checks (§12.3) | |

### 12.2 For how long, and how it is deleted

| Rule | Why |
|---|---|
| **Valid for 72 hours from the last time the phone was online.** The server stamps each load with its own time and the expiry. The page also remembers the latest phone time it has ever seen: if the phone's clock goes backwards, the list counts as expired. | Winding the phone's clock back cannot make an old list young |
| **Expired means deleted, not hidden.** When the page opens (online or not) and the list is past its time, the saved data is deleted before anything is drawn. The page then shows *"Connect to refresh this list."* | A hidden list can still be read from the phone's storage tools |
| **Each online load re-checks the person.** If she is no longer on the list or no longer holds the placement, the server says so, the page deletes the saved list at once, and the response carries `Clear-Site-Data: "cache", "storage"`. | Removal reaches a phone at its next connection |
| **Sign out deletes it** and sends `Clear-Site-Data`. So does a "sign out everywhere" at the next connection | |
| **`no-store` stays on every response, including the colony data.** The list is saved only by the page's own script, in the page's own storage under the dashboard's origin, never in the public app's storage or under the public catalogue's cache key. | The data spine's rule that exact positions must never share a key with the public cache (`cat-record-data-spine.md` §6.5), and nothing lands in the browser's ordinary web cache where the page's script cannot clear it |
| **The page's script is confined.** A service worker is registered only for the field pages' own path (for example `/api/team/field/`), never for the whole dashboard, so it cannot serve old staff pages after sign-out. Scripts are allowed only by fixed hash: nothing inline, `connect-src 'self'`. Every name drawn into the page is escaped. | Cat names are typed by tourists; a script that could read the list could send every position away |
| **A round sheet, printed or saved as a file, is stamped with the person's name and the date** and says *"These are exact places. Please don't share them."* Downloads and prints are counted per person per day (§11.3). | A person who shares a printout can be asked about it; a stamp is a reminder, not a lock |

**What can't be promised, and is said plainly on the accept page and to Syros Cats (Question Q1):** a phone that is never opened again keeps its saved list until the browser clears it; on a page saved to the Home Screen, that may be never. The charity cannot wipe it from a distance. The design relies on the list being short-lived and on the page deleting it whenever it is opened, not on the browser. The page does **not** nudge people to add it to the Home Screen (the old nudge text is about keeping *spots* safe, and a Home Screen page escapes the one automatic clean-up Safari does). The accept page asks everyone to keep a lock on their phone, and *sign out everywhere* is the first thing to do about a lost phone. Someone determined, holding an unlocked phone and a cable, can read what is on it; that is the residual risk Question Q1 asks Syros Cats to accept.

### 12.3 Field checks made with no signal

- They wait in the page's own queue: up to 20, each with its photo, kept only until sent.
- They are sent on the next connection under the person's signed-in session. If the session or the person is gone, they are **refused** (§9.2); they can tell the team what they saw.
- The date a field check says it was made is limited the way public answers are: no more than 30 days back, never in the future.

### 12.4 What the feeding-sites spec should say (SYC-209)

SYC-209 should change its sentence from "positions only ever appear on the dashboard map" to: **exact positions of private feeding sites appear only on the dashboard map, which has no offline copy. The one saved list a phone may hold (guardians' and the team's, this spec §12) contains each site's name and a line of directions, never its coordinates, for 72 hours. The app's own offline list of public sites (its Decision 8) is unaffected and holds only public sites.** The "how to find it" line is a small text field on the feeding site, written by the team or the guardian of that colony; it is public to no one and is listed with the proposed amendments in §16.5.

**If Decision 1 chooses the app (B)**, every rule above applies to app storage with a distinct cache key, and `cat-record-data-spine.md` §6.5 needs an approved amendment first.

---

## 13. English, Greek and French

Guardians are, in large part, Greek speakers; some team members and guardians will be French or English; the team works mainly in English. The public app is already trilingual (`artifacts/cat-spotter/lib/i18n.ts`). The dashboard is not: every page is English, with dates formatted `en-GB`. This spec makes the pages **guardians use** trilingual, and leaves the pages only the team uses in English for now (Decision 10).

### 13.1 What needs three languages

| Surface | Language is decided by | Notes |
|---|---|---|
| The **invitation message** | The inviter's choice when inviting, saved as the person's language | Wrong language here means the invitation is ignored |
| The **sign-in link message** from the Worker | `people.language`, returned by the allow-list check (§4.5) | The Worker's own message today is English only; this is a change in the other repository |
| The **accept page** and the four promises | Same | The promises are the one piece of text where a mistranslation matters most; see below |
| **My colonies, the colony view, the round sheet, field-check and colony forms, "Needs a look", the outcome lines** | Same; changeable by the person on their own page | |
| The **403 page** ("that part is for the team") | Same | |
| The **"your invitation was accepted" email** to the inviter | The inviter's language (English) | Goes to management, so Decision 10 keeps it English |
| **Role names and the one-sentence description of oneself** (§2.6) | Same | |
| The people screen, "Needs an OK", management and staff pages | English | Decision 10 |
| Dates | The person's language (`el-GR`, `fr-FR`, `en-GB`), Athens time | Existing pages hard-code `en-GB` |

### 13.2 Decision 10: how far the translation goes

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ Everything a guardian sees is en/el/fr; team and management screens stay English.** | The people who may not read English comfortably can use the work; the team's own tools stay cheap to change. | A bounded amount of text to translate and review. | The team's screens remain English-only, which would be a problem if Syros Cats take on a Greek-speaking staff member. The fix then is the same mechanism applied to more pages. |
| **B. Everything en/el/fr.** | Consistent. | Much more text, nearly all of it read by two or three people. Every change to a screen now costs three translations and a review. |
| **C. English only, translated later.** | Fastest. | A Greek guardian is handed an English page and a legal-sounding promise she can't read. The invitation is the first thing she sees; it fails on the first step. |

**What people notice.** A Greek-speaking guardian receives Greek from the first message to the last. A team member sees English on the team screens, as now.

**Recommendation: A.**

### 13.3 How the words get made and checked

- **One string catalogue for the dashboard on the server**, with the same shape and key-parity test as the app's (`lib/__tests__/i18n.test.ts`): every key in every language, none empty. A missing key fails the build, not the page.
- **Machine-drafted first, then a named local reviewer.** The same process as SYC-4 for the app's strings: Fair Shake drafts Greek and French, and a local speaker confirms them. This spec needs a **named reviewer and a date**, and the invitation and accept page do not go live in a language until that reviewer has signed it off. English alone may go first.
- **The agreed word for the role is "cat guardian"**, and the term already settled for the app in all three languages (SYC-156) is the one to use; this spec does not invent a second Greek or French word for it. *Spotter* is the word for everyone using the public app (Q7, decided).
- **Names are never translated or transliterated.** A Greek name is stored and shown as typed. A person's name field accepts any letters, and email addresses are lower-cased the same way in the database and in code (a test uses a Greek local part, because lower-casing Greek capitals can differ between Postgres and JavaScript, the same trap SYC-101 found for cat names).

### 13.4 The four promises, and why they get extra care

They are short on purpose, and each is written to be read aloud on the phone by the person doing the inviting. Syros Cats review the English words; the Greek and French versions are checked by the named local reviewer against the English **and read back to Syros Cats**, because "I will keep the exact places of cats to myself" is the sentence a guardian is trusted on. Which version of the promises a person accepted is recorded with the acceptance (§11.1), so wording can be improved later without losing what earlier people agreed to.

---

## 14. Security and abuse cases

| # | Case | What stops it, or what we accept |
|---|---|---|
| **1** | **An invitation goes to a mistyped address belonging to a stranger.** | Address typed twice; the message names no colony and no guardian and holds no secret; the accept page's name field is blank and the inviter sees what was typed beside what she expected, in the people screen and the "joined in the last 7 days" list; she gets a plain "accepted" email with no typed text; 14-day expiry; one-tap withdrawal. **Blast radius: the colonies on the invitation, never more than three without a second management OK (Decision 11).** A wrongly invited stranger's address is anonymised on withdrawal (§9.6). |
| **2** | **The invitation message is used for phishing, or to mail-bomb a stranger.** | A closed template; no inviter free text; escaped, length-limited names; the caller names a person, not an address; per-inviter, per-address and per-IP limits; counted in the mail budget (§8.5). |
| **3** | **A management session is stolen and used to make accounts or remove people.** | Every access change (staff or management invitations, role changes that add them, rejoins, invitations over three colonies, removing a manager) needs a second management member, using `approve_access`, which staff do not hold and cannot see. Guardian invitations are limited to 10 a day per inviter, appear at once on the people screen, and can each be withdrawn in a tap. Marking a staff or management member as left, or signing them out everywhere, emails every other management member. A stolen session is ended with *sign out everywhere*. |
| **4** | **Someone grants themselves more.** | Role changes to your own row are refused; anything that adds staff or management is an access change that needs a second management member; every grant records who made it (`granted_by`) and writes a `roles_changed` event. The database refuses a guardian placement with no colony, and refuses an island-wide row for a guardian. |
| **5** | **Approving your own item**, including from a second account. | The database refuses `decided_by = proposed_by`. **A person with two accounts (two addresses) is not something software can detect.** The control is social: one row per human, management knows its people, and the people screen shows every address. Accepted. |
| **6** | **A guardian reads cats outside her colonies**, by adding them to her colony. | **Accepted (Decision 6).** Adding a cat shows her its exact position, so a guardian could reveal any cat's location this way. Every change is a `colony` observation with her id, so it is in the history, and the team's "recent guardian changes" list shows who added or removed which cat and when. Her reach is still read from the record at each request, never from the request, and she can only add to a colony she holds. |
| **7** | **Access changes lag behind decisions.** | Placements and the person's standing are re-read on every request; a placement's end date is checked at request time; `session_version` kills sessions at the next request; saved colony lists on phones expire in 72 hours and are deleted when the page next opens or the server says the person is gone (§12). A phone that is never opened again is the one gap, stated on the accept page and put to Syros Cats (Q1). |
| **8** | **A trusted guardian shares exact places.** | Not preventable by software; she is trusted with those places because it is her job. The controls are the promises (read, accepted and recorded), reach limited to her colonies, round sheets stamped with her name, and a per-person count of round-sheet downloads that prompts a question (§11.3). **This is the residual risk of giving anyone exact positions at all**, in the same family as the colony-averaging disclosure that `DECISIONS.md` F2 asks Syros Cats to accept; it is put to Syros Cats in the same plain words and recorded (Question Q1). |
| **9** | **A phone is lost or shared.** | A lock on the phone is asked for; the saved list lasts 72 hours and holds no private-site coordinates (Decision 12); sign out everywhere ends the session at the next connection; a family member using the phone sees her colony until she signs out, which is accepted, with *Sign out* always one tap away. Sessions stay thirty days: shortening them for older, less technical guardians would trade a small risk for a daily failure. |
| **10** | **A departed person's phone still holds their last list.** | §9.2 and §12: the list is deleted the next time the page opens, and a list is useless after 72 hours when it is next opened. A phone that never reconnects keeps it until the browser clears it. |
| **11** | **The changeover gives a guardian the workspace** (the Worker deployed today treats any yes as the workspace). | The allow-list answers the old request shape with yes only for people who hold the workspace door; the new Worker sends a version marker (§4.5). Until it ships, guardians cannot sign in; they can't be locked into something unsafe. A test pins this: *a guardian's address gets `allowed: false` from the old request shape*. |
| **12** | **A guardian floods the team with field checks.** | Twenty open items per person; one per cat per person; items can be declined in a tap; nobody is paged. |
| **13** | **The people screen or the allow-list is used to learn who has access.** | The allow-list check stays bearer-token only and answers identically for "unknown", "left", "expired" and "no door". The sign-in page still says the same thing for every address. The people screen is behind `manage_people`. |
| **14** | **Forged or replayed accept, decide or leave requests.** | Every form POST goes through the existing Origin check (`requireOrigin`) and a fresh session lookup; an item can be decided once (a conditional update, like report states); *accept* can be pressed twice without effect. |
| **15** | **The charity locks itself out** (the last management person leaves, or a mail outage blocks sign-in). | The last-management guard (§9.5); the `people` command via db-ops as break-glass (Samuel); the workspace break-glass row in `admins`. A mail outage still blocks sign-in for everyone, as the team-access spec already accepts, until Google sign-in (SYC-26) adds a second door. |
| **16** | **A stranger asks to be made a guardian** (email, in person, in a convincing story). | There is no self-service route, deliberately. A request is a person asking the team, who know their colonies. Nothing in the app invites anyone to apply, so there is nothing to automate or abuse. |
| **17** | **A guardian reaches an island-wide page** (the welfare queue, a reporter's photograph, the all-cats list). | Guardians never hold an island-wide row (database check). The welfare queue and its photographs need `view_welfare_queue`, which only the team (including management) holds. A strict `can()` refuses a placed capability asked for with no target. The route walk includes a guardian on one colony and on several. |
| **18** | **A field check is a lie, or a mistake, and a busy approver taps Yes.** | A field check changes nothing public until approved; approval records "checked in person" and leaves the cat *Probably sterilised*; no news email is sent on approval. A wrong approval is therefore a wrong *Probably*, which costs a wasted trip, not a missed litter. |
| **21** | **A guardian (or, later, an owner or vet) confirms a cat as sterilised by mistake, or untruthfully.** | **Accepted (Decision 5).** The cat becomes *Confirmed* at once and the "sterilised" news email goes out; it can't be unsent, and a cat wrongly shown as sterilised may be skipped on a trapping round. Every confirmation is stored with who said it, their role and the date; the team sees it on the cat's page and can mark it wrong with its own later statement; the earlier statement stays in the history. A guardian can only confirm cats in her own colonies. |
| **19** | **The phone's clock is wound back to keep an old list alive.** | The page remembers the latest time it has seen and treats a clock that goes backwards as expired; the server stamps each list with its own time. |
| **20** | **A guardian reads a private feeding site by moving it into her own colony.** | `edit_feeding_site` cannot change a site's colony; `reassign_feeding_site` is island-only. |

---

## 15. Technical notes

*For whoever implements it. Everything above is the product; this is the wiring.*

### 15.1 Where the code changes

- `lib/db/src/schema/people.ts`: the new columns and checks (§10.1), `management` in `PERSON_ROLES`, `confirmationItemsTable`.
- `lib/db/src/people.ts`: `addPerson`, `markLeft`, `signOutEverywhere`. The two existing finders keep meaning "joined and not left"; a new `findInvitee` serves the hand-off and accept page only (§10.1). New: `invitePerson`, `acceptInvitation`, `withdrawInvitation`, `setRoles`, `rejoinPerson`, each writing its `person_events` row in the same transaction (SYC-213). `removePerson` (hard delete) is retired for anyone with an event, which is everyone (§9.6, §16 finding S6).
- `artifacts/api-server/src/lib/capabilities.ts`: the role-to-capability map (§6.2), `can()` strict with an optional target, `canSomewhere()`, `actingRole()` (§10.4), expiry filtering. `teamCorrections.ts`' `capabilityFor` gains the new kinds. `mayEnter()` stays for the dashboard door; `mayUseWorkspace()` is new.
- `middlewares/requireTeam.ts`: takes an optional target resolver for placed routes; `requireInvitee` for the accept page; a signed-in refusal that is a 403 page, not the 401 (§6.4).
- `routes/internal.ts`: `POST /api/internal/people/allowed` returns `doors` and `language`; old request shape handled as in §4.5.
- `routes/team.ts` (the welfare queue page), `routes/teamReports.ts` (the report list and the reporter-photo route) move to `view_welfare_queue`; `routes/teamCats.ts` and the catalogue-photo route ask for `view_exact_location` with a target; the hand-off allows a pending invitee to reach the accept page and nothing else.
- New dashboard routes under `/api/team`: `people` (list, invite, resend, withdraw, roles, leave, rejoin, sign-out), `accept` and `decline`, `me/language`, `me/leave`, `colonies` (mine), `colonies/:id/targets`, `needs-a-look`, `needs-an-ok`, `field-checks`, `colonies/:id/cats` (add or take out a cat), `guardian-changes`, `site-public-requests`, `confirmations/:id/decide` (settled by `settle_confirmation` or, for access changes, `approve_access`), and the `/api/team/field/` pages for the saved list. These are server-drawn pages and forms like the others (Part 2k); the JSON ones used by the saved colony page are added to the OpenAPI file and the generated clients.
- `lib/mail/send.ts`: purposes `person_invite` and `invite_accepted` (closed templates, person id in, address looked up inside; transactional identity).
- `lib/db/src/people/cli.ts` and the db-ops `people-*` commands: `add` takes `--colony` (required for guardian), `--language`, and `--accepted` for break-glass staff seeding; `list` shows ids and placements only, never addresses.
- `lib/teamPages` and a new server-side string catalogue (§13.3).

### 15.2 The migration

One migration, named for what it does, generated after rebasing on the latest `main` and numbered then, never by hand; the number is the next free one at merge time (`0012` is taken by SYC-63, and others are queued). **Order of work:** SYC-213's migration (`person_events`, with its backfilled `added` events) lands first; then this one; then the code that reads what it adds. This migration touches no cat data, and does not create `person_events`.

The steps, in order, inside one transaction, **stopping with a list and changing nothing** if any check fails:

1. **Check for the old reserved word.** Count `observations` rows with `role_at_time = 'admin'` (`writeObservation` has always accepted that word). The count must be zero before `admin` is renamed to `management` in the vocabulary; if it isn't, stop and show the rows.
2. **Set `reach` from the data before adding any check.** For each existing `person_scopes` row, `reach` is `colony` when `colony_id` is set and `island` when it is null. The column is added nullable, filled, then made `not null` with no default.
3. **List and stop on every row that would break a new check**, not only some: a `guardian` row with no colony, or any row whose role is `volunteer` (the value is retired); a `staff` row with a colony (the `people` command allows one); anything else the checks refuse. A person decides what each means, and the migration is run again.
4. **Add the checks and the `management` role value**, and the `people` columns. Set `accepted_at = added_at` for every person already on the list, so nobody is suddenly "pending".
5. **Add `management` rows** for the real people who hold `staff` and have not left. **Show Samuel that list before the migration runs**; test and seed accounts are not carried over.
6. Create `confirmation_items` and its indexes.

The `people` command's `--role guardian` option is changed to require `--colony` at the same time, and `--role volunteer` is removed (§15.1).

### 15.3 Tests that must exist

Named here so they appear in the implementation plan:

1. **The route walk.** Every `/api/team/*` and `/api/internal/*` route, called by a signed-in person of each kind (team, management, guardian on one colony, guardian on several, pending invitee, left person, someone with no scopes), returns exactly what a table says. A route missing from the table fails (§6.4, SYC-222 point 4). The table includes the welfare queue page, the welfare report list, the report-photo route and the catalogue-photo route.
2. A **guardian who may enter but lacks a capability** gets the 403 page, not the sign-in page, on each capability-gated route.
3. **A guardian on every current colony cannot reach the welfare queue, a reporter's photograph, or the all-cats list**, and a database insert of a guardian row with `reach = 'island'` is refused, as is any row with the retired role `volunteer`.
4. **A guardian's view of a cat outside her colony is the public view**, field by field, for every route that returns a cat; a cat with no colony is public for her. **Inside her colony, her page contains exactly the fields in §2.2** and none of: welfare entries, hidden photos, team members' names, spotter identities, owner details, team notes, per-sighting positions.
5. **The target is read from the record, not the request:** a request that names her colony but a cat from another gets the other cat's public view; a photo's target is its cat's colony; a request to add a feeding site to a colony she doesn't hold is refused.
6. **An expired placement stops working at the request after its end date**, with no job having run. Re-placing a guardian on a colony she once held updates the existing row.
7. **A guardian's address gets `allowed: false`** from the old request shape and the full answer from the new (§14 case 11); a guardian's `doors.workspace` is false.
8. **Doors:** a staff address gets both doors; a pending invitee gets only the dashboard door; an expired invitation, a left person and an unknown address get identical answers.
9. **A pending invitee's session reaches the accept page and nothing else**, and her placements are never read by `can()`.
10. **Accepting is one conditional update:** run accept and withdraw at the same moment, and also accept after expiry; exactly one outcome wins and the other says so. Rejoining sets `accepted_at` to null.
11. **A field check writes its observation and its item in one transaction**; killing the second write leaves neither. Its photo is stored on the item, never on the observation, and the public photo route refuses it.
12. **A pending field check moves nothing**: the cat's answer, the public clipped-tip count and the *Probably sterilised* list are identical with and without it. Approval writes the team's in-person ear-tip statement and the cat stays *Probably sterilised*; it never becomes *Confirmed*; **no news email is queued**. "Not enough" changes nothing.
12a. **A guardian's sterilisation statement** on a cat in her colony makes it *Confirmed* at once, recorded with her id, `roleAtTime` = `guardian` and `authorityScope` = that colony, and queues the news email exactly once. The same request for a cat outside her colonies, or with no colony, is refused. A team member's later "this is wrong" statement supersedes it and both stay in the history. An ear tip on its own, from anyone, still never makes a cat *Confirmed*. A team member's field check writes the in-person statement at once and creates no item.
13. **The database refuses an item decided by its proposer**, and the route refuses when the decider has lost the capability since the page was drawn.
14. **The first decision wins; the second sees "already decided".**
15. **A staff-only member cannot decide, or even see, an `access_change` item.** A role change that adds staff or management, and a rejoin with staff roles, each write an item and grant nothing until a different management member approves. A guardian invitation with four colonies does the same.
16. **A guardian's colony change is immediate and recorded.** Adding a cat to a colony she holds writes a `colony` observation with her id and the cat then appears on her page; taking it out writes the "no colony" value; naming a colony she doesn't hold is refused; the change appears on the "recent guardian changes" list (`view_guardian_changes`, which a guardian does not hold). Adding a cat that is in another colony moves it and the other colony's guardian sees the line.
17. **A guardian placement with no colony is refused by the database**; so is a staff row with a colony.
18. **The last management person cannot be marked as left, demoted or have their sessions ended through the screen**, including when two managers try at once. Marking a management member as left needs a second manager.
19. **Leaving withdraws** every pending invitation and open access change the person proposed, and emails the other managers when a staff or management member is marked left or signed out.
20. **Withdrawing an invitation** never deletes a row that has an event, and leaves no readable address once SYC-208's routine runs.
21. **Every operation writes exactly one event, in its own transaction** (SYC-213's mutation test, extended to the new kinds).
22. **Invitation mail:** the caller cannot name an address; the text names no colony or guardian; a name containing markup or a link is escaped; limits hold; a failed send is not shown as sent; the acceptance email carries no typed text.
23. **`roleAtTime` is derived on the server:** a guardian cannot write `staff` by sending it; a staff member who is also a guardian writes the role that authorised the action. The one list of team roles is used by the resolver, the review list and the correction routes.
24. **The catalogue test:** the capability map in code equals the table in §6.2 (names, kinds, holders), and every name SYC-209 and SYC-2 cite exists in it.
25. **Key parity** for the dashboard catalogue in all three languages; **a Greek local part** survives lower-casing the same way in database and code.
26. **The saved colony page:** a list is deleted (not merely hidden) on open after 72 hours; a phone clock set backwards counts as expired; the server's refusal deletes the list; sign-out sends `Clear-Site-Data`; the service worker's scope is only the field path; no response on the dashboard loses `no-store`; the saved list never contains a feeding-site coordinate, a per-sighting position or a health note.
27. **The workspace is refused to every role without `use_workspace`**, including with a valid dashboard session.
28. **A guardian's life-status change** is limited to the allowed values plus undoing her own last change within 30 days; a cat she marks homed or deceased stays on the round sheet for 30 days, flagged; dates sent offline are refused if more than 30 days old or in the future.
29. **Migration:** run against a copy of live data; it stops and lists on any row breaking a check, and on any `role_at_time = 'admin'` observation; it leaves existing people with `accepted_at` set.

### 15.4 How it ships, in order

| Slice | What | Visible to whom |
|---|---|---|
| **0. Foundations** | SYC-213 (`person_events`); SYC-222 (doors, strict `can`, 403 page, route walk); the capability catalogue (§6.2) in code with its test, including `view_welfare_queue` on the welfare and report-photo routes; one list of team roles and the `admin` → `management` rename; the migration (§15.2); the Worker's version-2 answer. | **Nobody.** Everyone is staff and management; nothing changes |
| **1. Invitations and "My colonies"** | The invite, accept, withdraw and leave flows; the people screen (SYC-104); a guardian's own page: her colonies, exact positions, feeding sites, life status for her cats; the pages in en/el/fr. | Management, then the first guardians |
| **2. Field checks and the queue** | Field checks, "Needs a look", "Needs an OK", colony changes, site-public requests, and second-OK access changes (`approve_access`). | Guardians and the team |
| **3. The colony view** | SYC-54: the offline saved page, the round sheet, the narrowly scoped script and service worker (§3, §12). | Guardians and the team |
| **4. The small things** | Round-sheet counters and the banner; hand-pick review for guardians once the "Matched by hand" list (SYC-152) exists; the colony-rename nudge. | Management |

Slice 0 must land before any non-staff role holds any capability, as SYC-222 already says. Slices 1 to 3 can each be a separate plan; the plan for slice 1 should come to Samuel after this spec is approved.

---

## 16. Decisions, questions, findings, follow-ups

### 16.1 The decisions Samuel is asked to make

Each is set out in full where it arises; this is the list. Those marked **changed** had their recommendation changed after the adversarial review (the earlier options are kept in the section).

| # | Question | Section | Recommendation |
|---|---|---|---|
| **1** | Where do guardians and volunteers do their work: the dashboard as an installable, partly offline web page, a sign-in inside the app, paper and files only, or the first and last together? | §3 | **The dashboard page, plus a printable round sheet.** The app stays a public reader. Conditions added after review (delete rather than hide, server time, narrow script scope) |
| **2** | How is someone invited: a pending person plus a plain message, a single-use link, Clerk, or open sign-up with approval? | §4.3 | **Pending person plus a plain message.** Builds on the sign-in that exists; the message holds no secret |
| **3** | Split staff and management? | §5 | **Yes, with every current staff member also made management on day one** |
| **4** | How does a permission check answer when no colony is named? | §6.4 | **Strict by default; a separate "anywhere" question for menus and entry; the welfare queue gets its own team-only power; guardians and volunteers never get island-wide rows.** *Changed: the first two parts alone left a hole for a volunteer on all colonies* |
| **5** | What can a guardian's or volunteer's in-person look do to a cat's sterilisation answer? | §7.2 | **Hold it as evidence; one team OK records "checked in person"; the cat stays Probably sterilised; Confirmed only from a team record or vet.** *Changed from "the OK makes it Confirmed", which breaks the data spine* |
| **6** | Who decides which cats are in a colony, and which are taken out? | §7.4 | **The guardian proposes either way, a team member OKs; volunteers cannot propose** |
| **7** | How do we protect against an invitation to the wrong mailbox? | §8.4 | **Make mistakes unlikely, quiet and visible:** blank name field, a message that names no colony, a plain "accepted" email, second OK for more than three colonies. *Changed: the earlier check was switched off by a pre-filled name* |
| **8** | How far does a volunteer see? | §6.5 | **Only the colonies they're assigned, one row per colony, never island-wide.** *Changed from allowing an "all colonies" row* |
| **9** | Temporary guardians and the feeder/owner/carer labels? | §6.6 | **One role; optional end date and label per placement; the label grants nothing** |
| **10** | How far does translation go? | §13.2 | **Everything a guardian or volunteer sees in en/el/fr; management and staff screens stay English** |
| **11** | Do invitations to staff and management need a second management member's OK? | §8.3 | **Yes, and the same for every access change** (role changes that add staff or management, rejoins, invitations over three colonies, removing a manager), settled only by management. Guardian and volunteer invitations of up to three colonies don't. *Changed: widened, and made management-only* |
| **12** | What may a guardian's or volunteer's phone hold with no signal, for how long, and how is it deleted? (Settles SYC-257.) | §12 | **Cats' discovery positions and feeding-site directions in words (no site coordinates), for placed colonies, 72 hours, deleted on next open.** *New* |
| **13** | Do a guardian's colour and markings statements wait for an OK, and what does a volunteer's "yes, that's right" count for? | §7.6 | **A guardian's stands; a volunteer's is evidence only.** *New, from the SYC-2 question on SYC-53* |

### 16.2 Questions for Syros Cats

| # | Question | Why it matters | Our suggestion |
|---|---|---|---|
| **Q1** | **Who is management on the first day, and are they comfortable that a guardian sees the exact positions of cats in her own colony, and that a phone which is lost and never reopened keeps its saved list until the browser clears it?** (The same family of risk as the colony-averaging disclosure in F2; ask together with SYC-67, the F2 acceptance.) | It is the one residual risk software can't remove (§14 case 8, §12.2): trusting people with places. They should hear it in these words and accept it knowingly | Management: the people who are staff now. Put the plain sentence on the accept page and record their acceptance |
| **Q2** | **Should a guardian see welfare reports for cats in her colony?** | She would hear first of a hurt cat on her patch, but the report holds a reporter's photograph and exact location, and showing it widens the circle that holds it | **Not yet.** Revisit when guardians exist and the team has seen how the queue is used |
| **Q3** | **May a guardian mark her own cat as deceased without a team confirmation?** (The data spine's open question 5.) | It's reversible by any later sighting; the data spine recommended yes | **Yes**, with the two safeguards in §2.2 and §7.2 (a feed of recent guardian changes; the cat stays on the round sheet for 30 days, flagged) |
| **Q4** | **Do guardians want an email when the team decides on something they sent?** | A decision in the dashboard is only seen on her next visit | **No email at first.** Quiet, consistent with nothing paging anyone; add a weekly summary if guardians ask |
| **Q5** | **The four promises on the accept page (§4.1): are these the right four, in the right words?** | It is the moment a person is told what they are trusted with | Syros Cats edit the English; a named local reviewer confirms Greek and French |
| **Q6** | **Who is the named local reviewer for the Greek and French of the invitation and promises, and by when?** | Blocks those languages going live (§13.3) | A person, not a role |
| **Q7 (for Samuel, not Syros Cats)** | **Is the role word "spotter" or "spotter and snapper"?** | The accept page, the 403 page and the app copy name the people who use the public app | **Decided (Samuel, 12 October 2026): "spotter" only.** Never "snapper" |
| **Q8** | **Do guardians arrange paid sterilisation through this system?** The team-access spec (§7.2) describes guardians as people authorised to arrange sterilisation the charity pays for (€50–60 per cat). | This spec does not cover it. If yes, a guardian needs a way to ask for a vet appointment that the team approves, and a spending limit; that is a feature of its own | **Not yet.** Treat it as a separate piece of work once guardians exist; strike the sentence from the team-access spec until then (§17.2) |

### 16.3 Self-review against the code (pass 1)

Done by reading the code on `main` on 7 October 2026, before the independent review. Each finding is already folded into the section named.

| # | Finding | Where in the code | Folded into |
|---|---|---|---|
| S1 | **The team's roles are listed in three places** that must agree: `AUTHORITATIVE_ROLES` (`vet`, `staff`, `admin`) in `lib/resolve.ts`, `TEAM_ROLES` (the same three) in `lib/teamCorrections.ts` which `lib/likelyReview.ts` imports. Adding `management` to one and not the others would make a management member's correction non-authoritative with no error | `resolve.ts:132`, `teamCorrections.ts:196` | §5, §10.4 |
| S2 | **`writeObservation` refuses `guardian`, `volunteer` (since retired) and `vet`** on purpose ("unreachable in phase 1"). The list must be opened exactly when the matching routes ship, and the role must come from the signed-in person | `lib/observations.ts:51` | §7.3, §10.4 |
| S3 | **Every correction writes the string `"staff"`** straight into `roleAtTime`, in four places in `teamCorrections.ts` (and twice in `routes/notifications.ts`, the owner-key admin route, which has no signed-in person and is out of scope here). With a second kind of author this must be asked for, not hard-coded | `teamCorrections.ts:101,175,282,373`; `notifications.ts:79,90` | §10.4 |
| S4 | **Island-wide pages are guarded by a capability a guardian would hold for one colony.** `GET /api/team` (the welfare queue) and the cat list and detail routes use `requireTeam("view_exact_location")`. Under SYC-222's wording of `can()` with no target, a guardian holding it for one colony would pass and be shown the whole island | `routes/team.ts:105`, `routes/teamCats.ts:25,42` | §6.4 (the reason for Decision 4) |
| S5 | **A refusal for a signed-in person is the sign-in redirect.** `requireTeam` answers `missing_capability` with the same 401-and-redirect as "not signed in". With guardians this sends her to sign in again and straight back to the refusal | `middlewares/requireTeam.ts` | §6.4 |
| S6 | **`removePerson` stops being usable.** It deletes someone only if they have no history. SYC-213 gives every person an `added` event with a strict link, and this spec adds more, so no one will ever qualify. A withdrawn invitation therefore marks the person as left; for a wrong mailbox the address then needs SYC-208's anonymising | `lib/db/src/people.ts` (`removePerson`) | §9.6, §15.1 |
| S7 | **The hand-off and the allow-list refuse anyone who can't "enter"**, so a pending invitee could not even reach an accept page | `routes/team.ts` hand-off step 6, `routes/internal.ts` | §4.5, §6.3 |
| S8 | **The `people` command accepts `--role guardian` with no colony**, which produces a guardian row that means nothing today and would mean "island-wide" under a careless reading of the new rules | `lib/db/src/people/cli.ts`, `people.ts` `addPerson` | §10.1, §15.1 |
| S9 | **A rejoin keeps the old `added_by` and replaces roles immediately**, with the same session-version bump. Right for the break-glass command; for a returning guardian it must go back through acceptance | `people.ts` `addPerson` | §9.4 |
| S10 | **The dashboard forbids scripts and caching on every response**, so the offline view needs a deliberate, narrow exception | `lib/teamAuth/refuse.ts` `setTeamHeaders` | §3, §12 |
| S11 | **Dashboard pages are English with `en-GB` dates fixed in the page code** | `lib/teamPages/*` | §13 |
| S12 | **The people list has no language and no "accepted" state**, and the Worker's allow-list answer has no way to carry either | `schema/people.ts`, `routes/internal.ts` | §4.5, §10.1 |
| S13 | **`GET /api/team/me` lists capabilities but not where they apply**, which a guardian's own page needs | `routes/team.ts` | §15.1 |
| S14 | **Look-alike letters and dotted addresses in the staff email deny-list are an open ticket (SYC-123).** It matters more once management types the addresses of guardians who may use Gmail-style variants | `ROLE_MAILBOX_LOCAL_PARTS` | §16.4 |

### 16.4 Follow-ups

Filed to Linear (SYC) from this spec, in addition to the comments on the tickets it touches:

- **SYC-251: server-side en/el/fr catalogue for the dashboard**, with key-parity test and per-language dates (§13.3). Blocks slice 1 in Greek and French.
- **SYC-252: one list of team roles, and the `admin` to `management` rename** across the resolver, the correction routes and the data spine's text (§5, §10.4). Slice 0.
- **SYC-253: reading counters and the management banner** for colony views (§11.3, now round-sheet counts). Slice 4.
- **SYC-254: decide whether guardians see welfare reports near their colony** (Q2). Parked until guardians exist.

To file when Samuel approves this spec:

- **A "how to find it" line on feeding sites** (a short text field written by the team or the colony's guardian), which the saved list needs (§12). Belongs with SYC-209.
- **A better "usual spot" for each cat** (SYC-80) is what the colony view really wants; until then it shows the discovery position and the usual feeding site.
- **A dashboard upload of a guardian's own sighting**, if Syros Cats want guardians to match photos themselves; `match_cat_anywhere` waits for it (§6.2, note 3).

Comments, not new tickets: SYC-104 (what the people screen must do: §8), SYC-213 (the fuller list of event kinds, and the `removePerson` conflict: §11.1, §9.6), SYC-222 (strict `can()` and the old-request compatibility rule: §6.4, §4.5), SYC-208 (guardian names in colonies, free-text notes, withdrawn invitations: §9.6, §9.7), SYC-54 (who may open the view, what a phone may keep, the script exception: §3, §12), SYC-209 (the capability names and the offline sentence: §6.7, §12.4), SYC-2 (the capability names and Decision 13: §6.7, §7.6), SYC-257 (settled by Decision 12), SYC-123 (relevance to invitations).

### 16.5 Proposed DECISIONS.md entries

*For Samuel to adopt, edit or reject when he approves this spec. This document does not edit `DECISIONS.md`. If adopted, these become a new Part, to be dated on approval. The amendments they imply to approved documents are listed in §17.*

- **Roles are `staff`, `management`, `guardian`, `volunteer`, and `vet` (reserved, grants nothing).** Management additionally manages people, actions deletion requests and approves access changes. Everyone who is staff when roles go live is also made management. *(Decision 3.)* The observation vocabulary's never-written `admin` is renamed `management`.
- **The capability catalogue in `roles-and-invites.md` §6.2 is the single list of capability names.** Other specs cite it and add none of their own. *(Decision 4, §6.7.)*
- **A person is invited by management, who creates them as pending with their roles; they get a plain message with no secret and no colony in it, sign in as staff do, and accept.** Invitations expire after 14 days. No Clerk, no second sign-in mechanism. *(Decision 2.)*
- **Access changes need a second management member.** Inviting staff or management, any role change adding them, a rejoin with those roles, an invitation over three colonies, and removing a manager are decided only by another management member, using a management-only power staff do not hold. *(Decision 11.)*
- **The workspace documents are their own capability, `use_workspace`, held by staff and management only.** The sign-in check answers two doors, and answers the old request shape with yes only where the workspace is allowed. *(SYC-222 points 1 and 2.)*
- **`can()` is strict; entry and menus use a separate `canSomewhere()`; guardians and volunteers never hold an island-wide row; the welfare queue needs its own team-only capability.** A signed-in person who lacks a capability gets a 403 page, not the sign-in redirect. *(Decision 4. This differs from SYC-222 point 3's wording on purpose.)*
- **A guardian's or volunteer's in-person look at a cat is held as evidence, changes nothing public until one team member's OK, and then records "checked in person"; the cat stays *Probably sterilised*. *Confirmed* comes only from a team record or a vet.** The person who made the statement can never settle it. *(Decision 5.)* This fills the gap `cat-record-data-spine.md` §4.5 calls "the full confirmation queue (still deferred)".
- **Which cats are in a colony is the team's to say; a guardian proposes both adding and removing, and a volunteer cannot propose.** *(Decision 6.)*
- **A guardian does not make a feeding site public, ever, and cannot move a site between colonies.** She can request it; the team decides. *(§6.7.)*
- **Guardians see the exact positions of cats and private feeding sites in their own colonies only; volunteers see those of the colonies they are placed on, one colony at a time.** Both accept the plain-words disclosure (Q1), which Syros Cats record. *(Decisions 6 and 8; F2's family of risk.)*
- **What a phone may keep:** cats' discovery positions and feeding-site directions (no site coordinates), for placed colonies, for 72 hours from the last online load, deleted rather than hidden when the page next opens, with a stated residual risk for a phone never reopened. *(Decision 12, which settles SYC-257.)*
- **A guardian's statement about colour and markings stands; a volunteer's confirmation is evidence only.** *(Decision 13.)*

### 16.6 Review findings

The independent adversarial review of 7 October 2026 ([`reviews/roles-and-invites-review.md`](./reviews/roles-and-invites-review.md)) found three blockers, ten major and six minor problems, a note on canonical wording, and judged all eleven decision recommendations. Every objective finding is fixed in this version. Where the reviewer disagreed with a recommendation, the recommendation changed and the earlier option is kept so Samuel can still choose it. Nothing in the review is left unanswered; the items that need Samuel's judgement are listed at the end.

| # | Finding | Handled | Where |
|---|---|---|---|
| **B1** | A volunteer on "all colonies" reaches the welfare queue and reporters' photos | **Fixed.** Welfare queue has its own team-only capability (`view_welfare_queue`); guardians and volunteers never hold an island-wide row (database check); "all colonies" is one row per colony; route walk includes a volunteer on every colony; the report and photo routes are listed | §6.2, §6.4, §6.5, §10.1, §15.3 tests 1 and 3 |
| **B2** | Approving a field check made a cat *Confirmed*, against the data spine and `DECISIONS.md` Part 2k, and set off emails | **Fixed, recommendation changed.** Approval records "checked in person" and the cat stays *Probably sterilised*; *Confirmed* only from a team record or vet; no news email; the alternative that confirms is kept as option B with its needed amendments | §7.2, §7.3, §10.4, §17 |
| **B3** | The second pair of eyes for staff and management could be got round three ways | **Fixed.** A management-only capability, `approve_access`, settles one item kind, *access change*, covering invitations, role changes, rejoins, wide invitations and removing a manager; staff cannot see them | §6.2, §8.1, §8.3, §10.3 |
| **M1** | Wrong-mailbox check switched off by the pre-filled name; the message leaked a name and place | **Fixed, recommendation reworded.** Blank name field; message names no colony or guardian; acceptance email carries no typed text; invitations over three colonies need a second OK | §4.1, §8.4, §8.5, §14 case 1 |
| **M2** | Nobody defined what a guardian sees on her own cat's page | **Fixed.** Field-by-field table, its own page and serialiser, test extended | §2.2, §15.3 test 4 |
| **M3** | "Usual spots" don't exist; building them would show where tourists walked | **Fixed.** "Usual spot" is the discovery position plus the usual feeding site; per-sighting positions never go to guardians or volunteers; SYC-80 is the real fix; no map offline | §2.3, §12.1 |
| **M4** | The offline list hid rather than deleted, trusted the phone's clock, and had weak script and cache rules | **Fixed, recommendation tightened.** Delete on open; server time and a backwards-clock rule; `no-store` everywhere; `Clear-Site-Data`; service worker on its own path; scripts by hash; honest sentence about a phone never reopened; no Home Screen nudge | §3, §12 |
| **M5** | Any volunteer could remove cats from a colony; a proposal could move a cat out of another's colony | **Fixed.** Removal is also a proposal and is guardian-only; approval screen says what moves; same answer whatever the cat's colony; "no colony" value added | §6.8, §7.4, §10.4 |
| **M6** | Contradicts the data spine, `DECISIONS.md` Part 3, the team-access spec and the SYC-209 spec | **Fixed by listing.** Exact amendments are in §17; the sibling specs' names are reconciled in §6.7; the paid-sterilisation question is Q8 | §6.7, §17 |
| **M7** | A field check moved the public answer before any OK, and its photo's home was unsaid | **Fixed.** Pending observations are ignored by the resolver, the public count and the review list; the photo is held on the item in private storage | §7.3, §10.3, §10.4 |
| **M8** | Departing people's invitations stayed valid; one manager could remove the rest | **Fixed.** Invitations and access requests withdrawn on leaving; managers emailed on removals and sign-outs; removing a manager is an access change | §9.2, §9.5 |
| **M9** | Pending, withdrawn and expired described three ways; the default failed open | **Fixed.** One state table derived from columns; two finders; one conditional update for accept, withdraw and expire; rejoin resets acceptance; the "row is deleted" wording is gone | §4.1, §4.4, §10.1 |
| **M10** | The migration would fail on existing rows | **Fixed.** Steps in order, list-and-stop on every offending row, zero-`admin` check, SYC-213 first, Samuel sees the management list | §15.2 |
| **m1** | Guardian life-status: no undo; could quietly remove cats from a round | **Fixed.** She can put back her own last status within 30 days; recently marked cats stay on the round sheet flagged; offline dates limited | §2.2, §7.2, §12.3 |
| **m2** | "Pick a cat from anywhere" has no screen for a guardian | **Fixed.** Capability reserved until a dashboard upload exists; hand-pick positions blurred for guardians | §6.2 note 3 |
| **m3** | Untestable rules, an event nothing writes, a useless counter | **Fixed.** "Within the hour" and `invite_expired` removed; the counter counts round-sheet downloads; "joined in the last 7 days" list added | §8.2, §11.1, §11.3 |
| **m4** | Two uniqueness rules that didn't fit | **Fixed.** Partial unique indexes per kind; re-placing updates the existing row | §6.6, §10.3 |
| **m5** | Mail details | **Fixed.** Transactional identity; own template for the acceptance email, with no typed text; no Home Screen nudge | §8.5, §12.2 |
| **m6** | Last-manager guard race | **Fixed.** One transaction locks the management rows; a test runs both at once | §9.5, test 18 |
| **m7** | Canonical wording; spotter versus snapper | **Fixed / left for Samuel.** The product sections no longer split "today" from "new". Spotter versus snapper was Q7, now decided: "spotter" only | §1–§5, §16.2 |

**Where the recommendation changed after review** (the earlier options remain, with benefits and risks): Decision 4 (now also needs the welfare capability and no island rows), Decision 5 (option C, not B), Decision 7 (a blank name and a silent message), Decision 8 (one row per colony, never island-wide), Decision 11 (widened to every access change, management-only). Decision 1's recommendation stands with conditions added. Decisions 2, 3, 6, 9 and 10 stand.

**New decisions raised by folding the review:** Decision 12 (what a phone may keep, which settles SYC-257) and Decision 13 (colour and markings statements, from the SYC-2 question on SYC-53).

**Left for Samuel (now all decided, §16.7):** whether Decision 5 should instead let the team's OK make a cat *Confirmed* (it needs an approved amendment first); Decision 12's 72-hour, no-site-coordinates choice; and the questions for Syros Cats in §16.2, including the new Q8.

---

## 17. Proposed amendments to approved specs

This document does not edit any of these. Each is a change Samuel approves with this spec; the owning document is edited then, not before. The numbering follows the owning documents.

### 17.1 `cat-record-data-spine.md`

1. **§6.5 (who sees exact locations).** Add two rows to the table: a **cat guardian** sees exact positions of cats, and of private feeding sites, in her own colonies; a **volunteer** sees exact positions of cats in the colonies she is placed on, and feeding sites online. Both only through dashboard pages. Add a sentence that the saved list on a guardian's or volunteer's phone is a dashboard page with its own storage (`roles-and-invites.md` §12), holds no private feeding-site coordinates and lasts 72 hours. The paragraph "the mobile app is always a public reader" is unchanged. *This is needed whichever way Decision 1 goes.* If the app (option B) were chosen instead, §6.5 would need a stronger amendment first.
2. **§4.2 (the three levels).** With the recommended Decision 5 (option C), **§4.2 is unchanged**; add one sentence under the ladder: an ear tip checked in person and agreed by the team is shown as "checked in person" under *Probably sterilised*. If Samuel chooses option B instead, §4.2's rule "confidence never crosses attributes" needs an explicit exception first.
3. **§10.1 and §10.4 (vocabulary).** Rename the reserved `roleAtTime` value `admin` to `management`; `guardian` and `volunteer` become live values. `ear_tip` observations may carry two markers, *seen in person* and *pending*; the resolver, the public clipped-tip count and the review list ignore a pending observation.
4. **§10.5 (colonies).** The `colony` observation gains a "no colony" value.
5. **§4.5 point 3.** "The full confirmation queue (still deferred)" now points to `roles-and-invites.md` §7.
6. **§3.2 (who can set what).** A guardian may put back the life status she herself replaced in the last 30 days.
7. **§6.7 (feeding sites are absent, not blurred).** Add that a guardian sees only her own colonies' sites and a volunteer the same, filtered in the query.

### 17.2 `team-access-and-welfare-queue.md`

1. **§7.1–7.2 (roles now, roles later).** Replace "one role" and "what is coming" with the five roles (staff, management, guardian, volunteer, reserved vet). Strike "authorised to arrange sterilisation the charity pays for" unless Q8 is answered yes (then add the arranging flow, which this spec does not design).
2. **§7.3 (capabilities).** Replace the list of twelve names with the catalogue in `roles-and-invites.md` §6.2. `view_exact_location` becomes a placed capability; the welfare queue and its photographs move to a new `view_welfare_queue`. "Explicitly not built now: an invitation interface, per-field permissions, approval workflows, or an offline volunteer view" is replaced by a pointer to the roles spec, which specifies them.
3. **§2.7–2.9 (one list of people).** `people` gains the pending state, acceptance, language and the placement columns; the allow-list answer gains two doors and the language, and the old request shape is answered with yes only where the workspace is allowed.
4. **§2 and §8 (the dashboard's refusal).** A signed-in person lacking a capability gets a 403 page, not the sign-in redirect.
5. **§3 (welfare queue).** Its routes are gated by `view_welfare_queue`.

### 17.3 `DECISIONS.md`

1. **Part 3 (ownership).** Split the row "Sign-in, trust boundary, roles" into "Sign-in, trust boundary" (stays with `team-access-and-welfare-queue.md`) and a new row: **"Roles, the capability catalogue, invitations, the confirmation queue, and what a guardian's or volunteer's phone may keep" → `roles-and-invites.md`**. The row "Location blurring… who sees exact positions" stays with the data spine, which gains the §6.5 rows above.
2. **Part 2k.** No change to "Looks right". Add that approval of a field check has the same shape and the same result.
3. **Part 2i (picking a cat by hand).** "Guardians do this in the staff dashboard" is true only once a dashboard sighting upload exists; until then `match_cat_anywhere` is reserved (§6.2 note 3).
4. **A new Part** carrying the entries in §16.5, dated on approval.

### 17.4 The sibling drafts that cite this spec (not yet approved)

1. **Feeding sites and colonies (SYC-209, PR #103).** Cite the catalogue names (§6.7). Change "positions only ever appear on the dashboard map" to the sentence in §12.4. Drop "unassigned cats near their sites" from a guardian's cat-colony power. Say a guardian cannot change a site's colony. Replace its open question about a guardian's request to make a site public with `request_site_public`. Add the "how to find it" field.
2. **Coat, markings and health (SYC-2, PR #104).** Cite the five names (`set_appearance`, `confirm_appearance`, `set_vaccination`, `view_health_notes`, `add_health_note`). State that appearance statements are not queued (Decision 13), and that vets are reserved.
