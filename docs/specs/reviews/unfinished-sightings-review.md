# Adversarial review: `unfinished-sightings.md` (SYC-186)

**Reviewer:** a Sonnet subagent told to refute the draft, read-only, returning text (26 October 2026). Committed unedited in substance; findings condensed to one line each. Line numbers are the reviewer's, against `origin/main`.
**Result:** 16 findings (3 blockers, 9 should-fix, 4 nits). All accepted. The reviewer also confirmed these claims TRUE: sending with signal returns the answer and leaves the row `pending`; the append-only trigger allows only pending to resolved or awaiting_team, and redaction (so a separate table is needed); `open-sightings` uses `requireDeviceAuth` and `publicPhotoUrl`; `resolve` already answers 409 and orders 404/403/secret as proposed; `retake` removes only the phone copy; `MAX_QUEUE_AGE_MS` is 30 days; restore keeps the device id; a deleted person's sightings have a null device id; the discard keys exist in all three languages.

| # | Sev | Finding | How handled |
|---|---|---|---|
| 1 | Blocker | `storedAnswer` always says "check done, can't recheck", so a failed-check spot (or one with no match record) would show as "no look-alikes", the SYC-503 lie. | §10 builds each row per case (done / failed with recheck / no record). §3.2 says "Check again" costs a check. Tests added. |
| 2 | Blocker | The merge by `sightingId` double-lists a spot whose upload landed but whose answer was lost (no `sightingId` on the queued item yet), and a later sync turns it into a card that always 409s. | §10 merges on `sightingId` **or** capture time; a queued copy of a finished spot is dropped. Test added. |
| 3 | Blocker | §5 and §6 said "Start again" gives the new spotter none of the old spots, but unsent phone-saved spots are kept (`DeviceContext.tsx:~262`); and the new cache key must join `IDENTITY_KEYS`. | §5 corrected; §6 and §10 add the key to `IDENTITY_KEYS`; test added. |
| 4 | Should | "The photo won't be sent" is untrue for a spot the server already holds; the French "Supprimer" means delete. | §3.4 and §9: separate "Remove this spot?" copy that says Syros Cats keeps the photo; checked against `privacy-policy.md` at build. |
| 5 | Should | `photoUrl` must respect hidden, privacy-hidden, team-only and removed photos; the review screen needs a remote-photo path. | §10 uses `hiddenPhotoIds`/`publicPhotoUrl` (null when hidden); §3.2 plain tile; review takes `photoUrl`; test added. |
| 6 | Should | The 30-day window from capture time is wrong: capture is clamped up to 30 days back and library photos may be 21 days old. | §1, §5, §10: the clock starts when the server received the spot; test added. |
| 7 | Should | The stored suggestions are a snapshot; cats added later never appear, and "New cat" then makes a duplicate. | §3.2 states the limit plainly and leans on "Find the cat yourself", which uses today's cat-alogue. No automatic re-check (cost). |
| 8 | Should | "And {n} more opens the full list" had no way to page; the route had no limiter and ran per-row queries. | §3.2 drops the link ("Finish or remove some to see them"); §10 batches queries and adds a per-device limit; test added. |
| 9 | Should | Exits forgotten: the toast for non-listed spots; "already finished" wrong for a spot asked to the team; `hintCatId` lost; "Open that sighting" contradicting; which photo is the tile. | §3.1, §3.2, §3.5 and §10 each answer one. |
| 10 | Should | A discard races with a resolve from another tab; discard of a non-pending spot was unspecified. | §10: idempotent, 409 once not pending, resolve ignores removals (§3.5 says why). Tests added. |
| 11 | Should | `sighting_drops` needs a foreign key, a migration with a rollback block, and a check against deletion tests. | §10 adds all three. |
| 12 | Should | A spot sent from a new phone before restoring stays with the throwaway spotter; only some code handles `device_moved`. | §4 table and §6 say so; the new module handles `device_moved` itself; test added. |
| 13 | Nit | The review file the header cited didn't exist; `origin/main` had moved. | This file; header notes the newer commit. |
| 14 | Nit | A gendered Greek line; "Spots to finish" over-promises next to "kept safe until finished". | Greek line reworded; §1 now says "until they finish it (or 30 days pass)". Section title kept: it is the shortest honest name, and §5 explains what leaves the list. |
| 15 | Nit | The tests would miss items 1, 2, 3, 5, 8, 10. | §10 tests extended for each. |
| 16 | Nit | The claim about the dashboard was unchecked. | §8 labels it **unchecked**; the build re-checks. |
