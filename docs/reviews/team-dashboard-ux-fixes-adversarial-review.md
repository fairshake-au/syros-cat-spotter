# Adversarial review: team-dashboard-ux-fixes.md (draft 1)

Reviewer: Sonnet subagent, read-only, 21 Oct 2026, against origin/main 7a2d83ff. Tests not run. The sign-in Worker was not read.
Two claims re-checked by hand: finding 1 (reporterEmail.ts:439 queues the held outcome with `teamSentence: null`) and finding 8 (team.guardianView.test.ts:424 pins a guardian's own site page showing its exact position, approved in SYC-209 PR 4.2). Both hold.

## Blockers
1. **A held email drops the extra line.** At confirmation the held outcome is queued with `teamSentence: null` (reporterEmail.ts ~439); the Queue hides the box for unconfirmed addresses for this reason (queuePage.ts:122-129). Reopening before they confirm cancels the email (confirm-time state check). Fix: box only when confirmed; unconfirmed page says "standard message only, and only if still closed".
2. **`refuseNotSignedIn` is shared** by requireOrigin, requireTeam, hand-off and requireInvitee; its 401 body is fixed by design and pinned by tests (team.colonies.test.ts:1001-1030, team.walk.test.ts:592, team.my.test.ts:371). Fix: the new page only in the session-check branch after Origin has passed; every other refusal unchanged.

## Major
3. **Echoing "every free-text field" is unsafe**: hidden fields (from/to/confirm, tapped lat/lng) would be reflected; extended urlencoded allows nesting. Fix: per-route allow-list of text fields, readonly textarea, escaped, length cap, never for JSON; test that lat/lng are never reflected.
4. **Return-to address for a POST** isn't a page (the POST URL 404s on GET; fragments never reach the server). Fix: route-to-landing map; Referer only for GET pages; strict path allow-list under /api/team/, no `//`, backslash, control chars or `..`; exclude handoff, signout, map-tiles, report-photos; strip query to allow-listed params; redirect as TEAM_ORIGIN + path.
5. **Hand-off has three exits** (invitee welcome, replayed pass, normal session). Honour the cookie only on the normal exit and clear it; check `can()` for the path or fall back to home; `__Host-` cookie, Secure, HttpOnly, SameSite=Lax, Max-Age 1800. "Worker needs no change" is plausible but unchecked. Shared phones inherit the stored path (harmless).
6. **"Would an email go?"** must cover bounced/suppressed addresses (sendMail refuses them) and welfare rows only. One server function for render and press.
7. **Languages.** Queue and reporter email are English-only; the error page can't know a guardian's language without the session. Pick from Accept-Language or say English-only. Guardian strings need en/el/fr keys; area names are English-only.
8. **Guardian site positions are approved** (team.guardianView.test.ts:424, 700, 778-782). The spec was stricter than the redesign. List flipping tests; hidden tap fields carry lat/lng, so a blanket "no numbers on a guardian page" test must be visible text only.

## Minor
9. Other links into the Queue (findPhotoPage.ts:193, catGridPage.ts:365) need `?open=` too; keep `id="r-…"` outside the fold; `id="issues"` kept; a bogus `?open=` does nothing and is never echoed.
10. Drafts: Home shows only 24 h (inside 14 days). `listWelfareQueue` takes the newest 50 with no date filter; "counted, not listed" needs a dated count.
11. "Please tell Samuel": repo is public; the banner shows when email is broken so it needs a channel; admin address unverified. Suggest a single named constant with how to reach them.
12. `isBrowserNavigation` needs Sec-Fetch-Mode (Safari < 16.4 lacks it): also accept `Accept: text/html`. Say which statuses (400, 413) get the page. 500 wording differs for GET vs POST.
13. Area names become guardian-visible and are team-edited: hint on the Areas page. "Pinned, in Ano Syros" narrows an owner's home in a small area: say so under D5.
14. "No numbers printed" is already enforced by positions.source.test.ts RAW_PRINT: extend it. The caller list matches the code (plus teamMap:68).
15. Copy: "They'll get one message when this closes" is false after an outcome was sent or for unconfirmed+reopened; "Sent/Delivered" is the last mail to them, not necessarily the outcome.

## Checked and fine
`?open=` is the right approach (bare anchors don't open `<details>` in Safari/Firefox). No-scripts CSP untouched. Position-free URLs hold with finding 4's stripping. The press-time check is race-safe (`from` guard plus lock); a mismatch only changes whether an email is queued, never sends twice.

Verdict: not ready; fix 1–3, rewrite 4–8 as rules; design sound.
