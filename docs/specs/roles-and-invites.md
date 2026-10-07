# Roles and invites: guardians, volunteers, management and the confirmation queue

**Feature spec · Cat Spotters (Syros)**
**Status:** **Draft for Samuel's approval, 7 October 2026.** Not yet reviewed. An independent adversarial review follows; its findings are folded in before approval (§16).
**Owner:** Samuel
**Covers:** SYC-53 (roles, invitations, the confirmation queue). Written so that SYC-104 (the people screen), SYC-213 (`person_events`), SYC-54 (the volunteer colony view), SYC-222 (workspace documents versus dashboard) and SYC-208 (forgetting a former team member) can each be built from it without a rebuild.
**Builds on:** [`team-access-and-welfare-queue.md`](./team-access-and-welfare-queue.md) §2 (sign-in), §2.7–2.9 (one list of people), §7 (roles later), §8.4 (tables) · [`cat-record-data-spine.md`](./cat-record-data-spine.md) §3.2 (who can set what), §4.5 (fixing a wrong *Likely*), §6.5 (who sees exact locations), §10.1 (observations), §10.5 (colonies and feeding sites) · [`DECISIONS.md`](./DECISIONS.md) Parts 2i, 2k and 3 · the code on `main` as of 7 October 2026 (`lib/db/src/people.ts`, `lib/db/src/schema/people.ts`, `artifacts/api-server/src/lib/capabilities.ts`, `middlewares/requireTeam.ts`, `routes/team.ts`, `routes/internal.ts`).
**Linear:** SYC-53 · SYC-104 · SYC-213 · SYC-54 · SYC-222 · SYC-208 · SYC-188 (done) · SYC-76 (done) · SYC-131 (done) · SYC-209 (will cite §6) · SYC-24 (vets, parked) · SYC-26 (Google sign-in).

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
| The offline volunteer colony view itself (what is on the screen) | SYC-54, to be specified; this document fixes who may open it and what may be kept on a phone |

---

## 1. The short version

Today the Syros Cats team has one kind of person: staff, who can do everything on the dashboard. That was right for a team of two or three. It cannot stay right once the people who actually know the cats are asked in.

This spec adds three more kinds of person, and keeps the public exactly as it is:

- **Cat guardians** who look after a colony. They see *their own* colonies in full: exact positions, feeding sites, which cats are done and which aren't. They can say a cat is homed, in care or has died, say where a cat lives, and tell the team "I've looked at her ear, it is clipped".
- **Volunteers** who help with trapping rounds and field checks. They see the colonies they are assigned and the list that matters on a round: unsterilised cats, where each is usually seen, which feeding site, when last seen. They can tell the team what they found.
- **Management**: the few people at Syros Cats who invite and remove others and make the decisions that affect everyone's access. Everyone who is staff today also becomes management on the day this ships, so nothing they can do today stops; the charity can narrow it later.
- **Spotters and snappers**, everyone using the public app, keep what they have. They never need an account and are never asked for one.

Three ideas hold it together:

1. **Invitation is the only way in, and it reuses the sign-in that already exists.** Management invites a person by their own email address. The person gets a plain message (it contains no secret), signs in the way staff already do, and taps "Yes, join". No second sign-in system, no new kind of link to protect.
2. **What you can see and do depends on where you are placed.** A guardian's powers stop at the edge of her colonies. This is enforced where the data is read, not by hiding buttons.
3. **Anything a field person says that would change a cat's sterilisation answer waits for one team member's OK.** That is the confirmation queue: tourists find the cats, guardians and volunteers look at them, and one tap from the team turns "probably" into "yes". The person who made the statement can never be the person who approves it.

### The one thing that surprised us, stated up front

`cat-record-data-spine.md` §6.5 says the mobile app has no sign-in and never will, so that exact positions never reach a phone that every tourist installs. SYC-54 asks for a volunteer colony view that works offline. Those two cannot both be taken literally. §3 puts the choice to Samuel (Decision 1) and recommends keeping the app as a public reader and making the volunteer view an installable web page on the dashboard's own domain, with a printable round sheet as the fall-back that needs no phone at all. **The rest of this spec is written so it works whichever way Decision 1 goes.**

### The two audiences want the same thing from different angles

A tourist supplies a photograph and attention at the moment it matters. A guardian who has fed the same alley for nine years supplies judgment: which cat this is, whether she was ever done, whether she has gone. A volunteer supplies legs. These needs are **complementary**: this spec is the point where the three meet, so that nobody's contribution is thrown away and nobody has to be trusted with more than their part.

---

## 2. Each role, in plain terms

### 2.1 Spotters and snappers (no account)

Everyone with the app. They sign in to nothing, and that does not change. They see cats at the blurred, 250 m-square level the data spine promises. They add sightings, answer the ear-tip question, add details later to their own sightings, report a cat in trouble, and delete their own data. **Nothing in this spec asks a spotter to do anything differently, and no screen will ever put an account wall in front of one.**

A resident who feeds a cat and has no email address, or no wish for one, stays in this group and loses nothing. When the team wants her word on a cat they record it on her behalf, as a team entry with a note saying whose word it was. This matters: the most valuable guardians on the island are often the least likely to want an account.

### 2.2 Cat guardian

A person who looks after one or more colonies, endorsed by Syros Cats. In plain terms:

| She can | She cannot |
|---|---|
| See, for **her own colonies only**, every cat's exact position, the colony's feeding sites, photos, and each cat's sterilisation answer with how sure we are | See exact positions anywhere else. Other colonies look to her exactly as they look to a tourist |
| Say a cat in her colony is **homed**, **in care** or **has died**, with a short reason | Say a cat is sterilised "for certain". She can say what she saw; the team confirms (§7) |
| Say "I looked at this cat's ear today" with an optional photo (a **field check**) | Rename cats, hide photos, change colony names, or make a feeding site public |
| Add or correct a feeding site in her colony (always private, §6) | Invite or remove anybody |
| Say "this cat is one of mine" for a cat not yet in her colony; the team decides (§7.4) | See the welfare queue, reporters' details, or anyone's data requests |
| Check the **hand picks** in her own colonies, and pick a cat from anywhere on the island when matching a photo (the 30 September decision in `DECISIONS.md` Part 2i) | See the workspace documents and the shared document password |
| Stop being a guardian herself, at any time (§9) | |

A guardian can hold several colonies, and a guardian can also be staff (a team member who guards her own alley). Both are rows, so neither blocks the other.

