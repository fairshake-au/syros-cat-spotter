# Starter facts, in three languages

**Status:** Draft for Samuel's approval, 15 October 2026. **All four decisions answered by Samuel, 15 October 2026, as recommended** (§8). An independent adversarial review (Sonnet) found 2 blockers and 15 major issues across this spec and `feeding-nudge.md`, including six facts that needed rewording. All are fixed here; the review and how each finding was handled are in [`reviews/feeding-nudge-and-starter-facts-review.md`](./reviews/feeding-nudge-and-starter-facts-review.md).
**Owner:** Samuel
**Covers:** SYC-48 (and the shared half of SYC-343). `docs/PRODUCT-SPEC.md` §2.2: *"Starter content set: ~20 authored facts per language, including the lactose fact and an ear-tip explainer with a photo example."* Also the 1 September meeting's teaching addition: *"Add disease-spread prevention to the sterilisation benefits."*
**Builds on:** the proposal §13 "What the app teaches" (the six strands and the first example facts) · the engagement design §5 (`docs/superpowers/specs/2026-07-28-engagement-and-donations-design.md`: use the waiting time, author the content, never generate it live) · the ear-tip example photo (SYC-79, in the app as `assets/images/ear-tip-example.jpg`, used by the ear-tip question, SYC-37).
**Seeds:** Teaching in full (SYC-61, MLP). Every fact is tagged with its strand so SYC-61 builds on this set rather than replacing it.
**Shares a slot with:** [`feeding-nudge.md`](./feeding-nudge.md) (SYC-36). This spec defines **the waiting card** (§3) that both use.
**Dates:** launch 31 October 2026 (SYC-73). Greek and French drafts reach Johnny for native review (SYC-283) by Thursday 22 October, per the launch plan (PR #172); his corrections land 23–27 October.

---

## 1. The short version

While Cat Spotters looks for a match, the spotter sees **one short fact about cats** in the space where the map was. Twenty facts, written once, sent to Syros Cats to check, and the same twenty in English, Greek and French. Facts that need their specific yes stay switched off until they give it.

They're chosen to be worth reading and to make people better at helping. Eleven are about sterilisation, food and being around a street cat, plus one on kittens found alone. The rest teach people to read a cat: why the tortoiseshell is almost always female, what a slow blink means, why the white cat with blue eyes didn't run.

- **The order:** the feeding nudge on a phone's first spot (`feeding-nudge.md`); the **ear-tip explainer, with the photo**, on the second; the **milk fact** on the third; then the rest in a shuffled order, with no repeats until all twenty have been seen.
- **No signal needed** for the words or the photo: they're part of the app. The card itself appears only while a sighting is being sent (§6).
- **Nothing for the team to manage.** Facts change with an app update; a fact Syros Cats want pulled can be switched off without one (§9).

---

## 2. Why this matters

The match wait is the one moment in the app when a spotter is certain to be looking at the screen, often with the cat still in front of them. The proposal and the engagement design both spend that moment on teaching, because a fact read while looking at a cat is the one people remember.

**Facts are authored, not generated.** Every fact here is written once, sourced, sent to Syros Cats to check, and native-reviewed. The facts that most need their expertise ship only with their yes (§7). Nothing is made up while the app runs, so the app can't tell someone something false about cats in the charity's name.

### 2.1 Two audiences, needs that fit together

| | Tourists | Locals and cat guardians |
|---|---|---|
| **What they get** | Something to read in the wait, and a reason to look again at the next cat (the tail, the ear, the eyes) | The things they already know, said to visitors in three languages: no milk, no leftovers, kittens alone usually aren't, a clipped ear is a cat already helped |
| **What it gives Syros Cats** | Better spotters: people who can read a clipped ear and say "can't tell" honestly | Fewer kittens carried to the sanctuary, fewer saucers of milk outside cafés |

---

## 3. The waiting card

This is the one slot both specs share. It's defined here once.

### 3.1 Where and when

When the spotter taps **Check for matches** and the sighting is being sent, **the card takes the place of the map** on the New spot screen, under the photo, labelled **While we look…**. The map is locked while a sighting is sending, so nothing is lost; the card sits where the spotter is already looking, not below the button where a small phone would hide it.

The card appears for **every** wait while a sighting is sending, however that wait ends: a match, a new cat, a photo with no cat in it, a failed send. It doesn't appear when the sighting is saved for later with no signal (§6), or anywhere else in the app.

It never delays anything. The result arrives exactly when it would have without the card.

### 3.2 What it shows, and what happens next

One thing per wait, chosen in this order:

1. **The full feeding nudge**, if it hasn't been counted yet and the spotter isn't signed in as a cat guardian or team member (`feeding-nudge.md` §3.2). On a new phone, that's the first wait. (The nudge's daily one-liner never takes the card; it appears with the matches, so those waits show a fact.)
2. **The ear-tip explainer** (fact 1), if this phone hasn't seen it yet.
3. **The milk fact** (fact 7), if this phone hasn't seen it yet.
4. **The next fact in this phone's shuffled order** of the other eighteen.

