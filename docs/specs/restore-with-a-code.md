# Get your spots back with a code

Ticket: SYC-664. Builds on SYC-3 ("Keep my spots safe", `email-capture.md` §8) and its Decision 12 (the link works on whichever phone opens it).
Status: **draft, review findings folded in, decisions A–D made by Samuel** (24 Oct 2026); awaiting approval. Adversarial review: `reviews/restore-with-a-code-review.md` (2 blockers, 8 should-fix, 9 nits; all addressed below, decisions recorded at the end).
Decision behind it: Samuel, 24 Oct 2026, chose "a short code in the email" over "a box to paste the link into" and "both".

## The problem, as a spotter meets it

Samuel uses Cat Spotters from an icon on his iPhone's home screen. He asked for his spots back and it didn't work.

On iPhone, a website saved to the home screen keeps its own storage, apart from Safari's. Nothing in an email can open that home-screen app: a link in Mail opens in Mail's own browser or in Safari. So today:

1. The spotter types their keep-safe address on "Get your spots back" in the home-screen app. The app says to open the link "on this phone, in the same browser (Safari or Chrome) you use for Cat Spotters". They don't use a browser for Cat Spotters. They use the icon.
2. They tap the link in the email. It opens in Safari. On the test site, Safari first shows the pre-launch password page, which they may never have used there.
3. Safari is a stranger to the server, so it asks "Is this the app or browser you use for Cat Spotters?"
   - **Yes** moves the spots into **Safari**. The home-screen app is unchanged. The spotter thinks it failed.
   - **No, copy the link** says "Paste it into the browser you use for Cat Spotters". The home-screen app has no address bar. Dead end.

The app suggests adding it to the home screen (`HomeScreenNudgeBanner`), so the people this hits are the keen ones with the most to lose.

The same dead end catches anyone whose email opens links somewhere other than where they use Cat Spotters: Gmail's built-in browser, a work phone's default browser, Firefox users on Android whose links open in Chrome.

## What the spotter will experience

### 1. The email leads with a code

> **Your Cat Spotters code is 48291376**
>
> You asked for it at 14:32. Type it into Cat Spotters on the phone you asked from. It works once, for 15 minutes.
>
> Only type this code in yourself, or give it to your own child for their phone. If anyone else asks you for this code, they're trying to take someone's spots. Don't give it to them.
>
> If you use Cat Spotters in a web browser, you can open this link in that browser instead: **[Get my spots back]**
>
> If you didn't ask, ignore this email. Nothing moves until someone types the code or presses the button.

