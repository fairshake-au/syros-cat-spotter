# Help & info: a tab that helps, and reports that know the cat

**Feature spec · Cat Spotters (Syros)**
**Version:** 0.1, draft for adversarial review · 21 October 2026
**Covers:**
- SYC-120: rename the "Help" tab and add app support.
- SYC-504: "This cat needs help" opened from a cat's page doesn't tell Syros Cats which cat it is.

**Evidence:**
- The 29 September user-testing call (SYC-116). People expected "Help" to mean help with the app, but it opened the donations page.
- The 18 October public-app UX review (SYC-501). A visitor with a hurt cat who taps "Help" is asked to fund a sterilisation round. From there they can't reach the report, the vets, a contact or privacy.

**Decisions already made (Samuel, 21 October 2026, recorded on the tickets):**
1. The heart tab becomes a **Help & info** hub.
2. Its icon is a **question mark in a circle**.
3. **Contact us** opens the phone's email app, addressed to hello@catspotters.com.
4. While in-app donations aren't open, the giving part **links to Syros Cats' own donations page**.
5. A report sent from a cat's page **knows the cat**, but its map **still starts where the reporter is**. The map never shows where a cat is usually fed.

**Status:** Draft. Not yet reviewed or approved.

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
  5. *What happens to my information?* Privacy.
  6. *How can I give?* Syros Cats' donations page, or the in-app campaign once donations open.
- A report started from a cat's page says **"About Tigris"** at the top, with **"It's a different cat"** underneath. The team's queue card shows "Sent from Tigris's page" with a one-tap **"Yes, it's Tigris"**.

---

## 2. The tab

| | Today | After |
|---|---|---|
| Icon (iOS) | `heart` / `heart.fill` | `questionmark.circle` / `questionmark.circle.fill` |
| Icon (Android, web) | Feather `heart` | Feather `help-circle` |
| Tab label `tabHelp` | EN "Help" · EL "Βοήθεια" · FR "Aider" | EN "Help & info" · EL "Βοήθεια" · FR "Aide" |
| Page title (new key `helpInfoTitle`) | (the campaign title) | EN "Help & info" · EL "Βοήθεια και πληροφορίες" · FR "Aide et infos" |

- **Why the Greek tab label stays "Βοήθεια".** It means "help" in the sense of assistance, which is now correct. "Βοήθεια και πληροφορίες" is too long for a tab bar with five tabs at 390px, so the longer form is the page title.
- **Why the French label changes.** "Aider" is the verb "to help", which reads as a call to give. "Aide" is the noun, the help you get.
- **The route keeps its name.** The file stays `app/(tabs)/help.tsx` and the tab stays `name="help"`. Nothing links to it by route, so the rename is only the label, the icon and the content.
- **Two other places name the tab, and both change to the new name:**
  - `feedNudgeInsteadNoLink` in all three languages ("The Help tab shows how to give").
  - `LINK_OFF_PAGE` in `api-server/src/routes/go.ts`, the page shown when the donations link is off.
- **Label length is checked by hand, not assumed.** All three labels are checked at 390px on iOS (native tabs) and Android/web (classic tabs), in light and dark mode. If "Help & info" truncates, the EN tab label falls back to "Help" and the page title keeps "Help & info".

---

## 3. The Help & info page

One scrolling page. Each section has a short heading and is built from parts the app already has wherever possible.

### 3.1 A cat needs help

- A full-width card at the top, in the same urgent styling as the report's Urgent advice.
  - Heading: "Found a cat that's hurt, sick or in danger?"
  - Button: "A cat needs help". It opens `/report` with nothing handed over, the same as the link on the Cats tab.
- The report already works without signal: it is saved on the phone and sent when there is a connection. This page adds nothing to that.

### 3.2 Vets

- Heading: "Vets on Syros".
- The existing `VetList` component (`components/report/VetList.tsx`) in its full form: one card per clinic, with tap-to-call, map and the area.
- It reads `useWelfareGuidance()`. That starts from the copy built into the app, so **the vet list shows without signal**. It refreshes from the server when online.
- `MunicipalityCard` is not repeated here. It belongs to the urgent costs explanation.

### 3.3 How the app works

