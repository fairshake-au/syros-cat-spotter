# The feeding nudge, in the spot flow

**Status:** Draft for Samuel's approval, 15 October 2026. Independent adversarial review folded in (§11; full review in [`reviews/feeding-nudge-and-starter-facts-review.md`](./reviews/feeding-nudge-and-starter-facts-review.md)).
**Owner:** Samuel
**Covers:** SYC-36 (and the shared half of SYC-343). `docs/PRODUCT-SPEC.md` §2.2: *"The feeding nudge (short form) in the spot flow, with the winter-dependence explanation and the €1-a-day redirect."*
**Builds on:** the proposal §13 "The feeding nudge" (the long form this is the short form of) · the onboarding "Please don't feed them" step and the "Look, don't touch" safety screen (SYC-35), which already exist · the questions on the reward screen (SYC-37, SYC-74) · the Help tab's campaign screen (SYC-1's seam).
**Shares a slot with:** [`starter-facts.md`](./starter-facts.md) (SYC-48). Both appear in **the waiting card**, defined once in `starter-facts.md` §3. This spec owns only the nudge's words, its turn in the card and its link.
**Dates:** launch 31 October 2026 (SYC-73). Greek and French reach Johnny for native review (SYC-283) by about 24 October.

---

## 1. The short version

When a spotter taps **Check for matches**, there are a few seconds while Cat Spotters looks for the cat. Today that time shows a spinner on the button. From launch it shows **the waiting card**: one short thing worth reading while you wait.

On a spotter's **first** spot, that card is the feeding nudge:

> **Thinking of sharing your lunch?**
> We'd gently ask you not to. Cats fed all summer by visitors come to rely on it. When the visitors leave, the food leaves with them, and the cats go hungry through the winter.
> Syros Cats and local cat guardians feed colonies the right food, in the right places, all year round.
> **€1 feeds a cat for a day.**
> *[Help feed a cat]*  *[Got it]*

After that it comes back **at most twice more, never within two weeks of the last time**. Every other wait shows a cat fact instead (`starter-facts.md`). It is never a pop-up, never blocks the spotter's result or points, and never appears to someone with no signal (there's no wait to fill).

The **"Help feed a cat"** button opens Syros Cats' own donation page in the phone's browser, the same way the Help tab's Donate button already works. Donations inside the app are MLP (SYC-1); at launch, the money goes straight to Syros Cats through whatever page they already use. Which page, and whether "€1 a day" is a figure they stand behind, is for Syros Cats to confirm (§7).

---

## 2. Why this matters

The proposal calls the feeding nudge the single most valuable piece of teaching in the app, and the reason is timing. Onboarding already says "Please don't feed them", once, before anyone has met a cat. The nudge says **why**, at the moment someone is standing in front of a hungry-looking cat with food in their bag.

Two things make it work, and both are in the short form:

1. **The reason is one people haven't thought of.** Most visitors think feeding is kind. The winter argument reframes it: the harm arrives months later, after they've gone home, when nobody is watching.
2. **It ends with something to do.** A nudge that only says no is a nudge people ignore. The €1 line turns the feeling that made them reach for the sandwich into help that lasts the whole year.

### 2.1 Two audiences, needs that fit together

| | Tourists | Locals and cat guardians |
|---|---|---|
| **What the nudge gives them** | The reason not to feed, and a better way to help that still feels like feeding a cat | Backing: the app tells visitors what guardians have been telling them for years |
| **What it must not do** | Lecture, or repeat itself every spot | Suggest that feeding *by guardians* is wrong. The copy names guardians as the people who do it properly |
| **How the cap serves them** | A four-day visitor sees it once, on their first spot | A resident who spots every week sees it three times in total, then never again |

---

## 3. Where it appears, and when

### 3.1 The moment

The nudge lives in **the waiting card** (`starter-facts.md` §3): the space below the **Check for matches** button on the New spot screen, from the tap until the matches come back. The card appears only while a match is being looked for. It never appears as a pop-up, a sheet, or on its own screen.

