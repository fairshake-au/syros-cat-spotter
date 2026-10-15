import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

// SYC-323: app.config.js adds the Android map key on EAS store builds and
// refuses a store build that would ship broken. Everything else (the website,
// `expo start`) must get app.json unchanged.
const require = createRequire(import.meta.url);
const appDir = path.resolve(__dirname, '../..');
type AppConfig = Record<string, any>;
const appConfigModule = require(path.join(appDir, 'app.config.js')) as ((ctx: { config: AppConfig }) => AppConfig) & {
  withStoreBuildSettings: (config: AppConfig, env: Record<string, string | undefined>) => AppConfig;
};
const { withStoreBuildSettings } = appConfigModule;
const appJson = JSON.parse(fs.readFileSync(path.join(appDir, 'app.json'), 'utf8')).expo;

const easBuild = (profile: string, platform: 'ios' | 'android', extra: Record<string, string> = {}) => ({
  EAS_BUILD: 'true',
  EAS_BUILD_PROFILE: profile,
  EAS_BUILD_PLATFORM: platform,
  ...extra,
});

describe('app.config.js', () => {
  it('off EAS (the website build), adds only the iPhone encryption flag', () => {
    const out = withStoreBuildSettings(appJson, {});
    const { ios, ...rest } = out;
    const { ios: appIos, ...appRest } = appJson;
    expect(rest).toEqual(appRest);
    expect(ios).toEqual({ ...appIos, config: { usesNonExemptEncryption: false } });
  });

  it('declares standard encryption only, so TestFlight builds are not held for export compliance', () => {
    const out = withStoreBuildSettings(appJson, easBuild('production', 'ios', { EXPO_PUBLIC_PRELAUNCH_KEY: 't' }));
    expect(out.ios.config.usesNonExemptEncryption).toBe(false);
    expect(out.ios.bundleIdentifier).toBe('com.syroscatspotters.app');
  });

  it('keeps the app id and names from app.json', () => {
    const out = withStoreBuildSettings(
      appJson,
      easBuild('production', 'android', { GOOGLE_MAPS_ANDROID_API_KEY: 'k', EXPO_PUBLIC_PRELAUNCH_KEY: 't' }),
    );
    expect(out.android.package).toBe('com.syroscatspotters.app');
    expect(out.ios.bundleIdentifier).toBe('com.syroscatspotters.app');
    expect(out.name).toBe(appJson.name);
    expect(out.plugins).toEqual(appJson.plugins);
  });

  it('adds the Android map key when it is set, without dropping other android settings', () => {
    const out = withStoreBuildSettings(
      appJson,
      easBuild('production', 'android', { GOOGLE_MAPS_ANDROID_API_KEY: ' key-123 ', EXPO_PUBLIC_PRELAUNCH_KEY: 't' }),
    );
    expect(out.android.config.googleMaps.apiKey).toBe('key-123');
    expect(out.android.package).toBe(appJson.android.package);
  });

  it('adds the Firebase file for Android push only when it is set', () => {
    const env = easBuild('production', 'android', { GOOGLE_MAPS_ANDROID_API_KEY: 'k', EXPO_PUBLIC_PRELAUNCH_KEY: 't' });
    expect(withStoreBuildSettings(appJson, env).android.googleServicesFile).toBeUndefined();
    const out = withStoreBuildSettings(appJson, { ...env, GOOGLE_SERVICES_JSON: '/eas/files/google-services.json' });
    expect(out.android.googleServicesFile).toBe('/eas/files/google-services.json');
    expect(out.android.config.googleMaps.apiKey).toBe('k');
  });

  it.each(['preview', 'production'])('stops a %s Android build with no map key', (profile) => {
    expect(() =>
      withStoreBuildSettings(appJson, easBuild(profile, 'android', { EXPO_PUBLIC_PRELAUNCH_KEY: 't' })),
    ).toThrow(/GOOGLE_MAPS_ANDROID_API_KEY/);
  });

  it('lets an iOS build through with no map key (Apple Maps needs none)', () => {
    const out = withStoreBuildSettings(appJson, easBuild('production', 'ios', { EXPO_PUBLIC_PRELAUNCH_KEY: 't' }));
    expect(out.android?.config?.googleMaps).toBeUndefined();
  });

  it.each(['ios', 'android'] as const)('stops a %s store build with no tester key', (platform) => {
    expect(() =>
      withStoreBuildSettings(appJson, easBuild('preview', platform, { GOOGLE_MAPS_ANDROID_API_KEY: 'k' })),
    ).toThrow(/EXPO_PUBLIC_PRELAUNCH_KEY/);
  });

  it('treats a blank value as missing', () => {
    expect(() =>
      withStoreBuildSettings(
        appJson,
        easBuild('production', 'android', { GOOGLE_MAPS_ANDROID_API_KEY: '  ', EXPO_PUBLIC_PRELAUNCH_KEY: 't' }),
      ),
    ).toThrow(/GOOGLE_MAPS_ANDROID_API_KEY/);
  });

  it('does not check development builds or local runs of the eas CLI', () => {
    expect(() => withStoreBuildSettings(appJson, easBuild('development', 'android'))).not.toThrow();
    expect(() =>
      withStoreBuildSettings(appJson, { EAS_BUILD_PROFILE: 'production', EAS_BUILD_PLATFORM: 'android' }),
    ).not.toThrow();
  });

  it('never writes the tester key into the app config', () => {
    const out = withStoreBuildSettings(
      appJson,
      easBuild('production', 'android', { GOOGLE_MAPS_ANDROID_API_KEY: 'k', EXPO_PUBLIC_PRELAUNCH_KEY: 'secret-tester-key' }),
    );
    expect(JSON.stringify(out)).not.toContain('secret-tester-key');
  });
});

