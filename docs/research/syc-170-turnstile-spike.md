# SYC-170 spike: Turnstile in a WebView

**Date:** 14 October 2026 · **Plan:** `syc-44-report-an-issue.md`, Slice 1, PR 1.0 and PR 1.3 · **Spec:** `report-an-issue.md` §9.4 to §9.6 (option A)

**The short version.** The `/_challenge` page works and hands a token back in a normal browser, including the
"Cloudflare wants a tap" case. The phone side (a WebView in the app) is written and type-checks, but has **not**
run anywhere: this Mac has no Xcode, so there is no iOS Simulator. The two facts the plan most needs (the
hostname a phone token reports, and that `action` and `cdata` come back) **cannot be proved with Cloudflare's
test keys** and need the production widget on a real phone. Nothing in the spike contradicts option A.

Only this note is meant to merge from the spike branch. The page, `TurnstileHost` and the dev screen are throwaway.

## What was proven

**The test keys** were checked against Cloudflare's testing page on 14 Oct 2026: always passes
`1x00000000000000000000AA`, always fails `2x00000000000000000000AB`, forces interactive
`3x00000000000000000000FF`; secrets `1x0000000000000000000000000000000AA` (passes), `2x…AA` (fails),
`3x…AA` ("token already spent"). They match what the plan lists.

**The page** (`artifacts/cat-spotter/server/challenge-page.js`, route in `serve-web.js`), run on localhost with
`PRELAUNCH_GATE=off` and each test key, opened at
`/_challenge?action=welfare_report&cdata=r-test123` in the Claude desktop browser pane (Chromium):

| Sitekey | What the page posted |
|---|---|
| always passes | `{type:'token', token:'XXXX.DUMMY.TOKEN.XXXX'}` within about 5 s |
| always fails | `{type:'error', code:'600010'}` within about 6 s |
| forces interactive | `{type:'interactive'}`, a visible "Verify you are human" box, and after one click `{type:'token', …}` |

In an iframe on the same origin the token also arrived through `window.parent.postMessage` (origin
`http://localhost:3999`). `ReactNativeWebView.postMessage` was not exercised, because no WebView ran.

**siteverify with the published TEST secret** (`1x0000000000000000000000000000000AA`) and the passing token:

```
{"challenge_ts":"2026-10-14T22:34:32.069Z","error-codes":[],"hostname":"example.com","metadata":{"result_with_testing_key":true},"success":true}
```

