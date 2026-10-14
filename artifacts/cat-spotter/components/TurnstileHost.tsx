/**
 * SYC-170 spike: a hidden WebView that runs the /_challenge page and hands
 * back a Turnstile token. Spike only: not wired into any real form.
 *
 * run(action, cdata) resolves with a token, or rejects with
 * Error('challenge_unavailable:<why>') on an error or after 20 seconds.
 * When Cloudflare asks for a tap the WebView is shown as a small sheet.
 */
import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { apiOrigin } from '@/lib/urls';
import {
  challengeUrl,
  isNavigationAllowed,
  parseChallengeMessage,
  type ChallengeAction,
} from '@/lib/turnstileNav';

export const CHALLENGE_TIMEOUT_MS = 20_000;

export type TurnstileRunInfo = { userAgent: string | null; interactive: boolean };
export type TurnstileHostHandle = {
  run(action: ChallengeAction, cdata: string): Promise<{ token: string } & TurnstileRunInfo>;
};

type Pending = {
  url: string;
  resolve: (v: { token: string } & TurnstileRunInfo) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  userAgent: string | null;
  interactive: boolean;
};

// Read once and posted back, so we can record that it stays the same. We do
// NOT set the WebView's userAgent prop: the default is stable for the session.
const REPORT_UA = `window.ReactNativeWebView.postMessage(JSON.stringify({type:'ua',ua:navigator.userAgent}));true;`;

export const TurnstileHost = forwardRef<TurnstileHostHandle>(function TurnstileHost(_props, ref) {
  const pending = useRef<Pending | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);

  const finish = useCallback((fn: (p: Pending) => void) => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    setUrl(null);
    setSheet(false);
    fn(p);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      run(action, cdata) {
        return new Promise((resolve, reject) => {
          if (pending.current) {
            reject(new Error('challenge_unavailable:busy'));
            return;
          }
          const next = challengeUrl(apiOrigin(), action, cdata);
          const timer = setTimeout(
            () => finish((p) => p.reject(new Error('challenge_unavailable:timeout'))),
            CHALLENGE_TIMEOUT_MS,
          );
          pending.current = { url: next, resolve, reject, timer, userAgent: null, interactive: false };
          setUrl(next);
        });
      },
    }),
    [finish],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const msg = parseChallengeMessage(event.nativeEvent.data);
      const p = pending.current;
      if (!msg || !p) return;
      if (msg.type === 'ua') p.userAgent = msg.ua;
      else if (msg.type === 'interactive') {
        p.interactive = true;
        setSheet(true);
      } else if (msg.type === 'token') {
        finish((q) => q.resolve({ token: msg.token, userAgent: q.userAgent, interactive: q.interactive }));
      } else if (msg.type === 'error') {
        finish((q) => q.reject(new Error(`challenge_unavailable:${msg.code}`)));
      }
    },
    [finish],
  );

  if (!url) return null;
  const origin = apiOrigin();
  return (
    <View pointerEvents={sheet ? 'auto' : 'none'} style={sheet ? styles.sheet : styles.hidden}>
      <WebView
        source={{ uri: url }}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['https://*', 'http://localhost*', 'http://127.0.0.1*', 'about:*']}
        onShouldStartLoadWithRequest={(req) => isNavigationAllowed(req.url, origin)}
        injectedJavaScript={REPORT_UA}
        onMessage={onMessage}
        onError={() => finish((p) => p.reject(new Error('challenge_unavailable:load')))}
        onHttpError={() => finish((p) => p.reject(new Error('challenge_unavailable:http')))}
        style={styles.web}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, left: 0, top: 0 },
  sheet: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 40,
    height: 140,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
    elevation: 8,
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  web: { flex: 1, backgroundColor: 'transparent' },
});
