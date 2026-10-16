# SYC-415: photo tips, and a face and a body photo in the same spot — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** **Approved by Samuel, 15 October 2026, with Decision P1 = A** (Claude switches the extra photos on after the live checks, with a one-line heads-up first) and the camera/library buttons noted. An independent adversarial review (Sonnet) of the first draft found 3 blockers, 9 major and 3 minor issues, and a sweep by Claude found one more major (the "Report an issue" route). All were fixed before approval. The review and how each finding was handled are in [`syc-415-photo-tips-and-extra-photos-review.md`](./syc-415-photo-tips-and-extra-photos-review.md).
**Ticket:** SYC-415 (Urgent).
**Spec:** `docs/specs/photo-tips-and-extra-photos.md`, approved by Samuel on 15 October 2026 with the cartoons as drawn (`DECISIONS.md` Part 2r).
**Checked against:** `origin/main` at `1eda7d2c` (15 Oct 2026). Code is cited by **file and symbol**, not line number, because main moves daily. Every "the code does X" names the file I read it in.

**Goal:** Spotters see what a good cat photo looks like before they take one, and can add an optional face photo and body photo to a spot. All of a spot's photos go to matching, and the face photo becomes a new cat's main photo.

**Architecture:**
- **The phone app (Expo/React Native):** a tips card and two extra-photo boxes on the Spot screen. Both are built on small, tested pure modules.
- **The API (Express):** the existing upload takes up to two extra photos. It checks every photo first, then saves the sighting and all its photos in one transaction. The new `sighting_photos` table holds each photo with its role (first, face or body). The cover photo is also kept in `sightings.photo_id`, so every older reader still works. All the photos then go to the matcher.
- **The switch:** the boxes only appear once a server setting, `extra_photos_on`, is switched on.

**Tech stack:**
- App: Expo / React Native, react-native-svg 15.12.1, AsyncStorage, vitest with jsdom and `@testing-library/react` (react-native is aliased to react-native-web in tests).
- API: Express, Drizzle on node-postgres (`db.transaction` is supported, and is already used in `routes/sightings.ts` resolve), Postgres (Neon), sharp, OpenAPI + orval codegen, vitest + supertest.

---

## In plain English

The work comes in four parts. Each one can go live on its own without breaking anything:

| Part | What people notice when it goes live |
|---|---|
| **PR 1: photo tips** (app only) | The tips card on a spotter's first camera visit, a "Photo tips" link on the camera screen, and the tips on the "this doesn't look like a cat" screen. This is the quickest win, so it goes first. |
| **PR 2: the server takes extra photos** (server only) | Nothing. The server can take, save and match up to three photos per spot, but no app sends them yet. The match record starts noting "no cat in any photo", and the tips' effect is measured from this point. A spot that's too big now gets a clear "too large" answer, not a server error. |
| **PR 3: extra photos show everywhere** (server, plus the cat page in the app) | Nothing yet. The cat page, the team's cat page, "Report an issue" and "who may hide this photo" learn about extra photos, ready for the first one. |
| **PR 4: the extra-photo boxes** (app) | Nothing until the switch is on. Then the "Add the face" and "Add the whole body" boxes appear on the New spot screen. |
| **Switch on** | Once PRs 2–4 are live and checked on the live site, Claude turns `extra_photos_on` on. Phones pick it up within a few minutes, or the next time the app opens. Turning it off again hides the boxes the same way. Photos already sent stay. |

**One decision for Samuel (Decision P1, below):** whether Claude may switch the boxes on as soon as the live checks pass, or whether Samuel wants to switch them on himself.

**One small change from the spec, for Samuel to note.** The spec says tapping a box offers "Take a photo" or "Choose from your photos". In the build, each empty box shows those two choices as two small buttons inside it ("Camera" and "Photos"), not a pop-up. There are two reasons:
- the app has no three-way pop-up today (its "are you sure?" helper is yes/no only);
- browsers only open the camera or photo picker from a direct tap, which a pop-up would break.

What the spotter can do is the same.

**Cost:** see spec §6.6. Roughly US$12 a month more storage at the season estimate, plus up to two extra images per matching call. Both figures come from `hosting-and-photo-storage.md`. The price per matching call is **unchecked**.

---

## Decision P1 — who switches the extra photos on

| Option | Benefit | Risk |
|---|---|---|
| **A. Claude switches them on after the live checks pass (recommended)** | No wait on Samuel. The checks are a three-photo spot on the live site, the photos showing on the cat page, and a hide test. The switch is quick to undo. | Testers see the boxes the moment it's flipped, before Samuel has tried them himself. |
| B. Samuel switches them on | He tries them on his own phone first. | A delay, and an extra step for Samuel. |

**Recommendation: A.** Samuel gets a one-line heads-up before the switch is flipped, because it changes what testers see.

---

## Global Constraints

- **Words:**
  - House copy rules: say **"spotter"** (never "snapper") and **"cat guardian"** (never "colony carer"). Screen text is plain English.
  - Every new screen string goes into the `en`, `el` and `fr` dictionaries in `artifacts/cat-spotter/lib/i18n.ts`.
  - `t()` takes **one argument** and does no interpolation (`context/LanguageContext.tsx`). Placeholders use single braces and a manual `.replace`, as `photoTooOld` does: `t('x').replace('{when}', when)`.
- **Photos:**
  - Every photo, extras included, goes through `validatePhotoBase64` (`artifacts/api-server/src/lib/imageValidation.ts`). No photo is stored any other way.
  - At most 3 photos per spot (`first`, `face`, `body`), with at most one of each.
  - An extra photo's taken time must be within **2 hours** of the first photo's when both are known.
  - Extra photos are prepared on the phone at **2048px** on the long side, at JPEG quality **0.8**.
  - The whole request must be under **18 MB** of base64. The server limit is 25 MB (`app.ts`, `express.json({ limit: "25mb" })`).
- **Database:**
  - Schema changes go through a migration per `lib/db/migrations/README.md`: generate, add a commented rollback, run `migrate:check`. No `drizzle-kit push`.
  - The `sightings` table is append-only (trigger `sightings_append_only`, migration `0013_deletion_unlinks_people.sql`). `photo_id` is written once, at insert.
- **App tests follow the repo's style** (see `components/__tests__/NewSpotIntro.test.tsx`):
  - `// @vitest-environment jsdom` at the top;
  - `import { fireEvent, render } from '@testing-library/react'`;
  - `fireEvent.click` on elements found by `data-testid` (React Native `testID` becomes `data-testid` on web);
  - `vi.mock` for `@/context/LanguageContext` (`useLanguage: () => ({ t: (k: string) => k })`, as in `BannerStack.test.tsx`), `@expo/vector-icons`, `expo-image`, `@/hooks/useColors` and, for cartoons, `react-native-svg`.
  - Source-reading tests (for `spot.tsx`, `review.tsx`) follow `lib/__tests__/spotRetake.test.ts`.
- **Checks before a PR opens:**
  - UI changes are checked at **390px** and desktop widths, light and dark (Samuel's standing rule).
  - Each PR is reviewed by an independent adversarial critic in **its own worktree** before merge (Samuel's standing rule, LIF-79).
  - Every guard against a **silent** failure gets a **mutation probe**: break it on purpose, see a named test go red, restore it.
- **Commit after each task.** Write a checkpoint note to `docs/superpowers/plans/syc-415-checkpoint.md` (what's done, what's next) at every commit. Never hold work only in memory.

---

## File map

**PR 1 — photo tips (app)**
- Create:
  - `artifacts/cat-spotter/lib/photoTipsSeen.ts`
  - `artifacts/cat-spotter/components/photoTips/cartoons.tsx` — the four cartoons, as react-native-svg components
  - `artifacts/cat-spotter/components/photoTips/PhotoTips.tsx` — the cartoons plus four tips
  - `artifacts/cat-spotter/components/photoTips/PhotoTipsCard.tsx` — a modal holding the tips and "Got it"
- Modify:
  - `artifacts/cat-spotter/app/(tabs)/spot.tsx` — the card on the first camera visit, and the "Photo tips" link on the capture screen
  - `artifacts/cat-spotter/app/review.tsx` — tips in the `if (!data.isCatPhoto)` block
  - `artifacts/cat-spotter/context/DeleteMyDataContext.tsx` — `wipePhone`
  - `artifacts/cat-spotter/lib/i18n.ts`
- Tests:
  - `lib/__tests__/photoTipsSeen.test.ts`
  - `components/__tests__/PhotoTips.test.tsx`
  - `components/__tests__/PhotoTipsCard.test.tsx`
  - `lib/__tests__/photoTipsWiring.test.ts` (source test)

**PR 2 — the server takes extra photos**
- Create:
  - `lib/db/src/schema/sightingPhotos.ts` (exported from `lib/db/src/schema/index.ts`)
  - `artifacts/api-server/src/lib/spotPhotos.ts`
- Modify:
  - `lib/db/src/schema/sightingMatches.ts` — `noCatInAnyPhoto` and `mixedCats`
  - `lib/db/src/appSettings/shape.ts` — key `extra_photos_on`
- Generate: `lib/db/migrations/0028_sighting_photos.sql`, plus `meta/`.
- Modify:
  - `lib/api-spec/openapi.yaml` — `ExtraPhoto`, `CreateSightingRequest.extraPhotos`, the 400/413 bodies, `AppSettings.extraPhotos` (optional). Then run codegen.
  - `artifacts/api-server/src/app.ts` (`jsonErrorHandler`) — an oversize body gets **413**, not 500
  - `artifacts/api-server/src/lib/matching.ts`
  - `artifacts/api-server/src/routes/sightings.ts` — the `router.post("/sightings", …)` handler, `computeMatchCandidates`, `recordMatch` and the dedupe hit
  - `artifacts/api-server/src/lib/appSettings.ts` and `routes/appSettings.ts`
- Tests:
  - `src/lib/spotPhotos.test.ts`
  - `src/lib/matching.test.ts` (new)
  - `src/routes/sightings.extraPhotos.test.ts`
  - `src/app.bodyLimit.test.ts`
  - update the existing `src/routes/appSettings.test.ts` and `lib/db/src/appSettings/dbOps.settings.test.ts`

**PR 3 — extra photos show everywhere**
- Modify:
  - `artifacts/api-server/src/lib/capabilityTargets.ts` (`catsOfPhoto`) — used by the hide/restore routes in `routes/teamPhotos.ts` and the team photo viewer `GET /team/photos/:publicId` in `routes/teamReports.ts`
  - `artifacts/api-server/src/routes/issues.ts` (`photoOfCat`) — a report about an extra photo is accepted
  - `artifacts/api-server/src/routes/cats.ts` (the `GET /cats/:id` sightings query) and `artifacts/api-server/src/lib/catHelpers.ts` (`serialiseSighting`, `PublicSighting`) — `extraPhotos`, **omitted when empty**
  - `lib/api-spec/openapi.yaml` — schema `Sighting` gets optional `extraPhotos`. Then run codegen.
  - `artifacts/api-server/src/lib/teamCatView.ts` — `TeamPhoto.role`, `sightingIds` widened, each sighting's `extraPhotos` and `mixedCats`
  - `artifacts/api-server/src/lib/teamPages/catPages.ts` (`galleryItem`, the sightings list) — role labels and the "May show more than one cat" chip, in the server-rendered team page
- Comment only (behaviour unchanged, citing spec §6.3): `lib/photoVisibility.ts` (the stand-in rule) and `lib/coatReading/due.ts`.
- App: `artifacts/cat-spotter/app/cat/[id].tsx`. Extract its sighting photo block into `components/SightingPhotos.tsx`.
- Tests:
  - `src/lib/capabilityTargets.extraPhotos.test.ts`
  - `src/routes/issues.extraPhotos.test.ts`
  - `src/routes/cats.extraPhotos.test.ts`
  - extend `src/routes/team.photos.test.ts` and the `catPages` tests
  - `components/__tests__/SightingPhotos.test.tsx`

**PR 4 — the extra-photo boxes (app)**
- Create:
  - `artifacts/cat-spotter/lib/extraPhotos.ts` — pure rules
  - `artifacts/cat-spotter/lib/prepareExtraPhoto.ts`
  - `artifacts/cat-spotter/components/ExtraPhotoBoxes.tsx`
- Modify, building and sending:
  - `lib/sightingPayload.ts`
  - `lib/submitFlow.ts` — `rejected` carries the photo's role
  - `lib/photoRejection.ts` — 413 becomes fixable, and a new `rejectedPhotoRole`
- Modify, the offline queue:
  - `lib/offlineQueue.ts` — `PendingSighting.extraPhotos`, `extraNote`, `rejectedRole`, and the `extrasOf()` and `coverOf()` helpers
  - `lib/pendingPhotos.ts` — `replacementPhotoKey` takes a role
  - `context/OfflineContext.tsx` — enqueue, `syncOne`, the keep list, `remove`, `replacePhoto`, and the new `removeExtraPhoto` and `replaceExtraPhoto`
- Modify, other app libraries:
  - `lib/recentPhotos.ts` — `extraFingerprints`
  - `lib/appSettings.ts`, `lib/waitingCard.ts` (`SettingsView`) and `context/AppSettingsContext.tsx`
  - `lib/i18n.ts`
- Modify, screens:
  - `app/(tabs)/spot.tsx`:
    - one `setFirstPhoto` for both `pickPhoto` and `captureLivePhoto`;
    - `retakeFirstPhoto` separate from `clearPhoto`;
    - the boxes;
    - `submit`;
    - the queued "rejected" card.
  - `app/review.tsx` — the three places that pair `photoUri` with `photoBase64` use `coverOf`
- Tests:
  - new: `lib/__tests__/extraPhotos.test.ts`, `lib/__tests__/prepareExtraPhoto.test.ts`, `context/__tests__/OfflineContext.extraPhotos.test.tsx`, `components/__tests__/ExtraPhotoBoxes.test.tsx`
  - extend: `lib/__tests__/sightingPayload.test.ts`, `lib/__tests__/offlineQueue.test.ts`, `lib/__tests__/recentPhotos.test.ts`, `lib/__tests__/appSettings.test.ts`
  - update: `lib/__tests__/photoRejection.test.ts` (413), `lib/__tests__/pendingPhotos*.test.ts` (replacement key), `lib/__tests__/spotRetake.test.ts` (the retake split)

---

## PR 1 — photo tips (app only)

Branch `claude/syc-415-pr1-photo-tips` off fresh `origin/main`, in its own worktree.

### Task 1.1: The "seen" mark

**Files:**
- Create: `artifacts/cat-spotter/lib/photoTipsSeen.ts`
- Test: `artifacts/cat-spotter/lib/__tests__/photoTipsSeen.test.ts`

**Interfaces — Produces:**
- `PHOTO_TIPS_SEEN_KEY = 'cat-spotter/photo-tips-seen-v1'`
- `hasSeenPhotoTips(storage): Promise<boolean>`
- `markPhotoTipsSeen(storage): Promise<void>`
- `clearPhotoTipsSeen(storage): Promise<void>`

Here `storage` is `{ getItem, setItem, removeItem }`, the same shape as `RecentPhotoStorage` in `lib/recentPhotos.ts`.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from 'vitest';
import {
  PHOTO_TIPS_SEEN_KEY,
  clearPhotoTipsSeen,
  hasSeenPhotoTips,
  markPhotoTipsSeen,
} from '../photoTipsSeen';

function memory() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => void m.set(k, v),
    removeItem: async (k: string) => void m.delete(k),
  };
}

