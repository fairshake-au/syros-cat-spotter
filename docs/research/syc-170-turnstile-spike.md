# SYC-170 spike: Turnstile in a WebView (working notes, rewritten in the final commit)

## Item 2: the page in a desktop browser (14 Oct 2026)

Test keys checked against https://developers.cloudflare.com/turnstile/troubleshooting/testing/ on 14 Oct 2026:
always passes `1x00000000000000000000AA`, always fails `2x00000000000000000000AB`, forces interactive
`3x00000000000000000000FF`; secrets `1x0000000000000000000000000000000AA` (passes), `2x...AA` (fails),
`3x...AA` (token already spent). All match what the task listed.

`/_challenge?action=welfare_report&cdata=r-test123` on localhost, gate off, in the Claude desktop browser pane:

| Sitekey | What the page posted | Time |
|---|---|---|
| always passes | `{type:'token', token:'XXXX.DUMMY.TOKEN.XXXX'}` | under 5 s |
| always fails | `{type:'error', code:'600010'}` | under 6 s |
| forces interactive | `{type:'interactive'}`, then after a click on the box `{type:'token', token:'XXXX.DUMMY.TOKEN.XXXX'}` | n/a |

The same page inside an iframe on the same origin delivered the token to `window.parent.postMessage` with
origin `http://localhost:3999`.

siteverify with the TEST secret `1x0000000000000000000000000000000AA` and the passing token:

```
{"challenge_ts":"2026-10-14T22:34:32.069Z","error-codes":[],"hostname":"example.com","metadata":{"result_with_testing_key":true},"success":true}
```

Fields: success=true, hostname=`example.com`, action absent, cdata absent. With the always-fail secret: `success:false,
error-codes:["invalid-input-response"]`. With the always-pass secret even the string `garbage` passes.

**Consequence:** Cloudflare's test keys never echo the real hostname, `action` or `cdata`, so they cannot prove
the hostname check or the action/cdata round-trip. Only the production widget can.