**What a guardian is *not*:** an owner. A resident who claims a cat in the app (name and home description only) has never needed endorsement and still does not. Guardian is the endorsed, wider version of that relationship, as the health-record design put it (§6.3). The relationship a guardian has with a colony (feeds it, owns a cat in it, covers temporarily) is recorded as a label on the colony, for the team's benefit; it does **not** change what she can do (Decision 9).

### 2.3 Volunteer

A person who helps with field work: trapping rounds, checking ears, counting. Placed on colonies by management (Decision 8). In plain terms:

| They can | They cannot |
|---|---|
| Open the **colony view** for each colony they are assigned: unsterilised cats, where each is usually seen, which feeding site, when last seen | See any colony they aren't assigned |
| Say what they found: "ear is clipped, here is the photo", "not a clip, torn ear" (a **field check**, §7) | Set a cat's life status, rename anything, or touch feeding sites |
| Print or save the **round sheet** for a trapping round | See the welfare queue or anyone's data |
| Stop being a volunteer themselves | Invite anybody |

Volunteers see **less** than guardians on purpose. A guardian is endorsed for particular colonies for as long as she looks after them. A volunteer may have signed up last week.

### 2.4 Staff (the Syros Cats team)

Unchanged from today: the dashboard as it exists, island-wide. Staff work the welfare queue, fix records, rename cats and colonies, make feeding sites public one at a time, and approve field checks (§7). New: staff approve field checks and colony proposals; staff **cannot** manage people (that moves to management, §2.5).

### 2.5 Management

The few people who decide who is on the list. Everything staff can do, plus: invite, place, re-place, remove and re-admit people; sign somebody out everywhere; action data-deletion requests; and approve the invitation of other staff and management (§8.3).

**On the day this ships, everyone who is staff becomes staff and management.** That means no capability anyone holds today is taken away, and management is narrowed afterwards by a person with the right to do it, in the people screen. Samuel decides whether to ship with the split switched on at all (Decision 3).

### 2.6 Vets (reserved, not designed here)

SYC-24 is parked by Syros Cats. The role name `vet` already exists in the database and in the vocabulary of the record; it grants nothing. When it is picked up, a vet is one more row in the capability table (§6) and one more invitation. Nothing here blocks it and nothing here builds it.

### 2.7 What each role is called on screen

Never "role", "scope" or "capability" on screen. Each person sees one sentence about themselves: *"You're a cat guardian for Vaporia — Eleni's and Kato Chora."* Greek and French wording is part of the translation work in §13.

---

## 3. Decision 1: where do guardians and volunteers do their work?

This is the question that decides most of the build, so it comes first.

**The facts.** The dashboard is a plain web page on `team.catspotters.com`, signed in with the cookie the hand-off sets. The mobile app is a public reader with an anonymous device identity and, by design, no sign-in (`cat-record-data-spine.md` §6.5: "there is not going to be one"). SYC-54 wants a colony view that works with no mobile data, and says to reuse the existing offline queue. The old health-record design (§6.2) said "signing in upgrades the phone". Those three sentences disagree.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ The dashboard, made installable and partly offline.** Guardians and volunteers use `team.catspotters.com` on their phone. The colony view and round sheet are pages that can be saved on the home screen and that keep the last list they loaded. The app stays a public reader. | One sign-in, one session, one place their data comes from. The app never holds exact positions, so a tourist's phone cannot leak them. The data spine's rule stays true. | A web page's offline storage is weaker than an app's: the phone may clear it if the page isn't opened for a week (the app already warns about this for spots). The dashboard is "no scripts, for now" (`DECISIONS.md` Part 2k), and an offline view needs a small amount of script, so this one view is an exception to that. Field checks made offline need a small queue of their own in the browser. |
| **B. Sign in inside the app.** A volunteer signs in to the app; the account becomes her identity and the phone credential stays as the session. | The offline machinery is already there. One app to install. | **Reverses a settled rule.** The app is what every tourist installs; with a sign-in, exact positions of cats in a colony would sit in app storage on volunteer phones, in an app whose cache code was written on the promise that exact positions never arrive. A lost phone then carries a map of where the island's unsterilised cats gather. The data spine's own warning (§6.5) is that such a mode "must use a distinct key"; that is doable but is a large new surface, and the app review process now has to consider it. |
| **C. Paper and files only.** The dashboard produces a round sheet (a printable list or a downloaded file), and that is the "offline view". | The safest: nothing sensitive persists on a device the charity does not control. Works with no signal because it is already on the page. | It goes stale the moment it is printed. Field checks can't be queued; the volunteer remembers and enters them later. Not what SYC-54 asked for. |
| **D. Both A and C.** | The round sheet is a by-product of A (it is the same data, printed). | Two things to look after. | None beyond A's. |

**Recommendation: A, with the round sheet from C as part of it (so, D).** It keeps the rule that the app never holds exact positions, keeps one sign-in, and still gives a volunteer something to carry when there is no signal. The browser-storage weakness is real; §12 says how the stored list is limited and expires so that it fails safe rather than silently.

**If B is chosen instead**, §7 to §11 are unchanged (identity, capabilities, invitations, the queue). What changes is §12 and `cat-record-data-spine.md` §6.5, which would need an approved amendment first.

---

## 4. Decision 2: how someone is invited, accepts, and signs in

### 4.1 What the person experiences

1. **Eleni is told.** Susan, in management, has asked her on the phone, and she has said yes. Susan opens the people screen (SYC-104), taps **Invite someone**, types Eleni's own email address and name, chooses **Cat guardian**, picks Vaporia — Eleni's, and chooses the language of the message (Greek). She types the address twice. She taps **Send invitation**.
2. **Eleni gets a plain message**, in Greek, from `Cat Spotters <signin@mail.catspotters.com>`: *"Syros Cats has invited you to help as a cat guardian for Vaporia — Eleni's. To accept, go to admin.catspotters.com, type this address, and tap the link we send you."* It contains **no secret and no link she could be tricked with**; anyone who finds it learns only that an invitation exists.
3. **Eleni signs in** the way staff already do (§2.1 of the team-access spec): she types her address on `admin.catspotters.com`, gets the emailed link, taps it, taps **Yes, sign me in**.
4. **She lands on one page:** *"Susan from Syros Cats invited you as a cat guardian for Vaporia — Eleni's. Here is what you'll be able to see and do. Here is what we ask of you."* Four short promises (below). A name field, pre-filled with what Susan typed, that she can correct. Two buttons: **Yes, join** and **No, this isn't for me.**
5. **She taps Yes, join** and arrives on **My colonies**. From then on she signs in exactly like staff: type address, tap link. Her session lasts thirty days on that phone.

