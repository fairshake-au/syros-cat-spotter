# Purropolis — the Syros cat app

## A description of the whole product, for Syros Cats to comment on

**Prepared for:** Syros Cats
**Date:** 28 July 2026
**Status:** Draft for your comment — nothing here is fixed

---

## How to read this, and what we need from you

This describes the app as a single finished thing: what it does, who it's for, and what it would cost to run. It deliberately doesn't separate what already works from what we still have to build, because that distinction matters to us and not to you. What matters to you is whether this is the right product.

**Please argue with it.** The sections most likely to be wrong are the ones where we've guessed at how you work — what you track about each cat, how your colonies are organised, how you want to be contacted about a sick animal. We would much rather rebuild a section now than build the wrong thing twice. Questions we already know we need you to answer are collected in section 17, but comments anywhere are welcome.

One thing worth saying plainly at the outset: **this app is only as useful to you as the data discipline behind it.** A cat catalogue that tourists enjoy is easy. A record you can put in a funding application is a different standard, and most of the careful design in here exists to reach it.

---

## 1. What the app is for

Syros has a large population of street cats and a small number of people working to care for them. The gap between those two facts is information: which cats exist, where they live, which have been sterilised, which need help, and where the next effort would do the most good.

There are thousands of people on the island every summer who like cats, carry a camera, and walk everywhere. The app turns that attention into a record.

**For a visitor**, it's a game: photograph a cat, find out whether it's one the island already knows, name it if it's new, collect the ones you've met, and see how you rank.

**For a resident**, it's recognition: the cat you've fed for six years gets a name, a page and a history, and you're on it.

**For you**, it's a census that maintains itself — cats, locations, photographs, dates, sterilisation status and welfare concerns, gathered by people who are enjoying themselves rather than working for you.

The design principle underneath everything: **the tourist experience must stay effortless, or there is no data.** Every operational feature in here is built so it never gets between a visitor and their fun.

---

## 2. Who uses it, and what they can do

Nobody needs an account to use the app. A spotter opens it and starts. Accounts exist only for people whose word needs to carry extra weight.

Everyone is a **spotter** — that's the base role, and every other role is added on top of it. A vet is a spotter who can also record surgery. We've deliberately not called it "visitor", because a good many of the best spotters live here.

| | Who | What's different for them |
|---|---|---|
| **Spotter** | Anyone | Spots cats, names new ones, contributes observations, collects and competes |
| **Resident** | Anyone who lives here | Everything above, plus claiming a cat as theirs |
| **Cat guardian** | A resident you've endorsed | Their word about their cats' condition carries weight; you hold their contact details |
| **Volunteer** | Invited by you | Records field observations, confirms what the public reports, responds to welfare reports |
| **Partner vet** | Invited by you | Records sterilisations and vaccinations as definitive |
| **Staff** | Syros Cats | Everything, plus colonies, broadcasts and reporting |
| **Admin** | You decide | Invites and removes people |

**Invitations come from you.** There is no way to sign up and declare yourself a vet. You send an invitation, the person accepts it, and they have that role until you remove it. If you remove it, everything they recorded stays — correctly attributed to them, at the time they recorded it.

Signing in doesn't put someone in a different app. It adds controls to the app they already have, so a volunteer standing in front of a cat can record what they see without going back to a desk.

---

## 3. Spotting a cat — the core of the app

Someone photographs a cat. The app compares that photograph against the cats it already knows and asks: *have we met this one before?*

It shows the closest few matches with a plain-English reason for each — *"the white bib and the notch in the left ear match"* — and the person confirms one, or says it's nobody they recognise and gives the new cat a name. New names have to be unique across the island, and there's a button that suggests unused ones in the language they're using.

Confirming an existing cat earns points. Naming a new one earns more. Points build streaks and badges and a leaderboard, and that machinery is doing real work: **it's what makes someone photograph the fourth cat rather than stopping at the first.**

