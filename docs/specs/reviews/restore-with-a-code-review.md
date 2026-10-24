# Adversarial review: "Get your spots back with a code" (SYC-664)

Spec: `docs/specs/restore-with-a-code.md` (draft, 24 Oct 2026).
Reviewed against: `api-server/src/routes/keepSafe.ts`, `lib/keepSafe/{service,move,tokens,links,sever}.ts`, `lib/mail/{keepSafeTemplates,outbox}.ts`, `lib/limits.ts`, `middlewares/newDeviceLimit.ts`, `lib/deviceAuth.ts`, `cat-spotter/app/{restore,_layout,get-spots-back}.tsx`, `components/keepSafe/RestoreRequestScreen.tsx`, `components/onboarding/OnboardingFlow.tsx`, `context/DeviceContext.tsx`, `server/prelaunch-page.js`, and `email-capture.md` §8.
Reviewer: adversarial subagent (Opus), 24 Oct 2026. Nothing was run; every claim below is from reading the code at the worktree's HEAD (`f8aebca8`).

Ranked most severe first. Product decisions for Samuel are at the end, in plain English.

---

## Blockers

### B1. "That code has stopped working" tells a stranger the address is kept safe

**Severity:** blocker (breaks the spec's own promise in §4, line 80, and SYC-3's A1 rule that unknown and known addresses look identical).

**Failure scenario.** An attacker types a guessed address (say a classmate's parent's email) on "Get your spots back" and presses "Email me a code". Then types six made-up codes.
- If the address keeps a spotter safe, a restore row bound to the attacker's phone exists. Five wrong tries set its `expires_at` to now (spec line 132), and the sixth try answers **"That code has stopped working. Send another email…"** (line 76).
- If the address is unknown, no row was ever created (`service.ts:440` returns before any insert). There is nothing to count against, so the sixth try (and the seventh, up to the per-phone cap) still answers **"That code isn't right."**

Six requests per address is a cheap, reliable enumeration oracle. The "already used / expired" wording (line 78) has the same shape, though it needs the right code so it matters less. The timing note (line 134) compares "a wrong code and a right code for an unknown address", which isn't the comparison that matters: it is "wrong code on a phone with live rows" vs "wrong code on a phone with none".

**Evidence.** `service.ts:436-440` (no row for unknown addresses); spec lines 74-80, 132, 134.

**Suggested fix.** The server gives **one** refusal for every code failure (wrong, dead after five, expired, used, other phone, no rows at all), padded to a fixed deadline. "Stopped working, send another" becomes an app-side decision: the app counts wrong tries since its last "Email me a code" (it already keeps a waiting flag) and after five shows "Send another email". The per-phone "Too many tries" cap is safe to show, because it is counted the same way whether the address is known or not, provided it is incremented before any row lookup. Add the test: unknown address, seven wrong codes, byte-identical replies and timing to the known-address run.

### B2. Redeem-with-a-code doesn't count tries, and tries aren't atomic

**Severity:** blocker (as written, it allows guessing without limit per row).

**Failure scenario 1: guesses through redeem.** The spec says only "Peek with a code counts a try" (line 132). Redeem "re-checks the code" but nothing says a wrong code at redeem counts. An attacker skips peek and calls `/restore/redeem` with `{code, choice}`. A wrong code there is never counted against the row's five, so the only limits are the per-IP redeem limiter (30/hour, `routes/keepSafe.ts:57-65`) and the per-phone cap, *if* that cap is also wired to redeem (unspecified). The "5 guesses per request" arithmetic in Safeguards 4 is then false.

**Failure scenario 2: parallel guesses.** If the handler reads the rows, compares, then increments `code_attempts`, 50 concurrent peeks from one phone all see `code_attempts < 5` and all get compared. The per-phone shared limiter is atomic (`limits.ts`, insert … on conflict … returning), but it allows 10, so up to 10 guesses per row get through instead of 5, and more if the cap counts only *wrong* codes after the fact.

**Evidence.** Spec lines 111-112, 132-133; `routes/keepSafe.ts:176-211` (redeem has no code concept today); `move.ts:233-244` (the only conditional write is on spend).

**Suggested fix.** State that **every** code comparison (peek, redeem, and anything else that takes a code) first does `update mail_tokens set code_attempts = code_attempts + 1 where device_id = $caller and purpose='restore' and used_at is null and expires_at > now() and code_attempts < 5 returning …`. It only compares against rows that update returned, then rolls a right code's increment back (or doesn't count it). Do it in one transaction with the rows locked `for update`. Consume the per-phone cap bucket *before* the comparison, and refund it on a right code. Add tests: wrong code at redeem counts; 20 parallel wrong peeks leave `code_attempts = 5` and get no more than 5 comparisons.

