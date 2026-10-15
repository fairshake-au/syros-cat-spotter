# Adversarial review: `feeding-nudge.md` (SYC-36) and `starter-facts.md` (SYC-48)

**Reviewer:** independent subagent, Sonnet tier, 15 October 2026. Read-only; checked both specs against the live code on `origin/main` `f757c0d`, `docs/PRODUCT-SPEC.md`, the proposal, the engagement design, the data spine and `CLAUDE.md`.
**Reviewed version:** commit `fca01d3` (first drafts).
**Outcome:** "Do not approve as written": 2 blockers, 15 majors, 18 minors, 5 nits. Every finding is handled in the revised specs; see **How each finding was handled** at the end.

The reviewer's findings follow, lightly condensed (wording and code references kept).

---

## Blockers

**1. "The nudge moves to the reward screen" doesn't match the live flow.** (feeding-nudge §3.3, Decision 2; starter-facts §3.3.) On a `'sent'` outcome `spot.tsx` pushes `/review`, which first shows candidate confirmation, then "Find the cat yourself", then the new-cat naming sheet; only after `resolveSighting` succeeds does the success (reward) screen render. So the nudge is deferred past one or more decision screens, possibly by minutes. For `isCatPhoto === false` there's no reward screen at all, so the nudge would be counted as shown and never seen. "Below the questions" is ambiguous relative to the primary "{cat} →" button. *Fix:* carry the nudge, keyed by sighting, onto the review screen's **first** screen (the candidate list), below the primary action; never on the not-a-cat screen and not counted there; test the candidate screen, the picker, the new-cat sheet and the not-a-cat screen.

**2. The waiting card will be below the fold on the phones the spec names.** (feeding-nudge §3.1, §4; starter-facts §3.1, §3.5.) The details state stacks the photo, time line, location label and chip, hint and a 220 pt `LocationPicker`, then the button. On a 667 pt iPhone SE the button is near the bottom edge; a card under it for a 2–10 s wait is effectively invisible. *Fix:* render the wait content **in place of** the map and photo block (or scroll it into view); test full visibility at 375 × 667 with default and large text; check at 390 px in the browser pane.

## Majors

**3. The first nudge will usually be the no-link version: config won't have loaded.** The campaign is fetched with `useGetCampaign({ enabled: isOnline })` on the Help tab only (`help.tsx`). A new spotter's first spot has no campaign data. Tying the nudge to the campaign also kills it when `CAMPAIGN_ENDS_AT` passes, needs an OpenAPI change, and `HIDDEN_FACT_IDS` names no endpoint. *Fix:* a small separate app-config endpoint, prefetched at start and cached; defined defaults when absent; don't count a showing made without config; reuse `sanitizeDonateUrl`.

**4. Tapping "Help feed a cat" mid-wait can kill the upload.** `Linking.openURL` backgrounds the app during `createSighting` (base64 upload plus matching); iOS can suspend and Android can kill it, so the spotter returns to `send-failed`. *Fix:* in-app browser, or don't open the link while a send is in flight.

**5. "A rejected photo shows no card" is wrong.** Rejection comes from the server after the whole wait, so the card was on screen and counted. Same for `send-failed` and the "Save and send later" dialog. *Fix:* the card appears for any online send; count the nudge only on `sent` with `isCatPhoto` true; retries show the same item.

**6. "Shown after 1 second" is far too low.** The nudge is ~70 words (20–25 s to read); a 30-word fact ~8–10 s. The wait length is unmeasured (unchecked). *Fix:* measure p50/p90 of `POST /sightings`; raise the threshold; or treat facts as ambient.

**7. "€1 feeds a cat for a day" collides with documented fee advice, and the spec is unclear which way the cost check points.** "Generous" and "high" are ambiguous: on food alone, €1 is more than a day costs, so the claim is conservative. PRODUCT-SPEC records €4 Greek bank fees; proposal §14 advises selling "feed a cat for a month, €30" because fixed card fees eat €1 gifts. *Fix:* reword §7 Q1 plainly; add a decision on €1-a-day versus €30-a-month.

**8. The ear-tip explainer's rationale doesn't hold for spot 1, and it duplicates the photo.** The ear-tip question already shows the same photo and caption on the first reward screen; many tourists only answer it on spot 1. *Fix:* add a decision on which goes first.

