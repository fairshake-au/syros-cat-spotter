# Help & info: a tab that helps, and reports that know the cat

**Feature spec · Cat Spotters (Syros)**
**Version:** 0.2, revised after adversarial review · 21 October 2026
**Covers:**
- SYC-120: rename the "Help" tab and add app support.
- SYC-504: "This cat needs help" opened from a cat's page doesn't tell Syros Cats which cat it is.
- The two onboarding strings that still say "desex" (SYC-348), because this page shows them again.

**Evidence:**
- The 29 September user-testing call (SYC-116). People expected "Help" to mean help with the app, but it opened the donations page.
- The 18 October public-app UX review (SYC-501). A visitor with a hurt cat who taps "Help" is asked to fund a sterilisation round. From there they can't reach the report, the vets, a contact or privacy.

**Decisions already made (Samuel, 21 October 2026, recorded on the tickets):**
1. The heart tab becomes a **Help & info** hub.
2. Its icon is a **question mark in a circle**.
3. **Contact us** opens the phone's email app, addressed to hello@catspotters.com.
4. While in-app donations aren't open, the giving part **links to Syros Cats' own donations page**.
5. A report sent from a cat's page **knows the cat**, but its map **still starts where the reporter is**. The map never shows where a cat is usually fed.

**Review:** an adversarial review of 0.1 found 1 blocker, 8 major and 13 minor issues. All are handled here; §10 says where.
**Status:** **Approved by Samuel, 21 October 2026** ("approved, write the plan").

---

## 1. The short version

Two things go wrong today.

**The "Help" tab doesn't help.** Its heart icon and its name both suggest help, but the whole screen is a fundraising campaign. Until donations open, it says "Donations aren't open yet". Sometimes that sits right under "Be the first to chip in!". Anyone looking for help with the app, or for help with a hurt cat, finds neither.

**A report from a cat's page forgets the cat.** On Tigris's page, "This cat needs help" opens the same blank report as anywhere else. The team then has to work out which cat it was from a photo and a pin.

After this change:

- The tab is called **Help & info** and has a question-mark icon. It opens a page that answers, in this order:
  1. *A cat needs help. What do I do?* A large button straight into the report.
  2. *Who can I call?* The island's vets, with tap-to-call numbers.
  3. *How does this app work?* How spotting works, and look, don't touch.
  4. *How do I reach someone?* Contact us by email.
  5. *What happens to my information?* Privacy, and deleting your data.
  6. *How can I give?* Syros Cats' donations page, or the in-app campaign once donations open.
- A report started from a cat's page says **"About Tigris"** at the top of its first screen, with **"It's a different cat"** underneath.
- The team's queue card shows **"Sent from Tigris's page"** with both cats' photos side by side, and a **"Yes, it's Tigris"** button for team members who can tie reports.

---

## 2. The tab

| | Today | After |
|---|---|---|
| Icon, iOS with liquid glass (`NativeTabs`, `_layout.tsx:34`) | `heart` / `heart.fill` | `questionmark.circle` / `questionmark.circle.fill` |
| Icon, iOS without liquid glass (classic tabs, `SymbolView`, `_layout.tsx:136-139`) | `heart` | `questionmark.circle` |
| Icon, Android and web (Feather) | `heart` | `help-circle` |
| Tab label `tabHelp` | EN "Help" · EL "Βοήθεια" · FR "Aider" | EN "Help & info" · EL "Βοήθεια" (unchanged) · FR "Aide" |
| Page title (new key `helpInfoTitle`) | (the campaign title) | EN "Help & info" · EL "Βοήθεια και πληροφορίες" · FR "Aide et infos" |

- **Why the Greek tab label stays "Βοήθεια".** It means "help" in the sense of assistance, which is now correct. "Βοήθεια και πληροφορίες" is too long for a tab bar with five tabs at 390px, so the longer form is the page title.
- **Why the French label changes.** "Aider" is the verb "to help", which reads as a call to give. "Aide" is the noun, the help you get.
- **The route keeps its name.** The file stays `app/(tabs)/help.tsx` and the tab stays `name="help"`. Nothing links to it by route.
- **Label length is checked by hand.** All three labels are checked at 390px on all three tab variants, in light and dark mode. If "Help & info" truncates, the EN tab label falls back to "Help" and the page title keeps "Help & info".

