# Adversarial review: username claim speed-up (Replit commit 6f9dccf)

Checkpoint: DONE. Code read, tests run, mutation experiments run and reverted, component repros written and run, typecheck run, findings written, verdict and real-network plan written. Nothing left.

- Reviewed: the code as it stands on origin/main at `d2768cc` (5 Oct 2026). Intent taken from `git show 6f9dccf`.
- Later commits touched `app.ts`, `profiles.ts`, `i18n.ts` and `DeviceContext.tsx` (proxy trust, pre-launch gate, logging, staff sign-in). None changed the username-claim logic. The middleware order in `app.ts` is unchanged by 6f9dccf: it only changed the request-log serializer.
- Reviewer: independent Claude adversarial review, own worktree, branch `review/username-claim`. No fixes made.

## In plain English

The speed-up works in the normal case. On a good connection, a spotter picks a name and lands on Home about as fast as the server can answer. The server side is solid: names are unique regardless of capitals, offensive names are refused, and only the phone that owns an account can read or change its name.

The weak spots are all about **bad connections**, which is exactly what the island has:

1. If the connection hangs (on Android it can hang for ever) and the retry then gets a clear "no" (for example, someone else just took the name), the spotter is **locked on the name screen**. They can't edit the name, they can't go back, and the only button left retries a name that will always fail. Only force-quitting the app gets them out.
2. The "is this name free?" check gives up after 5 seconds. **Continue stays greyed out until that check succeeds**, so on a slow first request (server waking up, weak signal) spotters can't continue, and the message tells them to try another name, which will fail the same way.
3. If a slow claim fails late, the screen unlocks without checking whether the name was actually saved. The spotter can then pick a second name and **end up with one name on their phone and a different one on the leaderboard**.

None of these is likely on a good 4G connection. All three get more likely on 3G, at the port, or in the hills, and the first two can stop a new spotter finishing onboarding.

## Evidence base

| Check | Result |
|---|---|
| `artifacts/cat-spotter` vitest, full suite | 64 files, 652 tests passed |
| `artifacts/api-server` vitest, full suite (local Postgres 16, throwaway DB) | 59 files, 627 tests passed |
| `lib/usernameClaim.test.ts` | 7/7 passed |
| `profiles.usernames.test.ts` | 18/18 passed |
| CI typecheck scope (`typecheck:libs`, cat-spotter, api-server) | passes |
| Root `pnpm run typecheck` | fails only in `artifacts/mockup-sandbox` (duplicate `@types/react` ref types). Unrelated to this commit and not in CI |
| Orval codegen re-run from `openapi.yaml` | no diff, so the generated clients match the spec |
| i18n: `usernameCheckFailed`, `usernameClaiming`, `usernameClaimUncertain`, `usernameRetryClaim` | present in all three languages (en, el, fr) |
| Component repros (`docs/reviews/username-claim-repro.test.tsx.txt`, run against the real `LanguageUsernameStep`, then removed from the tree) | R1, R2 and R3 all reproduce (3/3 passing assertions of the bad behaviour) |

### Mutation experiments (all reverted; `cmp` confirmed the files were restored)

Client, `lib/usernameClaim.ts`:

| Mutation | Caught? |
|---|---|
| M1 skip the reconcile read | yes (1 test) |
| M2 drop the late-success `onClaimed` | yes (2 tests) |
| M3 ignore `acceptsReconciledName` | yes (1 test) |
| M4 treat 409 as uncertain | yes (1 test) |
| M5 remove the claim deadline | yes (4 tests) |
| M6 stop rejecting 400/401/403 early | yes (1 test) |
| **M7 never call `onSettled` on a late failure** | **NOT caught (7/7 still pass)** |
| M8 `withUpdatedUsername` drops stats | yes (1 test) |

Server, `routes/profiles.ts`:

| Mutation | Caught? |
|---|---|
| S1 unique-violation (23505) not mapped to 409 | yes (concurrency test) |
| S2 GET `/username` without device auth | yes |
| S3 POST skips moderation | not in this file, but `profiles.moderation.test.ts` covers it |
| S4 pre-check made case-sensitive | yes (8 tests) |
| S5 echo the request name instead of the stored one | no, but this mutant is equivalent (the stored value is the normalised name) |

