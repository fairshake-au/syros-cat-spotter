/**
 * SYC-772 (spec §3.4): what every topic component needs to lay out a moving
 * part: the layer props for the square drawing and the loop style.
 */
import { useReducedMotion } from 'react-native-reanimated';
import { loopStyle, pivotOrigin } from './motion';
import { MOTIONS } from './keyframes';
import { SQUARE_VIEWBOX } from './Layer';

type MotionName = keyof typeof MOTIONS;

/**
 * For a picture `size` points square: `moving(name, pivot?)` is the style of a
 * moving layer (pivot in viewBox units), and `box` the props every layer shares.
 */
export function useTopicMotion(size: number) {
  const reduced = useReducedMotion();
  const k = size / SQUARE_VIEWBOX.w;
  const moving = (name: MotionName, pivot?: [number, number]) => {
    const m = MOTIONS[name];
    return [
      pivot ? { transformOrigin: pivotOrigin(pivot[0], pivot[1], SQUARE_VIEWBOX) } : null,
      loopStyle(m.keyframes(k), m.periodMs, { reduced }),
    ];
  };
  return { moving, box: { width: size, height: size, viewBox: SQUARE_VIEWBOX } };
}
