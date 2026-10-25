# Spotters naming a cat: three limits (SYC-709)

Short spec, 24 Oct 2026, revised after an independent review the same day. Samuel's decisions are quoted on SYC-709 and SYC-714.

## What a spotter notices

A cat that Syros Cats added from a vet visit and left unnamed shows "No name yet" and its number. Spotters can choose its name, first come first served. Three rules now apply.

1. **You name a cat you've met.** "Name this cat" appears only on a phone that has met the cat, by the same test that decides who may claim a cat: a matched sighting from this phone, still on the cat the spotter chose (a sighting the team later moved here from another cat doesn't count), or one of a cat merged into this one. On any other phone, the card still says the cat has no name yet and adds: "Spot this cat and you can choose its name." There's no button. They get there through the page's existing "I've spotted…" button, which opens Spot with this cat as the hint. A pending cat can also turn up as a look-alike when matching any sighting.
2. **Up to 3 names a day per phone.** The 4th name in one day is refused with: "You've named 3 cats today. You can name another tomorrow." A "day" runs from 02:00 to 02:00 Greek time in winter (03:00 in summer), because the count resets at midnight UTC. A refused name (taken, rude, a link) doesn't use up one of the 3. Only a name that's saved counts.
3. **No links or phone numbers in a name.** A name that looks like a web link or contains a phone number is refused with: "Names can't include web links or phone numbers." This is a best-effort filter, not a guarantee. The team can still rename.

All three messages come in English, Greek and French, like the rest of the sheet.

Unchanged: naming still shares the per-connection allowance with sightings (20 every 15 minutes, SYC-714 "Keep it shared"). So a busy shared café connection can still run out for both, which was accepted. The team still renames from the cat's page, and there's no team list of names spotters chose (SYC-709 decision 1, "Nothing for now").

## What counts as a link or a phone number

The name is first normalised (NFKC), so fullwidth dots and letters are caught. It's refused if it contains any of:

- `://` or `www.` (any case);
- a dot followed directly by a common web ending at the end of a word: `.com`, `.net`, `.org`, `.gr`, `.eu`, `.fr`, `.de`, `.it`, `.es`, `.uk`, `.ru`, `.info`, `.biz`, `.app`, `.shop`, `.site`, `.online`, `.xyz`, `.link`, `.ly`, `.tv`, `.cc`. So "Mr.Whiskers" and "Dr. Who" are fine, and "buy-stuff.com" isn't. `.co`, `.io` and `.me` are left out because they'd catch names like "Mr.Co". Messaging links like "t.me/x" or "wa.me/x" are caught by a separate rule: a dot-word followed by `/`.
- **digits that look like a phone number:** 5 or more digits in a row ("12345"), or 7 or more digits in a run where only single spaces, dots or dashes separate them ("691 234 5678", "+30 691-234-5678"). Digits from any script count. "Agent 007", "Kitty 2026", "No. 5" and "Cat 1 2 3" are fine. The rare "Agent 007 2026" would be refused.

**Where it applies:** every place a member of the public types a cat's name:

- naming a pending cat (`POST /cats/:catId/name`);
- naming a new cat while posting its first sighting (`newCatName` on `POST /sightings/:id/resolve`);
- an owner renaming their own cat (`PATCH /cats/:catId`). An unchanged name skips all checks, as it does now, so an existing name isn't re-judged.

Not checked: the team's own naming (vet visit batches, team corrections), the app's suggested names, and profile names.

## How it works

- **One "has met this cat" test.** The claim flow's existing rule (lib/claiming.ts, "Rule 2") moves into a shared `hasMetCat(exec, catId, deviceId)`. Claiming, naming and `canName` all use it, so a merged cat and a sighting the team moved behave the same everywhere.
- **Naming route**, in order:
  1. the existing name checks, plus the new link-and-number check (400 `NAME_HAS_LINK`);
  2. load the limit salts (`warmSalts`) before the transaction, as lib/limits.ts requires, so the counter never needs a second connection while the cat row is locked;
  3. in the transaction: lock the cat, then not found (404), then already named (409 `ALREADY_NAMED`), then `hasMetCat` (403 `NEEDS_SIGHTING`). That last check comes before the name lookup, so a phone that hasn't met the cat can't use the route to probe which names are taken. Then name taken (409), then the write;
  4. last in the transaction, count the save against a new per-phone bucket, `name_cat`: 3 per fixed UTC day, declared at load like the others. If it's over, throw a sentinel. That undoes the save and the count, and the route answers 429 `NAME_DAILY_LIMIT` with `Retry-After`. The existing unique-violation catch rethrows anything that isn't a unique violation, so the sentinel passes through it. Two saves at once from one phone queue on the counter row, so they can't both slip past the 3rd. If the counter breaks, the route answers 503, like the other per-phone limits.
- **Cat page answer:** `GET /cats/:id` gains an optional `canName`. It's true only when the cat is pending a name and this proven phone `hasMetCat`. The check runs only for pending cats, so other cat pages cost nothing extra. Caching is already per phone (`Vary: X-Device-Id, X-Device-Secret`). The field is added to the OpenAPI schema as not required, and the client packages are regenerated.
- **Rate limit:** the route keeps `aiLimiter` unchanged, so no new CodeQL alert is expected.

## Edge cases

- A sighting that's still being matched doesn't count until it's matched to this cat. The button appears on the next visit after that.
- A phone whose spotter deleted their data no longer owns its old sightings, so it can't name.
- An older app without `canName` shows the button as before. The server refuses with `NEEDS_SIGHTING`, and the sheet shows the server's message.

## Tests

- **Server:** the existing naming tests give each naming phone a met sighting first, including both phones in the race test. New cases:
  - refused without a sighting, with one still being matched, and with one the team moved here; allowed with a met one, and with one of a merged-in cat;
  - one phone saves 3 names on 4 pending cats, and the 4th is refused; refused attempts don't count;
  - 403 comes before 409 NAME_TAKEN for a phone that hasn't met the cat;
  - the link and number examples above, allowed and refused, on all three public paths;
  - `canName` true and false cases.
- **The claim tests still pass unchanged** after `hasMetCat` is pulled out.
- **App:** the button shows or hides on `canName`, each new refusal shows its message, and focus returns to the button when the sheet closes.

## Also in this PR (from the SYC-709 review list)

- Focus goes back to the "Name this cat" button when the sheet closes.

Left for SYC-712: widening the raw-name guard test, narrowing `nullOnUniqueViolation`, and a test of the naming route's unique-index fallback. That test needs a name to appear between the route's lookup and its write, which a plain database test can't time reliably.
