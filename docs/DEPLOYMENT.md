# MVP Deployment Runbook

**Goal:** Cat Spotters (Syros) live in both app stores in October 2026, testing 1–14 September.
**Companion to:** [PRODUCT-SPEC.md](PRODUCT-SPEC.md) §2 (what we ship) — this is *how it gets to users*.
**If the Replit agent can't pull from GitHub:** see [runbooks/replit-github-sync.md](runbooks/replit-github-sync.md) (SYC-96).
**State as verified 2 Sep:** API never deployed (`.replit` has an autoscale config, nothing live). No bundle identifiers, no `eas.json`, no Android Maps key. Push delivery code exists but is unverified end to end. AI matching runs through Replit's OpenAI integration.

---

## The critical path (start these today)

The build work fits the window. The things that can sink October are all **lead times owned by other people**:

1. **Google Play Console account.** A personal account must run a closed test with 12+ testers for 14 continuous days before it can even *apply* for production access. Started this week, the Syros Cats WhatsApp testers satisfy it inside our own testing window; started late, it alone pushes launch past October. An organisation account is exempt but needs its own verification. **Decision + registration: today.**
2. **Apple Developer Program.** Individual enrolment is days; organisation enrolment needs a D-U-N-S number and can take weeks. Enrol now, whichever entity. TestFlight (our iOS testing channel) needs it too, so this gates testing, not just launch.
3. **Domain** (Samuel, already actioned). Needed early because stores require a support URL and privacy policy URL at submission.
4. **Privacy policy + support page** on the new domain. Both stores require them; ours must cover photos, location, and the new optional email collection. The Syros Cats ↔ Fair Shake data agreement (spec §15 of the proposal) should land at the same time.
5. **First store builds this week**, so the 1–14 Sep testing happens on TestFlight and the Play closed track rather than on dev builds — that's what makes the Play 14-day clock run concurrently with our testing.

## A. Store accounts and compliance

- [ ] Choose the publishing entity (Fair Shake vs Samuel personally) — affects both enrolments and the Play 14-day rule
- [ ] Apple Developer Program enrolment (€99/yr)
- [ ] Google Play Console (€23 one-off) + closed-testing track
- [ ] Privacy policy (en/el/fr) + support page on the new domain
- [ ] Apple privacy nutrition labels + Play data-safety form (photos, precise location, optional email; no tracking, no ads)
- [ ] Age rating questionnaires (should land 4+/Everyone)
- [ ] Confirm final store name with Syros Cats; check name availability in both stores

## B. App build pipeline

- [ ] Set `ios.bundleIdentifier` and `android.package` (e.g. `au.fairshake.catspotters`) — **unset today**
- [ ] Icons and splash under the Cat Spotters brand; store screenshots ×3 languages
- [ ] Permission strings (camera, photo library, location) in all three languages — Apple rejects vague ones
- [ ] **Google Maps API key for Android** — `react-native-maps` on Android requires one even with our OSM tiles on top; without it the map renders blank. Restrict the key to the app signature. iOS uses Apple Maps, no key.
- [ ] Create `eas.json`; EAS Build for both platforms with managed credentials (Samuel runs builds)
- [ ] Verified 3 Sep: Replit's guided mobile publishing ("Expo Launch" wizard) covers **iOS only** — build → TestFlight → App Store, so it can carry our iOS path if preferred over raw EAS. **Google Play has no guided path on Replit** ("can be accomplished manually"), so Android goes through EAS + Play Console regardless. Replit's "Publish" button on a mobile app produces an **Expo Go preview URL**, not a web app — a browser-usable web deployment needs the web export served as a normal web deployment (section C)
- [ ] Point `EXPO_PUBLIC_DOMAIN` at the production API domain
- [ ] Verify push end to end: Expo push token registration on device, FCM credentials for Android via EAS, one real notification received on each platform

## C. Backend to production

