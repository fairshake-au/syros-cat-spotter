# SYC-113 — what Replit's login wall is, and how to get past it

**Correction (29 Sep 2026):** the first draft of this doc got Option A wrong — it proposed a second Replit deployment of just the `api-server` artifact from this same Repl, on `api.catspotters.com`, while the website stayed gated. That isn't possible. Checked against Replit's own docs ("Multiple Artifacts vs. Separate Projects", "What's an Artifact?", "Who can access your app") and confirmed read-only with the Replit agent: **one Repl publishes all its artifacts together as one deployment**, and the access setting covers that whole deployment — not an individual artifact, path, or domain. §2 and the options below are rewritten accordingly.

## For Samuel, in five lines

Every request to `apptest.catspotters.com` — including the health check and the sign-in Worker's server-to-server call — gets redirected to a Replit login/password page before it ever reaches our code. That's a deployment setting Replit calls **"Password protected"**, confirmed live on our deployment right now, and it covers the whole deployment (website and API together, since both artifacts of one Repl always publish as one deployment) — there's no way to gate the website while leaving the API open on the same Repl. The two real options are a **second, separate Replit project** just for the API (its own deployment, its own database, its own everything — real setup cost), or keeping one project and one deployment but adding **our own password check in front of the website's pages only**, in code we already own (`artifacts/cat-spotter/server/serve-web.js`), leaving `/api` reachable and self-authenticating as it already is. Recommendation: the second one — it keeps one Repl, one database, and one OpenAI integration, and it doesn't depend on where the database ends up (SYC-102/SYC-47). Nothing in Replit lets a server-to-server caller skip the wall except a purpose-built "external access token," which only covers API traffic, not the website itself, so it doesn't solve the whole problem on its own.

I could not read the deployment's configured region (Publishing → Advanced) through any read-only tool available to me — see §4 for how to check it yourself in under a minute.

## 1. What exactly is the wall?

**Confirmed live, by direct probe and by asking the Replit agent (read-only) to report the deployment's own metadata:** the deployment's "Who can access your app" setting is **Password protected**, one of four options Replit's deployment publishing flow offers:

- **Public** — anyone with the URL.
- **Password protected** — anyone with a shared password; no Replit account needed. *(This is us.)*
- **Workspace only** — Replit calls this "Private"; restricted to the Replit workspace's admins/members/viewers.
- **Invite only** — Replit calls this "Private" too; the most restrictive, named users/groups only.

