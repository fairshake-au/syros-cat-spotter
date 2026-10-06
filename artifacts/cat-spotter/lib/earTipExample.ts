import type { ImageSourcePropType } from 'react-native';
import earTipExample from '../assets/images/ear-tip-example.jpg';

/**
 * The example photo shown with the ear-tip question (SYC-79,
 * cat-record-data-spine.md §4.4): a Syros cat whose left ear (on the right
 * of the picture) has a clipped, flat tip, beside her right ear's natural
 * point. Taken by Jacky of Syros Cats, used with her permission (5–6 Oct 2026).
 *
 * Samuel decided on 6 October 2026 that no torn-ear photo is needed: the two
 * ears side by side show the difference, and the caption says a notch or tear
 * is a battle scar. The full-size original is attached to SYC-79; this copy is
 * cropped to the question's 2:1 frame and sized to 1200x600.
 */
export const EAR_TIP_EXAMPLE_PHOTO: ImageSourcePropType | null = earTipExample;
