# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

Cat Spotters is one Expo codebase (`artifacts/cat-spotter`) that ships to the web and is installed from a phone's home screen today, with Apple App Store and Google Play publication as the goal. Samuel (1 Nov 2026) wants design to serve both: the web build and native iOS and Android builds that feel right on each OS. The Syros Cats team dashboard (`artifacts/api-server/src/lib/teamPages/`) is server-rendered web pages.

## Users

Samuel weighs the groups below equally (1 Nov 2026). When their needs conflict, settle it one screen at a time and don't default to either side. The two spotter audiences have **complementary** needs, not opposite ones.

- **Spotters: tourists and locals on Syros.** They meet a street cat, photograph it on their phone, and find out whether it's a known cat or a new one. Usually they're outdoors in the town and lanes, often with weak or no mobile data. Anyone can spot anonymously, with no account. Locals include families, and children use the app, sometimes on a parent's phone.
- **Cat guardians.** The people who feed and look after a colony. Syros Cats authorises them to arrange sterilisations, which the charity pays for.
- **The Syros Cats team** (Jacky, Susan, Jo and helpers). They use the team dashboard: the welfare report queue, feeding sites and colonies, cat record corrections, possible duplicates and naming moderation. They need data they can trust to plan trapping, sterilisation (TNR) and welfare work.

## Product Purpose

Cat Spotters turns the photos people take of Syros's street cats into a shared record of the island's cats, so the Syros Cats charity knows which cats exist, where they are, which are sterilised, and which need help. It builds a caring community around the cats and points people to the charity's work: sterilisation costs **€50–60 per cat**, and feeding is about €1 a day.

Success is judged by the launch measures Samuel chose on 30 Oct 2026 (SYC-760). No targets are set yet; launch week is the baseline.

1. Spots per week, and how many different spotters made them.
2. The share of spots matched to a cat the app already knows.
3. How long a spotter waits for matches (SYC-389).
4. Matching accuracy against confirmed sightings (SYC-56).
5. Whether the "follow this cat" email card changes how many spots people make (SYC-376).

## Positioning

A photo-first, island-scale cat register run with a real charity. A spotter's photo is compared by AI only against known cats within 500 m. The spotter confirms a match or names a new cat, so every sighting becomes data that Syros Cats uses for sterilisation and welfare work. It's playful for the visitor, with points, badges, streaks and named cats to follow, and careful about the cats: exact locations and feeding sites are protected, and welfare messaging respects how much the charity can take on.

## Operating Context

- **Spotting happens in the street:** bright Cycladic sun, one-handed use, a cat that may walk off, and patchy signal. Spots made offline wait in a queue on the phone and are sent and matched when it reconnects. The cat catalogue and the island's map tiles are saved on the phone, so browsing works offline too. Offline support is **partial**; never claim the whole app works without signal.
- **Three languages:** English, Greek and French, with Greek script throughout. Strings live in `artifacts/cat-spotter/lib/i18n.ts` and `artifacts/api-server/src/lib/teamPages/strings/*.ts`.
- **Accounts:** spotting is anonymous by default, tied to the device. An optional email ("Keep my spots safe") lets a spotter recover their spots with a code. Team members and cat guardians sign in by email.
- **Syros Cats' real working practices:** their records live in month-by-month WhatsApp groups, not structured records. Colonies are usually named after the place plus the cat guardian's name. Welfare reports go to admin@syroscats and to the dashboard queue. Anyone, mostly people with no account, may ask for sterilisation funding. Before designing anything that depends on how Syros Cats work, ask them first (see `CLAUDE.md` and SYC-761, `docs/syros-cats-facts.md`).
- **Getting found:** QR codes in cafés and on Kini feeders lead people to the app. The public website, catspotters.com, lives in a separate repo (`fairshake-au/catspotters-website`).

## Capabilities and Constraints

- **Capabilities:** photo spotting with AI matching, a cat catalogue and cat pages, an island map, an offline queue and offline map tiles, points, badges, streaks and a leaderboard, notifications and cat subscriptions, claiming a cat, naming with moderation, rejecting photos with no cat in them, "cat in trouble" welfare reports, report an issue, starter cat facts, a feeding nudge, recovering spots by email code, and the team dashboard with roles and invites.
- **Location privacy:** the public sees cat locations blurred. Exact locations are for the team and trusted roles only. Feeding sites are visible only to Syros Cats unless they make a particular site public (a cat-targeting concern).
- **Welfare expectations:** the app must manage expectations about Syros Cats' capacity. Encourage taking a sick cat straight to a vet (the vet will likely charge). On litter reports, say "contact us first, don't just turn up".
- **Safety:** onboarding includes keep-your-distance health and safety guidance.
- **Terms:**
  - **spotter**, never "snapper";
  - **cat guardian**, never "colony carer";
  - the sterilisation ear mark is a **clipped tip**, usually on the left ear, never "notched" (a notch is a battle scar);
  - a cat not seen for 3 years is presumed deceased;
  - a cat with no visible clip is never counted as evidence that it isn't sterilised.
- **Points:** 15 for confirming a known cat, 25 for a new cat.
- **Names:** cat names a spotter or owner enters are refused if they hold five digits in a row or look like a phone number.
- **Open decisions:** the final store name is to be confirmed with Syros Cats. Donations in the app wait on the payment route, which is to be settled with James (minimising Greek bank fees).

## Brand Commitments

- The name is **Cat Spotters**, shown as Cat Spotters (Syros), with a location subdomain (`syros.…`) that leaves room for other islands. The earlier name "Purropolis" is retired; `replit.md` still describes it and is out of date on this point.
- The voice is plain and warm. Copy uses plain words, not technical ones (see `docs/specs/plain-words-part-2-copy-table.md`).

## Evidence on Hand

- Real cat photos and records are in the live database. Mockups should use real cat photos and names, not stock images.
- The ear-tip example photo: `artifacts/cat-spotter/assets/images/ear-tip-example.jpg`.
- The app icon: `artifacts/cat-spotter/assets/images/icon.png`.
- Screen references from earlier specs: `docs/specs/assets/`.
- Specs and decisions: `docs/PRODUCT-SPEC.md`, `docs/specs/`, `docs/specs/DECISIONS.md`, and the charity-facing proposal `docs/syros-cats-proposal.md`.
- **There are no** testimonials, press, user numbers or partner logos to quote. Don't invent any.

## Product Principles

1. **The cats come first.** Never trade a cat's safety for engagement: protect exact locations and feeding sites, and keep spotters at a safe distance.
2. **Every spot is data the charity can use.** Design the playful parts so they also leave trustworthy records, and let uncertainty show honestly ("can't tell" is a real answer).
3. **Ask Syros Cats; don't guess.** Features that touch their work start from what they actually do and the words they use.
4. **Honest about capacity and signal.** Say what the charity can and can't do, and exactly what works offline.
5. **Open to everyone, on any phone.** Anonymous by default, three languages, usable in the street by a tourist, a local family or a child.

## Accessibility & Inclusion

- The app must be fully usable in Greek, English and French, and layouts must hold up with the longer Greek and French strings.
- Spotting must work outdoors in bright light, one-handed, on low-end phones and weak connections.
- Children and families use the app, so copy stays simple and nothing should frighten them (for example, welfare and death wording).
- A formal standard (such as a WCAG level) has not been set. The team dashboard spec has its own accessibility section (`docs/specs/team-dashboard-redesign.md` §12.5).
