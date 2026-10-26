# Store builds (iPhone and Android)

**Linear:** SYC-323. Carries on from `docs/DEPLOYMENT.md` §B. Decisions this depends on: SYC-347 (D1, D1b, D2) and SYC-306 (the launch address).

This is how the phone apps get built and sent to Apple and Google. The settings live in the repo. The account steps are Samuel's, because they need his Apple, Google and Expo logins.

## What's in the repo

| File | What it does |
|---|---|
| `artifacts/cat-spotter/eas.json` | The three kinds of build (below), which Node and pnpm versions EAS uses, and the server address the app talks to |
| `artifacts/cat-spotter/app.config.js` | Adds the settings that stay out of git (the Android map key and, later, the Firebase file for Android push) at build time. Tells Apple the app only uses standard encryption (HTTPS), so TestFlight builds aren't held at "Missing Compliance". Stops a test or store build that would ship broken. `app.json` stays the one place for the app's names, ids and permissions |
| `artifacts/cat-spotter/lib/__tests__/appConfig.test.ts` | Tests for both files |

### The three kinds of build

| Profile | Who it's for | How it's installed |
|---|---|---|
| `development` | Claude, for trying native code on a phone (the Turnstile check, SYC-170 PR 1.3) | Needs `expo-dev-client` added first (SYC follow-up). Not needed for launch |
| `preview` | A quick check on a real phone before anything goes to a store | Android: an `.apk` file you open on the phone. iPhone: only on phones registered with Apple, so use TestFlight instead |
| `production` | TestFlight, the Play test tracks, and the public stores | Through the stores |

### Settings kept out of git (EAS environment variables)

Each profile reads the EAS environment of the same name (`development`, `preview`, `production`).

