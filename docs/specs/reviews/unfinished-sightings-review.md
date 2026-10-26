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

---

# Review 2: the option A revision (26 October 2026)

**Reviewer:** a second Sonnet subagent told to refute, read-only, text only. Samuel had chosen option A (the phone keeps every unfinished spot, no expiry), which changed the design, so the spec was reviewed again. 15 findings: 2 blockers, 9 should-fix, 4 nits. All accepted.

| # | Sev | Finding | How handled |
|---|---|---|---|
| 1 | Blocker | A sent ("review") card has no Discard (`spot.tsx:1404`); with no expiry, a spot the server will never accept (403 after "Start again", 404, 422 for a removed cat) stays for ever. | §3.3: every card gets Discard; "can't be finished any more" screen for 403, 404, 422, `RESOLVED`; tests. |
| 2 | Blocker | "Ask Syros Cats to match it" is hidden and has no string (`sightings.ts:81`, `review.tsx:462`) yet was listed in the spec and tests. | Removed from §3.5, §5, §7, §9; noted as future. |
| 3 | Should | `localId` on the route switches off the feeding nudge (`waitingCard.ts:272`) and drives the hint prompt. | §7: a separate `keptAtSend` marker; tests. |
| 4 | Should | The "photo checked" banner and the Spot tab badge count review items and would nag for ever. | §7: `keptAtSend` items are left out of both; the banner opens the item that just synced. Flagged as reversible by Samuel. |
| 5 | Should | The kill window is the whole ~35 s request, not milliseconds; writes after the answer come after several awaits. | §7 says so plainly; write straight after `submitSighting` returns. |
| 6 | Should | The recent-photos record for a sent spot has no `localId`, so "Open that spot" finds nothing. | §3.3 and §7, §10: store `localId`; clear on discard. |
| 7 | Should | An inline photo copy would fill the ~5 MB browser storage and block real offline saves. | §7: never inline; no copy and the old line instead; plain tile if later cleared. |
| 8 | Should | The new write must respect the "Delete my data" pause (SYC-63). | §7 and tests. |
| 9 | Should | The resolve `409` has no code; a name clash is also `409`. | §3.5, §10: add `code: "RESOLVED"` (one server line, so "no server change" became "one line"). |
| 10 | Should | No expiry means stale suggestions, removed cats, and a hint prompt asked again. | §3.3 says the cost plainly; Discard and "Find the cat yourself" are always available. |
| 11 | Should | The `review-<id>` photo is still needed for no-cat and failed-write spots. | §7: written only when no list item is written. |
| 12 | Nit | The card shows a full locale date, not "Taken today, 14:32". | §3.3 reworded. |
| 13 | Nit | Toast conditions. | §3.2 states them. |
| 14 | Nit | Test list gaps, and "double tap writes one item" is wrong (a second send is a second spot). | §7 tests extended and corrected. |
| 15 | Nit | §10 omitted files. | §10 extended. |