So a new spotter sees: nudge, ear tip, milk, then the shuffle. When every fact (except hidden ones) has been seen, the order reshuffles, and the new order never starts with the fact seen last.

| What happens | During the wait | After the wait |
|---|---|---|
| **Sending, full nudge due** | The nudge's words, no buttons | The nudge moves to the first result screen with its buttons, and is counted (`feeding-nudge.md` §3.3) |
| **Sending, fact due** | The fact | The fact goes with the wait. It counts as seen if it was on screen for **3 seconds** or more |
| **The photo has no cat in it** | Whatever was due | Nothing carries over. Nothing is counted; the next wait shows the same item |
| **The send fails, or the spotter chooses "Save and send later"** | Whatever was due | Nothing is counted; the next wait shows the same item |
| **No signal: saved on the phone** | No wait, no card | Nothing: no fact, no nudge (`feeding-nudge.md` §3.5). Nothing is counted |
| **A fact is switched off** (§9), including fact 1 or 7 | Skipped, as if already seen | "Seen them all" means all the facts that are switched on |
| **The app's settings have never loaded** | Nothing is switched off; the nudge uses its no-link form and isn't counted | — |
| **The phone's record can't be read** | A fact, never the nudge | Nothing is saved for this wait |

### 3.3 Short waits

Matching often takes only a few seconds, so facts are short: **35 words or fewer** in every language, most under 30. A word is a space-separated piece of text containing a letter or digit, so French « ? » and « : » don't count, and l’oignon is one word. A fact counts as **seen** after **3 seconds** on screen; if the result arrives sooner, it comes round again next time.

Facts **don't follow the spotter to the result screens**. When the result arrives, the fact goes (Decision 2, §8). The nudge and its daily one-liner are the exceptions, because they ask the spotter to do something.

The real length of the wait hasn't been measured. Before building, the plan measures it on the live server (`feeding-nudge.md` §9).

### 3.4 What the phone remembers

One small record on the phone, or in the browser on the website, stored under its own versioned key (e.g. `catSpotters.waitingCard.v1`):

- whether the full nudge has been counted, the date of the last one-liner, whether the button was tapped, and the date of this phone's first spot (`feeding-nudge.md` §3.2);
- which facts have been seen, and this phone's shuffled order.

None of it is sent to the server or tied to a username. **Delete my data** removes it with everything else. If a browser clears its storage, the full nudge may show once more and the facts start again; the resident signals for the one-liner come from the server, so a resident still gets no one-liners (`feeding-nudge.md` §3.2). The record is best-effort: if it can't be read, the card shows a fact (never the nudge) and saves nothing for that wait. Two browser tabs may occasionally both show the first item; that's acceptable.

### 3.5 What it looks like

A card in the same style as the result screens' cards: rounded, white, bordered, never full-screen.

- **Eyebrow:** *While we look…*
- **The fact**, in body text.
- **For the ear-tip explainer only:** the example photo above the text, at its 2:1 shape, with the same screen-reader description the ear-tip question uses (`earTipExampleAlt`).
- No buttons on a fact. Nothing to tap, nothing to dismiss.

**Fit.** The card's top is in view when it appears, on an iPhone SE (375 × 667) at the default text size, in all three languages. At the largest text size the screen scrolls, with the card's top still in view.

**Screen readers.** The card announces only *"While we look, a cat fact"* (`waitingFactA11yLabel`) when it appears; the fact itself is read when the spotter moves to it. Focus stays on the spotter's button. With "reduce motion" on, the card appears without a transition.

---

## 4. The twenty facts

French uses **tu** and Greek the informal singular, to match the rest of the app. The words "cat guardian" (**κηδεμόνας γατών**, **gardien de chats**), "spotter", "clipped tip" and "sterilise" are used throughout; never "colony carer", "snapper", "notched" or "desex". Greek writes **γάτα** as feminine by default, as the app already does. In French and Greek the builder uses a **non-breaking space** inside « », before « ? : ; ! » in French, and between a number and €.

Each fact has a **strand**, from the six in the proposal (and SYC-61): **1** Reading a cat · **2** Life in a colony · **3** Why sterilisation works · **4** Being around a street cat · **5** When a cat needs help · **6** You're doing science. Strands 2 and 6 have one fact each on purpose: the wait is short, and the facts about welfare and reading a cat matter more now. SYC-61 fills them out.

**Core** marks the ten that ship first if the set has to be cut (Decision 3, §8). **Sign-off** marks the facts Syros Cats must specifically say yes to (§7); every fact goes to them, but these need a yes, and **a sign-off fact without a yes by 22 October is switched off at launch** (§9).

These are drafts. Greek and French go to Johnny (SYC-283) on Thursday 22 October.

### Sterilisation (strand 3)

**Fact 1 · The clipped ear tip** · *core* · *sign-off* · **shows the ear-tip example photo**
- **EN** The flat top on the ear in this photo is a clipped tip: the sign a cat is sterilised. The vet trims it while she's asleep. On Syros it's usually the left ear.
- **EL** Η ίσια κοπή στην κορυφή του αυτιού σε αυτή τη φωτογραφία δείχνει ότι η γάτα έχει στειρωθεί. Ο κτηνίατρος την κάνει ενώ κοιμάται. Στη Σύρο είναι συνήθως το αριστερό αυτί.
- **FR** Le haut tout plat de l’oreille sur cette photo, c’est un bout coupé : le signe qu’une chatte est stérilisée. Le vétérinaire le coupe pendant qu’elle dort. À Syros, c’est généralement l’oreille gauche.

