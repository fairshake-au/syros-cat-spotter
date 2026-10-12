# "Report an issue" on every cat and photo

**Feature spec · Cat Spotters (Syros)**
**Version:** 1.1 · revised after adversarial review · 12 October 2026 (v1.0 draft was 7 October 2026)
**Covers:** `team-access-and-welfare-queue.md` §6 (which this spec fills out and, in the places listed below, amends), and the Turnstile protection for both public report forms.
**Linear:** SYC-44 (Report an issue) · SYC-170 (Turnstile on the welfare report and on Report an issue). Touches SYC-105 (shared rate limits), SYC-113 and SYC-114 (the pre-launch pass), SYC-130 (claiming a cat; the home description), SYC-150 (move a sighting to another cat), SYC-229 (which addresses sit behind Cloudflare), SYC-231 (the mail drain), SYC-232 (a real example of what people will report), SYC-248 (privacy policy updates) and SYC-279 (hidden photos and caches).
**Status:** **Revised after adversarial review, awaiting Samuel's approval.** The review is `docs/specs/reviews/report-an-issue-review.md`; §17 says how each of its findings was handled. Permissions follow the approved roles spec (`roles-and-invites.md`, approved 12 October 2026, §6.2 catalogue), the source of truth for who may do what.

### What this document owns, and what it borrows

| What | Owner |
|---|---|
| The reasons a person can give, the button, what the reporter sees, how an issue lands in the queue, what the team can do with it, and the Turnstile rules for **both** public report forms | **This document** |
| The queue itself (four states, team note, state history), the team's sign-in, the alert email and the "photo pending" pattern | `team-access-and-welfare-queue.md` and the SYC-42 / SYC-43 plans |
| The names of every permission ("capability") and who holds it | `roles-and-invites.md` §6.2. This spec adds no name of its own; the two it needs are listed in §5.5 as additions to that catalogue |
| The hide-and-restore log (`photo_visibility_events`) and the one function that builds public photo addresses (`publicPhotoUrl()`) | `docs/superpowers/plans/syc-43-part-2-welfare-queue-and-corrections.md`, PR 6 |
| Email verification, consent wording, the closed list of email moments | `email-capture.md` |
| Location blurring and feeding-site privacy | `cat-record-data-spine.md` |
| Removing a photo's bytes: the contract | `hosting-and-photo-storage.md` §6.5 |
| The pre-launch pass and its removal | `docs/superpowers/plans/syc-113-pre-launch-gates.md`, SYC-114 |

Where this spec and `DECISIONS.md` differ, `DECISIONS.md` wins, except where a decision here is marked as **an amendment** and put to Samuel in §12.

### Changes to approved text, all in one place

Anything below that contradicts an approved document is listed here and in the decision that carries it. Nothing in this table takes effect until Samuel says yes to that decision.

| # | What changes | Approved text it touches | Decision |
|---|---|---|---|
| 1 | A photo that shows a person or a private place also hides on one confirmed report | Welfare spec §6 and DECISIONS Part 2b (only "upsetting or inappropriate" hides) | D2 |
| 2 | A hidden photo is hidden from everyone but staff, including its taker, who sees a neutral tile | Welfare spec §6 ("stays visible to staff and to whoever uploaded it") | D4 |
| 3 | **Removal of a photo.** If Samuel keeps "hide only" (D5 option A), that amends `hosting-and-photo-storage.md` §6.5, which says the removal path arrives in the same window as this flow. The recommended option B adopts that contract instead and amends nothing | `hosting-and-photo-storage.md` §6.5 (approved 28 September) | D5 |
| 4 | **An email box on Report an issue** is a new moment when people are asked for an email | `email-capture.md` (closed list of asks) and `privacy-policy.md` ("we ask at four moments: after you've spotted a cat, at the end of a visit, after you've reported a cat in trouble, and in Settings") | D9 |
| 5 | **Closing email wording.** This spec now uses the approved Part 2b wording word for word, so it amends nothing. Different wording would be an amendment | DECISIONS Part 2b | D9 |
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

**Who sees these reports.** Only the Syros Cats team (volunteers and staff, and the management tier above them). They need the `view_welfare_queue` power. **Cat guardians never see "Report an issue" reports**, not even about cats in their own colonies (§5.3).

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
| `photo_private` | **It shows a person or a private place** · "faces, house numbers, number plates, or the inside of a home or garden" | **Yes** (decision D2) | Look at the photo. Keep hidden, or restore if nothing private is in it. |
| `photo_inappropriate` | **It's upsetting or offensive** | **Yes** (approved 28 Sep) | Same. |
| `photo_not_cat` | **That's not a cat** · a picture that has nothing to do with cats | No | Hide the photo (one tap) if it is wrong. |
| `wrong_cat` | **That's a different cat** · "this photo is of another cat" | No | Hide the photo for now. Moving it to the right cat is SYC-150. |
| `wrong_name` | **The name is wrong, or not OK** | No | Rename the cat. |
| `wrong_info` | **Something else about this cat is wrong** · "the colours, the home, the ear tip" | No | Mark the wrong statement as wrong, with a reason, or add a note. |
| `location_revealing` | **The map spot or the words show where someone lives** | No (decision D6) | Look; see D6 for what the team can change. |
| `cat_died` | **This cat has died** | No, never | Look. If it is known, record "no longer with us" with a date. |
| `other` | **Something else** | No | Whatever is right. |

Notes on the list:

