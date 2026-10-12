# "Report an issue" on every cat and photo

**Feature spec · Cat Spotters (Syros)**
**Version:** 1.0 draft · 7 October 2026
**Covers:** `team-access-and-welfare-queue.md` §6 (which this spec fills out and, in four places, amends), and the Turnstile protection for both public report forms.
**Linear:** SYC-44 (Report an issue) · SYC-170 (Turnstile on the welfare report and on Report an issue). Touches SYC-105 (shared rate limits), SYC-113 and SYC-114 (the pre-launch pass), SYC-150 (move a sighting to another cat) and SYC-232 (a real example of what people will report).
**Status:** **Draft, awaiting an adversarial review and Samuel's approval.** Nothing here is built. The shape of §6 in the approved welfare spec is already decided; this document is about the details underneath it and the open choices in §12.

### What this document owns, and what it borrows

| What | Owner |
|---|---|
| The reasons a person can give, the button, what the reporter sees, how an issue lands in the queue, what the team can do with it, and the Turnstile rules for **both** public report forms | **This document** |
| The queue itself (four states, team note, state history), the team's sign-in, capability names, the alert email and the "photo pending" pattern | `team-access-and-welfare-queue.md` and the SYC-42 / SYC-43 plans |
| The hide-and-restore log (`photo_visibility_events`) and the one function that builds public photo addresses (`publicPhotoUrl()`) | `docs/superpowers/plans/syc-43-part-2-welfare-queue-and-corrections.md`, PR 6 (not yet built) |
| Email verification, consent wording, the closed list of email moments | `email-capture.md` |
| Location blurring and feeding-site privacy | `cat-record-data-spine.md` |
| The pre-launch pass and its removal | `docs/superpowers/plans/syc-113-pre-launch-gates.md`, SYC-114 |

Where this spec and `DECISIONS.md` differ, `DECISIONS.md` wins, except where a decision here is marked as **an amendment** and put to Samuel in §12.

---

## 1. The short version

Anyone, with no account, can tell Syros Cats that something about a cat or one of its photos is wrong. They tap a quiet **Report an issue** link, pick a reason in plain words, optionally add a sentence, and send. It lands in the same dashboard queue as cat-in-trouble reports, in its own section below them, and as an email to the shared inbox.

Two kinds of report are treated differently from the rest:

- **A photo that shows a person, a house number or anything private, or that is upsetting or offensive,** is hidden from everyone the moment the reporter confirms, and stays hidden until the team decides. One report is enough (decided 28 September). Hiding a good photo for a few days costs nothing; leaving a private one up costs a lot.
- **A cat that has died, or a map spot or home description that shows where someone lives,** is never changed by the report alone. The team looks and the team decides. A stranger's report is a tip, not a fact about a cat's life.

To keep the form from being used as a weapon, it is protected by Cloudflare Turnstile (a check, usually invisible, that the sender is a person using the real app or website), by per-address limits, and by three extra rules about hiding (§8). The same Turnstile check goes onto the cat-in-trouble form (SYC-170). Turnstile needs a web page to run in, which the phone apps do not have, so §9 spells out how the Expo apps cope and puts the choice to Samuel.

### The thing that matters most

**Hiding must be quick, and a wrong hide must be cheap to undo.** A person whose child, front door or number plate is in a catalogue photo wants it gone now, not when somebody reads an email. So the hide happens on the server in the same step that records the report, and the email to the team is the notification, never the trigger. If every email fails, the photo is still hidden and the report is still in the queue.

### The two audiences want the same thing from different angles

A local who knows a cat's name is wrong, a cat guardian whose cat has died, and a neighbour who does not want their doorway in a public photo all know something the app does not. A tourist who comes across an upsetting or odd photo is in a different position but needs the same thing: a one-tap, no-account way to say so, without needing to know who at Syros Cats will read it.

---

## 2. What someone can report

Eight reasons, in the words the screen uses. English wording is final here; Greek and French follow §11.

