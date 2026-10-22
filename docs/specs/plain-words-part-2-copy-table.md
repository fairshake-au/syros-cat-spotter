# Plain words, part 2: before and after (SYC-572, SYC-510)

For approval. English only here; the Greek and French drafts follow once the English is approved, and go in `docs/superpowers/plans/syc-569-second-pack.md` for Johnny after the 22 Oct freeze.

Source: `docs/reviews/copy-review-2026-10-22.md`. Who-sees-it comes from the render conditions in the code (checked 22 Oct). Not in this table: the "What we know" section of the team cat page (SYC-521), onboarding "desex" (SYC-348), and everything already fixed on the base branch.

**Three things I could not decide from the code** (questions for Samuel, marked ASK):
1. `lifeStatusInCare`: what "In Syros Cats' care" means.
2. `howStepHelpBody`: whether Syros Cats vaccinates.
3. `fact.cost`: whether sterilising a male costs the same as a female. The fact is on the Syros Cats sign-off list, so a change to what it claims needs their yes.

**Where the review's suggestion was wrong or needed changing** (marked CHANGED):
- `signInRequiredTitle`: the review said "Pick your name again". The banner actually opens the website's pre-launch password page. It is only for testers before launch, so the right fix is to say that.
- `welcomeHaveAccount`: "Already have a name?" would puzzle a new visitor, who is who sees this link.
- Three keys (`confidence`, `uniqueCats`, `desexedBadge`) are not used anywhere on screen. They are removed rather than reworded.

## A. App: when your phone has no signal or a spot didn't send

