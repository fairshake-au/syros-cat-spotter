# SYC-569 second pack: Greek and French drafts

**Drafted by Claude, for Johnny's native review. Added after the 22 Oct 2026 copy freeze** (SYC-346; Samuel's decision D1 in `docs/specs/design-review-fixes-oct22.md`: these strings go in the short second pack).

Rules applied (SYC-346, SYC-159): French uses *tu*; Greek capitals drop their accents when text is shown in capitals (done in code by `displayUpperCase`, so the Greek below keeps its accents); the cat is always called by name, never he or she; "spotter" and "cat guardian" are the canonical terms. Greek uses the informal singular (*σου*) to match the rest of the app; the old claim strings used the formal plural (*σας*), so Johnny may want to say which he prefers for the claim sheet. The dashboard Greek keeps the dashboard's existing formal plural.

Greek needs an article before the cat's name (the existing claim strings already say *η {name}*); please check that reads right for a name whose cat is male.

Status of this file: **Parts 1 (SYC-571), 2 (SYC-574) and 3 (SYC-573).**

## App strings (`artifacts/cat-spotter/lib/i18n.ts`)

| Key | English | el draft | fr draft |
|---|---|---|---|
| `claimAskLink` | Does {name} live with you? | Η {name} ζει μαζί σου; | {name} vit chez toi ? |
| `claimAskTitle` | Does {name} live with you? | Η {name} ζει μαζί σου; | {name} vit chez toi ? |
| `claimAskStreet` | If {name} lives with you, first take a photo of {name} with the Spot button. Then come back here and you can say {name} lives with you. | Αν η {name} ζει μαζί σου, φωτογράφισε πρώτα την {name} με το κουμπί Εντόπισε. Μετά γύρνα εδώ και μπορείς να δηλώσεις ότι η {name} ζει μαζί σου. | Si {name} vit chez toi, prends d’abord {name} en photo avec le bouton Repérer. Reviens ensuite ici et tu pourras dire que {name} vit chez toi. |
| `claimAskHomed` | {name} already has a home on the app. If {name}’s yours and you’ve changed phone, email us at hello@catspotters.com and we’ll help. | Η {name} έχει ήδη σπίτι στην εφαρμογή. Αν η {name} είναι δική σου και άλλαξες κινητό, στείλε μας email στο hello@catspotters.com και θα σε βοηθήσουμε. | {name} a déjà un foyer sur l’appli. Si {name} est à toi et que tu as changé de téléphone, écris-nous à hello@catspotters.com et nous t’aiderons. |
| `claimAskSpotNow` | Spot {name} now | Εντόπισε τώρα την {name} | Repérer {name} maintenant |
| `claimAskClose` | OK | Εντάξει | OK |
| `earTipQuestion` | One quick thing: does {name} have a clipped ear? | Κάτι γρήγορο: έχει η γάτα {name} κομμένη άκρη στο αυτί; | Une petite chose : l’oreille de {name} a-t-elle le bout coupé ? |
| `earTipWhy` | After sterilising a cat, the vet snips a tiny piece off the tip of one ear, usually the left. It leaves a flat, straight edge. | Όταν στειρώνεται μια γάτα, ο κτηνίατρος κόβει ένα μικροσκοπικό κομμάτι από την άκρη του ενός αυτιού, συνήθως του αριστερού. Η άκρη μένει ίσια και επίπεδη. | Après la stérilisation d’un chat, le vétérinaire coupe un tout petit bout de la pointe d’une oreille, généralement la gauche. Le bord devient plat et droit. |
| `earTipExampleCaption` | A clip is a straight cut across the tip of the ear. A notch or a tear is usually an old injury, not a sterilisation mark. | Η κοπή είναι μια ίσια τομή στην άκρη του αυτιού. Μια εγκοπή ή ένα σκίσιμο είναι συνήθως παλιός τραυματισμός, όχι σημάδι στείρωσης. | Une coupe est un trait droit au bout de l’oreille. Une encoche ou une déchirure est généralement une ancienne blessure, pas une marque de stérilisation. |
| `keepSafeWarning` | Use an email only you, or a parent, can read. Anyone who can open it can get your spots back. | Χρησιμοποίησε ένα email που διαβάζεις μόνο εσύ ή ένας γονιός. Όποιος μπορεί να το ανοίξει μπορεί να πάρει πίσω τις παρατηρήσεις σου. | Utilise un e-mail que toi seul (ou un parent) peux lire. Quiconque peut l’ouvrir peut récupérer tes observations. |
| `reportCheckBlocked` | Your report is saved, but something in this browser (often an ad blocker) is stopping it sending. Turn it off for this page and we’ll try again. If that doesn’t help, allow challenges.cloudflare.com. | Η αναφορά σου είναι αποθηκευμένη, αλλά κάτι σε αυτό το πρόγραμμα περιήγησης (συχνά ένας αποκλεισμός διαφημίσεων) εμποδίζει την αποστολή. Απενεργοποίησέ το για αυτή τη σελίδα και θα ξαναπροσπαθήσουμε. Αν δεν βοηθήσει, επίτρεψε το challenges.cloudflare.com. | Ton signalement est enregistré, mais quelque chose dans ce navigateur (souvent un bloqueur de publicités) l’empêche de partir. Désactive-le pour cette page et nous réessaierons. Si ça n’aide pas, autorise challenges.cloudflare.com. |

