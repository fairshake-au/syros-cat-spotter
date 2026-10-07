# Adversarial review: `claiming-a-cat.md` (SYC-130)

Reviewed commit 738f5a1 ("SYC-130: draft spec for claiming a cat"). Worktree: `/Users/samuelporter/Projects/syros-cat-spotter/.claude/worktrees/agent-a4c673e4864672e9c`.
Setup note: `origin/claude/syc-130-claim-spec` does not exist on the remote (the branch was never pushed), so `git checkout --detach origin/...` fails. I checked out 738f5a1 directly; its parent is c5ee36c (#99).
Samuel's fixed direction (no approval step, owners keep exact spot and live alerts, "must have spotted it" + clearer button) is not argued with. File:line references are on this commit. Paths are relative to `artifacts/api-server/src/` unless they start with `artifacts/cat-spotter`, `lib` or `docs`.

## Summary

The core rule does not hold as written. "Has met the cat" can be forged remotely with the cat's own public photo, so it is a speed bump, not a guard (F1). `unlabelled` is not "a confirmed suggestion": it is any pick at all (F2). Beyond those, the spec contradicts the data spine on who may write `street` (F4), has no answer for the idempotent re-claim (F5), would let a claim overwrite `deceased` / `in_care` (F6), never mentions the app's stale `ownedCatIds` (F7), and leaves a public, unmoderated free-text field (home description) as the real exposure (F3).

| # | Severity | Status | One line |
|---|---|---|---|
| F1 | BLOCKER | CONFIRMED | "Suggested match" is forgeable from anywhere with the cat's public photo and a spoofed location |
| F2 | HIGH | CONFIRMED | `unlabelled` means "any pick with no stored set", including arbitrary hand picks |
| F3 | HIGH | CONFIRMED | Home description is public, unmoderated, pushed to everyone, and left in place by "Remove owner" |
| F4 | HIGH | CONFIRMED | "Let go" writes `street` from an owner; the data spine says owners may only set `homed`; it also overrides team statements |
| F5 | HIGH | CONFIRMED | Rule 1 breaks the idempotent re-claim by the real owner (lost response, retry) |
| F6 | MEDIUM | CONFIRMED | Rule 1 only checks "not homed"; `deceased` and `in_care` cats can be claimed, overwriting the team's statement |
| F7 | HIGH | CONFIRMED | App `ownedCatIds` is merge-only and never pruned; after Remove owner / let go the phone keeps the owner UI |
| F8 | MEDIUM | CONFIRMED | App has no way to know "I have met this cat"; spec adds no API for it, and match records are team-only by design |
| F9 | MEDIUM | CONFIRMED | Claim / let-go loop: claim pushes everyone, let-go is silent, no rate limit |
| F10 | MEDIUM | CONFIRMED | "Street + owner" stuck state: team sets street, owner link stays, claim button reappears with a wrong refusal |
| F11 | MEDIUM | CONFIRMED | `POST /cats` removal: the spec understates the blast radius and contradicts the data spine; new-cat-then-claim is the same hole |
| F12 | MEDIUM | CONFIRMED | "Remove owner": supersede target ambiguous, capability pairing undefined, team cannot see an owner today |
| F13 | MEDIUM | CONFIRMED | "Met it" query must pin the sighting's current cat and the chosen cat; `awaiting_team` does not exist in the schema |
| F14 | LOW | CONFIRMED | Spec says "followers are told"; push goes to every spotter and the in-app banner to every phone |
| F15 | LOW | CONFIRMED | Read the derived status through the transaction, and lock the cat row |
| F16 | LOW | CONFIRMED | `NOT_MET` has no status code, and 403 already means "not owner" in the app |
| F17 | LOW | CONFIRMED | Copy and privacy-policy gaps |
| F18 | LOW | PLAUSIBLE | New phone or reinstall: an owner cannot let go, and cannot re-claim |

---

## Findings

### F1. BLOCKER, CONFIRMED. The "suggested match" test is forgeable remotely

**Evidence.**
- `POST /sightings` takes `lat` / `lng` straight from the body and stores them (`routes/sightings.ts:566-577`). No geofence, no EXIF check: a search for `exif` / `geofence` in the API server finds nothing.
- Candidate cats are the ones within 500 m of those client-supplied coordinates, using the cats' exact positions (`routes/sightings.ts:235-241`, `lib/candidateSelection.ts`).
- Every cat's primary photo is public: `photoUrl` is `/api/photos/<publicId>` in every payload (`lib/catHelpers.ts` `serialiseCat`, `routes/photos.ts`). The blurred public position is the centre of the cat's 250 m cell, within about 177 m of the true spot, so it is inside the 500 m search radius.
- If the matcher scores the cat's own photo at or above `CONFIDENCE_THRESHOLD`, resolve with that `catId` labels the choice `suggested` (`labelChoice`, `routes/sightings.ts:376-433`). The label is decided "from the stored set, never from the phone's word", which is why it is trusted, and why a forged photo plus a forged location produces a genuine `suggested`.

**What is wrong.** Spec §3 says "a sighting matched to the cat by photo was taken where the cat was". The server cannot know that. Anyone can save Agatha's public photo, upload it as a sighting at Agatha's public map position from the sofa, tap "That's the one", then "This is my cat", and get exact location, live alerts and rename. The people §2 says the guard stops ("tourist in a hotel, curious stranger, mischief-maker") are not stopped by it. §9 accepts "someone who goes and spots the cat", a much weaker attacker (on the island, must find the cat). The remote attacker is not mentioned.

**Fix (at least one; say so in §3 and §9).**
1. Be honest that the rule stops accidental and casual claims only, and move "owner abilities switch on over time" (§9) from "if ever needed" into the build, because it is the only guard in the spec that survives this attack.
2. Make the evidence harder to fake: do not count a `suggested` match whose sighting photo is a near-duplicate of any photo already stored for that cat, and require sighting coordinates inside the cat's published cell neighbourhood.
3. Require two qualifying sightings on two different days; this costs a genuine owner nothing.

### F2. HIGH, CONFIRMED. `unlabelled` is "any pick with no stored set", not "a confirmed suggestion"

**Evidence.**
- `labelChoice` returns `unlabelled` whenever `!input.stored || input.stored.suggested == null`, for any existing cat, without checking it was suggested (`routes/sightings.ts:413-415`).
- History: before SYC-119 Slice A (be2c4b2, 2 Oct 2026) resolve accepted any existing `catId`, with only a 404 for a missing cat (`git show be2c4b2^:artifacts/api-server/src/routes/sightings.ts`, the `body.catId` branch; same in the first commit 9a68426). The server never enforced "must be one of the suggestions", whatever the UI offered. Match records (SYC-151, 3529459) landed the same day.
- A failed match write is deliberately best effort and reads as `unlabelled` (`recordMatch` catch, `routes/sightings.ts:371-373`; data spine §10.9 item 18, line 912).

**What is wrong.** Spec §3 says "Back then, the only way to match an existing cat was to confirm a suggestion; the build plan verifies that against the history". The history says the opposite. So counting `unlabelled` re-opens the hand-pick hole D1 closes, for every sighting before 2 Oct and every sighting whose record write failed. The set is bounded (an attacker cannot create new `unlabelled` rows on a healthy server), but the justification is false.

**Fix.** Decide explicitly: (a) do not count `unlabelled` (the 12 existing owners are kept by D5; see F18 for others), or (b) count it only for sightings created before the SYC-151 deploy and say why. Delete the "only way to match was to confirm a suggestion" sentence. A failed-write `unlabelled` after the cut-over must not qualify.

### F3. HIGH, CONFIRMED. The home description is the real exposure: public, unmoderated, pushed to everyone, and kept after "Remove owner"

**Evidence.**
- `homeDescription` is in the one serialiser output for every viewer, not gated by tier (`lib/catHelpers.ts:171-172`; the public snapshot `routes/__snapshots__/cats.publicDetail.p3-2.txt` carries the key).
- The claim route stores `body.homeDescription.trim().slice(0, 200)` with no offensive-language filter (`routes/cats.ts:386-389`; the name filter exists, a description filter does not). `PATCH /cats/:id` lets the owner change it at will (`routes/cats.ts:476-477`).
- The claim push body is `"<name> has been claimed by a resident. <homeDescription>"`, sent to every device with a resolved sighting of the cat (`routes/cats.ts:411-417`, `lib/notifications.ts:58-90`).
- The app shows it on the public cat page (`artifacts/cat-spotter/app/cat/[id].tsx:271-275`).
- The spec's example is "the blue house by the church" (§4.2), and §6.1 leaves the home note in place after Remove owner.

**What is wrong.**
1. A free-text field about where someone lives is shown to every user and pushed to every spotter. It undercuts the blur the spec leans on (§2, §9) and is not discussed anywhere. The spec has just said the claimer may be a mischief-maker, and they can type anything in the box and have it pushed out.
2. §6.1 says Remove owner "leaves the home note in place, for the team to edit". For a wrong or abusive claim that leaves the text live, and the dashboard has no edit-home-note action (none in `lib/teamCorrections.ts` or `lib/capabilities.ts`).
3. §6.2 (let go) is silent on the note: after the owner leaves, their description of their house stays on the cat's page.
4. `docs/specs/privacy-policy.md` does not say the home description is public.

**Fix.** (a) Run the moderation filter on the description at claim and PATCH; (b) clear `homeDescription` on let go and on Remove owner (the team can keep a copy as a team note); (c) decide whether it is public at all (recommend: owner and team only, public sees "Has a home"); (d) keep it out of the push body. If Samuel wants it public, say so in §2 and add it to the privacy policy.

### F4. HIGH, CONFIRMED. "Let go" writes `street` from an owner, which the data spine does not allow, and it overrides the team

**Evidence.**
- Data spine §3.2 (`docs/specs/cat-record-data-spine.md:78`): "Resident who has claimed a cat: Homed, on their own claimed cat". Owners may write `homed` only.
- `resolveLifeStatus` is newest-by-`observedAt` wins, whoever wrote it (`lib/resolve.ts:420-436`). Its comment says authority is "enforced upstream by PR 2's writeObservation", but `writeObservation` checks shape, role and vocabulary only, not who may write which status (`lib/observations.ts`, `validateValue` `life_status` case and the role / scope checks). So the code would accept the write; the spec would be silently overruling §3.2, which §1 says it does not own.
- Team-access §3.3: a team statement "does not overwrite anybody else's", and "a correction is never an undo".

**Failure scenarios.** Owner claims (homed); the team later records `in_care` after a vet visit; the owner taps "let go": the newest statement is the owner's `street`, so `in_care` silently becomes "Lives on the street". An owner (or a claim/let-go troll, F9) can wipe any team statement on a cat they own by letting go.

**Fix.** Do not write `street`. Let go should **supersede the owner's own current `homed` observation** (`supersedesId`, same device, `authority_scope: owner_of_this_cat`) and clear the owner link in one transaction. The cat then falls back to whatever stands beneath (team `in_care`, an earlier `street`, or the default). Put the rule "an owner may withdraw their own claim" in the data spine §3.2 rather than introducing it here by implication.

### F5. HIGH, CONFIRMED. Rule 1 breaks the owner's idempotent retry

**Evidence.** The route is deliberately idempotent for the same device (`routes/cats.ts:341` comment, `:371-377`; `routes/cats.claim.test.ts`). Spec §3 rule 1 and §10 refuse with `ALREADY_HOMED` whenever the derived status is `homed`, "not only the owner link". After a successful claim the cat is homed, so a retry from the real owner (lost response, offline replay, double tap) would say "Agatha already has a home".

**Fix.** Add a carve-out to §3 and §10: if the caller is already `owner_device_id`, return 200 with the owner payload and write nothing, no push. Add "same device claims twice" to §12.

### F6. MEDIUM, CONFIRMED. Claiming a `deceased` or `in_care` cat

**Evidence.** Rule 1 says "derived life status is not `homed`". Statuses are `street | homed | in_care | deceased` (`lib/resolve.ts:29`). A claim writes `homed` observed now, newer than a team `deceased` or `in_care`, so it wins (`lib/resolve.ts:420-436`). A claimed `deceased` cat then reads alive and homed, `isResolvedDeceased` stops blocking pushes (`lib/notifications.ts:66`), and the claim pushes to every spotter.

**Fix.** Allow a claim only when the derived status is `street`. Refuse `in_care` and `deceased` with their own codes. Add a test for each.

### F7. HIGH, CONFIRMED. The app never forgets an owned cat

**Evidence.** `DeviceContext` merges the server's `ownedCatIds` into the locally stored list and never removes anything (`artifacts/cat-spotter/context/DeviceContext.tsx:237-241`: `new Set([...prev, ...profile.ownedCatIds])`, written back to AsyncStorage). The cat page uses it for the owner UI and for sending `X-Device-Id` (`artifacts/cat-spotter/app/cat/[id].tsx:85-88`, `:128`). The spec does not mention it.

**What is wrong.** After Remove owner (§6.1) or let go (§6.2) the server says the phone is not an owner, but the phone keeps `isOwner = isClaimed && ownedCatIds.includes(...)` true whenever the cat shows as homed (for example, the team removed the owner but left the status, or someone else claims it). The wrong person sees the owner controls and PATCH answers 403. It also breaks the §12 manual check.

**Fix.** Make the server list the truth when online (`setOwnedCatIds(profile.ownedCatIds)`), keep the local list only as an offline fast start, and have let go remove the id locally. Add an app test.

### F8. MEDIUM, CONFIRMED. The app cannot tell whether this phone has met the cat

**Evidence.** The only per-device cat knowledge the app gets is `spottedCatIds` (any resolved sighting; `lib/catHelpers.ts` `profilePayload`). Match records are team-only and filtered out of every public route by design (`lib/db/src/schema/sightingMatches.ts:36-40`; data spine §10.9 item 8). §4.1 (button only for someone who has met the cat) and the §12 app tests need a per-viewer flag, but §4 and §10 define no API field.

**Fix.** Add to the spec: a `canClaim` (or enum `yes | not_met | has_owner | not_street`) on `GET /cats/:id`, computed only for a proven device (the `detailViewer` mechanism, `routes/cats.ts:122-126`), absent otherwise; it answers only about the caller's own history, so it leaks nothing about anyone else. The button and the claim route must call one shared function so they cannot disagree.

### F9. MEDIUM, CONFIRMED. Claim / let go can be looped to spam everyone

**Evidence.** Claim fires `notifyCatSpotters` ("has a home!") to every device with a resolved sighting of the cat except the actor (`routes/cats.ts:411-417`), and the app shows an in-app banner on any phone whose catalogue snapshot saw the cat flip to `hasHome` (`artifacts/cat-spotter/components/OwnershipNoticeBanner.tsx:84-95`). Let go "tells nobody" and the qualifying rule never expires (§3), so a person who has met the cat can claim, let go, claim, let go indefinitely. There is no rate limiter on claim (`routes/cats.ts` uses `aiLimiter` only on name-suggestions; `middlewares/rateLimit.ts` has no claim limiter).

**Fix.** Rate-limit claims per device, or send the push only the first time a cat is claimed (not re-claims after a let go). State it in §10.

### F10. MEDIUM, CONFIRMED. "Street with an owner" is a reachable stuck state

**Evidence.** The app shows the claim button when `!cat.hasHome` (`app/cat/[id].tsx:262-290`), and `hasHome` is derived from life status. The server's owner tier depends only on `owner_device_id` (`routes/cats.ts:122-126`). §6.1 says the team's life-status correction "doesn't remove the owner" and is the normal first step. In that state the cat reads `street`, the old owner still has the exact spot and alerts, and the claim button reappears for everyone who has met the cat. A second phone taps it and hits the existing `409 "Cat already claimed"` (`routes/cats.ts:371-374`), which the app maps to "already has a home" (`ClaimCatSheet.tsx` `onError`) while the page says "Lives on the street".

**Fix.** (a) Make "set to street" on a cat that has an owner one guided step that also offers Remove owner; (b) give "owner link present but status street" its own code and copy, or hide the button when an owner link exists; (c) expose `hasOwner` to the team page (F12).

### F11. MEDIUM, CONFIRMED. Removing `POST /cats`: blast radius, and a duplicate door

**Callers.** No app, site or admin code calls `registerCat`. The only references are the generated clients (`lib/api-client-react/src/generated/api.ts:164-232`, `lib/api-zod/src/generated/api.ts:25-42`) and the unused i18n key `registerCat` (`artifacts/cat-spotter/lib/i18n.ts:71,460,837`). That part holds.

**What breaks, not listed in the spec.**
- Tests: `routes/cats.register.test.ts`, `routes/cats.moderation.test.ts` (the `registerCat()` helper at `:65` is the fixture for its rename tests), `routes/cats.deviceAuth.test.ts` (`:97-119`, `:290`), `routes/cats.foldedNames.test.ts` (`:102,126,190,234`) and `routes/publicPayload.blur.test.ts:209` (creates the owned cat for the exact-location test). The name-collision and moderation guarantees proven on that path need equivalent tests on resolve / PATCH before the tests go.
- `lib/api-spec/openapi.yaml:36` and both generated clients must be regenerated.
- Docs: `docs/SPEC.md:159`, `threat_model.md:44`, comments in `lib/db/migrations/0006_data_spine_backfill.sql:93`, and the data spine §11 row 4 (`docs/specs/cat-record-data-spine.md:953`: "that endpoint writes the observation at creation") and its PR 2 plan. §7 does not say the spine needs editing.

**Duplicate door.** Deleting the route does not remove the "owner without meeting a cat" or "duplicate cat" concern. `POST /sightings` then resolve with `newCatName` creates a new cat the phone discovered (`routes/sightings.ts:722-738`), the phone passes rule 2 as discoverer, and it can claim it at once, at any coordinates it supplied. With a stolen photo (F1) that is the same outcome as the route. SYC-59 is the real answer.

**Fix.** Keep D7 (removing an unused door is fine) but give the true rationale (dead code, no screen, unguarded), list the test, client and doc work, add the spine edit, and say new-cat-then-claim stays possible and is ticketed to SYC-59.

### F12. MEDIUM, CONFIRMED. "Remove owner" is under-specified

- **Which observation is superseded?** A cat can have several `homed` observations from the same owner (claim, let go, claim), plus legacy backfilled ones for the 12 existing claims (`provenance: legacy`, migration 0006). `supersedeStatement` supersedes one row (`lib/teamCorrections.ts:140-185`). Say which: the newest active `homed` whose `device_id` equals the owner's; if there is none, write a plain team `street` statement (`recordTeamStatement`) instead.
- **Capability.** `capabilityFor` maps only `life_status`, `sterilised`, `ear_tip` (`lib/teamCorrections.ts:48-52`), and `can()` gives staff everything (`lib/capabilities.ts:36-42`). A new `remove_owner` fits the named-capability rule (team-access §7.3) but the action also writes a life-status statement, so require both `remove_owner` and `set_life_status`, or say it deliberately does not.
- **Visibility.** `teamCatView` reads `ownerDeviceId` only to derive status (`lib/teamCatView.ts:313`, `:462`); the dashboard never shows that a cat has an owner. The action cannot be offered "on a cat that has an owner" until the view exposes `hasOwner` (never the device id).
- **Attribution.** "Recorded with who did it and when": the observation records only the status write. The owner-link clear has no attributed record. Add one or accept and say it.

### F13. MEDIUM, CONFIRMED. The "met it" query must be pinned down; `awaiting_team` is not in the schema

**Evidence.**
- `sightings.cat_id` can later change by team action ("moving a sighting to a different cat", `docs/specs/cat-record-data-spine.md:914`, `choose-a-different-cat.md` §8.2; not built yet, the only `update(sightingsTable)` is `routes/sightings.ts:752`). The match row keeps `chosen_cat_id`, the spotter's original choice. A naive "`choice = suggested` and the sighting's `cat_id` is X" would count a suggestion for cat A that the team moved to cat B.
- `MATCH_CHOICES` is `suggested | hand_pick | new_cat | unlabelled` only (`lib/db/src/schema/sightingMatches.ts:15-24`). `sent_to_team` / `awaiting_team` appear only in the spine's design prose. The only states today are `pending | resolved` (`lib/db/src/schema/sightings.ts:19`); a `pending` sighting has `cat_id = null`, so it never qualifies anyway.
- Merged cats (`cat_identity`, SYC-59) are read through the identity table by `loadCatRecords` (`lib/observations.ts`); the qualifying query must do the same.
- Discoverer: `cats.discoverer_device_id` is set only on new-cat resolve (`routes/sightings.ts:729`, which also resolves a sighting of that cat) or by `POST /cats` (`routes/cats.ts:202`). So the separate "discovered it" rule only adds something for `POST /cats` cats, which F11 removes. SYC-63's plan clears `discoverer_device_id` on deletion (`docs/superpowers/plans/syc-63-self-service-deletion.md:73`), so a deleted discoverer stops qualifying.

**Fix.** State the exact predicate: `sightings.status='resolved' AND sightings.device_id=$device AND sightings.cat_id IN (canonical ids of $cat) AND match.chosen_cat_id = sightings.cat_id AND match.choice IN (<the decided set>)`. Remove the `awaiting_team` bullet or mark it a future state. Consider dropping the separate discoverer rule once F11 lands.

### F14. LOW, CONFIRMED. "Followers are told" is not what happens

The claim push goes to every device with a resolved sighting, not to subscribers (`lib/notifications.ts:70-84`), and the in-app banner to every phone whose catalogue snapshot saw the cat as not homed (`OwnershipNoticeBanner.tsx:84-95`), including after a team status flip. Owner edits (rename, home details) also push to all spotters (`routes/cats.ts:508-518`), an owner-keyed effect that §2 does not list. Fix the wording in §2 and §4.3, or change the fan-out.

### F15. LOW, CONFIRMED. Read the derived status through the transaction

§10 says the rule is checked inside the claim transaction. `deriveCatStatuses` uses the global `db` pool (`lib/catHelpers.ts:296-326`), and `loadCatRecords` does too (`lib/observations.ts`). PR #99's review already hit the pool-exhaustion form of this (`lib/teamCorrections.ts:232-236`, comment). Say "read through `tx`" and lock the cat row (`select ... for update`) so a concurrent team status write and the claim serialise. Today's only guard is the conditional `owner_device_id IS NULL` update (`routes/cats.ts:392`), which stops two claims but not a claim racing a team statement.

### F16. LOW, CONFIRMED. Status codes and app mapping

The app maps `409 -> claimAlreadyClaimed` and `403 -> claimNotOwner` (`ClaimCatSheet.tsx` `onError`). §10 names `NOT_MET` and `ALREADY_HOMED` but gives no HTTP status. A 403 for `NOT_MET` would show "not the owner". Pick statuses, read the `code` from the body, and add the mapping to §4.4's table.

### F17. LOW, CONFIRMED. Copy and policy

- English today says "Claim this cat" (`artifacts/cat-spotter/lib/i18n.ts:155-156`), not "Adopt". Only Greek and French say "Adopt" (`:542`, `:919`). §8 should say so.
- §7 ("no screen uses it") and D5 ("12 cats already claimed on the live site") are statements about today's state in a spec that the repo CLAUDE.md says is aspirational and must not distinguish built from proposed. Move them to the plan or the ticket.
- §4.4 handles "no connection" precisely, but the cat page is cached offline, so the button can show offline: say it shows disabled with that line.
- `docs/specs/privacy-policy.md` says nothing about owners: exact location for owners, live alerts, the public home description (F3), the ownership link and its clearing on deletion.
- Terminology ("spotter", "spot", "cat guardian") is respected.

### F18. LOW, PLAUSIBLE. New phone or reinstall

An owner on a new device id has no secret and no sightings: the owner link stays tied to the old id, they cannot let go, and once the team removes the link they cannot re-claim until they spot the cat again. Say "ask the team" in the copy; F12's dashboard action is the path. Check with Syros Cats that the 12 existing owners are real people on phones that still exist before relying on D5.

---

## Answers to items 1 to 9 of the brief

1. **Does "met the cat" hold up?** No (F1, F2, F13). The dedupe-hit path re-runs matching and overwrites the stored set only while `chosen_at IS NULL` (`routes/sightings.ts:366-369`), using the sighting's own photo, so it cannot manufacture a suggestion for a cat the phone never photographed; the attack is the forged photo and forged location, not dedupe. `unlabelled` accepts arbitrary picks (F2). A phone becomes discoverer only through new-cat resolve (which also resolves a sighting) or `POST /cats`.
2. **Owner perks.** Keyed on `owner_device_id`: exact location (`routes/cats.ts:122-126`, `lib/catHelpers.ts:154-156`), live sighting alerts (`lib/notificationFanout.ts:108`), exclusion from the round-up (`lib/sightingRoundUp.ts:143`), rename and home details (`routes/cats.ts:447-478`), `ownedCatIds` (`lib/catHelpers.ts:618-622`), the app's owner UI (F7), and a push to all spotters on owner edits (F14). Clearing the one column removes all of them, so Remove owner and let go cover them if they null `owner_device_id`. The spec misses: `ownerName` is only ever set by `POST /cats` (`routes/cats.ts:204`), never by claim, so "clears the owner's name" is a no-op after D7; and `homeDescription` (F3).
3. **Team corrections.** Right that a life-status correction leaves the owner link (`lib/teamCorrections.ts` writes only observations). `remove_owner` fits the named-capability rule but needs the F12 additions. Superseding the owner's `homed` works with `writeObservation` and the append-only trigger (supersede is an appended row pointing at the old one), with the F12 ambiguity.
4. **"Let go".** Contradicts spine §3.2 and overrides team statements (F4).
5. **Refusing homed cats.** Needs `street`-only (F6), the owner carve-out (F5), a read through `tx` (F15). Before the PR 3 gate opens, `deriveCatStatuses` falls back to `owner_device_id != null` (`lib/catHelpers.ts:273-291`); confirm the gate is open in production (`lib/pr3Gate.ts`) before building rule 1 against the derived path alone.
6. **Removing `POST /cats`.** No app, site or admin caller. Tests, openapi, both generated clients, docs and spine text break (F11).
7. **Contradictions.** Spine §3.2 (F4), spine §11 row 4 and the PR 2 plan (F11), team-access §3.3 "never an undo" (F4), privacy policy gap (F17). No terminology errors; offline wording is precise.
8. **UX gaps.** Stale app state (F7), no API for the button (F8), stuck street-with-owner state (F10), new phone (F18), offline button state (F17).
9. **Other.** Spam loop (F9), unmoderated description pushed to all (F3).

## Checked and held up

- The claim route verifies the device secret before anything else (`routes/cats.ts:351-356`), and the owner tier needs the secret as well (`detailViewer`, `routes/cats.ts:122-126`); a wrong guess gets the public view with no error, so there is no owner oracle.
- The hand-pick label cannot be forged by the phone: `labelChoice` decides from the stored set and the score threshold (`routes/sightings.ts:376-433`, `:647-651`); below-threshold candidates land as `hand_pick`.
- Hand picks are restricted server-side to cats whose published position is within 1.5 km and refuse deceased cats (`routes/sightings.ts:657-690`).
- A label is written once (`setWhere: isNull(chosenAt)`, `routes/sightings.ts:366-369`, `:813`), so a second resolve or dedupe-hit cannot rewrite a recorded choice.
- `sighting_matches` is team-only and never reaches a public payload (`lib/db/src/schema/sightingMatches.ts:36-40`), so the rule itself needs no new public column (F8 covers the per-viewer flag).
- Concurrent claims: only one wins, because of the conditional `WHERE owner_device_id IS NULL` update in one transaction with the homed observation (`routes/cats.ts:380-405`).
- The observations append-only trigger and supersede model support Remove owner and let go as appended statements (`lib/db/migrations/0001_data_spine_tables.sql:81-126`).
- Owner perks (exact location, live alerts) are cleared by nulling `owner_device_id`; no other column grants them. The round-up already excludes the owner and `deleted:` devices (`lib/sightingRoundUp.ts:142-144`).
- Repo CLAUDE.md canonical facts are respected: "cat guardian" and "spotter" wording, no false offline claims.

## Tests and probes to add to §12

- Forged-photo probe: upload a cat's own public photo at its public position and assert the outcome the spec decides on (F1), so it is a decision, not a surprise.
- Same-device re-claim returns 200 with no new observation and no push.
- Claim on `deceased` and `in_care` refused with distinct codes.
- Let go supersedes the owner's `homed`, and a team `in_care` beneath it reappears.
- Remove owner on a cat with two `homed` rows (claim, let go, claim); on a legacy backfilled owner; on an owner with no `homed` row.
- Description moderation, and clearing on let go and Remove owner.
- App: `ownedCatIds` drops a cat the server stops listing.
- Claim / let-go loop: the second claim within the window sends no push.
- Predicate test: a `suggested` sighting later moved to a different cat does not qualify for the new cat.