**It all works with no signal.** Syros has plenty of places with no coverage, and that's exactly where the cats are. Photographs, locations and the map itself work offline; anything waiting is submitted automatically when the phone finds a connection, and — importantly — the sighting is dated to when the photograph was taken, not when it eventually uploaded.

---

## 4. What the app knows about each cat

Each cat has a page: photograph, name, a code like SYR-0042, where it's usually seen, everyone who's ever spotted it, and its history.

**Appearance** — colour, pattern, and distinguishing features like a white bib, a notched ear or a kinked tail. Chosen from lists rather than typed, so that a Greek volunteer, a French tourist and an English one describing the same cat produce the same searchable record rather than three different words. This is also how the app can support the way people actually talk: *"the tortoiseshell by the bakery"* rather than *"SYR-0042"*.

**Health and care** — sterilised, ear-tipped, vaccinated, sex, age, pregnant or nursing, general condition, and sadly sometimes deceased.

**Who looks after it** — its guardian, if it has one, and where it lives.

We've deliberately kept this list short. If knowing something wouldn't change what anyone does, it isn't worth asking anyone to record it. **If we've left out something you track, that's the single most useful correction you can give us.**

---

## 5. How the app decides what's true

This is the part we'd most like you to understand, because it's what makes the numbers defensible.

A tourist, a resident, a volunteer and a vet can all say something about the same cat, and they are not making the same kind of claim. *"I think I saw a clipped ear"* and *"I sterilised this cat on 14 May"* are different in kind, and if they overwrite each other in the same box, your figures become unciteable.

So **nobody edits a cat's health status.** People add observations — dated, attributed, often with the photograph that prompted them. The app works out the status from all of them, and always shows how sure it is:

| | Means | Example |
|---|---|---|
| **Confirmed** | Someone authoritative said so | Your vet recorded the operation |
| **Likely** | Several people independently agree | Three visitors have seen a clipped ear |
| **Reported** | One person, unconfirmed | A visitor thinks she may be pregnant |
| **Unknown** | Nobody has said | Most cats, at the start |

Authority is specific rather than general. A vet's word settles whether a cat has been sterilised and carries no special weight on where it sleeps. A guardian's word about their own cat's condition outranks a passing visitor's and never outranks a vet's on surgery.

**Nothing is ever deleted.** A correction is added on top and the original stays visible. That's deliberate, and it matters for a reason you'll recognise: **a cat with no ear-tip may well have been sterilised anyway.** The record needs to show that being worked out, not quietly hide the disagreement.

Which leads to the rule we'd most like you to check:

> **An ear-tip that's visible is strong evidence a cat was sterilised. An ear-tip that isn't visible is evidence of almost nothing at all.**

The app will never move a cat toward "not sterilised" because people can't see a clip — no matter how many people can't see it. Only you or a vet can say a cat hasn't been done. Getting this the wrong way round would put every unclipped-but-sterilised cat on your trapping list and send volunteers out for nothing, which is the worst thing this app could do to you.

---

## 6. How the public contributes without being asked to do work

The app looks at each photograph and can often tell what colour a cat is, what pattern it has, and whether an ear looks clipped. So it proposes and the person confirms:

> *One quick thing — is Agatha's ear clipped?*
> **Yes, clipped** · **No, looks whole** · **Can't tell**

One tap. "Can't tell" is a perfectly good answer and stops the app asking forever. It appears after they've earned their points, never before, and only ever one question at a time — never a form.

**Two safeguards worth knowing about.** The app's own guess is never recorded as a fact on subtle things; it becomes a question. And where the app *has* suggested an answer, we record that it did — because five people agreeing with the same suggestion isn't the same as five people independently noticing something, and your sterilisation figure shouldn't treat them as if it were.

For plainly visible things like colour, the app records its own reading directly, because it's more reliable than a guess from someone who's never seen a tortoiseshell before.

---

## 7. Reporting a cat in trouble

Separate from the game, always available, never buried: **this cat needs help.** A photograph, the location, and a choice between *needs attention* and *urgent*.