- **The hint for `photo_private` is deliberately narrow.** The first draft listed "a doorway", but almost every street photo on Syros has one, which would turn the one reason that hides into the easiest one to misuse. The hint names faces, house numbers, number plates, and the inside of a home or garden.
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
2. **One optional box:** "Anything we should know?"
3. **Email, optional,** *only if* the email feature is switched on (§7, decision D9). The wording and the unticked news box are `email-capture.md`'s, verbatim.
4. **For a hiding reason, the confirm step** (approved text, DECISIONS Part 2b): *"Are you sure? Reporting this will hide it from everyone until Syros Cats have reviewed it."* with **Report and hide** and **Cancel**. Nothing is hidden or sent until they tap **Report and hide**.
5. **Send.** The Turnstile check runs in the foreground at the moment of sending (§9.5) and the person sees nothing unless the widget needs a tap, in which case a small sheet appears (§9.4).
6. **The confirmation.** Plain and short, and **chosen by what the server actually did**, not by the reason the person picked. The server's answer carries `hidden: true` or `hidden: false`:
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

Who read it, what the team decided, whether anyone else reported the same thing and (unless they left a verified email, §7) the outcome. There is no public record that a report exists, except one neutral thing: **a hidden photo is gone from every public view, and its place in the sightings list shows a quiet tile, "Photo hidden while Syros Cats take a look."** (Decision D4.)

---

## 5. How it reaches the team

### 5.1 The queue is the source of truth

As with welfare reports (spec §4.3), **the queue row is written first, in the same database transaction as everything it causes**: the hide, the count and the queued alert email. Mail cannot lose a report and cannot delay a hide.

**Where the row lives is decision D1.** The recommendation is the existing `welfare_reports` table with `kind = 'content'`. The column and its check already exist for exactly this (`lib/db/src/schema/welfare.ts` reserves it), and spec §8.4 already says so, so the dashboard has one queue, one set of four states, one team note, one history and one delivery-state column. Reuse is not free. The table was built around cats in trouble, and the plan lists and tests every one of these places:

- **The migration.** `lat` and `lng` become optional for `content` rows, with a new check that keeps them required for `welfare` rows. New nullable columns: `reason` (the key from §2, checked), `photo_id` (→ `photos.id`), `hidden_by_report` (boolean) and `token_checked` (boolean, §9). `cat_id` is already there. This is a change to a live table, so the plan includes a **rollback block** that keeps the welfare rows' guarantee that a position is always present.
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

The body of a "Photo hidden" alert carries the reason, the reporter's note (escaped), the cat's name with a team-page link, and the photo **as an attachment** (the same rule as welfare photos: a team link fails in a mailbox, and a public link would be wrong for a photo that was just hidden). **No reporter contact details** (spec §3.1 and §4.3): "the reporter left contact details; reply from the dashboard." The digest lists reasons and cats with team links, no notes.

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

Each row shows the reason in plain words, the cat's name and the photo (served only through the team route, as hidden photos are), what the reporter wrote, how long ago, whether the reporter left a way to be contacted, and the four states and team note the queue already has. The reporter is described as **"a member of the public"**, not "a spotter", because many reporters are tourists with no account. **"2 others reported this"** counts other **open** reports in the same group, where a group is: the same photo and the same reason, or, for reports about a cat rather than a photo, the same cat and the same reason. Repeat reports stay separate rows (the record is add-only); only the count is shown.

### 5.4 What the team can do

Each action names the capability that guards it, using the names in the roles spec §6.2. All are held by the team and management island-wide. Cat guardians hold none of them for issue reports.

| Action | Capability |
|---|---|
| **See the Issues section, the strip on a cat's page, an issue's photo** | `view_welfare_queue` |
| **Keep it hidden** (closes the report as *Done*) | `hide_photo` |
| **Restore the photo** (one tap, attributed; closes as *Nothing needed*) | `restore_photo` |
| **Hide a photo** that a non-hiding report points at (`photo_not_cat`, `wrong_cat`) | `hide_photo` |
| **Resume automatic hiding** after the global brake (§8.1 rule (iv)) | `hide_photo` |
| **Rename the cat** | `rename_cat` |
| **Say the cat is no longer with us** (reason, and the date the team knows of) | `set_life_status` |
| **Mark a statement wrong**, with a reason | the statement's own capability (`set_appearance` for colours) |
| **Open the cat's page** (exact location, full history) | `view_exact_location` |
| **Change state, add a team note** | `change_report_state`, `add_team_note` |
| **Move the photo to the right cat** | SYC-150. Until it exists, `wrong_cat` means "hide the photo and leave a note". Moving a sighting must keep the photo's internal id, or rule (ii)'s restore history is lost |
| **Clear a cat's home description** | `clear_home_description` (proposed addition, §5.5; decision D6) |
| **Remove a hidden privacy photo for good** | `remove_photo` (proposed addition, §5.5; decision D5) |

A report that hides a photo and is then closed records both: the original hide (author `report:<id>`) and, if the team restores, a restore (author a person id). The log is add-only, so "who hid this, and who put it back?" always has an answer.

### 5.5 Proposed additions to the roles catalogue

The roles spec says a spec that needs a power that is not in its §6.2 table "adds a row there first". This spec does not edit the roles spec. These are the rows to add if Samuel approves the matching decisions:

