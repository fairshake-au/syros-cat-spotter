/** SYC-772 (spec §3.1): topic 3, Why sterilisation works. Port of topic-3-why-sterilisation-works.svg. */
import React from 'react';
import { Path } from 'react-native-svg';
import { Belly, Body, EAR_CLIPPED, Eyes, Head, Nose, Tail } from './catParts';
import { Layer, TopicPicture } from './Layer';
import { useTopicMotion } from './topicLayers';

const FUR = '#2b2b2b';

export function EarTipCat({ size }: { size: number }) {
  const { moving, box } = useTopicMotion(size);
  return (
    <TopicPicture size={size} testID="topic-cat-3">
      {/* ear-clipped: the clipped tip on the cat's left ear; never moves */}
      <Layer {...box}>
        <Tail fill={FUR} />
        <Body fill={FUR} />
        <Belly />
        <Head fill={FUR} rightEar={EAR_CLIPPED} />
      </Layer>
      {/* eyes: blink about 80,56 */}
      <Layer {...box} name="eyes" style={moving('blink', [80, 56])}>
        <Eyes rim="#888" />
      </Layer>
      <Layer {...box}>
        <Nose />
      </Layer>
      {/* heart: rises and fades */}
      <Layer {...box} name="heart" style={moving('heart')}>
        <Path
          id="heart"
          d="M128 30 C128 24 120 22 118 28 C116 22 108 24 108 30 C108 37 118 42 118 42 C118 42 128 37 128 30 Z"
          fill="#d64185"
        />
      </Layer>
    </TopicPicture>
  );
}
