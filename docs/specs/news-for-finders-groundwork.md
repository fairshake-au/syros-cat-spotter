# "What happened to your cat": groundwork and questions for Syros Cats

**Linear:** SYC-779 (push and bell) + SYC-55 (email) · epic SYC-612
**Status:** waiting on Syros Cats' answers before the spec is written (CLAUDE.md: ask before the spec) · 1 Nov 2026
**Builds on:** `news-in-your-language.md` (SYC-221), `email-capture.md` (approved 28 Sep 2026, amended 15 Oct)

## 1. The goal

Show people what happened to the cats they found, for example: "Tigris, the cat you found, was sterilised today." This goes by push, as a line in the app's bell list, and by email for people who asked for it.

## 2. What already exists

Checked on `origin/main` ca387225f, 1 Nov 2026, from the code and docs. I didn't check the live app.

| Piece | State today | Evidence |
|---|---|---|
| **Auto-follow on discovery** | Already built. Every spot follows the cat, including the spot that discovers it. Unfollowing is remembered, so spotting the cat again doesn't quietly re-follow it. | `routes/sightings.ts:1159`, `lib/following.ts` |
| **Who discovered the cat** | Recorded (`cats.discoverer_device_id`). It's cleared if that person deletes their data. | `lib/db/src/schema/cats.ts:34` |
| **"Sterilised" news** | Already sent: a push and a bell line to every follower, the first time a cat becomes confirmed sterilised, once per cat. English only. It sends at any hour. | `lib/commitStatement.ts:99-121`, `notificationFanout.ts` |
| **"Has a home" news** | Already sent: a push only, with no bell line, when an owner first claims the cat. English only. | `routes/cats.ts:565` |
| **Vaccinated** | Recorded by the team only, through vet visits. Today the public never sees it, not even on the cat's page. | `capabilities.ts:84`, `coat-markings-and-health.md:29` |
| **Named** | Recorded when the finder names a new cat, when someone who has met an unnamed cat names it, when an owner renames it, and by the team. No news is sent. | `routes/sightings.ts:1097`, `routes/cats.ts:844, 1006` |
| **"Confirmed by a cat guardian"** | Not a separate event. A guardian's "sterilised" or "homed" statement simply counts as confirmed, and that already triggers the sterilised news above. | `lib/guardianStatements.ts`, `lib/resolve.ts` |
| **Notification settings / quiet hours** | None. The only controls are unfollowing a cat and the phone's own push permission. Monday's push keeps to 08:00–20:00 Syros time and the evening round-up is sent from 20:00; sterilised news has no time limit. | `app/settings.tsx`, `weeklyClose.ts:35`, `sightingRoundUp.ts:41` |
| **Email news (SYC-45)** | Slice 1 of 5 only: the nightly check, watch-only. It sends nothing. It looks for three kinds of news: sterilised, found a home, and seen again after 4+ months. Nothing for vaccinated or named. | #239, `lib/news/nightly.ts` |

**What this means.** The "auto-follow" half of SYC-779 is done. The real work is:

1. Saying "the cat **you found**" to the finder specifically.
2. Adding the new kinds of news.
3. Quiet hours and a notification setting.
4. Making push, bell and email agree, so one event isn't announced twice, or announced by push when email would hold it back.

## 3. Things Samuel will need to decide (in the spec, after Syros Cats answer)

These are listed now so the spec can be quick. Each will come with options and a recommendation.

- **Vaccination is private today.** Telling followers "was vaccinated" would make it public for the first time. It also isn't in the approved email consent wording ("sterilised, found a home, or turning up again"). Adding it to email would need new wording, and the consent people already gave wouldn't cover it.
- **"Named" news.** Is a new name news worth a push? The finder usually named the cat themselves.
- **"Today" can be untrue.** The team and vet visits can record something on a past date. A message saying "today" must use the date it actually happened, or leave out the day.
- **The instant push and the nightly email follow different rules.** The nightly check ignores old, imported or bulk changes. The instant sterilised push has none of those guards, so the same event could be pushed but held back from email. The spec should give both one set of rules.
- **Quiet hours.** A sterilised push can arrive at 3 am today. The likely fix is to hold pushes to 08:00–21:00 Syros time, as the Monday push already does.

## 4. Questions for Jacky or Susan

Plain questions for Samuel to send. Their answers go into the Syros Cats fact sheet (SYC-761) and are quoted in the spec.

1. **When a cat is sterilised, when does it usually get written down, and by whom?** Is it the same day, or sometimes days or weeks later, in a batch? (This decides whether a message can honestly say "today".)
2. **Vaccinations: are you happy for the person who found a cat to be told it was vaccinated?** Or is vaccination something you'd rather keep between Syros Cats and the vets?
3. **When one of your cats goes to a home, how does that happen, and would you want the cat's followers told "Tigris has found a home"?** Are there times you'd rather they weren't told? For example, a cat taken into care, a foster that may come back, or a home you'd rather keep private.
4. **Cat guardians: when a guardian tells you a cat is sterilised or has been taken in, are you happy for that to be shared with the people who follow the cat?** Or should it wait until Syros Cats has checked it?
5. **Is there anything about a cat you'd never want sent to the public?** For example, illness, injury, or being taken to the vet. And is it all right for the "sterilised" message to end with one line about donating ("a sterilisation costs €50–60")?

## 5. What's next

- Samuel sends the five questions. The answers go into `docs/syros-cats-facts.md` (SYC-761).
- Then the spec gets written. It covers the finder's wording, the kinds of news, quiet hours, a notification setting, one rule set for push, bell and email, and no location in any message. Then adversarial review, then Samuel's approval.
- SYC-221 (the words in each language) can be built while we wait. SYC-779's messages reuse its word table.