| Capability | What it lets you do | Kind | Team | Management | Guardian | Needed by |
|---|---|---|---|---|---|---|
| `clear_home_description` | Clear (blank) the home description on a cat's page, with a reason, recorded who and when. Narrow on purpose: it does not edit any other cat text, so it cannot overlap `rename_cat` or SYC-2's `set_appearance` | Island-only | ✓ | ✓ | — | D6 (only if SYC-130 leaves the description public) |
| `remove_photo` | Remove a hidden photo's bytes for good under `hosting-and-photo-storage.md` §6.5: one write, recorded who, when and why, irreversible. Only on a photo that is already hidden for a privacy reason; asks for a typed confirmation | Island-only | — | ✓ | — | D5 option B |

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
- A hidden photo is still in the database and still one of the matching model's reference images (PR 6's own note). For a photo that shows a face or a doorway, hiding is not erasure. Decision D5 asks Samuel about a real removal.
- **Caches.** Photos are served as `Cache-Control: public, max-age=31536000, immutable` (one year, never re-checked). A `404` from the server does not clear a copy that a browser, the app's image store or a shared cache such as Cloudflare's already holds. If the API sits behind Cloudflare's proxy (not recorded; SYC-229), the edge could keep serving a hidden photo to **anyone who has the address** for up to a year. Decision D14 asks Samuel how to close this, and recommends giving a photo a new public address whenever it is hidden or restored, so the old address is dead everywhere (SYC-279 tracks it).
- A hidden photo may already be in someone's phone cache or screenshot. Nothing can fix that, and the privacy policy must not imply it can.
- The offline cat list on a phone may keep showing the photo until its next refresh.

---

## 7. Feedback to the reporter

The default: **the person is told on screen that Syros Cats will take a look, and nothing else unless they gave a verified email.** The welfare spec already treats this as the rule, and no address ever receives mail from us that its holder has not confirmed (F7b).

- **No email left:** the confirmation screen is all they get. No push, no list. (Alternatives in D9.)
- **Email left and verified:** the same machinery as welfare reports: the one fixed "is this you?" message from the news identity, nothing else until confirmed, then **one** closing email when the team moves the report to *Done* or *Nothing needed*, from fixed copy, never free text. The wording is the one **approved in DECISIONS Part 2b**, unchanged, in en, el and fr:
  > "Syros Cats has looked into this and taken appropriate action in response to your report. Thank you for taking action to help the cats of Syros to thrive."

  The closing email never says what the action was: a team decision about someone's photo is not the reporter's to know, and *Nothing needed* must not read as "you were wrong."
