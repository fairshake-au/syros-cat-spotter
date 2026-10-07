# Adversarial review: Feeding sites and colonies on the dashboard

**Target:** [docs/specs/feeding-sites-and-colonies.md](../feeding-sites-and-colonies.md) v1.0 draft (7 Oct 2026), branch `claude/syc-209-feeding-sites-spec` at `0d5d128`
**Reviewer:** adversarial pass, 7 October 2026
**Evidence used:** `docs/specs/cat-record-data-spine.md` (§6, §10.5, §10.8, §13), `docs/specs/team-access-and-welfare-queue.md` (§3.2, §3.4, §7.3, §9.3), `docs/specs/DECISIONS.md` (F2, Parts 2h, 2i, 2k, 2m, Part 3), the SYC-53 draft `docs/specs/roles-and-invites.md` on `claude/syc-53-roles-spec` at `f512083`, and live code on `origin/main` at `c5ee36c`: `lib/db/migrations/0001_data_spine_tables.sql`, `lib/db/src/schema/colonies.ts`, `lib/db/src/schema/people.ts`, `artifacts/api-server/src/lib/capabilities.ts`, `lib/teamCorrections.ts`, `lib/observations.ts`, `lib/teamCatView.ts`, `lib/teamAuth/refuse.ts`, `middlewares/requireTeam.ts`, `lib/logger.ts`, `lib/campaign.ts`, `lib/teamPages/catPages.ts`, `lib/teamPages/queuePage.ts`, `lib/welfare/alertEmail.ts`, `artifacts/cat-spotter/lib/mapTiles.ts`. PR #99 (merged 7 Oct, not open) for the dashboard patterns. Linear: SYC-209, SYC-22, SYC-51, SYC-53, SYC-67, SYC-245.

**CONFIRMED** = checked against code or a project document. **PLAUSIBLE** = judgement, not proven by an artefact.

Findings are ordered most severe first. **Blocker** = must be fixed before approval. **Major** = must be fixed before the plan. **Minor** = fix in the spec or carry into the plan.

---

## Summary

| # | Finding | Spec section | Severity | Status |
|---|---|---|---|---|
| 1 | A moved public site keeps its public code, so anyone watching sees where a harassed feeder went | §4.5, §11.1, test 5 | Blocker | CONFIRMED (spec text) |
| 2 | The capability names and guardian powers clash with the SYC-53 draft written the same week | §7.2, §7.3, §11.2, §12 | Blocker | CONFIRMED |
| 3 | Pages, counts and searches leak other colonies' sites to a guardian with a scoped role | §2.1, §2.6, §2.7, §2.8, §11.2 | Major | CONFIRMED (design gap) |
| 4 | "Cats stay blurred" is not true once a site is exact: the matching service and photos tie named cats to the bowl | §4.3 line 4, §4.6, Decision 3 | Major | CONFIRMED |
| 5 | A guardian's name can never be erased from the add-only history | §7.4, §8, §11.1 | Major | CONFIRMED |
| 6 | Consent goes stale when the guardian changes or the site changes colony | §4.3, §4.5, §7.1 | Major | CONFIRMED (spec silent) |
| 7 | Taking a cat out of a colony doesn't work as written | §2.8, §11.5 | Major | CONFIRMED |
| 8 | The tap-to-place map works under the security header, but "works on any phone browser" is not proven | §3, §11.4, test 17 | Major | PLAUSIBLE (browser behaviour), CONFIRMED (headers) |
| 9 | The migration is not "all additive" | §11.1 | Major | CONFIRMED |
| 10 | The seed list of every feeder has no safe route into the system | §11.8, Decision 11 | Major | CONFIRMED (spec silent) |
| 11 | SYC-53 puts exact feeding-site positions on volunteers' phones offline; this spec says that never happens | §3, §9 | Major | CONFIRMED |
| 12 | Going public before Syros Cats accept F2 | Decision 2, §6, §11.6 | Major | CONFIRMED |
| 13 | Smaller gaps: ordering, label checks, logs, caching, audit, wording | various | Minor | mixed |
| 14 | The 13 open decisions: agree or disagree | §13 | — | — |
| 15 | What held up | — | — | — |

---
## 1. A moved public site keeps its public code, so a watcher sees where a harassed feeder went: Blocker, CONFIRMED (spec text)

**What is wrong.** §11.1 says a site's `public_id` "stays the same if the site is later made private and public again", and test 5 requires it ("making a site public, private, public again keeps one code"). §4.5 says moving a public site makes it private until someone confirms the new spot, and then it goes public again. Put those together: the public list shows code `X` at spot A, then `X` disappears, then `X` comes back at spot B.

