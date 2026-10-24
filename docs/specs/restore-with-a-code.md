# Get your spots back with a code

Ticket: SYC-664. Builds on SYC-3 ("Keep my spots safe", `email-capture.md` §8) and its Decision 12 (the link works on whichever phone opens it).
Status: **draft for adversarial review**, 24 Oct 2026.
Decision behind it: Samuel, 24 Oct 2026, chose "a short code in the email" over "a box to paste the link into" and "both".

## The problem, as a spotter meets it

Samuel uses Cat Spotters from an icon on his iPhone's home screen. He asked for his spots back and it didn't work.

On iPhone, a website saved to the home screen keeps its own storage, apart from Safari's. Nothing in an email can open that home-screen app: a link in Mail opens in Mail's own browser or in Safari. So today:

1. The spotter types their keep-safe address on "Get your spots back" in the home-screen app. The app says the link should be opened "on this phone, in the same browser (Safari or Chrome) you use for Cat Spotters". They don't use a browser for Cat Spotters. They use the icon.
2. They tap the link in the email. It opens in Safari (and on the test site, Safari first asks for the pre-launch password, which they may never have typed there).
3. Safari is a stranger to the server: it asks "Is this the app or browser you use for Cat Spotters?"
   - **Yes** moves the spots into **Safari**. The home-screen app is unchanged. The spotter thinks it failed.
   - **No, copy the link** says "Paste it into the browser you use for Cat Spotters". The home-screen app has no address bar. Dead end.

The app suggests adding it to the home screen (`HomeScreenNudgeBanner`), so the people this hits are the keen ones with the most to lose.

The same dead end catches anyone whose email opens links somewhere other than where they use Cat Spotters: Gmail's built-in browser, a work phone's default browser, Firefox users on Android whose links open in Chrome.

## What the spotter will experience

### 1. The email carries a code as well as the link

The email's first thing is a six-digit code, large, with a space in the middle so it's easy to read and type: **482 913**.

> **Your code: 482 913**
>
> Type it into Cat Spotters on the phone that asked. It works for 15 minutes.
>
> Or, if you use Cat Spotters in a web browser, open this link in that browser: **[Get my spots back]**
>
> If you didn't ask, ignore this email. Nothing moves until someone types the code or presses the button. Never share this code or link with anyone, even a friend.

The subject stays "Get your spots back — Cat Spotters". The code is **not** in the subject (see Decision B below).

### 2. The app waits for the code

After "Send me a link" (renamed **"Email me a code"**), the "Get your spots back" screen no longer just says "we've sent a link". It turns into the place to type the code:

> **Check your email**
>
> If that address is keeping a spotter safe, we've sent it a 6-digit code. Type it here.
>
> `[ _ _ _   _ _ _ ]`
>
> [**Get my spots back**]
>
> Didn't get it? Check your spam folder, or **send another** (after a minute).