If she taps **No**, the invitation is withdrawn and, since she has no history, her row is deleted. If she does nothing, the invitation stops working after **14 days** (§4.4) and Susan sees "expired" next to her name.

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
| **A. ✅ A pending person row plus a plain invitation message.** Inviting creates the person in a "not yet accepted" state with the roles intended for them. They sign in the usual way. Roles grant nothing until they accept. | Builds on what exists: no new kind of link, no new token. The invitation message holds no secret, so a mail scanner or a forwarded message can do no harm. Expiry, revoke and resend are just changes to a row. Removal, "sign out everywhere" and `session_version` already work. | Two messages arrive (the invitation, then the sign-in link). The sign-in Worker has to say yes to a person who isn't yet accepted, so that she can receive her link; the API decides what she may then do. A mistyped address that belongs to a stranger lets that stranger accept (§14, case 1). |
| **B. A single-use invitation link.** The invitation message carries a token; following it signs her in and accepts. | One message instead of two. Matches the old design's "single-use, tied to an email, expiring". | A new kind of secret in a mailbox, to be protected from mail scanners (the same fix as sign-in links needs, §2.5 of the team-access spec) and from forwarding. The Worker has to redeem it, so a new Worker route in the other repository. A second sign-in mechanism, which §7.3 of the team-access spec rules out ("no second sign-in mechanism gets built for the second role"). |
| **C. Clerk, as the health-record design said.** | Invitations, roles and sessions come ready-made. | A second list of people; two places to remove someone; the dashboard session, the hand-off and the sign-in Worker would all have to be reworked or doubled; a new supplier holding the names and emails of a small charity's volunteers, and a price to confirm (the old design's own open item). It also contradicts the decision already built (D3, F5). |
| **D. Self-service sign-up with approval.** A person asks to join; management approves. | No typing of addresses by management. | An open door on the sign-in page, which today deliberately reveals nothing about who has access. Invitations are the whole point (§7.3: "invitation is the only way in, at every tier"). |

**Recommendation: A.** It is the least new surface. The cost, two messages, is a small friction paid once per person. Wrong-address risk is handled in Decision 7.

### 4.4 Expiry, resend, withdraw

- An invitation is valid for **14 days** from when it is sent. After that the person is treated as not on the list (the Worker answers "no", as for any unknown address) and management sees "expired".
- Management can **resend** (a fresh 14 days; at most one invitation message per person per 24 hours) or **withdraw** (the pending row is deleted; there is no history to keep).
- Fourteen days is long enough for a guardian who checks mail on Sundays and short enough that an invitation to a mistyped address stops being a standing hole.

### 4.5 What the Worker has to learn (and the order it ships in)

`POST /api/internal/people/allowed` today answers one question: yes or no, and for yes the person's id, name and session version. Two things change, both in the sign-in Worker's repository as well as here, and **they must ship in a safe order**:

- The answer gains **two doors**: `{ workspace: bool, dashboard: bool }`, plus the person's language, so the sign-in message can be sent in it. §6.3 explains the split (SYC-222). A person who has been invited but not yet accepted gets `dashboard: true` (so the hand-off can take her to the accept page) and `workspace: false`.
- **Compatibility.** The Worker deployed today reads only `allowed: true` and gives the workspace to everyone for whom it is true. So the API answers the old request shape with `allowed: true` **only for people who hold the workspace door**; the new Worker sends a version marker and receives the full answer. Until the new Worker ships, a guardian simply can't sign in, which fails safe. Nobody gets the shared document password by accident during the changeover.

### 4.6 Signing in later, and the second door

After accepting, a guardian or volunteer signs in exactly as staff do. Google sign-in (SYC-26) is the planned second door; it uses the same list and the same rule ("Google proving who you are is never the same as being let in"), and would help guardians who already live in Gmail. This spec adds nothing to it.

### 4.7 Someone with no email address

No email, no account (§2.1). This is deliberate, not a gap. The team records what she tells them. If a texting-based sign-in is ever wanted (many islanders live in WhatsApp), it is a different door onto the same list and a decision for later; it is not designed here.

---

## 5. Decision 3: should staff and management be two tiers?

Today every person on the list is staff and holds every capability, including adding and removing people and actioning data-deletion requests. That is fine while the list is Samuel, Jacky and a few colleagues. It is a real exposure once the list grows to guardians and volunteers, because **whoever can invite can create a person who sees where cats gather.** The question is whether the power to change the list should sit with everyone on the team or with a few.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ Two tiers, with nothing taken away on day one.** *Staff* do the cat work. *Management* additionally manage people, action deletion requests and approve the invitation of other staff and management. The migration gives every existing staff member both. | The sensitive powers sit with a few named people from the moment the charity chooses. No one loses anything on the day it ships. The people screen (SYC-104) can narrow it later. | One more thing to explain. Until someone is demoted to staff-only, the tier changes nothing in practice. The charity must actually choose who is management, or the split is decoration. |
| **B. One tier, as today.** All staff can invite, place and remove. | Nothing new to explain. | Any team member, or anyone who gets into a team member's mailbox, can create more accounts and widen who can see exact positions. The second-pair-of-eyes rule in §8.3 has no one to be the second pair. |
| **C. Three tiers** (read-only team members as well). | Finer control. | Nobody has asked for it. A system with more tiers than the charity has people is a system the charity stops maintaining. |

**Recommendation: A.** The cost is a label and a migration row; the benefit is that the single most dangerous power (making new accounts) has a short, named list of holders.

**Which capabilities move.** `manage_people` and `action_deletion_request` become management-only. Everything else a staff member holds today they keep. §6.2 has the whole table.

**The word in the database.** The value stored is `management`. The record of who said what (`observations.role_at_time`) already reserves the word `admin` for the same idea, and nothing has ever written it. **Proposal:** rename the reserved `admin` to `management` in the data spine's vocabulary and in the resolver's list of authoritative roles, in the same change that adds the role. Two names for one thing is how a permissions list drifts, and `staff`, `admin` and `management` would be three. The one place that maps a person's role to what is written on an observation is §10.4.

---

## 6. The capability model

### 6.1 The principle, unchanged from the team-access spec

Every check goes through one function, `can()` in `artifacts/api-server/src/lib/capabilities.ts`, and every screen and route asks for a capability **by name**. No code asks "is this person a guardian?". What this spec adds to that function:

- A person's **roles** are rows (`person_scopes`), and each row can say *where* it applies: the whole island, or one colony.
- A capability is one of three kinds:
  - **Island-only.** Held only by someone whose row covers the whole island. Using it needs no target.
  - **Placed.** Held by someone for the colonies their rows cover. Using it needs a target, and the target is **never taken from the request**: for a cat, the server looks up the cat's colony from the record (the newest `colony` observation); for a feeding site, from the site. A cat in no colony can only be touched by island-wide holders.
  - **Role-wide.** Held by anyone with the role, whatever colony (for instance, picking a cat from anywhere when matching a photo, which uses only blurred positions).
