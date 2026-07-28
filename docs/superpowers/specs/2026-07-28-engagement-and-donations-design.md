# Engagement, scoring, learning and donations — design

**Date:** 28 July 2026
**Status:** For review
**Scope:** Sub-projects E (engagement and retention) and F (donations), plus a rework of the existing scoring and badge system and a new learning layer.

**Related:** [`docs/SPEC.md`](../../SPEC.md) (the app as built) · [`2026-07-28-cat-health-record-design.md`](./2026-07-28-cat-health-record-design.md) (sub-projects A, C₁ and G)

---

## 1. The two problems this solves

### 1.1 The scoring rewards the thing that damages the data most

Naming a new cat earns **50 points**. Confirming an existing one earns **10**. The app pays a spotter five times more to declare a cat unknown than to recognise it — and the person deciding is a tourist looking at a tabby who gets a bigger number for pressing "nobody I recognise".

That is the exact failure mode that breaks every figure in the impact report. A duplicate cat inflates the island count, deflates the sterilisation percentage, and adds a phantom to the trapping list. The health record design builds an elaborate confidence model to keep the data honest; leaving a 5× incentive pointing the other way undoes it.

### 1.2 The core loop has a ceiling and nothing beyond it

Collecting is finite. Once someone has met the cats near them, the app has nothing further to ask. A tourist reaches that in a few days; a resident reaches it permanently and much sooner. A re-sighting currently earns 10 points and no acknowledgement of any kind.

This is a missed alignment. **The charity urgently needs re-sightings** — a cat unseen for six months is a welfare question. "Cats nobody has checked on lately" is simultaneously the missing game mechanic and a real operational need.

---

## 2. Audiences

Retention means something different for each, and they need different mechanics.

| Cohort | Window | What brings them back |
|---|---|---|
| **Tourists, during the trip** | 5–9 days | Streaks, collection, nearby coverage challenges |
| **Tourists, after leaving** | Years | News about *their* cats — the only loop that works with the app closed |
| **Boundless Life families** | 1–3 months | Coverage, teams, learning; the education programme is the frame |
| **Residents** | Permanent | Freshness, guardianship, depth, local standing |
| **Volunteers and staff** | Ongoing | Less friction. The one group where good design means getting out of the way |

### 2.1 Boundless Life is the strategic lead

Boundless families are the only cohort that can realistically map the island. Tourists are too brief and stay near the harbour; residents walk the same few streets. A family on a one-to-three month stay, with children who have structured time and no fixed itinerary, can systematically cover Ano Syros, Vari, Galissas and Kini — the places nobody photographs.

Because Boundless runs cohorts continuously, **each intake is a fresh wave of mappers** — a renewable engine rather than a one-off campaign, and the closest thing to a real answer to "as many cats as possible, across the island".

It is also where the learning layer stops being decoration and becomes the point: animal welfare, why TNR works, island ecology, and citizen science as something you do rather than read about.

**Assumptions pending engagement with Boundless:** individual accounts, no minor-specific mode. A dedicated schools/programme mode is worth exploring but is not assumed here.

**One narrow safeguarding point that survives that decision.** The app publishes an opaque spotter code plus **a display name the user types themselves**. Nothing structural exposes a child, but a ten-year-old can type their real name into a public field. Mitigation is at the point of entry — guidance and validation on the username step — not a mode anywhere else. Revisit only if Boundless's own safeguarding policy requires more.

---

## 3. The retention loops

Five loops, of which only the first is currently built (as collection).

**1. Collection** — finite, works once, still the hook.

**2. Freshness — the most valuable addition.** Cats need re-checking, forever. Unseen for two months is a question; six months is a welfare concern. The app starts asking: *"Nobody has seen Kyra since April — she's usually near the fish market."* Infinitely renewable, matches the charity's operational need, and converts the app from a collection you finish into a patch you look after. **If only one thing is built for retention, it is this.**

**3. Depth** — when every nearby cat is met, plenty is still unknown *about* them. Progress goes vertical rather than horizontal. Feeds directly into the health record.

**4. Story — the only loop that works after someone leaves.** *"Agatha, the cat you named in June, was sterilised last week."* Requires no spotting and no app-opening. This is the entire post-trip relationship, and the honest moment to ask for money: someone who has just learned their cat was helped is in a completely different frame from someone looking at a donate button.

**5. Coverage** — go where nobody has been. Finite in principle, vast in practice, and precisely the missing data. The Boundless loop.

**6. Social** — teams and cohorts, comparison against people you know rather than strangers.

---

## 4. Scoring rework

### 4.1 Rebalance

| Action | Now | Proposed |
|---|---|---|
| Confirm an existing cat | 10 | 15 |
| Discover a new cat | 50 | 25 |