describe('photo tips seen mark', () => {
  it('is unseen until marked, then seen, then unseen after clearing', async () => {
    const s = memory();
    expect(await hasSeenPhotoTips(s)).toBe(false);
    await markPhotoTipsSeen(s);
    expect(s.m.get(PHOTO_TIPS_SEEN_KEY)).toBe('1');
    expect(await hasSeenPhotoTips(s)).toBe(true);
    await clearPhotoTipsSeen(s);
    expect(await hasSeenPhotoTips(s)).toBe(false);
  });

  it('treats a storage error as "seen", so a broken store never shows the card on every visit', async () => {
    const broken = {
      getItem: async () => { throw new Error('boom'); },
      setItem: async () => undefined,
      removeItem: async () => undefined,
    };
    expect(await hasSeenPhotoTips(broken)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and see it fail.**

Run: `cd artifacts/cat-spotter && pnpm vitest run lib/__tests__/photoTipsSeen.test.ts`
Expected: FAIL, "Cannot find module '../photoTipsSeen'". If esbuild won't start locally, use the `ESBUILD_BINARY_PATH` workaround (memory note `local-vitest-esbuild`).

- [ ] **Step 3: Implement.**

```ts
/**
 * Whether this phone has seen the photo tips card (SYC-415 spec §3.2).
 * "Delete my data" clears it deliberately, so a fresh start shows it again.
 */
export const PHOTO_TIPS_SEEN_KEY = 'cat-spotter/photo-tips-seen-v1';

interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export async function hasSeenPhotoTips(storage: Storage): Promise<boolean> {
  try {
    return (await storage.getItem(PHOTO_TIPS_SEEN_KEY)) === '1';
  } catch {
    // A store we can't read would otherwise show the card on every visit.
    return true;
  }
}

export async function markPhotoTipsSeen(storage: Storage): Promise<void> {
  try {
    await storage.setItem(PHOTO_TIPS_SEEN_KEY, '1');
  } catch {
    // Not worth an error: the card shows once more next time.
  }
}

export async function clearPhotoTipsSeen(storage: Storage): Promise<void> {
  await storage.removeItem(PHOTO_TIPS_SEEN_KEY);
}
```

- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Commit** — `git commit -m "SYC-415 PR1: photo tips seen mark"`. Update the checkpoint.

### Task 1.2: Cartoons, tips and words

**Files:**
- Create: `components/photoTips/cartoons.tsx` and `components/photoTips/PhotoTips.tsx` (under `artifacts/cat-spotter/`)
- Modify: `lib/i18n.ts` (the `en`, `el` and `fr` dictionaries)
- Test: `components/__tests__/PhotoTips.test.tsx`

**Interfaces — Produces:**
- `GoodPhotoCartoon`, `PoorPhotoCartoon`, `FaceCartoon` and `BodyCartoon`: `(props: { size: number; label: string }) => JSX.Element`. The `label` is the spoken description; callers pass `t('cartoon…Label')`.
- `PhotoTips`: `(props: { compact?: boolean }) => JSX.Element`, with `testID="photo-tips"`.
- i18n keys:
  - `photoTipsTitle`, `photoTipsGotIt`, `photoTipsLink`
  - `photoTipGetClose`, `photoTipGetCloseLine`
  - `photoTipFace`, `photoTipFaceLine`
  - `photoTipBody`, `photoTipBodyLine`
  - `photoTipLight`, `photoTipLightLine`
  - `cartoonGoodLabel`, `cartoonPoorLabel`, `cartoonFaceLabel`, `cartoonBodyLabel`

- [ ] **Step 1: Write the failing test.**

```tsx
// @vitest-environment jsdom
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TRANSLATIONS } from '../../lib/i18n';

vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => new Proxy({}, { get: () => '#000' }) }));
// react-native-svg has never been rendered under vitest here: stand in plain elements
// that keep the accessibility label, which is all these tests read.
vi.mock('react-native-svg', () => {
  const El = ({ children, accessibilityLabel }: any) =>
    React.createElement('svg', { 'aria-label': accessibilityLabel }, children);
  const Leaf = () => null;
  return { __esModule: true, default: El, Svg: El, G: Leaf, Rect: Leaf, Circle: Leaf, Ellipse: Leaf, Path: Leaf, Defs: Leaf, ClipPath: Leaf };
});

import { PhotoTips } from '../photoTips/PhotoTips';

const KEYS = [
  'photoTipsTitle', 'photoTipsGotIt', 'photoTipsLink',
  'photoTipGetClose', 'photoTipGetCloseLine', 'photoTipFace', 'photoTipFaceLine',
  'photoTipBody', 'photoTipBodyLine', 'photoTipLight', 'photoTipLightLine',
  'cartoonGoodLabel', 'cartoonPoorLabel', 'cartoonFaceLabel', 'cartoonBodyLabel',
] as const;

describe('PhotoTips', () => {
  it('has every string in English, Greek and French', () => {
    for (const lang of ['en', 'el', 'fr'] as const) {
      for (const k of KEYS) expect((TRANSLATIONS as any)[lang][k], `${lang}.${k}`).toBeTruthy();
    }
  });

  it('shows four tips and both cartoons with spoken descriptions', () => {
    const { container, getByText } = render(<PhotoTips />);
    for (const k of ['photoTipGetClose', 'photoTipFace', 'photoTipBody', 'photoTipLight']) {
      expect(getByText(k)).toBeTruthy();
    }
    expect(container.querySelector('[aria-label="cartoonGoodLabel"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="cartoonPoorLabel"]')).not.toBeNull();
  });
});
```

If `react-native-web` passes `accessibilityLabel` through as `aria-label` on its own `View`, the mock can be simpler. Keep whichever makes the test pass, without loosening the assertion.

- [ ] **Step 2: Run it and see it fail** (module missing).

- [ ] **Step 3: Implement the cartoons.**
  - Copy each SVG in `docs/specs/assets/photo-tips/` element by element into `react-native-svg` (`Svg`, `G`, `Rect`, `Circle`, `Ellipse`, `Path`, `Defs`, `ClipPath`).
  - Each root is `<Svg width={size} height={size} viewBox="0 0 300 300" accessible accessibilityRole="image" accessibilityLabel={label}>`. The face and body cartoons use `0 0 120 120`.
  - **The poor photo's blur:** don't use an SVG filter, because react-native-svg's filter support is partial. Draw the tiny cat at `opacity={0.55}` instead, so it still reads as a poor photo.
  - Give each cartoon's `ClipPath` id a unique suffix (`React.useId()`), because two copies can be on screen at once.

- [ ] **Step 4: Implement `PhotoTips`.**
  - A `View testID="photo-tips"` holds the two cartoons in a row (`flexDirection: 'row'`, `gap: spacing[3]`, each `flex: 1`, size `compact ? 110 : 150`).
  - Below them come four rows: the tip title in `fonts.bodySemiBold`, with the line under it in `fonts.body`.
  - Colours come from `useColors()`, words from `useLanguage().t`.

- [ ] **Step 5: Add the strings.**
  - **English:** the spec's exact words.
    - `photoTipsTitle: 'How to take a great cat photo'`
    - `photoTipsGotIt: 'Got it'`
    - `photoTipsLink: 'Photo tips'`
    - `photoTipGetClose: 'Get close'`, `photoTipGetCloseLine: 'Fill the frame with the cat.'`
    - `photoTipFace: 'Show the face'`, `photoTipFaceLine: 'Wait for it to look your way.'`
    - `photoTipBody: 'Show the whole body'`, `photoTipBodyLine: 'Nose to tail, so the coat pattern shows.'`
    - `photoTipLight: 'Daylight, and hold still'`, `photoTipLightLine: "Step into the light, and don't zoom if you can help it."`
    - `cartoonGoodLabel: 'A good cat photo: the cat fills the frame, its face and whole body showing, in daylight. Marked with a tick.'`
    - `cartoonPoorLabel: 'A poor cat photo: the cat is tiny, far away, turned away, blurry and in shadow. Marked with a cross.'`
    - `cartoonFaceLabel: "A close-up of a cat's face."`
    - `cartoonBodyLabel: 'A whole cat from the side, nose to tail.'`
  - **Greek and French:** translate faithfully. Note in the commit message that SYC-4's native-speaker check covers them, and add the keys to SYC-346's review pack list.

- [ ] **Step 6: Run it and see it pass**, then run `pnpm -w run typecheck`.
- [ ] **Step 7: Commit** — `git commit -m "SYC-415 PR1: cartoons and photo tips, en/el/fr"`.

### Task 1.3: The card, the link, and the "no cat" screen

**Files:**
- Create: `components/photoTips/PhotoTipsCard.tsx`
- Modify:
  - `app/(tabs)/spot.tsx` — the capture state, where `CaptureControls` is rendered;
  - `app/review.tsx` — the `if (!data.isCatPhoto)` block;
  - `context/DeleteMyDataContext.tsx` — `wipePhone`.
- Test: `components/__tests__/PhotoTipsCard.test.tsx` and `lib/__tests__/photoTipsWiring.test.ts`.

**Interfaces:**
- Consumes: `PhotoTips` (1.2), and `hasSeenPhotoTips`/`markPhotoTipsSeen`/`clearPhotoTipsSeen` (1.1).
- Produces: `PhotoTipsCard: (props: { visible: boolean; onClose: () => void }) => JSX.Element`, with "Got it" carrying `testID="photo-tips-got-it"`.

- [ ] **Step 1: Write the failing tests.**

```tsx
// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ t: (k: string) => k }) }));
vi.mock('@/hooks/useColors', () => ({ useColors: () => new Proxy({}, { get: () => '#000' }) }));
vi.mock('../photoTips/PhotoTips', () => ({ PhotoTips: () => null }));

import { PhotoTipsCard } from '../photoTips/PhotoTipsCard';

describe('PhotoTipsCard', () => {
  it('shows the title and closes on Got it', () => {
    const onClose = vi.fn();
    const { getByText, container } = render(<PhotoTipsCard visible onClose={onClose} />);
    expect(getByText('photoTipsTitle')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-testid="photo-tips-got-it"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('renders nothing when not visible', () => {
    const { queryByText } = render(<PhotoTipsCard visible={false} onClose={() => {}} />);
    expect(queryByText('photoTipsTitle')).toBeNull();
  });
});
```

If react-native-web's `Modal` doesn't render into the jsdom container, render the card's content as a plain absolutely positioned `View` when `visible`, with an `accessibilityViewIsModal` overlay. That avoids `Modal` entirely and works the same on phones.

Then write the source test `lib/__tests__/photoTipsWiring.test.ts`, in the style of `spotRetake.test.ts` (`readFileSync` and a `between()` helper). It asserts:
  - (a) `spot.tsx` imports `PhotoTipsCard` and calls `hasSeenPhotoTips(`;
  - (b) the text of the card's `onClose` handler contains `markPhotoTipsSeen(` and contains **neither** `launchCameraAsync` nor `launchImageLibraryAsync` (browsers only open a picker from a direct tap: see the comment in `captureLivePhoto`);
  - (c) `review.tsx` between `if (!data.isCatPhoto)` and the next `// -----` contains `<PhotoTips`;
  - (d) `DeleteMyDataContext.tsx` contains `clearPhotoTipsSeen(`.

- [ ] **Step 2: Run both and see them fail.**

- [ ] **Step 3: Implement `PhotoTipsCard`.** An overlay over the screen holds a scrolling card (max width 420, `colors.card`, radius 20, padding `spacing[5]`). Inside the card:
  - the title, in `fonts.displayBold`;
  - `<PhotoTips/>`;
  - a primary `Button` with `testID="photo-tips-got-it"`, labelled `t('photoTipsGotIt')`, calling `onClose`.

- [ ] **Step 4: Wire it into `spot.tsx`.**
  - Add `const [tipsOpen, setTipsOpen] = useState(false);`.
  - Add an effect, while there is no `photo` and the tab is focused (use the focus hook the file already imports; if none, `useIsFocused` from `@react-navigation/native`): `hasSeenPhotoTips(AsyncStorage).then((seen) => { if (!seen) setTipsOpen(true); })`.
  - `const closeTips = () => { setTipsOpen(false); void markPhotoTipsSeen(AsyncStorage); };`
  - In the capture state, add a `Pressable` with `testID="photo-tips-link"` and `accessibilityRole="button"`, at least 44×44, in the top-right of the viewfinder overlay and away from the shutter. It holds the `MaterialCommunityIcons` `lightbulb-on-outline` icon (from `@expo/vector-icons`, which has no Feather lightbulb) plus `t('photoTipsLink')`, and does `onPress={() => setTipsOpen(true)}`.
  - Render `<PhotoTipsCard visible={tipsOpen} onClose={closeTips} />`.

- [ ] **Step 5: Wire it into `review.tsx`.** In the not-a-cat block, put `<PhotoTips compact />` between the `notACatMsg` text and "Try again", and turn the block's `View` into a `ScrollView` (`contentContainerStyle` takes over the centring styles).

- [ ] **Step 6: Wire it into `DeleteMyDataContext.tsx`.** In `wipePhone`, after `clearWaitingRecords(AsyncStorage)`, add `await clearPhotoTipsSeen(AsyncStorage); // SYC-415: deliberately cleared, so a fresh start sees the photo tips again.`

- [ ] **Step 7: Run the tests and see them pass**, then the whole app suite (`pnpm vitest run`) and the typecheck.

- [ ] **Step 8: Check it in the browser.**
  - Start the local web preview (`launch.json` lives in the primary checkout; see memory note `local-preview-with-planted-link`).
  - At 390×844 and at desktop width, in light and dark: the card shows on the first camera visit; "Got it" closes it and the camera stays; a reload doesn't show it again; "Photo tips" reopens it.
  - Clear site storage and see it shows again.
  - Make a not-a-cat result show the tips: plant a pending sighting and open `/review` with `isCatPhoto: false` params.
  - Take screenshots for the PR.

- [ ] **Step 9: Commit and open PR 1.** Run the adversarial review in its own worktree (Sonnet), apply its findings, CI green. The merge waits for Samuel (no auto-merge on this repo: memory note `no-auto-merge-on-free-plan`). After merge, publish per the `replit-publish` skill and confirm the live build.

---

## PR 2 — the server takes extra photos

Branch `claude/syc-415-pr2-server-extra-photos` off fresh `origin/main`.

### Task 2.1: The `sighting_photos` table, the match-record columns, and the switch

**Files:**
- Create: `lib/db/src/schema/sightingPhotos.ts`
- Modify:
  - `lib/db/src/schema/index.ts` (export);
  - `lib/db/src/schema/sightingMatches.ts`;
  - `lib/db/src/appSettings/shape.ts`.
- Generate: `lib/db/migrations/0028_sighting_photos.sql`, plus `meta/`. If another branch has taken 0028 by then, generate on top of current history, per the README.
- Test: `lib/db/src/appSettings/dbOps.settings.test.ts` (extend). `pnpm --filter @workspace/db test` proves the rollback.

**Interfaces — Produces:**
- `sightingPhotosTable` with columns `sightingId`, `photoId`, `role` and `position`.
- `SIGHTING_PHOTO_ROLES = ['first','face','body'] as const`
- `type SightingPhotoRole`
- `sightingMatchesTable.noCatInAnyPhoto` and `.mixedCats` (both `boolean`, nullable)
- setting key `"extra_photos_on"` (boolean)

- [ ] **Step 1: Write the schema.**

```ts
// lib/db/src/schema/sightingPhotos.ts
import { sql } from "drizzle-orm";
import { pgTable, integer, text, smallint, primaryKey, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sightingsTable } from "./sightings";
import { photosTable } from "./photos";

export const SIGHTING_PHOTO_ROLES = ["first", "face", "body"] as const;
export type SightingPhotoRole = (typeof SIGHTING_PHOTO_ROLES)[number];

/**
 * Every photo of a spot, in the order taken (SYC-415 spec §6.2): its first
 * photo, and optionally a face and a body photo. The cover photo (spec §5.1)
 * is also `sightings.photo_id`, which older readers keep using. No spotter
 * column, so deleting a person needs nothing here (cat-record-data-spine.md
 * §8.5). Both links cascade: sightings can't be deleted in production (the
 * append-only trigger) but test clean-up deletes them, and a photo deleted
 * for good (hosting-and-photo-storage.md §6.5) takes its row with it.
 */
export const sightingPhotosTable = pgTable(
  "sighting_photos",
  {
    sightingId: integer("sighting_id")
      .notNull()
      .references(() => sightingsTable.id, { onDelete: "cascade" }),
    photoId: integer("photo_id")
      .notNull()
      .references(() => photosTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    position: smallint("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sightingId, t.position] }),
    uniqueIndex("sighting_photos_role_uq").on(t.sightingId, t.role),
    uniqueIndex("sighting_photos_photo_uq").on(t.photoId),
    check("sighting_photos_role_ck", sql`${t.role} IN ('first','face','body')`),
    check("sighting_photos_position_ck", sql`${t.position} BETWEEN 1 AND 3`),
  ],
);
```

  In `sightingMatches.ts`, add:
  ```ts
  /** SYC-415 §6.2/§8: the matcher said no photo in the spot shows a cat. Null before SYC-415 or when the matcher failed. */
  noCatInAnyPhoto: boolean("no_cat_in_any_photo"),
  /** SYC-415 §4.5: the matcher said the spot's photos look like more than one cat. */
  mixedCats: boolean("mixed_cats"),
  ```

  In `shape.ts`, add `"extra_photos_on"` to `SETTING_KEYS`, and in `settingShapeProblem` add `case "extra_photos_on": return typeof value === "boolean" ? null : "must be true or false";`.

- [ ] **Step 2: Generate the migration.** First check on the development branch that no two sightings share a photo: `SELECT photo_id, count(*) FROM sightings GROUP BY 1 HAVING count(*) > 1`. Note the result in the PR. If there are any, the backfill's `ON CONFLICT ("photo_id") DO NOTHING` keeps the first. Run `pnpm --filter @workspace/db run generate --name sighting_photos`, then append:

```sql
--> statement-breakpoint
-- SYC-415: every existing sighting has exactly one photo, its first. One row
-- each, so sighting_photos lists every sighting's photos. A sighting whose
-- photo row is gone (sightings.photo_id has no foreign key) gets no row.
INSERT INTO "sighting_photos" ("sighting_id", "photo_id", "role", "position")
SELECT s."id", s."photo_id", 'first', 1
  FROM "sightings" s
  JOIN "photos" p ON p."id" = s."photo_id"
ORDER BY s."id"
ON CONFLICT ("photo_id") DO NOTHING;
--> statement-breakpoint
-- The extra-photo boxes stay hidden until switched on (plan Decision P1).
INSERT INTO "app_settings" ("key", "value") VALUES ('extra_photos_on', 'false'::jsonb)
ON CONFLICT ("key") DO NOTHING;
-- Roll the app back first: new code reads sighting_photos on every upload,
-- repeat and cat page. Rolling back forgets which photo was face or body;
-- cover photos stay in sightings.photo_id and every photo stays in photos.
-- rollback-begin
-- DELETE FROM "app_settings" WHERE "key" = 'extra_photos_on';
-- ALTER TABLE "sighting_matches" DROP COLUMN "mixed_cats";
-- ALTER TABLE "sighting_matches" DROP COLUMN "no_cat_in_any_photo";
-- DROP TABLE "sighting_photos";
-- rollback-end
```

`0027_match_wait_settings_and_taps.sql` already has a data `INSERT … ON CONFLICT`, so `migrate:check` accepts data statements.

- [ ] **Step 3: Apply and check.** Run `pnpm --filter @workspace/db run migrate`, then `pnpm --filter @workspace/db test` (it proves the rollback), then `pnpm --filter @workspace/db run migrate:check`. Expected: all pass. Extend `dbOps.settings.test.ts` with `extra_photos_on` accepting `true` and refusing `"yes"`.
- [ ] **Step 4: Commit** — `git commit -m "SYC-415 PR2: sighting_photos table, match-record flags, extra_photos_on switch"`.

### Task 2.2: The API contract, and a 413 for an oversize spot

**Files:**
- Modify: `lib/api-spec/openapi.yaml`, then run `pnpm --filter @workspace/api-spec run codegen`
- Modify: `artifacts/api-server/src/app.ts` (`jsonErrorHandler`)
- Test: `artifacts/api-server/src/app.bodyLimit.test.ts`

- [ ] **Step 1: Edit the contract.**

```yaml
    ExtraPhoto:
      type: object
      properties:
        role: { type: string, enum: [face, body] }
        photoBase64:
          type: string
          description: JPEG or PNG as base64, prepared on the phone to at most 2048px.
      required: [role, photoBase64]
    CreateSightingRequest:
      # ...existing properties unchanged, plus:
        extraPhotos:
          type: array
          maxItems: 2
          items: { $ref: "#/components/schemas/ExtraPhoto" }
          description: >-
            Up to two extra photos of the same cat from the same visit
            (SYC-415). At most one face and one body. The first photo stays in
            photoBase64.
```

  Also:
  - Under `POST /sightings`, give `"400"` a body schema `{ error: string, photo?: "first" | "face" | "body" }`.
  - Add `"413"`: "The spot is too large to send. Remove a photo and try again."
  - In the `AppSettings` schema, add **optional** `extraPhotos: { type: boolean }`. Existing app code builds `AppSettings` objects without it.

- [ ] **Step 2: Write the failing 413 test.**

```ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "./app";

describe("an oversize request body", () => {
  it("gets 413 with a JSON reason, not a 500", async () => {
    const big = "a".repeat(26 * 1024 * 1024);
    const res = await request(app)
      .post("/api/sightings")
      .set("Content-Type", "application/json")
      .send(`{"deviceId":"x","photoBase64":"${big}","lat":37.4,"lng":24.9}`);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "This spot is too large to send. Remove a photo and try again." });
  });
});
```

  Use the supertest address helper the other api-server tests use, if they need one (`test/supertestAddress`). Memory note `no-high-volume-port-experiments` applies: this is one request.

- [ ] **Step 3: Run it and see it fail** (500 today: `jsonErrorHandler` only handles `ZodError`).
- [ ] **Step 4: Implement.** At the top of `jsonErrorHandler`, add:

```ts
  // SYC-415: body-parser's own "too large" error. A 500 would make the phone
  // retry a spot that can never fit; 413 tells it to remove a photo.
  if (typeof err === "object" && err !== null && ("type" in err && err.type === "entity.too.large")) {
    res.setHeader("Cache-Control", "no-store");
    res.status(413).json({ error: "This spot is too large to send. Remove a photo and try again." });
    return;
  }
```

- [ ] **Step 5: Run it and see it pass.** Then regenerate the API code and run `pnpm -w run typecheck`. Expected: it passes, and `CreateSightingBody` now accepts `extraPhotos`.
- [ ] **Step 6: Mutation probe.** Remove the new branch, see the test go red, restore it.
- [ ] **Step 7: Commit** — `git commit -m "SYC-415 PR2: API contract for extra photos; oversize body is 413 (probe)"`.

### Task 2.3: Cover rule, validation, and the one-transaction save

**Files:**
- Create: `artifacts/api-server/src/lib/spotPhotos.ts`
- Test: `artifacts/api-server/src/lib/spotPhotos.test.ts`

**Interfaces — Produces:**

```ts
export type SpotPhotoInput = { role: SightingPhotoRole; photoBase64: string };
export type ValidatedSpotPhoto = { role: SightingPhotoRole; buffer: Buffer; mime: string };
export function coverRole(roles: readonly SightingPhotoRole[]): SightingPhotoRole; // 'face' if present, else 'first'
export function spotPhotoList(body: { photoBase64: string; extraPhotos?: { role: "face" | "body"; photoBase64: string }[] }):
  { ok: true; photos: SpotPhotoInput[] } | { ok: false; error: string };
export async function validateSpotPhotos(photos: SpotPhotoInput[]):
  Promise<{ ok: true; photos: ValidatedSpotPhoto[] } | { ok: false; error: string; photo: SightingPhotoRole }>;
export async function saveSpotWithPhotos(input: {
  deviceId: string; lat: number; lng: number; capturedAt: Date; photos: ValidatedSpotPhoto[];
}): Promise<{ sightingId: number; photos: { role: SightingPhotoRole; photoId: number; base64: string; mime: string }[] }>;
```

- [ ] **Step 1: Write the failing tests.**

```ts
import { describe, expect, it } from "vitest";
import { coverRole, spotPhotoList } from "./spotPhotos";

describe("coverRole (spec §5.1)", () => {
  it("is the face photo when there is one", () => {
    expect(coverRole(["first", "face", "body"])).toBe("face");
    expect(coverRole(["first", "face"])).toBe("face");
  });
  it("is the first photo otherwise", () => {
    expect(coverRole(["first"])).toBe("first");
    expect(coverRole(["first", "body"])).toBe("first");
  });
});

describe("spotPhotoList", () => {
  it("puts the first photo first, then extras in the order sent", () => {
    const r = spotPhotoList({ photoBase64: "A", extraPhotos: [{ role: "body", photoBase64: "B" }, { role: "face", photoBase64: "C" }] });
    expect(r).toEqual({ ok: true, photos: [
      { role: "first", photoBase64: "A" }, { role: "body", photoBase64: "B" }, { role: "face", photoBase64: "C" },
    ] });
  });
  it("refuses two photos with the same role", () => {
    expect(spotPhotoList({ photoBase64: "A", extraPhotos: [{ role: "face", photoBase64: "B" }, { role: "face", photoBase64: "C" }] }))
      .toEqual({ ok: false, error: "Only one face photo and one body photo per spot." });
  });
});
```

  Then write the database tests, set up as in `routes/sightings.upload.test.ts` (real test database, device prefix, cleanup with `deleteTestSightings`):
  1. **Three photos.** `saveSpotWithPhotos` with three validated photos (made with `sharp`, different colours) gives one `sightings` row whose `photo_id` is the **face** photo's id, and three `sighting_photos` rows in positions 1, 2 and 3 with roles as sent.
  2. **All or nothing.** If the third photo's insert fails, nothing is saved. Pass `{ role: "bogus" as never, … }`, which breaks the role check. Assert there are no new `sightings`, `sighting_photos` or `photos` rows for that device: count `photos` before and after.
  3. **Cascade.** Deleting a `photos` row removes its `sighting_photos` row.
  4. **The same photo twice is refused.** `validateSpotPhotos` with two **identical images sent as different base64** (the same JPEG re-encoded once by sharp at the same quality, so the decoded pixels match after the server's own normalisation) returns `{ ok: false, error: "The same photo can only be used once in a spot.", photo: "face" }`. The duplicate check compares the **normalised output buffers** (sha256), not the raw base64. Raw strings would never match, because the phone re-encodes extras.

- [ ] **Step 2: Run them and see them fail.** `cd artifacts/api-server && pnpm vitest run src/lib/spotPhotos.test.ts`.

- [ ] **Step 3: Implement.**

```ts
import { createHash } from "node:crypto";
import { db, photosTable, sightingsTable, sightingPhotosTable, type SightingPhotoRole } from "@workspace/db";
import { validatePhotoBase64 } from "./imageValidation";

export function coverRole(roles: readonly SightingPhotoRole[]): SightingPhotoRole {
  return roles.includes("face") ? "face" : "first";
}

export function spotPhotoList(body: {
  photoBase64: string;
  extraPhotos?: { role: "face" | "body"; photoBase64: string }[];
}) {
  const extras = body.extraPhotos ?? [];
  const roles = extras.map((e) => e.role);
  if (new Set(roles).size !== roles.length) {
    return { ok: false as const, error: "Only one face photo and one body photo per spot." };
  }
  return {
    ok: true as const,
    photos: [{ role: "first" as const, photoBase64: body.photoBase64 }, ...extras],
  };
}

export async function validateSpotPhotos(photos: { role: SightingPhotoRole; photoBase64: string }[]) {
  const out: { role: SightingPhotoRole; buffer: Buffer; mime: string }[] = [];
  const seen = new Set<string>();
  // One at a time: sharp and the HEIC fallback are memory-hungry.
  for (const p of photos) {
    const v = await validatePhotoBase64(p.photoBase64);
    if ("error" in v) return { ok: false as const, error: v.error, photo: p.role };
    const digest = createHash("sha256").update(v.buffer).digest("hex");
    if (seen.has(digest)) {
      return { ok: false as const, error: "The same photo can only be used once in a spot.", photo: p.role };
    }
    seen.add(digest);
    out.push({ role: p.role, buffer: v.buffer, mime: v.mime });
  }
  return { ok: true as const, photos: out };
}

export async function saveSpotWithPhotos(input: {
  deviceId: string; lat: number; lng: number; capturedAt: Date;
  photos: { role: SightingPhotoRole; buffer: Buffer; mime: string }[];
}) {
  return db.transaction(async (tx) => {
    const saved: { role: SightingPhotoRole; photoId: number; base64: string; mime: string }[] = [];
    for (const p of input.photos) {
      const base64 = p.buffer.toString("base64");
      const [row] = await tx.insert(photosTable).values({ data: base64, mime: p.mime }).returning({ id: photosTable.id });
      saved.push({ role: p.role, photoId: row!.id, base64, mime: p.mime });
    }
    const cover = saved.find((s) => s.role === coverRole(saved.map((x) => x.role)))!;
    const [sighting] = await tx
      .insert(sightingsTable)
      .values({
        deviceId: input.deviceId, photoId: cover.photoId, lat: input.lat, lng: input.lng,
        status: "pending", createdAt: input.capturedAt,
      })
      .returning({ id: sightingsTable.id });
    await tx.insert(sightingPhotosTable).values(
      saved.map((s, i) => ({ sightingId: sighting!.id, photoId: s.photoId, role: s.role, position: i + 1 })),
    );
    return { sightingId: sighting!.id, photos: saved };
  });
}
```

  The duplicate check in test 4 relies on the server's normalisation (rotate, resize to 2048, mozjpeg q80) producing identical output for identical pixels. If test 4 can't be made deterministic with sharp, keep the check but rewrite test 4 to send the **same** base64 twice, and say so in the commit message. The phone also refuses duplicates by fingerprint (Task 4.1), so this is a second line of defence.

- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Mutation probes.**
  - Make `coverRole` always return `"first"`, and see tests "face when there is one" **and** database test 1 go red.
  - Swap `db.transaction(async (tx) =>` for a version that uses `db` directly, and see database test 2 go red.

  Restore both, and name the probes in the commit.
- [ ] **Step 6: Commit** — `git commit -m "SYC-415 PR2: cover rule, photo validation and one-transaction save (probes: cover, txn)"`.

### Task 2.4: The matcher sees all the spot's photos

**Files:**
- Modify: `artifacts/api-server/src/lib/matching.ts`
- Test: `artifacts/api-server/src/lib/matching.test.ts` (new). Mock `@workspace/integrations-openai-ai-server` with `vi.mock(…, () => ({ openai: { chat: { completions: { create: vi.fn() } } } }))`.

**Interfaces — Produces:**

```ts
export interface NewPhotoInput { role: "first" | "face" | "body"; photoBase64: string; mime: string }
export interface MatchOutput {
  isCatPhoto: boolean;   // = "any photo shows a cat"
  mixedCats?: boolean;   // optional: every existing test mock returns { isCatPhoto, matches } only
  matches: { catId: number; confidence: number; reasoning: string }[];
}
export async function matchCatPhoto(newPhotos: NewPhotoInput[] | string, candidates: CandidateInput[]): Promise<MatchOutput>;
```

A plain `string` keeps working as one `first` photo, so existing callers and mocks don't break.

- [ ] **Step 1: Write the failing tests.**
  - (a) **Photo order.** With 3 new photos and 2 candidates, `create` is called with `content` holding **5** images: the 3 new photos first, in order, then the candidates. The prompt text contains `image 1 = first photo`, `image 2 = face close-up`, `image 3 = whole body`, and `image 4 = cat id`.
  - (b) **New answer shape.** The reply `{"anyCat": true, "mixedCats": true, "matches": []}` gives `isCatPhoto: true, mixedCats: true`.
  - (c) **Old answer shape.** The reply `{"isCatPhoto": false, "matches": []}` gives `isCatPhoto: false, mixedCats: false`.
  - (d) **One photo.** Passing a string sends one new image, and the reply's `mixedCats: true` is ignored (`false`).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Normalise the input:

```ts
const photos: NewPhotoInput[] =
  typeof newPhotos === "string" ? [{ role: "first", photoBase64: newPhotos, mime: "image/jpeg" }] : newPhotos;
const n = photos.length;
const roleName = (r: NewPhotoInput["role"]) => (r === "first" ? "first photo" : r === "face" ? "face close-up" : "whole body");
const newDesc =
  n === 1
    ? `The FIRST image is a newly submitted photo.`
    : `The FIRST ${n} images are newly submitted photos that should all show the SAME cat from different angles (${photos
        .map((p, i) => `image ${i + 1} = ${roleName(p.role)}`)
        .join(", ")}).`;
const known = candidates.map((c, i) => `image ${i + n + 1} = cat id ${c.catId} ("${c.name}")`).join(", ");
const text =
  `You are an expert at identifying individual street cats by their coat pattern, colors, markings, face shape, eye color and other distinctive physical features.\n\n` +
  `${newDesc} The following ${candidates.length} images are known cats, in order: ${known}.\n\n` +
  `Tasks:\n1. Determine if ANY of the new photo${n > 1 ? "s" : ""} contains a cat.\n` +
  (n > 1 ? `2. Determine if the new photos appear to show MORE THAN ONE different cat.\n` : ``) +
  `${n > 1 ? 3 : 2}. For each known cat, assess the likelihood (0.0-1.0) that it is the SAME individual cat as in the new photo${n > 1 ? "s" : ""}. Use every new photo together. Judge only by physical appearance; lighting, pose and background differ between photos.\n\n` +
  `Respond with ONLY valid JSON, no markdown: {"anyCat": boolean, "mixedCats": boolean, "matches": [{"catId": number, "confidence": number, "reasoning": "one short sentence"}]}. Include every known cat in "matches". If there are no known cats, return an empty matches array.`;
```

  The images are `...photos.map((p) => ({ type: "image_url", image_url: { url: \`data:${p.mime};base64,${p.photoBase64}\` } }))`, followed by the candidates as before. Parse the reply as:
  - `isCatPhoto: typeof parsed.anyCat === "boolean" ? parsed.anyCat : !!parsed.isCatPhoto`
  - `mixedCats: n > 1 && parsed.mixedCats === true`

- [ ] **Step 4: Run them and see them pass.** Commit: `git commit -m "SYC-415 PR2: matcher compares all of a spot's photos, reports any-cat and mixed-cats"`.

### Task 2.5: The upload route

**Files:**
- Modify: `artifacts/api-server/src/routes/sightings.ts`:
  - the `router.post("/sightings", aiLimiter, …)` handler, where the single-photo `validatePhotoBase64` → insert photo → insert sighting → `computeMatchCandidates` block is replaced;
  - `computeMatchCandidates`;
  - the dedupe-hit block;
  - `recordMatch`.
- Test: `artifacts/api-server/src/routes/sightings.extraPhotos.test.ts` (new). The existing `sightings.upload`, `.dedupe`, `.matchRecord`, `.aiLimiter`, `.upload.auth` and `.resolve` suites must stay green **unchanged**.

**Interfaces:**
- Consumes: 2.3 and 2.4.
- Produces:
  - `computeMatchCandidates(req, sightingId, photos: NewPhotoInput[], lat, lng)`;
  - the `recordMatch` set, which gains `noCatInAnyPhoto: boolean | null` and `mixedCats: boolean | null`.

- [ ] **Step 1: Write the failing route tests.** Mock `../lib/matching` with a `vi.fn` the way `sightings.upload.test.ts` does, so each test sets its answer. Use real small JPEGs from `sharp`, three different colours. Set up the device secret the way `sightings.upload.test.ts` does.
  1. **Three photos are saved together.** A POST with `photoBase64` plus `extraPhotos` (face, body) returns 201. There's one sighting whose `photo_id` is the face photo, and three `sighting_photos` rows (positions 1–3, roles first/face/body). The matcher mock was called once with **3** new photos, in that order.
  2. **One photo means no change.** Without `extraPhotos`, one `sighting_photos` row is saved (`first`), `photo_id` is that photo, and the matcher was called with one photo.
  3. **A bad extra saves nothing.** With the face extra set to `"not-base64!!"`, the response is 400 with `{ error: "photoBase64 is not valid base64", photo: "face" }`. There are no new rows in `sightings`, `photos` or `sighting_photos` for that device.
  4. **Duplicate roles are refused.** The response is 400, and nothing is saved.
  5. **A repeat matches all photos.** Send case 1 twice with the same `capturedAt`. The second gets the same `sightingId`, with no new rows, and the matcher's second call has **3** new photos in position order.
  6. **A repeat of an older one-photo sighting.** Insert a `photos` row and a `sightings` row directly (no `sighting_photos` row, as a sighting from before this change has, or one made during the deploy window). Then POST a repeat with the same device and `capturedAt`. The matcher is called with **1** photo (from `sightings.photo_id`), and `matcher_failed` is **false**.
  7. **The match record.**
     - If the matcher answers `isCatPhoto: false`, then `sighting_matches.no_cat_in_any_photo = true` and the response has `isCatPhoto: false`.
     - If it answers `mixedCats: true`, then `mixed_cats = true`.
     - If it answers the old shape (`{isCatPhoto: true, matches: []}`), then `mixed_cats = false`, not null.
     - If the matcher throws, both are `null`, `matcher_failed = true`, every photo is still saved, and the response is 201.
  8. **It counts once.** A three-photo POST raises the device's match-limit count by exactly 1 (read it as `sightings.aiLimiter.test.ts` does).
  9. **No hidden location data.** Every stored photo of case 1 has no `exif` in `sharp(buffer).metadata()`. Make the test JPEGs **with** EXIF that includes GPS (`sharp(...).withExif({ IFD3: { GPSLatitude: ... } })`, or copy whatever EXIF fixture `imageValidation`'s tests already use).

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement the POST path.** Replace the single-photo block with:

```ts
  const list = spotPhotoList(body);
  if (!list.ok) {
    res.status(400).json({ error: list.error });
    return;
  }
  const validated = await validateSpotPhotos(list.photos);
  if (!validated.ok) {
    res.status(400).json({ error: validated.error, photo: validated.photo });
    return;
  }
  const saved = await saveSpotWithPhotos({
    deviceId: body.deviceId, lat: body.lat, lng: body.lng, capturedAt, photos: validated.photos,
  });
  const { isCatPhoto, candidates } = await computeMatchCandidates(
    req, saved.sightingId,
    saved.photos.map((p) => ({ role: p.role, photoBase64: p.base64, mime: p.mime })),
    body.lat, body.lng,
  );
  res.status(201).json({ sightingId: saved.sightingId, isCatPhoto, candidates });
```

  The dedupe lookup stays where it is, **before** validation. A retry of a spot that's already saved needs no re-validation.

- [ ] **Step 4: Implement the dedupe hit.** Load the spot's photos in position order, and **fall back to `sightings.photo_id`** when there are no rows:

```ts
    const rows = await db
      .select({ role: sightingPhotosTable.role, data: photosTable.data, mime: photosTable.mime })
      .from(sightingPhotosTable)
      .innerJoin(photosTable, eq(photosTable.id, sightingPhotosTable.photoId))
      .where(eq(sightingPhotosTable.sightingId, existing.id))
      .orderBy(asc(sightingPhotosTable.position));
    let photos: NewPhotoInput[] = rows.map((r) => ({
      role: r.role as SightingPhotoRole, photoBase64: r.data, mime: r.mime,
    }));
    if (photos.length === 0) {
      // A sighting from before SYC-415, or one an older server made during a
      // deploy: its one photo is sightings.photo_id.
      const [only] = await db.select().from(photosTable).where(eq(photosTable.id, existing.photoId));
      if (only) photos = [{ role: "first", photoBase64: only.data, mime: only.mime }];
    }
```

  Keep the existing branch for when the photo is truly gone (`photos.length === 0` after the fallback). It returns no candidates, and `recordMatch` stores `matcherFailed: true`.

- [ ] **Step 5: Implement `computeMatchCandidates` and `recordMatch`.**
  - Change the third parameter to `photos: NewPhotoInput[]`, and call `matchCatPhoto(photos, candidateInputs)`.
  - Take `const mixedCats = result.mixedCats === true` inside the `try`.
  - Pass `noCatInAnyPhoto: matcherFailed ? null : !isCatPhoto` and `mixedCats: matcherFailed ? null : mixedCats` to `recordMatch`.
  - Widen `recordMatch`'s `sets` type.
  - The dedupe "no photo at all" call passes both fields as `null`.

- [ ] **Step 6: Run everything.** Run the new file, then the whole api-server suite: `cd artifacts/api-server && pnpm vitest run`. Expected: all green, including the untouched suites.
- [ ] **Step 7: Mutation probes.**
  - Make the dedupe hit use `photos.slice(0, 1)`, and see case 5 go red.
  - Remove the `photo_id` fallback, and see case 6 go red.
  - Use `result.mixedCats` without `=== true`, and see case 7's old-shape check go red.

  Restore each one.
- [ ] **Step 8: Commit** — `git commit -m "SYC-415 PR2: upload takes up to two extra photos, saved together, all matched (probes: dedupe, fallback, mixedCats)"`.

### Task 2.6: The switch in `/app-settings`

**Files:**
- Modify: `artifacts/api-server/src/lib/appSettings.ts` (`AppSettings.extraPhotosOn`, read with `read<boolean>("extra_photos_on", false, …)`) and `routes/appSettings.ts` (`GET /app-settings` adds `extraPhotos: settings.extraPhotosOn`)
- Test: update the existing `routes/appSettings.test.ts`. Change its exact-body `toEqual` to include `extraPhotos: false`, and add the cases below.

- [ ] **Step 1: Write the failing tests.**
  - No row gives `extraPhotos: false`.
  - A row `extra_photos_on = true` gives `true`, after `_resetAppSettingsCacheForTests()`.
  - A wrong shape (`"yes"`) gives `false`.
  - **The upload accepts `extraPhotos` whatever the switch says.** POST a two-photo spot with the switch off, and get 201 with two `sighting_photos` rows. The switch only hides the boxes. A phone that queued extras while it was on must not lose them after it goes off.
- [ ] **Step 2: Run them, implement, run them again.** Commit: `git commit -m "SYC-415 PR2: extra_photos_on switch in /app-settings"`.
- [ ] **Step 3: Open PR 2.**
  - Run the adversarial review in its own worktree (Opus: see the delegation table), apply its findings, CI green. The merge waits for Samuel.
  - After merge, publish per `replit-publish`, and confirm `/api/healthz` shows the new commit (memory note `confirm-live-build-before-smoke`).
  - Probe `GET /api/app-settings`: `extraPhotos: false`.
  - Probe a 26 MB POST: **413**.
  - Send one ordinary one-photo spot on the test site, after a one-line heads-up to Samuel that it creates a test sighting.

---

## PR 3 — extra photos show everywhere

Branch `claude/syc-415-pr3-extra-photo-readers` off fresh `origin/main`, after PR 2 is merged.

### Task 3.1: Hide, restore, view and report reach extra photos

**Files:**
- Modify:
  - `artifacts/api-server/src/lib/capabilityTargets.ts` (`catsOfPhoto`);
  - `artifacts/api-server/src/routes/issues.ts` (`photoOfCat`).
- Test:
  - `artifacts/api-server/src/lib/capabilityTargets.extraPhotos.test.ts`
  - `artifacts/api-server/src/routes/issues.extraPhotos.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - **Setup.** Use `test/roleKit.ts` and `test/feedingSites.ts`: two colonies, A and B, each with a cat guardian and one cat. Create a resolved three-photo sighting of cat A: `saveSpotWithPhotos`, then resolve it the way `sightings.resolve.test.ts` does.
  - **(a)** `catsOfPhoto(<face extra's publicId>)` returns `[catA]`. The **body** extra (not the cover) also returns `[catA]`.
  - **(b) Hide/restore** (`routes/teamPhotos.ts`, the same requests `team.photos.test.ts` makes): guardian A **can** hide the body extra; guardian B gets **403**.
  - **(c) The team photo viewer** `GET /api/team/photos/<body extra>` (`routes/teamReports.ts`): served to guardian A, **403** to guardian B.
  - **(d) Report an issue** (`POST /api/issues` with `photoPublicId` = the body extra and cat = cat A): accepted. The same photo reported against cat B gets **422** `photo_not_of_this_cat`. Follow `issues.test.ts`'s setup for Turnstile (it mocks or bypasses it in tests).
- [ ] **Step 2: Run them and see them fail.**
  - `catsOfPhoto` returns `[]` for the body extra, so its target falls back to `{ colonyId: null }`.
  - `photoOfCat` returns `"not_this_cat"`.
- [ ] **Step 3: Implement `catsOfPhoto`.** Add a fourth query to its `Promise.all`:

```ts
    db
      .select({ catId: sightingsTable.catId })
      .from(sightingPhotosTable)
      .innerJoin(sightingsTable, eq(sightingsTable.id, sightingPhotosTable.sightingId))
      .where(and(eq(sightingPhotosTable.photoId, photo.id), isNotNull(sightingsTable.catId))),
```

  Spread it into the returned list. A cover photo found twice is harmless: `catTargets` maps each id through `canonicalCats` (merged cats) and its colony lookup removes duplicates (`targetsOf`, `capabilityTargets.ts`). `catsOfPhoto` itself returns raw cat ids; keep it that way, so a photo of a merged cat is judged as its canonical cat exactly as cover photos are.

- [ ] **Step 4: Implement `photoOfCat`.** Replace the single `sightings.photo_id` lookup with one that also accepts a photo listed in `sighting_photos` for a resolved sighting of this cat:

```ts
  const [sighting] = await db
    .select({ id: sightingsTable.id })
    .from(sightingsTable)
    .leftJoin(sightingPhotosTable, eq(sightingPhotosTable.sightingId, sightingsTable.id))
    .where(
      and(
        eq(sightingsTable.catId, cat.id),
        eq(sightingsTable.status, "resolved"),
        or(eq(sightingsTable.photoId, photo.id), eq(sightingPhotosTable.photoId, photo.id)),
      ),
    )
    .limit(1);
```

  Update its doc comment: "its main photo, or any photo of one of its resolved sightings (SYC-415)".
- [ ] **Step 5: Run them and see them pass.** Then run `team.photos.test.ts`, `issues*.test.ts` and `photoVisibility.test.ts`.
- [ ] **Step 6: Mutation probes.**
  - Remove the new `catsOfPhoto` query, and see (b) and (c) go red.
  - Remove the `sightingPhotosTable` condition in `photoOfCat`, and see (d) go red.

  Restore both.
- [ ] **Step 7: Commit** — `git commit -m "SYC-415 PR3: hide, restore, view and report reach extra photos, colony-scoped (probes)"`.

### Task 3.2: The public cat page payload

**Files:**
- Modify:
  - `artifacts/api-server/src/routes/cats.ts` — `GET /cats/:id`, after its `sightings` query;
  - `artifacts/api-server/src/lib/catHelpers.ts` (`serialiseSighting`, `PublicSighting`);
  - `lib/api-spec/openapi.yaml` — schema `Sighting` gets an optional `extraPhotos`. Then run codegen.
- Test: `artifacts/api-server/src/routes/cats.extraPhotos.test.ts`

**Interfaces — Produces:** `PublicSighting.extraPhotos?: { role: "first" | "face" | "body"; photoUrl: string | null }[]`. These are the sighting's photos **other than its cover**, in position order, with `photoUrl` null when hidden. **The key is left out entirely when a sighting has no extras**, so the two byte-exact snapshots (`routes/__snapshots__/cats.publicDetail.p3-2.txt`, `publicPayload.p6.txt`) and the public-field guard stay unchanged.

- [ ] **Step 1: Write the failing test.**
  - For a resolved three-photo sighting (face extra), `GET /api/cats/:id` returns that sighting with `photoUrl` = the face photo and `extraPhotos` = `[{role:"first", photoUrl:…}, {role:"body", photoUrl:…}]`.
  - Hide the body photo (`setPhotoVisibility`), and its `photoUrl` is `null` while the others stay.
  - A one-photo sighting has **no** `extraPhotos` key.
  - A **pending** sighting's extra photo public id appears nowhere: search the response text of `GET /api/cats`, `GET /api/cats/:id` and the catalogue route.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.**
  - After the `sightings` query, load every `sighting_photos` row for those sighting ids, joined to `photos` for `public_id`, in **one** query (the route's comment explains the N+1 it avoids).
  - Group the rows by sighting, and drop the cover (`photoId === sighting.photoId`).
  - Pass every extra photo id into the same `hiddenPhotoIds(...)` call, so one batched lookup covers them.
  - Build each URL with `publicPhotoUrl({ id, publicId }, hidden)`.
  - In `serialiseSighting`, add `...(s.extraPhotos?.length ? { extraPhotos: s.extraPhotos } : {})`.
- [ ] **Step 4: Run it, plus `cats.publicDetail.test.ts` and `publicPayload.*.test.ts`.** Expected: green with **no snapshot changes**.
- [ ] **Step 5: Commit** — `git commit -m "SYC-415 PR3: public cat page lists each sighting's extra photos (omitted when none)"`.

### Task 3.3: The team's cat page (server-rendered), and comments at the readers that stay as they are

**Files:**
- Modify:
  - `artifacts/api-server/src/lib/teamCatView.ts` — `TeamPhoto`, the `sightings` query, `galleryIds`, `sightingIds`, the returned `sightings`;
  - `artifacts/api-server/src/lib/teamPages/catPages.ts` — `galleryItem`, and the sightings list.
- Comment only: `lib/photoVisibility.ts`, the stand-in rule (`// SYC-415 spec §6.3: the stand-in uses cover photos only; an extra photo is never promoted automatically.`), and the same in `lib/coatReading/due.ts`.
- Test: extend `routes/team.photos.test.ts` and the `catPages` tests (`lib/teamPages/catPages*.test.ts`).

**Interfaces — Produces:**
- `TeamPhoto.role?: "first" | "face" | "body"`
- each team sighting gains `extraPhotos: { role; photoUrl }[]` and `mixedCats: boolean`

- [ ] **Step 1: Write the failing tests.** For a cat with a three-photo sighting (face cover):
  - the team view's `photos` lists all three photos, each once and each with `source: "sighting"`. The **extras are not "statement"**: `sightingIds` must include them.
  - Their `role` is set: face, first, body.
  - That sighting's `extraPhotos` lists first and body.
  - A sighting whose match record has `mixed_cats = true` shows `mixedCats: true`.
  - In the rendered HTML, the body photo's gallery item says "Whole body photo" in its caption and in its button's screen-reader text, and the sightings list shows "May show more than one cat" next to the mixed sighting.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - Load the `sighting_photos` rows for the cat's resolved sightings, plus a left join to `sighting_matches.mixed_cats`.
  - In `galleryIds`, put each sighting's extras after its cover, keeping the `Set`.
  - Build `sightingIds` from **every** sighting photo, and give each `TeamPhoto` its `role` from those rows.
  - In `galleryItem`, when `p.role` is face or body, add a caption line ("Face photo" or "Whole body photo") and extend the screen-reader span: `(whole body photo, photo 3 of 5)`.
  - In the sightings list, render `<span class="chip">May show more than one cat</span>` when `mixedCats`. The team pages are English-only today, like the rest of that page, so no i18n keys.
- [ ] **Step 4: Run them, plus all `team.*.test.ts` and `catPages*.test.ts`.** Expected: green.
- [ ] **Step 5: Commit** — `git commit -m "SYC-415 PR3: team cat page shows extra photos with their role, and the more-than-one-cat flag"`.

### Task 3.4: The cat page in the app shows thumbnails

**Files:**
- Create: `artifacts/cat-spotter/components/SightingPhotos.tsx`, extracted from the sighting photo block in `app/cat/[id].tsx`.
- Modify:
  - `app/cat/[id].tsx` — use it;
  - `lib/i18n.ts` — `extraPhotoFaceLabel: 'Face photo'`, `extraPhotoBodyLabel: 'Whole body photo'` and `extraPhotoFirstLabel: 'Photo'`, in en, el and fr.
- Test: `components/__tests__/SightingPhotos.test.tsx`, in the repo's test style.

- [ ] **Step 1: Write the failing test.** A sighting with `photoUrl` plus two `extraPhotos`, one of them hidden (`photoUrl: null`), renders:
  - the cover;
  - exactly **one** thumbnail (`data-testid="extra-photo-body"`) with `aria-label` "extraPhotoBodyLabel";
  - nothing for the hidden one.

  A sighting with no `extraPhotos` key renders the cover only.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.** Up to two 48×48 thumbnails beside the cover, each with a 44pt tap target. A tap opens the same full-size viewer the cover uses; find it in `[id].tsx` and pass it in as a prop.
- [ ] **Step 4: Run it, then the whole app suite.** Check it in the browser at 390px and desktop, light and dark, against a local database with a planted three-photo sighting (memory note `local-preview-with-planted-link`).
- [ ] **Step 5: Commit, then open PR 3.** Run the adversarial review in its own worktree, CI green, merge waits for Samuel, publish, confirm the live build. Probe `GET /api/cats/<id>` live: no sighting has `extraPhotos` (none exist yet).

---

## PR 4 — the extra-photo boxes (app)

Branch `claude/syc-415-pr4-extra-photo-boxes` off fresh `origin/main`. It can be built alongside PR 3, but it **must not merge before PR 3 is live**.

### Task 4.1: The pure rules

**Files:**
- Create: `artifacts/cat-spotter/lib/extraPhotos.ts`
- Test: `artifacts/cat-spotter/lib/__tests__/extraPhotos.test.ts`

**Interfaces — Produces:**

```ts
export type ExtraRole = 'face' | 'body';
/** One photo in the spot. `fingerprint` is ALWAYS of the photo as picked or captured
 *  (photoFingerprint of the original base64), never of the prepared copy, so a later
 *  "already logged" check against the same library photo matches (spec §4.3). */
export interface SpotPhoto { uri: string; base64: string; fingerprint: string; takenAtMs: number | null }
export const SAME_VISIT_MS = 2 * 60 * 60 * 1000;
export const REQUEST_BUDGET_BASE64_CHARS = 18 * 1024 * 1024;
export function coverRole(extras: Partial<Record<ExtraRole, SpotPhoto>>): 'face' | 'first';
export function withinSameVisit(a: number | null, b: number | null): boolean;
export type ExtraProblem =
  | { kind: 'duplicate' }
  | { kind: 'alreadyLogged' }
  | { kind: 'tooOld'; instantMs: number }
  | { kind: 'differentVisit'; takenAtMs: number }
  | { kind: 'tooLarge' };
export function checkExtraCandidate(input: {
  candidate: SpotPhoto; first: SpotPhoto; otherExtra: SpotPhoto | undefined;
  alreadyLogged: boolean; tooOld: { instantMs: number } | null;
}): ExtraProblem | null;
export function recheckAfterRetake(
  first: SpotPhoto, extras: Partial<Record<ExtraRole, SpotPhoto>>,
): { kept: Partial<Record<ExtraRole, SpotPhoto>>; removed: { role: ExtraRole; takenAtMs: number | null }[] };
export function fitsRequestBudget(firstBase64: string, extrasBase64: string[]): boolean;
```

Each `SpotPhoto` holds two things for an extra:
- `base64` and `uri` are the **prepared** copy, the one that gets sent.
- `fingerprint` is the **original's**.

`takenAtMs` is set as follows:
- a camera photo, live or system: `Date.now()` at capture;
- a library photo: `timeInfo.instantMs` when `timeInfo.kind === 'ok'`;
- otherwise `null`.

- [ ] **Step 1: Write the failing tests.**

```ts
import { describe, expect, it } from 'vitest';
import { SAME_VISIT_MS, checkExtraCandidate, coverRole, fitsRequestBudget, recheckAfterRetake, withinSameVisit } from '../extraPhotos';

const p = (fingerprint: string, takenAtMs: number | null, base64 = 'x') => ({ uri: `u-${fingerprint}`, base64, fingerprint, takenAtMs });
const T = Date.UTC(2026, 9, 15, 10, 0);

describe('coverRole', () => {
  it('is face when a face photo is added, else first', () => {
    expect(coverRole({ face: p('f', T) })).toBe('face');
    expect(coverRole({ body: p('b', T) })).toBe('first');
    expect(coverRole({})).toBe('first');
  });
});

describe('withinSameVisit', () => {
  it('accepts within two hours either way, and when either time is unknown', () => {
    expect(withinSameVisit(T, T + SAME_VISIT_MS)).toBe(true);
    expect(withinSameVisit(T, T - SAME_VISIT_MS)).toBe(true);
    expect(withinSameVisit(T, T + SAME_VISIT_MS + 1)).toBe(false);
    expect(withinSameVisit(T, null)).toBe(true);
    expect(withinSameVisit(null, T)).toBe(true);
  });
});

describe('checkExtraCandidate', () => {
  const first = p('first', T);
  it("refuses the first photo again, or the other box's photo", () => {
    expect(checkExtraCandidate({ candidate: p('first', T), first, otherExtra: undefined, alreadyLogged: false, tooOld: null })).toEqual({ kind: 'duplicate' });
    expect(checkExtraCandidate({ candidate: p('b', T), first, otherExtra: p('b', T), alreadyLogged: false, tooOld: null })).toEqual({ kind: 'duplicate' });
  });
  it('refuses an already-logged, too-old, or different-visit photo, in that order', () => {
    expect(checkExtraCandidate({ candidate: p('c', T), first, otherExtra: undefined, alreadyLogged: true, tooOld: null })).toEqual({ kind: 'alreadyLogged' });
    expect(checkExtraCandidate({ candidate: p('c', T), first, otherExtra: undefined, alreadyLogged: false, tooOld: { instantMs: 1 } })).toEqual({ kind: 'tooOld', instantMs: 1 });
    const later = T + SAME_VISIT_MS + 60_000;
    expect(checkExtraCandidate({ candidate: p('c', later), first, otherExtra: undefined, alreadyLogged: false, tooOld: null })).toEqual({ kind: 'differentVisit', takenAtMs: later });
  });
  it('catches a library first photo from days ago with a camera extra taken now (spec review F9)', () => {
    const libraryFirst = p('first', T - 3 * 86_400_000);
    expect(checkExtraCandidate({ candidate: p('cam', T), first: libraryFirst, otherExtra: undefined, alreadyLogged: false, tooOld: null })?.kind).toBe('differentVisit');
  });
  it('accepts a good photo', () => {
    expect(checkExtraCandidate({ candidate: p('c', T + 60_000), first, otherExtra: undefined, alreadyLogged: false, tooOld: null })).toBeNull();
  });
});

describe('recheckAfterRetake', () => {
  it('keeps extras that still fit and removes ones that no longer do, or that repeat the new first photo', () => {
    const newFirst = p('n', T + 5 * 3_600_000);
    const r = recheckAfterRetake(newFirst, { face: p('f', T), body: p('b', T + 4.5 * 3_600_000) });
    expect(Object.keys(r.kept)).toEqual(['body']);
    expect(r.removed).toEqual([{ role: 'face', takenAtMs: T }]);
    expect(recheckAfterRetake(p('b', T), { body: p('b', T) }).removed).toEqual([{ role: 'body', takenAtMs: T }]);
  });
});

describe('fitsRequestBudget', () => {
  it('is false once the total passes 18 MB of base64', () => {
    const mb = (n: number) => 'a'.repeat(n * 1024 * 1024);
    expect(fitsRequestBudget(mb(15), [mb(1), mb(1)])).toBe(true);
    expect(fitsRequestBudget(mb(15), [mb(2), mb(2)])).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - `checkExtraCandidate` checks in this order: duplicate (the fingerprint equals `first.fingerprint` or `otherExtra?.fingerprint`), `alreadyLogged`, `tooOld`, `!withinSameVisit(first.takenAtMs, candidate.takenAtMs)`, then `null`.
  - `recheckAfterRetake` drops each extra that fails `withinSameVisit` against the new first photo, or whose fingerprint equals the new first's.
  - `fitsRequestBudget` sums the lengths and compares them with `REQUEST_BUDGET_BASE64_CHARS`.
- [ ] **Step 4: Run them and see them pass.** Commit: `git commit -m "SYC-415 PR4: extra-photo rules (cover, same visit, duplicates, budget)"`.

### Task 4.2: Preparing an extra photo

**Files:**
- Create: `artifacts/cat-spotter/lib/prepareExtraPhoto.ts`
- Test: `artifacts/cat-spotter/lib/__tests__/prepareExtraPhoto.test.ts`, with `vi.mock('expo-image-manipulator', …)`

**Interfaces — Produces:** `prepareExtraPhoto(uri: string): Promise<{ uri: string; base64: string } | null>`.

- [ ] **Step 1: Write the failing tests.**
  - A 4000×3000 source is resized with `[{ resize: { width: 2048 } }]`.
  - A 3000×4000 source is resized with `[{ resize: { height: 2048 } }]`.
  - A 1200×900 source gets no resize action, only the re-encode.
  - All three use `{ compress: 0.8, format: 'jpeg', base64: true }`.
  - A thrown error returns `null`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Read the size with a first `manipulateAsync(uri, [], {})`, which returns `width`/`height`. Choose the resize, then return `{ uri, base64 }`. Wrap it all in try/catch and return `null` on failure. That `null` is what makes "refuse at pick time" work (spec §4.3, §6.1), for example for an iPhone photo the web build can't decode.
- [ ] **Step 4: Run them and see them pass.** Commit.

### Task 4.3: Payloads, the queue item, and reading stored items safely

**Files:**
- Modify: `artifacts/cat-spotter/lib/sightingPayload.ts` and `artifacts/cat-spotter/lib/offlineQueue.ts`
- Test: extend `lib/__tests__/sightingPayload.test.ts` (it pins the payloads' exact fields; SYC-166 spec §9 tests 6a, 6b) and `lib/__tests__/offlineQueue.test.ts`.

**Interfaces — Produces:**
- `sightingRequest({ …, extraPhotos?: { role: ExtraRole; photoBase64: string }[] })`, which adds `extraPhotos` **only when non-empty**.
- `queuedSighting({ …, extras?: { role: ExtraRole; uri: string; base64: string }[] })`, which adds `extraPhotos: [{ role, photoUri: uri, photoBase64: base64 }]` only when non-empty.
- New `PendingSighting` fields:
  - `extraPhotos?: unknown` — typed `unknown` on purpose: always read it through `extrasOf`;
  - `extraNote?: 'extraMissing' | 'extraNotKept'`;
  - `rejectedRole?: 'first' | 'face' | 'body'`.
- `export interface ExtraRef { role: ExtraRole; photoUri: string; photoBase64?: string }`
- `export function extrasOf(item: { extraPhotos?: unknown }): ExtraRef[]` — the **only** way any code reads a stored item's extras. It never throws, and drops anything malformed. (`parseQueue` in `lib/queueStore.ts` passes items through untouched, so the stored shape can't be trusted.)
- `export function coverOf(item: PendingSighting): { uri: string; base64?: string }` — the face extra's `photoUri`/`photoBase64` if there is one, else `photoUri`/`photoBase64`. It's used everywhere the review screen pairs the two.

- [ ] **Step 1: Write the failing tests.**
  - **sightingPayload:** with no extras, the existing exact-fields assertion still holds (no `extraPhotos` key). With a face extra, `extraPhotos` equals `[{ role: 'face', photoBase64: 'F' }]`.
  - **`extrasOf`** handles:
    - a good list;
    - `undefined`, giving `[]`;
    - a non-array, giving `[]`;
    - `[{role:'tail', photoUri:'p'}]` and `[{role:'face'}]`, both giving `[]`;
    - a list of three or more, keeping the first face and first body only.
  - **`coverOf`:** the face extra wins over the first photo, and the base64 travels with its own uri, never the first photo's base64 with the face's uri.
- [ ] **Step 2: Run them, implement, run them again.** Commit: `git commit -m "SYC-415 PR4: payloads and queue item carry extras; extrasOf/coverOf read stored items safely"`.

### Task 4.4: The offline queue keeps, sends and cleans up every photo

**Files:**
- Modify:
  - `artifacts/cat-spotter/context/OfflineContext.tsx` — the orphan-cleanup keep list, `syncOne`, `enqueue`, `remove`, `replacePhoto`, and the new `removeExtraPhoto(localId, role)` and `replaceExtraPhoto(localId, role, photo)`;
  - `artifacts/cat-spotter/lib/pendingPhotos.ts` (`replacementPhotoKey`);
  - `artifacts/cat-spotter/lib/photoRejection.ts`.
- Test:
  - new: `context/__tests__/OfflineContext.extraPhotos.test.tsx` (copy the setup of the existing OfflineContext tests in that folder, with `setPhotoStoreAdapterForTests`);
  - update: `lib/__tests__/photoRejection.test.ts` (its current assertion that 413 gives `null` changes to `'spotTooLarge'`), `lib/__tests__/offlineQueue.test.ts` (check its 413-is-permanent case still holds: a rejection is permanent until the spotter fixes it), and the `replacementPhotoKey` tests.

**Interfaces — Produces:**
- `replacementPhotoKey(localId, currentRef, role: 'first' | 'face' | 'body' = 'first')`. Its keys are `<localId>-r<n>` for the first photo (unchanged, so existing items keep working) and `<localId>-<role>-r<n>` for extras. The counter reads only refs with the same prefix.
- `photoRejectionKey(err)` maps **413** to `'spotTooLarge'`, a new i18n key (*"This spot is too large to send. Remove a photo and try again."*).
- `rejectedPhotoRole(err): 'first' | 'face' | 'body' | null` reads `data.photo` on a 400.

- [ ] **Step 1: Write the failing tests.** Each one guards a silent failure, so each gets a mutation probe in Step 5.
  1. **The tidy-up keeps extras.** Enqueue a three-photo spot, move the clock 25 hours on, and run the context's orphan cleanup. All three stored refs still exist.
  2. **It sends all of them.** Online, sync calls `createSighting` with two `extraPhotos` (face and body), read from the store.
  3. **A missing extra doesn't block the spot.** Delete the face extra's stored file, then sync. The spot sends with only the body extra, and the item, now in review, has `extraNote: 'extraMissing'`.
  4. **A missing first photo behaves as it does for any spot.** The item goes to `error` (`cleared` or `stale`), the same as the existing single-photo case.
  5. **A refused extra can be fixed.** The server returns 400 `{ error: 'Image could not be decoded: file appears corrupt', photo: 'face' }`. The item becomes `rejected` with `rejectionKey: 'photoInvalid'` and `rejectedRole: 'face'`. Then `removeExtraPhoto(localId, 'face')` makes it `queued` with no face extra, and the next sync sends.
  6. **A too-large spot can be fixed.** The server returns 413, giving `rejected` with `rejectionKey: 'spotTooLarge'`.
  7. **Removing deletes everything.** `remove(localId)` deletes all three stored photos.
  8. **Replacement keys never collide.** Replace the first photo, then replace the face extra. The two refs differ, and reading each returns its own new bytes.
  9. **An extra that can't be stored outside the list is not kept inline.** Make the photo store fail for the extra only. The spot is saved with its first photo, the extra is dropped, and the item has `extraNote: 'extraNotKept'`. The queue list stays small: only the first photo is inline, if the store is unavailable for everything. That way three inline photos can never overflow the browser's list.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - **Keep list:** add `...extrasOf(p).map((e) => e.photoUri)` to each item's refs.
  - **enqueue:** save each extra with `savePendingPhoto(\`${item.localId}-${e.role}\`, e.photoUri, e.photoBase64)`. If the save isn't `ok`, drop that extra and set `extraNote: 'extraNotKept'`; never keep it inline. Store `extraPhotos` with the saved refs and no base64.
  - **syncOne:** after loading the first photo, read each of `extrasOf(item)` with `readPendingPhoto`. A missing or unreadable extra is skipped, and `extraNote: 'extraMissing'` is set when the item is marked for review. Pass `extraPhotos` to `createSighting`. On a `photoRejectionKey(err)`, also store `rejectedRole: rejectedPhotoRole(err) ?? 'first'`. Leave `moveInlinePhotoToStore` as it is: it only ever moves first photos, because extras are never inline.
  - **remove:** delete `photoUri` and every `extrasOf(item)` ref.
  - **removeExtraPhoto / replaceExtraPhoto:** change that one extra (replace uses `replacementPhotoKey(localId, currentRef, role)`), delete the old file, then set `status: 'queued'`. Clear `rejectionKey` and `rejectedRole` when the rejected photo was this one.
  - **replacementPhotoKey:** add the `role` parameter as described above.
  - **photoRejection.ts:** add `if (apiError.status === 413) return 'spotTooLarge';` before the 400 check, plus `export function rejectedPhotoRole(err)`. Add the `spotTooLarge` string to en, el and fr.
- [ ] **Step 4: Run them and see them pass**, then the whole app suite.
- [ ] **Step 5: Mutation probes.** Restore each one after it goes red, and name all five in the commit.
  - Drop the extras from the keep list, and see test 1 go red.
  - Make `remove` delete only `photoUri`, and see 7 go red.
  - Make a missing extra fail the item, and see 3 go red.
  - Make extras use the first photo's replacement key, and see 8 go red.
  - Keep a failed extra inline, and see 9 go red.
- [ ] **Step 6: Commit** — `git commit -m "SYC-415 PR4: offline queue keeps, sends and cleans every photo; per-photo fix (probes: sweep, remove, missing, key, inline)"`.

### Task 4.5: "Already logged" covers every photo

**Files:**
- Modify: `artifacts/cat-spotter/lib/recentPhotos.ts`:
  - `RecentPhoto.extraFingerprints?: string[]`;
  - `clean`;
  - `entryForOutcome`, with a new 5th parameter `extraFingerprints: string[] = []`;
  - `findAlreadyLogged`;
  - the `fingerprint` doc comment. Camera photos now carry one too.
- Test: extend `lib/__tests__/recentPhotos.test.ts`.

- [ ] **Step 1: Write the failing tests.**
  - `entryForOutcome('sent', t, 'F1', { sightingId: 9, isCatPhoto: true }, ['F2', 'F3'])` has `extraFingerprints: ['F2','F3']`.
  - With `isCatPhoto: false` it has no fingerprints at all, the same rule as the first photo (review M5).
  - `findAlreadyLogged('F3', [thatEntry], new Set())` returns the entry.
  - `clean` drops an `extraFingerprints` that isn't an array of strings.
  - Update any existing test that asserts a camera photo has no fingerprint.
- [ ] **Step 2: Run them, implement, run them again.** Commit: `git commit -m "SYC-415 PR4: already-logged covers extra photos and camera photos"`.

### Task 4.6: The boxes, and wiring them into the Spot screen

**Files:**
- Create: `artifacts/cat-spotter/components/ExtraPhotoBoxes.tsx`
- Modify:
  - `app/(tabs)/spot.tsx`;
  - `lib/submitFlow.ts` (`SubmitOutcome`'s `rejected` gains `role`);
  - `app/review.tsx`;
  - `lib/appSettings.ts`, `lib/waitingCard.ts` (`SettingsView`) and `context/AppSettingsContext.tsx`;
  - `lib/i18n.ts`.
- Test:
  - new: `components/__tests__/ExtraPhotoBoxes.test.tsx`, `lib/__tests__/extraPhotosWiring.test.ts` (source test);
  - extend: `lib/__tests__/appSettings.test.ts`, `lib/__tests__/submitFlow.test.ts`;
  - update: `lib/__tests__/spotRetake.test.ts`.

**Interfaces:**
- Consumes: 4.1–4.5, and `FaceCartoon`/`BodyCartoon` (1.2).
- Produces:

```ts
ExtraPhotoBoxes: (props: {
  extras: Partial<Record<ExtraRole, { uri: string }>>;
  onAdd: (role: ExtraRole, from: 'camera' | 'library') => void;
  onRemove: (role: ExtraRole) => void;
  disabled?: boolean;
}) => JSX.Element
```

- test ids:
  - `extra-box-face` and `extra-box-body`
  - `extra-face-camera`, `extra-face-library`, `extra-body-camera` and `extra-body-library`
  - `extra-face-remove` and `extra-body-remove`
- i18n keys:
  - `extraPhotosLine`: *"Got the face and the whole body? Add them so we can tell this cat apart. Same cat only."*
  - `addFace`: "Add the face"; `addBody`: "Add the whole body"
  - `extraCamera`: "Camera"; `extraLibrary`: "Photos"
  - `addFaceA11y`: "Add the face photo, optional"; `addBodyA11y`: "Add the whole body photo, optional"
  - `faceAddedA11y`: "Face photo added"; `bodyAddedA11y`: "Whole body photo added"
  - `removePhoto`: "Remove"
  - `extraDifferentVisit`: *"This photo was taken at a different time ({when}). Photos in one spot need to be from the same visit. Choose another photo."*
  - `extraRemovedAfterRetake`: *"Your {which} photo was from a different time, so we took it out."*
  - `extraDuplicate`: *"You've already used this photo in this spot."*
  - `extraTooLarge`: *"This photo is too large to add here. Try taking one instead."*
  - `extraMissingNote`: *"One of your photos couldn't be found, so we sent the others."*
  - `extraNotKeptNote`: *"Your extra photos couldn't be saved for later, so this spot will send with its first photo."*
  - `extraPhotoRejected`: *"Your {which} photo couldn't be used."*
  - `whichFace`: "face"; `whichBody`: "whole body"

  All in en, el and fr. Reuse the existing already-logged and 21-day messages for those two cases.

- [ ] **Step 1: Write the failing tests.**
  - **ExtraPhotoBoxes** (repo test style):
    - two empty boxes, each with its `aria-label` (`addFaceA11y`, `addBodyA11y`), the label text, and **two buttons**;
    - `fireEvent.click` on `extra-face-library` calls `onAdd('face','library')`, and on `extra-body-camera` calls `onAdd('body','camera')`;
    - a filled face box shows the image, has the `aria-label` `faceAddedA11y` and a `extra-face-remove` button that calls `onRemove('face')`;
    - every button's style has `minWidth` and `minHeight` of at least 44.
  - **submitFlow:** when `send` throws a 400 with `{ photo: 'face' }`, the outcome is `{ kind: 'rejected', rejectionKey: 'photoInvalid', role: 'face' }`. A first-photo rejection gives `role: 'first'`.
  - **appSettings:** `settingsFromResponse({ feedNudge: null, hiddenFacts: [], extraPhotos: true })` gives `settings.extraPhotosOn: true`; a missing field gives `false`. The stored-settings validator accepts an old stored value with no `extraPhotosOn` (it reads as `false`).
  - **`extraPhotosWiring` source test on `spot.tsx`:**
    - (a) `<ExtraPhotoBoxes` sits inside a condition on `extraPhotosOn`;
    - (b) there is a `const setFirstPhoto =`, and **both** `pickPhoto` and `captureLivePhoto` call `setFirstPhoto(`, while neither calls `setPhoto(` directly any more;
    - (c) `setFirstPhoto` calls `recheckAfterRetake(`;
    - (d) `submit` passes `extraPhotos` to `sightingRequest(` and `extras` to `queuedSighting(`;
    - (e) the review photo is saved from `coverRole(extras) === 'face'`;
    - (f) `entryForOutcome(` gets a fifth argument;
    - (g) the queued rejected card calls `replaceExtraPhoto(` or `removeExtraPhoto(` when `item.rejectedRole` is face or body.
  - **Update `spotRetake.test.ts`:**
    - `onRetake={retakeFirstPhoto}`;
    - the `retakeFirstPhoto` block clears the first photo's time and pin, never `extras`, and calls no queue functions;
    - the back chevron still uses `onPress={clearPhoto}`;
    - `clearPhoto` also clears `extras` (`setExtras({})`).
- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement `ExtraPhotoBoxes`.**
  - A `View` (`gap: spacing[2]`) holds the `extraPhotosLine` text, then a row of two boxes, each `flex: 1`, `minHeight: 132`, a 2px dashed border in `colors.primary`, radius 14.
  - **An empty box** shows the cartoon at 56, the label, and below it two small buttons side by side: "Camera" (Feather `camera`) and "Photos" (Feather `image`), each at least 44×44.
  - **A filled box** shows the photo (cover-fit) with a "Remove" button (at least 44×44) in its corner. Tapping the photo offers the same two buttons again, as an inline row, to replace it.
  - There's no pop-up chooser: each button opens the picker straight from the tap, which browsers require.

- [ ] **Step 4: Wire it into `spot.tsx`.**
  - **New state:**
    - `const [extras, setExtras] = useState<Partial<Record<ExtraRole, SpotPhoto>>>({});`
    - `const [firstTakenAtMs, setFirstTakenAtMs] = useState<number | null>(null);`
  - **One way to set the first photo,** used by `pickPhoto` and `captureLivePhoto` alike:

```ts
const setFirstPhoto = (next: PickedPhoto, timeInfo: PhotoTimeInfo, fingerprint: string, takenAtMs: number | null) => {
  setPhoto(next);
  setPhotoTime(timeInfo);
  photoFingerprintRef.current = fingerprint; // now camera photos too (Task 4.5)
  setFirstTakenAtMs(takenAtMs);
  setCapturedAt(new Date(takenAtMs ?? Date.now()).toISOString());
  if (Object.keys(extras).length) {
    const { kept, removed } = recheckAfterRetake({ uri: next.uri, base64: next.base64, fingerprint, takenAtMs }, extras);
    setExtras(kept);
    for (const r of removed) notify(t('extraRemovedAfterRetake').replace('{which}', t(r.role === 'face' ? 'whichFace' : 'whichBody')));
  }
};
```

  Where each setter gets its values:
  - `pickPhoto` calls it with `fingerprint` from `readPickedAsset` and `takenAtMs = timeInfo.kind === 'ok' ? timeInfo.instantMs : fromCamera ? Date.now() : null`. Keep its 21-day and already-logged checks before the call.
  - `captureLivePhoto` calls it with `photoFingerprint(picked.base64)`, `{ kind: 'unread' }` and `Date.now()`.
  - Keep `capturedAt`'s current meaning: for a library photo with no time it is "now", exactly as `pickPhoto` sets it today.

  - **Split the reset:**
    - `retakeFirstPhoto()` clears the first photo (`setPhoto(null)`, time, fingerprint, `firstTakenAtMs`, problem and pin) and **keeps** `extras`. `NewSpotIntro`'s `onRetake` uses it.
    - `clearPhoto()` does the same **and** `setExtras({})`. The header back chevron and every post-submit reset use it.
  - **`addExtra(role, from)`:** run these in order. If any check fails, `notify` its message and stop.
    1. `choosePhoto(from === 'camera')`, which returns `{ photo, timeInfo, fingerprint }`;
    2. `prepareExtraPhoto(picked.photo.uri)`. `null` means `extraTooLarge`.
    3. `findAlreadyLogged(picked.fingerprint, await loadRecentPhotos(...), pendingIds)`;
    4. `checkExtraCandidate({ candidate: { ...prepared, fingerprint: picked.fingerprint, takenAtMs }, first: firstSpotPhoto, otherExtra, alreadyLogged, tooOld })`, where `tooOld` comes from `timeInfo.kind === 'tooOld'`;
    5. `fitsRequestBudget(photo.base64, [...otherExtras, prepared].map((x) => x.base64))`;
    6. `setExtras({ ...extras, [role]: { ...prepared, fingerprint: picked.fingerprint, takenAtMs } })`.

    Format `{when}` the way `photoTooOld` formats `{date}`.
  - **Render** `<ExtraPhotoBoxes>` under `<NewSpotIntro>` when `matchWaitSettings.extraPhotosOn`.
  - **`submit`:**
    - `const extraPhotos = (['face', 'body'] as const).flatMap((r) => (extras[r] ? [{ role: r, photoBase64: extras[r]!.base64 }] : []));` goes into `sightingRequest`.
    - The same uri and base64 list goes into `queuedSighting`'s `extras`.
    - `entryForOutcome(…, Object.values(extras).map((e) => e.fingerprint))`.
    - Save the review photo from `coverRole(extras) === 'face' ? extras.face! : photo`.
    - On `outcome.kind === 'rejected'` with `outcome.role` face or body, `notify(t('photoRejectedTitle'), t('extraPhotoRejected').replace('{which}', …) + ' ' + t(outcome.rejectionKey))`, and keep everything on screen so the spotter can remove that photo.
    - On a saved-for-later outcome where the queue reports `extraNotKept`, show `extraNotKeptNote`.
  - **The queued "rejected" card** (the block that shows `t('replacePhoto')`):
    - when `item.rejectedRole` is face or body, the card says which photo (`extraPhotoRejected`), and its buttons become "Replace" (`replaceExtraPhoto`) and "Remove" (`removeExtraPhoto`) for that photo;
    - otherwise it behaves exactly as it does now.
  - The constrained-network optimiser still runs on the first photo only. Extras are already prepared.
- [ ] **Step 5: Wire it into `submitFlow.ts`.** `| { kind: 'rejected'; rejectionKey: string; role: 'first' | 'face' | 'body' }`, with `role: rejectedPhotoRole(err) ?? 'first'`.
- [ ] **Step 6: Wire it into `review.tsx`.** In each of the three places that pass a queued item's `photoUri` and `photoBase64` together, use `coverOf(queuedItem)` (`.uri` and `.base64`). Show `extraMissingNote` when `queuedItem.extraNote === 'extraMissing'`.
- [ ] **Step 7: Wire in the app settings.** Add `extraPhotosOn: boolean` to `SettingsView` (`lib/waitingCard.ts`), `emptySettingsState` (`false`), `settingsFromResponse` (`res.extraPhotos === true`, with `extraPhotos?: boolean` on its parameter type) and the stored-settings validator (accept it when missing). Update the test literals that build a full `SettingsView`.
- [ ] **Step 8: Run the tests, then the whole app suite and the typecheck.**
- [ ] **Step 9: Check it in the browser.** Use the local web preview against a local API with `extra_photos_on = true` in the local database. At 390×844 and desktop, in light and dark:
  - take the first photo with the **live camera**, then add a face photo from the library;
  - add a body photo;
  - retake the first photo, and the extras stay;
  - pick a library photo more than 2 hours from the first, and it's refused with the message;
  - remove an extra;
  - send, and the result screen shows the face photo;
  - go offline and save a three-photo spot, come back online, and it sends;
  - with the switch **off**, no boxes.

  Take screenshots for the PR. Check with the browser's screen reader that the boxes and buttons are announced.
- [ ] **Step 10: Commit, then open PR 4.** Run the adversarial review in its own worktree, CI green, merge waits for Samuel, publish, confirm the live build.

### Task 4.7: Switch on (after PRs 2–4 are live)

- [ ] **Step 1: Probe the live site with the switch still off.**
  - `GET /api/app-settings` shows `extraPhotos: false`;
  - no boxes on the test site.
- [ ] **Step 2: Live three-photo check.** Give Samuel a one-line heads-up that this creates a test sighting and cat on the test site. Then set `extra_photos_on` to `true` with `db-ops set-setting` (`docs/runbooks/neon-database.md`), and wait for the server cache (60 seconds) and the app's refresh. Then, on the test site in the browser pane:
  - spot with a face and a body photo;
  - name a new cat;
  - check that the cat page shows the face photo as the main photo, with two thumbnails;
  - hide one thumbnail from the team page, and check it's gone from the public page;
  - report the other one with "Report an issue", and check it's accepted;
  - remove the test cat by the usual team route.
- [ ] **Step 3: If Decision P1 is A,** leave it on and tell Samuel in one line. If it's B, set it back to `false` and hand Samuel the one command.
- [ ] **Step 4: Update Linear.**
  - SYC-415 goes to Done, with the PR numbers.
  - Schedule a task for **two weeks after the switch-on date** to read the spec §8 measures and post them on SYC-415, so the reading actually happens.
  - SYC-417 to SYC-420, and the notes on SYC-46, SYC-81 and SYC-163, were filed on 15 Oct. Check they still say the right thing.

---

## Spec coverage check

| Spec section | Task |
|---|---|
| §3.1 card, cartoons, tips, "Got it" never opens a picker | 1.2, 1.3 |
| §3.2 first visit, link, "no cat" screen, delete-my-data | 1.1, 1.3 |
| §3.3 three languages | 1.2, 3.4, 4.4, 4.6. The team pages are English-only today (3.3) |
| §3.4 accessibility | 1.2, 3.3, 3.4, 4.6 |
| §3.5 offline (bundled cartoons) | 1.2 (no network assets) |
| §4.1 boxes, camera/library, Remove/replace, 44pt, a11y | 4.6. Camera and library are two buttons, not a pop-up (see "In plain English") |
| §4.3 three max, once only, 21-day, two hours, retake re-check, too large at pick | 4.1, 4.2, 4.5, 4.6; server checks 2.3 |
| §4.4 one sighting, counts once | 2.5 (test 8) |
| §4.5 "Same cat only", the more-than-one-cat flag for the team | 4.6 (line), 2.4 and 2.5 (stored), 3.3 (shown) |
| §5.1 cover rule, the phone knows it | 2.3, 4.1, 4.3 (`coverOf`), 4.6 |
| §5.2 matcher sees all, any-cat, more-than-one | 2.4, 2.5 |
| §5.3 no photo dropped; matcher failure keeps all | 2.5 (test 7) |
| §5.4 a new cat's main photo is the cover | 2.3: `photo_id` is the cover, and resolve's `primaryPhotoId: sighting.photoId` (`routes/sightings.ts`, resolve) is unchanged. Resolve's coat and markings answers are also linked to the cover (the face). That's intentional under Decision 4; SYC-417 covers reading the body photo. |
| §5.5 thumbnails, per-photo hide, colony-scoped, never before resolve | 3.1, 3.2, 3.4 |
| §6.1 one request, a repeat matches all, 2048px, budget | 2.5, 4.1, 4.2 |
| §6.2 check all, save together, then match; the error names the photo | 2.2 (413), 2.3, 2.5 |
| §6.3 every reader | 3.1 (hide, restore, view, report), 3.2, 3.3; stand-in and colour reading commented as unchanged |
| §6.4 offline: sweep, missing extra, per-photo fix, too large, remove | 4.3, 4.4, 4.6 |
| §6.5 deleting data | No code: `sighting_photos` has no spotter column, and deletion only unlinks `sightings.device_id` |
| §6.6 cost, SYC-46/SYC-81 | Notes posted on SYC-46 and SYC-81 (15 Oct) |
| §6.7 release order | 2.1, 2.6, 4.6, 4.7 |
| §7 privacy | 2.5 (test 9), 3.2 (never before resolve), 3.1 (colony-scoped) |
| §8 measures | 2.1 and 2.5 (`no_cat_in_any_photo`, `mixed_cats`), roles in `sighting_photos` (the face-photo bet), 4.7 (the scheduled read) |

---

## Model delegation

The active model is Opus 5.5. Every implementing agent runs in **its own worktree**, and the prompt for each one restates: *"Commit after each task, and update `docs/superpowers/plans/syc-415-checkpoint.md` at every commit."*

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| PR 1: photo tips (1.1–1.3), with the Greek and French | **Sonnet** | Clear spec, self-contained UI, an existing "seen once" pattern | Unit and source tests; the session model looks at screenshots at 390px and desktop; an adversarial review (Sonnet, own worktree); SYC-4 for the translations |
| PR 2 Task 2.1: schema, migration, switch | **Sonnet** | Follows the documented migration routine | `migrate:check`, the rollback test, the duplicate-photo query on the dev branch; the session model reads the SQL |
| PR 2 Task 2.2: contract, codegen, 413 | **Sonnet** | A small contract change plus one error branch | Typecheck after codegen; the 413 test plus a **mutation probe** |
| PR 2 Tasks 2.3–2.5: one-transaction save, matcher, upload, dedupe | **Opus** | Escalated: subtle, silent failure modes (a partial save, the dedupe-hit fallback, the append-only trigger, a matcher failure) across several files | Route tests 1–9; **mutation probes** on the cover rule, the transaction, the dedupe hit, the fallback and mixedCats; an adversarial review (Opus, own worktree), because a wrong-but-green save is the costliest failure here |
| PR 2 Task 2.6: switch in `/app-settings` | **Haiku** | Mechanical: one setting read, following existing keys | Route tests; diff spot-review by the session model |
| PR 3 Task 3.1: hide, restore, view, report | **Sonnet** | Two small query changes with clear tests | Colony-scoped route tests; **mutation probes** on both queries |
| PR 3 Tasks 3.2–3.4: public and team payloads, team HTML, thumbnails | **Sonnet** | Straightforward reads and UI | Payload tests, including "snapshots unchanged" and "pending extras never appear"; screenshots; an adversarial review (Sonnet, own worktree) |
| PR 4 Tasks 4.1–4.3, 4.5: rules, prepare, payload and queue helpers, recent photos | **Sonnet** | Pure functions with full tests given in the plan | Unit tests; the session model re-runs the named test files itself (memory note `rerun-delegated-tests`) |
| PR 4 Task 4.4: offline queue | **Opus** | Escalated: silent-loss failure modes (the sweep deleting extras, key collisions, a missing extra killing a good spot, list overflow), plus web and native storage differences | Tests 1–9; **mutation probes** on the sweep, remove, missing extra, replacement key and inline extra; an adversarial review (Opus, own worktree) |
| PR 4 Task 4.6: boxes and Spot wiring | **Opus** | Escalated: the rewiring of `spot.tsx` touches both photo setters, the retake split, submit and the rejected card in one large file, and the review found gaps there | Component, submitFlow and source tests (including both setters); the updated `spotRetake.test.ts`; the full browser walk-through and screenshots; an adversarial review (Sonnet, own worktree, a separate tier from the builder) |
| Live checks, switch-on, Linear sync (4.7) | **Session model (Opus)** | Outside effects and judgment; the heads-up rule applies | Probe verification on the live site: the healthz commit, app-settings, a 413, a three-photo spot, hide and report |
| Integration across PRs, final review before each merge | **Session model (Opus)** | Synthesis across the agents' work | Re-runs every delegated test suite locally before asking Samuel to merge |

Digest and fan-out agents never sub-delegate. A background agent that dies is resumed from its last commit and checkpoint note, without redoing work.