**9. Offline tourists never see the nudge**, and tourists without data are likely feeders. The offline path is a toast (`queuedOffline`); the later sync is silent. *Fix:* show the words-only nudge after an offline save; add as a decision.

**10. Fact 11 points at a control hidden while the card shows** (`{photo && !submitting && <NeedsHelpLink/>}`), gives no time frame, doesn't say "don't pick them up", ignores tourists leaving next day, and may read as "Syros Cats will come", against the capacity stance. *Fix:* reword; say "after your result"; ask Syros Cats that it doesn't imply collection.

**11. Fact 3 overclaims** population-level FIV slowing "across the island"; "FIV" is unexplained, and readers may think it affects people. *Fix:* individual-level wording, "(which doesn't affect people)".

**12. Fact 8 and fact 17.** Grapes/raisins are well established for dogs, thinly for cats; island-relevant hazards (cooked bones, cured meat, salty leftovers) are missing. Fact 17's "not your sardine" invites feeding sardines, against the nudge. *Fix:* reword fact 8; replace fact 17, ideally with a strand 4 "don't pick them up" fact.

**13. Fact 9 overstates "always welcome"** for unsolicited water bowls everywhere; "cats you pass every day" doesn't fit tourists; it brushes feeding-site privacy. *Fix:* conditional on Syros Cats' answer; reword to topping up a dry bowl at a feeding spot.

**14. Fact 20 states the wrong harm.** The real risk of a wrong "clipped" answer is an unsterilised cat treated as done. Greek "σίγουρος" is masculine; straight vs curly apostrophes will break the label-match test. *Fix:* reword; neutral Greek; normalise quotes in the test.

**15. Both specs claim a review that doesn't exist yet.** *Fix:* write this file, then update §11.

**16. No default when Syros Cats don't answer by 22 October.** *Fix:* sign-off facts without a yes don't ship at launch; nudge ships words-only with no figure.

**17. App Store and Play Store risk of a donation link** in the spot flow isn't discussed (unchecked by the reviewer). *Fix:* add a store-review item; keep the no-link build as fallback.

## Minors

18. No guardian/resident opt-out: locals are told "we'd gently ask you not to" three times. Suppress for guardians and claimers; add as a decision.
19. The two specs' waiting-card rules need exact reconciliation: eyebrow vs heading; `feedNudgeA11yLabel` says "While we look" even after the nudge moves; undefined edges (hidden fact 1 or 7; "all twenty seen" with some hidden; offline first spot); no storage key, versioning or "delete my data" behaviour.
20. Greek fact 1 is tautological ("the straight tip is a cut tip"); "this ear" is ambiguous with the spotter's own photo on screen.
21. French fact 2: "ses chatons peuvent être pleines" — gender error and a livestock word; English "her kittens can be pregnant" includes males. Say "her daughters".
22. Greek fact 2: "γατάκια ... έγκυα" reads oddly; use "οι κόρες της ... έγκυες".
23. Greek fact 10: "σφυρίζει" means whistles; the everyday verb is "φυσάει" (flag for Johnny).
24. Greek fact 11: "παγωμένα" is "frozen"; use "κρυώνουν".
25. Greek fact 9 switches to first person plural; Greek fact 15 "άφησέ με λίγο" loses "give it room".
26. Greek `feedNudgeEuro` clumsy ("τρέφεται"); the two Greek buttons plus the browser line overflow at 375 px with large text: stack them.
27. French: fact 17 pronoun ("ne les intéresse pas"); "Tu comptes partager…" is more natural; no rule for non-breaking spaces before « ? : ! », inside « », and in « 1 € »; fact 20 mixes « Je ne sais pas » with « pas sûr ».
28. Fact 4 applies to community cats, not tame or rehomed ones; fact 12 "genes" is loose; fact 13 invites approaching a deaf cat from behind; fact 14 encourages approach against the "don't get too close" screen.
29. Fact 18: kittens are born with eyes closed; they open blue.
30. Many sources are search listings only, thin for a charity-branded app. Open primary sources or mark "unchecked".
31. Fact 7 overclaims "can't digest"; the source says "to some degree".
32. Nudge translations: Greek "μαθαίνουν να το περιμένουν" ≠ "rely on"; "Εντάξει" is "OK" not "Got it" ("Κατάλαβα"); French repeats "nourrir".
33. The first-spot nudge repeats the onboarding "Please don't feed them" within a minute; explain why the repeat is useful.
34. Accessibility thin: 70 words announced in 3 s may be cut off; 44 pt targets; largest text size; reduced motion; keyboard reach on web.
35. Multiple tabs, cleared storage, storage failures: wrap reads, default to a fact, treat the record as best-effort.

