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
- **EN** Sterilising one cat costs Syros Cats €50–60. It stops that cat adding to the street-cat population.
- **EL** Η στείρωση μίας γάτας κοστίζει στις Syros Cats 50–60 €. Έτσι η γάτα δεν προσθέτει άλλα γατάκια στον πληθυσμό των γατών του δρόμου.
- **FR** Stériliser un chat coûte 50 à 60 € à Syros Cats. Ainsi, ce chat n’ajoute plus de chatons à la population des chats des rues.

*Changed 22 Oct 2026 (SYC-572, Samuel: males cost the same, so "female" and "she" go). The claim itself changed, so Syros Cats must still sign it off.*

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
- **EN** “Can’t tell” is a good answer. A wrong guess can make a cat look sterilised when it isn’t.
- **EL** «Δεν μπορώ να πω» είναι καλή απάντηση. Μια λάθος εικασία μπορεί να κάνει μια γάτα να φαίνεται στειρωμένη ενώ δεν είναι.
- **FR** « Je ne sais pas » est une bonne réponse. Une mauvaise supposition peut faire croire qu’un chat est stérilisé alors qu’il ne l’est pas.

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
- **Switching a fact off:** the app settings endpoint (`feeding-nudge.md` §9) lists fact ids to hide. Defaults when settings have never loaded: nothing hidden. *(Amended 15 Oct 2026 by the match-wait plan, PR #187: the phone's never-loaded default stays "nothing hidden" (Samuel, plan Decision 4). On the server, a missing facts setting hides the nine sign-off facts (plan small call 3).)* **At launch**, every sign-off fact without Syros Cats' yes is in that list.
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

The app shows no citations. These are for Samuel, Syros Cats and Johnny. First researched 15 October 2026; **every row below was re-opened and read on 24 October 2026 (SYC-349)**, including the rows that were already marked opened. "Opened" means the page itself was fetched and read; the page text came back through a fetch-and-summarise tool, so the paraphrases below are of that text. No fact rests on a search listing any more. Where a page wouldn't open, it says so.

**Verdicts: 12 facts that were "unchecked" are now read.** 7 supported as they stand · 5 partly supported, so reworded (2, 8, 15, 17, 18) · **0 dropped**. Rewordings are *proposals*: they change nothing in the app until Samuel approves them (§12.2). The re-check of the facts already marked opened found nothing that needs dropping and one flag on fact 6 (§12.3).

### 12.1 Fact by fact

| Fact | Verdict | What the source says (paraphrase) | Opened 24 Oct 2026 |
|---|---|---|---|
| 1 Clipped tip | Supported. **"Usually the left ear" rests on the 1 Sept meeting only**, stays on the sign-off list | Tip removed by a vet during the spay or neuter, under anaesthetic; Alley Cat Allies names the left ear, but doesn't call that universal. Syros Cats' home page confirms sterilised cats are identified by a clipped ear-tip, and names no ear | [Alley Cat Allies, eartipping protocol](https://www.alleycat.org/resources/feral-cat-protocol-eartipping/) · [Syros Cats home](https://syroscats.com/) |
| 2 Litters | **Partly (reword, small).** "Two or three litters" → "up to three" | Up to three litters a year; females can start getting pregnant from about four months (sexual maturity "from about four months"; first heat usually around six). Nothing says two is the usual | [International Cat Care, neutering](https://icatcare.org/articles/neutering-your-cat) · [Cats Protection, neutering](https://www.cats.org.uk/help-and-advice/caring-for-your-cat/neutering-and-vaccinations/neutering-your-cat). *Agriculture Victoria's fact sheet returned 403 (couldn't open); not used* |
| 3 Disease | Supported | FIV spreads mainly through bite wounds; intact, roaming, fighting males are most at risk; casual contact such as shared bowls doesn't spread it efficiently; "no evidence that FIV can infect or cause disease in humans". Neutering reduces fighting and roaming (Cats Protection: in males) and the risk of FIV and FeLV (International Cat Care: both sexes). Syros Cats' own page says TNR limits the spread of diseases such as FIV | [Cornell Feline Health Center, FIV](https://www.vet.cornell.edu/departments-centers-and-institutes/cornell-feline-health-center/health-information/feline-health-topics/feline-immunodeficiency-virus) · [International Cat Care](https://icatcare.org/articles/neutering-your-cat) · [Cats Protection](https://www.cats.org.uk/help-and-advice/caring-for-your-cat/neutering-and-vaccinations/neutering-your-cat) · [Syros Cats, TNR](https://syroscats.com/support-our-tnr-work/) |
| 4 Back home | Supported in principle; **"exactly where they were found" is stronger than anything Syros Cats' pages say.** Stays on sign-off | Syros Cats' TNR diary says cats are kept overnight and released the next day, and doesn't say each goes back to its exact spot. Alley Cat Allies' protocol is return to the colony | [Syros Cats, TNR diary](https://syroscats.com/trap-neuter-release-a-tnr-diary/) · [Alley Cat Allies](https://www.alleycat.org/resources/feral-cat-protocol-eartipping/) |
| 5 Vacuum | Supported as worded ("aims for"). Contested topic, unchanged | Wolf et al. argue newly arriving cats don't show TNR fails (they were nearby, born to unsterilised females or abandoned) and that colonies stabilise quickly if monitoring continues. They are replying to critics, so this is one side | [Wolf et al. 2019, *Animals*](https://pmc.ncbi.nlm.nih.gov/articles/PMC6769729/) |
| 6 Cost | Not changed (SYC-592). **Flag: source mismatch**, see §12.3 | Syros Cats' public vet-care page says neutering costs €35 to 50 per cat | [Syros Cats, veterinary care](https://syroscats.com/vet-care/) |
| 7 Milk | Supported | Kittens make plenty of lactase; it falls after weaning, so many adult cats can't digest lactose and get diarrhoea, gas and bloating; cats don't need milk and water is the best drink. The Merck manual describes lactase activity falling after weaning in cats | [Cats Protection, "Are cats lactose intolerant?"](https://www.cats.org.uk/cats-blog/are-cats-lactose-intolerant) · [MSD/Merck Veterinary Manual, malabsorption](https://www.merckvetmanual.com/digestive-system/diseases-of-the-small-intestine-in-small-animals/malabsorption-syndromes-in-small-animals) · [ASPCA](https://www.aspca.org/pet-care/animal-poison-control/people-foods-avoid-feeding-your-pets). Cornell's own milk page wasn't found; the earlier Cornell quote is via [Inverse](https://inverse.com/science/dont-give-your-cat-milk-lactose-intolerant) (opened, secondary) |
| 8 Leftovers | **Partly (reword).** Onions, garlic, chocolate: supported. "Cured meat" and "cooked bones" aren't supported as stated | Merck: cats are the most sensitive species to onion and garlic, and have been poisoned by "less than a teaspoon of cooked onions". Cats Protection: all of the onion family, fresh, cooked or dried, is toxic; chocolate is toxic (theobromine). **The Merck chocolate page doesn't name cats**, so Cats Protection and the ASPCA carry that claim. International Cat Care: cooked chicken bones can be sharp and lodge in the gut. ASPCA: excess salt harms pets. **No opened source names cured meat for cats**, and Cats Protection's page doesn't mention cooked bones or salt | [Merck, allium toxicosis](https://merckvetmanual.com/toxicology/food-hazards/allium-spp-toxicosis-in-animals) · [Cats Protection, human foods](https://www.cats.org.uk/help-and-advice/diet/cats-and-human-foods) · [Cats Protection, chocolate](https://www.cats.org.uk/cats-blog/why-is-chocolate-poisonous-for-cats) · [ASPCA](https://www.aspca.org/pet-care/animal-poison-control/people-foods-avoid-feeding-your-pets) · [International Cat Care, foreign bodies](https://icatcare.org/articles/cats-and-foreign-bodies) · [Merck, chocolate](https://www.merckvetmanual.com/toxicology/food-hazards/chocolate-toxicosis-in-animals). *Merck's salt page returned 404 (couldn't open)* |
| 9 Water | Supported | Syros Cats asks visitors to top up the water containers at the feeding stations (cats struggle for water in summer) and not to leave wet food or biscuits near bins (flies). It doesn't mention leftovers. It also suggests holiday visitors leave dried food for someone who keeps feeding. ASPCA Pro (a search listing only this time; read on 15 Oct): clear uneaten food, which can draw pests and complaints | [Syros Cats, feeding programmes](https://syroscats.com/feeding-programmes/) |
| 10 Hissing | Supported | Hissing, growling, spitting, swiping and biting are "repelling" behaviours used when a cat is anxious, afraid or frustrated, to put distance between itself and a threat. It is a warning that a cat wants space, and doesn't make the cat "aggressive" | [International Cat Care, conflict between cats](https://icatcare.org/articles/conflict-between-cats) |
| 11 Don't pick up | Supported | Cat-friendly interaction means the cat makes first contact and isn't picked up, which removes its choice. CDC: avoid scratches, bites and licks from cats, especially kittens and strays; stray cats more often carry the bacteria behind cat scratch disease; most scratches don't cause it | [International Cat Care, cat-friendly interaction](https://icatcare.org/articles/cat-friendly-interaction) · [CDC, cat scratch disease](https://www.cdc.gov/bartonella/about/about-cat-scratch-disease.html) |
| 13 Tortoiseshell | Supported | The coat-colour gene is on the X chromosome; these coats need one X with the black gene and one with the orange gene, so "almost all cats showing these coat colorings are female". Rare males are XXY (two Xs, one Y) and sterile. White is a separate gene | [MSD/Merck Veterinary Manual table](https://www.merckvetmanual.com/multimedia/table/calico-and-black-and-orange-tortoiseshell-cats) |
| 15 Slow blink | **Partly (reword).** The study doesn't show cats are "more at ease" | Humphrey et al. 2020: cats narrowed their eyes more after owners slow-blinked at them, and half-blinked and narrowed more at a stranger who slow-blinked first. After a slow blink, cats were more likely to approach the stranger's hand (mean 2.78 against 2.39, p = 0.035). Small samples (18 cats in each experiment after exclusions); the authors infer a positive signal, not measure it, and say firmer conclusions need more research | [Humphrey et al. 2020, *Scientific Reports* 10:16503, PMC7536207](https://pmc.ncbi.nlm.nih.gov/articles/PMC7536207/) · [Science Daily summary](https://www.sciencedaily.com/releases/2020/10/201007123031.htm). *nature.com redirected to a sign-in handshake, so the PMC copy was read* |
| 16 Tail up | Supported | A vertical tail signals friendly intent when a cat approaches a cat, another animal or a person. A tail tucked between the back legs is often anxiety or fear. Raised fur makes the cat look bigger; with an arched back it is a hostile "stay away" signal | [International Cat Care, cat communication](https://icatcare.org/articles/cat-communication) |
| 17 Purring | **Partly (reword).** Stress and pain: supported. "Giving birth": no opened source says it | Scientific American: cats purr at vet visits and while recovering from injuries, so a purring cat isn't always content; self-healing and communication seem likelier than happiness alone. Cats Protection: purring can come with stress or pain, and may help a cat soothe itself. International Cat Care: sick or injured cats purr; self-soothing is one explanation. **None of the three mentions labour** | [Scientific American](https://www.scientificamerican.com/article/why-do-cats-purr/) · [Cats Protection](https://www.cats.org.uk/cats-blog/why-does-my-cat-purr) · [International Cat Care, why do cats…?](https://icatcare.org/articles/why-do-cats) |
| 18 Kitten eyes | **Partly (reword).** Blue at birth: supported. "First few months" runs later than the best source | Kittens are born with blue-looking eyes because the iris has little pigment; melanin spreads over the first weeks. Cats Protection's chart: colour starts shifting around five weeks and is the adult colour by seven. Its blog says "weeks or months". Other sources in the search listing said 3 to 4 months (not opened) | [Cats Protection, kitten ageing chart](https://www.cats.org.uk/help-and-advice/pregnancy-and-kitten-care/kitten-ageing-chart) · [Cats Protection, eye colour](https://www.cats.org.uk/cats-blog/why-do-cats-have-different-coloured-eyes) |
| 19 Related females | Supported | Colonies are often matrilineal; cooperation between females is most notable in raising kittens; queens may groom, nurse and guard each other's kittens. Cooperating queens may or may not be related. International Cat Care: some colonies have several nursing queens feeding the same kittens | [Crowell-Davis et al. 2004, *J Feline Med Surg*, PMC10822437](https://pmc.ncbi.nlm.nih.gov/articles/PMC10822437) · [International Cat Care, social structure](https://icatcare.org/articles/the-social-structure-of-cat-life) |

Facts 12, 14 and 20 were already checked; their re-check is in §12.3.

### 12.2 Proposed rewordings (not in the app; need Samuel's approval)

Word counts are English; each is under the 35-word limit (§3.3). Greek and French are drafts for Johnny (SYC-346).

**Fact 2 · How fast it adds up** (small tweak: sources say "up to three")
- **EN** One unsterilised female can have up to three litters a year, and her daughters can be pregnant themselves from as young as four months.
- **EL** Μία μη στειρωμένη θηλυκή γάτα μπορεί να κάνει έως και τρεις γέννες τον χρόνο, και οι κόρες της μπορούν να μείνουν έγκυες ήδη από τεσσάρων μηνών.
- **FR** Une femelle non stérilisée peut avoir jusqu’à trois portées par an, et ses filles peuvent elles-mêmes attendre des petits dès l’âge de quatre mois.

**Fact 8 · Leftovers aren't cat food** (cured meat and "cooked bones can hurt" replaced by what the sources say; already a sign-off fact, so Syros Cats see the new words)
- **EN** Onions, garlic and chocolate are poisonous to cats. Cooked bones can splinter, and salty scraps can make them ill. Leftovers aren't cat food.
- **EL** Το κρεμμύδι, το σκόρδο και η σοκολάτα είναι δηλητηριώδη για τις γάτες. Τα μαγειρεμένα κόκαλα μπορούν να σπάσουν σε αιχμηρά κομμάτια και τα αλμυρά αποφάγια μπορούν να τις αρρωστήσουν. Τα αποφάγια δεν είναι τροφή για γάτες.
- **FR** L’oignon, l’ail et le chocolat sont toxiques pour les chats. Les os cuits peuvent se briser en éclats, et les restes salés peuvent les rendre malades. Les restes ne sont pas de la nourriture pour chats.

**Fact 15 · The slow blink** (the study showed more slow-blinking back and more approaching, not "more at ease")
- **EN** Try a slow blink, from a distance. In a 2020 study, cats were more likely to slow-blink back at someone who slow-blinked first, and to come up to them.
- **EL** Δοκίμασε ένα αργό ανοιγοκλείσιμο των ματιών, από απόσταση. Σε μια μελέτη του 2020, οι γάτες ανταπέδιδαν πιο συχνά το αργό ανοιγοκλείσιμο και πλησίαζαν πιο εύκολα όποιον το είχε κάνει πρώτος.
- **FR** Essaie un clignement lent des yeux, de loin. Dans une étude de 2020, les chats répondaient plus souvent par un clignement lent, et s’approchaient plus volontiers de celui qui l’avait fait en premier.

**Fact 17 · Not every purr is happy** (drop "giving birth", which no opened source supports)
- **EN** Cats purr when they're content, but also when they're stressed or hurt. A purr can be a cat calming itself down.
- **EL** Οι γάτες γουργουρίζουν όταν είναι ευχαριστημένες, αλλά και όταν έχουν άγχος ή πονάνε. Το γουργούρισμα μπορεί να είναι ο τρόπος τους να ηρεμούν.
- **FR** Les chats ronronnent quand ils sont contents, mais aussi quand ils sont stressés ou blessés. Ronronner peut être une façon de se calmer.

**Fact 18 · Kittens' eyes open blue** ("first few months" becomes "the weeks that follow")
- **EN** Kittens' eyes open blue. Their real colour comes through in the weeks that follow, so a blue-eyed kitten may grow up green or gold.
- **EL** Τα μάτια των γατακιών ανοίγουν γαλάζια. Το πραγματικό τους χρώμα φαίνεται μέσα στις επόμενες εβδομάδες, οπότε ένα γατάκι με γαλάζια μάτια μπορεί να μεγαλώσει με πράσινα ή χρυσά.
- **FR** Les yeux des chatons s’ouvrent bleus. Leur vraie couleur apparaît dans les semaines qui suivent : un chaton aux yeux bleus peut grandir avec des yeux verts ou dorés.

**Dropped: none.** Nothing was unsupported enough to remove.

**Which changes need Syros Cats:** only **fact 8's** new words (it is on the §7 list already). Facts 2, 15, 17 and 18 aren't sign-off facts; they go to Johnny for the new Greek and French (SYC-346). **Facts 1, 3, 4, 5, 9, 12 and 19** stay on the sign-off list unchanged, and fact 4's "exactly" is worth saying aloud when asking (§7 question 3). The app switches page (SYC-383) lets Syros Cats hide any individual fact, which is the fallback for any fact still unsure at launch.

### 12.3 Re-check of the facts already marked opened (24 Oct 2026)

| Fact | Result |
|---|---|
| 1 | Still fine. The left ear is Alley Cat Allies' rule; it isn't stated on Syros Cats' pages, so "usually the left" rests on the 1 Sept meeting |
| 4 | Fine, but "exactly where they were found" goes further than Syros Cats' TNR diary (released next day). Suggest asking them; "back to where they were found" would be safer if they hesitate |
| 5 | Fine as worded. Wolf et al. is the pro-TNR side replying to critics, and the fact's "aims for" hedges correctly |
| 6 | **Flag for SYC-592, not changed.** Syros Cats' public vet-care page says **€35–50** per cat; the fact says **€50–60** (the 1 Sept meeting figure, canonical in `CLAUDE.md`). They may have updated the price, or the page is stale; ask them to confirm which and, if the page is stale, to update it |
| 9 | Fine. Syros Cats asks visitors to top up water containers; also asks for no wet food or biscuits near bins |
| 12 | Fine. ASPCA: the mother may be away getting food; leave the kittens and check back over a few hours; sick or injured kittens need prompt care |
| 14 | Fine. Cornell's "Ask Elizabeth" column puts deafness in white cats with two blue eyes at roughly 65 to 85 percent, born deaf (hereditary, present from birth). A search listing mentioned a 2023 study of 72 purebred white cats finding 16.7 percent deaf and no link to eye colour; I didn't open it, and it's a small purebred sample, so "many" still stands. Worth knowing, not a reason to change |
| 20 | The app's own rule (`cat-record-data-spine.md` §4); nothing external to check |

**Considered and left out:** sweet taste (sound, Li et al. 2005, but the first draft's wording invited feeding) · whiskers as wide as the body (no good source) · the flehmen "grimace" and sleep hours (sound, but lower value; candidates for SYC-61) · FeLV (spreads through friendly contact, so sterilisation helps it less directly) · grapes and raisins (well documented for dogs, thin for cats).