### 2.1 Words elsewhere that point at the tab

Today, two messages say "the Help tab shows how to give":
- the feeding nudge's no-link line, `feedNudgeInsteadNoLink`;
- the link-off page, `LINK_OFF_PAGE` in `api-server/src/routes/go.ts`.

Both show **only when the donations link is off**. In that case the Help & info page shows nothing about giving either (§3.6). So both stop pointing at the tab:

- **`feedNudgeInsteadNoLink`** keeps its first sentence and drops the second, in all three languages. It now reads: "Syros Cats and local cat guardians feed colonies the right food, in the right places, all year round."
- **`LINK_OFF_PAGE`** body becomes EN "This link isn't available right now." · EL «Αυτός ο σύνδεσμος δεν είναι διαθέσιμος αυτή τη στιγμή.» · FR « Ce lien n'est pas disponible pour le moment. ». Its title is unchanged.

Other mentions of the Help tab are code comments and docs. They are updated so they don't mislead the next reader:
- `go.ts:35`, `api-server/src/lib/campaign.ts:2` and `cat-spotter/components/FeedNudge.tsx:15`;
- the FeedNudge and WaitingCard test names;
- `lib/api-spec/openapi.yaml:704` and `:1279`;
- `docs/SPEC.md:197` and `:315`.

The OpenAPI change is description-only, but the clients are regenerated (`api-zod`, `api-client-react`) so the generated files don't drift from the spec.

---

## 3. The Help & info page

One scrolling page under the existing `OfflineBanner`. Each section has a short heading and is built from parts the app already has wherever possible. There is no gradient hero: the page starts with its title.

### 3.1 A cat needs help

- A full-width card at the top, in the report's urgent styling.
  - Heading: "Found a cat that's hurt, sick or in danger?"
  - Button: "A cat needs help". It opens `/report` with nothing handed over, the same as the link on the Cats tab.
- The report already works without signal. On the app, it is saved on the phone; on the website, in the browser. It is sent when there is a connection. This page adds nothing to that.

### 3.2 Vets

- Heading: "Vets on Syros".
- The page calls `useWelfareGuidance()` and passes the result to the existing `VetList` (`components/report/VetList.tsx:145`) in its full form, not `compact`: one card per clinic, with tap-to-call, map and the area.
- `useWelfareGuidance()` starts from the copy built into the app (`useWelfareGuidance.ts:22`), so **the vet list shows without signal**. It refreshes from the server when online.
- **Not on this page:**
  - `MunicipalityCard`, which belongs to the urgent costs explanation;
  - the vets' map buttons don't change. Without signal they open the map app, which may have no tiles.

### 3.3 How the app works

- Heading: "How Cat Spotters works".
- **Folds.** `Fold` is a private function inside `UrgentAdvice.tsx:30`. It moves to `components/report/Fold.tsx` and is exported.
  - It gains a `tone` prop: `urgent` (today's urgent-primary border, the default, so `UrgentAdvice` doesn't change) or `plain` (the ordinary card border).
  - These folds use `plain`, are closed by default, and have these icons:
    - **"Spotting cats"** (Feather `camera`): the four onboarding steps, reusing their strings: `howStepSpot`/`Body`, `howStepDontFeed`/`Body`, `howStepCatalog`/`Body`, `howStepHelp`/`Body`.
    - **`howSafetyTitle`** ("Look, don't touch.", Feather `eye`): the safety step, reusing `howSafetyLiveHere`, `howSafetyDistance`, `howSafetyLeaveBe` and `howSafetyHurt`. Its heading is the existing key, so no new string.
- **The "desex" fix (SYC-348).** Two of the reused English strings say "desex". The app's word is "sterilise", and they now appear in a second place, so they change:
  - `howStepDontFeedBody`: "…crowd colonies faster than we can sterilise them…";
  - `howStepHelpBody`: "Your spots help us sterilise and vaccinate the colonies."

  The Greek and French already say sterilise. Any other "desex" in SYC-348's list stays on that ticket.
