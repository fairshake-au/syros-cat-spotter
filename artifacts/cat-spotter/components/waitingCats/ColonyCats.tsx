/** SYC-772 (spec §3.1): topic 2, Life in a colony. Port of topic-2-life-in-a-colony.svg. */
import React from 'react';
import { G } from 'react-native-svg';
import { WholeCat } from './catParts';
import { Layer, TopicPicture } from './Layer';
import { useTopicMotion } from './topicLayers';

export function ColonyCats({ size }: { size: number }) {
  const { moving, box } = useTopicMotion(size);
  return (
    <TopicPicture size={size} testID="topic-cat-2">
      {/* mother-wrap: nods, translateY 0..-3 */}
      <Layer {...box} name="mother-wrap" style={moving('motherNod')}>
        <G id="mother" transform="translate(-16 10) scale(0.9)">
          <WholeCat fill="#8d929a" belly />
        </G>
      </Layer>
      {/* kitten-wrap: the same, half a cycle later */}
      <Layer {...box} name="kitten-wrap" style={moving('kittenNod')}>
        <G id="kitten" transform="translate(80 72) scale(0.5)">
          <WholeCat fill="#e38b3a" />
        </G>
      </Layer>
    </TopicPicture>
  );
}
