# "Report an issue" on every cat and photo

**Feature spec · Cat Spotters (Syros)**
**Version:** 1.2 · Samuel's decisions recorded · 12 October 2026 (v1.1 was revised after adversarial review; v1.0 draft was 7 October 2026)
**Covers:** `team-access-and-welfare-queue.md` §6 (which this spec fills out and, in the places listed below, amends), and the Turnstile protection for both public report forms.
**Linear:** SYC-44 (Report an issue) · SYC-170 (Turnstile on the welfare report and on Report an issue). Touches SYC-105 (shared rate limits), SYC-113 and SYC-114 (the pre-launch pass), SYC-130 (claiming a cat; the home description), SYC-150 (move a sighting to another cat), SYC-229 (which addresses sit behind Cloudflare), SYC-231 (the mail drain), SYC-232 (a real example of what people will report), SYC-248 (privacy policy updates) and SYC-279 (hidden photos and caches).
**Status:** **Approved by Samuel, 12 October 2026.** Every decision is marked "Decided" in §12 and carried through the rest of the spec. The adversarial review is `docs/specs/reviews/report-an-issue-review.md`, and §17 says how each finding was handled.

### What this document owns, and what it borrows

| What | Owner |
|---|---|
| The reasons a person can give, the button, what the reporter sees, how an issue lands in the queue, what the team can do with it, and the Turnstile rules for **both** public report forms | **This document** |
| The queue itself (four states, team note, state history), the team's sign-in, the alert email and the "photo pending" pattern | `team-access-and-welfare-queue.md` and the SYC-42 / SYC-43 plans |
| The names of every permission ("capability") and who holds it | `roles-and-invites.md` §6.2. This spec adds no name of its own; the two it needs are listed in §5.5 as additions to that catalogue |
| The hide-and-restore log (`photo_visibility_events`) and the one function that builds public photo addresses (`publicPhotoUrl()`) | `docs/superpowers/plans/syc-43-part-2-welfare-queue-and-corrections.md`, PR 6 |
| Email verification, consent wording, the closed list of email moments (Report an issue is not on the list: it has no email box) | `email-capture.md` |
| Location blurring and feeding-site privacy | `cat-record-data-spine.md` |
| Removing a photo's bytes: the contract | `hosting-and-photo-storage.md` §6.5 |
| The pre-launch pass and its removal | `docs/superpowers/plans/syc-113-pre-launch-gates.md`, SYC-114 |

Where this spec and `DECISIONS.md` differ, `DECISIONS.md` wins, except where a decision here is marked as **an amendment** and put to Samuel in §12.

### Changes to approved text, all in one place

Anything below that contradicts an approved document is listed here and in the decision that carries it. Samuel decided each of these on 12 October 2026 (§12); they take effect when he gives final approval to the spec.

| # | What changes | Approved text it touches | Decision |
|---|---|---|---|
| 1 | A photo that shows a person or a private place also hides on one confirmed report | Welfare spec §6 and DECISIONS Part 2b (only "upsetting or inappropriate" hides) | D2 |
| 2 | A hidden photo is hidden from everyone but staff, including its taker, who sees a neutral tile | Welfare spec §6 ("stays visible to staff and to whoever uploaded it") | D4 |
| 3 | **Removal of a photo.** Samuel chose option B (a removal path before launch, widened to the whole team), which adopts the contract in `hosting-and-photo-storage.md` §6.5 and so amends nothing. The "hide only" option A would have amended it | `hosting-and-photo-storage.md` §6.5 (approved 28 September) | D5 |
| 4 | **No email box on Report an issue** (Samuel chose no email box). So there is no new moment when people are asked for an email, and nothing to amend | `email-capture.md` (closed list of asks) and `privacy-policy.md` ("we ask at four moments: after you've spotted a cat, at the end of a visit, after you've reported a cat in trouble, and in Settings"): both unchanged | D9 |
| 5 | **No closing email.** The reporter gets an on-screen thank-you only, so the Part 2b closing wording is not used by this feature and nothing is amended | DECISIONS Part 2b: unchanged | D9 |
| 6 | **The reason list.** This spec keeps the approved reason "wrong information about this cat" as its own reason (`wrong_info`), so `choose-a-different-cat.md`'s references to it still work, and gives its "Think this cat is alive?" link an entry point (§2). Dropping it would be an amendment to both documents | Welfare spec §6 and `choose-a-different-cat.md` | none (kept) |
| 7 | The Turnstile check on the cat-in-trouble form is done before a report is accepted, with one exception: when our own server cannot reach Cloudflare. This relaxes SYC-170's wording only in that outage case | SYC-170 | D11 |
| 8 | Retention of issue reports, the processors list (Cloudflare) and the line "the report … stay with the cat's record" in the privacy policy | `privacy-policy.md` (owned by SYC-248) | D12 |

---

## 1. The short version

Anyone, with no account, can tell Syros Cats that something about a cat or one of its photos is wrong. They tap a quiet **Report an issue** link, pick a reason in plain words, optionally add a sentence, and send. It lands in the same dashboard queue as cat-in-trouble reports, in its own section below them, and as an email to the shared inbox.

Two kinds of report are treated differently from the rest:

- **A photo that shows a person, a house number or anything private, or that is upsetting or offensive,** is hidden from everyone the moment the reporter confirms, and stays hidden until the team decides. One report is enough (decided 28 September). Hiding a good photo for a few days costs nothing; leaving a private one up costs a lot.
- **A cat that has died, or a map spot or home description that shows where someone lives,** is never changed by the report alone. The team looks and the team decides. A stranger's report is a tip, not a fact about a cat's life.

To keep the form from being used as a weapon, it is protected by Cloudflare Turnstile (a check, usually invisible, that the sender is a person using the real app or website), by per-address limits, and by four extra rules about hiding (§8). The same Turnstile check goes onto the cat-in-trouble form (SYC-170). Turnstile needs a web page to run in, which the phone apps do not have, so §9 spells out how the Expo apps cope and puts the choice to Samuel.

**Who sees these reports.** Only the Syros Cats team (the one team role, and the management tier above it). They need the `view_welfare_queue` power. **Cat guardians never see "Report an issue" reports**, not even about cats in their own colonies (§5.3).

### The thing that matters most

**Hiding must be quick, and a wrong hide must be cheap to undo.** A person whose child, front door or number plate is in a catalogue photo wants it gone now, not when somebody reads an email. So the hide happens on the server in the same step that records the report, and the email to the team is the notification, never the trigger. If every email fails, the photo is still hidden and the report is still in the queue.

**And a real report is never lost.** A person who reports a hurt cat, or a private photo, on one bar of signal must never end up with a report that vanished. §9.5 is built around that.

### The two audiences want the same thing from different angles

A local who knows a cat's name is wrong, a cat guardian whose cat has died, and a neighbour who does not want their doorway in a public photo all know something the app does not. A tourist who comes across an upsetting or odd photo is in a different position but needs the same thing: a one-tap, no-account way to say so, without needing to know who at Syros Cats will read it.

---

## 2. What someone can report

Nine reasons, in the words the screen uses. English wording is final here; Greek and French follow §11.

| Key | What the person sees | Hides on one confirmed report? | What the team usually does |
|---|---|---|---|
| `photo_private` | **It shows a person or a private place** · "faces, house numbers, number plates, inside a home or garden" | **Yes** (decision D2) | Look at the photo. Keep hidden, or restore if nothing private is in it. |
| `photo_inappropriate` | **It's upsetting or offensive** | **Yes** (approved 28 Sep) | Same. |
| `photo_not_cat` | **That's not a cat** · a picture that has nothing to do with cats | No | Hide the photo (one tap) if it is wrong. |
| `wrong_cat` | **That's a different cat** · "this photo is of another cat" | No | Hide the photo for now. Moving it to the right cat is SYC-150. |
| `wrong_name` | **The name is wrong, or not OK** | No | Rename the cat. |
| `wrong_info` | **Something else about this cat is wrong** · "the colours, the home, the ear tip" | No | Mark the wrong statement as wrong, with a reason, or add a note. |
| `location_revealing` | **The map spot or the words show where someone lives** | No (decision D6) | Look; see D6 for what the team can change. |
| `cat_died` | **This cat has died** | No, never | Look. If it is known, record "no longer with us" with a date. |
| `other` | **Something else** | No | Whatever is right. |

Notes on the list:

- **The hint for `photo_private` is deliberately narrow.** The first draft listed "a doorway", but almost every street photo on Syros has one, which would turn the one reason that hides into the easiest one to misuse. The hint reads "faces, house numbers, number plates, inside a home or garden".
- **Nothing here replaces "This cat needs help."** A cat that is hurt now is a welfare report and gets the vet-first guidance, which is the most carefully written copy in the app. The first line of the reason sheet says so: *"Is a cat hurt or in trouble right now? Use 'This cat needs help' instead."*, as a link. Without that line, "Report an issue" becomes a way around the capacity messaging, and a worried tourist ends up in a queue that is read on Monday.
- **`wrong_info` is the approved reason "wrong information about this cat".** `choose-a-different-cat.md` relies on it: wrong colours are corrected through it, and the "Think this cat is alive? Tell Syros Cats" link on a cat marked as no longer with us opens Report an issue on that cat's page with `wrong_info` already chosen and a note box that asks "What do you know?". The words of that link belong to `choose-a-different-cat.md`; this spec only provides the place it lands.
- **`cat_died` is gently worded** and never promises a change: *"We're sorry. Syros Cats will check and update the cat's page."*
- **A note is optional** (up to 1,000 characters, no counter shown) and is team-only text.
- **A real example, SYC-232.** A "has a home" push can carry the owner's home description ("the blue house above the harbour") to every past spotter, and the cat page shows the same text publicly (`homeDescription` is in the public cat payload). A neighbour who sees their street named there would use `location_revealing`. Fixing the push is SYC-232; this report is the safety net for the text that remains on the page. Whether that text stays public at all is SYC-130's question (D6).

---

## 3. Where the button sits

A quiet text link, the same weight as "This cat needs help" and always below it. Never an icon-only control and never the biggest thing on the screen. Most photos are fine, and an app that puts a flag on every picture teaches people to feel watched.

1. **On a cat's page** (beside the `NeedsHelpLink`): **Report an issue** about the cat. It offers the cat reasons: `wrong_name`, `wrong_info`, `location_revealing`, `cat_died`, `wrong_cat`, `other`.
2. **On each photo.** Tapping a photo (the main photo or one in the sightings history) opens it larger in a simple full-screen view: the photo, the date, who spotted it, **Close**. Beneath it, **Report an issue with this photo**. It offers the photo reasons first: `photo_private`, `photo_inappropriate`, `photo_not_cat`, `wrong_cat`, then `other`. (Decision D8 sets out the alternatives.)
3. **Not on:** the cat list cards, the map pins, push notifications and the "is this the cat?" picker. Each leads to the cat page in one tap, where the link is. A hidden photo disappears from all of them anyway, because every public photo address is built by `publicPhotoUrl()`.