**Fact 2 · How fast it adds up** · *core*
- **EN** One unsterilised female can have two or three litters a year, and her daughters can be pregnant themselves from as young as four months.
- **EL** Μία μη στειρωμένη θηλυκή γάτα μπορεί να κάνει δύο ή τρεις γέννες τον χρόνο, και οι κόρες της μπορούν να μείνουν έγκυες ήδη από τεσσάρων μηνών.
- **FR** Une femelle non stérilisée peut avoir deux ou trois portées par an, et ses filles peuvent elles-mêmes attendre des petits dès l’âge de quatre mois.

**Fact 3 · Sterilisation and disease** · *core* · *sign-off* · the 1 September meeting's addition
- **EN** Sterilised cats fight and roam less, so they're less likely to catch or pass on diseases spread by bites, like FIV, which doesn't affect people.
- **EL** Οι στειρωμένες γάτες τσακώνονται και περιφέρονται λιγότερο, οπότε είναι λιγότερο πιθανό να κολλήσουν ή να μεταδώσουν ασθένειες που περνούν με δαγκωματιές, όπως ο FIV, που δεν προσβάλλει τους ανθρώπους.
- **FR** Les chats stérilisés se battent et errent moins : ils risquent moins d’attraper ou de transmettre des maladies qui passent par les morsures, comme le FIV, qui ne touche pas les humains.

**Fact 4 · Back home afterwards** · *core* · *sign-off*
- **EN** After sterilisation, most street cats go back to exactly where they were found: their own patch, their own colony, the people who feed them.
- **EL** Μετά τη στείρωση, οι περισσότερες γάτες του δρόμου επιστρέφουν ακριβώς εκεί που βρέθηκαν: στη γειτονιά τους, στην αποικία τους, στους ανθρώπους που τις ταΐζουν.
- **FR** Après leur stérilisation, la plupart des chats des rues retournent exactement là où on les a trouvés : leur coin, leur colonie, les gens qui les nourrissent.

**Fact 5 · Why taking cats away doesn't work** · *sign-off*
- **EN** Take cats away from a place with food and shelter, and new cats often move in. Sterilising them instead aims for a settled colony that stops growing.
- **EL** Αν απομακρύνεις τις γάτες από ένα μέρος με φαγητό και καταφύγιο, συχνά έρχονται καινούργιες. Η στείρωση στοχεύει σε μια σταθερή αποικία που σταματά να μεγαλώνει.
- **FR** Si on retire les chats d’un endroit où il y a à manger et un abri, d’autres arrivent souvent. Les stériliser vise plutôt une colonie stable qui cesse de grandir.

**Fact 6 · What it costs** · *core* · *sign-off*
- **EN** Sterilising one female cat costs Syros Cats €50–60. That one operation prevents every litter she would otherwise have had.
- **EL** Η στείρωση μίας θηλυκής γάτας κοστίζει στις Syros Cats 50–60 €. Αυτή η μία επέμβαση αποτρέπει κάθε γέννα που θα έκανε διαφορετικά.
- **FR** Stériliser une chatte coûte 50 à 60 € à Syros Cats. Cette seule opération évite toutes les portées qu’elle aurait eues.

### Food, and being around a street cat (strand 4)

**Fact 7 · Milk** · *core* · the lactose fact (Jacky)
- **EN** Most grown-up cats digest milk badly, so a saucer of milk often means an upset stomach. Fresh water is what they need.
- **EL** Οι περισσότερες ενήλικες γάτες δεν χωνεύουν καλά το γάλα, γι’ αυτό ένα πιατάκι γάλα συχνά τους φέρνει στομαχόπονο. Αυτό που χρειάζονται είναι φρέσκο νερό.
- **FR** La plupart des chats adultes digèrent mal le lait : une soucoupe de lait leur donne souvent mal au ventre. Ce qu’il leur faut, c’est de l’eau fraîche.

**Fact 8 · Leftovers aren't cat food** · *core* · *sign-off*
- **EN** Onions, garlic and chocolate are poisonous to cats. Cooked bones, cured meat and salty leftovers can hurt them too. Leftovers aren't cat food.
- **EL** Το κρεμμύδι, το σκόρδο και η σοκολάτα είναι δηλητηριώδη για τις γάτες. Τα μαγειρεμένα κόκαλα, τα αλλαντικά και τα αλμυρά αποφάγια μπορούν επίσης να τις βλάψουν. Τα αποφάγια δεν είναι τροφή για γάτες.
- **FR** L’oignon, l’ail et le chocolat sont toxiques pour les chats. Les os cuits, la charcuterie et les restes salés peuvent aussi leur faire du mal. Les restes ne sont pas de la nourriture pour chats.

