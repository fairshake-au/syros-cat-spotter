# The team cat page: a header card, then tabs

**Status:** draft for Samuel's approval, 24 Oct 2026.
**Ticket:** SYC-655.
**Amends:** [team-cat-page-redesign.md](team-cat-page-redesign.md) (SYC-602), §3.1 (status line, photo strip, open-reports box), §3.3, §3.4, §3.5 (coat rows), §3.7 (Coat and markings) and §4. Everything else in that spec stands: the content, the words, the buttons, History, Photos, Coat and markings, Reports, and every capability gate.
**Mockups:** the three options at https://claude.ai/artifact/1xAc8E4MF7fM6hK6G7EXAC; the chosen design, with §5 applied, at https://claude.ai/artifact/464MUtBUmNmzMCriEoWquQ (source: [assets/team-cat-page-tabs/mockup.html](assets/team-cat-page-tabs/mockup.html)).

## 1. Why

Samuel saw SYC-602 live on 24 Oct 2026: "I don't love the way that this renders now that I've seen it, especially the different columns (especially the photos column) - it's awkward."

On a desktop the page has two sets of columns:
- **At the top,** three thin columns (photo and map, facts, buttons). The buttons column ends early and leaves an empty block.
- **Below,** Photos in a column of large tiles beside History. It runs half the page and then leaves blank space.

Samuel chose option B from three mockups: everything about the cat in one header card, and the rest behind tabs.

## 2. The header card

One white card at the top of the page holds everything about who the cat is.

**Inside the card, on a desktop (from 1000px), three areas side by side:**

1. **The photo** (200px square), labelled "5 photos" and linking to the Photos tab (§5). The label is real text, at least 44px tall to tap, and counts hidden photos too, so it matches the tab. With no main photo but photos on file, the label sits on the "No photo" placeholder. With only one photo there's no label. A hidden main photo is dimmed, as hidden photos are in the Photos tab.
2. **The cat:**
   - the name, with the sterilisation mark beside it;
   - the SYR line ("on our records since …");
   - then every fact from the facts panel, laid out as a grid of three columns. Each fact keeps its grey source line and its "Why we think so".
   Health note and Owner, when shown, each take a full row of the grid, because their text is long. Below the facts, still in the card, go the cat's description and the "What the public sees" line.
3. **The actions:** Log a vet visit, Update this cat ▾, Add a note, and This cat has died, as SYC-602 built them.

The amber **open-reports box** stays where SYC-602 put it: at the top of the card, above everything else in it, because it's the thing that needs acting on. (The mockup put it under the buttons; on a phone that pushed it below the first screen.)

**On a phone** the card is one column, in this order: open-reports box, photo, name, facts (one column), description and public line, buttons. That matches decision D2: the buttons come straight after the facts.

**Notices stay above the card,** never inside a tab: the cat guardian's recent mark, the death notice, the hidden-main-photo note, and the notice after hiding or showing a photo that is no longer on the page.

**Building it:** the name and mark sit inside the card, so `renderPage` needs a heading option that draws the `<h1>` where the page puts it. The `<title>` stays plain text.

## 3. The tabs

Under the card, a row of tabs that stays at the top of the screen as you scroll down the page. On a phone the row scrolls sideways.

