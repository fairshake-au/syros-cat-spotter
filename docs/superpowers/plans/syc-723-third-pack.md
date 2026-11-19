# SYC-723 third pack: cat names with no gendered article (Greek and French)

**Drafted by Claude, for Johnny's native review. Added after the 22 Oct 2026 copy freeze** (SYC-346; sits beside `syc-569-second-pack.md`). Every string below is **changed**, not new.

## What was wrong

Greek put the feminine article *Η / την / της* straight before the cat's name, so a male cat (*Η Μπάμπης*) or a cat shown by its number (*Η SYR-123*) read wrong. French had three sentences where a masculine ending (*répertorié*, *marqué*, *indiqué*) followed the cat's name.

## The fix

- **Greek:** the cat's name now follows the word *γάτα* ("cat"), which is feminine whatever the cat's sex: *η γάτα {name}*, *τη γάτα {name}*, *της γάτας {name}*. The app already used this in `hasHomeToast`, `earTipQuestion` and `moreToAddOne`. The name itself stays as typed.
- **French:** reworded so no ending depends on the cat.
- Placeholders are unchanged in every string.

**Johnny, please check:** (1) does *η γάτα {name}* read naturally in every spot, or is it heavy where it repeats (`claimAskStreet`, `claimRefusedTooFar`)? (2) is *γάτα* the right word for a male cat in a sentence like *Η γάτα Μπάμπης ζει μαζί μου*? (3) the French rewrites.

Left alone on purpose: `catCardA11ySpotted/NotSpotted` (*Την έχεις εντοπίσει* / *Repéré par toi*, which agree with the word cat, not the name); the spotter-name strings (*ο/η {name}*, `restore*`, those are people, not cats); the dashboard strings (not live, they already say *τη γάτα {cat}*).

## Greek (`artifacts/cat-spotter/lib/i18n.ts`)