### 3.2 Which wait gets the nudge

The card shows one thing per wait. The nudge takes the card when **all** of these are true:

1. The spotter is sending the sighting now (connected), so there is a wait to fill.
2. This phone has shown the nudge **fewer than 3 times** in total.
3. It's the phone's **first** wait ever, **or** at least **14 days** have passed since the nudge last showed.
4. The spotter hasn't tapped **Help feed a cat** before. Once someone has acted on it, they've got the message; it never shows again.

Otherwise, the card shows a fact.

In practice: a visitor on a four-day trip sees the nudge **once**, on their first spot. Someone back a fortnight later sees it a second time. A resident sees it three times over at least a month, then never again. Nobody sees it on two spots in a row.

**What counts as "shown".** The nudge counts as shown once it has been on screen for at least 1 second. A send that fails instantly doesn't use up one of the three.

**Where the count is kept.** On the phone (or in the browser, for the website), with the card's other memory (`starter-facts.md` §3.4). It is not sent to the server and not tied to an account. If a browser clears its storage, the nudge may show again from the start. That's acceptable: the worst case is one extra nudge.

### 3.3 When the matches come back before the spotter has finished reading

Matching often takes only a few seconds, and the nudge is about 60 words. So the nudge **does not disappear when the result arrives**. It moves to the **bottom of the reward screen**, below the questions (ear tip, food and water, note), with the same words and buttons. It goes away when the spotter taps **Got it** or **Help feed a cat**, or leaves the reward screen.