- Static text, so it works without signal.

### 3.4 Contact us

- Heading: "Contact us".
- One line: "Questions about the app, or something not working? Email us."
- Button: "Email us". It opens `mailto:hello@catspotters.com?subject=…&body=…`, with both parts encoded with `encodeURIComponent`. `URLSearchParams` is not used, because iOS Mail shows its `+` signs.
  - **subject:** "Cat Spotters app" in the app's language;
  - **body:** two blank lines, then "App {version} · {platform}".
    - The version comes from `Constants.expoConfig?.version`, which is "1.0.0" from `app.json` today.
    - The platform is "iOS", "Android" or "web".
  - Nothing else goes in the email: no device ID, no location, no spotter name.
- Under the button, the address is shown as **selectable text**, so it can always be copied.
- If `Linking.openURL` rejects, a line says "Couldn't open your email app. You can copy the address above." That rarely happens: iOS offers to restore Mail, and the web never rejects. The address is always on screen anyway.
- Without signal, the email app opens as usual and sends when the phone is back online. That is the email app's job; the app doesn't promise it.

### 3.5 Privacy

- Heading: "Your privacy".
- One line: "What we collect, why, and how to delete it."
- Two links:
  - **"Read our privacy policy"** opens `https://catspotters.com/privacy`. That is the same address the report's email screen (`ReportWizard.tsx:64`) and every email already use.
  - **"Delete my data"** opens `/delete-my-data`, the screen Profile already links to. It reuses Profile's `deleteMyDataRow` label.
- **Dependency, checked live on 21 Oct 2026:** `https://catspotters.com/privacy` returns **404**. The privacy policy is SYC-66, still in Backlog. The link is already broken in the report flow and in emails, and Google Play needs the page before release. This spec doesn't publish it; see §9.
- Without signal, the policy link shows a muted "Needs an internet connection" line instead of opening a browser that will fail. "Delete my data" is unchanged: that screen already handles being offline.

### 3.6 Giving

The page picks one of three states:

| Situation | What the page shows |
|---|---|
| **A. In-app campaign open:** online, and `GET /api/campaign` returns a campaign with a valid `donateUrl` (`safeDonateUrl`) | The campaign card. Today's progress, stats, amount chips and Donate button, moved into a plain card at the bottom with no gradient hero. "Be the first to chip in!" may show here, and only here. |
| **B. Donations link on:** not state A, and the app's saved settings have `feedNudge.donateHost` | A small card. Heading: "Support Syros Cats". Line: "Every sterilisation costs €50–60 a cat. Donations go straight to Syros Cats." Button: "Give on {host}", which opens `/api/go/give` (§3.7). Under it: "Opens {host} in your browser". |
| **C. Neither** | Nothing. The giving section isn't shown. |

- **"Not state A" covers every case where the campaign isn't usable:**
  - offline;
  - still loading;
  - an error, including the 503 `campaign_misconfigured`;
  - a campaign with no valid `donateUrl`.

  So the page shows state B or C at once and swaps to A only when a usable campaign arrives. There is never a spinner or an error in the giving section.
- **What goes away:**
  - `campaignNotOpenYet`, `campaignOffline` and `campaignError` are used only by `help.tsx`, so they are deleted in all three languages.
  - The "not open yet" message and its clash with "Be the first to chip in!" disappear.
- **State B offline.** It works from the settings the app saved last time (`AppSettingsProvider`, AsyncStorage). Without signal, the button is replaced by "Needs an internet connection".
- **Unchanged:**
  - A campaign is "open" whenever `CAMPAIGN_DONATE_URL` is set, even after `endsAt` (`lib/campaign.ts:74-75`). This spec keeps that.
  - DECISIONS.md B1 puts a vaccinated count "under the campaign". It stays inside the state A card when that is built.
- **Order.** The giving section is **last** on the page by design (Decision 1). Help comes before asking for money.

### 3.7 The donations link route