- The table below is **data in code** (a map from role to capability to kind), and a test walks it so the table in this document and the code cannot silently disagree.

### 6.2 Who holds what

"All" means the whole island. "Own" means the colonies she guards. "Assigned" means the colonies a volunteer has been placed on. A dash means no.

| Capability | What it lets you do | Kind | Staff | Management | Guardian | Volunteer |
|---|---|---|---|---|---|---|
| `view_exact_location` | See exact positions of cats | Placed | All | All | Own | Assigned |
| `view_colony_targets` | The colony view and round sheet: unsterilised cats, usual spots, feeding site, last seen (SYC-54) | Placed | All | All | Own | Assigned |
| `view_needs_a_look` | The "Needs a look" list (§7) | Placed | All | All | Own | Assigned |
| `record_field_check` | Say what you saw of a cat's ear in person, with an optional photo (§7) | Placed | — (staff use `set_sterilisation`) | — (same) | Own | Assigned |
| `propose_colony_member` | "This cat is one of mine" (§7.4) | Placed (the colony proposed into) | — | — | Own | — |
| `assign_cat_to_colony` | Put a cat in a colony, or take it out | Island-only | ✓ | ✓ | — | — |
| `set_life_status` | Street, homed, in care, deceased. A guardian's is limited to *homed*, *in care* and *deceased* (`cat-record-data-spine.md` §3.2) | Placed | All | All | Own | — |
| `set_sterilisation` | The team's own statement that a cat is, or is not, sterilised | Island-only | ✓ | ✓ | — | — |
| `settle_confirmation` | Approve or decline an item in the queue (§7) | Island-only | ✓ | ✓ | — | — |
| `add_feeding_site` | Add a feeding site (always private) | Placed | All | All | Own | — |
| `edit_feeding_site` | Rename, move or retire a feeding site | Placed | All | All | Own | — |
| `set_site_public` | Make a feeding site public or private again | Island-only | ✓ | ✓ | — | — |
| `review_hand_picks` | Check the "Matched by hand" list | Placed | All | All | Own | — |
| `match_cat_anywhere` | Pick a cat from anywhere on the island when matching a photo (published positions only) | Role-wide | ✓ | ✓ | ✓ | — |
| `rename_cat` | Change a cat's name | Island-only | ✓ | ✓ | — | — |
| `rename_colony` | Change a colony's name | Island-only | ✓ | ✓ | — | — |
| `hide_photo` · `restore_photo` | Take a photo down, put it back | Island-only | ✓ | ✓ | — | — |
| `change_report_state` · `add_team_note` | Work the welfare queue | Island-only | ✓ | ✓ | — | — |
| `manage_people` | Invite, place, remove, re-admit, sign out everywhere | Island-only | — | ✓ | — | — |
| `action_deletion_request` | Delete a person's details on a data request | Island-only | — | ✓ | — | — |
| `use_workspace` | See the workspace documents and the shared document password (§6.3) | Island-only | ✓ | ✓ | — | — |

Everyone who has accepted can also, without any capability: see their own page and which colonies and roles they hold, change their language, sign out, sign out everywhere, and stop helping (§9).

**What guardians deliberately don't get yet.** The welfare queue; hiding or restoring photos; renaming cats. Each is easy to add later as a capability in this table and none is needed to make guardians useful. The welfare queue holds a reporter's photograph, an exact location and whether they left a way to be contacted; widening it needs its own thought (Question Q2 in §16).

### 6.3 Two doors: the workspace and the dashboard (SYC-222)

Today one yes from the sign-in page opens two things: the workspace (shared documents, the document password, the lock switches) and the dashboard. SYC-188 correctly made that yes depend on holding at least one dashboard capability. The moment a guardian holds one, the same rule would let her into the workspace and show her the shared document password. That is not what anyone intends.

- **The workspace is its own capability, `use_workspace`**, held by staff and management only. Decided through `can()` like everything else; not "has any capability".
- **The dashboard door** is open to anyone who holds at least one dashboard capability (what `mayEnter()` decides today) or who is a pending invitee heading for the accept page.
- **The Worker is asked both questions** (§4.5) and issues the workspace session only for the first. A guardian who signs in at `admin.catspotters.com` never gets a workspace session at all, and goes straight to the dashboard.
- **The break-glass row in `admins`** (`team-access-and-welfare-queue.md` §2.7) grants the workspace only, as before.
- The shared document password is changed on the day any person leaves who ever held `use_workspace`. The people screen says so in the "mark as left" confirmation for those people.

### 6.4 Decision 4: how a check answers when nobody names a colony

SYC-222 asks that `can()` called with no colony answer "does she hold this for any colony?". The reason is sound: the sign-in question ("may she in at all?") and the menu ("show the Colony view?") need exactly that answer. **But the same function guards every route.** A route written as `requireTeam("view_exact_location")`, like the welfare queue page and the all-cats list today, would then let in a guardian who holds that capability for one colony, and show her the whole island. This is not hypothetical: `routes/team.ts` and `routes/teamCats.ts` both guard island-wide pages with exactly that call.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ Two functions.** `can(person, capability, target?)` is **strict**: a placed capability needs a target, and with none it answers "held island-wide?". A separate `canSomewhere(person, capability)` answers "held for any colony?" and is used only for entry and menus. | A route that forgets its target fails **closed**: the guardian is refused rather than shown everything. The two questions have two names, so a reader can't confuse them. | It departs from the wording in SYC-222 point 3 (same purpose, different shape). Every placed route must say where it applies, which is more to write. |
| **B. One function, as SYC-222 words it.** No target means "any colony". | One function, one answer. | The failure mode is a silent over-grant, discovered only when someone notices a guardian reading the welfare queue. |
| **C. Separate capability names for island and placed** (`view_exact_location_anywhere` and `view_exact_location_here`). | Impossible to confuse. | Twice as many names; every future check picks one and a wrong pick still compiles. |

**Recommendation: A.** The failure mode of the alternative is silent and the failure mode of this is a refusal. It is also checkable: a test walks **every** route under `/api/team` and `/api/internal`, each with a signed-in person of every role, and compares the result with a table of what that role should get. A route that isn't in the table fails the test, so a new route cannot ship unguarded (the same idea as the test that walks routes with no session, `docs/superpowers/plans/syc-113-pre-launch-gates.md`, test 12a).

