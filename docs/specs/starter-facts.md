# Starter facts, in three languages

**Status:** Draft for Samuel's approval, 15 October 2026. Independent adversarial review folded in (§11; full review in [`reviews/feeding-nudge-and-starter-facts-review.md`](./reviews/feeding-nudge-and-starter-facts-review.md)).
**Owner:** Samuel
**Covers:** SYC-48 (and the shared half of SYC-343). `docs/PRODUCT-SPEC.md` §2.2: *"Starter content set: ~20 authored facts per language, including the lactose fact and an ear-tip explainer with a photo example."* Also the 1 September meeting's teaching addition: *"Add disease-spread prevention to the sterilisation benefits."*
**Builds on:** the proposal §13 "What the app teaches" (the six strands and the first example facts) · the engagement design §5 (`docs/superpowers/specs/2026-07-28-engagement-and-donations-design.md`: use the waiting time, author the content, never generate it live) · the ear-tip example photo (SYC-79, already in the app as `assets/images/ear-tip-example.jpg`, used by SYC-37).
**Seeds:** Teaching in full (SYC-61, MLP). Every fact here is tagged with its strand so SYC-61 can build on this set rather than replace it.
**Shares a slot with:** [`feeding-nudge.md`](./feeding-nudge.md) (SYC-36). This spec defines **the waiting card** (§3) that both use.
**Dates:** launch 31 October 2026 (SYC-73). Greek and French drafts reach Johnny for native review (SYC-283) by Thursday 22 October, per the launch plan (PR #172); his corrections land 23–27 October.

---

## 1. The short version

While Cat Spotters looks for a match, the spotter sees **one short fact about cats** instead of a spinner. Twenty facts, written once, checked by Syros Cats, and the same twenty in English, Greek and French.

They're chosen to do two jobs at once: to be worth reading, and to make people better at helping. Half are about sterilisation, feeding and being around a street cat. The other half are about reading a cat: why the tortoiseshell is almost always female, what a slow blink means, why the white cat with blue eyes didn't run.

- **The order:** the feeding nudge on a phone's first spot (`feeding-nudge.md`); the **ear-tip explainer, with the photo**, on the second; the **lactose fact** on the third; then the rest in a shuffled order, with no repeats until all twenty have been seen.
- **No signal needed** for the words or the photo: they're part of the app. The card itself only appears while a sighting is being sent, so an offline spot doesn't show one (§6).
- **Nothing to set up for the team.** No admin screen; the facts change with an app update. A fact Syros Cats wants pulled can be switched off without one (§9).

---

## 2. Why this matters

The match wait is the one moment in the app when a spotter is guaranteed to be looking at the screen, often with the cat still in front of them, and today it's a spinner. The proposal and the engagement design both spend that moment on teaching, for one reason: a fact shown about the animal you're looking at is the version people remember.

**Facts are authored, not generated.** Every fact here is written once, sourced, checked by Syros Cats, and native-reviewed. Nothing is made up at runtime, so the app can't tell someone something false about cats in the charity's name.

### 2.1 Two audiences, needs that fit together

| | Tourists | Locals and cat guardians |
|---|---|---|
| **What they get** | Something to read in the wait, and a reason to look again at the next cat (the tail, the ear, the eyes) | The things they already know, said to visitors in three languages: don't give milk, kittens alone usually aren't, a clipped ear is a cat already helped |
| **What it gives Syros Cats** | Better spotters: people who can read a clipped ear and say "can't tell" honestly | Fewer kittens carried in to the sanctuary, fewer saucers of milk outside cafés |

---

## 3. The waiting card

This is the one slot both specs share. It is defined here once.

### 3.1 Where and when

When the spotter taps **Check for matches** on the New spot screen and the sighting is being sent, a card appears below the button, labelled **While we look…**. It stays until the matches come back, then goes with the rest of the New spot screen.

The card appears only during a real wait: when the app is sending a sighting now. It doesn't appear when the sighting is saved for later with no signal (§6), when a photo is rejected, or anywhere else in the app.

It never delays anything. The result arrives exactly when it would have without the card.

### 3.2 What it shows, wait by wait

One thing per wait, chosen by these rules, in order:

1. **The feeding nudge**, if its rules say so (`feeding-nudge.md` §3.2). On a new phone, that's the first wait.
2. **The ear-tip explainer** (fact 1), if this phone hasn't seen it yet.
3. **The lactose fact** (fact 7), if this phone hasn't seen it yet.
4. **The next fact in this phone's shuffled order** of the other eighteen.

So a new spotter sees: nudge, ear tip, lactose, then the shuffle. When all twenty have been seen, the order reshuffles, and the first fact of the new order is never the last one seen.

The ear tip comes early on purpose. After each spot, the reward screen asks *"is {name}'s ear tip clipped?"* (SYC-37). Someone who has just read the explainer answers that question better.

### 3.3 Short waits

Matching often takes only a few seconds, so facts are short: **35 words or fewer** in every language (counting words, not punctuation), most under 30. A fact counts as **seen** once it has been on screen for at least **1 second**; if the result arrives sooner, it isn't counted and comes up again next time.

Facts **don't follow the spotter to the reward screen**. When the result arrives, the fact goes. (The nudge is the one exception, because it has something to do; `feeding-nudge.md` §3.3. See Decision 2 here, §8.)

### 3.4 What the phone remembers

A small record on the phone, or in the browser on the website, alongside the app's other settings:

- the nudge's count, last-shown date and whether its button was tapped (`feeding-nudge.md` §3.2);
- which facts have been seen, and this phone's shuffled order.

None of it is sent to the server, tied to a username, or counted in the app's analytics. If a browser clears its storage, the sequence starts again from the nudge. That's harmless.

### 3.5 What it looks like

A card in the same style as the reward screen's question cards: rounded, white, bordered, never full-screen.

- **Eyebrow:** *While we look…*
- **The fact**, in body text.
- **For the ear-tip explainer only:** the example photo above the text, at its 2:1 shape, with the same description for screen readers as the ear-tip question uses (`earTipExampleAlt`).
- No buttons on a fact. Nothing to tap, nothing to dismiss.

It must fit below the button on a small phone (iPhone SE, 375 × 667) without covering the photo or the map pin; the screen scrolls if it doesn't. Screen readers announce it politely when it appears, without moving focus off the button the spotter just pressed.

---

## 4. The twenty facts

French uses **tu** and Greek the informal singular, to match the rest of the app. The words "cat guardian" (**κηδεμόνας γατών**, **gardien de chats**), "spotter", "clipped tip" and "sterilise" are used throughout; never "colony carer", "snapper", "notched" or "desex". Greek writes **γάτα** as feminine by default, as the app already does.

Each fact has a **strand**, from the six in the proposal (and SYC-61): **1** Reading a cat · **2** Life in a colony · **3** Why sterilisation works · **4** Being around a street cat · **5** When a cat needs help · **6** You're doing science. **Core** marks the ten that ship first if the set has to be cut (Decision 3, §8). **Sign-off** marks the facts Syros Cats must specifically confirm (§7); every fact goes to them, but these are the ones that need a yes.

These are drafts. Greek and French go to Johnny (SYC-283) on Thursday 22 October.

### Sterilisation (strand 3)

**Fact 1 · The clipped ear tip** · *core* · *sign-off* · **shows the ear-tip example photo**
- **EN** The flat top on this ear is a clipped tip: the sign a cat has been sterilised. The vet trims it while she's asleep for the operation. On Syros it's usually the left ear.
- **EL** Η ίσια άκρη σε αυτό το αυτί είναι κομμένη άκρη: το σημάδι ότι η γάτα έχει στειρωθεί. Ο κτηνίατρος την κόβει ενώ κοιμάται για την επέμβαση. Στη Σύρο είναι συνήθως το αριστερό αυτί.
- **FR** Le haut tout plat de cette oreille, c’est un bout coupé : le signe qu’une chatte a été stérilisée. Le vétérinaire le coupe pendant qu’elle dort pour l’opération. À Syros, c’est généralement l’oreille gauche.

**Fact 2 · How fast it adds up** · *core*
- **EN** One unsterilised female can have two or three litters a year, and her kittens can be pregnant themselves from as young as four months.
- **EL** Μία μη στειρωμένη θηλυκή γάτα μπορεί να κάνει δύο ή τρεις γέννες τον χρόνο, και τα γατάκια της μπορούν να μείνουν έγκυα ήδη από τεσσάρων μηνών.
- **FR** Une femelle non stérilisée peut avoir deux ou trois portées par an, et ses chatons peuvent être pleines dès l’âge de quatre mois.

**Fact 3 · Sterilisation slows disease** · *core* · *sign-off* · the 1 September meeting's addition
- **EN** Sterilised cats fight and roam less. That slows the spread of FIV, a virus cats pass on mainly through deep bites, from colony to colony across the island.
- **EL** Οι στειρωμένες γάτες τσακώνονται και περιφέρονται λιγότερο. Έτσι περιορίζεται η εξάπλωση του FIV, ενός ιού που μεταδίδεται κυρίως με βαθιές δαγκωματιές, από αποικία σε αποικία σε όλο το νησί.
- **FR** Les chats stérilisés se battent et errent moins. Cela freine la propagation du FIV, un virus transmis surtout par les morsures profondes, d’une colonie à l’autre sur toute l’île.

**Fact 4 · Back home afterwards** · *core*
- **EN** After sterilisation, a street cat goes back to exactly where it was found: its own patch, its own colony, the people who feed it.
- **EL** Μετά τη στείρωση, η γάτα του δρόμου επιστρέφει ακριβώς εκεί που βρέθηκε: στη γειτονιά της, στην αποικία της, στους ανθρώπους που την ταΐζουν.
- **FR** Après sa stérilisation, un chat des rues retourne exactement là où on l’a trouvé : son coin, sa colonie, les gens qui le nourrissent.

**Fact 5 · Why taking cats away doesn't work** · *sign-off*
- **EN** Take cats away from a place with food and shelter, and new cats often move in. Sterilising them instead aims for a settled colony that stops growing.
- **EL** Αν απομακρύνεις τις γάτες από ένα μέρος με φαγητό και καταφύγιο, συχνά έρχονται καινούργιες. Η στείρωση στοχεύει σε μια σταθερή αποικία που σταματά να μεγαλώνει.
- **FR** Si on retire les chats d’un endroit où il y a à manger et un abri, d’autres arrivent souvent. Les stériliser vise plutôt une colonie stable qui cesse de grandir.

**Fact 6 · What it costs** · *core*
- **EN** Sterilising one cat costs Syros Cats €50–60. That one operation prevents every litter she would otherwise have had.
- **EL** Η στείρωση μίας γάτας κοστίζει στις Syros Cats 50–60 €. Αυτή η μία επέμβαση αποτρέπει κάθε γέννα που θα έκανε διαφορετικά.
- **FR** Stériliser un chat coûte 50 à 60 € à Syros Cats. Cette seule opération évite toutes les portées qu’elle aurait eues.

### Food, and being around a street cat (strand 4)

**Fact 7 · Milk** · *core* · the lactose fact (Jacky)
- **EN** Most grown-up cats can't digest the lactose in milk, so a saucer of milk often means an upset stomach. Fresh water is what they need.
- **EL** Οι περισσότερες ενήλικες γάτες δεν χωνεύουν τη λακτόζη του γάλακτος, γι’ αυτό ένα πιατάκι γάλα συχνά τους φέρνει στομαχόπονο. Αυτό που χρειάζονται είναι φρέσκο νερό.
- **FR** La plupart des chats adultes digèrent mal le lactose du lait : une soucoupe de lait leur donne souvent mal au ventre. Ce qu’il leur faut, c’est de l’eau fraîche.

**Fact 8 · The wrong food** · *core*
- **EN** Onions, garlic, chocolate, grapes and raisins are poisonous to cats. Bread and salty leftovers aren't good for them either.
- **EL** Τα κρεμμύδια, το σκόρδο, η σοκολάτα, τα σταφύλια και οι σταφίδες είναι δηλητηριώδη για τις γάτες. Ούτε το ψωμί και τα αλμυρά αποφάγια τους κάνουν καλό.
- **FR** Les oignons, l’ail, le chocolat, le raisin et les raisins secs sont toxiques pour les chats. Le pain et les restes salés ne leur font pas de bien non plus.

**Fact 9 · Water helps** · *sign-off*
- **EN** Want to help the cats you pass every day? Topping up a water bowl is always welcome, especially in summer. Food is best left to the people who feed them regularly.
- **EL** Θέλεις να βοηθήσεις τις γάτες που συναντάς κάθε μέρα; Το να γεμίσεις ένα μπολ με νερό είναι πάντα ευπρόσδεκτο, ειδικά το καλοκαίρι. Το φαγητό ας το αφήσουμε σε όσους τις ταΐζουν τακτικά.
- **FR** Tu veux aider les chats que tu croises chaque jour ? Remplir une gamelle d’eau est toujours bienvenu, surtout en été. La nourriture, mieux vaut la laisser à ceux qui les nourrissent régulièrement.

**Fact 10 · A hiss means space** · *strand 4*
- **EN** A hissing cat isn't being nasty. It's frightened and asking for space. Step back and let it be.
- **EL** Μια γάτα που σφυρίζει δεν είναι κακή. Έχει φοβηθεί και ζητά χώρο. Κάνε ένα βήμα πίσω και άφησέ την ήσυχη.
- **FR** Un chat qui crache n’est pas méchant. Il a peur et demande de l’espace. Recule et laisse-le tranquille.

### When a cat needs help (strand 5)

**Fact 11 · Kittens on their own** · *core* · *sign-off*
- **EN** Found kittens on their own? Their mother is usually nearby, finding food. Watch from a distance. If they look cold, hurt or ill, tap "This cat needs help".
- **EL** Βρήκες γατάκια μόνα τους; Η μητέρα τους συνήθως είναι κοντά και ψάχνει φαγητό. Παρακολούθησε από απόσταση. Αν φαίνονται παγωμένα, χτυπημένα ή άρρωστα, πάτα «Αυτή η γάτα χρειάζεται βοήθεια».
- **FR** Des chatons tout seuls ? Leur mère est souvent tout près, partie chercher à manger. Observe de loin. S’ils semblent avoir froid, blessés ou malades, touche « Ce chat a besoin d’aide ».

The quoted button names must match the live labels (`reportNeedsHelp`); the builder checks all three against `i18n.ts`.

### Reading a cat (strand 1)

**Fact 12 · Tortoiseshells are girls** · *core*
- **EN** Almost every tortoiseshell or calico cat is female. The genes for orange and black fur sit on the X chromosome, and it takes two X chromosomes to carry both.
- **EL** Σχεδόν όλες οι χελωνόχρωμες και οι τρίχρωμες γάτες είναι θηλυκές. Τα γονίδια για το πορτοκαλί και το μαύρο τρίχωμα βρίσκονται στο χρωμόσωμα Χ, και χρειάζονται δύο Χ για να υπάρχουν και τα δύο.
- **FR** Presque tous les chats écaille de tortue ou calico sont des femelles. Les gènes du pelage roux et noir sont sur le chromosome X, et il faut deux X pour porter les deux.

**Fact 13 · White cats with blue eyes**
- **EN** Many all-white cats with two blue eyes are born deaf. If one doesn't turn when you come near, it may simply not have heard you.
- **EL** Πολλές κάτασπρες γάτες με δύο γαλάζια μάτια γεννιούνται κουφές. Αν κάποια δεν γυρίσει όταν πλησιάζεις, ίσως απλώς δεν σε άκουσε.
- **FR** Beaucoup de chats tout blancs aux deux yeux bleus naissent sourds. S’il ne se retourne pas quand tu approches, c’est peut-être qu’il ne t’a pas entendu.

**Fact 14 · The slow blink**
- **EN** Try a slow blink. A 2020 study found cats often slow-blink back at people who do it, and are more willing to come closer afterwards.
- **EL** Δοκίμασε ένα αργό ανοιγοκλείσιμο των ματιών. Μια μελέτη του 2020 βρήκε ότι οι γάτες συχνά ανταποδίδουν το αργό βλεφάρισμα και πλησιάζουν πιο πρόθυμα μετά.
- **FR** Essaie un clignement lent des yeux. Une étude de 2020 a montré que les chats répondent souvent par un clignement lent, et s’approchent plus volontiers ensuite.

**Fact 15 · Tail up**
- **EN** A tail held straight up is a cat's friendly hello. A tail tucked low, or fur standing on end, means give it room.
- **EL** Η ουρά σηκωμένη ίσια προς τα πάνω είναι το φιλικό «γεια» μιας γάτας. Ουρά χαμηλά ή τρίχωμα σηκωμένο σημαίνει «άφησέ με λίγο».
- **FR** Une queue dressée bien droite, c’est le bonjour amical d’un chat. Une queue basse, ou des poils hérissés, veulent dire : laisse-lui de l’espace.

**Fact 16 · Not every purr is happy**
- **EN** Cats purr when they're content, but also when they're stressed, hurt or giving birth. A purr can be a cat calming itself down.
- **EL** Οι γάτες γουργουρίζουν όταν είναι ευχαριστημένες, αλλά και όταν έχουν άγχος, πονάνε ή γεννάνε. Το γουργούρισμα μπορεί να είναι ο τρόπος τους να ηρεμούν.
- **FR** Les chats ronronnent quand ils sont contents, mais aussi quand ils sont stressés, blessés ou en train de mettre bas. Ronronner peut être une façon de se calmer.

**Fact 17 · No sweet tooth**
- **EN** Cats can't taste sweetness. The gene for sweet taste stopped working in their ancestors, which is why a cat will ignore your ice cream but not your sardine.
- **EL** Οι γάτες δεν νιώθουν τη γλυκιά γεύση. Το γονίδιο της γλυκιάς γεύσης έπαψε να λειτουργεί στους προγόνους τους, γι’ αυτό αγνοούν το παγωτό σου αλλά όχι τη σαρδέλα σου.
- **FR** Les chats ne sentent pas le goût sucré. Le gène du goût sucré a cessé de fonctionner chez leurs ancêtres : voilà pourquoi ta glace ne l’intéresse pas, mais ta sardine, si.

**Fact 18 · Kittens are born with blue eyes**
- **EN** Every kitten is born with blue eyes. Their real colour comes through over the first few months, so a blue-eyed kitten may grow up green or gold.
- **EL** Όλα τα γατάκια γεννιούνται με γαλάζια μάτια. Το πραγματικό τους χρώμα φαίνεται μέσα στους πρώτους μήνες, οπότε ένα γατάκι με γαλάζια μάτια μπορεί να μεγαλώσει με πράσινα ή χρυσά.
- **FR** Tous les chatons naissent avec les yeux bleus. Leur vraie couleur apparaît au cours des premiers mois : un chaton aux yeux bleus peut grandir avec des yeux verts ou dorés.

### Life in a colony (strand 2)

**Fact 19 · Families of females**
- **EN** A street colony often grows around related females: mothers, daughters, sisters. They may even help look after each other's kittens.
- **EL** Μια αποικία του δρόμου συχνά σχηματίζεται γύρω από συγγενικές θηλυκές γάτες: μητέρες, κόρες, αδελφές. Μπορεί μάλιστα να φροντίζουν η μία τα γατάκια της άλλης.
- **FR** Une colonie des rues se forme souvent autour de femelles apparentées : mères, filles, sœurs. Elles s’occupent parfois même des chatons les unes des autres.

### You're doing science (strand 6)

**Fact 20 · "Can't tell" is a good answer** · *core*
- **EN** "Can't tell" is a good answer. An honest "not sure" keeps the island's record true. A confident guess that's wrong can send a volunteer to the wrong cat.
- **EL** Το «Δεν μπορώ να πω» είναι καλή απάντηση. Ένα ειλικρινές «δεν είμαι σίγουρος» κρατά σωστό το αρχείο του νησιού. Μια λάθος σίγουρη απάντηση μπορεί να στείλει έναν εθελοντή στη λάθος γάτα.
- **FR** « Je ne sais pas » est une bonne réponse. Un « pas sûr » honnête garde le registre de l’île fiable. Une réponse sûre mais fausse peut envoyer un bénévole vers le mauvais chat.

The quoted "Can't tell" must match the live answer labels (`earTipCantTell`: *Can't tell*, *Δεν μπορώ να πω*, *Je ne sais pas*; checked on origin/main `f757c0d`).

### 4.1 The card's own words

| Key | English | Ελληνικά | Français |
|---|---|---|---|
| `waitingEyebrow` | While we look… | Όσο ψάχνουμε… | Pendant qu’on cherche… |
| `waitingFactA11yLabel` | While we look, a cat fact | Όσο ψάχνουμε, κάτι για τις γάτες | Pendant qu’on cherche, une info sur les chats |

### 4.2 Choices the reviewer should know were deliberate

- **Gender in fact 1.** English, Greek and French all say "she": the example photo is of a female cat (Jacky's photos, SYC-79).
- **Fact 13 says "many", not a percentage.** Studies put it at 65–85% of all-white, two-blue-eyed cats (§12). "Many" is true and won't age.
- **Fact 18 gives no exact weeks.** The research found only weak sources for the timing (§12), so the fact says "the first few months".
- **Fact 5 says "aims for", not "keeps".** Whether sterilise-and-return holds a colony stable is argued over by researchers (§12). The fact says what sterilising is for, not that it always works.
- **Fact 8 doesn't call bread poisonous.** It isn't; it's just not food for cats. Cooked bones were cut: the risk is real but the research found no authoritative source to point at.
- **No whiskers fact.** "Whiskers are as wide as the cat" is everywhere online and has no good source behind it.
- **Fact 20's Greek uses the masculine "σίγουρος".** That's the general form; Johnny should say whether a neutral phrasing reads better.

---

## 5. Where the facts live

In the app itself, as text in the three languages, alongside the rest of the app's words. Each fact has an id (`fact.earTip`, `fact.lactose`, …), its strand, whether it's core, and whether it shows the ear-tip photo. The photo is the one already in the app for the ear-tip question.

There is no admin screen for facts at MVP. Changing a fact's words means an app update; switching one off doesn't (§9).

**A page with all the facts** is part of Teaching in full (SYC-61, MLP), as is showing a fact about *the cat just photographed* (the tortoiseshell fact when the cat is a tortoiseshell). The facts here are tagged so that's a small step later.

---

## 6. With no signal or weak signal

Being precise, because offline support in Cat Spotters is partial:

- **The words and the photo need no signal.** They're part of the app, not downloaded when the card shows.
- **The card appears only while a sighting is being sent.** With no signal, the app saves the sighting on the phone and says so; there's no wait and no card. When the saved sighting is sent later, it's matched in the background, with no card then either.
- **Weak signal means a longer wait,** so there's more time to read. The card behaves the same.
- **On the website** (which testers use), the facts are there whenever the app itself has loaded. The website can't be opened from scratch with no signal at all; that's true of the whole site, not just this card.
- **Turning a fact off** (§9) reaches a phone the next time it loads the app's settings with a connection. Until then, the phone keeps showing what it had.

---

## 7. What Syros Cats must confirm

All twenty go to Syros Cats in English with one question: *is anything here wrong, or something you'd rather we didn't say?* These need a specific yes, by **Monday 19 October** for answers before the copy freeze on 22 October:

1. **Fact 1:** "On Syros it's usually the left ear." The 1 September meeting said usually the left, and the research found no fixed rule internationally (§12). Is it still true for every vet Syros Cats uses?
2. **Fact 3:** that sterilisation slows the spread of FIV across the island. Their own TNR page says it reduces "the spread of feline disease such as FIV" (§12). Is FIV the right disease to name, or is there one they see more on Syros?
3. **Fact 5:** "new cats often move in". Researchers argue about how strong this effect is (§12). Do Syros Cats see it, and are they comfortable with the wording "aims for a settled colony"?
4. **Fact 9:** topping up water. Their feeding-programme page asks visitors to refill water bowls (§12). Is that something they want every visitor doing, everywhere, or only at their own stations?
5. **Fact 11:** kittens on their own. The fact says to watch from a distance and use "This cat needs help" if they look cold, hurt or ill. Does that match their litter guidance ("contact us first, don't just turn up")?
6. **Fact 6:** €50–60 per sterilisation is the figure they confirmed on 1 September. Still right?

---

## 8. Open decisions, each with a recommendation

### Decision 1 · What order the facts come in

| Option | What a new spotter sees | Benefits | Risks |
|---|---|---|---|
| **A. Fixed start, then shuffled** *(recommended)* | Nudge, ear tip, lactose, then the rest in a random order with no repeats until all are seen | The three things the charity cares about most reach everyone, in the order that helps (the ear tip right before the ear-tip question). Repeat spotters still get variety | A visitor who only spots twice never sees the lactose fact |
| **B. All shuffled** | Any fact, any time | Simplest | The ear-tip explainer might arrive on someone's tenth spot, long after they've answered the question ten times |
| **C. Fixed order, always the same** | The same sequence for everyone | Predictable; easy to test | Two friends spotting together see the same fact at the same time, every time |

**Recommendation: A.**

### Decision 2 · Should facts stay on screen after the result arrives?

| Option | What the spotter sees | Benefits | Risks |
|---|---|---|---|
| **A. No, the fact goes with the wait** *(recommended)* | A fact during the wait; the result screen as it is today | The reward screen stays clean: points, then the questions. Facts are a bonus, not a task | On a fast connection a fact may be on screen only a second or two |
| **B. Yes, at the bottom of the reward screen** | The fact again, below the questions | Every fact gets read | The reward screen grows on every spot, competing with the questions that matter to the record |

**Recommendation: A.** The nudge is the exception (`feeding-nudge.md` Decision 2) because it asks the spotter to do something. A fact that counts as seen only after a full second on screen (§3.3) means a fact cut short comes round again.

### Decision 3 · Twenty facts, or ten?

The launch plan lists cutting to ten facts as a fallback (SYC-343). Each fact is about 30 words in three languages; twenty facts is roughly 1,200 words of Greek and French for Johnny.

| Option | What ships | Benefits | Risks |
|---|---|---|---|
| **A. All twenty** *(recommended, if Johnny has the time)* | The full set | What the product spec asks for. Regular spotters don't see repeats for twenty spots | Doubles Johnny's review |
| **B. The ten marked core** | Ear tip, the sterilisation facts, milk, wrong food, kittens, tortoiseshell, "can't tell" | Half the review. Every fact Syros Cats specifically asked for is in | A regular spotter starts seeing repeats after ten spots |
| **C. Core ten at launch, the other ten in the first update** | Ten at launch, twenty within weeks | Launch is safe; the set still reaches twenty | Two review rounds instead of one |

**Recommendation: A**, falling back to **C** if Johnny can't review all twenty by 27 October. A fact never ships in one language without the other two.

---

## 9. For the builder

- **Copy:** the twenty facts and the card's words go in `lib/i18n.ts` (or a sibling `lib/starterFacts.ts` that reads from it), with the id, strand, core flag and photo flag listed once. The existing parity test must cover them: every fact in all three languages.
- **Word limit test:** every fact is 35 words or fewer in every language (Greek and French run longer; the test counts each language separately).
- **The schedule:** one small pure function decides what each wait shows (§3.2 and `feeding-nudge.md` §3.2), given the phone's record and today's date. It's unit-tested without mounting a screen.
- **Switching a fact off:** the server's configuration (beside the campaign settings) can list fact ids to hide, e.g. `HIDDEN_FACT_IDS`. Hidden facts are skipped in the shuffle. Nothing else is configurable.
- **The photo:** the existing `EAR_TIP_EXAMPLE_PHOTO` (`lib/earTipExample.ts`), not a copy.

### 9.1 Tests that must exist

1. A new phone's waits show, in order: the nudge, fact 1 with the photo, fact 7, then a shuffled fact.
2. No fact repeats until all twenty have been seen; after a reshuffle, the first fact isn't the last one seen.
3. A fact on screen for less than 1 second isn't marked seen.
4. An offline save shows no card and changes nothing in the record.
5. A hidden fact id is never shown, and the rest still rotate.
6. When the result arrives, a fact goes with the wait; nothing about facts appears on the reward screen.
7. All twenty facts and the card's words exist in English, Greek and French.
8. Every fact is 35 words or fewer in each language.
9. The quoted labels in facts 11 and 20 match the live `reportNeedsHelp` and `earTipCantTell` strings in each language.

---

## 10. Dates

| When | What |
|---|---|
| Fri 16 Oct | Spec and review done (SYC-343) |
| Mon 19 Oct | Samuel approves. The §7 questions go to Syros Cats with all twenty facts |
| Thu 22 Oct | Copy freeze: English final with Syros Cats' corrections; Greek and French drafts updated to match and sent to Johnny (SYC-283) |
| 23–27 Oct | Johnny's corrections folded in. If he can't do all twenty, the core ten ship (Decision 3) |
| Sat 31 Oct | Launch |

---

## 11. Review

An independent adversarial review (Sonnet, 15 October 2026) read this spec and `feeding-nudge.md` together against the product spec, the proposal, the live spot flow and the canonical facts. Its findings, and what was done about each, are in [`reviews/feeding-nudge-and-starter-facts-review.md`](./reviews/feeding-nudge-and-starter-facts-review.md).

---

## 12. Sources (for the spec, not the app)

The app shows no citations. These are for Samuel, Syros Cats and Johnny. Researched 15 October 2026; "opened" means the page itself was read, "search" means only its search listing was seen.

| Fact | What it rests on | Sources |
|---|---|---|
| 1 Clipped tip | Removed under anaesthetic, heals quickly; left ear is a common convention, not universal | Alley Cat Allies, "Why the eartip" (opened) · Syros Cats: *"You will see which cats have been sterilised by their clipped ear-tip"* (syroscats.com, opened) · "usually the left": 1 Sept 2026 meeting (`docs/PRODUCT-SPEC.md` §1) |
| 2 Litters | 2–3 litters a year; pregnancy possible from about 4 months | Agriculture Victoria, early desexing fact sheet (search) · PetSmart learning centre (search) |
| 3 Disease | FIV spreads mainly through deep bites; entire males most at risk; neutered cats fight and roam less | Cats Protection, benefits of neutering (search) · University of Nottingham repository study on FIV and neuter status (search) · Syros Cats, "Support our TNR work": reduces *"the spread of feline disease such as FIV"* (opened) |
| 4 Back home | Sterilise-and-return means the cat goes back to its own territory | Alley Cat Allies (opened) · Syros Cats TNR page (opened) |
| 5 Vacuum | **Contested.** Supported by advocacy groups; disputed by Longcore et al. 2009 (*Conservation Biology*); Wolf et al. 2019 accept new cats join colonies and say TNR works with enough intensity | Longcore et al. 2009, PubMed 19245489 (search) · Wolf et al. 2019, PMC6769729 (opened) · Alley Cat Allies, "The vacuum effect" (search) |
| 6 Cost | €50–60 per cat | Syros Cats, 1 Sept 2026 meeting (`docs/PRODUCT-SPEC.md`; canonical in `CLAUDE.md`) |
| 7 Milk | "Most cats are lactose intolerant to some degree" | Dr Bruce Kornreich, Cornell Feline Health Center, quoted in Inverse (search) |
| 8 Wrong food | Onions and garlic, chocolate, grapes and raisins are toxic; bread is not a toxin | Merck Veterinary Manual list via Kinship (search) · Cat Care Society (search) |
| 9 Water | Syros Cats ask visitors to refill water and not to leave wet food or biscuits by bins | Syros Cats, "Feeding programmes" (opened) |
| 10 Hissing | A defensive, "repelling" behaviour from fear or anxiety | International Cat Care, "Cat communication" (search) |
| 11 Kittens | Mother often returns within a few hours; intervene sooner if kittens look cold, hurt or ill | ASPCA, "I found kittens outside, what do I do?" (opened) · Alley Cat Allies, "Leave them be" (search) |
| 12 Tortoiseshell | Orange gene on the X chromosome; rare males usually XXY | MSD/Merck Veterinary Manual table (search) |
| 13 White, blue eyes | 65–85% of all-white cats with two blue eyes are deaf | Cornell College of Veterinary Medicine, "White cats and deafness" (opened) |
| 14 Slow blink | Cats slow-blink back and approach more readily | Humphrey et al. 2020, *Scientific Reports* 10:16503 (search) |
| 15 Tail up | "Tail up" signals friendly intent | International Cat Care, "Cat communication" (search) |
| 16 Purring | Purring also occurs with stress, pain, birth | *Scientific American*, "Why do cats purr?" (search) |
| 17 Sweet taste | Sweet receptor gene (Tas1r2) is a pseudogene in cats | Li et al. 2005, *PLoS Genetics* (search) |
| 18 Kitten eyes | All kittens born blue; adult colour in the first months. **Exact weeks weakly sourced, so not stated** | Secondary sources only (search) |
| 19 Related females | Colonies built on related females with shared kitten care | International Cat Care (search) |
| 20 "Can't tell" | The app's own rule: no visible clip is never evidence against | `cat-record-data-spine.md` §4 |

**Also checked for the feeding nudge** (`feeding-nudge.md` §7): Syros Cats' donation page is **syroscats.com/donations** (opened), offering PayPal, card and bank transfer. Syros Cats is a UK registered charity (1207145). On the €1 figure: decent dry food in Greece works out at roughly €0.20–0.56 per cat per day (Friskies 2 kg listed from €7.69 on Skroutz, at 50–70 g a day; search). €1 is therefore plausible only if it covers more than dry food (wet food, the feeding round, water, bowls), which is why Syros Cats must confirm it.

**Considered and left out:** whiskers as wide as the body (no good source) · the flehmen "grimace" and cats' sleep hours (sound, but lower value than the twenty above; candidates for SYC-61) · FeLV (spreads through friendly contact, so sterilisation helps it less directly).
