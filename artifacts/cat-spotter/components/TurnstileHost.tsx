/**
 * SYC-170 PR 1.3: the phone apps' safety check. Mounted once in the root
 * layout. It draws what lib/turnstileController.ts says: nothing until a check
 * runs, then one hidden WebView on the app host's /_challenge page, shown as a
 * small sheet only if Cloudflare asks for a tap.
 *
 * The rules (token, timeout, load errors, what is allowed to load) live in the
 * controller and are tested there; this file only wires the WebView to it.
 */
import React, { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useLanguage } from '@/context/LanguageContext';
import { turnstileController as controller } from '@/lib/turnstile';

export function TurnstileHost() {
  const { t } = useLanguage();
  const view = useSyncExternalStore(controller.subscribe, controller.getView, controller.getView);
  if (!view.url) return null;

  const onMessage = (event: WebViewMessageEvent) =>
    controller.handleMessage(event.nativeEvent.data, event.nativeEvent.url);

  return (
    <View pointerEvents={view.sheet ? 'auto' : 'none'} style={view.sheet ? styles.sheet : styles.hidden}>
      {view.sheet ? <Text style={styles.line}>{t('turnstileTapLine')}</Text> : null}
      <WebView
        source={{ uri: view.url }}
        javaScriptEnabled
        domStorageEnabled
        // No `userAgent` prop on purpose: Cloudflare needs the user agent to stay the same
        // through a session, not to look like any particular browser. The WebView's own
        // default is constant per install; a spoofed string that doesn't match the real
        // engine is exactly what bot scoring catches.
        originWhitelist={['https://*', 'http://localhost*', 'http://127.0.0.1*', 'about:*']}
        onShouldStartLoadWithRequest={(req) => controller.shouldLoad(req.url)}
        onMessage={onMessage}
        onError={() => controller.handleLoadError()}
        onHttpError={() => controller.handleLoadError()}
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Invisible, but a real size: a 1-pixel page can make a widget think it is
  // off-screen.
  hidden: { position: 'absolute', left: 0, bottom: 0, width: 320, height: 150, opacity: 0 },
  sheet: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 40,
    padding: 12,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#fff',
    elevation: 8,
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  line: { fontSize: 15, lineHeight: 22, textAlign: 'center', color: '#1f1f1f', marginBottom: 8 },
  web: { height: 80, backgroundColor: 'transparent' },
});