The website and the phone apps get the same links. The web has no long-press, which is part of why a full-screen view beats a hidden gesture.

---

## 4. What the reporter sees

### 4.1 The flow

1. **The reason sheet.** The reasons above as large, plain buttons, with the short first line about hurt cats.
2. **One optional box:** "Anything we should know?" There is no email box (decision D9): we ask for no way to contact the reporter.
3. **For a hiding reason, the confirm step** (approved text, DECISIONS Part 2b): *"Are you sure? Reporting this will hide it from everyone until Syros Cats have reviewed it."* with **Report and hide** and **Cancel**. Nothing is hidden or sent until they tap **Report and hide**.
4. **Send.** The Turnstile check runs in the foreground at the moment of sending (§9.5) and the person sees nothing unless the widget needs a tap, in which case a small sheet appears (§9.4).
5. **The confirmation.** Plain and short, and **chosen by what the server actually did**, not by the reason the person picked. The server's answer carries `hidden: true` or `hidden: false`:
   - `hidden: true`: *"Thank you. The photo is hidden while Syros Cats take a look."*
   - `hidden: false` on a reason that would normally hide: *"Thank you. Syros Cats will take a look as soon as they can. The photo is not hidden yet."* This is what a person sees if they hit the per-address limit, report a photo the team has already restored, send while the global brake is on (§8.1 rule (iv)), or send while our server could not reach Cloudflare. It never claims a hide that did not happen.
   - Any other reason: *"Thank you. Syros Cats will take a look."*
   
   None of them says when, because nobody is on duty (F1). Every message lives in the app's language files (§11). Final wording belongs to Syros Cats and Samuel.

### 4.2 Offline and weak signal

Be precise: **a report is saved on the phone first and reaches Syros Cats only when the phone has a connection.** On the website, "saved on the phone" reads **"saved in this browser"**, and the offline copy says both that and that a browser can clear what it has stored (welfare spec Part 2f R1). It uses the same saved list as cat reports and sightings (`lib/queueStore.ts`, the cross-tab lock, the one reminder after 24 hours). On the web this applies when the browser reports no connection; with one weak bar of signal the send is attempted and, if it fails, the report is kept and retried.

- The offline confirmation says *"Saved on your phone. It will be sent when you have a connection."* (web: *"Saved in this browser. It will be sent when you have a connection."*). It never says "hidden", because **nothing is hidden until the server has the report**. A person who reports a private photo while offline is told exactly that, so they do not assume the picture is already down.
- A saved report does not hold a Turnstile token (a token lives five minutes). **Each send from the saved list runs a fresh check in the foreground**, because the list only sends while the app or page is open (§9.5). So a report sent hours later can still hide the photo, as long as the check passes.
- There is no photo to upload with an issue report, so it is tiny and survives a weak signal better than a cat-in-trouble report.
- Opening the full-screen view of a photo needs that photo to have been loaded already. Nothing here changes what the app can show offline.

### 4.3 What the reporter does not see

Who read it, what the team decided, whether anyone else reported the same thing and the outcome. The reporter is never told the outcome (§7). There is no public record that a report exists, except one neutral thing: **a hidden photo is gone from every public view, and its place in the sightings list shows a quiet tile, "Photo hidden while Syros Cats take a look."** (Decision D4.)

---

## 5. How it reaches the team

### 5.1 The queue is the source of truth

As with welfare reports (spec §4.3), **the queue row is written first, in the same database transaction as everything it causes**: the hide, the count and the queued alert email. Mail cannot lose a report and cannot delay a hide.

**Where the row lives is decision D1.** The recommendation is the existing `welfare_reports` table with `kind = 'content'`. The column and its check already exist for exactly this (`lib/db/src/schema/welfare.ts` reserves it), and spec §8.4 already says so, so the dashboard has one queue, one set of four states, one team note, one history and one delivery-state column. Reuse is not free. The table was built around cats in trouble, and the plan lists and tests every one of these places:

- **The migration.** `lat` and `lng` become optional for `content` rows, with a new check that keeps them required for `welfare` rows. New nullable columns: `reason` (the key from §2, checked), `photo_id` (→ `photos.id`), `hidden_by_report` (boolean) and `token_checked` (boolean, §9). `cat_id` is already there. This changes a table already in use, so the plan includes a **rollback block** that keeps the welfare rows' guarantee that a position is always present.
- **Severity.** `severity` is set to `attention` for content rows (it is only used to order the welfare list); `is_litter` stays false.
- **Photo state.** `photo_state` defaults to `'pending'`, which would show "Photo still uploading" on the queue and make the alert email wait ten minutes for a photo that is not coming. **Content rows are always written with `photo_state = 'none'`.** (The reported catalogue photo is a `photos` row, a different thing from this column.)
- **"Which cat is this?" must not be offered on content rows.** Tying a report to a cat writes a `welfare_report` observation, and the cat record counts those as **evidence of life** (`resolve.ts`, `EVIDENCE_SOURCES`). A `cat_died` row tied to a cat would push that cat's "last seen alive" date later, the opposite of what the report says. The tie control is not shown for `kind = 'content'`, the route refuses it, and a test proves **no `welfare_report` observation is ever written for a content row**.
- **No `welfare_outcome` on close.** The existing close action writes a `welfare_outcome` whenever the report has a `cat_id`, and content rows have one from the start. The guard (`kind = 'welfare'` only) goes into that existing code in the first pull request, not a later one, with a named test, and a welfare closing still writes one.
- **The resend key includes the kind.** Today a resend is recognised by `(reporter_device, client_ref)`. It becomes `(reporter_device, kind, client_ref)`, so an issue report can never be silently swallowed as "already sent" because a welfare report from the same phone happened to share a reference.
- **The mail-failure banner** on the queue counts alert purposes; it counts both `welfare_alert` and `issue_alert` (§5.2).
- **Retention.** The three-year welfare deletion job and D12's one-year issue rule are separate jobs, or one job that checks `kind`; it must not treat the two alike.

### 5.2 The email to the shared inbox

A second alert type through the existing outbox and the one send function, under **its own purpose, `issue_alert`**, that goes to the same shared inbox as `WELFARE_ALERT_TO` but is **not** one of the never-shed purposes. The welfare alert purpose (`welfare_alert`) is never shed because a hurt cat's alert must get out even when the email account is nearly out of allowance. Resend's limit is shared across the whole account, so if issue alerts rode the same purpose, a flood of issue reports with valid tokens (paid solving services can get past Turnstile cheaply) could use up the allowance on the same day a real urgent cat report needs it.

- `issue_alert` is placed in the shed order ahead of the reporter acknowledgements, so under pressure it is dropped first. The plan confirms the exact position against `send.ts`.
- **Individual emails are sent only for "Photo hidden" alerts**, up to 10 an hour in total. Everything else (location, died, wrong name, wrong cat, other) is folded into **one digest** with a once-in-24-hours guard recorded by the mail drain, because the drain runs every few hours (SYC-231) and has no clock of its own. The dashboard always shows the live count whatever happens to email.
- A test proves that 500 issue alerts in an hour cannot delay a `welfare_alert`.

| Case | Subject starts |
|---|---|
| A photo was hidden | `Photo hidden: possible private or offensive content` |
| Daily digest of everything else | `Issue reports: N waiting` |

The body of a "Photo hidden" alert carries the reason, the reporter's note (escaped), the cat's name with a team-page link, and the photo **as an attachment** (the same rule as welfare photos: a team link fails in a mailbox, and a public link would be wrong for a photo that was just hidden). **No reporter details of any kind**: there is no email box, so there is nothing to carry (decision D9). The digest lists reasons and cats with team links, no notes.

**Latency, honestly.** Individual alerts go out right after the report and after any later request, with the scheduled drain as a safety net that in practice runs every few hours (SYC-231). That is acceptable here **because the hide does not wait for mail**. The interface never implies a report about location or a death is urgent. SYC-231's fix (an external cron) helps this feature as much as the welfare one.

### 5.3 Where it lands in the dashboard, and who can see it

**Only people who hold `view_welfare_queue` see any of this.** The roles spec gives that power to the team and management, island-wide, and to nobody else. Cat guardians hold a separate, narrower power, `view_colony_welfare_reports`, which the roles spec defines as read-only reports of cats in trouble about cats in their own colonies, with no reporter details, and **explicitly never a "Report an issue" report**. This spec keeps to that. Concretely, each of these needs `view_welfare_queue` and is refused (not merely hidden) for anyone without it:

- the **Issues** section of the queue page and its data;
- the **"Reports about this cat" strip** on the team cat page. A guardian can open the team cat page for a cat in her own colony (she holds `view_exact_location` for it), so the strip is checked on its own and left out for her;
- the **links in issue alerts**, which go to pages that need the power;
- the **team route that serves a reported photo**. A hidden photo is additionally served only to someone who holds `hide_photo`, as the roles spec says.

Why it matters: a neighbour reports `location_revealing` because a guardian's own home description names her house. If the guardian could then read the neighbour's note on the cat page, the promise in §10 that a cat's owner or guardian is never told who reported it would be false. A test in the roles spec's route walk (its §6.4) covers it: a guardian with that cat in her colony gets no strip, no Issues section and a refusal on the reported-photo route.

**The page.** The queue page keeps its first section, **Waiting for the team** (welfare reports, urgent first, exactly as today). Below it, a second section, **Issues**, set apart by a different colour band **and** a text label "Issue" on each row (so it does not depend on colour alone), and never above a welfare report (approved, §6).

Inside **Issues**, the order is:

1. **Hidden, waiting for you.** Photos hidden by a report and not yet decided. The public is already safe, so these are ordered by how long they have waited, longest first, and the number shows in the dashboard's top bar.
2. **Location, and cats reported as died.** Need a person.
3. **Everything else,** newest first.
4. **Unchecked** (reports accepted while our server could not reach Cloudflare, §9.5), in their own list at the bottom, never mixed into the order above.

Each row shows the reason in plain words, the cat's name and the photo (served only through the team route, as hidden photos are), what the reporter wrote, how long ago, and the four states and team note the queue already has. The reporter is described as **"a member of the public"**, not "a spotter", because many reporters are tourists with no account. **"2 others reported this"** counts other **open** reports in the same group, where a group is: the same photo and the same reason, or, for reports about a cat rather than a photo, the same cat and the same reason. Repeat reports stay separate rows (the record is add-only); only the count is shown.

### 5.4 What the team can do

Each action names the capability that guards it, using the names in the roles spec §6.2. All are held by the team and management island-wide. Cat guardians hold none of them for issue reports.