**Fact 9 · Water at a feeding spot** · *sign-off*
- **EN** See a dry water bowl at a feeding spot? Topping it up helps, especially in summer. Food is best left to the people who feed the cats regularly.
- **EL** Βλέπεις άδειο μπολ για νερό σε σημείο ταΐσματος; Αν το γεμίσεις, βοηθάς, ειδικά το καλοκαίρι. Το φαγητό καλύτερα να το αφήνεις σε όσους ταΐζουν τις γάτες τακτικά.
- **FR** Tu vois une gamelle d’eau vide à un point de nourrissage ? La remplir aide, surtout en été. La nourriture, mieux vaut la laisser à ceux qui nourrissent les chats régulièrement.

**Fact 10 · A hiss means space**
- **EN** A hissing cat isn't being nasty. It's frightened and asking for space. Step back and let it be.
- **EL** Μια γάτα που φυσάει δεν είναι κακιά. Έχει φοβηθεί και ζητά χώρο. Κάνε ένα βήμα πίσω και άφησέ την ήσυχη.
- **FR** Un chat qui crache n’est pas méchant. Il a peur et demande de l’espace. Recule et laisse-le tranquille.

**Fact 11 · Admire, don't pick up**
- **EN** Even a friendly street cat can panic, scratch or bite if you pick it up. Let it come to you, or simply admire it where it is.
- **EL** Ακόμη και μια φιλική γάτα του δρόμου μπορεί να πανικοβληθεί, να γρατζουνίσει ή να δαγκώσει αν τη σηκώσεις. Άφησέ τη να έρθει σε σένα ή απλώς θαύμασέ τη εκεί που είναι.
- **FR** Même un chat des rues gentil peut paniquer, griffer ou mordre si tu le prends dans tes bras. Laisse-le venir à toi, ou admire-le simplement là où il est.

### When a cat needs help (strand 5)

**Fact 12 · Kittens on their own** · *core* · *sign-off*
- **EN** Kittens on their own? Their mother has usually just gone for food. Don't pick them up; watch from a distance. If they look cold, hurt or ill, report them in the app.
- **EL** Γατάκια μόνα τους; Η μητέρα τους συνήθως έχει πάει για φαγητό. Μην τα σηκώσεις· παρακολούθησε από απόσταση. Αν κρυώνουν, είναι τραυματισμένα ή άρρωστα, ανέφερέ τα από την εφαρμογή.
- **FR** Des chatons tout seuls ? Leur mère est souvent juste partie manger. Ne les prends pas : observe de loin. S’ils ont froid, sont blessés ou malades, signale-les dans l’appli.

The fact names no button, because the spotter reads it during the wait, when "This cat needs help" is hidden. The link is on the Spot screen when nothing is sending, on the match list, and on every cat's page; it isn't on the naming screen (checked on origin/main `f757c0d`). The report flow itself explains what Syros Cats can and can't do (the capacity messaging from Susan's standard reply); the fact promises nothing.

### Reading a cat (strand 1)

**Fact 13 · Tortoiseshells are girls** · *core*
- **EN** Almost every tortoiseshell or calico cat is female. The gene for orange fur sits on the X chromosome, with black as its alternative, so showing both takes two Xs.
- **EL** Σχεδόν όλες οι χελωνόχρωμες και οι τρίχρωμες γάτες είναι θηλυκές. Το γονίδιο του πορτοκαλί τριχώματος βρίσκεται στο χρωμόσωμα Χ, με εναλλακτική το μαύρο, οπότε για να υπάρχουν και τα δύο χρειάζονται δύο Χ.
- **FR** Presque tous les chats écaille de tortue ou calico sont des femelles. Le gène du pelage roux est sur le chromosome X, avec le noir comme alternative : avoir les deux demande deux X.

**Fact 14 · White cats with blue eyes**
- **EN** Many all-white cats with two blue eyes are born deaf. If one doesn't turn when you come near, it may not have heard you: stay where it can see you.
- **EL** Πολλές κάτασπρες γάτες με δύο γαλάζια μάτια γεννιούνται κουφές. Αν κάποια δεν γυρίσει όταν πλησιάζεις, ίσως δεν σε άκουσε: μείνε εκεί που μπορεί να σε δει.
- **FR** Beaucoup de chats tout blancs aux deux yeux bleus naissent sourds. S’il ne se retourne pas quand tu approches, il ne t’a peut-être pas entendu : reste là où il peut te voir.

**Fact 15 · The slow blink**
- **EN** Try a slow blink, from a distance. A 2020 study found cats often slow-blink back, and seem more at ease with people who do it.
- **EL** Δοκίμασε ένα αργό ανοιγοκλείσιμο των ματιών, από απόσταση. Μια μελέτη του 2020 βρήκε ότι οι γάτες συχνά το ανταποδίδουν και φαίνονται πιο άνετες με όποιον το κάνει.
- **FR** Essaie un clignement lent des yeux, de loin. Une étude de 2020 a montré que les chats y répondent souvent, et semblent plus à l’aise avec ceux qui le font.