- Heading: "How Cat Spotters works".
- Two folded sections (the app's existing `Fold`), closed by default:
  - **"Spotting cats"**: the four onboarding steps, reusing their strings exactly: `howStepSpot`/`Body`, `howStepDontFeed`/`Body`, `howStepCatalog`/`Body` and `howStepHelp`/`Body`.
  - **"Look, don't touch"**: the safety step, reusing `howSafetyTitle`, `howSafetyLiveHere`, `howSafetyDistance`, `howSafetyLeaveBe` and `howSafetyHurt`.
- These reuse existing translated strings, so Johnny has nothing new to review here.
- Static text, so it works without signal.

### 3.4 Contact us

- Heading: "Contact us".
- One line: "Questions about the app, or something not working? Email us."
- Button: "Email us". It opens `mailto:hello@catspotters.com` with:
  - **subject:** "Cat Spotters app" in the app's language;
  - **body:** two blank lines, then a line with the app version and platform, for example "App 1.0.0 · iOS". The version comes from `Constants.expoConfig?.version` (`expo-constants` is already a dependency).
  - Nothing else goes in the email: no device ID, no location, no spotter name.
- Under the button, the address is shown as **selectable text**, so it can be copied on a phone with no email app set up.
- If `Linking.openURL` fails, a short line says "Couldn't open your email app. You can copy the address above."
- Without signal, the email app opens as usual and sends the message when the phone is back online. The app doesn't promise any more than that.

### 3.5 Privacy

- Heading: "Your privacy".
- One line: "What we collect, why, and how to delete it."
- Two links:
  - **"Read our privacy policy"** opens `https://catspotters.com/privacy`. That is the same address the report's email screen and every email already use.
  - **"Delete my data"** opens the existing `/delete-my-data` screen (today it is only reachable from Profile).
- **Dependency, checked live on 21 Oct 2026:** `https://catspotters.com/privacy` returns **404**. The privacy policy is SYC-66, still in Backlog. The link is already broken in the report flow and in emails, and Google Play needs the page before release. This spec doesn't publish it; see §8.
- Without signal, the policy link shows a muted "Needs an internet connection" line instead of opening a browser that will fail.

### 3.6 Giving

The page picks one of three states:

| What the server says | What the page shows |
|---|---|
| The in-app campaign is open (`GET /api/campaign` returns a valid `donateUrl`) | Today's campaign card, unchanged: progress, amounts and Donate. |
| No campaign, but the donations link is on (`/api/app-settings` returns `feedNudge.donateHost`) | A small card. Heading: "Support Syros Cats". Line: "Every sterilisation costs €50–60 a cat. Donations go straight to Syros Cats." Button: "Give on {host}", which opens the new `/api/go/give` (§3.7). Under it: "Opens {host} in your browser". |
| Neither | Nothing. The giving section isn't shown. |

- **The contradictory pair goes.** "Be the first to chip in!" now shows only inside the open campaign card, never next to "Donations aren't open yet". The "not open yet" message is no longer shown anywhere on this page.
- **Offline:**
  - The donations-link card works from the settings the app saved last time (`AppSettingsProvider` keeps them on the phone). Without signal, its button shows "Needs an internet connection".
  - The campaign card, which needs a live campaign, is replaced offline by the donations-link card when the link is on, or else by nothing.
- The giving section is **last** on the page by design (Decision 1). Help comes before asking for money.

### 3.7 The donations link route

- **New route:** `GET /api/go/give`. It redirects 302 to the same `feed_nudge_donate_url` setting that `/api/go/feed` uses, with the same headers (`no-store`, `no-referrer`) and the same link-off page when the setting is empty.
- **Why not reuse `/api/go/feed`?** That route counts taps into `donation_link_taps` to measure the feeding nudge (SYC-36). Taps from the Help & info page would inflate that measure.
- **Not counted in this version.** `/api/go/give` keeps nothing. Counting taps per source needs a change to the counter table, and is filed as a follow-up (§8).

### 3.8 Layout rules

- On first load, the page reads top to bottom in §3.1–§3.6 order and starts scrolled to the top.
- Checked at 390px and desktop width, in light and dark mode, in all three languages.
- Every button and link has an accessibility role and label. The urgent card's button is the first focusable element.

---

## 4. Reports that know the cat (SYC-504)

### 4.1 What the reporter sees

- On a cat's page, "This cat needs help" opens the report with the cat already attached.
- At the top of the **Where's the cat?** screen, a strip shows the cat's photo thumbnail and **"About Tigris"**. If the cat has no name, it shows its code ("About SYR-0004").
- Under it is a quiet link, **"It's a different cat"**. Tapping it removes the cat from this report. The strip disappears and the report carries on as an ordinary one. It cannot be undone within this report; the reporter can go back to the cat's page and start again.
- The cat's name also shows in the **Before you send** summary ("About Tigris").
- **The map still starts where the reporter is (Decision 5).** The cat's page area is never handed to the map.
- **Nothing else changes.** No photo is handed over: the cat's page photo is not a picture of what is wrong now. Severity, kittens, note, email and the advice screens are the same.

### 4.2 Where the cat is carried

| Step | Change |
|---|---|
| `lib/reportHandoff.ts` | `ReportHandoff` gains `cat?: { id: number; name: string \| null }`. |
| `components/report/NeedsHelpLink.tsx` | Gains an optional `cat` prop that goes into the handoff. Without it, nothing changes. |
| `app/cat/[id].tsx` | Passes `cat={{ id: cat.id, name: cat.name }}`. |
| `components/report/ReportIssueSheet.tsx` | `goToNeedsHelp` passes the cat too, when the issue being reported is about a known cat. |
| `lib/reportFlow.ts` | The flow state holds the cat; "It's a different cat" clears it. |
| `lib/reportQueue.ts` | The queued report saved on the phone keeps `catId`. The POST body gains `catId` (a number, or left out). Reports already in a queue from an older version have none, and still send. |
| Draft (`POST /api/reports/draft`) | Carries `catId` the same way, so a draft the team can see already names the cat. |

### 4.3 What the server keeps

- **Reports aren't tied to the cat automatically.**
  - The team's "Which cat is this?" tie (`lib/welfareTie.ts`) does more than set `cat_id`. It writes a `welfare_report` observation on the cat, which feeds the cat's history and evidence of life.
  - A member of the public tapping the wrong cat's page should not write that history. So the reporter's cat is kept as a **suggestion**, and the team confirms it with one tap.
- **New column:** `welfare_reports.reporter_cat_id`. Nullable integer, foreign key to `cats.id` with `ON DELETE SET NULL`. An additive migration: no existing row changes.
- **`POST /api/reports` and `/api/reports/draft`:**
  - `SubmitBody` gains `catId: z.coerce.number().int().positive().max(999_999_999).nullable().optional().catch(null)`. A bad value is dropped and the report is still accepted.
  - Inside the existing transaction, the route checks that the cat exists and is one the public can see (the same visibility rule as `GET /api/cats/:id`). If it is, `reporter_cat_id` is set; if not, it is set to null. A report is never refused because of the cat.
  - `cat_id` is still never set by this route.
- **Alert email to the team:** gains one line, "Sent from Tigris's page (SYR-0004)", in the team's language. Only for reports that have a suggested cat.
- **Privacy:** the cat's id and name are already public on its page. No new information about the reporter is kept.

### 4.4 What the team sees

- On the queue card's **Which cat** row (`catRow` in `teamPages/queuePage.ts`):

| Report state | Row shows |
|---|---|
| Tied (`cat_id` set) | As today: the cat's name, linked, plus "Wrong cat? Choose another". |
| Not tied, with a suggestion | "Sent from **Tigris**'s page", the name linked to the team cat page. Buttons: **"Yes, it's Tigris"** and "Choose another cat". |
| Not tied, no suggestion | As today: "Match to a known cat". |

- **"Yes, it's Tigris"** is a small form that posts to the existing tie route, `POST /team/reports/:publicId/cat`, with `catId` = the suggestion and `expectedCatId` empty. It needs the same `change_report_state` capability and gets the same `tied=ok` notice. Nothing new is written by hand: the tie does everything it does today.
- **"Choose another cat"** opens the existing `/api/team/cats?tie=<id>` search.
- The suggestion is kept after a tie, so the record shows what the reporter pointed at even if the team chose another cat.

---

## 5. Words

New English strings, with draft Greek and French. All visitor-facing Greek and French goes to **Johnny's review (SYC-346, copy freeze Thu 22 Oct)**. If this misses the freeze, the strings ship in English-reviewed form with the Greek and French flagged for his next pass, as with SYC-4.

| Key | EN |
|---|---|
| `tabHelp` (changed) | Help & info |
| `helpInfoTitle` | Help & info |
| `helpCatHeading` | Found a cat that's hurt, sick or in danger? |
| `helpCatButton` | A cat needs help |
| `helpVetsHeading` | Vets on Syros |
| `helpHowHeading` | How Cat Spotters works |
| `helpHowSpotting` | Spotting cats |
| `helpHowSafety` | Look, don't touch |
| `helpContactHeading` | Contact us |
| `helpContactBody` | Questions about the app, or something not working? Email us. |
| `helpContactButton` | Email us |
| `helpContactSubject` | Cat Spotters app |
| `helpContactFailed` | Couldn't open your email app. You can copy the address above. |
| `helpPrivacyHeading` | Your privacy |
| `helpPrivacyBody` | What we collect, why, and how to delete it. |
| `helpPrivacyPolicy` | Read our privacy policy |
| `helpPrivacyDelete` | Delete my data |
| `helpNeedsInternet` | Needs an internet connection |
| `helpGiveHeading` | Support Syros Cats |
| `helpGiveBody` | Every sterilisation costs €50–60 a cat. Donations go straight to Syros Cats. |
| `helpGiveButton` | Give on {host} |
| `reportAboutCat` | About {name} |
| `reportDifferentCat` | It's a different cat |
| `feedNudgeInsteadNoLink` (changed) | …The Help & info tab shows how to give. |

- Words follow the canonical facts: **cat guardian**, **spotter**, **sterilise**, and €50–60 a cat.
- French uses *tu*, as the i18n test enforces.
- Greek capitals carry no accents (SYC-159).
- The team-side strings (queue card, alert email line) follow the dashboard's existing language handling.

---

## 6. Tests

**App** (`pnpm --filter cat-spotter test`):
- A new `HelpInfoScreen.test.tsx`:
  - the section order;
  - the urgent button opens `/report`;
  - the vets render offline from built-in guidance;
  - `mailto:` has the right address, the subject and the version line, and no device ID;
  - the copy fallback shows when opening fails;
  - the three giving states;
  - "Be the first to chip in!" never shows next to "not open yet";
  - offline lines on privacy and giving.
- `NeedsHelpLink.test.tsx`: a `cat` prop lands in the handoff, and without it the handoff is unchanged.
- `reportHandoff.test.ts` and `reportFlow.test.ts`: the cat is carried, and "It's a different cat" clears it.
- `reportQueue.test.ts`:
  - `catId` is in the body when set and absent when not;
  - a queued item from the old format still sends.
- `ReportWizard.test.tsx`: the "About {name}" strip, the SYR fallback with no name, and that the different-cat link removes it.
- The existing `i18n.test.ts` key-parity and placeholder checks cover the new strings.

**API** (`pnpm --filter api-server test`):
- `reports.test.ts`:
  - a valid `catId` sets `reporter_cat_id` and leaves `cat_id` null;
  - an unknown, hidden or garbage `catId` gives null and a 201;
  - a resend keeps the first value;
  - the draft route behaves the same.
- `go.test.ts`:
  - `/api/go/give` redirects to the setting;
  - it shows the link-off page when the setting is empty;
  - it writes **nothing** to `donation_link_taps`.
- The queue page: the three Which-cat states.
- `team.tie.test.ts`: "Yes, it's Tigris" ties and writes exactly one observation, exactly as a tie from search does.
- The alert email line appears only for reports with a suggestion.

**By hand, before the PR leaves draft:**
- The Help & info page at 390px and desktop, light and dark, in EN, EL and FR.
- The tab label checked on native and classic tabs.
- A report from a cat's page, run end to end against a local API, seen on the local queue page.

---

## 7. Rollout

1. **The migration goes to production first.** `reporter_cat_id` is applied to Neon before Samuel republishes. The new API code writes the column, so the order matters ("don't republish yet" until it is applied).
2. The app and API ship together in one PR. The column is additive and the new body field is optional, so it doesn't matter which order phones update in:
   - an older app sends no `catId`;
   - a newer app reaching an older API has `catId` silently stripped.
3. After republish:
   - check `/api/healthz` shows the new commit;
   - open Help & info on the test site;
   - send one report from a cat's page;
   - see the suggestion on the team queue, then tie it.
   - **Heads-up before this step: it creates one test report on the test site.**

---

## 8. Out of scope, and follow-ups to file

- **SYC-66:** publish the privacy policy. Today's link is a 404 (checked 21 Oct). It already blocks Play release; this page adds one more place that links to it.
- **New ticket:** count Help & info donation taps separately from the feeding nudge. This needs a source column on `donation_link_taps`.
- **New ticket (optional):** a short FAQ on Help & info, once Syros Cats have the questions people actually ask through Contact us.
- **SYC-30** (admin@syroscats.com as a second recipient of hello@) stays separate. Contact us works without it, but until it lands only our inbox sees the email.
- **SYC-512 ("vets only inside an urgent report"):** partly answered, since the vets now have a permanent home on Help & info. Its other two items (two dates for one sighting, one-tap deletes) stay on that ticket.
