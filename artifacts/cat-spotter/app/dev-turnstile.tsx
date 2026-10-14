/** SYC-170 spike: dev-only screen to trigger the Turnstile WebView. Renders nothing in a release build. */
import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { TurnstileHost, type TurnstileHostHandle } from '@/components/TurnstileHost';

export default function DevTurnstile() {
  const host = useRef<TurnstileHostHandle>(null);
  const [lines, setLines] = useState<string[]>([]);
  if (!__DEV__) return null;

  const log = (s: string) => setLines((l) => [...l, s]);
  const run = async () => {
    const t0 = Date.now();
    log('running…');
    try {
      const r = await host.current!.run('welfare_report', `r-${t0}`);
      log(`token ${r.token.slice(0, 16)}… after ${Date.now() - t0} ms, interactive=${r.interactive}`);
      log(`user agent: ${r.userAgent}`);
    } catch (e) {
      log(`${(e as Error).message} after ${Date.now() - t0} ms`);
    }
  };

  return (
    <View style={{ flex: 1, paddingTop: 80, paddingHorizontal: 16 }}>
      <Pressable
        accessibilityRole="button"
        onPress={run}
        style={{ backgroundColor: '#1d4ed8', padding: 16, borderRadius: 8 }}
      >
        <Text style={{ color: '#fff', fontSize: 16 }}>Run Turnstile check</Text>
      </Pressable>
      <ScrollView style={{ marginTop: 16 }}>
        {lines.map((l, i) => (
          <Text key={i} testID={`dev-turnstile-line-${i}`} style={{ marginBottom: 6 }}>
            {l}
          </Text>
        ))}
      </ScrollView>
      <TurnstileHost ref={host} />
    </View>
  );
}