Where these usually fail is the middle step, so: urgent reports notify volunteers straight away rather than sitting in a list; others go to whoever is nearest or covers that area. A volunteer marks it seen, acting or resolved — **and the person who reported it is told what happened.** Without that last step people stop reporting, and it costs almost nothing to include.

**We need your guidance on two things here:** what happens to an urgent report at two in the morning, and whether you want the public to see that a report exists at all, or only the person who made it.

---

## 8. Colonies and the feeding network

**Colonies.** The app groups cats by where they're actually seen, and you name the groups. That way the names match the colonies you already talk about, and nothing has to be redrawn every time a cat moves. All the reporting groups by colony, because that's the unit you plan in.

**Feeding sites.** Where cats are fed — fixed stations or informal spots — which colony each serves, and what condition it's in.

This is more useful than it sounds. Cats gather predictably where they're fed, so a map of feeding sites is a map of **where you can reliably find and trap the cats you need to sterilise.** A colony with no feeder is a welfare problem; a colony with three uncoordinated feeders is a different one.

**Feeders.** The people who provision those sites. You can record their name and contact details **with their consent**, recorded properly and withdrawable.

**One thing we'd advise on, and want your view:** we think feeding sites and feeders should be visible to you and your volunteers, and **not to the public.** Two reasons. People who feed street cats sometimes get grief from neighbours, and publishing their locations hands that over. And known feeding sites attract abandonment — people leave unwanted cats and kittens where they know cats get fed, which makes your problem worse in exactly the places you're working hardest. You'll know better than us how real those risks are on Syros.

---

## 9. What volunteers and vets actually do in the app

**On any cat's page**, once signed in: record a clinic visit, confirm or correct what the public has reported, flag a cat for trapping, record a death.

**The screen we expect gets used most** is a list of cats where the public has got most of the way there and one volunteer's confirmation would settle it — sorted by how close they are to you. This is the whole design earning its keep: hundreds of visitors do the finding, a handful of volunteers do the confirming. Realistically it's a few minutes of tapping that turns a summer of tourist photographs into figures you can publish.

**It all works offline**, because volunteers are outdoors more than tourists are, and often with worse signal.

---

## 10. Reporting your impact

Every figure the app produces carries its own confidence:

> **142 cats known · 89 confirmed sterilised · 23 likely · 30 unknown**

It's tempting to publish the round number. The honest one is stronger — a funder who can see the uncertainty trusts the total, and a visitor who sees 30 unknowns sees something they can personally help with.

Because every observation is dated and attributed, the app can answer *"how many cats did we sterilise between January and December"* rather than merely asserting it. That's exportable, with the method stated, for funding applications and annual reports.

**For your own planning**: sterilisation coverage colony by colony, which colonies are growing, which have no feeder, and — free of charge — which parts of Syros nobody has ever photographed. That last one is both a gap in your data and something the app can actively send visitors to fill.

**For press and supporters**: milestones worth telling people about, like the hundredth cat or a colony reaching full coverage.

---

## 11. Getting the island mapped, and keeping people coming back

### The problem we have to solve

Collecting cats is a game that ends. Once someone has met the cats near them, the app has nothing left to ask — a few days for a visitor, sooner and permanently for a resident. So the app needs reasons to open it that aren't "find a new cat".

Happily, the best of those reasons is something you need anyway.

**Checking on cats nobody has seen lately.** A cat unseen for two months is a question; six months is a welfare concern. So the app starts asking: *"Nobody has seen Kyra since April — she's usually near the fish market."* That never runs out, it's genuinely useful to you, and it changes the app from a collection someone finishes into a patch they look after. **If we build one thing for engagement, it's this one.**

**Telling people what happened to their cats.** *"Agatha, the cat you named in June, was sterilised last week."* This is the only thing that works after someone has gone home, and it's the whole post-trip relationship — and, not coincidentally, the honest moment to mention donating.

**Going where nobody has been.** For anyone staying long enough to be systematic, the coverage map turns a walk into a contribution.

### Families staying longer — the Boundless Life cohort

