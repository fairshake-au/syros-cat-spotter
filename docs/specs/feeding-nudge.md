# The feeding nudge, in the spot flow

**Status:** Draft for Samuel's approval, 15 October 2026. **All six decisions answered by Samuel, 15 October 2026** (§8): 1, 2, 3 and 6 as recommended; 4 changed to a full nudge once, then a daily one-liner for visitors only; 5 changed to nothing after an offline save. This version builds them in. An independent adversarial review (Sonnet) found 2 blockers and 15 major issues in the first draft. All are fixed here; the review and how each finding was handled are in [`reviews/feeding-nudge-and-starter-facts-review.md`](./reviews/feeding-nudge-and-starter-facts-review.md).
**Owner:** Samuel
**Covers:** SYC-36 (and the shared half of SYC-343). `docs/PRODUCT-SPEC.md` §2.2: *"The feeding nudge (short form) in the spot flow, with the winter-dependence explanation and the €1-a-day redirect."*
**Builds on:** the proposal §13 "The feeding nudge" (the long form this is the short form of) · the onboarding "Please don't feed them" step and the "Look, don't touch" safety screen (SYC-35) · the result screens in `/review` (match list, naming a new cat) · the Help tab's donate button (SYC-1's seam).
**Shares a slot with:** [`starter-facts.md`](./starter-facts.md) (SYC-48). Both appear in **the waiting card**, defined once in `starter-facts.md` §3. This spec owns the nudge's words, when it takes the card, where it goes after the wait, and its link.
**Dates:** launch 31 October 2026 (SYC-73). Greek and French drafts reach Johnny for native review (SYC-283) by Thursday 22 October, per the launch plan (PR #172); his corrections land 23–27 October.

---

## 1. The short version

When a spotter taps **Check for matches**, there are a few seconds while Cat Spotters looks for the cat. In that time, **the waiting card** takes the place of the map: one short thing worth reading while you wait.

On a spotter's **first** spot, that card is the feeding nudge:

> **Thinking of sharing your lunch?**
> We'd gently ask you not to. Cats fed all summer by visitors come to rely on it. When the visitors leave, the food leaves with them, and the cats go hungry through the winter.
> Syros Cats and local cat guardians feed colonies the right food, in the right places, all year round.
> **€1 feeds a cat for a day. €30 feeds one for a month.**

When the matches come back, the nudge **comes with the spotter** to the first result screen, below the matches, now with two buttons: **Help feed a cat**, which opens Syros Cats' own donation page (**syroscats.com/donations**) in the phone's browser, and **Got it**. It never sits above the matches or between the spotter and their cat.

The full nudge shows **once**. After that, a visitor gets a **one-line reminder** under the matches on their first spot of each day, *"Please don't feed the cats. €1 feeds one for a day."*, with the same button. A phone that looks like a resident's (it has claimed a cat, or has been spotting for three weeks or more) gets no reminders. Every wait after the first shows a cat fact.

Syros Cats must confirm the donation page and the €1 and €30 figures (§7). If they can't by 22 October, the nudge ships without figures or a button, pointing to the Help tab instead (§5.2). That switch is a setting, not a new release.

---

## 2. Why this matters

The proposal calls the feeding nudge the single most valuable piece of teaching in the app, and the reason is timing. Onboarding says "Please don't feed them", once, before anyone has met a cat. The nudge says **why**, at the moment someone is standing in front of a hungry-looking cat with food in their bag, and gives them **something to do instead**. That's why it repeats the onboarding message on the first spot: the first time was a rule; this time it's a reason and an alternative.

Two things make it work, and both are in the short form:

1. **The reason is one people haven't thought of.** Most visitors think feeding is kind. The winter argument reframes it: the harm arrives months later, after they've gone home, when nobody is watching.
2. **It ends with something to do.** A nudge that only says no is a nudge people ignore. The €1 line turns the feeling that made them reach for the sandwich into help that lasts the whole year.

### 2.1 Two audiences, needs that fit together

| | Tourists | Locals and cat guardians |
|---|---|---|
| **What the nudge gives them** | The reason not to feed, and a better way to help that still feels like feeding a cat | Backing: the app tells visitors what guardians have been telling them for years |
| **What it must not do** | Lecture, or repeat itself every spot | Suggest that feeding *by guardians* is wrong. The copy names guardians as the people who do it properly |
| **How often** | The full nudge on their first spot, then a one-line reminder on their first spot of each day for the rest of the trip | The full nudge once, then nothing: residents are the least likely to give, and guardians already know. Cat guardians who sign in don't see it at all (§8, Decision 4) |

---

## 3. Where it appears, and when

### 3.1 During the wait

The nudge appears in **the waiting card** (`starter-facts.md` §3), which takes the place of the map on the New spot screen from the moment **Check for matches** is tapped until the result arrives. The map is locked during that time anyway; the card sits where the spotter is already looking.

During the wait the nudge shows its **words only**: heading, two paragraphs and the €1 line. No buttons. Opening a browser while the photo is still uploading could stop the upload, so the button waits for the result (§3.3).

### 3.2 When the full nudge shows, and when the one-liner does

**The full nudge** takes the waiting card on a phone's **first** spot that is sent with a signal, and never again once it has been counted. It's skipped entirely for anyone signed in as a cat guardian or Syros Cats team member (once those sign-ins exist; Decision 4).

**It's counted** when it appears on the first result screen (§3.3): that's when the spotter has had the whole wait plus as long as they like to read it. If the wait ends badly (a rejected photo, a failed send, or "Save and send later"), it isn't counted, and the next attempt shows it again. An offline save shows nothing and counts nothing (Decision 5); the full nudge waits for the phone's first spot sent with a signal.

**The one-liner** is a single line with the button, on the first result screen only, below the matches:

> Please don't feed the cats. €1 feeds one for a day. *[Help feed a cat]*

It shows when **all** of these are true:

1. The full nudge has already been counted, on an earlier day.
2. This is the phone's first spot of the day sent with a signal (days run on Athens time, like streaks).
3. The phone looks like a **visitor's**: it hasn't claimed a cat as its own, and its first spot was less than **21 days** ago.
4. Nobody has tapped **Help feed a cat** on this phone. Someone who has given doesn't need a daily reminder. (Carried over from the first draft's rule; Samuel can drop it.)
5. The donation link is switched on (§5.2). With no link, there's nothing for the line to offer, so it doesn't show.
6. The spotter isn't signed in as a cat guardian or team member.