- **New route:** `GET /api/go/give`. It redirects 302 to the same `feed_nudge_donate_url` setting that `/api/go/feed` uses, with the same headers (`no-store`, `no-referrer`) and the same link-off page when the setting is empty.
- **It must get past the pre-launch gate.** The gate is on in production by default (`lib/prelaunch.ts:29-33`). It lets through only GET/HEAD on exactly `/api/healthz` and `/api/go/feed` (`middlewares/prelaunchGate.ts:105-107`). A donor's browser has no pass, so `/api/go/give` is added to that exact-path list. Nothing broader is added: no prefix or pattern.
- **Why not reuse `/api/go/feed`?** That route counts taps into `donation_link_taps` to measure the feeding nudge (SYC-36). Taps from this page would inflate that measure.
- **Not counted in this version.** `/api/go/give` keeps nothing. Counting taps per source needs a source column on the counter table, and is filed as a follow-up (§9).
- `lib/api-spec/openapi.yaml` gains `/go/give` next to `/go/feed` (line 742).

### 3.8 Layout and access

- On first load, the page reads top to bottom in §3.1–§3.6 order and starts scrolled to the top.
- Checked at 390px and desktop width, in light and dark mode, in all three languages.
- Every button and link has an accessibility role and label.
- After the `OfflineBanner` (when it shows), the urgent card's button is the first focusable element.

---

## 4. Reports that know the cat (SYC-504)

### 4.1 What the reporter sees

- On a cat's page, "This cat needs help" opens the report with the cat attached.
- **Only the first screen changes.** At the top of **Where's the cat?**, a one-line strip shows:
  - a small round thumbnail of the cat's page photo;
  - **"About Tigris"**.
  - Offline, or if the image doesn't load, the thumbnail falls back to the app's paw placeholder. The strip never waits for it.
- Under it is a quiet link, **"It's a different cat"**. Tapping it removes the cat from this report: the strip disappears and the report carries on as an ordinary one.
  - It cannot be undone within this report. The reporter can go back to the cat's page and start again.
- **The other screens don't change.** That includes severity, email and the advice before sending. The advice still fits a 390×844 phone without scrolling (Samuel, 2 Oct; `reportFlow.ts:2-3`). The strip goes only on Where, which already scrolls around its map, and is checked by hand at 390×844.
- **The map still starts where the reporter is (Decision 5).** The cat's page area is never handed to the map.
- **No photo is handed over.** The cat's page photo is not a picture of what is wrong now. The thumbnail is for recognition only and is never sent with the report.

### 4.2 Where the cat is carried

| Place | Change |
|---|---|
| `lib/reportHandoff.ts` | `ReportHandoff` gains `cat?: { id: number; name: string; photoUrl: string \| null }`. `cats.name` is never null (`schema/cats.ts:18`). |
| `components/report/NeedsHelpLink.tsx` | Gains an optional `cat` prop that goes into the handoff. Without it, nothing changes. |
| `app/cat/[id].tsx:285` | Passes `cat={{ id: cat.id, name: cat.name, photoUrl: cat.photoUrl }}`. |
| `components/report/ReportIssueSheet.tsx:140-143` | The sheet is always about a known cat (`catId: number` and `catName: string` are required props, l.74-75), so `goToNeedsHelp` always hands over `{ id: catId, name: catName, photoUrl: null }`. The strip shows the paw placeholder. |
| `lib/reportFlow.ts` | The flow state holds the cat. "It's a different cat" sets it to none. Back and forward keep whatever is current. |
| `app/report.tsx:149-158` and `context/ReportQueueContext.tsx:309-323` | The draft carries `catId` (the current one, or null). It is part of what changes the draft, so clearing the cat after a draft was sent sends a new draft with null. |
| `lib/reportQueue.ts` `newPendingReport` (143-171) and `isPendingReport` | The report saved on the phone or in the browser keeps `catId`. On reading it back, a `catId` that isn't a positive integer is treated as none. Reports queued by an older version have none, and still send. |
| `context/ReportQueueContext.tsx:103` | The submit body gains `catId`: a number when there is a cat, `null` when it was cleared or never set. |

### 4.3 What the server keeps

