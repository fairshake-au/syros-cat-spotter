# Spotters naming a cat: three limits (SYC-709)

Short spec, 24 Oct 2026. Samuel's decisions are quoted on SYC-709 and SYC-714.

## What a spotter notices

A cat that Syros Cats added from a vet visit and left unnamed shows "No name yet" and its number. Spotters can choose its name, first come first served. Three rules now apply.

1. **You name a cat you've met.** "Name this cat" appears only on a phone that has a sighting of that cat. On any other phone, the card still says the cat has no name yet and adds: "Spot this cat and you can choose its name." There's no button. The page's existing "I've spotted…" button is how they get there.
2. **Up to 3 names a day per phone.** The 4th name in a rolling 24 hours is refused with: "You've named 3 cats today. You can name another tomorrow." A refused name (taken, rude, a link) doesn't use up one of the 3. Only a name that's saved counts.
3. **No links or phone numbers in a name.** A name that looks like a web link or contains a phone number is refused with: "Names can't include web links or phone numbers."

All three messages come in English, Greek and French, like the rest of the sheet.

Unchanged: naming still shares the per-connection allowance with sightings (20 every 15 minutes, SYC-714 "Keep it shared"). The team still renames from the cat's page, and there's no team list of names spotters chose (SYC-709 decision 1, "Nothing for now").

## What counts as a link or a phone number

A name is refused if it contains any of:

- `://` or `www.` (any case);
- a dot followed directly by a common web ending at the end of a word, such as `.com`, `.net`, `.org`, `.gr`, `.eu`, `.io`, `.info`, `.me`, `.app`, `.shop`, `.xyz`, `.ly`, `.link`, `.co`, `.uk`. "Mr.Whiskers" is fine, "buy-stuff.com" is not;
- 5 or more digits with nothing but spaces, dots, dashes or brackets between them, so "691 234 5678" counts as a phone number. Digits from any script count. "Agent 007" and "Kitty 2026" are fine.

**Where it applies:** every place a member of the public types a cat's name. That's naming a pending cat, naming a new cat while posting its first sighting, and an owner renaming their own cat, including the name typed while claiming. The team's own naming (vet visit batches, team corrections) isn't checked, and neither are the app's suggested names.

## How it works

- **Server, naming route** (`POST /cats/:catId/name`): after the existing name checks and inside the locked transaction:
  1. refuse with 403 `NEEDS_SIGHTING` unless this verified phone has a matched (resolved) sighting of this cat;
  2. after the name is written, count it against the phone's daily naming allowance (a new sliding 24-hour, per-device count of 3, counted in Postgres like the claim limit). If that count is over 3, undo the whole save and answer 429 `NAME_DAILY_LIMIT`. Counting inside the same transaction means a refused or failed name is never counted, and two saves at once from one phone can't both slip past the 3rd. The counter failing answers 503, like the other per-phone limits.
- **Link and number check:** one shared helper next to the existing SYR-number check, used on all the public naming paths above. Refused with 400 `NAME_HAS_LINK`.
- **Cat page answer:** `GET /cats/:id` gains `canName`, a per-phone yes/no: the cat is pending a name, and this proven phone has a matched sighting of it. It's false for anyone else and for phones that haven't proved themselves. This is the same pattern as `canClaim`. The app uses it to show the button or the "Spot this cat…" line.
- **Rate limit:** the route keeps `aiLimiter` unchanged, so no new CodeQL alert is expected.

## Edge cases

- A sighting that's still being matched doesn't count until it's matched to this cat. If the spotter reopens the page after it's matched, they'll see the button.
- A phone whose spotter deleted their data no longer owns its old sightings, so it can't name.
- An older app without `canName` treats it as missing and shows the button as before. The server still refuses with `NEEDS_SIGHTING`, and the sheet shows the server's message.

## Tests

Server: refused without a sighting, allowed with one; the 4th saved name refused, while refused attempts don't count; link and number examples, both allowed and refused, on every public naming path; `canName` true and false cases. App: the button shows or hides on `canName`, and each new refusal shows its message.

## Also in this PR (from the SYC-709 review list)

- A test of the naming route's unique-index fallback.
- Focus goes back to the "Name this cat" button when the sheet closes.

Left for SYC-712 or later: widening the raw-name guard test, and narrowing `nullOnUniqueViolation`.