Notes:
- `claimAskSpotNow` is shown from Part 2: the "Spot {name} now" button in street mode.
- `claimAskHomed` must keep `hello@catspotters.com` in the sentence: the sheet turns that address into a mail link by finding it in the text.
- `reportCheckBlocked` keeps `challenges.cloudflare.com` last (a test pins it).

## Dashboard strings (`artifacts/api-server/src/lib/teamPages/strings/`)

These are not live yet (`LIVE_LANGUAGES = ["en"]`), but they keep the three dictionaries in step.

| Key | English | el draft | fr draft |
|---|---|---|---|
| `map.teamOnly` | This map is only for the team. | Αυτός ο χάρτης είναι μόνο για την ομάδα. | Cette carte est réservée à l’équipe. |
| `map.whyTitle` | Why does the map work like this? | Γιατί λειτουργεί έτσι ο χάρτης; | Pourquoi la carte fonctionne-t-elle ainsi ? |
| `map.whyBody` | Our server fetches the map pictures, so your browser never tells a map company where you are looking. | Ο δικός μας διακομιστής φέρνει τις εικόνες του χάρτη, οπότε ο φυλλομετρητής σας δεν λέει ποτέ σε μια εταιρεία χαρτών πού κοιτάτε. | Notre serveur récupère les images de la carte, donc ton navigateur ne dit jamais à une entreprise de cartographie où tu regardes. |

## Keys removed in Part 1 (nothing to translate)

`claimNotMetHint`, `claimNewPhone`, `earTipUsuallyLeft` and `deleteDoneEmail` (app, all three languages); `sites.mapHint` and `new.mapNote` (dashboard, replaced by the three `map.*` keys above).

## Part 3: maps open on the cats (SYC-573)

