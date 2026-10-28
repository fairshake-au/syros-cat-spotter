/** SYC-772 (spec §3.1): topic 5, When a cat needs help. Port of topic-5-when-a-cat-needs-help.svg. */
import React from 'react';
import { Circle, G, Path, Polygon, Rect } from 'react-native-svg';
import { Body, EAR_LEFT, EAR_RIGHT, Eyes, Head, Nose, Outlined, OUTLINE, Tail } from './catParts';
import { Layer, TopicPicture } from './Layer';
import { useTopicMotion } from './topicLayers';

const FUR = '#8d929a';
const PINK = '#d64185';

export function HelpCat({ size }: { size: number }) {
  const { moving, box } = useTopicMotion(size);
  return (
    <TopicPicture size={size} testID="topic-cat-5">
      <Layer {...box}>
        <Tail fill={FUR} />
        <Body fill={FUR} />
      </Layer>
      {/* ear-left: twitches about 62,40 (the viewer's left ear); behind the head circle */}
      <Layer {...box} name="ear-left" style={moving('earTwitch', [62, 40])}>
        <Outlined fill={FUR}>
          <Polygon points={EAR_LEFT} />
        </Outlined>
      </Layer>
      <Layer {...box}>
        <Outlined fill={FUR}>
          <Polygon points={EAR_RIGHT} />
          <Circle cx={80} cy={58} r={26} />
        </Outlined>
        <Eyes />
        <Nose />
        <G id="bandage">
          <Rect x={86} y={128} width={14} height={14} fill="#fbfaf6" stroke={OUTLINE} strokeWidth={1.5} />
          <Path d="M86 133 L100 133 M86 138 L100 138" stroke="#d9cfc0" strokeWidth={1.5} />
        </G>
      </Layer>
      {/* aid: pulses about 132,40 */}
      <Layer {...box} name="aid" style={moving('aidPulse', [132, 40])}>
        <G id="aid">
          <Circle cx={132} cy={40} r={13} fill="#fbfaf6" stroke={PINK} strokeWidth={2} />
          <Path d="M132 33 L132 47 M125 40 L139 40" stroke={PINK} strokeWidth={4} strokeLinecap="round" />
        </G>
      </Layer>
    </TopicPicture>
  );
}