Groups like the Boundless Life families are, we think, **the only people who can actually map the island.** A visitor has four days and stays near the harbour; a resident walks the same three streets. A family here for one to three months, with children who have structured time and no fixed itinerary, can systematically cover Ano Syros, Vari, Galissas and Kini — exactly the places nobody photographs. And because those cohorts arrive continuously, each intake is a fresh wave of mappers rather than a one-off push.

It's also where the learning side of the app becomes serious rather than decorative: animal welfare, why sterilisation works, island ecology, and real citizen science that children are doing rather than reading about. We'd like your view on what you'd want taught, since it's your expertise being passed on.

### Cat facts, and the occasional joke

Small things, placed where there's already a wait — the few seconds while the app works out which cat it's looking at currently shows nothing but a spinner.

The ones we care most about aren't trivia. **"Please don't feed the cats" is currently one line in the introduction that nobody reads.** Explaining *why*, at the moment someone is standing in front of a hungry cat holding a sandwich, is the difference between a piece of copy and a change in behaviour. Same for how to approach a cat safely, and what to actually do about an injured one. That's your welfare message reaching people at the only moment it can land.

### Rewarding the right things

Two changes we'd make to how points work, both because the current version quietly works against you.

**Naming a "new" cat currently earns five times more than recognising a known one.** That pays people to declare cats unknown — and every duplicate makes your island count, your sterilisation percentage and your trapping list wrong. We'd narrow that gap considerably.

**Points should follow what you need.** The app knows which cats haven't been seen in months, which have unknown health, and which areas are unsurveyed — so those become worth more, with the reason shown. In effect **the scoring system becomes your task list**, and people chasing points do the work you'd otherwise be asking volunteers to do.

We'd also add recognition for being *accurate* rather than merely busy — someone whose reports your volunteers keep confirming visibly earns standing — and time-limited leaderboards, so a visitor arriving in August is playing for something they can actually win.

### Other things worth doing

Things we'd propose, and want your view on which are worth it:

- **Coverage map** — showing where nobody has looked, so a walk becomes a contribution.
- **Neighbourhood challenges** — *"Ano Syros: 12 cats known, probably many more."*
- **Seasonal pushes** — a census weekend, promoted with you.
- **QR codes in cafés, hotels and ferries**, so the app is discoverable at the moment someone is looking at a cat. Cheap, and probably the highest-yield thing on this list.
- **Cat-friendly business partners** — venues that display the app and appear in it.
- **A souvenir** — at the end of a trip, "the cats you met on Syros" as something shareable. Visitors want to remember specific cats, and it costs us nothing.
- **Telling visitors what happened next** — *"Agatha, the cat you met in June, has been sterilised."* We think this is the strongest retention idea in the app and the most natural moment to ask for a donation.
- **Schools and local groups** — the app is a decent teaching tool about street animal welfare.
- **Recruiting from your best contributors** — someone who's photographed sixty cats is a volunteer waiting to be asked.

---

## 12. Donations

Today the app can only point at an external page.

**When you ask matters more than how.** The strongest moment by a distance is *after* someone has gone home and learns their cat was helped — the outcome comes first and the ask follows it. Second is the end of a trip, alongside "the 14 cats you met on Syros". A donate button on the Help tab, which is what exists now, is the weakest of the options, because it asks in the abstract.

**A ladder of outcomes, not a row of amounts.** Each rung says what it buys, so even the smallest gift is a specific act:

| | Buys | |
|---|---|---|
| **€1** | Feeds a cat for a day | Almost no friction — anyone can |
| **€7** | Feeds a cat for a week | |
| **€25** | A week's petrol for your volunteers | Funds the work, not just the cat |
| **€50–60** | Sterilises one cat | The headline |
| **€120** | Sterilises two | |

The ladder matters more than any single rung. A €60 ask converts a few people and loses the rest in silence; a €1 ask converts almost anyone and begins a relationship. **The first donation's job is to make the second one possible.**

We'd keep the petrol tier distinct, because it funds *your volunteers* rather than the cats — the unglamorous cost nobody normally offers to cover, and one some donors specifically prefer.

