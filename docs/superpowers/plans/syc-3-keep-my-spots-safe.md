# SYC-3: "Keep my spots safe" — implementation plan (awaiting Samuel's approval)

**Linear:** SYC-3. **Status:** plan only. Nothing here is built, published or configured.
**Design (approved, not reopened here):** `docs/specs/email-capture.md` §3.0, §4, §5.1, §8 · `docs/specs/DECISIONS.md` Part 2d · `docs/specs/privacy-policy.md` ("Keep my spots safe") · the safeguards in `docs/specs/team-access-and-welfare-queue.md` §2.4–2.6, §8.1.
**Checked against:** `origin/main` at `d2b9ca1` (29 Sep 2026), PR #28 (`claude/syc-43-part1-build`, open), PR #24 (open), the SYC-121 plan and the Neon runbook. Every "exists today" claim below names the file it was read in.

---

## In plain English

**What a spotter will experience.**

- **Starting out.** The last onboarding step says *"Don't lose your spots"*. You can add an email so you can get your spots, points and badges back if you lose or change your phone, or you can tap **Skip**. Both buttons are the same size. Skipping costs nothing.
- **Checking it's you.** If you add an address, one email arrives asking *"Is this you?"*. Until you tap **Yes, that was me**, the address can't be used to restore anything, and nothing else is sent to it.
- **Getting your spots back.** On a new phone or browser, the first onboarding screen offers *"Already a spotter? Get your spots back"*. You type the address and we email a link. **You open the link on the phone that's getting the spots back**, press one button, and your username, points, badges, named cats and collection are there.
- **The old phone.** The next time it talks to us, it shows *"Your spots moved to a new phone"* and stops acting as you.
- **What it can't do.** A username never restores anything, because usernames are public. The news email never restores anything either. Restoring needs a connection: you can't add the address, or get your spots back, while offline.

**What testers get.** Testers who add an address before their browser forgets them can get everything back. Testers who have already lost their spots can't use it, because they never added an address. Decision 1 below covers them and the weeks before this ships.

**Why it's safe.** Whoever can open the "keep my spots safe" inbox can take the collection, and the screen warns about exactly that. On top of that: the link works once, lasts 15 minutes, is used up only when the button is pressed (so email scanners can't burn it), is rate-limited, and only works on the phone that asked for it. We reply the same way whether or not we know the address, so the form can't be used to find out who has one.

---

## Decisions for Samuel

There are five, one at a time, each with a recommendation. **All five were decided by Samuel on 30 Sep 2026, each as recommended. The plan as a whole is still awaiting his approval.** Decision 1 is the one that matters this week.

### Decision 1 — What do we do for testers before this ships?

**Decided by Samuel, 30 Sep 2026:** (a) now, after the SYC-134 iPhone check, plus (b′) after Slice 1; not (b). Every tester is told to use only apptest.catspotters.com.

**The situation (checked 30 Sep, SYC-3 comment).** On the website, a tester's identity lives only in that browser's storage for that one web address. Safari clears it after 7 days without a visit. So do private browsing, clearing browsing data, switching browser and opening a different address. A tester whose storage goes is sent back to onboarding, and their old username is already taken. Their spots are still safe on the server, but nothing can link them to them again.

| Option | What testers experience | Benefits | Risks |
|---|---|---|---|
| **(a) An "Add to Home Screen" nudge**: a one-line banner on the website on iPhone, plus a WhatsApp message | A tester adds the app to their Home Screen and opens it from there from then on | Cheap: a few hours of work and no server change. Home Screen web apps aren't subject to Safari's 7-day rule | **On iPhone, a Home Screen web app keeps its storage separately from Safari.** A tester who adds it today and opens it from the icon may start as a stranger and have to onboard again, which is the exact thing we're trying to stop. The web build has no web-app manifest today (`app.json` → `web` holds only a favicon), so how iOS treats the icon isn't known. **Needs checking on a real iPhone before anyone is told to do it**, and the answer may differ between iOS versions, so check on the versions testers actually use. It doesn't help anyone who has already lost their spots. |
| **(b) Staff-assisted re-link**: a tester who lost their spots messages Samuel; Samuel confirms it's them over WhatsApp; Claude runs a `db-ops` command that moves the old spotter onto the tester's new browser | "Message Samuel" and wait for him to reply and for Claude to run the command | The only option that rescues someone who **already** lost their spots | You rejected staff-assisted recovery on 28 Sep as "slow and easy to trick", and that is still true. Usernames are public, so a stranger can claim any of them, and the only protection is Samuel recognising the person. It also isn't cheap: the tester's new browser has to show a code Claude can use, and the command needs the same careful "move the spotter" step as Slice 1. Built early, it's a second, less protected way to take over a spotter, running against the live database. |
| **(b′) Staff adds a restore address, then the tester uses the normal restore** (only possible after Slice 1 ships) | "Message Samuel", he checks it's them, then the tester gets the normal email link and presses the button | Rescues testers who lost their spots. The risky part stays in the normal flow: the tester still has to open the link from their own inbox, on their own phone. Staff only record an address, they never move a spotter | Still relies on Samuel knowing it's really them. Only testers he knows personally. It has to be retired at launch (ticket to file) |
| **(c) Nothing** | Testers who lose storage start again | No work | Testers lose collections they've built up, which is the exact complaint behind this ticket, and some will stop testing |