| Key | What the person sees | Hides on one confirmed report? | What the team usually does |
|---|---|---|---|
| `photo_private` | **It shows a person or a private place** · "faces, house numbers, number plates, a doorway or the inside of a garden" | **Yes** (decision D2) | Look at the photo. Keep hidden, or restore if nothing private is in it. |
| `photo_inappropriate` | **It's upsetting or offensive** | **Yes** (approved 28 Sep) | Same. |
| `photo_not_cat` | **That's not a cat** · a picture that has nothing to do with cats | No | Hide the photo (one tap) if it is wrong. |
| `wrong_cat` | **That's a different cat** · "this photo is of another cat" | No | Hide the photo for now. Moving it to the right cat is SYC-150. |
| `wrong_name` | **The name is wrong, or not OK** | No | Rename the cat (live, SYC-43 PR 4). |
| `location_revealing` | **The map spot or the words show where someone lives** | No (decision D6) | Look; clear the home text; see D6 for the map spot. |
| `cat_died` | **This cat has died** | No, never | Look. If it is known, record "no longer with us" with a date (live, PR 4). |
| `other` | **Something else** | No | Whatever is right. |

Notes on the list:

- **Nothing here replaces "This cat needs help."** A cat that is hurt now is a welfare report and gets the vet-first guidance, which is the most carefully written copy in the app. The first line of the reason sheet says so: *"Is a cat hurt or in trouble right now? Use 'This cat needs help' instead."*, as a link. Without that line, "Report an issue" becomes a way around the capacity messaging, and a worried tourist ends up in a queue that is read on Monday.
- **`cat_died` is gently worded** and never promises a change: *"We're sorry. Syros Cats will check and update the cat's page."*
- **`other` covers "something about this cat is wrong"**, such as a wrong home status or ear-tip answer. The team's "mark wrong" (PR 4) applies to the standing statement.
- **A note is optional** (up to 1,000 characters, no counter shown) and is team-only text.
- **A real example, SYC-232.** Today a "has a home" push can carry the owner's home description ("the blue house above the harbour") to every past spotter, and the cat page shows the same text publicly (`homeDescription` is in the public cat payload). A neighbour who sees their street named there would use `location_revealing`. Fixing the push is SYC-232; this report is the safety net for the text that remains on the page.

---

## 3. Where the button sits

A quiet text link, the same weight as "This cat needs help" and always below it. Never an icon-only control and never the biggest thing on the screen. Most photos are fine, and an app that puts a flag on every picture teaches people to feel watched.

1. **On a cat's page** (`app/cat/[id].tsx`, beside the existing `NeedsHelpLink`): **Report an issue** about the cat. It offers the cat reasons: `wrong_name`, `location_revealing`, `cat_died`, `wrong_cat`, `other`.
2. **On each photo.** Tapping a photo (the main photo or one in the sightings history) opens it larger in a new, simple full-screen view: the photo, the date, who spotted it, **Close**. Beneath it, **Report an issue with this photo**. It offers the photo reasons first: `photo_private`, `photo_inappropriate`, `photo_not_cat`, `wrong_cat`, then `other`. (Decision D8 sets out the alternatives.)
3. **Not in v1:** the cat list cards, the map pins, push notifications and the "is this the cat?" picker. Each leads to the cat page in one tap, where the link is. A hidden photo disappears from all of them anyway, because every public photo address is built by `publicPhotoUrl()` (PR 6).

The website and the phone apps get the same links. The web has no long-press, which is part of why a full-screen view beats a hidden gesture.

---

## 4. What the reporter sees

### 4.1 The flow

1. **The reason sheet.** The reasons above as large, plain buttons, with the short first line about hurt cats.
2. **One optional box:** "Anything we should know?"
3. **Email, optional,** *only if* the email feature is live (§7, decision D9). The wording and the unticked news box are `email-capture.md`'s, verbatim.
4. **For a hiding reason, the confirm step** (approved text, DECISIONS Part 2b): *"Are you sure? Reporting this will hide it from everyone until Syros Cats have reviewed it."* with **Report and hide** and **Cancel**. Nothing is hidden or sent until they tap **Report and hide**.
5. **Send.** The Turnstile check runs in the background and the person sees nothing unless the widget needs a tap (§9).
6. **The confirmation.** Plain and short. For a hide: *"Thank you. The photo is hidden while Syros Cats take a look."* For everything else: *"Thank you. Syros Cats will take a look."* Neither says when, because nobody is on duty (F1). Every message lives in the app's language files (§11).

### 4.2 Offline and weak signal

Be precise: **a report is saved on the phone first and reaches Syros Cats only when the phone has a connection.** It uses the same saved-on-the-device list as cat reports and sightings (`lib/queueStore.ts`, the cross-tab lock, the one reminder after 24 hours). On the web this applies when the browser reports no connection; with one weak bar of signal the send is attempted and, if it fails, the report is kept and retried (the same behaviour as cat reports).

