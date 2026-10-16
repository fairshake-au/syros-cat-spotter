# SYC-415: photo tips, and a face and a body photo in the same spot — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Draft for Samuel's approval, 15 October 2026.
**Ticket:** SYC-415 (Urgent).
**Spec:** `docs/specs/photo-tips-and-extra-photos.md`, approved by Samuel on 15 October 2026 with the cartoons as drawn (`DECISIONS.md` Part 2r). Its review is `docs/specs/reviews/photo-tips-and-extra-photos-review.md`.
**Checked against:** `origin/main` at `ebfcd25f` (15 Oct 2026). Every "the code does X" below names the file I read it in.

**Goal:** Spotters see what a good cat photo looks like before they take one, and can add an optional face photo and body photo to a spot. All of a spot's photos go to matching, and the face photo becomes a new cat's main photo.

**Architecture:**
- **The phone app (Expo/React Native):** a tips card and two extra-photo boxes on the Spot screen. Both are pure logic modules wired into `spot.tsx`.
- **The API (Express):** the existing upload takes up to two extra photos. It saves all of a spot's photos in one transaction into a new `sighting_photos` table, with the cover photo in `sightings.photo_id`. It then sends all the photos to the matcher.
- **The switch:** the boxes only appear once a server setting, `extra_photos_on`, is switched on.

**Tech stack:**
- App: Expo SDK / React Native / react-native-svg 15.12.1 / AsyncStorage / vitest.
- API: Express / Drizzle / Postgres (Neon) / sharp / OpenAPI + orval codegen / vitest + supertest.

---

## In plain English

The work comes in four parts. Each one can go live on its own without breaking anything:

| Part | What people notice when it goes live |
|---|---|
| **PR 1: photo tips** (app only) | The tips card on a spotter's first camera visit, a "Photo tips" link on the camera screen, and the tips on the "this doesn't look like a cat" screen. This is the quickest win, so it goes first. |
| **PR 2: the server takes extra photos** (server only) | Nothing. The server can now take, save and match up to three photos per spot, but no app sends them yet. The match record starts noting "no cat in any photo", and the tips' effect is measured from this point. |
| **PR 3: extra photos show everywhere** (server only) | Nothing yet. The cat page, the team's cat page and "who may hide this photo" learn about extra photos, ready for the first one. |
| **PR 4: the extra-photo boxes** (app) | Nothing until the switch is on. Then the "Add the face" and "Add the whole body" boxes appear on the New spot screen. |
| **Switch on** | Once PRs 2–4 are live and checked on the live site, Claude turns `extra_photos_on` on with `db-ops set-setting`. Turning it off again hides the boxes within a minute. Photos already sent stay. |

**One decision for Samuel (Decision P1, below):** whether Claude may switch the boxes on as soon as the live checks pass, or whether Samuel wants to switch them on himself.

**Cost:** see spec §6.6. Roughly US$12 a month more storage at the season estimate, plus up to two extra images per matching call. Both figures come from `hosting-and-photo-storage.md`. The price per matching call is **unchecked**.

---

## Decision P1 — who switches the extra photos on

| Option | Benefit | Risk |
|---|---|---|
| **A. Claude switches them on after the live checks pass (recommended)** | No wait on Samuel. The checks are a three-photo spot on the live site, the photos showing on the cat page, and a hide test. The switch takes a minute to undo. | Testers see the boxes the moment it's flipped, before Samuel has tried them himself. |
| B. Samuel switches them on | He tries them on his own phone first. | A delay, and an extra step for Samuel. |

**Recommendation: A.** Samuel gets a one-line heads-up before the switch is flipped, because it changes what testers see.

---

## Global Constraints

- House copy rules: say **"spotter"** (never "snapper") and **"cat guardian"** (never "colony carer"). Screen text is plain English.
- Every new screen string goes into `artifacts/cat-spotter/lib/i18n.ts` in **all three** dictionaries: `en`, `el` and `fr`.
- Every photo, extras included, goes through `validatePhotoBase64` (`artifacts/api-server/src/lib/imageValidation.ts:78`). No photo is stored any other way.
- Schema changes go through a migration file per `lib/db/migrations/README.md`: generate, add a commented rollback, run `migrate:check`. No `drizzle-kit push`.
- The `sightings` table is append-only (trigger `sightings_append_only`, `lib/db/migrations/0013_deletion_unlinks_people.sql:21`). `photo_id` is written once, at insert.
- Limits come from the spec:
  - at most 3 photos per spot (`first`, `face`, `body`), with at most one of each;
  - an extra photo's taken time must be within **2 hours** of the first photo's when both are known;
  - extra photos are prepared on the phone at **2048px** on the long side, at JPEG quality **0.8**;
  - the whole request must be under **18 MB** of base64. The server's limit is 25 MB (`artifacts/api-server/src/app.ts:79`), which leaves 7 MB of headroom.