| Action | Capability |
|---|---|
| **See the Issues section, the strip on a cat's page, an issue's photo** | `view_welfare_queue` |
| **Keep it hidden** (closes the report as *Done*) | `hide_photo` |
| **Restore the photo** (one tap, attributed; closes as *Nothing needed*) | `restore_photo` |
| **Hide a photo** that a non-hiding report points at (`photo_not_cat`, `wrong_cat`) | `hide_photo` |
| **Rename the cat** | `rename_cat` |
| **Say the cat is no longer with us** (reason, and the date the team knows of) | `set_life_status` |
| **Mark a statement wrong**, with a reason | the statement's own capability (`set_appearance` for colours) |
| **Open the cat's page** (exact location, full history) | `view_exact_location` |
| **Change state, add a team note** | `change_report_state`, `add_team_note` |
| **Move the photo to the right cat** | SYC-150. Until it exists, `wrong_cat` means "hide the photo and leave a note". Moving a sighting must keep the photo's internal id, or rule (ii)'s restore history is lost |
| **Clear a cat's home description** (team and management) | `clear_home_description` (proposed addition, §5.5; decision D6) |
| **Remove a hidden privacy photo for good** (team and management; typed confirmation) | `remove_photo` (proposed addition, §5.5; decision D5) |

A report that hides a photo and is then closed records both: the original hide (author `report:<id>`) and, if the team restores, a restore (author a person id). The log is add-only, so "who hid this, and who put it back?" always has an answer.

### 5.5 Proposed additions to the roles catalogue

The roles spec says a spec that needs a power that is not in its §6.2 table "adds a row there first". This spec does not edit the roles spec. Samuel has decided D5 and D6, so these are the rows to add (the `clear_home_description` row only if SYC-130 leaves the home description public):

| Capability | What it lets you do | Kind | Team | Management | Guardian | Needed by |
|---|---|---|---|---|---|---|
| `clear_home_description` | Clear (blank) the home description on a cat's page, with a reason, recorded who and when. Narrow on purpose: it does not edit any other cat text, so it cannot overlap `rename_cat` or SYC-2's `set_appearance` | Island-only | ✓ | ✓ | — | D6 (only if SYC-130 leaves the description public) |
| `remove_photo` | Remove a hidden photo's bytes for good under `hosting-and-photo-storage.md` §6.5: one write, recorded who, when and why, irreversible. Only on a photo that is already hidden for a privacy reason; asks for a typed confirmation | Island-only | ✓ | ✓ | — | D5 (decided 12 October 2026: team and management, not management alone) |

The draft's name `edit_cat_text` is **not** proposed: as a name it suggested editing any text on a cat. The other powers this spec uses (`view_welfare_queue`, `hide_photo`, `restore_photo`, `rename_cat`, `set_life_status`, `view_exact_location`, `change_report_state`, `add_team_note`) are already in the catalogue.

---

## 6. Urgent cases: a privacy problem means hide fast

The approved rule stands: one confirmed report hides a photo pending review. This spec adds what is needed to make it real and states its limits.

**What makes it fast.**
- The hide is part of the report's database transaction: a `hide` row in `photo_visibility_events` with author `report:<id>`, written with the queue row. Nothing is mailed, polled or approved first.
- Every public place that shows a photo reads from `publicPhotoUrl()` and answers `404` for a hidden photo. In the sightings list the tile reads "Photo hidden while Syros Cats take a look." (D4.)
- If the hidden photo was the cat's main photo, the page shows the newest visible photo or the placeholder (PR 6, Decision 4). A restore brings the original back.

**What stays slow, and is allowed to.** A person cannot be fetched at once. The team may read the report on Monday. That is fine for a hidden photo, because the harm has already stopped. It is **not** fine for a map spot or a home description (D6), which is why those get their own decision.

**What hiding does not cover (said now, so nobody finds out later).**
- A hidden photo is still in the database and still one of the matching model's reference images (PR 6's own note). For a photo that shows a face or a doorway, hiding is not erasure. Decision D5 gives the team a real removal, for a photo already hidden for privacy.
- **Caches.** Photos are served as `Cache-Control: public, max-age=31536000, immutable` (one year, never re-checked). A `404` from the server does not clear a copy that a browser, the app's image store or a shared cache such as Cloudflare's already holds. If the API sits behind Cloudflare's proxy (not recorded; SYC-229), the edge could keep serving a hidden photo to **anyone who has the address** for up to a year. Decision D14 asks Samuel how to close this, and recommends giving a photo a new public address whenever it is hidden or restored, so the old address is dead everywhere (SYC-279 tracks it).
- A hidden photo may already be in someone's phone cache or screenshot. Nothing can fix that, and the privacy policy must not imply it can.
- The offline cat list on a phone may keep showing the photo until its next refresh.

---

## 7. Feedback to the reporter

**Decided (Samuel, 12 October 2026): no email box. The reporter gets an on-screen thank-you only** (decision D9).

- The person is told on screen what happened (§4.1) and nothing more. We ask for no email on this form, so we hold no way to reach them and send them no email: no "is this you?" message, no closing email.
- No push, and no list of past reports.
- Nothing in `email-capture.md` or the privacy policy's "four moments" line changes, because this feature adds no moment when people are asked for an email.
- **What this accepts:** reporters never hear the outcome. A neighbour who reported a private photo is told it is hidden (or that it is not hidden yet), and that is the last they hear. This is also why the confirmation words in §4.1 are written to be complete on their own, and why they never over-promise.

---

## 8. Abuse and spam

A public, unauthenticated write endpoint that can **take a photo off the site** and **costs a person's attention** attracts abuse. The controls, in order of how much weight each bears:

### 8.1 What bears weight

1. **Turnstile on every submit** (§9). It stops scripted floods. A report with a missing, wrong, expired or reused token is **refused with a retryable answer and creates nothing** (§9.5). Only the single case where our own server cannot reach Cloudflare is accepted, and then only as an "unchecked" row that never hides.
2. **Per-address limits.** Device identity is not an abuse control: `deviceAuth.ts` binds the first secret it sees, so an attacker mints a device per request (the new-device cap, SYC-195, limits that to 20 an hour per address). So the limits that count are per address:

| Limit | Value | When it is hit |
|---|---|---|
| Issue reports per address | 20 an hour | `429`, "Too many requests. Please try again later." The phone keeps the report and retries later. |
| **Hides per address** | **5 an hour, 15 a day** | The report is **accepted and queued but the photo is not hidden** (`hidden: false`). The team sees "hide limit reached" on the row. |
| **Unchecked rows per address** (accepted while Cloudflare was unreachable, §9.5) | **3 an hour**, both forms together | `429`, same as above. Far lower than the checked limits, because the client cannot choose to be unchecked and this path exists only for outages. |
| Reports about the same photo from one device | 1 every 24 hours per reason | Treated as already sent; the reply repeats what the first report did (`hidden` as it was). This is a courtesy only: anyone can create a new device identity for free, which is why the address limits above are the real controls. |
| Welfare reports per address | 10 an hour (unchanged, spec §2.6) | As today. |

The welfare and issue limiters stay separate, so one address can send 30 an hour across both forms. That is the real figure, stated openly. A single shared ceiling was considered and rejected: it would let a flood of issue reports stop a real hurt-cat report from the same address, which is the one thing that must not happen.

3. **Four rules about hiding** (proposed, D3). These apply to `photo_private` and `photo_inappropriate`, the two reasons that hide.
   - **(i) A hide needs a verified Turnstile token.** A refused token never reaches this point (it is a `428`); an unchecked row (Cloudflare unreachable) is queued and does not hide.
   - **(ii) A photo the team has restored is not hidden again by a report.** Defined exactly: the photo has **any `restore` row, ever, in `photo_visibility_events`**. A later team hide followed by another restore still counts. New reports on it queue and show in the team's list; only a team member can hide it again. One person cannot hide the same photo over and over, and a wrong hide costs the team one tap, once.
   - **(iii) A volume banner.** The dashboard banner appears the moment the brake in rule (iv) trips. The earlier separate warning at 10 report-hides is dropped, because with the brake at 5 it could never fire first. It never pages anybody (F1).
   - **(iv) A global brake.** Once there have been **5** report-hides in one calendar day (Athens time) (decided by Samuel, 12 October 2026), new hide-type reports are still queued but **do not hide** for the rest of that day. Automatic hiding comes back on its own at midnight Athens time; there is **no "resume" button** (Samuel, 12 October 2026: once tripped, the brake stays on until tomorrow). The dashboard shows a banner while the brake is on. Each such report keeps its place under "Hidden, waiting for you" so the team can hide the real ones by hand in one tap (`hide_photo`). Without this brake, 200 cheap home-connection addresses could hide 3,000 photos in a day, which is the whole catalogue; rules (ii) and (iii) only slow or announce it. Five a day is a deliberately low number: on a day with several genuine privacy reports, the sixth and later wait for a person until midnight, and each reporter is told so honestly (§4.1). Because the brake trips at 5 a day for everyone, the per-address limit (5 an hour, 15 a day) mostly matters for spreading load and is kept as a second line.
4. **The reply says what happened.** Every report answer carries `hidden: true` or `hidden: false`, and the confirmation words are chosen from that field (§4.1). Rules (i), (ii), (iv), the hide limit and the unchecked path can each stop a hide, and a privacy reporter must never be told a photo is down when it is not.

### 8.2 Where these are counted

- The web app and the API are one deployment, served at `apptest.catspotters.com` (the separate `catspotters.com` site is the public website). There is no Cloudflare Worker in front of the API. The sign-in Worker (SYC-202 refers to its rate limits) lives in the separate `catspotters-website` repository and is not in the path of API calls. The API is Express behind Replit's proxy with `trust proxy` set to 4 (SYC-100). Whether `api.catspotters.com` goes through Cloudflare's proxy is not recorded in the repo, and SYC-229 is the ticket that checks every public address sees the same four hops.
- So **Turnstile is verified inside Express** with a `fetch` to Cloudflare's siteverify endpoint (§9). No Worker is needed.
- **Per-address limits are only real once they are counted in a shared store.** `express-rate-limit` counts in memory per process, so limits multiply by the number of instances and reset on every deploy. SYC-105 moves them to a shared store. SYC-170 already makes SYC-105 a precondition for taking the pre-launch pass off, and **the hide limit, the unchecked-row limit and the global brake all count in the shared store**, because a hide limit that resets on deploy is not a limit. The store holds a hashed or truncated address, not the address.
- The pre-launch pass (SYC-113) limits `/api` to testers, which is the main control before launch. The precondition belongs on **the launch-day step that sets `PRELAUNCH_GATE=off`**: Turnstile checked on both forms and the shared limits in place. SYC-114 is the later clean-up that deletes the pass's code and is not the gate itself.

### 8.3 What is accepted

A determined vandal with many addresses can hide up to the brake's threshold of photos once each in a day (rule (ii) stops repeats, rule (iv) stops the flood), and the team restores them one tap at a time. That is the residual risk Samuel accepted on 28 September, now bounded by a fixed daily number rather than by "the number of different photos and addresses".

---

## 9. Turnstile (SYC-170)

### 9.1 What it is, from Cloudflare's current documentation