The simpler alternative (recommended, see S4) is to make the code do exactly one thing: a code exchange that returns a short-lived handle. Then peek and redeem never see codes, and there is only one place to count.

---

## Should-fix

### S1. The guessing arithmetic in Safeguards 4 is wrong, and Decision A rests on it

**Severity:** should-fix (Samuel is being asked to decide on numbers that understate the worst case).

**What the code actually allows:**
- **Per-phone caps don't bind an attacker.** Any request with a fresh id and secret is bound on first use (`deviceAuth.ts:137-167`), limited only to **20 new phones per IP per hour** (`newDeviceLimit.ts:33`). So "10 wrong codes an hour from one phone" (Safeguard 3) and "3 requests per address per phone per 15 minutes" cost an attacker nothing beyond the per-IP limits. The spec's sentence "So one phone can't keep requesting fresh codes for someone's address and guessing" is true but not a defence.
- **Per network:** `fromIp > 20` with the current request counted (`service.ts:430-434`), so 20 issued codes an hour → 100 guesses. That matches the spec. (IPv6 counts by /56: `limits.ts:71-73` applies to the shared limiters, but `requestRestore`'s own per-IP count uses `ipFingerprint(req.ip)`, which is `HMAC("ip:" + raw address)` with no grouping (`service.ts:409, 430-434`; `fingerprint.ts:62-63`, read and confirmed). An IPv6 client can pick a fresh address from its /56 or /64 for every request, so for IPv6 attackers the "20 per network per hour" limit on restore requests doesn't exist. Only the global ceiling remains. The same applies to `addKeepSafeAddress`'s per-IP count (`service.ts:228-232`). This predates the spec, but the spec's odds depend on it. Whether real clients reach the server over IPv6 through Replit's proxy chain is **unchecked**.)
- **Across networks:** the only hard bound is the global ceiling of 200 issued links a day (`service.ts:445-449`, `>=`, so exactly 200). An attacker with a few dozen IPs (cheap residential proxies) can spend all 200 on **one** address: 1,000 guesses a day, **about 1 in 1,000 per day**, about 3% over a month of sustained effort. The spec's "1 in 10,000 an hour" is the per-network figure. The headline should be the per-address worst case.
- **Side effects of that attack:** every other family's restore is switched off for the day (the ceiling is global), and the target receives about 200 emails a day. The attack is loud, but nothing currently alerts anyone: the ceiling hit is only an `error` log line (`service.ts:449`).
- **Peek's own limiter (30/IP/hour) is not the bound.** A phone holding live rows for several addresses tests every one of them with each guess (spec line 131). So it's the request limit, not the peek limit, that caps throughput. That's fine, but say so, because a reader will assume the 30/hour peek limit helps.

**Suggested fix.** Rewrite Safeguards 4 with the three numbers (per network per hour, per address per day worst case, whole service per day). Group the address with `addressKey()` before `ipFingerprint()` in `requestRestore` and `addKeepSafeAddress` (a small fix that stands on its own, worth its own ticket). Add an alert (push or email to the team) when the restore ceiling is hit. Feed the corrected numbers into Decision A (see P1).

### S2. A stranger's requests kill the family's code, and the newest email holds a code that doesn't work

**Severity:** should-fix.

**Failure scenario.** At most 3 live restore rows **per address**, oldest expired first (`service.ts:451-461`), whichever phone asked. A child waits on "Check your email" in the icon app. A stranger (or a sibling on another phone, or the same family asking from Safari as well) requests for the same address 3 times, all within limits. The child's row is expired. The inbox now has 4 emails. The newest 3 hold codes bound to *other* phones, and the oldest code is dead. Whatever the child types, the answer is "That code isn't right", and every try burns the child's per-phone cap. With links this was a nuisance (Decision 12 made any link work anywhere). With phone-bound codes it's a lockout that a stranger can keep up indefinitely at 3 requests per 15 minutes. That is exactly what Samuel's 8 Oct decision ("counted per asking phone… a shared count let a stranger keep a family from ever getting their own link") was meant to prevent.

The same confusion arises innocently: ask in Safari, ask again in the icon app, and two emails carry two codes for two different "phones".

**Evidence.** `service.ts:35-39, 44-45, 451-461`; spec lines 100, 110.

**Suggested fix.** Count the live-link cap per (address, asking phone), not per address. Codes are phone-bound, so other phones' rows add nothing to an attacker's odds on this phone. Put the request time in the email ("You asked at 14:32") so a person with several emails can tell which is theirs, and tell the app screen to "use the newest email you asked for on this phone". See P3. It changes link behaviour as well, so it's Samuel's call.

### S3. "Read me the code" phishing: binding the code to the asking phone doesn't help

**Severity:** should-fix (the most common real-world attack on emailed codes, and the audience includes children).

**Failure scenario.** A classmate types a child's parent's address into *their own* phone and presses "Email me a code". The code is bound to the classmate's phone. The classmate messages: "I sent a code to your mum's email by mistake, what is it?" Six digits are trivially read aloud or screenshotted, far more easily than a link is forwarded. Safeguard 1 ("someone who sees the code over a shoulder or in a forwarded email can't type it into their own phone") is true for bystanders but false for the requester, who is the attacker here.

The email's own wording works against itself. "Never share this code… even a friend" (line 35) contradicts the legitimate parent-to-child flow ("Under 15? Ask a parent to add theirs", `email-capture.md` §8.3): the parent reads the code and tells the child.

**Evidence.** Spec lines 35, 110; `keepSafeTemplates.ts:72-89`.

**Suggested fix.** Email words that name the attack: *"Only type this code into Cat Spotters yourself, or give it to your own child for their phone. If anyone else asks you for this code, they are trying to take someone's spots. Don't give it to them."* Add the request time (S2). See P2.

### S4. The code path depends on things that only exist with a raw token: choice ids, replay, the redeem write

**Severity:** should-fix (an implementer will improvise, and the replay is load-bearing for "Delete Nikos").

- `choiceId(raw, …)` hashes `hashToken(raw)` (`move.ts:93-95`), and `matchesPick` uses the raw token (`move.ts:144-147`). With a code the client never has the raw token. This works only if the server derives choice ids from the stored `token_hash`, which the spec doesn't say.
- **Replay.** `replayAfterMove` finds the row by `token_hash` and runs **before** device auth (`routes/keepSafe.ts:188-195`). After "Delete Nikos", the app retries redeem after 1.5 s (`restore.tsx:221-230`). The caller's id now answers 410, so if replay doesn't find the row, the phone gets 410 and wipes, and "the spotter coming back would be lost" (the code's own comment). With a code, replay must look up `used_at > now()-60s and code_hash = hmac(code) and restored credential's secret_hash = caller's secret`, **not** by `device_id`, which `severKeepSafe` has already swapped to the `deleted:` key (`sever.ts`). "The 60-second replay accepts a code too" (line 132) doesn't say any of this.
- **Redeem** spends with `where token_hash = hashToken(raw)` (`move.ts:233-238`). The code path must spend by row identity *and* re-assert `device_id = caller` (the "phone that asked" rule). Test that a right code redeemed from a different phone is refused at redeem, not just at peek.

**Suggested fix (recommended).** Add one endpoint, `POST /api/restore/code`: a right code (counted per B2, device-bound) returns a fresh 256-bit **handle** stored as a second hash on the same row, valid until the row's own expiry. The app then uses the existing peek, redeem and replay with that handle in place of the token, unchanged. Codes are counted and compared in one place, choice ids and replay work as today, and "using either uses up both" still holds because it's one row. If the spec keeps codes on peek and redeem instead, it must spell out all three points above.

### S5. The "waiting for a code" screen won't come back after a reload, as the app is built today

**Severity:** should-fix (it is the exact failure this ticket exists to fix: an iPhone home-screen app reloading after a trip to Mail).

**Failure scenario.** On a fresh phone, "Get your spots back" isn't a route. It is internal state inside `OnboardingFlow` (`useState('welcome')`, `OnboardingFlow.tsx:27-33`). A reload always lands on Welcome, and `_layout.tsx:128-131` sends any phone without a name to `OnboardingFlow`. For a spotter asking from Settings, it is the `/get-spots-back` route, but a cold start opens `/`. The spec says "it opens straight back onto 'Check your email'" (line 57) but only names `RestoreRequestScreen` (line 135), which never mounts after a reload.

**Suggested fix.** Read the flag where the decision is made. `OnboardingFlow` starts at `'restore'` (waiting state) when the flag is live, and `OnboardingGate` sends a named phone with a live flag to `/get-spots-back`. Clear the flag on `startAgain`, `resetIdentity` and `adoptRestoredIdentity` (`DeviceContext.tsx:435-495`), because a new device id makes the code unusable. After a reload the address is gone by design, so "send another" must go back to the address box. Say so. Test: reload in each of the two entry points, then after 15 minutes, then after "Delete my data".

### S6. The test site's password page still sits between Safari and the advice

**Severity:** should-fix (every current user is a tester on the password-gated site).

**Failure scenario.** The spec's §5 fix is a third answer on the link page. But on the test site, Safari has never been given the pre-launch password, so tapping the link shows the password page (`prelaunch-page.js:88-98`), not the link page. The home-screen user never sees "go back to the icon and type the code", and is stuck at the same dead end the problem section describes (line 14).

**Suggested fix.** On `/restore#t=…`, the password page adds one line: *"Use Cat Spotters from an icon on your home screen? Go back to it and type the 6-digit code from the email."* Lead the email with the code (already planned) so most people never tap the link.

### S7. There's no way in for someone who already has a code, and some requests silently send nothing

**Severity:** should-fix.

- The code box appears only after "Email me a code" on this phone. A person whose waiting flag is gone (it was never written, the app was killed during the request, they started on Safari then opened the icon, or they reopened the app on minute 14 having closed it) has a valid email in hand and no box to type it into. Recommend a small "I already have a code" link on the request screen. It only helps on the phone that asked, but it costs nothing.
- **Safari, then the icon.** The code is bound to Safari's id. Typed into the icon app it gives "That code isn't right", which is wrong and makes people retype and burn tries. The single refusal (B1) should read "That code isn't right for this phone. Use the code from the email you asked for here." It must not reveal anything, so the wording is the same for every case.
- **The fourth request in 15 minutes is silently dropped** (`service.ts:429`, `fromThisPhone > 3`), so "send another" can produce no email at all. The app can count its own requests and say "You've asked three times. Wait 15 minutes, then try again." That reveals nothing, because it's the phone's own count.

### S8. iPhone "From Mail" autofill is unchecked, and the space in the code may defeat it

**Severity:** should-fix (the spec labels it unchecked, correctly. This adds a reason it may fail even in Safari).

iOS detects verification codes in Mail heuristically. A code broken by a space ("482 913") is less likely to be recognised than a contiguous "482913" next to the word "code". Recommend the email show the code contiguously, in large monospace with letter-spacing (CSS, not a space character), plus "Your Cat Spotters code is 482913" in the plain-text part. Test on a real iPhone in both Safari and the icon app before claiming either. The box must be a single `<input>` (not six boxes) for autofill to fill it.

---

## Nits

- **N1. "Expired or used" contradicts the live-only lookup.** The lookup reads only live rows (line 131), so an old code can't be told from a wrong one, and the "That code has expired…" message (line 78) can never fire. After B1 it's one message anyway. Remove line 78's distinction.
- **N2. Per-phone cap keyed by device id must be consumed after device auth.** If it's an Express middleware keyed on `body.deviceId` (like `peekLimiter`, `routes/keepSafe.ts:160`), anyone can burn a phone's hour by sending its id without a secret. Device ids are meant to be unguessable, so this is a nit, but write "after `verifyDeviceSecret`".
- **N3. HMAC domain separation.** Write the code hash as `HMAC(key, "restore_code:" + token_hash + ":" + code)`. Identical codes on different rows then get different hashes (no equality pattern in a DB copy), and the input can't collide with other fingerprints made under the same key.
- **N4. Auto-check plus button.** Checking at the sixth digit *and* a button lets a quick tap after autofill send the same wrong code twice, burning two of five tries. Disable the button while a check is in flight and don't re-send an unchanged code.
- **N5. A killed row's email can still go out.** The outbox decides from the payload's `expiresAt` (`outbox.ts:517-519`), not the row. An email still retrying after five wrong tries arrives with a dead code. That's harmless, but the "wrong code" handling should expect it.
- **N6. "The spots move straight away" (line 63) differs from the link.** The link on the asking phone always shows the `choose` button naming the spotter (`restore.tsx:181-183`). Auto-moving after a code means the person never sees *which* spotter came back before the reload. Consider showing "Welcome back, {name}" after the reload instead, which keeps the one-tap flow.
- **N7. Shared mobile IPs.** Greek carriers use carrier-grade NAT. 20 restore requests, 20 new phones and 30 peeks per IP per hour are shared by everyone on that address. This predates the spec, but codes make peeks more frequent (typos). Watch the `restore: no link sent` / `per_ip` log rate after launch.
- **N8. Timing wording (line 134)** should read: "every code answer is padded to the same deadline, whether this phone has live rows or not."
- **N9. Reload mid-move.** If the icon app reloads after redeem commits but before `adoptRestoredIdentity` writes storage, the phone keeps a retired id (`move.ts:279-283`) and no code or token to replay with. The link flow has the same gap, and it's rare, but the code flow is the one used in a reload-prone app. Consider persisting "move in progress for row X" until adoption.

## Missing tests (add to the spec's list)

1. Unknown address vs known address: seven wrong codes give identical bodies, status codes and timing (B1).
2. A wrong code at **redeem** counts against the five. 20 parallel wrong tries leave exactly 5 counted (B2).
3. A right code redeemed from another phone is refused at redeem (S4).
4. "Delete Nikos" via a code, with the first response dropped: the 1.5 s retry is answered by replay, and the phone ends up as the restored spotter, not wiped (S4).
5. A stranger's three requests don't expire this phone's code (S2, if adopted).
6. Reload with a live flag in **both** entry points (onboarding and Settings), and the flag cleared by "Delete my data", "start again" and a successful restore (S5).
7. A phone with live rows for two addresses: the right code for either works, and a wrong code counts against both.
8. Per-phone cap: requests with someone else's device id and no secret don't consume that phone's cap (N2).
9. The prelaunch page on `/restore#t=` shows the code line (S6).

---

## Decisions for Samuel (plain English)

### P1. Is a six-digit code strong enough? (Decision A, with corrected numbers)

**The question.** How hard should it be for a stranger to guess their way into a child's spots?

**What the spec gets wrong.** It says a stranger's odds are "about 1 in 10,000 an hour". That's for one internet connection. Someone determined, using many connections, can make about 1,000 guesses a day at one family, about **1 in 1,000 a day**, or roughly a 3% chance over a month. While doing it they also block every other family from getting spots back that day, and the target family gets about 200 emails a day. Nobody on the team is told when this happens.

**Options.**
1. **Six digits, plus an alert to the team when the daily limit is hit.** *Benefit:* familiar and easy for children. Any real attack is noticed within the day, and someone can act. *Risk:* the odds above stand until someone acts. *Experience:* unchanged for families.
2. **Eight digits.** *Benefit:* 100 times harder to guess (about 1 in 100,000 a day at worst), same number keyboard, no lockouts. *Risk:* two more digits to carry between apps, slightly more typos. *Experience:* "Your code: 4829 1376". Still easy.
3. **Six digits plus a per-address lock** (as in the spec's third option). *Benefit:* caps guesses per family. *Risk:* a stranger can lock a family out of codes on purpose, and for home-screen users the link doesn't work, so they'd be fully locked out.

**Recommendation: option 1 now, with the alert built in this ticket.** The prize is a cat-spotting collection and the attack is loud. If an alert ever fires for real, moving to eight digits is a one-line change. Option 3 is the worst for home-screen families, the very people this ticket is for.

### P2. What should the email say about sharing the code?

**The question.** Parents legitimately read the code to their child. Scammers also ask for codes ("I sent you a code by mistake, what is it?"), and the code works for whoever asked for it.

**Options.**
1. **"Never share this code with anyone, even a friend"** (as drafted). *Benefit:* simple. *Risk:* parents ignore it because sharing with their child is the whole point, so it teaches people to ignore the warning.
2. **"Only type this into Cat Spotters yourself, or give it to your own child for their phone. If anyone else asks you for it, they're trying to take someone's spots."** *Benefit:* matches how families actually use it, and names the trick. *Risk:* slightly longer.

**Recommendation: option 2,** plus the time of the request in the email ("You asked at 14:32") so people can spot a request they didn't make.

### P3. Should one person's request be able to cancel another phone's code?

**The question.** Today, a fourth request for the same address cancels the oldest live link, whichever phone asked. With codes tied to a phone, a stranger, or the family asking again from a second browser, can quietly kill the code the child is about to type. The child then sees "That code isn't right".

**Options.**
1. **Keep "3 live per address".** *Benefit:* no change. *Risk:* a stranger can keep a home-screen family from ever getting their spots back. That's the problem the 8 Oct "count per phone" decision was meant to solve.
2. **"3 live per address *per phone*".** *Benefit:* nobody else's request can cancel yours. Guessing odds don't change, because a code only works on the phone that asked. *Risk:* an address can have more live links at once. Each is still single-use, 15 minutes, and unguessable as a link. Links opened in a browser (Decision 12) behave the same as now.

**Recommendation: option 2.**