**Fact 16 · Tail up**
- **EN** A tail held straight up is a cat's friendly hello. A tail tucked low, or fur standing on end, means give it room.
- **EL** Η ουρά σηκωμένη ίσια προς τα πάνω είναι το φιλικό «γεια» μιας γάτας. Ουρά χαμηλά ή τρίχωμα σηκωμένο σημαίνει «κράτα αποστάσεις».
- **FR** Une queue dressée bien droite, c’est le bonjour amical d’un chat. Une queue basse, ou des poils hérissés, veulent dire : laisse-lui de l’espace.

**Fact 17 · Not every purr is happy**
- **EN** Cats purr when they're content, but also when they're stressed, hurt or giving birth. A purr can be a cat calming itself down.
- **EL** Οι γάτες γουργουρίζουν όταν είναι ευχαριστημένες, αλλά και όταν έχουν άγχος, πονάνε ή γεννάνε. Το γουργούρισμα μπορεί να είναι ο τρόπος τους να ηρεμούν.
- **FR** Les chats ronronnent quand ils sont contents, mais aussi quand ils sont stressés, blessés ou en train de mettre bas. Ronronner peut être une façon de se calmer.

**Fact 18 · Kittens' eyes open blue**
- **EN** Kittens' eyes open blue. Their real colour comes through over the first few months, so a blue-eyed kitten may grow up green or gold.
- **EL** Τα μάτια των γατακιών ανοίγουν γαλάζια. Το πραγματικό τους χρώμα φαίνεται μέσα στους πρώτους μήνες, οπότε ένα γατάκι με γαλάζια μάτια μπορεί να μεγαλώσει με πράσινα ή χρυσά.
- **FR** Les yeux des chatons s’ouvrent bleus. Leur vraie couleur apparaît au cours des premiers mois : un chaton aux yeux bleus peut grandir avec des yeux verts ou dorés.

### Life in a colony (strand 2)

**Fact 19 · Families of females** · *sign-off*
- **EN** A street colony often grows around related females: mothers, daughters, sisters. They may even help look after each other's kittens.
- **EL** Μια αποικία του δρόμου συχνά σχηματίζεται γύρω από συγγενικές θηλυκές γάτες: μητέρες, κόρες, αδελφές. Μπορεί μάλιστα να φροντίζουν η μία τα γατάκια της άλλης.
- **FR** Une colonie des rues se forme souvent autour de femelles apparentées : mères, filles, sœurs. Elles s’occupent parfois même des chatons les unes des autres.

### You're doing science (strand 6)

**Fact 20 · "Can't tell" is a good answer** · *core*
- **EN** "Can't tell" is a good answer. An honest "not sure" keeps the island's record true. A confident wrong guess can make a cat look sterilised when it isn't.
- **EL** Το «Δεν μπορώ να πω» είναι καλή απάντηση. Μια ειλικρινής αμφιβολία κρατά σωστό το αρχείο του νησιού. Μια σίγουρη αλλά λάθος απάντηση μπορεί να κάνει μια γάτα να φαίνεται στειρωμένη ενώ δεν είναι.
- **FR** « Je ne sais pas » est une bonne réponse : l’honnêteté garde le registre de l’île fiable. Une réponse sûre mais fausse peut faire croire qu’un chat est stérilisé alors qu’il ne l’est pas.

The quoted "Can't tell" matches the live answer labels (`earTipCantTell`: *Can’t tell*, *Δεν μπορώ να πω*, *Je ne sais pas*; checked on origin/main `f757c0d`). The live strings use a curly apostrophe; the shipped fact uses the same.

### 4.1 The card's own words

| Key | English | Ελληνικά | Français |
|---|---|---|---|
| `waitingEyebrow` | While we look… | Όσο ψάχνουμε… | Pendant qu’on cherche… |
| `waitingFactA11yLabel` | While we look, a cat fact | Όσο ψάχνουμε, κάτι για τις γάτες | Pendant qu’on cherche, une info sur les chats |

### 4.2 Choices the reviewer should know were deliberate

- **Fact 1 says "the ear in this photo"**, because the spotter's own photo is also on screen. All three languages say "she": the example photo is of a female cat (Jacky's photos, SYC-79).
- **Fact 2 says "her daughters"**, because only females get pregnant.
- **Fact 3 is about each cat, not the island.** Sterilised cats fighting less, and so catching and passing on bite-spread disease less, is well supported; claims about island-wide disease rates aren't. It says FIV doesn't affect people, so nobody worries about their own safety or their pet's.
- **Fact 5 says "aims for", not "keeps".** Whether sterilise-and-return holds a colony stable is argued over by researchers (§12).
- **Fact 8 doesn't call bread or grapes poisonous.** Bread isn't. Grapes are well documented for dogs but thinly for cats, so the fact names what's solid and the leftovers people actually give cats on Syros.
- **Fact 9 is about a dry bowl at a feeding spot**, not leaving new bowls anywhere: unattended bowls cause hygiene problems and neighbour complaints.
- **Fact 14 says "many", not a percentage.** Studies put it at 65–85% of all-white, two-blue-eyed cats (§12). "Many" is true and won't age.
- **Facts 14 and 15 keep their distance** ("stay where it can see you", "from a distance"), to agree with the "Look, don't touch" screen.
- **Fact 18 gives no exact weeks.** The research found only weak sources for the timing.
- **No sweet-taste fact.** It was in the first draft ("a cat will ignore your ice cream but not your sardine"), but it invited feeding sardines. Replaced by fact 11.
- **No whiskers fact.** "Whiskers are as wide as the cat" is everywhere online and has no good source.

