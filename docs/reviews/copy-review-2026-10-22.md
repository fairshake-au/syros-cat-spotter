# Copy review, 22 Oct 2026: wording that doesn't make sense

This is from the design review of 22 Oct 2026 (parent SYC-569). A Sonnet agent read every English string:
- the en block of `artifacts/cat-spotter/lib/i18n.ts`;
- `artifacts/api-server/src/lib/teamPages/strings/en.ts`;
- `artifacts/api-server/src/routes/mailPages.ts`.

Claude checked the top picks against the code. Line numbers are from 22 Oct and will drift.

**The main lens (Samuel, 22 Oct):** text is confusing when it isn't relevant to the people who see it. Check who actually sees each string (the render condition) against who it was written for.

**Already done on branch `claude/app-design-review-ffb35e`** (SYC-571):
- `claimNewPhone` and `claimNotMetHint`, now the "Does {name} live with you?" link and sheet;
- the ear-tip question;
- `keepSafeWarning`;
- `deleteDoneEmail`, removed;
- `reportCheckBlocked`;
- the dashboard map note.

Don't redo these. **Already ticketed elsewhere:**
- SYC-510: plain words part 1 (Fans, SYR numbers, the two report links, "Not known yet");
- SYC-572: plain words part 2 (most of the app rows below);
- SYC-521: the dashboard "What we know" section;
- SYC-348: "desex" in onboarding.

## A. Text shown to many, but written for a few (remaining)

| Where (key) | Now | Who sees it vs who it's for | Suggested |
|---|---|---|---|
| Sighting screen, iPhone Safari only (`homeScreenNudgeText`) | "Keep your spots safe: add Cat Spotters to your Home Screen. Otherwise Safari may clear them if you don't visit for a week." | The targeting is right, but "spots" and "clear" are internal words and the warning is vague | "On iPhone, add this app to your Home Screen. If you don't, your phone can forget your cats after a week without opening it." |
| Every user with spots waiting to send (`syncNow`, `queued`, `syncFailed*`) | "Waiting for connection", "Could not sync — the server rejected this sighting." | Written for a developer | See section B |
| Every invited cat guardian (dashboard `welcome.seeDo.guardian`) | One sentence of more than 100 words, ending with a report type they've never heard of | It mixes can-do and can't-do, and is far too long | Three short lines: "You can see…", "You can change…", "You can read but not change…". Drop the "Report an issue" clause |
| Dashboard welcome (`welcome.neverReopened`) | "A phone that is never opened again keeps its saved list until the browser clears it…" | Confusing and worrying, with no action | "If you lose your phone, tell Syros Cats. We can't wipe it from here." |

## B. App: unclear strings (ranked by how many people see them)