- UI changes are checked at **390px** and desktop widths, light and dark, before the PR opens (Samuel's standing rule).
- Each PR is reviewed by an independent adversarial critic in **its own worktree** before merge (Samuel's standing rule, LIF-79).
- **Commit after each task.** Write a checkpoint note to `docs/superpowers/plans/syc-415-checkpoint.md` (what's done, what's next) at every commit. Never hold work only in memory.

---

## File map

**PR 1 — photo tips (app)**
- Create `artifacts/cat-spotter/components/photoTips/cartoons.tsx` — the four cartoons as react-native-svg components, copied from `docs/specs/assets/photo-tips/*.svg`, each with an `accessibilityLabel`.
- Create `artifacts/cat-spotter/components/photoTips/PhotoTips.tsx` — the cartoons plus four tips (no button), used by both the card and the "no cat" screen.
- Create `artifacts/cat-spotter/components/photoTips/PhotoTipsCard.tsx` — a modal: title, `<PhotoTips/>` and "Got it".
- Create `artifacts/cat-spotter/lib/photoTipsSeen.ts` — `PHOTO_TIPS_SEEN_KEY`, `hasSeenPhotoTips`, `markPhotoTipsSeen`, `clearPhotoTipsSeen`.
- Modify `artifacts/cat-spotter/app/(tabs)/spot.tsx` — show the card on the first camera visit, and the "Photo tips" link on the capture screen.
- Modify `artifacts/cat-spotter/app/review.tsx` around line 382 — `<PhotoTips/>` on the "Not a cat" screen.
- Modify `artifacts/cat-spotter/context/DeleteMyDataContext.tsx` around line 94 — call `clearPhotoTipsSeen`.
- Modify `artifacts/cat-spotter/lib/i18n.ts` — new keys in `en`, `el` and `fr`.
- Tests: `artifacts/cat-spotter/lib/__tests__/photoTipsSeen.test.ts` and `artifacts/cat-spotter/components/__tests__/PhotoTipsCard.test.tsx`.

**PR 2 — server takes extra photos**
- Create `lib/db/src/schema/sightingPhotos.ts`, and export it from `lib/db/src/schema/index.ts`.
- Modify `lib/db/src/schema/sightingMatches.ts` — add `noCatInAnyPhoto boolean` and `mixedCats boolean`, both nullable.
- Modify `lib/db/src/appSettings/shape.ts` — new key `extra_photos_on` (boolean).
- Generate `lib/db/migrations/0028_sighting_photos.sql`, with a backfill and a rollback.
- Modify `lib/api-spec/openapi.yaml` — `CreateSightingRequest.extraPhotos`, and `AppSettings.extraPhotos`. Then run codegen.
- Create `artifacts/api-server/src/lib/spotPhotos.ts` — `coverRole`, `validateSpotPhotos` and `saveSpotWithPhotos`.
- Modify `artifacts/api-server/src/lib/matching.ts` — take 1–3 new photos, and return `anyCat` and `mixedCats`.
- Modify `artifacts/api-server/src/routes/sightings.ts`:
  - POST (line 440): validate, then save in one transaction, then match;
  - `computeMatchCandidates` (line 241): takes a photo list;
  - the dedupe hit (line 532): matches all of the spot's photos;
  - `recordMatch`: writes the two new columns.
- Modify `artifacts/api-server/src/lib/appSettings.ts` and `routes/appSettings.ts` — `extraPhotos: boolean` in `GET /app-settings`.
- Tests:
  - `artifacts/api-server/src/routes/sightings.extraPhotos.test.ts`
  - `artifacts/api-server/src/lib/spotPhotos.test.ts`
  - `artifacts/api-server/src/lib/matching.test.ts` (extend, or create if absent)
  - `artifacts/api-server/src/routes/appSettings.test.ts` (extend)

**PR 3 — extra photos show everywhere (server)**
- Modify `artifacts/api-server/src/lib/capabilityTargets.ts:50` (`catsOfPhoto`) — also look in `sighting_photos`.
- Modify `artifacts/api-server/src/routes/cats.ts:251` — each public sighting gets `extraPhotos: [{role, photoUrl}]`.
- Modify `artifacts/api-server/src/lib/catHelpers.ts:230` (`serialiseSighting`) and the OpenAPI `PublicSighting` — the new field. Bump the catalogue cache key in `artifacts/api-server/src/lib/catalogue.ts:17`.
- Modify `artifacts/api-server/src/lib/teamCatView.ts:660-850` — the gallery and each sighting include extras, marked with their role.
- Leave unchanged: `artifacts/api-server/src/lib/photoVisibility.ts:149` (the stand-in rule uses cover photos only) and `artifacts/api-server/src/lib/coatReading/due.ts` (unchanged). Add a comment at both saying so, citing spec §6.3.
- Modify `artifacts/cat-spotter/app/cat/[id].tsx` (the sightings list) — thumbnails for `extraPhotos`, and a full-size view on tap, reusing the existing photo viewer.
- Tests:
  - `artifacts/api-server/src/lib/capabilityTargets.extraPhotos.test.ts`
  - `artifacts/api-server/src/routes/cats.extraPhotos.test.ts`
  - `artifacts/api-server/src/routes/team.photos.test.ts` (extend)

**PR 4 — the extra-photo boxes (app)**
- Create `artifacts/cat-spotter/lib/extraPhotos.ts` — pure rules: `ExtraRole`, `coverRole`, `withinSameVisit`, `checkExtraCandidate`, `recheckAfterRetake` and `fitsRequestBudget`.
- Create `artifacts/cat-spotter/lib/prepareExtraPhoto.ts` — the 2048px / 0.8 step, which returns `null` when it can't prepare the photo.
- Create `artifacts/cat-spotter/components/ExtraPhotoBoxes.tsx` — the two boxes.
- Modify `artifacts/cat-spotter/lib/sightingPayload.ts` — `sightingRequest` and `queuedSighting` carry `extraPhotos`.
- Modify `artifacts/cat-spotter/lib/offlineQueue.ts` — `PendingSighting.extraPhotos?: { role: ExtraRole; photoUri: string; photoBase64?: string }[]`.
- Modify `artifacts/cat-spotter/lib/queueStore.ts:159` (`parseQueue`) — read and validate `extraPhotos`. Old items have none.
- Modify `artifacts/cat-spotter/context/OfflineContext.tsx`:
  - `enqueue`, around line 593: save each extra;
  - `syncOne`, around line 345: load the extras, drop missing ones with a note;
  - the keep list, around line 257;
  - `remove` and `replacePhoto`, around line 600.
- Modify `artifacts/cat-spotter/lib/recentPhotos.ts`:
  - `RecentPhoto.extraFingerprints?: string[]`;
  - `entryForOutcome`, which takes the extras;
  - `findAlreadyLogged`, which also matches `extraFingerprints`.
- Modify `artifacts/cat-spotter/lib/photoRejection.ts` — read the new `photo` field on a 400, and treat a 413 as a fixable rejection.
- Modify `artifacts/cat-spotter/app/(tabs)/spot.tsx`:
  - state: `extras`;
  - the boxes under `NewSpotIntro`;
  - `clearPhoto` and the retake re-check;
  - `submit`, which sends the extras and saves the cover photo for the result screen.
- Modify `artifacts/cat-spotter/app/review.tsx` — a queued spot's result screen shows its cover photo.
- Modify `artifacts/cat-spotter/lib/appSettings.ts` and `artifacts/cat-spotter/context/AppSettingsContext.tsx` — `extraPhotosOn`.
- Modify `artifacts/cat-spotter/lib/i18n.ts` — new keys in all three languages.
- Tests:
  - `artifacts/cat-spotter/lib/__tests__/extraPhotos.test.ts`
  - `artifacts/cat-spotter/lib/__tests__/sightingPayload.test.ts` (extend)
  - `artifacts/cat-spotter/lib/__tests__/recentPhotos.test.ts` (extend)
  - `artifacts/cat-spotter/lib/__tests__/queueStore.test.ts` (extend)
  - `artifacts/cat-spotter/context/__tests__/OfflineContext.extraPhotos.test.tsx`
  - `artifacts/cat-spotter/components/__tests__/ExtraPhotoBoxes.test.tsx`

---

## PR 1 — photo tips (app only)

Branch off fresh `origin/main` in its own worktree: `claude/syc-415-pr1-photo-tips`.

### Task 1.1: The "seen" mark

**Files:**
- Create: `artifacts/cat-spotter/lib/photoTipsSeen.ts`
- Test: `artifacts/cat-spotter/lib/__tests__/photoTipsSeen.test.ts`

**Interfaces — Produces:**
- `PHOTO_TIPS_SEEN_KEY = 'cat-spotter/photo-tips-seen-v1'`
- `hasSeenPhotoTips(storage): Promise<boolean>`
- `markPhotoTipsSeen(storage): Promise<void>`
- `clearPhotoTipsSeen(storage): Promise<void>`

Here `storage` is `{ getItem, setItem, removeItem }`, the same shape as `RecentPhotoStorage` in `lib/recentPhotos.ts:39`.

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run it and see it fail**

Run: `cd artifacts/cat-spotter && pnpm vitest run lib/__tests__/photoTipsSeen.test.ts`
Expected: FAIL, "Cannot find module '../photoTipsSeen'". (If esbuild fails to start locally, use the `ESBUILD_BINARY_PATH` workaround in memory note `local-vitest-esbuild`.)

- [ ] **Step 3: Implement**

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

- [ ] **Step 4: Run it and see it pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** — `git add artifacts/cat-spotter/lib/photoTipsSeen.ts artifacts/cat-spotter/lib/__tests__/photoTipsSeen.test.ts && git commit -m "SYC-415 PR1: photo tips seen mark"`. Update the checkpoint note.

### Task 1.2: Cartoons, tips and words

**Files:**
- Create: `artifacts/cat-spotter/components/photoTips/cartoons.tsx` and `artifacts/cat-spotter/components/photoTips/PhotoTips.tsx`
- Modify: `artifacts/cat-spotter/lib/i18n.ts` (the `en` block near line 110, `el` near 725, `fr` near 1320)
- Test: `artifacts/cat-spotter/components/__tests__/PhotoTips.test.tsx`

**Interfaces — Produces:**
- `GoodPhotoCartoon`, `PoorPhotoCartoon`, `FaceCartoon` and `BodyCartoon`: `(props: { size: number }) => JSX.Element`, each with `accessibilityLabel` from i18n.
- `PhotoTips`: `(props: { compact?: boolean }) => JSX.Element`.
- i18n keys:
  - `photoTipsTitle`, `photoTipsGotIt`, `photoTipsLink`
  - `photoTipGetClose`, `photoTipGetCloseLine`
  - `photoTipFace`, `photoTipFaceLine`
  - `photoTipBody`, `photoTipBodyLine`
  - `photoTipLight`, `photoTipLightLine`
  - `cartoonGoodLabel`, `cartoonPoorLabel`, `cartoonFaceLabel`, `cartoonBodyLabel`

- [ ] **Step 1: Write the failing test.** It checks four things:
  - `PhotoTips` renders the four tip titles in English;
  - each cartoon exposes its accessibility label;
  - **every new key exists in `el` and `fr`** (loop over the key list above and `TRANSLATIONS`).

```tsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react-native';
import { TRANSLATIONS } from '../../lib/i18n';
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
      for (const k of KEYS) expect(TRANSLATIONS[lang][k], `${lang}.${k}`).toBeTruthy();
    }
  });

  it('shows four tips and both cartoons with spoken descriptions', () => {
    const r = render(<PhotoTips />);
    for (const k of ['photoTipGetClose', 'photoTipFace', 'photoTipBody', 'photoTipLight'] as const) {
      expect(r.getByText(TRANSLATIONS.en[k])).toBeTruthy();
    }
    expect(r.getByLabelText(TRANSLATIONS.en.cartoonGoodLabel)).toBeTruthy();
    expect(r.getByLabelText(TRANSLATIONS.en.cartoonPoorLabel)).toBeTruthy();
  });
});
```

Look at the existing component tests (`components/__tests__/NewSpotIntro.test.tsx`) for how this repo wraps renders in the language provider. Copy that wrapper if it has one.

- [ ] **Step 2: Run it and see it fail.** `pnpm vitest run components/__tests__/PhotoTips.test.tsx`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement the cartoons.** Copy each SVG in `docs/specs/assets/photo-tips/` element by element into `react-native-svg` (`Svg`, `Rect`, `Circle`, `Ellipse`, `Path`, `G`, `Defs`, `ClipPath`). Notes:
  - `poor.svg` uses a blur filter. react-native-svg 15 supports `<Filter><FeGaussianBlur/></Filter>`. Where the filter is missing (some web builds), use `opacity={0.7}` on the tiny-cat group instead, so the cat still reads as "poor".
  - Each component is `<Svg width={size} height={size} viewBox=... accessible accessibilityRole="image" accessibilityLabel={t('cartoonGoodLabel')}>`.
  - Give each cartoon's `ClipPath` and filter ids a unique suffix (`useId()`), because two copies can be on screen at once.

- [ ] **Step 4: Implement `PhotoTips`.** A `View` with the two cartoons in a row (`flexDirection: 'row'`, `gap: spacing[3]`, each `flex: 1`, max 150), then four rows. Each row is the tip title in `fonts.bodySemiBold` with the line under it in `fonts.body`, using colours from `useColors()`. `compact` cuts the cartoons to 110 on the "no cat" screen.

- [ ] **Step 5: Add the i18n strings.**
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
  - **Greek and French:** translate faithfully. Note in the commit message that SYC-4's native-speaker check covers them.

- [ ] **Step 6: Run it and see it pass.** Then run `pnpm --filter cat-spotter run typecheck` (or `pnpm -w run typecheck`). Expected: no errors.
- [ ] **Step 7: Commit** — `git commit -m "SYC-415 PR1: cartoons and photo tips, en/el/fr"`. Update the checkpoint.

### Task 1.3: The card, the link, and the "no cat" screen

**Files:**
- Create: `artifacts/cat-spotter/components/photoTips/PhotoTipsCard.tsx`
- Modify:
  - `artifacts/cat-spotter/app/(tabs)/spot.tsx`, in the capture state around lines 1160–1230;
  - `artifacts/cat-spotter/app/review.tsx` around line 382;
  - `artifacts/cat-spotter/context/DeleteMyDataContext.tsx` around line 94.
- Test: `artifacts/cat-spotter/components/__tests__/PhotoTipsCard.test.tsx`, and a source assertion in the existing `lib/__tests__/spotRetake.test.ts` style.

**Interfaces:**
- Consumes: `PhotoTips` (1.2), and `hasSeenPhotoTips`/`markPhotoTipsSeen`/`clearPhotoTipsSeen` (1.1).
- Produces: `PhotoTipsCard: (props: { visible: boolean; onClose: () => void }) => JSX.Element`.

- [ ] **Step 1: Write the failing tests.**

```tsx
// PhotoTipsCard.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react-native';
import { TRANSLATIONS } from '../../lib/i18n';
import { PhotoTipsCard } from '../photoTips/PhotoTipsCard';

describe('PhotoTipsCard', () => {
  it('shows the title and closes on Got it, without opening anything else', () => {
    const onClose = vi.fn();
    const r = render(<PhotoTipsCard visible onClose={onClose} />);
    expect(r.getByText(TRANSLATIONS.en.photoTipsTitle)).toBeTruthy();
    fireEvent.press(r.getByText(TRANSLATIONS.en.photoTipsGotIt));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('renders nothing when not visible', () => {
    const r = render(<PhotoTipsCard visible={false} onClose={() => {}} />);
    expect(r.queryByText(TRANSLATIONS.en.photoTipsTitle)).toBeNull();
  });
});
```

Then add a source test in the style of `lib/__tests__/spotRetake.test.ts`, which reads `spot.tsx` and `review.tsx` as text. It asserts:
  - (a) `spot.tsx` imports `PhotoTipsCard` and calls `hasSeenPhotoTips`;
  - (b) `spot.tsx`'s `onClose` handler for the card calls `markPhotoTipsSeen` and **does not** call `launchCameraAsync` or `launchImageLibraryAsync` (browsers only allow a picker from a direct tap: `spot.tsx` comment near line 405);
  - (c) `review.tsx`'s "Not a cat" block renders `<PhotoTips`;
  - (d) `DeleteMyDataContext.tsx` calls `clearPhotoTipsSeen`.

- [ ] **Step 2: Run both tests and see them fail.**

- [ ] **Step 3: Implement `PhotoTipsCard`.** A React Native `Modal` (`transparent`, `animationType="fade"`, `onRequestClose={onClose}`). Inside it, a `ScrollView` card (max width 420, `colors.card` background, radius 20, padding `spacing[5]`) holds:
  - the title in `fonts.displayBold`;
  - `<PhotoTips/>`;
  - a primary `Button` labelled `t('photoTipsGotIt')` calling `onClose`.

- [ ] **Step 4: Wire it into `spot.tsx`.**
  - Add `const [tipsOpen, setTipsOpen] = useState(false);`.
  - Add an effect that runs while there is no `photo` and the screen is focused (`useIsFocused` or the tab focus hook already used in the file): `hasSeenPhotoTips(AsyncStorage).then((seen) => { if (!seen) setTipsOpen(true); })`.
  - `onClose={() => { setTipsOpen(false); void markPhotoTipsSeen(AsyncStorage); }}`.
  - In the capture state, add a small `Pressable`: Feather `zap` or `info` icon, plus the text `t('photoTipsLink')`, `accessibilityRole="button"`, `hitSlop` up to 44pt. It sits in the top-right of the viewfinder overlay, away from `CaptureControls`' shutter, and calls `setTipsOpen(true)`.
  - Render `<PhotoTipsCard visible={tipsOpen} onClose={...} />`.

- [ ] **Step 5: Wire it into `review.tsx`.** In the `if (!data.isCatPhoto)` block, put `<PhotoTips compact />` between the `notACatMsg` text and the "Try again" button. Wrap the block's `View` in a `ScrollView` so short screens scroll.

- [ ] **Step 6: Wire it into `DeleteMyDataContext.tsx`.** In `wipePhone`, after `clearWaitingRecords(AsyncStorage)`, add `await clearPhotoTipsSeen(AsyncStorage);` with the comment `// SYC-415: deliberately cleared, so a fresh start sees the photo tips again.`

- [ ] **Step 7: Run the tests and see them pass.** Then run the whole app suite: `cd artifacts/cat-spotter && pnpm vitest run`. Expected: all green.

- [ ] **Step 8: Check it in the browser.**
  - Start the web preview (`preview_start`; `launch.json` lives in the primary checkout, per memory note `local-preview-with-planted-link`).
  - At 390×844 and at desktop width, in light and dark: the card shows on the first camera visit; "Got it" closes it and the camera screen stays; reloading doesn't show it again; "Photo tips" reopens it.
  - Clear site storage and see it shows again.
  - Take screenshots for the PR.

- [ ] **Step 9: Commit and open PR 1.** Run the adversarial review in its own worktree (Sonnet), apply its findings, CI green. The merge waits for Samuel (no auto-merge on this repo, per memory note `no-auto-merge-on-free-plan`).

---

## PR 2 — the server takes extra photos

Branch `claude/syc-415-pr2-server-extra-photos` off fresh `origin/main`.

### Task 2.1: The `sighting_photos` table, the match-record columns, and the switch

**Files:**
- Create: `lib/db/src/schema/sightingPhotos.ts`
- Modify:
  - `lib/db/src/schema/index.ts` (export);
  - `lib/db/src/schema/sightingMatches.ts` (two columns);
  - `lib/db/src/appSettings/shape.ts` (key).
- Generate: `lib/db/migrations/0028_sighting_photos.sql`, plus `meta/`.
- Test: `lib/db/src/appSettings/dbOps.settings.test.ts` (extend). The migration rollback is covered by `pnpm --filter @workspace/db test`.

**Interfaces — Produces:**
- `sightingPhotosTable` with columns `sightingId`, `photoId`, `role: 'first' | 'face' | 'body'` and `position: 1 | 2 | 3`.
- `SIGHTING_PHOTO_ROLES = ['first','face','body'] as const`
- `type SightingPhotoRole`
- `sightingMatchesTable.noCatInAnyPhoto` and `.mixedCats` (both `boolean`, nullable)
- setting key `"extra_photos_on"` (boolean)

- [ ] **Step 1: Write the schema.**

```ts
// lib/db/src/schema/sightingPhotos.ts
import { sql } from "drizzle-orm";
import { pgTable, integer, text, smallint, primaryKey, uniqueIndex, check, index } from "drizzle-orm/pg-core";
import { sightingsTable } from "./sightings";
import { photosTable } from "./photos";

export const SIGHTING_PHOTO_ROLES = ["first", "face", "body"] as const;
export type SightingPhotoRole = (typeof SIGHTING_PHOTO_ROLES)[number];

/**
 * Every photo of a spot, in the order taken (SYC-415 spec §6.2). A spot has
 * one to three: its first photo, and optionally a face and a body photo. The
 * cover photo (spec §5.1) is also `sightings.photo_id`, which every older
 * reader keeps using. No spotter column: deleting a person needs nothing here
 * (cat-record-data-spine.md §8.5).
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
    index("sighting_photos_photo_idx").on(t.photoId),
    check("sighting_photos_role_ck", sql`${t.role} IN ('first','face','body')`),
    check("sighting_photos_position_ck", sql`${t.position} BETWEEN 1 AND 3`),
  ],
);
```

  - Drop `sighting_photos_photo_idx` if the unique index already covers it. `migrate:check` compares push and migrate, so keep only what the schema declares.
  - Both links cascade:
    - Sightings can't be deleted in production (the append-only trigger), but test clean-up deletes them (`test/sightings.ts` `deleteTestSightings`).
    - When the team deletes a privacy photo for good (`hosting-and-photo-storage.md` §6.5), its `sighting_photos` row should go with it, never block the delete.
    - Add a test in 2.3's database test: deleting a `photos` row removes its `sighting_photos` row.

  In `sightingMatches.ts`, add:
  ```ts
  /** SYC-415 §6.2/§8: the matcher said no photo in the spot shows a cat. Null before SYC-415 or when the matcher failed. */
  noCatInAnyPhoto: boolean("no_cat_in_any_photo"),
  /** SYC-415 §4.5: the matcher said the spot's photos look like more than one cat. */
  mixedCats: boolean("mixed_cats"),
  ```

  In `shape.ts`, add `"extra_photos_on"` to `SETTING_KEYS`, and a `case "extra_photos_on": return typeof value === "boolean" ? null : "must be true or false";`.

- [ ] **Step 2: Generate the migration.** Run `pnpm --filter @workspace/db run generate --name sighting_photos`. Then add a backfill and a rollback to the end of the SQL:

```sql
--> statement-breakpoint
-- SYC-415: every existing sighting has exactly one photo, its first. One row
-- each, so every reader of sighting_photos sees all of a sighting's photos.
INSERT INTO "sighting_photos" ("sighting_id", "photo_id", "role", "position")
SELECT s."id", s."photo_id", 'first', 1
  FROM "sightings" s
  JOIN "photos" p ON p."id" = s."photo_id"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The boxes stay hidden until Claude (or Samuel) switches them on (plan Decision P1).
INSERT INTO "app_settings" ("key", "value") VALUES ('extra_photos_on', 'false'::jsonb)
ON CONFLICT ("key") DO NOTHING;
-- Roll the app back first: new code reads sighting_photos on every upload and
-- cat page. Rolling back forgets which photo was face or body; the cover
-- photos stay in sightings.photo_id, and extra photo rows stay in photos.
-- rollback-begin
-- DELETE FROM "app_settings" WHERE "key" = 'extra_photos_on';
-- ALTER TABLE "sighting_matches" DROP COLUMN "mixed_cats";
-- ALTER TABLE "sighting_matches" DROP COLUMN "no_cat_in_any_photo";
-- DROP TABLE "sighting_photos";
-- rollback-end
```

The join on `photos` skips sightings whose photo row is gone (`sightings.photo_id` has no foreign key, `sightings.ts` comment line 538). The `photo_uq` unique index would fail if two sightings shared one photo id. Check that first: `SELECT photo_id, count(*) FROM sightings GROUP BY 1 HAVING count(*) > 1` on the development branch. If any exist, change `ON CONFLICT DO NOTHING` to `ON CONFLICT ("photo_id") DO NOTHING` and note the count in the PR.

- [ ] **Step 3: Apply and check.** Run, in order:
  - `pnpm --filter @workspace/db run migrate`
  - `pnpm --filter @workspace/db test`, which proves the rollback;
  - `pnpm --filter @workspace/db run migrate:check`.

  Expected: all pass. Extend `dbOps.settings.test.ts` with `extra_photos_on` accepting `true` and refusing `"yes"`.

- [ ] **Step 4: Commit** — `git commit -m "SYC-415 PR2: sighting_photos table, match-record flags, extra_photos_on switch"`. Update the checkpoint.

### Task 2.2: The API contract

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (`CreateSightingRequest` near line 1160, `MatchResult` near line 1191, and the app-settings response schema)
- Regenerate: `pnpm --filter @workspace/api-spec run codegen`

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
      # ...existing properties unchanged...
        extraPhotos:
          type: array
          maxItems: 2
          items: { $ref: "#/components/schemas/ExtraPhoto" }
          description: >-
            Up to two extra photos of the same cat from the same visit
            (SYC-415). At most one face and one body. The first photo stays in
            photoBase64.
```

Under `POST /sightings` `400`, add the response body `{ error: string, photo?: "first" | "face" | "body" }`, where `photo` names the photo that failed. Add a `413` description: "The spot is too large; remove a photo and try again." Add `extraPhotos: { type: boolean }` (required) to the `GET /app-settings` response schema.

- [ ] **Step 2: Regenerate** and run `pnpm -w run typecheck`. Expected: it passes. `CreateSightingBody` now accepts `extraPhotos`. The app's generated `createSighting` type gains the optional field, and the app compiles unchanged.
- [ ] **Step 3: Commit** — `git commit -m "SYC-415 PR2: API contract for extra photos"`.

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

- [ ] **Step 1: Write the failing tests** (pure functions first, then one database test):

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
  it("refuses an extra identical to the first photo", () => {
    expect(spotPhotoList({ photoBase64: "A", extraPhotos: [{ role: "face", photoBase64: "A" }] }).ok).toBe(false);
  });
});
```

Then add a database test (`describe` with the repo's test database, as in `routes/sightings.upload.test.ts`). It checks that `saveSpotWithPhotos` with three validated photos produces:
  - one `sightings` row whose `photo_id` is the **face** photo's id;
  - three `sighting_photos` rows with positions 1, 2 and 3 and roles as sent.

A second case makes the third photo insert fail (pass a `ValidatedSpotPhoto` whose `role` is `"bogus"`, so the check constraint fails) and asserts **no** `sightings` row, **no** `sighting_photos` rows and **no** new `photos` rows exist for that device. This is the "saved together or not at all" guarantee.

- [ ] **Step 2: Run them and see them fail.** `cd artifacts/api-server && pnpm vitest run src/lib/spotPhotos.test.ts`.

- [ ] **Step 3: Implement.**

```ts
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
  const all = [body.photoBase64, ...extras.map((e) => e.photoBase64)];
  if (new Set(all).size !== all.length) {
    return { ok: false as const, error: "The same photo can only be used once in a spot." };
  }
  return {
    ok: true as const,
    photos: [{ role: "first" as const, photoBase64: body.photoBase64 }, ...extras],
  };
}

export async function validateSpotPhotos(photos: { role: SightingPhotoRole; photoBase64: string }[]) {
  const out: { role: SightingPhotoRole; buffer: Buffer; mime: string }[] = [];
  // One at a time: sharp and the HEIC fallback are memory-hungry (spec review F16).
  for (const p of photos) {
    const v = await validatePhotoBase64(p.photoBase64);
    if ("error" in v) return { ok: false as const, error: v.error, photo: p.role };
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

- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Mutation probe (a silent-failure guard).** Temporarily change `coverRole` to always return `"first"`, and confirm the "face photo when there is one" test **and** the database test (sighting `photo_id`) go red. Restore it. Then temporarily replace `db.transaction(async (tx) =>` with a non-transactional version (use `db` for `tx`), and confirm the rollback test goes red. Restore it. Note both probes in the commit message.
- [ ] **Step 6: Commit** — `git commit -m "SYC-415 PR2: cover rule, photo validation and one-transaction save (probes: cover, txn)"`.

### Task 2.4: The matcher sees all the spot's photos

**Files:**
- Modify: `artifacts/api-server/src/lib/matching.ts`
- Test: `artifacts/api-server/src/lib/matching.test.ts` (create it if absent). Mock `@workspace/integrations-openai-ai-server`'s `openai.chat.completions.create`.

**Interfaces — Produces:**

```ts
export interface NewPhotoInput { role: "first" | "face" | "body"; photoBase64: string; mime: string }
export interface MatchOutput {
  isCatPhoto: boolean;   // = anyCat, kept for every existing caller
  mixedCats: boolean;
  matches: { catId: number; confidence: number; reasoning: string }[];
}
export async function matchCatPhoto(newPhotos: NewPhotoInput[] | string, candidates: CandidateInput[]): Promise<MatchOutput>;
```

A plain `string` keeps working as one `first` photo, so existing callers and tests don't break.

- [ ] **Step 1: Write the failing tests.** They cover four things:
  - (a) with 3 new photos and 2 candidates, the request's `content` has **5** images: the 3 new photos first, in order, then the candidates. The prompt text names images 1–3 as "the same cat from different angles: first, face, body" and images 4–5 as the cat ids.
  - (b) the parsed reply `{"anyCat": true, "mixedCats": true, "matches": [...]}` gives `isCatPhoto: true, mixedCats: true`.
  - (c) an older-shaped reply `{"isCatPhoto": false, "matches": []}` gives `isCatPhoto: false, mixedCats: false`, so a model answering the old way doesn't break.
  - (d) passing a string still sends one new image.

- [ ] **Step 2: Run them and see them fail.**

- [ ] **Step 3: Implement.** Normalise the input with `const photos = typeof newPhotos === "string" ? [{ role: "first", photoBase64: newPhotos, mime: "image/jpeg" }] : newPhotos;`. Then build the prompt:

```ts
const n = photos.length;
const newDesc = n === 1
  ? `The FIRST image is a newly submitted photo.`
  : `The FIRST ${n} images are newly submitted photos that should all show the SAME cat from different angles (${photos.map((p, i) => `image ${i + 1} = ${p.role === "first" ? "first photo" : p.role === "face" ? "face close-up" : "whole body"}`).join(", ")}).`;
const known = candidates.map((c, i) => `image ${i + n + 1} = cat id ${c.catId} ("${c.name}")`).join(", ");
text:
  `You are an expert at identifying individual street cats by their coat pattern, colors, markings, face shape, eye color and other distinctive physical features.\n\n` +
  `${newDesc} The following ${candidates.length} images are known cats, in order: ${known}.\n\n` +
  `Tasks:\n1. Determine if ANY of the new photos contains a cat.\n` +
  (n > 1 ? `2. Determine if the new photos appear to show MORE THAN ONE different cat.\n` : ``) +
  `${n > 1 ? 3 : 2}. For each known cat, assess the likelihood (0.0-1.0) that it is the SAME individual cat as in the new photo${n > 1 ? "s" : ""}. Use every new photo together. Judge only by physical appearance; lighting, pose and background differ between photos.\n\n` +
  `Respond with ONLY valid JSON, no markdown: {"anyCat": boolean, "mixedCats": boolean, "matches": [{"catId": number, "confidence": number, "reasoning": "one short sentence"}]}. Include every known cat in "matches". If there are no known cats, return an empty matches array.`
```

Images: `...photos.map((p) => ({ type: "image_url", image_url: { url: \`data:${p.mime};base64,${p.photoBase64}\` } }))`, then the candidates. Parse as follows:
  - `isCatPhoto: typeof parsed.anyCat === "boolean" ? parsed.anyCat : !!parsed.isCatPhoto`
  - `mixedCats: n > 1 && parsed.mixedCats === true`

- [ ] **Step 4: Run them and see them pass.** Commit: `git commit -m "SYC-415 PR2: matcher compares all of a spot's photos, reports any-cat and mixed-cats"`.

### Task 2.5: The upload route

**Files:**
- Modify: `artifacts/api-server/src/routes/sightings.ts`:
  - POST `/sightings` (line 440), with the new path replacing lines 568–599;
  - `computeMatchCandidates` (line 241);
  - the dedupe hit (line 532);
  - `recordMatch` (line 351).
- Test: `artifacts/api-server/src/routes/sightings.extraPhotos.test.ts` (new). The existing `sightings.upload.test.ts`, `sightings.dedupe.test.ts`, `sightings.matchRecord.test.ts` and `sightings.aiLimiter.test.ts` must stay green unchanged.

**Interfaces:**
- Consumes: `spotPhotoList`, `validateSpotPhotos` and `saveSpotWithPhotos` (2.3), and `matchCatPhoto` (2.4).
- Produces:
  - `computeMatchCandidates(req, sightingId, photos: NewPhotoInput[], lat, lng)`;
  - `recordMatch` sets, which gain `noCatInAnyPhoto: boolean | null` and `mixedCats: boolean | null`.

- [ ] **Step 1: Write the failing route tests.** Mock `../lib/matching` the way `sightings.upload.test.ts` does, with a `vi.fn` so each test can set its answer. Make real small JPEGs with `sharp` (three different colours, so they differ). The cases:
  1. **Three photos are saved together.** A POST with `photoBase64` plus face and body extras returns 201. The database then has one sighting with `photo_id` = the face photo, and three `sighting_photos` rows in positions 1–3 with roles first/face/body. The matcher mock was called with 3 new photos, in that order.
  2. **One photo means no change.** A POST without `extraPhotos` saves one `sighting_photos` row (`first`). `photo_id` is that photo, and the matcher was called with one photo.
  3. **A bad extra saves nothing.** With the face extra set to `"not-base64!!"`, the response is 400 with `{ error: <message>, photo: "face" }`. There are no new rows in `sightings`, `photos` or `sighting_photos` for that device.
  4. **Duplicate roles are refused.** The response is 400, and nothing is saved.
  5. **A repeat matches all photos.** Send case 1 twice with the same `capturedAt`. The second gets the same `sightingId`, with no new rows. The matcher's second call has 3 new photos, in position order.
  6. **The match record.** If the matcher answers `isCatPhoto: false`, the stored `sighting_matches.no_cat_in_any_photo` is `true` and the response has `isCatPhoto: false`. If it answers `mixedCats: true`, `mixed_cats` is `true`. If the matcher throws, both are `null` and `matcher_failed` is `true`. Every photo is still saved and the response is 201.
  7. **It counts once.** A three-photo POST increases the device's match-limit count by exactly 1 (read the counter the way `sightings.aiLimiter.test.ts` does).
  8. **No hidden location data.** For each stored photo of case 1, `sharp(buffer).metadata()` has no `exif`. Make the test JPEGs **with** EXIF GPS: `sharp(...).withExif({ IFD0: {...}, GPS: {...} })`, or whatever the existing EXIF test in `routes/photoVisibility.test.ts` or `imageValidation` tests uses.

- [ ] **Step 2: Run them and see them fail.** `pnpm vitest run src/routes/sightings.extraPhotos.test.ts`.

- [ ] **Step 3: Implement the POST path.** Replace lines 568–599 with:

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

The dedupe lookup keeps its place **before** validation (it already sits before validation at line 532). That's correct: a retry of an already-saved spot needs no re-validation.

- [ ] **Step 4: Implement the dedupe hit.** Replace the single-photo load (lines 533–556) with a load of the spot's photos in position order:

```ts
    const rows = await db
      .select({ role: sightingPhotosTable.role, data: photosTable.data, mime: photosTable.mime })
      .from(sightingPhotosTable)
      .innerJoin(photosTable, eq(photosTable.id, sightingPhotosTable.photoId))
      .where(eq(sightingPhotosTable.sightingId, existing.id))
      .orderBy(asc(sightingPhotosTable.position));
    const photos = rows.map((r) => ({ role: r.role as SightingPhotoRole, photoBase64: r.data, mime: r.mime }));
```

Then use `photos.length ? await computeMatchCandidates(req, existing.id, photos, existing.lat, existing.lng) : { isCatPhoto: true, candidates: [] }`. Keep the existing "no photo" `recordMatch` branch for `photos.length === 0`.

- [ ] **Step 5: Implement `computeMatchCandidates` and `recordMatch`.**
  - Change the third parameter to `photos: NewPhotoInput[]`, and call `matchCatPhoto(photos, candidateInputs)`.
  - Keep `let mixedCats = false`, set from `result.mixedCats`.
  - Pass `noCatInAnyPhoto: matcherFailed ? null : !isCatPhoto` and `mixedCats: matcherFailed ? null : mixedCats` to `recordMatch`.
  - Widen `recordMatch`'s `sets` type with the two fields.

- [ ] **Step 6: Run everything.** Run the new test file, then the whole api-server suite: `cd artifacts/api-server && pnpm vitest run`. Expected: all green, including the untouched upload, dedupe, matchRecord and aiLimiter suites.
- [ ] **Step 7: Mutation probe.** Make the dedupe hit pass only `photos.slice(0, 1)`, and confirm case 5 goes red. Restore it.
- [ ] **Step 8: Commit** — `git commit -m "SYC-415 PR2: upload takes up to two extra photos, saved together, all matched (probe: dedupe)"`.

### Task 2.6: The switch in `/app-settings`

**Files:**
- Modify: `artifacts/api-server/src/lib/appSettings.ts` (`AppSettings.extraPhotosOn`, read key `extra_photos_on`, default `false`) and `artifacts/api-server/src/routes/appSettings.ts:17` (`extraPhotos: settings.extraPhotosOn`)
- Test: `artifacts/api-server/src/routes/appSettings.test.ts` (extend)

- [ ] **Step 1: Write the failing test.** It checks four things:
  - with no row, `GET /api/app-settings` has `extraPhotos: false`;
  - after inserting `extra_photos_on = true`, it's `true`, after calling `_resetAppSettingsCacheForTests()`;
  - a wrong shape (`"yes"`) gives `false`;
  - **the POST route accepts `extraPhotos` whatever the switch says.** The switch only hides the boxes. A phone that sent extras while the switch was on, then synced after it went off, must not lose them.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.** In `settingsFromRows`, add `const extraPhotosOn = read<boolean>("extra_photos_on", false, (v) => v as boolean);` and return it. In the route, add `extraPhotos: settings.extraPhotosOn`.
- [ ] **Step 4: Run it and see it pass.** Commit: `git commit -m "SYC-415 PR2: extra_photos_on switch in /app-settings"`.
- [ ] **Step 5: Open PR 2.** Run the adversarial review in its own worktree, apply its findings, CI green, then the merge waits for Samuel. After merge, deploy per the `replit-publish` skill. Confirm `/api/healthz` shows the new commit (memory note `confirm-live-build-before-smoke`). Probe `GET /api/app-settings`, which must show `extraPhotos: false`, and send one ordinary one-photo spot on the test site, after a one-line heads-up to Samuel that it creates a test sighting.

---

## PR 3 — extra photos show everywhere (server, plus the cat page in the app)

Branch `claude/syc-415-pr3-extra-photo-readers` off fresh `origin/main`, after PR 2 is merged.

### Task 3.1: Who may hide, restore or report an extra photo

**Files:**
- Modify: `artifacts/api-server/src/lib/capabilityTargets.ts:50-75`
- Test: `artifacts/api-server/src/lib/capabilityTargets.extraPhotos.test.ts`

- [ ] **Step 1: Write the failing test.** Use `test/roleKit.ts` and `test/feedingSites.ts` to set up two colonies, each with a cat guardian and one cat. Insert a resolved sighting of cat A with a face extra (via `saveSpotWithPhotos`, then resolve it as the existing tests do). Assert:
  - `catsOfPhoto(faceExtraPublicId)` returns `[catA]`;
  - `photoTargets(faceExtraPublicId)` gives colony A's target;
  - through the real hide route (`routes/photoVisibility.ts`, the same path `photoVisibility.test.ts` uses), guardian A **can** hide the extra and guardian B gets **403**;
  - a report about the extra (`routes/reports.ts`) resolves to cat A.
- [ ] **Step 2: Run it and see it fail.** `catsOfPhoto` returns `[]`, so the target falls back to `{colonyId: null}`.
- [ ] **Step 3: Implement.** Add a fourth query to the `Promise.all` in `catsOfPhoto`:

```ts
    db
      .select({ catId: sightingsTable.catId })
      .from(sightingPhotosTable)
      .innerJoin(sightingsTable, eq(sightingsTable.id, sightingPhotosTable.sightingId))
      .where(and(eq(sightingPhotosTable.photoId, photo.id), isNotNull(sightingsTable.catId))),
```

Spread it into the returned list, and dedupe with `[...new Set(...)]`. A cover photo is found twice (through `sightings.photo_id` and `sighting_photos`), and duplicate cat ids would double the targets.
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Mutation probe.** Remove the new query, and confirm the guardian-A test goes red. Restore it.
- [ ] **Step 6: Commit** — `git commit -m "SYC-415 PR3: hide/restore/report reach extra photos, colony-scoped (probe)"`.

### Task 3.2: The public cat page payload

**Files:**
- Modify:
  - `artifacts/api-server/src/routes/cats.ts:251-336`;
  - `artifacts/api-server/src/lib/catHelpers.ts:230` (`serialiseSighting`, `PublicSighting`);
  - `lib/api-spec/openapi.yaml` (`PublicSighting.extraPhotos`, then codegen);
  - `artifacts/api-server/src/lib/catalogue.ts:17` (cache key bump).
- Test: `artifacts/api-server/src/routes/cats.extraPhotos.test.ts`

**Interfaces — Produces:** `PublicSighting.extraPhotos: { role: "first" | "face" | "body"; photoUrl: PublicPhotoUrl | null }[]`. These are the sighting's photos **other than** its cover, in position order. Empty for a one-photo sighting. `photoUrl` is null when hidden.

- [ ] **Step 1: Write the failing test.** Take a resolved three-photo sighting of a cat, with a face extra. `GET /api/cats/:id` then returns:
  - that sighting's `photoUrl` = the face photo;
  - `extraPhotos` = `[{role:"first", photoUrl:…}, {role:"body", photoUrl:…}]`.

  Hide the body photo, and its `photoUrl` becomes `null` while the others stay. A one-photo sighting has `extraPhotos: []`. A **pending** sighting's extra photo URL is never in any payload: list the cat and the catalogue and search for the public id.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.** After the `sightings` query, load every `sighting_photos` row for those sighting ids, joined to `photos` for `public_id`, in one query (no N+1, per the comment at `cats.ts:246`). Group by sighting, and drop the cover (`photoId === sighting.photoId`). Add every extra photo id to the `hiddenPhotoIds(...)` call so one batched lookup covers all. Build each URL with `publicPhotoUrl({id, publicId}, hidden)`. Add `extraPhotos` to `serialiseSighting`'s input and output. Bump the catalogue cache key constant so phones refetch.
- [ ] **Step 4: Run it, plus `cats.publicDetail.test.ts` and `publicPayload.*.test.ts`.** Expected: green. Update their snapshot or shape expectations only where they list the sighting fields, adding `extraPhotos: []`.
- [ ] **Step 5: Commit** — `git commit -m "SYC-415 PR3: public cat page lists each sighting's extra photos"`.

### Task 3.3: The team's cat page, plus comments at the readers that stay as they are

**Files:**
- Modify: `artifacts/api-server/src/lib/teamCatView.ts:660-850`
- Comment-only: `artifacts/api-server/src/lib/photoVisibility.ts:149` and `artifacts/api-server/src/lib/coatReading/due.ts` (near line 196)
- Test: `artifacts/api-server/src/routes/team.photos.test.ts` (extend)

- [ ] **Step 1: Write the failing test.** For a cat with a three-photo sighting:
  - the team cat view's `photos` gallery includes all three photo URLs, each once;
  - each entry in `sightings[]` has `extraPhotos: [{role, photoUrl}]` like the public one, but with team photo URLs;
  - a hidden extra shows with its hidden label, as hidden cover photos already do.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.** Load the `sighting_photos` rows for the cat's sightings. Add their photo ids to `galleryIds`, after each sighting's cover and before statements, keeping the "once each" `Set`. Add `extraPhotos` to each sighting in the returned object, using `urlFor`. Above `photoVisibility.ts:149` add `// SYC-415 spec §6.3: the stand-in uses cover photos only; an extra photo is never promoted automatically.`, and similar wording in `coatReading/due.ts`.
- [ ] **Step 3b: The "more than one cat" flag (spec §4.5).**
  - In the team's cat view, each sighting also carries `mixedCats: boolean` from `sighting_matches.mixed_cats` (left join; `false` when there's no record).
  - Test in `team.photos.test.ts`: a sighting whose match record says `mixed_cats = true` shows `mixedCats: true`.
  - The team's cat page shows it as a small "May show more than one cat" chip next to that sighting's photos. Find the component that renders the team view's `sightings[]` in `artifacts/cat-spotter` (team screens) and add the chip, with an en, el and fr string `mayBeMoreThanOneCat`.
- [ ] **Step 4: Run it, and all `team.*.test.ts`.** Expected: green.
- [ ] **Step 5: Commit** — `git commit -m "SYC-415 PR3: team cat page shows extra photos with their role, and the mixed-cats flag"`.

### Task 3.4: The cat page in the app shows thumbnails

**Files:**
- Modify: `artifacts/cat-spotter/app/cat/[id].tsx`, where it renders `sightings` (find `photoUrl` in that file).
- Modify: `artifacts/cat-spotter/lib/i18n.ts` — `extraPhotoFaceLabel: 'Face photo'` and `extraPhotoBodyLabel: 'Whole body photo'` (and `extraPhotoFirstLabel: 'Photo'`), in en, el and fr.
- Test: a component test next to whichever component renders a sighting row (look in `components/` for the sighting list item; if it's inline in `[id].tsx`, extract it to `components/SightingPhotos.tsx` first, then test that).

- [ ] **Step 1: Write the failing test.** A sighting with two `extraPhotos` (one hidden, `photoUrl: null`) renders:
  - the cover photo;
  - **one** thumbnail, for the visible extra, with `accessibilityLabel` "Whole body photo";
  - **no** tile for the hidden one.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.** Up to two 48×48 thumbnails to the right of the cover photo, 44pt tap target. Tapping opens the same full-size viewer the cover photo uses (find it in the file and reuse it).
- [ ] **Step 4: Run it, then the whole app suite.** Check in the browser at 390px and desktop, light and dark, with a planted three-photo sighting on the local scratch database (memory note `local-preview-with-planted-link` describes the local preview setup).
- [ ] **Step 5: Commit, then open PR 3.** Run the adversarial review in its own worktree, CI green, merge waits for Samuel, deploy, confirm the live build. Probe `GET /api/cats/<id>` on the live site: every sighting has `extraPhotos: []`.

---

## PR 4 — the extra-photo boxes (app)

Branch `claude/syc-415-pr4-extra-photo-boxes` off fresh `origin/main`, after PR 3 is merged. It can be built in parallel with PR 3, but it must not merge before PR 3 is live.

### Task 4.1: The pure rules

**Files:**
- Create: `artifacts/cat-spotter/lib/extraPhotos.ts`
- Test: `artifacts/cat-spotter/lib/__tests__/extraPhotos.test.ts`

**Interfaces — Produces:**

```ts
export type ExtraRole = 'face' | 'body';
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
): { kept: Partial<Record<ExtraRole, SpotPhoto>>; removed: { role: ExtraRole; takenAtMs: number }[] };
export function fitsRequestBudget(firstBase64: string, extrasBase64: string[]): boolean;
```

`takenAtMs` is the photo's time. For a camera photo, it's when it was taken (`Date.now()` at capture, per spec §4.3). For a library photo, it's `timeInfo.instantMs` when `timeInfo.kind === 'ok'`, otherwise `null`. A **camera** photo's fingerprint is computed with `photoFingerprint(base64)` too, so camera photos also take part in the "same photo" checks (spec review F10).

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
  it('refuses the first photo again, or the other box\'s photo', () => {
    expect(checkExtraCandidate({ candidate: p('first', T), first, otherExtra: undefined, alreadyLogged: false, tooOld: null })).toEqual({ kind: 'duplicate' });
    expect(checkExtraCandidate({ candidate: p('b', T), first, otherExtra: p('b', T), alreadyLogged: false, tooOld: null })).toEqual({ kind: 'duplicate' });
  });
  it('refuses an already-logged, too-old, or different-visit photo, in that order', () => {
    expect(checkExtraCandidate({ candidate: p('c', T), first, otherExtra: undefined, alreadyLogged: true, tooOld: null })).toEqual({ kind: 'alreadyLogged' });
    expect(checkExtraCandidate({ candidate: p('c', T), first, otherExtra: undefined, alreadyLogged: false, tooOld: { instantMs: 1 } })).toEqual({ kind: 'tooOld', instantMs: 1 });
    const later = T + SAME_VISIT_MS + 60_000;
    expect(checkExtraCandidate({ candidate: p('c', later), first, otherExtra: undefined, alreadyLogged: false, tooOld: null })).toEqual({ kind: 'differentVisit', takenAtMs: later });
  });
  it('catches a library first photo from days ago with a camera extra taken now (review F9)', () => {
    const libraryFirst = p('first', T - 3 * 86_400_000);
    expect(checkExtraCandidate({ candidate: p('cam', T), first: libraryFirst, otherExtra: undefined, alreadyLogged: false, tooOld: null })?.kind).toBe('differentVisit');
  });
  it('accepts a good photo', () => {
    expect(checkExtraCandidate({ candidate: p('c', T + 60_000), first, otherExtra: undefined, alreadyLogged: false, tooOld: null })).toBeNull();
  });
});

describe('recheckAfterRetake', () => {
  it('keeps extras that still fit and removes ones that no longer do', () => {
    const newFirst = p('n', T + 5 * 3_600_000);
    const r = recheckAfterRetake(newFirst, { face: p('f', T), body: p('b', T + 4.5 * 3_600_000) });
    expect(Object.keys(r.kept)).toEqual(['body']);
    expect(r.removed).toEqual([{ role: 'face', takenAtMs: T }]);
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
- [ ] **Step 3: Implement.** The functions are small. `checkExtraCandidate` checks in this order: duplicate (fingerprint equals `first` or `otherExtra`), `alreadyLogged`, `tooOld`, `!withinSameVisit(first.takenAtMs, candidate.takenAtMs)`, then `null`. `recheckAfterRetake` filters each extra through `withinSameVisit` with the new first photo, and also drops an extra whose fingerprint equals the new first's. `fitsRequestBudget` sums the lengths and compares them with `REQUEST_BUDGET_BASE64_CHARS`.
- [ ] **Step 4: Run them and see them pass.** Commit: `git commit -m "SYC-415 PR4: extra-photo rules (cover, same visit, duplicates, budget)"`.

### Task 4.2: Preparing an extra photo

**Files:**
- Create: `artifacts/cat-spotter/lib/prepareExtraPhoto.ts`
- Test: `artifacts/cat-spotter/lib/__tests__/prepareExtraPhoto.test.ts`, mocking `expo-image-manipulator` as `lib/__tests__/photoUpload.test.ts` does (if present; otherwise `vi.mock('expo-image-manipulator', ...)`).

**Interfaces — Produces:** `prepareExtraPhoto(uri: string): Promise<{ uri: string; base64: string } | null>`.

- [ ] **Step 1: Write the failing tests.** The manipulator is called with `[{ resize: { width: 2048 } }]` for a landscape photo and `[{ resize: { height: 2048 } }]` for a portrait one, using `{ compress: 0.8, format: JPEG, base64: true }`. A photo already smaller than 2048 isn't enlarged: no resize action, just the re-encode. A thrown error returns `null`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** First get the size with `ImageManipulator.manipulateAsync(uri, [], {})`, which returns `width`/`height` (or use `Image.getSize`). Choose the resize, and return `{ uri: result.uri, base64: result.base64 }`. Wrap it in try/catch and return `null` on failure. This is what makes "refuse at pick time" possible (spec §4.3, §6.1): an iPhone HEIC photo the web build can't decode returns `null`.
- [ ] **Step 4: Run them and see them pass.** Commit.

### Task 4.3: Payloads, the queue item, and reading old queues

**Files:**
- Modify: `artifacts/cat-spotter/lib/sightingPayload.ts`, `artifacts/cat-spotter/lib/offlineQueue.ts:15-52` and `artifacts/cat-spotter/lib/queueStore.ts:159`
- Test: extend `lib/__tests__/sightingPayload.test.ts` (it holds the payloads to their exact fields, per SYC-166 spec §9 tests 6a and 6b) and `lib/__tests__/queueStore.test.ts`.

**Interfaces — Produces:**
- `sightingRequest({ ..., extraPhotos?: { role: ExtraRole; photoBase64: string }[] })`, which adds `extraPhotos` **only when non-empty**, so a one-photo request is byte-for-byte what it was.
- `queuedSighting({ ..., extras?: { role: ExtraRole; uri: string; base64: string }[] })`, which adds `extraPhotos: [{ role, photoUri: uri, photoBase64: base64 }]` only when non-empty.
- `PendingSighting.extraPhotos?: { role: ExtraRole; photoUri: string; photoBase64?: string }[]`
- `PendingSighting.extraNote?: 'extraMissing'`

- [ ] **Step 1: Write the failing tests.**
  - **sightingPayload:** with no extras, the existing exact-fields assertion still holds (no `extraPhotos` key). With one face extra, `extraPhotos` equals `[{ role: 'face', photoBase64: 'F' }]`.
  - **queueStore:** `parseQueue` of a stored list with an item carrying `extraPhotos: [{ role: 'face', photoUri: 'p' }]` keeps it. An item with `extraPhotos: [{ role: 'tail', photoUri: 'p' }]` or a non-array has `extraPhotos` dropped, but the item itself is **kept** (a bad extra never loses a good spot). A pre-SYC-415 item with no field parses unchanged.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** In `parseQueue`'s per-item cleaner (find where it validates `photoUri`), add:

```ts
if (Array.isArray(v.extraPhotos)) {
  const extras = v.extraPhotos.filter(
    (e: any) => e && (e.role === 'face' || e.role === 'body') && typeof e.photoUri === 'string',
  ).map((e: any) => ({ role: e.role, photoUri: e.photoUri, ...(typeof e.photoBase64 === 'string' ? { photoBase64: e.photoBase64 } : {}) }));
  if (extras.length) item.extraPhotos = extras;
}
if (v.extraNote === 'extraMissing') item.extraNote = 'extraMissing';
```

- [ ] **Step 4: Run them and see them pass.** Commit: `git commit -m "SYC-415 PR4: payload and queue item carry extra photos; old queues read unchanged"`.

### Task 4.4: The offline queue keeps, sends and cleans up every photo

**Files:**
- Modify: `artifacts/cat-spotter/context/OfflineContext.tsx`:
  - the keep list, lines 257–262;
  - `syncOne`, around lines 345–420;
  - `enqueue`, around lines 593–616;
  - `remove` and `replacePhoto`, around line 600 onwards;
  - plus a new `removeExtraPhoto(localId, role)` and `replaceExtraPhoto(localId, role, photo)`.
- Modify: `artifacts/cat-spotter/lib/photoRejection.ts`
- Test: `artifacts/cat-spotter/context/__tests__/OfflineContext.extraPhotos.test.tsx` (follow the setup of the existing `OfflineContext` tests in that folder, with the photo store adapter from `setPhotoStoreAdapterForTests`), plus `lib/__tests__/photoRejection.test.ts`.

**Interfaces — Produces:**
- `photoRejectionKey(err)` stays as it is. Add `rejectedPhotoRole(err): 'first' | 'face' | 'body' | null`, which reads `data.photo` on a 400.
- `photoRejectionKey` also maps **413** to `'spotTooLarge'`, a new i18n key (*"This spot is too large to send. Remove a photo and try again."*), so a 413 is a fixable rejection, never an endless failure.

- [ ] **Step 1: Write the failing tests.** These are silent-failure guards, so each one gets a mutation probe in Step 5.
  1. **The tidy-up keeps extras.** Enqueue a three-photo spot. Move the clock 25 hours on and run the orphan cleanup the context runs. All three stored photo refs still exist.
  2. **It sends all of them.** Go online and sync. `createSighting` is called with `extraPhotos` of length 2, in roles face and body, read from the store.
  3. **A missing extra doesn't block the spot.** Delete the face extra's stored file, then sync. The spot sends with only the body extra, and the item, now in review, carries `extraNote: 'extraMissing'`.
  4. **A missing first photo behaves as it does for any spot.** The item goes to `error`/`cleared`, the same as today's single-photo test.
  5. **A refused extra can be fixed.** The server returns 400 `{ error: 'Image could not be decoded: file appears corrupt', photo: 'face' }`. The item is `rejected` with `rejectionKey: 'photoInvalid'` and `rejectedRole: 'face'`. `removeExtraPhoto(localId, 'face')` puts it back to `queued` without the face photo, and the next sync sends.
  6. **A too-large spot can be fixed.** The server returns 413, giving `rejected` with `rejectionKey: 'spotTooLarge'`.
  7. **Removing deletes everything.** `remove(localId)` deletes all three stored photos.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - **Keep list:** `.flatMap((p) => [...(p.photoBase64 ? [p.photoUri, \`idb:${p.localId}\`] : [p.photoUri]), ...(p.extraPhotos ?? []).map((e) => e.photoUri)])`.
  - **enqueue:** after saving the first photo, save each extra with `savePendingPhoto(\`${item.localId}-${e.role}\`, e.photoUri, e.photoBase64)`. If a save fails, keep that extra inline (`photoBase64` set), the same rule as the first photo. Put `extraPhotos` with the stored refs on `stored`.
  - **syncOne:** after loading the first photo, load each extra with `readPendingPhoto(e.photoUri)` (or its inline base64). A `missing` or `error` extra is skipped, and `extraNote = 'extraMissing'` is set when the item is marked for review. Pass `extraPhotos` to `createSighting`. On `photoRejectionKey(err)`, also store `rejectedRole: rejectedPhotoRole(err) ?? 'first'` (add `rejectedRole?: 'first' | 'face' | 'body'` to `PendingSighting`, and to `parseQueue` in Task 4.3's style).
  - **remove:** delete `photoUri` and every `extraPhotos[].photoUri`.
  - **removeExtraPhoto / replaceExtraPhoto:** mutate the item's `extraPhotos`, delete or replace that stored file (replace uses `replacementPhotoKey(localId, currentRef)`), and set `status: 'queued'`, clearing `rejectionKey`/`rejectedRole` when the rejected photo was that one.
  - Add `spotTooLarge` to i18n (en, el, fr). In `photoRejection.ts`, add `if (apiError.status === 413) return 'spotTooLarge';` before the 400 check, and `export function rejectedPhotoRole(err)`.
- [ ] **Step 4: Run them and see them pass.** Then run the whole app suite.
- [ ] **Step 5: Mutation probes.**
  - Remove the extras from the keep list, and confirm test 1 goes red.
  - Make `remove` delete only `photoUri`, and confirm test 7 goes red.
  - Make a missing extra fail the item, and confirm test 3 goes red.

  Restore each one, and name the probes in the commit message.
- [ ] **Step 6: Commit** — `git commit -m "SYC-415 PR4: offline queue keeps, sends and cleans every photo; per-photo fix (probes: sweep, remove, missing)"`.

### Task 4.5: "Already logged" covers every photo

**Files:**
- Modify: `artifacts/cat-spotter/lib/recentPhotos.ts`:
  - `RecentPhoto.extraFingerprints?: string[]`;
  - `clean`;
  - `entryForOutcome`, with a new 5th parameter `extraFingerprints: string[] = []`;
  - `findAlreadyLogged`, which also matches `e.extraFingerprints?.includes(fingerprint)`.
- Test: extend `lib/__tests__/recentPhotos.test.ts`.

- [ ] **Step 1: Write the failing tests.**
  - `entryForOutcome('sent', t, 'F1', {sightingId: 9, isCatPhoto: true}, ['F2','F3'])` has `extraFingerprints: ['F2','F3']`.
  - With `isCatPhoto: false`, there are no fingerprints at all, the same rule as the first photo (review M5).
  - `findAlreadyLogged('F3', [thatEntry], new Set())` returns the entry.
  - `clean` drops a non-string-array `extraFingerprints`.
- [ ] **Step 2: Run them, implement, run them again, commit:** `git commit -m "SYC-415 PR4: already-logged covers extra photos"`.

### Task 4.6: The boxes, and wiring them into the Spot screen

**Files:**
- Create: `artifacts/cat-spotter/components/ExtraPhotoBoxes.tsx`
- Modify:
  - `artifacts/cat-spotter/app/(tabs)/spot.tsx` (state near line 157, `clearPhoto` line 278, `pickPhoto` line 350, under `NewSpotIntro` in the "New spot" state, and `submit` line 547);
  - `artifacts/cat-spotter/app/review.tsx`, where a queued item's photo is found through the queue: use the cover photo;
  - `artifacts/cat-spotter/lib/appSettings.ts` and `artifacts/cat-spotter/context/AppSettingsContext.tsx` (`extraPhotosOn`);
  - `artifacts/cat-spotter/lib/i18n.ts`.
- Test: `artifacts/cat-spotter/components/__tests__/ExtraPhotoBoxes.test.tsx`, extend `lib/__tests__/appSettings.test.ts`, and a source test in the `spotRetake.test.ts` style.

**Interfaces:**
- Consumes: 4.1–4.5, `FaceCartoon`/`BodyCartoon` (1.2).
- Produces:

```ts
ExtraPhotoBoxes: (props: {
  extras: Partial<Record<ExtraRole, { uri: string }>>;
  onAdd: (role: ExtraRole, from: 'camera' | 'library') => void;
  onRemove: (role: ExtraRole) => void;
  disabled?: boolean;
}) => JSX.Element
```

- i18n keys:
  - `extraPhotosLine`: *"Got the face and the whole body? Add them so we can tell this cat apart. Same cat only."*
  - `addFace`: "Add the face"; `addBody`: "Add the whole body"
  - `addFaceA11y`: "Add the face photo, optional"; `addBodyA11y`: "Add the whole body photo, optional"
  - `faceAddedA11y`: "Face photo added. Double-tap to replace."; `bodyAddedA11y`: "Whole body photo added. Double-tap to replace."
  - `removePhoto`: "Remove"
  - `takeAPhoto`: "Take a photo"; `chooseFromPhotos`: "Choose from your photos"
  - `extraDifferentVisit`: *"This photo was taken at a different time ({{when}}). Photos in one spot need to be from the same visit. Choose another photo."*
  - `extraRemovedAfterRetake`: *"Your {{which}} photo was from a different time, so we took it out."*
  - `extraDuplicate`: *"You've already used this photo in this spot."*
  - `extraTooLarge`: *"This photo is too large to add here. Try taking one instead."*
  - `extraMissingNote`: *"One of your photos couldn't be found, so we sent the others."*

  All in en, el and fr. Reuse the existing already-logged and 21-day messages for those two cases.

- [ ] **Step 1: Write the failing tests.**
  - **ExtraPhotoBoxes:** two empty boxes, labelled "Add the face" and "Add the whole body", each with the right `accessibilityLabel`. Pressing one shows two options, and pressing "Choose from your photos" calls `onAdd('face','library')`. A filled box shows the image, an `accessibilityLabel` of "Face photo added…", and a Remove button calling `onRemove('face')`. The box and the Remove button each measure ≥ 44pt (check `style` min sizes).
  - **appSettings:** `settingsFromResponse({ feedNudge: null, hiddenFacts: [], extraPhotos: true })` gives `settings.extraPhotosOn: true`. A missing field gives `false`.
  - **Source test on `spot.tsx`:**
    - (a) `<ExtraPhotoBoxes` renders only when `matchWaitSettings.extraPhotosOn`;
    - (b) `clearPhoto` (full reset) clears `extras`, but the **retake** path calls `recheckAfterRetake`;
    - (c) `submit` passes `extraPhotos` to `sightingRequest` and `extras` to `queuedSighting`;
    - (d) the result-screen photo is saved from the **cover**: `coverRole(extras) === 'face' ? extras.face : photo`;
    - (e) `entryForOutcome` gets the extras' fingerprints.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement `ExtraPhotoBoxes`.**
  - A `View` (`gap: spacing[2]`) holds the `extraPhotosLine` text, then a row of two `Pressable` boxes, each `flex: 1`, `minHeight: 112`, `borderStyle: 'dashed'`, `borderWidth: 2`, `borderColor: colors.primary`, radius 14.
  - An empty box shows the cartoon at 56, plus "＋ " and the label.
  - A filled box shows an `Image` (cover-fit), with a Remove `Pressable` (min 44×44) in its corner.
  - Choosing camera or library uses the repo's `confirmChoice` helper with two options, or an action sheet if `confirmChoice` only does yes/no. Check `lib/` for an existing chooser before writing one.
- [ ] **Step 4: Wire it into `spot.tsx`.**
  - Add `const [extras, setExtras] = useState<Partial<Record<ExtraRole, SpotPhoto>>>({});`.
  - Keep a `firstSpotPhoto` built from `photo`, `photoFingerprintRef` (now always set, for camera photos too: `photoFingerprint(photo.base64)`) and `takenAtMs`.
  - `takenAtMs` is `timeInfo.kind === 'ok' ? timeInfo.instantMs : fromCamera ? Date.now() : null`. Add it as state next to `capturedAt`.
  - **Add an extra (`addExtra(role, from)`):**
    - `choosePhoto(from === 'camera')` (the existing function; the camera path is the system camera);
    - then `prepareExtraPhoto(picked.photo.uri)`, which on `null` gives `extraTooLarge`;
    - then `findAlreadyLogged(fingerprint, …)` (as `pickPhoto` does);
    - then `checkExtraCandidate(...)`;
    - then `fitsRequestBudget(photo.base64, [...other extras, prepared].map(b => b.base64))`, which on false gives `extraTooLarge`;
    - then `setExtras`.
  - Show problems with `notify(...)`, formatting `{{when}}` the way the existing tooOld message formats its date.
  - **The Retake button** (`NewSpotIntro onRetake`): today it calls `clearPhoto`. Split it into two:
    - `clearPhoto()`, a full reset that also clears `extras`, used by the header back chevron near line 990;
    - `retakeFirstPhoto()`, which clears only the first photo's state.
  - **When a new first photo is picked while `extras` is non-empty,** run `recheckAfterRetake`, `setExtras(kept)`, and `notify(t('extraRemovedAfterRetake', ...))` for each removed one.
  - Render `<ExtraPhotoBoxes>` under `<NewSpotIntro>` when `matchWaitSettings.extraPhotosOn`.
  - **submit:**
    - `extraPhotos = (['face','body'] as const).flatMap(r => extras[r] ? [{ role: r, photoBase64: extras[r]!.base64 }] : [])`;
    - pass that into `sightingRequest`, and the `extras` uri+base64 list into `queuedSighting`;
    - pass `Object.values(extras).map(e => e.fingerprint)` to `entryForOutcome`;
    - save the review photo from the cover;
    - on `outcome.kind === 'rejected'`, if `rejectedPhotoRole(err)` is face or body, say which photo failed using `t(rejectionKey)` plus the role label, and keep everything on screen so the spotter can remove it;
    - after a send, `clearPhoto()` also clears `extras`.
  - The constrained-network optimiser (line 574) still runs on the first photo only. Extras are already prepared.
- [ ] **Step 5: Wire it into `review.tsx`.** For a queued item, the photo shown is `item.extraPhotos?.find(e => e.role === 'face')?.photoUri ?? item.photoUri`. Show the `extraMissingNote` line when `item.extraNote === 'extraMissing'`.
- [ ] **Step 6: Wire in the app settings.** Add `extraPhotosOn: boolean` to the settings type, `emptySettingsState` (`false`), `settingsFromResponse` (`res.extraPhotos === true`) and the stored-settings validator in `lib/appSettings.ts` (near line 70).
- [ ] **Step 7: Run the tests, then the whole app suite and typecheck.** Expected: all green.
- [ ] **Step 8: Check it in the browser.** Local web preview against a local API with `extra_photos_on = true` in the local database. At 390×844 and desktop, in light and dark:
  - add a face and a body photo from the library;
  - retake the first photo (extras stay);
  - pick a photo more than 2 hours from the first (refused, with the message);
  - remove an extra;
  - send, and the result screen shows the face photo;
  - go offline and save a three-photo spot, back online, and it sends;
  - with the switch **off**, no boxes.

  Take screenshots for the PR. Check with VoiceOver or TalkBack, or the web screen reader, that the boxes are announced.
- [ ] **Step 9: Commit, then open PR 4.** Run the adversarial review in its own worktree, CI green, merge waits for Samuel, deploy, confirm the live build.

### Task 4.7: Switch on (after PRs 2–4 are live)

- [ ] **Step 1: Probe the live site with the switch still off.**
  - `GET /api/app-settings` shows `extraPhotos: false`;
  - the boxes don't show on the test site.
- [ ] **Step 2: Live three-photo check.** Give Samuel a one-line heads-up that this creates a test sighting and cat on the test site. Then switch it on with `db-ops set-setting` (`SETTING_KEY=extra_photos_on`, value `true`, target per `docs/runbooks/neon-database.md`). Wait 60 seconds for the cache. Then on the test site, in the browser pane:
  - spot with a face and a body photo;
  - name a new cat;
  - check that the cat page shows the face photo as main, with two thumbnails;
  - hide one thumbnail from the team page, and check it disappears from the public page;
  - remove the test cat by the usual team route.
- [ ] **Step 3: If Decision P1 is A,** leave it on and tell Samuel in one line that it's on. If P1 is B, switch it back off and hand Samuel the one command.
- [ ] **Step 4: Update Linear.** SYC-415 goes to Done with the PR numbers. File §11's follow-ups if not already filed. Add a reminder to SYC-415 to read the §8 measures on **29 October 2026** (two weeks after), as a scheduled task, so it actually happens.

---

## Spec coverage check

| Spec section | Task |
|---|---|
| §3.1 card, cartoons, tips, "Got it" never opens a picker | 1.2, 1.3 |
| §3.2 first visit, link, "no cat" screen, delete-my-data | 1.1, 1.3 |
| §3.3 three languages | 1.2, 3.4, 4.4, 4.6 |
| §3.4 accessibility | 1.2, 4.6 |
| §3.5 offline (bundled cartoons) | 1.2 (no network assets) |
| §4.1 boxes, camera/library, Remove/replace, 44pt, a11y labels | 4.6 |
| §4.3 three max, once only, 21-day, two hours, retake re-check, too-large at pick | 4.1, 4.2, 4.5, 4.6; server duplicate guard 2.3 |
| §4.4 one sighting, counts once | 2.5 (test 7) |
| §4.5 "Same cat only", mixed-cats flag for the team | 4.6 (line), 2.4, 2.5 (stored), 3.3 Step 3b (shown to the team) |
| §5.1 cover rule, phone knows it | 2.3, 4.1, 4.6, review screen 4.6 Step 5 |
| §5.2 matcher sees all, any-cat, more-than-one | 2.4, 2.5 |
| §5.3 no photo dropped; matcher failure keeps all | 2.5 (test 6) |
| §5.4 new cat's main photo is the cover | 2.3 (`photo_id` = cover; resolve's `primaryPhotoId: sighting.photoId` at `sightings.ts:738` unchanged) |
| §5.5 thumbnails, per-photo hide, colony-scoped, never before resolve | 3.1, 3.2, 3.4 |
| §6.1 one request, repeat matches all, 2048px, budget | 2.5, 4.1, 4.2 |
| §6.2 check all, then save together, then match; error names photo | 2.3, 2.5 |
| §6.3 every reader | 3.1–3.3 (stand-in and colour reading commented as unchanged) |
| §6.4 offline: sweep, missing extra, per-photo fix, 413, remove | 4.3, 4.4 |
| §6.5 deleting data | No code: extras live in `photos`/`sighting_photos` with no spotter column. Deletion unlinks `sightings.device_id` only. Covered by an assertion in 2.3's database test: `sighting_photos` has no device column. |
| §6.6 cost, SYC-46/SYC-81 | Follow-up comments on SYC-46 and SYC-81 (Task 4.7 Step 4) |
| §6.7 release order | The switch: 2.1, 2.6, 4.6, 4.7 |
| §7 privacy | 2.5 (test 8), 3.2 (never before resolve) |
| §8 measures | 2.1 and 2.5 (`no_cat_in_any_photo`, `mixed_cats`), roles in `sighting_photos` for the face-photo bet, 4.7 Step 4 reminder |

---

## Model delegation

The active model is Opus 5.5. Every implementing agent runs in **its own worktree**, and the prompt for each one restates: *"Commit after each task, and update `docs/superpowers/plans/syc-415-checkpoint.md` at every commit."*

| Work package | Model | Why this tier | Assurance |
|---|---|---|---|
| PR 1: photo tips (Tasks 1.1–1.3) | **Sonnet** | Clear spec, self-contained UI, an existing "seen once" pattern to copy | Unit and source tests; the session model looks at screenshots at 390px and desktop; an adversarial review (Sonnet, own worktree) before merge |
| PR 1 Greek and French strings | **Sonnet** (inside PR 1) | Translation of short UI copy | The i18n completeness test; SYC-4's native-speaker check before launch |
| PR 2 Task 2.1: schema, migration, switch | **Sonnet** | Follows the documented migration routine | `migrate:check`, the rollback test, a duplicate-photo-id probe on the dev branch; the session model reviews the SQL |
| PR 2 Tasks 2.3–2.5: one-transaction save, matcher, upload, dedupe | **Opus** | Escalated: subtle failure modes (a partial save, the dedupe-hit path, the append-only trigger, matcher failure) across several files, and these are silent-failure guards | Route tests 1–8; **mutation probes** on the cover rule, the transaction and the dedupe hit; an adversarial review (Opus, own worktree), justified because a wrong-but-green save is the costliest failure here |
| PR 2 Task 2.6: switch in `/app-settings` | **Haiku** | Mechanical: one read and one field, following existing keys | Route test; diff spot-review by the session model |
| PR 3 Task 3.1: hide/report reach extras | **Sonnet** | One query added to a clear function | Colony-scoped route test; **mutation probe** (a silent "no colony" fallback) |
| PR 3 Tasks 3.2–3.4: cat payloads and thumbnails | **Sonnet** | Straightforward reads and UI | Payload tests, including "pending extras never appear"; screenshots; an adversarial review (Sonnet, own worktree) |
| PR 4 Tasks 4.1–4.3, 4.5: pure rules, prepare, payload, recent photos | **Sonnet** | Pure functions with full tests given in the plan | Unit tests; the session model re-runs the named test files itself (memory note `rerun-delegated-tests`) |
| PR 4 Task 4.4: offline queue | **Opus** | Escalated: the queue has silent-loss failure modes (a sweep deleting extras, a missing extra killing a good spot), plus web and native storage differences | Tests 1–7; **mutation probes** on the sweep, remove and missing-extra handling; an adversarial review (Opus, own worktree) |
| PR 4 Task 4.6: boxes and Spot wiring | **Sonnet** | UI wiring against tested pure rules | Component and source tests; screenshots of the full browser walk-through at 390px and desktop; a screen-reader check; an adversarial review (Sonnet, own worktree) |
| Live checks, switch-on, Linear sync (4.7) | **Session model (Opus)** | Outside effects and judgment; heads-up rules apply | Probe verification on the live site (healthz commit, app-settings, a three-photo spot, hide) |
| Integration across PRs, final review before each merge | **Session model (Opus)** | Synthesis across sub-agent outputs | Re-runs every delegated test suite locally before asking Samuel to merge |

Digest and fan-out agents never sub-delegate. Background agents that die are resumed from their last commit and checkpoint note, without redoing work.