describe('app.config.js as Expo calls it (reads process.env)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('stops an EAS Android store build with no keys', () => {
    vi.stubEnv('EAS_BUILD', 'true');
    vi.stubEnv('EAS_BUILD_PROFILE', 'production');
    vi.stubEnv('EAS_BUILD_PLATFORM', 'android');
    vi.stubEnv('GOOGLE_MAPS_ANDROID_API_KEY', '');
    vi.stubEnv('EXPO_PUBLIC_PRELAUNCH_KEY', '');
    expect(() => appConfigModule({ config: appJson })).toThrow(/GOOGLE_MAPS_ANDROID_API_KEY.*EXPO_PUBLIC_PRELAUNCH_KEY/);
  });

  it('adds the map key from the environment', () => {
    vi.stubEnv('EAS_BUILD', 'true');
    vi.stubEnv('EAS_BUILD_PROFILE', 'preview');
    vi.stubEnv('EAS_BUILD_PLATFORM', 'android');
    vi.stubEnv('GOOGLE_MAPS_ANDROID_API_KEY', 'env-key');
    vi.stubEnv('EXPO_PUBLIC_PRELAUNCH_KEY', 't');
    expect(appConfigModule({ config: appJson }).android.config.googleMaps.apiKey).toBe('env-key');
  });
});

describe('eas.json', () => {
  const eas = JSON.parse(fs.readFileSync(path.join(appDir, 'eas.json'), 'utf8'));

  it('has the three build profiles, each tied to its EAS environment', () => {
    for (const profile of ['development', 'preview', 'production']) {
      expect(eas.build[profile].environment).toBe(profile);
      expect(eas.build[profile].extends).toBe('base');
    }
  });

  it('keeps every secret out of the file', () => {
    const text = JSON.stringify(eas);
    expect(text).not.toMatch(/PRELAUNCH_KEY|GOOGLE_MAPS|apiKey|password|serviceAccount/i);
  });

  it('lets EAS count build numbers, and raises them on every store build', () => {
    expect(eas.cli.appVersionSource).toBe('remote');
    expect(eas.build.production.autoIncrement).toBe(true);
  });
});