- The code is eight digits, shown large, in a fixed-width font, with spacing between digits made by styling, not by a space character. One unbroken number next to the word "code" gives the phone the best chance to offer it automatically.
- The request time is in Greek time (the island's), so a family with several emails can tell which one they just asked for.
- The subject carries the code: **"48291376 is your Cat Spotters code"** (Decision D). It will show on the lock screen; Samuel chose speed and automatic offering over hiding it.

### 2. The app waits for the code

After the address, the button reads **"Email me a code"**. The screen then becomes the place to type it:

> **Check your email**
>
> If that address is keeping a spotter safe, we've emailed it an 8-digit code. Use the newest email you asked for on this phone. Type the code here.
>
> `[ 48291376 ]`
>
> [**Get my spots back**]
>
> Didn't get it? Check your spam folder, or **send another** (after a minute).

- One box, not eight. It takes digits only, shows the number keyboard, and accepts a pasted code with or without spaces.
- The box is marked as a one-time code, so a phone that can offer codes from Mail above the keyboard may do so. Whether iPhone offers this in Safari or in a home-screen app is **unchecked**. Typing always works, and the spec claims nothing more until it has been tried on a real iPhone.
- The code is checked as soon as the eighth digit goes in. The button is there too, but it is greyed out while a check is running, and the same code is never sent twice in a row. A quick tap after autofill can't use up two tries.

**"I already have a code".** The address screen has a small link, "I already have a code", that opens the code box straight away. It's for anyone whose screen was lost: the app was closed, or they asked and then put the phone down. It only works on the phone that asked. That's said underneath: "Use the code from an email you asked for on this phone."

**Switching to the email app and back doesn't lose the screen.** On iPhone the home-screen app is often reloaded when you switch away. So the app remembers, on this phone only, that it's waiting for a code: the time it asked, not the address and not the code. For 15 minutes after asking, opening the app goes straight back to "Check your email":

- on a new phone that hasn't finished the first-run screens, the first-run flow opens on the code box instead of Welcome;
- on a phone that already has a spotter (it asked from Settings), the app opens on Settings → Get your spots back, on the code box.

After 15 minutes the app forgets, quietly. It also forgets at once if the phone becomes a different spotter: spots coming back, "Start again", or "Delete my data". The address isn't kept, so "send another" after a reload goes back to the address box.

**Asking again.** The app counts its own requests. After the third request in 15 minutes it says: *"You've asked three times. Wait 15 minutes, then try again."* Today a fourth request quietly sends nothing. The count is the phone's own, so it reveals nothing about the address.

### 3. After the right code: the same steps as the link

A right code leads where the link leads on the phone that asked, on the same screen:

- the button naming the spotter: **"Move {name}'s spots to this phone"**, so the person sees whose spots are coming back before they move (the link on the asking phone does this today);
- if this phone already has a spotter: the existing warning naming it, with **Keep** or **Delete** to choose (SYC-266), first;
- if several spotters share that address (a parent keeping two children safe): pick which one;
- if this phone already is that spotter: "Your spots are already on this phone."

Then the app reloads as the spotter that came back, as it does after the link. If the app reloads or loses its connection part-way through a move, nothing is lost. For 15 minutes, when the app opens again or comes back online, it collects the answer to a move the server already made, and the phone becomes that spotter. It never makes a move on its own: a move that never reached the server is dropped, and the person chooses again. On the screen, "Try again" sends the move again (see Technical notes, "A lost answer mid-move").

### 4. A wrong code

Every refusal of a code reads the same, whatever the real reason (wrong digits, too many tries, too old, already used, asked on another phone or browser, or no such request at all):

> That code didn't work. Check it's from the newest email you asked for **on this phone**, and try again.

The server answers every code attempt in the same way and in the same time. So typing codes can never tell anyone whether an address is kept safe. That's SYC-3's promise, and the review found the first draft broke it (finding B1).

The app counts wrong tries since it last asked. After **five**, it stops offering the box and says:

> That code won't work any more. Send another email to get a new one.

with **Email me a new code**. This comes from the phone's own count, not from the server, so it reveals nothing. (The server separately stops accepting that code after five wrong tries.)

After **ten** wrong codes in an hour from one phone, for any addresses:

> Too many tries. Wait an hour and try again.

This is counted the same way whether or not the address is known, so it's safe to show.

### 5. The link still works, and stops sending people into a dead end

The link keeps working for people who use Cat Spotters in a browser, as today. Changes on the way:

- **The test site's password page**, when it's guarding a "get your spots back" link, adds one line above the password box: *"Use Cat Spotters from an icon on your home screen? Go back to it and type the 8-digit code from the email."*
- **"Is this the app or browser you use for Cat Spotters?"** gets a third answer: **"I use the Cat Spotters icon on my home screen"**. It says: *"Go back to Cat Spotters from your home screen and type the code from this email there."* No spots move.
- **"No, copy the link"** and the warning for links opened inside another app say "browser" only where a browser is really meant, and add: *"…or type the code from the email into Cat Spotters."*

### 6. Words that change elsewhere

- The "sent" line that said to open the link "in the same browser (Safari or Chrome)" is replaced by the code screen above.
- "Send me a link" → "Email me a code". The intro: "Type the email address that's keeping your spots safe, and we'll email it a code."
- Help & info says "a code" wherever it describes getting spots back with "a link".

All app words in English, Greek and French. The email stays English-only until SYC-4's native-speaker pass, as now.

## What stays the same

- **Who can get spots back:** only whoever can read the keep-safe inbox. Usernames still restore nothing.
- **Request limits:** 3 requests per address per asking phone per 15 minutes, 20 per network per hour, and the daily ceiling. The reply to "Email me a code" is identical whether or not the address is known, and takes the same time.
- **The email scanner rule:** opening the email or the link moves nothing. Only typing the code, or pressing the button, does.
- **Fifteen minutes, once.** A code and its link are one thing: using either uses up both. Five wrong code tries end the code and its link together. Only the phone that asked can type codes, so only that phone's wrong tries count.
- **The old phone** is told "Your spots moved to a new phone", as now.
- **It needs a connection**, as now. Offline, the screen says so.

## Safeguards for the code

An eight-digit code is far easier to guess than a link, so it gets rules the link doesn't need:

1. **The code only works on the phone that asked for it.** The link can be opened anywhere (Decision 12). The code can't. Someone who sees it over a shoulder can't type it into their own phone. This does **not** stop the "read me the code" trick, where the person asking is the attacker. That's why the email names the trick (Decision C).
2. **Five wrong tries per code, counted everywhere a code is checked.** There is exactly one place that checks codes (Technical notes), and the count goes up *before* the check, in a way that two checks at once can't both get past. Twenty tries at the same moment still get exactly five checks.
3. **Ten wrong codes an hour per phone.**
4. **Odds, honestly.** New phones are cheap: anyone can make 20 new "phones" an hour from one connection. So the per-phone limits don't hold back a determined attacker. The real limits are per network and across the whole service:
   - **One network:** 20 codes an hour, 5 tries each, would allow 100 guesses an hour, but every code check from one network also counts against a per-network limit of 60 an hour (Technical notes). So one network gets at most 60 guesses an hour, about a **1 in 1.7 million** chance an hour.
   - **Many networks, one family, worst case:** the daily ceiling of 200 restore emails, all aimed at one address, gives 1,000 guesses a day: about **1 in 100,000 a day**, roughly 1 in 3,000 over a month of non-stop effort. Meanwhile the family gets about 200 emails a day, and every other family's restore is off for the day.
   - **That attack is loud, but nobody hears it today:** hitting the ceiling is only a log line. An alert to the team is its own ticket (Out of scope), because with eight digits it is no longer what keeps the odds down.
   - **IPv6.** The per-network count on restore requests uses the full address, so a client on IPv6 can count as a new network each time. Whether real clients reach the server over IPv6 is unchecked. Fixing it (grouping by network, as the other limiters already do) is its own small ticket, because it applies to adding an address too.
5. **The code is never stored as itself.** The server keeps a keyed fingerprint of it. The code, like the link, is cleared from the outbox once the email is sent.
6. **Nothing logged could rebuild a code.** Wrong tries are logged as a count against the request, never the digits.

## Decisions (Samuel, 24 Oct 2026)

**A. How strong is the code? — Decided: eight digits** (Samuel, 24 Oct 2026). About 1 in 100,000 a day at worst against one family; same number keyboard; no lockouts. Not chosen: six digits plus a team alert (recommended in review; about 1 in 1,000 a day at worst), and six digits plus an address lock (a stranger could lock a family out).

**B. Can one person's request cancel another phone's code? — Decided: no, "3 live" is counted per address per phone** (Samuel, 24 Oct 2026, as recommended). The options were:
Today an address has at most 3 live links. A fourth request cancels the oldest, whichever phone asked. With codes tied to a phone, a stranger asking three times (or the family asking again from Safari) quietly kills the code the child is about to type, and the child sees "That code didn't work".
- *Count "3 live" per address per phone (recommended).* Nobody else's request can cancel yours. The guessing odds don't change, because a code only works on the phone that asked. An address can have more live links at once, but each is still single-use, lasts 15 minutes, and can't be guessed.
- *Keep "3 live per address".* No change, but a stranger can keep a home-screen family from ever getting their spots back. That's what the 8 Oct decision to count requests per asking phone was meant to prevent.

**C. What does the email say about sharing the code? — Decided: name the trick** (Samuel, 24 Oct 2026, as recommended). The options were:
- *"Only type this code in yourself, or give it to your own child for their phone. If anyone else asks you for it, they're trying to take someone's spots." (recommended, drafted above.)* Matches how families really use it, and names the trick.
- *"Never share this code with anyone, even a friend."* Simpler, but parents share it with their children by design, so the warning teaches people to ignore it.

**D. Should the code appear in the email's subject? — Decided: yes** (Samuel, 24 Oct 2026; the review recommended no). "48291376 is your Cat Spotters code": faster, and a phone is more likely to offer it automatically. Accepted cost: the code shows on the lock screen and in notification previews.

## Technical notes (skip if you're reading for the decision)

- **One place checks codes: a code becomes a handle.** New endpoint `POST /api/restore/code` with `{deviceId, code}` and the device secret. A right code returns a fresh 256-bit **handle**. That's a second token stored as `handle_hash` on the same `mail_tokens` row, valid until the row's own expiry. From then on the app uses the existing `/restore/peek`, `/restore/redeem` and the same-phone replay with the handle in place of the link's token, unchanged. Choice ids, the spend's conditional write, `abandonCurrent`/`deleteCurrent` and the replay after "Delete Nikos" all work as today, because the row is found by a hash of a 256-bit secret, as before. Peek and redeem never see codes. (Review B2, S4.) `readToken`, `choiceId` and `replayAfterMove` look the row up by `token_hash = h or handle_hash = h`. A `handle_hash` is never sent in an email, so the link and the handle can't be confused.
- **A per-network limit in front of `/restore/code`.** Before anything else, the shared limiter `keep_safe_code_ip` takes one from the calling network's hour: 60 an hour, failing closed, answering `429 {"error":"too_many_tries"}`. A whole family on one connection never gets near it, and it caps what one network can guess. It depends only on the network, so it says nothing about any address. The per-phone hour below still applies.
- **Counting, atomically, before comparing.** In one transaction, after `verifyDeviceSecret`:
  1. Take one from the per-phone bucket `keep_safe_code` (shared limiter, keyed by device id, 10 per hour, failing closed). Taking happens after device auth, so nobody can spend another phone's hour with just its id. If it's spent, answer "too many tries" (429).
  2. `update mail_tokens set code_attempts = code_attempts + 1 where purpose = 'restore' and device_id = $caller and used_at is null and expires_at > now() and code_attempts < 5 returning id, code_hash`. This locks the rows and counts a try against every live row of this phone (it can't tell which one the person meant). A phone with live rows for two addresses tests both with one guess.
  3. Compare against only the returned rows. Exactly one match: undo that row's increment, return a handle for it, and give back the bucket token. No match: any row now at 5 gets `expires_at = now()` (code and link end together).
  4. Pad every answer from this endpoint to one fixed deadline. Every refusal is the same `401 {"error":"code_not_valid"}`, whether the phone has live rows or not.
- **Storage.** `mail_tokens` gains `code_hash text`, `code_attempts int not null default 0`, `handle_hash text` (unique where not null). `code_hash = HMAC(fingerprint key, "restore_code:" + token_hash + ":" + code)`. Including the row's own hash means equal codes on different rows have different fingerprints in a database copy. The code comes from `crypto.randomInt(0, 100_000_000)`, zero-padded to eight digits. The raw code joins the raw token in the outbox payload and is cleared with it (`outbox.ts`). An email still retrying after its code was killed arrives with a dead code. That's harmless, and the single refusal covers it.
- **Live-link cap per phone (if Decision B goes as recommended).** `requestRestore`'s "oldest expires to make room" query adds `and device_id = ${askingDeviceId}`.
- **Email template.** `restoreLink` in `keepSafeTemplates.ts` gains `code` (validated as exactly eight digits, and used in both the subject and the body) and `askedAt` (a time our own code formats, validated as `HH:MM`). The template's rule that only our own values go in still holds.
- **App: where the waiting flag is read.** The flag is `{askedAt}` in local storage, live for 15 minutes:
  - `OnboardingFlow` starts at the restore step, in its code state, when the flag is live;
  - `OnboardingGate` (`_layout.tsx`) sends a named phone with a live flag to `/get-spots-back`;
  - it's cleared on success, and in `adoptRestoredIdentity`, `startAgain` and `resetIdentity` (`DeviceContext.tsx`), because a new device id makes the code useless.
  - The app's own request count and wrong-try count live beside it, with the same lifetime.
- **App: shared states.** The choose / warning / moving states move out of `app/restore.tsx` into a component used by both the link page and the code screen. The box is a single `TextInput` with `inputMode="numeric"`, `autoComplete="one-time-code"`, `textContentType="oneTimeCode"`, `maxLength` 10, spaces stripped.
- **The same-phone replay: 15 minutes.** For 15 minutes after a move (the link's and code's own lifetime, `REPLAY_WINDOW_SECONDS`), the phone that made it gets the same answer if it asks again, and nothing moves twice. Only that phone: the replay matches the moved spotter's credential against the caller's own secret. On `/restore/redeem` the replay runs **before** the per-network redeem limit, so a phone finishing its own move is never told 429 by it. Everything else still passes that limit. A separate, generous per-network limit (`keep_safe_replay`, 120 an hour, `429 {"error":"too_many_tries"}`) sits in front of the replay itself, and the app treats any 429 as "try again later". The app's background finishing (start-up, back online, the chooser opening) sends `replayOnly`: the server then answers only with the replay, and otherwise with the one refusal, never a fresh move. Only "Try again", with the person there, sends a full move.
- **A lost answer mid-move.** Before redeem, the code screen stores "moving, handle H" with the same 15-minute life. While that is stored and the phone hasn't become the restored spotter:
  - **Without the person there** (the app opening, coming back online, or the code screen reopening on the same code), the app sends `replayOnly` with H. It only collects the answer to a move the server already made, within those 15 minutes, and adopts the spotter that came back. A move that never reached the server is refused; the stored move is cleared and the person chooses again.
  - **"Try again" on the screen**, with the person there and the same code, sends the move again in full.
  - One try at a time. Only a definite refusal (a 4xx other than 429) clears the stored move; a 429, a network error or a 5xx keeps it for the next try. An answer is adopted only if the same stored move is still there and the phone still holds the id the request was sent as. A stored move for a different code is forgotten when the code screen opens on a new one; the link page leaves it alone.
  - Meanwhile the screen says "We couldn't confirm the move yet. Check your connection and try again. Your spots are safe.", never "Nothing has moved". Keep and Delete moves are both handled this way.
- **Password page.** `server/prelaunch-page.js` shows the home-screen line when the requested path is `/restore`. It can't read the `#t=` fragment, so it keys on the path alone.
- **Mobile networks.** Greek carriers put many phones behind one address, so the per-network limits are shared. Watch the `restore: no link sent` / `per_ip` log rate after launch. Not changed here.

## Tests

- A right code from the asking phone returns a handle; peek and redeem with the handle move the spots.
- The same right code from another phone gets the single refusal, identical to a wrong code.
- **Unknown versus known address:** seven wrong codes each give identical status, body and timing (within the pad) (B1).
- Twenty wrong codes sent at once leave `code_attempts = 5` and make at most five comparisons (B2).
- After five wrong tries, the right code is refused and the link is dead.
- Per-phone cap: the eleventh wrong code in an hour gets "too many tries", whatever the address. Requests with that phone's id but no secret don't spend its cap.
- A phone with live rows for two addresses: the right code for either works, and a wrong code counts against both.
- Using the code (handle) spends the link, and using the link makes the code fail.
- "Delete Nikos" through a code, with the first redeem response dropped: the retry is answered by the replay, and the phone ends up as the restored spotter, not wiped (S4).
- The same phone's retry is answered at 14 minutes and refused at 16, and is answered even when its network's redeem limit is used up.
- App: a Keep move whose answer is lost after the server made it is collected in the session (back online, or "Try again") and the phone becomes the restored spotter. A "Move, delete Nikos" that never reached the server, then backed out of, is not carried out when the phone comes back online. A 429 never clears the stored move or says the code has expired. Opening a restore link leaves a code move's stored move alone.
- If Decision B goes as recommended: a stranger's three requests don't expire this phone's code.
- Neither the raw code nor the handle is in the database after sending or in any captured log line.
- App: a reload with a live flag reopens the code box from first-run and from Settings. After 15 minutes, after "Delete my data", after "Start again" and after spots come back, it doesn't. "4829 1376" and "48291376" both work. The fourth request shows the wait message. The fifth wrong try shows "send another". The "home screen icon" answer on the link page moves nothing. The password page on `/restore` shows the code line.
- Browser check at 390px and desktop: email → code → spots back, with the fake mail endpoint, from both entry points.
- **On a real iPhone, from the home-screen icon** (Samuel, on the test site once it's live): ask, read the code in Mail, switch back, type it, spots back in the icon app. Also note whether "From Mail" offered the code, in the icon app and in Safari.

## Out of scope

- The native apps (SYC-137): their links can open the app directly. The code works there too, unchanged.
- Translating the email (SYC-4).
- Grouping IPv6 addresses by network in the keep-safe request limits (SYC-667).
- Telling the team when the daily restore ceiling is hit (its own ticket).
