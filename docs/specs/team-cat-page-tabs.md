# The team cat page: a header card, then tabs

**Status:** draft for Samuel's approval, 24 Oct 2026.
**Ticket:** SYC-655.
**Amends:** [team-cat-page-redesign.md](team-cat-page-redesign.md) (SYC-602), §3.3, §3.4 and §4 only. Everything else in that spec stands: the content, the words, the buttons, History, Photos, Coat and markings, Reports, and every capability gate.
**Mockups:** https://claude.ai/artifact/1xAc8E4MF7fM6hK6G7EXAC (option B).

## 1. Why

Samuel saw SYC-602 live on 24 Oct 2026: "I don't love the way that this renders now that I've seen it, especially the different columns (especially the photos column) - it's awkward."

On a desktop the page has two sets of columns:
- **At the top,** three thin columns (photo and map, facts, buttons). The buttons column ends early and leaves an empty block.
- **Below,** Photos in a column of large tiles beside History. It runs half the page and then leaves blank space.

Samuel chose option B from three mockups: everything about the cat in one header card, and the rest behind tabs.

## 2. The header card

One white card at the top of the page holds everything about who the cat is.

**Inside the card, on a desktop (from 1000px), three areas side by side:**

1. **The photo** (200px square) with the strip of up to four more under it. Hidden photos stay dimmed, as SYC-602 built.
2. **The cat:**
   - the name;
   - the SYR line ("on our records since …");
   - the status line;
   - then every fact from the facts panel, laid out as a grid of three columns. Each fact keeps its grey source line and its "Why we think so".
   Health note and Owner, when shown, each take a full row of the grid, because their text is long. Below the facts, still in the card, go the cat's description and the "What the public sees" line.
3. **The actions:** Log a vet visit, Update this cat ▾, Add a note, and This cat has died, as SYC-602 built them. Under them goes the amber open-reports box, when there is one.

**On a phone** the card is one column, in this order: photo and strip, name and status line, facts (one column), description and public line, buttons, open-reports box. That matches decision D2: the buttons come straight after the facts.

**Notices stay above the card,** never inside a tab: the cat guardian's recent mark, the death notice, and the hidden-main-photo note.

## 3. The tabs

Under the card, a row of tabs. On a phone the row scrolls sideways.

| Tab | Holds | Shown |
|---|---|---|
| **History (n)** | The History list exactly as SYC-602 built it, with its filters, "Show all", and "How changes work". | Always. **Open by default.** |
| **Photos (n)** | The photos grid with its ⋯ menus, at full width. | Always. |
| **Map** | The sightings map at full width (taller than today's small map), its caption, and "Open the map". | Only when the cat has sightings. |
| **Coat and markings** | The Coat and markings section, open (no longer folded inside a tab). | Always. |
| **Reports (n)** | The full reports list. | Only for people who may see the welfare queue, and only when there are reports. |

The small map leaves the summary. In the header, the Last seen fact's place links to the Map tab.

### 3.1 How the tabs work without JavaScript

Each tab is a plain link to its panel (`#tab-history`, `#tab-photos`, `#tab-map`, `#tab-coat`, `#tab-reports`). The page shows one panel at a time with CSS alone:
- A panel shows when it is the link's target, or when it **contains** the link's target. For example, `#s-301` opens History and `#p-abc` opens Photos.
- With no target, or a target in the header card, History shows.
- The tab whose panel is showing is drawn as selected and carries `aria-current="true"`.

There's no reload and no script. Every link that already points into this page keeps working and opens the right tab by itself:
- History: `#history`, `#s-<id>`, `#sg-<id>`, `#vv-<id>`;
- Photos: `#photos`, `#p-<id>`;
- Coat and markings: `#appearance`, used by the Colour check queue;
- Reports: `#issue-strip`.

**In an older browser** that can't do this, every panel shows, one under another, each with its heading. That's the SYC-602 page without the columns, and it's still complete.

### 3.2 Where links and saves land

- **"Why we think so" and "Says otherwise"** link to `#s-<id>`, which opens History. A row outside the newest 20 or outside the current filter keeps SYC-602's `?history=all#s-<id>`.
- **A map marker** links to `#sg-<id>` and opens History at that sighting. The rule from SYC-602 still holds: a sighting inside a folded group is drawn with its group open.
- **After a save,** the page lands on the tab that holds what changed:
  - hiding or showing a photo lands on Photos, at that photo;
  - a coat or markings save lands on Coat and markings;
  - a vet visit, a note, Mark wrong and the Update this cat forms land on History, or in the header for the forms whose notice sits there today.
  The builder checks each redirect carries the anchor of the place its notice appears, and adds it where it's missing.
- **The browser's Back button** steps back through tabs you opened, because each tab is a link. That's expected and harmless.

## 4. What the builder must check

- Every panel and its heading are in the page for every viewer who may see them. A tab never appears for a panel that's empty because of a capability; Reports follows today's `view_welfare_queue` rule.
- With CSS on: exactly one panel shows for each of these addresses: none, `#tab-photos`, `#s-<id>` (inside a folded group too), `#p-<id>`, `#appearance`, `#issue-strip`, and an address with an unknown anchor (shows History).
- Without `:has()` support (simulate by disabling the rule): every panel shows.
- Keyboard: tabs are reachable in order, and focus shows. Screen readers hear "History, current" for the open tab.
- Screenshots at 390px and 1280px: the default page, each tab open, the read-only viewer, and the bare cat.

## 5. Calls made here (check these while reading)

- **Tabs are links with CSS, not reloads.** Every existing link keeps working and lands on the right tab with no change on the server. The cost is that the whole page still loads at once, as today.
- **The mockup's "Health and vet" tab is dropped.** The Health note is in the header facts, and History's "Vet visits" filter lists the visits. A separate tab would show the same things twice.
- **The mockup's side panel next to History (map, health note) is dropped.** The map gets its own tab instead, so History has the full width and there are no columns below the card.
- **Coat and markings is open inside its tab,** not folded, since opening the tab already means you asked for it.
- **History opens by default,** because it's what the team reads most after the header.