## Nits

36. "Built today vs proposed" language ("Today that time shows a spinner", "already works"): ask whether the canonical rule applies to engineering specs (other specs use "today" freely).
37. §7's sign-off list vs the "sign-off" tags: fact 6 asked about but not tagged; facts 4 and 19 make practice claims and aren't asked.
38. "Help tab" (donations) vs "This cat needs help" (welfare report) in adjacent copy confuses a tourist with an injured kitten.
39. "Half are about…" is 11 of 20; strands 2 and 6 have one fact each; strand 4's "why not pick one up" is missing.
40. No analytics at all, so there's no way to learn whether the nudge or the donate link works. Suggest one privacy-light server counter of link opens.

## Missing decisions named by the reviewer

1. Ear tip or nudge first. 2. €1-a-day or a monthly rung. 3. External or in-app browser. 4. Whether guardians and claimers see the nudge. 5. The nudge after an offline save. 6. A privacy-light counter for the donate link. 7. Launch default for facts with no Syros Cats yes.

## Missing questions for Syros Cats

Who is the payee, and are they happy to be fundraised for through a third-party app? Do they want donation clicks counted? Are they happy with the "Syros Cats and local cat guardians…" line? Is a cat-page nudge wanted at all (MLP)? Are facts 4 and 19 their practice?

## Verdict (reviewer's)

