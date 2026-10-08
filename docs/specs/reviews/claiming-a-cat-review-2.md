# Adversarial review 2: claiming-a-cat.md, additions in ef51614 (D10-D12)

Reviewer: Sonnet critic. Scope: residency question, "lives in your home" confirmation, home pin (1 km). Samuel's direction not argued. Worktree: agent-a3b539205941d5a89, detached at ef51614.

## Findings

### HIGH-1 (CONFIRMED) PIN_TOO_FAR is a position oracle; the spec does not say where the check sits or cap probes
Evidence: the check runs against "the cat's recorded position or any resolved sighting" (claiming §3 rule 3) = exact stored values (`lib/db/src/schema/cats.ts:28-29`, `sightings.ts:15-16`, both notNull doubles; DECISIONS.md:169 says the cat's position is the discovery position). The public map is a 250 m cell (`artifacts/api-server/src/lib/blur.ts:17`). Data spine §6.3 treats "answering a stranger's question about the exact value" as publication and calls a probing bisection "tens of probes". A 422-or-not on a chosen pin is exactly that question, with a 1 km circle as the boundary.
Failure: a phone that has met the cat (a D1 hand pick needs only a nearby sighting) sends pins and bisects the 1 km edge from several bearings. The exact discovery point and every sighting position (non-public per spine §6.4.1) fall out. Worse, if PIN_TOO_FAR is evaluated before NOT_MET / ALREADY_HOMED / NOT_ON_STREET, any device, even one that never met the cat, or probing a homed cat, can do it. A successful probe also claims the cat, but "let go" undoes it, so an attacker can loop. No claim limiter exists in code (`artifacts/api-server/src/middlewares/rateLimit.ts` has ai/photo/handoff/sighting limiters only; the 429 row in §4.4 has no number behind it).
Fix: (a) specify check order: device secret, NOT_MET, status/ALREADY_HOMED, then the pin; (b) test that PIN_TOO_FAR never appears for a cat the caller can't claim; (c) make the check coarse: run it on the 250 m cell centres (cat and sightings) with the radius widened by one cell, so the answer varies only with the cell, which the caller already knows; (d) give claim a per-device limit with a number (counting refusals) and a cooldown after let-go on the same cat; (e) the refusal body carries no distance, direction or nearest sighting.

### HIGH-2 (CONFIRMED) The in-app pre-check (§4.2 "the app says so before sending") cannot be done without leaking
Evidence: public payloads carry only the cell centre and no sighting positions (spine §6.4.1, §6.5; `blur.ts`). The client therefore can only check against the blurred cat position, and will disagree with the server, which uses exact positions plus sightings. A pin the app calls too far may be fine on the server (sightings 900 m away); a pin the app accepts may be refused. If the server supplies a "pin ok" endpoint or the sightings to make them agree, that is an unlimited oracle (HIGH-1) or a leak.
Fix: drop the client-side distance claim. Either the client checks only against the public cell with the generous radius from HIGH-1(c) and treats the server answer as final, or there is no pre-check. Fix the sentence "The server checks the same distance": it can't be the same distance.

### HIGH-3 (CONFIRMED) Distance basis is undefined
Evidence: §3 rule 3 says "recorded position or any of its resolved sightings". Not defined for: merged cats (rule 2 includes them, spine §10.3); sightings unlinked by deletion (still stored with positions, spine §8.3 "Kept: every sighting ... position"); sightings the team moved off the cat (`choose-a-different-cat.md` §8.2); unresolved sightings; a cat with one sighting; the claimant's own off-site sighting widening the legal area. "Any sighting" has no bound: a cat with 200 sightings across a 3 km colony makes the legal region huge, so "near the cat" stops meaning anything.
Fix: state positions = `cats.lat/lng` plus exact positions of sightings currently resolved to the cat or cats merged into it, redacted ones included (position is kept), moved and unresolved excluded; haversine on exact doubles; decide whether the claimant's own sightings count; consider the most recent N sightings to bound the region. Tests for merged, redacted, moved and single-sighting cats.

### HIGH-4 (CONFIRMED) Home pin and note vs deletion and the approved privacy text
Evidence: `privacy-policy.md:41` says on deletion "the note about where it lives stays with the cat, but your name and your link to it are taken off". This spec says the pin is cleared on deletion (§5, §11) and the note is cleared on let-go and removal (§6, §7, D9), but is silent about the note on deletion. Spine §8.3's table lists nothing about owner link, note or pin; §12 promises an edit for the pin only. So the note on deletion has three possible behaviours (stays per policy, cleared by analogy, silent). A free-text "the blue house by the church" is as identifying as the pin. `severPerson.ts` does not exist on this commit (no match under `artifacts/api-server/src/lib`), so there is no code path to hook. After deletion the cat is homed with no owner, so `ALREADY_HOMED` blocks any re-claim (§16): the leftover is permanent.
Fix: decide the note on deletion explicitly (recommend clearing both note and pin), and amend privacy-policy.md:41 and the spine §8.3 table ("Removed": owner link, home note, home pin) in the same change. Add a deletion test for note and pin, and "deleted twice is safe".

### MEDIUM-5 (CONFIRMED) Pronouns: "her" in the new strings
Evidence: §4.2 "You can still spot Agatha whenever you see her." and "Anything that helps find her?". Spec §4.1 says wording uses the cat's name, never he or she.
Fix: "Anything that helps find Agatha?"; "You can still spot cats like Agatha any time." Greek and French agree in gender, so strings must be written name-first for translators (SYC-4).

### MEDIUM-6 (PLAUSIBLE) Map picker availability and no non-map path
Evidence: native `LocationPicker.tsx` uses `react-native-maps` with offline Syros tiles only if downloaded (`OsmTiles`); web `LocationPicker.web.tsx` draws OSM tiles with no offline. Claim needs a connection anyway, but tiles may be grey on a weak link. The picker starts at the cat's position, so "Done" without touching the map passes the 1 km check trivially and the stored "home pin" is just the cat's position. The picker is pan-and-drag only: no alternative for screen-reader or motor-impaired users, and no "use where I am now". Pin required means those users can't claim.
Fix: Done disabled until the pin is moved or "My home is here" is tapped; add "Use where I am now"; state accessibility requirements (labelled controls, pin movable by buttons); show a message when tiles are missing.

### MEDIUM-7 (CONFIRMED) Copy and the "No" path
Evidence: "Only you and Syros Cats will see this" sits under the optional description only, so a user may think the pin is public (or not notice it is stored). Step 1 "No" says only residents can claim: a seasonal guardian or a diaspora family who own a house on Syros and have a cat living with them are told no, with no way to reach the team and no way back (nothing is stored, so each retry is a fresh flow).
Fix: say once, above the map, that only the owner and Syros Cats see the pin; give the "No" screen the team's contact; consider "I'm here most of the year" semantics (Samuel's call).

### MEDIUM-8 (CONFIRMED) Request contract and step count not stated
Evidence: three screens with three Cancels. The spec never says what the claim request carries: `livesOnSyros`, a confirmation field, the pin, the note. NOT_RESIDENT is "only outside the app", so the server trusts a client boolean; skipped screens are UI-only friction unless they are fields. The "in your home" confirmation (D12) is not in §3 or §11 at all and has no refusal code.
Fix: add the request shape (`livesOnSyros`, `confirmsInHome`, `homePin {lat,lng}`, `note`) and one refusal for a missing confirmation. Consider merging steps 1 and 2 into one screen with two checkboxes: same record, one less step.

### MEDIUM-9 (PLAUSIBLE) Pin precision, logging, who sees it
Evidence: the pin is the most precise personal datum (spec admits it). Doubles are about 0.1 m. Nothing sets stored precision, log handling (request bodies with the pin in access logs or an error tracker), backups, or which staff capability may see it (team-access §7.3).
Fix: store to about 1 m (5 decimals) or snap to 25 m; never log claim bodies (redact, don't drop, per project memory); name the capability; list exports that exclude it.

### LOW-10 (CONFIRMED) "Lives on Syros" not stored
Acceptable and data-minimal. For later disputes the only record is the claim row. Recommend storing `claimed_at` and the sheet/wording version accepted (not the answer). Abuse: the multi-step flow is client-only, so it is one POST; see HIGH-1 for limits.

### LOW-11 (PLAUSIBLE) Drafting
- The old rule 3 became rule 4; re-grep other specs for "§3 rule 3".
- "Cats on Syros live close to where they're seen" is false for a cat first photographed at the ferry or harbour (spine line 355 says such a cat is pinned there forever); a genuine owner of such a cat is refused PIN_TOO_FAR. Add "write to the team" in that refusal.
- Greek and French for "lives in your home" and "We trust our community" need native review (SYC-4).

### Tests (§16) are insufficient
Present: NOT_RESIDENT refusal; 999 m ok and 1,001 m refused; pin absent from public payload and messages; cleared on let-go, Remove owner, deletion.
Missing: exactly 1,000 m (which side is inclusive); pins near unresolved, moved, merged and redacted sightings; refusal order (PIN_TOO_FAR must not appear for NOT_MET, ALREADY_HOMED, NOT_ON_STREET or a bad secret); a probe-loop test like spine §6.3's (the answer must not vary within a cell); a claim rate limit; same-owner retry with a different pin (rule 4: update or ignore?); invalid pins (NaN, 0,0, outside Syros, swapped lat/lng) give 400 not 422; pin absent from logs; picker Done disabled until the pin is moved; no "her" in strings.

## Checked and held up
- Samuel's three steps are consistent across §1, §3, §4.2, §4.4, §11, §15, apart from the missing confirmation field and the renumbering.
- The pin is kept out of the public payload and messages, and cleared at let-go and Remove owner (§6, §7).
- Not storing the residency answer is data-minimal and fine.
- Cancel is the visual default on every step; NOT_RESIDENT is honestly marked as outside-the-app only.
- Pin treated the same as the note (owner and team only, D9).
