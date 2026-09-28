# SYC-25 implementation plan: fix staff sign-in, then turn on its email

**For approval by Samuel.** Spec: `docs/specs/team-access-and-welfare-queue.md` §2.1, §2.5, §2.6, §2.10, §2.11, §8.1, §8.3, §8.6. It was approved on 28 Sep 2026 (`DECISIONS.md` Part 2b).
**Code lives in** `fairshake-au/catspotters-website`, in `admin/src/index.js` (the `catspotters-admin` Worker at `admin.catspotters.com`). This repo only holds the plan.

## In plain English

At the moment nobody can get a sign-in email, because the Worker has no mail key. We can't just add the key, because two bugs would go live with it:

1. **Email security scanners would use up every link.** Work mailboxes (Microsoft, Proofpoint and others) open every link in an email to check it's safe. Our link signs you in the moment it's opened, so the scanner uses it up before the person clicks, and every link they get is already dead.
2. **The sign-in form gives away who has access.** It answers slightly slower for addresses on the list, so anyone who asks enough times can work out who is on it. Nothing limits how many times they can ask. Each request also sends an email, and later that same email allowance carries injured-cat reports.

So the order is: **fix the Worker → review it → deploy it → only then add the mail key.** Samuel does one five-minute step in Resend. Everything else is done by Claude and checked with live tests.

**What changes for a Syros Cats person:** after tapping the link in her email, she sees one button, "Yes, sign me in". Tapping it signs her in. If she taps twice, or goes back and taps again within a minute, it still works. If she asks for a second link, the first one keeps working.

## Scope

**In scope:** the fixes in spec §2.5 and the sign-in rate limits in §2.6, both inside the Worker; the sender address `signin@mail.catspotters.com` (D2); setting up the `mail.catspotters.com` sending domain in Resend; storing the sign-in mail key; a short "what to do when mail is down" runbook for sign-in; and checking all of it live.

**Out of scope. Each item gets a Linear ticket once this plan is approved (checked against existing tickets first):**

| Deferred item | Where it goes |
|---|---|
| The Worker asks the app's `people` list instead of the D1 `admins` table (§2.7), and `admins` shrinks to the one break-glass row | New ticket. It depends on the `people` table in the app's database, which doesn't exist yet |
| The hand-off token to the dashboard, and the session on `team.catspotters.com` (§2.4, §8.2) | SYC-43 (dashboard). Add a comment there if it isn't already covered |
| A separate `SIGNING_KEY` for the workspace and the public site (§2.7, §9.2) | New ticket |
| A dashboard banner when sign-in limits are crossed or sending fails | SYC-43. For now this is a log line only |
| The app's mail: one send function, a priority budget, Resend webhooks, a suppression list, and the app's own key on `mail.` | SYC-42 / SYC-45 |
| Retiring the shared document password on switch-over day (D7) | New ticket, done with SYC-29. Only Samuel is on the list today, so there's nobody to switch over yet |

## Three decisions in this plan, each with a recommendation

**1. How the sign-in limits are counted.** Spec §2.6 sets limits per 15 minutes and per hour, and says to count them with Cloudflare's rate-limit feature. That feature only counts over 10-second or 60-second windows, so it can't enforce the spec's limits.
- **A. Recommended: count them in the D1 database the Worker already uses**, in a small table. The table stores a scrambled code for each email address and IP, never the address itself, and rows are deleted after an hour. **Benefit:** the limits hold exactly as the spec states them, everywhere in the world, and survive redeploys. **Risk:** each sign-in request makes two more small database calls. Those calls fall inside the fixed reply delay, so users don't notice and nothing leaks.
- B. Use Cloudflare's feature with 60-second windows that roughly match. **Benefit:** no new table. **Risk:** the limits we'd enforce are not the limits written in the spec. The spec specifically warns against a written limit you don't actually enforce.
- A and B combined: A, plus Cloudflare's feature as a cheap first check against rapid bursts (10 requests a minute per IP). Worth adding because it costs one line of config.

**2. Set up the `news.` sending domain at the same time?** Recommended: **yes, the DNS only; create no key for it.** The slow part is waiting for DNS to be confirmed. Doing both domains in one sitting saves Samuel a second trip for SYC-45. **Risk:** none, because a domain with no key can't send anything.

**3. What people see if the mail key is missing.** Recommended: the sign-in page tells *everyone* "Email sign-in isn't switched on yet". That depends on how the Worker is set up, not on the address typed, so it gives nothing away. If one particular send fails, the person still sees the normal "if that address is on the list…" message, and the failure is written loudly to the Worker's logs. Telling that one person it failed would reveal that their address is on the list.

## Build

