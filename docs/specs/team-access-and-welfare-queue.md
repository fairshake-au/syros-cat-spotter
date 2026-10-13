# Team access and the welfare queue

**Feature spec · Cat Spotters (Syros)**
**Version:** 2.0 · 3 September 2026 · supersedes v1.0 of the same date
**Covers:** PRODUCT-SPEC §2.5 (cat in trouble), §2.6 (team access), and the sign-in that makes both usable.
**Linear:** SYC-42 (report flow, urgent) · SYC-43 (staff dashboard) · SYC-44 (report an issue) · SYC-25 (mail transport, urgent) · SYC-26 (Google sign-in) · SYC-29 (adding people) · SYC-30 (admin@syroscats.com as a recipient).
**Status:** **Approved by Samuel, 28 September 2026**, with his review edits incorporated. Rewritten against `docs/specs/DECISIONS.md`, which wins over this document wherever they differ.

### What this document owns, and what it borrows

Four specs were written on the same day and contradicted each other in fourteen places. Each area now has exactly one owner. **This document owns** sign-in and the trust boundary between the two systems, roles and capabilities, the staff dashboard, the welfare queue, the "this cat needs help" flow, and **all capacity and safety copy**.

It borrows, and does not restate:

| What | Owner |
|---|---|
| The cat record, observations, how status is derived, presumed-deceased | `cat-record-data-spine.md` |
| Location blurring, feeding-site privacy and precision, the `feeding_sites` table | `cat-record-data-spine.md` |
| The deletion mechanism itself (F3) | `cat-record-data-spine.md` |
| Email consent copy, verification, the four email moments, the nightly notify job | `email-capture.md` |
| Privacy policy text | `privacy-policy.md` |
| The controller, the withdrawal route | `email-capture.md` |
| Hosting, photo storage, the photo endpoint, migrations | `hosting-and-photo-storage.md` |

**Struck from v1.0:** this spec previously invented its own cat-record model — editable status columns plus a `record_changes` audit log — which is precisely the design the data spine rejects by name. It is gone. A team correction is an observation, written by the resolver's own rules. This spec also defined `feeding_sites` a second, different way; that definition is gone too.

---

## 1. The short version

Today a tourist can meet a hundred cats on Syros and photograph every one of them. If one of those cats is bleeding, starving, or has just had kittens under a taverna chair, the app has nothing to say and Syros Cats never hears about it. Meanwhile the charity — the people who actually know what to do — have no window into the data being collected about their own island.

Three connected pieces close both gaps:

1. **One staff sign-in.** A Syros Cats person types their email address, gets a link, clicks it, and they are in. No password to remember, no password to leak, no password to change when somebody leaves.
2. **A staff dashboard**, sitting next to the cat data it is about. One page that answers "what needs us today?" — the welfare queue, the feeding-site map, the ability to fix a wrong record, and colony names that match the names people already use out loud.
3. **A report flow for the public.** "This cat needs help" and "there's something wrong with this photo", both reaching a shared Syros Cats mailbox *and* an in-app queue, with the reporter told honestly what happens next.

### The thing that matters most, and it is not code

Syros Cats are a few people with finite money and finite space. Their goal is *fewer cats in their own care and more care happening in the community.* A report button that quietly promises "we'll come and get it" would make their lives worse, not better.

So we have made a deliberate, uncomfortable decision, recorded in DECISIONS.md as F1:

> **Nothing in this system pages a human. There is no urgent alarm, by design.**

An urgent report goes into the queue and into the shared inbox, and then it waits until somebody chooses to look. No phone buzzes. No rota is woken. A report about a genuinely dying cat can sit unseen for two days, and on a Sunday in February it probably will.

We did not build an alarm because an alarm is a promise, and nobody has agreed to be on the end of it. Building one would make the app dishonest in a new way rather than making it safer. What makes this survivable is the copy: **the app has to send urgent cases to a vet first, and be unmistakable about it.** Section 5 is that copy. If you read one section, read that one — it is load-bearing, not decorative.

### The two audiences want the same thing from different angles

A worried tourist wants to know that the cat they found will be alright, and that telling someone was worth doing. A cat guardian who has fed the same alley for nine years wants the record to be correct and the charity to know what she already knows. These needs are **complementary**: the tourist supplies attention and a photograph at the moment it matters; the guardian and the team supply the judgment about what it means. The welfare queue is where those two meet.

---

## 2. Staff sign-in and the trust boundary

### 2.1 What a Syros Cats person experiences

She opens `admin.catspotters.com` on her phone. One field: her email address. She types it and taps "Send me a link".

Whatever she typed, the screen says the same thing, after the same delay: *"If that address is on the list, a link is on its way. It works once and lasts fifteen minutes."* It says that even for an address that is not on the list — otherwise the page becomes a tool for finding out who at Syros Cats has access.

She opens her mail and taps the link. She lands on a small page with one button: **"Yes, sign me in."** She taps it and she is in — the workspace documents she already uses, and now a **"Cat Spotters dashboard"** link that takes her straight into the queue without typing anything again. The session lasts thirty days on that device. If she is on a borrowed computer she taps "Sign out" and it is gone.

If somebody leaves the charity, their address comes off the list and their next request bounces them to the sign-in page — in both systems, because there is only one list.

### 2.2 Why email links rather than passwords — and what it costs

A shared password is the worst of both worlds for a small team: everybody knows it, nobody can prove who used it, and removing one person means disrupting all of them. An email link inverts that. The mailbox is the credential, and the mailbox is already the thing Syros Cats protect. The list of who has access becomes a list of email addresses — something the charity can read, understand, and ask to change without a technical conversation.

Three honest costs, all of which this spec has to deal with rather than wave at:

- **Single-use, short-lived links are not free.** A link that dies on first use is a poor prize for anyone who finds it later. It is also a link a corporate mail scanner can destroy before its owner reaches it. §2.5 fixes that; it is not a theoretical worry.
- **A shared mailbox is not a person.** See §2.8.
- **Mail can fail.** If the transactional mail path is down, nobody can sign in. §2.10 covers what that looks like and what the way back in is.

### 2.3 Decision (recorded): the dashboard moves, the front door stays

**Decided in DECISIONS.md D3 and F5.** Recorded here with the reasoning, because implementers will ask why sign-in and dashboard live in different places.

| Option | What it means | Benefits | Risks |
|---|---|---|---|
| **A. Everything on the app backend.** Rebuild magic-link sign-in in Express, retire `admin.catspotters.com`. | One codebase, one platform. | Nothing to trust across a boundary; simplest mental model. | Throws away a working, reviewed sign-in flow and rebuilds it in a codebase with none of the primitives. The workspace documents Syros Cats already use would have to move too. Most work, no product gain. |
| **B. Everything on Cloudflare.** Dashboard in the Worker, calling the Express API for every screen. | Reuses the existing sign-in exactly. | Every screen is a network hop from its data. Permissions enforced twice. The API grows a staff-only surface guarded separately. Slower and more fragile for no gain. |
| **C. ✅ Sign-in stays on Cloudflare; the dashboard lives on the app's own backend, and the API trusts a token the Worker issues.** | `admin.catspotters.com` remains the front door and hands off to the dashboard. | The queue sits next to the cat data it acts on, in the same database, with no cross-network hop per screen. The working sign-in flow is kept and improved rather than rewritten. One list of people (§2.7), one deletion to remove somebody. | A trust boundary now exists between two systems, and a boundary specified vaguely is a security hole. That is the work §2.4 does, and it is the whole cost of this option. |
| **D. Two separate sign-ins, one per system.** | Simplest to build. | Directly contradicts the requirement. Two links in two inboxes for the same person is exactly the friction that stops a volunteer using a tool. |

**Recommendation: C**, as decided. The trust boundary is a known, bounded piece of engineering; rebuilding sign-in or accepting a per-screen network hop are both larger and worse.

### 2.4 The trust boundary — how the API knows who is knocking

This is the part that must not be hand-waved. Three ways to do it:

| Option | Benefits | Risks |
|---|---|---|
| **A. Shared HMAC secret.** The Worker signs a token with a secret the API also holds. | Simplest. No key distribution beyond two secret stores. Symmetric signing is one line either side. | **The API can mint sign-ins.** Anything that leaks an environment variable out of the Replit deployment — a log, a crash dump, a dependency — hands over the ability to become any staff member. Rotation means a coordinated change in two places. |
| **B. ✅ Asymmetric signature (Ed25519).** The Worker holds a private key and signs; the API holds only the matching **public** key, pinned in its configuration. | The API cannot forge a token even if every secret it holds is stolen — it can only check them. Rotation is publishing a new public key; the API can accept two during a changeover. Ed25519 is built into both runtimes (WebCrypto in the Worker, `node:crypto` in Express); no library. | One more concept than a shared secret. The public key has to be got into the API's config correctly — a wrong key means nobody can sign in, which is at least a loud, obvious failure rather than a silent one. |
| **C. Call-back verification.** The token is an opaque id; the API asks the Worker "is this valid, and who is it?" | No cryptography to get wrong. Instant revocation. | A network round trip on the sign-in hop, and a hard dependency in the wrong direction. Adds a second failure mode for no benefit over B. |

**Recommendation: B.** The asymmetric version costs perhaps twenty lines more than the shared secret and removes the single worst outcome — a leak on the busier, less locked-down side of the boundary being enough to impersonate staff.

**The token, precisely.** A compact JWS (JSON Web Signature), `alg: EdDSA`, with these claims:

```
iss  "https://admin.catspotters.com"        // who minted it
aud  "https://team.catspotters.com"         // who may accept it — the dashboard origin, §2.6
sub  "<person id>"                          // the stable id from the people table, not the address
eml  "susan@example.com"                    // lower-cased, for display and logging
sv   3                                      // session version, §2.9 — bumped to log somebody out
iat  <unix seconds>
exp  <iat + 60>                             // sixty seconds. This is a hand-off, not a session.
jti  "<16 random bytes, base64url>"         // single use, §2.4 replay
```

**It is a hand-off token, not a session token.** The Worker's "Cat Spotters dashboard" link carries it once; the API validates it, immediately spends the `jti`, and sets **its own** session cookie. The Cloudflare token never lives longer than a minute and never sits in a browser store. Revocation then belongs to the API, where the data is, rather than to a token nobody can recall.

**What the API does, in order, on every hand-off:**

1. Parse without trusting the header. **The algorithm is pinned in code to `EdDSA`;** the `alg` field in the token is never read to choose a verifier. (This is how "algorithm confusion" attacks work, and the defence is one line.)
2. Verify the signature against the pinned public key (or either of two, during a rotation).
3. Check `iss` and `aud` are exactly the expected strings. A token minted for something else is refused even if the signature is perfect.
4. Check `exp` and `iat` with **60 seconds** of clock-skew tolerance in each direction.
5. Check `jti` has not been seen. Spent ids are held for ten minutes, which is long past `exp`, and then dropped.
6. Look `sub` up in `people`. Not on the list any more → refused. `sv` lower than the row's current session version → refused.
7. Only now, issue the dashboard session.

**When any of that fails**, the API does the same thing every time: **HTTP 401, a fixed body (`{"error":"not_signed_in"}`), no detail about which check failed, and a redirect for browsers back to `admin.catspotters.com`.** The real reason is logged server-side with the `jti` and the request id so a support question has an answer. There is no partial trust and no fallback path: a token that fails any check buys nothing at all. Explicitly, the API never accepts an unsigned identity header, never trusts an `X-User-Email`, and has no "development bypass" that could ship.

