Task 1: phone menu fold (.phonebar + Menu details) done (81ccf5d6)
Next: Task 2
Task 2: use_workspace management-only, review_cat_news (team) on /api/team/news-changes, roles spec §6.2/§6.3 updated; mutation probe (TEAM back on use_workspace) failed 6 tests: capabilities.test.ts "use_workspace is management only", T27 "is open to management, and shut to staff…", T15 "the team holds everything else… or the workspace"; internal.people.test.ts "version 2: staff-only gets workspace false and dashboard true; a manager gets both", "no version: staff-only gets the fixed no body"; layout.test.ts "a staff member's menu has no Workspace; a manager's does" (0c759ff6)
Next: Task 3
Task 3: main 1120px everywhere, .col 760px wrapper for non-wide pages, .mappage margin rewritten for 1120px frame; browser whole-pixel check left to controller (c90a3410)
Next: controller runs Step 3 browser check, then PR1 wrap-up
Task 4: back links (§2.5): one backLink helper, Home links to /api/team/home (Areas, Ear clips, Colour check, Vet settings), 11 pages relabelled per §2.5, backLinks.test.ts table (41a63955)
Next: controller reviews Task 4, then PR1 wrap-up (browser check of back links at 390px and desktop)
Task 5: fold markers and methodFold() helper done (c059c0d1)
Next: PR 1 close (browser checks at 390/1280px, draft PR, adversarial review)
Task 5 fix 1: invite button inline-flex (d085b1d5)
Next: PR 1 close
