# SYC-53 PR 1.3 checkpoint

Branch claude/syc-53-pr-1-3, stacked on claude/syc-53-pr-1-2 (ca7a73b).

## Done
- lib/db: myColonies, setOwnLanguage, LAST_MANAGER exported
- strings en/el/fr (my.*, mycol.*, nav.*)
- layout nav (My page for everyone signed in; guardian gets My colonies), requireTeam `own` option
- lib/teamPages/myPages.ts, routes/teamMy.ts (6 routes), GUARDIAN_HOME_PATH -> My colonies
- team.my.test.ts (25 tests) and 4 mutation probes (below)
- route walk rows (MINIMUM_ROUTES 68), fresh-person support for the two changing routes

## Next
- browser check + screenshots (docs/screenshots/syc-53-pr-1-3/)
- full suite + typecheck, final report

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