- A widget runs a challenge in a visitor's **browser** and returns a **token**. The server then sends the token and its **secret key** to Cloudflare's *siteverify* endpoint, which says whether it is valid. Server-side validation is mandatory.
- A token is **single-use and expires after 300 seconds.** An expired or already-used token must be replaced with a fresh challenge.
- siteverify returns, on success, the `hostname` the widget ran on, the `action` label the page set and the `cdata` the page attached. **We check all three**, so a token earned on one form, or for one report, cannot be spent on another.
- **A listed hostname authorises all of its subdomains.** This matters for §9.4.
- Three widget modes: **managed** (Cloudflare decides whether a tap is needed; recommended), **non-interactive** (a visible spinner, no tap) and **invisible** (nothing shown).
- **Turnstile does not run natively.** For a mobile app, Cloudflare's guidance is to load the widget in a **WebView** with JavaScript and DOM storage enabled, network access to `challenges.cloudflare.com`, `about:blank` and `about:srcdoc` allowed, and a user agent that stays the same through the session.

### 9.2 The shared server code

Both forms share one small piece of server code:

- `lib/turnstile.ts`: `verifyTurnstile(token, expectedAction, expectedCdata, remoteIp?)`. Calls siteverify with `TURNSTILE_SECRET_KEY`, a short timeout and one retry using an idempotency key. It returns one of **three** answers, and the difference between the last two is the heart of this section:
  - `ok`: success, and `action`, `cdata` and `hostname` all match.
  - `rejected`: Cloudflare answered, and the token is not good. Missing, wrong, expired, reused, wrong action, wrong `cdata`, **a hostname not on our exact list (§9.6)**, or longer than 2,048 characters (rejected before it is ever sent to Cloudflare). The *sender* controls all of these.
  - `unreachable`: our server could not get an answer: siteverify timed out or answered with a 5xx. Only *our server* can see this, so a sender cannot fake it.
- A request field `turnstileToken` in the JSON body, never a query string and never logged (the request log records only method and path).
- Actions: `welfare_report`, `welfare_draft` and `report_issue`. The `cdata` is the report's `clientRef`, so a token cannot be moved to a different report.
- `TURNSTILE_SECRET_KEY` in the Replit deployment secrets, like the mail keys (spec §2.11). The sitekey is public and goes into the app and the website build. The widget is created through the Cloudflare API (the wrangler token exists; the `turnstile-spin` skill covers it), with its hostnames in §9.6.
- **The visitor's address is not sent to Cloudflare** (`remoteip` is optional). Our own limits use it on our server; Cloudflare's check works without it. Recorded for the privacy policy under SYC-248 (§10).

### 9.3 The website

The Expo web build loads Cloudflare's script and renders the widget in **managed** mode as soon as the report sheet opens, so a token is ready when the person taps send. Because a token is single-use, the page runs a fresh challenge for each send, including each resend from the saved list. `serve-web.js` sets only `frame-ancestors 'none'` as a content-security policy today, so nothing blocks the script. The pre-launch password page (SYC-113) is unaffected: the widget runs inside the already-unlocked app.

### 9.4 The Expo phone apps (the question in SYC-170)

Turnstile is web-first and the phone apps have no browser page to run it in, so there are five ways to cope. **This is decision D10.** A short spike, as SYC-170 asks, belongs at the start of the build to prove the recommended option on a real iPhone and Android phone before anything else is built.

| Option | What it is | Benefits | Risks | For the person |
|---|---|---|---|---|
| **A. A WebView that loads a challenge page on our own app host (recommended)** | Add `react-native-webview`. The app opens a WebView on `https://apptest.catspotters.com/_challenge?action=…` (the launch hostname once it is chosen), a one-screen page that `serve-web.js` serves, that renders the widget and hands the token back to the app. | Follows Cloudflare's own guidance. The widget sees a real hostname we control, so the server can check the hostname exactly (§9.6). Same protection on web and native, for both forms. | A new native dependency, so it needs a new store build, not just a web publish. A WebView adds load time on a weak signal. Cloudflare warns that a changing user agent or blocked storage breaks it. While the pre-launch gate is on, the challenge page must be let through. **In managed mode Turnstile sometimes needs a tap, so the WebView is not always hidden:** it is shown as a small sheet when Cloudflare asks for a tap, and a timeout (about 20 seconds) ends the wait. | Invisible nearly always. When Cloudflare wants a tap, a small sheet appears. If the check cannot finish in time the person sees *"We couldn't run the safety check. Your report is still saved and we'll try again."* and the report stays in the saved list (§9.5). |
| B. Inline HTML inside a WebView | The same, but the HTML is bundled in the app. | No page to host. | Cloudflare's documentation does not say what hostname an inline page shows, so the strict hostname check may be impossible. That is a guess to test, not a fact. | Same as A. |
| C. Open the phone's browser for the challenge and return by link | A challenge page opens in Safari or Chrome and returns the token by deep link. | No WebView. Uses a real browser. | Breaks the flow: the person leaves the app mid-report. Fragile on Android. Poor at the moment someone is upset about a photo. | Noticeably worse. |
| D. App attestation instead (Apple App Attest and Google Play Integrity) | The phone proves the request comes from the genuine app on a real device. | Stronger against scripts that pretend to be the app. Invisible. | Two vendor integrations, Google Cloud setup and server checks against Apple and Google. The web would still need Turnstile. Large for a charity app. | Invisible. |
| E. No challenge on native; Turnstile on web only | The app sends no token. | Nothing to build. | **Nothing stops a script from simply not sending a token and claiming to be the app, so the web protection is bypassed.** The API would accept tokenless requests forever. | None. |

**Recommendation: A.** It is the approach Cloudflare documents, it keeps one rule for web and native, and it is the only option of the five that lets the hostname check be exact. Adopt D later if scripted abuse of the native path ever appears. Reject E, because it quietly makes the whole feature optional.

### 9.5 When the token is not good, and when Cloudflare cannot be reached (decision D11)

Whether a token is present, correct or fresh is the **sender's** choice, so a missing token can never be treated as an excuse to accept. The earlier draft got this wrong: it would have accepted a tokenless welfare report as "unchecked", which means a script that never sends a token gets exactly what a real person gets, a place near the top of the welfare queue. The queue is the scarcest resource in the system. The rule is now the same for both forms and has two cases:

| What happened | Who can cause it | What the server does | What the app does |
|---|---|---|---|
| **The token is missing, wrong, expired, reused, for the wrong report, from the wrong hostname, or too long** (`rejected`) | The sender | Answers **`428 challenge_required`** and **creates nothing**: no row, no hide, no email | **Keeps the report**, runs a fresh challenge and sends again. This answer does **not** count toward the "refused three times, so give up" rule in `reportQueue.ts`, which would otherwise mark the report `failed` and stop retrying. If the challenge never works on a phone, the existing 24-hour reminder still tells the person it has not been sent. |
| **Our server could not reach Cloudflare** (`unreachable`: timeout or a 5xx) | Only our side | **Accepts the report** and marks it unchecked (`token_checked = false`). An issue report in this state is queued but **never hides**. A cat-in-trouble report in this state is queued and emailed, within the limits below. | Treats it as sent. |

Why this is safe for real people: the person has already seen the vet-first advice before sending (§2), a refused send loses nothing because the app still holds the report, and a Cloudflare outage never costs a hurt-cat report.

**Unchecked rows are fenced in, because they are rare.**
- They sit in **their own list below the checked ones** (§5.3), never in the urgent-first ordering of the welfare queue.
- They have their **own, much lower per-address limit** (3 an hour, both forms together, §8.1).
- Cat-in-trouble rows in this state still send their individual alert email, because a hurt cat must not wait, but with a safety net of 10 an hour in total, the rest rolled into one "N unchecked reports waiting" line.
- Because the outage case is the only way to get here, and the sender cannot cause it, the unchecked list should be empty almost all the time. The dashboard shows its count, which is a handy early sign that the Cloudflare check is broken.

**The draft route is protected too.** `POST /api/reports/draft` writes the "Started but not sent" rows, and the first draft of this spec did not mention it. It needs a token like the final send (action `welfare_draft`; the widget re-runs silently, so the draft and the submit each get their own). The same two cases apply: a bad token is a `428` that creates nothing, and during a Cloudflare outage the draft is accepted, marked unchecked and shown collapsed. The photo upload (`PUT /reports/:publicId/photo`) needs no token of its own: it is tied to the device and to a report that has already passed the check.

**Sending from the saved list (a resend).** The duplicate check comes **before** the token check, because the resend key `(reporter_device, kind, client_ref)` would otherwise swallow a good resend:
1. If no report with that reference exists, the token is checked as above.
2. If one exists and is not an upgrade case, the reply repeats the first answer (including `hidden`).
3. **The upgrade case.** If an existing issue report is *unchecked*, not yet decided by the team, and its photo has never been restored, a resend of the same reference **with a valid token upgrades it**: it is re-marked checked and, if rules (ii) to (iv) and the hide limits allow, it hides then. Without this, a Cloudflare blip on the first send would leave a real privacy report permanently unable to hide, with no way for the app to fix it.

### 9.6 The hostname check