**Failure scenario.** A neighbour has been harassing Eleni at the Vaporia feeder. Syros Cats move the feeder 300 m round the corner to get away from him, and re-publish it so tourists can still find it. The neighbour has been saving the public list every few minutes. That costs nothing: it's one unauthenticated request with no parameters. He sees code `X` vanish from A and reappear at B. The one thing the move was for, getting away from him, is undone by the identifier. A printed QR sticker carrying `X` (§11.6) now points at the new place too. The spec's own reason for having a public code ("cannot be used to count or probe") doesn't apply, because here the code links two places together.

The same thing happens without a move. A site that goes private and later comes back with the same code tells anyone watching "this is the same feeder, quiet for a while, now back". That is a pattern of life for the feeder.

**Fix.** A site gets a **new** `public_id` whenever it is made public at a position more than a few metres from where it last stood in public, and always after it has been retired. Keep the old code(s) in a team-only list so the history can show them. An old code answers exactly like an unknown one (`feedingSpotGone`), so a sticker at the old spot no longer finds the new one. Rewrite test 5 to match: same position gives the same code; a move gives a new one, and the old code returns the "unknown" answer. Add a line to the confirmation page for any re-publish after a move: "Old QR stickers for this place will stop working. Take them down." Whether to keep the code after a plain private/public cycle with no move is a fair choice for Samuel, but the spec must say it is a choice and what it reveals.

## 2. The capability names and guardian powers clash with the SYC-53 draft: Blocker, CONFIRMED

**What is wrong.** §7.2 asks for three new capabilities: `manage_feeding_sites`, `manage_colonies` and `set_cat_colony`. §12 proposes them as a DECISIONS.md entry. The SYC-53 draft (`roles-and-invites.md` §6.2 and §6.7, on `claude/syc-53-roles-spec`), written the same week, gives different names and different rules:

| This spec | SYC-53 draft |
|---|---|
| `manage_feeding_sites` (add, edit, move, retire, bring back) | `add_feeding_site` and `edit_feeding_site`, both "placed", meaning each check is made against one colony |
| `manage_colonies` (create, guardian's name, notes, centre) | Not in the table at all |
| `set_cat_colony`, which a guardian holds for her own cats **and "unassigned cats near their sites"** (§7.3 point 4) | `assign_cat_to_colony` is **island-only** (team only). A guardian may only *propose* a cat (`propose_colony_member`), and "a cat in no colony can only be touched by island-wide holders" |
| `view_exact_location` used for sites and colony pages | `view_exact_location` described as "See exact positions of **cats**" |
| Test 12: a missing capability gets "the identical `401 not_signed_in`" | §6.4: someone signed in but not allowed gets a **403** page, because a 401 sends a guardian round a sign-in loop |

**Failure scenario.** Samuel approves both specs as written. DECISIONS.md then has two entries naming different capabilities for the same buttons, and nobody can say which wins. Worse, §7.3 point 4 hands a guardian a way to escalate. She puts an unassigned cat "near her sites" into her colony. Her scoped `view_exact_location` now covers that cat, so she sees its exact sightings. "Near" is measured with exact positions she isn't supposed to see yet. SYC-53 closed this gap on purpose by making assignment team-only, and this spec reopens it.

**Fix.** Don't name capabilities in this spec. Cite SYC-53 §6.2 as the source of truth (SYC-53 §6.7 already offers that), and turn §7.2 into "screens call these SYC-53 capabilities", matched up with that table. Drop §7.3 point 4. Drop `manage_colonies`, or get SYC-53 to add it as island-only. Cut §12 proposed entry 8. Change test 12 to "matches SYC-53's refusal rule". Until SYC-53 is approved, every capability check here is effectively "staff", which is what `can()` does today (`capabilities.ts`: `person.scopes.some(s => s.role === "staff")`), so nothing is held up.

---

## 3. Pages, counts and searches leak other colonies' sites to a scoped guardian: Major, CONFIRMED (design gap)

**What is wrong.** §7.3 point 1 says, correctly, that a guardian must not know other people's sites exist. But every list screen is guarded by `requireTeam("view_exact_location")` with no colony named (§11.2), and `requireTeam` can't take one (`middlewares/requireTeam.ts` calls `can(person, capability)` with no target). SYC-53 §6.4 points out that this exact call on an island-wide page is an over-grant waiting to happen. The spec only says filtering happens "in the query". It doesn't list everything that has to be filtered, and much of it isn't a list of sites:

- the count above the map, "31 sites: 2 public, 28 private, 1 retired" (§2.1);
- the "Recently changed" strip, with names and people (§2.1);
- the Colonies page, listing **every** colony with its guardian's name and its site and cat counts (§2.6, guarded by `view_exact_location`);
- "Add cats" search, which shows "which colony, if any, the cat is in now" (§2.8);
- the cat page's colony picker, "a list of all colonies" (§2.8);
- the name-clash message, which "says which colony already has the name and links to it" (§2.7);
- the map tiles route, which tells nobody anything but shares the same unscoped guard.

**Failure scenario.** Once guardians have accounts, Maria (guardian of Kini) opens Colonies and reads "Vaporia — Eleni's · Eleni · 3 sites · 27 cats". Or she tries to create "Vaporia — Eleni's" and is told it exists. A site's existence was supposed to be *absent*, and here it is.

**Fix.** Add a "what a scoped viewer sees" table to §7.3 with one row per item above: filtered, hidden, or turned into a generic message. For the name clash, a scoped person gets "That name can't be used" with no link. Each list route asks SYC-53's `canSomewhere` to get in, then filters by the person's colonies in the query. Add a test: a guardian of colony 1 never sees colony 2's name, guardian, count or sites on any page.

## 4. "Cats stay blurred" stops being true once a site is exact: Major, CONFIRMED

**What is wrong.** The confirmation page, line 4 (§4.3), tells the person pressing the button: "It will not make the cats' own pins exact. Cats near this spot stay blurred." Decision 3 says option A "cannot weaken the cat blurring". Two channels that already exist make that untrue:

1. **The matching service.** `POST /sightings` picks match candidates by *exact* distance within 500 m and sends back cat id, name and photo (DECISIONS Part 2h, accepted as Samuel's risk on the grounds that it "concerns how the app answers its own matching question, not what the map publishes"). With a public exact site, an attacker no longer has to search for where to probe. He submits each nearby cat's public photo at the bowl's exact coordinates and gets back a list of the named cats within 500 m of it, which is option C of Decision 3 in all but name.
2. **The photos.** Spine §6.4.5: the background of a photo is never blurred. Once the bowl is on a public map at its exact spot, every public cat photo taken at that bowl (wall, gate, bowl) now has an exact place. The blurred square for those cats protects nothing.

There is also a mismatch inside the spec: §4.6 bullet 3 says "the confirmation page's line 4 says so in plain words". It doesn't. Line 4 says the opposite.

**Failure scenario.** Syros Cats tick the box believing the cats stay hidden, because the page told them so. A hostile neighbour gets named, photographed cats tied to an exact bowl in an afternoon.

**Fix.** Rewrite line 4 as something like: "The cats here stay as blurred squares on the map, but anyone who knows this spot can match photos of cats to it. Treat a public spot as telling people that cats live here." State both channels in §4.6. Part 2h's risk acceptance was made before public sites existed and says it isn't part of the SYC-67 briefing. Raise with Samuel whether public sites change that, and add the matching channel to the SYC-67 conversation.

## 5. A guardian's name can never be erased from the add-only history: Major, CONFIRMED

**What is wrong.** §7.4 recognises that a guardian's name is personal data and asks for `colony_name_history.redacted_at`. But it stores the same name in many other places and doesn't deal with any of them:

- `feeding_sites.name` ("Vaporia — Eleni's") follows the same convention;
- `mapping_events.before`/`after` JSON for "site created / renamed", "colony created / renamed / guardian changed" (§8);
- site and colony `notes`, whose own example is "Maria goes on Tuesdays" (§2.2). That is a named person's routine at an exact place, the kind of detail spine §6.4.4 keeps out of public timestamps;
- the `mapping_events` trigger "refuses updates and deletes" (§11.1). The trigger it copies, `observations_append_only`, allows exactly one kind of update, a redaction (migration `0001`). The spec doesn't carry that over.

**Failure scenario.** Eleni asks Syros Cats to remove her from their records. The team blanks `guardian_name` and renames the colony. Her name stays in a dozen `mapping_events` rows, in every site's earlier names and in the notes, and the database trigger stops anyone removing it. The charity cannot honour a lawful request.

**Fix.** Give `mapping_events` a redaction path like the one on observations: `redacted_at`, `redaction_reason`, and permission for the trigger to blank `before`/`after`/`note` only. Specify one "forget this guardian" action that redacts the guardian's name everywhere it appears (colony, name history, site names, events), with its own event. Add a hint under the notes box: "Don't write when people come and go." List all of these stores in the `privacy-policy.md` ask.

## 6. Consent goes stale when the guardian changes or the site changes colony: Major, CONFIRMED (spec silent)

**What is wrong.** The "guardian knows and is happy" tick (§4.3) is recorded once, when the site goes public. §4.5 lists what forces the page to appear again: a move and a label change. Renaming, notes and **colony** changes "do not change visibility". Nothing reacts when the colony's `guardian_name` changes (§2.7) while one of its sites is public. Nothing defines what the tick means for a site with **no** colony or no guardian name, and §2.3 allows that.

**Failure scenario.** Eleni agreed to the Kini feeder being public. She stops; Nikos takes over and the colony is renamed after him. The site stays public under a consent Nikos never gave, and the history says "guardian aware: yes".

**Fix.** Changing a colony's guardian, or moving a public site to another colony, either makes its public sites private until someone re-confirms, or at least shows a banner on each one: "Public since 14 Oct with Eleni's agreement. The guardian is now Nikos. Check with him." Pick one. A site with no named guardian can't go public. If it can, the tick has to read "Syros Cats are responsible for this place" and the history records which wording was used.

## 7. Taking a cat out of a colony doesn't work as written: Major, CONFIRMED

**What is wrong.** §2.8 says taking a cat out is "Mark wrong" on the colony statement, after which "the cat is then in no colony". In the code:

- `supersedeStatement` (`lib/teamCorrections.ts`) always writes a **replacement** observation of the same kind, and `writeObservation` rejects a `colony` value unless `colonyId` is a number (`lib/observations.ts`, around line 214: `typeof value["colonyId"] !== "number"`). So the fallback in §11.5, `{ colonyId: null }`, is refused today, and accepting it means changing the spine's value check (spine-owned, §10.5).
- Marking the **newest** statement wrong doesn't leave the cat in "no colony" if there's an older one. The cat moved A → B and B is marked wrong, so the newest active statement is A again. Is the cat back in A, or in none? The spec answers "none" in prose but gives no rule for it.
- `SUPERSEDE_CAPABILITIES` and `capabilityFor` both need `colony` added. Otherwise the first, pre-lookup gate refuses a person whose only power is assigning cats. §11.5 mentions `capabilityFor` but not the first gate.
- `teamCorrections.ts` hard-codes `roleAtTime: "staff"`. A guardian's write (if SYC-53 ever allows one) would be recorded under the wrong role.

**Fix.** Ask the spine for an explicit `colony { colonyId: null }` meaning "in no colony", and a stated rule: the newest active colony statement stands, and `null` means none. "Take out" then writes `null` (an ordinary new statement); "Mark wrong" means "this was never true". Those are two separate buttons. Add both to test 15, including A → B, B marked wrong.

## 8. The tap-to-place map works under the security header, but "works on any phone browser" isn't proven: Major, PLAUSIBLE (browser behaviour) / CONFIRMED (headers)

**What holds.** The dashboard's header (`lib/teamAuth/refuse.ts`) is `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; …`. An `<input type="image">` posting to the same origin needs only `img-src 'self'` and `form-action 'self'`. Markers placed by an inline `style` attribute are allowed by `'unsafe-inline'`. So the technique needs no change to the header. That part is right.

**What is wrong.**

1. **Scaled images.** The browser sends the tap point in the image's *displayed* pixels. At 390 px with 16 px margins there is room for 358 px, so a grid of 256 px tiles has to be shrunk or scrolled sideways. If it is shrunk, the server can't know the drawn size and computes the wrong position. If it isn't shrunk, the page scrolls sideways, which is against the dashboard's own layout rule. Test 17 checks the server's maths for a given x and y, not what real browsers send.
2. **Caching.** Every dashboard response is `Cache-Control: no-store` (`setTeamHeaders`). The "long browser cache" for tiles in §11.4 needs a stated exception (`private, max-age=…`, never `public`, so a shared cache in front of the dashboard never serves a session-gated route to anyone).
3. **Logs.** §8 and risk 5 say positions are "never in a log line". `redactRequestUrl` (`lib/logger.ts`) removes query strings but keeps paths, so every `/api/team/map-tiles/19/x/y.png` is logged. A site page centred on its site therefore logs that site's position to within one tile, about 75 m at zoom 19, every time it is opened.
4. **Tap accuracy.** A fingertip is roughly 40 CSS px. At zoom 19 on Syros that's about 10 m, not "a few metres". It's fine, but say it truthfully.
5. **Accessibility.** Placing a site can't be done by keyboard or screen reader. Offer typed coordinates as a second way in, with a warning not to copy them out of a third-party map.

**Fix.** Show tiles at a fixed CSS size with no shrinking (a 1×N column on phones, or 2×2 tiles of 179 px drawn from a server-made 2× mosaic at that exact size), and assert it in the 390 px check. Before the plan is approved, test the tap point in Safari on iOS, Chrome on Android and Firefox. Add the tile route to `redactRequestUrl`'s rules (log `/api/team/map-tiles/:tile`). Spell out the tile cache headers. Rewrite test 17 to include a real-browser check.

## 9. The migration is not "all additive": Major, CONFIRMED

**What is wrong.** §11.1 ends "One migration. All additive. Existing rows are valid unchanged". But:

- `made_public_by` is `text` today (`0001_data_spine_tables.sql`). `people.id` is a `uuid` (`schema/people.ts`). Making it "a link to the people list" changes its type, and that cast fails on any value that isn't a uuid.
- The new rules ("is public needs a label", "retired is never public") fail on deploy if any existing row is already `is_public = true`. The spec assumes there are none without checking.
- `mapping_events` starts empty, so existing sites have no "created" event and "how did this become public?" has no answer for them.
- `mapping_events.person_id` is "null only for `system:` writers", but no column says *which* writer, so `system:seed` has nowhere to go.

**Fix.** Make the plan's first step a count of `feeding_sites` rows (all of them, public ones, and non-uuid `made_public_by` values) on production. Describe the `made_public_by` change as a separate, checked step. Write a `system:migration` "existing" event for each existing row. Add `actor_system text` with a rule that exactly one of `person_id` and `actor_system` is set.

## 10. The seed list of every feeder has no safe route into the system: Major, CONFIRMED (spec silent)

**What is wrong.** Decision 11 recommends that Syros Cats send "the list … positions included" and that we load it with a one-off script. The spec bans outbound links to third-party maps for feeding sites (§3), then sets up a load that will almost certainly travel as a WhatsApp message, an email attachment or a Google My Maps link: a complete map of every feeder, handled by third parties. It doesn't say where the file sits, whether it can be committed, or when it is destroyed.

**Failure scenario.** The list arrives as `feeders.csv`, is committed beside the seed script, and stays in git history for ever, or it is pasted into an agent session transcript.

**Fix.** State a route: Syros Cats place the sites themselves on the dashboard, or send names plus rough areas only and let the team place them. If a file is unavoidable, it is never committed (add a `.gitignore` rule and a check in the seed script), it's loaded from a scratch location, it's deleted after loading, and the history records `system:seed` with no copy of the file. Say in Decision 11's risks that the list travels outside the system.

## 11. SYC-53 puts exact feeding-site positions on volunteers' phones offline; this spec says that never happens: Major, CONFIRMED

**What is wrong.** §3 says "Positions are shown only on the dashboard's own map". §9 says nothing on the dashboard works offline and leaves the volunteer view to SYC-54. The SYC-53 draft (Decision 1, recommendation A, and §12) makes the colony view a saved web page that keeps "feeding site name and position" **exactly**, on a phone, for up to 7 days, and loosens the dashboard's no-script rule for those pages. This spec owns how feeding sites behave and doesn't mention that.

**Fix.** Add a §9 paragraph that acknowledges the SYC-53 offline view, states what it may hold about sites (recommend: names and positions for the person's own colonies only; never other sites, history or notes), and points at SYC-53 §12's 7-day expiry. Make SYC-53 and this spec agree before either is approved.

## 12. Going public before Syros Cats accept F2: Major, CONFIRMED

**What is wrong.** F2 and spine §6.2 say Syros Cats' acceptance of colony averaging must be **recorded before launch** (SYC-67, still in Backlog). Public sites make that risk sharper: an exact bowl plus nearby squares plus the matching service (finding 4). §11.6 makes SYC-22 wait for SYC-67, but the public switch itself has no such gate. Decision 2 option B would ship it before launch.

**Fix.** Add a precondition: the public half doesn't ship until SYC-67's acceptance is recorded, and the SYC-67 briefing includes a paragraph on public sites. Decision 2 option A already puts the public half after launch, so this costs nothing if A is chosen. It stops option B quietly getting round F2.

---