### 2.5 The two confirmed bugs in the live flow, and the fixes

Both are in `admin/src/index.js` in the `fairshake-au/catspotters-website` repository, read on 3 September 2026. Both are confirmed by reading the code, not inferred.

**Bug 1 — the enumeration padding does not pad.** The code's comment says the reply comes "after the same delay" either way. It does not. For an address on the list, `requestLink()` does an INSERT, a DELETE and a **full outbound HTTPS round trip to `api.resend.com`** — and *then* sleeps a fixed 400 ms. For an address not on the list it does one SELECT and sleeps the same 400 ms. The difference is the Resend call: typically 100–500 ms, and variable. Averaged over a few dozen samples the endpoint is a reliable oracle for "does this person have access to Syros Cats' systems?" — the exact thing the design says it must not be. With no rate limit (§2.6) an attacker can take as many samples as they like.

> **Fix.** Two changes. (a) Take the send off the response path — `ctx.waitUntil(sendLink(...))`. (b) Pad to a **deadline**, not by a duration: record `t0` on entry, and before replying `await sleep(Math.max(0, t0 + 800 - Date.now()))`. Both branches then return at the same wall-clock offset from the request. Also correct the comment, which currently describes a mitigation that does not hold.

**Bug 2 — the mail-scanner defence closes the wrong half.** The conditional write (`UPDATE … WHERE used_at IS NULL … RETURNING email`) stops *two* sessions being issued. The real-world failure is different: the scanner is the **only** consumer. Microsoft Defender for Office, Proofpoint, Barracuda and Gmail's own link handling all issue a GET on links in mail, and `/auth` consumes the token on GET. The session cookie goes to the scanner, which throws it away, and the human clicks a link that is already spent and reads "That link has been used already." Every fresh link is burnt before she reaches it. She cannot diagnose it, and there is no support function to call.

> **Fix, in three parts.** (a) **Do not consume on GET.** `/auth?t=` renders a small page with one button that **POSTs** the token. Scanners do not POST. Keep the conditional write on the POST. (b) Allow the same token to be re-presented within **60 seconds** and return the same session, so a double-tap or a back button is not a lockout. (c) Allow up to **three** unexpired outstanding tokens per address, so asking for a second link does not invalidate the first one that is still in flight. The POST also carries the same-origin check the rest of the Worker uses, which closes the login-CSRF gap `/auth` has today.

**§2.2's framing changes with this.** Single-use is not an unqualified good; it is a trade against a real, common failure. We keep it, with the three softeners above, and we say so.

### 2.6 Rate limits, the dashboard's address, and where limits are actually counted

**The request-a-link endpoint has no rate limit today.** `admin/wrangler.jsonc` declares no rate-limit binding and `requestLink()` throttles nothing. The same-origin check stops a browser on another site; it stops nothing from `curl`, because `Origin` is a header the caller sets. Meanwhile the *public* site worker next door gets this right — `site/wrangler.jsonc` declares `UNLOCK_RL` (8/min) and `SUBSCRIBE_RL` (5/min) and `site/src/index.js` has a `throttled()` helper. The pattern exists in the same repository; the sign-in endpoint was simply left off it.

Left unfixed, this is not only an inbox-flooding nuisance: every request spends a transactional send, and transactional sends are what welfare mail runs on (§2.10).

**Limits, stated here rather than deferred to a general section:**

| Surface | Limit | On breach |
|---|---|---|
| `POST /api/signin`, per address | 3 per 15 minutes | Fail closed: reply with the same "if that address is on the list…" message, send nothing. |
| `POST /api/signin`, per IP | 20 per hour | Same. |
| Outstanding unused tokens per address | 3 | Oldest is expired to make room. |
| `POST /auth` (token redemption), per IP | 30 per hour | 429. |
| Welfare report submit, per IP | 10 per hour | 429; see §4.4 for why per-device is not the control here. |
| Verification/acknowledgement mail, per recipient address | 1 per 24 hours, 3 lifetime before suppression | The queue row is still written. Always. |

Crossing either sign-in threshold raises a dashboard banner and a log line the team can see.

**Where these are counted matters.** The Worker limits use Cloudflare's rate-limit bindings, exactly as `site/` already does. The API's limits currently use `express-rate-limit` with its default in-memory store (`artifacts/api-server/src/middlewares/rateLimit.ts`), which is per-process — Replit autoscale runs several processes, so every limit is silently multiplied by the instance count and reset on each deploy.

| Option | Benefits | Risks |
|---|---|---|
| **A. Leave it.** | Nothing to do. | The stated limits are fiction. A limit you have written down and do not enforce is worse than none, because you stop thinking about the surface. |
| **B. Pin the deployment to one instance until launch.** | Free, immediate, honest. | Caps throughput; easy to forget and silently undo with a settings change. |
| **C. ✅ A Postgres-backed store, plus B until it lands.** | Postgres is already there and already the source of truth; one small table, shared by every instance, surviving deploys. | A database write per limited request — trivial at this volume. |

**Recommendation: C, with B in place from day one** so the window between "we wrote the limits down" and "the limits are real" is not open.

**The dashboard's address is `team.catspotters.com`** — a second custom domain on the *same* Replit deployment that serves the API. This is a decision, not a detail, and v1.0's silence about it was a blocking unknown:

- The session cookie is `__Host-cs_team`, which is host-only by definition, so it is set and read on `team.catspotters.com` and is **never** sent to `api.catspotters.com` or anywhere else.
- Every dashboard request is same-origin, so the wildcard-CORS problem does not arise for the dashboard at all.
- `app.use(cors())` in `app.ts` is a wildcard origin and must still be replaced with an explicit allow-list. Wildcard CORS cannot be combined with credentialed requests, so leaving it is both too permissive and, the moment anything cross-origin needs a cookie, non-functional.

### 2.7 One list of people — resolving a claim that was false when it was written

v1.0 said "one identity, one allow-list, one table". That was already untrue: `site/schema.sql` defines an `admins` table in the D1 database `catspotters-signups`, and `admin/src/index.js` authenticates against it on **every** request. The app's data lives in Postgres on Replit. Two people tables, two databases, two platforms — and removing a departing volunteer means two deletions, which is exactly the thing nobody remembers to do twice.

| Option | Benefits | Risks |
|---|---|---|
| **A. `admins` in D1 stays canonical; Postgres holds a synced copy.** | No change to the Worker. | The sync is a background job that can lag or break silently. A removal that has not synced is still a working dashboard session. Worst of both. |
| **B. ✅ `people` in Postgres is canonical. The Worker asks the API.** `requestLink()` replaces its `SELECT … FROM admins` with a server-to-server call to `GET /internal/people/allowed`, authenticated with its own credential. `admins` is emptied and kept only as a documented break-glass row. | Genuinely one list, one deletion, one place the charity's list of people lives — next to the roles, scopes and attribution the dashboard needs anyway. Removal is immediate everywhere. | Sign-in now depends on the API being reachable. If it is down, nobody can sign in — so it must **fail closed with an honest message** ("Sign-in is temporarily unavailable — this is our fault, not yours"), never fail open. The allow-list check must not leak timing either: it sits inside the same padded deadline from §2.5. |
| **C. Keep both, maintained by hand.** | Nothing to build. | The status quo, and the failure this design exists to prevent. |

**Recommendation: B.** The break-glass exception is written down rather than pretended away: **exactly one** row may remain in `admins` — Samuel's address — so that a total API outage does not lock everyone out of the workspace documents, which are unrelated to the cat data. It grants the workspace, never the dashboard. It is reviewed at launch and again at each quarterly check.

**One more thing the boundary has to fix.** `admin/wrangler.jsonc` records that the workspace **shares its `SIGNING_KEY` with the public site worker**, so anything holding the public site's document-gate secret can mint a workspace session cookie. Extending that key to a third system would be spreading a known weakness. So: the dashboard hand-off uses its **own** Ed25519 key pair (§2.4), unrelated to `SIGNING_KEY`, and separating `SIGNING_KEY` between the two Workers is filed as its own piece of work.

### 2.8 Shared mailboxes, and why `admin@syroscats.com` is a recipient and never an account

The whole argument for email links over a shared password is that a password cannot tell you who used it. That argument collapses if the first row anyone adds is a shared mailbox — and it will be, because `admin@syroscats.com` is the address everybody knows, it is a Google Workspace mailbox several people read, and it is deliberately the destination for every welfare report. Add it to `people` and everyone with mailbox access becomes one identity, any of them can read the sign-in link, and "who made this correction?" answers with a mailbox.

**Rules, enforced in code and not just written down:**

- Shared and role addresses are **refused on insert**, with a deny-list on the local part (`admin@`, `info@`, `hello@`, `contact@`, `team@`, `office@`, `support@`) and a clear message explaining why.
- Every person gets their **own** address. If a volunteer has no work address, a personal one is correct — that is what the design assumes.
- `admin@syroscats.com` is a **recipient**. It receives welfare alerts. It never signs in.

### 2.9 Who is on the list, and what leaving looks like

`people` holds: person id, email (unique, lower-cased), name, session version, when they were added and by whom. Roles and scopes live in a separate table (§7). Adding a colleague (SYC-29) is one row.

Three operational truths the charity should be told plainly, because they change behaviour:

- **Removal takes effect at the next request**, in both systems, because both consult the same list. A browser somebody left signed in on the other side of the island stops working the next time it asks for anything.
- **A leaked cookie needs a way back.** Every session carries the person's `session_version`; bumping it signs that person out everywhere, immediately, without touching anybody else. v1.0's only remedy was rotating a shared signing key, which signs out the whole charity.
- **Shared passwords retire on the same day** staff sign-in goes live (DECISIONS D7). **No overlap period.** Running two credential models side by side means the password remains the real way in, nobody learns the new flow, and removing a person still requires changing a secret everyone shares. On switch-over day: the document gate password is changed to a value only the workspace shows, everyone signs in once by link, and the old password is retired. One credential model, not two.

### 2.10 Decision (recorded): how mail is actually sent

**Decided in DECISIONS.md D2.** Resend, **split into two sending identities on separate subdomains, with separate keys**.

| Option | Benefits | Risks |
|---|---|---|
| **A. ✅ Resend, two identities.** `mail.catspotters.com` for transactional mail, `news.catspotters.com` for cat news. Separate Resend domains, separate DKIM keys, separate API keys. | An HTTP call — no mail server, no ports — which suits both runtimes. Real delivery logs, which is the difference between "we think it went" and "we know it did"; that matters enormously when the failure mode is "Susan says she never got it". Sends to any recipient with no enrolment step, so welfare mail reaches `admin@syroscats.com` without anybody at Syros Cats clicking anything — SYC-30 comes off the critical path. **The split is the point**: a tourist marking a cat-news email as spam damages the reputation of `news.`, not the subdomain that carries sign-in links and welfare reports. | Two domains to verify with DNS rather than one. Two keys to hold. The dependency does not vanish, it moves — until the DNS records land, Resend restricts sending to the account owner's own address, so it is now Samuel's DNS rather than Syros Cats' inbox on the critical path. Better, but not nothing. |
| **B. Cloudflare Email Sending.** | No API key at all — a platform binding rather than a secret. | **Not available.** The mail that matters here is sent by an Express server on Replit; a Workers binding does not exist in that runtime. Removed as an option and removed as the fallback, where v1.0 wrongly named it. |
| **C. Google Workspace SMTP** (send as `admin@syroscats.com`). | The friendliest possible "from" line. No new supplier. | Needs an app password or a service-account grant held long-term. **An app password is a reusable key to the charity's entire mailbox** — a far worse thing to hold than a send-only API key. Google throttles and occasionally blocks programmatic sending, and when it does, sign-in stops for everyone. **Rejected.** (v1.0 rejected this for the wrong reason — it claimed the runtime has no SMTP client, and Node does. The conclusion was right; the argument was not.) |
| **D. Google sign-in instead of an emailed link** (SYC-26). | No email to deliver for sign-in, so a mail outage stops locking people out. One tap for a team already living in Google Workspace. | Does not remove the mail dependency — reports, verification and acknowledgements still have to be sent. Needs an OAuth client, a client id and a secret. Adds a second identity path: **Google proving who somebody is must never be the same thing as letting them in** — the allow-list check still happens after Google answers. |

