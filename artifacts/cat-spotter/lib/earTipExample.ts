import type { ImageSourcePropType } from 'react-native';
import earTipExample from '../assets/images/ear-tip-example.jpg';

/**
 * The example shown with the ear-tip question (SYC-79,
 * cat-record-data-spine.md §4.4): two of Jacky's photos of one Syros cat,
 * side by side. On the left, her head: her right ear keeps its natural point.
 * On the right, a close-up of her left ear, with the flat, straight top of a
 * sterilisation clip. Taken by Jacky of Syros Cats, used with her permission
 * (5–6 Oct 2026). The full-size originals are attached to SYC-79.
 *
 * Samuel decided on 6 Oct 2026 that no torn-ear photo is needed, and to show
 * both photos: the head alone made the clipped tip hard to read at card size
 * (PR #96 review). 800x400, matching the question's 2:1 frame.
 */
export const EAR_TIP_EXAMPLE_PHOTO: ImageSourcePropType | null = earTipExample;