- The offline confirmation says *"Saved on your phone. It will be sent when you have a connection."* It never says "hidden", because **nothing is hidden until the server has the report**. A person who reports a private photo while offline is told exactly that, so they do not assume the picture is already down.
- A queued report does not hold a Turnstile token (a token lives five minutes). §9.5 says what happens at send time.
- There is no photo to upload with an issue report, so it is tiny and survives a weak signal better than a cat-in-trouble report.
- Opening the full-screen view of a photo needs that photo to have been loaded already. Nothing here changes what the app can show offline.

### 4.3 What the reporter does not see

Who read it, what the team decided, whether anyone else reported the same thing and (unless they left a verified email, §7) the outcome. There is no public record that a report exists, except one neutral thing: **a hidden photo is gone from every public view, and its place in the sightings list shows a quiet tile, "Photo hidden while Syros Cats take a look."** (Decision D4.)

---

## 5. How it reaches the team

### 5.1 The queue is the source of truth

As with welfare reports (spec §4.3), **the queue row is written first, in the same database transaction as everything it causes**: the hide, the count and the queued alert email. Mail cannot lose a report and cannot delay a hide.

**Where the row lives is decision D1.** The recommendation is the existing `welfare_reports` table with `kind = 'content'`. The column and its check already exist for exactly this (`lib/db/src/schema/welfare.ts` reserves it), and spec §8.4 already says so, so the dashboard has one queue, one set of four states, one team note, one history and one delivery-state column. That needs a small migration:

- `lat` and `lng` become optional for `content` rows (a check keeps them required for `welfare`);
- new nullable columns: `reason` (the key from §2, checked), `photo_id` (→ `photos.id`), `hidden_by_report` (boolean) and `token_checked` (boolean, §9). `cat_id` is already there;
- `severity` is set to `attention` for content rows (it is only used to order the welfare list) and `is_litter` stays false.