Work happens in a new worktree of `catspotters-website`, branched from fresh `origin/main` as `claude/syc-25-signin-mail`. Each task below gets its own commit, and checkpoint notes go in `NOTES-syc-25.md` in that worktree.

### Task 0: Environment and check first
- **Check D1 access.** A remote query today returned `7403 not authorized`, even though wrangler's OAuth token lists `d1 (write)`. Diagnose it before building: retry, refresh the token, then check the account ID. If it needs a fresh `wrangler login`, that's one command for Samuel, given as a single paste-safe block.
- Add `vitest` and `@cloudflare/vitest-pool-workers` to `admin/`. The tests run against a local copy of D1 built from `site/schema.sql`. Resend is replaced by a fake endpoint whose reply delay the tests can control.

### Task 1: Schema (additive only)
Add these to `site/schema.sql`, which is the one schema file both Workers use:
- `signin_attempts(kind TEXT, key_hash TEXT, at INTEGER)` with an index on `(kind, key_hash, at)`. `kind` is `addr`, `ip` or `redeem`. `key_hash` is an HMAC of the address or IP, keyed with `SIGNING_KEY`, so no raw addresses are stored.
- An index on `signin_tokens(email, expires_at)`.

Nothing changes in the existing columns. The 60-second re-use window is worked out from `used_at`, which already exists.

### Task 2: Requesting a link, with fixed-time replies (§2.5 bug 1, §8.1)
`requestLink` is restructured as follows:
1. Record `t0`.
2. Parse and normalise the request.
3. **Both branches** (on the list or not): record the attempt, check the limits, and look the address up in the allow-list, using as few D1 calls as possible (`DB.batch`).
4. If the address is listed and under its limits, `ctx.waitUntil(mintAndSend(...))`. Creating the token, tidying old tokens, capping outstanding links and sending the email all happen **after the reply has gone**.
5. `await sleep(max(0, t0 + 800 - Date.now()))`. If the work before this point ran past 800 ms, log `signin_deadline_overrun`.
6. Always return the same body and status.

The misleading comment in the code is corrected. The allow-list stays the D1 `admins` table until the §2.7 ticket.

### Task 3: Rate limits (§2.6)
- `POST /api/signin`: **3 per 15 minutes per address**, and **20 per hour per IP**. A request over either limit gets the identical reply, sends nothing, and still waits out the same delay.
- `POST /auth`: **30 per hour per IP**. Over the limit gets `429`.
- A Cloudflare rate-limit binding `SIGNIN_RL` in `admin/wrangler.jsonc` limits each IP to 10 requests a minute, as a first check. It copies the `throttled()` pattern from `site/`.
- Each time a limit is crossed, the Worker logs `signin_limit_crossed` with the kind and the hashed key.

### Task 4: Link redemption (§2.5 bug 2, §8.1)
- `GET /auth?t=` **uses nothing up.** It shows a small page with the headers `Referrer-Policy: no-referrer` and `no-store`. The page holds a form with a hidden token field and a single button, "Yes, sign me in", which sends a POST.
- `POST /auth` checks the request comes from the same site (`sameOrigin`). This closes the gap that let another site sign someone in without their knowledge (login CSRF). It then marks the token as used with the conditional write the code already has.
- If the token was already used **in the last 60 seconds**, the person is signed in again under the same address. After that, they get the existing "used or expired" page, with a way to request a fresh link.

### Task 5: Up to three links at once
Inside `mintAndSend`: if an address already has three unused, unexpired links, the oldest one is expired before the new one is added.

### Task 6: The email itself
- Sender: `MAIL_FROM` defaults to `Cat Spotters <signin@mail.catspotters.com>`.
- The message wording stays as it is ("works once, lasts fifteen minutes"). It matches §2.1, and "once" is still true apart from the one-minute grace.
- Failure logs record the Resend status and the hashed address, **never the address itself**. Decision 3 applies when the key isn't set at all.

### Task 7: Docs
- The `catspotters-website` README gets the secrets, the limits, and the break-glass rule for `admins`.
- `docs/DEPLOYMENT.md` in this repo gets half a page headed **"Sign-in mail is down"**. It covers: existing sessions last 30 days; how to check Resend's status and delivery logs; the break-glass row; and the Postmark swap, which is one function to change. Written in plain English.

## Tests (spec §8.6 items 1–5, plus the extras above)