- The app is served from **`apptest.catspotters.com`** and the API is on the same deployment. `catspotters.com` is the separate public website. So the challenge page is `https://apptest.catspotters.com/_challenge`, not a page on `catspotters.com`.
- Cloudflare authorises **all subdomains** of any hostname listed on the widget. Listing `catspotters.com` would also authorise `team.`, `admin.`, `api.` and any subdomain added later. So the **production widget lists only the exact app host** (`apptest.catspotters.com` now, plus the launch hostname once Samuel picks it; no document yet records what the web app's launch address will be, so it is recorded as a dependency).
- **The server keeps its own exact list of accepted hostnames** and compares the `hostname` that siteverify returns against it. A strict check for `catspotters.com` would have refused every real token, because all of them come from `apptest.`. A token whose hostname is `team.catspotters.com` is refused.
- Replit preview domains and `localhost` get a separate **test** widget with Cloudflare's published test keys, so the production widget never lists a development host.
- The spike (§13) must check the exact hostname string that a token from the phone WebView reports.

---

## 10. Privacy of the reporter

- **No account, no sign-in, no name.** A report carries the device identifier every report carries (trust-on-first-use, a courtesy check; welfare spec §4.4). It is stored on the row so the app's own resend is recognised, and is cleared by SYC-63's "delete my data" like the welfare reports' device ids. It is never shown on the queue or in the email.
- **The IP address is not stored on the report, and is not sent to Cloudflare.** It is used on our own server for limits and not kept. (The limit counters hold it, hashed or truncated, for their window.) The privacy policy must say this precisely under SYC-248; Turnstile still sees what the visitor's own browser tells it.
- **The note is team-only.** It never appears publicly, never reaches the cat's owner, a cat guardian or other spotters, and is escaped everywhere it is shown. This is enforced by the capability rules in §5.3, not by hoping nobody opens the page.
- **No email is collected** on this form (decision D9), so there is no address to hold, verify or delete, and no change to `email-capture.md` or the privacy policy's list of when we ask for an email.
- **The team sees "reported by a member of the public" and nothing else.** A cat's owner, a guardian, or the person who took a hidden photo is never told who reported it. The person who took the photo sees only the neutral tile (D4).
- **Retention of issue reports (proposed, D12):** the row and its note are kept **one year after the report is closed**, then the note is deleted and the bare record (reason, target, decision, dates) stays, so "have we been asked about this photo before?" still has an answer. This is shorter than the three years for welfare reports because an issue report is not part of a cat's welfare history. `privacy-policy.md` must carry it, **and** its present line that "the report and what you wrote in it stay with the cat's record" must change, because the note is deleted after a year (SYC-248).
- **Cloudflare becomes a processor for this feature.** Turnstile sends a visitor's browser signals to Cloudflare. The privacy policy and the data agreement must name it (as SYC-124 does for Neon). `privacy-policy.md` owns the wording.
- **Hidden photos and caches.** The policy must not imply that hiding recalls a copy already in someone's hands (§6), and must say what is done about addresses (D14).
- **A report that says a photo shows a person describes an identifiable image,** which is one more reason the note is team-only and its retention is stated.

---

## 11. English, Greek and French

- **Everything the reporter reads is a language string,** in the three dictionaries `lib/i18n.ts` already holds: the reasons, the first line about hurt cats, the confirm step, the confirmations (online, offline, hidden, not hidden), the "safety check could not finish" message, the tile that replaces a hidden photo and the offline reminder. On the web, strings that say "saved on your phone" say "saved in this browser" instead.
- **No language needs storing for a reply:** nothing is sent to the reporter, so `reporter_language` has no use for this kind of report.
- **The team side is English only** (the dashboard is English today). The reason shown to the team is the **key's English label**, never free text from the app, so a Greek speaker's `photo_private` reads the same as an English one's.
- **The confirm step is the high-risk string.** The approved English wording is exact ("hide it from everyone until Syros Cats have reviewed it"). Its Greek and French must keep both halves (everyone, and until reviewed). **Native-speaker review is a launch blocker for this feature's three languages** and joins SYC-4, SYC-154 and SYC-172. Greek capitals drop accents (SYC-159); use `displayUpperCase`.
- Reasons are fixed strings and are never machine-translated at read time.

---

## 12. Open decisions

Each lists every realistic option, the benefits and risks, what changes for people, and a recommendation. **D2, D3, D4, D5 and D11 touch things already decided and are marked as amendments or additions** (the table near the top lists them all). D1 and D2 gate the rest. Where the adversarial review changed a decision, it carries a **"Changed after review"** note. D14 is new.

**Samuel's decisions, 12 October 2026.** Each decided decision below carries a "Decided" line, and where his choice differs from the recommendation (D3, D5, D9) a "What this choice accepts" line. The options tables are kept as the record of what was weighed. Decided: D1, D2, D3, D5, D6, D9, D10, D11, D12, D13, D14 and the smaller calls. D4, D7 and D8 were not part of this round and still stand as recommended.

### D1. Where do "Report an issue" reports live?

| Option | Benefits | Risks | UX | Team |
|---|---|---|---|---|
| **A. The same table as cat-in-trouble reports (`welfare_reports`, `kind = 'content'`) (recommended)** | One queue, one set of states, one note and history. `kind` and its check already exist for this, and spec §8.4 already says so. Reuses the outbox, delivery tracking and team page. | The table was built around cats in trouble, and several code paths assume a welfare report (§5.1 lists each). A careless reuse could write a `welfare_outcome` on a cat, show "Photo still uploading", or count a death report as proof the cat is alive. | None. | One list to watch. |
| B. A sibling table, `issue_reports`, with its own state history | Welfare reports stay untouched. Cleaner types. | Two tables, two state histories and two sets of team pages for what the team sees as one inbox. This is the "second inbox" the brief says not to build. `report_state_events` has a foreign key to `welfare_reports`, so it would need a twin. | None. | Two lists, or one page stitching two sources. |
| C. Email only, no queue row | Least to build. | Loses everything the queue exists for: states, notes, "did anyone handle this?". Reverses the approved "arrives in the queue". | None. | A shared inbox is not a record. |

**Recommendation: A**, on the condition that every item in §5.1 is done and tested: `photo_state = 'none'` on content rows; no "which cat is this?" on them and no `welfare_report` observation ever written for them; no `welfare_outcome` on close; the resend key includes the kind; the mail-failure banner counts both alert purposes; a retention job that checks the kind; and a migration with a rollback.

**Changed after review:** the recommendation stands, but the review found the reuse breaks more than the draft listed (the "which cat is this?" feature, evidence of life, the resend key, the banner, retention, the rollback), so those are now conditions.

**Decided (Samuel, 12 October 2026): option A, as recommended, with every condition in §5.1.**

### D2. Which reasons hide on one confirmed report? (amendment to §6)

The approved spec hides only for "upsetting or inappropriate". But "shows a person, a house number or a number plate" is the privacy case the ticket calls out, and it is as harmful to leave up.

| Option | Benefits | Risks | UX | Team |
|---|---|---|---|---|
| A. Only `photo_inappropriate` hides (as approved) | Narrowest; fewest wrong hides. | A photo with a face or a front door stays up until somebody reads an email. | A privacy reporter is told nothing is hidden, the wrong answer for the most sensitive case. | Less to restore. |
| **B. `photo_inappropriate` and `photo_private` hide (recommended)** | Covers both cases where delay does real harm. The confirm step and D3's safeguards apply to both. | Slightly more room for vandalism (two reasons that hide, not one). | A privacy reporter gets immediate relief. | A few more hidden photos to review. |
| C. All photo reasons hide (`photo_not_cat` and `wrong_cat` too) | Simplest rule: a photo report hides the photo. | Makes the least harmful reasons the easiest weapon. A tourist who disagrees about which cat it is would hide a good photo. | Over-hides. | Many more restores. |

**Recommendation: B**, but only together with D3's global brake (rule (iv)) and the narrower `photo_private` hint ("faces, house numbers, number plates, inside a home or garden"; not "a doorway").

**Changed after review:** the condition is new. Without the brake, making a second reason hide widens what a vandal can take down; without the narrower hint, the reason most likely to be misused becomes easier to pick by accident.

**Decided (Samuel, 12 October 2026): option B, as recommended.** "It's upsetting or offensive" and "It shows a person or a private place" both hide on one report. The narrower hint reads "faces, house numbers, number plates, inside a home or garden".

### D3. Safeguards on a one-report hide (additions)

The approved mitigations are the confirm step, Turnstile, a volume alert and one-tap restore. Four more are in §8.1: **(i)** a hide needs a verified Turnstile token; **(ii)** a photo the team has ever restored is not hidden by a later report; **(iii)** per-address hide limits (5 an hour, 15 a day); **(iv)** a global brake: after 5 report-hides in a calendar day (Athens time), new ones queue without hiding until midnight, with a dashboard banner and no resume button.

| Option | Benefits | Risks |
|---|---|---|
| A. Only the approved four | Matches what was signed off. | One person can re-hide a restored photo every day; a script on many addresses is only slowed by Turnstile and could hide a large part of the catalogue in a day. |
| **B. All four additions (recommended)** | Bounds a vandal to one hide per photo, a handful per address and about 5 photos a day in total before a person has to step in. A real private-photo report on a fresh photo still hides at once, outside a flood. | Rule (ii) means a photo restored by mistake and then genuinely reported again stays up until a person looks. Rule (i) means an unchecked privacy report (Cloudflare unreachable) waits for a person. Rule (iv) means that during a real wave of reports, later ones wait for a person, so the team must watch the banner. The confirmation copy never over-promises (§4.1). |
| C. Only (i) | Smallest change. | Leaves repeat-hiding and mass-hiding open. |

**Recommendation: B**, with rule (ii) meaning "the photo has any restore on record, ever". If Samuel rejects (ii), repeat-hiding returns; if he rejects (iv), a vandal with many addresses can hide the catalogue and the volume banner is the only defence. 

**Changed after review:** rule (iv) is new, and rule (ii) is defined exactly so a later hide followed by a restore stays protected.

**Decided (Samuel, 12 October 2026): option B, with the brake at 5 report-hides in a calendar day (Athens time), not 20, and no "resume" button: once tripped, automatic hiding stays off until midnight.** The team can still hide photos by hand. **What this choice accepts:** on a day with several genuine privacy reports, the sixth and later wait for a person until midnight; each reporter is told the photo is not hidden yet.

**What this choice accepts:** on a day with several genuine privacy reports, the sixth waits for a person. That is acceptable because the reporter is told honestly (the `hidden: false` words in §4.1). It also means the team must watch the banner on a busy day, and that the earlier separate banner at 10 report-hides is replaced by the brake's own banner.

### D4. What do the public and the photo's taker see when a photo is hidden? (amendment)

**Decided (Samuel, 12 October 2026): as recommended (A for D4 and D7, B for D8).**

The approved text says a hidden photo "stays visible to staff (and to whoever uploaded it)". The photo route is open and unauthenticated, so showing a hidden photo to its taker would need photo requests to carry a device secret, and PR 6's plan says a hidden photo answers `404` for everyone.

| Option | Benefits | Risks | UX |
|---|---|---|---|
| **A. Hidden for everyone but staff; the sighting stays in the list with a neutral tile, "Photo hidden while Syros Cats take a look." (recommended)** | Simple, matches PR 6, no change to how photos are fetched. Tells a wrongly hidden photo's taker what happened. | The taker cannot see their own photo while it is hidden. The tile tells everyone a photo was hidden (not why, not by whom). | Calm and honest. |
| B. As approved: also visible to the uploader | Kind to a wrongly hidden photo's taker. | Photos would need device-authenticated reads, which changes the photo route, its caching and the pre-launch headers. The device is trust-on-first-use, so "the uploader" is a weak notion. A privacy-hidden photo would still be shown to some device. | Better for the taker, worse for the privacy case. |
| C. The sighting is hidden too, with no tile | Nothing signals that anything was hidden. | The sighting count and points stay but the list shows less than the count says. | Confusing. |

**Recommendation: A.** The review agrees; no change.

### D5. Can the team remove a hidden photo for good?

The approved hosting spec (`hosting-and-photo-storage.md` §6.5, approved 28 September) already says a photo-removal path "arrives in the same window as" this flow, and gives its contract: removing is **one database write**; anything that referred to the photo **degrades gracefully** (a cat whose main photo is removed shows the placeholder); and removal is **recorded: who, when and why**. The draft treated deletion as new design and recommended leaving it out.

| Option | Benefits | Risks | UX |
|---|---|---|---|
| A. Hide only for now; a ticket for a real removal, decided before launch | Reversible, simplest, matches PR 6. | **This amends hosting §6.5** and needs Samuel's explicit yes. A person whose face is in a photo gets restriction, not erasure, until removal ships. The photo stays in the database and as a matching reference. The privacy policy must say so honestly. | The reporter gets hide-now only. |
| **B. A narrow, management-only removal before launch, under hosting §6.5's contract (recommended)** | Honours what hosting already promised, so nothing approved is amended. Applies only to a photo that is **already hidden for a privacy reason**, and asks for a typed confirmation. As recommended it was management only, because it cannot be undone; Samuel widened it to any team member (see below). It also takes the photo out of matching, which hiding does not. Needs one new catalogue row, `remove_photo` (§5.5). | Irreversible, so a wrong removal cannot be fixed (the confirmation and the management-only rule are the guard). The photo may be a cat's main photo, a sighting's photo and a matching reference, so the plan must list each place and prove it degrades gracefully. It is the same family of work as SYC-63's severing. | The strongest answer to "please take my face out of your app". |
| C. Do not offer removal at all | Nothing to build. | A person with a legal right to erasure of their image is turned away. Contradicts hosting §6.5. | Poor. |

**Recommendation: B**, kept deliberately narrow. If Samuel prefers A, that is an amendment to hosting §6.5 and he should say so explicitly.

**Changed after review:** the draft recommended A and called removal new. The review showed hosting §6.5 already commits to it, so B is now the recommendation and A is marked as an amendment.

**Decided (Samuel, 12 October 2026): option B, widened. Any Syros Cats team member (not only management) can delete a hidden privacy photo for good.** It is still only on a photo that is already hidden for a privacy reason, with a typed confirmation, under hosting §6.5's contract (one write, recorded who, when and why). `remove_photo` is therefore island-only for **team and management** in the §5.5 catalogue addition.

**What this choice accepts:** the action is irreversible and more people can do it. Every removal is recorded with who did it, and the typed confirmation and the privacy-hidden-only rule are the guards that remain.

### D6. What does "the map spot or the words show where someone lives" do?

Positions are already blurred to a 250 m cell (data spine PR 6). What a report can touch is the home description (public text on the cat page, SYC-232's subject) and, for a feeding-site cat, the spot.

**A dependency to settle first.** The owner can rewrite `homeDescription` whenever they like (the claiming-a-cat review, SYC-130, finding F3), and that review recommends making the description visible only to the owner and the team. If SYC-130 adopts that, half of this problem disappears, the clear-the-text action may be unnecessary, and option A below shrinks to "the team looks". If SYC-130 leaves it public, clearing the text is undone the next time the owner edits it, so the plan must say what the team does about repeats. **D6 therefore waits on SYC-130's decision about the home description.**

| Option | Benefits | Risks | UX |
|---|---|---|---|
| **A. The report goes to the queue as a distinct "location" issue and the team acts by hand; if the description stays public, a narrow team action clears it (recommended)** | No automatic change from one report. Clearing text is small, add-only and recorded, and the text is the likelier problem. | Until a person reads it, the text stays up. Only the text can be fixed, not the map spot. The action needs a catalogue row first: `clear_home_description` (§5.5), island-only, not `edit_cat_text`, which was too broad. | The reporter is told the truth: "Syros Cats will take a look." |
| B. A single confirmed report also hides the cat's map spot and home text, pending review | Fast for the person it concerns, in line with photos. | Needs a new "position hidden" mechanism in the data spine, which does not exist. Easy to weaponise: one report removes a cat from the map. | Strong for the worried neighbour, poor for the cat's spotters. |
| C. Nothing special: it is just `other` | No work. | Loses the one case where delay can expose where a person lives. | None. |

**Recommendation: A**, with a ticket for B's mechanism, to be decided after launch with Syros Cats, and with the new catalogue row added to the roles spec first.

**Changed after review:** the capability is renamed and narrowed (`clear_home_description`), it needs a roles-catalogue row first, and the whole decision waits on SYC-130.

**Decided (Samuel, 12 October 2026): option A, as recommended.** The team handles it by hand, with `clear_home_description` (team and management). It still waits on SYC-130's decision about whether the home description is public: if SYC-130 makes it owner-and-team only, the action may not be needed.

### D7. A cat reported as died

**Decided (Samuel, 12 October 2026): as recommended (A for D4 and D7, B for D8).**

| Option | Benefits | Risks | UX |
|---|---|---|---|
| **A. The team decides; the report alone changes nothing (recommended)** | A false report cannot declare a living cat dead. The team's "no longer with us" action already needs a reason and a date. | A real death waits for a person. | Respectful. The cat page never changes on a stranger's say-so. |
| B. Several independent reports flip the status | Faster for a well-known cat. | Easy to fake with many devices. A false "no longer with us" is cruel to show a cat's owner. | Risky. |
| C. A public tag, "reported as died, being checked" | Honest in the open. | A public announcement of a possibly wrong death. | Upsetting. |

**Recommendation: A.** A `cat_died` report also never triggers a push to the cat's spotters, and a `cat_died` row can never be tied to a cat in the "which cat is this?" step (§5.1), because that would be counted as proof of life.

**Changed after review:** only the tie ban is added.

### D8. How does a person report one photo?

**Decided (Samuel, 12 October 2026): as recommended (A for D4 and D7, B for D8).**

| Option | Benefits | Risks | UX |
|---|---|---|---|
| A. A small flag icon on every thumbnail | Always visible. | Clutter on a grid of dozens of photos. Small tap targets. Teaches people to feel watched. | Noisy. |
| **B. Tap a photo to see it larger, with "Report an issue with this photo" under it (recommended)** | Quiet, big tap target, no hidden gesture, same on the web. The full-screen view is useful on its own. | A new screen to build and an extra tap. | Calm. |
| C. Only on the cat page, with a "which photo?" step | Least to build. | The reporter must find the photo again in a picker. | Clumsier. |

**Recommendation: B.** The review agrees; no change.

### D9. What does the reporter get back?

| Option | Benefits | Risks | UX | Team |
|---|---|---|---|---|
| **A. On-screen thanks; one closing email only if they left a verified address, in the approved Part 2b wording (recommended)** | Same as welfare reports. Needs nothing new in the closing mail. | Most reporters give no address and hear nothing. **The email box on this form is a new moment when people are asked for an email, so it amends `email-capture.md`'s closed list of asks and the privacy policy's "four moments" line.** | Calm; no promise. | No mail work for most reports. |
| B. A, plus a push when the report is closed | Closes the loop for the majority at no sending allowance. | The push machinery targets cats and spotters, not reports. Tells people when a decision about their photo is made. | Nicer. | Extra build. |
| C. A "my reports" list in the app | Always available. | A new screen. Raises expectations of a reply. | A promise. | More to answer. |
| D. Nothing at all, and no email box | Least. Amends nothing. | A person who reported something private gets no closure. | Cold. | None. |

**Recommendation: A.** It matches the open push question in the welfare spec (§9.2); revisit when Samuel decides that one. Samuel is asked to approve the amendment to `email-capture.md` and `privacy-policy.md` explicitly (option D avoids it).

**Changed after review:** the closing text is now the approved Part 2b wording rather than new wording (so it amends nothing), and the new email moment is flagged as an amendment.

**Decided (Samuel, 12 October 2026): option D, no email box.** Report an issue has no email box, and the reporter gets an on-screen thank-you only. The email box, the verified closing email, the related tests and the amendment to `email-capture.md` and the privacy policy are all removed from this spec; no new email moment is added.

**What this choice accepts:** reporters never hear the outcome (a person who reported something private gets no closure). Recommended option A would have given a closing email to the minority who left a verified address.

### D10. How does Turnstile work in the phone apps?

See §9.4. **Recommendation: A, a WebView on our own challenge page,** proven first by the spike.

**Changed after review:** three conditions. (1) The page is on the app's own host, `apptest.catspotters.com` for now, not `catspotters.com`, and the widget lists only that exact host (§9.6). (2) The WebView is shown as a small sheet when Cloudflare asks for a tap, with a timeout and a "safety check couldn't finish" fallback (§9.4). (3) The spike checks the exact hostname string a phone token reports.

**Decided (Samuel, 12 October 2026): option A, as recommended.** A WebView on our own challenge page, proven first by the spike.

### D11. What if the Turnstile token is missing or wrong, or Cloudflare can't be reached? (amendment to SYC-170's wording)

See §9.5. The draft recommended accepting a welfare report with no valid token and marking it "unchecked" (option B below). The review showed that makes Turnstile decoration on the welfare queue: whether a token is present is the sender's choice, so a script that never sends one gets exactly what a real person gets, a place near the top of the queue, while using up the capped alert emails that a real tourist with a failed WebView needed.

| Option | Benefits | Risks | For the reporter | For the team |
|---|---|---|---|---|
| **A. Split by cause (recommended).** If the token is missing, wrong, expired or reused, refuse with a retryable `428 challenge_required` and create nothing; the app keeps the report, runs a fresh check and resends, and this does not count toward the three-strikes "failed" rule. Accept as "unchecked" only when our own server cannot reach Cloudflare. Unchecked rows sit in their own list below the checked ones, with a much lower per-address limit. Drafts need a token too. | A real report about a hurt cat is never lost: the phone still holds it. A script that sends no token gets nothing, so the welfare queue is protected as well as the inbox. The only relaxation of SYC-170's wording is the Cloudflare outage case, which the sender cannot cause. | Needs a small client change so a `428` is retried instead of counted. A phone whose check never works keeps its report until the 24-hour reminder. A Cloudflare outage lets in a few unchecked rows (limited). | A short delay on a phone whose check fails, with an honest message. Nothing visible when it works. | A small "unchecked" list, normally empty. |
| B. (the draft) Accept it, mark it "unchecked", cap the alert emails for unchecked rows | No refusal ever. | **Any script that sends no token is accepted into the queue, at the top of the urgent list.** The draft route would have skipped the check as well. The cap lets a script use up the alert emails a real tourist needs. | Nothing visible. | The scarcest resource (the queue) is unprotected. |
| C. Refuse with a plain `403` (the original option A) | Matches SYC-170's wording exactly. | After three refusals the app marks the report `failed` and stops retrying, so a real report is lost. | A sad failure at the worst moment. | Cleanest queue. |
| D. Accept it with no Turnstile on the welfare form | Simplest. | Turns the check into decoration; the welfare spec's own §4.4 says Turnstile is there for exactly this. | Nothing. | A flood hits the queue and inbox. |

**Recommendation: A, for both forms.** An unchecked *issue* report never hides. This relaxes SYC-170's "checked before a report is accepted" only when our server cannot reach Cloudflare; Samuel is asked to say yes to that.

**Changed after review:** replaced. The draft's recommendation (B) was a blocker.

**Decided (Samuel, 12 October 2026): option A, as recommended.** A bad token from the phone gets a quiet retry (`428 challenge_required`, a fresh challenge, then the report is sent again). "Unchecked" is accepted only when Cloudflare is unreachable.

### D12. How long are issue reports kept?

| Option | Benefits | Risks |
|---|---|---|
| **A. One year after closing, then delete the note and keep a bare record (recommended)** | Short enough that personal text does not pile up; long enough to spot repeat problems. | A different rule from welfare reports (three years), which the privacy policy must explain. |
| B. Three years, like welfare reports | One rule. | Keeps a note about a stranger's photo longer than its purpose needs. |
| C. Delete on closing | Least data. | "Have we been asked about this before?" cannot be answered. |

**Recommendation: A**, with a retention job that checks the report's kind (it must not delete welfare notes at one year or keep issue notes for three), and with the privacy policy's line "the report and what you wrote in it stay with the cat's record" corrected under SYC-248.

**Changed after review:** the two conditions are new.

**Decided (Samuel, 12 October 2026): option A, as recommended.** One year after closing, then the note is deleted and a bare record stays.

### D13. When does this ship relative to the rest of the queue work?

The hide needs SYC-43 part 2's **PR 6** (`photo_visibility_events`, `publicPhotoUrl()`). The rest of that plan, up to and including "Which cat is this?" (PR 5), is already merged.

| Option | Benefits | Risks |
|---|---|---|
| **A. Build it after PR 6 (recommended)** | One hiding mechanism and one inbox, as SYC-44's comment and the plan require. | Cannot ship ahead of PR 6. |
| B. Ship the non-hiding reasons first (name, cat, died, other) and add hiding when PR 6 lands | Earlier value for corrections. | Two releases of the same sheet, and the privacy reasons, the point of the feature, arrive last. |
| C. Build a temporary hide of its own | Ships sooner. | A second hiding mechanism, which the plan explicitly rejected. |

**Recommendation: A.** Turnstile on the welfare form (SYC-170), with the split in D11, does not wait for PR 6 and goes first, because it is the precondition for the launch-day step that takes the pre-launch pass off.

**Changed after review:** only a correction to the PR 5 fact and the D11 design.

**Decided (Samuel, 12 October 2026): option A, as recommended.** Build after PR 6; Turnstile on the welfare form goes first.

### D14. How do we stop a hidden photo living on in caches? (new, from the review; SYC-279)

Photos are served with a one-year, never-re-check cache lifetime. When a photo is hidden, a `404` from our server does not remove a copy that a browser, the app or a shared cache has already stored. If the API sits behind Cloudflare's proxy (not recorded; SYC-229), the copy could be served to **anyone who has the address**, not only people who saw it before, for up to a year. For a face or a front door, that is the part that matters.

| Option | Benefits | Risks | What people notice |
|---|---|---|---|
| A. A much shorter cache lifetime on public photos (say one day, no "never re-check") | Simple. A hidden photo is gone from shared caches within a day. | More load on the server and more data used; still up to a day of exposure. | Photos may load slightly slower on weak signal. |
| B. If the API is behind Cloudflare's proxy, clear that photo's address from Cloudflare's cache when it is hidden | Immediate at the edge, no change to normal caching. | Only works if the proxy is in place (SYC-229 must confirm), needs a probe test, does nothing for phones and browsers that already hold the copy. | Nothing. |
| **C. Give the photo a new public address whenever it is hidden or restored (recommended)** | The old address is dead everywhere at once: browser, app, shared cache. Most robust, and `publicPhotoUrl()` already owns building addresses. | A small change to PR 6's design (a rotating public id), and addresses saved elsewhere stop working, which is the point. | Nothing visible. |
| D. Do nothing | Nothing to build. | A hidden private photo can stay reachable for a year. | A privacy reporter's photo may not really be gone. |

**Recommendation: C**, whichever of the others is also chosen, and the privacy policy says what is and is not recalled. A moved sighting (SYC-150) keeps the photo's internal id, so rule (ii)'s restore history survives.

**Decided (Samuel, 12 October 2026): option C, as recommended.** A photo gets a new public web address whenever it is hidden or restored (SYC-279).

### Smaller calls inside the decisions

These had a proposed value and needed only a nod from Samuel: the global brake threshold (5 report-hides in 24 hours, D3); the unchecked-row limit (3 an hour per address, D11); individual "Photo hidden" alert emails capped at 10 an hour, the rest in a daily digest (§5.2); and not sending the visitor's address to Cloudflare (§9.2).

**Decided (Samuel, 12 October 2026): all accepted as recommended.** At most 10 individual "Photo hidden" alerts an hour, with the rest in a daily digest; 3 unchecked rows an hour per address; no visitor address sent to Cloudflare; and no shared request ceiling across the two forms (§8.1 keeps the separate limits, and states the 30-an-hour figure openly). The brake threshold is now 5, not the proposed 20 (D3).

---

## 13. Technical notes

*For whoever writes the implementation plan.*

- **API:** `POST /api/issues` with `deviceId`, `clientRef`, `reason`, `catId`, `photoPublicId`, `note`, `language`, `turnstileToken`. The reply carries `hidden: true|false`. The app already holds the public photo id inside `photoUrl`; the server maps it to `photos.id`. `lib/api-spec/openapi.yaml` and the generated clients gain the route. `POST /api/reports` and `POST /api/reports/draft` gain `turnstileToken` and the `428 challenge_required` answer; older builds in testers' hands get a plain refusal they already handle. Siteverify calls use `verifyTurnstile` with `cdata = clientRef`.
- **One transaction** writes the report row, the hide and the queued alert. A test proves a report on a hidden photo is still recorded.
- **Order inside the endpoint:** the duplicate check (by device, kind and `clientRef`) first, then the token, then the limits, then the rules (i) to (iv), then the write. The upgrade case (§9.5) runs inside this order.
- **`photo_visibility_events` author** is `report:<id>`; a restore is a person id (PR 6 already allows both). If D14 option C is adopted, hide and restore also give the photo a new public id.
- **Team pages** extend `lib/teamPages/queuePage.ts` with an Issues section (and the unchecked list) and the team cat page with a "Reports about this cat" strip, all gated by `view_welfare_queue` (§5.3). Server-rendered HTML like the rest; no scripts.
- **Mail:** a new alert builder beside `lib/welfare/alertEmail.ts`; same outbox, same send function, same attachments rule, its own purpose `issue_alert` placed in the shed order (§5.2). The queue's mail-failure banner counts both purposes. `urgent_alert` stays OFF (F1).
- **Rate limits** use `express-rate-limit` until SYC-105's shared store exists; the hide, unchecked and brake counters are written against the shared store from the start.
- **Native:** `react-native-webview`, a `/_challenge` route in `serve-web.js` on the app host (let through the pre-launch gate), a client twin of `lib/turnstile.ts` and a change to `reportQueue.ts` so a `428` is retried with a fresh check and never counts toward the three-refusals rule. A separate test widget for development.
- **Order of work.** (1) Add the catalogue rows to the roles spec: `remove_photo` (team and management, D5) and `clear_home_description` (D6, only if SYC-130 leaves the home description public). (2) Spike A on a real iPhone and Android phone: the WebView loads the challenge page, a token arrives, siteverify returns the expected `action`, `cdata` and the exact `hostname`. (3) `lib/turnstile.ts`, the secret and the exact-hostname list. (4) The welfare form and its draft route with D11's split, including the client change; this goes first and does not wait for PR 6. (5) PR 6 of the queue plan, then the migration and every guard in §5.1, then Report an issue. (6) Shared limits (SYC-105), including the hide limit and the brake. (7) The launch-day `PRELAUNCH_GATE=off` step is allowed only after (4) and (6); SYC-114 deletes the pass's code afterwards.
- **Tests that must exist** (named so they appear in the plan):
  1. A confirmed `photo_private` or `photo_inappropriate` report with a valid token hides the photo in the same transaction (`hidden: true`), and it then answers `404` on the public route and is absent from the cat list, cat detail, match candidates and notifications.
  2. The same report with a missing, wrong, expired, reused, wrong-`cdata` or over-long token gets `428 challenge_required` and creates no row and no hide. The same request when siteverify times out, or returns a 5xx, creates an **unchecked** row that does not hide.
  3. A photo that has any `restore` row is not hidden by a later report, including one that was hidden again by the team and restored a second time (`hidden: false`).
  4. The 6th hide from one address in an hour does not hide and the row says so, across two processes (tested on a day the global brake has not tripped).
  5. With 5 report-hides in a calendar day (Athens time), the 6th queues without hiding (`hidden: false`) and the banner shows; there is no resume control; after midnight Athens time the next report hides again.
  6. For each refusal reason (address limit, rule (ii), the brake, unchecked), the response says `hidden: false` and the shown confirmation is the "not hidden yet" text, never the hidden text.
  7. A `cat_died`, `wrong_name`, `wrong_info` or `location_revealing` report changes nothing public.
  8. Closing an issue never writes a `welfare_outcome`, and a welfare closing still does. **No `welfare_report` observation is ever written for a content row**, and the tie route refuses one.
  9. A content row is written with `photo_state = 'none'` and never shows "Photo still uploading" or delays its alert.
  10. An issue report and a welfare report from the same device with the same `clientRef` are two separate reports.
  11. The queue and its JSON never carry the reporter's device id, address or IP, and a photo only as a team URL.
  12. The alert email carries no reporter details and attaches the photo; every typed string is escaped. 500 issue alerts in an hour cannot delay a `welfare_alert`.
  13. Turnstile: wrong `action`, wrong `hostname` (a token reporting `team.catspotters.com`), wrong `cdata`, `success: false`, a reused token and a timeout are each handled as §9.5 says; the secret is never logged.
  14. A saved report is sent with a fresh check and never says "hidden" before the server has answered; a second send of the same `clientRef` makes one report; **a resend with a valid token upgrades an unchecked, undecided, never-restored issue report to a hide**; a resend of a decided or restored one does not.
  15. The cat-in-trouble draft route with no token gets `428` and writes nothing; with a Cloudflare outage it writes a collapsed unchecked draft.
  16. In the app queue test, a `428` is not counted toward the three refusals and the report is kept and retried.
  17. **Route walk (added to the roles spec's route-walk test):** a guardian whose colony holds a cat that has an issue report sees no "Reports about this cat" strip, no Issues section, and a refusal on the reported-photo route and the alert links; a team member sees all of them.
  18. The reason sheet's first line links to "This cat needs help"; the "Think this cat is alive?" link opens the sheet with `wrong_info` chosen.
  19. Each of en, el and fr has every new key; web strings say "saved in this browser".
  20. The source test PR 6 adds (no hand-built `/api/photos/` addresses) covers any place this feature adds.
  21. The retention job deletes an issue note at one year and a welfare note at three, and never the other way round.
- **Browser check before the PR:** the reason sheet, confirm step and full-screen photo at 390 px and desktop, with data, in all three languages.

---

## 14. Risks

| # | Risk | What we do |
|---|---|---|
| 1 | **The hide is used to vandalise the catalogue.** | Accepted by Samuel (28 Sep). Narrowed by §8.1: token, no re-hide after any restore, per-address caps and the global brake. |
| 2 | **A privacy report is slower than the person needs** (offline, Cloudflare unreachable, the hide limit or the brake). | Honest copy chosen from `hidden: true|false`; the queue row always exists; D5 and D14 keep true removal and cache exposure open rather than hiding them. |
| 3 | **"Hidden" is mistaken for "erased".** | §6 says what it does not cover; the privacy policy must not overpromise. |
| 4 | **Issue reports bury welfare reports.** | A separate section below, never above, with its own colour band and label; the first line of the reason sheet sends hurt cats to the right place; the email allowance is protected by `issue_alert` being sheddable. |
| 5 | **A WebView-based check is brittle** (user-agent changes, blocked storage, a hostname mismatch, a tap that never comes). | The spike comes first; a bad token is retried, never counted as a refusal; a timeout ends the wait; a Cloudflare outage lets welfare reports in as unchecked. |
| 6 | **Limits are not real until SYC-105.** | A named precondition of the launch-day step; the hide limit, unchecked limit and brake live in the shared store from the start. |
| 7 | **The welfare table is shared with a new kind of row**, so an old code path could treat an issue as a welfare report. | D1's list in §5.1 and tests 8 to 10. |
| 8 | **Cloudflare becomes a processor** without the privacy policy saying so. | Added to the list `privacy-policy.md` owns (SYC-248). |
| 9 | **The Greek and French confirm step loses half its meaning.** | Native review is a launch blocker for this feature. |
| 10 | **A guardian reads a neighbour's report about her house.** | Everything issue-related needs `view_welfare_queue`, which guardians do not hold; test 17. |
| 11 | **A hidden photo stays reachable through a cache.** | D14. |
| 12 | **The Turnstile hostname plan breaks quietly** (a wrong host refuses every real token). | The exact-hostname list, a test for `team.catspotters.com`, and the spike. The unchecked list's count is an early warning. |
| 13 | **A removed photo cannot be brought back, and any team member can remove one** (D5). | Only on a photo already hidden for privacy; a typed confirmation; recorded with who, when and why; hosting §6.5's contract. Accepted by Samuel, 12 October 2026. |
| 14 | **Reporters never hear the outcome** (D9). | Accepted by Samuel. The on-screen words are honest and complete on their own (§4.1, §7). |
| 15 | **On a day with several genuine privacy reports, the sixth waits for a person** (D3: the brake is at 5). | Accepted by Samuel. The brake stays on until midnight Athens time with no resume button. The reporter is told it is not hidden yet; the dashboard banner shows; a team member can hide any real one by hand. |

---

## 15. Proposed DECISIONS.md entries

*Nobody edits `DECISIONS.md` from this branch. If Samuel approves, these are the entries for a new Part in the style of Part 2b. Numbers refer to §12.*

- **"Report an issue" lives in the existing queue.** Reports use `welfare_reports` with `kind = 'content'`, shown in a second section under the welfare list, never above a welfare report, and visible only to people who hold `view_welfare_queue`; cat guardians never see them. (D1.)
- **A privacy report hides, as an inappropriate-content report does.** One confirmed report about a photo that shows a person or a private place hides it pending review, on the approved confirm step. (D2; amends Part 2b.)
- **Four safeguards on a one-report hide.** A hide needs a verified Turnstile token; a photo the team has ever restored is not hidden again by a report; hides per address are capped at 5 an hour and 15 a day; and a global brake stops automatic hiding after 5 report-hides in a calendar day (Athens time), with a dashboard banner, until midnight. (D3.)
- **A hidden photo is hidden from everyone but staff** and is replaced in the sightings list by a neutral tile. "Visible to whoever uploaded it" is dropped. (D4; amends §6.)
- **Any team member can delete a hidden privacy photo for good before launch,** with a typed confirmation, under the contract in `hosting-and-photo-storage.md` §6.5, recorded with who did it. (D5, option B widened from management-only; amends nothing.)
- **A report about location or home text, or about a death, never changes anything by itself.** The team acts. (D6, D7.)
- **A photo is reported from a larger view of that photo.** (D8.)
- **The reporter gets an on-screen thank-you only.** There is no email box on Report an issue and no closing email, so nothing amends `email-capture.md` or the privacy policy. (D9, option D.)
- **Turnstile on both public report forms, in a WebView on the app's own challenge page on the phone apps.** Verified in Express; no Worker; exact hostname list. (D10.)
- **A bad or missing token is refused and retried; only a Cloudflare outage is accepted, as "unchecked".** An unchecked issue report never hides. Drafts need a token too. This relaxes SYC-170's wording only in the outage case. (D11.)
- **Issue reports are kept one year after closing,** then the note is deleted. (D12.)
- **Report an issue is built after PR 6 of the queue plan,** and Turnstile on the welfare form goes first. (D13.)
- **A hidden photo's public address changes when it is hidden or restored.** (D14.)

---

## 16. What "done" looks like

- A neighbour who sees their front door in a catalogue photo can hide that photo in about three taps, is told what happened, and the public no longer sees it, even if every email failed.
- A neighbour whose report could not hide the photo (a limit, a recent restore, or the brake) is told so plainly, never that it is hidden.
- A tourist who thinks a cat's name is rude can say so, and the name is changed by a person, not by the report.
- Nobody can declare a living cat dead, or take a cat off the map, by sending a report.
- A script that posts reports with no Turnstile token gets a "challenge required" answer and creates nothing: no row, no hide, no email.
- A hurt cat reported on a weak signal, or during a Cloudflare outage, is never lost.
- A hurt cat reported through "Report an issue" is pointed to "This cat needs help" before it is sent.
- A team member opens the dashboard, sees welfare reports first and issues below them, with report-hidden photos at the top of the issues, and restores any of them in one tap. A cat guardian sees none of the issue reports.
- The pre-launch pass can come off on launch day with Turnstile checked on both forms and shared limits counted in Postgres.
- Greek and French speakers read every word of it in their own language, and a native speaker has checked the confirm step.

---

## 17. Review outcome

The adversarial review of version 1.0 (`docs/specs/reviews/report-an-issue-review.md`, 11 October 2026) found one blocker, ten major problems and fourteen minor ones. Every finding was accepted. Nothing was rejected. This table says where each landed.

| Finding | Handled |
|---|---|
| **B1** Unchecked fallback lets a script skip Turnstile; the draft route skips it too | Replaced by the split in §9.5 and D11: a bad or missing token gets a retryable `428` and creates nothing, only a Cloudflare outage is accepted (unchecked, never hides), unchecked rows are in their own list with a lower limit, and drafts need a token. Client change so a `428` is not a strike (§9.5, §13). Tests 2, 15, 16 |
| **M1** Wrong hostname | §9.4 and §9.6: the app host `apptest.catspotters.com`, a widget that lists only that exact host, a server-side exact list, test 13, the spike, and the launch hostname recorded as a dependency |
| **M2** Issue alerts share the never-shed purpose | §5.2: own purpose `issue_alert`, sheddable; individual emails only for "Photo hidden", the rest in a daily digest; test 12 |
| **M3** No global brake; "hidden" message not tied to the server's answer | §8.1 rule (iv) and the `hidden` field (§4.1, §8.1); rule (ii) is "any restore row, ever"; D3 (Samuel set the brake at 5 report-hides in 24 hours); tests 3, 5, 6 |
| **M4** A hidden photo is cached for a year | §6 and new decision D14, recommending a new public address on hide and restore (SYC-279) |
| **M5** Guardians would see issue reports | §1, §5.3, §5.4, §10: everything needs `view_welfare_queue`; route-walk test 17; risk 10 |
| **M6** Capability names | §5.4 uses the catalogue's names; §5.5 lists `clear_home_description` and `remove_photo` as additions; `edit_cat_text` dropped; D6 waits on SYC-130 |
| **M7** Token at send time; resend after a blip | §4.2, §9.5: a fresh check on every send from the saved list; duplicate check before token; the upgrade case; test 14 |
| **M8** Reusing `welfare_reports` breaks more than listed | §5.1 and D1: `photo_state = 'none'`, no tie and no observation on content rows, the close guard in existing code, the resend key with kind, the banner counts both purposes, retention by kind, a migration rollback; tests 8 to 10, 21 |
| **M9** Unmarked amendments | The table near the top (rows 3 to 6) and D5, D9; `wrong_info` kept. Samuel's later choices (removal path, no email box and no closing email) mean rows 3, 4 and 5 now amend nothing |
| **M10** "Built / not built" framing | Removed everywhere. The spec describes one whole product; order of work is in §13 only |
| **m1** PRs 0 to 5 are merged | D13 |
| **m2** Precondition belongs on the launch-day step | §8.2, §13 |
| **m3** Visible sheet, timeout and fallback | §9.4 |
| **m4** `cdata` and token length | §9.1, §9.2, test 13 |
| **m5** Digest needs a scheduler | §5.2: dashboard count plus a once-in-24-hours guard in the drain |
| **m6** Per-device limit is a courtesy; what a repeat sender is told | §8.1 |
| **m7** Separate limiters give 30 an hour | §8.1: stated openly; a shared ceiling rejected with the reason |
| **m8** Sending the address to Cloudflare | §9.2, §10: not sent; for SYC-248 |
| **m9** "Reported by a spotter" | "a member of the public", §5.3, §10 |
| **m10** Untestable wording | "Same group" defined (§5.3); "visually distinct" is a colour band plus a text label; "some hours' delay" removed (§5.2) |
| **m11** Moving a sighting keeps the photo's id | §5.4, D14 |
| **m12** The "doorway" hint | §2, D2 |
| **m13** Privacy-policy line conflicts with D12 | §10, D12 |
| **m14** "Saved in this browser" | §4.2, §11, test 19 |

The review's verdict on D1 to D13: D1, D2, D6, D9, D10, D12 gained conditions; D3 gained rule (iv); D5 and D11 were changed (D5 now recommends the narrow removal, D11 is replaced); D4, D7 (with a small addition), D8 and D13 stand. D14 is new.

### Samuel's decisions, 12 October 2026

Samuel then decided D1, D2, D3, D5, D6, D9, D10, D11, D12, D13, D14 and the smaller calls. The decisions are marked "Decided" in §12. Where his choice differs from the recommendation, the spec carries a "What this choice accepts" line:

| Decision | Outcome | Differs from the recommendation? | Where it landed |
|---|---|---|---|
| D1, D2, D6, D10, D11, D12, D13, D14 | As recommended | No | §12; the D2 hint reads "faces, house numbers, number plates, inside a home or garden" (§2) |
| D3 | The global brake trips after **5** report-hides in a calendar day (recommended 20); reports then queue without hiding until midnight Athens time, with a dashboard banner and no resume button | Yes (threshold) | §8.1 rules (iii) and (iv), D3, tests 4 and 5, risk 15, §15. The separate warning at 10 is dropped because the brake's banner comes first |
| D5 | Any team member, not only management, can delete a hidden privacy photo for good | Yes (wider) | §5.4, §5.5 (`remove_photo` is island-only for team and management), D5, risk 13, §15 |
| D9 | No email box on Report an issue; on-screen thank-you only | Yes (option D, not A) | §4.1, §4.3, §5.2, §5.3, §7, §10, §11, D9, risk 14, §15, and rows 4 and 5 of the table near the top (no amendment to `email-capture.md` or the privacy policy) |
| Smaller calls | At most 10 individual "Photo hidden" alerts an hour, rest in a daily digest; 3 unchecked rows an hour per address; no visitor address sent to Cloudflare; no shared ceiling across the two forms | No | §5.2, §8.1, §9.2, §12 |

D4, D7 and D8 were not part of this round of decisions and stand as recommended in version 1.1.