| Tab | Holds | Shown |
|---|---|---|
| **History (n)** | The History list as SYC-602 built it, with its filters, "Show all", and "How changes work", except for §5's changes. | Always. **Open by default.** |
| **Photos (n)** | The photos grid with its ⋯ menus, at full width. | Always. |
| **Map** | The sightings map, as big as the map pictures go (up to 512px wide; today's map is 328px), with a heading, its caption, and "Open the map". Bigger would need new map pictures, which is not part of this change. | Only when the cat has sightings. |
| **Coat and markings** | The Coat and markings section as a plain section, not a fold. Under "Changes that count now" it gains **"Past changes"**: every older, replaced or marked-wrong coat and markings change, crossed out, with its reason, its photo and what replaced it. | Always. |
| **Reports (n)** | The full reports list. | Only for people who may see the welfare queue, and only when there are reports. |

The small map leaves the summary. In the header, the Last seen fact's place links to the Map tab. Two map notes that say "below" ("see History below", "listed below") change to "in History", because History is now a tab.

### 3.1 How the tabs work without JavaScript

Each tab is a plain link to its panel (`#tab-history`, `#tab-photos`, `#tab-map`, `#tab-coat`, `#tab-reports`). The page shows one panel at a time with CSS alone, inside `@supports selector(:has(a))`, so a browser without `:has()` hides nothing:
- A panel shows when it is the link's target, or when it **contains** the link's target. For example, `#s-301` opens History and `#p-abc` opens Photos.
- With no target, or a target in the header card, History shows.
- The tab whose panel is showing is drawn as selected, and adds the words ", open" for screen readers using CSS generated text, the same way the page's folds say whether they're open. The page doesn't set `aria-current`, because that needs a script. Each panel starts with its own heading, so a screen reader user lands on "History", "Photos" and so on.

There's no reload and no script. Every link that already points into this page keeps working and opens the right tab by itself:
- History: `#history`, `#s-<id>`, `#sg-<id>`, `#vv-<id>`, `#vet-visits`;
- Photos: `#photos`, `#p-<id>`;
- Map: `#map`;
- Coat and markings: `#appearance`, `#a-<id>`, used by the Colour check queue;
- Reports: `#issue-strip`;
- the header: `#corrections`, which keeps History open below the card.

Every panel and every one of these ids gets `scroll-margin-top`, so a target isn't hidden under the sticky tab row.

**In an older browser** that can't do this, every panel shows, one under another, each with its heading. That's the SYC-602 page without the columns, and it's still complete.

### 3.2 Where links and saves land

- **"Why we think so" and "Says otherwise"** link to `#s-<id>`, which opens History. A row outside the newest 20 or outside the current filter keeps SYC-602's `?history=all#s-<id>`.
- **A map marker** links to `#sg-<id>` and opens History at that sighting. The rule from SYC-602 still holds: a sighting inside a folded group is drawn with its group open.
- **After a save,** the page lands on the tab that holds what changed:
  - hiding or showing a photo lands on Photos, at that photo;
  - a coat or markings save lands on Coat and markings;
  - a vet visit, a note, Mark wrong and the Update this cat forms land on History, or in the header for the forms whose notice sits there today.
  The review checked each redirect: every one already carries an anchor in the place its notice appears. The exception is hiding or showing a photo that has since left the page. Its `#p-<id>` matches nothing, so its notice moves above the card (§2).
- **The Queue's "wrong photo" reports** link to the cat's `#tab-photos`, so the photos are in front of you.
- **The browser's Back button** steps back through tabs you opened, because each tab is a link. That's expected and harmless.

## 4. What the builder must check

- Every panel and its heading are in the page for every viewer who may see them. A tab never appears for a panel that's empty because of a capability; Reports follows today's `view_welfare_queue` rule.
- With CSS on: exactly one panel shows for each of these addresses: none, `#tab-photos`, `#s-<id>` (inside a folded group too), `#p-<id>`, `#appearance`, `#issue-strip`, and an address with an unknown anchor (shows History).
- Without `:has()` support (simulate by disabling the rule): every panel shows.
- Keyboard: tabs are reachable in order, and focus shows.
- In Chrome, Safari and Firefox: opening the page at `#s-<id>` and at `#p-<id>`, and clicking a tab, each shows the right panel and scrolls to the target. This depends on the browsers redrawing before they scroll, which nobody has checked yet.
- Every id on the page is unique (a test on a fixture page).
- Screenshots at 390px and 1280px: the default page, each tab open, the read-only viewer, and the bare cat.

## 5. Nothing shown twice (decided by Samuel, 24 Oct 2026)

Samuel asked whether the new design shows anything twice, and chose to remove all four real duplications:

1. **No status line.** The one-line summary under the name ("Probably sterilised · Lives on the street · colony · Last seen") goes. The facts grid right below says the same. The sterilisation mark moves beside the cat's name, so the most important fact still shows at a glance. This overrides §2's "the status line" and SYC-602 §3.1's status line.
2. **No photo strip.** The main photo carries a "5 photos" label and links to the Photos tab. When the main photo is hidden, the hidden-main-photo notice still says so.
3. **Coat changes live in Coat and markings.** History shows each coat or markings change as one line ("Coat changed to grey tabby · Maria") linking to that change in the Coat tab (`#a-<id>`, or `#appearance`). It has no ⋯ menu of its own. The line keeps its `id="s-<id>"` and still counts in the filters, so "Why we think so", "Corrects …" links and the counts work as before. The full entry, with its photo, reason and Mark wrong, is only in the Coat and markings tab, which now lists past changes too (§3). Nothing is lost. This replaces SYC-602 §3.5's "the row's ⋯ menu links there".
4. **History's first filter says "All",** without repeating the count that's already on the tab.

These stay on purpose, because they're a short summary at the top with the full record below:
- **Reports:** the amber open-report box, and the Reports tab.
- **The Health note fact,** and the note's entry in History.
- **The Sterilised and Vaccinated facts,** and the vet visit in History.
- **The coat chip in the facts,** and the Coat and markings tab.

## 6. Calls made here (check these while reading)

- **Tabs are links with CSS, not reloads.** Every existing link keeps working and lands on the right tab with no change on the server. The cost is that the whole page still loads at once, as today.
- **The mockup's "Health and vet" tab is dropped.** The Health note is in the header facts, and History's "Vet visits" filter lists the visits. A separate tab would show the same things twice.
- **The mockup's side panel next to History (map, health note) is dropped.** The map gets its own tab instead, so History has the full width and there are no columns below the card.
- **Coat and markings is a plain section inside its tab,** not a fold, since opening the tab already means you asked for it. `?open=coat` and the fold's open-by-itself rules go; links ending `#appearance` still land there.
- **The tab row stays at the top of the screen** as you scroll, as SYC-602's jump links did.
- **The open-reports box stays at the top of the card** (SYC-602's place), not under the buttons as in the mockup.
- **The map is as big as today's map pictures allow** (512px), not full width. Full width would need new map pictures.
- **History opens by default,** because it's what the team reads most after the header.

## 7. What the review changed

An independent review on 24 Oct 2026 checked this amendment against the code. It found that the first draft:
- would have lost older and replaced coat changes, because the Coat section only listed the ones that count now. The Coat tab now gets "Past changes" (§3, §5);
- promised a full-width map that today's map pictures can't draw. It's now up to 512px (§3);
- claimed `aria-current`, which needs a script. The wording is now honest (§3.1);
- moved the open-reports box under the buttons without saying so. It's back at the top of the card (§2);
- would have hidden a photo notice when the photo has left the page. That notice now moves above the card (§2, §3.2);
- would have hidden every panel in an older browser unless the CSS sits inside `@supports` (§3.1).

The review's full notes are in [../reviews/team-cat-page-tabs-adversarial-review.md](../reviews/team-cat-page-tabs-adversarial-review.md).