| Screen | Who sees it | Now | Proposed | Why |
|---|---|---|---|---|
| Top of cats, home, profile, spot, help (`offlineBanner`) | Anyone with no signal | Offline — showing saved cats. New sightings will be queued. | No signal. You can still look at saved cats. New spots wait on your phone and send when you're back online. | "Offline" and "queued" are system words. This also says what is kept on the phone, and that sending needs signal. |
| Spot tab, list heading (`pendingSightings`) | Anyone with a spot not yet sent | Pending sightings | Not sent yet | "Pending" and "sightings" are not the words used elsewhere. |
| Spot tab, badge (`needsReview`) | A spot whose photo has been checked | Needs review | Check if we know this cat | Says the action, not the system state. |
| Spot tab, badge (`queued`) | A spot waiting to send | Waiting for connection | Waiting for signal | Same word as the banner. |
| Banner on every screen (`reviewReadyOne`) | A person whose photo has been checked | Your queued sighting is ready to review — tap to check it. | Your photo's been checked. Tap to see if we know this cat. | No "queued", no "review". |
| Same banner, plural (`reviewReadyMany`) | Same, 2 or more | {count} queued sightings are ready to review — tap to check them. | {count} photos have been checked. Tap to see if we know these cats. | Same. |
| Spot tab button (`syncNow`) | Online with an unsent spot | Sync now | Send now | "Send" is the one verb. |
| Spot tab, failed badge (`syncFailedServer`) | A spot the server refused | Could not sync — the server rejected this sighting. | This spot couldn't be sent. Try again, or delete it. | No "server". Says what to do. |
| Spot tab, failed badge (`syncFailedStale`) | A spot waiting over 30 days | Too old to sync — this sighting has been waiting over 30 days. | This photo is over 30 days old, so we can't add it. You can delete it. | Same facts, plain words. |
| Spot tab, failed badge (`syncFailedCleared`) | The phone threw the photo away | Your browser cleared this photo, so this sighting can't be sent. | Your phone deleted this photo before it could be sent. Please take it again. | Says what to do. |
| Spot tab button (`retrySync`) | A failed spot (hidden for too-old or deleted-photo) | Retry | Try again | Plain word. |
| Spot tab, rejected photo (`replacePhotoHint`) | A spot whose photo was rejected | Keep this sighting's original time and location, and choose a new photo. | Choose a different photo. The time and place stay the same. | Shorter. |
| Alert on saving (`saveFailedOpenInBrowser`) | Someone whose app can't store photos (an in-app browser) | This browser can't keep photos offline. Open this link in Chrome (or your phone's main browser) and try again. | This app can't save photos here. Open it in your phone's main browser (Safari or Chrome) and try again. | "Offline" is the claim we must not make. Names both browsers. |
| Alert and red line on spot tab (`queueReadOnly`) | Someone whose phone storage couldn't be read | Your saved sightings couldn't be loaded, so new ones can't be saved offline right now. | We can't save new cats to your phone right now. Try again when you have signal. | Plain; no "offline". |
| Spot tab, a spot waiting (`signInRequiredTitle`) CHANGED | Testers before launch only (web, and only when the pre-launch password page blocked a send) | Sign in again to send your saved sightings | Your saved cats are waiting. Sign in to the test site to send them. | The review's "pick your name" was wrong: this banner opens the pre-launch password page. The button (`signInRequiredAction`, "Sign in") stays. |

## B. App: matching, names and numbers

| Screen | Who sees it | Now | Proposed | Why |
|---|---|---|---|---|
| Review screen, per candidate (`matchPill`) | Anyone whose photo got possible matches | {n}% match | {n}% · Possible match | "Match" on its own sounds certain. The number stays; the code that adds it is not touched. I'll confirm in the code whether the key holds the whole pill or just the word. |
| Review screen heading (`lookalikesFound`) | Same | N look-alikes found nearby | Similar cats nearby | "Look-alike" is jargon. |
| Review screen, check failed (`couldntCheckBody`) | Someone whose check failed | Our look-alike check didn't work this time, so we can't tell if this cat is already in the cat-alogue. | We couldn't tell whether this cat is already on the app. | Shorter. |
| Naming screen after failed check (`newFurriendSubtitleUnchecked`) | Same | We couldn't check for look-alikes, so if this cat turns out to be one we already know, the team will join them up. | We couldn't check this cat. If it turns out we already know it, the team will tidy it up. | "Join up" is internal. |
| Cat picker (`pickerSearchPlaceholder`) | Anyone choosing a different cat | Name or SYR number | Name or cat number (like SYR-0012) | Nobody has been told what SYR is. |
| Cats tab search (`catalogSearchPlaceholder`) | Everyone | Search by name, ID, or area… | Search by name, cat number or area… | Same word as above. |
| Cats tab header (`catalogCount`) | Everyone | {n} cats in Syros | {n} cats on Syros | One preposition for the island. |
| Spot tab subtitle (`spotSubtitle`) | Everyone | Photograph a Syros cat and we will check if it is already known. | Take a photo of a cat. We'll check if it's already in the Cat-alogue. | Plain; uses the tab's name. |
| Home and profile tile (`statFirstFinds`, `profileFirstFinds`) | Everyone | First finds | First finds (unchanged), explained once on the profile tile: "Cats nobody had spotted before you." | The name is fine; it just isn't explained. |
| Profile badge (`badge_first_discovery`) | Everyone sees the badge, earned or locked | Discoverer | First finder | Matches "First finds". |
| Unused keys (`uniqueCats`, `confidence`, `desexedBadge`) | Nobody (not used on any screen) | Discovered / match likelihood / Desexed | Remove from English, Greek and French | Fewer strings for Johnny, and "desexed" can't come back. |
| Profile hero (`profileRole`) | Everyone | Cat scout | Spotter | "Spotter" only. |
| Profile note (`nameNoteTaken`) | Someone whose chosen name was taken | Someone already had {from}, so you're {to}. | {from} was already taken, so we've called you {to}. You can change it. | Tells them what they can do. |
| Username box (`usernameClaimUncertain`) | Someone whose name save wasn't confirmed | Still checking whether your name was saved. Retry the same name safely. | We're not sure your name was saved. Tap to try the same name again. | "Safely" worries people. |

## C. App: the cat page

| Screen | Who sees it | Now | Proposed | Why |
|---|---|---|---|---|
| Cat page, life line (`lifeStatusInCare`) ASK | Cats marked in care | In Syros Cats' care | Depends on the answer: "Staying with Syros Cats" / "At the vet" / "Being fed by Syros Cats" | Readers can't tell which. |
| Cat page, sterilised line (`sterilisedConfirmedFalse`) | Cats Syros Cats have confirmed not sterilised | Not sterilised — Syros Cats' records | Not sterilised, as far as Syros Cats know | "Records" is internal, and "as far as we know" is honest. |
| Cat page heading (`careTimelineTitle`) | Cats with a history | Care timeline | {name}'s story | Warmer; says what it is. |
| Cat page timeline (`careTypeDesexed`) | Cats with a sterilisation event | Desexed | Sterilised | The app's word. |
| Cat page button (`claimCat`) | Anyone who may claim this cat | This is my cat | {name} lives with me | Matches "lives with". Check: the base branch already says "Does {name} live with you?" in the sheet. |
| Cat page banner (`ownedBy`) | Anyone viewing a cat that has a home | Owned by | Lives with | "Owned" is the wrong word for a street cat. |
| Cat page label (`catUpdateBanner`) | Someone who opened the page from a push notification | Update | News about this cat | Says what it is. (The review's "you've spotted" would be wrong if a guardian opened it.) |
| Help tab, donate card (`campaignChipIn`) | Anyone, when a campaign with amounts is running | Chip in | Donate | "Chip in" is idiom, unclear to non-native readers. |
| Report, urgent advice heading (`reportCostsHeading`) | Someone reporting a cat in trouble | Costs, and the Municipality | Who pays for the vet? | The question they have. |
| Report busy (`reportBusy`) | Someone who sent many reports in an hour | Too many reports have come from this connection in the last hour. Yours is saved on your phone and will send itself within the hour. | Lots of reports are arriving right now. Yours is saved and will send by itself within the hour. | Not their fault, not about "connections". |
| Report check (`turnstileTapLine`) | Someone asked to prove they are a person | Quick safety check: please tick the box to show you're a real person. | Tick the box so we know you're a person. | Shorter. |
| Report check failed (`reportCheckUnavailable`) | Same, when the check can't run | We couldn't run the safety check. Your report is still saved and we'll try again. | We couldn't check you're a real person. Your report is saved and we'll try again. | Says what the check is. |
| Photo time (`photoTakenAt`) | Someone who picked a photo from their gallery | Photo taken {when} (Greek time) | Photo taken {when}, Greek time | Brackets add noise. |
| Report-an-issue reason (`issueReason_wrong_name`) | Someone reporting a problem with a cat page | The name is wrong, or not OK | The name is wrong or rude | "Not OK" is vague. |
| Report-an-issue saved note (`issueSavedBrowserNote`) | Web users whose report is saved but not sent | A browser can clear what it has stored, so open this page again once you have a connection. | Open this page again when you have signal, so it can be sent. | Drops the explanation. |
| Report-an-issue confirm (`issueConfirm`) | Someone about to hide a photo | Are you sure? Reporting this will hide it from everyone until Syros Cats have reviewed it. | Are you sure? This photo will be hidden for everyone until Syros Cats have looked at it. | "This" is clearer as "this photo". |
| Spot tab, extra photo problem (`extraDifferentVisit`) | Someone adding a photo from another visit | This photo was taken at a different time ({when}). Photos in one spot need to be from the same visit. Choose another photo. | This photo was taken at a different time ({when}). All photos for one spot must be from the same visit. Choose another. | Same meaning, plainer. |
| Spot tab note (`extraNotKeptNote`) | Someone whose extra photos couldn't be kept | Your extra photos couldn't be saved for later, so this spot will send with its first photo. | We couldn't keep your extra photos, so only the first photo will be sent. | Plainer. |

## D. App: first-run, learning and settings

| Screen | Who sees it | Now | Proposed | Why |
|---|---|---|---|---|
| Install nudge (`homeScreenNudgeText`) | iPhone Safari only (not installed, not snoozed) | Keep your spots safe: add Cat Spotters to your Home Screen. Otherwise Safari may clear them if you don't visit for a week. | On iPhone, add this app to your Home Screen. If you don't, your phone can forget your cats after a week without opening it. | The audience is right; "spots" and "clear" are the problem. |
| Onboarding and help (`howStepCatalogBody`) | Everyone at first run, and on the help tab | We check if it's a new furriend or one we know. | We check if it's a new cat or one we already know. | "Furriend" stays on the celebration screens only. |
| Onboarding and help (`howStepDontFeedBody`) | Same | Scraps make cats sick, draw them onto busy roads, and crowd colonies faster than we can sterilise them. Local cat guardians feed them properly. | Scraps make cats sick and draw them onto busy roads. More food also means more kittens than we can help. Local cat guardians feed them properly. | "Colonies" is not explained to a visitor. |
| Onboarding and help (`howStepHelpBody`) ASK | Same | Your spots help us sterilise and vaccinate the colonies. | If Syros Cats does not vaccinate: "Each spot helps Syros Cats find cats that still need sterilising." If it does: keep the vaccine words but say "street cats", not "colonies". | The vaccination claim is unchecked. |
| Onboarding and help (`howSafetyLiveHere`) | Same | The cats of Syros are not pets, and they are not strays. They live here. | The cats of Syros aren't lost or abandoned. The streets are their home. | Cats do have owners (the claim button), so "not pets" is wrong. |
| Starter fact (`fact.cantTell`) | Someone waiting for a match check | "Can't tell" is a good answer. An honest "not sure" keeps the island's record true. A confident wrong guess can make a cat look sterilised when it isn't. | "Can't tell" is a good answer. A wrong guess can make a cat look sterilised when it isn't. | "The island's record" is internal. Changed together with `earTipCantTell`, which a test says must match. |
| Starter fact (`fact.cost`) ASK | Same; Syros Cats must sign this fact off | Sterilising one female cat costs Syros Cats €50–60. That one operation prevents every litter she would otherwise have had. | If males cost the same: "Sterilising one cat costs Syros Cats €50–60. That one operation prevents every litter that cat would otherwise have had." Otherwise leave as is. | "Female" suggests males are free, but I can't know the price for males. |
| Fatal screen (`startupErrorBody`) | Someone whose browser can't run the app | This browser or app doesn't support the secure setup Cat Spotters needs. Try updating your browser, or use a different one. | This browser can't run Cat Spotters. Please update it, or try Chrome or Safari. | No "secure setup". |
| Welcome (`welcomeHaveAccount`) CHANGED | Everyone at first run, who mostly are new | Already a spotter? Get your spots back | Used Cat Spotters before? Get your cats back | New visitors don't have a "name" yet; "spotter" is also unexplained to them. |
| Delete screen (`deleteWhatGoesBody`) | Anyone deleting their data | Your email address, and anything we were about to send to it. Your points, your streak and your badges. Your spot history — the list of cats you've met and when. Anything you typed in a note. The link between you and every sighting you've ever sent us. | Your email, points, streak, badges and the list of cats you've met. Your name comes off your photos and reports. | Short. |
| Delete screen (`deleteWhatStaysBody`) | Same | The sightings themselves, with your name off them. Which cat was seen, roughly where, and when — that belongs to the island's record of its cats, and taking it out would put holes in the history of cats that have nothing to do with you. | The spots stay on the map with no name on them. Without them, other cats' histories would have gaps. | Short. |
| Delete screen (`deleteWipeFailed`) | Only when wiping this phone failed | Your data is deleted, but this phone couldn't finish clearing up. Please try again. | Your data is deleted, but we couldn't tidy this phone. Please try again. | Plainer. |
| Restore (`restoreAskSent`) | Someone who asked for a restore email | If that address is keeping a spotter safe, we've sent a link. Open it in the browser you use for Cat Spotters. It works once and lasts 15 minutes. | If that address is saved with a spotter, we've sent a link. Open it on this phone, in the same place you use Cat Spotters. It works once and lasts 15 minutes. | "Keeping a spotter safe" is the email page's phrase. |
| Restore on a different phone (`restoreDifferentIntro`) | Someone who opened the link on another phone | This isn't the phone or browser that asked for this link. If you didn't ask for it, close this page. | You've opened this link somewhere different from where you asked for it. If you didn't ask for it, close this page. | Plainer. |
| Restore in another app (`restoreInAppWarning`) | Someone who opened the link inside Mail or similar | You've opened this inside another app. If you move the spots here, you won't find them in the browser you normally use. Copy the link and paste it into the browser you use for Cat Spotters. | This link opened inside another app (like Mail). Copy it and open it in your usual browser. | Shorter. |
| Restore choices (`restoreWarningNone` and the six Delete/Keep variants) | Someone restoring who already has a different name on this phone | See the review. Each option is a sentence of 25+ words. | `restoreWarning*`: "This phone is spotting as {current}. If you get your old spots back, this phone stops being {current}." stays. Options: "Delete {current}: the name and points go. {n} spots stay on the map with no name." / "Keep {current}: the name stays on the map for good, and can't be used again, even by you." | One short sentence per option. Plural keys keep the spot counts. |
| Moved screen (`movedBody`) | Someone whose spotter moved to another phone | This phone isn't signed in as {username} any more. | Your spots have moved to another phone, so this phone has stopped being {username}. | No "signed in". |

## E. Team dashboard

| Screen | Who sees it | Now | Proposed | Why |
|---|---|---|---|---|
| Welcome page (`welcome.seeDo.guardian`) | Every invited cat guardian, once | A 100-word sentence ending in a report type they've never heard of. | Three short lines. "You can see: for your own colonies, the area each cat was first seen in, the colony's feeding sites, photos, and whether each cat is sterilised." "You can change: say what you see happening to the cats, check a cat's ear, choose which cats are in your colonies, add feeding sites, create a new colony." "You can read but not change: the reports of cats in trouble about your colonies' cats." | Splits can-do from can't-do and drops "Report an issue". |
| Welcome page (`welcome.neverReopened`) | Guardians and management | A phone that is never opened again keeps its saved list until the browser clears it. Syros Cats can't wipe it from a distance. | If you lose your phone, tell Syros Cats. We can't wipe it from here. | Gives them the action. |
| Guardian cat page (`gcat.say.intro`) | Every cat guardian on every cat page | What you say here counts straight away and is recorded as yours. Syros Cats can mark it wrong. You can put back your own change of status for {days} days. | What you tell us goes live straight away, with your name on it. The team may correct it. You can undo your change for {days} days. | Plain. |
| Guardian cat page (`gcat.problem.notYours`) | A guardian whose undo expired | That change can't be put back any more. Nothing was changed. | It's too late to undo that. Nothing was changed. | Plain. The old second sentence stays. |
| Guardian cat page (`gcat.ster.yesReported`) | Guardians | Said to be sterilised, not yet confirmed | Reported as sterilised, not yet checked | Plain. |
| Team cat page (`appearance.markWrongHint`) | Syros Cats team | Removes this one change from the count. Nothing is said in its place. | Ignores this answer. The cat's page goes back to what it said before. | Plain. |
| Team cat page (`appearance.overruleHint`) | Team, when a guardian has set it | A cat guardian's change decides this now. Saving marks every standing cat guardian change on it wrong, with your reason, and records yours. | A cat guardian has already set this. Saving will replace their answer with yours. Please say why. | Plain. |
| Team cat page (`appearance.recordsSay`) | Team | Status | What we have now | Says what the row is. |
| Team cat page colour check (`reason.spotters_over_machine`, `reason.markings_reopened`, `reason.markings_changed_recently`) | Team | Spotters disagree with the reading from the photo / Spotters added a mark after the team's list / Markings changed on spotters' agreement in the last 30 days | Spotters don't agree with what the photo reader says / Spotters added a mark after the team's list (unchanged) / Spotters recently agreed on new markings | "Reading" and "agreement" are system words. The middle one is already fine. |
| Colonies list (`colonies.flag.notVisited`) | Team and guardians | Not visited lately | Not visited for 30 days | States the real rule (I will confirm the threshold in the code before I change it; if it is not 30, I'll use the real number). |
| Colonies list (`colonies.mark.probably`, `colonies.mark.notKnown`) | Team and guardians | Probably / Not known | Probably sterilised / Not known yet | SYC-365 and SYC-521 already treat "Probably sterilised" as the name. |
| Colony page (`colony.takeOutNote`, `add.hint`) | Team and guardians | The cat stays in the records; it just isn't in any colony. / …its history keeps the record of where it was. | The cat stays on the app. It just isn't in a colony. / A cat that is in another colony moves here. Its history still shows where it was. | "Records" is internal. |
| Colony page (`colony.centre`) | Team and guardians | Centre of the colony | Centre of the colony, with a line under it: "The middle of where the cats live. It helps the team find the colony." | The word isn't explained. Needs a new key. |
| Colony form errors (`problem.centre`) | Whoever saved a bad centre | The centre needs a latitude and a longitude, both real numbers, or both left empty. | Tap the map to set the centre, or leave it empty. | Developer text. |
| Site form errors (`sproblem.position`, `sproblem.tapUnreadable`, `sproblem.tapNoPoint`) | Whoever saved a bad position | Type the position as plain numbers… / That tap couldn't be read (the page may have been open for more than a day)… / That tap didn't say where on the map it was… | Tap the map to set the position, or type it as two numbers, like 37.44470 and 24.94170, on Syros. / That tap didn't work. Please tap the map again. / That tap didn't work. Please tap the map itself. | Developer text. |
| New site form (`new.typedWarning`) | Whoever adds a site by typing | Don't copy these from a map company's site; ask a colleague who has been there. | Don't copy numbers from other map apps. Ask a colleague who has been there. | Plainer. |
| Sites list, site page (`sites.private`, `sites.public`, `site.privateSentence`) | Team and guardians | Private / Public / Private. Only Syros Cats people signed in here can see this place. | Hidden from the public app / Shown on the public app / Hidden from the public app. Only Syros Cats people signed in here can see this place. | "Private" doesn't say from whom. |
| Site saved messages (`sdone.stale`, `sdone.movedPrivate`) | Whoever just saved a site | Someone already changed this. What you see below is how it is now; look it over and try again if you still want to. / Site moved. It was public, so it is private again until the new position is confirmed. | Someone else changed this first. Have a look, and try again if you still want to. / Site moved. It was shown on the public app, so it's hidden again until the team checks the new spot. | Names who confirms. |
| Site page (`act.qr`) | Team | Take down any QR sticker at this place. | If there's a QR sticker here, take it down. | Plain. |
| Site history (`sitehist.seeded`, `sitehist.existing`, `history.removed`) | Team | Site loaded from the first list / On the list before this history began / Details removed at someone's request. | Added from the original list / Already here before we started keeping a history / Details removed on a privacy request. | Plain. |
| Notes box (`notes.hint`) | Whoever writes a team note | Don't write when people come and go. | Please don't note people's comings and goings. | Plain. |
| Invite email (`mail.invite.how`) | The invitee | To get started, go to admin.catspotters.com, type this address, and tap the link we send you. | To get started, go to admin.catspotters.com, type your email address, and tap the link we email you. | "This address" is ambiguous. |
| Manager notice emails (`mail.notice.left`, `signedOut`, `signedOutSelf`) | Other managers | {actor} marked {subject} as left. / {actor} signed {subject} out everywhere. / {subject} signed out of the dashboard on every device. | {actor} removed {subject} from the team. / {actor} signed {subject} out on all phones and computers. / {subject} signed out on all their phones and computers. | "Marked as left" and "device" are system words. |

## F. Email link pages (`routes/mailPages.ts`; English only today)

| Page | Who sees it | Now | Proposed | Why |
|---|---|---|---|---|
| Confirm page title | Whoever got the "Is this you?" email | Keep my spots safe | Confirm your email | Says the task. |
| `COPY.confirm.ask` | Same (may not be the spotter at all) | Someone using the Cat Spotters app asked to use this address to keep their spots safe. If that was you, press the button. | Someone using Cat Spotters gave us this email so they can get their cat photos and points back if they lose their phone. Was that you? | Says why, in plain words. |
| `COPY.confirm.done` | Same | Thank you. This address is now keeping a Cat Spotters collection safe. You can close this page. | Thanks. This email can now get your spots back if you lose your phone. You can close this page. | Plain. |
| `REQUEST_CANCELLED` | Whoever pressed "not me" | Done. We've cancelled that request, and we won't send this address any more "Is this you?" emails. Any spotter this address already keeps safe stays safe. | Done. We won't email this address again. Anyone already using it to save their spots still can. | Plain. |

## G. Deliberately left alone

| Key | Why left |
|---|---|
| `signInRequiredAction` ("Sign in") | Correct once the title says "test site". |
| `appearance.statements`, `.agrees`, `.model`, `.prompted`, `.confirmHint` | SYC-521 (the "What we know" section). |
| `colonies.flag.growing`, `.kittens`, `.noGuardian` | Clear to the people who see them; the review only asks to state the threshold for `.notVisited`. |
| `mail.notice.invited`, `.rolesChanged`, `.rejoined`, `.withdrawn`, `.why` | Read fine to managers. |
| `centre.*` (except the one explanation line) | Clear actions. |
| Greek and French wording of anything in this table | Written after approval. |