**A refusal for a signed-in person is not "sign in again".** Today every failure, including "signed in but lacking the capability", gets the same 401 and a redirect to the sign-in page (`requireTeam.ts` does this for `missing_capability`). With only staff that was harmless. With guardians it is a trap: a guardian who follows a link to a staff page is sent to sign in, which signs her straight back in and lands her on the same refusal. So: **not signed in** keeps today's answer; **signed in but not allowed** gets a quiet 403 page that says *"That part of the dashboard is for the Syros Cats team. Your colonies are here,"* with a link to her home. It reveals only that the page exists, which is no secret.

### 6.5 Decision 8: how far a volunteer sees

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ The colonies they are assigned.** Management places each volunteer on named colonies. Placing someone on "all colonies" is possible, is shown plainly on the people screen, and is a deliberate act. | The reach of a new person is as small as the job. A volunteer who joins for one hillside sees one hillside. | Someone helping on rounds across the island needs many placements, or the "all colonies" one, set by management. |
| **B. The whole island by default.** | Nothing to set up per volunteer. | A volunteer who signed up last week can read the position of every unsterilised cat on the island. That is the most sensitive list the app can make. |
| **C. Only unsterilised cats, in assigned colonies.** | Smallest possible reach. | Hides the sterilised cats a volunteer needs to recognise in order to skip them. The "go and look" list (Likely cats) is by definition not yet confirmed. |

**Recommendation: A.**

### 6.6 Decision 9: temporary roles, and the guardian's relationship to a colony

The old design lists three relationships: feeder, owner, temporary carer.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ One guardian role. Each placement can carry an optional end date and an optional label** (*feeds*, *owns a cat here*, *covering temporarily*). An end date turns the placement off by itself. The label is for the team's records and the colony page; it changes no capability. | A holiday cover is a placement that ends on the day the regular guardian returns, without anyone remembering to remove her. Simple to explain. | The label can be wrong or out of date. It must never be used to grant anything. |
| **B. No end dates.** Remove by hand. | Simplest. | The colony view stays open to a holiday cover for ever, if nobody remembers. |
| **C. Three roles with different powers.** | Fine-grained. | Nobody has said a temporary carer needs different powers. More tiers than people. |

**Recommendation: A.** Expiry is checked at the moment of each request, not by a nightly job, so a placement ends at midnight Athens time on its end date even if a job is late.

### 6.7 What SYC-209 (feeding sites) should cite

Feeding-site screens use exactly these capabilities from §6.2:

- `add_feeding_site` (placed: a guardian may add one in her own colony, always private),
- `edit_feeding_site` (placed),
- `set_site_public` (island-only; **no guardian can ever make a site public**, because "private by default, public one at a time, by the team" is a safety rule, `team-access-and-welfare-queue.md` §3.2),
- `view_exact_location` for seeing the site's position at all.

A guardian can retire a site in her colony. Making one public is always a team step.

### 6.8 How a cat comes to be "in a colony"

Placed capabilities on a cat depend on the cat's colony, so how a cat gets one matters. The data spine already says a cat joins a colony through a `colony` observation (`cat-record-data-spine.md` §10.5), and the newest one wins. This spec adds only **who may write one**:

- The team writes them directly (`assign_cat_to_colony`).
- A guardian can **propose** one for her own colony (`propose_colony_member`), which waits for a team member's OK (§7.4, Decision 6).
- Anyone placed on a colony can say a cat is **no longer in** it; that takes away her own reach, so it needs no approval, but it is recorded and shown to the team.
- A cat in no colony is visible to the placed roles only at the blurred, public level.

---

## 7. The confirmation queue

The ticket calls it one queue. It is really two lists with one job: **turn tourist photos into facts a funder can cite, without trusting anyone beyond their part.**

### 7.1 The two lists

| List | What it is | Where it comes from | Who sees it |
|---|---|---|---|
| **Needs a look** | Cats where the record says *Probably sterilised* (the *Likely* level) and one person standing next to the cat would settle it. Sorted by closeness. | **Worked out when asked**, from the record, by the same resolver as everything else. There is no stored list to go stale. | Placed roles, for their colonies; the team for the island |
| **Needs an OK** | Statements from a guardian or volunteer that would change a cat's sterilisation answer or a colony's membership, and invitations to staff or management, waiting for one team or management member. | **Stored**, one row per item (§10.3). | The team. A guardian sees the outcome of her own items |

Neither list pages anyone. There is no deadline, countdown, assignment or reminder, the same rule as the welfare queue (`team-access-and-welfare-queue.md` §3.1, F1): a list that implies someone is standing by is a promise nobody has made. A row shows how long it has been waiting, once, quietly.

**Sorted by proximity.** "Closest first" means closest to where the person is *now*, so a volunteer on a hillside sees the cats on that hillside first. The phone sends its position with the request only if the person agrees; the server uses it to order the list and **does not store or log it** (the request logger redacts it like other location parameters); with no position the list is grouped by colony name. This respects the data spine's rule that no query lets a caller probe positions: the caller only ever receives cats inside her own scope, so she learns nothing about places she can't already see.

**Why "Likely" and nothing else.** *Probably sterilised* is the case where one look is worth a trapping trip saved or a wrong answer corrected. A cat at *Unknown* is not put in this list, because a missing ear tip is not evidence of anything (`cat-record-data-spine.md` §4.1), and asking a volunteer to chase unknowns would send people to places for no reason, which is the exact failure the ear-tip rules exist to prevent.

### 7.2 Decision 5: what a field check can do to a cat's answer

A guardian or volunteer looks at a cat's ear in person, perhaps with a close photograph. What happens next?

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. The field person's word settles it.** A guardian's or volunteer's in-person "clipped" makes the cat *Confirmed* sterilised. | Fastest. No queue, no backlog. | A new volunteer's mistaken look moves a cat to *Confirmed*. A wrong *Confirmed* means a cat is never put on a trapping list and may have another litter; a wrong *Likely* only costs a wasted trip (€50–60 per cat sterilised is what is at stake each way). The data spine reserves *Confirmed* for the team and vets for exactly this reason. |
| **B. ✅ The field check is recorded straight away, as evidence, and moves the cat only after one team member's OK.** It sits in "Needs an OK" with its photo. "Yes" writes the team's own statement; "Not enough" leaves the field check as evidence only. | Keeps the rule that *Confirmed* comes from the team or a vet. A close, in-person look is far stronger evidence than a tourist's photo and is shown that way to the approver. One tap. | A backlog if the team is busy; the cat stays at *Likely* in the meantime, which is accurate. Adds a step. |
| **C. Field people can't record sterilisation at all.** They tell the team on WhatsApp. | No new feature. | That is the current state: what guardians know never reaches the record (`add-details-later.md` §2.1). |