Component logic (`LanguageUsernameStep`, `UsernameEditor`) has **no tests at all**. `OnboardingFlow.test.tsx` stubs `LanguageUsernameStep` out. Every lock, unlock, `finished` and `outstanding` rule in the components is unproven by the suite.

---

## Confirmed findings

### F1 — MAJOR — A hung claim plus a definite "no" on retry locks the spotter on the name screen

- **Where:** `artifacts/cat-spotter/components/onboarding/LanguageUsernameStep.tsx:182-199, 213, 321, 332, 341`. The editor has the same problem at `artifacts/cat-spotter/components/UsernameEditor.tsx:137-153, 244` (Cancel is disabled while `uncertainName` is set).
- **What the spotter sees:** they tap Continue on "SeaCat" on a flaky connection. The POST never comes back. On Android, React Native's OkHttp client has **no timeouts at all** (`OkHttpClientProvider.kt:49-54`, "No timeouts by default", connect/read/write = 0), and `custom-fetch.ts` adds none. After 12 seconds they see "Still checking whether your name was saved. Retry the same name safely." They tap "Retry this name", and this time the server answers with 409 (someone else took SeaCat in the meantime), 400, 401 (pre-launch pass) or 403. The screen says "That name is already taken", but:
  - the name box is still read-only,
  - Back and the suggestions are disabled,
  - the only button is "Retry this name", which will get 409 again for ever.

  The lock only releases when the first POST settles (`outstanding.current === 0`), and on Android it never does. Force-quitting the app is the only way out. Persistent 5xx or 429 responses loop the same way, because those count as "uncertain" and not "rejected".
- **Evidence:** repro R1 drives the real component: first `claimUsername` never settles, reconcile read returns `null`, retry rejects `{status: 409}`. Afterwards `input.readOnly === true`, typing another name is ignored, the button still reads "Retry this name", and `setUsername` was never called. The repro passes, so the bug is confirmed.
- **Why:** the rejected branch only unlocks `if (outstanding.current === 0)`. A definite rejection of the *same* name means that name can't be the one that commits, unless the hung request still lands later. The design's safety argument keeps the spotter waiting on a request that may never resolve.
- **Fix:**
  - When a retry of the same name gets a definite answer (409, 400 or 403), reconcile with the GET once more. If the server doesn't hold that name, clear `uncertainName` and unlock, even with requests still outstanding.
  - Make any late success of the old request harmless, either by dropping its `onClaimed` once the name has been abandoned, or by letting it win and re-reading the server name.
  - Give every claim a real transport timeout (an `AbortController` at ~20–30 s, separate from the 8 s UI deadline), so `outstanding` can't stay above zero for ever.
  - Always leave an escape: let Back work in the uncertain state.

### F2 — MAJOR (could be a blocker; the real-network test decides) — the 5-second availability deadline can block Continue on slow first requests

- **Where:** `artifacts/cat-spotter/lib/usernameClaim.ts:7` (`AVAILABILITY_WAIT_MS = 5000`), `LanguageUsernameStep.tsx:96-104, 138-139, 166`, and `UsernameEditor.tsx:67-69, 128`.
- **What the spotter sees:** they type a name. If the "is it free?" request takes more than 5 seconds, they see "Could not check that name. Check your connection or try another name." **Continue stays disabled** (`canSubmit` requires `available`, and an errored query is never `available`), and `retry: false` means it won't try again by itself. Typing a different name, as the message suggests, starts another request with the same 5-second limit, so on a slow link they're stuck in a loop. Before this commit there was no deadline: the check would simply take longer and then succeed.
- **Why this is realistic on Syros:**
  - The API is on Replit **autoscale** (`.replit` → `deploymentTarget = "autoscale"`), which scales to zero. The availability check (or suggestions) is usually the first API call a new spotter's phone makes, so it is the one that pays the cold start.
  - A fresh TLS connection over weak 3G costs 2–3 round trips before the request is even sent.
  - Five seconds is tight for a cold start plus a new connection on a poor link.
