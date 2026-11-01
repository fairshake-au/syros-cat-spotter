# Cat news in your language (pushes and the bell)

**Linear:** SYC-221 · epic SYC-612 · groundwork for SYC-779 ("Tigris, the cat you found, was sterilised today")
**Status:** approved by Samuel, 1 Nov 2026 ("Approve, all A": Decisions 1, 2 and 3 are all A) · adversarial review folded in (§9)

## 1. The problem, in plain English

Greek and French spotters get most news about their cats in English: on the lock screen, and in the app's bell list. The app itself is in their language. The news isn't.

SYC-779 will add more kinds of news ("was vaccinated", "was named", "was confirmed by a cat guardian"). If those go in English only, they'll have to be redone later. So this comes first.

## 2. What's already there

Checked on `origin/main` ca387225f, 1 Nov 2026.

Half of the original ticket is already built. It shipped with the weekly Spotters board (#342, SYC-706).

- **The server already knows each phone's language.** `push_tokens.language` holds `en`, `el` or `fr`.
- The app sends the language when it registers for pushes, and again whenever the person changes it (`NotificationContext.tsx`).
- An older app build sends no language, so it's stored as null and gets English. A later registration that sends no language leaves the stored one alone.
- **Only one push uses the language so far:** Monday's "Last week's top spotters" (`weeklyClose.ts`, with its `PushLanguage` and `WEEK_COPY` table).
- **The bell already shows each cat's current name.** It looks the name up live, and uses the surviving cat after a merge. Only the sentence is old: it's English text written when the news happened.

So **no new storage is needed for pushes**. What's left is the wording, plus a little storage so the bell can be worded too.

### Still English today

| News | Where it's written | Push? | In the bell? |
|---|---|---|---|
| "Agatha has been sterilised!" | a confirmed sterilisation (`commitStatement.ts`) | every follower, straight away | yes, stored English sentence |
| "Agatha was spotted again!" / "was seen on Tuesday" / "was seen on 3 October" | a sighting (`routes/sightings.ts`, `sightingMessage.ts`) | the cat's owner, straight away | yes, stored English sentence: owner straight away, other followers in the evening |
| "Agatha was just discovered on Syros!" | a brand-new cat (`routes/sightings.ts`) | in practice no one: the only follower is the discoverer, who is left out | in practice no one |
| Evening round-up, titled "Cats you follow": "Agatha was spotted again." / "Agatha and Tigris were spotted again." / "Agatha and 2 other cats you follow were spotted again." | `sightingRoundUp.ts` | followers, once an evening | each cat's own sighting row (above) |
| "Agatha has a home!" | an owner claims a cat (`routes/cats.ts`) | followers | no |
| "Agatha is now Tigris!" | an owner renames a cat (`routes/cats.ts`) | followers | no |
| "Tigris has an update": "Tigris's home details were updated by their owner." | an owner edits home details (`routes/cats.ts`) | followers | no |
| Whatever staff type into the staff news route (`POST /cats/:catId/updates`) | staff, no screen in front of it | followers | yes, as typed |

Also checked: the nightly news check (`news/nightly.ts`, SYC-45 Slice 1) and the mail-drain cron send no pushes and no news.

## 3. What changes

### 3.1 Pushes are worded in the phone's language

- One table on the server holds the words for every push above, in English, Greek and French. It's a new file, `artifacts/api-server/src/lib/newsWords.ts`.
- Monday's weekly words (`WEEK_COPY`, `rankWord`) move into it too, so there is one table, not two.
- Every push reads `push_tokens.language` when it's sent. A null or unknown language gets English, as today.
- That includes the paths that look up tokens without the language today: `notifyDevices` and `notifyCatFollowers` (`lib/notifications.ts`), the care-news fan-out (`notificationFanout.ts`) and the round-up query (`sightingRoundUp.ts`).
- A push is handed *what kind* of news it is and the names, not a finished English sentence. The words are picked per phone.

### 3.2 The bell is worded in the app's language too

Each piece of cat news records what kind it is, so the app can word it itself, in whatever language the person uses *now*. If they switch from English to Greek, their entries switch too.

That needs **two new, optional columns** on `cat_updates`:

| Column | Holds | Example |
|---|---|---|
| `wording` | the kind of news | `sterilised`, `spotted_again`, `seen_weekday`, `seen_date`, `new_cat` |
| `wording_day` | the Syros calendar day it refers to, for the "seen on…" kinds only | 2026-10-27 |

Why the day is stored:

- "Spotted again" or "seen on Tuesday" is decided when the news is written. It depends on how old the photo was by then.
- The photo can later be moved to another cat, or deleted, so the app can't work the day out again later.
- Storing the label and the day means an entry never changes meaning. It only changes language.

The rest of the change:

- It's a small migration. Nothing is copied or deleted.
- There's no append-only rule on `cat_updates`, and neither "delete my data" (`severPerson.ts`) nor merging cats (`mergeCats.ts`) touches it.
- The English sentence is still stored, so older app builds keep showing it.
- Every writer passes the label: `insertCatUpdate` takes it as an option, from `routes/sightings.ts`, `commitStatement.ts`, and the staff route, which stays unlabelled.
- The bell list (`GET /notifications/:deviceId`) returns `wording` and `wording_day`.
- The API description (`lib/api-spec/openapi.yaml`, `AppNotification`) gets both fields, and the app's client is regenerated.

**Why on `cat_updates` and not on the bell row.** The bell rows for weekly results and merges already carry structured fields (`place`, `weekPoints`, `survivorCatId`). But one piece of cat news becomes many bell rows: the owner's straight away, and the other followers' in the evening. The label belongs to the news, so it goes on the news.

**Followers see the same words as the owner.** A follower's evening bell row points at the same news as the owner's, so it can also say "seen on Tuesday". That's correct, and it never gives a time. The round-up *push* keeps its own summary words.

### 3.3 Days and dates

- "Seen on Tuesday" and "seen on 3 October" use the stored Syros day.
- The app formats the day in the current language through fixed patterns per language, not raw date-library output.
- Greek needs "την Τρίτη" (accusative) and "στις 3 Οκτωβρίου" (genitive month); French needs "mardi" and "le 3 octobre".
- The app's "Today / Earlier" headings in the bell keep using the phone's own clock, as today.

### 3.4 Words for a cat whose sex we don't know

Greek and French words often change with a cat's sex. Every line avoids guessing by using the generic "η γάτα" / "le chat" or a colon. The app already does this ("Η γάτα {name} βρήκε σπίτι!", "Χρειάζεται βοήθεια: {name}"). Draft lines:

| Kind | English | Greek (draft) | French (draft) |
|---|---|---|---|
| `sterilised` | {name} has been sterilised! | Η γάτα {name} στειρώθηκε! | {name} : stérilisation faite ! |
| `spotted_again` | {name} was spotted again! | Η γάτα {name} εντοπίστηκε ξανά! | {name} : vu à nouveau ! |
| `seen_weekday` | {name} was seen on {day} | Η γάτα {name} εντοπίστηκε την {day} | {name} : vu {day} |
| `seen_date` | {name} was seen on {date} | Η γάτα {name} εντοπίστηκε στις {date} | {name} : vu le {date} |
| `new_cat` | {name} was just discovered on Syros! | Νέα γάτα στη Σύρο: {name}! | Nouveau chat à Syros : {name} ! |
| home (push) | {name} has a home! | Η γάτα {name} βρήκε σπίτι! | {name} a trouvé un foyer ! |
| rename (push) | {old} is now {new}! / {new}'s owner renamed their cat. | Η γάτα {old} λέγεται πλέον {new}! / Ο ιδιοκτήτης της έδωσε στη γάτα {new} νέο όνομα. | {old} s’appelle maintenant {new} ! / Son propriétaire a rebaptisé ce chat {new}. |
| home details (push) | {name} has an update / {name}'s home details were updated by their owner. | Νέα για τη γάτα {name} / Τα στοιχεία σπιτιού της γάτας {name} ενημερώθηκαν. | Du nouveau pour {name} / Les infos du foyer de {name} ont été mises à jour. |
| round-up title | Cats you follow | Γάτες που ακολουθείς | Les chats que tu suis |
| round-up, 1 cat | {a} was spotted again. | Η γάτα {a} εντοπίστηκε ξανά. | {a} : vu à nouveau. |
| round-up, 2 cats | {a} and {b} were spotted again. | Οι γάτες {a} και {b} εντοπίστηκαν ξανά. | {a} et {b} ont été revus. |
| round-up, 3+ cats | {a} and {n} other cats you follow were spotted again. | Η γάτα {a} και {n} ακόμα γάτες που ακολουθείς εντοπίστηκαν ξανά. | {a} et {n} autres chats que tu suis ont été revus. |

The French "vu" and "revus" use the generic masculine, as French does for "le chat". French puts a no-break space before ":" and "!" so the mark never wraps onto its own line (PR 1 review). All Greek and French lines are drafts for native review (SYC-4), and the build PR carries the final table.

### What doesn't change

- **Who gets news, and when.** These stay as they are: owner-only live sightings, the evening round-up, no news about a cat recorded as dead, and nothing to a phone that deleted its data.
- No push or bell entry ever names a place on the island.
- Staff-typed news stays exactly as typed (Decision 2).

## 4. Old phones and edge cases

| Situation | What happens |
|---|---|
| Phone on an old app build (sends no language) | Pushes in English, as today. Its bell shows the stored English sentences. |
| Phone that never allowed pushes | No pushes, as today. Its bell is worded on the phone, in the app's language. |
| Person changes language | The app tells the server. The next push uses the new language, and the bell re-words straight away. If that update failed (no signal), pushes stay in the old language until the app next registers. |
| News written before this change | No label, so the bell shows the stored English sentence (Decision 3). |
| A language the server doesn't know | English. |

## 5. Decisions for Samuel

**Decision 1. Translate the bell as well as pushes?**

- **A. Pushes and bell, with two new columns (recommended).**
  - *Benefit:* the whole experience is in the person's language, and SYC-779's new kinds of news slot straight in.
  - *Risk:* a migration and an app change, so the bell part goes live only with a new app build. Old builds keep English.
- **B. Pushes only.**
  - *Benefit:* no migration, and it's live as soon as the server is republished.
  - *Risk:* a Greek spotter taps a Greek push and lands on an English bell entry. SYC-779 would have to come back and do the bell anyway.
- **C. Bell worded from what's already stored, with no new columns.**
  - *Benefit:* no migration.
  - *Risk:* it can't tell a confirmed sterilisation from staff-typed text, and it can't get "seen on Tuesday" right once a photo is moved or deleted. Not recommended.

**Decision 2. What about news the team types in themselves?**

- **A. Leave it as typed (recommended).**
  - *Benefit:* simple, and today it's a staff-only route with no screen in front of it.
  - *Risk:* a Greek message reaches a French phone in Greek. Rare.
- **B. Ask staff for all three languages.**
  - *Benefit:* fully translated.
  - *Risk:* extra work for Syros Cats every time, for something that's barely used.

**Decision 3. News already in people's bells?**

- **A. Leave old entries in English (recommended).**
  - *Benefit:* nothing is guessed.
  - *Risk:* older entries stay English for Greek and French spotters until they scroll past them.
- **B. Label old entries by matching their English sentence.**
  - *Benefit:* everything re-words.
  - *Risk:* matching sentences is fragile. It misses names changed by renames and merges, and a wrong guess shows the wrong news.

## 6. How we'll know it works (tests)

1. Every push in §2 comes out in English, Greek and French for a phone with that language, and in English for a null or unknown one. That includes the paths through `notifyDevices` and the round-up query.
2. The round-up's 1-cat, 2-cat and 3-or-more lines in all three languages.
3. "Seen on {day}" and "seen on {date}" in each language, using the stored Syros day. Cover a sighting at 00:30 Athens time, the 24-hour boundary and a clock change. Fixtures come from the Athens week helpers, never the wall clock.
4. Every new piece of cat news stores its label (and its day where needed), and still stores the English sentence.
5. The bell list returns the label and day, and the app words them in the current language. With no label, it shows the stored sentence.
6. Staff-typed news has no label and shows as typed.
7. A test fails if any language is missing a line in `newsWords.ts` or in the app's word list.
8. No push or bell line contains a place name.
9. The migration test and the database fingerprint check (`lib/db/src/switchover/fingerprint.ts`) pass with the new columns.
10. Test cat names are letters only (the `nameTag` helper, SYC-796).

## 7. Order of work (for the plan)

1. **Server:** the word table, plus language on every push. No migration; live on republish.
2. **Migration:** the two columns, and writers pass the label.
3. **API and app:** the bell words entries itself. Needs an app build.

Step 1 can go live on its own, so Greek and French pushes don't wait for an app release.

## 8. Out of scope (later, in SYC-779 and SYC-55)

- New kinds of news (vaccinated, named, confirmed by a cat guardian), quiet hours, notification settings, email.
- Email needs its own language: a person with no push permission has no `push_tokens` row. The email contact keeps its own language (`email_consent_events.language`).

## 9. Review

Adversarial review (Sonnet, 1 Nov 2026), all folded in:

- **Blocker, fixed:** a label alone can't rebuild "seen on Tuesday". The Syros day is now stored too (§3.2).
- The bell already shows current names. §2 is corrected and the old §3.3 removed.
- The round-up query and `notifyDevices` don't read the language yet (§3.1).
- The home-details push was missing (§2).
- Exact neutral lines for every kind (§3.4).
- Reuse the weekly table (§3.1).
- API, client and writer plumbing, plus the fingerprint check (§3.2, test 9).
- Option C added to Decision 1.
- The language-change timing note (§4).
