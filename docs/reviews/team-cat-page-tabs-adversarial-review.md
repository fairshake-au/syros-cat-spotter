# SYC-655 tabs amendment: adversarial review (at 58a78541, incl. new section 5)
Paths below are under artifacts/api-server/src/. Read-only review, nothing edited.

## Part A: findings (most serious first)

### A1. HIGH: dropping coat changes from History loses detail that exists nowhere else
Doc (s5.3): History shows each coat/markings change as one line linking to `#appearance`; "the full entry ... is only in the Coat and markings tab".
Code: the Coat tab only lists `counts` changes plus standing, un-pointed-at ones (`markableChanges`, lib/teamPages/appearancePage.ts:~472-481; `markWrongInFold = s.markable`, :~452). Replaced, superseded and marked-wrong coat changes are NOT in the fold. Their full History rendering (crossed out, "replaced by", "Why:", photo; catHistory.ts:~570-590 `entryExtras`) would vanish. The fold's own hint says "Older and replaced changes are in History, with what replaced them" (appearancePage.ts:~509), which would become false. Base spec s3.7 also says "the full list of past coat changes is in History". Also `changeRows` (appearancePage.ts:~452) shows origin and photo but not the "Why:" reason.
Fix: Coat tab gets a "Past changes" list of ALL coat/markings statements (replaced ones crossed out with what replaced them and the reason), built from the same `entryExtras`. Each one-line History row links to `#a-<id>` (exists for rows in the fold, appearancePage.ts:290/455) and falls back to `#appearance`. Change the hint text. Keep `id="s-<id>"` on the one-line row, because "Why we think so", "Corrects the change of ..." and `done`/`at` landings point at `#s-<id>` (catFacts.ts:45 `statementHref`).
Filters/counts (the coordinator's question): fine as long as the one-liner stays a normal row. `flatRows`/`SHOWS.changes` (catHistory.ts:~211) then counts it exactly as today, so tab count, "Changes and notes N" and "Show all N" don't drift. Do NOT remove the row; only strip the menu (the `coat` link at :575-578 and `c.inFold`, :511/763, become dead). The "Corrects ..." link to a coat row lands on a one-liner. That is acceptable, but the link should be `#a-<id>`.

### A2. HIGH: map "full width, taller" is not possible with today's map
Doc s3: Map tab shows the map "at full width (taller than today's small map)".
Code: the map is pre-rendered square tile bands. `span = GRID*size` (map.ts:244), GRID=2, BANDS max 256 (mapTiles/geometry.ts:33-39), so the biggest picture is 512x512. Bands are picked by viewport width in CSS (layout.ts:446-450, 497+), and the tile route only accepts `isTileSize`. On the cat page desktop shows b164 (328px) (layout.ts:679-680). Full width at 1120px would need new tile sizes (route, signing and band changes) or a stretched blurry image. Also fitView/pin positions are in pixels of the chosen band.
Fix: say "up to 512px square, left-aligned, with the caption beside it on desktop" (largest existing band; on a phone it stays band-sized). New tile sizes is its own ticket. Also reword the "too far to fit" note (catPages.ts:~417 "see History below") to "see History", and the map-unavailable line ("listed below", :~407), because History is now another tab.

### A3. MEDIUM: the name and mark can't sit inside the card without a layout change; phone order
Doc s2/s5: name with the sterilisation mark beside it, inside the card; phone order photo, name, facts.
Code: `renderPage` emits notices (`beforeTitle`), then `<h1>` of `title`, then `afterTitle`, then `body` (layout.ts:~851-855). The h1 is outside `body` and is escaped plain text, so neither the card wrapper nor the mark badge (`markBadge`, catFacts.ts) can be placed there. Today the name is above the photo on phone (the base s3.1 / s7 "status line above the photo" call). Removing the status line fixes the contradiction with s3.1 but reorders the name below the photo.
Fix: add a `PageOptions` field (e.g. `heading?: string` HTML, replacing the default h1) or let the body supply the h1; keep `<title>` as plain text. The card owns h1, SYR line and mark. A CSS-only reorder is also possible by making the card the wrapper and using `display:contents` on a wrapper, but it's fragile. The tests that pin the old shape need rewriting: catPages.summary.test.ts:191-240 (jump links), catPages.coat.test.ts:239, anything on `statusLine`/`.statusline`/`.photostrip`. `statusLine` (catFacts.ts:187) is then unused and is imported only by catPages.ts:32/605.

### A4. MEDIUM: amber open-reports box demoted below the buttons, against base s3.1
Doc s2: amber box "under" the actions. Base s3.1 "Reports": "an amber box sits above the facts panel". Today it is built into `facts` first (catPages.ts:~535 `openReportsBox` + facts). On a phone it moves below the buttons and below the fold. This is not in the "Calls made" list.
Fix: either keep it above the facts (my recommendation: it is an alert) or list it explicitly in s6 as a decision for Samuel.

### A5. MEDIUM: `aria-current` claim cannot be met without script
Doc s3.1/s4: the open tab "carries aria-current" and "Screen readers hear 'History, current'". CSS cannot set an attribute, and the server never sees the URL fragment. CSP is `script-src 'self'` (lib/teamAuth/refuse.ts:44) so a small first-party script file is allowed, but the page is deliberately script-free.
Honest wording: "The open tab is drawn as selected. With no script the page does not set `aria-current`. Where the browser supports alternative text on generated content, the selected tab also carries ', current' as generated text (as the folds already do: `content:"▸" / ""`, layout.ts:~263); otherwise screen-reader users get a list of links and the open panel's own heading." Optional enhancement: a ~10-line first-party script setting `aria-current` on `hashchange`. Do not put "Screen readers hear" in the checklist as a pass/fail; say "unchecked with a screen reader" unless someone tests one.

### A6. MEDIUM: the CSS mechanism works, but only with these details (all expressible)
```
@supports selector(:has(a)) {
  .tabpanel{display:none}
  .tabpanel:target,.tabpanel:has(:target){display:block}
  main:not(:has(.tabpanel:target,.tabpanel :target)) #tab-history{display:block}
  /* selected tab, one pair per tab; default = History */
  main:has(#tab-photos:target,#tab-photos :target) a[href="#tab-photos"], ...
  main:not(:has(.tabpanel:target,.tabpanel :target)) a[href="#tab-history"]{...}
}
```
- The hiding rule MUST be inside the `@supports selector(:has(a))` block (or itself contain `:has`). Otherwise an old browser hides every panel and the stated fallback ("all panels show") fails.
- A target in the header (`#corrections`, `#appearance` chip is in Coat, not header) matches neither `.tabpanel:target` nor `.tabpanel :target`, so History shows. Correct.
- Targets are not unique to panels: unknown anchor means no target, History. OK.
- Existing `scroll-margin-top:72px` covers only `#history,#photos,#appearance,#issue-strip` (layout.ts:284). Add it to `.tabpanel`, `[id^="s-"],[id^="sg-"],[id^="p-"],[id^="vv-"],[id^="a-"]` and decide whether the tab row is sticky (the old `.jump` was, layout.ts:280). A tab click scrolls the panel top into view and, unsticky, hides the tab row on a phone.
- Not verified here: that Chrome, Safari and Firefox all re-style on fragment navigation before scrolling to a target inside a panel that only the `:has(:target)` rule reveals. Treat as "unchecked", and test initial load with `#s-<id>`, with `#p-<id>`, and a hashchange, in each. `<details>` ancestors of the target (folded run groups) open on fragment navigation in Chromium; the code already draws the group open (`sightingAnchors`).
- The Map panel needs its own `<h2>` (none today) for the fallback.

### A7. MEDIUM: redirect audit (each save, current target, panel under the amendment)
Rule: no anchor, or an anchor in the header, opens History.
| Redirect | Today's target | Panel | Notice sits in | OK? |
|---|---|---|---|---|
| teamCats.ts:641 vet visit saved | `?done=visit#vet-visits` | History (`#vet-visits` is inside History, catHistory.ts:788) | top of History | yes |
| teamCats.ts:677 / 701 / 707 visit reason, wrong, already | `...#vet-visits` | History | top of History | yes |
| teamCats.ts:691 confirm cancel; teamCorrections.ts:733 FROM_VET_VISIT back | `#vet-visits` | History | n/a | yes |
| teamCorrections.ts:337 life; 621 sterilised; 798 note; 833/836 renamed, unchanged; 515/555 ownerGone; 974 colony/colonyOut/colonyAlready | `?done=X#corrections` (catPage, :97-100) | header (`.fixes#corrections`, catActions.ts:216/226) so History by default | header, inside "Update this cat" (open) or at top of the buttons | yes. History does open, but the notice says "in the history below" and History is the open tab, so it holds |
| :562 ownerRemoved with row; :723 wrong; :748 already; :975 colony with `wrote` | `?done=X&s=<id>#s-<id>` | History | beside the row (`atStatement`) | yes. If the id is not in `v.history`, `atStatement` is false and the notice falls to the header (catPages.ts:~495), still visible |
| :368, :422, :426 died, diedAlready | no anchor (`topOfPage`) | History | above the card (`TOP_DONE`) | yes |
| :722, :1129, :1201 coat confirm/correct/wrong | `...#appearance` | Coat | inside Coat (`appearanceNotice`) | yes (and the Coat panel must be the target's ancestor: `<details id="appearance">` is inside it) |
| teamPhotos.ts:39 hide/restore | `?done&p=<id>#p-<id>` | Photos | inside the figure | yes, but see below |
| heldTyping.ts:115-148 landings | `/api/team/cats/<id>` and `?s=<id>`, no anchor | History | kept forms: name/note/life/sterilised are in the header; `wrong:<id>` form is in History (coat wrongs are not keepable: `wrongFormNeeds` returns null, catHistory.ts:324) | yes |
Wrong tab / hidden notice cases:
1. Photo hide/restore where the photo is not on the page any more (moved/deleted): `#p-<id>` matches nothing, History shows, but `photoNotice` is drawn inside the Photos panel (catPages.ts:~560-563, `landed` false), so the message is invisible. Fix: if `done` is a photo key and the photo is not found, draw the notice above the card, or redirect to `#tab-photos`.
2. Queue links: queuePage.ts:~441 `#corrections` (header, History default, fine), `#history` (History, fine); a `wrong_photo` report only links to the plain page, so it lands on History. Suggest `#tab-photos` for it.
3. Colour check: appearancePage.ts:632/637 `?open=coat#appearance` and the History/Update-menu links (catHistory.ts:577, catActions.ts:163) all end at `#appearance`, so they open Coat. The `?open=coat` part is now pointless (see A9).
The spec's s3.1 link list omits `#corrections`, `#vet-visits` and `#map` (map.ts:322 `id="map"`, would sit inside the Map panel, which is correct). Add them.
Notice homes: header = Update-menu results (`DONE` minus TOP/VISIT keys); above the card = died, diedAlready, guardian mark, death, hidden-main-photo; History = visit* and row notices; photo figure = hide/restore; Coat = coat keys. None ends in a hidden panel except the orphan photo case.

### A8. MEDIUM: Photos tab entry from the header after the strip goes (coordinator's question)
Doc s5.2: the main photo "carries a '5 photos' label" linking to Photos.
Check: there is always a second way in, the tab row directly under the card ("Photos (n)", always shown). Edge cases to specify: (a) no main photo (`.nophoto` div, catPages.ts:~526) with photos on file: put the label on the placeholder too; (b) only one photo: skip the label (it would link to the same picture); (c) label count includes hidden photos (team sees them): use "5 photos" matching the tab count; (d) tap target at least 44px on the 200px photo, and the label must be real text, not only an overlay with `pointer-events:none`; (e) the hidden-main-photo note's "All photos" link (catPages.ts:531, `#photos`) still works. Lost for good: the strip's per-thumbnail dimming/"Hidden" cue and the `#p-<id>` deep links from the strip (catPages.ts:447, plus the unused `.photostrip` CSS, layout.ts:272-277). Main photo itself is never dimmed for staff when hidden; the note is the only cue. Consider dimming it with a "Hidden" tag.

### A9. LOW-MEDIUM: Coat panel and dead code
`?open=coat`, `openCoat`, the auto-open rules (`open` in renderCoatFold, appearancePage.ts:~521-527) and `{fold:true}` all assume a folded section. The amendment says open. Currently the section is `<h2>` plus `<details class="fold" id="appearance">`. Make it a plain section (h2 + id) and drop the dead logic, or keep `details open` with no way to close it (confusing). History's filter link `?show=...#history` and "Show all" links are fine (relative, reload, keep History).

### A10. LOW: duplicate ids and small items
- Read all `id=` sites: no id appears twice on the cat page by reading. `id="appearance"` has two renderers (appearancePage.ts:389 and :550) but only the fold one is used on this page (catPages.ts:621). `a-<id>` has two sites (:290 and :455); confirm the same statement can't be in both lists, since `counting` and `notCounted` partition by `counts`. I did not run the page. Add a test asserting every `id` on a rendered fixture page is unique (it would also guard the new `tab-*` ids).
- s5.4: the "All" filter currently renders "All 21" (catHistory.ts:777 `${FILTER_WORDS[k]} ${counts[k]}`); drop the count only for the first filter and update the tests; the "Show all 21" link below the list is unaffected. Visible tab "History (21)" always shows the unfiltered count even when a filter is active; fine.
- The doc's own header says s3.3/s3.4 and s4 of the base are amended, but s5 also amends s3.1 (status line, photo strip), s3.2's "Last seen" etc. and s3.5/s3.7 (coat rows). Update the "Amends" line.

## Part B: builder questions (ranked; my default if unanswered)
1. Coat tab: list all past coat/markings changes (replaced ones crossed out, with reasons), or only today's markable ones? Default: all, per A1. A wrong guess loses data.
2. Is the tab row sticky? Default: sticky under the top bar, with `scroll-margin-top` on panels and targets (A6). A wrong guess makes tab switching painful on phones.
3. Map size: 512px max square, left-aligned, or commission bigger tiles? Default: 512px max, no new tiles (A2).
4. How does the h1 get inside the card? Default: new `renderPage` option for the heading HTML, mark beside name (A3).
5. Amber open-reports box: above the facts (base spec) or under the buttons (amendment)? Default: follow the amendment but flag it to Samuel (A4).
6. `aria-current`: no script, generated-content text, reworded claim? Default yes (A5).
7. Photo label rules: omit at one photo; show on the placeholder; count includes hidden (A8). Default as listed.
8. Delete `?open=coat` and the fold logic, or keep silently ignoring it? Default: stop reading it, leave the links' query alone (harmless), delete dead code.
9. Orphan photo notice (A7.1): above the card. Default yes.