Everything that reads `welfare_reports` today must learn to look at `kind`: the queue page and its JSON (`lib/welfareQueue.ts`), the alert email, "tie to a cat" (PR 5), and the `welfare_outcome` observation, which **must not** be written when an issue report closes (it is a statement about a cat's welfare, which an issue is not). The plan that follows approval lists each place and gives each a named test.

### 5.2 The email to the shared inbox

A second alert type through the existing outbox and the one send function. It uses the `welfare_alert` team purpose, which already goes to `WELFARE_ALERT_TO`, with its own subject lines so the inbox can filter:

| Case | Subject starts |
|---|---|
| A photo was hidden | `Photo hidden: possible private or offensive content` |
| Location or a home description reported | `Issue report: location may be revealing` |
| A cat reported as died | `Issue report: cat reported as died` |
| Everything else | `Issue report: wrong cat, name, photo or other` |

The body carries the reason, the reporter's note (escaped), the cat's name with a team-page link, and for photo reports the photo **as an attachment** (the same rule as welfare photos: a team link fails in a mailbox, and a public link would be wrong for a photo that was just hidden). **No reporter contact details** (spec §3.1 and §4.3): "the reporter left contact details; reply from the dashboard."

**Latency, honestly.** Mail goes out right after the report and after any later API request, with the GitHub drain as a safety net that in practice runs every few hours (SYC-231). That is acceptable here **because the hide does not wait for mail**. It is not something to rely on for `location_revealing` or `cat_died`, which only a person can fix, and which is why the interface never implies they are urgent. SYC-231's fix (an external cron) helps this feature as much as the welfare one.

### 5.3 Where it lands in the dashboard

The queue page keeps its first section, **Waiting for the team** (welfare reports, urgent first, exactly as built). Below it, a second section, **Issues**, visually distinct (a different colour band and a type label on each row) and never above a welfare report (approved, §6).

Inside **Issues**, the order is:

1. **Hidden, waiting for you.** Photos hidden by a report and not yet decided. The public is already safe, so these are ordered by how long they have waited, longest first, and the number shows in the dashboard's top bar.
2. **Location, and cats reported as died.** Need a person.
3. **Everything else,** newest first.

Each row shows the reason in plain words, the cat's name and the photo (served only through the team route, as hidden photos are), what the reporter wrote, how long ago, **"2 others reported this photo"** when the same photo or cat-and-reason has other open reports, whether the reporter left a way to be contacted, and the four states and team note the queue already has. Repeat reports stay separate rows (the record is add-only); only the count is shown.

### 5.4 What the team can do

Everything here exists or is already planned. Each action names the capability that guards it (spec §7.3). Only the last three rows need anything new, and §12 puts those to Samuel.

| Action | Where it comes from | Capability |
|---|---|---|
| **Keep it hidden** (closes the report as *Done*) | PR 6 hide/restore log | `hide_photo` |
| **Restore the photo** (one tap, attributed; closes as *Nothing needed*) | PR 6 | `restore_photo` |
| **Hide a photo** that a non-hiding report points at (`photo_not_cat`, `wrong_cat`) | PR 6 | `hide_photo` |
| **Rename the cat** | PR 4, live | `rename_cat` |
| **Say the cat is no longer with us** (reason, and the date the team knows of) | PR 4, live | `set_life_status` |
| **Mark a statement wrong**, with a reason | PR 4, live | the statement's own capability |
| **Open the cat's page** (exact location, full history) | PR 3, live | `view_exact_location` |
| **Change state, add a team note** | PR 2, live | `change_report_state`, `add_team_note` |
| **Move the photo to the right cat** | SYC-150, not built. Until then `wrong_cat` means "hide the photo and leave a note" | later |
| **Clear a home description / hide a map spot** | Not built (decision D6) | new |
| **Delete a hidden photo for good** | Not built (decision D5) | new |

A report that hides a photo and is then closed records both: the original hide (author `report:<id>`) and, if the team restores, a restore (author a person id). The log is add-only, so "who hid this, and who put it back?" always has an answer.

---

## 6. Urgent cases: a privacy problem means hide fast

The approved rule stands: one confirmed report hides a photo pending review. This spec adds what is needed to make it real and states its limits.

**What makes it fast.**
- The hide is part of the report's database transaction: a `hide` row in `photo_visibility_events` with author `report:<id>`, written with the queue row. Nothing is mailed, polled or approved first.
- Every public place that shows a photo reads from `publicPhotoUrl()` and answers `404` for a hidden photo (PR 6). In the sightings list the tile reads "Photo hidden while Syros Cats take a look." (D4.)
- If the hidden photo was the cat's main photo, the page shows the newest visible photo or the placeholder (PR 6, Decision 4). A restore brings the original back.

**What stays slow, and is allowed to.** A person cannot be fetched at once. The team may read the report on Monday. That is fine for a hidden photo, because the harm has already stopped. It is **not** fine for a map spot or a home description (D6), which is why those get their own decision.

**What hiding does not cover (said now, so nobody finds out later).**
- A hidden photo is still in the database and still one of the matching model's reference images (PR 6's own note). For a photo that shows a face or a doorway, hiding is not erasure. Decision D5 asks Samuel whether v1 includes a real delete.
- A hidden photo may already be in someone's phone cache or screenshot. Nothing can fix that, and the privacy policy must not imply it can.
- The offline cat list on a phone may keep showing the photo until its next refresh.

---

## 7. Feedback to the reporter

The default: **the person is told on screen that Syros Cats will take a look, and nothing else unless they gave a verified email.** The welfare spec already treats this as the rule, and no address ever receives mail from us that its holder has not confirmed (F7b).

- **No email left:** the confirmation screen is all they get. No push, no list. (Alternatives in D9.)
- **Email left and verified:** the same machinery as welfare reports: the one fixed "is this you?" message from the news identity, nothing else until confirmed, then **one** closing email when the team moves the report to *Done* or *Nothing needed*, from fixed copy, never free text. Suggested wording (final text belongs to Syros Cats and Samuel, and needs el and fr):
  > "Syros Cats have looked at your report about [Agatha's photo] and taken appropriate action. Thank you for helping look after the cats of Syros."
  The closing email never says what the action was: a team decision about someone's photo is not the reporter's to know, and *Nothing needed* must not read as "you were wrong."
- **Reply-To** is `admin@syroscats.com` on every reporter-facing message, as for welfare reports.
- **This depends on SYC-42 Slice 3 and `email-capture.md`.** Until they are live the email box is not shown on this form (the ruling SYC-42's Decision 4 made for welfare reports). Nothing else in this spec waits for it.

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