- `success`: true
- `hostname`: `example.com` (not the page's host)
- `action`: absent
- `cdata`: absent

With the always-fail secret the same token gives `success:false, error-codes:["invalid-input-response"]`. With the
always-pass secret even the string `garbage` passes. **So the test keys prove the plumbing (page, token,
postMessage, a siteverify call), and prove nothing about the hostname check or the action/cdata round-trip.**

**The server side**, in `server/serve-web.test.ts` (63 tests pass locally): the page is served with the gate on
and off; a missing or unknown `action`, or a `cdata` over 100 characters or outside `[A-Za-z0-9_-]`, is `400`; POST
is `405`; nothing else is let through the gate (`/_challenge/`, `/_challenge/x`, `/_challenge.html`,
`/x/_challenge`, `/_Challenge` and the rest all stay behind it). With `NODE_ENV=production` and no
`TURNSTILE_SITEKEY` the page answers `503` rather than falling back to a test key.

**The phone code** type-checks (`pnpm run typecheck`) and its pure parts have 18 tests (`lib/__tests__/turnstileNav.test.ts`):
the navigation allow-list (app host, `challenges.cloudflare.com` over https, `about:blank`, `about:srcdoc`; refuses
look-alike hosts, `catspotters.com`, `team.catspotters.com`, `javascript:`, `data:`, `file:`, plain-http Cloudflare),
the URL builder and the message parser.

## What was not proven

- **Anything on a phone.** `npx expo run:ios` stopped at once: Xcode is not installed here (only the Command Line
  Tools; `xcodebuild` and `simctl` are missing, and so is CocoaPods), and the command refuses to continue without
  it. One attempt was made, as agreed, and the generated `ios/` folder and `package.json` edits were reverted.
  So there is no figure for time to a token, for what the tap sheet looks like, or for the user agent in a WebView.
  Android was not tried (no emulator or SDK was assumed).
- **The hostname a phone token reports.** Unknown until the production widget runs. This is the fact that decides
  whether Slice 1.3 goes ahead (spec §9.4/§9.6).
- **`action` and `cdata` coming back** from siteverify. Same reason.
- **That the user agent stays the same through a session in a WebView.** `TurnstileHost` does not override it, and
  reports `navigator.userAgent` back, so the real-phone run records it.
- **Whether `onShouldStartLoadWithRequest` lets Cloudflare's iframe and its challenge navigations through on iOS and
  Android.** The allow-list is unit-tested, but not against a real WebView.
- **The content-security-policy on the page** (script, frame and connect only to `challenges.cloudflare.com`, nonce
  for the inline script) worked in desktop Chromium. WebKit on iOS is untested.
- **The production sitekey `0x4AAAAAAFXDA4oOu3qZurFj` on `apptest.catspotters.com`.** Nothing has been published.
  That sitekey does not work on localhost, so the local runs could only use test keys.

## Things the spike found that bear on the plan

1. **Test keys can't prove the hostname or action/cdata checks** (above). The plan's PR 1.0 item 4 can only be
   closed with the production widget, which is why PR 1.1's `observe` mode and its logged siteverify fields matter.
2. **The gate's frame headers had to be lifted for this one page.** With the pre-launch gate on, every response
   carries `X-Frame-Options: DENY` and `frame-ancestors 'none'`. The challenge page removes the first and sets
   `frame-ancestors 'self'`, so the web build can embed it in an iframe on the same origin. The gate's clickjacking
   protection is unchanged for every other path (an existing test covers it).
3. **A page of our own is needed in each environment**, because the sitekey is per host. Development uses the
   always-passes test key when `TURNSTILE_SITEKEY` is unset; production must set it.
4. **Native builds need a Mac with Xcode (or an EAS build)** to be tried at all. The plan's "first on the iOS
   simulator (Claude)" step needs Xcode installed on the machine Claude runs on, or an EAS development build.

## Remaining real-phone steps

(a) **Samuel pastes the production secret into Replit Secrets** as `TURNSTILE_SECRET_KEY`, straight from the
Cloudflare Turnstile page. Claude does not see or store it.

(b) **PR 1.1 ships in `observe` mode** and logs, for every siteverify answer, the `hostname`, `action` and `cdata`
(never the token or the secret). Nothing is refused yet.

(c) **The `/_challenge` page is published on `apptest.catspotters.com`** with `TURNSTILE_SITEKEY` set to the
production sitekey (`0x4AAAAAAFXDA4oOu3qZurFj`; it is public). Check it from a laptop first: the page should show a
token for a real person, and the production log should show hostname `apptest.catspotters.com`.

(d) **An internal test build** (EAS development or preview build with `react-native-webview`) **on a real iPhone and
a real Android phone**, pointed at that host. On each, open the dev-only screen (`/dev-turnstile`) and run the check
on Wi-Fi and on one bar. Record: the time to a token (the screen prints it), whether the tap sheet appeared and
worked, the user agent the screen prints (it should be identical across several runs in one session), and then
check the production log for **hostname `apptest.catspotters.com`**, `action = welfare_report` and the
`cdata` the screen used (`r-<timestamp>`). If the hostname is anything else, Slice 1.3 stops and the options in
spec §9.4 go back to Samuel.

An iOS Simulator run is still useful before the real phones, once Xcode is installed on the build machine: point
`EXPO_PUBLIC_API_URL` at `http://localhost:3999` with the local server on a test sitekey, and run the same screen.