The one-liner never takes the waiting card: on those spots, the wait shows a fact as usual, and the line appears with the matches.

**Why the resident guess works this way.** The app can't know who lives on Syros. Claiming a cat as your own pet is a strong sign of living here; spotting across three weeks is longer than almost any visit. The language setting isn't used, because many summer visitors are Greeks from Athens. A visitor who stays longer than three weeks stops getting reminders, which is acceptable.

In practice: a visitor on a four-day trip sees the full nudge on their first spot and a one-line reminder on each of the next three days. A resident sees the full nudge once, then never again.

### 3.3 After the matches come back

When the result arrives, the nudge moves with the spotter to **the first result screen**, whichever that is:

- **the list of possible matches** ("Is this her?"), or
- **naming a new cat**, when there are no possible matches.

It sits **below everything the spotter needs to act on**: below the matches, below "None of these" and "Find the cat yourself", below the name field and its button. It never pushes those down or sits between the spotter and their cat. It has the same words, now with its two buttons, and stays until the spotter taps **Got it**, taps **Help feed a cat**, or moves on. It doesn't follow them to the next screen.

Neither the nudge nor the one-liner **ever appears** on the "we couldn't see a cat in this photo" screen, and nothing is counted there.

**Help feed a cat** opens the donation page in the phone's own browser. By this point the sighting has been saved on Cat Spotters' server, so leaving the app doesn't lose it: the spotter returns to the same result screen.

### 3.4 Where it doesn't appear

- **Not in full more than once.** After that, visitors get the one-liner at most once a day, and residents nothing (§3.2).
- **Not as a pop-up, a sheet or a screen of its own.** It's always a card within a screen the spotter is already on.
- **Not on the cat's page.** The proposal also puts the nudge "quietly on each cat's page"; that, and the long form with all four reasons, belong to Teaching in full (SYC-61, MLP).
- **Not on the team dashboard.** Syros Cats' staff don't spot through the dashboard.

### 3.5 After an offline save

Nothing (Decision 5). An offline save shows its usual "saved on your phone" message and no nudge, and counts nothing. The full nudge shows on the phone's first spot sent with a signal.

---

## 4. What it looks like