**Recommendation: (a) now, once it's been checked on a real iPhone, and aimed at new testers (SYC-134); then (b′) after Slice 1 for anyone who has already lost spots (SYC-135). Not (b).**
- Check first whether the Home Screen icon on iPhone shares Safari's storage. If it does, send the nudge to everyone. If it doesn't, send it only to testers who haven't started yet, and tell existing iPhone testers to **open the site at least once a week** instead.
- Meanwhile, keep a list of testers who lose their spots (one Linear ticket, with their old usernames) so (b′) can bring them back once Slice 1 is live.
- **Tell every tester to use only `apptest.catspotters.com`**, never a `replit.app` address. This costs nothing and matters for the Neon move (see "How this fits the Neon move").

Draft WhatsApp message for now (if you pick (a); fill in the iPhone line once it's been checked):

> Quick Cat Spotters tip 🐈 If you use it in a web browser, your spots are kept in that browser. If Safari clears it (it does this after a week without a visit), or you switch browser or phone, the app forgets you. Until we've built a proper fix (coming soon):
> • Always use **apptest.catspotters.com**, and no other address.
> • [iPhone: Add to Home Screen / Open it at least once a week.]
> • If the app ever asks you to pick a username again, don't worry, your spots are safe with us. Message me with your old username and I'll note it down so we can bring them back.

### Decision 2 — Only the phone that asked can use the link (a clarification)

**Decided by Samuel, 30 Sep 2026:** only the phone that asked can use the link.

The spec says the link "moves the collection … to the new phone". It doesn't say what happens when the link is opened somewhere else. The plan makes it precise: **the link only works on the phone or browser that asked for it.**

| Option | Benefits | Risks |
|---|---|---|
| **A. The link works only on the phone that asked** | Closes the "trick someone into clicking" takeover. A stranger who knows your address can ask for a link, but the link lands in *your* inbox, and pressing its button on *your* phone does nothing for them. It also makes sure the spots go where the person is actually using the app | If the email app opens the link in its own built-in browser (the Gmail app on iPhone can), that browser is a different "phone" and the page says *"Open this link in the browser where you asked for it"*, with a copy-link button. Parents reading the link on their own phone have to open it on the child's phone |
| B. A plus a short code in the same email, typed on the phone that asked | Gets round the wrong-browser problem, and a parent can read the code out | **Rejected on security grounds.** An attacker asks for a link for *your* address from *their* phone, and their phone is then the one allowed to type the code. With a 6-digit code, 5 tries per link and the rate limits, that's about a 1-in-700 chance a day, which adds up over a year. A code long enough to be safe (8+ characters) is hard for children to type. It also changes the approved design |
| C. Whoever presses the button gets the spots | Closest to the spec's wording | A stranger can ask for a link for your address and hope you press the button, and then your collection is theirs. It's the classic "click to confirm" trick. The spots also land in whichever browser opened the link |

**Recommendation: A.** It's the safe reading of the approved design. The email and the page say plainly, *"Open this on the phone that's getting your spots back"*.

### Decision 3 — One parent's email for two children

**Decided by Samuel, 30 Sep 2026:** a picker when several spotters share one address.

The spec tells under-15s to use a parent's email, so siblings will share one. The spec doesn't say what happens then.

**Recommendation:** after the button page has proved the inbox, it lists the spotters kept safe with that address by username, with one button each (*"Move Lili's spots to this phone"*). Only someone who has opened the link sees the list. Two spotters sharing an address are never merged, and neither is told about the other. The alternative, allowing only one spotter per address, would silently stop the second child's parent from protecting them.

### Decision 4 — Store the restore address, or only a scrambled fingerprint of it?

**Decided by Samuel, 30 Sep 2026:** store only a keyed fingerprint and a masked form.

The spec's storage note (§9) says an address is stored. For this email the app never has to write to the address unprompted: the person types it again when restoring, and we send the link to what they typed.

| Option | Benefits | Risks |
|---|---|---|
| **A. Store only a keyed fingerprint (HMAC) and a masked form (`s•••@gmail.com`)** | If the database ever leaks, it doesn't hold parents' and children's addresses. Settings can still show the masked form | We can never email these people unprompted, for example a "still want this?" message after 24 months. If the fingerprint key is lost, everyone has to add their address again. It's hard to reverse later without asking everyone to re-add |
| B. Store the address, like news addresses will be | Simple. Consistent with SYC-45. Allows future unprompted mail | A leak exposes a list of emails, many of them parents of children |

**Recommendation: A.** Nothing in the approved design sends unprompted mail to this address, and it's the more protective choice for a list that will be mostly children's parents.

### Decision 5 — The "is this you?" and "forget this address" pages sit outside the tester password

**Decided by Samuel, 30 Sep 2026:** the confirm and forget pages sit outside the tester password; the restore page stays behind it.

See "The website password gate" below. **Recommendation:** these two small pages and their two API calls are reachable without the tester password, because a parent confirming an address won't have it. They're protected by their own one-time token, as the staff pages are. The restore button page stays behind the password.

---

## What exists today, and what has to be built first

Checked against `origin/main` and the open PRs, not the tickets.

| Needed | Exists? | Evidence |
|---|---|---|
| Device identity (id, secret, username) | **Yes**, in AsyncStorage (localStorage on web). **The secret is made with `Math.random()`**, which isn't a cryptographic source | `artifacts/cat-spotter/context/DeviceContext.tsx` (`makeDeviceSecret`) |
| Server check of the device secret, bound on first use | **Yes**, SHA-256 of the secret in `device_credentials` | `artifacts/api-server/src/lib/deviceAuth.ts`, `lib/db/src/schema/devices.ts` |
| Every route acting as a spotter checks the secret | **No.** `POST /cats`, `POST /cats/:id/claim` and `PATCH /cats/:id` trust a device id sent in the body. An old phone would keep going on these | `artifacts/api-server/src/routes/cats.ts` lines 100, 229, 283; ticket **SYC-107** |
| Mail sending from the app (Express) | **No.** No Resend client, no send function and no mail key in `artifacts/api-server` or `lib`. SYC-25 (Done) set up `mail.catspotters.com` and the key for the **sign-in Worker** in the other repo only | `grep -ri resend artifacts lib` finds only a build-config mention; `docs/superpowers/plans/syc-25-signin-mail.md` "Scope" |
| `news.catspotters.com` sending domain | Not needed for this work: both keep-safe messages are transactional (§5.1). Its state matters to SYC-45 | SYC-25 plan, decision 2 |
| Email verification ("is this you?"), consent records, suppression list, send budget | **No.** SYC-45 (email capture) is in Backlog, with nothing built | Linear SYC-45; no tables in `lib/db/src/schema` |
| Rate limits counted across servers | **No.** `express-rate-limit` counts in memory, per server | `artifacts/api-server/src/middlewares/rateLimit.ts`; ticket **SYC-105** |
| Staff-link safeguards (single use, 15 min, button press, identical replies) | **Only in the sign-in Worker** (Cloudflare, D1, other repo). This repo has none of the link half | `team-access…` §8.1; SYC-25 plan |
| One-time pass spent in Postgres, `session_version`, identical refusals | **In PR #28, not merged**: `team_handoff_spent` (`INSERT … ON CONFLICT DO NOTHING RETURNING`), `people.session_version`, `lib/teamAuth/refuse.ts`, and the `Origin` check on `POST /api/team/signout` | PR #28 files |
| Pre-launch gates | **Yes** (PR #30, merged): the website password page keeps the full address, **including `?t=…`**, through the password (`serve-web.js:408`, `safeNext(req.url, …)`); the API needs the cookie or the tester key, except for `/api/healthz`, `/api/internal/*` and `/api/team/*` | `artifacts/cat-spotter/server/serve-web.js`, `artifacts/api-server/src/middlewares/prelaunchGate.ts` |
| Onboarding | Welcome → How it works → Language & username. The flow ends when a username is claimed. Welcome has an "I already have an account" link that opens an explanation | `components/onboarding/OnboardingFlow.tsx`, `WelcomeStep.tsx` |
| Push token per spotter | One row per device id | `lib/db/src/schema/notifications.ts` (`push_tokens`) |

**What we reuse from PR #28 rather than copy:** the Postgres pattern for one-time passes (a conditional write that only one server can win), the identical-refusal helper, and the `Origin` check. We **don't** reuse `people` or `session_version`: a spotter isn't a person on the staff list. The equivalent of "sign out everywhere" for a spotter is replacing the device secret's fingerprint (see "How moving a spotter works").

---

## How moving a spotter works (the core idea)

**Nothing is copied or re-keyed.** Every table keys a spotter by their device id: `profiles`, `sightings`, `cats.discoverer_device_id`, `cat_subscriptions`, `notifications`, `push_tokens`, and `observations.device_id`. Rewriting that id across an append-only history would be large and risky.

Instead, **the new phone takes over the old device id, and the server replaces the secret that id accepts:**

1. The new phone arrives with a fresh id and secret of its own (its "starter id"), with no username and nothing spotted.
2. When the button is pressed, the server, in **one transaction**:
   - checks the link (below);
   - changes `device_credentials.secret_hash` for the restored id to the fingerprint of **the new phone's secret**. This is a single `UPDATE`, never a delete followed by an insert, because in that gap a request from the old phone would be bound as "first use" again;
   - records the replaced fingerprint on the link row, so the old phone can be told *why* it's refused;
   - deletes the restored id's `push_tokens` row, so the old phone stops receiving notifications;
   - deletes the starter id's credential (it never had any data).
3. The reply gives the new phone the restored device id and username. The phone stores them, keeps its own secret, loads the profile (points, badges, owned cats come from `getProfile`), and leaves onboarding.
4. **The old phone's next authenticated request** gets `403 {"error":"device_moved"}`. The server returns that code only when the secret presented matches a fingerprint replaced by a restore. A wrong guess still gets the ordinary `403`. The app then shows *"Your spots moved to a new phone"*.

**Why this meets "stops acting as that spotter at its next request":** every spotter route checks the secret. That's true today for profiles, notifications, push tokens and sightings, and **after SYC-107** for registering, claiming and renaming cats. SYC-107 is therefore a prerequisite (Slice 0).

**Deletion (SYC-63, in progress)** must also delete the spotter's restore address, open links and consent identifiers. Whichever of the two PRs lands second adds that, and a test pins it.

---

## The smallest shippable slice, in order

### Slice 0 — prerequisites, no migration (can start now, in parallel)

1. **SYC-107: every spotter route checks the device secret.** `POST /cats`, `POST /cats/:id/claim` and `PATCH /cats/:id` go through `verifyDeviceSecret`. The client already sends the header on every call through `customFetch`. This is a security fix in its own right, and restore depends on it.
2. **Strong device secrets for new installs (SYC-136).** `makeDeviceSecret` switches to `crypto.getRandomValues` (32 bytes, base64url) on web and `expo-crypto` on native. Existing secrets are left alone.
3. **Keep the link's token out of our logs.** This is already true: the API's log cleaner drops every query string (`artifacts/api-server/src/app.ts`, the `pino-http` `req` serialiser), and `serve-web.js` logs no requests. This step only adds a test that pins it for `/restore` and `/api/mail/*`. Replit's own access logs may record full addresses. That's outside our code, and a restore token from a log is useless to anyone else because it only works on the phone that asked (Decision 2).

### Slice 1 — "keep my spots safe" on the website (what testers need)

**One migration** (see "Migrations"). Built in this order, one commit each:

1. **Tables** (one migration):
   - `restore_addresses`: `device_id` (the spotter; one row each), `address_hmac`, `address_mask`, `status` (`pending` | `confirmed`), `created_at`, `confirmed_at`. Index on `address_hmac`, not unique, because siblings can share one (Decision 3).
   - `mail_tokens`: `token_hash` (primary key), `purpose` (`verify` | `forget` | `restore`), `address_hmac`, `device_id` (for `verify`/`forget` the spotter; for `restore`, **the phone that asked**), `created_at`, `expires_at`, `used_at`, `restored_device_id`, `replaced_secret_hash`, `attempt_ip_hash`. Rate-limit counts per address and the global daily ceiling are **counted from this table**, so they hold across servers without waiting for SYC-105.
   - `email_consent_events`: exactly §5.6: what, where, wording version, when, language, verified at, withdrawn at. Append-only, with the data spine's redaction for deletion. Built here so that SYC-45 uses it rather than inventing a second one.
   - `email_suppressions`: `address_hmac`, reason, when. Used by "Forget this address", the three-lifetime cap and later by SYC-45.
2. **One send function**, `lib/mail/send.ts`: purpose-tagged, with the §5.1 closed list as a TypeScript union and **no free-text path**. Only three purposes are switched on: `keep_safe_verify`, `restore_link` and (from its button) `forget`. Both keep-safe messages send from the **transactional** identity (`mail.`), as `email-capture.md` §5.1 and §8.3 say and checks the suppression list first. A failed send is logged loudly and never swallowed. Resend is called with `fetch`, so no library is needed. If a key is missing, it refuses to send and says so in the start-up log, the same way the gates do.
3. **Adding an address**: `POST /api/keep-safe/:deviceId` (device secret required) with `{ email, language, wordingVersion, surface }`. It stores `pending`, writes the consent event and sends one "is this you?" email, subject to §4.4: one per address per 24 hours, three in the address's lifetime then suppression, the per-IP limit, and a **global daily ceiling that fails closed**. The reply is the same whatever happened. Changing the address replaces the row and needs confirming again. `DELETE` removes it (**Remove** in Settings) and writes a "withdrawn" event.
4. **Confirm and forget pages**: `GET /api/mail/confirm?t=` and `GET /api/mail/forget?t=` return a tiny server-rendered page with one button. **The GET never changes anything**, so scanners can't confirm or forget an address. The button POSTs to the same path, with the same `Origin` check as PR #28's sign-out. "Confirm" sets `confirmed`. "Forget" deletes the row and its tokens and adds the fingerprint to `email_suppressions`. Tokens are 32 random bytes, stored hashed, and last 7 days (§9).
5. **Asking for a restore**: `POST /api/restore/request` (device secret required, **for the phone asking**) with `{ email }`. If the address is `confirmed` for at least one spotter, a `restore` token bound to the asking phone is created and the link email is queued. The response is always `202 {"status":"sent_if_known"}`, **padded to a deadline** (record the start, then wait until start + 800 ms), and the send happens **after** the response. Limits (team-access §2.6): 3 per address per 15 minutes, 20 per IP per hour, at most 3 unexpired links per address (the oldest expires to make room), and the global ceiling.
6. **Pressing the button**: `POST /api/restore/redeem` (device secret required) with `{ token, deviceId (the restored one, from the picker) }`. In order: token exists, isn't expired and is a `restore` token; **the asking phone is the one calling**; the chosen spotter really is kept safe by that token's address and is `confirmed`; the calling phone has no username (only a starter id can be the target); then the conditional write `UPDATE mail_tokens SET used_at=… WHERE token_hash=? AND used_at IS NULL AND expires_at>now() RETURNING …` and the move, all in one transaction. **The same phone sending it again within 60 seconds** gets the same answer (a double tap or a back button isn't a lockout). Precisely: when the conditional write returns no row, the handler re-reads the token; if `used_at` is under 60 seconds ago, the caller is the phone that asked, and `restored_device_id` equals the requested spotter, it returns that spotter's id and username again and changes nothing. Otherwise it refuses. Any other failure gets one fixed refusal, `401 {"error":"link_not_valid"}`, and the real reason goes to the server log with the token's hash prefix. Limit: 30 per IP per hour.
   - `POST /api/restore/peek` (device secret, the asking phone) with `{ token }` returns the list of usernames for the picker (Decision 3). It's the same check as redeem, but reads only.
7. **`device_moved`**: in `verifyDeviceSecret`, on a secret mismatch, look for a used `restore` token whose `replaced_secret_hash` equals the fingerprint presented. If there is one, return `403 {"error":"device_moved"}`; otherwise, today's `403`.
8. **The app**:
   - **Onboarding, last step** (§3.0 copy, word for word): *Don't lose your spots* · the email field · the unticked news box, **hidden in this slice** (it arrives with SYC-45, and a box that did nothing would be a broken promise) · **Save my spots** and **Skip**, equal in size. Claiming a username no longer ends onboarding by itself: a local "keep-safe offered" flag does. If offline, the step says *"You're offline. You can add this later in Settings"* and lets them continue.
   - **Welcome**: "I already have an account" becomes **"Already a spotter? Get your spots back"**, leading to the email field and then *"If that address is keeping a spotter safe, we've sent a link. Open it on this phone. It works once and lasts 15 minutes."*
   - **The `/restore` page** (an app route, so it can read this browser's own id): it reads `t`, removes it from the address bar (`history.replaceState`), calls `peek`, shows the picker, or one button if there's only one spotter, calls `redeem`, stores the restored id and username, and opens the app. Opened on the wrong browser, it says so and offers **Copy link** (Decision 2).
   - **"Your spots moved to a new phone"**: shown on any `device_moved`. The offline queue stops sending. One button, **Start again as a new spotter**, clears this browser's identity and goes back to onboarding. Sightings saved on this phone but not yet sent are **kept** and sent under the new spotter once they've picked a username. The screen says so: *"3 spots saved on this phone will be sent when you start again."*
   - **Settings**: a *Keep my spots safe* row: off → the same screen as onboarding; on → *"Saved to s•••@gmail.com"* with **Change** and **Remove**; pending → *"Check your inbox to confirm"*.
   - **The one-time offer** (the spec's "first badge" offer, §8.3), for spotters who **already** have a badge when they first open this version, which means every current tester: the same screen, once, on first open. Declining is one tap and it's never offered again on this phone.
9. **Emails** (drafts in the appendix; Greek and French from native speakers, SYC-4).

### Slice 2 — the phone apps (SYC-137; ships with the store builds, SYC-32)

1. **The key moves into secure storage** (`expo-secure-store`) on iPhone and Android: the id and the secret move across once, on first launch, and are then read from there. On iPhone they survive deleting and reinstalling the app. On Android and web nothing changes. That's what the email is for.
2. **Links open the app.** The `/restore` page, loaded in a phone's browser, shows **"Open in Cat Spotters"**, which opens `syroscatspotters://restore?t=…` (the scheme in `app.json`), and the app does the same peek → button → redeem. Universal links and app links are a later nicety, not needed.
3. Both run on a real TestFlight and Play build before they're switched on.

### Later (not in this work)

SYC-45 builds the news address on the same send function, consent events and suppression list, and adds the news box on the onboarding step. It also adds a test that **a news address can never be used to restore**.

---

## Where this plan reads the spec, rather than just copying it

No conflict was found between the approved spec and the code on `main` that stops this work. These are the places where the plan has to choose, and each is either a decision above or a narrow choice listed here for review:

- **The link only works on the phone that asked**: Decision 2.
- **Several spotters on one address**: Decision 3.
- **Only a fingerprint of the address is stored**: Decision 4. §9 describes storing the address itself.
- **The news box on the onboarding step is hidden until SYC-45 builds news**, because a box that sent nothing would break a promise. Everything else in §3.0 is word for word.
- **Adding the address needs a connection.** §4.3 says addresses typed offline are queued and checked later. For the keep-safe address, this slice asks people to add it in Settings once they're online instead. Queuing it offline can come with SYC-45's general queue.
- **Existing testers get the "first badge" offer on their first open of this version**, because they already have a badge and would otherwise never see it (§8.3's "when they first have something to lose").
- **Mail identity: follows §5.1** (both keep-safe messages transactional). §7.3's general rule that every address typed in the app is checked from `news.` reads the other way. §5.1 and §8 are the more specific and later text, so the plan follows them and changes nothing.

## How this fits the Neon move (SYC-121)

- **Build after the cutover, straight onto Neon.** The migration is applied with `db-ops` to Neon `development`, then `production`, before the publish that uses it. Nothing touches the old Replit database.
- **Testers must stay on `apptest.catspotters.com`.** A browser keeps a separate store per web address. The cutover keeps the address and moves it between projects, so testers keep their identity. That's why the WhatsApp message says to use only that address.
- **Restore links are always built from a fixed setting, `PUBLIC_APP_ORIGIN=https://apptest.catspotters.com`, and never from the request's `Host` header.** Otherwise someone could make the link point at a site of their choosing, or at a `replit.app` address with empty storage. A test pins it.
- **If the cutover is rolled back:** the carry-back copies the nine baseline tables, which include `device_credentials`, so anyone who has already restored keeps working. The four new tables aren't carried back, so opted-in testers would have to add their address again. This goes in the rollout notes and is an accepted risk.
- The cutover means entering a new tester password once. That doesn't touch the browser's storage.

## The website password gate

- **The restore page stays behind the tester password.** It has to run in the browser that asked, and that browser has already got past the password to reach onboarding. If its cookie has gone anyway (it lasts 28 days, and clearing browsing data removes it), the password page keeps the full address, `?t=` included, and returns the tester to it after the password (`serve-web.js:408`; a new test pins that `t` survives). The 15-minute link rarely outlives a cookie.
- **The restore API calls stay behind the API pass.** The website sends the cookie, and store builds send the tester key.
- **The confirm and forget pages and their POSTs sit outside both gates** (Decision 5): the API gate's allow-list gains `/api/mail/*`, next to `/api/team/*`. A parent confirming an address may not be a tester. These routes do one thing with a one-time token and show nothing else. A test proves every `/api/mail/*` route refuses without a valid token.
- Every page carrying a token sends `Referrer-Policy: no-referrer`, so the token never goes to the map tile server.

## Migrations

**One is unavoidable**: there is nowhere to keep a restore address or a one-time link today. It's additive only: four new tables and no change to existing ones.
- **Its place in the queue: after #24 (SYC-98) and #28 (SYC-43 part 1)**, and after anything else that merges first. It's generated with `pnpm --filter @workspace/db run generate --name keep_my_spots_safe` **on a rebase immediately before merge**. No test or document hard-codes its number; tests find it by the `_keep_my_spots_safe` suffix, as PR #28's do. It has a hand-written rollback block (drop the four tables, with a warning that opt-ins are lost).
- It reaches Neon only through the #13 runner, via `db-ops` (`-f target=development`, then `-f target=production -f command=migrate`), migrate before publish, as in `docs/runbooks/neon-database.md`. SYC-121's session owns `db-ops`. This work adds no command to it.

## Tests

Following the repository's pattern: route tests with vitest and the `lib/db` throwaway database. Every **(M)** test is also a **mutation check**: break the guard on purpose, see the named test go red, then restore it.

**Takeover attempts, the ones that matter most:**
1. **A guessed username restores nothing.** No restore route accepts a username. Sending one is ignored. A confirmed address for spotter A can't be used to move spotter B, even if B's username is typed into the picker **(M: let `redeem` accept any device id → red)**.
2. **A replayed link.** A used link is refused after 60 seconds. Within 60 seconds, a second POST from the same phone returns the same result and moves nothing twice **(M: drop `used_at IS NULL` from the write → red)**. Two simultaneous redeems: exactly one wins.
3. **The link on a second device.** A link used from a phone other than the one that asked gets `link_not_valid` and moves nothing **(M: skip the asking-phone check → red)**.
4. **The old phone carrying on.** After a move, **every** route that acts as a spotter, listed from `routes/*.ts` at build time (profiles ×4, notifications ×4, push token, sightings ×2, cats register/claim/rename), returns `403 device_moved` for the old secret **(M: return the generic 403 → red; M: skip SYC-107 on one cats route → red)**. The restored id's push token is gone, and a notification fan-out afterwards doesn't reach the old token.
5. **No gap for "first use" binding.** A request from the old phone racing the move can never bind itself **(M: turn the `UPDATE` into delete + insert → red, using a test hook between the two statements)**.
6. **Unconfirmed and forgotten addresses restore nothing.** `pending` → no email, and redeem refused. A suppressed address gets no email of any kind.
7. **Opening a link changes nothing.** A GET on `/restore?t=`, `/api/mail/confirm?t=` and `/api/mail/forget?t=` leaves the database unchanged, and the POST afterwards still works **(M: consume on GET → red)**.
8. **The form reveals nothing.** A known, an unknown, a pending and a suppressed address all get byte-identical replies, and response times overlap (the deadline pad) **(M: send inside the request → red on timing)**.
9. **Expiry.** A link is refused at 15 minutes and 1 second. A confirm token is refused after 7 days.
10. **Limits.** Each limit is enforced, and the per-address and global limits hold **across two server processes** (because they're counted in Postgres). The global ceiling fails closed and logs.
11. **The target must be empty.** Redeem refuses a calling phone that already has a username.
12. **Links point at the right place.** A request with `Host: evil.example` still emails an `apptest.catspotters.com` link **(M: build from `req.host` → red)**.

**Everything else:**
13. Tokens and addresses never appear in a log line (API and website), and the only form ever returned is masked.
14. The send function refuses a purpose outside the list, checked with `@ts-expect-error` and at run time. The "is this you?" email carries nothing the sender chose.
15. The gates: `/api/mail/*` is reachable without a pass and refuses without a token. `/api/restore/*` still needs the pass. The password page returns you to `/restore?t=…` intact.
16. Deletion removes the restore address, its tokens and the identifying parts of its consent events (joint with SYC-63).
17. The app: the onboarding step's two buttons are equal in size and Skip goes straight in. The one-time offer shows once. `device_moved` shows the screen and pauses the queue, and unsent sightings survive "Start again". The `/restore` page removes `t` from the address bar.
18. Checked in a real browser at 390 px and desktop, the whole round trip on a local build with a fake mail endpoint: opt in → confirm → clear storage → restore → the old tab shows "moved".

## Rollout (after approval and review of the build PR)

1. Probe Resend through its API: `mail.catspotters.com` is verified (SYC-25). Nothing on `news.` is needed for this work.
2. Create the app's own send-only key on `mail.` (separate from the Worker's, team-access §2.10) and the fingerprint key. **Samuel pastes them into Replit's deployment secrets** from a terminal tab opened for him, so the values are never printed. They're never in a file, ticket or chat (team-access §2.11).
3. `db-ops` migrate: `development`, then `production`.
4. Publish. Probes: request a restore for an unknown address (`202`, no send in Resend's log), and run the full round trip with Samuel's own address on his phone.
5. WhatsApp message to testers (appendix). File the (b′) list if Decision 1 picked it.

## Model delegation

The session model is Opus 5.5.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Slice 0.1 (SYC-107: three routes check the secret) | Sonnet | Small, follows `verifyDeviceSecret` exactly | Existing route tests plus new 403 tests; mutation check on one route; session-model review of the diff |
| Slice 0.2–0.3 (strong secret; log redaction) | Haiku | Mechanical, a few lines each | Unit tests; a log-line test that fails if the token appears |
| Slice 1.1 (schema, generate, rollback block) | Sonnet | An exact column list and the #28 precedent | `migrate:check` in CI; session model reads the generated SQL line by line |
| Slice 1.2 (send function) | Sonnet | Clear shape, no crypto | Tests 13–14; typecheck with `@ts-expect-error` |
| Slice 1.3–1.7 (tokens, redeem, the move, `device_moved`, limits) | **Opus** | *Escalated:* this is the takeover surface. A plausible-looking mistake (a delete-then-insert gap, a missing asking-phone check, consuming on GET) is a silent security hole that a green suite won't reveal | Tests 1–12, **every mutation check above**, and the adversarial review below |
| Slice 1.8 (app screens and flows) | Sonnet | Standard React Native work to exact copy | Component tests; browser check at 390 px and desktop by the session model |
| Slice 2 (secure storage, deep link) | Sonnet | Documented Expo APIs | A real TestFlight and Play build, run by Samuel with a script Claude writes |
| Adversarial review of the built change | **Opus**, in its own worktree | *Escalated:* it has to find the takeover paths the builder didn't think of | The session model checks every finding before it's fixed or dismissed |
| Rollout (keys, migrate, probes) | Session model | Handles secrets and production data, so it isn't delegated | The probes in rollout step 4 |

## Crash-proofing for the build

Its own worktree from fresh `origin/main`, one commit per numbered item, and a `CHECKPOINT.md` note after each (the file is git-ignored, so the commits are the durable record).

## Adversarial review of this plan

Reviewed by a Sonnet critic in its own worktree against the specs, `DECISIONS.md` Part 2d, the code on `main` and PR #28's branch. It found no new takeover path. Every finding was checked by the session model:

| # | Severity | Finding | What changed |
|---|---|---|---|
| 1 | Blocker | The draft called the choice of mail identity a spec contradiction and recommended the news identity for the "is this you?" email. `email-capture.md` §5.1 lists **both** keep-safe messages as transactional, and §8 was written with the SYC-3 decision, so the draft would have quietly changed an approved design. | The decision was removed. Both keep-safe messages send from `mail.`, as the spec says. The rollout no longer needs `news.` at all. |
| 2 | Minor | Slice 0.3 said the API's log cleaner needed changing. It already drops every query string (`app.ts`), and `serve-web.js` logs no requests. | Slice 0.3 now only adds a test that pins this, and says why a token in Replit's own logs is harmless: it only works on the phone that asked. |
| 3 | Minor | The "same answer within 60 seconds" retry on redeem wasn't spelled out. The conditional write returns nothing on a retry. | Slice 1.6 now says exactly how the retry is recognised and answered. |
| 4 | Minor | Whether a Home Screen icon on iPhone shares Safari's storage may depend on the iOS version. | Decision 1 now says to check on the iOS versions testers use. |

Checked and confirmed by the reviewer: the three cats routes that trust a device id (SYC-107) and every other route's secret check; the single-`UPDATE` move and the "first use" gap it avoids; the `device_moved` signal; unsent sightings following the live device id; the gates' current exemptions and `safeNext` keeping `?t=`; PR #28's contents; `device_credentials` being carried back in a Neon rollback; the rate limits matching team-access §2.6; and the plain-English terms.

## Appendix — copy (English; Greek and French from native speakers)

**Onboarding / Settings / one-time offer:** `email-capture.md` §3.0, word for word, minus the news box until SYC-45.

**"Keep my spots safe: is this you?"** (transactional identity, fixed text, nothing the sender chose):
> **Subject:** Is this you? — Cat Spotters
> Someone using the Cat Spotters app asked to use this address to keep their spots safe. If they lose their phone, this inbox is how they get their spots back.
> **[ Yes, that was me ]**
> If it wasn't you, you don't need to do anything. We won't use this address, and we'll forget it in seven days. To forget it now: **[ Forget this address ]**.
> Cat Spotters is made for Syros Cats, a cat charity on Syros. [What we do with your email](https://catspotters.com/privacy) · hello@catspotters.com

**"Your restore link"** (transactional identity):
> **Subject:** Get your spots back — Cat Spotters
> Someone asked to move a Cat Spotters collection kept safe by this address to a new phone.
> **Open this on the phone that's getting the spots back**, then press the button. The link works once and lasts 15 minutes.
> **[ Get my spots back ]**
> If you didn't ask, ignore this. Nothing moves unless the button is pressed on the phone that asked. Please don't forward this email.

**The old phone:** *Your spots moved to a new phone.* This phone isn't signed in as {username} any more. [ Start again as a new spotter ]

**WhatsApp to testers when Slice 1 ships:**
> New in Cat Spotters 🐈: **Keep my spots safe.** Add an email and you can get your spots, points and badges back if your browser forgets you or you change phone. Open the app and you'll see it once, or find it in Settings. Use an email only you can read (children: use a parent's). You'll get one "Is this you?" email: tap the button in it. Please keep using **apptest.catspotters.com** only. If you've already lost your spots, message me your old username.
