# SYC-3: "Keep my spots safe" — implementation plan (awaiting Samuel's approval)

**Linear:** SYC-3. **Status:** plan only. Nothing here is built, published or configured.
**Design (approved, not reopened here):** `docs/specs/email-capture.md` §3.0, §4, §5.1, §8 · `docs/specs/DECISIONS.md` Part 2d · `docs/specs/privacy-policy.md` ("Keep my spots safe") · the safeguards in `docs/specs/team-access-and-welfare-queue.md` §2.4–2.6, §8.1.
**Checked against:** `origin/main` at `d2b9ca1` (29 Sep 2026) for the first draft. **Refreshed 6 Oct 2026 against `origin/main` at `d10e5c3`**, open PRs #87, #89, #90 and #91, the SYC-63 plan branch (`origin/claude/syc-63-deletion-plan`), the SYC-42 plan, and Linear SYC-3, 42, 45, 134, 135 and 179. Every "exists today" claim below names the file, commit or PR it was read in.

---

## In plain English

**What a spotter will experience.**

- **Starting out.** The last onboarding step says *"Don't lose your spots"*. You can add an email so you can get your spots, points and badges back if you lose or change your phone, or you can tap **Skip**. Both buttons are the same size. Skipping costs nothing.
- **Checking it's you.** If you add an address, one email arrives asking *"Is this you?"*. Until you tap **Yes, that was me**, the address can't be used to restore anything, and nothing else is sent to it.
- **Getting your spots back.** On a new phone or browser, the first onboarding screen offers *"Already a spotter? Get your spots back"*. You type the address and we email a link. **You open the link on the phone that's getting the spots back**, press one button, and your username, points, badges, named cats and collection are there.
- **The old phone.** The next time it talks to us, it shows *"Your spots moved to a new phone"* and stops acting as you.
- **What it can't do.** A username never restores anything, because usernames are public. The news email never restores anything either. Restoring needs a connection: you can't add the address, or get your spots back, while offline.

**What testers get.** Testers who add an address before their browser forgets them can get everything back. Testers who have already lost their spots can't use it, because they never added an address. Decision 1 below covers them and the weeks before this ships. Since 1 Oct, iPhone testers on Safari 16.4 or newer already see an "Add to Home Screen" card, which stops Safari's 7-day clear-out (SYC-134, live).

**Why it's safe.** Whoever can open the "keep my spots safe" inbox can take the collection, and the screen warns about exactly that. On top of that: the link works once, lasts 15 minutes, is used up only when the button is pressed (so email scanners can't burn it), is rate-limited, and only works on the phone that asked for it. We reply the same way whether or not we know the address, so the form can't be used to find out who has one.

---

## Decisions for Samuel

Decisions 1–5 were **decided by Samuel on 30 Sep 2026, each as recommended**. The 6 Oct refresh found that none of them needs reopening, but it raised two new ones, **Decisions 6 and 7**. The plan as a whole is still awaiting his approval.

### Decision 1 — What do we do for testers before this ships?

**Decided by Samuel, 30 Sep 2026:** (a) now, after the SYC-134 iPhone check, plus (b′) after Slice 1; not (b). Every tester is told to use only apptest.catspotters.com.

**Where it got to (6 Oct):** (a) is done. The iPhone check passed on 30 Sep (SYC-134), and the card has been live since the Neon cutover on 1 Oct, for iPhone and iPad Safari 16.4 or newer only. Older iPhones wait on SYC-146, and iOS Chrome on SYC-139. (b′) is SYC-135, still waiting on Slice 1, with its list of testers who lost their spots.

**The situation (checked 30 Sep, SYC-3 comment).** On the website, a tester's identity lives only in that browser's storage for that one web address. Safari clears it after 7 days without a visit. So do private browsing, clearing browsing data, switching browser and opening a different address. A tester whose storage goes is sent back to onboarding, and their old username is already taken. Their spots are still safe on the server, but nothing can link them to them again.

| Option | What testers experience | Benefits | Risks |
|---|---|---|---|
| **(a) An "Add to Home Screen" nudge**: a one-line banner on the website on iPhone, plus a WhatsApp message | A tester adds the app to their Home Screen and opens it from there from then on | Cheap: a few hours of work and no server change. Home Screen web apps aren't subject to Safari's 7-day rule | **On iPhone, a Home Screen web app keeps its storage separately from Safari.** A tester who adds it today and opens it from the icon may start as a stranger and have to onboard again, which is the exact thing we're trying to stop. The web build has no web-app manifest today (`app.json` → `web` holds only a favicon), so how iOS treats the icon isn't known. **Needs checking on a real iPhone before anyone is told to do it**, and the answer may differ between iOS versions, so check on the versions testers actually use. It doesn't help anyone who has already lost their spots. |
| **(b) Staff-assisted re-link**: a tester who lost their spots messages Samuel; Samuel confirms it's them over WhatsApp; Claude runs a `db-ops` command that moves the old spotter onto the tester's new browser | "Message Samuel" and wait for him to reply and for Claude to run the command | The only option that rescues someone who **already** lost their spots | You rejected staff-assisted recovery on 28 Sep as "slow and easy to trick", and that is still true. Usernames are public, so a stranger can claim any of them, and the only protection is Samuel recognising the person. It also isn't cheap: the tester's new browser has to show a code Claude can use, and the command needs the same careful "move the spotter" step as Slice 1. Built early, it's a second, less protected way to take over a spotter, running against the live database. |
| **(b′) Staff adds a restore address, then the tester uses the normal restore** (only possible after Slice 1 ships) | "Message Samuel", he checks it's them, then the tester gets the normal email link and presses the button | Rescues testers who lost their spots. The risky part stays in the normal flow: the tester still has to open the link from their own inbox, on their own phone. Staff only record an address, they never move a spotter | Still relies on Samuel knowing it's really them. Only testers he knows personally. It has to be retired at launch (ticket to file) |
| **(c) Nothing** | Testers who lose storage start again | No work | Testers lose collections they've built up, which is the exact complaint behind this ticket, and some will stop testing |