- **Reply-To** is `admin@syroscats.com` on every reporter-facing message, as for welfare reports.
- **This depends on SYC-42 Slice 3 and `email-capture.md`.** The email box is shown on this form only when the email feature is switched on (the ruling SYC-42's Decision 4 made for welfare reports). Nothing else in this spec waits for it. **Adding the box here is an amendment** to `email-capture.md`'s list of asks and to the privacy policy's "four moments" line (decision D9).

---

## 8. Abuse and spam

A public, unauthenticated write endpoint that can **take a photo off the site** and **costs a person's attention** attracts abuse. The controls, in order of how much weight each bears:

### 8.1 What bears weight

1. **Turnstile on every submit** (§9). It stops scripted floods and is required for a *hide* to happen (rule (i) below).
2. **Per-address limits.** Device identity is not an abuse control: `deviceAuth.ts` binds the first secret it sees, so an attacker mints a device per request (the new-device cap, SYC-195, limits that to 20 an hour per address). So the limits that count are per address:

| Limit | Value | When it is hit |
|---|---|---|
| Issue reports per address | 20 an hour | `429`, "Too many requests. Please try again later." The phone keeps the report and retries later. |
| **Hides per address** | **5 an hour, 15 a day** | The report is **accepted and queued but the photo is not hidden.** The team sees "hide limit reached" on the row. |
| Reports about the same photo from one device | 1 every 24 hours per reason | Treated as already sent; same reply as a first report. |
| Welfare reports per address | 10 an hour (unchanged, spec §2.6) | As today. |

3. **Three rules about hiding** (proposed, D3):
   - **(i) A hide needs a verified Turnstile token.** No token, a failed token, or an offline-queued send with no fresh token still creates the queue row but does not hide.
   - **(ii) A photo the team has restored is not hidden again by a report.** New reports on it queue and show in the team's list; only a team member can hide it again. One person cannot hide the same photo over and over, and a wrong hide costs the team one tap, once.
   - **(iii) A daily volume banner.** More than 10 report-hides in 24 hours raises a dashboard banner. It never pages anybody (F1).

### 8.2 Where these are counted, and what is not true yet

- **There is no Cloudflare Worker in front of the API.** The only `wrangler` file in the repo is `infra/proposals-site/wrangler.jsonc`, a static proposals site. The sign-in Worker (SYC-202 refers to its rate limits) lives in the separate `catspotters-website` repository and is not in the path of API calls. The API is Express on Replit behind Replit's proxy with `trust proxy` set to 4 (SYC-100). Whether `api.catspotters.com` goes through Cloudflare's proxy is not recorded in the repo, and SYC-229 is the ticket that checks every public address sees the same four hops.
- So **Turnstile is verified inside Express** with a `fetch` to Cloudflare's siteverify endpoint (§9). No Worker is needed.
- **Per-address limits are only real once SYC-105 lands.** Today `express-rate-limit` counts in memory per process, so limits multiply by the number of instances and reset on every deploy. SYC-170 already makes SYC-105 a precondition for taking the pre-launch pass off; this spec adds that **the hide limit must be in the shared store from the start**, because a hide limit that resets on deploy is not a limit.
- Until launch, the pre-launch pass (SYC-113) limits `/api` to testers, which is the main control. That is why none of this is urgent for testers and all of it is a **precondition of SYC-114**.

### 8.3 What is accepted

A determined vandal with many addresses can still hide photos once each (rule (ii) stops repeats) and the team restores them one tap at a time. That is the residual risk Samuel accepted on 28 September; the rules above narrow it from "unlimited" to "bounded by the number of different photos and addresses".

---

## 9. Turnstile (SYC-170)

### 9.1 What it is, from Cloudflare's current documentation

- A widget runs a challenge in a visitor's **browser** and returns a **token**. The server then sends the token and its **secret key** to Cloudflare's *siteverify* endpoint, which says whether it is valid. Server-side validation is mandatory.
- A token is **single-use and expires after 300 seconds.** An expired or already-used token must be replaced with a fresh challenge.
- siteverify returns, on success, the `hostname` the widget ran on and the `action` label the page set. **We check both**, so a token earned on one form cannot be spent on another.
- Three widget modes: **managed** (Cloudflare decides whether a tap is needed; recommended), **non-interactive** (a visible spinner, no tap) and **invisible** (nothing shown).
- **Turnstile does not run natively.** For a mobile app, Cloudflare's guidance is to load the widget in a **WebView** with JavaScript and DOM storage enabled, network access to `challenges.cloudflare.com`, `about:blank` and `about:srcdoc` allowed, and a user agent that stays the same through the session.

### 9.2 What is built to carry it

Both forms share one small piece of server code, built once:

- `lib/turnstile.ts`: `verifyTurnstile(token, expectedAction, remoteIp)`. Calls siteverify with `TURNSTILE_SECRET_KEY`, a short timeout and one retry using an idempotency key. Returns `ok`, `failed` or `unavailable`, and checks `success`, `action` and `hostname`.
- A request field `turnstileToken` in the JSON body, never a query string and never logged (the request log records only method and path).
- Actions: `welfare_report` and `report_issue`.
- `TURNSTILE_SECRET_KEY` in the Replit deployment secrets, like the mail keys (spec §2.11). The sitekey is public and goes into the app and the website build. The widget is created through the Cloudflare API (the wrangler token exists; the `turnstile-spin` skill covers it), with its hostnames in §9.4.
- Behaviour when there is no valid token differs by form (§9.5).

### 9.3 The website

The Expo web build loads Cloudflare's script and renders the widget in **managed** mode as soon as the report sheet opens, so a token is ready when the person taps send, and it fetches a new one if the first has expired. `serve-web.js` sets only `frame-ancestors 'none'` as a content-security policy today, so nothing blocks the script. The pre-launch password page (SYC-113) is unaffected: the widget runs inside the already-unlocked app.

### 9.4 The Expo phone apps (the question in SYC-170)

Turnstile is web-first and the phone apps have no browser page to run it in, so there are five ways to cope. **This is decision D10.** A short spike, as SYC-170 asks, belongs at the start of the build to prove the recommended option on a real iPhone and Android phone before anything else is built.

| Option | What it is | Benefits | Risks | For the person |
|---|---|---|---|---|
| **A. A hidden WebView that loads a challenge page on our own domain (recommended)** | Add `react-native-webview`. The app opens a hidden WebView on `https://catspotters.com/_challenge?action=…`, a one-screen page we serve that renders the widget and hands the token back to the app. | Follows Cloudflare's own guidance. The widget sees a real hostname we control, so the widget can be locked to our hostnames and §9.2's hostname check can be strict. Same protection on web and native, for both forms. | A new native dependency, so it needs a new store build, not just a web publish. A WebView adds load time on a weak signal. Cloudflare warns that a changing user agent or blocked storage breaks it. While the pre-launch gate is on, the challenge page must be let through. | Invisible nearly always. When Cloudflare wants a tap, a small sheet appears. |
| B. Inline HTML inside a WebView | The same, but the HTML is bundled in the app. | No page to host. | Cloudflare's documentation does not say what hostname an inline page shows, so the strict hostname check may be impossible. That is a guess to test, not a fact. | Same as A. |
| C. Open the phone's browser for the challenge and return by link | A challenge page opens in Safari or Chrome and returns the token by deep link. | No WebView. Uses a real browser. | Breaks the flow: the person leaves the app mid-report. Fragile on Android. Poor at the moment someone is upset about a photo. | Noticeably worse. |
| D. App attestation instead (Apple App Attest and Google Play Integrity) | The phone proves the request comes from the genuine app on a real device. | Stronger against scripts that pretend to be the app. Invisible. | Two vendor integrations, Google Cloud setup and server checks against Apple and Google. The web would still need Turnstile. Large for a charity app. | Invisible. |
| E. No challenge on native; Turnstile on web only | The app sends no token. | Nothing to build. | **Nothing stops a script from simply not sending a token and claiming to be the app, so the web protection is bypassed.** The API would accept tokenless requests forever. | None. |

**Recommendation: A.** It is the approach Cloudflare documents, it keeps one rule for web and native, and it is the only option of the five that lets the hostname check be strict. Adopt D later if scripted abuse of the native path ever appears. Reject E, because it quietly makes the whole feature optional.

**Hostnames to allow on the production widget:** `catspotters.com` (the website and the challenge page). Replit preview domains and `localhost` get a separate **test** widget with Cloudflare's published test keys, so the production widget never lists a development host.

### 9.5 When there is no valid token (decision D11)

A token can be missing for good reasons: the phone was offline and the report was sent hours later, Cloudflare was unreachable, a weak signal stopped the WebView loading. The two forms must treat that differently.

**Report an issue** is not an emergency. With no valid token: **the queue row is written and the team sees it, but nothing is hidden and no individual alert email is sent for that row.** Such rows appear under a counted "unchecked" line on the dashboard and in at most one daily digest. The reporter is told, truthfully, *"Thank you. Syros Cats will take a look"*, with no claim that anything is hidden. The price is some hours' delay for a privacy reporter on the worst path (offline, then no fresh token), in exchange for making a hide something an attacker cannot do tokenless.

**The cat-in-trouble report** is the one place where a lost report could mean a hurt cat unseen. Options:

| Option | Benefits | Risks | For the reporter | For the team |
|---|---|---|---|---|
| A. Refuse it (`403`) | Matches SYC-170's wording exactly: the form is protected before a report is accepted. | **A real report can be lost.** A tourist with one bar of signal and a failed WebView gets an error at the worst moment. | A sad failure. | Cleanest. |
| **B. Accept it, mark it "unchecked", and cap the alert emails for unchecked rows (recommended)** | No real report is lost, ever (the promise the whole welfare design is built on). A flood is contained: unchecked rows send alert emails only up to a cap (say 10 an hour in total), the rest roll into a single "N unchecked reports waiting" line. The queue still shows every one. | It relaxes the ticket's wording ("checked before a report is accepted"): this checks, then accepts anyway. A scripted flood still fills the queue table, though not the inbox. | Nothing visible. | A small "unchecked" tag on the row. |
| C. Accept it with no Turnstile on this form | Simplest. | Turns the check into decoration. The welfare spec's own §4.4 says Turnstile is there for exactly this. | Nothing. | A flood hits the inbox directly. |

**Recommendation: B.** Samuel should know it relaxes SYC-170's wording; §12 asks him.

### 9.6 Order of work, and the precondition on the pre-launch pass

1. Spike A on a real iPhone and Android phone: the WebView loads the challenge page, a token arrives, siteverify returns the expected `action` and `hostname`.
2. `lib/turnstile.ts` and the secret.
3. The welfare form, then Report an issue.
4. Shared rate limits (SYC-105), including the hide limit.
5. Only then does SYC-114 remove the pre-launch pass.

---

## 10. Privacy of the reporter

- **No account, no sign-in, no name.** A report carries the device identifier every report carries (trust-on-first-use, a courtesy check; welfare spec §4.4). It is stored on the row so the app's own resend is recognised, and is cleared by SYC-63's "delete my data" like the welfare reports' device ids. It is never shown on the queue or in the email.
- **The IP address is not stored on the report.** It is used for limits and for Cloudflare's check and not kept. (The in-memory limit counters hold it for their window; SYC-105's shared store should hold a hashed or truncated key, not the address.)
- **The note is team-only.** It never appears publicly, never reaches the cat's owner or other spotters, and is escaped everywhere it is shown.
- **The reporter's email, if any,** follows `email-capture.md`: held in the verified-contact model, not on the report row, deleted 90 days after the report reaches a final state, and an unverified address after 7 days.
- **The team sees "reported by a spotter" and whether contact details were left, and nothing else.** A cat's owner, a guardian, or the person who took a hidden photo is never told who reported it. The person who took the photo sees only the neutral tile (D4).
- **Retention of issue reports (proposed, D12):** the row and its note are kept **one year after the report is closed**, then the note is deleted and the bare record (reason, target, decision, dates) stays, so "have we been asked about this photo before?" still has an answer. This is shorter than the three years for welfare reports because an issue report is not part of a cat's welfare history. `privacy-policy.md` must carry it.
- **Cloudflare becomes a processor for this feature.** Turnstile sends a visitor's browser signals to Cloudflare. The privacy policy and the data agreement must name it (as SYC-124 does for Neon). `privacy-policy.md` owns the wording.
- **A report that says a photo shows a person describes an identifiable image,** which is one more reason the note is team-only and its retention is stated.