**Recommendation: B.** It is cheap for the team (look at a photo, tap), keeps *Confirmed* meaning one thing, and makes the guardian's knowledge count.

**Both directions need an OK.** A guardian who looks at a spotter's "clipped" and says "that's a torn ear, not a clip" is also making a statement that moves the answer (it can clear a wrong *Likely*, `cat-record-data-spine.md` §4.5). It goes to the same queue. The team's "that's not a clip" is the statement that clears it.

**What isn't a field check.** A guardian saying "she's gone" (deceased), "she's been homed", or "she's with the vet" is a life-status statement, not a sterilisation one. The data spine lets guardians set those directly and reverses them whenever a sighting contradicts them (`cat-record-data-spine.md` §3.2, and its open question 5, recommended yes). Those are shown to the team as a feed of recent guardian changes, not queued.

### 7.3 How an item moves

1. **A field check is written.** A guardian taps *I looked at her ear* on a cat in her colony, chooses *clipped / not clipped / can't tell*, which ear if clipped, and optionally takes a photo. The server writes an `ear_tip` observation (marked as seen in person, `roleAtTime` = `guardian` or `volunteer`, `authorityScope` = `guardian_of_this_cat` where she guards the cat's colony) **and** a "Needs an OK" item pointing at it, in one transaction. Her role comes from the signed-in person, never from anything she sends.
2. **Nothing changes in the cat's answer yet.** The resolver treats the observation like any other non-authoritative ear-tip answer: it can raise a cat to *Likely* and nothing more.
3. **A team member opens the item.** She sees the cat, the field photo, who looked and in what role, the earlier evidence, and three buttons: **Yes, she's sterilised**, **That's not a clip**, **Not enough to say**.
4. **Her decision writes the team's own statement**, which is what actually moves the answer: a `sterilised: true` observation, or an `ear_tip { clipped: false }` that supersedes the earlier one, both pointing back at the field check. The item closes with who decided and when. "Not enough" closes the item and changes nothing else.
5. **The guardian sees the outcome** on her next visit: *"Syros Cats confirmed Mimi is sterilised. Thank you."* or *"Syros Cats couldn't tell from this photo."* No push, and no email unless she asked for one (Question Q4).

**The person who made the statement can never settle it.** The database refuses an item where the person who decided is the person who proposed it, and the route checks the capability again when the decision is written, not only when the page was drawn. The first decision wins; a second team member who tapped a moment later sees *"Already decided by Jacky."* An item that becomes pointless (a team member or vet states the answer first) closes itself as *no longer needed*.

**A cap on open items.** A person can have at most 20 open items, one per cat. Asking about a cat that already has an open item adds to it rather than making a second. This stops one enthusiastic volunteer swamping the team.

**Staff entries stand on their own.** A staff or management member already speaks with their own name attached, so their `set_sterilisation` is not queued. The second-person rule is for roles with less standing, not for the team.

### 7.4 Decision 6: who decides which cats are in a colony

A guardian can see exact positions of cats in her colony (§2.2). If she could simply add any cat to it, she could read the exact position of any cat on the island by adding them one by one.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ She proposes; a team member OKs.** The proposal waits in "Needs an OK". Until it is OK'd she sees the cat only at the public level. | Closes the walk-around-the-island hole. The team, who know the colonies, confirm in a tap. It also gives them a natural moment to notice a cat that belongs in two colonies. | A small wait for a legitimate guardian who has just found a cat of hers the team hadn't recorded. |
| **B. She adds directly.** | No wait. | The scraping route above, and a guardian can pull in another guardian's cats by mistake with no one to notice. |
| **C. Only the team ever assigns cats.** | Strictest. | Every new cat in an existing colony needs a message to the team; guardians would go back to WhatsApp, which is the current problem. |

**Recommendation: A.** The first population of colonies is done by the team from what they already hold (the records import, `records-import.md`, and their own knowledge), so a guardian arrives to a colony that already has most of her cats in it.

### 7.5 What the queue never does

No paging, no escalation, no assignment, no due date, no countdown. No exact position shown to anyone outside their scope. No reporter details. No "approve all" button: each item is decided on its own photo.

It does not replace the *Probably sterilised* review list that already exists for the team (`cat-record-data-spine.md` §4.5 point 3, `lib/likelyReview.ts`): that list is for the team to check a **tourist's** evidence, and it keeps its two buttons (*looks right* / *that's not a clip*). Guardians and volunteers add a second source of evidence for the same cats. The cat's page shows both, so nobody decides without seeing both, and an item decided on one list is closed on the other.

---

## 8. The people screen: who may invite, and the safeguards

SYC-104 is the screen. This section says what it must allow and what it must refuse.

### 8.1 Who may do what

| Action | Who | Extra rule |
|---|---|---|
| Invite a guardian or volunteer | Management | Placement (colonies) is chosen at the same moment. A guardian with no colony is refused by the database (§10.1) |
| Invite staff or management | Management | **A second management member must OK it before the invitation is sent** (§8.3, Decision 11) |
| Change someone's roles or placements | Management | Never your own. Anything that adds staff or management needs the second OK |
| Resend, withdraw an invitation | Management | One invitation message per person per 24 hours |
| Mark someone as left | Management | Never the last management person (§9.5) |
| Bring someone back | Management | Roles are chosen afresh (§9.4) |
| Sign someone out everywhere | Management, or the person themselves | |
| See who did what | Management | Ids resolved to names on screen; the history itself holds ids (§11) |
| Stop helping, change my language, sign out | Any accepted person, for themselves | |

### 8.2 What the screen shows

