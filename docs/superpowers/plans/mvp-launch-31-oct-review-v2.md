# Adversarial review: MVP launch plan v2 (18 Oct 2026)

**Reviewer:** an independent, read-only Sonnet sub-agent, 18 Oct 2026. It checked against `origin/main`, `gh pr list` and Linear, including Samuel's two 18 Oct comments on P-SYC-54.
**Reviewed:** `mvp-launch-31-oct.md` at commit `55988590`.
**Outcome:** the findings are summarised below, as returned. What happened to each is in the table at the end.

---

**Verdict (reviewer).** The scope matches Samuel's two 18 Oct comments exactly, and the privacy-page 404 and the highest migration (`0030`) check out. But the plan isn't ready to approve. It misstates SYC-415 and leaves a migration unaccounted for. Its dashboard schedule breaks its own order of what waits for what, and it has nothing for the guardian work the spec requires. D2 pre-asks Samuel to cut work he just refused to cut. The copy-freeze arithmetic makes "every Greek and French sentence checked" impossible, and the QR print window is mis-stated.

1. **Major. SYC-415 PR 4 is already merged.** The plan had it open (#215) and scheduled for Tue 20. `gh pr list` shows it merged. *Fix:* correct the row and drop it from the counts. After the 19 Oct publish, confirm it's switched off, check it live, then switch it on.
2. **Major. The migration accounting is incomplete.** `0027` and `0023`–`0026` aren't mentioned. "No remaining PR has a migration" contradicts vet visits probably needing one. Ask mode for live database writes isn't allowed for. *Fix:* say exactly which changes are applied; put "snapshot, then apply, then publish" into the Mon 19 row, with ask mode.
3. **Major. The dashboard schedule breaks its own chain.** It builds Find from a photo and vet visits on the same day, and reports before phase 2 is live. About 11 PRs in 7 days on a serial chain, with each needing a review and a merge window, plus unscheduled weekend merges. *Fix:* draw what really waits for what; state the merges per window; name a weekend merge or take weekend work off the critical path.
4. **Major. The PR estimates for phases 2–5 look low.** Vet visits is 2–3 PRs, and the reports 3–5. The total is nearer 16–20 than 13–15. *Fix:* re-estimate from the outline, and flag vet visits and the reports as likely to split.
5. **Major. The required guardian work is missing.** The spec (§10.2, §15) requires guardian versions of several screens, with tests. It also requires (§10.3) the new powers to be written into the roles spec "before anything is built". Neither is counted or scheduled. *Fix:* make the roles-spec update step 0, and count the guardian screens.
6. **Major. The Johnny arithmetic fails.** Guardian screens land 23–26 Oct, after the pack goes out on the 23rd, and the "short second pack" has no review day. *Fix:* those screens show English until a second check, or are held back; ask Johnny for a second window around 27–29 Oct.
7. **Major. D2 pre-decides the cut Samuel declined.** It asks him to approve cuts now, and says "I expect items 1 to 3 to slip". Two non-dashboard items (SYC-44 8.1, SYC-166 slice 4) were added as slips, although Samuel put them in scope. Vet-visit correctness isn't in the risks. *Fix:* make D2 a fallback for Samuel to decide on Wed 28 with the numbers in front of him; drop the two non-dashboard items; add the vet-visit risk with a live check.
8. **Major. The QR print timeline is inconsistent.** It allows 8 days but the risk row says 4. The printer and delivery to Syros are unchecked, and D4 has no date. *Fix:* name the printer and lead time, with a local-printing fallback; set D4 for Tue 20.
9. **Minor. Claims need a source or "unchecked".** The Turnstile secret has no source. #168 is labelled SYC-44 3.1 but its title is SYC-279. "About 12 PRs" outside the dashboard doesn't add up (8–9).
10. **Minor. Gaps in the launch-day checklist.**
    - Blurring isn't a hard gate before the switch.
    - The rollback step should be written before the switch, not "will be".
    - The privacy policy must also cover the reporter's email, photo location and Cloudflare, and needs a watched contact address with a response time.
    - Syros Cats' sign-off has no date.
11. **Minor. Model delegation.** The reports' assurance is a test, not one proved to fail. The launch switch-off has no second pair of eyes. The review should be noted as read-only.
12. **Minor. Plain English.** Jargon remains in tables the charity reads ("key-parity test", "mutation probe", "healthz", "EXIF", "proxy hops", "observe mode"). The canonical terms are used correctly, and the offline wording is accurate.
13. **Minor. Public-repo hygiene.** The plan holds only Syros Cats' public report inbox, and no personal data. The licence PR (#233) is still open on a public repo.

---

## What happened to each finding

| # | Accepted? | Checked against | What changed |
|---|---|---|---|
| 1 | Yes | `gh pr view 215`: merged 18 Oct 16:30 UTC | Row corrected; Mon 19 now says confirm off, check live, switch on |
| 2 | Yes, corrected further | Live version check: build `976c0005` (16 Oct); `git diff 976c0005 origin/main -- lib/db/migrations` shows only `0030` | `0023`–`0029` are live; only `0030` is pending, and goes first on Mon 19 with a snapshot and ask mode. Vet visits flagged as likely to need a change |
| 3 | Yes | SYC-396 plan outline | "What has to wait for what" added; phase 2 built side by side; vet visits after Home's counting; a weekend merge window named for Samuel |
| 4 | Yes | SYC-396 plan lines 903–915 | Estimate now 17–21, with vet visits at 2–3 and the reports at 3–5 |
| 5 | Yes | Spec §10.2, §10.3, §15 | Roles-spec step added before phase 2; guardian screens counted in each phase |
| 6 | Yes | DECISIONS Part 2o (team dashboard English only) | New D5: late guardian screens show English until a second check, 27–29 Oct |
| 7 | Yes | Samuel's 18 Oct comment ("declined moving phases 2–5") | D2 is now a fallback for Samuel to decide on Wed 28, not an approval to cut. "I expect…" removed, the two non-dashboard items removed, vet-visit risk added |
| 8 | Yes | — | 8 days stated; printer **unchecked**; a local-printing fallback; D4 due Tue 20 |
| 9 | Partly | `gh pr view 168`; the SYC-44 plan's Slice 3 is SYC-279; the live version check shows `"secret":"configured"` | #168 relabelled as SYC-44's Slice 3 (filed as SYC-279). Secret now sourced to the live version check. Outside-dashboard count corrected to about 8 |
| 10 | Yes | SYC-114, SYC-345, `privacy-policy.md` | Blurring is a hard gate; the rollback is written by Tue 27; a "Privacy policy" section lists the launch contents and Syros Cats' sign-off by Tue 20 |
| 11 | Yes | — | The impact report's test must go red if a later record is counted; a second reviewer reads Friday's results; the review is noted as read-only |
| 12 | Yes | — | Jargon replaced in the tables ("the site's version check", "a test that's been proved to fail") and glossed |
| 13 | Yes | `gh pr view 233`: open | The licence is a launch-day checklist line, for Samuel's call |
