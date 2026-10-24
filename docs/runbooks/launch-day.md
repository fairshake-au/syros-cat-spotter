# Launch day: switching off the pre-launch pass (SYC-345)

**For:** Samuel, on Saturday 31 October 2026. **Written:** Saturday 24 October 2026 (updated after PR #319 merged), checked against live sources at about 12:40 UTC that day.
**Companions:** [pre-launch-gate.md](pre-launch-gate.md) (the settings), [../DEPLOYMENT.md](../DEPLOYMENT.md) §C, [../superpowers/plans/mvp-launch-31-oct.md](../superpowers/plans/mvp-launch-31-oct.md) (the launch plan and its checklist).

Turning the pre-launch pass off **is** the launch. After it, anyone can open the app and anyone can send a report. This page says what must be true first, the one setting to change, how to check it worked, and how to undo it.

**Every step is marked.**
- **Claude does it:** a check with `curl`, a look in Linear, or a Cloudflare change using the token file (never printed).
- **Samuel does it:** typing into Replit (secrets, the setting, pulling `main` in the Git pane) or a decision. Claude can publish from chat but cannot pull from GitHub into Replit, and never handles secret values.

**Status words used below:** **done** (checked, source named), **not done** (checked, and it isn't), **unchecked** (nobody has looked; the way to check is given). Nothing here is inferred.

---

## 1. Read this first: three things stand between today and launch

These came out of the checks in section 3. Each has a Linear ticket.

1. **The website's anti-bot check only worked on `apptest.catspotters.com`. Fixed in code, not yet live.** The website and the server both had `apptest` as the only address Cloudflare's check (Turnstile) would work for, so on `syros.catspotters.com` the box never appeared and, once the pass is off, every report would have been refused. **[SYC-662](https://linear.app/fair-shake/issue/SYC-662) is Done and merged** (PR #319, `8cd2dffb`, 24 Oct): the website's key list and the server's built-in address list now both hold `apptest` and `syros` (exact lists, never `catspotters.com`). **It is not live until `main` is pulled in Replit and published** (the live build on 24 Oct, `f1cfa0d0`, is older), which must happen before Friday 30 Oct.
2. **Claude's Cloudflare token cannot edit the Turnstile widget.** On 24 Oct a read of the widget list with `~/.cloudflare/api-token` answered "Authentication error" (code 10000). SYC-306 assumed Claude would add the new address to the widget. It can't, so **Samuel adds it in Cloudflare** (step B4), or makes a token that has Turnstile rights. **Ticket: [SYC-663](https://linear.app/fair-shake/issue/SYC-663).**
3. **The privacy policy isn't live.** `https://catspotters.com/privacy` answers 404 (curl, 24 Oct 12:39 UTC). SYC-66 is still in Backlog. The plan lists the policy as part of "launched".

---

## 2. The one-line summary of launch day

1. **Samuel:** set `PRELAUNCH_GATE` to `off` in Replit's Secrets and tell Claude.
2. **Claude:** publish, wait until the live site reports the new build, then run the checks in section 5.
3. If anything fails, **go back** (section 6): set it to `on` and publish. About 5 minutes.

---

## 3. Pre-flight: where each item stands (24 Oct 2026, about 12:40 UTC)

Run again on **Friday 30 October** and paste the results into SYC-345. Anything not "done" on Friday means **the pass stays on** (the same rule the launch plan gives for the blurring check).

| # | Item | State on 24 Oct | Where it was checked | Who closes it |
|---|---|---|---|---|
| A1 | Turnstile secret is in Replit | **Done.** `"secret":"configured"` | `curl https://apptest.catspotters.com/api/healthz`, build `f1cfa0d0` | — |
| A2 | A real Turnstile token has been accepted in watch-only mode ("observe") | **Unchecked.** SYC-170 (15 Oct) says it stays unproven until a client sends its first real token. Nothing in Linear says one has since been seen | Replit's log is the place (`turnstile: ok`, hostname `apptest.catspotters.com`); Claude can't read Replit's logs. Samuel sends one report from the live site, Claude asks Samuel to read the log line, or asks the Replit agent for it | Samuel + Claude, Friday (step A2 below) |
| A3 | Launch address chosen | **Done.** `syros.catspotters.com`, Samuel, 18 Oct | SYC-306 comment, 18 Oct | — |
| A4 | Launch address exists in DNS | **Not done.** No record | `dig +short syros.catspotters.com @1.1.1.1` empty; `curl` says "Could not resolve host"; Cloudflare zone list (`cf.py get`) shows only `apptest` and `team` A records | Samuel clicks in Replit, Claude adds the records (steps B1–B2) |
| A5 | Launch address is in the Turnstile widget | **Unchecked, and Claude can't check or change it** (Cloudflare "Authentication error", 24 Oct) | `cf.py get "/accounts/{acc}/challenges/widgets"` | Samuel (step B4), SYC-663 |
| A6 | `TURNSTILE_HOSTNAMES` lists the launch address | **No longer a single point of failure.** Since #319 the server's built-in list is `apptest` and `syros` (`turnstile.ts:47`, merged 24 Oct; **not live yet**). Whether Replit has `TURNSTILE_HOSTNAMES` set is still **unchecked** (Claude can't see Replit's published secrets). Setting it is now belt-and-braces: if set, it replaces the built-in list, so it must hold both addresses | `turnstile.ts` on `main`, 24 Oct | Samuel (step B5, optional) |
| A7 | The website's code knows the launch address | **Done in code, not live.** PR #319 merged (`8cd2dffb`); `turnstileConfig.ts:31` lists both addresses. Live: **not done** until the next publish (live build `f1cfa0d0` predates it). After publishing, check `https://syros.catspotters.com/_challenge` loads the box | `gh pr view 319`, `main` on 24 Oct; `/api/healthz` build `f1cfa0d0` | Samuel pulls `main` in Replit, Claude publishes and checks |
| A8 | Launch address sits behind the same proxy hops (SYC-229) | **SYC-229 is Done in Linear, but only for `apptest` and `.replit.app`.** It was closed with no code (measured 14 Oct: 59 down to 50 remaining across both doors, fake addresses never reset the count). `syros` has not been measured | SYC-229 comment, 14 Oct | Claude, step B3 |
| A9 | Sign-in Worker address (SYC-191) | **Not done.** SYC-191 is Backlog. Launch day is safe **only because `apptest` stays up** (Samuel, 18 Oct: "keep `apptest` working through November"). What `PEOPLE_API_ORIGIN` holds today is **unchecked** (it lives in the other repo, `catspotters-website/admin/wrangler.jsonc`) | SYC-191, SYC-306 comment | Claude reads the website repo's setting Friday; no change is needed while `apptest` stays |
| A10 | Home description rule (SYC-130, DECISIONS Part 2q) | **Built and merged; live behaviour unchecked.** Linear: SYC-130 Done (14 Oct). PR #142 (`5c2ebb1f`) is an ancestor of the live build's hash `f1cfa0d0` (`git merge-base --is-ancestor`, 24 Oct). Whether the live public cat details leave out the home description needs the tester pass | git, `gh pr view 142` | Claude, Friday, with the tester key (step A3 below) |
| A11 | Privacy policy live (SYC-66) | **Not done.** 404 | `curl -I https://catspotters.com/privacy`, 24 Oct; SYC-66 Backlog | Samuel approves wording, Claude builds the page |
| A12 | Location blurring (SYC-41, SYC-114 step 0) is live | **Unchecked.** SYC-41 is Done in Linear, but nothing has looked at the live list since. Needs the tester pass | SYC-41 status; DEPLOYMENT.md §C gives the check | Claude, Friday (step A3 below). **If this fails the pass stays on** |
| A13 | Tester data stays (SYC-201) | **Done.** Decision: keep it as the first records (Samuel, 4 Oct). Linear: Done | SYC-201; launch plan | — |
| A14 | Live build contains everything meant for launch | **Not done yet.** Live is `f1cfa0d0` (built 24 Oct 05:09 UTC). `origin/main` is 10 commits ahead | `git log f1cfa0d0..origin/main` | Publish cycle, plan's calendar |
| A15 | Report inbox reaches the team (SYC-173) | **Not done.** SYC-173 is Backlog | Linear | Samuel with Syros Cats |
| A16 | Licence merged (plan's checklist) | **Done.** PR #233 merged (`97420af3`) | `gh pr view 233` | — |

### The Friday checks (pass still ON)

**A1. Claude: the site is healthy and Turnstile is in watch mode.**

```bash
curl -sS https://apptest.catspotters.com/api/healthz
```

Expect `"status":"ok"`, `"turnstile":{"mode":"observe","secret":"configured"}`, and a `commit` that is the launch build.

**A2. Samuel + Claude: one real token has been accepted.** Warning: this sends a real report, which writes a row to the live database and emails the report inbox. Ask Samuel first; he sends one test report from the live site on his own phone, and the Replit log should then show `turnstile check` with `turnstile: ok`, `hostname: apptest.catspotters.com`. (`syros.catspotters.com` is proved the same way after step B, with its own hostname.)

**A3. Claude: the tester-pass checks (blurring and the home description).** Needs the tester key. Claude does not have it in its shell (`PRELAUNCH_KEY` is empty, checked 24 Oct), and it must not be pasted into chat. Samuel runs one of these, or puts the key in the terminal environment for Claude:

```bash
gh workflow run db-ops.yml --ref main -f target=production -f command=smoke
```

This is the route `docs/DEPLOYMENT.md` §C names: the workflow carries the key. **Unchecked:** exactly what `smoke` creates on the live site. Claude reads `scripts/db-ops.sh` and the smoke script before running it, and reports that to Samuel first. Then Claude also checks `GET /api/cats` returns `"locationPrecision":"approximate"` and `"locationCellM":250` on every cat, with no `lat`/`lng` on any sighting.

---

## 4. Before launch day: the launch address (SYC-306)

Aim to finish by **Tuesday 27 October** (the launch plan's date). Each step is checked before the next.

**B1. Samuel: link `syros.catspotters.com` as a custom domain in Replit** (Syros-Cat-Spotter-EU, Publishing, Domains). Replit will show an A record and a TXT record. Tell Claude when they're showing. Claude can't do this click.

**B2. Claude: add the records in Cloudflare, then check them.** Records are added with the token file through the helper, one at a time, reading the zone first. The A record **must not be proxied** (the other two app addresses aren't, and Replit's own address checks need to see it).

```bash
python3 /Users/samuelporter/.claude/skills/cloudflare-ops/scripts/cf.py get "/zones/{zone:catspotters.com}/dns_records?name=syros.catspotters.com"
```

After adding, verify from outside:

```bash
dig +short syros.catspotters.com @1.1.1.1
```

```bash
curl -sS https://syros.catspotters.com/api/healthz
```

Expect the same IP as `apptest` (34.111.179.208 on 24 Oct) and a healthz that matches `apptest`'s `commit`. Replit's certificate can take several minutes after the records show.

**B3. Claude: the 10-request check that fake addresses can't dodge the limits** (SYC-229's method, repeated for the new address). It uses `POST /api/team/handoff` with no `Origin`, which is refused at the first step, so it writes nothing. It sends no email and creates no data. Run:

```bash
for ip in none 10.1.1.1 10.2.2.2 none 10.3.3.3 10.4.4.4 none 10.5.5.5 10.6.6.6 none; do if [ "$ip" = none ]; then curl -sS -o /dev/null -D - -X POST https://syros.catspotters.com/api/team/handoff | grep -i '^ratelimit-remaining'; else curl -sS -o /dev/null -D - -X POST -H "X-Forwarded-For: $ip" https://syros.catspotters.com/api/team/handoff | grep -i '^ratelimit-remaining'; fi; done
```

**Pass:** the number drops by exactly one each time, fake addresses included. If a fake address ever makes it jump back up, **stop**: the new address has fewer proxy hops, and the launch address needs fixing before the pass can come off. (This spends 10 of one address's 60 requests per 15 minutes; it affects nobody else.) Record the table on SYC-229.

**B4. Samuel: add the address to the Turnstile widget.** Cloudflare dashboard, Turnstile, "Cat Spotters app: report forms", Settings, Hostname management: add `syros.catspotters.com`. Keep `apptest.catspotters.com`. **Never add `catspotters.com` itself**; that would accept every subdomain. (Claude can't do this with its current token: SYC-663. If Samuel would rather not, he can make a token with Turnstile edit rights using `~/.cloudflare/store-api-token.sh`, and Claude does it.) Claude then checks by loading `https://syros.catspotters.com/_challenge` once the build containing #319 is live, and a real token on the live site (A2).

**B5. Samuel (optional now): set `TURNSTILE_HOSTNAMES` in Replit's workspace Secrets tab** (the padlock; the Publishing tab did not work for secrets on 15 Oct) to exactly the line below. The server's built-in list already has both addresses after #319, so skipping this no longer blocks launch. If you set it, it replaces the built-in list, so it must hold both:

`apptest.catspotters.com,syros.catspotters.com`

This is a plain list of addresses, not a secret value, so Claude can read it back with Samuel, but it only takes effect on the next publish.

**B6. Claude: the build containing SYC-662 (#319) is live, and the "keep my spots safe" links follow the decision.** `PUBLIC_APP_ORIGIN` (`artifacts/api-server/src/lib/keepSafe/links.ts`) defaults to `apptest`. Saved spots live in each address's own browser storage, so a link to a different address than the visitor used would open an empty app. **Decided by Samuel, 24 Oct (his words to the SYC-662 session: "go with option 2")**: set `PUBLIC_APP_ORIGIN=https://syros.catspotters.com` in Replit when the pass comes off (**Samuel's step**, no code change), keep `apptest` answering so old emails still work, and Claude checks that a restore link made on `syros` opens on `syros` with the spots intact. The step is ticketed as [SYC-675](https://linear.app/fair-shake/issue/SYC-675). **Unchecked:** whether `PUBLIC_APP_ORIGIN` is set in Replit today.

**B7. Claude: SYC-191.** Read the sign-in Worker's `PEOPLE_API_ORIGIN` in the website repo, confirm it still points at `apptest`, and confirm `apptest` is staying up. If either is not true, do SYC-191's steps in order (attach the new address, change the setting, `wrangler deploy` the admin Worker, probe a real sign-in, only then retire `apptest`).

---

## 5. The switch (Saturday 31 October)

**Don't start unless every row in section 3 is "done" or has been waived by Samuel in writing on SYC-345.**

### S1. Claude: last look before the switch

Run A1 and A3 once more. Record the build hash the live site is running. Check the only things open are the ones Samuel has waived.

### S2. Samuel: the setting

In Replit, workspace **Secrets** tab (the padlock): add or edit **`PRELAUNCH_GATE`** and set it to exactly:

`off`

Nothing else changes. (Unset or any other value means **on**, so a typo cannot open the site. Source: `artifacts/api-server/src/lib/prelaunch.ts`, `gateEnabled()`.) Say "gate is off in Replit". Where `PRELAUNCH_GATE` sits today (workspace Secrets or the Publishing pane) is **unchecked**; Claude can't see published secrets, and the only trustworthy check is the live site in S4.

If `main` has changed since the last publish and the Replit workspace is behind, **Samuel pulls `main` in Replit's Git pane first** (one click). Claude checks it with the Replit connector before publishing.

### S3. Claude: publish, then wait

**First, any database change goes out before the code that needs it.** Before every publish (the one for the switch, and any publish on the days before), Claude lists the migrations on `main` that production doesn't have yet and applies them first, with a Neon snapshot, using the `db-ops` workflow in the order in `docs/DEPLOYMENT.md` §C. Writing to production needs Samuel to switch Claude's session to "ask" mode first. On 24 Oct, migration `0043_restore_codes` (SYC-664, PR #328) was about to merge; whether it is applied to production is **unchecked**, and a publish that reads it before it exists breaks the pages that use it. Say "don't republish yet" until that check is done.

Claude publishes from chat (`publish_app`, Syros-Cat-Spotter-EU) and watches `get_publish_status` every 30 seconds. **How long:** about 4 minutes on each of three publishes on 15 Oct. The deploy can sit in "promoting" for a while; allow up to 10 minutes before calling it stuck, and don't start a second publish while it says "busy".

Don't probe yet. Wait until the live site reports the new build:

```bash
curl -sS https://apptest.catspotters.com/api/healthz
```

The `builtAt` time should be after the publish started. The `commit` is usually a Replit "Published your App" commit that GitHub doesn't know, so it is checked inside the workspace (is the launch commit in its history?), not locally.

### S4. Claude: the probes. All of these create nothing.

**Is the pass off?** The cleanest check: Turnstile switches itself to refuse the moment the pass is off, and healthz says so.

```bash
curl -sS https://apptest.catspotters.com/api/healthz
```

Expect `"turnstile":{"mode":"enforce","secret":"configured"}` (it was `"observe"` on 24 Oct). That is the same code path that decides whether a report is refused. **If it still says `observe`, the pass is still on: stop and look at the setting.**

**A visitor with no password opens the app** (run for both addresses; swap the host):

```bash
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' https://syros.catspotters.com/api/cats
```

Expect `200 application/json` (it was `401` on 24 Oct).

```bash
curl -sS https://syros.catspotters.com/ | grep -ci 'password'
```

Expect `0` (the password page contained the word nine times on 24 Oct; the real app shouldn't show it). Then Claude opens the site in a browser at phone width and desktop width and checks that a cat list actually shows with data.

**The website's normal files are served:**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://syros.catspotters.com/robots.txt
```

**The launch build is live (and it's the one intended):**

```bash
curl -sS https://syros.catspotters.com/api/healthz
```

Compare `commit` with the build recorded in S1 (confirm inside the workspace that the launch commit is in its history).

**Staff can still sign in, on the same address and the old one.** `team.catspotters.com` has its own sign-in and never needed the pass.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://admin.catspotters.com/
```

Expect `200`. Then a real sign-in. **Warning, needs Samuel's OK first:** requesting a sign-in link emails a real person, and Samuel is the only one who should be sent one. Samuel asks for a link for his own address and clicks it; Claude does not request links for anyone else.

**Every internal route still refuses strangers** (from SYC-345, Samuel's note of 18 Oct: on 18 Oct all of them returned 401, but the pass may have been what refused them; that has to be confirmed once the pass is gone). The routes (all under `/api/internal/`, from `internalAuth.ts`, `resendWebhook.ts` and SYC-191): `mail/drain`, `coat/sweep`, `news/nightly`, `news/last-run`, `fingerprints/nightly`, `resend/webhook`, `people/allowed`. Send GET and POST to each, with no token and with a wrong token, and expect `401` on every line. None of these can do anything without the real token, so this creates nothing:

```bash
for p in mail/drain coat/sweep news/nightly news/last-run fingerprints/nightly resend/webhook people/allowed; do for m in GET POST; do a=$(curl -sS -o /dev/null -w '%{http_code}' -X $m https://syros.catspotters.com/api/internal/$p); b=$(curl -sS -o /dev/null -w '%{http_code}' -X $m -H 'Authorization: Bearer wrong' https://syros.catspotters.com/api/internal/$p); echo "$m $p none=$a wrong=$b"; done; done
```

**A report with no Turnstile token is refused.** The healthz line above proves the server is in `enforce` mode, the same state the report routes use (`tokenGate` in `reports.ts`). Showing it with a real `POST /api/reports` needs a registered test device and a valid body (it fails on a bad body with 400 before it ever reaches the token step), and registering a device writes a row. **That stronger probe is optional and needs Samuel's OK:** it adds one test device row to the live database, and a refused report writes nothing else. Unchecked: how to get a device secret without leaving that row.

**A real report is accepted. Warning, needs Samuel's OK:** this writes a report and emails `admin@syroscats.com` (real people at Syros Cats; SYC-173 is not done yet, so the inbox may still be Samuel's). Samuel sends one marked "TEST, please ignore" from his phone on `syros.catspotters.com`, taps the box if it appears, and sees it accepted. The Replit log should show `turnstile check` `ok`, hostname `syros.catspotters.com`. If the box doesn't appear or the report is refused with "challenge required": SYC-662 or step B4/B5 is missing. **Roll back.**

**Help feed a cat** (from SYC-345, 15 Oct). **Warning, needs Samuel's OK:** one real tap adds one to the day's tap count. Samuel taps it once on the live site. Check it opens Syros Cats' donation page and that the count went up by one.

**Tester data is still there** (SYC-201): `GET /api/cats` lists the existing cats (28 cats and about 52 sightings on 4 Oct, per SYC-201; the exact figure is not the check, it's that the list is not empty).

### S5. Claude: tell Samuel, and record it

Post the results to SYC-345 (what was checked, against what, at what time), push a notification to Samuel with "launch: pass off, probes pass/fail". Then watch the first hour: the Replit log for `turnstile` lines, and the report inbox.

---

## 6. Rolling back

**The one setting:** `PRELAUNCH_GATE`. Turning the pass back on is that setting and nothing else.

1. **Samuel:** in Replit's workspace Secrets tab, set `PRELAUNCH_GATE` to `on` (or delete it: **unset means on**). Say "gate is back on".
2. **Claude:** publish and wait, the same way as S3. About 4 minutes, up to 10 if it sits in "promoting".
3. **Claude:** check it's back (below).

**What "rolled back" looks like (all three, from outside, no password):**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://apptest.catspotters.com/api/cats
```

→ `401` (the body says `prelaunch_pass_required`).

```bash
curl -sS https://apptest.catspotters.com/api/healthz
```

→ `"turnstile":{"mode":"observe",...}` (it flips back to `observe` with the pass on).

```bash
curl -sS https://apptest.catspotters.com/ | grep -ci 'password'
```

→ a number above `0`: the Cat Spotters password page is back.

**What rolling back does not undo:** reports and sightings sent while the pass was off stay in the database. Anyone who copied what they saw has copied it. The tester key and the website password still work (they were never deleted), which is why the gate code is only removed *after* a clean launch (SYC-114).

**Other things that look like launch trouble but are not a rollback reason:**
- A visitor on a phone with no signal sees an error: the site needs a signal to open (SYC-169).
- "Too many tries": ten wrong passwords in 15 minutes, and nobody needs the password after the switch.
- Report refused with `challenge_required` only on `syros`: the Turnstile address work in section 4 is missing. Roll back, fix, redo.

**Don't roll back by touching the database or the code.** The setting is the whole way back.

---

## 7. What is still blocking (live Linear, 24 Oct 2026)

| Ticket | Title | Linear state | What it blocks |
|---|---|---|---|
| [SYC-306](https://linear.app/fair-shake/issue/SYC-306) | Launch address, widget, hostname list | **Backlog.** Address decided (`syros.catspotters.com`, 18 Oct); nothing else done | Everything in section 4 |
| [SYC-66](https://linear.app/fair-shake/issue/SYC-66) | Privacy policy on catspotters.com | **Backlog.** Page is 404 | "Launched" per the plan (A11) |
| [SYC-229](https://linear.app/fair-shake/issue/SYC-229) | Same proxy hops on every address | **Done** (14 Oct, no code), but never measured for `syros` | Step B3 |
| [SYC-191](https://linear.app/fair-shake/issue/SYC-191) | Sign-in Worker's address | **Backlog** | Not a launch blocker while `apptest` stays up (B7) |
| [SYC-130](https://linear.app/fair-shake/issue/SYC-130) | Claiming a cat / home description | **Done** (14 Oct), merged in the live build's history | Live behaviour still to be checked (A10) |
| [SYC-201](https://linear.app/fair-shake/issue/SYC-201) | Pre-launch test data | **Done** (4 Oct): kept | Nothing |
| [SYC-170](https://linear.app/fair-shake/issue/SYC-170) | Turnstile on the report forms | **In Progress** | A real token seen in the log (A2) |
| [SYC-114](https://linear.app/fair-shake/issue/SYC-114) | Delete the gate code after launch | **Backlog** | Nothing before launch; step 0 (blurring) is A12 |
| [SYC-173](https://linear.app/fair-shake/issue/SYC-173) | Report inbox is Syros Cats' | **Backlog** | The "report reaches the team" check |
| [SYC-662](https://linear.app/fair-shake/issue/SYC-662) | The website's Turnstile address is `apptest` only | **Done** (24 Oct, PR #319 merged) | **Not live until published.** Then the Friday checks can use it |
| **New:** [SYC-663](https://linear.app/fair-shake/issue/SYC-663) | Claude's Cloudflare token can't edit the Turnstile widget | **Backlog** (filed 24 Oct) | Step B4 is Samuel's, not Claude's |

---

## 8. Who does what, in one list

**Samuel:** B1 link the domain in Replit · B4 add the address to the Turnstile widget (or make a token for Claude) · B5 `TURNSTILE_HOSTNAMES` (optional now) · B6 `PUBLIC_APP_ORIGIN` · S2 set `PRELAUNCH_GATE=off` · pull `main` in Replit's Git pane before any publish that needs new code · OK for each probe that writes data or emails someone (A2, the sign-in link, the test report, the Help feed a cat tap) · approve the privacy wording (SYC-66).

**Claude:** DNS records (B2) · the proxy check (B3) ·  checks A1, A3 and everything in S4 · every publish and the wait for the new build · recording on Linear · a push notification at each checkpoint. Claude never types or sees a secret value, never prints the Cloudflare token, and does not send any email or create any data without Samuel's OK first.