Facts mostly sensible in the safe direction; the weaknesses are in the plumbing and a handful of claims. Two structural blockers (the nudge's carry-over target and the off-screen card), four plumbing majors (config delivery, the link backgrounding the app mid-upload, the 1-second threshold, the €1 line against fee advice). Facts 3, 8, 9, 11, 17 and 20 need rewording before they reach Syros Cats; specific translation errors in FR facts 2 and 17 and EL facts 1, 10 and 11. Re-present with this review file written.

---

## How each finding was handled

Checked against the code before acting: the campaign is fetched only on the Help tab (`help.tsx:61`); `/review` shows the candidate list, picker or new-cat sheet before the success screen, and a separate not-a-cat screen (`review.tsx:382`, `:512`); `NeedsHelpLink` is hidden while submitting. All confirmed. Apple's App Review Guidelines were opened (15 Oct 2026): **3.2.2(iv)** says apps that aren't approved nonprofits "may only collect funds outside of the app, such as via Safari or SMS". That rules out an in-app browser as the fix for finding 4.

| # | Handled how |
|---|---|
| 1 | **Fixed.** The nudge carries to the first screen of the result (candidate list, or the naming sheet when there are no candidates), below the main action, never blocking it. Not on the not-a-cat screen, and not counted there. Tests added. (feeding-nudge §3.3, Decision 2) |
| 2 | **Fixed.** During the wait the card takes the map's place, at the top of the visible area. Visibility test at 375 × 667 with large text, and a 390 px check. (starter-facts §3.1, §3.5) |
| 3 | **Fixed.** New small app-settings endpoint, fetched at start and kept on the phone; defaults defined; the nudge's button and €1 line live on the result screen, by which time settings have almost always loaded; a showing without settings isn't counted. (feeding-nudge §9; starter-facts §9) |
| 4 | **Fixed by design.** The button never appears during the upload. The wait shows the nudge's words only; the button appears with the carried-over nudge on the result screen, after the sighting has been saved on the server. It opens the real browser, as Apple's 3.2.2(iv) requires. |
| 5 | **Fixed.** Card appears for any online send. Nudge counts only when the result is a cat photo and the carried-over card is shown; a failed or rejected send doesn't advance anything; the retry shows the same item. |
| 6 | **Fixed.** Facts count as seen after 3 seconds. The nudge counts on the result screen, where it stays until dismissed. Measuring the real wait (p50/p90 of the sighting request) is a pre-build task in the plan. |
| 7 | **Fixed.** §7 Q1 reworded plainly. New Decision 4 (€1 a day alone, a €30 month alone, or both lines); recommendation: both. |
| 8 | **Decision added** (starter-facts Decision 4): nudge first or ear tip first. Recommendation stays nudge first, with the reason. |
| 9 | **Decision added** (feeding-nudge Decision 4): words-only nudge after an offline save. Recommended yes. |
| 10 | **Fixed.** Fact 11 rewritten: time frame, don't pick them up, "after your result", and no promise of collection. Syros Cats question extended. |
| 11 | **Fixed.** Fact 3 now says individual-level, and "doesn't affect people". |
| 12 | **Fixed.** Fact 8 reworded (onions, garlic, chocolate; cooked bones, cured meat, salty leftovers). Fact 17 (sweet taste) replaced by a strand 4 fact: why not to pick a street cat up. Sweet taste moved to "left out". |
| 13 | **Fixed.** Fact 9 reworded to a dry bowl at a feeding spot; ships only on Syros Cats' yes. |
| 14 | **Fixed.** Fact 20 now names the real harm. Greek neutral wording. Label test normalises quotes and apostrophes. |
| 15 | **Fixed.** This file. Status lines updated. |
| 16 | **Fixed.** Default: a sign-off fact without a yes by 22 Oct is hidden at launch through the settings switch; the nudge ships words-only. |
| 17 | **Fixed.** Store-review section added, quoting 3.2.2(iv); Google Play's policy marked unchecked for the store-listing work. |
| 18 | **Folded into Decision 3** (feeding-nudge): when guardian sign-ins arrive (roles, MLP), the nudge is off for them. Claimers are pet owners, not feeders, so they keep the cap. |
| 19 | **Fixed.** One table of card states in starter-facts §3.2; one storage key, versioned; deleted by "Delete my data"; a11y label no longer says "While we look". |
| 20 | **Fixed.** Fact 1 in all three languages says "the ear in this photo"; Greek rewritten. |
| 21, 22 | **Fixed.** Fact 2 says "her daughters" in all three languages. |
| 23, 24, 25 | **Fixed** as suggested, flagged for Johnny. |
| 26 | **Fixed.** "τρέφεται"; buttons stack on narrow screens. |
| 27 | **Fixed.** French nudge title, pronoun (fact 17 replaced anyway), non-breaking space rule added for the builder, fact 20 uses « je ne sais pas » throughout. |
| 28 | **Fixed.** Facts 4, 12, 13, 14 reworded. |
| 29 | **Fixed.** Fact 18: "open blue". |
| 30 | **Partly.** Sources marked "(search)" are now labelled **unchecked** in the table, and Syros Cats' review is the backstop. Opening a primary source for each is a pre-launch task (filed). |
| 31 | **Fixed.** Fact 7 says "digest badly". |
| 32 | **Fixed** ("εξαρτώνται", "Κατάλαβα", "une alimentation adaptée"). |
| 33 | **Answered** in feeding-nudge §2: onboarding says *don't*; the nudge says *why*, and offers something to do. |
| 34 | **Fixed.** 44 pt targets, largest text size, reduced motion, keyboard reach on web, no long auto-announcement. |
| 35 | **Fixed.** Best-effort storage; read failure shows a fact, never the nudge. |
| 36 | **Kept, with reason.** The canonical rule is about spec and proposal documents for Syros Cats; these are engineering specs, and other approved engineering specs describe the current screen. Wording trimmed where it read as "built vs proposed". |
| 37 | **Fixed.** Fact 6 tagged; facts 4 and 19 added to §7. |
| 38 | **Fixed.** The no-link nudge says "the Help tab shows how to give", and fact 11 says "This cat needs help" only. |
| 39 | **Fixed.** Wording corrected; strands 2 and 6 noted as intentionally thin; strand 4 gains the "don't pick them up" fact. |
| 40 | **Decision added** (feeding-nudge Decision 5): a count of link opens, no device id. Recommended yes. |