---

## 5. Where the facts live

In the app itself, as text in the three languages, alongside the rest of the app's words. Each fact has an id (`fact.earTip`, `fact.milk`, …), its strand, whether it's core, whether it needs sign-off, and whether it shows the ear-tip photo. The photo is the one already in the app for the ear-tip question.

There's no admin screen for facts at MVP. Changing a fact's words means an app update; switching one off doesn't (§9).

**A page with all the facts**, and showing a fact about *the cat just photographed* (the tortoiseshell fact when the cat is a tortoiseshell), are part of Teaching in full (SYC-61, MLP). The tags make that a small step later.

---

## 6. With no signal or weak signal

Being precise, because offline support in Cat Spotters is partial:

- **The words and the photo need no signal.** They're part of the app, not downloaded when the card shows.
- **The card appears only while a sighting is being sent.** With no signal, the app saves the sighting on the phone and says so; there's no wait, no fact and no nudge. When the saved sighting is sent later, it's matched in the background, with no card.
- **Weak signal means a longer wait,** so there's more time to read.
- **On the website** (which testers use), the facts are there whenever the app itself has loaded. The website can't be opened from scratch with no signal at all; that's true of the whole site, not just this card.
- **Switching a fact off** (§9) reaches a phone the next time the app starts with a connection. Until then, the phone uses the last settings it saw.

---

## 7. What Syros Cats must confirm

All twenty go to Syros Cats in English with one question: *is anything here wrong, or something you'd rather we didn't say?* These need a specific yes, by **Monday 19 October** for answers before the copy freeze on 22 October. **Any of these without a yes by 22 October is switched off at launch**, and switched on when they say yes, with no new release.

1. **Fact 1:** "On Syros it's usually the left ear." The 1 September meeting said usually the left; the research found no fixed rule internationally (§12). Still true for every vet you use?
2. **Fact 3:** sterilised cats catching and passing on bite-spread disease less, naming FIV. Your own TNR page mentions FIV (§12). Is FIV the right disease to name?
3. **Fact 4:** most street cats go back where they were found. Is that your practice, and is "most" right?
4. **Fact 5:** "new cats often move in". Researchers argue about how strong this is (§12). Do you see it, and are you comfortable with "aims for a settled colony"?
5. **Fact 6:** €50–60 per sterilisation, the figure you confirmed on 1 September. Still right?
6. **Fact 8:** cooked bones, cured meat and salty leftovers. Is that the right list for what people actually leave out on Syros?
7. **Fact 9:** topping up a dry water bowl at a feeding spot. Your feeding-programme page asks visitors to refill water at your stations (§12). Happy for every visitor to do it at any feeding spot, or only yours? (Feeding sites are private by default, so the app never shows where they are.)
8. **Fact 12:** kittens on their own. Watch from a distance, don't pick them up, and report them in the app if they look cold, hurt or ill. Does that match your litter guidance ("contact us first, don't just turn up")? It deliberately promises nothing about collection.
9. **Fact 19:** colonies built around related females. Does that match the colonies you know?

---

## 8. Open decisions, each with a recommendation

### Decision 1 · What order the facts come in

**Decided by Samuel, 15 Oct 2026: A** (fixed start, then shuffled).

| Option | What a new spotter sees | Benefits | Risks |
|---|---|---|---|
| **A. Fixed start, then shuffled** *(recommended)* | Nudge, ear tip, milk, then the rest in a random order with no repeats until all are seen | The three things Syros Cats care most about reach everyone early. Repeat spotters still get variety | A visitor who only spots twice never sees the milk fact |
| **B. All shuffled** | Any fact, any time | Simplest | The ear-tip explainer might arrive on someone's tenth spot |
| **C. Fixed order, always the same** | The same sequence for everyone | Predictable; easy to test | Friends spotting together see the same fact at the same moment, every time |

**Recommendation: A.**

### Decision 2 · Should facts stay on screen after the result arrives?

**Decided by Samuel, 15 Oct 2026: A** (the fact goes with the wait).

| Option | What the spotter sees | Benefits | Risks |
|---|---|---|---|
| **A. No, the fact goes with the wait** *(recommended)* | A fact during the wait; the result screens as they are | The result screens stay clean. Facts are a bonus, not a task. A fact cut short (under 3 seconds) comes round again | On a fast connection, some facts get only a few seconds |
| **B. Yes, below the result** | The fact again, under the matches | Every fact gets read | The result screen grows on every spot, beside the nudge on the spots that have one |

**Recommendation: A.**

### Decision 3 · Twenty facts, or ten?

**Decided by Samuel, 15 Oct 2026: A, falling back to C** (all twenty; core ten plus ten in the first update if Johnny runs out of time).

The launch plan lists cutting to ten facts as a fallback (SYC-343). Twenty facts is roughly 1,200 words of Greek and French for Johnny.