| Key | Now | Suggested |
|---|---|---|
| `offlineBanner` | "Offline — showing saved cats. New sightings will be queued." | "No signal. You can still look at saved cats. New spots wait on your phone and send when you're back online." |
| `pendingSightings` / `needsReview` / `queued` | "Pending sightings" / "Needs review" / "Waiting for connection" | "Not sent yet" / "Check if we know this cat" / "Waiting for signal" |
| `reviewReadyOne` / `reviewReadyMany` | "Your queued sighting is ready to review — tap to check it." | "Your photo's been checked. Tap to see if we know this cat." (and a plural) |
| `syncNow` | "Sync now" | "Send now" |
| `syncFailedServer` | "Could not sync — the server rejected this sighting." | "This spot couldn't be sent. Try again, or delete it." |
| `syncFailedStale` | "Too old to sync — this sighting has been waiting over 30 days." | "This photo is over 30 days old, so we can't add it. You can delete it." |
| `syncFailedCleared` | "Your browser cleared this photo, so this sighting can't be sent." | "Your phone deleted this photo before it could be sent. Please take it again." |
| `retrySync`, `replacePhotoHint` | "Retry" / "Keep this sighting's original time and location, and choose a new photo." | "Try again" / "Choose a different photo. The time and place stay the same." |
| `saveFailedOpenInBrowser` | "This browser can't keep photos offline. Open this link in Chrome…" | "This app can't save photos here. Open it in your phone's main browser (Safari or Chrome) and try again." |
| `queueReadOnly` | "Your saved sightings couldn't be loaded, so new ones can't be saved offline right now." | "We can't save new cats to your phone right now. Try again when you have signal." |
| `confidence`, `matchPill`, `lookalikesFound` | "match likelihood", "match", "look-alikes found nearby" | "How alike", "Possible match", "Similar cats nearby" |
| `uniqueCats` / `statFirstFinds` / `profileFirstFinds` / `badge_first_discovery` | "Discovered" / "First finds" / "Discoverer" | Use one term, "First finds", explained once: "cats nobody had spotted before you" |
| `lifeStatusInCare` | "In Syros Cats' care" | Say which it means (a shelter, a vet, or being fed). Ask the team |
| `sterilisedConfirmedFalse` | "Not sterilised — Syros Cats' records" | "Not sterilised, as far as Syros Cats know" |
| `careTimelineTitle` | "Care timeline" | "{name}'s story" |
| `careTypeDesexed`, `desexedBadge` | "Desexed" | "Sterilised" |
| `claimCat`, `ownedBy` | "This is my cat", "Owned by" | "{name} lives with me", "Lives with" |
| `campaignChipIn` | "Chip in" | "Donate" |
| `howStepDontFeedBody` | "…crowd colonies faster than we can sterilise them." | "Scraps make cats sick, draw them onto roads, and mean more kittens than we can help. Local cat guardians feed them the right food." |
| `howStepCatalogBody` | "…a new furriend or one we know." | "…a new cat or one we already know." (keep "furriend" for celebration screens only) |
| `howStepHelpBody` | "Your spots help us sterilise and vaccinate the colonies." | The vaccination claim is **unchecked**: confirm with Syros Cats. Suggested: "Each spot helps Syros Cats find cats that still need sterilising." |
| `howSafetyLiveHere` | "The cats of Syros are not pets, and they are not strays. They live here." | "The cats of Syros aren't lost or abandoned. The streets are their home." |
| `startupErrorBody` | "…doesn't support the secure setup Cat Spotters needs." | "This browser can't run Cat Spotters. Please update it, or try Chrome or Safari." |
| `signInRequiredTitle` | "Sign in again to send your saved sightings" (the app has no accounts) | "Pick your name again to send your saved cats" |
| `usernameClaimUncertain` | "…Retry the same name safely." | "We're not sure your name was saved. Tap to try the same name again." |
| `couldntCheckBody` | "Our look-alike check didn't work this time…" | "We couldn't tell whether this cat is already on the app." |
| `newFurriendSubtitleUnchecked` | "…the team will join them up." | "If this turns out to be a cat we already know, the team will tidy it up." |
| `pickerSearchPlaceholder`, `catalogSearchPlaceholder` | "Name or SYR number", "Search by name, ID, or area…" | "Name or cat number (like SYR-0012)", "Search by name, cat number or area…" |
| `reportBusy` | "Too many reports have come from this connection in the last hour…" | "Lots of reports are arriving right now. Yours is saved and will send by itself within the hour." |
| `turnstileTapLine`, `reportCheckUnavailable` | "Quick safety check: please tick the box…" / "We couldn't run the safety check…" | "Tick the box so we know you're a person." / "We couldn't check you're a real person. Your report is saved and we'll try again." |
| `reportCostsHeading` | "Costs, and the Municipality" | "Who pays for the vet?" |
| `photoTakenAt` | "Photo taken {when} (Greek time)" | "Photo taken {when}, Greek time" |
| `fact.cantTell` | "An honest 'not sure' keeps the island's record true…" | "'Can't tell' is a good answer. A wrong guess can make a cat look sterilised when it isn't." |
| `fact.cost` | "Sterilising one female cat costs Syros Cats €50–60." | "Sterilising one cat costs Syros Cats €50–60." ("female" implies males are free) |
| `catalogCount` | "{n} cats in Syros" | "{n} cats on Syros" |
| `profileRole` | "Cat scout" | "Spotter" |
| `catUpdateBanner` | "Update" | "News about a cat you've spotted" |
| `nameNoteTaken` | "Someone already had {from}, so you're {to}." | "{from} was already taken, so we've called you {to}. You can change it." |
| `deleteWhatGoesBody` / `deleteWhatStaysBody` | Long and legalistic ("the link between you and every sighting…") | "Your email, points, streak, badges and the list of cats you've met. Your name comes off your photos and reports." / "The spots stay on the map with no name on them. Without them, other cats' histories would have gaps." |
| `deleteWipeFailed` | "…this phone couldn't finish clearing up." | "Your data is deleted, but we couldn't tidy this phone. Please try again." |
| `restoreWarningNone`, `restoreKeepCurrentNone`, `restoreDeleteCurrentOne` (and variants) | "This phone is spotting as {current}…" / "Nobody can use {current} again, not even you…" / "{current}'s name and points are deleted…" | One short sentence per option: "Delete {name}: the name and points go. Keep {name}: the name stays on the map for good." |
| `restoreAskSent` | "…Open it in the browser you use for Cat Spotters…" | "…Open it on this phone, in the same place you use Cat Spotters…" |
| `restoreDifferentIntro`, `restoreInAppWarning` | Long, about phones, browsers and other apps | "You've opened this link somewhere different from where you asked for it…" / "This link opened inside another app (like Mail). Copy it and open it in your usual browser." |
| `movedBody` | "This phone isn't signed in as {username} any more." | "Your spots have moved to another phone, so this phone has stopped being {username}." |
| `issueReason_wrong_name` | "The name is wrong, or not OK" | "The name is wrong or rude" |
| `issueSavedBrowserNote` | "A browser can clear what it has stored…" | "Open this page again when you have signal, so it can be sent." |
| `issueConfirm` | "…Reporting this will hide it…" | "Are you sure? This photo will be hidden for everyone until Syros Cats have looked at it." |
| `extraDifferentVisit`, `extraNotKeptNote` | "…Photos in one spot need to be from the same visit." / "Your extra photos couldn't be saved for later…" | "All photos for one spot must be from the same visit. Choose another." / "We couldn't keep your extra photos, so only the first photo will be sent." |
| `spotSubtitle` | "Photograph a Syros cat and we will check if it is already known." | "Take a photo of a cat. We'll check if it's already in the Cat-alogue." |
| `welcomeHaveAccount` | "Already a spotter? Get your spots back" | "Already have a name? Get your cats back" |