---

## 11. English, Greek and French

- **Everything the reporter reads is a language string,** in the three dictionaries `lib/i18n.ts` already holds: the reasons, the first line about hurt cats, the confirm step, the confirmations (online, offline, hide, no hide), the tile that replaces a hidden photo, the closing email and the offline reminder.
- **The reporter's language is stored with the report** (`reporter_language`, already on the table), so the closing email goes out in it.
- **The team side is English only** (the dashboard is English today). The reason shown to the team is the **key's English label**, never free text from the app, so a Greek speaker's `photo_private` reads the same as an English one's.
- **The confirm step is the high-risk string.** The approved English wording is exact ("hide it from everyone until Syros Cats have reviewed it"). Its Greek and French must keep both halves (everyone, and until reviewed). **Native-speaker review is a launch blocker for this feature's three languages** and joins SYC-4, SYC-154 and SYC-172. Greek capitals drop accents (SYC-159); use `displayUpperCase`.
- Reasons are fixed strings and are never machine-translated at read time.

---

## 12. Open decisions

Each lists every realistic option, the benefits and risks, what changes for people, and a recommendation. **D2, D3, D4 and D11 touch things already decided and are marked as amendments or additions.** D1 and D2 gate the rest.

### D1. Where do "Report an issue" reports live?

| Option | Benefits | Risks | UX | Team |
|---|---|---|---|---|
| **A. The same table as cat-in-trouble reports (`welfare_reports`, `kind = 'content'`) (recommended)** | One queue, one set of states, one note and history. `kind` and its check already exist for this, and spec §8.4 already says so. Reuses the outbox, delivery tracking and team page. | The table was built around cats in trouble: lat and lng are required, severity exists, and several code paths assume a welfare report. A migration and a careful sweep for `kind` are needed, or an issue report could write a `welfare_outcome` on a cat. | None. | One list to watch. |
| B. A sibling table, `issue_reports`, with its own state history | Welfare reports stay untouched. Cleaner types. | Two tables, two state histories and two sets of team pages for what the team sees as one inbox. This is the "second inbox" the brief says not to build. `report_state_events` has a foreign key to `welfare_reports`, so it would need a twin. | None. | Two lists, or one page stitching two sources. |
| C. Email only, no queue row | Least to build. | Loses everything the queue exists for: states, notes, "did anyone handle this?". Reverses the approved "arrives in the queue". | None. | A shared inbox is not a record. |