Source: [Replit docs, "Who can access your app"](https://docs.replit.com/features/publishing/private-deployments).

Live probe, 29 Sep 2026, 13:56 UTC:

```
curl -sS -D - -o /dev/null https://apptest.catspotters.com/api/healthz
HTTP/2 307
location: https://replit.com/__replshield?redirect=https%3A%2F%2Fapptest.catspotters.com%2Fapi%2Fhealthz

curl -sS -D - -o /dev/null https://apptest.catspotters.com/
HTTP/2 307
location: https://replit.com/__replshield?redirect=https%3A%2F%2Fapptest.catspotters.com%2F

curl -sS -D - -o /dev/null -X POST https://apptest.catspotters.com/api/internal/people/allowed
HTTP/2 307
location: https://replit.com/__replshield?redirect=...%2Fapi%2Finternal%2Fpeople%2Fallowed
```

Following the redirect lands on `replit.com/deployment-login?goto=...`, the same page Replit uses for both password entry and Replit-account sign-in — it renders whichever form the deployment's access mode needs. That single shared login/password page is why the wall looks identical from the outside regardless of which of the two "Private" modes or "Password protected" is actually set; you can only tell them apart from the deployment's own settings, which is what the Replit agent read for us.

**Scope: per deployment, not per path, not per domain.** Replit's own docs describe access control entirely at the "when you publish your app, you control who can open it" level — one setting for the whole deployment. There is no path-level exception. I asked the Replit agent (read-only, no changes made) to check our actual configuration, and it confirmed: **one autoscale deployment currently serves both artifacts** — `/api` (api-server) and `/` (cat-spotter web) — under the single `apptest.catspotters.com` domain, both gated by the one password-protected setting. That means today there is no way to carve out `/api` as public while `/` stays gated — the gate is all-or-nothing for that deployment.

**Can it be turned off per path?** No — see above. It can only be turned off (or changed) per deployment, and per the docs, "changing access requires unpublishing your app first."

## 2. Can the API be public while the website stays gated?

**Not on this Repl, as originally drafted.** The first version of this doc proposed publishing `api-server` as its own deployment on `api.catspotters.com` while `cat-spotter` stayed a separate, gated deployment of the same Repl. That's not how Replit works. Checked against Replit's docs on artifacts ("Multiple Artifacts vs. Separate Projects", "What's an Artifact?") and "Who can access your app", and confirmed read-only with the Replit agent against our own Repl: **a Repl's artifacts always publish together as one deployment**, on one domain, under one access setting. `artifacts/api-server/.replit-artifact/artifact.toml` declaring its own `paths = ["/api"]` controls *routing within* that one deployment (which artifact answers which path) — it does not mean the artifact can be deployed, or gated, separately. `serve-web.js`'s own comment confirms the same thing from the other side: "In production the platform routes `/api` to the API service before this server ever sees it" — one deployment, internally routed, one gate in front of all of it.

That leaves two real ways to get a public API without a public website:

**Option A — a genuinely separate Replit project for the API**, its own Repl, its own deployment, on `api.catspotters.com`, set to **Public**, independent of whatever `cat-spotter`'s deployment is set to. This is real infrastructure, not a setting flip — costs below.

**Option B — keep one Repl, one deployment, set it Public, and put a password in front of the website's pages only**, in code we already own. `artifacts/cat-spotter/server/serve-web.js` is the Node server that answers every non-`/api` request in production; it already special-cases `/status` and rejects `/api/*` explicitly. Adding a check there (e.g. cookie set after a shared-password form, checked before serving any HTML) gates the site without touching Replit's own access control at all — and because Replit's access setting is now **Public**, `/api` routes (which this server never even handles) are reachable and rely on their own authentication, exactly as SYC-83 needs.

Full cost/benefit for both is in the Options section below.

## 3. Any supported bypass for server-to-server or native clients?

Yes — **External Access Tokens**, a real, documented Replit feature, not a hack:

> `curl -H "Authorization: Bearer <token>" https://your-app.replit.app/health`

Source: [Replit docs, External Access Tokens](https://docs.replit.com/features/deployment-customization/external-access-tokens).

What they do and don't do:

- They let "CI pipelines, webhooks, and other automated services reach your private Replit app without signing in" — exactly the sign-in Worker's server-to-server case (SYC-83).
- They bypass both "Private Dev URL" and "Private Deployment" protection.
- They are **bearer tokens for API traffic, not for browser pages** — the docs are explicit that single-page apps/UI pages don't work because follow-on asset requests won't carry the header. That rules them out as a way to let testers or the public browse the gated website; they only help a server-to-server caller hit an API endpoint.
- Tokens expire (1 hour to 5 years, no "never" option) and auto-revoke if the deployment is unpublished, deleted, or flipped from private to public.
- Whether this token type is issued for a **Password protected** deployment specifically (versus only the two "Private" modes) isn't spelled out in the page I could read — the examples all describe "private" deployments. **Unverified**: confirm in the Replit dashboard (Deployments → your deployment → Access control / tokens) which access modes offer token issuance before relying on this path.

Recommendation order: prefer option 2 (§2, a genuinely public API deployment) over an External Access Token, because a token only unblocks the one Worker call — it wouldn't help native app builds (SYC-32), which need the API reachable by ordinary unauthenticated HTTPS from thousands of phones, not a bearer secret baked into an app binary.

## 4. Deployment region/geography

**I could not read this.** The Replit agent, asked read-only, confirmed it has no tool to inspect Publishing → Advanced and could not report the region. This isn't a "we don't know if it's set" gap — it's that none of the read-only inspection paths available to this session (live deployment metadata, file reads, the agent's own Q&A) surface that field.

**How Samuel (or the other session working SYC-102/the database decision) can get it directly:** open the Repl at `https://replit.com/@fairshake-au/Syros-Cat-Spotter`, go to the **Deployments** tab → the `apptest` deployment → **Settings** (or Publish flow) → **Advanced**, and the region is listed there. It's a 30-second dashboard check; I'm flagging it rather than guessing so the database-hosting call isn't made on an assumed region.

## 5. If everything becomes public, what's newly exposed?

Two separate gates exist today, and it's worth being precise about which one this ticket is about:

1. **The Replit deployment password** (this ticket) — gates the whole `apptest.catspotters.com` deployment: the web app pages and every API route, indiscriminately, before any of our own code runs.
2. **The in-app "document gate" password** (SYC-85, `DECISIONS.md` D7) — a separate, app-level shared password protecting the Syros Cats workspace **document pages**, unrelated to Replit's deployment gate. It's still scheduled to retire only once the real people are added to sign-in (SYC-29) and everyone has signed in once by email link. **Making the Replit deployment public does not touch this password** — it's enforced by our own app code, not Replit, so it keeps working exactly as documented regardless of what we do here.

What making the deployment public would newly expose, once the Replit wall itself is gone:

- **The cat-spotter web app and its API become reachable by anyone with the URL**, not just people who know the Replit password. For the MVP this is the intended end state anyway — DEPLOYMENT.md doesn't describe the production app as gated post-launch. The open question is only about the `apptest` staging deployment: today, "logging past the Replit wall by hand" is incidentally acting as the only barrier keeping the public off a pre-launch build. Remove it, and the pre-launch build is just... live, indexable, and discoverable, with none of the app's own features (welfare reports, staff dashboard, the campaign copy) hidden behind anything Replit-level.
- **The staff dashboard (SYC-43)** sits behind its own email-link sign-in (SYC-25/SYC-83), independent of the Replit wall — so removing the Replit gate does not expose staff-only data or actions; that boundary is enforced in our own code once SYC-83 can actually reach the API (which is the whole reason this ticket exists).
- **Testers' pre-launch access**: TestFlight and the Play closed test already have their own store-level gates (Apple/Google testers list) — those are unaffected by Replit's setting either way. The only thing Replit's password was doing for "testers" was accidentally standing in for a staging gate; once it's gone, anyone (not just recruited testers) could reach the same build via the URL.
- **Nothing currently in the codebase suggests any other implicit protection** (no pre-launch/tester gate string, robots directive, or IP allow-list, found via a repo grep) beyond the Replit deployment gate and the two app-level gates already discussed.

## Options — benefits, risks, cost, and what people would notice

### Option A (revised) — A separate Replit project for the API, on `api.catspotters.com`, set to Public

This is a new Repl, not a second deployment of the existing one — real infrastructure, not a setting change.

- **Benefits:** Matches the literal shape DEPLOYMENT.md §C describes ("its own deployment on `api.` subdomain"); the website's Repl and its access setting are completely untouched, so there's zero risk of accidentally exposing staging pages; each project's access is independently controllable forever after.
- **Risks / verifiable costs:**
  - **A new Repl gets its own Replit-managed database.** It would not see the current data (cats, sightings, people) unless the database moves off Replit first — this makes the choice entangled with the Neon-vs-AWS decision the other session is making for SYC-102/SYC-47, not independent of it.
  - **The Replit OpenAI integration the AI matching uses is per-project.** A new Repl needs that integration configured again from scratch (DEPLOYMENT.md notes matching "runs through Replit's OpenAI integration" today).
  - **Two Repls to keep in sync with GitHub** instead of one — doubles the surface for the sync problem SYC-96 already tracks ("if the Replit agent can't pull from GitHub").
  - **The web app needs `EXPO_PUBLIC_API_URL` set and CORS opened** on the API for the website's origin, since native builds already call the API by absolute domain (`artifacts/cat-spotter/lib/urls.ts`) but the browser build currently relies on same-origin (`window.location.origin`, same file) — splitting origins changes that assumption for the web build specifically.
- **What testers/staff notice:** Nothing directly — native builds and the Worker start working; the staging website keeps its own gate exactly as before.
- **Recommendation:** viable, but carries real setup cost and a second database to reconcile with SYC-102 before it even helps. Not the first choice — see Option B.

### Option B (revised) — One project, deployment set to Public, with a server-enforced password on the website pages only

- **Benefits:** One Repl, one database, one OpenAI integration — nothing to duplicate or keep in sync, and it works **whatever SYC-102/SYC-47 decides** about database hosting, because it doesn't touch the database question at all. `/api` routes become reachable immediately (they're already routed away from `serve-web.js` in production, per that file's own comment) and keep whatever authentication they already have (SYC-83's own check, once it can reach the API at all). The password check is ordinary code we own (`artifacts/cat-spotter/server/serve-web.js`), reviewable and testable like anything else in the repo — not a Replit black box.
- **Risks:** Flipping the deployment's access setting from Password protected to Public is itself a publish, and Replit's docs say "changing access requires unpublishing your app first" — a short outage during the switch, timed for a quiet moment. That publish should happen after SYC-102 lands (or is deliberately deferred), since a schema-sensitive deploy during a database migration is exactly the kind of overlap DEPLOYMENT.md §C's migration ordering rules warn about. Until the password check is written and tested, there's a window where "Public" but not-yet-gated would expose the raw website — so the code change and the access-setting flip should land together, not sequentially with a gap.
- **Cost:** Engineering time only — a small, reviewable change to one file already in the repo. No new infrastructure, no new billing.
- **What testers/staff notice:** Testers log in once with a shared password on the website (similar to what they do today, just enforced by us instead of Replit) and then use the app normally; nothing changes for native app users, who never saw the Replit wall's UI to begin with once the API is reachable.
- **Recommendation: do this**, unless something in a closer look at `serve-web.js` or the deploy pipeline rules it out — I didn't find anything that does. It keeps everything in one place, doesn't wait on or complicate SYC-102, and directly produces the ticket's "done when" condition (a live `curl` to `/api/internal/people/allowed` gets the API's own 401/503, not a 307).

### Option C — External Access Token for the Worker's server-to-server call only, leave the single deployment password-protected

- **Benefits:** No new deployment or project to stand up; smallest possible change if the *only* problem were the Worker call.
- **Risks:** Doesn't solve the actual critical-path problem — native store builds (iOS/Android) still can't get past the wall, because a bearer token baked into a public app binary defeats the point of the token (anyone could extract it from the app package) and the docs are explicit that this token type isn't meant for that use anyway. Would leave SYC-32 blocked even after "fixing" SYC-83. Adds a secret (the token) that needs rotating within its 1-hour–5-year lifetime and re-issuing if the deployment is ever unpublished.
- **Cost:** None beyond engineering time.
- **What testers/staff notice:** Nothing — the underlying store-build blocker (the actual urgent half of this ticket) remains.
- **Recommendation:** not sufficient on its own. Doesn't replace A or B; at most a stopgap for the Worker call alone.

### Option D — Fully public, no gate of any kind on the deployment

- **Benefits:** Simplest possible end state, and the one production will need eventually — DEPLOYMENT.md doesn't describe the launched app as gated.
- **Risks — what this exposes before launch:** the pre-launch `apptest` build becomes reachable by anyone with the URL, with **no barrier of any kind**, not even the website-only password Option B adds. A work-in-progress build with placeholder copy, seeded test cats, and unfinished features (§2 of PRODUCT-SPEC.md's item list) becomes one guessed or leaked URL away from being seen by the public, journalists, or Syros Cats stakeholders before it's ready. The staff dashboard (SYC-43) and welfare-report flow stay safe regardless — they have their own email-link sign-in independent of the Replit wall — but the general public browsing experience, campaign copy, and map would all be open with nothing standing in front of them.
- **Cost:** None beyond what's already paid for.
- **What testers/staff notice:** Testers stop needing to log in at all; anyone else with the URL can too.
- **Recommendation:** right for *production* on launch day, not for `apptest` now. Do Option B first (a website-only password we control), and revisit dropping that password entirely as a deliberate decision timed to the October launch DEPLOYMENT.md targets — same moment SYC-85's separate in-app document password is meant to retire.

## Bottom line

Do Option B: one Replit project, deployment set to Public, with a password check we own added to `serve-web.js` in front of the website pages only. It fixes SYC-83 and the native-build half of SYC-32 without opening a second Repl, without a second database to reconcile against the SYC-102/SYC-47 hosting decision, and without duplicating the OpenAI integration. Option A (a genuine second Replit project) is the fallback if Option B turns out to be blocked by something not visible from here (e.g. a deploy-pipeline constraint), but it carries real, named setup costs that B avoids entirely. Option C doesn't solve enough of the problem alone. Option D is the right target for production at launch, not for `apptest` today.
