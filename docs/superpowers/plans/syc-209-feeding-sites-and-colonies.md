# SYC-209: feeding sites and colonies on the dashboard

**Status: draft for Samuel's approval. Nothing is built yet.** Three questions need Samuel's answer before the build starts (see "Decisions for Samuel"); each has a recommendation.
**Spec:** `docs/specs/feeding-sites-and-colonies.md`, approved by Samuel on 12 October 2026 (PR #103, merged as `50c6262`). This plan builds it as written. Where the spec and the code on `main` disagree, the plan says so in "Where the spec and the code disagree" and does not decide quietly.
**Builds on:** `roles-and-invites.md` (the capability names, approved 12 Oct 2026) and its plan in progress (`claude/syc-53-plan`, draft "SYC-53 plan: roles and invites", read at `e21a16e`); `cat-record-data-spine.md` §6.5, §6.7, §10.1, §10.5; `team-access-and-welfare-queue.md`; `DECISIONS.md` F2, Part 2h, Part 2m. Its format follows `syc-43-part-2-welfare-queue-and-corrections.md`.
**Linear:** SYC-209 (this plan; parent SYC-43). Builds SYC-245, SYC-255 and SYC-263, and the feeding-site half of SYC-256. Touches SYC-53, SYC-22, SYC-51, SYC-54, SYC-67, SYC-208, SYC-257, SYC-283, SYC-4.
**Checked against:** `origin/main` at `586763a` (12 October 2026); the open PRs (#101, #107, #111); the SYC-53 plan branch at `e21a16e`; and Linear SYC-209 with all its comments, plus SYC-43, SYC-53, SYC-22, SYC-51, SYC-67, SYC-245, SYC-255, SYC-256, SYC-257 and SYC-263. Every "exists today" claim names the file it was read in.

---

## In plain English

Syros Cats already know where every feeding spot on the island is, and they already have names for their colonies ("Vaporia — Eleni's"). None of that is in the app. This plan gives the team three things on their dashboard, and later gives visitors one thing in the app.

**Before launch, for the team only:**

1. **Colonies, with the names they already use.** Create a colony, rename it when a guardian changes (the old name still finds it), and say which cats belong to it. Nothing about a colony is ever public.
2. **A private map of feeding sites.** Tap the map to place a site, move it when the pin is wrong, retire it when the spot closes. Every site starts private. Nobody outside the team can see any of it.
3. **A history of every change.** Who added, moved, renamed or retired what, and when. It can never be edited, only blanked if a guardian asks to be forgotten.

**When cat guardians get accounts** (after the roles work): a guardian sees only her own colonies and their sites. She can create a colony, add and take out her own cats, and add, fix and retire her own sites. She can **ask** for a site to be public, but she can never make one public herself. Her phone can keep her sites for 72 hours with no signal.

**After launch, for everyone:** the team can make one site at a time public, after a page that shows exactly what a visitor will see. A visitor then sees a bowl on the app's map at that spot. Tapping it says roughly how many cats live there ("About 10 cats use this spot"), and asks people to give the cats room, not to leave food, and to see how they can help. Making a site private again is one tap.

**How it is built.** Small pull requests, each safe to merge on its own. The order is: the records first, then colonies, then the private map, then guardians, then (after launch) the public half. The map is the riskiest piece. Before any of it is built, the plan tested the one thing the map relies on, in a real browser (see "The tap test").

### What people notice, step by step

| After | What people notice |
|---|---|
| **The docs PR** | Nothing. The specs agree with each other |
| **Slice 0: preconditions** | The team's cat page, welfare queue and alert email stop sending exact positions to Google (Decision 2 says how). Nothing else |
| **Slice 1: the records** | Nothing. The database can now hold everything below |
| **Slice 2: colonies** | The team gets a **Colonies** page: create, rename, guardian's name, notes, history. They can put cats in a colony and take them out. The team's cat page says "Vaporia — Eleni's", not "colony 12" |
| **Slice 3: the private map** | The team gets a **Feeding sites** page: a map of the island, add a site by tapping, move, retire, bring back, history. "Make a feeding site here" on a cat's sighting |
| **Slice 4: guardians** | A guardian with an account sees only her own colonies and sites, in English, Greek or French; she can create a colony, manage her own cats and sites, and is told when a cat of hers moves to another colony. The team sees a "Recent guardian changes" list |
| **Slice 5: forgetting a guardian's name** | Nothing visible. The tool that blanks a guardian's name everywhere is ready for the management button (SYC-208) |
| **Slice 6 (after launch): public sites** | The team can make a site public, one at a time. Visitors see a bowl on the map with a short card, in English, Greek and French |