A card with the same rounded white surface, border and spacing as the result screens' cards, so it reads as part of the app, not an advert.

- **Heading** in the card's title style. No "While we look…" eyebrow: the nudge is the one card with its own heading.
- **Two short paragraphs** of body text.
- **The €1 and €30 line** in bold, on its own line.
- **On the result screen only, two buttons:** **Help feed a cat** (secondary style, with the existing line *"Opens {host} in your browser"* beneath it, `campaignOpensAt`) and **Got it** (quiet). Side by side where they fit; **stacked** on narrow screens and at large text sizes. Both at least **44 × 44 points**, both reachable by keyboard on the website.
- No photo, no animation. With "reduce motion" on, it appears without any transition.

**Fit.** In the wait, it fits in the map's space on an iPhone SE (375 × 667) at the default text size; at the largest text size the screen scrolls, and the card's top is in view when it appears. On the result screen it's below the fold if the matches fill the screen, which is fine: it never displaces them.

**Screen readers.** The card has a heading, so it can be reached by heading navigation; it isn't read out automatically in full (70 words in a few seconds would be cut off). When it appears during the wait, the screen reader announces only *"Why not to feed the cats"* (`feedNudgeA11yLabel`), and focus stays on the spotter's button.

---

## 5. The words

French uses **tu**, and Greek the informal singular, to match the rest of the app. Greek capitals drop their accents (SYC-159), so headings are in sentence case. The euro sign follows each language's convention: **€1** in English, **1 €** in Greek and French. In French and Greek the builder uses a **non-breaking space** inside « », before « ? : ; ! » in French, and between a number and €, so lines never break there.

These are drafts. Greek and French go to Johnny for native review (SYC-283) on Thursday 22 October (§10).

### 5.1 The nudge

| Key | English | Ελληνικά | Français |
|---|---|---|---|
| `feedNudgeTitle` | Thinking of sharing your lunch? | Σκέφτεσαι να μοιραστείς το φαγητό σου; | Tu comptes partager ton déjeuner ? |
| `feedNudgeWhy` | We'd gently ask you not to. Cats fed all summer by visitors come to rely on it. When the visitors leave, the food leaves with them, and the cats go hungry through the winter. | Σου ζητάμε ευγενικά να μην το κάνεις. Οι γάτες που τις ταΐζουν οι επισκέπτες όλο το καλοκαίρι καταλήγουν να εξαρτώνται από αυτό. Όταν φεύγουν οι επισκέπτες, φεύγει και το φαγητό, και οι γάτες πεινάνε όλο τον χειμώνα. | On te demande gentiment de ne pas le faire. Les chats nourris tout l’été par les visiteurs finissent par en dépendre. Quand les visiteurs partent, la nourriture part avec eux, et les chats ont faim tout l’hiver. |
| `feedNudgeInstead` | Syros Cats and local cat guardians feed colonies the right food, in the right places, all year round. | Οι Syros Cats και οι ντόπιοι κηδεμόνες γατών ταΐζουν τις αποικίες με τη σωστή τροφή, στα σωστά σημεία, όλο τον χρόνο. | Syros Cats et les gardiens de chats locaux nourrissent les colonies avec une alimentation adaptée, aux bons endroits, toute l’année. |
| `feedNudgeEuro` | €1 feeds a cat for a day. €30 feeds one for a month. | Με 1 € τρέφεται μια γάτα για μια μέρα. Με 30 €, για έναν μήνα. | 1 € nourrit un chat pendant une journée. 30 € le nourrissent pendant un mois. |
| `feedNudgeHelp` | Help feed a cat | Βοήθησε να φάει μια γάτα | Aide à nourrir un chat |
| `feedNudgeDismiss` | Got it | Κατάλαβα | Compris |
| `feedNudgeA11yLabel` | Why not to feed the cats | Γιατί να μην ταΐζεις τις γάτες | Pourquoi ne pas nourrir les chats |

The "opens in your browser" line under **Help feed a cat** reuses the existing `campaignOpensAt` string (*"Opens {host} in your browser"*), already translated.

Samuel chose both figures (Decision 2).

### 5.1a The daily one-liner

| Key | English | Ελληνικά | Français |
|---|---|---|---|
| `feedNudgeLine` | Please don't feed the cats. €1 feeds one for a day. | Σε παρακαλούμε, μην ταΐζεις τις γάτες. Με 1 € τρέφεται μια γάτα για μια μέρα. | Merci de ne pas nourrir les chats. 1 € en nourrit un pendant une journée. |

