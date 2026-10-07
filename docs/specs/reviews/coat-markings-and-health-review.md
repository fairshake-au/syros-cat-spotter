# Review: coat, markings and health (`coat-markings-and-health.md`, SYC-2)

**Reviewer:** an independent adversarial reviewer (Opus, in its own worktree), 7 October 2026, against the local branch `claude/syc-2-coat-health-spec` at `393798f`.
**Checked against:** `cat-record-data-spine.md` (§3.4, §4, §7, §8, §9.3, §10.1, §10.2), `choose-a-different-cat.md` (§4.7, §8.4), `add-details-later.md` (§3, §6, §8), `team-access-and-welfare-queue.md` (§7.3, §8.5), `DECISIONS.md` (Parts 2g, 2i, 2k, 2l, 3), the superseded draft `docs/superpowers/specs/2026-07-28-cat-health-record-design.md`, the draft SYC-53 roles spec on `claude/syc-53-roles-spec` (`roles-and-invites.md`, not yet approved), and the code on `main` at `c5ee36c` (PR #99 merged): `lib/observations.ts`, `lib/resolve.ts`, `lib/teamCorrections.ts`, `lib/capabilities.ts`, `lib/catHelpers.ts` (`serialiseCat`), `routes/teamReports.ts`, `routes/notifications.ts`, `routes/cats.ts`, `cat-spotter/app/review.tsx`, `cat-spotter/components/MoreToAdd.tsx`, `cat-spotter/lib/catalogue.ts`, `lib/api-spec/openapi.yaml`. Linear: SYC-2, SYC-5, SYC-52, SYC-161, SYC-241 to SYC-244.

**Overall:** the shape is right. Splitting "health" into three facts, refusing a "Looks healthy" badge, keeping the ear tip out of the markings, and never making "Needs vet" public are all sound, and the spec is honest about what it does not own. But three things in it are wrong enough to block approval: the naming screen sits **before** the points, the "existing team note" it relies on for health is a note on a welfare report rather than on a cat, and a public "vaccinated against rabies" line is a medical claim the charity cannot stand behind. Several of the counting rules are also not yet precise enough to test.

---

## Blockers

### B1. The naming screen comes before the points, so the colour question does too (§5.1, D2)

**What the spec says.** §5.1: "Nothing changes before the points … no appearance question appears between a spotter and their points." It then puts the colour and markings lines on the screen where a spotter names a new cat.

**What the code does.** In `cat-spotter/app/review.tsx`, naming a new cat is the step that *calls* `resolveSighting`; the points (`result.pointsAwarded`, 25 for a new cat after SYC-38) only appear once that call returns. Naming is before the points, not after. §10.3 confirms it: "the same call carries the discoverer's colour and markings with the new cat's first sighting".

**Failure.** Every new-cat discovery gets two extra optional lines between the photo and the reward, which is exactly what the data spine §7 calls "the fastest way to kill this project". "Optional" doesn't fix it: a question on the path is a question on the path, and a tourist who doesn't know what *colourpoint* means stalls.

**Fix.** Ask on the new-cat result screen, *after* the points, as one optional line ("Agatha looks Ginger · Tabby — right?"), written through the answers endpoint like the details card. Drop it from the naming screen. Correct §5.1's claim and D2's option A.

### B2. The "existing team note" is a note on a welfare report, not on a cat (§6.4 rule 5, D5, §4.3, §10.5)

**What the spec says.** Condition is recorded as "plain, team-only text (the existing team note, `add_team_note`)", and `add_health_note` "is today the existing `add_team_note`".

**What exists.** `add_team_note` guards one route: `POST /api/team/reports/:publicId/note` (`routes/teamReports.ts`). It is a note **on a welfare report**. The team-access spec (§5, "a free-text team note on each report") and the SYC-53 draft ("`change_report_state` · `add_team_note`: work the welfare queue") say the same. There is no team note on a cat.

**Failure, three ways.**
1. A cat being treated with no open welfare report has nowhere for its condition to go. D5's recommended option cannot be built as written.
2. If a builder files condition notes on a welfare report to make it work, that breaks the spec's own §6.4 rule 2 ("the report is the queue's, the condition is the cat's").
3. Welfare reports keep for three years (team-access §8.5), so the cat's health history would quietly disappear on the report's clock.

`view_health_notes` also promises a split the data can't make: one note can't be "health" for one reader and "other" for another.

**Fix.** Define a team-only note on the cat: a new observation kind (say `team_note { text }`), refused from the `public` role and never in any public payload. It must be a data-spine amendment, because the data spine owns the vocabulary. Then gate *reading* it with `view_health_notes` and *writing* it with `add_health_note`, and say plainly that welfare-report notes are unchanged. It is still not a migration (the kind is code). Also add the spotters' own "Anything you noticed?" notes to what `view_health_notes` controls when guardians and vets arrive. Those notes are where most health information actually lands (data spine §7.1).

### B3. A public "Vaccinated against rabies" line is a medical claim (§6.3, §6.5, D6)

**What the spec says.** If D6 is approved, the cat page shows "Vaccinated against rabies, June 2026", positive only, never "protected".

**Failure.**
- **A bite.** A tourist is scratched or bitten, opens the cat's page and reads "Vaccinated against rabies". Whatever the wording, many people will take that as "I don't need to see a doctor". The app would be influencing a medical decision about a person, on the strength of a record the charity can't vouch for: a vaccination in 2023 still reads "Vaccinated against rabies, June 2023", and the matching that ties this cat to that record can be wrong (`records-import.md`'s whole correction path exists because it can be).
- **The wrong cat.** A vaccination recorded on a mis-matched cat is a public health statement about a different animal.
- **It contradicts the safety copy.** Onboarding tells people to keep their distance; a vaccination line reads as reassurance.
- Saying it is "never a claim of protection" is the spec's intention. It isn't how a stressed person reads it.

**Fix.** Change D6 to **A (team only)** for launch. The donor need (SYC-5: "€10 covers a rabies vaccine") is better met by an aggregate the charity reports ("142 cats vaccinated this year"), which carries no claim about any one animal. If Samuel still wants a public line after Syros Cats and their vet have seen the wording, then: no vaccine names (never "rabies"), and a fixed line beside it in all three languages: "If a cat bites or scratches you, see a doctor." Either way, add a test that the word "rabies" never appears in a public payload or public string.

---

## Major

### M1. The spec writes resolver rules it does not own, and changes an approved one without saying so (§4.2, §10.1, §10.2, §15)

`DECISIONS.md` Part 3 gives the cat record, observations and "how status is worked out" to the data spine, and its row for `choose-a-different-cat.md` says the `coat` observation "stay[s] with the data spine". `choose-a-different-cat.md` §8.4 says "The data spine owns the new kind and the rule for which reading wins". This spec adds two kinds and three resolver functions in its own §10. Its header says it does not own "the resolver's overall shape", but §4.2 *is* the resolver for these attributes.

It also **changes an approved rule**. `choose-a-different-cat.md` §8.4 (approved, Part 2i) says "a person's reading always beats the machine's". This spec says a single spotter "never replaces a real machine reading by themselves". That is a sensible change, but it isn't flagged as one, and SYC-161's ticket still says "People outrank the machine".

**Failure.** Two documents describe the same resolver. The next data-spine edit drifts from §4.2, which is exactly the fourteen-way contradiction Part 3 was written to stop.

**Fix.** Move §4.2's rules and §10.1–10.2's kinds into the data spine as an amendment (§10.1 vocabulary, §10.2 resolver), and have this spec reference them. Add a DECISIONS entry that names the change: "amends `choose-a-different-cat.md` §8.4: a single spotter fills a gap but never overturns a machine reading." Add a Part 3 ownership row: "Coat and marking vocabulary, health meaning and what is public: `coat-markings-and-health.md`; the kinds and resolver rules stay with the data spine." Update SYC-161's wording.

### M2. "Two different devices" can be gamed, and the team never sees it when it is (§4.2, §10.2, §10.3, §5.3, D1)

The spec's whole D1 rests on "two different devices agree". Four holes:

1. **One person, two browsers.** A device is an anonymous id; a second browser is a second device. "A device may only suggest for a cat it has a resolved sighting of" is a speed bump, not a wall. The same photo uploaded from two browsers gives two resolved sightings (sighting dedupe is per device and capture time, `offline-queue-on-web.md` R2), two voices and *Likely*. The same goes for "Delete my data" then reinstall: the old statement survives as a redacted row that "counts as one voice of its own" (§10.2), and the reinstalled device adds a second.
2. **Write-time supersession is racy.** "One voice per device is enforced at write time (a device's new statement supersedes its previous one)". Two writes from one device at the same moment (the naming call and a details-card send, a retry, a double tap) both find no earlier statement, so both land and count as two voices. This is the same class of bug the `add-details-later.md` second-pass review found (its finding 1, Critical).
3. **The resolver trusts the writer completely.** Nothing at read time stops two live rows with the same `deviceId` counting twice if any write path (the naming call, a backfill, a future route) forgets the supersede.
4. **The team's list misses the attack.** The "Colour check" list (§5.3, §10.3) shows cats whose colour is `reported` or *Not sure*. A good machine reading overturned by two colluding devices resolves to `likely`, so **it never appears on the list**. The one case D1 admits is possible ("a determined pair could still move a colour … the team's correction always wins") is the one the team is never shown.

**Fix.**
- At read time, the resolver counts **at most one voice per `deviceId`** among rows that still have one. Write-time supersession stays as well.
- Take the add-details-later lock: a device's appearance write locks on (device, cat) and re-checks under the lock.
- Two voices must also come from **two different photos** (`photoId` differs) on **two different days**. That costs real users nothing and makes the two-browser trick need two visits.
- The Colour check list also includes every cat whose resolved colour **came from spotters and disagrees with a machine reading**, and every cat whose markings moved on spotter agreement in the last 30 days.
- Name the redacted-row rule's limit honestly: a deleted person's statement still counts, so deleting and coming back is a second voice. Accept it in D1's risks.

### M3. Several rules can't be tested yet, because they don't say what happens (§4.2, §5.1, §10.1)

| Case | What the spec doesn't say |
|---|---|
| Two devices say *ginger*, two say *black* | Both meet "at least two different devices have each said the same colour". Which wins? Newest pair? Most voices? |
| *Ginger + Tabby* vs *Ginger* | Is that agreement? §4.2 says "the same colour (or pair of colours)", which suggests exact sets, so a ginger tabby described two ways never agrees. The filter (choose §4.7) shows a two-colour cat under *each* chip, which suggests per-colour. |
| *Black* + *White* vs *Black and white* | The validator accepts `["black","white"]`. Two people meaning the same cat disagree. |
| Two single spotters fill a *Not sure* gap with different colours | Rule 4 says "a single spotter's suggestion is shown". Which one? |
| A device ticked *white paws*, later ticks only *kinked tail* | "A device's new statement supersedes its previous one". Does that withdraw its *white paws*? With "spotters can only add", it shouldn't, but supersession says it does. |
| A device ticked marks, later says *Can't tell* | Does `{ cantTell: true }` supersede (and withdraw) the earlier ticks? |
| "Never more than one new question on the card per visit" (§5.1) | What is a visit? The card is per sighting and shows every open question (`add-details-later.md` §3); nothing stores visits. |
| Changing an appearance answer after the team has ruled | `add-details-later.md` refuses an ear-tip change once Syros Cats have checked it (`EAR_TIP_CHECKED`). Appearance doesn't say. |

**Fix.** One sentence each:
- Normalise first: `black`+`white` is stored as `black_and_white`, and colours are compared as sets.
- Agreement is per colour. A colour is *Likely* when two voices hold it; at most two colours are shown. On a tie, the colours whose newest supporting statement is more recent win, and the cat goes on the Colour check list.
- The newest gap-filler wins.
- A device's markings answer is **additive**: a later answer adds to what that device ticked and never withdraws it. *Can't tell* is recorded and withdraws nothing.
- Drop "one new question per visit"; use "at most one appearance question per sighting".
- A spotter can't change an appearance answer once a team statement on that attribute exists (as `EAR_TIP_CHECKED`).
- A device's new row may only supersede **that device's own** row (the ownership rule in `add-details-later.md` §6), with a test.

### M4. "Mark wrong" has no safe value for colour or markings (§4.4, §5.3)

The PR #99 pattern (`supersedeStatement` in `lib/teamCorrections.ts`) writes a **new row of the same kind, with a value**, by staff. That works for `ear_tip`, where the value `clipped: false` means "that's not a clip". For appearance it doesn't:

- **Markings.** A team statement "is the whole list". So marking one griefer's *missing eye* wrong must carry a list. Either the team member re-types the whole list (and it becomes *Confirmed*, freezing it, see M5), or the row carries `[]` and wipes every legitimate mark other spotters agreed on. Neither is what "this one statement is wrong" means.
- **Colour.** Marking a spotter's *ginger* wrong writes a staff colour, which becomes *Confirmed* at whatever value was typed, or a staff *Not sure*, which §4.2 says "never beats anything", so the wrong row is superseded but nothing replaces it.
- `capabilityFor()` returns null for any kind but life status, sterilised and ear tip, so today the route refuses these kinds entirely. That is fine, but the spec has to say what to change it to.

**Fix.** Add a retraction value for both kinds (say `{ retracted: true }`, staff only). It removes the statement it supersedes from the count and asserts nothing. "Mark wrong" writes that. "Correct" writes a real team statement. Test: marking one of three spotters' marks wrong leaves the other two marks shown.

### M5. One team statement freezes a cat's markings for good (§4.2 markings rule 1)

"A trusted person's statement is the whole list" and it wins outright. Markings change: a cat loses an eye, a leg, or tears an ear *after* the team confirmed its list. From then on, no number of spotters can add the new mark, and nothing in the spec reminds the team to look again.

**Fix.** A mark ticked by two voices whose sightings are **dated after** the newest team statement is shown, and puts the cat back on the Colour check list for the team to confirm. Removals still need the team.

### M6. Several markings are injuries, and some can't be read from a photo (§3.2, §3.3, §6.4)

- **Injury chips compete with the welfare route.** *Missing an eye*, *Three legs*, *Short or missing tail*, *Torn or notched ear* and *Kinked tail* (a break) are, when fresh, injuries. A tourist can't tell a healed socket from last night's wound. The spec's own line, "A cat whose eye looks sore is a welfare report", relies on a judgement a tourist can't make, and a chip is right there. A worried person who taps *missing eye* has told the app something urgent through a channel the team reads "a few minutes a week". That is the thing §6.4 says must not happen.
- **Not answerable from a photo.** A sitting cat tucks a leg under (*three legs*), squints or blinks (*missing eye*), or curls its tail out of frame (*short tail*). *Eyes of different colours* contradicts §3.3's own reason for leaving out eye colour ("Eye colour shifts with light and phone cameras"). Under "spotters can only add" these false positives stay until the team removes them.
- **Public health detail.** "Missing an eye" and "Three legs" on a public page are medical history in all but name, which §6.2's one-sentence rule says the public doesn't see.

**Fix.** For spotters, keep the marks that are plainly visible and cosmetic: white paws, white chest, white face, dark face/ears/tail, long fur, kinked tail. Make *missing eye*, *three legs*, *short tail* and *odd eyes* **team-only** marks (the team knows the cat). Keep *torn or notched ear* for spotters, because it gives a ragged ear somewhere honest to go, as the spec intends. Whenever a spotter ticks *torn ear* or *kinked tail*, show the "This cat needs help" link right there ("Does it look hurt? Tell Syros Cats"). Add a test that it renders.

### M7. The cache-key bump can wipe the offline catalogue, and SYC-161 bumps it too (§10.4, §8)

§10.4 moves the key to `cats-cache/public/v3`. In `cat-spotter/lib/catalogue.ts`, retired keys are **deleted without being read** (`forgetRetiredCatalogues`), and that is right for the old unversioned key, which held exact positions. If `v2` is retired the same way, a spotter who updates the app with no signal (on a ferry, say) loses their whole offline catalogue, picker and map, until they next get signal. That contradicts §8's "seeing a cat's colour … works offline".

Three more problems:
- New fields are **additive**. Old clients ignore them, and a new client can treat a missing `coat` as "not known". The data spine's reason for a bump (§6.5, a *shape* change that could leak or break) doesn't apply.
- SYC-161 (Backlog) also says "Bump the cat-alogue cache version", for the same field, so two bumps are planned.
- The two specs disagree on the field: SYC-161 and `choose-a-different-cat.md` §8.4 say the payload carries "at most two values, or 'not sure'", while this spec says "the resolved colours, or none".

**Fix.** No key bump for additive fields: the client treats missing `coat`/`markings`/`vaccinated` as unknown, with a test that reads a v2 cache written by today's build. If a bump is ever needed, read the old key as a fallback until the first successful fetch, and only then delete it. Settle one shape (recommend `coat: []` for not known, never the string `not_sure` on the wire) and write it once in the data spine's §10.7.

### M8. The role assignments conflict with the SYC-53 draft (§4.3, §5.4)

§4.3 says "which role holds which is SYC-53's to decide", then decides: guardians can set appearance, "volunteers can **confirm** but not correct", vets get vaccination and health notes. The SYC-53 draft being written right now (`roles-and-invites.md` on `claude/syc-53-roles-spec`) has none of these four capabilities in its table, gives volunteers no appearance power, and routes guardians' sterilisation statements through a "Needs an OK" queue, not straight to *Confirmed*. The resolver here also has no rule for a volunteer's "confirm": volunteers aren't in §4.3's authority table, so their confirmation is a suggestion or nothing.

**Fix.** Delete the "Later" column, or relabel it "Proposed to SYC-53". Add a comment on SYC-53 listing the four capabilities and the open question "do guardians' appearance statements need an OK like their ear-tip checks?". Recommend: no, because appearance is cosmetic, but SYC-53 decides.

### M9. The old public care route can still publish health, with a push (§6.3, §6.4)

The legacy shared-password route `POST /cats/:catId/updates` (`routes/notifications.ts`) writes a `cat_updates` row that shows on the **public** care timeline and fans out **push notifications** to followers. SYC-5's ticket says a vaccination "can only be recorded as a `general` note" there today, and SYC-5's to-do is to add `vaccinated` to that enum. This spec's design (an observation, never notifiable) is the right one, but it doesn't close the old door.

**Fix.** State that health and vaccination are never written through `cat_updates`. Retire the `general` type for team use when D7 retires the shared password, or sooner. Update SYC-5's description to point at this spec's approach. Note for the builder: old app builds map an unknown care-timeline type to `general` (`CARE_META[event.type] ?? CARE_META.general` in `app/cat/[id].tsx`) and show its message raw, so any new timeline row needs a message that reads well untranslated, or should be left out for old builds.