## C. Dashboard (`teamPages/strings/en.ts`)

| Key | Now | Suggested |
|---|---|---|
| `gcat.say.intro` (every cat guardian, every cat page) | "What you say here counts straight away and is recorded as yours. Syros Cats can mark it wrong. You can put back your own change of status for {days} days." | "What you tell us goes live straight away, with your name on it. The team may correct it. You can undo your change for {days} days." |
| `gcat.problem.notYours` | "That change can't be put back any more." | "It's too late to undo that." |
| `gcat.ster.yesReported` | "Said to be sterilised, not yet confirmed" | "Reported as sterilised, not yet checked" |
| `appearance.statements` / `.agrees` / `.model` / `.prompted` / `.confirmHint` | "Changes that count now" / "agrees with #{id}" / "model {version}" / "tapped Yes on a suggestion" / "Records the team's agreement." | "What we know now" / "agrees with an earlier answer" / hide the model line, or "photo reader {version}" / "agreed to a suggestion" / "Marks that the team agrees." (with SYC-521) |
| `appearance.markWrongHint` | "Removes this one change from the count. Nothing is said in its place." | "Ignores this answer. The cat's page goes back to what it said before." |
| `appearance.overruleHint` | "…marks every standing cat guardian change on it wrong…" | "A cat guardian has already set this. Saving will replace their answer with yours. Please say why." |
| `appearance.recordsSay` | "Status" | "What we have now" |
| `reason.*` (colour check) | "Spotters disagree with the reading from the photo", "Markings changed on spotters' agreement…" | "Spotters don't agree with what the photo reader says", "Spotters recently agreed on new markings" |
| `colonies.flag.*` / `colonies.mark.*` | "Growing", "Not visited lately" / "Probably", "Not known" | State the real threshold ("Not visited for 30 days"). "Probably sterilised", "Not known yet" |
| `colony.takeOutNote`, `add.hint` | "…stays in the records…" / "…its history keeps the record of where it was." | "The cat stays on the app. It just isn't in a colony." / "The cat moves here. Its history still shows where it was." |
| `colony.noCentre` / `centre.*` | "Centre of the colony", not explained | Add: "The middle of where the cats live. It helps the team find the colony." |
| `problem.centre`, `sproblem.position`, `sproblem.tapUnreadable`, `sproblem.tapNoPoint` | Developer text ("a latitude and a longitude, both real numbers…", "chosen with the keyboard") | "Tap the map to set the centre, or leave it empty." / "That tap didn't work. Please tap the map again." |
| `new.typedWarning` | "Don't copy these from a map company's site; ask a colleague who has been there." | "Don't copy numbers from other map apps. Ask a colleague who has been there." |
| `sites.private` / `sites.public` / `site.privateSentence` | "Private" / "Public" | "Hidden from the public app" / "Shown on the public app" |
| `sdone.stale`, `sdone.movedPrivate` | Long; "until the new position is confirmed" (by whom?) | "Someone else changed this first. Have a look, and try again if you still want to." / "…hidden until the team checks the new spot." |
| `act.qr` | "Take down any QR sticker at this place." | "If there's a QR sticker here, take it down." |
| `sitehist.seeded`, `sitehist.existing`, `history.removed` | "Site loaded from the first list" / "On the list before this history began" / "Details removed at someone's request." | "Added from the original list" / "Already here before we started keeping a history" / "Details removed on a privacy request." |
| `mail.invite.how` | "…type this address, and tap the link we send you." | "…type your email address, and tap the link we email you." |
| `mail.notice.*` | "marked {subject} as left" / "signed {subject} out everywhere" / "device" | "removed {subject} from the team" / "signed {subject} out on all phones and computers" |
| `notes.hint` | "Don't write when people come and go." | "Please don't note people's comings and goings." |