It uses the same **Help feed a cat** button and *"Opens {host} in your browser"* line as the full nudge. The one-liner keeps only the €1 figure, to stay one line; the €30 month is on the donation page's own choices and in the full nudge.

**Word choices, so the reviewer knows they were deliberate:**

- *"Cats go hungry through the winter"* is the honest core of the winter argument, said plainly. The proposal's long form goes further ("the island cannot support the numbers a generous summer encouraged"); that belongs in the long form, where there's room to explain it without sounding like a threat.
- *"Cat guardians"*, never "colony carers" or "feeders". Greek **κηδεμόνες γατών** and French **gardiens de chats** match the existing onboarding copy (`howStepDontFeedBody`).
- *"The right food"*: the specific wrong foods (milk, onions, salty leftovers) are facts 7 and 8 in `starter-facts.md`, so the nudge doesn't have to list them.
- **The Greek button** avoids the imperative *"τάισε"* (feed), which would contradict the card. *"Βοήθησε να φάει μια γάτα"* is "help a cat eat".
- **"€30 feeds one for a month"** is there because card and PayPal fees take a fixed amount from every payment, so a €1 gift loses a large share; the proposal (§14) recommends selling the month for exactly this reason. It keeps the euro-a-day framing and makes the sensible gift the easy one.

### 5.2 Without a donation link or figures

Used when Syros Cats haven't confirmed the page and figures by 22 October, and whenever the app hasn't been able to load its settings (§9). No figures and no button; the redirect is said in words. The one-liner doesn't show at all in this form:

| Key | English | Ελληνικά | Français |
|---|---|---|---|
| `feedNudgeInsteadNoLink` | Syros Cats and local cat guardians feed colonies the right food, in the right places, all year round. The Help tab shows how to give. | Οι Syros Cats και οι ντόπιοι κηδεμόνες γατών ταΐζουν τις αποικίες με τη σωστή τροφή, στα σωστά σημεία, όλο τον χρόνο. Στην καρτέλα «Βοήθεια» θα δεις πώς μπορείς να κάνεις δωρεά. | Syros Cats et les gardiens de chats locaux nourrissent les colonies avec une alimentation adaptée, aux bons endroits, toute l’année. L’onglet « Aider » te montre comment faire un don. |

The quoted tab names match the live tab labels (`tabHelp`: Help, Βοήθεια, Aider, checked against `i18n.ts` on origin/main `f757c0d`); if a label changes, these change with it. The line says "how to give", not "how to help", so it isn't confused with the **This cat needs help** button, which is for a cat in trouble.

---

## 6. With no signal or weak signal

Being precise, because offline support in Cat Spotters is partial:

- **No signal.** The app saves the sighting on the phone and says so. There's no wait, so no waiting card, and no nudge or one-liner (Decision 5). When the saved sighting is sent later, it's matched in the background, with no card.
- **Weak signal.** The wait is longer, so there's more time to read. The nudge's words are part of the app itself, not downloaded, so they appear instantly whatever the signal.
- **The Help feed a cat button needs a connection.** It opens a web page. It only appears on the result screen, which needs the server to have just answered, so the phone had a connection seconds earlier. If the page then can't load, the browser shows its own error.
- **On the website** (which testers use), the nudge's words are there whenever the app itself has loaded. The website can't be opened from scratch with no signal at all; that's true of the whole site, not just this card.
- **The app's settings** (whether the donation link and figures are on) are fetched when the app starts and kept on the phone, so a phone that has been online once knows them offline.

---

## 7. What Syros Cats must confirm

These go to Syros Cats in one message, with the English copy, by **Monday 19 October**, so answers land before the copy freeze on 22 October. **If an answer hasn't come by 22 October, the nudge ships in its §5.2 form** (no figures, no button) and switches over when they say yes, with no new release.