- **Reports aren't tied to the cat automatically.**
  - The team's "Which cat is this?" tie (`lib/welfareTie.ts`) does more than set `cat_id`. It writes a `welfare_report` observation on the cat, which feeds the cat's history and its evidence of life.
  - A member of the public tapping the wrong cat's page must not write that history. So the reporter's cat is kept as a **suggestion**, and a team member confirms it (§4.4).
- **New column:** `welfare_reports.reporter_cat_id`. A nullable integer, in migration **0036** (`0036_report_suggested_cat.sql`). The number is claimed with the SYC-396 PR 3.3a session, which has 0035.
  - **No foreign key**, matching `cat_id` on the same table (`schema/welfare.ts:67`). Cats are never deleted in production code, and a dangling id simply shows no suggestion.
  - Additive migration: no existing row changes. It has the usual commented `-- rollback-begin/end` block (`lib/db/migrations/README.md` step 3).
- **`POST /api/reports/draft` (`DraftBody`, `reports.ts:96-104`) and `POST /api/reports` (`SubmitBody`, `reports.ts:106-120`)** both gain:
  `catId: z.coerce.number().int().positive().max(999_999_999).nullable().optional().catch(null)`.
  A bad value becomes null, and the report is still accepted.
- **The check.**
  - Each route looks the cat up by id (`select id from cats where id = $1`).
    - Submit does it inside its existing transaction.
    - The draft route has no transaction, so it does a plain read.
  - If the cat exists, `reporter_cat_id` is set to it; otherwise it is null.
  - There is no other visibility rule to apply: `GET /api/cats/:id` only checks that a cat exists (`cats.ts:167-184`). A suggestion is allowed for any cat, including one with a home: its page is public, and the suggestion only reaches the team.
  - A report is never refused because of the cat.
- **Both upserts set the column explicitly, including null.** The draft upsert and the submit upsert (`reports.ts:341-356`) both list `reporterCatId` in their `set`. So a cleared cat overwrites the draft's suggestion.
- **What stays the same:**
  - A resend of an already-sent report returns early, as today (`reports.ts:308-311`), and changes nothing.
  - `cat_id` is still never set by these routes.
- **The team's alert email is unchanged.** The queue card is where the suggestion shows. 0.1 proposed a line naming the cat; it is dropped for two reasons:
  - the alert carries exact coordinates through the mail provider, and SYC-209/SYC-245 already hold back map links near feeding sites for exactly that exposure, so a named cat next to an exact spot adds to it;
  - a name rendered live would change the body between retries, and Resend refuses that under the same idempotency key (`outbox.ts:697-718`).
- **Privacy:** the cat's id and name are already public on its page. No new information about the reporter is kept, and the suggestion is shown only on team pages.

### 4.4 What the team sees

`QueueReport` and the queue loader (`lib/welfareQueue.ts`) gain `suggestedCat: { id, name, photoUrl } | null`. It comes from a left join on `reporter_cat_id`, the same way `cat` is joined today. The team JSON route returns it too.

**The queue card's Which cat row** (`catRow`, `teamPages/queuePage.ts`):

| Report state | Row shows |
|---|---|
| Tied, and the suggestion is the same cat or none | As today: the cat's name, linked, plus "Wrong cat? Choose another". |
| Tied to a **different** cat than the suggestion | As today, plus a muted line "Sent from Tigris's page". |
| Not tied, with a suggestion | "Sent from **Tigris**'s page", with the suggested cat's thumbnail beside the report's own photo, if it has one, so the team can compare. The name links to the team cat page. Below: **"Yes, it's Tigris"** and "Choose another cat". |
| Not tied, no suggestion | As today: "Match to a known cat". |

- **"Yes, it's Tigris"** is a small form that posts to the existing tie route, `POST /team/reports/:publicId/cat`.
  - It sends `catId` (the suggestion) and an empty `expectedCatId`.
  - The same origin check and `change_report_state` capability apply, and it gets the same `tied=ok` notice.
  - The tie does everything it does today; nothing else is written.
- **Who sees the button:**
  - The queue itself needs only `view_welfare_queue` (`team.ts:184`).
  - The Yes form is rendered only for people who also have `change_report_state`.
  - Everyone else sees the suggestion line and thumbnails, with no button.