**One practical note on the €1 tier.** Card processing takes a fixed fee per payment, so a single €1 donation loses a large share of itself. The fix isn't to drop it — it converts best — but to sell the outcome and bill it sensibly: *"feed a cat for a month, €30"* is one payment, keeps the €1-a-day framing, and gives you regular income instead of a one-off.

Alongside the ladder:

- **Sponsor a sterilisation** — the strongest single product, because it's specific: someone pays for a named cat's operation and is later told it happened. You cannot buy that kind of connection to a donor. And because €50–60 is a decision rather than an impulse, **letting several people co-fund one cat matters**: *"Agatha's sterilisation — €38 of €60, 4 supporters"* lets someone give €10 and still be part of a specific outcome.
- **Sponsor a cat monthly** — attached to a specific animal, with updates as it's spotted.
- **Give it as a gift** — a sterilisation in someone's name; works for Christmas and for "in memory of".
- **Ways to help that aren't money** — sharing, volunteering, adopting. Some of the most committed users have the least to give, and we don't want to waste them.
- **Show where it went** — every euro tied back to cats in the record.

**One principle we'd hold firmly: money never buys points.** Donors get thanked and recognised, never ranked. The moment giving moves someone up a leaderboard, the leaderboard stops measuring who helped and starts measuring who paid.

**Three practical warnings.**

Card processing takes a small percentage and a fixed fee per transaction, so very small donations lose a disproportionate amount — worth setting sensible minimums.

**Apple and Google take a substantial cut of anything bought inside an app**, and getting charitable donations treated correctly requires following their rules precisely — usually meaning donations happen outside the app itself. Done carelessly this gets the app rejected from the stores, so it needs doing deliberately.

And you'd need to tell us how donations reach you, and what receipts or acknowledgements Greek charity rules require.

---

## 13. Recognising individual cats

The app compares a new photograph against cats it already knows. This matters more than it appears: **if the same cat gets registered three times, every number in section 10 is wrong** — the island count, the sterilisation proportion, and the list of cats you think still need trapping.

We're planning to improve this in two steps. First, **measure how well it currently works**, which we can do using the sightings people have already confirmed — every confirmed sighting is effectively a person saying "yes, these two photographs are the same cat", which is exactly what's needed to test it. Second, give the app a proper visual memory so it compares against every cat on the island rather than only the nearest ones — a cat that has moved is currently almost invisible to it.

**One honest limitation:** a great many Greek street cats are tabbies who genuinely look alike, and some pairs will defeat any system. The app is designed to say "I'm not sure" clearly rather than guess, and to let a person settle it.

---

## 14. Privacy and looking after people's data

Today the app knows almost nothing about anybody — no names, no emails, no accounts. Several things in here change that, and they should be decided deliberately rather than by accident.

**What would be stored about people:** guardians' addresses, and optionally their names and contact details. Feeders' names and contact details, with consent. Volunteer and vet accounts.

**Who sees it:** you and your team. None of it appears anywhere in the public app, which continues to show only chosen display names.

**This is personal data under GDPR**, which means it needs a stated purpose, a proper basis, real deletion when someone asks, and a retention limit. Entirely normal for a charity to hold — but it needs a decision, not a form field.

**Something we should decide together:** the app shows where each cat lives. For most cats that's harmless and useful. Wildlife apps routinely blur locations for animals that could be harmed by people knowing where they are, and poisoning incidents are not unknown in Greece. We can show approximate locations rather than exact ones for any cat you flag. **Do you want that, and for which cats?**

**Also worth your view:** photographs taken in public sometimes include people in the background, and children use apps like this. Both are manageable; both are easier to handle by choice than by complaint.

---

## 15. What the app should be called

The app currently has **two names and can't decide between them.** Internally the brand is *Purropolis*; the app store listing says *Syros Cat Spotter*; and the Greek and French say *Γάτες της Σύρου* and *Chats de Syros* — "Cats of Syros". That needs settling before anything is published, because an app store name is painful to change once people have started recommending it to each other.