1. **The figures.** On food alone, €1 covers more than a day: decent dry food in Greece costs roughly 20–60 cents per cat per day (§12). So "€1 feeds a cat for a day" errs on the safe side, if it's meant to cover the food plus the round, water and bowls. Card and PayPal fees take a fixed amount from each payment, which hurts a €1 gift most, so the nudge also says *"€30 feeds one for a month"*. **Are you happy for the app to say both?**
2. **The page.** Should **Help feed a cat** open **syroscats.com/donations** (your existing page: PayPal, card, bank transfer)? It's a general page, so it won't repeat the €1 or €30 figures. And are you happy for Cat Spotters, which isn't run by Syros Cats, to send people there?
3. **The winter explanation.** Is it right for Syros that colonies fed by visitors through the summer go hungry when the visitors leave?
4. **The guardians line.** *"Syros Cats and local cat guardians feed colonies the right food, in the right places, all year round."* Fair as stated, given many guardians are volunteers?
5. **Counting.** Are you happy for the app to count how many times the donation link is opened (a number only, nothing about who; Decision 6, which Samuel has said yes to)?

### 7.1 App Store and Google Play

Apple's App Review Guidelines (opened 15 October 2026), **3.2.2(iv)**: an app that isn't an approved nonprofit *"may only collect funds outside of the app, such as via Safari or SMS"*, and must be free. Cat Spotters is free and collects nothing: the button opens Syros Cats' own page in the phone's browser, the same way the Help tab's Donate button does. That's why it opens the browser, not a page inside the app. Google Play's donation policy is **unchecked** here; the store-listing work (the rename chip) confirms it before submission. If either store objects, the §5.2 form is the fallback and needs no release.

---

## 8. Open decisions, each with a recommendation

### Decision 1 · Where "Help feed a cat" goes at launch