| Option | What ships | Benefits | Risks |
|---|---|---|---|
| **A. All twenty** *(recommended, if Johnny has the time)* | The full set | What the product spec asks for. Regular spotters don't see repeats for twenty spots | Doubles Johnny's review |
| **B. The ten marked core** | Ear tip, the sterilisation facts, milk, leftovers, kittens, tortoiseshell, "can't tell" | Half the review. Every fact Syros Cats specifically asked for is in | A regular spotter sees repeats after ten spots |
| **C. Core ten at launch, the other ten in the first update** | Ten at launch, twenty within weeks | Launch is safe; the set still reaches twenty | Two review rounds instead of one |

**Recommendation: A**, falling back to **C** if Johnny can't review all twenty by 27 October. A fact never ships in one language without the other two.

### Decision 4 · On a new spotter's first spot: the nudge or the ear tip?

**Decided by Samuel, 15 Oct 2026: A** (nudge first).

The ear-tip question after each spot already shows the same example photo and a one-line caption, so the first spot's ear-tip answer gets some help either way.

| Option | First spot | Second spot | Benefits | Risks |
|---|---|---|---|---|
| **A. Nudge first** *(recommended)* | Feeding nudge | Ear-tip explainer | Every spotter, including the one-spot tourist, gets the most valuable welfare message. The question's own photo and caption cover the first answer | The explainer arrives after the first ear-tip answer, not before |
| **B. Ear tip first** | Ear-tip explainer | Feeding nudge | Better first ear-tip answers, so better data | One-spot tourists never see the nudge, and lose its "something to do instead" |

**Recommendation: A.** Feeding harm reaches the cats directly; a wrong first ear-tip answer is one observation among many, and "no visible clip" never counts against a cat.

---

## 9. For the builder

- **Copy:** the twenty facts and the card's words go in `lib/i18n.ts` (or a sibling `lib/starterFacts.ts` reading from it), with the id, strand, core, sign-off and photo flags listed once. The existing parity test covers them: every fact in all three languages.
- **Word limit test:** every fact is 35 words or fewer in every language, counted per language.
- **The card** replaces the location map in the New spot screen's layout while a sighting is sending (`spot.tsx`), and is gone once the result arrives.
- **The schedule:** one small pure function decides what each wait shows (§3.2 and `feeding-nudge.md` §3.2), given the phone's record, the settings, today's date and, afterwards, how the wait ended. It's unit-tested without mounting a screen.
- **Switching a fact off:** the app settings endpoint (`feeding-nudge.md` §9) lists fact ids to hide. Defaults when settings have never loaded: nothing hidden. **At launch**, every sign-off fact without Syros Cats' yes is in that list.
- **The record:** stored under one versioned key, read and written inside try/catch, and removed by **Delete my data**.
- **The photo:** the existing `EAR_TIP_EXAMPLE_PHOTO` (`lib/earTipExample.ts`), not a copy.

### 9.1 Tests that must exist

1. A new phone's waits show, in order: the nudge, fact 1 with the photo, fact 7, then a shuffled fact.
2. No fact repeats until every switched-on fact has been seen; after a reshuffle, the first fact isn't the last one seen.
3. A fact on screen for under 3 seconds isn't marked seen.
4. A wait that ends in a no-cat photo, a failed send or "Save and send later" marks nothing, and the next wait shows the same item.
5. An offline save shows no fact or nudge and changes nothing in the record.
6. A switched-off fact never shows, including fact 1 or 7, and the rest still rotate.
7. When the result arrives, the fact goes; nothing about facts appears on the result screens.
8. If the record can't be read, the card shows a fact, never the nudge, and nothing is written.
9. **Delete my data** removes the record.
10. All twenty facts and the card's words exist in English, Greek and French.
11. Every fact is 35 words or fewer in each language.
12. The quoted label in fact 20 matches the live `earTipCantTell` string in each language, compared after normalising quote marks and apostrophes.
13. The card's top is in view on a 375 × 667 screen when it appears, at the default and the largest text size, in all three languages, including the ear-tip fact with its photo.

A browser-pane check at about 390 px and at desktop width goes with the PR, in all three languages.

---

## 10. Dates

| When | What |
|---|---|
| Fri 16 Oct | Spec and review done (SYC-343) |
| Mon 19 Oct | Samuel approves. The §7 questions go to Syros Cats with all twenty facts |
| Thu 22 Oct | Copy freeze: English final with Syros Cats' corrections; Greek and French drafts updated to match and sent to Johnny (SYC-283). Sign-off facts without a yes are switched off for launch |
| 23–27 Oct | Johnny's corrections folded in. If he can't do all twenty, the core ten ship (Decision 3) |
| Sat 31 Oct | Launch |

---

## 11. Review

An independent adversarial review (Sonnet, 15 October 2026) read this spec and `feeding-nudge.md` together against the product spec, the proposal, the live spot flow and the canonical facts. For this spec it found the card below the fold on small phones, facts counted as seen after a glance, a wrong claim that rejected photos show no card, and six facts that needed rewording (3, 8, 9, 11, 17 and 20 in the first draft), plus translation errors. All fixed above. The full review, and what was done about each of its 40 findings, is in [`reviews/feeding-nudge-and-starter-facts-review.md`](./reviews/feeding-nudge-and-starter-facts-review.md).