| # | Test |
|---|---|
| 1 | An address not on the list gets a **byte-identical** reply to one on the list. Over 30 runs each, with the fake Resend taking 0–500 ms, the two sets of reply times overlap and their medians are within 50 ms |
| 2 | The allow-list is checked before any token is created. If the allow-list lookup throws, no token is created and the reply is still the standard one |
| 3 | A `GET /auth?t=` leaves the token unused, and a POST afterwards signs in |
| 4 | Posting the same token again within 60 s signs in again. At 61 s it's refused |
| 5 | Each limit is enforced, including across two separate Worker instances sharing one D1. The 4th request from an address within 15 min sends nothing, and the reply is unchanged |
| 6 | A `POST /auth` from another site, or with no `Origin` header, is refused and uses nothing up |
| 7 | A fourth link expires the oldest; the other two still work |
| 8 | If Resend returns 500, an error is logged, the reply is unchanged, and the address doesn't appear in any log |

**Mutation checks.** Each of these guards could fail silently, with the tests still green, so for each one: break the code on purpose, confirm the named test fails, then restore it.
- Move the sleep back after the send → test 1 must fail.
- Consume the token on GET → test 3 must fail.
- Drop the per-address count → test 5 must fail.
- Remove the `sameOrigin` check on POST → test 6 must fail.
- Widen the grace window to 600 s → test 4 must fail.

**Everything that touches the rules** (checked because each could quietly break them):
- **Every code path that returns from `requestLink`** (405, 403, 400, ok). The early error returns don't depend on the address, so they give nothing away. Only the `ok` path needs the fixed delay.
- **Every reader and writer of `signin_tokens`.** Only `requestLink`, `mintAndSend` and `/auth` touch the table, and the public site worker never does.
- **The sign-in page's JavaScript**, which reads only `res.ok`.

## Ship

1. **Adversarial review**, run by a critic sub-agent in its **own** worktree. It gets the spec sections, the diff, and the job of proving timing leaks, lockouts or bypasses exist. Every finding gets fixed.
2. PR to `catspotters-website`, CI green, merge.
3. Apply the additive schema to the live D1 (`wrangler d1 execute --remote --file`), then `wrangler deploy`. Both are done by Claude.
4. **Check the live site** before the mail key exists:
   - A `GET /auth?t=<real token>` from curl (standing in for a mail scanner) leaves the token unused. To get a real token, request a link for Samuel's address and read the token from D1. With no mail key, nothing is emailed.
   - A POST then signs in and sets `__Host-cs_admin`, and a second POST within 60 s also works.
   - An unknown address and a listed one give identical replies at the same delay (10 samples each, staying under the limits).
   - The 4th request for one address within 15 minutes sends nothing.

## Samuel's step (about five minutes, after step 4 passes)

1. In Resend: **add the domain `mail.catspotters.com`** (and `news.catspotters.com` under decision 2), and choose **Cloudflare auto-configure**. Claude's Cloudflare token can't write DNS.
2. In Resend: **create an API key** with *Sending access* only, limited to the `mail.catspotters.com` domain, named `catspotters-admin-signin`.
3. Claude opens a terminal tab running `wrangler secret put RESEND_API_KEY` for `catspotters-admin`, and Samuel pastes the key into it. **The key never goes into chat, a ticket, or a file** (§2.11).

## Turning mail on, and confirming it works (Claude)

- Use `dig` to confirm Resend's DKIM, SPF and MX records are live for `mail.`. If there's no `_dmarc.catspotters.com` record, add `v=DMARC1; p=none` (Samuel clicks, since it needs DNS access).
- Request a link for Samuel's real address. **Samuel confirms it arrived in his inbox and not in spam**, taps it, taps the button, and is signed in. The Resend log shows the email as `delivered`.
- Check the scanner fix on live mail: fetch the emailed link with curl first, then Samuel taps it, and it still works.
- Linear: mark SYC-25 **Done** with the PR link, file the tickets in "Out of scope", and add a note to SYC-29 that sign-in now works for new people.

## Model delegation

The session model is Opus 5.5.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Task 0 test setup and Task 1 schema | Sonnet | Standard setup from a clear spec | The test suite runs and passes locally; the session model reviews the diff |
| Tasks 2–6, the Worker changes, test-first against the table above | Sonnet | The plan spells out the exact behaviour and tests, so this is standard implementation | Tests 1–8, **the five mutation checks**, the Opus adversarial review, and the live checks after deploy |
| Task 7 docs | Sonnet | Plain-English prose to fixed content | The session model spot-reads it against the rules in CLAUDE.md |
| Adversarial review | **Opus**, own worktree | *Escalated:* timing leaks and link-lockout races are subtle security failures that stay green in tests. This is where a stronger reviewer pays for itself | The session model checks each finding before it's fixed or dismissed |
| Task 0 D1 check, deploy, live checks, terminal secret, Linear updates | Session model (Opus) | Uses credentials and makes judgment calls on live systems; too small to hand off | The live checks listed above |

Every agent prompt includes, word for word: **"Commit after each task. Write a checkpoint note (done / next) to NOTES-syc-25.md in your worktree before moving on."**