It never delays the result, the points or the questions, and never sits above them. (Facts don't follow the spotter like this; only the nudge does, because only the nudge has something to do. See Decision 2, §8.)

If the spotter taps **Got it** while still waiting, the card closes and the wait shows the usual spinner. No fact replaces it in the same wait.

### 3.4 Where it does not appear

- **Not on every spot.** §3.2 caps it.
- **Not when there is no signal.** An offline spot is saved on the phone straight away (§6); there's no wait, so no card.
- **Not on the cat's page, and not as its own screen.** The proposal also puts the nudge "quietly on each cat's page"; that, and the long form with all four reasons, belong to Teaching in full (SYC-61, MLP).
- **Not on the team dashboard.** Syros Cats' staff don't spot through the dashboard.

---

## 4. What it looks like

A card with the same rounded white surface, border and spacing as the reward screen's question cards, so it looks like part of the app, not an advert.

- **Heading** in the card's title style.
- **Two short paragraphs** of body text.
- **The €1 line** in bold, on its own line.
- **Two buttons side by side**: **Help feed a cat** (secondary style, with the small "opens in your browser" line beneath it that the Help tab already uses, `campaignOpensAt`) and **Got it** (quiet, text-only).
- No photo, no icon beyond what the card style already has, no animation. It must fit on a small phone (iPhone SE, 375 × 667) below the button without covering the photo or the map pin, scrolling if needed.

It is read aloud by screen readers in order: heading, paragraphs, €1 line, buttons. The card is announced politely when it appears; it doesn't steal focus from the button the spotter just pressed.

---

## 5. The words

French uses **tu**, and Greek the informal singular, to match the rest of the app (`howStepDontFeed`, `moreToAddOne`). Greek capitals drop their accents (SYC-159), so headings are written in sentence case. The euro sign follows each language's convention: **€1** in English, **1 €** in Greek and French.

These are drafts. Greek and French go to Johnny for native review (SYC-283) by about 24 October (§10).

### 5.1 The nudge

| Key | English | Ελληνικά | Français |
|---|---|---|---|
| `feedNudgeTitle` | Thinking of sharing your lunch? | Σκέφτεσαι να μοιραστείς το φαγητό σου; | Tu penses partager ton déjeuner ? |
| `feedNudgeWhy` | We'd gently ask you not to. Cats fed all summer by visitors come to rely on it. When the visitors leave, the food leaves with them, and the cats go hungry through the winter. | Σου ζητάμε ευγενικά να μην το κάνεις. Οι γάτες που τις ταΐζουν οι επισκέπτες όλο το καλοκαίρι μαθαίνουν να το περιμένουν. Όταν φεύγουν οι επισκέπτες, φεύγει και το φαγητό, και οι γάτες πεινάνε όλο τον χειμώνα. | On te demande gentiment de ne pas le faire. Les chats nourris tout l’été par les visiteurs finissent par en dépendre. Quand les visiteurs partent, la nourriture part avec eux, et les chats ont faim tout l’hiver. |
| `feedNudgeInstead` | Syros Cats and local cat guardians feed colonies the right food, in the right places, all year round. | Οι Syros Cats και οι ντόπιοι κηδεμόνες γατών ταΐζουν τις αποικίες με τη σωστή τροφή, στα σωστά σημεία, όλο τον χρόνο. | Syros Cats et les gardiens de chats locaux nourrissent les colonies avec la bonne nourriture, aux bons endroits, toute l’année. |
| `feedNudgeEuro` | €1 feeds a cat for a day. | Με 1 € τρώει μια γάτα για μία μέρα. | 1 € nourrit un chat pendant une journée. |
| `feedNudgeHelp` | Help feed a cat | Βοήθησε να φάει μια γάτα | Aide à nourrir un chat |
| `feedNudgeDismiss` | Got it | Εντάξει | Compris |
| `feedNudgeA11yLabel` | While we look: why not to feed the cats | Όσο ψάχνουμε: γιατί να μην ταΐζεις τις γάτες | Pendant la recherche : pourquoi ne pas nourrir les chats |

The "opens in your browser" line under **Help feed a cat** reuses the existing `campaignOpensAt` string (*"Opens {host} in your browser"*), which is already translated.

**Word choices, so the reviewer knows they were deliberate:**

- *"Cats go hungry through the winter"* is the honest core of the winter argument, said plainly. The proposal's long form goes further ("the island cannot support the numbers a generous summer encouraged"); that belongs in the long form, where there's room to explain it without sounding like a threat.
- *"Cat guardians"*, never "colony carers" or "feeders". Greek **κηδεμόνες γατών** and French **gardiens de chats** match the existing onboarding copy (`howStepDontFeedBody`).
- *"The right food"*: the specific wrong foods (milk, bread, salty and processed food) are the lactose fact and the wrong-food fact in `starter-facts.md`, so the nudge doesn't have to list them.
- **The Greek button** avoids the imperative *"τάισε"* (feed), which would contradict the card. *"Βοήθησε να φάει μια γάτα"* is "help a cat eat".

### 5.2 If no donation page is ready at launch

If Syros Cats can't name a donation page by the copy freeze (22 October), or don't want the €1 figure used (§7), the card ships **without the €1 line and without the Help feed a cat button**. The redirect is then said in words, pointing at what the app already has:

| Key | English | Ελληνικά | Français |
|---|---|---|---|
| `feedNudgeInsteadNoLink` | Syros Cats and local cat guardians feed colonies the right food, in the right places, all year round. The Help tab shows how you can support them. | Οι Syros Cats και οι ντόπιοι κηδεμόνες γατών ταΐζουν τις αποικίες με τη σωστή τροφή, στα σωστά σημεία, όλο τον χρόνο. Στην καρτέλα «Βοήθεια» θα δεις πώς μπορείς να τους στηρίξεις. | Syros Cats et les gardiens de chats locaux nourrissent les colonies avec la bonne nourriture, aux bons endroits, toute l’année. L’onglet « Aider » te montre comment les soutenir. |

The quoted tab names match the live tab labels (`tabHelp`: Help, Βοήθεια, Aider, checked against `i18n.ts` on origin/main `f757c0d`); if a label changes, these change with it.

Which version ships is a configuration switch, not a code change (§9), so it can change after launch without a new release.

---

## 6. With no signal or weak signal

Being precise, because offline support in Cat Spotters is partial:

- **No signal.** The app saves the sighting on the phone and says so (*"You are offline. Your sighting was saved…"*). There's no match wait, so the waiting card, and with it the nudge, doesn't appear. An offline spot doesn't use up one of the nudge's three showings. When the saved sighting is sent later, it's matched in the background, and no card shows then either.
- **Weak signal.** The wait is longer, so there's more time to read. The nudge's words are part of the app itself, not downloaded, so they appear instantly whatever the signal.
- **The Help feed a cat button needs a connection.** It opens a web page. If the page can't load, the phone's browser shows its own error; the app doesn't try to handle it. Because the card only appears while the app is sending a sighting, the phone almost always has some connection at that moment.
- **On the website** (which testers use), the nudge's words are there whenever the app itself has loaded. The website can't be opened from scratch with no signal at all; that's true of the whole site, not just this card.

---

## 7. What Syros Cats must confirm

These go to Syros Cats in one message, with the English copy, by **Monday 19 October** so answers land before the copy freeze on 22 October.

1. **Is "€1 feeds a cat for a day" a figure you stand behind?** It comes from the proposal's donation ladder, which the 1 September meeting said was "fine as proposed", but the proposal itself called the figures second-hand. A rough check suggests it's in the right range for decent dry food (§12), but it's their cost to state, not ours. *If no:* use the §5.2 version, which has no figure.
2. **Where should "Help feed a cat" go?** We need the address of the page where someone can give to Syros Cats today: their own donate page, PayPal, or another page they already use. *If there isn't one they're happy to point strangers at:* use the §5.2 version.
3. **Is the winter explanation right for Syros?** That colonies fed by visitors through the summer go hungry when the visitors leave. This is the proposal's argument, written from general guidance; Syros Cats know whether it matches what they see each October.
4. **Is it fair to the people who feed cats properly?** The copy says *"Syros Cats and local cat guardians feed colonies the right food, in the right places, all year round."* Is that true as stated, or should it be just "Syros Cats" or just "local cat guardians"?

---

## 8. Open decisions, each with a recommendation

### Decision 1 · Where the "€1 a day" button goes at launch

In-app donations are MLP (SYC-1), so at launch the button has to go somewhere that already exists.

| Option | What the spotter sees | Benefits | Risks |
|---|---|---|---|
| **A. Syros Cats' own donation page, in the browser** *(recommended)* | Taps the button, their browser opens Syros Cats' page, they give | The impulse is caught while it's warm. Money goes straight to the charity. Uses the pattern the Help tab already has | Depends on Syros Cats naming a page by 22 Oct. Their page may not mention feeding, so the "€1 a day" promise may not be visible there |
| **B. The Help tab's campaign screen** | Taps, lands on the Help tab | Stays in the app | The campaign screen is about sterilisation, and if its donate link isn't configured it says "Donations aren't open yet". That's a dead end at the exact moment someone wants to help |
| **C. No button; words only (§5.2)** | Reads that Syros Cats feed colonies and that the Help tab shows how to support them | Nothing to configure; can't break | Loses the "something to do now" that makes the nudge work |

**Recommendation: A, with C as the fallback** if Syros Cats can't name a page or won't use the €1 figure. Ship both versions behind the configuration switch (§9) so the change needs no release.

### Decision 2 · What happens to the nudge when the matches come back first

| Option | What the spotter sees | Benefits | Risks |
|---|---|---|---|
| **A. It moves to the bottom of the reward screen** *(recommended)* | Their result and points first, as always; the nudge waits under the questions until they're done | Nobody loses the message mid-sentence; never delays the result | The reward screen gets longer on the spots where it appears (at most three) |
| **B. It disappears with the wait** | Whatever they managed to read in 2–3 seconds | Simplest | On a fast connection most people see the heading and nothing else. The most valuable message in the app gets the least reading time |
| **C. Hold the result until they tap Got it** | A pause before the result | Guarantees it's seen | Puts something between the spotter and their points, which the data spine rules out (`cat-record-data-spine.md` §7). Feels like an advert |

**Recommendation: A.**

### Decision 3 · How often it comes back

| Option | Who sees what | Benefits | Risks |
|---|---|---|---|
| **A. First spot, then at most twice more, 14 days apart; never again after a tap** *(recommended)* | Visitors once; residents three times over a month or more | Everyone sees it once, when it matters most. Residents aren't nagged | A visitor who skipped it while distracted doesn't see it again during their trip |
| **B. Once only** | Everyone, once | The lightest touch | Residents who arrived before they started feeding never see it again; repeat visitors next summer don't either |
| **C. Every 5th spot, no limit** | Frequent spotters see it often | Most exposure | Nags the most engaged people, who are least likely to be the problem |

**Recommendation: A.**

---

## 9. For the builder

- **Copy** goes in `lib/i18n.ts` under the keys in §5, in all three languages, with the existing parity test covering them.
- **The donation link and which version ships** come from the server's configuration (the same place as `CAMPAIGN_DONATE_URL` in `artifacts/api-server/src/lib/campaign.ts`), e.g. `FEED_NUDGE_DONATE_URL`. Empty means the §5.2 version. The app reads it with the campaign data it already fetches; if it hasn't loaded, the §5.2 version shows. The link opens with the same helper as the Help tab's Donate button.
- **The nudge's memory** (times shown, last shown, tapped) sits with the waiting card's memory (`starter-facts.md` §3.4).
- **The schedule** is a small pure function (`which card for this wait?`) with unit tests, owned by the waiting card (`starter-facts.md` §9). This spec's rules are its first branch.

### 9.1 Tests that must exist

1. A new phone's first wait shows the nudge.
2. The second wait, the next day, shows a fact, not the nudge.
3. A wait 14 days after the first shows the nudge again; 13 days after, it doesn't.
4. After three showings, it never shows again.
5. After a tap on **Help feed a cat**, it never shows again.
6. A nudge on screen for less than 1 second (a send that failed instantly) isn't counted.
7. An offline save shows no card and doesn't change the count.
8. When the result arrives with the nudge open, the reward screen shows result, points and questions first, and the nudge below them, with the same buttons.
9. With no donation link configured, the §5.2 version shows: no €1 line, no button.
10. All keys exist in English, Greek and French (the existing parity test).

---

## 10. Dates

| When | What |
|---|---|
| Fri 16 Oct | Spec and review done (SYC-343) |
| Mon 19 Oct | Samuel approves. Questions in §7 go to Syros Cats |
| Thu 22 Oct | Copy freeze: English final, Greek and French drafts final. Syros Cats' answers in; the configuration switch set accordingly |
| By Sat 24 Oct | Greek and French to Johnny (SYC-283) |
| 23–27 Oct | Johnny's corrections folded in |
| Sat 31 Oct | Launch |

---

## 11. Review

An independent adversarial review (Sonnet, 15 October 2026) read this spec and `starter-facts.md` together against the product spec, the proposal, the live spot flow and the canonical facts. Its findings, and what was done about each, are in [`reviews/feeding-nudge-and-starter-facts-review.md`](./reviews/feeding-nudge-and-starter-facts-review.md).

---

## 12. Sources (for the spec, not the app)

The app shows no citations. These are here so Samuel, Syros Cats and Johnny can check what the words rest on.

- **The winter argument and the redirect:** the proposal §13, "The feeding nudge" (`docs/syros-cats-proposal.md`), and the engagement design §5.4 (`docs/superpowers/specs/2026-07-28-engagement-and-donations-design.md`). These are our own documents, written from general guidance; §7 asks Syros Cats to confirm the argument holds on Syros.
- **"€1 feeds a cat for a day":** the proposal's donation ladder (§14), "fine as proposed" at the 1 September meeting (`docs/PRODUCT-SPEC.md` §1). The rough cost check is in `starter-facts.md` §12.
- **Why feeding by visitors causes harm** (wrong food, food left out): see the wrong-food and lactose facts and their sources in `starter-facts.md` §12.