**Recommendation: A now, D soon, Postmark named as the upgrade path.** Take Resend with the split. Add Google sign-in as a second door once the first works — it is a real convenience and it makes sign-in survive a mail outage. If transactional deliverability on a new domain proves weak, **Postmark** is the upgrade; it is a different provider behind the same one send function, not a rethink.

**Two identities, concretely:**

| Identity | Sends | From | Key held by |
|---|---|---|---|
| **Transactional** — `mail.catspotters.com` | Staff sign-in links **and staff sign-in verification**; report acknowledgements; report status updates; the welfare alert to `admin@syroscats.com`; issue reports | `Cat Spotters <signin@mail.catspotters.com>` / `Syros Cats via Cat Spotters <reports@mail.catspotters.com>`, **`Reply-To: admin@syroscats.com`** on anything a reporter might answer | The Worker (Cloudflare secret) for sign-in; the API (Replit deployment secret) for everything else — two keys on the same domain, so either can be rotated without touching the other |
| **News** — `news.catspotters.com` | "The cat you named was sterilised" and other loop-closing mail, **plus every verification message sent to a member of the public — including the address typed on a welfare report** (all owned by `email-capture.md`) | `Cat Spotters <news@news.catspotters.com>` | The API, a third key |

**Which identity verifies an address is decided by *who is verifying*, not by which screen they were on.** Staff sign-in verification is transactional; any address a member of the public types anywhere — spot card, visit summary, welfare report, Settings — verifies from the news identity. That is the amendment to D2 recorded in `DECISIONS.md` and specified in `email-capture.md` §7.3; this spec follows it and does not restate the reasoning.

**Be precise about what the split does and does not buy.** It buys separate sending reputation, separate DKIM keys, separate revocation and separate delivery logs. It does **not** by itself buy a separate volume allowance — Resend's send caps are account-level, so a flood on one identity can still eat the account's headroom. Two things close that gap, and both are ours to build:

1. **The rate limits in §2.6**, which are what actually stop a login form or a report form generating mail without bound.
2. **A priority budget inside the one send function.** Every send declares a purpose. When the daily budget is being approached, the function sheds load in a fixed order: news first, then public verification, then acknowledgements. **Sign-in links, staff sign-in verification and welfare alerts are never shed.** Note the consequence of the D2 amendment: public verification now sits inside the *news* identity's allowance, so shedding news load can delay the message a member of the public is waiting on — accepted in `email-capture.md` §7.3. If it ever has to shed, it raises a dashboard banner saying so.

Re-check Resend's current published limits before committing — they change — and budget for the paid tier rather than assuming a free allowance covers a launch.

**The single-provider failure has to be built, not just named.** A send-failure rate above a threshold raises a dashboard banner; a written half-page cutover procedure lives in `docs/DEPLOYMENT.md`, so the answer to "Resend is down on a Sunday" is a runbook and not "wait for Samuel". Resend's `delivered`, `bounced` and `complained` webhooks are ingested; bounces and complaints go onto a suppression list, and the suppression list also suppresses *verification* sends, not just later ones.

### 2.11 Handling the keys — non-negotiable

Every one of these credentials — the Resend keys, the Ed25519 private key, the Worker's server-to-server credential for the allow-list check, and Google's client secret if D lands — can be used to impersonate the charity or its staff. Each is held in the platform's own secret store: **Replit deployment secrets** for the API, `wrangler secret put` for the Worker. Never:

- written into a configuration file that is committed to a repository,
- pasted into a scheduled routine, an automation, or an agent prompt,
- included in a runbook, a Linear ticket, or a chat message.

If a scheduled or automated job ever needs to send mail, it reads the secret from the platform at run time. **A key sitting in cleartext inside a routine turns one convenience into a permanent exposure that no rotation schedule undoes** — the routine is the leak, and it keeps leaking. Scope each key to the narrowest thing it needs to do, and treat rotation as a five-minute job so that rotating it is never the reason not to.

---

## 3. The staff dashboard

One page, mobile-first, because a Syros Cats volunteer is far more likely to open this standing in a street than sitting at a desk. Served from `team.catspotters.com` (§2.6).

### 3.1 What needs us today — the welfare queue

The landing view. A list, ordered urgent-first and then newest-first.

- **Urgent** at the top, marked unmistakably. **Severity changes the order of this list and nothing else** — it does not make anybody arrive sooner, because nobody is dispatched. Anything in the interface that implies otherwise is a bug (§5).
- **Needs attention** below.
- Each row: the photo, where it was found (**exact** location — this is the team view), how long ago, what the reporter said, whether the report is tagged as a litter, and **whether the reporter left a way to be contacted**.
- **The reporter's email address is not shown.** Agreed with `email-capture.md`: the address stays inside the app's own system, the queue shows a yes/no, and replies are sent from the dashboard using fixed copy (§5.3). The alert email to the shared mailbox does not carry it either (§4.3) — hiding it from one screen while emailing it to a mailbox several people read would achieve nothing.
- Four states: **New · Looking at it · Done · Nothing needed**. One tap to change. Moving a report to a **closing** state (*Done* or *Nothing needed*) is what sends the reporter their one update; *Looking at it* is for the team's own use and sends nothing (§5.3h).
- A free-text **team note** on each report, visible to the team only — "Maria went, cat had already moved on."
- If the report can be tied to a cat already in the catalogue, the row links to that cat's record — and that link is what writes the `welfare_report` observation onto the cat (§8.4), so the cat's own history carries it.
- A **delivery state** per report: whether the reporter's mail was accepted, delivered, bounced or suppressed, so "did they get it?" has an answer.

The queue is deliberately not a ticketing system. Four states, one note, no assignment, no due dates. A charity of this size will use a simple thing and abandon a complicated one.

**One thing the queue must never grow: an "escalate" or "page someone" button.** There is nobody to page (F1). A button that looks like one would restore the promise the design deliberately does not make.

### 3.2 The feeding-site map

Every feeding site on the island, on a map, **visible only to Syros Cats by default**. Each site has one switch: *private* (the default) or *public*, flipped one site at a time, with who flipped it and when recorded — not to police anybody, but so "how did this become public?" always has an answer. There is no bulk action.

This is a safety feature, not a preference: a public list of where cats reliably gather is a public list of where to find cats.

**The record itself is `cat-record-data-spine.md` §10.5** — that spec owns the `feeding_sites` table, the privacy model and, importantly, **the precision at which a public site is shown** (its §6.7 recommends that a site made public shows its exact position, on the grounds that a 300 m circle around a food bowl serves nobody). This spec does not restate any of it and does not define the table a second time, as v1.0 did.

**Cross-spec note, now resolved:** v1.0 introduced its own `colonies` table. The data spine has since defined one — `cat-record-data-spine.md` §10.5, with the name, the guardian's name, a team-only centre and a `colony` observation that puts a cat in it. **That is the definition; this spec uses it and does not carry a second one.** It is what `person_scopes.colony_id` (§7.3) points at.

**Dependency:** the list of sites that may be public comes from Syros Cats. It is requested early and **never blocks** — every site stays private until they say otherwise, which is the correct default anyway. The list is configuration, not code.

### 3.3 Fixing what is wrong

Small corrections, done in seconds, by people who actually know:

- **Hide a photo** — one tap, reversible, no confirmation theatre. A bad photo comes down first and gets discussed afterwards.
- **Rename a cat** — the AI-suggested or tourist-supplied name is sometimes simply wrong, and the charity's name for a cat is the real one.
- **Say what a cat's life status is** — street, homed, in care, deceased — with a short reason. This adds the team's statement to the cat's record; it does not overwrite anybody else's, and the earlier statement stays visible underneath.
- **Say whether a cat has been sterilised.** A team entry is *Confirmed*; a **clipped tip** seen by a spotter is *Likely*; **the absence of a visible clipped tip is never evidence of anything**, because the clip is usually on the **left** ear and photographs are taken from the wrong side all the time. Sterilisation costs Syros Cats **€50–60 per cat**, so a wrong *Likely* is a real trapping trip wasted.
- **Mark a specific observation wrong** — the correction path for a misread photo, from the cat page, with a reason.
- **Remove a cat's owner** — the cat page shows only *whether* a cat has an owner, never who. "Remove owner" ends a wrong or out-of-date claim: it clears the owner link, so the owner's exact view and live alerts stop at once, and asks what the cat's status is now, recorded as an ordinary team statement. Setting an owned cat to street offers it in the same step. Who may claim, and the details, are `claiming-a-cat.md` §7.

**Nothing on this screen edits a field, and the wording above is deliberate.** There is no status column to change. Every one of these actions **appends an observation** carrying `roleAtTime: "staff"`, the person's id, `observedAt`, and — where it is correcting something — `supersedesId` pointing at the statement it replaces, exactly as `cat-record-data-spine.md` §10.1 defines and its §10.2 resolver reads. The mistake and the correction both stay in the record. **A correction is never an undo:** the way back from a wrong correction is another observation, not a delete.

v1.0's editable status columns and separate `record_changes` log are struck, and so is any prose describing them: they would have produced a dashboard writing to one model while the cat page read another, with no rule for which wins. The attribution the dashboard needs — who said what, when — is a property of the observation rows themselves, not of a log kept beside them. Who may **read** that history is the data spine's call; the dashboard shows what that spec permits.

### 3.4 Colony names

Colonies get the names Syros Cats already use — a place plus the person who looks after it ("Vaporia — Eleni's"). **The team can rename a colony at any time.** Guardians change, and a colony still named after somebody who has moved on is a name nobody on the phone recognises. Everything points at a colony by its id, never by its name, so a rename breaks nothing: its cats, its feeding sites and any printed QR code (SYC-22) stay attached. Earlier names are kept with the colony, so searching an old name still finds it and records imported under an old name still match. The dashboard lets the team name a colony that way and attach feeding sites and cats to it; the record behind that screen is the data spine's `colonies` table (`cat-record-data-spine.md` §10.5), and attaching a cat writes a `colony` observation like every other statement about a cat.

This sounds small and is not. The charity's operational vocabulary *is* colony names; a system that invents its own quietly stops matching the conversations people have on the phone, and then nobody trusts it. The person named is a **cat guardian** — the charity's term — and naming a colony after her is the first, lightest step towards the guardian role in §7.

### 3.5 Deletion requests that arrive by email

`hello@catspotters.com` is the published fallback for somebody who lost their phone, or would simply rather ask a human (DECISIONS D6). Self-service in the app is the main route and should reduce this to a trickle — but a trickle still has a legal clock on it, and it must not need Samuel.

**This spec provides the dashboard action; it does not design the mechanism.** The severing itself — what goes, what stays, and how an append-only store honours an erasure — is `cat-record-data-spine.md`'s (F3).

What the team sees:

- A **"Data requests"** section, kept separate from the welfare queue so a deletion request never competes with an injured cat for attention.
- Each request shows the address that asked, when it arrived, **when the legal clock runs out** (one calendar month from receipt, counted down in days), and one button: **"Delete this person's details."**
- Before it fires, plain-English confirmation of exactly what goes — their email address, the link between them and their sightings, their points and streaks — and what stays: **the cat sightings themselves, unlinked and anonymous, so no cat loses its history**, and any names they gave cats, which belong to the community once other people use them. It is irreversible and says so.
- Afterwards the action is recorded — who did it, when, against which request — because "did we action that?" needs an answer, and because a regulator asking is a foreseeable event.
- A request whose clock has fewer than seven days left is pinned to the top of that section. **This is the one place a countdown appears anywhere in the dashboard, and it is deliberate**: it is a legal deadline the charity actually holds, not a promise about cats we have not made.

### 3.6 What the dashboard does not do

No assignment. No due dates on reports. No alerting, paging, escalation or on-call rota (F1). No bulk "make everything public". No direct database editing of anybody's access. No free composition of email to members of the public (§5.3).

---

## 4. "This cat needs help" — the report flow

### 4.1 Where it starts

A "this cat needs help" action sits in the obvious places: the camera flow, a cat's record, and the map. It is never buried, and it is never the biggest thing on the screen — most cats are fine, and an app that shouts REPORT A PROBLEM at everybody teaches people to ignore it.

### 4.2 What the reporter is asked

Short. Somebody using this is worried, possibly upset, and possibly standing in the sun with one hand on their phone.

1. **A photo** — reused automatically if they have just taken one.
2. **Where** — the confirmed location, exactly as the spotting flow does it, so a poor GPS fix does not send anybody to the wrong street.
3. **How bad** — two choices, in plain words:
   - *Needs attention* — "Thin, limping, sore eye, or just not right."
   - *Urgent* — "Badly hurt, collapsed, or in danger right now."
4. **What you saw** — free text, optional, no character counter, no format.
5. **Is this kittens?** — a tick box: "This is kittens, or a mother with kittens." This changes what the app says next (§5.3).
6. **Your email** — optional. **The consent wording is `email-capture.md` §3.4's, verbatim, and that spec is the single source for it.** v1.0 carried a second, different wording; it is struck. The reporter also sees the separate, unticked "also email me news about the cats I've met" box that spec defines — a different purpose, so a different consent.

**A draft is written the moment severity and location are set**, before anything else is typed. If the person abandons the flow at the guidance screen, the team still sees that somebody reported a cat in that street. An abandoned report that leaves nothing is the exact outcome the charity most wants to avoid.

### 4.3 What happens when they submit

