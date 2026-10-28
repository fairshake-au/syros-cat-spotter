/** SYC-772 (spec §3.1): topic 1, Reading a cat. Port of topic-1-reading-a-cat.svg. */
import React from 'react';
import { Body, Eyes, Head, Nose, Tail } from './catParts';
import { Layer, TopicPicture } from './Layer';
import { useTopicMotion } from './topicLayers';

const FUR = '#e38b3a';
const TAIL_D = 'M104 128 Q132 128 132 96 Q132 70 120 56 Q114 50 112 58 Q122 74 122 96 Q122 116 104 116 Z';

export function ReadingCat({ size }: { size: number }) {
  const { moving, box } = useTopicMotion(size);
  return (
    <TopicPicture size={size} testID="topic-cat-1">
      {/* tail: turns about 108,124 */}
      <Layer {...box} name="tail" style={moving('readingTail', [108, 124])}>
        <Tail fill={FUR} d={TAIL_D} />
      </Layer>
      <Layer {...box}>
        <Body fill={FUR} />
        <Head fill={FUR} />
        <Nose />
      </Layer>
      {/* eyes: blink about 80,56 */}
      <Layer {...box} name="eyes" style={moving('blink', [80, 56])}>
        <Eyes />
      </Layer>
    </TopicPicture>
  );
}
