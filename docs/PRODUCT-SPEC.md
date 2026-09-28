# Cat Spotters (Syros) — Product Specification

**Version:** 1.0 · 1 September 2026
**Status:** Definitive. Incorporates the Syros Cats meeting of 1 September 2026. This document supersedes the proposal as the build reference; the proposal remains the charity-facing description.
**Timeline:** testing 1–14 September · launch October 2026 · MLP complete before the 2027 season (target end of March 2027).

---

## 1. What changed at the 1 September meeting

Decisions now locked:

| Area | Decision |
|---|---|
| **Name** | Purropolis is out (Jacky unconvinced). Working brand is **Cat Spotters**, with a location subdomain (`syros.…`). Samuel is buying the domain now. Final store name to be confirmed with Syros Cats before listing. |
| **Role word** | **Spotter**, not snapper. |
| **Emails** | **The app will collect emails**, optionally, to close the loop with users. When and from whom is an open design question owned by Samuel. This amends the pure-anonymity stance: anonymous use remains the default; email is opt-in and purposeful. |
| **Matching radius** | 500 m confirmed. |
| **Presumed deceased** | 3 years confirmed. |
| **Clipped ears** | Rule confirmed. Usually the **left** ear. The app must show a photo example, and the correct term is a **clipped tip**, never "notched" (a notch is a battle scar, not a sterilisation mark). |
| **Points** | Slightly more for a new cat than a confirmed one (Jacky's preference). 25 new / 15 confirm satisfies this. |
| **Feeding sites** | All mapped, **visible only to Syros Cats by default**; they choose which individual sites are public (targeting concern). |
| **Cat locations** | **Blur for the public generally**; exact locations for the team and trusted roles. |
| **Welfare reports** | Reports go to **admin@syroscats** (Google Workspace) plus an in-app queue. The app must actively manage expectations about Syros Cats' capacity: encourage taking a sick cat **directly to a vet** (noting the vet will likely charge), build in their standard reply (Susan is sending it), and on litter reports say **"contact us first, don't just turn up."** Their goal is fewer cats in their own care and more care in the community — while still capturing the data. |
| **Objectionable content** | Reports also to admin@syroscats. |
| **Colonies** | Fixed names exist: usually the location, plus the name of the person caring for the colony. |
| **Sterilisation records** | They keep them today and will hand them over for import. Workflow to know about: cat guardians are authorised to sterilise and Syros Cats pays; Jo sets up TNR records. |
| **Donation amounts** | Fine as proposed. Payment mechanics: talk to James; objective is minimising Greek bank fees (€4 per transaction) via a monthly batch drop. |
| **Record contents** | Add per-sighting: an optional free-text note ("anything they notice") and a **"do they have food and water?"** question. |
| **Teaching** | Add disease-spread prevention to the sterilisation benefits. New cat fact: grown cats are lactose intolerant. |
| **Onboarding** | Instruction screen 2 must include health-and-safety guidance: don't get too close. |
| **Parked** | Vet direct access (maybe later). Kini QR feeder codes to be subsumed into the app (backlog). Printify merchandise (backlog; they are testing Printify already and are keen). Instagram/Facebook automation (their call, later). |
| **Not discussed** | Teaching content review, volunteer day-in-the-life (note: volunteers won't necessarily have mobile data), merge reversibility, kitten graduation, observation weighting, freshness loop, hosting. |

---

## 2. MVP — what launches in October

The MVP is the **app as already built** (spotting with AI matching, catalogue, map, offline queue and offline tiles, points/badges/streaks/leaderboard, three languages, in-app notifications and cat subscriptions, cat claiming, campaign tab, name moderation, no-cat photo rejection, anonymous device identity) **plus the changes below**. Nothing else goes in before launch.

### 2.1 Brand and copy
- Rename to Cat Spotters (Syros) across app, stores and i18n; fix the French welcome title (SYC-15); correct campaign copy to €50–60 per sterilisation (SYC-14).
- Replace every "notched ear" reference that means sterilisation with "clipped tip"; note the clip is usually on the left ear.

### 2.2 Onboarding and guidance
- Screen 2: keep-your-distance health-and-safety guidance.
- The feeding nudge (short form) in the spot flow, with the winter-dependence explanation and the €1-a-day redirect.
- Starter content set: ~20 authored facts per language, including the lactose fact and an ear-tip explainer **with a photo example**.

### 2.3 Spotting
- Matching restricted to cats within 500 m.
- Points rebalanced: 15 confirm / 25 new cat.
- Post-spot one-tap question: "is the ear tip clipped?" with the photo example; "can't tell" is a first-class answer.
- Per-sighting optional free-text note and a "food and water nearby?" tap question. Notes are visible to the Syros Cats team, not published publicly (moderation load stays near zero).

### 2.4 Cat record (thin slice)
- Life status: street / homed / in care / deceased, with presumed-deceased at 3 years and "not seen since…" display.
- Sterilised status derived simply: **Confirmed** from team entry (or imported Syros Cats records, if an import happens after MVP); **Likely** from clipped-tip sightings; absence of a visible clip is never negative evidence. The full per-attribute confidence engine is MLP.
- ~~Import of Syros Cats' existing sterilisation/TNR records before launch.~~ **Moved after MVP (28 September 2026).** What exists is month-by-month WhatsApp groups with scant detail. The import is optional and happens only if Syros Cats confirm it is worth doing. See `docs/specs/records-import.md`.
- Public cat locations shown approximately; exact locations visible to the team.

### 2.5 Cat in trouble
- Report flow (photo, location, needs-attention/urgent) emailing admin@syroscats and appearing in a team queue; reporter gets an acknowledgement and a status update when the team acts.
- Capacity messaging built into the flow, based on Syros Cats' standard reply: go to a vet directly (the vet will likely charge), contact Syros Cats first rather than turning up. The same messaging appears on litter-related reports.

### 2.6 Team access (minimal)
- One Syros Cats staff sign-in (email based) opening a simple web dashboard: welfare/report queue, feeding-site map (private by default, per-site public toggle), record corrections, colony naming (location + carer).
- "Report an issue" on every cat and photo, routed to admin@syroscats and the queue.
- Full invited-role system (guardians, volunteers, vets) is MLP.

### 2.7 Email capture v1
- Optional email at loop-closing moments (e.g. "follow this cat", trip summary). Exact placement and audience: design question owned by Samuel. GDPR: consent-based, purpose-stated, deletable.

### 2.8 Infrastructure (during testing, before launch)
- Hosting decision resolved: **Replit through launch, photos stay in Postgres** (DECISIONS.md D1). Re-opened 15 November 2026 per SYC-47; SYC-46 (photos out of Postgres) is deferred and re-scoped as a data migration. See `docs/specs/hosting-and-photo-storage.md`.
- September infrastructure is therefore migrations and photo-endpoint hardening, not storage.
- Costs remain pass-through at supplier prices; explore charity startup credits (Samuel).

## 3. MLP — the product it becomes

MLP ("most lovable product") is the version that makes the 2027 season sing, complete by end of March 2027:

1. **Confidence engine in full**: per-attribute authority, prompted-vs-volunteered weighting, the four-level ladder driving every figure.
2. **Roles and invites**: guardians, volunteers and management with real accounts; the confirmation queue; the volunteer colony view (unsterilised cats, usual spots, feeding sites, last seen) — built to work offline, since volunteers won't necessarily have mobile data.
3. **Litters and duplicates**: the litter flow with mother identification and graduation; duplicate detection and human-confirmed, reversible merge.
4. **Visual memory (ML)**: baseline accuracy measured from launch data, then embedding-based retrieval (roughly halves recognition cost), then on-device matching.
5. **Donations in-app**: the ladder, co-funded sterilisations and extended-care sponsorship — once the payment path is settled with James (monthly batch drop, minimal Greek bank fees).
6. **The loop closed by email**: "Agatha, the cat you named in June, was sterilised last week", with the donation ask attached.
7. **Groups and citizen science**: joining codes, group scores and summaries, coverage map — ready for the first summer Boundless cohort.
8. **Teaching in full**: all six strands, delivered as moments; per-language puns and poems (native-authored).
9. **Impact reporting**: colony-level coverage, exportable funder figures with confidence attached.
10. **Kini QR integration**: feeder QR codes resolve into the app's colony pages.

**Beyond MLP (parked):** vet direct access, Printify merchandise, social-media automation, other-island expansion (the Cat Spotters name and subdomain structure keep this open).

## 4. From MVP to MLP

| Phase | When | What ships | Gate |
|---|---|---|---|
| **0 · Testing** | 1–14 Sep | Everything in §2; testers via Syros Cats WhatsApp group | Fixes from testing |
| **1 · Launch hardening** | 15 Sep – early Oct | Store listings under the new name, native-speaker review of Greek/French (SYC-4), QR materials for cafés and Kini | Apple/Google review time |
| **2 · Launch** | October | MVP live; QR rollout with Syros Cats | — |
| **3 · Data spine** | Oct – Dec | Confidence engine, roles/invites, confirmation queue, email loop | Launch data accumulating |
| **4 · Intelligence and income** | Jan – Mar 2027 | ML retrieval, litters and duplicates, donations (post-James), groups, teaching in full, impact reporting | Payment path settled; matching baseline measured |
| **5 · MLP complete** | End March 2027 | Everything above hardened for the season | Pre-season |

Sequencing principles: the data model lands **before** the season so the summer's observations arrive into the right structures; ML waits for real data to measure against; anything needing Syros Cats' time (records handover, Susan's template, teaching review) is requested early and never blocks a phase; donations are gated only on James.

## 5. Open items and owners

| Owner | Item |
|---|---|
| **Samuel** | Buy the Cat Spotters domain (now). Email-collection design (when/whom). Talk to James re payment path. One-pager for the shared song sheet. Explore charity startup credits. Hosting decision. |
| **Syros Cats** | Susan: standard sick-cat reply text. Decide whether importing their WhatsApp records is worth doing (optional, after MVP). List of feeder sites that may be public. Add Samuel to the WhatsApp group. Testers for the two-week window. Final view on the store name. |
| **Jacky** | Baseball caps for Boundless cohorts (her call). Social posting automation (their call). |
| **Build** | Everything in §2 within the testing window. |

## 6. Still open from the design record

Unresolved and carried forward (not blockers): teaching content review by Syros Cats; volunteer day-in-the-life walkthrough; the four spec-level checks (merge reversibility, appearance-based kitten graduation, observation weighting, freshness loop) — all remain as designed in the spec documents until Syros Cats says otherwise.
