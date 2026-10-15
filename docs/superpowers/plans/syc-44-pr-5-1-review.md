# SYC-44 PR 5.1: adversarial review (POST /api/issues and the one-report hide)

An independent reviewer on **Opus** reviewed this PR in its own worktree, which it shared with no one. It reviewed `claude/syc-44-pr-5-1` at `b90a16bf`, against origin/main `e428b159`. Its probe commits stayed in its own worktree and were never pushed. The reviewer's report follows, lightly edited for layout. **How each finding was handled** is at the end.

## Verdict

**Do not merge yet: one blocker.** The safety rules hold up well. The reviewer could not:
- hide a 6th photo in one Athens day;
- hide a photo the team has ever restored;
- hide anything without a good token;
- hide another cat's photo;
- get a reporter's details out of a reply, a log line or the email.

The rule order matches the plan. `hidden` is read back from the row, and a repeat send gets the stored answer. Mutation probes show the key tests go red when the code is broken.

**The blocker is about the server staying up, not about privacy.** About a dozen hide-type reports arriving at once after a restart lock up the server's whole database pool, permanently. The reviewer reproduced it twice. The rest are smaller:
- four ways a sender can cause a 500;
- the upgrade path answers 200 when our Turnstile key is broken (it should be 503);
- the unchecked fence gets used up by sends that save nothing;
- the production clock path of the brake has no test;
- a design gap: the upgrade case is close to unreachable for the common case it was built for.

## Findings