- **Two more problems:**
  - When the deadline fires, the underlying request is *not* aborted (`withDeadline` only races it; React Query's `signal` aborts only on cancel or unmount). The real answer may arrive at 6 seconds and is thrown away.
  - The wait is pure availability. The claim itself is authoritative (409 when taken), so blocking Continue on availability gains nothing.
- **Evidence:** code trace (above). How often the deadline actually fires on Syros networks is unmeasured; see the real-network plan below.
- **Fix:**
  - Don't make availability a gate. After the deadline, show "Still checking…" and keep Continue enabled, letting the claim decide (it already handles 409 and 400).
  - Or raise the deadline to ~15 s and keep the late answer, writing it into the query cache when it arrives.
  - Add `retry: 1` with backoff for network errors.
  - Optionally warm the server with a cheap request (`/healthz` or suggestions) when the onboarding flow opens.

### F3 — MAJOR — a late network failure unlocks without checking, and onboarding then accepts whichever name the server reports

- **Where:**
  - `artifacts/cat-spotter/lib/usernameClaim.ts:64-67`: `onSettled` fires on *rejection* too.
  - `LanguageUsernameStep.tsx:182-185`: the lock clears when `outstanding` reaches 0.
  - `LanguageUsernameStep.tsx:174-186`: no `acceptsReconciledName` is passed, so the default `() => true` at `usernameClaim.ts:59` applies.
- **What the spotter sees:**
  1. They claim "NameA". The server commits it, but the response is lost: the 8 s UI deadline passes, the reconcile read times out, and they see the "uncertain" message with the name locked.
  2. At 15 s the connection drops and `fetch` rejects with "Network request failed". That is **not** proof the write failed, but `onSettled` unlocks the name box anyway, with no reconcile.
  3. They type "NameB" and tap Continue. POST B is slow. The reconcile read returns "NameA" (committed in step 1), and onboarding accepts it: `setUsername('NameA')`, and the app opens as NameA.
  4. POST B then commits on the server.

  Result: the phone says NameA, the server (Profile tab, leaderboard, sightings) says NameB, and NameA has been released for someone else to take. This breaks two of the task's stated goals: "an ambiguous timeout is reconciled before another claim is allowed" and "never claims a different name on retry".
- **Evidence:** repro R2 against the real component asserts `input.readOnly === false` after the late `TypeError`, then `setUsername` called with `'NameA'` while the spotter asked for NameB. It passes, so the bug is confirmed. Mutation M7 (never calling `onSettled` on late failure) survives the whole suite, so this path is untested.
- **Fix:**
  - On a late *network* failure (no HTTP status), don't unlock. Run a reconcile read first, and only unlock if the server name isn't the pending one.
  - In onboarding, pass `acceptsReconciledName = (n) => n.toLowerCase() === claimedName.toLowerCase()` (comparing *normalised* names; see F7), as the editor already does.
  - After any `claimed` result, re-read the server name once a later write settles, and correct the local name if they differ.

---

## Confirmed, lower severity

### F4 — MINOR — the "uncertain" state never re-checks by itself, and its message can be untrue

- **Where:** `LanguageUsernameStep.tsx:189-193`, `UsernameEditor.tsx:145-147`, and the `usernameClaimUncertain` copy in `lib/i18n.ts:145` (en) and its el/fr versions.
- **What the spotter sees:** "Still checking whether your name was saved". Nothing is checking, though. The app waits for the original POST or for the spotter to tap Retry. If the POST already failed, the box unlocks (F3) while the message still says "still checking… retry the same name".
- **Fix:**
  - While uncertain, poll `GET /profiles/:id/username` every 3–5 s (bounded, with backoff) and move on automatically when the name appears.
  - Change the message when nothing is outstanding.

### F5 — MINOR — a double tap sends two claim requests

- **Where:** `LanguageUsernameStep.tsx:168-172` and `UsernameEditor.tsx:130-134`. The guard is `canSubmit` from the render closure plus `setPending` state, so both taps see `pending === false`. `onSubmitEditing` and the button can also both fire.
- **What happens:** two POSTs for the same name. The server handles this fine today (same device, same name, idempotent update), but `outstanding` becomes 2, which widens the F1 lock window and doubles load on a slow link.
- **Evidence:** repro R3, where `claimUsername` was called twice, confirms it.
- **Fix:** guard with a ref (`inFlight.current`) that is set synchronously before the first `await`.

### F6 — MINOR — the log redaction added for device ids is easy to bypass and only partly applied

- **Where:** `artifacts/api-server/src/app.ts:39-42`.
- **What's wrong:**
  - The regex is case-sensitive, but Express routes are not. `/api/Profiles/dev-abc/username` reaches the handler and is logged verbatim. This was checked with node: `/api/Profiles/dev-abc123/username -> /api/Profiles/dev-abc123/username`.
  - `/notifications/:deviceId`, `/notifications/:deviceId/read-all`, `/notifications/:deviceId/:id/read` and `/profile/:deviceId/push-token` are never redacted, so device ids are in the request logs anyway, on routes the app calls often.
  - The repo also disagrees with itself: `profiles.ts:110-115` says "Device ids are not secrets."
- **What's fine:** the new timing logs contain no username, secret or device id (fields: `authMs`, `dbMs`, `responseMs`, `totalMs`, `result`). Client timing logs only run under `__DEV__` and contain only milliseconds.
- **Fix:** redact any path segment that looks like a device id (`/dev-[a-z0-9]+/i`) in every route, case-insensitively. Or decide that device ids are fine to log and remove the half-measure. Either way, add a test.

### F7 — MINOR — the editor's reconcile check doesn't normalise spaces, so a saved name can be reported as "uncertain"

- **Where:** `UsernameEditor.tsx:142`, which compares `name.toLowerCase() === trimmed.toLowerCase()`. The server's `normalizeUsername` (`api-server/src/lib/usernames.ts`) collapses repeated whitespace.
- **What the spotter sees:** they rename to "Cat  Lover" (two spaces). The server saves "Cat Lover". If the POST is slow, the reconcile read returns "Cat Lover", which doesn't match, so they see the uncertain message even though the rename worked. A late success clears it eventually.
- **Fix:** compare `normalize(a) === normalize(b)`, collapsing whitespace before lower-casing. The same helper is needed for F3's onboarding fix.

### F8 — MINOR — test coverage doesn't prove the stated behaviour

- **Gaps:**
  - No component tests for `LanguageUsernameStep` or `UsernameEditor`. The lock, unlock, `finished` guard, retry-same-name rule and stale-availability rule are all untested; R1, R2 and R3 show the gaps are real.
  - "bounds availability without allowing a late answer to replace a newer result" (`usernameClaim.test.ts:70-79`) only tests `withDeadline`. It says nothing about stale answers in the component (which is actually handled by the query key plus `debounced === trimmed`).
  - Mutant M7 survives.
  - The server test's `expect(claimMs).toBeLessThan(5000)` against a local database proves nothing about speed, and its `console.info` adds noise to CI output.
- **Fix:**
  - Promote R1, R2 and R3 (inverted to assert the *correct* behaviour once fixed) into `components/__tests__/`.
  - Add a test for late failure followed by a reconcile.
  - Drop the meaningless timing assertion.

---

## Plausible (not proven here)

### P1 — MINOR — old app builds get a partial profile after renaming

- **Where:** the `POST /profiles/:id/username` response changed from the full `Profile` to `{ username }` (`openapi.yaml`, `profiles.ts:97`). Before 6f9dccf, `UsernameEditor` did `queryClient.setQueryData(getGetProfileQueryKey(deviceId), profile)` with the POST response.
- **What happens:** a tester on a native build from before 25 Sep (or a cached web bundle) who renames gets a profile cache of `{ username }` only. The Profile tab shows empty points, streak and cats until the next refetch. This only matters if such builds exist.
- **Fix:** ship the new client before or with the server, or have the server return the old shape for one release.

### P2 — NIT — the startup recovery read can override a fresh claim

- **Where:** `LanguageUsernameStep.tsx:68-78`. This calls `setUsername` directly, bypassing `finished`.
- **What happens:** the app was killed after NameA committed. The spotter reopens it, and within the ≤4 s recovery read window types and claims NameB. The recovery read then returns NameA, the app opens as NameA, and POST B commits. The window is small.
- **Fix:** skip the recovery result once a claim has started (check `outstanding.current > 0 || finished.current`).

### P3 — NIT — server details

- `responseMs` (`profiles.ts:96-98`) times only the synchronous `res.json` call, not the network, so it's always ~0.
- The "cheap" `GET /username` still writes on every call (the trust-on-first-use credential `INSERT … ON CONFLICT DO NOTHING` in `deviceAuth.ts`). That's harmless, but it isn't a read-only path.
- The check, insert and update are not in one transaction. That's fine: the unique index plus the 23505-to-409 mapping covers the race, and the concurrency test proves it (mutation S1 is caught).

---

## Checked and fine

- **Case-insensitive uniqueness:** there is a pre-check on `lower(username)` and a unique index on `lower(username)` (`profiles_username_lower_idx`). A concurrent claim from two devices gives exactly one 200 and one 409, never a 500 (tested; mutation S1 caught).
- **Moderation:** enforced on POST (and checked in `profiles.moderation.test.ts`) and reported on availability.
- **Device auth:** both the new GET and the POST require `X-Device-Secret`. A wrong secret gets 403 and a missing one gets 401 (tested; mutation S2 caught).
- **Pre-launch gate and middleware order** in `app.ts`: not changed by 6f9dccf. The new GET passes through the gate like every other `/api` route.
- **Stale availability answers:** results are keyed by name, and the UI requires `debounced === trimmed`, so an older answer can't mark a newer name as available.
- **Profile editing:** `withUpdatedUsername` patches the cached profile and then invalidates it, so stats aren't replaced by partial data in the current client (mutation M8 caught).
- **DeviceContext:** full-profile hydration now waits until a username exists. This is correct, and it re-runs after a rename (harmless).
- **Generated clients** match `openapi.yaml`.
- **i18n:** all four new strings are present in en, el and fr.

---

## Verdict

**Not safe as is for launch on island connections. It is safe enough to leave live for testers on good connections.**

On a working connection the shipped code is correct and faster than before, and the server side (uniqueness, moderation, device auth) is sound. The failure modes all need a slow, hanging or dropped connection, but those are normal on Syros. Two of them (F1, F2) can stop a new spotter finishing onboarding, and the third (F3) can leave a spotter with mismatched names.

**Must change before launch:**

1. **F1:** a definite rejection on retry must unlock the name. Claims need a real transport timeout. Back must always work.
2. **F2:** availability must not gate Continue, or its deadline must be generous with the late answer kept.
3. **F3:** reconcile before unlocking after a late network failure, and make onboarding accept only the name it claimed (normalised comparison, F7).
4. **F8:** add component tests for the above, including the R1, R2 and R3 scenarios inverted.

**Should change soon:**

- F4: auto re-check while uncertain.
- F5: in-flight ref guard.
- F6: consistent device-id log redaction.
- P1: only if pre-25-Sep builds exist.

## Plan: confirm username signup speed on a real Syros mobile connection

**What to measure** (use the existing `__DEV__` timing logs plus server `Username claim timing` lines; record each trial in a sheet):

- Time from tapping Continue to Home appearing (main metric), p50 and p90.
- Availability-check latency, split into:
  - first request after the server has idled ≥15 min (autoscale cold start),
  - warm requests.
- Claim POST latency, and how often each outcome happens: `claimed` directly, `claimed` via reconcile, `uncertain`, "Could not check that name".
- Server-side `totalMs` and `dbMs` for each claim, to separate server time from network time.
- Any stuck state: name box locked with no way forward for more than 30 s.

**Devices:**

- One low-to-mid Android (e.g. Samsung Galaxy A-series), because Android has no fetch timeout and is the F1 risk.
- One iPhone (iOS 17 or later).
- Mobile web (Safari, Chrome) for PWA testers.

**Networks:**

- Each Greek carrier available (Cosmote, Vodafone, Nova) on 4G in Ermoupoli.
- Weak-signal spots inland and in the north of the island, where phones drop to 3G or EDGE.
- Port and ferry Wi-Fi.
- A controlled baseline: iOS Network Link Conditioner "3G" and "Very Bad Network", and Android emulator throttling.

**Fault injection** (at least 5 trials each):

- Airplane mode on 1 s after tapping Continue, off after 20 s.
- Kill the app mid-claim and relaunch.
- Double tap.
- First visit with a cold server.
- Claim a name that a second phone takes during the hang (the F1 scenario).

**Pass bar:**

- Tap-to-Home p90 ≤ 5 s on 4G and ≤ 10 s on 3G (warm server). First request on a cold server ≤ 15 s, with no "Could not check" shown.
- Across ≥ 20 trials per network, including every fault case: **zero** stuck states, **zero** cases where the phone's name differs from the server's name, and every killed-mid-claim relaunch ends on the name the server holds.
- Server `totalMs` p95 < 500 ms. If the end-to-end numbers miss the bar while the server is fast, the problem is network or cold start, not code.
