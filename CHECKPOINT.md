# SYC-53 PR 1.2 checkpoint (builder: Sonnet subagent) - the People screen

Branch `claude/syc-53-pr-1-2`, stacked on `claude/syc-53-pr-1-1` at 6ac26d3. Not pushed, no PR.
(PR 1.1's old checkpoint is in git history of this file.)

## Plan of work
1. lib/db `peopleScreen()` reader (listPeople lacks invite columns for personState).  [done]
2. lib/people/screen helpers (words, history, placements form parsing) + lib/teamPages/peoplePages.ts
3. routes/teamPeople.ts (10 routes under /api/team/people), wired in routes/index.ts, nav link
4. team.walk.test.ts rows
5. routes/team.people.test.ts: T15 per route, chips, 25 October, self-change, no-free-text, no-colonies, language label, history
6. Mutation probes (record red lines below)
7. Browser check 390px + desktop, screenshots in docs/screenshots/syc-53-pr-1-2/
8. Full suites + typecheck, final report

## Done
- 2-5. screen.ts, peoplePages.ts, teamPeople.ts, nav link (AsyncLocalStorage in requireTeam), walk rows, team.people.test.ts (39) + noColonies (2) green.
- 1. peopleScreen reader + export.

## Probe results
All run with `-t` on team.people.test.ts; each restored afterwards.
- Drop `manage_people` from each of the 10 routes in turn -> exactly 1 red each: `T15 (screen half)... > <METHOD> <route>` (Tests 1 failed | 9 passed | 29 skipped), e.g. `FAIL ... T15 ... > POST /api/team/people/:id/left`.
- Drop requireOrigin (formRoute replaced by requireTeam + headers) -> 7 failed (one per POST route): `AssertionError: null: expected 303 to be 401`, `expected 409 to be 401`.
- Bypass the self checks (route + lib/db setPlacements + markLeftById) -> 4 failed: roles `expected 303 to be 409`, mark as left / sign out `expected 403 to be 409`, own row buttons.
- Let free text reach an email (personTemplates: no mailSafe on names) -> red: `expected 'Vt pp-susan invited <a href="https://…' not to match /https?:\/\/evil/`.

- Browser check done at 390px and 1280px (scratch DBs dropped, servers stopped): no horizontal scroll, every button/input/summary >= 44px, inputs 16px. Screenshots in docs/screenshots/syc-53-pr-1-2/. Found and fixed: clip passed straight to map clipped colony names to 1 letter.
- NEXT: full suites + typecheck, final report.
- DONE. Final: api-server 135 files passed | 1 skipped; 2073 tests passed | 4 skipped. lib/db 31 files, 492 tests passed. Typecheck: libs, api-server, scripts Done; mockup-sandbox fails (known).

## Opus review round (M1, m1-m6, nit) - all done
- M1 capitals id: route lower-cases :id once; lib/db self checks compare lower-cased. Probe (undo both) -> `expected 303 to be 409` on POST .../<UPPER-ID>/roles.
- m1 banners: link carries only done+p; banner rebuilt from viewer's own event < 10 min. Probes: drop viewer check / drop recency -> red `expected 'class="okbox"...' to be ''`.
- m2 repeated end_/label_ refused. Probes -> `expected 303 to be 400` (both fields).
- m3 real end time of removed placement; m4 no raw timestamp (data-ends attribute only); m5 bring-back shows what they held; m6 no placeholder name; nit date refusal fixed sentence. Each probed red.
- Screenshots retaken (list and history, 390 and desktop).

## Re-review leftovers (n1, n1b, n2) - done
- n1 resent proved by viewer's own `invite_resent` outbox row < 10 min; `nothing` carries no p. n1b broughtBack proved by viewer's recent `rejoined` event. n2 no empty "they held" clause.
- Probes red: resent unproved `expected 'class="okbox"...' to be ''`; nothing names person `not to contain 'p='`; broughtBack via invited `to be ''`; empty clause `not to contain 'When they left they were'`.