| # | Severity | Status | Where | What happens | Recommended fix |
|---|---|---|---|---|---|
| 1 | **blocker** | CONFIRMED | `lib/issues/hide.ts` (the brake lock, then the address limits); `lib/limits.ts` `saltFor`; `lib/db` pool | **Concurrent hide reports lock up the pool for good.** Inside the report transaction, while it holds the brake's advisory lock, `consume()` calls `saltFor()`, which runs on the pool. On a cache miss it needs a **second** connection. The sliding day bucket reads yesterday's salt, and that salt is never cached after a restart. The other reports each hold a connection while they wait on the advisory lock. The pool is 10, with no connection timeout and no lock timeout, so nobody can move. The probe sent 12 concurrent `photo_private` reports through a fresh app instance: 9 sessions waited on the advisory lock, and the holder sat "idle in transaction". Nothing finished in 10 s. The control run, with warm salts, passes. The same miss can happen at UTC midnight | Work out every salt the transaction needs **before** it opens. As a second line of defence, add a connection timeout and a `lock_timeout` on the brake lock (failing closed). Keep the probe as a regression test |
| 2 | major (design) | CONFIRMED on the server; the app side is PLAUSIBLE | `routes/issues.ts` (the reply's shape; the courtesy check) | **The upgrade case only works if the first reply was lost.** An unchecked first send gets a normal `201 {publicId, hidden:false}`, so the app treats the report as sent and never resends that `clientRef`. If the reporter tries again (a new `clientRef`) with a good token, the courtesy check answers with the old unchecked report (`200 hidden:false`). For 24 hours that phone can't hide the photo | A decision for Samuel: (a) the reply says `checked:false`, and the app resends later with the same `clientRef`; or (b) the server upgrades an upgradeable courtesy match when the new send has a good token. The reviewer recommends (b) |
| 3 | minor | CONFIRMED | `routes/issues.ts` `catId` | `catId: 2147483648` gives a **500**, with no token and no limit counted | `.max(2147483647)` |
| 4 | minor | CONFIRMED | `routes/issues.ts` body schema | A NUL character in `clientRef` or `photoPublicId` gives a **500** before any token or limit. A NUL in `note` gives a **500** after the limits have been counted. Postgres refuses `0x00`. The logs stay clean | Refuse `\u0000` in every string field. Ideally do this app-wide |
| 5 | minor | CONFIRMED | `routes/issues.ts` `upgrade()` | On the upgrade path, our key being wrong (`not_configured`) answers **200 with the stored answer** instead of **503**. The app then counts the report as sent, and the upgrade chance is gone | `not_configured` → 503 as on a first send. Consider `unreachable` → 503 too |
| 6 | minor | CONFIRMED | `routes/issues.ts` token step vs steps 6–7 | The unchecked fence (3 an hour, **shared with the cat-in-trouble form**) is taken before the cat and photo checks. Three unchecked sends at an unknown cat (all 404, nothing saved) make a real 4th a **429**. During an outage, that can block a real hurt-cat report from the same address for an hour | Take the unchecked allowance last, just before the insert |
| 7 | minor (test gap) | CONFIRMED | `lib/issues/hide.ts` `nowSql()` | Every brake test pins the clock, so production's `clock_timestamp()` branch never runs in a test. Mutant: stamp production hides 30 days in the past, which turns the brake off for good. **All 56 tests stayed green** | Add a brake test on the real clock |
| 8 | nit | PLAUSIBLE | `routes/issues.ts` same-`clientRef` race; T5-8 | With real Cloudflare, two sends of one `clientRef` carry the same single-use token, so the slower one usually gets **428**, not the winner's row. The fake siteverify passes every token. No harm: the app retries and gets the stored answer | Note it in the test, or make the fake refuse a reused token |
| 9 | nit | CONFIRMED by reading | `lib/issues/hide.ts` hour bucket | The 5-an-hour hide limit is a fixed window, so one address can make 10 hides in 2 minutes across an hour boundary. Harmless while the brake is 5 a day | Make it sliding, or document it |
| 10 | nit | PLAUSIBLE; existed before this PR | `app.ts` (`trust proxy` 4) | With fewer than 4 real proxy hops, a sender could set `req.ip` through `X-Forwarded-For`. The brake still caps the damage at 5 a day. This is SYC-229's job | Confirm the hop count under SYC-229 before the pre-launch pass comes off |

**Things the reviewer checked that hold:**
- **Rule order** is exactly the plan's. Outside the transaction: body/device → duplicate → courtesy → attempts → token → 20 an hour → cat/photo. Inside it: already hidden → unchecked → restored → brake → address limits.
- **`hidden`** always comes from the stored row: on a first send, a repeat send, a courtesy match and an upgrade alike.
- **The same-`clientRef` race:** `on conflict do nothing` on (device, kind, clientRef), and the loser reads the winner's row. The old (device, clientRef) key is gone (0026), so there is no 500 there.
- **The content-row checks** are enforced by the database, and T5-1 asserts them.
- **The T4-0 allowlist entries are true.**
- **The hide log is append-only**, so deleting a photo can't lower the brake count.

## The six missions

1. **Hide a 6th photo in one Athens day: could not.**
   - One advisory lock covers every report-hide.
   - Under READ COMMITTED, the count takes a new snapshot after the lock is granted.
   - `at` is stamped after the count, under the same lock.
   - The Athens midnight is worked out in SQL, and is right across 25 Oct 2026.
   - The upgrade path goes through the same `decide()`.

   Finding 1 can lock everything up, but it never lets a 6th hide through.
2. **Hide a photo the team ever restored: could not.** Any `restore` row is checked under the photo-row lock, in both transactions.
3. **Hide without a valid token: could not.**
   - Off and observe modes never hide.
   - Cloudflare unreachable never hides.
   - The upgrade needs enforce mode and an `ok` verdict.
   - Duplicate and courtesy sends write nothing.
   - A token is bound to its `clientRef` through cdata.
4. **Hide another cat's photo: could not.** The photo must be the cat's main photo or on one of its resolved sightings, and a trigger refuses any move of a sighting off "resolved".
5. **Exceed the address limits: could not get past any limit.** There were, however:
   - 500s (findings 1, 3 and 4);
   - fence exhaustion (finding 6);
   - the fixed-hour burst (finding 9).
6. **Leak reporter details: could not.**
   - Replies are exactly `{publicId, hidden}`.
   - Log lines carry no device id, note or address.
   - 500s go through `safeError`.
   - The row stores no address, and the counters store hashed /56 keys.
   - The alert payload is `{kind:"alert"}`.

## Test runs (the reviewer's real runner output)

- PR tests on a clean tree: `Tests  59 passed (59)`.
- Mutants:
  - no brake lock: `Tests  1 failed | 54 skipped (55)` (caught);
  - hide limits outside the transaction: `Tests  1 failed | 2 passed | 52 skipped (55)` (caught);
  - `hidden` from the reason: `Tests  3 failed | 1 passed | 51 skipped (55)` (caught);
  - a rolling 24 hours: `Tests  1 failed | 2 passed | 52 skipped (55)` (caught);
  - production clock stamped 30 days back: `Tests  56 passed (56)`. **Not caught** (finding 7).
- Probes for findings 2–6: `Tests  7 failed | 60 passed (67)`. The 7 failures are the probes proving the findings.
- Pool probe, cold salt cache: `Tests  1 failed (1)`, outcome `{"done":false}`, with 9 advisory waits plus 1 idle in transaction. With warm salts: `Tests  1 passed (1)`.

---

## How each finding was handled

_Filled in below once the fixes landed._
