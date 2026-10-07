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