**On screen, immediately, before any email exists:** confirmation that the report is in (§5.3's confirmation copy). This is deliberate and comes from DECISIONS F7b — there is no verification step, no waiting and no friction at the moment somebody is trying to help a hurt cat.

Then, in the background:

- **A row in the queue** (§3.1). **The queue row is the source of truth.** It is written first and it is written even when every email fails, is rate-limited, or is suppressed. Nothing that happens to mail can lose a report.
- **The photo attaches after the row**, and the row shows *photo pending* until it does. A queue row with no photo is a report the team cannot triage, so the state is visible rather than mysterious.

- **An alert email to `admin@syroscats.com`**, queued with retry, never sent inline: the photo, the location, a map link, the severity, the litter flag and the reporter's note. Urgent reports carry a distinct subject line. **It does not carry the reporter's address** — it says "the reporter left contact details; reply from the dashboard." **The photo travels as an attachment, not a link**, because a link into the team-gated route would simply fail in a mailbox and a public link would put the one restricted photo we have outside the gate. Stated so nobody closes that gap by "just making the URL public".
- **If the reporter gave an address**, `email-capture.md`'s verification message goes to it — **from the news identity, because the reporter is a member of the public (§2.10)** — and **nothing else is sent to that address until they confirm** (F7b). The acknowledgement and the outcome that follow confirmation are transactional. This is what stops the report form being a machine for sending mail from a charity's domain to a stranger's inbox.

**If the phone has no signal**, the report queues locally alongside offline sightings and sends when signal returns. Be precise with users: the report is **saved on the device** and reaches Syros Cats when the phone next has a connection. It is not delivered while offline, and the confirmation screen says so rather than implying anybody has been told. If an unsent report is still sitting there after 24 hours, the phone reminds its owner once: *"You have a cat report that hasn't sent yet."*

#### Report photos are team-only, and the restriction is structural

A report photo is not a catalogue photo. It may show a bleeding animal, a doorway, a house number, a vehicle, a bystander, or the inside of somebody's yard, and none of that belongs in a public catalogue a tourist browses. Three things make that real, and **not one of them is a flag anybody has to remember to set**:

1. **`POST /api/reports` is the report photo's upload path**, and it runs the bytes through the same `validatePhotoBase64` helper as `POST /api/sightings` — magic-byte detection, full decode, EXIF rotation and **metadata strip**, bounded re-encode, size caps. Verified in the code: that helper is called today from `routes/sightings.ts` and nowhere else, so this is a second call site to build, not a behaviour to assume. `hosting-and-photo-storage.md` §6.4 owns the helper and the EXIF test; this spec owns the requirement that the report path goes through it.
2. **The bytes go to a separate `welfare_report_photos` table, not to `photos`.** The public photo route reads `photos`, so it cannot serve a report photo — not because a column told it not to, but because the row is not in the table it reads. One team-session-gated route, `GET /api/team/report-photos/:publicId`, serves them, behind the `__Host-cs_team` cookie of §8.2 and a capability check (§7.3).
3. **There is no `visibility` column, and there should not be.** `hosting-and-photo-storage.md` §7.2 cut it on the grounds that a column nothing writes and nothing enforces is a plausible way to break photo loading mid-Play-window, and a wrong default would have published exactly these photos. Enforcement by table needs no default to be correct, which is why it is the answer rather than a column.

**Promoting a report photo into the catalogue is a deliberate team action**, never a side effect of tying the report to a cat: the team taps *use this photo on the cat*, and the bytes are re-validated through the same helper and copied into `photos`. Until somebody chooses that, the photo stays team-only.

Both tables live in Postgres per DECISIONS D1, and they move together if that is ever revisited. The same rule covers the "Report an issue" flow in §6, whose photos are already public catalogue photos and stay in `photos`.

### 4.4 Keeping the flow from being abused

The report endpoint is public and unauthenticated, it costs money (image handling) and it costs attention (a queue a human reads), which is the scarcest resource in this entire system.

- **Device identity is not an abuse control here.** `deviceAuth.ts` is trust-on-first-use: the first request presenting a secret for an id binds it, so an attacker mints a fresh device per request at no cost. Per-device limits are a courtesy control against a buggy client and are treated as diagnostic only. The controls that bear weight are **per IP**, **per recipient address**, and the **global daily send ceiling** (§2.6, §2.10).
- **Turnstile on the report submit.** A charity app with an unauthenticated public write endpoint is the textbook case; the widget is invisible to almost everybody and stops scripted floods.
- **Recipient-address limits** (§2.6) mean the same address cannot be mailed repeatedly no matter how many reports name it. **The queue row is written anyway** — suppression must never lose a report.
- **Bounce and complaint webhooks** feed a suppression list, which also suppresses verification sends.

---

## 5. Capacity and safety copy — the most important part of this spec

### 5.1 The principle, and the decision behind it

Every cat that comes into Syros Cats' care costs money they would rather spend on sterilisation, which is what actually reduces suffering on the island over time. At **€50–60 per cat**, one sterilisation prevents far more misery than one rescue. Their aim is *fewer cats in their care, more care happening in the community.* But they still want the data — every one of those cats should end up in the record.

So the flow has to do something delicate: **capture the report, and at the same time move the reporter towards acting themselves** — not by refusing to help, but by being honest, early and warm about what happens next.

**Decision (recorded): no urgent alarm.**

| Option | Benefits | Risks |
|---|---|---|
| **A. Page a human.** An urgent report pushes to the WhatsApp group Syros Cats already use, or an SMS to a rota phone, with re-notification after N hours. | The stated risk — "a dying cat and nobody sees it for two days" — is actively mitigated rather than merely documented. | **It is a promise nobody has agreed to keep.** There is no rota; there is no funding for one; the charity has not asked for one. An alert that nobody answers is worse than no alert, because the app has now told a reporter that somebody was told. A WhatsApp group at 3am on a Sunday in February is two people asleep. It also quietly makes the charity feel accountable for outcomes they cannot deliver. |
| **B. ✅ No alarm. Honest copy instead.** Reports reach the shared inbox and the queue. Severity sets queue order. Nothing wakes anybody. | The app promises exactly what it delivers. It sends urgent cases to the one route that is genuinely fast — a vet — rather than to a queue. It does not make Syros Cats the emergency service for an island's cats, which is the outcome that would consume the charity. | **A report about a genuinely dying cat can sit unseen for two days.** Accepted, deliberately, with our eyes open. Survivable **only** because the copy sent that case to a vet before the report was ever submitted. If the copy is weak, this decision is indefensible — which is why the copy is treated as a launch blocker, not a polish item. |

**Recommendation: B**, as decided in F1. And the consequence written through everything below: **there is no language anywhere in this product implying that anyone is monitoring, standing by, on call, or coming.** Severity changes the order of a list. It does not change the speed of anything.

### 5.2 Where the copy goes

Four moments, deliberately:

- **Onboarding**, once, about healthy street cats (§5.3a).
- **Before submitting**, on the severity step, different for urgent and for needs-attention (§5.3b, §5.3c) — guidance *before* the report, never instead of it. **The report always goes through. Nobody is ever blocked from telling the charity something.**
- **Immediately after submitting**, on the confirmation screen (§5.3e).
- **In the acknowledgement email**, once the address is verified (§5.3f), so the person has it in writing.

Same rule, same words, in the flow and in the mail. A message that appears in only one place is a message half the people never see.

**A layout note that is part of the design, not decoration.** The urgent block is long because it has to be. It is shown as a short lead, then a clearly labelled expander — **"How to get a hurt cat to a vet"** — ~~open by default on first use~~ **folded by default, behind a clear, prominent button-style expander (never small print)**. *Samuel, 2 Oct 2026: the steps are folded behind a prominent button so the advice screen needs no scrolling.* The report flow is three screens (Where → How bad → Before you send), each fitting a 390×844 phone without scrolling; the capacity paragraph is always shown in full, directly above the pinned Send report button. The lead must never be the discouraging half: leading with "we may not come" turns a worried person away at the exact moment we want them to press Send. The block therefore opens with the vet route ("If this cat is badly hurt, please take it to a local vet if you can") and puts the capacity paragraph — Syros Cats is not an emergency service — **last** (Samuel, 1 Oct 2026).

### 5.3 The copy

> **These are drafts written to be corrected.** They are a starting point so Syros Cats have something concrete to react to. The charity has the final word on every line. **One exception, and it is important: the injured-cat handling advice in (b) is not a free swap** — see §5.4.
>
> **Susan's standard reply has since arrived, and it is the authority.** It is held verbatim at `docs/specs/source/syros-cats-standard-reply.md`. The injured-cat copy below has been rewritten to say what Susan says: **borrow a carrying cage from a vet, lure the cat in with strong food, and handle the cat only if that fails.** The version this replaces led with "drop a towel over it, never bare hands" — that was invented during spec-writing and it is now struck. Where this document and the source document differ on substance, the source document wins.
>
> **Samuel line-edited the injured-cat copy on 4 September 2026 and those edits are final.** The urgent block in (b) now reads as he left it. It is not "awaiting approval" in the sense the rest of this section is: Syros Cats will confirm it during testing rather than before it is written (§5.4).

#### (a) Onboarding — healthy street cats

> **Look, don't touch.**
>
> The cats of Syros are not pets, and they are not strays. They live here.
>
> Keep a step or two back and let them come to you if they want to. A cat that stays a bit wary of people is a cat that stays out of the road and out of trouble — being careful around strangers is one of the things keeping it alive. Picking one up, or feeding it, does it no favours.
>
> So: photograph them, admire them, leave them be.
>
> **If you find a cat that is hurt or sick, that is different, and the app will tell you what to do.**

#### (b) The severity step — "Urgent"

**One version, and it is final.** The two-variant structure that stood here — a night-and-weekend variant shown against a daytime one — is gone. There is one urgent block, below, edited line by line by Samuel on 4 September 2026. It has no out-of-hours paragraph: the one that stood here was removed by Samuel on 27 September 2026.

**Edited by Samuel, 1 Oct 2026: opening 'Send this…' paragraph removed; closing capacity paragraph added, from Susan's standard reply.** (Two grammar fixes to his wording: "they may" added so the sentence reads, and "Our/us" became "Their/them" because the app speaks about Syros Cats, not as them.)

> If this cat is badly hurt, please take it to a local vet if you can.
>
> **The vets on Syros will lend you a carrying cage.** Phone the nearest clinic, tell them you have found a hurt cat, and ask to borrow a "trap" or a carrying cage. Then take the cat straight to them.
>
> **Vets on Syros** *[the list from §5.7]*
>
> ---
>
> **▾ How to get a hurt cat to a vet** *(folded by default behind a prominent button — Samuel, 2 Oct 2026: the steps are folded behind a prominent button so the advice screen needs no scrolling)*
>
> **1. Phone a vet and ask for a cage.** Any of the clinics above. Say where you are and what you have found.
>
> **2. Let food do the work.** Put something strong-smelling at the back of the cage — sardines, or wet cat food. Open the door, step well back, and wait.
>
> **3. Close it, cover it, go.** Once the door is shut, put a towel or a jacket over the cage. Dark and quiet keeps the cat calm. Drive straight to the clinic. Don't give it food or water on the way, and don't try to treat the injury yourself.
>
> **If the cat will not go in.** Only then, and only if you feel safe doing it: drop a towel, a jumper or a jacket right over the cat, including its head. Lift it wrapped and put it straight into the cage, or a box you can close. A hurt cat might bite and scratch, hard, while you are helping it — it is frightened and in pain and it does not know you are on its side.
>
> ---
>
> **What the vet does.** They look the cat over and treat what needs treating. They can also scan for a microchip — some of these cats have an owner who is looking for them, and that is the fastest good ending there is.
>
> **What it costs.** The vet is likely to charge you for the visit.
>
> **You may be asked to decide.** Whoever brings an animal in can be asked to approve treatment, or to agree to it being put to sleep. If you do not want to be the person making that decision, say so at the desk when you arrive.
>
> **If the cat needs looking after for weeks, not hours.** Under Greek law the care of street animals is the Municipality's job. Tell the Municipality of Syros-Ermoupoli — **+30 22813 61000** — and ask for the animal welfare office. They can sometimes help with the cost. It depends on what money they have at the time.
>
> Sending this report will also provide Syros Cats with a report about the cat and, in some circumstances, they may take action in response. However, Syros Cats is a private sanctuary and not an emergency service, so they are unable to provide immediate rescue or collection. Their small team is currently at full capacity caring for the cats already with them.

**Out-of-hours: the paragraph that named these numbers in the urgent block was removed by Samuel on 27 September 2026.** What follows is kept as the record of why it was there. SYC-68 asked who somebody calls at nine in the evening in February. The earlier answer — that there is no cover and the app should say nothing — was wrong on both halves, and the verification pass in `docs/specs/source/syros-vets-verified.md` is what corrected it. Two of the three clinics publish an out-of-hours contact: Symviosis lists **+30 697 005 5012** on its own site as the number to call outside clinic hours, and Cyclades Vets advertises 24-hour operation, 365 days a year, on **+30 6937 252802**. Those are published claims, not tested realities — nobody has rung either number at 2am to find out what happens. So the app names them and vouches for nothing, in one short paragraph placed directly under the vet list. Confirming whether they actually answer is a testing task (§5.4), not a blocker: naming a number the clinic itself publishes is better than a silence that implies there is nobody at all. Syros Cats told us there is no night cover; the clinics' own material says otherwise; the app reports the published position and leaves the reader to judge.

#### (c) The severity step — "Needs attention"

> ### Thank you for noticing.
>
> Reports like this are how Syros Cats know which cats to check on. Send it — a thin cat with a sore eye is worth recording, and the record is what tells the team where to spend what little they have.
>
> Please know what this is and isn't: it goes to a small charity, not to a rescue service. Nobody is on duty. Somebody reads the list when they can, and that may be a few days.
>
> If the cat gets worse in the meantime, a vet is the fastest help — and you can send another report any time.

#### (d) When the report is marked as a litter

> ### Please don't move them, and please don't bring them anywhere.
>
> Kittens are almost always better off exactly where they are, with their mother. She is usually close by even when you cannot see her, and she is far better at this than any of us. If they look round and quiet, she is doing her job.
>
> Sending this report is exactly the right thing to do. It tells the team where the mother is, and getting her sterilised — around **€50–60** — is what stops the next litter.

*The donation ask does not appear here.* Somebody crouched over a cardboard box is not being asked for money. The ask moves to the acknowledgement email, where it reads as gratitude rather than as a toll.

*Samuel, 2 Oct 2026: with Urgent, the urgent advice wins; kittens message only with Needs attention.* When kittens is ticked and the report is Urgent, the message above does not appear; instead, one line sits just above the urgent advice (outside its locked block):

> If a kitten is hurt, the advice below applies to it.

#### (e) The confirmation screen, immediately after any report

> ### Sent. Syros Cats have this.
>
> Your photo and the location are saved, and this report is in Syros Cats' list.
>
> **What happens next, honestly:** somebody at Syros Cats will read it when they can.
>
> **If this cat is badly hurt, please don't wait for us.** A vet is the fastest help there is, and **the vets here will lend you a carrying cage** — phone the nearest one and ask for a "trap" or carrying cage, then lure the cat in with sardines or wet food. *[Vets on Syros — §5.7]*
>
> *[If an email was given]* We've sent one message to that address to check it's right. Tap the link in it and we'll write to you when someone has looked at this report. Until you do, we won't send you anything at all.
>
> *[If offline]* This report is saved on your phone and sends itself the moment you have a signal.

#### (f) The verification email — **not this spec's copy**

The verification message is **one fixed message for every address typed anywhere in the app**, and `email-capture.md` §4.1 owns every word of it. It is deliberately identical whatever screen produced the address: it carries no cat name, no note text and nothing a sender chooses, precisely because it is the only thing an unverified address can ever receive. A report-specific variant is exactly what that rule forbids, so v1.0's version is struck and this spec does not carry one.

It sends from the **news** identity (§2.10). Only what follows confirmation — the acknowledgement in (g) and the outcome in (h) — is transactional.

#### (g) The acknowledgement email — sent only after the address is verified

> Subject: **Your cat report reached Syros Cats**
> Reply-To: admin@syroscats.com
>
> Hello,
>
> Thank you for telling us about this cat. Your report and your photo reached Syros Cats on *[date]*, and it is in their list.
>
> **If this cat is badly hurt, the fastest help is a vet, and it is worth doing without waiting for us.** *[Vets on Syros — §5.7]*
>
> **Phone the nearest clinic and ask to borrow a carrying cage** — a "trap". Put sardines or wet food at the back of it, stand back, and let the cat walk in; then cover the cage and take it straight in. The vet will check the injuries and scan for a microchip, in case somebody is looking for this cat. Only if the cat will not go into the cage, and only if you feel safe: a towel over it, including its head, and into a box you can close.
>
> They are likely to charge for the visit. If the cat turns out to need weeks of care rather than a single visit, the **Municipality of Syros-Ermoupoli (+30 22813 61000)** is legally responsible for street animals and can sometimes help with the cost.
>
> *[Litter variant]* Please don't move the kittens or bring them anywhere — talk to Syros Cats first. Their mother is almost certainly nearby and is far better at this than any of us.
>
> Every report goes into the record, and the record is what lets Syros Cats plan sterilisation where it does the most good — around €50–60 a cat, and the single most useful thing anybody can pay for on this island. *[If you'd like to help with that]*
>
> *[Delete my details]* — removes your address and takes your name off this report. The report itself stays, so the cat keeps its history.
>
> Syros Cats · admin@syroscats.com

#### (h) The reporter's update — fixed copy per state

**Exactly two messages per report, at most: the acknowledgement, and one when the report reaches a closing state.** Agreed with `email-capture.md`, which is the owner of the four email moments. v1.0 promised "twice and no more" while describing a message on every state change, which its own four-state queue could not deliver.

**Moving a report to *Looking at it* sends the reporter nothing, and that is deliberate.** An interim "somebody is on it" message is a statement about response speed, and F1 refuses to make one. It would also be the single easiest way to reintroduce the promise this whole design exists to avoid: a person who has been told somebody is looking will reasonably expect somebody to arrive. The state exists for the team's own use in the queue and stays there.

**The internal state name never appears in anything a reporter reads.** A tourist who reported a bleeding cat must never receive an email carrying the words "Not for us."

| Internal state | Reporter is emailed? | Subject | Body |
|---|---|---|---|
| **Looking at it** | **No** — see above | — | — |
| **Done** | Yes | About the cat you reported | "Syros Cats has looked into this and taken appropriate action in response to your report. *[optional team sentence]* Thank you for taking action to help the cats of Syros to thrive." |
| **Nothing needed** | Yes | About the cat you reported | "Syros Cats has looked into this and taken appropriate action in response to your report. Thank you for taking action to help the cats of Syros to thrive." |

If a report is moved straight from *New* to a closing state, that is still one message. If it goes *New → Looking at it → Done*, it is still one message, sent at *Done*. Duplicates are suppressed on the closing transition, so re-opening and re-closing a report does not mail somebody twice.

The **optional team sentence** is exactly that: optional, added to the *Done* message only, short, appended to the fixed copy and never replacing it, with a reminder on screen that it is going to a member of the public. Everything else is fixed. Free composition into an email to a stranger is not a feature this dashboard has.

### 5.4 Duty of care — stated explicitly

The injured-cat block (§5.3b) is **advice a member of the public may act on, in a foreign country, alone**, given by an app built by Fair Shake and carrying Syros Cats' name. That deserves to be named rather than assumed:

- The route it gives keeps **hands off the animal**: a borrowed cage and strong food, with handling named only as a fallback and conditioned on "only if you feel safe doing it". It warns, in the copy itself, that a hurt cat might bite and scratch hard.
- It carries the **money line** and the **decision-at-the-vet line**, because being landed with an unexpected bill or asked to consent to euthanasia are both real, and both would damage Syros Cats more than the unreported cat would have.
- **Samuel cut the longer safety scaffolding on 4 September 2026** — the "if you can't do that safely, stop" paragraph, the "never bare hands" instruction, and the medical line about a bite needing a doctor. That is a deliberate editorial decision and it is recorded here rather than argued with. The residual exposure is named plainly: the block no longer tells anybody when to stop, and no longer tells them to see a doctor if they are bitten.
- **Saying nothing is worse.** People help anyway. Without guidance they do it bare-handed.
- **The advice is now the charity's own, not ours.** The cage-first route in §5.3b is Susan's, taken from `docs/specs/source/syros-cats-standard-reply.md`. That matters for this section specifically: the version it replaces was invented during spec-writing, and asking a tourist to put their hands on a frightened animal was our idea rather than Syros Cats'. Cage first, food, and hands only as a fallback is both safer and defensible, because it is what the charity actually tells people.

**Status of the block: settled copy, to be confirmed in testing.** §5.3b reads as Samuel left it on 4 September 2026, and those edits are definitive. Syros Cats confirm it during the closed test rather than gate it beforehand.

**It still gets checked against whatever liability and insurance position Fair Shake is taking, before launch.** And unlike everything else in §5.3 it is **not** a free copy swap: changing it from configuration afterwards goes back through Samuel. The configuration mechanism carries a marker on this block saying so. That is a workflow rule, not a technical lock.

### 5.5 Dependencies in this section

| Dependency | Owner | Blocking? |
|---|---|---|
| **Susan's standard reply** | Syros Cats (Susan) | **Closed.** Supplied 3 September 2026, verbatim at `docs/specs/source/syros-cats-standard-reply.md`. §5.3b, §5.3e and §5.3g were rewritten against it and then line-edited by Samuel on 4 September. Syros Cats confirm the wording during testing (§5.4); nothing is blocked on it. |
| **The vet list itself — which clinics** | Syros Cats | **Supplied.** Three clinics, verbatim in `docs/specs/source/syros-cats-standard-reply.md`. This dependency is closed; verifying and completing each entry is the row below. |
| **Out-of-hours cover: who does somebody call at 9pm in February? (SYC-68)** | Syros Cats · Samuel | **Closed, and reversed.** The earlier answer — no cover, app says nothing — did not survive verification. Symviosis and Cyclades Vets both publish after-hours numbers, so they sit in the vet list (§5.7); the urgent block no longer mentions them (removed 27 Sep). Whether either is answered in practice is untested, and Samuel accepted that risk on 28 Sep 2026: no testing needed. |
| **Verified vet entries — addresses, phone numbers, Google Maps and Apple Maps links, coordinates** | Samuel | **Closed enough to ship.** §5.7 is populated from `docs/specs/source/syros-vets-verified.md`. All six phone numbers verified. **Coordinates are landmark-anchored to petrol stations, good to 50–100 m** — accurate enough to drive to, and stated as such. Real door pins are ten-minute jobs for somebody on the island (§5.7). Dermitzaki's address is settled (Livadia, Manna); its pin needs replacing. |
| **The Municipality's animal welfare contact** | Syros Cats | **Never blocks, and now answered in the negative.** The switchboard **+30 22813 61000** is confirmed against the municipality's own directory. There is **no dedicated animal-welfare number published** — verified absence, not merely not found. A direct line would be better and is worth asking for. |
| **A phone or WhatsApp number for litters** | Syros Cats | **Blocks nothing.** The in-app litter copy (§5.3d) no longer asks anybody to make contact (removed 27 Sep), so a number would only appear in the acknowledgement email (§5.3g). |
| **Translation into Greek and French** | Fair Shake to translate · a local to confirm | **Blocks launch of this copy, and §5.3b most of all** — it is the one block people act on rather than read. We produce the Greek and French ourselves; a local speaker then checks them before launch. It is no longer "find somebody to translate this", it is "translate, then have a local confirm". The reporter's language is stored on the report row so the acknowledgement and the update go out in the language they used. Every "it's just a copy swap" in this document is a copy swap **×3**. |
| **The public feeding-site list** | Syros Cats | **Never blocks.** Everything is private until they say otherwise (§3.2). Configuration, not code. |

### 5.6 Testing the copy

The copy is the mitigation for the largest accepted risk in the product, so it gets tested like one, during the September closed test with the WhatsApp testers — who include actual tourists:

- Does anybody come away believing somebody is coming? (If yes, the copy has failed.)
- Does anybody come away not knowing a vet is the fast route? (Same.)
- **Does anybody come away not knowing they can borrow a cage?** That is the single most useful sentence in §5.3b, and if testers miss it the block is laid out wrong.
- **What is the abandonment rate at the severity step?** An abandoned report is the outcome the charity least wants, and the drafts above put the encouragement first specifically to protect against it. The draft-on-severity rule in §4.2 means we can measure this rather than guess.

### 5.7 The vet list and the Municipality — configuration, not copy

The vet list is the third clause of the urgent block, and without it that block is "phone a vet" with a placeholder underneath. The three clinics come from Susan's standard reply (`docs/specs/source/syros-cats-standard-reply.md`); the addresses, verified numbers and map links come from `docs/specs/source/syros-vets-verified.md`.

**It lives in configuration, in the same file as the rest of the capacity copy, and never in the app's code or in a translated copy string.** Clinics change, vets move, numbers get reassigned. A wrong number in front of somebody holding an injured cat is worse than no number at all, so correcting one has to be a data edit that takes a minute — not a release, a store review and a week. The names and phone numbers are the same in all three languages; only the surrounding sentences are translated.

**Each entry carries, and all of it is required:**

| Field | Notes |
|---|---|
| **Name** | The clinic and the vet, as people ask for them. |
| **Address, as far as it is published** | Area, landmark and postcode. **No clinic on Syros publishes a street name and number** — see below. This field carries whatever the clinic itself gives out, which is what a taxi driver will recognise. |
| **Area and landmark** | The load-bearing field, not a decoration. People here navigate by the petrol station, not the postcode. |
| **Phone numbers** | Every verified number for the clinic, each labelled — main line, mobile, and **after-hours where the clinic publishes one**. Rendered as tap-to-call links, because the person reading this has one hand free. |
| **Google Maps link** | A plain coordinate URL you can read and check by eye. No shorteners. |
| **Apple Maps link** | Same, built from the same coordinates. Most of the tourists this block is written for are on an iPhone. |
| **Coordinates** | Latitude and longitude, so a link that rots can be regenerated and so the entry survives either maps provider changing its URL format. |

**The data, from `docs/specs/source/syros-vets-verified.md`.** All three clinics exist, and every phone number in Susan's original reply checks out. Two things changed in the writing-up: the third clinic no longer trades under Maragkos's name, and two of the three publish after-hours contacts.

**1. Symviosis — Κτηνιατρικό Κέντρο Σύρου** *(vet: Emmanouil "Manolis" Vorrisis)*

| | |
|---|---|
| Area and landmark | Talanta / Τάλαντα — **opposite the Shell petrol station**, on the Pagos–Ermoupoli road |
| Address as published | Stavros Talanton, Talanta, Syros 841 00, Cyclades. No street name or number published. |
| Phone | **+30 22810 77929** (clinic hours) |
| Phone | **+30 697 005 5012** — **after-hours line**, published on the clinic's own site as the number to call outside opening hours |
| Coordinates | **37.4234996, 24.9202989** — landmark-anchored (see below) |
| Google Maps | `https://www.google.com/maps/search/?api=1&query=37.4234996,24.9202989` |
| Apple Maps | `https://maps.apple.com/?ll=37.4234996,24.9202989&q=Symviosis%20Vet%20Talanta` |

**2. Dr Irini Dermitzaki — Κτηνιατρείο Δρ. Δερμιτζάκη Ειρήνη**

| | |
|---|---|
| Area and landmark | Livadia / Λιβάδια, Manna — **settled by Samuel, 28 Sep 2026** (not Lazareta) |
| Address as published | λιβάδια 0, Manna 841 00, Greece (as Google Maps lists it; the "0" means no street number). |
| Phone | **+30 22813 06720** (landline) |
| Phone | **+30 6986 705837** (mobile) |
| After-hours | **Nothing published, either way.** The entry says nothing about nights — it does not claim cover and it does not deny it. |
| Coordinates | **Needs a new pin.** The old one (37.4303699, 24.9439526) was the Lazareta neighbourhood centre and is now known to be wrong. |
| Google Maps | Interim, until re-pinned: `https://www.google.com/maps/search/?api=1&query=Dermitzaki%20vet%20Livadia%20Manna%20Syros` |
| Apple Maps | Interim, until re-pinned: `https://maps.apple.com/?q=Dermitzaki%20Vet%20Livadia%20Manna%20Syros` |

**3. Cyclades Vets (George Maragkos) — Κτηνιατρική Κλινική Κυκλάδων**

| | |
|---|---|
| Display name | **"Cyclades Vets (George Maragkos)"**, in that bracketed form, everywhere. |
| Area and landmark | Livadia, on the main road, **opposite the AVIN petrol station** — Kato Manna / Κάτω Μάννα |
| Address as published | Λιβάδια, επί της κεντρικής οδού, έναντι AVIN — Kato Manna, Syros 841 00. No street name or number published. |
| Phone | **+30 22810 79439** (main) |
| Phone | **+30 6937 252802** — **emergency line**; the clinic advertises 24-hour operation, 365 days a year, on this number |
| Coordinates | **37.4281630, 24.9400130** — landmark-anchored to the AVIN station |
| Google Maps | `https://www.google.com/maps/search/?api=1&query=37.4281630,24.9400130` |
| Apple Maps | `https://maps.apple.com/?ll=37.4281630,24.9400130&q=Cyclades%20Vets%20Syros` |

**Why the name is written "Cyclades Vets (George Maragkos)".** Susan's reply calls this clinic "George Maragkos", and that is how Syros Cats and half the island still refer to it. It does not trade under that name. Maragkos founded it in June 2012, and it now operates as **Κτηνιατρική Κλινική Κυκλάδων / Cyclades Vets** as part of the mainland Plakentia group — `cycladesvets.gr` redirects to a Plakentia page. Somebody driving out to Kato Manna looking for a sign saying "Maragkos" will not find one; somebody phoning ahead and asking for Maragkos will be understood. The bracketed form is the only version that works for both, so it is the one that ships, and it is not to be tidied down to either half.

**The coordinates are landmark-anchored, and the spec says so out loud.** None of the three clinics is mapped as a named point in OpenStreetMap, and no Google Places pin was available. Every coordinate above is the **verified position of the petrol station the clinic sits opposite** — the same landmark the clinics use in their own published addresses — which puts the pin within roughly **50–100 metres of the door**. That is good enough to drive to and honest about what it is. It is not good enough to be left alone: **somebody physically on Syros fixes all three to real door positions in about ten minutes**, standing outside each clinic with a phone. That task stays open below until it is done, and it is the single cheapest improvement available to this section.

**Dermitzaki's address — settled 28 Sep 2026: Livadia, Manna.** Samuel confirmed it; what follows is the record of the earlier conflict. Most sources, and Susan's reply, put this clinic in **Lazareta**. One directory (`syrostoday.gr`) lists it at **"Livadia, Kato Manna"** — which is the address Cyclades Vets uses, so it looks like a copy-paste error in the directory rather than a second location. The two areas are about **500 m apart on the same Ermoupoli–Manna road**, so a wrong pin here is a short walk rather than a disaster. It is recorded rather than silently resolved, and one phone call settles it.

**There is no hours field.** Opening hours are published inconsistently, sources disagree, and hours in configuration go stale silently — which is the worst way for this table to be wrong. **There is an after-hours phone field**, because two of the three clinics publish one.

**The original `maps.app.goo.gl` short links are not reused.** They were never testable — nobody could open them, and their format did not match a genuine Google short link. Every link above is a plain coordinate URL that can be checked by reading it.

**The Municipality of Syros-Ermoupoli — +30 22813 61000.** The number is confirmed against the municipality's own service telephone directory. It is the same digits as the `+30 22813 61000` that was in the copy; the grouping is standardised to **+30 22813 61000** everywhere in this spec and in the translations. There is **no dedicated animal-welfare number** — the municipality's own directory has no entry for strays, animals or veterinary services, so a caller reaches a general switchboard, in office hours, in Greek. The copy should not oversell it.

Under Greek law the Municipality is ultimately responsible for the care of street animals, and it may help with the cost of a cat that needs long-term care, case by case, depending on the money it has. It appears in two places: in the urgent block for a cat that needs weeks rather than hours (§5.3b), and in the acknowledgement email (§5.3g). It is also the honest answer to "why is a small charity carrying this?", which is worth having ready for the media one-pager. It sits in the same configuration block as the clinics.

**What is still open on this data:**

1. **Fix the three map pins to real door positions.** Everything above is landmark-anchored to a petrol station. Somebody standing outside each clinic with a phone closes this permanently, in about ten minutes. This is the top item.
2. **Pin Dermitzaki's door.** The address is settled (Livadia, Manna); the map pin still points at Lazareta and needs replacing.
3. **Ask Dermitzaki whether there is any emergency contact.** Complete blank at present, in both directions.

None of these blocks the block shipping. The numbers themselves are verified — every one of the six from Susan's reply checks out against the clinics' own material or two independent sources — and a landmark pin plus a working number is genuinely useful. What would not be acceptable is shipping any of it as more certain than it is, which is what the wording above is for.

---

## 6. "Report an issue" on cats and photos

Every cat record and every photo carries a quiet "Report an issue" action. The reporter picks a reason in plain words — wrong information about this cat · this is not a cat, or not this cat · the photo is upsetting or inappropriate · something else — plus an optional note and an optional email, which follows the same verification rule as everything else (F7b).

It reaches the same two places, arriving in the queue but **visually distinct and never above a welfare report**. A wrong name is not an emergency.

**Objectionable content is treated differently in one specific way.** Something reported as upsetting or inappropriate is hidden straight away, because the cost of briefly hiding a good photo of a cat is nothing and the cost of leaving genuinely objectionable content up is real.

**One report is enough (Samuel, 28 September 2026).**

- **The reporter confirms first.** Before an "upsetting or inappropriate" report is sent, the app asks: *"Are you sure? Reporting this will hide it from everyone until Syros Cats have reviewed it."* with **Report and hide** and **Cancel**. Nothing is hidden until they confirm.
- **A single confirmed report hides it pending review.** It disappears from every public view at once and stays visible to staff (and to whoever uploaded it) until the team restores it or removes it for good.
- Turnstile sits on the report action.
- Hide volume above a daily threshold raises a dashboard banner.
- Restoring is one tap, and it is attributed.

**The risk this accepts.** Device identity is trust-on-first-use (`deviceAuth.ts`), so somebody determined could mint a new device per report and hide photos one at a time. The confirmation step, Turnstile, the volume banner and one-tap restore are the mitigations. The earlier design required reports from two separate devices and networks before a full hide; Samuel chose single-report hiding instead, so a real problem goes dark on the first report.

---

## 7. Roles now, roles later

### 7.1 What exists now

One role: **Syros Cats staff**. Everyone on the list can see and change everything in the dashboard. For a team this size that is honest and correct — inventing permissions nobody asked for produces a system where the person who needs to fix something cannot.

### 7.2 What is coming

The same access model later carries invited **cat guardians** (who look after specific colonies and are authorised to arrange sterilisation the charity pays for), **volunteers**, and **vets**. Those roles need things this one does not: a guardian should see her own colonies in full and other people's approximately; a vet records a procedure but has no business renaming cats; a volunteer on a hillside with no mobile data needs the colony view to work offline.

### 7.3 What we are leaving room for, so that later arrives without a rebuild

- **People, not admins.** The access table is a table of *people* (§2.9), and it is the only one (§2.7).
- **Roles and scopes are a join table from day one — not columns.** `person_scopes` (person id, role, colony id nullable). v1.0 put `role` and `scope` on the person as scalar columns, which is exactly the retrofit it claimed to be avoiding: a cat guardian looks after **several** colonies, and real people hold two roles at once — a staff member who is also the guardian of her own alley. A single column forces either a delimited string or the migration we said we would not do. The cost today is one small table.
- **Capabilities are named, and named here**, because "can this person do this?" without an enumerated list quietly becomes `isStaff()` with extra steps. From the first commit the dashboard calls them by name: `view_exact_location` · `hide_photo` · `restore_photo` · `rename_cat` · `rename_colony` · `set_life_status` · `remove_owner` · `set_sterilisation` · `set_site_public` · `change_report_state` · `add_team_note` · `manage_people` · `action_deletion_request`. Every check goes through one capability function. When guardians arrive, that function changes; the screens do not.
- **Invitation is the only way in, at every tier.** A guardian will use the same email-link flow. No second sign-in mechanism gets built for the second role.
- **Every change is attributed from the first record**, as an observation carrying the person's id and `roleAtTime` (`cat-record-data-spine.md` §10.1). Attribution added later cannot describe the past — which is precisely why `roleAtTime` is recorded at write time and never looked up afterwards.
- **Colony membership already exists** (§3.4), so "which colonies is this person a guardian of?" is a join, not a new concept.

Explicitly **not** built now: an invitation interface, per-field permissions, approval workflows, or an offline volunteer view. Those belong with the roles they serve.

**The real rework risk was never the role column.** It was two people tables on two platforms (§2.7): guardians arriving into that split would break the "no rebuild" claim for reasons that have nothing to do with roles. That is why §2.7 is settled here rather than left open.

---

## 8. Technical notes

*This section is for whoever implements it. Everything above is the product; this is the wiring.* **Two runtimes are involved and they are not interchangeable:** sign-in is a **Cloudflare Worker** (`admin.catspotters.com`, D1, wrangler secrets); the dashboard, the API and the queue are **Express on Node, deployed on Replit** (`team.catspotters.com` and `api.catspotters.com`, Postgres, Replit deployment secrets). v1.0 was written as though everything were a Worker; every instruction below is against the runtime that actually runs it.

### 8.1 Sign-in mechanics — Cloudflare Worker

- **Allow-list first, over the boundary.** A link is minted only for an address the API confirms is in `people` (§2.7). The call fails closed.
- **Identical replies.** Same body, same status, and — after the fix in §2.5 — the same wall-clock time, by padding to a deadline with the send moved off the response path.
- **Token:** 32 bytes of cryptographic randomness in `signin_tokens` (D1), with the address and an expiry. **Fifteen minutes.** Up to three outstanding per address.
- **Consumed on POST, never on GET** (§2.5), with the conditional write `UPDATE … SET used_at = … WHERE token = ? AND used_at IS NULL AND expires_at >= ? RETURNING email`, a 60-second re-presentation window, and the same-origin check applied to the POST.
- **Workspace session:** signed cookie, `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefixed, thirty days. **Read every cookie of that name, not the last one** — a sibling subdomain can set a same-named cookie and shadow the real session. Signature verification is constant-time, and a payload with no parseable expiry is rejected rather than treated as never expiring. Both behaviours exist in the current code and are correct; keep them.
- **Cross-site POSTs refused outright.** A missing `Origin` header is not a free pass: `SameSite=Lax` treats every sibling `*.catspotters.com` host as same-site, so this check is what stands between a compromised subdomain and these endpoints.
- **The dashboard hand-off** is the Ed25519 JWS of §2.4, minted on demand when the "Cat Spotters dashboard" link is followed, sixty-second life, single use.
- **A separate key from `SIGNING_KEY`.** The workspace currently shares `SIGNING_KEY` with the public site worker. The hand-off key pair is new and unrelated, and separating `SIGNING_KEY` between the two Workers is its own ticket.
- **Google sign-in (when added):** exchange the code, read the **verified** email claim, and **only then** check the allow-list. Google authenticating somebody is not authorising them. Redirect URI registered exactly; client id and secret as platform secrets.

### 8.2 The dashboard session — Express

- Hand-off validated exactly as §2.4 lists, then a **`__Host-cs_team` cookie** on `team.catspotters.com`: signed, `HttpOnly`, `Secure`, `SameSite=Lax`, thirty days, carrying person id and `session_version`.
- **Every request re-checks** the person against `people` and compares `session_version`. Removal and forced sign-out both take effect at the next request.
- **CORS:** replace `app.use(cors())` with an explicit allow-list and `credentials: true`. The dashboard itself is same-origin and needs none of it; the mobile app's origins are enumerated.
- **Rate limiting:** a Postgres-backed store (§2.6), with the deployment pinned to one instance until it lands.

### 8.3 Mail

- Three keys, three purposes, two sending domains (§2.10), each in the right platform's secret store (§2.11).
- **One send function**, purpose-tagged, with the priority budget of §2.10. One place where failures are logged, one place to swap providers.
- **A failed send is logged loudly and never silently swallowed.** A sign-in endpoint that says "sent!" when nothing was sent is worse than one that admits the problem.
- **Welfare and issue mail is queued, not sent inline**, with retry and backoff. **The queue row is the source of truth; the email is a notification about it.** This is the best decision in v1.0's technical section and it is unchanged.
- **`Reply-To: admin@syroscats.com`** on every reporter-facing message. A reporter *will* reply, with exactly the update that matters — "it's moved, it's outside the bakery now" — and without this it goes to a `hello@` mailbox that SYC-30 is the ticket for descoping.
- **Persistent send failure raises a dashboard banner.** It does not page anybody, for the same reason nothing else does (F1).
- Reporter-supplied text is escaped in the HTML part of every message, and user input is never interpolated into headers.
- **User-supplied cat names in outbound charity mail** pass the moderation filter that exists (`routes/cats.moderation.test.ts`), whose threshold was tuned for in-app display, not for a charity's outbound mail. Re-check the threshold for this path.

### 8.4 Data

New tables owned by this spec, alongside the existing schema:

- **`people`** (Postgres) — id, email (unique, lower-cased, role-address deny-list enforced), name, session_version, added_at, added_by.
- **`person_scopes`** (Postgres) — person_id, role, colony_id (nullable). One row per role-and-scope pair (§7.3).
- **`welfare_reports`** (Postgres) — id, kind (`welfare` | `content`), severity (`attention` | `urgent`), is_litter, report_photo_id (→ `welfare_report_photos`, **never** `photos` — §4.3), lat/lng, note, reporter_language, reporter_contact_id (nullable — the address itself is held by `email-capture.md`'s verified-contact model, not on this row), reporter_device, cat_id (nullable), state, state_changed_at, state_changed_by, team_note, is_draft, created_at.
- **`report_state_events`** (Postgres) — report_id, from_state, to_state, person_id, at, plus which reporter message was sent, so duplicate suppression (§5.3h) is a query and not a guess.
- **`welfare_report_photos`** (Postgres) — id, public_id (unguessable, §4.3), bytes, mime, created_at. Deliberately **not** rows in `photos`: that is what keeps the public photo route unable to serve them, with no column and no default involved. Owned jointly with `hosting-and-photo-storage.md` §6.6, which owns the storage question for both tables.
- **`mail_deliveries`** (Postgres) — message id, purpose, recipient hash, state (queued/accepted/delivered/bounced/complained/suppressed), updated_at. Fed by the Resend webhook; read by the queue's delivery column.
- **`signin_tokens`** and **`admins`** stay in **D1**, on the Worker side. `admins` holds at most the one documented break-glass row (§2.7).

**Explicitly not created:** `record_changes`, and a second `colonies` or `feeding_sites` — both of those are the data spine's (`cat-record-data-spine.md` §10.5). `person_scopes.colony_id` references `colonies.id` there. See the ownership table at the top and §3.2/§3.3.

**A welfare report also becomes an observation, and the kinds now exist.** A report is the strongest single statement anybody ever makes about a cat's condition, and without this the record the data spine exists to build would not contain it. `cat-record-data-spine.md` §10.1 defines **`welfare_report`** (written when a report against a known cat is filed) and **`welfare_outcome`** (written when the team moves it to a closing state); both are written by the same transaction that writes and closes the queue row, so the queue stays the team's workflow and the observation becomes the cat's history. A report not tied to a cat writes no observation until it is.

Two consequences that belong on this side of the boundary: **the reporter's free text stays on the queue row** and is not copied into the observation, so it keeps the 90-day/3-year retention in §8.5 rather than acquiring a second lifetime; and **neither kind moves a derived status** — "thin and limping" is a report, not a life status, and only a team member setting one changes it (§3.3).

### 8.5 Privacy

- **Retention, stated rather than implied.** Reports and their photos are kept for **three years** — they are the cat's history, and the charity's case for funding. A **reporter's email address on a report is kept for 90 days after the report reaches a final state**, then deleted, because its purpose is finished; an address held under the separate news consent follows `email-capture.md`'s rule instead. An unverified address is deleted after **7 days**. Written into the privacy policy `email-capture.md` owns.
- **The one-click delete link in every message** needs a real mechanism, not a URL: a signed, expiring token, scoped to one address, rate-limited, revealing nothing about whether an address exists. Done casually it becomes an enumeration surface of its own. It is the same mechanism `email-capture.md` specifies; this spec uses it and does not invent a second one.
- **Exact cat and feeding-site locations are visible to the team.** Public precision is the data spine's rule, including for public feeding sites, and this spec does not set a second one.
- **Team notes are never shown publicly**, and never reach the reporter.
- **Syros Cats is the data controller** (D6). Resend is a processor: a DPA, a transfer mechanism and provider-side deletion **verified by test rather than assumed** are `email-capture.md`'s to record, and this spec's mail paths are inside that scope.
- **A welfare report is a new category of personal data** and the privacy policy must say so before store submission: a precise location plus a photograph that may contain bystanders, vehicles and property, emailed to a third-party mailbox and stored by a third-party mail provider.
- **`threat_model.md` is stale** on two points this spec touches — it says no rate limiting exists (it does: `middlewares/rateLimit.ts`) and that device ids are unverified (they are secret-bound, trust-on-first-use). One combined refresh across all four specs, before the privacy policy is written.

### 8.6 Tests that must exist

Named here so they appear in the implementation plan rather than being remembered afterwards. This repository already tests routes properly with vitest.

1. An address **not** on the list produces a byte-identical response, and the response time distributions of the two branches overlap.
2. The allow-list is checked **before** a token is minted, and a failed allow-list call fails closed.
3. A **GET** on `/auth?t=` does **not** consume the token; a subsequent POST succeeds.
4. A second POST of the same token within 60 seconds returns the same session; after that, it is refused.
5. Each rate limit in §2.6 is enforced, and enforced across two processes.
6. A hand-off token fails validation on each of: bad signature, wrong `aud`, wrong `iss`, expired, replayed `jti`, unknown `sub`, stale `sv` — and each produces the identical 401.
7. The pinned algorithm cannot be overridden by the token's own `alg` header.
8. A report submitted while every mail path fails still writes a queue row.
9. No reporter-facing message contains an internal state name.
10. A role address is refused by `people` insert.
11. `session_version` bump invalidates an existing dashboard cookie at the next request.
12. A welfare-report photo is **not** served by the public photo route, and the team route refuses it without a valid dashboard session.
13. `POST /api/reports` puts its photo through `validatePhotoBase64`: a JPEG uploaded with a GPS block comes back with none (the assertion `hosting-and-photo-storage.md` §6.4 owns, applied to this second entrance).

---

## 9. Risks and open questions

### 9.1 Risks

| # | Risk | Why it matters | What we do |
|---|---|---|---|
| **1** | **A report about a genuinely dying cat sits unseen for two days.** | It is the accepted cost of F1, not a bug. The outcome that would damage trust in both directions. | **Accepted deliberately.** The mitigation is the copy, and only the copy: urgent cases are sent to a vet before the report is submitted, on screen and again in the acknowledgement. The copy is therefore a launch blocker and gets tested on real tourists (§5.6). We do **not** add an alarm to feel better about it. Owner: **Samuel** (copy), **Syros Cats** (final wording). |
| **2** | **The capacity messaging lands wrong.** Too soft and people expect a rescue service; too hard and a worried tourist feels told off and never reports again. | This is the whole design. Getting it wrong creates either an unmeetable expectation or a silent island. | Syros Cats review every word. Test on the WhatsApp testers. Serve from configuration so it can be corrected without an app release — with the §5.4 exception. Watch the abandonment rate at the severity step. |
| **3** | **Somebody is hurt following our injured-cat advice.** | Foreseeable, and it falls on a person the app encouraged. | §5.3b leads with **a cage borrowed from a vet and food to lure the cat in**, which keeps hands off the animal altogether — the charity's own method, not one we invented. Handling is the fallback, is labelled as one, is conditioned on "only if you feel safe doing it", and carries the warning that a hurt cat might bite and scratch hard. **Residual, and accepted:** Samuel's 4 September edits removed the "stop if you can't do it safely" paragraph and the line about a bite needing a doctor (§5.4). The liability and insurance check before launch stands. |
| **4** | **Mail transport slips and blocks everything.** Sign-in, welfare reports, issue reports, verification and acknowledgements all sit on it. | A dashboard nobody can sign in to, and reports nobody receives, is a feature that does not exist. | Settle mail before dashboard work starts. Verify with a real send to a real Syros Cats inbox, not a test address. The two-identity split, the priority budget, the suppression list and a written cutover procedure (§2.10). Owner: **Samuel**. |
| **5** | **A sign-in surface is abused into silencing welfare mail.** | The failure chain is: no rate limit → unlimited sends → allowance exhausted → injured-cat mail stops. A security bug that becomes a welfare failure. | §2.6's limits, the identity split, and the priority budget that never sheds welfare or sign-in mail. |
| **6** | **The dashboard is written for one runtime and deployed on another.** | v1.0's technical section assumed Cloudflare Workers throughout; an implementer would hit wildcard CORS, a `__Host-` cookie with no stated origin, and per-process rate limits on day one. | §8 is written against the two real runtimes, and §2.6 names the dashboard's origin — which was a blocking unknown, not a detail. |
| **7** | **A feeding site becomes public by accident.** | It is a list of where to find cats. | Private by default, per-site toggles, no bulk action, attributed. Precision owned by the data spine. |
| **8** | **The photo auto-hide is used to vandalise the catalogue.** | One script, one hidden photo at a time, and volunteers restoring by hand. | **Accepted by Samuel, 28 Sep 2026:** one confirmed report hides pending review. Mitigations in §6: the are-you-sure step, Turnstile, a volume alert and one-tap restore. |

### 9.2 Open questions

| Question | Owner | Notes |
|---|---|---|
| ~~A named list of Syros vets~~ | **Syros Cats** | **Answered.** Three clinics with names, areas, landmarks and verified numbers — §5.7. Note the third is now **Cyclades Vets (George Maragkos)**; it no longer trades under his name alone. |
| ~~Out-of-hours cover: who does somebody call at 9pm in February? (SYC-68)~~ | **Samuel** | **Answered, and the first answer was wrong.** Symviosis and Cyclades Vets both publish after-hours numbers. They sit in the vet list (§5.7); the urgent block no longer mentions them (removed 27 Sep). Whether they are answered is untested; risk accepted by Samuel, 28 Sep 2026. |
| ~~Verified vet entries: addresses, numbers, Google and Apple Maps links, coordinates~~ (§5.7) | **Samuel** | **Populated.** All six numbers verified; plain coordinate map links, no shorteners. **Pins are landmark-anchored to 50–100 m and labelled as such** — fixing them to real doors is a ten-minute job on the island, and does not block. |
| ~~Susan's standard reply~~ | **Syros Cats (Susan)** | **Supplied, and §5.3b line-edited by Samuel on 4 September 2026.** Syros Cats confirm the wording during testing (§5.4). Nothing outstanding. |
| A phone or WhatsApp number for litter reports | **Syros Cats** | No longer affects the in-app copy (§5.3d contact paragraph removed 27 Sep). Would only appear in the acknowledgement email. Ships without one. |
| Which feeding sites may be public | **Syros Cats** | Never blocks — everything is private until they say otherwise. |
| Who else goes on the access list, with what name (SYC-29) | **Syros Cats** | One row each; no role addresses (§2.8). |
| Greek and French translation of every word in §5 | **Fair Shake to translate · a local to confirm** | Blocks the copy's launch. We produce both translations; a local speaker confirms them. Needs a named local reviewer and a date. |
| Should `hello@catspotters.com` also reach the charity (SYC-30) | **Samuel** | No longer on this feature's critical path. Worth asking whether a distribution list beats a forward to one person's mailbox. |
| Do reporters get a status update by push as well as email? | **Samuel** | Would close the loop for the majority who give no address — and, unlike mail, it costs no sending allowance. |
| Separating `SIGNING_KEY` between the workspace and the public site | **Samuel** | Not blocking this feature, since the hand-off uses its own key pair. Still worth closing. |

### 9.3 The cut line, if the window bites

`DEPLOYMENT.md` §D already names the staff dashboard as one of three items that can slip without moving launch, and this spec adds a sign-in, a trust boundary, a dashboard, a public report flow, a mail dependency and copy in three languages inside the store-submission window. So, stated rather than discovered:

1. **Ships first, and works with no dashboard at all:** the report flow, the on-screen confirmation, the safety copy, and the alert email to the shared inbox. This is the whole of the user-visible value.
2. **Ships next:** sign-in, the trust boundary, and the welfare queue.
3. **Slips to hardening if it must:** the feeding-site map and colony naming.

---

## 10. What "done" looks like

- A Syros Cats person who has never seen the app gets from "I have an email address" to "I am looking at the queue" without anybody running a database command — **including when her mail passes through a scanning gateway.**
- Removing somebody from the charity is **one deletion, in one place**, and ends their access to both systems at their next request.
- A worried tourist can report an injured cat in under a minute, and comes away knowing four things: the report is in, **a vet is the fast route because nothing else is fast**, **the vet will lend them a cage and food will get the cat into it**, and nobody is coming.
- **Nobody is told to pick up a frightened, injured cat as the first thing to try.** The cage comes first, every time; hands are the fallback and are marked as one.
- **Nobody comes away believing somebody is standing by**, because nobody is.
- A litter report always says don't move the kittens or bring them anywhere, in the app and in the email; the email also says "talk to Syros Cats first".
- Every report is in two places: the charity's inbox and a queue that remembers — **and the queue row exists even when every email failed.**
- No address ever receives mail from us that has not been confirmed by the person holding it.
- Every feeding site is private until Syros Cats decide otherwise, one at a time.
- A deletion request that arrives by email can be actioned by a volunteer, inside the legal month, without Samuel.
- Nothing here has to be unpicked when cat guardians, volunteers and vets get their own accounts.
