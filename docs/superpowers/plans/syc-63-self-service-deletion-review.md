# Review: SYC-63 self-service deletion plan

**Reviewer model: Sonnet** (independent adversarial pass, no agents spawned). I read the plan end to end against the current `main` code it describes: `lib/db/src/schema/*`, `lib/db/migrations/0001_data_spine_tables.sql` (the observations trigger it says the deletion SQL must satisfy), `artifacts/api-server/src/lib/deviceAuth.ts`, `artifacts/api-server/src/routes/{sightings,cats,notifications,profiles}.ts`, `artifacts/api-server/src/lib/catHelpers.ts`, `artifacts/cat-spotter/context/{DeviceContext,OfflineContext}.tsx`, `artifacts/cat-spotter/lib/{webLocks,queueStore,pendingPhotos}.ts`, `artifacts/cat-spotter/components/OwnershipNoticeBanner.tsx`, `docs/specs/DECISIONS.md`, and `docs/specs/{cat-record-data-spine,email-capture,team-access-and-welfare-queue}.md`. Findings are most-severe first.

---

## BLOCKER — Unauthenticated `POST /cats` and `POST /cats/:catId/claim` let anyone re-attribute a deleted person's identity, defeating decision D

**CONFIRMED.** `artifacts/api-server/src/routes/cats.ts:100` (`router.post("/cats", ...)`) and `:229` (`router.post("/cats/:catId/claim", ...)`) never call `verifyDeviceSecret`/`requireDeviceAuth`. They trust `body.deviceId` outright:

- `POST /cats` sets `discovererDeviceId: body.deviceId, ownerDeviceId: body.deviceId, ownerName: ..., homeDescription: ...` directly from the request body (cats.ts:110-125).
- `POST /cats/:catId/claim` sets `ownerDeviceId: body.deviceId` on any unclaimed cat (cats.ts:255-262).

The whole point of §4.3's "deleted device" marker and the 410 handling in §4.5/§6.4 is that "the identity cannot come back" (decision D). But that protection is wired entirely through `verifyDeviceSecret` — the function that these two routes never call. After deletion, anyone who has the deleted person's (non-secret) device id — which the codebase's own comment in `deviceAuth.ts:20-22` says "unavoidably appear[s] in request paths/bodies" — can `POST /cats` or `POST /cats/:catId/claim` with that exact id and instantly recreate `ownerName`/`homeDescription`/`discovererDeviceId` attributed to the just-deleted person, with **no secret required and no 410 in the way.** The marker in `device_credentials` is never consulted because these code paths never touch `device_credentials` at all.

This isn't a hypothetical: it's the precise question the review brief was asked to check, and the plan's §7 "other two doors" section and §4.5 read-path table are both silent on it. §8.1's test list (item 7) only asserts 410 on "every device-authenticated route, including `POST /sightings`" — by construction it can't cover `POST /cats`/`claim`, because those routes have no auth to return 410 from.

**Fix:** either (a) make `severPerson`'s marker check reachable from these two routes too (e.g. a shared helper that rejects any incoming `deviceId` matching a `deleted:` marker, called from every route that persists a `deviceId` verbatim, not just the ones that authenticate), or (b) if Samuel accepts the pre-existing unauthenticated-attribution design as out of scope, say so explicitly in §7 and in decision D's write-up, rather than silently claiming the identity "cannot come back."

---

## HIGH — On native, "wait for the upload in progress" (§6.2 step 1) is a no-op; the claim that "the in-process chain does the same job" is false

**CONFIRMED.** `UPLOAD_LOCK` (`artifacts/cat-spotter/lib/webLocks.ts:9`) is only meaningful through the Web Locks API. `withLock` (webLocks.ts:26-44) explicitly falls back to `return fn()` — i.e. runs immediately, no waiting — when `navigator.locks` doesn't exist, which is every native build (`lockManager()` returns `null` on React Native). So "wait for `UPLOAD_LOCK`" only actually waits on web; on native it does nothing.

The plan's fallback claim is that "the in-process chain" serialises things instead. But the in-process promise chain in `queueStore.ts` (`chain`/`run()`, lines 148-163) only serialises calls to `mutate`/`load`/`refresh` — i.e. storage reads/writes. It does **not** span the network call. In `OfflineContext.tsx`'s `syncOne` (lines 301-390), the `await createSighting(...)` network request happens as a plain `await` *outside* any `store.mutate` closure; the chain is idle while it's in flight. `syncingRef.current` (a plain boolean, not part of the chain) is the only in-flight marker, and the plan's described `pauseAndClear` doesn't check it.