- The box takes digits only, shows the number keyboard, and accepts a pasted code with or without the space.
- The box is marked as a one-time code, so a phone that offers codes from Mail above the keyboard can do so. (On iPhone this is the "From Mail" suggestion; whether it appears for a home-screen app is **unchecked**: if it doesn't, typing still works.)
- The full code is checked as soon as the sixth digit goes in; the button is there for anyone who wants to press it.

**Going to the email app and back must not lose the screen.** On iPhone the home-screen app is often reloaded when you switch away. The app remembers, on this phone only, that it is waiting for a code (not the address, not the code), for 15 minutes. If the app reloads in that time, it opens straight back onto "Check your email" with the box. After 15 minutes it forgets, quietly.

### 3. After the right code: the same steps as the link

A right code leads to exactly what the link leads to on the phone that asked, from the same screen:

- one spotter on that address and none on this phone: **the spots move straight away** (one tap was typing the code);
- this phone already has a spotter: the existing warning naming it, with **Keep** or **Delete** to choose (SYC-266), then "Move {name}'s spots to this phone";
- several spotters on that address (a parent keeping two children safe): pick which one;
- this phone already is that spotter: "Your spots are already on this phone."

Then the app reloads as the spotter that came back, as it does after the link.

### 4. A wrong code

> That code isn't right. Check the email and try again.

After **five** wrong tries, that code stops working, whatever is typed:

> That code has stopped working. Send another email to get a new one.

with **Email me a new code**. An old code (more than 15 minutes, or used) gets the same plain words as an expired link: "That code has expired or has already been used. Nothing has moved."

The words never say whether the address is kept safe. A wrong code for an address we don't know reads exactly like a wrong code for one we do.

### 5. The link still works, and stops sending people into a dead end

The link keeps working for people who use Cat Spotters in a browser, exactly as today. Two changes on the page it opens:

- **"Is this the app or browser you use for Cat Spotters?"** gains a third answer: **"I use the Cat Spotters icon on my home screen"**. It says: *"Go back to Cat Spotters from your home screen and type the code from this email there."* No spots move.
- **"No, copy the link"** and the in-app-browser warning say "browser" only where a browser is really meant, and mention the code: *"…or type the code from the email into Cat Spotters."*

### 6. Words that change elsewhere

- The "sent" line that told people to open the link "in the same browser (Safari or Chrome)" is replaced by the code screen above.
- "Send me a link" → "Email me a code". The intro: "Type the email address that's keeping your spots safe, and we'll email it a code."
- Help text that describes getting spots back (Help & info) says "a code" where it says "a link".

All app words in English, Greek and French. The email stays English-only until SYC-4's native-speaker pass, as now.

## What stays the same

- **Who can get spots back:** only whoever can read the keep-safe inbox. Usernames still restore nothing.
- **Request limits:** 3 requests per address per asking phone per 15 minutes, 20 per network per hour, at most 3 live links per address, a daily ceiling. The reply to "Email me a code" is identical whether or not the address is known, and takes the same time.
- **The email scanner rule:** opening the email or the link moves nothing. Only typing the code or pressing the button does.
- **Fifteen minutes, once.** A code and its link are one thing: using either uses up both.
- **The old phone** is told "Your spots moved to a new phone", as now.
- It needs a connection, as now; offline, the screen says so.

## Safeguards for the code

A six-digit code is far easier to guess than a link, so it gets rules the link doesn't need:

1. **The code works only on the phone that asked for it.** The link can be opened anywhere (Decision 12); the code can't. Someone who sees the code over a shoulder or in a forwarded email can't type it into their own phone. (That phone's own request would need the inbox to see its code.)
2. **Five wrong tries per code,** then that code is dead (its link too, so the two never disagree).
3. **A cap on wrong tries per phone:** 10 wrong codes an hour from one phone, whichever addresses they were for, then "Too many tries. Wait an hour and try again." So one phone can't keep requesting fresh codes for someone's address and guessing.
4. **What the guessing odds come to.** Each request allows 5 guesses at a million possible codes. Within today's request limits, one network can make at most 20 requests an hour, so 100 guesses: about a 1 in 10,000 chance an hour, and every request puts an email in the owner's inbox saying someone is trying. The daily ceiling of 200 restore emails caps the whole service at about 1,000 guesses a day across every address. See Decision A.
5. **The code is never stored as itself.** The server keeps a keyed fingerprint of it, so a copy of the database doesn't reveal live codes; the code, like the link, leaves the outbox once the email is sent.
6. **Nothing is logged** that would let someone rebuild a code: wrong tries are logged by count and request only.

## Decisions for Samuel

**A. Is a six-digit code strong enough, with the limits above?**
- *Six digits (recommended).* What people know from banks and other apps; easy to type after switching apps. With 5 tries per code, the per-phone cap and every attempt emailing the owner, a stranger's odds stay around 1 in 10,000 per hour per network, and the owner is warned each time.
- *Eight characters, letters and digits.* Practically unguessable, so the extra caps matter less. But harder to read and type, especially for children, and less familiar.
- *Six digits plus a per-address lock* (e.g. 20 wrong tries across all phones in a day locks codes for that address for a day). Stronger against a determined attacker with many phones, but a stranger could then lock a family out of codes on purpose (the reason SYC-3 counts limits per asking phone). The link would still work.

**B. Should the code appear in the email's subject?**
- *No (recommended).* The subject shows on the lock screen and in notification previews, where anyone nearby can read it. Opening the email is one extra tap.
- *Yes* ("482 913 is your Cat Spotters code"). Faster on iPhone and makes "From Mail" more likely to offer it. But it puts a key to a child's collection on a lock screen.

## Technical notes (skip if you're reading for the decision)

- **Storage.** The restore row in `mail_tokens` gains `code_hash` (HMAC-SHA256 of the 6 digits with a server key, the same keyed-fingerprint key the mail fingerprints use) and `code_attempts` (int, default 0). The code is generated with `crypto.randomInt(0, 1_000_000)`, zero-padded. The raw code joins the raw token in the outbox payload and is cleared with it (`outbox.ts`).
- **Lookup without a token.** A code alone can't find a row (codes repeat across requests). The app sends `{deviceId, code}` with its device secret; the server looks only at live, unused restore rows where `device_id` = the caller, newest first (at most 3 per address, so a handful per phone), and compares the keyed hash. This is what binds a code to the asking phone.
- **Endpoints.** `POST /api/restore/peek` and `/redeem` accept `code` instead of `token`. Peek with a code counts a try: a wrong code increments `code_attempts` on every live row of this phone (it can't tell which one was meant), and at 5 the row's `expires_at` becomes now(). A right code returns the same peek body as the link. Redeem with a code re-checks the code and spends the row exactly as the token path does (same transaction, same conditional write). The 60-second replay accepts a code too.
- **Per-phone wrong-try cap** is counted in Postgres (the shared limiter, bucket `keep_safe_code_wrong`, keyed by device id), failing closed like the other limiters.
- **Timing.** A wrong code and a right code for an unknown address answer in the same time (padded like `/restore/request`).
- **App.** `RestoreRequestScreen` gets the waiting state and code box; a small "waiting for a code until <time>" flag in local storage, cleared on success or expiry. The choose / warning / moving states move out of `app/restore.tsx` into a shared component used by both the link page and the code screen. `TextInput` with `inputMode="numeric"`, `autoComplete="one-time-code"`, `textContentType="oneTimeCode"`.
- **Email template.** `restoreLink` in `keepSafeTemplates.ts` gains a `code` param, validated as exactly six digits (the template's rule that only our own values go in still holds).

## Tests

- A right code moves the spots on the asking phone; the same code from another phone (right digits, other device) is refused with the same words as a wrong code.
- Five wrong tries kill the code and its link; the sixth try, even right, is refused.
- The per-phone cap: the eleventh wrong code in an hour is refused whatever the address.
- Using the code spends the link and vice versa.
- Unknown address, wrong code: same reply and timing as known address, wrong code.
- The raw code isn't in the database after sending, nor in any log line (grep the captured logs in the test).
- App: the code screen survives a reload within 15 minutes and is gone after; pasted "482 913" and "482913" both work; the "home screen icon" answer on the link page moves nothing.
- Browser check at 390px and desktop: the email → code → spots-back round trip with the fake mail endpoint, and the home-screen answer on the link page.
- **On a real iPhone, from the home-screen icon** (Samuel, on the test site once it's live): ask, read the code in Mail, type it, spots back in the icon app.

## Out of scope

- The native apps (SYC-137): their links can open the app directly; the code works there too, unchanged.
- Translating the email (SYC-4).