- [ ] **Hosting call (resolves the open item): compute stays on Replit through launch.** The AI matching uses Replit's OpenAI integration; migrating compute now means replacing that with a direct API key mid-sprint for no launch benefit. Revisit in Phase 3 (Oct–Dec, low season).
- [x] **Photos stay in Postgres for launch (DECISIONS.md D1).** No object-storage migration before launch. SYC-46 is deferred, not closed, and re-scoped as a data migration; it is decided together with SYC-47 on **15 November 2026**, with the default being that both stand through the 2027 season. The accepted cost — the migration is free only until the first production photo exists — is recorded in `docs/specs/hosting-and-photo-storage.md` §1 and §4.2. That spec also owns the September infrastructure work that replaces this line: generated migrations with checked-in history (§5) and photo-endpoint hardening (§6)
- [ ] Deploy the API as a Replit deployment on the custom domain (`api.` subdomain), TLS on
- [ ] **The database is Neon (SYC-121), not Replit's managed Postgres.** Project `syros-cat-spotter`, region `aws-eu-central-1` (Frankfurt), Postgres 16, branches `production`/`development`/`rehearsal` (SYC-121 plan, Part A.1). Restore window: **7 days** (Neon's point-in-time restore). The tested restore is the switchover's own dress rehearsal (SYC-121 plan, Part D), which proves the whole copy-and-verify path end to end, including a rollback, against a real copy of tester data — run and recorded on SYC-121 before every cutover. Date of the last rehearsal: _see SYC-121 for the current one_. The live deployment (project **Syros-Cat-Spotter-EU** after the move) is a **new Replit project in Europe**, not the original — see the SYC-121 plan's "finding that shaped this plan" for why the original can't just be republished there.
- [ ] **Schema changes go through migrations only (SYC-64, `hosting-and-photo-storage.md` §5.2), and production migrations run through the `db-ops` GitHub Actions workflow, not from the Repl shell (SYC-121 plan, Part A.4).** `drizzle-kit push` is gone. Order for every deploy that changes the schema: 1) `gh workflow run db-ops.yml --ref main -f target=development -f command=migrate` migrates the Neon `development` branch (or the next Git-pane pull's `post-merge.sh` does it); 2) **before** publishing the code that needs it, `gh workflow run db-ops.yml --ref main -f target=production -f command=migrate` migrates Neon `production` directly; 3) Claude checks the migration landed — migration history against the journal, and the new column/constraint — through read-only SQL against Neon (the Neon MCP's `run_sql`, or an ad hoc `select`; no connection string needed), **not** `-f command=verify`: `verify` runs `compare --projected` against the old Replit database first, which fails as soon as testers have written anything on Neon (`docs/runbooks/neon-database.md`), so it would false-alarm on every deploy after the first; 4) Samuel pulls in the new project's Git pane and publishes; 5) `-f command=smoke` (sends the tester key while the pre-launch gate is on). **If smoke fails: roll back the app code first (republish the previous build), then `-f command=migrate-rollback`** — new code on the old schema 500s every cat/sighting/notification list (it selects the column the rollback would remove), so reverting the database alone is the one combination of the three that's actually broken; new code on the new schema and old code on the new schema are both fine, so when in doubt, leave the migration in place and revert code only. Take a Neon snapshot first when real data is affected (Neon's 7-day restore is the backstop). A re-`migrate` after a rollback mints fresh ids for whatever the rolled-back migration generated (e.g. SYC-98's `photos.public_id`) — anything handed out in between is gone. `migrate` waits at most 5 seconds for a table lock and rolls back if it can't get one, rather than queueing live requests behind it; run it again when traffic is quieter. The first `migrate` against a database built by `push` adopts the baseline only if the live schema matches it exactly; otherwise it changes nothing and prints the differences. (A command that only runs the history-check half of `verify`, safe to use after testers have written, is a separate ticket — `db-ops.sh`'s `run_verify` isn't split yet.)
- [ ] **Up/down/up against a copy of production, before the Play window (§5.2 item 5).** This waits for the first migration after the baseline, because the baseline never rolls back. Restore a production dump into a scratch database and run `migrate` there. Then run `migrate:rollback` and `migrate` again for the newest migration, and run the smoke test against it. Record the date here: _not yet run_.
- [ ] **Never approve a Replit database review (SYC-121, rule R3).** After the SYC-121 move, Replit's publish has nothing of ours to compare — the app never uses Replit's own managed database (`lib/db/src/url.ts` refuses `DATABASE_URL` inside a Replit workspace and in production). If Publish ever shows a database review, especially one with `TRUNCATE` or `DROP` on a table with rows, **cancel it** and treat it as a sign something is wrongly pointed at Replit's own database.
- [ ] **One instance while the Postgres rate-limit store doesn't exist (SYC-105).** The live deployment is capped at **Max instances: 1**, so the in-memory rate limiter stays correct. Raise this only after SYC-105 moves rate limiting to Postgres.
- [ ] Environment: `OWNER_SECRET` set, `CAMPAIGN_*` set with corrected €50–60 copy (SYC-14), log level
- [x] Confirm `trust proxy` matches Replit's production proxy chain (rate limiting depends on it). **Done 3 Oct 2026 (SYC-100): the visitor is 4 hops from the server, so `trust proxy` is 4.** Measured with the token-gated `/api/healthz` probe (now removed under SYC-187 — see `docs/runbooks/proxy-probe.md` for the historical record, run 37091945054). If Replit's proxy chain could have changed, restore the probe from PRs #57/#60 and re-run it.
- [ ] Outbound email for welfare/report notifications to admin@syroscats via Resend on the new domain (SPF/DKIM so Google Workspace doesn't junk it)
- [ ] Uptime monitor on `/api/healthz` + error alerting to Samuel

### Pre-launch gate (SYC-113)

Until launch, the test deployment is kept private by two gates we own, instead of Replit's "Password protected" wall: a password page on the website, and a pass that every `/api` request must carry. The full design is `docs/superpowers/plans/syc-113-pre-launch-gates.md`; the everyday operations are in [runbooks/pre-launch-gate.md](runbooks/pre-launch-gate.md) (settings, rotating the password and the tester key, turning it off).

- `/api/healthz` stays open for Replit's health check. Everything else in `/api` needs the website cookie, the tester key (`X-Prelaunch-Key`), or, on `/api/internal/*`, the sign-in Worker's bearer.
- **Anyone calling the API by hand while the gate is on adds the tester key header.** That includes owner updates (`POST /api/cats/:id/updates` with `OWNER_SECRET`) and `scripts/security-check.mjs`, which sends it when `PRELAUNCH_KEY` is set in the terminal's environment.
- **Launch day starts with a check, not the switch:** confirm location blurring is live (data spine PR 6) before `PRELAUNCH_GATE=off`. See the runbook.

## D. Product changes (spec §2)

Tracked in PRODUCT-SPEC.md §2 — rename, safety screen, feeding nudge, clipped-tip question with photo, 500m, points 25/15, notes + food/water, thin-slice sterilised status, blurred public locations, welfare flow with capacity messaging, minimal staff dashboard, email capture v1. Riskiest for the window: staff dashboard and email capture — both can slip to the hardening phase without moving launch. (The records import moved after MVP on 28 September 2026. It is optional: `docs/specs/records-import.md`.)

## E. Testing (1–14 Sep)

- [ ] iOS via TestFlight, Android via the Play closed track (starts the 14-day clock)
- [ ] 12+ testers recruited through the Syros Cats WhatsApp group
- [ ] On-island field pass: offline queue and sync, offline tiles, HEIC photos, GPS accuracy, Greek/French UI
- [ ] Seed with imported Syros Cats sterilisation records; plan the purge of test cats/sightings before launch
- [ ] Native-speaker review of Greek and French strings (SYC-4)

## F. Submission and launch

- [ ] Submit both stores by ~20 September (review is usually days, but October needs slack)
- [ ] Play production access application once the 14-day test completes (~15 Sep at earliest)
- [ ] Launch-day config: campaign figures, colony names entered, feeding sites loaded (private), staff dashboard credentials handed to Syros Cats
- [ ] QR materials printed for cafés/hotels/Kini, pointing at the domain, which routes to the right store

## G. Watch items

- OSM tile policy: ~350 pre-downloaded tiles per install is tolerable at launch scale; budget a paid tile provider (€10–50/mo) if installs take off
- The stale docs/syros-cats-proposal.md mirror and the Purropolis-branded proposal artifact still need the rename pass (SYC-17)
- Play's 14-day rule assumes testers stay opted in continuously — brief the WhatsApp group not to leave the test

## H. Sign-in mail is down

Staff sign in at `admin.catspotters.com` with an emailed link, sent through Resend from `signin@mail.catspotters.com` (SYC-25). If the links stop arriving, work through this in order.

**Who is affected.** Only people who need a *new* link. Anyone already signed in stays signed in for up to 30 days on that device, so a short outage usually goes unnoticed.

1. **Check it's really mail.** Request a link for your own address. The page should say "If that address is on the list, a link is on its way". If it says "Email sign-in isn't switched on yet", the `RESEND_API_KEY` secret is missing from the `catspotters-admin` Worker. Put it back with `wrangler secret put RESEND_API_KEY` from `catspotters-website/admin`.
2. **Check Resend.** Look at status.resend.com, then open the Resend dashboard, go to Emails, and find the link you just requested. If it shows *bounced* or *complained*, the problem is the recipient's mailbox, not us. If there's no entry at all, look at the Worker's logs in the Cloudflare dashboard (Workers, then `catspotters-admin`, then Logs) for `signin mail send failed` and its status code. A 401 or 403 means the key was revoked or rotated. A 422 means the domain has lost its verification: check the DNS records under `mail.catspotters.com`.
3. **Check it isn't the rate limit.** Each address gets at most three links in 15 minutes and ten in a day; each network gets at most 20 requests an hour. Past that, the page looks normal but nothing is sent. Asking again doesn't make the wait longer: the limit counts links actually sent, not attempts. Look for `signin_limit_crossed` in the Worker logs. Waiting it out is the fix.
4. **Getting somebody in during an outage.** The one break-glass address in the D1 `admins` table (Samuel's) is for opening the workspace documents, not for sharing. The dashboard (SYC-43) is never reachable through it. Do not hand-insert rows into `signin_tokens`. That is the process this setup replaced.
5. **If Resend is down for a long time**, the upgrade path is Postmark (DECISIONS D2). Only one function in `admin/src/index.js` sends mail (`sendLink`), so switching means changing that function, verifying `mail.catspotters.com` with Postmark, and storing its send-only key as a Worker secret. It is a small code change plus DNS work, not a rethink.

Keys are never pasted into chat, tickets, routines or this file (spec §2.11).