---

## 12. Sources (for the spec, not the app)

The app shows no citations. These are for Samuel, Syros Cats and Johnny. Researched 15 October 2026. **Opened** means the page itself was read; **unchecked** means only a search listing was seen, and the claim rests on that listing plus Syros Cats' review. Opening a primary source for every unchecked row before launch is filed as a follow-up.

| Fact | What it rests on | Sources |
|---|---|---|
| 1 Clipped tip | Removed under anaesthetic, heals quickly; left ear is a common convention, not universal | Alley Cat Allies, "Why the eartip" (opened) · Syros Cats: clipped ear-tip shows a cat is sterilised (syroscats.com, opened) · "usually the left": 1 Sept 2026 meeting (`docs/PRODUCT-SPEC.md` §1) |
| 2 Litters | 2–3 litters a year; pregnancy possible from about 4 months | Agriculture Victoria, early desexing fact sheet (unchecked) · PetSmart learning centre (unchecked) |
| 3 Disease | FIV spreads mainly through deep bites; entire males most at risk; neutered cats fight and roam less; FIV doesn't infect people | Syros Cats, "Support our TNR work": TNR reduces the spread of disease such as FIV (opened) · Cats Protection, benefits of neutering (unchecked) · University of Nottingham repository study on FIV and neuter status (unchecked) |
| 4 Back home | Sterilise-and-return means the cat goes back to its own territory | Alley Cat Allies (opened) · Syros Cats TNR page (opened) |
| 5 Vacuum | **Contested.** Supported by advocacy groups; disputed by Longcore et al. 2009 (*Conservation Biology*); Wolf et al. 2019 accept new cats join colonies and say TNR works with enough intensity | Wolf et al. 2019, PMC6769729 (opened) · Longcore et al. 2009, PubMed 19245489 (unchecked) · Alley Cat Allies, "The vacuum effect" (unchecked) |
| 6 Cost | €50–60 per cat | Syros Cats, 1 Sept 2026 meeting (`docs/PRODUCT-SPEC.md`; canonical in `CLAUDE.md`) |
| 7 Milk | "Most cats are lactose intolerant to some degree" | Dr Bruce Kornreich, Cornell Feline Health Center, quoted in Inverse (unchecked) |
| 8 Leftovers | Onions and garlic, chocolate are toxic; cooked bones, cured meat and salty food unsuitable | Merck Veterinary Manual list via Kinship (unchecked) · Cat Care Society (unchecked) · proposal §13 ("bread, milk, cured meat and fish bones all do harm") |
| 9 Water | Syros Cats ask visitors to refill water and not to leave wet food or biscuits by bins | Syros Cats, "Feeding programmes" (opened) · ASPCA Pro, feeding community cats: leftover food draws wildlife and complaints (opened) |
| 10 Hissing | A defensive, "repelling" behaviour from fear or anxiety | International Cat Care, "Cat communication" (unchecked) |
| 11 Don't pick up | Handling frightened cats risks scratches and bites | "Look, don't touch" onboarding copy (SYC-35, `docs/specs/source/safety-copy-translations.md`) · International Cat Care, "Cat communication" (unchecked) |
| 12 Kittens | Mother often returns within a few hours; intervene sooner if kittens look cold, hurt or ill | ASPCA, "I found kittens outside, what do I do?" (opened) · Alley Cat Allies, "Leave them be" (unchecked) |
| 13 Tortoiseshell | Orange gene on the X chromosome; rare males usually XXY | MSD/Merck Veterinary Manual table (unchecked) |
| 14 White, blue eyes | 65–85% of all-white cats with two blue eyes are deaf | Cornell College of Veterinary Medicine, "White cats and deafness" (opened) |
| 15 Slow blink | Cats slow-blink back; authors suggest positive communication | Humphrey et al. 2020, *Scientific Reports* 10:16503 (unchecked) |
| 16 Tail up | "Tail up" signals friendly intent | International Cat Care, "Cat communication" (unchecked) |
| 17 Purring | Purring also occurs with stress, pain, birth | *Scientific American*, "Why do cats purr?" (unchecked) |
| 18 Kitten eyes | Eyes open blue; adult colour in the first months. **Exact weeks weakly sourced, so not stated** | Secondary sources only (unchecked) |
| 19 Related females | Colonies built on related females with shared kitten care | International Cat Care (unchecked) |
| 20 "Can't tell" | The app's own rule: no visible clip is never evidence against; a wrong "clipped" can mark an unsterilised cat as likely done | `cat-record-data-spine.md` §4 |

**Considered and left out:** sweet taste (sound, Li et al. 2005, but the first draft's wording invited feeding) · whiskers as wide as the body (no good source) · the flehmen "grimace" and sleep hours (sound, but lower value; candidates for SYC-61) · FeLV (spreads through friendly contact, so sterilisation helps it less directly) · grapes and raisins (well documented for dogs, thin for cats).