### What a good name has to do here

- **Work in Greek, English and French** — not merely translate, but land. The app is properly trilingual and the name shouldn't be the one part that isn't.
- **Be findable.** Someone typing "Syros" or "cats" into an app store should find it. This argues for a descriptive name.
- **Be memorable and repeatable.** Someone in a café should be able to tell a stranger what to search for. This argues against a descriptive name.
- **Survive success.** If this works on Syros, it works on Paros, Naxos or anywhere else with street cats and visitors. *Syros Cat Spotter* is a name that has to be thrown away the first time that happens.

The findable/memorable tension has a standard resolution: **a brand name plus a descriptive subtitle.** Both app stores support exactly this — a short name and a separate subtitle line — so we can have "Purropolis" for the memory and "Cats of Syros" for the search, without choosing.

### The recommendation: one joke, remade in three languages

*Purropolis* is **purr** + **-opolis**, the Greek for city. It has a lovely local accident built into it: Syros's own capital is **Ερμούπολη** — Ermoupoli, "Hermes' city". A cat-city named the same way sits naturally on this island in a way it wouldn't anywhere else.

But the pun only half-survives translation. "Purr" means nothing in Greek — the Greek for purring is *γουργουρητό* — so a Greek speaker gets the "city" and misses the cat. The same is true in French.

So rather than transliterating one name into three alphabets, **we'd remake the same joke in each language**, keeping one shape:

| | Name | The joke |
|---|---|---|
| **English** | **Purropolis** | purr + city |
| **Greek** | **Γατούπολη** | γάτα (cat) + -ούπολη — exactly the Ερμούπολη pattern |
| **French** | **Ronronopolis** | ronron (purr) + city |

**Γατούπολη is the strongest of the three** and we'd want your ear on it, because it's the one that has to be right. It's the pun a Greek would actually make, it echoes Ermoupoli directly, and it needs no explanation to anyone on the island.

This costs nothing extra: both app stores let you set a different name per language, and the app already translates everything else. The wordmark is set in type rather than drawn as a logo, so it can be set in Greek script just as easily as Latin.

### What we'd need to check

Trademark conflicts and domain availability for whichever name is chosen, and — the reason this section exists at all — **whether Γατούπολη actually sounds good to Greek speakers, or slightly silly in a way we can't hear.** Please tell us honestly; it's much cheaper to hear now.

### One thing to avoid

**Not "Syros Cats".** That's your name, and an app carrying it would imply the app *is* you — which matters if it ever gets something wrong, and matters more if it ever operates somewhere you don't.

---

## 16. What it costs to run

These are **running costs only** — the ongoing bill to keep the app working. Development effort is separate.

### The assumptions

Everything below assumes each photograph is stored at about 400 KB after processing, and three levels of activity:

| | Sightings per month | Roughly |
|---|---|---|
| **Quiet** | 900 | 30 a day |
| **Growing** | 3,600 | 120 a day |
| **Busy** | 12,000 | 400 a day, summer |

### The three biggest surprises

**1. The photo-recognition is the bill.** Comparing a new photograph against known cats currently costs roughly two cents each time, because it sends eleven photographs to an AI service on every single spot. At the *Growing* level that's about **$76 a month** — more than the hosting. At *Busy*, about **$250 a month**.

Giving the app its own visual memory (section 13) cuts this by roughly half immediately, and by very much more once it can do the comparison on the phone itself. **That single change saves more money than any other decision in this document.**

**2. Storing photographs inside the database is the only cost that never stops growing.** They're currently kept in the database itself, which costs about 65 times more than ordinary file storage. At the *Growing* level that's roughly $30 a month in year one, $60 in year two, $90 in year three — for photographs nobody is looking at. Moving them to file storage makes that a rounding error. **This should be fixed regardless of anything else here.**

**3. Volunteer accounts are free.** The service we'd use for sign-in covers up to 50,000 people at no cost. Your volunteer list will never approach that.

### The three architectures compared

All figures monthly, at the *Growing* level, in year one.

