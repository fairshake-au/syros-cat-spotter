# SYC-344 email-capture plan: adversarial review and what happened to each finding

**Reviewer:** an independent subagent on **Sonnet**, read-only, 15 Oct 2026, against `docs/specs/email-capture.md`, PR #181 (head `dd9ceeb`, which it found had **merged** at 14:57 UTC as `851c24a`), `origin/main`, the data-spine spec and open PRs. It returned its findings as text; this session wrote them here and folded them into `syc-344-email-capture.md`.
**Counts:** 3 critical, 12 major, 11 minor, 4 nits. **Fixed: 30. Partly fixed: 2. Not taken: 0.**
**Checked by this session before acting:** #181 merged (`gh pr view 181`); `resolveCat` returns a `CatSnapshot` with no observation ids (`lib/resolve.ts:104–120, 1387`); `resolveSterilised`/`resolveLifeStatus` return `supportingObservationIds`; PR #178 edits `outbox.ts`, `send.ts`, `suppression.ts` and `lib/db/src/index.ts` (`gh pr view 178 --json files`); `GET /api/cats/:catId` exists (`routes/cats.ts:228`).

Also folded in before the review landed: the SYC-42 Slice 3 session's note (15 Oct) that a news "is this you?" gets a `mail_deliveries` row because `DELIVERY_RECORDED` is keyed by purpose, so every news clean-up must delete those rows.

## Critical

| # | Finding | Outcome |
|---|---|---|
| 1 | C2 misread the resolver: `resolveCat` returns no observation ids, so the import/legacy and old-news guards couldn't be built as written | **Fixed.** C2 rewritten: `loadCatRecords` → `resolveCat` for the status the cat page shows, `resolveSterilised`/`resolveLifeStatus` for the evidence ids. New T1-11: the check and the cat page agree on every cat |
| 2 | A dead or presumed-dead cat could still get a "sterilised" or "homed" email | **Fixed.** Slice 1 step 3: a blanket rule, any cat that is dead or presumed dead produces no news of any kind. New T1-2b and its probe |
| 3 | In send mode, unwalked baselines go stale, giving false "spotted again after four months" emails and months-old "sterilised" news | **Fixed.** The check always walks every followed cat, in watch and send mode alike; the sighting gap is measured between sightings, not against the stored baseline. New T1-3b and its probe |

## Major