The gap should reflect that discovery is genuinely more valuable — not that misidentification pays five times better than care.

### 4.2 Points follow need

The app knows which cats have not been seen in months, which have unknown health, and which areas are unsurveyed. Those are worth more, visibly, with the reason attached.

**The scoring system becomes the charity's task queue.** A player chasing points does the work that would otherwise be asked of volunteers. This is the same alignment that makes the health record work, applied to motivation.

### 4.3 Standing, separate from points

Points measure activity. **Standing measures whether you are any good.** When a volunteer confirms what you reported, your standing rises.

The claims model already computes this — it is currently invisible. Surfacing it:

- gives residents a ladder that does not depend on finding new cats
- makes accuracy matter, which nothing currently does
- **makes the progression system and the data-quality system the same machine**, rather than two systems pulling in opposite directions

### 4.4 Time-boxed leaderboards

All-time points mean a tourist arriving in August competes for a rank they can never reach. Add this week, this month, this season, and team boards. Everyone should be able to win *something* during the days they are actually present.

### 4.5 Badges with character

The current seven are all "do X, N times". Replace with categories:

| Category | Example |
|---|---|
| **Coverage** | A cat in every neighbourhood |
| **Care** | A health observation later confirmed by a vet |
| **Skill** | Ten confirmations, none overturned |
| **Loyalty** | Returned a second year |
| **Rarity** | Met a cat only four people have ever seen |

**Rarity costs nothing and is the best of them.** Some cats are seen by three people a year, and the app already knows which. *"Only four people have ever met Kyra"* turns an ordinary tabby into a trophy, generated entirely from data already being collected.

---

## 5. The learning layer

### 5.1 Placement

**Use the dead time that already exists.** The app has a genuinely captive moment: the seconds while it compares a photo against known cats. That is the best real estate in the product and it currently shows a spinner. Same for the first-launch map download and offline syncing.

### 5.2 Contextual over generic

Generic trivia is wallpaper. *"Tortoiseshells are almost always female — here's why"*, shown the moment someone photographs one, is memorable **and** quietly teaches the coat vocabulary the record needs people to use. Contextual facts do double duty: engagement and data quality.

### 5.3 Spend the best moments on welfare

The app tells people "don't feed the cats" once, in onboarding, where nobody reads it. Explaining *why* — at the moment someone is standing in front of a hungry cat with a sandwich — is the difference between a line of copy and a behaviour change. Same for how to approach a cat and what to do about an injured one.

**This is welfare impact wearing an engagement costume**, and it is the part Syros Cats will care about most.

### 5.4 A field guide that fills in

Coat patterns, ear-tips and what they mean, why TNR works, island ecology. Gives the learning somewhere to accumulate, and for Boundless it is the backbone of programme mode — a cohort can be taught through it rather than merely entertained.

### 5.5 A daily something

One fact, or a two-question quiz: a reason to open the app on a day with no cats. Modest, cheap, and what keeps a streak alive when the weather is bad.

### 5.6 Humour, with two constraints

Humour has a half-life — a joke seen twice is worse than none — so jokes belong in rotating, low-stakes spots: empty states, loading, the occasional error.

**Puns do not translate.** A gag written in English is not a gag in Greek or French, so humour must be **authored per language**, not translated. That is a real content cost, and the reason to keep the joke count small and the fact count large.

### 5.7 Author the content; do not generate it live

A hundred or so reviewed facts, written once, cost nothing to serve and cannot hallucinate. Generating per request would add cost to every screen and eventually tell someone something false about cats — which is exactly the credibility the charity is lending this app. AI may draft; the shipped artefact is reviewed content.

---

## 6. Donations

### 6.1 The moment matters more than the mechanism

Ranked by likely conversion:

1. **"Your cat was helped."** A message after someone has gone home saying Agatha was sterilised. Highest intent by a distance, because the outcome comes first and the ask follows it.
2. **End of trip.** "You met 14 cats on Syros" — a souvenir worth keeping, with giving attached.
3. **On a specific cat's page.** Sponsor this cat's sterilisation.
4. **The Help tab.** What exists today, and the weakest, because it asks in the abstract.

### 6.2 What to offer

**A ladder of outcomes, not a row of amounts.** Every rung says what it buys, so the smallest gift is still a specific act rather than a token:

| Amount | What it buys | Friction |
|---|---|---|
| **€1** | Feeds a cat for a day | Almost none — an impulse, available to anyone |
| **€7** | Feeds a cat for a week | Low |
| **€25** | A week's petrol for the volunteers | Moderate — funds the work, not just the cat |
| **€50–60** | Sterilises one cat | A decision — the hero tier |
| **€120** | Sterilises two | For the committed |

