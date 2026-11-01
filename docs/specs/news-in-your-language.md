# Cat news in your language (pushes and the bell)

**Linear:** SYC-221 · epic SYC-612 · groundwork for SYC-779 ("Tigris, the cat you found, was sterilised today")
**Status:** draft, waiting for Samuel's approval · 1 Nov 2026

## 1. The problem, in plain English

A Greek or French spotter gets most news about their cats in English: on the lock screen and in the app's bell list. The app itself is in their language; the news isn't.

SYC-779 will add more news ("was vaccinated", "was named", "was confirmed by a cat guardian"). If we add those in English only, we'd have to redo them. So this comes first.

## 2. What's already there (checked on `origin/main` ca387225f, 1 Nov 2026)

Half of the original ticket is already built. It shipped with the weekly Spotters board (#342, SYC-706):

- **The server already knows each phone's language.** `push_tokens.language` holds `en`, `el` or `fr`.
- The app sends it when it registers for pushes, and again whenever the person changes language (`NotificationContext.tsx`).
- A phone on an older app build sends no language. It is stored as empty and sent English.
- **Only one push uses it so far**: Monday's "Last week's top spotters" (`weeklyClose.ts`).

So **no new storage is needed for pushes**. What's left is the wording.

### Still English today

| News | Where it comes from | Push? | In the bell? |
|---|---|---|---|
| "Agatha has been sterilised!" | a confirmed sterilisation (`commitStatement.ts`) | yes, every follower | yes, stored English words |
| "Agatha was spotted again!" / "was seen on Tuesday" / "was seen on 3 October" | a sighting, to the cat's owner only (`sightings.ts`, `sightingMessage.ts`) | yes | yes, stored English words |
| "Agatha was just discovered on Syros!" | a brand-new cat (`sightings.ts`) | rarely: a new cat has no other followers | yes, stored English words |
| Evening round-up: "Cats you follow: Agatha and 2 other cats you follow were spotted again." | `sightingRoundUp.ts` | yes | each cat's own row, stored English words |
| "Agatha has a home!" | an owner claims a cat (`cats.ts`) | yes | no |
| "Agatha is now Tigris!" / "Tigris's home details were updated by their owner." | an owner renames or edits (`cats.ts`) | yes | no |
| Anything the team types into the staff news route (`POST /cats/:catId/updates`) | staff | yes | yes, as typed |

## 3. What changes

**3.1 Pushes are worded in the phone's language.** One small table on the server holds the words for each kind of news in English, Greek and French (a new file, `artifacts/api-server/src/lib/newsWords.ts`). When a push goes out, it uses `push_tokens.language`. Empty or unknown means English, as today.

**3.2 The bell is worded in the app's language too.** Each piece of cat news records *what kind* of news it is (for example "sterilised" or "spotted again"), not just its English sentence. The app then words the bell entry itself, from its own word list, in whatever language the person is using now. If they switch from English to Greek, their old entries switch too.

- This needs **one new, optional column** on `cat_updates`: `wording` (a short label such as `sterilised`).
- It is a small migration. Nothing is copied and nothing is deleted.
- The English sentence is still stored as today, so older app builds keep showing it.

**3.3 The bell shows the cat's current name.** Today an entry keeps the name the cat had when the news was written. Once the app words the entry, it uses the cat's name now, the way merged cats already work (which-cat-is-which.md §9.3).

**3.4 Days and dates follow the language.** "Seen on Tuesday" becomes "την Τρίτη" or "mardi", always counted in Syros time, as today.

**3.5 Words for a cat whose sex we don't know.** Greek and French words often change with a cat's sex. The new lines use the forms the app already uses ("Η γάτα {name} βρήκε σπίτι!", or a colon: "Χρειάζεται βοήθεια: {name}"), so they never guess. All Greek and French lines are drafts for native review (SYC-4).

### What doesn't change

- Who gets news, and when. The rules stay as they are: owner-only sightings, the evening round-up, no news about a cat recorded as dead, no news to a phone that deleted its data.
- No push or bell entry ever names a place on the island.
- Staff-typed news stays exactly as typed (Decision 2).

## 4. Old phones and edge cases

| Situation | What happens |
|---|---|
| Phone on an old app build (sends no language) | Pushes in English, as today. Its bell shows the stored English words. |
| Phone that never allowed pushes | No pushes, as today. Its bell is worded in the app's language (3.2), since that's done on the phone. |
| Person changes language | The app already tells the server. The next push uses the new language, and the bell re-words straight away. |
| News written before this change | No `wording` label, so the bell shows its stored English words (Decision 3). |
| A language the server doesn't know | English. |

## 5. Decisions for Samuel

**Decision 1. Translate the bell as well, or only pushes?**

- **A. Pushes and bell (recommended).** One new column; the app words every entry. *Benefit:* the whole experience is in the person's language, and SYC-779's new kinds of news slot straight in. *Risk:* a migration and an app change, so it goes live only with a new app build (old builds keep English).
- **B. Pushes only.** No migration; server change only. *Benefit:* smaller, live as soon as the server is republished. *Risk:* a Greek spotter taps a Greek push and lands on an English bell entry. SYC-779 would have to come back and do the bell anyway.

**Decision 2. What about news the team types in themselves?**

- **A. Leave it as typed (recommended).** *Benefit:* simple, and today it's a staff-only route with no screen in front of it. *Risk:* a Greek message reaches a French phone in Greek. Rare.
- **B. Ask staff for all three languages.** *Benefit:* fully translated. *Risk:* extra work for Syros Cats every time, for something that's barely used.

**Decision 3. News already in people's bells?**

- **A. Leave old entries in English (recommended).** *Benefit:* nothing is guessed. *Risk:* a few weeks of older entries stay English for Greek and French spotters until they scroll past them.
- **B. Label old entries by matching their English sentence.** *Benefit:* everything re-words. *Risk:* matching sentences is fragile, and a wrong guess shows the wrong news.

## 6. How we'll know it works (tests)

1. Each kind of push in §2 comes out in English, Greek and French for a phone with that language, and in English for an empty or unknown one.
2. The evening round-up's "1 cat", "2 cats" and "3 or more cats" lines in all three languages.
3. "Seen on {day}" and "seen on {date}" in each language, using Syros time across a clock change (built from the Athens week helpers, never the wall clock).
4. Every new piece of cat news stores its `wording` label, and still stores the English sentence.
5. The bell list returns the label, and the app words it in the current language. With no label, it shows the stored words.
6. Staff-typed news has no label and shows as typed.
7. A test that fails if any of the three languages is missing a line (the same check `i18n.ts` already has).
8. No push or bell line contains a place name (an existing rule, extended to the new table).

## 7. Out of scope (later, in SYC-779 and SYC-55)

- New kinds of news (vaccinated, named, confirmed by a cat guardian), quiet hours, notification settings, email.
- Email will need its own language field. A person with no push permission has no `push_tokens` row; the email contact keeps its own language.
