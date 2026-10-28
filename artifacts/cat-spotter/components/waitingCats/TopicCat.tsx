/** SYC-772 (spec §3.1): the picture for a fact's topic strand, 1 to 6. */
import React from 'react';
import { ColonyCats } from './ColonyCats';
import { EarTipCat } from './EarTipCat';
import { HelpCat } from './HelpCat';
import { ReadingCat } from './ReadingCat';
import { ScienceCat } from './ScienceCat';
import { WaterBowlCat } from './WaterBowlCat';

const BY_STRAND = {
  1: ReadingCat,
  2: ColonyCats,
  3: EarTipCat,
  4: WaterBowlCat,
  5: HelpCat,
  6: ScienceCat,
} as const;

export function TopicCat({ strand, size = 48 }: { strand: 1 | 2 | 3 | 4 | 5 | 6; size?: number }) {
  const Cat = BY_STRAND[strand];
  return <Cat size={size} />;
}
