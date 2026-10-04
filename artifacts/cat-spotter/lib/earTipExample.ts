import type { ImageSourcePropType } from 'react-native';

/**
 * The example photo shown with the ear-tip question: a clean clipped tip
 * beside a torn ear (cat-record-data-spine.md §4.4: "required, not
 * decorative").
 *
 * TODO(SYC-79): BLOCKER. This must be Syros Cats' own photo, with their
 * permission, before data spine PR 7 can merge. Until it arrives this is
 * null and the question shows a clearly marked placeholder instead
 * (components/SightingQuestions.tsx). Never replace it with a stock or
 * generated "real-looking" photo. When the photos arrive, add them under
 * assets/images/ and set this to `require('@/assets/images/<file>')`.
 */
export const EAR_TIP_EXAMPLE_PHOTO: ImageSourcePropType | null = null;