The ladder matters more than any single tier. A €60 ask converts a small number of people and loses everyone else silently; a €1 ask converts almost anyone and starts a relationship the story loop can build on. **The first donation's job is to make the second one possible.**

The €25 rung is worth keeping distinct because it funds *the volunteers rather than the cats* — petrol, transport, the unglamorous cost nobody usually offers to cover. Some donors specifically prefer that, and no other charity app asks for it.

Alongside the ladder:

- **Sponsor a sterilisation** — the strongest single product: specific, completable, with a named beneficiary who has a face. When it happens, the app can *prove* it on the cat's page.
- **Sponsor a cat monthly** — best long-term value, sustained by the story loop.
- **Give as a gift** — a sterilisation in someone's name. Works at Christmas, and for "in memory of".
- **Non-monetary giving, first class** — share, volunteer, adopt. Many of the most engaged users have the least money, and treating cash as the only contribution wastes them.

### 6.3 The €1 problem, and how to keep it

Card processing costs roughly a fixed fee plus a small percentage, so **a €1 donation can lose a quarter or more of its value to fees**. That is not a reason to drop the tier — it is the highest-converting rung on the ladder — but taking it as a single card payment is wasteful enough that the charity would notice.

Three ways to keep the €1 framing without the fee drag, in order of preference:

1. **Sell the outcome, bill it in a bundle.** "Feed a cat for a month — €30" is one transaction with a trivial relative fee, and it is *recurring*, which is what a charity most wants. The €1/day framing does the persuading; the billing happens sensibly.
2. **Recurring micro-gifts.** €1/day or €5/month as a standing arrangement — again one payment instrument, many days of value.
3. **Accept the fee on true one-offs**, and be transparent that small gifts carry a processing cost, with a nudge toward the bundle.

What to avoid: holding a balance for users, which turns the app into a payments product with the regulatory weight that implies.

### 6.4 Cost correction and its consequence

Syros Cats report a sterilisation costs **€50–60**, not the €25 in the app's campaign copy (filed as SYC-14).

**At €60 rather than €25, co-funding becomes the main mechanic rather than a nicety.** €25 is an impulse; €60 is a decision. So *"Agatha's sterilisation: €38 of €60 — 4 supporters"* does real work: someone can give €10 and still be part of a specific outcome, a completable goal appears on a specific cat's page, and the thank-you on the care timeline becomes collective. At €25 this would have been over-engineering.

Suggested amounts reshape around the real cost: **€10 / €25 / €60 (sterilise a cat) / €120**, with the sterilisation tier as the hero.

### 6.5 Transparency is the unfair advantage

*"This sterilisation was funded by three supporters"* on a cat's care timeline is just another observation in the record already designed. Most charities can only describe where money goes in aggregate; this one can point at a specific cat on a specific date.

### 6.6 Money must never buy points

No score, no rank, no leaderboard movement for donating. Recognition is fine — a supporter mark, a thank-you on the cat's page — but the moment euros convert into standing, the leaderboard stops measuring contribution and starts measuring wallet, and everything in §4 is undone.

### 6.7 Practical constraints that decide the build

- **Apple and Google take a large cut of in-app purchases.** Charitable donations escape it only if handled exactly to their rules — in practice, checkout outside the app. Done carelessly, this gets the app rejected from the stores.
- **Card processing has a fixed fee per transaction**, so very small gifts lose a disproportionate share. Set a sensible minimum.
- **Syros Cats must specify** how money reaches them and what Greek charity rules require by way of receipts.

---

## 7. Testing

Scoring and standing are pure functions of recorded events and are unit-tested as such: rebalanced awards, need-based multipliers, standing derived from confirmation outcomes, rarity computation, and leaderboard windowing across timezone boundaries (reusing the Europe/Athens bucketing already established for streaks).

Content is validated for parity across all three languages — a fact or joke present in one language must exist in all three, or be marked as language-specific by design.

Donation flows are tested for the invariant that **no donation event can alter points, standing or rank**.

---

## 8. Open questions

1. **Boundless Life programme shape** — individual, team or cohort play; ages; whether a dedicated programme mode is wanted. Blocked on their engagement.
2. **Does Boundless have a safeguarding policy** that imposes requirements beyond §2.1?
3. **Confirmed sterilisation and vaccination costs** for the campaign copy (SYC-14).
4. **How donations reach Syros Cats**, and Greek receipt requirements.
5. **Who authors the content library** — facts, welfare guidance and jokes, in three languages. This is a content commission, not an engineering task, and the Greek and French need native writers rather than translation.

---

## 9. Out of scope

- Buying progress with money, in any form.
- Runtime AI generation of facts or jokes.
- A separate child-safety mode, pending Boundless's requirements.
- Any mechanic that rewards volume over accuracy.