**Recommendation: A**, with the plan listing every reader of `welfare_reports` and a named test that closing an issue never writes a `welfare_outcome`.

### D2. Which reasons hide on one confirmed report? (amendment to §6)

The approved spec hides only for "upsetting or inappropriate". But "shows a person, a house number or a number plate" is the privacy case the ticket calls out, and it is as harmful to leave up.

| Option | Benefits | Risks | UX | Team |
|---|---|---|---|---|
| A. Only `photo_inappropriate` hides (as approved) | Narrowest; fewest wrong hides. | A photo with a face or a front door stays up until somebody reads an email. | A privacy reporter is told nothing is hidden, the wrong answer for the most sensitive case. | Less to restore. |
| **B. `photo_inappropriate` and `photo_private` hide (recommended)** | Covers both cases where delay does real harm. The confirm step and D3's safeguards apply to both. | Slightly more room for vandalism (two reasons that hide, not one). | A privacy reporter gets immediate relief. | A few more hidden photos to review. |
| C. All photo reasons hide (`photo_not_cat` and `wrong_cat` too) | Simplest rule: a photo report hides the photo. | Makes the least harmful reasons the easiest weapon. A tourist who disagrees about which cat it is would hide a good photo. | Over-hides. | Many more restores. |

**Recommendation: B.**

### D3. Safeguards on a one-report hide (additions)

The approved mitigations are the confirm step, Turnstile, a volume alert and one-tap restore. Three more are proposed in §8.1: **(i)** a hide needs a verified Turnstile token; **(ii)** a photo the team has restored is not hidden by a later report; **(iii)** per-address hide limits (5 an hour, 15 a day).

| Option | Benefits | Risks |
|---|---|---|
| A. Only the approved four | Matches what was signed off. | One person can re-hide a restored photo every day; a script on many addresses is only slowed by Turnstile. |
| **B. All three additions (recommended)** | Bounds a vandal to one hide per photo and a handful per address. A real private-photo report on a fresh photo still hides at once. | Rule (ii) means a photo restored by mistake and then genuinely reported again stays up until a person looks. Rule (i) means a tokenless (offline) privacy report waits for a person. Both are small, and the confirmation copy does not over-promise. |
| C. Only (i) | Smallest change. | Leaves repeat-hiding open. |

**Recommendation: B.** If Samuel rejects (ii), repeat-hiding returns and the volume banner is the only defence.

### D4. What do the public and the photo's taker see when a photo is hidden? (amendment)

The approved text says a hidden photo "stays visible to staff (and to whoever uploaded it)". The photo route is open and unauthenticated, so showing a hidden photo to its taker would need photo requests to carry a device secret, and PR 6's plan says a hidden photo answers `404` for everyone.

| Option | Benefits | Risks | UX |
|---|---|---|---|
| **A. Hidden for everyone but staff; the sighting stays in the list with a neutral tile, "Photo hidden while Syros Cats take a look." (recommended)** | Simple, matches PR 6, no change to how photos are fetched. Tells a wrongly hidden photo's taker what happened. | The taker cannot see their own photo while it is hidden. The tile tells everyone a photo was hidden (not why, not by whom). | Calm and honest. |
| B. As approved: also visible to the uploader | Kind to a wrongly hidden photo's taker. | Photos would need device-authenticated reads, which changes the photo route, its caching and the pre-launch headers. The device is trust-on-first-use, so "the uploader" is a weak notion. A privacy-hidden photo would still be shown to some device. | Better for the taker, worse for the privacy case. |
| C. The sighting is hidden too, with no tile | Nothing signals that anything was hidden. | The sighting count and points stay but the list shows less than the count says. | Confusing. |

**Recommendation: A.**

### D5. Can the team delete a hidden photo for good?

| Option | Benefits | Risks | UX |
|---|---|---|---|
| **A. Hide only in v1; a ticket for a real delete, decided before launch (recommended)** | Reversible, simplest, matches PR 6. | A person whose face is in a photo gets restriction, not erasure, until the delete ships. The photo stays in the database and as a matching reference. The privacy policy must say so honestly. | The reporter gets hide-now. |
| B. Add a `remove_photo` capability: a confirmed, irreversible delete on a hidden privacy photo | Matches what someone asking for erasure of their image expects. | The hard part is design: the photo may be a cat's main photo, a sighting's photo, a matching reference and an embedding source. It is the same family of work as SYC-63's severing. Irreversible with a one-tap team UI. | The strongest answer. |
| C. Do not offer deletion at all | Nothing to build. | A person with a legal right to erasure of their image is turned away. | Poor. |

**Recommendation: A for v1**, with a ticket (filed) to settle the real delete before launch, because "hidden" is an interim state for a privacy photo.

### D6. What does "the map spot or the words show where someone lives" do?

