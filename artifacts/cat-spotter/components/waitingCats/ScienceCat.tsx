/** SYC-772 (spec §3.1): topic 6, You're doing science. Port of topic-6-youre-doing-science.svg. */
import React from 'react';
import { Circle, G, Line } from 'react-native-svg';
import { Body, Eyes, Head, Nose, OUTLINE, Tail } from './catParts';
import { Layer, TopicPicture } from './Layer';
import { useTopicMotion } from './topicLayers';

const FUR = '#2b2b2b';

export function ScienceCat({ size }: { size: number }) {
  const { moving, box } = useTopicMotion(size);
  return (
    <TopicPicture size={size} testID="topic-cat-6">
      <Layer {...box}>
        <Tail fill={FUR} />
        <Body fill={FUR} />
        <Head fill={FUR} />
        <Eyes rim="#888" />
        <Nose />
      </Layer>
      {/* lens: scans sideways */}
      <Layer {...box} name="lens" style={moving('lensScan')}>
        <G id="lens">
          <Line x1={104} y1={74} x2={124} y2={98} stroke="#8b5a2b" strokeWidth={6} strokeLinecap="round" />
          <Circle cx={92} cy={58} r={17} fill="#e8f4fc" fillOpacity={0.3} stroke={OUTLINE} strokeWidth={3} />
        </G>
      </Layer>
    </TopicPicture>
  );
}