- **Escaping.** The cat's name is HTML-escaped everywhere it appears, including inside the button label.
- **"Choose another cat"** opens the existing `/api/team/cats?tie=<id>` search.
- **Drafts.** `draftCard` (`queuePage.ts:262-269`) gains the "Sent from Tigris's page" line, with no buttons. The tie refuses drafts (`welfareTie.ts:97-102`).
- **Language.** Team pages are English-only today (`queuePage.ts`), so these words are English.

---

## 5. Words

New and changed visitor-facing strings, with draft Greek and French. All of them go to **Johnny's review pack (SYC-346, copy freeze Thu 22 Oct)**. If this misses the freeze, the Greek and French ship as drafted and are flagged for his next pass, as with SYC-4.

| Key | EN | EL (draft) | FR (draft) |
|---|---|---|---|
| `tabHelp` (changed) | Help & info | Βοήθεια (unchanged) | Aide |
| `helpInfoTitle` | Help & info | Βοήθεια και πληροφορίες | Aide et infos |
| `helpCatHeading` | Found a cat that's hurt, sick or in danger? | Βρήκες γάτα τραυματισμένη, άρρωστη ή σε κίνδυνο; | Tu as trouvé un chat blessé, malade ou en danger ? |
| `helpCatButton` | A cat needs help | Μια γάτα χρειάζεται βοήθεια | Un chat a besoin d'aide |
| `helpVetsHeading` | Vets on Syros | Κτηνίατροι στη Σύρο | Vétérinaires à Syros |
| `helpHowHeading` | How Cat Spotters works | Πώς λειτουργεί το Cat Spotters | Comment marche Cat Spotters |
| `helpHowSpotting` | Spotting cats | Εντοπισμός γατών | Repérer les chats |
| `helpContactHeading` | Contact us | Επικοινωνία | Nous contacter |
| `helpContactBody` | Questions about the app, or something not working? Email us. | Έχεις ερώτηση για την εφαρμογή ή κάτι δεν δουλεύει; Στείλε μας email. | Une question sur l'appli, ou quelque chose ne marche pas ? Écris-nous. |
| `helpContactButton` | Email us | Στείλε μας email | Nous écrire |
| `helpContactSubject` | Cat Spotters app | Εφαρμογή Cat Spotters | Appli Cat Spotters |
| `helpContactFailed` | Couldn't open your email app. You can copy the address above. | Δεν άνοιξε η εφαρμογή email. Μπορείς να αντιγράψεις τη διεύθυνση από πάνω. | Impossible d'ouvrir ton appli mail. Tu peux copier l'adresse ci-dessus. |
| `helpPrivacyHeading` | Your privacy | Το απόρρητό σου | Ta vie privée |
| `helpPrivacyBody` | What we collect, why, and how to delete it. | Τι συλλέγουμε, γιατί, και πώς να το διαγράψεις. | Ce que nous collectons, pourquoi, et comment le supprimer. |
| `helpPrivacyPolicy` | Read our privacy policy | Διάβασε την πολιτική απορρήτου | Lire notre politique de confidentialité |
| `helpNeedsInternet` | Needs an internet connection | Χρειάζεται σύνδεση στο ίντερνετ | Connexion internet nécessaire |
| `helpGiveHeading` | Support Syros Cats | Στήριξε τις Syros Cats | Soutenir Syros Cats |
| `helpGiveBody` | Every sterilisation costs €50–60 a cat. Donations go straight to Syros Cats. | Κάθε στείρωση κοστίζει 50–60 € ανά γάτα. Οι δωρεές πηγαίνουν κατευθείαν στις Syros Cats. | Chaque stérilisation coûte 50 à 60 € par chat. Les dons vont directement à Syros Cats. |
| `helpGiveButton` | Give on {host} | Κάνε δωρεά στο {host} | Donner sur {host} |
| `reportAboutCat` | About {name} | Σχετικά με: {name} | À propos de {name} |
| `reportDifferentCat` | It's a different cat | Είναι άλλη γάτα | C'est un autre chat |