App strings (`artifacts/cat-spotter/lib/i18n.ts`). The first three are only ever used for **2 or more cats** (a lone cat's square has no count), so one plural form per language is enough.

| Key | English | el draft | fr draft |
|---|---|---|---|
| `catsInArea` | {n} cats | {n} γάτες | {n} chats |
| `areaWithCats` | Area with {n} cats | Περιοχή με {n} γάτες | Zone avec {n} chats |
| `areaOfCat` | {name}’s area | Περιοχή της {name} | Zone : {name} |
| `mapShowAll` | Show all | Εμφάνιση όλων | Tout afficher |

Notes:
- `catsInArea` is the label drawn on a shared square, shown only when the square is at least 40 px wide. `areaWithCats` and `areaOfCat` are the spoken labels (web).
- `areaOfCat` in French is "Zone : {name}" on purpose: "Zone de {name}" would need "d’" before a name starting with a vowel, which a fixed template can't do. Johnny may prefer another shape.
- `areaOfCat` in Greek uses the article *της* before the name, like the claim strings; please check it reads right for a male cat.
- `mapShowAll` reuses the wording of the existing `pickerShowAll`.

## Part 2: "I've spotted {name}" (SYC-574)

App strings (`artifacts/cat-spotter/lib/i18n.ts`). `claimAskSpotNow` (Part 1's table) is now shown: the "Spot {name} now" button in the street sheet.

| Key | English | el draft | fr draft |
|---|---|---|---|
| `spottedCatButton` | I’ve spotted {name} | Εντόπισα την {name} | J’ai repéré {name} |
| `spotHintBanner` | Spotting {name} | Εντοπίζεις την {name} | Tu repères {name} |
| `spotHintStop` | Stop spotting {name} | Σταμάτα τον εντοπισμό της {name} | Arrêter de repérer {name} |
| `hintQuestion` | Is this {name}? | Είναι η {name}; | C’est {name} ? |
| `hintTheirPhoto` | {name}’s photo | Η φωτογραφία της {name} | La photo de {name} |
| `hintYes` | Yes, it’s {name} | Ναι, είναι η {name} | Oui, c’est {name} |
| `hintNo` | No, it’s a different cat | Όχι, είναι άλλη γάτα | Non, c’est un autre chat |
| `hintCarryOn` | Carry on | Συνέχισε | Continuer |
| `hintNotNearby` | {name} isn’t listed near where you took this photo, so this photo can’t go on {name}’s page. Carry on to find the right cat. | Η {name} δεν είναι καταγεγραμμένη κοντά στο σημείο όπου τράβηξες τη φωτογραφία, οπότε δεν μπορούμε να την προσθέσουμε στη σελίδα της {name}. Συνέχισε για να βρεις τη σωστή γάτα. | {name} n’est pas répertorié près de l’endroit où tu as pris cette photo, donc nous ne pouvons pas l’ajouter à la page de {name}. Continue pour trouver le bon chat. |
| `hintCantAdd` | We couldn’t add this photo to {name}’s page. Carry on to find the right cat. | Δεν μπορέσαμε να προσθέσουμε τη φωτογραφία στη σελίδα της {name}. Συνέχισε για να βρεις τη σωστή γάτα. | Nous n’avons pas pu ajouter cette photo à la page de {name}. Continue pour trouver le bon chat. |

Notes:
- `spottedCatButton` is the cat page's main button; `spotHintBanner` and `spotHintStop` (the ✕'s spoken label) are the Spot screen's banner; the `hint*` keys are the "Is this {name}?" step in review.
- `hintNotNearby` and `hintCantAdd` show on that step when the server refuses the pick; the button then reads `hintCarryOn`. With no signal the step reuses the existing `pickerNoSignal` / `pickerNoSignalStay` lines.
- Greek uses the article *η* / *της* / *την* before the name, as in Part 1; please check it reads right for a male cat (e.g. `hintQuestion` "Είναι η {name};").
- French `hintNotNearby` says "{name} n’est pas répertorié", masculine, which a fixed template can't adjust for a female cat; Johnny may prefer a shape without the agreement.

## Plain words (SYC-572)

**For Johnny's review, after the 22 Oct freeze.** Drafted by Claude. Same rules as above: *tu* in French, Greek keeps the informal *σου*, "spotter" and "cat guardian" are the canonical terms, Greek for street cats is γάτες του δρόμου (never αδέσποτες). In Greek and French the app's word for a spot is still "παρατήρηση" / "observation" (it was before; SYC-510 asks whether that should change).

Questions for Johnny: (1) Is "Πρώτος εντοπιστής" / "Premier découvreur" a good name for the First finder badge? (2) "{name}'s story" is "Η ιστορία της {name}" / "L'histoire de {name}": check a male cat's name reads right. (3) "Spotter" as the profile title stays in Latin letters in Greek, as elsewhere in the app. (4) The sign-in banner is only seen by testers before launch.

### App strings

| Key | English | el draft | fr draft |
|---|---|---|---|
| `homeScreenNudgeText` | On iPhone or iPad, add this app to your Home Screen. If you don’t, your phone can forget your cats after a week without opening it. | Σε iPhone ή iPad, πρόσθεσε αυτή την εφαρμογή στην Αρχική οθόνη. Αν δεν το κάνεις, το κινητό σου μπορεί να ξεχάσει τις γάτες σου αν δεν την ανοίξεις για μια εβδομάδα. | Sur iPhone ou iPad, ajoute cette appli à ton écran d’accueil. Sinon, ton téléphone peut oublier tes chats si tu ne l’ouvres pas pendant une semaine. |
| `offlineBanner` | No signal. Spots you take now are kept on your phone and sent when you’re back online. | Χωρίς σήμα. Οι παρατηρήσεις που κάνεις τώρα μένουν στο κινητό σου και στέλνονται όταν ξαναβρεθείς σε σύνδεση. | Pas de signal. Les observations que tu fais maintenant restent sur ton téléphone et partent dès que tu retrouves du réseau. |
| `pendingSightings` | Spots on your phone | Παρατηρήσεις στο κινητό σου | Observations sur ton téléphone |
| `needsReview` | Check if we know this cat | Δες αν ξέρουμε αυτή τη γάτα | Vérifie si on connaît ce chat |
| `queued` | Waiting to send | Αναμονή για αποστολή | En attente d’envoi |
| `reviewReadyOne` | Your photo’s been checked. Tap to see if we know this cat. | Η φωτογραφία σου ελέγχθηκε. Πάτα για να δεις αν ξέρουμε τη γάτα. | Ta photo a été vérifiée. Appuie pour voir si on connaît ce chat. |
| `reviewReadyMany` | {count} photos have been checked. Tap to see if we know these cats. | Ελέγχθηκαν {count} φωτογραφίες. Πάτα για να δεις αν ξέρουμε τις γάτες. | {count} photos ont été vérifiées. Appuie pour voir si on connaît ces chats. |
| `syncNow` | Send now | Αποστολή τώρα | Envoyer maintenant |
| `syncFailedServer` | This spot couldn’t be sent. Try again, or delete it. | Αυτή η παρατήρηση δεν στάλθηκε. Δοκίμασε ξανά ή διέγραψέ την. | Cette observation n’a pas pu être envoyée. Réessaie ou supprime-la. |
| `syncFailedStale` | This photo is over 30 days old, so we can’t add it. You can delete it. | Αυτή η φωτογραφία είναι πάνω από 30 ημερών, οπότε δεν μπορούμε να την προσθέσουμε. Μπορείς να τη διαγράψεις. | Cette photo date de plus de 30 jours, donc on ne peut pas l’ajouter. Tu peux la supprimer. |
| `syncFailedCleared` | Your phone deleted this photo before it could be sent. Please take it again. | Το κινητό σου διέγραψε αυτή τη φωτογραφία πριν σταλεί. Τράβηξέ την ξανά. | Ton téléphone a supprimé cette photo avant qu’elle soit envoyée. Prends-la à nouveau. |
| `retrySync` | Try again | Δοκίμασε ξανά | Réessayer |
| `replacePhotoHint` | Choose a different photo. The time and place stay the same. | Διάλεξε άλλη φωτογραφία. Η ώρα και το μέρος μένουν ίδια. | Choisis une autre photo. L’heure et le lieu restent les mêmes. |
| `saveFailedOpenInBrowser` | This app can’t save photos here. Open it in your phone’s main browser (Safari or Chrome) and try again. | Αυτή η εφαρμογή δεν μπορεί να αποθηκεύσει φωτογραφίες εδώ. Άνοιξέ την στον κύριο browser του κινητού σου (Safari ή Chrome) και δοκίμασε ξανά. | Cette appli ne peut pas enregistrer de photos ici. Ouvre-la dans le navigateur principal de ton téléphone (Safari ou Chrome) et réessaie. |
| `queueReadOnly` | We can’t save spots to your phone right now. You can still send one while you have signal. | Δεν μπορούμε να αποθηκεύσουμε παρατηρήσεις στο κινητό σου αυτή τη στιγμή. Μπορείς να στείλεις μία όσο έχεις σήμα. | On ne peut pas enregistrer d’observations sur ton téléphone pour l’instant. Tu peux quand même en envoyer une tant que tu as du réseau. |
| `signInRequiredTitle` | Your saved cats are waiting. Enter the test site password to send them. | Οι αποθηκευμένες γάτες σου περιμένουν. Βάλε τον κωδικό της δοκιμαστικής ιστοσελίδας για να σταλούν. | Tes chats enregistrés attendent. Saisis le mot de passe du site de test pour les envoyer. |
| `signInRequiredAction` | Open | Άνοιγμα | Ouvrir |
| `matchPill` | possible match | πιθανό ταίριασμα | de correspondance possible |
| `lookalikesFound` | Similar cats nearby | Παρόμοιες γάτες κοντά | Chats similaires à proximité |
| `couldntCheckBody` | We couldn’t tell whether this cat is already in the Cat-alogue. | Δεν μπορέσαμε να δούμε αν αυτή η γάτα είναι ήδη στον γατά-λογο. | On n’a pas pu savoir si ce chat est déjà dans le cat-alogue. |
| `newFurriendSubtitleUnchecked` | We couldn’t check this cat. If it turns out we already know it, the team will tidy it up. | Δεν μπορέσαμε να ελέγξουμε αυτή τη γάτα. Αν τελικά την ξέρουμε ήδη, η ομάδα θα το τακτοποιήσει. | On n’a pas pu vérifier ce chat. S’il s’avère qu’on le connaît déjà, l’équipe fera le ménage. |
| `pickerSearchPlaceholder` | Name or cat number (like SYR-0012) | Όνομα ή αριθμός γάτας (π.χ. SYR-0012) | Nom ou numéro du chat (comme SYR-0012) |
| `catalogCount` | {n} cats on Syros | (unchanged) | (unchanged) |
| `spotSubtitle` | Take a photo of a cat. We’ll check if it’s already in the Cat-alogue. | Τράβηξε μια φωτογραφία μιας γάτας. Θα ελέγξουμε αν είναι ήδη στον γατά-λογο. | Prends une photo d’un chat. On vérifiera s’il est déjà dans le cat-alogue. |
| `statFirstFinds` | (unchanged) | (unchanged) | Premières trouvailles |
| `profileFirstFinds` | (unchanged) | (unchanged) | Premières trouvailles |
| `profileFirstFindsHint` | Cats nobody had spotted before you. | Γάτες που κανείς δεν είχε εντοπίσει πριν από σένα. | Des chats que personne n’avait repérés avant toi. |
| `badge_first_discovery` | First finder | Πρώτος εντοπιστής | Premier découvreur |
| `badge_first_discovery_desc` | Be the first to spot a new cat | Γίνε ο πρώτος που εντοπίζει μια νέα γάτα | Sois le premier à repérer un nouveau chat |
| `profileRole` | Spotter | Spotter | Spotter |
| `nameNoteTaken` | {from} was already taken, so we’ve called you {to}. | Το {from} ήταν ήδη πιασμένο, οπότε σε λέμε {to}. | {from} était déjà pris, alors on t’appelle {to}. |
| `usernameClaimUncertain` | We’re not sure your name was saved. Tap to try the same name again. | Δεν είμαστε σίγουροι ότι αποθηκεύτηκε το όνομά σου. Πάτα για να δοκιμάσεις ξανά το ίδιο όνομα. | On n’est pas sûr que ton nom ait été enregistré. Appuie pour réessayer avec le même nom. |
| `lifeStatusInCare` | Staying with Syros Cats | Μένει με τις Syros Cats | Séjourne chez Syros Cats |
| `sterilisedConfirmedFalse` | Not sterilised, as far as Syros Cats know | Μη στειρωμένη, απ’ ό,τι ξέρουν οι Syros Cats | Non stérilisé, pour autant que Syros Cats le sache |
| `careTimelineTitle` | {name}’s story | Η ιστορία της {name} | L’histoire de {name} |
| `careTypeDesexed` | Sterilised | (unchanged) | (unchanged) |
| `claimCat` | {name} lives with me | Η {name} ζει μαζί μου | {name} vit chez moi |
| `ownedBy` | Lives with | Ζει με | Vit chez |
| `campaignChipIn` | Donate | (unchanged) | (unchanged) |
| `campaignChipInAmount` | Donate {amount} | (unchanged) | (unchanged) |
| `catUpdateBanner` | News about this cat | Νέα για αυτή τη γάτα | Des nouvelles de ce chat |
| `reportCostsHeading` | Who pays, and who to call | Ποιος πληρώνει και ποιον να καλέσεις | Qui paie, et qui appeler |
| `reportBusy` | Too many reports were sent from this network in the last hour. Yours is saved on your phone and will send by itself within the hour. | Στάλθηκαν πολλές αναφορές από αυτό το δίκτυο την τελευταία ώρα. Η δική σου είναι αποθηκευμένη στο κινητό σου και θα σταλεί μόνη της μέσα στην ώρα. | Trop de signalements ont été envoyés depuis ce réseau dans la dernière heure. Le tien est enregistré sur ton téléphone et partira tout seul dans l’heure. |
| `turnstileTapLine` | Tick the box so we know you’re a person. | Πάτα το πλαίσιο για να ξέρουμε ότι είσαι άνθρωπος. | Coche la case pour qu’on sache que tu es une vraie personne. |
| `reportCheckUnavailable` | We couldn’t check you’re a real person. Your report is saved and we’ll try again. | Δεν μπορέσαμε να ελέγξουμε ότι είσαι άνθρωπος. Η αναφορά σου είναι αποθηκευμένη και θα ξαναπροσπαθήσουμε. | On n’a pas pu vérifier que tu es une vraie personne. Ton signalement est enregistré et on réessaiera. |
| `issueReason_wrong_name` | The name is wrong or rude | Το όνομα είναι λάθος ή προσβλητικό | Le nom est faux ou grossier |
| `issueSavedBrowserNote` | Open this page again when you have signal, so it can be sent. | Άνοιξε ξανά αυτή τη σελίδα όταν έχεις σήμα, για να σταλεί. | Rouvre cette page quand tu as du réseau, pour qu’elle soit envoyée. |
| `extraDifferentVisit` | This photo was taken at a different time ({when}). All photos for one spot must be from the same visit. Choose another. | Αυτή η φωτογραφία τραβήχτηκε άλλη ώρα ({when}). Όλες οι φωτογραφίες μιας παρατήρησης πρέπει να είναι από την ίδια επίσκεψη. Διάλεξε άλλη. | Cette photo a été prise à un autre moment ({when}). Toutes les photos d’une observation doivent venir de la même visite. Choisis-en une autre. |
| `extraNotKeptNote` | We couldn’t keep your extra photos, so only the first photo will be sent. | Δεν μπορέσαμε να κρατήσουμε τις επιπλέον φωτογραφίες σου, οπότε θα σταλεί μόνο η πρώτη. | On n’a pas pu garder tes photos en plus, donc seule la première photo sera envoyée. |
| `howStepCatalogBody` | We check if it’s a new cat or one we already know. | Ελέγχουμε αν είναι καινούρια γάτα ή μία που ήδη ξέρουμε. | On vérifie si c’est un nouveau chat ou un chat qu’on connaît déjà. |
| `howStepDontFeedBody` | Scraps make cats sick and draw them onto busy roads. More food also means more kittens than we can help. Local cat guardians feed them properly. | Τα αποφάγια αρρωσταίνουν τις γάτες και τις τραβούν σε πολυσύχναστους δρόμους. Περισσότερο φαγητό σημαίνει και περισσότερα γατάκια απ’ ό,τι μπορούμε να βοηθήσουμε. Οι ντόπιοι κηδεμόνες γατών τις ταΐζουν σωστά. | Les restes rendent les chats malades et les attirent sur les routes passantes. Plus de nourriture, c’est aussi plus de chatons qu’on ne peut en aider. Les gardiens de chats locaux les nourrissent correctement. |
| `howStepHelpBody` | Your spots help us sterilise and vaccinate street cats. | Οι παρατηρήσεις σου μας βοηθούν να στειρώνουμε και να εμβολιάζουμε τις γάτες του δρόμου. | Tes observations nous aident à stériliser et vacciner les chats des rues. |
| `howSafetyLiveHere` | The cats of Syros aren’t lost. The streets are their home. | Οι γάτες της Σύρου δεν είναι χαμένες. Οι δρόμοι είναι το σπίτι τους. | Les chats de Syros ne sont pas perdus. Les rues sont leur maison. |
| `fact.cantTell` | “Can’t tell” is a good answer. A wrong guess can make a cat look sterilised when it isn’t. | «Δεν μπορώ να πω» είναι καλή απάντηση. Μια λάθος εικασία μπορεί να κάνει μια γάτα να φαίνεται στειρωμένη ενώ δεν είναι. | « Je ne sais pas » est une bonne réponse. Une mauvaise supposition peut faire croire qu’un chat est stérilisé alors qu’il ne l’est pas. |
| `fact.cost` | Sterilising one cat costs Syros Cats €50–60. It stops that cat adding to the street-cat population. | Η στείρωση μίας γάτας κοστίζει στις Syros Cats 50–60 €. Έτσι η γάτα δεν προσθέτει άλλα γατάκια στον πληθυσμό των γατών του δρόμου. | Stériliser un chat coûte 50 à 60 € à Syros Cats. Ainsi, ce chat n’ajoute plus de chatons à la population des chats des rues. |
| `startupErrorBody` | Try opening Cat Spotters in Chrome or Safari, or update your browser. | Δοκίμασε να ανοίξεις το Cat Spotters στο Chrome ή στο Safari, ή ενημέρωσε το πρόγραμμα περιήγησής σου. | Essaie d’ouvrir Cat Spotters dans Chrome ou Safari, ou mets à jour ton navigateur. |
| `welcomeHaveAccount` | Used Cat Spotters before? Get your cats back | Έχεις ξαναχρησιμοποιήσει το Cat Spotters; Πάρε πίσω τις γάτες σου | Tu as déjà utilisé Cat Spotters ? Retrouve tes chats |
| `deleteWhatGoesBody` | Your email address, and anything we were about to send to it. Your points, streak and badges. The list of cats you’ve met and when. Anything you typed in a note. Your name comes off every spot you’ve sent. | Η διεύθυνση email σου και ό,τι ετοιμαζόμασταν να σου στείλουμε. Οι πόντοι, το σερί και τα σήματά σου. Η λίστα με τις γάτες που συνάντησες και πότε. Ό,τι έγραψες σε μια σημείωση. Το όνομά σου φεύγει από κάθε παρατήρηση που έχεις στείλει. | Ton adresse e-mail, et tout ce que nous allions y envoyer. Tes points, ta série et tes badges. La liste des chats que tu as rencontrés, et quand. Tout ce que tu as écrit dans une note. Ton nom est retiré de chaque observation que tu as envoyée. |
| `deleteWhatStaysBody` | The spots themselves stay, with your name taken off: which cat, roughly where and when. Taking them out would leave holes in other cats’ histories. | Οι ίδιες οι παρατηρήσεις μένουν, χωρίς το όνομά σου: ποια γάτα, περίπου πού και πότε. Αν τις αφαιρούσαμε, θα έμεναν κενά στην ιστορία άλλων γατών. | Les observations elles-mêmes restent, sans ton nom : quel chat, à peu près où et quand. Les retirer laisserait des trous dans l’histoire d’autres chats. |
| `deleteWipeFailed` | Your data is deleted, but we couldn’t tidy this phone. Please try again. | Τα δεδομένα σου διαγράφηκαν, αλλά δεν μπορέσαμε να τακτοποιήσουμε αυτό το κινητό. Δοκίμασε ξανά. | Tes données sont supprimées, mais on n’a pas pu faire le ménage sur ce téléphone. Réessaie. |
| `restoreAskSent` | If that address is saved with a spotter, we’ve sent a link. Open it on this phone, in the same browser (Safari or Chrome) you use for Cat Spotters. It works once and lasts 15 minutes. | Αν αυτή η διεύθυνση είναι αποθηκευμένη σε έναν spotter, στείλαμε σύνδεσμο. Άνοιξέ τον σε αυτό το κινητό, στον ίδιο browser (Safari ή Chrome) που χρησιμοποιείς για το Cat Spotters. Λειτουργεί μία φορά και ισχύει 15 λεπτά. | Si cette adresse est enregistrée avec un spotter, on a envoyé un lien. Ouvre-le sur ce téléphone, dans le même navigateur (Safari ou Chrome) que tu utilises pour Cat Spotters. Il ne marche qu’une fois et dure 15 minutes. |
| `restoreDifferentIntro` | You’ve opened this link on a different phone or browser from the one that asked for it. If you didn’t ask for it, close this page. | Άνοιξες αυτόν τον σύνδεσμο σε άλλο κινητό ή browser από αυτό που τον ζήτησε. Αν δεν τον ζήτησες εσύ, κλείσε αυτή τη σελίδα. | Tu as ouvert ce lien sur un autre téléphone ou navigateur que celui qui l’a demandé. Si tu ne l’as pas demandé, ferme cette page. |
| `restoreInAppWarning` | This link opened inside another app (like Mail). If you get your spots back here, you won’t find them in your usual browser. Copy the link and open it there instead. | Αυτός ο σύνδεσμος άνοιξε μέσα σε άλλη εφαρμογή (όπως το Mail). Αν πάρεις εδώ πίσω τις παρατηρήσεις σου, δεν θα τις βρεις στον browser που χρησιμοποιείς συνήθως. Αντέγραψε τον σύνδεσμο και άνοιξέ τον εκεί. | Ce lien s’est ouvert dans une autre appli (comme Mail). Si tu récupères tes observations ici, tu ne les retrouveras pas dans ton navigateur habituel. Copie le lien et ouvre-le là-bas. |
| `restoreKeepCurrentOne` | {current}’s 1 spot stays on the map under that name and won’t count towards your points. Nobody can use {current} again, not even you, and you can’t delete it from the app later. | Η 1 παρατήρηση του «{current}» μένει στον χάρτη με αυτό το όνομα και δεν θα μετρά στους πόντους σου. Κανείς δεν θα μπορεί να χρησιμοποιήσει ξανά το «{current}», ούτε εσύ, και δεν θα μπορείς να το διαγράψεις αργότερα από την εφαρμογή. | L’observation de {current} reste sur la carte sous ce nom et ne comptera pas dans tes points. Personne ne pourra plus utiliser {current}, pas même toi, et tu ne pourras pas le supprimer plus tard depuis l’application. |
| `restoreKeepCurrentMany` | {current}’s {n} spots stay on the map under that name and won’t count towards your points. Nobody can use {current} again, not even you, and you can’t delete it from the app later. | Οι {n} παρατηρήσεις του «{current}» μένουν στον χάρτη με αυτό το όνομα και δεν θα μετρούν στους πόντους σου. Κανείς δεν θα μπορεί να χρησιμοποιήσει ξανά το «{current}», ούτε εσύ, και δεν θα μπορείς να το διαγράψεις αργότερα από την εφαρμογή. | Les {n} observations de {current} restent sur la carte sous ce nom et ne compteront pas dans tes points. Personne ne pourra plus utiliser {current}, pas même toi, et tu ne pourras pas le supprimer plus tard depuis l’application. |
| `movedBody` | Your spots have moved to another phone, so this phone has stopped being {username}. | Οι παρατηρήσεις σου μετακινήθηκαν σε άλλο κινητό, οπότε αυτό το κινητό δεν είναι πια ο {username}. | Tes observations sont passées sur un autre téléphone, donc ce téléphone n’est plus {username}. |
| `movedBodyNoName` | Your spots have moved to another phone. This phone no longer has them. | Οι παρατηρήσεις σου μετακινήθηκαν σε άλλο κινητό. Αυτό το κινητό δεν τις έχει πια. | Tes observations sont passées sur un autre téléphone. Ce téléphone ne les a plus. |

Removed from all three languages (nothing to translate): `uniqueCats`, `confidence`, `desexedBadge` (not used on any screen).

Greek and French spacing rules a test checks: a non-breaking space before ? : ; ! and inside « », and between a number and €.