Net effect on native: `pauseAndClear` can proceed to call `DELETE /api/me` while a `POST /sightings` request for the old identity is genuinely still in flight over the network. If that request's `verifyDeviceSecret` check runs and succeeds before the deletion transaction locks/redacts, and the sighting insert lands *after* `severPerson`'s "unlink existing sightings" UPDATE has already run (because the row didn't exist yet when the UPDATE ran), the new sighting is inserted un-redacted with the just-deleted device id — a "no trace of P" violation that no client-side wait actually prevented, contrary to the plan's own claim about why the wait exists ("This stops a sighting from being uploaded under the old identity *after* the server has deleted it" — that guarantee doesn't hold on native).

**Fix:** on native, `pauseAndClear` needs to actually await the in-flight `syncNow`/`syncOne` promise (e.g. track and await the live sync promise, not just a boolean ref), not rely on `UPLOAD_LOCK`. Add a mutation probe/test that starts a slow `createSighting` mock, calls `pauseAndClear` concurrently on the native code path (no lock manager), and asserts the delete call is not sent until the upload settles.

---

## MEDIUM — `verifyDeviceSecret`'s bind-on-first-use insert must be reordered around the marker check, and the plan doesn't say so explicitly

**PLAUSIBLE** (the plan's intent is right, but the precise implementation hazard isn't called out). Today `verifyDeviceSecret` (`deviceAuth.ts:49-86`) does `INSERT ... ON CONFLICT DO NOTHING` under the **real** `deviceId` unconditionally, *before* it does anything else. The "deleted device" marker lives under a completely different key (`deleted:` + sha256 of the id), so it is only useful if the modified function computes that hash and checks for the marker **before** the bind-on-first-use insert runs. If an implementer instead bolts the marker check on after the existing insert (a natural mistake, since the insert is already there and "add a check" reads like "add a check somewhere in this function"), the insert will have already resurrected a `device_credentials` row for the real id with the caller's new secret, defeating decision D exactly the way §4.3 says it must not. The plan should state this ordering requirement as a numbered step, not leave it implicit in "checks for that marker first."

**Fix:** spell out in §4.3 that the hash-and-marker-lookup must be the very first thing `verifyDeviceSecret` does, strictly before the TOFU insert, and add a mutation probe for it (swap the order, confirm a resurrection test goes red).

---

## MEDIUM — No answer for a read-only (corrupted) local queue during deletion

**CONFIRMED as a gap, not a bug in existing code.** `queueStore.ts`'s `mutateNow` (lines 187-220) throws `QueueWriteError` for a `'user'`-kind mutation when the store is read-only or the read fails (`readStored()` returns `{ ok: false }`). The plan's `pauseAndClear` (§6.1, §6.2) is described as emptying the queue "through the existing single write path," but doesn't say which `ChangeKind` it uses or what happens if that write throws — which it will, deterministically, for anyone whose queue storage is already unreadable (the same `readOnly` state `OfflineContext` already surfaces via `readOnly` today for enqueueing). As written, a person with a corrupted queue could find "Delete my data" perpetually erroring, or — worse, if an implementer chooses `'system'` kind to dodge the throw — silently skip clearing the queue's *storage* (only memory is updated per `mutateNow`'s `'system'` branch, lines 196-199) while still deleting the account, leaving stale queued photos/positions on disk that §6.1's "remove everything" helper never gets a chance to run against consistently.

**Fix:** add this as an explicit case in §6.3/§8.2: what `pauseAndClear` does when `store.isReadOnly()` is true (most likely: still proceed with the server deletion and identity reset, but run the photo/backup wipe unconditionally by file enumeration rather than depending on a clean queue read), and add a test for it.

---

## LOW — Two citation inaccuracies

**CONFIRMED.**

1. §5 step 4 says "the api-server tests currently clean up with `delete from sightings` (in six test files)." Actual count is **seven**: `lib/catHelpers.derived.test.ts`, `routes/cats.claim.test.ts`, `routes/sightings.dedupe.test.ts`, `routes/sightings.moderation.test.ts`, `routes/sightings.resolve.test.ts`, `routes/sightings.upload.auth.test.ts`, `routes/sightings.upload.test.ts` (all under `artifacts/api-server/src`, all containing `db.delete(sightingsTable)`). Doesn't change the conclusion, but the number should be right before it's used to scope "real work" in the model-delegation table.
2. §7's contradiction flag cites "email-capture §5.8 says delete tokens never expire." The actual sentence — "Verification expires in 7 days; unsubscribe and delete do not expire (§5.8)" — is in **§8.5** of `email-capture.md` (line 566); §5.8 is the Unsubscribe section it cross-references from. Cite §8.5 (or both) so SYC-45 doesn't have to go hunting.

---

## Things checked that held up (no finding)

- The exact `severPerson` observations UPDATE (§4.2 step 2) is permitted by the `observations_append_only` trigger in `lib/db/migrations/0001_data_spine_tables.sql:81-123`: setting `device_id = null`, stamping `redacted_at`/`redaction_reason`, and emptying `value` only for `kind = 'note'` all fall inside the trigger's "first redaction" branch, and the CHECK constraint `observations_attribution_ck` is satisfied because `redacted_at` becomes non-null in the same statement.
- The sightings append-only trigger design's "resolve" rule matches the app's one real update site exactly: `routes/sightings.ts:306-309` does `.update(sightingsTable).set({ catId: cat!.id, status: "resolved" })` in one statement — nothing else. No other non-test file updates or deletes `sightings`.
- `sightings.device_id` genuinely has no index today (schema and both migrations checked) — the plan is right to add one.
- Table-by-table claims in §2 check out against schema: `photos` has no device link (`lib/db/src/schema/photos.ts`), `cat_updates` holds only `catId`/`message`/type (`schema/notifications.ts`), `cat_subscriptions`/`notifications`/`push_tokens` are all keyed on `deviceId` and nothing else identifying.
- Device ids really do start `dev-` (`artifacts/cat-spotter/context/DeviceContext.tsx:20-24`), so the `deleted:` marker prefix can't collide.
- `OwnershipNoticeBanner`'s `cat-spotter/ownership-snapshot` (`components/OwnershipNoticeBanner.tsx:17-24`) stores only public cat name/`hasHome` state keyed by cat id, not anything identifying the device — wiping it is harmless but not privacy-critical; no issue either way.
- The email-capture/team-access token-expiry contradiction itself is real (email-capture.md:566 vs team-access-and-welfare-queue.md:773), just mis-cited (see LOW finding above).
- `fansCount`, `spotterCode`, and the public payload functions in `catHelpers.ts` never expose the raw device id, only a 4-character hash — consistent with the plan's read-path table.
- `pruneQueueBackups`/`backupQueueText` (`pendingPhotos.ts:194-231`) confirm the 30-day backup claim and that the "move" backup captures the raw pre-migration queue text (base64 photos included), matching §6.1's rationale for wiping backups.