A list of people with, for each: name, roles in plain words, colonies, and a chip (**Invited · Joined · Expired · Left**). Beneath each, their history (§11). Beside the list: **Invite someone**. A tab for people who have left, with **Bring back**. Every change records who made it (SYC-104's own requirement); the screen has no free-text box that ends up in an email.

### 8.3 Decision 11: one person alone, or a second pair of eyes, for staff and management

Inviting a guardian gives someone sight of one colony. Inviting a staff member or management person gives sight of the island and, for management, the power to invite.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ A second management member OKs before an invitation to staff or management goes out.** Guardian and volunteer invitations need no second OK. | The two most powerful roles can't be created by one compromised mailbox or one mistake. | With only one management person the system can't invite staff. The `people` command stays for exactly this break-glass case, run by Samuel. |
| **B. Any management member alone, for every role.** | Fastest. | One stolen management session mints unlimited high-access accounts. |
| **C. Second OK for every invitation.** | Most careful. | Guardian and volunteer invitations, the common case, all wait for someone: the friction the charity will notice first. |

**Recommendation: A.** The request appears in "Needs an OK" as an item of kind *invitation*, for any management member other than the one who made it. The invitation message is sent only when it is OK'd.

### 8.4 Decision 7: protecting against an invitation to the wrong mailbox

Nothing stops Susan mistyping a letter and inviting a stranger. The invitation names the colony and the sign-in then gets that stranger an accept page.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. ✅ Make mistakes unlikely and loud.** The address is typed twice. The accept page asks the invitee to type their own name; the inviter sees it in the people screen the moment she accepts, and for guardian and volunteer roles gets an email: *"Eleni P. accepted your invitation."* Management can withdraw her in one tap. | No extra step for the right person. A mistake is visible within the day. The damage is limited: a stranger could see **one colony**. | There is a window in which a mistaken stranger holds one colony's view. |
| **B. Hold access until the inviter confirms.** The invitee accepts; her access starts when the inviter taps *Yes, that's Eleni*. | A mistaken stranger sees nothing. | A real guardian waits, perhaps a day, perhaps until Susan next opens the screen. That is the first impression of the whole system for someone who agreed to help. |
| **C. A code the inviter reads out.** The invitation shows a 6-digit code Susan gives her on the phone; the accept page asks for it. | Defeats a mistyped address entirely. | The guardian must have the code, find it and type it in. The people most likely to be put off are the people this system most needs. |

**Recommendation: A for guardians and volunteers.** The blast radius is one colony, and the inviter learns of a mistake within the day. Staff and management invitations already get Decision 11's second OK. If Syros Cats would rather have B for guardians, it is a one-line change: a new guardian's placement starts inactive until the inviter's confirmation.

### 8.5 Limits on the invitation path

- **10 invitations per inviter per day**, 1 per address per 24 hours, 30 per IP per hour.
- The message is a closed template in the one send function with a new purpose, `person_invite`. **The caller names a person, not an address**: the function looks the address up itself and refuses unless that person is pending and unexpired, so it can't be used to email an arbitrary stranger. No free text from the inviter goes into it.
- The invitee's name and the colony's name appear in the message escaped and length-limited, so neither can carry a link or markup.
- If the mail path is down, the invitation is saved and visible as *Not sent yet*, and sending retries like other mail. **An invitation that failed to send is never shown as sent.**
- The message is not shed ahead of welfare mail and sign-in links; it is shed before news (`team-access-and-welfare-queue.md` §2.10).

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
- **Items they started stay open.** A field check they made waiting in "Needs an OK" is still evidence and can still be decided. It is marked *from someone who has since left*. An invitation they sent stays valid (someone else is shown as the one to approve anything further).
- **A field check still queued on their phone** (§12) is refused when the phone next connects: the person isn't on the list any more. They can tell the team what they saw.
- **The shared document password** is changed if they held `use_workspace` (§6.3).
- **Their colony placements** are kept on their row as the record of what they held when they left, and ignored by `can()` because they are not on the list. The history entry (§11) also records which roles and colonies they held, in ids.

### 9.3 When a colony changes guardian

Colonies are named "Vaporia — Eleni's" and carry a guardian's name as free text (`colonies.guardian_name`). When a guardian leaves or hands over, the people screen offers: *"Vaporia — Eleni's still has Eleni's name on it. Rename it?"* with `rename_colony`'s screen one tap away. The colony keeps its old name in its name history, so searches and imports still find it (`team-access-and-welfare-queue.md` §3.4). **This is a nudge, not a rule**: nothing renames a colony automatically, because a colony's name is how the team talk about it on the phone.

### 9.4 Bringing someone back

Management finds the person under *Left* and taps **Bring back**. The screen shows what they held and when they left, and asks for roles to be chosen **afresh**: nothing is restored automatically. This is how the existing code already behaves (re-adding a left address clears `left_at`, raises the session version and replaces the roles). New in this spec:

- It is the same flow as a first invitation: the person is pending again, gets the invitation message, signs in and **accepts again**. Someone who left a year ago re-reads the four promises before they see a colony.
- It records a `rejoined` event with who brought them back (SYC-213).
- Staff and management roles still need the second OK (Decision 11).

### 9.5 Guards that stop the charity locking itself out

- **The last management person can't be marked as left, demoted, or sign out everywhere through the screen**, because then nobody could invite anyone. The `people` command (run by Samuel through db-ops) remains the break-glass route.
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

`people` (today: id, email, name, session_version, added_at, added_by, left_at, left_by) gains:

| Column | Type | Meaning |
|---|---|---|
| `accepted_at` | timestamptz, null | When the person tapped *Yes, join*. Null means invited but not yet accepted. **Backfilled to `added_at` for everyone already on the list.** |
| `invite_sent_at` | timestamptz, null | When the invitation message went out. Null with `accepted_at` null means "waiting for a second OK" |
| `invite_expires_at` | timestamptz, null | 14 days after `invite_sent_at`; null once accepted |
| `language` | text, not null, default `en`, check in (`en`, `el`, `fr`) | For messages and the person's own pages |

The rule "who is on the list" stays in the one place it lives now (`findAllowedPerson` and `findPersonById`), extended by one clause: **not left; and either accepted, or invited and not expired**. Callers that must reach a pending person (the hand-off and the accept page) ask for them explicitly. `can()` ignores a pending person's placements, so nothing is granted until acceptance.

`person_scopes` (today: id, person_id, role, colony_id) gains:

| Column | Type | Meaning |
|---|---|---|
| `reach` | text, not null, default `island`, check in (`island`, `colony`) | Where this role applies. **A check requires `reach = 'colony'` exactly when `colony_id` is set** |
| `expires_at` | timestamptz, null | When this placement turns itself off (Decision 9) |
| `relationship` | text, null, check in (`feeds`, `owns_here`, `covering`) | A label for the team's records. Grants nothing |
| `granted_by` | text | A person id or `cli:<operator>`; same convention as `added_by` |
| `granted_at` | timestamptz, not null, default now | |

Checks added to the table: `role = 'guardian'` requires `reach = 'colony'` (a guardian with no colony is refused by the database, not by a code path someone might skip); `role` in (`staff`, `management`) requires `reach = 'island'`. The role list gains `management`. The existing "unique person, role, colony" constraint stays, so a person can't hold the same placement twice.

**Why an explicit `reach` rather than "colony is null means island".** Today a null colony means "not tied to a colony". If a guardian row were ever written with the colony left out, "null means island" would quietly turn her into an island-wide viewer. An explicit column and a check make the dangerous mistake impossible instead of merely unlikely.

**The migration must not guess.** Rows with role `guardian` or `volunteer` and no colony could exist from earlier use of the `people` command. The migration lists any it finds and stops, so a person decides what each means. (The command's `--role guardian` option is also changed to require `--colony`, §15.)

**Management for existing staff.** If Decision 3 is A, the migration adds a `management` row for every person who holds `staff` and has not left. They then hold exactly what they hold today.

### 10.2 The invitation

No separate invitations table. An invitation is a **pending person** (`accepted_at` null, `invite_sent_at` set, not expired) plus their placement rows plus an event. This is what lets removal, "sign out everywhere", expiry and the history work with code that already exists.

### 10.3 `confirmation_items`

| Column | Type | Meaning |
|---|---|---|
| `id` | serial | |
| `kind` | text, check in (`field_check`, `colony_member`, `invitation`) | What is being asked |
| `state` | text, check in (`open`, `approved`, `declined`, `no_longer_needed`, `expired`, `withdrawn`) | |
| `cat_id` | integer, null | For `field_check` and `colony_member` |
| `colony_id` | integer, null → `colonies.id` | For `colony_member` |
| `subject_person_id` | uuid, null → `people.id`, strict | For `invitation`: the pending person |
| `proposed_by` | uuid → `people.id`, strict | Who asked |
| `proposed_at` | timestamptz | |
| `observation_id` | integer, null | The field check's own observation |
| `decided_by` | uuid, null → `people.id`, strict | |
| `decided_at` | timestamptz, null | |
| `decision_reason` | text, null | One of a fixed list, never free text from the guardian into the cat's page |
| `resulting_observation_id` | integer, null | The team's own statement, if approved |

Checks: `decided_by` is not `proposed_by`; a decided item has both `decided_by` and `decided_at`; an `open` item has neither. Open items are unique per (kind, cat, proposer), which is how "one per cat" holds. Rows are never deleted. The strict links mean nobody who has proposed or decided anything can be hard-deleted, the same rule as for report changes (Decision 7).

### 10.4 What is written on an observation

Two small, deliberate changes to the record's vocabulary, both for the data spine's owner to confirm (proposed in §16):

- **`roleAtTime`** gains the live values `guardian` and `volunteer` (it is already allowed in the vocabulary and refused by `writeObservation` until now) and renames the never-written `admin` to `management`. There is **one** list of team roles in code, used by the resolver, the *Probably sterilised* list and the correction routes, replacing the three copies (`resolve.ts`, `likelyReview.ts` via `teamCorrections.ts`, and the hand-written `"staff"` in each correction).
- **Which role is written** is decided by the server from the person and the action: the role under which the capability was granted for that target. A person who is staff and also a guardian, using a staff capability, writes `staff`; using a guardian-only capability on her colony, writes `guardian`. It is never read from the request. Today `teamCorrections.ts` and `routes/notifications.ts` write the string `"staff"` directly; they change to ask for it.
- **Authority does not grow.** The resolver's list of authoritative roles stays staff, management and vet. A `guardian` or `volunteer` observation is evidence. It is the team's reading of it that settles a sterilisation answer (§7).

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
| `invite_approved` | A second management member OKs an invitation to staff or management | the confirmation item id |
| `invite_sent` · `invite_resent` | The message went out | |
| `invite_expired` · `invite_withdrawn` | | |
| `accepted` | The person tapped *Yes, join* | the version of the four promises they accepted |
| `added` | A person is added without an invitation (the `people` command, break-glass) | |
| `roles_changed` | A placement is added, removed or edited | before and after, as role and colony ids |
| `left` | | who (`self`, a person id, `cli:<operator>`), roles and colony ids held at the time |
| `rejoined` | | |
| `signed_out_everywhere` | | by whom |
| `anonymised` | SYC-208 runs | by whom |

`by` is a person id, `self`, `cli:<operator>` or `system:expiry`. Each operation in `lib/db/src/people.ts` writes its event **in the same transaction** as the change (SYC-213's test: drop the insert and a test goes red). A database trigger refuses updates and deletes, as for observations.

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

A row for every colony page view would be mostly noise and itself a record of where cats are. Instead: a **counter per person per day** (how many cat detail pages and round sheets they opened), and a banner for management when a guardian or volunteer opens far more than their colonies hold (for example, more than twice the cats in their scope in one day). It is a prompt to ask a question, not an accusation, and not a block. Counts live in a small table with no cat ids in it (§14, case 8).

---

## 12. What a phone may keep, if Decision 1 goes with the web page

Decision 1 recommends the offline view be a saved web page on `team.catspotters.com`. Anything saved on a phone can outlive a sign-out, a loss or a departure, so the page is built to **forget**:

| Rule | Why |
|---|---|
| **Only what the round needs**, for the person's placed colonies: cat name and SYR number, sterilisation answer with how sure we are, usual spots (exact), feeding site name and position, when last seen. **No photos of people or property; cat photos are the small thumbnail only.** | Less on the phone is less to lose |
| **A saved list is valid for 7 days from the last time the phone was online.** After that the page shows *"Connect to refresh this list"* and no cats | A phone that is lost, or belongs to someone who has left, stops being useful on a known day |
| **Each online load re-checks the person.** If she is no longer on the list or no longer holds the placement, the server says so and the page **erases the saved list at once** | Removal reaches phones at their next connection |
| **Sign out erases it.** So does "sign out everywhere" at the next connection | |
| **Stored under the dashboard's own origin**, never in the public app's storage, and never under the public catalogue's cache key | The data spine's rule that exact positions must never share a key with the public cache (`cat-record-data-spine.md` §6.5) |
| **Field checks made offline wait in the page's own queue** (up to 20, each with its photo), and are sent on the next connection under the person's signed-in session | If the session or the person is gone, they are refused (§9.2) |
| **A round sheet, printed or saved as a file, is stamped with the person's name and the date**, and says *"These are exact places. Please don't share them."* | A person who shares a printout can be asked about it; a stamp is a reminder, not a lock |

**What can't be promised, and is said plainly on the accept page:** a phone that never reconnects keeps its saved list until the 7 days run out; the charity cannot wipe it from a distance. The accept page therefore asks everyone to keep a lock on their phone, and the people screen's *sign out everywhere* is the first thing to do about a lost phone.

**The web storage caveat.** iPhones may clear a saved web page's storage if the page isn't opened for about a week unless it has been added to the Home Screen. The app already shows a nudge for exactly this (`homeScreenNudgeText`); the colony view reuses it. A cleared list is a failure that is visible ("Connect to refresh"), not silent.

**If Decision 1 chooses the app (B)**, every rule above applies to app storage with a distinct cache key, and `cat-record-data-spine.md` §6.5 needs an approved amendment first.

---