| # | Finding | Outcome |
|---|---|---|
| 4 | No `verify_cap` carve-out for news, so a stranger typing the address three times could silence the holder's confirmed news (a SYC-261 regression) | **Fixed.** `isNewsSuppressed(address, "verify" \| "confirmed")`, mirroring `isReportSuppressed`. New T2-5c and its probe |
| 5 | A capped change was "dropped, not held", but the baseline had already advanced, so a real "sterilised" could be lost forever; S7 said "waits" and contradicted it | **Fixed, as Decision 5** (recommend: hold, send with the next allowed email, drop after 60 days). Change rows have a `state`; S7 holds too. T3-1 and T3-12 |
| 6 | The `cat_news` send was never wired into the outbox, which fails unknown purposes | **Fixed.** Slice 3 specifies the outbox branch, an intent-only payload, re-reading at send time, clearing the payload, retry and give-up. T3-10, T3-11 |
| 7 | `sendMail`'s `isVerified` is address-level, the same cross-phone hole #181's review found | **Fixed.** `processNewsMail` re-reads the contact by id (and phone) before every send. "Every place the rule must hold" item 2. New T2-4b and its probe |
| 8 | "Stop emailing me" marks the address forever, so a person who changes their mind is told "check your inbox" and nothing comes | **Fixed, as Decision 6** (recommend: the same phone can undo its own Stop; strangers still can't). T2-5b |
| 9 | The Settings row had no way out of "pending", and a second add on the same phone was unspecified (a 500 on the new index) | **Fixed.** Change and Stop in pending; a pending row is replaced, a confirmed one answers `409`. The report's news box is hidden when the phone already has a news address. T2-10 |
| 10 | Decision 3's shared confirmation missed the cases where the report sends no "is this you?", and contradicted itself on forgetting | **Fixed.** Slice 5 has a table of every case, each a test. Forget from the shared email forgets both; "Delete my details" from a later report email leaves news alone |
| 11 | Many silent-failure tests had no mutation probe | **Fixed.** One table, "Every mutation probe", covers every guard, 38 probes in all, each naming its test |
| 12 | The Risk 1 gate was weaker than the spec: an ask could be on with cat news off | **Fixed.** An ask is live only with `CAT_NEWS_SEND` on, the template, both keys, and a reviewed change at least 14 days after the first run; the server refuses to start otherwise. T2-9 tests every part for every switch |
| 13 | Counting limits from outbox rows kept an address-to-cats history (against §8.5) and fitted Delete my data badly | **Fixed.** A `news_send_log` keyed on the contact (deleted with it) holds only send times; sent payloads are cleared of cat ids. T3-10 |
| 14 | A flipping status could be announced twice; no bulk-write backstop (data spine §9.2) | **Fixed.** A ratchet (`notified_sterilised_at`/`notified_homed_at`, set once) and a bulk guard (more than 50 news changes a night → all silenced, Samuel told). New C14, T1-12, T1-13 |
| 15 | Self-notification: a follower's own sighting would email them; the "caused only by" guards were looser than the spec | **Fixed.** New C13 and T3-9; the guards apply to the observations newer than the baseline |
| 16 | The collisions table missed PR #178, which edits the same mail files | **Fixed.** #178 listed, with who rebases |
| 17 | No alarm if the nightly check fails; idempotency had nowhere to live; the backup token wasn't in GitHub | **Fixed.** `cat_news_runs` (the night is claimed on finish, under a lock), the Worker alarms on failure or no run in 36 hours, the token in all three places, and which site it targets is stated. T1-9 |
| 18 | Decision 1 understated its risk: the real two weeks start at launch, and "6–9 Nov" was asserted | **Fixed.** Earliest switch-on restated as about 14 Nov; what counts as a genuine change, and what to do if none appears, are written down; option D (staged) added; the end-of-season claim marked unchecked |

## Minor

| # | Finding | Outcome |
|---|---|---|
| 19 | Spec rules dropped: the unsubscribe page's report option, the `threat_model.md` fix, the rate-limit primitive, the ceiling alert, Risk 2 measurement, staff deletion and the §6.4 export, per-surface wording versions | **Partly fixed.** Report option on the page, `threat_model.md` fix in Slice 2, the ceiling logs at error, per-surface wording versions, and the DB-counted limits stated as small call S9. Staff deletion/export → **SYC-375**; Risk 2 measurement → **SYC-376** |
| 20 | S1, S3, S4 and S6 were spec departures presented as small calls | **Partly fixed.** S1 is now **Decision 7**. S3 clarified (new spotters get the card on their very first spot, as the spec says). S4 flagged as a wording departure. S6 kept as a small call, with the reason a session carry wouldn't help |
| 21 | The weekly limit's "news-identity email" would have counted the "is this you?" | **Fixed.** Only `cat_news` counts |
| 22 | Unsubscribe and delete links: lifetime, cascade, and a second press | **Fixed.** Three years stated as small call S10; a second press says "Done" again |
| 23 | Two phones, one address: what Stop does | **Fixed.** Settings Stop is this phone only; the email's unsubscribe stops every phone with that address |
| 24 | The routing key was ambiguous (contact purpose vs payload) | **Fixed.** `payload.kind` everywhere |
| 25 | Each reviewer needs its own worktree; the healthz wait and Neon "ask" mode were missing from the rollout | **Fixed** |
| 26 | Copy: the Greek "no sex given away" claim was overstated; formal box wording unexplained; "more than four months" vs 120 days | **Fixed.** A note for Johnny on Greek grammatical gender; the boxes' polite form explained; the threshold is four calendar months and the email says "four months or more" |
| 27 | Settings placement contradicted itself | **Fixed.** Immediately above "Delete my data" |
| 28 | The cron can't hold an Athens time across the 25 Oct clock change; the Worker needs a cron branch | **Fixed.** The cron is UTC, the night is the Athens date, and the cron has its own branch |
| 29 | The drain-cadence sentence | **Fixed** (the cron is described by what it does, not a cadence) |

## Nits

| # | Finding | Outcome |
|---|---|---|
| 30 | A test that `visit_summary` and `promise_withdrawn` stay off | **Fixed** (Slice 3) |
| 31 | Tickets: the `threat_model.md` fix, `seedNewsBaseline` for the import, §6.4, Risk 2 | **Fixed.** `threat_model.md` is in Slice 2; the import note goes on SYC-45; SYC-375 and SYC-376 filed |
| 32 | The disagreements table was too technical for approval | **Fixed.** Every row now starts with what it means for people |

## Confirmed correct by the reviewer

#181's routing and confirm/forget branching (C4); `email_contacts` allowing news rows with no per-phone index (C3); purpose-separated fingerprints and the shared daily ceiling (C7); `cat_news`, `visit_summary` and `promise_withdrawn` listed and off (C10); `sever.ts` and the sweep as described; the reused strings exist in all three languages; the English matches the spec word for word, with €50–60, "spotter" and "cat guardian" right; slices drop cleanly from the end and cutting them all removes nothing a reporter needs.
