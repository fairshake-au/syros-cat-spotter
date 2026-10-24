# Profile tab redesign: implementation plan

**Spec:** [profile-tab-redesign.md](profile-tab-redesign.md) (its §8 overrides earlier sections). **Ticket:** SYC-628.
**Approval:** Samuel waived approval of this plan on 23 Oct 2026 and asked for the build to follow straight on.
**Branch:** `claude/user-profiles-redesign-2589f2`. One PR, opened as a draft.

## Work packages

### WP1. Pure helpers and their tests
Files: `artifacts/cat-spotter/lib/badgeProgress.ts`, `lib/leaderboardView.ts`, `lib/formatRank.ts`, with tests in `lib/__tests__/`.

```ts
// lib/badgeProgress.ts
export type BadgeStat = 'points' | 'totalSightings' | 'uniqueCatsDiscovered' | 'catsSpotted';
export const BADGE_GOALS: Record<(typeof BADGE_IDS)[number], { stat: BadgeStat; goal: number }>;
export interface BadgeView { id: string; earned: boolean; stat: BadgeStat; goal: number; value: number | null }
// null when profile is undefined or profile.badges is not an array.
// earned = server lists it. value = min(stat, goal), or null when the stat is missing.
export function badgeViews(profile: Partial<Record<BadgeStat, number>> & { badges?: unknown } | undefined): BadgeView[] | null;
export function nextBadge(views: BadgeView[]): BadgeView | null; // first unearned in BADGE_IDS order
export function earnedCount(views: BadgeView[]): number;

// lib/leaderboardView.ts
export interface LeaderEntry { spotterCode: string; username?: string | null; points: number; rank: number }
export interface LeaderRow extends LeaderEntry { isMe: boolean; name: string } // name = username ?? fallback(spotterCode)
export type RankSummary =
  | { kind: 'top'; points: number }
  | { kind: 'behind'; rank: number; points: number; gap: number; name: string }
  | { kind: 'level'; rank: number; points: number; name: string }
  | { kind: 'outside'; points: number }
  | { kind: 'zero' };
export function leaderboardView(
  entries: LeaderEntry[] | undefined,
  me: { spotterCode?: string; points?: number } | undefined,
  fallbackName: (spotterCode: string) => string,
): { rows: LeaderRow[]; myRank: number | null; summary: RankSummary | null };
// rows: points > 0 only, server rank kept. summary null when me/spotterCode/points unknown.
// 'level' when the row ranked directly above has equal points.

// lib/formatRank.ts
export function formatRank(language: Language, n: number): string; // en 1st 2nd 3rd 4th 11th 12th 13th 21st; el "4"; fr "1er", "2e"
```

Tests pin the §3.3 goals table against the server's `badges.ts` thresholds, plus every summary case, ties, missing fields and the ordinals.

### WP2. Words
File: `artifacts/cat-spotter/lib/i18n.ts` only. Add these keys in en, el and fr. French uses *tu*; Greek follows the dictionary's existing register. Placeholders must match across languages (the i18n test checks).

`profileTabMe`, `profileTabSpotters`, `profileSettingsButton`, `profileRankLine` ({rank} on the island), `profileFirstSpotTitle`, `profileFirstSpotBody`, `profileSpotACat`, `profileSafeNudge`, `profileSafeNudgeBody`, `profileSafeNudgeAdd`, `profileStreakBody`, `profileNextBadge`, `profileToGo` ({n} to go), `profileAllBadges`, `profileBadgesEarned` ({earned} of {total} earned), `profileBadgesEarnedList`, `profileBadgesStill`, `profileBadgeProgressPoints` ({value} of {goal} points), `profileBadgesOffline`, `profileBadgesRowLabel` ({earned} of {total} badges earned. See all badges.), `profileRankSummary` (You're {rank} with {points} points), `profileRankPass` ({n} more points to pass {name}.), `profileRankLevel` (You're level with {name} on {points} points.), `profileRankTop` (You're top of the island with {points} points.), `profileRankOutside` (You have {points} points.), `profileRankOutsideBody`, `profileRankZero`, `profileSpottersNote`, `profileSpottersEmpty`, `profileSpottersOffline`, `settingsTitle`, `settingsYou`, `settingsYourData`.

Reused: `statSpotted`, `statFirstFinds`, `statBadges`, `seeAll`, `you`, `profileStreak`, `profileBadgeCount`, `profileRole`, `language`, `appearance`, `appearance*`, `tryAgain`, `back`, `spotter`, `badge_*`, `badge_*_desc`, `profileFirstFinds`, `profileFirstFindsHint`, `statsUnavailable`, `nameNote*`.

### WP3. Screens
Files: `app/(tabs)/profile.tsx` (rewritten), `app/settings.tsx` (new), `app/_layout.tsx` (register `settings`), `components/keepSafe/KeepSafeSettings.tsx` (44px link targets), plus small components under `components/profile/` (`ProfileHeader`, `MeTab`, `BadgesTab`, `SpottersTab`, `SettingsButton`) if the screen file gets long. Built against the WP1 and WP2 interfaces above.

### WP4. Screen tests
`components/__tests__/ProfileScreen.test.tsx` and `components/__tests__/SettingsScreen.test.tsx`, following the mocking pattern of `HomeScreen.spotted.test.tsx`. They cover the screen cases in spec §6, the SYC-594 caption and the Try again button.

### WP5. Checks and PR
- Run the cat-spotter vitest suite and a typecheck, using the esbuild workaround.
- Look at the screen in the Expo web preview at 390px and 1280px, in English and Greek, light and dark, with real data from a local API.
- Open a **draft** PR. An independent adversarial review of the diff runs on a fresh worktree. Fold in its findings, then `gh pr ready`.

## Order and parallel work

WP1 and WP2 touch different files and need nothing from each other, so they run at the same time as subagents. WP3 starts at once against the fixed interfaces. WP4 follows WP3. WP5 is last.

## Model delegation

| Package | Who | Tier | Why this tier | Assurance |
|---|---|---|---|---|
| WP1 helpers + tests | subagent | Sonnet | Small, fully specified pure functions | I re-run the named test files and read the goals table against `badges.ts` |
| WP2 words | subagent | Sonnet | Mechanical key additions; translation drafts that Johnny checks anyway (SYC-346) | The i18n test suite (keys, placeholders, *tu*); I spot-read the Greek and French |
| WP3 screens | me | Opus | Many interacting edge-case rules (offline, unknown, ties, rename handoff) across one screen | WP4 tests, the preview check, adversarial review |
| WP4 screen tests | me | Opus | Written alongside WP3 to pin its behaviour | Each test is shown to fail when its feature is removed (one mutation per key test) |
| Diff review | subagent in its own worktree | Sonnet | Independent adversarial read | Findings checked against the code before being acted on |

Every subagent prompt says: **commit after each item**, and never sub-delegate.

## Done when

- All spec §6 tests pass, alongside the existing suite.
- Screenshots at 390px and 1280px match the canvas design closely.
- PR is green after `gh pr ready` (a skipped draft run doesn't count).
- Follow-ups filed: the server leaderboard tiebreaker, and the new Greek and French lines for Johnny (on SYC-346).
