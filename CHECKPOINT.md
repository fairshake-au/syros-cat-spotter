# SYC-53 PR 1.3 checkpoint

Branch claude/syc-53-pr-1-3, stacked on claude/syc-53-pr-1-2 (ca7a73b).

## Done
- lib/db: myColonies, setOwnLanguage, LAST_MANAGER exported
- strings en/el/fr (my.*, mycol.*, nav.*)
- layout nav (My page for everyone signed in; guardian gets My colonies), requireTeam `own` option
- lib/teamPages/myPages.ts, routes/teamMy.ts (6 routes), GUARDIAN_HOME_PATH -> My colonies
- team.my.test.ts (25 tests) and 4 mutation probes (below)
- route walk rows (MINIMUM_ROUTES 68), fresh-person support for the two changing routes

## Browser check (done)
Scratch DB syc53_my on PORT 8095 (dropped, server stopped). en at 390 and 1280, el at 390 (LIVE_LANGUAGES switched locally and restored; never committed). No horizontal scroll, no control under 44 px. Screenshots in docs/screenshots/syc-53-pr-1-3/.

## Next
- browser check + screenshots (docs/screenshots/syc-53-pr-1-3/)


## Probes (red lines)
All four were red, then restored (git status clean after each).
1. stopHelping records `by` as `cli:probe` instead of `self` (lib/db/src/people.ts): team.my.test.ts 2 failed, 23 passed.
   `AssertionError: expected [ { by: 'cli:probe', kind: 'left' } ] to deeply equal [ { by: 'self', kind: 'left' } ]`
2. POST /team/my/language without the Origin check (requireTeam instead of formRoute): team.my.test.ts + team.walk.test.ts 8 failed.
   `POST /api/team/my/language as team (expected pass): expected undefined to be 'no-store'` and the Origin-matrix test red.
3. GUARDIAN_HOME_PATH = "/api/team/" (a guardian sent to the queue): team.invite + team.my + team.walk, 4 failed, 53 passed.
   `expected 'https://team.catspotters.com/api/team/' to be 'https://team.catspotters.com/api/team…'`
4. myColonies without scopeInForce() (an ended placement shown): team.my.test.ts 3 failed, 22 passed.
   `expected ' My colonies ...' not to contain 'Ended Place'`

## Review round (15 Oct 2026): done
- stopHelping action + `left_self` notice (en/el/fr); self sign-out quiet for a guardian; minor 3 (wantsPage); Greek sentence; French "gardien(ne)".
Probes (red, restored):
- drop notice for team stop-helping: 2 failed, `expected [] to deeply equal [ …(2) ]`
- notify for a guardian's stop: 1 failed, `expected [ { …(6) }, { …(6) } ] to deeply equal []`
- guardian self sign-out notifies: 1 failed, same line
- minor 3 reverted to isBrowserNavigation: 1 failed, `expected [ 204, undefined ] to deeply equal [ 303, …(1) ]`

## Self sign-out wording: done
`signed_out_self` kind (en/el/fr): "{subject} signed out of the dashboard on every device." Used when actor == subject.
Probe (reverted to signed_out_everywhere): team.my.test.ts 1 failed (self sign-out notice wording).
