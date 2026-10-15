/**
 * SYC-323: build-time additions to app.json for the store builds.
 *
 * app.json stays the single place for the app's names, ids and plugins (the
 * rename, SYC-34, edits it there). This file only adds what must not live in
 * git, read from the EAS build environment (eas.json picks the environment
 * per profile; the values are set with `eas env:set`, see
 * docs/runbooks/store-builds.md):
 *
 * - GOOGLE_MAPS_ANDROID_API_KEY: react-native-maps on Android needs a Google
 *   Maps key even though we draw OpenStreetMap tiles on top; without it the
 *   map is blank. iOS uses Apple Maps and needs no key.
 * - GOOGLE_SERVICES_JSON (optional, an EAS "file" variable): the Firebase
 *   settings file Android needs before it will hand out a push token. Without
 *   it the app still works; Android phones just get no push notifications
 *   (NotificationContext treats push as optional).
 *
 * It also sets one iPhone-only fact Apple asks about on every build:
 * - ios.config.usesNonExemptEncryption = false. The app's only encryption is
 *   HTTPS through the phone's own system, which Apple treats as exempt.
 *   Without it every TestFlight build waits on a "Missing Compliance"
 *   question in App Store Connect. Kept here, not in app.json, so the rename
 *   (SYC-34) and this don't edit the same file.
 *
 * Off EAS (the website build, `expo start`, tests) only that iPhone flag is
 * added, which the website never reads.
 *
 * On an EAS preview or production build, a missing value stops the build
 * instead of shipping an app that can't work:
 * - Android without the map key (a blank map);
 * - either platform without EXPO_PUBLIC_PRELAUNCH_KEY (SYC-113: every call
 *   fails with "Cat Spotters isn't open yet"). The key itself is read by
 *   lib/prelaunch.ts, not here. Remove this check with the rest of the
 *   pre-launch gate (SYC-114).
 */

const STORE_PROFILES = new Set(['preview', 'production']);

function present(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function withStoreBuildSettings(config, env) {
  const isStoreBuild = env.EAS_BUILD === 'true' && STORE_PROFILES.has(env.EAS_BUILD_PROFILE);
  const platform = env.EAS_BUILD_PLATFORM;

  if (isStoreBuild) {
    const missing = [];
    if (platform === 'android' && !present(env.GOOGLE_MAPS_ANDROID_API_KEY)) {
      missing.push('GOOGLE_MAPS_ANDROID_API_KEY (the Android map is blank without it)');
    }
    if (!present(env.EXPO_PUBLIC_PRELAUNCH_KEY)) {
      missing.push('EXPO_PUBLIC_PRELAUNCH_KEY (the app cannot reach the server before launch)');
    }
    if (missing.length > 0) {
      throw new Error(
        `This ${env.EAS_BUILD_PROFILE} build is missing: ${missing.join('; ')}. ` +
          'Set it with `eas env:set` for this environment (docs/runbooks/store-builds.md).',
      );
    }
  }

  const ios = {
    ...config.ios,
    config: { ...config.ios?.config, usesNonExemptEncryption: false },
  };
  const android = { ...config.android };
  let changed = false;
  if (present(env.GOOGLE_MAPS_ANDROID_API_KEY)) {
    android.config = {
      ...android.config,
      googleMaps: { apiKey: env.GOOGLE_MAPS_ANDROID_API_KEY.trim() },
    };
    changed = true;
  }
  if (present(env.GOOGLE_SERVICES_JSON)) {
    android.googleServicesFile = env.GOOGLE_SERVICES_JSON.trim();
    changed = true;
  }
  return changed ? { ...config, ios, android } : { ...config, ios };
}

module.exports = ({ config }) => withStoreBuildSettings(config, process.env);
module.exports.withStoreBuildSettings = withStoreBuildSettings;