**Changed strings:**
- `feedNudgeInsteadNoLink`: the last sentence is dropped (§2.1).
- `howStepDontFeedBody` and `howStepHelpBody` (EN): "desex" becomes "sterilise" (§3.3).
- `LINK_OFF_PAGE` body: changed in `go.ts` (§2.1).

**Removed:** `campaignNotOpenYet`, `campaignOffline` and `campaignError`.

**Reused unchanged:**
- `deleteMyDataRow`;
- `howSafetyTitle` and the safety and step strings;
- `campaignOpensAt` ("Opens {host} in your browser").

**Rules:**
- Words follow the canonical facts: cat guardian, spotter, sterilise, and €50–60 a cat.
- French uses *tu* (the i18n test enforces it). "Nous contacter" and "Nous écrire" are about us, not vous-address.
- The Greek "Σχετικά με: {name}" uses a colon, so no article or gender has to agree with the cat's name.
- Greek capitals carry no accents (SYC-159).
- Placeholders match across languages, which the i18n test checks.

---

## 6. Tests

**App** (`pnpm --filter cat-spotter test`):
- A new `HelpInfoScreen.test.tsx`:
  - section order;
  - the urgent button opens `/report` with no handoff;
  - vets render from built-in guidance with no network;
  - `mailto:` has the right address, the encoded subject and the version/platform line, and no device ID;
  - with a mocked rejecting `openURL`, the copy line shows;
  - giving states A, B and C, including: loading gives B or C, not a spinner; a 503 gives B or C; offline B shows "Needs an internet connection";
  - "Be the first to chip in!" appears only in state A;
  - the privacy link offline.
- `Fold.test.tsx`: `tone` defaults to `urgent`. `ReportAdvice.test.tsx` stays green unchanged.
- `NeedsHelpLink.test.tsx`: a `cat` prop lands in the handoff, and without it the handoff is unchanged.
- `reportHandoff.test.ts` and `reportFlow.test.ts`: the cat is carried, and "It's a different cat" clears it and survives Back.
- `reportQueue.test.ts`:
  - `catId` is in the submit body as a number, or `null` when cleared;
  - an item queued in the old format still sends;
  - a stored non-integer `catId` is treated as none.
- `ReportWizard.test.tsx`: the strip on Where only, the placeholder when there's no photo, and the different-cat link removes it.
- `ReportIssueSheet` test: "needs help" hands over the sheet's cat, with no photo.
- `i18n.test.ts`: the existing key-parity, placeholder and *tu* checks cover the new strings and the removals.
- The FeedNudge and WaitingCard tests are renamed, and their no-link copy assertion is updated.

**API** (`pnpm --filter api-server test`):
- `reports.test.ts`:
  - a valid `catId` sets `reporter_cat_id` and leaves `cat_id` null;
  - an unknown or garbage `catId` gives null and a 201;
  - **a draft with a cat, then a submit with `catId: null`, ends null**;
  - a resend of a sent report changes nothing;
  - the draft route stores and clears the suggestion the same way.
- `go.test.ts`:
  - `/api/go/give` gives a 302 to the setting;
  - the link-off page shows the new copy in EN, EL and FR when the setting is empty;
  - **nothing is written to `donation_link_taps`**.
- `prelaunchGate.test.ts` §10b:
  - `/api/go/give` passes with no cookie on GET and HEAD;
  - `/api/go/give/`, `/api/go/givex`, `//go/give` and a POST are all refused, as with `/go/feed`.
- Queue page:
  - the Which-cat row in all four states;
  - the Yes form is present only with `change_report_state`;
  - a name containing `<script>` is escaped in the line and the button;
  - the draft card's line.
- `team.tie.test.ts`: the Yes form's post ties the report and writes exactly one observation, the same as a tie from search.
- The welfare queue JSON route includes `suggestedCat`.
- The migration passes `migrate:check` and its rollback test.

**By hand, before the PR leaves draft:**
- Help & info at 390px and desktop, light and dark, in EN, EL and FR, on all three tab variants.
- Where's the cat?, with the strip, at 390×844.
- A report from a cat's page, sent end to end against a local API and seen on the local queue page, then tied with Yes.

