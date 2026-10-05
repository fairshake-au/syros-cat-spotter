import type { ImageSourcePropType } from 'react-native';

/**
 * The example photo shown with the ear-tip question: a clean clipped tip
 * beside a torn ear (cat-record-data-spine.md §4.4).
 *
 * Samuel decided on 5 October 2026 to ship the question without waiting for
 * Syros Cats' photo (SYC-79). Until it arrives this is null, and the question
 * shows only its written explanation ("A clip is a straight cut across the
 * tip of the ear…"). When the photo and Syros Cats' permission arrive, add it
 * under assets/images/ and set this to `require('@/assets/images/<file>')`;
 * the question then shows it with no other change. Never use a stock or
 * generated stand-in.
 */
export const EAR_TIP_EXAMPLE_PHOTO: ImageSourcePropType | null = null;