| | Today (Replit) | Supabase | Amazon Web Services |
|---|---|---|---|
| Server | $20 | ~$10 | ~$15 |
| Database | $30 *(photos included, and rising)* | $25 *(covers storage too)* | ~$14 |
| Photo storage | *in the database* | *included* | ~$2 |
| Delivering photos | included | included | ~$3 |
| Sign-in | free | free | free |
| Maps, notifications | free | free | free |
| **Running the app** | **~$50** | **~$35** | **~$34** |
| AI recognition | $76 | $76 | $76 |
| **Total** | **~$126** | **~$111** | **~$110** |
| **Same, in year three** | **~$190** | **~$115** | **~$120** |

**What this actually tells us.** The three options are within about $15 a month of each other, and the AI recognition is more than half of every one of them. **Changing hosting provider is not where the money is.** Fixing the recognition and moving the photographs out of the database is — together those take the *Growing* bill from about $126 to somewhere near **$45**, on any of the three.

**In character**, briefly:

- **Today's setup** is the least work, and the only one whose bill grows every month forever, because of the photograph problem.
- **Supabase** is the best fit: it bundles database, file storage and sign-in into one predictable $25, its included allowances comfortably cover years of photographs, and it needs no specialist to run. It's what we'd recommend.
- **Amazon** is marginally cheaper at scale and by far the most flexible, but it's several services to configure and keep secure. For an organisation without technical staff, that flexibility is a liability rather than a feature.

**Not included above:** Apple charges $99 a year for an app store account and Google a one-off $25; a domain name is about $15 a year; and if donations are added, card processing takes a percentage. Call it $150 a year of fixed extras.

**One thing to watch:** the offline maps use free public map data, which has usage rules that a popular app can bump into. If the app takes off, a paid map provider costs roughly $10–50 a month and removes the risk.

---

## 17. What we need from you

The questions where your answer changes what we build:

1. **What do you actually track about each cat today?** If there's a spreadsheet, its column headings beat anything we've guessed in section 4.
2. **Should the feeding map be private to your team?** (Section 8 — we think yes.)
3. **How should an urgent welfare report reach you, and what happens out of hours?** (Section 7.)
4. **Do your colonies have fixed names we should use?** (Section 8.)
5. **Do you have existing sterilisation records** we could load in, so the app starts with your history rather than from zero?
6. **Who is responsible for the personal data** the app would hold — you, as the organisation it's collected for? (Section 14.)
7. **How long should contact details be kept**, and what happens when someone stops volunteering?
8. **Should any cats' locations be shown only approximately?** (Section 14.)
9. **How do donations reach you**, and what do Greek charity rules require by way of receipts? (Section 12.)
10. **Which of the engagement ideas in section 11 are worth your time** — particularly QR codes in cafés and hotels, which needs your local relationships more than our software.
11. **What would you want children taught** through the app — the welfare and sterilisation messages you'd most want a hundred visiting families to go home understanding?
12. **Are the donation amounts right?** We've assumed €1 feeds a cat for a day, €25 covers a week's petrol, and €50–60 sterilises one. Correct any of those and we'll rebuild the ladder around your figures.
13. **Does Γατούπολη sound right to a Greek ear**, or slightly silly in a way we can't hear? (Section 15 — the one question where we most need a native speaker.)

---

## 18. What we are deliberately not building

So expectations are clear:

- **A full trap-neuter-return case management system** — no trap scheduling, clinic capacity planning or detailed medical histories. The app records what happened to a cat; it doesn't run your operations.
- **Public sign-up.** Ordinary users stay anonymous, permanently. It's what keeps the app effortless.
- **Anything that asks a visitor to do admin.** Every contribution is one tap, optional, and after they've had their fun.
- **A veterinary record system.** Vets record outcomes here; their own systems remain their own.

---

*This is a draft and we expect it to change. Please mark up anything that's wrong, missing, or more complicated in practice than it looks on paper — particularly in sections 4, 7, 8 and 16, where we've been guessing at how you work.*