---

## 7. Rollout

1. **The migration goes to production first.** `reporter_cat_id` is applied to Neon before Samuel republishes. The new API code writes it, so it's "don't republish yet" until it is applied.
2. The app and API ship together in one PR. The column is additive and the new body field is optional, so it doesn't matter which order phones update in:
   - an older app sends no `catId`;
   - a newer app reaching an older API has `catId` stripped by `z.object`.
3. The OpenAPI file and the generated clients are part of the PR.
4. After republish:
   1. `/api/healthz` shows the new commit.
   2. `curl -sI https://<test host>/api/go/give` with no cookie gives a **302** to syroscats.com, not a 401.
   3. Help & info opens on the test site.
   4. **Heads-up first: this creates one test report on the test site.** One report is sent from a cat's page, its suggestion is seen on the team queue, and it is tied.

---

## 8. What this doesn't change

- The report's steps, severity advice, email step and send queue, apart from carrying the cat.
- The campaign's own rules (open while `CAMPAIGN_DONATE_URL` is set) and the `/api/go/feed` counter.
- The welfare alert email.
- The team tie route and what a tie writes.

---

## 9. Follow-ups to file

- **SYC-66:** publish the privacy policy. The link is a 404 today (checked 21 Oct). It already blocks Play release; this page adds one more place that links to it.
- **New:** count Help & info donation taps separately from the feeding nudge, with a source column on `donation_link_taps`.
- **New (optional):** a short FAQ on Help & info, once Syros Cats know what people ask through Contact us.
- **SYC-30** (admin@syroscats.com as a second recipient of hello@) stays separate. Until it lands, only our inbox sees Contact us emails.
- **SYC-512, partly answered:** the vets now have a permanent home on Help & info. Its other two items stay on that ticket.
- **SYC-348:** this spec fixes the two onboarding strings. Anything else on that ticket stays there.

---

## 10. Review findings and where they are handled

| # | Severity | Finding | Where |
|---|---|---|---|
| 1 | Blocker | `/api/go/give` would 401 behind the pre-launch gate | §3.7, §6, §7 |
| 2 | Major | The nudge and link-off copy pointed at a tab that shows nothing about giving | §2.1 |
| 3 | Major | Clearing the cat after a draft left a stale suggestion | §4.2, §4.3, §6 |
| 4 | Major | No "visible to the public" rule exists for cats | §4.3, §6 |
| 5 | Major | Alert email line: retry idempotency, English-only, feeding-site exposure | §4.3 (line dropped) |
| 6 | Major | Handoff lacked a photo; names are never null; no summary screen; must fit 390×844 | §4.1, §4.2, §6 |
| 7 | Major | One tap on an unverified public suggestion | §4.4 (thumbnails, capability, escaping, `QueueReport`) |
| 8 | Major | Drafts don't show what the spec claimed | §4.4 |
| 9 | Major | Wrong files and schemas named for draft and queue | §4.2, §4.3 |
| 10 | Minor | `Fold` is private | §3.3 |
| 11 | Minor | `VetList` takes `guidance` as a prop | §3.2 |
| 12 | Minor | Classic iOS tabs not covered | §2 |
| 13 | Minor | Incomplete list of Help-tab mentions; EL wording needn't change | §2, §2.1 |
| 14 | Minor | Giving states underspecified; hero padding; unused strings; B1 | §3.6 |
| 15 | Minor | No Greek/French drafts; duplicate safety heading; "desex"; Greek article | §3.3, §5 |
| 16 | Minor | Team pages are English-only | §4.4 |
| 17 | Minor | Suggestion kept after a tie wasn't visible | §4.4 |
| 18 | Minor | FK inconsistent with `cat_id`; rollback block | §4.3 |
| 19 | Minor | mailto encoding, failure path, platform "web" | §3.4 |
| 20 | Minor | Browser vs phone wording; first focus vs the offline banner | §3.1, §3.8 |
| 21 | Minor | Missing tests | §6 |
| 22 | Minor | Missing rollout steps (client regeneration, gate probe) | §7 |
