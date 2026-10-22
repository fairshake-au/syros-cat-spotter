# SYC-569 second pack: Greek and French drafts

**Drafted by Claude, for Johnny's native review. Added after the 22 Oct 2026 copy freeze** (SYC-346; Samuel's decision D1 in `docs/specs/design-review-fixes-oct22.md`: these strings go in the short second pack).

Rules applied (SYC-346, SYC-159): French uses *tu*; Greek capitals drop their accents when text is shown in capitals (done in code by `displayUpperCase`, so the Greek below keeps its accents); the cat is always called by name, never he or she; "spotter" and "cat guardian" are the canonical terms. Greek uses the informal singular (*σου*) to match the rest of the app; the old claim strings used the formal plural (*σας*), so Johnny may want to say which he prefers for the claim sheet. The dashboard Greek keeps the dashboard's existing formal plural.

Greek needs an article before the cat's name (the existing claim strings already say *η {name}*); please check that reads right for a name whose cat is male.

Status of this file: **Parts 1 (SYC-571) and 3 (SYC-573).** Part 2 adds its rows when it lands (T2.7).

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
- `claimAskSpotNow` is added now but is not shown until Part 2 (the "Spot {name} now" button in street mode).
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