Positions are already blurred to a 250 m cell (data spine PR 6, live). What a report can touch is the home description (public text on the cat page, SYC-232's subject) and, for a feeding-site cat, the spot.

| Option | Benefits | Risks | UX |
|---|---|---|---|
| **A. The report goes to the queue as a distinct "location" issue and the team acts by hand; a small team action to clear the home description is added (recommended)** | No automatic change from one report. Clearing text is small, add-only and the text is the likelier problem. | Until a person reads it, the text stays up. Only the text can be fixed, not the map spot. | The reporter is told the truth: "Syros Cats will take a look." |
| B. A single confirmed report also hides the cat's map spot and home text, pending review | Fast for the person it concerns, in line with photos. | Needs a new "position hidden" mechanism in the data spine, which does not exist. Easy to weaponise: one report removes a cat from the map. | Strong for the worried neighbour, poor for the cat's spotters. |
| C. Nothing special: it is just `other` | No work. | Loses the one case where delay can expose where a person lives. | None. |

**Recommendation: A**, with a ticket for B's mechanism, to be decided after launch with Syros Cats. The clear-home-text action needs a capability name, and `edit_cat_text` is proposed.

### D7. A cat reported as died

| Option | Benefits | Risks | UX |
|---|---|---|---|
| **A. The team decides; the report alone changes nothing (recommended)** | A false report cannot declare a living cat dead. PR 4's "no longer with us" already needs a reason and a date. | A real death waits for a person. | Respectful. The cat page never changes on a stranger's say-so. |
| B. Several independent reports flip the status | Faster for a well-known cat. | Easy to fake with many devices. A false "no longer with us" is cruel to show a cat's owner. | Risky. |
| C. A public tag, "reported as died, being checked" | Honest in the open. | A public announcement of a possibly wrong death. | Upsetting. |

**Recommendation: A.** A `cat_died` report also never triggers a push to the cat's spotters.

### D8. How does a person report one photo?

| Option | Benefits | Risks | UX |
|---|---|---|---|
| A. A small flag icon on every thumbnail | Always visible. | Clutter on a grid of dozens of photos. Small tap targets. Teaches people to feel watched. | Noisy. |
| **B. Tap a photo to see it larger, with "Report an issue with this photo" under it (recommended)** | Quiet, big tap target, no hidden gesture, same on the web. The full-screen view is useful on its own. | A new screen to build and an extra tap. | Calm. |
| C. Only on the cat page, with a "which photo?" step | Least to build. | The reporter must find the photo again in a picker. | Clumsier. |

**Recommendation: B.**

### D9. What does the reporter get back?

| Option | Benefits | Risks | UX | Team |
|---|---|---|---|---|
| **A. On-screen thanks; one closing email only if they left a verified address (recommended)** | Same as welfare reports. Needs nothing new. | Most reporters give no address and hear nothing. | Calm; no promise. | No mail work for most reports. |
| B. A, plus a push when the report is closed | Closes the loop for the majority at no sending allowance. | The push machinery targets cats and spotters, not reports. Tells people when a decision about their photo is made. | Nicer. | Extra build. |
| C. A "my reports" list in the app | Always available. | A new screen. Raises expectations of a reply. | A promise. | More to answer. |
| D. Nothing at all | Least. | A person who reported something private gets no closure. | Cold. | None. |

**Recommendation: A.** It matches the open push question in the welfare spec (§9.2); revisit when Samuel decides that one.

### D10. How does Turnstile work in the phone apps?

See §9.4. **Recommendation: A, a hidden WebView on our own challenge page,** proven first by the spike.

### D11. What if there is no valid Turnstile token? (amendment to SYC-170's wording)

See §9.5. **Recommendation: for Report an issue, queue it but never hide it or email it individually; for the welfare form, option B (accept, mark unchecked, cap the alert emails).** This relaxes SYC-170's "checked before a report is accepted" and needs Samuel's explicit yes.

### D12. How long are issue reports kept?

| Option | Benefits | Risks |
|---|---|---|
| **A. One year after closing, then delete the note and keep a bare record (recommended)** | Short enough that personal text does not pile up; long enough to spot repeat problems. | A different rule from welfare reports (three years), which the privacy policy must explain. |
| B. Three years, like welfare reports | One rule. | Keeps a note about a stranger's photo longer than its purpose needs. |
| C. Delete on closing | Least data. | "Have we been asked about this before?" cannot be answered. |

**Recommendation: A.**

### D13. When does this ship relative to the rest of the queue work?

The hide needs SYC-43 part 2's **PR 6** (`photo_visibility_events`, `publicPhotoUrl()`), which is not built yet. PRs 0 to 4 are on `main`.

| Option | Benefits | Risks |
|---|---|---|
| **A. Build it after PR 6 (recommended)** | One hiding mechanism and one inbox, as SYC-44's comment and the plan require. | Cannot ship ahead of PR 6. |
| B. Ship the non-hiding reasons first (name, cat, died, other) and add hiding when PR 6 lands | Earlier value for corrections. | Two releases of the same sheet, and the privacy reasons, the point of the feature, arrive last. |
| C. Build a temporary hide of its own | Ships now. | A second hiding mechanism, which the plan explicitly rejected. |

**Recommendation: A.** Turnstile on the welfare form (SYC-170) does not wait for PR 6 and should go first, because it is the precondition for removing the pre-launch pass.

---

## 13. Technical notes

*For whoever writes the implementation plan.*

- **API:** `POST /api/issues` with `deviceId`, `clientRef`, `reason`, `catId`, `photoPublicId`, `note`, `language`, `turnstileToken`. The app already holds the public photo id inside `photoUrl`; the server maps it to `photos.id`. `lib/api-spec/openapi.yaml` and the generated clients gain the route. The plan decides whether `POST /api/reports` gains `turnstileToken` as an optional field (compatible with older builds in testers' hands).
- **One transaction** writes the report row, the hide and the queued alert. A test proves a report on a hidden photo is still recorded and a tokenless report writes a row and no hide.
- **`photo_visibility_events` author** is `report:<id>`; a restore is a person id (PR 6 already allows both).
- **Team pages** extend `lib/teamPages/queuePage.ts` with an Issues section, and the team cat page with a "Reports about this cat" strip. Server-rendered HTML like the rest; no scripts.
- **Mail:** a new alert builder beside `lib/welfare/alertEmail.ts`; same outbox, same send function, same attachments rule. `urgent_alert` stays OFF (F1).
- **Rate limits** use `express-rate-limit` now and move to SYC-105's store; the hide limit is written against the shared store from the start.
- **Native:** `react-native-webview`, a `/_challenge` route in `serve-web.js` (let through the pre-launch gate), and a client twin of `lib/turnstile.ts`. A separate test widget for development.
- **Tests that must exist** (named so they appear in the plan):
  1. A confirmed `photo_private` or `photo_inappropriate` report with a valid token hides the photo in the same transaction, and it then answers `404` on the public route and is absent from the cat list, cat detail, match candidates and notifications.
  2. The same report with a missing, wrong, expired or reused token writes a row and does not hide.
  3. A photo restored by the team is not hidden by a later report.
  4. The 6th hide from one address in an hour does not hide and the row says so, across two processes.
  5. A `cat_died`, `wrong_name` or `location_revealing` report changes nothing public.
  6. Closing an issue never writes a `welfare_outcome`, and a welfare closing still does.
  7. The queue and its JSON never carry the reporter's device id, address or IP, and a photo only as a team URL.
  8. The alert email carries no reporter contact and attaches the photo; every typed string is escaped.
  9. Turnstile: wrong `action`, wrong `hostname`, `success: false`, a timeout and a reused token are each handled as §9.5 says; the secret is never logged.
  10. An offline-queued report never says "hidden" and is sent when the connection returns; a second send of the same `clientRef` makes one report.
  11. The reason sheet's first line links to "This cat needs help".
  12. Each of en, el and fr has every new key.
  13. The source test PR 6 adds (no hand-built `/api/photos/` addresses) covers any place this feature adds.
- **Browser check before the PR:** the reason sheet, confirm step and full-screen photo at 390 px and desktop, with data, in all three languages.

---

## 14. Risks

| # | Risk | What we do |
|---|---|---|
| 1 | **The hide is used to vandalise the catalogue.** | Accepted by Samuel (28 Sep). Narrowed by §8.1 (token, no re-hide after restore, per-address caps) and the volume banner. |
| 2 | **A privacy report is slower than the person needs** (offline, no token, or the hide limit). | Honest copy; the queue row always exists; D5 keeps the question of true removal open rather than hiding it. |
| 3 | **"Hidden" is mistaken for "erased".** | §6 says what it does not cover; the privacy policy must not overpromise. |
| 4 | **Issue reports bury welfare reports.** | A separate section below, never above, with its own colour band; the first line of the reason sheet sends hurt cats to the right place. |
| 5 | **A WebView-based check is brittle** (user-agent changes, blocked storage, a hostname mismatch). | The spike comes first; §9.5 means a failed check never loses a welfare report. |
| 6 | **Limits are not real until SYC-105.** | A named precondition of SYC-114; the hide limit lives in the shared store from the start. |
| 7 | **The welfare table is shared with a new kind of row**, so an old code path could treat an issue as a welfare report. | D1's sweep and test 6. |
| 8 | **Cloudflare becomes a processor** without the privacy policy saying so. | Added to the list `privacy-policy.md` owns. |
| 9 | **The Greek and French confirm step loses half its meaning.** | Native review is a launch blocker for this feature. |

---

## 15. Proposed DECISIONS.md entries

*Nobody edits `DECISIONS.md` from this branch. If Samuel approves, these are the entries for a new Part in the style of Part 2b. Numbers refer to §12.*

- **"Report an issue" lives in the existing queue.** Reports use `welfare_reports` with `kind = 'content'`, shown in a second section under the welfare list, never above a welfare report. (D1.)
- **A privacy report hides, as an inappropriate-content report does.** One confirmed report about a photo that shows a person or a private place hides it pending review, on the approved confirm step. (D2; amends Part 2b.)
- **Three safeguards on a one-report hide.** A hide needs a verified Turnstile token; a photo the team has restored is not hidden again by a report; hides per address are capped at 5 an hour and 15 a day. (D3.)
- **A hidden photo is hidden from everyone but staff** and is replaced in the sightings list by a neutral tile. "Visible to whoever uploaded it" is dropped. (D4; amends §6.)
- **Hiding is not erasure, and the team cannot yet delete a photo for good.** A real delete is a separate ticket, settled before launch. (D5.)
- **A report about location or home text, or about a death, never changes anything by itself.** The team acts. (D6, D7.)
- **A photo is reported from a larger view of that photo.** (D8.)
- **The reporter hears back only through a verified closing email.** (D9.)
- **Turnstile on both public report forms, in a WebView on our own challenge page on the phone apps.** Verified in Express; no Worker. (D10.)
- **No valid token: an issue report is queued but never hides or emails; a welfare report is accepted, marked unchecked, and its alert emails capped.** This relaxes SYC-170's wording. (D11.)
- **Issue reports are kept one year after closing,** then the note is deleted. (D12.)
- **Report an issue is built after PR 6 of the queue plan.** (D13.)

---

## 16. What "done" looks like

- A neighbour who sees their front door in a catalogue photo can hide that photo in about three taps, is told what happened, and the public no longer sees it, even if every email failed.
- A tourist who thinks a cat's name is rude can say so, and the name is changed by a person, not by the report.
- Nobody can declare a living cat dead, or take a cat off the map, by sending a report.
- A script that posts reports with no Turnstile token hides nothing and sends no alert flood.
- A hurt cat reported through "Report an issue" is pointed to "This cat needs help" before it is sent.
- A volunteer opens the dashboard, sees welfare reports first and issues below them, with report-hidden photos at the top of the issues, and restores any of them in one tap.
- The pre-launch pass can come off (SYC-114) with Turnstile checked on both forms and shared limits counted in Postgres.
- Greek and French speakers read every word of it in their own language, and a native speaker has checked the confirm step.