| Key | English | Before | After |
|---|---|---|---|
| `claimCat` | {name} lives with me | Η {name} ζει μαζί μου | **Η γάτα {name} ζει μαζί μου** |
| `claimAskLink` | Does {name} live with you? | Η {name} ζει μαζί σου; | **Η γάτα {name} ζει μαζί σου;** |
| `claimAskTitle` | Does {name} live with you? | Η {name} ζει μαζί σου; | **Η γάτα {name} ζει μαζί σου;** |
| `claimAskStreet` | If {name} lives with you, first take a photo of {name} with the Spot button. Then come back here and you can say {name} lives with you. | Αν η {name} ζει μαζί σου, φωτογράφισε πρώτα την {name} με το κουμπί Εντόπισε. Μετά γύρνα εδώ και μπορείς να δηλώσεις ότι η {name} ζει μαζί σου. | **Αν η γάτα {name} ζει μαζί σου, φωτογράφισε πρώτα τη γάτα {name} με το κουμπί Εντόπισε. Μετά γύρνα εδώ και μπορείς να δηλώσεις ότι η γάτα {name} ζει μαζί σου.** |
| `claimAskHomed` | {name} already has a home on the app. If {name}’s yours and you’ve changed phone, email us at hello@catspotters.com and we’ll help. | Η {name} έχει ήδη σπίτι στην εφαρμογή. Αν η {name} είναι δική σου και άλλαξες κινητό, στείλε μας email στο hello@catspotters.com και θα σε βοηθήσουμε. | **Η γάτα {name} έχει ήδη σπίτι στην εφαρμογή. Αν η γάτα {name} είναι δική σου και άλλαξες κινητό, στείλε μας email στο hello@catspotters.com και θα σε βοηθήσουμε.** |
| `claimAskSpotNow` | Spot {name} now | Εντόπισε τώρα την {name} | **Εντόπισε τώρα τη γάτα {name}** |
| `spottedCatButton` | I’ve spotted {name} | Εντόπισα την {name} | **Εντόπισα τη γάτα {name}** |
| `spotHintBanner` | Spotting {name} | Εντοπίζεις την {name} | **Εντοπίζεις τη γάτα {name}** |
| `spotHintStop` | Stop spotting {name} | Σταμάτα τον εντοπισμό της {name} | **Σταμάτα τον εντοπισμό της γάτας {name}** |
| `hintQuestion` | Is this {name}? | Είναι η {name}; | **Είναι η γάτα {name};** |
| `hintTheirPhoto` | {name}’s photo | Η φωτογραφία της {name} | **Η φωτογραφία της γάτας {name}** |
| `hintYes` | Yes, it’s {name} | Ναι, είναι η {name} | **Ναι, είναι η γάτα {name}** |
| `hintNotNearby` | {name} isn’t listed near where you took this photo, so this photo can’t go on {name}’s page. Carry on to find the right cat. | Η {name} δεν είναι καταγεγραμμένη κοντά στο σημείο όπου τράβηξες τη φωτογραφία, οπότε δεν μπορούμε να την προσθέσουμε στη σελίδα της {name}. Συνέχισε για να βρεις τη σωστή γάτα. | **Η γάτα {name} δεν είναι καταγεγραμμένη κοντά στο σημείο όπου τράβηξες τη φωτογραφία, οπότε δεν μπορούμε να την προσθέσουμε στη σελίδα της γάτας {name}. Συνέχισε για να βρεις τη σωστή γάτα.** |
| `hintCantAdd` | We couldn’t add this photo to {name}’s page. Carry on to find the right cat. | Δεν μπορέσαμε να προσθέσουμε τη φωτογραφία στη σελίδα της {name}. Συνέχισε για να βρεις τη σωστή γάτα. | **Δεν μπορέσαμε να προσθέσουμε τη φωτογραφία στη σελίδα της γάτας {name}. Συνέχισε για να βρεις τη σωστή γάτα.** |
| `claimConfirmTitle` | Is {name} your cat? | Είναι η {name} δική σας γάτα; | **Είναι η γάτα {name} δική σας;** |
| `claimConfirmBody` | Only say yes if you live on Syros and {name} is yours: {name} lives with you, and you’re the one who gives {name} food, water and care every day. | Πείτε ναι μόνο αν ζείτε στη Σύρο και η {name} είναι δική σας: η {name} ζει μαζί σας και εσείς της δίνετε φαγητό, νερό και φροντίδα κάθε μέρα. | **Πείτε ναι μόνο αν ζείτε στη Σύρο και η γάτα {name} είναι δική σας: η γάτα {name} ζει μαζί σας και εσείς της δίνετε φαγητό, νερό και φροντίδα κάθε μέρα.** |
| `claimTrustLine` | Everyone using the app will see that {name} has a home. We trust our community: if {name} turns out not to be yours, Syros Cats will take this off. | Όλοι όσοι χρησιμοποιούν την εφαρμογή θα βλέπουν ότι η {name} έχει σπίτι. Εμπιστευόμαστε την κοινότητά μας: αν η {name} δεν είναι δική σας, οι Syros Cats θα το αφαιρέσουν. | **Όλοι όσοι χρησιμοποιούν την εφαρμογή θα βλέπουν ότι η γάτα {name} έχει σπίτι. Εμπιστευόμαστε την κοινότητά μας: αν η γάτα {name} δεν είναι δική σας, οι Syros Cats θα το αφαιρέσουν.** |
| `claimYes` | Yes, {name} lives with me | Ναι, η {name} ζει μαζί μου | **Ναι, η γάτα {name} ζει μαζί μου** |
| `claimWhereTitle` | Where does {name} live? | Πού ζει η {name}; | **Πού ζει η γάτα {name};** |
| `claimNoteLabel` | Anything else that helps find {name}? | Κάτι ακόμα που βοηθά να βρεθεί η {name}; | **Κάτι ακόμα που βοηθά να βρεθεί η γάτα {name};** |
| `claimRefusedNotMet` | Spot {name} with the camera first, then you can say {name} lives with you. | Φωτογραφίστε πρώτα την {name} με την κάμερα και μετά μπορείτε να δηλώσετε ότι η {name} ζει μαζί σας. | **Φωτογραφίστε πρώτα τη γάτα {name} με την κάμερα και μετά μπορείτε να δηλώσετε ότι η γάτα {name} ζει μαζί σας.** |
| `claimRefusedHomed` | {name} already has a home. | Η {name} έχει ήδη σπίτι. | **Η γάτα {name} έχει ήδη σπίτι.** |
| `claimRefusedNotStreet` | {name} can’t be marked as yours right now. | Η {name} δεν μπορεί να δηλωθεί ως δική σας αυτή τη στιγμή. | **Η γάτα {name} δεν μπορεί να δηλωθεί ως δική σας αυτή τη στιγμή.** |
| `claimRefusedTooFar` | That’s a long way from where {name} is usually seen. Move the pin to where {name} lives. If {name} really lives there, write to Syros Cats. | Αυτό απέχει πολύ από το σημείο όπου συνήθως εμφανίζεται η {name}. Μετακινήστε την καρφίτσα εκεί όπου ζει η {name}. Αν η {name} ζει πραγματικά εκεί, γράψτε στους Syros Cats. | **Αυτό απέχει πολύ από το σημείο όπου συνήθως εμφανίζεται η γάτα {name}. Μετακινήστε την καρφίτσα εκεί όπου ζει η γάτα {name}. Αν η γάτα {name} ζει πραγματικά εκεί, γράψτε στους Syros Cats.** |
| `letGo` | {name} doesn’t live with me any more | Η {name} δεν ζει πια μαζί μου | **Η γάτα {name} δεν ζει πια μαζί μου** |
| `letGoConfirm` | {name} will no longer show as having a home, and you won’t be {name}’s owner in the app. | Η {name} δεν θα εμφανίζεται πια ότι έχει σπίτι και δεν θα είστε ο ιδιοκτήτης της {name} στην εφαρμογή. | **Η γάτα {name} δεν θα εμφανίζεται πια ότι έχει σπίτι και δεν θα είστε ο ιδιοκτήτης της γάτας {name} στην εφαρμογή.** |
| `catBannerSeeStory` | See {name}’s story | Δες την ιστορία της {name} | **Δες την ιστορία της γάτας {name}** |
| `careTimelineTitle` | {name}’s story | Η ιστορία της {name} | **Η ιστορία της γάτας {name}** |
| `areaOfCat` | {name}’s area | Περιοχή της {name} | **Περιοχή της γάτας {name}** |

## French

| Key | English | Before | After |
|---|---|---|---|
| `hintNotNearby` | {name} isn’t listed near where you took this photo, so this photo can’t go on {name}’s page. Carry on to find the right cat. | {name} n’est pas répertorié près de l’endroit où tu as pris cette photo, donc nous ne pouvons pas l’ajouter à la page de {name}. Continue pour trouver le bon chat. | **{name} ne figure pas près de l’endroit où tu as pris cette photo, donc nous ne pouvons pas l’ajouter à la page de {name}. Continue pour trouver le bon chat.** |
| `claimRefusedNotStreet` | {name} can’t be marked as yours right now. | {name} ne peut pas être marqué comme étant à toi pour le moment. | **Nous ne pouvons pas indiquer que {name} vit chez toi pour le moment.** |
| `letGoConfirm` | {name} will no longer show as having a home, and you won’t be {name}’s owner in the app. | {name} ne sera plus indiqué comme ayant un foyer, et tu ne seras plus le propriétaire de {name} dans l’appli. | **L’appli n’indiquera plus que {name} a un foyer, et tu ne seras plus le propriétaire de {name} dans l’appli.** |