**Recommendation: (a) now, once it's been checked on a real iPhone, and aimed at new testers (SYC-134); then (b′) after Slice 1 for anyone who has already lost spots (SYC-135). Not (b).**
- Check first whether the Home Screen icon on iPhone shares Safari's storage. If it does, send the nudge to everyone. If it doesn't, send it only to testers who haven't started yet, and tell existing iPhone testers to **open the site at least once a week** instead.
- Meanwhile, keep a list of testers who lose their spots (one Linear ticket, with their old usernames) so (b′) can bring them back once Slice 1 is live.
- **Tell every tester to use only `apptest.catspotters.com`**, never a `replit.app` address. This costs nothing and matters for the Neon move (see "How this fits the Neon move").

Draft WhatsApp message for now (if you pick (a); fill in the iPhone line once it's been checked):

> Quick Cat Spotters tip 🐈 If you use it in a web browser, your spots are kept in that browser. If Safari clears it (it does this after a week without a visit), or you switch browser or phone, the app forgets you. Until we've built a proper fix (coming soon):
> • Always use **apptest.catspotters.com**, and no other address.
> • [iPhone: Add to Home Screen / Open it at least once a week.]
> • If the app ever asks you to pick a username again, don't worry, your spots are safe with us. Message me with your old username and I'll note it down so we can bring them back.

### Decision 2 — Only the phone that asked can use the link (a clarification)

**Decided by Samuel, 30 Sep 2026:** only the phone that asked can use the link.

The spec says the link "moves the collection … to the new phone". It doesn't say what happens when the link is opened somewhere else. The plan makes it precise: **the link only works on the phone or browser that asked for it.**

| Option | Benefits | Risks |
|---|---|---|
| **A. The link works only on the phone that asked** | Closes the "trick someone into clicking" takeover. A stranger who knows your address can ask for a link, but the link lands in *your* inbox, and pressing its button on *your* phone does nothing for them. It also makes sure the spots go where the person is actually using the app | If the email app opens the link in its own built-in browser (the Gmail app on iPhone can), that browser is a different "phone" and the page says *"Open this link in the browser where you asked for it"*, with a copy-link button. Parents reading the link on their own phone have to open it on the child's phone |
| B. A plus a short code in the same email, typed on the phone that asked | Gets round the wrong-browser problem, and a parent can read the code out | **Rejected on security grounds.** An attacker asks for a link for *your* address from *their* phone, and their phone is then the one allowed to type the code. With a 6-digit code, 5 tries per link and the rate limits, that's about a 1-in-700 chance a day, which adds up over a year. A code long enough to be safe (8+ characters) is hard for children to type. It also changes the approved design |
| C. Whoever presses the button gets the spots | Closest to the spec's wording | A stranger can ask for a link for your address and hope you press the button, and then your collection is theirs. It's the classic "click to confirm" trick. The spots also land in whichever browser opened the link |

**Recommendation: A.** It's the safe reading of the approved design. The email and the page say plainly, *"Open this on the phone that's getting your spots back"*.

### Decision 3 — One parent's email for two children

**Decided by Samuel, 30 Sep 2026:** a picker when several spotters share one address.

The spec tells under-15s to use a parent's email, so siblings will share one. The spec doesn't say what happens then.

**Recommendation:** after the button page has proved the inbox, it lists the spotters kept safe with that address by username, with one button each (*"Move Lili's spots to this phone"*). Only someone who has opened the link sees the list. Two spotters sharing an address are never merged, and neither is told about the other. The alternative, allowing only one spotter per address, would silently stop the second child's parent from protecting them.

### Decision 4 — Store the restore address, or only a scrambled fingerprint of it?

**Decided by Samuel, 30 Sep 2026:** store only a keyed fingerprint and a masked form.

The spec's storage note (§9) says an address is stored. For this email the app never has to write to the address unprompted: the person types it again when restoring, and we send the link to what they typed.

| Option | Benefits | Risks |
|---|---|---|
| **A. Store only a keyed fingerprint (HMAC) and a masked form (`s•••@gmail.com`)** | If the database ever leaks, it doesn't hold parents' and children's addresses. Settings can still show the masked form | We can never email these people unprompted, for example a "still want this?" message after 24 months. If the fingerprint key is lost, everyone has to add their address again. It's hard to reverse later without asking everyone to re-add |
| B. Store the address, like news addresses will be | Simple. Consistent with SYC-45. Allows future unprompted mail | A leak exposes a list of emails, many of them parents of children |

**Recommendation: A.** Nothing in the approved design sends unprompted mail to this address, and it's the more protective choice for a list that will be mostly children's parents.

### Decision 5 — The "is this you?" and "forget this address" pages sit outside the tester password

**Decided by Samuel, 30 Sep 2026:** the confirm and forget pages sit outside the tester password; the restore page stays behind it.

See "The website password gate" below. **Recommendation:** these two small pages and their two API calls are reachable without the tester password, because a parent confirming an address won't have it. They're protected by their own one-time token, as the staff pages are. The restore button page stays behind the password.

### Decision 6 (new, 6 Oct) — One "is this you?" system for every email, or one just for keep-safe?

**Awaiting Samuel.**

**Why it's new.** The SYC-42 plan (approved 1 Oct) says the reporter's email in its Slice 3 reuses this plan's "is this you?" tables, and whichever of the two is built first creates them. SYC-3 will be first. But Decision 4 stores only a fingerprint of the address, and that can't work for a reporter: we have to write to them unprompted when the team acts on their report (`team-access…` §8.5 keeps their address for 90 days after the report closes). SYC-45's news emails need the real address too. `welfare_reports.reporter_contact_id` already exists on main, waiting for a table to point at (`0004_welfare_reports_and_mail_outbox.sql`).

| Option | What people experience | Benefits | Risks |
|---|---|---|---|
| **A. One shared system. Each address is stored as one row per purpose (keep-safe, report, news). A keep-safe row never holds the address itself, enforced by the database, while report and news rows do** | Same as today's design: one "is this you?" email per purpose, each confirmed and withdrawn separately. Nothing changes for a spotter | Built once, tested once, used by all three. SYC-42 Slice 3 is unblocked the day this ships. Decision 4's protection is kept, and the database refuses to store a keep-safe address. Deletion (SYC-63) has one place to clear | Slightly more design work in Slice 1 (a day or so). A mistake in the shared part would affect all three uses, so it needs the takeover tests and the adversarial review |
| B. Build only the keep-safe tables now. SYC-42 Slice 3 builds its own for reporters later | Same for spotters. Reporters might get a differently worded or differently behaving "is this you?" email | Smallest SYC-3 build | Two systems doing the same safety-critical job, which is the duplication the SYC-42 plan was written to avoid (its review finding R13). Deletion has to know about both. SYC-45 would then pick one, or build a third |
| C. Store the real address for keep-safe too, in one simple table | Same for spotters | Simplest shared table | Reverses Decision 4. A database leak would expose a list of mostly parents' and children's addresses that we never needed to keep |

**Recommendation: A.** It's what the SYC-42 plan already assumes, and it keeps Decision 4's promise by making the database itself refuse a keep-safe address.

### Decision 7 (new, 6 Oct) — Someone has already started again on the new phone before finding "Get your spots back"

**Awaiting Samuel.**

**Why it's new.** The plan lets only an empty phone receive old spots: the button refuses a phone that already has a username (Slice 1.6, test 11). But the easiest mistake on a new phone is to skip past *"Already a spotter? Get your spots back"* on the first screen, pick a new name, and spot a cat or two before remembering. Today that person would be stuck. The refresh also found that a new phone can file a welfare report before it has a name (SYC-42, live since 3 Oct), so "the starter phone never has any data" is no longer guaranteed.

| Option | What the spotter experiences | Benefits | Risks |
|---|---|---|---|
| **A. "Get your spots back" also sits in Settings. If this phone already has a spotter, a warning appears first: *"This phone is spotting as Nikos. If you get your old spots back, this phone stops being Nikos. Nikos's 2 spots stay on the map, but they won't count towards your points."* Then the normal email-and-button restore** | They can always get back to their real collection. The new name's spots aren't lost to the cats; they just stay under the abandoned name | No data is copied or merged, so the "nothing moves" design holds. Simple to explain. Reports already sent stay with the charity, and anything still waiting to send goes under the restored spotter | The abandoned name stays taken and its points are stranded. Its spots still show as "Discovered by Nikos". A child might tap through the warning without reading it, but they'd still end up with their real collection |
| B. Same as A, but the new name's spots move into the restored collection | Everything ends up in one place | Feels the most complete | Moves sightings between identities across an append-only history. That's the risky rewrite the plan's core idea avoids, and the spec says two spotters are never merged (Decision 3). Much more work and a new takeover surface |
| C. Keep the plan as written: only a brand-new phone can restore | Someone who started again has no way back. They'd have to clear the browser or reinstall, which loses the new name anyway | Least work | A dead end, and the most likely mistake on a new phone ends in it. It would generate "message Samuel" requests, which is the staff-assisted recovery that was rejected |

**Recommendation: A.** It covers the common mistake without merging anyone. The decision on merging (B) can be revisited after launch if people ask for it.

---

## What exists today, and what has to be built first

Refreshed 6 Oct 2026 against `origin/main` at `d10e5c3`. A Sonnet evidence pass read the code and migrations, and the session model spot-checked `send.ts`, the migration list and PRs #35 and #41 with `gh pr view`.

| Needed | Exists? | Evidence |
|---|---|---|
| Device identity (id, secret, username) | **Yes. Secrets are now strong** (Web Crypto, `expo-crypto` on native; it throws rather than fall back to `Math.random`). Still in AsyncStorage / localStorage | `artifacts/cat-spotter/context/DeviceContext.tsx` (`makeDeviceSecret`); SYC-136, PR #35, merged 30 Sep |
| Server check of the device secret, bound on first use | **Yes**, SHA-256 in `device_credentials` | `artifacts/api-server/src/lib/deviceAuth.ts` |
| Every route acting as a spotter checks the secret | **Yes, now.** `POST /cats`, `POST /cats/:id/claim` and `PATCH /cats/:id` call `verifyDeviceSecret` | `routes/cats.ts` (lines 123, 294, 368); SYC-107, PR #41, merged 1 Oct; `cats.deviceAuth.test.ts` |
| `device_moved` answer | **No** | `grep device_moved` finds nothing |
| One send function, a closed list of purposes, Resend through `fetch` | **Yes.** It was built to this plan's interface by SYC-42 Slice 0. `keep_safe_verify`, `restore_link` and `forget` are **already in the list** as transactional mail from `hello@mail.catspotters.com`. Only `welfare_alert` is switched on. Public purposes are refused unless a suppression check (and, for verified-only purposes, a verification check) is plugged in. No templates exist yet | `artifacts/api-server/src/lib/mail/send.ts` (`MAIL_PURPOSES`, `PURPOSE_RULES`, `DEFAULT_ENABLED`); PR #54, merged 2 Oct |
| Mail sent after the response, retried | **Yes:** `mail_outbox` (queued → sending → sent/failed, claimed with `FOR UPDATE SKIP LOCKED`) and a drain every 10 minutes. It's shaped for welfare alerts: `report_id` and a welfare-only builder in `drainDue` | `0004_welfare_reports_and_mail_outbox.sql`; `lib/mail/outbox.ts`; `.github/workflows/mail-drain.yml`; PR #55 |
| Address fingerprint in mail logs | **Unkeyed SHA-256** (`hashRecipient`) written to logs and `mail_outbox.recipient_hash`. SYC-179 says to replace it with this plan's keyed fingerprint before any public purpose is switched on | `send.ts` `hashRecipient`; SYC-179 |
| Email verification ("is this you?"), consent records, suppression list | **No.** No such tables. `welfare_reports.reporter_contact_id` exists as a bare nullable integer waiting for one (Decision 6) | `lib/db/src/schema`; `0004` |
| Rate limits counted across servers | **No.** Still in memory, per server | `middlewares/rateLimit.ts`; SYC-105 |
| One-time pass spent in Postgres, identical refusals, `Origin` check | **Yes, merged:** `team_handoff_spent`, `people.session_version`, `lib/teamAuth/refuse.ts`, `Origin` check in `routes/team.ts` | PR #28, merged; migration `0003_people_and_staff_sign_in.sql` |
| Pre-launch gates | **Yes.** `/api/healthz`, `/api/internal/*` and `/api/team/*` skip the pass. `/api/mail/*` doesn't yet (Decision 5 adds it). The password page keeps the full address, `?t=` included | `prelaunchGate.ts`; `serve-web.js:512` (`safeNext`, defined at 124) |
| Database | **On Neon** since the 1 Oct cutover. The old Replit database is retired. Migrations go through `db-ops` | `docs/runbooks/neon-database.md`; SYC-121 Done |
| Onboarding | Unchanged: Welcome → How it works → Language & username. "I already have an account" still opens an explanation | `WelcomeStep.tsx:55`, `i18n.ts:199` |
| Push token per spotter | One row per device id | `lib/db/src/schema/notifications.ts` |

**What we reuse from PR #28 rather than copy:** the Postgres pattern for one-time passes (a conditional write that only one server can win), the identical-refusal helper, and the `Origin` check. We **don't** reuse `people` or `session_version`: a spotter isn't a person on the staff list. The equivalent of "sign out everywhere" for a spotter is replacing the device secret's fingerprint (see "How moving a spotter works").

**What we reuse from SYC-42:** the send function (switch on three purposes, add their fixed templates, plug in the suppression and verification checks), the API's one transactional key, and the outbox and drain for the restore and "is this you?" emails. The outbox gains a builder per purpose. The payload never holds the address in clear after sending.

---

## How moving a spotter works (the core idea)

**Nothing is copied or re-keyed.** Every table keys a spotter by their device id: `profiles`, `device_credentials`, `sightings`, `cats.discoverer_device_id`, `cats.owner_device_id`, `cat_subscriptions`, `notifications`, `push_tokens`, `observations.device_id` and, since SYC-42, `welfare_reports.reporter_device` (checked 6 Oct in `lib/db/src/schema`). `sighting_matches`, `report_state_events` and PR #89's `push_roundup_runs` have no spotter column. Rewriting that id across an append-only history would be large and risky.

Instead, **the new phone takes over the old device id, and the server replaces the secret that id accepts:**

1. The new phone arrives with a fresh id and secret of its own (its "starter id"), with no username and nothing spotted.
2. When the button is pressed, the server, in **one transaction**:
   - checks the link (below);
   - changes `device_credentials.secret_hash` for the restored id to the fingerprint of **the new phone's secret**. This is a single `UPDATE`, never a delete followed by an insert, because in that gap a request from the old phone would be bound as "first use" again;
   - records the replaced fingerprint on the link row, so the old phone can be told *why* it's refused;
   - deletes the restored id's `push_tokens` row, so the old phone stops receiving notifications;
   - deletes the starter id's credential. If the starter id has anything of its own (a name, sightings, a welfare report: Decision 7), that stays under the starter id, untouched. Nothing is moved.
3. The reply gives the new phone the restored device id and username. The phone stores them, keeps its own secret, loads the profile (points, badges, owned cats come from `getProfile`), and leaves onboarding.
4. **The old phone's next authenticated request** gets `403 {"error":"device_moved"}`. The server returns that code only when the secret presented matches a fingerprint replaced by a restore. A wrong guess still gets the ordinary `403`. The app then shows *"Your spots moved to a new phone"*.

**Why this meets "stops acting as that spotter at its next request":** every spotter route checks the secret. Since SYC-107 merged (PR #41, 1 Oct) that includes registering, claiming and renaming cats, so the prerequisite is met. The old phone's claim and rename screens (`ClaimCatSheet.tsx`) currently show a 401 as "Could not reach the server" and a 403 as "Only the owner of this cat can edit it". Slice 1.8 routes `device_moved` to the "moved" screen instead (SYC-3 comment, 1 Oct).

**Deletion (SYC-63, plan only, branch `claude/syc-63-deletion-plan`)** deletes the credential and leaves a "deleted" marker so the id answers `410` for ever. Its plan doesn't mention restore addresses yet. So: deletion must also delete the spotter's keep-safe row, its open links and the identifying parts of its consent events, and **a deleted spotter can never be restored** (the move's `UPDATE` finds no credential row, so redeem refuses). Whichever of the two PRs lands second adds that, and a test pins it (test 16).

**The username claim (SYC-214, PR #91, client-only)** adds an app-wide lock while a name is being claimed. The restore button waits for that lock to clear, so a half-finished claim on the new phone can't race the move.

---

## The smallest shippable slice, in order

### Slice 0 — prerequisites (mostly done)

1. ~~SYC-107: every spotter route checks the device secret.~~ **Done**, PR #41, merged 1 Oct.
2. ~~Strong device secrets for new installs (SYC-136).~~ **Done**, PR #35, merged 30 Sep. Existing secrets are left alone.
3. **Keep the link's token out of our logs.** This is already true: the API's log cleaner drops every query string (`artifacts/api-server/src/app.ts`, the `pino-http` `req` serialiser), and `serve-web.js` logs no requests. This step only adds a test that pins it for `/restore` and `/api/mail/*`. It folds into Slice 1 as its first commit. Replit's own access logs may record full addresses. That's outside our code, and a restore token from a log is useless to anyone else because it only works on the phone that asked (Decision 2).

### Slice 1 — "keep my spots safe" on the website (what testers need)

**One migration** (see "Migrations"). Built in this order, one commit each. The tables below are written for **Decision 6 option A** (one shared system). If Samuel picks B, `email_contacts` narrows to keep-safe rows only and SYC-42 Slice 3 builds its own.

1. **Tables** (one migration):
   - `email_contacts`: `id`, `purpose` (`keep_safe` | `report` | `news`), `address` (nullable), `address_hmac`, `address_mask`, `device_id` (nullable; the spotter, for keep-safe), `status` (`pending` | `confirmed`), `created_at`, `confirmed_at`. **A database check refuses any `keep_safe` row whose `address` isn't empty** (Decision 4). One keep-safe row per spotter. Index on `address_hmac`, not unique, because siblings can share one (Decision 3). `welfare_reports.reporter_contact_id` gains its foreign key here. This slice only writes `keep_safe` rows; the others are SYC-42 Slice 3's and SYC-45's.
   - `mail_tokens`: `token_hash` (primary key), `purpose` (`verify` | `forget` | `restore`), `contact_id` (for `verify`/`forget`), `address_hmac`, `device_id` (for `verify`/`forget` the spotter; for `restore`, **the phone that asked**), `created_at`, `expires_at`, `used_at`, `restored_device_id`, `replaced_secret_hash`, `attempt_ip_hash`. Rate-limit counts per address and the global daily ceiling are **counted from this table**, so they hold across servers without waiting for SYC-105.
   - `email_consent_events`: exactly §5.6: what, where, wording version, when, language, verified at, withdrawn at. Append-only, with the data spine's redaction for deletion. Built here so that SYC-45 uses it rather than inventing a second one.
   - `email_suppressions`: `address_hmac`, reason, when. Used by "Forget this address", the three-lifetime cap, and later by SYC-42 Slice 3 and SYC-45.
   - (`mail_outbox` already exists and isn't recreated.)
2. **Switch on the existing send function** (`artifacts/api-server/src/lib/mail/send.ts`, from SYC-42). Add the fixed templates for `keep_safe_verify`, `restore_link` and `forget`. Plug in the suppression check and the verification check against the new tables, and add the three purposes to `DEFAULT_ENABLED`. The restore and "is this you?" emails go through the outbox, which gains a builder per purpose. For keep-safe mail the address is held in the outbox row **only until it's sent or given up on**, then cleared, so Decision 4 still holds at rest. **SYC-179 lands here:** `hashRecipient` becomes the same keyed fingerprint as `address_hmac`, before any public purpose is switched on. The fingerprint key is a new secret (rollout step 2).
3. **Adding an address**: `POST /api/keep-safe/:deviceId` (device secret required) with `{ email, language, wordingVersion, surface }`. It stores `pending`, writes the consent event and sends one "is this you?" email, subject to §4.4: one per address per 24 hours, three in the address's lifetime then suppression, the per-IP limit, and a **global daily ceiling that fails closed**. The reply is the same whatever happened. Changing the address replaces the row and needs confirming again. `DELETE` removes it (**Remove** in Settings) and writes a "withdrawn" event.
4. **Confirm and forget pages**: `GET /api/mail/confirm?t=` and `GET /api/mail/forget?t=` return a tiny server-rendered page with one button. **The GET never changes anything**, so scanners can't confirm or forget an address. The button POSTs to the same path, with the same `Origin` check as PR #28's sign-out. "Confirm" sets `confirmed`. "Forget" deletes the row and its tokens and adds the fingerprint to `email_suppressions`. Tokens are 32 random bytes, stored hashed, and last 7 days (§9).
5. **Asking for a restore**: `POST /api/restore/request` (device secret required, **for the phone asking**) with `{ email }`. If the address is `confirmed` for at least one spotter, a `restore` token bound to the asking phone is created and the link email is queued. The response is always `202 {"status":"sent_if_known"}`, **padded to a deadline** (record the start, then wait until start + 800 ms), and the send happens **after** the response: the email goes into the outbox and the outbox's immediate attempt (`kick()`) sends it straight away. The 10-minute drain is only the retry. **The drain never sends a restore link whose token has expired**; it marks the row given up and clears the address. Limits (team-access §2.6): 3 per address per 15 minutes, 20 per IP per hour, at most 3 unexpired links per address (the oldest expires to make room), and the global ceiling.
6. **Pressing the button**: `POST /api/restore/redeem` (device secret required) with `{ token, deviceId (the restored one, from the picker) }`. In order: token exists, isn't expired and is a `restore` token; **the asking phone is the one calling**; the chosen spotter really is kept safe by that token's address and is `confirmed`; the calling phone has no username, **or** (Decision 7 A) the request carries `abandonCurrent: true`, which the app sends only after the warning screen; then the conditional write `UPDATE mail_tokens SET used_at=… WHERE token_hash=? AND used_at IS NULL AND expires_at>now() RETURNING …` and the move, all in one transaction. **The same phone sending it again within 60 seconds** gets the same answer (a double tap or a back button isn't a lockout). Precisely: when the conditional write returns no row, the handler re-reads the token; if `used_at` is under 60 seconds ago, the caller is the phone that asked, and `restored_device_id` equals the requested spotter, it returns that spotter's id and username again and changes nothing. Otherwise it refuses. Any other failure gets one fixed refusal, `401 {"error":"link_not_valid"}`, and the real reason goes to the server log with the token's hash prefix. Limit: 30 per IP per hour.
   - `POST /api/restore/peek` (device secret, the asking phone) with `{ token }` returns the list of usernames for the picker (Decision 3). It's the same check as redeem, but reads only.
7. **`device_moved`**: in `verifyDeviceSecret`, on a secret mismatch, look for a used `restore` token whose `replaced_secret_hash` equals the fingerprint presented. If there is one, return `403 {"error":"device_moved"}`; otherwise, today's `403`.
8. **The app**:
   - **Onboarding, last step** (§3.0 copy, word for word): *Don't lose your spots* · the email field · the unticked news box, **hidden in this slice** (it arrives with SYC-45, and a box that did nothing would be a broken promise) · **Save my spots** and **Skip**, equal in size. Claiming a username no longer ends onboarding by itself: a local "keep-safe offered" flag does. If offline, the step says *"You're offline. You can add this later in Settings"* and lets them continue. (Spotting itself still works offline as it does today; only adding the address and restoring need a connection.)
   - **Welcome**: "I already have an account" becomes **"Already a spotter? Get your spots back"**, leading to the email field and then *"If that address is keeping a spotter safe, we've sent a link. Open it on this phone. It works once and lasts 15 minutes."*
   - **The `/restore` page** (an app route, so it can read this browser's own id): it reads `t`, removes it from the address bar (`history.replaceState`), calls `peek`, shows the picker, or one button if there's only one spotter, calls `redeem`, stores the restored id and username, and opens the app. Opened on the wrong browser, it says so and offers **Copy link** (Decision 2).
   - **"Your spots moved to a new phone"**: shown on any `device_moved`. The offline queue stops sending. One button, **Start again as a new spotter**, clears this browser's identity and goes back to onboarding. Sightings saved on this phone but not yet sent are **kept** and sent under the new spotter once they've picked a username. The screen says so: *"3 spots saved on this phone will be sent when you start again."*
   - **Settings**: a *Keep my spots safe* row: off → the same screen as onboarding; on → *"Saved to s•••@gmail.com"* with **Change** and **Remove**; pending → *"Check your inbox to confirm"*. Plus **Get your spots back** (Decision 7), with its warning when this phone already has a spotter.
   - **Claim and rename on the old phone**: `ClaimCatSheet.tsx` sends `device_moved` to the "moved" screen instead of "Only the owner of this cat can edit it".
   - **The one-time offer** (the spec's "first badge" offer, §8.3), for spotters who **already** have a badge when they first open this version, which means every current tester: the same screen, once, on first open. Declining is one tap and it's never offered again on this phone.
9. **Emails** (drafts in the appendix; Greek and French from native speakers, SYC-4).

### Slice 2 — the phone apps (SYC-137; ships with the store builds, SYC-32)

1. **The key moves into secure storage** (`expo-secure-store`) on iPhone and Android: the id and the secret move across once, on first launch, and are then read from there. On iPhone they survive deleting and reinstalling the app. On Android and web nothing changes. That's what the email is for.
2. **Links open the app.** The `/restore` page, loaded in a phone's browser, shows **"Open in Cat Spotters"**, which opens `syroscatspotters://restore?t=…` (the scheme in `app.json`), and the app does the same peek → button → redeem. Universal links and app links are a later nicety, not needed.
3. Both run on a real TestFlight and Play build before they're switched on.

### Later (not in this work)

SYC-45 builds the news address on the same send function, consent events and suppression list, and adds the news box on the onboarding step. It also adds a test that **a news address can never be used to restore**.

---

## Where this plan reads the spec, rather than just copying it

No conflict was found between the approved spec and the code on `main` that stops this work. These are the places where the plan has to choose, and each is either a decision above or a narrow choice listed here for review:

- **The link only works on the phone that asked**: Decision 2.
- **Several spotters on one address**: Decision 3.
- **Only a fingerprint of the address is stored**: Decision 4. §9 describes storing the address itself.
- **The news box on the onboarding step is hidden until SYC-45 builds news**, because a box that sent nothing would break a promise. Everything else in §3.0 is word for word.
- **Adding the address needs a connection.** §4.3 says addresses typed offline are queued and checked later. For the keep-safe address, this slice asks people to add it in Settings once they're online instead. Queuing it offline can come with SYC-45's general queue.
- **Existing testers get the "first badge" offer on their first open of this version**, because they already have a badge and would otherwise never see it (§8.3's "when they first have something to lose").
- **Mail identity: follows §5.1** (both keep-safe messages transactional). §7.3's general rule that every address typed in the app is checked from `news.` reads the other way. §5.1 and §8 are the more specific and later text, so the plan follows them and changes nothing.

## How this fits the Neon move (SYC-121)

- **The cutover is done (1 Oct).** The migration is applied with `db-ops` to Neon `development`, then `production`, before the publish that uses it, following the runbook's post-go-live procedure. (`db-ops verify` no longer works after the cutover, so the check afterwards is a read-only query on Neon.)
- **Testers must stay on `apptest.catspotters.com`.** A browser keeps a separate store per web address. The cutover keeps the address and moves it between projects, so testers keep their identity. That's why the WhatsApp message says to use only that address.
- **Restore links are always built from a fixed setting, `PUBLIC_APP_ORIGIN=https://apptest.catspotters.com`, and never from the request's `Host` header.** Otherwise someone could make the link point at a site of their choosing, or at a `replit.app` address with empty storage. A test pins it.
- ~~Cutover rollback and carry-back~~: moot. The old Replit database is retired.

## The website password gate

- **The restore page stays behind the tester password.** It has to run in the browser that asked, and that browser has already got past the password to reach onboarding. If its cookie has gone anyway (it lasts 28 days, and clearing browsing data removes it), the password page keeps the full address, `?t=` included, and returns the tester to it after the password (`serve-web.js:512`; a new test pins that `t` survives). The 15-minute link rarely outlives a cookie.
- **The restore API calls stay behind the API pass.** The website sends the cookie, and store builds send the tester key.
- **The confirm and forget pages and their POSTs sit outside both gates** (Decision 5): the API gate's allow-list gains `/api/mail/*`, next to `/api/team/*`. A parent confirming an address may not be a tester. These routes do one thing with a one-time token and show nothing else. A test proves every `/api/mail/*` route refuses without a valid token.
- Every page carrying a token sends `Referrer-Policy: no-referrer`, so the token never goes to the map tile server.

## Migrations

**One is unavoidable**: there is nowhere to keep a restore address or a one-time link today. It's additive only: four new tables (`email_contacts`, `mail_tokens`, `email_consent_events`, `email_suppressions`), plus the foreign key on `welfare_reports.reporter_contact_id` (Decision 6 A only). No existing column changes.
- **Its place in the queue:** after whatever merges first. Main has `0000`–`0008`, and open PR #89 takes `0009`, so this will be `0009` or later. It's generated with `pnpm --filter @workspace/db run generate --name keep_my_spots_safe` **on a rebase immediately before merge**. No test or document hard-codes its number; tests find it by the `_keep_my_spots_safe` suffix, as PR #28's do. It has a hand-written rollback block (drop the foreign key, then the four tables, with a warning that opt-ins are lost).
- It reaches Neon only through the #13 runner, via `db-ops` (`-f target=development`, then `-f target=production -f command=migrate`), migrate before publish, as in `docs/runbooks/neon-database.md`. SYC-121's session owns `db-ops`. This work adds no command to it.

## Tests

Following the repository's pattern: route tests with vitest and the `lib/db` throwaway database. Every **(M)** test is also a **mutation check**: break the guard on purpose, see the named test go red, then restore it.

**Takeover attempts, the ones that matter most:**
1. **A guessed username restores nothing.** No restore route accepts a username. Sending one is ignored. A confirmed address for spotter A can't be used to move spotter B, even if B's username is typed into the picker **(M: let `redeem` accept any device id → red)**.
2. **A replayed link.** A used link is refused after 60 seconds. Within 60 seconds, a second POST from the same phone returns the same result and moves nothing twice **(M: drop `used_at IS NULL` from the write → red)**. Two simultaneous redeems: exactly one wins.
3. **The link on a second device.** A link used from a phone other than the one that asked gets `link_not_valid` and moves nothing **(M: skip the asking-phone check → red)**.
4. **The old phone carrying on.** After a move, **every** route that acts as a spotter, listed from `routes/*.ts` at build time (profiles ×4, notifications ×4, push token, sightings ×2, cats register/claim/rename, welfare reports and their photos, and anything added since), returns `403 device_moved` for the old secret **(M: return the generic 403 → red; M: skip SYC-107 on one cats route → red)**. The restored id's push token is gone, and a notification fan-out afterwards doesn't reach the old token.
5. **No gap for "first use" binding.** A request from the old phone racing the move can never bind itself **(M: turn the `UPDATE` into delete + insert → red, using a test hook between the two statements)**.
6. **Unconfirmed and forgotten addresses restore nothing.** `pending` → no email, and redeem refused. A suppressed address gets no email of any kind.
7. **Opening a link changes nothing.** A GET on `/restore?t=`, `/api/mail/confirm?t=` and `/api/mail/forget?t=` leaves the database unchanged, and the POST afterwards still works **(M: consume on GET → red)**.
8. **The form reveals nothing.** A known, an unknown, a pending and a suppressed address all get byte-identical replies, and response times overlap (the deadline pad) **(M: send inside the request → red on timing)**.
9. **Expiry.** A link is refused at 15 minutes and 1 second. A confirm token is refused after 7 days.
10. **Limits.** Each limit is enforced, and the per-address and global limits hold **across two server processes** (because they're counted in Postgres). The global ceiling fails closed and logs.
11. **The target must be empty, unless the person chose to leave it** (Decision 7). Redeem refuses a calling phone that already has a username unless `abandonCurrent` is sent; with it, the abandoned spotter's rows are all unchanged afterwards **(M: drop the username check → red)**. A restore waits for an in-flight username claim (SYC-214's lock).
12. **Links point at the right place.** A request with `Host: evil.example` still emails an `apptest.catspotters.com` link **(M: build from `req.host` → red)**.

**Everything else:**
13. Tokens and addresses never appear in a log line (API and website), and the only form ever returned is masked.
14. The send function refuses a purpose outside the list, checked with `@ts-expect-error` and at run time. The "is this you?" email carries nothing the sender chose.
15. The gates: `/api/mail/*` is reachable without a pass and refuses without a token. `/api/restore/*` still needs the pass. The password page returns you to `/restore?t=…` intact.
16. Deletion removes the keep-safe row, its tokens and the identifying parts of its consent events (joint with SYC-63). **A deleted spotter can't be restored**: redeem for a deleted id moves nothing and gets the fixed refusal.
16b. **A keep-safe row can never hold an address** (Decision 4): the database refuses the insert **(M: drop the check → red)**, and the outbox row is cleared after the send. Mail logs and `recipient_hash` use the keyed fingerprint (SYC-179): the hash changes with the key.
17. The app: the onboarding step's two buttons are equal in size and Skip goes straight in. The one-time offer shows once. `device_moved` shows the screen and pauses the queue, and unsent sightings survive "Start again". The `/restore` page removes `t` from the address bar.
18. Checked in a real browser at 390 px and desktop, the whole round trip on a local build with a fake mail endpoint: opt in → confirm → clear storage → restore → the old tab shows "moved".

## Rollout (after approval and review of the build PR)

1. Probe Resend through its API: `mail.catspotters.com` is verified (SYC-25), and the API's transactional key (`RESEND_API_KEY`, set for SYC-42 on 2–3 Oct) is present on the EU deployment. Nothing on `news.` is needed for this work.
2. Reuse SYC-42's transactional key (no second key). Create the fingerprint key. **Samuel pastes them into Replit's deployment secrets** from a terminal tab opened for him, so the values are never printed. They're never in a file, ticket or chat (team-access §2.11).
3. `db-ops` migrate: `development`, then `production`.
4. Publish. Probes: request a restore for an unknown address (`202`, no send in Resend's log), and run the full round trip with Samuel's own address on his phone.
5. WhatsApp message to testers (appendix). File the (b′) list if Decision 1 picked it.

## Model delegation

The session model is Opus 5.5.

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| Slice 0.3 (log-redaction test; 0.1 and 0.2 are done) | Haiku | Mechanical, a few lines | A log-line test that fails if the token appears |
| Slice 1.1 (schema, generate, rollback block) | Sonnet | An exact column list and the #28 precedent | `migrate:check` in CI; session model reads the generated SQL line by line |
| Slice 1.2 (switch on the send function, templates, outbox builders, SYC-179) | Sonnet | The function exists; this is wiring and fixed text | Tests 13–14; typecheck with `@ts-expect-error` |
| Slice 1.3–1.7 (tokens, redeem, the move, `device_moved`, limits) | **Opus** | *Escalated:* this is the takeover surface. A plausible-looking mistake (a delete-then-insert gap, a missing asking-phone check, consuming on GET) is a silent security hole that a green suite won't reveal | Tests 1–12, **every mutation check above**, and the adversarial review below |
| Slice 1.8 (app screens and flows) | Sonnet | Standard React Native work to exact copy | Component tests; browser check at 390 px and desktop by the session model |
| Slice 2 (secure storage, deep link) | Sonnet | Documented Expo APIs | A real TestFlight and Play build, run by Samuel with a script Claude writes |
| Adversarial review of the built change | **Opus**, in its own worktree | *Escalated:* it has to find the takeover paths the builder didn't think of | The session model checks every finding before it's fixed or dismissed |
| Rollout (keys, migrate, probes) | Session model | Handles secrets and production data, so it isn't delegated | The probes in rollout step 4 |

## Crash-proofing for the build

Its own worktree from fresh `origin/main`, one commit per numbered item, and a `CHECKPOINT.md` note after each (the file is git-ignored, so the commits are the durable record).

## Adversarial review of this plan

Reviewed by a Sonnet critic in its own worktree against the specs, `DECISIONS.md` Part 2d, the code on `main` and PR #28's branch. It found no new takeover path. Every finding was checked by the session model:

| # | Severity | Finding | What changed |
|---|---|---|---|
| 1 | Blocker | The draft called the choice of mail identity a spec contradiction and recommended the news identity for the "is this you?" email. `email-capture.md` §5.1 lists **both** keep-safe messages as transactional, and §8 was written with the SYC-3 decision, so the draft would have quietly changed an approved design. | The decision was removed. Both keep-safe messages send from `mail.`, as the spec says. The rollout no longer needs `news.` at all. |
| 2 | Minor | Slice 0.3 said the API's log cleaner needed changing. It already drops every query string (`app.ts`), and `serve-web.js` logs no requests. | Slice 0.3 now only adds a test that pins this, and says why a token in Replit's own logs is harmless: it only works on the phone that asked. |
| 3 | Minor | The "same answer within 60 seconds" retry on redeem wasn't spelled out. The conditional write returns nothing on a retry. | Slice 1.6 now says exactly how the retry is recognised and answered. |
| 4 | Minor | Whether a Home Screen icon on iPhone shares Safari's storage may depend on the iOS version. | Decision 1 now says to check on the iOS versions testers use. |

Checked and confirmed by the reviewer: the three cats routes that trust a device id (SYC-107) and every other route's secret check; the single-`UPDATE` move and the "first use" gap it avoids; the `device_moved` signal; unsent sightings following the live device id; the gates' current exemptions and `safeNext` keeping `?t=`; PR #28's contents; `device_credentials` being carried back in a Neon rollback; the rate limits matching team-access §2.6; and the plain-English terms.

### Refresh review, 6 Oct 2026

The refresh changed the plan's shape (Slice 0 mostly done, the send function reused, the shared tables in Decision 6, the new Decision 7), so the session model did a separate critical read of the changed parts, assuming they were wrong.

| # | Severity | Finding | What changed |
|---|---|---|---|
| R1 | High | Sending the restore link through SYC-42's outbox could deliver it late. The drain runs every 10 minutes and the link lasts 15, so a retried email could arrive dead or nearly dead. | Slice 1.5: the outbox's immediate attempt sends it, the drain is only the retry, and the drain never sends an expired restore link. |
| R2 | High | Reusing the outbox means a keep-safe address sits in a table for a few minutes, which Decision 4 says never happens. | Slice 1.2: the address is held only until the send succeeds or is given up, then cleared. Test 16b pins it. The short window is accepted and stated. |
| R3 | Medium | "The starter phone never had any data" is no longer true: a new phone can file a welfare report before choosing a name, and a person may start again before restoring. | Decision 7. The move still copies nothing, and the starter id's rows stay where they are. |
| R4 | Medium | Decision 7's "leave this spotter" could be used on a shared family phone and strand a sibling's spotter. | The warning names the spotter being left and how many spots they have. It still needs the link from the restoring person's own inbox. Accepted. |
| R5 | Medium | The SYC-63 deletion plan doesn't mention restore addresses, and a deleted id must never come back through a restore. | "How moving a spotter works" and test 16. |
| R6 | Low | Test 4's route list predates the welfare-report routes. Checked: `POST /reports/draft`, `POST /reports` and `PUT /reports/:id/photo` all call `verifyDeviceSecret` (`reports.ts` 107, 142, 215). The observation routes are staff-only (`requireTeam`). | Test 4 now names the report routes and "anything added since". |
| R7 | Low | Whether "Forget this address" in a keep-safe email also stops report and news "is this you?" mail to that address is not settled by this plan. | The build follows `email-capture.md` §4.4. The adversarial review of the build checks the scope. |

## Appendix — copy (English; Greek and French from native speakers)

**Onboarding / Settings / one-time offer:** `email-capture.md` §3.0, word for word, minus the news box until SYC-45.

**"Keep my spots safe: is this you?"** (transactional identity, fixed text, nothing the sender chose):
> **Subject:** Is this you? — Cat Spotters
> Someone using the Cat Spotters app asked to use this address to keep their spots safe. If they lose their phone, this inbox is how they get their spots back.
> **[ Yes, that was me ]**
> If it wasn't you, you don't need to do anything. We won't use this address, and we'll forget it in seven days. To forget it now: **[ Forget this address ]**.
> Cat Spotters is made for Syros Cats, a cat charity on Syros. [What we do with your email](https://catspotters.com/privacy) · hello@catspotters.com

**"Your restore link"** (transactional identity):
> **Subject:** Get your spots back — Cat Spotters
> Someone asked to move a Cat Spotters collection kept safe by this address to a new phone.
> **Open this on the phone that's getting the spots back**, then press the button. The link works once and lasts 15 minutes.
> **[ Get my spots back ]**
> If you didn't ask, ignore this. Nothing moves unless the button is pressed on the phone that asked. Please don't forward this email.

**The old phone:** *Your spots moved to a new phone.* This phone isn't signed in as {username} any more. [ Start again as a new spotter ]

**WhatsApp to testers when Slice 1 ships:**
> New in Cat Spotters 🐈: **Keep my spots safe.** Add an email and you can get your spots, points and badges back if your browser forgets you or you change phone. Open the app and you'll see it once, or find it in Settings. Use an email only you can read (children: use a parent's). You'll get one "Is this you?" email: tap the button in it. Please keep using **apptest.catspotters.com** only. If you've already lost your spots, message me your old username.
