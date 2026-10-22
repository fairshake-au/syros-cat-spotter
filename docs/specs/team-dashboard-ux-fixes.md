# Team dashboard: four fixes from the 19 October review

Status: **approved by Samuel, 21 Oct 2026** ("Approve, as decided"), after one adversarial review and his eight decisions. Covers SYC-515, SYC-516, SYC-517 and SYC-519, children of SYC-514. Builds on the approved redesign (`team-dashboard-redesign.md`) and keeps all of its privacy rules. SYC-270 and SYC-518 were small copy and display fixes and are built already, without a spec.

Checked against `origin/main` at `7a2d83ff` (21 Oct). Merged since the redesign plan: PR 2.0, 2.1 (Home), 2.2 (Colonies list), 2.4 (named areas), 2.5 (Find from a photo), 3.0. Not merged yet: PR 2.3 (trapping planner), 2.6 (map layers), SYC-44 PR 7.1 (the Queue's Issues section). Nothing in this spec repeats those.

## 1. The short version

| Ticket | The problem, for the person using it | The fix |
|---|---|---|
| SYC-515 | One tap on **Done** or **Nothing needed** can email a member of the public, with no chance to check. | When an email would go, the tap opens a short "Are you sure?" page that shows the email. When no email would go, it stays one tap. |
| SYC-516 | A wrong address or a server hiccup shows `{"error":"Not found"}` on a blank page. An expired sign-in throws away what was typed and lands on Home. | A proper dashboard error page. An expired sign-in says "You were signed out", shows what was typed so it can be copied, and brings the person back to where they were after signing in. |
| SYC-517 | Places are shown as numbers like `37.44473, 24.94259`, including to cat guardians. | Place names everywhere ("Kini", "Vaporia"), with **Open map** for island-wide team members. Guardians never see numbers. Typing a position by hand is replaced by tapping a map. |
| SYC-519 | Every Queue card is a long form; empty and technical sections are always on. | One short line per report that opens to show the controls. Empty technical sections hidden. Plain words for the email rows. |

## 2. SYC-515: check before emailing the person who reported

**When an email would go.** Closing a report (Done or Nothing needed) sends the reporter one "About the cat you reported" email, but only if (a) they left an address, and (b) this report hasn't already sent its one outcome email. If they left an address but haven't confirmed it yet, the email is held: it goes when they confirm, but only if the report is still closed then, and **without** any extra line (the held email is the standard message only). Only welfare reports ever email the reporter; "Report an issue" rows never do.

One server function answers "what happens to the reporter if this closes?", with one of five answers. The Queue and the button press both use it:

| Answer | When | What the team sees |
|---|---|---|
| none | No address left, or it's an issue report | One tap, as today |
| already sent | This report sent its one email before (closed, reopened, closing again) | One tap, as today |
| will send | Address confirmed, nothing stopping it | The "Are you sure?" page, with the extra-line box on Done |
| held | Address not confirmed yet | The "Are you sure?" page, no box: "They haven't confirmed their email yet. If they do while this report is still closed, they get the standard message." |
| probably won't arrive | Address confirmed but our mail to it bounced or was refused | The "Are you sure?" page: "Our last email to them didn't arrive, so this one may not either." Box on Done |

**What changes.**

- For "will send", "held" and "probably won't arrive", Done and Nothing needed open a second page, the same kind the dashboard already uses before retiring a site:
  - Title: "Close this report and email the person who sent it?"
  - The email as it will read, word for word (it's the same fixed message for both: "Syros Cats has looked into this and taken appropriate action in response to your report. Thank you for taking action to help the cats of Syros to thrive.").
  - For **Done**, when the email will go now: the optional extra line box moves here from the Queue card, so it's written just before sending, with the email shown above it and the line shown in place.
  - Buttons: **"Close and send the email"** (for "held": **"Close the report"**) and **"Back to the Queue (nothing changed)"**.
- The answer is worked out again on the server when the button is pressed, not taken from what the page showed. If it changed in between (someone else closed it, or the person confirmed their address), the person lands back on the Queue with today's "Someone else changed this report a moment ago" line, and nothing is sent. The existing guard already makes sure the same report can never send twice.
- **"none" and "already sent":** one tap, as today.
- **New** and **Looking at it** never email and never ask.
- The app's own data routes (used by tests and scripts, not people) keep acting in one step, as every other confirm page does.

**Decision 515-A: when should the "Are you sure?" page appear?**

| Option | Benefits | Risks | What it's like to use |
|---|---|---|---|
| **A. Only when an email would go (recommended)** | Protects the one thing that can't be undone. Most reports (no address) stay one tap. | The team learns two behaviours: sometimes it asks, sometimes it doesn't. The page says why it's asking, which makes it clear. | Quick most of the time; a pause exactly when a stranger is about to get an email. |
| B. Every time a report is closed | One behaviour to learn. Also catches a mis-tap that closes a report by mistake. | An extra page on every close. People learn to tap through it, which weakens it for the case that matters. A wrong close with no email can already be undone by moving it back. | Slower for everyone, every time. |
| C. No page; hold the email for 10 minutes with "Undo" | Fastest. Catches mistakes noticed straight away. | Needs a new waiting state for emails and an undo action. Doesn't help someone who taps Done before writing the extra line. Bigger build. | Smooth, but the email box still has to be filled in before tapping. |

**Decided: A** (Samuel, 21 Oct 2026).

## 3. SYC-516: friendly error pages, and not losing work when signed out

### 3.1 Error pages

For a **browser page** under `/api/team/` (not the phone app, not data requests, which keep their short JSON answers). A browser page is one the browser says it's navigating to, or that asks for a web page (`Accept: text/html`), which covers older iPhones that don't say the first. It applies to "not found" (404), "something broke" (500) and a form too big or garbled to read (413, 400). Words are English with Greek and French matching, chosen from the browser's language, because the page doesn't check who is signed in:

- **Address doesn't exist:** title "This page doesn't exist", line "The link may be old or mistyped.", and a link **"Go to the dashboard"** (Home for the team; My colonies for a cat guardian, who is sent there by Home anyway).
- **Something broke on our side:** title "Something went wrong on our side". After a save: "Your change may not have been saved. Go back and check before trying again." (We can't promise "nothing was changed": a few saves do more than one thing.) When just opening a page: "Please try again in a minute." Same link.
- Both carry the dashboard's look and its safety headers (this also closes **SYC-339**). Neither shows the menu or the person's name: the error page doesn't check who is signed in, so a broken sign-in can't make it worse.

**Decision 516-A: should the error page show the full menu?**

| Option | Benefits | Risks | What it's like |
|---|---|---|---|
| **A. Dashboard look, one link home, no menu (recommended)** | Simple; works even when the error is in sign-in itself; shows nothing about the person. | One extra tap to get anywhere but Home. | Calm page, clear way back. |
| B. Full menu with name | Feels like the rest of the dashboard. | The error page has to read the sign-in, which is often what just failed. Must also choose the right menu for a guardian. | Slightly nicer when it works. |

**Decided: A** (Samuel, 21 Oct 2026).

### 3.2 Signed out while saving

Today, when a sign-in has lapsed and someone presses Save, the page flashes "Please sign in again" and jumps straight to the sign-in site. What they typed is gone, and after signing in they land on Home.

What changes, and only in one case: **a browser form post that passed the "came from the dashboard's own address" check, then failed only because the sign-in has expired or is missing.** Every other refusal keeps today's fixed answer, byte for byte: a post from anywhere else, the data routes, the sign-in hand-over, the invite pages, and simply opening a page while signed out (that one keeps its instant jump to sign in). Today's rule that every "not signed in" failure looks the same to the outside is kept: the new page appears only to a browser that has already proved it's on the dashboard.

- **No instant jump.** A page in the dashboard's look: "You were signed out, so this wasn't saved." Button: **"Sign in again"**.
- **What they typed is kept on our server and put back after they sign in (Samuel's decision 516-B, 21 Oct).** The rules that make this safe:
  - **Only for the person it belongs to.** The sign-in cookie now stays in the browser for 24 hours after it expires. The server still refuses it for everything, exactly as today, but it can read whose sign-in it was. The text is kept only when that expired cookie is genuine (our signature checks out) and that person hasn't been signed out everywhere or removed since. It is given back only when **that same person** signs in again on that browser.
  - **Only the named text boxes** of that form: the team note, the reporter's extra line, a colony's or site's notes and directions, a cat's name, the "how do you know?" box. Never hidden fields (where a map was tapped, which button was pressed), never anything else, each cut off at 4,000 characters.
  - **Short-lived.** Kept for 30 minutes at most, deleted the moment it's given back, deleted if someone else signs in on that browser, and cleared out by the server's regular tidy-up. A dashboard-only cookie holds a random ticket for it, nothing else.
  - **Put back, not saved.** After signing in they land on the page they were on, with the form filled in and a line at the top: "You were signed out before this was saved. We kept what you typed. Check it and press Save." Nothing is saved on their behalf.
  - **When we can't tell who it was** (no expired cookie at all, for example a different browser profile): nothing is kept. The "signed out" page shows the text back in a read-only box to copy instead, as the fallback.
  - This needs one new database table (a migration), so the build will say "don't republish yet" until it's applied.
- **Back where they were.** The dashboard remembers, for 30 minutes, the page to come back to, in a dashboard-only cookie (`__Host-`, secure, not readable by scripts). For a save, that's the page the form was on, worked out from which form it was (a Queue action comes back to that report opened on the Queue; a colony edit to the colony page), not the address the form posted to. After signing in, the person lands there instead of Home.
  - It holds only a dashboard address from a fixed list of page shapes (`/api/team/…`, no other site, no `//`, no `..`), and only the few page settings that list allows; never a position, a name or a search.
  - It's used only on a normal sign-in, and cleared then. If the person signing in may not open that page (a cat guardian, for a team page), they go to their usual home instead.
  - Shared phone: if someone else signs in within 30 minutes, they land on that page under their own permissions. Harmless, and it's cleared after one use.
- **Unchecked:** the sign-in site (admin.catspotters.com) is expected to need no change, because it hands over to the dashboard by posting from a sibling address, so the browser sends the cookie along. That isn't in this repository; the build checks it on the test site before relying on it, and if it doesn't hold, the person lands on Home as today and nothing else changes.

**Decision 516-B: how do we keep what was typed?**

| Option | Benefits | Risks | What it's like |
|---|---|---|---|
| A. Show it back on the "signed out" page to copy (my recommendation; now the fallback) | Works with the dashboard's no-scripts rule. Nothing stored anywhere. | The person has to copy and paste it after signing in. | A clear page with their words on it and one button. |
| B. Keep it in the browser and refill the form after sign-in | Nothing to copy. | Needs scripts on every form page, which the dashboard deliberately doesn't run, and leaves notes sitting in the browser. | Seamless when it works. |
| **C. Keep it on the server until they sign back in (decided)** | Nothing to copy, no scripts. | Stores text from someone we can't yet identify; a new store to clear out and secure. | Seamless, but riskier. |

**Decided: C** (Samuel, 21 Oct 2026). The risk in the table ("text from someone we can't yet identify") is answered by the rules above: kept only when we can tell whose it was, and given back only to them.

**Not in this spec:** what the sign-in site itself says (SYC-364, "workspace" wording). That's on admin.catspotters.com.

## 4. SYC-517: places as names, never numbers

**The rule (from the redesign, §3.2):** a place is shown as its named area ("Kini"), plus a feeding site's public label where there is one ("Kini, harbour steps"). Never a site's internal name (it often holds a guardian's name). Island-wide team members get **Open map** beside it. Cat guardians never get a map link, and never see a **cat's** position as numbers.

**One exception kept on purpose:** a cat guardian's own feeding-site pages (the site, and adding or moving one) show that site's exact position. That was approved in SYC-209 PR 4.2: they are her sites, she places and moves them, and its tests pin it. This spec leaves those pages alone; only her list of sites on My colonies loses the numbers.

Area names are in English only, as everywhere else in the dashboard today. Because area names now reach guardians' pages, the Areas page gets a hint: "Area names are shown to cat guardians. Use the place's name, never a person's."

| Where | Today | After |
|---|---|---|
| Queue, each report | "Where: 37.44473, 24.94259 · Open map" | "Where: Kini · Open map" (same as Home) |
| Colony page, centre of the colony | "37.44250, 24.94400" | "Vaporia · Open map", or "Not set" |
| Colony history ("centre moved") | two sets of numbers | "moved within Vaporia" or "moved from Vaporia to Kini" |
| Cat page, "First recorded: Where" | numbers | area name · Open map |
| Cat page, each sighting's More menu | numbers | dropped (the sighting already shows its place name above), Open map stays |
| Cat page, owner's home pin | numbers | "Pinned, in Ano Syros". Never Open map (an owner's home, D5). An area is several streets at least, so this says far less than today's numbers, which pin it to about a metre. |
| Site page and its add/move pages (team view) | "You tapped 37.4…" | "You tapped a spot in Kini" (the map already shows the dot). A guardian's view of her own site pages is unchanged (see above). |
| Areas page, an area's centre | numbers | Open map only (the name is the area) |
| **Guardian:** her colony's cat list and each cat page, "First recorded at 37.44210, 24.94360" | numbers | see decision 517-A |
| **Guardian:** her list of feeding sites on My colonies | numbers | dropped; the site's name and "how to find it" line stay, and the site's own page still has its position |

The guardian words ("First seen in {place}") are added in English, Greek and French.

**Decision 517-A: what does a cat guardian see instead of "First recorded at …"?**

| Option | Benefits | Risks | What it's like |
|---|---|---|---|
| **A. Nothing on the colony list; "First seen in Vaporia" on the cat's own page (recommended)** | The list gets shorter. The cat page still says roughly where, in words. Matches the spec's "place labels, not positions". | Little: an area name tells her nothing she doesn't know. | Cleaner list; one plain line on the cat. |
| B. Drop it everywhere | Simplest. | Loses a small clue if she has cats from two places. | Cleanest. |
| C. Area name on both | Consistent. | Every cat in one colony says the same thing on the list: noise. | Repetitive. |

**Decided: A** (Samuel, 21 Oct 2026).

**Typing a position by hand.** Three forms ask for latitude and longitude: the colony's centre, an area's centre, and the site pages' "type the position" fallback.

**Decision 517-B: replace typed positions with tapping a map?**

| Option | Benefits | Risks | What it's like |
|---|---|---|---|
| **A. Tap the map for colony and area centres; fold the site fallback under "Type a position instead" (recommended)** | Reuses the map the site pages already use (no scripts). Typing stays for the rare case a team member has numbers from a vet or GPS. | A bit more work than copy changes; its own pull request. | Tap where the colony is, see the dot, confirm. |
| B. Drop typed positions altogether | Simplest forms. | No way to enter a known exact position. | Map only. |
| C. Leave typed positions as they are | No work. | Stays hard on a phone; the review's finding stays open. | As today. |

**Decided: A** (Samuel, 21 Oct 2026), as the last pull request of this work, so the place names land first.

## 5. SYC-519: a shorter, calmer Queue

**One line per report, open to act.** Each open report is a single line: photo, place name, how long ago, the first words of what they said, and its state ("New", "Looking at it"). Urgent ones keep their red band and sort first, as today. Tapping the line opens it in place to show everything that's there now: the full note, which cat, contact, team note, the state buttons. It's a plain fold, no scripts. A report you just acted on, or that another page linked to, opens by itself. Every link into the Queue (Home, Find from a photo's and the Cats page's "Back to the report") gains `?open=<report>`, because a plain `#` link doesn't open a fold on Safari or Firefox. The report's anchor stays on the row outside the fold, so old links still scroll to it. An `?open=` that matches no report does nothing and is never printed back.

**Plain words.**

| Today | After |
|---|---|
| "Email to Syros Cats: Sent / Delivered" | "We emailed the team about it" (Delivered: "…and it arrived") |
| "Email to Syros Cats: Bounced / Failed. Syros Cats may not have been told by email." | "Our email to the team didn't arrive. Nothing is lost: it's here." |
| "Contact left: Yes. They haven't confirmed the address yet, so nothing else goes to it." | "They left an email but haven't confirmed it yet." |
| "Contact left: Yes. They confirmed the address." | "They left an email and confirmed it." |
| "Contact left: Yes. Our last email to them was sent / delivered." | "They left an email. Our last message to them was sent / arrived." |
| "Contact left: Yes, but our last email to them bounced." | "They left an email, but our last message to them didn't arrive." |
| "Contact left: No" | "No email left" |
| Banner: "Please tell whoever looks after the app." | "Please email hello@catspotters.com." (decision 519-C) |

**Unchecked (Cloudflare was unreachable).** Hidden when there are none. When there are some, it shows as now but titled "Arrived while our spam check was down (N)", with one plain sentence.

**Started but not sent.** Removed from the Queue and Home (decision 519-B).

The Queue and Home are team pages and stay in English, as today. Only pages cat guardians read get Greek and French.

**Closed reports** stay one line each, as now.

**Shared with the Issues section.** SYC-44 PR 7.1 (not built yet) adds an Issues section to this page whose rows carry the same state buttons and team note. The one-line row is built as one shared piece so the Issues rows use it too. Whichever lands second rebases; neither changes the other's section.

**Decision 519-A: filters on the Queue (by state or area)?**

| Option | Benefits | Risks | What it's like |
|---|---|---|---|
| **A. Not now (recommended)** | With one-line rows, a dozen reports fit on one phone screen. Less to build and learn. | If reports grow a lot, finding one gets harder. A ticket records it for later. | A short list, nothing to set. |
| B. State tabs (New / Looking at it / All) | Quick way to see only the untouched ones. | Hides urgent reports that are in another tab. | One more row of buttons. |
| C. State and area filters | Most control. | Most build; overkill for today's numbers. | Like the Cats screen. |

**Decided: A** (Samuel, 21 Oct 2026).

**Decision 519-B: old "started but not sent" reports**

| Option | Benefits | Risks | What it's like |
|---|---|---|---|
| **A. Show the last 14 days (newest 50 at most), folded under "Started but not sent (N)"; older ones counted, not listed (recommended)** | No new buttons or saved data. Stays useful (a recent one may mean a worried person nearby) without piling up. | An old one is never "dealt with", just no longer listed. | One folded line most days. |
| B. A "Dismiss" button on each | The team decides. | Needs new saved data, and care: if the person later sends it, it must arrive as a fresh report, not already dismissed. | One more button per item. |
| C. Leave as is | No work. | The list grows forever with nothing to do about it. | As today. |

**Decided: none of these. Drop "Started but not sent" from the team's screens** (Samuel, 21 Oct 2026: "It's not necessary"). The Queue section, the folded "Unchecked drafts" and Home's "started" lines all go. The public app still saves a report as it's being filled in, because that's how a report gets sent; the team just no longer sees unfinished ones. Nothing is deleted from the database.

**Decision 519-C: who does the mail banner name?**

| Option | Benefits | Risks | What it's like |
|---|---|---|---|
| **A. One line in the code naming the person and how to reach them, e.g. "Please message Samuel on WhatsApp." (recommended)** | Clear, and gives a way to reach them that doesn't depend on email, which is what's broken when this shows. One place to change. | The code is public, so the name (not a number) is public too. Needs a small change if the person changes. | People know who and how. |
| B. A contact the team can set on a settings page | Never goes stale; nothing personal in the code. | Another setting to build and keep filled in. | Same, once set. |
| C. Name the charity's admin email | Not tied to one person. | Unchecked which inbox that is; and the banner shows exactly when email is failing. | One more address to check. |
| D. Keep "whoever looks after the app" | No change. | Volunteers don't know who that is. | As today. |

**Decided: "Please email hello@catspotters.com."** (Samuel, 21 Oct 2026). That's a person writing from their own email, so it still works when the dashboard's own alert emails are failing.

## 6. Privacy rules kept

- Place labels come only from named areas and feeding sites' public labels (`placeLabel` / `publicLabelOf`, whose types make an internal name a compile error).
- **Open map** only for island-wide team members, built only by `position.ts`. Never for guardians, never on an owner's home.
- After this work, `position.ts` gives the place name plus the link, not numbers. The existing source test that catches raw positions printed outside `position.ts` (`positions.source.test.ts`) is extended, and its allow-list shrinks to the guardian's own site pages.
- Guardian-view tests already fail on any map company's address on a guardian's page. They gain a check that no cat position appears in the visible text of her My colonies and cat pages (hidden form fields on her site-move page are left out, as they must carry the tapped spot).
- Typed text from a signed-out save is kept only after the dashboard's own-address check passed and only when a genuine expired sign-in says whose it is; only the named text boxes (a test posts a position and checks it's never kept or shown back); for 30 minutes at most; given back only to that same person; never cached. An expired sign-in cookie still opens nothing.
- The return-to cookie holds only a dashboard address from a fixed list, checked on the way in and the way out, and the redirect is always to the dashboard's own site, so it can't send anyone elsewhere.

## 7. Errors and empty states

| Screen | Empty | Error |
|---|---|---|
| Queue | "No reports are waiting for the team." Unchecked hidden. | A failed move: today's "Someone else changed this report a moment ago" stays. |
| "Close and email?" page | — | If the report changed while it was open: back to the Queue with today's "someone else changed this" line; no email. |
| Signed out page | No free-text fields: just "You were signed out, so this wasn't saved." | — |
| Map picker (517-B) | No centre yet: the map starts on the colony's sites, or Ermoupoli. | A tap off the island: "That's off Syros. Tap a spot on the island." |

## 8. How it's split into pull requests

Each is a draft PR, reviewed and shipped before the next.

1. **Places as names** (SYC-517 without the map picker): `position.ts`, Queue, colony, cat, site, areas and guardian pages; guardian-view and source tests.
2. **Check before emailing** (SYC-515): the state route, the confirm page, Queue card loses the extra-line box.
3. **Error pages and signed out** (SYC-516, closes SYC-339): `app.ts` handlers for `/api/team`, `refuse.ts`, the return-to cookie read in `routes/team.ts` at hand-over, the sign-in cookie kept 24 hours past expiry, and the kept-text table (one migration: "don't republish yet" until it's applied).
4. **The shorter Queue** (SYC-519): row, folds, words, `?open=` links, "Started but not sent" removed from Queue and Home. Coordinated with SYC-44 PR 7.1.
5. **Tap the map for centres** (SYC-517, decision 517-B).

Every page change is checked in the browser at about 390 px and desktop, with data, and in Greek where cat guardians read it. Dashboard words stay matched in English, Greek and French. SYC-515 is never tested against the live site: it would email a real person.

## 9. What this spec does not do

- Change the sign-in site's own wording (SYC-364).
- Add the Issues section (SYC-44 PR 7.1), the trapping planner (PR 2.3) or map layers (PR 2.6).
- Change what the reporter's email says.

## 10. How the adversarial review was handled

One review (Sonnet, read-only, 21 Oct; `docs/reviews/team-dashboard-ux-fixes-adversarial-review.md`). Its two most serious claims were re-checked by hand and hold. Everything was taken in:

- **Held email loses the extra line** (blocker): the box now shows only when the email goes at once; the held case says it's the standard message, and only if the report is still closed (§2).
- **The fixed "not signed in" answer** (blocker): the new page appears only after the own-address check has passed and only for an expired sign-in on a save; every other refusal is unchanged (§3.2).
- **What's shown back** (major): named text boxes only, never hidden fields (§3.2, §6).
- **Return-to rules, the hand-over's other exits, bounced addresses, languages, guardians' own site positions** (major): written as rules in §2–§4; the sign-in site claim is marked unchecked.
- **Minor:** `?open=` on every link into the Queue; the dated draft count; the banner contact (now a decision with a channel); older iPhones; 400/413; the Areas hint; the owner's home pin; the contact-row words; the existing source test is extended, not new.
