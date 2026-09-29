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

### Option A — Give the API its own public deployment on `api.catspotters.com`, leave the website deployment gated (matches DEPLOYMENT.md §C)

- **Benefits:** Unblocks SYC-83 (Worker → API) and SYC-32 (native store builds) immediately; matches the plan already written and approved in DEPLOYMENT.md; keeps the staging website hidden from the public for as long as wanted; each deployment's access is independently controllable going forward (e.g. flip the website public on launch day without touching the API).
- **Risks:** Two deployments to keep in sync (env vars, secrets, deploys) instead of one; `trust proxy`/CORS need re-checking once the API is on its own origin talking to a website on a different origin (native app already hits it directly by domain, so this is mostly a website-CORS question, not a new one for native).
- **Cost:** A second small autoscale deployment — unverified exact euros (see §2); shape-wise, modest.
- **What testers/staff notice:** Nothing changes for them — native builds and the Worker start working; the staging website keeps needing the Replit password exactly as it does now.
- **Recommendation: do this.** It's the already-approved plan, it's the narrowest change (doesn't touch the website's gating at all), and it directly produces the "done when" condition in the ticket — a live `curl` to `/api/internal/people/allowed` returning the API's own 401/503 instead of a 307.

### Option B — Make the single `apptest` deployment fully public (retire the Replit password entirely, once SYC-85's in-app password is also retired)

- **Benefits:** Simplest possible end state — one deployment, one origin, no split to maintain; matches what production will look like after launch anyway.
- **Risks:** The pre-launch staging build becomes reachable by anyone with the URL, with no barrier of any kind (not even an accidental one) until real launch-day gating (store review, marketing) is in place; do this too early and a work-in-progress build with placeholder copy/test data is one guessed URL away from being seen by the public or, worse, by Syros Cats stakeholders before it's ready.
- **Cost:** None beyond what's already paid for.
- **What testers/staff notice:** Testers stop needing to "log past the wall by hand"; nothing else changes for them since store-level testing gates are separate.
- **Recommendation:** good for the *production* deployment on launch day, not recommended now for `apptest` — do Option A first, and revisit making the website deployment itself public closer to the October launch date DEPLOYMENT.md targets.

### Option C — External Access Token for the Worker's server-to-server call only, leave the single deployment password-protected

- **Benefits:** No new deployment to stand up or maintain; smallest possible change if the *only* problem were the Worker call.
- **Risks:** Doesn't solve the actual critical-path problem — native store builds (iOS/Android) still can't get past the wall, because a bearer token baked into a public app binary defeats the point of the token (anyone could extract it from the app package) and the docs are explicit that this token type isn't meant for that use anyway. Would leave SYC-32 blocked even after "fixing" SYC-83. Adds a secret (the token) that needs rotating within its 1-hour–5-year lifetime and re-issuing if the deployment is ever unpublished.
- **Cost:** None beyond engineering time.
- **What testers/staff notice:** Nothing — the underlying store-build blocker (the actual urgent half of this ticket) remains.
- **Recommendation:** not sufficient on its own. Could be layered on top of Option A later if some other server-to-server caller needs to reach a deployment that's staying private, but it doesn't replace giving the API its own public deployment.

## Bottom line

Do Option A now — it's the plan already on the page, it's scoped narrowly to the API, and it's what closes out both SYC-83 and the native-build half of SYC-32. Revisit Option B (making the website itself public) as a separate, deliberate decision closer to launch, after SYC-85's in-app document password is also retired. Option C doesn't solve enough of the problem to be worth doing instead of A.