| Name | What it is | Needed for | If it's missing |
|---|---|---|---|
| `EXPO_PUBLIC_PRELAUNCH_KEY` | The tester key from SYC-113 (one of the values in Replit's `PRELAUNCH_TESTER_KEYS`) | Every build, until launch | `preview` and `production` builds stop with a message. A `development` build would get "Cat Spotters isn't open yet" on every screen |
| `GOOGLE_MAPS_ANDROID_API_KEY` | Google Maps key for Android | Android builds | Android `preview` and `production` builds stop. Without it the map would be blank |
| `GOOGLE_SERVICES_JSON` | Firebase settings file for Android push (an EAS "file" variable) | Android push notifications | The app works, but Android phones get no push notifications |

The tester key must never go into Replit or a `.env` file: `scripts/check-web-env.js` stops the website build if it does (SYC-113).

The server address (`EXPO_PUBLIC_DOMAIN`) is not secret, so it sits in `eas.json`: `apptest.catspotters.com`, the live test server. It changes once SYC-306 decides the launch address. A phone app keeps the address it was built with, so changing it means new store builds (see "What the decisions change").

### Build and version numbers

EAS keeps the build number (the one Apple and Google need to go up with every upload) and raises it on every `production` build. Nobody edits it by hand. The version people see in the store (`1.0.0`, in `app.json`) only changes when we choose to.

## Samuel's checklist

Run these in order. Each block is one command, safe to copy and paste. The `cd` line takes you to the app folder in the main checkout, which needs this PR merged and `main` pulled.

### 1. Expo account and project (5 minutes, free)

If you don't have an Expo account, make one at https://expo.dev/signup first (D1b: in your own name or as a "Fair Shake" organisation on Expo).

```bash
cd /Users/samuelporter/Projects/syros-cat-spotter/artifacts/cat-spotter
```

```bash
npx eas-cli@24.14.0 login
```

```bash
npx eas-cli@24.14.0 init
```

`init` creates the project on Expo and writes the project id (`extra.eas.projectId`) into `app.json` in your checkout, and probably the account name (`owner`) too; that part is **unchecked**. Neither is secret. Push notifications need the id (`NotificationContext.tsx` reads it).

Then **tell Claude "eas init done"**. Don't commit it yourself. Claude reads what changed in your checkout, puts them into a small PR (the only `app.json` change this needs), and once it's merged you run:

```bash
git -C /Users/samuelporter/Projects/syros-cat-spotter checkout -- artifacts/cat-spotter/app.json
```

This next one should print `main`. If it prints anything else, other sessions are using that checkout: stop and tell Claude rather than pulling.

```bash
git -C /Users/samuelporter/Projects/syros-cat-spotter branch --show-current
```

```bash
git -C /Users/samuelporter/Projects/syros-cat-spotter pull --ff-only
```

Steps 2 and 3 work straight away, before that PR merges. Steps 4–6 (the builds) wait for it, so the builds match what's on `main`. (`eas build` would also run with the file uncommitted; it just uploads your copy.)

### 2. The tester key into EAS

The command asks for the value. Paste the tester key when it asks: never in chat, a ticket or a file.

```bash
npx eas-cli@24.14.0 env:set --name EXPO_PUBLIC_PRELAUNCH_KEY --environment development --environment preview --environment production --visibility sensitive
```

"Sensitive" hides the key in build logs. It can't be "secret": EAS refuses that for `EXPO_PUBLIC_` names, because the value is built into the app.

### 3. Android map key (Google Cloud, about 10 minutes)

1. Open https://console.cloud.google.com and create a project called `Cat Spotters` (or pick an existing Fair Shake one).
2. Go to **APIs & Services → Library**, search for **Maps SDK for Android** and press **Enable**. Google may ask for a billing account. Whether in-app Android maps are free is **unchecked**; look at Google's Maps price list before adding a card.
3. Go to **APIs & Services → Credentials → Create credentials → API key**.
4. In the new key's settings, under **API restrictions**, choose **Restrict key** and tick only **Maps SDK for Android**. Save.
5. Leave **Application restrictions** off for now. After the first Android build (§5 below), come back, choose **Android apps**, and add package `com.syroscatspotters.app` with two SHA-1 fingerprints:
   - the upload key: run `npx eas-cli@24.14.0 credentials --platform android` and read "SHA1 Fingerprint" (or on expo.dev: the project, then **Credentials → Android**);
   - Google's signing key: Play Console, then the app, then **App integrity → App signing** (the menu path is **unchecked**; Google moves it from time to time).
6. Put the key into EAS. It asks for the value; paste the key.

```bash
npx eas-cli@24.14.0 env:set --name GOOGLE_MAPS_ANDROID_API_KEY --environment development --environment preview --environment production --visibility sensitive
```

Until the fingerprints are added, the key only works for Maps on Android, so a leak can't run up other Google services.

### 4. Apple: first iPhone build to TestFlight

Needs the Apple Developer Program (D1b). EAS asks you to sign in to Apple during the build, and offers to create the certificates. Say yes to letting EAS manage them.

```bash
npx eas-cli@24.14.0 build --platform ios --profile production
```

When it finishes:

```bash
npx eas-cli@24.14.0 submit --platform ios --latest
```

The build also offers to make the Apple push key (for iPhone notifications): say yes. The submit command creates the app in App Store Connect (if it isn't there yet) and puts the build in TestFlight. People on your own App Store Connect team can install it once Apple has processed it. Testers outside the team need Apple's beta review first; how long that takes now is **unchecked**.

### 5. Google: first Android build to a test track

Needs the Play Console account (D1b) and the app created there (**Create app**, name per D2). Then:

```bash
npx eas-cli@24.14.0 build --platform android --profile production
```

For the upload, Expo's docs say `eas submit` works for the first submission. It needs a Google service account key, which takes about 15 minutes to set up (Expo's guide: https://docs.expo.dev/submit/android/). Quicker for this first time: open the finished build on expo.dev, download the `.aab` file, and upload it in Play Console under **Testing → Closed testing → Create new release**. Closed testing is the track that starts Google's 14-day clock, if it applies (personal account, D1b). Then go back to §3, item 5, and add the two fingerprints.

### 6. A quick check on an Android phone before testers get it

```bash
npx eas-cli@24.14.0 build --platform android --profile preview
```

Open the link it prints on an Android phone and install the app. Check that the map shows tiles, that a cat photo loads (it proves the tester key works), and that a spot sends.

### 7. Later: Android push notifications

Not needed for the first test builds. In Firebase (https://console.firebase.google.com), add an Android app with package `com.syroscatspotters.app` and download `google-services.json`. Then:

```bash
npx eas-cli@24.14.0 env:set --name GOOGLE_SERVICES_JSON --type file --value /Users/samuelporter/Downloads/google-services.json --environment development --environment preview --environment production --visibility sensitive
```

```bash
npx eas-cli@24.14.0 credentials --platform android
```

In the menu choose **production → Google Service Account → Manage your Google Service Account Key for Push Notifications (FCM V1) → Set up → Upload a new service account key**. The key file comes from Firebase: **Project settings → Service accounts → Generate new private key**. Delete the downloaded key file afterwards.

## What the decisions change

| Decision | If it goes the recommended way | If not |
|---|---|---|
| **D1** (web app on 31 Oct, store apps follow) | This checklist runs alongside launch. Steps 1–5 by Mon 19 Oct start the Android clock; submission by Fri 23 Oct | Everything here moves to "this week", and the 14-day Android test (if it applies) can't finish before 31 Oct |
| **D1b** (whose name the accounts are in) | Your own name: steps 1, 4 and 5 use your logins; Android brings the 14-day closed test | Fair Shake organisation: make a matching Expo organisation in step 1 so the project sits with the business. Apple needs a D-U-N-S number first (can take weeks). Google's 14-day test doesn't apply |
| **D2** (keep the app id `com.syroscatspotters.app`) | Nothing changes | Change `ios.bundleIdentifier` and `android.package` in `app.json` **before step 4**. After the first store upload the id can never change. The map key's restriction (§3, item 5) uses the same id. The Expo project name (`slug: syroscatspotters`) should stay as it is either way, even if the app is renamed (SYC-34): it's internal and tied to the project id |
| **SYC-306** (the launch address) | Claude changes `EXPO_PUBLIC_DOMAIN` in `eas.json` and the next builds use it | Builds already in testers' hands keep talking to `apptest.catspotters.com`, so that address must keep working until everyone has updated (SYC-191 already guards the sign-in Worker for the same reason) |

## "Keep my spots safe" switches (SYC-137)

Both are **off** until SYC-596 has checked them on a real TestFlight and Play build. Set them as plain `EXPO_PUBLIC_` values (they are not secret), one per build:

- `EXPO_PUBLIC_SECURE_IDENTITY=on` on the **phone builds** (in `eas.json` `env`, or `eas env:set`): the device id and secret live in the iPhone Keychain / Android secure storage, and an iPhone keeps its spotter after the app is deleted and reinstalled. **One-way:** once a build with this on has run, never ship a build with it off, or those phones will make a new spotter.
- `EXPO_PUBLIC_OPEN_IN_APP=on` on the **website build**: the restore page, in a phone's browser, shows "Open in Cat Spotters" (opens `syroscatspotters://restore?t=…`). Turn it on only once the store apps are installable.

## Choices still open

These are on SYC-323 for Samuel, each with a recommendation:

- **Instant fixes to the phone apps (Expo "updates")**: not set up. Every change to the phone apps needs a new build and a store review. See SYC-323.
- **Build numbers**: EAS counts them (set up; easy to undo).
- **Where the server address lives**: in `eas.json`, visible in the repo (set up; easy to undo).

## Troubleshooting

- **"This production build is missing: …"** The named setting isn't in that EAS environment. Run the matching `env:set` above, then build again.
- **`eas config` or `eas build` says "An Expo user account is required".** Run step 1's `login`.
- **Blank map on Android.** The map key is missing, or the fingerprints (§3, item 5) don't match the build. A `preview` build is signed with the upload key, a Play download with Google's key, which is why both are listed.