**Decided by Samuel, 15 Oct 2026: A** (Syros Cats' page, with C as the automatic fallback).

In-app donations are MLP (SYC-1), so at launch the button has to go somewhere that already exists.

| Option | What the spotter sees | Benefits | Risks |
|---|---|---|---|
| **A. Syros Cats' donation page, in the browser** *(recommended)* | Taps the button, their browser opens syroscats.com/donations, they give by PayPal, card or bank transfer | Catches the impulse while it's warm. Money goes straight to the charity (a UK registered charity); the app moves no money. The page exists today. Meets Apple's rule | Needs Syros Cats' yes. Their page is general, not feeding-specific |
| **B. The Help tab** | Taps, lands on the Help tab | Stays in the app | The Help tab's campaign is about sterilisation, and says "Donations aren't open yet" if its link isn't set. A dead end at the moment someone wants to help |
| **C. No button; words only (§5.2)** | Reads that the Help tab shows how to give | Nothing to confirm; can't break | Loses the "something to do now" that makes the nudge work |

**Recommendation: A, with C as the automatic fallback** until Syros Cats say yes.

### Decision 2 · Which figure the nudge uses

**Decided by Samuel, 15 Oct 2026: A** (both figures).

| Option | Words | Benefits | Risks |
|---|---|---|---|
| **A. Both: "€1 feeds a cat for a day. €30 feeds one for a month."** *(recommended)* | Both lines | Keeps the €1 framing that makes it feel easy, and makes the month the natural gift, which loses far less to fees | One more line to read |
| **B. "€1 feeds a cat for a day" only** | What the product spec says | Shortest; matches the spec | People give €1, and fees take a large share of it |
| **C. "€30 feeds a cat for a month" only** | No daily figure | Best for Syros Cats per payment | Loses the "anyone can do this" feel that makes the nudge land |

**Recommendation: A.**

### Decision 3 · Where the nudge goes after the wait

**Decided by Samuel, 15 Oct 2026: A** (below everything on the first result screen).

| Option | What the spotter sees | Benefits | Risks |
|---|---|---|---|
| **A. Below everything on the first result screen** *(recommended)* | Matches (or naming) first, as always; the nudge underneath, with its buttons, until dismissed | Nobody loses the message mid-sentence. The button appears only once the upload is safe. Never in the way | Some spotters tap their match without scrolling down, and miss the buttons |
| **B. It disappears with the wait** | Whatever they read in a few seconds | Simplest | On a fast connection most people see the heading and nothing else; no button at all |
| **C. Hold the result until they tap Got it** | A pause before the result | Guarantees it's seen | Puts something between the spotter and their cat, which the data spine rules out (`cat-record-data-spine.md` §7). Feels like an advert |

**Recommendation: A.**

### Decision 4 · How often it comes back, and for whom

**Decided by Samuel, 15 Oct 2026: the full nudge once, then a daily one-liner for visitors; residents once only** (§3.2). Samuel asked why not every spot, and pointed out that residents are the least likely to give, so should see it once only. The options he chose from:

| Option | Who sees what | Benefits | Risks |
|---|---|---|---|
| **A. Full once, then a daily one-liner for visitors** *(recommended; chosen)* | Full nudge on the first spot; visitors get one line plus the button on their first spot each day; residents (claimed a cat, or spotting 3+ weeks) nothing more | Visitors, the likely givers and feeders, keep a daily reminder without a wall of text. Residents aren't nagged | The resident guess will sometimes be wrong |
| **B. Full nudge on every spot** | Everyone, every spot | Maximum exposure | After two or three times nobody reads it; the result screen grows every spot; it crowds out the facts |
| **C. One-liner on every spot** | Full once, then the line every spot; residents once | More reminders than A | A line on every result screen becomes invisible fast |
| **D. Once only, for everyone** | Everyone, once | Simplest, least naggy | No reminder for a visitor who skimmed it on day one |

The first draft's rule (first spot, then at most twice more, 14 days apart) is replaced.

### Decision 5 · After an offline save

**Decided by Samuel, 15 Oct 2026: B** (nothing offline). Not the recommendation; less to build.

| Option | What an offline spotter sees | Benefits | Risks |
|---|---|---|---|
| **A. The no-link nudge on the Spot tab, under the "saved" message** *(recommended)* | The nudge's words, pointing to the Help tab | Visitors without data, often the ones exploring the back streets with snacks, still get the message | One more thing to build: a second place the card appears |
| **B. Nothing** | The "saved" message only | No extra work | Spotters who are always offline never see the most valuable message in the app |

**Recommendation: A.**

### Decision 6 · Counting how often the link is opened

**Decided by Samuel, 15 Oct 2026: A** (a bare count).

The app has no analytics, so without this nobody can tell whether the nudge leads anyone to give.

| Option | How | Benefits | Risks |
|---|---|---|---|
| **A. A count on Cat Spotters' server, nothing else** *(recommended)* | The button opens a Cat Spotters address that adds one to a counter and forwards to the donation page | Syros Cats and Samuel can see whether it works. No device, username or location recorded. Also keeps the real donation address on the server, so changing it needs no release | Needs Syros Cats' OK (§7, Q5) and a line in the privacy policy |
| **B. No counting** | The button opens the donation page directly | Nothing to explain | No way to know if the nudge does anything |

**Recommendation: A.**

---

## 9. For the builder

- **Copy** goes in `lib/i18n.ts` under the keys in §5, in all three languages, with the existing parity test covering them.
- **App settings.** A small new endpoint (e.g. `GET /api/app-settings`), separate from the campaign, returns whether the nudge's link and figures are on and which facts are hidden (`starter-facts.md` §9). The app fetches it when it starts and keeps the last answer on the phone. **Defaults when nothing has ever loaded:** link and figures off (§5.2 form), no facts hidden. A nudge shown in the no-link form *only because settings hadn't loaded* isn't counted.
- **The link** opens a Cat Spotters address (e.g. `/api/go/feed`) that counts the open and redirects to the configured donation page (Decision 6). The configured page goes through the existing `sanitizeDonateUrl`. If Decision 6 is no, the settings carry the page address instead, and the app opens it directly with the same helper as the Help tab's Donate button. Either way: the phone's own browser, never a page inside the app (§7.1).
- **The nudge's memory** (full nudge counted, the date of the last one-liner, tapped, and the date of the phone's first spot) sits in the waiting card's record (`starter-facts.md` §3.4). Whether the phone has claimed a cat comes from what the app already knows about claims.
- **The schedule** is the waiting card's pure function (`starter-facts.md` §9); this spec's rules are its first branch. The function is told the outcome of each wait, so it only counts a showing on a result screen.
- **The result screens** (`review.tsx`) get the nudge from the same record, keyed by the sighting, so it appears on the first result screen only, below the existing content.
- **Before building, measure the wait.** The typical and slow (p50, p90) times for sending a sighting on the live server decide how much people can read; if the typical wait is under 2 seconds, raise it with Samuel.

### 9.1 Tests that must exist

