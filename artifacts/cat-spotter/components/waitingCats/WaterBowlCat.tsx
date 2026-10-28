/** SYC-772 (spec §3.1): topic 4, Being around a street cat. Port of topic-4-being-around-a-street-cat.svg. */
import React from 'react';
import { Ellipse, Path } from 'react-native-svg';
import { Belly, Body, Eyes, Head, Nose, OUTLINE, Tail } from './catParts';
import { Layer, TopicPicture } from './Layer';
import { useTopicMotion } from './topicLayers';

const FUR = '#e38b3a';

export function WaterBowlCat({ size }: { size: number }) {
  const { moving, box } = useTopicMotion(size);
  return (
    <TopicPicture size={size} testID="topic-cat-4">
      {/* tail: sways about 112,132 */}
      <Layer {...box} name="tail" style={moving('colonyTail', [112, 132])}>
        <Tail fill={FUR} />
      </Layer>
      <Layer {...box}>
        <Body fill={FUR} />
        <Belly />
        <Head fill={FUR} />
        <Eyes />
        <Nose />
        <Path d="M6 140 L46 140 L41 154 L11 154 Z" fill="#1c77c3" stroke={OUTLINE} strokeWidth={2} strokeLinejoin="round" />
        <Ellipse cx={26} cy={141} rx={18} ry={3} fill="#8fc6ee" />
      </Layer>
      {/* ripple: grows and fades about 26,141 */}
      <Layer {...box} name="ripple" style={moving('ripple', [26, 141])}>
        <Ellipse id="ripple" cx={26} cy={141} rx={10} ry={2} fill="none" stroke="#ffffff" strokeWidth={1.2} />
      </Layer>
    </TopicPicture>
  );
}