## D. Email link pages (`routes/mailPages.ts`: hard-coded English)

| Where | Now | Suggested |
|---|---|---|
| Confirm page title | "Keep my spots safe" | "Confirm your email" |
| `COPY.confirm.ask` | "Someone using the Cat Spotters app asked to use this address to keep their spots safe. If that was you, press the button." | "Someone using Cat Spotters gave us this email so they can get their cat photos and points back if they lose their phone. Was that you?" |
| `COPY.confirm.done` | "This address is now keeping a Cat Spotters collection safe." | "Thanks. This email can now get your spots back if you lose your phone." |
| `REQUEST_CANCELLED` | "…we won't send this address any more 'Is this you?' emails. Any spotter this address already keeps safe stays safe." | "Done. We won't email this address again. Anyone already using it to save their spots still can." |

These pages are English-only today; whether to translate them is a separate question.

## One word for each thing

- **spot** in the app ("Spot a cat", "your spots"); **sighting** only on the dashboard. Not "observation".
- **not sent yet** and "waiting for signal", never queued, pending or sync. Use **send**, not sync or submit.
- **spotter**, never scout, snapper or username ("your name").
- **cat guardian**, never colony carer or owner. In the app, "lives with" rather than owned.
- **sterilised**, never desexed.
- **street cats**, never strays (Greek: γάτες του δρόμου, not αδέσποτες).
- **on Syros**, not in Syros.
- **First finds**, explained once.
- **Cat-alogue** as the tab's name, used the same way in body text.
- **Dashboard:** "answer" or "what we know" rather than record, statement, standing or status; "feeding site" in full, never "spot" for a place.
- **Report:** "This cat needs help" and "Report a problem with this photo".
- **Never claim the app works offline.** Say what's kept on the phone and that sending needs signal.