1. A new phone's first wait shows the full nudge's words, with no buttons.
2. When the result arrives, the nudge appears **below** the match list (and below the naming form when there are no matches), with both buttons, and is counted.
3. The not-a-cat screen never shows the nudge or the one-liner, and counts nothing.
4. A rejected photo, a failed send, or choosing "Save and send later" doesn't count the full nudge; the next wait shows it again.
5. Once counted, the full nudge never shows again.
6. The day after, a visitor's first result screen shows the one-liner below the matches; their second spot that day doesn't. The wait on that spot shows a fact.
7. No one-liner for a phone that has claimed a cat, or whose first spot was 21 or more days ago.
8. No one-liner after a tap on **Help feed a cat**.
9. No one-liner when the donation link is switched off.
10. An offline save shows no nudge or one-liner and changes nothing in the record.
11. With the link setting off, or settings never loaded, the full nudge shows the §5.2 form: no figures, no button. With settings never loaded, it isn't counted.
12. Days roll over on Athens time.
13. The card's top is visible without scrolling on a 375 × 667 screen at the default text size, in all three languages; buttons stack at the largest text size; both are at least 44 × 44 points.
14. All keys exist in English, Greek and French (the existing parity test).

A browser-pane check at about 390 px and at desktop width goes with the PR, in all three languages.

---

## 10. Dates

| When | What |
|---|---|
| Fri 16 Oct | Spec and review done (SYC-343) |
| Mon 19 Oct | Samuel approves. Questions in §7 go to Syros Cats |
| Thu 22 Oct | Copy freeze: English final, Greek and French drafts final and sent to Johnny (SYC-283). Syros Cats' answers in, or the §5.2 form ships |
| 23–27 Oct | Johnny's corrections folded in |
| Sat 31 Oct | Launch |

---

## 11. Review

An independent adversarial review (Sonnet, 15 October 2026) read this spec and `starter-facts.md` together against the product spec, the proposal, the live spot flow and the canonical facts. It found that the first draft put the nudge on a screen many spotters never reach, put the card below the fold on small phones, opened the browser mid-upload, and counted the nudge on a glance. All fixed above. The full review, and what was done about each of its 40 findings, is in [`reviews/feeding-nudge-and-starter-facts-review.md`](./reviews/feeding-nudge-and-starter-facts-review.md).

---

## 12. Sources (for the spec, not the app)

The app shows no citations. These are here so Samuel, Syros Cats and Johnny can check what the words rest on. Researched 15 October 2026; "opened" means the page itself was read; **unchecked** means only a search listing was seen.

- **The winter argument and the redirect:** the proposal §13, "The feeding nudge" (`docs/syros-cats-proposal.md`), and the engagement design §5.4 (`docs/superpowers/specs/2026-07-28-engagement-and-donations-design.md`). From outside our own documents: Petscare (Crete), street-cat feeding advice: peak tourism brings abundant food and more breeding, then scarcity when tourists leave (opened) · ASPCA Pro, feeding community cats: feed only what is eaten in about half an hour and remove leftovers, which otherwise draw wildlife and neighbour complaints (opened) · Network for Animals, Kefalonia winter feeding appeal (unchecked). These are charity and advocacy sources; no peer-reviewed study of seasonal tourist feeding in Greece was found. §7 asks Syros Cats to confirm the argument holds on Syros.
- **The figures:** the proposal's donation ladder (§14), "fine as proposed" at the 1 September meeting (`docs/PRODUCT-SPEC.md` §1); the proposal's own advice to sell "feed a cat for a month, €30" because of fixed card fees (§14). **Rough cost check:** an adult cat eats about 50–70 g of dry food a day (Catological feeding guide, unchecked); Purina Friskies Adult 2 kg is listed from €7.69 on Skroutz Greece (unchecked), about €3.85/kg, so €0.19–0.27 a day; at €6–8/kg, €0.30–0.56. Single listings, not an average.
- **Syros Cats' own pages:** donations, syroscats.com/donations (PayPal, card, bank transfer; opened) · feeding programmes, syroscats.com/feeding-programmes: six feeding stations around Kini, fed once or twice a day; visitors asked to refill water and not to leave wet food or biscuits by bins (opened) · UK registered charity 1207145 (Charity Commission register, unchecked).
- **Store rules:** Apple App Review Guidelines 3.2.1(vi) and 3.2.2(iv) (opened 15 Oct 2026). Google Play: unchecked.
- **Why feeding by visitors causes harm** (wrong food, food left out): facts 7 and 8 and their sources in `starter-facts.md` §12.
